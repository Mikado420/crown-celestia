// ホスト（部屋を作った人）のブラウザで動く進行役。
// エンジンの状態を持ち、CPUと時間切れを処理し、各プレイヤーに見える情報だけを送る。
// 通信手段には依存しない（send を差し替えればテストでも動く）。
import * as G from './game.js';
import { cpuChooseCard, cpuChooseTable } from './cpu.js';

export const TIMING = {
  chooseMs: 30000, // カードを選ぶ制限時間
  tableMs: 20000, // 卓を選ぶ制限時間
  revealMs: 1400, // 公開してから着席が始まるまで
  stepMs: 750, // 1人が着席する演出の長さ
  roundBreakMs: 9000, // ラウンド間の休憩
  cpuMinMs: 1200,
  cpuMaxMs: 3500,
};

const CPU_NAMES = [
  '酔いどれドワーフのボルグ',
  '吟遊詩人リュート',
  '見習い魔導士ミル',
  '傭兵ガルド',
  '盗賊ネズミのチッタ',
  '老賢者オルヴァン',
  '竜騎士セラ',
];

export class HostController {
  constructor({ hostName, send, onView, roomCode = null, timing = TIMING, now = () => Date.now(), setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = (t) => clearTimeout(t), random = Math.random }) {
    this.send = send; // (connId, message) => void
    this.onView = onView; // ホスト自身の画面に渡す
    this.roomCode = roomCode;
    this.timing = timing;
    this.now = now;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.random = random;
    this.hostId = 'host';
    this.players = [{ id: this.hostId, name: hostName, isCpu: false, connId: null }];
    this.nextId = 1;
    this.state = null;
    this.timers = [];
    this.phaseKey = null;
    this.deadline = null;
    this.busyUntil = 0;
    this.lastAnimSeq = 0;
  }

  // ---- ロビー ----
  addCpu() {
    if (this.state || this.players.length >= G.MAX_PLAYERS) return;
    const used = new Set(this.players.map((p) => p.name));
    const name = CPU_NAMES.find((n) => !used.has(n)) ?? `CPU${this.nextId}`;
    this.players.push({ id: `cpu${this.nextId++}`, name, isCpu: true, connId: null });
    this.broadcast();
  }

  removePlayer(id) {
    if (this.state || id === this.hostId) return;
    const p = this.players.find((x) => x.id === id);
    if (!p) return;
    this.players = this.players.filter((x) => x.id !== id);
    if (p.connId) this.send(p.connId, { type: 'kicked', message: 'ホストに退出させられました' });
    this.broadcast();
  }

  handleJoin(connId, name) {
    if (this.state) return this.send(connId, { type: 'error', message: 'すでに大会が始まっています' });
    if (this.players.length >= G.MAX_PLAYERS) return this.send(connId, { type: 'error', message: '満員です（最大6人）' });
    const clean = String(name ?? '').trim().slice(0, 16) || '名無しの冒険者';
    const id = `p${this.nextId++}`;
    this.players.push({ id, name: clean, isCpu: false, connId });
    this.send(connId, { type: 'welcome', id });
    this.broadcast();
  }

