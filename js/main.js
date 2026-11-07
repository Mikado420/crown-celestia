import { HostController, TIMING } from './host.js';
import { hostRoom, joinRoom, normalizeCode } from './net.js';
import { SEAT_LIMIT, TABLE_NAMES, MIN_PLAYERS, MAX_PLAYERS, HAND_SIZE } from './game.js';
import { esc, cardHtml, flipHtml, tallyHtml, TABLE_ICONS, ICON, SEAT_COLORS, tabOf } from './art.js';
import { sfx } from './sfx.js';

// ?fast を付けると待ち時間を短くした確認用モードになる
if (new URLSearchParams(location.search).has('fast')) {
  Object.assign(TIMING, { revealMs: 400, stepMs: 160, takeMs: 600, roundBreakMs: 1500, cpuMinMs: 50, cpuMaxMs: 150, chooseMs: 4000, tableMs: 3000 });
}

const app = document.getElementById('app');
const toastEl = document.getElementById('toast');
const dlg = {
  rules: document.getElementById('rules'),
  menu: document.getElementById('menu'),
  confirm: document.getElementById('confirm'),
};
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');

let session = null; // { role: 'solo' | 'host' | 'client', host?, net? }
let lobby = null;
let view = null;
let deadlineAt = null;
let deadlineTotal = 1;
let lastTick = null;
let shownRound = 0;
let ledgerShownFor = null;
const anim = { running: false, seq: 0, token: 0, flippedKey: null };

const sleep = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)));
const $ = (sel, root = app) => root.querySelector(sel);
const $$ = (sel, root = app) => [...root.querySelectorAll(sel)];

function storage(key, value) {
  try {
    if (value === undefined) return localStorage.getItem(key);
    localStorage.setItem(key, value);
  } catch {
    return null;
  }
  return null;
}

let toastTimer = null;
function toast(message) {
  toastEl.textContent = message;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 3200);
}

const nameOf = (pid) => (pid === view?.you ? 'あなた' : view?.players.find((p) => p.id === pid)?.name ?? '???');
const initial = (name) => Array.from(String(name ?? '?'))[0] ?? '?';

// ---------- 通信の窓口 ----------
function act(msg) {
  if (!session) return;
  if (session.role === 'client') session.net.send(msg);
  else session.host.hostAction(msg);
}

function onMessage(msg) {
  if (!msg || typeof msg !== 'object') return;
  if (msg.type === 'lobby') {
    lobby = msg;
    view = null;
    anim.token++;
    anim.running = false;
    anim.seq = 0;
    anim.flippedKey = null;
    shownRound = 0;
    ledgerShownFor = null;
    renderLobby();
  } else if (msg.type === 'state') {
    onState(msg.view);
  } else if (msg.type === 'error') {
    toast(msg.message);
  } else if (msg.type === 'kicked' || msg.type === 'closed') {
    leave(msg.message);
  }
}

function leave(message) {
  if (!session) return;
  const s = session;
  session = null;
  if (s.host) s.host.closeRoom();
  // 店じまいの知らせが届くよう、少し待ってから切断する
  setTimeout(() => s.net?.close?.(), s.host ? 400 : 0);
  lobby = null;
  view = null;
  anim.token++;
  anim.running = false;
  history.replaceState(null, '', location.pathname);
  sfx.ambience(false);
  renderTitle();
  if (message) toast(message);
}

// ---------- メニューと退出 ----------
function syncSoundLabel() {
  $('[data-menu="sound"]', dlg.menu).textContent = `効果音：${sfx.enabled ? 'オン' : 'オフ'}`;
}

dlg.menu.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-menu]');
  if (!btn) return;
  const what = btn.dataset.menu;
  if (what === 'rules') {
    dlg.menu.close();
    dlg.rules.showModal();
  } else if (what === 'sound') {
    sfx.enabled = !sfx.enabled;
    sfx.ambience(sfx.enabled && document.body.dataset.screen === 'game');
    syncSoundLabel();
    sfx.pick();
  } else if (what === 'leave') {
    dlg.menu.close();
    askLeave();
  }
});

