// Logo studia STORM 32: obraz próbkowany do siatki kolorowych kostek, które spadają i układają się w grafikę.
// Czysta logika (bez Phasera / DOM / float): renderer podaje piksele RGB, dostaje pozycje kostek w Q12.
//
// Układ danych jak struktura tablic w C (static int16_t x[MAX]...), kostki posortowane po chwili lądowania
// (sortowanie przez zliczanie - w C bez qsort). Dzięki temu w każdej klatce:
//   - wylądowane kostki odbiera się kursorem tylko raz (drainLanded) i "stempluje" do tekstury 256x128,
//     więc nie trzeba ich rysować co klatkę (miniGL: jeden glTexSubImage2D zamiast tysięcy quadów),
//   - rysuje się wyłącznie kostki w locie (forEachFlying), a pętla kończy się, gdy dalsze nie mogły jeszcze wystartować.
import { IntRng, Q12, Q8, easeOut3, idiv, secToTicks } from './fixed.ts';

/** Siatka kostek 16:9; 160x90 * 3 piksele = 480x270 (całkowita skala, mieści się w teksturze 256x128). */
export const LOGO_GW = 160;
export const LOGO_GH = 90;
/** Rozmiar tekstury potęgi dwójki dla wylądowanych kostek (limit tekstur miniGL / Warp3D: 256x256). */
export const LOGO_TEX_W = 256;
export const LOGO_TEX_H = 128;

export const LOGO_T_FLY = secToTicks(3.2);
export const LOGO_T_FADE = secToTicks(0.7);
export const LOGO_T_HOLD = secToTicks(2.6);
export const LOGO_TOTAL = LOGO_T_FLY + LOGO_T_FADE + LOGO_T_HOLD;
/** Kolor tła (0xRRGGBB). */
export const LOGO_BG = 0x060a14;

const DUR_MIN = secToTicks(0.75);
const DUR_SPAN = secToTicks(0.5);
/** Najdłuższy możliwy lot - ogranicza pętlę po kostkach w locie. */
export const LOGO_MAX_DUR = DUR_MIN + DUR_SPAN;
const STEP_EVERY = 5; // ~0.1 s między stukotami spadających kostek
const STEP_UNTIL = LOGO_T_FLY - secToTicks(0.4);

/** Zdarzenia z LogoShow.update (maska bitowa - w C: #define). */
export const LogoEvent = { STEP: 1, REVEAL: 2, DONE: 4 } as const;

export interface CubePose {
  /** Lewy górny róg w jednostkach kostki, Q12. */
  x: number;
  y: number;
  /** Bok kostki w jednostkach kostki, Q12 (4096 = 1 kostka). */
  s: number;
}

export class LogoCubes {
  readonly count: number;
  /** Docelowe pole siatki. */
  readonly x: Int16Array;
  readonly y: Int16Array;
  /** Pole startu (nad ekranem, z boku). */
  readonly sx: Int16Array;
  readonly sy: Int16Array;
  /** Start i czas lotu w tickach. */
  readonly delay: Uint16Array;
  readonly dur: Uint16Array;
  /** Tick lądowania = delay + dur (rosnąco). */
  readonly land: Uint16Array;
  /** Kolory 0xRRGGBB: ściana, jasna krawędź, cień. */
  readonly col: Uint32Array;
  readonly hi: Uint32Array;
  readonly lo: Uint32Array;
  private cursor = 0;

