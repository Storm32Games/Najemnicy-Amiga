// Procedural generative music: seeded pattern generators driven by a lookahead step scheduler.
import { noiseBuf, mtof, mulberry32, shaperCurve, ksBuffer } from './core.js';

// Voice kit bound to a context + (dry, wet) destinations.
function kit(c, dry, wet, rng) {
  const route = (g, rv) => { g.connect(dry); if (rv) { const s = c.createGain(); s.gain.value = rv; g.connect(s); s.connect(wet); } };
  const env = (t, a, d, vol, hold = 0) => { const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + a); if (hold) g.gain.setValueAtTime(vol, t + a + hold); g.gain.exponentialRampToValueAtTime(0.0001, t + a + hold + d); return g; };
  const nz = (t, dur, type, f, q, vol, a = 0.002, d = 0.1, rv = 0, f2) => {
    const s = c.createBufferSource(); s.buffer = noiseBuf(c); s.loop = true;
    const fl = c.createBiquadFilter(); fl.type = type; fl.frequency.setValueAtTime(f, t); fl.Q.value = q; if (f2) fl.frequency.exponentialRampToValueAtTime(f2, t + a + d);
    const g = env(t, a, d, vol); s.connect(fl); fl.connect(g); route(g, rv); s.start(t, rng() * 1.5); s.stop(t + a + d + 0.05);
  };
  const K = {
    c,
    pad(t, notes, dur, { vol = 0.06, cut = 900, rv = 0.7, type = 'sawtooth', a } = {}) {
      a = a ?? dur * 0.4; const g = env(t, a, dur - a > 0.05 ? dur - a : 0.05, vol);
      const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.7; lp.frequency.setValueAtTime(cut * 0.5, t); lp.frequency.linearRampToValueAtTime(cut, t + a);
      lp.connect(g); route(g, rv);
      for (const n of notes) for (const dt of [-7, 6]) { const o = c.createOscillator(); o.type = type; o.frequency.value = mtof(n); o.detune.value = dt; o.connect(lp); o.start(t); o.stop(t + dur + 0.05); }
    },
    pluck(t, n, vol = 0.3, rv = 0.5, cut = 3500, bright = 0.5) {
      const s = c.createBufferSource(); s.buffer = ksBuffer(c, mtof(n), 2.2, bright); const g = c.createGain(); g.gain.value = vol;
      const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = cut; s.connect(lp); lp.connect(g); route(g, rv); s.start(t);
    },
    bass(t, n, dur, { vol = 0.3, type = 'sawtooth', cut = 500, dist = 0, rv = 0 } = {}) {
      const o = c.createOscillator(); o.type = type; o.frequency.value = mtof(n);
      const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 3; lp.frequency.setValueAtTime(cut * 3, t); lp.frequency.exponentialRampToValueAtTime(cut, t + dur * 0.6);
      const g = env(t, 0.006, dur, vol); o.connect(lp);
      if (dist) { const w = c.createWaveShaper(); w.curve = shaperCurve(dist); lp.connect(w); w.connect(g); } else lp.connect(g);
      route(g, rv); o.start(t); o.stop(t + dur + 0.05);
    },
    lead(t, n, dur, { vol = 0.12, type = 'sawtooth', from, vib = 5, dist = 0, rv = 0.5, cut = 2600 } = {}) {
      const o = c.createOscillator(); o.type = type; const f = mtof(n);
      o.frequency.setValueAtTime(from ? mtof(from) : f, t); if (from) o.frequency.exponentialRampToValueAtTime(f, t + Math.min(0.18, dur * 0.4));
      const l = c.createOscillator(), lg = c.createGain(); l.frequency.value = vib; lg.gain.setValueAtTime(0, t); lg.gain.linearRampToValueAtTime(f * 0.012, t + dur * 0.7); l.connect(lg); lg.connect(o.frequency);
      const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = cut; const g = env(t, 0.03, dur, vol); o.connect(lp);
      if (dist) { const w = c.createWaveShaper(); w.curve = shaperCurve(dist); lp.connect(w); w.connect(g); } else lp.connect(g);
      route(g, rv); o.start(t); o.stop(t + dur + 0.1); l.start(t); l.stop(t + dur + 0.1);
    },
    kick(t, vol = 0.8, f = 150) {
      const o = c.createOscillator(); o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
      const g = env(t, 0.002, 0.28, vol); o.connect(g); route(g, 0.04); o.start(t); o.stop(t + 0.35); nz(t, 0, 'lowpass', 3000, 1, vol * 0.3, 0.001, 0.015);
    },
    snare(t, vol = 0.5) { nz(t, 0, 'bandpass', 2000, 0.8, vol, 0.002, 0.17, 0.3); const o = c.createOscillator(); o.type = 'triangle'; o.frequency.setValueAtTime(240, t); o.frequency.exponentialRampToValueAtTime(150, t + 0.1); const g = env(t, 0.002, 0.1, vol * 0.5); o.connect(g); route(g, 0.1); o.start(t); o.stop(t + 0.15); },
    hat(t, vol = 0.15, open = false) { nz(t, 0, 'highpass', 7500, 1, vol, 0.001, open ? 0.2 : 0.03, 0.05); },
    tom(t, n, vol = 0.5) { const o = c.createOscillator(); o.frequency.setValueAtTime(mtof(n) * 1.5, t); o.frequency.exponentialRampToValueAtTime(mtof(n), t + 0.1); const g = env(t, 0.003, 0.35, vol); o.connect(g); route(g, 0.3); o.start(t); o.stop(t + 0.4); },
    metal(t, f, vol = 0.12, d = 1.2, rv = 0.7) { for (const r of [1, 1.47, 2.09, 2.56, 3.9]) { const o = c.createOscillator(); o.type = 'square'; o.frequency.value = f * r; const b = c.createBiquadFilter(); b.type = 'bandpass'; b.frequency.value = f * r; b.Q.value = 12; const g = env(t, 0.002, d / (1 + r * 0.4), vol / (1 + r)); o.connect(b); b.connect(g); route(g, rv); o.start(t); o.stop(t + d + 0.1); } },
    drip(t, f = 1800 + rng() * 1500, vol = 0.1) { const o = c.createOscillator(); o.frequency.setValueAtTime(f * 1.3, t); o.frequency.exponentialRampToValueAtTime(f, t + 0.03); const g = env(t, 0.002, 0.25, vol); o.connect(g); route(g, 0.8); o.start(t); o.stop(t + 0.3); },
    swell(t, dur, vol, f1, f2, q = 1.2, rv = 0.5) { nz(t, 0, 'bandpass', f1, q, vol, dur * 0.55, dur * 0.45, rv, f2); },
    sub(t, n, dur, vol = 0.3) { const o = c.createOscillator(); o.frequency.value = mtof(n); const g = env(t, 0.01, dur, vol); o.connect(g); route(g, 0); o.start(t); o.stop(t + dur + 0.05); },
    crash(t, vol = 0.3) { nz(t, 0, 'highpass', 3500, 0.7, vol, 0.002, 1.3, 0.4); },
  };
  return K;
}

