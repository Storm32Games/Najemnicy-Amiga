import Phaser from 'phaser';
import { SoundManager } from '../../audio/SoundManager';
import { Settings } from './Settings';

// Wspólny zestaw UI scen menu + model rozdzielczości.
//
// Gra jest komponowana na siatce projektowej 480x270 (BASE_W x BASE_H) - wszystkie współrzędne scen są w tych
// "pikselach projektowych". Płótno ma jednak rozmiar BASE * ZOOM, a każda kamera ma zoom = ZOOM, więc pixel art
// zostaje gruby, a tekst (renderowany z resolution = ZOOM) jest ostry i czytelny.
// (Odpowiednik Engine.pixelScale z Oldgame/src/core/engine.js.)

export const BASE_W = 480;
export const BASE_H = 270;

/** Zoom dopasowany do okna (tryb "Automatyczna"). */
export function autoZoom(): number {
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const fit = Math.min(window.innerWidth / BASE_W, window.innerHeight / BASE_H) * dpr;
  return Math.max(2, Math.min(6, Math.ceil(fit)));
}
function pickZoom(): number {
  const r = Settings.startRes;
  return r === 'auto' ? autoZoom() : r;
}
/** Piksele płótna na piksel projektowy (stałe przez całą sesję). */
export const ZOOM = pickZoom();

/** Przesunięcie obiektów ze scrollFactor(0) przy kamerze z zoomem wokół środka: pozycja ekranu (x, y) -> (x + SX0, y + SY0). */
export const SX0 = (BASE_W / 2) * (ZOOM - 1);
export const SY0 = (BASE_H / 2) * (ZOOM - 1);

export const FONT = '"Menlo", "Consolas", "DejaVu Sans Mono", "Courier New", monospace';

/** Paleta z Oldgame/index.html (:root). */
export const PAL = {
  bg: 0x0b0a09,
  panel: 0x1a1612,
  panel2: 0x241e18,
  edge: 0x6b5233,
  edgeHi: 0xc08a3e,
  text: 0xe8dcc0,
  dim: 0x9a8b70,
  amber: 0xf2a93b,
  rust: 0xb4532a,
  toxic: 0x8fd14f,
  blood: 0xc43d2f,
  steel: 0x7f9aa8,
  good: 0x7fc46a,
  bad: 0xe0553f,
} as const;

export const hex = (c: number): string => `#${c.toString(16).padStart(6, '0')}`;
/** '#rrggbb' -> 0xRRGGBB (z bezpiecznym zapasem). */
export const parseColor = (s: string | undefined, fallback: number): number => {
  if (!s) return fallback;
  const m = /^#?([0-9a-f]{6})$/i.exec(s);
  if (m) return parseInt(m[1], 16);
  const m3 = /^#?([0-9a-f]{3})$/i.exec(s);
  if (m3) return parseInt([...m3[1]].map((c) => c + c).join(''), 16);
  return fallback;
};
export const cut = (s: string, n: number): string => (s.length > n ? s.slice(0, n - 1) + '…' : s);

/** Kamera sceny statycznej: widzi dokładnie prostokąt projektowy 0..480 x 0..270. */
export function fitCamera(scene: Phaser.Scene): Phaser.Cameras.Scene2D.Camera {
  const cam = scene.cameras.main;
  cam.setZoom(ZOOM);
  cam.centerOn(BASE_W / 2, BASE_H / 2);
  return cam;
}

export interface LabelOptions {
  size?: number;
  color?: number;
  bold?: boolean;
  italic?: boolean;
  /** Szerokość zawijania w pikselach projektowych. */
  wrap?: number;
  align?: 'left' | 'center' | 'right';
  shadow?: boolean;
  lineSpacing?: number;
}

/**
 * Ostry tekst: rasteryzowany czcionką ZOOM-krotnie większą i pomniejszony o 1/ZOOM, więc trafia 1:1 w piksele płótna,
 * a odstępy wierszy są równe. UWAGA: rozmiar w pikselach projektowych to displayWidth / displayHeight (nie width / height).
 */
