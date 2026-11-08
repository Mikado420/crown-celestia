// 毒杯の晩餐会：対局画面と演出
import { TIMING } from './mode.js';
import { SLOT_NAMES, PERSONS, JESTER } from './game.js';
import { esc, ICON, SEAT_COLORS, initial, sleep, reduceMotion, fly, floatText, svg, PATHS } from '../../ui.js';
import { sfx } from '../../sfx.js';

let ctx = null;
let view = null;
let prev = null;
let deadlineAt = null;
let deadlineTotal = 1;
let lastTick = null;
let shownCase = 0;
let ledgerFor = null;
let clockTimer = null;
const ui = { mode: 'look', pick: null, stake: 1 }; // 自分の操作中の選択
const anim = { running: false, token: 0, resultSeq: 0 };

const $ = (sel, root = ctx.app) => root.querySelector(sel);
const $$ = (sel, root = ctx.app) => [...root.querySelectorAll(sel)];
const nameOf = (pid) => (pid === view?.you ? 'あなた' : view?.players.find((p) => p.id === pid)?.name ?? '???');
const sama = (pid) => (pid === view?.you ? 'あなた' : `${nameOf(pid)}様`);
const colorOf = (pid) => SEAT_COLORS[Math.max(0, view.players.findIndex((p) => p.id === pid))];

// 人物の肖像（数字は怪しさ）
const JESTER_HAT = '<path d="M4 15c1-5 3-8 8-9 5 1 7 4 8 9"/><path d="M12 6L8 2.5M12 6l4-3.5M4 15l-1.5-3M20 15l1.5-3"/><circle cx="8" cy="2.5" r="1"/><circle cx="16" cy="2.5" r="1"/><path d="M5 15h14v2.5H5z"/><circle cx="9.5" cy="19.5" r=".8"/><circle cx="14.5" cy="19.5" r=".8"/><path d="M10 21.5c1.3.8 2.7.8 4 0"/>';
const BUST = '<circle cx="12" cy="8" r="4"/><path d="M4 21c.5-4.5 3.8-7 8-7s7.5 2.5 8 7"/>';

function faceHtml(chip, { small = false } = {}) {
  if (chip === JESTER) {
    return `<div class="g-face jester${small ? ' small' : ''}">${svg(JESTER_HAT, 'g-icon')}<span class="g-pname">${PERSONS[0]}</span><span class="g-tag">逆転</span></div>`;
  }
  return `<div class="g-face s${chip}${small ? ' small' : ''}">${svg(BUST, 'g-icon')}<span class="g-num">${chip}</span><span class="g-pname">${PERSONS[chip]}</span></div>`;
}

const VEIL = `<div class="g-veil" aria-hidden="true"><span>?</span></div>`;

export const groveScreen = {
  mount(c) {
    ctx = c;
    view = null;
    prev = null;
    deadlineAt = null;
    lastTick = null;
    shownCase = 0;
    ledgerFor = null;
    anim.token++;
    anim.running = false;
    anim.resultSeq = 0;
    mount();
    clockTimer = setInterval(updateClock, 200);
  },
  onState: (v) => handleState(v),
  unmount() {
    anim.token++;
    anim.running = false;
    clearInterval(clockTimer);
    sfx.ambience(false);
  },
};

