// Shared synthesis helpers. Everything takes (ctx, destination, time, opts) so it can render into an OfflineAudioContext.
const noiseCache = new WeakMap();
export function noiseBuf(c) {
  let b = noiseCache.get(c);
  if (!b) {
    const n = Math.floor(c.sampleRate * 2);
    b = c.createBuffer(1, n, c.sampleRate);
    const d = b.getChannelData(0);
    let s = 1234567;
    for (let i = 0; i < n; i++) { s = (s * 1664525 + 1013904223) >>> 0; d[i] = (s / 2147483648) - 1; }
    noiseCache.set(c, b);
  }
  return b;
}
export const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
export const jit = x => 1 + (Math.random() * 2 - 1) * x;
export const rnd = (a, b) => a + Math.random() * (b - a);
export function mulberry32(a) {
  return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
const curves = new Map();
export function shaperCurve(k = 30) {
  let c = curves.get(k);
  if (!c) { c = new Float32Array(1024); for (let i = 0; i < 1024; i++) { const x = i / 512 - 1; c[i] = Math.tanh(x * k * 0.1 + x * 1.5) * 0.8; } curves.set(k, c); }
  return c;
}
export function makeImpulse(c, secs = 2.4, power = 2.6) {
  const n = Math.floor(c.sampleRate * secs), b = c.createBuffer(2, n, c.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = b.getChannelData(ch); let lp = 0, s = 987 + ch * 77;
    for (let i = 0; i < n; i++) {
      s = (s * 1664525 + 1013904223) >>> 0;
      const x = (s / 2147483648) - 1, k = i / n;
      lp += (x - lp) * (0.9 - 0.8 * k); // darkens over time
      d[i] = lp * Math.pow(1 - k, power) * (i < 200 ? i / 200 : 1);
    }
  }
  return b;
}
// filtered noise burst
export function noise(c, out, t, o = {}) {
  const { type = 'bandpass', f = 1000, f2, q = 1, a = 0.002, d = 0.2, vol = 0.5 } = o;
  const src = c.createBufferSource(); src.buffer = noiseBuf(c); src.loop = true;
  const fl = c.createBiquadFilter(); fl.type = type; fl.frequency.setValueAtTime(f, t); fl.Q.value = q;
  if (f2) fl.frequency.exponentialRampToValueAtTime(f2, t + a + d);
  const g = c.createGain(); g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vol, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  src.connect(fl); fl.connect(g); g.connect(out);
  src.start(t, Math.random() * 1.5); src.stop(t + a + d + 0.05);
  return { src, fl, g };
}
// oscillator with pitch sweep + envelope
export function tone(c, out, t, o = {}) {
  const { type = 'sine', f = 440, f2, a = 0.004, d = 0.2, vol = 0.4, lp, hp, det = 0, hold = 0 } = o;
  if (f > 16000) return null;
  const os = c.createOscillator(); os.type = type; os.frequency.setValueAtTime(f, t); if (det) os.detune.value = det;
  if (f2) os.frequency.exponentialRampToValueAtTime(f2, t + a + hold + d);
  const g = c.createGain(); g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vol, t + a);
  if (hold) g.gain.setValueAtTime(vol, t + a + hold);
  g.gain.exponentialRampToValueAtTime(0.0001, t + a + hold + d);
  let n = os;
  if (lp) { const fl = c.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = lp; n.connect(fl); n = fl; }
  if (hp) { const fl = c.createBiquadFilter(); fl.type = 'highpass'; fl.frequency.value = hp; n.connect(fl); n = fl; }
  n.connect(g); g.connect(out);
  os.start(t); os.stop(t + a + hold + d + 0.05);
  return { os, g };
}
// Karplus-Strong plucked string buffer (cached per ctx+freq)
const ksCache = new WeakMap();
export function ksBuffer(c, f, dur = 2.2, bright = 0.5) {
  let m = ksCache.get(c); if (!m) { m = new Map(); ksCache.set(c, m); }
  const key = Math.round(f * 4) + ':' + bright;
  let b = m.get(key); if (b) return b;
  const sr = c.sampleRate, n = Math.floor(sr * dur), N = Math.max(2, Math.round(sr / f));
  b = c.createBuffer(1, n, sr); const d = b.getChannelData(0);
  const ring = new Float32Array(N); let s = (key.length * 7919 + Math.round(f)) >>> 0, lp = 0;
  for (let i = 0; i < N; i++) { s = (s * 1664525 + 1013904223) >>> 0; const x = (s / 2147483648) - 1; lp += (x - lp) * bright; ring[i] = lp * 1.6; }
  let p = 0; const decay = 0.9985 - Math.min(0.004, 8 / f * 0.01);
  for (let i = 0; i < n; i++) { const nx = (p + 1) % N; d[i] = ring[p]; ring[p] = (ring[p] + ring[nx]) * 0.5 * decay; p = nx; }
  if (m.size > 160) m.clear();
  m.set(key, b); return b;
}