function askLeave() {
  const inGame = !!view;
  let text = '';
  if (session?.role === 'solo') text = '練習をやめて、タイトルに戻ります。';
  else if (session?.role === 'host') text = inGame ? 'あなたが退出すると店が閉まり、全員の対局が終わります。' : 'あなたが退出すると部屋が閉じます。';
  else text = inGame ? 'あなたの席は、この後CPUが代わりに打ちます。' : '部屋から抜けます。';
  $('#confirmText', dlg.confirm).textContent = text;
  dlg.confirm.showModal();
}

dlg.confirm.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-confirm]');
  if (!btn) return;
  dlg.confirm.close();
  if (btn.dataset.confirm === 'yes') leave();
});

function openMenu() {
  syncSoundLabel();
  dlg.menu.showModal();
}

// ---------- タイトル ----------
function renderTitle() {
  document.body.dataset.screen = 'title';
  const roomFromUrl = normalizeCode(new URLSearchParams(location.search).get('room'));
  const saved = storage('cc-name') || '';
  app.innerHTML = `
  <main class="title">
    <div class="hang-sign" aria-hidden="true">
      <span class="chain l"></span><span class="chain r"></span>
      <div class="plank">${ICON.mug}<span>酔いどれ竜亭</span></div>
    </div>
    <p class="series">クラウン・セレスティア</p>
    <h1>酒場のツケ</h1>
    <p class="tagline">満席の卓に座った者が、全員分を払う。</p>
    <div class="title-form">
      <input type="text" id="name" maxlength="12" placeholder="あなたの名前" value="${esc(saved)}" aria-label="あなたの名前">
      ${roomFromUrl ? '' : '<button class="btn wide" id="host">店を開いて友達を招く</button>'}
      <div class="join">
        <input type="text" id="code" maxlength="5" placeholder="合言葉（部屋コード）" autocapitalize="characters" value="${esc(roomFromUrl)}" aria-label="部屋コード">
        <button class="btn ${roomFromUrl ? '' : 'ghost'}" id="join">入る</button>
      </div>
      ${roomFromUrl ? '' : '<button class="btn ghost wide" id="solo">CPUと練習する</button>'}
      <button class="linklike" id="rulesBtn">遊び方</button>
    </div>
  </main>
  <div class="facade" aria-hidden="true"><i class="win w1"></i><i class="win w2"></i><i class="door"></i><i class="win w3"></i><i class="win w4"></i></div>`;
  const getName = () => {
    const name = $('#name').value.trim().slice(0, 12) || '名無しの冒険者';
    storage('cc-name', name);
    return name;
  };
  $('#rulesBtn').onclick = () => dlg.rules.showModal();
  $('#solo')?.addEventListener('click', () => startHost(getName(), false));
  $('#host')?.addEventListener('click', (e) => {
    e.currentTarget.disabled = true;
    e.currentTarget.textContent = '店を準備しています…';
    startHost(getName(), true).catch((err) => {
      renderTitle();
      toast(err.message);
    });
  });
  const join = () => {
    const code = normalizeCode($('#code').value);
    if (code.length !== 5) return toast('部屋コードは5文字です');
    const btn = $('#join');
    btn.disabled = true;
    btn.textContent = '接続中…';
    startClient(getName(), code).catch((err) => {
      renderTitle();
      toast(err.message);
    });
  };
  $('#join').onclick = join;
  $('#code').onkeydown = (e) => e.key === 'Enter' && join();
  if (roomFromUrl && !saved) $('#name').focus();
}

