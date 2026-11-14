// @ts-nocheck
// Kod przeniesiony 1:1 z Oldgame/src/gfx/portraits.js (rysowanie na płótnie 2D, bez Three.js). Nie jest sprawdzany typami.
// portraits.js — pixel-art bust portraits, deterministic from desc.
// 2026-11-13 rewrite: everything is built in a 64-unit design space and rasterised NATIVELY at 32 / 48 / 64 px
// (facial features use hand-tuned per-size pixel templates: S <40px, M <56px, L >=56px).
// Other sizes: integer multiples of 64/48/32 are nearest-neighbour upscales of the native render (96 = 48x2, 128 = 64x2),
// anything else is rendered natively at that size. Shading uses raster.js (hue-shifted 5-tone ramps, selective outlines,
// light from top-left); a rim light from the back-right, glow halos and a faction/class background are added here.
import { analyze } from './look';
import { Raster } from './raster';
import { mkCanvas, shade, mix, parseHex, bayer, clamp, rng } from './util';
import { RECRUITS } from '../../core/data/recruits';

const cache = new Map();
const EYES = ['#4a7a9a', '#5a8a4a', '#7a5a2a', '#3a2a1a', '#7a8a96', '#9a6a2a', '#4a5a7a'];
const WHITE = '#e2d8ca', WHITE_D = '#a8988a', PUPIL = '#120a0a';

// ---------------------------------------------------------------- raster in 64-unit design space
class PR extends Raster {
  constructor(n, z = 1) { super(n, n); this.n = n; this.k = n / 64; this.z = z; this.kz = this.k * z; this.tier = n < 40 ? 0 : n < 56 ? 1 : 2; this.glows = []; }
  // unit -> pixel (zoom z around the design centre 32,32) and back
  p(u) { return ((u - 32) * this.z + 32) * this.k; }
  u(px) { return (px / this.k - 32) / this.z + 32; }
  E(cx, cy, rx, ry, col, o = {}) { const oo = { ...o }; if (o.clip) oo.clip = (x, y) => o.clip(this.u(x + 0.5), this.u(y + 0.5)); this.ell(this.p(cx), this.p(cy), Math.max(0.55, rx * this.kz), Math.max(0.55, ry * this.kz), col, oo); }
  C(ax, ay, bx, by, ra, rb, col, o) { this.cap(this.p(ax), this.p(ay), this.p(bx), this.p(by), Math.max(0.55, ra * this.kz), Math.max(0.55, rb * this.kz), col, o); }
  P(pts, col, o) { this.poly(pts.map(([x, y]) => [this.p(x), this.p(y)]), col, o); }
  L(x0, y0, x1, y1, col, s = 2) { this.line(this.p(x0), this.p(y0), this.p(x1), this.p(y1), col, s); }
  T(test, col, o) { this.paint((x, y) => test(this.u(x + 0.5), this.u(y + 0.5), x, y), col, o); }
  X(v) { return Math.floor(this.p(v)); }
  D(ux, uy, col, s = 2) { this.px(this.X(ux), this.X(uy), col, s); }
  /** shift shade of drawn pixels (unit-space test) */
  S(test, ds, groups) {
    const { w, h, rp, sh, gr } = this; const gs = groups ? [].concat(groups) : null;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * w + x; if (rp[i] < 0 || (gs && !gs.includes(gr[i]))) continue; if (test(this.u(x + 0.5), this.u(y + 0.5), x, y)) sh[i] = clamp(sh[i] + ds, 0, 4); }
  }
  /** custom per-pixel shaded region: inside(ux,uy) -> bool, lum(ux,uy) -> 0..1 */
  F(inside, lum, col, dith = 0.14) {
    const r = this.R(col);
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) { const ux = this.u(x + 0.5), uy = this.u(y + 0.5); if (!inside(ux, uy)) continue; this.put(x, y, r, this.q(lum(ux, uy), x, y, dith)); }
  }
  glow(x, y, col, s = 3) { this.px(x, y, col, s); this.glows.push([x, y, col]); }
}
const pip = (pts) => (x, y) => { let c = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const [xi, yi] = pts[i], [xj, yj] = pts[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; };
const h2 = (x, y) => ((((x + 11) * 73856093) ^ ((y + 7) * 19349663)) >>> 0) % 997 / 997;
const inE = (x, y, cx, cy, rx, ry) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;
const sphereLum = (ux, uy, cx, cy, rx, ry) => { const vx = (ux - cx) / rx, vy = (uy - cy) / ry; return Raster.lum(vx, vy, Math.sqrt(Math.max(0.04, 1 - vx * vx - vy * vy))); };

// ---------------------------------------------------------------- themes / background / frame / rim
function themeOf(A) {
  if (A.boss) return { bg: '#1e0a0a', glow: '#c83a22', rim: '#ff7a4a', ruins: true };
  if (A.machine || A.kind === 'drone' || A.kind === 'turret') return { bg: '#16242c', glow: '#3a86a8', rim: '#a8e4ff' };
  if (A.kind === 'beast' || A.kind === 'insect' || A.mutant) return { bg: '#1c240e', glow: '#7a9a2a', rim: '#d8ff9a' };
  if (A.enemy) return { bg: '#2e120c', glow: '#b4532a', rim: '#ffb080', ruins: true };
  const cc = { soldier: '#8a9a52', scout: '#c9a468', medic: '#c84a3a', techie: '#3a98b8', scavenger: '#b4632a', brute: '#a8482a' }[A.cls] || A.accent;
  return { bg: mix(cc, '#140f0c', 0.8), glow: cc, rim: '#ffdcaa', ruins: true };
}
function background(img, n, th, seed) {
  const d = img.data, top = parseHex(mix(th.bg, '#2a2420', 0.25)), bot = parseHex(shade(th.bg, 0.45)), gl = parseHex(th.glow);
  const R = rng(seed ^ 0x2b1d), sky = [];
  // low-contrast ruined skyline silhouette
  if (th.ruins) { let h = 0.62 + R() * 0.1; for (let x = 0; x < n; x++) { if (x % Math.max(2, n >> 4) === 0) h = clamp(h + (R() - 0.5) * 0.16, 0.5, 0.78); sky.push(h * n); } }
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const t = y / (n - 1); let c = [0, 1, 2].map(j => top[j] + (bot[j] - top[j]) * t);
    const dx = (x / n - 0.58) / 0.62, dy = (y / n - 0.34) / 0.52, g = clamp(1 - Math.sqrt(dx * dx + dy * dy), 0, 1);
    const band = Math.floor(g * g * 4 + bayer(x, y) * 0.5 + 0.25) / 4;
    c = c.map((v, j) => v + (gl[j] - v) * band * 0.3);
    if (th.ruins && y > sky[x]) c = c.map(v => v * 0.72);
    const i = (y * n + x) * 4; d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255;
  }
}
function frame(img, n, th) {
  const d = img.data, set = (x, y, c, a = 1) => { const i = (y * n + x) * 4; for (let j = 0; j < 3; j++) d[i + j] = d[i + j] * (1 - a) + c[j] * a; };
  const dark = [10, 7, 6], hi = parseHex(mix(th.glow, '#fff0d0', 0.35)), lo = parseHex(shade(th.glow, 0.35));
  for (let i = 0; i < n; i++) { set(i, 0, dark); set(i, n - 1, dark); set(0, i, dark); set(n - 1, i, dark); }
  if (n >= 44) for (let i = 1; i < n - 1; i++) { set(i, 1, hi, 0.45); set(1, i, hi, 0.3); set(i, n - 2, lo, 0.7); set(n - 2, i, lo, 0.6); }
  // vignette in the corners
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { const vx = x / n - 0.5, vy = y / n - 0.5, v = clamp((vx * vx + vy * vy - 0.16) * 1.6, 0, 0.32); if (v > 0) { const i = (y * n + x) * 4; d[i] *= 1 - v; d[i + 1] *= 1 - v; d[i + 2] *= 1 - v; } }
}
function rimPass(img, R, col) {
  const { w, h, rp, gr, noLine } = R, d = img.data, c = parseHex(col), occ = (x, y) => x >= 0 && y >= 0 && x < w && y < h && rp[y * w + x] >= 0;
  for (let y = 0; y < h; y++) for (let x = Math.floor(w * 0.45); x < w; x++) {
    if (!occ(x, y) || noLine.has(gr[y * w + x])) continue;
    let k = 0; if (!occ(x + 1, y)) k = 0.62; else if (!occ(x + 1, y - 1) && !occ(x, y - 1)) k = 0.4; else if (R.tier === 2 && !occ(x + 2, y)) k = 0.22;
    if (y > h * 0.9) k *= 0.5;
    if (k) { const i = (y * w + x) * 4; for (let j = 0; j < 3; j++) d[i + j] = d[i + j] * (1 - k) + c[j] * k; }
  }
}
function glowPass(img, R) {
  const { w, h } = R, d = img.data, rad = R.tier === 2 ? 2 : 1;
  for (const [gx, gy, col] of R.glows) {
    const c = parseHex(col);
    for (let y = gy - rad; y <= gy + rad; y++) for (let x = gx - rad; x <= gx + rad; x++) {
      if (x < 0 || y < 0 || x >= w || y >= h || (x === gx && y === gy)) continue;
      const dd = Math.abs(x - gx) + Math.abs(y - gy), a = dd === 1 ? 0.32 : 0.14; if (dd > rad + 1) continue;
      const i = (y * w + x) * 4; for (let j = 0; j < 3; j++) d[i + j] = Math.min(255, d[i + j] + c[j] * a);
    }
  }
}

// ---------------------------------------------------------------- outfit (mirrors hero.js outfit colours)
function outfit(A) {
  const F = { jacket: A.cloth, accent: A.accent };
  const set = (o) => Object.assign(F, o);
  switch (A.cls || A.role) {
    case 'soldier': set({ jacket: '#5d6a3a', vest: '#3e4a2c', pouches: '#4e5a34', patch: A.accent }); break;
    case 'scout': set({ jacket: '#7a6a4a', coat: '#8a7448', scarf: '#9a8a62', bandolier: '#5a3a1e' }); break;
    case 'medic': set({ jacket: '#d8d2c0', armband: '#c43d2f', satchel: '#c8bfa8' }); break;
    case 'techie': set({ jacket: '#46687a', toolbelt: '#7a5a32' }); break;
    case 'scavenger': set({ jacket: '#4a3a2a', coat: '#3e3024', scarfMask: '#5a4a32', wraps: '#b8aa8a', pouches: '#5a4630' }); break;
    case 'brute': set({ jacket: null, harness: '#4a2e1c', pad: '#5a5e66' }); break;
    case 'thug': set({ jacket: null, harness: '#3a2a20', tire: '#2a2a2c', pad: '#6a6e76', spikes: true, tattoo: A.accent }); break;
    case 'shooter': set({ jacket: A.cloth, scarfMask: A.accent, bandolier: '#6a4a24', ammo: true, pad: '#5a5e66' }); break;
    case 'psycho': set({ jacket: null, bareChest: true, warpaint: A.accent, chains: true }); break;
    case 'burner': set({ jacket: '#6a4a2a', apron: '#4a3a2c', tank: true }); break;
    case 'chief': set({ jacket: '#2e2a28', coat: '#24201e', fur: '#8a7a62', sash: A.accent, pad: '#6a6e76', spikes: true }); break;
    case 'kostucha': set({ jacket: '#1e1414', coat: '#1a1010', hood: '#6a1410', sash: '#b02018', pad: '#4a4a52', spikes: true }); break;
    case 'boss': set({ jacket: '#3a1612', coat: '#2a100c', sash: A.accent, pad: '#5a5e66', spikes: true }); break;
  }
  if (A.mutant) set({ jacket: null, rags: '#4a4238', bareChest: false, pad: null, harness: null, scarfMask: null, bandolier: null, warpaint: null, chains: false });
  if (F.scarfMask && A.enemy) F.scarfMask = mix(F.scarfMask, '#3a2a20', 0.35);
  if (A.nomad && !A.enemy) set({ scarf: '#c9a468' });
  return F;
}

