// Niskopoziomowy "malarz" pixel artu: bufor RGBA, rampy kolorów z przesunięciem barwy,
// dithering Bayera, wypełnianie wielokątów bez antyaliasingu i rzut izometryczny brył.
// Wszystko liczone na pikselach całkowitych, więc tekstury są idealnie ostre.
// (Phaser.Graphics + generateTexture rysuje trójkąty przez canvas z antyaliasingiem,
// co rozmywa krawędzie rombów - dlatego teksturę składamy tu piksel po pikselu.)

export type RGB = number; // 0xRRGGBB

const clamp255 = (v: number): number => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));
export const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

export const rgb = (r: number, g: number, b: number): RGB => (clamp255(r) << 16) | (clamp255(g) << 8) | clamp255(b);
export const R_ = (c: RGB): number => (c >> 16) & 255;
export const G_ = (c: RGB): number => (c >> 8) & 255;
export const B_ = (c: RGB): number => c & 255;

/** Mnoży jasność koloru. */
export const shade = (c: RGB, k: number): RGB => rgb(R_(c) * k, G_(c) * k, B_(c) * k);
export const mix = (a: RGB, b: RGB, t: number): RGB =>
  rgb(R_(a) + (R_(b) - R_(a)) * t, G_(a) + (G_(b) - G_(a)) * t, B_(a) + (B_(b) - B_(a)) * t);

function toHsl(c: RGB): [number, number, number] {
  const r = R_(c) / 255, g = G_(c) / 255, b = B_(c) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h *= 60;
  return [h, s, l];
}

function fromHsl(h: number, s: number, l: number): RGB {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return rgb((r + m) * 255, (g + m) * 255, (b + m) * 255);
}

const lerpHue = (a: number, b: number, t: number): number => {
  let d = ((b - a + 540) % 360) - 180;
  if (Math.abs(d) < 1e-6) d = 0;
  return a + d * t;
};

/**
 * Rampa n kolorów od cienia do blasku z przesunięciem barwy (cienie w stronę fioletu,
 * światła w stronę żółci) - klasyczna technika pixel artu, daje "malarskie" bryły.
 * Środkowy element ~ kolor bazowy.
 */
export function ramp(base: RGB, n = 5, spread = 0.38): RGB[] {
  const [h, s, l] = toHsl(base);
  const out: RGB[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1) - 0.5; // -0.5..0.5
    const li = clamp01(l + t * spread * (t < 0 ? 1.1 : 0.9));
    const hi = lerpHue(h, t < 0 ? 255 : 48, Math.abs(t) * 0.42);
    const si = clamp01(t < 0 ? Math.max(s, 0.1) + -t * 0.12 : s * (1 - t * 0.35));
    out.push(fromHsl(hi, si, li));
  }
  return out;
}

// --------------------------------------------------------------- szum i dithering

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
/** Próg Bayera 4x4 w (0..1). */
export const bayer = (x: number, y: number): number => (BAYER4[((y & 3) << 2) | (x & 3)] + 0.5) / 16;

/** Wybór koloru z rampy dla wartości v (0..1) z ditheringiem uporządkowanym. */
export function pick(r: readonly RGB[], v: number, x: number, y: number): RGB {
  const f = clamp01(v) * (r.length - 1);
  const i = Math.floor(f);
  return r[Math.min(r.length - 1, f - i > bayer(x, y) ? i + 1 : i)];
}

