// 魔法陣の決闘（バトルライン風）— ゲームエンジン
// 隣り合う2人の間ごとに魔法陣が並び、全員が同時に1枚ずつ精霊か秘術を出す。
// 片側3体（陣の拡張なら4体）の「合計＋役ボーナス」を比べて魔法陣を取り合う。

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 6;
export const ROUNDS = 3;
export const MAX_NUM = 10;
export const MAGIC_HAND_LIMIT = 2;

export const ELEMENTS = ['炎', '水', '風', '地', '光', '闇', '氷'];

export const MAGIC = {
  rainbow: { name: '虹の精霊', kind: 'spirit', text: '好きな属性・数字になる。自分の場に1体まで' },
  greater: { name: '上位精霊', kind: 'spirit', text: '数字8・好きな属性になる' },
  lesser: { name: '小精霊', kind: 'spirit', text: '数字1〜3・好きな属性になる' },
  fog: { name: '霧の結界', kind: 'terrain', text: 'その魔法陣は、役のボーナスを無視して合計だけで勝負する' },
  expand: { name: '陣の拡張', kind: 'terrain', text: 'その魔法陣は、片側4体ずつ必要になる' },
  scout: { name: '遠見の水晶', kind: 'instant', text: '精霊の山から2枚引く' },
  transfer: { name: '転移', kind: 'instant', text: '自分の未決着の精霊を1体、別の魔法陣へ移すか消す' },
  banish: { name: '送還', kind: 'instant', text: '隣の相手の、未決着の精霊を1体消す' },
  charm: { name: '魅了', kind: 'instant', text: '隣の相手の、未決着の精霊を1体奪い、自分の魔法陣に置く' },
};
export const MAGIC_TYPES = Object.keys(MAGIC);

export const FORMATIONS = ['', 'バラ', '連番', '同じ属性', '同じ数字', '同じ属性の連番'];
export const FOG_NAME = '合計のみ';
// 役ボーナス（rank の添字）：バラ0・連番2・同じ属性4・同じ数字5・同じ属性の連番9
// 同じ属性の連番 8-9-10（36）が、属性違いの 10-10-10（35）を上回るように決めてある。
export const BONUS = [0, 0, 2, 4, 5, 9];

export const handSizeFor = (n) => (n === 2 ? 7 : n === 3 ? 6 : 5);
export const elementCountFor = (n) => (n >= 5 ? 7 : 6);

function magicCounts(n) {
  if (n <= 3) return Object.fromEntries(MAGIC_TYPES.map((t) => [t, 1]));
  return { rainbow: 2, greater: 2, lesser: 2, fog: 1, expand: 1, scout: 2, transfer: 2, banish: 2, charm: 2 };
}

// ---------- 乱数 ----------
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

// ---------- 役の判定 ----------
const WILD_NUMS = { rainbow: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], greater: [8], lesser: [1, 2, 3] };
const WILD_MAX = { rainbow: 10, greater: 8, lesser: 3 };
export const isWild = (card) => card.kind === 'magic';
export const cardMax = (card) => (isWild(card) ? WILD_MAX[card.type] : card.num);

function rankOf(els, nums) {
  const sameEl = els.every((e) => e === els[0]);
  const sameNum = nums.every((n) => n === nums[0]);
  const sorted = [...nums].sort((a, b) => a - b);
  const run = sorted.every((n, i) => i === 0 || n === sorted[i - 1] + 1);
  if (sameEl && run) return 5;
  if (sameNum) return 4;
  if (sameEl) return 3;
  if (run) return 2;
  return 1;
}

