// creature.js — hero.js-quality sprites for non-human actors (beasts, insects, drones, turrets).
// Contract: buildCreatureSheet(A) -> null (not handled: actor.js falls back to the legacy spritedraw.js sheet) or
//   { canvas, info:{anim:{row,n}}, anims:{anim:{n,dur,loop?,hold?}}, fw, fh, gy, hpx, cols, rows, shadow? }
//   hpx = sheet pixels per 1.7 world units (62 = hero.js texel density); shadow = blob shadow width in world units.
//
// Rendering: every creature is built from shaded primitives (raster.js) placed by a small skeleton per body plan:
//   quadrupeds (dog / wolf / rat / boar / kretowij-mole) use 2-bone IK legs with a trot gait, a chain tail and a
//   hinged jaw; bugs (scorpion / spider / beetle) use ripple-gait legs and a transform pen that can roll the body
//   over (die = flip onto the back, re-lit from the top-left, not a rotated bitmap); the swarm is a cloud of
//   orbiting flies; drone and turret are rigid machines posed through the same pen.
// Particles (muzzle flashes, sparks, smoke, dust, spit, rotor blur) are drawn after the outline pass so they glow.
import { mkCanvas, shade, mix, clamp, parseHex, bayer } from './util.js';
import { Raster, D2R } from './raster.js';

export const CANIM_ORDER = ['idle', 'walk', 'attack', 'shoot', 'hurt', 'die', 'cast'];
// Legacy totals (spritedraw ANIMS): attack 0.30 s (impact ~0.15), shoot 0.27 (flash ~0.09), hurt 0.22, die 0.56, cast 0.39.
export const CANIMS = {
  idle: { n: 8, dur: 0.2, loop: true }, walk: { n: 8, dur: 0.075, loop: true }, attack: { n: 6, dur: 0.06 },
  shoot: { n: 5, dur: 0.065 }, hurt: { n: 3, dur: 0.08 }, die: { n: 7, dur: 0.09, hold: true }, cast: { n: 6, dur: 0.075 },
};
const HPX = 62;
const TOOTH = '#ece2c4', BONE = '#d8ccae', BLOOD = '#7a1a16', GOO = '#7aa23a';
const HUMAN_SKINS = ['#e0ac84', '#c68a62', '#a56b46', '#7a4a30', '#f0c8a0', '#d49a74'];
const lerp = (a, b, t) => a + (b - a) * t;
const H2 = (x, y, s = 0) => { let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 1442695041); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
const pick = (arr, i) => arr[Math.min(arr.length - 1, i)];

// ---------------------------------------------------------------- transform pen (affine, re-lit primitives)
class Pen {
  constructor(R) { this.R = R; this.M = [1, 0, 0, 1, 0, 0]; this.st = []; }
  push() { this.st.push(this.M.slice()); return this; }
  pop() { this.M = this.st.pop(); return this; }
  mul(a2, b2, c2, d2, e2, f2) { const [a, b, c, d, e, f] = this.M; this.M = [a * a2 + c * b2, b * a2 + d * b2, a * c2 + c * d2, b * c2 + d * d2, a * e2 + c * f2 + e, b * e2 + d * f2 + f]; return this; }
  tr(x, y) { return this.mul(1, 0, 0, 1, x, y); }
  rot(deg, px = 0, py = 0) { const r = deg * D2R, c = Math.cos(r), s = Math.sin(r); return this.tr(px, py).mul(c, s, -s, c, 0, 0).tr(-px, -py); }
  sc(sx, sy, px = 0, py = 0) { return this.tr(px, py).mul(sx, 0, 0, sy, 0, 0).tr(-px, -py); }
  p(x, y) { const [a, b, c, d, e, f] = this.M; return [a * x + c * y + e, b * x + d * y + f]; }
  get k() { const [a, b, c, d] = this.M; return Math.sqrt(Math.abs(a * d - b * c)); }
  cap(ax, ay, bx, by, ra, rb, col, o) { const A = this.p(ax, ay), B = this.p(bx, by), k = this.k; this.R.cap(A[0], A[1], B[0], B[1], Math.max(0.55, ra * k), Math.max(0.55, rb * k), col, o); }
  ell(cx, cy, rx, ry, col, o = {}) {
    const [a, b, c, d] = this.M, r = (o.rot || 0) * D2R, cr = Math.cos(r), sr = Math.sin(r);
    const m00 = (a * cr + c * sr) * rx, m10 = (b * cr + d * sr) * rx, m01 = (-a * sr + c * cr) * ry, m11 = (-b * sr + d * cr) * ry;
    const E = (m00 + m11) / 2, F = (m00 - m11) / 2, G = (m10 + m01) / 2, Hh = (m10 - m01) / 2;
    const Q = Math.hypot(E, Hh), Rr = Math.hypot(F, G), phi = (Math.atan2(Hh, E) + Math.atan2(G, F)) / 2;
    const C = this.p(cx, cy);
    this.R.ell(C[0], C[1], Math.max(0.55, Q + Rr), Math.max(0.55, Math.abs(Q - Rr)), col, { ...o, rot: phi / D2R });
  }
  poly(pts, col, o) { this.R.poly(pts.map(([x, y]) => this.p(x, y)), col, o); }
  px(x, y, col, s) { const A = this.p(x, y); this.R.px(A[0], A[1], col, s); }
  line(x0, y0, x1, y1, col, s) { const A = this.p(x0, y0), B = this.p(x1, y1); this.R.line(A[0], A[1], B[0], B[1], col, s); }
}

// ---------------------------------------------------------------- particles (drawn after the outline pass, no outline)
class Fx {
  constructor(w, h) { this.w = w; this.h = h; this.ops = []; this.under = []; }
  dot(x, y, c, under) { (under ? this.under : this.ops).push([Math.round(x), Math.round(y), parseHex(c)]); }
  line(x0, y0, x1, y1, c, skip) { const n = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)))); for (let k = 0; k <= n; k++) if (!skip || !skip(k, n)) this.dot(x0 + (x1 - x0) * k / n, y0 + (y1 - y0) * k / n, typeof c === 'function' ? c(k, n) : c); }
  // radial blob: cols = [outer, mid, core(, hot)], soft dithered rim; light = shade top-left lighter (smoke)
  disc(cx, cy, r, cols, o = {}) {
    for (let y = Math.floor(cy - r - 1); y <= cy + r + 1; y++) for (let x = Math.floor(cx - r - 1); x <= cx + r + 1; x++) {
      const dx = x + 0.5 - cx, dy = (y + 0.5 - cy) / (o.sy || 1), d = Math.hypot(dx, dy) / r; if (d > 1) continue;
      if (d > 0.72 && bayer(x, y) < (d - 0.72) / 0.28 * (o.soft ?? 0.85)) continue;
      let t = o.light ? clamp(1 - d * 0.55 - (dx + dy) / r * 0.38, 0, 1) : 1 - d;
      const i = clamp(Math.floor(t * cols.length + (bayer(x, y) - 0.5) * 0.6), 0, cols.length - 1);
      this.dot(x, y, cols[i], o.under);
    }
  }
  run(img, list) {
    const W = img.width, d = img.data;
    for (const [x, y, c] of list) { if (x < 0 || y < 0 || x >= this.w || y >= this.h) continue; const i = (y * W + x) * 4; d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255; }
  }
}
// uniformly scaled views (pivot ox, oy) so a body plan can be drawn bigger without re-tuning its numbers
class SR {
  constructor(R, k, ox, oy) { this.R = R; this.k = k; this.ox = ox; this.oy = oy; }
  get w() { return this.R.w; } get h() { return this.R.h; } get rp() { return this.R.rp; } get sh() { return this.R.sh; } get gr() { return this.R.gr; } get g() { return this.R.g; }
  t(x, y) { return [this.ox + (x - this.ox) * this.k, this.oy + (y - this.oy) * this.k]; }
  inv(x, y) { return [this.ox + (x - this.ox) / this.k, this.oy + (y - this.oy) / this.k]; }
  group(n) { return this.R.group(n); }
  cap(ax, ay, bx, by, ra, rb, c, o) { const A = this.t(ax, ay), B = this.t(bx, by); this.R.cap(A[0], A[1], B[0], B[1], ra * this.k, rb * this.k, c, o); }
  ell(cx, cy, rx, ry, c, o) { const A = this.t(cx, cy); this.R.ell(A[0], A[1], rx * this.k, ry * this.k, c, o); }
  poly(pts, c, o) { this.R.poly(pts.map(p => this.t(p[0], p[1])), c, o); }
  px(x, y, c, s) { const A = this.t(x, y); this.R.px(A[0], A[1], c, s); }
  line(x0, y0, x1, y1, c, s) { const A = this.t(x0, y0), B = this.t(x1, y1); this.R.line(A[0], A[1], B[0], B[1], c, s); }
  paint(test, c, o) { this.R.paint((x, y) => { const L = this.inv(x + 0.5, y + 0.5); return test(L[0] - 0.5, L[1] - 0.5); }, c, o); }
}
class SF {
  constructor(F, k, ox, oy) { this.F = F; this.k = k; this.ox = ox; this.oy = oy; }
  t(x, y) { return [this.ox + (x - this.ox) * this.k, this.oy + (y - this.oy) * this.k]; }
  dot(x, y, c, u) { const A = this.t(x, y); this.F.dot(A[0], A[1], c, u); }
  line(x0, y0, x1, y1, c, sk) { const A = this.t(x0, y0), B = this.t(x1, y1); this.F.line(A[0], A[1], B[0], B[1], c, sk); }
  disc(cx, cy, r, cols, o) { const A = this.t(cx, cy); this.F.disc(A[0], A[1], r * this.k, cols, o); }
}
const FIRE = ['#8a1e10', '#d8481a', '#ff9a2a', '#ffe070', '#fffbe0'];
const SMOKE = ['#2e2a28', '#4a4440', '#6a625a', '#8a8278'];
const DUST = ['#6a5438', '#8a7050', '#ae9168', '#cdb48a'];
function flash(F, x, y, ang, s = 1, col = '#ffd060') {
  const c = Math.cos(ang * D2R), sn = Math.sin(ang * D2R);
  F.disc(x + c * 2 * s, y + sn * 2 * s, 3.2 * s, [col, '#ffe9a0', '#fffbe8'], { soft: 0.5 });
  F.line(x, y, x + c * 9 * s, y + sn * 9 * s, (k, n) => k / n < 0.5 ? '#fffbe8' : col);
  for (const a of [-42, 42]) { const ca = Math.cos((ang + a) * D2R), sa = Math.sin((ang + a) * D2R); F.line(x + ca * 2, y + sa * 2, x + ca * 6 * s, y + sa * 6 * s, col, (k) => k === 0); }
}
function sparks(F, x, y, n, seed, rad = 8, dir = 0, spread = 360) {
  for (let k = 0; k < n; k++) {
    const a = (dir + (H2(seed, k, 1) - 0.5) * spread) * D2R, r = rad * (0.35 + 0.65 * H2(seed, k, 2));
    const x1 = x + Math.cos(a) * r, y1 = y + Math.sin(a) * r, x0 = x + Math.cos(a) * r * 0.6, y0 = y + Math.sin(a) * r * 0.6;
    F.line(x0, y0, x1, y1, (j, m) => j === m ? '#fffbe0' : '#ffb030');
  }
}
function smoke(F, x, y, r, seed, n = 3, rise = 0) {
  for (let k = 0; k < n; k++) F.disc(x + (H2(seed, k, 3) - 0.5) * r * 1.4, y - k * r * 0.9 - rise, r * (1 - k * 0.18), SMOKE, { light: true });
}
function dust(F, x, y, r, seed, n = 4, under) {
  for (let k = 0; k < n; k++) F.disc(x + (k - (n - 1) / 2) * r * 0.9 + (H2(seed, k, 4) - 0.5) * 3, y - r * 0.4 - H2(seed, k, 5) * r * 0.6, r * (0.6 + H2(seed, k, 6) * 0.5), DUST, { light: true, under });
}
function ik(a, b, l1, l2, sgn) {
  const dx = b[0] - a[0], dy = b[1] - a[1], d = clamp(Math.hypot(dx, dy), Math.abs(l1 - l2) + 0.05, l1 + l2 - 0.02);
  const base = Math.atan2(dy, dx), A = Math.acos(clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1)), g = base + sgn * A;
  return [a[0] + Math.cos(g) * l1, a[1] + Math.sin(g) * l1];
}
// re-shade pixels of the given groups (fur strands, chitin glints...) — fn(x, y, shade, rampId) -> new shade | undefined
function texture(R, groups, fn) {
  const gs = new Set([].concat(groups));
  for (let y = 0; y < R.h; y++) for (let x = 0; x < R.w; x++) {
    const i = y * R.w + x; if (R.rp[i] < 0 || !gs.has(R.gr[i])) continue;
    const v = fn(x, y, R.sh[i], R.rp[i]); if (v != null) R.sh[i] = clamp(v, 0, 4);
  }
}
function fur(R, groups, ox, oy, seed, dens = 0.2) {
  // short strands lying back-and-down ("/" in a right-facing sprite): darker strands in the mid tones, rare light tips on top
  texture(R, groups, (x, y, s) => {
    const u = x - Math.round(ox), v = y - Math.round(oy), dg = u + v;
    if (s >= 1 && s <= 2 && H2(dg, Math.floor((u + (dg & 1)) / 3), seed) < dens) return s - 1;
    if (s === 3 && H2(dg + 5, Math.floor(u / 3), seed + 1) < dens * 0.45) return 2;
    if (s === 3 && H2(dg + 9, Math.floor(u / 2), seed + 2) < dens * 0.25) return 4;
  });
}
function eye(P, x, y, col, shut, dark = '#140c0c') {
  if (shut) { P.px(x - 1, y + 0.4, dark, 0); P.px(x, y + 0.6, dark, 0); P.px(x + 1, y + 0.4, dark, 0); return; }
  P.px(x - 1, y, dark, 0); P.px(x, y, col, 3); P.px(x + 1, y, col, 4);
}

