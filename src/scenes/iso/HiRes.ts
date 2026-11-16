// Tekstury w wysokiej rozdzielczości dla siatki projektowej 480x270.
//
// Proceduralny pixel art jest malowany w pikselach projektowych (kafelek 32x16, klatka postaci 24x32), ale płótno
// gry ma rozmiar presetu (domyślnie 1920x1080, ZOOM 4). Zamiast powiększać teksturę na GPU (gruby, schodkowy piksel)
// powiększamy ją tu skalerem pixel artu (Scale2x / Scale3x - wygładza schodki ukośnych krawędzi, zachowuje
// dithering i kontury) do gęstości ART tekseli na piksel projektowy, czyli 1 teksel = 1 piksel płótna.
//
// Phaser dostaje teksturę o wymiarach "projektowych" (source.width/height i ramki w pikselach projektowych),
// a tylko obraz na GPU jest ART razy większy - współrzędne UV są względne, więc kod scen (pozycje, kotwice,
// ramki arkuszy, setOrigin) się nie zmienia.
import type Phaser from 'phaser';
import { ART } from '../ui/Kit';
import type { PixelCanvas } from './Pixel';

type Src = PixelCanvas | HTMLCanvasElement;

interface Img {
  w: number;
  h: number;
  /** RGBA jako uint32 (kolejność bajtów jak w ImageData). Piksele przezroczyste są znormalizowane do 0. */
  px: Uint32Array;
}

function toImg(src: Src): Img {
  let data: Uint8ClampedArray;
  let w: number, h: number;
  if (src instanceof HTMLCanvasElement) {
    w = src.width;
    h = src.height;
    const ctx = src.getContext('2d');
    data = ctx ? ctx.getImageData(0, 0, w, h).data : new Uint8ClampedArray(w * h * 4);
  } else {
    w = src.w;
    h = src.h;
    data = src.data;
  }
  const px = new Uint32Array(w * h);
  const view = new Uint32Array(data.buffer.slice(data.byteOffset, data.byteOffset + w * h * 4));
  for (let i = 0; i < px.length; i++) px[i] = data[i * 4 + 3] === 0 ? 0 : view[i];
  return { w, h, px };
}

/** Scale2x (EPX): krawędzie pod kątem 45° stają się gładkie, płaskie plamy i szachownice ditheringu zostają. */
function scale2x(s: Img): Img {
  const { w, h, px } = s;
  const W = w * 2;
  const out = new Uint32Array(W * h * 2);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const E = px[y * w + x];
      const B = y > 0 ? px[(y - 1) * w + x] : E;
      const H = y < h - 1 ? px[(y + 1) * w + x] : E;
      const D = x > 0 ? px[y * w + x - 1] : E;
      const F = x < w - 1 ? px[y * w + x + 1] : E;
      let e0 = E, e1 = E, e2 = E, e3 = E;
      if (B !== H && D !== F) {
        if (D === B) e0 = D;
        if (B === F) e1 = F;
        if (D === H) e2 = D;
        if (H === F) e3 = F;
      }
      const o = y * 2 * W + x * 2;
      out[o] = e0;
      out[o + 1] = e1;
      out[o + W] = e2;
      out[o + W + 1] = e3;
    }
  return { w: W, h: h * 2, px: out };
}

/** Scale3x (AdvMAME3x). */
function scale3x(s: Img): Img {
  const { w, h, px } = s;
  const W = w * 3;
  const out = new Uint32Array(W * h * 3);
  const at = (x: number, y: number): number => px[Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const A = at(x - 1, y - 1), B = at(x, y - 1), C = at(x + 1, y - 1);
      const D = at(x - 1, y), E = at(x, y), F = at(x + 1, y);
      const G = at(x - 1, y + 1), H = at(x, y + 1), I = at(x + 1, y + 1);
      let e0 = E, e1 = E, e2 = E, e3 = E, e5 = E, e6 = E, e7 = E, e8 = E;
      if (B !== H && D !== F) {
        if (D === B) e0 = D;
        if ((D === B && E !== C) || (B === F && E !== A)) e1 = B;
        if (B === F) e2 = F;
        if ((D === B && E !== G) || (D === H && E !== A)) e3 = D;
        if ((B === F && E !== I) || (H === F && E !== C)) e5 = F;
        if (D === H) e6 = D;
        if ((D === H && E !== I) || (H === F && E !== G)) e7 = H;
        if (H === F) e8 = F;
      }
      const o = y * 3 * W + x * 3;
      out[o] = e0; out[o + 1] = e1; out[o + 2] = e2;
      out[o + W] = e3; out[o + W + 1] = E; out[o + W + 2] = e5;
      out[o + 2 * W] = e6; out[o + 2 * W + 1] = e7; out[o + 2 * W + 2] = e8;
    }
  return { w: W, h: h * 3, px: out };
}

/** Powiększenie całkowite najbliższym sąsiadem. */
function nearest(s: Img, k: number): Img {
  const W = s.w * k, H = s.h * k;
  const out = new Uint32Array(W * H);
  for (let y = 0; y < H; y++) {
    const row = ((y / k) | 0) * s.w;
    for (let x = 0; x < W; x++) out[y * W + x] = s.px[row + ((x / k) | 0)];
  }
  return { w: W, h: H, px: out };
}

