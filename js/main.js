import { HostController, TIMING } from './host.js';
import { hostRoom, joinRoom, normalizeCode } from './net.js';
import { baseTab, HEAVY_TAB, SEAT_LIMIT, TABLE_NAMES, MIN_PLAYERS, MAX_PLAYERS } from './game.js';

// ?fast を付けると待ち時間を短くした確認用モードになる
if (new URLSearchParams(location.search).has('fast')) {
  Object.assign(TIMING, { revealMs: 150, stepMs: 80, roundBreakMs: 1500, cpuMinMs: 50, cpuMaxMs: 150, chooseMs: 4000, tableMs: 3000 });
}

const app = document.getElementById('app');
const toastEl = document.getElementById('toast');
const rulesEl = document.getElementById('rules');

let session = null; // { role: 'solo' | 'host' | 'client', host?, net? }
let lobby = null;
let view = null;
let deadlineAt = null;
let timerHandle = null;
const anim = { seq: 0, running: false, tables: null, plays: null, done: 0, burst: null, fresh: null };

// ---------- 小物 ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function storage(key, value) {
  try {
    if (value === undefined) return localStorage.getItem(key);
    localStorage.setItem(key, value);
  } catch {
    return null;
  }
}

let toastTimer = null;
function toast(message) {
  toastEl.textContent = message;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 3200);
}

const JOBS = ['見習い', '村の剣士', '盗賊', '弓使い', '僧侶', '吟遊詩人', '狩人', '魔導士', '錬金術師', '騎士', '聖騎士', '竜騎士'];
function jobOf(rank, deckSize) {
  if (rank === 55) return 'ギルド長';
  return JOBS[Math.min(JOBS.length - 1, Math.floor(((rank - 1) / deckSize) * JOBS.length))];
}

function tabFor(rank) {
  return view?.heavy.includes(rank) ? HEAVY_TAB : baseTab(rank);
}

function cardHtml(rank, { tag = 'div', attrs = '', cls = '' } = {}) {
  const tab = tabFor(rank);
  const heavy = view?.heavy.includes(rank);
  const coins = '<i></i>'.repeat(tab);
  return `<${tag} class="card t${tab} ${cls}" ${attrs} aria-label="格${rank}、ツケ${tab}${heavy ? '、大酒飲み' : ''}">
    ${heavy ? '<span class="badge">大酒飲み</span>' : ''}
    <span class="rank">${rank}</span>
    <span class="job">${jobOf(rank, view?.deckSize ?? 104)}</span>
    <span class="coins">${coins}</span>
  </${tag}>`;
}

// 正の字でツケを書く（1画ずつ）
const STROKES = ['M3 3H17', 'M10 3V17', 'M10 10H15', 'M5 9V17', 'M2 17H18'];
function tallyHtml(n) {
  let out = '';
  for (let left = n; left > 0; left -= 5) {
    const strokes = STROKES.slice(0, Math.min(5, left)).map((d) => `<path d="${d}"/>`).join('');
    out += `<svg viewBox="0 0 20 20" aria-hidden="true">${strokes}</svg>`;
  }
  return `<div class="tally">${out}</div>`;
}

const nameOf = (pid) => view?.players.find((p) => p.id === pid)?.name ?? '???';

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
    anim.seq = 0;
    anim.running = false;
    renderLobby();
  } else if (msg.type === 'state') {
    onState(msg.view);
  } else if (msg.type === 'error') {
    toast(msg.message);
  } else if (msg.type === 'kicked') {
    leave(msg.message);
  }
}

function leave(message) {
  if (session?.host) {
    session.host.clearAll();
    session.host.onView = null;
  }
  session?.net?.close?.();
  session = null;
  lobby = null;
  view = null;
  anim.running = false;
  history.replaceState(null, '', location.pathname);
  renderTitle();
  if (message) toast(message);
}

// ---------- タイトル ----------
function savedName() {
  return storage('cc-name') || '';
}