function mount() {
  document.body.dataset.screen = 'game';
  sfx.ambience(true);
  ctx.app.innerHTML = `
  <main class="game grove">
    <header class="bar">
      <button class="icon-btn" id="menuBtn" aria-label="メニュー">${ICON.menu}</button>
      <div class="g-title" id="gTitle"></div>
      <div class="clock" id="clock" aria-live="off">
        <svg viewBox="0 0 40 40" aria-hidden="true"><circle class="track" cx="20" cy="20" r="16"/><circle class="ring" cx="20" cy="20" r="16" pathLength="100"/></svg>
        <span id="clockText"></span>
      </div>
    </header>
    <ul class="g-guests" id="guests"></ul>
    <section class="g-hall">
      <div class="g-chalice" aria-hidden="true">${ICON.goblet}</div>
      <div class="g-suspects" id="suspects">
        ${SLOT_NAMES.map((name, i) => `
          <div class="g-frame" data-slot="${i}" aria-label="${name}">
            <div class="g-portrait"><div class="g-inner"></div><span class="g-mark"></span><span class="g-stamp">犯人</span></div>
            <span class="g-plate">${name}</span>
            <div class="g-seals"></div>
          </div>`).join('')}
      </div>
    </section>
    <div class="prompt g-prompt" id="prompt"><span class="master" aria-hidden="true">執</span><p class="line" id="promptLine"></p></div>
    <section class="g-desk" id="desk">
      <div class="g-controls" id="controls"></div>
      <div class="g-notes">
        <div class="g-memo" id="memo"></div>
        <ol class="g-record" id="record"></ol>
      </div>
    </section>
    <div class="banner g-banner" id="banner"><span class="b-main"></span><span class="b-sub"></span></div>
    <div class="ledger-wrap" id="ledger"></div>
  </main>`;
  $('#menuBtn').onclick = ctx.openMenu;
  $('#suspects').addEventListener('click', (e) => {
    const f = e.target.closest('.g-frame.pickable');
    if (f) onPickSlot(Number(f.dataset.slot));
  });
  $('#controls').addEventListener('click', (e) => {
    const b = e.target.closest('[data-do]');
    if (!b || b.disabled) return;
    onControl(b.dataset.do, b.dataset.value);
  });
}

// ---------- 操作 ----------
function myTurn(phase) {
  return view && !anim.running && view.phase === phase && view.current === view.you;
}

function onPickSlot(slot) {
  if (myTurn('act')) {
    if (ui.mode === 'look' && slot === view.blockedSlot) return;
    sfx.pick();
    lockInput(); // ホストの場合は act の中で次の画面が描かれるので、先にロックする
    ctx.act({ type: 'investigate', action: ui.mode, slot });
  } else if (myTurn('testify') || (view.phase === 'accuse' && !anim.running)) {
    ui.pick = slot;
    sfx.pick();
    render();
  }
}

function onControl(what, value) {
  if (what === 'mode' && myTurn('act')) {
    ui.mode = value;
    sfx.pick();
    render();
  } else if (what === 'claim' && myTurn('testify') && ui.pick != null) {
    sfx.stamp();
    const slot = ui.pick;
    ui.pick = null;
    lockInput();
    ctx.act({ type: 'testify', slot, claim: value });
  } else if (what === 'stake' && view.phase === 'accuse') {
    ui.stake = Number(value);
    sfx.pick();
    render();
  } else if (what === 'accuse' && view.phase === 'accuse' && ui.pick != null) {
    sfx.stamp();
    ctx.act({ type: 'accuse', slot: ui.pick, stake: ui.stake });
  }
}

// 送信してから返事が来るまで、二度押しを防ぐ
function lockInput() {
  $$('.g-frame').forEach((f) => f.classList.remove('pickable'));
  $$('#controls button').forEach((b) => (b.disabled = true));
}

// ---------- 状態の反映 ----------
function handleState(next) {
  prev = view;
  view = next;
  deadlineAt = next.deadlineIn != null ? performance.now() + next.deadlineIn : null;
  const big = next.players.length >= 5;
  deadlineTotal =
    next.phase === 'act' ? (big ? TIMING.bigActMs : TIMING.actMs)
    : next.phase === 'testify' ? (big ? TIMING.bigTestifyMs : TIMING.testifyMs)
    : next.phase === 'accuse' ? TIMING.accuseMs
    : TIMING.caseBreakMs;
  if (prev && prev.caseNo !== next.caseNo) {
    ui.pick = null;
    ui.mode = 'look';
    ui.stake = 1;
  }
  if (prev && prev.phase !== next.phase) {
    if (next.phase === 'testify' || next.phase === 'accuse') ui.pick = null;
    if (next.phase === 'act') ui.mode = 'look';
  }
  const res = next.result;
  if (res && res.seq > anim.resultSeq && (next.phase === 'caseEnd' || next.phase === 'gameEnd')) {
    anim.resultSeq = res.seq;
    runReveal(res);
    return;
  }
  if (anim.running) return;
  render();
  animateDeltas();
}

