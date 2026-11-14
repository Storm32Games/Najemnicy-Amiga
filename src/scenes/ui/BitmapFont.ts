import Phaser from 'phaser';
import { CELL_H, CHARSET, LINE_H, TOP, fitText, glyph, measure } from './FontGlyphs';

// Czcionka bitmapowa "PYŁ 6x8" jako Phaser BitmapText.
//
// - Glify są rysowane piksel po pikselu (FontGlyphs.ts) do tekstury 1:1 - jeden texel czcionki = jeden piksel
//   projektowy (480x270), czyli dokładnie tyle samo co piksel grafik postaci i otoczenia. Brak skalowania,
//   brak wygładzania: kamera z zoomem = ZOOM powiększa wszystko jednakowo (pixelArt: true -> NEAREST).
// - Dwa odcienie: wnętrze litery jest białe (barwione przez tint na kolor tekstu), obrys/cień jest czarny
//   (tint mnoży, więc czerń zostaje czernią) - tekst nie zlewa się z tłem ruin.
// - Pozycja i punkt zaczepienia są zaokrąglane do pełnych pikseli, więc litery trafiają w siatkę ekranu.

export type FontStyle = 'outline' | 'shadow' | 'plain';

const OUTLINE = '#000000';
const PAD = 1;
/** Margines górny: obrys + wiersz akcentów wielkich liter. */
const PAD_T = PAD - TOP;
const PER_ROW = 32;

export const fontKey = (style: FontStyle, bold: boolean): string => `pyl6x8_${style}${bold ? '_b' : ''}`;

function buildFont(scene: Phaser.Scene, style: FontStyle, bold: boolean): void {
  const key = fontKey(style, bold);
  if (scene.sys.cache.bitmapFont.exists(key)) return;
  const fh = CELL_H + PAD + PAD_T;
  const glyphs = CHARSET.map((ch) => ({ ch, g: glyph(ch, bold) }));
  const fw = Math.max(...glyphs.map((e) => e.g.w)) + PAD * 2;
  const rows = Math.ceil(glyphs.length / PER_ROW);
  const W = PER_ROW * fw, H = rows * fh;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const chars: Record<number, unknown> = {};
  glyphs.forEach(({ ch, g }, i) => {
    const x0 = (i % PER_ROW) * fw, y0 = Math.floor(i / PER_ROW) * fh;
    const ox = x0 + PAD, oy = y0 + PAD_T;
    // 1) ciemny odcień: obrys 8-sąsiedztwa albo cień 1 px w prawo-dół
    ctx.fillStyle = OUTLINE;
    if (style === 'outline') {
      for (const [x, y] of g.px) for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) ctx.fillRect(ox + x + dx, oy + y + dy, 1, 1);
    } else if (style === 'shadow') {
      for (const [x, y] of g.px) ctx.fillRect(ox + x + 1, oy + y + 1, 1, 1);
    }
    // 2) jasny odcień: wnętrze litery
    ctx.fillStyle = '#ffffff';
    for (const [x, y] of g.px) ctx.fillRect(ox + x, oy + y, 1, 1);
    const w = g.w + PAD * 2, h = fh;
    chars[ch.charCodeAt(0)] = {
      x: x0, y: y0, width: w, height: h,
      centerX: Math.floor(w / 2), centerY: Math.floor(h / 2),
      xOffset: -PAD, yOffset: -PAD_T, xAdvance: g.adv,
      data: {}, kerning: {},
      // UV jak w Phaser ParseRetroFont (oś V odwrócona)
      u0: x0 / W, v0: 1 - y0 / H, u1: (x0 + w) / W, v1: 1 - (y0 + h) / H,
    };
  });
  if (scene.textures.exists(key)) scene.textures.remove(key);
  scene.textures.addCanvas(key, canvas);
  scene.sys.cache.bitmapFont.add(key, {
    data: { retroFont: true, font: key, size: CELL_H, lineHeight: LINE_H, chars },
    texture: key,
    frame: null,
  });
}

export function ensureFonts(scene: Phaser.Scene): void {
  for (const s of ['outline', 'shadow', 'plain'] as FontStyle[]) for (const b of [false, true]) buildFont(scene, s, b);
}

/** Zawijanie słów zgodne z miarą czcionki (spacje; za długie słowo zostaje w całości). */
export function wrapText(src: string, maxW: number, bold = false): string[] {
  const out: string[] = [];
  for (const para of src.split('\n')) {
    let line = '';
    for (const word of para.split(' ')) {
      const cand = line ? `${line} ${word}` : word;
      if (line && measure(cand, bold) > maxW) {
        out.push(line);
        line = word;
      } else line = cand;
    }
    out.push(line);
  }
  return out;
}

