import Phaser from 'phaser';
import { type RGB, B_, G_, R_, bayer, clamp01, hash2, mix, rng, vnoise } from '../iso/Pixel';

// Pixel-artowe sceny intro: wybuch jądrowy nad miastem (plansza 1) i ulica ruin (plansza 2).
// Wszystko liczone piksel po pikselu w siatce projektowej 480x270 (1 piksel tekstury = 1 piksel projektowy,
// powiększany przez kamerę bez wygładzania), kolory z ręcznie dobranych ramp + dithering Bayera 4x4.
// To tylko warstwa rysowania (zero logiki gry); w wersji przeglądarkowej wolno tu liczyć na floatach.

const W = 480;
const H = 270;

/** 0xRRGGBB -> piksel ImageData (ABGR little-endian). */
const px = (c: RGB): number => (0xff000000 | (B_(c) << 16) | (G_(c) << 8) | R_(c)) >>> 0;
const hexes = (a: readonly string[]): RGB[] => a.map((s) => parseInt(s.slice(1), 16));

/** Kolor z rampy dla v (0..1) z ditheringiem uporządkowanym (bez alokacji). */
function rampPx(r: readonly number[], v: number, x: number, y: number): number {
  const f = (v < 0 ? 0 : v > 1 ? 1 : v) * (r.length - 1);
  const i = f | 0;
  return r[f - i > bayer(x, y) && i + 1 < r.length ? i + 1 : i];
}

function fbm(x: number, y: number, seed: number, oct = 3): number {
  let s = 0, a = 0.5, f = 1, n = 0;
  for (let o = 0; o < oct; o++) {
    s += vnoise(x * f, y * f, seed + o * 17) * a;
    n += a;
    a *= 0.5;
    f *= 2.03;
  }
  return s / n;
}

/** Dodaje (r,g,b)*k do piksela ABGR. */
function addPx(p: number, r: number, g: number, b: number, k: number): number {
  const pr = (p & 255) + r * k, pg = ((p >> 8) & 255) + g * k, pb = ((p >> 16) & 255) + b * k;
  return (0xff000000 | ((pb > 255 ? 255 : pb) << 16) | ((pg > 255 ? 255 : pg) << 8) | (pr > 255 ? 255 : pr)) >>> 0;
}

/** Miesza piksel ABGR z kolorem (r,g,b) w proporcji t. */
function lerpPx(p: number, r: number, g: number, b: number, t: number): number {
  const pr = p & 255, pg = (p >> 8) & 255, pb = (p >> 16) & 255;
  return (0xff000000 | ((pb + (b - pb) * t) << 16) | ((pg + (g - pg) * t) << 8) | (pr + (r - pr) * t)) >>> 0;
}

// ================================================================== plansza 1: wybuch

const SKY = hexes(['#0c0f24', '#141a34', '#1f2140', '#2c2848', '#3c2c4e', '#55344f', '#713c52', '#8e4652', '#b05a50', '#cc7450', '#e2925a', '#f0b068', '#f8cc84']);
/** Dym: od zimnego cienia do ciepłego, podświetlonego od dołu brzegu. */
const SMOKE = hexes(['#120c14', '#1e141c', '#2c1e24', '#3e2a2c', '#543832', '#6c4636', '#88583c', '#a46c44', '#c08650']);
/** Ogień: od czerwieni po biel. */
const FIRE = hexes(['#5a1a14', '#8a2616', '#b83c18', '#dc5c1c', '#f08428', '#fcac3c', '#ffd25e', '#fff09a', '#fffde6']);
/** Dym oświetlony od góry zmierzchem (chłodny fiolet). */
const SMOKE_COOL = hexes(['#140e1a', '#22182a', '#33243a', '#48324a', '#62445a', '#7e5a6c', '#9c7480', '#b89096']);
const DUST = hexes(['#2a1a16', '#3e2820', '#5a3a28', '#7a5034', '#9c6a42', '#c08a56']);
const GROUND = hexes(['#140e0e', '#1e1614', '#2a1e1a', '#382820']);
/** Sylwetki miasta: [daleko, środek, blisko] - im bliżej, tym ciemniej. */
const CITY = [hexes(['#3a2a40', '#45304a', '#503850']), hexes(['#22182a', '#2a1e30', '#342638']), hexes(['#120c14', '#181018', '#20161e'])];
const WIN_LIT = hexes(['#c87a32', '#f0a848', '#ffd27a']);

interface Building { x: number; w: number; h: number; layer: number; seed: number; kind: number }

interface Layer {
  intact: Uint32Array; // 0 = przezroczysty
  ruined: Uint32Array;
  /** Krawędź od strony wybuchu (do obrysu światłem). */
  rimI: Uint8Array;
  rimR: Uint8Array;
}

interface Puff { x: number; y: number; z: number; r: number; heat: number; seed: number; dust: boolean }

interface Ember { x: number; y: number; vx: number; vy: number; life: number; hot: number }

/**
 * Wybuch jądrowy nad miastem jako jedna dynamiczna tekstura 480x270.
 * `render(s)` - s = sekundy od detonacji (ujemne = przed wybuchem: spokojne miasto o zmierzchu).
 */
export class NukeBlast {
  readonly image: Phaser.GameObjects.Image;
  private tex: Phaser.Textures.CanvasTexture;
  private img: ImageData;
  private buf: Uint32Array;
  private sky = new Uint32Array(W * H);
  private layers: Layer[] = [];
  private fires: { x: number; y: number; s: number; ph: number }[] = [];
  private embers: Ember[] = [];
  private puffs: Puff[] = [];
  private mask = new Uint8Array(W * H);
  private lastS = Number.NaN;
  private scene: Phaser.Scene;
  private key: string;
  readonly cx: number;
  readonly gy: number;

  constructor(scene: Phaser.Scene, key: string, cx = 262, gy = 198) {
    this.scene = scene;
    this.key = key;
    this.cx = cx;
    this.gy = gy;
    if (scene.textures.exists(key)) scene.textures.remove(key);
    const tex = scene.textures.createCanvas(key, W, H);
    if (!tex) throw new Error('canvas texture');
    this.tex = tex;
    this.img = tex.getContext().createImageData(W, H);
    this.buf = new Uint32Array(this.img.data.buffer);
    this.image = scene.add.image(0, 0, key).setOrigin(0);
    this.paintSky();
    this.paintCity();
    const r = rng(77);
    for (let i = 0; i < 70; i++) {
      const a = -Math.PI * (0.08 + r() * 0.84), sp = 30 + r() * 110;
      this.embers.push({ x: cx + (r() - 0.5) * 10, y: gy - 10 - r() * 10, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 1.2 + r() * 2.8, hot: r() });
    }
  }

