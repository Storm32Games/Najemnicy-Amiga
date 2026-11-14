// hero.js — procedural pixel-art humanoids (mercenaries, raiders, mutant, robot, boss Kostucha).
// v3 (2026-11-13): skeleton-posed 3/4 view figures, hand-timed key poses with in-betweens.
//   Frame 96x96 px, ground row 90, a standing character is ~62 px tall (texel density unchanged: hpx 62 = 1.7 units).
// Rendering model (raster.js): every primitive (tapered capsule / ellipse / polygon) writes a material ramp id +
//   shade index (light from the upper left) + group id (draw order); blit() resolves colours and selective outlines.
// Skeleton: hip point + torso angle (ta) define a torso-local frame TP(u, v) (u = across, + toward the facing side,
//   v = down the spine from the neck). All torso decoration is placed in that frame, so poses can bend and even lie
//   down (death) without a rotated bitmap. Limbs use 2-bone IK to foot / hand targets. The head is drawn upright in
//   its own sub-raster and stamped (rotated with nearest sampling only when the tilt is large).
// View: 3/4 front, facing +x. The near arm (character's right) is drawn in front of the body and holds the weapon
//   grip / trigger; the far arm is behind the torso, its hand is drawn over the weapon when it supports it.
// Sheet contract: {canvas, info:{anim:{row,n}}, anims:{anim:{n,dur,durs?,seq?,loop?,hold?}}, fw, fh, gy, hpx, cols, rows}
//   durs = per-step durations; seq = optional frame order (steps index into the row's n frames).
import { mkCanvas, shade, mix, clamp } from './util.js';
import { isGun } from './look.js';
import { Raster, D2R } from './raster.js';

export const HFW = 96, HFH = 96, HGY = 90, HPX = 62;
const CX = 46, GY = HGY;
const TIMING = {
  idle: { n: 9, seq: [0, 1, 2, 3, 4, 5, 6, 7, 0, 1, 2, 3, 4, 8, 6, 7], durs: [0.24, 0.16, 0.16, 0.24, 0.24, 0.16, 0.16, 0.24, 0.24, 0.16, 0.16, 0.24, 0.24, 0.16, 0.16, 0.24], loop: true },
  walk: { n: 8, durs: [0.075, 0.075, 0.075, 0.075, 0.075, 0.075, 0.075, 0.075], loop: true },
  attack: { n: 7, durs: [0.05, 0.07, 0.035, 0.065, 0.06, 0.06, 0.06] },        // impact frame 3 starts at 0.155 s
  shoot: { n: 6, durs: [0.04, 0.045, 0.05, 0.05, 0.06, 0.07] },               // muzzle flash frame 2 at 0.085 s
  hurt: { n: 4, durs: [0.05, 0.07, 0.07, 0.07] },
  die: { n: 8, durs: [0.06, 0.07, 0.08, 0.07, 0.06, 0.07, 0.09, 0.1], hold: true },
  cast: { n: 6, durs: [0.06, 0.06, 0.07, 0.07, 0.07, 0.07] },
};
export const HANIMS = {};
for (const [k, v] of Object.entries(TIMING)) HANIMS[k] = { ...v, dur: v.durs.reduce((a, b) => a + b, 0) / v.durs.length };
export const HANIM_ORDER = ['idle', 'walk', 'attack', 'shoot', 'hurt', 'die', 'cast'];

const lerp = (a, b, t) => a + (b - a) * t;

// ---------------------------------------------------------------- weapons
// local coords: a = along the weapon from the grip (+ = toward muzzle / striking end), o = across (+ = below the barrel
// when the weapon points right; the leading edge of a swing). parts: ['c', a0,o0, a1,o1, r0,r1, col, tag?] capsule,
// ['p', [[a,o]...], col] polygon, ['px', a,o, col, shade], ['l', a0,o0, a1,o1, col, shade]
const MET = '#6e7880', MET_D = '#3a4148', POLY = '#2e3236', WOOD = '#8a5430', WOOD_D = '#5a3420', STEEL = '#c4ccd0', BRASS = '#c8a048';
function weaponSpec(kind) {
  switch (kind) {
    case 'rifle': return { tip: 24.5, two: 12, port: [4, -2], stock: -11, parts: [
      ['p', [[-11.5, -0.4], [-1, -1.4], [-1, 1.6], [-10, 3.6], [-11.8, 3.2]], WOOD],
      ['c', -1, 0, 9, 0, 1.9, 1.9, MET_D], ['c', 1, 1.6, 0, 4.4, 1.1, 1.0, POLY],
      ['c', 5, 2, 6, 5.6, 1.3, 1.3, MET_D], ['c', 6, 5.6, 8, 7.6, 1.3, 1.1, MET_D],
      ['c', 9, 0.3, 15, 0.3, 1.6, 1.5, WOOD], ['c', 9, -1.9, 16, -1.9, 0.7, 0.7, MET],
      ['c', 15, 0, 23, 0, 0.8, 0.8, MET], ['c', 22.5, 0, 24.5, 0, 1.0, 1.0, MET_D], ['px', 21.5, -1.9, MET, 3], ['px', 2, -2.2, MET, 3]] };
    case 'longgun': return { tip: 30.5, two: 13, port: [3, -2], stock: -12, parts: [
      ['p', [[-12.5, -0.6], [-1, -1.3], [-1, 1.5], [-6, 2.2], [-11, 3.8], [-12.8, 3.4]], WOOD_D],
      ['c', -1, 0, 7, 0, 1.7, 1.7, '#3e463a'], ['c', 1, 1.6, 0, 4.2, 1.0, 1.0, WOOD_D],
      ['c', 7, 0.4, 17, 0.4, 1.5, 1.2, WOOD_D], ['c', 16, 0, 30, 0, 0.8, 0.7, MET],
      ['c', 0, -3.6, 9, -3.6, 1.35, 1.35, '#22282c'], ['c', -0.5, -3.6, 0.5, -3.6, 1.7, 1.7, '#22282c'], ['c', 8.5, -3.6, 9.5, -3.6, 1.7, 1.7, '#22282c'],
      ['l', 3, -2, 3, -1.4, MET_D, 1], ['l', 6, -2, 6, -1.4, MET_D, 1], ['px', 9.6, -3.8, '#9ad8ff', 4], ['px', 29.5, -1.2, MET, 3]] };
    case 'shotgun': return { tip: 25, two: 12, port: [3, -2], stock: -11, shells: '#c43d2f', parts: [
      ['p', [[-11, -0.6], [-1, -1.4], [-1, 1.6], [-9, 4.0], [-11.4, 3.6]], WOOD_D],
      ['c', -1, 0, 7, 0, 1.9, 1.9, MET_D], ['c', 1, 1.6, 0, 4.4, 1.1, 1.0, WOOD_D],
      ['c', 7, -0.4, 25, -0.4, 1.0, 1.0, MET], ['c', 7, 1.4, 21, 1.4, 0.9, 0.9, MET_D],
      ['c', 10, 1.5, 15, 1.5, 1.7, 1.7, WOOD, 'pump'], ['c', 24, -0.4, 25.2, -0.4, 1.2, 1.2, MET_D], ['px', 23.5, -1.8, STEEL, 4]] };
    case 'smg': return { tip: 16.5, two: 8, port: [3, -2], stock: -6, parts: [
      ['l', -6, -0.6, -1, -0.6, MET, 2], ['l', -6, 2, -1, 1.2, MET, 1], ['l', -6, -0.6, -6, 2, MET, 2],
      ['c', -1, 0, 9, 0, 1.9, 1.9, '#4a5258'], ['c', 1, 1.6, 0.4, 4.4, 1.0, 1.0, POLY],
      ['c', 4.5, 2, 5, 8, 1.1, 1.0, POLY], ['c', 9, 0, 13, 0, 1.2, 1.2, MET_D], ['c', 13, 0, 16.5, 0, 0.8, 0.8, MET], ['px', 7.5, -2.1, MET, 3]] };
    case 'pistol': return { tip: 10.5, port: [3, -1.5], pistol: true, parts: [
      ['c', -1.5, -1.8, 10, -1.8, 1.55, 1.4, '#4a5258'], ['c', 7, -0.6, 10, -0.6, 0.8, 0.8, MET_D], ['p', [[-1.8, -0.8], [1.6, -0.8], [1.2, 3.6], [-1.2, 3.8]], WOOD_D],
      ['px', 0.8, 0.4, MET_D, 1], ['px', 9.8, -3.0, STEEL, 4], ['px', 5, -3.0, STEEL, 4], ['px', 2, -3.0, '#8a949c', 3]] };
    case 'laser': return { tip: 21, two: 10, laser: true, stock: -7, parts: [
      ['p', [[-7.5, -1], [-1, -1.6], [-1, 1.6], [-7, 3.2]], '#d8d2c0'], ['c', -1, 0, 13, 0, 2.0, 1.7, '#e8e4d8'], ['c', 1, 1.6, 0, 4.4, 1.1, 1.0, POLY],
      ['c', 13, 0, 18, 0, 1.0, 1.0, MET_D], ['c', 17.5, 0, 21, 0, 1.3, 0.9, '#2a8a78'], ['c', 4, -2.3, 10, -2.3, 0.9, 0.9, '#2a8a78'],
      ['px', 6, -2.4, '#8affea', 4], ['px', 8, -2.4, '#8affea', 4], ['px', 15, -1.1, '#46f2c8', 4], ['px', 20.5, 0, '#c8fff4', 4]] };
    case 'flamer': return { tip: 21, two: 10, stock: -6, flamer: true, parts: [
      ['c', -6, 0, 0, 0, 1.6, 1.6, POLY], ['c', 0, 0, 12, 0, 1.8, 1.8, '#8a3a24'], ['c', 1, 1.6, 0, 4.4, 1.1, 1.0, POLY],
      ['c', 2, 3, 8, 3, 1.8, 1.8, BRASS], ['c', 12, 0, 19.5, 0, 1.0, 1.2, MET], ['c', 19, 0, 21, 0, 1.5, 1.5, MET_D]] };
    case 'bow': return { tip: 4, bow: true, parts: [] };
    case 'knife': return { tip: 11, parts: [['c', -3.5, 0, 0.5, 0, 1.3, 1.3, WOOD_D], ['l', 1, -2.2, 1, 2.2, MET_D, 2], ['p', [[1.5, -1.2], [8, -1.2], [11.4, 0.2], [1.5, 1.4]], STEEL], ['l', 2, -0.6, 8, -0.6, '#eef4f6', 4]] };
    case 'machete': return { tip: 19, parts: [['c', -3.5, 0, 0.5, 0, 1.3, 1.3, WOOD_D], ['l', 1, -2, 1, 2, MET_D, 2], ['p', [[1.5, -1.4], [14, -1.6], [18, -0.6], [19.4, 1.2], [17, 2.8], [1.5, 1.8]], STEEL], ['l', 2, -1, 15, -1.1, '#eef4f6', 4], ['l', 6, 1.2, 12, 1.4, '#7a8288', 1]] };
    case 'sledge': return { tip: 22, two: 8, heavy: true, parts: [['c', -6, 0, 19, 0, 1.1, 1.1, WOOD], ['c', -6, 0, -3, 0, 1.4, 1.4, WOOD_D],
      ['p', [[17.6, -5.6], [22.4, -5.6], [23, -5], [23, 5], [22.4, 5.6], [17.6, 5.6], [17, 5], [17, -5]], '#525a62'], ['l', 17.6, -5, 17.6, 5, '#8a949c', 3], ['l', 18, -5.2, 22.4, -5.2, '#c8d0d6', 4], ['l', 18, 5.2, 22.4, 5.2, '#262a30', 0], ['c', 16, 0, 17.2, 0, 1.6, 1.6, MET_D]] };
    case 'axe': return { tip: 21, two: 8, heavy: true, parts: [['c', -6, 0, 20, 0, 1.1, 1.0, WOOD], ['c', -6, 0, -3, 0, 1.3, 1.3, WOOD_D],
      ['p', [[15, 0.4], [20.4, 0.4], [22.6, 4.4], [21.6, 7.4], [18.4, 6.2], [15.6, 3.6]], STEEL], ['l', 21.8, 4.6, 21.2, 7, '#f4f8fa', 4], ['p', [[16, -0.4], [19.6, -0.4], [18.8, -2.4], [16.8, -2.4]], MET_D]] };
    case 'pipe': return { tip: 19, parts: [['c', -4, 0, 19, 0, 1.3, 1.5, '#8a5a3a'], ['c', -4, 0, 1, 0, 1.5, 1.5, '#3a2a20'], ['c', 13, 0, 19, 0, 1.9, 1.9, '#7a6a5a']], nails: true };
    case 'scythe': return { tip: 30, two: -10, scythe: true, parts: [['c', -30, 0, 29, 0, 1.15, 1.15, '#3a2418'], ['c', 24, 0, 28, 0, 1.6, 1.6, MET_D], ['c', -2, 0, 2, 0, 1.5, 1.5, '#5a1410']] };
    default: return null;
  }
}
function drawWeapon(R, W, gx, gy, ang, o = {}) {
  const c = Math.cos(ang * D2R), s = Math.sin(ang * D2R);
  const T = (a, off) => [gx + a * c - off * s, gy + a * s + off * c];
  R.group();
  if (W.bow) {
    for (let k = -11; k <= 11; k++) { const a = 4.5 - (k * k) / 26 + (o.draw || 0) * 0, [x, y] = T(a, k); R.cap(x, y, x, y, 1.1, 1.1, WOOD); }
    const pull = o.draw || 0, [x0, y0] = T(-0.3, -11), [x1, y1] = T(-0.3, 11), [xm, ym] = T(-pull, 0);
    R.line(x0, y0, xm, ym, '#e6dcc0', 3); R.line(xm, ym, x1, y1, '#e6dcc0', 3);
    return { T, tip: T(4, 0) };
  }
  for (const p of W.parts) {
    if (p[0] === 'c') { let [, a0, o0, a1, o1, r0, r1, col, tag] = p; if (tag === 'pump') { a0 += o.pump || 0; a1 += o.pump || 0; } const A = T(a0, o0), B = T(a1, o1); R.cap(A[0], A[1], B[0], B[1], r0, r1, col, { flat: 0.35 }); }
    else if (p[0] === 'p') R.poly(p[1].map(([a, off]) => T(a, off)), p[2], { flat: true });
    else if (p[0] === 'px') { const [x, y] = T(p[1], p[2]); R.px(x, y, p[3], p[4]); }
    else if (p[0] === 'l') { const A = T(p[1], p[2]), B = T(p[3], p[4]); R.line(A[0], A[1], B[0], B[1], p[5], p[6]); }
  }
  if (W.nails) for (const a of [14, 16, 18]) { const [x, y] = T(a, -2.6); R.px(x, y, '#d8dce0', 4); const [x2, y2] = T(a - 1, 2.6); R.px(x2, y2, '#a8acb0', 3); }
  if (W.flamer) { const [x, y] = T(W.tip + 0.6, 1.4); R.group(true); R.px(x, y, '#ffb040', 4); R.px(x, y - 1, '#fff0a0', 4); }
  if (W.scythe) { // crescent blade at the top end, curving toward the leading edge
    R.group();
    for (let k = 0; k <= 18; k++) { const t = k / 18, a = 28.5 - t * 6 - t * t * 5, off = 1.2 + t * 19, r = 2.5 - t * 2.0; const [x, y] = T(a, off); R.cap(x, y, x, y, r, r, k < 2 ? MET_D : STEEL); }
    for (let k = 3; k <= 17; k += 1) { const t = k / 18, [x, y] = T(28.5 - t * 6 - t * t * 5 - 1.6 + t * 1.2, 1.2 + t * 19); R.px(x, y, '#f4f8fa', 4); }
  }
  return { T, tip: T(W.tip, 0) };
}

