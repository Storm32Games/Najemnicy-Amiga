// Proceduralne tekstury efektów walki i atmosfery (port Oldgame/src/gfx/effects.js + atmosphere.js do pixel artu 2D).
// Wszystko malowane piksel po pikselu w PixelCanvas: ostre krawędzie, rampy kolorów i dithering Bayera.
// Tekstury szare / białe są barwione przez setTint (dym, pył, pierścienie); ogień i krzyżyki mają własne kolory.

import { PixelCanvas, type RGB, bayer, clamp01, hash2, mix, pick, rng, shade, vnoise } from './Pixel';

export interface FxFrame {
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface FxSheet {
  pc: PixelCanvas;
  frames: FxFrame[];
}

/** Składa klatki (każda malowana na własnym płótnie w x w) w poziomy arkusz. */
function strip(n: number, w: number, h: number, paint: (pc: PixelCanvas, f: number) => void, prefix = 'f'): FxSheet {
  const pc = new PixelCanvas(w * n, h);
  const frames: FxFrame[] = [];
  for (let f = 0; f < n; f++) {
    const one = new PixelCanvas(w, h);
    paint(one, f);
    for (let y = 0; y < h; y++) {
      const src = y * w * 4;
      pc.data.set(one.data.subarray(src, src + w * 4), (y * pc.w + f * w) * 4);
    }
    frames.push({ name: `${prefix}${f}`, x: f * w, y: 0, w, h });
  }
  return { pc, frames };
}

// ------------------------------------------------------------------ ogień i dym

export const FIRE_RAMP: readonly RGB[] = [0x2a1612, 0x5a2216, 0xa0321a, 0xdc5a1c, 0xff9a2e, 0xffd862, 0xfff6d0];
const SMOKE_RAMP: readonly RGB[] = [0x4a4a4a, 0x7a7a7a, 0xa8a8a8, 0xd4d4d4, 0xf4f4f4];

/** Kula ognia wybuchu, 7 klatek 28x28: biały rdzeń -> pomarańczowe kłęby -> ciemny dym z żarem. */
export function paintFireball(): FxSheet {
  const S = 28, N = 7;
  return strip(N, S, S, (pc, f) => {
    const k = f / (N - 1);
    const rad = 6 + k * 7;
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const dx = (x + 0.5 - S / 2) / rad, dy = (y + 0.5 - S / 2 - k * 2) / rad;
        const n = vnoise(x * 0.32 + f * 1.7, y * 0.32 - f * 2.1, 31) - 0.5;
        const d = Math.sqrt(dx * dx + dy * dy) + n * (0.45 + k * 0.4);
        if (d > 1) continue;
        // światło z lewej-góry
        const lit = clamp01(0.5 - dx * 0.25 - dy * 0.35);
        let heat = (1 - d) * (1.25 - k * 1.05) + lit * 0.25 + n * 0.3;
        if (k > 0.55) heat -= (k - 0.55) * 0.9;
        if (heat < 0.12) {
          // dym na obrzeżu
          if (bayer(x, y) < 0.55 + (1 - d) * 0.5) pc.set(x, y, pick([0x1e1816, 0x3a302a, 0x5a4a40], clamp01(lit + 0.2), x, y), 235);
          continue;
        }
        pc.set(x, y, pick(FIRE_RAMP, clamp01(heat), x, y));
      }
  });
}

/** Kłąb dymu / pyłu (szary, do barwienia): 4 rozmiary, światło z lewej-góry, poszarpany brzeg. */
export function paintPuffs(): FxSheet {
  const S = 24;
  const sizes = [8, 12, 17, 23];
  return strip(sizes.length, S, S, (pc, f) => {
    const r = sizes[f] / 2;
    const c = S / 2;
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const dx = (x + 0.5 - c) / r, dy = (y + 0.5 - c) / r;
        const n = vnoise(x * 0.45, y * 0.45, 7 + f * 13) - 0.5;
        const d = Math.sqrt(dx * dx + dy * dy) + n * 0.5;
        if (d > 1) continue;
        const lit = clamp01(0.62 - dx * 0.3 - dy * 0.42 + n * 0.4);
        // brzeg rzednie ditheringiem
        if (d > 0.78 && bayer(x, y) > (1 - d) * 4) continue;
        pc.set(x, y, pick(SMOKE_RAMP, lit, x, y));
      }
  });
}