export function label(scene: Phaser.Scene, x: number, y: number, s: string, o: LabelOptions = {}): Phaser.GameObjects.Text {
  const style: Phaser.Types.GameObjects.Text.TextStyle = {
    fontFamily: FONT,
    fontSize: `${(o.size ?? 8) * ZOOM}px`,
    fontStyle: `${o.italic ? 'italic ' : ''}${o.bold ? 'bold' : ''}`.trim() || 'normal',
    color: hex(o.color ?? PAL.text),
    align: o.align ?? 'left',
    lineSpacing: (o.lineSpacing ?? 1) * ZOOM,
  };
  if (o.wrap) style.wordWrap = { width: o.wrap * ZOOM, useAdvancedWrap: true };
  const t = scene.add.text(x, y, s, style).setScale(1 / ZOOM);
  if (o.shadow !== false) t.setShadow(0.5 * ZOOM, 0.5 * ZOOM, '#000000', 0, false, true);
  return t;
}

/** Panel w stylu starego .panel: ciemne tło, rdzawa ramka, twardy cień. Połyka kliknięcia. */
export function panel(scene: Phaser.Scene, x: number, y: number, w: number, h: number, edge: number = PAL.edge, alpha = 0.94): Phaser.GameObjects.Container {
  const shadow = scene.add.rectangle(2, 2, w, h, 0x000000, 0.5).setOrigin(0);
  const bg = scene.add.rectangle(0, 0, w, h, PAL.panel, alpha).setOrigin(0).setStrokeStyle(1, edge).setInteractive();
  return scene.add.container(x, y, [shadow, bg]);
}

export interface UiButton {
  box: Phaser.GameObjects.Container;
  setEnabled(on: boolean): void;
  setLabel(s: string): void;
}

export interface ButtonOptions {
  w?: number;
  h?: number;
  size?: number;
  primary?: boolean;
  danger?: boolean;
  enabled?: boolean;
}

/** Przycisk w stylu starego .btn. (x, y) = lewy górny róg. */
export function button(scene: Phaser.Scene, x: number, y: number, text: string, onClick: () => void, o: ButtonOptions = {}): UiButton {
  const size = o.size ?? 8;
  const t = label(scene, 0, 0, text.toUpperCase(), { size, bold: true }).setOrigin(0.5);
  const w = o.w ?? Math.ceil(t.displayWidth) + 14;
  const h = o.h ?? size + 8;
  const base = o.primary ? PAL.amber : o.danger ? PAL.bad : PAL.text;
  const edge = o.primary ? PAL.amber : o.danger ? PAL.blood : PAL.edge;
  const shadow = scene.add.rectangle(1.5, 1.5, w, h, 0x000000, 0.8).setOrigin(0);
  const bg = scene.add.rectangle(0, 0, w, h, PAL.panel2, 1).setOrigin(0).setStrokeStyle(1, edge).setInteractive({ useHandCursor: true });
  t.setPosition(w / 2, h / 2).setColor(hex(base));
  const box = scene.add.container(x, y, [shadow, bg, t]);
  let enabled = o.enabled ?? true;
  const paint = (hover: boolean) => {
    bg.setFillStyle(hover && enabled ? 0x3a2c1e : PAL.panel2, 1).setStrokeStyle(1, hover && enabled ? PAL.edgeHi : edge);
    t.setColor(hex(hover && enabled ? 0xffffff : base));
    box.setAlpha(enabled ? 1 : 0.4);
  };
  bg.on('pointerover', () => {
    if (enabled) SoundManager.sfx('hover');
    paint(true);
  });
  bg.on('pointerout', () => paint(false));
  bg.on('pointerdown', (_p: Phaser.Input.Pointer, _x: number, _y: number, ev: Phaser.Types.Input.EventData) => {
    ev?.stopPropagation();
    if (!enabled) return;
    SoundManager.sfx('click');
    onClick();
  });
  paint(false);
  return {
    box,
    setEnabled(on) {
      enabled = on;
      paint(false);
    },
    setLabel(s) {
      t.setText(s.toUpperCase());
    },
  };
}

/** Przejście do innej sceny przez wygaszenie do czerni (jak fadeLayer + Game.goto w Oldgame). */
export function goto(scene: Phaser.Scene, key: string, data?: object, ms = 400): void {
  const st = scene.data;
  if (st.get('leaving')) return;
  st.set('leaving', true);
  scene.input.enabled = false;
  scene.cameras.main.fadeOut(ms, 0, 0, 0);
  scene.time.delayedCall(ms + 20, () => scene.scene.start(key, data));
}

