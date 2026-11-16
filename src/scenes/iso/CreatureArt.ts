// Proceduralne sprite'y wrogów nie-humanoidalnych (24x32, te same nazwy klatek co paintUnitSheet).
// Kształty z EnemyDef.look.shape (Oldgame/src/gfx/creature.js w uproszczeniu do skali izometrycznej):
//   quad = czworonóg (szczur, pies), swarm = rój, big = wielka bestia, drone = latający dron, turret = wieżyczka.
// Gatunki (jak speciesBody w creature.js) wybierane po templateId: skorpion, kretowij, wilk, dzik, pająk, chrząszcz.
// Klatki 'b_*' patrzą w prawo-od-kamery (NE), 'f_*' w prawo-do-kamery (SE); lewe kierunki = flipX.
import type { EnemyShape } from '../../core/data/types';
import { PixelCanvas, type RGB, hash2, mix, pick, ramp } from './Pixel';
import { BASE_ANIMS, type Pose, type UnitSheet, blitRotated, buildUnitSheet } from './UnitArt';

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

/** Stopień położenia na boku przy śmierci (0 = stoi, 1 = leży). */
const lieOf = (p: Pose): number => (p.die < 0 ? 0 : [0.2, 0.55, 1, 1, 1, 1, 1][p.die]);
const isDead = (p: Pose): boolean => p.die >= 2;
/** Odbicie ciała od ziemi w klatce upadku. */
const bounceOf = (p: Pose): number => (p.die === 2 ? -1 : 0);
const BLOOD = 0x9a1a14;

/**
 * Nogi czworonoga: [dx biodra, faza, rampa]. Stojąc - dwa segmenty z kolanem i krokiem; leżąc - sztywne, wyciągnięte w bok.
 * hipY = dół tułowia, len = długość nogi w staniu.
 */
function quadLegs(pc: PixelCanvas, cx: number, hipY: number, defs: readonly (readonly [number, number, readonly RGB[]])[], p: Pose, w = 1, paw?: RGB): void {
  const lie = lieOf(p);
  for (const [dx, ph, r] of defs) {
    const x = cx + dx;
    if (lie >= 1) {
      const far = ph < 0 ? -1 : 0;
      pc.line(x, GY - 2 + far, x + 3, GY + far, r[1]);
      if (w > 1) pc.line(x, GY - 1 + far, x + 3, GY + 1 + far, r[0]);
      if (paw !== undefined) pc.set(x + 4, GY + far, paw);
      continue;
    }
    const st = p.stride * ph, lift = st > 0 && p.anim === 'walk' ? 1 : 0;
    const splay = lie > 0 ? (dx > 0 ? 1 : -1) * Math.round(lie * 3) : 0;
    const fx = x + (p.anim === 'walk' ? st : 0) + splay, fy = GY - lift;
    const kx = Math.round((x + fx) / 2) + (dx < 0 ? -1 : 0) * (lie > 0 ? 0 : 1), ky = Math.round((hipY + fy) / 2);
    for (let k = 0; k < w; k++) { pc.line(x + k, hipY, kx + k, ky, r[1]); pc.line(kx + k, ky, fx + k, fy, r[2]); }
    if (paw !== undefined) pc.set(fx + w, fy, paw);
  }
}