async function startHost(name, online) {
  let net = null;
  let host = null;
  if (online) {
    net = await hostRoom({
      onMessage: (connId, msg) => host?.handleMessage(connId, msg),
      onDisconnect: (connId) => host?.handleDisconnect(connId),
      onError: () => {},
    });
  }
  host = new HostController({
    hostName: name,
    roomCode: net?.code ?? null,
    send: (connId, msg) => net?.send(connId, msg),
    onView: onMessage,
  });
  session = { role: online ? 'host' : 'solo', host, net };
  if (!online) for (let i = 0; i < 3; i++) host.addCpu();
  host.broadcast();
}

async function startClient(name, code) {
  const net = await joinRoom(code, {
    onMessage,
    onClose: () => {
      if (session?.net === net) leave('ホストとの接続が切れました');
    },
  });
  session = { role: 'client', net };
  net.send({ type: 'join', name });
}

// ---------- ロビー ----------
function renderLobby() {
  document.body.dataset.screen = 'lobby';
  const isHost = session?.role !== 'client';
  const n = lobby.players.length;
  const invite = lobby.code ? `${location.origin}${location.pathname}?room=${lobby.code}` : '';
  const seats = Array.from({ length: MAX_PLAYERS }, (_, i) => {
    const p = lobby.players[i];
    if (!p) {
      return isHost
        ? `<button class="seat-card empty add" data-add aria-label="CPUを呼ぶ"><span class="plus">＋</span><span>CPUを呼ぶ</span></button>`
        : `<div class="seat-card empty"><span>空席</span></div>`;
    }
    const tags = [p.id === lobby.hostId ? 'ホスト' : '', p.isCpu ? 'CPU' : '', p.id === lobby.you ? 'あなた' : ''].filter(Boolean).join('・');
    return `<div class="seat-card${p.id === lobby.you ? ' me' : ''}" style="--c:${SEAT_COLORS[i]}">
      <span class="avatar">${esc(initial(p.name))}</span>
      <span class="seat-name">${esc(p.name)}</span>
      <span class="seat-tag">${tags}</span>
      ${isHost && p.id !== lobby.hostId ? `<button class="seat-remove" data-remove="${esc(p.id)}" aria-label="${esc(p.name)}を外す">${ICON.close}</button>` : ''}
    </div>`;
  }).join('');
  app.innerHTML = `
  <main class="lobby">
    <header class="lobby-head">
      <p class="series">クラウン・セレスティア</p>
      <h1>酒場のツケ</h1>
    </header>
    ${lobby.code ? `
    <section class="room">
      <span class="room-label">今夜の合言葉</span>
      <span class="code">${esc(lobby.code)}</span>
      <button class="btn small" id="copy">招待リンクをコピー</button>
    </section>` : '<p class="solo-note">練習の夜（空いた席をタップすると常連客が来ます）</p>'}
    <section class="seats-grid">${seats}</section>
    <p class="lobby-hint">${isHost
      ? n < MIN_PLAYERS ? `あと${MIN_PLAYERS - n}人で開店できます` : `${n}人・格1〜${n * HAND_SIZE + 5}の冒険者で${n === 2 ? 4 : 3}晩`
      : 'ホストの開店を待っています'}</p>
    <footer class="lobby-foot">
      <button class="btn ghost" id="leave">退出</button>
      ${isHost ? `<button class="btn" id="start" ${n < MIN_PLAYERS ? 'disabled' : ''}>開店する</button>` : '<button class="btn ghost" id="rulesBtn">遊び方</button>'}
    </footer>
  </main>`;
  $('#leave').onclick = askLeave;
  $('#rulesBtn')?.addEventListener('click', () => dlg.rules.showModal());
  $('#copy')?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(invite);
      toast('招待リンクをコピーしました');
    } catch {
      prompt('このリンクを友達に送ってください', invite);
    }
  });
  $$('[data-add]').forEach((b) => (b.onclick = () => act({ type: 'addCpu' })));
  $$('[data-remove]').forEach((b) => (b.onclick = () => act({ type: 'remove', id: b.dataset.remove })));
  $('#start')?.addEventListener('click', () => {
    sfx.open();
    act({ type: 'start' });
  });
}

