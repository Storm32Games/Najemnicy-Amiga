// Pikselowe kości PF2e (port Oldgame/src/gfx/dice.js do 2D, rozszerzony): k4, k6, k8, k10, k12, k20 - bez k100.
// Prawdziwe bryły (czworościan, sześcian, ośmiościan, trapezościan pięciokątny, dwunastościan, dwudziestościan)
// rzutowane i rastrowane w PixelCanvas: płaskie cieniowanie ścianek rampą emalii z ditheringiem, mosiężne
// krawędzie, znaczki cyfr na ściankach, obrys sel-out. Kolor emalii: zielony (najemnicy) albo czerwony (wrogowie).
// Arkusz: klatki toczenia t0..t11, osiadania s0..s2 i końcowa 'end' (ścianka zwrócona do patrzącego - na nią
// scena kładzie wyrzuconą liczbę).

import { PixelCanvas, type RGB, bayer, clamp01, mix, pick } from '../iso/Pixel';

/** Rodzaje kości PF2e (k100 celowo pominięte). */
export type DieSides = 4 | 6 | 8 | 10 | 12 | 20;
export const DIE_SIDES: readonly DieSides[] = [4, 6, 8, 10, 12, 20];
/** Kolor kości: zielony = najemnicy gracza, czerwony = przeciwnicy. */
export type DieColor = 'green' | 'red';

export const D20_SIZE = 48;
/** Rozmiar klatki kości obrażeń (mniejsze niż k20 testu). */
export const DMG_DIE_SIZE = 32;
export const D20_TUMBLE = 12;
export const D20_SETTLE = 3;
export const DIE_TUMBLE = D20_TUMBLE;
export const DIE_SETTLE = D20_SETTLE;

type V3 = [number, number, number];
type Q = [number, number, number, number]; // w, x, y, z

const PHI = (1 + Math.sqrt(5)) / 2;
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scl = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: V3): number => Math.hypot(a[0], a[1], a[2]);
const norm = (a: V3): V3 => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

