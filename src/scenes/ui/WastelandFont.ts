import Phaser from 'phaser';
import { addHiRes } from '../iso/HiRes';
import { glyph as smallGlyph } from './FontGlyphs';

// Czcionka napisów tytułowych "PUSTKOWIE 7x9": gruba szablonowa (stencil) jak farba natryskiwana na blachę -
// pionowe kreski 2 px, przerwy-mostki szablonu odcinające trzon od brzuszków liter. Na to nakładane są
// (deterministycznie, z ziarna z treści napisu): rdzawe plamy, odpryski farby, zacieki pod literami
// i lekkie "krzywe odbicie" pieczątki (litera o 1 px wyżej/niżej). Bez gradientów - trzy twarde pasy koloru.
//
// Zapis glifu: [pierwszy wiersz, 'wiersz wiersz ...'], '#' = piksel. Korpus: wiersze 0-8,
// akcenty (Ś Ć Ń Ó Ź Ż) w wierszach -3..-2, ogonki (Ą Ę) w wierszu 9.

type Spec = readonly [top: number, rows: string];

const RAW: Record<string, Spec> = {
  A: [0, '..###.. .##.##. ##...## ##...## ###.### ##...## ##...## ##...## ##...##'],
  B: [0, '##.###. ##...## ##...## ##...## ##.###. ##...## ##...## ##...## ##.###.'],
  C: [0, '.##.##. ##...## ##..... ##..... ##..... ##..... ##..... ##...## .##.##.'],
  D: [0, '##.##.. ##..##. ##...## ##...## ##...## ##...## ##...## ##..##. ##.##..'],
  E: [0, '##.#### ##..... ##..... ##..... ##.###. ##..... ##..... ##..... ##.####'],
  F: [0, '##.#### ##..... ##..... ##..... ##.###. ##..... ##..... ##..... ##.....'],
  G: [0, '.##.##. ##...## ##..... ##..... ##..### ##...## ##...## ##...## .##.##.'],
  H: [0, '##...## ##...## ##...## ##...## ###.### ##...## ##...## ##...## ##...##'],
  I: [0, '## ## ## ## ## ## ## ## ##'],
  J: [0, '.....## .....## .....## .....## .....## .....## ##...## ##...## .##.##.'],
  K: [0, '##...## ##..##. ##.##.. ####... ####... ##.##.. ##..##. ##...## ##...##'],
  L: [0, '##..... ##..... ##..... ##..... ##..... ##..... ##..... ##..... #######'],
  M: [0, '##...## ###.### ####### ##.#.## ##.#.## ##...## ##...## ##...## ##...##'],
  N: [0, '##...## ###..## ####.## ##.#### ##..### ##...## ##...## ##...## ##...##'],
  O: [0, '.##.##. ##...## ##...## ##...## ##...## ##...## ##...## ##...## .##.##.'],
  P: [0, '##.###. ##...## ##...## ##...## ##.###. ##..... ##..... ##..... ##.....'],
  Q: [0, '.##.##. ##...## ##...## ##...## ##...## ##...## ##.#.## ##..##. .##.###'],
  R: [0, '##.###. ##...## ##...## ##...## ##.###. ##.##.. ##..##. ##...## ##...##'],
  S: [0, '.##.### ##..... ##..... .##.... ..###.. ....##. .....## .....## ###.##.'],
  T: [0, '###### ..##.. ..##.. ..##.. ..##.. ..##.. ..##.. ..##.. ..##..'],
  U: [0, '##...## ##...## ##...## ##...## ##...## ##...## ##...## ##...## .##.##.'],
  V: [0, '##...## ##...## ##...## ##...## ##...## .##.##. .##.##. ..###.. ...#...'],
  W: [0, '##...## ##...## ##...## ##...## ##.#.## ##.#.## ####### ###.### ##...##'],
  X: [0, '##...## ##...## .##.##. ..###.. ...#... ..###.. .##.##. ##...## ##...##'],
  Y: [0, '##...## ##...## .##.##. ..###.. ..###.. ..###.. ..###.. ..###.. ..###..'],
  Z: [0, '###.### .....## ....##. ...##.. ..##... .##.... ##..... ##..... ###.###'],
  Ą: [0, '..###.. .##.##. ##...## ##...## ###.### ##...## ##...## ##...## ##...## .....##'],
  Ę: [0, '##.#### ##..... ##..... ##..... ##.###. ##..... ##..... ##..... ##.#### ....##.'],
  Ł: [0, '.##.... .##.... .##.#.. .####.. ###.... .##.... .##.... .##.... .######'],
  Ć: [-3, '.....## ....##. ....... .##.##. ##...## ##..... ##..... ##..... ##..... ##..... ##...## .##.##.'],
  Ń: [-3, '.....## ....##. ....... ##...## ###..## ####.## ##.#### ##..### ##...## ##...## ##...## ##...##'],
  Ó: [-3, '.....## ....##. ....... .##.##. ##...## ##...## ##...## ##...## ##...## ##...## ##...## .##.##.'],
  Ś: [-3, '.....## ....##. ....... .##.### ##..... ##..... .##.... ..###.. ....##. .....## .....## ###.##.'],
  Ź: [-3, '.....## ....##. ....... ###.### .....## ....##. ...##.. ..##... .##.... ##..... ##..... ###.###'],
  Ż: [-3, '..##... ..##... ....... ###.### .....## ....##. ...##.. ..##... .##.... ##..... ##..... ###.###'],
  '0': [0, '.##.##. ##...## ##..### ##.#.## ##.#.## ###..## ##...## ##...## .##.##.'],
  '1': [0, '..##.. .###.. ####.. ..##.. ..##.. ..##.. ..##.. ..##.. ######'],
  '2': [0, '.##.##. ##...## .....## ....##. ...##.. ..##... .##.... ##..... ###.###'],
  '3': [0, '###.##. .....## .....## .....## ..####. .....## .....## .....## ###.##.'],
  '4': [0, '##...## ##...## ##...## ##...## ###.### .....## .....## .....## .....##'],
  '5': [0, '###.### ##..... ##..... ##.###. .....## .....## .....## ##...## .##.##.'],
  '6': [0, '.##.##. ##..... ##..... ##.###. ##...## ##...## ##...## ##...## .##.##.'],
  '7': [0, '###.### .....## ....##. ...##.. ..##... ..##... ..##... ..##... ..##...'],
  '8': [0, '.##.##. ##...## ##...## ##...## .##.##. ##...## ##...## ##...## .##.##.'],
  '9': [0, '.##.##. ##...## ##...## ##...## .###.## .....## .....## .....## .##.##.'],
  '.': [0, '.. .. .. .. .. .. .. ## ##'],
  ',': [0, '.. .. .. .. .. .. .. ## ## #.'],
  '!': [0, '## ## ## ## ## ## .. ## ##'],
  '?': [0, '.##.##. ##...## .....## ....##. ...##.. ..##... ....... ..##... ..##...'],
  '-': [0, '.... .... .... .... #### .... .... .... ....'],
  ':': [0, '.. .. ## ## .. .. ## ## ..'],
  "'": [0, '## ## #.'],
};

