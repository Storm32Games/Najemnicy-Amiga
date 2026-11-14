// Przebieg intro i "maszyna do pisania" liczone w tickach 1/50 s (bez float i bez timerów przeglądarki).
// Scena tylko rysuje i reaguje na akcje; w porcie C to samo robi pętla VBlank.
import { Q8, TICK_HZ, idiv, secToTicks } from './fixed.ts';

/** Postęp wypisywania tekstu: `cps` znaków na sekundę, licznik w Q8 znaku. */
export class TypeProgress {
  private acc = 0;
  private readonly perTick: number;
  readonly length: number;

  constructor(length: number, cps = 34) {
    this.length = length;
    this.perTick = idiv(cps * Q8, TICK_HZ);
  }

  get shown(): number {
    const n = this.acc >> 8;
    return n < this.length ? n : this.length;
  }

  get done(): boolean {
    return this.shown >= this.length;
  }

  /** Przesuwa o `ticks`; zwraca liczbę nowo odsłoniętych znaków. */
  step(ticks: number): number {
    if (this.done) return 0;
    const before = this.shown;
    this.acc += ticks * this.perTick;
    return this.shown - before;
  }

  finish(): void {
    this.acc = this.length << 8;
  }
}

/** Co scena ma zrobić po wejściu gracza / ticku (w C: enum). */
export const IntroAction = { NONE: 0, SKIP_TEXT: 1, FADE_OUT: 2, SHOW: 3, FINISH: 4 } as const;
export type IntroAction = (typeof IntroAction)[keyof typeof IntroAction];

export const INTRO_AUTO_TICKS = secToTicks(4.5);
export const INTRO_SWITCH_TICKS = secToTicks(0.48);

/**
 * Plansze intro: tekst się pisze -> czeka (auto-przejście po 4.5 s) -> wygaszenie -> następna plansza.
 * `press` = klik / Enter / ogień, `skip` = Esc (całe intro).
 */
export class IntroFlow {
  index = 0;
  private waited = 0;
  private switchT = -1;

  readonly slides: number;
  readonly autoTicks: number;
  readonly switchTicks: number;

  constructor(slides: number, autoTicks = INTRO_AUTO_TICKS, switchTicks = INTRO_SWITCH_TICKS) {
    this.slides = slides;
    this.autoTicks = autoTicks;
    this.switchTicks = switchTicks;
  }

  get switching(): boolean {
    return this.switchT >= 0;
  }

  private advance(): IntroAction {
    if (this.index + 1 >= this.slides) return IntroAction.FINISH;
    this.switchT = 0;
    return IntroAction.FADE_OUT;
  }

  press(typingDone: boolean): IntroAction {
    if (this.switching) return IntroAction.NONE;
    if (!typingDone) return IntroAction.SKIP_TEXT;
    return this.advance();
  }

  skip(): IntroAction {
    return this.switching ? IntroAction.NONE : IntroAction.FINISH;
  }

  /** Jeden tick logiki. SHOW = pokaż planszę `index` (już przestawiony). */
  tick(typingDone: boolean): IntroAction {
    if (this.switching) {
      if (++this.switchT < this.switchTicks) return IntroAction.NONE;
      this.switchT = -1;
      this.index++;
      this.waited = 0;
      return IntroAction.SHOW;
    }
    if (!typingDone) return IntroAction.NONE;
    if (++this.waited > this.autoTicks) return this.advance();
    return IntroAction.NONE;
  }
}
