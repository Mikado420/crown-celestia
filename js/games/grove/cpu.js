// 毒杯の晩餐会：CPUの思考
// 自分の知っている情報から、まだ見ていない容疑者のあらゆる組み合わせを数えて、各席が犯人である確率を出す。
import { CHIPS, SLOT_COUNT, culpritSlot, knownSlots, canSwap, JESTER } from './game.js';

function permutations(pool, k) {
  if (k === 0) return [[]];
  const out = [];
  pool.forEach((c, i) => {
    const rest = [...pool.slice(0, i), ...pool.slice(i + 1)];
    for (const tail of permutations(rest, k - 1)) out.push([c, ...tail]);
  });
  return out;
}

export function culpritProbs(state, pid, { useTestimony = false } = {}) {
  const known = knownSlots(state, pid).map((k) => (k && !k.stale ? k.chip : null));
  const excluded = new Set();
  if (state.hands[pid] != null) excluded.add(state.hands[pid]);
  // すり替えで抜かれた人物（古い情報）は、もう容疑者にはいない
  for (const k of state.knowledge[pid] ?? []) if (k.version !== state.slotVersion[k.slot]) excluded.add(k.chip);
  for (const c of known) if (c != null) excluded.add(c);
  const pool = CHIPS.filter((c) => !excluded.has(c));
  const unknown = known.map((c, i) => (c == null ? i : -1)).filter((i) => i >= 0);
  const counts = [0, 0, 0];
  let total = 0;
  for (const perm of permutations(pool, unknown.length)) {
    const sus = [...known];
    unknown.forEach((slot, i) => (sus[slot] = perm[i]));
    counts[culpritSlot(sus)] += 1;
    total += 1;
  }
  let probs = counts.map((c) => (total ? c / total : 1 / SLOT_COUNT));
  if (useTestimony) {
    // 他人の証言は半信半疑で少しだけ反映する
    const w = [1, 1, 1];
    for (const h of state.history) {
      if (!h.testimony || h.pid === pid) continue;
      w[h.testimony.slot] *= h.testimony.claim === 'black' ? 1.25 : 0.85;
    }
    probs = probs.map((p, i) => p * w[i]);
    const sum = probs.reduce((a, b) => a + b, 0) || 1;
    probs = probs.map((p) => p / sum);
  }
  return probs;
}

const argmax = (xs) => xs.reduce((b, x, i) => (x > xs[b] ? i : b), 0);
const argmin = (xs) => xs.reduce((b, x, i) => (x < xs[b] ? i : b), 0);

export function cpuInvestigate(state, pid, random = Math.random) {
  const known = knownSlots(state, pid);
  const hand = state.hands[pid];
  // 道化師や怪しい人物を持っていれば、すり替えて事件を動かすこともある
  if (canSwap(state, pid) && (hand === JESTER || hand >= 8) && random() < 0.5) {
    const targets = [0, 1, 2].filter((s) => !known[s] || known[s].stale);
    const slot = targets.length ? targets[Math.floor(random() * targets.length)] : Math.floor(random() * SLOT_COUNT);
    return { action: 'swap', slot };
  }
  const allowed = [0, 1, 2].filter((s) => s !== state.lastTestimonySlot);
  const fresh = allowed.filter((s) => !known[s] || known[s].stale);
  const pick = fresh.length ? fresh : allowed;
  return { action: 'look', slot: pick[Math.floor(random() * pick.length)] };
}

// 得点になるのは「犯人をクロと言い当てた証言」だけなので、本命をクロと言うことが多い。
// ときどき嘘で惑わせる（本命をシロ、ありえない席をクロ）。
export function cpuTestify(state, pid, random = Math.random) {
  const probs = culpritProbs(state, pid);
  const likely = argmax(probs);
  const unlikely = argmin(probs);
  const r = random();
  if (r < 0.45) return { slot: likely, claim: 'black' };
  if (r < 0.6) return { slot: unlikely, claim: 'white' };
  if (r < 0.8) return { slot: unlikely, claim: 'black' };
  return { slot: likely, claim: 'white' };
}

export function cpuAccuse(state, pid, random = Math.random) {
  const probs = culpritProbs(state, pid, { useTestimony: true }).map((p) => p + random() * 0.05);
  const slot = argmax(probs);
  return { slot, stake: probs[slot] >= 0.7 ? 2 : 1 };
}