const pick = (r, a) => a[Math.floor(r() * a.length)];
const MIN = [0, 2, 3, 5, 7, 8, 10], PENT = [0, 3, 5, 7, 10];
const chordOf = (root, ints) => ints.map(i => root + i);

export const TRACKS = {
  logo: { bpm: 60, make(K, r) { return (i, t, s16) => { if ((i & 15) == 0) { const first = i == 0; const dur = 4.6;
    K.pad(t, [29, 36, 43], dur, { vol: first ? 0.11 : 0.08, cut: first ? 1400 : 700, a: dur * 0.85, rv: 0.8 });
    K.swell(t, dur, first ? 0.12 : 0.05, 120, 900, 1, 0.6); K.sub(t, 29, dur, 0.18);
    if (first) K.swell(t, 4, 0.05, 800, 5000, 3, 0.7); } }; } },

  intro: { bpm: 62, make(K, r) {
    const prog = [[45, [0, 7, 12, 15]], [41, [0, 7, 12, 16]], [48, [0, 7, 12, 16]], [43, [0, 7, 12, 16]]]; // Am F C G
    return (i, t, s16) => { const bar = i >> 4, s = i & 15, [root, ints] = prog[bar & 3];
      if (s == 0) { K.pad(t, chordOf(root + 12, ints.slice(1)), s16 * 17, { vol: 0.045, cut: 800, a: s16 * 7 }); K.bass(t, root - 12, s16 * 8, { vol: 0.22, type: 'sine', cut: 300 });
        if ((bar & 1) == 0) K.swell(t, s16 * 30, 0.06, 250, 700, 0.8, 0.5); }
      if (s % 2 == 0 && r() < 0.22) K.pluck(t, root + 12 + pick(r, [0, 3, 7, 10, 12, 14, 15].filter(x => ints.includes(x) || x > 8)) , 0.2 + r() * 0.15, 0.7, 2600);
      if (s == 8 && r() < 0.5) K.pluck(t, root + 24, 0.14, 0.8, 2000);
      if (s == 0 && (bar & 7) == 5) K.metal(t, 900, 0.02, 2.5, 0.9); }; } },

  title: { bpm: 84, gain: 0.8, make(K, r) {
    const roots = [38, 38, 34, 33]; // D D Bb A
    const bass = [0, 0, 0, 0, 0, 3, 0, 0, 0, 0, 0, 7, 3, 0, 0, 0], mel = [];
    for (let b = 0; b < 8; b++) { const m = []; for (let s = 0; s < 16; s++) m.push(s % 4 == 0 || r() < 0.18 ? pick(r, PENT) + 62 - 2 : -1); mel.push(m); }
    let prev = 62;
    return (i, t, s16) => { const bar = i >> 4, s = i & 15, root = roots[bar & 3];
      if (s == 0) { K.pad(t, [root + 12, root + 19, root + 24 + ((bar & 3) == 2 ? 0 : 3)], s16 * 16, { vol: 0.04, cut: 700, a: s16 * 3 }); }
      if (s % 2 == 0) { const n = root + bass[s]; if (s % 4 == 0 || r() < 0.6) K.bass(t, n, s16 * 1.8, { vol: 0.24, type: 'triangle', cut: 450, dist: 20 }); }
      if (s == 0 || s == 8) K.kick(t, 0.5, 120); if (s == 4 || s == 12) K.tom(t, 38, 0.18); if (s == 12) K.hat(t, 0.06, true);
      if (s % 4 == 2) K.hat(t, 0.04);
      const n = mel[bar & 7][s]; if (n > 0 && (bar % 8) >= 2) { const hi = n + (bar & 4 ? 12 : 0); K.lead(t, hi, s16 * (s % 4 == 0 ? 3.2 : 1.6), { vol: 0.07, from: prev, type: 'sawtooth', cut: 2000, vib: 5.5 }); if (r() < 0.4) K.pluck(t, hi - 12, 0.18, 0.6, 2500); prev = hi; } }; } },

  town: { bpm: 76, gain: 0.85, make(K, r) {
    const prog = [[48, [0, 4, 7, 11]], [45, [0, 3, 7, 10]], [41, [0, 4, 7, 11]], [43, [0, 4, 7, 10]]]; // C Am F G
    return (i, t, s16) => { const bar = i >> 4, s = i & 15, [root, ints] = prog[bar & 3];
      if (s == 0) { K.pad(t, chordOf(root + 12, ints), s16 * 16.5, { vol: 0.04, cut: 1100, type: 'triangle', a: s16 * 4 }); K.bass(t, root - 12, s16 * 5, { vol: 0.26, type: 'triangle', cut: 400 }); }
      if (s == 8) K.bass(t, root - 5, s16 * 3, { vol: 0.16, type: 'triangle', cut: 400 });
      if (s % 2 == 0) { const a = [0, 1, 2, 3, 2, 1, 2, 3][(s >> 1) & 7]; if (r() < 0.75) K.pluck(t, root + 12 + ints[a], 0.2 + r() * 0.1, 0.5, 3000, 0.6); }
      if (s % 4 == 2) K.hat(t, 0.025 + r() * 0.015);
      if (s == 8 && (bar & 1)) K.tom(t, 36, 0.12);
      if (s == 14 && bar % 4 == 3 && r() < 0.6) K.pluck(t, root + 24 + pick(r, [0, 4, 7]), 0.18, 0.8, 3500); }; } },

  wastes: { bpm: 56, make(K, r) {
    const roots = [38, 38, 36, 34];
    return (i, t, s16) => { const bar = i >> 4, s = i & 15, root = roots[(bar >> 1) & 3];
      if (s == 0 && (bar & 1) == 0) { K.pad(t, [root, root + 7, root + 12, root + 19], s16 * 34, { vol: 0.05, cut: 700, a: s16 * 12, rv: 0.8 }); K.swell(t, s16 * 32, 0.1, 300, 900, 0.7, 0.6); K.sub(t, root - 12, s16 * 30, 0.14); }
      if (s == 0 && (bar & 1) == 1) K.swell(t, s16 * 16, 0.05, 1200, 400, 1.5, 0.6);
      if (s % 4 == 0 && r() < 0.2) K.pluck(t, root + 24 + pick(r, [0, 7, 10, 12]), 0.2, 0.9, 2200, 0.35);
      if (s == 6 && bar % 4 == 2) K.lead(t, root + 31, s16 * 6, { vol: 0.03, type: 'sine', from: root + 29, rv: 0.9 }); }; } },

  ruins: { bpm: 70, make(K, r) {
    const pat = Array.from({ length: 16 }, (_, s) => s == 0 || (s % 4 == 0 && r() < 0.5) || r() < 0.1);
    return (i, t, s16) => { const bar = i >> 4, s = i & 15;
      if (s == 0 && (bar & 1) == 0) { K.pad(t, [40, 41, 47], s16 * 33, { vol: 0.04, cut: 500, a: s16 * 14, rv: 0.8 }); K.swell(t, s16 * 32, 0.07, 200, 3000, 2, 0.7); }
      if (pat[s]) K.sub(t, s == 0 ? 28 : 28 + pick(r, [0, 0, 1]), s16 * 2.2, s == 0 ? 0.36 : 0.2);
      if (r() < 0.07) K.metal(t, 300 + r() * 500, 0.06, 1.5);
      if (r() < 0.08) K.drip(t);
      if (s == 8 && r() < 0.25) K.pluck(t, 52 + pick(r, [0, 1, 6]), 0.12, 0.9, 1500, 0.3);
      if (s == 15 && bar % 4 == 3) K.swell(t, s16 * 14, 0.08, 400, 2500, 3, 0.6); }; } },

  combat: { bpm: 118, gain: 0.6, make(K, r) {
    const roots = [40, 40, 36, 38], bpat = [0, 0, 12, 0, 0, 0, 10, 0, 0, 0, 12, 0, 1, 0, 0, 3].map((x, i) => [x, r() < 0.8 || i % 4 == 0]);
    const kx = [6, 10, 14, 11].filter(() => r() < 0.55); const riffs = [0, 1].map(() => Array.from({ length: 16 }, (_, s) => (s % 4 == 0 && r() < 0.7) || r() < 0.22 ? pick(r, [0, 3, 5, 7, 10, 12, 15]) : -1));
    return (i, t, s16) => { const bar = i >> 4, s = i & 15, root = roots[bar & 3];
      if (s % 4 == 0 || kx.includes(s)) K.kick(t, s % 4 == 0 ? 0.8 : 0.55); if (s == 4 || s == 12) K.snare(t, 0.5);
      if (s % 2 == 0) K.hat(t, s % 4 == 0 ? 0.13 : 0.09, s == 14); else if (r() < 0.25) K.hat(t, 0.05);
      if (bar % 4 == 3 && s >= 12) K.tom(t, 45 - (s - 12) * 3, 0.4);
      if (s % 2 == 0 && bpat[s][1]) K.bass(t, root + bpat[s][0], s16 * 1.8, { vol: 0.26, cut: 600, dist: 25 });
      if (s == 0) K.pad(t, [root + 12, root + 19, root + 27], s16 * 15, { vol: 0.03, cut: 1200, a: s16 * 2, rv: 0.3 });
      if ((bar & 3) >= 2) { const n = riffs[(bar >> 2) & 1][s]; if (n >= 0) K.lead(t, root + 24 + n, s16 * 1.7, { vol: 0.07, type: 'square', dist: 30, cut: 3000, vib: 0, rv: 0.25 }); }
      if (s == 0 && bar % 4 == 0) K.crash(t, 0.14); }; } },

  boss: { bpm: 140, gain: 0.38, make(K, r) {
    const ph = [0, 1, 0, 0, 3, 1, 0, 6], roots = [38, 38, 39, 36];
    const kx = new Set([0, 3, 4, 7, 8, 10, 11, 12, 14]);
    return (i, t, s16) => { const bar = i >> 4, s = i & 15, root = roots[bar & 3];
      if (kx.has(s) || (bar % 4 == 3 && s > 11)) K.kick(t, 0.85, 160); if (s == 4 || s == 12) { K.snare(t, 0.6); K.tom(t, 33, 0.25); }
      K.hat(t, s % 2 ? 0.05 : 0.11, s == 14);
      if (s % 2 == 0 || r() < 0.3) K.bass(t, root - 12 + ph[(s >> 1) & 7] + (s == 15 ? 12 : 0), s16 * 1.5, { vol: 0.3, type: 'sawtooth', cut: 700, dist: 60 });
      if (s == 0 || s == 6 || s == 10) { K.pad(t, [root + 12, root + 19, root + 24], s16 * 3, { vol: 0.045, cut: 2500, type: 'sawtooth', a: 0.01, rv: 0.25 }); }
      if (s == 0) { K.pad(t, [root + 24, root + 25], s16 * 16, { vol: 0.02, cut: 1800, a: s16 * 8, rv: 0.6 }); if (bar % 4 == 0) { K.crash(t, 0.25); K.sub(t, root - 24, s16 * 8, 0.35); } }
      if (bar % 2 == 1 && s % 2 == 0 && r() < 0.6) K.lead(t, root + 36 + pick(r, [0, 1, 3, 6, 7]), s16 * 1.5, { vol: 0.06, type: 'square', dist: 80, cut: 3500, vib: 0, rv: 0.3 }); }; } },

  victory: { bpm: 100, len: 56, make(K, r) {
    const mel = { 0: 67, 3: 67, 5: 67, 6: 72, 8: 76, 12: 79, 16: 76, 18: 79, 20: 84, 24: 84 }; // note per step
    return (i, t, s16) => { const m = mel[i];
      if (m) { const long = i == 24 ? 2.2 : 0.35; const d = i == 24 ? 8 : (i == 12 || i == 20 ? 3 : 1.6);
        K.lead(t, m, s16 * d, { vol: 0.1, type: 'sawtooth', cut: 2600, rv: 0.5, vib: 5 }); K.lead(t, m - 12, s16 * d, { vol: 0.07, type: 'sawtooth', cut: 1800, rv: 0.4, vib: 5 }); }
      if (i % 4 == 0 && i < 24) K.kick(t, 0.5); if (i % 8 == 4 && i < 24) K.snare(t, 0.3);
      if (i == 24) { K.pad(t, [48, 55, 60, 64, 67], s16 * 28, { vol: 0.06, cut: 2200, a: 0.03, rv: 0.6 }); K.crash(t, 0.25); K.kick(t, 0.8, 120); K.sub(t, 36, s16 * 20, 0.3); }
      if (i == 0) K.pad(t, [43, 50, 55], s16 * 24, { vol: 0.04, cut: 1500, a: s16 * 4 }); }; } },

  defeat: { bpm: 60, len: 40, make(K, r) {
    const notes = { 0: 69, 4: 68, 8: 65, 14: 64 };
    return (i, t, s16) => { const m = notes[i];
      if (m) K.lead(t, m, s16 * (i == 14 ? 22 : 4), { vol: 0.08, type: 'sawtooth', cut: 1400, rv: 0.7, vib: 4, from: i == 14 ? 65 : undefined });
      if (i == 0) { K.pad(t, [33, 40, 45, 48], s16 * 36, { vol: 0.06, cut: 700, a: s16 * 8, rv: 0.8 }); K.sub(t, 21, s16 * 32, 0.3); }
      if (i == 8) K.tom(t, 33, 0.3); if (i == 14) { K.kick(t, 0.6, 90); K.metal(t, 330, 0.06, 2.5); } }; } },
};

export function createTrack(name, c, dry, wet, seed = 1) {
  const def = TRACKS[name]; if (!def) return null;
  const r = mulberry32(seed * 7919 + name.length * 131 + name.charCodeAt(0));
  const K = kit(c, dry, wet, r), s16 = 60 / def.bpm / 4, step = def.make(K, r);
  let i = 0, next = 0, started = false, ended = false;
  return {
    bpm: def.bpm, s16, gain: def.gain ?? 1,
    // schedule all steps that start before `until` (absolute ctx time); `start` = time of step 0
    schedule(until, start) {
      if (!started) { next = start; started = true; }
      while (!ended && next < until) { step(i, next, s16); i++; next += s16; if (def.len && i >= def.len) ended = true; }
    },
    get ended() { return ended; },
  };
}