const quad: Painter = (pc, skin, accent, front, p, big) => {
  const s = big ? 1.45 : 1;
  const len = Math.round(7 * s), hgt = Math.round(3.4 * s);
  const lie = lieOf(p);
  const stand = Math.round(5 * s);
  const cx = 12 + p.lunge, cy = GY - stand + p.bob + Math.round(lie * (stand - hgt)) + bounceOf(p);
  const far = skin.map((c) => mix(c, 0x000000, 0.25));
  quadLegs(pc, cx, cy + hgt - 1, [[-len + 2, 1, far], [len - 4, -1, far], [-len + 4, -1, skin], [len - 2, 1, skin]], p, big ? 2 : 1);
  pc.line(cx - len, cy, cx - (len + 4), cy - 2 + p.bob + Math.round(lie * 3), big ? skin[1] : accent[1]);
  blob(pc, cx, cy, len, hgt, skin, 3);
  for (let x = -len + 2; x < len - 1; x += 2) pc.set(cx + x, cy - hgt, skin[0]);
  const hx = cx + (len - 1), hy = cy - Math.round(1.5 * s) + Math.round(lie * 2);
  blob(pc, hx, hy, Math.round(3 * s), Math.round(2.6 * s), skin, 7);
  pc.set(hx - 1, hy - Math.round(3 * s), skin[1]);
  pc.set(hx + 1, hy - Math.round(3 * s), skin[1]);
  if (front) {
    pc.set(hx + 1, hy - 1, isDead(p) ? INK : accent[4]);
    pc.set(hx + Math.round(3 * s), hy + 1, INK);
    if (p.attack) pc.line(hx + 2, hy + 2, hx + 4, hy + 2, 0xf0e8d8);
  }
  if (p.hurt && p.die < 3) pc.set(cx, cy, BLOOD);
};

/** Szczur-mutant: niski, garbaty, długi nagi ogon, wielkie uszy, spiczasty pysk z siekaczami. */
const rat: Painter = (pc, skin, accent, front, p) => {
  const lie = lieOf(p);
  const cx = 12 + p.lunge, cy = GY - 4 + (p.bob > 0 ? 1 : 0) + Math.round(lie * 1) + bounceOf(p);
  const far = skin.map((c) => mix(c, 0x000000, 0.28));
  const pink = mix(skin[3], 0xd89a94, 0.6), pinkD = mix(pink, 0x4a2a2a, 0.4);
  // ogon: długi, nagi, wygięty w S (macha przy oddechu), po śmierci leży na ziemi
  const tw = p.anim === 'idle' ? (p.i & 1) : p.anim === 'walk' ? (p.i >> 1) & 1 : 0;
  const tail: [number, number][] = isDead(p)
    ? [[-6, 1], [-8, 3], [-10, 3], [-11, 2]]
    : p.attack ? [[-6, 0], [-8, -2], [-10, -5], [-11, -8]] : [[-6, 1], [-8, 2], [-10, 1 - tw], [-11, -2 - tw], [-10, -4 - tw]];
  for (let k = 0; k + 1 < tail.length; k++) pc.line(cx + tail[k][0], cy + tail[k][1], cx + tail[k + 1][0], cy + tail[k + 1][1], k % 2 ? pinkD : pink);
  quadLegs(pc, cx, cy + 1, [[-4, 1, far], [3, -1, far], [-3, -1, skin], [4, 1, skin]], p, 1, pink);
  // tułów: długi, z garbem nad zadem
  blob(pc, cx, cy, 6, 2.5, skin, 3);
  blob(pc, cx - 2, cy - 1.6, 4, 2.4, skin, 4, 0.6);
  for (let x = -5; x <= 1; x += 2) pc.set(cx + x, cy - 4 + (Math.abs(x + 2) > 2 ? 1 : 0), skin[0]); // nastroszona sierść
  pc.set(cx - 1, cy, pinkD); pc.set(cx + 1, cy + 1, pinkD); // łyse placki
  // łeb: stożkowy pysk, różowy nos, wąsy, siekacze
  const hx = cx + 6, hy = cy + (p.attack ? -1 : 0) + Math.round(lie);
  // uszy (dalsze ciemniejsze)
  pc.ellipse(hx + 0.5, hy - 3, 1.7, 1.9, far[2]);
  blob(pc, hx, hy, 2.6, 2.1, skin, 7);
  pc.ellipse(hx - 1.5, hy - 2.8, 1.9, 2.1, skin[3]);
  pc.set(hx - 2, hy - 3, pink); pc.set(hx - 2, hy - 2, pinkD);
  pc.line(hx + 2, hy, hx + 4, hy + 1, skin[2]); pc.set(hx + 3, hy, skin[3]);
  pc.set(hx + 5, hy + 1, pink);
  pc.set(hx + 4, hy - 1, 0xd8d0c0, 150); pc.set(hx + 5, hy + 2, 0xd8d0c0, 130); // wąsy
  pc.set(hx + 1, hy - 1, isDead(p) ? INK : accent[4]);
  if (front && !isDead(p)) pc.set(hx + 2, hy - 1, accent[2], 150);
  if (p.attack) { pc.set(hx + 3, hy + 2, 0xf8f0e0); pc.set(hx + 4, hy + 2, 0x5a1a14); pc.set(hx + 4, hy + 3, 0xf8f0e0); }
  else pc.set(hx + 4, hy + 2, 0xf0e8d8);
  if (p.hurt && p.die < 3) pc.set(cx - 1, cy - 1, BLOOD);
};