// ================================================================= QUADRUPEDS
const QUAD = {
  dog: {
    fw: 104, fh: 72, gy: 68, ox: -4, shadow: 1.5, L: 22, sy: 25, hy: 24,
    chest: [-1, 2, 8, 8], haunch: [0, 1, 7.4, 7], waist: [6, 6.6], fore: [8.5, 10.5, 3], hind: [9, 9.5, 6.5],
    r: { fu: [3.2, 2.2], fl: [2.0, 1.5], hu: [4.2, 2.5], hl: [2.4, 1.6], hm: [1.6, 1.3] }, paw: [2.5, 1.5],
    neck: [[2, -3], [9, -10], 4.8, 3.6], head: 'dog', hk: 1,
    tail: { at: [-6, -2], n: 6, len: 16, r: [2.0, 0.7], ang: -140, curl: 13, wag: 10 },
    stride: 13, lift: 4, col: '#7a6a5a', belly: '#a8957a', back: '#4e4038', eye: '#aaff44', pant: true,
  },
  wolf: {
    fw: 112, fh: 76, gy: 72, ox: -4, shadow: 1.6, L: 24, sy: 27, hy: 26,
    chest: [-1, 2, 8.6, 8.4], haunch: [0, 1, 7.6, 7.2], waist: [6.2, 7], fore: [9.5, 11, 3], hind: [10, 10.5, 7],
    r: { fu: [3.3, 2.3], fl: [2.0, 1.5], hu: [4.4, 2.6], hl: [2.4, 1.6], hm: [1.6, 1.3] }, paw: [2.6, 1.5],
    neck: [[2, -3], [10, -10], 5.4, 4], head: 'wolf', hk: 1.08,
    tail: { at: [-6, -1], n: 5, len: 18, r: [3.2, 2.4], ang: 158, curl: -6, wag: 7, bushy: true },
    stride: 14, lift: 4, col: '#7a7268', belly: '#c2b6a2', back: '#3e3832', eye: '#f2c03b', ruff: true,
  },
  rat: {
    fw: 120, fh: 68, gy: 62, ox: 6, shadow: 1.2, k: 1.3, L: 15, sy: 12, hy: 15,
    chest: [0, 1.5, 6.2, 6.2], haunch: [-1, -1, 9.8, 9.4], waist: [8.4, 6.6], fore: [5, 5.4, 2], hind: [6, 6, 5],
    r: { fu: [2.6, 1.8], fl: [1.5, 1.2], hu: [4.4, 2.6], hl: [2.0, 1.4], hm: [1.3, 1.1] }, paw: [2.0, 1.2], hindPaw: [3.8, 1.3],
    neck: [[2, -1.5], [6, -2.5], 5, 3.8], head: 'rat', hk: 1,
    tail: { at: [-9, 4], n: 9, len: 32, r: [2.2, 0.6], ang: 165, curl: 6, wag: 7, rat: true },
    stride: 9, lift: 3, col: '#6a5a4a', belly: '#9a8a78', back: '#3e342c', eye: '#ff4030', feet: '#c98a88',
  },
  boar: {
    fw: 112, fh: 76, gy: 72, ox: -4, shadow: 1.7, L: 22, sy: 23, hy: 21,
    chest: [1, 0, 11.5, 11], haunch: [0, 1, 9.2, 8.8], waist: [9, 10], fore: [7, 8, 2.5], hind: [7.5, 7.5, 5],
    r: { fu: [4.6, 3], fl: [2.6, 2.0], hu: [5.4, 3.2], hl: [2.8, 2.0], hm: [2.0, 1.8] }, paw: [2.4, 1.6],
    neck: [[4, -2], [10, 1], 8, 6.4], head: 'boar', hk: 1,
    tail: { at: [-8, -2], n: 3, len: 7, r: [1.3, 0.8], ang: -175, curl: 45, wag: 18, tuft: true },
    stride: 11, lift: 3.5, col: '#5e4232', belly: '#7a5e4a', back: '#2e2018', eye: '#ff7a2a', hooves: true,
  },
  mole: {
    fw: 168, fh: 104, gy: 98, ox: -12, shadow: 2.6, L: 32, sy: 24, hy: 22,
    chest: [3, -3, 21, 21], haunch: [-2, -1, 18.5, 18.5], waist: [18.5, 20.5], fore: [8, 9, 0], hind: [7, 7, 4],
    r: { fu: [7.2, 6.2], fl: [6.0, 5.4], hu: [7, 5], hl: [4.6, 4], hm: [3.4, 3] }, paw: [5, 2.6],
    neck: [[16, 2], [17, 2], 10, 10], head: 'mole', hk: 1,
    tail: { at: [-17, 4], n: 3, len: 9, r: [3, 1.4], ang: 170, curl: 12, wag: 8 },
    stride: 12, lift: 6, col: '#5a4a3c', belly: '#7a6450', back: '#33281e', eye: '#ffcc88', claw: '#ffcc88',
  },
};

function quadPose(S, anim, i, n) {
  const o = { dx: 0, bob: 0, pitch: 0, pivot: 0, chestDrop: 0, hipDrop: 0, down: 0, headDx: 0, headDy: 0, headAng: 0, jaw: 0, tw: 0, tailLift: 0, gait: null, f: { nf: [0, 0], ff: [0, 0], nh: [0, 0], fh: [0, 0] }, breathe: 0, eyeShut: 0, tongue: 0, blood: 0, ear: 0, wig: 0, headGround: 0, fx: null };
  const T = i / n * Math.PI * 2, id = S.id, mole = id === 'mole', rat = id === 'rat', boar = id === 'boar';
  const A = (arr) => pick(arr, i);
  switch (anim) {
    case 'idle':
      o.breathe = Math.sin(T); o.bob = 0.6 * Math.sin(T); o.headDy = 0.8 * Math.sin(T + 0.9); o.headAng = 2.5 * Math.sin(T + 0.9); o.tw = T; o.ear = i === 5 ? 1 : 0; o.wig = T;
      if (S.pant) { o.jaw = 10 + 4 * Math.sin(2 * T); o.tongue = 1; }
      if (rat) { o.headDx = (i % 2) * 0.8; o.headAng = -3 + 4 * Math.sin(T * 2); }
      if (mole) { o.jaw = 2 + 2 * Math.sin(T); }
      if (i === 6 || i === 7) o.eyeBlink = i === 6;
      break;
    case 'walk':
      o.gait = i / n; o.bob = 0.9 * Math.cos(2 * T) - 0.3; o.headDy = -0.7 * Math.cos(2 * T); o.tw = T * 2; o.headAng = 3; o.wig = T * 2; o.pitch = 0.8 * Math.sin(2 * T);
      if (S.pant) { o.jaw = 8; o.tongue = 1; }
      if (mole) { o.bob = 1.6 * Math.cos(2 * T) - 0.5; o.pitch = 1.6 * Math.sin(2 * T); }
      break;
    case 'attack':
      if (mole) { // raise the near claw, slash down + forward
        o.pitch = A([-6, -10, 3, 6, 4, 1]); o.pivot = 1; o.dx = A([-2, -3, 3, 6, 4, 1]); o.headAng = A([-8, -12, 6, 10, 6, 2]); o.jaw = A([6, 14, 22, 10, 4, 2]);
        o.f.nf = A([[2, -10], [4, -20], [12, -10], [14, 0], [10, 0], [3, 0]]); o.f.ff = A([[0, 0], [1, -3], [6, -2], [7, 0], [5, 0], [1, 0]]);
        o.fx = A([null, null, 'claw1', 'claw2', 'dust', null]); break;
      }
      if (boar) { // charge + tusk hook
        o.dx = A([-3, -5, 4, 10, 8, 2]); o.pitch = A([2, 4, 2, 5, 2, 0]); o.headAng = A([10, 16, 18, -16, -10, 0]); o.headDy = A([2, 3, 3, 0, 0, 0]); o.jaw = A([0, 2, 6, 12, 6, 0]);
        o.f.nf = A([[0, 0], [-2, 0], [6, -4], [8, 0], [6, 0], [2, 0]]); o.f.ff = A([[0, 0], [-1, 0], [4, 0], [6, -3], [5, 0], [1, 0]]); o.f.nh = A([[0, 0], [-2, 0], [-3, 0], [2, -2], [3, 0], [1, 0]]);
        o.fx = A([null, null, null, 'gore', 'dust', null]); break;
      }
      o.dx = A([-3, -4, 4, 9, 7, 2]); o.bob = A([2, 3, -1, 0, 1, 0]); o.pitch = A([2, 3, -4, 4, 3, 0]);
      o.headDx = A([-2, -2, 3, 5, 4, 1]); o.headDy = A([2, 3, -1, 2, 2, 0]); o.headAng = A([6, 8, -10, 10, 8, 0]); o.jaw = A([0, 6, 34, 4, 12, 3]);
      o.f.nf = A([[0, 0], [-1, 0], [6, -6], [9, -1], [7, 0], [2, 0]]); o.f.ff = A([[0, 0], [-1, 0], [4, -4], [8, 0], [6, 0], [2, 0]]);
      o.f.nh = A([[0, 0], [-2, 0], [-4, 0], [2, -2], [4, 0], [1, 0]]); o.f.fh = A([[0, 0], [-1, 0], [-3, 0], [3, 0], [3, 0], [1, 0]]);
      o.tw = i; o.tailLift = A([10, 14, 6, 0, 0, 0]); o.ear = A([0, 1, 1, 1, 0, 0]); o.fx = A([null, null, null, 'bite', null, null]);
      break;
    case 'shoot':
      if (mole) { // quake: rear up, slam both claws into the ground
        o.pivot = 1; o.pitch = A([-10, -20, 4, 6, 2]); o.headAng = A([-10, -16, 8, 10, 4]); o.jaw = A([10, 24, 8, 4, 2]);
        o.f.nf = A([[2, -8], [3, -16], [6, 0], [6, 0], [4, 0]]); o.f.ff = A([[1, -6], [2, -14], [5, 0], [5, 0], [3, 0]]); o.fx = A([null, null, 'quake1', 'quake2', 'quake3']); break;
      }
      o.dx = A([-2, 2, 1, 0, 0]); o.headAng = A([-18, 8, 4, 0, 0]); o.headDy = A([-2, 1, 0, 0, 0]); o.jaw = A([16, 30, 14, 4, 2]); o.pitch = A([-3, 2, 1, 0, 0]);
      o.fx = A([null, 'spit1', 'spit2', 'spit3', null]); o.f.nf = A([[0, 0], [2, 0], [2, 0], [1, 0], [0, 0]]);
      break;
    case 'hurt':
      o.dx = A([-4, -2, -1]); o.headAng = A([-20, -10, -3]); o.headDy = A([-2, -1, 0]); o.jaw = A([26, 12, 4]); o.pitch = A([-4, -2, 0]); o.bob = A([1, 0, 0]);
      o.eyeShut = A([1, 1, 0]); o.tailLift = A([-14, -8, 0]); o.f.nf = A([[-2, -3], [-1, 0], [0, 0]]); o.fx = A(['blood', null, null]); o.ear = 1;
      break;
    case 'die':
      o.dx = A([-3, -3, -2, -2, -2, -2, -2]); o.headAng = A([-26, -12, 14, 26, 20, 22, 22]); o.jaw = A([28, 22, 16, 10, 12, 12, 12]); o.pitch = A([-5, 4, 2, 0, 0, 0, 0]);
      o.hipDrop = A([0, 0.15, 0.8, 1, 1, 1, 1]); o.chestDrop = A([0, 0.6, 0.9, 1, 1, 1, 1]); o.down = A([0, 0.2, 0.6, 1, 1, 1, 1]);
      o.headGround = A([0, 0, 0.5, 1, 0.85, 1, 1]); o.bob = A([0, 0, 0, 1, -1, 0, 0]); o.eyeShut = A([1, 1, 1, 1, 1, 1, 1]); o.tongue = A([0, 0, 0, 1, 1, 1, 1]);
      o.blood = A([0, 0, 0, 0.25, 0.5, 0.75, 1]); o.tailLift = A([-10, -14, -20, -24, -26, -26, -26]); o.dead = i >= 3; o.fx = A(['blood', null, 'dust', null, null, null, null]);
      break;
    case 'cast': // roar / howl (mole: rear up & roar)
      o.headAng = A([8, -16, -32, -34, -30, -6]); o.headDy = A([2, -2, -4, -4, -4, 0]); o.jaw = A([2, 20, 34, 36, 30, 6]); o.breathe = A([0, 1, 1.5, 1.5, 1, 0]);
      o.pitch = A([2, -4, -6, -6, -5, 0]); o.tailLift = A([0, 10, 16, 16, 12, 0]); o.fx = A([null, null, 'roar1', 'roar2', 'roar3', null]); o.ear = 1;
      if (rat) { o.pivot = 1; o.pitch = A([0, -18, -30, -32, -26, -4]); o.f.nf = A([[0, 0], [0, -4], [-1, -8], [-1, -8], [0, -6], [0, 0]]); o.f.ff = o.f.nf; }
      if (mole) { o.pivot = 1; o.pitch = A([0, -8, -14, -14, -10, 0]); o.f.nf = A([[0, 0], [2, -6], [3, -12], [3, -12], [2, -8], [0, 0]]); o.f.ff = A([[0, 0], [1, -4], [2, -10], [2, -10], [1, -6], [0, 0]]); }
      break;
  }
  return o;
}

