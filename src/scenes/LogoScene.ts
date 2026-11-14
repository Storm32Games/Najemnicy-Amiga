import Phaser from 'phaser';
import { titleTexture } from './ui/PixelFont';
import { SoundManager } from '../audio/SoundManager';
import { BASE_H, BASE_W, enter, goto, label } from './ui/Kit';

// Logo studia STORM 32 (port Oldgame/src/scenes/logo.js): grafika assets/storm32-logo.jpg jest próbkowana do siatki
// małych kolorowych kostek, które sypią się z góry i układają w obraz; potem prawdziwy obraz przenika na wierzch.
// ~6.5 s, klik / klawisz pomija.

const SRC = 'assets/storm32-logo.jpg';
const GW = 192, GH = 108; // siatka kostek (16:9)
const P = 5; // piksele płótna na kostkę -> 960x540
const T_FLY = 3.2, T_FADE = 0.7, T_HOLD = 2.6, TOTAL = T_FLY + T_FADE + T_HOLD;
const BG = '#060a14';

interface Cube {
  x: number; y: number; sx: number; sy: number;
  delay: number; dur: number;
  col: string; hi: string; lo: string;
}

export class LogoScene extends Phaser.Scene {
  private cubes: Cube[] = [];
  private tex: Phaser.Textures.CanvasTexture | null = null;
  private img: Phaser.GameObjects.Image | null = null;
  private t = 0;
  private tick = 0;
  private shown = false;
  private finished = false;

  constructor() {
    super('LogoScene');
  }

  preload(): void {
    this.load.image('storm32', SRC);
  }

  create(): void {
    enter(this, 300);
    this.cameras.main.setBackgroundColor(BG);
    this.t = 0;
    this.tick = 0;
    this.shown = false;
    this.finished = false;
    this.cubes = [];
    this.img = null;

    if (this.textures.exists('logo_cubes')) this.textures.remove('logo_cubes');
    this.tex = this.textures.createCanvas('logo_cubes', GW * P, GH * P);
    this.add.image(0, 0, 'logo_cubes').setOrigin(0).setDisplaySize(BASE_W, BASE_H);

    if (this.textures.exists('storm32')) {
      const source = this.textures.get('storm32').getSourceImage() as HTMLImageElement;
      this.cubes = this.buildCubes(source);
      this.textures.get('storm32').setFilter(Phaser.Textures.FilterMode.LINEAR);
      const k = Math.min(BASE_W / source.width, BASE_H / source.height);
      this.img = this.add.image(BASE_W / 2, BASE_H / 2, 'storm32').setScale(k).setAlpha(0);
    } else {
      // brak pliku: od razu krótka plansza z nazwą studia
      this.add.image(BASE_W / 2, BASE_H / 2, titleTexture(this, 'logo_fallback', 'STORM 32', 3, { top: '#a8c4d2', bottom: '#5a7584' }));
      this.t = TOTAL - 1.5;
    }

    label(this, BASE_W - 6, BASE_H - 6, 'kliknij, aby pominąć', { size: 6, color: 0x556666 }).setOrigin(1, 1);
    this.input.once('pointerdown', () => this.skip());
    this.input.keyboard?.once('keydown', () => this.skip());

    SoundManager.music('logo');
    SoundManager.sfx('logo');
  }

  private buildCubes(img: HTMLImageElement): Cube[] {
    const c = document.createElement('canvas');
    c.width = GW;
    c.height = GH;
    const g = c.getContext('2d', { willReadFrequently: true });
    if (!g) return [];
    const k = Math.min(GW / img.width, GH / img.height), w = img.width * k, h = img.height * k;
    g.fillStyle = BG;
    g.fillRect(0, 0, GW, GH);
    g.drawImage(img, (GW - w) / 2, (GH - h) / 2, w, h);
    const d = g.getImageData(0, 0, GW, GH).data;
    const cubes: Cube[] = [];
    let sd = 32;
    const r = (): number => (sd = (Math.imul(sd ^ (sd >>> 15), 2246822519) + 0x9e3779b9) >>> 0) / 4294967296;
    for (let y = 0; y < GH; y++)
      for (let x = 0; x < GW; x++) {
        const o = (y * GW + x) * 4, R = d[o], G = d[o + 1], B = d[o + 2];
        const lum = Math.max(R, G, B), sat = lum - Math.min(R, G, B);
        if (lum < 58 && sat < 34) continue; // ciemne tło: bez kostki
        // kostki sypią się ukośnym strumieniem (lewe kolumny pierwsze), jasne nieco później - obraz "zapala się"
        const delay = 0.05 + (x / GW) * 0.9 + r() * 0.75 + (lum > 200 ? 0.15 : 0);
        cubes.push({
          x, y, sx: x + (r() - 0.5) * 70 + 18, sy: -8 - r() * 90, delay, dur: 0.75 + r() * 0.5,
          col: `rgb(${R},${G},${B})`,
          hi: `rgb(${Math.min(255, R + 46)},${Math.min(255, G + 46)},${Math.min(255, B + 46)})`,
          lo: `rgb(${(R * 0.55) | 0},${(G * 0.55) | 0},${(B * 0.6) | 0})`,
        });
      }
    return cubes;
  }

  private skip(): void {
    if (this.finished) return;
    this.finished = true;
    SoundManager.sfx('click');
    goto(this, 'IntroScene', undefined, 250);
  }

  update(_time: number, delta: number): void {
    const dt = Math.min(delta / 1000, 0.05);
    this.t += dt;
    const t = this.t;
    const tex = this.tex;
    if (tex && t < T_FLY + T_FADE + 0.1) {
      const g = tex.getContext();
      g.fillStyle = BG;
      g.fillRect(0, 0, GW * P, GH * P);
      let landed = 0;
      for (const c of this.cubes) {
        const k = (t - c.delay) / c.dur;
        if (k <= 0) continue;
        if (k >= 1) {
          g.fillStyle = c.col;
          g.fillRect(c.x * P, c.y * P, P, P);
          landed++;
          continue;
        }
        const e = 1 - Math.pow(1 - k, 3);
        const x = (c.sx + (c.x - c.sx) * e) * P, y = (c.sy + (c.y - c.sy) * e) * P, s = P * (1 + (1 - e) * 1.6);
        // spadająca kostka: jasna krawędź górna / lewa, ciemna dolna / prawa
        g.fillStyle = c.lo;
        g.fillRect(x + 1, y + 1, s, s);
        g.fillStyle = c.col;
        g.fillRect(x, y, s, s);
        g.fillStyle = c.hi;
        g.fillRect(x, y, s, 1);
        g.fillRect(x, y, 1, s);
      }
      tex.refresh();
      this.tick += dt;
      if (this.tick > 0.09 && landed < this.cubes.length && t < T_FLY - 0.4) {
        this.tick = 0;
        SoundManager.sfx('step', { vol: 0.12, pitch: 1.6 + Math.random() });
      }
    }
    if (t >= T_FLY && !this.shown) {
      this.shown = true;
      if (this.img) this.tweens.add({ targets: this.img, alpha: 1, duration: T_FADE * 1000, ease: 'Sine.easeInOut' });
      SoundManager.sfx('hit', { vol: 0.5, pitch: 0.7 });
    }
    if (t >= TOTAL - 0.5 && !this.finished) {
      this.finished = true;
      goto(this, 'IntroScene', undefined, 450);
    }
  }
}
