import Phaser from 'phaser';
import { titleTexture } from './ui/PixelFont';
import { SoundManager } from '../audio/SoundManager';
import { LOGO_BG, LOGO_GH, LOGO_GW, LOGO_TEX_H, LOGO_TEX_W, LOGO_TOTAL, LogoCubes, LogoEvent, LogoShow, Q12, Q8, TickClock, secToTicks, type CubePose } from '../core/frontend';
import { Settings } from './ui/Settings';
import { BASE_H, BASE_W, enter, goto, label } from './ui/Kit';

// Logo studia STORM 32 (port Oldgame/src/scenes/logo.js): grafika assets/storm32-logo.jpg jest próbkowana do siatki
// małych kolorowych kostek, które sypią się z góry i układają w obraz; potem prawdziwy obraz przenika na wierzch.
// ~6.5 s, klik / klawisz pomija.
//
// Logika (kostki, czasy, zdarzenia) siedzi w src/core/frontend/logo.ts - same inty i ticki 50 Hz, gotowe do C99.
// Rysowanie jest ułożone tak, jak zrobi to port na miniGL (A1200 + PiStorm):
//   - wylądowane kostki "stemplujemy" raz do tekstury 256x128 (potęga dwójki, użyte 160x90, skala x3) - odpowiednik
//     glTexSubImage2D tylko w klatkach, w których coś wylądowało, zamiast przesyłania płótna 960x540 co klatkę,
//   - co klatkę rysujemy tylko kostki w locie (kolorowe quady bez tekstur: glBegin(GL_QUADS)),
//   - profil Amiga pomija przenikanie do pełnego JPG-a (tekstura > 256 px), plansza zostaje z kostek.

const SRC = 'assets/storm32-logo.jpg';
/** Piksele projektowe na kostkę: 160x90 * 3 = 480x270. */
const P = BASE_W / LOGO_GW;
const T_FADE_MS = 700;
const BG_CSS = '#' + LOGO_BG.toString(16).padStart(6, '0');

export class LogoScene extends Phaser.Scene {
  private cubes: LogoCubes | null = null;
  private show = new LogoShow(null);
  private clock = new TickClock();
  private tex: Phaser.Textures.CanvasTexture | null = null;
  private pixels: ImageData | null = null;
  private fly: Phaser.GameObjects.Graphics | null = null;
  private img: Phaser.GameObjects.Image | null = null;
  private readonly pose: CubePose = { x: 0, y: 0, s: 0 };
  private finished = false;

  constructor() {
    super('LogoScene');
  }

  preload(): void {
    this.load.image('storm32', SRC);
  }

  create(): void {
    enter(this, 300);
    this.cameras.main.setBackgroundColor(BG_CSS);
    this.clock.reset();
    this.finished = false;
    this.cubes = null;
    this.img = null;
    const amiga = Settings.startAmiga;

    // tekstura wylądowanych kostek (POT 256x128)
    if (this.textures.exists('logo_landed')) this.textures.remove('logo_landed');
    this.tex = this.textures.createCanvas('logo_landed', LOGO_TEX_W, LOGO_TEX_H);
    const ctx = this.tex!.getContext();
    ctx.fillStyle = BG_CSS;
    ctx.fillRect(0, 0, LOGO_TEX_W, LOGO_TEX_H);
    this.pixels = ctx.getImageData(0, 0, LOGO_TEX_W, LOGO_TEX_H);
    this.tex!.refresh();
    this.add.image(0, 0, 'logo_landed').setOrigin(0).setCrop(0, 0, LOGO_GW, LOGO_GH).setScale(P);
    this.fly = this.add.graphics();

    if (this.textures.exists('storm32')) {
      const source = this.textures.get('storm32').getSourceImage() as HTMLImageElement;
      this.cubes = this.sample(source);
      if (!amiga) {
        this.textures.get('storm32').setFilter(Phaser.Textures.FilterMode.LINEAR);
        const k = Math.min(BASE_W / source.width, BASE_H / source.height);
        this.img = this.add.image(BASE_W / 2, BASE_H / 2, 'storm32').setScale(k).setAlpha(0);
      }
    } else {
      // brak pliku: od razu krótka plansza z nazwą studia
      this.add.image(BASE_W / 2, BASE_H / 2, titleTexture(this, 'logo_fallback', 'STORM 32', 3, { top: '#a8c4d2', bottom: '#5a7584' }));
      this.clock.reset(LOGO_TOTAL - secToTicks(1.5));
    }
    this.show = new LogoShow(this.cubes);

    label(this, BASE_W - 6, BASE_H - 6, 'kliknij, aby pominąć', { size: 6, color: 0x556666 }).setOrigin(1, 1);
    this.input.once('pointerdown', () => this.skip());
    this.input.keyboard?.once('keydown', () => this.skip());

    SoundManager.music('logo');
    SoundManager.sfx('logo');
  }

