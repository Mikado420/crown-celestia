// 毒杯の晩餐会（藪の中風）— ゲームエンジン
// 伏せた容疑者3人から犯人を当てる。調べる／すり替える → 証言 を順番に2周し、最後に全員同時に告発する。

export const JESTER = 0; // 道化師（数字なし）
export const CHIPS = [1, 2, 3, 4, 5, 6, 7, 8, 9, JESTER];
export const SLOT_COUNT = 3;
export const SLOT_NAMES = ['一の席', '二の席', '三の席'];
export const LAPS = 2;
export const BLACK_HIT_PTS = 1; // 犯人を「クロ」と言い当てた証言の得点（1事件に1回まで）
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 6;

// 人物（数字は怪しさ）
export const PERSONS = {
  1: '見習い侍女',
  2: '庭師',
  3: '料理番',
  4: '吟遊詩人',
  5: '宮廷画家',
  6: '近衛騎士',
  7: '宮廷魔導士',
  8: '侍従長',
  9: '王弟',
  0: '道化師',
};

export function casesFor(playerCount) {
  return playerCount === 2 ? 6 : playerCount;
}

// 一番怪しい者が犯人。ただし道化師が紛れていたら逆転し、一番怪しくない者が犯人。
export function culpritSlot(suspects) {
  const jester = suspects.includes(JESTER);
  let best = -1;
  suspects.forEach((c, i) => {
    if (c === JESTER) return;
    if (best === -1 || (jester ? c < suspects[best] : c > suspects[best])) best = i;
  });
  return best;
}

export function isHonest(testimony, culprit) {
  return testimony.claim === 'black' ? testimony.slot === culprit : testimony.slot !== culprit;
}

