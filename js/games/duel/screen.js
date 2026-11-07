// 魔法陣の決闘：対局画面と演出
import { TIMING } from './mode.js';
import { MAGIC, formationName } from './game.js';
import { spiritHtml, pageHtml, handCardHtml, magicIcon, CIRCLE_GLYPH } from './art.js';
import { esc, ICON, SEAT_COLORS, initial, sleep, reduceMotion, fly, floatText } from '../../ui.js';
import { sfx } from '../../sfx.js';

let ctx = null;
let view = null;
let shown = null; // いま描いている魔法陣（演出中は途中の状態）
let deadlineAt = null;
let lastTick = null;
let shownRound = 0;
let ledgerFor = null;
let clockTimer = null;
const ui = { card: null, step: null, target: null, draw: 'spirit' };
const anim = { running: false, token: 0, seq: 0 };

const $ = (sel, root = ctx.app) => root.querySelector(sel);
const $$ = (sel, root = ctx.app) => [...root.querySelectorAll(sel)];
const nameOf = (pid) => (pid === view?.you ? 'あなた' : view?.players.find((p) => p.id === pid)?.name ?? '???');
const colorOf = (pid) => SEAT_COLORS[Math.max(0, view.players.findIndex((p) => p.id === pid))];
const clone = (circles) => circles.map((c) => ({ ...c, sides: { [c.a]: [...c.sides[c.a]], [c.b]: [...c.sides[c.b]] } }));
const cardKind = (card) => (card.kind === 'spirit' ? 'spirit' : MAGIC[card.type].kind);

// 自分が戦っている決闘（左の相手 → 右の相手）
function myDuels() {
  const me = view.you;
  const ds = view.duels.filter((d) => d.a === me || d.b === me);
  return ds.sort((x, y) => (x.b === me ? 0 : 1) - (y.b === me ? 0 : 1));
}
const oppIn = (d) => (d.a === view.you ? d.b : d.a);
const isMine = (circleId) => myDuels().some((d) => d.circles.includes(circleId));

export const duelScreen = {
  mount(c) {
    ctx = c;
    view = null;
    shown = null;
    deadlineAt = null;
    lastTick = null;
    shownRound = 0;
    ledgerFor = null;
    Object.assign(ui, { card: null, step: null, target: null, draw: 'spirit' });
    anim.token++;
    anim.running = false;
    anim.seq = 0;
    mount();
    clockTimer = setInterval(updateClock, 200);
    addEventListener('resize', onResize);
  },
  onState: (v) => handleState(v),
  unmount() {
    anim.token++;
    anim.running = false;
    clearInterval(clockTimer);
    removeEventListener('resize', onResize);
    sfx.ambience(false);
  },
};

function onResize() {
  layoutBoard();
  layoutHand();
}

function mount() {
  document.body.dataset.screen = 'game';
  sfx.ambience(true);
  ctx.app.innerHTML = `
  <main class="game duel">
    <header class="bar">
      <button class="icon-btn" id="menuBtn" aria-label="メニュー">${ICON.menu}</button>
      <div class="d-title" id="dTitle"></div>
      <div class="clock" id="clock" aria-live="off">
        <svg viewBox="0 0 40 40" aria-hidden="true"><circle class="track" cx="20" cy="20" r="16"/><circle class="ring" cx="20" cy="20" r="16" pathLength="100"/></svg>
        <span id="clockText"></span>
      </div>
    </header>
    <ul class="d-players" id="players"></ul>
    <section class="d-board" id="board"></section>
    <div class="prompt d-prompt" id="prompt"><span class="master" aria-hidden="true">院</span><p class="line" id="promptLine"></p></div>
    <section class="d-tray" id="tray">
      <div class="d-tools" id="tools"></div>
      <div class="d-hand" id="hand"></div>
      <div class="d-stage" id="stage"></div>
    </section>
    <div class="banner d-banner" id="banner"><span class="b-main"></span><span class="b-sub"></span></div>
    <div class="ledger-wrap" id="ledger"></div>
  </main>`;
  $('#menuBtn').onclick = ctx.openMenu;
  $('#hand').addEventListener('click', (e) => {
    const el = e.target.closest('[data-card]');
    if (el && !el.disabled) onPickCard(el.dataset.card);
  });
  $('#board').addEventListener('click', (e) => {
    const card = e.target.closest('.d-card.aimable');
    if (card) return onPickTarget(Number(card.closest('.d-circle').dataset.circle), card.dataset.card);
    const circle = e.target.closest('.d-circle.pickable');
    if (circle) onPickCircle(Number(circle.dataset.circle));
  });
  $('#tools').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tool]');
    if (!b || b.disabled) return;
    onTool(b.dataset.tool, b.dataset.value);
  });
}