/** Pies-mutant: wysokie nogi, zapadnięty brzuch, żebra, parchy, kostne płytki na grzbiecie, podarte ucho, długi pysk. */
const dog: Painter = (pc, skin, accent, front, p) => {
  const lie = lieOf(p);
  const cx = 11 + p.lunge, cy = GY - 9 + p.bob + Math.round(lie * 5) + bounceOf(p);
  const far = skin.map((c) => mix(c, 0x000000, 0.3));
  const mange = mix(skin[2], 0xc08a80, 0.55);
  // ogon: chudy, zadarty hakiem; po śmierci opada
  if (isDead(p)) pc.line(cx - 6, cy, cx - 10, cy + 2, skin[1]);
  else { pc.line(cx - 6, cy - 1, cx - 8, cy - 4 - (p.attack ? 1 : 0), skin[1]); pc.line(cx - 8, cy - 4 - (p.attack ? 1 : 0), cx - 7, cy - 6, skin[2]); }
  quadLegs(pc, cx, cy + 2, [[-5, 1, far], [3, -1, far], [-4, -1, skin], [4, 1, skin]], p, 1);
  // tułów: głęboka klatka z przodu, podkasany brzuch z tyłu
  blob(pc, cx - 2, cy, 4.5, 2.2, skin, 3);
  blob(pc, cx + 2.5, cy + 0.6, 3.6, 3.1, skin, 4, 0.58);
  // żebra
  for (let k = 0; k < 3; k++) { pc.line(cx + 1 + k * 2, cy, cx + k * 2, cy + 2, skin[0]); pc.set(cx + 1 + k * 2, cy - 1, BONE[2]); }
  // kostne płytki na grzbiecie + parchy + toksyczne krosty
  for (let x = -5; x <= 3; x += 2) pc.set(cx + x, cy - 3 + (x < -3 ? 1 : 0), x % 4 === 0 ? BONE[4] : BONE[2]);
  pc.set(cx - 3, cy, mange); pc.set(cx - 4, cy + 1, mange); pc.set(cx - 2, cy - 1, mange);
  pc.set(cx + 5, cy - 1, accent[3]); pc.set(cx - 1, cy + 1, accent[2]);
  // szyja i łeb: kanciasty, długi pysk, przy ataku rozwarta paszcza
  const hx = cx + 7 + (p.attack ? 1 : 0), hy = cy - 3 + (p.attack ? 1 : 0) + Math.round(lie * 3);
  pc.line(cx + 4, cy - 1, hx - 1, hy + 1, skin[2]); pc.line(cx + 4, cy, hx - 1, hy + 2, skin[1]);
  blob(pc, hx, hy, 2.5, 2.2, skin, 7);
  const jaw = p.attack ? 1 : 0;
  pc.rect(hx + 2, hy - jaw, 3, 1, skin[3]); pc.rect(hx + 2, hy + 1 - jaw, 3, 1, skin[2]);
  pc.set(hx + 5, hy - jaw, INK);
  pc.rect(hx + 2, hy + 2 + jaw, 2, 1, skin[1]);
  if (p.attack) { pc.set(hx + 2, hy + 1, 0x5a1a14); pc.set(hx + 3, hy + 1, 0xf8f0e0); pc.set(hx + 4, hy + 1, 0x5a1a14); pc.set(hx + 4, hy + 2, 0xf8f0e0); }
  else pc.set(hx + 3, hy + 2, 0xf0e8d8); // kieł
  // uszy: jedno stojące, drugie postrzępione
  pc.set(hx - 1, hy - 3, skin[2]); pc.set(hx - 1, hy - 4, skin[3]); pc.set(hx, hy - 3, skin[1]);
  pc.set(hx + 1, hy - 3, far[2]);
  pc.set(hx + 1, hy - 1, isDead(p) ? INK : accent[4]);
  if (front && !isDead(p)) pc.set(hx, hy - 1, accent[2], 140);
  if (p.hurt && p.die < 3) pc.set(cx, cy, BLOOD);
};

