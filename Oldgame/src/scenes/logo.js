// STORM 32 studio logo (2026-11-13, v4): no hummingbird animation any more — only cubes. The original artwork
// (assets/storm32-logo.jpg, copied from ~/WebGames/logo) is sampled into a grid of small coloured cubes that rain
// down / drift in and settle into the final picture; then the real image fades in over them and stays perfectly still.
// ~6.5 s, click / key skips.
import { THREE, UI, Audio, fadeLayer } from './meta/common.js';
import { Game } from '../core/game.js';
import { Engine } from '../core/engine.js';

const SRC = 'assets/storm32-logo.jpg';
const GW = 192, GH = 108;                  // cube grid (16:9, like the artwork)
const T_FLY = 3.2, T_FADE = 0.7, T_HOLD = 2.6, TOTAL = T_FLY + T_FADE + T_HOLD;
const BG = [6, 10, 20];
let S = null;

function buildCubes(img) {
  const c = document.createElement('canvas'); c.width = GW; c.height = GH; const g = c.getContext('2d', { willReadFrequently: true });
  // "contain" fit of the artwork into the 16:9 grid
  const k = Math.min(GW / img.naturalWidth, GH / img.naturalHeight), w = img.naturalWidth * k, h = img.naturalHeight * k;
  g.fillStyle = `rgb(${BG})`; g.fillRect(0, 0, GW, GH); g.drawImage(img, (GW - w) / 2, (GH - h) / 2, w, h);
  const d = g.getImageData(0, 0, GW, GH).data, cubes = []; let sd = 32;
  const r = () => ((sd = Math.imul(sd ^ (sd >>> 15), 2246822519) + 0x9e3779b9 >>> 0) / 4294967296);
  for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
    const o = (y * GW + x) * 4, R = d[o], G = d[o + 1], B = d[o + 2], lum = Math.max(R, G, B), sat = lum - Math.min(R, G, B);
    if (lum < 58 && sat < 34) continue;                                   // dark background: no cube
    // cubes pour in from above in a slanted stream (left columns first), bright ones a little later so the picture "lights up"
    const delay = 0.05 + (x / GW) * 0.9 + r() * 0.75 + (lum > 200 ? 0.15 : 0);
    cubes.push({ x, y, sx: x + (r() - 0.5) * 70 + 18, sy: -8 - r() * 90, rot: (r() - 0.5) * 5, delay, dur: 0.75 + r() * 0.5, col: `rgb(${R},${G},${B})`, hi: `rgb(${Math.min(255, R + 46)},${Math.min(255, G + 46)},${Math.min(255, B + 46)})`, lo: `rgb(${R * 0.55 | 0},${G * 0.55 | 0},${B * 0.6 | 0})` });
  }
  return cubes;
}

export default {
  scene: null, camera: null,
  enter() {
    this.scene = new THREE.Scene(); this.scene.background = new THREE.Color(0x060a14);
    this.camera = new THREE.PerspectiveCamera(42, 16 / 9, 0.1, 10);
    Engine.renderer.setClearColor(0x060a14, 1);
    const wrap = UI.add(UI.el('div', { style: 'position:absolute;inset:0;overflow:hidden;background:#060a14;cursor:pointer' }));
    const cv = UI.el('canvas', { style: 'position:absolute;inset:0;width:100%;height:100%;image-rendering:pixelated' }); cv.width = GW * 5; cv.height = GH * 5;   // 960x540, 5 px cubes
    const img = UI.el('img', { alt: 'STORM 32', draggable: 'false', style: `position:absolute;inset:0;width:100%;height:100%;object-fit:contain;opacity:0;transition:opacity ${T_FADE}s ease-in-out;user-select:none` });
    wrap.append(cv, img, UI.el('div', { style: 'position:absolute;right:2%;bottom:2%;color:#566;font-size:.8em' }, 'kliknij, aby pominąć'));
    wrap.addEventListener('pointerdown', () => this.skip());
    S = { cv, g: cv.getContext('2d'), img, cubes: null, t: +(new URLSearchParams(location.search).get('t')) || 0, done: false, shown: false, wait: 0, tick: 0 };
    img.addEventListener('load', () => { if (S && !S.cubes) { try { S.cubes = buildCubes(img); } catch (e) { console.warn(e); S.cubes = []; S.t = Math.max(S.t, T_FLY); } } });
    img.addEventListener('error', () => { console.error('Logo image missing: ' + SRC); if (S) { S.cubes = []; S.t = TOTAL - 0.6; } });
    img.src = SRC;
    S.fade = fadeLayer('#000');
    Audio.music('logo'); Audio.sfx('logo');
  },
  skip() { if (!S || S.done) return; S.done = true; Audio.sfx('click'); S.fade.to(1, 250); setTimeout(() => { if (Game.current === this) Game.goto('intro'); }, 260); },
  onKey(ev) { if (ev?.type === 'keyup') return; this.skip(); },
  update(dt) {
    if (!S) return;
    if (!S.cubes) { S.wait += dt; if (S.wait > 4) { S.cubes = []; S.t = TOTAL - 0.6; } return; }   // image still loading
    S.t += Math.min(dt, 0.05); const t = S.t, g = S.g, P = 5;
    if (t < T_FLY + T_FADE + 0.1) {
      g.fillStyle = `rgb(${BG})`; g.fillRect(0, 0, S.cv.width, S.cv.height);
      let landed = 0;
      for (const c of S.cubes) {
        const k = (t - c.delay) / c.dur; if (k <= 0) continue;
        if (k >= 1) { g.fillStyle = c.col; g.fillRect(c.x * P, c.y * P, P, P); landed++; continue; }
        const e = 1 - Math.pow(1 - k, 3), x = (c.sx + (c.x - c.sx) * e) * P, y = (c.sy + (c.y - c.sy) * e) * P, s = P * (1 + (1 - e) * 1.6);
        // a tumbling little cube: lit top / left edge, dark bottom / right edge
        g.fillStyle = c.lo; g.fillRect(x + 1, y + 1, s, s); g.fillStyle = c.col; g.fillRect(x, y, s, s); g.fillStyle = c.hi; g.fillRect(x, y, s, 1); g.fillRect(x, y, 1, s);
      }
      if ((S.tick += dt) > 0.09 && landed < S.cubes.length && t < T_FLY - 0.4) { S.tick = 0; try { Audio.sfx('step', { vol: 0.12, pitch: 1.6 + Math.random() }); } catch (e) { } }
    }
    if (t >= T_FLY && !S.shown) { S.shown = true; S.img.style.opacity = '1'; try { Audio.sfx('hit', { vol: 0.5, pitch: 0.7 }); } catch (e) { } }
    if (t >= TOTAL - 0.5 && !S.done) { S.done = true; S.fade.to(1, 450); setTimeout(() => { if (Game.current === this) Game.goto('intro'); }, 470); }
  },
  exit() { S = null; this.scene = null; Engine.renderer.setClearColor(0x000000, 1); },
};
