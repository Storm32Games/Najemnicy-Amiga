// Proceduralne sprite'y postaci (pixel art 24x32): gracz i wrogowie z jednego "szkieletu" z paletą.
// Kolory klas z Oldgame/src/gfx/look.js (CLASS_DEFAULTS), warianty ciała/broni/głów z Oldgame/src/gfx/hero.js.
// Kierunki: 'f' = przodem (SE), 'b' = tyłem (NE); SW / NW uzyskujemy przez flipX.
import { PixelCanvas, type RGB, hash2, mix, pick, ramp, shade } from './Pixel';

export const UNIT_FW = 24;
export const UNIT_FH = 32;
/** Piksel w klatce, który stoi na środku pola (stopy). */
export const UNIT_FOOT_X = 12;
export const UNIT_FOOT_Y = 28;

/** Rodzaj broni w dłoni (jak weaponKind w Oldgame/src/gfx/look.js; 'none' = bez broni / pięści). */
export type WeaponKind =
  | 'rifle' | 'longgun' | 'shotgun' | 'smg' | 'pistol' | 'laser' | 'flamer' | 'bow'
  | 'scythe' | 'machete' | 'knife' | 'sledge' | 'axe' | 'pipe' | 'none';
export const WEAPON_KINDS: readonly WeaponKind[] = [
  'rifle', 'longgun', 'shotgun', 'smg', 'pistol', 'laser', 'flamer', 'bow', 'scythe', 'machete', 'knife', 'sledge', 'axe', 'pipe', 'none',
];
/** Nakrycie głowy / twarz. 'bare' = włosy wg hairStyle, 'mask' = maska hokejowa, 'machine' = głowa robota. */
export type HeadKind = 'helmet' | 'mohawk' | 'hood' | 'bare' | 'gas' | 'cap' | 'goggles' | 'mask' | 'reaper' | 'machine';
export type BodyBuild = 'light' | 'medium' | 'heavy';

export interface UnitLook {
  skin: RGB;
  cloth: RGB;
  pants: RGB;
  boots: RGB;
  accent: RGB;
  hair: RGB;
  head: HeadKind;
  weapon: WeaponKind;
  pack: RGB;
  /** Budowa ciała (domyślnie medium). */
  body?: BodyBuild;
  /** Fryzura dla head 'bare' / 'mask' (0 krótkie, 1 długie, 2 kucyk, 3 łysy, 4 kolce). */
  hairStyle?: number;
  /** Chusta na dolnej części twarzy. */
  mask?: boolean;
  /** Mutacja: narośl na barku, świecące oko. */
  mutation?: boolean;
  /** Wszczepy: metalowe ramię, implant oka. */
  cyber?: boolean;
  /** Kolor tarczy na ramieniu (brak = bez tarczy). */
  shield?: RGB;
  /** Robot: kanciasty metalowy korpus, jedno czerwone oko. */
  robot?: boolean;
  /** Kolor płaszcza (brak = bez płaszcza). */
  cloak?: RGB;
  /** Kolor świecących oczu (mutacja / robot / implant). */
  eye?: RGB;
  /** Przygarbiony (ghule, mutanci). */
  hunch?: boolean;
  /** Gołe ramiona (kolor skóry) i rzemień zamiast ćwieków kurtki. */
  bareArms?: boolean;
}

export const LOOK_SOLDIER: UnitLook = {
  skin: 0xc68a62, cloth: 0x5d6a3a, pants: 0x4a4a3a, boots: 0x2a221c, accent: 0xc9a468, hair: 0x3a2414,
  head: 'helmet', weapon: 'rifle', pack: 0x4a5236,
};

export const LOOK_RAIDER: UnitLook = {
  skin: 0xa56b46, cloth: 0x6a3a2a, pants: 0x2e2a30, boots: 0x1c1612, accent: 0xb4b0a4, hair: 0xc8361e,
  head: 'mohawk', weapon: 'pipe', pack: 0x4a3424,
};

export interface Pose {
  bob: number;
  stride: number;
  attack: boolean;
  hurt: boolean;
}

export const POSES: Readonly<Record<string, Pose>> = {
  idle0: { bob: 0, stride: 0, attack: false, hurt: false },
  idle1: { bob: 1, stride: 0, attack: false, hurt: false },
  walk0: { bob: 0, stride: 1, attack: false, hurt: false },
  walk1: { bob: -1, stride: 0, attack: false, hurt: false },
  walk2: { bob: 0, stride: -1, attack: false, hurt: false },
  walk3: { bob: -1, stride: 0, attack: false, hurt: false },
  attack: { bob: 0, stride: 1, attack: true, hurt: false },
  hurt: { bob: 1, stride: 0, attack: false, hurt: true },
};
export const UNIT_FRAMES = Object.keys(POSES);

export interface UnitSheet {
  pc: PixelCanvas;
  frames: { name: string; x: number; y: number; w: number; h: number }[];
}

/**
 * Składa arkusz 'f_idle0' ... 'b_hurt' z klatek 24x32 rysowanych osobno (przycięte do klatki, obrys per klatka),
 * więc broń / płomień wystający poza klatkę nie przecieka do sąsiedniej.
 */
