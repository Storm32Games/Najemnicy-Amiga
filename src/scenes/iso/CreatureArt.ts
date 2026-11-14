// Proceduralne sprite'y wrogów nie-humanoidalnych (24x32, te same nazwy klatek co paintUnitSheet).
// Kształty z EnemyDef.look.shape (Oldgame/src/gfx/creature.js w uproszczeniu do skali izometrycznej):
//   quad = czworonóg (szczur, pies), swarm = rój, big = wielka bestia, drone = latający dron, turret = wieżyczka.
// Gatunki (jak speciesBody w creature.js) wybierane po templateId: skorpion, kretowij, wilk, dzik, pająk, chrząszcz.
// Klatki 'b_*' patrzą w prawo-od-kamery (NE), 'f_*' w prawo-do-kamery (SE); lewe kierunki = flipX.
import type { EnemyShape } from '../../core/data/types';
import { type PixelCanvas, type RGB, hash2, mix, pick, ramp } from './Pixel';
import { type Pose, type UnitSheet, buildUnitSheet } from './UnitArt';

export type CreatureSpecies = 'scorpion' | 'mole' | 'wolf' | 'boar' | 'spider' | 'beetle' | 'rat' | 'dog';

type Painter = (pc: PixelCanvas, skin: readonly RGB[], accent: readonly RGB[], front: boolean, p: Pose, big: boolean) => void;

const GY = 27; // linia stóp
const INK = 0x1a1012;
const BONE = ramp(0xe8dcc0, 5, 0.3);

/** Bryła cieniowana od lewej-góry. */
function blob(pc: PixelCanvas, cx: number, cy: number, rx: number, ry: number, r: readonly RGB[], seed = 0, base = 0.55): void {
  pc.ellipse(cx, cy, rx, ry, (x, y) => {
    const L = base - ((x - cx) / (rx + 0.01)) * 0.22 - ((y - cy) / (ry + 0.01)) * 0.26 + (hash2(x, y, seed) - 0.5) * 0.14;
    return pick(r, L, x, y);
  });
}

/** Odnóże z kolanem: biodro -> kolano -> stopa. */
function leg(pc: PixelCanvas, x0: number, y0: number, kx: number, ky: number, x1: number, y1: number, c: RGB): void {
  pc.line(x0, y0, kx, ky, c);
  pc.line(kx, ky, x1, y1, c);
}

// ------------------------------------------------------------------ czworonogi

const quad: Painter = (pc, skin, accent, front, p, big) => {
  const s = big ? 1.45 : 1;
  const len = Math.round(7 * s), hgt = Math.round(3.4 * s);
  const cx = 12 + (p.attack ? 2 : 0) - (p.hurt ? 1 : 0), cy = GY - Math.round(5 * s) + p.bob;
  // nogi
  for (const [dx, ph] of [[-len + 2, 1], [-len + 4, -1], [len - 4, -1], [len - 2, 1]] as const) {
    const lift = p.stride * ph > 0 ? 1 : 0;
    pc.rect(cx + dx + p.stride * ph, cy + hgt - 1, big ? 2 : 1, GY - (cy + hgt - 1) - lift, skin[1]);
  }
  // ogon
  pc.line(cx - len, cy, cx - (len + 4), cy - 2 + p.bob, big ? skin[1] : accent[1]);
  blob(pc, cx, cy, len, hgt, skin, 3);
  for (let x = -len + 2; x < len - 1; x += 2) pc.set(cx + x, cy - hgt, skin[0]);
  // łeb
  const hx = cx + (len - 1), hy = cy - Math.round(1.5 * s);
  blob(pc, hx, hy, Math.round(3 * s), Math.round(2.6 * s), skin, 7);
  pc.set(hx - 1, hy - Math.round(3 * s), skin[1]);
  pc.set(hx + 1, hy - Math.round(3 * s), skin[1]);
  if (front) {
    pc.set(hx + 1, hy - 1, accent[4]);
    pc.set(hx + Math.round(3 * s), hy + 1, INK);
    if (p.attack) pc.line(hx + 2, hy + 2, hx + 4, hy + 2, 0xf0e8d8);
  }
  if (p.hurt) pc.set(cx, cy, 0x9a1a14);
};

