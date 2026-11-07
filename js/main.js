// クラウン・セレスティア：タイトル・ロビー・メニューなど、ゲームをまたぐ画面
import { HostController } from './host.js';
import { hostRoom, joinRoom, normalizeCode } from './net.js';
import { GAMES, GAME_IDS, DEFAULT_GAME } from './games/index.js';
import { TIMING as TAVERN_TIMING } from './games/tavern/mode.js';
import { TIMING as GROVE_TIMING } from './games/grove/mode.js';
import { TIMING as DUEL_TIMING } from './games/duel/mode.js';
import { tavernScreen } from './games/tavern/screen.js';
import { groveScreen } from './games/grove/screen.js';
import { duelScreen } from './games/duel/screen.js';
import { esc, ICON, SEAT_COLORS, initial } from './ui.js';
import { sfx } from './sfx.js';

// ?fast を付けると待ち時間を短くした確認用モードになる
if (new URLSearchParams(location.search).has('fast')) {
  Object.assign(TAVERN_TIMING, { revealMs: 400, stepMs: 160, takeMs: 600, roundBreakMs: 1500, cpuMinMs: 50, cpuMaxMs: 150, chooseMs: 4000, tableMs: 3000 });
  Object.assign(DUEL_TIMING, { chooseMs: 4000, revealMs: 300, placeMs: 120, spellMs: 300, decideMs: 300, roundBreakMs: 1500, cpuMinMs: 50, cpuMaxMs: 150 });
  Object.assign(GROVE_TIMING, { actMs: 3000, testifyMs: 2500, bigActMs: 3000, bigTestifyMs: 2500, accuseMs: 3000, actionAnimMs: 200, revealMs: 1600, caseBreakMs: 1500, cpuMinMs: 50, cpuMaxMs: 150 });
}

const SCREENS = { tavern: tavernScreen, grove: groveScreen, duel: duelScreen };

// 看板とタイトル画面の見た目（ゲームごと）
const SIGNS = {
  tavern: { name: '酔いどれ竜亭', icon: ICON.mug, lobby: '今夜の合言葉', start: '開店する', hostBtn: '店を開いて友達を招く', solo: '練習の夜（空いた席をタップすると常連客が来ます）' },
  duel: { name: '天空の魔導院', icon: ICON.crown, lobby: '試験の合言葉', start: '試験を始める', hostBtn: '試験を開いて友達を招く', solo: '練習の試験（空いた席をタップすると魔導士が来ます）' },
  grove: { name: '王城の大広間', icon: ICON.goblet, lobby: '晩餐会の合言葉', start: '晩餐会を始める', hostBtn: '晩餐会を開いて友達を招く', solo: '練習の晩餐会（空いた席をタップすると客が来ます）' },
};

const RULES = {
  tavern: `
    <h2>酒場のツケの遊び方</h2>
    <ol>
      <li>全員が同時に、冒険者を1人選んで酒場へ案内します。</li>
      <li>数字の小さい冒険者から順に、自分より小さく一番近い数字が端にいる卓へ座ります。</li>
      <li>1卓に座れるのは5人まで。<b>6人目</b>は5人分の勘定をツケで払い、その卓に1人で座り直します。</li>
      <li>どの卓の端よりも小さい冒険者は<b>相席お断り</b>。好きな卓を選んで勘定を肩代わりします。</li>
    </ol>
    <p>カード下の硬貨がツケの額です。ジョッキの印が付いた「大酒飲み」はツケ5。10手番で1晩、3晩（2人なら4晩）でツケが一番少ない人の勝ちです。</p>`,
  grove: `
    <h2>毒杯の晩餐会の遊び方</h2>
    <ol>
      <li>伏せた容疑者3人のうち、<b>一番怪しい（数字が大きい）者が犯人</b>。ただし<b>道化師</b>が紛れていたら逆転し、一番怪しくない者が犯人。道化師自身は犯人になりません。</li>
      <li>手番では「<b>調べる</b>（1人をこっそり見る）」か「<b>すり替える</b>（手持ちの人物と入れ替える。抜いた人物は誰も見ずに退場）」を選びます。すり替えは1事件に1回。</li>
      <li>行動のあと、1人について「クロ」か「シロ」を<b>証言</b>します。嘘でも構いません。直前に証言された人物は、次の人は調べられません。</li>
      <li>2周したら全員が同時に告発します。当たりは<b>賭け×（外れた人数＋1）</b>点、外れは−賭け。本当の証言1つにつき+1点。</li>
    </ol>
    <p>事件は人数と同じ数（2人なら6件）。合計点が一番高い人の勝ちです。</p>`,
  duel: `
    <h2>魔法陣の決闘の遊び方</h2>
    <ol>
      <li>隣り合う2人の間に魔法陣が並びます（2人なら7つ、3人は決闘ごとに3つ、4〜6人は2つ）。自分は左右の隣と同時に戦います。</li>
      <li>全員が同時に、精霊を1体自分側の魔法陣に置くか、秘術を1枚使います。そのあと精霊か秘術の山から1枚引きます。<b>パスはできません。</b></li>
      <li>片側3体の役で勝負。強い順に<b>同じ属性の連番 ＞ 同じ数字 ＞ 同じ属性 ＞ 連番 ＞ バラ</b>。同じ役なら合計、それも同じなら先にそろえた方。</li>
      <li>相手がもう逆転できなくなった魔法陣は、自動で決着します。</li>
    </ol>
    <p>魔法陣1つで1点、1つの決闘の陣を全部取ると+1点（2人のときは4つか隣り合う3つで即勝利+2点）。3ラウンドの合計で競います。秘術は手札に2枚まで。</p>`,
};

