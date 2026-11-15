// Mapa regionu w rzucie izometrycznym (jak mapa taktyczna), malowana z wysokościami
// (port krajobrazu Oldgame/src/scenes/meta/worldterrain.js bez three.js).
// Rzut: ekranX = (x - z) * A, ekranY = (x + z) * B - wysokość * LIFT  (A = 2B, romby 2:1). Północny zachód jest u góry.
// Teren rysowany "voxel space": dla każdej kolumny ekranu (stałe x - z) idziemy od najbliższego punktu (duże x + z)
// do najdalszego z buforem Y, więc góry, płaskowyże, wał krateru i wydmy zasłaniają to, co za nimi.
// Światło pada z lewej góry ekranu: ściany południowe (lewe) jaśniejsze, wschodnie (prawe) w cieniu, dachy najjaśniejsze.
// Bryły rysowane kolumnami pikseli (dach-romb + dwie ściany), sortowane po x + z, więc bliższe zasłaniają dalsze.
// Miasto to siatka kwartałów (romby) z jezdniami, chodnikami i przejściami; kamienice, biurowce i wieżowce z oknami
// na obu widocznych ścianach, w dużej części zrujnowane. Pozostałe strefy mają własne obiekty.

import Phaser from 'phaser';
import { CITY, CRATER, GATE, HOME, PLAZA_CELLS, PLAZAS, SECTORS, WQ, buildRoute, cityBlock, heightQ8, inCity, riverDistF } from '../../core/campaign/region';
import { canvasTexture, seeded, type Ctx2D } from '../ui/Kit';

// ------------------------------------------------------------------ rzut

/** Piksele ekranu na jednostkę świata: poziomo (A) i pionowo (B) w rzucie 2:1, oraz na jednostkę wysokości. */
const A = 12, B = 6, LIFT = 12;
/** Rozmiar mapy w pikselach projektowych (większa niż ekran - kamera ją przewija i przybliża). */
export const MAP_W = 1000, MAP_H = 700;
const OX = 488, OY = 380;
/** Wysokość piętra w pikselach. */
const FL = 4;

/** Punkt świata (Q8) -> ekran X. */
export const scrX = (xq: number, zq: number): number => OX + Math.round(((xq - zq) * A) / WQ);
/** Punkt świata (Q8) -> ekran Y z wysokością terenu + uniesienie `up` (Q8). */
export const scrY = (xq: number, zq: number, up = 0): number => OY + Math.round(((xq + zq) * B) / WQ) - Math.round(((heightQ8(xq, zq) + up) * LIFT) / WQ);

const W = (v: number): number => Math.round(v * WQ);
/** Wysokość terenu (jednostki). */
const th = (x: number, z: number): number => heightQ8(W(x), W(z)) / WQ;
/** Rzut punktu o wysokości bezwzględnej h (float). */
const pr = (x: number, z: number, h: number): [number, number] => [OX + (x - z) * A, OY + (x + z) * B - h * LIFT];
/** Punkt na terenie (+ uniesienie), zaokrąglony do piksela. */
const P = (x: number, z: number, up = 0): { x: number; y: number } => {
  const [sx, sy] = pr(x, z, th(x, z) + up);
  return { x: Math.round(sx), y: Math.round(sy) };
};


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
    let mud: RGB = [150, 122, 88];
    if (Math.abs(vnoise(x * 3.2, z * 3.2 + 30) - 0.5) < 0.03) mud = [104, 82, 60];
    col = mix(col, mud, (1 - smooth(0.4, 1.6, r)) * 0.7);
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