// ---------- 操作 ----------
const canAct = () => view && !anim.running && view.phase === 'choose' && view.players.find((p) => p.id === view.you)?.active;

function cardById(id) {
  return view.hand.find((c) => c.id === id);
}

function clearSel() {
  Object.assign(ui, { card: null, step: null, target: null });
}

function onPickCard(id) {
  if (!canAct()) return;
  if (ui.card === id) {
    clearSel();
    render();
    return;
  }
  const card = cardById(id);
  ui.card = id;
  ui.target = null;
  const kind = cardKind(card);
  ui.step = kind === 'spirit' || kind === 'terrain' ? 'circle' : card.type === 'scout' ? 'confirm' : 'target';
  sfx.pick();
  render();
}

function onPickTarget(circle, cardId) {
  if (!canAct() || ui.step !== 'target') return;
  ui.target = { circle, card: cardId };
  const type = cardById(ui.card).type;
  sfx.pick();
  if (type === 'banish') return submit({ target: ui.target });
  ui.step = 'dest';
  render();
}

function onPickCircle(circle) {
  if (!canAct()) return;
  if (ui.step === 'circle') return submit({ circle });
  if (ui.step === 'dest') return submit({ target: ui.target, dest: circle });
}

function onTool(tool, value) {
  if (tool === 'draw') {
    ui.draw = value;
    sfx.pick();
    // 決定済みなら、引く山だけ変えて出し直す
    if (view.myAction && canAct()) ctx.act({ type: 'cast', action: { ...view.myAction, draw: ui.draw } });
    else render();
  } else if (tool === 'void' && ui.step === 'dest') {
    submit({ target: ui.target, dest: 'void' });
  } else if (tool === 'scout' && ui.step === 'confirm') {
    submit({});
  } else if (tool === 'cancel') {
    clearSel();
    render();
  }
}

function submit(extra) {
  const action = { card: ui.card, draw: ui.draw, ...extra };
  clearSel();
  sfx.stamp();
  ctx.act({ type: 'cast', action });
}

// ---------- 状態の反映 ----------
function handleState(next) {
  const before = view;
  view = next;
  deadlineAt = next.deadlineIn != null ? performance.now() + next.deadlineIn : null;
  if (before && before.round !== next.round) {
    shown = null;
    clearSel();
  }
  if (ui.card && !next.hand.some((c) => c.id === ui.card)) clearSel();
  const res = next.resolution;
  if (res && res.seq > anim.seq) {
    anim.seq = res.seq;
    runResolution(res, shown ?? (before ? clone(before.circles) : clone(next.circles)));
    return;
  }
  if (anim.running) return;
  render();
}

function render() {
  const v = view;
  shown = clone(v.circles);
  renderTitle();
  renderPlayers();
  drawBoard(shown);
  renderTray();
  renderPrompt();
  renderLedger();
  if (v.phase === 'choose' && v.round !== shownRound) {
    shownRound = v.round;
    const ds = myDuels();
    const sub = ds.length === 1 ? `相手：${nameOf(oppIn(ds[0]))}` : `左：${nameOf(oppIn(ds[0]))} ／ 右：${nameOf(oppIn(ds[1]))}`;
    showBanner(`第${v.round}ラウンド`, sub);
    sfx.bell();
  }
  updateClock();
}

function renderTitle() {
  const v = view;
  const pips = Array.from({ length: v.rounds }, (_, i) => `<i class="${i < v.round ? 'lit' : ''}"></i>`).join('');
  $('#dTitle').innerHTML = `<span class="d-name">魔法陣の決闘</span><span class="d-trow"><span>第${v.round}ラウンド</span><span class="pips">${pips}</span><span class="turn">${v.phase === 'choose' ? `${v.turn}手目` : '集計'}</span></span>`;
}

