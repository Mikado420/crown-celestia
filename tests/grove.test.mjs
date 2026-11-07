import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../js/games/grove/game.js';
import { culpritProbs, cpuInvestigate, cpuTestify, cpuAccuse } from '../js/games/grove/cpu.js';
import { HostController } from '../js/host.js';

const players = (n) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}`, isCpu: true }));

test('犯人の決まり方：一番怪しい者。道化師がいれば逆転、道化師自身は犯人にならない', () => {
  assert.equal(G.culpritSlot([3, 9, 5]), 1);
  assert.equal(G.culpritSlot([3, G.JESTER, 5]), 0);
  assert.equal(G.culpritSlot([G.JESTER, 8, 2]), 2);
  assert.equal(G.culpritSlot([1, 2, 3]), 2);
});

test('事件の準備：容疑者3人と手持ち1枚ずつ、事件の数は人数（2人は6件）', () => {
  const s = G.createGame(players(4), { seed: 1 });
  const used = [...s.suspects, ...Object.values(s.hands)];
  assert.equal(new Set(used).size, 7);
  assert.equal(s.cases, 4);
  assert.equal(G.createGame(players(2), { seed: 1 }).cases, 6);
  assert.equal(s.phase, 'act');
  assert.equal(G.currentPlayer(s), 'p0');
});

function fixed() {
  const s = G.createGame(players(3), { seed: 2 });
  s.suspects = [4, 7, 2];
  s.hands = { p0: 9, p1: G.JESTER, p2: 1 };
  return s;
}

test('調べると自分だけが知り、証言した席は次の人が調べられない', () => {
  const s = fixed();
  G.investigate(s, 'p0', 'look', 1);
  assert.equal(G.viewFor(s, 'p0').lastLook.chip, 7);
  assert.equal(G.viewFor(s, 'p1').lastLook, null);
  assert.throws(() => G.investigate(s, 'p0', 'look', 0)); // 証言が先
  G.testify(s, 'p0', 2, 'black');
  assert.equal(G.currentPlayer(s), 'p1');
  assert.throws(() => G.investigate(s, 'p1', 'look', 2));
  G.investigate(s, 'p1', 'look', 0);
  assert.equal(G.viewFor(s, 'p1').known[0].chip, 4);
});

test('すり替え：抜いた人物は誰も見ず、他人の情報は古くなり、1人1回まで', () => {
  const s = fixed();
  G.investigate(s, 'p0', 'look', 1);
  G.testify(s, 'p0', 1, 'black');
  G.investigate(s, 'p1', 'swap', 1);
  assert.deepEqual(s.suspects, [4, G.JESTER, 2]);
  assert.equal(s.hands.p1, null);
  assert.deepEqual(s.discard, [7]);
  assert.equal(G.viewFor(s, 'p0').known[1].stale, true);
  assert.equal(G.viewFor(s, 'p1').known[1].chip, G.JESTER);
  G.testify(s, 'p1', 0, 'white');
  G.investigate(s, 'p2', 'look', 2);
  G.testify(s, 'p2', 2, 'white');
  G.investigate(s, 'p0', 'look', 0);
  G.testify(s, 'p0', 0, 'white');
  assert.throws(() => G.investigate(s, 'p1', 'swap', 0));
});

test('2周で告発に移り、得点は「賭け×（外れた人数＋1）」、外れは−賭け、本当の証言は+1', () => {
  const s = fixed(); // 犯人は二の席（7）
  const turns = [
    ['p0', 1, 'black'], // 本当
    ['p1', 0, 'black'], // 嘘
    ['p2', 1, 'white'], // 嘘
    ['p0', 0, 'white'], // 本当
    ['p1', 2, 'white'], // 本当
    ['p2', 1, 'black'], // 本当
  ];
  for (const [pid, slot, claim] of turns) {
    const look = [0, 1, 2].find((x) => x !== s.lastTestimonySlot);
    G.investigate(s, pid, 'look', look);
    G.testify(s, pid, slot, claim);
  }
  assert.equal(s.phase, 'accuse');
  G.accuse(s, 'p0', 1, 2);
  G.accuse(s, 'p1', 0, 1);
  G.accuse(s, 'p1', 1, 1); // 変更できる
  G.accuse(s, 'p2', 0, 2);
  assert.equal(s.phase, 'caseEnd');
  const e = Object.fromEntries(s.result.entries.map((x) => [x.pid, x]));
  assert.equal(s.result.culprit, 1);
  assert.equal(e.p0.accusePts, 2 * (1 + 1));
  assert.equal(e.p1.accusePts, 1 * (1 + 1));
  assert.equal(e.p2.accusePts, -2);
  assert.equal(e.p0.honest, 2);
  assert.equal(e.p1.honest, 1);
  assert.equal(e.p2.honest, 1);
  assert.equal(s.players[0].score, 6);
});

test('CPUの確率：3人とも分かっていれば確実に当てる', () => {
  const s = fixed();
  s.knowledge.p0 = [0, 1, 2].map((slot) => ({ slot, chip: s.suspects[slot], version: 0, how: 'look' }));
  assert.deepEqual(culpritProbs(s, 'p0'), [0, 1, 0]);
  const p = culpritProbs(s, 'p1');
  assert.ok(Math.abs(p.reduce((a, b) => a + b, 0) - 1) < 1e-9);
});

test('CPUだけで全人数の大会が最後まで進む', () => {
  for (let n = 2; n <= 6; n++) {
    for (let seed = 0; seed < 20; seed++) {
      const s = G.createGame(players(n), { seed });
      let guard = 0;
      while (s.phase !== 'gameEnd' && guard++ < 1000) {
        if (s.phase === 'act') {
          const pid = G.currentPlayer(s);
          const m = cpuInvestigate(s, pid);
          G.investigate(s, pid, m.action, m.slot);
        } else if (s.phase === 'testify') {
          const pid = G.currentPlayer(s);
          const m = cpuTestify(s, pid);
          G.testify(s, pid, m.slot, m.claim);
        } else if (s.phase === 'accuse') {
          for (const p of s.players) if (s.phase === 'accuse') {
            const a = cpuAccuse(s, p.id);
            G.accuse(s, p.id, a.slot, a.stake);
          }
        } else if (s.phase === 'caseEnd') {
          G.nextCase(s);
        }
        assert.equal(s.suspects.length, 3);
      }
      assert.equal(s.phase, 'gameEnd');
      assert.equal(s.caseNo, G.casesFor(n));
      for (const p of s.players) assert.equal(p.caseScores.reduce((a, b) => a + b, 0), p.score);
    }
  }
});

function fakeClock() {
  let now = 0;
  let id = 0;
  const queue = new Map();
  return {
    now: () => now,
    setTimer: (fn, ms) => (queue.set(++id, { at: now + ms, fn }), id),
    clearTimer: (t) => queue.delete(t),
    runNext() {
      if (!queue.size) return false;
      const [tid, next] = [...queue.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      queue.delete(tid);
      now = next.at;
      next.fn();
      return true;
    },
  };
}

test('ホスト進行：晩餐会に切り替えて、時間切れと切断を挟んでも大会が終わる', () => {
  const clock = fakeClock();
  const sent = [];
  const views = [];
  const host = new HostController({
    hostName: 'ホスト', send: (c, m) => sent.push({ c, m }), onView: (m) => views.push(m),
    now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer,
  });
  host.handleMessage('c1', { type: 'join', name: 'ゲスト' });
  host.hostAction({ type: 'addCpu' });
  host.hostAction({ type: 'setGame', id: 'grove' });
  assert.equal(views.at(-1).gameId, 'grove');
  host.hostAction({ type: 'start' });
  assert.equal(host.state.phase, 'act');
  // ホストの手番：調べて証言する
  host.hostAction({ type: 'investigate', action: 'look', slot: 0 });
  assert.equal(views.at(-1).view.lastLook.slot, 0);
  host.hostAction({ type: 'testify', slot: 0, claim: 'white' });
  let steps = 0;
  while (host.state.phase !== 'gameEnd' && steps < 20000) {
    if (steps === 30) host.handleDisconnect('c1');
    clock.runNext();
    steps++;
  }
  assert.equal(host.state.phase, 'gameEnd');
  assert.equal(host.state.caseNo, 3);
  assert.match(host.state.players[1].name, /代打/);
});