// 一番高くなる数字・属性を自動で選んで評価する。
// score ＝ 合計 ＋ 役ボーナス。霧の結界の陣（fog）はボーナスなしで合計だけ（rank 0）。
export function evaluate(cards, fog = false) {
  const fixed = cards.filter((c) => !isWild(c));
  const wilds = cards.filter(isWild);
  if (fog) {
    const sum = cards.reduce((s, c) => s + cardMax(c), 0);
    return { rank: 0, sum, bonus: 0, score: sum };
  }
  const fixedEls = [...new Set(fixed.map((c) => c.el))];
  const wildEl = fixedEls.length === 1 ? fixedEls[0] : fixedEls.length === 0 ? 0 : -1;
  const els = [...fixed.map((c) => c.el), ...wilds.map(() => wildEl)];
  // 属性がばらばらなら、ワイルドの属性はどの属性にも合わせられない（-1）
  const elsForRank = wildEl === -1 ? [...fixed.map((c) => c.el), ...wilds.map((_, i) => -2 - i)] : els;
  let best = null;
  const nums = fixed.map((c) => c.num);
  const walk = (i, acc) => {
    if (i === wilds.length) {
      const all = [...nums, ...acc];
      const rank = rankOf(elsForRank, all);
      const sum = all.reduce((a, b) => a + b, 0);
      const bonus = BONUS[rank];
      const f = { rank, sum, bonus, score: sum + bonus };
      if (!best || f.score > best.score || (f.score === best.score && (f.rank > best.rank || (f.rank === best.rank && f.sum > best.sum)))) best = f;
      return;
    }
    for (const n of WILD_NUMS[wilds[i].type]) walk(i + 1, [...acc, n]);
  };
  walk(0, []);
  return best;
}

// 勝負は score（合計＋役ボーナス）で比べる。同点は引き分け（呼び出し側で先にそろえた方を見る）。
export const beats = (a, b) => a.score > b.score;
export const sameForm = (a, b) => a.score === b.score;

export function formationName(f) {
  if (!f) return '';
  if (f.rank === 0) return `${FOG_NAME} ${f.sum}`;
  return f.bonus ? `${FORMATIONS[f.rank]} ${f.score}（${f.sum}＋${f.bonus}）` : `${FORMATIONS[f.rank]} ${f.sum}`;
}

// ---------- 準備 ----------
export function createGame(players, { seed = Date.now(), rounds = ROUNDS } = {}) {
  if (players.length < MIN_PLAYERS || players.length > MAX_PLAYERS) throw new Error(`人数は${MIN_PLAYERS}〜${MAX_PLAYERS}人です`);
  const state = {
    phase: 'ready', // choose ⇄（解決）… → roundEnd → … → gameEnd
    players: players.map((p) => ({ id: p.id, name: p.name, isCpu: !!p.isCpu, score: 0, roundScores: [] })),
    rounds,
    round: 0,
    turn: 0,
    seats: [],
    duels: [],
    circles: [],
    cards: {},
    spiritDeck: [],
    magicDeck: [],
    hands: {},
    actions: {},
    active: [],
    starter: 0,
    resolution: null,
    resolutionSeq: 0,
    roundResult: null,
    roundResultSeq: 0,
    rngState: seed >>> 0,
  };
  startRound(state);
  return state;
}

export function startRound(state) {
  if (!['ready', 'roundEnd'].includes(state.phase)) throw new Error('ラウンドを開始できません');
  state.round += 1;
  state.turn = 1;
  const n = state.players.length;
  const ids = state.players.map((p) => p.id);
  // 4人以上はラウンドごとに席を替えて、隣の相手を変える
  state.seats = n >= 4 ? shuffle(state, [...ids]) : [...ids];
  const pairs = n === 2 ? [[ids[0], ids[1]]] : state.seats.map((p, i) => [p, state.seats[(i + 1) % n]]);
  const per = n === 2 ? 7 : n === 3 ? 3 : 2;
  state.duels = [];
  state.circles = [];
  pairs.forEach(([a, b], d) => {
    const circleIds = [];
    for (let k = 0; k < per; k++) {
      const id = state.circles.length;
      circleIds.push(id);
      state.circles.push({ id, duel: d, a, b, sides: { [a]: [], [b]: [] }, fog: false, expand: false, owner: null, decided: false, done: {}, result: null });
    }
    state.duels.push({ id: d, a, b, circles: circleIds });
  });
  // カード
  state.cards = {};
  const spirits = [];
  for (let el = 0; el < elementCountFor(n); el++) {
    for (let num = 1; num <= MAX_NUM; num++) {
      const id = `s${el}-${num}`;
      state.cards[id] = { id, kind: 'spirit', el, num };
      spirits.push(id);
    }
  }
  const magics = [];
  for (const [type, count] of Object.entries(magicCounts(n))) {
    for (let k = 0; k < count; k++) {
      const id = `m-${type}-${k}`;
      state.cards[id] = { id, kind: 'magic', type };
      magics.push(id);
    }
  }
  state.spiritDeck = shuffle(state, spirits);
  state.magicDeck = shuffle(state, magics);
  state.hands = {};
  for (const p of state.players) state.hands[p.id] = state.spiritDeck.splice(0, handSizeFor(n));
  state.actions = {};
  state.starter = 0;
  state.resolution = null;
  state.phase = 'choose';
  refreshActive(state);
  return state;
}

