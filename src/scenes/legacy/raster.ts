// @ts-nocheck
// Kod przeniesiony 1:1 z Oldgame/src/gfx/raster.js (rysowanie na płótnie 2D, bez Three.js). Nie jest sprawdzany typami.
// raster.js — shared pixel rasteriser for procedural sprites (extracted from hero.js 2026-11-13).
// Primitives write per-pixel ramp id + shade index (0..4) + group id; blit() resolves colours and draws selective outlines.
import { shade, mix, parseHex, bayer, clamp } from './util';
export const D2R = Math.PI / 180;

// ---------------------------------------------------------------- colour ramps
// 5 tones with hue shift: shadows drift to cold purple, highlights to warm cream (classic pixel-art ramps).
export function makeRamp(c) {
  return [mix(shade(c, 0.34), '#1c1228', 0.35), mix(shade(c, 0.62), '#2e2440', 0.18), c, mix(shade(c, 1.22), '#fff0c8', 0.12), mix(shade(c, 1.5), '#fff8e0', 0.3)].map(parseHex);
}

export class Raster {
  constructor(w, h) {
    this.w = w; this.h = h;
    this.rp = new Int16Array(w * h).fill(-1); this.sh = new Uint8Array(w * h); this.gr = new Uint8Array(w * h);
    this.ramps = []; this.rampIx = new Map(); this.g = 0; this.noLine = new Set();
  }
  R(c) { let i = this.rampIx.get(c); if (i == null) { i = this.ramps.length; this.ramps.push(makeRamp(c)); this.rampIx.set(c, i); } return i; }
  group(noOutline = false) { this.g++; if (noOutline) this.noLine.add(this.g); return this.g; }
  put(x, y, r, s) {
    x = Math.round(x); y = Math.round(y); if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = y * this.w + x; this.rp[i] = r; this.sh[i] = s; this.gr[i] = this.g;
  }
  q(lum, x, y, dith = 0.12) { return clamp(Math.floor(lum * 5 + (bayer(x, y) - 0.5) * dith), 0, 4); }
  // light: from upper-left (screen), slightly from the front
  static lum(vx, vy, nz, spec = true) {
    const d = -(vx * 0.6 + vy * 0.8);
    let l = 0.33 + 0.36 * d + 0.17 * nz;
    if (spec && d > 0.5 && nz > 0.25) l += 0.12;
    return l;
  }
  /** tapered capsule a->b with radii ra, rb */
  cap(ax, ay, bx, by, ra, rb, col, o = {}) {
    const r = this.R(col), dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy || 1e-6, mr = Math.max(ra, rb) + 1;
    const x0 = Math.floor(Math.min(ax, bx) - mr), x1 = Math.ceil(Math.max(ax, bx) + mr), y0 = Math.floor(Math.min(ay, by) - mr), y1 = Math.ceil(Math.max(ay, by) + mr);
    const flat = o.flat || 0, bias = o.bias || 0;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const px = x + 0.5, py = y + 0.5; let t = ((px - ax) * dx + (py - ay) * dy) / L2;
      if (o.noCap && (t < 0 || t > 1)) continue;
      t = clamp(t, 0, 1);
      const cx = ax + dx * t, cy = ay + dy * t, rr = ra + (rb - ra) * t, vx = (px - cx) / rr, vy = (py - cy) / rr, d2 = vx * vx + vy * vy;
      if (d2 > 1) continue;
      const nz = Math.sqrt(1 - d2);
      let l = Raster.lum(vx * (1 - flat), vy * (1 - flat), nz) + bias;
      this.put(x, y, r, this.q(l, x, y));
    }
  }
  /** ellipse (optionally rotated) with spherical shading */
  ell(cx, cy, rx, ry, col, o = {}) {
    const r = this.R(col), rot = (o.rot || 0) * D2R, c = Math.cos(rot), s = Math.sin(rot), m = Math.max(rx, ry) + 1, bias = o.bias || 0;
    for (let y = Math.floor(cy - m); y <= Math.ceil(cy + m); y++) for (let x = Math.floor(cx - m); x <= Math.ceil(cx + m); x++) {
      const px = x + 0.5 - cx, py = y + 0.5 - cy, u = (px * c + py * s) / rx, v = (-px * s + py * c) / ry, d2 = u * u + v * v;
      if (d2 > 1) continue;
      if (o.clip && !o.clip(x, y)) continue;
      const nz = Math.sqrt(1 - d2), vx = px / Math.max(rx, ry), vy = py / Math.max(rx, ry);
      this.put(x, y, r, this.q(Raster.lum(vx, vy, nz) + bias, x, y));
    }
  }
  /** polygon, cylinder-shaded across its horizontal extent (or flat with o.flat) */
  poly(pts, col, o = {}) {
    const r = this.R(col); let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    for (const [x, y] of pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    const bias = o.bias || 0, cxm = (x0 + x1) / 2, hw = Math.max(1, (x1 - x0) / 2), cym = (y0 + y1) / 2, hh = Math.max(1, (y1 - y0) / 2);
    for (let y = Math.floor(y0); y <= Math.ceil(y1); y++) {
      const py = y + 0.5, xs = [];
      for (let i = 0; i < pts.length; i++) { const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % pts.length]; if ((ay <= py && by > py) || (by <= py && ay > py)) xs.push(ax + (py - ay) * (bx - ax) / (by - ay)); }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) for (let x = Math.ceil(xs[k] - 0.5); x <= Math.floor(xs[k + 1] - 0.5); x++) {
        const vx = (x + 0.5 - cxm) / hw, vy = o.flat ? 0 : (py - cym) / hh * 0.35, nz = Math.sqrt(Math.max(0, 1 - vx * vx * 0.8));
        this.put(x, y, r, this.q(Raster.lum(vx * 0.8, vy, nz, !o.matte) + bias, x, y));
      }
    }
  }
  /** re-colour already drawn pixels (keeps shading) */
  paint(test, col, o = {}) {
    const r = this.R(col), ds = o.ds || 0, groups = o.g ? [].concat(o.g) : null;
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      const i = y * this.w + x; if (this.rp[i] < 0) continue; if (groups && !groups.includes(this.gr[i])) continue;
      if (!test(x, y)) continue;
      this.rp[i] = r; if (ds) this.sh[i] = clamp(this.sh[i] + ds, 0, 4);
    }
  }
  px(x, y, col, s = 2) { this.put(x, y, this.R(col), s); }
  rect(x, y, w, h, col, s = 2) { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.put(x + i, y + j, this.R(col), typeof s === 'function' ? s(i, j) : s); }
  line(x0, y0, x1, y1, col, s = 2) {
    const n = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))));
    for (let k = 0; k <= n; k++) this.put(x0 + (x1 - x0) * k / n, y0 + (y1 - y0) * k / n, this.R(col), s);
  }
  // ---- added 2026-11-13 (hero agent): sub-rasters sharing this raster's ramps + rotated stamping.
  /** a child raster that shares this raster's colour ramps (ramp ids are interchangeable) */
  sub(w, h) { const s = new Raster(w, h); s.ramps = this.ramps; s.rampIx = this.rampIx; return s; }
  /** copy a sub() raster into this one: src point (ax, ay) lands on (dx, dy), rotated by ang degrees (nearest sampling).
   *  The source's groups are appended after the current group (draw order and outline rules are kept). */
  stamp(src, dx, dy, ang = 0, ax = 0, ay = 0) {
    const base = this.g, c = Math.cos(ang * D2R), s = Math.sin(ang * D2R), m = Math.ceil(Math.hypot(src.w, src.h)) + 1;
    for (const g of src.noLine) this.noLine.add(base + g);
    const X0 = Math.floor(dx - m), Y0 = Math.floor(dy - m);
    for (let y = Y0; y <= Y0 + 2 * m; y++) for (let x = X0; x <= X0 + 2 * m; x++) {
      if (x < 0 || y < 0 || x >= this.w || y >= this.h) continue;
      const px = x + 0.5 - dx, py = y + 0.5 - dy, sx = Math.floor(ax + px * c + py * s), sy = Math.floor(ay - px * s + py * c);
      if (sx < 0 || sy < 0 || sx >= src.w || sy >= src.h) continue;
      const j = sy * src.w + sx; if (src.rp[j] < 0) continue;
      const i = y * this.w + x; this.rp[i] = src.rp[j]; this.sh[i] = src.sh[j]; this.gr[i] = base + src.gr[j];
    }
    this.g = base + src.g;
  }
  has(x, y) { x = Math.round(x); y = Math.round(y); return x >= 0 && y >= 0 && x < this.w && y < this.h && this.rp[y * this.w + x] >= 0; }
  /** write to an ImageData at (ox, oy) with selective outlines */
  blit(img, ox, oy) {
    const { w, h, rp, sh, gr, ramps } = this, W = img.width, d = img.data;
    const at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h) ? -1 : y * w + x;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x; let col = null;
      if (rp[i] >= 0) {
        let s = sh[i];
        // internal contour: a group drawn later (in front) borders this pixel
        if (!this.noLine.has(gr[i])) for (const j of [at(x + 1, y), at(x - 1, y), at(x, y - 1), at(x, y + 1)]) {
          if (j >= 0 && rp[j] >= 0 && gr[j] > gr[i] && !this.noLine.has(gr[j]) && rp[j] !== rp[i]) { s = Math.min(s, 0); break; }
        }
        col = ramps[rp[i]][s];
        if (s === 0 && col) col = col.map(v => v * 0.78);
      } else {
        // exterior selective outline: darkest tone of the neighbouring material
        let nb = -1;
        for (const j of [at(x + 1, y), at(x - 1, y), at(x, y - 1), at(x, y + 1)]) if (j >= 0 && rp[j] >= 0) { nb = j; break; }
        if (nb >= 0) { const c0 = ramps[rp[nb]][0]; col = [c0[0] * 0.45 + 6, c0[1] * 0.4 + 4, c0[2] * 0.45 + 8]; }
      }
      if (!col) continue;
      const k = ((oy + y) * W + ox + x) * 4; d[k] = col[0]; d[k + 1] = col[1]; d[k + 2] = col[2]; d[k + 3] = 255;
    }
  }
}

