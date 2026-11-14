// Procedural sound effects. Each fn(c, out, t, P) where P = pitch multiplier (already jittered).
import { noise, tone, jit, rnd } from './core.js';

const metal = (c, out, t, f, vol, d = 0.6) => { for (const r of [1, 2.76, 5.4, 8.9]) tone(c, out, t, { f: f * r, d: d / (1 + r * 0.15), vol: vol / (1 + r * 0.4) }); };
const clink = (c, out, t, f, vol = 0.25) => { metal(c, out, t, f, vol, 0.35); noise(c, out, t, { type: 'highpass', f: 6000, d: 0.012, vol: vol * 0.6 }); };
const thump = (c, out, t, f, d, vol) => tone(c, out, t, { f, f2: f * 0.35, d, vol });

function gun(c, out, t, P, k) {
  noise(c, out, t, { f: k.crack * P, f2: k.crack * 0.25 * P, q: 0.7, d: k.cd, vol: k.cv });
  noise(c, out, t, { type: 'highpass', f: 5000, d: 0.015, vol: 0.3 });
  thump(c, out, t, k.sub * P, k.sd, k.sv);
  noise(c, out, t + 0.01, { type: 'lowpass', f: k.tail, f2: 120, d: k.td, vol: k.tv });
}
const rate = (t, n, gap, fn) => { for (let i = 0; i < n; i++) fn(t + i * gap * jit(0.1), i); };

