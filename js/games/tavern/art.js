// 酒場のツケ：冒険者カードと卓の紋
import { baseTab, HEAVY_TAB } from './game.js';
import { svg, PATHS } from '../../ui.js';

// 職業の紋章（格が上がるほど位の高い職業）
const ICONS = {
  sword: '<path d="M18.5 3.5h2v2L9.5 16.5l-2-2z"/><path d="M6 13l5 5M8.5 18.5l-4 2 2-4"/>',
  dagger: '<path d="M12 2.5l2 3v8h-4v-8z"/><path d="M8 13.5h8M12 13.5v4"/><circle cx="12" cy="19.5" r="1.8"/>',
  bow: '<path d="M7 3c8 3 8 15 0 18"/><path d="M7 3v18M4 12h14"/><path d="M15.5 9.5L18.5 12l-3 2.5"/>',
  cross: '<path d="M12 3v18M7 8.5h10"/><path d="M9 21h6"/>',
  lute: '<circle cx="9" cy="15" r="5"/><circle cx="9" cy="15" r="1.3"/><path d="M12.5 11.5L19 5M17 3l4 4"/>',
  staff: '<path d="M6 21L14.5 9"/><circle cx="16.5" cy="6.5" r="3"/><path d="M20.5 2.5l-.5 1.5M22 6.5h-1.5"/>',
  flask: '<path d="M9.5 3h5M10.5 3v6L5 19.2a1.3 1.3 0 0 0 1.2 1.8h11.6a1.3 1.3 0 0 0 1.2-1.8L13.5 9V3"/><path d="M7.5 15h9"/>',
  shield: '<path d="M12 3l7.5 3v5.5c0 4.8-3.2 7.9-7.5 9.5-4.3-1.6-7.5-4.7-7.5-9.5V6z"/><path d="M12 7v10M8 11h8"/>',
  crown: '<path d="M3.5 18.5h17"/><path d="M4.5 16L3.5 7.5l5 3.5 3.5-6 3.5 6 5-3.5-1 8.5z"/>',
};

const JOBS = [
  ['見習い剣士', 'sword'],
  ['盗賊', 'dagger'],
  ['弓使い', 'bow'],
  ['僧侶', 'cross'],
  ['吟遊詩人', 'lute'],
  ['魔導士', 'staff'],
  ['錬金術師', 'flask'],
  ['騎士', 'shield'],
  ['王族', 'crown'],
];

export function jobOf(rank, deckSize) {
  if (rank === 55) return ['ギルド長', 'crown'];
  return JOBS[Math.min(JOBS.length - 1, Math.floor(((rank - 1) / deckSize) * JOBS.length))];
}

const MUG = PATHS.MUG;
const BACK = '<path d="M3.5 18.5h17"/><path d="M4.5 16L3.5 7.5l5 3.5 3.5-6 3.5 6 5-3.5-1 8.5z"/><circle cx="12" cy="13" r="1.2"/>';

export function tabOf(view, rank) {
  return view?.heavy?.includes(rank) ? HEAVY_TAB : baseTab(rank);
}

// 冒険者カード（数字・紋章・ツケの硬貨）
export function cardHtml(view, rank, { tag = 'div', cls = '', attrs = '' } = {}) {
  const tab = tabOf(view, rank);
  const heavy = view?.heavy?.includes(rank);
  const [job, icon] = jobOf(rank, view?.deckSize ?? 104);
  return `<${tag} class="card t${tab}${heavy ? ' heavy' : ''} ${cls}" data-rank="${rank}" ${attrs} aria-label="格${rank}の${job}、ツケ${tab}${heavy ? '、大酒飲み' : ''}">
    <span class="num">${rank}</span>
    ${svg(ICONS[icon], 'emblem')}
    <span class="foot">${heavy ? svg(MUG, 'mug') : ''}<span class="coin">${tab}</span></span>
  </${tag}>`;
}

export function backHtml() {
  return `<div class="card back">${svg(BACK, 'emblem')}</div>`;
}

// 裏から表に返せるカード
export function flipHtml(view, rank, faceUp) {
  return `<div class="flip${faceUp ? ' up' : ''}" data-rank="${rank}"><div class="flip-inner">${backHtml()}${cardHtml(view, rank)}</div></div>`;
}

// 卓の紋（樫・竜骨・月影・暖炉）
export const TABLE_ICONS = [
  '<path d="M12 21v-6"/><path d="M12 15c-4.5 0-7-2.7-7-6 1.6.4 2.4-.6 2.4-2C9 7.6 10.2 6 12 3c1.8 3 3 4.6 4.6 4 0 1.4.8 2.4 2.4 2 0 3.3-2.5 6-7 6z"/>',
  '<path d="M7 5a2 2 0 1 1 3 1.7L14 11a2 2 0 1 1 2.3 3l1 1A2 2 0 1 1 17 19a2 2 0 1 1-3-1.7L10 13a2 2 0 1 1-2.3-3l-1-1A2 2 0 1 1 7 5z"/>',
  '<path d="M19 15.5A8 8 0 0 1 8.5 5a8 8 0 1 0 10.5 10.5z"/><path d="M17 4l.5 1.5L19 6l-1.5.5L17 8l-.5-1.5L15 6l1.5-.5z"/>',
  '<path d="M12 21c-3.9 0-6.5-2.6-6.5-6 0-3.1 2.4-4.8 3.4-7.6.6 1.6 1.4 2.4 2.4 2.6C11 7 12 4.7 14 3c0 3.5 4.5 6 4.5 12 0 3.4-2.6 6-6.5 6z"/><path d="M12 21c-1.7 0-2.8-1.1-2.8-2.6 0-1.6 1.6-2.6 2.8-4.4 1.2 1.8 2.8 2.8 2.8 4.4 0 1.5-1.1 2.6-2.8 2.6z"/>',
].map((body) => svg(body, 'table-icon'));