// ---------- 補助 ----------
export const capOf = (c) => (c.expand ? 4 : 3);
export const opponentOf = (c, pid) => (c.a === pid ? c.b : c.a);
export const circlesOf = (state, pid) => state.circles.filter((c) => c.a === pid || c.b === pid);
export const hasRoom = (c, pid) => !c.decided && c.sides[pid] && c.sides[pid].length < capOf(c);
export const magicInHand = (state, pid) => state.hands[pid].filter((id) => state.cards[id].kind === 'magic').length;
const rainbowOnBoard = (state, pid) => state.circles.some((c) => (c.sides[pid] ?? []).some((id) => state.cards[id].type === 'rainbow'));

function findCircle(state, id) {
  const c = state.circles[id];
  if (!c) throw new Error('魔法陣の指定が正しくありません');
  return c;
}

// その手札の1枚で、今できる行動があるか
function cardUsable(state, pid, id) {
  const card = state.cards[id];
  const mine = circlesOf(state, pid).filter((c) => !c.decided);
  if (card.kind === 'spirit') return mine.some((c) => hasRoom(c, pid));
  const t = card.type;
  if (t === 'rainbow') return !rainbowOnBoard(state, pid) && mine.some((c) => hasRoom(c, pid));
  if (t === 'greater' || t === 'lesser') return mine.some((c) => hasRoom(c, pid));
  if (t === 'fog') return mine.some((c) => !c.fog);
  if (t === 'expand') return mine.some((c) => !c.expand);
  if (t === 'scout') return state.spiritDeck.length > 0;
  if (t === 'transfer') return mine.some((c) => c.sides[pid].length > 0);
  if (t === 'banish' || t === 'charm') {
    const targets = mine.some((c) => c.sides[opponentOf(c, pid)].length > 0);
    return t === 'banish' ? targets : targets && mine.some((c) => hasRoom(c, pid));
  }
  return false;
}

export function usableCards(state, pid) {
  return state.hands[pid].filter((id) => cardUsable(state, pid, id));
}

function refreshActive(state) {
  state.active = state.players.filter((p) => usableCards(state, p.id).length > 0).map((p) => p.id);
}