// ---------- 対局画面 ----------
function mountGame() {
  document.body.dataset.screen = 'game';
  sfx.ambience(true);
  app.innerHTML = `
  <main class="game">
    <header class="bar">
      <button class="icon-btn" id="menuBtn" aria-label="メニュー">${ICON.menu}</button>
      <div class="night" id="night"></div>
      <div class="clock" id="clock" aria-live="off">
        <svg viewBox="0 0 40 40" aria-hidden="true"><circle class="track" cx="20" cy="20" r="16"/><circle class="ring" cx="20" cy="20" r="16" pathLength="100"/></svg>
        <span id="clockText"></span>
      </div>
    </header>
    <div class="board"><span class="board-plate">ツケ帳</span><ul class="patrons" id="patrons"></ul></div>
    <section class="tables" id="tables">
      ${TABLE_NAMES.map((name, i) => `
        <div class="table" data-table="${i}" aria-label="${name}">
          <div class="t-label">${TABLE_ICONS[i]}<span class="bill"></span></div>
          <div class="seats"></div>
          <span class="caption"></span>
        </div>`).join('')}
    </section>
    <div class="prompt" id="prompt"><span class="master" aria-hidden="true">竜</span><p class="line" id="promptLine"></p></div>
    <section class="tray" id="tray">
      <div class="hand" id="hand"></div>
      <div class="stage" id="stage"></div>
    </section>
    <div class="banner" id="banner"><span class="b-main"></span><span class="b-sub"></span></div>
    <div class="ledger-wrap" id="ledger"></div>
  </main>`;
  $('#menuBtn').onclick = openMenu;
  $('#tables').addEventListener('click', (e) => {
    const t = e.target.closest('.table.pickable');
    if (!t) return;
    $$('.table.pickable').forEach((x) => x.classList.remove('pickable'));
    sfx.pick();
    act({ type: 'chooseTable', index: Number(t.dataset.table) });
  });
  $('#hand').addEventListener('click', (e) => {
    const c = e.target.closest('.card');
    if (!c || c.disabled) return;
    $$('#hand .card').forEach((x) => x.classList.toggle('chosen', x === c));
    sfx.pick();
    act({ type: 'play', rank: Number(c.dataset.rank) });
  });
}

function onState(next) {
  view = next;
  deadlineAt = next.deadlineIn != null ? performance.now() + next.deadlineIn : null;
  deadlineTotal =
    next.phase === 'choosing' ? TIMING.chooseMs : next.phase === 'choosingTable' ? TIMING.tableMs + TIMING.revealMs : TIMING.roundBreakMs;
  if (!$('.game')) mountGame();
  const res = next.resolution;
  if (res && res.seq > anim.seq) {
    anim.seq = res.seq;
    runResolution(res);
    return;
  }
  if (!anim.running) updateGame();
}

// 案内は竜人のマスターのひと言として出す
function setPrompt(text, tone = '') {
  const el = $('#prompt');
  const line = $('#promptLine');
  if (line.textContent === text && el.dataset.tone === tone) return;
  line.textContent = text;
  el.dataset.tone = tone;
  el.classList.toggle('quiet', !text);
  line.classList.remove('say');
  void line.offsetWidth;
  line.classList.add('say');
}

function updateBar() {
  const v = view;
  const nights = Array.from({ length: v.rounds }, (_, i) => `<i class="${i < v.round ? 'lit' : ''}"></i>`).join('');
  $('#night').innerHTML = `<span class="chain l"></span><span class="chain r"></span><span class="sign-name">酔いどれ竜亭</span><span class="sign-row"><span>第${v.round}晩</span><span class="pips" aria-label="全${v.rounds}晩">${nights}</span><span class="turn">${Math.min(v.turn, HAND_SIZE)}杯目</span></span>`;
}