function render() {
  const v = view;
  renderTitle();
  renderGuests();
  renderFrames();
  renderControls();
  renderNotes();
  renderPrompt();
  renderLedger();
  if (v.phase === 'act' && v.caseNo !== shownCase) {
    shownCase = v.caseNo;
    showBanner(`第${v.caseNo}の事件`, '王の杯に毒が盛られた。犯人は3人の中に');
    sfx.bell();
  }
  updateClock();
}

function renderTitle() {
  const v = view;
  const pips = Array.from({ length: v.cases }, (_, i) => `<i class="${i < v.caseNo ? 'lit' : ''}"></i>`).join('');
  const turn = v.phase === 'act' || v.phase === 'testify' ? `${Math.min(v.step + 1, v.steps)}／${v.steps}手` : v.phase === 'accuse' ? '告発' : '顛末';
  $('#gTitle').innerHTML = `<span class="g-name">毒杯の晩餐会</span><span class="g-row"><span>第${v.caseNo}の事件</span><span class="pips" aria-label="全${v.cases}件">${pips}</span><span class="turn">${turn}</span></span>`;
}

function renderGuests(scores = null) {
  const v = view;
  const list = $('#guests');
  list.style.setProperty('--n', v.players.length);
  list.innerHTML = v.players
    .map((p, i) => {
      let state = '';
      if (!anim.running) {
        if (v.current === p.id) state = `<span class="g-state now">${v.phase === 'act' ? '調査中' : '証言中'}</span>`;
        else if (v.phase === 'accuse') state = p.accused ? '<span class="g-state done">告発済</span>' : '<span class="g-state">思案中</span>';
      }
      return `
      <li class="g-guest${p.id === v.you ? ' me' : ''}${v.current === p.id && !anim.running ? ' turn' : ''}" data-pid="${esc(p.id)}" style="--c:${SEAT_COLORS[i]}">
        <span class="avatar">${esc(initial(p.name))}${p.swapped ? `<span class="g-swapped" title="すり替え済み">${ICON.swap}</span>` : ''}</span>
        <span class="g-score">${scores ? scores[p.id] : p.score}</span>
        <span class="pname">${esc(p.id === v.you ? 'あなた' : p.name)}</span>
        ${state}
      </li>`;
    })
    .join('');
}

// 席ごとの証言とすり替えの印
function sealsFor(slot) {
  return view.history
    .filter((h) => h.testimony && h.testimony.slot === slot)
    .map((h) => `<span class="g-seal ${h.testimony.claim}" style="--c:${colorOf(h.pid)}" title="${esc(nameOf(h.pid))}「${h.testimony.claim === 'black' ? 'クロ' : 'シロ'}」"><b>${esc(initial(nameOf(h.pid)))}</b>${h.testimony.claim === 'black' ? 'クロ' : 'シロ'}</span>`)
    .join('');
}

function swappersOf(slot) {
  return view.history.filter((h) => h.action === 'swap' && h.slot === slot).map((h) => h.pid);
}

function renderFrames({ reveal = null } = {}) {
  const v = view;
  const pickAct = myTurn('act');
  const pickTestify = myTurn('testify');
  const pickAccuse = v.phase === 'accuse' && !anim.running;
  v.known.forEach((k, i) => {
    const f = $(`.g-frame[data-slot="${i}"]`);
    const inner = f.querySelector('.g-inner');
    const mark = f.querySelector('.g-mark');
    let face = VEIL;
    let markText = '';
    if (reveal) {
      face = reveal[i] != null ? faceHtml(reveal[i]) + VEIL : VEIL;
    } else if (k && !k.stale) {
      face = faceHtml(k.chip);
      markText = k.how === 'swap' ? 'あなたが入れた' : 'あなたが見た';
    } else if (k && k.stale) {
      face = `${VEIL}<div class="g-old">${faceHtml(k.chip, { small: true })}<span>入れ替わった</span></div>`;
    }
    inner.innerHTML = face;
    const swappers = swappersOf(i);
    mark.innerHTML = [
      markText ? `<span class="g-know">${markText}</span>` : '',
      swappers.length ? `<span class="g-swapmark">${ICON.swap}${swappers.map((p) => `<b style="--c:${colorOf(p)}">${esc(initial(nameOf(p)))}</b>`).join('')}</span>` : '',
    ].join('');
    f.querySelector('.g-seals').innerHTML = sealsFor(i);
    const blocked = pickAct && ui.mode === 'look' && v.blockedSlot === i;
    f.classList.toggle('blocked', blocked);
    f.classList.toggle('pickable', !reveal && (((pickAct && !blocked) || pickTestify || pickAccuse)));
    f.classList.toggle('chosen', !reveal && (pickTestify || pickAccuse) && ui.pick === i);
    const mine = v.phase === 'accuse' && v.myAccusation?.slot === i;
    f.classList.toggle('accused', !reveal && mine);
    f.classList.toggle('swapmode', !reveal && pickAct && ui.mode === 'swap');
    f.querySelector('.g-portrait').dataset.lock = blocked ? '直前の証言で調べられない' : '';
  });
}