/** Wilk: smukły, wysokie nogi, uniesiony łeb ze szpiczastymi uszami, puszysty ogon. */
const wolf: Painter = (pc, skin, accent, front, p) => {
  const cx = 11 + (p.attack ? 2 : 0) - (p.hurt ? 1 : 0), cy = GY - 8 + p.bob;
  const far = skin.map((c) => mix(c, 0x000000, 0.25));
  const legs: [number, number, readonly RGB[]][] = [[-4, 1, far], [3, -1, far], [-5, -1, skin], [4, 1, skin]];
  for (const [dx, ph, r] of legs) {
    const st = p.stride * ph, lift = st > 0 ? 1 : 0;
    pc.line(cx + dx, cy + 1, cx + dx + st, GY - 2 - lift, r[1]);
    pc.line(cx + dx + st, GY - 2 - lift, cx + dx + st + (dx > 0 ? 1 : 0), GY - lift, r[2]);
  }
  // ogon: puszysty, opuszczony, z jaśniejszym końcem
  const tw = p.bob ? 1 : 0;
  pc.line(cx - 6, cy - 1, cx - 9, cy + 2 + tw, skin[1]);
  pc.line(cx - 6, cy, cx - 9, cy + 3 + tw, skin[2]);
  pc.set(cx - 10, cy + 3 + tw, mix(skin[3], 0xe8e0d0, 0.5));
  blob(pc, cx, cy, 6, 2.6, skin, 3);
  for (let x = -4; x <= 3; x += 2) pc.set(cx + x, cy - 2, skin[0]);
  // szyja i łeb
  const hx = cx + 6 + (p.attack ? 1 : 0), hy = cy - 3 + (p.attack ? 1 : 0);
  pc.line(cx + 3, cy - 1, hx - 1, hy + 1, skin[2]);
  blob(pc, hx, hy, 2.6, 2.1, skin, 7);
  pc.rect(hx + 2, hy, 2, 2, skin[2]);
  pc.set(hx + 4, hy, INK);
  pc.set(hx - 1, hy - 3, skin[1]); pc.set(hx - 1, hy - 2, skin[2]); pc.set(hx, hy - 3, skin[3]);
  if (front) {
    pc.set(hx + 1, hy - 1, accent[4]);
    if (p.attack) { pc.set(hx + 2, hy + 2, 0xf0e8d8); pc.set(hx + 4, hy + 2, 0xf0e8d8); pc.set(hx + 3, hy + 2, 0x5a1a14); }
  }
  if (p.hurt) pc.set(cx, cy, 0x9a1a14);
};

/** Dzik: krępy, krótkie nogi, szczecina na grzbiecie, ryj z kłami. */
const boar: Painter = (pc, skin, accent, front, p) => {
  const cx = 11 + (p.attack ? 2 : 0) - (p.hurt ? 1 : 0), cy = GY - 6 + p.bob;
  for (const [dx, ph] of [[-5, 1], [-3, -1], [3, -1], [5, 1]] as const) {
    const st = p.stride * ph, lift = st > 0 ? 1 : 0;
    pc.rect(cx + dx + st, cy + 2, 2, GY - cy - 2 - lift, ph > 0 ? skin[0] : skin[1]);
  }
  pc.set(cx - 8, cy - 1 + p.bob, skin[1]); pc.set(cx - 9, cy - 2, skin[1]);
  blob(pc, cx, cy, 7, 3.8, skin, 3);
  // szczecina
  for (let x = -6; x <= 5; x++) if (x % 2 === 0) { const y = cy - 4 + (Math.abs(x) > 4 ? 1 : 0); pc.set(cx + x, y, skin[0]); pc.set(cx + x - 1, y - 1, INK); }
  // łeb (niżej przy szarży)
  const hx = cx + 6, hy = cy + (p.attack ? 2 : 0);
  blob(pc, hx, hy, 3, 2.8, skin, 7);
  pc.rect(hx + 2, hy, 2, 2, mix(skin[2], 0x6a4040, 0.4));
  pc.set(hx + 3, hy + 1, INK);
  pc.line(hx + 2, hy + 2, hx + 3, hy - 1, BONE[4]);
  pc.set(hx - 1, hy - 3, skin[1]);
  if (front) pc.set(hx, hy - 1, accent[4]);
  if (p.hurt) pc.set(cx, cy, 0x9a1a14);
};