const COLOR_RE = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i;
function toColor(c: number | string): number {
  if (typeof c === 'number') return c;
  const m = COLOR_RE.exec(c.trim());
  if (!m) return 0xffffff;
  const h = m[1].length === 3 ? [...m[1]].map((x) => x + x).join('') : m[1];
  return parseInt(h, 16);
}

export interface PixelTextOptions {
  color?: number;
  style?: FontStyle;
  bold?: boolean;
  wrap?: number;
  align?: 'left' | 'center' | 'right';
  lineSpacing?: number;
  /** Maksymalna szerokość jednej linii - dłuższy napis jest przycinany z wielokropkiem. */
  maxW?: number;
}

/**
 * Tekst pikselowy. API zbliżone do Phaser Text (setColor, setWordWrapWidth, setAlign, getWrappedText),
 * żeby sceny mogły go używać zamiennie. Rozmiary (width/displayWidth) są w pikselach projektowych.
 */
export class PixelText extends Phaser.GameObjects.BitmapText {
  private wrapW = 0;
  private fitW = 0;
  private raw = '';
  private readonly bold: boolean;

  constructor(scene: Phaser.Scene, x: number, y: number, s: string, o: PixelTextOptions = {}) {
    ensureFonts(scene);
    super(scene, Math.round(x), Math.round(y), fontKey(o.style ?? 'outline', !!o.bold), '');
    this.bold = !!o.bold;
    this.wrapW = o.wrap ?? 0;
    this.fitW = o.maxW ?? 0;
    if (o.lineSpacing) this.setLineSpacing(o.lineSpacing);
    if (o.align) this.setAlign(o.align);
    this.setTint(o.color ?? 0xffffff);
    this.setText(s);
  }

  override setText(value: string | string[]): this {
    this.raw = Array.isArray(value) ? value.join('\n') : String(value ?? '');
    let lines = this.wrapW > 0 ? wrapText(this.raw, this.wrapW, this.bold) : this.raw.split('\n');
    if (this.fitW > 0) lines = lines.map((l) => fitText(l, this.fitW, this.bold));
    super.setText(lines.join('\n'));
    return this;
  }

  /** Tekst przed zawinięciem. */
  get rawText(): string {
    return this.raw;
  }

  override getTextBounds(round?: boolean): Phaser.Types.GameObjects.BitmapText.BitmapTextSize {
    const b = super.getTextBounds(round);
    // punkt zaczepienia w pełnych pikselach (np. origin 0.5 przy nieparzystej szerokości)
    const self = this as unknown as { _displayOriginX: number; _displayOriginY: number };
    self._displayOriginX = Math.round(self._displayOriginX);
    self._displayOriginY = Math.round(self._displayOriginY);
    return b;
  }

  setColor(c: number | string): this {
    return this.setTint(toColor(c));
  }

  /** Przycinanie linii do szerokości (0 = bez). */
  setMaxLineWidth(w: number): this {
    this.fitW = w;
    return this.setText(this.raw);
  }

  setWordWrapWidth(w: number | null): this {
    this.wrapW = w ?? 0;
    return this.setText(this.raw);
  }

  setAlign(a: 'left' | 'center' | 'right'): this {
    if (a === 'center') this.setCenterAlign();
    else if (a === 'right') this.setRightAlign();
    else this.setLeftAlign();
    return this;
  }

  /** Linie po zawinięciu (dla podanego tekstu albo bieżącego). */
  getWrappedText(s?: string): string[] {
    const src = s ?? this.raw;
    return this.wrapW > 0 ? wrapText(src, this.wrapW, this.bold) : src.split('\n');
  }

  /** Zgodność z Phaser.Text - cień/obrys jest wpieczony w czcionkę. */
  setShadow(..._args: unknown[]): this {
    return this;
  }

  /** Zgodność z Phaser.Text - czcionka bitmapowa nie ma rozdzielczości. */
  setResolution(_r: number): this {
    return this;
  }

  /** Zamiana wariantu czcionki (obrys / cień / bez). */
  setFontStyle(style: FontStyle): this {
    this.setFont(fontKey(style, this.bold));
    return this;
  }

  /** Szerokość napisu w pikselach bez tworzenia obiektu. */
  static measure(s: string, bold = false): number {
    return measure(s, bold);
  }
}

/** Fabryka: dodaje PixelText do sceny. */
export function pixelText(scene: Phaser.Scene, x: number, y: number, s: string, o: PixelTextOptions = {}): PixelText {
  return scene.add.existing(new PixelText(scene, x, y, s, o));
}