const app = document.getElementById('app');
const toastEl = document.getElementById('toast');
const dlg = {
  rules: document.getElementById('rules'),
  menu: document.getElementById('menu'),
  confirm: document.getElementById('confirm'),
};
const $ = (sel, root = app) => root.querySelector(sel);
const $$ = (sel, root = app) => [...root.querySelectorAll(sel)];

let session = null; // { role: 'solo' | 'host' | 'client', host?, net? }
let lobby = null;
let screen = null;
let screenId = null;
let chosenGame = GAMES[storage('cc-game')] ? storage('cc-game') : DEFAULT_GAME;

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

function setGameTheme(id) {
  document.body.dataset.game = id;
}

function showRules(id) {
  dlg.rules.innerHTML = `${RULES[id] ?? RULES.tavern}<form method="dialog"><button class="btn wide">閉じる</button></form>`;
  dlg.rules.showModal();
}

const ctx = {
  app,
  act: (msg) => act(msg),
  openMenu: () => openMenu(),
  askLeave: () => askLeave(),
};

// ---------- 通信の窓口 ----------
function act(msg) {
  if (!session) return;
  if (session.role === 'client') session.net.send(msg);
  else session.host.hostAction(msg);
}

function closeScreen() {
  screen?.unmount();
  screen = null;
  screenId = null;
}

