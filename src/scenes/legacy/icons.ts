// @ts-nocheck
// Ikony przedmiotów i zdolności - rozwinięcie Oldgame/src/gfx/icons.js (rysowanie na płótnie 2D, bez Three.js). Nie jest sprawdzany typami.
// Rysunki są projektowane na siatce 32x32 (przedmioty) i 24x24 (odznaki zdolności), ale malowane NATYWNIE w docelowym
// rozmiarze: pędzel SPix przelicza każdy prostokąt / linię / elipsę na siatkę wyjściową, więc nie ma skalowania
// najbliższym sąsiadem o niecałkowity współczynnik (które gubi wiersze i kolumny pikseli).
// Dopasowanie: najpierw dokładna nazwa ikony (pole `icon` przedmiotu, tabela AB_ID dla zdolności), potem słowa kluczowe.
import { mkCanvas, shade, parseHex } from './util';

const norm = (s) => String(s || '').toLowerCase().replace(/ą/g, 'a').replace(/ć/g, 'c').replace(/ę/g, 'e').replace(/ł/g, 'l').replace(/ń/g, 'n').replace(/ó/g, 'o').replace(/ś/g, 's').replace(/ź|ż/g, 'z');
const cache = new Map();

/** Pędzel skalujący: współrzędne projektowe (siatka D) -> piksele płótna o boku T (s = T / D). */
class SPix {
  constructor(g, s) { this.g = g; this.s = s; }
  X(v) { return Math.round(v * this.s); }
  r(x, y, w, h, c) {
    if (!c) return;
    let x0 = this.X(x), y0 = this.X(y), x1 = this.X(x + w), y1 = this.X(y + h);
    if (w > 0 && x1 <= x0) x1 = x0 + 1;
    if (h > 0 && y1 <= y0) y1 = y0 + 1;
    this.g.fillStyle = c; this.g.fillRect(x0, y0, x1 - x0, y1 - y0);
  }
  px(x, y, c) { this.r(x, y, 1, 1, c); }
  clr(x, y, w, h) { this.g.clearRect(this.X(x), this.X(y), Math.max(1, this.X(x + w) - this.X(x)), Math.max(1, this.X(y + h) - this.X(y))); }
  line(x0, y0, x1, y1, c, t = 1) {
    const s = this.s, T = Math.max(1, Math.round(t * s));
    x0 = Math.round((x0 + 0.5) * s - 0.5); y0 = Math.round((y0 + 0.5) * s - 0.5); x1 = Math.round((x1 + 0.5) * s - 0.5); y1 = Math.round((y1 + 0.5) * s - 0.5);
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1; let e = dx + dy;
    this.g.fillStyle = c; const o = -(T >> 1);
    for (let i = 0; i < 2000; i++) {
      this.g.fillRect(x0 + o, y0 + o, T, T);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * e; if (e2 >= dy) { e += dy; x0 += sx; } if (e2 <= dx) { e += dx; y0 += sy; }
    }
  }
  /** Elipsa o środku piksela (cx, cy) i promieniach rx, ry (jak Pix.ell z util.js). */
  ell(cx, cy, rx, ry, c, clear = false) {
    const s = this.s, Cx = (cx + 0.5) * s, Cy = (cy + 0.5) * s, Rx = (rx + 0.5) * s, Ry = (ry + 0.5) * s;
    this.g.fillStyle = c;
    for (let py = Math.floor(Cy - Ry); py <= Math.ceil(Cy + Ry); py++) {
      const dy = (py + 0.5 - Cy) / Ry; if (Math.abs(dy) > 1) continue;
      const w = Rx * Math.sqrt(1 - dy * dy), xa = Math.round(Cx - w), xb = Math.round(Cx + w);
      if (xb > xa) clear ? this.g.clearRect(xa, py, xb - xa, 1) : this.g.fillRect(xa, py, xb - xa, 1);
    }
  }
  cell(cx, cy, rx, ry) { this.ell(cx, cy, rx, ry, '#000', true); }
  /** Wielokąt (wierzchołki w jednostkach projektowych, krawędzie pikseli). */
  poly(pts, c) {
    const s = this.s, P = pts.map(([x, y]) => [x * s, y * s]);
    const ys = P.map((p) => p[1]), y0 = Math.floor(Math.min(...ys)), y1 = Math.ceil(Math.max(...ys));
    this.g.fillStyle = c;
    for (let py = y0; py < y1; py++) {
      const yc = py + 0.5, xs = [];
      for (let i = 0; i < P.length; i++) {
        const [ax, ay] = P[i], [bx, by] = P[(i + 1) % P.length];
        if ((ay <= yc && by > yc) || (by <= yc && ay > yc)) xs.push(ax + (yc - ay) / (by - ay) * (bx - ax));
      }
      xs.sort((a, b) => a - b);
      for (let i = 0; i + 1 < xs.length; i += 2) { const xa = Math.round(xs[i]), xb = Math.round(xs[i + 1]); if (xb > xa) this.g.fillRect(xa, py, xb - xa, 1); }
    }
  }
}

/** Binaryzacja alfy + obrys o grubości th (piksele wyjściowe). */
function outline(g, T, col, th = 1) {
  const id = g.getImageData(0, 0, T, T), d = id.data, [or, og, ob] = parseHex(col);
  let op = new Uint8Array(T * T);
  for (let i = 0; i < T * T; i++) { if (d[i * 4 + 3] > 110) { op[i] = 1; d[i * 4 + 3] = 255; } else d[i * 4 + 3] = 0; }
  for (let pass = 0; pass < th; pass++) {
    const nx = op.slice();
    for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
      const i = y * T + x; if (op[i]) continue;
      if ((x > 0 && op[i - 1]) || (x < T - 1 && op[i + 1]) || (y > 0 && op[i - T]) || (y < T - 1 && op[i + T])) { d[i * 4] = or; d[i * 4 + 1] = og; d[i * 4 + 2] = ob; d[i * 4 + 3] = 255; nx[i] = 1; }
    }
    op = nx;
  }
  g.putImageData(id, 0, 0);
}

// metal bar helper: horizontal bar with top highlight and bottom shade
function bar(p, x, y, w, h, c) { p.r(x, y, w, h, c); p.r(x, y, w, 1, shade(c, 1.5)); if (h > 2) p.r(x, y + h - 1, w, 1, shade(c, 0.6)); }
function vbar(p, x, y, w, h, c) { p.r(x, y, w, h, c); p.r(x, y, 1, h, shade(c, 1.45)); if (w > 2) p.r(x + w - 1, y, 1, h, shade(c, 0.6)); }
const STEEL = '#8a929a', DARK = '#3c4249', WOOD = '#7a4a28', BRASS = '#c9a043', RUST = '#a4562c';