  destroy(): void {
    this.image.destroy();
    if (this.scene.textures.exists(this.key)) this.scene.textures.remove(this.key);
  }

  // ---------------------------------------------------------------- warstwy statyczne

  private paintSky(): void {
    const gy = this.gy;
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        let c: number;
        if (y <= gy) {
          // smugi chmur warstwowych nad horyzontem
          const t = y / gy;
          const streak = fbm(x * 0.012, y * 0.09, 3) - 0.5;
          const v = t * 0.98 + (t > 0.45 ? streak * 0.16 * Math.sin(t * Math.PI) : 0);
          c = rampPx(SKY, v, x, y);
          // gwiazdy w górnej części
          if (y < 70 && hash2(x, y, 9) > 0.996 - (70 - y) * 0.00003) c = y < 40 ? 0xd8d0e8 : 0x8a80a8;
        } else {
          const v = 0.55 + (fbm(x * 0.08, y * 0.4, 5) - 0.5) * 0.7 - (y - gy) * 0.004;
          c = rampPx(GROUND, v, x, y);
        }
        this.sky[y * W + x] = px(c);
      }
  }

  private paintCity(): void {
    const r = rng(1103);
    const bs: Building[] = [];
    // [warstwa, liczba, hMin, hMax, wMin, wMax, podstawa]
    const spec: [number, number, number, number, number, number][] = [
      [0, 46, 30, 112, 8, 20],
      [1, 38, 18, 80, 10, 24],
      [2, 30, 8, 46, 12, 30],
    ];
    for (const [layer, n, hMin, hMax, wMin, wMax] of spec) {
      let x = -10 + r() * 8;
      for (let i = 0; i < n && x < W + 10; i++) {
        const w = Math.round(wMin + r() * (wMax - wMin));
        // wyższe budynki bliżej środka (śródmieście) - grzyb wyrasta z centrum miasta
        const centre = 1 - Math.min(1, Math.abs(x + w / 2 - this.cx) / 260);
        const h = Math.round(hMin + (hMax - hMin) * (0.25 + 0.75 * r()) * (0.55 + 0.45 * centre));
        bs.push({ x: Math.round(x), w, h, layer, seed: Math.floor(r() * 1e6), kind: Math.floor(r() * 5) });
        x += w + (layer === 2 ? 1 + r() * 6 : r() * 4) - (layer === 0 ? 3 : 1);
      }
    }
    for (let l = 0; l < 3; l++) {
      const L: Layer = { intact: new Uint32Array(W * H), ruined: new Uint32Array(W * H), rimI: new Uint8Array(W * H), rimR: new Uint8Array(W * H) };
      const base = this.gy + l * 2;
      for (const b of bs) if (b.layer === l) {
        this.paintBuilding(L.intact, b, base, false);
        this.paintBuilding(L.ruined, b, base, true);
      }
      this.rim(L.intact, L.rimI);
      this.rim(L.ruined, L.rimR);
      this.layers.push(L);
    }
  }

  /** Budynek: bryła z jaśniejszą krawędzią od zachodu, okna, dachy (anteny, wieże ciśnień) albo ruina. */
  private paintBuilding(out: Uint32Array, b: Building, base: number, ruined: boolean): void {
    const pal = CITY[b.layer];
    const r = rng(b.seed);
    const top = base - b.h;
    const winStep = b.layer === 0 ? 3 : 4;
    // profil ruiny: poszarpana krawędź, niższa po stronie wybuchu
    const side = b.x + b.w / 2 < this.cx ? 1 : -1; // od której strony przyszła fala (1 = wybuch po prawej)
    const keep = 0.42 + r() * 0.38;
    const ruinTop = (x: number): number => {
      const u = (x - b.x) / b.w;
      const lean = side > 0 ? u : 1 - u; // strona od wybuchu niższa
      const jag = Math.round((hash2(x >> 2, b.seed & 1023, 4) - 0.5) * 5) + Math.sin(u * 6 + b.seed) * 4;
      return Math.round(base - b.h * keep * (0.55 + 0.45 * (1 - lean)) + jag);
    };
    const beams: number[] = [];
    if (ruined) for (let bx = b.x + 2; bx < b.x + b.w - 1; bx += 4 + Math.floor(r() * 5)) if (r() < 0.3) beams.push(bx);
    const beamTop = (bx: number): number => Math.round(base - b.h * keep - 4 - hash2(bx, b.seed, 8) * b.h * 0.22);
    for (let x = b.x; x < b.x + b.w; x++) {
      if (x < 0 || x >= W) continue;
      const yTop = ruined ? ruinTop(x) : top;
      for (let y = Math.max(0, yTop); y < base && y < H; y++) {
        const edge = x === b.x || x === b.x + 1 ? 2 : x === b.x + b.w - 1 ? 0 : 1;
        let c = pal[edge];
        const lx = x - b.x, ly = y - top;
        // okna
        if (lx > 1 && lx < b.w - 2 && ly > 3 && ly % winStep === 1 && lx % 3 === 1) {
          const hv = hash2(x, y, b.seed);
          if (ruined) c = hv < 0.08 ? WIN_LIT[0] : hv < 0.55 ? 0x0a0608 : c;
          else c = hv < 0.12 ? WIN_LIT[2] : hv < 0.3 ? WIN_LIT[1] : hv < 0.36 ? WIN_LIT[0] : pal[0] === c ? c : pal[0];
        }
        // ruina: dziury w ścianie (przezroczyste - widać to, co za nią) i stropy
        if (ruined && ly > 0) {
          const hole = fbm(x * 0.22, y * 0.16, b.seed & 255, 2);
          if (hole > 0.74 && y < base - 4 && b.layer > 0) {
            if (ly % 5 === 0) c = pal[1]; // strop przecina dziurę
            else continue;
          }
        }
        out[y * W + x] = px(c);
      }
      // rumowisko u stóp ruiny
      if (ruined) {
        const pile = Math.round(3 + hash2(x, 3, b.seed) * 3 + Math.sin((x - b.x) * 0.4) * 1.5);
        for (let y = base - pile; y < base; y++) if (y >= 0 && y < H) out[y * W + x] = px(pal[(x + y) & 1 ? 0 : 1]);
      }
    }
    if (!ruined) {
      // dach: antena / maszt / wieża ciśnień / stopień
      const cxB = b.x + (b.w >> 1);
      if (b.kind === 0) for (let y = top - 9 - (b.layer === 0 ? 6 : 0); y < top; y++) this.put(out, cxB, y, pal[0]);
      if (b.kind === 1) {
        for (let y = top - 6; y < top; y++) { this.put(out, cxB - 2, y, pal[0]); this.put(out, cxB + 2, y, pal[0]); }
        for (let x = cxB - 3; x <= cxB + 3; x++) for (let y = top - 10; y < top - 5; y++) this.put(out, x, y, pal[x === cxB - 3 ? 2 : 1]);
      }
      if (b.kind === 2 && b.w > 10) for (let x = b.x + 2; x < b.x + b.w - 2; x++) for (let y = top - 4; y < top; y++) this.put(out, x, y, pal[1]);
      if (b.kind === 3) for (let x = b.x + 1; x < b.x + b.w - 1; x++) this.put(out, x, top - 1, pal[2]);
    } else {
      // stalowe dźwigary sterczące z ruiny + wygięte końce
      for (const bx of beams) {
        const t0 = beamTop(bx);
        for (let y = t0; y < ruinTop(bx); y++) this.put(out, bx, y, pal[0]);
        this.put(out, bx + side, t0 - 1, pal[0]);
        for (let y = t0 + 4; y < ruinTop(bx); y += 5) this.put(out, bx - 1, y, pal[1]);
        if (this.fires.length < 60 && hash2(bx, 1, b.seed) < 0.5 && b.layer > 0) this.fires.push({ x: bx, y: ruinTop(bx), s: b.layer === 2 ? 2 : 1, ph: hash2(bx, 2, b.seed) * 6.28 });
      }
    }
  }

  private put(out: Uint32Array, x: number, y: number, c: RGB): void {
    if (x >= 0 && y >= 0 && x < W && y < H) out[y * W + x] = px(c);
  }

  /** Znakuje piksele bryły sąsiadujące z pustym od strony wybuchu albo od góry (obrys światłem). */
  private rim(src: Uint32Array, out: Uint8Array): void {
    for (let y = 1; y < H; y++)
      for (let x = 1; x < W - 1; x++) {
        const i = y * W + x;
        if (!src[i]) continue;
        const toward = x < this.cx ? i + 1 : i - 1;
        if (!src[toward]) out[i] = 2;
        else if (!src[i - W]) out[i] = 1;
      }
  }

  // ---------------------------------------------------------------- klatka

  /** s - sekundy od detonacji. */
  render(s: number): void {
    // ta sama klatka (np. pauza) - nie liczymy drugi raz
    if (s === this.lastS) return;
    this.lastS = s;
    const { cx, gy, buf } = this;
    const k = Math.max(0, s);
    const boomed = s > 0;
    // fala uderzeniowa: promień frontu na ziemi (px), szybka na starcie, potem zwalnia
    const R = boomed ? 260 * (1 - Math.exp(-k / 1.4)) + 30 * k : -1;
    // jasność kuli ognia i poświaty
    const heat = boomed ? Math.exp(-k / 1.8) : 0;
    const glow = boomed ? Math.min(1, k * 8) * (0.28 + 0.72 * heat) : 0;
    // po bieli: krótka klatka kontrastowych sylwetek (0.1-0.42 s), potem kolory wracają spod gasnącej poświaty
    const silhouette = boomed && k > 0.1 && k < 0.42;
    const flashT = boomed && k >= 0.42 ? 0.7 * Math.exp(-(k - 0.42) * 2.4) : 0;
    // geometria grzyba
    const E = 1 - Math.exp(-k / 2.4);
    const hc = 14 + 104 * E; // wysokość środka czapy
    const capY = gy - hc;
    const rx = 12 + 54 * (1 - Math.exp(-k / 2.0));
    const ry = 10 + 20 * (1 - Math.exp(-k / 2.0));
    const fy = boomed ? capY : gy;

    // 1) niebo + poświata (pasmami z ditheringiem - bez gładkich gradientów)
    const gr = 130 + 120 * glow;
    for (let y = 0; y < H; y++) {
      const row = y * W;
      for (let x = 0; x < W; x++) {
        let p = this.sky[row + x];
        if (glow > 0) {
          const dx = (x - cx) / gr, dy = (y - fy) / (gr * 0.7);
          const d = 1 - Math.sqrt(dx * dx + dy * dy);
          if (d > 0) {
            const q = Math.floor((d * d * glow * 6 + bayer(x, y)) ) / 6;
            if (q > 0) p = addPx(p, 255, 120 + 60 * heat, 40 + 40 * heat, q * (y > gy ? 0.5 : 0.85));
          }
        }
        if (silhouette) {
          const dx = (x - cx) / 260, dy = (y - fy) / 180;
          p = px(rampPx(FIRE, 1.15 - Math.sqrt(dx * dx + dy * dy) * 0.9, x, y));
        }
        buf[row + x] = p;
      }
    }

    // 2) miasto: kolumny w zasięgu fali są już ruiną (dalsze warstwy fala mija później - jest dalej)
    for (let l = 0; l < 3; l++) {
      const L = this.layers[l];
      const reach = R * (1 - l * 0.08) + (l === 0 ? -20 : 0);
      for (let x = 0; x < W; x++) {
        const ruin = boomed && Math.abs(x - cx) < reach;
        const src = ruin ? L.ruined : L.intact, rim = ruin ? L.rimR : L.rimI;
        const dist = Math.abs(x - cx);
        // światło wybuchu na krawędziach: silne na starcie, słabnie z odległością
        const li = glow * (1.15 - Math.min(1, dist / 300)) * (l === 2 ? 1 : 0.7);
        for (let y = 0; y < H; y++) {
          const i = y * W + x;
          const p = src[i];
          if (!p) continue;
          let q = p;
          if (rim[i] && li > 0.05) {
            const e = rim[i] === 2 ? li : li * 0.6;
            q = addPx(q, 255, 150, 70, Math.floor((e * 3 + bayer(x, y)) ) / 3 * 0.75);
          }
          if (glow > 0) q = addPx(q, 120, 40, 20, glow * 0.12);
          buf[i] = silhouette ? 0xff04080e : q;
        }
      }
    }

    // 3) pożary w ruinach
    if (boomed) for (const f of this.fires) {
      if (Math.abs(f.x - cx) > R * 0.9) continue;
      const fl = 0.6 + 0.4 * Math.sin(k * 11 + f.ph) * Math.sin(k * 7.3 + f.ph * 2);
      const hgt = Math.round((2 + 3 * fl) * f.s);
      for (let j = 0; j < hgt; j++) {
        const y = f.y - j;
        if (y < 0 || y >= H) continue;
        const v = 1 - j / hgt;
        for (let dx = -f.s + 1; dx < f.s; dx++) {
          const x = f.x + dx + (j > 1 && hash2(j, Math.floor(k * 12), f.x) > 0.6 ? 1 : 0);
          if (x >= 0 && x < W) buf[y * W + x] = px(rampPx(FIRE, v * 0.8 - Math.abs(dx) * 0.2, x, y));
        }
      }
    }

    if (boomed) {
      if (!silhouette) this.dustWall(k, R);
      this.cloud(k, heat, capY, rx, ry, hc);
      this.condensation(k, capY, rx, ry);
      this.drawEmbers(k);
      // niebo zalane bielą w pierwszych chwilach (pod białym prostokątem sceny)
      if (flashT > 0.02)
        for (let i = 0; i < W * H; i++) {
          const x = i % W, y = (i / W) | 0;
          const t = Math.floor((flashT * 4 + bayer(x, y))) / 4;
          if (t > 0) buf[i] = lerpPx(buf[i], 255, 236, 196, Math.min(1, t) * 0.85);
        }
    }

    this.tex.getContext().putImageData(this.img, 0, 0);
    this.tex.refresh();
  }

  /** Ściana pyłu pchana przez falę uderzeniową wzdłuż ziemi + niski całun za nią. */
  private dustWall(k: number, R: number): void {
    const { cx, gy, buf } = this;
    const amp = 30 * Math.exp(-k / 5) + 6;
    for (let x = 0; x < W; x++) {
      const d = Math.abs(x - cx);
      if (d > R + 6) continue;
      const behind = R - d; // > 0: front już przeszedł
      const front = Math.exp(-((behind / 26) ** 2)); // grzbiet fali
      const haze = Math.min(1, behind / 60) * 0.45;
      const hgt = amp * Math.max(front, haze) * (0.65 + 0.7 * fbm(x * 0.06 + k * 0.6 * Math.sign(x - cx), k * 0.2, 31));
      const lit = x < cx ? 1 : 0; // strona zwrócona do wybuchu
      for (let j = 0; j < hgt; j++) {
        const y = gy + 3 - j;
        if (y < 0 || y >= H) continue;
        const v = 1 - j / Math.max(1, hgt);
        const n = fbm(x * 0.15 - k * Math.sign(x - cx) * 1.5, y * 0.15, 32, 2);
        if (j > hgt - 3 && n < 0.45) continue; // postrzępiony wierzch
        const shade = 0.2 + v * 0.35 + (n - 0.5) * 0.5 + front * 0.25 + (((x - cx) > 0) === (lit === 0) ? 0.1 : 0);
        buf[y * W + x] = px(rampPx(DUST, shade, x, y));
      }
    }
  }

  /**
   * Grzyb z "kłębów": kule ułożone w torus czapy (toczą się - w środku w górę, na brzegu w dół), kopuła,
   * trzon z unoszących się kłębów i kołnierz pyłu przy ziemi. Każdy kłąb cieniowany własną normalną:
   * od dołu ogień, od góry zmierzch; na końcu obrys sylwetki - klasyczny "malowany" pixel art.
   */
  private cloud(k: number, heat: number, capY: number, rx: number, ry: number, hc: number): void {
    const { cx, gy, buf } = this;
    const P = this.puffs;
    P.length = 0;
    const roll = k * 0.5;
    const grow = clamp01(k / 0.6);
    // czapa: torus
    const Rm = rx * 0.7, rm = ry * 0.62;
    const ember = 0.62 * Math.exp(-k / 14); // żar w spodzie czapy, gaśnie powoli
    const nPhi = 18, nTh = 4;
    for (let i = 0; i < nPhi; i++) {
      const phi = (i / nPhi) * Math.PI * 2 + 0.2;
      for (let j = 0; j < nTh; j++) {
        const th = (j / nTh) * Math.PI * 2 + roll + i * 0.9;
        const ring = Rm + rm * Math.cos(th);
        const z = ring * Math.sin(phi);
        const under = Math.max(0, Math.sin(th)), inner = Math.max(0, -Math.cos(th));
        P.push({
          x: cx + ring * Math.cos(phi), y: capY + rm * Math.sin(th) * 0.7 + z * 0.16, z,
          r: rm * (0.68 + 0.3 * hash2(i, j, 5)) * (0.55 + 0.45 * grow),
          heat: heat * 1.15 + (0.3 * under + 0.25 * inner) * (0.35 + 0.65 * heat) + ember * (under * 0.9 + inner * 0.5), seed: i * 7 + j, dust: false,
        });
      }
    }
    // kopuła
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + roll * 0.3;
      P.push({ x: cx + Math.cos(a) * Rm * 0.45, y: capY - rm * (0.55 + 0.2 * Math.sin(a * 2)), z: Math.sin(a) * Rm * 0.45 - 4, r: rm * (0.95 + 0.2 * hash2(i, 9, 5)) * (0.55 + 0.45 * grow), heat: heat * 1.1, seed: 50 + i, dust: false });
    }
    // trzon: kłęby płyną w górę i znikają w czapie
    if (k > 0.3) {
      const stemOn = clamp01((k - 0.3) / 1.0);
      const sw = (3.5 + 5 * (1 - Math.exp(-k / 2.4))) * stemOn;
      const n = Math.max(3, Math.ceil(hc / 5));
      for (let j = 0; j < n; j++) {
        const t = ((j + (k * 1.6) % 1) / n);
        const y = gy - t * (hc - rm * 0.3);
        const wob = Math.sin(y * 0.08 + k * 1.2) * 1.8;
        P.push({ x: cx + wob + (hash2(j, Math.floor(k * 1.6), 6) - 0.5) * 2, y, z: -1 + (j & 1) * 2, r: sw * (1 + 2.2 * (1 - t) ** 6) + 2 * t, heat: heat * 1.2 + 0.32 * t * (0.4 + 0.6 * heat) + ember * 0.6 * t, seed: 100 + j, dust: false });
      }
    }
    // kołnierz pyłu u podstawy (płaski torus przy ziemi)
    const sk = 1 - Math.exp(-k / 2.4);
    if (k > 0.1) for (let i = 0; i < 18; i++) {
      const phi = (i / 18) * Math.PI * 2 + 0.1;
      const R = (12 + 62 * sk) * (0.55 + 0.45 * hash2(i, 3, 7));
      const z = Math.sin(phi) * R;
      P.push({ x: cx + Math.cos(phi) * R, y: gy - 3 + z * 0.08, z: z - 30, r: (4 + 7 * sk) * (0.7 + 0.5 * hash2(i, 4, 7)), heat: heat * 0.7 * (1 - R / 80), seed: 200 + i, dust: true });
    }
    // kula ognia w pierwszych chwilach
    if (k < 2.2) {
      const f = 1 - k / 2.2;
      P.push({ x: cx, y: capY + 2, z: 40, r: (9 + 16 * clamp01(k / 0.3)) * (0.5 + 0.5 * f) , heat: 1.4 * f + 0.2, seed: 300, dust: false });
    }
    P.sort((a, b) => a.z - b.z);

    const mask = this.mask;
    let bx0 = W, bx1 = 0, by0 = H, by1 = 0;
    for (const p of P) {
      const r = p.r;
      const x0 = Math.max(0, Math.floor(p.x - r - 2)), x1 = Math.min(W - 1, Math.ceil(p.x + r + 2));
      const y0 = Math.max(0, Math.floor(p.y - r - 2)), y1 = Math.min(gy + 3, Math.ceil(p.y + r + 2));
      if (x0 < bx0) bx0 = x0;
      if (x1 > bx1) bx1 = x1;
      if (y0 < by0) by0 = y0;
      if (y1 > by1) by1 = y1;
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++) {
          const dx = (x + 0.5 - p.x) / r, dy = (y + 0.5 - p.y) / r;
          const d2 = dx * dx + dy * dy;
          if (d2 > 1.25) continue;
          const n = vnoise(x * 0.3 + p.seed * 3.1, y * 0.3 - k * 0.8, 21);
          if (d2 + (n - 0.5) * 0.5 > 1) continue;
          const nz = Math.sqrt(Math.max(0, 1 - d2));
          const below = clamp01(dy * 0.85 + 0.15); // normalna w dół -> światło ognia
          const top = clamp01(-dy * 0.7 - dx * 0.35 + nz * 0.25);
          const t = p.heat * (0.5 + 0.65 * below) + (n - 0.5) * 0.3 + (bayer(x, y) - 0.5) * 0.12;
          let c: number;
          if (!p.dust && t > 0.5) c = rampPx(FIRE, (t - 0.5) / 0.75, x, y);
          else {
            const warm = below * (0.3 + 0.9 * Math.min(1, p.heat));
            const cool = top * 0.85;
            let v = 0.14 + Math.max(warm, cool) * 0.62 + nz * 0.14;
            if (d2 > 0.7 && dy + dx * 0.5 > 0.1) v -= 0.16; // ciemny brzeg kłębu po stronie cienia - rozdziela kłęby
            c = rampPx(p.dust ? DUST : cool > warm + (bayer(x, y) - 0.5) * 0.1 ? SMOKE_COOL : SMOKE, v, x, y);
          }
          const i = y * W + x;
          buf[i] = px(c);
          mask[i] = 1;
        }
    }
    // obrys sylwetki + czyszczenie maski
    for (let y = by0; y <= by1; y++)
      for (let x = bx0; x <= bx1; x++) {
        const i = y * W + x;
        if (mask[i] !== 1) continue;
        if (x === 0 || x === W - 1 || y === 0 || !mask[i - 1] || !mask[i + 1] || !mask[i - W] || (y < gy && !mask[i + W])) mask[i] = 2;
      }
    for (let y = by0; y <= by1; y++)
      for (let x = bx0; x <= bx1; x++) {
        const i = y * W + x;
        if (mask[i] === 2) buf[i] = px(SMOKE[0]);
        mask[i] = 0;
      }
  }

  /** Chmura Wilsona: rozszerzający się biały pierścień kondensacji wokół czapy (krótko po wybuchu). */
  private condensation(k: number, capY: number, rx: number, ry: number): void {
    if (k < 0.5 || k > 3.4) return;
    const a = Math.sin(((k - 0.5) / 2.9) * Math.PI);
    const rw = rx * 1.15 + (k - 0.5) * 34, rh = ry * 0.6 + (k - 0.5) * 6;
    const { cx, buf } = this;
    for (let i = 0; i < 900; i++) {
      const ang = (i / 900) * Math.PI * 2;
      const x = Math.round(cx + Math.cos(ang) * rw), y = Math.round(capY + ry * 0.5 + Math.sin(ang) * rh);
      if (x < 0 || x >= W || y < 0 || y >= H) continue;
      const n = vnoise(ang * 6, k * 2, 41);
      if (n * a < 0.25 + bayer(x, y) * 0.35) continue;
      const front = Math.sin(ang) > 0; // przednia połowa jaśniejsza
      buf[y * W + x] = lerpPx(buf[y * W + x], 232, 226, 236, front ? 0.85 : 0.45);
      if (front && n > 0.6 && y + 1 < H) buf[(y + 1) * W + x] = lerpPx(buf[(y + 1) * W + x], 200, 196, 214, 0.5);
    }
  }

  private drawEmbers(k: number): void {
    const { buf } = this;
    for (const e of this.embers) {
      if (k > e.life) continue;
      const x = Math.round(e.x + e.vx * k), y = Math.round(e.y + e.vy * k + 22 * k * k);
      if (x < 0 || x >= W || y < 0 || y >= this.gy + 2) continue;
      const v = (1 - k / e.life) * (0.5 + e.hot * 0.5);
      buf[y * W + x] = px(rampPx(FIRE, v, x, y));
    }
  }
}