function rand(state) {
  state.rngState = (state.rngState + 0x6d2b79f5) >>> 0;
  let t = state.rngState;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function shuffle(state, list) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(rand(state) * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

const nameOf = (s, pid) => s.players.find((p) => p.id === pid)?.name ?? '???';

function addLog(state, text) {
  state.log.push(text);
  if (state.log.length > 40) state.log.splice(0, state.log.length - 40);
}

export function createGame(players, { seed = Date.now(), cases } = {}) {
  if (players.length < MIN_PLAYERS || players.length > MAX_PLAYERS) throw new Error(`人数は${MIN_PLAYERS}〜${MAX_PLAYERS}人です`);
  const state = {
    phase: 'ready', // act → testify → …（2周）→ accuse → caseEnd → … → gameEnd
    players: players.map((p) => ({ id: p.id, name: p.name, isCpu: !!p.isCpu, score: 0, caseScores: [] })),
    cases: cases ?? casesFor(players.length),
    caseNo: 0,
    order: [],
    step: 0,
    suspects: [],
    hands: {},
    discard: [],
    swapped: {},
    slotVersion: [0, 0, 0],
    lastTestimonySlot: null,
    knowledge: {},
    history: [],
    pending: null,
    accusations: {},
    result: null,
    resultSeq: 0,
    animSeq: 0,
    animKind: null,
    log: [],
    rngState: seed >>> 0,
  };
  startCase(state);
  return state;
}

export function startCase(state) {
  if (!['ready', 'caseEnd'].includes(state.phase)) throw new Error('事件を始められません');
  state.caseNo += 1;
  const n = state.players.length;
  const chips = shuffle(state, [...CHIPS]);
  state.suspects = chips.splice(0, SLOT_COUNT);
  state.hands = {};
  for (const p of state.players) state.hands[p.id] = chips.pop();
  state.discard = [];
  const start = (state.caseNo - 1) % n;
  state.order = state.players.map((_, i) => state.players[(start + i) % n].id);
  state.step = 0;
  state.swapped = {};
  state.slotVersion = [0, 0, 0];
  state.lastTestimonySlot = null;
  state.knowledge = Object.fromEntries(state.players.map((p) => [p.id, []]));
  state.history = [];
  state.pending = null;
  state.accusations = {};
  state.phase = 'act';
  addLog(state, `第${state.caseNo}の事件。晩餐会で王の杯に毒が盛られた。`);
  return state;
}

export const stepsPerCase = (state) => state.players.length * LAPS;
export const currentPlayer = (state) => state.order[state.step % state.players.length];

export function canSwap(state, pid) {
  return state.hands[pid] != null && !state.swapped[pid];
}

function requireTurn(state, pid, phase) {
  if (state.phase !== phase) throw new Error('今はその行動ができません');
  if (currentPlayer(state) !== pid) throw new Error('あなたの手番ではありません');
}

function checkSlot(slot) {
  if (!Number.isInteger(slot) || slot < 0 || slot >= SLOT_COUNT) throw new Error('席の指定が正しくありません');
}

// 調べる／すり替える
export function investigate(state, pid, action, slot) {
  requireTurn(state, pid, 'act');
  checkSlot(slot);
  if (action === 'look') {
    if (slot === state.lastTestimonySlot) throw new Error('直前に証言された容疑者は調べられません');
    state.knowledge[pid].push({ slot, chip: state.suspects[slot], version: state.slotVersion[slot], step: state.step, how: 'look' });
  } else if (action === 'swap') {
    if (!canSwap(state, pid)) throw new Error('この事件ではもうすり替えられません');
    const inserted = state.hands[pid];
    state.discard.push(state.suspects[slot]); // 抜いた人物は誰も見ずに退場する
    state.suspects[slot] = inserted;
    state.hands[pid] = null;
    state.swapped[pid] = true;
    state.slotVersion[slot] += 1;
    state.knowledge[pid].push({ slot, chip: inserted, version: state.slotVersion[slot], step: state.step, how: 'swap' });
    addLog(state, `${nameOf(state, pid)}が${SLOT_NAMES[slot]}の人物をすり替えた。`);
  } else {
    throw new Error('行動の指定が正しくありません');
  }
  state.history.push({ step: state.step, pid, action, slot, testimony: null });
  state.pending = { pid, action, slot };
  state.phase = 'testify';
  state.animSeq += 1;
  state.animKind = action;
  return state;
}

// 証言（嘘でもよい）
export function testify(state, pid, slot, claim) {
  requireTurn(state, pid, 'testify');
  checkSlot(slot);
  if (claim !== 'black' && claim !== 'white') throw new Error('証言の指定が正しくありません');
  state.history[state.history.length - 1].testimony = { slot, claim };
  state.lastTestimonySlot = slot;
  state.pending = null;
  state.animSeq += 1;
  state.animKind = 'testify';
  addLog(state, `${nameOf(state, pid)}「${SLOT_NAMES[slot]}は${claim === 'black' ? 'クロ' : 'シロ'}だ」`);
  state.step += 1;
  state.phase = state.step >= stepsPerCase(state) ? 'accuse' : 'act';
  return state;
}

// 告発（全員同時。そろうまで変更できる）
export function accuse(state, pid, slot, stake) {
  if (state.phase !== 'accuse') throw new Error('今は告発できません');
  if (!state.players.some((p) => p.id === pid)) throw new Error('参加していないプレイヤーです');
  checkSlot(slot);
  if (stake !== 1 && stake !== 2) throw new Error('賭け方の指定が正しくありません');
  state.accusations[pid] = { slot, stake };
  if (state.players.every((p) => state.accusations[p.id])) resolveCase(state);
  return state;
}

function resolveCase(state) {
  const culprit = culpritSlot(state.suspects);
  const n = state.players.length;
  const correctCount = state.players.filter((p) => state.accusations[p.id].slot === culprit).length;
  const wrongCount = n - correctCount;
  const entries = state.players.map((p) => {
    const a = state.accusations[p.id];
    const correct = a.slot === culprit;
    const accusePts = correct ? a.stake * (wrongCount + 1) : -a.stake;
    const said = state.history.filter((h) => h.pid === p.id && h.testimony).map((h) => h.testimony);
    const honest = said.filter((t) => isHonest(t, culprit)).length;
    // 証言の得点：犯人を「クロ」と言い当てていたら+1（1事件に1点まで）。シロの証言は得点にならない。
    const testimonyPts = said.some((t) => t.claim === 'black' && t.slot === culprit) ? BLACK_HIT_PTS : 0;
    const total = accusePts + testimonyPts;
    p.score += total;
    p.caseScores.push(total);
    return { pid: p.id, slot: a.slot, stake: a.stake, correct, accusePts, testimonyPts, honest, lies: said.length - honest, total };
  });
  state.resultSeq += 1;
  state.result = {
    seq: state.resultSeq,
    caseNo: state.caseNo,
    suspects: [...state.suspects],
    culprit,
    jester: state.suspects.includes(JESTER),
    hands: { ...state.hands },
    entries,
  };
  state.animSeq += 1;
  state.animKind = 'reveal';
  addLog(state, `真相：犯人は${SLOT_NAMES[culprit]}の${PERSONS[state.suspects[culprit]]}。`);
  state.phase = state.caseNo >= state.cases ? 'gameEnd' : 'caseEnd';
}

export function nextCase(state) {
  if (state.phase !== 'caseEnd') throw new Error('次の事件に進めません');
  return startCase(state);
}

// 得点が高い順。同点は同順位。
export function ranking(state) {
  const sorted = [...state.players].sort((a, b) => b.score - a.score);
  let place = 0;
  let prev = null;
  return sorted.map((p, i) => {
    if (p.score !== prev) {
      place = i + 1;
      prev = p.score;
    }
    return { id: p.id, name: p.name, score: p.score, place, caseScores: [...p.caseScores] };
  });
}

// そのプレイヤーが今知っている、各席の人物（すり替えで古くなった情報は stale）
export function knownSlots(state, pid) {
  const out = [null, null, null];
  for (const k of state.knowledge[pid] ?? []) {
    out[k.slot] = { chip: k.chip, how: k.how, stale: k.version !== state.slotVersion[k.slot] };
  }
  return out;
}

export function viewFor(state, pid) {
  const cur = state.phase === 'act' || state.phase === 'testify' ? currentPlayer(state) : null;
  const pend = state.pending && state.pending.pid === pid && state.pending.action === 'look'
    ? { slot: state.pending.slot, chip: state.suspects[state.pending.slot] }
    : null;
  return {
    kind: 'grove',
    phase: state.phase,
    you: pid,
    players: state.players.map((p) => ({
      id: p.id,
      name: p.name,
      isCpu: p.isCpu,
      score: p.score,
      caseScores: [...p.caseScores],
      swapped: !!state.swapped[p.id],
      accused: !!state.accusations[p.id],
    })),
    cases: state.cases,
    caseNo: state.caseNo,
    order: [...state.order],
    step: state.step,
    steps: stepsPerCase(state),
    current: cur,
    blockedSlot: state.lastTestimonySlot,
    hand: state.hands[pid] ?? null,
    canSwap: canSwap(state, pid),
    known: knownSlots(state, pid),
    seenOut: (state.knowledge[pid] ?? []).filter((k) => k.version !== state.slotVersion[k.slot]).map((k) => k.chip),
    lastLook: pend,
    history: state.history.map((h) => ({ ...h, testimony: h.testimony ? { ...h.testimony } : null })),
    myAccusation: state.accusations[pid] ?? null,
    result: state.result,
    animSeq: state.animSeq,
    animKind: state.animKind,
    ranking: ranking(state),
    log: state.log.slice(-10),
  };
}