/** Płomyk (płonący stan / miotacz) 4 klatki 8x12, pełne kolory. */
export function paintFlicker(): FxSheet {
  const W = 8, H = 12;
  return strip(4, W, H, (pc, f) => {
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const t = 1 - y / H;
        const wob = Math.sin(y * 0.9 + f * 1.6) * 1.1 * (1 - t);
        const dx = Math.abs(x + 0.5 - W / 2 - wob) / (W / 2);
        const heat = t * 1.35 - dx * 1.15 + (vnoise(x * 0.8, y * 0.6 - f * 2.6, 3) - 0.5) * 0.8;
        if (heat <= 0.1) continue;
        pc.set(x, y, pick(FIRE_RAMP, clamp01(heat * 0.9 + 0.1), x, y + f));
      }
  });
}

// ------------------------------------------------------------------ błyski, fale, iskry

/** Błysk wylotowy, 3 klatki 15x15 (gwiazda: długie promienie w osiach, krótsze po skosie). */
export function paintMuzzle(): FxSheet {
  const S = 15, c = 7;
  return strip(3, S, S, (pc, f) => {
    const L = [7, 5, 3][f], Ld = [4, 3, 1][f];
    const core = [0xffffff, 0xfff6c8, 0xffe27a, 0xff9a30];
    for (let i = -L; i <= L; i++) {
      const t = Math.abs(i) / L;
      const col = core[Math.min(3, Math.floor(t * 3.6))];
      pc.set(c + i, c, col);
      pc.set(c, c + i, col);
      if (t < 0.4) {
        pc.set(c + i, c - 1, core[2]);
        pc.set(c + i, c + 1, core[2]);
        pc.set(c - 1, c + i, core[2]);
        pc.set(c + 1, c + i, core[2]);
      }
    }
    for (let i = 1; i <= Ld; i++) {
      const col = i < Ld ? core[2] : core[3];
      pc.set(c + i, c + i, col); pc.set(c - i, c - i, col); pc.set(c + i, c - i, col); pc.set(c - i, c + i, col);
    }
    pc.ellipse(c + 0.5, c + 0.5, 2.2 - f * 0.5, 2.2 - f * 0.5, 0xffffff);
  });
}

/** Fala uderzeniowa na ziemi: izometryczna elipsa, 7 klatek 80x40, biała (barwiona). */
export function paintShockRing(): FxSheet {
  const W = 80, H = 40, N = 7;
  return strip(N, W, H, (pc, f) => {
    const k = (f + 1) / N;
    const rx = 5 + k * 33, ry = rx / 2;
    const th = 2.6 - k * 1.4;
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const dx = (x + 0.5 - W / 2) / rx, dy = (y + 0.5 - H / 2) / ry;
        const d = Math.sqrt(dx * dx + dy * dy);
        const e = Math.abs(d - 1) * rx; // odległość od brzegu w pikselach
        if (e > th) {
          // poświata wewnątrz pierścienia
          if (d < 1 && d > 0.7 && bayer(x, y) < (d - 0.7) * 0.9 * (1 - k)) pc.set(x, y, 0xffffff, 110);
          continue;
        }
        if (e < th * 0.45) pc.set(x, y, 0xffffff);
        else if (bayer(x, y) < 0.7 - k * 0.3) pc.set(x, y, 0xd8d8d8, 200);
      }
  });
}

/** Przypalenie po wybuchu (trwała kalkomania) 44x22: zwęglony środek, pęknięcia, sadza ditheringiem. */
export function paintScorch(seed: number): PixelCanvas {
  const W = 44, H = 22;
  const pc = new PixelCanvas(W, H);
  const R = rng(seed);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const dx = (x + 0.5 - W / 2) / (W / 2), dy = (y + 0.5 - H / 2) / (H / 2);
      const d = Math.sqrt(dx * dx + dy * dy) + (vnoise(x / 3, y / 2, seed) - 0.5) * 0.45;
      if (d > 1) continue;
      const k = 1 - d;
      if (bayer(x, y) > k * 2.2) continue;
      pc.set(x, y, k > 0.62 ? 0x080606 : k > 0.35 ? 0x161210 : 0x2a221c, 140 + k * 110);
    }
  // promieniste pęknięcia / smugi odłamków
  const rays = 7 + Math.floor(R() * 4);
  for (let i = 0; i < rays; i++) {
    const a = R() * Math.PI * 2, len = 0.55 + R() * 0.5;
    pc.line(W / 2, H / 2, W / 2 + Math.cos(a) * (W / 2) * len, H / 2 + Math.sin(a) * (H / 2) * len, (_x, _y, t) => (t < 0.6 ? 0x050404 : 0x1e1814), 200);
  }
  // kilka tlących się drobin
  for (let i = 0; i < 4; i++) pc.set(W / 2 + (R() - 0.5) * 16, H / 2 + (R() - 0.5) * 7, R() < 0.5 ? 0xa8401a : 0x6a2a14, 230);
  return pc;
}