function drawQuad(R0, P, F0, S, A, o) {
  const k = S.k || 1, R = k === 1 ? R0 : new SR(R0, k, S.fw / 2, S.gy), F = k === 1 ? F0 : new SF(F0, k, S.fw / 2, S.gy);
  P.M = [k, 0, 0, k, S.fw / 2 * (1 - k), S.gy * (1 - k)];
  const C0 = { col: S.col, belly: S.belly, back: S.back, eye: S.eye };
  const GY = S.gy, mid = (S.sy + S.hy) / 2, cx = S.fw / 2 + S.ox + o.dx;
  const C = [cx, GY - mid + o.bob];
  // spine: shoulder / hip joints; pitch around the body centre or the hip (rearing)
  const pv = o.pivot ? [-S.L / 2, (S.sy - S.hy) / 2] : [0, 0], pit = o.pitch * D2R, cs = Math.cos(pit), sn = Math.sin(pit);
  const rel = (x, y) => { const X = x - pv[0], Y = y - pv[1]; return [C[0] + pv[0] + X * cs - Y * sn, C[1] + pv[1] + X * sn + Y * cs]; };
  const Sh = rel(S.L / 2, (S.hy - S.sy) / 2), Hp = rel(-S.L / 2, (S.sy - S.hy) / 2);
  const chestMax = S.sy - S.chest[1] - S.chest[3] - 0.6, hipMax = S.hy - S.haunch[1] - S.haunch[3] - 0.6;
  Sh[1] += o.chestDrop * chestMax; Hp[1] += o.hipDrop * hipMax;
  const ax = Math.atan2(Sh[1] - Hp[1], Sh[0] - Hp[0]), ac = Math.cos(ax), as = Math.sin(ax);
  const rv = (p, dx, dy) => [p[0] + dx * ac - dy * as, p[1] + dx * as + dy * ac];
  const br = o.breathe * 0.45;
  const chestC = rv(Sh, S.chest[0], S.chest[1]), hauC = rv(Hp, S.haunch[0], S.haunch[1]);
  const Sj = rv(Sh, 1, 3), Hj = rv(Hp, 1, 2.5);
  // feet (ground positions)
  const restF = cx + S.L / 2 + 1.5, restH = cx - S.L / 2 - 1;
  const foot = (name, rest, off, far) => {
    let x = rest, y = GY;
    if (o.gait != null) {
      const duty = 0.55, ph = ((o.gait + off) % 1 + 1) % 1;
      if (ph < duty) x = rest + S.stride * (0.5 - ph / duty);
      else { const u = (ph - duty) / (1 - duty), e = u * u * (3 - 2 * u); x = rest + S.stride * (-0.5 + e); y = GY - S.lift * Math.sin(Math.PI * u); }
    }
    const f = o.f[name]; x += f[0]; y += f[1];
    if (o.down) { const sp = name[1] === 'f' ? 1 : -1; x += o.down * (name[0] === 'n' ? 7 : 4) * (name[1] === 'f' ? 1 : -1.2) * (S.id === 'mole' ? 0.4 : 1); }
    return [x + (far ? 1.5 : 0), Math.min(GY, y) - (far ? 1 : 0)];
  };
  const ff = foot('ff', restF, 0, true), fh = foot('fh', restH, 0.5, true), nf = foot('nf', restF, 0.5, false), nh = foot('nh', restH, 0, false);
  const darkLeg = mix(S.col, S.back, 0.4);

  // blood pool / corpse puddle
  if (o.blood > 0) { R.group(); R.ell(cx + 2, GY - 0.5, (S.L * 0.6 + 6) * Math.sqrt(o.blood), 1.6 + 1.4 * o.blood, BLOOD, { bias: -0.15 }); }

  const legFore = (Sj2, Fp, far) => {
    const g = R.group(), bias = far ? -0.22 : 0, col = far ? darkLeg : S.col;
    if (S.id === 'mole') return moleArm(R, S, Sj2, Fp, far, col, o);
    const W = [Fp[0] - 0.4, Fp[1] - S.paw[1] - S.fore[2]];
    const E = ik(Sj2, W, S.fore[0], S.fore[1], +1);
    R.cap(Sj2[0], Sj2[1], E[0], E[1], S.r.fu[0], S.r.fu[1], col, { bias });
    R.cap(E[0], E[1], W[0], W[1], S.r.fl[0], S.r.fl[1], col, { bias });
    R.cap(W[0], W[1], Fp[0] + 0.8, Fp[1] - S.paw[1], S.r.fl[1], S.paw[1] * 0.9, col, { bias });
    const pc = S.feet || (S.hooves ? '#2a2018' : col);
    R.ell(Fp[0] + 1.2, Fp[1] - S.paw[1], S.paw[0], S.paw[1], pc, { bias });
    if (!S.hooves) { R.px(Fp[0] + 1.2 + S.paw[0], Fp[1] - 1, '#1a1410', 1); R.px(Fp[0] + S.paw[0], Fp[1] - 1, '#1a1410', 1); }
    else R.line(Fp[0] + 1, Fp[1] - S.paw[1] * 2 + 0.5, Fp[0] + 1, Fp[1] - 0.5, '#120c08', 0);
    return g;
  };
  const legHind = (Hj2, Fp, far) => {
    const g = R.group(), bias = far ? -0.22 : 0, col = far ? darkLeg : S.col;
    const hp = S.hindPaw || S.paw;
    const K = [Fp[0] - S.hind[2] * 0.35, Fp[1] - hp[1] - S.hind[2] * 0.88];
    const Kn = ik(Hj2, K, S.hind[0], S.hind[1], -1);
    R.cap(Hj2[0], Hj2[1], Kn[0], Kn[1], S.r.hu[0], S.r.hu[1], col, { bias });
    R.cap(Kn[0], Kn[1], K[0], K[1], S.r.hl[0], S.r.hl[1], col, { bias });
    R.cap(K[0], K[1], Fp[0] + 0.6, Fp[1] - hp[1], S.r.hm[0], S.r.hm[1], col, { bias });
    const pc = S.feet || (S.hooves ? '#2a2018' : col);
    R.ell(Fp[0] + hp[0] * 0.45, Fp[1] - hp[1], hp[0], hp[1], pc, { bias });
    if (S.hooves) R.line(Fp[0] + hp[0] * 0.45, Fp[1] - hp[1] * 2 + 0.5, Fp[0] + hp[0] * 0.45, Fp[1] - 0.5, '#120c08', 0);
    else if (S.id !== 'mole') R.px(Fp[0] + hp[0] * 1.4, Fp[1] - 1, '#1a1410', 1);
    if (S.id === 'mole') for (let k = 0; k < 3; k++) R.cap(Fp[0] + 3 + k * 1.5, Fp[1] - 2.4 + k * 0.6, Fp[0] + 6 + k * 1.6, Fp[1] - 0.6, 1.0, 0.5, S.claw);
    return g;
  };

  // ---- far legs, tail
  legHind(rv(Hj, 1.5, -1), fh, true);
  legFore(rv(Sj, 1.5, -1), ff, true);
  tail(R, S, rv(Hp, S.tail.at[0], S.tail.at[1]), o, ax);

  // ---- body
  const bg = R.group();
  R.ell(hauC[0], hauC[1], S.haunch[2], S.haunch[3], S.col, { rot: ax / D2R });
  R.cap(hauC[0], hauC[1], chestC[0], chestC[1], S.waist[0], S.waist[1] + br * 0.5, S.col);
  R.ell(chestC[0], chestC[1], S.chest[2] + br, S.chest[3] + br, S.col, { rot: ax / D2R });
  // belly / back tones (relative to the spine line)
  const spineY = (x) => Hp[1] + (x - Hp[0]) * Math.tan(ax);
  R.paint((x, y) => y > spineY(x) + S.chest[3] * 0.55 + 1, S.belly, { g: bg });
  R.paint((x, y) => y < spineY(x) - S.chest[3] * 0.4 + 1, S.back, { g: bg });
  const extras = speciesBody(R, P, F, S, A, o, { Sh, Hp, chestC, hauC, ax, bg, spineY });
  fur(R, [bg], C[0], C[1], A.seed & 255, S.id === 'mole' ? 0.28 : 0.22);
  if (extras) extras();
  // ---- mutations (2026-11-13): dorsal bone spikes, glowing pustules on the flank, a hump — placed on the spine frame so they animate with the body
  if (S.mutF) {
    const m = S.mutF, top = (t) => [lerp(hauC[0], chestC[0], t), lerp(hauC[1] - S.haunch[3], chestC[1] - S.chest[3], t) + 1.4];
    if (m.hump) { const [hx, hy] = top(0.62); R.group(); R.ell(hx, hy + 1.5, S.chest[2] * 0.62, S.chest[3] * 0.5, S.back, { rot: ax / D2R }); }
    if (m.spikes) { R.group(); for (let q = 0; q < m.spikes; q++) { const t = 0.08 + 0.84 * (q + 0.5) / m.spikes, [bx, by] = top(t), h = m.spikeH * (0.65 + 0.45 * Math.abs(Math.sin(q * 2.3 + m.ph))); R.cap(bx, by + 0.6, bx - h * 0.42, by - h, 1.5, 0.35, m.spikeCol); } }
    if (m.pust) { R.group(true); for (let q = 0; q < m.pust; q++) { const t = 0.12 + 0.76 * H2(q, 7, m.sd), v = 0.15 + 0.5 * H2(q, 9, m.sd), px = lerp(hauC[0], chestC[0], t), py = lerp(hauC[1], chestC[1], t) - S.chest[3] * (0.55 - v), r = 1.2 + 1.3 * H2(q, 3, m.sd);
      R.ell(px, py, r + 0.7, r + 0.7, mix(S.col, '#1a1210', 0.5)); R.ell(px, py, r, r, m.glow, { bias: 0.22 }); R.ell(px - r * 0.3, py - r * 0.3, r * 0.4, r * 0.4, mix(m.glow, '#ffffff', 0.7), { bias: 0.4 }); } }
  }

  // ---- near legs
  const gh = legHind(Hj, nh, false);
  const gf = legFore(Sj, nf, false);
  fur(R, [gh, gf], C[0], C[1], 3, 0.12);

  // ---- neck + head
  const N0 = rv(Sh, S.neck[0][0], S.neck[0][1]);
  let Hc = rv(Sh, S.neck[1][0] + o.headDx, S.neck[1][1] + o.headDy);
  if (o.headGround) Hc = [Hc[0] + 3 * o.headGround, lerp(Hc[1], GY - S.hk * (S.id === 'rat' ? 3.6 : S.id === 'boar' ? 6 : S.id === 'mole' ? 9 : 4.8), o.headGround)];
  if (S.id !== 'mole') { const ng = R.group(); R.cap(N0[0], N0[1], Hc[0] - 1.5, Hc[1] + 1, S.neck[2], S.neck[3], S.col); R.paint((x, y) => y > (N0[1] + Hc[1]) / 2 + 2, S.belly, { g: ng }); if (S.ruff) { R.ell(Hc[0] - 4, Hc[1] + 3, 5.5, 6.5, mix(S.col, S.belly, 0.4), { rot: -20 }); } fur(R, [ng], C[0], C[1], 9, 0.25); }
  P.push(); P.tr(Hc[0], Hc[1]); P.rot(o.headAng + ax / D2R * 0.5);
  const hg = HEADS[S.head](R0, P, F0, S, A, o, C0);
  P.pop();
  // particles
  quadFx(F, S, A, o, Hc, { Sh, Hp, nf, ff, GY, cx });
}

function tail(R, S, base, o, ax) {
  const T = S.tail; R.group();
  let a = T.ang + o.tailLift * (T.ang > 90 || T.ang < -90 ? (T.ang > 0 ? 1 : -1) : 1) + ax / D2R * 0.6, p = base;
  const seg = T.len / T.n;
  for (let k = 0; k < T.n; k++) {
    a += T.curl + T.wag * Math.sin(o.tw - k * 0.8) * (k + 1) / T.n * (o.dead ? 0 : 1);
    const q = [p[0] + Math.cos(a * D2R) * seg, p[1] + Math.sin(a * D2R) * seg];
    const r0 = lerp(T.r[0], T.r[1], k / T.n), r1 = lerp(T.r[0], T.r[1], (k + 1) / T.n);
    q[1] = Math.min(q[1], S.gy - r1 - 0.2);
    const col = T.rat ? '#b08480' : k === T.n - 1 && T.bushy ? mix(S.col, '#e8e0d0', 0.45) : (T.bushy ? S.col : mix(S.col, S.back, 0.15));
    if (T.bushy) R.ell((p[0] + q[0]) / 2, (p[1] + q[1]) / 2, seg * 0.62 + r0 * 0.4, r0, col, { rot: a });
    else R.cap(p[0], p[1], q[0], q[1], r0, r1, col);
    if (T.rat && k % 1 === 0) R.px((p[0] + q[0]) / 2, (p[1] + q[1]) / 2 - r0 * 0.5, '#6a4a48', 1);
    p = q;
  }
  if (T.tuft) { R.ell(p[0], p[1] + 1, 1.6, 2.4, S.back); }
}

// species-specific body dressing: mutations, bone, armour, bristles
function speciesBody(R, P, F, S, A, o, J) {
  const { Sh, Hp, chestC, hauC, ax, bg, spineY } = J, tid = A.tid || '';
  if (S.id === 'dog' && !/wolf/.test(tid)) {
    // "gnat zamiast sierści": bone-plated spine and exposed ribs, mange, toxic pustules
    return () => {
      R.group();
      for (let k = 0; k < 5; k++) { const x = chestC[0] - 1 - k * 2.6, y0 = spineY(x) + 3.2, y1 = y0 + 6.5 - k * 0.5; R.cap(x + 0.6, y0, x - 0.8, y1, 0.8, 0.65, BONE); }
      R.paint((x, y) => H2(x >> 1, y >> 1, 11) < 0.12 && y > spineY(x) - 2, '#8a6a62', { g: bg });
      R.group();
      for (const [t, h] of [[0.12, 1.6], [0.34, 2.6], [0.52, 3.2], [0.7, 2.4], [0.86, 1.8]]) { const x = lerp(Hp[0] - 2, Sh[0] + 1, t), y = spineY(x) - S.chest[3] * 0.96 + 1.2; R.poly([[x - 1.6, y + 1], [x - 1.2, y - h], [x + 1.4, y + 1]], BONE); R.px(x - 1.2, y - h + 0.6, '#fff4dc', 4); }
      R.group(); for (const [dx, dy, r] of [[-3, 1.5, 1.5], [-6, 0, 1.1], [0.5, 4.5, 1.0]]) { const q = [hauC[0] + dx + 4, hauC[1] + dy]; R.ell(q[0], q[1], r, r, '#aaff44'); R.px(q[0] - 0.3, q[1] - 0.4, '#f0ffc0', 4); }
    };
  }
  if (S.id === 'rat') return () => {
    R.paint((x, y) => H2(x >> 1, (y + 1) >> 1, 13) < 0.14 && y > spineY(x) - 6, '#8a6a64', { g: bg });
    R.group(); R.ell(hauC[0] + 2, hauC[1] - 7, 2.6, 2.0, mix(S.col, '#8a6a64', 0.5)); R.ell(hauC[0] - 3, hauC[1] - 6.5, 1.8, 1.5, mix(S.col, '#8a6a64', 0.5)); R.px(hauC[0] + 2, hauC[1] - 8, '#cc4444', 3);
  };
  if (S.id === 'boar') return () => {
    for (let k = 0; k < 11; k++) { const x = lerp(Hp[0] - 2, Sh[0] + 6, k / 10), y = spineY(x) - (k > 5 ? S.chest[3] + 0.5 : S.haunch[3]) + 1.5; R.line(x, y, x - 1.6, y - 3.2 - (k % 3 === 0 ? 1 : 0), S.back, 1); R.px(x - 1.8, y - 3.6, '#1a120c', 0); }
  };
  if (S.id === 'mole') return () => {
    // bony dorsal plates
    for (let k = 0; k < 6; k++) {
      R.group(); const t = k / 5, x = lerp(Hp[0] - 10, Sh[0] + 10, t), y = spineY(x) - lerp(S.haunch[3], S.chest[3], t) * (0.92 - 0.28 * Math.pow(t - 0.45, 2) * 4) + 2;
      R.ell(x, y, 6.2, 3.6, '#857565', { rot: (t - 0.5) * 40 + ax / D2R }); R.px(x - 2, y - 2, '#d8c8b0', 4); R.px(x - 1, y - 2.2, '#b8a890', 3);
    }
    R.paint((x, y) => y > S.gy - 9 && H2(x >> 1, y >> 1, 21) < 0.55, '#3e3226', { g: bg });
  };
  return null;
}