function renderTitle() {
  stopTimer();
  const params = new URLSearchParams(location.search);
  const roomFromUrl = normalizeCode(params.get('room'));
  app.innerHTML = `
  <main class="title-screen">
    <header class="sign">
      <p class="world">クラウン・セレスティア</p>
      <h1>酒場のツケ</h1>
      <p class="inn">天空の都の酒場「酔いどれ竜亭」。満席の卓に座った者が、全員分を払う。</p>
    </header>
    <section class="panel stack">
      <label>あなたの名前
        <input type="text" id="name" maxlength="16" placeholder="例：見習い騎士のミカド" value="${esc(savedName())}">
      </label>
    </section>
    <section class="panel">
      <h2>部屋に入る</h2>
      <div class="row">
        <input type="text" id="code" maxlength="5" placeholder="5文字の部屋コード" autocapitalize="characters" value="${esc(roomFromUrl)}">
        <button class="btn" id="join">入る</button>
      </div>
    </section>
    <section class="panel">
      <h2>部屋を作る</h2>
      <div class="row">
        <button class="btn" id="host">友達を招く部屋を作る</button>
        <button class="btn ghost" id="solo">CPUと練習する</button>
      </div>
      <p class="hint">部屋を作ると、友達に送る招待リンクが出ます。足りない席はCPUで埋められます。</p>
    </section>
    <p class="hint"><button class="linklike" id="rulesBtn">遊び方を読む</button></p>
  </main>`;
  const nameInput = app.querySelector('#name');
  const getName = () => {
    const name = nameInput.value.trim().slice(0, 16) || '名無しの冒険者';
    storage('cc-name', name);
    return name;
  };
  app.querySelector('#rulesBtn').onclick = () => rulesEl.showModal();
  app.querySelector('#solo').onclick = () => startHost(getName(), false);
  app.querySelector('#host').onclick = (e) => {
    e.target.disabled = true;
    e.target.textContent = '部屋を準備中…';
    startHost(getName(), true).catch((err) => {
      toast(err.message);
      renderTitle();
    });
  };
  const join = (e) => {
    const code = normalizeCode(app.querySelector('#code').value);
    if (code.length !== 5) return toast('部屋コードは5文字です');
    e.target.disabled = true;
    e.target.textContent = '接続中…';
    startClient(getName(), code).catch((err) => {
      toast(err.message);
      renderTitle();
    });
  };
  app.querySelector('#join').onclick = join;
  app.querySelector('#code').onkeydown = (e) => e.key === 'Enter' && join({ target: app.querySelector('#join') });
  if (roomFromUrl) app.querySelector(savedName() ? '#join' : '#name').focus();
}