function renderPlayers(owned = null) {
  const v = view;
  const list = $('#players');
  list.style.setProperty('--n', v.players.length);
  const ds = myDuels();
  const side = {};
  if (ds.length === 1) side[oppIn(ds[0])] = '相手';
  else if (ds.length === 2) {
    side[oppIn(ds[0])] = '左';
    side[oppIn(ds[1])] = side[oppIn(ds[1])] ? '左右' : '右';
  }
  list.innerHTML = v.players
    .map((p, i) => {
      let st = '';
      if (!anim.running && v.phase === 'choose') {
        st = !p.active ? '<span class="d-st idle">見送り</span>' : p.submitted ? '<span class="d-st ok">詠唱済</span>' : '<span class="d-st think"><i></i><i></i><i></i></span>';
      }
      return `
      <li class="d-pl${p.id === v.you ? ' me' : ''}${side[p.id] ? ' foe' : ''}" data-pid="${esc(p.id)}" style="--c:${SEAT_COLORS[i]}">
        <span class="avatar">${esc(initial(p.name))}</span>
        <span class="d-score">${p.score}<small>◆${owned ? owned[p.id] ?? 0 : p.owned}</small></span>
        <span class="pname">${esc(p.id === v.you ? 'あなた' : p.name)}</span>
        ${side[p.id] ? `<span class="d-side-tag">${side[p.id]}</span>` : ''}
        ${st}
      </li>`;
    })
    .join('');
}

// ---------- 盤面 ----------
function sideHtml(c, pid, { mine }) {
  const cards = c.sides[pid];
  const sel = ui.card ? cardById(ui.card) : null;
  const aimOpp = ui.step === 'target' && sel && (sel.type === 'banish' || sel.type === 'charm') && !mine && !c.decided;
  const aimMine = ui.step === 'target' && sel && sel.type === 'transfer' && mine && !c.decided;
  const pend = view.myAction;
  let html = cards
    .map((card) => {
      const targeted = pend?.target?.card === card.id;
      return spiritHtml(card, { cls: `${aimOpp || aimMine ? 'aimable' : ''}${targeted ? ' targeted' : ''}` });
    })
    .join('');
  // 決定済みの配置は、うっすら予定として見せる
  if (mine && pend && pend.circle === c.id && !anim.running) {
    const card = cardById(pend.card);
    if (card && cardKind(card) === 'spirit') html += spiritHtml(card, { cls: 'pending' });
  }
  if (mine && pend && pend.dest === c.id && !anim.running) html += '<div class="d-card pending ghost-slot"></div>';
  return html;
}

function circleHtml(c) {
  const me = view.you;
  const opp = c.a === me ? c.b : c.a;
  const sel = ui.card ? cardById(ui.card) : null;
  let pickable = false;
  if (sel && !anim.running && !c.decided) {
    const kind = cardKind(sel);
    if (ui.step === 'circle' && kind === 'spirit') pickable = c.sides[me].length < c.cap;
    if (ui.step === 'circle' && kind === 'terrain') pickable = !c[sel.type];
    if (ui.step === 'dest') pickable = c.sides[me].length < c.cap && !(sel.type === 'transfer' && ui.target?.circle === c.id);
  }
  const ownerCls = c.decided ? (c.owner === me ? ' won' : c.owner === opp ? ' lost' : ' drawn') : '';
  const full = (pid) => c.sides[pid].length >= c.cap;
  const form = (pid) => (!anim.running && full(pid) && view.circles[c.id]?.forms?.[pid] ? formationName(view.circles[c.id].forms[pid]) : '');
  const pend = view.myAction;
  const pendTerrain = pend && pend.circle === c.id && cardById(pend.card) && cardKind(cardById(pend.card)) === 'terrain';
  const oc = c.owner && c.owner !== 'draw' ? colorOf(c.owner) : 'transparent';
  return `
  <div class="d-circle${ownerCls}${pickable ? ' pickable' : ''}${c.fog ? ' fog' : ''}${c.expand ? ' expand' : ''}${!c.decided && full(opp) ? ' threat' : ''}" data-circle="${c.id}" data-cap="${c.cap}" style="--oc:${oc}">
    <div class="d-side opp">${sideHtml(c, opp, { mine: false })}</div>
    <div class="d-core">
      ${CIRCLE_GLYPH}
      ${c.fog ? `<span class="d-badge fog">${magicIcon('fog')}</span>` : ''}
      ${c.expand ? '<span class="d-badge expand">4</span>' : ''}
      ${pendTerrain ? '<span class="d-badge pend">予定</span>' : ''}
      ${c.decided && c.owner && c.owner !== 'draw' ? `<span class="d-seal" style="--c:${colorOf(c.owner)}">${esc(initial(nameOf(c.owner)))}</span>` : ''}
      ${c.decided && c.owner === 'draw' ? '<span class="d-seal draw">分</span>' : ''}
    </div>
    <div class="d-side me">${sideHtml(c, me, { mine: true })}</div>
    ${form(opp) ? `<span class="d-form top">${form(opp)}</span>` : ''}
    ${form(me) ? `<span class="d-form bottom">${form(me)}</span>` : ''}
  </div>`;
}

