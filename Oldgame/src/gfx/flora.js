// flora.js — procedural pixel-art plants of the wasteland in the same shaded-raster style as the creatures
// (raster.js: material ramps, light from the upper left, selective outlines). No image files.
// buildFloraAtlas() -> { canvas, cw, ch, gy, cols, rows, cells: [{ type, variant, col, row, h (world units), glow }] }
// Each plant is drawn in a CW x CH cell standing on row GY. Types: saguaro, pear (prickly pear), deadbush,
// shrooms (glowing caps), flower (mutated, with an eye), reeds, grass, vine (thorny tentacles), pod (spore bulb),
// tree (twisted dead tree), fern (irradiated fern), crystal (salt / glass growth).
import { Raster, D2R } from './raster.js';
import { mix } from './util.js';

export const FLORA_TYPES = ['saguaro', 'pear', 'deadbush', 'shrooms', 'flower', 'reeds', 'grass', 'vine', 'pod', 'tree', 'fern', 'crystal'];
const CW = 64, CH = 80, GY = 76, VARS = 3;

const rnd = (seed) => { let s = seed >>> 0 || 1; return () => ((s = Math.imul(s ^ (s >>> 15), 2246822519) + 0x9e3779b9 >>> 0) / 4294967296); };
const GREENS = ['#4f7f3c', '#5c8a46', '#3f6e3a'], MUT = ['#7a5aa6', '#3f9488', '#a08a3a'], GLOWS = ['#8fff40', '#40ffc8', '#e070ff', '#ffb030', '#ff5a9a'];

/** a curved tapering stem through points, returns the tip */
function stem(R, pts, r0, r1, col, o) { const n = pts.length - 1; for (let i = 0; i < n; i++) { const a = r0 + (r1 - r0) * i / n, b = r0 + (r1 - r0) * (i + 1) / n; R.cap(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], a, b, col, o); } return pts[n]; }
const bez = (p0, p1, p2, n = 6) => Array.from({ length: n + 1 }, (_, i) => { const t = i / n, u = 1 - t; return [u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0], u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]]; });
function glowDot(R, x, y, r, col) { R.ell(x, y, r, r, col, { bias: 0.25 }); R.ell(x - r * 0.3, y - r * 0.3, Math.max(0.5, r * 0.42), Math.max(0.5, r * 0.42), mix(col, '#ffffff', 0.75), { bias: 0.5 }); }

