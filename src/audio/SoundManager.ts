// SoundManager — port Oldgame/src/audio/* (core.js, engine.js, sfx.js, music.js, ambience.js, audio.js) do TypeScript.
// Wszystko jest syntezowane w WebAudio (oscylatory, szum, filtry, pogłos splotowy, sekwencer) — zero plików audio.
// Niezależny od Phasera poza `attach(game)`, który odblokowuje AudioContext przy pierwszym geście gracza.
//
// Użycie w scenie Phasera:
//   import { SoundManager } from '../audio/SoundManager';
//   SoundManager.sfx('hit');                       // efekt
//   SoundManager.sfx('click', { vol: 0.5, pitch: 1.2 });
//   SoundManager.music('combat');                  // crossfade, null = stop
//   SoundManager.ambience('wind');                 // 'wind' | 'ruins' | 'town' | 'none'
// W main.ts raz: SoundManager.attach(game);

import type Phaser from 'phaser';

// ───────────────────────────── core: helpery syntezy ─────────────────────────────
// Każdy helper przyjmuje (ctx, destination, time, opts), więc działa też w OfflineAudioContext.

type Ctx = BaseAudioContext;
type Rng = () => number;

const noiseCache = new WeakMap<Ctx, AudioBuffer>();
function noiseBuf(c: Ctx): AudioBuffer {
  let b = noiseCache.get(c);
  if (!b) {
    const n = Math.floor(c.sampleRate * 2);
    b = c.createBuffer(1, n, c.sampleRate);
    const d = b.getChannelData(0);
    let s = 1234567;
    for (let i = 0; i < n; i++) {
      s = (s * 1664525 + 1013904223) >>> 0;
      d[i] = s / 2147483648 - 1;
    }
    noiseCache.set(c, b);
  }
  return b;
}

const mtof = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);
const jit = (x: number): number => 1 + (Math.random() * 2 - 1) * x;
const rnd = (a: number, b: number): number => a + Math.random() * (b - a);

function mulberry32(a: number): Rng {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const curves = new Map<number, Float32Array<ArrayBuffer>>();
function shaperCurve(k = 30): Float32Array<ArrayBuffer> {
  let c = curves.get(k);
  if (!c) {
    c = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) {
      const x = i / 512 - 1;
      c[i] = Math.tanh(x * k * 0.1 + x * 1.5) * 0.8;
    }
    curves.set(k, c);
  }
  return c;
}

function makeImpulse(c: Ctx, secs = 2.4, power = 2.6): AudioBuffer {
  const n = Math.floor(c.sampleRate * secs);
  const b = c.createBuffer(2, n, c.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = b.getChannelData(ch);
    let lp = 0;
    let s = 987 + ch * 77;
    for (let i = 0; i < n; i++) {
      s = (s * 1664525 + 1013904223) >>> 0;
      const x = s / 2147483648 - 1;
      const k = i / n;
      lp += (x - lp) * (0.9 - 0.8 * k); // ciemnieje z czasem
      d[i] = lp * Math.pow(1 - k, power) * (i < 200 ? i / 200 : 1);
    }
  }
  return b;
}

interface NoiseOpts {
  type?: BiquadFilterType;
  f?: number;
  f2?: number;
  q?: number;
  a?: number;
  d?: number;
  vol?: number;
}

/** Filtrowany impuls szumu. */
function noise(c: Ctx, out: AudioNode, t: number, o: NoiseOpts = {}) {
  const { type = 'bandpass', f = 1000, f2, q = 1, a = 0.002, d = 0.2, vol = 0.5 } = o;
  const src = c.createBufferSource();
  src.buffer = noiseBuf(c);
  src.loop = true;
  const fl = c.createBiquadFilter();
  fl.type = type;
  fl.frequency.setValueAtTime(f, t);
  fl.Q.value = q;
  if (f2) fl.frequency.exponentialRampToValueAtTime(f2, t + a + d);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vol, t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  src.connect(fl);
  fl.connect(g);
  g.connect(out);
  src.start(t, Math.random() * 1.5);
  src.stop(t + a + d + 0.05);
  return { src, fl, g };
}

interface ToneOpts {
  type?: OscillatorType;
  f?: number;
  f2?: number;
  a?: number;
  d?: number;
  vol?: number;
  lp?: number;
  hp?: number;
  det?: number;
  hold?: number;
}

/** Oscylator z przemiataniem wysokości i obwiednią. */
function tone(c: Ctx, out: AudioNode, t: number, o: ToneOpts = {}) {
  const { type = 'sine', f = 440, f2, a = 0.004, d = 0.2, vol = 0.4, lp, hp, det = 0, hold = 0 } = o;
  if (f > 16000) return null;
  const os = c.createOscillator();
  os.type = type;
  os.frequency.setValueAtTime(f, t);
  if (det) os.detune.value = det;
  if (f2) os.frequency.exponentialRampToValueAtTime(f2, t + a + hold + d);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vol, t + a);
  if (hold) g.gain.setValueAtTime(vol, t + a + hold);
  g.gain.exponentialRampToValueAtTime(0.0001, t + a + hold + d);
  let n: AudioNode = os;
  if (lp) {
    const fl = c.createBiquadFilter();
    fl.type = 'lowpass';
    fl.frequency.value = lp;
    n.connect(fl);
    n = fl;
  }
  if (hp) {
    const fl = c.createBiquadFilter();
    fl.type = 'highpass';
    fl.frequency.value = hp;
    n.connect(fl);
    n = fl;
  }
  n.connect(g);
  g.connect(out);
  os.start(t);
  os.stop(t + a + hold + d + 0.05);
  return { os, g };
}

/** Bufor szarpanej struny Karplus-Strong (cache per kontekst + częstotliwość). */
const ksCache = new WeakMap<Ctx, Map<string, AudioBuffer>>();
function ksBuffer(c: Ctx, f: number, dur = 2.2, bright = 0.5): AudioBuffer {
  let m = ksCache.get(c);
  if (!m) {
    m = new Map();
    ksCache.set(c, m);
  }
  const key = Math.round(f * 4) + ':' + bright;
  const cached = m.get(key);
  if (cached) return cached;
  const sr = c.sampleRate;
  const n = Math.floor(sr * dur);
  const N = Math.max(2, Math.round(sr / f));
  const b = c.createBuffer(1, n, sr);
  const d = b.getChannelData(0);
  const ring = new Float32Array(N);
  let s = (key.length * 7919 + Math.round(f)) >>> 0;
  let lp = 0;
  for (let i = 0; i < N; i++) {
    s = (s * 1664525 + 1013904223) >>> 0;
    const x = s / 2147483648 - 1;
    lp += (x - lp) * bright;
    ring[i] = lp * 1.6;
  }
  let p = 0;
  const decay = 0.9985 - Math.min(0.004, (8 / f) * 0.01);
  for (let i = 0; i < n; i++) {
    const nx = (p + 1) % N;
    d[i] = ring[p];
    ring[p] = (ring[p] + ring[nx]) * 0.5 * decay;
    p = nx;
  }
  if (m.size > 160) m.clear();
  m.set(key, b);
  return b;
}

// ───────────────────────────── engine: szyny miksu ─────────────────────────────

export interface Buses {
  master: GainNode;
  comp: DynamicsCompressorNode;
  sfx: GainNode;
  music: GainNode;
  amb: GainNode;
  sfxWet: GainNode;
  musicWet: GainNode;
  revIn: GainNode;
}

/** Graf szyn: sfx/music/amb -> master -> kompresor -> wyjście, plus wspólny pogłos. */
export function createBuses(c: Ctx, dest: AudioNode = c.destination): Buses {
  const master = c.createGain();
  const comp = c.createDynamicsCompressor();
  comp.threshold.value = -16;
  comp.knee.value = 18;
  comp.ratio.value = 5;
  comp.attack.value = 0.003;
  comp.release.value = 0.22;
  master.connect(comp);
  comp.connect(dest);
  const mk = () => {
    const g = c.createGain();
    g.connect(master);
    return g;
  };
  const sfx = mk();
  const music = mk();
  const amb = mk();
  const revIn = c.createGain();
  const conv = c.createConvolver();
  const revRet = c.createGain();
  conv.buffer = makeImpulse(c);
  revRet.gain.value = 0.55;
  revIn.connect(conv);
  conv.connect(revRet);
  revRet.connect(master);
  const sfxWet = c.createGain();
  const musicWet = c.createGain();
  sfxWet.connect(revIn);
  musicWet.connect(revIn);
  return { master, comp, sfx, music, amb, sfxWet, musicWet, revIn };
}

// ───────────────────────────── sfx: efekty dźwiękowe ─────────────────────────────