function drawBoard(circles) {
  const board = $('#board');
  board.innerHTML = myDuels()
    .map((d) => {
      const opp = oppIn(d);
      const mineOwned = d.circles.filter((id) => circles[id].owner === view.you).length;
      const theirOwned = d.circles.filter((id) => circles[id].owner === opp).length;
      return `
      <section class="d-duel" data-duel="${d.id}">
        <header class="d-head">
          <span class="d-vs"><span class="avatar mini" style="--c:${colorOf(opp)}">${esc(initial(nameOf(opp)))}</span>${esc(nameOf(opp))}</span>
          <span class="d-tally"><b style="--c:${colorOf(opp)}">${theirOwned}</b> − <b class="me">${mineOwned}</b></span>
        </header>
        <div class="d-row" style="--c:${d.circles.length}">${d.circles.map((id) => circleHtml(circles[id])).join('')}</div>
      </section>`;
    })
    .join('');
  layoutBoard();
}

function drawCircle(circles, id, hideCard = null) {
  const el = $(`.d-circle[data-circle="${id}"]`);
  if (!el) return null;
  el.outerHTML = circleHtml(circles[id]);
  const fresh = $(`.d-circle[data-circle="${id}"]`);
  if (hideCard) {
    const c = fresh.querySelector(`.d-card[data-card="${CSS.escape(hideCard)}"]`);
    if (c) c.style.visibility = 'hidden';
  }
  return fresh;
}

// 盤面の大きさに合わせて、カードを縦に重ねるか横に並べるかを決める
function layoutBoard() {
  const board = $('#board');
  const panels = $$('.d-duel');
  if (!panels.length || !board.clientHeight) return;
  const W = board.clientWidth;
  const H = board.clientHeight;
  const P = panels.length;
  const C = Math.max(...myDuels().map((d) => d.circles.length));
  const colW = (W - (C - 1) * 5) / C;
  const panelH = (H - (P - 1) * 8) / P - 26 - 8;
  const sideH = (panelH - 30) / 2;
  // 横並びは、数字が見える程度に重ねてよい
  const cwH = Math.min(colW / 2.3, sideH / 1.36);
  const chV = sideH / 1.76;
  const cwV = Math.min(colW - 6, chV / 1.36);
  const vertical = cwV > cwH * 1.08;
  const cw = Math.max(18, Math.floor(Math.min(vertical ? cwV : cwH, 76)));
  const ch = Math.round(cw * 1.36);
  board.dataset.stack = vertical ? 'v' : 'h';
  const set = (k, v) => board.style.setProperty(k, `${v}px`);
  set('--cw', cw);
  set('--ch', ch);
  set('--sideH', Math.max(ch, Math.floor(sideH)));
  set('--st3', Math.min(0.38 * ch, (sideH - ch) / 2));
  set('--st4', Math.min(0.38 * ch, (sideH - ch) / 3));
  set('--ov3', Math.min(3, (colW - 4 - 3 * cw) / 2));
  set('--ov4', Math.min(3, (colW - 4 - 4 * cw) / 3));
}