function renderControls() {
  const v = view;
  const box = $('#controls');
  if (anim.running) return;
  if (myTurn('act')) {
    box.innerHTML = `
      <div class="g-seg" role="group" aria-label="行動">
        <button class="g-opt${ui.mode === 'look' ? ' on' : ''}" data-do="mode" data-value="look">${ICON.eye}<span><b>調べる</b><small>1人をこっそり見る</small></span></button>
        <button class="g-opt${ui.mode === 'swap' ? ' on' : ''}" data-do="mode" data-value="swap" ${v.canSwap ? '' : 'disabled'}>${ICON.swap}<span><b>すり替える</b><small>${v.canSwap ? '手持ちと入れ替える' : 'この事件では済み'}</small></span></button>
      </div>`;
  } else if (myTurn('testify')) {
    const look = v.lastLook;
    const ready = ui.pick != null;
    box.innerHTML = `
      ${look ? `<p class="g-result">${SLOT_NAMES[look.slot]}は <b>${look.chip === JESTER ? '道化師' : `${look.chip}・${PERSONS[look.chip]}`}</b> だった</p>` : ''}
      <div class="g-stamps">
        <button class="g-stampbtn black" data-do="claim" data-value="black" ${ready ? '' : 'disabled'}><span>クロ</span><small>${ready ? `${SLOT_NAMES[ui.pick]}が犯人` : '席を選んでから'}</small></button>
        <button class="g-stampbtn white" data-do="claim" data-value="white" ${ready ? '' : 'disabled'}><span>シロ</span><small>${ready ? `${SLOT_NAMES[ui.pick]}は無実` : '席を選んでから'}</small></button>
      </div>`;
  } else if (v.phase === 'accuse') {
    const mine = v.myAccusation;
    const ready = ui.pick != null;
    box.innerHTML = `
      <div class="g-seg small" role="group" aria-label="賭け方">
        <button class="g-opt${ui.stake === 1 ? ' on' : ''}" data-do="stake" data-value="1"><span><b>ふつう</b><small>当たり×1・外れ−1</small></span></button>
        <button class="g-opt${ui.stake === 2 ? ' on' : ''}" data-do="stake" data-value="2"><span><b>強気</b><small>当たり×2・外れ−2</small></span></button>
      </div>
      <button class="btn wide g-accuse" data-do="accuse" ${ready ? '' : 'disabled'}>${ready ? `${SLOT_NAMES[ui.pick]}を告発する` : '犯人と思う席を選ぶ'}</button>
      ${mine ? `<p class="g-result small">告発状：${SLOT_NAMES[mine.slot]}・${mine.stake === 2 ? '強気' : 'ふつう'}（全員そろうまで変更できます）</p>` : ''}`;
  } else {
    box.innerHTML = '';
  }
}