function patronState(p) {
  if (anim.running) return '';
  if (view.phase === 'choosing') return p.played ? '<span class="pstate ready" title="決めた"></span>' : '<span class="pstate think" title="考え中"><i></i><i></i><i></i></span>';
  if (view.phase === 'choosingTable' && view.awaiting === p.id) return '<span class="pstate pick">卓選び</span>';
  return '';
}

function updatePatrons(debts = null) {
  const list = $('#patrons');
  list.style.setProperty('--n', view.players.length);
  list.innerHTML = view.players
    .map((p, i) => `
      <li class="patron${p.id === view.you ? ' me' : ''}" data-pid="${esc(p.id)}" style="--c:${SEAT_COLORS[i]}">
        <span class="avatar">${esc(initial(p.name))}${patronState(p)}</span>
        <span class="pdebt">${debts ? debts[p.id] : p.debt}</span>
        <span class="pname">${esc(p.id === view.you ? 'あなた' : p.name)}</span>
      </li>`)
    .join('');
}

function tableEl(i) {
  return $(`.table[data-table="${i}"]`);
}

function slotEl(i, index) {
  return tableEl(i).querySelectorAll('.seats > *')[index];
}

function drawTable(i, cards, fresh = null) {
  const el = tableEl(i);
  const slots = [];
  for (let s = 0; s < SEAT_LIMIT; s++) {
    slots.push(cards[s] != null ? cardHtml(view, cards[s], { cls: cards[s] === fresh ? 'land' : '' }) : '<div class="slot"></div>');
  }
  slots.push('<div class="slot sixth"><span>満席</span></div>');
  el.querySelector('.seats').innerHTML = slots.join('');
  el.querySelector('.bill').textContent = cards.reduce((s, r) => s + tabOf(view, r), 0);
  el.classList.toggle('danger', cards.length >= SEAT_LIMIT);
}

function drawTables(tables) {
  tables.forEach((t, i) => drawTable(i, t));
}

// 手札と公開台のカードを、台の空きに合わせて最大の大きさにする
function trayRoom() {
  const hand = $('#hand');
  const cs = getComputedStyle(hand);
  const W = hand.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const H = hand.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) + 14;
  return { W, H, base: $('.slot')?.offsetWidth || 48 };
}

function layoutHand() {
  const hand = $('#hand');
  if (!hand || !$('#tray')) return;
  const n = hand.children.length;
  hand.classList.remove('rows2', 'fan');
  if (!n) return;
  const { W, H, base } = trayRoom();
  const gap = 6;
  const one = Math.min((W - (n - 1) * gap) / n, (H - 18) / 1.38, 88);
  const cols = Math.ceil(n / 2);
  const two = Math.min((W - (cols - 1) * gap) / cols, (H - 18 - gap) / 2 / 1.38, 88);
  let w;
  if (one >= base * 1.1 || n <= 5) {
    w = one;
  } else if (two >= base * 1.1) {
    w = two;
    hand.classList.add('rows2');
    hand.style.setProperty('--cols', cols);
  } else {
    // 縦が足りない画面では重ねて並べる
    w = Math.min((H - 18) / 1.38, base * 1.25, 88);
    hand.classList.add('fan');
    hand.style.setProperty('--step', `${(W - n * w) / (n - 1)}px`);
  }
  hand.style.setProperty('--hw-live', `${Math.floor(w)}px`);
}

function layoutStage() {
  const stage = $('#stage');
  const n = stage?.children.length;
  if (!n) return;
  const { W, H } = trayRoom();
  const w = Math.min((W - (n - 1) * 6) / n, (H - 30) / 1.38, 84);
  stage.style.setProperty('--hw-live', `${Math.floor(w)}px`);
}

addEventListener('resize', () => {
  layoutHand();
  layoutStage();
});

