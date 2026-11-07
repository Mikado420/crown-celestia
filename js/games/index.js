// ゲームの一覧（演目）
import { tavernMode } from './tavern/mode.js';
import { groveMode } from './grove/mode.js';
import { duelMode } from './duel/mode.js';

export const GAMES = {
  tavern: {
    id: 'tavern',
    title: '酒場のツケ',
    tagline: '満席の卓に座った者が、全員分を払う。',
    motif: '6ニムト風',
    minutes: '10〜15分',
    mode: tavernMode,
  },
  grove: {
    id: 'grove',
    title: '毒杯の晩餐会',
    tagline: '伏せた容疑者の中から、王を毒した犯人を当てる。',
    motif: '藪の中風',
    minutes: '15〜20分',
    mode: groveMode,
  },
  duel: {
    id: 'duel',
    title: '魔法陣の決闘',
    tagline: '隣の魔導士と、精霊を並べて魔法陣を奪い合う。',
    motif: 'バトルライン風',
    minutes: '15分前後',
    mode: duelMode,
  },
};

export const GAME_IDS = Object.keys(GAMES);
export const DEFAULT_GAME = 'tavern';