async function startHost(name, online) {
  let net = null;
  let host = null;
  if (online) {
    net = await hostRoom({
      onMessage: (connId, msg) => host.handleMessage(connId, msg),
      onDisconnect: (connId) => host.handleDisconnect(connId),
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
  if (!online) {
    host.addCpu();
    host.addCpu();
    host.addCpu();
  }
  host.broadcast();
}

async function startClient(name, code) {
  const net = await joinRoom(code, {
    onMessage,
    onClose: () => leave('ホストとの接続が切れました'),
  });
  session = { role: 'client', net };
  net.send({ type: 'join', name });
}

// ---------- ロビー ----------
function renderLobby() {
  stopTimer();
  const isHost = session?.role !== 'client';
  const n = lobby.players.length;
  const invite = lobby.code ? `${location.origin}${location.pathname}?room=${lobby.code}` : '';
  app.innerHTML = `
  <main class="lobby">
    <header class="sign">
      <p class="world">クラウン・セレスティア</p>
      <h1>酒場のツケ</h1>
    </header>
    ${lobby.code ? `
    <section class="panel">
      <h2>部屋コード</h2>
      <p class="code">${esc(lobby.code)}</p>
      <div class="row">
        <input type="text" readonly value="${esc(invite)}" id="invite" aria-label="招待リンク">
        <button class="btn small" id="copy">リンクをコピー</button>
      </div>
      <p class="hint">このリンクを友達に送ると、同じ部屋に入れます。</p>
    </section>` : ''}
    <section class="panel">
      <h2>集まった冒険者（${n}/${MAX_PLAYERS}人）</h2>
      <ul class="guests">
        ${lobby.players.map((p) => `
          <li>
            <span>${esc(p.name)} ${p.id === lobby.hostId ? '<span class="tag">ホスト</span>' : ''}${p.isCpu ? '<span class="tag">CPU</span>' : ''}${p.id === lobby.you ? '<span class="tag">あなた</span>' : ''}</span>
            ${isHost && p.id !== lobby.hostId ? `<button class="btn ghost small" data-remove="${esc(p.id)}">外す</button>` : ''}
          </li>`).join('')}
      </ul>
      ${isHost ? `
      <div class="row" style="margin-top:16px">
        <button class="btn ghost" id="addCpu" ${n >= MAX_PLAYERS ? 'disabled' : ''}>CPUを呼ぶ</button>
        <button class="btn" id="start" ${n < MIN_PLAYERS ? 'disabled' : ''}>開店する</button>
      </div>
      <p class="hint">${n < MIN_PLAYERS ? `あと${MIN_PLAYERS - n}人そろうと始められます。` : `${n}人なら格1〜${n * 10 + 5}の冒険者で${n === 2 ? 4 : 3}晩遊びます。`}</p>`
      : '<p class="hint">ホストが開店するのを待っています。</p>'}
    </section>
    <p class="hint"><button class="linklike" id="rulesBtn">遊び方を読む</button>　<button class="linklike" id="leave">タイトルに戻る</button></p>
  </main>`;
  app.querySelector('#rulesBtn').onclick = () => rulesEl.showModal();
  app.querySelector('#leave').onclick = () => leave();
  app.querySelector('#copy')?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(invite);
      toast('招待リンクをコピーしました');
    } catch {
      app.querySelector('#invite').select();
    }
  });
  app.querySelector('#addCpu')?.addEventListener('click', () => act({ type: 'addCpu' }));
  app.querySelector('#start')?.addEventListener('click', () => act({ type: 'start' }));
  app.querySelectorAll('[data-remove]').forEach((b) => (b.onclick = () => act({ type: 'remove', id: b.dataset.remove })));
}

// ---------- 対局 ----------
function onState(next) {
  view = next;
  deadlineAt = next.deadlineIn != null ? performance.now() + next.deadlineIn : null;
  const res = next.resolution;
  if (res && res.seq > anim.seq) {
    anim.seq = res.seq;
    playResolution(res);
    return;
  }
  if (!anim.running) renderGame();
}

function playResolution(res) {
  anim.running = true;
  anim.tables = res.startTables.map((t) => [...t]);
  anim.plays = res.plays;
  anim.done = 0;
  anim.burst = null;
  anim.fresh = null;
  renderGame();
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const step = reduce ? 250 : TIMING.stepMs;
  let i = 0;
  const next = () => {
    if (anim.seq !== res.seq) return; // 新しい状態に追い越された
    if (i >= res.events.length) {
      anim.running = false;
      anim.burst = null;
      renderGame();
      return;
    }
    const e = res.events[i++];
    anim.done = i;
    if (e.type === 'seat') {
      anim.tables[e.table].push(e.rank);
      anim.burst = null;
    } else {
      anim.tables[e.table] = [e.rank];
      const who = e.pid === view.you ? 'あなた' : nameOf(e.pid);
      anim.burst = { table: e.table, text: `${who}がツケ${e.amount}枚` };
    }
    anim.fresh = { table: e.table, rank: e.rank };
    renderGame();
    setTimeout(next, step);
  };
  setTimeout(next, reduce ? 300 : TIMING.revealMs);
}

function stopTimer() {
  clearInterval(timerHandle);
  timerHandle = null;
}