/** Wołane na początku create(): kamera, wejście z czerni, reset flagi przejścia. */
export function enter(scene: Phaser.Scene, ms = 500): void {
  scene.data.set('leaving', false);
  scene.input.enabled = true;
  fitCamera(scene).fadeIn(ms, 0, 0, 0);
}

/** Maszyna do pisania (port Typewriter z Oldgame/src/scenes/meta/common.js). */
export class Typewriter {
  private shown = 0;
  private acc = 0;
  private readonly chars: string[];
  private readonly target: Phaser.GameObjects.Text;
  private readonly cps: number;

  constructor(target: Phaser.GameObjects.Text, text: string, cps = 34) {
    this.target = target;
    this.cps = cps;
    // zawijamy cały tekst z góry, żeby słowa nie przeskakiwały między wierszami w trakcie pisania
    this.chars = [...target.getWrappedText(text).join('\n')];
    target.setText('');
  }

  get done(): boolean {
    return this.shown >= this.chars.length;
  }

  finish(): void {
    this.shown = this.chars.length;
    this.target.setText(this.chars.join(''));
  }

  update(dt: number): void {
    if (this.done) return;
    this.acc += dt * this.cps;
    const n = Math.floor(this.acc);
    if (n <= 0) return;
    this.acc -= n;
    const before = this.shown;
    this.shown = Math.min(this.chars.length, this.shown + n);
    this.target.setText(this.chars.slice(0, this.shown).join(''));
    if (this.chars.slice(before, this.shown).some((c) => c.trim())) SoundManager.sfx('typewriter', { vol: 0.35 });
  }
}

// ------------------------------------------------------------------ tła rysowane na płótnie 2D

export type Stops = readonly (readonly [number, string])[];
export type Ctx2D = CanvasRenderingContext2D;

/** Deterministyczny mulberry32 dla dekoracji (rngSeed z Oldgame). */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Tekstura-płótno (zastępuje istniejącą o tym samym kluczu). */
export function canvasTexture(scene: Phaser.Scene, key: string, w: number, h: number, draw: (g: Ctx2D, w: number, h: number) => void): string {
  if (scene.textures.exists(key)) scene.textures.remove(key);
  const tex = scene.textures.createCanvas(key, w, h);
  if (tex) {
    draw(tex.getContext(), w, h);
    tex.refresh();
  }
  return key;
}

/** Pasmowany (pixel-artowy) gradient nieba. */
export function skyGradient(g: Ctx2D, w: number, h: number, stops: Stops, band = 3): void {
  const grad = g.createLinearGradient(0, 0, 0, h);
  for (const [p, c] of stops) grad.addColorStop(p, c);
  const tmp = document.createElement('canvas');
  tmp.width = 1;
  tmp.height = h;
  const tg = tmp.getContext('2d')!;
  tg.fillStyle = grad;
  tg.fillRect(0, 0, 1, h);
  const d = tg.getImageData(0, 0, 1, h).data;
  for (let y = 0; y < h; y += band) {
    const i = Math.min(h - 1, y + (band >> 1)) * 4;
    g.fillStyle = `rgb(${d[i]},${d[i + 1]},${d[i + 2]})`;
    g.fillRect(0, y, w, band);
  }
}

export interface SkylineOptions {
  n: number;
  base: number;
  hMin: number;
  hMax: number;
  color: string;
  lit?: string | null;
  wMin?: number;
  wMax?: number;
}