/** Deterministyczny hash 2D -> [0,1). */
export function hash2(x: number, y: number, seed = 0): number {
  let h = Math.imul((x | 0) ^ 0x27d4eb2d, 0x165667b1) ^ Math.imul((y | 0) + 0x9e3779b9, 0x85ebca6b) ^ Math.imul(seed | 0, 0xc2b2ae35);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/** Wygładzony szum wartości. */
export function vnoise(x: number, y: number, seed = 0): number {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const sx = xf * xf * (3 - 2 * xf), sy = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, seed), b = hash2(xi + 1, yi, seed), c = hash2(xi, yi + 1, seed), d = hash2(xi + 1, yi + 1, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

/** Deterministyczny generator liczb (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const hashStr = (s: string): number => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};

// --------------------------------------------------------------- bufor pikseli

/** Funkcja wypełnienia: zwraca kolor albo -1 (nie maluj). a,b = lokalne współrzędne ściany. */
export type Fill = (x: number, y: number, a: number, b: number) => RGB;

export class PixelCanvas {
  readonly w: number;
  readonly h: number;
  readonly data: Uint8ClampedArray;

  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.data = new Uint8ClampedArray(w * h * 4);
  }

  inside(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }

  set(x: number, y: number, c: RGB, a = 255): void {
    x |= 0;
    y |= 0;
    if (c < 0 || !this.inside(x, y)) return;
    const i = (y * this.w + x) * 4;
    if (a >= 255) {
      this.data[i] = R_(c);
      this.data[i + 1] = G_(c);
      this.data[i + 2] = B_(c);
      this.data[i + 3] = 255;
      return;
    }
    // "over" na istniejącym pikselu
    const da = this.data[i + 3] / 255, sa = a / 255;
    const oa = sa + da * (1 - sa);
    if (oa <= 0) return;
    this.data[i] = (R_(c) * sa + this.data[i] * da * (1 - sa)) / oa;
    this.data[i + 1] = (G_(c) * sa + this.data[i + 1] * da * (1 - sa)) / oa;
    this.data[i + 2] = (B_(c) * sa + this.data[i + 2] * da * (1 - sa)) / oa;
    this.data[i + 3] = oa * 255;
  }

  /** Kolor piksela albo -1, gdy przezroczysty. */
  get(x: number, y: number): RGB {
    if (!this.inside(x, y)) return -1;
    const i = (y * this.w + x) * 4;
    if (this.data[i + 3] === 0) return -1;
    return rgb(this.data[i], this.data[i + 1], this.data[i + 2]);
  }

  alpha(x: number, y: number): number {
    return this.inside(x, y) ? this.data[(y * this.w + x) * 4 + 3] : 0;
  }

  clear(x: number, y: number): void {
    if (this.inside(x, y)) this.data[(y * this.w + x) * 4 + 3] = 0;
  }

  /** Mnoży jasność istniejącego piksela (cieniowanie po fakcie). */
  darken(x: number, y: number, k: number): void {
    const c = this.get(x, y);
    if (c >= 0) this.set(x, y, shade(c, k), this.alpha(x, y));
  }

  rect(x: number, y: number, w: number, h: number, c: RGB | Fill, a = 255): void {
    for (let yy = y; yy < y + h; yy++)
      for (let xx = x; xx < x + w; xx++) this.set(xx, yy, typeof c === 'number' ? c : c(xx, yy, xx - x, yy - y), a);
  }

  line(x0: number, y0: number, x1: number, y1: number, c: RGB | ((x: number, y: number, t: number) => RGB), a = 255): void {
    x0 = Math.round(x0);
    y0 = Math.round(y0);
    x1 = Math.round(x1);
    y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    const n = Math.max(dx, -dy) || 1;
    let err = dx + dy, i = 0;
    for (;;) {
      this.set(x0, y0, typeof c === 'number' ? c : c(x0, y0, i / n), a);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
      i++;
    }
  }

  /** Wypełnia wielokąt (próbkowanie w środkach pikseli, reguła półotwarta - bez podwójnych krawędzi). */
  poly(pts: readonly (readonly [number, number])[], fill: RGB | Fill, a = 255): void {
    let minY = Infinity, maxY = -Infinity;
    for (const p of pts) {
      minY = Math.min(minY, p[1]);
      maxY = Math.max(maxY, p[1]);
    }
    const xs: number[] = [];
    for (let y = Math.max(0, Math.floor(minY)); y <= Math.min(this.h - 1, Math.ceil(maxY)); y++) {
      const cy = y + 0.5;
      xs.length = 0;
      for (let i = 0; i < pts.length; i++) {
        const [x0, y0] = pts[i];
        const [x1, y1] = pts[(i + 1) % pts.length];
        if ((y0 <= cy && y1 > cy) || (y1 <= cy && y0 > cy)) xs.push(x0 + ((cy - y0) / (y1 - y0)) * (x1 - x0));
      }
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const xa = Math.ceil(xs[k] - 0.5), xb = Math.ceil(xs[k + 1] - 0.5);
        for (let x = Math.max(0, xa); x < Math.min(this.w, xb); x++) {
          this.set(x, y, typeof fill === 'number' ? fill : fill(x, y, 0, 0), a);
        }
      }
    }
  }

  ellipse(cx: number, cy: number, rx: number, ry: number, fill: RGB | Fill, a = 255): void {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry;
        const d = dx * dx + dy * dy;
        if (d <= 1) this.set(x, y, typeof fill === 'number' ? fill : fill(x, y, dx, dy), a);
      }
  }

  /**
   * Obrys "sel-out": przezroczyste piksele przy krawędzi dostają przyciemniony kolor
   * sąsiada (nie czarny), co daje miękki, czytelny kontur jak w ręcznym pixel arcie.
   */
  outline(strength = 0.38, ink: RGB = 0x120a10, minAlpha = 128): void {
    const add: [number, number, RGB][] = [];
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++) {
        if (this.alpha(x, y) >= minAlpha) continue;
        let best = -1, bestL = 1e9;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          if (this.alpha(x + dx, y + dy) < minAlpha) continue;
          const c = this.get(x + dx, y + dy);
          const l = R_(c) + G_(c) + B_(c);
          if (l < bestL) { bestL = l; best = c; }
        }
        if (best >= 0) add.push([x, y, mix(shade(best, strength), ink, 0.55)]);
      }
    for (const [x, y, c] of add) this.set(x, y, c);
  }

  /** Obcina przezroczyste brzegi; zwraca nowy bufor i przesunięcie. */
  crop(pad = 0): { pc: PixelCanvas; ox: number; oy: number } {
    let x0 = this.w, y0 = this.h, x1 = -1, y1 = -1;
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++)
        if (this.alpha(x, y) > 0) {
          x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
        }
    if (x1 < 0) return { pc: new PixelCanvas(1, 1), ox: 0, oy: 0 };
    x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad);
    x1 = Math.min(this.w - 1, x1 + pad); y1 = Math.min(this.h - 1, y1 + pad);
    const pc = new PixelCanvas(x1 - x0 + 1, y1 - y0 + 1);
    for (let y = 0; y < pc.h; y++) {
      const src = ((y + y0) * this.w + x0) * 4;
      pc.data.set(this.data.subarray(src, src + pc.w * 4), y * pc.w * 4);
    }
    return { pc, ox: x0, oy: y0 };
  }

  toCanvas(): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = this.w;
    c.height = this.h;
    const ctx = c.getContext('2d');
    if (ctx) ctx.putImageData(new ImageData(new Uint8ClampedArray(this.data), this.w, this.h), 0, 0);
    return c;
  }
}