// ---------------------------------------------------------------- humans
function human(R, A) {
  const F = outfit(A), S = rng(A.seed ^ 0x51ed7), t = R.tier, k = R.k;
  const heavy = A.bw === 'heavy', light = A.bw === 'light', mut = A.mutant;
  const cx = 32, dy = mut ? 2.5 : A.boss ? -1 : 0, ey = 27 + dy;            // eye line
  const ghoul = mut && /ghoul|ghul|zomb|goul/.test(A.tid || ''), kolos = mut && !ghoul; A.ghoul = ghoul; A.kolos = kolos;
  const hw = (heavy ? 12.2 : light ? 10.6 : 11.4) * (A.boss ? 1.04 : 1) * (ghoul ? 0.88 : kolos ? 1.06 : 1);
  const hy = 23.5 + dy, hry = 14;                                             // cranium
  const skin = A.machine ? '#7a848c' : A.skin, hair = A.hair;
  const gear = A.head, hs = A.hairStyle % 6;
  const hairHidden = ['helmet', 'hood', 'reaper', 'cap', 'machine'].includes(gear) || mut;
  const faceCovered = ['gas', 'mask', 'reaper'].includes(gear);
  const look = { stern: (A.seed >>> 13) % 3, mouth: (A.seed >>> 15) % 3, iris: EYES[(A.seed >>> 11) % EYES.length], age: (A.seed >>> 17) % 4, scar: (A.seed >>> 3) % 3 === 0 || (A.enemy && A.seed % 2), dirt: (A.seed >>> 19) % 3 };
  if (A.raider || A.cls === 'brute' || A.cls === 'soldier') look.stern = look.stern === 2 ? 1 : look.stern;
  const beard = !faceCovered && !mut && !A.machine && !A.fem && (((A.seed >> 3) % 3 === 0 && !A.enemy) || A.role === 'thug' || A.role === 'chief' || A.cls === 'brute');
  const G = {};

  // ---- back layer: hood / long hair / ponytail / boss scythe
  G.back = R.group();
  if (A.boss) { R.C(6, 66, 11, 9, 1.3, 1.1, '#4a3020'); R.P([[9, 12], [30, 7], [52, 13], [56, 22], [44, 13.5], [26, 12], [12, 15]], '#a8b0b4', { bias: 0.08 }); R.L(12, 12.5, 50, 12, '#e8f0f0', 4); }
  if (gear === 'hood' || gear === 'reaper') { const hc = gear === 'reaper' ? F.hood : (F.coat || F.jacket || A.cloth2); R.E(cx, hy + 4, hw + 7.5, hry + 8, shade(hc, 0.8), { bias: -0.05 }); }
  else if (!hairHidden && hs === 3) { R.E(cx, hy + 7, hw + 4.5, hry + 9, hair, { clip: (x, y) => y < 50 + (Math.abs(x - cx) > hw ? 4 : 0), bias: -0.12 }); }
  else if (!hairHidden && hs === 5) { R.C(cx - hw + 1, hy - 4, cx - hw - 4, hy + 8, 2.6, 2, hair, { bias: 0.05 }); R.C(cx - hw - 4, hy + 8, cx - hw - 4.5, hy + 19, 2, 1.1, hair, { bias: -0.05 }); R.C(cx - hw + 0.5, hy - 2, cx - hw - 1.5, hy + 1, 1.4, 1.4, F.accent); }

  // ---- torso
  torso(R, A, F, G, cx, dy, heavy, light);

  // ---- neck
  if (!A.machine) {
    G.neck = R.group();
    const nw = heavy ? 7.2 : light ? 5.3 : 6;
    R.C(cx, hy + 11, cx, 51, nw, nw + 1.2, gear === 'reaper' ? '#3a2220' : skin, { bias: -0.1 });
    R.S((x, y) => y < hy + 17 + (x - cx) * 0.2, -1, G.neck);       // jaw shadow on neck
    if (F.scarf || F.scarfMask || A.nomad) { const sc = F.scarfMask || F.scarf || '#c9a468'; R.group(); R.E(cx, 48.5, nw + (F.scarfMask ? 3.5 : 6), F.scarfMask ? 3.4 : 4.6, sc); R.E(cx + 1, 46, nw + 3, 3.4, shade(sc, 1.05)); R.L(cx - 4, 47, cx + 3, 49.5, shade(sc, 0.7), 1); }
  } else { R.group(); R.C(cx, 38, cx, 50, 5, 6, '#3a4048'); for (let y = 40; y < 50; y += 3) R.L(cx - 4, y, cx + 4, y, '#22272c', 1); }

  if (A.machine) { robotHead(R, A, cx); return; }

  // ---- ears
  G.ears = R.group();
  for (const s of [-1, 1]) { const ex = cx + s * (hw + 0.2); R.E(ex, ey + 1.5, 2.3, 3.6, skin, { bias: s > 0 ? -0.08 : 0 }); }
  if (t > 0) for (const s of [-1, 1]) R.D(cx + s * (hw + 0.4), ey + 2, skin, 0);

  // ---- head (cranium + jaw + facial planes)
  G.head = R.group();
  const jw = hw * (heavy ? 0.9 : light ? 0.76 : 0.82) * (A.fem ? 0.93 : 1), jy = hy + 8.6, jry = heavy ? 8.8 : light ? 9.2 : 9;
  const gaunt = ghoul ? 0.16 : 0;
  const inHead = (x, y) => inE(x, y, cx, hy, hw, hry) || (heavy ? (Math.abs(x - cx) <= jw - 2 && y <= jy + jry - 2.5 && y > hy) || inE(x, y, cx, jy + 1.2, jw, jry - 1.3) : inE(x, y, cx, jy, jw, jry));
  R.F(inHead, (x, y) => {
    let l = sphereLum(x, y, cx, hy + 2.5, hw + 0.6, hry + 3.5);
    if (inE(x, y, cx - 5.2, ey - 0.4, 3.8, 2.6) || inE(x, y, cx + 5.2, ey - 0.4, 3.8, 2.6)) l -= 0.11;          // eye sockets
    if (y > ey - 4.6 && y < ey - 2.6 && Math.abs(x - cx) < hw - 2) l += 0.05;                                       // brow ridge
    if (inE(x, y, cx - 6.4, ey + 4.2, 3.4, 1.8)) l += 0.08;                                                          // cheekbone
    if (inE(x, y, cx - 7, ey + 8, 2.6, 3.2) || inE(x, y, cx + 7, ey + 8, 2.6, 3.2)) l -= 0.03 + gaunt;            // cheek hollow
    if (y > jy + jry - 3 && Math.abs(x - cx) < 4) l += 0.04;                                                         // chin
    if (y > jy + jry - 1.6) l -= 0.1;
    return l * 0.86 + 0.09;
  }, skin, 0.08);
  if (mut || A.mutation) mutantSkin(R, A, cx, hy, hw, hry, G.head, mut);
  if (kolos) R.S((x, y) => y > ey - 4.2 && y < ey - 1.8 && Math.abs(x - cx) < hw - 1.5, 1, G.head), R.S((x, y) => y > ey - 1.8 && y < ey - 0.6 && Math.abs(x - cx) < hw - 1.5, -2, G.head);
  if (ghoul) { R.group(); const S2 = rng(A.seed ^ 0x9a); for (let i = 0; i < 6; i++) { const x = cx - hw + 3 + S2() * (hw * 2 - 6), y = hy - hry + 2 + S2() * 4; R.L(x, y, x - 2 + S2() * 4, y + 6 + S2() * 6, '#8a8a7a', 2); } }

  // ---- face
  if (!faceCovered) face(R, A, F, look, cx, ey, hw, G);
  if (beard) facialHair(R, A, cx, ey, hw, jw, jy, jry, S, G);
  else if (!faceCovered && !mut && !A.enemy && !A.fem && (A.seed >>> 21) % 3 === 0) R.T((x, y, px, py) => inHead(x, y) && y > ey + 7 && !inE(x, y, cx, ey + 10.5, 4.2, 1.6) && Math.abs(x - cx) < hw - 1, mix(A.skin, hair, 0.3), { g: G.head }); // stubble
  if (A.raider && !faceCovered && F.warpaint) warpaint(R, A, F, cx, ey, G);
  else if (A.raider && !faceCovered && (A.seed >>> 23) % 2) R.T((x, y) => inHead(x, y) && y > ey - 2.2 && y < ey + 1.8 && Math.abs(x - cx) > 2 && Math.abs(x - cx) < hw - 0.5 && !(Math.abs(Math.abs(x - cx) - 5.2) < 2.6 && Math.abs(y - ey - 0.3) < 1.3), '#1a1416', { g: G.head });  // black eye band

  // ---- hair (front)
  if (!hairHidden && gear !== 'gas' || (gear === 'gas' && !hairHidden)) hairFront(R, A, cx, hy, hw, hry, ey, hs, S, G);

  // ---- gear
  headGear(R, A, F, cx, hy, hw, hry, ey, jy, jry, G);
  // scarf mask over the lower face
  if (F.scarfMask && !faceCovered) { R.T((x, y) => inHead(x, y) && y > ey + 4.6 - Math.abs(x - cx) * 0.08, F.scarfMask, { g: G.head }); R.T((x, y) => inHead(x, y) && y > ey + 4.6 && ((Math.abs(y - ey - 8.6 - (x - cx) * 0.12) < 0.5) || (Math.abs(y - ey - 12.4 - (x - cx) * 0.1) < 0.5)), F.scarfMask, { g: G.head, ds: -2 }); R.T((x, y) => inHead(x, y) && Math.abs(y - (ey + 4.6 - Math.abs(x - cx) * 0.08)) < 0.6, F.scarfMask, { g: G.head, ds: 1 }); }
  else if (A.nomad && !A.enemy && !faceCovered) { R.T((x, y) => inHead(x, y) && y > ey + 5.6, '#c9a468', { g: G.head }); R.group(); R.E(cx, jy + 4, jw + 2.2, 5, '#c9a468', { clip: (x, y) => y > ey + 6.5 }); R.L(cx - 6, ey + 10, cx + 5, ey + 12, '#8a6c42', 1); }
}