/** Odłamki, 4 klatki 4x4 (szare - barwione). */
export function paintDebris(): FxSheet {
  const shapes = [
    ['.##.', '####', '.##.', '....'],
    ['##..', '###.', '.##.', '....'],
    ['.#..', '###.', '##..', '....'],
    ['###.', '.##.', '....', '....'],
  ];
  return strip(4, 4, 4, (pc, f) => {
    shapes[f].forEach((row, y) => [...row].forEach((ch, x) => { if (ch === '#') pc.set(x, y, y === 0 || x === 0 ? 0xffffff : 0x9a9a9a); }));
  });
}

/** Krzyżyk leczenia 7x7 (zielony z obrysem). */
export function paintHealCross(): PixelCanvas {
  const pc = new PixelCanvas(9, 9);
  pc.rect(3, 1, 3, 7, 0x3aa83a);
  pc.rect(1, 3, 7, 3, 0x3aa83a);
  pc.rect(4, 1, 1, 7, 0xb8ffb0);
  pc.rect(1, 4, 7, 1, 0xb8ffb0);
  pc.set(4, 4, 0xffffff);
  pc.outline(0.3, 0x0a200a, 1);
  return pc;
}

/** Złoty szewron wzmocnienia 9x7 (biały środek - można barwić). */
export function paintChevron(): PixelCanvas {
  const pc = new PixelCanvas(9, 7);
  for (let i = 0; i < 4; i++) {
    pc.rect(i + 1, 4 - i, 2, 2, i === 3 ? 0xffffff : 0xffe8a0);
    pc.rect(7 - i - 1, 4 - i, 2, 2, i === 3 ? 0xffffff : 0xd8b050);
  }
  pc.outline(0.35, 0x201004, 1);
  return pc;
}

/** Iskra 3x3 (plus z białym środkiem). */
export function paintSpark(): PixelCanvas {
  const pc = new PixelCanvas(3, 3);
  pc.set(1, 0, 0xfff0a0); pc.set(0, 1, 0xfff0a0); pc.set(2, 1, 0xfff0a0); pc.set(1, 2, 0xfff0a0);
  pc.set(1, 1, 0xffffff);
  return pc;
}

// ------------------------------------------------------------------ atmosfera

/** Plama światła do mapy oświetlenia (ADD): izometryczna elipsa, pasma z ditheringiem. */
export function paintLightPool(w = 64, h = 40): PixelCanvas {
  const pc = new PixelCanvas(w, h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const dx = (x + 0.5 - w / 2) / (w / 2), dy = (y + 0.5 - h / 2) / (h / 2);
      const k = clamp01(1 - Math.sqrt(dx * dx + dy * dy));
      if (k <= 0) continue;
      const lvl = Math.pow(k, 1.3) * 6;
      const i = Math.floor(lvl) + (lvl - Math.floor(lvl) > bayer(x, y) ? 1 : 0);
      if (i > 0) pc.set(x, y, 0xffffff, Math.min(255, i * 42));
    }
  return pc;
}

/** Smuga deszczu / pyłu 1x7 (ukośna 3x7). */
export function paintStreak(): PixelCanvas {
  const pc = new PixelCanvas(3, 8);
  for (let i = 0; i < 8; i++) pc.set(Math.floor(i / 3), i, 0xffffff, 90 + i * 20);
  return pc;
}

/** Zarodnik: świecąca kropka 5x5. */
export function paintSpore(): PixelCanvas {
  const pc = new PixelCanvas(5, 5);
  pc.set(2, 2, 0xffffff);
  for (const [x, y] of [[1, 2], [3, 2], [2, 1], [2, 3]] as const) pc.set(x, y, 0xffffff, 160);
  for (const [x, y] of [[1, 1], [3, 1], [1, 3], [3, 3], [0, 2], [4, 2], [2, 0], [2, 4]] as const) pc.set(x, y, 0xffffff, 50);
  return pc;
}

