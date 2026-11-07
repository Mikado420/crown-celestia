import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../js/games/duel/game.js';
import { cpuAction } from '../js/games/duel/cpu.js';
import { HostController } from '../js/host.js';

const players = (n) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}`, isCpu: true }));
const sp = (el, num) => ({ id: `s${el}-${num}`, kind: 'spirit', el, num });
const mg = (type) => ({ id: `m-${type}-0`, kind: 'magic', type });

test('役の判定（強い順・合計・ワイルド・霧）', () => {
  const f = (cards, fog) => G.evaluate(cards, fog);
  assert.deepEqual(f([sp(0, 3), sp(0, 4), sp(0, 5)]), { rank: 5, sum: 12 });
  assert.equal(f([sp(0, 7), sp(1, 7), sp(2, 7)]).rank, 4);
  assert.equal(f([sp(0, 1), sp(0, 4), sp(0, 9)]).rank, 3);
  assert.equal(f([sp(0, 1), sp(1, 2), sp(2, 3)]).rank, 2);
  assert.equal(f([sp(0, 1), sp(1, 5), sp(2, 9)]).rank, 1);
  assert.deepEqual(f([sp(0, 8), sp(0, 9), mg('rainbow')]), { rank: 5, sum: 27 }); // 8-9-10
  assert.deepEqual(f([sp(2, 9), sp(2, 10), mg('greater')]), { rank: 5, sum: 27 });
  assert.equal(f([sp(1, 2), sp(4, 2), mg('lesser')]).rank, 4);
  assert.deepEqual(f([sp(0, 1), sp(0, 2), sp(0, 3)], true), { rank: 0, sum: 6 });
  assert.ok(G.beats({ rank: 3, sum: 6 }, { rank: 2, sum: 27 }));
});

test('配置：2人は7つ、3人は三角形で9つ、4〜6人は輪で決闘ごとに2つ', () => {
  assert.equal(G.createGame(players(2), { seed: 1 }).circles.length, 7);
  const s3 = G.createGame(players(3), { seed: 1 });
  assert.equal(s3.circles.length, 9);
  assert.equal(s3.duels.length, 3);
  for (const n of [4, 5, 6]) {
    const s = G.createGame(players(n), { seed: 1 });
    assert.equal(s.circles.length, n * 2);
    for (const p of s.players) assert.equal(G.circlesOf(s, p.id).length, 4);
    assert.equal(s.hands.p0.length, 5);
  }
  assert.equal(Object.values(G.createGame(players(6), { seed: 1 }).cards).filter((c) => c.kind === 'spirit').length, 70);
});

function duel2() {
  const s = G.createGame(players(2), { seed: 5 });
  for (const c of s.circles) c.sides = { p0: [], p1: [] };
  return s;
}

test('同時に出し、両側がそろったら役を比べる。同じなら先にそろえた方', () => {
  const s = duel2();
  s.hands.p0 = ['s0-3', 's0-4', 's0-5', 's1-1'];
  s.hands.p1 = ['s2-7', 's3-7', 's4-7', 's1-2'];
  for (let i = 0; i < 3; i++) {
    G.submit(s, 'p0', { card: s.hands.p0[0], circle: 0 });
    G.submit(s, 'p1', { card: s.hands.p1[0], circle: 0 });
  }
  const c = s.circles[0];
  assert.equal(c.decided, true);
  assert.equal(c.owner, 'p0'); // 同じ属性の連番 > 同じ数字
});

test('片側がそろって相手が逆転できなければ、その場で決着する', () => {
  const s = duel2();
  // p1 が最強の 8-9-10 同属性の連番をそろえ、p0 は何もない
  s.hands.p0 = ['s1-1', 's1-2', 's1-3', 's2-1'];
  s.hands.p1 = ['s0-8', 's0-9', 's0-10', 's2-2'];
  // 虹の精霊などは山から取り除いて、逆転の目を完全になくす
  s.magicDeck = s.magicDeck.filter((id) => !/rainbow|greater|lesser/.test(id));
  for (let i = 0; i < 3; i++) {
    G.submit(s, 'p0', { card: s.hands.p0[0], circle: 1 + i });
    G.submit(s, 'p1', { card: s.hands.p1[0], circle: 0 });
  }
  assert.equal(s.circles[0].owner, 'p1');
  assert.equal(s.circles[0].result.how, 'proof');
});

test('秘術：霧・拡張・送還・魅了・転移と、失敗した秘術は手札に戻る', () => {
  const s = duel2();
  s.circles[0].sides = { p0: ['s0-1'], p1: ['s1-9', 's1-10'] };
  s.hands.p0 = ['m-charm-0', 'm-fog-0', 's2-5'];
  s.hands.p1 = ['m-banish-0', 's3-3'];
  // p0 は p1 の 10 を魅了して陣1へ、p1 は p0 の 1 を送還
  G.submit(s, 'p0', { card: 'm-charm-0', target: { circle: 0, card: 's1-10' }, dest: 1 });
  G.submit(s, 'p1', { card: 'm-banish-0', target: { circle: 0, card: 's0-1' } });
  assert.deepEqual(s.circles[0].sides.p1, ['s1-9']);
  assert.deepEqual(s.circles[0].sides.p0, []);
  assert.deepEqual(s.circles[1].sides.p0, ['s1-10']);
  // 霧
  G.submit(s, 'p0', { card: 'm-fog-0', circle: 2 });
  G.submit(s, 'p1', { card: 's3-3', circle: 2 });
  assert.equal(s.circles[2].fog, true);
  // 同じ精霊を2人が狙ったら、後の方は失敗して手札に戻る
  const t = duel2();
  t.circles[0].sides = { p0: ['s0-2'], p1: ['s1-5'] };
  t.hands.p0 = ['m-banish-0', 's2-2'];
  t.hands.p1 = ['m-transfer-0', 's2-3'];
  G.submit(t, 'p0', { card: 'm-banish-0', target: { circle: 0, card: 's1-5' } });
  G.submit(t, 'p1', { card: 'm-transfer-0', target: { circle: 0, card: 's1-5' }, dest: 'void' });
  const fizz = t.resolution.events.filter((e) => e.type === 'fizzle');
  assert.equal(fizz.length, 1);
  assert.ok(t.hands[fizz[0].pid].includes(fizz[0].card));
});

test('秘術は手札に2枚まで、虹の精霊は自分の場に1体まで', () => {
  const s = duel2();
  s.hands.p0 = ['m-rainbow-0', 'm-fog-0', 's0-5'];
  s.cards['m-x'] = { id: 'm-x', kind: 'magic', type: 'scout' };
  G.submit(s, 'p0', { card: 's0-5', circle: 0, draw: 'magic' });
  assert.equal(s.actions.p0.draw, 'spirit');
  s.circles[1].sides.p0 = ['m-rainbow-1'];
  s.cards['m-rainbow-1'] = { id: 'm-rainbow-1', kind: 'magic', type: 'rainbow' };
  assert.throws(() => G.submit(s, 'p0', { card: 'm-rainbow-0', circle: 2 }));
});

test('CPUだけで全人数の3ラウンドが最後まで進み、カードが増減しない', () => {
  for (let n = 2; n <= 6; n++) {
    for (let seed = 0; seed < 6; seed++) {
      const s = G.createGame(players(n), { seed });
      let guard = 0;
      while (s.phase !== 'gameEnd' && guard++ < 2000) {
        if (s.phase === 'roundEnd') {
          G.nextRound(s);
          continue;
        }
        for (const pid of [...s.active]) {
          if (s.phase !== 'choose' || s.actions[pid]) continue;
          const a = cpuAction(s, pid);
          assert.ok(a, `CPU が行動できない n=${n}`);
          G.submit(s, pid, a);
        }
        const total = Object.keys(s.cards).length;
        const onBoard = s.circles.flatMap((c) => [...c.sides[c.a], ...c.sides[c.b]]).length;
        const held = Object.values(s.hands).flat().length + s.spiritDeck.length + s.magicDeck.length;
        assert.ok(onBoard + held <= total);
        for (const c of s.circles) for (const pid of [c.a, c.b]) assert.ok(c.sides[pid].length <= G.capOf(c));
      }
      assert.equal(s.phase, 'gameEnd', `n=${n} seed=${seed}`);
      assert.equal(s.round, 3);
      for (const p of s.players) assert.equal(p.roundScores.reduce((a, b) => a + b, 0), p.score);
    }
  }
});

function fakeClock() {
  let now = 0;
  let id = 0;
  const q = new Map();
  return {
    now: () => now,
    setTimer: (fn, ms) => (q.set(++id, { at: now + ms, fn }), id),
    clearTimer: (t) => q.delete(t),
    runNext() {
      if (!q.size) return false;
      const [tid, next] = [...q.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      q.delete(tid);
      now = next.at;
      next.fn();
      return true;
    },
  };
}

test('ホスト進行：時間切れでも自動で進み、大会が終わる', () => {
  const clock = fakeClock();
  const views = [];
  const host = new HostController({ hostName: 'ホスト', send: () => {}, onView: (m) => views.push(m), gameId: 'duel', now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer });
  host.hostAction({ type: 'addCpu' });
  host.hostAction({ type: 'addCpu' });
  host.hostAction({ type: 'addCpu' });
  host.hostAction({ type: 'start' });
  const v = views.at(-1).view;
  assert.equal(v.kind, 'duel');
  const card = v.hand.find((c) => c.kind === 'spirit');
  const circle = v.circles.find((c) => (c.a === 'host' || c.b === 'host'));
  host.hostAction({ type: 'cast', action: { card: card.id, circle: circle.id } });
  assert.ok(host.state.actions.host);
  let steps = 0;
  while (host.state.phase !== 'gameEnd' && steps < 50000) {
    clock.runNext();
    steps++;
  }
  assert.equal(host.state.phase, 'gameEnd');
});
