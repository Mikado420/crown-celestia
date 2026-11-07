import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../js/game.js';
import { cpuChooseCard, cpuChooseTable } from '../js/cpu.js';
import { HostController } from '../js/host.js';

const players = (n) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}`, isCpu: true }));

test('人数別のカード枚数とラウンド数', () => {
  assert.equal(G.deckSizeFor(2), 25);
  assert.equal(G.deckSizeFor(4), 45);
  assert.equal(G.deckSizeFor(6), 65);
  assert.equal(G.roundsFor(2), 4);
  assert.equal(G.roundsFor(5), 3);
});

test('基本のツケ', () => {
  assert.equal(G.baseTab(55), 7);
  assert.equal(G.baseTab(22), 5);
  assert.equal(G.baseTab(30), 3);
  assert.equal(G.baseTab(15), 2);
  assert.equal(G.baseTab(7), 1);
});

test('ラウンド開始時の配り方', () => {
  const s = G.createGame(players(4), { seed: 1 });
  G.startRound(s);
  const all = [s.sleeper, ...s.tables.flat(), ...Object.values(s.hands).flat()].sort((a, b) => a - b);
  assert.deepEqual(all, Array.from({ length: 45 }, (_, i) => i + 1));
  assert.equal(s.heavy.length, 2);
  for (const h of s.heavy) {
    assert.equal(G.baseTab(h), 1);
    assert.notEqual(h, s.sleeper);
    assert.equal(G.tabOf(s, h), 5);
  }
});

function fixed(n) {
  const s = G.createGame(players(n), { seed: 3 });
  G.startRound(s);
  s.heavy = [];
  return s;
}

test('一番近い小さい数字の卓に座る', () => {
  const s = fixed(2);
  s.tables = [[12], [33], [48], [70]];
  s.hands = { p0: [35, 1, 2], p1: [50, 3, 4] };
  G.playCard(s, 'p0', 35);
  G.playCard(s, 'p1', 50);
  assert.deepEqual(s.tables, [[12], [33, 35], [48, 50], [70]]);
  assert.equal(s.phase, 'choosing');
});

test('6人目は卓のツケを払い、新しい先頭になる', () => {
  const s = fixed(2);
  s.tables = [[1, 2, 3, 4, 10], [40], [50], [60]];
  s.hands = { p0: [11, 5], p1: [41, 6] };
  G.playCard(s, 'p0', 11);
  G.playCard(s, 'p1', 41);
  assert.deepEqual(s.tables[0], [11]);
  assert.equal(s.players[0].debt, 1 + 1 + 1 + 1 + 3);
  assert.equal(s.resolution.events[0].type, 'full');
});

test('どこにも座れないときは卓を選んで肩代わりする', () => {
  const s = fixed(2);
  s.tables = [[20, 21], [30], [40, 45], [50]];
  s.hands = { p0: [5, 6], p1: [31, 7] };
  G.playCard(s, 'p0', 5);
  G.playCard(s, 'p1', 31);
  assert.equal(s.phase, 'choosingTable');
  assert.equal(s.awaiting, 'p0');
  assert.throws(() => G.chooseTable(s, 'p1', 0));
  G.chooseTable(s, 'p0', 2);
  assert.deepEqual(s.tables, [[20, 21], [30, 31], [5], [50]]);
  assert.equal(s.players[0].debt, 3 + 2);
});

test('出し直しができ、全員そろうまで公開されない', () => {
  const s = fixed(2);
  const [a, b] = s.hands.p0;
  G.playCard(s, 'p0', a);
  G.playCard(s, 'p0', b);
  assert.equal(s.plays.p0, b);
  const view = G.viewFor(s, 'p1');
  assert.equal(view.players[0].played, true);
  assert.equal(view.myPlay, null);
  assert.equal(JSON.stringify(view).includes(`"hand":[${s.hands.p0.join(',')}]`), false);
});

test('CPUだけで全人数の大会が最後まで進み、カードが消えない', () => {
  for (let n = 2; n <= 6; n++) {
    for (let seed = 0; seed < 30; seed++) {
      const s = G.createGame(players(n), { seed });
      G.startRound(s);
      let taken = 0;
      while (s.phase !== 'gameEnd') {
        if (s.phase === 'roundEnd') {
          G.nextRound(s);
          taken = 0;
        } else if (s.phase === 'choosing') {
          for (const p of s.players) if (s.phase === 'choosing') G.playCard(s, p.id, cpuChooseCard(s, p.id));
        } else if (s.phase === 'choosingTable') {
          G.chooseTable(s, s.awaiting, cpuChooseTable(s));
        }
        if (s.resolution) {
          for (const e of s.resolution.events) if (e.cards) taken += e.cards.length;
        }
        if (s.phase === 'choosing') {
          const count = 1 + s.tables.flat().length + Object.values(s.hands).flat().length;
          assert.ok(count <= s.deckSize);
        }
      }
      assert.equal(s.round, G.roundsFor(n));
      for (const p of s.players) {
        assert.equal(p.roundDebts.length, s.rounds);
        assert.equal(p.roundDebts.reduce((a, b) => a + b, 0), p.debt);
      }
    }
  }
});

// 仮想時計で HostController を動かす
function fakeClock() {
  let now = 0;
  let id = 0;
  const queue = new Map();
  return {
    now: () => now,
    setTimer: (fn, ms) => {
      queue.set(++id, { at: now + ms, fn });
      return id;
    },
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

test('ホスト進行：参加・CPU追加・時間切れ・切断の代打ちで大会が終わる', () => {
  const clock = fakeClock();
  const sent = [];
  const hostViews = [];
  const host = new HostController({
    hostName: 'ホスト',
    roomCode: 'ABCDE',
    send: (connId, msg) => sent.push({ connId, msg }),
    onView: (msg) => hostViews.push(msg),
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  });
  host.handleMessage('c1', { type: 'join', name: 'ゲスト' });
  assert.equal(sent.find((s) => s.msg.type === 'welcome').msg.id, 'p1');
  host.hostAction({ type: 'addCpu' });
  assert.equal(host.players.length, 3);
  host.hostAction({ type: 'start' });
  assert.equal(host.state.phase, 'choosing');

  // ゲストは最初の手番だけ自分で出す
  const guestView = sent.filter((s) => s.connId === 'c1' && s.msg.type === 'state').at(-1).msg.view;
  host.handleMessage('c1', { type: 'play', rank: guestView.hand[0] });
  assert.equal(host.state.plays.p1, guestView.hand[0]);

  // 途中参加は拒否される
  host.handleMessage('c2', { type: 'join', name: '遅刻者' });
  assert.equal(sent.at(-1).msg.type, 'error');

  let steps = 0;
  while (host.state.phase !== 'gameEnd' && steps < 5000) {
    if (steps === 40) host.handleDisconnect('c1');
    clock.runNext();
    steps++;
  }
  assert.equal(host.state.phase, 'gameEnd');
  assert.match(host.state.players[1].name, /代打/);
  assert.equal(hostViews.at(-1).view.phase, 'gameEnd');

  host.hostAction({ type: 'restart' });
  assert.equal(host.state, null);
  assert.deepEqual(host.players.map((p) => p.id), ['host', 'cpu2']);
});