/** Ławica mgły 128x40: miękka chmura z szumu, białe piksele o kwantyzowanej alfie. */
export function paintFogBank(seed: number): PixelCanvas {
  const W = 128, H = 40;
  const pc = new PixelCanvas(W, H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const dx = (x + 0.5 - W / 2) / (W / 2), dy = (y + 0.5 - H / 2) / (H / 2);
      const base = 1 - Math.sqrt(dx * dx * 0.9 + dy * dy * 1.2);
      const n = vnoise(x / 9, y / 5, seed) * 0.6 + vnoise(x / 4, y / 3, seed + 9) * 0.4;
      const k = clamp01(base * 1.4 + (n - 0.5) * 1.1);
      if (k <= 0.05) continue;
      const lvl = k * 4;
      const i = Math.floor(lvl) + (lvl - Math.floor(lvl) > bayer(x, y) ? 1 : 0);
      if (i > 0) pc.set(x, y, 0xffffff, [0, 40, 75, 110, 140][Math.min(4, i)]);
    }
  return pc;
}

/** Pionowy gradient ekranu (MULTIPLY) z ditheringiem: kolory od góry do dołu. */
export function paintScreenGradient(w: number, h: number, stops: readonly RGB[]): PixelCanvas {
  const pc = new PixelCanvas(w, h);
  const n = stops.length - 1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const t = (y / (h - 1)) * n;
      const i = Math.min(n - 1, Math.floor(t));
      const f = t - i;
      // kwantyzacja do 8 kroków na odcinek + Bayer = pixelartowe pasma bez smug
      const q = Math.floor(f * 8 + bayer(x, y)) / 8;
      pc.set(x, y, mix(stops[i], stops[i + 1], clamp01(q)));
    }
  return pc;
}

/** Ukośne promienie słońca (ADD) 160x120 dla dnia/zmierzchu. */
export function paintSunShafts(seed: number): PixelCanvas {
  const W = 160, H = 120;
  const pc = new PixelCanvas(W, H);
  const R = rng(seed);
  const shafts = Array.from({ length: 5 }, () => ({ o: R() * W * 1.4 - W * 0.2, w: 6 + R() * 16, a: 0.4 + R() * 0.6 }));
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const fade = 1 - y / H;
      let k = 0;
      for (const s of shafts) {
        const u = x + y * 0.6 - s.o;
        const e = 1 - Math.abs(u) / s.w;
        if (e > 0) k = Math.max(k, e * s.a);
      }
      k *= fade;
      if (k > 0 && bayer(x, y) < k) pc.set(x, y, 0xffffff, 40);
    }
  return pc;
}

/** Błyskawica: łamana od góry ekranu w dół (biała z poświatą), w x h, losowa wg seed. */
export function paintLightning(w: number, h: number, seed: number): PixelCanvas {
  const pc = new PixelCanvas(w, h);
  const R = rng(seed);
  const bolt = (x: number, y: number, len: number, thick: number, depth: number): void => {
    let cx = x, cy = y;
    while (cy < Math.min(h - 1, y + len)) {
      const nx = cx + (R() - 0.5) * 9, ny = cy + 3 + R() * 6;
      pc.line(cx, cy, nx, ny, 0xc8d8ff);
      if (thick > 1) { pc.line(cx + 1, cy, nx + 1, ny, 0xffffff); pc.line(cx - 1, cy, nx - 1, ny, 0x8aa0ff, 140); }
      else pc.line(cx, cy, nx, ny, 0xffffff);
      if (depth < 2 && R() < 0.12) bolt(nx, ny, len * 0.35, 1, depth + 1);
      cx = nx;
      cy = ny;
    }
  };
  bolt(w / 2 + (R() - 0.5) * w * 0.4, 0, h, 2, 0);
  return pc;
}

/** Krwawy rozprysk / plama oleju pod celem - drobna kalkomania 14x7. */
export function paintSplat(color: RGB, seed: number): PixelCanvas {
  const pc = new PixelCanvas(14, 7);
  const R = rng(seed);
  for (let i = 0; i < 9; i++) {
    const x = 7 + (R() - 0.5) * 11, y = 3.5 + (R() - 0.5) * 5, r = 0.6 + R() * 1.6;
    pc.ellipse(x, y, r * 1.6, r, (xx, yy) => (hash2(xx, yy, seed) > 0.25 ? (R() < 0.3 ? shade(color, 1.3) : color) : -1), 220);
  }
  return pc;
}
