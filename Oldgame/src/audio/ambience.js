// Looping ambience beds. createAmbience(name, c, dst) -> {stop(fade)}; fades in over 1.5s.
import { noiseBuf, tone, noise, rnd } from './core.js';

export function createAmbience(name, c, dst) {
  const g = c.createGain(); g.gain.value = 0; g.connect(dst);
  const t0 = c.currentTime; g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(1, t0 + 1.5);
  const srcs = [], timers = [];
  const loopNoise = (type, f, q, vol) => { const s = c.createBufferSource(); s.buffer = noiseBuf(c); s.loop = true; const fl = c.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q; const v = c.createGain(); v.gain.value = vol; s.connect(fl); fl.connect(v); v.connect(g); s.start(0, Math.random() * 1.5); srcs.push(s); return { fl, v }; };
  const lfo = (rate, depth, param) => { const o = c.createOscillator(), d = c.createGain(); o.frequency.value = rate; d.gain.value = depth; o.connect(d); d.connect(param); o.start(); srcs.push(o); };
  const wind = (vol) => {
    const a = loopNoise('bandpass', 420, 0.9, vol); lfo(0.07, 220, a.fl.frequency); lfo(0.11, vol * 0.45, a.v.gain);
    const b = loopNoise('bandpass', 1300, 5, vol * 0.25); lfo(0.05, 500, b.fl.frequency); lfo(0.13, vol * 0.12, b.v.gain);
    loopNoise('lowpass', 160, 0.5, vol * 0.5);
  };
  const every = (ms, fn) => timers.push(setInterval(() => { if (c.state === 'running') fn(c.currentTime + 0.05); }, ms));
  const out = g;
  if (name === 'wind') wind(0.16);
  else if (name === 'ruins') {
    wind(0.1);
    every(700, t => { const r = Math.random();
      if (r < 0.14) tone(c, out, t, { type: 'sine', f: rnd(1800, 3200), f2: rnd(1400, 2200), d: 0.2, vol: 0.05 });          // drip
      else if (r < 0.22) { const o = c.createOscillator(); o.type = 'sawtooth'; const f = rnd(120, 260); o.frequency.setValueAtTime(f, t); o.frequency.linearRampToValueAtTime(f * rnd(0.8, 1.3), t + 0.9);
        const b = c.createBiquadFilter(); b.type = 'bandpass'; b.frequency.value = rnd(500, 1100); b.Q.value = 8; const v = c.createGain(); v.gain.setValueAtTime(0.0001, t); v.gain.linearRampToValueAtTime(0.045, t + 0.3); v.gain.exponentialRampToValueAtTime(0.0001, t + 1.0);
        o.connect(b); b.connect(v); v.connect(out); o.start(t); o.stop(t + 1.1); }                                           // creak
      else if (r < 0.25) { for (const m of [1, 2.7, 5.1]) tone(c, out, t, { f: rnd(200, 320) * m, d: 1.2 / m, vol: 0.02 }); noise(c, out, t, { f: 1500, q: 2, d: 0.03, vol: 0.03 }); } }); // distant clang
  } else if (name === 'town') {
    const m1 = loopNoise('bandpass', 360, 1.6, 0.07), m2 = loopNoise('bandpass', 950, 2, 0.04);
    lfo(0.37, 0.03, m1.v.gain); lfo(0.61, 0.02, m2.v.gain); lfo(0.23, 120, m1.fl.frequency); lfo(0.41, 250, m2.fl.frequency);
    loopNoise('lowpass', 220, 0.5, 0.05); wind(0.04);
    every(90, t => { if (Math.random() < 0.45) noise(c, out, t + Math.random() * 0.08, { type: 'highpass', f: rnd(1800, 4500), d: rnd(0.01, 0.04), vol: rnd(0.02, 0.07) }); if (Math.random() < 0.04) noise(c, out, t, { type: 'lowpass', f: 900, d: 0.08, vol: 0.08 }); });
  }
  return {
    stop(fade = 1.5) {
      const t = c.currentTime; g.gain.cancelScheduledValues(t); g.gain.setValueAtTime(g.gain.value, t); g.gain.linearRampToValueAtTime(0, t + fade);
      timers.forEach(clearInterval);
      setTimeout(() => { srcs.forEach(s => { try { s.stop(); } catch (e) {} }); try { g.disconnect(); } catch (e) {} }, (fade + 0.1) * 1000);
    },
  };
}
