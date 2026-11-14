// Region kampanii: teren z wysokościami, sektory i trasy podróży między Przystanią a miejscami zleceń.
// Port Oldgame/src/scenes/meta/worldterrain.js (hgt, SECTORS, cityRoute, inCity) i worldmap.js (road, depart).
// Czysta logika, zero Phasera / DOM. Pozycje w Q8 jednostek świata (1 jednostka = 256):
//   x: zachód -> wschód, z: północ -> południe (jak w starej mapie 3D).
// Wysokość terenu jest wypiekana raz do siatki Int16 (Q8, krok 0.5 jednostki) i czytana interpolacją
// dwuliniową na intach - w porcie C to `static const int16_t` z pliku, bez FPU w trakcie gry.

import { isin, isqrt } from '../frontend/fixed.ts';
import type { Biome } from '../tactical/mapgen.ts';

/** 1 jednostka świata w Q8. */
export const WQ = 256;
const q = (v: number): number => Math.round(v * WQ);

/** Punkt świata w Q8. */
export interface WPos {
  x: number;
  z: number;
}

// ------------------------------------------------------------------ układ regionu

export const HOME: WPos = { x: q(-17), z: q(8) };
/** Miasto: elipsa (rx, rz) z siatką kwartałów co `g`. */
export const CITY = { x: q(2.5), z: q(2), rx: q(13.6), rz: q(10.2), g: q(2.6) };
/** Kwartały-place (puste parcele) - stałe miejsca zleceń w mieście. */
export const PLAZA_CELLS: readonly (readonly [number, number])[] = [[-2, -1], [3, 1], [-3, 2], [1, -3], [0, 3], [4, -1], [-1, 1], [2, -2]];
export const cityBlock = (gx: number, gz: number): WPos => ({ x: CITY.x + gx * CITY.g, z: CITY.z + gz * CITY.g });
export const PLAZAS: readonly WPos[] = PLAZA_CELLS.map(([gx, gz]) => cityBlock(gx, gz));
/** Główna aleja (wschód-zachód) i zachodnia brama miasta, do której prowadzi autostrada z Przystani. */
export const AVENUE_Z = CITY.z + (CITY.g >> 1);
export const GATE: WPos = { x: CITY.x - ((9 * CITY.g) >> 1) - q(1.6), z: AVENUE_Z };
export const CRATER: WPos = { x: q(19.5), z: q(-6) };
/** Płaskowyże (x, z, promień) w jednostkach świata. */
const MESAS: readonly (readonly [number, number, number])[] = [[25, 2, 2.4], [18, 17, 1.8], [29, 12, 2.0], [-8, 15.5, 1.6], [-24, -2, 2.2]];

export interface Sector {
  id: Biome;
  name: string;
  sub: string;
  color: number;
  /** Środek i półosie obrysu (Q8). */
  x: number;
  z: number;
  rx: number;
  rz: number;
  /** Miejsce podpisu (Q8). */
  label: WPos;
  /** Stałe miejsca zleceń w sektorze (Q8); pierwsze dostaje zlecenie fabularne. */
  spots: readonly WPos[];
}

const P = (x: number, z: number): WPos => ({ x: q(x), z: q(z) });

export const SECTORS: readonly Sector[] = [
  { id: 'ruins', name: 'RUINY MIASTA', sub: 'sektor miejski', color: 0xf2a93b, x: CITY.x, z: CITY.z, rx: CITY.rx + q(0.5), rz: CITY.rz + q(0.5), label: P(2.5, 13.8), spots: PLAZAS },
  { id: 'wastes', name: 'PUSTKOWIA', sub: 'wydmy i obóz Nomadów', color: 0xd8c090, x: q(24), z: q(11), rx: q(7.2), rz: q(7.6), label: P(24, 19), spots: [P(21.5, 11.5), P(27.5, 7.5), P(20.5, 16), P(27, 15), P(23.5, 5.6)] },
  { id: 'industrial', name: 'STREFA PRZEMYSŁOWA', sub: 'fabryki i krater', color: 0xe0703a, x: q(15), z: q(-12), rx: q(8.6), rz: q(4.4), label: P(24, -17.6), spots: [P(10.5, -14.2), P(18.5, -10.6), P(14.5, -9.6), P(20.5, -13.6)] },
  { id: 'bunker', name: 'GÓRY · BUNKIER', sub: 'schrony w skałach', color: 0x6ab0ff, x: q(-15), z: q(-11), rx: q(9), rz: q(5.2), label: P(-15, -4.6), spots: [P(-13, -7.6), P(-19.5, -8.2), P(-9, -10.2), P(-16.5, -12.5)] },
];