function renderNotes() {
  const v = view;
  const hand = v.hand != null ? faceHtml(v.hand, { small: true }) : '<div class="g-face small empty"><span class="g-pname">すり替えに使った</span></div>';
  const out = v.seenOut.length ? v.seenOut.map((c) => `<span class="g-chipname">${c === JESTER ? '道化師' : c}</span>`).join('') : '<span class="g-none">なし</span>';
  $('#memo').innerHTML = `
    <div class="g-memo-item"><span class="g-memo-label">手持ち</span>${hand}</div>
    <div class="g-memo-out"><span class="g-memo-label">退場した人物</span><span class="g-outs">${out}</span></div>`;
  const lines = [];
  for (const h of v.history) {
    const who = `<b style="--c:${colorOf(h.pid)}">${esc(nameOf(h.pid))}</b>`;
    const did = h.action === 'swap' ? `${SLOT_NAMES[h.slot]}を<em class="sw">すり替えた</em>` : `${SLOT_NAMES[h.slot]}を調べた`;
    const said = h.testimony ? `「${SLOT_NAMES[h.testimony.slot]}は<em class="${h.testimony.claim}">${h.testimony.claim === 'black' ? 'クロ' : 'シロ'}</em>」` : '<span class="g-wait">証言を考え中…</span>';
    lines.push(`<li>${who}：${did} ${said}</li>`);
  }
  const rec = $('#record');
  rec.innerHTML = lines.length ? lines.reverse().join('') : '<li class="g-none">まだ誰も調べていません</li>';
}