// ---------- 行動の確認 ----------
function validate(state, pid, a) {
  if (!a || typeof a !== 'object') throw new Error('行動の指定が正しくありません');
  if (!state.hands[pid]?.includes(a.card)) throw new Error('手札にないカードです');
  const card = state.cards[a.card];
  const mine = (id) => {
    const c = findCircle(state, id);
    if (c.a !== pid && c.b !== pid) throw new Error('自分の決闘の魔法陣ではありません');
    if (c.decided) throw new Error('その魔法陣はもう決着しています');
    return c;
  };
  const out = { card: a.card, draw: a.draw === 'magic' ? 'magic' : 'spirit' };
  const kind = card.kind === 'spirit' ? 'spirit' : MAGIC[card.type].kind;
  if (kind === 'spirit') {
    const c = mine(a.circle);
    if (!hasRoom(c, pid)) throw new Error('その魔法陣の自分側はいっぱいです');
    if (card.type === 'rainbow' && rainbowOnBoard(state, pid)) throw new Error('虹の精霊は自分の場に1体までです');
    out.circle = c.id;
  } else if (kind === 'terrain') {
    const c = mine(a.circle);
    if (c[card.type]) throw new Error('その魔法陣にはもうかかっています');
    out.circle = c.id;
  } else if (card.type === 'scout') {
    if (!state.spiritDeck.length) throw new Error('精霊の山がありません');
  } else {
    const c = mine(a.target?.circle);
    const owner = card.type === 'transfer' ? pid : opponentOf(c, pid);
    if (!c.sides[owner].includes(a.target.card)) throw new Error('その精霊は選べません');
    out.target = { circle: c.id, card: a.target.card };
    if (card.type === 'transfer') {
      if (a.dest === 'void') out.dest = 'void';
      else {
        const d = mine(a.dest);
        if (d.id === c.id) throw new Error('別の魔法陣を選んでください');
        if (!hasRoom(d, pid)) throw new Error('移す先がいっぱいです');
        out.dest = d.id;
      }
    } else if (card.type === 'charm') {
      const d = mine(a.dest);
      if (!hasRoom(d, pid)) throw new Error('置く先がいっぱいです');
      out.dest = d.id;
    }
  }
  // 秘術は手札に2枚まで
  const magicAfter = magicInHand(state, pid) - (card.kind === 'magic' ? 1 : 0);
  if (out.draw === 'magic' && (magicAfter >= MAGIC_HAND_LIMIT || !state.magicDeck.length)) out.draw = 'spirit';
  return out;
}

export function submit(state, pid, action) {
  if (state.phase !== 'choose') throw new Error('今は出せません');
  if (!state.active.includes(pid)) throw new Error('今出せるカードがありません');
  state.actions[pid] = validate(state, pid, action);
  if (state.active.every((id) => state.actions[id])) resolve(state);
  return state;
}

// ---------- 解決 ----------
function removeFrom(list, id) {
  const i = list.indexOf(id);
  if (i >= 0) list.splice(i, 1);
  return i >= 0;
}