/** Wilk: smukły, wysokie nogi, uniesiony łeb ze szpiczastymi uszami, puszysty ogon. */
const wolf: Painter = (pc, skin, accent, front, p) => {
  const lie = lieOf(p);
  const cx = 11 + p.lunge, cy = GY - 8 + p.bob + Math.round(lie * 4) + bounceOf(p);
  const far = skin.map((c) => mix(c, 0x000000, 0.25));
  quadLegs(pc, cx, cy + 1, [[-4, 1, far], [3, -1, far], [-5, -1, skin], [4, 1, skin]], p);
  // ogon: puszysty, opuszczony, z jaśniejszym końcem
  const tw = p.bob ? 1 : 0;
  pc.line(cx - 6, cy - 1, cx - 9, cy + 2 + tw, skin[1]);
  pc.line(cx - 6, cy, cx - 9, cy + 3 + tw, skin[2]);
  pc.set(cx - 10, cy + 3 + tw, mix(skin[3], 0xe8e0d0, 0.5));
  blob(pc, cx, cy, 6, 2.6, skin, 3);
  for (let x = -4; x <= 3; x += 2) pc.set(cx + x, cy - 2, skin[0]);
  // szyja i łeb
  const hx = cx + 6 + (p.attack ? 1 : 0), hy = cy - 3 + (p.attack ? 1 : 0) + Math.round(lie * 3);
  pc.line(cx + 3, cy - 1, hx - 1, hy + 1, skin[2]);
  blob(pc, hx, hy, 2.6, 2.1, skin, 7);
  pc.rect(hx + 2, hy, 2, 2, skin[2]);
  pc.set(hx + 4, hy, INK);
  pc.set(hx - 1, hy - 3, skin[1]); pc.set(hx - 1, hy - 2, skin[2]); pc.set(hx, hy - 3, skin[3]);
  if (front) {
    pc.set(hx + 1, hy - 1, isDead(p) ? INK : accent[4]);
    if (p.attack) { pc.set(hx + 2, hy + 2, 0xf0e8d8); pc.set(hx + 4, hy + 2, 0xf0e8d8); pc.set(hx + 3, hy + 2, 0x5a1a14); }
  }
  if (p.hurt && p.die < 3) pc.set(cx, cy, BLOOD);
};

/** Dzik: krępy, krótkie nogi, szczecina na grzbiecie, ryj z kłami. */
const boar: Painter = (pc, skin, accent, front, p) => {
  const lie = lieOf(p);
  const cx = 11 + p.lunge, cy = GY - 6 + p.bob + Math.round(lie * 2) + bounceOf(p);
  const far = skin.map((c) => mix(c, 0x000000, 0.25));
  quadLegs(pc, cx, cy + 2, [[-5, 1, far], [3, -1, far], [-3, -1, skin], [5, 1, skin]], p, 2);
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
  if (front) pc.set(hx, hy - 1, isDead(p) ? INK : accent[4]);
  if (p.hurt && p.die < 3) pc.set(cx, cy, BLOOD);
};

