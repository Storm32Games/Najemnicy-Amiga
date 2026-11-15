// Mapa regionu malowana z wysokościami (port krajobrazu Oldgame/src/scenes/meta/worldterrain.js bez three.js).
// Rzut ukośny z południa: x -> poziomo, z -> pionowo (spłaszczone), wysokość podnosi punkt na ekranie.
// Teren rysowany "voxel space" kolumnami od najbliższego do najdalszego z buforem Y, więc góry, płaskowyże,
// wał krateru i wydmy zasłaniają to, co za nimi, a stoki są cieniowane od północnego zachodu.
// Miasto to siatka kwartałów z jezdniami, chodnikami i przejściami; kwartały zabudowane kamienicami, biurowcami
// i wieżowcami (piętra z oknami, dachy z nadbudówkami), w dużej części zrujnowanymi: poszarpane szczyty,
// wyrwy po pociskach, kupy gruzu, pręty zbrojeniowe. Pozostałe strefy mają własne obiekty (hale, kominy,
// zbiorniki, bunkier w skale, obóz Nomadów, wrak samolotu, Przystań z murem ze złomu).
// Obiekty sortowane po krawędzi frontu (z świata), więc bliższe zasłaniają dalsze.

import Phaser from 'phaser';
import { CITY, CRATER, GATE, HOME, PLAZA_CELLS, PLAZAS, SECTORS, WQ, buildRoute, cityBlock, heightQ8, inCity, riverDistF } from '../../core/campaign/region';
import { canvasTexture, seeded, type Ctx2D } from '../ui/Kit';

// ------------------------------------------------------------------ rzut

/** Skala mapy względem pierwotnej 480x270 (mapa jest większa niż ekran - kamera ją przewija i przybliża). */
const S = 2;
/** Piksele na jednostkę świata (poziomo, pionowo w głąb) i na jednostkę wysokości. */
export const KX = 7.4 * S, KZ = 5.6 * S, LIFT = 6 * S;
/** Rozmiar mapy w pikselach projektowych. */
export const MAP_W = 480 * S, MAP_H = 270 * S;
const OX = 232 * S, OY = 112 * S;
/** Wysokość piętra w pikselach. */
const FL = 4;

/** x świata (Q8) -> piksel ekranu. */
export const scrX = (xq: number): number => OX + Math.round((xq * KX) / WQ);
/** Rzut z wysokością terenu w (x, z) (Q8) + dodatkowe uniesienie `up` (Q8). */
export const scrY = (xq: number, zq: number, up = 0): number => OY + Math.round((zq * KZ) / WQ) - Math.round(((heightQ8(xq, zq) + up) * LIFT) / WQ);

// pomocnicze dla malowania w jednostkach świata (float)
const W = (v: number): number => Math.round(v * WQ);
const fx = (x: number): number => OX + Math.round(x * KX);
const groundY = (x: number, z: number, up = 0): number => scrY(W(x), W(z), W(up));