export function buildUnitSheet(draw: (pc: PixelCanvas, front: boolean, pose: Pose) => void): UnitSheet {
  const names: string[] = [];
  for (const facing of ['f', 'b'] as const) for (const p of UNIT_FRAMES) names.push(`${facing}_${p}`);
  const pc = new PixelCanvas(UNIT_FW * names.length, UNIT_FH);
  const frames = names.map((name, i) => {
    const [facing, pose] = name.split('_') as ['f' | 'b', string];
    const fpc = new PixelCanvas(UNIT_FW, UNIT_FH);
    draw(fpc, facing === 'f', POSES[pose]);
    fpc.outline(0.32, 0x0e080c);
    for (let y = 0; y < UNIT_FH; y++) pc.data.set(fpc.data.subarray(y * UNIT_FW * 4, (y + 1) * UNIT_FW * 4), (y * pc.w + i * UNIT_FW) * 4);
    return { name, x: i * UNIT_FW, y: 0, w: UNIT_FW, h: UNIT_FH };
  });
  return { pc, frames };
}

/** Prostokąt cieniowany jak bryła oświetlona z lewej-góry. */
function part(pc: PixelCanvas, x: number, y: number, w: number, h: number, r: readonly RGB[], base = 0.5, seed = 0): void {
  for (let yy = 0; yy < h; yy++)
    for (let xx = 0; xx < w; xx++) {
      let L = base + (hash2(x + xx, y + yy, seed) - 0.5) * 0.12;
      if (xx === 0 && w > 1) L += 0.22;
      if (xx === w - 1 && w > 1) L -= 0.24;
      if (yy === 0) L += 0.12;
      pc.set(x + xx, y + yy, pick(r, L, x + xx, y + yy));
    }
}

const INK = 0x1a1012;
const FLASH = [0xfff0a0, 0xffe070, 0xff9a2a] as const;

interface Ctx {
  pc: PixelCanvas;
  look: UnitLook;
  front: boolean;
  pose: Pose;
  /** x w klatce (z przesunięciem przy trafieniu). */
  X: (x: number) => number;
  /** x broni: współrzędne zapisane dla budowy medium, przesunięte do dłoni danej budowy. */
  W: (x: number) => number;
  ty: number;
  /** y przedniej dłoni w spoczynku. */
  fhY: number;
  P: Record<'skin' | 'cloth' | 'pants' | 'boots' | 'accent' | 'hair' | 'pack' | 'metal' | 'steel' | 'wood' | 'chrome' | 'rust' | 'bone' | 'mut' | 'cloak', RGB[]>;
}

// ------------------------------------------------------------------ broń

const GUN_LEN: Partial<Record<WeaponKind, number>> = { rifle: 9, smg: 6, longgun: 11, shotgun: 8, laser: 9, flamer: 8 };

function drawGun(c: Ctx, kind: WeaponKind, len: number): void {
  const { pc, W, ty, P, pose, front } = c;
  const body = kind === 'laser' ? P.chrome : kind === 'flamer' ? ramp(0x4a4038, 5, 0.4) : P.metal;
  const barrel = (x0: number, y0: number, x1: number, y1: number) => {
    pc.line(W(x0), y0, W(x1), y1, body[1]);
    pc.line(W(x0), y0 - 1, W(x1), y1 - 1, body[3]);
    if (kind === 'shotgun') pc.line(W(x0), y0 + 1, W(x1), y1 + 1, body[0]);
  };
  const stock = (x0: number, y0: number, x1: number, y1: number) => {
    const col = kind === 'smg' || kind === 'laser' ? P.metal[2] : kind === 'flamer' ? 0x2a2420 : P.wood[2];
    pc.line(W(kind === 'smg' ? x0 + 2 : x0), y0, W(x1), y1, col);
  };
  if (pose.attack) {
    const y = ty + 1, x1 = 10 + len + 1;
    barrel(10, y, x1, y);
    stock(7, y + 1, 11, y + 1);
    if (kind === 'shotgun') pc.line(W(13), y + 1, W(15), y + 1, P.wood[3]);
    if (kind === 'longgun') { pc.set(W(14), y - 2, P.metal[0]); pc.set(W(15), y - 2, P.accent[3]); }
    if (kind === 'laser') pc.line(W(13), y - 1, W(16), y - 1, P.accent[4]);
    const fx = W(x1 + 1);
    if (kind === 'laser') {
      for (let x = fx; x < UNIT_FW; x++) { pc.set(x, y - 1, 0xffffff); pc.set(x, y - 2, P.accent[4], 170); pc.set(x, y, P.accent[4], 170); }
    } else if (kind === 'flamer') {
      const fl = [0xfff6c0, 0xffd860, 0xff9a2a, 0xff6a1a, 0xc8361e, 0x8a2a1a];
      for (let i = 0; i < 7; i++) {
        const spread = Math.floor(i / 2);
        for (let s = -spread; s <= spread; s++) pc.set(fx + i, y - 1 + s, fl[Math.min(5, Math.abs(s) + Math.floor(i / 2))], i > 4 ? 200 : 255);
      }
    } else {
      pc.set(fx, y - 1, FLASH[0]); pc.set(fx, y, FLASH[1]); pc.set(fx + 1, y - 1, FLASH[2]); pc.set(fx, y - 2, FLASH[2]);
      if (kind === 'shotgun' || kind === 'rifle') { pc.set(fx + 1, y - 2, FLASH[1]); pc.set(fx + 2, y - 1, FLASH[2]); pc.set(fx + 1, y, FLASH[2]); }
    }
  } else if (front) {
    const x1 = 12 + len - 1, y1 = ty + 3 + Math.round((len - 1) * 0.37);
    barrel(12, ty + 3, x1, y1);
    stock(8, ty + 1, 12, ty + 3);
    if (kind === 'shotgun') pc.set(W(15), ty + 4, P.wood[3]);
    if (kind === 'laser') pc.set(W(14), ty + 2, P.accent[4]);
    if (kind === 'flamer') pc.set(W(x1 + 1), y1, 0x5ab0ff);
    if (kind === 'longgun') pc.set(W(14), ty + 1, P.metal[0]);
  } else {
    const r = Math.round(len * 0.6);
    barrel(14, ty + 3, 14 + r, ty + 3 - r);
    if (kind === 'laser') pc.set(W(15 + (r >> 1)), ty + 2 - (r >> 1), P.accent[4]);
  }
}