/** Kretowij: przygarbiony garb, wielkie łopaty-pazury, maleńkie oczka, różowy ryjek. */
const mole: Painter = (pc, skin, accent, front, p) => {
  const cx = 10 + Math.sign(p.lunge), cy = GY - 7 + p.bob;
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
  if (p.hurt && p.die < 3) pc.set(cx, cy - 2, 0x9a1a14);
};

// ------------------------------------------------------------------ owady

/** Skorpion: segmentowany odwłok, szczypce, uniesiony ogon z żądłem, odnóża falujące w krokach. */
const scorpion: Painter = (pc, skin, accent, front, p) => {
  const cx = 12 + Math.sign(p.lunge) * (p.attack ? 0 : 1), by = GY - 4 + (p.bob > 0 ? 1 : 0);
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
  if (p.hurt && p.die < 3) pc.set(cx - 3, by - 2, 0x9a1a14);
};

/** Pająk: duży odwłok z plamą, osiem odnóży ugiętych w kolanach, skupisko oczu. */
const spider: Painter = (pc, skin, accent, front, p) => {
  const cx = 11 + Math.sign(p.lunge), by = GY - 6 + p.bob;
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
  if (p.hurt && p.die < 3) pc.set(cx - 4, by - 2, 0x9a1a14);
};

/** Chrząszcz: lśniący pancerz z szwem, róg, sześć krótkich odnóży. */
const beetle: Painter = (pc, skin, accent, front, p) => {
  const cx = 11 + Math.sign(p.lunge), by = GY - 4 + (p.bob > 0 ? 1 : 0);
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
  if (p.hurt && p.die < 3) pc.set(cx - 1, by - 2, 0x9a1a14);
};

// ------------------------------------------------------------------ inne kształty

/** Rój: owady krążą; przy śmierci opadają na ziemię i zostaje garść martwych. */
const swarm: Painter = (pc, skin, accent, _front, p) => {
  const n = 13;
  const fall = p.die < 0 ? 0 : [0.1, 0.3, 0.6, 0.85, 1, 1, 1][p.die];
  const ph = p.anim === 'idle' ? p.i * 0.7 : p.anim === 'walk' ? p.i * 0.8 : p.i * 0.5;
  for (let i = 0; i < n; i++) {
    if (p.die >= 2 && i % 3 === 2) continue; // część rozpierzcha się
    const a = i * 2.4, r = 2 + (i % 5) * 1.5;
    const jx = Math.round(Math.cos(a + ph) * r * 1.3 + (p.attack ? 3 + (i % 3) : 0) + p.lunge * 0.5);
    const jy = Math.round(Math.sin(a * 1.7 + ph * 0.8) * r * 0.9);
    const x = 12 + jx + Math.round(fall * ((i % 5) - 2)), y0 = 19 + jy;
    const y = Math.round(y0 + (GY - (i % 2) - y0) * fall);
    if (fall >= 1) { pc.set(x, y, skin[1]); pc.set(x + 1, y, skin[0]); if (i % 4 === 0) pc.set(x, y - 1, skin[2]); continue; }
    pc.rect(x, y, 2, 2, pick(skin, 0.3 + (i % 3) * 0.2, x, y));
    pc.set(x + 1, y, i % 4 === 0 ? accent[4] : skin[3]);
    if ((i + p.i) % 3 === 0) {
      pc.set(x - 1, y - 1, accent[2], 150);
      pc.set(x + 2, y - 1, accent[2], 150);
    }
  }
  if (p.hurt && p.die < 2) pc.rect(11, 18, 2, 2, accent[4]);
};

