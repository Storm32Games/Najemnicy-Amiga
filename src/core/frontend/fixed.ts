// Arytmetyka stałoprzecinkowa i zegar logiki dla ekranów startowych (logo, intro, menu).
// Czysty TypeScript bez Phasera / DOM i BEZ liczb zmiennoprzecinkowych w logice: każda funkcja przekłada się 1:1
// na C99 (int32_t / uint32_t, przesunięcia bitowe), więc port na A1200 + PiStorm (Emu68) daje identyczne klatki
// bez zależności od FPU 68881/68882 (80-bitowa precyzja pośrednia = inne zaokrąglenia niż double w przeglądarce).
//
// Konwencje:
//   Q12  - ułamek * 4096 (1.0 = 4096), Q8 - ułamek * 256.
//   tick - 1/50 s: logika chodzi w rytmie wygaszania pionowego PAL (VBlank), renderer może interpolować między tickami.

/** Częstotliwość logiki (PAL VBlank). */
export const TICK_HZ = 50;
export const Q12 = 4096;
export const Q8 = 256;

/** Sekundy -> ticki (zaokrąglone; tylko do stałych liczonych przy kompilacji, w C: #define). */
export const secToTicks = (s: number): number => Math.round(s * TICK_HZ);

/** Dzielenie całkowite z obcięciem do zera - jak `/` na int w C99. */
export const idiv = (a: number, b: number): number => (a / b) | 0;

export const clampInt = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

// ------------------------------------------------------------------ tablice (w C: static const int16_t[])

/** Sinus w Q14 dla 256 kroków kąta (pełny obrót = 256). Liczony raz; w C wklejony jako tablica. */
export const SIN_LUT: Int16Array = (() => {
  const t = new Int16Array(256);
  for (let i = 0; i < 256; i++) t[i] = Math.round(Math.sin((i / 256) * Math.PI * 2) * 16384);
  return t;
})();

/** sin(kąt) w Q14, kąt w jednostkach 1/256 obrotu (dowolna liczba całkowita, zawija się). */
export const isin = (a: number): number => SIN_LUT[a & 255];
export const icos = (a: number): number => SIN_LUT[(a + 64) & 255];

/** Krzywa "ease-out cubic" 1-(1-k)^3 w Q12 próbkowana w 64 przedziałach (65 węzłów). */
export const EASE_OUT3_LUT: Uint16Array = (() => {
  const t = new Uint16Array(65);
  for (let i = 0; i <= 64; i++) t[i] = Math.round((1 - Math.pow(1 - i / 64, 3)) * Q12);
  return t;
})();

/** ease-out cubic: k w Q12 (0..4096) -> wynik w Q12, interpolacja liniowa między węzłami tablicy (same inty). */
export function easeOut3(kq12: number): number {
  if (kq12 <= 0) return 0;
  if (kq12 >= Q12) return Q12;
  const i = kq12 >> 6; // 4096 / 64 = 64 jednostki Q12 na przedział
  const f = kq12 & 63;
  const a = EASE_OUT3_LUT[i];
  return a + (((EASE_OUT3_LUT[i + 1] - a) * f) >> 6);
}

// ------------------------------------------------------------------ losowanie całkowite

/**
 * mulberry32 na liczbach całkowitych (ten sam algorytm co makeRng w rules/dice.ts, ale bez dzielenia na float).
 * below(n) = (u * n) >> 32 - w C: (uint32_t)(((uint64_t)u * n) >> 32). Dokładne dla n < 2^21.
 */
export class IntRng {
  private a: number;

  constructor(seed: number) {
    this.a = seed >>> 0;
  }

  nextU32(): number {
    this.a = (this.a + 0x6d2b79f5) >>> 0;
    let t = this.a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  }

  /** Liczba całkowita z [0, n). */
  below(n: number): number {
    return Math.floor((this.nextU32() * n) / 4294967296);
  }

  /** Liczba całkowita z [a, b]. */
  range(a: number, b: number): number {
    return a + this.below(b - a + 1);
  }
}

// ------------------------------------------------------------------ zegar o stałym kroku

/**
 * Akumulator czasu: renderer podaje milisekundy klatki, logika dostaje całe ticki 1/50 s.
 * W porcie na Amigę ticki liczy przerwanie VBlank, a `alphaQ8` służy tylko do płynnego rysowania na RTG > 50 Hz.
 */
export class TickClock {
  /** Całkowita liczba ticków od startu. */
  tick = 0;
  /** Reszta w mikrotickach (1 tick = TICK_US). */
  private accUs = 0;
  private static readonly TICK_US = 1000000 / TICK_HZ; // 20000 - całkowite

  /** Przesuwa zegar o `ms` (ucinane do `maxTicks`, żeby po zatrzymaniu karty nie nadrabiać sekund); zwraca liczbę nowych ticków. */
  advance(ms: number, maxTicks = 5): number {
    this.accUs += Math.max(0, Math.round(ms * 1000));
    let n = Math.floor(this.accUs / TickClock.TICK_US);
    this.accUs -= n * TickClock.TICK_US;
    if (n > maxTicks) {
      n = maxTicks;
      this.accUs = 0;
    }
    this.tick += n;
    return n;
  }

  /** Postęp do następnego ticka w Q8 (0..255). */
  get alphaQ8(): number {
    return ((this.accUs * Q8) / TickClock.TICK_US) | 0;
  }

  /** Czas w Q8 ticków (tick * 256 + alpha) - do interpolacji animacji. */
  get timeQ8(): number {
    return this.tick * Q8 + this.alphaQ8;
  }

  reset(tick = 0): void {
    this.tick = tick;
    this.accUs = 0;
  }
}