export const sectorOf = (b: Biome): Sector => SECTORS.find((s) => s.id === b) ?? SECTORS[0];

/** Czy punkt leży w mieście (elipsa zwężona o 0.4 jednostki). Stosunki w Q8, więc kwadraty mieszczą się w int32. */
export function inCity(p: WPos): boolean {
  const ex = (((p.x - CITY.x) * 256) / (CITY.rx - q(0.4))) | 0;
  const ez = (((p.z - CITY.z) * 256) / (CITY.rz - q(0.4))) | 0;
  return ex * ex + ez * ez < 65536;
}

/** Ulice od bramy do placu: aleją na wschód, potem najbliższą przecznicą na północ / południe (Oldgame cityRoute). */
export function cityRoute(plaza: WPos): WPos[] {
  const sx = plaza.x - (CITY.g >> 1);
  return [{ x: GATE.x, z: AVENUE_Z }, { x: sx, z: AVENUE_Z }, { x: sx, z: plaza.z }, { x: plaza.x - q(0.35), z: plaza.z }];
}

// ------------------------------------------------------------------ teren

const smooth = (e0: number, e1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};
const g2 = (x: number, z: number, cx: number, cz: number, rx: number, rz: number): number => Math.exp(-(((x - cx) / rx) ** 2 + ((z - cz) / rz) ** 2));
/** Suche koryto rzeki: wije się z północnego wschodu na południowy zachód. */
const riverX = (z: number): number => -2 + Math.sin(z * 0.28) * 4 + z * 0.35;
export const riverDistF = (x: number, z: number): number => Math.abs(x - riverX(z));

/**
 * Wysokość terenu w jednostkach świata (float) - TYLKO do wypiekania siatki i do malowania tła.
 * 1:1 z Oldgame hgt(): góry z grzbietami (bunkier), wydmy na wschodzie, płaskowyże, krater z wałem,
 * suche koryto, spłaszczone miasto i Przystań.
 */
export function regionHeightF(x: number, z: number): number {
  let h = 0.35 * Math.sin(x * 0.31) * Math.cos(z * 0.27) + 0.22 * Math.sin(x * 0.73 + z * 0.51) + 0.12 * Math.sin(x * 1.7 - z * 1.3);
  const mnt = g2(x, z, -13, -13, 11, 5.5) + 0.7 * g2(x, z, -24, -10, 6, 7) + 0.5 * g2(x, z, 0, -17, 9, 3);
  h += mnt * (4.2 + 1.4 * Math.abs(Math.sin(x * 0.9 + z * 0.4)) + 0.8 * Math.sin(x * 2.1) * Math.cos(z * 1.7));
  const wastes = smooth(14, 20, x) * smooth(-4, 4, z);
  h += wastes * 0.55 * Math.max(0, Math.sin(x * 0.85 + Math.sin(z * 0.6) * 1.2)) ** 2;
  for (const [mx, mz, r] of MESAS) h += 1.7 * (1 - smooth(r - 0.35, r + 0.25, Math.hypot(x - mx, (z - mz) * 1.2)));
  const dc = Math.hypot(x - CRATER.x / WQ, z - CRATER.z / WQ);
  h += -1.5 * (1 - smooth(1.2, 2.8, dc)) + 0.55 * Math.exp(-((dc - 3) ** 2) / 0.8);
  h -= 0.55 * (1 - smooth(0.4, 1.6, riverDistF(x, z)));
  const e = ((x - CITY.x / WQ) / (CITY.rx / WQ)) ** 2 + ((z - CITY.z / WQ) / (CITY.rz / WQ)) ** 2;
  h *= 1 - 0.97 * (1 - smooth(0.85, 1.35, e));
  h *= 1 - 0.8 * g2(x, z, HOME.x / WQ, HOME.z / WQ, 3.5, 3);
  return h;
}