// ---------------------------------------------------------------- IK (2 bones): bend = +1 elbow down/back, -1 knee forward
function ik(sx, sy, tx, ty, l1, l2, bend) {
  let dx = tx - sx, dy = ty - sy, d = Math.hypot(dx, dy) || 1e-3; const maxd = l1 + l2 - 0.05;
  if (d > maxd) { tx = sx + dx / d * maxd; ty = sy + dy / d * maxd; dx = tx - sx; dy = ty - sy; d = maxd; }
  const a = Math.atan2(dy, dx), A = Math.acos(clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1)) * bend;
  return { e: [sx + Math.cos(a + A) * l1, sy + Math.sin(a + A) * l1], h: [tx, ty] };
}

// ---------------------------------------------------------------- outfit (from look analysis A)
function outfit(A) {
  const F = { skin: A.skin, hair: A.hair, jacket: A.cloth, accent: A.accent, pants: A.pants, boot: '#3a2a1e', glove: null };
  const role = A.cls || A.role;
  const set = (o) => Object.assign(F, o);
  switch (role) {
    case 'soldier': set({ jacket: '#5d6a3a', vest: '#3e4a2c', pants: '#4a5232', boot: '#2a241c', pouches: '#56603a', kneepads: '#2e3424', glove: '#2a2a24', patch: A.accent, pack: 'mil', rolled: false }); break;
    case 'scout': set({ jacket: '#7a6a4a', cloak: '#8a7448', pants: '#5a4c36', boot: '#4a3622', scarf: '#9a8a62', bandolier: '#5a3a1e', glove: '#4a3424', pack: 'roll' }); break;
    case 'medic': set({ jacket: '#d8d2c0', pants: '#4a4a52', boot: '#2e2a26', armband: '#c43d2f', satchel: '#c8bfa8', glove: '#7ab0c8', coatTail: '#d0cab6', cross: true }); break;
    case 'techie': set({ jacket: '#46687a', pants: '#3a5664', boot: '#2a2420', toolbelt: '#7a5a32', glove: '#c8a048', pack: 'tech', overalls: true }); break;
    case 'scavenger': set({ jacket: '#4a3a2a', cloak: '#3e3024', pants: '#3a3028', boot: '#2a1e14', scarfMask: '#5a4a32', wraps: '#b8aa8a', pouches: '#5a4630', pack: 'sack' }); break;
    case 'brute': set({ jacket: null, harness: '#4a2e1c', pants: '#5a3a2a', boot: '#2a1c12', pad: '#5a5e66', bareArms: true, bareChest: true, belt: '#3a2618', wraps: '#8a7a62' }); break;
    case 'thug': set({ jacket: null, bareArms: true, bareChest: true, harness: '#3a2a20', tireArmor: '#2a2a2c', pants: '#4a3e34', boot: '#2a1e16', pad: '#6a6e76', spikes: true, tattoo: A.accent }); break;
    case 'shooter': set({ jacket: A.cloth, pants: '#3e3a30', boot: '#2a2018', scarfMask: A.accent, bandolier: '#6a4a24', ammo: true, pad: '#5a5e66', rolled: true }); break;
    case 'psycho': set({ jacket: null, bareArms: true, bareChest: true, warpaint: A.accent, pants: '#5a3a30', boot: '#2a1c14', chains: true }); break;
    case 'burner': set({ jacket: '#6a4a2a', pants: '#3a3028', boot: '#2a1e14', pack: 'fuel', apron: '#4a3a2c', glove: '#3a2a1e' }); break;
    case 'chief': set({ jacket: '#2e2a28', coatTail: '#24201e', fur: '#8a7a62', pants: '#3a3430', boot: '#1e1814', sash: A.accent, pad: '#6a6e76', pad2: true, spikes: true }); break;
    case 'kostucha': set({ jacket: '#3a2824', cloak: '#2a1a18', cloakRag: true, hood: '#7a1c14', ribs: '#d8ccb0', pants: '#241a1a', boot: '#140e0e', sash: '#b02018', pad: '#4a4a52', pad2: true, spikes: true, glove: '#1a1414', chains: true, skulls: true }); break;
    case 'boss': set({ jacket: '#3a1612', coatTail: '#2a100c', pants: '#2a2020', boot: '#1a1210', sash: A.accent, pad: '#5a5e66', pad2: true, spikes: true }); break;
    default: set({ jacket: A.cloth, pants: A.pants });
  }
  if (A.mutant) set({ jacket: null, rags: '#4a4238', bareArms: true, bareChest: true, pants: '#3a342c', boot: null, pustules: true, claws: true, pack: null, harness: null, pad: null, spikes: null, tireArmor: null, tattoo: null, chains: A.boss ? true : null });
  if (A.machine) set({ metal: true, jacket: null, pants: null, boot: null });
  if (A.nomad && !A.enemy) set({ scarf: '#c9a468' });
  if (A.cyber) F.cyberArm = true;
  return F;
}

// ---------------------------------------------------------------- poses
function holdOf(A) {
  const w = A.weapon;
  if (['rifle', 'longgun', 'shotgun', 'smg', 'laser', 'flamer'].includes(w)) return 'gun2';
  if (w === 'pistol') return 'pistol';
  if (w === 'bow') return 'bow';
  if (w === 'scythe') return 'scythe';
  if (w === 'sledge' || w === 'axe') return 'heavy';
  if (w === 'knife' || w === 'machete' || w === 'pipe') return 'melee1';
  return 'none';
}
// A pose P: hip offset (hx, hy), torso lean ta (deg, + forward), head tilt ha, feet fN/fF ([x offset from CX, lift]),
// near hand hN ([dx, dy] from near shoulder), weapon angle wA, far hand hF ('two' | 'pistol' | [dx, dy] from far shoulder),
// br (breath px), sec ([x, y] cloth/hair lag), eyes, mouth, effects.
function basePose(A, H) {
  const P = { hx: 0, hy: 0, ta: 0, ha: 0, fN: [-5, 0], fF: [5, 0], hN: [-1, 17], wA: 70, hF: [-1, 16], br: 0, hb: 0, sec: [0, 0], eyes: 'open', mouth: 0, wLayer: 'front' };
  if (A.bw === 'heavy') { P.fN = [-6, 0]; P.fF = [6, 0]; }
  if (A.hunch) { P.ta = 16; P.ha = -14; P.hy = 2; P.hN = [5, 17]; P.hF = [3, 17]; }
  switch (H) {
    case 'gun2': Object.assign(P, { hN: [6, 10], wA: 24, hF: 'two' }); if (A.weapon === 'smg') Object.assign(P, { hN: [6, 9], wA: 30 }); if (A.weapon === 'longgun') Object.assign(P, { hN: [5, 9], wA: 28 }); break;
    case 'pistol': Object.assign(P, { hN: [1, 16], wA: 78 }); break;
    case 'bow': Object.assign(P, { hN: [3, 14], wA: -84 }); break;
    case 'melee1': Object.assign(P, { hN: [1, 16], wA: A.weapon === 'knife' ? -25 : -52 }); break;
    case 'heavy': Object.assign(P, { hN: [3, 5], wA: -150, hF: 'two', wLayer: 'mid' }); break;
    case 'scythe': Object.assign(P, { hN: [8, 8], wA: -97, hF: 'two' }); break;
  }
  return P;
}
const add2 = (a, b) => [a[0] + b[0], a[1] + b[1]];