function resolve(state) {
  const n = state.players.length;
  const order = [];
  for (let i = 0; i < n; i++) order.push(state.players[(state.starter + i) % n].id);
  const acts = order.filter((pid) => state.actions[pid]).map((pid) => ({ pid, ...state.actions[pid] }));
  const events = [];
  const back = (a) => {
    state.hands[a.pid].push(a.card);
    events.push({ type: 'fizzle', pid: a.pid, card: a.card });
  };
  for (const a of acts) removeFrom(state.hands[a.pid], a.card);
  const typeOf = (a) => {
    const c = state.cards[a.card];
    return c.kind === 'spirit' ? 'spirit' : c.type;
  };
  const kindOf = (a) => (typeOf(a) === 'spirit' ? 'spirit' : MAGIC[typeOf(a)].kind);

  // 1. 陣にかける秘術
  for (const a of acts.filter((x) => kindOf(x) === 'terrain')) {
    const c = state.circles[a.circle];
    const t = typeOf(a);
    if (c.decided || c[t]) {
      back(a);
      continue;
    }
    c[t] = true;
    events.push({ type: 'terrain', pid: a.pid, card: a.card, effect: t, circle: c.id });
  }
  // 2. その場で効く秘術（席順）
  for (const a of acts.filter((x) => kindOf(x) === 'instant')) {
    const t = typeOf(a);
    if (t === 'scout') {
      const got = state.spiritDeck.splice(0, 2);
      state.hands[a.pid].push(...got);
      events.push({ type: 'scout', pid: a.pid, card: a.card, count: got.length });
      continue;
    }
    const c = state.circles[a.target.circle];
    const owner = t === 'transfer' ? a.pid : opponentOf(c, a.pid);
    const present = !c.decided && c.sides[owner].includes(a.target.card);
    if (!present) {
      back(a);
      continue;
    }
    if (t === 'banish') {
      removeFrom(c.sides[owner], a.target.card);
      events.push({ type: 'banish', pid: a.pid, card: a.card, victim: owner, circle: c.id, target: a.target.card });
    } else if (t === 'transfer') {
      if (a.dest === 'void') {
        removeFrom(c.sides[owner], a.target.card);
        events.push({ type: 'transfer', pid: a.pid, card: a.card, circle: c.id, target: a.target.card, dest: 'void' });
      } else {
        const d = state.circles[a.dest];
        if (!hasRoom(d, a.pid)) {
          back(a);
          continue;
        }
        removeFrom(c.sides[owner], a.target.card);
        d.sides[a.pid].push(a.target.card);
        events.push({ type: 'transfer', pid: a.pid, card: a.card, circle: c.id, target: a.target.card, dest: d.id });
      }
    } else if (t === 'charm') {
      const d = state.circles[a.dest];
      const stolen = state.cards[a.target.card];
      if (!hasRoom(d, a.pid) || (stolen.type === 'rainbow' && rainbowOnBoard(state, a.pid))) {
        back(a);
        continue;
      }
      removeFrom(c.sides[owner], a.target.card);
      d.sides[a.pid].push(a.target.card);
      events.push({ type: 'charm', pid: a.pid, card: a.card, victim: owner, circle: c.id, target: a.target.card, dest: d.id });
    }
  }
  // 3. 精霊の配置（席順）
  for (const a of acts.filter((x) => kindOf(x) === 'spirit')) {
    const c = state.circles[a.circle];
    if (!hasRoom(c, a.pid) || (state.cards[a.card].type === 'rainbow' && rainbowOnBoard(state, a.pid))) {
      back(a);
      continue;
    }
    c.sides[a.pid].push(a.card);
    events.push({ type: 'place', pid: a.pid, card: a.card, circle: c.id });
  }
  // そろった時刻（崩れたら消す）
  for (const c of state.circles) {
    if (c.decided) continue;
    for (const pid of [c.a, c.b]) {
      if (c.sides[pid].length >= capOf(c)) c.done[pid] ??= state.turn;
      else delete c.done[pid];
    }
  }
  // 決着
  for (const c of state.circles) {
    if (!c.decided && decideCircle(state, c)) events.push({ type: 'decide', circle: c.id, owner: c.owner, result: c.result });
  }
  // 引く
  for (const a of acts) {
    const wantMagic = a.draw === 'magic' && magicInHand(state, a.pid) < MAGIC_HAND_LIMIT && state.magicDeck.length;
    if (wantMagic) state.hands[a.pid].push(state.magicDeck.shift());
    else if (state.spiritDeck.length) state.hands[a.pid].push(state.spiritDeck.shift());
    else if (state.magicDeck.length && magicInHand(state, a.pid) < MAGIC_HAND_LIMIT) state.hands[a.pid].push(state.magicDeck.shift());
  }
  state.resolutionSeq += 1;
  state.resolution = {
    seq: state.resolutionSeq,
    round: state.round,
    turn: state.turn,
    actions: acts.map((a) => ({ pid: a.pid, card: state.cards[a.card] })),
    events,
  };
  state.actions = {};
  state.turn += 1;
  state.starter = (state.starter + 1) % n;

  const instant = n === 2 ? instantWinner(state) : null;
  refreshActive(state);
  if (instant || state.circles.every((c) => c.decided) || state.active.length === 0) endRound(state, instant);
  else state.phase = 'choose';
}

// 決着の判定。片側だけそろっていても、相手がもう逆転できなければ決着する。
function decideCircle(state, c) {
  const cap = capOf(c);
  const A = c.a;
  const B = c.b;
  const fullA = c.sides[A].length >= cap;
  const fullB = c.sides[B].length >= cap;
  const formOf = (pid) => evaluate(c.sides[pid].map((id) => state.cards[id]), c.fog);
  if (fullA && fullB) {
    const fa = formOf(A);
    const fb = formOf(B);
    let owner;
    if (beats(fa, fb)) owner = A;
    else if (beats(fb, fa)) owner = B;
    else if (c.done[A] !== c.done[B]) owner = c.done[A] < c.done[B] ? A : B;
    else owner = 'draw';
    return settle(c, owner, { [A]: fa, [B]: fb }, 'both');
  }
  for (const [me, other, full] of [[A, B, fullA], [B, A, fullB]]) {
    if (!full) continue;
    const f = formOf(me);
    if (!canStillBeat(state, c, other, f)) return settle(c, me, { [me]: f, [other]: null }, 'proof');
  }
  return false;
}

