// Drobne animacje ekranów (ogniska, pył, fale, migotanie, krzywe narastania) w liczbach całkowitych.
// Czas zawsze jako tq8 = tick * 256 + ułamek (Q8 ticków 1/50 s), kąty w 1/256 obrotu, sinus w Q14 z SIN_LUT.
// Renderer zamienia wyniki na piksele dopiero przy rysowaniu - logika i animacja są identyczne w TS i w C.
import { IntRng, Q12, Q8, TICK_HZ, clampInt, idiv, isin } from './fixed.ts';

// ------------------------------------------------------------------ czas i fale

/** Sekundy (float) -> tq8. Tylko na granicy z kodem, który jeszcze liczy w sekundach. */
export const secToQ8 = (s: number): number => Math.round(s * TICK_HZ * Q8);

/**
 * Prędkość kątowa (rad/s) -> jednostki kąta Q8 na tick Q8. Stała liczona przy "kompilacji" (w C: #define).
 * Kąt w chwili tq8 = (tq8 * w) >> 16 (mod 256) - przepełnienie uint32 nie szkodzi, liczą się dolne bity.
 */
export const angQ8 = (radPerSec: number): number => Math.round(((radPerSec * 256) / (2 * Math.PI) / TICK_HZ) * Q8);

/** Kąt w radianach -> jednostki 1/256 obrotu (stała). */
export const ang = (rad: number): number => Math.round((rad * 256) / (2 * Math.PI)) & 255;

/** Kąt (jednostki 1/256) dla prędkości `w` (z angQ8) w chwili tq8. */
export const phaseAt = (tq8: number, w: number): number => (Math.imul(tq8, w) >>> 16) & 255;

/** sin(w * t + ph) w Q14. */
export const wave = (tq8: number, w: number, ph = 0): number => isin(phaseAt(tq8, w) + ph);

/** a + (b - a) * kQ12 / 4096 (całkowite). */
export const lerpQ12 = (a: number, b: number, k: number): number => a + idiv((b - a) * k, Q12);

/** Postęp (t - t0) / dur w Q12, przycięty do 0..4096. Czasy w tq8. */
export const progressQ12 = (tq8: number, t0q8: number, durQ8: number): number => clampInt(idiv((tq8 - t0q8) * 16, durQ8 >> 8), 0, Q12);

// ------------------------------------------------------------------ krzywa narastania 1 - e^(-r t)

/** 1 - e^(-rate * t) w Q12; tablica 65 węzłów co `step` ticków (w C: static const uint16_t[]). */
export class ApproachCurve {
  private readonly lut: Uint16Array;
  readonly step: number;

  constructor(ratePerSec: number, step = 16) {
    this.step = step;
    this.lut = new Uint16Array(65);
    for (let i = 0; i <= 64; i++) this.lut[i] = Math.round((1 - Math.exp((-ratePerSec * i * step) / TICK_HZ)) * Q12);
  }

  /** Wartość w Q12 po `tq8` od startu (ujemne = 0). */
  at(tq8: number): number {
    if (tq8 <= 0) return 0;
    const span = this.step * Q8;
    const i = idiv(tq8, span);
    if (i >= 64) return this.lut[64];
    const f = tq8 - i * span;
    return this.lut[i] + idiv((this.lut[i + 1] - this.lut[i]) * f, span);
  }
}

// ------------------------------------------------------------------ ognisko

/** Liczba języków płomienia (kolory od zewnątrz). */
export const FLAME_TONGUES = 4;
const W_FLAME = [9, 12, 15, 18].map(angQ8); // 9 + 3i rad/s
const W_FLICK = angQ8(23);
const W_SWAY = [6, 7, 8, 9].map(angQ8);
const W_GLOW = angQ8(11);
const PH_FLAME = [0, 1, 2, 3].map((i) => ang(i * 1.7));
const PH_ONE = [0, 1, 2, 3].map((i) => ang(i));

/** Wysokość języka `i` jako ułamek Q12 (ok. 0.38..1.12) - 0.75 + 0.25 sin + 0.12 sin. */
export function flameKQ12(tq8: number, i: number): number {
  return 3072 + (wave(tq8, W_FLAME[i], PH_FLAME[i]) >> 4) + ((wave(tq8, W_FLICK, PH_ONE[i]) * 1966) >> 16);
}

/** Kołysanie języka `i` w Q8 pikseli przy size = 1 (±0.6 px). */
export function flameSwayQ8(tq8: number, i: number): number {
  return (wave(tq8, W_SWAY[i], PH_ONE[i]) * 614) >> 16;
}

/** Krycie poświaty w Q8 (0.13 ± 0.05). */
export function glowAlphaQ8(tq8: number): number {
  return 33 + ((wave(tq8, W_GLOW) * 51) >> 16);
}

// ------------------------------------------------------------------ pył / popiół / iskry