/** Kretowij: przygarbiony garb, wielkie łopaty-pazury, maleńkie oczka, różowy ryjek. */
const mole: Painter = (pc, skin, accent, front, p) => {
  const cx = 10 - (p.hurt ? 1 : 0) + (p.attack ? 1 : 0), cy = GY - 7 + p.bob;
  const far = skin.map((c) => mix(c, 0x000000, 0.3));
  /** Łopata: dłoń + trzy długie, jasne pazury (w dół-do przodu albo, w zamachu, do przodu). */
  const claw = (x: number, y: number, r: readonly RGB[], raised: boolean, bone: readonly RGB[]) => {
    blob(pc, x, y, 2.6, 2, r, 11, 0.5);
    for (let i = 0; i < 3; i++) {
      if (raised) pc.line(x + 2, y - 1 + i, x + 4, y - 2 + i * 1.5, bone[i === 1 ? 4 : 3]);
      else pc.line(x + i, y + 1, x + i + 2, y + 2, bone[i === 1 ? 4 : 3]);
    }
  };
  const farBone = BONE.map((c) => mix(c, 0x000000, 0.3));
  // dalsza łapa (za ciałem)
  const farFwd = p.stride < 0 ? 2 : 0;
  pc.line(cx + 3, cy - 1, cx + 5 + farFwd, GY - 3, far[1]);
  claw(cx + 5 + farFwd, GY - 3, far, false, farBone);
  // tylne łapy
  pc.rect(cx - 6 + (p.stride > 0 ? -1 : 0), GY - 3, 3, 3, far[1]);
  pc.rect(cx - 3 + (p.stride < 0 ? -1 : 0), GY - 2, 2, 2, skin[1]);
  // korpus z garbem (aksamitne futro: delikatne pasma)
  blob(pc, cx - 1, cy, 7, 6, skin, 3);
  blob(pc, cx - 2, cy - 3, 5, 3.5, skin, 4, 0.62);
  for (let k = 0; k < 5; k++) pc.line(cx - 6 + k * 3, cy - 3 + (k % 2), cx - 5 + k * 3, cy + 2 + (k % 2), skin[1]);
  // trzy kostne guzy na grzbiecie
  for (const [dx, dy] of [[-5, -4], [-2, -6], [1, -5]] as const) { pc.set(cx + dx, cy + dy, BONE[1]); pc.set(cx + dx + 1, cy + dy, BONE[3]); }
  // łeb nisko z przodu: wydłużony ryj z różowym nosem, oczka-szparki
  const hx = cx + 6, hy = cy + 2 + (p.attack ? -1 : 0);
  blob(pc, hx, hy, 3, 2.2, skin, 7);
  pc.rect(hx + 2, hy, 3, 1, skin[2]);
  pc.set(hx + 5, hy, 0xe89a9a); pc.set(hx + 5, hy + 1, 0xc07070);
  if (front) pc.set(hx + 1, hy - 1, accent[4]);
  else pc.set(hx + 1, hy - 1, skin[0]);
  if (p.attack) { pc.set(hx + 3, hy + 1, 0xf0e8d8); pc.set(hx + 4, hy + 1, 0x5a1a14); }
  // bliższa łapa (przed ciałem): przy ataku uniesiona w zamachu
  if (p.attack) {
    pc.line(cx + 2, cy, cx + 6, cy - 3, skin[2]);
    claw(cx + 7, cy - 4, skin, true, BONE);
    for (let i = 0; i < 4; i++) pc.set(cx + 12, cy - 4 + i * 2, 0xffffff, 90);
  } else {
    const fwd = p.stride > 0 ? 2 : 0;
    pc.line(cx + 2, cy + 1, cx + 4 + fwd, GY - 2, skin[2]);
    claw(cx + 4 + fwd, GY - 2, skin, false, BONE);
  }
  if (p.hurt) pc.set(cx, cy - 2, 0x9a1a14);
};

// ------------------------------------------------------------------ owady