/** Siatka wysokości: x -36..36, z -24..24, krok 0.5 jednostki (128 w Q8). 145 x 97 x int16 = 27.5 KB. */
export const HMAP = { x0: q(-36), z0: q(-24), step: 128, w: 145, h: 97 } as const;
let heights: Int16Array | null = null;

/** Wypieczona siatka wysokości (Q8). Liczona raz; w porcie - tablica z pliku. */
export function heightGrid(): Int16Array {
  if (heights) return heights;
  const m = new Int16Array(HMAP.w * HMAP.h);
  for (let j = 0; j < HMAP.h; j++)
    for (let i = 0; i < HMAP.w; i++) m[j * HMAP.w + i] = Math.round(regionHeightF((HMAP.x0 + i * HMAP.step) / WQ, (HMAP.z0 + j * HMAP.step) / WQ) * WQ);
  return (heights = m);
}

/** Wysokość terenu w Q8 w punkcie (x, z) w Q8 - interpolacja dwuliniowa na liczbach całkowitych. */
export function heightQ8(x: number, z: number): number {
  const m = heightGrid();
  const maxX = (HMAP.w - 1) * HMAP.step - 1, maxZ = (HMAP.h - 1) * HMAP.step - 1;
  let fx = x - HMAP.x0, fz = z - HMAP.z0;
  fx = fx < 0 ? 0 : fx > maxX ? maxX : fx;
  fz = fz < 0 ? 0 : fz > maxZ ? maxZ : fz;
  const i = fx >> 7, j = fz >> 7, ax = fx & 127, az = fz & 127, o = j * HMAP.w + i;
  const top = m[o] * (128 - ax) + m[o + 1] * ax;
  const bot = m[o + HMAP.w] * (128 - ax) + m[o + HMAP.w + 1] * ax;
  return (top * (128 - az) + bot * az) >> 14;
}

// ------------------------------------------------------------------ trasy

/** Trasa jako łamana gęsto próbkowana (Q8) z narastającą długością `cum` (Q8). */
export interface Route {
  x: Int32Array;
  z: Int32Array;
  cum: Int32Array;
  n: number;
  /** Długość całkowita (Q8). */
  len: number;
  /** Indeks próbki, od której zaczyna się szlak (wcześniej: asfalt autostrady - nie rysujemy go drugi raz). */
  trackFrom: number;
}

const SEG = 16;

/** Catmull-Rom (jednorodny) na intach: wagi w Q8, wynik >> 9 (wagi sumują się do 512). Dopisuje do `out`. */
function catmull(pts: readonly WPos[], out: WPos[]): void {
  if (!out.length) out.push({ ...pts[0] });
  for (let i = 0; i + 1 < pts.length; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    for (let s = 1; s <= SEG; s++) {
      const t = ((s * 256) / SEG) | 0, t2 = (t * t) >> 8, t3 = (t2 * t) >> 8;
      const w0 = -t3 + 2 * t2 - t, w1 = 3 * t3 - 5 * t2 + 512, w2 = -3 * t3 + 4 * t2 + t, w3 = t3 - t2;
      out.push({ x: (w0 * p0.x + w1 * p1.x + w2 * p2.x + w3 * p3.x) >> 9, z: (w0 * p0.z + w1 * p1.z + w2 * p2.z + w3 * p3.z) >> 9 });
    }
  }
}

/** Odcinki proste (ulice miasta). */
function polyline(pts: readonly WPos[], out: WPos[]): void {
  if (!out.length) out.push({ ...pts[0] });
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i], b = pts[i + 1];
    for (let s = 1; s <= SEG; s++) out.push({ x: a.x + (((b.x - a.x) * s) / SEG | 0), z: a.z + (((b.z - a.z) * s) / SEG | 0) });
  }
}

function finish(pts: WPos[], trackFrom: number): Route {
  const n = pts.length, x = new Int32Array(n), z = new Int32Array(n), cum = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    x[i] = pts[i].x;
    z[i] = pts[i].z;
    if (i) {
      const dx = x[i] - x[i - 1], dz = z[i] - z[i - 1];
      cum[i] = cum[i - 1] + isqrt(dx * dx + dz * dz);
    }
  }
  return { x, z, cum, n, len: cum[n - 1], trackFrom };
}