function pose(anim, i, A) {
  const H = holdOf(A), B = basePose(A, H), P = { ...B, fN: [...B.fN], fF: [...B.fF], hN: [...B.hN], sec: [0, 0] };
  const gun = H === 'gun2' || H === 'pistol';
  switch (anim) {
    case 'idle': {
      const k = i === 8 ? 5 : i;                     // frame 8 = blink copy of frame 5
      const br = [0, 0, 1, 1, 1, 1, 0, 0][k], hb = [0, 0, 0, 1, 1, 1, 1, 0][k], cl = [0, 0, 0, 0, 1, 1, 1, 1][k];
      P.br = br; P.hb = hb; P.sec = [0, cl]; P.hN = add2(P.hN, [0, -br]);
      if (H === 'gun2' || H === 'scythe') P.wA += [0, 0, -1, -1, -1, 0, 0, 0][k] * (H === 'gun2' ? 1 : 0.5);
      if (Array.isArray(P.hF)) P.hF = add2(P.hF, [0, -br]);
      if (i === 8) P.eyes = 'closed';
      break;
    }
    case 'walk': {
      const p = i / 8, S = A.hunch ? 6 : 7.5;
      const foot = (q) => { q = ((q % 1) + 1) % 1; if (q < 0.5) return [S - 2 * S * (q / 0.5), 0]; const t = (q - 0.5) / 0.5; return [-S + 2 * S * (0.5 - 0.5 * Math.cos(Math.PI * t)), -4.2 * Math.sin(Math.PI * Math.pow(t, 0.75))]; };
      const fn = foot(p + 0.5), ff = foot(p);
      P.fN = [fn[0] - 1, fn[1]]; P.fF = [ff[0] + 2, ff[1]];
      P.hy = [1.5, 2.5, 1, 0, 1.5, 2.5, 1, 0][i] + (A.hunch ? 2 : 0); P.ta += A.hunch ? 4 : 4; P.sec = [-1, [0, 1, 1, 0, 0, 1, 1, 0][i]];
      P.hb = [0, 0, 1, 0, 0, 0, 1, 0][i];
      const sw = Math.cos(p * Math.PI * 2);           // +1 when the far foot is forward
      if (H === 'gun2') { P.wA += sw * 2; P.hN = add2(P.hN, [0, [0, 1, 0, 0, 0, 1, 0, 0][i]]); }
      else if (H === 'heavy') { P.wA += sw * 2; }
      else if (H === 'scythe') { P.wA += sw * 3; P.hN = add2(P.hN, [sw * 1.5, 0]); }
      else {
        const aN = sw * 26, aF = -sw * 22;                // near arm swings with the far leg
        P.hN = [Math.sin(aN * D2R) * 15 + 1, Math.cos(aN * D2R) * 15 - 1 - Math.max(0, sw) * 2];
        P.hF = [Math.sin(aF * D2R) * 15, Math.cos(aF * D2R) * 15 - Math.max(0, -sw) * 2];
        if (H === 'pistol' || H === 'melee1' || H === 'bow') P.wA += sw * 18;
      }
      break;
    }
    case 'attack': attackPose(P, B, H, i, A); break;
    case 'shoot': shootPose(P, B, H, i, A); break;
    case 'hurt': {
      const k = [[-14, -2, 0, -12, [-3, -3], -16], [-10, -3, 2, 4, [-2, 0], -8], [-5, -2, 1, 2, [-1, 0], -3], [-2, -1, 0, 0, [0, 0], -1]][i];
      P.ta += k[0]; P.hx = k[1]; P.hy += k[2]; P.ha += k[3]; P.hN = add2(P.hN, k[4]); P.wA += k[5];
      if (i === 1) P.fF = [P.fF[0] - 3, 0];
      P.eyes = i === 0 ? 'wide' : i < 3 ? 'pain' : 'open'; P.mouth = i < 3 ? 2 : 0; P.sec = [[2, -1], [1, 0], [0, 1], [0, 0]][i];
      if (Array.isArray(P.hF)) P.hF = add2(P.hF, [-3, -2]);
      P.hurt = true;
      break;
    }
    case 'die': diePose(P, B, H, i, A); break;
    case 'cast': {
      const far = [[-1, 15], [2, 9], [3, 3], [0, 1], [4, 6], [1, 13]][i];
      P.hF = far; P.item = i; P.ta += [3, 2, 0, -2, -3, 0][i]; P.ha += [10, 6, 2, -4, -6, 0][i];
      if (H === 'gun2') { P.hN = [4, 13]; P.wA = 52; }
      if (H === 'heavy' || H === 'scythe') { P.hN = add2(B.hN, [0, 2]); }
      P.eyes = i === 3 ? 'closed' : 'open'; P.mouth = i === 3 ? 2 : 0;
      P.sec = [0, [0, 0, 0, -1, -1, 0][i]];
      break;
    }
  }
  return P;
}

function attackPose(P, B, H, i, A) {
  // anticipation -> wind-up -> smear -> IMPACT (frame 3) -> follow-through -> recover -> settle
  const step = (k) => { P.fF = [B.fF[0] + k, 0]; };
  if (H === 'gun2' || H === 'flamer') {             // bayonet / muzzle jab
    const f = [[[2, 7], -12, -4, -1], [[-2, 6], -22, -8, -2], [[9, 3], -6, 6, 2], [[14, 2], -2, 12, 4], [[13, 3], 2, 10, 3], [[9, 7], 12, 5, 1], [[7, 9], 20, 2, 0]][i];
    P.hN = f[0]; P.wA = f[1]; P.ta += f[2]; P.hx = f[3]; P.hF = 'two'; step([0, 0, 3, 5, 5, 3, 1][i]); P.hy += [1, 1, 0, 2, 2, 1, 0][i];
    if (i === 3) P.spark = 'tip';
    if (i === 2) P.smear = 'thrust';
  } else if (H === 'pistol') {                     // pistol whip
    const f = [[[0, 4], -60, -4, -1], [[-3, -2], -110, -8, -2], [[9, 0], -40, 6, 2], [[13, 8], 30, 13, 4], [[11, 11], 55, 10, 3], [[7, 12], 70, 5, 1], [[4, 14], 76, 2, 0]][i];
    P.hN = f[0]; P.wA = f[1]; P.ta += f[2]; P.hx = f[3]; step([0, 0, 3, 5, 5, 3, 1][i]); P.hy += [1, 0, 0, 2, 2, 1, 0][i];
    if (i === 2) P.smear = [-110, 30]; if (i === 3) P.spark = 'tip';
    P.hF = [[-2, 14], [2, 12], [-6, 12], [-8, 10], [-7, 12], [-4, 14], [-2, 15]][i];
  } else if (H === 'none') {                        // haymaker / claw swipe with the near arm
    const f = [[[-3, 9], -6, -1], [[-8, 4], -10, -2], [[8, 0], 6, 2], [[17, 3], 14, 4], [[15, 6], 11, 3], [[8, 11], 5, 1], [[3, 15], 2, 0]][i];
    P.hN = f[0]; P.ta += f[1]; P.hx = f[2]; step([0, 0, 3, 5, 5, 3, 1][i]); P.hy += [1, 1, 0, 2, 2, 1, 0][i];
    P.hF = [[2, 12], [6, 10], [-4, 14], [-6, 12], [-5, 13], [-2, 15], [-1, 16]][i];
    if (i === 2) P.smear = [-150, 10]; if (i === 3) P.spark = 'hand';
    P.mouth = i >= 2 && i <= 4 ? 2 : 0;
  } else {                                            // overhead diagonal slash (melee1 / heavy / scythe / bow)
    const heavy = H === 'heavy' || H === 'scythe';
    const f = heavy
      ? [[[1, -3], -150, -6, -1, 1], [[-3, -9], -172, -12, -2, 0], [[9, -4], -70, 6, 2, 0], [[13, 9], 32, 18, 4, 3], [[11, 12], 56, 15, 4, 3], [[8, 10], 20, 7, 2, 1], [[6, 8], -60, 2, 1, 0]][i]
      : [[[0, -2], -140, -5, -1, 1], [[-3, -8], -165, -10, -2, 0], [[9, -4], -60, 6, 2, 0], [[13, 7], 28, 15, 4, 2], [[11, 11], 52, 12, 4, 2], [[7, 12], 10, 6, 2, 1], [[4, 14], -40, 2, 1, 0]][i];
    P.hN = f[0]; P.wA = f[1]; P.ta += f[2]; P.hx = f[3]; P.hy += f[4]; step([0, -1, 3, 6, 6, 3, 1][i]);
    if (i === 1) P.fF = [B.fF[0] - 1, -2];
    P.hF = heavy ? 'two' : [[-3, 13], [3, 10], [-5, 12], [-8, 9], [-7, 11], [-4, 13], [-2, 15]][i];
    P.wLayer = i <= 1 ? 'mid' : 'front';
    if (i === 2) P.smear = [f[1] - 100, f[1] + 70];
    if (i === 3) P.spark = 'tip';
    P.mouth = i >= 2 && i <= 4 ? 2 : 0;
    if (H === 'scythe' && i >= 2 && i <= 4) P.wLayer = 'front';
  }
  P.sec = [[1, 0], [2, -1], [-2, 0], [-3, 1], [-2, 1], [-1, 0], [0, 0]][i];
}

function shootPose(P, B, H, i, A) {
  if (H === 'gun2') {
    const kick = A.weapon === 'shotgun' ? 1.6 : A.weapon === 'longgun' ? 1.3 : A.weapon === 'flamer' || A.weapon === 'laser' ? 0.4 : 1;
    const f = [[[5, 7], 10, 2, 0], [[5, 4], 0, 3, 0], [[4, 4], -3 * kick, 3, 0], [[2.5, 3.5], -9 * kick, -2 * kick, -1], [[4, 4], -3 * kick, 1, 0], [[5, 5], 1, 2, 0]][i];
    P.hN = f[0]; P.wA = f[1]; P.ta += f[2]; P.hx = f[3]; P.hF = 'two'; P.ha += 8;
    P.fN = [B.fN[0] - 1, 0]; P.fF = [B.fF[0] + 2, 0];
    if (A.weapon === 'flamer') { P.flame = [0, 0, 12, 22, 18, 6][i]; }
    else { P.flash = i === 2; P.smoke = i === 3 ? 1 : i === 4 ? 2 : i === 5 ? 3 : 0; if (!A.weapon.includes('laser')) P.casing = i === 3 ? 1 : i === 4 ? 2 : 0; }
    if (A.weapon === 'shotgun') P.pump = [0, 0, 0, 0, -4, -1][i];
    if (A.weapon === 'laser') P.beam = i === 2 || i === 3;
    P.eyes = i === 2 || i === 3 ? 'squint' : 'open';
  } else if (H === 'pistol') {
    const f = [[[9, 7], 30, 2, 0], [[14, 2], 0, 3, 0], [[13, 1.5], -6, 3, 0], [[11, 0], -18, -2, -1], [[13, 1], -6, 1, 0], [[14, 2], 0, 2, 0]][i];
    P.hN = f[0]; P.wA = f[1]; P.ta += f[2]; P.hx = f[3]; P.hF = 'pistol'; P.ha += 4;
    P.fN = [B.fN[0] - 1, 0]; P.fF = [B.fF[0] + 2, 0];
    P.flash = i === 2; P.smoke = i === 3 ? 1 : i === 4 ? 2 : i === 5 ? 3 : 0; P.casing = i === 3 ? 1 : i === 4 ? 2 : 0; P.eyes = i === 2 || i === 3 ? 'squint' : 'open';
  } else if (H === 'bow') {
    P.hN = [14, 1]; P.wA = 0; P.hF = [[6, 0], [-2, -1], [-3, -1], [8, 2], [6, 4], [2, 10]][i]; P.draw = [3, 6, 0, 0, 0, 0][i]; P.arrow = i < 2; P.ta += 2; P.ha += 4;
  } else {                                          // grenade throw with the far hand (the weapon stays in the near hand)
    const f = [[[-2, 8], 0, 0], [[-8, -6], -8, -2], [[4, -10], 4, 1], [[12, -2], 12, 3], [[10, 5], 8, 2], [[3, 12], 3, 1]][i];
    P.hF = f[0]; P.ta += f[1]; P.hx = f[2]; P.throwObj = i <= 2 ? 'hand' : i === 3 ? 'fly' : null;
    P.fF = [B.fF[0] + [0, -1, 3, 5, 5, 2][i], 0]; P.hy += [1, 0, 0, 2, 1, 0][i];
    if (i === 1) P.fF = [B.fF[0] - 1, -2];
    P.mouth = i === 3 ? 2 : 0;
    P.hN = add2(B.hN, [[-1, 1], [1, 0], [-2, 1], [-3, 2], [-2, 1], [0, 0]][i][0] === 0 ? [0, 0] : [[-1, 1], [1, 0], [-2, 1], [-3, 2], [-2, 1], [0, 0]][i]);
  }
  P.sec = [[0, 0], [0, 0], [1, 0], [2, 0], [1, 1], [0, 0]][i];
}