export const SFX = {
  click: { dur: 0.1, rev: 0.05, max: 3, fn(c, o, t, P) { noise(c, o, t, { f: 3200 * P, q: 2, d: 0.02, vol: 0.22 }); tone(c, o, t, { type: 'triangle', f: 950 * P, f2: 600 * P, d: 0.05, vol: 0.14 }); } },
  hover: { dur: 0.05, rev: 0, max: 2, gap: 0.07, fn(c, o, t, P) { tone(c, o, t, { f: 1700 * P, d: 0.03, vol: 0.035 }); } },
  dice: { dur: 1.2, rev: 0.12, max: 2, fn(c, o, t, P) {
    let gap = 0.035, tt = t, vol = 0.45;
    for (let i = 0; i < 11; i++) {
      noise(c, o, tt, { f: rnd(1800, 4800) * P, q: 3, d: 0.025, vol });
      tone(c, o, tt, { type: 'triangle', f: rnd(700, 1500) * P, f2: 400, d: 0.05, vol: vol * 0.5 });
      if (i % 3 == 0) tone(c, o, tt, { type: 'square', f: rnd(2500, 3500) * P, d: 0.008, vol: vol * 0.15 });
      tt += gap; gap *= 1.27; vol *= 0.93;
    } } },
  hit: { dur: 0.4, rev: 0.12, max: 4, fn(c, o, t, P) {
    noise(c, o, t, { f: 1400 * P, f2: 300, q: 0.8, d: 0.09, vol: 0.7 }); thump(c, o, t, 150 * P, 0.14, 0.8);
    noise(c, o, t, { type: 'lowpass', f: 700, d: 0.16, vol: 0.45 }); } },
  crit: { dur: 1.2, rev: 0.25, max: 3, fn(c, o, t, P) {
    noise(c, o, t, { f: 1800 * P, f2: 250, q: 0.8, d: 0.12, vol: 0.75 }); thump(c, o, t, 170 * P, 0.2, 0.9);
    noise(c, o, t, { type: 'highpass', f: 4000, d: 0.04, vol: 0.4 });
    metal(c, o, t + 0.01, 1150 * P, 0.4, 1.0);
    tone(c, o, t, { type: 'sawtooth', f: 3000 * P, f2: 300, d: 0.1, vol: 0.14, lp: 5000 }); } },
  miss: { dur: 0.4, rev: 0.1, max: 3, fn(c, o, t, P) {
    noise(c, o, t, { f: 600 * P, f2: 2600 * P, q: 1.2, a: 0.07, d: 0.14, vol: 0.32 });
    noise(c, o, t + 0.08, { f: 2600 * P, f2: 800 * P, q: 1.5, a: 0.02, d: 0.14, vol: 0.2 }); } },
  melee: { dur: 0.6, rev: 0.12, max: 3, fn(c, o, t, P) {
    noise(c, o, t, { f: 350 * P, f2: 2400 * P, q: 1.4, a: 0.09, d: 0.1, vol: 0.4 });
    const h = t + 0.15; noise(c, o, h, { type: 'lowpass', f: 1100, f2: 200, d: 0.16, vol: 0.7 }); thump(c, o, h, 130 * P, 0.16, 0.85);
    noise(c, o, h, { f: 3000, q: 1.5, d: 0.03, vol: 0.3 }); } },
  shot_pistol: { dur: 1.0, rev: 0.3, max: 4, fn(c, o, t, P) { gun(c, o, t, P, { crack: 3200, cd: 0.1, cv: 0.85, sub: 190, sd: 0.14, sv: 0.8, tail: 900, td: 0.45, tv: 0.35 }); } },
  shot_rifle: { dur: 1.6, rev: 0.45, max: 3, fn(c, o, t, P) { gun(c, o, t, P, { crack: 4200, cd: 0.14, cv: 1, sub: 130, sd: 0.22, sv: 0.95, tail: 700, td: 0.9, tv: 0.5 });
    tone(c, o, t, { type: 'sawtooth', f: 2400 * P, f2: 500, d: 0.06, vol: 0.12, lp: 4000 }); } },
  shot_shotgun: { dur: 1.8, rev: 0.4, max: 2, fn(c, o, t, P) { gun(c, o, t, P, { crack: 2600, cd: 0.22, cv: 1, sub: 100, sd: 0.3, sv: 1, tail: 500, td: 0.9, tv: 0.65 });
    noise(c, o, t, { type: 'lowpass', f: 1800, f2: 200, d: 0.3, vol: 0.5 });
    const p = t + 0.5; noise(c, o, p, { f: 2200, q: 3, d: 0.02, vol: 0.3 }); noise(c, o, p + 0.12, { f: 1600, q: 3, d: 0.025, vol: 0.35 }); } },
  shot_smg: { dur: 1.0, rev: 0.25, max: 3, fn(c, o, t, P) { rate(t, 3, 0.065, (tt, i) => gun(c, o, tt, P * jit(0.05), { crack: 3600, cd: 0.06, cv: 0.55, sub: 220, sd: 0.07, sv: 0.45, tail: 1000, td: i == 2 ? 0.3 : 0.1, tv: 0.2 })); } },
  shot_laser: { dur: 0.7, rev: 0.35, max: 4, fn(c, o, t, P) {
    tone(c, o, t, { type: 'sawtooth', f: 2600 * P, f2: 160 * P, d: 0.24, vol: 0.28, lp: 6000 });
    tone(c, o, t, { type: 'square', f: 1300 * P, f2: 90, d: 0.2, vol: 0.15, lp: 3000 });
    noise(c, o, t, { type: 'highpass', f: 6000, d: 0.05, vol: 0.2 }); tone(c, o, t + 0.02, { f: 90, f2: 50, d: 0.15, vol: 0.4 }); } },
  explosion: { dur: 3.2, rev: 0.5, max: 2, fn(c, o, t, P) {
    tone(c, o, t, { f: 85 * P, f2: 26, d: 1.4, vol: 1 });
    noise(c, o, t, { type: 'lowpass', f: 1400, f2: 90, d: 1.9, vol: 0.95 });
    noise(c, o, t, { f: 2500, f2: 300, d: 0.35, vol: 0.6 });
    for (let i = 0; i < 14; i++) noise(c, o, t + rnd(0.1, 1.6), { type: 'highpass', f: rnd(1500, 5000), d: rnd(0.02, 0.07), vol: rnd(0.1, 0.3) });
    for (let i = 0; i < 4; i++) tone(c, o, t + rnd(0.15, 1.3), { f: rnd(120, 320), f2: 60, d: 0.12, vol: 0.15 }); } },
  heal: { dur: 1.4, rev: 0.45, max: 2, fn(c, o, t, P) {
    [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) => { tone(c, o, t + i * 0.07, { type: 'triangle', f: f * P, d: 0.55, vol: 0.14, lp: 5000 }); tone(c, o, t + i * 0.07, { f: f * 2 * P, d: 0.35, vol: 0.04 }); });
    noise(c, o, t, { type: 'bandpass', f: 3000, f2: 7000, q: 4, a: 0.3, d: 0.5, vol: 0.05 }); } },
  step: { dur: 0.2, rev: 0.08, max: 3, gap: 0.08, fn(c, o, t, P) { noise(c, o, t, { type: 'lowpass', f: rnd(350, 650) * P, d: 0.07, vol: 0.4 }); noise(c, o, t, { f: 2500, q: 1, d: 0.015, vol: 0.08 }); tone(c, o, t, { f: 85 * P, f2: 50, d: 0.07, vol: 0.3 }); } },
  levelup: { dur: 2.4, rev: 0.4, max: 1, fn(c, o, t, P) {
    const n = (f, tt, d, v = 0.2) => { tone(c, o, tt, { type: 'sawtooth', f: f * P, d, vol: v, lp: 3200, a: 0.01 }); tone(c, o, tt, { type: 'square', f: f * P * 1.004, d, vol: v * 0.4, lp: 2400, a: 0.01 }); };
    n(523.25, t, 0.16); n(659.25, t + 0.14, 0.16); n(783.99, t + 0.28, 0.16); n(1046.5, t + 0.42, 0.7, 0.22);
    [523.25, 659.25, 783.99, 1046.5].forEach(f => tone(c, o, t + 0.56, { type: 'triangle', f: f * P, d: 1.4, vol: 0.12, hold: 0.2 }));
    metal(c, o, t + 0.45, 2093 * P, 0.1, 1.2); } },
  coin: { dur: 0.8, rev: 0.2, max: 4, fn(c, o, t, P) { clink(c, o, t, 1750 * P, 0.28); clink(c, o, t + 0.075, 2350 * P, 0.22); } },
  buy: { dur: 1.3, rev: 0.25, max: 2, fn(c, o, t, P) { for (let i = 0; i < 3; i++) clink(c, o, t + i * 0.07, rnd(1500, 2400) * P, 0.2);
    clink(c, o, t + 0.28, 2637 * P, 0.28); clink(c, o, t + 0.36, 3520 * P, 0.25); noise(c, o, t + 0.26, { f: 4000, q: 2, d: 0.05, vol: 0.12 }); } },
  error: { dur: 0.5, rev: 0.1, max: 2, fn(c, o, t, P) { for (let i = 0; i < 2; i++) { tone(c, o, t + i * 0.13, { type: 'square', f: 150 * P, d: 0.1, vol: 0.2, lp: 700 }); tone(c, o, t + i * 0.13, { type: 'sawtooth', f: 155 * P, d: 0.1, vol: 0.12, lp: 600 }); } } },
  death: { dur: 2.2, rev: 0.4, max: 2, fn(c, o, t, P) {
    tone(c, o, t, { type: 'sawtooth', f: 240 * P, f2: 38, d: 1.4, vol: 0.28, lp: 900 });
    noise(c, o, t, { type: 'lowpass', f: 900, f2: 100, d: 1.2, vol: 0.4 }); thump(c, o, t + 0.9, 90, 0.3, 0.8); noise(c, o, t + 0.9, { type: 'lowpass', f: 500, d: 0.2, vol: 0.5 }); } },
  scream: { dur: 1.3, rev: 0.4, max: 2, fn(c, o, t, P) {
    const os = c.createOscillator(); os.type = 'sawtooth'; const lfo = c.createOscillator(), lg = c.createGain(); lfo.frequency.value = rnd(6, 9); lg.gain.value = 35 * P;
    lfo.connect(lg); lg.connect(os.frequency);
    os.frequency.setValueAtTime(420 * P, t); os.frequency.exponentialRampToValueAtTime(980 * P, t + 0.18); os.frequency.setValueAtTime(980 * P, t + 0.35); os.frequency.exponentialRampToValueAtTime(520 * P, t + 1.0);
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.35, t + 0.05); g.gain.setValueAtTime(0.3, t + 0.5); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
    for (const [f, q, v] of [[800, 6, 1], [1800, 8, 0.7], [3200, 6, 0.3]]) { const b = c.createBiquadFilter(); b.type = 'bandpass'; b.frequency.value = f; b.Q.value = q; const bg = c.createGain(); bg.gain.value = v; os.connect(b); b.connect(bg); bg.connect(g); }
    g.connect(o); os.start(t); os.stop(t + 1.2); lfo.start(t); lfo.stop(t + 1.2);
    noise(c, o, t, { f: 2500, q: 1, a: 0.05, d: 0.9, vol: 0.12 }); } },
  growl: { dur: 1.3, rev: 0.25, max: 2, fn(c, o, t, P) {
    const os = c.createOscillator(); os.type = 'sawtooth'; os.frequency.setValueAtTime(78 * P, t); os.frequency.linearRampToValueAtTime(62 * P, t + 1);
    const am = c.createOscillator(), amg = c.createGain(), g = c.createGain(), lp = c.createBiquadFilter(), env = c.createGain();
    am.frequency.value = rnd(22, 30); amg.gain.value = 0.5; am.connect(amg); amg.connect(g.gain); g.gain.value = 0.5;
    env.gain.setValueAtTime(0.0001, t); env.gain.linearRampToValueAtTime(0.7, t + 0.15); env.gain.setValueAtTime(0.6, t + 0.7); env.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
    lp.type = 'lowpass'; lp.frequency.setValueAtTime(350, t); lp.frequency.linearRampToValueAtTime(700, t + 0.4); lp.Q.value = 4;
    os.connect(lp); lp.connect(g); g.connect(env); env.connect(o);
    os.start(t); os.stop(t + 1.2); am.start(t); am.stop(t + 1.2);
    noise(c, o, t, { f: 400, q: 2, a: 0.2, d: 0.8, vol: 0.2 }); } },
  door: { dur: 1.6, rev: 0.3, max: 2, fn(c, o, t, P) {
    const os = c.createOscillator(); os.type = 'sawtooth'; let f = rnd(160, 220) * P; os.frequency.setValueAtTime(f, t);
    for (let i = 1; i <= 12; i++) { f = Math.max(90, Math.min(520, f * rnd(0.85, 1.2))); os.frequency.linearRampToValueAtTime(f, t + i * 0.085); }
    const b = c.createBiquadFilter(); b.type = 'bandpass'; b.frequency.value = 900 * P; b.Q.value = 7;
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.35, t + 0.1); g.gain.setValueAtTime(0.3, t + 0.8); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
    os.connect(b); b.connect(g); g.connect(o); os.start(t); os.stop(t + 1.2);
    noise(c, o, t, { f: 1500, q: 5, a: 0.1, d: 0.9, vol: 0.06 });
    thump(c, o, t + 1.1, 110, 0.2, 0.6); noise(c, o, t + 1.1, { type: 'lowpass', f: 600, d: 0.2, vol: 0.5 }); metal(c, o, t + 1.1, 420, 0.1, 0.5); } },
  pickup: { dur: 0.4, rev: 0.2, max: 3, fn(c, o, t, P) { tone(c, o, t, { type: 'triangle', f: 600 * P, f2: 1300 * P, d: 0.1, vol: 0.2 }); tone(c, o, t + 0.07, { f: 1900 * P, d: 0.18, vol: 0.14 }); } },
  geiger: { dur: 1.0, rev: 0.05, max: 2, gap: 0.2, fn(c, o, t) { const n = 3 + Math.floor(Math.random() * 8); for (let i = 0; i < n; i++) { const tt = t + Math.random() * 0.8; noise(c, o, tt, { type: 'highpass', f: 2500, d: 0.005, vol: rnd(0.25, 0.5) }); tone(c, o, tt, { type: 'square', f: rnd(2800, 3600), d: 0.003, vol: 0.06 }); } } },
  logo: { dur: 6, rev: 0.55, max: 1, fn(c, o, t) {
    // short riser, then the impact lands at t+0.35
    noise(c, o, t, { f: 150, f2: 5000, q: 1.5, a: 0.3, d: 0.05, vol: 0.4 });
    const h = t + 0.35;
    tone(c, o, h, { f: 62, f2: 24, d: 3.2, vol: 0.8 }); tone(c, o, h, { f: 124, f2: 40, d: 1.5, vol: 0.5 });
    noise(c, o, h, { type: 'lowpass', f: 3500, f2: 90, d: 3.6, vol: 0.65 }); noise(c, o, h, { f: 1800, f2: 200, d: 0.5, vol: 0.45 });
    metal(c, o, h, 220, 0.2, 3.0);
    for (let i = 0; i < 26; i++) { const tt = h + Math.pow(Math.random(), 1.6) * 2.2; noise(c, o, tt, { f: rnd(2500, 9000), q: 4, d: rnd(0.01, 0.05), vol: rnd(0.15, 0.5) }); if (i % 3 == 0) tone(c, o, tt, { type: 'sawtooth', f: rnd(3000, 6000), f2: 200, d: 0.07, vol: 0.12, lp: 6000 }); }
    for (let i = 0; i < 5; i++) noise(c, o, h + 0.4 + i * rnd(0.3, 0.6), { type: 'lowpass', f: 300, d: rnd(0.5, 1), a: 0.15, vol: 0.4 }); } },
  typewriter: { dur: 0.1, rev: 0.03, max: 4, gap: 0.025, fn(c, o, t, P) { noise(c, o, t, { f: rnd(2800, 4200) * P, q: 2, d: 0.012, vol: 0.2 }); tone(c, o, t, { type: 'square', f: rnd(900, 1300) * P, d: 0.01, vol: 0.05, lp: 3000 }); } },
  turn: { dur: 1.2, rev: 0.4, max: 1, fn(c, o, t, P) { for (const [f, dt] of [[659.25, 0], [987.77, 0.12]]) { tone(c, o, t + dt, { f: f * P, d: 0.7, vol: 0.2 }); tone(c, o, t + dt, { f: f * P * 2.76, d: 0.25, vol: 0.05 }); tone(c, o, t + dt, { type: 'triangle', f: f * P * 0.5, d: 0.5, vol: 0.1 }); } } },
  victory: { dur: 3, rev: 0.45, max: 1, fn(c, o, t, P) {
    const br = (f, tt, d, v = 0.17) => { tone(c, o, tt, { type: 'sawtooth', f: f * P, d, vol: v, lp: 2600, a: 0.03 }); tone(c, o, tt, { type: 'sawtooth', f: f * P * 1.006, d, vol: v * 0.7, lp: 2200, a: 0.03 }); };
    br(392, t, 0.28); br(392, t + 0.3, 0.2); br(523.25, t + 0.5, 0.25); br(659.25, t + 0.75, 0.25);
    [523.25, 659.25, 783.99, 1046.5].forEach(f => br(f, t + 1.0, 1.6, 0.13)); thump(c, o, t + 1.0, 70, 0.4, 0.5); } },
  defeat: { dur: 3.2, rev: 0.5, max: 1, fn(c, o, t, P) {
    [[440, 0], [415.3, 0.55], [349.2, 1.1], [329.6, 1.65]].forEach(([f, dt], i) => { tone(c, o, t + dt, { type: 'sawtooth', f: f * 0.5 * P, d: i == 3 ? 1.5 : 0.6, vol: 0.2, lp: 1200, a: 0.04 }); });
    tone(c, o, t + 1.65, { f: 55, f2: 40, d: 1.5, vol: 0.5 }); noise(c, o, t + 1.65, { type: 'lowpass', f: 400, d: 1.2, vol: 0.2 }); } },
  alarm: { dur: 2.0, rev: 0.25, max: 1, fn(c, o, t, P) { for (let i = 0; i < 4; i++) tone(c, o, t + i * 0.45, { type: 'square', f: 880 * P, f2: 620 * P, d: 0.36, vol: 0.2, lp: 2400, hold: 0.04 }); } },
  radio: { dur: 1.3, rev: 0.05, max: 1, fn(c, o, t, P) {
    const n = noise(c, o, t, { f: 1700, q: 0.9, a: 0.02, d: 0.85, vol: 0.3 });
    for (let i = 0; i < 24; i++) n.g.gain.setValueAtTime(rnd(0.05, 0.35), t + 0.03 + i * 0.035);
    n.g.gain.exponentialRampToValueAtTime(0.0001, t + 1.0);
    noise(c, o, t, { type: 'highpass', f: 3500, d: 0.9, vol: 0.05 }); tone(c, o, t, { f: 1050 * P, d: 0.07, vol: 0.12, lp: 3000 }); } },
};

export function playSfx(c, dry, wet, name, t, o = {}) {
  const m = SFX[name]; if (!m) return null;
  const vg = c.createGain(); vg.gain.value = o.vol ?? 1; vg.connect(dry);
  let send = null;
  if (wet && m.rev) { send = c.createGain(); send.gain.value = m.rev; vg.connect(send); send.connect(wet); }
  m.fn(c, vg, t, (o.pitch || 1) * jit(0.04));
  return { vg, send, dur: m.dur };
}