/** Skorpion: segmentowany odwłok, szczypce, uniesiony ogon z żądłem, odnóża falujące w krokach. */
const scorpion: Painter = (pc, skin, accent, front, p) => {
  const cx = 12 - (p.hurt ? 1 : 0), by = GY - 4 + (p.bob > 0 ? 1 : 0);
  const far = skin.map((c) => mix(c, 0x000000, 0.32));
  // odnóża: 4 pary rozstawione wachlarzem (przednie do przodu, tylne do tyłu), faza falująca od przodu do tyłu
  const legsOf = (r: readonly RGB[], dy: number, sgn: number) => {
    for (let i = 0; i < 4; i++) {
      const ph = (i % 2 ? 1 : -1) * p.stride * sgn, lift = ph > 0 ? 1 : 0;
      const hx = cx + 1 - i * 2, out = [2, 1, -1, -2][i];
      const kx = hx + out, fx = hx + out * 2 + ph;
      leg(pc, hx, by + 1 + dy, kx, by + dy, fx, GY - lift + dy, r[i % 2 ? 1 : 2]);
    }
  };
  legsOf(far, -1, -1);
  // szczypce dalsze
  const open = p.attack ? 2 : 0;
  const clawC = skin.map((c) => mix(c, accent[2], 0.2));
  const clawF = clawC.map((c) => mix(c, 0x000000, 0.32));
  pc.line(cx + 3, by - 2, cx + 5, by - 5, far[2]); pc.line(cx + 5, by - 5, cx + 7 + open, by - 5, far[2]);
  blob(pc, cx + 9 + open, by - 5, 2.2, 1.5, clawF, 21);
  pc.set(cx + 11 + open, by - 5, INK);
  // odwłok: segmenty od głowotułowia do ogona
  const segs: [number, number, number][] = [[-1, 2.3, 2], [-4, 2.1, 1.9], [-6.5, 1.8, 1.7]];
  for (const [dx, rx, ry] of segs) blob(pc, cx + dx, by - 1, rx, ry, skin, 5);
  for (const [dx] of segs) pc.line(Math.round(cx + dx + 1.5), by - 2, Math.round(cx + dx + 1.5), by, skin[0]);
  // ogon: unosi się łukiem nad grzbiet, przy ataku żądło uderza do przodu
  const tail: [number, number][] = p.attack
    ? [[-8, -2], [-9, -5], [-8, -9], [-5, -11], [-1, -11], [2, -9]]
    : [[-8, -2], [-10, -5], [-10, -9], [-8, -12], [-5, -13 + (p.bob ? 1 : 0)], [-3, -12 + (p.bob ? 1 : 0)]];
  tail.forEach(([dx, dy], k) => {
    const r = k < 2 ? 1.5 : k < 4 ? 1.3 : 1.1;
    blob(pc, cx + dx, by + dy, r, r, skin, 9 + k);
  });
  const [sx, sy] = tail[tail.length - 1];
  pc.set(cx + sx + 1, by + sy + 1, accent[3]);
  pc.set(cx + sx + 2, by + sy + 2, accent[4]);
  pc.set(cx + sx + 2, by + sy + 3, INK);
  // głowotułów
  blob(pc, cx + 2, by - 1, 2.8, 2, skin, 3);
  if (front) { pc.set(cx + 3, by - 3, INK); pc.set(cx + 4, by - 3, accent[4]); }
  // bliższe odnóża i szczypce (ramię z łokciem, duża kleszcz z rozcięciem)
  legsOf(skin, 0, 1);
  pc.line(cx + 3, by, cx + 5, by - 3, skin[2]); pc.line(cx + 5, by - 3, cx + 7 + open, by - 3, skin[2]);
  blob(pc, cx + 9 + open, by - 3, 2.6, 1.8, clawC, 23);
  if (p.attack) { pc.clear(cx + 11 + open, by - 3); pc.clear(cx + 10 + open, by - 3); pc.set(cx + 11 + open, by - 4, clawC[3]); }
  else { pc.set(cx + 10, by - 3, INK); pc.set(cx + 11, by - 3, INK); } // szczelina między palcami szczypiec
  if (p.hurt) pc.set(cx - 3, by - 2, 0x9a1a14);
};