interface SfxDef {
  /** czas trwania [s] — do sprzątania węzłów i liczenia aktywnych głosów */
  dur: number;
  /** poziom wysyłki na pogłos */
  rev: number;
  /** max jednoczesnych instancji tego efektu */
  max?: number;
  /** min odstęp między odtworzeniami [s] */
  gap?: number;
  /** P = mnożnik wysokości (już z losowym rozrzutem) */
  fn(c: Ctx, out: AudioNode, t: number, P: number): void;
}

const metal = (c: Ctx, out: AudioNode, t: number, f: number, vol: number, d = 0.6) => {
  for (const r of [1, 2.76, 5.4, 8.9]) tone(c, out, t, { f: f * r, d: d / (1 + r * 0.15), vol: vol / (1 + r * 0.4) });
};
const clink = (c: Ctx, out: AudioNode, t: number, f: number, vol = 0.25) => {
  metal(c, out, t, f, vol, 0.35);
  noise(c, out, t, { type: 'highpass', f: 6000, d: 0.012, vol: vol * 0.6 });
};
const thump = (c: Ctx, out: AudioNode, t: number, f: number, d: number, vol: number) =>
  tone(c, out, t, { f, f2: f * 0.35, d, vol });

interface GunKit {
  crack: number;
  cd: number;
  cv: number;
  sub: number;
  sd: number;
  sv: number;
  tail: number;
  td: number;
  tv: number;
}
function gun(c: Ctx, out: AudioNode, t: number, P: number, k: GunKit): void {
  noise(c, out, t, { f: k.crack * P, f2: k.crack * 0.25 * P, q: 0.7, d: k.cd, vol: k.cv });
  noise(c, out, t, { type: 'highpass', f: 5000, d: 0.015, vol: 0.3 });
  thump(c, out, t, k.sub * P, k.sd, k.sv);
  noise(c, out, t + 0.01, { type: 'lowpass', f: k.tail, f2: 120, d: k.td, vol: k.tv });
}
const rate = (t: number, n: number, gap: number, fn: (t: number, i: number) => void) => {
  for (let i = 0; i < n; i++) fn(t + i * gap * jit(0.1), i);
};