function settle(c, owner, forms, how) {
  c.decided = true;
  c.owner = owner;
  c.result = { forms, how };
  return true;
}

// まだ盤面に出ていない精霊（と精霊になる秘術）を全部使っても、target を上回れるか
export function canStillBeat(state, c, pid, target) {
  const cap = capOf(c);
  const placed = c.sides[pid].map((id) => state.cards[id]);
  const k = cap - placed.length;
  const onBoard = new Set(state.circles.flatMap((x) => [...x.sides[x.a], ...x.sides[x.b]]));
  const available = new Set([...state.spiritDeck, ...state.magicDeck, ...Object.values(state.hands).flat()]);
  const noRainbowYet = !rainbowOnBoard(state, pid);
  const pool = [...available]
    .map((id) => state.cards[id])
    .filter((card) => !onBoard.has(card.id))
    .filter((card) => card.kind === 'spirit' || ['greater', 'lesser'].includes(card.type) || (card.type === 'rainbow' && noRainbowYet));
  const better = (cards) => beats(evaluate([...placed, ...cards], c.fog), target);
  if (c.fog) {
    const top = [...pool].sort((x, y) => cardMax(y) - cardMax(x)).slice(0, k);
    return top.length === k && better(top);
  }
  const tryCombos = (cand) => {
    const rainbows = cand.filter((x) => x.type === 'rainbow');
    const list = [...cand.filter((x) => x.type !== 'rainbow'), ...rainbows.slice(0, 1)];
    let found = false;
    const pick = (start, acc) => {
      if (found) return;
      if (acc.length === k) {
        if (better(acc)) found = true;
        return;
      }
      for (let i = start; i <= list.length - (k - acc.length); i++) pick(i + 1, [...acc, list[i]]);
    };
    pick(0, []);
    return found;
  };
  if (k <= 0) return false;
  const wildFits = (card, test) => isWild(card) && WILD_NUMS[card.type].some(test);
  const elements = [...new Set(pool.filter((x) => !isWild(x)).map((x) => x.el))];
  // 同じ属性（の連番）
  for (const el of elements) {
    if (!placed.every((x) => isWild(x) || x.el === el)) continue;
    if (tryCombos(pool.filter((x) => isWild(x) || x.el === el))) return true;
  }
  // 同じ数字
  for (let num = 1; num <= MAX_NUM; num++) {
    if (!placed.every((x) => (isWild(x) ? WILD_NUMS[x.type].includes(num) : x.num === num))) continue;
    if (tryCombos(pool.filter((x) => (isWild(x) ? wildFits(x, (v) => v === num) : x.num === num)))) return true;
  }
  // 連番
  for (let s = 1; s + cap - 1 <= MAX_NUM; s++) {
    const inRange = (v) => v >= s && v < s + cap;
    if (!placed.every((x) => (isWild(x) ? WILD_NUMS[x.type].some(inRange) : inRange(x.num)))) continue;
    if (tryCombos(pool.filter((x) => (isWild(x) ? wildFits(x, inRange) : inRange(x.num))))) return true;
  }
  // バラ（合計勝負）
  const top = [...pool].sort((x, y) => cardMax(y) - cardMax(x)).slice(0, k);
  return top.length === k && better(top);
}

// 2人のとき：4つ、または隣り合った3つを取ったら即勝利
function instantWinner(state) {
  for (const p of state.players) {
    const owned = state.circles.map((c) => c.owner === p.id);
    if (owned.filter(Boolean).length >= 4) return p.id;
    for (let i = 0; i + 2 < owned.length; i++) if (owned[i] && owned[i + 1] && owned[i + 2]) return p.id;
  }
  return null;
}