/** Pająk: duży odwłok z plamą, osiem odnóży ugiętych w kolanach, skupisko oczu. */
const spider: Painter = (pc, skin, accent, front, p) => {
  const cx = 11 - (p.hurt ? 1 : 0), by = GY - 6 + p.bob;
  const far = skin.map((c) => mix(c, 0x000000, 0.35));
  const legsOf = (r: readonly RGB[], dy: number, sgn: number) => {
    for (let i = 0; i < 4; i++) {
      const ph = (i % 2 ? 1 : -1) * p.stride * sgn, lift = ph > 0 ? 1 : 0;
      const raise = p.attack && i === 0 && sgn > 0;
      const hx = cx + 1, kx = cx + [5, 2, -3, -6][i] + ph, ky = by - [5, 6, 6, 5][i] + dy, fx = cx + [8, 4, -5, -9][i] + ph;
      if (raise) leg(pc, hx, by + dy, cx + 6, by - 7, cx + 9, by - 5, r[2]);
      else leg(pc, hx, by + dy, kx, ky, fx, GY - lift + dy, r[i % 2 ? 1 : 2]);
    }
  };
  legsOf(far, -1, -1);
  blob(pc, cx - 4, by - 1, 4.5, 3.6, skin, 3);
  pc.set(cx - 4, by - 2, accent[3]); pc.set(cx - 4, by - 1, accent[2]); pc.set(cx - 5, by - 1, accent[3]); pc.set(cx - 4, by, accent[3]);
  blob(pc, cx + 2, by, 2.6, 2, skin, 5);
  if (front) {
    pc.set(cx + 4, by - 1, accent[4]); pc.set(cx + 3, by - 1, accent[3]); pc.set(cx + 4, by, accent[2]);
    if (p.attack) { pc.set(cx + 5, by + 1, BONE[4]); pc.set(cx + 4, by + 2, BONE[3]); }
  }
  legsOf(skin, 0, 1);
  if (p.hurt) pc.set(cx - 4, by - 2, 0x9a1a14);
};

/** Chrząszcz: lśniący pancerz z szwem, róg, sześć krótkich odnóży. */
const beetle: Painter = (pc, skin, accent, front, p) => {
  const cx = 11 - (p.hurt ? 1 : 0) + (p.attack ? 1 : 0), by = GY - 4 + (p.bob > 0 ? 1 : 0);
  const far = skin.map((c) => mix(c, 0x000000, 0.35));
  const legsOf = (r: readonly RGB[], dy: number, sgn: number) => {
    for (let i = 0; i < 3; i++) {
      const ph = (i % 2 ? 1 : -1) * p.stride * sgn, lift = ph > 0 ? 1 : 0;
      const hx = cx + 2 - i * 3;
      leg(pc, hx, by + dy, hx + 1 + ph, by + 1 + dy, hx + ph, GY - lift + dy, r[1]);
    }
  };
  legsOf(far, -1, -1);
  blob(pc, cx - 1, by - 1, 6, 3.6, skin, 3, 0.5);
  pc.line(cx - 6, by - 1, cx + 3, by - 2, skin[0]);
  pc.set(cx - 3, by - 4, 0xffffff, 170); pc.set(cx - 2, by - 4, skin[4]); pc.set(cx - 4, by - 3, skin[4]);
  blob(pc, cx + 5, by, 2, 1.6, skin, 5);
  pc.line(cx + 6, by - 1, cx + 8, by - 3 - (p.attack ? 1 : 0), skin[1]);
  pc.set(cx + 8, by - 4 - (p.attack ? 1 : 0), accent[3]);
  if (front) pc.set(cx + 6, by, accent[4]);
  legsOf(skin, 0, 1);
  if (p.hurt) pc.set(cx - 1, by - 2, 0x9a1a14);
};

// ------------------------------------------------------------------ inne kształty

const swarm: Painter = (pc, skin, accent, _front, p) => {
  const n = 13;
  for (let i = 0; i < n; i++) {
    const a = i * 2.4, r = 2 + (i % 5) * 1.5;
    const jx = Math.round(Math.cos(a + p.stride * 0.9 + p.bob) * r * 1.3 + (p.attack ? 3 : 0));
    const jy = Math.round(Math.sin(a * 1.7 + p.bob * 0.8) * r * 0.9);
    const x = 12 + jx, y = 19 + jy;
    pc.rect(x, y, 2, 2, pick(skin, 0.3 + (i % 3) * 0.2, x, y));
    pc.set(x + 1, y, i % 4 === 0 ? accent[4] : skin[3]);
    if (i % 3 === 0) {
      pc.set(x - 1, y - 1, accent[2], 150);
      pc.set(x + 2, y - 1, accent[2], 150);
    }
  }
  if (p.hurt) pc.rect(11, 18, 2, 2, 0x9a1a14);
};