const SFX = {
  click: { dur: 0.1, rev: 0.05, max: 3, fn(c, o, t, P) {
    noise(c, o, t, { f: 3200 * P, q: 2, d: 0.02, vol: 0.22 });
    tone(c, o, t, { type: 'triangle', f: 950 * P, f2: 600 * P, d: 0.05, vol: 0.14 });
  } },
  hover: { dur: 0.05, rev: 0, max: 2, gap: 0.07, fn(c, o, t, P) {
    tone(c, o, t, { f: 1700 * P, d: 0.03, vol: 0.035 });
  } },
  dice: { dur: 1.2, rev: 0.12, max: 2, fn(c, o, t, P) {
    let gap = 0.035, tt = t, vol = 0.45;
    for (let i = 0; i < 11; i++) {
      noise(c, o, tt, { f: rnd(1800, 4800) * P, q: 3, d: 0.025, vol });
      tone(c, o, tt, { type: 'triangle', f: rnd(700, 1500) * P, f2: 400, d: 0.05, vol: vol * 0.5 });
      if (i % 3 == 0) tone(c, o, tt, { type: 'square', f: rnd(2500, 3500) * P, d: 0.008, vol: vol * 0.15 });
      tt += gap; gap *= 1.27; vol *= 0.93;
    }
  } },
  hit: { dur: 0.4, rev: 0.12, max: 4, fn(c, o, t, P) {
    noise(c, o, t, { f: 1400 * P, f2: 300, q: 0.8, d: 0.09, vol: 0.7 });
    thump(c, o, t, 150 * P, 0.14, 0.8);
    noise(c, o, t, { type: 'lowpass', f: 700, d: 0.16, vol: 0.45 });
  } },
  crit: { dur: 1.2, rev: 0.25, max: 3, fn(c, o, t, P) {
    noise(c, o, t, { f: 1800 * P, f2: 250, q: 0.8, d: 0.12, vol: 0.75 });
    thump(c, o, t, 170 * P, 0.2, 0.9);
    noise(c, o, t, { type: 'highpass', f: 4000, d: 0.04, vol: 0.4 });
    metal(c, o, t + 0.01, 1150 * P, 0.4, 1.0);
    tone(c, o, t, { type: 'sawtooth', f: 3000 * P, f2: 300, d: 0.1, vol: 0.14, lp: 5000 });
  } },
  miss: { dur: 0.4, rev: 0.1, max: 3, fn(c, o, t, P) {
    noise(c, o, t, { f: 600 * P, f2: 2600 * P, q: 1.2, a: 0.07, d: 0.14, vol: 0.32 });
    noise(c, o, t + 0.08, { f: 2600 * P, f2: 800 * P, q: 1.5, a: 0.02, d: 0.14, vol: 0.2 });
  } },
  melee: { dur: 0.6, rev: 0.12, max: 3, fn(c, o, t, P) {
    noise(c, o, t, { f: 350 * P, f2: 2400 * P, q: 1.4, a: 0.09, d: 0.1, vol: 0.4 });
    const h = t + 0.15;
    noise(c, o, h, { type: 'lowpass', f: 1100, f2: 200, d: 0.16, vol: 0.7 });
    thump(c, o, h, 130 * P, 0.16, 0.85);
    noise(c, o, h, { f: 3000, q: 1.5, d: 0.03, vol: 0.3 });
  } },
  shot_pistol: { dur: 1.0, rev: 0.3, max: 4, fn(c, o, t, P) {
    gun(c, o, t, P, { crack: 3200, cd: 0.1, cv: 0.85, sub: 190, sd: 0.14, sv: 0.8, tail: 900, td: 0.45, tv: 0.35 });
  } },
  shot_rifle: { dur: 1.6, rev: 0.45, max: 3, fn(c, o, t, P) {
    gun(c, o, t, P, { crack: 4200, cd: 0.14, cv: 1, sub: 130, sd: 0.22, sv: 0.95, tail: 700, td: 0.9, tv: 0.5 });
    tone(c, o, t, { type: 'sawtooth', f: 2400 * P, f2: 500, d: 0.06, vol: 0.12, lp: 4000 });
  } },
  shot_shotgun: { dur: 1.8, rev: 0.4, max: 2, fn(c, o, t, P) {
    gun(c, o, t, P, { crack: 2600, cd: 0.22, cv: 1, sub: 100, sd: 0.3, sv: 1, tail: 500, td: 0.9, tv: 0.65 });
    noise(c, o, t, { type: 'lowpass', f: 1800, f2: 200, d: 0.3, vol: 0.5 });
    const p = t + 0.5;
    noise(c, o, p, { f: 2200, q: 3, d: 0.02, vol: 0.3 });
    noise(c, o, p + 0.12, { f: 1600, q: 3, d: 0.025, vol: 0.35 });
  } },
  shot_smg: { dur: 1.0, rev: 0.25, max: 3, fn(c, o, t, P) {
    rate(t, 3, 0.065, (tt, i) =>
      gun(c, o, tt, P * jit(0.05), { crack: 3600, cd: 0.06, cv: 0.55, sub: 220, sd: 0.07, sv: 0.45, tail: 1000, td: i == 2 ? 0.3 : 0.1, tv: 0.2 }));
  } },
  shot_laser: { dur: 0.7, rev: 0.35, max: 4, fn(c, o, t, P) {
    tone(c, o, t, { type: 'sawtooth', f: 2600 * P, f2: 160 * P, d: 0.24, vol: 0.28, lp: 6000 });
    tone(c, o, t, { type: 'square', f: 1300 * P, f2: 90, d: 0.2, vol: 0.15, lp: 3000 });
    noise(c, o, t, { type: 'highpass', f: 6000, d: 0.05, vol: 0.2 });
    tone(c, o, t + 0.02, { f: 90, f2: 50, d: 0.15, vol: 0.4 });
  } },
  explosion: { dur: 3.2, rev: 0.5, max: 2, fn(c, o, t, P) {
    tone(c, o, t, { f: 85 * P, f2: 26, d: 1.4, vol: 1 });
    noise(c, o, t, { type: 'lowpass', f: 1400, f2: 90, d: 1.9, vol: 0.95 });
    noise(c, o, t, { f: 2500, f2: 300, d: 0.35, vol: 0.6 });
    for (let i = 0; i < 14; i++) noise(c, o, t + rnd(0.1, 1.6), { type: 'highpass', f: rnd(1500, 5000), d: rnd(0.02, 0.07), vol: rnd(0.1, 0.3) });
    for (let i = 0; i < 4; i++) tone(c, o, t + rnd(0.15, 1.3), { f: rnd(120, 320), f2: 60, d: 0.12, vol: 0.15 });
  } },
  heal: { dur: 1.4, rev: 0.45, max: 2, fn(c, o, t, P) {
    [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) => {
      tone(c, o, t + i * 0.07, { type: 'triangle', f: f * P, d: 0.55, vol: 0.14, lp: 5000 });
      tone(c, o, t + i * 0.07, { f: f * 2 * P, d: 0.35, vol: 0.04 });
    });
    noise(c, o, t, { type: 'bandpass', f: 3000, f2: 7000, q: 4, a: 0.3, d: 0.5, vol: 0.05 });
  } },
  step: { dur: 0.2, rev: 0.08, max: 3, gap: 0.08, fn(c, o, t, P) {
    noise(c, o, t, { type: 'lowpass', f: rnd(350, 650) * P, d: 0.07, vol: 0.4 });
    noise(c, o, t, { f: 2500, q: 1, d: 0.015, vol: 0.08 });
    tone(c, o, t, { f: 85 * P, f2: 50, d: 0.07, vol: 0.3 });
  } },
  levelup: { dur: 2.4, rev: 0.4, max: 1, fn(c, o, t, P) {
    const n = (f: number, tt: number, d: number, v = 0.2) => {
      tone(c, o, tt, { type: 'sawtooth', f: f * P, d, vol: v, lp: 3200, a: 0.01 });
      tone(c, o, tt, { type: 'square', f: f * P * 1.004, d, vol: v * 0.4, lp: 2400, a: 0.01 });
    };
    n(523.25, t, 0.16); n(659.25, t + 0.14, 0.16); n(783.99, t + 0.28, 0.16); n(1046.5, t + 0.42, 0.7, 0.22);
    [523.25, 659.25, 783.99, 1046.5].forEach(f => tone(c, o, t + 0.56, { type: 'triangle', f: f * P, d: 1.4, vol: 0.12, hold: 0.2 }));
    metal(c, o, t + 0.45, 2093 * P, 0.1, 1.2);
  } },
  coin: { dur: 0.8, rev: 0.2, max: 4, fn(c, o, t, P) {
    clink(c, o, t, 1750 * P, 0.28);
    clink(c, o, t + 0.075, 2350 * P, 0.22);
  } },
  buy: { dur: 1.3, rev: 0.25, max: 2, fn(c, o, t, P) {
    for (let i = 0; i < 3; i++) clink(c, o, t + i * 0.07, rnd(1500, 2400) * P, 0.2);
    clink(c, o, t + 0.28, 2637 * P, 0.28);
    clink(c, o, t + 0.36, 3520 * P, 0.25);
    noise(c, o, t + 0.26, { f: 4000, q: 2, d: 0.05, vol: 0.12 });
  } },
  error: { dur: 0.5, rev: 0.1, max: 2, fn(c, o, t, P) {
    for (let i = 0; i < 2; i++) {
      tone(c, o, t + i * 0.13, { type: 'square', f: 150 * P, d: 0.1, vol: 0.2, lp: 700 });
      tone(c, o, t + i * 0.13, { type: 'sawtooth', f: 155 * P, d: 0.1, vol: 0.12, lp: 600 });
    }
  } },
  death: { dur: 2.2, rev: 0.4, max: 2, fn(c, o, t, P) {
    tone(c, o, t, { type: 'sawtooth', f: 240 * P, f2: 38, d: 1.4, vol: 0.28, lp: 900 });
    noise(c, o, t, { type: 'lowpass', f: 900, f2: 100, d: 1.2, vol: 0.4 });
    thump(c, o, t + 0.9, 90, 0.3, 0.8);
    noise(c, o, t + 0.9, { type: 'lowpass', f: 500, d: 0.2, vol: 0.5 });
  } },
  scream: { dur: 1.3, rev: 0.4, max: 2, fn(c, o, t, P) {
    const os = c.createOscillator(); os.type = 'sawtooth';
    const lfo = c.createOscillator(), lg = c.createGain();
    lfo.frequency.value = rnd(6, 9); lg.gain.value = 35 * P;
    lfo.connect(lg); lg.connect(os.frequency);
    os.frequency.setValueAtTime(420 * P, t);
    os.frequency.exponentialRampToValueAtTime(980 * P, t + 0.18);
    os.frequency.setValueAtTime(980 * P, t + 0.35);
    os.frequency.exponentialRampToValueAtTime(520 * P, t + 1.0);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.35, t + 0.05);
    g.gain.setValueAtTime(0.3, t + 0.5); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
    for (const [f, q, v] of [[800, 6, 1], [1800, 8, 0.7], [3200, 6, 0.3]]) {
      const b = c.createBiquadFilter(); b.type = 'bandpass'; b.frequency.value = f; b.Q.value = q;
      const bg = c.createGain(); bg.gain.value = v;
      os.connect(b); b.connect(bg); bg.connect(g);
    }
    g.connect(o); os.start(t); os.stop(t + 1.2); lfo.start(t); lfo.stop(t + 1.2);
    noise(c, o, t, { f: 2500, q: 1, a: 0.05, d: 0.9, vol: 0.12 });
  } },
  growl: { dur: 1.3, rev: 0.25, max: 2, fn(c, o, t, P) {
    const os = c.createOscillator(); os.type = 'sawtooth';
    os.frequency.setValueAtTime(78 * P, t); os.frequency.linearRampToValueAtTime(62 * P, t + 1);
    const am = c.createOscillator(), amg = c.createGain(), g = c.createGain(), lp = c.createBiquadFilter(), env = c.createGain();
    am.frequency.value = rnd(22, 30); amg.gain.value = 0.5; am.connect(amg); amg.connect(g.gain); g.gain.value = 0.5;
    env.gain.setValueAtTime(0.0001, t); env.gain.linearRampToValueAtTime(0.7, t + 0.15);
    env.gain.setValueAtTime(0.6, t + 0.7); env.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
    lp.type = 'lowpass'; lp.frequency.setValueAtTime(350, t); lp.frequency.linearRampToValueAtTime(700, t + 0.4); lp.Q.value = 4;
    os.connect(lp); lp.connect(g); g.connect(env); env.connect(o);
    os.start(t); os.stop(t + 1.2); am.start(t); am.stop(t + 1.2);
    noise(c, o, t, { f: 400, q: 2, a: 0.2, d: 0.8, vol: 0.2 });
  } },
  door: { dur: 1.6, rev: 0.3, max: 2, fn(c, o, t, P) {
    const os = c.createOscillator(); os.type = 'sawtooth';
    let f = rnd(160, 220) * P; os.frequency.setValueAtTime(f, t);
    for (let i = 1; i <= 12; i++) { f = Math.max(90, Math.min(520, f * rnd(0.85, 1.2))); os.frequency.linearRampToValueAtTime(f, t + i * 0.085); }
    const b = c.createBiquadFilter(); b.type = 'bandpass'; b.frequency.value = 900 * P; b.Q.value = 7;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.35, t + 0.1);
    g.gain.setValueAtTime(0.3, t + 0.8); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
    os.connect(b); b.connect(g); g.connect(o); os.start(t); os.stop(t + 1.2);
    noise(c, o, t, { f: 1500, q: 5, a: 0.1, d: 0.9, vol: 0.06 });
    thump(c, o, t + 1.1, 110, 0.2, 0.6);
    noise(c, o, t + 1.1, { type: 'lowpass', f: 600, d: 0.2, vol: 0.5 });
    metal(c, o, t + 1.1, 420, 0.1, 0.5);
  } },
  pickup: { dur: 0.4, rev: 0.2, max: 3, fn(c, o, t, P) {
    tone(c, o, t, { type: 'triangle', f: 600 * P, f2: 1300 * P, d: 0.1, vol: 0.2 });
    tone(c, o, t + 0.07, { f: 1900 * P, d: 0.18, vol: 0.14 });
  } },
  geiger: { dur: 1.0, rev: 0.05, max: 2, gap: 0.2, fn(c, o, t) {
    const n = 3 + Math.floor(Math.random() * 8);
    for (let i = 0; i < n; i++) {
      const tt = t + Math.random() * 0.8;
      noise(c, o, tt, { type: 'highpass', f: 2500, d: 0.005, vol: rnd(0.25, 0.5) });
      tone(c, o, tt, { type: 'square', f: rnd(2800, 3600), d: 0.003, vol: 0.06 });
    }
  } },
  logo: { dur: 6, rev: 0.55, max: 1, fn(c, o, t) {
    // krótki riser, uderzenie w t+0.35
    noise(c, o, t, { f: 150, f2: 5000, q: 1.5, a: 0.3, d: 0.05, vol: 0.4 });
    const h = t + 0.35;
    tone(c, o, h, { f: 62, f2: 24, d: 3.2, vol: 0.8 });
    tone(c, o, h, { f: 124, f2: 40, d: 1.5, vol: 0.5 });
    noise(c, o, h, { type: 'lowpass', f: 3500, f2: 90, d: 3.6, vol: 0.65 });
    noise(c, o, h, { f: 1800, f2: 200, d: 0.5, vol: 0.45 });
    metal(c, o, h, 220, 0.2, 3.0);
    for (let i = 0; i < 26; i++) {
      const tt = h + Math.pow(Math.random(), 1.6) * 2.2;
      noise(c, o, tt, { f: rnd(2500, 9000), q: 4, d: rnd(0.01, 0.05), vol: rnd(0.15, 0.5) });
      if (i % 3 == 0) tone(c, o, tt, { type: 'sawtooth', f: rnd(3000, 6000), f2: 200, d: 0.07, vol: 0.12, lp: 6000 });
    }
    for (let i = 0; i < 5; i++) noise(c, o, h + 0.4 + i * rnd(0.3, 0.6), { type: 'lowpass', f: 300, d: rnd(0.5, 1), a: 0.15, vol: 0.4 });
  } },
  typewriter: { dur: 0.1, rev: 0.03, max: 4, gap: 0.025, fn(c, o, t, P) {
    noise(c, o, t, { f: rnd(2800, 4200) * P, q: 2, d: 0.012, vol: 0.2 });
    tone(c, o, t, { type: 'square', f: rnd(900, 1300) * P, d: 0.01, vol: 0.05, lp: 3000 });
  } },
  turn: { dur: 1.2, rev: 0.4, max: 1, fn(c, o, t, P) {
    for (const [f, dt] of [[659.25, 0], [987.77, 0.12]]) {
      tone(c, o, t + dt, { f: f * P, d: 0.7, vol: 0.2 });
      tone(c, o, t + dt, { f: f * P * 2.76, d: 0.25, vol: 0.05 });
      tone(c, o, t + dt, { type: 'triangle', f: f * P * 0.5, d: 0.5, vol: 0.1 });
    }
  } },
  victory: { dur: 3, rev: 0.45, max: 1, fn(c, o, t, P) {
    const br = (f: number, tt: number, d: number, v = 0.17) => {
      tone(c, o, tt, { type: 'sawtooth', f: f * P, d, vol: v, lp: 2600, a: 0.03 });
      tone(c, o, tt, { type: 'sawtooth', f: f * P * 1.006, d, vol: v * 0.7, lp: 2200, a: 0.03 });
    };
    br(392, t, 0.28); br(392, t + 0.3, 0.2); br(523.25, t + 0.5, 0.25); br(659.25, t + 0.75, 0.25);
    [523.25, 659.25, 783.99, 1046.5].forEach(f => br(f, t + 1.0, 1.6, 0.13));
    thump(c, o, t + 1.0, 70, 0.4, 0.5);
  } },
  defeat: { dur: 3.2, rev: 0.5, max: 1, fn(c, o, t, P) {
    [[440, 0], [415.3, 0.55], [349.2, 1.1], [329.6, 1.65]].forEach(([f, dt], i) => {
      tone(c, o, t + dt, { type: 'sawtooth', f: f * 0.5 * P, d: i == 3 ? 1.5 : 0.6, vol: 0.2, lp: 1200, a: 0.04 });
    });
    tone(c, o, t + 1.65, { f: 55, f2: 40, d: 1.5, vol: 0.5 });
    noise(c, o, t + 1.65, { type: 'lowpass', f: 400, d: 1.2, vol: 0.2 });
  } },
  alarm: { dur: 2.0, rev: 0.25, max: 1, fn(c, o, t, P) {
    for (let i = 0; i < 4; i++) tone(c, o, t + i * 0.45, { type: 'square', f: 880 * P, f2: 620 * P, d: 0.36, vol: 0.2, lp: 2400, hold: 0.04 });
  } },
  radio: { dur: 1.3, rev: 0.05, max: 1, fn(c, o, t, P) {
    const n = noise(c, o, t, { f: 1700, q: 0.9, a: 0.02, d: 0.85, vol: 0.3 });
    for (let i = 0; i < 24; i++) n.g.gain.setValueAtTime(rnd(0.05, 0.35), t + 0.03 + i * 0.035);
    n.g.gain.exponentialRampToValueAtTime(0.0001, t + 1.0);
    noise(c, o, t, { type: 'highpass', f: 3500, d: 0.9, vol: 0.05 });
    tone(c, o, t, { f: 1050 * P, d: 0.07, vol: 0.12, lp: 3000 });
  } },
} satisfies Record<string, SfxDef>;