function moleArm(R, S, Sj, Fp, far, col, o) {
  const bias = far ? -0.22 : 0, g = R.g;
  const W = [Fp[0] - 3, Fp[1] - 7];
  const E = ik(Sj, W, S.fore[0], S.fore[1], +1);
  R.cap(Sj[0], Sj[1], E[0], E[1], S.r.fu[0], S.r.fu[1], col, { bias });
  R.cap(E[0], E[1], W[0], W[1], S.r.fl[0], S.r.fl[1], col, { bias });
  const lift = clamp((S.gy - Fp[1]) / 18, 0, 1), rot = -18 - lift * 40;
  R.ell(W[0] + 3, W[1] + 2.5, 6.4, 4.2, mix(col, S.belly, 0.25), { rot, bias });
  R.group();
  const cr = Math.cos(rot * D2R), sr = Math.sin(rot * D2R);
  for (let k = 0; k < 4; k++) {
    const bx = W[0] + 3 + cr * 5 - sr * (k - 1.5) * 2.2, by = W[1] + 2.5 + sr * 5 + cr * (k - 1.5) * 2.2;
    const tx = bx + cr * 7 - sr * 2.5, ty = by + sr * 7 + cr * 2.5;
    R.cap(bx, by, tx, ty, 1.5, 0.55, k === 0 ? shade(S.claw, 0.9) : S.claw, { bias: bias + 0.1 });
  }
  return g;
}

const HEADS = {
  dog(R, P, F, S, A, o, c) { return canine(R, P, F, S, A, o, c, { muz: 11, ear: [[-3.5, -2], [-2.4, -10.5], [0.6, -3]] }); },
  wolf(R, P, F, S, A, o, c) { return canine(R, P, F, S, A, o, c, { muz: 12.5, ear: [[-3.6, -2], [-2.6, -12], [0.8, -3]] }); },
  rat(R, P, F, S, A, o, c) {
    const J = o.jaw;
    R.group(); P.ell(-1.3, -4.4, 2.5, 2.7, mix(S.col, S.back, 0.5), { bias: -0.2 });
    if (J > 3) { R.group(); P.ell(4.5, 2.8, 3.6, 1 + J * 0.05, '#5a1a1a'); }
    R.group(); P.push(); P.rot(J * 0.8, 0, 2); P.cap(0, 2.4, 6.6, 3.0, 1.7, 0.8, S.col, { bias: -0.08 }); P.px(6.6, 2.0, '#e8c860', 3); P.pop();
    const hg = R.group(); P.ell(0, 0, 4.1, 3.6, S.col); P.cap(1.5, 0.4, 9.2, 2.1, 2.9, 1.0, S.col);
    R.paint((x, y) => true, S.col, { g: hg });
    P.px(10, 2.1, '#e89a9a', 3); P.px(9.6, 1.4, '#e89a9a', 2);
    P.px(8.2, 3.3, '#e8c860', 3); P.px(8.2, 4.1, '#d0a840', 2);
    eye(P, 2.6, -0.8, c.eye, o.eyeShut || o.eyeBlink);
    R.group(); P.ell(-0.2, -4.2, 2.7, 2.9, S.col); P.ell(0, -4, 1.5, 1.8, '#d08a88');
    const w0 = P.p(8.5, 1.4), w1 = P.p(14.5, -0.4), w2 = P.p(15, 2), w3 = P.p(13.8, 4);
    for (const w of [w1, w2, w3]) F.line(w0[0], w0[1], w[0], w[1], '#d8d0c0', (k) => k < 2 || k % 2 === 1);
    return hg;
  },
  boar(R, P, F, S, A, o, c) {
    const J = o.jaw;
    R.group(); P.poly([[-2, -4], [-8.5, -8.5], [-4, -1]], mix(S.col, S.back, 0.5), { bias: -0.2 });
    R.group(); P.push(); P.rot(J, -1, 4.5); P.cap(-1, 4.6, 10, 6.2, 2.8, 1.8, S.col, { bias: -0.1 }); P.px(9, 4.6, TOOTH, 3); P.pop();
    const hg = R.group(); P.ell(0, 0, 6.4, 6, S.col); P.cap(3, 1.5, 12.5, 3.8, 4.8, 3.2, S.col);
    R.paint((x, y) => true, S.col, { g: hg });
    P.ell(13.4, 3.8, 1.4, 3.1, '#9a7266'); P.px(13.8, 3, '#2a1410', 0); P.px(13.8, 4.8, '#2a1410', 0);
    for (let k = 0; k < 5; k++) P.line(-4 + k * 1.4, -5.4 + k * 0.1, -5.4 + k * 1.4, -8.8 + (k % 2), S.back, 1);
    eye(P, 3.2, -1.6, c.eye, o.eyeShut || o.eyeBlink);
    R.group(); P.cap(10, 5.6, 12.6, 0.8, 1.4, 0.55, TOOTH); P.px(12.4, 0.6, '#fffaf0', 4);
    R.group(); P.poly([[-1.5, -4.5], [-8, -9.5], [-3.5, -1]], S.col); P.px(-4, -5, '#3a2018', 0);
    return hg;
  },
  mole(R, P, F, S, A, o, c) {
    const J = o.jaw;
    if (J > 3) { R.group(); P.ell(9, 6.2, 8, 1.6 + J * 0.12, '#4a1416'); }
    R.group(); P.push(); P.rot(J * 0.7, 2, 6); P.cap(2, 7, 16, 6.8, 3.4, 1.6, mix(S.col, S.belly, 0.4), { bias: -0.05 });
    if (J > 3) for (let k = 0; k < 5; k++) P.px(5 + k * 2.4, 5.2, TOOTH, 3 + (k & 1));
    P.pop();
    const hg = R.group(); P.cap(-4, -1, 18, 3.2, 11.5, 4.2, S.col); R.paint((x, y) => true, S.col, { g: hg });
    if (J > 3) for (let k = 0; k < 5; k++) P.px(6 + k * 2.3, 6, TOOTH, 4);
    P.px(8.5, -3.5, '#100a08', 0); P.px(9.5, -3.5, c.eye, 4); P.px(9.5, -2.6, '#100a08', 1);
    // star nose: fleshy tentacles
    R.group();
    for (let k = 0; k < 11; k++) { const a = (k * 32.7 - 160 + 8 * Math.sin(o.wig + k * 1.3)) * D2R, L = 4.6 + 0.8 * Math.sin(o.wig * 2 + k); P.cap(20.4, 3.4, 20.4 + Math.cos(a) * L, 3.4 + Math.sin(a) * L * 1.1, 1.25, 0.8, k % 2 ? '#e8a090' : '#f0b8a0'); }
    P.ell(20.6, 3.4, 2.2, 2.4, '#d88878');
    return hg;
  },
};
function canine(R, P, F, S, A, o, c, G) {
  const k = S.hk, J = o.jaw, M = G.muz;
  const ear = (p) => p.map(([x, y]) => [x * k + (o.ear ? -0.6 : 0), y * k + (o.ear ? 0.6 : 0)]);
  R.group(); P.poly(ear(G.ear).map(([x, y]) => [x + 1.8, y - 0.4]), mix(S.col, S.back, 0.55), { bias: -0.2 });
  if (J > 3) { R.group(); P.ell(5.5 * k, 3.6 * k, 5.2 * k, 1.1 + J * 0.075, '#5a1818', { rot: J * 0.35 }); }
  R.group(); P.push(); P.rot(J, -1 * k, 2.6 * k);
  if (o.tongue) P.cap(3 * k, 3.4 * k, (M - 1.5 + (o.dead ? 2 : 0)) * k, (4.6 + (o.dead ? 2.2 : 0)) * k, 1.5, 1.1, '#c8606a');
  P.cap(-1 * k, 3 * k, (M - 1.6) * k, 4.1 * k, 2.1 * k, 1.2 * k, S.col, { bias: -0.08 });
  if (J > 3) { P.px((M - 2.6) * k, 2.4 * k, TOOTH, 4); P.px((M - 2.6) * k, 3.0 * k, TOOTH, 3); P.px((M - 4.6) * k, 2.8 * k, TOOTH, 3); }
  P.pop();
  const hg = R.group(); P.ell(0, 0, 5.2 * k, 4.6 * k, S.col); P.cap(2.5 * k, 0.6 * k, M * k, 2.0 * k, 3.1 * k, 1.8 * k, S.col);
  R.paint((x, y) => true, S.col, { g: hg });
  if (S.ruff) { P.ell(-2.5 * k, 2.5 * k, 3.6, 3.8, mix(S.col, S.belly, 0.5)); }
  if (J > 3) { P.px((M - 1.6) * k, 3.6 * k, TOOTH, 4); P.px((M - 1.6) * k, 4.5 * k, TOOTH, 3); P.px((M - 3.6) * k, 3.4 * k, TOOTH, 3); P.px((M - 5.4) * k, 3.2 * k, TOOTH, 3); }
  P.px((M + 1) * k, 1 * k, '#201818', 1); P.px((M + 1) * k, 2 * k, '#201818', 0); P.px(M * k + 0.4, 0.5 * k, '#6a5a5a', 3);
  P.px(1.8 * k, -2.6 * k, mix(S.col, S.back, 0.7), 1); P.px(3 * k, -2.5 * k, mix(S.col, S.back, 0.7), 1); P.px(4.1 * k, -2.0 * k, mix(S.col, S.back, 0.7), 1);
  eye(P, 3 * k, -1.2 * k, c.eye, o.eyeShut || o.eyeBlink);
  R.group(); P.poly(ear(G.ear), S.col); P.px(-1.3 * k, -5 * k, '#8a5a52', 1); P.px(-1.1 * k, -6.3 * k, '#8a5a52', 1);
  if (S.id === 'dog') P.px(-1.8 * k, -9.4 * k, '#3a2a22', 0); // torn ear tip
  return hg;
}

function quadFx(F, S, A, o, Hc, J) {
  const hc = S.hk || 1, mx = Hc[0] + (S.id === 'boar' ? 13 : S.id === 'rat' ? 9 : S.id === 'mole' ? 22 : 12) * hc, my = Hc[1] + 3;
  switch (o.fx) {
    case 'bite': for (const s of [-1, 1]) F.line(mx + 2, my + s * 4, mx + 5, my + s * 1.5, (k) => k === 0 ? '#c8bea0' : '#fffbe8'); F.line(mx + 6, my - 1, mx + 8, my, '#fffbe8'); F.dot(mx + 3, my + 6, '#c43d2f'); F.dot(mx + 5, my + 7, '#7a1d17'); break;
    case 'gore': sparks(F, mx, my - 4, 6, 3, 7, -60, 70); F.dot(mx + 3, my - 6, '#c43d2f'); break;
    case 'spit1': case 'spit2': case 'spit3': {
      const t = { spit1: 0, spit2: 1, spit3: 2 }[o.fx], x = mx + 3 + t * 9, y = my - 1 + t * t * 1.5;
      F.disc(x, y, 2.6 - t * 0.4, ['#3f7a2a', '#8fd14f', '#d8f080'], { soft: 0.3 });
      for (let k = 0; k < 4; k++) F.dot(x - 3 - k * 2.2, y + (k % 2) - 1 + k * 0.4, k % 2 ? '#8fd14f' : '#c8e870');
      break;
    }
    case 'blood': for (let k = 0; k < 6; k++) F.dot(Hc[0] - 2 - H2(k, 1, 31) * 7, Hc[1] - 2 + H2(k, 2, 31) * 9, k % 2 ? '#c43d2f' : '#7a1d17'); break;
    case 'dust': dust(F, J.cx + 2, J.GY, S.id === 'mole' ? 6 : 3.5, 9, 3, true); break;
    case 'roar1': case 'roar2': case 'roar3': {
      const t = { roar1: 0, roar2: 1, roar3: 2 }[o.fx];
      for (let r = 0; r <= t; r++) { const rad = 5 + (t - r) * 5 + r * 0.5; for (let a = -50; a <= 50; a += 8) { const x = mx + Math.cos(a * D2R) * rad, y = my - 6 + Math.sin(a * D2R) * rad; if (H2(a, r + t, 5) < 0.75) F.dot(x, y, r === t ? '#fff4d8' : '#c8bea0'); } }
      break;
    }
    case 'claw1': case 'claw2': { // three slash arcs in front of the claw
      const cx0 = J.nf[0] + 6, cy0 = J.nf[1] - 10, t = o.fx === 'claw1' ? 0 : 1;
      for (let s = 0; s < 3; s++) for (let k = 0; k <= 10; k++) { const a = (-70 + k * 12 + t * 30) * D2R, r = 14 + s * 3; F.dot(cx0 + Math.cos(a) * r * 0.7, cy0 + Math.sin(a) * r, k > 5 ? '#fffbe8' : '#c8bea0'); }
      if (t) dust(F, J.nf[0] + 6, J.GY, 5, 4, 3);
      break;
    }
    case 'quake1': case 'quake2': case 'quake3': {
      const t = { quake1: 0, quake2: 1, quake3: 2 }[o.fx], x = J.nf[0] + 4;
      dust(F, x, J.GY + 1, 6 + t * 3, 17 + t, 4 + t, t === 2);
      for (let k = 0; k < 7 + t * 4; k++) F.dot(x - 20 + k * 3.4 + (k % 2), J.GY - (k % 3), '#2a1e14', true);
      if (t < 2) for (let k = 0; k < 6; k++) F.dot(x - 14 + H2(k, t, 41) * 28, J.GY - 6 - H2(k, t, 42) * (12 + t * 8), k % 2 ? '#8a7050' : '#5a4430');
      break;
    }
  }
}