function torso(R, A, F, G, cx, dy, heavy, light) {
  const wf = (heavy ? 1.1 : light ? 0.9 : 1) * (A.boss ? 1.08 : 1) * (A.kolos ? 1.12 : A.ghoul ? 0.86 : 1), X = (x) => cx + (x - cx) * wf;
  const sy = 43.5 + dy * 0.6, mut = A.mutant;
  const pts = [[X(-4), 72], [X(0), 58], [X(6), sy + 6], [X(14), sy + 2.5], [X(22), sy - 0.5], [X(27), sy - 3], [X(37), sy - 3], [X(42), sy - 0.5], [X(50), sy + 2.5], [X(58), sy + 6], [X(64), 58], [X(68), 72]];
  const bare = !F.jacket && !F.rags && !A.machine;
  G.torso = R.group();
  if (A.machine) { R.P(pts, '#5a646c'); R.E(X(14), sy + 9, 9 * wf, 7, '#7a848c'); R.E(X(50), sy + 9, 9 * wf, 7, '#6a747c', { bias: -0.05 }); R.group(); R.P([[cx - 9, 64], [cx - 7, sy + 6], [cx + 7, sy + 6], [cx + 9, 64]], '#3a4048'); R.rect(R.X(cx - 3), R.X(sy + 10), Math.max(1, R.X(6)), Math.max(1, R.X(2)), '#e0402a', 4); R.glows.push([R.X(cx), R.X(sy + 11), '#e0402a']); for (const [x, y] of [[X(10), sy + 6], [X(54), sy + 6], [cx - 5, sy + 15], [cx + 5, sy + 15]]) R.D(x, y, '#c8d0d4', 4); return; }
  R.F(pip(pts), (x, y) => { const vx = clamp((x - cx) / (31 * wf), -1, 1), vy = (y - sy - 12) / 22; return Raster.lum(vx * 0.85, vy * 0.35, Math.sqrt(Math.max(0, 1 - vx * vx * 0.8))) + (y < sy + 3 ? 0.06 : 0); }, bare ? A.skin : (F.coat || F.jacket || F.rags || A.cloth), 0);
  if (bare) {   // muscles
    R.S((x, y) => inE(x, y, X(21), sy + 14, 9 * wf, 5) && y > sy + 14, -1, G.torso); R.S((x, y) => inE(x, y, X(43), sy + 14, 9 * wf, 5) && y > sy + 14, -1, G.torso);
    R.S((x, y) => Math.abs(x - cx) < 0.8 && y > sy + 10, -1, G.torso); R.S((x, y) => inE(x, y, X(14), sy + 6, 5, 3), 1, G.torso);
    if (A.mutant || A.mutation) { const S = rng(A.seed ^ 0x3c); for (let i = 0; i < 7; i++) { const x = 6 + S() * 52, y = sy + 4 + S() * 16, r = 0.8 + S() * 1.4; R.T((ux, uy) => inE(ux, uy, x, y, r, r * 0.8), mix(A.skin, '#5a7a2a', 0.5), { g: G.torso, ds: -1 }); } }
  }
  if (F.coat && F.jacket) { R.group(); R.P([[cx - 7, 64], [cx - 5, sy + 2], [cx + 5, sy + 2], [cx + 7, 64]], F.jacket, { bias: -0.08 }); R.group(); R.L(cx - 5, sy + 2, cx - 9, 64, shade(F.coat, 1.25), 3); R.L(cx + 5, sy + 2, cx + 9, 64, shade(F.coat, 0.8), 1); }
  if (F.rags) { R.T((x, y, px, py) => (px * 5 + py * 3) % 7 === 0 || y > 60 - ((px * 13) % 5), shade(F.rags, 0.8), { g: G.torso }); R.group(); R.E(X(14), sy + 9, 7 * wf, 6, A.skin); R.E(X(50), sy + 9, 7 * wf, 6, A.skin, { bias: -0.08 }); }
  if (F.fur) { R.group(); for (let i = 0; i < 9; i++) { const a = i / 8, x = X(12 + a * 40), y = sy + 3 - Math.sin(a * Math.PI) * 3; R.E(x, y, 4.6 * wf, 3.6, i % 2 ? F.fur : shade(F.fur, 0.9)); } R.T((x, y, px, py) => (px + py) % 3 === 0 && y < sy + 5, shade(F.fur, 1.3), {}); }
  switch (A.cls || A.role) {
    case 'soldier': R.group(); R.P([[cx - 11, 64], [cx - 10, sy + 6], [cx - 5, sy + 3], [cx + 5, sy + 3], [cx + 10, sy + 6], [cx + 11, 64]], F.vest); R.group(); for (const x of [-7, -1.5, 4]) R.E(cx + x + 1.5, 59, 2.4, 3, F.pouches); R.group(); R.E(X(12), sy + 9, 4.5, 3.2, F.patch); R.D(X(12), sy + 8.5, shade(F.patch, 1.4), 4); R.L(cx - 9, sy + 5, cx - 9, 64, '#2a3020', 1); R.L(cx + 9, sy + 5, cx + 9, 64, '#2a3020', 1); break;
    case 'scout': R.group(); R.L(X(10), sy + 4, cx + 12, 64, F.bandolier, 3); for (let i = 0; i < 4; i++) R.D(X(14) + i * 4.3, sy + 8 + i * 3.7, '#c9a048', 4); break;
    case 'medic': R.group(); R.E(X(12), sy + 10, 5.2, 4, F.armband); R.rect(R.X(X(12)) - 1, R.X(sy + 10) - (R.tier ? 2 : 1), 2, R.tier ? 4 : 2, '#f2ecde', 3); R.rect(R.X(X(12)) - (R.tier ? 2 : 1), R.X(sy + 10) - 1, R.tier ? 4 : 2, 2, '#f2ecde', 3);
      R.group(); R.L(X(50), sy + 4, cx - 6, 64, '#8a7a5a', 2); R.group(); R.C(cx - 7, sy + 3, cx - 5, sy + 13, 0.7, 0.7, '#3a3a40'); R.C(cx + 7, sy + 3, cx + 5, sy + 13, 0.7, 0.7, '#3a3a40'); R.E(cx, sy + 14.5, 1.8, 1.8, '#a8b0b8'); break;
    case 'techie': R.group(); R.L(X(8), sy + 6, cx + 14, 64, F.toolbelt, 3); R.L(X(56), sy + 6, cx - 14, 64, F.toolbelt, 2); R.group(); R.rect(R.X(cx + 4), R.X(sy + 10), Math.max(2, R.X(5)), Math.max(2, R.X(6)), '#3a4a54', 2); R.px(R.X(cx + 5), R.X(sy + 12), '#46f2c8', 4); R.px(R.X(cx + 7), R.X(sy + 12), '#ff7a1e', 4); R.L(X(48), sy + 3, X(50), sy + 14, '#a8b0b8', 3); break;
    case 'scavenger': R.group(); R.L(X(8), sy + 6, cx + 14, 64, '#2a2018', 3); R.group(); for (let i = 0; i < 4; i++) R.E(X(18) + i * 7.5, sy + 10 + i * 2.6, 2.2, 2.6, i % 2 ? F.accent : F.pouches); R.group(); R.T((x, y, px, py) => inE(x, y, X(12), sy + 9, 7, 5) && (py % 2 === 0), F.wraps, { g: G.torso }); break;
    case 'brute': R.group(); R.L(X(14), sy + 2, cx + 7, 64, F.harness, 3); R.L(X(50), sy + 2, cx - 7, 64, F.harness, 3); R.E(cx, sy + 13, 2.4, 2.4, F.accent); R.group(); R.E(X(11), sy + 8, 8 * wf, 6, F.pad); R.L(X(5), sy + 9, X(17), sy + 6, shade(F.pad, 0.6), 1); R.D(X(8), sy + 6, '#e0e4e8', 4); R.D(X(14), sy + 5, '#e0e4e8', 4); break;
    case 'thug': R.group(); R.L(X(14), sy + 2, cx + 7, 64, F.harness, 3); R.L(X(50), sy + 2, cx - 7, 64, F.harness, 2); R.group(); R.E(X(11), sy + 8, 8.5 * wf, 6.5, F.tire); R.T((x, y, px, py) => inE(x, y, X(11), sy + 8, 8.5 * wf, 6.5) && (px + py * 2) % 4 === 0, '#4a4a4c', {}); for (const [x, y] of [[5, 2], [10, 0], [15, 1]]) spike(R, X(x), sy + 4 + y, 8, -1);
      R.group(true); R.L(X(50), sy + 6, X(54), sy + 14, F.tattoo, 1); R.L(X(47), sy + 8, X(52), sy + 16, F.tattoo, 1); break;
    case 'shooter': R.group(); R.L(X(10), sy + 4, cx + 12, 64, F.bandolier, 3); for (let i = 0; i < 5; i++) R.D(X(13) + i * 3.6, sy + 7 + i * 3.2, '#d8b04a', 4); R.group(); R.E(X(52), sy + 8, 7 * wf, 5, F.pad); break;
    case 'psycho': R.group(); for (let i = 0; i < 2; i++) for (let j = 0; j < 9; j++) R.D(X(16) + j * 3.6, sy + 9 + j * 1.8 + i * 4, j % 2 ? '#8a8e94' : '#5a5e64', j % 2 ? 4 : 2); R.group(true); R.L(X(48), sy + 4, X(52), sy + 14, F.warpaint, 2); R.L(X(44), sy + 6, X(47), sy + 16, F.warpaint, 2); break;
    case 'burner': R.group(); R.P([[cx - 10, 64], [cx - 8, sy + 8], [cx + 8, sy + 8], [cx + 10, 64]], F.apron); R.group(); R.C(X(53), sy - 4, X(53), sy + 14, 4, 4, '#8a3a24'); R.L(X(51), sy - 6, X(55), sy - 6, '#c8c0a8', 3); R.group(); R.L(X(14), sy + 3, cx + 9, 64, '#2a2018', 2); break;
    case 'chief': case 'boss': case 'kostucha': {
      if (F.sash) { R.group(); R.L(X(12), sy + 6, cx + 13, 64, F.sash, 4); }
      R.group(); R.E(X(10), sy + 7, 9 * wf, 6.5, F.pad); R.E(X(54), sy + 7, 9 * wf, 6.5, F.pad, { bias: -0.08 });
      R.group(); for (const [x, y, h] of [[4, 4, 9], [9, 1, 11], [14, 2, 8], [50, 2, 8], [55, 1, 11], [60, 4, 9]]) spike(R, X(x), sy + y, h, x < 32 ? -1.5 : 1.5);
      if ((A.cls || A.role) === 'kostucha') { R.group(); R.E(cx, sy + 12, 3.2, 3.6, '#e6dcc0'); R.D(cx - 1, sy + 12, '#1a0e0e', 0); R.D(cx + 1, sy + 12, '#1a0e0e', 0); }
      break;
    }
  }
  if (A.raider && (A.seed >>> 6) % 2 && !['chief', 'boss', 'kostucha', 'thug', 'psycho'].includes(A.role)) { R.group(); R.E(X(11), sy + 8, 8 * wf, 6, '#5a5e66'); for (const [x, y, h] of [[6, 4, 7], [11, 2, 9], [16, 3, 7]]) spike(R, X(x), sy + y, h, -1); }
  if (A.cyber) { R.group(); R.E(X(52), sy + 9, 7.5, 6, '#7a848c'); R.L(X(47), sy + 9, X(58), sy + 7, '#3a4048', 1); R.D(X(50), sy + 6, '#e8f0f4', 4); R.glow(R.X(X(54)), R.X(sy + 11), '#ff3a2a', 4); }
}