// ---------- 手札と道具 ----------
function renderTray() {
  const v = view;
  $('#tray').dataset.mode = 'hand';
  const usable = new Set(v.usable);
  const ok = canAct();
  const pend = v.myAction?.card;
  $('#hand').innerHTML = v.hand
    .map((c) =>
      handCardHtml(c, {
        tag: 'button',
        cls: `${ui.card === c.id ? 'chosen' : ''}${pend === c.id ? ' pending-hand' : ''}`,
        attrs: ok && usable.has(c.id) ? '' : 'disabled',
      }),
    )
    .join('');
  layoutHand();
  const magicCount = v.hand.filter((c) => c.kind === 'magic').length;
  const usingMagic = ui.card && cardById(ui.card)?.kind === 'magic';
  const magicOk = v.canDrawMagic && magicCount - (usingMagic ? 1 : 0) < 2;
  if (!magicOk && ui.draw === 'magic') ui.draw = 'spirit';
  const draw = v.myAction?.draw ?? ui.draw;
  let extra = '';
  if (ui.step === 'dest' && cardById(ui.card)?.type === 'transfer') extra = '<button class="d-tool warn" data-tool="void">精霊を消す</button>';
  if (ui.step === 'confirm') extra = `<button class="d-tool go" data-tool="scout">${MAGIC.scout.name}を使う</button>`;
  if (ui.card) extra += '<button class="d-tool" data-tool="cancel">やめる</button>';
  const sel = ui.card ? cardById(ui.card) : null;
  $('#tools').innerHTML = `
    <div class="d-draw" role="group" aria-label="次に引く山">
      <span class="d-draw-label">次に引く</span>
      <button class="d-tool${draw === 'spirit' ? ' on' : ''}" data-tool="draw" data-value="spirit" ${ok ? '' : 'disabled'}>精霊 <small>${v.deck.spirit}</small></button>
      <button class="d-tool${draw === 'magic' ? ' on' : ''}" data-tool="draw" data-value="magic" ${ok && magicOk ? '' : 'disabled'}>秘術 <small>${v.deck.magic}</small></button>
    </div>
    <div class="d-extra">${extra}</div>
    ${sel && sel.kind === 'magic' ? `<p class="d-help">${magicIcon(sel.type, 'd-hi')}<b>${MAGIC[sel.type].name}</b>：${MAGIC[sel.type].text}</p>` : ''}`;
}

function layoutHand() {
  const hand = $('#hand');
  if (!hand) return;
  const cards = [...hand.children];
  const n = cards.length;
  if (!n || !cards[0].offsetWidth) return;
  const widths = cards.map((c) => c.offsetWidth);
  const total = widths.reduce((a, b) => a + b, 0);
  const room = hand.clientWidth - 8;
  const step = n > 1 && total + (n - 1) * 6 > room ? (room - total) / (n - 1) : 6;
  hand.style.setProperty('--step', `${step}px`);
}

function renderPrompt() {
  const v = view;
  if (anim.running) return;
  if (v.phase !== 'choose') return setPrompt('');
  const me = v.players.find((p) => p.id === v.you);
  if (!me.active) return setPrompt('出せる札がない。この手番は見送りだ');
  const sel = ui.card ? cardById(ui.card) : null;
  if (!sel) return setPrompt(v.myAction ? '詠唱を受け付けた。全員がそろうまで変えてよい' : '精霊か秘術を1枚選びなさい', v.myAction ? '' : 'go');
  const t = sel.kind === 'spirit' ? 'spirit' : sel.type;
  const lines = {
    spirit: 'どの魔法陣に置く？ 光っている場所を選びなさい',
    rainbow: '虹の精霊を置く魔法陣を選びなさい',
    greater: '上位精霊を置く魔法陣を選びなさい',
    lesser: '小精霊を置く魔法陣を選びなさい',
    fog: '霧の結界をかける魔法陣を選びなさい',
    expand: '陣を広げる魔法陣を選びなさい',
    scout: '精霊の山から2枚引く。よいか？',
  };
  if (lines[t]) return setPrompt(lines[t], 'go');
  if (ui.step === 'target') {
    return setPrompt(t === 'transfer' ? '移す自分の精霊を選びなさい' : t === 'banish' ? '送還する相手の精霊を選びなさい' : '魅了する相手の精霊を選びなさい', 'go');
  }
  if (ui.step === 'dest') return setPrompt(t === 'transfer' ? '移す先の魔法陣を選ぶか、消しなさい' : '奪った精霊を置く魔法陣を選びなさい', 'go');
  return setPrompt('');
}

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

