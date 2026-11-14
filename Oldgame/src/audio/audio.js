// Audio facade. See docs/DESIGN.md. Everything is synthesized with WebAudio; no audio files.
import { createBuses } from './engine.js';
import { SFX, playSfx } from './sfx.js';
import { createTrack, TRACKS } from './music.js';
import { createAmbience } from './ambience.js';

const KEY = 'pyl-i-rdza.audio';
const vol = { master: 0.8, music: 0.5, sfx: 0.8 };
let muted = false;
try { const s = JSON.parse(localStorage.getItem(KEY) || 'null'); if (s) { for (const k of ['master', 'music', 'sfx']) if (typeof s[k] === 'number') vol[k] = Math.max(0, Math.min(1, s[k])); muted = !!s.muted; } } catch (e) {}
const save = () => { try { localStorage.setItem(KEY, JSON.stringify({ ...vol, muted })); } catch (e) {} };

let c = null, B = null;
let wantMusic = null, wantAmb = 'none';
let cur = null, curName = null, ambCur = null, ambName = 'none', timer = null, seedCtr = 1;
const active = new Map(), lastPlay = new Map(), LOW = new Set(['hover', 'step', 'click', 'typewriter', 'geiger']);

function apply() {
  if (!B) return;
  const t = c.currentTime, set = (p, v) => { p.cancelScheduledValues(t); p.setTargetAtTime(v, t, 0.03); };
  set(B.master.gain, muted ? 0 : vol.master);
  set(B.music.gain, vol.music); set(B.musicWet.gain, vol.music);
  set(B.sfx.gain, vol.sfx); set(B.sfxWet.gain, vol.sfx);
}

function tick() {
  if (!c || c.state !== 'running') return;
  const now = c.currentTime;
  if (cur && !cur.dead) { cur.trk.schedule(now + 0.5, cur.start); }
}

const trkGain = n => (TRACKS[n] && TRACKS[n].gain) || 1;
function startTrack(name) {
  const t = c.currentTime + 0.05;
  const hadOld = !!cur;
  if (cur) { const old = cur; old.dead = true; old.g.gain.cancelScheduledValues(t); old.g.gain.setValueAtTime(old.g.gain.value, t); old.g.gain.linearRampToValueAtTime(0, t + 1.5); setTimeout(() => { try { old.g.disconnect(); old.w.disconnect(); } catch (e) {} }, 1800); cur = null; }
  curName = name; if (!name) return;
  const g = c.createGain(), w = c.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(trkGain(name), t + (hadOld ? 1.5 : 0.3));
  g.connect(B.music); w.connect(B.musicWet); w.gain.value = 1;
  const trk = createTrack(name, c, g, w, ++seedCtr + (Date.now() % 997));
  if (!trk) { g.disconnect(); w.disconnect(); return; }
  w.gain.setValueAtTime(0, t); w.gain.linearRampToValueAtTime(1, t + 1.5);
  cur = { trk, g, w, start: t + 0.05, dead: false };
  tick();
}

export const Audio = {
  get muted() { return muted; },
  set muted(v) { muted = !!v; save(); apply(); },
  get ready() { return !!c; },
  get context() { return c; },
  init() {
    try {
      if (!c) {
        const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
        c = new AC({ latencyHint: 'interactive' }); B = createBuses(c); apply();
        timer = setInterval(tick, 100);
        document.addEventListener('visibilitychange', () => { if (c && !document.hidden && c.state === 'suspended') c.resume().catch(() => {}); });
        if (wantMusic) startTrack(wantMusic);
        if (wantAmb && wantAmb !== 'none') Audio.ambience(wantAmb);
      }
      if (c.state === 'suspended') c.resume().then(() => { if (wantMusic && !cur) startTrack(wantMusic); }).catch(() => {});
    } catch (e) { console.warn('[audio] init failed', e); }
  },
  sfx(name, o = {}) {
    if (!c || c.state !== 'running') return;
    const m = SFX[name]; if (!m) return;
    const now = c.currentTime;
    if (m.gap && now - (lastPlay.get(name) || -9) < m.gap) return;
    let list = (active.get(name) || []).filter(e => e > now);
    if (m.max && list.length >= m.max) return;
    let total = 0; for (const l of active.values()) total += l.filter(e => e > now).length;
    if (total > 28 && LOW.has(name)) return;
    if (total > 48) return;
    lastPlay.set(name, now);
    try {
      const v = playSfx(c, B.sfx, B.sfxWet, name, now + 0.005, o); if (!v) return;
      list.push(now + v.dur); active.set(name, list);
      setTimeout(() => { try { v.vg.disconnect(); v.send && v.send.disconnect(); } catch (e) {} }, (v.dur + 0.5) * 1000);
    } catch (e) { console.warn('[audio] sfx', name, e); }
  },
  music(track) {
    wantMusic = track || null; if (!c) return;
    if (c.state === 'suspended') c.resume().catch(() => {});
    if (wantMusic === curName && (cur || !wantMusic)) return;
    startTrack(wantMusic);
  },
  ambience(name) {
    wantAmb = name || 'none'; if (!c) return;
    if (name === ambName) return; ambName = name || 'none';
    if (ambCur) { ambCur.stop(1.5); ambCur = null; }
    if (ambName !== 'none') ambCur = createAmbience(ambName, c, B.amb);
  },
  setVolume(v = {}) { for (const k of ['master', 'music', 'sfx']) if (typeof v[k] === 'number') vol[k] = Math.max(0, Math.min(1, v[k])); save(); apply(); },
  getVolume() { return { ...vol }; },
  sfxNames: Object.keys(SFX),
};
export default Audio;