function diePose(P, B, H, i, A) {
  // hit -> stagger -> knees buckle -> sit/fall back -> back hits ground -> bounce -> settle (lying on the back, head left)
  P.hurt = true; P.dead = i >= 5;
  const keys = [
    { ta: -15, hx: -2, hy: 0, ha: -12, fN: [B.fN[0], 0], fF: [B.fF[0], 0], hN: add2(B.hN, [-3, -3]), wA: B.wA - 18, hF: B.hF, eyes: 'wide', mouth: 2 },
    { ta: -20, hx: -4, hy: 2, ha: -6, fN: [B.fN[0] - 2, 0], fF: [B.fF[0] + 1, -2], hN: add2(B.hN, [-4, 2]), wA: B.wA + 35, hF: [-5, 12], eyes: 'pain', mouth: 2 },
    { ta: -10, hx: -3, hy: 8, ha: 14, fN: [-4, 0], fF: [6, 0], hN: [2, 17], wA: null, hF: [0, 17], eyes: 'closed', mouth: 1, drop: [14, -14, 70, 1] },
    { ta: -40, hx: -6, hy: 19, ha: 18, fN: [10, 0], fF: [7, 0], hN: [7, 6], wA: null, hF: [6, 6], eyes: 'closed', mouth: 1, drop: [18, -2, 10, 0] },
    { ta: -76, hx: -7, hy: 21, ha: 28, fN: [14, -1], fF: [12, 0], hN: [8, 1], wA: null, hF: [7, 0], eyes: 'closed', mouth: 1, drop: [19, -1, 4, 0] },
    { ta: -86, hx: -7, hy: 20, ha: 6, fN: [12, 0], fF: [17, 0], hN: [6, 2], wA: null, hF: [8, -1], eyes: 'closed', mouth: 1, drop: [19, -1, 4, 0] },
    { ta: -90, hx: -7, hy: 21, ha: -36, fN: [13, 0], fF: [20, 0], hN: [-4, 4], wA: null, hF: [8, -2], eyes: 'closed', mouth: 0, drop: [19, -1, 4, 0], pool: 1 },
    { ta: -90, hx: -7, hy: 21, ha: -36, fN: [13, 0], fF: [20, 0], hN: [-4, 4], wA: null, hF: [8, -2], eyes: 'closed', mouth: 0, drop: [19, -1, 4, 0], pool: 2 },
  ];
  const k = keys[i];
  Object.assign(P, k, { ta: k.ta + (A.hunch && i < 3 ? 10 : 0), fN: [...k.fN], fF: [...k.fF], hN: [...k.hN] });
  if (i >= 4) { P.hy = 21 + (A.bw === 'heavy' ? -1 : 0); }
  if (k.wA == null) P.wA = 80;
  P.sec = [[2, -1], [3, 0], [1, -2], [3, -2], [0, -1], [-1, 0], [0, 0], [0, 0]][i];
  if (P.drop && A.weapon === 'none') P.drop = null;
  if (i >= 2) P.hF = k.hF;
  if (i >= 3) P.lying = true;
}