function endRound(state, instant = null) {
  // 未決着の魔法陣：そろっている側の勝ち。どちらもそろっていなければ誰のものでもない
  for (const c of state.circles) {
    if (c.decided) continue;
    const cap = capOf(c);
    const fullA = c.sides[c.a].length >= cap;
    const fullB = c.sides[c.b].length >= cap;
    const owner = fullA && !fullB ? c.a : fullB && !fullA ? c.b : null;
    c.decided = true;
    c.owner = owner;
    c.result = { forms: {}, how: 'end' };
  }
  const per = {};
  for (const p of state.players) per[p.id] = { circles: 0, sweeps: 0, bonus: 0, points: 0 };
  for (const c of state.circles) if (per[c.owner]) per[c.owner].circles += 1;
  for (const d of state.duels) {
    const owners = d.circles.map((id) => state.circles[id].owner);
    if (state.players.length > 2 && owners.every((o) => o && o !== 'draw' && o === owners[0])) per[owners[0]].sweeps += 1;
  }
  if (instant) per[instant].bonus = 2;
  for (const p of state.players) {
    const r = per[p.id];
    r.points = r.circles + r.sweeps + r.bonus;
    p.score += r.points;
    p.roundScores.push(r.points);
  }
  state.roundResultSeq += 1;
  state.roundResult = { seq: state.roundResultSeq, round: state.round, per, instant };
  state.phase = state.round >= state.rounds ? 'gameEnd' : 'roundEnd';
}

export function nextRound(state) {
  if (state.phase !== 'roundEnd') throw new Error('次のラウンドに進めません');
  return startRound(state);
}

export function ranking(state) {
  const sorted = [...state.players].sort((a, b) => b.score - a.score);
  let place = 0;
  let prev = null;
  return sorted.map((p, i) => {
    if (p.score !== prev) {
      place = i + 1;
      prev = p.score;
    }
    return { id: p.id, name: p.name, score: p.score, place, roundScores: [...p.roundScores] };
  });
}

export function viewFor(state, pid) {
  const card = (id) => state.cards[id];
  return {
    kind: 'duel',
    phase: state.phase,
    you: pid,
    players: state.players.map((p) => ({
      id: p.id,
      name: p.name,
      isCpu: p.isCpu,
      score: p.score,
      roundScores: [...p.roundScores],
      handCount: state.hands[p.id]?.length ?? 0,
      magicCount: state.hands[p.id] ? magicInHand(state, p.id) : 0,
      active: state.active.includes(p.id),
      submitted: !!state.actions[p.id],
      owned: state.circles.filter((c) => c.owner === p.id).length,
    })),
    seats: [...state.seats],
    round: state.round,
    rounds: state.rounds,
    turn: state.turn,
    duels: state.duels.map((d) => ({ ...d, circles: [...d.circles] })),
    circles: state.circles.map((c) => ({
      id: c.id,
      duel: c.duel,
      a: c.a,
      b: c.b,
      cap: capOf(c),
      fog: c.fog,
      expand: c.expand,
      owner: c.owner,
      decided: c.decided,
      sides: { [c.a]: c.sides[c.a].map(card), [c.b]: c.sides[c.b].map(card) },
      forms: Object.fromEntries([c.a, c.b].map((p) => [p, c.sides[p].length >= capOf(c) ? evaluate(c.sides[p].map(card), c.fog) : null])),
    })),
    hand: (state.hands[pid] ?? []).map(card),
    usable: state.hands[pid] ? usableCards(state, pid) : [],
    myAction: state.actions[pid] ?? null,
    canDrawMagic: state.magicDeck.length > 0,
    deck: { spirit: state.spiritDeck.length, magic: state.magicDeck.length },
    elementCount: elementCountFor(state.players.length),
    resolution: state.resolution,
    roundResult: state.roundResult,
    ranking: ranking(state),
  };
}