export type SfxName = keyof typeof SFX;
export interface SfxOptions {
  /** głośność 0..1+ (domyślnie 1) */
  vol?: number;
  /** mnożnik wysokości (domyślnie 1) */
  pitch?: number;
}

/** Renderuje efekt do (dry, wet). Eksportowane m.in. do testów w OfflineAudioContext. */
export function playSfx(c: Ctx, dry: AudioNode, wet: AudioNode | null, name: SfxName, t: number, o: SfxOptions = {}) {
  const m: SfxDef | undefined = SFX[name];
  if (!m) return null;
  const vg = c.createGain();
  vg.gain.value = o.vol ?? 1;
  vg.connect(dry);
  let send: GainNode | null = null;
  if (wet && m.rev) {
    send = c.createGain();
    send.gain.value = m.rev;
    vg.connect(send);
    send.connect(wet);
  }
  m.fn(c, vg, t, (o.pitch || 1) * jit(0.04));
  return { vg, send, dur: m.dur };
}

// ───────────────────────────── music: generatywny sekwencer ─────────────────────────────

interface PadOpts { vol?: number; cut?: number; rv?: number; type?: OscillatorType; a?: number }
interface BassOpts { vol?: number; type?: OscillatorType; cut?: number; dist?: number; rv?: number }
interface LeadOpts { vol?: number; type?: OscillatorType; from?: number; vib?: number; dist?: number; rv?: number; cut?: number }