function renderPrompt() {
  const v = view;
  if (anim.running) return;
  if (v.phase === 'act') {
    if (v.current === v.you) {
      setPrompt(ui.mode === 'swap' ? 'すり替える席をお選びください。抜いた人物は誰も見ないまま退場します' : 'あなたの番でございます。調べる方の肖像をお選びください', 'go');
    } else setPrompt(`${sama(v.current)}が調べております`);
  } else if (v.phase === 'testify') {
    if (v.current === v.you) setPrompt('では証言を。席を選び、クロかシロかを。嘘でも構いません', 'go');
    else setPrompt(`${sama(v.current)}が証言を考えております`);
  } else if (v.phase === 'accuse') {
    setPrompt(v.myAccusation ? '告発状を受け取りました。全員そろうまで書き直せます' : '告発の時間です。犯人と思う方に告発状を', v.myAccusation ? '' : 'go');
  } else {
    setPrompt('');
  }
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

// ---------- 行動の演出（前の状態との差分） ----------
function animateDeltas() {
  if (!prev || prev.caseNo !== view.caseNo) return;
  const before = prev.history;
  view.history.forEach((h, i) => {
    const old = before[i];
    const frame = $(`.g-frame[data-slot="${h.slot}"]`);
    if (!old) {
      if (h.action === 'swap') {
        frame.classList.remove('do-swap');
        void frame.offsetWidth;
        frame.classList.add('do-swap');
        sfx.swap();
        if (h.pid !== view.you) setPrompt(`おや、${sama(h.pid)}が${SLOT_NAMES[h.slot]}の人物をすり替えました`, 'alert');
      } else if (h.pid === view.you) {
        frame.classList.add('do-unveil');
        sfx.curtain();
      } else {
        frame.classList.remove('do-look');
        void frame.offsetWidth;
        frame.classList.add('do-look');
        sfx.pick();
      }
    }
    if (h.testimony && !old?.testimony) {
      const seals = $$(`.g-frame[data-slot="${h.testimony.slot}"] .g-seal`);
      seals.at(-1)?.classList.add('drop');
      if (h.pid !== view.you) {
        sfx.stamp();
        setPrompt(`${sama(h.pid)}の証言：「${SLOT_NAMES[h.testimony.slot]}は${h.testimony.claim === 'black' ? 'クロ' : 'シロ'}」`);
      }
    }
  });
  if (prev.phase !== 'accuse' && view.phase === 'accuse') {
    showBanner('告発の時', '犯人と思う席に告発状を');
    sfx.gong();
  }
}

// ---------- 真相公開の演出 ----------
async function runReveal(res) {
  const token = ++anim.token;
  anim.running = true;
  const start = performance.now();
  const alive = () => token === anim.token && $('.g-hall');
  const until = (ms) => sleep(start + ms - performance.now());
  const scale = TIMING.revealMs / 6500;
  const at = (ms) => until(ms * scale);

  $('#ledger').innerHTML = '';
  const before = Object.fromEntries(view.players.map((p) => [p.id, p.score - (res.entries.find((e) => e.pid === p.id)?.total ?? 0)]));
  renderTitle();
  renderGuests(before);
  renderFrames({ reveal: [null, null, null] });
  renderNotes();
  $('#controls').innerHTML = '';
  $$('.g-frame').forEach((f) => f.classList.remove('pickable', 'chosen', 'accused', 'culprit', 'dim', 'jester-flash'));
  setPrompt('告発状が出そろいました。では、真相を');

  // 告発状が各席へ飛ぶ
  for (const [k, e] of res.entries.entries()) {
    const from = $(`.g-guest[data-pid="${CSS.escape(e.pid)}"] .avatar`);
    const seals = $(`.g-frame[data-slot="${e.slot}"] .g-seals`);
    const note = document.createElement('span');
    note.className = `g-note${e.stake === 2 ? ' double' : ''}`;
    note.style.setProperty('--c', colorOf(e.pid));
    note.textContent = initial(nameOf(e.pid));
    seals.appendChild(note);
    if (from) {
      const ghost = from.cloneNode(true);
      ghost.className = 'g-note flying';
      ghost.style.setProperty('--c', colorOf(e.pid));
      ghost.textContent = initial(nameOf(e.pid));
      const r = from.getBoundingClientRect();
      Object.assign(ghost.style, { position: 'fixed', left: `${r.left}px`, top: `${r.top}px` });
      document.body.appendChild(ghost);
      fly(ghost, note, 520, { arc: 40 }).then(() => {
        ghost.remove();
        note.classList.add('in');
      });
      note.style.visibility = 'hidden';
      setTimeout(() => (note.style.visibility = ''), 540);
    }
    sfx.pick();
    await sleep(140 * scale);
    if (!alive()) return;
    void k;
  }
  // 状況のまま、いったん全員の素顔を伏せてから順に幕を上げる
  await at(1500);
  if (!alive()) return;
  renderFrames({ reveal: res.suspects });
  for (let i = 0; i < 3; i++) {
    $(`.g-frame[data-slot="${i}"]`).classList.add('do-unveil');
    sfx.curtain();
    await at(1700 + i * 550);
    if (!alive()) return;
  }
  // 道化師がいれば逆転
  await at(3400);
  if (res.jester) {
    const j = res.suspects.indexOf(JESTER);
    $(`.g-frame[data-slot="${j}"]`).classList.add('jester-flash');
    showBanner('道化師が紛れていた！', '疑いは逆転し、一番怪しくない者が犯人に');
    sfx.jester();
    setPrompt('なんと、道化師が紛れておりました。疑いは逆転いたします', 'alert');
  }
  await at(res.jester ? 4500 : 3700);
  if (!alive()) return;
  // 犯人
  $$('.g-frame').forEach((f, i) => f.classList.toggle(i === res.culprit ? 'culprit' : 'dim', true));
  sfx.gong();
  const culprit = res.suspects[res.culprit];
  setPrompt(`犯人は${SLOT_NAMES[res.culprit]}、${PERSONS[culprit]}でございました`, 'alert');
  await at(res.jester ? 5100 : 4500);
  if (!alive()) return;
  // 得点
  const scores = { ...before };
  for (const e of res.entries) {
    scores[e.pid] += e.total;
  }
  renderGuests(scores);
  for (const e of res.entries) {
    const g = $(`.g-guest[data-pid="${CSS.escape(e.pid)}"]`);
    if (!g) continue;
    g.classList.add(e.total >= 0 ? 'gain' : 'hit');
    floatText(g, `${e.total >= 0 ? '+' : ''}${e.total}`, e.total >= 0 ? 'good' : '');
  }
  sfx.coins();
  await at(6400);
  if (!alive()) return;
  anim.running = false;
  render();
}

// ---------- 事件の顛末・大会の結果 ----------
function renderLedger() {
  const v = view;
  const wrap = $('#ledger');
  if (v.phase !== 'caseEnd' && v.phase !== 'gameEnd') {
    wrap.innerHTML = '';
    ledgerFor = null;
    return;
  }
  const key = `${v.phase}-${v.caseNo}`;
  if (ledgerFor === key) return;
  ledgerFor = key;
  const final = v.phase === 'gameEnd';
  const res = v.result;
  const idx = Object.fromEntries(v.players.map((p, i) => [p.id, i]));
  const culprit = res.suspects[res.culprit];
  if (final) sfx.fanfare();
  const caseRows = res.entries
    .map((e) => {
      const p = v.players.find((x) => x.id === e.pid);
      return `
      <li class="${e.correct ? 'ok' : 'ng'}${e.pid === v.you ? ' me' : ''}" style="--c:${SEAT_COLORS[idx[e.pid]]}">
        <span class="avatar">${esc(initial(p.name))}</span>
        <span class="lname">${esc(nameOf(e.pid))}</span>
        <span class="g-acc">${e.correct ? '的中' : '外れ'}<small>${SLOT_NAMES[e.slot]}・${e.stake === 2 ? '強気' : 'ふつう'}</small></span>
        <span class="g-pts">${e.accusePts >= 0 ? '+' : ''}${e.accusePts}<small>${e.testimonyPts ? `クロ的中 +${e.testimonyPts}` : '証言 +0'}${e.lies ? `（嘘${e.lies}）` : ''}</small></span>
        <span class="ltotal">${p.score}</span>
      </li>`;
    })
    .join('');
  const finalRows = v.ranking
    .map((r) => `
      <li class="${r.place === 1 ? 'top' : ''}${r.id === v.you ? ' me' : ''}" style="--c:${SEAT_COLORS[idx[r.id]]}">
        <span class="place">${r.place}</span>
        <span class="avatar">${esc(initial(r.name))}</span>
        <span class="lname">${esc(nameOf(r.id))}</span>
        <span class="g-hist">${r.caseScores.map((s) => `<i class="${s >= 0 ? 'p' : 'm'}">${s >= 0 ? '+' : ''}${s}</i>`).join('')}</span>
        <span class="ltotal">${r.score}</span>
      </li>`)
    .join('');
  const winners = v.ranking.filter((r) => r.place === 1).map((r) => nameOf(r.id));
  wrap.innerHTML = `
  <section class="ledger g-scroll${final ? ' final' : ''}" role="dialog" aria-label="${final ? '大会の結果' : `第${v.caseNo}の事件の顛末`}">
    ${final ? `<div class="ledger-crown">${ICON.crown}</div>` : ''}
    <h2>${final ? `${esc(winners.join('と'))}の勝利` : `第${v.caseNo}の事件・顛末`}</h2>
    <p class="ledger-sub">${final ? '最も多くの真相を見抜いた者が、天上の王冠に近づいた' : `犯人は${SLOT_NAMES[res.culprit]}の${PERSONS[culprit]}${res.jester ? '（道化師による逆転）' : ''}`}</p>
    ${final ? '' : `<div class="g-truth">${res.suspects.map((c, i) => `<div class="${i === res.culprit ? 'is-culprit' : ''}">${faceHtml(c, { small: true })}<span>${SLOT_NAMES[i]}</span></div>`).join('')}</div>`}
    <ol class="ledger-list g-list">${final ? finalRows : caseRows}</ol>
    <div class="ledger-foot">
      ${final
        ? v.isHost
          ? '<button class="btn ghost" id="endLeave">退出</button><button class="btn" id="again">もう一度遊ぶ</button>'
          : '<button class="btn ghost" id="endLeave">退出</button><span class="wait">ホストの合図を待っています</span>'
        : '<span class="wait js-next"></span>'}
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
  const left = Math.max(0, deadlineAt - performance.now());
  const secs = Math.ceil(left / 1000);
  text.textContent = secs;
  ring.style.strokeDashoffset = 100 - Math.min(100, (left / deadlineTotal) * 100);
  const deciding = myTurn('act') || myTurn('testify') || (view.phase === 'accuse' && !view.myAccusation);
  clock.classList.toggle('low', deciding && secs <= 5);
  if (next) next.textContent = `次の事件まで ${secs}秒`;
  if (deciding && secs <= 5 && secs > 0 && lastTick !== secs) {
    lastTick = secs;
    sfx.tick();
  }
}

void reduceMotion;
void PATHS;