function drawWeapon(c: Ctx): void {
  const { pc, look, W, ty, fhY, P, pose, front } = c;
  const kind = look.weapon;
  const len = GUN_LEN[kind];
  if (len) { drawGun(c, kind, len); return; }
  const set = (x: number, y: number, col: RGB, a = 255) => pc.set(W(x), y, col, a);
  const line = (x0: number, y0: number, x1: number, y1: number, col: RGB) => pc.line(W(x0), y0, W(x1), y1, col);
  const atk = pose.attack;
  const hy = atk ? ty : fhY; // y dłoni
  switch (kind) {
    case 'pistol':
      if (atk) {
        set(20, ty - 1, P.metal[3]); set(21, ty - 1, P.metal[3]); set(20, ty, P.metal[1]); set(21, ty, P.metal[0]);
        set(22, ty - 1, FLASH[0]); set(23, ty - 1, FLASH[2]); set(22, ty - 2, FLASH[2]); set(22, ty, FLASH[1]);
      } else if (front) {
        set(17, hy, P.metal[3]); set(18, hy, P.metal[2]); set(17, hy + 1, P.metal[0]);
      } else {
        set(15, ty + 6, P.metal[1]); set(15, ty + 7, P.wood[1]);
      }
      return;
    case 'knife':
      if (atk) { line(20, ty, 22, ty, P.steel[3]); set(23, ty, P.steel[4]); set(20, ty + 1, P.steel[1]); }
      else { set(17, hy, P.wood[1]); line(17, hy - 1, 18, hy - 3, P.steel[3]); set(18, hy - 1, P.steel[1]); }
      return;
    case 'machete':
      if (atk) {
        line(20, ty, 23, ty - 4, P.steel[3]); line(20, ty + 1, 23, ty - 3, P.steel[1]);
        set(23, ty - 1, 0xffffff, 110); set(22, ty + 2, 0xffffff, 90);
      } else { set(17, hy, P.wood[1]); line(17, hy - 1, 19, hy - 6, P.steel[3]); line(18, hy - 1, 20, hy - 5, P.steel[1]); }
      return;
    case 'pipe': {
      const rust = P.rust;
      if (atk) { line(15, ty + 2, 20, ty - 6, rust[1]); line(16, ty + 2, 21, ty - 6, rust[3]); set(21, ty - 5, P.steel[4]); set(20, ty - 3, P.steel[4]); }
      else { line(17, hy + 1, 19, hy - 8, rust[1]); line(18, hy + 1, 20, hy - 8, rust[3]); set(20, hy - 6, P.steel[4]); set(19, hy - 4, P.steel[4]); }
      return;
    }
    case 'axe':
      if (atk) {
        line(15, ty + 2, 20, ty - 6, P.wood[1]); line(16, ty + 2, 21, ty - 6, P.wood[3]);
        pc.rect(W(20), ty - 9, 2, 3, P.steel[2]); line(22, ty - 10, 22, ty - 6, P.steel[4]); set(19, ty - 8, P.metal[1]);
      } else {
        line(17, hy + 1, 19, hy - 7, P.wood[1]); line(18, hy + 1, 20, hy - 7, P.wood[3]);
        pc.rect(W(20), hy - 9, 2, 3, P.steel[2]); line(22, hy - 10, 22, hy - 6, P.steel[4]); set(19, hy - 8, P.metal[1]);
      }
      return;
    case 'sledge': {
      const head = (x: number, y: number) => { part(pc, W(x), y, 4, 3, P.metal, 0.5); line(x, y, x + 3, y, P.metal[4]); };
      if (atk) { line(15, ty + 2, 19, ty - 7, P.wood[1]); line(16, ty + 2, 20, ty - 7, P.wood[3]); head(18, ty - 10); }
      else { line(17, hy + 2, 19, hy - 8, P.wood[1]); line(18, hy + 2, 20, hy - 8, P.wood[3]); head(18, hy - 11); }
      return;
    }
    case 'scythe': {
      if (atk) {
        line(9, ty + 9, 19, ty - 7, P.wood[1]); line(10, ty + 9, 20, ty - 7, P.wood[2]);
        line(20, ty - 8, 22, ty - 6, P.steel[3]); line(22, ty - 6, 23, ty - 2, P.steel[3]); line(23, ty - 2, 22, ty + 2, P.steel[4]);
        line(20, ty - 7, 22, ty - 4, P.steel[1]); line(22, ty - 4, 22, ty - 1, P.steel[1]);
        for (let i = 0; i < 4; i++) set(21 - i, ty + 4 + i, 0xffffff, 70);
      } else {
        line(17, hy + 3, 17, 2, P.wood[1]); line(18, hy + 3, 18, 2, P.wood[3]);
        line(17, 1, 13, 1, P.steel[4]); line(13, 1, 10, 2, P.steel[3]); line(10, 2, 8, 5, P.steel[3]);
        line(16, 2, 13, 2, P.steel[1]); line(12, 3, 10, 4, P.steel[1]);
        set(18, 1, P.metal[2]);
      }
      return;
    }
    case 'bow': {
      const string = 0xd8d0b8;
      if (atk) {
        set(20, ty - 5, P.wood[2]); line(21, ty - 4, 21, ty + 4, P.wood[3]); set(20, ty + 5, P.wood[2]);
        line(20, ty - 5, 16, ty, string); line(16, ty, 20, ty + 5, string);
        line(16, ty, 22, ty, P.wood[1]); set(23, ty, P.steel[4]); set(16, ty - 1, P.accent[3]);
      } else if (front) {
        line(17, hy - 8, 17, hy + 2, string);
        set(17, hy - 8, P.wood[2]); set(18, hy - 7, P.wood[3]); line(19, hy - 6, 19, hy, P.wood[3]); set(18, hy + 1, P.wood[2]); set(17, hy + 2, P.wood[2]);
      } else {
        // łuk przewieszony przez plecy (bez przesunięcia do dłoni)
        pc.line(c.X(8), ty - 2, c.X(15), ty + 6, P.wood[3]);
        pc.line(c.X(9), ty - 2, c.X(15), ty + 5, string);
      }
      return;
    }
    default:
      return;
  }
}