interface Glyph { px: [number, number][]; adv: number }

const CACHE = new Map<string, Glyph>();

function glyph(ch: string): Glyph {
  const hit = CACHE.get(ch);
  if (hit) return hit;
  let g: Glyph;
  const spec = RAW[ch];
  if (spec) {
    const rows = spec[1].split(' ');
    const px: [number, number][] = [];
    rows.forEach((r, y) => [...r].forEach((c, x) => c === '#' && px.push([x, spec[0] + y])));
    g = { px, adv: Math.max(...rows.map((r) => r.length)) + 1 };
  } else if (ch === ' ') {
    g = { px: [], adv: 5 };
  } else {
    // brak glifu: mała czcionka 6x8 wyrównana do linii bazowej (wiersz 6 -> 8)
    const s = smallGlyph(ch);
    g = { px: s.px.map(([x, y]) => [x, y + 2] as [number, number]), adv: s.adv };
  }
  CACHE.set(ch, g);
  return g;
}

/** Deterministyczny hash 0..1 (ten sam napis zawsze wygląda tak samo). */
function rnd(seed: number, a: number, b: number, salt: number): number {
  let h = (seed ^ Math.imul(a + 7, 0x27d4eb2d) ^ Math.imul(b + 13, 0x165667b1) ^ Math.imul(salt + 3, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function hashStr(s: string): number {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.codePointAt(0)!, 16777619);
  return h >>> 0;
}

function shade(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) => Math.round(Phaser.Math.Clamp(f >= 0 ? v + (255 - v) * f : v * (1 + f), 0, 255));
  const r = ch((n >> 16) & 255), g = ch((n >> 8) & 255), b = ch(n & 255);
  return '#' + ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0');
}

export interface WastelandStyle {
  /** Jasna farba (górny pas liter). */
  top?: string;
  /** Ciemna farba / rdza (dolny pas, plamy, zacieki). */
  bottom?: string;
  outline?: string;
  /** Dodatkowy odstęp między literami (piksele czcionki). */
  spacing?: number;
  /** Siła zniszczeń 0..1 (plamy, odpryski, zacieki). Domyślnie 1. */
  wear?: number;
  /** Krzywe odbicie szablonu (litery +-1 px w pionie). Domyślnie tak. */
  jitter?: boolean;
}

/** Napis tytułowy w stylu szablonu na zardzewiałej blasze. scale = piksele projektowe na piksel czcionki. */
export function wastelandTexture(scene: Phaser.Scene, key: string, str: string, scale: number, o: WastelandStyle = {}): string {
  const k = Math.max(1, Math.round(scale));
  const extra = Math.max(0, Math.round(o.spacing ?? 1) - 1);
  const wear = Phaser.Math.Clamp(o.wear ?? 1, 0, 1);
  const seed = hashStr(str);
  const top = o.top ?? '#ffd36b', bottom = o.bottom ?? '#b4532a', outline = o.outline ?? '#000000';
  const mid = mix(top, bottom, 0.45);
  const hi = shade(top, 0.35);
  const rust = shade(bottom, -0.35);

  const px: [number, number][] = [];
  /** Litery z akcentem nad sobą i S nie dostają zacieków (S z zaciekiem wygląda jak "$"). */
  const noDrip = new Set<string>();
  let x = 0, i = 0;
  for (const ch of str.toUpperCase()) {
    const g = glyph(ch);
    const dy = o.jitter === false || ch === ' ' ? 0 : [0, 0, -1, 1][Math.floor(rnd(seed, i, 0, 1) * 4)];
    const accent = g.px.some(([, gy]) => gy < 0) || 'SŚ5'.includes(ch);
    for (const [gx, gy] of g.px) {
      px.push([x + gx, gy + dy]);
      if (accent) noDrip.add(`${x + gx},${gy + dy}`);
    }
    x += g.adv + extra;
    i++;
  }
  const set = new Set(px.map(([a, b]) => `${a},${b}`));
  const has = (a: number, b: number) => set.has(`${a},${b}`);

  // zacieki: z dolnych krawędzi kresek spływa farba (1-3 px), najczęściej w dolnych wierszach liter
  const drips: [number, number][] = [];
  for (const [a, b] of px) {
    if (b < 6 || has(a, b + 1) || noDrip.has(`${a},${b}`) || rnd(seed, a, b, 2) > 0.16 * wear) continue;
    const len = 1 + Math.floor(rnd(seed, a, b, 3) * 3);
    for (let d = 1; d <= len; d++) drips.push([a, b + d]);
  }
  const all = [...px, ...drips];

  const w = Math.max(x - extra - 1, 1), y0 = -4, y1 = 13;
  const pad = 2;
  const cw = w + pad * 2, chh = y1 - y0 + pad * 2;
  const cv = document.createElement('canvas');
  cv.width = cw;
  cv.height = chh;
  const g = cv.getContext('2d');
  if (g) {
    const dot = (a: number, b: number) => g.fillRect(a + pad, b - y0 + pad, 1, 1);
    g.fillStyle = outline;
    // twardy cień + obrys 8-sąsiedztwa
    for (const [a, b] of all) {
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        dot(a + dx, b + dy);
        dot(a + dx + 1, b + dy + 1);
      }
    }
    for (const [a, b] of drips) {
      g.fillStyle = rnd(seed, a, b, 4) < 0.5 ? bottom : rust;
      dot(a, b);
    }
    for (const [a, b] of px) {
      // trzy twarde pasy farby + jasna krawędź górna każdej kreski + cień dolnej
      let c = b <= 2 ? top : b <= 5 ? mid : bottom;
      if (!has(a, b - 1)) c = b <= 2 ? hi : top;
      else if (!has(a, b + 1)) c = rust;
      const r = rnd(seed, a, b, 5);
      // odprysk farby (goła ciemna blacha) - tylko wewnątrz kształtu, żeby nie psuć sylwetki litery
      const inner = has(a - 1, b) && has(a + 1, b) || has(a, b - 1) && has(a, b + 1);
      if (inner && r < 0.05 * wear) c = outline === '#000000' ? '#1a1410' : shade(outline, 0.1);
      else if (r < 0.2 * wear) c = rnd(seed, a, b, 6) < 0.5 ? bottom : rust;
      g.fillStyle = c;
      dot(a, b);
    }
  }
  // powiększenie "na twardo" (najbliższy sąsiad): skaler pixel artu zaokrągla kreski szablonu w "kluski"
  addHiRes(scene, key, cv, { w: cw * k, h: chh * k, smooth: false });
  return key;
}

function mix(a: string, b: string, t: number): string {
  const p = parseInt(a.slice(1), 16), q = parseInt(b.slice(1), 16);
  const ch = (s: number) => Math.round(((p >> s) & 255) * (1 - t) + ((q >> s) & 255) * t);
  return '#' + ((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, '0');
}