/** Zestaw instrumentów związany z kontekstem i parą wyjść (dry, wet). */
function kit(c: Ctx, dry: AudioNode, wet: AudioNode, rng: Rng) {
  const route = (g: AudioNode, rv: number) => {
    g.connect(dry);
    if (rv) { const s = c.createGain(); s.gain.value = rv; g.connect(s); s.connect(wet); }
  };
  const env = (t: number, a: number, d: number, vol: number, hold = 0) => {
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + a);
    if (hold) g.gain.setValueAtTime(vol, t + a + hold);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + hold + d);
    return g;
  };
  const nz = (t: number, type: BiquadFilterType, f: number, q: number, vol: number, a = 0.002, d = 0.1, rv = 0, f2?: number) => {
    const s = c.createBufferSource(); s.buffer = noiseBuf(c); s.loop = true;
    const fl = c.createBiquadFilter(); fl.type = type; fl.frequency.setValueAtTime(f, t); fl.Q.value = q;
    if (f2) fl.frequency.exponentialRampToValueAtTime(f2, t + a + d);
    const g = env(t, a, d, vol); s.connect(fl); fl.connect(g); route(g, rv);
    s.start(t, rng() * 1.5); s.stop(t + a + d + 0.05);
  };
  return {
    pad(t: number, notes: number[], dur: number, { vol = 0.06, cut = 900, rv = 0.7, type = 'sawtooth', a }: PadOpts = {}) {
      const at = a ?? dur * 0.4;
      const g = env(t, at, dur - at > 0.05 ? dur - at : 0.05, vol);
      const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.7;
      lp.frequency.setValueAtTime(cut * 0.5, t); lp.frequency.linearRampToValueAtTime(cut, t + at);
      lp.connect(g); route(g, rv);
      for (const n of notes) for (const dt of [-7, 6]) {
        const o = c.createOscillator(); o.type = type; o.frequency.value = mtof(n); o.detune.value = dt;
        o.connect(lp); o.start(t); o.stop(t + dur + 0.05);
      }
    },
    pluck(t: number, n: number, vol = 0.3, rv = 0.5, cut = 3500, bright = 0.5) {
      const s = c.createBufferSource(); s.buffer = ksBuffer(c, mtof(n), 2.2, bright);
      const g = c.createGain(); g.gain.value = vol;
      const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = cut;
      s.connect(lp); lp.connect(g); route(g, rv); s.start(t);
    },
    bass(t: number, n: number, dur: number, { vol = 0.3, type = 'sawtooth', cut = 500, dist = 0, rv = 0 }: BassOpts = {}) {
      const o = c.createOscillator(); o.type = type; o.frequency.value = mtof(n);
      const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 3;
      lp.frequency.setValueAtTime(cut * 3, t); lp.frequency.exponentialRampToValueAtTime(cut, t + dur * 0.6);
      const g = env(t, 0.006, dur, vol); o.connect(lp);
      if (dist) { const w = c.createWaveShaper(); w.curve = shaperCurve(dist); lp.connect(w); w.connect(g); } else lp.connect(g);
      route(g, rv); o.start(t); o.stop(t + dur + 0.05);
    },
    lead(t: number, n: number, dur: number, { vol = 0.12, type = 'sawtooth', from, vib = 5, dist = 0, rv = 0.5, cut = 2600 }: LeadOpts = {}) {
      const o = c.createOscillator(); o.type = type; const f = mtof(n);
      o.frequency.setValueAtTime(from ? mtof(from) : f, t);
      if (from) o.frequency.exponentialRampToValueAtTime(f, t + Math.min(0.18, dur * 0.4));
      const l = c.createOscillator(), lg = c.createGain();
      l.frequency.value = vib; lg.gain.setValueAtTime(0, t); lg.gain.linearRampToValueAtTime(f * 0.012, t + dur * 0.7);
      l.connect(lg); lg.connect(o.frequency);
      const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = cut;
      const g = env(t, 0.03, dur, vol); o.connect(lp);
      if (dist) { const w = c.createWaveShaper(); w.curve = shaperCurve(dist); lp.connect(w); w.connect(g); } else lp.connect(g);
      route(g, rv); o.start(t); o.stop(t + dur + 0.1); l.start(t); l.stop(t + dur + 0.1);
    },
    kick(t: number, vol = 0.8, f = 150) {
      const o = c.createOscillator(); o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
      const g = env(t, 0.002, 0.28, vol); o.connect(g); route(g, 0.04); o.start(t); o.stop(t + 0.35);
      nz(t, 'lowpass', 3000, 1, vol * 0.3, 0.001, 0.015);
    },
    snare(t: number, vol = 0.5) {
      nz(t, 'bandpass', 2000, 0.8, vol, 0.002, 0.17, 0.3);
      const o = c.createOscillator(); o.type = 'triangle';
      o.frequency.setValueAtTime(240, t); o.frequency.exponentialRampToValueAtTime(150, t + 0.1);
      const g = env(t, 0.002, 0.1, vol * 0.5); o.connect(g); route(g, 0.1); o.start(t); o.stop(t + 0.15);
    },
    hat(t: number, vol = 0.15, open = false) { nz(t, 'highpass', 7500, 1, vol, 0.001, open ? 0.2 : 0.03, 0.05); },
    tom(t: number, n: number, vol = 0.5) {
      const o = c.createOscillator();
      o.frequency.setValueAtTime(mtof(n) * 1.5, t); o.frequency.exponentialRampToValueAtTime(mtof(n), t + 0.1);
      const g = env(t, 0.003, 0.35, vol); o.connect(g); route(g, 0.3); o.start(t); o.stop(t + 0.4);
    },
    metal(t: number, f: number, vol = 0.12, d = 1.2, rv = 0.7) {
      for (const r of [1, 1.47, 2.09, 2.56, 3.9]) {
        const o = c.createOscillator(); o.type = 'square'; o.frequency.value = f * r;
        const b = c.createBiquadFilter(); b.type = 'bandpass'; b.frequency.value = f * r; b.Q.value = 12;
        const g = env(t, 0.002, d / (1 + r * 0.4), vol / (1 + r));
        o.connect(b); b.connect(g); route(g, rv); o.start(t); o.stop(t + d + 0.1);
      }
    },
    drip(t: number, f = 1800 + rng() * 1500, vol = 0.1) {
      const o = c.createOscillator(); o.frequency.setValueAtTime(f * 1.3, t); o.frequency.exponentialRampToValueAtTime(f, t + 0.03);
      const g = env(t, 0.002, 0.25, vol); o.connect(g); route(g, 0.8); o.start(t); o.stop(t + 0.3);
    },
    swell(t: number, dur: number, vol: number, f1: number, f2: number, q = 1.2, rv = 0.5) {
      nz(t, 'bandpass', f1, q, vol, dur * 0.55, dur * 0.45, rv, f2);
    },
    sub(t: number, n: number, dur: number, vol = 0.3) {
      const o = c.createOscillator(); o.frequency.value = mtof(n);
      const g = env(t, 0.01, dur, vol); o.connect(g); route(g, 0); o.start(t); o.stop(t + dur + 0.05);
    },
    crash(t: number, vol = 0.3) { nz(t, 'highpass', 3500, 0.7, vol, 0.002, 1.3, 0.4); },
  };
}
type Kit = ReturnType<typeof kit>;
/** Krok sekwencera: i = numer szesnastki, t = czas startu, s16 = długość szesnastki [s]. */
type StepFn = (i: number, t: number, s16: number) => void;
interface TrackDef { bpm: number; gain?: number; len?: number; make(K: Kit, r: Rng): StepFn }

const pick = <T,>(r: Rng, a: readonly T[]): T => a[Math.floor(r() * a.length)];
const PENT = [0, 3, 5, 7, 10];
const chordOf = (root: number, ints: number[]) => ints.map(i => root + i);
type Chord = [number, number[]];

