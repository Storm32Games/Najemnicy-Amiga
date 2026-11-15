import Phaser from 'phaser';
import { canvasTexture } from './Kit';
import { glyph } from './FontGlyphs';

// Duże napisy tytułowe: ta sama ręcznie rysowana czcionka 6x8 (FontGlyphs.ts), powiększona o CAŁKOWITĄ skalę.
// Bez gradientów: dwa odcienie (jasne wnętrze + ciemniejsze cieniowanie dolnej krawędzi każdej kreski),
// czarny obrys 1 px czcionki i twardy cień 1 px w prawo-dół.

export interface TitleStyle {
  /** Główny, jasny kolor wnętrza liter. */
  top?: string;
  /** Ciemniejszy odcień do cieniowania krawędzi. */
  bottom?: string;
  outline?: string;
  /** Dodatkowy odstęp między literami (piksele czcionki). */
  spacing?: number;
}

/** Napis tytułowy. scale = piksele projektowe na piksel czcionki (liczba całkowita). */
export function titleTexture(scene: Phaser.Scene, key: string, str: string, scale: number, o: TitleStyle = {}): string {
  const k = Math.max(1, Math.round(scale));
  const extra = Math.max(0, Math.round(o.spacing ?? 1) - 1);
  const px: [number, number][] = [];
  let x = 0;
  for (const ch of str.toUpperCase()) {
    const g = glyph(ch);
    for (const [gx, gy] of g.px) px.push([x + gx, gy]);
    x += g.adv + extra;
  }
  const w = Math.max(...px.map((p) => p[0]), 0) + 1, h = 9;
  const pad = 2;
  // akcenty wielkich liter leżą w wierszu -1: przesuwamy wszystko o 1 w dół
  for (const p of px) p[1] += 1;
  const set = new Set(px.map(([a, b]) => `${a},${b}`));
  // rysunek 1:1, powiększenie o k robi skaler pixel artu (wygładzone ukosy liter zamiast bloków k x k)
  return canvasTexture(scene, key, w + pad * 2, h + pad * 2, (g) => {
    const dot = (a: number, b: number) => g.fillRect(a + pad, b + pad, 1, 1);
    g.fillStyle = o.outline ?? '#000000';
    // twardy cień + obrys 8-sąsiedztwa
    for (const [a, b] of px) {
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        dot(a + dx, b + dy);
        dot(a + dx + 1, b + dy + 1);
      }
    }
    for (const [a, b] of px) {
      g.fillStyle = set.has(`${a},${b + 1}`) ? (o.top ?? '#ffd36b') : (o.bottom ?? '#b4532a');
      dot(a, b);
    }
  }, k);
}