/** Autostrada z Przystani do bramy miasta: lekki łuk na południe (sin z LUT, 128 = pół obrotu). */
export function highway(): WPos[] {
  const out: WPos[] = [];
  for (let j = 0; j <= 6; j++) {
    const bulge = (isin(((j * 128) / 6) | 0) * q(0.9)) >> 12;
    out.push({ x: HOME.x + (((GATE.x - HOME.x) * j) / 6 | 0), z: HOME.z + (((GATE.z - HOME.z) * j) / 6 | 0) + bulge });
  }
  return out;
}

/** Objazdy miasta od południa i północy (Oldgame worldmap.road) - szlaki nigdy nie przecinają ruin. */
const RING_S: readonly WPos[] = [P(-9.5, 11.2), P(-3, 13.8), P(2.5, 14.6), P(9, 13.6), P(15, 10.6)];
const RING_N: readonly WPos[] = [P(-11.5, -4.6), P(-5, -8.4), P(2.5, -10.2), P(9, -9), P(14.5, -6)];

/**
 * Trasa z Przystani do celu. Miasto: autostrada do bramy + ulice (aleja i przecznica).
 * Poza miastem: kręty szlak przez dwa punkty kontrolne odsunięte na boki (strona zależy od `index`),
 * a gdy prosta przecina miasto - objazd od południa albo północy.
 */
export function buildRoute(target: WPos, biome: Biome, index: number): Route {
  const a = HOME, b = target, out: WPos[] = [];
  if (biome === 'ruins') {
    const hw = highway();
    catmull(hw, out);
    const from = out.length - 1;
    polyline(cityRoute(b), out);
    return finish(out, from);
  }
  const dx = b.x - a.x, dz = b.z - a.z;
  let hit = false;
  for (let k = 1; k < 20 && !hit; k++) hit = inCity({ x: a.x + ((dx * k) / 20 | 0), z: a.z + ((dz * k) / 20 | 0) });
  if (hit) {
    const ring = (b.z > CITY.z - q(2) ? RING_S : RING_N).filter((p) => p.x < b.x - q(2.5));
    catmull([a, ...ring, b], out);
  } else {
    // (-dz, dx) to prostopadła o długości trasy: 0.1 / 0.07 długości w bok, jak w Oldgame
    const sg = index % 2 ? 1 : -1;
    const p1 = { x: a.x + ((dx * 3) / 10 | 0) + ((sg * -dz) / 10 | 0), z: a.z + ((dz * 3) / 10 | 0) + ((sg * dx) / 10 | 0) };
    const p2 = { x: a.x + ((dx * 68) / 100 | 0) - ((sg * -dz * 7) / 100 | 0), z: a.z + ((dz * 68) / 100 | 0) - ((sg * dx * 7) / 100 | 0) };
    catmull([a, p1, p2, b], out);
  }
  return finish(out, 0);
}

/** Punkt na trasie po przebyciu `d` (Q8 długości): wyszukiwanie binarne + interpolacja liniowa. */
export function routePointAt(r: Route, d: number): WPos {
  if (d <= 0) return { x: r.x[0], z: r.z[0] };
  if (d >= r.len) return { x: r.x[r.n - 1], z: r.z[r.n - 1] };
  let lo = 0, hi = r.n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (r.cum[mid] <= d) lo = mid;
    else hi = mid;
  }
  const span = r.cum[hi] - r.cum[lo] || 1, k = d - r.cum[lo];
  return { x: r.x[lo] + (((r.x[hi] - r.x[lo]) * k) / span | 0), z: r.z[lo] + (((r.z[hi] - r.z[lo]) * k) / span | 0) };
}

/** Czas marszu w tickach 50 Hz: 4.2 jednostki/s, minimum 6 s (Oldgame: max(6, length / 4.2)). */
export const routeTicks = (r: Route): number => Math.max(300, ((r.len * 500) / 10752) | 0);

/** Miejsca zleceń na mapie: kolejne stałe miejsca sektora biomu (zawijane), jak w Oldgame. */
export function contractSpots(contracts: readonly { id: string; biome: Biome }[]): Map<string, WPos> {
  const used: Partial<Record<Biome, number>> = {}, out = new Map<string, WPos>();
  for (const c of contracts) {
    const sec = sectorOf(c.biome), n = (used[c.biome] = (used[c.biome] ?? 0) + 1);
    out.set(c.id, sec.spots[(n - 1) % sec.spots.length]);
  }
  return out;
}