// ================================================================= BUGS (scorpion / spider / beetle)
const BUG = {
  scorpion: { fw: 136, fh: 92, gy: 86, ox: -4, shadow: 2.0, y0: 7, k: 1.4, col: '#a8783a', dark: '#5e3a18', belly: '#d0aa6a', acc: '#ffaa22', legs: 4 },
  spider: { fw: 128, fh: 84, gy: 78, ox: -2, shadow: 1.8, y0: 15, k: 1.25, col: '#3e3040', dark: '#1e1620', belly: '#5a4a5a', acc: '#8fd14f', legs: 4 },
  beetle: { fw: 120, fh: 72, gy: 66, ox: -2, shadow: 1.6, y0: 11, k: 1.3, col: '#2f5a3a', dark: '#1a2a22', belly: '#5a4a2a', acc: '#c8e04a', legs: 3 },
};
function bugPose(S, anim, i, n) {
  const o = { dx: 0, bob: 0, rot: 0, sy: 1, gait: null, ph: 0, clawLift: 0, clawOpen: 10, clawReach: 0, tailA: 0, tailCurl: 0, curl: 0, flail: 0, jaw: 0, glow: 0, fx: null, goo: 0, raise: 0, dead: false };
  const T = i / n * Math.PI * 2, A = (a) => pick(a, i);
  switch (anim) {
    case 'idle': o.bob = 0.5 * Math.sin(T); o.clawOpen = 10 + 8 * Math.max(0, Math.sin(T * 2)); o.tailA = 3 * Math.sin(T); o.ph = T; o.jaw = 2 + 2 * Math.sin(2 * T); o.glow = i % 4 === 0 ? 1 : 0; o.idle = true; break;
    case 'walk': o.gait = i / n; o.bob = 0.6 * Math.cos(T * 2); o.tailA = 4 * Math.sin(T); o.clawLift = 1; o.ph = T * 2; break;
    case 'attack':
      o.dx = A([-3, -4, 4, 8, 6, 1]); o.clawLift = A([4, 6, 2, 0, 1, 0]); o.clawOpen = A([30, 40, 40, 0, 0, 10]); o.clawReach = A([-2, -3, 4, 7, 5, 1]);
      o.tailA = A([-10, -16, 10, 30, 22, 4]); o.tailCurl = A([10, 14, 4, 8, 6, 0]); o.raise = A([1, 2, 0, -1, 0, 0]); o.jaw = A([4, 6, 8, 2, 2, 2]);
      o.fx = A([null, null, null, 'snap', 'drip', null]); o.legShift = A([0, -1, 2, 3, 2, 0]); break;
    case 'shoot':
      o.dx = A([-2, -3, 1, 0, 0]); o.tailA = A([-14, -18, 26, 20, 6]); o.tailCurl = A([10, 14, 4, 2, 0]); o.raise = A([2, 3, 0, 0, 0]); o.clawOpen = A([20, 30, 20, 10, 10]); o.jaw = A([4, 8, 10, 6, 2]);
      o.fx = A([null, null, 'venom1', 'venom2', 'venom3']); break;
    case 'hurt': o.dx = A([-4, -2, -1]); o.raise = A([3, 1, 0]); o.clawLift = A([8, 4, 1]); o.clawOpen = A([40, 25, 12]); o.tailA = A([-14, -6, 0]); o.rot = A([-6, -3, 0]); o.flail = A([1, 0.5, 0]); o.fx = A(['goo', null, null]); break;
    case 'die':
      o.dx = A([-3, -4, -3, -2, -2, -2, -2]); o.rot = A([-10, -18, -10, 0, 0, 0, 0]); o.sy = A([1, 0.7, -0.65, -1, -1, -1, -1]); o.bob = A([0, -5, -6, 0, -1, 0, 0]);
      o.curl = A([0, 0.3, 0.6, 0.55, 0.8, 0.95, 1]); o.flail = A([1, 1, 1, 1, 0.6, 0.2, 0]); o.ph = i * 2.1; o.clawOpen = A([40, 30, 20, 25, 18, 10, 6]);
      o.tailA = A([-20, -30, -40, -50, -52, -54, -54]); o.tailCurl = A([0, -6, -12, -18, -20, -22, -22]); o.dead = i >= 3; o.goo = A([0, 0, 0, 0.3, 0.6, 0.85, 1]); o.fx = A(['goo', null, null, 'dust', null, null, null]); break;
    case 'cast': // threat display
      o.raise = A([1, 3, 5, 5, 5, 1]); o.clawLift = A([3, 8, 12, 12, 11, 2]); o.clawOpen = A([20, 40, 50, 50, 46, 12]); o.tailA = A([-6, -10, -14, -12, -14, 0]); o.tailCurl = A([4, 8, 12, 12, 12, 0]);
      o.jaw = A([4, 8, 12, 12, 10, 3]); o.glow = A([0, 1, 1, 1, 1, 0]); o.fx = A([null, null, 'hiss1', 'hiss2', 'hiss1', null]); break;
  }
  return o;
}
function bugLegs(R, P, S, o, far, legDefs) {
  // legDefs: [{bx, by, fx (rest foot dx), kh (knee height), l, r:[a,b]}]; local coords: y0 = body centre above ground
  legDefs.forEach((L, k) => {
    R.group();
    const side = far ? 1 : 0;
    let fx = L.bx + L.fx + (far ? 1.6 : 0) + (o.legShift || 0) * (k < 2 ? 1 : 0.5), fy = S.y0 - o.raise * 0.0 - (far ? 1 : 0);
    if (o.gait != null) { const ph = ((o.gait + (k % 2) * 0.5 + side * 0.5) % 1 + 1) % 1, duty = 0.55; if (ph < duty) fx += 5 * (0.5 - ph / duty); else { const u = (ph - duty) / (1 - duty); fx += 5 * (-0.5 + u); fy -= 2.6 * Math.sin(Math.PI * u); } }
    if (o.idle) fy -= Math.max(0, Math.sin(o.ph + k * 1.9 + side)) * 0.6;
    // curled (dead/flipped): foot pulled towards body
    if (o.curl) { const w = Math.sin(o.ph + k * 1.7 + side * 2) * 3 * o.flail; fx = lerp(fx, L.bx + L.fx * 0.25 + w, o.curl); fy = lerp(fy, L.by + 7 + w * 0.5, o.curl); }
    else if (o.flail) { fx += Math.sin(o.ph + k * 2.3 + side) * 3 * o.flail; fy -= Math.abs(Math.cos(o.ph + k)) * 3 * o.flail; }
    fy = Math.min(fy, S.y0 + o.raise);
    const kx = lerp(L.bx, fx, L.kx || 0.42) + (L.fx > 0 ? 1 : -1) * 0.5, ky = Math.min(L.by, fy) - L.kh * (1 - 0.6 * o.curl) - o.raise * 0.3;
    const bias = far ? -0.25 : 0, col = far ? mix(S.col, S.dark, 0.45) : mix(S.col, S.dark, 0.2);
    P.cap(L.bx, L.by, kx, ky, L.r[0], L.r[0] * 0.8, col, { bias });
    P.cap(kx, ky, fx, fy - 0.3, L.r[0] * 0.8, L.r[1], col, { bias });
    P.px(kx, ky - 0.3, mix(S.col, '#fff0c8', 0.3), far ? 2 : 3);
  });
}
function drawBug(R, P, F, S, A, o) {
  const GY = S.gy, cx = S.fw / 2 + S.ox + o.dx;
  if (o.goo > 0) { R.group(); R.ell(cx, GY - 0.6, (6 + 10 * o.goo) * (S.k || 1), 1.4 + o.goo, S.id === 'spider' ? '#5a8a2a' : GOO, { bias: -0.1 }); }
  P.push(); P.tr(cx, GY); P.sc(S.k || 1, S.k || 1); P.tr(0, -S.y0 + o.bob - o.raise); P.rot(o.rot); P.sc(1, o.sy);
  BUGS[S.id](R, P, F, S, A, o);
  P.pop();
}
const BUGS = {
  scorpion(R, P, F, S, A, o) {
    const legs = [0, 1, 2, 3].map(k => ({ bx: 6 - k * 4.2, by: 2, fx: [10, 4, -3, -9][k], kh: 3.6, kx: [0.75, 0.6, 0.6, 0.75][k], r: [1.25, 0.5] }));
    // far claw + far legs
    claw(R, P, S, o, true);
    bugLegs(R, P, S, o, true, legs);
    // tail (metasoma) — drawn behind the body plates
    const tailPts = [[-18, -2]]; let a = -106 + o.tailA, p = tailPts[0];
    const segs = [6, 6.2, 6.2, 6.4, 6]; const angs = [];
    for (let k = 0; k < 5; k++) { a += (k === 0 ? 0 : 29 + o.tailCurl / 2); angs.push(a); const q = [p[0] + Math.cos(a * D2R) * segs[k], p[1] + Math.sin(a * D2R) * segs[k]]; tailPts.push(q); p = q; }
    for (let k = 0; k < 5; k++) { R.group(); const [p0, p1] = [tailPts[k], tailPts[k + 1]]; P.ell((p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, segs[k] / 2 + 1.0, 2.6 - k * 0.12, S.col, { rot: angs[k] }); P.px((p0[0] + p1[0]) / 2 - 0.5, (p0[1] + p1[1]) / 2 - 1.8, mix(S.col, '#fff0c8', 0.4), 4); }
    // telson: bulb + curved stinger
    const at = angs[4] + 40 + o.tailCurl * 0.6, ca = Math.cos(at * D2R), sa = Math.sin(at * D2R);
    R.group(); const b = [p[0] + ca * 2.6, p[1] + sa * 2.6]; P.ell(b[0], b[1], 3.6, 2.7, mix(S.col, '#c06a20', 0.4), { rot: at });
    P.px(b[0] - 0.6, b[1] - 1.2, '#ffd890', 4); P.px(b[0] + 0.6, b[1] + 0.6, S.acc, 3);
    const t1 = [b[0] + ca * 3.4, b[1] + sa * 3.4], ta = at + 70, t2 = [t1[0] + Math.cos(ta * D2R) * 3.4, t1[1] + Math.sin(ta * D2R) * 3.4];
    P.cap(b[0] + ca * 2, b[1] + sa * 2, t1[0], t1[1], 1.3, 0.9, '#3a2410'); P.cap(t1[0], t1[1], t2[0], t2[1], 0.9, 0.5, '#2a1a0c');
    if (!o.dead) { const g = P.p(t2[0], t2[1]); F.dot(g[0], g[1], o.glow || o.fx ? '#fff4c0' : '#ffaa22'); if (o.glow) F.dot(g[0], g[1] + 1, '#ffaa22'); }
    // mesosoma plates (rear first), belly band
    const plates = [];
    for (let k = 5; k >= 0; k--) { const g = R.group(); plates.push(g); P.ell(3.6 - k * 3.7, -0.4 + k * 0.1, 3.6, 5.1 - k * 0.22, S.col); P.px(3.6 - k * 3.7 - 0.8, -4.4 + k * 0.3, mix(S.col, '#fff0c8', 0.35), 4); }
    // carapace
    const cg = R.group(); P.ell(9.5, -0.6, 7.4, 4.7, S.col); P.ell(12, 0.6, 4.6, 3.6, S.col);
    P.px(13.5, -3.6, '#140c08', 0); P.px(12.8, -3.8, '#140c08', 0); P.px(13.5, -4.4, '#fff4d8', 4); P.px(9, -4.8, '#140c08', 1);
    P.px(7, -4.6, mix(S.col, '#fff0c8', 0.4), 4); P.px(8, -4.9, mix(S.col, '#fff0c8', 0.4), 4);
    // chitin glints & seams
    texture(R, [...plates, cg], (x, y, s) => (s === 3 && H2(x, y, 51) < 0.07) ? 4 : (s === 1 && H2(x, y, 52) < 0.12 ? 0 : undefined));
    // underside (lower body) lighter belly: local y > 2.6
    const belly = (x, y) => { const M = P.M, det = M[0] * M[3] - M[1] * M[2], dx = x - M[4], dy = y - M[5]; const ly = (-M[1] * dx + M[0] * dy) / det; return ly > 2.6; };
    R.paint(belly, S.belly, { g: [...plates, cg] });
    // chelicerae
    R.group(); P.cap(15.5, 1.5, 18, 2.4 + o.jaw * 0.2, 1.2, 0.7, S.dark); P.cap(15.5, 2.5, 17.6, 3.6 - o.jaw * 0.1, 1.1, 0.6, S.dark);
    bugLegs(R, P, S, o, false, legs.map(L => ({ ...L, by: L.by + 1 })));
    claw(R, P, S, o, false);
    bugFx(F, P, S, o, [22 + o.clawReach, 0]);
  },
  spider(R, P, F, S, A, o) {
    const legs = [0, 1, 2, 3].map(k => ({ bx: 7 - k * 2.4, by: 1, fx: [20, 9, -7, -17][k], kh: 12 - k * 0.8, r: [1.7, 0.6] }));
    bugLegs(R, P, S, o, true, legs);
    // abdomen with toxic markings
    const ag = R.group(); P.ell(-9, -3 + Math.sin(o.ph || 0) * 0.3, 10.5, 8.8 + (o.idle ? 0.3 * Math.sin(o.ph) : 0), S.col, { rot: -12 });
    P.ell(-16.5, 1.5, 2.2, 1.8, S.dark); // spinnerets
    for (const [x, y, r] of [[-6, -9, 1.6], [-10, -9.6, 1.4], [-14, -7.6, 1.2], [-4, -5, 1.2], [-8.5, -5.4, 1.5], [-12.5, -3.8, 1.1]]) { P.ell(x, y, r, r * 0.8, S.acc, { bias: 0.25 }); }
    P.px(-6.5, -9.5, '#f0ffc0', 4); P.px(-9, -6, '#f0ffc0', 4);
    fur(R, [ag], 0, 0, 61, 0.15);
    // cephalothorax + eyes + chelicerae
    const cg = R.group(); P.ell(5, -0.5, 6.4, 4.8, S.col); P.ell(9.2, 0.4, 3.4, 3.4, S.col);
    const ec = o.glow ? '#ff7060' : '#e02a1a';
    for (const [x, y] of [[10.5, -2.6], [11.6, -1.6], [9.4, -3.2], [11.8, -3]]) P.px(x, y, ec, 4);
    P.px(8, -3.6, ec, 3);
    texture(R, [cg], (x, y, s) => (s >= 3 && H2(x, y, 61) < 0.2) ? 4 : undefined);
    R.group(); const j = o.jaw * 0.3; P.cap(10.5, 2.4, 11.6 + j, 6.4, 1.6, 1.0, S.dark); P.px(11.8 + j, 7.2, TOOTH, 3); P.cap(13, 1.6, 15.6, 3 - j, 0.9, 0.6, S.col);
    bugLegs(R, P, S, o, false, legs.map(L => ({ ...L, by: L.by + 1 })));
    bugFx(F, P, S, o, [15, 3]);
  },
  beetle(R, P, F, S, A, o) {
    const legs = [0, 1, 2].map(k => ({ bx: 8 - k * 6, by: 2.5, fx: [9, 2, -9][k], kh: 3, r: [1.6, 0.8] }));
    bugLegs(R, P, S, o, true, legs);
    // elytra dome with iridescent sheen + toxic spots
    const eg = R.group(); P.ell(-3, -3, 13.5, 9.2, S.col);
    R.paint((x, y) => true, S.col, { g: eg });
    texture(R, [eg], (x, y, s) => s === 3 && H2(x, y, 71) < 0.3 ? 4 : undefined);
    P.line(-15, -2.4, 9, -2.8, S.dark, 1);
    R.paint((x, y) => { const q = P.p(-6, -7); return Math.hypot(x - q[0], y - q[1]) < 3.4; }, '#4a8a5a', { g: eg });
    for (const [x, y] of [[-10, -6], [-2, -8], [-6, -2]]) { P.px(x, y, S.acc, 4); P.px(x + 1, y, S.acc, 3); }
    // pronotum, head, horn, mandibles
    R.group(); P.ell(9.5, -1, 5, 5.8, mix(S.col, S.dark, 0.3)); P.px(8, -5, '#9ad0a0', 4);
    R.group(); P.ell(14, 1.5, 3.4, 3.2, S.dark); P.px(15.4, 0.4, '#ff4030', 4);
    R.group(); P.cap(14.5, -1, 17.5, -6, 1.8, 1.1, S.dark); P.cap(17.5, -6, 20.5, -9, 1.1, 0.5, S.dark); P.px(19, -7.6, '#9ad0a0', 3);
    R.group(); P.cap(16.5, 3, 19.5 + o.jaw * 0.2, 4.4 - o.jaw * 0.2, 1, 0.5, '#2a1a0c'); P.cap(16, 4, 19, 5.6 + o.jaw * 0.2, 1, 0.5, '#2a1a0c');
    bugLegs(R, P, S, o, false, legs.map(L => ({ ...L, by: L.by + 1 })));
    bugFx(F, P, S, o, [20, 3]);
  },
};
function claw(R, P, S, o, far) {
  // pedipalp: short arm segments + a swollen chela (palm) with a fixed and a movable finger
  R.group();
  const bias = far ? -0.25 : 0, col = far ? mix(S.col, S.dark, 0.35) : S.col, off = far ? [2.5, -3.5] : [0, 0];
  const L = o.clawLift, R2 = o.clawReach;
  const sh = [12 + off[0], 1.5 + off[1]], el = [16 + off[0] + R2 * 0.3, -2.5 - L * 0.5 + off[1]], wr = [20 + off[0] + R2 * 0.8, -1 - L + off[1]];
  P.cap(sh[0], sh[1], el[0], el[1], 1.5, 1.3, col, { bias }); P.cap(el[0], el[1], wr[0], wr[1], 1.4, 1.5, col, { bias });
  const hr = -6 - L * 2.5, c = Math.cos(hr * D2R), s = Math.sin(hr * D2R), hx = wr[0] + c * 4.2, hy = wr[1] + s * 4.2;
  R.group(); P.ell(hx, hy, 5.4, 3.7, col, { rot: hr, bias });
  if (!far) { P.px(hx - 1.6, hy - 2.2, '#ffe0a0', 4); P.px(hx - 0.6, hy - 2.5, '#ffd090', 3); }
  // fingers from the front of the palm
  const fx0 = hx + c * 4.4, fy0 = hy + s * 4.4, up = [s, -c];
  const ft = [fx0 + c * 5.4 + up[0] * 0.2, fy0 + s * 5.4 + up[1] * 0.2];
  P.cap(fx0 + up[0] * 1.3, fy0 + up[1] * 1.3, ft[0], ft[1], 1.7, 0.55, col, { bias });
  const oa = (hr + 6 + o.clawOpen) * D2R, mx0 = fx0 - up[0] * 1.3, my0 = fy0 - up[1] * 1.3;
  P.cap(mx0, my0, mx0 + Math.cos(oa) * 5, my0 + Math.sin(oa) * 5, 1.5, 0.5, mix(col, S.dark, 0.2), { bias });
  if (!far) P.px(ft[0] - c, ft[1] - s - 0.5, '#2a1a0c', 1);
}
function bugFx(F, P, S, o, mouth) {
  const m = P.p(mouth[0], mouth[1]);
  switch (o.fx) {
    case 'snap': { const q = P.p(30 + o.clawReach, 0); for (const s of [-1, 1]) F.line(q[0] + 1, q[1] + s * 4, q[0] + 4, q[1] + s * 1.5, '#fffbe8'); F.dot(q[0] + 5, q[1], '#fffbe8'); break; }
    case 'drip': F.dot(m[0] + 1, m[1] + 3, '#8fd14f'); F.dot(m[0] + 1, m[1] + 4, '#3f7a2a'); break;
    case 'venom1': case 'venom2': case 'venom3': { const t = { venom1: 0, venom2: 1, venom3: 2 }[o.fx]; const q = P.p(24, -16 + t * 3); for (let k = 0; k < 7; k++) F.dot(q[0] + t * 8 + k * 2.3, q[1] + k * 0.9 + t * 2 + (k % 2), k % 3 === 0 ? '#e0ff90' : '#8fd14f'); F.disc(q[0] + t * 8 + 16, q[1] + 6 + t * 3, 2.2, ['#3f7a2a', '#8fd14f', '#e0ff90'], { soft: 0.3 }); break; }
    case 'goo': for (let k = 0; k < 6; k++) F.dot(m[0] - 14 + H2(k, 3, 9) * 12, m[1] - 8 + H2(k, 4, 9) * 10, k % 2 ? '#8fd14f' : '#3f7a2a'); break;
    case 'dust': dust(F, m[0] - 12, S.gy, 4, 3, 4, true); break;
    case 'hiss1': case 'hiss2': for (let k = 0; k < 5; k++) { const a = (-40 + k * 20) * D2R, r = o.fx === 'hiss1' ? 5 : 8; F.dot(m[0] + 2 + Math.cos(a) * r, m[1] - 2 + Math.sin(a) * r, '#e0ff90'); } break;
  }
}

// ================================================================= SWARM (cloud of bloated mutant flies)
const SWARM = { fw: 96, fh: 92, gy: 86, shadow: 1.3 };
function drawSwarm(R, P, F, A, anim, i, n) {
  const GY = SWARM.gy, cx0 = SWARM.fw / 2, cy0 = GY - 30;
  const col = mix(A.skin && !HUMAN_SKINS.includes(A.skin) ? A.skin : '#2a3a1a', '#1a2410', 0.2), acc = A.accent && A.accent !== '#b4532a' ? A.accent : '#aaff44';
  const N = 26, Tn = i / n * Math.PI * 2, Ai = (a) => pick(a, i);
  let cx = cx0, cy = cy0, RX = 24, RY = 15, str = 1, tau = Tn, fall = 0, lean = 0, rise = 0;
  switch (anim) {
    case 'walk': lean = 5; str = 1.15; cx += 2; break;
    case 'attack': { const k = Ai([0.8, 0.65, 1.2, 1.5, 1.2, 1]); RX *= k; RY *= Ai([0.85, 0.7, 0.75, 0.7, 0.85, 1]); cx += Ai([-2, -5, 8, 14, 9, 2]); lean = Ai([0, -4, 12, 18, 10, 2]); tau = i * 0.7; break; }
    case 'shoot': RX *= Ai([0.8, 1.1, 1.3, 1.1, 1]); cx += Ai([-2, 4, 8, 5, 1]); lean = Ai([0, 8, 14, 8, 0]); tau = i * 0.8; break;
    case 'hurt': RX *= Ai([1.5, 1.25, 1.1]); RY *= Ai([1.5, 1.25, 1.1]); tau = i * 1.3; cx -= Ai([3, 2, 1]); break;
    case 'die': fall = i / (n - 1); RX *= 1 + fall * 0.6; tau = i * 0.5; break;
    case 'cast': RX *= Ai([1, 0.8, 0.55, 0.5, 0.55, 0.9]); rise = Ai([0, 4, 8, 10, 8, 2]); tau = i * 1.1; break;
  }
  const flies = [];
  for (let j = 0; j < N; j++) {
    const r = 0.25 + 0.75 * Math.sqrt(H2(j, 1, A.seed & 63)), a0 = H2(j, 2, 7) * Math.PI * 2, sp = [1, 2, -1, -2, 1, 3][j % 6], yo = (H2(j, 3, 7) - 0.5) * 1.6;
    const ang = a0 + sp * tau, depth = Math.sin(ang);
    let x = cx + Math.cos(ang) * r * RX * str + Math.sin(tau * 2 + j) * 1.4 + lean * (0.5 - depth * 0.5) * (r);
    let y = cy - rise * (1 - r * 0.5) + yo * RY + depth * r * RY * 0.35 + Math.cos(tau * 3 + j * 1.7) * 1.2;
    if (anim === 'cast') { y -= (1 - r) * 6 * Math.sin(ang * 2); }
    let dead = false;
    if (fall > 0) { const st = clamp(fall * 1.6 - H2(j, 4, 7) * 0.6, 0, 1); y = lerp(y, GY - 1 - (j % 3 === 0 ? 1 : 0), st * st); x += (H2(j, 5, 7) - 0.5) * 10 * st; dead = st >= 1; }
    flies.push({ x, y, depth, j, dead, glow: j % 7 === 0, big: j % 5 === 0 });
  }
  flies.sort((a, b) => a.depth - b.depth);
  if (anim === 'die' && i >= 3) { R.group(); R.ell(cx0, GY - 0.5, 4 + i * 2, 1 + i * 0.2, '#3a5a1a', { bias: -0.1 }); }
  for (const f of flies) {
    R.group();
    const s = f.big ? 1.25 : 1, bias = f.depth < -0.3 ? -0.18 : 0;
    if (f.dead) { R.ell(f.x, f.y, 1.8, 1.0, col, { bias: -0.1 }); R.px(f.x + 1, f.y - 0.5, f.glow ? acc : '#8a2a1a', 2); continue; }
    R.ell(f.x - 0.6, f.y, 2.1 * s, 1.5 * s, f.glow ? mix(col, acc, 0.6) : col, { bias });
    R.px(f.x + 1.6 * s, f.y - 0.4, '#d8301a', 3);
    if (f.glow) R.px(f.x - 1, f.y, acc, 4);
    // wings (flicker by frame, no outline)
    const up = (i + f.j) % 2 === 0, wy = f.y - (up ? 3 : 1.6) * s;
    F.dot(f.x - 1, wy, '#d8e8e4'); F.dot(f.x - 2, wy + (up ? 0 : 0), '#b0c4c0'); F.dot(f.x - 2, wy + (up ? 1 : -1), up ? '#eef6f2' : '#8aa09c'); if (f.big) F.dot(f.x - 3, wy + (up ? 0 : -1), '#9ab0ac');
  }
  // gnats: single dark specks filling the cloud
  for (let j = 0; j < 24; j++) { const a = H2(j, 8, 7) * 6.283 + tau * (j % 2 ? 2 : -1), r = Math.sqrt(H2(j, 9, 7)); let x = cx + Math.cos(a) * r * RX * 1.15 * str + lean * 0.5, y = cy - rise + (H2(j, 10, 7) - 0.5) * RY * 1.6; if (fall) y = lerp(y, GY - 1, clamp(fall * 1.5 - H2(j, 11, 7) * 0.5, 0, 1)); F.dot(x, y, j % 3 ? '#1a2010' : '#3a4a24'); }
  if (anim === 'attack' && (i === 3 || i === 4)) for (let k = 0; k < 6; k++) F.dot(cx + RX * 1.1 + H2(k, i, 3) * 8, cy - 8 + H2(k, i, 4) * 16, k % 2 ? '#fffbe8' : '#e0ff90');
  if (anim === 'hurt' && i === 0) for (let k = 0; k < 5; k++) F.dot(cx - 10 + H2(k, 9, 3) * 20, cy - 6 + H2(k, 9, 4) * 14, '#8fd14f');
  if (anim === 'cast') for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2 + i, r = 6 + i * 2; if (i > 0 && i < 5) F.dot(cx + Math.cos(a) * r, cy + 6 + Math.sin(a) * r * 0.3, '#aaff44'); }
}