function showBanner(main, sub = '') {
  const b = $('#banner');
  b.querySelector('.b-main').textContent = main;
  b.querySelector('.b-sub').textContent = sub;
  b.classList.remove('show');
  void b.offsetWidth;
  b.classList.add('show');
}

// ---------- 解決の演出 ----------
function applyEvent(board, e, cardMap) {
  const card = (id) => cardMap.get(id);
  const side = (cid, pid) => board[cid].sides[pid];
  const drop = (cid, pid, id) => {
    const s = side(cid, pid);
    const i = s.findIndex((x) => x.id === id);
    if (i >= 0) s.splice(i, 1);
  };
  if (e.type === 'place') side(e.circle, e.pid).push(card(e.card));
  else if (e.type === 'terrain') {
    board[e.circle][e.effect] = true;
    if (e.effect === 'expand') board[e.circle].cap = 4;
  } else if (e.type === 'banish') drop(e.circle, e.victim, e.target);
  else if (e.type === 'charm') {
    drop(e.circle, e.victim, e.target);
    side(e.dest, e.pid).push(card(e.target));
  } else if (e.type === 'transfer') {
    drop(e.circle, e.pid, e.target);
    if (e.dest !== 'void') side(e.dest, e.pid).push(card(e.target));
  } else if (e.type === 'decide') {
    board[e.circle].decided = true;
    board[e.circle].owner = e.owner;
  }
}

function drawStage(actions) {
  $('#tray').dataset.mode = 'stage';
  $('#tools').innerHTML = '';
  $('#stage').innerHTML = actions
    .map(({ pid, card }) => {
      const face = cardKind(card) === 'spirit' ? spiritHtml(card) : pageHtml(card, { tag: 'div' });
      return `<div class="d-act" data-pid="${esc(pid)}" style="--c:${colorOf(pid)}"><div class="d-flip"><div class="d-back">${ICON.crown}</div><div class="d-front">${face}</div></div><span class="who">${esc(nameOf(pid))}</span></div>`;
    })
    .join('');
}