const ITEM = {
  // ---- broń
  pistol(p) { bar(p, 6, 10, 18, 5, '#8a929a'); bar(p, 24, 11, 3, 3, DARK); p.r(10, 10, 8, 1, '#c0c8cc'); vbar(p, 8, 15, 5, 9, WOOD); p.r(8, 22, 5, 2, shade(WOOD, 0.6)); p.r(13, 15, 4, 1, DARK); p.r(14, 16, 1, 3, DARK); p.r(6, 9, 2, 1, DARK); p.r(22, 9, 2, 1, DARK); },
  revolver(p) { bar(p, 12, 11, 16, 3, '#9aa2aa'); p.r(27, 10, 1, 1, DARK); vbar(p, 6, 15, 6, 10, '#5a3418'); p.r(7, 16, 1, 7, '#8a5a30'); p.r(5, 23, 7, 2, '#3a2010'); bar(p, 6, 10, 7, 5, '#6a727a'); p.ell(14, 13, 4, 4, '#7a828a'); p.ell(14, 13, 3, 3, '#5a626a'); for (const [x, y] of [[13, 11], [16, 13], [13, 15], [11, 13]]) p.px(x, y, '#1e2226'); p.px(13, 10, '#d8e0e4'); p.r(7, 8, 3, 2, DARK); p.r(11, 17, 4, 1, DARK); p.r(14, 18, 1, 3, DARK); },
  rifle(p) { vbar(p, 2, 13, 8, 7, WOOD); p.r(2, 19, 8, 1, shade(WOOD, 0.55)); bar(p, 10, 12, 10, 4, DARK); bar(p, 20, 13, 10, 2, STEEL); vbar(p, 14, 16, 3, 7, '#2a2f34'); p.r(12, 10, 6, 2, '#4a525a'); p.px(29, 12, '#aab'); p.r(20, 11, 1, 2, DARK); },
  sniper(p) { vbar(p, 1, 14, 9, 6, '#8a5a30'); p.r(1, 19, 6, 2, '#6a4020'); p.r(2, 15, 6, 1, '#b07a44'); bar(p, 10, 13, 9, 4, '#6a4424'); bar(p, 19, 14, 12, 2, STEEL); p.r(30, 13, 1, 1, DARK); bar(p, 10, 8, 11, 3, '#2a2f34'); p.r(9, 7, 2, 5, '#1e2226'); p.r(20, 7, 2, 5, '#1e2226'); p.r(10, 9, 2, 1, '#6ac4e8'); p.r(13, 11, 1, 2, DARK); p.r(17, 11, 1, 2, DARK); p.r(12, 17, 4, 1, DARK); p.r(14, 18, 1, 2, DARK); p.line(24, 16, 22, 22, DARK, 1); p.line(24, 16, 27, 22, DARK, 1); },
  assault(p) { vbar(p, 2, 13, 7, 6, WOOD); p.r(2, 18, 4, 2, shade(WOOD, 0.7)); bar(p, 9, 11, 11, 5, '#3c4249'); bar(p, 20, 12, 6, 3, WOOD); bar(p, 26, 12, 5, 2, STEEL); p.r(28, 10, 1, 2, DARK); p.r(10, 10, 8, 1, '#6a727a'); p.r(15, 16, 4, 3, '#2a2f34'); p.r(16, 19, 4, 3, '#2a2f34'); p.r(17, 22, 4, 3, '#2a2f34'); p.r(15, 16, 1, 3, '#5a626a'); p.r(16, 19, 1, 3, '#5a626a'); p.r(17, 22, 1, 3, '#5a626a'); p.r(11, 16, 3, 6, '#4a2c18'); p.r(24, 11, 2, 1, DARK); },
  shotgun(p) { vbar(p, 2, 13, 9, 7, shade(WOOD, 0.9)); bar(p, 11, 12, 18, 3, STEEL); bar(p, 11, 15, 18, 2, DARK); vbar(p, 17, 17, 6, 3, WOOD); p.r(16, 17, 8, 1, shade(WOOD, 0.5)); p.px(29, 12, '#ddd'); },
  sawedoff(p) { p.line(4, 25, 9, 17, WOOD, 4); p.line(3, 24, 8, 16, '#a8703a', 1); p.r(3, 25, 4, 2, '#3a2010'); bar(p, 9, 12, 15, 3, STEEL); bar(p, 9, 15, 15, 3, '#6a727a'); p.r(9, 15, 15, 1, DARK); p.r(23, 12, 2, 6, DARK); p.px(24, 13, '#0e1012'); p.px(24, 16, '#0e1012'); vbar(p, 13, 18, 8, 2, WOOD); p.r(8, 10, 2, 2, DARK); p.r(10, 18, 3, 3, DARK); p.px(11, 19, 0); },
  smg(p) { bar(p, 5, 11, 17, 5, '#555d66'); bar(p, 22, 12, 7, 2, STEEL); vbar(p, 12, 16, 4, 10, '#2a2f34'); vbar(p, 7, 16, 4, 6, DARK); p.r(2, 12, 4, 3, DARK); p.r(8, 10, 8, 1, '#8a929a'); p.r(18, 12, 2, 2, '#d8a030'); },
  laser_pistol(p) { bar(p, 4, 11, 16, 6, '#e8e4d8'); bar(p, 20, 12, 8, 3, '#46f2c8'); p.r(5, 12, 10, 1, '#fff'); vbar(p, 7, 17, 5, 7, '#c8c4b8'); p.r(14, 13, 4, 2, '#2a8a78'); p.r(28, 13, 2, 1, '#bffff0'); p.px(10, 14, '#46f2c8'); p.r(20, 10, 4, 1, '#2a8a78'); },
  laser_rifle(p) { bar(p, 1, 12, 9, 6, '#c8c4b8'); p.r(1, 17, 5, 3, '#a8a498'); bar(p, 10, 11, 13, 6, '#e8e4d8'); p.r(11, 12, 10, 1, '#fff'); for (let k = 0; k < 3; k++) p.r(13 + k * 3, 13, 2, 3, '#46f2c8'); bar(p, 23, 12, 6, 3, '#8a929a'); p.r(29, 12, 2, 3, '#46f2c8'); p.px(31, 13, '#bffff0'); vbar(p, 12, 17, 4, 6, '#c8c4b8'); bar(p, 13, 8, 7, 2, '#2a8a78'); p.r(14, 10, 1, 1, DARK); p.r(18, 10, 1, 1, DARK); },
  bow(p) { p.line(10, 4, 20, 16, WOOD, 2); p.line(20, 16, 10, 28, WOOD, 2); p.line(10, 4, 10, 28, '#e6dcc0', 1); p.line(11, 16, 26, 16, '#c9a043', 1); p.px(27, 16, '#ddd'); p.r(24, 15, 2, 3, '#ccc'); p.r(7, 15, 4, 3, '#e8e2d0'); },
  crossbow(p) { vbar(p, 3, 14, 10, 5, WOOD); p.r(2, 13, 3, 7, shade(WOOD, 0.7)); bar(p, 12, 14, 15, 3, '#5a3a20'); p.line(24, 4, 27, 15, '#3c4249', 2); p.line(27, 16, 24, 27, '#3c4249', 2); p.line(24, 4, 16, 15, '#e6dcc0', 1); p.line(16, 15, 24, 27, '#e6dcc0', 1); p.line(13, 14, 29, 14, '#c9a043', 1); p.r(29, 13, 2, 3, '#d8e0e4'); p.r(9, 19, 2, 4, DARK); p.r(26, 14, 3, 3, '#5a626a'); },
  knife(p) { p.line(8, 24, 25, 7, '#d8e0e4', 4); p.line(8, 24, 25, 7, '#fff', 1); p.line(9, 25, 26, 8, '#8a929a', 1); p.line(6, 26, 10, 22, '#4a2c18', 4); p.r(10, 21, 4, 4, '#2a2f34'); p.px(24, 7, '#fff'); },
  machete(p) { p.line(10, 22, 26, 5, '#c8d0d4', 5); p.line(10, 22, 26, 5, '#f4f8fa', 2); p.line(12, 24, 27, 7, '#7a828a', 1); p.line(5, 27, 10, 22, '#4a2c18', 4); p.r(8, 21, 5, 4, '#2a2f34'); p.px(20, 14, RUST); p.px(17, 17, RUST); },
  monoblade(p) { p.line(9, 23, 28, 4, '#2a3a44', 3); p.line(9, 23, 28, 4, '#bfe8f0', 1); p.line(10, 23, 28, 5, '#46f2c8', 1); p.px(29, 3, '#fff'); p.line(5, 20, 12, 27, '#5a626a', 2); p.line(3, 29, 8, 24, '#1e2428', 3); p.px(4, 28, '#46f2c8'); p.px(6, 26, '#46f2c8'); },
  pipe(p) { p.line(6, 26, 25, 7, RUST, 5); p.line(5, 25, 24, 6, '#d08a50', 1); p.line(7, 27, 26, 8, shade(RUST, 0.55), 1); p.r(23, 4, 5, 5, '#6a3a1c'); p.px(26, 3, '#ccc'); p.px(28, 6, '#ccc'); p.px(22, 4, '#ccc'); },
  hammer(p) { p.line(7, 27, 21, 11, WOOD, 3); p.line(6, 26, 20, 10, '#a8703a', 1); p.r(16, 4, 12, 9, '#777f88'); p.r(16, 4, 12, 2, '#c0c8cc'); p.r(16, 11, 12, 2, '#444b52'); p.r(14, 6, 2, 5, '#444b52'); p.px(27, 5, '#fff'); },
  axe(p) { p.line(7, 27, 22, 6, '#b8342a', 3); p.line(6, 26, 21, 5, '#e05a48', 1); p.r(15, 4, 12, 9, '#8a929a'); p.r(22, 6, 6, 6, '#d0d8dc'); p.r(15, 4, 12, 1, '#c0c8cc'); p.r(26, 8, 3, 3, '#e8f0f4'); p.r(11, 5, 4, 5, '#5a626a'); },
  scythe(p) { p.line(8, 28, 20, 5, '#3a2418', 2); p.line(20, 5, 28, 8, '#dde4e8', 3); p.line(28, 8, 26, 14, '#aab', 2); },
  fist(p) { for (let k = 0; k < 4; k++) { p.r(8 + k * 4, 8, 4, 7, '#e0b088'); p.r(8 + k * 4, 8, 4, 1, '#f8d8b8'); p.r(11 + k * 4, 9, 1, 5, '#a87850'); } p.r(8, 14, 16, 9, '#d8a078'); p.r(4, 13, 6, 5, '#e0b088'); p.r(6, 16, 8, 3, '#c89068'); p.r(9, 22, 14, 6, '#e8e2d0'); p.r(9, 24, 14, 1, '#b8b2a0'); p.r(9, 26, 14, 1, '#b8b2a0'); },
  // ---- pancerze i tarcze
  armor(p) { p.r(7, 7, 18, 20, '#6a7a52'); p.r(7, 7, 18, 3, '#8a9a6a'); p.r(2, 7, 7, 6, '#586444'); p.r(23, 7, 7, 6, '#586444'); p.r(12, 5, 8, 3, '#2a2a20'); p.r(9, 14, 5, 5, '#586444'); p.r(18, 14, 5, 5, '#586444'); p.r(7, 22, 18, 3, '#3a4230'); p.px(15, 12, '#c9a043'); },
  leather(p) { const L = '#7a4a2a', Ld = '#5a321a', Lh = '#9a6a3e'; p.r(8, 7, 16, 20, L); p.r(3, 8, 6, 15, Ld); p.r(23, 8, 6, 15, Ld); p.r(3, 21, 5, 3, '#3a2010'); p.r(24, 21, 5, 3, '#3a2010'); p.line(10, 5, 15, 11, Lh, 2); p.line(22, 5, 17, 11, Lh, 2); p.r(16, 10, 1, 17, '#c9a043'); p.r(9, 18, 5, 1, Ld); p.r(19, 18, 5, 1, Ld); p.r(8, 7, 2, 20, Lh); p.r(8, 25, 16, 2, '#4a2a14'); p.r(4, 10, 3, 3, '#a83a2a'); p.r(3, 8, 6, 1, Lh); p.r(23, 8, 6, 1, Lh); },
  cloak(p) { const C = '#a08860', Cd = '#76603e', Ch = '#c8b080'; for (let y = 12; y < 29; y++) { const w = 7 + (y - 12) * 0.55; p.r(16 - w, y, w * 2, 1, C); } p.ell(16, 8, 6, 6, C); p.ell(16, 9, 3, 4, '#241a12'); p.px(14, 9, '#e8b860'); p.px(18, 9, '#e8b860'); p.line(12, 14, 8, 28, Cd, 1); p.line(20, 14, 24, 28, Cd, 1); p.line(16, 17, 16, 28, Cd, 1); p.r(10, 13, 12, 3, '#a83a2a'); p.r(18, 15, 3, 5, '#8a2a1a'); for (let x = 7; x < 26; x += 2) p.px(x, 28, Cd); p.line(15, 2, 11, 6, Ch, 1); p.line(7, 27, 11, 16, Ch, 1); },
  scrap_armor(p) { p.r(7, 6, 18, 20, '#5e5850'); p.r(2, 6, 6, 6, '#5a5248'); p.r(24, 6, 6, 6, RUST); p.r(12, 4, 8, 3, '#2a2420'); const plate = (x, y, w, h, c) => { p.r(x, y, w, h, c); p.r(x, y, w, 1, shade(c, 1.45)); p.r(x, y + h - 1, w, 1, shade(c, 0.6)); p.px(x + 1, y + 1, '#d8d0c0'); p.px(x + w - 2, y + 1, '#d8d0c0'); }; plate(8, 7, 8, 8, '#8a8478'); plate(17, 8, 7, 7, RUST); plate(9, 16, 6, 8, '#7a6a52'); plate(16, 16, 8, 8, '#8a929a'); p.line(8, 6, 24, 25, '#3a2a1a', 2); p.px(16, 15, BRASS); p.px(21, 20, '#3a2a1a'); },
  scrap_plate(p) { p.r(6, 6, 20, 21, '#4a4e52'); bar(p, 8, 7, 16, 11, '#9aa0a6'); p.r(10, 9, 7, 5, '#c8a020'); p.r(10, 9, 7, 1, '#f0d060'); p.px(12, 11, '#2a2420'); p.px(14, 11, '#2a2420'); p.r(8, 19, 5, 7, '#7a8086'); p.r(14, 19, 5, 7, '#7a8086'); p.r(20, 19, 4, 7, '#7a8086'); p.r(8, 19, 16, 1, '#b0b6bc'); p.ell(5, 9, 4, 4, '#8a9096'); p.ell(26, 9, 4, 4, '#8a9096'); p.r(3, 6, 3, 1, '#d0d6da'); p.r(25, 6, 3, 1, '#d0d6da'); p.r(4, 2, 1, 3, '#d0d6da'); p.r(27, 2, 1, 3, '#d0d6da'); for (const x of [9, 22]) for (const y of [8, 16]) p.px(x, y, '#3a3e42'); p.px(19, 12, RUST); p.px(20, 13, RUST); },
  vest(p) { const V = '#2e3a48', Vd = '#1e2630', Vh = '#4e5e70'; p.r(9, 4, 4, 5, V); p.r(19, 4, 4, 5, V); p.r(7, 9, 18, 18, V); p.r(9, 4, 4, 1, Vh); p.r(19, 4, 4, 1, Vh); p.r(7, 9, 1, 18, Vh); p.r(24, 9, 1, 18, Vd); for (const y of [13, 16]) p.r(8, y, 16, 1, Vd); for (const x of [9, 14, 19]) { p.r(x, 20, 4, 6, '#3c4c5e'); p.r(x, 20, 4, 1, Vh); p.px(x + 1, 22, Vd); } p.r(11, 10, 10, 2, '#c9c0a0'); p.r(7, 26, 18, 1, Vd); },
  riot(p) { p.r(6, 14, 20, 14, '#2a2e34'); bar(p, 9, 15, 14, 9, '#3e444c'); p.ell(6, 16, 4, 3, '#4a525a'); p.ell(25, 16, 4, 3, '#4a525a'); p.r(4, 14, 4, 1, '#7a828a'); p.r(24, 14, 4, 1, '#7a828a'); p.ell(16, 8, 7, 6, '#3a4048'); p.r(9, 8, 14, 5, '#3a4048'); p.r(10, 8, 12, 4, '#5aa0c8'); p.r(10, 8, 12, 1, '#b0e0f8'); p.r(11, 12, 10, 1, '#1a1e22'); p.r(11, 3, 6, 1, '#6a727a'); p.r(9, 20, 14, 2, '#c8b040'); },
  power_armor(p) { const P = '#7a8288', Pd = '#4a5258', Ph = '#b0b8be'; p.r(10, 22, 5, 7, Pd); p.r(17, 22, 5, 7, Pd); p.r(9, 21, 14, 2, '#3a3a32'); p.r(8, 10, 16, 12, P); p.r(8, 10, 16, 1, Ph); p.ell(5, 12, 4, 4, Pd); p.ell(26, 12, 4, 4, Pd); p.r(2, 9, 7, 1, Ph); p.r(23, 9, 7, 1, Ph); p.ell(16, 6, 5, 4, P); p.r(12, 4, 8, 1, Ph); p.r(13, 6, 6, 1, '#ff9a30'); p.r(14, 8, 4, 2, Pd); p.ell(16, 15, 3, 3, '#1a2a2a'); p.ell(16, 15, 2, 2, '#46f2c8'); p.px(15, 14, '#fff'); p.line(10, 11, 12, 20, BRASS, 1); p.line(22, 11, 20, 20, BRASS, 1); },
  helmet(p) { p.ell(16, 16, 11, 9, '#6a7650'); p.r(5, 17, 22, 4, '#6a7650'); p.r(5, 20, 22, 2, '#3a4230'); p.r(8, 9, 10, 2, '#a0b07a'); p.r(14, 11, 4, 2, '#c9a043'); },
  shield(p) { p.ell(16, 16, 12, 12, '#5a5248'); p.ell(16, 16, 10, 10, '#8a8478'); p.r(8, 9, 8, 7, RUST); p.r(8, 9, 8, 1, '#d08a50'); p.r(17, 18, 7, 6, '#9a8a5a'); p.r(17, 18, 7, 1, '#c8b880'); for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4; p.px(16 + Math.cos(a) * 11, 16 + Math.sin(a) * 11, '#d0d6da'); } p.ell(16, 16, 3, 3, '#4a4238'); p.ell(16, 16, 2, 2, '#9aa0a6'); p.px(15, 15, '#fff'); p.line(8, 7, 13, 5, '#c0c8cc', 1); },
  riot_shield(p) { p.r(7, 3, 18, 26, '#4a7a98'); p.r(8, 4, 16, 24, '#8ac0dc'); p.r(9, 5, 3, 14, '#c8e8f8'); p.r(7, 3, 18, 1, '#d8f0ff'); p.r(11, 7, 10, 4, '#3a5a70'); p.r(11, 7, 10, 1, '#6a90a8'); p.r(8, 20, 16, 3, '#1e2428'); for (let k = 0; k < 5; k++) p.r(10 + k * 3, 21, 2, 1, '#e8e0c0'); p.r(8, 27, 16, 1, '#3a5a70'); },
  // ---- zużywalne
  stim(p) { p.line(6, 26, 20, 12, '#d8e0e4', 4); p.line(7, 25, 19, 13, '#46f2c8', 2); p.r(19, 7, 6, 6, '#8a929a'); p.line(22, 6, 27, 1, '#8a929a', 1); p.line(21, 12, 24, 15, '#aab', 1); p.px(9, 23, '#bffff0'); p.r(4, 24, 3, 3, '#444b52'); p.r(18, 10, 7, 2, '#444b52'); },
  combat_stim(p) { p.line(8, 24, 22, 10, '#2a2f34', 7); p.line(8, 24, 22, 10, '#c43d2f', 5); p.line(7, 23, 21, 9, '#e8665a', 1); p.line(12, 20, 15, 17, '#ffd24a', 5); p.line(16, 16, 19, 13, '#ff9a30', 2); p.line(22, 10, 26, 6, '#8a929a', 5); p.line(23, 7, 26, 4, '#c0c8cc', 2); p.line(6, 26, 2, 30, '#d8e0e4', 1); },
  bandage(p) { p.r(4, 10, 24, 12, '#e8e2d0'); p.r(4, 10, 24, 2, '#fff'); p.r(4, 20, 24, 2, '#b8b2a0'); p.r(13, 8, 6, 16, '#d8d2c0'); p.r(14, 12, 4, 8, '#c43d2f'); p.r(12, 14, 8, 4, '#c43d2f'); p.r(14, 12, 4, 1, '#e8665a'); },
  medkit(p) { p.r(4, 10, 24, 16, '#d8d2c0'); p.r(4, 10, 24, 2, '#fff'); p.r(4, 24, 24, 2, '#a8a290'); p.r(11, 6, 10, 4, '#6a727a'); p.r(13, 4, 6, 3, '#8a929a'); p.r(13, 14, 6, 8, '#c43d2f'); p.r(11, 16, 10, 4, '#c43d2f'); p.r(13, 14, 6, 1, '#e8665a'); },
  antirad(p) { p.r(9, 9, 14, 17, '#e8a030'); p.r(9, 9, 14, 2, '#ffcf60'); p.r(9, 24, 14, 2, '#a86a10'); p.r(11, 5, 10, 4, '#e0e0d8'); p.r(11, 5, 10, 1, '#fff'); p.ell(16, 17, 5, 5, '#2a2a20'); p.r(15, 12, 3, 3, '#ffd24a'); p.r(11, 18, 3, 3, '#ffd24a'); p.r(19, 18, 3, 3, '#ffd24a'); p.ell(16, 17, 1, 1, '#ffd24a'); },
  grenade(p) { p.ell(16, 19, 8, 9, '#556244'); p.ell(16, 19, 7, 8, '#6a7a54'); for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) p.r(11 + x * 4, 14 + y * 4, 3, 3, '#445034'); p.r(10, 13, 3, 1, '#9aaa80'); p.r(13, 8, 6, 4, '#8a929a'); p.r(13, 8, 6, 1, '#c0c8cc'); p.line(19, 9, 25, 7, '#c9a043', 1); p.r(22, 2, 6, 1, '#c0c8cc'); p.r(22, 7, 6, 1, '#c0c8cc'); p.r(21, 3, 1, 4, '#c0c8cc'); p.r(28, 3, 1, 4, '#c0c8cc'); },
  emp(p) { p.r(10, 10, 12, 17, '#2a3a5a'); p.r(10, 10, 12, 2, '#4a6a9a'); p.r(10, 25, 12, 2, '#1a2238'); p.r(10, 10, 1, 17, '#4a6a9a'); p.r(10, 14, 12, 1, '#46a8f2'); p.r(10, 22, 12, 1, '#46a8f2'); p.line(17, 15, 14, 18, '#bfe8ff', 1); p.line(14, 18, 18, 18, '#bfe8ff', 1); p.line(18, 18, 15, 21, '#bfe8ff', 1); p.r(13, 6, 6, 4, '#8a929a'); p.r(13, 6, 6, 1, '#c0c8cc'); p.line(18, 6, 22, 2, '#aab', 1); p.px(23, 1, '#46f2ff'); for (const [x, y] of [[6, 12], [25, 9], [26, 20], [5, 22], [27, 14]]) p.px(x, y, '#9ad8ff'); },
  molotov(p) { p.r(13, 4, 6, 3, '#c9a043'); p.r(14, 7, 4, 4, '#3a6a3a'); p.ell(16, 19, 8, 9, '#3a6a3a'); p.ell(16, 19, 6, 7, '#58a058'); p.r(11, 15, 3, 8, '#9ae09a'); p.r(8, 20, 16, 4, '#d8a030'); p.px(17, 3, '#ff7a1e'); p.r(14, 0, 6, 3, '#ffb830'); p.r(15, 1, 4, 2, '#ff7a1e'); p.px(16, 0, '#fff0a0'); p.r(14, 3, 4, 3, '#e0e0c0'); },
  smoke(p) { p.r(10, 12, 12, 15, '#6a727a'); p.r(10, 12, 12, 2, '#9aa2aa'); p.r(10, 24, 12, 3, '#3c4249'); p.r(13, 8, 6, 4, '#8a929a'); p.r(14, 5, 4, 3, '#c0c8cc'); p.ell(8, 4, 5, 3, '#c8ccd0'); p.ell(18, 2, 6, 3, '#dde0e4'); p.ell(25, 5, 4, 3, '#aab0b4'); p.r(12, 17, 8, 5, '#d8d2c0'); p.r(14, 18, 4, 3, '#6a727a'); },
  food(p) { p.r(6, 10, 20, 15, '#b0905a'); p.r(6, 10, 20, 2, '#d8b878'); p.ell(16, 10, 10, 3, '#c9a868'); p.ell(16, 10, 8, 2, '#8a929a'); p.r(6, 22, 20, 3, '#7a6034'); p.r(8, 14, 16, 6, '#c43d2f'); p.r(8, 14, 16, 1, '#e0605a'); p.r(10, 16, 12, 2, '#f2ecde'); p.r(6, 10, 2, 15, '#d8b878'); },
  water(p) { p.r(12, 4, 8, 4, '#2a6a8a'); p.r(10, 8, 12, 19, '#7ac0e0'); p.r(10, 8, 3, 19, '#c0e8f8'); p.r(19, 8, 3, 19, '#4a8aa8'); p.r(10, 16, 12, 6, '#2a6a8a'); p.r(12, 17, 8, 1, '#aee'); p.r(10, 26, 12, 1, '#2a5a78'); p.px(14, 11, '#fff'); },
  // ---- złom i technika
  junk(p) { p.ell(16, 16, 9, 9, '#8a7a6a'); for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4; p.r(16 + Math.cos(a) * 10 - 2, 16 + Math.sin(a) * 10 - 2, 4, 4, '#8a7a6a'); } p.ell(16, 16, 3, 3, '#1a1410'); p.r(9, 9, 6, 2, '#b8a890'); p.r(18, 20, 6, 2, '#5a4a3a'); p.px(22, 12, RUST); p.px(10, 21, RUST); },
  scrap(p) { p.poly([[3, 18], [17, 15], [19, 25], [4, 27]], '#6a727a'); p.line(3, 18, 17, 15, '#b0b8be', 1); p.poly([[12, 6], [27, 10], [25, 21], [10, 17]], '#8a7a6a'); p.line(12, 6, 27, 10, '#c8b8a0', 1); p.r(15, 10, 4, 3, RUST); p.r(21, 14, 3, 3, RUST); p.px(14, 9, '#3a3028'); p.px(24, 12, '#3a3028'); p.px(22, 18, '#3a3028'); p.line(4, 29, 28, 26, RUST, 2); p.line(28, 26, 30, 22, RUST, 2); p.ell(8, 9, 3, 3, STEEL); p.ell(8, 9, 1, 1, '#2a2420'); p.px(7, 7, '#e0e8ec'); p.px(8, 22, '#3a3e42'); p.px(14, 23, '#3a3e42'); },
  cable(p) { p.ell(16, 17, 12, 9, '#7a3a14'); p.ell(16, 16, 12, 9, '#b8702a'); p.ell(16, 15, 11, 8, '#d08a40'); p.ell(16, 16, 10, 7, '#b8702a'); for (let k = 0; k < 5; k++) p.line(6 + k * 4, 10 + (k % 2), 7 + k * 4, 22 - (k % 2), '#e8a860', 1); p.cell(16, 16, 5, 3); p.line(26, 19, 30, 27, '#d08a40', 2); p.px(30, 28, '#fff0c0'); p.px(29, 28, '#fff0c0'); },
  watch(p) { p.r(12, 2, 8, 8, '#5a3a20'); p.r(12, 22, 8, 8, '#5a3a20'); p.r(13, 3, 1, 6, '#7a5a38'); p.r(13, 23, 1, 6, '#7a5a38'); p.r(14, 27, 4, 1, '#c9a043'); p.ell(16, 16, 9, 9, BRASS); p.ell(16, 16, 9, 9, BRASS); p.ell(16, 16, 7, 7, '#f2ecde'); p.line(10, 12, 14, 15, '#9a9488', 1); p.line(14, 15, 13, 19, '#9a9488', 1); p.line(16, 16, 16, 11, '#1a1410', 1); p.line(16, 16, 20, 17, '#1a1410', 1); for (const [x, y] of [[16, 10], [22, 16], [16, 22], [10, 16]]) p.px(x, y, '#6a5a3a'); p.r(25, 15, 2, 3, BRASS); p.px(12, 11, '#fff'); p.px(16, 16, '#c43d2f'); p.r(8, 12, 1, 6, '#f0d078'); },
  teeth(p) { p.line(3, 3, 9, 12, '#8a6a3a', 1); p.line(29, 3, 23, 12, '#8a6a3a', 1); p.r(2, 2, 3, 2, '#c43d2f'); p.r(27, 2, 3, 2, '#c43d2f'); p.ell(16, 18, 11, 9, '#d8ccae'); p.ell(16, 20, 10, 6, '#b8aa88'); p.cell(16, 15, 7, 6); for (let k = -3; k <= 3; k++) { const x = 16 + k * 2.2, base = 15 + 6 * Math.sqrt(Math.max(0, 1 - (k * 2.2 / 7.6) ** 2)), h = Math.abs(k) === 3 ? 5 : 3; p.r(x - 1, base - h, 2, h + 1, '#fffaf0'); p.px(x - 1, base - h, '#ffffff'); } p.px(9, 23, '#7a1d17'); p.px(22, 25, '#7a1d17'); p.r(5, 17, 2, 2, '#f2ecde'); },
  gland(p) { p.r(14, 5, 4, 5, '#8a4a5a'); p.r(15, 3, 2, 3, '#6a2a3a'); p.ell(16, 18, 10, 9, '#8a3a4c'); p.ell(15, 17, 9, 8, '#c06a7c'); p.ell(13, 14, 4, 3, '#e8a0ac'); p.px(11, 12, '#fff0f0'); p.line(8, 21, 13, 18, '#6a2a3a', 1); p.line(13, 18, 17, 23, '#6a2a3a', 1); p.line(18, 11, 21, 18, '#6a2a3a', 1); p.line(21, 18, 24, 20, '#6a2a3a', 1); p.ell(20, 21, 2, 2, '#8fd14f'); p.px(19, 20, '#e0ffb0'); p.ell(11, 23, 1, 1, '#8fd14f'); p.px(22, 28, '#8fd14f'); p.px(22, 29, '#6aa83a'); },
  fuel(p) { p.r(7, 8, 18, 19, '#b4432a'); p.r(7, 8, 18, 2, '#e0705a'); p.r(7, 25, 18, 2, '#702818'); p.r(20, 4, 5, 4, '#2a2f34'); p.r(9, 4, 9, 3, '#8a3020'); p.r(11, 5, 5, 1, '#1a1410'); p.line(9, 13, 22, 22, '#902818', 2); p.line(22, 13, 9, 22, '#902818', 2); p.r(7, 8, 2, 19, '#d0604a'); p.r(12, 16, 7, 3, '#d8c040'); },
  battery(p) { p.r(5, 10, 22, 17, '#2a2f34'); p.r(5, 10, 22, 2, '#4a525a'); p.r(5, 25, 22, 2, '#16191c'); p.r(8, 6, 4, 4, '#c43d2f'); p.r(20, 6, 4, 4, '#3a3e42'); p.r(8, 6, 4, 1, '#e8665a'); p.r(20, 6, 4, 1, '#7a828a'); p.r(9, 14, 14, 6, '#e8e2d0'); p.r(10, 16, 2, 2, '#c43d2f'); p.r(13, 17, 3, 1, '#3a3e42'); p.r(17, 16, 5, 2, '#46a858'); p.r(5, 10, 1, 17, '#5a626a'); },
  power_core(p) { p.r(9, 4, 14, 4, '#5a626a'); p.r(9, 4, 14, 1, '#aab4ba'); p.r(9, 24, 14, 4, '#5a626a'); p.r(9, 27, 14, 1, '#2a2f34'); p.r(10, 8, 12, 16, '#5a3a10'); p.r(12, 9, 8, 14, '#ffb830'); p.r(14, 10, 4, 12, '#fff0a0'); p.r(10, 12, 12, 1, '#a86a10'); p.r(10, 19, 12, 1, '#a86a10'); vbar(p, 8, 8, 2, 16, STEEL); vbar(p, 22, 8, 2, 16, STEEL); for (const x of [11, 15, 19]) p.px(x, 5, '#2a2f34'); p.r(13, 1, 6, 3, '#3a3e42'); },
  gas_mask(p) { p.line(3, 10, 8, 13, '#2a2420', 2); p.line(29, 10, 24, 13, '#2a2420', 2); p.ell(16, 14, 10, 10, '#3e4636'); p.ell(16, 13, 9, 9, '#5a6650'); p.r(10, 5, 12, 1, '#7a8a6a'); for (const x of [11, 21]) { p.ell(x, 12, 4, 4, '#2a2f34'); p.ell(x, 12, 3, 3, '#5a98b0'); p.px(x - 1, 11, '#d8f0ff'); p.px(x - 2, 12, '#a8d8e8'); } p.r(13, 18, 6, 3, '#3a4030'); p.ell(16, 24, 5, 4, '#2a2f34'); p.ell(16, 24, 4, 3, '#7a828a'); for (let k = 0; k < 3; k++) p.r(13 + k * 2, 23, 1, 3, '#3a3e42'); p.r(13, 21, 6, 1, '#9aa2aa'); },
  memory_card(p) { p.poly([[8, 4], [20, 4], [25, 9], [25, 28], [8, 28]], '#2a3a5a'); p.r(8, 4, 12, 1, '#5a7aa8'); p.r(8, 4, 1, 24, '#4a6a9a'); p.r(8, 27, 17, 1, '#1a2238'); for (let k = 0; k < 4; k++) p.r(10 + k * 3, 5, 2, 4, '#c9a043'); p.r(10, 12, 13, 11, '#d8d2c0'); p.r(10, 12, 13, 3, '#c43d2f'); p.r(12, 17, 9, 1, '#6a6458'); p.r(12, 19, 6, 1, '#6a6458'); p.r(19, 19, 2, 2, '#2a3a5a'); p.r(9, 24, 3, 1, '#7a9ac8'); },
  chip(p) { p.r(8, 8, 16, 16, '#1e2428'); p.r(8, 8, 16, 1, '#4a525a'); p.r(11, 11, 10, 10, '#2a5a8a'); p.r(13, 13, 6, 6, '#46f2c8'); p.px(13, 13, '#bffff0'); for (let k = 0; k < 5; k++) { p.r(5, 9 + k * 3, 3, 1, '#c9a043'); p.r(24, 9 + k * 3, 3, 1, '#c9a043'); p.r(9 + k * 3, 5, 1, 3, '#c9a043'); p.r(9 + k * 3, 24, 1, 3, '#c9a043'); } },
  tube(p) { p.ell(16, 11, 7, 8, '#5a7a8a'); p.r(9, 11, 15, 11, '#5a7a8a'); p.ell(16, 11, 6, 7, '#8ab0c0'); p.r(10, 11, 13, 11, '#8ab0c0'); p.r(13, 8, 6, 13, '#6a6a6a'); p.r(14, 9, 4, 11, '#3a3a3a'); p.r(15, 10, 2, 9, '#ff9a30'); p.px(15, 11, '#ffe0a0'); p.px(16, 14, '#ffe0a0'); p.r(10, 6, 2, 12, '#e0f4ff'); p.r(15, 2, 2, 2, '#8ab0c0'); p.r(9, 22, 14, 5, '#2a2420'); p.r(9, 22, 14, 1, '#5a4a3a'); for (let k = 0; k < 4; k++) p.r(11 + k * 3, 27, 1, 3, '#c9a043'); },
  tech(p) { p.r(5, 7, 22, 18, '#2a5a3a'); p.r(5, 7, 22, 1, '#4a8a5a'); for (let k = 0; k < 4; k++) { p.line(8, 11 + k * 3, 14 + k * 2, 11 + k * 3, '#c9a043', 1); p.px(14 + k * 2, 11 + k * 3, '#ffe08a'); } p.r(18, 10, 6, 6, '#1a1f22'); p.r(18, 10, 6, 1, '#4a525a'); for (let k = 0; k < 3; k++) { p.px(17, 11 + k * 2, '#ccc'); p.px(24, 11 + k * 2, '#ccc'); } p.r(9, 20, 3, 3, '#8a929a'); p.px(22, 21, '#46f2c8'); p.px(24, 21, '#ff5a3a'); },
  key(p) { p.ell(10, 10, 6, 6, '#d8b048'); p.cell(10, 10, 2, 2); p.px(7, 7, '#fff0a0'); p.line(14, 14, 27, 27, '#d8b048', 3); p.line(13, 13, 26, 26, '#fff0a0', 1); p.r(21, 25, 3, 5, '#d8b048'); p.r(25, 22, 3, 5, '#d8b048'); },
  ammo(p) { p.r(3, 16, 26, 12, '#4a5a3a'); p.r(3, 16, 26, 2, '#6a7a52'); p.r(3, 26, 26, 2, '#2a3420'); p.r(12, 20, 8, 4, '#c8b040'); p.r(13, 21, 6, 2, '#2a3420'); for (let k = 0; k < 4; k++) { const x = 6 + k * 6; p.r(x, 7, 4, 9, '#c9a043'); p.r(x, 7, 1, 9, '#f0d078'); p.r(x + 3, 7, 1, 9, '#8a6a20'); p.r(x, 3, 4, 4, k % 2 ? '#b4532a' : '#c8c0b0'); p.r(x + 1, 2, 2, 1, k % 2 ? '#b4532a' : '#c8c0b0'); } },
  radio(p) { p.r(6, 10, 20, 15, '#4a5a3a'); p.r(6, 10, 20, 2, '#7a8a5a'); p.r(9, 13, 8, 6, '#1a2a1a'); p.px(11, 15, '#8fd14f'); p.px(12, 15, '#8fd14f'); p.px(14, 17, '#8fd14f'); p.ell(21, 16, 3, 3, '#2a2f34'); p.px(20, 15, '#7a828a'); p.line(10, 10, 6, 1, '#aab', 1); p.r(9, 21, 14, 2, '#2a3a2a'); p.r(6, 25, 4, 3, '#c9a043'); p.r(22, 25, 4, 3, '#c43d2f'); },
  drone(p) { p.ell(16, 18, 8, 6, '#6a727a'); p.r(8, 14, 16, 1, '#aab4ba'); p.ell(16, 18, 3, 3, '#d8281a'); p.px(15, 17, '#fff'); p.r(2, 9, 10, 1, '#d8e0e4'); p.r(20, 9, 10, 1, '#d8e0e4'); p.r(6, 10, 1, 4, '#444b52'); p.r(25, 10, 1, 4, '#444b52'); p.r(10, 23, 12, 2, '#444b52'); p.line(22, 22, 28, 28, '#8a929a', 1); p.px(28, 27, '#c43d2f'); },
  goggles(p) { p.r(2, 12, 28, 4, '#3a2a1a'); for (const x of [10, 22]) { p.ell(x, 14, 6, 6, '#b0883a'); p.ell(x, 14, 4, 4, '#3a8aa8'); p.r(x - 2, 12, 2, 1, '#e8f8ff'); } },
  box(p) { p.r(5, 8, 22, 18, '#8a6a3a'); p.r(5, 8, 22, 3, '#b8904e'); p.r(5, 24, 22, 2, '#5a4220'); p.r(14, 8, 4, 18, '#6a4e28'); p.r(13, 14, 6, 3, '#c9a043'); p.r(14, 15, 4, 1, '#2a2018'); },
};
// stare nazwy ikon z danych / Oldgame
const ITEM_ALIAS = { laser: 'laser_pistol', blade: 'monoblade', mask: 'gas_mask', armor_leather: 'leather', armor_scrap: 'scrap_armor', armor_kevlar: 'vest', armor_power: 'power_armor', frag: 'grenade', smoke_grenade: 'smoke', ammo_box: 'ammo', canned_food: 'food', fuel_can: 'fuel' };
const ITEM_KEYS = [
  ['battery', ['battery', 'bateri', 'akumul']], ['revolver', ['revolver', 'rewolw']], ['sniper', ['sniper', 'snajper', 'longgun', 'marksman', 'hunting']], ['laser_pistol', ['laser', 'plazm', 'plasma', 'beam']], ['smg', ['smg', 'uzi', 'maszynow', 'subm']], ['sawedoff', ['sawed', 'obrzyn']], ['shotgun', ['shotgun', 'strzelb']],
  ['assault', ['assault', 'szturmow', 'ak47']], ['rifle', ['rifle', 'karabin', 'carbine']], ['pistol', ['pistol', 'handgun', 'glock', 'gun_', 'sidearm']], ['crossbow', ['crossbow', 'kusz']], ['bow', ['bow', 'luk']],
  ['pipe', ['pipe', 'rura', 'club', 'palka', 'bat', 'kij', 'wrench', 'crowbar', 'lom']],
  ['scythe', ['scythe', 'kosa']], ['monoblade', ['mono']], ['machete', ['machete', 'maczet', 'sword', 'miecz', 'blade', 'katan']], ['knife', ['knife', 'noz', 'dagger', 'shiv', 'sztylet']], ['hammer', ['hammer', 'mlot', 'sledge', 'maul']], ['axe', ['axe', 'topor', 'siekier']],
  ['molotov', ['molotov', 'zapaj', 'incend']], ['smoke', ['smoke', 'dym']], ['emp', ['emp']], ['grenade', ['grenade', 'granat', 'frag', 'explosive', 'bomb', 'dynamit']],
  ['antirad', ['antirad', 'rad-x', 'radx', 'iodine', 'jod', 'radiation']], ['combat_stim', ['combat_stim', 'wzmacn']], ['stim', ['stim', 'syringe', 'strzykaw', 'inject', 'chem', 'drug', 'narkot', 'adren', 'booster']],
  ['medkit', ['medkit', 'medic', 'apteczk', 'firstaid']], ['bandage', ['bandage', 'bandaz', 'opatrun', 'gauze']],
  ['riot_shield', ['riot_shield']], ['shield', ['shield', 'tarcz']], ['gas_mask', ['gas_mask', 'maska', 'mask']], ['helmet', ['helmet', 'helm']],
  ['power_armor', ['power_armor', 'wspomag']], ['riot', ['riot']], ['vest', ['vest', 'kevlar', 'kamizel']], ['cloak', ['cloak', 'plaszcz']], ['scrap_plate', ['scrap_plate', 'plytow']], ['scrap_armor', ['scrap_armor']], ['leather', ['leather', 'skorz', 'jacket', 'kurtk']], ['armor', ['armor', 'armour', 'pancerz', 'plate', 'suit', 'kombinez']],
  ['power_core', ['core', 'rdzen']], ['memory_card', ['memory', 'pamiec', 'card']], ['tube', ['tube', 'lamp']], ['chip', ['chip', 'circuit', 'uklad', 'processor', 'procesor', 'cpu', 'data']], ['key', ['key', 'keycard', 'pass']],
  ['ammo', ['ammo', 'amunic', 'bullet', 'nabo', 'magazine', 'magazynek', 'shells']], ['fuel', ['fuel', 'paliw', 'gas_can', 'jerry', 'oil', 'kanist']], ['water', ['water', 'woda', 'wody', 'bottle', 'butel', 'drink', 'canteen', 'flask']],
  ['food', ['food', 'jedz', 'konserw', 'canned', 'ration', 'meal', 'meat', 'mies', 'bean', 'fasol', 'jerky']], ['radio', ['radio', 'comm', 'walkie']], ['drone', ['drone', 'dron']], ['goggles', ['goggle', 'gogle', 'lens', 'visor']],
  ['watch', ['watch', 'zegar']], ['teeth', ['teeth', 'tooth', 'szczek', 'zeby', 'trophy']], ['gland', ['gland', 'gruczol', 'organ']], ['cable', ['cable', 'wire', 'kabel', 'miedz', 'copper']],
  ['tech', ['tech', 'electro', 'elektr', 'gadget', 'device', 'urzadz', 'scanner', 'skaner', 'module', 'part']], ['scrap', ['scrap', 'zlom', 'metal']], ['junk', ['junk', 'trash', 'gear', 'cog', 'rust', 'rdza']],
];

