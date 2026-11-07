// 効果音（音声ファイルを使わずWeb Audioで合成）
let ctx = null;
let enabled = true;
try {
  enabled = localStorage.getItem('cc-sound') !== 'off';
} catch {
  enabled = true;
}

function audio() {
  if (!enabled) return null;
  try {
    ctx ??= new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(freq, { at = 0, dur = 0.12, type = 'sine', gain = 0.07, to = null } = {}) {
  const a = audio();
  if (!a) return;
  const t = a.currentTime + at;
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (to) osc.frequency.exponentialRampToValueAtTime(to, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(a.destination);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

function noise({ at = 0, dur = 0.25, gain = 0.05, freq = 1200 } = {}) {
  const a = audio();
  if (!a) return;
  const t = a.currentTime + at;
  const buf = a.createBuffer(1, Math.floor(a.sampleRate * dur), a.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
  const src = a.createBufferSource();
  const filter = a.createBiquadFilter();
  const g = a.createGain();
  src.buffer = buf;
  filter.type = 'bandpass';
  filter.frequency.value = freq;
  g.gain.value = gain;
  src.connect(filter).connect(g).connect(a.destination);
  src.start(t);
}

// 店のざわめき（低いノイズ）と暖炉のはぜる音
let amb = null;
function ambience(on) {
  if (!on || !enabled) {
    if (amb) {
      amb.gain.gain.setTargetAtTime(0, amb.ctx.currentTime, 0.3);
      const old = amb;
      setTimeout(() => {
        try {
          old.src.stop();
        } catch {
          /* 停止済み */
        }
      }, 1200);
      clearTimeout(old.timer);
      amb = null;
    }
    return;
  }
  if (amb) return;
  const a = audio();
  if (!a) return;
  const len = a.sampleRate * 4;
  const buf = a.createBuffer(1, len, a.sampleRate);
  const data = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) {
    last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; // ブラウンノイズ
    data[i] = last * 3.5;
  }
  const src = a.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  const lp = a.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 520;
  const gain = a.createGain();
  gain.gain.value = 0;
  gain.gain.setTargetAtTime(0.06, a.currentTime, 1);
  src.connect(lp).connect(gain).connect(a.destination);
  src.start();
  amb = { ctx: a, src, gain, timer: null };
  const crackle = () => {
    if (!amb) return;
    const pops = 1 + Math.floor(Math.random() * 3);
    for (let i = 0; i < pops; i++) noise({ at: i * 0.04, dur: 0.03, gain: 0.03 + Math.random() * 0.03, freq: 1800 + Math.random() * 2500 });
    amb.timer = setTimeout(crackle, 300 + Math.random() * 1600);
  };
  crackle();
}

export const sfx = {
  get enabled() {
    return enabled;
  },
  set enabled(v) {
    enabled = v;
    try {
      localStorage.setItem('cc-sound', v ? 'on' : 'off');
    } catch {
      /* 保存できなくても続ける */
    }
  },
  pick: () => tone(660, { dur: 0.08, type: 'triangle', gain: 0.06 }),
  flip: () => noise({ dur: 0.12, gain: 0.08, freq: 2400 }),
  // 木の卓にジョッキを置く音
  seat: () => {
    noise({ dur: 0.07, gain: 0.07, freq: 380 });
    tone(150, { dur: 0.12, type: 'sine', gain: 0.08, to: 90 });
    tone(1900, { at: 0.02, dur: 0.18, type: 'sine', gain: 0.012 });
  },
  // 入口のドアベル
  bell: () => {
    [[1318, 0], [1046, 0.16], [1318, 0.42], [1046, 0.58]].forEach(([f, at]) => {
      tone(f, { at, dur: 0.6, type: 'sine', gain: 0.045 });
      tone(f * 2.76, { at, dur: 0.25, type: 'sine', gain: 0.01 });
    });
  },
  ambience,
  // 晩餐会：幕が上がる音
  curtain: () => noise({ dur: 0.45, gain: 0.07, freq: 900 }),
  // 封蝋を押す音
  stamp: () => {
    noise({ dur: 0.06, gain: 0.09, freq: 300 });
    tone(110, { dur: 0.16, type: 'sine', gain: 0.09, to: 70 });
  },
  // すり替え（素早い2回の衣擦れ）
  swap: () => {
    noise({ dur: 0.16, gain: 0.07, freq: 1500 });
    noise({ at: 0.18, dur: 0.16, gain: 0.07, freq: 2100 });
    tone(520, { at: 0.05, dur: 0.25, type: 'triangle', gain: 0.03, to: 780 });
  },
  // 道化師の笑い（上下する音）
  jester: () => {
    [880, 660, 990, 740, 1100, 830].forEach((f, i) => tone(f, { at: i * 0.08, dur: 0.12, type: 'square', gain: 0.025 }));
  },
  // 銅鑼
  gong: () => {
    tone(98, { dur: 1.6, type: 'sine', gain: 0.12 });
    tone(147, { dur: 1.2, type: 'sine', gain: 0.05 });
    tone(262, { dur: 0.6, type: 'triangle', gain: 0.02 });
  },
  alarm: () => {
    tone(520, { dur: 0.14, type: 'square', gain: 0.04 });
    tone(390, { at: 0.16, dur: 0.22, type: 'square', gain: 0.04 });
  },
  coins: () => {
    [1568, 1319, 1760, 1175, 1568].forEach((f, i) => tone(f, { at: i * 0.06, dur: 0.14, type: 'triangle', gain: 0.05 }));
  },
  tick: () => tone(1000, { dur: 0.04, type: 'square', gain: 0.025 }),
  open: () => {
    [392, 523, 659].forEach((f, i) => tone(f, { at: i * 0.11, dur: 0.3, type: 'triangle', gain: 0.06 }));
  },
  fanfare: () => {
    [523, 659, 784, 1047].forEach((f, i) => tone(f, { at: i * 0.13, dur: 0.4, type: 'triangle', gain: 0.07 }));
  },
};