function drawHand() {
  const v = view;
  const tray = $('#tray');
  tray.dataset.mode = 'hand';
  const canPlay = v.phase === 'choosing' && !anim.running;
  const hand = $('#hand');
  hand.classList.toggle('waiting', canPlay && v.myPlay == null);
  hand.innerHTML = v.hand.map((r) => cardHtml(v, r, { tag: 'button', cls: r === v.myPlay ? 'chosen' : '', attrs: canPlay ? '' : 'disabled' })).join('');
  layoutHand();
}

function drawStage(plays, faceUp) {
  $('#tray').dataset.mode = 'stage';
  $('#stage').innerHTML = plays
    .map((p) => `<div class="reveal-item" data-pid="${esc(p.pid)}">${flipHtml(view, p.rank, faceUp)}<span class="who">${esc(nameOf(p.pid))}</span></div>`)
    .join('');
  layoutStage();
}

async function flipStage() {
  const items = $$('#stage .flip');
  for (const f of items) {
    f.classList.add('up');
    sfx.flip();
    await sleep(reduceMotion.matches ? 0 : 90);
  }
}

function showBanner(main, sub = '') {
  const b = $('#banner');
  b.querySelector('.b-main').textContent = main;
  b.querySelector('.b-sub').textContent = sub;
  b.classList.remove('show');
  void b.offsetWidth;
  b.classList.add('show');
}

function updateGame() {
  const v = view;
  updateBar();
  updatePatrons();
  drawTables(v.tables);
  $$('.table').forEach((t) => t.classList.toggle('pickable', v.phase === 'choosingTable' && v.awaiting === v.you));

  if (v.phase === 'choosing' && v.round !== shownRound) {
    shownRound = v.round;
    showBanner(`第${v.round}晩 開店`, `今夜の大酒飲み　格${v.heavy.join('・格')}`);
    sfx.bell();
  }

  if (v.phase === 'choosingTable') {
    const key = `${v.round}-${v.turn}`;
    if (anim.flippedKey !== key) {
      anim.flippedKey = key;
      drawStage(v.revealed, false);
      flipStage();
    } else {
      drawStage(v.revealed, true);
    }
    if (v.awaiting === v.you) {
      setPrompt('相席はお断りだとさ。どの卓のツケを持つ？', 'alert');
      sfx.alarm();
    } else {
      setPrompt(`${nameOf(v.awaiting)}が、肩代わりする卓を選んでるぜ`);
    }
  } else {
    drawHand();
    if (v.phase === 'choosing') {
      if (v.myPlay == null) setPrompt('いらっしゃい。次の客を案内しな', 'go');
      else setPrompt(`格${v.myPlay}の客だな。全員そろうまで変えていいぜ`);
    } else {
      setPrompt('');
    }
  }
  renderLedger();
  updateClock();
}

// ---------- 着席の演出 ----------
function fly(el, target, ms, { scale = null, fade = false } = {}) {
  const a = el.getBoundingClientRect();
  const b = target.getBoundingClientRect();
  const ghost = el.cloneNode(true);
  ghost.classList.add('flyer');
  Object.assign(ghost.style, { left: `${a.left}px`, top: `${a.top}px`, width: `${a.width}px`, height: `${a.height}px` });
  document.body.appendChild(ghost);
  el.style.visibility = 'hidden';
  const s = scale ?? b.width / a.width;
  const dx = b.left + b.width / 2 - (a.left + a.width / 2);
  const dy = b.top + b.height / 2 - (a.top + a.height / 2);
  const run = ghost.animate(
    [
      { transform: 'translate(0, 0) scale(1)', opacity: 1 },
      { transform: `translate(${dx * 0.5}px, ${dy * 0.5 - 24}px) scale(${(1 + s) / 2 + 0.08})`, opacity: 1, offset: 0.5 },
      { transform: `translate(${dx}px, ${dy}px) scale(${s})`, opacity: fade ? 0 : 1 },
    ],
    { duration: reduceMotion.matches ? 1 : ms, easing: 'cubic-bezier(.35,.6,.25,1)', fill: 'forwards' },
  );
  return run.finished.catch(() => {}).then(() => ghost.remove());
}

