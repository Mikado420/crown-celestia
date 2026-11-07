// ホスト（部屋を作った人）のブラウザで動く進行役。ゲームの種類には依存しない。
// 参加者の管理、ゲームの状態、制限時間、CPU、各プレイヤーに見える情報の配信を受け持つ。
// ゲームごとの違いは games/*/mode.js が受け持つ。通信手段にも依存しない（send を差し替えればテストでも動く）。
import { GAMES, DEFAULT_GAME } from './games/index.js';

// 画面の小さなプレイヤー欄に収まるよう短い名前にしている
const CPU_NAMES = ['ドワーフのボルグ', '詩人リュート', '魔導士ミル', '傭兵ガルド', '盗賊チッタ', '賢者オルヴァン', '竜騎士セラ'];

export class HostController {
  constructor({
    hostName,
    send,
    onView,
    roomCode = null,
    gameId = DEFAULT_GAME,
    timings = {},
    now = () => Date.now(),
    setTimer = (fn, ms) => setTimeout(fn, ms),
    clearTimer = (t) => clearTimeout(t),
    random = Math.random,
  }) {
    this.send = send; // (connId, message) => void
    this.onView = onView; // ホスト自身の画面に渡す
    this.roomCode = roomCode;
    this.gameId = GAMES[gameId] ? gameId : DEFAULT_GAME;
    this.timings = timings;
    this.now = now;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.random = random;
    this.hostId = 'host';
    this.players = [{ id: this.hostId, name: hostName, isCpu: false, connId: null }];
    this.nextId = 1;
    this.state = null;
    this.mode = null;
    this.timers = [];
    this.phaseKey = null;
    this.deadline = null;
    this.busyUntil = 0;
    this.lastAnimSeq = 0;
  }

  get game() {
    return GAMES[this.gameId];
  }

  timingFor(mode) {
    return { ...mode.timing, ...(this.timings[mode.id] ?? {}) };
  }

  // ---- ロビー ----
  setGame(id) {
    if (this.state || !GAMES[id]) return;
    if (this.players.length > GAMES[id].mode.maxPlayers) {
      this.notify(this.hostId, { type: 'error', message: `${GAMES[id].title}は${GAMES[id].mode.maxPlayers}人までです` });
      return;
    }
    this.gameId = id;
    this.broadcast();
  }

  addCpu() {
    if (this.state || this.players.length >= this.game.mode.maxPlayers) return;
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
    const max = this.game.mode.maxPlayers;
    if (this.players.length >= max) return this.send(connId, { type: 'error', message: `満員です（最大${max}人）` });
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
    const mode = this.game.mode;
    if (this.players.length < mode.minPlayers || this.players.length > mode.maxPlayers) return false;
    const seed = Math.floor(this.random() * 2 ** 32);
    this.mode = mode;
    this.state = mode.create(this.players, { seed });
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
    this.mode = null;
    this.phaseKey = null;
    this.broadcast();
  }

  // ホストが退出するとき、参加者に店じまいを知らせる
  closeRoom() {
    this.clearAll();
    for (const p of this.players) {
      if (p.connId) this.send(p.connId, { type: 'closed', message: 'ホストが部屋を閉じました' });
    }
    this.onView = null;
  }

  hostAction(msg) {
    if (msg.type === 'addCpu') return this.addCpu();
    if (msg.type === 'remove') return this.removePlayer(msg.id);
    if (msg.type === 'setGame') return this.setGame(msg.id);
    if (msg.type === 'start') return this.start();
    if (msg.type === 'restart') return this.restart();
    this.act(this.hostId, msg);
  }

  act(pid, msg) {
    if (!this.state) return;
    try {
      if (!this.mode.act(this.state, pid, msg)) return;
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
    const timing = this.timingFor(this.mode);
    // 新しい演出があれば、終わるまで次の行動を待たせる
    const anim = this.mode.animation(s, timing);
    if (anim && anim.seq !== this.lastAnimSeq) {
      this.lastAnimSeq = anim.seq;
      this.busyUntil = now + anim.ms;
    }
    const wait = Math.max(0, this.busyUntil - now);
    const key = this.mode.phaseKey(s);
    if (key !== this.phaseKey) {
      this.phaseKey = key;
      this.clearAll();
      this.deadline = null;
      const { cpuMinMs, cpuMaxMs } = timing;
      this.mode.schedule(
        {
          state: s,
          timing,
          random: this.random,
          later: (ms, fn) => this.later(ms, fn),
          act: (pid, msg) => this.act(pid, msg),
          apply: (fn) => {
            fn();
            this.afterChange();
          },
          setDeadline: (ms) => (this.deadline = this.now() + ms),
          cpuDelay: () => cpuMinMs + this.random() * (cpuMaxMs - cpuMinMs),
        },
        wait,
      );
    }
    this.broadcast();
  }

  lobbyMessage(you) {
    return {
      type: 'lobby',
      you,
      code: this.roomCode,
      hostId: this.hostId,
      gameId: this.gameId,
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
        const view = this.mode.viewFor(this.state, p.id);
        view.gameId = this.gameId;
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