/** Wierzchołki brył (dowolna skala - normalizowane do promienia 1). */
function solidVerts(sides: DieSides): V3[] {
  const s = (xs: number[], ys: number[], zs: number[]): V3[] => xs.flatMap((x) => ys.flatMap((y) => zs.map((z) => [x, y, z] as V3)));
  switch (sides) {
    case 4:
      return [[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]];
    case 6:
      return s([-1, 1], [-1, 1], [-1, 1]);
    case 8:
      return [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
    case 10: {
      // trapezościan pięciokątny: ścianki-latawce są płaskie, gdy h = z0 (1 + cos36) / (1 - cos36)
      const c36 = Math.cos(Math.PI / 5), z0 = 0.11, h = (z0 * (1 + c36)) / (1 - c36);
      const out: V3[] = [[0, h, 0], [0, -h, 0]];
      for (let k = 0; k < 5; k++) {
        const a = (k * 2 * Math.PI) / 5, b = a + Math.PI / 5;
        out.push([Math.cos(a), z0, Math.sin(a)], [Math.cos(b), -z0, Math.sin(b)]);
      }
      return out;
    }
    case 12: {
      const i = 1 / PHI;
      return [
        ...s([-1, 1], [-1, 1], [-1, 1]),
        ...s([0], [-i, i], [-PHI, PHI]),
        ...s([-i, i], [-PHI, PHI], [0]),
        ...s([-PHI, PHI], [0], [-i, i]),
      ];
    }
    case 20:
      return [
        [-1, PHI, 0], [1, PHI, 0], [-1, -PHI, 0], [1, -PHI, 0],
        [0, -1, PHI], [0, 1, PHI], [0, -1, -PHI], [0, 1, -PHI],
        [PHI, 0, -1], [PHI, 0, 1], [-PHI, 0, -1], [-PHI, 0, 1],
      ];
  }
}

interface Solid {
  verts: V3[];
  /** Ścianki jako listy wierzchołków uporządkowane przeciwnie do wskazówek zegara patrząc z zewnątrz. */
  faces: number[][];
}

/** Otoczka wypukła małej bryły: płaszczyzny przez trójki wierzchołków, które mają resztę po jednej stronie. */
function buildSolid(sides: DieSides): Solid {
  const raw = solidVerts(sides);
  const rmax = Math.max(...raw.map(len));
  const verts = raw.map((v) => scl(v, 1 / rmax));
  const n = verts.length, EPS = 1e-5;
  const faces: number[][] = [];
  const seen = new Set<string>();
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++)
      for (let k = j + 1; k < n; k++) {
        let nn = cross(sub(verts[j], verts[i]), sub(verts[k], verts[i]));
        if (len(nn) < EPS) continue;
        nn = norm(nn);
        let d0 = dot(nn, verts[i]);
        if (d0 < 0) { nn = scl(nn, -1); d0 = -d0; }
        if (verts.some((v) => dot(nn, v) > d0 + EPS)) continue;
        const on = verts.map((v, idx) => (Math.abs(dot(nn, v) - d0) < EPS ? idx : -1)).filter((x) => x >= 0);
        const key = on.join(',');
        if (seen.has(key)) continue;
        seen.add(key);
        // sortuj wokół środka ścianki, przeciwnie do zegara względem normalnej
        const c = scl(on.reduce((acc, idx) => add(acc, verts[idx]), [0, 0, 0] as V3), 1 / on.length);
        const ux = norm(sub(verts[on[0]], c)), uy = cross(nn, ux);
        on.sort((a, b) => {
          const pa = sub(verts[a], c), pb = sub(verts[b], c);
          return Math.atan2(dot(pa, uy), dot(pa, ux)) - Math.atan2(dot(pb, uy), dot(pb, ux));
        });
        faces.push(on);
      }
  return { verts, faces };
}

const qmul = (a: Q, b: Q): Q => [
  a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
  a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
  a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1],
  a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0],
];
const qaxis = (ax: V3, ang: number): Q => { const n = norm(ax), s = Math.sin(ang / 2); return [Math.cos(ang / 2), n[0] * s, n[1] * s, n[2] * s]; };
const qrot = (q: Q, v: V3): V3 => {
  const p = qmul(qmul(q, [0, v[0], v[1], v[2]]), [q[0], -q[1], -q[2], -q[3]]);
  return [p[1], p[2], p[3]];
};
function qslerp(a: Q, b: Q, t: number): Q {
  let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  let bb = b;
  if (d < 0) { d = -d; bb = [-b[0], -b[1], -b[2], -b[3]]; }
  if (d > 0.9995) return a.map((x, i) => x + (bb[i] - x) * t) as Q;
  const th = Math.acos(d), s = Math.sin(th);
  const ka = Math.sin((1 - t) * th) / s, kb = Math.sin(t * th) / s;
  const r = a.map((x, i) => x * ka + bb[i] * kb) as Q;
  const l = Math.hypot(...r);
  return r.map((x) => x / l) as Q;
}

const faceCenter = (s: Solid, f: number[]): V3 => scl(f.reduce((acc, i) => add(acc, s.verts[i]), [0, 0, 0] as V3), 1 / f.length);

/**
 * Obrót, po którym ścianka 0 patrzy w stronę widza (+z), a jej najdalszy od środka wierzchołek wypada u góry
 * (trójkąt i pięciokąt stoją na podstawie, latawiec k10 ostrzem w górę); kwadrat k6 dostaje +45° - prosto.
 */
