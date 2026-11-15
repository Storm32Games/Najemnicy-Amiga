// Pikselowa kość k20 (port Oldgame/src/gfx/dice.js do 2D): prawdziwy dwudziestościan rzutowany i rastrowany
// w PixelCanvas - płaskie cieniowanie ścianek rampą czerwonej emalii z ditheringiem, mosiężne krawędzie,
// znaczki cyfr na ściankach, obrys sel-out. Arkusz: klatki toczenia t0..t11, osiadania s0..s2 i końcowa 'end'
// (ścianka zwrócona do patrzącego - na nią scena kładzie wyrzuconą liczbę).

import { PixelCanvas, type RGB, bayer, clamp01, mix, pick } from '../iso/Pixel';

export const D20_SIZE = 48;
const SCALE = 12;
export const D20_TUMBLE = 12;
export const D20_SETTLE = 3;

type V3 = [number, number, number];
type Q = [number, number, number, number]; // w, x, y, z

const PHI = (1 + Math.sqrt(5)) / 2;
const VERTS: V3[] = [
  [-1, PHI, 0], [1, PHI, 0], [-1, -PHI, 0], [1, -PHI, 0],
  [0, -1, PHI], [0, 1, PHI], [0, -1, -PHI], [0, 1, -PHI],
  [PHI, 0, -1], [PHI, 0, 1], [-PHI, 0, -1], [-PHI, 0, 1],
];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V3): V3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

/** 20 ścianek: trójki wierzchołków odległych o 2 (krawędź), zorientowane na zewnątrz. */
const FACES: [number, number, number][] = (() => {
  const out: [number, number, number][] = [];
  const e = (i: number, j: number) => Math.abs(Math.hypot(...sub(VERTS[i], VERTS[j])) - 2) < 1e-6;
  for (let i = 0; i < 12; i++)
    for (let j = i + 1; j < 12; j++)
      for (let k = j + 1; k < 12; k++)
        if (e(i, j) && e(j, k) && e(i, k)) {
          const n = cross(sub(VERTS[j], VERTS[i]), sub(VERTS[k], VERTS[i]));
          const c: V3 = [(VERTS[i][0] + VERTS[j][0] + VERTS[k][0]) / 3, (VERTS[i][1] + VERTS[j][1] + VERTS[k][1]) / 3, (VERTS[i][2] + VERTS[j][2] + VERTS[k][2]) / 3];
          out.push(dot(n, c) > 0 ? [i, j, k] : [i, k, j]);
        }
  return out;
})();

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
/** Obrót, po którym ścianka 0 patrzy w stronę widza (+z), a jej wierzchołek w górę ekranu (+y). */
function faceOnQuat(): Q {
  const [i, j, k] = FACES[0];
  const c = norm([(VERTS[i][0] + VERTS[j][0] + VERTS[k][0]) / 3, (VERTS[i][1] + VERTS[j][1] + VERTS[k][1]) / 3, (VERTS[i][2] + VERTS[j][2] + VERTS[k][2]) / 3]);
  // najpierw normalna -> +z
  const axis = cross(c, [0, 0, 1]);
  const q1 = Math.hypot(...axis) < 1e-6 ? ([1, 0, 0, 0] as Q) : qaxis(axis, Math.acos(Math.max(-1, Math.min(1, c[2]))));
  // potem obrót wokół z, aż wierzchołek i wypadnie u góry
  const v = qrot(q1, VERTS[i]);
  const ang = Math.atan2(v[0], v[1]);
  return qmul(qaxis([0, 0, 1], ang), q1);
}

const ENAMEL: RGB[] = [0x2a0a08, 0x4a120e, 0x761c14, 0xa0281a, 0xc43a22, 0xe0603a, 0xf8a070, 0xffe0c0];
const BRASS_LIT = 0xffe0a0, BRASS_DK = 0x6a4a20;
const LIGHT = norm([-0.55, 0.7, 0.75]);