function itemKind(item) {
  const d = typeof item === 'string' ? { id: item } : (item || {});
  // dokładna nazwa ikony / id ma pierwszeństwo
  for (const s of [d.icon, d.id].map(norm)) {
    if (!s) continue;
    if (ITEM[s]) return s;
    if (ITEM_ALIAS[s]) return ITEM_ALIAS[s];
  }
  const parts = [d.id, d.icon, d.type, d.name].map(norm).filter(Boolean);
  for (const s of parts) { const k = ITEM_KEYS.find(([, ks]) => ks.some((x) => s.includes(norm(x)))); if (k) return k[0]; }
  const t = norm(d.type);
  if (t === 'weapon') return d.weapon && d.weapon.range > 1 ? 'pistol' : 'pipe';
  if (t === 'armor') return 'armor'; if (t === 'shield') return 'shield'; if (t === 'consumable') return 'stim'; if (t === 'junk') return 'junk'; if (t === 'tech') return 'tech'; if (t === 'ammo') return 'ammo';
  return 'box';
}

/** Ikona przedmiotu malowana natywnie w rozmiarze size x size (projekt 32x32). */
export function itemIcon(item, size = 32) {
  const T = Math.max(8, Math.round(size)); const kind = itemKind(item); const key = 'i' + kind + '@' + T;
  let c = cache.get(key);
  if (!c) {
    const s = T / 32; const [cv, g] = mkCanvas(T, T); const p = new SPix(g, s * 30 / 32); // 1 px marginesu projektowego na obrys
    g.translate(Math.round(s), Math.round(s));
    (ITEM[kind] || ITEM.box)(p);
    g.setTransform(1, 0, 0, 1, 0, 0);
    outline(g, T, '#120c08', s >= 1.75 ? 2 : 1);
    c = cv; cache.set(key, c);
  }
  return copy(c);
}
function copy(c) { const [n, g] = mkCanvas(c.width, c.height); g.drawImage(c, 0, 0); return n; }