// ================================================================= DRONE
const DRONE = { fw: 100, fh: 108, gy: 102, shadow: 1.1, alt: 50, k: 1.3 };
function dronePose(anim, i, n) {
  const o = { dx: 0, bob: 0, tilt: 0, led: 0, lens: 0, flash: 0, rotors: 1, wreck: 0, fx: null, recoil: 0, broken: 0 };
  const T = i / n * Math.PI * 2, A = (a) => pick(a, i);
  switch (anim) {
    case 'idle': o.bob = 1.6 * Math.sin(T); o.tilt = 2.2 * Math.sin(T + 1.2); o.led = i % 4 < 1 ? 1 : 0; o.lens = 0.5 + 0.5 * Math.sin(T * 2); break;
    case 'walk': o.bob = 0.8 * Math.sin(T * 2); o.tilt = 10 + 1.5 * Math.sin(T * 2); o.led = i % 2; o.lens = 0.5; break;
    case 'attack': o.dx = A([-4, -5, 6, 10, 6, 1]); o.tilt = A([-10, -14, 18, 22, 10, 2]); o.bob = A([-1, -2, 2, 3, 1, 0]); o.lens = 1; o.led = 1; o.fx = A([null, null, null, 'zap', 'spark', null]); break;
    case 'shoot': o.tilt = A([-3, -6, -4, -6, -2]); o.dx = A([0, -1.5, -0.5, -1.5, -0.5]); o.flash = A([0, 1, 0, 2, 0]); o.recoil = A([0, 1.5, 0.5, 1.5, 0.5]); o.lens = 1; o.led = 1; o.fx = A([null, 'shell', 'shell2', 'shell', 'muzsmoke']); break;
    case 'hurt': o.dx = A([-4, -3, -1]); o.tilt = A([-18, -10, -4]); o.bob = A([2, 1, 0]); o.lens = A([0, 1, 1]); o.fx = A(['hit', 'smoke', null]); break;
    case 'die':
      o.dx = A([-3, -4, -3, -2, -2, -2, -2]); o.tilt = A([-22, 34, 62, 24, 24, 24, 24]); o.bob = A([0, 9, 28, DRONE.alt - 10, DRONE.alt - 10, DRONE.alt - 10, DRONE.alt - 10]);
      o.rotors = A([1, 0.5, 0, 0, 0, 0, 0]); o.lens = A([0, 0.4, 0, 0, 0, 0, 0]); o.wreck = i >= 3 ? 1 : 0; o.broken = i >= 1 ? 1 : 0;
      o.fx = A(['hit', 'smoke', 'smoke2', 'boom', 'fire1', 'fire2', 'smoulder']); break;
    case 'cast': o.dx = A([0, 0.7, -0.7, 0.7, -0.7, 0]); o.bob = A([0, -1, -2, -3, -3, -1]); o.lens = A([1, 1.5, 2, 2.5, 3, 1]); o.led = 1; o.fx = A([null, 'charge1', 'charge2', 'charge3', 'charge3', null]); break;
  }
  return o;
}
function drawDrone(R, P, F, A, o, i) {
  const GY = DRONE.gy, hull = '#8a96a0', acc = A.accent && A.accent !== '#b4532a' ? A.accent : '#ff3322', dark = '#2c3238', arm = '#3c444c';
  const cx = DRONE.fw / 2 + o.dx, cy = GY - DRONE.alt + o.bob;
  P.push(); P.tr(cx, cy); P.sc(DRONE.k, DRONE.k); P.rot(o.tilt);
  const rotor = (x, y, far) => {
    if (o.rotors <= 0) return;
    const w = far ? 8 : 10, a = P.p(x - w, y), b = P.p(x + w, y), t = i % 2;
    F.line(a[0], a[1], b[0], b[1], (k, m) => { const u = Math.abs(k / m - 0.5) * 2; return u > 0.8 ? (t ? '#e8eef0' : '#a8b4ba') : (k + t) % 3 === 0 ? '#d8e0e4' : '#8a969e'; }, (k, m) => (o.rotors < 1 && k % 2 === 0) || (far && (k + t) % 2 === 0) || (Math.abs(k / m - 0.5) < 0.08));
    const c = P.p(x, y); if (!far) F.dot(c[0], c[1], '#3a4048');
  };
  const pod = (x, y, far, broken) => {
    R.group(); const bias = far ? -0.25 : 0, sx = Math.sign(x);
    P.cap(sx * 5.5, far ? -4.5 : -2.5, x, y + 1.5, far ? 0.9 : 1.15, far ? 0.8 : 1.0, far ? dark : arm, { bias });
    if (broken) { P.cap(x, y + 1.5, x - sx * 2, y + 3.5, 1, 0.8, arm); return; }
    P.cap(x, y + 2, x, y - 1.5, far ? 1.5 : 1.9, far ? 1.4 : 1.8, far ? arm : '#6a747c', { bias }); P.px(x - 0.8, y - 0.8, '#c8d0d8', far ? 2 : 4);
    P.cap(x, y - 2.4, x, y - 3.2, 0.7, 0.7, dark, { bias });
  };
  // far pods
  pod(-12, -7.5, true); pod(12.5, -7.5, true);
  // gun under the hull
  R.group(); P.cap(2.5, 4.5, 3.5, 8, 1.7, 1.5, dark);
  R.group(); P.cap(1 - o.recoil, 9, 7 - o.recoil, 9, 1.9, 1.7, '#4a525a'); P.cap(6 - o.recoil, 9, 15 - o.recoil, 9, 1.05, 1.0, '#3a4046'); P.cap(14 - o.recoil, 9, 16.5 - o.recoil, 9, 1.4, 1.4, '#1e2226');
  P.px(2 - o.recoil, 8, '#9aa4ac', 4); P.px(4 - o.recoil, 8, '#9aa4ac', 3); P.cap(3 - o.recoil, 10.5, 3.5 - o.recoil, 13, 1.1, 1.0, '#5a4a30');
  // hull
  const hg = R.group(); P.ell(0, 0, 11.5, 7.2, hull); P.ell(-1, 4.6, 8.5, 2.6, mix(hull, dark, 0.35), { bias: -0.05 });
  // hazard band, rust streaks, panel lines
  const loc = (x, y) => { const M = P.M, det = M[0] * M[3] - M[1] * M[2], dx = x - M[4], dy = y - M[5]; return [(M[3] * dx - M[2] * dy) / det, (-M[1] * dx + M[0] * dy) / det]; };
  R.paint((x, y) => { const [lx, ly] = loc(x + 0.5, y + 0.5); return ly > 1.2 && ly < 3.2 && lx < 4; }, '#c8a030', { g: hg });
  R.paint((x, y) => { const [lx, ly] = loc(x + 0.5, y + 0.5); return ly > 1.2 && ly < 3.2 && lx < 4 && (Math.floor(lx - ly) & 3) < 2; }, '#2a2420', { g: hg });
  R.paint((x, y) => { const [lx, ly] = loc(x + 0.5, y + 0.5); return ly > -4 && H2(Math.floor(lx), Math.floor(ly / 3), 77) < 0.12 && ly > -2; }, '#8a4a28', { g: hg });
  P.line(-6, -6, -6, 1, mix(hull, dark, 0.6), 1); P.line(3, -6.5, 3, -0.5, mix(hull, dark, 0.6), 1);
  for (let k = 0; k < 3; k++) P.px(-9.5, -2 + k * 1.6, '#1a1e22', 0);
  P.px(-3, -5.5, '#c8d4dc', 4); P.px(-2, -5.7, '#c8d4dc', 4); P.px(-4, -5, '#aab8c0', 3);
  // dome / top armour
  R.group(); P.ell(-1.5, -5, 7, 3, mix(hull, '#9aa8b4', 0.3)); P.px(-4, -6.6, '#e8f0f4', 4);
  // sensor head + lens
  R.group(); P.ell(8.5, 0.5, 4.8, 4.6, dark); P.ell(9.8, 0.5, 3, 3, mix(acc, '#3a0a08', o.lens > 0 ? 0 : 0.75), { bias: o.lens > 0 ? 0.1 + 0.05 * o.lens : -0.2 });
  if (o.lens > 0) { P.px(10.6, 0.5, '#ffe0c0', 4); P.px(9.6, -0.5, '#ffffff', 4); }
  // antenna + LED
  R.group(); P.line(-5, -7, -7.5, -14, '#9aa4ac', 2); const led = P.p(-7.6, -15);
  F.dot(led[0], led[1], o.led ? '#ff5040' : '#6a1a14'); if (o.led) { F.dot(led[0], led[1] - 1, '#ffd0c0'); }
  // near pods + rotors
  pod(-17, -5.5, false, o.broken); pod(17, -5.5, false);
  rotor(-12, -11, true); rotor(12.5, -11, true); if (!o.broken) rotor(-17, -9.2, false); rotor(17, -9.2, false);
  // muzzle flash / fx (local coords)
  const mz = P.p(17.5 - o.recoil, 9), lens = P.p(10, 0.5);
  if (o.flash) flash(F, mz[0], mz[1], o.tilt, o.flash === 1 ? 1.1 : 0.85);
  P.pop();
  const C = [cx, cy];
  switch (o.fx) {
    case 'shell': case 'shell2': { const q = [C[0] + 2, C[1] + 11]; F.dot(q[0] - (o.fx === 'shell2' ? 3 : 1), q[1] + (o.fx === 'shell2' ? 3 : 1), '#e8c060'); F.dot(q[0] - (o.fx === 'shell2' ? 3 : 1), q[1] + (o.fx === 'shell2' ? 4 : 2), '#a07a30'); break; }
    case 'muzsmoke': smoke(F, mz[0] + 3, mz[1] - 1, 2, 5, 2); break;
    case 'zap': sparks(F, lens[0] + 6, lens[1], 9, 21, 9, 0, 140); F.disc(lens[0] + 5, lens[1], 3, ['#46a0f2', '#a0e8ff', '#ffffff'], { soft: 0.4 }); break;
    case 'spark': sparks(F, lens[0] + 3, lens[1], 5, 22, 6, 20, 120); break;
    case 'hit': sparks(F, C[0] + 2, C[1] - 2, 10, 23, 11); break;
    case 'smoke': smoke(F, C[0] - 4, C[1] - 6, 2.6, 24, 3); sparks(F, C[0], C[1], 4, 25, 6); break;
    case 'smoke2': smoke(F, C[0] - 6, C[1] - 8, 3.2, 26, 4); F.disc(C[0] - 2, C[1] - 2, 3, FIRE.slice(1), { soft: 0.6 }); break;
    case 'boom': F.disc(C[0], C[1] - 2, 11, FIRE, { soft: 0.6 }); sparks(F, C[0], C[1] - 4, 14, 27, 20, -90, 220); dust(F, C[0], GY, 6, 28, 4, true); break;
    case 'fire1': F.disc(C[0] - 2, C[1] - 6, 5, FIRE.slice(0, 4), { soft: 0.7, sy: 1.4 }); smoke(F, C[0] - 4, C[1] - 16, 4.2, 29, 3); sparks(F, C[0], C[1] - 8, 6, 30, 14, -90, 120); break;
    case 'fire2': F.disc(C[0] - 2, C[1] - 5, 3.6, FIRE.slice(0, 4), { soft: 0.7, sy: 1.5 }); smoke(F, C[0] - 5, C[1] - 13, 3.8, 31, 4, 3); break;
    case 'smoulder': smoke(F, C[0] - 4, C[1] - 11, 2.6, 32, 3, 1); F.dot(C[0] - 1, C[1] - 5, '#ff9a2a'); F.dot(C[0] + 2, C[1] - 4, '#d8481a'); break;
    case 'charge1': case 'charge2': case 'charge3': { const r = { charge1: 5, charge2: 8, charge3: 11 }[o.fx]; for (let k = 0; k < 14; k++) { const a = k / 14 * Math.PI * 2; if ((k + i) % 2) F.dot(lens[0] + Math.cos(a) * r, lens[1] + Math.sin(a) * r, '#ff5040'); } F.disc(lens[0], lens[1], 2 + r * 0.15, ['#ff3322', '#ff9a80', '#fff0e0'], { soft: 0.3 }); break; }
  }
}

