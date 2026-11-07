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
  seat: () => {
    noise({ dur: 0.08, gain: 0.06, freq: 500 });
    tone(220, { dur: 0.1, type: 'triangle', gain: 0.05 });
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