function faceOnQuat(s: Solid): Q {
  const f = s.faces[0];
  const c = faceCenter(s, f);
  const cn = norm(c);
  const axis = cross(cn, [0, 0, 1]);
  const q1 = len(axis) < 1e-6 ? (cn[2] > 0 ? ([1, 0, 0, 0] as Q) : qaxis([1, 0, 0], Math.PI)) : qaxis(axis, Math.acos(Math.max(-1, Math.min(1, cn[2]))));
  let up = f[0], best = -1;
  for (const i of f) {
    const dd = len(sub(s.verts[i], c));
    if (dd > best + 1e-4) { best = dd; up = i; }
  }
  const v = sub(qrot(q1, s.verts[up]), qrot(q1, c));
  let ang = Math.atan2(v[0], v[1]);
  if (f.length === 4 && s.verts.length === 8) ang += Math.PI / 4;
  return qmul(qaxis([0, 0, 1], ang), q1);
}

/** Rampy emalii: zielona (najemnicy) i czerwona (wrogowie). */
const ENAMEL: Record<DieColor, RGB[]> = {
  red: [0x2a0a08, 0x4a120e, 0x761c14, 0xa0281a, 0xc43a22, 0xe0603a, 0xf8a070, 0xffe0c0],
  green: [0x06200c, 0x0c3814, 0x14581e, 0x1e7a2a, 0x2e9c38, 0x52c058, 0x98e890, 0xe0ffd0],
};
const INK: Record<DieColor, RGB> = { red: 0xf0d8a8, green: 0xf0f8d0 };
const BRASS_LIT = 0xffe0a0, BRASS_DK = 0x6a4a20;
const LIGHT = norm([-0.55, 0.7, 0.75]);

/** Rasteryzuje kość w obrocie q na płótnie S x S. markFront = rysuj znaczek także na ściance frontowej. */
function rasterDie(s: Solid, q: Q, markFront: boolean, S: number, R: number, color: DieColor): PixelCanvas {
  const C = S / 2;
  const ramp = ENAMEL[color];
  const pc = new PixelCanvas(S, S);
  const P = s.verts.map((v) => qrot(q, v));
  const scr = P.map((v) => [C + v[0] * R, C - v[1] * R] as [number, number]);
  const faces = s.faces.map((f, idx) => {
    const n = norm(cross(sub(P[f[1]], P[f[0]]), sub(P[f[2]], P[f[0]])));
    const zc = f.reduce((acc, i) => acc + P[i][2], 0) / f.length;
    return { f, n, zc, idx };
  }).filter((x) => x.n[2] > 0).sort((a, b) => a.zc - b.zc);
  const markR = s.faces[0].length === 3 ? 0.55 : 0.4;
  for (const { f, n, idx } of faces) {
    const diff = Math.max(0, dot(n, LIGHT));
    const spec = Math.pow(Math.max(0, n[2] * 0.5 + diff * 0.5), 18);
    const v = clamp01(0.14 + diff * 0.72 + spec * 0.35 + ((idx * 7) % 5) * 0.012);
    const poly = f.map((i) => scr[i]);
    pc.poly(poly, (x, y) => pick(ramp, v, x, y));
    // mosiężne krawędzie: jaśniejsze po stronie światła
    const edge = mix(BRASS_DK, BRASS_LIT, clamp01(diff * 1.1));
    const ec = n[2] > 0.25 ? edge : mix(edge, ramp[1], 0.5);
    for (let e = 0; e < poly.length; e++) {
      const a = poly[e], b = poly[(e + 1) % poly.length];
      pc.line(a[0], a[1], b[0], b[1], ec);
    }
    // znaczek cyfry na ściankach zwróconych do widza
    if (n[2] > markR && (markFront || n[2] < 0.97)) {
      const cx = poly.reduce((acc, p) => acc + p[0], 0) / poly.length, cy = poly.reduce((acc, p) => acc + p[1], 0) / poly.length;
      const big = n[2] > 0.8 && R >= 16;
      const ink = mix(INK[color], ramp[2], 1 - n[2]);
      if (big) {
        pc.rect(Math.round(cx - 1), Math.round(cy - 1), 3, 1, ink);
        pc.rect(Math.round(cx), Math.round(cy - 1), 1, 3, ink);
        pc.rect(Math.round(cx - 1), Math.round(cy + 1), 3, 1, ink);
      } else pc.rect(Math.round(cx), Math.round(cy), 1 + (bayer(idx, 1) > 0.5 ? 1 : 0), 1, ink);
    }
  }
  pc.outline(0.25, 0x0a0404, 1);
  return pc;
}