// ------------------------------------------------------------------ głowa

function drawHair(c: Ctx, style: number, hx: number, hy: number): void {
  const { pc, front, P } = c;
  const set = (x: number, y: number, L: number) => pc.set(c.X(x + hx), y, pick(P.hair, L, c.X(x + hx), y));
  if (style === 3) { if (!front) for (let x = 10; x < 14; x++) pc.set(c.X(x + hx), hy, P.skin[3]); return; }
  if (front) {
    for (let x = 10; x <= 13; x++) set(x, hy - 1, 0.62 - (x - 10) * 0.06);
    for (let x = 9; x <= 14; x++) set(x, hy, 0.5 - (x - 9) * 0.05);
    set(9, hy + 1, 0.4); set(9, hy + 2, 0.34);
    if (style === 1) { for (let y = hy; y <= hy + 6; y++) { set(8, y, 0.3); set(9, y, 0.42); } set(10, hy + 1, 0.4); }
    if (style === 2) { set(8, hy + 1, 0.4); set(7, hy + 2, 0.36); set(7, hy + 3, 0.3); set(7, hy + 4, 0.26); }
    if (style === 4) { set(10, hy - 2, 0.7); set(12, hy - 2, 0.6); set(14, hy - 1, 0.5); set(9, hy - 1, 0.6); }
  } else {
    for (let y = -1; y < 5; y++) for (let x = 0; x < 6; x++) if ((x > 0 && x < 5) || (y >= 0 && y < 3)) set(9 + x, hy + y, 0.48 - x * 0.04);
    if (style === 1) for (let y = hy + 5; y <= hy + 7; y++) for (let x = 9; x <= 14; x++) set(x, y, 0.4 - (x - 9) * 0.04);
    if (style === 2) { set(11, hy + 5, 0.4); set(12, hy + 6, 0.34); set(12, hy + 7, 0.3); }
    if (style === 4) { set(10, hy - 2, 0.7); set(12, hy - 2, 0.6); set(14, hy - 1, 0.5); }
  }
}