/**
 * Pole drobin w prostokącie z zawijaniem. Pozycje w Q8 pikseli, krok co tick:
 *   x += vx + 3 sin(0.8 (t + p)),  y += vy + 2 cos(1.1 (t + p))   [px/s]
 * Struktura tablic - w C: int32_t x[N], y[N]...
 */
export class MoteField {
  readonly n: number;
  readonly x: Int32Array;
  readonly y: Int32Array;
  /** Krycie Q8. */
  readonly alpha: Uint8Array;
  private readonly vx: Int32Array;
  private readonly vy: Int32Array;
  private readonly ph: Uint8Array;
  private readonly bx: number;
  private readonly by: number;
  private readonly bw: number;
  private readonly bh: number;
  private tick = 0;
  private static readonly WX = angQ8(0.8);
  private static readonly WY = angQ8(1.1);

  /** Prostokąt i prędkości w pikselach (na sekundę); `alpha` 0..1 - stałe konfiguracyjne. */
  constructor(n: number, box: { x: number; y: number; w: number; h: number }, vx: number, vy: number, seed: number, alpha = 0.5) {
    this.n = n;
    this.bx = box.x * Q8;
    this.by = box.y * Q8;
    this.bw = Math.max(1, box.w * Q8);
    this.bh = Math.max(1, box.h * Q8);
    this.x = new Int32Array(n);
    this.y = new Int32Array(n);
    this.alpha = new Uint8Array(n);
    this.vx = new Int32Array(n);
    this.vy = new Int32Array(n);
    this.ph = new Uint8Array(n);
    const r = new IntRng(seed);
    const vxq = Math.round((vx * Q8) / TICK_HZ), vyq = Math.round((vy * Q8) / TICK_HZ), aq = Math.round(alpha * Q8);
    for (let i = 0; i < n; i++) {
      this.x[i] = this.bx + r.below(this.bw);
      this.y[i] = this.by + r.below(this.bh);
      this.alpha[i] = Math.min(255, (aq * (102 + r.below(154))) >> 8); // 0.4..1.0
      this.vx[i] = (vxq * (128 + r.below(256))) >> 8; // 0.5..1.5
      this.vy[i] = (vyq * (128 + r.below(256))) >> 8;
      this.ph[i] = r.below(256);
    }
  }

  /** Jeden tick ruchu. */
  step(): void {
    const tq8 = this.tick++ * Q8;
    const ax = phaseAt(tq8, MoteField.WX), ay = phaseAt(tq8, MoteField.WY);
    for (let i = 0; i < this.n; i++) {
      let x = this.x[i] + this.vx[i] + ((isin(ax + this.ph[i]) * 61) >> 16);
      let y = this.y[i] + this.vy[i] + ((isin(ay + this.ph[i] + 64) * 41) >> 16);
      if (x >= this.bx + this.bw) x -= this.bw;
      else if (x < this.bx) x += this.bw;
      if (y >= this.by + this.bh) y -= this.bh;
      else if (y < this.by) y += this.bh;
      this.x[i] = x;
      this.y[i] = y;
    }
  }
}

// ------------------------------------------------------------------ błysk napisu (podtytuł na ekranie tytułowym)

/** Cykliczne przygaszenie: zjazd do `lowQ8`, przytrzymanie, powrót, długa pauza. Wynik: krycie Q8. */
export function blinkAlphaQ8(tick: number, period = 242, down = 5, hold = 3, lowQ8 = 115): number {
  const p = tick % period;
  if (p < down) return 256 - idiv((256 - lowQ8) * p, down);
  if (p < down + hold) return lowQ8;
  if (p < down * 2 + hold) return lowQ8 + idiv((256 - lowQ8) * (p - down - hold), down);
  return 256;
}

// ------------------------------------------------------------------ kafle tekstur dla miniGL

export interface TexTile {
  /** Wycinek obrazu źródłowego. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Rozmiar tekstury (potęga dwójki >= w, h). */
  texW: number;
  texH: number;
}

export const nextPow2 = (v: number): number => {
  let p = 1;
  while (p < v) p <<= 1;
  return p;
};

/** Podział obrazu w x h na kafle <= max (domyślnie 256 - limit miniGL / Warp3D), każdy w teksturze potęgi dwójki. */
export function potTiles(w: number, h: number, max = 256): TexTile[] {
  const out: TexTile[] = [];
  for (let y = 0; y < h; y += max)
    for (let x = 0; x < w; x += max) {
      const tw = Math.min(max, w - x), th = Math.min(max, h - y);
      out.push({ x, y, w: tw, h: th, texW: nextPow2(tw), texH: nextPow2(th) });
    }
  return out;
}

/** Pamięć tekstur w bajtach przy 16 bitach na piksel (RGB565 / ARGB1555). */
export const tilesBytes16 = (tiles: readonly TexTile[]): number => tiles.reduce((s, t) => s + t.texW * t.texH * 2, 0);