  handleMessage(connId, msg) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'join') return this.handleJoin(connId, msg.name);
    const player = this.players.find((p) => p.connId === connId);
    if (!player) return;
    this.act(player.id, msg);
  }

  handleDisconnect(connId) {
    const player = this.players.find((p) => p.connId === connId);
    if (!player) return;
    player.connId = null;
    if (!this.state) {
      this.players = this.players.filter((p) => p !== player);
      this.broadcast();
      return;
    }
    // 対局中に抜けた人はCPUが代打ちする
    player.isCpu = true;
    const sp = this.state.players.find((p) => p.id === player.id);
    sp.isCpu = true;
    sp.name = `${sp.name}（代打）`;
    player.name = sp.name;
    this.phaseKey = null; // CPUの予定を組み直す
    this.afterChange();
  }

  // ---- 進行 ----
  start() {
    if (this.players.length < G.MIN_PLAYERS) return false;
    const seed = Math.floor(this.random() * 2 ** 32);
    this.state = G.createGame(this.players, { seed });
    G.startRound(this.state);
    this.lastAnimSeq = 0;
    this.busyUntil = 0;
    this.phaseKey = null;
    this.afterChange();
    return true;
  }

  restart() {
    if (!this.state || this.state.phase !== 'gameEnd') return;
    this.clearAll();
    // 抜けた人（代打）は外して、もう一度ロビーから
    this.players = this.players.filter((p) => p.id === this.hostId || p.connId || p.id.startsWith('cpu'));
    this.state = null;
    this.phaseKey = null;
    this.broadcast();
  }

  hostAction(msg) {
    if (msg.type === 'addCpu') return this.addCpu();
    if (msg.type === 'remove') return this.removePlayer(msg.id);
    if (msg.type === 'start') return this.start();
    if (msg.type === 'restart') return this.restart();
    this.act(this.hostId, msg);
  }

  act(pid, msg) {
    if (!this.state) return;
    try {
      if (msg.type === 'play') G.playCard(this.state, pid, msg.rank);
      else if (msg.type === 'chooseTable') G.chooseTable(this.state, pid, msg.index);
      else return;
    } catch (e) {
      this.notify(pid, { type: 'error', message: e.message });
      return;
    }
    this.afterChange();
  }

  notify(pid, msg) {
    if (pid === this.hostId) return this.onView?.(msg);
    const p = this.players.find((x) => x.id === pid);
    if (p?.connId) this.send(p.connId, msg);
  }

  clearAll() {
    for (const t of this.timers) this.clearTimer(t);
    this.timers = [];
  }

  later(ms, fn) {
    this.timers.push(this.setTimer(fn, Math.max(0, ms)));
  }

  afterChange() {
    const s = this.state;
    const now = this.now();
    // 新しい着席処理があれば、演出が終わるまで次の行動を待たせる
    if (s.resolution && s.resolution.seq !== this.lastAnimSeq) {
      this.lastAnimSeq = s.resolution.seq;
      this.busyUntil = now + this.timing.revealMs + s.resolution.events.length * this.timing.stepMs + 600;
    }
    const wait = Math.max(0, this.busyUntil - now);
    const key = `${s.round}-${s.turn}-${s.phase}`;
    if (key !== this.phaseKey) {
      this.phaseKey = key;
      this.clearAll();
      this.schedule(wait);
    }
    this.broadcast();
  }

  cpuDelay() {
    const { cpuMinMs, cpuMaxMs } = this.timing;
    return cpuMinMs + this.random() * (cpuMaxMs - cpuMinMs);
  }

  schedule(wait) {
    const s = this.state;
    const now = this.now();
    this.deadline = null;
    if (s.phase === 'choosing') {
      this.deadline = now + wait + this.timing.chooseMs;
      for (const p of s.players) {
        if (!p.isCpu) continue;
        this.later(wait + this.cpuDelay(), () => {
          if (s.phase !== 'choosing' || s.plays[p.id] != null) return;
          this.act(p.id, { type: 'play', rank: cpuChooseCard(s, p.id, this.random) });
        });
      }
      this.later(wait + this.timing.chooseMs, () => {
        if (s.phase !== 'choosing') return;
        // 時間切れの人はCPUと同じ考え方で自動的に出す
        for (const p of s.players) {
          if (s.phase === 'choosing' && s.plays[p.id] == null) G.playCard(s, p.id, cpuChooseCard(s, p.id, this.random));
        }
        this.afterChange();
      });
    } else if (s.phase === 'choosingTable') {
      const who = s.players.find((p) => p.id === s.awaiting);
      const ms = who.isCpu ? wait + this.timing.revealMs + this.cpuDelay() : wait + this.timing.revealMs + this.timing.tableMs;
      if (!who.isCpu) this.deadline = now + ms;
      this.later(ms, () => {
        if (s.phase !== 'choosingTable') return;
        this.act(who.id, { type: 'chooseTable', index: cpuChooseTable(s) });
      });
    } else if (s.phase === 'roundEnd') {
      this.deadline = now + wait + this.timing.roundBreakMs;
      this.later(wait + this.timing.roundBreakMs, () => {
        if (s.phase !== 'roundEnd') return;
        G.nextRound(s);
        this.afterChange();
      });
    }
  }

  lobbyMessage(you) {
    return {
      type: 'lobby',
      you,
      code: this.roomCode,
      hostId: this.hostId,
      players: this.players.map((p) => ({ id: p.id, name: p.name, isCpu: p.isCpu })),
    };
  }

  broadcast() {
    const now = this.now();
    for (const p of this.players) {
      if (p.isCpu && p.id !== this.hostId) continue;
      let msg;
      if (!this.state) {
        msg = this.lobbyMessage(p.id);
      } else {
        const view = G.viewFor(this.state, p.id);
        view.deadlineIn = this.deadline ? Math.max(0, this.deadline - now) : null;
        view.waitIn = Math.max(0, this.busyUntil - now);
        view.isHost = p.id === this.hostId;
        view.code = this.roomCode;
        msg = { type: 'state', view };
      }
      if (p.id === this.hostId) this.onView?.(msg);
      else if (p.connId) this.send(p.connId, msg);
    }
  }
}