/** Rasteryzuje kość w obrocie q na płótnie S x S. markFront = rysuj znaczek także na ściance frontowej. */
function rasterDie(q: Q, markFront: boolean): PixelCanvas {
  const S = D20_SIZE, C = S / 2;
  const pc = new PixelCanvas(S, S);
  const P = VERTS.map((v) => qrot(q, v));
  const scr = P.map((v) => [C + v[0] * SCALE, C - v[1] * SCALE] as [number, number]);
  const faces = FACES.map((f, idx) => {
    const n = norm(cross(sub(P[f[1]], P[f[0]]), sub(P[f[2]], P[f[0]])));
    const zc = (P[f[0]][2] + P[f[1]][2] + P[f[2]][2]) / 3;
    return { f, n, zc, idx };
  }).filter((x) => x.n[2] > 0).sort((a, b) => a.zc - b.zc);
  for (const { f, n, idx } of faces) {
    const diff = Math.max(0, dot(n, LIGHT));
    const spec = Math.pow(Math.max(0, n[2] * 0.5 + diff * 0.5), 18);
    const v = clamp01(0.14 + diff * 0.72 + spec * 0.35 + ((idx * 7) % 5) * 0.012);
    const tri = f.map((i) => scr[i]);
    pc.poly(tri, (x, y) => pick(ENAMEL, v, x, y));
    // mosiężne krawędzie: jaśniejsze po stronie światła
    const edge = mix(BRASS_DK, BRASS_LIT, clamp01(diff * 1.1));
    for (let e = 0; e < 3; e++) pc.line(tri[e][0], tri[e][1], tri[(e + 1) % 3][0], tri[(e + 1) % 3][1], n[2] > 0.25 ? edge : mix(edge, ENAMEL[1], 0.5));
    // znaczek cyfry na ściankach zwróconych do widza
    if (n[2] > 0.55 && (markFront || n[2] < 0.97)) {
      const cx = (tri[0][0] + tri[1][0] + tri[2][0]) / 3, cy = (tri[0][1] + tri[1][1] + tri[2][1]) / 3;
      const big = n[2] > 0.8;
      const ink = mix(0xf0d8a8, ENAMEL[2], 1 - n[2]);
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

export interface D20Sheet {
  pc: PixelCanvas;
  frames: { name: string; x: number; y: number; w: number; h: number }[];
  /** Środek ścianki frontowej na klatce 'end' (piksele klatki). */
  face: { x: number; y: number };
}

/** Arkusz klatek kości (stały - liczbę nakłada scena). */
export function paintD20Sheet(): D20Sheet {
  const S = D20_SIZE;
  const qEnd = faceOnQuat();
  const q0: Q = qmul(qaxis([0.3, 1, 0.2], 2.1), qaxis([1, 0, 0.4], 1.3));
  const spinAxis: V3 = [0.62, 0.71, 0.33];
  const list: { name: string; q: Q; front: boolean }[] = [];
  for (let i = 0; i < D20_TUMBLE; i++) list.push({ name: `t${i}`, q: qmul(qaxis(spinAxis, i * 0.62), q0), front: true });
  const last = list[list.length - 1].q;
  const afterSpin = qmul(qaxis(spinAxis, 0.62), last);
  for (let i = 0; i < D20_SETTLE; i++) list.push({ name: `s${i}`, q: qslerp(afterSpin, qEnd, (i + 1) / (D20_SETTLE + 1)), front: true });
  list.push({ name: 'end', q: qEnd, front: false });
  const pc = new PixelCanvas(S * list.length, S);
  const frames = list.map((it, f) => {
    const one = rasterDie(it.q, it.front);
    for (let y = 0; y < S; y++) pc.data.set(one.data.subarray(y * S * 4, (y + 1) * S * 4), (y * pc.w + f * S) * 4);
    return { name: it.name, x: f * S, y: 0, w: S, h: S };
  });
  // środek ścianki 0 po obrocie końcowym
  const [i, j, k] = FACES[0];
  const P = [i, j, k].map((v) => qrot(qEnd, VERTS[v]));
  const face = { x: S / 2 + ((P[0][0] + P[1][0] + P[2][0]) / 3) * SCALE, y: S / 2 - ((P[0][1] + P[1][1] + P[2][1]) / 3) * SCALE };
  return { pc, frames, face };
}