export interface DieSheet {
  pc: PixelCanvas;
  frames: { name: string; x: number; y: number; w: number; h: number }[];
  /** Środek ścianki frontowej na klatce 'end' (piksele klatki). */
  face: { x: number; y: number };
  size: number;
}
/** Zgodność wstecz. */
export type D20Sheet = DieSheet;

const SOLIDS = new Map<DieSides, Solid>();
const solid = (sides: DieSides): Solid => {
  let s = SOLIDS.get(sides);
  if (!s) SOLIDS.set(sides, (s = buildSolid(sides)));
  return s;
};

/** Promień rysowania wg bryły (sześcian i czworościan wyglądają mniejsze przy tym samym promieniu opisanym). */
const RADIUS_K: Record<DieSides, number> = { 4: 0.5, 6: 0.5, 8: 0.47, 10: 0.46, 12: 0.47, 20: 0.475 };

/** Klucz tekstury Phasera dla kości. */
export const dieTexKey = (sides: DieSides, color: DieColor, size: number): string => `die-k${sides}-${color}-${size}`;

/** Arkusz klatek kości (stały - liczbę nakłada scena). */
export function paintDieSheet(sides: DieSides, color: DieColor, size: number = sides === 20 ? D20_SIZE : DMG_DIE_SIZE): DieSheet {
  const S = size, R = Math.round(S * RADIUS_K[sides]);
  const sol = solid(sides);
  // kości obrażeń kończą lekko pochylone (widać bryłę, nie płaski kafel); k20 jak w oryginale - prosto
  const qEnd = sides === 20 ? faceOnQuat(sol) : qmul(qmul(qaxis([1, 0, 0], -0.42), qaxis([0, 1, 0], 0.36)), faceOnQuat(sol));
  const q0: Q = qmul(qaxis([0.3, 1, 0.2], 2.1 + sides * 0.37), qaxis([1, 0, 0.4], 1.3));
  const spinAxis: V3 = [0.62, 0.71, 0.33];
  const list: { name: string; q: Q; front: boolean }[] = [];
  for (let i = 0; i < DIE_TUMBLE; i++) list.push({ name: `t${i}`, q: qmul(qaxis(spinAxis, i * 0.62), q0), front: true });
  const last = list[list.length - 1].q;
  const afterSpin = qmul(qaxis(spinAxis, 0.62), last);
  for (let i = 0; i < DIE_SETTLE; i++) list.push({ name: `s${i}`, q: qslerp(afterSpin, qEnd, (i + 1) / (DIE_SETTLE + 1)), front: true });
  list.push({ name: 'end', q: qEnd, front: false });
  const pc = new PixelCanvas(S * list.length, S);
  const frames = list.map((it, f) => {
    const one = rasterDie(sol, it.q, it.front, S, R, color);
    for (let y = 0; y < S; y++) pc.data.set(one.data.subarray(y * S * 4, (y + 1) * S * 4), (y * pc.w + f * S) * 4);
    return { name: it.name, x: f * S, y: 0, w: S, h: S };
  });
  // środek ścianki 0 po obrocie końcowym
  const c = qrot(qEnd, faceCenter(sol, sol.faces[0]));
  const face = { x: S / 2 + c[0] * R, y: S / 2 - c[1] * R };
  return { pc, frames, face, size: S };
}

/** Czerwona k20 (zgodność wstecz z dawnym D20Art). */
export const paintD20Sheet = (color: DieColor = 'red'): DieSheet => paintDieSheet(20, color, D20_SIZE);