const TRACKS = {
  logo: { bpm: 60, make(K) {
    return (i, t) => {
      if ((i & 15) == 0) {
        const first = i == 0; const dur = 4.6;
        K.pad(t, [29, 36, 43], dur, { vol: first ? 0.11 : 0.08, cut: first ? 1400 : 700, a: dur * 0.85, rv: 0.8 });
        K.swell(t, dur, first ? 0.12 : 0.05, 120, 900, 1, 0.6); K.sub(t, 29, dur, 0.18);
        if (first) K.swell(t, 4, 0.05, 800, 5000, 3, 0.7);
      }
    };
  } },

  intro: { bpm: 62, make(K, r) {
    const prog: Chord[] = [[45, [0, 7, 12, 15]], [41, [0, 7, 12, 16]], [48, [0, 7, 12, 16]], [43, [0, 7, 12, 16]]]; // Am F C G
    return (i, t, s16) => {
      const bar = i >> 4, s = i & 15, [root, ints] = prog[bar & 3];
      if (s == 0) {
        K.pad(t, chordOf(root + 12, ints.slice(1)), s16 * 17, { vol: 0.045, cut: 800, a: s16 * 7 });
        K.bass(t, root - 12, s16 * 8, { vol: 0.22, type: 'sine', cut: 300 });
        if ((bar & 1) == 0) K.swell(t, s16 * 30, 0.06, 250, 700, 0.8, 0.5);
      }
      if (s % 2 == 0 && r() < 0.22) K.pluck(t, root + 12 + pick(r, [0, 3, 7, 10, 12, 14, 15].filter(x => ints.includes(x) || x > 8)), 0.2 + r() * 0.15, 0.7, 2600);
      if (s == 8 && r() < 0.5) K.pluck(t, root + 24, 0.14, 0.8, 2000);
      if (s == 0 && (bar & 7) == 5) K.metal(t, 900, 0.02, 2.5, 0.9);
    };
  } },

  title: { bpm: 84, gain: 0.8, make(K, r) {
    const roots = [38, 38, 34, 33]; // D D Bb A
    const bass = [0, 0, 0, 0, 0, 3, 0, 0, 0, 0, 0, 7, 3, 0, 0, 0];
    const mel: number[][] = [];
    for (let b = 0; b < 8; b++) { const m: number[] = []; for (let s = 0; s < 16; s++) m.push(s % 4 == 0 || r() < 0.18 ? pick(r, PENT) + 62 - 2 : -1); mel.push(m); }
    let prev = 62;
    return (i, t, s16) => {
      const bar = i >> 4, s = i & 15, root = roots[bar & 3];
      if (s == 0) K.pad(t, [root + 12, root + 19, root + 24 + ((bar & 3) == 2 ? 0 : 3)], s16 * 16, { vol: 0.04, cut: 700, a: s16 * 3 });
      if (s % 2 == 0) { const n = root + bass[s]; if (s % 4 == 0 || r() < 0.6) K.bass(t, n, s16 * 1.8, { vol: 0.24, type: 'triangle', cut: 450, dist: 20 }); }
      if (s == 0 || s == 8) K.kick(t, 0.5, 120);
      if (s == 4 || s == 12) K.tom(t, 38, 0.18);
      if (s == 12) K.hat(t, 0.06, true);
      if (s % 4 == 2) K.hat(t, 0.04);
      const n = mel[bar & 7][s];
      if (n > 0 && bar % 8 >= 2) {
        const hi = n + (bar & 4 ? 12 : 0);
        K.lead(t, hi, s16 * (s % 4 == 0 ? 3.2 : 1.6), { vol: 0.07, from: prev, type: 'sawtooth', cut: 2000, vib: 5.5 });
        if (r() < 0.4) K.pluck(t, hi - 12, 0.18, 0.6, 2500);
        prev = hi;
      }
    };
  } },

  town: { bpm: 76, gain: 0.85, make(K, r) {
    const prog: Chord[] = [[48, [0, 4, 7, 11]], [45, [0, 3, 7, 10]], [41, [0, 4, 7, 11]], [43, [0, 4, 7, 10]]]; // C Am F G
    return (i, t, s16) => {
      const bar = i >> 4, s = i & 15, [root, ints] = prog[bar & 3];
      if (s == 0) {
        K.pad(t, chordOf(root + 12, ints), s16 * 16.5, { vol: 0.04, cut: 1100, type: 'triangle', a: s16 * 4 });
        K.bass(t, root - 12, s16 * 5, { vol: 0.26, type: 'triangle', cut: 400 });
      }
      if (s == 8) K.bass(t, root - 5, s16 * 3, { vol: 0.16, type: 'triangle', cut: 400 });
      if (s % 2 == 0) { const a = [0, 1, 2, 3, 2, 1, 2, 3][(s >> 1) & 7]; if (r() < 0.75) K.pluck(t, root + 12 + ints[a], 0.2 + r() * 0.1, 0.5, 3000, 0.6); }
      if (s % 4 == 2) K.hat(t, 0.025 + r() * 0.015);
      if (s == 8 && bar & 1) K.tom(t, 36, 0.12);
      if (s == 14 && bar % 4 == 3 && r() < 0.6) K.pluck(t, root + 24 + pick(r, [0, 4, 7]), 0.18, 0.8, 3500);
    };
  } },

  wastes: { bpm: 56, make(K, r) {
    const roots = [38, 38, 36, 34];
    return (i, t, s16) => {
      const bar = i >> 4, s = i & 15, root = roots[(bar >> 1) & 3];
      if (s == 0 && (bar & 1) == 0) {
        K.pad(t, [root, root + 7, root + 12, root + 19], s16 * 34, { vol: 0.05, cut: 700, a: s16 * 12, rv: 0.8 });
        K.swell(t, s16 * 32, 0.1, 300, 900, 0.7, 0.6); K.sub(t, root - 12, s16 * 30, 0.14);
      }
      if (s == 0 && (bar & 1) == 1) K.swell(t, s16 * 16, 0.05, 1200, 400, 1.5, 0.6);
      if (s % 4 == 0 && r() < 0.2) K.pluck(t, root + 24 + pick(r, [0, 7, 10, 12]), 0.2, 0.9, 2200, 0.35);
      if (s == 6 && bar % 4 == 2) K.lead(t, root + 31, s16 * 6, { vol: 0.03, type: 'sine', from: root + 29, rv: 0.9 });
    };
  } },

  ruins: { bpm: 70, make(K, r) {
    const pat = Array.from({ length: 16 }, (_, s) => s == 0 || (s % 4 == 0 && r() < 0.5) || r() < 0.1);
    return (i, t, s16) => {
      const bar = i >> 4, s = i & 15;
      if (s == 0 && (bar & 1) == 0) {
        K.pad(t, [40, 41, 47], s16 * 33, { vol: 0.04, cut: 500, a: s16 * 14, rv: 0.8 });
        K.swell(t, s16 * 32, 0.07, 200, 3000, 2, 0.7);
      }
      if (pat[s]) K.sub(t, s == 0 ? 28 : 28 + pick(r, [0, 0, 1]), s16 * 2.2, s == 0 ? 0.36 : 0.2);
      if (r() < 0.07) K.metal(t, 300 + r() * 500, 0.06, 1.5);
      if (r() < 0.08) K.drip(t);
      if (s == 8 && r() < 0.25) K.pluck(t, 52 + pick(r, [0, 1, 6]), 0.12, 0.9, 1500, 0.3);
      if (s == 15 && bar % 4 == 3) K.swell(t, s16 * 14, 0.08, 400, 2500, 3, 0.6);
    };
  } },

  combat: { bpm: 118, gain: 0.6, make(K, r) {
    const roots = [40, 40, 36, 38];
    const bpat = [0, 0, 12, 0, 0, 0, 10, 0, 0, 0, 12, 0, 1, 0, 0, 3].map((x, i) => [x, r() < 0.8 || i % 4 == 0] as const);
    const kx = [6, 10, 14, 11].filter(() => r() < 0.55);
    const riffs = [0, 1].map(() => Array.from({ length: 16 }, (_, s) => ((s % 4 == 0 && r() < 0.7) || r() < 0.22 ? pick(r, [0, 3, 5, 7, 10, 12, 15]) : -1)));
    return (i, t, s16) => {
      const bar = i >> 4, s = i & 15, root = roots[bar & 3];
      if (s % 4 == 0 || kx.includes(s)) K.kick(t, s % 4 == 0 ? 0.8 : 0.55);
      if (s == 4 || s == 12) K.snare(t, 0.5);
      if (s % 2 == 0) K.hat(t, s % 4 == 0 ? 0.13 : 0.09, s == 14); else if (r() < 0.25) K.hat(t, 0.05);
      if (bar % 4 == 3 && s >= 12) K.tom(t, 45 - (s - 12) * 3, 0.4);
      if (s % 2 == 0 && bpat[s][1]) K.bass(t, root + bpat[s][0], s16 * 1.8, { vol: 0.26, cut: 600, dist: 25 });
      if (s == 0) K.pad(t, [root + 12, root + 19, root + 27], s16 * 15, { vol: 0.03, cut: 1200, a: s16 * 2, rv: 0.3 });
      if ((bar & 3) >= 2) { const n = riffs[(bar >> 2) & 1][s]; if (n >= 0) K.lead(t, root + 24 + n, s16 * 1.7, { vol: 0.07, type: 'square', dist: 30, cut: 3000, vib: 0, rv: 0.25 }); }
      if (s == 0 && bar % 4 == 0) K.crash(t, 0.14);
    };
  } },

  boss: { bpm: 140, gain: 0.38, make(K, r) {
    const ph = [0, 1, 0, 0, 3, 1, 0, 6], roots = [38, 38, 39, 36];
    const kx = new Set([0, 3, 4, 7, 8, 10, 11, 12, 14]);
    return (i, t, s16) => {
      const bar = i >> 4, s = i & 15, root = roots[bar & 3];
      if (kx.has(s) || (bar % 4 == 3 && s > 11)) K.kick(t, 0.85, 160);
      if (s == 4 || s == 12) { K.snare(t, 0.6); K.tom(t, 33, 0.25); }
      K.hat(t, s % 2 ? 0.05 : 0.11, s == 14);
      if (s % 2 == 0 || r() < 0.3) K.bass(t, root - 12 + ph[(s >> 1) & 7] + (s == 15 ? 12 : 0), s16 * 1.5, { vol: 0.3, type: 'sawtooth', cut: 700, dist: 60 });
      if (s == 0 || s == 6 || s == 10) K.pad(t, [root + 12, root + 19, root + 24], s16 * 3, { vol: 0.045, cut: 2500, type: 'sawtooth', a: 0.01, rv: 0.25 });
      if (s == 0) {
        K.pad(t, [root + 24, root + 25], s16 * 16, { vol: 0.02, cut: 1800, a: s16 * 8, rv: 0.6 });
        if (bar % 4 == 0) { K.crash(t, 0.25); K.sub(t, root - 24, s16 * 8, 0.35); }
      }
      if (bar % 2 == 1 && s % 2 == 0 && r() < 0.6) K.lead(t, root + 36 + pick(r, [0, 1, 3, 6, 7]), s16 * 1.5, { vol: 0.06, type: 'square', dist: 80, cut: 3500, vib: 0, rv: 0.3 });
    };
  } },

  victory: { bpm: 100, len: 56, make(K) {
    const mel: Record<number, number> = { 0: 67, 3: 67, 5: 67, 6: 72, 8: 76, 12: 79, 16: 76, 18: 79, 20: 84, 24: 84 }; // nuta na krok
    return (i, t, s16) => {
      const m = mel[i];
      if (m) {
        const d = i == 24 ? 8 : i == 12 || i == 20 ? 3 : 1.6;
        K.lead(t, m, s16 * d, { vol: 0.1, type: 'sawtooth', cut: 2600, rv: 0.5, vib: 5 });
        K.lead(t, m - 12, s16 * d, { vol: 0.07, type: 'sawtooth', cut: 1800, rv: 0.4, vib: 5 });
      }
      if (i % 4 == 0 && i < 24) K.kick(t, 0.5);
      if (i % 8 == 4 && i < 24) K.snare(t, 0.3);
      if (i == 24) { K.pad(t, [48, 55, 60, 64, 67], s16 * 28, { vol: 0.06, cut: 2200, a: 0.03, rv: 0.6 }); K.crash(t, 0.25); K.kick(t, 0.8, 120); K.sub(t, 36, s16 * 20, 0.3); }
      if (i == 0) K.pad(t, [43, 50, 55], s16 * 24, { vol: 0.04, cut: 1500, a: s16 * 4 });
    };
  } },

  defeat: { bpm: 60, len: 40, make(K) {
    const notes: Record<number, number> = { 0: 69, 4: 68, 8: 65, 14: 64 };
    return (i, t, s16) => {
      const m = notes[i];
      if (m) K.lead(t, m, s16 * (i == 14 ? 22 : 4), { vol: 0.08, type: 'sawtooth', cut: 1400, rv: 0.7, vib: 4, from: i == 14 ? 65 : undefined });
      if (i == 0) { K.pad(t, [33, 40, 45, 48], s16 * 36, { vol: 0.06, cut: 700, a: s16 * 8, rv: 0.8 }); K.sub(t, 21, s16 * 32, 0.3); }
      if (i == 8) K.tom(t, 33, 0.3);
      if (i == 14) { K.kick(t, 0.6, 90); K.metal(t, 330, 0.06, 2.5); }
    };
  } },
} satisfies Record<string, TrackDef>;