// ================================================================= TURRET
const TURRET = { fw: 104, fh: 88, gy: 82, shadow: 1.8 };
function turretPose(anim, i, n) {
  const o = { yaw: 0, elev: 0, eye: 1, flash: 0, recoil: 0, dx: 0, fx: null, dead: 0, pop: [0, 0, 0], laser: 0, spin: 0 };
  const T = i / n * Math.PI * 2, A = (a) => pick(a, i);
  switch (anim) {
    case 'idle': o.yaw = 68 * Math.sin(T); o.elev = 2 * Math.sin(T * 2); o.eye = i % 4 === 3 ? 0.3 : 1; break;
    case 'walk': o.yaw = 75 * Math.sin(T); o.eye = 1; break;
    case 'attack': case 'shoot': {
      const six = anim === 'attack';
      o.flash = six ? A([0, 1, 2, 1, 2, 0]) : A([0, 1, 2, 1, 0]); o.recoil = o.flash ? (o.flash === 1 ? 2.5 : 1.2) : 0; o.elev = -2; o.eye = 1.6; o.spin = i;
      o.fx = six ? A([null, 'shell', 'shell2', 'shell', 'shell2', 'muzsmoke']) : A([null, 'shell', 'shell2', 'shell', 'muzsmoke']); o.dx = o.flash === 1 ? -0.6 : 0; break;
    }
    case 'hurt': o.elev = A([10, 5, 1]); o.yaw = A([-14, -6, 0]); o.eye = A([0, 1, 1]); o.dx = A([-1.5, -0.6, 0]); o.fx = A(['hit', 'smoke', null]); break;
    case 'die':
      o.eye = 0; o.dead = 1; o.elev = A([12, 20, 0, 0, 0, 0, 0]); o.pop = A([[0, 0, 0], [0, -1, -6], [-3, -12, -38], [-6, 2, 34], [-6, 2, 34], [-6, 2, 34], [-6, 2, 34]]);
      o.fx = A(['hit', 'boom1', 'boom2', 'debris', 'fire1', 'fire2', 'smoulder']); break;
    case 'cast': o.laser = A([0, 1, 1, 1, 1, 0]); o.eye = A([1, 2, 2.5, 3, 2.5, 1]); o.yaw = A([10, 4, 0, 0, 0, 0]); o.elev = A([0, -1, -2, -2, -2, 0]); break;
  }
  return o;
}
function drawTurret(R, P, F, A, o, i) {
  const GY = TURRET.gy, cx = TURRET.fw / 2 + o.dx, metal = A.skin && !HUMAN_SKINS.includes(A.skin) ? A.skin : '#6a6a5a', acc = A.accent && A.accent !== '#b4532a' ? A.accent : '#ffaa22';
  const sand = '#a89060', dark = '#2c3034', steel = '#4a5058';
  // back sandbag row + concrete base
  const bag = (x, y, far) => { R.group(); R.ell(x, y, 4.4, 2.6, far ? mix(sand, '#4a3a28', 0.3) : sand, { bias: far ? -0.15 : 0 }); R.px(x - 1, y - 1.4, '#e0cc98', far ? 2 : 4); R.px(x + 3.4, y + 0.4, '#5a4a30', 0); };
  for (let k = 0; k < 7; k++) bag(cx - 18 + k * 6, GY - 9.5, true);
  R.group(); R.poly([[cx - 16, GY - 8], [cx + 16, GY - 8], [cx + 19, GY - 1], [cx - 19, GY - 1]], '#7d766b');
  R.paint((x, y) => H2(x, y, 81) < 0.12, '#4d4842', { g: R.g });
  // pedestal + slewing ring
  R.group(); R.cap(cx, GY - 6, cx, GY - 15, 4.4, 3.8, steel); R.px(cx - 2, GY - 13, '#9aa2aa', 4);
  R.group(); R.ell(cx, GY - 16.5, 9, 2.6, dark); R.px(cx - 5, GY - 17.5, '#6a727a', 3);
  // housing (pops off when destroyed)
  const pv = [cx, GY - 22];
  P.push(); P.tr(o.pop[0], o.pop[1]); P.rot(o.pop[2] + o.elev * 0.25, pv[0], pv[1]);
  const yc = Math.cos(o.yaw * D2R), ys = Math.sin(o.yaw * D2R), sg = yc >= 0 ? 1 : -1, ws = 0.62 + 0.38 * Math.abs(yc);
  const fr = cx + 11 * ws * sg, bk = cx - 11 * ws * sg, top = GY - 34, bot = GY - 19;
  // ammo drum at the rear, belt feeding into the housing
  const ammo = () => { R.group(); const ax0 = bk - 1.5 * sg; P.cap(ax0, GY - 26, ax0, GY - 20.5, 4.2, 4.2, '#4e5a34'); P.px(ax0 - 1.6, GY - 27.5, '#a8b878', 4); P.px(ax0 - 2.4, GY - 26.5, '#8a9a5a', 3); P.line(ax0 - 3.5, GY - 23, ax0 + 3.5, GY - 23, '#2e3620', 1); };
  ammo();
  // barrels (twin), foreshortened by yaw; elevation pivots at the mantlet
  const bl = 19 * Math.abs(yc) + 3, bx = cx + 8 * ws * sg;
  const barrels = () => {
    P.push(); P.rot(o.elev * sg, bx, GY - 26);
    for (const [dy, far] of [[-29, true], [-24.5, false]]) {
      R.group(); const x0 = bx - o.recoil * (far ? 0.6 : 1) * sg, y = GY + dy;
      P.cap(x0, y, x0 + bl * sg, y, 1.6, 1.5, far ? '#24282c' : '#30363c', { bias: far ? -0.15 : 0 });
      P.cap(x0 + 1 * sg, y, x0 + bl * 0.45 * sg, y, 2.4, 2.4, far ? '#3a4046' : '#4a525a', { bias: far ? -0.15 : 0 });
      for (let k = 0; k < 3; k++) P.px(x0 + (2.5 + k * 2) * sg, y, '#141618', 0);
      P.cap(x0 + (bl - 1.5) * sg, y, x0 + (bl + 0.5) * sg, y, 2.0, 2.0, '#1a1e22');
    }
    const tip = P.p(bx - o.recoil * sg + (bl + 1.5) * sg, GY - 26.7); P.pop(); return tip;
  };
  let tip = null;
  if (yc < 0) tip = barrels();
  // housing body: sloped armoured box with mantlet
  const hg = R.group();
  P.poly([[bk, top + 1], [bk + 2 * sg, top], [cx + 4 * ws * sg, top], [fr, top + 6], [fr, bot], [bk, bot]], metal);
  R.paint((x, y) => y >= GY - 22 && y <= GY - 21 && ((x >> 1) & 1), '#d8a020', { g: hg });
  R.paint((x, y) => y >= GY - 22 && y <= GY - 21 && !((x >> 1) & 1), '#2a2420', { g: hg });
  R.paint((x, y) => H2(x >> 1, y, 83) < 0.1 && y > GY - 30, '#8a4a28', { g: hg });
  P.line(bk + 2 * sg, top + 1, cx + 3.5 * ws * sg, top + 1, mix(metal, '#fff0c8', 0.4), 4);
  P.line(cx - 2 * ws * sg, top + 2, cx - 2 * ws * sg, bot - 1, mix(metal, '#1a1810', 0.5), 1);
  for (const k of [-0.7, 0.1, 0.8]) { P.px(cx + 10 * k * ws * sg, bot - 1.5, '#2a2a24', 1); P.px(cx + 10 * k * ws * sg, top + 3, '#d8d8c8', 4); }
  // white stencil number on the side
  if (Math.abs(yc) > 0.5) { const nx = cx - 6 * ws * sg; for (const [dx, dy] of [[0, 0], [1, 0], [1, 1], [0, 2], [1, 2], [0, 3], [0, 4], [1, 4]]) P.px(nx + dx * sg, GY - 30 + dy, '#d8d2c0', 3); }
  R.group(); P.ell(fr - 0.5 * sg, GY - 26, 3.2, 4.2, mix(metal, '#2a2a24', 0.4));
  // sensor eye
  const ex = cx + 5 * ws * sg + 3 * ys, ey = GY - 30.5;
  R.group(); P.ell(ex, ey, 2.3, 2.1, dark);
  const eyeC = o.eye > 0.5 ? acc : '#3a2410';
  P.px(ex, ey, eyeC, o.eye > 0.5 ? 3 : 1); P.px(ex + 0.6, ey - 0.6, o.eye > 0.5 ? '#fff4d0' : '#5a3a20', o.eye > 0.5 ? 4 : 1);
  // antenna
  R.group(); P.line(bk + 3 * sg, top, bk + 2 * sg, top - 7, '#8a949c', 2);
  if (yc >= 0) tip = barrels();
  const eyeW = P.p(ex, ey);
  P.pop();
  // front sandbag row
  for (let k = 0; k < 6; k++) bag(cx - 15 + k * 6, GY - 2.8, false);
  for (let k = 0; k < 2; k++) bag(cx - 21 + k * 42, GY - 5, false);
  // fx
  if (o.flash && tip) flash(F, tip[0], tip[1], o.elev, o.flash === 1 ? 1.15 : 0.8);
  if (o.eye > 1.2) F.disc(eyeW[0], eyeW[1], 1 + o.eye * 0.6, [acc, '#ffe0a0', '#fffbe8'], { soft: 0.4 });
  if (o.laser && tip) F.line(tip[0] + 1, tip[1] + 3, TURRET.fw - 1, tip[1] + 3 + (i % 2), (k) => k % 7 === 0 ? '#ffb0a0' : '#ff3020', (k) => (k + i) % 4 === 3);
  const C = [cx, GY - 24];
  switch (o.fx) {
    case 'shell': case 'shell2': { const s = o.fx === 'shell2' ? 1 : 0; F.dot(cx - 6 - s * 3, GY - 22 + s * 4, '#e8c060'); F.dot(cx - 6 - s * 3, GY - 21 + s * 4, '#a07a30'); break; }
    case 'muzsmoke': if (tip) smoke(F, tip[0] + 3, tip[1] - 1, 2.2, 41, 2); break;
    case 'hit': sparks(F, C[0] + 2, C[1] - 2, 10, 43, 12); break;
    case 'smoke': smoke(F, C[0] - 3, C[1] - 8, 2.6, 44, 3); break;
    case 'boom1': F.disc(C[0], C[1], 8, FIRE, { soft: 0.5 }); sparks(F, C[0], C[1], 10, 45, 16); break;
    case 'boom2': F.disc(C[0] - 2, C[1] + 2, 12, FIRE, { soft: 0.6 }); sparks(F, C[0], C[1], 16, 46, 24, -90, 240); smoke(F, C[0] + 2, C[1] - 12, 4.5, 47, 2); break;
    case 'debris': smoke(F, C[0] - 2, C[1] - 6, 5, 48, 3); F.disc(C[0] + 1, GY - 18, 5, FIRE.slice(0, 4), { soft: 0.7, sy: 1.3 }); sparks(F, C[0], C[1], 8, 49, 18, -90, 160); break;
    case 'fire1': F.disc(cx + 2, GY - 19, 4.6, FIRE.slice(0, 4), { soft: 0.7, sy: 1.5 }); smoke(F, cx, GY - 30, 4.4, 50, 3); break;
    case 'fire2': F.disc(cx + 2, GY - 18, 3.4, FIRE.slice(0, 4), { soft: 0.7, sy: 1.6 }); smoke(F, cx - 1, GY - 28, 3.8, 51, 4, 2); break;
    case 'smoulder': smoke(F, cx, GY - 26, 2.8, 52, 3, 1); F.dot(cx + 2, GY - 18, '#ff9a2a'); F.dot(cx + 4, GY - 17, '#d8481a'); break;
  }
}