function updateTimer() {
  const els = app.querySelectorAll('.js-timer');
  for (const el of els) {
    if (deadlineAt == null || !view || anim.running) {
      el.textContent = '';
      continue;
    }
    const secs = Math.max(0, Math.ceil((deadlineAt - performance.now()) / 1000));
    el.textContent = view.phase === 'roundEnd' ? `次の晩まで${secs}秒` : `残り${secs}秒`;
    el.classList.toggle('low', secs <= 5 && view.phase !== 'roundEnd');
  }
}

function tableHtml(table, i, { pickable }) {
  const bill = table.reduce((s, r) => s + tabFor(r), 0);
  const full = table.length >= SEAT_LIMIT;
  const burst = anim.running && anim.burst?.table === i ? anim.burst : null;
  const cards = table
    .map((r) => cardHtml(r, { cls: anim.running && anim.fresh?.table === i && anim.fresh.rank === r ? 'new' : '' }))
    .join('');
  const empty = '<div class="seat"></div>'.repeat(Math.max(0, SEAT_LIMIT - table.length));
  return `
  <section class="table ${full ? 'danger' : ''} ${pickable ? 'pickable' : ''} ${burst ? 'flash' : ''}" data-table="${i}" ${pickable ? 'role="button" tabindex="0"' : ''} aria-label="${TABLE_NAMES[i]}、${table.length}人、勘定${bill}">
    <div class="table-head"><span class="name">${TABLE_NAMES[i]}</span><span class="bill">勘定 ${bill}</span></div>
    <div class="seats">${cards}${empty}<div class="seat sixth">6人目が<br>全員分</div></div>
    ${burst ? `<span class="burst">${esc(burst.text)}</span>` : ''}
  </section>`;
}

function statusOf(p) {
  if (!view) return '';
  if (anim.running) return '';
  if (view.phase === 'choosing') return p.played ? '<span class="state ok">決めた</span>' : '<span class="state">考え中</span>';
  if (view.phase === 'choosingTable' && view.awaiting === p.id) return '<span class="state">卓を選び中</span>';
  return '';
}