const drone: Painter = (pc, skin, accent, front, p) => {
  const cx = 12 - (p.hurt ? 1 : 0), cy = 14 + p.bob + (p.hurt ? 2 : 0);
  const spin = p.stride !== 0 || p.bob !== 0 ? 5 : 7;
  pc.line(cx - spin, cy - 5, cx + spin, cy - 5, 0x9aa4ac, 190);
  pc.rect(cx, cy - 5, 1, 2, skin[1]);
  blob(pc, cx, cy, 6, 3, skin, 5);
  pc.rect(cx - 6, cy, 13, 1, skin[1]);
  if (front) {
    pc.rect(cx - 1, cy - 1, 3, 2, 0x14100e);
    pc.set(cx, cy - 1, accent[p.attack ? 4 : 3]);
  } else pc.set(cx, cy - 1, skin[4]);
  pc.rect(cx + 2, cy + 3, 2, 2, skin[0]);
  if (p.attack) {
    pc.set(cx + 5, cy + 4, 0xfff0a0);
    pc.set(cx + 6, cy + 4, 0xff9a2a);
  }
};

const turret: Painter = (pc, skin, accent, _front, p) => {
  const cx = 12;
  pc.poly([[cx - 6, GY], [cx + 6, GY], [cx + 4, GY - 4], [cx - 4, GY - 4]], (x, y) => pick(skin, 0.3 - (x - cx) * 0.03, x, y));
  pc.rect(cx - 1, GY - 9, 3, 5, skin[1]);
  const hy = GY - 12 + (p.hurt ? 1 : 0);
  blob(pc, cx, hy, 5, 3, skin, 9);
  const rec = p.attack ? -1 : 0;
  pc.rect(cx + 3, hy, 6 + rec, 2, skin[0]);
  pc.set(cx - 2, hy - 2, accent[p.bob ? 4 : 2]);
  if (p.attack) {
    pc.set(cx + 10, hy, 0xfff0a0);
    pc.set(cx + 11, hy + 1, 0xff9a2a);
  }
};

const PAINTERS: Partial<Record<EnemyShape, Painter>> = { quad, swarm, drone, turret, big: quad };
const SPECIES: Record<CreatureSpecies, Painter> = { scorpion, mole, wolf, boar, spider, beetle, rat: quad, dog: quad };

/** Gatunek po templateId / nazwie (np. 'scorpion', 'kretowij', 'wolf_pack'); undefined = malarz wg kształtu. */
export function creatureSpecies(id: string | undefined | null): CreatureSpecies | undefined {
  const s = String(id ?? '').toLowerCase();
  if (!s) return undefined;
  if (/scorp|skorp/.test(s)) return 'scorpion';
  if (/kret|mole/.test(s)) return 'mole';
  if (/wolf|wilk|hyena|hien|coyote|kojot/.test(s)) return 'wolf';
  if (/boar|dzik|bear|nied/.test(s)) return 'boar';
  if (/spider|pajak|pająk/.test(s)) return 'spider';
  if (/beetle|chrzas|chrząsz|roach|karalu|scarab/.test(s)) return 'beetle';
  if (/(^|_)rat|szczur/.test(s)) return 'rat';
  if (/dog|pies|hound|psy/.test(s)) return 'dog';
  return undefined;
}

/**
 * Arkusz klatek bestii. `species` (opcjonalnie: gatunek albo templateId, np. 'scorpion', 'kretowij', 'wolf')
 * wybiera dedykowanego malarza; bez niego decyduje kształt (jak dotąd).
 */
export function paintCreatureSheet(shape: EnemyShape, skinColor: RGB, accentColor: RGB, species?: string): UnitSheet {
  const skin = ramp(skinColor, 5, 0.4), accent = ramp(accentColor, 5, 0.4);
  const sp = species ? ((species in SPECIES ? species : creatureSpecies(species)) as CreatureSpecies | undefined) : undefined;
  const paint = (sp && SPECIES[sp]) || PAINTERS[shape] || quad;
  return buildUnitSheet((pc, front, pose) => paint(pc, skin, accent, front, pose, shape === 'big'));
}
