// 魔法陣の決闘：精霊カード・秘術の頁・魔法陣の見た目
import { svg } from '../../ui.js';
import { ELEMENTS, MAGIC } from './game.js';

export const ELEMENT_COLORS = ['#ff6b4a', '#4aa3ff', '#4fd18b', '#d8a04e', '#ffd95a', '#a77bff', '#8ff0ff'];

const ELEMENT_ICONS = [
  '<path d="M12 3c1 4 5 5.5 5 10a5 5 0 0 1-10 0c0-2.5 1.5-3.5 2.5-5.5.5 2 1.5 2.5 2.5 2.5 0-3-1-4.5 0-7z"/>',
  '<path d="M12 3.5c3.5 4.5 6 7.7 6 10.5a6 6 0 0 1-12 0c0-2.8 2.5-6 6-10.5z"/>',
  '<path d="M3 9h11a3 3 0 1 0-3-3"/><path d="M3 13h15a3 3 0 1 1-3 3"/><path d="M3 17h7"/>',
  '<path d="M2.5 19l6.5-11 4 6 2.5-3.5L21.5 19z"/>',
  '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>',
  '<path d="M18.5 15.5A7.5 7.5 0 0 1 8.5 5a7.5 7.5 0 1 0 10 10.5z"/>',
  '<path d="M12 2.5v19M3.8 7.2l16.4 9.6M3.8 16.8l16.4-9.6"/><path d="M9.5 4.5L12 7l2.5-2.5M9.5 19.5L12 17l2.5 2.5"/>',
];

export const MAGIC_ICONS = {
  rainbow: '<path d="M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.4 6.7 19.4l1.2-6L3.4 9.3l6-.7z"/>',
  greater: '<path d="M12 2l1.8 6.2L20 10l-6.2 1.8L12 18l-1.8-6.2L4 10l6.2-1.8z"/><path d="M19 17l.7 2.3 2.3.7-2.3.7L19 23l-.7-2.3-2.3-.7 2.3-.7z"/>',
  lesser: '<circle cx="7" cy="8" r="2"/><circle cx="16.5" cy="7" r="1.5"/><circle cx="12" cy="16" r="2.6"/>',
  fog: '<path d="M3 9c3-2 5 2 8 0s5-2 8 0M3 13c3-2 5 2 8 0s5-2 8 0M3 17c3-2 5 2 8 0s5-2 8 0"/>',
  expand: '<circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="7.5"/><path d="M12 1.5v3M12 19.5v3M1.5 12h3M19.5 12h3"/>',
  scout: '<circle cx="12" cy="10" r="6"/><path d="M7 20h10M8.5 16.5L7 20M15.5 16.5L17 20"/><path d="M9.5 8.5a3 3 0 0 1 2.5-1.5"/>',
  transfer: '<path d="M4 12a8 8 0 0 1 13.7-5.6M20 12a8 8 0 0 1-13.7 5.6"/><path d="M17.7 3v3.4h-3.4M6.3 21v-3.4h3.4"/>',
  banish: '<circle cx="12" cy="12" r="8"/><path d="M8.5 8.5l7 7M15.5 8.5l-7 7"/>',
  charm: '<path d="M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.3 4.3 4.3 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10z"/>',
};

export const elementIcon = (el, cls = 'd-el') => svg(ELEMENT_ICONS[el], cls);
export const magicIcon = (type, cls = 'd-mi') => svg(MAGIC_ICONS[type], cls);

// 精霊カード（盤面・手札）。精霊になる秘術は虹色のカードとして描く。
export function spiritHtml(card, { tag = 'div', cls = '', attrs = '' } = {}) {
  if (card.kind === 'magic') {
    const label = card.type === 'rainbow' ? '虹' : card.type === 'greater' ? '8' : '1-3';
    return `<${tag} class="d-card wild ${card.type} ${cls}" data-card="${card.id}" ${attrs} aria-label="${MAGIC[card.type].name}">
      <span class="d-num">${label}</span>${magicIcon(card.type, 'd-big')}
    </${tag}>`;
  }
  return `<${tag} class="d-card ${cls}" data-card="${card.id}" style="--e:${ELEMENT_COLORS[card.el]}" ${attrs} aria-label="${ELEMENTS[card.el]}の${card.num}">
    <span class="d-num">${card.num}</span>${elementIcon(card.el)}${elementIcon(card.el, 'd-big')}
  </${tag}>`;
}

// 秘術の頁（手札）
export function pageHtml(card, { tag = 'button', cls = '', attrs = '' } = {}) {
  const m = MAGIC[card.type];
  return `<${tag} class="d-page ${card.type} ${cls}" data-card="${card.id}" ${attrs} aria-label="${m.name}：${m.text}">
    ${magicIcon(card.type, 'd-pi')}<span class="d-pn">${m.name}</span>
  </${tag}>`;
}

export function handCardHtml(card, opts) {
  if (card.kind === 'magic' && MAGIC[card.type].kind !== 'spirit') return pageHtml(card, opts);
  if (card.kind === 'magic') return pageHtml(card, { ...opts, cls: `${opts.cls ?? ''} as-spirit` });
  return spiritHtml(card, opts);
}

// 魔法陣の紋様
export const CIRCLE_GLYPH = `<svg class="d-glyph" viewBox="0 0 100 100" aria-hidden="true">
  <circle cx="50" cy="50" r="46"/><circle cx="50" cy="50" r="38" class="thin"/>
  <path d="M50 12L83 69H17z"/><path d="M50 88L17 31h66z" class="thin"/>
  <circle cx="50" cy="50" r="12"/>
</svg>`;
