// Postacie z gotowych sprite'ów (PixelLab, 64x64 px, 8 kierunków) zamiast proceduralnych klatek 24x32.
//
// Każdy rekrut z RECRUITS ma katalog src/assets/units/<id>/ z ośmioma obrotami (south, south-east, ...) oraz
// portret src/assets/portraits/<id>.png (popiersie 64x64). Obrazy są wczytywane w BootScene (preloadSprites).
//
// Gra animuje postacie klatkami o stałych nazwach ('f_idle0' ... 'b_heal3', patrz UnitArt.ANIMS). Sprite'y PixelLab
// są statyczne, więc klatki animacji składamy z jednego obrotu, przekształcając go wg pozy: oddech (opadanie tułowia),
// chód (kołysanie nóg), wypad / odrzut, przysiad (ściśnięcie w pionie), upadek i leżenie (obrót wokół stóp),
// błysk wystrzału, czerwony błysk trafienia. Przód ('f', w prawo-w dół) = obrót south-east, tył ('b', w prawo-w górę)
// = north-east; lewe kierunki daje setFlipX w scenie, jak dla klatek proceduralnych.
//
// Klatki są w 2x gęstości projektowej (64 px obrazu = 32 px projektowe): klatka 32x36 px projektowych, stopy w
// (16, 31.5) - ten sam punkt zaczepienia (UNIT_FOOT_X / UNIT_FW, UNIT_FOOT_Y / UNIT_FH = 0.5, 0.875) co klatki 24x32.
import type Phaser from 'phaser';
import { RECRUITS } from '../../core/data/recruits';
import { PixelCanvas } from './Pixel';
import { ANIMS, ANIM_ORDER, type Pose, type UnitSheet } from './UnitArt';

export const SPRITE_DIRS = ['south', 'south-east', 'east', 'north-east', 'north', 'north-west', 'west', 'south-west'] as const;
export type SpriteDir = (typeof SPRITE_DIRS)[number];