function floatText(target, text) {
  const r = target.getBoundingClientRect();
  const f = document.createElement('span');
  f.className = 'float';
  f.textContent = text;
  Object.assign(f.style, { left: `${r.left + r.width / 2}px`, top: `${r.top + 6}px` });
  document.body.appendChild(f);
  setTimeout(() => f.remove(), 1400);
}

async function runResolution(res) {
  const token = ++anim.token;
  anim.running = true;
  const T = TIMING;
  const start = performance.now();
  const alive = () => token === anim.token && $('.game');
  const until = (ms) => sleep(start + ms - performance.now());

  $('#ledger').innerHTML = '';
  const paid = {};
  for (const e of res.events) if (e.amount) paid[e.pid] = (paid[e.pid] ?? 0) + e.amount;
  const debts = Object.fromEntries(view.players.map((p) => [p.id, p.debt - (paid[p.id] ?? 0)]));
  updateBar();
  updatePatrons(debts);
  const tables = res.startTables.map((t) => [...t]);
  drawTables(tables);
  $$('.table').forEach((t) => t.classList.remove('pickable'));
  setPrompt('格の低い客から席につくぞ');

  const key = `${res.round}-${res.turn}`;
  if (anim.flippedKey !== key) {
    anim.flippedKey = key;
    drawStage(res.plays, false);
    await sleep(120);
    await flipStage();
  } else {
    drawStage(res.plays, true);
  }
  let budget = T.revealMs;
  await until(budget);

  const items = $$('#stage .reveal-item');
  for (let i = 0; i < res.events.length; i++) {
    if (!alive()) return;
    const e = res.events[i];
    const card = items[i].querySelector('.flip');
    items[i].classList.add('going');
    if (e.type === 'seat') {
      await fly(card, slotEl(e.table, tables[e.table].length), T.stepMs * 0.75);
      if (!alive()) return;
      tables[e.table].push(e.rank);
      drawTable(e.table, tables[e.table], e.rank);
      sfx.seat();
      budget += T.stepMs;
    } else {
      const row = tableEl(e.table);
      row.classList.add(e.type === 'full' ? 'is-full' : 'is-refused');
      row.querySelector('.caption').textContent = e.type === 'full' ? `満席だ！ ${nameOf(e.pid)}が全員分` : `${nameOf(e.pid)}は相席お断り！`;
      setPrompt(e.type === 'full' ? `6人目は${nameOf(e.pid)}か。この卓の勘定、${e.amount}枚な` : `相席は断られた。${nameOf(e.pid)}が${e.amount}枚肩代わりだ`, 'alert');
      sfx.alarm();
      await sleep(T.takeMs * 0.28);
      if (!alive()) return;
      // 卓の客が勘定を持って払う人のもとへ
      const chip = $(`.patron[data-pid="${CSS.escape(e.pid)}"]`);
      const seated = [...row.querySelectorAll('.seats .card')];
      await Promise.all(
        seated.map((c, k) => sleep(k * 50).then(() => fly(c, chip.querySelector('.avatar'), T.takeMs * 0.3, { scale: 0.3, fade: true }))),
      );
      if (!alive()) return;
      sfx.coins();
      debts[e.pid] += e.amount;
      updatePatrons(debts);
      const chipNow = $(`.patron[data-pid="${CSS.escape(e.pid)}"]`);
      chipNow.classList.add('hit');
      floatText(chipNow, `ツケ +${e.amount}`);
      tables[e.table] = [];
      drawTable(e.table, []);
      await sleep(T.takeMs * 0.08);
      await fly(card, slotEl(e.table, 0), T.takeMs * 0.18);
      if (!alive()) return;
      tables[e.table] = [e.rank];
      drawTable(e.table, tables[e.table], e.rank);
      sfx.seat();
      budget += T.takeMs;
      await until(budget - 120);
      row.classList.remove('is-full', 'is-refused');
      row.querySelector('.caption').textContent = '';
      setPrompt('格の低い客から席につくぞ');
    }
    await until(budget);
  }
  await until(budget + 300);
  if (!alive()) return;
  anim.running = false;
  updateGame();
}