// ================================================================== plansza 2: ulica ruin

/** Paleta planszy ruin (zielona, toksyczna mgła); każdy piksel tła kwantyzowany do niej z ditheringiem. */
const RUIN_PAL = hexes([
  '#06090a', '#0b1210', '#111a16', '#17231c', '#1e2c22', '#26362a', '#2f4232', '#3a4e3a', '#465c42', '#536a4a', '#627a52', '#738a5c', '#869a66', '#9cae74', '#b8c688', '#d6e0a4',
  '#1a1614', '#2a221c', '#3c3026', '#4e3e2e', '#624c36', '#7a5c3e', '#94704a', // rdza / cegła
  '#20262a', '#2e363a', '#3e484a', '#525c5a', '#68716a', '#828a7c', // beton
  '#0e2a20', '#c8f070', '#8ad040', '#ffd06a', '#d88a3a', // światła okien
]);
const PAL_RGB = RUIN_PAL.map((c) => [R_(c), G_(c), B_(c)] as const);

function quantize(r: number, g: number, b: number, x: number, y: number): number {
  const o = (bayer(x, y) - 0.5) * 22;
  r += o; g += o; b += o;
  let best = 0, bd = 1e9;
  for (let i = 0; i < PAL_RGB.length; i++) {
    const p = PAL_RGB[i];
    const dr = r - p[0], dg = g - p[1], db = b - p[2];
    const d = dr * dr * 0.3 + dg * dg * 0.59 + db * db * 0.11;
    if (d < bd) { bd = d; best = i; }
  }
  return RUIN_PAL[best];
}

