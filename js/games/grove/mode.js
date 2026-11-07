// 毒杯の晩餐会：ホストでの進行（制限時間・CPU・演出待ち）
import * as G from './game.js';
import { cpuInvestigate, cpuTestify, cpuAccuse } from './cpu.js';

export const TIMING = {
  actMs: 20000, // 調べる／すり替えるを選ぶ時間
  testifyMs: 15000, // 証言の時間
  bigActMs: 15000, // 5〜6人のとき
  bigTestifyMs: 12000,
  accuseMs: 25000, // 告発の時間
  actionAnimMs: 1000, // 行動の演出（全員に見せる）
  revealMs: 6500, // 真相公開の演出
  caseBreakMs: 12000, // 事件の顛末を読む時間
  cpuMinMs: 1500,
  cpuMaxMs: 3500,
};

export const groveMode = {
  id: 'grove',
  minPlayers: G.MIN_PLAYERS,
  maxPlayers: G.MAX_PLAYERS,
  timing: TIMING,

  create(players, { seed }) {
    return G.createGame(players, { seed });
  },

  act(state, pid, msg) {
    if (msg.type === 'investigate') G.investigate(state, pid, msg.action, msg.slot);
    else if (msg.type === 'testify') G.testify(state, pid, msg.slot, msg.claim);
    else if (msg.type === 'accuse') G.accuse(state, pid, msg.slot, msg.stake);
    else return false;
    return true;
  },

  phaseKey: (s) => `${s.caseNo}-${s.step}-${s.phase}`,

  animation(s, T) {
    if (!s.animSeq) return null;
    return { seq: s.animSeq, ms: s.animKind === 'reveal' ? T.revealMs : T.actionAnimMs };
  },

  schedule(ctx, wait) {
    const { state: s, timing: T } = ctx;
    const big = s.players.length >= 5;
    if (s.phase === 'act' || s.phase === 'testify') {
      const pid = G.currentPlayer(s);
      const who = s.players.find((p) => p.id === pid);
      const limit = s.phase === 'act' ? (big ? T.bigActMs : T.actMs) : big ? T.bigTestifyMs : T.testifyMs;
      const phase = s.phase;
      const step = s.step;
      const still = () => s.phase === phase && s.step === step;
      const move = () =>
        phase === 'act'
          ? { type: 'investigate', ...cpuInvestigate(s, pid, ctx.random) }
          : { type: 'testify', ...cpuTestify(s, pid, ctx.random) };
      if (who.isCpu) {
        ctx.later(wait + ctx.cpuDelay() * (phase === 'act' ? 1 : 0.7), () => still() && ctx.act(pid, move()));
      } else {
        ctx.setDeadline(wait + limit);
        ctx.later(wait + limit, () => still() && ctx.act(pid, move()));
      }
    } else if (s.phase === 'accuse') {
      ctx.setDeadline(wait + T.accuseMs);
      for (const p of s.players) {
        if (!p.isCpu) continue;
        ctx.later(wait + ctx.cpuDelay(), () => {
          if (s.phase === 'accuse' && !s.accusations[p.id]) ctx.act(p.id, { type: 'accuse', ...cpuAccuse(s, p.id, ctx.random) });
        });
      }
      ctx.later(wait + T.accuseMs, () =>
        ctx.apply(() => {
          for (const p of s.players) {
            if (s.phase === 'accuse' && !s.accusations[p.id]) {
              const a = cpuAccuse(s, p.id, ctx.random);
              G.accuse(s, p.id, a.slot, a.stake);
            }
          }
        }),
      );
    } else if (s.phase === 'caseEnd') {
      ctx.setDeadline(wait + T.caseBreakMs);
      ctx.later(wait + T.caseBreakMs, () =>
        ctx.apply(() => {
          if (s.phase === 'caseEnd') G.nextCase(s);
        }),
      );
    }
  },

  viewFor: (s, pid) => G.viewFor(s, pid),
};