/** Dron: korpus z wirnikiem, soczewka, lufa pod spodem. Ginie spadając i rozbijając się (obrót w paintCreatureSheet). */
const drone: Painter = (pc, skin, accent, front, p) => {
  const dead = p.die >= 0;
  const cx = 12 + (dead ? 0 : Math.sign(p.lunge)), cy = 14 + p.bob + (p.hurt && !dead ? 2 : 0);
  const spin = dead ? (p.die >= 3 ? 3 : 4 + (p.die & 1) * 3) : (p.i & 1) ? 5 : 7;
  pc.line(cx - spin, cy - 5, cx + spin, cy - 5, 0x9aa4ac, dead && p.die >= 3 ? 255 : 190);
  if (!dead && (p.i & 1)) { pc.set(cx - 7, cy - 5, 0xc8d0d6, 90); pc.set(cx + 7, cy - 5, 0xc8d0d6, 90); }
  pc.rect(cx, cy - 5, 1, 2, skin[1]);
  blob(pc, cx, cy, 6, 3, skin, 5);
  pc.rect(cx - 6, cy, 13, 1, skin[1]);
  pc.set(cx - 5, cy - 1, skin[4]); pc.set(cx + 5, cy + 1, skin[0]);
  pc.set(cx - 4, cy + 2, accent[2]); // lampka pozycyjna
  if (front) {
    pc.rect(cx - 1, cy - 1, 3, 2, 0x14100e);
    pc.set(cx, cy - 1, p.die >= 2 ? 0x3a1410 : accent[p.attack ? 4 : 3]);
    if (p.attack && !dead) pc.set(cx + 1, cy - 1, 0xffffff);
  } else pc.set(cx, cy - 1, skin[4]);
  pc.rect(cx + 2, cy + 3, 2, 2, skin[0]); pc.rect(cx + 4, cy + 4, 2, 1, skin[1]);
  if (p.flash === 1) { pc.set(cx + 6, cy + 4, 0xffffff); pc.set(cx + 7, cy + 4, 0xfff0a0); pc.set(cx + 8, cy + 4, 0xff9a2a); pc.set(cx + 7, cy + 3, 0xff9a2a); pc.set(cx + 7, cy + 5, 0xff9a2a); }
  else if (p.flash === 2) { pc.set(cx + 6, cy + 3, 0xb8b0a4, 150); pc.set(cx + 7, cy + 2, 0xa8a094, 100); }
  else if (p.attack && p.anim === 'attack') { pc.set(cx + 6, cy + 4, 0xfff0a0); pc.set(cx + 7, cy + 4, 0xff9a2a); }
};

/** Wieżyczka: podstawa, kolumna, obrotowa głowica z lufą; po zniszczeniu głowica opada, lufa zwisa. */
const turret: Painter = (pc, skin, accent, _front, p) => {
  const cx = 12;
  const dead = p.die >= 2;
  pc.poly([[cx - 6, GY], [cx + 6, GY], [cx + 4, GY - 4], [cx - 4, GY - 4]], (x, y) => pick(skin, 0.3 - (x - cx) * 0.03, x, y));
  for (let x = cx - 4; x <= cx + 4; x += 4) pc.set(x, GY - 1, skin[4]); // nity
  pc.rect(cx - 1, GY - 9, 3, 5, skin[1]); pc.rect(cx - 1, GY - 9, 1, 5, skin[3]);
  const hy = GY - 12 + (p.hurt ? 1 : 0) + (dead ? 2 : 0) + (p.anim === 'idle' && p.i === 2 ? 0 : 0);
  const hxo = dead ? 1 : 0;
  blob(pc, cx + hxo, hy, 5, 3, skin, 9);
  pc.rect(cx - 3 + hxo, hy - 1, 5, 1, skin[0]); // szczelina pancerza
  if (dead) {
    pc.line(cx + 3, hy + 1, cx + 7, hy + 6, skin[0]); pc.line(cx + 4, hy + 1, cx + 8, hy + 6, skin[2]);
    pc.set(cx - 1, hy - 2, 0x3a1410);
    pc.line(cx - 3, hy + 3, cx - 5, hy + 6, 0x2a2a30); // wyrwany kabel
    pc.set(cx - 5, hy + 7, accent[4]);
  } else {
    const rec = p.flash === 2 ? -1 : 0;
    const aimY = p.anim === 'idle' && p.i >= 2 && p.i < 4 ? 0 : 0;
    pc.rect(cx + 3, hy + aimY, 6 + rec, 2, skin[0]); pc.rect(cx + 3, hy + aimY, 6 + rec, 1, skin[2]);
    pc.set(cx + 8 + rec, hy + aimY, skin[4]);
    pc.set(cx - 2, hy - 2, accent[p.blink || (p.i & 1) ? 4 : 2]);
    if (p.attack && p.anim !== 'shoot') pc.set(cx - 1, hy - 2, accent[4]);
    if (p.flash === 1) { pc.set(cx + 9, hy, 0xffffff); pc.set(cx + 10, hy, 0xfff0a0); pc.set(cx + 11, hy + 1, 0xff9a2a); pc.set(cx + 10, hy - 1, 0xff9a2a); pc.set(cx + 10, hy + 1, 0xffe070); }
    else if (p.flash === 2) { pc.set(cx + 9, hy - 1, 0xb8b0a4, 150); pc.set(cx + 10, hy - 2, 0xa8a094, 100); pc.set(cx + 4, hy - 2, 0xc8a048); }
    else if (p.attack && p.anim === 'attack') { pc.set(cx + 10, hy, 0xfff0a0); pc.set(cx + 11, hy + 1, 0xff9a2a); }
  }
};