/** Teren: kolumna ekranu = stałe u = x - z; idziemy od bliska (duże v = x + z) w dal, bufor Y = co już zasłonięte. */
function paintTerrain(g: Ctx2D, w: number, h: number): void {
  const img = g.createImageData(w, h), d = img.data;
  const VN = (h - OY) / B + 4, VF = -OY / B - 12, STEP = 0.04;
  for (let px = 0; px < w; px++) {
    const u = (px + 0.5 - OX) / A;
    let ybuf = h;
    for (let v = VN; v >= VF && ybuf > 0; v -= STEP) {
      const x = (u + v) / 2, z = (v - u) / 2, xq = W(x), zq = W(z);
      let hq = heightQ8(xq, zq);
      const wet = Math.hypot(x - KRX, z - KRZ) < 2.4 && hq < W(LAKE);
      if (wet) hq = W(LAKE);
      const y = Math.round(OY + v * B - (hq * LIFT) / WQ);
      if (y >= ybuf) continue;
      const n = hash(xq >> 4, zq >> 4), hf = hq / WQ;
      let c: RGB;
      if (wet) {
        const dl = Math.hypot(x - KRX, z - KRZ);
        c = Math.abs(dl - 1.2 + n * 0.3) < 0.1 ? [180, 255, 110] : dl > 1.9 ? [70, 120, 40] : [96 + n * 24, 190 + n * 30, 52];
        if (vnoise(x * 4, z * 4) > 0.78) c = [150, 230, 90];
      } else {
        // światło z zachodu (lewa strona ekranu): stok wznoszący się ku wschodowi jaśniejszy;
        // łagodne pagórki nizin cieniowane słabiej
        const s = (heightQ8(xq + 96, zq) - heightQ8(xq - 96, zq)) / WQ;
        c = groundColor(x, z, hf, n, Math.abs(s));
        const lim = hf > 1.2 ? 0.2 : 0.05;
        let f = 1 + Math.max(-lim, Math.min(lim, s * (hf > 1.2 ? 0.9 : 0.6)));
        if (hf > 1.2) f *= 1 - Math.min(0.18, (hf - 1.2) * 0.05);
        if (ybuf - y > 10 && ybuf < h) f *= 0.88; // urwisko widziane z przodu
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

// ------------------------------------------------------------------ prymitywy izometryczne

interface Item {
  key: number;
  draw: (g: Ctx2D) => void;
}

const px = (g: Ctx2D, c: string, x: number, y: number, w = 1, h = 1): void => {
  g.fillStyle = c;
  g.fillRect(x, y, w, h);
};

/** Odcinek 1 px między dwoma punktami ekranu. */
function seg(g: Ctx2D, a: readonly [number, number], b: readonly [number, number], col: string): void {
  const n = Math.max(1, Math.round(Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]))));
  g.fillStyle = col;
  for (let i = 0; i <= n; i++) g.fillRect(Math.round(a[0] + ((b[0] - a[0]) * i) / n), Math.round(a[1] + ((b[1] - a[1]) * i) / n), 1, 1);
}

/** Romb podstawy prostopadłościanu w kolumnach ekranu: górna (tylna) i dolna (przednia) krawędź na wysokości h. */
interface Cols {
  x0: number;
  n: number;
  top: Int16Array;
  bot: Int16Array;
  /** Kolumna narożnika południowo-wschodniego (granica ściany południowej i wschodniej). */
  sx: number;
  S: [number, number];
  E: [number, number];
}

function diamond(X0: number, X1: number, Z0: number, Z1: number, h: number): Cols {
  const Wp = pr(X0, Z1, h), S = pr(X1, Z1, h), E = pr(X1, Z0, h), N = pr(X0, Z0, h);
  const x0 = Math.round(Wp[0]), n = Math.max(1, Math.round(E[0]) - x0);
  const top = new Int16Array(n), bot = new Int16Array(n);
  const lerp = (a: [number, number], b: [number, number], x: number): number => a[1] + (b[1] - a[1]) * Math.min(1, Math.max(0, (x - a[0]) / (b[0] - a[0] || 1)));
  for (let i = 0; i < n; i++) {
    const xc = x0 + i + 0.5;
    top[i] = Math.round(xc < N[0] ? lerp(Wp, N, xc) : lerp(N, E, xc));
    bot[i] = Math.round(xc < S[0] ? lerp(Wp, S, xc) : lerp(S, E, xc));
  }
  return { x0, n, top, bot, sx: Math.min(n, Math.max(0, Math.round(S[0]) - x0)), S, E };
}

/** Cień rzucany w prawo (światło z lewej): równoległobok przy ścianie wschodniej. */
function shadow(g: Ctx2D, c: Cols, H: number): void {
  const L = Math.min(22, Math.max(2, Math.round(H * 0.55)));
  g.fillStyle = 'rgba(30,18,10,0.3)';
  g.beginPath();
  g.moveTo(c.S[0], c.S[1]);
  g.lineTo(c.E[0], c.E[1]);
  g.lineTo(c.E[0] + L, c.E[1] - L * 0.25);
  g.lineTo(c.S[0] + L, c.S[1] - L * 0.25);
  g.fill();
}

interface BoxInfo {
  c: Cols;
  H: number;
  h0: number;
}

/** Dekoracja kolumny: X ekranu, dół ściany (y podstawy), góra dachu, czy ściana południowa, pozycja na ścianie i jej długość. */
type Deco = (X: number, bot: number, top: number, south: boolean, t: number, len: number) => void;

/** Prostopadłościan na terenie: dach (romb), ściana południowa (jasna), wschodnia (ciemna). */
function isoBox(g: Ctx2D, x: number, z: number, w: number, d: number, hh: number, col: number, elev = 0, shade = true, deco?: Deco): BoxInfo {
  const h0 = th(x, z) + elev, H = Math.max(1, Math.round(hh * LIFT));
  const c = diamond(x - w / 2, x + w / 2, z - d / 2, z + d / 2, h0);
  if (shade && elev === 0) shadow(g, c, H);
  const roof = css(col, 1.16), edge = css(col, 1.36), sF = css(col, 0.94), eF = css(col, 0.66);
  for (let i = 0; i < c.n; i++) {
    const X = c.x0 + i, bt = c.bot[i], tp = c.top[i], south = i < c.sx;
    px(g, roof, X, tp - H, 1, bt - tp + 1);
    px(g, south ? sF : eF, X, bt - H + 1, 1, H);
    px(g, edge, X, bt - H, 1, 1);
    if (deco) deco(X, bt, tp - H, south, south ? i : i - c.sx, south ? c.sx : c.n - c.sx);
  }
  if (c.sx > 0 && c.sx < c.n) px(g, css(col, 0.8), c.x0 + c.sx, c.bot[c.sx] - H + 1, 1, H);
  return { c, H, h0 };
}

/** Kupka gruzu (piksele w kolorze muru) wokół punktu ekranu. */
function rubble(g: Ctx2D, cx: number, y: number, wpx: number, hpx: number, col: number, r: () => number): void {
  for (let i = 0; i < wpx * hpx * 0.9; i++) {
    const t = r() * 2 - 1, xx = Math.round(cx + t * wpx * 0.5);
    const yy = Math.round(y - r() * hpx * (1 - t * t));
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
  /** 0 = cały, 1 = zawalony szczyt z jednej strony, 2 = wyrwa w ścianie, 3 = stalowy szkielet u góry. */
  ruin: number;
  glass: boolean;
  seed: number;
  /** Dach szedowy (hale). */
  saw?: boolean;
}

const WALLS = [0x8a5a48, 0x7a6a5e, 0x6e6a64, 0x8a7a64, 0x6a6058, 0x9a6a4a, 0x5e646a, 0xa07a52, 0x7a4a3a, 0x8a8470, 0x6a7a74];
const ROOFS = [0x5a544e, 0x6a6258, 0x4e4a46, 0x625a50];

/** Budynek z piętrami: dach z nadbudówkami, okna na obu ścianach (parter: witryny), ruiny. */
function building(g: Ctx2D, b: Bld): void {
  const r = seeded(b.seed);
  const h0 = th(b.x, b.z);
  const c = diamond(b.x - b.w / 2, b.x + b.w / 2, b.z - b.d / 2, b.z + b.d / 2, h0);
  const n = c.n, H = b.floors * FL + 1, wall = b.col;
  // profil zawalenia od jednej strony: o ile pikseli niżej kończy się kolumna
  const drop = new Int16Array(n);
  if (b.ruin === 1) {
    const span = Math.round(n * (0.35 + r() * 0.45)), left = r() < 0.5;
    let dd = Math.round(H * (0.25 + r() * 0.4));
    for (let i = 0; i < span; i++) {
      const k = left ? i : n - 1 - i;
      if (i % 2 === 0) dd = Math.max(2, Math.min(H - 3, dd + Math.round((r() - 0.62) * 6)));
      drop[k] = Math.min(H - 3, dd + Math.round((span - i) * 0.5));
    }
  }
  shadow(g, c, b.ruin === 1 ? Math.round(H * 0.7) : H);
  const step = b.glass ? 2 : 3, winW = b.glass ? 1 : 2;
  const sF = css(wall, 0.92), eF = css(wall, 0.64), sD = css(wall, 0.78), eD = css(wall, 0.54);
  const roofC = css(b.roof, 1.12), roofE = css(b.roof, 1.36), roofB = css(b.roof, 0.8);
  for (let i = 0; i < n; i++) {
    const X = c.x0 + i, bt = c.bot[i], tp = c.top[i], dz = drop[i], south = i < c.sx;
    const faceTop = bt - H + dz;
    // dach albo gruz na niższej wysokości
    if (dz === 0) {
      px(g, roofC, X, tp - H, 1, bt - tp);
      px(g, roofB, X, tp - H, 1, 1);
      px(g, roofE, X, bt - H, 1, 1);
    } else {
      for (let k = 0; k <= bt - tp; k++) px(g, hash(X, k + dz) < 0.3 ? '#2a2420' : css(wall, 0.55 + hash(X * 3, k) * 0.5), X, tp - H + dz + k, 1, 1);
      px(g, css(wall, 1.25), X, faceTop, 1, 1);
      if (hash(X, b.seed) < 0.12) px(g, '#7a4a30', X, tp - H + dz - 2 - Math.floor(hash(b.seed, X) * 3), 1, 3);
    }
    // ściana
    px(g, south ? sF : eF, X, faceTop + 1, 1, bt - faceTop);
    px(g, south ? sD : eD, X, bt - 5, 1, 6);
    // gzymsy co 4 piętra
    for (let f = 4; f < b.floors; f += 4) if (bt - f * FL > faceTop + 1) px(g, css(wall, south ? 1.02 : 0.74), X, bt - f * FL, 1, 1);
    // okna
    const t = south ? i : i - c.sx, len = south ? c.sx : n - c.sx;
    if (t < 1 || t >= len - 1) continue;
    for (let f = 0; f < b.floors; f++) {
      const y = bt - (f + 1) * FL + 1;
      if (y <= faceTop + 1) continue;
      if (f === 0 && !b.glass && !b.saw) {
        const k = Math.floor((t - 1) / 5);
        if ((t - 1) % 5 < 3 && hash(b.seed + (south ? 0 : 7), k) > 0.25) px(g, hash(k, b.seed) < 0.85 ? '#1c1814' : '#5a4430', X, y, 1, FL - 1);
        continue;
      }
      if (b.saw) {
        if (f === 1 && (t - 1) % 4 < 2) px(g, hash(t >> 2, b.seed) < 0.3 ? '#2a3038' : '#1a1a1c', X, y - FL + 2, 1, FL * 2 - 2);
        continue;
      }
      if ((t - 1) % step >= winW) continue;
      const v = hash(b.seed + (south ? 0 : 999), f * 131 + Math.floor((t - 1) / step));
      let col: string;
      if (b.glass) col = south ? (v < 0.55 ? '#46586a' : v < 0.8 ? '#2c3a46' : v < 0.96 ? '#141618' : '#7a90a0') : v < 0.6 ? '#2a3440' : v < 0.96 ? '#121416' : '#5a7080';
      else col = v < 0.72 ? '#1a1714' : v < 0.86 ? '#2c2622' : v < 0.97 ? '#5a4632' : '#ffb050';
      px(g, col, X, y, 1, FL - 2);
      if (!b.glass && v > 0.9 && v < 0.97) px(g, 'rgba(20,14,10,0.45)', X, y - 2, 1, 2);
    }
  }
  // narożnik i lewa krawędź w świetle
  if (c.sx > 0 && c.sx < n) px(g, css(wall, 1.06), c.x0 + c.sx, c.bot[c.sx] - H + drop[c.sx] + 1, 1, H - drop[c.sx]);
  px(g, css(wall, 1.05), c.x0, c.bot[0] - H + drop[0] + 1, 1, H - drop[0]);
  const intact = drop.every((v) => v === 0);
  const roofH = H / LIFT;
  // dach szedowy: pasy świetlików wzdłuż osi x
  if (b.saw) {
    for (let zz = b.z - b.d / 2 + 0.15; zz < b.z + b.d / 2 - 0.05; zz += 0.28) {
      seg(g, pr(b.x - b.w / 2 + 0.04, zz, h0 + roofH), pr(b.x + b.w / 2 - 0.04, zz, h0 + roofH), css(b.roof, 1.5));
      seg(g, pr(b.x - b.w / 2 + 0.04, zz + 0.09, h0 + roofH), pr(b.x + b.w / 2 - 0.04, zz + 0.09, h0 + roofH), '#3a4048');
    }
    if (r() < 0.6) isoHole(g, b.x - b.w * 0.2, b.z, h0 + roofH, 0.35, 0.25);
  } else if (intact && n > 8) {
    // nadbudówki
    const k = r(), ox = (r() - 0.5) * b.w * 0.4, oz = (r() - 0.5) * b.d * 0.4;
    if (b.floors >= 6 && k < 0.45) {
      // zbiornik na wodę na nóżkach
      const p = pr(b.x + ox, b.z + oz, h0 + roofH), X = Math.round(p[0]), Y = Math.round(p[1]);
      px(g, '#3a2e26', X - 2, Y - 3, 1, 3);
      px(g, '#3a2e26', X + 2, Y - 3, 1, 3);
      px(g, '#6a5240', X - 3, Y - 9, 7, 6);
      px(g, '#4a3a2e', X + 1, Y - 9, 3, 6);
      px(g, '#86684e', X - 3, Y - 10, 7, 1);
    } else if (k < 0.8) isoBox(g, b.x + ox, b.z + oz, Math.min(0.5, b.w * 0.3), Math.min(0.4, b.d * 0.3), 0.25, b.roof, roofH, false);
    if (b.floors >= 8 && r() < 0.5) {
      const p = pr(b.x - ox, b.z - oz, h0 + roofH), X = Math.round(p[0]), Y = Math.round(p[1]);
      px(g, '#5a5a5e', X, Y - 9, 1, 9);
      px(g, '#5a5a5e', X - 1, Y - 6, 3, 1);
    }
    if (r() < 0.3) isoHole(g, b.x - ox * 0.5, b.z + oz, h0 + roofH, 0.25, 0.2);
  }
  // wyrwa po pocisku w ścianie południowej
  if (b.ruin === 2 && b.floors >= 3 && c.sx > 8) {
    const hw = Math.max(3, Math.round(c.sx * (0.25 + r() * 0.25))), hh = Math.min(H - 6, FL * (2 + Math.floor(r() * 3)));
    const a = 2 + Math.floor(r() * Math.max(1, c.sx - hw - 3)), up = 3 + Math.floor(r() * Math.max(1, H - hh - 6));
    for (let i = a; i < a + hw; i++) {
      const bt = c.bot[i], j0 = Math.round(hash(i, b.seed) * 2), j1 = Math.round(hash(b.seed, i) * 2);
      const y0 = bt - up - hh + j0;
      px(g, '#141110', c.x0 + i, y0, 1, hh - j0 - j1);
      px(g, css(wall, 1.15), c.x0 + i, y0 - 1, 1, 1);
      for (let y = bt - up - FL; y > y0; y -= FL) px(g, css(wall, 0.8), c.x0 + i, y, 1, 1);
    }
    const m = c.x0 + a + hw / 2;
    rubble(g, m, c.bot[Math.min(n - 1, a + (hw >> 1))] + 2, hw + 6, 4, wall, r);
  }
  // stalowy szkielet ponad częścią wysokości
  if (b.ruin === 3) {
    const cut = Math.round(H * (0.35 + r() * 0.25));
    for (let i = 0; i < n; i++) {
      const X = c.x0 + i, bt = c.bot[i], tp = c.top[i];
      px(g, '#0f0e0e', X, tp - H, 1, bt - tp + H - cut);
      const frameCol = (i - (i < c.sx ? 0 : c.sx)) % 4 === 0 || i === c.sx || i === 0 || i === n - 1;
      if (frameCol) px(g, '#4a4440', X, bt - H, 1, H - cut);
      for (let y = bt - cut; y > bt - H; y -= FL) px(g, '#5a5450', X, y, 1, 1);
      px(g, '#5a5450', X, tp - H, 1, 1);
      px(g, '#5a5450', X, bt - H, 1, 1);
    }
    const p = pr(b.x - b.w / 2, b.z, h0 + roofH), X = Math.round(p[0]), Y = Math.round(p[1]);
    g.fillStyle = '#6a6460';
    g.beginPath();
    g.moveTo(X + 2, Y);
    g.lineTo(X + 8, Y - 4);
    g.lineTo(X + 10, Y - 3);
    g.lineTo(X + 4, Y + 1);
    g.fill();
    px(g, '#7a4a30', c.x0 + n - 3, c.top[n - 3] - H - 4, 1, 4);
  }
  if (b.ruin === 1) {
    const left = drop[0] > drop[n - 1], i = left ? Math.floor(n * 0.2) : Math.floor(n * 0.8);
    rubble(g, c.x0 + i, c.bot[i] + 2, n * 0.5 + 4, 5, wall, r);
  }
}

/** Ciemna dziura w płaskim dachu (romb). */
function isoHole(g: Ctx2D, x: number, z: number, h: number, w: number, d: number): void {
  const c = diamond(x - w / 2, x + w / 2, z - d / 2, z + d / 2, h);
  for (let i = 0; i < c.n; i++) px(g, '#1a1612', c.x0 + i, c.top[i], 1, c.bot[i] - c.top[i] + 1);
}

/** Dom podmiejski z dwuspadowym dachem (kalenica wzdłuż x). */
function house(g: Ctx2D, x: number, z: number, w: number, d: number, col: number, roofCol: number, seed: number, ruined: boolean): void {
  const info = isoBox(g, x, z, w, d, 0.42, col, 0, true, (X, bt, _tp, south, t, len) => {
    if (t > 1 && t < len - 2 && t % 4 < 2) px(g, hash(X, seed) < 0.8 ? '#1a1714' : '#5a4632', X, bt - 4, 1, 2);
    void south;
  });
  const { c, H } = info, rh = 4;
  for (let i = 0; i < c.n; i++) {
    const X = c.x0 + i, tp = c.top[i] - H, bt = c.bot[i] - H, mid = Math.round((tp + bt) / 2) - rh;
    const broken = ruined && hash(i, seed) < 0.4 && i > c.n * 0.3 && i < c.n * 0.75;
    if (broken) {
      px(g, '#1a1410', X, mid + 1, 1, bt - mid);
      continue;
    }
    px(g, css(roofCol, 1.08), X, tp - rh, 1, mid - tp + rh);
    px(g, css(roofCol, 0.76), X, mid, 1, bt - mid + 1);
    px(g, css(roofCol, 1.32), X, mid, 1, 1);
    if (i % 2 === 0) px(g, css(roofCol, 0.6), X, mid + 2, 1, 1);
  }
  if (!ruined && hash(seed, 1) < 0.5) px(g, '#4a3a30', c.x0 + 3, c.top[3] - H - rh - 4, 2, 4);
}

/** Wrak auta: wzdłuż osi x albo z (vert). */
function car(g: Ctx2D, x: number, z: number, vert: boolean, col: number, burnt: boolean, bus = false): void {
  const len = bus ? 1.0 : 0.5, wid = bus ? 0.32 : 0.26;
  const cc = burnt ? 0x3a3230 : col;
  const info = isoBox(g, x, z, vert ? wid : len, vert ? len : wid, bus ? 0.3 : 0.18, cc, 0, false, (X, bt, _tp, _s, t, l) => {
    if (t === 1 || t === l - 2) px(g, '#141414', X, bt - 1, 1, 2);
    if (bus && t % 2 === 1 && t < l - 1) px(g, '#1a1a1c', X, bt - 3, 1, 1);
  });
  const p = pr(x, z, info.h0 + info.H / LIFT);
  px(g, burnt ? '#1a1414' : '#2a3036', Math.round(p[0]) - 1, Math.round(p[1]) - 1, 3, 1);
  if (burnt) px(g, '#5a2a1a', Math.round(p[0]), Math.round(p[1]), 1, 1);
}

/** Uliczna latarnia (czasem przewrócona / zgięta). */
function lamp(g: Ctx2D, x: number, z: number, state: number): void {
  const { x: cx, y } = P(x, z);
  if (state < 0.2) {
    seg(g, [cx, y], [cx + 8, y + 4], '#3a3a3e');
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
  const { x: cx, y } = P(x, z), h = Math.round(8 + s * 8);
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
  const { x: cx, y } = P(x, z), h = Math.round(9 + s * 7);
  px(g, '#2e241c', cx, y - h, 1, h);
  for (let k = 2; k < h - 2; k += 2) {
    const w = Math.round((k / h) * 5 + 1);
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

function crater(g: Ctx2D, x: number, z: number, s: number): void {
  const { x: cx, y: cy } = P(x, z), rx = Math.round(7 * s + 3), rz = Math.round(rx * 0.5);
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
  g.ellipse(cx + 1, cy + 1, rx - 2, Math.max(1, rz - 1), 0, 0, Math.PI * 2);
  g.fill();
}

function tankTrap(g: Ctx2D, x: number, z: number): void {
  const { x: cx, y } = P(x, z);
  for (let i = 0; i < 5; i++) {
    px(g, '#4a4440', cx - 2 + i, y - 1 - i, 1, 1);
    px(g, '#5e5852', cx + 2 - i, y - 1 - i, 1, 1);
  }
  px(g, '#3a3430', cx - 2, y - 1, 5, 1);
}

/** Wał z worków z piaskiem wzdłuż osi x (alongX) albo z. */
function sandbags(g: Ctx2D, x: number, z: number, len: number, alongX = true): void {
  for (let row = 0; row < 2; row++)
    for (let t = -len / 2 + row * 0.12; t < len / 2; t += 0.26) {
      const { x: X, y: Y } = P(alongX ? x + t : x, alongX ? z : z + t);
      px(g, '#8a7a5a', X - 2, Y - 3 - row * 2, 4, 2);
      px(g, '#a8966e', X - 2, Y - 3 - row * 2, 3, 1);
    }
}

/** Tor kolejowy wzdłuż osi x. */
function rails(g: Ctx2D, xa: number, xb: number, z: number): void {
  for (let x = xa; x < xb; x += 0.16) {
    const h = th(x, z);
    seg(g, pr(x, z - 0.16, h), pr(x, z + 0.16, h), '#4a3a2e');
  }
  for (const dz of [-0.1, 0.1]) for (let x = xa; x < xb; x += 0.5) seg(g, pr(x, z + dz, th(x, z) + 0.02), pr(x + 0.5, z + dz, th(x + 0.5, z) + 0.02), '#7a7470');
}

// ------------------------------------------------------------------ miasto: obiekty

function cityItems(items: Item[], r: () => number): void {
  const push = (key: number, draw: (g: Ctx2D) => void): void => void items.push({ key, draw });
  for (let bj = -BJ; bj <= BJ; bj++)
    for (let bi = -BI; bi <= BI; bi++) {
      if (!on(bi, bj)) continue;
      const cx = CX + bi * G, cz = CZ + bj * G;
      const L = cx - G / 2 + halfW(bi - 1) + SIDE + 0.04, R = cx + G / 2 - halfW(bi) - SIDE - 0.04;
      const T = cz - G / 2 + halfW(bj - 1) + SIDE + 0.04, Bt = cz + G / 2 - halfW(bj) - SIDE - 0.04;
      const core = Math.exp(-(((bi - 0.4) ** 2) / 7 + ((bj + 0.4) ** 2) / 4));
      const e = ((cx - CX) / CRX) ** 2 + ((cz - CZ) / CRZ) ** 2;
      if (isPlaza(bi, bj)) {
        plaza(items, cx, cz, L, R, T, Bt, r);
        continue;
      }
      const wB = R - L, dB = Bt - T;
      if (core > 0.55 && r() < 0.8) {
        // śródmieście: wieżowiec (czasem dwa) + niska przybudówka
        const two = r() < 0.4;
        for (let k = 0; k < (two ? 2 : 1); k++) {
          const bw = two ? wB * (0.4 + r() * 0.08) : wB * (0.55 + r() * 0.3), bd = dB * (0.5 + r() * 0.3);
          const bx = two ? (k ? R - bw / 2 : L + bw / 2) : L + bw / 2 + r() * (wB - bw), bz = Bt - bd / 2 - (two && k ? 0.25 : 0);
          const rv = r();
          const b: Bld = { x: bx, z: bz, w: bw, d: bd, floors: Math.round(9 + core * 7 + r() * 5), col: [0x5e646a, 0x6a6862, 0x55524e, 0x7a7468][Math.floor(r() * 4)], roof: ROOFS[Math.floor(r() * 4)], ruin: rv < 0.3 ? 3 : rv < 0.55 ? 1 : rv < 0.75 ? 2 : 0, glass: r() < 0.55, seed: Math.floor(r() * 1e9) };
          push(bx + bz, (g) => building(g, b));
        }
        const ad = dB * 0.3, ab: Bld = { x: L + wB / 2, z: T + ad / 2, w: wB * 0.9, d: ad, floors: 2 + Math.floor(r() * 3), col: WALLS[Math.floor(r() * WALLS.length)], roof: ROOFS[0], ruin: r() < 0.4 ? 1 : 0, glass: false, seed: Math.floor(r() * 1e9) };
        push(ab.x + ab.z, (g) => building(g, ab));
        continue;
      }
      const suburb = e > 0.62;
      // dwa rzędy zabudowy (pierzeje od północy i od południa), parcele dzielone na 1..3
      for (const row of [0, 1]) {
        const rd = dB * (row ? 0.46 : 0.42), rz = row ? Bt - rd / 2 : T + rd / 2;
        const parts = 1 + Math.floor(r() * 3);
        let x = L;
        for (let p = 0; p < parts; p++) {
          const pw = p === parts - 1 ? R - x : (wB / parts) * (0.8 + r() * 0.4);
          const lx = x + pw / 2;
          x += pw;
          const v = r();
          if (v < (suburb ? 0.3 : 0.14)) {
            const seed = Math.floor(r() * 1e9), t = r();
            push(lx + rz, (g) => {
              const rr = seeded(seed), q = P(lx, rz);
              if (t < 0.5) rubble(g, q.x, q.y, pw * A * 0.9, 4 + rr() * 4, WALLS[seed % WALLS.length], rr);
              else if (t < 0.9) car(g, lx, rz, false, 0x7a5a3a, true);
              else deadTree(g, lx, rz, rr(), seed);
            });
            continue;
          }
          const col = WALLS[Math.floor(r() * WALLS.length)], seed = Math.floor(r() * 1e9);
          if (suburb && r() < 0.6) {
            const ruined = r() < 0.45, rc = [0x8a4a34, 0x6a5a4a, 0x5a4a44][Math.floor(r() * 3)];
            const hw = Math.min(pw - 0.12, 0.9), hd = rd * 0.85;
            push(lx + rz, (g) => house(g, lx, rz, hw, hd, col, rc, seed, ruined));
            continue;
          }
          const rv = r();
          if (rv < 0.12) {
            // zawalony budynek: kupa gruzu z kikutami ścian
            push(lx + rz, (g) => {
              const rr = seeded(seed), q = P(lx, rz);
              rubble(g, q.x, q.y + 2, pw * A * 1.1, 9 + rr() * 5, col, rr);
              for (let k = 0; k < 2; k++) {
                const sx = q.x - 6 + Math.floor(rr() * 12), sh = 6 + Math.floor(rr() * 10);
                px(g, css(col, 0.8), sx, q.y - sh, 2, sh);
                px(g, css(col, 1.1), sx, q.y - sh - 1, 2, 1);
              }
            });
            continue;
          }
          const floors = Math.max(1, Math.round((suburb ? 1 : 2) + core * 6 * r() + r() * (suburb ? 1.5 : 3)));
          const b: Bld = { x: lx, z: rz, w: Math.max(0.4, pw - 0.1), d: rd, floors, col, roof: ROOFS[Math.floor(r() * 4)], ruin: rv < 0.42 ? 1 : rv < 0.58 ? 2 : 0, glass: false, seed };
          push(lx + rz, (g) => building(g, b));
        }
      }
    }
  // przewrócony wieżowiec leżący w poprzek bocznej ulicy
  {
    const x = CX - 2 * G, z = CZ - 1.5 * G;
    push(x + z, (g) => {
      const info = isoBox(g, x, z, 2.6, 0.62, 0.62, 0x5e646a, 0, true, (X, bt, _tp, south, t, len) => {
        if (south && t % 3 === 1 && t < len - 1) for (let y = bt - 6; y < bt - 1; y += 3) px(g, hash(X, y) < 0.7 ? '#1a1a1c' : '#3a4a54', X, y, 1, 1);
      });
      const c = info.c, e = c.x0 + c.n - 1;
      px(g, '#141110', e - 3, c.top[c.n - 4] - info.H, 3, c.bot[c.n - 1] - c.top[c.n - 4] + info.H);
      rubble(g, e + 3, c.bot[c.n - 1] + 2, 14, 6, 0x5e646a, seeded(77));
    });
  }
  // wraki, autobusy, latarnie na ulicach
  for (let k = 0; k < 46; k++) {
    const vert = r() < 0.5, line = Math.floor((r() - 0.5) * (vert ? 11 : 9));
    const x = vert ? CX + (line + 0.5) * G + (r() - 0.5) * 0.3 : CX + (r() - 0.5) * 2 * CRX;
    const z = vert ? CZ + (r() - 0.5) * 2 * CRZ : CZ + (line + 0.5) * G + (r() - 0.5) * 0.24;
    if (!inCity({ x: W(x), z: W(z) })) continue;
    const col = [0x8a3a2a, 0x4a5a6a, 0x7a7a5a, 0x5a4a3a, 0x9a8a3a, 0x3a5a4a][k % 6], burnt = r() < 0.4, bus = k % 9 === 0;
    push(x + z, (g) => car(g, x, z, vert, col, burnt, bus));
  }
  for (let i = -BI; i <= BI; i++) {
    if (!on(i, 0) && !on(i, 1)) continue;
    const x = CX + i * G, z = AVE_Z + AVE_W + SIDE * 0.5, s = r();
    push(x + z, (g) => lamp(g, x, z, s));
    const z2 = AVE_Z - AVE_W - SIDE * 0.5, s2 = r();
    push(x + 0.6 + z2, (g) => lamp(g, x + 0.6, z2, s2));
  }
  // leje po bombach (na ziemi, przed bryłami)
  for (let k = 0; k < 6; k++) {
    const x = CX + (Math.floor((r() - 0.5) * 10) + 0.5) * G, z = CZ + (Math.floor((r() - 0.5) * 7) + 0.5) * G + (r() - 0.5) * 1.2;
    if (!inCity({ x: W(x), z: W(z) }) || Math.abs(z - AVE_Z) < 0.8) continue;
    const s = 0.5 + r() * 0.5;
    push(-999, (g) => crater(g, x, z, s));
  }
  // brama miasta na końcu alei: dwie wieże, szlaban, worki z piaskiem, zapory przeciwczołgowe
  for (const dz of [-0.85, 0.85])
    push(GX0 + AVE_Z + dz, (g) => {
      isoBox(g, GX0, AVE_Z + dz, 0.5, 0.44, 1.7, 0x5a5048, 0, true, (X, bt, _tp, _s, t, len) => {
        if (t > 0 && t < len - 1) px(g, '#1a1614', X, bt - 16, 1, 2);
      });
    });
  push(GX0 + AVE_Z + 0.01, (g) => {
    const h = th(GX0, AVE_Z) + 0.7;
    for (let k = 0; k < 6; k++) {
      const z0 = AVE_Z - 0.6 + k * 0.2;
      seg(g, pr(GX0, z0, h), pr(GX0, z0 + 0.2, h), k % 2 ? '#c03a2a' : '#d8d0c0');
    }
  });
  for (let k = 0; k < 6; k++) {
    const x = GX0 - 0.9 - (k % 2) * 0.3, z = AVE_Z - 1.6 + k * 0.62;
    if (Math.abs(z - AVE_Z) < 0.45) continue;
    push(x + z, (g) => tankTrap(g, x, z));
  }
  for (const dz of [-1.4, 1.4]) push(GX0 + 0.4 + AVE_Z + dz, (g) => sandbags(g, GX0 + 0.4, AVE_Z + dz, 1.0, false));
  // zawalony wiadukt wjazdowy
  for (let k = 0; k < 6; k++) {
    if (k === 3) continue;
    const x = -15.5 + k, z = 5.9 - k * 0.5, sag = k === 2 || k === 4 ? -0.35 : 0;
    push(x + z + 0.5, (g) => {
      isoBox(g, x, z + 0.25, 0.22, 0.22, 1.2 + sag, 0x5a5450);
      isoBox(g, x, z, 1.8, 0.8, 0.2, 0x6a6460, 1.2 + sag);
    });
  }
  push(-12.5 + 4.6, (g) => {
    const q = P(-12.5, 4.6);
    rubble(g, q.x, q.y, 16, 7, 0x6a6460, seeded(91));
  });
}

/** Plac zleceń: pomnik na cokole (z tyłu, flaga stoi na środku), ławki, uschnięte drzewa. */
function plaza(items: Item[], cx: number, cz: number, L: number, R: number, T: number, Bt: number, r: () => number): void {
  const seed = Math.floor(r() * 1e9);
  items.push({ key: cx - 0.5 + cz - 0.5, draw: (g) => {
    const info = isoBox(g, cx - 0.5, cz - 0.5, 0.42, 0.42, 0.3, 0x8a8274);
    const p = pr(cx - 0.5, cz - 0.5, info.h0 + info.H / LIFT), sx = Math.round(p[0]), sy = Math.round(p[1]);
    // posąg bez głowy, z uniesioną ręką
    px(g, '#5a6a5a', sx - 1, sy - 9, 3, 9);
    px(g, '#4a5a4a', sx + 1, sy - 9, 1, 9);
    px(g, '#5a6a5a', sx - 3, sy - 8, 2, 1);
    px(g, '#5a6a5a', sx - 4, sy - 11, 1, 3);
    const q = P(cx - 0.1, cz - 0.4);
    rubble(g, q.x, q.y, 8, 3, 0x8a8274, seeded(seed));
  } });
  for (const [dx, dz] of [[-1, -1], [1, 1]]) {
    const x = dx < 0 ? L + 0.18 : R - 0.18, z = dz < 0 ? T + 0.16 : Bt - 0.16, s = r();
    items.push({ key: x + z, draw: (g) => deadTree(g, x, z, s, seed + dx * 3 + dz) });
  }
  items.push({ key: cx + Bt - 0.3, draw: (g) => {
    for (const bx of [cx - 0.55, cx + 0.45]) {
      const q = P(bx, Bt - 0.3);
      seg(g, [q.x, q.y - 2], [q.x + 4, q.y], '#5a4430');
      px(g, '#3a2e24', q.x, q.y - 1, 1, 1);
      px(g, '#3a2e24', q.x + 4, q.y + 1, 1, 1);
    }
  } });
}

// ------------------------------------------------------------------ pozostałe strefy

function regionItems(items: Item[], r: () => number): void {
  const push = (key: number, draw: (g: Ctx2D) => void): void => void items.push({ key, draw });
  // ================= strefa przemysłowa: hale szedowe, kominy, chłodnia, zbiorniki, tory, kontenery, suwnica
  const halls: [number, number, number, number, number, number][] = [[8.7, -11.9, 2.3, 1.5, 4, 0x7a4a30], [12.1, -12.7, 2.5, 1.8, 5, 0x5a4a40], [16.1, -12.4, 2.1, 1.6, 4, 0x6a5040], [11.3, -9.1, 1.9, 1.2, 3, 0x6a5a4a]];
  halls.forEach(([x, z, w, d, f, col], i) => {
    const b: Bld = { x, z, w, d, floors: f, col, roof: 0x5a5450, ruin: 0, glass: false, seed: 300 + i, saw: true };
    push(x + z, (g) => building(g, b));
  });
  for (const [x, z, h] of [[13.5, -14.1, 4.6], [9.9, -13.1, 3.6], [17.3, -13.6, 3.9]]) {
    push(x + z, (g) => {
      const info = isoBox(g, x, z, 0.42, 0.42, h, 0x7a3a2a, 0, true, (X, bt, _tp, south) => {
        for (let y = bt - 4; y > bt - h * LIFT + 6; y -= 6) px(g, south ? '#5a2a1e' : '#4a2218', X, y, 1, 1);
        px(g, '#d8d0c0', X, bt - Math.round(h * LIFT) + 3, 1, 2);
        px(g, '#c03020', X, bt - Math.round(h * LIFT) + 6, 1, 1);
      });
      const p = pr(x, z, info.h0 + h);
      smokePlume(g, Math.round(p[0]), Math.round(p[1]) - 3, 9, x < 12);
    });
  }
  {
    const x = 21.4, z = -16.4;
    push(x + z, (g) => {
      // chłodnia kominowa: hiperboloida z talią i pęknięciem
      const { x: cx, y: yb } = P(x, z), hh = 3.2 * LIFT, rb = 1.1 * A * 1.3;
      g.fillStyle = 'rgba(30,18,10,0.3)';
      g.beginPath();
      g.ellipse(cx + rb * 0.6, yb - 2, rb, rb * 0.4, 0, 0, Math.PI * 2);
      g.fill();
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
      g.beginPath();
      g.ellipse(cx, yb - hh, rb * 0.62, rb * 0.62 * 0.45, 0, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = '#3a3430';
      g.beginPath();
      g.moveTo(cx - 2, yb - hh + 4);
      g.lineTo(cx + 1, yb - hh * 0.7);
      g.lineTo(cx - 1, yb - hh * 0.5);
      g.stroke();
    });
  }
  // zbiorniki (walce z kopułą)
  for (const [x, z, rr] of [[7.2, -14.2, 0.6], [8.6, -14.9, 0.5], [6.6, -12.6, 0.45]]) {
    push(x + z, (g) => {
      const { x: cx, y: yb } = P(x, z), rx = Math.round(rr * A * 1.41), ry = Math.max(2, Math.round(rr * B * 1.41)), hh = Math.round(LIFT * rr * 2.4);
      g.fillStyle = 'rgba(30,18,10,0.3)';
      g.beginPath();
      g.ellipse(cx + rx * 0.7, yb, rx, ry, 0, 0, Math.PI * 2);
      g.fill();
      for (let i = -rx; i <= rx; i++) {
        const t = (i + rx) / (2 * rx), f = 0.62 + Math.sin(t * Math.PI) * 0.5 - t * 0.3;
        const e = Math.round(ry * Math.sqrt(Math.max(0, 1 - (i / rx) ** 2)));
        px(g, css(0x8a7a64, f), cx + i, yb - hh, 1, hh + e);
        for (let y = yb - hh + 5; y < yb + e - 1; y += 5) px(g, 'rgba(60,40,30,0.45)', cx + i, y, 1, 1);
      }
      g.fillStyle = css(0x8a7a64, 1.22);
      g.beginPath();
      g.ellipse(cx, yb - hh, rx, ry, 0, 0, Math.PI * 2);
      g.fill();
      px(g, '#7a3a24', cx - rx + 3, yb - hh + 6, 3, 4);
    });
  }
  // rurociąg na estakadzie
  push(9.3 - 13.6, (g) => {
    for (let x = 7.6; x <= 11; x += 0.6) {
      const q = P(x, -13.6);
      px(g, '#4a4440', q.x, q.y - 9, 1, 9);
    }
    const h = th(9, -13.6) + 0.8;
    seg(g, pr(7.6, -13.6, h), pr(11, -13.6, h), '#6a6a6e');
    seg(g, pr(7.6, -13.6, h + 0.09), pr(11, -13.6, h + 0.09), '#8a8a8e');
  });
  push(-999, (g) => rails(g, 3.5, 18.5, -10.35));
  for (let k = 0; k < 4; k++) {
    const x = 6.5 + k * 1.15, col = [0x6a3a2a, 0x5a4a3a, 0x3a4a5a, 0x6a3a2a][k];
    push(x - 10.35, (g) => {
      isoBox(g, x, -10.35, 1.0, 0.36, 0.5, col, 0.05, true, (X, bt, _tp, south, t, len) => {
        if (south && t % 3 === 0) px(g, css(col, 0.6), X, bt - 5, 1, 4);
        if (t === 1 || t === len - 2) px(g, '#141414', X, bt, 1, 1);
      });
    });
  }
  for (let k = 0; k < 14; k++) {
    const row = k % 2, x = 8 + Math.floor(k / 2) * 0.95 + (r() - 0.5) * 0.15, z = -7.3 + row * 0.42, col = [0xa04a2a, 0x2a6a8a, 0x8a8a3a, 0x5a6a4a, 0x8a5a3a][k % 5], up = r() < 0.35 ? 0.38 : 0;
    if (r() < 0.12) continue;
    push(x + z + up * 0.01, (g) => void isoBox(g, x, z, 0.9, 0.38, 0.38, col, up, true, (X, bt, _tp, _s, t) => {
      if (t % 2 === 1) px(g, css(col, 0.62), X, bt - 4, 1, 4);
    }));
  }
  push(10.9 - 6.6, (g) => {
    const a = P(9.2, -6.8), b2 = P(12.6, -6.8), h = th(10.9, -6.8) + 1.8;
    const ta = pr(9.2, -6.8, h), tb = pr(12.6, -6.8, h);
    px(g, '#c09020', a.x, Math.round(ta[1]), 2, a.y - Math.round(ta[1]));
    px(g, '#c09020', b2.x, Math.round(tb[1]), 2, b2.y - Math.round(tb[1]));
    seg(g, ta, tb, '#d8a828');
    seg(g, [ta[0], ta[1] - 1], [tb[0], tb[1] - 1], '#d8a828');
    const m = pr(10.4, -6.8, h);
    px(g, '#3a3430', Math.round(m[0]), Math.round(m[1]), 1, 8);
    px(g, '#5a5048', Math.round(m[0]) - 2, Math.round(m[1]) + 8, 5, 2);
  });
  // beczki z odpadami i tablice ostrzegawcze wokół krateru
  for (let k = 0; k < 9; k++) {
    const a = k * 0.72 + 0.3, x = KRX + Math.cos(a) * 3.3, z = KRZ + Math.sin(a) * 3.0;
    push(x + z, (g) => {
      isoBox(g, x, z, 0.2, 0.2, 0.28, 0x6a8a2a, 0, false);
      if (k % 3 === 0) {
        const q = P(x + 0.3, z);
        px(g, '#3a3430', q.x, q.y - 8, 1, 8);
        px(g, '#e0c030', q.x - 2, q.y - 11, 5, 4);
        px(g, '#1a1a1a', q.x, q.y - 10, 1, 2);
      }
    });
  }

  // ================= góry: bunkier w zboczu, maszt, radar, schrony bojowe, ogrodzenie, martwe sosny
  push(-12 - 8.0, (g) => {
    const H = Math.round(1.4 * LIFT);
    isoBox(g, -12, -8.0, 2.2, 0.6, 1.4, 0x5a5a5e, 0, true, (X, bt, _tp, south, t, len) => {
      if (!south) return;
      // wrota pancerne w pasy, światła, żółto-czarna krawędź
      if (t > len * 0.25 && t < len * 0.75) {
        px(g, '#0a0a0c', X, bt - H + 4, 1, H - 4);
        px(g, Math.abs(t - len / 2) < 1 ? '#2a2c30' : '#4a4c50', X, bt - H + 5, 1, H - 5);
      }
      if (t % 4 < 2) px(g, '#c0a030', X, bt - H + 1, 1, 2);
      if (t === 3 || t === len - 4) px(g, '#ff4030', X, bt - H + 5, 1, 1);
    });
  });
  push(-12 - 7.3, (g) => {
    sandbags(g, -13.4, -7.4, 0.9);
    sandbags(g, -10.6, -7.4, 0.9);
  });
  push(-10.6 - 9.0, (g) => {
    // maszt kratowy z odciągami
    const { x: cx, y } = P(-10.6, -9.0), h = 4 * LIFT;
    g.strokeStyle = 'rgba(120,120,120,0.5)';
    g.beginPath();
    g.moveTo(cx, y - h + 4);
    g.lineTo(cx - 14, y + 2);
    g.moveTo(cx, y - h + 4);
    g.lineTo(cx + 14, y + 2);
    g.stroke();
    px(g, '#8a8a8a', cx - 1, y - h, 1, h);
    px(g, '#8a8a8a', cx + 1, y - h, 1, h);
    for (let yy = y - h + 2; yy < y; yy += 3) px(g, '#6a6a6a', cx - 1, yy, 3, 1);
  });
  push(-14.4 - 14.2, (g) => {
    const info = isoBox(g, -14.4, -14.2, 0.5, 0.5, 0.5, 0x5a5a5e);
    const p = pr(-14.4, -14.2, info.h0 + 0.5), cx = Math.round(p[0]), cy = Math.round(p[1]) - 7;
    g.fillStyle = '#b8b8b0';
    g.beginPath();
    g.ellipse(cx, cy, 7, 4, -0.5, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#8a8a84';
    g.beginPath();
    g.ellipse(cx + 1, cy + 1, 5, 2.5, -0.5, 0, Math.PI * 2);
    g.fill();
    px(g, '#5a5a5e', cx, cy + 3, 1, 4);
  });
  for (const [x, z] of [[-17.8, -7.0], [-8.0, -8.0], [-20.6, -10.6]])
    push(x + z, (g) => void isoBox(g, x, z, 0.8, 0.6, 0.45, 0x6a6a64, 0, true, (X, bt, _tp, _s, t, len) => {
      if (t > 2 && t < len - 3) px(g, '#0e0e0e', X, bt - 4, 1, 1);
    }));
  for (const [x, z] of [[-21.4, -9.4], [-14.3, -10.8]]) push(x + z, (g) => {
    const info = isoBox(g, x, z, 0.3, 0.3, 0.5, 0x5a5a5e);
    isoHole(g, x, z, info.h0 + 0.5, 0.2, 0.2);
  });
  for (let k = 0; k < 15; k++) {
    const x = -19.5 + k * 0.75;
    if (Math.abs(x + 12) < 1.2) continue;
    push(x - 6.3, (g) => {
      const q = P(x, -6.3);
      px(g, '#4a3a2e', q.x, q.y - 6, 1, 6);
      if (Math.abs(x + 0.75 + 12) >= 1.2) {
        const nq = P(x + 0.75, -6.3);
        seg(g, [q.x, q.y - 5], [nq.x, nq.y - 5], 'rgba(110,110,110,0.8)');
        seg(g, [q.x, q.y - 3], [nq.x, nq.y - 3], 'rgba(110,110,110,0.8)');
      }
    });
  }
  for (let i = 0; i < 70; i++) {
    const x = -28 + r() * 26, z = -18 + r() * 12, s = r();
    const h = th(x, z);
    if (h < 1.2 || h > 5.2 || !freeAt(x, z, 0.6)) continue;
    push(x + z, (g) => pine(g, x, z, s));
  }

  // ================= pustkowia: obóz Nomadów, wrak samolotu, szkielet olbrzyma, wieża wiertnicza, wraki
  for (let k = 0; k < 6; k++) {
    const a = k * 1.05 + 0.2, x = 22 + Math.cos(a) * 1.6, z = 9.5 + Math.sin(a) * 1.2, col = [0xc8a468, 0x9a6a3a, 0xb88a54][k % 3];
    push(x + z, (g) => {
      const { x: cx, y } = P(x, z);
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
    push(x + z, (g) => {
      const info = isoBox(g, x, z, 0.9, 0.45, 0.35, 0x6a4a2a, 0, true, (X, bt, _tp, _s, t, len) => {
        if (t === 1 || t === len - 2) px(g, '#141414', X, bt - 1, 1, 2);
      });
      // plandeka: łuk nad skrzynią
      const c = info.c;
      for (let i = 0; i < c.n; i++) {
        const tp = c.top[i] - info.H, bt = c.bot[i] - info.H, arch = Math.round(5 * Math.sin((i / (c.n - 1)) * Math.PI));
        px(g, i < c.sx ? '#d8c8a0' : '#b8a880', c.x0 + i, tp - 4 - Math.min(2, arch), 1, bt - tp + 4);
      }
    });
  }
  push(20.2 + 7.9, (g) => {
    // totem z czaszką
    const { x: cx, y } = P(20.2, 7.9);
    px(g, '#5a3a24', cx, y - 14, 2, 14);
    px(g, '#5a3a24', cx - 3, y - 11, 8, 1);
    px(g, '#e6dcc0', cx - 1, y - 18, 4, 4);
    px(g, '#1a1410', cx, y - 17, 1, 1);
    px(g, '#1a1410', cx + 2, y - 17, 1, 1);
  });
  push(25.2 + 13.4, (g) => {
    // wrak samolotu: kadłub wzdłuż x, złamane skrzydło, statecznik
    const h = th(25.2, 13.4);
    const info = isoBox(g, 25.2, 13.4, 3.4, 0.5, 0.55, 0x9a9c9a, 0, true, (X, bt, _tp, south, t, len) => {
      if (south) {
        px(g, '#6a6c6a', X, bt - 1, 1, 1);
        if (t > 3 && t < len - 6 && t % 4 < 2) px(g, '#2a3036', X, bt - 5, 1, 2);
      }
    });
    const c = info.c;
    px(g, '#1a1a1a', c.x0, c.bot[0] - info.H, 2, info.H);
    const tail = pr(26.7, 13.2, h + 0.55), tx = Math.round(tail[0]), ty = Math.round(tail[1]);
    px(g, '#9a9c9a', tx - 3, ty - 10, 5, 10);
    px(g, '#c04030', tx - 2, ty - 9, 3, 2);
    // skrzydło jako płaski romb leżący na piasku
    const w0 = pr(24.6, 13.7, h + 0.05), w1 = pr(25.4, 13.7, h + 0.05), w2 = pr(25.9, 15.0, h), w3 = pr(25.3, 15.0, h);
    g.fillStyle = '#8a8c8a';
    g.beginPath();
    g.moveTo(w0[0], w0[1]);
    g.lineTo(w1[0], w1[1]);
    g.lineTo(w2[0], w2[1]);
    g.lineTo(w3[0], w3[1]);
    g.fill();
    rubble(g, Math.round(w2[0]), Math.round(w2[1]) + 2, 10, 3, 0x9a9c9a, seeded(5));
  });
  push(25 + 17.2, (g) => {
    // szkielet olbrzyma: żebra wzdłuż kręgosłupa (oś x)
    g.strokeStyle = '#e6dcc0';
    g.lineWidth = 1.5;
    for (let k = 0; k < 8; k++) {
      const q = P(23.8 + k * 0.32, 17.2), rr = 8 - Math.abs(k - 3.5) * 1.1;
      g.beginPath();
      g.arc(q.x + 0.5, q.y, rr, Math.PI, Math.PI * 1.95);
      g.stroke();
    }
    g.lineWidth = 1;
    const a = P(23.8, 17.2), b2 = P(26.4, 17.2);
    seg(g, [a.x, a.y - 1], [b2.x, b2.y - 1], '#e6dcc0');
    px(g, '#e6dcc0', a.x - 7, a.y - 6, 7, 5);
    px(g, '#1a1410', a.x - 5, a.y - 5, 2, 2);
  });
  push(30.2 + 15.6, (g) => {
    // wieża wiertnicza (kratownica)
    const { x: cx, y } = P(30.2, 15.6), h = 30;
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
    push(x + z, (g) => {
      car(g, x, z, vert, col, true);
      const q = P(x, z);
      px(g, rgbCss(SAND), q.x - 4, q.y, 7, 2);
    });
  }

  // ================= Przystań: mur ze złomu, chaty z blachy, wieża ciśnień, wiatrak, lokomotywa, wieże strażnicze
  for (let k = 0; k < 28; k++) {
    if (k === 0) continue;
    const a = (k / 28) * Math.PI * 2, x = HX + Math.cos(a) * 2.6, z = HZ + Math.sin(a) * 1.9;
    const col = [0x6a5a46, 0x7a4a34, 0x5a6066, 0x6a6a5a][(k * 7) % 4];
    const alongX = Math.abs(Math.sin(a)) > 0.7;
    push(x + z, (g) => void isoBox(g, x, z, alongX ? 0.6 : 0.2, alongX ? 0.2 : 0.6, 0.62, col, 0, false, (X, bt, _tp, _s, t) => {
      if (t % 2 === 0) px(g, css(col, 0.7), X, bt - 7, 1, 7);
    }));
  }
  const shacks: [number, number, number][] = [[-1.5, -0.7, 0x7a6a52], [-0.6, -0.9, 0x5a4a3a], [1.5, 0.4, 0x8a6a4a], [-1.9, 0.2, 0x6a5a4a], [0.6, 0.85, 0x7a5a42], [1.3, -0.75, 0x5a5a52]];
  for (const [dx, dz, col] of shacks) {
    const x = HX + dx, z = HZ + dz;
    push(x + z, (g) => {
      const info = isoBox(g, x, z, 0.7, 0.5, 0.48, col, 0, true, (X, bt, tp, south, t, len) => {
        if (south && t === 2) px(g, '#1a1410', X, bt - 5, 2, 5);
        if (!south && t === len - 3) px(g, '#ffb050', X, bt - 4, 1, 2);
        // blacha falista na dachu
        for (let y = tp; y < bt - Math.round(0.48 * LIFT); y++) if ((X + y) % 3 === 0) px(g, '#9a7048', X, y, 1, 1);
      });
      const p = pr(x + 0.2, z - 0.1, info.h0 + 0.48);
      smokePlume(g, Math.round(p[0]), Math.round(p[1]) - 3, 4);
    });
  }
  push(HX + 0.3 + HZ, (g) => {
    // lokomotywa i wagon
    isoBox(g, HX + 0.3, HZ + 0.05, 1.6, 0.45, 0.5, 0x3a4a3a, 0, true, (X, bt, _tp, south, t, len) => {
      if (south) px(g, '#c04030', X, bt - 5, 1, 1);
      if (t % 5 === 2 && t < len - 1) px(g, '#141414', X, bt - 1, 2, 2);
    });
    isoBox(g, HX + 0.9, HZ + 0.05, 0.5, 0.45, 0.4, 0x2a3a2a, 0.5);
    const p = pr(HX - 0.3, HZ + 0.05, th(HX, HZ) + 0.5);
    px(g, '#2a2a2a', Math.round(p[0]), Math.round(p[1]) - 6, 3, 6);
  });
  push(HX - 0.4 + HZ - 0.9, (g) => {
    // wieża ciśnień
    const { x: cx, y } = P(HX - 0.4, HZ - 0.9);
    px(g, '#4a3a2e', cx - 4, y - 16, 1, 16);
    px(g, '#4a3a2e', cx + 4, y - 16, 1, 16);
    for (let yy = y - 14; yy < y; yy += 5) px(g, '#4a3a2e', cx - 4, yy, 9, 1);
    px(g, '#6a5240', cx - 6, y - 26, 13, 10);
    px(g, '#4a3a2e', cx + 2, y - 26, 5, 10);
    g.fillStyle = '#5a4434';
    g.beginPath();
    g.moveTo(cx - 7, y - 26);
    g.lineTo(cx, y - 31);
    g.lineTo(cx + 7, y - 26);
    g.fill();
  });
  push(HX + 2.0 + HZ - 1.3, (g) => {
    // wiatrak
    const { x: cx, y } = P(HX + 2.0, HZ - 1.3);
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
    push(HX + dx + HZ + dz, (g) => {
      const info = isoBox(g, HX + dx, HZ + dz, 0.34, 0.3, 1.6, 0x5a4a3a);
      isoBox(g, HX + dx, HZ + dz, 0.5, 0.46, 0.12, 0x6a5038, 1.6 + info.h0 - th(HX + dx, HZ + dz), false);
      const p = pr(HX + dx, HZ + dz, info.h0 + 1.75);
      px(g, '#7a5a3a', Math.round(p[0]) - 5, Math.round(p[1]) - 5, 11, 1);
      px(g, '#3a2e24', Math.round(p[0]) - 5, Math.round(p[1]) - 4, 1, 4);
      px(g, '#3a2e24', Math.round(p[0]) + 5, Math.round(p[1]) - 4, 1, 4);
    });

  // ================= dzicz: linia energetyczna z przewróconymi słupami, opuszczone farmy
  const pylons: [number, number, boolean][] = [];
  for (let k = 0; k < 9; k++) {
    const t = k / 8, x = -14 + t * 19, z = 4.2 - t * 13 + Math.sin(t * 6) * 0.8;
    if (inCity({ x: W(x), z: W(z) }) || !freeAt(x, z, 1)) continue;
    pylons.push([x, z, hash(k, 9) < 0.3]);
  }
  pylons.forEach(([x, z, fallen], i) => {
    push(x + z, (g) => {
      const { x: cx, y } = P(x, z);
      g.strokeStyle = '#5a5a5e';
      g.beginPath();
      if (fallen) {
        g.moveTo(cx, y);
        g.lineTo(cx + 18, y + 6);
        g.moveTo(cx + 3, y + 2);
        g.lineTo(cx + 18, y + 8);
        g.stroke();
        return;
      }
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
        const e = P(nx[0], nx[1]);
        g.strokeStyle = 'rgba(40,36,34,0.6)';
        for (const o of [-6, 6]) {
          g.beginPath();
          g.moveTo(cx + o, y - 20);
          g.quadraticCurveTo((cx + e.x) / 2 + o, (y + e.y) / 2 - 12, e.x + o, e.y - 20);
          g.stroke();
        }
      }
    });
  });
  for (const [x, z, seed] of [[-6.5, 15.2, 1], [9.5, 16.6, 2], [-26, 11.5, 3], [-27.5, 2.5, 4]]) {
    if (!freeAt(x, z, 1)) continue;
    push(x + z, (g) => house(g, x, z, 1.0, 0.6, 0x7a6a52, 0x6a3a2a, seed * 97, seed % 2 === 1));
    push(x + 1.3 + z - 0.6, (g) => {
      const info = isoBox(g, x + 1.3, z - 0.6, 0.9, 0.8, 0.7, 0x7a4a30, 0, true, (X, bt, tp, south, t, len) => {
        if (south && t > len / 2 - 3 && t < len / 2 + 2) px(g, '#1a1410', X, bt - 7, 1, 7);
        for (let y = tp; y < bt - Math.round(0.7 * LIFT); y++) if ((X + y) % 3 === 0) px(g, '#5a4a3a', X, y, 1, 1);
      });
      void info;
    });
  }
}

/** Autostrada Przystań -> brama (te same próbki co trasa do ruin): pobocza, asfalt z ubytkami, linie, słupy, wraki. */
function paintHighway(g: Ctx2D, items: Item[]): void {
  const rt = buildRoute(PLAZAS[0], 'ruins', 0), n = rt.trackFrom;
  const Pt = (i: number): [number, number] => [scrX(rt.x[i], rt.z[i]), scrY(rt.x[i], rt.z[i])];
  const gap = (i: number): boolean => i % 40 === 18 || i % 40 === 31;
  const stroke = (col: string, wdt: number, skip: (i: number) => boolean): void => {
    g.strokeStyle = col;
    g.lineWidth = wdt;
    g.lineCap = 'round';
    for (let i = 0; i < n; i++) {
      if (skip(i)) continue;
      const [ax, ay] = Pt(i), [bx, by] = Pt(i + 1);
      g.beginPath();
      g.moveTo(ax, ay);
      g.lineTo(bx, by);
      g.stroke();
    }
    g.lineCap = 'butt';
    g.lineWidth = 1;
  };
  stroke('rgba(120,104,84,0.8)', 11, () => false);
  stroke('#3c3836', 8, gap);
  for (let i = 0; i < n; i++) {
    if (gap(i)) continue;
    const [x, y] = Pt(i);
    if (i % 4 < 2) px(g, '#c8b068', x, y, 2, 1);
    if (hash(i, 77) < 0.25) px(g, '#2a2624', x - 2, y - 2 + Math.floor(hash(77, i) * 4), 4, 1);
  }
  for (let i = 6; i < n - 2; i += 16) {
    const x = rt.x[i] / WQ, z = rt.z[i] / WQ + 0.9, lean = i === 54;
    items.push({ key: x + z, draw: (gg) => {
      const { x: cx, y } = P(x, z);
      if (lean) {
        seg(gg, [cx, y], [cx + 12, y - 3], '#4a4a4e');
      } else {
        px(gg, '#4a4a4e', cx, y - 20, 1, 20);
        px(gg, '#4a4a4e', cx - 5, y - 19, 11, 1);
        px(gg, '#8a8070', cx - 5, y - 18, 2, 1);
        px(gg, '#8a8070', cx + 4, y - 18, 2, 1);
      }
    } });
  }
  for (let i = 12; i < n - 6; i += 23) {
    const x = rt.x[i] / WQ + 0.3, z = rt.z[i] / WQ + (i % 2 ? 0.55 : -0.5), col = [0x6a4a3a, 0x4a5a6a, 0x7a6a3a][i % 3];
    items.push({ key: x + z, draw: (gg) => car(gg, x, z, false, col, i % 3 === 0) });
  }
  {
    const i = Math.floor(n * 0.45), x = rt.x[i] / WQ, z = rt.z[i] / WQ - 0.8;
    items.push({ key: x + z, draw: (gg) => {
      const { x: cx, y } = P(x, z);
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
  for (let i = 0; i < 640; i++) {
    const x = -40 + r() * 80, z = -26 + r() * 56, t = r(), v = r();
    const sx = OX + (x - z) * A, sy = OY + (x + z) * B;
    if (sx < -10 || sx > MAP_W + 10 || sy < 0 || sy > MAP_H + 20) continue;
    if (havenE(x, z) < 1.6 || inPad(x, z)) continue;
    const h = th(x, z), dc = Math.hypot(x - KRX, z - KRZ), dr = riverDistF(x, z);
    if (h > 4.2 || dc < 2.6 || !freeAt(x, z, 0.5)) continue;
    const e = ((x - CX) / CRX) ** 2 + ((z - CZ) / CRZ) ** 2;
    if (e < 1.15) continue;
    let kind: 'grass' | 'bush' | 'tree' | 'cactus' | 'shroom' | 'rock' | 'crystal' | 'bones';
    if (dc < 7) kind = v < 0.6 ? 'shroom' : 'grass';
    else if (h > 1.7) kind = v < 0.6 ? 'rock' : v < 0.68 ? 'crystal' : 'bush';
    else if (dr < 2.4) kind = v < 0.5 ? 'grass' : v < 0.85 ? 'bush' : 'tree';
    else if (x > 15) kind = v < 0.5 ? 'cactus' : v < 0.75 ? 'bush' : v < 0.9 ? 'rock' : 'bones';
    else kind = v < 0.35 ? 'grass' : v < 0.6 ? 'bush' : v < 0.82 ? 'tree' : v < 0.96 ? 'rock' : 'bones';
    items.push({ key: x + z, draw: (g) => {
      const { x: cx, y } = P(x, z);
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
        case 'cactus': {
          const c1 = t < 0.5 ? '#5a7a3a' : '#7a8a4a';
          px(g, c1, cx, y - 9, 3, 9);
          px(g, '#4a6a2a', cx + 2, y - 9, 1, 9);
          px(g, c1, cx - 3, y - 7, 1, 3);
          px(g, c1, cx - 2, y - 5, 2, 1);
          px(g, c1, cx + 3, y - 4, 2, 1);
          px(g, c1, cx + 5, y - 7, 1, 4);
          break;
        }
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
    const grad = g.createRadialGradient(w / 2, h / 2, h * 0.45, w / 2, h / 2, h * 1.0);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(24,10,4,0.5)');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
  });
}

/** Miejsca animowanych ognisk (płonące beczki na ulicach, obóz Nomadów, Przystań) - w pikselach mapy. */
export function regionFires(): { x: number; y: number; size: number }[] {
  const pts: [number, number][] = [[1, -1], [-2, 1], [3, 2], [-1, -3], [4, 0], [-4, -1], [2, 3]];
  const out = pts.map(([gx, gz]) => {
    const p = P(CX + (gx + 0.5) * G - 0.6, CZ + (gz + 0.5) * G + 0.05);
    return { x: p.x, y: p.y, size: 0.4 };
  });
  const camp = P(22, 9.5), home = P(HX - 0.4, HZ + 0.05);
  out.push({ x: camp.x, y: camp.y, size: 0.55 }, { x: home.x, y: home.y, size: 0.45 });
  return out;
}

/** Czubek masztu przy bunkrze (czerwona latarnia). */
export const beaconPos = (): { x: number; y: number } => {
  const p = P(-10.6, -9.0, 4);
  return { x: p.x, y: p.y - 1 };
};
