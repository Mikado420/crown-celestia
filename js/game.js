// 酒場のツケ — ゲームエンジン（通信や画面に依存しない純粋なロジック）
// 原作「6ニムト」のルールをもとに、人数別のカード枚数と「大酒飲み」を加えたもの。

export const TABLE_COUNT = 4; // 卓の数
export const SEAT_LIMIT = 5; // 1卓に座れる人数（6人目が勘定を払う）
export const HAND_SIZE = 10; // 1ラウンドの手札
export const HEAVY_COUNT = 2; // 毎ラウンドの大酒飲みの人数
export const HEAVY_TAB = 5; // 大酒飲みのツケ
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 6;

export const TABLE_NAMES = ['樫の卓', '竜骨の卓', '月影の卓', '暖炉の卓'];

// 人数×10＋卓の4枚＋酔いつぶれの1枚
export function deckSizeFor(playerCount) {
  return playerCount * HAND_SIZE + TABLE_COUNT + 1;
}

export function roundsFor(playerCount) {
  return playerCount === 2 ? 4 : 3;
}

// 格（数字）ごとの基本のツケ。原作の牛の数と同じ配分。
export function baseTab(rank) {
  if (rank === 55) return 7;
  if (rank % 11 === 0) return 5;
  if (rank % 10 === 0) return 3;
  if (rank % 5 === 0) return 2;
  return 1;
}

export function tabOf(state, rank) {
  return state.heavy.includes(rank) ? HEAVY_TAB : baseTab(rank);
}

export function tableTab(state, table) {
  return table.reduce((sum, rank) => sum + tabOf(state, rank), 0);
}

// 再現できる乱数（状態の中にシードを持つ）
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

function addLog(state, text) {
  state.log.push(text);
  if (state.log.length > 40) state.log.splice(0, state.log.length - 40);
}

function playerName(state, pid) {
  return state.players.find((p) => p.id === pid)?.name ?? '???';
}

export function createGame(players, { seed = Date.now(), rounds } = {}) {
  if (players.length < MIN_PLAYERS || players.length > MAX_PLAYERS) {
    throw new Error(`人数は${MIN_PLAYERS}〜${MAX_PLAYERS}人です`);
  }
  return {
    phase: 'ready', // ready → choosing ⇄ choosingTable → roundEnd → … → gameEnd
    players: players.map((p) => ({
      id: p.id,
      name: p.name,
      isCpu: !!p.isCpu,
      debt: 0,
      roundDebts: [],
    })),
    deckSize: deckSizeFor(players.length),
    rounds: rounds ?? roundsFor(players.length),
    round: 0,
    turn: 0,
    tables: [],
    hands: {},
    plays: {}, // 今回の手番で出したカード（公開前）
    revealed: null, // 公開済み・処理待ちの出し札（卓選び待ちのとき）
    awaiting: null, // 卓を選ぶ必要がある人
    heavy: [],
    sleeper: null, // 酔いつぶれて使われない1枚
    lastSleeper: null,
    roundStartDebt: {},
    resolution: null,
    resolutionSeq: 0,
    log: [],
    rngState: seed >>> 0,
  };
}

export function startRound(state) {
  if (!['ready', 'roundEnd'].includes(state.phase)) throw new Error('ラウンドを開始できません');
  state.round += 1;
  state.turn = 1;
  const deck = shuffle(state, Array.from({ length: state.deckSize }, (_, i) => i + 1));
  state.sleeper = deck.pop();
  state.tables = Array.from({ length: TABLE_COUNT }, () => [deck.pop()]);
  state.hands = {};
  for (const p of state.players) {
    state.hands[p.id] = deck.splice(0, HAND_SIZE).sort((a, b) => a - b);
  }
  // 大酒飲み：ツケ1の冒険者からランダムに選ぶ（酔いつぶれは除く）
  const candidates = [];
  for (let r = 1; r <= state.deckSize; r++) {
    if (r !== state.sleeper && baseTab(r) === 1) candidates.push(r);
  }
  state.heavy = shuffle(state, candidates).slice(0, HEAVY_COUNT).sort((a, b) => a - b);
  state.plays = {};
  state.revealed = null;
  state.awaiting = null;
  state.roundStartDebt = Object.fromEntries(state.players.map((p) => [p.id, p.debt]));
  state.phase = 'choosing';
  addLog(state, `第${state.round}夜の開店。今夜の大酒飲みは格${state.heavy.join('と格')}。`);
  return state;
}

// 手番中は何度でも出し直せる。全員がそろった時点で公開。
export function playCard(state, pid, rank) {
  if (state.phase !== 'choosing') throw new Error('今はカードを出せません');
  const hand = state.hands[pid];
  if (!hand) throw new Error('参加していないプレイヤーです');
  if (!hand.includes(rank)) throw new Error('手札にないカードです');
  state.plays[pid] = rank;
  if (state.players.every((p) => state.plays[p.id] != null)) reveal(state);
  return state;
}

export function allPlayed(state) {
  return state.players.every((p) => state.plays[p.id] != null);
}

function lowestEnd(state) {
  return Math.min(...state.tables.map((t) => t[t.length - 1]));
}