async function runResolution(res, start) {
  const token = ++anim.token;
  anim.running = true;
  const T = TIMING;
  const t0 = performance.now();
  const alive = () => token === anim.token && $('#board');
  const until = (ms) => sleep(t0 + ms - performance.now());
  const board = clone(start);
  const cardMap = new Map();
  for (const c of [...start, ...view.circles]) for (const pid of [c.a, c.b]) for (const card of c.sides[pid]) cardMap.set(card.id, card);
  for (const a of res.actions) cardMap.set(a.card.id, a.card);
  const owned = Object.fromEntries(view.players.map((p) => [p.id, board.filter((c) => c.owner === p.id).length]));

  renderTitle();
  renderPlayers(owned);
  drawBoard(board);
  setPrompt('詠唱、開始！');
  $('#ledger').innerHTML = '';
  drawStage(res.actions);
  await sleep(80);
  $$('#stage .d-flip').forEach((f, i) => setTimeout(() => f.classList.add('up'), reduceMotion.matches ? 0 : i * 70));
  sfx.flip();
  let budget = T.revealMs;
  await until(budget);

  const actEl = (pid) => $(`#stage .d-act[data-pid="${CSS.escape(pid)}"]`);
  const done = (pid) => actEl(pid)?.classList.add('done');
  for (const e of res.events) {
    if (!alive()) return;
    const mine = (id) => id !== 'void' && id != null && isMine(id);
    if (e.type === 'place') {
      budget += T.placeMs;
      applyEvent(board, e, cardMap);
      if (mine(e.circle)) {
        const src = actEl(e.pid)?.querySelector('.d-front > *');
        const el = drawCircle(board, e.circle, e.card);
        const dst = el?.querySelector(`.d-card[data-card="${CSS.escape(e.card)}"]`);
        if (src && dst) await fly(src, dst, T.placeMs * 0.8, { arc: 30 });
        if (dst) {
          dst.style.visibility = '';
          dst.classList.add('land');
        }
        sfx.seat();
      }
      done(e.pid);
    } else if (e.type === 'terrain') {
      budget += T.spellMs;
      applyEvent(board, e, cardMap);
      if (mine(e.circle)) {
        const src = actEl(e.pid)?.querySelector('.d-front > *');
        const core = $(`.d-circle[data-circle="${e.circle}"] .d-core`);
        if (src && core) await fly(src, core, T.spellMs * 0.4, { scale: 0.5, fade: true });
        const el = drawCircle(board, e.circle);
        el?.classList.add(`fx-${e.effect}`);
        sfx.curtain();
        setPrompt(`${nameOf(e.pid)}の${MAGIC[e.effect].name}！`, 'alert');
      }
      done(e.pid);
    } else if (e.type === 'banish' || e.type === 'charm' || e.type === 'transfer') {
      budget += T.spellMs;
      const visible = mine(e.circle) || mine(e.dest);
      if (visible) {
        setPrompt(`${nameOf(e.pid)}の${MAGIC[e.type].name}！`, 'alert');
        const target = $(`.d-circle[data-circle="${e.circle}"] .d-card[data-card="${CSS.escape(e.target)}"]`);
        target?.classList.add(`fx-${e.type}`);
        sfx[e.type === 'charm' ? 'jester' : 'swap']();
        await sleep(T.spellMs * 0.35);
        if (!alive()) return;
        applyEvent(board, e, cardMap);
        if (e.dest != null && e.dest !== 'void' && target && mine(e.dest)) {
          const el = drawCircle(board, e.dest, e.target);
          const dst = el?.querySelector(`.d-card[data-card="${CSS.escape(e.target)}"]`);
          if (dst) await fly(target, dst, T.spellMs * 0.4, { arc: 40 });
          if (dst) dst.style.visibility = '';
        }
        if (mine(e.circle)) drawCircle(board, e.circle);
      } else applyEvent(board, e, cardMap);
      done(e.pid);
    } else if (e.type === 'scout') {
      budget += T.spellMs;
      const chip = $(`.d-pl[data-pid="${CSS.escape(e.pid)}"]`);
      if (chip) floatText(chip, `+${e.count}枚`, 'good');
      sfx.pick();
      done(e.pid);
    } else if (e.type === 'fizzle') {
      budget += 200;
      const el = actEl(e.pid);
      el?.classList.add('fizzle');
    } else if (e.type === 'decide') {
      budget += T.decideMs;
      applyEvent(board, e, cardMap);
      if (e.owner && e.owner !== 'draw') owned[e.owner] = (owned[e.owner] ?? 0) + 1;
      if (mine(e.circle)) {
        const el = drawCircle(board, e.circle);
        el?.classList.add('fx-decide');
        const forms = e.result?.forms ?? {};
        const won = e.owner === view.you;
        const label = Object.entries(forms).filter(([, f]) => f).map(([pid, f]) => `${pid === view.you ? 'あなた' : nameOf(pid)}：${formationName(f)}`).join(' ／ ');
        setPrompt(
          e.owner === 'draw'
            ? '引き分け。この魔法陣は誰のものでもない'
            : `${won ? 'あなた' : nameOf(e.owner)}が魔法陣を制した${e.result?.how === 'proof' ? '（逆転の目なし）' : ''}。${label}`,
          won ? 'go' : 'alert',
        );
        if (won) sfx.coins();
        else sfx.gong();
        // 決闘の勝敗数も更新
        drawHeads(board);
      }
      renderPlayers(owned);
    }
    await until(budget);
  }
  await until(budget + 400);
  if (!alive()) return;
  anim.running = false;
  render();
}

function drawHeads(board) {
  for (const d of myDuels()) {
    const el = $(`.d-duel[data-duel="${d.id}"] .d-tally`);
    if (!el) continue;
    const opp = oppIn(d);
    el.innerHTML = `<b style="--c:${colorOf(opp)}">${d.circles.filter((id) => board[id].owner === opp).length}</b> − <b class="me">${d.circles.filter((id) => board[id].owner === view.you).length}</b>`;
  }
}