export type MusicTrack = keyof typeof TRACKS;

interface Track {
  bpm: number;
  s16: number;
  gain: number;
  /** planuje wszystkie kroki startujące przed `until` (czas absolutny kontekstu); `start` = czas kroku 0 */
  schedule(until: number, start: number): void;
  readonly ended: boolean;
}

export function createTrack(name: MusicTrack, c: Ctx, dry: AudioNode, wet: AudioNode, seed = 1): Track | null {
  const def: TrackDef | undefined = TRACKS[name];
  if (!def) return null;
  const r = mulberry32(seed * 7919 + name.length * 131 + name.charCodeAt(0));
  const K = kit(c, dry, wet, r);
  const s16 = 60 / def.bpm / 4;
  const step = def.make(K, r);
  let i = 0, next = 0, started = false, ended = false;
  return {
    bpm: def.bpm,
    s16,
    gain: def.gain ?? 1,
    schedule(until, start) {
      if (!started) { next = start; started = true; }
      while (!ended && next < until) {
        step(i, next, s16);
        i++;
        next += s16;
        if (def.len && i >= def.len) ended = true;
      }
    },
    get ended() { return ended; },
  };
}

// ───────────────────────────── ambience: zapętlone tła ─────────────────────────────

export type AmbienceName = 'wind' | 'ruins' | 'town' | 'none';

/** Zapętlone tło dźwiękowe; wjeżdża przez 1.5 s. */
function createAmbience(name: AmbienceName, c: Ctx, dst: AudioNode): { stop(fade?: number): void } {
  const g = c.createGain();
  g.gain.value = 0;
  g.connect(dst);
  const t0 = c.currentTime;
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(1, t0 + 1.5);
  const srcs: AudioScheduledSourceNode[] = [];
  const timers: ReturnType<typeof setInterval>[] = [];
  const loopNoise = (type: BiquadFilterType, f: number, q: number, vol: number) => {
    const s = c.createBufferSource(); s.buffer = noiseBuf(c); s.loop = true;
    const fl = c.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q;
    const v = c.createGain(); v.gain.value = vol;
    s.connect(fl); fl.connect(v); v.connect(g); s.start(0, Math.random() * 1.5); srcs.push(s);
    return { fl, v };
  };
  const lfo = (rateHz: number, depth: number, param: AudioParam) => {
    const o = c.createOscillator(), d = c.createGain();
    o.frequency.value = rateHz; d.gain.value = depth; o.connect(d); d.connect(param); o.start(); srcs.push(o);
  };
  const wind = (vol: number) => {
    const a = loopNoise('bandpass', 420, 0.9, vol); lfo(0.07, 220, a.fl.frequency); lfo(0.11, vol * 0.45, a.v.gain);
    const b = loopNoise('bandpass', 1300, 5, vol * 0.25); lfo(0.05, 500, b.fl.frequency); lfo(0.13, vol * 0.12, b.v.gain);
    loopNoise('lowpass', 160, 0.5, vol * 0.5);
  };
  const every = (ms: number, fn: (t: number) => void) =>
    timers.push(setInterval(() => { if (c.state === 'running') fn(c.currentTime + 0.05); }, ms));
  const out = g;
  if (name === 'wind') wind(0.16);
  else if (name === 'ruins') {
    wind(0.1);
    every(700, t => {
      const r = Math.random();
      if (r < 0.14) tone(c, out, t, { type: 'sine', f: rnd(1800, 3200), f2: rnd(1400, 2200), d: 0.2, vol: 0.05 }); // kapanie
      else if (r < 0.22) { // skrzypienie
        const o = c.createOscillator(); o.type = 'sawtooth'; const f = rnd(120, 260);
        o.frequency.setValueAtTime(f, t); o.frequency.linearRampToValueAtTime(f * rnd(0.8, 1.3), t + 0.9);
        const b = c.createBiquadFilter(); b.type = 'bandpass'; b.frequency.value = rnd(500, 1100); b.Q.value = 8;
        const v = c.createGain(); v.gain.setValueAtTime(0.0001, t); v.gain.linearRampToValueAtTime(0.045, t + 0.3); v.gain.exponentialRampToValueAtTime(0.0001, t + 1.0);
        o.connect(b); b.connect(v); v.connect(out); o.start(t); o.stop(t + 1.1);
      } else if (r < 0.25) { // odległy brzęk
        for (const m of [1, 2.7, 5.1]) tone(c, out, t, { f: rnd(200, 320) * m, d: 1.2 / m, vol: 0.02 });
        noise(c, out, t, { f: 1500, q: 2, d: 0.03, vol: 0.03 });
      }
    });
  } else if (name === 'town') {
    const m1 = loopNoise('bandpass', 360, 1.6, 0.07), m2 = loopNoise('bandpass', 950, 2, 0.04);
    lfo(0.37, 0.03, m1.v.gain); lfo(0.61, 0.02, m2.v.gain); lfo(0.23, 120, m1.fl.frequency); lfo(0.41, 250, m2.fl.frequency);
    loopNoise('lowpass', 220, 0.5, 0.05); wind(0.04);
    every(90, t => {
      if (Math.random() < 0.45) noise(c, out, t + Math.random() * 0.08, { type: 'highpass', f: rnd(1800, 4500), d: rnd(0.01, 0.04), vol: rnd(0.02, 0.07) });
      if (Math.random() < 0.04) noise(c, out, t, { type: 'lowpass', f: 900, d: 0.08, vol: 0.08 });
    });
  }
  return {
    stop(fade = 1.5) {
      const t = c.currentTime;
      g.gain.cancelScheduledValues(t); g.gain.setValueAtTime(g.gain.value, t); g.gain.linearRampToValueAtTime(0, t + fade);
      timers.forEach(clearInterval);
      setTimeout(() => {
        srcs.forEach(s => { try { s.stop(); } catch { /* już zatrzymane */ } });
        try { g.disconnect(); } catch { /* ignoruj */ }
      }, (fade + 0.1) * 1000);
    },
  };
}

// ───────────────────────────── fasada: SoundManager ─────────────────────────────

export interface Volumes { master: number; music: number; sfx: number }

const STORAGE_KEY = 'pyl-i-rdza.audio'; // ten sam klucz co w Oldgame — ustawienia głośności przechodzą
const VOL_KEYS = ['master', 'music', 'sfx'] as const;
/** Ciche/częste efekty odrzucane jako pierwsze przy dużej liczbie głosów. */
const LOW_PRIORITY = new Set<SfxName>(['hover', 'step', 'click', 'typewriter', 'geiger']);
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

// Phaser.Core.Events.DESTROY === 'destroy' — stała tekstowa, żeby nie importować Phasera w runtime.
const PHASER_GAME_DESTROY = 'destroy';

interface PlayingTrack { trk: Track; g: GainNode; w: GainNode; start: number; dead: boolean }