function reveal(state) {
  const order = state.players
    .map((p) => ({ pid: p.id, rank: state.plays[p.id] }))
    .sort((a, b) => a.rank - b.rank);
  for (const { pid, rank } of order) {
    state.hands[pid] = state.hands[pid].filter((r) => r !== rank);
  }
  state.revealed = order;
  state.plays = {};
  // 一番小さい札だけが「どこにも座れない」可能性がある
  if (order[0].rank < lowestEnd(state)) {
    state.phase = 'choosingTable';
    state.awaiting = order[0].pid;
  } else {
    resolve(state, null);
  }
}

export function chooseTable(state, pid, index) {
  if (state.phase !== 'choosingTable') throw new Error('今は卓を選べません');
  if (state.awaiting !== pid) throw new Error('卓を選ぶのは別のプレイヤーです');
  if (!Number.isInteger(index) || index < 0 || index >= TABLE_COUNT) throw new Error('卓の指定が正しくありません');
  resolve(state, index);
  return state;
}

// 一番安い卓（同じなら人数が少ない卓）
export function cheapestTable(state) {
  let best = 0;
  for (let i = 1; i < state.tables.length; i++) {
    const a = tableTab(state, state.tables[i]);
    const b = tableTab(state, state.tables[best]);
    if (a < b || (a === b && state.tables[i].length < state.tables[best].length)) best = i;
  }
  return best;
}

function pay(state, pid, cards) {
  const amount = cards.reduce((sum, r) => sum + tabOf(state, r), 0);
  const player = state.players.find((p) => p.id === pid);
  player.debt += amount;
  return amount;
}

function resolve(state, choice) {
  const order = state.revealed;
  const startTables = state.tables.map((t) => [...t]);
  const events = [];
  for (const { pid, rank } of order) {
    let target = -1;
    state.tables.forEach((t, i) => {
      const end = t[t.length - 1];
      if (end < rank && (target === -1 || end > state.tables[target][state.tables[target].length - 1])) target = i;
    });
    const name = playerName(state, pid);
    if (target === -1) {
      const idx = choice ?? cheapestTable(state);
      const cards = state.tables[idx];
      const amount = pay(state, pid, cards);
      state.tables[idx] = [rank];
      events.push({ type: 'refused', pid, rank, table: idx, cards, amount });
      addLog(state, `${name}の格${rank}は相席を断られ、${TABLE_NAMES[idx]}のツケ${amount}枚を肩代わりした。`);
    } else if (state.tables[target].length >= SEAT_LIMIT) {
      const cards = state.tables[target];
      const amount = pay(state, pid, cards);
      state.tables[target] = [rank];
      events.push({ type: 'full', pid, rank, table: target, cards, amount });
      addLog(state, `満席の${TABLE_NAMES[target]}に${name}の格${rank}が座り、ツケ${amount}枚を払わされた！`);
    } else {
      state.tables[target].push(rank);
      events.push({ type: 'seat', pid, rank, table: target });
    }
  }
  state.resolutionSeq += 1;
  state.resolution = {
    seq: state.resolutionSeq,
    round: state.round,
    turn: state.turn,
    startTables,
    plays: order,
    events,
  };
  state.revealed = null;
  state.awaiting = null;

  const handsEmpty = state.players.every((p) => state.hands[p.id].length === 0);
  if (!handsEmpty) {
    state.turn += 1;
    state.phase = 'choosing';
    return;
  }
  for (const p of state.players) p.roundDebts.push(p.debt - state.roundStartDebt[p.id]);
  state.lastSleeper = state.sleeper;
  addLog(state, `第${state.round}夜は閉店。酔いつぶれて寝ていたのは格${state.sleeper}だった。`);
  if (state.round >= state.rounds) {
    state.phase = 'gameEnd';
    const top = ranking(state).filter((r) => r.place === 1).map((r) => r.name);
    addLog(state, `大会終了。ツケが最も少ない${top.join('と')}が勝利！`);
  } else {
    state.phase = 'roundEnd';
  }
}

export function nextRound(state) {
  if (state.phase !== 'roundEnd') throw new Error('次のラウンドに進めません');
  return startRound(state);
}

// ツケが少ない順。同点は同順位。
export function ranking(state) {
  const sorted = [...state.players].sort((a, b) => a.debt - b.debt);
  let place = 0;
  let prev = null;
  return sorted.map((p, i) => {
    if (p.debt !== prev) {
      place = i + 1;
      prev = p.debt;
    }
    return { id: p.id, name: p.name, debt: p.debt, place, roundDebts: [...p.roundDebts] };
  });
}

// 各プレイヤーに送る情報（他人の手札と未公開の出し札は隠す）
export function viewFor(state, pid) {
  return {
    phase: state.phase,
    you: pid,
    players: state.players.map((p) => ({
      id: p.id,
      name: p.name,
      isCpu: p.isCpu,
      debt: p.debt,
      roundDebts: [...p.roundDebts],
      handCount: state.hands[p.id]?.length ?? 0,
      played: state.plays[p.id] != null,
    })),
    deckSize: state.deckSize,
    rounds: state.rounds,
    round: state.round,
    turn: state.turn,
    tables: state.tables.map((t) => [...t]),
    hand: [...(state.hands[pid] ?? [])],
    myPlay: state.plays[pid] ?? null,
    revealed: state.revealed ? state.revealed.map((r) => ({ ...r })) : null,
    awaiting: state.awaiting,
    heavy: [...state.heavy],
    lastSleeper: state.lastSleeper,
    resolution: state.resolution,
    ranking: ranking(state),
    log: state.log.slice(-12),
  };
}