// ---------------- abilities ----------------
const W = '#dfe6ea', Wh = '#fff', G = '#9aa8b0', SKIN = '#f2d0a8';
const AB = {
  sword(p) { p.line(5, 18, 18, 5, '#e8f0f4', 3); p.line(5, 18, 18, 5, '#fff', 1); p.line(3, 20, 7, 16, '#6a3a1c', 3); p.line(8, 14, 12, 18, '#c9a043', 2); p.px(18, 4, '#fff'); },
  double(p) { p.line(4, 18, 19, 3, W, 2); p.line(5, 13, 9, 17, '#c9a043', 2); p.line(2, 21, 5, 18, '#6a3a1c', 2); p.line(20, 18, 5, 3, Wh, 2); p.line(19, 13, 15, 17, '#c9a043', 2); p.line(22, 21, 19, 18, '#6a3a1c', 2); },
  crosshair(p, c) { p.ell(12, 12, 8, 8, '#fff'); p.ell(12, 12, 6, 6, c); p.ell(12, 12, 4, 4, '#fff'); p.ell(12, 12, 2, 2, c); p.r(11, 1, 2, 6, '#fff'); p.r(11, 17, 2, 6, '#fff'); p.r(1, 11, 6, 2, '#fff'); p.r(17, 11, 6, 2, '#fff'); p.px(12, 12, '#fff'); },
  mark(p, c) { p.ell(12, 14, 7, 7, '#fff'); p.ell(12, 14, 5, 5, c); p.r(11, 8, 2, 3, '#fff'); p.r(11, 18, 2, 3, '#fff'); p.r(6, 13, 3, 2, '#fff'); p.r(16, 13, 3, 2, '#fff'); p.ell(12, 14, 1, 1, '#ff5a3a'); p.poly([[8, 1], [16, 1], [12, 6]], '#ff5a3a'); p.r(9, 1, 6, 1, '#ffa090'); },
  heart(p) { p.ell(8, 9, 4, 4, '#ff5a5a'); p.ell(16, 9, 4, 4, '#ff5a5a'); p.poly([[3.5, 10], [20.5, 10], [12, 20]], '#ff5a5a'); p.px(7, 7, '#ffc0c0'); p.px(8, 6, '#ffc0c0'); },
  adrenaline(p) { AB.heart(p); p.line(13, 5, 10, 11, '#ffe84a', 2); p.line(10, 11, 14, 11, '#ffe84a', 2); p.line(14, 11, 11, 17, '#ffe84a', 2); },
  shield(p) { for (let y = 0; y < 17; y++) { const w = y < 11 ? 14 : 14 - (y - 10) * 2; p.r(12 - w / 2, 4 + y, w, 1, '#dfe6ea'); } p.r(12, 4, 1, 17, '#9aa8b0'); for (let y = 0; y < 15; y++) { const w = y < 10 ? 10 : 10 - (y - 9) * 2; if (w > 0) p.r(12 - w / 2, 6 + y, w, 1, '#5a6a74'); } p.r(11, 8, 2, 8, '#dfe6ea'); p.r(8, 11, 8, 2, '#dfe6ea'); },
  cover(p) { p.ell(12, 9, 5, 4, W); p.r(7, 10, 11, 2, G); p.r(9, 7, 4, 1, Wh); p.r(9, 11, 2, 2, '#1a1010'); p.r(14, 11, 2, 2, '#1a1010'); p.r(2, 13, 20, 9, '#c8b090'); p.r(2, 13, 20, 1, '#f0e0c0'); p.r(2, 16, 20, 1, '#7a6a52'); p.r(2, 19, 20, 1, '#7a6a52'); for (const x of [7, 13, 19]) p.r(x, 14, 1, 2, '#7a6a52'); for (const x of [4, 10, 16]) p.r(x, 17, 1, 2, '#7a6a52'); },
  stand(p) { p.ell(8, 4, 2, 2, W); p.line(8, 7, 8, 14, W, 3); p.line(8, 14, 5, 21, W, 2); p.line(8, 14, 11, 21, W, 2); p.line(8, 8, 4, 12, W, 2); p.line(8, 8, 12, 11, W, 2); p.line(18, 21, 18, 6, '#8fd14f', 2); p.line(18, 4, 14, 9, '#8fd14f', 2); p.line(18, 4, 22, 9, '#8fd14f', 2); },
  skull(p, c, dy = 0) { p.ell(12, 10 + dy, 7, 7, '#f2ecde'); p.r(8, 14 + dy, 8, 5, '#f2ecde'); p.ell(9, 10 + dy, 2, 2, '#1a1010'); p.ell(15, 10 + dy, 2, 2, '#1a1010'); p.r(11, 13 + dy, 2, 2, '#1a1010'); for (let k = 0; k < 4; k++) p.r(8 + k * 2, 17 + dy, 1, 3, '#1a1010'); },
  headshot(p, c) { AB.skull(p, c, 1); p.r(11, 0, 2, 4, '#ff3a2a'); p.r(11, 21, 2, 3, '#ff3a2a'); p.r(0, 11, 4, 2, '#ff3a2a'); p.r(20, 11, 4, 2, '#ff3a2a'); p.ell(9, 11, 1, 1, '#ff3a2a'); },
  kcommand(p, c) { AB.skull(p, c, 3); p.r(6, 3, 13, 3, '#ffd24a'); p.r(6, 3, 13, 1, '#fff2a0'); for (const x of [6, 11, 16]) p.poly([[x, 3], [x + 3, 3], [x + 1.5, 0]], '#ffd24a'); p.px(12, 4, '#c43d2f'); p.px(8, 4, '#46a8f2'); p.px(16, 4, '#46a8f2'); },
  fire(p) { p.ell(12, 16, 6, 6, '#ff7a1e'); p.r(10, 6, 5, 8, '#ff7a1e'); p.r(11, 4, 3, 3, '#ff7a1e'); p.ell(12, 17, 4, 4, '#ffd24a'); p.ell(12, 18, 2, 2, '#fff6c0'); p.r(6, 12, 3, 5, '#ff7a1e'); p.r(16, 11, 3, 6, '#ff9a30'); },
  molotov(p) { p.r(7, 12, 10, 10, '#58a058'); p.r(10, 8, 4, 4, '#58a058'); p.r(8, 13, 2, 8, '#bff0bf'); p.r(7, 18, 10, 3, '#d8a030'); p.r(10, 5, 4, 3, '#e8e2d0'); p.ell(12, 2, 3, 2, '#ff7a1e'); p.ell(12, 3, 1, 1, '#ffe84a'); p.r(14, 1, 2, 2, '#ff9a30'); },
  bolt(p) { p.line(15, 2, 8, 12, '#ffe84a', 3); p.line(8, 12, 15, 12, '#ffe84a', 3); p.line(15, 12, 8, 22, '#ffe84a', 3); p.px(14, 3, '#fff'); p.px(9, 12, '#fff'); },
  emp(p, c) { p.ell(12, 12, 9, 9, '#9ad8ff'); p.ell(12, 12, 7, 7, c); p.line(14, 5, 9, 12, '#fff', 2); p.line(9, 12, 15, 12, '#fff', 2); p.line(15, 12, 10, 19, '#fff', 2); for (const [x, y] of [[2, 4], [21, 3], [22, 20], [2, 19]]) p.px(x, y, '#bfe8ff'); },
  drone(p) { p.ell(12, 13, 6, 4, '#dfe6ea'); p.ell(12, 13, 2, 2, '#ff3a2a'); p.r(2, 6, 7, 1, '#fff'); p.r(15, 6, 7, 1, '#fff'); p.r(5, 7, 1, 3, '#aab'); p.r(18, 7, 1, 3, '#aab'); p.r(9, 17, 6, 2, '#aab'); },
  turret(p) { p.line(12, 15, 5, 22, G, 2); p.line(12, 15, 19, 22, G, 2); p.line(12, 15, 12, 22, G, 2); p.r(6, 8, 10, 8, W); p.r(6, 8, 10, 1, Wh); p.r(8, 10, 3, 2, '#ff3a2a'); p.r(16, 10, 6, 2, W); p.r(16, 13, 5, 1, G); p.px(23, 9, '#ffd24a'); p.px(23, 12, '#ffd24a'); p.r(22, 10, 2, 2, '#fff6c0'); p.r(3, 11, 3, 4, '#c9a043'); p.r(3, 11, 3, 1, '#f0d078'); },
  rockets(p) { for (let k = 0; k < 3; k++) { const x = 3 + k * 7, y = 3 + (k % 2) * 3; p.r(x, y + 3, 3, 10, W); p.r(x, y + 3, 1, 10, Wh); p.poly([[x, y + 3], [x + 3, y + 3], [x + 1.5, y]], '#ff5a3a'); p.r(x - 1, y + 11, 5, 2, G); p.r(x + 0.5, y + 13, 2, 3, '#ffd24a'); p.px(x + 1, y + 16, '#ff7a1e'); } },
  eye(p, c) { p.ell(12, 12, 10, 5, '#f2ecde'); p.ell(12, 12, 4, 4, c); p.ell(12, 12, 2, 2, '#1a1010'); p.px(11, 11, '#fff'); },
  fist(p) { p.r(6, 8, 13, 10, SKIN); for (let k = 0; k < 4; k++) { p.r(6 + k * 3, 5, 3, 5, SKIN); p.r(6 + k * 3, 5, 3, 1, '#fff2e0'); p.r(8 + k * 3, 6, 1, 3, '#c89870'); } p.r(3, 12, 4, 6, SKIN); p.r(7, 18, 11, 4, '#c0c8cc'); },
  shove(p) { for (let k = 0; k < 4; k++) { p.r(3 + k * 2, 3, 2, 6, SKIN); p.r(3 + k * 2, 3, 2, 1, '#fff2e0'); } p.r(3, 8, 8, 8, SKIN); p.r(11, 10, 3, 3, SKIN); p.r(10, 9, 1, 7, '#c89870'); p.r(4, 16, 6, 5, G); p.line(15, 12, 22, 12, '#fff', 2); p.line(22, 12, 19, 9, '#fff', 2); p.line(22, 12, 19, 15, '#fff', 2); },
  shout(p) { p.r(3, 9, 6, 7, '#dfe6ea'); p.line(9, 9, 15, 4, '#dfe6ea', 2); p.line(9, 16, 15, 21, '#dfe6ea', 2); p.r(13, 5, 3, 15, '#dfe6ea'); for (let k = 0; k < 3; k++) { p.line(18 + k * 2, 9 - k, 18 + k * 2, 15 + k, '#fff', 1); } },
  rally(p) { p.r(5, 3, 2, 18, '#c9a043'); p.px(5, 2, '#fff'); p.poly([[7, 4], [21, 5], [16, 9], [21, 13], [7, 13]], '#e04030'); p.r(7, 4, 12, 1, '#ff8a70'); p.ell(12, 8, 2, 2, '#ffd24a'); p.r(3, 21, 6, 2, G); },
  chief(p) { p.line(6, 12, 2, 4, '#f2ecde', 2); p.line(2, 4, 4, 1, '#f2ecde', 1); p.line(18, 12, 22, 4, '#f2ecde', 2); p.line(22, 4, 20, 1, '#f2ecde', 1); p.ell(12, 13, 7, 6, W); p.r(5, 13, 15, 5, W); p.r(9, 8, 4, 1, Wh); p.r(4, 18, 17, 2, G); p.r(11, 7, 2, 12, G); p.r(7, 15, 3, 1, '#1a1010'); p.r(14, 15, 3, 1, '#1a1010'); for (const x of [6, 18]) p.px(x, 16, G); },
  stealth(p) { p.ell(12, 11, 9, 9, '#2e3438'); p.ell(12, 13, 6, 6, '#0e1114'); p.r(8, 12, 3, 2, '#8fd14f'); p.r(14, 12, 3, 2, '#8fd14f'); p.px(8, 12, '#e0ffd0'); p.px(14, 12, '#e0ffd0'); p.r(6, 20, 12, 3, '#2e3438'); p.line(20, 3, 23, 0, '#e8f0f4', 2); p.line(17, 6, 20, 3, '#9aa8b0', 1); },
  run(p) { p.ell(14, 5, 3, 3, '#dfe6ea'); p.line(14, 8, 11, 15, '#dfe6ea', 3); p.line(14, 9, 19, 12, '#dfe6ea', 2); p.line(11, 15, 7, 21, '#dfe6ea', 3); p.line(11, 15, 16, 19, '#dfe6ea', 3); p.line(16, 19, 15, 23, '#dfe6ea', 2); p.line(3, 8, 8, 8, '#fff', 1); p.line(2, 12, 7, 12, '#fff', 1); p.line(4, 16, 8, 16, '#fff', 1); },
  dodge(p) { const g = '#6a7a84'; p.ell(17, 5, 2, 2, g); p.line(17, 8, 17, 15, g, 2); p.line(17, 15, 15, 21, g, 2); p.line(17, 15, 19, 21, g, 2); p.ell(7, 6, 2, 2, W); p.line(8, 9, 11, 15, W, 3); p.line(11, 15, 7, 21, W, 2); p.line(11, 15, 15, 20, W, 2); p.line(9, 10, 4, 8, W, 2); p.line(10, 11, 14, 9, W, 2); p.line(12, 3, 23, 3, '#ffd24a', 1); p.px(23, 3, '#fff'); },
  explosion(p) { for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4; p.line(12, 12, 12 + Math.cos(a) * 10, 12 + Math.sin(a) * 10, '#ff9a30', 3); } p.ell(12, 12, 6, 6, '#ffd24a'); p.ell(12, 12, 3, 3, '#fff'); },
  gun(p) { p.r(3, 8, 15, 5, '#dfe6ea'); p.r(3, 8, 15, 1, '#fff'); p.r(18, 9, 4, 3, '#9aa8b0'); p.r(5, 13, 4, 8, '#dfe6ea'); p.r(11, 13, 3, 3, '#9aa8b0'); p.px(23, 10, '#ffd24a'); },
  volley(p) { p.r(1, 13, 9, 3, W); p.r(1, 13, 9, 1, Wh); p.r(2, 16, 3, 5, W); for (const a of [-0.5, 0, 0.5]) { const ex = 12 + Math.cos(a) * 10, ey = 14 + Math.sin(a) * 10; p.line(11, 14, ex, ey, '#ffd24a', 1); p.ell(ex, ey, 1, 1, '#fff6c0'); } },
  barrage(p) { for (let k = 0; k < 3; k++) { const y = 4 + k * 6, o = (k % 2) * 3; for (let x = 1 + o; x < 10 + o; x += 3) p.r(x, y + 1, 2, 1, '#ffd24a'); p.r(11 + o, y, 6, 3, '#e8c060'); p.r(11 + o, y, 6, 1, '#fff0b0'); p.r(17 + o, y, 2, 3, W); p.px(19 + o, y + 1, Wh); } },
  cripple(p) { p.line(9, 1, 9, 14, W, 4); p.r(7, 14, 5, 5, G); p.r(7, 18, 10, 3, G); p.line(22, 5, 13, 8, '#ffd24a', 1); p.ell(10, 8, 2, 2, '#c43d2f'); p.px(11, 11, '#c43d2f'); p.px(12, 13, '#c43d2f'); p.line(14, 15, 20, 21, '#ff5a3a', 2); p.line(20, 15, 14, 21, '#ff5a3a', 2); },
  reload(p) { p.line(6, 12, 9, 6, '#fff', 2); p.line(9, 6, 17, 6, '#fff', 2); p.line(17, 6, 19, 12, '#fff', 2); p.line(19, 12, 15, 18, '#fff', 2); p.line(15, 18, 7, 18, '#fff', 2); p.r(17, 16, 5, 2, '#fff'); p.r(20, 13, 2, 5, '#fff'); },
  cross(p) { p.r(9, 3, 6, 18, '#fff'); p.r(3, 9, 18, 6, '#fff'); p.r(9, 3, 6, 1, '#cfd'); },
  clinic(p) { p.poly([[12, 2], [23, 20], [1, 20]], '#e8e2d0'); p.line(12, 2, 1, 20, '#fff', 1); p.poly([[12, 12], [15.5, 20], [8.5, 20]], '#4a5a64'); p.r(11, 5, 2, 6, '#c43d2f'); p.r(9, 7, 6, 2, '#c43d2f'); p.r(0, 20, 24, 2, G); },
  bandage(p) { p.r(3, 8, 18, 9, '#f2ecde'); p.r(9, 6, 6, 13, '#d8d2c0'); p.r(10, 9, 4, 7, '#c43d2f'); p.r(8, 11, 8, 3, '#c43d2f'); },
  stim(p) { p.line(5, 19, 15, 9, W, 4); p.line(6, 18, 14, 10, '#46f2c8', 2); p.line(11, 7, 17, 13, G, 1); p.line(15, 9, 19, 5, G, 2); p.line(17, 3, 21, 7, W, 2); p.line(4, 20, 1, 23, '#fff', 1); },
  breath(p, c) { p.line(2, 7, 14, 7, W, 2); p.ell(16, 5, 3, 3, W); p.cell(16, 5, 1, 1); p.clr(13, 5, 3, 1); p.line(2, 12, 18, 12, Wh, 2); p.ell(19, 15, 3, 3, W); p.cell(19, 15, 1, 1); p.clr(16, 15, 3, 1); p.line(4, 17, 12, 17, W, 2); p.line(4, 21, 9, 21, G, 1); },
  repair(p, c) { p.poly([[3, 3], [15, 3], [15, 12], [9, 19], [3, 12]], G); p.poly([[5, 5], [13, 5], [13, 11], [9, 16], [5, 11]], c); p.line(8, 21, 18, 11, '#fff', 3); p.ell(19, 8, 4, 4, '#fff'); p.cell(20, 6, 2, 2); p.clr(20, 3, 4, 4); },
  tune(p, c) { for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4 + 0.39; p.r(12 + Math.cos(a) * 8 - 1.5, 12 + Math.sin(a) * 8 - 1.5, 3, 3, W); } p.ell(12, 12, 7, 7, W); p.ell(12, 12, 4, 4, c); p.r(11, 7, 2, 3, '#ffd24a'); p.r(11, 15, 2, 3, '#ffd24a'); p.r(7, 11, 3, 2, '#ffd24a'); p.r(15, 11, 3, 2, '#ffd24a'); p.px(21, 2, '#fff'); p.px(20, 3, '#ffd24a'); p.px(22, 3, '#ffd24a'); },
  wrench(p, c) { p.line(6, 19, 15, 10, '#dfe6ea', 4); p.ell(16, 8, 5, 5, '#dfe6ea'); p.cell(17, 6, 2, 2); p.clr(17, 2, 4, 5); p.line(5, 20, 8, 17, '#9aa8b0', 3); },
  steal(p) { p.ell(15, 15, 6, 6, '#c9a043'); p.r(13, 7, 4, 3, '#a07830'); p.r(12, 9, 6, 1, '#6a4a20'); p.r(14, 12, 2, 7, '#6a4a20'); p.r(13, 13, 4, 1, '#6a4a20'); p.r(13, 17, 4, 1, '#6a4a20'); p.px(12, 12, '#f0d078'); p.r(1, 13, 6, 5, SKIN); p.r(6, 12, 3, 2, SKIN); p.r(6, 16, 3, 2, SKIN); p.line(1, 10, 4, 10, Wh, 1); p.line(1, 20, 4, 20, Wh, 1); },
  dirty(p) { p.r(2, 12, 6, 7, SKIN); p.r(8, 11, 4, 2, SKIN); p.r(8, 14, 5, 2, SKIN); p.r(8, 17, 4, 2, SKIN); p.r(4, 9, 2, 4, SKIN); p.r(2, 19, 5, 3, G); for (const [x, y, s] of [[15, 8, 2], [17, 12, 1], [19, 6, 1], [20, 13, 2], [22, 9, 1], [16, 16, 1], [21, 17, 1], [18, 3, 1], [23, 5, 1], [14, 12, 1]]) p.r(x, y, s, s, '#e8c878'); },
  rage(p) { p.ell(12, 12, 9, 9, '#ff7a5a'); p.ell(10, 9, 4, 3, '#ffa080'); p.line(5, 7, 10, 10, '#2a0a08', 2); p.line(19, 7, 14, 10, '#2a0a08', 2); p.r(7, 11, 3, 2, '#fff'); p.r(14, 11, 3, 2, '#fff'); p.r(7, 16, 10, 3, '#2a0a08'); p.r(8, 16, 8, 1, '#fff'); p.line(1, 1, 3, 4, Wh, 1); p.line(23, 1, 21, 4, Wh, 1); },
  roar(p) { p.poly([[1, 5], [14, 7], [15, 11], [1, 11]], W); p.poly([[1, 14], [14, 14], [12, 19], [1, 19]], W); p.r(1, 11, 11, 3, '#4a0a0a'); for (const x of [4, 7, 10]) p.r(x, 11, 1, 2, Wh); for (const x of [5, 8]) p.r(x, 12, 1, 2, Wh); p.px(5, 7, '#1a1010'); for (let k = 0; k < 3; k++) { p.line(17 + k * 3, 8 - k * 2, 18 + k * 3, 12, Wh, 1); p.line(18 + k * 3, 12, 17 + k * 3, 16 + k * 2, Wh, 1); } },
  rend(p) { for (let k = 0; k < 3; k++) { p.line(5 + k * 5, 2, 9 + k * 5, 21, '#ff5a5a', 3); p.line(5 + k * 5, 2, 9 + k * 5, 21, '#fff', 1); } },
  bite(p) { p.r(1, 2, 22, 3, '#ff8a8a'); for (const x of [2, 7, 12, 17]) p.poly([[x, 5], [x + 4, 5], [x + 2, 12]], W); p.r(1, 19, 22, 3, '#ff8a8a'); for (const x of [4.5, 9.5, 14.5]) p.poly([[x, 19], [x + 4, 19], [x + 2, 12]], Wh); },
  swarm(p) { for (const [x, y] of [[4, 5], [9, 3], [15, 4], [19, 8], [3, 11], [8, 9], [13, 10], [17, 13], [21, 14], [6, 15], [11, 15], [15, 18], [19, 19], [8, 20], [3, 18]]) { p.r(x, y, 2, 1, '#2a2418'); p.px(x, y - 1, '#fff'); p.px(x + 1, y - 1, '#cfe0e8'); } p.ell(12, 12, 1, 1, '#ffd24a'); },
  sting(p) { p.ell(4, 20, 3, 3, W); p.ell(7, 15, 3, 3, W); p.ell(11, 11, 3, 3, W); p.ell(11, 11, 1, 1, G); p.poly([[13, 9], [20, 2], [16, 11]], Wh); p.poly([[17, 16], [21, 16], [19, 11]], '#8fd14f'); p.ell(19, 18, 2, 2, '#8fd14f'); p.px(18, 17, '#e0ffb0'); },
  quake(p) { p.r(1, 15, 22, 7, '#c8b090'); p.r(1, 15, 22, 1, '#fff'); p.line(12, 15, 10, 18, '#2a1a10', 2); p.line(10, 18, 13, 21, '#2a1a10', 2); p.line(13, 18, 17, 17, '#2a1a10', 1); p.line(3, 4, 3, 11, W, 1); p.line(21, 4, 21, 11, W, 1); p.r(8, 6, 3, 3, W); p.r(14, 3, 2, 2, W); p.r(15, 9, 3, 2, W); },
  rad(p, c) { p.ell(12, 12, 10, 10, '#ffd24a'); for (let k = 0; k < 3; k++) { const a = -Math.PI / 2 + k * 2 * Math.PI / 3, P = (r, d) => [12.5 + Math.cos(a + d) * r, 12.5 + Math.sin(a + d) * r]; p.poly([P(3.5, -0.5), P(9.5, -0.52), P(9.8, 0), P(9.5, 0.52), P(3.5, 0.5)], '#1a1a10'); } p.ell(12, 12, 1, 1, '#1a1a10'); },
  frenzy(p, c) { p.ell(12, 12, 10, 10, '#ff5a5a'); p.ell(12, 12, 8, 8, c); for (const [x, y, dx, dy] of [[12, 1, 3, 2], [22, 15, -1, 3], [3, 16, -2, -2]]) p.poly([[x, y], [x + dx * 2, y + dy], [x - dy, y + dx]], '#ff5a5a'); for (let k = 0; k < 3; k++) p.line(8 + k * 3, 7, 10 + k * 3, 17, '#fff', 1); },
  scythe(p) { p.line(5, 22, 15, 3, '#c8a070', 2); p.poly([[14, 2], [19, 2], [23, 5], [23, 11], [20, 6], [15, 4]], '#fff'); p.line(15, 3, 22, 5, W, 1); },
  jawrain(p) { for (const [x, y] of [[3, 3], [14, 1], [8, 11], [17, 10]]) { p.line(x + 2, y - 3, x + 2, y - 1, G, 1); p.r(x, y, 5, 2, W); p.r(x, y, 5, 1, Wh); for (const k of [0, 2, 4]) p.px(x + k, y + 2, Wh); } p.r(1, 21, 22, 1, G); p.px(6, 20, W); p.px(18, 20, W); },
  star(p) { for (let k = 0; k < 5; k++) { const a = -Math.PI / 2 + k * 1.2566; p.line(12, 12, 12 + Math.cos(a) * 10, 12 + Math.sin(a) * 10, '#ffe27a', 3); } p.ell(12, 12, 4, 4, '#fff6c0'); },
  hammer(p) { p.line(5, 20, 14, 11, '#8a5a30', 3); p.r(11, 4, 10, 7, '#dfe6ea'); p.r(11, 4, 10, 1, '#fff'); },
  trap(p) { p.r(4, 15, 16, 4, '#9aa8b0'); for (let k = 0; k < 5; k++) { p.r(4 + k * 3, 9, 2, 7, '#dfe6ea'); p.px(4 + k * 3, 8, '#fff'); } p.r(4, 18, 16, 2, '#5a6a74'); },
};
/** Każda zdolność z core/data/abilities.ts ma własny, pasujący glif. */
const AB_ID = {
  strike: 'sword', raise_shield: 'shield', take_cover: 'cover', demoralize: 'shout', first_aid: 'cross', stand: 'stand', suppressive_fire: 'barrage',
  double_strike: 'double', charge: 'run', rally: 'rally', mark_target: 'mark', precise_shot: 'crosshair', crippling_shot: 'cripple', volley: 'volley',
  field_dressing: 'bandage', stimulant: 'stim', adrenaline: 'adrenaline', field_clinic: 'clinic', combat_drone: 'drone', emp_grenade: 'emp',
  repair_armor: 'repair', weapon_tune: 'tune', sneak_attack: 'stealth', dodge: 'dodge', steal: 'steal', dirty_trick: 'dirty', rage: 'rage', roar: 'roar',
  rend: 'rend', shove: 'shove', second_wind: 'breath', bite_trip: 'bite', swarm_cloud: 'swarm', poison_sting: 'sting', quake: 'quake', rad_touch: 'rad',
  frenzy: 'frenzy', throw_molotov: 'molotov', headshot: 'headshot', chief_rally: 'chief', self_destruct: 'explosion', turret_burst: 'turret',
  rocket_salvo: 'rockets', kostucha_cull: 'scythe', kostucha_barrage: 'jawrain', kostucha_command: 'kcommand',
};
const AB_KEYS = [
  ['crosshair', ['crosshair', 'aim', 'snip', 'precis', 'target', 'celn']], ['heart', ['heart', 'heal', 'regen', 'leczen', 'life', 'serce']], ['bandage', ['bandage', 'bandaz', 'stabil', 'patch']], ['cross', ['medic', 'cross', 'revive']],
  ['shield', ['shield', 'tarcz', 'guard', 'block', 'defen', 'armor']], ['skull', ['skull', 'death', 'kill', 'finish', 'execut', 'czaszk']], ['explosion', ['explos', 'wybuch', 'blast', 'area']],
  ['fire', ['fire', 'flame', 'burn', 'ogien', 'incend']], ['bolt', ['bolt', 'elec', 'shock', 'arc', 'zap', 'lightning', 'stun', 'energy']], ['drone', ['drone', 'dron', 'robot', 'deploy']], ['eye', ['eye', 'oko', 'perception', 'scan', 'spot', 'recon', 'vision', 'watch', 'analy']],
  ['fist', ['fist', 'piesc', 'punch', 'brawl', 'bash', 'smash', 'slam', 'unarm', 'grapple', 'trip']], ['shout', ['shout', 'krzyk', 'yell', 'intimid', 'command', 'taunt', 'warcry', 'bark']],
  ['stealth', ['stealth', 'hide', 'sneak', 'ukry', 'skrad', 'shadow', 'ambush', 'backstab']], ['run', ['run', 'sprint', 'stride', 'step', 'move', 'dash', 'escape', 'bieg']], ['reload', ['reload', 'przelad', 'recharge', 'swap']],
  ['trap', ['trap', 'pulap', 'mine', 'mina', 'snare']], ['wrench', ['wrench', 'tech', 'napraw', 'hack', 'craft', 'tinker', 'gadget', 'build', 'upgrade']], ['hammer', ['hammer', 'mlot', 'sledge', 'whirl', 'cleave', 'berserk']],
  ['gun', ['gun', 'shot', 'strzal', 'shoot', 'burst', 'spray', 'rapid', 'pistol', 'rifle', 'ranged']], ['sword', ['sword', 'strike', 'slash', 'cut', 'attack', 'melee', 'knife', 'blade', 'uderz', 'cios', 'feint', 'flurry', 'stab']],
];
const MELEE = '#a83a2a', SHOT = '#a85a2a', BOOM = '#b8651a', HEAL = '#2a8a4a', BUFF = '#2a5a8a', SHOUT = '#8a6a1a', TECH = '#2a6a7a', BEAST = '#6a2a5a', BOSS = '#4a1a2a';
const AB_COL = {
  sword: MELEE, double: MELEE, run: '#4a7a3a', stealth: '#3a4a5a', steal: '#5a4a2a', dirty: '#7a5a2a', shove: '#8a3a2a', fist: '#8a3a2a', hammer: '#8a3a2a',
  crosshair: SHOT, mark: '#7a2a2a', cripple: SHOT, volley: SHOT, barrage: SHOT, gun: SHOT, headshot: '#6a1a1a',
  explosion: BOOM, molotov: '#a8481a', fire: '#a8481a', rockets: BOOM, emp: '#2a4a8a', bolt: '#3a6a9a',
  heart: HEAL, adrenaline: '#8a2a3a', cross: HEAL, clinic: HEAL, bandage: HEAL, stim: '#2a7a6a', breath: '#3a7a5a',
  shield: BUFF, cover: '#4a5a3a', stand: '#3a6a3a', dodge: '#3a5a7a', tune: '#5a5a2a', repair: '#6a5a2a', wrench: '#6a5a2a', reload: '#5a5a2a',
  shout: SHOUT, rally: SHOUT, chief: '#7a4a1a', drone: TECH, turret: '#3a4a5a', eye: '#4a3a8a',
  rage: '#9a2a1a', roar: BEAST, rend: BEAST, bite: BEAST, swarm: '#4a5a2a', sting: '#3a6a2a', quake: '#6a4a2a', rad: '#5a6a1a', frenzy: '#7a1a3a',
  scythe: BOSS, jawrain: BOSS, kcommand: BOSS, skull: '#6a1a1a', trap: '#8a5a2a', star: '#6a4a8a',
};
export function abilityKind(icon) {
  const d = typeof icon === 'string' ? { icon } : (icon || {});
  for (const s of [d.id, d.icon].map(norm)) if (s && AB_ID[s]) return AB_ID[s];
  for (const s of [d.icon, d.id].map(norm)) if (s && AB[s]) return s;
  const parts = [d.icon, d.id, d.name, d.fx].map(norm).filter(Boolean);
  for (const s of parts) { const k = AB_KEYS.find(([, ks]) => ks.some((x) => s.includes(norm(x)))); if (k) return k[0]; }
  return 'star';
}
/** Odznaka zdolności malowana natywnie w rozmiarze size x size (projekt 24x24). */
export function abilityIcon(icon, size = 24) {
  const T = Math.max(6, Math.round(size)); const kind = abilityKind(icon); const key = 'a' + kind + '@' + T; let c = cache.get(key);
  if (!c) {
    const s = T / 24; const [cv, g] = mkCanvas(T, T), p = new SPix(g, s); const col = AB_COL[kind] || '#555';
    // odznaka: ścięte rogi, faza światła u góry-lewej, cień u dołu-prawej
    p.r(1, 0, 22, 24, '#0e0a08'); p.r(0, 1, 24, 22, '#0e0a08'); p.r(2, 1, 20, 22, col); p.r(1, 2, 22, 20, col);
    p.r(2, 1, 20, 1, shade(col, 1.5)); p.r(1, 2, 1, 20, shade(col, 1.3)); p.r(2, 22, 20, 1, shade(col, 0.55)); p.r(22, 2, 1, 20, shade(col, 0.6));
    // dither dolnej połowy w pikselach wyjściowych
    g.fillStyle = shade(col, 0.86);
    const a = Math.round(2 * s), b = Math.round(22 * s);
    for (let y = Math.round(12 * s); y < b; y++) for (let x = a; x < b; x++) if ((x + y) & 1) g.fillRect(x, y, 1, 1);
    // glif na osobnej warstwie z cieniem (inset 1 px projektowy)
    const [gc, gg] = mkCanvas(T, T), gp = new SPix(gg, s * 0.9); gg.translate(Math.round(1.2 * s), Math.round(1.2 * s));
    (AB[kind] || AB.star)(gp, shade(col, 0.9));
    const off = Math.max(1, Math.round(s));
    const [sc, sg] = mkCanvas(T, T); sg.drawImage(gc, 0, 0); sg.globalCompositeOperation = 'source-in'; sg.fillStyle = '#000'; sg.fillRect(0, 0, T, T);
    g.globalAlpha = 0.6; g.drawImage(sc, off, off); g.globalAlpha = 1;
    g.drawImage(gc, 0, 0);
    c = cv; cache.set(key, c);
  }
  return copy(c);
}
export { itemKind };