function spike(R, x, y, h, lean) { R.C(x, y, x + lean, y - h, 1.5, 0.35, '#c0c6cc', { bias: 0.1 }); }
function mutantSkin(R, A, cx, hy, hw, hry, g, full) {
  const S = rng(A.seed ^ 0x77aa), n = full ? 9 : 4;
  for (let i = 0; i < n; i++) {
    const a = S() * Math.PI * 2, r = Math.sqrt(S()) * 0.85, x = cx + Math.cos(a) * hw * r, y = hy - 2 + Math.sin(a) * hry * r * 0.8;
    if (Math.abs(x - cx) < 9 && Math.abs(y - (hy + 3.5)) < 3.5) continue;   // keep the eyes clear
    const rr = 0.9 + S() * (full ? 1.6 : 1.1);
    R.T((ux, uy) => inE(ux, uy, x, y, rr + 0.8, rr + 0.6), mix(A.skin, '#5a8a2a', 0.45), { g, ds: -1 });
    R.E(x, y, rr, rr, i % 3 === 0 ? '#c8e04a' : mix(A.skin, '#b8d070', 0.5));
  }
  if (full) R.T((x, y, px, py) => ((px * 7 + py * 3) % 11 === 0) && y < hy + 8, shade(A.skin, 0.7), { g });
}

function face(R, A, F, look, cx, ey, hw, G) {
  const t = R.tier, k = R.k, skin = A.skin, mut = A.mutant, g = G.head;
  const Y = R.X(ey), cX = R.X(cx), Yn = R.X(ey + 5.2), Ym = R.X(ey + 9.6);
  const lid = mix(shade(skin, 0.3), '#1a0e10', 0.4), brow = mix(shade(A.hair, 0.85), '#140c0a', 0.15);
  const iris = mut ? '#e8f05a' : look.iris, irisD = mut ? '#a8c020' : shade(look.iris, 0.6), irisL = mut ? '#ffffc0' : mix(look.iris, '#ffffff', 0.55);
  const P = (x, y, c, s = 2) => R.px(x, y, c, s);
  // eye centres (pixel)
  const eL = R.X(cx - 5.2), eR = R.X(cx + 5.2);
  const expr = look.stern;        // 0 neutral, 1 stern, 2 raised
  for (const side of [0, 1]) {
    const X = side ? eR : eL, inward = side ? -1 : 1;
    if (A.cyber && side === 1) { cyberEye(R, X, Y, t); continue; }
    if (mut) {   // sunken glowing eyes
      if (t === 2) { for (let i = -2; i <= 2; i++) for (let j = -1; j <= 1; j++) P(X + i, Y + j, '#1a1408', 2); R.glow(X, Y, '#e8f05a', 4); P(X + 1, Y, '#c8d040', 3); }
      else if (t === 1) { for (let i = -1; i <= 1; i++) P(X + i, Y, '#1a1408', 2); P(X - 1, Y - 1, lid, 2); P(X, Y - 1, lid); P(X + 1, Y - 1, lid); R.glow(X, Y, '#e8f05a', 4); }
      else R.glow(X, Y, '#e8f05a', 4);
      // heavy brow
      for (let i = -2; i <= 2; i++) P(X + i, Y - (t ? 2 : 1), skin, 0);
      continue;
    }
    if (t === 2) {
      for (let i = -2; i <= 2; i++) P(X + i, Y - 1, lid);                         // upper lid
      P(side ? X + 3 : X - 3, Y, lid); if (A.fem) P(side ? X + 3 : X - 3, Y - 1, lid);   // outer lash
      P(X - 2, Y, WHITE_D); P(X - 1, Y, WHITE); P(X, Y, irisL, 3); P(X + 1, Y, PUPIL); P(X + 2, Y, iris);
      P(X - 1, Y + 1, WHITE_D); P(X, Y + 1, iris); P(X + 1, Y + 1, irisD); P(X + 2, Y + 1, iris); P(X - 2, Y + 1, skin, 1);
      for (let i = -1; i <= 1; i++) P(X + i, Y + 2, skin, 1);                     // lower lid
      if (look.age >= 2) { P(X + (side ? 3 : -3), Y + 1, skin, 1); P(X - 1, Y + 3, skin, 1); P(X, Y + 3, skin, 1); }
      // brows (2px, shaped by expression)
      for (let i = -3; i <= 2; i++) {
        const j = i * inward;        // j>0 = towards the nose
        let by = Y - 4; if (expr === 1 && j >= 1) by += 1; if (expr === 2 && j >= 1) by -= 1; if (expr === 0 && Math.abs(j) === 3) by += 1;
        P(X + i, by, brow, j >= 0 ? 1 : 2); if (j >= -1 && !A.fem) P(X + i, by + 1, brow, 0);
      }
    } else if (t === 1) {
      for (let i = -1; i <= 1; i++) P(X + i, Y - 1, lid);
      P(X - 1, Y, WHITE); P(X, Y, iris); P(X + 1, Y, PUPIL);
      P(X - 1, Y + 1, skin, 1); P(X, Y + 1, skin, 1);
      for (let i = -2; i <= 1; i++) { const j = i * inward; let by = Y - 3; if (expr === 1 && j >= 1) by += 1; if (expr === 2 && j >= 1) by -= 1; P(X + i + (side ? 1 : 0), by, brow, j >= 0 ? 0 : 1); }
    } else {
      P(X, Y, WHITE_D); P(X + 1, Y, PUPIL);
      for (let i = 0; i <= 1; i++) { const j = side ? -i : i; P(X + i, Y - 2 + (expr === 1 && j > 0 ? 1 : 0), brow, 0); }
    }
  }
  // nose
  const nx = cX + (t === 0 ? 0 : 0);
  if (t === 2) {
    for (let j = Y + 2; j < Yn - 1; j++) P(nx - 1, j, skin, 3);
    for (let j = Y + 1; j < Yn; j++) P(nx + 1, j, skin, 1);
    P(nx, Yn, skin, 4); P(nx - 1, Yn, skin, 3); P(nx + 1, Yn, skin, 2); P(nx + 2, Yn, skin, 1); P(nx - 2, Yn + 1, skin, 1); P(nx - 1, Yn + 1, lid); P(nx, Yn + 1, skin, 1); P(nx + 1, Yn + 1, skin, 1); P(nx + 2, Yn + 1, lid); P(nx + 3, Yn + 1, skin, 1);
    if (look.age >= 1) { P(nx - 4, Yn + 2, skin, 1); P(nx - 5, Yn + 3, skin, 1); P(nx + 5, Yn + 2, skin, 1); P(nx + 6, Yn + 3, skin, 0); }
  } else if (t === 1) {
    for (let j = Y + 1; j < Yn; j++) P(nx + 1, j, skin, 1); P(nx - 1, Yn - 1, skin, 3); P(nx, Yn, skin, 4); P(nx + 1, Yn, skin, 1); P(nx - 1, Yn + 1, skin, 1); P(nx, Yn + 1, lid); P(nx + 1, Yn + 1, skin, 0);
  } else { P(nx, Yn - 1, skin, 3); P(nx, Yn, skin, 1); P(nx - 1, Yn, skin, 1); }
  // mouth
  const fem = A.fem, lip = mix(shade(skin, 0.5), '#4a1416', fem ? 0.4 : 0.22), lipL = mix(skin, '#c8606a', fem ? 0.38 : 0.16);
  const mo = look.mouth;   // 0 neutral, 1 smirk, 2 grim
  if (mut && A.kolos) {
    const my = Ym, w = t === 2 ? 4 : t === 1 ? 3 : 2;
    for (let i = -w; i <= w; i++) P(nx + i, my, '#1a0808');
    for (const s2 of [-1, 1]) { const x = nx + s2 * (w - 1) - (s2 > 0 ? 1 : 0); P(x, my - 1, '#e8e0b0', 4); if (t === 2) P(x, my - 2, '#d8d0a0', 3); }
    for (let i = -w + 1; i <= w - 1; i++) P(nx + i, my + 1, skin, 3);
  } else if (mut) {
    const my = Ym, w = t === 2 ? 4 : t === 1 ? 3 : 2;
    for (let i = -w; i <= w; i++) { P(nx + i, my, '#1a0808'); if (t) P(nx + i, my + 1, '#1a0808'); }
    for (let i = -w + 1; i <= w - 1; i += 2) P(nx + i, my, '#e8e0b0', 3);
    if (t === 2) for (let i = -w + 2; i <= w - 1; i += 2) P(nx + i, my + 1, '#c8c090', 2);
  } else if (t === 2) {
    const my = Ym;
    for (let i = -3; i <= 3; i++) { let yy = my; if (mo === 1 && i === 3) yy -= 1; if (mo === 2 && Math.abs(i) === 3) yy += 1; P(nx + i, yy, lip, Math.abs(i) === 3 ? 0 : 1); }
    for (let i = -2; i <= 1; i++) P(nx + i, my - 1, skin, 1);
    for (let i = -2; i <= 2; i++) P(nx + i, my + 1, lipL, i < 1 ? 3 : 2);
    for (let i = -1; i <= 1; i++) P(nx + i, my + 3, skin, 1);
  } else if (t === 1) {
    const my = Ym;
    for (let i = -2; i <= 2; i++) { let yy = my; if (mo === 1 && i === 2) yy -= 1; if (mo === 2 && Math.abs(i) === 2) yy += 1; P(nx + i, yy, lip, Math.abs(i) === 2 ? 0 : 1); }
    for (let i = -1; i <= 1; i++) P(nx + i, my + 1, lipL, 3);
  } else { const my = Ym; for (let i = -1; i <= 1; i++) P(nx + i, my, lip, 1); }
  // scar across the left eye / cheek
  if (look.scar) {
    const sc = mix(skin, '#f0b0a0', 0.55), sd = mix(skin, '#4a1a1a', 0.5);
    const x0 = eL - (t === 2 ? 1 : 0), y0 = Y - (t === 2 ? 5 : t === 1 ? 3 : 2), len = t === 2 ? 9 : t === 1 ? 6 : 3;
    for (let j = 0; j < len; j++) { const x = x0 + Math.round(j * 0.35), y = y0 + j; if (t === 0 && y === Y) continue; if (t > 0 && y >= Y - 1 && y <= Y + 1) continue; P(x, y, sc, 3); if (t === 2 && j % 2) P(x + 1, y, sd, 1); }
  }
}
function cyberEye(R, X, Y, t) {
  const m = '#5a626a', md = '#2a2f34';
  if (t === 2) { for (let i = -3; i <= 3; i++) for (let j = -2; j <= 2; j++) R.px(X + i, Y + j, Math.abs(i) === 3 || Math.abs(j) === 2 ? m : md, Math.abs(i) === 3 || Math.abs(j) === 2 ? (i < 0 || j < 0 ? 3 : 1) : 1); R.px(X, Y, '#ff3a2a', 3); R.px(X + 1, Y, '#ff3a2a', 3); R.px(X, Y + 1, '#c02018', 2); R.px(X + 1, Y + 1, '#c02018', 2); R.glow(X, Y, '#ffa090', 4); R.px(X + 3, Y - 4, m, 3); R.px(X + 4, Y - 3, m, 2); R.px(X + 4, Y + 3, m, 1); R.px(X + 2, Y - 3, '#d0d8dc', 4); }
  else if (t === 1) { for (let i = -2; i <= 2; i++) for (let j = -1; j <= 1; j++) R.px(X + i, Y + j, Math.abs(i) === 2 || Math.abs(j) === 1 ? m : md, 2); R.glow(X, Y, '#ff3a2a', 4); R.px(X + 1, Y, '#c02018', 3); }
  else { R.px(X, Y, md, 2); R.glow(X + 1, Y, '#ff3a2a', 4); R.px(X + 1, Y - 1, m, 3); }
}
function warpaint(R, A, F, cx, ey, G) {
  const c = F.warpaint, k = R.k;
  R.T((x, y) => (Math.abs(x - cx + 5.2) < 1.1 || Math.abs(x - cx - 5.2) < 1.1) && y > ey - 6 && y < ey + 8 && !(Math.abs(y - ey - 0.4) < 1.3), c, { g: G.head });   // vertical stripes through the eyes
  R.T((x, y) => Math.abs(y - (ey + 9.6)) < 0.8 + (R.tier === 0 ? 0.3 : 0) && Math.abs(x - cx) < 5, c, { g: G.head, ds: -1 });
}
function facialHair(R, A, cx, ey, hw, jw, jy, jry, S, G) {
  const style = (A.seed >>> 25) % 3, hair = A.hair, k = R.k;
  const full = style === 0 || A.role === 'chief' || A.cls === 'brute';
  const inJaw = (x, y) => inE(x, y, cx, jy, jw + 0.5, jry + 0.5) && y > ey + 5.5 && !(inE(x, y, cx, ey + 10.4, 3.6, 1.1));
  if (full) {
    R.T((x, y) => inJaw(x, y) && (y > ey + 8 || Math.abs(x - cx) > jw - 3 || (y > ey + 6.6 && Math.abs(x - cx) < 4.2)), hair, { g: G.head });
    R.group(); R.E(cx, jy + jry - 1, jw * 0.62, 4, hair, { clip: (x, y) => y > jy + jry - 2.5 });
    if (R.tier === 2) R.T((x, y, px, py) => inE(x, y, cx, jy + 2, jw + 2, jry + 4) && y > ey + 8 && h2(px, py >> 1) < 0.28, hair, { ds: -1 });
  } else if (style === 1) {    // goatee + moustache
    R.T((x, y) => (y > ey + 6.6 && y < ey + 9 && Math.abs(x - cx) < 4.4) || (y > ey + 11 && Math.abs(x - cx) < 2.6 && inJaw(x, y)), hair, { g: G.head });
  } else R.T((x, y) => inJaw(x, y) && y > ey + 6.8, mix(A.skin, hair, 0.55), { g: G.head });   // heavy stubble
}