// ---------- ラウンドの結果・大会の結果 ----------
function renderLedger() {
  const v = view;
  const wrap = $('#ledger');
  if (v.phase !== 'roundEnd' && v.phase !== 'gameEnd') {
    wrap.innerHTML = '';
    ledgerFor = null;
    return;
  }
  const key = `${v.phase}-${v.round}`;
  if (ledgerFor === key) return;
  ledgerFor = key;
  const final = v.phase === 'gameEnd';
  const rr = v.roundResult;
  const idx = Object.fromEntries(v.players.map((p, i) => [p.id, i]));
  if (final) sfx.fanfare();
  const rows = final
    ? v.ranking.map((r) => `
      <li class="${r.place === 1 ? 'top' : ''}${r.id === v.you ? ' me' : ''}" style="--c:${SEAT_COLORS[idx[r.id]]}">
        <span class="place">${r.place}</span>
        <span class="avatar">${esc(initial(r.name))}</span>
        <span class="lname">${esc(nameOf(r.id))}</span>
        <span class="d-hist">${r.roundScores.map((s) => `<i>${s}</i>`).join('')}</span>
        <span class="ltotal">${r.score}</span>
      </li>`).join('')
    : [...v.players]
        .sort((a, b) => rr.per[b.id].points - rr.per[a.id].points)
        .map((p) => {
          const r = rr.per[p.id];
          const notes = [`魔法陣 ${r.circles}`, r.sweeps ? `制圧 +${r.sweeps}` : '', r.bonus ? `即勝 +${r.bonus}` : ''].filter(Boolean).join('・');
          return `
          <li class="${p.id === v.you ? 'me' : ''}" style="--c:${SEAT_COLORS[idx[p.id]]}">
            <span class="avatar">${esc(initial(p.name))}</span>
            <span class="lname">${esc(nameOf(p.id))}<small>${notes}</small></span>
            <span class="d-pts">+${r.points}</span>
            <span class="ltotal">${p.score}</span>
          </li>`;
        }).join('');
  const winners = v.ranking.filter((r) => r.place === 1).map((r) => nameOf(r.id));
  wrap.innerHTML = `
  <section class="ledger d-ledger${final ? ' final' : ''}" role="dialog" aria-label="${final ? '大会の結果' : `第${v.round}ラウンドの結果`}">
    ${final ? `<div class="ledger-crown">${ICON.crown}</div>` : ''}
    <h2>${final ? `${esc(winners.join('と'))}の勝利` : `第${v.round}ラウンド 終了`}</h2>
    <p class="ledger-sub">${final ? '最も多くの魔法陣を制した者が、天上の王冠に近づいた' : rr.instant ? `${esc(nameOf(rr.instant))}が4つ、または隣り合う3つを制して即勝利` : '魔法陣1つで1点、決闘の陣を全て制すると+1点'}</p>
    <ol class="ledger-list d-list">${rows}</ol>
    <div class="ledger-foot">
      ${final
        ? v.isHost
          ? '<button class="btn ghost" id="endLeave">退出</button><button class="btn" id="again">もう一度遊ぶ</button>'
          : '<button class="btn ghost" id="endLeave">退出</button><span class="wait">ホストの合図を待っています</span>'
        : `<span class="wait js-next"></span>`}
    </div>
  </section>`;
  $('#again')?.addEventListener('click', () => ctx.act({ type: 'restart' }));
  $('#endLeave')?.addEventListener('click', ctx.askLeave);
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
  const total = view.phase === 'choose' ? TIMING.chooseMs : TIMING.roundBreakMs;
  const left = Math.max(0, deadlineAt - performance.now());
  const secs = Math.ceil(left / 1000);
  text.textContent = secs;
  ring.style.strokeDashoffset = 100 - Math.min(100, (left / total) * 100);
  const deciding = canAct() && !view.myAction;
  clock.classList.toggle('low', deciding && secs <= 5);
  if (next) next.textContent = `次のラウンドまで ${secs}秒`;
  if (deciding && secs <= 5 && secs > 0 && lastTick !== secs) {
    lastTick = secs;
    sfx.tick();
  }
}
