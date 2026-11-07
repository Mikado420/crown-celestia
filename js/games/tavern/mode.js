// 酒場のツケ：ホストでの進行（制限時間・CPU・演出待ち）
import * as G from './game.js';
import { cpuChooseCard, cpuChooseTable } from './cpu.js';

export const TIMING = {
  chooseMs: 30000, // カードを選ぶ制限時間
  tableMs: 20000, // 卓を選ぶ制限時間
  revealMs: 1500, // 出し札を表に返してから着席が始まるまで
  stepMs: 650, // 1人が着席する演出の長さ
  takeMs: 2000, // 満席・相席お断りでツケを払う演出の長さ
  roundBreakMs: 9000, // ラウンド間の休憩
  cpuMinMs: 1200,
  cpuMaxMs: 3500,
};

// 着席の演出にかかる時間（画面側もこの値に合わせて動く）
export function resolutionMs(resolution, timing = TIMING) {
  const steps = resolution.events.reduce((sum, e) => sum + (e.type === 'seat' ? timing.stepMs : timing.takeMs), 0);
  return timing.revealMs + steps + 600;
}

export const tavernMode = {
  id: 'tavern',
  minPlayers: G.MIN_PLAYERS,
  maxPlayers: G.MAX_PLAYERS,
  timing: TIMING,

  create(players, { seed }) {
    const state = G.createGame(players, { seed });
    G.startRound(state);
    return state;
  },

  act(state, pid, msg) {
    if (msg.type === 'play') G.playCard(state, pid, msg.rank);
    else if (msg.type === 'chooseTable') G.chooseTable(state, pid, msg.index);
    else return false;
    return true;
  },

  phaseKey: (s) => `${s.round}-${s.turn}-${s.phase}`,

  animation(s, timing) {
    return s.resolution ? { seq: s.resolution.seq, ms: resolutionMs(s.resolution, timing) } : null;
  },

  schedule(ctx, wait) {
    const { state: s, timing: T } = ctx;
    if (s.phase === 'choosing') {
      ctx.setDeadline(wait + T.chooseMs);
      for (const p of s.players) {
        if (!p.isCpu) continue;
        ctx.later(wait + ctx.cpuDelay(), () => {
          if (s.phase !== 'choosing' || s.plays[p.id] != null) return;
          ctx.act(p.id, { type: 'play', rank: cpuChooseCard(s, p.id, ctx.random) });
        });
      }
      ctx.later(wait + T.chooseMs, () =>
        ctx.apply(() => {
          // 時間切れの人はCPUと同じ考え方で自動的に出す
          for (const p of s.players) {
            if (s.phase === 'choosing' && s.plays[p.id] == null) G.playCard(s, p.id, cpuChooseCard(s, p.id, ctx.random));
          }
        }),
      );
    } else if (s.phase === 'choosingTable') {
      const who = s.players.find((p) => p.id === s.awaiting);
      const ms = who.isCpu ? wait + T.revealMs + ctx.cpuDelay() : wait + T.revealMs + T.tableMs;
      if (!who.isCpu) ctx.setDeadline(ms);
      ctx.later(ms, () => {
        if (s.phase === 'choosingTable') ctx.act(who.id, { type: 'chooseTable', index: cpuChooseTable(s) });
      });
    } else if (s.phase === 'roundEnd') {
      ctx.setDeadline(wait + T.roundBreakMs);
      ctx.later(wait + T.roundBreakMs, () =>
        ctx.apply(() => {
          if (s.phase === 'roundEnd') G.nextRound(s);
        }),
      );
    }
  },

  viewFor: (s, pid) => G.viewFor(s, pid),
};