// --------------------------------------------------------------- pióro izometryczne

/**
 * Rysuje bryły w przestrzeni pola: u wzdłuż gx, v wzdłuż gy (1 = jedno pole), z w pikselach w górę.
 * (ax, ay) = piksel górnego wierzchołka rombu pola (u=0, v=0, z=0).
 */
export class IsoPen {
  readonly pc: PixelCanvas;
  readonly ax: number;
  readonly ay: number;

  constructor(pc: PixelCanvas, ax: number, ay: number) {
    this.pc = pc;
    this.ax = ax;
    this.ay = ay;
  }

  p(u: number, v: number, z = 0): [number, number] {
    return [this.ax + (u - v) * 16, this.ay + (u + v) * 8 - z];
  }

  /** Odwrotność rzutu dla płaszczyzny z = const. */
  uv(x: number, y: number, z = 0): [number, number] {
    const dx = (x + 0.5 - this.ax) / 16, dy = (y + 0.5 - this.ay + z) / 8;
    return [(dy + dx) / 2, (dy - dx) / 2];
  }

  /** Płaski czworokąt na wysokości z. fill(x,y,u,v). */
  flat(u0: number, v0: number, u1: number, v1: number, z: number, fill: RGB | Fill, a = 255): void {
    const f: Fill = typeof fill === 'number' ? () => fill : (x, y) => { const [u, v] = this.uv(x, y, z); return fill(x, y, u, v); };
    this.pc.poly([this.p(u0, v0, z), this.p(u1, v0, z), this.p(u1, v1, z), this.p(u0, v1, z)], f, a);
  }

