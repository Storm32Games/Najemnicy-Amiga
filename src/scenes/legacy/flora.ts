// @ts-nocheck
// Roślinność pustkowi dla mapy taktycznej - port Oldgame/src/gfx/flora.js (ten sam rasteryzator raster.js: rampy
// materiałów, światło z lewej-góry, selektywne obrysy), przerysowany natywnie w skali rzutu izometrycznego (pole 32x16),
// bo pomniejszanie komórek 64x80 gubiłoby detale. Gatunki: saguaro, pear (opuncja), deadbush, shrooms, flower, reeds,
// grass, vine, pod, fern, crystal. Każdy ma 3 warianty (2 = zmutowany / świecący).
import { Raster } from './raster';
import { mix } from './util';

export const FLORA_TYPES = ['saguaro', 'pear', 'deadbush', 'shrooms', 'flower', 'reeds', 'grass', 'vine', 'pod', 'fern', 'crystal'];
const CW = 32, CH = 40, GY = 37, CX = 16;

const rnd = (seed) => { let s = seed >>> 0 || 1; return () => ((s = Math.imul(s ^ (s >>> 15), 2246822519) + 0x9e3779b9 >>> 0) / 4294967296); };
const GREENS = ['#4f7f3c', '#5c8a46', '#3f6e3a'], MUT = ['#7a5aa6', '#3f9488', '#a08a3a'], GLOWS = ['#8fff40', '#40ffc8', '#e070ff', '#ffb030', '#ff5a9a'];
const bez = (p0, p1, p2, n = 6) => Array.from({ length: n + 1 }, (_, i) => { const t = i / n, u = 1 - t; return [u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0], u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]]; });
/** cienka łodyga (1 px) wzdłuż punktów */
function thin(R, pts, col, s = 2) { for (let i = 0; i + 1 < pts.length; i++) R.line(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], col, s); return pts[pts.length - 1]; }
function stem(R, pts, r0, r1, col) { const n = pts.length - 1; for (let i = 0; i < n; i++) R.cap(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], r0 + (r1 - r0) * i / n, r0 + (r1 - r0) * (i + 1) / n, col); return pts[n]; }
function glow(R, x, y, col) { R.px(x, y, col, 3); }
function glowBig(R, x, y, col) { R.px(x, y, mix(col, '#ffffff', 0.7), 4); R.px(x + 1, y, col, 3); R.px(x, y + 1, col, 3); R.px(x - 1, y, col, 2); R.px(x, y - 1, col, 3); }

