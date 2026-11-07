// 魔法陣の決闘：ホストでの進行（制限時間・CPU・演出待ち）
import * as G from './game.js';
import { cpuAction } from './cpu.js';

export const TIMING = {
  chooseMs: 25000, // 1手番の制限時間
  revealMs: 900, // 全員の札を表にする
  placeMs: 420, // 精霊1体が陣に入る
  spellMs: 900, // 秘術1枚の演出
  decideMs: 1100, // 魔法陣の決着
  roundBreakMs: 10000,
  cpuMinMs: 1200,
  cpuMaxMs: 3200,
};

// 解決の演出にかかる時間（画面側もこの値に合わせて動く）
export function resolutionMs(res, T = TIMING) {
  let ms = T.revealMs + 400;
  for (const e of res.events) {
    if (e.type === 'place') ms += T.placeMs;
    else if (e.type === 'decide') ms += T.decideMs;
    else if (e.type === 'fizzle') ms += 200;
    else ms += T.spellMs;
  }
  return ms;
}

export const duelMode = {
  id: 'duel',
  minPlayers: G.MIN_PLAYERS,
  maxPlayers: G.MAX_PLAYERS,
  timing: TIMING,

  create(players, { seed }) {
    return G.createGame(players, { seed });
  },

  act(state, pid, msg) {
    if (msg.type === 'cast') G.submit(state, pid, msg.action);
    else return false;
    return true;
  },

  phaseKey: (s) => `${s.round}-${s.turn}-${s.phase}`,

  animation(s, T) {
    return s.resolution ? { seq: s.resolution.seq, ms: resolutionMs(s.resolution, T) } : null;
  },

  schedule(ctx, wait) {
    const { state: s, timing: T } = ctx;
    if (s.phase === 'choose') {
      ctx.setDeadline(wait + T.chooseMs);
      for (const p of s.players) {
        if (!p.isCpu || !s.active.includes(p.id)) continue;
        ctx.later(wait + ctx.cpuDelay(), () => {
          if (s.phase !== 'choose' || s.actions[p.id]) return;
          const a = cpuAction(s, p.id, ctx.random);
          if (a) ctx.act(p.id, { type: 'cast', action: a });
        });
      }
      ctx.later(wait + T.chooseMs, () =>
        ctx.apply(() => {
          // 時間切れの人はCPUと同じ考え方で自動的に出す
          for (const pid of [...s.active]) {
            if (s.phase !== 'choose' || s.actions[pid]) continue;
            const a = cpuAction(s, pid, ctx.random);
            if (a) G.submit(s, pid, a);
          }
        }),
      );
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