  /**
   * Prostopadłościan. Widoczne ściany: górna, lewa (normalna +v) i prawa (normalna +u).
   * Dla ścian pionowych fill dostaje (x, y, s, z): s = pozycja wzdłuż ściany w pikselach od jej lewego brzegu.
   */
  box(
    u0: number, v0: number, u1: number, v1: number, z0: number, z1: number,
    m: { top?: RGB | Fill; left?: RGB | Fill; right?: RGB | Fill },
    a = 255,
  ): void {
    const pc = this.pc;
    if (m.left !== undefined) {
      const fl = m.left;
      const f: Fill = typeof fl === 'number' ? () => fl : (x, y) => {
        const s = x + 0.5 - this.p(u0, v1)[0];
        const z = this.p(u0, v1)[1] + s / 2 - (y + 0.5);
        return fl(x, y, s, z);
      };
      pc.poly([this.p(u0, v1, z1), this.p(u1, v1, z1), this.p(u1, v1, z0), this.p(u0, v1, z0)], f, a);
    }
    if (m.right !== undefined) {
      const fr = m.right;
      const f: Fill = typeof fr === 'number' ? () => fr : (x, y) => {
        const s = x + 0.5 - this.p(u1, v1)[0];
        const z = this.p(u1, v1)[1] - s / 2 - (y + 0.5);
        return fr(x, y, s, z);
      };
      pc.poly([this.p(u1, v1, z1), this.p(u1, v0, z1), this.p(u1, v0, z0), this.p(u1, v1, z0)], f, a);
    }
    if (m.top !== undefined) this.flat(u0, v0, u1, v1, z1, m.top, a);
  }

  /** Bryła z trzech odcieni rampy + jasne krawędzie od strony światła. */
  shadedBox(
    u0: number, v0: number, u1: number, v1: number, z0: number, z1: number, r: readonly RGB[],
    tex?: (face: 0 | 1 | 2, x: number, y: number, s: number, z: number) => number,
    edges = true,
  ): void {
    const n = r.length - 1;
    const lv = (face: 0 | 1 | 2, base: number): Fill => (x, y, s, z) => pick(r, (base + (tex ? tex(face, x, y, s, z) : 0)) / n, x, y);
    this.box(u0, v0, u1, v1, z0, z1, { left: lv(1, n * 0.55), right: lv(2, n * 0.28), top: lv(0, n * 0.8) });
    if (!edges) return;
    // krawędzie: górna-przednia jasna, pionowy narożnik średni
    const hi = r[n];
    this.pc.line(...this.p(u0, v1, z1), ...this.p(u1, v1, z1), hi);
    this.pc.line(...this.p(u1, v0, z1), ...this.p(u1, v1, z1), mix(hi, r[n - 1], 0.5));
    if (z1 - z0 > 3) this.pc.line(...this.p(u1, v1, z1 - 1), ...this.p(u1, v1, z0 + 1), r[Math.max(0, Math.round(n * 0.5))]);
  }

  /** Pionowy walec (beczka, słup). Cieniowanie wzdłuż szerokości. */
  cylinder(u: number, v: number, rad: number, z0: number, z1: number, r: readonly RGB[], band?: (z: number) => number): void {
    const [cx, cy] = this.p(u, v, 0);
    const rx = rad * 22.6, ry = rad * 11.3; // promień w pikselach (rzut okręgu)
    for (let y = Math.floor(cy - z1 - ry); y <= Math.ceil(cy - z0 + ry); y++)
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const dx = (x + 0.5 - cx) / rx;
        if (Math.abs(dx) > 1) continue;
        const e = Math.sqrt(1 - dx * dx) * ry;
        const yb = cy - z0 + e, yt = cy - z1 + e; // dolny brzeg / górny brzeg przodu
        const py = y + 0.5;
        if (py > yb || py < cy - z1 - e) continue;
        if (py < yt) {
          // pokrywa
          const lit = 0.72 + -dx * 0.12;
          this.pc.set(x, y, pick(r, lit, x, y));
        } else {
          const z = cy + e - py;
          const lit = 0.62 - dx * 0.38 - (dx > 0.55 ? 0.12 : 0) + (band ? band(z) : 0);
          this.pc.set(x, y, pick(r, clamp01(lit), x, y));
        }
      }
  }
}

// --------------------------------------------------------------- kształt rombu 32x16

export const TILE_W = 32;
export const TILE_H = 16;

/** Zakres kolumn wiersza y rombu 32x16 (dokładnie kafelkuje się z sąsiadami, bez nakładek i dziur). */
export function diamondSpan(y: number): [number, number] {
  return y < 8 ? [15 - 2 * y, 16 + 2 * y] : [2 * y - 15, 46 - 2 * y];
}

export function forDiamond(fn: (x: number, y: number) => void, ox = 0, oy = 0): void {
  for (let y = 0; y < TILE_H; y++) {
    const [a, b] = diamondSpan(y);
    for (let x = a; x <= b; x++) fn(ox + x, oy + y);
  }
}