// ---------------------------------------------------------------- figure
function drawFigure(R, A, P) {
  const F = outfit(A), H = holdOf(A), fx = new FX();
  const big = A.bw === 'heavy' ? 1.16 : A.bw === 'light' ? 0.9 : 1;
  const TL = 19, thigh = 13, shin = 12.2, upper = 10, fore = 9.6;
  const skinC = A.machine ? '#7a848c' : F.skin;
  // ---- skeleton
  const hip = [Math.round(CX + P.hx), Math.round(GY - 27.6 + P.hy)];
  const ta = P.ta * D2R, up = [Math.sin(ta), -Math.cos(ta)], nv = [Math.cos(ta), Math.sin(ta)];
  const neck = [Math.round(hip[0] + up[0] * (TL + P.br * 0.4)), Math.round(hip[1] + up[1] * (TL + P.br * 0.4))];
  if (P.br && Math.abs(P.ta) < 20) neck[1] = hip[1] - TL - P.br;
  const TP = (u, v) => [neck[0] - up[0] * v + nv[0] * u, neck[1] - up[1] * v + nv[1] * u];
  const TLc = (x, y) => { const dx = x + 0.5 - neck[0], dy = y + 0.5 - neck[1]; return [dx * nv[0] + dy * nv[1], -(dx * up[0] + dy * up[1])]; };
  const shN = TP(-4.0 * big, 3.2), shF = TP(3.6 * big, 3.0);
  const hipN = TP(-2.2 * big, TL - 0.5), hipF = TP(2.0 * big, TL - 0.8);
  const legCol = F.pants || (A.machine ? '#5a646c' : skinC), bootCol = F.boot;
  const sleeve = F.jacket || F.rags || (A.machine ? '#6a747c' : skinC);
  const W = weaponSpec(A.weapon);
  const armed = W && A.weapon !== 'none' && !P.drop && !(P.lying);

  // ---- hand targets
  const gripAbs = add2(shN, P.hN);
  if (gripAbs[1] > GY - 2) gripAbs[1] = GY - 2;
  let farTarget, farOnWeapon = false;
  const wc = Math.cos(P.wA * D2R), ws = Math.sin(P.wA * D2R);
  if (P.hF === 'two' && armed && W.two != null) { farTarget = [gripAbs[0] + W.two * wc - (W.heavy || W.scythe ? 0 : -0.8) * ws, gripAbs[1] + W.two * ws]; farOnWeapon = true; if (Math.hypot(farTarget[0] - shF[0], farTarget[1] - shF[1]) > upper + fore + 1.5) { farOnWeapon = false; farTarget = add2(shF, [-1, 16]); } }
  else if (P.hF === 'pistol') { farTarget = [gripAbs[0] - 1.2, gripAbs[1] + 1.6]; farOnWeapon = true; }
  else if (Array.isArray(P.hF)) farTarget = add2(shF, P.hF);
  else farTarget = add2(shF, [-1, 16]);
  if (farTarget[1] > GY - 2) farTarget[1] = GY - 2;

  // ---- ground decals (blood pool) first
  if (P.pool) {
    R.group(true); const pc = ['#5a0e0c', '#7a1612', '#9a2018'], px0 = hip[0] - 14, rx = 7 + P.pool * 4, ry = 1.6 + P.pool * 0.7, cy = GY - 1;
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) for (let x = Math.floor(px0 - rx); x <= Math.ceil(px0 + rx); x++) { const u = (x + 0.5 - px0) / rx, v = (y + 0.5 - cy) / ry, d = u * u + v * v; if (d > 1) continue; R.px(x, y, d < 0.25 && u < 0 && v < 0 ? pc[2] : d < 0.7 ? pc[1] : pc[0], 2); }
  }
  // dropped weapon lies behind the body
  if (P.drop && W && P.drop[3] === 0) drawWeapon(R, W, CX + P.drop[0], GY + P.drop[1] - (W.heavy ? 1 : 2), P.drop[2]);

  // ---- arm / leg helpers
  const arm = (sh, target, near, onWeapon) => {
    const r = ik(sh[0], sh[1], target[0], target[1], upper, fore, 1);
    const bias = near ? 0 : -0.16;
    const isMetal = A.machine || (F.cyberArm && near);
    const c1 = isMetal ? '#8a949c' : (F.bareArms ? skinC : sleeve), c2 = isMetal ? '#8a949c' : (F.bareArms || F.rolled ? skinC : sleeve);
    R.group();
    R.cap(sh[0], sh[1], r.e[0], r.e[1], 3.4 * big, 2.8 * big, c1, { bias });
    if (F.bareArms && !isMetal) R.ell((sh[0] * 0.55 + r.e[0] * 0.45), (sh[1] * 0.55 + r.e[1] * 0.45) - 0.4, 2.4 * big, 2.0 * big, skinC, { bias: bias + 0.06, rot: Math.atan2(r.e[1] - sh[1], r.e[0] - sh[0]) / D2R });
    R.cap(r.e[0], r.e[1], r.h[0], r.h[1], 2.8 * big, 2.2 * big, c2, { bias });
    if (isMetal) { R.ell(r.e[0], r.e[1], 1.9, 1.9, '#3a4248', { bias }); R.px(r.e[0], r.e[1] - 0.5, '#ff4a3a', 4); }
    if (F.rolled && !isMetal) { const k = 0.18, x = r.e[0] + (r.h[0] - r.e[0]) * k, y = r.e[1] + (r.h[1] - r.e[1]) * k; R.cap(r.e[0], r.e[1], x, y, 3.0 * big, 2.9 * big, sleeve, { bias }); }
    if (F.wraps && near && !isMetal) for (let k = 0.45; k < 0.95; k += 0.22) { const x = r.e[0] + (r.h[0] - r.e[0]) * k, y = r.e[1] + (r.h[1] - r.e[1]) * k; R.cap(x - 1.3, y - 0.3, x + 1.3, y + 0.3, 1.0, 1.0, F.wraps, { bias }); }
    if (F.tattoo && near && F.bareArms) { const x = (sh[0] + r.e[0]) / 2, y = (sh[1] + r.e[1]) / 2; R.px(x, y, F.tattoo, 1); R.px(x + 1, y + 1, F.tattoo, 1); R.px(x, y + 2, F.tattoo, 1); }
    if (F.armband && near) { const x = sh[0] + (r.e[0] - sh[0]) * 0.45, y = sh[1] + (r.e[1] - sh[1]) * 0.45; R.cap(x - 1.8, y - 0.8, x + 1.8, y + 0.8, 1.4, 1.4, F.armband); R.px(x, y, '#ffffff', 4); }
    const handCol = isMetal ? '#5a646c' : F.glove || skinC;
    const drawHand = () => { R.group(); R.ell(r.h[0], r.h[1], 2.2 * big, 2.0 * big, handCol, { bias }); if (F.claws && !onWeapon) { R.line(r.h[0] + 1, r.h[1] + 1.5, r.h[0] + 2.5, r.h[1] + 3.5, '#e6dcc0', 3); R.line(r.h[0] - 0.5, r.h[1] + 2, r.h[0] + 0.5, r.h[1] + 4, '#e6dcc0', 3); } };
    if (!onWeapon) drawHand();
    return { r, drawHand };
  };
  const leg = (hp, foot, near) => {
    const bias = near ? 0 : -0.14;
    let tx = foot[0], ty = foot[1];
    const r = ik(hp[0], hp[1], tx, ty, thigh, shin, -1);
    const kx = r.e[0], ky = r.e[1]; let ax = r.h[0], ay = r.h[1];
    R.group();
    R.cap(hp[0], hp[1], kx, ky, 4.0 * big, 3.3 * big, legCol, { bias });
    R.cap(kx, ky, ax, ay, 3.2 * big, 2.5 * big, legCol, { bias });
    if (F.kneepads) R.ell(kx + 0.6, ky, 2.5, 2.2, F.kneepads, { bias });
    if (A.machine) { R.ell(kx, ky, 2.3, 2.3, '#9aa4ac', { bias }); R.px(kx + 0.5, ky, '#ff4a3a', 3); }
    // foot: toe direction perpendicular to the shin (flat when planted)
    let sdx = ax - kx, sdy = ay - ky; const sl = Math.hypot(sdx, sdy) || 1; sdx /= sl; sdy /= sl;
    let tdx = -sdy * -1, tdy = -sdx; // rotate shin dir by -90 deg: (x, y) -> (y, -x)
    tdx = sdy; tdy = -sdx;
    const planted = ay >= GY - 3.6 && !P.lying;
    if (planted) { tdx = 1; tdy = 0; } else if (!P.lying) { const a = Math.atan2(tdy, tdx); const a2 = clamp(a, -0.5, 0.7); tdx = Math.cos(a2); tdy = Math.sin(a2); }
    R.group();
    if (bootCol) {
      R.cap(ax - sdx * 3.5, ay - sdy * 3.5, ax, ay, 3.0 * big, 2.8 * big, bootCol, { bias });
      const hx0 = ax - tdx * 1.6 + sdx * 0.8, hy0 = ay - tdy * 1.6 + sdy * 0.8, tx1 = ax + tdx * 4.6 + sdx * 1.2, ty1 = ay + tdy * 4.6 + sdy * 1.2;
      R.cap(hx0, hy0, tx1, ty1, 2.3 * big, 1.8, bootCol, { bias });
      R.line(hx0 + sdx * 2 - tdx * 0.5, hy0 + sdy * 2, tx1 + sdx * 1.6, ty1 + sdy * 1.6, mix(bootCol, '#000000', 0.5), 1);   // sole
    } else {
      R.cap(ax - tdx * 1 + sdx * 0.6, ay - tdy * 1 + sdy * 0.6, ax + tdx * 4 + sdx * 1, ay + tdy * 4 + sdy * 1, 2.1, 1.4, skinC, { bias });
      if (F.claws) R.px(ax + tdx * 5 + sdx * 1.5, ay + tdy * 5 + sdy * 1.5, '#e6dcc0', 3);
    }
    return r;
  };
  const footAbs = (f) => [CX + f[0] + (P.lying ? 0 : P.hx * 0.3), GY - 3 + f[1]];

  // ---- back layer: cloak / pack / far arm / far leg
  const tailSway = P.sec[0], tailLift = P.sec[1];
  R.group();
  if (F.cloak) {      // cloak hanging from the shoulders behind the body
    const top = TP(-1, 2.5), mid = TP(-8 * big + tailSway * 0.3, TL - 2), bot = TP(-6 * big + tailSway, TL + 14 - tailLift), bot2 = TP(4, TL + 12 - tailLift * 0.5);
    const pts = P.lying ? [TP(-6, 1), TP(6, 1), TP(7, TL + 6), TP(-7, TL + 6)] : [TP(-6.5 * big, 1.5), TP(5 * big, 1.5), add2(bot2, [0, 0]), bot, mid];
    R.poly(pts, F.cloak, { bias: -0.12 });
    if (F.cloakRag && !P.lying) for (let k = 0; k < 5; k++) { const p = TP(-6 + k * 2.6 + tailSway, TL + 12.5 - tailLift - (k & 1) * 2); R.cap(p[0], p[1], p[0] - 0.3, p[1] + 2 + (k % 3), 0.8, 0.6, F.cloak, { bias: -0.2 }); }
    if (top) { }
  }
  if (F.coatTail && !P.lying) R.poly([TP(-6 * big, TL - 6), TP(5 * big, TL - 6), TP(5.5 * big + tailSway * 0.5, TL + 9 - tailLift), TP(-1 + tailSway, TL + 11 - tailLift), TP(-7.5 * big + tailSway, TL + 9 - tailLift)], F.coatTail, { bias: -0.1 });
  if (F.pack === 'tech') { R.poly([TP(-11, 2), TP(-5, 2), TP(-5, 15), TP(-11.5, 15)], '#3a4a54'); const a = TP(-9, 5), b = TP(-9, 9); R.px(a[0], a[1], '#46f2c8', 4); R.px(a[0] + 1, a[1], '#46f2c8', 3); R.px(b[0], b[1], '#ff7a1e', 4); const an0 = TP(-9.5, 2), an1 = TP(-11 + tailSway * 0.5, -10); R.line(an0[0], an0[1], an1[0], an1[1], '#8a949c', 3); R.px(an1[0], an1[1] - 1, '#ff3a2a', 4); }
  if (F.pack === 'fuel') { const a0 = TP(-9, 2), a1 = TP(-9, 16), b0 = TP(-5.5, 3), b1 = TP(-5.5, 16); R.cap(a0[0], a0[1], a1[0], a1[1], 3.3, 3.3, '#9a3a20'); R.cap(b0[0], b0[1], b1[0], b1[1], 2.6, 2.6, '#b84a24'); const v = TP(-9, 0.5); R.px(v[0], v[1], BRASS, 4); }
  if (F.pack === 'mil') { R.poly([TP(-11, 3), TP(-5, 2.5), TP(-5, 14), TP(-10.5, 14.5)], '#44502c'); const t = TP(-10.5, 1.5), t2 = TP(-5, 1.5); R.cap(t[0], t[1], t2[0], t2[1], 1.6, 1.6, '#5a6438'); }
  if (F.pack === 'roll') { const t = TP(-9.5, 2), t2 = TP(-4, 1.5); R.cap(t[0], t[1], t2[0], t2[1], 2.4, 2.4, '#8a6a3a'); R.poly([TP(-10, 4), TP(-5, 4), TP(-5, 13), TP(-10, 13)], '#5a4a30'); }
  if (F.pack === 'sack') { const c = TP(-8, 9); R.ell(c[0], c[1], 4.6, 5.8, '#5a4a30', { rot: P.ta }); const t = TP(-7, 3); R.px(t[0], t[1], '#2a1e14', 1); }
  // far arm (behind the torso); its hand is drawn later when it holds the weapon
  const farArm = arm(shF, farTarget, false, farOnWeapon);
  // far leg
  leg(hipF, footAbs(P.fF), false);

  // ---- torso
  const tg = R.group();
  const chestR = (A.machine ? 7.6 : 7.0) * big, waistR = 5.8 * big;
  const topCol = F.jacket || F.rags || (A.machine ? '#7a848c' : skinC);
  { const c = TP(0.4, 6.8); R.ell(c[0], c[1], chestR, 5.6 * (A.machine ? 1.05 : 1), topCol, { rot: P.ta }); }
  { const c = TP(-0.2, 3.6); R.ell(c[0], c[1], 7.0 * big, 2.9, topCol, { rot: P.ta, bias: 0.04 }); }   // shoulder line / trapezius
  { const a = TP(0.2, 8), b = TP(0, TL - 2.5); R.cap(a[0], a[1], b[0], b[1], 6.2 * big, waistR, topCol); }
  { const a = TP(0, TL - 3), b = TP(0, TL + 0.6); R.cap(a[0], a[1], b[0], b[1], waistR * 1.0, waistR * 0.95, topCol); }
  const inT = (f) => (x, y) => { const [u, v] = TLc(x, y); return f(u, v); };
  const beltV = TL - 4.2;
  R.paint(inT((u, v) => v > beltV + 1.2), legCol, { g: tg });
  if (F.bareChest && !A.machine) {
    R.paint(inT((u, v) => v <= beltV + 1.2), skinC, { g: tg });
    for (const [u, v, s] of [[1.5, 7.5, 1], [2.5, 8, 1], [-2.5, 8.2, 1], [0.5, 11, 1], [0.5, 13, 1], [-1.5, 11.5, 1]]) { const p = TP(u, v); R.px(p[0], p[1], shade(skinC, 0.72), s); }
    const a = TP(-4, 9), b = TP(3.5, 9); R.line(a[0], a[1], b[0], b[1], shade(skinC, 0.78), 1);
    if (F.warpaint) { for (const [u0, v0, u1, v1] of [[-4, 5, 4, 12], [-4, 9, 3, 15]]) { const a1 = TP(u0, v0), b1 = TP(u1, v1); R.line(a1[0], a1[1], b1[0], b1[1], F.warpaint, 2); } const h = TP(-1, 5); R.px(h[0], h[1], F.warpaint, 3); }
  }
  if (F.rags) { R.paint(inT((u, v) => v > 9 && v <= beltV + 1.2 && ((Math.round(u * 2 + v) % 5) !== 0)), F.rags, { g: tg }); }
  // belt + buckle
  if (!A.machine) {
    R.paint(inT((u, v) => v > beltV - 0.6 && v <= beltV + 1.2), F.belt || '#2e2218', { g: tg });
    const b = TP(1.6, beltV + 0.3); R.px(b[0], b[1], '#d8b058', 4); R.px(b[0] + nv[0], b[1] + nv[1], '#8a6a2a', 2);
  }
  // shirt folds / zipper (only on clothed torsos)
  if (F.jacket && !A.machine) {
    R.paint(inT((u, v) => v > 3 && v < beltV - 1 && u > 0.9 && u < 1.9), topCol, { g: tg, ds: -1 });
    for (const [u0, v0, u1, v1] of [[-4.5, 12.5, -2.5, 13.5], [3, 12.8, 5, 12]]) { const a = TP(u0, v0), b = TP(u1, v1); R.line(a[0], a[1], b[0], b[1], topCol, 1); }
    const c0 = TP(-2.5, 2.4), c1 = TP(2.8, 2.6); R.line(c0[0], c0[1], c1[0], c1[1], shade(topCol, 0.8), 1);   // collar
  }
  if (F.overalls) { R.paint(inT((u, v) => v > 8 && v <= beltV - 0.6 && u > -4.5 && u < 5), '#3a5664', { g: tg }); for (const uu of [-3.5, 3.8]) { const a = TP(uu, 2.5), b = TP(uu, 8.5); R.line(a[0], a[1], b[0], b[1], '#3a5664', 2); } const p = TP(0.5, 10.5); R.px(p[0], p[1], '#f2c03b', 4); }
  if (F.vest) {
    R.paint(inT((u, v) => v > 3.2 && v < beltV - 0.4 && u > -5.6 * big), F.vest, { g: tg });
    R.paint(inT((u, v) => v > 3.2 && v < beltV - 0.4 && Math.abs(v - 8) < 0.6), F.vest, { g: tg, ds: -1 });
    for (const u of [-2.2, 1.4, 4.6]) { const a = TP(u, 11.2), b = TP(u, 12.8); R.cap(a[0], a[1], b[0], b[1], 1.3, 1.3, F.pouches); const t = TP(u, 10.6); R.px(t[0], t[1], shade(F.pouches, 1.3), 3); }
  }
  if (F.patch) { const p = TP(-4.5, 6); R.px(p[0], p[1], F.patch, 3); R.px(p[0] + 1, p[1], F.patch, 2); }
  if (F.cross) { const c = TP(2.6, 7.5); for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) R.px(c[0] + dx, c[1] + dy, '#c43d2f', 3); }
  if (F.satchel) { const a = TP(-3.5, 3), b = TP(4.5, beltV - 0.5); R.line(a[0], a[1], b[0], b[1], '#7a6a52', 1); }
  if (F.toolbelt) { for (const [u, c, s] of [[-3.5, F.toolbelt, 2], [4.2, '#8a949c', 3]]) { const a = TP(u, beltV + 0.8), b = TP(u, beltV + 3.4); R.cap(a[0], a[1], b[0], b[1], 1.3, 1.2, c, { flat: 0.3 }); } const y = TP(5.5, beltV + 1.6); R.px(y[0], y[1], '#f2c03b', 4); }
  if (F.bandolier) for (let k = 0; k <= 15; k++) { const t = k / 15, p = TP(-5 + t * 10, 3 + t * (beltV - 4)); R.px(p[0], p[1], F.bandolier, 2); R.px(p[0] + 1, p[1], F.bandolier, 1); if (k % 3 === 1) R.px(p[0], p[1] - 1, F.ammo ? BRASS : '#8a8a7a', 4); }
  if (F.harness) { for (let k = 0; k <= 14; k++) { const t = k / 14, p = TP(-5 + t * 10, 3 + t * (beltV - 4)); R.px(p[0], p[1], F.harness, 1); R.px(p[0] + 1, p[1], F.harness, 2); } const r = TP(0, 9.5); R.px(r[0], r[1], '#b8c0c8', 4); R.px(r[0] + 1, r[1], '#6a7078', 2); }
  if (F.tireArmor) { R.paint(inT((u, v) => v > 5 && v < 11 && u > -6), F.tireArmor, { g: tg }); for (let k = 0; k < 5; k++) { const p = TP(-4 + k * 2.2, 8); R.px(p[0], p[1], '#5a5a5e', 3); } }
  if (F.apron) R.paint(inT((u, v) => v > 8 && u > -1.5), F.apron, { g: tg });
  if (F.sash) for (let k = 0; k <= 15; k++) { const t = k / 15, p = TP(-5.5 + t * 11, 3.5 + t * (beltV - 3)); R.px(p[0], p[1], F.sash, 2); R.px(p[0] + 1, p[1], F.sash, 3); R.px(p[0], p[1] + 1, F.sash, 1); }
  if (F.chains) for (let k = 0; k < 7; k++) { const p = TP(-4 + k * 1.4, 5 + k * 1.5); R.px(p[0], p[1], k & 1 ? '#c0c4c8' : '#6a6e72', 3); }
  if (F.ribs) { for (const v of [6, 8.2, 10.4]) { for (let u = -3; u <= 4.5; u += 1) { const p = TP(u, v + Math.abs(u - 0.8) * 0.18); R.px(p[0], p[1], F.ribs, u < 0 ? 3 : 2); } } for (let v = 5; v <= 12; v += 1.2) { const p = TP(0.8, v); R.px(p[0], p[1], F.ribs, 4); } }
  if (F.skulls) { for (const u of [-2, 2.5]) { const p = TP(u, beltV + 2); R.px(p[0], p[1], '#e6dcc0', 4); R.px(p[0] + 1, p[1], '#c8bea0', 3); R.px(p[0], p[1] + 1, '#8a8270', 1); } }
  if (A.machine) {
    R.paint(inT((u, v) => v > 4 && v < 12 && u > -5 && u < 6), '#5a646c', { g: tg });
    const c = TP(0.5, 7.5); R.ell(c[0], c[1], 2.2, 2.2, '#2a3036'); R.px(c[0], c[1], '#ff4030', 4); R.px(c[0] - 1, c[1] - 1, '#ff9080', 4);
    for (let k = 0; k < 3; k++) { const a = TP(-4, 13.5 + k * 1.6), b = TP(4.5, 13.5 + k * 1.6); R.line(a[0], a[1], b[0], b[1], '#4a525a', 1); }
  }
  if (F.pustules) for (const [u, v] of [[2, 7], [-2.5, 11], [3.5, 14], [0, 4.5], [-4, 6]]) { const p = TP(u, v); R.px(p[0], p[1], '#c8e04a', 4); R.px(p[0], p[1] + 1, '#6a8a2a', 1); }
  if (F.fur) { R.group(); const c = TP(-0.5, 2.6); R.ell(c[0], c[1], 7.2 * big, 3.4, F.fur, { rot: P.ta }); for (let k = -6; k <= 6; k += 2) { const p = TP(k, 5.2); R.px(p[0], p[1], shade(F.fur, 0.6), 1); } }
  if (F.scarf) { R.group(); const c = TP(0.5, 2.2); R.ell(c[0], c[1], 4.8, 2.7, F.scarf, { rot: P.ta }); const a = TP(-3, 3), b = TP(-6 + tailSway, 11 - tailLift); R.cap(a[0], a[1], b[0], b[1], 1.6, 1.1, F.scarf); }
  if (F.satchel) { R.group(); const c = TP(-5, beltV + 1.5); R.ell(c[0], c[1], 3.6, 3.0, F.satchel, { rot: P.ta }); for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) R.px(c[0] + dx, c[1] + dy, '#c43d2f', 3); }

  // ---- near leg
  leg(hipN, footAbs(P.fN), true);

  // ---- weapon in the 'mid' layer (behind the head, e.g. a sledge resting on the shoulder)
  let Wd = null;
  const wLayer = P.wLayer;
  const drawW = () => { if (armed) Wd = drawWeapon(R, W, gripAbs[0], gripAbs[1], P.wA, { pump: P.pump, draw: P.draw }); };
  if (wLayer === 'mid') drawW();

  // ---- neck + head
  R.group();
  { const a = TP(0.4, 2.5), b = TP(0.8, -1.5); R.cap(a[0], a[1], b[0], b[1], 2.4, 2.3, A.machine ? '#4a525a' : shade(skinC, 0.86)); }
  const hS = R.sub(30, 30); hS.g = 0;
  drawHead(hS, A, F, P);
  let hAng = P.ta * 0.55 + (P.ha || 0); const tilt = hAng; if (Math.abs(hAng) < 32) hAng = 0; else if (Math.abs(hAng + 90) < 12) hAng = -90;
  const anchor = TP(0.6, 1.6); const hbx = hAng === 0 ? 0 : 0;
  const tdx = hAng === 0 ? Math.sin(tilt * D2R) * 4 : 0;   // small tilts: shift the head instead of rotating it (keeps the face crisp)
  R.stamp(hS, Math.round(anchor[0] + tdx), Math.round(anchor[1]), hAng, 13, 23);

  // ---- shoulder pads (near side, and far side for bosses)
  if (F.pad) {
    if (F.pad2) { R.group(); R.ell(shF[0] + 0.5, shF[1] - 1, 3.6 * big, 2.8 * big, F.pad, { rot: P.ta - 10, bias: -0.12 }); }
    R.group(); R.ell(shN[0] - 0.4, shN[1] - 1.2, 4.4 * big, 3.3 * big, F.pad, { rot: P.ta - 15 });
    const h = [shN[0] + 0.6, shN[1] - 2.4]; R.px(h[0], h[1], '#d8dce0', 4);
    if (F.spikes) for (const k of [-2.2, 1.6]) { const b = [shN[0] - 0.4 + k * nv[0] * 1.4 + up[0] * 3.2 * big, shN[1] - 0.4 + k * nv[1] * 1.4 + up[1] * 3.2 * big]; R.line(b[0], b[1], b[0] + up[0] * 3.6 - nv[0] * 0.8, b[1] + up[1] * 3.6 - nv[1] * 0.8, '#9aa0a8', 3); R.px(b[0] + up[0] * 4.2 - nv[0] * 1, b[1] + up[1] * 4.2 - nv[1], '#eef2f4', 4); }
  }
  // ---- weapon (front layer), far hand on top of it, near arm in front
  if (wLayer !== 'mid') drawW();
  if (farOnWeapon) farArm.drawHand();
  if (P.drop && W && P.drop[3] === 1) drawWeapon(R, W, CX + P.drop[0], GY + P.drop[1], P.drop[2]);
  if (P.throwObj === 'hand') { R.group(); R.ell(farTarget[0] + 0.5, farTarget[1] - 1.5, 1.8, 2.0, '#4a5a3a'); R.px(farTarget[0] + 0.5, farTarget[1] - 3.6, '#c8c0a0', 3); }
  if (P.item != null) drawItem(R, A, farTarget, P.item);
  arm(shN, gripAbs, true, false);
  if (P.arrow && Wd) { R.group(); const [x, y] = gripAbs; R.line(x - 7 + (P.draw || 0) * -0.5, y, x + 6, y, '#c8b088', 3); R.px(x + 7, y, STEEL, 4); }

  // ---- effects
  const out = { tip: Wd && Wd.tip, shoulder: shN, grip: gripAbs, hip, neck, fx };
  if (Wd && P.flash) muzzle(fx, Wd.tip[0], Wd.tip[1], P.wA, W.laser ? '#8affea' : '#ffd060', W.laser ? '#2ae0c0' : '#ff8a20', A.weapon === 'shotgun' ? 1.25 : A.weapon === 'pistol' ? 0.8 : 1);
  if (Wd && P.flame) flameJet(fx, Wd.tip[0], Wd.tip[1], P.wA, P.flame);
  if (Wd && P.smoke) smoke(fx, Wd.tip[0], Wd.tip[1], P.smoke);
  if (Wd && P.casing && W.port) { const [x, y] = Wd.T(W.port[0] - P.casing * 3, W.port[1] - P.casing * 3.5); R.group(true); R.px(x, y, BRASS, 4); R.px(x + 1, y, '#8a6a2a', 2); }
  if (Wd && P.spark === 'tip') spark(fx, Wd.tip[0], Wd.tip[1]);
  if (P.spark === 'hand') spark(fx, gripAbs[0] + 2, gripAbs[1]);
  if (P.throwObj === 'fly') { R.group(); R.ell(farTarget[0] + 9, farTarget[1] - 5, 1.8, 2.0, '#4a5a3a'); R.px(farTarget[0] + 6, farTarget[1] - 3, '#e8e0c0', 2); }
  out.smear = P.smear || null;
  return out;
}