/** Rząd zrujnowanych wieżowców (sylwetki z poszarpanymi szczytami i pojedynczymi światłami w oknach). */
export function skyline(g: Ctx2D, w: number, rnd: () => number, o: SkylineOptions): void {
  const wMin = o.wMin ?? 8, wMax = o.wMax ?? 20;
  for (let i = 0; i < o.n; i++) {
    const bw = Math.round(wMin + rnd() * (wMax - wMin));
    const bh = Math.round(o.hMin + rnd() * (o.hMax - o.hMin));
    const x = Math.round(((i + rnd() * 0.6) / o.n) * (w + 20)) - 10;
    g.fillStyle = o.color;
    g.fillRect(x, o.base - bh, bw, bh);
    // wyszczerbiony szczyt
    if (rnd() < 0.6) {
      const cw = Math.max(2, Math.round(bw * (0.3 + rnd() * 0.4)));
      g.fillRect(x + Math.round(rnd() * (bw - cw)), o.base - bh - 1 - Math.round(rnd() * 4), cw, 5);
    }
    if (rnd() < 0.35) g.clearRect(x + Math.round(rnd() * (bw - 3)), o.base - bh, 3, 2 + Math.round(rnd() * 3));
    if (o.lit) {
      g.fillStyle = o.lit;
      for (let wy = o.base - bh + 3; wy < o.base - 3; wy += 4) for (let wx = x + 2; wx < x + bw - 2; wx += 3) if (rnd() < 0.07) g.fillRect(wx, wy, 1, 2);
    }
  }
}

/** Pasmo wydm: sinusoidalna linia horyzontu wypełniona w dół. */
export function dunes(g: Ctx2D, w: number, h: number, y0: number, amp: number, color: string, seed: number, freq = 0.03): void {
  g.fillStyle = color;
  for (let x = 0; x < w; x++) {
    const y = Math.round(y0 + Math.sin(x * freq + seed) * amp + Math.sin(x * freq * 2.7 + seed * 1.7) * amp * 0.4);
    g.fillRect(x, y, 1, h - y);
  }
}

export interface Mote {
  img: Phaser.GameObjects.Rectangle;
  vx: number;
  vy: number;
  ph: number;
}

/** Drobiny (pył / popiół / iskry) zawijane w prostokącie. */
export class Motes {
  private readonly items: Mote[] = [];
  private readonly box: { x: number; y: number; w: number; h: number };

  constructor(scene: Phaser.Scene, n: number, box: { x: number; y: number; w: number; h: number }, color: number, vx: number, vy: number, seed: number, alpha = 0.5, depth = 5) {
    this.box = box;
    const r = seeded(seed);
    for (let i = 0; i < n; i++) {
      const img = scene.add.rectangle(box.x + r() * box.w, box.y + r() * box.h, 1, 1, color, alpha * (0.4 + r() * 0.6)).setDepth(depth);
      this.items.push({ img, vx: vx * (0.5 + r()), vy: vy * (0.5 + r()), ph: r() * 10 });
    }
  }

  update(dt: number): void {
    const b = this.box;
    for (const m of this.items) {
      m.ph += dt;
      m.img.x += (m.vx + Math.sin(m.ph * 0.8) * 3) * dt;
      m.img.y += (m.vy + Math.cos(m.ph * 1.1) * 2) * dt;
      if (m.img.x > b.x + b.w) m.img.x -= b.w;
      if (m.img.x < b.x) m.img.x += b.w;
      if (m.img.y > b.y + b.h) m.img.y -= b.h;
      if (m.img.y < b.y) m.img.y += b.h;
    }
  }
}

/** Ognisko: migoczące płomienie z prostokątów + poświata. Zwraca funkcję aktualizującą. */
export function campfire(scene: Phaser.Scene, x: number, y: number, size = 1, depth = 4): (t: number) => void {
  const glow = scene.add.ellipse(x, y - 2 * size, 46 * size, 22 * size, 0xff8a30, 0.16).setDepth(depth - 1);
  const logs = scene.add.rectangle(x, y, 9 * size, 2 * size, 0x3a2410).setDepth(depth);
  const cols = [0xc43d1a, 0xff8a30, 0xffc860, 0xfff0a0];
  const tongues = cols.map((c, i) => scene.add.rectangle(x, y, (7 - i * 1.6) * size, 4 * size, c).setOrigin(0.5, 1).setDepth(depth));
  return (t: number) => {
    tongues.forEach((r, i) => {
      const k = 0.75 + 0.25 * Math.sin(t * (9 + i * 3) + i * 1.7) + 0.12 * Math.sin(t * 23 + i);
      r.setSize((7 - i * 1.6) * size, Math.max(1, (9 - i * 2) * size * k));
      r.x = x + Math.sin(t * (6 + i) + i) * 0.6 * size;
      r.y = y - 1;
    });
    glow.setAlpha(0.13 + 0.05 * Math.sin(t * 11));
    logs.setVisible(true);
  };
}