const DRAW = {
  saguaro(R, r, v) {
    const mut = v === 2, col = mut ? MUT[(r() * 3) | 0] : GREENS[(r() * 3) | 0], dark = mix(col, '#10180c', 0.45), cx = 32, H = 46 + r() * 16;
    const arm = (sd, y0, len, up) => { R.group(); const ex = cx + sd * (9 + r() * 4); R.cap(cx + sd * 3, y0, ex, y0 + 1, 3.4, 3.2, col); R.cap(ex, y0 + 1, ex + sd * 0.6, y0 - up, 3.3, 2.6, col); for (let k = 2; k < up; k += 3) R.px(ex + sd * 0.6 - 1, y0 - k, dark, 1); if (mut) glowDot(R, ex + sd * 0.6, y0 - up - 1.5, 1.8, GLOWS[(r() * 5) | 0]); else if (r() < 0.5) { R.ell(ex + sd * 0.6, y0 - up - 1.6, 2, 1.6, '#e8548a'); } };
    if (r() < 0.9) arm(-1, GY - H * (0.4 + r() * 0.2), 0, 10 + r() * 10);
    R.group(); R.cap(cx, GY - 1, cx, GY - H, 5.2, 4.2, col);
    for (const dx of [-2.4, 0.2, 2.6]) for (let y = GY - 3; y > GY - H; y -= 1) if (((y | 0) + (dx > 0 ? 1 : 0)) % 4) R.px(cx + dx, y, dark, 1);          // ribs
    for (let y = GY - 5; y > GY - H + 2; y -= 5) { R.px(cx - 5.6, y, '#e8e0c0', 4); R.px(cx + 5, y + 2, '#e8e0c0', 3); }                                // spines
    if (r() < 0.9) arm(1, GY - H * (0.5 + r() * 0.2), 0, 8 + r() * 12);
    if (mut) { R.group(true); for (let k = 0; k < 4; k++) glowDot(R, cx + (r() - 0.5) * 6, GY - 6 - r() * (H - 12), 1.3 + r(), GLOWS[(r() * 5) | 0]); glowDot(R, cx, GY - H - 2, 2.6, '#ff5a9a'); }
    else { R.group(); for (let k = 0; k < 3; k++) R.ell(cx - 3 + k * 3, GY - H - 2.4 + (k === 1 ? -1 : 0), 2.2, 1.8, k === 1 ? '#ffd040' : '#f06a9a'); }
    return H;
  },
  pear(R, r, v) {
    const col = v === 2 ? '#3f9488' : GREENS[(r() * 3) | 0], pads = []; let top = 0;
    const pad = (x, y, rx, ry, rot, depth) => { R.group(); R.ell(x, y, rx, ry, col, { rot }); for (let k = 0; k < 5; k++) { const a = r() * 6.28, q = r() * 0.7; R.px(x + Math.cos(a) * rx * q, y + Math.sin(a) * ry * q, '#e8e0c0', 4); } top = Math.max(top, GY - (y - ry)); if (depth < 2) for (const sd of [-1, 1]) if (r() < 0.75) pad(x + sd * rx * (0.5 + r() * 0.4), y - ry * (1.1 + r() * 0.4), rx * 0.78, ry * 0.8, rot + sd * (20 + r() * 25), depth + 1); else if (r() < 0.6) { R.group(); R.ell(x + sd * rx * 0.4, y - ry - 1.5, 2, 2.2, v === 2 ? GLOWS[(r() * 5) | 0] : '#d8405a', { bias: 0.15 }); } };
    pad(32, GY - 9, 8.5, 10, (r() - 0.5) * 20, 0); return top + 3;
  },
  deadbush(R, r, v) {
    const col = ['#6a5238', '#7a6248', '#5a4630'][v], cx = 32; let top = 0;
    const br = (x, y, ang, len, w, d) => { const ex = x + Math.cos(ang) * len, ey = y + Math.sin(ang) * len; R.cap(x, y, ex, ey, w, Math.max(0.5, w * 0.6), col); top = Math.max(top, GY - ey); if (d < 3) { const n = 2 + (r() < 0.4 ? 1 : 0); for (let k = 0; k < n; k++) br(ex, ey, ang + (k - (n - 1) / 2) * (0.7 + r() * 0.3) + (r() - 0.5) * 0.3, len * (0.62 + r() * 0.2), w * 0.62, d + 1); } else if (v === 1 && r() < 0.5) R.px(ex, ey - 1, '#c8a04a', 3); };
    R.group(); for (const a of [-1.9, -1.55, -1.2]) br(cx + (a + 1.55) * 6, GY - 1, a + (r() - 0.5) * 0.3, 9 + r() * 5, 1.5, 0);
    return top + 2;
  },
  shrooms(R, r, v) {
    const glow = GLOWS[(v + ((r() * 2) | 0)) % 5], capC = ['#b85a8a', '#6a58c0', '#c88a3a'][v], n = 3 + ((r() * 3) | 0); let top = 0;
    const list = Array.from({ length: n }, (_, i) => ({ x: 14 + (36 / (n - 1 || 1)) * i + (r() - 0.5) * 5, h: 10 + r() * 22, w: 5 + r() * 6 })).sort((a, b) => b.h - a.h);
    for (const m of list) {
      R.group(); const lean = (r() - 0.5) * 6; stem(R, bez([m.x, GY - 1], [m.x + lean, GY - m.h * 0.5], [m.x + lean * 0.6, GY - m.h]), 1.9, 1.4, '#d8ccb0');
      R.group(); const tx = m.x + lean * 0.6, ty = GY - m.h; R.ell(tx, ty, m.w, m.w * 0.62, capC, { clip: (x, y) => y <= ty + 1.2 }); R.ell(tx, ty + 1.4, m.w * 0.86, 1.3, mix(capC, '#20101c', 0.55), {});
      R.group(true); for (let k = 0; k < 3 + m.w / 3; k++) { const a = Math.PI + r() * Math.PI; glowDot(R, tx + Math.cos(a) * m.w * 0.65 * r(), ty + Math.sin(a) * m.w * 0.42 * r() - 0.6, 0.8 + r() * 0.8, glow); }
      R.rect(tx - m.w * 0.6, ty + 2.6, m.w * 1.2, 1, glow, (i) => (i % 2 ? 3 : 4)); top = Math.max(top, m.h + m.w * 0.62);
    }
    return top + 2;
  },
  flower(R, r, v) {
    const pc = ['#ff4aa0', '#ffd040', '#60d8ff'][v], cx = 32, H = 38 + r() * 18, lean = (r() - 0.5) * 14, st = bez([cx, GY - 1], [cx + lean, GY - H * 0.55], [cx + lean * 0.4, GY - H], 8);
    R.group(); stem(R, st, 2.1, 1.5, '#4f7a3a'); for (const [i, sd] of [[2, -1], [4, 1], [5, -1]]) { const [x, y] = st[i]; R.group(); R.ell(x + sd * 5.5, y + 1, 5.6, 2.2, '#5c8a46', { rot: sd * -24 }); R.line(x + sd * 1, y + 1.4, x + sd * 9, y - 1, '#2e4a22', 1); }
    for (let k = 0; k < 4; k++) R.px(st[3][0] + (k % 2 ? 2 : -2), st[3][1] - k * 3, '#c8d8a0', 4);                                                       // thorns
    const [tx, ty] = st[st.length - 1], np = 7 + ((r() * 3) | 0);
    for (let k = 0; k < np; k++) { const a = k / np * 6.283 + 0.3; R.group(); R.ell(tx + Math.cos(a) * 7, ty + Math.sin(a) * 6.2, 5.2, 2.6, k % 2 ? pc : mix(pc, '#ffffff', 0.25), { rot: a / D2R }); }
    R.group(); R.ell(tx, ty, 4.6, 4.2, '#3a2416'); R.group(true); R.ell(tx, ty, 2.8, 2.2, '#f4e8c0', { bias: 0.3 }); R.ell(tx + 0.4, ty, 1.3, 1.9, '#141018'); R.px(tx - 0.6, ty - 1, '#ffffff', 4);   // the eye
    return H + 9;
  },
  reeds(R, r, v) {
    const col = ['#7ab040', '#9ac850', '#4f9a3a'][v], n = 6 + ((r() * 4) | 0); let top = 0;
    for (let k = 0; k < n; k++) { const x = 18 + r() * 28, h = 22 + r() * 34, lean = (r() - 0.5) * 12; R.group(); const pts = bez([x, GY - 1], [x + lean * 0.3, GY - h * 0.6], [x + lean, GY - h], 6); stem(R, pts, 1.1, 0.7, col); if (r() < 0.55) { const [tx, ty] = pts[5]; R.group(); R.cap(tx, ty + 2, tx + lean * 0.12, ty - 4, 1.9, 1.7, v === 1 ? '#6a4a2a' : '#5a3a22'); if (v === 2) { R.group(true); glowDot(R, tx + lean * 0.12, ty - 5.5, 1.4, '#8fff40'); } } top = Math.max(top, h); }
    return top + 3;
  },
  grass(R, r, v) {
    const col = ['#b89a54', '#9a8e4a', '#7a8e48'][v]; let top = 0;
    for (let k = 0; k < 11; k++) { const x = 20 + r() * 24, h = 8 + r() * 16, lean = (r() - 0.5) * 16; R.group(k % 2 === 0); stem(R, bez([x, GY - 1], [x + lean * 0.2, GY - h * 0.7], [x + lean, GY - h], 4), 1.0, 0.5, k % 3 ? col : mix(col, '#3a3018', 0.35)); top = Math.max(top, h); }
    if (v === 2) { R.group(true); for (let k = 0; k < 3; k++) R.px(22 + r() * 20, GY - 8 - r() * 10, '#f0e080', 4); }
    return top + 2;
  },
  vine(R, r, v) {
    const col = ['#6a3f7a', '#3f6a5a', '#7a3a3a'][v], glow = GLOWS[(v + 2) % 5], n = 3 + ((r() * 2) | 0); let top = 0;
    for (let k = 0; k < n; k++) { const x = 22 + k * (20 / n) + r() * 3, h = 24 + r() * 30, sd = k % 2 ? 1 : -1, c1 = [x + sd * (8 + r() * 8), GY - h * 0.55], tip = [x - sd * (2 + r() * 8), GY - h]; const pts = bez([x, GY - 1], c1, tip, 9);
      R.group(); stem(R, pts, 3.0, 0.8, col); for (let i = 2; i < 9; i += 2) { const [px, py] = pts[i]; R.cap(px, py, px + sd * 3.2, py - 2.2, 0.9, 0.3, '#d8ccae'); }            // thorns
      R.group(true); for (let i = 3; i < 9; i += 3) glowDot(R, pts[i][0] - sd * 0.8, pts[i][1], 1.0, glow); top = Math.max(top, h); }
    return top + 3;
  },
  pod(R, r, v) {
    const col = ['#8a6a8a', '#6a8a5a', '#9a7a4a'][v], glow = GLOWS[(v + 1) % 5], cx = 32, rx = 11 + r() * 4, ry = 13 + r() * 5, cy = GY - ry - 4;
    R.group(); for (const sd of [-1, 1, -0.4, 0.5]) stem(R, bez([cx + sd * 4, GY - 4], [cx + sd * 12, GY - 6], [cx + sd * 17, GY - 1], 4), 1.8, 0.8, mix(col, '#2a1c20', 0.4));   // roots
    R.group(); R.ell(cx, cy, rx, ry, col); for (let k = -2; k <= 2; k++) for (let y = cy - ry + 3; y < cy + ry - 2; y += 1) { const w = Math.sqrt(Math.max(0, 1 - ((y - cy) / ry) ** 2)); if ((y | 0) % 3) R.px(cx + k * rx * 0.36 * w, y, mix(col, '#1a1014', 0.5), 1); }
    R.group(true); R.ell(cx, cy, 2.2, ry * 0.55, glow, { bias: 0.3 }); R.ell(cx, cy, 0.9, ry * 0.42, mix(glow, '#ffffff', 0.8), { bias: 0.5 });                                     // glowing slit
    R.group(); for (let k = 0; k < 4; k++) { const a = -2.4 + k * 0.55; R.cap(cx + Math.cos(a) * rx * 0.7, cy - ry * 0.8, cx + Math.cos(a) * (rx + 3), cy - ry - 5 - r() * 3, 1.3, 0.4, mix(col, '#e8d8b0', 0.3)); }
    return ry * 2 + 12;
  },
  tree(R, r, v) {
    const col = ['#4a3828', '#5a4634', '#3e3230'][v], cx = 30 + r() * 4; let top = 0;
    const br = (x, y, ang, len, w, d) => { const mx = x + Math.cos(ang) * len * 0.5 + (r() - 0.5) * 3, my = y + Math.sin(ang) * len * 0.5, ex = x + Math.cos(ang) * len, ey = y + Math.sin(ang) * len; R.cap(x, y, mx, my, w, w * 0.85, col); R.cap(mx, my, ex, ey, w * 0.85, Math.max(0.5, w * 0.6), col); top = Math.max(top, GY - ey);
      if (d < 3 && w > 0.9) { const n = d === 0 ? 3 : 2; for (let k = 0; k < n; k++) br(ex, ey, ang + (k - (n - 1) / 2) * (0.75 + r() * 0.3) + (r() - 0.5) * 0.25, len * (0.6 + r() * 0.15), w * 0.6, d + 1); } else if (v === 1 && r() < 0.6) { R.ell(ex, ey + 2, 1.6, 2.4, '#8fd14f', { bias: 0.1 }); } };
    R.group(); R.cap(cx - 3, GY - 1, cx - 7, GY, 2, 1, col); R.cap(cx + 3, GY - 1, cx + 8, GY, 2, 1, col); br(cx, GY - 1, -1.57 + (r() - 0.5) * 0.3, 24 + r() * 6, 4.2, 0);
    for (let y = GY - 4; y > GY - 22; y -= 3) R.px(cx + ((y | 0) % 2 ? -1.5 : 1.5), y, mix(col, '#000000', 0.5), 0);
    if (v === 2) { R.group(true); for (let k = 0; k < 3; k++) glowDot(R, cx + (r() - 0.5) * 5, GY - 8 - r() * 14, 1.2, '#ffb030'); }
    return Math.min(top + 2, GY - 2);
  },
  fern(R, r, v) {
    const col = ['#4a8a4a', '#3f9488', '#8a9a3a'][v], cx = 32; let top = 0;
    for (let k = 0; k < 7; k++) { const a = -2.75 + k * 0.4 + (r() - 0.5) * 0.15, len = 20 + r() * 12, tip = [cx + Math.cos(a) * len, GY - 2 + Math.sin(a) * len * 0.85 + 4], pts = bez([cx, GY - 2], [cx + Math.cos(a) * len * 0.5, GY - 2 + Math.sin(a) * len * 0.9], tip, 7);
      R.group(k % 2 === 1); for (let i = 1; i < 7; i++) { const [x, y] = pts[i], w = 4.2 * Math.sin(i / 7 * Math.PI) + 0.8; R.ell(x, y, w * 0.55, w, k % 2 ? mix(col, '#102010', 0.25) : col, { rot: a / D2R + 90 }); } stem(R, pts, 0.8, 0.4, mix(col, '#1a2a12', 0.45)); top = Math.max(top, GY - Math.min(...pts.map(p => p[1])) + 3); }
    if (v !== 0) { R.group(true); for (let k = 0; k < 4; k++) glowDot(R, cx + (r() - 0.5) * 22, GY - 8 - r() * 14, 0.9, v === 1 ? '#40ffc8' : '#ffe050'); }
    return top + 2;
  },
  crystal(R, r, v) {
    const col = ['#7ad0e8', '#c890f0', '#e8d890'][v], n = 4 + ((r() * 3) | 0); let top = 0;
    for (let k = 0; k < n; k++) { const x = 22 + r() * 20, h = 10 + r() * 26, w = 2.4 + r() * 3, lean = (r() - 0.5) * 10; R.group(); R.poly([[x - w, GY - 1], [x + w, GY - 1], [x + w * 0.7 + lean, GY - h * 0.8], [x + lean, GY - h], [x - w * 0.7 + lean, GY - h * 0.75]], k % 2 ? col : mix(col, '#203040', 0.3)); R.line(x + lean * 0.5 - w * 0.3, GY - 3, x + lean - 0.3, GY - h + 1, '#ffffff', 4); top = Math.max(top, h); }
    R.group(true); glowDot(R, 32, GY - 3, 1.4, col);
    return top + 2;
  },
};
const GLOW_TYPES = new Set(['shrooms', 'pod', 'crystal']);

let ATLAS = null;
export function buildFloraAtlas() {
  if (ATLAS) return ATLAS;
  const cols = VARS, rows = FLORA_TYPES.length, c = document.createElement('canvas'); c.width = CW * cols; c.height = CH * rows;
  const g = c.getContext('2d'), cells = [];
  FLORA_TYPES.forEach((type, row) => {
    for (let v = 0; v < VARS; v++) {
      const R = new Raster(CW, CH), r = rnd(row * 977 + v * 131 + 17);
      let hpx = 40; try { hpx = DRAW[type](R, r, v) || 40; } catch (e) { console.warn('flora', type, e); }
      const img = g.createImageData(CW, CH); R.blit(img, 0, 0); g.putImageData(img, v * CW, row * CH);
      cells.push({ type, variant: v, col: v, row, hpx: Math.min(GY, hpx), glow: GLOW_TYPES.has(type) || v === 2 });
    }
  });
  return (ATLAS = { canvas: c, cw: CW, ch: CH, gy: GY, cols, rows, cells });
}