function hairFront(R, A, cx, hy, hw, hry, ey, hs, S, G) {
  const hair = A.hair, k = R.k, t = R.tier, gear = A.head;
  const strand = (x, y, px) => ((px + Math.floor(y * k * 0.5)) % 3 === 0 ? -0.08 : 0);
  const hl = (x, y) => (inE(x, y, cx - 3, hy - 8, hw * 0.7, 3) ? 0.12 : 0);
  if (hs === 1) {   // bald: shine + sides
    R.S((x, y) => inE(x, y, cx - 4, hy - 8, 3.4, 2), 1, G.head);
    if ((A.seed >>> 9) % 2) { G.hair = R.group(); R.F((x, y) => inE(x, y, cx, hy + 1, hw + 0.6, hry - 1) && y > hy - 3 && y < ey + 1 && Math.abs(x - cx) > hw - 2.2, (x, y) => sphereLum(x, y, cx, hy, hw, hry) - 0.05, hair); }
    return;
  }
  if (hs === 4) {   // buzz: lit like the skull
    R.T((x, y, px, py) => inE(x, y, cx, hy, hw + 0.1, hry + 0.1) && y < hy - 5.5 + (Math.abs(x - cx) > hw - 3 ? 9 : 0) - ((px * 7) % 3) * 0.3, hair, { g: G.head });
    R.T((x, y, px, py) => inE(x, y, cx, hy, hw, hry) && Math.abs(y - (hy - 5.5)) < 0.9 && Math.abs(x - cx) <= hw - 3 && (px + py) % 2 === 0, mix(A.skin, hair, 0.5), { g: G.head });
    return;
  }
  if (hs === 2) {   // mohawk: shaved sides + crest
    R.T((x, y) => inE(x, y, cx, hy, hw, hry) && y < hy - 2 + (Math.abs(x - cx) > hw - 3 ? 5 : 0), mix(A.skin, hair, 0.4), { g: G.head });
    G.hair = R.group(); const col = A.raider ? A.accent : hair;
    for (let i = -3; i <= 3; i++) { const x = cx + i * 1.3, by = hy - hry + 2 + Math.abs(i) * 0.6, h = 10 - Math.abs(i) * 1.1; R.C(x, by, x - 1.6, by - h, 2.2, 0.6, col, { bias: i < 0 ? 0.05 : -0.05 }); }
    R.T((x, y, px) => px % 2 === 0 && y < hy - hry, col, { g: G.hair, ds: 1 });
    return;
  }
  // 0 short, 3 long, 5 slicked/ponytail: hair cap with a jagged fringe
  const part = hs === 3 ? cx + 2.5 : cx - 2;
  const fringe = (x) => {
    const dx = Math.abs(x - cx);
    if (dx > hw - 2.6) return hs === 3 ? 60 : ey + (hs === 5 ? -1 : 1.5);   // sideburns / side locks
    if (hs === 5) return hy - 8.5 + (dx / hw) ** 2 * 5;
    if (hs === 3) return hy - 7 + Math.abs(x - part) * 0.38 + (x < part ? 1.5 : 0);
    return hy - 6.2 + ((Math.floor(x * 0.55 + (A.seed & 3)) % 3) * 0.9) + (x > cx ? -0.6 : 0.4);
  };
  G.hair = R.group();
  const vol = hs === 0 ? 1.4 : 1.0;
  R.F((x, y) => {
    if (hs === 3 && Math.abs(x - cx) > hw - 2.6) return y < 47 && inE(x, y, cx, hy + 6, hw + 2.8, hry + 12) && !inE(x, y, cx, hy + 3, hw - 2.2, hry + 4);
    return inE(x, y, cx, hy - 0.6, hw + vol, hry + vol) && y < fringe(x);
  }, (x, y) => sphereLum(x, y, cx, hy - 1, hw + 2, hry + 2) + strand(x, y, Math.floor(x * k)) + hl(x, y), hair, 0.1);
  if (hs === 3 && t > 0) R.L(part, hy - hry + 1.5, part + 0.4, hy - 9, hair, 1);
  if (t === 2 && hs === 0) for (let i = 0; i < 3; i++) R.D(cx - 6 + i * 4.6, hy - 6 + (i % 2), hair, i ? 1 : 3);   // fringe tips
}