  /**
   * `rgb` - piksele siatki LOGO_GW x LOGO_GH (3 bajty na piksel, obraz już wpasowany i z tłem LOGO_BG).
   * Ciemne, mało nasycone piksele to tło - bez kostki.
   */
  constructor(rgb: Uint8Array | Uint8ClampedArray, stride = 3, seed = 32) {
    const N = LOGO_GW * LOGO_GH;
    const rng = new IntRng(seed);
    // przebieg 1: dane w kolejności siatki
    const tx = new Int16Array(N), ty = new Int16Array(N), tsx = new Int16Array(N), tsy = new Int16Array(N);
    const td = new Uint16Array(N), tu = new Uint16Array(N), tc = new Uint32Array(N);
    let n = 0;
    for (let y = 0; y < LOGO_GH; y++)
      for (let x = 0; x < LOGO_GW; x++) {
        const o = (y * LOGO_GW + x) * stride;
        const R = rgb[o], G = rgb[o + 1], B = rgb[o + 2];
        const lum = Math.max(R, G, B), sat = lum - Math.min(R, G, B);
        if (lum < 58 && sat < 34) continue;
        // ukośny strumień (lewe kolumny pierwsze), jasne piksele nieco później - obraz "zapala się"
        td[n] = 2 + idiv(x * 45, LOGO_GW) + rng.below(38) + (lum > 200 ? 8 : 0);
        tx[n] = x;
        ty[n] = y;
        tsx[n] = x + rng.below(59) - 29 + 15;
        tsy[n] = -7 - rng.below(76);
        tu[n] = DUR_MIN + rng.below(DUR_SPAN + 1);
        tc[n] = (R << 16) | (G << 8) | B;
        n++;
      }
    this.count = n;
    // przebieg 2: sortowanie przez zliczanie po ticku lądowania (stabilne)
    let maxLand = 0;
    for (let i = 0; i < n; i++) maxLand = Math.max(maxLand, td[i] + tu[i]);
    const bucket = new Uint32Array(maxLand + 2);
    for (let i = 0; i < n; i++) bucket[td[i] + tu[i] + 1]++;
    for (let k = 1; k < bucket.length; k++) bucket[k] += bucket[k - 1];
    this.x = new Int16Array(n);
    this.y = new Int16Array(n);
    this.sx = new Int16Array(n);
    this.sy = new Int16Array(n);
    this.delay = new Uint16Array(n);
    this.dur = new Uint16Array(n);
    this.land = new Uint16Array(n);
    this.col = new Uint32Array(n);
    this.hi = new Uint32Array(n);
    this.lo = new Uint32Array(n);
    for (let i = 0; i < n; i++) {
      const j = bucket[td[i] + tu[i]]++;
      this.x[j] = tx[i];
      this.y[j] = ty[i];
      this.sx[j] = tsx[i];
      this.sy[j] = tsy[i];
      this.delay[j] = td[i];
      this.dur[j] = tu[i];
      this.land[j] = td[i] + tu[i];
      const c = tc[i], R = c >>> 16, G = (c >>> 8) & 255, B = c & 255;
      this.col[j] = c;
      this.hi[j] = (Math.min(255, R + 46) << 16) | (Math.min(255, G + 46) << 8) | Math.min(255, B + 46);
      this.lo[j] = (((R * 141) >> 8) << 16) | (((G * 141) >> 8) << 8) | ((B * 154) >> 8); // ~0.55 / 0.6
    }
  }

  /** Ile kostek już wylądowało (od ostatniego reset). */
  get landed(): number {
    return this.cursor;
  }

  reset(): void {
    this.cursor = 0;
  }

  /** Woła `fn` dla każdej kostki, która wylądowała do chwili `tq8` (Q8 ticków) i nie była jeszcze zgłoszona. */
  drainLanded(tq8: number, fn: (i: number) => void): number {
    let k = 0;
    while (this.cursor < this.count && this.land[this.cursor] * Q8 <= tq8) {
      fn(this.cursor++);
      k++;
    }
    return k;
  }

  /** Pozycja kostki `i` w locie w chwili `tq8`; false = jeszcze nie wystartowała albo już leży. */
  pose(i: number, tq8: number, out: CubePose): boolean {
    const t0 = this.delay[i] * Q8;
    if (tq8 <= t0 || tq8 >= this.land[i] * Q8) return false;
    const k = idiv((tq8 - t0) * 16, this.dur[i]); // Q12: (t - t0) / (dur * 256) * 4096
    const e = easeOut3(k);
    out.x = this.sx[i] * Q12 + (this.x[i] - this.sx[i]) * e;
    out.y = this.sy[i] * Q12 + (this.y[i] - this.sy[i]) * e;
    out.s = Q12 + idiv((Q12 - e) * 8, 5); // 1 + (1 - e) * 1.6
    return true;
  }

  /** Kostki w locie w chwili `tq8` (tylko te za kursorem wylądowanych; przerywa, gdy dalsze nie mogły wystartować). */
  forEachFlying(tq8: number, out: CubePose, fn: (i: number, p: CubePose) => void): number {
    let k = 0;
    const tick = tq8 >> 8;
    for (let i = this.cursor; i < this.count; i++) {
      if (this.land[i] - LOGO_MAX_DUR > tick) break; // delay >= land - MAX_DUR > t
      if (this.pose(i, tq8, out)) {
        fn(i, out);
        k++;
      }
    }
    return k;
  }
}

/** Przebieg całej planszy logo w tickach: zdarzenia dźwiękowe, odsłonięcie obrazu, koniec. */
export class LogoShow {
  private stepAt = 0;
  private flags = 0;
  private readonly rng = new IntRng(0x5732);

  readonly cubes: LogoCubes | null;

  constructor(cubes: LogoCubes | null) {
    this.cubes = cubes;
  }

  /** Zdarzenia (maska LogoEvent) dla ticka `tick`; każde REVEAL / DONE zgłaszane raz. */
  update(tick: number): number {
    let ev = 0;
    const c = this.cubes;
    if (c && tick < STEP_UNTIL && c.landed < c.count && tick - this.stepAt >= STEP_EVERY) {
      this.stepAt = tick;
      ev |= LogoEvent.STEP;
    }
    if (tick >= LOGO_T_FLY && !(this.flags & LogoEvent.REVEAL)) ev |= LogoEvent.REVEAL;
    if (tick >= LOGO_TOTAL - secToTicks(0.5) && !(this.flags & LogoEvent.DONE)) ev |= LogoEvent.DONE;
    this.flags |= ev & (LogoEvent.REVEAL | LogoEvent.DONE);
    return ev;
  }

  /** Wysokość dźwięku stukotu w Q8 (1.6..2.6). */
  stepPitchQ8(): number {
    return 410 + this.rng.below(256);
  }
}
