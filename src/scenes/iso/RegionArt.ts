// Mapa regionu malowana z wysokościami (port krajobrazu Oldgame/src/scenes/meta/worldterrain.js bez three.js).
// Rzut ukośny z południa: x -> poziomo, z -> pionowo (spłaszczone), wysokość podnosi punkt na ekranie.
// Teren rysowany "voxel space" kolumnami od najbliższego do najdalszego z buforem Y, więc góry, płaskowyże,
// wał krateru i wydmy zasłaniają to, co za nimi, a stoki są cieniowane od północnego zachodu.
// Budynki i obiekty to bryły z frontem i dachem, sortowane po krawędzi frontu.
// W porcie na Amigę ten obraz jest wypiekany do pliku (kafle <= 256 px), tu malowany raz przy wejściu.

import Phaser from 'phaser';
import { CITY, CRATER, GATE, HOME, PLAZA_CELLS, PLAZAS, SECTORS, WQ, buildRoute, heightQ8, inCity, riverDistF } from '../../core/campaign/region';
import { canvasTexture, seeded, type Ctx2D } from '../ui/Kit';

// ------------------------------------------------------------------ rzut

/** Piksele na jednostkę świata (poziomo, pionowo w głąb) i na jednostkę wysokości. */
export const KX = 7.4, KZ = 5.6, LIFT = 6;
const OX = 232, OY = 112;

/** x świata (Q8) -> piksel ekranu. */
export const scrX = (xq: number): number => OX + Math.round((xq * 74) / 2560);
/** Rzut z wysokością terenu w (x, z) (Q8) + dodatkowe uniesienie `up` (Q8). */
export const scrY = (xq: number, zq: number, up = 0): number => OY + Math.round((zq * 56) / 2560) - Math.round(((heightQ8(xq, zq) + up) * LIFT) / WQ);

// pomocnicze dla malowania w jednostkach świata (float)
const W = (v: number): number => Math.round(v * WQ);
const fx = (x: number): number => OX + Math.round(x * KX);
const groundY = (x: number, z: number, up = 0): number => scrY(W(x), W(z), W(up));