function headGear(R, A, F, cx, hy, hw, hry, ey, jy, jry, G) {
  const k = R.k, t = R.tier, gear = A.head;
  switch (gear) {
    case 'helmet': {
      R.S((x, y) => y > hy - 6 && y < hy - 2.8, -1, G.head);       // shadow under the brim
      G.gear = R.group(); const hc = '#5e6a44';
      R.E(cx, hy - 3.6, hw + 3, hry - 2.4, hc, { clip: (x, y) => y < hy - 4.4 });
      R.T((x, y, px, py) => y < hy - 4.4 && ((px * 5 + py * 3) % 7 === 0 || (px * 3 + py * 7) % 11 === 0), '#4a5434', { g: G.gear });   // camo/net
      R.group(); R.C(cx - hw - 3.2, hy - 4.6, cx + hw + 3.2, hy - 4.6, 1.5, 1.5, '#3e4a2c', { flat: 0.4 });
      R.group(); R.E(cx - 4, hy - 12, 2.6, 1.8, F.accent || A.accent);
      if (t > 0) { R.group(true); R.L(cx - hw + 0.6, hy - 3, cx - hw + 2.5, jy + 3, '#2a2a20', 1); R.L(cx + hw - 0.6, hy - 3, cx + hw - 2.5, jy + 3, '#2a2a20', 0); }
      break;
    }
    case 'hood': case 'reaper': {
      const hc = gear === 'reaper' ? F.hood : (F.coat || F.jacket || A.cloth2);
      R.S((x, y) => y < hy - 4 + Math.abs(x - cx) * 0.25, -1, G.head); R.S((x, y) => y < hy - 7 + Math.abs(x - cx) * 0.25, -1, G.head);
      G.gear = R.group();
      const opening = (x, y) => inE(x, y, cx + 0.5, hy + 5.5, hw - 0.4, hry + 2.5) && y > hy - 9;
      R.F((x, y) => inE(x, y, cx, hy + 1.5, hw + 5.2, hry + 5.5) && !opening(x, y) && y < jy + 7, (x, y) => sphereLum(x, y, cx, hy + 1, hw + 5, hry + 6) + ((Math.floor(x * k * 0.4) % 2) ? -0.04 : 0), hc);
      R.L(cx - 1, hy - hry - 4, cx - 2, hy - 9.5, shade(hc, 0.55), 0);   // seam
      if (gear === 'reaper') { skullFace(R, A, cx, hy, hw, hry, ey, jy, jry, G, true); R.group(); R.P([[cx - hw - 2, ey + 13], [cx - 2, ey + 16.5], [cx + 2, ey + 16.5], [cx + hw + 2, ey + 13], [cx + hw + 7, 66], [cx - hw - 7, 66]], hc); R.group(); R.P([[cx - 3, ey + 16.5], [cx + 3, ey + 16.5], [cx, ey + 24]], '#140a0a', { flat: 1 }); }
      break;
    }
    case 'headband': {
      const c = F.armband || A.accent, by = hy - 5.2;
      R.T((x, y) => y > by - 1.4 && y < by + 1.4, c, { g: [G.head, G.hair].filter(Boolean) });
      if (t === 2) R.T((x, y, px) => y > by - 1.4 && y < by - 0.4, shade(c, 1.15), { g: [G.head, G.hair].filter(Boolean) });
      R.group(); R.C(cx - hw - 0.5, by, cx - hw - 4.5, by + 6, 1.1, 0.8, c); R.C(cx - hw - 0.5, by, cx - hw - 3, by + 8, 0.9, 0.6, shade(c, 0.8));
      if (t > 0) { const X = R.X(cx), Yb = R.X(by); R.px(X, Yb - 1, '#f2ecde', 4); R.px(X - 1, Yb, '#f2ecde', 3); R.px(X, Yb, '#f2ecde', 4); R.px(X + 1, Yb, '#f2ecde', 3); R.px(X, Yb + 1, '#f2ecde', 3); }
      break;
    }
    case 'goggles': {
      const by = hy - 6.2;
      R.T((x, y) => y > by - 1 && y < by + 1, '#3a2a1a', { g: [G.head, G.hair].filter(Boolean) });
      R.group();
      for (const s of [-1, 1]) { const gx = cx + s * 4.6; R.E(gx, by - 0.5, 3.8, 3.4, '#b0883a'); R.E(gx, by - 0.5, 2.5, 2.2, '#c87a1a', { bias: 0.1 }); }
      R.group(true); for (const s of [-1, 1]) { const gx = cx + s * 4.6; R.D(gx - 1.2, by - 1.6, '#fff6c0', 4); if (t === 2) R.D(gx + 1, by + 0.6, '#7a3a0a', 1); }
      if (A.cls === 'techie' && t > 0) { R.group(); R.E(cx + hw + 0.4, ey + 1.5, 2.4, 3.2, '#2a2f34'); R.C(cx + hw + 0.5, ey + 3.5, cx + 6, ey + 10.5, 0.6, 0.6, '#2a2f34'); R.E(cx + 5.2, ey + 10.6, 1.2, 1, '#46f2c8'); }
      break;
    }
    case 'cap': {
      R.S((x, y) => y > hy - 6 && y < hy - 3, -1, G.head);
      G.gear = R.group(); R.E(cx, hy - 4.5, hw + 1.6, hry - 4, '#2a2a2e', { clip: (x, y) => y < hy - 4.2 });
      R.group(); R.C(cx - 2, hy - 4.4, cx + hw + 6, hy - 3.6, 1.7, 1.2, '#1a1a1e');
      R.group(); R.E(cx, hy - 10, 1.8, 1.8, A.accent);
      R.group(); for (let i = -2; i <= 2; i++) { const x = cx + i * 3.4, y0 = hy - hry + 3.2 + Math.abs(i) * 0.9; spike(R, x, y0 + 1, 5.5, i * 0.5); }
      break;
    }
    case 'gas': gasMask(R, A, cx, hy, hw, hry, ey, jy, jry, G); break;
    case 'mask': skullFace(R, A, cx, hy, hw, hry, ey, jy, jry, G, false); break;
  }
}
function gasMask(R, A, cx, hy, hw, hry, ey, jy, jry, G) {
  const rub = A.raider ? '#3a302a' : '#2e332f', lens = A.raider ? '#f08a2a' : '#8fd14f', t = R.tier, k = R.k;
  R.T((x, y) => y > ey - 4.2 && y < jy + jry + 1, rub, { g: G.head });
  G.gear = R.group(); R.E(cx, jy + 1, hw - 1.2, jry - 0.5, rub, { clip: (x, y) => y > ey - 3.5 });
  R.group(); for (const s of [-1, 1]) R.E(cx + s * 5.2, ey + 0.2, 3.6, 3.3, '#1a1c1a');
  R.group(true); for (const s of [-1, 1]) { const gx = cx + s * 5.2; R.E(gx, ey + 0.2, 2.4, 2.2, lens, { bias: 0.08 }); R.glow(R.X(gx - 0.8), R.X(ey - 0.6), mix(lens, '#ffffff', 0.6), 4); }
  R.group(); R.E(cx + 0.5, ey + 9.5, 4.6, 4.4, '#5a625c'); R.E(cx + 0.5, ey + 10, 3, 2.8, '#3a403c');
  if (t > 0) for (let i = 0; i < 3; i++) R.L(cx - 2, ey + 8.5 + i * 1.6, cx + 3, ey + 8.5 + i * 1.6, '#262a28', 0);
  R.group(); R.C(cx - hw - 0.5, ey - 4, cx + hw + 0.5, ey - 4, 0.8, 0.8, '#1a1c1a', { flat: 0.5 });
  if (A.raider) { R.group(); R.E(cx - 7.5, ey + 8, 2.4, 2.4, '#5a625c'); R.E(cx + 8, ey + 8, 2.4, 2.4, '#4a524c'); }
}
function skullFace(R, A, cx, hy, hw, hry, ey, jy, jry, G, boss) {
  const t = R.tier, k = R.k, bone = '#e6dcc0';
  if (A.maskStyle === 'hockey' && !boss) {
    G.mask = R.group(); R.E(cx, hy + 4.2, hw - 0.6, hry + 1.2, '#dcd6c4', { clip: (x, y) => y > hy - hry + 2 });
    R.group(true); for (const s of [-1, 1]) R.E(cx + s * 5.2, ey, 2.4, 1.5, '#14100e');
    for (const s of [-1, 1]) { const X = R.X(cx + s * 5.2); R.px(X, R.X(ey), '#c43d2f', 3); }
    R.L(cx - 4, hy - 9, cx - 6, hy - 3, A.accent, 2); R.L(cx + 4, hy - 9, cx + 6, hy - 3, A.accent, 2);
    if (t > 0) for (const [x, y] of [[-2, 9], [0, 10.5], [2, 9], [-1, 12.5], [1, 12.5], [-4, 6], [4, 6]]) R.D(cx + x, ey + y, '#2a2420', 0);
    return;
  }
  // skull: bone cranium over the face, dark sockets, nasal cavity, teeth
  G.mask = R.group();
  R.F((x, y) => inE(x, y, cx, hy + 1, hw - (boss ? 0.6 : 0.3), hry - 0.5) && y > (boss ? hy - 9 : hy - hry) || inE(x, y, cx, jy + 1.5, hw * 0.62, jry - 1.5),
    (x, y) => sphereLum(x, y, cx, hy + 3, hw, hry + 3) - (inE(x, y, cx - 7.5, ey + 6, 2.4, 2.6) || inE(x, y, cx + 7.5, ey + 6, 2.4, 2.6) ? 0.14 : 0), bone);
  R.group(true);
  const eye = boss ? '#ff3020' : A.role === 'psycho' ? '#ff4020' : '#a82a18';
  for (const s of [-1, 1]) {
    R.F((x, y) => inE(x, y, cx + s * 5, ey + 0.3, 3.4, 3), () => 0.1, '#140808', 0);
    const X = R.X(cx + s * 5), Y = R.X(ey + 0.6); R.glow(X, Y, eye, boss ? 4 : 3); if (t === 2) { R.px(X + 1, Y, eye, 2); if (boss) R.glow(X, Y - 1, '#ffd0a0', 4); }
  }
  R.F((x, y) => y > ey + 3.5 && y < ey + 7.2 && Math.abs(x - cx) < (y - ey - 3) * 0.55, () => 0.1, '#140808', 0);
  const ty = ey + 9.5;
  for (let i = -3; i <= 3; i++) { const x = cx + i * 1.4; if (t === 0 && i % 2) continue; R.L(x, ty, x, ty + (t === 0 ? 1.5 : 3), i % 2 ? '#140808' : bone, i % 2 ? 0 : 3); }
  R.L(cx - 5, ty - 0.6, cx + 5, ty - 0.6, '#140808', 0); if (t > 0) R.L(cx - 5, ty + 3.4, cx + 5, ty + 3.4, '#140808', 0);
  if (t === 2) { R.L(cx - 6, hy - 6, cx - 3, hy - 2, '#8a7a5a', 1); R.L(cx - 3, hy - 2, cx - 4, hy + 0.5, '#8a7a5a', 1); }
  if (boss) { R.group(); for (const s of [-1, 1]) { R.C(cx + s * (hw - 2), hy - 9, cx + s * (hw + 3), hy - 19, 2.2, 0.7, '#d8ccb0'); } }
}
function robotHead(R, A, cx) {
  const t = R.tier, m = '#7a848c', hy = 24;
  R.group(); R.E(cx - 13.5, 28, 2.6, 5, '#4a525a'); R.E(cx + 13.5, 28, 2.6, 5, '#3e464e');
  R.group(); R.P([[cx - 12, 14], [cx - 8, 8], [cx + 8, 8], [cx + 12, 14], [cx + 12.5, 33], [cx + 8, 41], [cx - 8, 41], [cx - 12.5, 33]], m);
  R.S((x, y) => y < 12, 1, R.g); R.S((x, y) => x > cx + 9, -1, R.g);
  R.group(); R.P([[cx - 11, 21], [cx + 11, 21], [cx + 10, 29], [cx - 10, 29]], '#16181c', { flat: 1 });
  R.group(true); R.rect(R.X(cx - 9), R.X(24), Math.max(2, R.X(18)), Math.max(1, R.X(2.6)), '#e0402a', 3);
  R.rect(R.X(cx - 5), R.X(24), Math.max(1, R.X(5)), Math.max(1, R.X(2.6)), '#ffb090', 4);
  for (let x = cx - 8; x <= cx + 8; x += 4) R.glows.push([R.X(x), R.X(25), '#e0402a']);
  R.group(); R.P([[cx - 7, 32], [cx + 7, 32], [cx + 6, 39], [cx - 6, 39]], '#3a4048');
  for (let i = 0; i < 5; i++) R.L(cx - 5 + i * 2.5, 33, cx - 5 + i * 2.5, 38, '#16181c', 0);
  R.group(); R.L(cx + 6, 9, cx + 9, 0, '#8a949c', 2); R.glow(R.X(cx + 9), R.X(0.8), '#ff3020', 4);
  for (const [x, y] of [[cx - 10, 16], [cx + 10, 16], [cx - 10.5, 31], [cx + 10.5, 31]]) R.D(x, y, '#d0d8dc', 4);
  if (t > 0) { R.L(cx - 9, 11, cx - 4, 18, '#4a5258', 1); R.D(cx + 3, 14, A.accent, 3); R.D(cx + 4, 14, A.accent, 3); }
}

