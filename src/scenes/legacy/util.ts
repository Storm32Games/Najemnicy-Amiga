// @ts-nocheck
// Kod przeniesiony 1:1 z Oldgame/src/gfx/util.js (rysowanie na płótnie 2D, bez Three.js). Nie jest sprawdzany typami.
// Shared helpers: hashing, seeded RNG, color math, canvas painter, texture creation.

export const hash = (s) => { s = String(s); let h = 2166136261 >>> 0; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
export function rng(seed) {
  let a = (typeof seed === 'number' ? seed : hash(seed)) >>> 0;
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;

export function parseHex(c) {
  if (Array.isArray(c)) return c;
  if (typeof c === 'number') return [(c >> 16) & 255, (c >> 8) & 255, c & 255];
  c = String(c).replace('#', '');
  if (c.length === 3) c = c.split('').map(x => x + x).join('');
  const n = parseInt(c, 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export const toHex = (r, g, b) => '#' + [r, g, b].map(v => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');
export function shade(c, f) { const [r, g, b] = parseHex(c); return f >= 1 ? toHex(r + (255 - r) * (f - 1) * 0.6 + r * 0 , g + (255 - g) * (f - 1) * 0.6, b + (255 - b) * (f - 1) * 0.6) : toHex(r * f, g * f, b * f); }
export function mix(a, b, t) { const A = parseHex(a), B = parseHex(b); return toHex(lerp(A[0], B[0], t), lerp(A[1], B[1], t), lerp(A[2], B[2], t)); }
// 5-tone ramp from base: [deep, shadow, base, light, hi]
export function ramp(c) { return [mix(shade(c, 0.45), '#1a1028', 0.25), shade(c, 0.7), c, shade(c, 1.35), shade(c, 1.8)]; }

export function mkCanvas(w, h) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true }); g.imageSmoothingEnabled = false;
  return [c, g];
}

/** Pixel painter on top of a 2D context. */
export class Pix {
  constructor(g) { this.g = g; }
  px(x, y, c) { this.g.fillStyle = c; this.g.fillRect(Math.round(x), Math.round(y), 1, 1); }
  r(x, y, w, h, c) { this.g.fillStyle = c; this.g.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); }
  line(x0, y0, x1, y1, c, t = 1) {
    x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1; let e = dx + dy;
    this.g.fillStyle = c; const o = -(t >> 1);
    for (let i = 0; i < 400; i++) {
      this.g.fillRect(x0 + o, y0 + o, t, t);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * e; if (e2 >= dy) { e += dy; x0 += sx; } if (e2 <= dx) { e += dx; y0 += sy; }
    }
  }
  ell(cx, cy, rx, ry, c) {
    for (let y = -ry; y <= ry; y++) { const w = Math.round(rx * Math.sqrt(Math.max(0, 1 - (y * y) / (ry * ry + 0.0001)))); this.g.fillStyle = c; this.g.fillRect(Math.round(cx - w), Math.round(cy + y), w * 2 + 1, 1); }
  }
  clear() { this.g.clearRect(0, 0, this.g.canvas.width, this.g.canvas.height); }
}

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
export const bayer = (x, y) => (BAYER4[((y & 3) << 2) | (x & 3)] + 0.5) / 16;

/** Shaded ellipsoid with banded + dithered lighting (pixel-art sphere shading). */
export function shadedEllipse(g, cx, cy, rx, ry, base, o = {}) {
  const lx = o.lx ?? -0.55, ly = o.ly ?? -0.6, lz = 0.58, rm = ramp(base), tones = o.tones || [1, 2, 3, 4];
  const rim = o.rim; // optional rim color (right side)
  const id = g.getImageData(0, 0, g.canvas.width, g.canvas.height); const W = id.width;
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
    const nx = (x + 0.5 - cx) / rx, ny = (y + 0.5 - cy) / ry, d = nx * nx + ny * ny; if (d > 1 || x < 0 || y < 0 || x >= W || y >= id.height) continue;
    const nz = Math.sqrt(1 - d); let l = nx * lx + ny * ly + nz * lz; l = clamp(l * 0.9 + 0.25, 0, 1.2);
    let t = l * 3 + (bayer(x, y) - 0.5) * 0.9; let k = clamp(Math.round(t) + 0, 0, 4);
    let col = rm[k]; if (rim && nx > 0.6 && ny < 0.5 && nz < 0.7) col = rim;
    const [r, gg, b] = parseHex(col); const i = (y * W + x) * 4; id.data[i] = r; id.data[i + 1] = gg; id.data[i + 2] = b; id.data[i + 3] = 255;
  }
  g.putImageData(id, 0, 0);
}

/** Binarize alpha + draw 1px outline around opaque pixels in region. */
export function outlineRegion(g, x0, y0, w, h, col = '#140d0a', inner = null) {
  const id = g.getImageData(x0, y0, w, h), d = id.data, [or, og, ob] = parseHex(col);
  const op = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) { if (d[i * 4 + 3] > 110) { op[i] = 1; d[i * 4 + 3] = 255; } else { d[i * 4 + 3] = 0; } }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x; if (op[i]) continue;
    if ((x > 0 && op[i - 1]) || (x < w - 1 && op[i + 1]) || (y > 0 && op[i - w]) || (y < h - 1 && op[i + w])) { d[i * 4] = or; d[i * 4 + 1] = og; d[i * 4 + 2] = ob; d[i * 4 + 3] = 255; }
  }
  g.putImageData(id, x0, y0);
}

// scale a canvas to size with nearest neighbour
export function scaleCanvas(src, size) {
  if (src.width === size) return src;
  const [c, g] = mkCanvas(size, size); g.imageSmoothingEnabled = false; g.drawImage(src, 0, 0, size, size); return c;
}

export const PALETTE = {
  void: '#0d0a09', soot: '#1a1410', rust: '#b4532a', rustDark: '#6e2f18', amber: '#f2a93b', gold: '#ffd24a', sand: '#c9a468', sandDark: '#8a6c42',
  dust: '#a8906a', concrete: '#7d766b', concreteDark: '#4d4842', steel: '#7f9aa8', steelDark: '#3e4d57', toxic: '#8fd14f', toxicDark: '#3f7a2a',
  blood: '#c43d2f', bloodDark: '#7a1d17', bone: '#e6dcc0', skin: '#d9a07a', cloth: '#6b5a3a', olive: '#5d6a3a', white: '#f2ecde', glass: '#3a566a', neon: '#46f2c8', fire: '#ff7a1e',
};