const DRAW = {
  saguaro(R, r, v) {
    const mut = v === 2, col = mut ? MUT[(r() * 3) | 0] : GREENS[(r() * 3) | 0], dark = mix(col, '#10180c', 0.45), H = 17 + r() * 8;
    const arm = (sd, y0, up) => { R.group(); const ex = CX + sd * (5 + ((r() * 2) | 0)); R.cap(CX + sd * 1.5, y0, ex, y0, 1.5, 1.4, col); R.cap(ex, y0, ex, y0 - up, 1.5, 1.2, col); R.px(ex + sd, y0 - up * 0.5, '#e8e0c0', 4); if (mut) glow(R, ex, y0 - up - 2, GLOWS[(r() * 5) | 0]); else if (r() < 0.5) R.px(ex, y0 - up - 2, '#e8548a', 3); };
    if (r() < 0.9) arm(-1, GY - H * (0.4 + r() * 0.2), 4 + r() * 4);
    R.group(); R.cap(CX, GY - 2, CX, GY - H, 2.4, 2.1, col);
    for (let y = GY - 3; y > GY - H; y -= 2) R.px(CX + 0.6, y, dark, 1);                                         // żebro
    for (let y = GY - 4; y > GY - H + 1; y -= 4) { R.px(CX - 2.6, y, '#e8e0c0', 4); R.px(CX + 2.6, y + 2, '#e8e0c0', 3); } // kolce
    if (r() < 0.9) arm(1, GY - H * (0.5 + r() * 0.2), 4 + r() * 5);
    R.group(true);
    if (mut) { for (let k = 0; k < 3; k++) glow(R, CX + (r() - 0.5) * 3, GY - 4 - r() * (H - 8), GLOWS[(r() * 5) | 0]); glowBig(R, CX, GY - H - 3, '#ff5a9a'); }
    else { R.px(CX - 1, GY - H - 3, '#f06a9a', 3); R.px(CX + 1, GY - H - 3, '#f06a9a', 3); R.px(CX, GY - H - 4, '#ffd040', 4); }
  },
  pear(R, r, v) {
    const col = v === 2 ? '#3f9488' : GREENS[(r() * 3) | 0];
    const pad = (x, y, rx, ry, rot, depth) => {
      R.group(); R.ell(x, y, rx, ry, col, { rot });
      for (let k = 0; k < 3; k++) { const a = r() * 6.28, q = r() * 0.6; R.px(x + Math.cos(a) * rx * q, y + Math.sin(a) * ry * q, '#e8e0c0', 4); }
      if (depth < 2) for (const sd of [-1, 1]) {
        if (r() < 0.75) pad(x + sd * rx * (0.5 + r() * 0.4), y - ry * (1.1 + r() * 0.4), Math.max(1.6, rx * 0.78), Math.max(1.8, ry * 0.8), rot + sd * (20 + r() * 25), depth + 1);
        else if (r() < 0.6) { R.group(true); R.px(x + sd * rx * 0.4, y - ry - 1, v === 2 ? GLOWS[(r() * 5) | 0] : '#d8405a', 3); }
      }
    };
    pad(CX, GY - 5, 3.6, 4.4, (r() - 0.5) * 20, 0);
  },
  deadbush(R, r, v) {
    const col = ['#6a5238', '#7a6248', '#5a4630'][v];
    const br = (x, y, ang, len, d) => { const ex = x + Math.cos(ang) * len, ey = y + Math.sin(ang) * len; if (d === 0) R.cap(x, y, ex, ey, 0.9, 0.6, col); else R.line(x, y, ex, ey, col, d > 1 ? 3 : 2); if (d < 3) { const n = 2 + (r() < 0.4 ? 1 : 0); for (let k = 0; k < n; k++) br(ex, ey, ang + (k - (n - 1) / 2) * (0.7 + r() * 0.3) + (r() - 0.5) * 0.3, len * (0.66 + r() * 0.2), d + 1); } else if (v === 1 && r() < 0.5) R.px(ex, ey - 1, '#c8a04a', 3); };
    R.group(); for (const a of [-1.95, -1.55, -1.15]) br(CX + (a + 1.55) * 3, GY - 1, a + (r() - 0.5) * 0.3, 4.5 + r() * 2.5, 0);
  },
  shrooms(R, r, v) {
    const gl = GLOWS[(v + ((r() * 2) | 0)) % 5], capC = ['#b85a8a', '#6a58c0', '#c88a3a'][v], n = 2 + ((r() * 3) | 0);
    const list = Array.from({ length: n }, (_, i) => ({ x: CX - 7 + (14 / (n - 1 || 1)) * i + (r() - 0.5) * 2, h: 4 + r() * 9, w: 2.2 + r() * 2.4 })).sort((a, b) => b.h - a.h);
    for (const m of list) {
      const lean = (r() - 0.5) * 3, tx = m.x + lean * 0.6, ty = GY - m.h;
      R.group(); stem(R, bez([m.x, GY - 1], [m.x + lean, GY - m.h * 0.5], [tx, ty], 4), 0.9, 0.7, '#d8ccb0');
      R.group(); R.ell(tx, ty, m.w, Math.max(1.4, m.w * 0.66), capC, { clip: (x, y) => y <= ty + 0.6 });
      R.rect(Math.round(tx - m.w * 0.7), Math.round(ty + 1), Math.max(2, Math.round(m.w * 1.4)), 1, mix(capC, '#20101c', 0.55), 1);
      R.group(true); for (let k = 0; k < 1 + m.w / 2; k++) { const a = Math.PI + r() * Math.PI; glow(R, tx + Math.cos(a) * m.w * 0.6 * r(), ty + Math.sin(a) * m.w * 0.4 * r() - 0.4, gl); }
      R.px(tx, ty + 1, gl, 4);
    }
  },
  flower(R, r, v) {
    const pc = ['#ff4aa0', '#ffd040', '#60d8ff'][v], H = 14 + r() * 7, lean = (r() - 0.5) * 6, st = bez([CX, GY - 1], [CX + lean, GY - H * 0.55], [CX + lean * 0.4, GY - H], 6);
    R.group(); stem(R, st, 0.9, 0.7, '#4f7a3a');
    for (const [i, sd] of [[1, -1], [3, 1]]) { const [x, y] = st[i]; R.group(); R.ell(x + sd * 2.4, y + 0.5, 2.4, 1.1, '#5c8a46', { rot: sd * -24 }); }
    const [tx, ty] = st[st.length - 1], np = 6;
    for (let k = 0; k < np; k++) { const a = k / np * 6.283 + 0.3; R.group(); R.ell(tx + Math.cos(a) * 3, ty + Math.sin(a) * 2.7, 2, 1.3, k % 2 ? pc : mix(pc, '#ffffff', 0.25), { rot: a * 57.3 }); }
    R.group(); R.ell(tx, ty, 2, 1.9, '#3a2416'); R.group(true); R.px(tx, ty, '#f4e8c0', 4); R.px(tx + 1, ty, '#141018', 1); R.px(tx - 1, ty - 1, '#ffffff', 4);   // oko
  },
  reeds(R, r, v) {
    const col = ['#7ab040', '#9ac850', '#4f9a3a'][v], n = 5 + ((r() * 4) | 0);
    for (let k = 0; k < n; k++) {
      const x = CX - 6 + r() * 12, h = 9 + r() * 14, lean = (r() - 0.5) * 5; R.group(k % 2 === 0);
      const pts = bez([x, GY - 1], [x + lean * 0.3, GY - h * 0.6], [x + lean, GY - h], 5); thin(R, pts, k % 3 ? col : mix(col, '#1a2a12', 0.35), k % 2 ? 3 : 2);
      if (r() < 0.55) { const [tx, ty] = pts[4]; R.group(); R.cap(tx, ty + 1, tx + lean * 0.1, ty - 2, 0.9, 0.8, v === 1 ? '#6a4a2a' : '#5a3a22'); if (v === 2) { R.group(true); glow(R, tx + lean * 0.1, ty - 4, '#8fff40'); } }
    }
  },
  grass(R, r, v) {
    const col = ['#b89a54', '#9a8e4a', '#7a8e48'][v];
    for (let k = 0; k < 10; k++) { const x = CX - 6 + r() * 12, h = 3 + r() * 7, lean = (r() - 0.5) * 7; R.group(true); thin(R, bez([x, GY - 1], [x + lean * 0.2, GY - h * 0.7], [x + lean, GY - h], 3), k % 3 ? col : mix(col, '#3a3018', 0.35), k % 3 === 1 ? 3 : 2); }
    if (v === 2) { R.group(true); for (let k = 0; k < 3; k++) R.px(CX - 5 + r() * 10, GY - 4 - r() * 5, '#f0e080', 4); }
  },
  vine(R, r, v) {
    const col = ['#6a3f7a', '#3f6a5a', '#7a3a3a'][v], gl = GLOWS[(v + 2) % 5], n = 2 + ((r() * 2) | 0);
    for (let k = 0; k < n; k++) {
      const x = CX - 4 + k * (9 / n) + r() * 1.5, h = 10 + r() * 13, sd = k % 2 ? 1 : -1, c1 = [x + sd * (4 + r() * 4), GY - h * 0.55], tip = [x - sd * (1 + r() * 4), GY - h], pts = bez([x, GY - 1], c1, tip, 8);
      R.group(); stem(R, pts, 1.4, 0.55, col); for (let i = 2; i < 8; i += 2) { const [px, py] = pts[i]; R.px(px + sd * 2, py - 1, '#d8ccae', 3); }   // kolce
      R.group(true); for (let i = 3; i < 8; i += 3) glow(R, pts[i][0], pts[i][1], gl);
    }
  },
  pod(R, r, v) {
    const col = ['#8a6a8a', '#6a8a5a', '#9a7a4a'][v], gl = GLOWS[(v + 1) % 5], rx = 4.6 + r() * 1.6, ry = 5.6 + r() * 2, cy = GY - ry - 2;
    R.group(); for (const sd of [-1, 1, -0.4, 0.5]) thin(R, bez([CX + sd * 2, GY - 2], [CX + sd * 5, GY - 3], [CX + sd * 8, GY - 1], 3), mix(col, '#2a1c20', 0.4), 1);   // korzenie
    R.group(); R.ell(CX, cy, rx, ry, col);
    for (const k of [-1, 1]) for (let y = cy - ry + 2; y < cy + ry - 1; y += 1) { const w = Math.sqrt(Math.max(0, 1 - ((y - cy) / ry) ** 2)); if ((y | 0) % 3) R.px(CX + k * rx * 0.55 * w, y, mix(col, '#1a1014', 0.5), 1); }
    R.group(true); for (let y = Math.round(cy - ry * 0.5); y <= cy + ry * 0.5; y++) R.px(CX, y, Math.abs(y - cy) < ry * 0.25 ? mix(gl, '#ffffff', 0.7) : gl, 3);       // świecąca szczelina
    R.group(); for (let k = 0; k < 3; k++) { const a = -2.2 + k * 0.65; R.line(CX + Math.cos(a) * rx * 0.7, cy - ry * 0.8, CX + Math.cos(a) * (rx + 1.5), cy - ry - 2 - r() * 2, mix(col, '#e8d8b0', 0.3), 3); }
  },
  fern(R, r, v) {
    const col = ['#4a8a4a', '#3f9488', '#8a9a3a'][v];
    for (let k = 0; k < 6; k++) {
      const a = -2.7 + k * 0.45 + (r() - 0.5) * 0.15, len = 8 + r() * 6, tip = [CX + Math.cos(a) * len, GY - 1 + Math.sin(a) * len * 0.85 + 2], pts = bez([CX, GY - 1], [CX + Math.cos(a) * len * 0.5, GY - 1 + Math.sin(a) * len * 0.9], tip, 6);
      R.group(k % 2 === 1); const c = k % 2 ? mix(col, '#102010', 0.25) : col;
      for (let i = 1; i < 6; i++) { const [x, y] = pts[i], w = 1.9 * Math.sin(i / 6 * Math.PI) + 0.5; R.ell(x, y, Math.max(0.6, w * 0.5), w, c, { rot: a * 57.3 + 90 }); }
      thin(R, pts, mix(col, '#1a2a12', 0.45), 1);
    }
    if (v !== 0) { R.group(true); for (let k = 0; k < 3; k++) glow(R, CX + (r() - 0.5) * 10, GY - 4 - r() * 6, v === 1 ? '#40ffc8' : '#ffe050'); }
  },
  crystal(R, r, v) {
    const col = ['#7ad0e8', '#c890f0', '#e8d890'][v], n = 3 + ((r() * 3) | 0);
    const list = Array.from({ length: n }, () => ({ x: CX - 5 + r() * 10, h: 5 + r() * 11, w: 1.3 + r() * 1.4, lean: (r() - 0.5) * 4 })).sort((a, b) => b.h - a.h);
    list.forEach(({ x, h, w, lean }, k) => { R.group(); R.poly([[x - w, GY - 1], [x + w, GY - 1], [x + w * 0.7 + lean, GY - h * 0.8], [x + lean, GY - h], [x - w * 0.7 + lean, GY - h * 0.75]], k % 2 ? col : mix(col, '#203040', 0.3)); R.line(x + lean * 0.5 - w * 0.4, GY - 2, x + lean - 0.3, GY - h + 1, '#ffffff', 4); });
    R.group(true); glow(R, CX, GY - 1, col);
  },
};

const CACHE = new Map();
/** Roślina jako piksele RGBA: { w, h, data, bx, by } - (bx, by) = punkt podstawy (stoi na ziemi). */
export function floraPixels(type, variant = 0) {
  const key = type + ':' + variant; let hit = CACHE.get(key);
  if (!hit) {
    const R = new Raster(CW, CH), row = Math.max(0, FLORA_TYPES.indexOf(type)), v = ((variant % 3) + 3) % 3;
    (DRAW[type] || DRAW.grass)(R, rnd(row * 977 + v * 131 + 17), v);
    const img = { width: CW, height: CH, data: new Uint8ClampedArray(CW * CH * 4) };
    R.blit(img, 0, 0);
    hit = { w: CW, h: CH, data: img.data, bx: CX, by: GY }; CACHE.set(key, hit);
  }
  return hit;
}