interface Block { z0: number; z1: number; h: number; d: number; dmg: number; mat: number; seed: number }
interface Box { x0: number; x1: number; y0: number; y1: number; z0: number; z1: number; col: RGB; kind: number }

/**
 * Tło planszy "ruiny": ulica w perspektywie śledzona promieniami (fasady, ściany czołowe, jezdnia, wraki jako bryły),
 * kwantyzowana do palety z ditheringiem. Rysuje na kontekście 2D (wywoływane raz przez canvasTexture).
 */
export function paintRuinStreet(g: CanvasRenderingContext2D, VX: number, VY: number, F: number): void {
  const img = g.createImageData(W, H);
  const out = new Uint32Array(img.data.buffer);
  const EYE = 2.2, STREET = 7, ROAD = 5.2;
  const FOG: RGB = 0x5f7a52;
  const SUN = { x: VX + 58, y: 46, r: 13 };
  const r = rng(2024);
  // kwartały po obu stronach ulicy
  const sides: Block[][] = [[], []];
  for (let s = 0; s < 2; s++) {
    let z = 1.6 + r() * 1.2;
    while (z < 60) {
      const len = 2.5 + r() * 5;
      const gap = r() < 0.2;
      if (!gap) sides[s].push({ z0: z, z1: z + len, h: z < 9 ? 6 + r() * 6 : 8 + r() * 22, d: 3 + r() * 6, dmg: 0.45 + r() * 0.5, mat: Math.floor(r() * 3), seed: Math.floor(r() * 1e6) });
      z += len + (gap ? 1.2 + r() * 1.8 : 0);
    }
  }
  const MATS: RGB[][] = [
    [0x20262a, 0x343c3c, 0x4e5850], // beton
    [0x2a1e1a, 0x44302a, 0x5e4434], // cegła
    [0x141e1e, 0x22302e, 0x36483e], // szkło / stal
  ];
  // wraki aut i gruz jako prostopadłościany
  const boxes: Box[] = [];
  const carCols: RGB[] = [0x5a3a2a, 0x3a3a34, 0x6a4a30, 0x2c3a36, 0x4a2a24];
  for (let i = 0; i < 9; i++) {
    const z = 3 + i * 2.6 + r() * 2, x = (r() - 0.5) * 6.5, ang = r() < 0.5;
    const w = ang ? 3.6 : 1.7, l = ang ? 1.7 : 3.8;
    boxes.push({ x0: x - w / 2, x1: x + w / 2, y0: 0, y1: 0.75, z0: z, z1: z + l, col: carCols[i % carCols.length], kind: 0 });
    boxes.push({ x0: x - w / 2 + (ang ? 0.6 : 0.15), x1: x + w / 2 - (ang ? 0.6 : 0.15), y0: 0.75, y1: 1.3, z0: z + (ang ? 0.15 : 0.9), z1: z + l - (ang ? 0.15 : 1.0), col: carCols[i % carCols.length], kind: 1 });
  }
  for (let i = 0; i < 40; i++) {
    const s = r() < 0.5 ? -1 : 1, z = 2 + r() * 30, x = s * (STREET - 0.3 - r() * r() * 4), sz = 0.25 + r() * 0.9;
    boxes.push({ x0: x - sz, x1: x + sz * (0.6 + r()), y0: 0, y1: sz * (0.4 + r() * 0.7), z0: z, z1: z + sz * (0.8 + r() * 1.4), col: r() < 0.3 ? 0x5c4434 : 0x4a5250, kind: 2 });
  }
  // hałdy gruzu pod zrujnowanymi fasadami: piętrowane bloki, niższe ku jezdni
  for (let sd = 0; sd < 2; sd++)
    for (const blk of sides[sd]) {
      if (blk.z0 > 24 || blk.dmg < 0.6) continue;
      const sg = sd ? 1 : -1;
      for (let i = 0; i < 9; i++) {
        const zc = blk.z0 + r() * (blk.z1 - blk.z0), out = r() * r() * 2.6, sz = 0.3 + r() * 0.5;
        const hgt = (2.8 - out) * (0.35 + r() * 0.3);
        const xa = sg * (STREET - out);
        boxes.push({ x0: Math.min(xa, xa - sg * sz * 2), x1: Math.max(xa, xa - sg * sz * 2), y0: 0, y1: Math.max(0.2, hgt), z0: zc, z1: zc + sz * 2, col: blk.mat === 1 ? 0x5c4434 : 0x4a5250, kind: 2 });
      }
    }
  // przewrócona latarnia i dźwigar w poprzek jezdni
  boxes.push({ x0: -3.8, x1: 1.2, y0: 0, y1: 0.18, z0: 9.2, z1: 9.4, col: 0x2a3030, kind: 3 });
  boxes.push({ x0: STREET - 0.4, x1: STREET - 0.2, y0: 0, y1: 4.8, z0: 6.0, z1: 6.2, col: 0x2a3030, kind: 3 });
  boxes.push({ x0: STREET - 1.6, x1: STREET - 0.2, y0: 4.6, y1: 4.8, z0: 6.0, z1: 6.2, col: 0x2a3030, kind: 3 });
  boxes.push({ x0: -STREET + 0.1, x1: -1.5, y0: 0, y1: 0.45, z0: 15, z1: 15.4, col: 0x3a2a22, kind: 3 }); // dźwigar zwalony z fasady

  const skyAt = (x: number, y: number): RGB => {
    const t = clamp01(y / (VY + 4));
    let c = mix(mix(0x0a1612, 0x24402e, Math.min(1, t * 1.4)), 0x8aa26a, Math.max(0, t - 0.55) / 0.45);
    // smugi dymu
    const sm = fbm(x * 0.008 + 3, y * 0.035, 61, 4);
    c = mix(c, 0x0e1a14, clamp01((sm - 0.5) * 2.2) * (1 - t) * 0.9);
    // blade słońce za mgłą
    const ds = Math.hypot(x - SUN.x, (y - SUN.y) * 1.05);
    if (ds < SUN.r) c = mix(0xdfe8b0, 0xbcd08a, ds / SUN.r * 0.6);
    else c = mix(c, 0xa8bc7a, clamp01(1 - (ds - SUN.r) / 60) ** 2 * 0.55);
    return c;
  };
  /** Dalekie ruiny na horyzoncie (2 plany). */
  const farHeight = (x: number, layer: number): number => {
    const u = x * (layer ? 0.11 : 0.07) + layer * 40;
    const bi = Math.floor(u), b = hash2(bi, layer, 70);
    let hgt = (layer ? 10 : 22) * (0.3 + b) * (1 - Math.min(1, Math.abs(x - VX) / 400) * 0.3);
    const fu = u - bi;
    if (fu > 0.86) hgt *= 0.25; // przerwy
    hgt -= hash2(Math.floor(x / 2), layer, 71) * 4 * b; // poszarpane szczyty
    if (hash2(bi, layer, 72) > 0.7 && Math.abs(fu - 0.5) < 0.06) hgt += 8; // dźwigar
    return hgt;
  };

  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const dx = (x + 0.5 - VX) / F, dy = (VY - (y + 0.5)) / F;
      let col: RGB = -1, zHit = 1e9;
      // jezdnia / chodnik
      if (dy < 0) {
        const z = EYE / -dy, X = dx * z;
        zHit = z;
        const ax = Math.abs(X);
        if (ax < ROAD) {
          const n = fbm(X * 0.8, z * 0.4, 81, 3);
          col = mix(0x1c201e, 0x2e3330, n);
          const crack = Math.abs(fbm(X * 1.7, z * 0.9, 82, 3) - 0.5);
          if (crack < 0.018 && z < 22) col = 0x0c100e;
          if (ax < 0.1 && (z % 3) < 1.4 && hash2(Math.floor(z / 3), 0, 83) > 0.3) col = mix(0x8a7a4a, col, 0.35);
          // kałuże odbijające niebo
          if (fbm(X * 0.5 + 9, z * 0.25, 84, 2) > 0.68) col = mix(skyAt(x, 2 * VY - y), 0x1a2a20, 0.45);
          if (crack < 0.03 && hash2(Math.floor(X * 4), Math.floor(z * 4), 85) > 0.85 && z < 14) col = 0x3e5a2e; // chwasty
        } else {
          const tile = (Math.floor(z * 1.1) + Math.floor(X * 1.1)) & 1;
          col = mix(0x3a403a, 0x4a504a, tile * 0.5 + fbm(X, z, 86, 2) * 0.5);
          if (ax < ROAD + 0.12) col = 0x5a6258; // krawężnik
          // gruz pod fasadami
          const rb = fbm(X * 1.4, z * 1.4, 87, 3);
          if (rb > 0.55 - (ax - ROAD) * 0.05) col = mix(0x3c3a34, 0x6a6a5c, (rb - 0.5) * 2.2 * (hash2(Math.floor(X * 6), Math.floor(z * 6), 88) * 0.6 + 0.4));
        }
      }
      // fasady (płaszczyzny X = +-STREET) i ściany czołowe kwartałów
      if (Math.abs(dx) > 1e-4) {
        const s = dx > 0 ? 1 : 0;
        const zf = STREET / Math.abs(dx);
        const blocks = sides[s];
        for (const b of blocks) {
          if (b.z1 < zf && b.z0 < zf) continue;
          let zz: number, u: number, face: number;
          if (zf >= b.z0 && zf <= b.z1) { zz = zf; u = zf; face = 0; }
          else if (b.z0 > zf && Math.abs(dx) * b.z0 < STREET + b.d) { zz = b.z0; u = Math.abs(dx) * b.z0 - STREET; face = 1; }
          else continue;
          if (zz >= zHit) break;
          const hgt = EYE + dy * zz;
          if (hgt < 0) continue;
          const fl = 2.4; // wysokość piętra
          // poszarpana korona ruiny + stalowy szkielet ponad nią
          const crown = b.h * (1 - b.dmg * (0.25 + 0.75 * fbm(u * 0.5, b.seed & 255, 90, 3)));
          const jag = Math.floor(crown / fl) * fl + (hash2(Math.floor(u * 2), b.seed, 91) - 0.3) * fl;
          let c: RGB = -1;
          const mat = MATS[b.mat];
          const lightK = face === 1 ? 0.55 : s === 1 ? 1.0 : 0.62;
          if (hgt < jag) {
            const fu = (u / 1.1) % 1, fh = (hgt / fl) % 1;
            // wyrwy skupione pod koroną, z poszarpanym brzegiem
            const hole = fbm(u * 0.5, hgt * 0.4, b.seed & 511, 2) + (hgt / jag) * 0.38 + (vnoise(u * 5, hgt * 5, 94) - 0.5) * 0.16 > 1.12 - b.dmg * 0.3;
            if (hole) {
              // wnętrze: ciemność, krawędzie stropów, zwisające pręty
              c = fh < 0.1 ? mix(mat[1], 0x000000, 0.25) : fh < 0.16 ? 0x0a0e0c : 0x070a09;
              if (fh > 0.16 && fu > 0.46 && fu < 0.52 && hash2(Math.floor(u / 1.1), Math.floor(hgt / fl), b.seed) > 0.5) c = 0x3a2e24;
            } else {
              const n = fbm(u * 1.3, hgt * 0.9, b.seed & 1023, 2);
              c = mix(mat[0], mat[2], lightK * (0.55 + (n - 0.5) * 0.6));
              // brud: ciemniej przy ziemi i zacieki pod koroną
              c = mix(c, 0x0a0c0a, clamp01(0.35 - hgt * 0.12) + clamp01(fbm(u * 3, hgt * 0.25, 93, 2) - 0.55) * 0.8);
              if (fh < 0.07) c = mix(c, 0x000000, 0.25); // gzyms piętra
              const win = fu > 0.24 && fu < 0.72 && fh > 0.32 && fh < 0.8 && zz < 26;
              if (win) {
                const wv = hash2(Math.floor(u / 1.1), Math.floor(hgt / fl), b.seed + 3);
                c = wv < 0.04 ? 0xc8f070 : wv < 0.065 ? 0xffd06a : mix(0x0a0e0c, 0x1c2620, fh > 0.7 ? 0.6 : 0);
                if (wv > 0.04 && fh < 0.36) c = mix(mat[2], 0xffffff, 0.12); // parapet
              }
              // sadza nad oknami i pęknięcia
              if (!win && fh > 0.8 && fu > 0.22 && fu < 0.74 && hash2(Math.floor(u / 1.1), Math.floor(hgt / fl), b.seed + 5) > 0.55) c = mix(c, 0x0a0c0a, 0.5);
              // jaśniejsza krawędź korony (światło z nieba)
              if (jag - hgt < 0.25) c = mix(c, 0xb8c688, 0.35);
            }
          } else if (hgt < b.h * 0.95) {
            // szkielet: słupy co 1.5 i strzępy stropów
            const fu = (u / 1.1) % 1;
            const col2 = Math.floor(u / 1.1);
            const top = jag + (b.h * 0.95 - jag) * hash2(col2, b.seed, 92);
            if (fu < 0.09 && hgt < top) c = mix(0x1a1614, 0x4e3e2e, lightK * 0.7);
            else if ((hgt / fl) % 1 < 0.06 && hgt < top - 0.3 && hash2(col2, Math.floor(hgt / fl), b.seed + 9) > 0.4) c = mix(0x26302c, 0x525c5a, lightK);
          }
          if (c >= 0) { col = c; zHit = zz; break; }
        }
      }
      // wraki / gruz (przecięcie promienia z prostopadłościanem)
      for (const bx of boxes) {
        let tmin = 0, tmax = zHit, axis = -1;
        const ox = 0, oy = EYE, oz = 0; // oko
        const dir = [dx, dy, 1];
        const lo = [bx.x0, bx.y0, bx.z0], hi = [bx.x1, bx.y1, bx.z1], o = [ox, oy, oz];
        let miss = false;
        for (let a = 0; a < 3; a++) {
          if (Math.abs(dir[a]) < 1e-9) { if (o[a] < lo[a] || o[a] > hi[a]) { miss = true; break; } continue; }
          let t0 = (lo[a] - o[a]) / dir[a], t1 = (hi[a] - o[a]) / dir[a];
          if (t0 > t1) { const tt = t0; t0 = t1; t1 = tt; }
          if (t0 > tmin) { tmin = t0; axis = a; }
          if (t1 < tmax) tmax = t1;
          if (tmin > tmax) { miss = true; break; }
        }
        if (miss || axis < 0 || tmin >= zHit) continue;
        zHit = tmin;
        const hx = dx * tmin, hy = EYE + dy * tmin, hz = tmin;
        const k = axis === 1 ? 1.0 : axis === 0 ? (hx > 0 ? 0.5 : 0.75) : 0.62;
        let c = mix(shadeC(bx.col, 0.35), shadeC(bx.col, 1.3), k);
        if (bx.kind <= 1) c = mix(c, 0x1a120e, clamp01(fbm(hx * 3, hz * 3 + hy, 95, 2) - 0.35) * 1.4); // rdza i spalenizna
        if (bx.kind === 1 && axis !== 1) c = 0x0c1210; // wybite szyby
        if (bx.kind === 2) {
          // odłamki: ziarnista faktura, ciemne szczeliny, zielonkawy nalot na górze
          const ch = hash2(Math.floor(hx * 9), Math.floor(hz * 9 + hy * 9), 96);
          c = mix(shadeC(bx.col, axis === 1 ? 0.95 : k * 0.8), 0x101412, ch < 0.25 ? 0.75 : ch * 0.35);
          if (axis === 1 && ch > 0.85) c = 0x3a4a34;
        }
        col = c;
      }
      if (col < 0) {
        // niebo i dalekie ruiny
        col = skyAt(x, y);
        const hFar0 = farHeight(x, 0), hFar1 = farHeight(x, 1);
        if (y > VY - hFar0 && y <= VY + 4) col = mix(0x3e5240, FOG, 0.35 + (hash2(x, y, 73) < 0.03 ? -0.2 : 0));
        if (y > VY - hFar1 && y <= VY + 6) col = mix(0x2a3a2e, FOG, 0.2);
        out[y * W + x] = px(quantize(R_(col), G_(col), B_(col), x, y));
        continue;
      }
      // mgła: zielona, gęstsza nisko i daleko
      const fogK = clamp01(1 - Math.exp(-zHit / 16)) * 0.85 + (y > VY - 20 && y < VY + 30 ? 0.05 : 0);
      col = mix(col, FOG, Math.min(0.92, fogK));
      out[y * W + x] = px(quantize(R_(col), G_(col), B_(col), x, y));
    }
  g.putImageData(img, 0, 0);
}

const shadeC = (c: RGB, k: number): RGB => (k > 1 ? mix(c, 0xffffff, k - 1) : mix(0, c, k));