function drawItem(R, A, h, step) {
  const tech = A.cls === 'techie' || A.machine;
  if (step === 0) return;
  R.group();
  const [x, y] = h;
  if (step <= 3) {
    if (tech) { R.rect(Math.round(x - 1), Math.round(y - 5), 4, 5, '#3a4a54', 2); R.px(x, y - 4, '#46f2c8', 4); R.px(x + 1, y - 4, '#46f2c8', 3); R.line(x + 2, y - 5, x + 3, y - 9, '#8a949c', 3); R.px(x + 3, y - 10, '#ff3a2a', 4); }
    else { R.cap(x, y - 1, x + 1, y - 7, 1.2, 1.0, '#9ad8e8'); R.px(x + 1, y - 4, '#e8fff8', 4); R.px(x + 1.2, y - 8, '#e0e0e0', 4); R.px(x + 1.3, y - 9, '#c0c0c0', 3); R.px(x - 0.5, y, '#c43d2f', 3); }
  }
  if (step >= 3) {   // glow burst
    R.group(true);
    const col = tech ? ['#46f2c8', '#c8fff4'] : ['#8fff9a', '#ffffff'], rr = [0, 0, 0, 4, 8, 11][step], n = [0, 0, 0, 6, 10, 6][step];
    for (let k = 0; k < n; k++) { const a = k / n * Math.PI * 2 + step, px = x + Math.cos(a) * rr, py = y - 3 + Math.sin(a) * rr * 0.8; R.px(px, py, col[k % 2], 4); if (step === 4 && k % 2 === 0) R.px(px + Math.cos(a), py + Math.sin(a) * 0.8, col[0], 3); }
    if (step === 3) { R.px(x, y - 3, col[1], 4); R.px(x + 1, y - 3, col[0], 4); R.px(x, y - 4, col[0], 4); }
  }
}