const UNIT_URLS = import.meta.glob('../../assets/units/*/*.png', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
const PORTRAIT_URLS = import.meta.glob('../../assets/portraits/*.png', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;

/** Id postaci z kompletem obrotów. */
const UNITS = new Set<string>();
const PORTRAITS = new Set<string>();
for (const path of Object.keys(UNIT_URLS)) UNITS.add(path.split('/').slice(-2)[0]);
for (const path of Object.keys(PORTRAIT_URLS)) PORTRAITS.add(path.split('/').pop()!.replace('.png', ''));

/** Gęstość obrazu względem pikseli projektowych. */
export const SPRITE_DENSITY = 2;
/** Klatka w pikselach obrazu (32x36 projektowych). */
const FW = 64, FH = 72;
/** Stopy w klatce (piksele obrazu): 0.5 i 0.875 rozmiaru, jak UNIT_FOOT_X / UNIT_FW i UNIT_FOOT_Y / UNIT_FH. */
const FOOT_X = 32, FOOT_Y = 63;

export const spriteTexKey = (id: string, dir: SpriteDir): string => `pl_${id}_${dir}`;
export const spritePortraitKey = (id: string): string => `plp_${id}`;

/** Wczytuje obroty i portrety (wywołać w preload pierwszej sceny). */
export function preloadSprites(scene: Phaser.Scene): void {
  for (const [path, url] of Object.entries(UNIT_URLS)) {
    const [id, file] = path.split('/').slice(-2);
    scene.load.image(spriteTexKey(id, file.replace('.png', '') as SpriteDir), url);
  }
  for (const [path, url] of Object.entries(PORTRAIT_URLS)) scene.load.image(spritePortraitKey(path.split('/').pop()!.replace('.png', '')), url);
}

/** Id sprite'a postaci: rekrut (Character.recruitId albo RecruitDef.id), o ile ma komplet obrotów. */
export function spriteIdOf(src: { recruitId?: string; id?: string } | null | undefined): string | null {
  if (!src) return null;
  const id = src.recruitId ?? (src.id && RECRUITS.some((r) => r.id === src.id) ? src.id : undefined);
  return id && UNITS.has(id) ? id : null;
}

/** Czy postać ma wczytany sprite (obrazy są w menedżerze tekstur). */
export function hasSprite(scene: Phaser.Scene, id: string | null): id is string {
  return !!id && scene.textures.exists(spriteTexKey(id, 'south-east')) && scene.textures.exists(spriteTexKey(id, 'north-east'));
}

export function hasSpritePortrait(scene: Phaser.Scene, id: string | null): id is string {
  return !!id && PORTRAITS.has(id) && scene.textures.exists(spritePortraitKey(id));
}

/** Piksele wczytanego obrazu (RGBA). */
export function texturePixels(scene: Phaser.Scene, key: string): { w: number; h: number; data: Uint8ClampedArray } {
  const img = scene.textures.get(key).getSourceImage() as HTMLImageElement | HTMLCanvasElement;
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0);
  return { w: c.width, h: c.height, data: ctx.getImageData(0, 0, c.width, c.height).data };
}

interface Src {
  w: number;
  h: number;
  data: Uint8ClampedArray;
  /** Obrys postaci: górny i dolny wiersz, lewa i prawa kolumna z nieprzezroczystymi pikselami. */
  top: number;
  bottom: number;
  left: number;
  right: number;
}

function measure(p: { w: number; h: number; data: Uint8ClampedArray }): Src {
  let top = p.h, bottom = -1, left = p.w, right = -1;
  for (let y = 0; y < p.h; y++)
    for (let x = 0; x < p.w; x++)
      if (p.data[(y * p.w + x) * 4 + 3]) {
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
        left = Math.min(left, x);
        right = Math.max(right, x);
      }
  if (bottom < 0) return { ...p, top: 0, bottom: p.h - 1, left: 0, right: p.w - 1 };
  return { ...p, top, bottom, left, right };
}

/** Kąt obrotu (stopnie, + = głową do przodu) dla etapów śmierci: pada do tyłu. */
const DIE_ANGLE = [0, -8, -24, -48, -74, -90, -90];

/** Pikseli obrazu na jednostkę pozy (pozy z UnitArt.ANIMS są w pikselach projektowych). */
const PX = SPRITE_DENSITY;

/**
 * Kolumna rozdzielająca nogi w obrazie źródłowym: średnie x nieprzezroczystych pikseli w dolnej połowie nóg.
 * Lewa / prawa strona tej kolumny to dwie nogi (przód: bliższa po lewej, tył: bliższa po prawej).
 */
function legSplit(s: Src, hipRow: number): number {
  const y0 = Math.round(hipRow + (s.bottom - hipRow) * 0.4);
  let sum = 0, n = 0;
  for (let y = y0; y <= s.bottom; y++)
    for (let x = s.left; x <= s.right; x++)
      if (s.data[(y * s.w + x) * 4 + 3]) {
        sum += x;
        n++;
      }
  return n ? sum / n : (s.left + s.right + 1) / 2;
}

/**
 * Maluje jedną klatkę: obraz `s` przekształcony wg pozy, z tym samym ruchem co klatki malowane kodem (UnitArt):
 * nogi osobno (krok: przesunięcie stopy do przodu / tyłu i uniesienie - zgięcie w kolanie), tułów (oddech, pochylenie),
 * głowa z opóźnieniem (hbob), wypad / odrzut, przysiad, upadek i leżenie. `front` = obrót przodem (south-east).
 */
function poseFrame(s: Src, pose: Pose, front: boolean): PixelCanvas {
  const pc = new PixelCanvas(FW, FH);
  const height = s.bottom - s.top + 1;
  // obraz ustawiony stopami w (FOOT_X, FOOT_Y)
  const ox = FOOT_X - Math.round((s.left + s.right + 1) / 2);
  const oy = FOOT_Y - s.bottom;
  const hip = FOOT_Y - Math.round(height * 0.42);
  const legH = Math.max(1, FOOT_Y - hip);
  /** Dół głowy (wiersze nad nim = głowa, ruch hbob). */
  const neck = FOOT_Y - height + 1 + Math.round(height * 0.26);
  const split = legSplit(s, hip - oy) + ox;

  const lying = pose.die >= 0 ? DIE_ANGLE[pose.die] : pose.prone;
  const angle = (lying * Math.PI) / 180;
  const sin = Math.sin(angle), cos = Math.cos(angle);
  // przy leżeniu ciało przesuwa się tak, żeby środek leżał nad punktem stóp, a plecy na wysokości stóp
  // (obrócona sylwetka ma grubość ~ szerokości postaci, połowa poszłaby pod klatkę)
  const t = Math.abs(lying) / 90;
  const tx = -sin * height * 0.5;
  const ty = -t * Math.round((s.right - s.left + 1) * 0.38);

  // przysiad / klęk: ściśnięcie w pionie wokół stóp
  const squash = pose.kneel ? 0.8 : 1 - pose.crouch * 0.07;
  // wypad / odrzut całej postaci, pochylenie, oddech tułowia i głowa (piksele projektowe -> piksele obrazu)
  const shiftX = (pose.lunge + pose.dx) * PX;
  const lean = pose.lean * PX + (pose.kneel ? PX : 0);
  const bob = pose.bob * PX;
  const hbob = pose.hbob * PX;
  // nogi: [bliższa przesunięcie, uniesienie, dalsza przesunięcie, uniesienie] (UnitArt.WALK_LEGS); przy leżeniu bez kroku
  const legs = lying ? null : pose.legs.some((v) => v !== 0) ? pose.legs : null;
  // bliższa noga: przodem (patrzy w prawo-w dół) po lewej stronie obrazu, tyłem (w prawo-w górę) po prawej
  const legDefs = legs
    ? ([
        { left: front, shift: legs[0] * PX, lift: legs[1] * PX },
        { left: !front, shift: legs[2] * PX, lift: legs[3] * PX },
      ] as const)
    : null;

  /** Piksel źródła w punkcie klatki (px, py) lub -1. */
  const at = (px: number, py: number): number => {
    const sx = Math.round(px) - ox, sy = Math.round(py) - oy;
    if (sx < 0 || sy < 0 || sx >= s.w || sy >= s.h) return -1;
    const i = (sy * s.w + sx) * 4;
    return s.data[i + 3] ? i : -1;
  };

  for (let y = 0; y < FH; y++)
    for (let x = 0; x < FW; x++) {
      // odwrotne przekształcenia: obrót wokół stóp -> ściśnięcie -> tułów / głowa / nogi -> obraz źródłowy
      let px = x - tx - shiftX, py = y - ty;
      if (lying) {
        const rx = px - FOOT_X, ry = py - FOOT_Y;
        px = FOOT_X + rx * cos + ry * sin;
        py = FOOT_Y - rx * sin + ry * cos;
      }
      py = FOOT_Y - (FOOT_Y - py) / squash;
      let i = -1;
      if (py < hip) {
        // tułów opada / unosi się o `bob`, głowa dodatkowo o `hbob` (oddech z opóźnieniem)
        px -= lean;
        py -= bob;
        if (py < neck + hbob) py -= hbob;
        i = at(px, py);
      } else if (legDefs) {
        // każda noga osobno: góra uda zostaje w biodrze, stopa przesuwa się o `shift` i unosi o `lift`
        // (bliższa noga rysowana na dalszej)
        for (const l of legDefs) {
          const c = l.lift / legH;
          const sy = (py - c * hip) / (1 - c);
          if (sy < hip - 0.5) continue;
          const sx = px - (l.shift * (sy - hip)) / legH;
          const j = at(sx, sy);
          if (j >= 0 && Math.round(sx) < split === l.left) {
            i = j;
            break;
          }
        }
      } else i = at(px, py);
      if (i < 0) continue;
      const o = (y * FW + x) * 4;
      pc.data[o] = s.data[i];
      pc.data[o + 1] = s.data[i + 1];
      pc.data[o + 2] = s.data[i + 2];
      pc.data[o + 3] = s.data[i + 3];
    }

  // trafienie: czerwony błysk (pierwsze klatki 'hurt' i początek upadku)
  if (pose.hurt && (pose.anim === 'hurt' || pose.die <= 1)) tint(pc, 0xff4a3a, pose.anim === 'hurt' && pose.i === 0 ? 0.38 : 0.2);
  // zwłoki ciemnieją
  if (pose.die >= 5) tint(pc, 0x1a0e0c, 0.18);
  // kałuża krwi pod zwłokami
  if (pose.die >= 5) puddle(pc, pose.die === 6 ? 1 : 0.6);
  if (pose.flash) muzzle(pc, pose.flash, hip - Math.round(height * 0.12));
  if (pose.cast >= 3) glow(pc, FOOT_Y - height - 1, pose.cast);
  return pc;
}

function tint(pc: PixelCanvas, c: number, k: number): void {
  const r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255;
  for (let i = 0; i < pc.data.length; i += 4) {
    if (!pc.data[i + 3]) continue;
    pc.data[i] += (r - pc.data[i]) * k;
    pc.data[i + 1] += (g - pc.data[i + 1]) * k;
    pc.data[i + 2] += (b - pc.data[i + 2]) * k;
  }
}

/** Kałuża pod ciałem: elipsa z ditheringiem na krawędzi, rysowana pod istniejącymi pikselami. */
function puddle(pc: PixelCanvas, size: number): void {
  const rx = 20 * size, ry = 6 * size, cy = FOOT_Y + 3;
  for (let y = Math.floor(cy - ry); y <= cy + ry; y++)
    for (let x = Math.floor(FOOT_X - rx); x <= FOOT_X + rx; x++) {
      const d = ((x - FOOT_X) / rx) ** 2 + ((y - cy) / ry) ** 2;
      if (d > 1 || pc.alpha(x, y)) continue;
      if (d > 0.7 && (x + y) % 2) continue;
      pc.set(x, y, d < 0.35 ? 0x6a0f0c : 0x4a0a0a);
    }
}

/** Błysk wylotowy (1) albo dym (2) przed najdalej wysuniętym pikselem na wysokości broni. */
function muzzle(pc: PixelCanvas, kind: number, y0: number): void {
  let tip = -1, ty = y0;
  for (let y = y0 - 5; y <= y0 + 5; y++)
    for (let x = FW - 1; x > tip; x--)
      if (pc.alpha(x, y)) {
        tip = x;
        ty = y;
        break;
      }
  if (tip < 0) return;
  const x = tip + 2;
  if (kind === 1) {
    pc.rect(x, ty - 1, 3, 3, 0xffe27a);
    pc.set(x + 1, ty, 0xffffff);
    pc.set(x + 3, ty, 0xffb03a);
    pc.set(x + 4, ty, 0xffb03a);
    pc.set(x + 1, ty - 2, 0xffb03a);
    pc.set(x + 1, ty + 2, 0xffb03a);
  } else {
    for (const [dx, dy] of [[1, -1], [3, 0], [2, -3], [5, -2], [4, 1]] as const) pc.set(x + dx, ty + dy, 0x9a948a, 170);
  }
}

/** Blask zdolności nad głową. */
function glow(pc: PixelCanvas, y: number, cast: number): void {
  const r = cast === 4 ? 4 : 2;
  for (let a = 0; a < 8; a++) {
    const ang = (a / 8) * Math.PI * 2;
    pc.set(FOOT_X + Math.round(Math.cos(ang) * r * 1.6), y - 3 + Math.round(Math.sin(ang) * r), a % 2 ? 0x8fe8ff : 0xffffff);
  }
  pc.set(FOOT_X, y - 3, 0xffffff);
}

const FRAME_ALIASES: Record<string, string> = { attack: 'attack2', hurt: 'hurt0' };
const SHEET_COLS = 17;

/**
 * Arkusz klatek (te same nazwy co paintUnitSheet) z obrotów south-east (przód) i north-east (tył).
 * Płótno i ramki w pikselach obrazu; `density` mówi, ile pikseli obrazu przypada na piksel projektowy.
 */
export function paintSpriteSheet(scene: Phaser.Scene, id: string): UnitSheet & { density: number } {
  const names: string[] = ANIM_ORDER.flatMap((a) => ANIMS[a].poses.map((p) => `${a}${p.i}`));
  const poses = new Map<string, Pose>(ANIM_ORDER.flatMap((a) => ANIMS[a].poses.map((p) => [`${a}${p.i}`, p] as const)));
  const cols = Math.min(SHEET_COLS, names.length);
  const blocks = Math.ceil(names.length / cols);
  const pc = new PixelCanvas(FW * cols, FH * 2 * blocks);
  const frames: UnitSheet['frames'] = [];
  const at = (i: number, row: number) => ({ x: (i % cols) * FW, y: (Math.floor(i / cols) * 2 + row) * FH });
  (['f', 'b'] as const).forEach((facing, row) => {
    const src = measure(texturePixels(scene, spriteTexKey(id, facing === 'f' ? 'south-east' : 'north-east')));
    names.forEach((name, i) => {
      const fpc = poseFrame(src, poses.get(name)!, facing === 'f');
      const { x, y } = at(i, row);
      for (let yy = 0; yy < FH; yy++) pc.data.set(fpc.data.subarray(yy * FW * 4, (yy + 1) * FW * 4), ((y + yy) * pc.w + x) * 4);
      frames.push({ name: `${facing}_${name}`, x, y, w: FW, h: FH });
    });
    for (const [alias, srcName] of Object.entries(FRAME_ALIASES)) {
      const { x, y } = at(names.indexOf(srcName), row);
      frames.push({ name: `${facing}_${alias}`, x, y, w: FW, h: FH });
    }
  });
  return { pc, frames, density: SPRITE_DENSITY };
}

/**
 * Portret (popiersie 64x64) na ciemnym tle w paski z ditheringiem - obraz PixelLab ma przezroczyste tło,
 * a ramki kart (Widgets.portrait) zakładają pełny kwadrat.
 */
export function spritePortraitCanvas(scene: Phaser.Scene, id: string): HTMLCanvasElement {
  const p = texturePixels(scene, spritePortraitKey(id));
  const c = document.createElement('canvas');
  c.width = p.w;
  c.height = p.h;
  const ctx = c.getContext('2d')!;
  const bg = ctx.createImageData(p.w, p.h);
  const top = [0x3a, 0x2e, 0x26], bot = [0x16, 0x11, 0x0e];
  for (let y = 0; y < p.h; y++) {
    // 6 pasów jasności, granice pasów przeplatane szachownicą (dithering)
    const band = Math.min(5, Math.floor((y / p.h) * 6));
    for (let x = 0; x < p.w; x++) {
      const b = band + ((y / p.h) * 6 - band > 0.8 && (x + y) % 2 ? 1 : 0);
      const k = Math.min(5, b) / 5;
      const o = (y * p.w + x) * 4;
      for (let ch = 0; ch < 3; ch++) bg.data[o + ch] = top[ch] + (bot[ch] - top[ch]) * k;
      bg.data[o + 3] = 255;
      const a = p.data[o + 3] / 255;
      if (a) for (let ch = 0; ch < 3; ch++) bg.data[o + ch] = p.data[o + ch] * a + bg.data[o + ch] * (1 - a);
    }
  }
  ctx.putImageData(bg, 0, 0);
  return c;
}