// ================================================================= sheet assembly
function buildSheet(spec, A, drawFrame) {
  const anims = spec.anims || CANIMS, cols = Math.max(...CANIM_ORDER.map(a => anims[a].n)), rows = CANIM_ORDER.length;
  const { fw, fh } = spec;
  const [cv, g] = mkCanvas(fw * cols, fh * rows);
  const info = {};
  CANIM_ORDER.forEach((anim, r) => {
    const n = anims[anim].n; info[anim] = { row: r, n };
    for (let i = 0; i < n; i++) {
      const R = new Raster(fw, fh), P = new Pen(R), F = new Fx(fw, fh);
      drawFrame(R, P, F, anim, i, n);
      const img = g.createImageData(fw, fh);
      F.run(img, F.under); R.blit(img, 0, 0); F.run(img, F.ops);
      g.putImageData(img, i * fw, r * fh);
    }
  });
  return { canvas: cv, info, anims, fw, fh, gy: spec.gy, hpx: HPX, cols, rows, shadow: spec.shadow };
}

export function buildCreatureSheet(A) {
  if (!A) return null;
  const tid = A.tid || '';
  if (A.kind === 'beast') {
    let id = A.variant || 'dog';
    if (/kret|mole|kopacz/.test(tid)) id = 'mole';
    if (!QUAD[id]) id = 'dog';
    const base = QUAD[id], S = { ...base, id };
    if (A.skin && !HUMAN_SKINS.includes(A.skin)) S.col = A.skin, S.belly = mix(A.skin, '#d8c8a8', 0.38), S.back = mix(A.skin, '#1a1210', 0.45);
    if (A.accent && A.accent !== '#b4532a') { if (id === 'mole') S.claw = A.accent; else S.eye = A.accent; }
    if (A.mutSeed) {   // random mutation: proportions + growths, deterministic per seed
      let sd = A.mutSeed >>> 0; const r = () => ((sd = Math.imul(sd ^ (sd >>> 15), 2246822519) + 0x9e3779b9 >>> 0) / 4294967296), j = (lo, hi) => lo + (hi - lo) * r();
      const big = j(0.92, 1.16), hq = j(0.9, 1.14);
      S.chest = [S.chest[0], S.chest[1], S.chest[2] * big, S.chest[3] * big]; S.haunch = [S.haunch[0], S.haunch[1], S.haunch[2] * hq, S.haunch[3] * hq]; S.waist = [S.waist[0] * (big + hq) / 2, S.waist[1] * (big + hq) / 2];
      S.hk = (S.hk || 1) * j(0.9, 1.18); S.tail = { ...S.tail, len: S.tail.len * j(0.6, 1.5), curl: S.tail.curl * j(0.5, 1.8) };
      const kind = r();
      S.mutF = { sd: A.mutSeed & 1023, ph: j(0, 6), spikes: kind < 0.55 && id !== 'mole' ? 3 + (r() * 4 | 0) : 0, spikeH: j(4, 7.5), spikeCol: r() < 0.6 ? BONE : mix(S.back, '#000000', 0.3),
        pust: kind > 0.35 ? 2 + (r() * 4 | 0) : 0, glow: A.accent && A.accent !== '#b4532a' ? A.accent : '#8fff40', hump: r() < 0.3 && id !== 'mole' && id !== 'rat' };
    }
    return buildSheet(S, A, (R, P, F, anim, i, n) => drawQuad(R, P, F, S, A, quadPose(S, anim, i, n)));
  }
  if (A.kind === 'insect') {
    if (A.variant === 'swarm') return buildSheet(SWARM, A, (R, P, F, anim, i, n) => drawSwarm(R, P, F, A, anim, i, n));
    const id = BUG[A.variant] ? A.variant : 'beetle', S = { ...BUG[id], id };
    if (A.skin && !HUMAN_SKINS.includes(A.skin)) { S.col = A.skin; S.belly = mix(A.skin, '#f0d8a0', 0.4); S.dark = mix(A.skin, '#1a1008', 0.55); }
    if (A.accent && A.accent !== '#b4532a') S.acc = A.accent;
    if (A.mutSeed) { const f = 0.9 + ((A.mutSeed >>> 3) % 23) / 100; S.k = (S.k || 1) * f; }
    return buildSheet(S, A, (R, P, F, anim, i, n) => drawBug(R, P, F, S, A, bugPose(S, anim, i, n)));
  }
  if (A.kind === 'drone') return buildSheet(DRONE, A, (R, P, F, anim, i, n) => drawDrone(R, P, F, A, dronePose(anim, i, n), i));
  if (A.kind === 'turret') return buildSheet(TURRET, A, (R, P, F, anim, i, n) => drawTurret(R, P, F, A, turretPose(anim, i, n), i));
  return null;
}