class SoundManagerImpl {
  private vol: Volumes = { master: 0.8, music: 0.5, sfx: 0.8 };
  private _muted = false;
  private c: AudioContext | null = null;
  private B: Buses | null = null;
  private wantMusic: MusicTrack | null = null;
  private wantAmb: AmbienceName = 'none';
  private cur: PlayingTrack | null = null;
  private curName: MusicTrack | null = null;
  private ambCur: { stop(fade?: number): void } | null = null;
  private ambName: AmbienceName = 'none';
  private seedCtr = 1;
  private active = new Map<SfxName, number[]>();
  private lastPlay = new Map<SfxName, number>();
  private attached = false;

  /** Wszystkie dostępne nazwy efektów. */
  readonly sfxNames = Object.keys(SFX) as SfxName[];
  readonly musicTracks = Object.keys(TRACKS) as MusicTrack[];

  constructor() {
    try {
      const s = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (s) {
        for (const k of VOL_KEYS) if (typeof s[k] === 'number') this.vol[k] = clamp01(s[k]);
        this._muted = !!s.muted;
      }
    } catch { /* brak localStorage / zły JSON */ }
  }

  get muted(): boolean { return this._muted; }
  set muted(v: boolean) { this._muted = !!v; this.save(); this.apply(); }
  get ready(): boolean { return !!this.c; }
  get context(): AudioContext | null { return this.c; }

  /**
   * Podpina menedżer pod grę Phasera: AudioContext zostaje utworzony/wznowiony przy pierwszym
   * kliknięciu/dotknięciu/klawiszu (wymóg przeglądarek). Bezpieczne do wielokrotnego wywołania.
   */
  attach(game: Phaser.Game): this {
    if (this.attached) return this;
    this.attached = true;
    const unlock = () => {
      this.init();
      if (this.c && this.c.state === 'running') {
        window.removeEventListener('pointerdown', unlock);
        window.removeEventListener('keydown', unlock);
        window.removeEventListener('touchend', unlock);
      }
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    window.addEventListener('touchend', unlock);
    game.events.once(PHASER_GAME_DESTROY, () => this.destroy());
    return this;
  }

  /** Tworzy AudioContext (wołać z gestu użytkownika; bezpieczne wielokrotnie). */
  init(): void {
    try {
      if (!this.c) {
        const AC: typeof AudioContext | undefined =
          window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AC) return;
        this.c = new AC({ latencyHint: 'interactive' });
        this.B = createBuses(this.c);
        this.apply();
        this.timer = setInterval(() => this.tick(), 100);
        document.addEventListener('visibilitychange', this.onVisibility);
        if (this.wantMusic) this.startTrack(this.wantMusic);
        if (this.wantAmb !== 'none') { const a = this.wantAmb; this.wantAmb = 'none'; this.ambience(a); }
      }
      if (this.c.state === 'suspended') {
        this.c.resume().then(() => { if (this.wantMusic && !this.cur) this.startTrack(this.wantMusic); }).catch(() => {});
      }
    } catch (e) {
      console.warn('[audio] init failed', e);
    }
  }

  /** Odtwarza efekt dźwiękowy. No-op przed init(). */
  sfx(name: SfxName, o: SfxOptions = {}): void {
    const c = this.c, B = this.B;
    if (!c || !B || c.state !== 'running') return;
    const m: SfxDef | undefined = SFX[name];
    if (!m) return;
    const now = c.currentTime;
    if (m.gap && now - (this.lastPlay.get(name) ?? -9) < m.gap) return;
    const list = (this.active.get(name) || []).filter(e => e > now);
    if (m.max && list.length >= m.max) return;
    let total = 0;
    for (const l of this.active.values()) total += l.filter(e => e > now).length;
    if (total > 28 && LOW_PRIORITY.has(name)) return;
    if (total > 48) return;
    this.lastPlay.set(name, now);
    try {
      const v = playSfx(c, B.sfx, B.sfxWet, name, now + 0.005, o);
      if (!v) return;
      list.push(now + v.dur);
      this.active.set(name, list);
      setTimeout(() => {
        try { v.vg.disconnect(); v.send?.disconnect(); } catch { /* ignoruj */ }
      }, (v.dur + 0.5) * 1000);
    } catch (e) {
      console.warn('[audio] sfx', name, e);
    }
  }

  /** Przełącza muzykę z crossfade'em; null = stop. Można wołać przed init() — zagra po odblokowaniu. */
  music(track: MusicTrack | null): void {
    this.wantMusic = track || null;
    const c = this.c;
    if (!c) return;
    if (c.state === 'suspended') c.resume().catch(() => {});
    if (this.wantMusic === this.curName && (this.cur || !this.wantMusic)) return;
    this.startTrack(this.wantMusic);
  }

  /** Przełącza tło dźwiękowe ('none' = cisza). Można wołać przed init(). */
  ambience(name: AmbienceName | null): void {
    const n: AmbienceName = name || 'none';
    this.wantAmb = n;
    if (!this.c || !this.B) return;
    if (n === this.ambName) return;
    this.ambName = n;
    if (this.ambCur) { this.ambCur.stop(1.5); this.ambCur = null; }
    if (n !== 'none') this.ambCur = createAmbience(n, this.c, this.B.amb);
  }

  setVolume(v: Partial<Volumes> = {}): void {
    for (const k of VOL_KEYS) { const x = v[k]; if (typeof x === 'number') this.vol[k] = clamp01(x); }
    this.save();
    this.apply();
  }

  getVolume(): Volumes { return { ...this.vol }; }

  /** Zatrzymuje wszystko i zamyka AudioContext (np. przy niszczeniu gry). */
  destroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.ambCur?.stop(0.05);
    this.ambCur = null;
    this.cur = null;
    this.curName = null;
    this.ambName = 'none';
    this.c?.close().catch(() => {});
    this.c = null;
    this.B = null;
    this.active.clear();
    this.lastPlay.clear();
  }

  // ── wewnętrzne ──

  private timer: ReturnType<typeof setInterval> | null = null;

  private onVisibility = () => {
    if (this.c && !document.hidden && this.c.state === 'suspended') this.c.resume().catch(() => {});
  };

  private save(): void {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...this.vol, muted: this._muted })); } catch { /* ignoruj */ }
  }

  private apply(): void {
    const c = this.c, B = this.B;
    if (!c || !B) return;
    const t = c.currentTime;
    const set = (p: AudioParam, v: number) => { p.cancelScheduledValues(t); p.setTargetAtTime(v, t, 0.03); };
    set(B.master.gain, this._muted ? 0 : this.vol.master);
    set(B.music.gain, this.vol.music); set(B.musicWet.gain, this.vol.music);
    set(B.sfx.gain, this.vol.sfx); set(B.sfxWet.gain, this.vol.sfx);
  }

  /** Lookahead scheduler muzyki (co 100 ms planuje 0.5 s do przodu). */
  private tick(): void {
    const c = this.c;
    if (!c || c.state !== 'running') return;
    const cur = this.cur;
    if (cur && !cur.dead) cur.trk.schedule(c.currentTime + 0.5, cur.start);
  }

  private startTrack(name: MusicTrack | null): void {
    const c = this.c, B = this.B;
    if (!c || !B) return;
    const t = c.currentTime + 0.05;
    const hadOld = !!this.cur;
    if (this.cur) {
      const old = this.cur;
      old.dead = true;
      old.g.gain.cancelScheduledValues(t);
      old.g.gain.setValueAtTime(old.g.gain.value, t);
      old.g.gain.linearRampToValueAtTime(0, t + 1.5);
      setTimeout(() => { try { old.g.disconnect(); old.w.disconnect(); } catch { /* ignoruj */ } }, 1800);
      this.cur = null;
    }
    this.curName = name;
    if (!name) return;
    const g = c.createGain(), w = c.createGain();
    const gain = (TRACKS[name] as TrackDef).gain ?? 1;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + (hadOld ? 1.5 : 0.3));
    g.connect(B.music);
    w.connect(B.musicWet);
    w.gain.value = 1;
    const trk = createTrack(name, c, g, w, ++this.seedCtr + (Date.now() % 997));
    if (!trk) { g.disconnect(); w.disconnect(); return; }
    w.gain.setValueAtTime(0, t);
    w.gain.linearRampToValueAtTime(1, t + 1.5);
    this.cur = { trk, g, w, start: t + 0.05, dead: false };
    this.tick();
  }
}

/** Globalny menedżer dźwięku — jeden AudioContext na całą grę, wspólny dla wszystkich scen. */
export const SoundManager = new SoundManagerImpl();
export default SoundManager;