function onMessage(msg) {
  if (!msg || typeof msg !== 'object') return;
  if (msg.type === 'lobby') {
    closeScreen();
    lobby = msg;
    renderLobby();
  } else if (msg.type === 'state') {
    const v = msg.view;
    if (screenId !== v.gameId) {
      closeScreen();
      screen = SCREENS[v.gameId];
      screenId = v.gameId;
      setGameTheme(v.gameId);
      screen.mount(ctx);
    }
    screen.onState(v);
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
  closeScreen();
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
    showRules(screenId ?? lobby?.gameId ?? chosenGame);
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
  const inGame = !!screen;
  let text = '';
  if (session?.role === 'solo') text = '練習をやめて、タイトルに戻ります。';
  else if (session?.role === 'host') text = inGame ? 'あなたが退出すると部屋が閉じ、全員の対局が終わります。' : 'あなたが退出すると部屋が閉じます。';
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
function gamePickHtml(selected) {
  return `<div class="game-pick" role="radiogroup" aria-label="遊ぶゲーム">
    ${GAME_IDS.map((id) => {
      const g = GAMES[id];
      return `<button class="gp-card${id === selected ? ' on' : ''}" role="radio" aria-checked="${id === selected}" data-game="${id}">
        <span class="gp-icon">${SIGNS[id].icon}</span>
        <span class="gp-title">${g.title}</span>
        <span class="gp-meta">${g.motif}・${g.mode.minPlayers}〜${g.mode.maxPlayers}人・${g.minutes}</span>
      </button>`;
    }).join('')}
  </div>`;
}

function renderTitle() {
  document.body.dataset.screen = 'title';
  setGameTheme(chosenGame);
  const g = GAMES[chosenGame];
  const sign = SIGNS[chosenGame];
  const roomFromUrl = normalizeCode(new URLSearchParams(location.search).get('room'));
  const saved = storage('cc-name') || '';
  app.innerHTML = `
  <main class="title">
    <div class="hang-sign" aria-hidden="true">
      <span class="chain l"></span><span class="chain r"></span>
      <div class="plank">${roomFromUrl ? ICON.crown : sign.icon}<span>${roomFromUrl ? '招待状が届いています' : sign.name}</span></div>
    </div>
    <p class="series">クラウン・セレスティア</p>
    <h1 class="${(roomFromUrl ? '招かれた部屋へ' : g.title).length > 5 ? 'long' : ''}">${roomFromUrl ? '招かれた部屋へ' : g.title}</h1>
    <p class="tagline">${roomFromUrl ? '名前を入れて「入る」を押してください。' : g.tagline}</p>
    ${roomFromUrl ? '' : gamePickHtml(chosenGame)}
    <div class="title-form">
      <input type="text" id="name" maxlength="12" placeholder="あなたの名前" value="${esc(saved)}" aria-label="あなたの名前">
      ${roomFromUrl ? '' : `<button class="btn wide" id="host">${sign.hostBtn}</button>`}
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
  $$('.gp-card').forEach((b) =>
    b.addEventListener('click', () => {
      if (chosenGame === b.dataset.game) return;
      chosenGame = b.dataset.game;
      storage('cc-game', chosenGame);
      const name = $('#name').value;
      sfx.pick();
      renderTitle();
      $('#name').value = name;
    }),
  );
  $('#rulesBtn').onclick = () => showRules(chosenGame);
  $('#solo')?.addEventListener('click', () => startHost(getName(), false));
  $('#host')?.addEventListener('click', (e) => {
    e.currentTarget.disabled = true;
    e.currentTarget.textContent = '準備しています…';
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
    gameId: chosenGame,
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
  const gid = lobby.gameId ?? DEFAULT_GAME;
  setGameTheme(gid);
  const g = GAMES[gid];
  const sign = SIGNS[gid];
  const isHost = session?.role !== 'client';
  const n = lobby.players.length;
  const { minPlayers: min, maxPlayers: max } = g.mode;
  const invite = lobby.code ? `${location.origin}${location.pathname}?room=${lobby.code}` : '';
  const seats = Array.from({ length: max }, (_, i) => {
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
  const detail = gid === 'tavern'
    ? `${n}人・格1〜${n * 10 + 5}の冒険者で${n === 2 ? 4 : 3}晩`
    : gid === 'grove'
      ? `${n}人・事件${n === 2 ? 6 : n}件`
      : `${n}人・${n === 2 ? '1対1で魔法陣7つ' : n === 3 ? '三つ巴で魔法陣9つ' : `輪になって魔法陣${n * 2}つ`}・3ラウンド`;
  app.innerHTML = `
  <main class="lobby">
    <header class="lobby-head">
      <p class="series">クラウン・セレスティア</p>
      <h1>${g.title}</h1>
    </header>
    ${isHost ? `<div class="lobby-games" role="radiogroup" aria-label="遊ぶゲーム">${GAME_IDS.map((id) => `<button class="lg-tab${id === gid ? ' on' : ''}" role="radio" aria-checked="${id === gid}" data-game="${id}">${SIGNS[id].icon}${GAMES[id].title}</button>`).join('')}</div>` : ''}
    ${lobby.code ? `
    <section class="room">
      <span class="room-label">${sign.lobby}</span>
      <span class="code">${esc(lobby.code)}</span>
      <button class="btn small" id="copy">招待リンクをコピー</button>
    </section>` : `<p class="solo-note">${sign.solo}</p>`}
    <section class="seats-grid">${seats}</section>
    <p class="lobby-hint">${isHost ? (n < min ? `あと${min - n}人で始められます` : detail) : 'ホストが始めるのを待っています'}</p>
    <footer class="lobby-foot">
      <button class="btn ghost" id="leave">退出</button>
      ${isHost ? `<button class="btn" id="start" ${n < min ? 'disabled' : ''}>${sign.start}</button>` : '<button class="btn ghost" id="rulesBtn">遊び方</button>'}
    </footer>
  </main>`;
  $('#leave').onclick = askLeave;
  $('#rulesBtn')?.addEventListener('click', () => showRules(gid));
  $('#copy')?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(invite);
      toast('招待リンクをコピーしました');
    } catch {
      prompt('このリンクを友達に送ってください', invite);
    }
  });
  $$('.lg-tab').forEach((b) =>
    b.addEventListener('click', () => {
      chosenGame = b.dataset.game;
      storage('cc-game', chosenGame);
      sfx.pick();
      act({ type: 'setGame', id: b.dataset.game });
    }),
  );
  $$('[data-add]').forEach((b) => (b.onclick = () => act({ type: 'addCpu' })));
  $$('[data-remove]').forEach((b) => (b.onclick = () => act({ type: 'remove', id: b.dataset.remove })));
  $('#start')?.addEventListener('click', () => {
    sfx.open();
    act({ type: 'start' });
  });
}

renderTitle();