const smooth = (e0: number, e1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};
const g2 = (x: number, z: number, cx: number, cz: number, rx: number, rz: number): number => Math.exp(-(((x - cx) / rx) ** 2 + ((z - cz) / rz) ** 2));
type RGB = [number, number, number];
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const hash = (a: number, b: number): number => {
  let h = Math.imul(a, 374761393) + Math.imul(b, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
const css = (c: number, k = 1): string => `rgb(${Math.min(255, Math.round(((c >> 16) & 255) * k))},${Math.min(255, Math.round(((c >> 8) & 255) * k))},${Math.min(255, Math.round((c & 255) * k))})`;

const CX = CITY.x / WQ, CZ = CITY.z / WQ, CRX = CITY.rx / WQ, CRZ = CITY.rz / WQ, G = CITY.g / WQ;
const AVE_Z = CZ + 0.5 * G, AVE_X = CX + 0.5 * G;
const KRX = CRATER.x / WQ, KRZ = CRATER.z / WQ;
const HX = HOME.x / WQ, HZ = HOME.z / WQ;
/** Poziom toksycznego jeziora w kraterze (jednostki). */
const LAKE = -1.38;

/** Kolor gruntu (port terrainTexture z Oldgame). */
function groundColor(x: number, z: number, h: number, n: number): RGB {
  let col: RGB = [178, 142, 92];
  col = mix(col, [198, 162, 104], 0.5 + 0.5 * Math.sin((x + z * 0.6) * 1.3));
  col = mix(col, [126, 104, 76], smooth(-3, 6, x) * (1 - smooth(-4, 4, z)) * 0.5);
  if (h > 1.4) col = mix(col, [104, 92, 82], smooth(1.4, 3.2, h));
  if (h > 4.2) col = mix(col, [150, 140, 132], smooth(4.2, 6, h) * 0.8);
  const r = riverDistF(x, z);
  if (r < 1.6) col = mix(col, [120, 98, 72], (1 - smooth(0.4, 1.6, r)) * 0.8);
  const dc = Math.hypot(x - KRX, z - KRZ);
  if (dc < 3.6) col = mix(col, [70, 76, 46], 1 - smooth(1.4, 3.6, dc));
  const e = ((x - CX) / CRX) ** 2 + ((z - CZ) / CRZ) ** 2;
  if (e < 1.12) {
    const k = 1 - smooth(0.92, 1.12, e);
    const ux = ((((x - CX) / G - 0.5) % 1) + 1) % 1, uz = ((((z - CZ) / G - 0.5) % 1) + 1) % 1;
    const dx = Math.min(ux, 1 - ux) * G, dz = Math.min(uz, 1 - uz) * G, ds = Math.min(dx, dz);
    const ave = Math.abs(z - AVE_Z) < 0.62 || Math.abs(x - AVE_X) < 0.55, sw = ave ? 0.6 : 0.4;
    let c: RGB;
    if (ds < sw || ave) {
      c = [50 + n * 10, 48 + n * 10, 48 + n * 9];
      const along = dx < dz ? z : x, dAxis = ave ? Math.min(Math.abs(z - AVE_Z), Math.abs(x - AVE_X)) : ds;
      if (dAxis < 0.09 && (((along * 1.6) % 1) + 1) % 1 < 0.55 && n > 0.25) c = [196, 170, 84];
      if (n > 0.93) c = [34, 32, 32];
    } else if (ds < sw + 0.16) c = [132, 126, 116];
    else {
      const lot = (Math.floor((x - CX) / G + 0.5) * 7 + Math.floor((z - CZ) / G + 0.5) * 13) & 3;
      c = ([[96, 86, 76], [84, 80, 74], [104, 90, 72], [78, 72, 66]] as RGB[])[lot];
      if (n > 0.8) c = [c[0] - 22, c[1] - 22, c[2] - 20];
      if (n < 0.08) c = [c[0] + 26, c[1] + 22, c[2] + 14];
    }
    col = mix(col, c, k);
  }
  const ind = g2(x, z, 12, -10.5, 5.5, 3.2);
  if (ind > 0.35) col = mix(col, [96, 72, 56], smooth(0.35, 0.7, ind));
  if (g2(x, z, HX, HZ, 3.2, 2.4) > 0.3) col = mix(col, [140, 122, 92], 0.7);
  return col;
}

/** Teren: kolumny od dołu ekranu (blisko) w górę (daleko), bufor Y = co już zasłonięte. */
function paintTerrain(g: Ctx2D, w: number, h: number): void {
  const img = g.createImageData(w, h), d = img.data;
  const ZN = W(29), ZF = W(-30), STEP = 20;
  for (let px = 0; px < w; px++) {
    const xq = Math.round(((px - OX) * 2560) / 74), x = xq / WQ;
    let ybuf = h;
    for (let zq = ZN; zq >= ZF && ybuf > 0; zq -= STEP) {
      const z = zq / WQ;
      let hq = heightQ8(xq, zq);
      const wet = Math.hypot(x - KRX, z - KRZ) < 2.4 && hq < W(LAKE);
      if (wet) hq = W(LAKE);
      const y = OY + Math.round((zq * 56) / 2560) - Math.round((hq * LIFT) / WQ);
      if (y >= ybuf) continue;
      const n = hash(xq >> 5, zq >> 5), hf = hq / WQ;
      let c: RGB;
      if (wet) c = Math.abs(Math.hypot(x - KRX, z - KRZ) - 1.2 + n * 0.3) < 0.12 ? [180, 255, 110] : [111 + n * 20, 200 + n * 24, 58];
      else {
        c = groundColor(x, z, hf, n);
        // światło z północnego zachodu: stok opadający ku południowemu wschodowi jest jaśniejszy
        const s = (heightQ8(xq - 128, zq - 128) - heightQ8(xq + 128, zq + 128)) / WQ;
        let f = 1 + Math.max(-0.5, Math.min(0.5, s * 1.3));
        if (hf > 1.2) f *= 1 - Math.min(0.18, (hf - 1.2) * 0.05); // wyżej ciemniejsza skała
        if (ybuf - y > 2 && ybuf < h) f *= 0.82; // urwisko widziane z przodu
        const j = (n - 0.5) * 14;
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

/** Prostopadłościan na terenie: front (ciemniejszy), dach (jaśniejszy), 1 px cienia po wschodniej krawędzi. */
function boxAt(g: Ctx2D, x: number, z: number, w: number, d: number, hh: number, color: number, elev = 0): BoxRect {
  const h0 = heightQ8(W(x), W(z)) / WQ + elev;
  const x0 = fx(x - w / 2), x1 = Math.max(x0 + 1, fx(x + w / 2));
  const yBase = OY + Math.round((z + d / 2) * KZ) - Math.round(h0 * LIFT);
  const yFront = yBase - Math.max(1, Math.round(hh * LIFT));
  const yTop = Math.min(yFront - 1, OY + Math.round((z - d / 2) * KZ) - Math.round((h0 + hh) * LIFT));
  g.fillStyle = css(color, 0.78);
  g.fillRect(x0, yFront, x1 - x0, yBase - yFront);
  g.fillStyle = css(color, 1.12);
  g.fillRect(x0, yTop, x1 - x0, yFront - yTop);
  g.fillStyle = css(color, 0.55);
  g.fillRect(x1 - 1, yFront, 1, yBase - yFront);
  return { x0, x1, yTop, yFront, yBase };
}

/** Rzędy okien na froncie bryły. */
function windows(g: Ctx2D, b: BoxRect, r: () => number, lit = 0.08): void {
  for (let y = b.yFront + 1; y < b.yBase - 1; y += 2)
    for (let x = b.x0 + 1; x < b.x1 - 1; x += 2) {
      const v = r();
      if (v < 0.25) continue;
      g.fillStyle = v > 1 - lit ? '#ffb050' : '#1a1816';
      g.fillRect(x, y, 1, 1);
    }
}

function cityItems(items: Item[], r: () => number): void {
  const walls = [0x8a5a48, 0x6e6a64, 0x7a7468, 0x6a6058];
  for (let gx = -5; gx <= 5; gx++)
    for (let gz = -4; gz <= 4; gz++) {
      const cx = CX + gx * G, cz = CZ + gz * G, core = Math.exp(-((gx * gx) / 9 + (gz * gz) / 6));
      if (!inCity({ x: W(cx), z: W(cz) }) || PLAZA_CELLS.some(([px, pz]) => px === gx && pz === gz)) continue;
      const kind = r();
      if (kind > 0.3) {
        const nb = 1 + (r() < 0.75 ? 1 : 0) + (r() < 0.35 ? 1 : 0);
        const corners: [number, number][] = [[-1, -1], [1, 1], [1, -1], [-1, 1]].sort(() => r() - 0.5) as [number, number][];
        for (let k = 0; k < nb; k++) {
          const floors = Math.max(1, Math.round(1 + core * 4.5 * r() + (r() < 0.12 ? 3 : 0)));
          const bw = (2 + Math.floor(r() * 2)) * 0.3, bd = (2 + Math.floor(r() * 2)) * 0.3;
          const bx = cx + corners[k][0] * 0.5 + (r() - 0.5) * 0.15, bz = cz + corners[k][1] * 0.5 + (r() - 0.5) * 0.15;
          const col = walls[Math.floor(r() * walls.length)], seed = r(), ruined = r() < 0.5;
          items.push({ key: bz + bd / 2, draw: (g) => {
            const b = boxAt(g, bx, bz, bw, bd, floors * 0.42, col);
            const rr = seeded(Math.floor(seed * 1e6));
            windows(g, b, rr, 0.06);
            if (ruined && b.x1 - b.x0 > 3) {
              // wyłamany narożnik dachu
              g.fillStyle = css(col, 0.5);
              const cw = 1 + Math.floor(rr() * 3);
              g.fillRect(rr() < 0.5 ? b.x0 : b.x1 - cw, b.yTop, cw, 2);
            }
          } });
        }
      }
      // gruz: kupki, kikuty murów
      const nr = kind > 0.3 ? 1 + Math.floor(r() * 2) : 3 + Math.floor(r() * 3);
      for (let k = 0; k < nr; k++) {
        const rx = cx + (r() - 0.5) * 1.5, rz = cz + (r() - 0.5) * 1.5, t = r(), col = walls[k % 4];
        items.push({ key: rz, draw: (g) => {
          if (t < 0.5) {
            const y = groundY(rx, rz);
            g.fillStyle = css(col, 0.9);
            g.fillRect(fx(rx) - 1, y - 1, 3, 1);
            g.fillStyle = css(col, 1.15);
            g.fillRect(fx(rx), y - 2, 1, 1);
          } else boxAt(g, rx, rz, 0.5, 0.1, 0.3 + t * 0.5, col);
        } });
      }
    }
  // wieżowce-szkielety w centrum
  for (const [gx, gz, h, ox, oz] of [[0, 0, 9, 0.5, -0.5], [1, 0, 7, -0.5, 0.5], [0, -1, 6.5, -0.5, 0.5], [-1, 0, 6, 0.5, 0.5], [1, 1, 5.5, 0.5, -0.5], [2, -1, 5, -0.4, -0.4]]) {
    const x = CX + gx * G + ox * 0.55, z = CZ + gz * G + oz * 0.55, hh = h * 0.72;
    items.push({ key: z + 0.48, draw: (g) => {
      const b = boxAt(g, x, z, 0.95, 0.95, hh, 0x55524e);
      windows(g, b, seeded(Math.round(x * 100 + z)), 0.08);
      // przekrzywiony kawał stropu i pręty zbrojeniowe
      g.fillStyle = css(0x55524e, 1.2);
      g.beginPath();
      g.moveTo(b.x0, b.yTop);
      g.lineTo(b.x0 + 4, b.yTop - 3);
      g.lineTo(b.x0 + 6, b.yTop - 2);
      g.lineTo(b.x0 + 3, b.yTop + 1);
      g.fill();
      g.fillStyle = '#6a4030';
      g.fillRect(b.x1 - 2, b.yTop - 3, 1, 3);
      g.fillRect(b.x0 + 2, b.yTop - 2, 1, 2);
    } });
  }
  // wraki na ulicach
  for (let k = 0; k < 18; k++) {
    const gx = Math.round((r() - 0.5) * 10), gz = Math.round((r() - 0.5) * 8), vert = r() < 0.5;
    const x = vert ? CX + (gx + 0.5) * G + (r() - 0.5) * 0.3 : CX + gx * G + (r() - 0.5) * 1.6;
    const z = vert ? CZ + gz * G + (r() - 0.5) * 1.6 : CZ + (gz + 0.5) * G + (r() - 0.5) * 0.3;
    if (!inCity({ x: W(x), z: W(z) })) continue;
    const col = [0x8a3a2a, 0x4a5a6a, 0x7a7a5a, 0x5a4a3a][k % 4];
    items.push({ key: z, draw: (g) => void boxAt(g, x, z, vert ? 0.2 : 0.42, vert ? 0.42 : 0.2, 0.18, col) });
  }
  // brama miasta na końcu alei
  const gx0 = GATE.x / WQ, gz0 = GATE.z / WQ;
  for (const dz of [-0.75, 0.75]) items.push({ key: gz0 + dz + 0.2, draw: (g) => void boxAt(g, gx0, gz0 + dz, 0.4, 0.4, 1.5, 0x5a5048) });
  items.push({ key: gz0 + 0.96, draw: (g) => void boxAt(g, gx0, gz0, 0.2, 1.9, 0.2, 0x4a4038, 1.35) });
  // zawalony wiadukt wjazdowy
  for (let k = 0; k < 6; k++) {
    if (k === 3) continue;
    const x = -15.5 + k, z = 5.9 - k * 0.5, sag = k === 2 || k === 4 ? -0.35 : 0;
    items.push({ key: z + 0.4, draw: (g) => {
      boxAt(g, x, z + 0.25, 0.2, 0.2, 1.2 + sag, 0x5a5450);
      boxAt(g, x, z, 1.8, 0.8, 0.18, 0x6a6460, 1.2 + sag);
    } });
  }
}

function regionItems(items: Item[], r: () => number): void {
  // ---- strefa przemysłowa: hale, kominy z dymem, chłodnia kominowa, kontenery
  for (let k = 0; k < 6; k++) {
    const x = 9 + (k % 3) * 2.2 + (r() - 0.5) * 0.4, z = -11 + Math.floor(k / 3) * 2.4, h = 0.8 + r() * 0.6, col = [0x7a4a30, 0x5a4a40, 0x6a5040][k % 3];
    items.push({ key: z + 0.6, draw: (g) => {
      const b = boxAt(g, x, z, 1.7, 1.2, h, col);
      g.fillStyle = css(col, 0.6);
      for (let xx = b.x0 + 1; xx < b.x1 - 1; xx += 3) g.fillRect(xx, b.yTop + 1, 2, 1);
    } });
  }
  for (const [x, z, h] of [[9.4, -12.2, 3.2], [12.6, -12.4, 3.8], [14.2, -9.8, 2.8]]) {
    items.push({ key: z + 0.2, draw: (g) => {
      const b = boxAt(g, x, z, 0.42, 0.42, h, 0x7a3a2a);
      g.fillStyle = '#d8d0c0';
      g.fillRect(b.x0, b.yFront + 2, b.x1 - b.x0, 1);
      for (let i = 0; i < 5; i++) {
        g.fillStyle = `rgba(150,140,130,${0.5 - i * 0.08})`;
        g.beginPath();
        g.arc(b.x0 + 1 + i * 3, b.yTop - 3 - i * 3, 2 + i, 0, Math.PI * 2);
        g.fill();
      }
    } });
  }
  {
    const x = 16.8, z = -12.6;
    items.push({ key: z + 1, draw: (g) => {
      // chłodnia: hiperboloida jako wielokąt z talią
      const cx = fx(x), yb = groundY(x, z + 1), hh = 2.6 * LIFT, rb = 1.0 * KX;
      g.fillStyle = '#7a746a';
      g.beginPath();
      g.moveTo(cx - rb, yb);
      g.quadraticCurveTo(cx - rb * 0.45, yb - hh * 0.6, cx - rb * 0.62, yb - hh);
      g.lineTo(cx + rb * 0.62, yb - hh);
      g.quadraticCurveTo(cx + rb * 0.45, yb - hh * 0.6, cx + rb, yb);
      g.fill();
      g.fillStyle = '#9a948a';
      g.fillRect(cx - rb * 0.5, yb - hh * 0.75, rb * 0.5, hh * 0.6);
      g.fillStyle = '#2a2624';
      g.fillRect(cx - rb * 0.62 + 1, yb - hh - 1, rb * 1.24 - 2, 2);
    } });
  }
  for (let k = 0; k < 8; k++) {
    const x = 8 + r() * 6, z = -7.6 + r() * 1.2, col = [0xa04a2a, 0x2a6a8a, 0x8a8a3a, 0x5a6a4a][k % 4], up = k > 5 ? 0.38 : 0;
    items.push({ key: z + 0.2 + up * 0.01, draw: (g) => void boxAt(g, x, z, 0.9, 0.38, 0.38, col, up) });
  }
  // beczki wokół krateru
  for (let k = 0; k < 6; k++) {
    const a = k * 1.05, x = KRX + Math.cos(a) * 3.1, z = KRZ + Math.sin(a) * 2.9;
    items.push({ key: z, draw: (g) => void boxAt(g, x, z, 0.22, 0.22, 0.3, 0x6a8a2a) });
  }
  // ---- góry: wejście do bunkra i maszt (latarnia migająca rysowana w scenie)
  items.push({ key: -7.2 + 0.25, draw: (g) => {
    const b = boxAt(g, -12, -7.2, 1.6, 0.5, 1.1, 0x5a5a5e);
    g.fillStyle = '#0a0a0c';
    g.fillRect(b.x0 + 3, b.yFront + 2, b.x1 - b.x0 - 6, b.yBase - b.yFront - 2);
    g.fillStyle = '#c0a030';
    for (let xx = b.x0; xx < b.x1; xx += 2) g.fillRect(xx, b.yFront, 1, 1);
  } });
  items.push({ key: -7.8, draw: (g) => void boxAt(g, -10.8, -7.8, 0.12, 0.12, 3, 0x8a8a8a) });
  // ---- pustkowia: obóz Nomadów (namioty, wozy), szkielet olbrzyma
  for (let k = 0; k < 5; k++) {
    const a = k * 1.25, x = 22 + Math.cos(a) * 1.4, z = 9.5 + Math.sin(a) * 1.1, col = [0xc8a468, 0x9a6a3a, 0xb88a54][k % 3];
    items.push({ key: z, draw: (g) => {
      const cx = fx(x), y = groundY(x, z);
      g.fillStyle = css(col);
      g.beginPath();
      g.moveTo(cx - 4, y);
      g.lineTo(cx, y - 5);
      g.lineTo(cx + 4, y);
      g.fill();
      g.fillStyle = css(col, 0.7);
      g.beginPath();
      g.moveTo(cx, y - 5);
      g.lineTo(cx + 4, y);
      g.lineTo(cx + 1, y);
      g.fill();
      g.fillStyle = '#2a1a10';
      g.fillRect(cx - 1, y - 2, 1, 2);
    } });
  }
  for (let k = 0; k < 3; k++) {
    const x = 24.2 + k * 0.9, z = 8.1 + k * 0.6;
    items.push({ key: z + 0.2, draw: (g) => {
      const b = boxAt(g, x, z, 0.9, 0.45, 0.35, 0x6a4a2a);
      g.fillStyle = '#d8c8a0';
      g.fillRect(b.x0 + 1, b.yTop - 2, b.x1 - b.x0 - 2, 3);
    } });
  }
  items.push({ key: 16.5, draw: (g) => {
    g.strokeStyle = '#e6dcc0';
    g.lineWidth = 1;
    for (let k = 0; k < 7; k++) {
      const x = fx(25 + k * 0.32), y = groundY(25 + k * 0.32, 16.5), rr = 4 - Math.abs(k - 3) * 0.5;
      g.beginPath();
      g.arc(x + 0.5, y, rr, Math.PI, Math.PI * 2);
      g.stroke();
    }
    g.fillStyle = '#e6dcc0';
    g.fillRect(fx(24.6) - 2, groundY(24.6, 16.5) - 3, 4, 3);
  } });
  // ---- Przystań: mur dookoła, chaty, lokomotywa, wieże
  for (let k = 0; k < 24; k++) {
    if (k === 6) continue;
    const a = (k / 24) * Math.PI * 2, x = HX + Math.cos(a) * 2.6, z = HZ + Math.sin(a) * 1.9;
    items.push({ key: z + 0.1, draw: (g) => void boxAt(g, x, z, 0.62, 0.2, 0.55, 0x6a5a46) });
  }
  for (let k = 0; k < 5; k++) {
    const x = HX - 1.4 + k * 0.7, z = HZ + (k % 2 ? 0.7 : -0.6), col = [0x7a6a52, 0x5a4a3a, 0x8a6a4a][k % 3];
    items.push({ key: z + 0.28, draw: (g) => {
      const b = boxAt(g, x, z, 0.62, 0.5, 0.45, col);
      g.fillStyle = '#5a3a28';
      g.beginPath();
      g.moveTo(b.x0 - 1, b.yTop + 1);
      g.lineTo((b.x0 + b.x1) / 2, b.yTop - 2);
      g.lineTo(b.x1 + 1, b.yTop + 1);
      g.fill();
    } });
  }
  items.push({ key: HZ + 0.3, draw: (g) => {
    const b = boxAt(g, HX + 0.3, HZ + 0.05, 1.6, 0.45, 0.5, 0x3a4a3a);
    boxAt(g, HX + 0.9, HZ + 0.05, 0.5, 0.45, 0.4, 0x2a3a2a, 0.5);
    g.fillStyle = '#c04030';
    g.fillRect(b.x0, b.yFront + 1, b.x1 - b.x0 - 4, 1);
  } });
  for (const [dx, dz] of [[-2.4, -1.2], [2.3, 1.1]]) items.push({ key: HZ + dz + 0.15, draw: (g) => void boxAt(g, HX + dx, HZ + dz, 0.3, 0.3, 1.4, 0x5a4a3a) });
}

/** Autostrada Przystań -> brama (te same próbki co trasa do ruin), z ubytkami asfaltu, linią środkową i słupami. */
function paintHighway(g: Ctx2D, items: Item[]): void {
  const rt = buildRoute(PLAZAS[0], 'ruins', 0), n = rt.trackFrom;
  const P = (i: number): [number, number] => [scrX(rt.x[i]), scrY(rt.x[i], rt.z[i])];
  for (let i = 0; i < n; i++) {
    if (i % 40 === 18 || i % 40 === 31) continue; // zapadnięte fragmenty
    const [ax, ay] = P(i), [bx, by] = P(i + 1);
    g.strokeStyle = '#3a3634';
    g.lineWidth = 5;
    g.beginPath();
    g.moveTo(ax, ay);
    g.lineTo(bx, by);
    g.stroke();
  }
  g.fillStyle = '#d8c070';
  for (let i = 2; i < n; i += 4) {
    const [x, y] = P(i);
    g.fillRect(x, y, 2, 1);
  }
  for (let i = 6; i < n - 2; i += 16) {
    const x = rt.x[i] / WQ, z = rt.z[i] / WQ + 0.8, lean = i === 54;
    items.push({ key: z, draw: (gg) => {
      const cx = fx(x), y = groundY(x, z);
      gg.fillStyle = '#4a4a4e';
      if (lean) {
        gg.fillRect(cx, y - 2, 6, 1);
        gg.fillRect(cx + 5, y - 4, 1, 3);
      } else {
        gg.fillRect(cx, y - 13, 1, 13);
        gg.fillRect(cx - 3, y - 12, 7, 1);
      }
    } });
  }
}

/** Obrysy sektorów: przerywane elipsy w kolorze sektora, położone na terenie. */
function paintSectorOutlines(g: Ctx2D): void {
  for (const s of SECTORS) {
    const N = Math.round(((s.rx + s.rz) / WQ) * 3.2);
    g.fillStyle = css(s.color);
    g.globalAlpha = 0.55;
    for (let k = 0; k < N; k += 2)
      for (let t = 0; t < 4; t++) {
        const a = ((k + t / 4) / N) * Math.PI * 2, x = s.x + Math.cos(a) * s.rx, z = s.z + Math.sin(a) * s.rz;
        g.fillRect(scrX(x), scrY(Math.round(x), Math.round(z)), 2, 1);
      }
    g.globalAlpha = 1;
  }
  // place w mieście: jasny bruk z dwoma słupkami
  for (const p of PLAZAS) {
    const x = p.x / WQ, z = p.z / WQ;
    g.fillStyle = '#9a9284';
    g.fillRect(fx(x - 0.85), groundY(x, z - 0.85), Math.round(1.7 * KX), Math.round(1.7 * KZ));
    g.fillStyle = '#7a7264';
    g.fillRect(fx(x - 0.85), groundY(x, z + 0.85) - 1, Math.round(1.7 * KX), 1);
  }
}

/** Roślinność i kamienie według stref (port reguł flory z worldterrain.js w skali mapy). */
function floraItems(items: Item[], r: () => number): void {
  for (let i = 0; i < 300; i++) {
    const x = -32 + r() * 64, z = -20 + r() * 42, t = r(), v = r();
    if (g2(x, z, HX, HZ, 3, 2.4) > 0.4) continue;
    const h = heightQ8(W(x), W(z)) / WQ, dc = Math.hypot(x - KRX, z - KRZ), dr = riverDistF(x, z);
    if (h > 4.2 || dc < 2.6) continue;
    const city = inCity({ x: W(x), z: W(z) });
    if (city && t > 0.12) continue;
    let kind: 'grass' | 'bush' | 'tree' | 'cactus' | 'shroom' | 'rock' | 'crystal';
    if (city) kind = 'grass';
    else if (dc < 7) kind = v < 0.6 ? 'shroom' : 'grass';
    else if (h > 1.7) kind = v < 0.6 ? 'rock' : v < 0.68 ? 'crystal' : 'tree';
    else if (dr < 2.4) kind = v < 0.5 ? 'grass' : 'bush';
    else if (x > 15) kind = v < 0.55 ? 'cactus' : v < 0.8 ? 'bush' : 'rock';
    else kind = v < 0.35 ? 'grass' : v < 0.6 ? 'bush' : v < 0.85 ? 'tree' : 'rock';
    items.push({ key: z, draw: (g) => {
      const cx = fx(x), y = groundY(x, z);
      switch (kind) {
        case 'grass':
          g.fillStyle = v < 0.5 ? '#a08a4a' : '#7a6a38';
          for (let k = 0; k < 4; k++) g.fillRect(cx + k - 2, y - (k % 2 ? 3 : 2), 1, k % 2 ? 3 : 2);
          break;
        case 'bush':
          g.fillStyle = '#4a4a2a';
          g.fillRect(cx - 2, y - 2, 5, 2);
          g.fillStyle = t < 0.3 ? '#6a7a3a' : '#5a5232';
          g.fillRect(cx - 1, y - 3, 3, 2);
          break;
        case 'tree':
          g.fillStyle = '#3a2a1e';
          g.fillRect(cx, y - 7, 1, 7);
          g.fillRect(cx - 2, y - 6, 2, 1);
          g.fillRect(cx + 1, y - 5, 2, 1);
          g.fillRect(cx - 3, y - 7, 1, 1);
          break;
        case 'cactus':
          g.fillStyle = t < 0.5 ? '#5a7a3a' : '#7a8a4a';
          g.fillRect(cx, y - 5, 2, 5);
          g.fillRect(cx - 2, y - 4, 1, 2);
          g.fillRect(cx - 1, y - 3, 1, 1);
          g.fillRect(cx + 2, y - 3, 1, 1);
          g.fillRect(cx + 3, y - 4, 1, 2);
          break;
        case 'shroom':
          g.fillStyle = '#6a5a3a';
          g.fillRect(cx, y - 2, 1, 2);
          g.fillStyle = v < 0.3 ? '#c8ff60' : '#9adf50';
          g.fillRect(cx - 1, y - 3, 3, 1);
          break;
        case 'rock':
          g.fillStyle = '#6a5a4a';
          g.fillRect(cx - 2, y - 2, 4, 2);
          g.fillStyle = '#8a7a6a';
          g.fillRect(cx - 1, y - 3, 2, 1);
          break;
        case 'crystal':
          g.fillStyle = '#7ad0ff';
          g.fillRect(cx, y - 4, 1, 4);
          g.fillStyle = '#c0f0ff';
          g.fillRect(cx + 1, y - 2, 1, 2);
          break;
      }
    } });
  }
}

/** Maluje całą mapę regionu do tekstury `key` (BASE_W x BASE_H). */
export function paintRegion(scene: Phaser.Scene, key: string, w: number, h: number): void {
  canvasTexture(scene, key, w, h, (g) => {
    paintTerrain(g, w, h);
    const items: Item[] = [];
    paintSectorOutlines(g);
    paintHighway(g, items);
    const r = seeded(3);
    cityItems(items, r);
    regionItems(items, r);
    floraItems(items, seeded(31));
    items.sort((a, b) => a.key - b.key);
    for (const it of items) it.draw(g);
    const grad = g.createRadialGradient(w / 2, h / 2, h * 0.38, w / 2, h / 2, h * 0.98);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(24,10,4,0.55)');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
  });
}

/** Miejsca animowanych ognisk (miasto, obóz Nomadów, Przystań) i latarni bunkra - w pikselach ekranu. */
export function regionFires(): { x: number; y: number; size: number }[] {
  const pts: [number, number, number][] = [[1, -1, 0.3], [-2, 1, 0.3], [3, 2, 0.3], [-1, -3, 0.3], [4, 0, 0.3]];
  const out = pts.map(([gx, gz, s]) => {
    const x = CX + gx * G + 0.6, z = CZ + gz * G - 0.6;
    return { x: fx(x), y: groundY(x, z), size: s };
  });
  out.push({ x: fx(22), y: groundY(22, 9.5), size: 0.4 }, { x: fx(HX - 0.4), y: groundY(HX - 0.4, HZ + 0.05), size: 0.35 });
  return out;
}

/** Czubek masztu przy bunkrze (czerwona latarnia). */
export const beaconPos = (): { x: number; y: number } => ({ x: fx(-10.8), y: groundY(-10.8, -7.8, 3) - 1 });