  /** Obraz -> piksele siatki 160x90 (RGBA) -> kostki w core. */
  private sample(img: HTMLImageElement): LogoCubes | null {
    const c = document.createElement('canvas');
    c.width = LOGO_GW;
    c.height = LOGO_GH;
    const g = c.getContext('2d', { willReadFrequently: true });
    if (!g) return null;
    const k = Math.min(LOGO_GW / img.width, LOGO_GH / img.height), w = img.width * k, h = img.height * k;
    g.fillStyle = BG_CSS;
    g.fillRect(0, 0, LOGO_GW, LOGO_GH);
    g.drawImage(img, (LOGO_GW - w) / 2, (LOGO_GH - h) / 2, w, h);
    return new LogoCubes(g.getImageData(0, 0, LOGO_GW, LOGO_GH).data, 4);
  }

  private skip(): void {
    if (this.finished) return;
    this.finished = true;
    SoundManager.sfx('click');
    goto(this, 'IntroScene', undefined, 250);
  }

  update(_time: number, delta: number): void {
    this.clock.advance(delta);
    const tq8 = this.clock.timeQ8;
    const cubes = this.cubes;

    if (cubes && this.tex && this.pixels && this.fly) {
      // 1) nowe wylądowane kostki -> piksele tekstury (tylko gdy coś doszło)
      const px = this.pixels.data;
      const landed = cubes.drainLanded(tq8, (i) => {
        const o = (cubes.y[i] * LOGO_TEX_W + cubes.x[i]) * 4, c = cubes.col[i];
        px[o] = c >>> 16;
        px[o + 1] = (c >>> 8) & 255;
        px[o + 2] = c & 255;
      });
      if (landed) {
        this.tex.getContext().putImageData(this.pixels, 0, 0, 0, 0, LOGO_GW, LOGO_GH);
        this.tex.refresh();
      }
      // 2) kostki w locie: cień, ściana, jasna krawędź górna / lewa
      const g = this.fly.clear();
      const k = P / Q12;
      cubes.forEachFlying(tq8, this.pose, (i, p) => {
        const x = p.x * k, y = p.y * k, s = p.s * k;
        g.fillStyle(cubes.lo[i], 1).fillRect(x + 0.5, y + 0.5, s, s);
        g.fillStyle(cubes.col[i], 1).fillRect(x, y, s, s);
        g.fillStyle(cubes.hi[i], 1).fillRect(x, y, s, 0.5).fillRect(x, y, 0.5, s);
      });
    }

    const ev = this.show.update(tq8 >> 8);
    if (ev & LogoEvent.STEP) SoundManager.sfx('step', { vol: 0.12, pitch: this.show.stepPitchQ8() / Q8 });
    if (ev & LogoEvent.REVEAL) {
      if (this.img) this.tweens.add({ targets: this.img, alpha: 1, duration: T_FADE_MS, ease: 'Sine.easeInOut' });
      SoundManager.sfx('hit', { vol: 0.5, pitch: 0.7 });
    }
    if (ev & LogoEvent.DONE && !this.finished) {
      this.finished = true;
      goto(this, 'IntroScene', undefined, 450);
    }
  }
}