function renderGame() {
  if (!view) return;
  const v = view;
  const tables = anim.running ? anim.tables : v.tables;
  const plays = anim.running ? anim.plays : v.revealed;
  const mustPick = !anim.running && v.phase === 'choosingTable' && v.awaiting === v.you;
  const canPlay = !anim.running && v.phase === 'choosing';

  let prompt = '';
  if (anim.running) prompt = '冒険者たちが格の低い順に席へ向かいます…';
  else if (mustPick) prompt = `あなたの格${plays[0].rank}は相席を断られました。勘定を肩代わりする卓を選んでください。`;
  else if (v.phase === 'choosingTable') prompt = `${esc(nameOf(v.awaiting))}が、勘定を肩代わりする卓を選んでいます。`;
  else if (canPlay) prompt = v.myPlay != null ? `格${v.myPlay}を案内しました。全員がそろうまで選び直せます。` : '酒場に案内する冒険者を1人選んでください。';

  const revealHtml = plays
    ? `<div class="reveal">${plays
        .map((p, idx) => `<div class="${anim.running && idx < anim.done ? 'done' : ''}">${cardHtml(p.rank)}<div class="who">${esc(p.pid === v.you ? 'あなた' : nameOf(p.pid))}</div></div>`)
        .join('')}</div>`
    : '';

  const me = v.players.find((p) => p.id === v.you);
  app.innerHTML = `
  <main class="game">
    <header class="bar">
      <span class="where">酔いどれ竜亭</span>
      <span class="night">第${v.round}晩／${v.rounds}晩　手番 ${Math.min(v.turn, 10)}/10</span>
      <span class="timer js-timer"></span>
      <button class="btn ghost small" id="rulesBtn">遊び方</button>
    </header>
    <section class="floor">
      <p class="drinkers">今夜の大酒飲み：<b>格${v.heavy.join('</b>と<b>格')}</b>（ツケ${HEAVY_TAB}）</p>
      ${tables.map((t, i) => tableHtml(t, i, { pickable: mustPick })).join('')}
      ${prompt && !canPlay ? `<p class="prompt">${prompt}</p>` : ''}
      ${revealHtml}
    </section>
    <aside class="board">
      <h2>ツケの黒板</h2>
      <ul class="patrons">
        ${v.players.map((p) => `
          <li class="patron ${p.id === v.you ? 'me' : ''}">
            <div class="line"><span class="pname">${esc(p.name)}</span>${statusOf(p)}<span class="sum">${p.debt}</span></div>
            ${tallyHtml(p.debt)}
          </li>`).join('')}
      </ul>
      <ul class="log">${v.log.slice().reverse().map((l) => `<li>${esc(l)}</li>`).join('')}</ul>
    </aside>
    <section class="hand-area">
      ${canPlay ? `<p class="prompt">${prompt}</p>` : ''}
      <div class="hand">
        ${v.hand.length
          ? v.hand.map((r) => cardHtml(r, { tag: 'button', cls: r === v.myPlay ? 'chosen' : '', attrs: `data-rank="${r}" ${canPlay ? '' : 'disabled'}` })).join('')
          : '<p class="hand-empty">手札はありません。</p>'}
      </div>
    </section>
  </main>
  ${!anim.running && (v.phase === 'roundEnd' || v.phase === 'gameEnd') ? ledgerHtml(v, me) : ''}`;

  app.querySelector('#rulesBtn').onclick = () => rulesEl.showModal();
  app.querySelectorAll('.hand .card').forEach((b) => (b.onclick = () => act({ type: 'play', rank: Number(b.dataset.rank) })));
  if (mustPick) {
    app.querySelectorAll('.table.pickable').forEach((t) => {
      const pick = () => act({ type: 'chooseTable', index: Number(t.dataset.table) });
      t.onclick = pick;
      t.onkeydown = (e) => (e.key === 'Enter' || e.key === ' ') && pick();
    });
  }
  app.querySelector('#again')?.addEventListener('click', () => act({ type: 'restart' }));
  app.querySelector('#leaveGame')?.addEventListener('click', () => leave());
  if (!timerHandle) timerHandle = setInterval(updateTimer, 250);
  updateTimer();
}

function ledgerHtml(v, me) {
  const final = v.phase === 'gameEnd';
  const winners = v.ranking.filter((r) => r.place === 1).map((r) => (r.id === v.you ? 'あなた' : r.name));
  const nights = Array.from({ length: v.round }, (_, i) => `<th>${i + 1}晩</th>`).join('');
  return `
  <div class="overlay">
    <section class="ledger" role="dialog" aria-label="${final ? '大会の結果' : `第${v.round}晩の勘定`}">
      <h2>${final ? `優勝は${esc(winners.join('と'))}` : `第${v.round}晩の勘定`}</h2>
      <p class="hint">${final ? 'ツケが一番少なかった者が、天上の王冠に一歩近づきました。' : `酔いつぶれて寝ていたのは格${v.lastSleeper}でした。`}</p>
      <table>
        <thead><tr><th>順位</th><th>冒険者</th>${nights}<th>合計</th></tr></thead>
        <tbody>
          ${v.ranking.map((r) => `
            <tr class="${r.place === 1 ? 'top' : ''}">
              <td>${r.place}</td><td>${esc(r.name)}${r.id === v.you ? '（あなた）' : ''}</td>
              ${r.roundDebts.map((d) => `<td>${d}</td>`).join('')}<td>${r.debt}</td>
            </tr>`).join('')}
        </tbody>
      </table>
      <div class="actions">
        ${final
          ? v.isHost
            ? '<button class="btn ghost" id="leaveGame">店を閉める</button><button class="btn" id="again">もう一度遊ぶ</button>'
            : '<button class="btn ghost" id="leaveGame">店を出る</button><span class="hint">ホストの合図を待っています</span>'
          : '<span class="hint js-timer"></span>'}
      </div>
    </section>
  </div>`;
}

renderTitle();