// ---- effects are collected as raw pixels and drawn after blit (no outlines: they glow over everything)
class FX {
  constructor() { this.p = new Map(); }
  px(x, y, c) { x = Math.round(x); y = Math.round(y); this.p.set(y * 4096 + x, c); }
  disc(x, y, r, c) { for (let j = Math.floor(y - r); j <= y + r; j++) for (let i = Math.floor(x - r); i <= x + r; i++) if ((i + 0.5 - x) ** 2 + (j + 0.5 - y) ** 2 <= r * r) this.px(i, j, c); }
  draw(img, ox, oy) {
    const d = img.data, W = img.width;
    for (const [k, c] of this.p) { const y = Math.floor(k / 4096), x = k - y * 4096; if (x < 0 || y < 0 || x >= HFW || y >= HFH) continue; const [r, g, b] = typeof c === 'string' ? hexRGB(c) : c; const i = ((oy + y) * W + ox + x) * 4; d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255; }
  }
}
const hexCache = new Map();
function hexRGB(h) { let v = hexCache.get(h); if (!v) { const n = parseInt(h.slice(1), 16); v = [(n >> 16) & 255, (n >> 8) & 255, n & 255]; hexCache.set(h, v); } return v; }
function muzzle(fx, x, y, ang, core, outer, sz = 1) {
  const c = Math.cos(ang * D2R), s = Math.sin(ang * D2R), L = 8.5 * sz;
  for (let j = Math.floor(y - 12); j <= y + 12; j++) for (let i = Math.floor(x - 12); i <= x + 14; i++) {
    const dx = i + 0.5 - x, dy = j + 0.5 - y, a = dx * c + dy * s, o = -dx * s + dy * c;
    const t = clamp((a + 1) / (L + 1), 0, 1), lobe = a > -1.2 && a < L && Math.abs(o) < 2.8 * sz * Math.pow(Math.sin(Math.PI * Math.pow(t, 0.7)), 0.8) + 0.3;
    const cross = Math.abs(a - 2.2 * sz) < 0.7 && Math.abs(o) < 4.6 * sz, diag = Math.abs(Math.abs(o) - (a - 1) * 0.9) < 0.6 && a > 1.5 && a < 4.5 * sz;
    if (!lobe && !cross && !diag) continue;
    const r = Math.hypot((a - 1.5) * 0.55, o);
    fx.px(i, j, r < 1.3 ? '#fffbe8' : r < 2.4 ? core : outer);
  }
}
function flameJet(fx, x, y, ang, len) {
  const c = Math.cos(ang * D2R), s = Math.sin(ang * D2R);
  for (let k = len; k >= 0; k -= 1) { const t = k / Math.max(1, len), r = 0.9 + t * 4.0 - Math.max(0, t - 0.82) * 10, wob = Math.sin(k * 0.9 + len) * t * 1.5; const px = x + c * (k + 1) - s * wob, py = y + s * (k + 1) + c * wob - t * t * 3; if (r > 0.6) fx.disc(px, py, r, t < 0.18 ? '#fff4b0' : t < 0.45 ? '#ffc040' : t < 0.75 ? '#ff7a1e' : '#d8401a'); }
  for (let k = 2; k < len * 0.6; k += 2.5) { const px = x + c * (k + 1), py = y + s * (k + 1); fx.px(px, py, '#fffbe0'); }
}
function smoke(fx, x, y, k) {
  const pts = [[[1.5, -1, 1.5]], [[2.5, -3, 2.0], [0.5, -1.5, 1.2]], [[3, -6, 2.2], [1, -3.5, 1.4], [4.5, -4, 1.0]]][k - 1];
  const col = [['#d8d0c0', '#b0a898'], ['#c8c0b0', '#a09888'], ['#a8a090', '#8a8478']][k - 1];
  for (const [dx, dy, r] of pts) { fx.disc(x + dx, y + dy, r, col[1]); fx.disc(x + dx - 0.4, y + dy - 0.4, r * 0.6, col[0]); }
}
function spark(fx, x, y) {
  for (const [dx, dy, l] of [[1, 0, 4.5], [-1, 0, 3], [0, 1, 3], [0, -1, 4.5], [0.7, 0.7, 2.5], [0.7, -0.7, 3], [-0.7, 0.7, 2], [-0.7, -0.7, 2.5]]) for (let k = 1; k <= l; k++) fx.px(x + dx * k, y + dy * k, k < 2 ? '#ffffff' : k < 3.5 ? '#ffe890' : '#ffa030');
  fx.px(x, y, '#ffffff');
}

