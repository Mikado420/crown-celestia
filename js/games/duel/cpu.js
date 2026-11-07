// 魔法陣の決闘：CPUの思考（見えている盤面から、置き場所ごとに見込みを点数化する）
import { evaluate, beats, capOf, circlesOf, hasRoom, opponentOf, isWild, cardMax, magicInHand, usableCards, MAGIC, MAGIC_HAND_LIMIT } from './game.js';

// 途中の並びから、最終的に狙える役の見込み
function promise(cards, cap) {
  if (!cards.length) return 0;
  const fixed = cards.filter((c) => !isWild(c));
  const nums = fixed.map((c) => c.num);
  const els = new Set(fixed.map((c) => c.el));
  const sameEl = els.size <= 1;
  const sameNum = new Set(nums).size <= 1;
  const span = nums.length ? Math.max(...nums) - Math.min(...nums) : 0;
  const runOk = new Set(nums).size === nums.length && span <= cap - 1;
  const rank = sameEl && runOk ? 5 : sameNum ? 4 : sameEl ? 3 : runOk ? 2 : 1;
  const avg = cards.reduce((s, c) => s + cardMax(c), 0) / cards.length;
  const certainty = 0.55 + (0.45 * cards.length) / cap;
  return rank * 2 * certainty + avg / 5;
}

function placementScore(state, pid, c, card) {
  const cap = capOf(c);
  const opp = opponentOf(c, pid);
  const mine = c.sides[pid].map((id) => state.cards[id]);
  const theirs = c.sides[opp].map((id) => state.cards[id]);
  const after = [...mine, card];
  let score = promise(after, cap) - promise(mine, cap) * 0.6;
  const theirsP = promise(theirs, cap);
  if (after.length === cap) {
    const f = evaluate(after, c.fog);
    if (theirs.length === cap) score += beats(f, evaluate(theirs, c.fog)) ? 6 : -6;
    else score += f.rank * 0.8 - theirsP * 0.3;
  } else {
    score += promise(after, cap) >= theirsP ? 1.2 : -0.4;
  }
  // 勝ち目の薄い陣には、弱いカードを捨てるように置く
  if (theirs.length === cap && mine.length < cap) {
    const best = evaluate(theirs, c.fog);
    if (best.rank >= 4) score += cardMax(card) <= 3 ? 1 : -2;
  }
  return score;
}

function anyAction(state, pid, card, mine) {
  const kind = card.kind === 'spirit' ? 'spirit' : MAGIC[card.type].kind;
  const room = mine.find((c) => hasRoom(c, pid));
  if (kind === 'spirit') return room ? { card: card.id, circle: room.id } : null;
  if (card.type === 'fog' || card.type === 'expand') {
    const c = mine.find((x) => !x[card.type]);
    return c ? { card: card.id, circle: c.id } : null;
  }
  if (card.type === 'scout') return { card: card.id };
  for (const c of mine) {
    const owner = card.type === 'transfer' ? pid : opponentOf(c, pid);
    const id = c.sides[owner][0];
    if (!id) continue;
    if (card.type === 'banish') return { card: card.id, target: { circle: c.id, card: id } };
    if (card.type === 'transfer') return { card: card.id, target: { circle: c.id, card: id }, dest: 'void' };
    if (card.type === 'charm' && room) return { card: card.id, target: { circle: c.id, card: id }, dest: room.id };
  }
  return null;
}

export function cpuAction(state, pid, random = Math.random) {
  const usable = new Set(usableCards(state, pid));
  const hand = state.hands[pid].filter((id) => usable.has(id)).map((id) => state.cards[id]);
  const mine = circlesOf(state, pid).filter((c) => !c.decided);
  const options = [];
  const add = (score, action) => options.push({ score: score + random() * 0.8, action });

  for (const card of hand) {
    const kind = card.kind === 'spirit' ? 'spirit' : MAGIC[card.type].kind;
    if (kind === 'spirit') {
      for (const c of mine) if (hasRoom(c, pid)) add(placementScore(state, pid, c, card) + (card.kind === 'magic' ? 0.5 : 0), { card: card.id, circle: c.id });
    } else if (card.type === 'fog') {
      for (const c of mine.filter((x) => !x.fog)) {
        const opp = opponentOf(c, pid);
        const my = c.sides[pid].map((id) => state.cards[id]);
        const th = c.sides[opp].map((id) => state.cards[id]);
        const mySum = my.reduce((s, x) => s + cardMax(x), 0);
        const thSum = th.reduce((s, x) => s + cardMax(x), 0);
        if (th.length && mySum > thSum && promise(th, capOf(c)) > promise(my, capOf(c))) add(2.5, { card: card.id, circle: c.id });
      }
    } else if (card.type === 'expand') {
      for (const c of mine.filter((x) => !x.expand)) {
        const opp = opponentOf(c, pid);
        if (c.sides[opp].length === 3 && c.sides[pid].length < 3) add(1.6, { card: card.id, circle: c.id });
      }
    } else if (card.type === 'scout') {
      add(hand.filter((x) => x.kind === 'spirit').length <= 2 ? 3 : 0.5, { card: card.id });
    } else if (card.type === 'banish' || card.type === 'charm') {
      for (const c of mine) {
        const opp = opponentOf(c, pid);
        for (const id of c.sides[opp]) {
          const target = state.cards[id];
          const threat = promise(c.sides[opp].map((x) => state.cards[x]), capOf(c)) - promise(c.sides[opp].filter((x) => x !== id).map((x) => state.cards[x]), capOf(c));
          if (card.type === 'banish') add(1.2 + threat, { card: card.id, target: { circle: c.id, card: id } });
          else {
            for (const d of mine.filter((x) => hasRoom(x, pid))) {
              if (d.id === c.id && c.sides[pid].length >= capOf(c)) continue;
              add(1.4 + threat + placementScore(state, pid, d, target) * 0.5, { card: card.id, target: { circle: c.id, card: id }, dest: d.id });
            }
          }
        }
      }
    } else if (card.type === 'transfer') {
      // 勝ち目のない陣から、そろいかけの陣へ移す
      for (const c of mine) {
        for (const id of c.sides[pid]) {
          for (const d of mine.filter((x) => x.id !== c.id && hasRoom(x, pid))) {
            const gain = placementScore(state, pid, d, state.cards[id]) - 1.5;
            if (gain > 0.8) add(gain, { card: card.id, target: { circle: c.id, card: id }, dest: d.id });
          }
        }
      }
    }
  }
  if (!options.length) {
    // どの案も点数が付かなかったときは、使えるカードで何か正しい行動をする
    for (const card of hand) {
      const a = anyAction(state, pid, card, mine);
      if (a) return { ...a, draw: 'spirit' };
    }
    return null;
  }
  options.sort((a, b) => b.score - a.score);
  const action = options[0].action;
  const magicAfter = magicInHand(state, pid) - (state.cards[action.card].kind === 'magic' ? 1 : 0);
  action.draw = magicAfter < MAGIC_HAND_LIMIT && state.magicDeck.length && random() < 0.3 ? 'magic' : 'spirit';
  return action;
}