/** Uśrednianie powierzchniowe (z premultiplikacją alfy) do dowolnego mniejszego rozmiaru. */
function resample(s: Img, tw: number, th: number): Img {
  if (s.w === tw && s.h === th) return s;
  const out = new Uint32Array(tw * th);
  const bytes = new Uint8Array(s.px.buffer, s.px.byteOffset, s.px.byteLength);
  const ob = new Uint8Array(out.buffer);
  const fx = s.w / tw, fy = s.h / th;
  for (let y = 0; y < th; y++) {
    const y0 = y * fy, y1 = y0 + fy;
    for (let x = 0; x < tw; x++) {
      const x0 = x * fx, x1 = x0 + fx;
      let r = 0, g = 0, b = 0, a = 0, wsum = 0;
      for (let sy = Math.floor(y0); sy < Math.ceil(y1) && sy < s.h; sy++) {
        const wy = Math.min(y1, sy + 1) - Math.max(y0, sy);
        for (let sx = Math.floor(x0); sx < Math.ceil(x1) && sx < s.w; sx++) {
          const wgt = wy * (Math.min(x1, sx + 1) - Math.max(x0, sx));
          const i = (sy * s.w + sx) * 4;
          const al = bytes[i + 3] * wgt;
          r += bytes[i] * al;
          g += bytes[i + 1] * al;
          b += bytes[i + 2] * al;
          a += al;
          wsum += wgt;
        }
      }
      const o = (y * tw + x) * 4;
      if (a > 0) {
        ob[o] = r / a;
        ob[o + 1] = g / a;
        ob[o + 2] = b / a;
        ob[o + 3] = a / wsum;
      }
    }
  }
  return { w: tw, h: th, px: out };
}

export interface HiResOpts {
  /** Wymiary projektowe (domyślnie = wymiary źródła). Źródło może być większe/mniejsze, np. ikona 32 px wyświetlana jako 12. */
  w?: number;
  h?: number;
  /**
   * false = powiększenie "na twardo" (najbliższy sąsiad). Dla kafelków terenu: składają się z sąsiadami bez szwów,
   * a skaler na zaszumionej fakturze robi "robaczki" zamiast wygładzać.
   */
  smooth?: boolean;
  /** Maska w pikselach projektowych (w * h, 0 = przezroczysty): po powiększeniu zeruje alfę tekseli poza maską. */
  mask?: Uint8Array;
}

/** Powiększa źródło do (w * ART) x (h * ART) tekseli. */
export function hiResCanvas(src: Src, o: HiResOpts = {}): HTMLCanvasElement {
  const base = toImg(src);
  const tw = Math.max(1, Math.round((o.w ?? base.w) * ART));
  const th = Math.max(1, Math.round((o.h ?? base.h) * ART));
  let img = base;
  // wygładzanie do 4x (dalej skaler robi z liter i konturów "kluski"), resztę dokłada powiększenie całkowite
  if (o.smooth !== false)
    while ((img.w < tw || img.h < th) && img.w < base.w * 4) {
      const ratio = Math.max(tw / img.w, th / img.h);
      img = ratio > 2 && ratio <= 3 ? scale3x(img) : scale2x(img);
    }
  if (img.w < tw || img.h < th) img = nearest(img, Math.ceil(Math.max(tw / img.w, th / img.h)));
  img = resample(img, tw, th);
  const m = o.mask;
  if (m) {
    const mw = o.w ?? base.w, mh = o.h ?? base.h;
    for (let y = 0; y < th; y++) {
      const row = Math.min(mh - 1, Math.floor((y * mh) / th)) * mw;
      for (let x = 0; x < tw; x++) if (!m[row + Math.min(mw - 1, Math.floor((x * mw) / tw))]) img.px[y * tw + x] = 0;
    }
  }
  const c = document.createElement('canvas');
  c.width = tw;
  c.height = th;
  const ctx = c.getContext('2d');
  if (ctx) ctx.putImageData(new ImageData(new Uint8ClampedArray(img.px.buffer as ArrayBuffer), tw, th), 0, 0);
  return c;
}

export interface FrameRect {
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Dodaje teksturę ART razy gęstszą niż jej rozmiar projektowy; ramki (frames) podaje się w pikselach projektowych.
 * Zastępuje istniejącą teksturę o tym samym kluczu.
 */
export function addHiRes(scene: Phaser.Scene, key: string, src: Src, o: HiResOpts = {}, frames: readonly FrameRect[] = []): Phaser.Textures.Texture | null {
  const dw = o.w ?? (src instanceof HTMLCanvasElement ? src.width : src.w);
  const dh = o.h ?? (src instanceof HTMLCanvasElement ? src.height : src.h);
  const canvas = hiResCanvas(src, { ...o, w: dw, h: dh });
  if (scene.textures.exists(key)) scene.textures.remove(key);
  const tex = scene.textures.addCanvas(key, canvas);
  if (!tex) return null;
  const s = tex.source[0];
  s.width = dw;
  s.height = dh;
  tex.get('__BASE').setSize(dw, dh, 0, 0);
  for (const f of frames) tex.add(f.name, 0, f.x, f.y, f.w, f.h);
  // renderer Canvas rysuje drawImage w pikselach obrazu źródłowego - te muszą być w tekselach
  for (const name of tex.getFrameNames(true)) {
    const d = (tex.get(name) as unknown as { data: { drawImage: { x: number; y: number; width: number; height: number } } }).data.drawImage;
    d.x *= ART;
    d.y *= ART;
    d.width *= ART;
    d.height *= ART;
  }
  return tex;
}
