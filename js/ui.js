// ゲームをまたいで使う画面の部品
export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const svg = (body, cls = '') => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;

const CROWN = '<path d="M3.5 18.5h17"/><path d="M4.5 16L3.5 7.5l5 3.5 3.5-6 3.5 6 5-3.5-1 8.5z"/>';
const MUG = '<path d="M5 7h10v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2z"/><path d="M15 10h2.5a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2H15"/><path d="M5 7c0-2 1.5-3 3-3 .8-1 2.2-1.3 3.4-.6C12.3 2.7 15 3 15 7"/>';
const GOBLET = '<path d="M7 3h10c0 5-2 8.5-5 8.5S7 8 7 3z"/><path d="M12 11.5V19M8 21h8"/><path d="M8.5 6.5h7"/>';

export const ICON = {
  menu: svg('<path d="M4 7h16M4 12h16M4 17h16"/>'),
  close: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  crown: svg(CROWN),
  mug: svg(MUG),
  goblet: svg(GOBLET),
  lock: svg('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>'),
  swap: svg('<path d="M4 8h13l-3-3M20 16H7l3 3"/>'),
  eye: svg('<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>'),
};
export const PATHS = { CROWN, MUG, GOBLET };

// プレイヤーの色（席順）
export const SEAT_COLORS = ['#e8b44a', '#6fb1d6', '#d77a8f', '#86c48a', '#b493e0', '#e09a5b'];

export const initial = (name) => Array.from(String(name ?? '?'))[0] ?? '?';

export const sleep = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)));

export const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');

// 正の字（1画ずつ）。drawn=true で書き順に描くアニメーション
const STROKES = ['M3 3H17', 'M10 3V17', 'M10 10H15', 'M5 9V17', 'M2 17H18'];
export function tallyHtml(n, { drawn = false } = {}) {
  let out = '';
  let k = 0;
  for (let left = n; left > 0; left -= 5) {
    const strokes = STROKES.slice(0, Math.min(5, left))
      .map((d) => `<path d="${d}" style="--k:${k++}"/>`)
      .join('');
    out += `<svg viewBox="0 0 20 20" aria-hidden="true">${strokes}</svg>`;
  }
  return `<span class="tally${drawn ? ' drawn' : ''}" aria-label="${n}">${out}</span>`;
}

// 要素の複製を、別の要素の位置まで弧を描いて飛ばす
export function fly(el, target, ms, { scale = null, fade = false, arc = 24 } = {}) {
  const a = el.getBoundingClientRect();
  const b = target.getBoundingClientRect();
  const ghost = el.cloneNode(true);
  ghost.classList.add('flyer');
  Object.assign(ghost.style, { left: `${a.left}px`, top: `${a.top}px`, width: `${a.width}px`, height: `${a.height}px` });
  document.body.appendChild(ghost);
  el.style.visibility = 'hidden';
  const s = scale ?? b.width / a.width;
  const dx = b.left + b.width / 2 - (a.left + a.width / 2);
  const dy = b.top + b.height / 2 - (a.top + a.height / 2);
  const run = ghost.animate(
    [
      { transform: 'translate(0, 0) scale(1)', opacity: 1 },
      { transform: `translate(${dx * 0.5}px, ${dy * 0.5 - arc}px) scale(${(1 + s) / 2 + 0.08})`, opacity: 1, offset: 0.5 },
      { transform: `translate(${dx}px, ${dy}px) scale(${s})`, opacity: fade ? 0 : 1 },
    ],
    { duration: reduceMotion.matches ? 1 : ms, easing: 'cubic-bezier(.35,.6,.25,1)', fill: 'forwards' },
  );
  return run.finished.catch(() => {}).then(() => ghost.remove());
}

export function floatText(target, text, cls = '') {
  const r = target.getBoundingClientRect();
  const f = document.createElement('span');
  f.className = `float ${cls}`;
  f.textContent = text;
  Object.assign(f.style, { left: `${r.left + r.width / 2}px`, top: `${r.top + 6}px` });
  document.body.appendChild(f);
  setTimeout(() => f.remove(), 1400);
}