// ---------------------------------------------------------------- beasts
function beast(R, A) {
  const v = A.tid.includes('kret') ? 'mole' : A.variant || 'dog', t = R.tier;
  const fur = { rat: '#6a5a50', wolf: '#6a6660', boar: '#5a3e30', mole: '#3a3238', dog: ['#6a4a30', '#5a5048', '#7a5a38'][A.seed % 3] }[v];
  const light = mix(fur, '#e0d0b0', 0.35), eye = A.mutation || v === 'wolf' || v === 'dog' ? '#ff3a1a' : '#f2c03b';
  const furTex = (g, top = 34) => { R.T((x, y, px, py) => h2(px, py) < 0.17, fur, { g, ds: -1 }); R.T((x, y, px, py) => h2(px + 5, py + 3) < 0.1 && y < top, fur, { g, ds: 1 }); };
  if (v === 'mole') {
    R.group(); R.E(32, 64, 30, 22, fur); furTex(R.g);
    const g = R.group(); R.E(32, 34, 17, 15, fur); furTex(g);
    R.group(); R.C(32, 40, 32, 50, 6.5, 4.5, '#b87a7a');            // fleshy snout
    R.group(true); for (let i = 0; i < 7; i++) { const a = -Math.PI * 0.9 + i * Math.PI * 0.3; R.C(32 + Math.cos(a) * 3, 50 + Math.sin(a) * 2, 32 + Math.cos(a) * 7.5, 50 + Math.sin(a) * 4.5 + 2, 1.3, 0.7, '#d89a9a'); }
    R.group(); R.E(32, 54, 5, 2.4, '#1a0e0e'); for (let i = -2; i <= 2; i++) R.L(32 + i * 1.8, 52.8, 32 + i * 1.8, 54.6, '#f2ecde', 3);
    R.group(true); for (const s of [-1, 1]) { R.E(32 + s * 7, 30, 1.2, 0.9, '#1a1010'); R.glow(R.X(32 + s * 7), R.X(30), '#c8b04a', 3); }
    for (const s of [-1, 1]) { R.group(); R.E(32 + s * 21, 52, 8, 6, shade(fur, 1.1)); R.group(); for (let i = 0; i < 4; i++) { const bx = 32 + s * (14 + i * 4); R.C(bx, 50, bx + s * 2, 38 - (i === 1 || i === 2 ? 3 : 0), 1.8, 0.6, '#e6dcc0'); } }
    return;
  }
  // chest / shoulders
  R.group(); R.E(32, 66, 26, 17, v === 'boar' ? shade(fur, 0.8) : fur); furTex(R.g, 60);
  if (v !== 'boar' && v !== 'rat') { R.group(); R.E(32, 58, 9, 8, light, { bias: -0.05 }); furTex(R.g, 0); R.T((x, y, px, py) => h2(px, py) < 0.4 && y < 54, light, { g: R.g }); }
  // ears (behind head)
  R.group();
  if (v === 'rat') for (const s of [-1, 1]) { R.E(32 + s * 13, 16, 6.5, 6.5, fur); R.E(32 + s * 13, 16.5, 4.4, 4.4, '#c98a88', { bias: -0.05 }); }
  else if (v === 'boar') for (const s of [-1, 1]) R.P([[32 + s * 9, 20], [32 + s * 19, 9], [32 + s * 17, 22]], fur);
  else for (const s of [-1, 1]) { const tip = s > 0 && A.seed % 2 ? 8 : 4; R.P([[32 + s * 6, 20], [32 + s * 16, tip], [32 + s * 17.5, 24]], fur); R.P([[32 + s * 9, 19], [32 + s * 15, tip + 5], [32 + s * 15.5, 21]], '#7a4a44', { bias: -0.15 }); }
  if (v === 'boar') { R.group(); for (let i = -3; i <= 3; i++) R.C(32 + i * 2.2, 18, 32 + i * 2.8, 8 - (3 - Math.abs(i)) * 0.8, 1.6, 0.5, shade(fur, 0.7)); }
  // skull + cheeks
  const hg = R.group();
  const hw = v === 'rat' ? 12 : v === 'boar' ? 15 : 14;
  R.E(32, 26, hw, 11, fur); R.E(32, 32, hw - 1.5, 10, fur);
  if (v === 'dog' || v === 'wolf') for (const s of [-1, 1]) R.P([[32 + s * (hw - 4), 30], [32 + s * (hw + 3), 38], [32 + s * (hw - 3), 40]], fur);   // cheek ruff
  furTex(hg);
  if (v === 'dog') { const S2 = rng(A.seed); for (let i = 0; i < 3; i++) { const x = 22 + S2() * 20, y = 17 + S2() * 10, r = 1.6 + S2() * 1.8; R.T((ux, uy) => inE(ux, uy, x, y, r, r * 0.8), '#9a5a4a', { g: hg }); } }   // mange
  R.S((x, y) => y > 22 && y < 24.5 && Math.abs(x - 32) < 9, -1, hg);   // brow furrow
  // muzzle
  const mg = R.group();
  if (v === 'rat') { R.C(32, 32, 32, 46, 7.5, 3.4, fur); R.T((x, y) => y > 37, light, { g: mg }); }
  else if (v === 'boar') { R.E(32, 40, 9, 8.5, fur); }
  else { R.C(32, 30, 32, 36.5, 6, 6.8, light); R.S((x, y) => y > 39.5, -1, mg); R.S((x, y) => x > 35.5, -1, mg); R.L(32, 30, 32, 33.5, shade(light, 0.85), 2); }
  // nose
  R.group();
  if (v === 'boar') { R.E(32, 44, 6.4, 4.4, '#b88078'); R.group(true); R.E(29.6, 44, 1.2, 1.5, '#3a1a18'); R.E(34.4, 44, 1.2, 1.5, '#3a1a18'); }
  else if (v === 'rat') { R.E(32, 46.5, 2.4, 1.8, '#d89a98'); }
  else { R.E(32, 36, 4.4, 2.8, '#1a1414'); R.group(true); R.D(30.6, 35, '#9a9aa0', 4); R.D(30.4, 37, '#0a0606', 0); R.D(33.6, 37, '#0a0606', 0); }
  // mouth + teeth
  R.group(true);
  if (v === 'rat') { R.L(31, 48.5, 31, 52, '#f2e0a0', 3); R.L(33, 48.5, 33, 52, '#f2e0a0', 3); if (t > 0) R.L(32, 49, 32, 52, '#8a7040', 1); for (const yy of [43, 45.5]) for (const s of [-1, 1]) R.L(32 + s * 4, yy, 32 + s * 15, yy - 2 + (yy - 43), '#d8d0c0', 3); }
  else if (v === 'boar') { R.L(26, 49, 38, 49, '#1a0e0e', 0); for (const s of [-1, 1]) R.C(32 + s * 7, 48, 32 + s * 12, 37, 1.5, 0.5, '#f2ecd8'); }
  else {
    R.E(32, 43, 7, 3.2, '#3a1010', { clip: (x, y) => y > 41 });
    R.L(25, 41, 39, 41, '#140808', 0);
    for (const s of [-1, 1]) { R.C(32 + s * 4.8, 40.6, 32 + s * 4.4, 45, 0.9, 0.4, '#f2ecde'); R.C(32 + s * 5.6, 45.8, 32 + s * 5.2, 42.6, 0.8, 0.35, '#e8e0cc'); }
    if (t === 2) for (let i = -2; i <= 2; i++) R.D(32 + i * 1.4, 41.6, '#d8d0b8', 3);
    R.L(32, 38, 32, 40.6, '#2a1414', 0);
  }
  // eyes (angry brow)
  R.group(true);
  const ey = v === 'rat' ? 27 : 25.5, ex = v === 'boar' ? 9 : v === 'rat' ? 7 : 7.6;
  for (const s of [-1, 1]) {
    const X = R.X(32 + s * ex), Y = R.X(ey);
    if (t === 2) { R.px(X - 1, Y, '#1a0e0e', 2); R.px(X, Y, eye, 3); R.px(X + 1, Y, eye, 3); R.px(X, Y + 1, shade(eye, 0.6), 2); R.px(X + 1, Y + 1, '#1a0e0e', 2); R.px(X + 2, Y + (s < 0 ? 1 : 0), '#1a0e0e', 2); R.glow(X, Y, mix(eye, '#ffffff', 0.4), 4); for (let i = -2; i <= 3; i++) R.px(X + i, Y - 2 + (s * (i - 0.5) < 0 ? 0 : 1), shade(fur, 0.4), 1); }
    else if (t === 1) { R.px(X, Y, eye, 3); R.px(X + 1, Y, '#1a0e0e', 2); R.glow(X, Y, mix(eye, '#ffffff', 0.3), 4); for (let i = -1; i <= 1; i++) R.px(X + i, Y - 1, shade(fur, 0.4), 1); }
    else R.glow(X, Y, eye, 4);
  }
  if (A.mutation && t > 0) { R.group(); R.E(24, 18, 1.8, 1.8, '#c8e04a'); R.E(41, 21, 1.3, 1.3, '#a8c03a'); }
  if (v === 'dog' && t > 0) { R.group(true); R.L(38, 17, 42, 26, mix(fur, '#e0a0a0', 0.5), 3); }
}