const PAINTERS: Partial<Record<EnemyShape, Painter>> = { quad, swarm, drone, turret, big: quad };
const SPECIES: Record<CreatureSpecies, Painter> = { scorpion, mole, wolf, boar, spider, beetle, rat, dog };
/** Bestie, które giną przewracając się na grzbiet (odnóża w górę). */
const ROLLS = new Set<Painter>([scorpion, spider, beetle, mole]);
const MACHINES = new Set<Painter>([drone, turret]);

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

/** Ramka nieprzezroczystych pikseli: [y góra, y dół]. */
function rowsOf(pc: PixelCanvas): [number, number] {
  let y0 = pc.h, y1 = -1;
  for (let y = 0; y < pc.h; y++) for (let x = 0; x < pc.w; x++) if (pc.alpha(x, y) > 0) { y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  return [y0, y1];
}

function under(pc: PixelCanvas, x: number, y: number, c: RGB, a = 255): void {
  if (pc.alpha(x, y) === 0) pc.set(x, y, c, a);
}

/** Kałuża pod ciałem (krew ssaków / jucha owadów / olej maszyn). */
function pool(pc: PixelCanvas, cx: number, r: number, cols: readonly [RGB, RGB, RGB]): void {
  for (let y = 26; y <= 30; y++)
    for (let x = 0; x < pc.w; x++) {
      const dx = (x + 0.5 - cx) / r, dy = (y + 0.5 - 28.5) / (r * 0.42);
      const q = dx * dx + dy * dy + (hash2(x, y, 11) - 0.5) * 0.35;
      if (q <= 1) under(pc, x, y, q < 0.35 ? cols[2] : q < 0.7 ? cols[1] : cols[0], 230);
    }
}

/** Iskry (wczesne etapy) i dym (późne) nad wrakiem maszyny. */
function wreckFx(pc: PixelCanvas, d: number, cy: number): void {
  if (d <= 4) for (let k = 0; k < 5; k++) {
    const x = 5 + Math.floor(hash2(k, d, 31) * 14), y = cy - 4 + Math.floor(hash2(k, d, 37) * 9);
    pc.set(x, y, k % 2 ? 0xfff6c0 : 0xffc040);
    if (k === 0) { pc.set(x + 1, y, 0xffffff, 200); pc.set(x, y - 1, 0xffd060, 160); }
  }
  if (d >= 3) for (let k = 0; k < 2 + (d >> 1); k++) {
    const x = 9 + Math.floor(hash2(k, 7, d) * 7), y = cy - 6 - k * 3 - (d - 3);
    pc.set(x, y, 0x8a8a8a, 120); pc.set(x + 1, y, 0x7a7a7a, 95); pc.set(x, y - 1, 0x9a9a9a, 75);
  }
}

/**
 * Arkusz klatek bestii. `species` (opcjonalnie: gatunek albo templateId, np. 'scorpion', 'kretowij', 'wolf')
 * wybiera dedykowanego malarza; bez niego decyduje kształt (jak dotąd).
 * Śmierć: ssaki kładą się na boku (malarz), owady i kretowij przewracają się na grzbiet, dron spada i rozbija się,
 * wieżyczka gaśnie z opadniętą lufą, rój opada na ziemię.
 */
export function paintCreatureSheet(shape: EnemyShape, skinColor: RGB, accentColor: RGB, species?: string): UnitSheet {
  const skin = ramp(skinColor, 5, 0.4), accent = ramp(accentColor, 5, 0.4);
  const sp = species ? ((species in SPECIES ? species : creatureSpecies(species)) as CreatureSpecies | undefined) : undefined;
  const paint = (sp && SPECIES[sp]) || PAINTERS[shape] || quad;
  const big = shape === 'big';
  const ichor: readonly [RGB, RGB, RGB] = [mix(accentColor, 0x1a2a0a, 0.75), mix(accentColor, 0x2a4a10, 0.6), mix(accentColor, 0x4a6a1a, 0.45)];
  return buildUnitSheet(
    (pc, front, pose) => {
      const d = pose.die;
      if (d >= 1 && ROLLS.has(paint)) {
        // przewrót na grzbiet: obrót wokół środka ciała, potem osadzenie na ziemi
        const tmp = new PixelCanvas(pc.w, pc.h), rot = new PixelCanvas(pc.w, pc.h);
        paint(tmp, skin, accent, front, { ...pose, anim: 'die', attack: false, lunge: 0, stride: d >= 4 ? 1 : 0, bob: 0 }, big);
        const ang = [0, -40, -110, -180, -180, -180, -180][d];
        blitRotated(rot, tmp, ang, 12, GY - 5, 0, 0);
        const [, y1] = rowsOf(rot);
        const dy = (d === 2 ? GY - 3 : GY) - y1;
        for (let y = 0; y < pc.h; y++) for (let x = 0; x < pc.w; x++) { const c = rot.get(x, y); if (c >= 0) pc.set(x, y + dy, c); }
        return;
      }
      if (d >= 1 && paint === drone) {
        const tmp = new PixelCanvas(pc.w, pc.h);
        paint(tmp, skin, accent, front, { ...pose, bob: 0 }, big);
        blitRotated(pc, tmp, [0, 12, 30, 62, 70, 70, 70][d], 12, 14, [0, 0, 1, 1, 1, 1, 1][d], [0, 3, 7, 10, 11, 11, 11][d]);
        return;
      }
      paint(pc, skin, accent, front, pose, big);
    },
    (pc, _front, pose) => {
      const d = pose.die;
      if (d < 0) return;
      if (MACHINES.has(paint)) {
        wreckFx(pc, d, paint === drone ? [14, 17, 21, 24, 25, 25, 25][d] : GY - 12);
        if (d >= 5) pool(pc, 12, d === 5 ? 3 : 4.5, [0x101014, 0x18181e, 0x2a2a44]);
        return;
      }
      if (paint === swarm) { if (d >= 5) pool(pc, 12, d === 5 ? 2 : 3, ichor); return; }
      if (d >= 5) pool(pc, 11, (d === 5 ? 3 : 5) * (big ? 1.2 : 1), ROLLS.has(paint) && paint !== mole ? ichor : [0x3a0808, 0x5a0e0c, 0x7a1812]);
    },
    BASE_ANIMS,
  );
}