function drawHead(c: Ctx, hx: number, hy: number): void {
  const { pc, look, front, pose, P } = c;
  const X = (x: number) => c.X(x + hx);
  const set = (x: number, y: number, col: RGB, a = 255) => pc.set(X(x), y, col, a);
  const eyeGlow = look.eye ?? (look.mutation ? 0xb8ff4a : 0xff3a2a);

  if (look.head === 'machine') {
    const box = P.chrome;
    part(pc, X(8), hy - 1, 8, 7, box, 0.55, 13);
    for (let x = 8; x < 16; x++) set(x, hy - 1, box[4]);
    set(9, hy - 3, P.metal[1]); set(9, hy - 2, P.metal[2]); set(9, hy - 4, look.accent);
    if (front) {
      for (let x = 10; x < 16; x++) set(x, hy + 2, 0x141010);
      set(13, hy + 2, eyeGlow); set(14, hy + 2, shade(eyeGlow, 0.6)); set(12, hy + 2, shade(eyeGlow, 0.35));
      set(11, hy + 4, INK); set(13, hy + 4, INK); set(15, hy + 4, INK);
    } else {
      for (const y of [hy + 1, hy + 3]) for (let x = 10; x < 14; x++) set(x, y, box[0]);
    }
    return;
  }

  // szyja + twarz
  set(11, hy + 6, P.skin[1]);
  set(12, hy + 6, P.skin[1]);
  part(pc, X(9), hy, 6, 6, P.skin, 0.55, 11);
  if (front) {
    set(12, hy + 3, INK);
    set(14, hy + 3, INK);
    if (pose.hurt) set(13, hy + 5, 0x9a1a14);
  } else set(9, hy + 3, P.skin[2]); // ucho

  const style = (look.hairStyle ?? 0) % 5;
  switch (look.head) {
    case 'helmet': {
      if (!front) drawHair(c, 0, hx, hy);
      const helm = ramp(look.cloth, 5, 0.44);
      const rows: [number, number][] = [[10, 13], [9, 14], [8, 15], [8, 15]];
      rows.forEach(([a, b], i) => { for (let x = a; x <= b; x++) set(x, hy - 3 + i, pick(helm, 0.65 - ((x - a) / (b - a)) * 0.4 + (i === 0 ? 0.15 : 0), X(x), hy - 3 + i)); });
      for (let x = 7; x <= 16; x++) set(x, hy + 1, pick(helm, x < 10 ? 0.45 : 0.25, X(x), hy + 1));
      if (front) { set(13, hy + 2, INK); set(14, hy + 2, P.accent[3]); }
      break;
    }
    case 'mohawk': {
      if (!front) for (let y = 0; y < 5; y++) for (let x = 0; x < 6; x++) if (x > 0 || y < 3) set(9 + x, hy + y, pick(P.skin, 0.4 - x * 0.04, X(9 + x), hy + y));
      for (let y = -4; y < 1; y++) for (const x of [11, 12]) set(x, hy + y, pick(P.hair, x === 11 ? 0.7 : 0.4, X(x), hy + y));
      set(11, hy - 5, P.hair[4]);
      if (front && !look.mask) { pc.line(X(10), hy + 2, X(15), hy + 2, 0x2a2420); set(12, hy + 2, P.accent[4]); set(14, hy + 2, P.accent[4]); }
      break;
    }
    case 'hood': {
      const hood = ramp(shade(look.cloth, 0.85), 5, 0.42);
      for (let y = hy - 2; y <= hy + 6; y++)
        for (let x = 8; x <= 15; x++) {
          const top = y === hy - 2 ? x >= 10 && x <= 13 : y === hy - 1 ? x >= 9 && x <= 14 : y === hy ? x <= 15 : false;
          const side = front ? x <= 10 && y <= hy + 5 && y > hy : (x >= 9 && x <= 14 && y <= hy + 4) || ((x === 8 || x === 15) && y >= hy && y <= hy + 3);
          if (top || side) set(x, y, pick(hood, 0.62 - (x - 8) * 0.05 - (y - hy) * 0.02, X(x), y));
        }
      if (front) set(15, hy + 1, hood[1]);
      else for (let x = 9; x <= 14; x++) set(x, hy + 5, hood[1]);
      break;
    }
    case 'bare':
      drawHair(c, style, hx, hy);
      break;
    case 'mask': {
      drawHair(c, style === 2 ? 4 : style, hx, hy);
      if (front) {
        const plate = ramp(0xd8d2c0, 5, 0.3);
        for (let y = hy + 1; y <= hy + 5; y++) for (let x = 10; x <= 14; x++) if (!(y === hy + 5 && (x === 10 || x === 14))) set(x, y, pick(plate, 0.6 - (x - 10) * 0.06, X(x), y));
        set(12, hy + 2, INK); set(14, hy + 2, INK); set(12, hy + 3, 0x3a2a2a);
        set(11, hy + 4, 0x5a4a44); set(13, hy + 4, 0x5a4a44);
        set(13, hy + 1, P.accent[3]); set(13, hy + 3, P.accent[2]);
      } else for (let x = 9; x <= 14; x++) set(x, hy + 2, 0x2a2420);
      break;
    }
    case 'gas': {
      drawHair(c, 0, hx, hy);
      if (front) {
        const rub = ramp(0x3e3c34, 5, 0.34);
        for (let y = hy + 1; y <= hy + 5; y++) for (let x = 10; x <= 14; x++) set(x, y, pick(rub, 0.55 - (x - 10) * 0.05, X(x), y));
        set(12, hy + 2, 0x9ad0b0); set(14, hy + 2, 0x9ad0b0); set(12, hy + 3, 0x4a7a6a); set(14, hy + 3, 0x4a7a6a);
        set(14, hy + 5, P.metal[3]); set(15, hy + 5, P.metal[2]); set(15, hy + 4, P.metal[1]);
        set(9, hy + 2, 0x2a2420);
      } else { for (let x = 9; x <= 14; x++) set(x, hy + 2, 0x2a2420); set(11, hy + 2, P.metal[3]); }
      break;
    }
    case 'cap': {
      if (!front) drawHair(c, 0, hx, hy);
      const lea = ramp(0x3e2c20, 5, 0.42);
      for (let x = 10; x <= 13; x++) set(x, hy - 3, pick(lea, 0.6 - (x - 10) * 0.07, X(x), hy - 3));
      for (let x = 9; x <= 14; x++) set(x, hy - 2, pick(lea, 0.55 - (x - 9) * 0.06, X(x), hy - 2));
      for (let x = 9; x <= 14; x++) set(x, hy - 1, P.accent[2]);
      for (let x = 7; x <= 16; x++) set(x, hy, pick(lea, x < 10 ? 0.5 : 0.28, X(x), hy));
      if (front) { set(12, hy + 1, shade(look.skin, 0.6)); set(13, hy + 1, shade(look.skin, 0.6)); set(14, hy + 1, shade(look.skin, 0.6)); }
      break;
    }
    case 'goggles': {
      drawHair(c, style === 1 ? 1 : 0, hx, hy);
      for (let x = 9; x <= 14; x++) set(x, hy + 1, 0x2a2420);
      if (front) { set(11, hy + 1, 0xe0a030); set(12, hy + 1, 0xffd070); set(13, hy + 1, 0xe0a030); set(14, hy + 1, 0xffd070); set(15, hy + 1, 0x2a2420); }
      else set(11, hy + 1, P.metal[3]);
      break;
    }
    case 'reaper': {
      const white = ramp(look.hair, 5, 0.5);
      const hw = (x: number, y: number, L: number) => set(x, y, pick(white, L, X(x), y));
      if (front) {
        for (let x = 9; x <= 14; x++) hw(x, hy - 1, 0.7 - (x - 9) * 0.05);
        for (let x = 8; x <= 13; x++) hw(x, hy, 0.6 - (x - 8) * 0.05);
        for (let y = hy; y <= c.ty + 5; y++) { hw(7, y, 0.35); hw(8, y, 0.5); if (y <= hy + 4) hw(9, y, 0.55); }
        set(12, hy + 2, INK); set(12, hy + 3, INK); set(14, hy + 2, INK); set(14, hy + 3, P.accent[4]);
        for (let x = 11; x <= 14; x++) set(x, hy + 5, x % 2 ? 0xe8e0cc : 0x3a2a2a);
      } else {
        for (let y = hy - 1; y <= c.ty + 4; y++) {
          const a = y < hy ? 10 : y <= hy + 5 ? 9 : 10 + ((y - hy) & 1), e = y < hy ? 13 : y <= hy + 5 ? 14 : 13 - (y > c.ty + 2 ? 1 : 0);
          for (let x = a; x <= e; x++) hw(x, y, 0.66 - (x - 9) * 0.09 - Math.max(0, y - hy - 4) * 0.05 + ((x + y) % 3 === 0 ? -0.12 : 0));
        }
      }
      break;
    }
  }

  // chusta na twarzy
  if (look.mask && front && (look.head === 'hood' || look.head === 'mohawk' || look.head === 'bare' || look.head === 'helmet' || look.head === 'goggles' || look.head === 'cap')) {
    const sc = ramp(mix(look.cloth, look.accent, 0.45), 5, 0.36);
    for (let y = hy + 4; y <= hy + 6; y++) for (let x = 10; x <= 15; x++) if (!(y === hy + 6 && x > 13)) set(x, y, pick(sc, 0.58 - (x - 10) * 0.05, X(x), y));
  }
  // mutacja: narośl na czaszce, świecące oko
  if (look.mutation) {
    set(front ? 10 : 13, hy - 1, P.mut[3]); set(front ? 11 : 12, hy - 1, P.mut[2]); set(front ? 10 : 13, hy, P.mut[1]);
    if (front && look.head !== 'gas' && look.head !== 'mask') { set(14, hy + 3, eyeGlow); set(15, hy + 3, eyeGlow, 110); set(14, hy + 2, eyeGlow, 90); set(10, hy + 4, P.mut[4]); }
  }
  // wszczepy: implant oka i płytka na skroni
  if (look.cyber) {
    if (front) {
      set(9, hy + 1, P.chrome[3]); set(10, hy + 1, P.chrome[2]); set(9, hy + 2, P.chrome[1]); set(10, hy + 2, P.chrome[4]);
      if (look.head !== 'gas' && look.head !== 'mask') { set(14, hy + 3, look.eye ?? 0xff3a2a); set(14, hy + 2, P.chrome[3]); set(15, hy + 2, P.chrome[2]); set(15, hy + 3, P.chrome[1]); }
    } else { set(10, hy + 1, P.chrome[3]); set(11, hy + 1, P.chrome[2]); set(10, hy + 2, P.chrome[1]); set(12, hy + 3, 0x2a2a30); }
  }
}