// ---------- 晩の勘定・大会の結果 ----------
function renderLedger() {
  const v = view;
  const wrap = $('#ledger');
  if (v.phase !== 'roundEnd' && v.phase !== 'gameEnd') {
    wrap.innerHTML = '';
    ledgerShownFor = null;
    return;
  }
  const key = `${v.phase}-${v.round}`;
  if (ledgerShownFor === key) return;
  ledgerShownFor = key;
  const final = v.phase === 'gameEnd';
  const winners = v.ranking.filter((r) => r.place === 1).map((r) => nameOf(r.id));
  const idx = Object.fromEntries(v.players.map((p, i) => [p.id, i]));
  if (final) sfx.fanfare();
  wrap.innerHTML = `
  <section class="ledger${final ? ' final' : ''}" role="dialog" aria-label="${final ? '大会の結果' : `第${v.round}晩の勘定`}">
    ${final ? `<div class="ledger-crown">${ICON.crown}</div>` : ''}
    <h2>${final ? `${esc(winners.join('と'))}の勝利` : `第${v.round}晩、閉店`}</h2>
    <p class="ledger-sub">${final ? 'ツケが一番少ない者が、天上の王冠に近づいた' : `今夜のツケ。隅で寝ていたのは格${v.lastSleeper}の客`}</p>
    <ol class="ledger-list">
      ${v.ranking.map((r) => `
        <li class="${r.place === 1 ? 'top' : ''}${r.id === v.you ? ' me' : ''}" style="--c:${SEAT_COLORS[idx[r.id]]}">
          <span class="place">${r.place}</span>
          <span class="avatar">${esc(initial(r.name))}</span>
          <span class="lname">${esc(nameOf(r.id))}</span>
          ${tallyHtml(r.debt, { drawn: true })}
          <span class="ltotal">${r.debt}${final ? '' : `<small>＋${r.roundDebts.at(-1) ?? 0}</small>`}</span>
        </li>`).join('')}
    </ol>
    <div class="ledger-foot">
      ${final
        ? v.isHost
          ? '<button class="btn ghost" id="endLeave">退出</button><button class="btn" id="again">もう一度遊ぶ</button>'
          : '<button class="btn ghost" id="endLeave">退出</button><span class="wait">ホストの合図を待っています</span>'
        : '<span class="wait js-next"></span>'}
    </div>
  </section>`;
  $('#again')?.addEventListener('click', () => act({ type: 'restart' }));
  $('#endLeave')?.addEventListener('click', askLeave);
}

// ---------- 時計 ----------
function updateClock() {
  const clock = $('#clock');
  if (!clock || !view) return;
  const ring = clock.querySelector('.ring');
  const text = $('#clockText');
  const active = deadlineAt != null && !anim.running && view.phase !== 'gameEnd';
  clock.classList.toggle('off', !active);
  const next = $('.js-next');
  if (!active) {
    text.textContent = '';
    ring.style.strokeDashoffset = 0;
    return;
  }
  const left = Math.max(0, deadlineAt - performance.now());
  const secs = Math.ceil(left / 1000);
  text.textContent = secs;
  ring.style.strokeDashoffset = 100 - Math.min(100, (left / deadlineTotal) * 100);
  const deciding =
    (view.phase === 'choosing' && view.myPlay == null) || (view.phase === 'choosingTable' && view.awaiting === view.you);
  clock.classList.toggle('low', deciding && secs <= 5);
  if (next) next.textContent = `次の晩まで ${secs}秒`;
  if (deciding && secs <= 5 && secs > 0 && lastTick !== secs) {
    lastTick = secs;
    sfx.tick();
  }
}
setInterval(updateClock, 200);

renderTitle();