const smooth = (e0: number, e1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};
type RGB = [number, number, number];
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const hash = (a: number, b: number): number => {
  let h = Math.imul(a, 374761393) + Math.imul(b, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
/** Szum wartości (gładki, 0..1) i jego dwie oktawy. */
function vnoise(x: number, z: number): number {
  const xi = Math.floor(x), zi = Math.floor(z), u = x - xi, v = z - zi;
  const sx = u * u * (3 - 2 * u), sz = v * v * (3 - 2 * v);
  const a = hash(xi, zi), b = hash(xi + 1, zi), c = hash(xi, zi + 1), d = hash(xi + 1, zi + 1);
  return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz;
}
const fbm = (x: number, z: number): number => vnoise(x, z) * 0.62 + vnoise(x * 2.3 + 17.3, z * 2.3 + 5.1) * 0.38;
const css = (c: number, k = 1): string => `rgb(${Math.min(255, Math.round(((c >> 16) & 255) * k))},${Math.min(255, Math.round(((c >> 8) & 255) * k))},${Math.min(255, Math.round((c & 255) * k))})`;
const rgbCss = (c: RGB): string => `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;

const CX = CITY.x / WQ, CZ = CITY.z / WQ, CRX = CITY.rx / WQ, CRZ = CITY.rz / WQ, G = CITY.g / WQ;
const AVE_Z = CZ + 0.5 * G;
const KRX = CRATER.x / WQ, KRZ = CRATER.z / WQ;
const HX = HOME.x / WQ, HZ = HOME.z / WQ;
const GX0 = GATE.x / WQ;
/** Poziom toksycznego jeziora w kraterze (jednostki). */
const LAKE = -1.38;

/** Miejsca zleceń (jednostki) - duże obiekty omijają je, żeby flaga nie stała w środku budynku. */
const SPOTS: [number, number][] = SECTORS.flatMap((s) => s.spots.map((p) => [p.x / WQ, p.z / WQ] as [number, number]));
const freeAt = (x: number, z: number, r: number): boolean => SPOTS.every(([sx, sz]) => Math.hypot(x - sx, (z - sz) * 1.2) > r) && Math.hypot(x - HX, z - HZ) > 3.2;

// ------------------------------------------------------------------ miasto: siatka kwartałów

/** Półszerokość zwykłej ulicy i alei, szerokość chodnika (jednostki). */
const ST_W = 0.3, AVE_W = 0.46, SIDE = 0.16;
const BI = 7, BJ = 6;
const blockGrid: boolean[] = [];
for (let j = -BJ; j <= BJ; j++) for (let i = -BI; i <= BI; i++) blockGrid.push(inCity(cityBlock(i, j)));
/** Czy kwartał (bi, bj) istnieje (środek w mieście). */
const on = (i: number, j: number): boolean => i >= -BI && i <= BI && j >= -BJ && j <= BJ && blockGrid[(j + BJ) * (2 * BI + 1) + i + BI];
const isPlaza = (i: number, j: number): boolean => PLAZA_CELLS.some(([px, pz]) => px === i && pz === j);
/** Półszerokość ulicy między kwartałem k i k+1 (aleje: między 0 i 1 w obu osiach). */
const halfW = (k: number): number => (k === 0 ? AVE_W : ST_W);

const ASPHALT: RGB = [58, 56, 56], SAND: RGB = [186, 150, 98];

/** Kolor gruntu miasta w (x, z) albo null poza zabudową. */
function cityGround(x: number, z: number, n: number): RGB | null {
  const u = (x - CX) / G, v = (z - CZ) / G, bi = Math.round(u), bj = Math.round(v);
  const du = (u - bi) * G, dv = (v - bj) * G;
  const ni = bi + (du >= 0 ? 1 : -1), nj = bj + (dv >= 0 ? 1 : -1);
  const ex = G / 2 - Math.abs(du), ez = G / 2 - Math.abs(dv);
  const here = on(bi, bj), vOn = here || on(ni, bj), hOn = here || on(bi, nj);
  const hwX = halfW(Math.min(bi, ni)), hwZ = halfW(Math.min(bj, nj));
  let road = (vOn && ex < hwX) || (hOn && ez < hwZ) || (ex < hwX && ez < hwZ && on(ni, nj));
  const aveWest = Math.abs(z - AVE_Z) < AVE_W && x >= GX0 - 0.2 && x < CX;
  if (!road && aveWest) road = true;
  const side = !road && ((vOn && ex < hwX + SIDE) || (hOn && ez < hwZ + SIDE));
  if (!road && !side && !here) return null;
  let c: RGB;
  if (road) {
    const wear = fbm(x * 0.9 + 3, z * 0.9);
    c = mix(ASPHALT, [84, 80, 76], smooth(0.55, 0.85, wear));
    c = [c[0] + n * 8, c[1] + n * 8, c[2] + n * 8];
    // oznakowanie: przerywana linia środkowa alei, przejścia dla pieszych przy skrzyżowaniach
    const onAve = Math.abs(z - AVE_Z) < AVE_W && (Math.min(bj, nj) === 0 || aveWest);
    if (onAve && Math.abs(z - AVE_Z) < 0.05 && ((x * 1.4) % 1 + 1) % 1 < 0.5 && wear < 0.62) c = [190, 160, 70];
    const crossV = ex < hwX && vOn && ez > hwZ && ez < hwZ + 0.34 && hOn;
    const crossH = ez < hwZ && hOn && ex > hwX && ex < hwX + 0.3 && vOn;
    if ((crossV && Math.floor(x / 0.11) % 2 === 0) || (crossH && Math.floor(z / 0.13) % 2 === 0)) if (wear < 0.6 && n > 0.15) c = mix(c, [176, 170, 156], 0.75);
    // pęknięcia (poziomice szumu) i dziury
    if (Math.abs(vnoise(x * 2.1 + 50, z * 2.1) - 0.5) < 0.016) c = [32, 30, 30];
    const ph = fbm(x * 1.9 + 40, z * 1.9);
    if (ph > 0.8) c = ph > 0.84 ? [30, 28, 26] : [92, 84, 74];
  } else if (side) {
    const dRoad = Math.min(vOn ? ex - hwX : 9, hOn ? ez - hwZ : 9);
    c = dRoad < 0.05 ? [150, 144, 132] : [118, 112, 102];
    if (Math.floor((x + z * 0.2) / 0.32) % 2 === 0 && dRoad >= 0.05) c = [c[0] - 6, c[1] - 6, c[2] - 6];
    if (n > 0.9) c = [86, 80, 72];
  } else if (isPlaza(bi, bj)) {
    c = [146, 136, 120];
    if (Math.abs(((du / 0.34) % 1 + 1) % 1 - 0.5) > 0.42 || Math.abs(((dv / 0.3) % 1 + 1) % 1 - 0.5) > 0.4) c = [118, 108, 96];
    if (Math.hypot(du, dv) < 0.55) c = [160, 150, 132];
    if (n > 0.85) c = [100, 92, 82];
  } else {
    // parcela: ubita ziemia, gruz, resztki fundamentów
    const k = fbm(x * 1.3 + 7, z * 1.3 + 2);
    c = mix([96, 86, 76], [76, 70, 64], k);
    if (n > 0.8) c = [c[0] - 18, c[1] - 18, c[2] - 16];
    if (n < 0.06) c = [c[0] + 24, c[1] + 20, c[2] + 14];
  }
  // piasek nawiewany z pustyni: brzegi miasta i zaspy w środku
  const e = ((x - CX) / CRX) ** 2 + ((z - CZ) / CRZ) ** 2;
  const sand = Math.max(smooth(0.45, 1.05, e + (fbm(x * 0.35, z * 0.35) - 0.5) * 0.7), smooth(0.7, 0.82, fbm(x * 0.55 + 9, z * 0.55 - 4)) * 0.8);
  if (sand > 0) c = mix(c, [SAND[0] - n * 12, SAND[1] - n * 12, SAND[2] - n * 10], sand * 0.92);
  return c;
}

// ------------------------------------------------------------------ teren

/** Pozostałe strefy z własnym podłożem. */
const IND = { x0: 6.6, x1: 22.4, z0: -15.8, z1: -6.6 };
const inPad = (x: number, z: number): boolean => x > IND.x0 && x < IND.x1 && z > IND.z0 && z < IND.z1 && Math.hypot(x - KRX, z - KRZ) > 3.5;
const havenE = (x: number, z: number): number => ((x - HX) / 2.5) ** 2 + ((z - HZ) / 1.8) ** 2;

/** Kolor gruntu (port terrainTexture z Oldgame + faktury stref). */
function groundColor(x: number, z: number, h: number, n: number, slope = 1): RGB {
  const city = cityGround(x, z, n);
  if (city) return city;
  const big = fbm(x * 0.22, z * 0.22), mid = fbm(x * 0.9 + 11, z * 0.9 - 3);
  let col: RGB = mix([170, 134, 88], [204, 168, 110], big);
  col = mix(col, [158, 124, 84], smooth(0.62, 0.8, mid) * 0.3);
  // północ ciemniejsza, kamienista
  col = mix(col, [126, 104, 76], smooth(-3, 6, x) * (1 - smooth(-4, 4, z)) * 0.45);
  // pustkowia: zmarszczki wydm
  const wastes = smooth(14, 19, x) * smooth(-4, 3, z);
  if (wastes > 0) {
    const rip = Math.sin(x * 3.1 + z * 1.2 + fbm(x * 0.4, z * 0.4) * 6);
    col = mix(col, rip > 0.6 ? [222, 188, 130] : rip < -0.7 ? [168, 130, 86] : col, wastes * 0.55);
  }
  // spękana ziemia i kępy suchej trawy na nizinach
  if (h < 1.2 && wastes < 0.5) {
    if (Math.abs(vnoise(x * 1.6 + 70, z * 1.6) - 0.5) < 0.02 && mid > 0.45) col = mix(col, [110, 84, 58], 0.7);
    const scrub = fbm(x * 0.7 - 20, z * 0.7);
    if (scrub > 0.66) col = mix(col, [128, 118, 70], smooth(0.66, 0.8, scrub) * 0.6);
  }
  // skała: warstwy i szczeliny, wyżej jaśniejszy piarg
  if (h > 1.3) {
    const k = smooth(1.3, 3, h);
    let rock: RGB = mix([112, 98, 86], [96, 88, 82], mid);
    const strata = slope > 0.25 ? Math.sin(h * 7 + fbm(x * 0.6, z * 0.6) * 5) : 0;
    if (strata > 0.75) rock = [rock[0] - 16, rock[1] - 16, rock[2] - 14];
    if (strata < -0.85) rock = [rock[0] + 14, rock[1] + 12, rock[2] + 10];
    col = mix(col, rock, k);
  }
  if (h > 4.2) col = mix(col, [158, 150, 142], smooth(4.2, 6, h) * 0.8);
  // suche koryto: spękany muł
  const r = riverDistF(x, z);
  if (r < 1.6) {
    let mud: RGB = [128, 104, 76];
    if (Math.abs(vnoise(x * 3.2, z * 3.2 + 30) - 0.5) < 0.03) mud = [90, 70, 50];
    col = mix(col, mud, (1 - smooth(0.4, 1.6, r)) * 0.85);
  }
  // krater: wypalona, zatruta ziemia
  const dc = Math.hypot(x - KRX, z - KRZ);
  if (dc < 4.2) col = mix(col, mid > 0.5 ? [74, 80, 46] : [92, 92, 56], 1 - smooth(1.6, 4.2, dc));
  // strefa przemysłowa: betonowe place z płytami i plamami oleju
  if (inPad(x, z)) {
    let c: RGB = mix([112, 108, 100], [92, 88, 82], mid);
    if (((x / 1.1) % 1 + 1) % 1 < 0.06 || ((z / 0.9) % 1 + 1) % 1 < 0.08) c = [78, 74, 70];
    if (fbm(x * 1.4 + 5, z * 1.4) > 0.72) c = [56, 52, 48];
    const edge = Math.min(x - IND.x0, IND.x1 - x, z - IND.z0, IND.z1 - z);
    col = mix(col, c, smooth(0, 0.6, edge + (big - 0.5)) * (n > 0.04 ? 1 : 0.6));
  }
  // Przystań: ubita ziemia za murem, grządki
  const he = havenE(x, z);
  if (he < 1.15) {
    let c: RGB = [138, 112, 82];
    if (x > HX - 2 && x < HX - 0.4 && z > HZ + 0.55 && z < HZ + 1.35) c = Math.floor(z / 0.16) % 2 ? [88, 112, 52] : [96, 74, 50];
    col = mix(col, c, 1 - smooth(0.85, 1.15, he));
  }
  return col;
}

/** Teren: kolumny od dołu ekranu (blisko) w górę (daleko), bufor Y = co już zasłonięte. */
function paintTerrain(g: Ctx2D, w: number, h: number): void {
  const img = g.createImageData(w, h), d = img.data;
  const ZN = W(29), ZF = W(-30), STEP = 10;
  for (let px = 0; px < w; px++) {
    const xq = Math.round(((px - OX) * WQ) / KX), x = xq / WQ;
    let ybuf = h;
    for (let zq = ZN; zq >= ZF && ybuf > 0; zq -= STEP) {
      const z = zq / WQ;
      let hq = heightQ8(xq, zq);
      const wet = Math.hypot(x - KRX, z - KRZ) < 2.4 && hq < W(LAKE);
      if (wet) hq = W(LAKE);
      const y = OY + Math.round((zq * KZ) / WQ) - Math.round((hq * LIFT) / WQ);
      if (y >= ybuf) continue;
      const n = hash(xq >> 4, zq >> 4), hf = hq / WQ;
      let c: RGB;
      if (wet) {
        const dl = Math.hypot(x - KRX, z - KRZ);
        c = Math.abs(dl - 1.2 + n * 0.3) < 0.1 ? [180, 255, 110] : dl > 1.9 ? [70, 120, 40] : [96 + n * 24, 190 + n * 30, 52];
        if (vnoise(x * 4, z * 4) > 0.78) c = [150, 230, 90];
      } else {
        // światło z północnego zachodu: stok opadający ku południowemu wschodowi jest jaśniejszy;
        // łagodne pagórki nizin cieniowane słabiej (inaczej pustynia jest w ciemnych pasach)
        const s = (heightQ8(xq - 128, zq - 128) - heightQ8(xq + 128, zq + 128)) / WQ;
        c = groundColor(x, z, hf, n, Math.abs(s));
        const lim = hf > 1.2 ? 0.5 : 0.12;
        let f = 1 + Math.max(-lim, Math.min(lim, s * (hf > 1.2 ? 1.3 : 0.5)));
        if (hf > 1.2) f *= 1 - Math.min(0.18, (hf - 1.2) * 0.05);
        if (ybuf - y > 2 * S + 1 && ybuf < h) f *= 0.8; // urwisko widziane z przodu
        const j = (n - 0.5) * 12;
        c = [c[0] * f + j, c[1] * f + j, c[2] * f + j];
      }
      const r = Math.max(0, Math.min(255, c[0])) | 0, gg = Math.max(0, Math.min(255, c[1])) | 0, b = Math.max(0, Math.min(255, c[2])) | 0;
      for (let yy = Math.max(0, y); yy < ybuf; yy++) {
        const o = (yy * w + px) * 4;
        d[o] = r;
        d[o + 1] = gg;
        d[o + 2] = b;
        d[o + 3] = 255;
      }
      ybuf = y;
    }
    for (let yy = 0; yy < ybuf; yy++) {
      const o = (yy * w + px) * 4;
      d[o] = 92;
      d[o + 1] = 80;
      d[o + 2] = 70;
      d[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
}

// ------------------------------------------------------------------ bryły

interface Item {
  key: number;
  draw: (g: Ctx2D) => void;
}

interface BoxRect {
  x0: number;
  x1: number;
  yTop: number;
  yFront: number;
  yBase: number;
}

const px = (g: Ctx2D, c: string, x: number, y: number, w = 1, h = 1): void => {
  g.fillStyle = c;
  g.fillRect(x, y, w, h);
};

/** Cień rzucany na wschód (światło z zachodu). */
function shadow(g: Ctx2D, x1: number, yBase: number, depth: number, height: number): void {
  const L = Math.min(18, Math.max(2, Math.round(height * 0.45)));
  g.fillStyle = 'rgba(30,18,10,0.32)';
  g.beginPath();
  g.moveTo(x1, yBase);
  g.lineTo(x1 + L, yBase - 2);
  g.lineTo(x1 + L, yBase - depth - 2);
  g.lineTo(x1, yBase - depth);
  g.fill();
}

/** Prostopadłościan na terenie: front (ciemniejszy), dach (jaśniejszy), krawędzie światła i cienia. */
function boxAt(g: Ctx2D, x: number, z: number, w: number, d: number, hh: number, color: number, elev = 0, shade = true): BoxRect {
  const h0 = heightQ8(W(x), W(z)) / WQ + elev;
  const x0 = fx(x - w / 2), x1 = Math.max(x0 + 1, fx(x + w / 2));
  const yBase = OY + Math.round((z + d / 2) * KZ) - Math.round(h0 * LIFT);
  const yFront = yBase - Math.max(1, Math.round(hh * LIFT));
  const yTop = Math.min(yFront - 1, OY + Math.round((z - d / 2) * KZ) - Math.round((h0 + hh) * LIFT));
  if (shade && elev === 0) shadow(g, x1, yBase, yFront - yTop + 1, yBase - yFront);
  px(g, css(color, 0.78), x0, yFront, x1 - x0, yBase - yFront);
  px(g, css(color, 1.12), x0, yTop, x1 - x0, yFront - yTop);
  px(g, css(color, 1.28), x0, yFront - 1, x1 - x0, 1);
  if (x1 - x0 > 2) {
    px(g, css(color, 0.92), x0, yFront, 1, yBase - yFront);
    px(g, css(color, 0.55), x1 - 1, yFront, 1, yBase - yFront);
  }
  return { x0, x1, yTop, yFront, yBase };
}

/** Kupka gruzu (piksele w kolorze muru) wokół punktu ekranu. */
function rubble(g: Ctx2D, cx: number, y: number, wpx: number, hpx: number, col: number, r: () => number): void {
  for (let i = 0; i < wpx * hpx * 0.9; i++) {
    const t = r() * 2 - 1, xx = Math.round(cx + t * wpx * 0.5);
    const top = hpx * (1 - t * t);
    const yy = Math.round(y - r() * top);
    const v = r();
    px(g, v < 0.15 ? '#2a2420' : v < 0.3 ? '#8a7a68' : css(col, 0.7 + r() * 0.5), xx, yy, 1 + (r() < 0.3 ? 1 : 0), 1);
  }
}

interface Bld {
  x: number;
  z: number;
  w: number;
  d: number;
  floors: number;
  col: number;
  roof: number;
  /** 0 = cały, 1 = zawalony szczyt z jednej strony, 2 = wyrwa w fasadzie, 3 = szkielet stalowy u góry. */
  ruin: number;
  glass: boolean;
  seed: number;
}

const WALLS = [0x8a5a48, 0x7a6a5e, 0x6e6a64, 0x8a7a64, 0x6a6058, 0x9a6a4a, 0x5e646a, 0xa07a52, 0x7a4a3a, 0x8a8470, 0x6a7a74];
const ROOFS = [0x5a544e, 0x6a6258, 0x4e4a46, 0x625a50];

/** Budynek z piętrami: cień, fasada z oknami (parter: witryny), dach z nadbudówkami, ruiny. */
function building(g: Ctx2D, b: Bld): void {
  const r = seeded(b.seed);
  const h0 = heightQ8(W(b.x), W(b.z)) / WQ;
  const x0 = fx(b.x - b.w / 2), x1 = Math.max(x0 + 3, fx(b.x + b.w / 2)), wpx = x1 - x0;
  const yBase = OY + Math.round((b.z + b.d / 2) * KZ) - Math.round(h0 * LIFT);
  const Hf = b.floors * FL + 1, Dr = Math.max(3, Math.round(b.d * KZ));
  const yFront = yBase - Hf;
  // profil zawalenia: o ile pikseli niżej kończy się każda kolumna fasady
  const drop = new Int16Array(wpx);
  if (b.ruin === 1) {
    const span = Math.round(wpx * (0.35 + r() * 0.5)), left = r() < 0.5;
    let dd = Math.round(Hf * (0.25 + r() * 0.45));
    for (let i = 0; i < span; i++) {
      const c = left ? i : wpx - 1 - i;
      if (i % 2 === 0) dd = Math.max(2, Math.min(Hf - 3, dd + Math.round((r() - 0.62) * 6)));
      drop[c] = Math.min(Hf - 3, dd + Math.round((span - i) * 0.6));
    }
  }
  shadow(g, x1, yBase, Dr, Hf - (b.ruin === 1 ? Hf * 0.3 : 0));
  const wall = b.col;
  // fasada kolumnami (gradient: u dołu ciemniej)
  for (let i = 0; i < wpx; i++) {
    const top = yFront + drop[i];
    const xi = x0 + i;
    px(g, css(wall, 0.8), xi, top, 1, yBase - top);
    px(g, css(wall, 0.68), xi, yBase - Math.min(6, yBase - top), 1, Math.min(6, yBase - top));
    if (!b.glass && (i * 7 + b.seed) % 11 === 0) px(g, css(wall, 0.74), xi, top, 1, yBase - top);
  }
  // gzymsy co kilka pięter
  for (let f = 3; f < b.floors; f += 4) {
    const y = yBase - f * FL - 1;
    for (let i = 0; i < wpx; i++) if (y > yFront + drop[i]) px(g, css(wall, 0.95), x0 + i, y, 1, 1);
  }
  // okna
  const step = b.glass ? 2 : 3;
  const winW = b.glass ? 1 : 2;
  for (let f = 0; f < b.floors; f++) {
    const y = yBase - (f + 1) * FL + 1;
    if (f === 0 && !b.glass) {
      // parter: witryny i drzwi
      for (let xx = x0 + 1; xx < x1 - 2; xx += 5) {
        const v = r();
        if (v < 0.25) continue;
        px(g, v < 0.85 ? '#1c1814' : '#5a4430', xx, y, 3, FL - 1);
        if (v > 0.6) px(g, css(wall, 0.5), xx, y, 3, 1);
      }
      continue;
    }
    for (let xx = x0 + 1; xx < x1 - winW; xx += step) {
      const i = xx - x0;
      if (y <= yFront + drop[i] + 1 || y <= yFront + drop[Math.min(wpx - 1, i + winW)] + 1) continue;
      const v = r();
      let c: string;
      if (b.glass) c = v < 0.55 ? '#3a4a54' : v < 0.8 ? '#24303a' : v < 0.96 ? '#121416' : '#6a8090';
      else c = v < 0.72 ? '#1a1714' : v < 0.86 ? '#2c2622' : v < 0.97 ? '#5a4632' : '#ffb050';
      px(g, c, xx, y, winW, FL - 2);
      // okopcenie nad wybitym oknem
      if (!b.glass && v > 0.9 && v < 0.97) px(g, 'rgba(20,14,10,0.45)', xx - 1, y - 2, winW + 2, 2);
    }
    if (b.glass) for (let xx = x0; xx < x1; xx++) if (y + FL - 1 > yFront + drop[xx - x0]) px(g, css(wall, 0.62), xx, y + FL - 2, 1, 1);
  }
  // krawędzie: lewa w świetle, prawa w cieniu
  px(g, css(wall, 1.0), x0, yFront + drop[0], 1, yBase - yFront - drop[0]);
  px(g, css(wall, 0.5), x1 - 1, yFront + drop[wpx - 1], 1, yBase - yFront - drop[wpx - 1]);
  // dach (tylko nad całymi kolumnami); nad zawalonymi - gruz na niższej wysokości
  const roof = b.roof;
  for (let i = 0; i < wpx; i++) {
    const xi = x0 + i;
    if (drop[i] === 0) {
      px(g, css(roof, 1.12), xi, yFront - Dr, 1, Dr);
      px(g, css(roof, 1.4), xi, yFront - 1, 1, 1);
      px(g, css(roof, 0.8), xi, yFront - Dr, 1, 1);
    } else {
      const top = yFront + drop[i];
      for (let k = 0; k < Dr; k++) px(g, hash(xi, top - k) < 0.3 ? '#2a2420' : css(wall, 0.55 + hash(xi * 3, k) * 0.5), xi, top - Dr + k, 1, 1);
      px(g, css(wall, 1.25), xi, top, 1, 1);
      if (hash(xi, b.seed) < 0.12) px(g, '#7a4a30', xi, top - Dr - 1 - Math.floor(hash(b.seed, xi) * 3), 1, 2 + Math.floor(hash(b.seed, xi) * 3));
    }
  }
  // przekrój stropów na granicy z zawaloną częścią
  for (let i = 1; i < wpx; i++) {
    if (drop[i] > 0 && drop[i - 1] === 0) for (let y = yFront; y < yFront + drop[i]; y++) px(g, (yBase - y) % FL === 0 ? css(wall, 1.1) : '#221c18', x0 + i, y, 1, 1);
    if (drop[i] === 0 && drop[i - 1] > 0) for (let y = yFront; y < yFront + drop[i - 1]; y++) px(g, (yBase - y) % FL === 0 ? css(wall, 1.1) : '#221c18', x0 + i - 1, y, 1, 1);
  }
  // nadbudówki na całym dachu
  const intact = drop.every((v) => v === 0);
  if (intact && wpx > 6) {
    const k = r();
    if (b.floors >= 6 && k < 0.45) {
      // zbiornik na wodę na nóżkach
      const tx = x0 + 2 + Math.floor(r() * (wpx - 7)), ty = yFront - Math.floor(Dr / 2);
      px(g, '#3a2e26', tx, ty - 2, 1, 3);
      px(g, '#3a2e26', tx + 3, ty - 2, 1, 3);
      px(g, '#6a5240', tx - 1, ty - 7, 6, 5);
      px(g, '#86684e', tx - 1, ty - 8, 6, 1);
      px(g, '#4a3a2e', tx + 4, ty - 7, 1, 5);
    } else if (k < 0.75) {
      // maszynownia windy / klimatyzatory
      const bw = 3 + Math.floor(r() * 4), tx = x0 + 1 + Math.floor(r() * (wpx - bw - 2)), ty = yFront - Dr + 1 + Math.floor(r() * Math.max(1, Dr - 4));
      px(g, css(roof, 0.75), tx, ty, bw, 3);
      px(g, css(roof, 1.3), tx, ty - 1, bw, 1);
    }
    if (b.floors >= 8 && r() < 0.5) {
      const ax = x0 + 1 + Math.floor(r() * (wpx - 2));
      px(g, '#5a5a5e', ax, yFront - Dr - 6, 1, 7);
      px(g, '#5a5a5e', ax - 1, yFront - Dr - 4, 3, 1);
    }
    if (r() < 0.25) px(g, '#1e1a16', x0 + 2 + Math.floor(r() * (wpx - 5)), yFront - Dr + 1 + Math.floor(r() * Math.max(1, Dr - 3)), 2 + Math.floor(r() * 2), 2);
  }
  // wyrwa po pocisku w fasadzie
  if (b.ruin === 2 && b.floors >= 3) {
    const hw = Math.max(3, Math.round(wpx * (0.2 + r() * 0.25))), hh = Math.min(Hf - 6, FL * (2 + Math.floor(r() * 3)));
    const hx = x0 + 2 + Math.floor(r() * Math.max(1, wpx - hw - 4)), hy = yFront + 3 + Math.floor(r() * Math.max(1, Hf - hh - 8));
    for (let i = 0; i < hw; i++) {
      const j0 = Math.round(hash(i, b.seed) * 2), j1 = Math.round(hash(b.seed, i) * 2);
      px(g, '#141110', hx + i, hy + j0, 1, hh - j0 - j1);
      px(g, css(wall, 1.15), hx + i, hy + j0 - 1, 1, 1);
    }
    for (let y = hy + FL; y < hy + hh - 1; y += FL) px(g, css(wall, 0.9), hx, y, hw, 1);
    rubble(g, hx + hw / 2, yBase + 2, hw + 6, 4, wall, r);
  }
  // stalowy szkielet ponad połową wysokości
  if (b.ruin === 3) {
    const cut = yFront + Math.round(Hf * (0.3 + r() * 0.25));
    px(g, '#0f0e0e', x0 + 1, yFront - Dr + 1, wpx - 2, cut - yFront + Dr - 1);
    for (let y = cut; y > yFront - Dr; y -= FL) px(g, '#5a5450', x0, y, wpx, 1);
    for (let xx = x0; xx < x1; xx += 4) px(g, '#4a4440', xx, yFront - Dr, 1, cut - yFront + Dr);
    px(g, '#4a4440', x1 - 1, yFront - Dr, 1, cut - yFront + Dr);
    // przekrzywiony kawał stropu i pręty
    g.fillStyle = '#6a6460';
    g.beginPath();
    g.moveTo(x0 + 2, yFront - Dr);
    g.lineTo(x0 + 8, yFront - Dr - 4);
    g.lineTo(x0 + 10, yFront - Dr - 3);
    g.lineTo(x0 + 4, yFront - Dr + 1);
    g.fill();
    px(g, '#7a4a30', x1 - 3, yFront - Dr - 4, 1, 4);
    px(g, '#7a4a30', x0 + wpx / 2, yFront - Dr - 3, 1, 3);
  }
  if (b.ruin === 1) rubble(g, left0(drop) ? x0 + wpx * 0.25 : x1 - wpx * 0.25, yBase + 2, wpx * 0.6 + 4, 5, wall, r);
}
const left0 = (drop: Int16Array): boolean => drop[0] > drop[drop.length - 1];

/** Dom podmiejski z dwuspadowym dachem (kalenica wschód-zachód). */
function house(g: Ctx2D, x: number, z: number, w: number, d: number, col: number, roofCol: number, seed: number, ruined: boolean): void {
  const r = seeded(seed);
  const b = boxAt(g, x, z, w, d, 0.42, col);
  const ww = b.x1 - b.x0;
  for (let xx = b.x0 + 2; xx < b.x1 - 2; xx += 4) px(g, r() < 0.8 ? '#1a1714' : '#5a4632', xx, b.yFront + 1, 2, 2);
  // dach: przednia połać ciemniej, tylna jaśniej, kalenica
  const rh = b.yFront - b.yTop, mid = b.yTop + Math.floor(rh / 2) - 2;
  for (let i = -1; i <= ww; i++) {
    const broken = ruined && hash(i, seed) < 0.35 && i > ww * 0.3 && i < ww * 0.8;
    if (broken) {
      px(g, '#1a1410', b.x0 + i, mid + 1, 1, b.yFront - mid - 1);
      px(g, '#4a3626', b.x0 + i, mid + 1 + ((i * 3) % 3), 1, 1);
      continue;
    }
    px(g, css(roofCol, 0.75), b.x0 + i, mid, 1, b.yFront - mid);
    px(g, css(roofCol, 1.05), b.x0 + i, b.yTop - 2, 1, mid - b.yTop + 2);
    px(g, css(roofCol, 1.3), b.x0 + i, mid, 1, 1);
    if ((i & 1) === 0) px(g, css(roofCol, 0.62), b.x0 + i, mid + 2, 1, 1);
  }
  if (!ruined && r() < 0.5) px(g, '#4a3a30', b.x0 + 2, b.yTop - 4, 2, 3);
}

/** Wrak auta (poziomo albo pionowo w głąb). */
function car(g: Ctx2D, x: number, z: number, vert: boolean, col: number, burnt: boolean, bus = false): void {
  const len = bus ? 1.0 : 0.5, wid = bus ? 0.32 : 0.26;
  const c = burnt ? 0x3a3230 : col;
  const b = boxAt(g, x, z, vert ? wid : len, vert ? len : wid, bus ? 0.3 : 0.18, c, 0, false);
  px(g, 'rgba(20,12,8,0.35)', b.x0 + 1, b.yBase, b.x1 - b.x0, 1);
  if (vert) {
    px(g, '#1a1a1c', b.x0, b.yTop + 1, b.x1 - b.x0, 1);
    px(g, '#141414', b.x0, b.yBase - 1, 1, 1);
    px(g, '#141414', b.x1 - 1, b.yBase - 1, 1, 1);
  } else {
    const w = b.x1 - b.x0;
    if (bus) for (let xx = b.x0 + 1; xx < b.x1 - 1; xx += 2) px(g, '#1a1a1c', xx, b.yFront, 1, 1);
    else px(g, burnt ? '#1a1414' : '#2a3036', b.x0 + 1, b.yTop, w - 2, 2);
    px(g, '#141414', b.x0 + 1, b.yBase - 1, 1, 1);
    px(g, '#141414', b.x1 - 2, b.yBase - 1, 1, 1);
  }
  if (burnt) px(g, '#5a2a1a', b.x0 + 1, b.yFront, 1, 1);
}

/** Uliczna latarnia (czasem przewrócona / zgięta). */
function lamp(g: Ctx2D, x: number, z: number, state: number): void {
  const cx = fx(x), y = groundY(x, z);
  if (state < 0.2) {
    px(g, '#3a3a3e', cx, y - 1, 9, 1);
    return;
  }
  px(g, '#4a4a4e', cx, y - 12, 1, 12);
  if (state < 0.4) {
    px(g, '#4a4a4e', cx - 3, y - 14, 3, 1);
    px(g, '#4a4a4e', cx - 4, y - 13, 1, 2);
  } else {
    px(g, '#4a4a4e', cx, y - 13, 4, 1);
    px(g, '#8a8070', cx + 3, y - 12, 2, 1);
  }
}

/** Martwe drzewo (szkielet gałęzi). */
function deadTree(g: Ctx2D, x: number, z: number, s: number, seed: number): void {
  const cx = fx(x), y = groundY(x, z), h = Math.round(8 + s * 8);
  px(g, 'rgba(30,18,10,0.3)', cx, y, 5, 1);
  px(g, '#3a2a1e', cx, y - h, 1, h);
  px(g, '#3a2a1e', cx - 1, y - 2, 3, 2);
  for (let k = 0; k < 4; k++) {
    const hy = y - h + 2 + Math.floor(hash(seed, k) * (h - 5)), dir = k % 2 ? 1 : -1, len = 2 + Math.floor(hash(k, seed) * 3);
    for (let i = 1; i <= len; i++) px(g, '#3a2a1e', cx + dir * i, hy - Math.floor(i / 2), 1, 1);
  }
}

/** Martwa sosna w górach. */
function pine(g: Ctx2D, x: number, z: number, s: number): void {
  const cx = fx(x), y = groundY(x, z), h = Math.round(9 + s * 7);
  px(g, '#2e241c', cx, y - h, 1, h);
  for (let k = 2; k < h - 2; k += 2) {
    const w = Math.round(((k / h) * 5) + 1);
    px(g, k % 4 ? '#3a3a2a' : '#2e2e22', cx - w, y - h + k, w * 2 + 1, 1);
  }
}

function smokePlume(g: Ctx2D, x: number, y: number, n: number, dark = false): void {
  for (let i = 0; i < n; i++) {
    const a = 0.45 - i * (0.4 / n);
    g.fillStyle = dark ? `rgba(40,34,30,${a})` : `rgba(150,140,130,${a})`;
    g.beginPath();
    g.arc(x + i * 3 + Math.sin(i) * 1.5, y - i * 4, 2 + i * 1.1, 0, Math.PI * 2);
    g.fill();
  }
}

// ------------------------------------------------------------------ miasto: obiekty

function cityItems(items: Item[], r: () => number): void {
  const push = (key: number, draw: (g: Ctx2D) => void): void => void items.push({ key, draw });
  for (let bj = -BJ; bj <= BJ; bj++)
    for (let bi = -BI; bi <= BI; bi++) {
      if (!on(bi, bj)) continue;
      const cx = CX + bi * G, cz = CZ + bj * G;
      const L = cx - G / 2 + halfW(bi - 1) + SIDE + 0.04, R = cx + G / 2 - halfW(bi) - SIDE - 0.04;
      const T = cz - G / 2 + halfW(bj - 1) + SIDE + 0.04, B = cz + G / 2 - halfW(bj) - SIDE - 0.04;
      const core = Math.exp(-(((bi - 0.4) ** 2) / 7 + ((bj + 0.4) ** 2) / 4));
      const e = ((cx - CX) / CRX) ** 2 + ((cz - CZ) / CRZ) ** 2;
      if (isPlaza(bi, bj)) {
        plaza(items, cx, cz, L, R, T, B, r);
        continue;
      }
      const wB = R - L, dB = B - T;
      if (core > 0.55 && r() < 0.8) {
        // śródmieście: wieżowiec (czasem dwa) + niska przybudówka z tyłu
        const two = r() < 0.4;
        const n = two ? 2 : 1;
        for (let k = 0; k < n; k++) {
          const bw = two ? wB * (0.4 + r() * 0.08) : wB * (0.62 + r() * 0.3), bd = dB * (0.5 + r() * 0.3);
          const bx = two ? (k ? R - bw / 2 : L + bw / 2) : L + bw / 2 + r() * (wB - bw), bz = B - bd / 2 - (two && k ? 0.25 : 0);
          const rv = r();
          const b: Bld = { x: bx, z: bz, w: bw, d: bd, floors: Math.round(9 + core * 7 + r() * 5), col: [0x5e646a, 0x6a6862, 0x55524e, 0x7a7468][Math.floor(r() * 4)], roof: ROOFS[Math.floor(r() * 4)], ruin: rv < 0.3 ? 3 : rv < 0.55 ? 1 : rv < 0.75 ? 2 : 0, glass: r() < 0.55, seed: Math.floor(r() * 1e9) };
          push(bz + bd / 2, (g) => building(g, b));
        }
        const ad = dB * 0.3, ab: Bld = { x: L + wB / 2, z: T + ad / 2, w: wB * 0.9, d: ad, floors: 2 + Math.floor(r() * 3), col: WALLS[Math.floor(r() * WALLS.length)], roof: ROOFS[0], ruin: r() < 0.4 ? 1 : 0, glass: false, seed: Math.floor(r() * 1e9) };
        push(ab.z + ad / 2, (g) => building(g, ab));
        continue;
      }
      const suburb = e > 0.62;
      // dwa rzędy zabudowy (pierzeje od północy i od południa), parcele dzielone na 1..3
      for (const row of [0, 1]) {
        const rd = dB * (row ? 0.46 : 0.42), rz = row ? B - rd / 2 : T + rd / 2;
        const parts = 1 + Math.floor(r() * 3);
        let x = L;
        for (let p = 0; p < parts; p++) {
          const pw = p === parts - 1 ? R - x : wB / parts * (0.8 + r() * 0.4);
          const lx = x + pw / 2;
          x += pw;
          const v = r();
          if (v < (suburb ? 0.3 : 0.14)) {
            // pusta parcela: gruz, wrak, uschnięte drzewo
            const seed = Math.floor(r() * 1e9), t = r();
            push(rz, (g) => {
              const rr = seeded(seed);
              if (t < 0.5) rubble(g, fx(lx), groundY(lx, rz), pw * KX * 0.7, 4 + rr() * 4, WALLS[seed % WALLS.length], rr);
              else if (t < 0.9) car(g, lx, rz, false, 0x7a5a3a, true);
              else deadTree(g, lx, rz, rr(), seed);
            });
            continue;
          }
          const col = WALLS[Math.floor(r() * WALLS.length)], seed = Math.floor(r() * 1e9);
          if (suburb && r() < 0.6) {
            const ruined = r() < 0.45, rc = [0x8a4a34, 0x6a5a4a, 0x5a4a44][Math.floor(r() * 3)];
            const hw = Math.min(pw - 0.12, 0.9), hd = rd * 0.85;
            push(rz + hd / 2, (g) => house(g, lx, rz, hw, hd, col, rc, seed, ruined));
            continue;
          }
          const rv = r();
          if (rv < 0.12) {
            // zawalony budynek: kupa gruzu z kikutami ścian
            push(rz + rd / 2, (g) => {
              const rr = seeded(seed), y = groundY(lx, rz + rd / 2);
              rubble(g, fx(lx), y, pw * KX * 0.95, 9 + rr() * 5, col, rr);
              for (let k = 0; k < 2; k++) {
                const sx = fx(lx - pw * 0.35 + rr() * pw * 0.7), sh = 6 + Math.floor(rr() * 10);
                px(g, css(col, 0.8), sx, y - sh - 2, 2, sh);
                px(g, css(col, 1.1), sx, y - sh - 3, 2, 1);
              }
            });
            continue;
          }
          const floors = Math.max(1, Math.round((suburb ? 1 : 2) + core * 6 * r() + r() * (suburb ? 1.5 : 3)));
          const b: Bld = { x: lx, z: rz, w: Math.max(0.4, pw - 0.1), d: rd, floors, col, roof: ROOFS[Math.floor(r() * 4)], ruin: rv < 0.42 ? 1 : rv < 0.58 ? 2 : 0, glass: false, seed };
          push(rz + rd / 2, (g) => building(g, b));
        }
      }
    }
  // przewrócony wieżowiec leżący w poprzek bocznej ulicy
  {
    const x = CX - 2 * G, z = CZ - 1.5 * G;
    push(z + 0.4, (g) => {
      const b = boxAt(g, x, z, 2.6, 0.62, 0.62, 0x5e646a);
      for (let xx = b.x0 + 2; xx < b.x1 - 2; xx += 3) for (let yy = b.yFront + 2; yy < b.yBase - 1; yy += 3) px(g, hash(xx, yy) < 0.7 ? '#1a1a1c' : '#3a4a54', xx, yy, 2, 1);
      px(g, '#141110', b.x1 - 4, b.yTop, 4, b.yBase - b.yTop);
      rubble(g, b.x1 + 2, b.yBase + 1, 14, 6, 0x5e646a, seeded(77));
    });
  }
  // wraki, autobusy, latarnie i zapory na ulicach
  for (let k = 0; k < 46; k++) {
    const vert = r() < 0.5, line = Math.floor((r() - 0.5) * (vert ? 11 : 9));
    const x = vert ? CX + (line + 0.5) * G + (r() - 0.5) * 0.3 : CX + (r() - 0.5) * 2 * CRX;
    const z = vert ? CZ + (r() - 0.5) * 2 * CRZ : CZ + (line + 0.5) * G + (r() - 0.5) * 0.24;
    if (!inCity({ x: W(x), z: W(z) })) continue;
    const col = [0x8a3a2a, 0x4a5a6a, 0x7a7a5a, 0x5a4a3a, 0x9a8a3a, 0x3a5a4a][k % 6], burnt = r() < 0.4, bus = k % 9 === 0;
    push(z, (g) => car(g, x, z, vert, col, burnt, bus));
  }
  for (let i = -BI; i <= BI; i++) {
    const x = CX + i * G, z = AVE_Z + AVE_W + SIDE * 0.5;
    if (!on(i, 0) && !on(i, 1)) continue;
    const s = r();
    push(z, (g) => lamp(g, x, z, s));
    const z2 = AVE_Z - AVE_W - SIDE * 0.5, s2 = r();
    push(z2, (g) => lamp(g, x + 0.6, z2, s2));
  }
  // leje po bombach na skrzyżowaniach (malowane na ziemi, przed bryłami)
  for (let k = 0; k < 6; k++) {
    const x = CX + (Math.floor((r() - 0.5) * 10) + 0.5) * G, z = CZ + (Math.floor((r() - 0.5) * 7) + 0.5) * G + (r() - 0.5) * 1.2;
    if (!inCity({ x: W(x), z: W(z) }) || Math.abs(z - AVE_Z) < 0.8) continue;
    const s = 0.5 + r() * 0.5;
    push(-99, (g) => crater(g, x, z, s));
  }
  // brama miasta na końcu alei: dwie wieże, szlaban, worki z piaskiem, zapory przeciwczołgowe
  for (const dz of [-0.85, 0.85])
    push(AVE_Z + dz + 0.22, (g) => {
      const b = boxAt(g, GX0, AVE_Z + dz, 0.5, 0.44, 1.7, 0x5a5048);
      px(g, '#1a1614', b.x0 + 2, b.yFront + 3, b.x1 - b.x0 - 4, 2);
      px(g, '#4a4038', b.x0 - 1, b.yTop - 2, b.x1 - b.x0 + 2, 2);
    });
  push(AVE_Z + 0.2, (g) => {
    const y = groundY(GX0, AVE_Z) - 9;
    for (let xx = fx(GX0) - 1; xx < fx(GX0) + 2; xx++) px(g, '#3a3430', xx, y - 1, 1, 2);
    for (let yy = groundY(GX0, AVE_Z - 0.6); yy < groundY(GX0, AVE_Z + 0.6); yy += 2) px(g, (yy >> 1) % 2 ? '#c03a2a' : '#d8d0c0', fx(GX0) + 1, yy - 4, 2, 2);
  });
  for (let k = 0; k < 6; k++) {
    const x = GX0 - 0.9 - (k % 2) * 0.3, z = AVE_Z - 1.6 + k * 0.62;
    if (Math.abs(z - AVE_Z) < 0.45) continue;
    push(z, (g) => tankTrap(g, x, z));
  }
  for (const dz of [-1.4, 1.4]) push(AVE_Z + dz + 0.1, (g) => sandbags(g, GX0 + 0.4, AVE_Z + dz, 1.4));
  // zawalony wiadukt wjazdowy
  for (let k = 0; k < 6; k++) {
    if (k === 3) continue;
    const x = -15.5 + k, z = 5.9 - k * 0.5, sag = k === 2 || k === 4 ? -0.35 : 0;
    push(z + 0.4, (g) => {
      boxAt(g, x, z + 0.25, 0.22, 0.22, 1.2 + sag, 0x5a5450);
      const b = boxAt(g, x, z, 1.8, 0.8, 0.2, 0x6a6460, 1.2 + sag);
      px(g, '#8a8478', b.x0, b.yTop - 1, b.x1 - b.x0, 1);
    });
  }
  push(5.9 - 1.5 + 0.6, (g) => rubble(g, fx(-12.5), groundY(-12.5, 4.6), 16, 7, 0x6a6460, seeded(91)));
}

function crater(g: Ctx2D, x: number, z: number, s: number): void {
  const cx = fx(x), cy = groundY(x, z), rx = Math.round(6 * s + 3), rz = Math.round(rx * 0.6);
  g.fillStyle = 'rgba(80,66,54,0.9)';
  g.beginPath();
  g.ellipse(cx, cy, rx + 2, rz + 1.5, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#2a2420';
  g.beginPath();
  g.ellipse(cx, cy, rx, rz, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#3e342c';
  g.beginPath();
  g.ellipse(cx + 1, cy + 1, rx - 2, rz - 1, 0, 0, Math.PI * 2);
  g.fill();
  px(g, '#9a8a74', cx - rx, cy - 1, 2, 1);
  px(g, '#9a8a74', cx + rx - 1, cy - rz, 2, 1);
}

function tankTrap(g: Ctx2D, x: number, z: number): void {
  const cx = fx(x), y = groundY(x, z);
  for (let i = 0; i < 5; i++) {
    px(g, '#4a4440', cx - 2 + i, y - 1 - i, 1, 1);
    px(g, '#5e5852', cx + 2 - i, y - 1 - i, 1, 1);
  }
  px(g, '#3a3430', cx - 2, y - 1, 5, 1);
}

function sandbags(g: Ctx2D, x: number, z: number, len: number): void {
  const x0 = fx(x - len / 2), x1 = fx(x + len / 2), y = groundY(x, z);
  for (let row = 0; row < 2; row++)
    for (let xx = x0 + row * 2; xx < x1 - 2; xx += 4) {
      px(g, '#8a7a5a', xx, y - 3 - row * 2, 4, 2);
      px(g, '#a8966e', xx, y - 3 - row * 2, 3, 1);
    }
}

/** Plac zleceń: pomnik na cokole (z tyłu, flaga stoi na środku), ławki, uschnięte drzewa, gruz. */
function plaza(items: Item[], cx: number, cz: number, L: number, R: number, T: number, B: number, r: () => number): void {
  const seed = Math.floor(r() * 1e9);
  items.push({ key: cz - 0.45, draw: (g) => {
    const b = boxAt(g, cx - 0.1, cz - 0.62, 0.5, 0.36, 0.3, 0x8a8274);
    // posąg bez głowy / ręki
    const sx = Math.round((b.x0 + b.x1) / 2);
    px(g, '#5a6a5a', sx - 1, b.yTop - 9, 3, 9);
    px(g, '#4a5a4a', sx + 1, b.yTop - 9, 1, 9);
    px(g, '#5a6a5a', sx - 3, b.yTop - 8, 2, 1);
    px(g, '#5a6a5a', sx - 4, b.yTop - 11, 1, 3);
    rubble(g, sx + 6, b.yBase + 1, 8, 3, 0x8a8274, seeded(seed));
  } });
  for (const [dx, dz] of [[-1, -1], [1, 1]]) {
    const x = dx < 0 ? L + 0.18 : R - 0.18, z = dz < 0 ? T + 0.16 : B - 0.16, s = r();
    items.push({ key: z, draw: (g) => deadTree(g, x, z, s, seed + dx * 3 + dz) });
  }
  items.push({ key: B - 0.3, draw: (g) => {
    for (const bx of [cx - 0.55, cx + 0.45]) {
      const xx = fx(bx), y = groundY(bx, B - 0.3);
      px(g, '#5a4430', xx, y - 2, 5, 1);
      px(g, '#3a2e24', xx, y - 1, 1, 1);
      px(g, '#3a2e24', xx + 4, y - 1, 1, 1);
    }
  } });
}

// ------------------------------------------------------------------ pozostałe strefy

function regionItems(items: Item[], r: () => number): void {
  const push = (key: number, draw: (g: Ctx2D) => void): void => void items.push({ key, draw });
  // ================= strefa przemysłowa
  const halls: [number, number, number, number, number, number][] = [[8.7, -11.9, 2.3, 1.5, 1.3, 0x7a4a30], [12.1, -12.7, 2.5, 1.8, 1.6, 0x5a4a40], [16.1, -12.4, 2.1, 1.6, 1.2, 0x6a5040], [11.3, -9.1, 1.9, 1.2, 1.0, 0x6a5a4a]];
  for (const [x, z, w, d, h, col] of halls)
    push(z + d / 2, (g) => {
      const b = boxAt(g, x, z, w, d, h, col);
      // dach szedowy: pasy świetlików
      for (let y = b.yTop + 1; y < b.yFront - 1; y += 3) {
        px(g, css(col, 1.35), b.x0, y, b.x1 - b.x0, 1);
        px(g, '#3a4048', b.x0 + 1, y + 1, b.x1 - b.x0 - 2, 1);
      }
      // ściana: wysokie okna, brama
      for (let xx = b.x0 + 3; xx < b.x1 - 3; xx += 4) px(g, hash(xx, b.yBase) < 0.3 ? '#2a3038' : '#1a1a1c', xx, b.yFront + 2, 2, Math.max(2, b.yBase - b.yFront - 8));
      const gw = 6;
      px(g, '#2a2420', Math.round((b.x0 + b.x1) / 2 - gw / 2), b.yBase - 7, gw, 7);
      for (let yy = b.yBase - 7; yy < b.yBase; yy += 2) px(g, '#5a5048', Math.round((b.x0 + b.x1) / 2 - gw / 2), yy, gw, 1);
      // dziura w dachu
      if (hash(Math.round(x * 10), 3) < 0.6) px(g, '#141110', b.x0 + 4, b.yTop + 2, 5, 3);
    });
  for (const [x, z, h] of [[13.5, -14.1, 4.6], [9.9, -13.1, 3.6], [17.3, -13.6, 3.9]]) {
    push(z + 0.2, (g) => {
      const b = boxAt(g, x, z, 0.42, 0.42, h, 0x7a3a2a);
      for (let y = b.yFront + 3; y < b.yBase - 2; y += 6) px(g, '#5a2a1e', b.x0, y, b.x1 - b.x0, 1);
      px(g, '#d8d0c0', b.x0, b.yFront + 2, b.x1 - b.x0, 2);
      px(g, '#c03020', b.x0, b.yFront + 5, b.x1 - b.x0, 1);
      smokePlume(g, b.x0 + 3, b.yTop - 4, 9, x < 12);
    });
  }
  {
    const x = 21.4, z = -16.4;
    push(z + 1, (g) => {
      // chłodnia kominowa: hiperboloida z talią i pęknięciem
      const cx = fx(x), yb = groundY(x, z + 1), hh = 3.2 * LIFT, rb = 1.1 * KX;
      g.fillStyle = '#7a746a';
      g.beginPath();
      g.moveTo(cx - rb, yb);
      g.quadraticCurveTo(cx - rb * 0.45, yb - hh * 0.6, cx - rb * 0.62, yb - hh);
      g.lineTo(cx + rb * 0.62, yb - hh);
      g.quadraticCurveTo(cx + rb * 0.45, yb - hh * 0.6, cx + rb, yb);
      g.fill();
      g.fillStyle = '#9a948a';
      g.fillRect(cx - rb * 0.5, yb - hh * 0.78, rb * 0.45, hh * 0.66);
      g.fillStyle = '#5a564e';
      g.fillRect(cx + rb * 0.3, yb - hh * 0.8, rb * 0.25, hh * 0.7);
      g.fillStyle = '#2a2624';
      g.fillRect(cx - rb * 0.62 + 1, yb - hh - 2, rb * 1.24 - 2, 3);
      g.strokeStyle = '#3a3430';
      g.beginPath();
      g.moveTo(cx - 2, yb - hh + 2);
      g.lineTo(cx + 1, yb - hh * 0.7);
      g.lineTo(cx - 1, yb - hh * 0.5);
      g.stroke();
      for (let i = 0; i < 4; i++) px(g, '#5a564e', cx - rb + 2 + i * (rb / 2), yb - 4, 2, 4);
    });
  }
  // zbiorniki (walce z kopułą), rurociąg na estakadzie
  for (const [x, z, rr] of [[7.2, -14.2, 0.6], [8.6, -14.9, 0.5], [6.6, -12.6, 0.45]]) {
    push(z + rr, (g) => {
      const cx = fx(x), yb = groundY(x, z + rr), w = Math.round(rr * 2 * KX), hh = Math.round(1.6 * LIFT * rr * 1.6), x0 = cx - (w >> 1);
      shadow(g, x0 + w, yb, Math.round(rr * 2 * KZ), hh);
      for (let i = 0; i < w; i++) {
        const t = i / (w - 1), f = 0.6 + Math.sin(t * Math.PI) * 0.5 - t * 0.2;
        px(g, css(0x8a7a64, f), x0 + i, yb - hh, 1, hh);
      }
      for (let y = yb - hh + 4; y < yb; y += 5) px(g, 'rgba(60,40,30,0.5)', x0, y, w, 1);
      g.fillStyle = css(0x8a7a64, 1.2);
      g.beginPath();
      g.ellipse(cx, yb - hh, w / 2, Math.max(2, rr * KZ * 0.8), 0, Math.PI, Math.PI * 2);
      g.fill();
      px(g, '#7a3a24', x0 + 2, yb - hh + 6, 3, 4);
      px(g, '#c0a030', x0, yb - 6, w, 1);
    });
  }
  push(-13.5, (g) => {
    const y0 = groundY(8, -13.6) - 9, xa = fx(7.6), xb = fx(11);
    for (let xx = xa; xx < xb; xx += 7) px(g, '#4a4440', xx, y0, 1, groundY(xx / KX, -13.6) - y0);
    px(g, '#6a6a6e', xa, y0 - 2, xb - xa, 2);
    px(g, '#8a8a8e', xa, y0 - 2, xb - xa, 1);
  });
  // tor kolejowy z wagonami (szyny malowane na ziemi)
  push(-99, (g) => rails(g, 3.5, 18.5, -10.35));
  for (let k = 0; k < 4; k++) {
    const x = 6.5 + k * 1.15, col = [0x6a3a2a, 0x5a4a3a, 0x3a4a5a, 0x6a3a2a][k];
    push(-10.35 + 0.2, (g) => {
      const b = boxAt(g, x, -10.35, 1.0, 0.36, 0.5, col, 0.05);
      for (let xx = b.x0 + 2; xx < b.x1 - 1; xx += 3) px(g, css(col, 0.6), xx, b.yFront + 1, 1, b.yBase - b.yFront - 2);
      px(g, '#141414', b.x0 + 1, b.yBase, 2, 1);
      px(g, '#141414', b.x1 - 3, b.yBase, 2, 1);
    });
  }
  // plac kontenerowy z suwnicą
  for (let k = 0; k < 14; k++) {
    const row = k % 2, x = 8 + Math.floor(k / 2) * 0.95 + (r() - 0.5) * 0.15, z = -7.3 + row * 0.42, col = [0xa04a2a, 0x2a6a8a, 0x8a8a3a, 0x5a6a4a, 0x8a5a3a][k % 5], up = r() < 0.35 ? 0.38 : 0;
    if (r() < 0.12) continue;
    push(z + 0.2 + up * 0.01, (g) => {
      const b = boxAt(g, x, z, 0.9, 0.38, 0.38, col, up);
      for (let xx = b.x0 + 1; xx < b.x1 - 1; xx += 2) px(g, css(col, 0.62), xx, b.yFront, 1, b.yBase - b.yFront);
    });
  }
  push(-6.7, (g) => {
    const xa = fx(9.2), xb = fx(12.6), ya = groundY(9.2, -6.8), yb = groundY(12.6, -6.8), top = Math.min(ya, yb) - 20;
    px(g, '#c09020', xa, top, 2, ya - top);
    px(g, '#c09020', xb, top, 2, yb - top);
    px(g, '#d8a828', xa - 1, top - 2, xb - xa + 4, 3);
    px(g, '#3a3430', xa + 14, top + 1, 1, 8);
    px(g, '#5a5048', xa + 12, top + 9, 5, 2);
  });
  // beczki z odpadami i tablice ostrzegawcze wokół krateru
  for (let k = 0; k < 9; k++) {
    const a = k * 0.72 + 0.3, x = KRX + Math.cos(a) * 3.3, z = KRZ + Math.sin(a) * 3.0;
    push(z, (g) => {
      const b = boxAt(g, x, z, 0.2, 0.18, 0.28, 0x6a8a2a, 0, false);
      px(g, '#3a4a1a', b.x0, b.yFront + 1, b.x1 - b.x0, 1);
      if (k % 3 === 0) {
        const cx = fx(x + 0.3), y = groundY(x + 0.3, z);
        px(g, '#3a3430', cx, y - 8, 1, 8);
        px(g, '#e0c030', cx - 2, y - 11, 5, 4);
        px(g, '#1a1a1a', cx, y - 10, 1, 2);
      }
    });
  }

  // ================= góry: bunkier w zboczu, maszt, radar, schrony bojowe, ogrodzenie, martwe sosny
  push(-8.0 + 0.3, (g) => {
    const b = boxAt(g, -12, -8.0, 2.2, 0.6, 1.4, 0x5a5a5e);
    const w = b.x1 - b.x0;
    // skośne skrzydła portalu
    g.fillStyle = css(0x5a5a5e, 0.7);
    g.beginPath();
    g.moveTo(b.x0, b.yFront);
    g.lineTo(b.x0 - 6, b.yBase);
    g.lineTo(b.x0, b.yBase);
    g.fill();
    g.beginPath();
    g.moveTo(b.x1, b.yFront);
    g.lineTo(b.x1 + 6, b.yBase);
    g.lineTo(b.x1, b.yBase);
    g.fill();
    // wrota pancerne w pasy
    const dx = b.x0 + 6, dw = w - 12, dy = b.yFront + 4;
    px(g, '#0a0a0c', dx - 1, dy - 1, dw + 2, b.yBase - dy + 1);
    px(g, '#4a4c50', dx, dy, dw, b.yBase - dy);
    px(g, '#2a2c30', dx + dw / 2, dy, 1, b.yBase - dy);
    for (let xx = b.x0; xx < b.x1; xx += 4) px(g, '#c0a030', xx, b.yFront, 2, 2);
    px(g, '#ff4030', b.x0 + 3, b.yFront + 4, 1, 1);
    px(g, '#ff4030', b.x1 - 4, b.yFront + 4, 1, 1);
  });
  push(-7.4, (g) => {
    sandbags(g, -13.4, -7.4, 0.9);
    sandbags(g, -10.6, -7.4, 0.9);
  });
  push(-9.0, (g) => {
    // maszt kratowy z odciągami
    const cx = fx(-10.6), y = groundY(-10.6, -9.0), h = 4 * LIFT;
    g.strokeStyle = 'rgba(120,120,120,0.5)';
    g.beginPath();
    g.moveTo(cx, y - h + 4);
    g.lineTo(cx - 14, y + 1);
    g.moveTo(cx, y - h + 4);
    g.lineTo(cx + 14, y + 1);
    g.stroke();
    px(g, '#8a8a8a', cx - 1, y - h, 1, h);
    px(g, '#8a8a8a', cx + 1, y - h, 1, h);
    for (let yy = y - h + 2; yy < y; yy += 3) px(g, '#6a6a6a', cx - 1, yy, 3, 1);
  });
  push(-14.2 + 0.3, (g) => {
    const b = boxAt(g, -14.4, -14.2, 0.5, 0.5, 0.5, 0x5a5a5e);
    const cx = Math.round((b.x0 + b.x1) / 2), cy = b.yTop - 7;
    g.fillStyle = '#b8b8b0';
    g.beginPath();
    g.ellipse(cx, cy, 7, 4, -0.5, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#8a8a84';
    g.beginPath();
    g.ellipse(cx + 1, cy + 1, 5, 2.5, -0.5, 0, Math.PI * 2);
    g.fill();
    px(g, '#5a5a5e', cx, cy + 3, 1, b.yTop - cy - 3);
    px(g, '#5a5a5e', cx - 2, cy - 4, 1, 4);
  });
  for (const [x, z] of [[-17.8, -7.0], [-8.0, -8.0], [-20.6, -10.6]])
    push(z + 0.3, (g) => {
      // schron bojowy: niski betonowy klocek ze szczeliną strzelniczą
      const b = boxAt(g, x, z, 0.8, 0.6, 0.45, 0x6a6a64);
      px(g, '#0e0e0e', b.x0 + 3, b.yFront + 2, b.x1 - b.x0 - 6, 1);
      px(g, css(0x6a6a64, 1.3), b.x0 + 1, b.yTop, b.x1 - b.x0 - 2, 1);
    });
  for (const [x, z] of [[-21.4, -9.4], [-14.3, -10.8]]) push(z + 0.1, (g) => {
    const b = boxAt(g, x, z, 0.3, 0.3, 0.5, 0x5a5a5e);
    px(g, '#1a1a1c', b.x0, b.yTop, b.x1 - b.x0, 2);
  });
  for (let k = 0; k < 16; k++) {
    const x = -19.5 + k * 0.75;
    if (Math.abs(x + 12) < 1.2) continue;
    push(-6.3, (g) => {
      const cx = fx(x), y = groundY(x, -6.3);
      px(g, '#4a3a2e', cx, y - 6, 1, 6);
      const nx = fx(x + 0.75), ny = groundY(x + 0.75, -6.3);
      if (k < 15 && Math.abs(x + 0.75 + 12) >= 1.2) {
        g.strokeStyle = 'rgba(110,110,110,0.7)';
        g.beginPath();
        g.moveTo(cx, y - 5);
        g.lineTo(nx, ny - 5);
        g.moveTo(cx, y - 2.5);
        g.lineTo(nx, ny - 2.5);
        g.stroke();
      }
    });
  }
  for (let i = 0; i < 70; i++) {
    const x = -28 + r() * 26, z = -18 + r() * 12, s = r();
    const h = heightQ8(W(x), W(z)) / WQ;
    if (h < 1.2 || h > 5.2 || !freeAt(x, z, 0.6)) continue;
    push(z, (g) => pine(g, x, z, s));
  }

  // ================= pustkowia: obóz Nomadów, wrak samolotu, szkielet olbrzyma, wieża wiertnicza, wraki
  for (let k = 0; k < 6; k++) {
    const a = k * 1.05 + 0.2, x = 22 + Math.cos(a) * 1.6, z = 9.5 + Math.sin(a) * 1.2, col = [0xc8a468, 0x9a6a3a, 0xb88a54][k % 3];
    push(z, (g) => {
      const cx = fx(x), y = groundY(x, z);
      px(g, 'rgba(30,18,10,0.3)', cx, y, 9, 2);
      g.fillStyle = css(col);
      g.beginPath();
      g.moveTo(cx - 7, y);
      g.lineTo(cx, y - 10);
      g.lineTo(cx + 7, y);
      g.fill();
      g.fillStyle = css(col, 0.68);
      g.beginPath();
      g.moveTo(cx, y - 10);
      g.lineTo(cx + 7, y);
      g.lineTo(cx + 2, y);
      g.fill();
      px(g, css(col, 0.5), cx - 5, y - 3, 10, 1);
      px(g, '#2a1a10', cx - 1, y - 4, 2, 4);
      px(g, '#4a3020', cx, y - 12, 1, 3);
    });
  }
  for (let k = 0; k < 3; k++) {
    const x = 24.6 + k * 1.0, z = 8.0 + k * 0.6;
    push(z + 0.2, (g) => {
      const b = boxAt(g, x, z, 0.9, 0.45, 0.35, 0x6a4a2a);
      g.fillStyle = '#d8c8a0';
      g.beginPath();
      g.ellipse((b.x0 + b.x1) / 2, b.yTop, (b.x1 - b.x0) / 2, 5, 0, Math.PI, Math.PI * 2);
      g.fill();
      px(g, '#b8a880', b.x0, b.yTop, b.x1 - b.x0, 1);
      px(g, '#141414', b.x0 + 1, b.yBase - 1, 2, 2);
      px(g, '#141414', b.x1 - 3, b.yBase - 1, 2, 2);
    });
  }
  push(9.5 - 1.6, (g) => {
    // totem z czaszką
    const cx = fx(20.2), y = groundY(20.2, 7.9);
    px(g, '#5a3a24', cx, y - 14, 2, 14);
    px(g, '#5a3a24', cx - 3, y - 11, 8, 1);
    px(g, '#e6dcc0', cx - 1, y - 18, 4, 4);
    px(g, '#1a1410', cx, y - 17, 1, 1);
    px(g, '#1a1410', cx + 2, y - 17, 1, 1);
  });
  push(11.3, (g) => {
    // wrak samolotu: kadłub, złamane skrzydło, statecznik
    const x0 = fx(26.2), x1 = fx(29.6), y = groundY(27.8, 11.3);
    px(g, 'rgba(30,18,10,0.3)', x0 + 4, y, x1 - x0, 3);
    px(g, '#9a9c9a', x0, y - 8, x1 - x0, 7);
    px(g, '#b8bab6', x0, y - 9, x1 - x0, 2);
    px(g, '#6a6c6a', x0, y - 2, x1 - x0, 2);
    for (let xx = x0 + 6; xx < x1 - 8; xx += 4) px(g, '#2a3036', xx, y - 7, 2, 2);
    px(g, '#1a1a1a', x0 - 1, y - 8, 3, 7);
    px(g, '#9a9c9a', x1 - 6, y - 17, 6, 9);
    px(g, '#c04030', x1 - 5, y - 16, 4, 2);
    g.fillStyle = '#8a8c8a';
    g.beginPath();
    g.moveTo(x0 + 18, y - 3);
    g.lineTo(x0 + 34, y + 6);
    g.lineTo(x0 + 26, y + 6);
    g.lineTo(x0 + 14, y - 2);
    g.fill();
    rubble(g, x0 + 30, y + 3, 10, 3, 0x9a9c9a, seeded(5));
  });
  push(17.2, (g) => {
    g.strokeStyle = '#e6dcc0';
    g.lineWidth = 1.5;
    for (let k = 0; k < 8; k++) {
      const x = fx(23.8 + k * 0.32), y = groundY(23.8 + k * 0.32, 17.2), rr = 8 - Math.abs(k - 3.5) * 1.1;
      g.beginPath();
      g.arc(x + 0.5, y, rr, Math.PI, Math.PI * 1.95);
      g.stroke();
    }
    g.lineWidth = 1;
    px(g, '#e6dcc0', fx(23.8) - 1, groundY(23.8, 17.2) - 2, fx(26.4) - fx(23.8), 2);
    const sx = fx(23.3), sy = groundY(23.3, 17.2);
    px(g, '#e6dcc0', sx - 6, sy - 6, 7, 5);
    px(g, '#1a1410', sx - 4, sy - 5, 2, 2);
    px(g, '#e6dcc0', sx - 9, sy - 2, 4, 1);
  });
  push(15.6, (g) => {
    // wieża wiertnicza (kratownica)
    const cx = fx(30.2), y = groundY(30.2, 15.6), h = 30;
    g.strokeStyle = '#4a3a30';
    g.beginPath();
    g.moveTo(cx - 7, y);
    g.lineTo(cx, y - h);
    g.lineTo(cx + 7, y);
    for (let k = 1; k < 5; k++) {
      const yy = y - (h * k) / 5, w = 7 * (1 - k / 5);
      g.moveTo(cx - w, yy);
      g.lineTo(cx + w, yy);
    }
    g.stroke();
    px(g, '#3a2e26', cx - 2, y - 4, 5, 4);
  });
  for (let k = 0; k < 7; k++) {
    const x = 17 + r() * 14, z = 3 + r() * 16;
    if (!freeAt(x, z, 1.2) || Math.hypot(x - 22, z - 9.5) < 2.6) continue;
    const vert = r() < 0.4, col = [0x8a5a3a, 0x6a6a5a, 0x7a4a3a][k % 3];
    push(z, (g) => {
      car(g, x, z, vert, col, true);
      px(g, rgbCss(SAND), fx(x) - 4, groundY(x, z) - 1, 6, 2);
    });
  }

  // ================= Przystań: mur ze złomu, chaty z blachy, wieża ciśnień, wiatrak, lokomotywa, wieże strażnicze
  for (let k = 0; k < 28; k++) {
    if (k === 0) continue;
    const a = (k / 28) * Math.PI * 2, x = HX + Math.cos(a) * 2.6, z = HZ + Math.sin(a) * 1.9;
    const col = [0x6a5a46, 0x7a4a34, 0x5a6066, 0x6a6a5a][(k * 7) % 4];
    push(z + 0.1, (g) => {
      const b = boxAt(g, x, z, 0.6, 0.18, 0.62, col, 0, false);
      for (let xx = b.x0; xx < b.x1; xx += 2) px(g, css(col, 0.7), xx, b.yFront, 1, b.yBase - b.yFront);
      px(g, '#3a2e24', b.x0, b.yFront - 2, 1, b.yBase - b.yFront + 2);
    });
  }
  const shacks: [number, number, number][] = [[-1.5, -0.7, 0x7a6a52], [-0.6, -0.9, 0x5a4a3a], [1.5, 0.4, 0x8a6a4a], [-1.9, 0.2, 0x6a5a4a], [0.6, 0.85, 0x7a5a42], [1.3, -0.75, 0x5a5a52]];
  for (const [dx, dz, col] of shacks) {
    const x = HX + dx, z = HZ + dz;
    push(z + 0.28, (g) => {
      const b = boxAt(g, x, z, 0.7, 0.5, 0.48, col);
      px(g, '#1a1410', b.x0 + 2, b.yFront + 2, 2, b.yBase - b.yFront - 2);
      px(g, '#ffb050', b.x1 - 4, b.yFront + 2, 2, 2);
      // blacha falista na dachu
      for (let xx = b.x0 - 1; xx <= b.x1; xx++) px(g, xx % 2 ? '#7a5a3a' : '#9a7048', xx, b.yTop - 1, 1, b.yFront - b.yTop + 1);
      px(g, '#5a3a24', b.x0 + 3, b.yTop - 1, 3, 2);
      smokePlume(g, b.x1 - 3, b.yTop - 4, 4);
    });
  }
  push(HZ + 0.3, (g) => {
    // lokomotywa i wagon
    const b = boxAt(g, HX + 0.3, HZ + 0.05, 1.6, 0.45, 0.5, 0x3a4a3a);
    boxAt(g, HX + 0.9, HZ + 0.05, 0.5, 0.45, 0.4, 0x2a3a2a, 0.5);
    px(g, '#c04030', b.x0, b.yFront + 1, b.x1 - b.x0 - 4, 1);
    for (let xx = b.x0 + 2; xx < b.x1 - 2; xx += 5) px(g, '#141414', xx, b.yBase - 1, 3, 2);
    px(g, '#2a2a2a', b.x0 + 4, b.yTop - 6, 3, 6);
  });
  push(HZ - 0.9 + 0.2, (g) => {
    // wieża ciśnień
    const cx = fx(HX - 0.4), y = groundY(HX - 0.4, HZ - 0.9);
    px(g, '#4a3a2e', cx - 4, y - 16, 1, 16);
    px(g, '#4a3a2e', cx + 4, y - 16, 1, 16);
    for (let yy = y - 14; yy < y; yy += 5) px(g, '#4a3a2e', cx - 4, yy, 9, 1);
    px(g, '#6a5240', cx - 6, y - 26, 13, 10);
    px(g, '#86684e', cx - 6, y - 27, 13, 1);
    px(g, '#4a3a2e', cx + 5, y - 26, 2, 10);
    g.fillStyle = '#5a4434';
    g.beginPath();
    g.moveTo(cx - 7, y - 27);
    g.lineTo(cx, y - 31);
    g.lineTo(cx + 7, y - 27);
    g.fill();
  });
  push(HZ - 1.3, (g) => {
    // wiatrak
    const cx = fx(HX + 2.0), y = groundY(HX + 2.0, HZ - 1.3);
    px(g, '#5a5a5e', cx, y - 22, 1, 22);
    g.strokeStyle = '#c8c0b0';
    g.beginPath();
    for (let k = 0; k < 3; k++) {
      const a = k * 2.09 + 0.4;
      g.moveTo(cx + 0.5, y - 22);
      g.lineTo(cx + 0.5 + Math.cos(a) * 9, y - 22 + Math.sin(a) * 9);
    }
    g.stroke();
    px(g, '#8a8a8e', cx - 1, y - 23, 3, 2);
  });
  for (const [dx, dz] of [[-2.4, -1.2], [2.3, 1.1], [2.5, -0.6]])
    push(HZ + dz + 0.15, (g) => {
      const b = boxAt(g, HX + dx, HZ + dz, 0.34, 0.3, 1.6, 0x5a4a3a);
      px(g, '#3a2e24', b.x0 - 2, b.yTop - 1, b.x1 - b.x0 + 4, 2);
      px(g, '#7a5a3a', b.x0 - 2, b.yTop - 5, b.x1 - b.x0 + 4, 1);
      px(g, '#3a2e24', b.x0 - 2, b.yTop - 4, 1, 3);
      px(g, '#3a2e24', b.x1 + 1, b.yTop - 4, 1, 3);
    });

  // ================= dzicz: linia energetyczna z przewróconymi słupami, opuszczone farmy
  const pylons: [number, number, boolean][] = [];
  for (let k = 0; k < 9; k++) {
    const t = k / 8, x = -14 + t * 19, z = 4.2 - t * 13 + Math.sin(t * 6) * 0.8;
    if (inCity({ x: W(x), z: W(z) }) || !freeAt(x, z, 1)) continue;
    pylons.push([x, z, hash(k, 9) < 0.3]);
  }
  pylons.forEach(([x, z, fallen], i) => {
    push(z, (g) => {
      const cx = fx(x), y = groundY(x, z);
      if (fallen) {
        g.strokeStyle = '#5a5a5e';
        g.beginPath();
        g.moveTo(cx, y);
        g.lineTo(cx + 20, y - 3);
        g.moveTo(cx + 4, y + 1);
        g.lineTo(cx + 20, y - 1);
        g.stroke();
        return;
      }
      g.strokeStyle = '#5a5a5e';
      g.beginPath();
      g.moveTo(cx - 4, y);
      g.lineTo(cx, y - 24);
      g.lineTo(cx + 4, y);
      g.moveTo(cx - 3, y - 6);
      g.lineTo(cx + 3, y - 12);
      g.moveTo(cx + 3, y - 6);
      g.lineTo(cx - 3, y - 12);
      g.stroke();
      px(g, '#5a5a5e', cx - 6, y - 20, 13, 1);
      px(g, '#5a5a5e', cx - 4, y - 16, 9, 1);
      const nx = pylons[i + 1];
      if (nx && !nx[2]) {
        const ex = fx(nx[0]), ey = groundY(nx[0], nx[1]);
        g.strokeStyle = 'rgba(40,36,34,0.6)';
        for (const o of [-6, 6]) {
          g.beginPath();
          g.moveTo(cx + o, y - 20);
          g.quadraticCurveTo((cx + ex) / 2 + o, (y + ey) / 2 - 12, ex + o, ey - 20);
          g.stroke();
        }
      }
    });
  });
  for (const [x, z, seed] of [[-6.5, 15.2, 1], [9.5, 16.6, 2], [-26, 11.5, 3], [-27.5, 2.5, 4]]) {
    if (!freeAt(x, z, 1)) continue;
    push(z + 0.3, (g) => house(g, x, z, 1.0, 0.6, 0x7a6a52, 0x6a3a2a, seed * 97, seed % 2 === 1));
    push(z - 0.6 + 0.4, (g) => {
      const b = boxAt(g, x + 1.3, z - 0.6, 0.9, 0.8, 0.7, 0x7a4a30);
      for (let xx = b.x0 - 1; xx <= b.x1; xx++) px(g, xx % 2 ? '#5a4a3a' : '#6a5a48', xx, b.yTop - 1, 1, b.yFront - b.yTop);
      px(g, '#1a1410', b.x0 + 3, b.yFront + 2, 4, b.yBase - b.yFront - 2);
    });
  }
}

function rails(g: Ctx2D, xa: number, xb: number, z: number): void {
  for (let x = xa; x < xb; x += 0.14) {
    const cx = fx(x), y = groundY(x, z);
    px(g, '#4a3a2e', cx, y - 3, 1, 5);
  }
  for (const dz of [-0.1, 0.1]) for (let x = xa; x < xb; x += 0.07) px(g, '#7a7470', fx(x), groundY(x, z + dz) - 1, 1, 1);
}

/** Autostrada Przystań -> brama (te same próbki co trasa do ruin): pobocza, asfalt z ubytkami, linie, bariery, słupy. */
function paintHighway(g: Ctx2D, items: Item[]): void {
  const rt = buildRoute(PLAZAS[0], 'ruins', 0), n = rt.trackFrom;
  const P = (i: number): [number, number] => [scrX(rt.x[i]), scrY(rt.x[i], rt.z[i])];
  const stroke = (col: string, wdt: number, skip: (i: number) => boolean): void => {
    g.strokeStyle = col;
    g.lineWidth = wdt;
    g.lineCap = 'round';
    for (let i = 0; i < n; i++) {
      if (skip(i)) continue;
      const [ax, ay] = P(i), [bx, by] = P(i + 1);
      g.beginPath();
      g.moveTo(ax, ay);
      g.lineTo(bx, by);
      g.stroke();
    }
    g.lineCap = 'butt';
  };
  stroke('rgba(120,104,84,0.8)', 15, () => false);
  stroke('#3c3836', 11, (i) => i % 40 === 18 || i % 40 === 31);
  g.lineWidth = 1;
  for (let i = 0; i < n; i++) {
    if (i % 40 === 18 || i % 40 === 31) continue;
    const [x, y] = P(i);
    if (i % 4 < 2) px(g, '#c8b068', x, y, 2, 1);
    px(g, '#8a8478', x, y - 4, 2, 1);
    px(g, '#8a8478', x, y + 4, 2, 1);
    if (hash(i, 77) < 0.25) px(g, '#2a2624', x - 2, y - 2 + Math.floor(hash(77, i) * 4), 4, 1);
  }
  for (let i = 6; i < n - 2; i += 16) {
    const x = rt.x[i] / WQ, z = rt.z[i] / WQ + 0.9, lean = i === 54;
    items.push({ key: z, draw: (gg) => {
      const cx = fx(x), y = groundY(x, z);
      if (lean) {
        px(gg, '#4a4a4e', cx, y - 2, 12, 1);
        px(gg, '#4a4a4e', cx + 11, y - 5, 1, 4);
      } else {
        px(gg, '#4a4a4e', cx, y - 20, 1, 20);
        px(gg, '#4a4a4e', cx - 5, y - 19, 11, 1);
        px(gg, '#8a8070', cx - 5, y - 18, 2, 1);
        px(gg, '#8a8070', cx + 4, y - 18, 2, 1);
      }
    } });
  }
  // wraki porzucone na poboczu i tablica
  for (let i = 12; i < n - 6; i += 23) {
    const x = rt.x[i] / WQ + 0.3, z = rt.z[i] / WQ + (i % 2 ? 0.55 : -0.5), col = [0x6a4a3a, 0x4a5a6a, 0x7a6a3a][i % 3];
    items.push({ key: z, draw: (gg) => car(gg, x, z, false, col, i % 3 === 0) });
  }
  {
    const i = Math.floor(n * 0.45), x = rt.x[i] / WQ, z = rt.z[i] / WQ - 0.8;
    items.push({ key: z, draw: (gg) => {
      const cx = fx(x), y = groundY(x, z);
      px(gg, '#3a3430', cx - 6, y - 16, 1, 16);
      px(gg, '#3a3430', cx + 7, y - 16, 1, 16);
      px(gg, '#2a6a3a', cx - 8, y - 24, 18, 9);
      px(gg, '#d8d0c0', cx - 6, y - 21, 6, 1);
      px(gg, '#d8d0c0', cx - 6, y - 19, 10, 1);
      px(gg, '#141110', cx + 4, y - 24, 4, 3);
    } });
  }
}

/** Roślinność i kamienie według stref (port reguł flory z worldterrain.js w skali mapy). */
function floraItems(items: Item[], r: () => number): void {
  for (let i = 0; i < 520; i++) {
    const x = -32 + r() * 64, z = -20 + r() * 42, t = r(), v = r();
    if (havenE(x, z) < 1.6 || inPad(x, z)) continue;
    const h = heightQ8(W(x), W(z)) / WQ, dc = Math.hypot(x - KRX, z - KRZ), dr = riverDistF(x, z);
    if (h > 4.2 || dc < 2.6 || !freeAt(x, z, 0.5)) continue;
    const e = ((x - CX) / CRX) ** 2 + ((z - CZ) / CRZ) ** 2;
    if (e < 1.15) continue;
    let kind: 'grass' | 'bush' | 'tree' | 'cactus' | 'shroom' | 'rock' | 'crystal' | 'bones';
    if (dc < 7) kind = v < 0.6 ? 'shroom' : 'grass';
    else if (h > 1.7) kind = v < 0.6 ? 'rock' : v < 0.68 ? 'crystal' : 'bush';
    else if (dr < 2.4) kind = v < 0.5 ? 'grass' : v < 0.85 ? 'bush' : 'tree';
    else if (x > 15) kind = v < 0.5 ? 'cactus' : v < 0.75 ? 'bush' : v < 0.9 ? 'rock' : 'bones';
    else kind = v < 0.35 ? 'grass' : v < 0.6 ? 'bush' : v < 0.82 ? 'tree' : v < 0.96 ? 'rock' : 'bones';
    items.push({ key: z, draw: (g) => {
      const cx = fx(x), y = groundY(x, z);
      switch (kind) {
        case 'grass':
          for (let k = 0; k < 6; k++) px(g, k % 3 ? '#a08a4a' : '#7a6a38', cx + k - 3, y - (k % 2 ? 4 : 3), 1, k % 2 ? 4 : 3);
          break;
        case 'bush':
          px(g, 'rgba(30,18,10,0.3)', cx - 2, y, 7, 1);
          px(g, '#4a4a2a', cx - 3, y - 3, 7, 3);
          px(g, t < 0.3 ? '#6a7a3a' : '#5a5232', cx - 2, y - 5, 5, 3);
          px(g, t < 0.3 ? '#8a9a4a' : '#7a6a42', cx - 1, y - 5, 2, 1);
          break;
        case 'tree':
          deadTree(g, x, z, t, i);
          break;
        case 'cactus':
          px(g, t < 0.5 ? '#5a7a3a' : '#7a8a4a', cx, y - 9, 3, 9);
          px(g, '#4a6a2a', cx + 2, y - 9, 1, 9);
          px(g, t < 0.5 ? '#5a7a3a' : '#7a8a4a', cx - 3, y - 7, 1, 3);
          px(g, t < 0.5 ? '#5a7a3a' : '#7a8a4a', cx - 2, y - 5, 2, 1);
          px(g, t < 0.5 ? '#5a7a3a' : '#7a8a4a', cx + 3, y - 4, 2, 1);
          px(g, t < 0.5 ? '#5a7a3a' : '#7a8a4a', cx + 5, y - 7, 1, 4);
          break;
        case 'shroom':
          px(g, '#6a5a3a', cx, y - 3, 1, 3);
          px(g, v < 0.3 ? '#c8ff60' : '#9adf50', cx - 2, y - 5, 5, 2);
          px(g, '#e8ffa0', cx - 1, y - 5, 1, 1);
          break;
        case 'rock':
          px(g, 'rgba(30,18,10,0.3)', cx - 2, y, 8, 1);
          px(g, '#6a5a4a', cx - 3, y - 3, 7, 3);
          px(g, '#8a7a6a', cx - 2, y - 5, 4, 2);
          px(g, '#a8988a', cx - 2, y - 5, 2, 1);
          break;
        case 'crystal':
          px(g, '#7ad0ff', cx, y - 7, 2, 7);
          px(g, '#c0f0ff', cx + 2, y - 4, 1, 4);
          px(g, '#5aa0d0', cx - 1, y - 3, 1, 3);
          break;
        case 'bones':
          px(g, '#e6dcc0', cx - 3, y - 1, 7, 1);
          px(g, '#e6dcc0', cx - 1, y - 3, 3, 2);
          px(g, '#1a1410', cx, y - 3, 1, 1);
          break;
      }
    } });
  }
}

/** Maluje całą mapę regionu do tekstury `key` (MAP_W x MAP_H). */
export function paintRegion(scene: Phaser.Scene, key: string, w = MAP_W, h = MAP_H): void {
  canvasTexture(scene, key, w, h, (g) => {
    paintTerrain(g, w, h);
    const items: Item[] = [];
    paintHighway(g, items);
    const r = seeded(3);
    cityItems(items, r);
    regionItems(items, r);
    floraItems(items, seeded(31));
    items.sort((a, b) => a.key - b.key);
    for (const it of items) it.draw(g);
    const grad = g.createRadialGradient(w / 2, h / 2, h * 0.42, w / 2, h / 2, h * 1.0);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(24,10,4,0.5)');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
  });
}

/** Miejsca animowanych ognisk (ruiny w mieście, obóz Nomadów, Przystań) - w pikselach mapy. */
export function regionFires(): { x: number; y: number; size: number }[] {
  const pts: [number, number][] = [[1, -1], [-2, 1], [3, 2], [-1, -3], [4, 0], [-4, -1], [2, 3]];
  const out = pts.map(([gx, gz]) => {
    const x = CX + (gx + 0.5) * G - 0.6, z = CZ + (gz + 0.5) * G + 0.05;
    return { x: fx(x), y: groundY(x, z), size: 0.4 };
  });
  out.push({ x: fx(22), y: groundY(22, 9.5), size: 0.55 }, { x: fx(HX - 0.4), y: groundY(HX - 0.4, HZ + 0.05), size: 0.45 });
  return out;
}

/** Czubek masztu przy bunkrze (czerwona latarnia). */
export const beaconPos = (): { x: number; y: number } => ({ x: fx(-10.6), y: groundY(-10.6, -9.0, 4) - 1 });