// ------------------------------------------------------------------ postać

function drawUnit(pc: PixelCanvas, look: UnitLook, front: boolean, pose: Pose): void {
  const body = look.body ?? 'medium';
  const robot = !!look.robot;
  const P: Ctx['P'] = {
    skin: ramp(look.skin, 5, 0.34),
    cloth: robot ? ramp(mix(look.cloth, 0x9aa4ac, 0.35), 5, 0.5) : ramp(look.cloth, 5, 0.42),
    pants: robot ? ramp(shade(mix(look.cloth, 0x9aa4ac, 0.25), 0.7), 5, 0.45) : ramp(look.pants, 5, 0.36),
    boots: ramp(look.boots, 4, 0.3),
    accent: ramp(look.accent, 5, 0.4),
    hair: ramp(look.hair, 5, 0.4),
    pack: ramp(look.pack, 5, 0.38),
    metal: ramp(0x3a3f44, 5, 0.4),
    steel: ramp(0xa4acb2, 5, 0.36),
    wood: ramp(0x6a4a2a, 5, 0.4),
    chrome: ramp(robot ? mix(look.cloth, 0x9aa4ac, 0.5) : 0x8a949c, 5, 0.46),
    rust: ramp(0x6a625a, 5, 0.4),
    bone: ramp(0xd8ccb0, 5, 0.3),
    mut: ramp(mix(look.skin, 0x6a9a3a, 0.55), 5, 0.44),
    cloak: ramp(look.cloak ?? 0x1a1416, 5, 0.4),
  };
  const hxo = pose.hurt ? -1 : 0;
  const b = pose.bob;
  const X = (x: number) => x + hxo;
  const tx = body === 'light' ? 9 : body === 'heavy' ? 7 : 8;
  const tw = body === 'light' ? 6 : body === 'heavy' ? 10 : 8;
  const aw = body === 'heavy' ? 2 : 1;
  const ty = (body === 'heavy' ? 13 : 14) + b;
  const legTop = 21 + b;
  const dxW = tx + tw + aw - 1 - 16;
  const W = (x: number) => X(x + dxW);
  const swing = pose.stride;
  const fhY = ty + 6 + Math.max(0, -swing);
  const c: Ctx = { pc, look, front, pose, X, W, ty, fhY, P };
  const metalLimb = robot;

  // płaszcz za postacią (widok z przodu)
  if (look.cloak && front) {
    for (let y = ty; y <= 26; y++) {
      const w = 2 + Math.floor((y - ty) / 5);
      for (let i = 0; i < w; i++) {
        if (y > 24 && hash2(i, y, 5) < 0.4) continue;
        pc.set(X(tx - 1 - i), y, pick(P.cloak, 0.5 - i * 0.12, X(tx - 1 - i), y));
        if (i < w - 1) pc.set(X(tx + tw + i), y, pick(P.cloak, 0.3 - i * 0.1, X(tx + tw + i), y));
      }
    }
  }
  // zbiornik miotacza wystający zza barku
  if (look.weapon === 'flamer' && front) part(pc, X(tx - 2), ty - 2, 2, 5, ramp(0x8a2a1a, 5, 0.4), 0.5);

  // nogi + buty (krok: jedna noga wysunięta i uniesiona)
  const legs: [number, number][] = body === 'light' ? [[10, -pose.stride], [12, pose.stride]] : body === 'heavy' ? [[8, -pose.stride], [13, pose.stride]] : [[9, -pose.stride], [13, pose.stride]];
  const lw = body === 'heavy' ? 3 : 2;
  for (const [lx, s] of legs) {
    const lift = s > 0 ? 1 : 0;
    part(pc, X(lx + s), legTop, lw, 26 - legTop - lift, P.pants, 0.45);
    part(pc, X(lx + s - (front ? 0 : 1)), 26 - lift, lw + 1, 2, robot ? P.metal : P.boots, 0.5);
    if (front) pc.set(X(lx + s + lw), 27 - lift, robot ? P.metal[1] : P.boots[1]);
    if (robot) pc.set(X(lx + s), legTop + 2, P.chrome[4]);
  }

  // tułów
  part(pc, X(tx), ty, tw, legTop - ty, P.cloth, 0.52, 3);
  const beltY = legTop - 1;
  if (!robot) {
    for (let x = tx; x < tx + tw; x++) pc.set(X(x), beltY, pick(ramp(0x2a2018, 4, 0.3), x === tx ? 0.7 : 0.4, x, beltY));
    if (front) pc.set(X(tx + 3), beltY, P.accent[3]);
  }
  if (robot) {
    // pancerna płyta, rdzeń, nity
    if (front) {
      part(pc, X(tx + 1), ty + 1, tw - 2, 3, ramp(shade(look.cloth, 0.85), 5, 0.4), 0.45, 5);
      const cx = tx + (tw >> 1);
      pc.set(X(cx - 1), ty + 2, look.accent); pc.set(X(cx), ty + 2, 0xffffff); pc.set(X(cx), ty + 3, look.accent);
      for (const x of [tx + 1, tx + tw - 2]) { pc.set(X(x), ty + 1, P.chrome[4]); pc.set(X(x), ty + 5, P.chrome[4]); }
    } else for (let y = ty + 1; y < ty + 5; y += 2) for (let x = tx + 2; x < tx + tw - 2; x++) pc.set(X(x), y, P.cloth[0]);
    for (let x = tx; x < tx + tw; x++) pc.set(X(x), beltY, P.metal[1]);
  } else if (look.head === 'helmet') {
    part(pc, X(tx + 1), ty + 1, tw - 2, 4, ramp(0x4a5232, 5, 0.38), 0.5, 5);
    if (front) { pc.set(X(tx + 2), ty + 2, P.accent[2]); pc.set(X(tx + tw - 3), ty + 2, P.accent[2]); }
  } else if (look.cloak) {
    // szarfa przez pierś
    if (front) pc.line(X(tx), ty + 1, X(tx + tw - 1), ty + 5, P.accent[2]);
  } else if (look.bareArms) {
    // rzemień przez pierś
    pc.line(X(tx), ty, X(tx + tw - 1), ty + 5, 0x3a2a1e);
    pc.line(X(tx + 1), ty, X(tx + tw - 1), ty + 4, 0x5a4230);
  } else {
    // kurtka: ćwieki i naramiennik
    for (let i = 0; i < 3; i++) pc.set(X(tx + 2 + i * 2), ty + 2, P.accent[3]);
    part(pc, X(front ? tx + tw - 2 : tx - 1), ty - 1, 3, 2, P.accent, 0.5);
    pc.set(X(front ? tx + tw - 1 : tx), ty - 2, P.accent[4]);
  }
  // mutacja: narośl na barku
  if (look.mutation) {
    const gx = X(tx + (front ? 0 : tw - 2));
    pc.ellipse(gx + 1, ty + 0.5, 2.2, 1.8, (x, y) => pick(P.mut, 0.6 - (x - gx) * 0.08 - (y - ty) * 0.1, x, y));
    pc.set(gx + 1, ty - 1, look.eye ?? 0xb8ff4a);
    pc.set(X(tx + (front ? tw - 2 : 1)), ty + 4, P.mut[4]);
  }

  if (!front) {
    if (look.cloak) {
      // płaszcz zakrywa plecy
      for (let y = ty - 1; y <= 25 + (b > 0 ? 0 : 0); y++) {
        const ext = Math.floor((y - ty) / 5);
        for (let x = tx - 1 - ext; x <= tx + tw + ext; x++) {
          if (y >= 24 && hash2(x, y, 7) < 0.35) continue;
          const fold = (x - tx) % 3 === 0 ? -0.12 : 0;
          pc.set(X(x), y, pick(P.cloak, 0.55 - (x - tx + 1) * 0.035 + fold, X(x), y));
        }
      }
    } else if (look.weapon === 'flamer') {
      const tank = ramp(0x8a2a1a, 5, 0.4);
      part(pc, X(tx + 1), ty - 1, 2, 6, tank, 0.55, 7);
      part(pc, X(tx + tw - 3), ty - 1, 2, 6, tank, 0.45, 8);
      pc.set(X(tx + 3), ty + 2, P.metal[3]);
    } else if (!robot) {
      part(pc, X(tx + 1), ty, tw - 2, 5, P.pack, 0.5, 7);
      pc.set(X(tx + 2), ty + 1, P.accent[2]);
    }
    if (look.shield !== undefined) drawShield(c, X(tx + 1), ty, tw - 2, 6);
  }

  // broń (przed ramionami, żeby dłoń zakrywała chwyt)
  drawWeapon(c);

  // ramiona (wahadło przy chodzie); metalowe przy robocie, lewe metalowe przy wszczepach
  const bare = look.bareArms ? P.skin : P.cloth;
  const backArm = metalLimb || look.cyber ? P.chrome : bare;
  const frontArm = metalLimb ? P.chrome : bare;
  const hand = (arm: readonly RGB[]) => (arm === P.chrome ? P.metal[2] : P.skin[2]);
  part(pc, X(tx - aw), ty + 1 + Math.max(0, swing), aw, 5, backArm, 0.62);
  pc.rect(X(tx - aw), ty + 6 + Math.max(0, swing), aw, 1, hand(backArm));
  if (look.cyber && !robot) pc.set(X(tx - 1), ty + 3 + Math.max(0, swing), look.eye ?? 0xff3a2a);
  if (pose.attack) {
    const len = 3 + (aw - 1);
    part(pc, X(tx + tw), ty, len, aw, frontArm, 0.4);
    if (look.weapon === 'none') {
      part(pc, X(tx + tw + len), ty - 1, 2, 2 + (aw - 1), robot ? P.metal : P.skin, 0.55);
      pc.set(X(tx + tw + len + 2), ty - 2, 0xffffff, 120);
      pc.set(X(tx + tw + len + 2), ty + 1, 0xffffff, 120);
    } else pc.rect(X(tx + tw + len), ty, 1, aw, hand(frontArm));
  } else {
    part(pc, X(tx + tw), ty + 1 + Math.max(0, -swing), aw, 5, frontArm, 0.3);
    pc.rect(X(tx + tw), ty + 6 + Math.max(0, -swing), aw, 1, hand(frontArm));
  }
  if (front && look.shield !== undefined) drawShield(c, X(tx - aw - 2), ty + 1 + Math.max(0, swing), 3, 6);

  // głowa
  const hunch = look.hunch ? 1 : 0;
  const hy = 8 + b + (pose.hurt ? 1 : 0) + hunch + (body === 'heavy' ? 0 : 0);
  drawHead(c, hunch, hy);
}

function drawShield(c: Ctx, x: number, y: number, w: number, h: number): void {
  const r = ramp(c.look.shield ?? 0x6a5a4a, 5, 0.4);
  part(c.pc, x, y, w, h, r, 0.5, 9);
  for (let i = 0; i < w; i++) { c.pc.set(x + i, y, c.P.metal[3]); c.pc.set(x + i, y + h - 1, c.P.metal[1]); }
  c.pc.set(x + (w >> 1), y + (h >> 1), c.P.accent[3]);
  c.pc.set(x + (w >> 1), y + (h >> 1) - 1, c.P.accent[2]);
}

/** Arkusz klatek: 'f_idle0' ... 'b_hurt'. */
export function paintUnitSheet(look: UnitLook): UnitSheet {
  return buildUnitSheet((pc, front, pose) => drawUnit(pc, look, front, pose));
}