// ---------------------------------------------------------------- insects
function insect(R, A) {
  const v = A.variant || 'beetle', t = R.tier;
  if (v === 'swarm') {
    const S = rng(A.seed ^ 0xf1);
    R.group(true); for (let i = 0; i < (t ? 26 : 12); i++) { const x = 4 + S() * 56, y = 4 + S() * 56; if (inE(x, y, 32, 34, 17, 19)) continue; R.D(x, y, '#141410', 0); R.D(x + 1.2 / R.k, y - 1.2 / R.k, '#b8c8d0', 3); }
    R.group(); for (const s of [-1, 1]) R.E(32 + s * 13, 22, 9, 4.2, '#b8ccd4', { rot: s * 28, bias: 0.15 });
    R.group(true); for (const s of [-1, 1]) for (let i = 0; i < 3; i++) R.L(32 + s * (7 + i * 2.6), 20 + i, 32 + s * (14 + i * 3), 18 + i * 2.6, '#7a8a94', 1);
    const hg = R.group(); R.E(32, 36, 11, 10, '#2e2c26'); R.T((x, y, px, py) => h2(px, py) < 0.25, '#2e2c26', { g: hg, ds: 1 });
    R.group(); for (const s of [-1, 1]) { R.E(32 + s * 6.4, 31, 6, 7, '#a01c12'); R.T((x, y, px, py) => inE(x, y, 32 + s * 6.4, 31, 6, 7) && (px + py) % 2 === 0, '#c43a22', {}); }
    R.group(true); for (const s of [-1, 1]) R.D(32 + s * 6.4 - 2, 28, '#ffd0b0', 4);
    R.group(); R.C(32, 42, 32, 51, 1.8, 1, '#4a3a2a'); R.E(32, 51.5, 2.4, 1.4, '#6a5a3a');
    R.group(true); for (let i = 0; i < 7; i++) R.D(8 + S() * 48, 6 + S() * 52, '#8fd14f', 4);
    return;
  }
  const c = v === 'scorpion' ? '#a87a3a' : v === 'spider' ? '#3a2e2a' : ['#3f7a2a', '#7a3a1a', '#5a3a6a', '#2a4a6a'][A.seed % 4];
  if (v === 'scorpion') {
    // tail arching over the head from the lower right
    R.group();
    const N = 7; let last, prev;
    for (let i = 0; i <= N; i++) { const a = (50 - i * 23) * Math.PI / 180, x = 34 + Math.cos(a) * 19, y = 28 + Math.sin(a) * 19, rad = 4.4 - i * 0.3; if (prev) R.C(prev[0], prev[1], x, y, prev[2], rad, i % 2 ? c : shade(c, 0.85)); prev = [x, y, rad]; last = [x, y]; }
    R.group(); R.E(last[0] - 1.5, last[1] + 2.5, 3.8, 3.4, '#c89a4a'); R.C(last[0] - 1, last[1] + 4.5, last[0] + 3, last[1] + 11, 1.6, 0.4, '#3a2410'); R.glow(R.X(last[0] + 3), R.X(last[1] + 11), '#b8ff6a', 4);
    // claws
    for (const s of [-1, 1]) {
      R.group(); R.C(32 + s * 9, 50, 32 + s * 17, 44, 3.4, 3, c); R.C(32 + s * 17, 44, 32 + s * 19, 36, 3, 3.4, c);
      R.group(); R.E(32 + s * 20, 31, 6.2, 7, c, { rot: s * 12 }); R.C(32 + s * 17.5, 27, 32 + s * 15, 15, 2.6, 0.7, shade(c, 1.1)); R.C(32 + s * 23, 26, 32 + s * 23.5, 14, 2.6, 0.7, c);
    }
    // head/carapace
    const hg = R.group(); R.E(32, 47, 13.5, 10.5, c); R.T((x, y, px, py) => y > 47 && py % 3 === 0, shade(c, 0.7), { g: hg }); R.S((x, y) => Math.abs(x - 32) < 0.6 && y < 46, -1, hg);
    R.group(true); for (const s of [-1, 1]) { R.E(32 + s * 3, 42, 1.6, 1.5, '#140c08'); R.D(32 + s * 3 - 0.5, 41.4, '#f0f0d0', 4); R.D(32 + s * 8, 44, '#140c08', 0); R.D(32 + s * 9.5, 45, '#140c08', 0); }
    R.group(); for (const s of [-1, 1]) R.C(32 + s * 2.8, 54, 32 + s * 1.2, 60, 1.5, 0.6, shade(c, 0.6));
    return;
  }
  if (v === 'spider') {
    R.group(); for (const s of [-1, 1]) for (let i = 0; i < 4; i++) { const y0 = 30 + i * 6; R.C(32 + s * 9, y0, 32 + s * (20 + i), y0 - 14 + i * 3, 2, 1.6, c); R.C(32 + s * (20 + i), y0 - 14 + i * 3, 32 + s * (28 - i), y0 + 12, 1.6, 1, shade(c, 0.9)); }
    const hg = R.group(); R.E(32, 34, 13, 12, c); R.T((x, y, px, py) => h2(px, py) < 0.25, shade(c, 1.4), { g: hg });
    R.group(true); for (const [x, y, r] of [[-3, 30, 1.8], [3, 30, 1.8], [-6.5, 28, 1.2], [6.5, 28, 1.2], [-1.4, 26, 1], [1.4, 26, 1], [-8.5, 31.5, 0.9], [8.5, 31.5, 0.9]]) { R.E(32 + x, y, r, r, '#100606'); R.glow(R.X(32 + x - r * 0.3), R.X(y - r * 0.3), '#ff4a2a', 3); }
    R.group(); for (const s of [-1, 1]) R.C(32 + s * 3, 41, 32 + s * 1.5, 51, 2.4, 1, '#1a1010');
    R.group(true); for (const s of [-1, 1]) R.D(32 + s * 1.5, 51, '#c8e04a', 4);
    return;
  }
  // beetle
  R.group(); R.E(32, 58, 22, 12, shade(c, 0.75));
  const hg = R.group(); R.E(32, 36, 17, 16, c);
  R.T((x, y, px, py) => h2(px, py) < 0.12, shade(c, 1.4), { g: hg });
  R.group(); for (const s of [-1, 1]) { R.E(32 + s * 10, 30, 5.4, 6.4, '#7a1d17'); R.T((x, y, px, py) => inE(x, y, 32 + s * 10, 30, 5.4, 6.4) && (px + py) % 2 === 0, '#a82a1a', {}); }
  R.group(true); for (const s of [-1, 1]) R.D(32 + s * 10 - 2, 27, '#ffd0b0', 4);
  R.group(); R.C(32, 24, 32, 6, 3, 1, shade(c, 1.1)); for (const s of [-1, 1]) R.C(32 + s * 4, 18, 32 + s * 13, 4, 0.7, 0.5, shade(c, 0.6));
  R.group(); for (const s of [-1, 1]) { R.C(32 + s * 6, 44, 32 + s * 9, 52, 2.2, 1.4, '#d8d0b0'); R.C(32 + s * 9, 52, 32 + s * 4, 56, 1.4, 0.6, '#d8d0b0'); }
  R.group(); R.E(32, 47, 4, 2.4, '#1a1010');
}

// ---------------------------------------------------------------- machines
function drone(R, A) {
  const body = ['#6a727a', '#7a6a5a', '#5a6a7a'][A.seed % 3], t = R.tier;
  R.group(); for (const s of [-1, 1]) { R.C(32 + s * 12, 26, 32 + s * 25, 20, 2, 1.6, '#3a4048'); }
  R.group(true); for (const s of [-1, 1]) { R.E(32 + s * 25, 17, 9, 1.8, '#9aa4ac', { bias: 0.1 }); R.T((x, y, px) => inE(x, y, 32 + s * 25, 17, 9, 1.8) && px % 3 === 0, '#c8d0d4', {}); }
  R.group(); R.C(32, 48, 32, 58, 2.2, 1.6, '#2a2e34'); R.E(32, 58.5, 1.6, 1.4, '#101214');
  R.group(); R.E(32, 33, 17, 15, body);
  R.T((x, y) => y > 42 && y < 45, '#d8a020', { g: R.g }); R.T((x, y, px) => y > 42 && y < 45 && (px % 4 < 2), '#1a1a1a', { g: R.g });
  R.group(); R.E(32, 31, 9.5, 9, '#16181c'); R.group(true); R.E(32, 31, 6.5, 6.2, '#c82a1a', { bias: 0.05 }); R.E(32, 31, 2.8, 2.8, '#ffd0a0'); R.glow(R.X(32), R.X(31), '#ff6a3a', 4); R.D(29.5, 28.5, '#ffffff', 4);
  R.group(); R.L(40, 20, 44, 8, '#8a949c', 2); R.glow(R.X(44), R.X(7.5), '#46f2c8', 4);
  for (const [x, y] of [[19, 30], [45, 30], [24, 41], [40, 41]]) R.D(x, y, '#c8d0d4', 4);
}
function turret(R, A) {
  const t = R.tier;
  R.group(); R.P([[10, 64], [14, 52], [50, 52], [54, 64]], '#3a3f44');
  R.T((x, y, px) => y > 58 && ((px + Math.floor(y)) % 6 < 3), '#c89a2a', { g: R.g });
  R.group(); R.P([[12, 26], [20, 16], [44, 16], [52, 26], [52, 50], [12, 50]], '#5a626a');
  R.S((x, y) => y < 22, 1, R.g);
  R.group(); R.P([[16, 30], [48, 30], [48, 44], [16, 44]], '#4a5258');
  for (const s of [-1, 1]) { R.group(); R.E(32 + s * 7, 37, 5, 5, '#2a2e32'); R.group(); R.E(32 + s * 7, 37, 3, 3, '#0a0b0c'); if (t > 0) R.D(32 + s * 7 - 1.5, 35.5, '#6a7278', 3); }
  R.group(); R.P([[27, 18], [37, 18], [36, 26], [28, 26]], '#2a2e32'); R.group(true); R.E(32, 22, 2.2, 2.2, '#ff3020'); R.glow(R.X(32), R.X(22), '#ff6a4a', 4);
  for (const [x, y] of [[15, 28], [49, 28], [15, 47], [49, 47]]) R.D(x, y, '#aab4ba', 4);
  R.group(true); R.D(19, 21, '#46f2c8', 4);
}

// ---------------------------------------------------------------- entry
function render(A, n) {
  const zt = n < 40 ? 1.36 : n < 56 ? 1.27 : 1.2;
  const R = new PR(n, A.kind === 'human' ? (A.machine ? zt - 0.1 : zt) : n < 40 ? 1.1 : 1), th = themeOf(A);
  if (A.kind === 'human') human(R, A); else if (A.kind === 'beast') beast(R, A); else if (A.kind === 'insect') insect(R, A); else if (A.kind === 'drone') drone(R, A); else turret(R, A);
  const [c, g] = mkCanvas(n, n), img = g.createImageData(n, n);
  background(img, n, th, A.seed);
  R.blit(img, 0, 0);
  rimPass(img, R, th.rim);
  glowPass(img, R);
  frame(img, n, th);
  g.putImageData(img, 0, 0);
  return c;
}

function isFemale(desc, A) {
  if (A.enemy) return false;
  const r = RECRUITS.find(r => (desc.recruitId && r.id === desc.recruitId) || r.name === desc.name);
  const g = desc.gender || (r && r.gender);
  if (g) return g === 'f' || g === 'k';
  return /a$/i.test(String(desc.name || '').trim().split(/\s+/)[0] || '');
}

export function portraitCanvas(desc, size = 64) {
  desc = desc || {};
  const A = analyze(desc); A.fem = isFemale(desc, A);
  size = Math.max(8, Math.round(+size || 64));
  let base = size; if (size > 64) for (const b of [64, 48, 32]) if (size % b === 0) { base = b; break; }
  const key = A.key + '|' + A.seed + '|' + A.fem + '|' + base;
  let src = cache.get(key);
  if (!src) { src = render(A, base); cache.set(key, src); if (cache.size > 400) cache.delete(cache.keys().next().value); }
  const [oc, og] = mkCanvas(size, size); og.imageSmoothingEnabled = false; og.drawImage(src, 0, 0, size, size); return oc;
}