// ---------------------------------------------------------------- head (drawn upright into a 30x30 sub-raster, head centre 14,15; neck anchor 13,23)
function drawHead(S, A, F, P) {
  const hx = 14, hy = 15, skin = A.machine ? '#7a848c' : F.skin, hair = A.hair;
  const eyes = P.eyes || 'open', sec = P.sec || [0, 0];
  if (A.machine) {
    S.group();
    S.poly([[hx - 5, hy - 5], [hx + 4.5, hy - 5.5], [hx + 6, hy - 1], [hx + 5.5, hy + 4], [hx - 4, hy + 6], [hx - 5.5, hy + 1]], '#7a848c');
    S.group(); S.rect(Math.round(hx - 0.5), Math.round(hy - 2), 6, 3, '#1a1414', 0);
    S.px(hx + 3, hy - 1, '#ff3020', 4); S.px(hx + 4, hy - 1, '#ffb0a0', 4); S.px(hx + 2, hy - 1, '#ff3020', 3); S.px(hx + 1, hy - 1, '#a01810', 2);
    for (let k = 0; k < 3; k++) S.px(hx + 1 + k * 1.5, hy + 3, '#3a4248', 1);
    S.group(); S.line(hx - 3, hy - 5, hx - 4 + sec[0] * 0.5, hy - 10, '#5a646c', 2); S.px(hx - 4 + sec[0] * 0.5, hy - 11, '#ff3a2a', 4);
    S.group(); S.ell(hx - 3, hy, 1.8, 2.2, '#5a646c');
    return;
  }
  // behind-the-head pieces (long hair, ponytail, hood back)
  const style = A.hairStyle % 6, covered = ['helmet', 'hood', 'reaper', 'cap'].includes(A.head) || A.mutant;
  if (!covered && (style === 3 || style === 5)) {
    S.group();
    if (style === 3) S.cap(hx - 3.5, hy - 2, hx - 5 + sec[0] * 0.6, hy + 7 - sec[1] * 0.5, 3.6, 2.4, hair);
    else { S.cap(hx - 5, hy - 3, hx - 8 + sec[0], hy + 4 - sec[1], 1.9, 1.3, hair); S.px(hx - 5.5, hy - 2.5, A.accent, 3); }
  }
  if (A.head === 'hood' || A.head === 'reaper') { S.group(); const hc = A.head === 'reaper' ? (F.hood || '#5a1410') : (F.cloak || F.jacket || A.cloth2); S.cap(hx - 4, hy + 1, hx - 6.5 + sec[0] * 0.5, hy + 8, 3.6, 2.6, shade(hc, 0.82)); }
  // skull + jaw + nose (+ ear)
  const hg = S.group();
  S.ell(hx - 0.3, hy - 1.2, 5.6, 6.0, skin);
  S.ell(hx + 1.4, hy + 2.2, 4.4, 3.7, skin);
  S.cap(hx + 5.0, hy - 0.4, hx + 5.9, hy + 1.2, 1.0, 0.8, skin);
  if (A.mutant) { S.ell(hx + 0.4, hy - 4.5, 3.4, 2.4, shade(skin, 1.05)); }   // swollen brow
  const eg = S.group(); S.ell(hx - 3.4, hy + 0.9, 1.3, 1.8, skin, { bias: -0.05 }); S.px(hx - 3.3, hy + 1.1, shade(skin, 0.8), 1);
  // face
  const faceCovered = ['gas', 'mask', 'reaper'].includes(A.head);
  const eN = [hx + 1.5, hy - 0.6], eF = [hx + 4.4, hy - 0.6];
  S.g = hg;           // face details belong to the skull group (no contour between them)
  if (!faceCovered) {
    const dark = '#1a1410', white = A.mutant ? '#e8f070' : '#f2ecde';
    if (eyes === 'closed' || eyes === 'pain') { S.px(eN[0], eN[1], shade(skin, 0.55), 1); S.px(eN[0] + 1, eN[1], shade(skin, 0.55), 1); S.px(eF[0], eF[1], shade(skin, 0.55), 1); }
    else if (eyes === 'squint') { S.px(eN[0] + 1, eN[1], dark, 0); S.px(eN[0], eN[1], shade(skin, 0.6), 1); S.px(eF[0], eF[1], dark, 0); }
    else { S.px(eN[0], eN[1], white, 4); S.px(eN[0] + 1, eN[1], A.mutant ? '#c8a020' : dark, A.mutant ? 4 : 0); S.px(eF[0], eF[1], dark, 0); if (eyes === 'wide') { S.px(eN[0], eN[1] - 1, white, 4); S.px(eN[0] + 1, eN[1] - 1, white, 3); } }
    const browY = eyes === 'pain' ? [-2.2, -1.4] : [-1.8, -1.8], bc = mix(hair, '#140c08', 0.35);
    S.px(eN[0], eN[1] + browY[0], bc, 1); S.px(eN[0] + 1, eN[1] + browY[1], bc, 1); S.px(eF[0], eF[1] + browY[1], bc, 1);
    if (A.mutant) { S.px(eF[0], eF[1], '#e8f070', 4); }
    const mY = hy + 3.4;
    if (P.mouth === 2) { S.px(hx + 2.5, mY, '#3a1010', 0); S.px(hx + 3.5, mY, '#3a1010', 0); S.px(hx + 3, mY - 1, '#e8e0d0', 4); }
    else if (P.mouth === 1) { S.px(hx + 3, mY, shade(skin, 0.5), 0); }
    else { S.px(hx + 2.5, mY, shade(skin, 0.6), 1); S.px(hx + 3.5, mY, shade(skin, 0.6), 1); }
    if (A.cyber) { S.px(eN[0], eN[1], '#3a3f46', 1); S.px(eN[0] + 1, eN[1], '#ff3a2a', 4); S.line(hx - 1.5, hy - 4, hx + 1.5, hy - 3, '#8a949c', 3); S.line(hx - 1.5, hy - 3, hx - 1.5, hy + 0.5, '#8a949c', 2); }
    if (A.mutation && !A.mutant) { S.px(hx + 3, hy + 3.5 - 4, '#8fd14f', 3); S.px(hx - 1, hy - 3, '#8fd14f', 3); S.px(hx, hy - 2, '#5a8a2a', 2); }
    if (A.mutant) { for (const [ox, oy] of [[-2, -4], [2, -5], [-3, 2]]) S.px(hx + ox, hy + oy, '#c8e04a', 4); S.paint((x, y) => (x * 7 + y * 3) % 11 === 0, shade(skin, 0.7), { g: hg }); S.px(hx + 2.5, hy + 3.4, '#e8e0c0', 4); S.px(hx + 4, hy + 3.6, '#e8e0c0', 4); }
    const beard = ((A.seed >> 3) % 3 === 0 && !A.enemy && A.cls !== 'medic') || A.role === 'thug' || A.role === 'chief' || A.cls === 'brute';
    if (beard) S.paint((x, y) => y + 0.5 >= hy + 2.6 && x + 0.5 >= hx - 0.5 && !(y === Math.round(hy + 3.4 - 0.5) && x >= hx + 2 && x <= hx + 4 && P.mouth === 2), hair, { g: hg });
    if (F.scarfMask) S.paint((x, y) => y + 0.5 >= hy + 1.2 && x + 0.5 >= hx - 1, F.scarfMask, { g: hg });
    else if (A.nomad && !A.enemy) S.paint((x, y) => y + 0.5 >= hy + 1.6 && x + 0.5 >= hx - 1, '#c9a468', { g: hg });
  }
  S.g = eg;
  // hair
  if (!covered) {
    S.group();
    const hc = hair, hl = shade(hair, 1.35);
    switch (style) {
      case 0: S.ell(hx - 0.7, hy - 4, 6.2, 3.6, hc, { clip: (x, y) => y + 0.5 < hy - 2 || x + 0.5 < hx - 1.8 }); S.px(hx + 2, hy - 6, hl, 4); S.px(hx + 4.5, hy - 3, hc, 2); break;
      case 1: S.px(hx - 1, hy - 6, '#fff4e0', 4); break;                    // bald (shine)
      case 2: { S.ell(hx - 0.8, hy - 4.4, 5.8, 2.4, shade(hc, 0.8), { clip: (x, y) => y + 0.5 < hy - 3 }); S.group(); const mc = A.raider ? A.accent : hc; for (let k = -5; k <= 3; k++) { const x = hx + k * 0.95, y = hy - 6.2 + Math.abs(k + 1) * 0.3, h = 5.2 - Math.abs(k + 1) * 0.45; S.cap(x, y, x - 1.6 + sec[0] * 0.3, y - h, 0.9, 0.35, mc); } break; }   // mohawk
      case 3: S.ell(hx - 1, hy - 3.6, 6.6, 4.1, hc, { clip: (x, y) => y + 0.5 < hy - 1.6 || x + 0.5 < hx - 0.5 }); S.cap(hx + 3.5, hy - 4, hx + 5.2, hy - 1.5, 1.4, 0.9, hc); S.px(hx + 1, hy - 6, hl, 4); break;   // long + fringe
      case 4: S.ell(hx - 0.8, hy - 4.2, 6.0, 2.8, hc, { clip: (x, y) => y + 0.5 < hy - 2.6 }); break;   // buzz
      case 5: S.ell(hx - 0.7, hy - 4, 6.2, 3.6, hc, { clip: (x, y) => y + 0.5 < hy - 2 || x + 0.5 < hx - 1.8 }); S.px(hx + 2, hy - 6, hl, 4); break;   // ponytail
    }
  }
  // headgear
  S.group();
  const ac = A.accent;
  switch (A.head) {
    case 'helmet': S.ell(hx - 0.3, hy - 3.6, 7.2, 5.2, '#5e6a44', { clip: (x, y) => y + 0.5 < hy - 0.8 }); S.cap(hx - 6.5, hy - 1.4, hx + 6.6, hy - 1.6, 0.9, 0.9, '#3a4428'); S.line(hx - 2, hy - 1, hx + 0, hy + 5, '#2a2a22', 1); S.px(hx - 2, hy - 6, ac, 3); S.px(hx + 2, hy - 7, '#8a9a66', 4);
      S.group(); S.cap(hx - 2, hy - 5.8, hx + 3, hy - 5.6, 1.2, 1.2, '#2a2a24'); S.px(hx + 3.5, hy - 5.8, '#9ad8ff', 4); break;
    case 'hood': { const hc = F.cloak || F.jacket || A.cloth2; S.ell(hx - 1.2, hy - 1.3, 7.4, 7.8, hc, { clip: (x, y) => !(x + 0.5 > hx + 0.8 && y + 0.5 > hy - 3.6) }); S.cap(hx + 0.5, hy - 4.6, hx + 6, hy - 3.6, 1.2, 1.0, shade(hc, 0.9)); break; }
    case 'headband': { const bc = F.armband || ac; S.paint((x, y) => y + 0.5 >= hy - 5.2 && y + 0.5 <= hy - 3.8, bc, { g: hg }); S.cap(hx - 5.5, hy - 4.5, hx - 8 + sec[0] * 0.7, hy - 0.5 - sec[1] * 0.5, 0.8, 0.6, bc); S.cap(hx - 5.5, hy - 3, hx - 7.5 + sec[0] * 0.5, hy + 1.5, 0.7, 0.5, bc); break; }
    case 'goggles': S.cap(hx - 5.8, hy - 4.2, hx + 4.5, hy - 4.6, 0.8, 0.8, '#3a2a1a'); S.group(); S.ell(hx + 2.8, hy - 4.8, 1.8, 1.6, '#c87a1a'); S.ell(hx + 0, hy - 5, 1.6, 1.5, '#a8641a'); S.px(hx + 2.5, hy - 5.4, '#fff6c0', 4); S.px(hx - 0.3, hy - 5.5, '#ffe8a0', 4); break;
    case 'cap': S.ell(hx - 0.5, hy - 4.0, 6.4, 3.6, '#2a2a2e', { clip: (x, y) => y + 0.5 < hy - 1.8 }); S.cap(hx + 2, hy - 2.4, hx + 8, hy - 2.0, 1.0, 0.7, '#1a1a1e'); if (F.spikes) for (let k = -3; k <= 1; k += 2) S.line(hx + k, hy - 6.6, hx + k - 0.5, hy - 9.5, '#d0d4d8', 4); S.px(hx, hy - 5, ac, 4); break;
    case 'gas': S.paint((x, y) => x + 0.5 > hx - 0.8 && y + 0.5 > hy - 3.8, '#2e332f', { g: hg }); S.group(); S.ell(eN[0] + 0.3, eN[1] - 0.2, 1.7, 1.6, '#1a1f1c'); S.ell(eF[0] + 0.4, eF[1] - 0.2, 1.1, 1.4, '#1a1f1c'); S.px(eN[0] + 0.3, eN[1] - 0.4, '#8fd14f', 4); S.px(eN[0] - 0.3, eN[1] - 0.9, '#e0ff90', 4); S.px(eF[0] + 0.4, eF[1] - 0.4, '#6aa03a', 3);
      S.group(); S.cap(hx + 3.8, hy + 3.2, hx + 5.4, hy + 4.4, 1.9, 1.9, '#555c58'); S.px(hx + 5.8, hy + 4.4, '#2a2e2c', 0); S.px(hx + 4.6, hy + 3.4, '#8a928c', 4); S.line(hx - 5, hy - 2.8, hx - 1, hy - 3, '#1a1c1a', 1); break;
    case 'mask': if (A.maskStyle === 'skull') { S.paint((x, y) => x + 0.5 > hx - 1.4 && y + 0.5 > hy - 5.4, '#e6dcc0', { g: hg }); S.group(); S.ell(eN[0] + 0.4, eN[1], 1.5, 1.4, '#1a1010'); S.ell(eF[0] + 0.3, eF[1], 0.9, 1.3, '#1a1010'); S.px(eN[0] + 0.4, eN[1], A.role === 'psycho' ? '#ff3020' : '#7a2a1a', A.role === 'psycho' ? 4 : 3); for (let k = 0; k < 4; k++) S.px(hx + 1.5 + k, hy + 3.6, '#1a1010', 0); S.px(hx + 4.8, hy + 1.2, '#1a1010', 0); }
      else { S.paint((x, y) => x + 0.5 > hx - 1 && y + 0.5 > hy - 5.6 && y + 0.5 < hy + 5.5, '#d8d2c0', { g: hg }); S.group(); S.ell(eN[0] + 0.3, eN[1], 1.2, 1.0, '#1a1010'); S.ell(eF[0] + 0.3, eF[1], 0.8, 1.0, '#1a1010'); for (const [ox, oy] of [[1.5, 3], [3.5, 3], [2.5, 4.5], [4.5, 4.5]]) S.px(hx + ox, hy + oy, '#3a3030', 1); S.line(hx + 0.5, hy - 4.5, hx + 3.5, hy - 1.5, '#a83020', 3); } break;
    case 'reaper': { const hd = F.hood || '#5a1410';
      S.paint((x, y) => x + 0.5 > hx - 1.4 && y + 0.5 > hy - 5.4, '#e6dcc0', { g: hg });
      S.group(); S.ell(eN[0] + 0.4, eN[1], 1.7, 1.6, '#120808'); S.ell(eF[0] + 0.3, eF[1], 1.0, 1.4, '#120808'); S.px(eN[0] + 0.6, eN[1], '#ff2a1a', 4); S.px(eF[0] + 0.3, eF[1], '#ff6a4a', 4);
      S.px(hx + 5, hy + 1, '#1a0e0e', 0); for (let k = 0; k < 4; k++) { S.px(hx + 1.5 + k, hy + 3.6, '#1a0e0e', 0); S.px(hx + 1.5 + k, hy + 2.8, k & 1 ? '#c8bea0' : '#e6dcc0', 3); }
      S.group(); S.ell(hx - 1.6, hy - 1.8, 8.4, 9.0, hd, { clip: (x, y) => !(x + 0.5 > hx + 0.4 && y + 0.5 > hy - 4.4) });
      S.cap(hx + 0.5, hy - 5.5, hx + 7.4, hy - 4.2, 1.6, 1.2, shade(hd, 0.85));
      S.cap(hx - 4, hy - 7, hx - 9 - sec[0] * 0.5, hy - 11 + sec[1] * 0.5, 2.6, 0.8, hd);   // peaked hood tip
      break; }
  }
}

// ---------------------------------------------------------------- sheet
function smearArc(img, ox, oy, sh, a0, a1, rOut, rIn) {
  // pale crescent along the swing path, only on empty pixels (never over the body)
  const W = img.width, d = img.data, A0 = Math.min(a0, a1), A1 = Math.max(a0, a1), cx = ox + sh[0], cy = oy + sh[1];
  for (let y = Math.floor(cy - rOut - 1); y <= cy + rOut + 1; y++) for (let x = Math.floor(cx - rOut - 1); x <= cx + rOut + 1; x++) {
    if (x < ox || y < oy || x >= ox + HFW || y >= oy + HFH) continue;
    const dx = x + 0.5 - cx, dy = y + 0.5 - cy, r = Math.hypot(dx, dy); let a = Math.atan2(dy, dx) / D2R; if (a < A0 - 180) a += 360;
    if (a < A0 || a > A1) continue;
    const t = (a - A0) / (A1 - A0), th = (rOut - rIn) * (0.25 + 0.75 * t);
    if (r > rOut || r < rOut - th) continue;
    const i = (y * W + x) * 4; if (d[i + 3]) continue;
    const c = r > rOut - 1.2 ? [255, 248, 224] : t > 0.5 ? [228, 220, 196] : [196, 188, 168];
    d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255;
  }
}

/** Build a sprite sheet for a humanoid analysed by look.js. */
export function buildHeroSheet(A) {
  const cols = Math.max(...HANIM_ORDER.map(a => HANIMS[a].n)), rows = HANIM_ORDER.length;
  const [sheet, sg] = mkCanvas(HFW * cols, HFH * rows);
  const img = sg.createImageData(HFW * cols, HFH * rows);
  const info = {};
  const W = weaponSpec(A.weapon);
  HANIM_ORDER.forEach((anim, r) => {
    const n = HANIMS[anim].n; info[anim] = { row: r, n };
    for (let i = 0; i < n; i++) {
      const R = new Raster(HFW, HFH);
      const P = pose(anim, i, A);
      const res = drawFigure(R, A, P);
      const ox = i * HFW, oy = r * HFH;
      R.blit(img, ox, oy);
      res.fx.draw(img, ox, oy);
      if (res.smear && W) {
        if (res.smear === 'thrust') { /* thrust: short speed streaks behind the muzzle */
          const [x, y] = res.tip; for (const dy of [-2, 2]) for (let k = 3; k < 11; k++) { const px = Math.round(ox + x - k), py = Math.round(oy + y + dy), j = (py * img.width + px) * 4; if (px < ox || img.data[j + 3]) continue; img.data[j] = 228; img.data[j + 1] = 220; img.data[j + 2] = 196; img.data[j + 3] = 255; }
        } else { const L = res.tip ? Math.hypot(res.tip[0] - res.shoulder[0], res.tip[1] - res.shoulder[1]) + 1 : 20, ta = res.tip ? Math.atan2(res.tip[1] - res.shoulder[1], res.tip[0] - res.shoulder[0]) / D2R : 0; smearArc(img, ox, oy, res.shoulder, ta - 115, ta - 4, L, L - 5); }
      } else if (res.smear && A.weapon === 'none') smearArc(img, ox, oy, res.shoulder, res.smear[0], res.smear[1], 20, 15);
    }
  });
  sg.putImageData(img, 0, 0);
  return { canvas: sheet, info, anims: HANIMS, fw: HFW, fh: HFH, gy: HGY, hpx: HPX, cols, rows, lyingShadow: true };
}
