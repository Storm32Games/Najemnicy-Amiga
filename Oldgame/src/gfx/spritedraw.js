// Procedural pixel drawing of actors (frame 56x56, centre x=28, ground y=52, facing right).
import { Pix, mkCanvas, shade, mix, parseHex, outlineRegion, rng } from './util.js';
import { isGun } from './look.js';

export const FW = 56, FH = 56, CX = 28, GY = 52;
export const ANIMS = {
  idle: { n: 4, dur: 0.5, loop: true }, walk: { n: 4, dur: 0.12, loop: true }, attack: { n: 4, dur: 0.075 },
  shoot: { n: 3, dur: 0.09 }, hurt: { n: 2, dur: 0.11 }, die: { n: 4, dur: 0.14, hold: true }, cast: { n: 3, dur: 0.13 },
};
export const ANIM_ORDER = ['idle', 'walk', 'attack', 'shoot', 'hurt', 'die', 'cast'];
const rad = (d) => d * Math.PI / 180;

// ---------- weapons (drawn along local +x axis from the grip) ----------
function weaponParts(kind) {
  const S = '#8a929a', D = '#3c4249', W = '#7a4a28', Wd = '#4a2c18', R = '#8a4a28', M = '#c8d0d4';
  switch (kind) {
    case 'rifle': return { len: 17, tip: 17, two: 6, parts: [[-6, -1, 2, W], [-1, 7, 2, D], [7, 17, 1, S], [2, 4, 1, D, 0, 2], [3, 5, 1, D, 0, -2], [8, 9, 1, M, 0, -1]] };
    case 'longgun': return { len: 22, tip: 22, two: 7, parts: [[-6, -1, 2, W], [-1, 7, 2, D], [7, 22, 1, S], [1, 6, 1, '#2a2f34', 0, -2], [6, 6, 1, '#6ac', 0, -2], [3, 4, 2, D, 0, 2]] };
    case 'shotgun': return { len: 18, tip: 18, two: 6, parts: [[-6, 0, 2, Wd], [0, 18, 2, S], [4, 9, 1, W, 0, 2], [0, 18, 1, D, 0, 1]] };
    case 'smg': return { len: 11, tip: 11, two: 4, parts: [[-4, 0, 2, D], [0, 8, 2, '#555d66'], [8, 11, 1, S], [3, 4, 1, D, 0, 2], [3, 3, 3, '#2a2f34', 0, 2]] };
    case 'pistol': return { len: 8, tip: 8, parts: [[0, 6, 2, '#6a727a'], [6, 8, 1, S], [0, 1, 2, W, 0, 2]] };
    case 'laser': return { len: 14, tip: 14, two: 5, parts: [[-4, 0, 2, '#d8d2c0'], [0, 10, 2, '#e8e4d8'], [10, 14, 1, '#46f2c8'], [3, 6, 1, '#2a8a78', 0, -1], [1, 2, 3, '#46f2c8', 0, 0]] };
    case 'bow': return { len: 12, tip: 12, parts: [[0, 0, 12, W, 4, 0], [1, 1, 10, '#e6dcc0', 3, 0]] };
    case 'knife': return { len: 9, tip: 9, parts: [[-2, 0, 2, Wd], [0, 1, 3, '#555'], [1, 9, 2, M], [1, 8, 1, '#fff', 0, -1]] };
    case 'machete': return { len: 14, tip: 14, parts: [[-2, 0, 2, Wd], [0, 14, 2, M], [4, 13, 1, '#fff', 0, -1], [10, 14, 3, M]] };
    case 'sledge': return { len: 20, tip: 20, parts: [[-4, 15, 2, W], [14, 20, 6, '#777f88'], [14, 20, 3, '#aab2ba', 0, -1], [14, 15, 6, '#444b52']] };
    case 'axe': return { len: 17, tip: 17, parts: [[-4, 15, 2, W], [12, 17, 6, '#8a929a'], [12, 17, 2, '#d0d8dc', 0, -2], [11, 12, 5, '#444b52']] };
    case 'pipe': return { len: 15, tip: 15, parts: [[-3, 15, 3, R], [-3, 15, 1, '#b86a3a', 0, -1], [12, 14, 1, '#ccc', 0, -2]] };
    case 'scythe': return { len: 22, tip: 22, parts: [[-8, 18, 2, '#3a2418'], [12, 20, 3, '#c8d0d4', 0, -3], [18, 24, 2, '#e8eef0', 0, -4], [8, 14, 1, '#888', 0, -4]] };
    default: return null;
  }
}
function drawWeapon(p, kind, hx, hy, ang, flip = 1) {
  const wp = weaponParts(kind); if (!wp) return null;
  const c = Math.cos(rad(ang)), s = Math.sin(rad(ang));
  const tf = (ax, ay) => [hx + ax * c - ay * s, hy + ax * s + ay * c];
  for (const [a0, a1, th, col, , off = 0] of wp.parts) {
    if (kind === 'bow') { // arc
      const ax = 4; const [x0, y0] = tf(a0 - 1, -6), [xm, ym] = tf(a0 + 3, 0), [x1, y1] = tf(a0 - 1, 6);
      p.line(x0, y0, xm, ym, col, 1); p.line(xm, ym, x1, y1, col, 1); p.line(x0, y0, x1, y1, '#e6dcc0', 1); continue;
    }
    const [x0, y0] = tf(a0, off), [x1, y1] = tf(a1, off);
    p.line(x0, y0, x1, y1, col, Math.max(1, th));
  }
  const [tx, ty] = tf(wp.tip, 0); const [bx, by] = wp.two ? tf(wp.two, 0) : [null, null];
  return { tip: [tx, ty], back: [bx, by], gun: isGun(kind) };
}

function limb(p, a, b, t, col, bend = [0, 0]) {
  const mx = (a[0] + b[0]) / 2 + bend[0], my = (a[1] + b[1]) / 2 + bend[1];
  p.line(a[0] + 1, a[1], mx + 1, my, shade(col, 0.72), t); p.line(mx + 1, my, b[0] + 1, b[1], shade(col, 0.72), t);
  p.line(a[0], a[1], mx, my, col, t); p.line(mx, my, b[0], b[1], col, t);
}

// ---------- poses ----------
function humanPose(anim, i, A) {
  const gun = isGun(A.weapon), idleW = gun ? 14 : -62, idleA = gun ? 62 : 28;
  const P = { dx: 0, bob: 0, lean: 0, crouch: 0, ff: 0, bf: 0, ffl: 0, bfl: 0, aF: idleA, aB: 70, wA: idleW };
  const ease = (a, b, t) => a + (b - a) * t;
  switch (anim) {
    case 'idle': P.bob = [0, 0, 1, 1][i]; P.aF += [0, 1, 3, 2][i]; P.wA += [0, 0, 2, 1][i]; P.aB += [0, 1, 3, 2][i]; break;
    case 'walk': P.ff = [4, 0, -4, 0][i]; P.bf = -P.ff; P.bfl = [0, 2, 0, 0][i]; P.ffl = [0, 0, 0, 2][i]; P.bob = [0, 1, 0, 1][i]; P.aF += [-6, 0, 6, 0][i]; P.aB += [6, 0, -6, 0][i]; if (!gun) P.wA = -62 + [-8, 0, 8, 0][i]; break;
    case 'attack': { const f = [[-135, -2, -2], [-70, 0, 0], [30, 3, 3], [55, 1, 1]][i]; P.aF = f[0]; P.wA = f[0] - 8; P.lean = f[1]; P.dx = f[2]; P.aB = f[0] + 20; if (i === 0) P.crouch = 1; P.swoosh = i === 1 ? [-135, -70] : i === 2 ? [-70, 30] : null; if (gun) { P.wA = f[0] + 40; } break; }
    case 'shoot': { const f = [[18, 8, 0], [-4, -6, -1], [-2, -2, 0]][i]; P.aF = f[0]; P.wA = f[1]; P.dx = f[2]; P.aB = f[0] + 4; P.flash = i === 1; if (!gun) { P.aF = [-100, -60, 10][i]; P.wA = P.aF - 8; P.flash = false; } P.lean = i === 1 ? -1 : 0; break; }
    case 'hurt': P.dx = [-2, -1][i]; P.lean = [-3, -2][i]; P.aF = [110, 90][i]; P.aB = [20, 50][i]; P.wA = [40, 30][i]; P.bob = 0; P.hurt = true; P.crouch = i === 0 ? 1 : 0; break;
    case 'cast': { const f = [[40, 0], [-75, 0], [-85, 1]][i]; P.aF = f[0]; P.wA = f[0]; P.bob = f[1]; P.item = true; P.itemGlow = i; P.aB = 80; break; }
    case 'die': { P.dx = [-2, -3, 0, 0][i]; P.lean = [-4, -5, 0, 0][i]; P.crouch = [2, 6, 0, 0][i]; P.aF = [120, 130, 0, 0][i]; P.aB = [20, 10, 0, 0][i]; P.wA = [60, 90, 0, 0][i]; P.hurt = true; P.dropWeapon = i >= 1; break; }
  }
  return P;
}

// ---------- humanoid ----------
function drawHuman(p, A, P) {
  const g = p.g; const cx = CX + P.dx;
  const bw = A.bw, tw = A.machine ? 11 : bw === 'heavy' ? 14 : bw === 'light' ? 9 : 11, lw = bw === 'heavy' ? 5 : bw === 'light' ? 3 : 4;
  const legLen = 15 - P.crouch, hipY = GY - legLen;
  const sY = hipY - 14 - P.bob;
  const lean = P.lean, tx = cx + Math.round(lean * 0.5), hunch = A.hunch ? 2 : 0;
  const hx = cx + lean + hunch, ht = sY - 10 + (A.hunch ? 2 : 0);
  const pants = A.pants, boot = A.boot;
  // legs
  const leg = (hipX, foff, lift, col, back) => {
    const fx = hipX + foff, fy = GY - lift;
    limb(p, [hipX, hipY], [fx, fy - 2], lw, col, [1 + P.crouch * 0.4 + (lift ? 1 : 0), 0]);
    p.r(fx - 1, fy - 2, lw + 1, 2, back ? shade(boot, 0.8) : boot); p.r(fx + 2, fy - 1, 2, 1, back ? shade(boot, 0.8) : '#3a2c20'); p.r(fx - 1, fy - 1, lw + 3, 1, back ? '#1c140e' : '#1a120c');
  };
  leg(cx - 1, P.bf, P.bfl, shade(pants, 0.78), true);
  // back arm (before torso)
  const shoulder = [tx, sY + 2];
  const wpn = P.item ? null : A.weapon;
  const front = [shoulder[0] + Math.cos(rad(P.aF)) * 10, shoulder[1] + Math.sin(rad(P.aF)) * 10];
  const sleeve = A.cls === 'brute' || A.mutant ? A.skin : A.cloth2, handCol = A.machine ? '#9aa4aa' : A.skin;
  const wdef = wpn && !P.dropWeapon ? weaponParts(wpn) : null;
  let backHand = [shoulder[0] + Math.cos(rad(P.aB)) * 9, shoulder[1] + Math.sin(rad(P.aB)) * 9];
  if (wdef && wdef.two && !P.hurt) { const c = Math.cos(rad(P.wA)), s = Math.sin(rad(P.wA)); backHand = [front[0] + wdef.two * c, front[1] + wdef.two * s]; }
  // backpack
  drawPack(p, A, tx, sY, tw);
  limb(p, shoulder, backHand, lw - 1 > 2 ? lw - 1 : 2, shade(sleeve, 0.78), [0, 1]); p.r(backHand[0] - 1, backHand[1] - 1, 2, 2, shade(handCol, 0.75));
  // torso
  const tl = tx - Math.floor(tw / 2), th = hipY + 1 - sY;
  p.r(tl, sY, tw, th, A.cloth);
  p.r(tl, sY, 2, th, shade(A.cloth, 1.28)); p.r(tl + tw - 2, sY, 2, th, shade(A.cloth, 0.7)); p.r(tl, hipY - 1, tw, 2, shade(A.cloth, 0.55));
  p.r(tl + 1, sY, tw - 2, 1, shade(A.cloth, 1.2));
  classDetail(p, A, tl, sY, tw, th, hipY);
  // belt
  p.r(tl, hipY - 2, tw, 1, '#2a2018'); p.r(tx, hipY - 2, 2, 1, '#c9a468');
  leg(cx + 1, P.ff, P.ffl, pants, false);
  // head
  drawHead(p, A, hx, ht, P);
  // front arm + weapon
  if (wdef) {
    const w = drawWeapon(p, wpn, front[0], front[1], P.wA);
    if (P.flash && w && w.gun) flash(p, w.tip[0], w.tip[1], P.wA);
    P.tip = w && w.tip;
  }
  limb(p, shoulder, front, lw - 1 > 2 ? lw - 1 : 2, sleeve, [0, 1]); p.r(front[0] - 1, front[1] - 1, 3, 3, handCol); p.px(front[0] - 1, front[1] - 1, shade(handCol, 1.2));
  if (A.mutant) { for (let k = 0; k < 3; k++) p.line(front[0] + 1, front[1] - 1 + k, front[0] + 4, front[1] + k * 1.5, '#e6e0c0', 1); }
  if (P.item) {
    const col = A.accent, gl = P.itemGlow | 0;
    p.r(front[0] - 1, front[1] - 4, 3, 4, '#9ad8e8'); p.r(front[0], front[1] - 3, 1, 2, '#fff'); p.r(front[0] - 1, front[1] - 5, 3, 1, '#555');
    if (gl >= 1) { for (let k = 0; k < 6; k++) { const a = k * 1.05 + gl, r2 = 4 + gl * 2; p.px(front[0] + Math.cos(a) * r2, front[1] - 3 + Math.sin(a) * r2, k % 2 ? '#8fff9a' : '#fff'); } }
  }
  P.front = front; P.shoulder = shoulder;
}

function drawPack(p, A, tx, sY, tw) {
  const bx = tx - Math.floor(tw / 2) - 4;
  if (A.cls === 'techie') { p.r(bx, sY + 1, 5, 11, '#3a4a54'); p.r(bx, sY + 1, 1, 11, '#566a76'); p.r(bx + 1, sY + 3, 3, 2, '#f2c03b'); p.px(bx + 2, sY + 7, '#46f2c8'); p.px(bx + 3, sY + 7, '#46f2c8'); p.line(bx + 1, sY + 1, bx - 1, sY - 6, '#7f9aa8'); p.px(bx - 1, sY - 7, '#ff5030'); }
  else if (A.cls === 'scout') { p.r(bx + 1, sY + 2, 4, 9, '#5a4a30'); p.r(bx + 1, sY + 2, 1, 9, '#7a6a48'); p.r(bx, sY - 1, 6, 3, '#8a6a3a'); p.r(bx, sY, 6, 1, '#b08a4a'); }
  else if (A.cls === 'scavenger') { p.ell(bx + 2, sY + 6, 4, 6, '#6a5a3a'); p.ell(bx + 1, sY + 4, 2, 3, '#8a7a52'); p.r(bx + 2, sY - 1, 3, 2, '#2a2018'); p.px(bx, sY + 8, '#b4532a'); }
  else if (A.cls === 'medic') { p.r(bx + 1, sY + 4, 4, 7, '#d8d2c0'); p.r(bx + 2, sY + 6, 2, 1, '#c43d2f'); p.r(bx + 3, sY + 5, 0, 0, '#c43d2f'); p.r(bx + 3, sY + 5, 1, 3, '#c43d2f'); }
  else if (A.cls === 'soldier') { p.r(bx + 2, sY + 4, 3, 8, '#44502c'); p.r(bx + 2, sY + 4, 1, 8, '#5d6a3a'); }
  else if (A.role === 'chief' || A.boss) { p.r(bx - 1, sY - 1, 6, 5, A.boss ? '#7a1d17' : '#555'); p.r(bx - 3, sY + 3, 4, 14, A.boss ? '#5a1410' : '#4a3a2a'); }
  else if (A.mutant) { p.ell(bx + 3, sY + 3, 4, 4, shade(A.skin, 0.8)); p.px(bx + 2, sY + 2, shade(A.skin, 1.4)); p.px(bx + 4, sY + 5, '#c8e04a'); }
}

function classDetail(p, A, tl, sY, tw, th, hipY) {
  const c = A.cloth, a = A.accent;
  if (A.machine) { p.r(tl + 2, sY + 3, tw - 4, 5, '#3a4048'); p.r(tl + 3, sY + 4, 2, 2, '#e0402a'); p.px(tl + 6, sY + 5, '#46f2c8'); p.r(tl, sY + 9, tw, 1, '#4a525a'); return; }
  if (A.cls === 'soldier') { p.r(tl + 1, sY + 2, tw - 2, 8, shade(c, 0.82)); p.r(tl + 2, sY + 3, 3, 3, shade(c, 1.1)); p.r(tl + tw - 4, sY + 7, 3, 3, shade(c, 0.6)); p.r(tl + 1, sY + 6, tw - 2, 1, a); p.r(tl - 1, sY, 3, 3, shade('#7a8a4a', 0.9)); p.px(tl, sY + 1, '#e6dcc0'); }
  else if (A.cls === 'scout') { p.r(tl, sY, tw, 4, shade(c, 0.78)); p.line(tl, sY + 2, tl + tw - 1, hipY - 2, a, 1); p.r(tl + 1, sY + 8, 2, 3, '#3a2c1c'); }
  else if (A.cls === 'medic') { p.r(tl + 1, sY + 2, tw - 2, 10, '#ece6d6'); p.r(tl + tw - 3, sY + 2, 2, 10, '#c9c2b0'); p.r(tl + 3, sY + 4, 4, 1, a); p.r(tl + 4, sY + 3, 2, 3, a); p.line(tl + tw / 2, sY + 2, tl + tw / 2, hipY - 3, '#b5ae9c', 1); }
  else if (A.cls === 'techie') { p.r(tl + 1, sY + 2, tw - 2, 4, '#cfa23a'); p.r(tl + 1, sY + 6, tw - 2, 5, shade(c, 0.9)); p.px(tl + 3, sY + 8, '#46f2c8'); p.px(tl + 5, sY + 8, '#ff7a1e'); p.r(tl + tw - 3, sY + 3, 2, 8, '#3a4a54'); }
  else if (A.cls === 'scavenger') { p.r(tl, sY, tw, 5, shade(c, 0.7)); p.line(tl, sY + 4, tl + tw - 1, sY + 9, '#2a2018', 1); p.r(tl + 2, sY + 9, 3, 2, a); p.px(tl + 6, sY + 7, '#8a7a52'); }
  else if (A.cls === 'brute') { p.r(tl + 2, sY + 1, tw - 3, 9, A.skin); p.r(tl + 3, sY + 2, 4, 3, shade(A.skin, 1.2)); p.line(tl + 3, sY + 5, tl + 8, sY + 5, shade(A.skin, 0.7), 1); p.r(tl, sY, 3, tw > 12 ? 6 : 4, '#3a2a1a'); p.line(tl, sY, tl + tw - 2, sY + 11, '#2a1a10', 2); p.px(tl + tw - 2, sY + 11, a); }
  else if (A.mutant) { p.r(tl, sY, tw, 5, shade(A.skin, 0.85)); p.r(tl + 2, sY + 5, 3, 2, shade(A.skin, 0.6)); p.px(tl + 6, sY + 3, '#c8e04a'); p.px(tl + 4, sY + 8, '#e8d44a'); p.r(tl + 6, sY + 7, 3, 4, shade(A.skin, 1.15)); }
  else { // raider rig
    p.r(tl, sY + 1, tw, 4, shade(c, 0.7)); p.line(tl, sY + 5, tl + tw - 1, hipY - 3, shade(c, 0.45), 2); p.px(tl + 3, sY + 6, a); p.px(tl + 7, sY + 9, a); p.r(tl + 2, sY + 8, 2, 2, '#8a7a52');
    // spiked pauldron
    const px = tl + 3;
    p.r(px - 3, sY - 1, 7, 3, '#4a4a50'); p.r(px - 3, sY - 1, 7, 1, '#7a7a82');
    p.px(px - 2, sY - 3, '#aab'); p.px(px - 2, sY - 2, '#889'); p.px(px, sY - 4, '#cdd'); p.px(px, sY - 3, '#889'); p.px(px + 2, sY - 3, '#aab'); p.px(px + 2, sY - 2, '#889');
    p.px(px - 4, sY, '#889');
  }
  if (A.boss) { p.r(tl - 1, sY, tw + 2, 4, '#8a1812'); p.r(tl + 2, sY + 4, tw - 4, 7, '#2a0c0a'); p.r(tl + 3, sY + 6, 3, 3, '#e6dcc0'); p.px(tl + 4, sY + 7, '#2a0c0a'); p.px(tl + 3, sY + 9, '#e6dcc0'); p.r(tl, sY - 2, 4, 3, '#4a4a50'); p.px(tl, sY - 4, '#ccd'); p.px(tl + 2, sY - 4, '#ccd'); }
}

function drawHead(p, A, hx, ht, P) {
  const skin = A.skin, sk2 = shade(skin, 0.75), sk3 = shade(skin, 1.18);
  const hurt = P.hurt;
  if (A.machine) { // boxy robot head
    p.r(hx - 4, ht + 1, 9, 9, '#7a828a'); p.r(hx - 4, ht + 1, 9, 1, '#aab4ba'); p.r(hx + 3, ht + 2, 2, 7, '#565e66'); p.r(hx - 1, ht + 4, 6, 3, '#1a1010'); p.r(hx + 1, ht + 5, 4, 1, '#ff3020'); p.px(hx + 2, ht + 5, '#ffa080'); p.line(hx - 2, ht + 1, hx - 3, ht - 4, '#aab', 1); p.px(hx - 3, ht - 5, '#ff3020'); p.r(hx - 2, ht + 10, 4, 2, '#444b52'); return;
  }
  // neck
  p.r(hx - 1, ht + 9, 3, 2, sk2);
  // head block with rounded corners
  p.r(hx - 4, ht + 1, 9, 9, skin); p.r(hx - 3, ht, 7, 1, skin); p.r(hx - 3, ht + 10, 7, 1, sk2);
  p.r(hx + 4, ht + 2, 1, 7, sk2); p.r(hx - 4, ht + 2, 1, 6, shade(skin, 0.9)); p.r(hx - 3, ht + 1, 3, 1, sk3);
  p.px(hx + 5, ht + 5, skin); p.px(hx + 5, ht + 6, sk2); // nose
  p.px(hx - 3, ht + 6, sk2); p.px(hx - 3, ht + 5, sk2); // ear
  if (A.mutation && !A.mutant) { p.px(hx + 2, ht + 8, '#8fd14f'); p.px(hx - 1, ht + 2, '#8fd14f'); p.px(hx, ht + 3, shade('#8fd14f', 0.7)); }
  const gasMask = A.head === 'gas', skullMask = (A.head === 'mask' || A.head === 'reaper') && A.maskStyle === 'skull', hockey = A.head === 'mask' && A.maskStyle === 'hockey';
  // face
  if (!gasMask && !skullMask && !hockey) {
    const eyeCol = A.mutant ? '#d8e84a' : '#1a1410';
    p.px(hx + 2, ht + 4, '#f2ecde'); p.px(hx + 3, ht + 4, hurt ? '#1a1410' : eyeCol); if (A.mutant) { p.px(hx + 2, ht + 4, '#9ad23a'); p.px(hx, ht + 3, '#d8e84a'); }
    p.r(hx + 1, ht + 3, 3, 1, shade(A.hair, 0.8)); // brow
    p.r(hx + 2, ht + 8, 2, 1, hurt ? '#4a1010' : sk2); if (hurt) p.px(hx + 2, ht + 8, '#2a0808');
    if (A.cyber) { p.r(hx + 1, ht + 3, 3, 3, '#3a3f46'); p.px(hx + 3, ht + 4, '#ff3a2a'); p.px(hx + 2, ht + 4, '#ff9a8a'); p.r(hx - 3, ht + 1, 2, 5, '#7a828a'); p.px(hx - 3, ht + 2, '#c8d0d4'); }
    if (A.cls === 'scavenger' || A.head === 'hood' && A.cls === 'scavenger') p.r(hx, ht + 6, 5, 4, '#5a4a32'), p.px(hx + 1, ht + 7, '#7a6a4a');
    if (A.nomad && A.head !== 'hood') p.r(hx, ht + 7, 5, 3, '#c9a468');
  }
  // hair
  const hc = A.hair, hs = shade(hc, 1.3), hd = shade(hc, 0.7);
  const noHair = ['helmet', 'hood', 'machine', 'reaper'].includes(A.head);
  if (!noHair) {
    switch (A.hairStyle % 6) {
      case 0: if (A.head === 'none' || A.head === 'cap') p.r(hx - 4, ht, 9, 2, hc), p.r(hx - 4, ht + 2, 2, 3, hc); break; // short
      case 1: break; // bald
      case 2: p.r(hx - 1, ht - 3, 3, 3, hc); p.px(hx, ht - 5, hc); p.px(hx - 1, ht - 4, hs); p.px(hx + 1, ht - 4, hc); p.r(hx - 3, ht, 7, 1, hd); p.px(hx, ht - 3, hs); if (A.raider) { p.r(hx - 1, ht - 3, 3, 2, A.accent); p.px(hx, ht - 5, A.accent); } break; // mohawk
      case 3: p.r(hx - 5, ht, 10, 3, hc); p.r(hx - 6, ht + 2, 4, 9, hc); p.px(hx - 6, ht + 11, hd); p.r(hx - 5, ht, 8, 1, hs); break; // long
      case 4: p.r(hx - 4, ht, 9, 1, hc); p.r(hx - 4, ht + 1, 3, 2, hc); break; // buzz
      case 5: p.r(hx - 4, ht, 9, 3, hc); p.r(hx - 4, ht + 3, 2, 3, hc); p.r(hx - 7, ht + 1, 3, 3, hc); p.r(hx - 8, ht + 3, 2, 6, hd); break; // ponytail
    }
  }
  // headgear
  switch (A.head) {
    case 'helmet': { const h = '#66714a'; p.r(hx - 5, ht - 2, 10, 5, h); p.r(hx - 4, ht - 3, 8, 1, h); p.r(hx - 5, ht - 2, 10, 1, shade(h, 1.35)); p.r(hx - 5, ht + 3, 11, 1, shade(h, 0.55)); p.r(hx + 3, ht - 2, 2, 5, shade(h, 0.75)); p.px(hx - 1, ht - 1, A.accent); p.px(hx, ht - 1, A.accent); p.r(hx - 4, ht + 4, 1, 4, shade(h, 0.7)); p.px(hx + 1, ht + 3, '#2a2a20'); break; }
    case 'hood': { const h = A.cloth2; p.r(hx - 5, ht - 2, 10, 5, h); p.r(hx - 4, ht - 3, 7, 1, h); p.r(hx - 6, ht + 1, 3, 11, shade(h, 0.85)); p.r(hx - 5, ht - 2, 8, 1, shade(h, 1.3)); p.r(hx + 3, ht - 1, 2, 3, shade(h, 0.7)); p.r(hx - 3, ht + 3, 1, 7, shade(h, 0.6)); p.px(hx + 4, ht + 3, shade(h, 0.6)); if (A.cls === 'scout') p.r(hx - 2, ht + 8, 7, 3, A.accent), p.px(hx - 2, ht + 8, shade(A.accent, 1.3)); break; }
    case 'headband': p.r(hx - 5, ht + 1, 11, 2, '#f2ecde'); p.r(hx + 1, ht, 2, 4, A.accent); p.r(hx, ht + 1, 4, 2, A.accent); p.r(hx - 7, ht + 2, 3, 1, '#f2ecde'); p.px(hx - 8, ht + 3, '#d8d2c0'); break;
    case 'goggles': { p.r(hx - 5, ht + 3, 11, 1, '#3a2a1a'); p.r(hx + 1, ht + 2, 5, 4, '#2a2420'); p.r(hx + 2, ht + 3, 3, 2, '#f2c03b'); p.px(hx + 2, ht + 3, '#fff6c0'); p.px(hx + 4, ht + 4, '#c08a1a'); p.r(hx - 4, ht - 1, 9, 1, '#3a2a1a'); break; }
    case 'cap': p.r(hx - 5, ht - 1, 10, 3, '#2a2a2e'); p.r(hx + 2, ht + 1, 5, 1, '#1a1a1e'); p.r(hx - 5, ht - 1, 10, 1, '#4a4a52'); p.px(hx, ht, A.accent); break;
    case 'gas': { p.r(hx - 4, ht + 3, 9, 8, '#2e332f'); p.r(hx - 4, ht + 3, 9, 1, '#4a524a'); p.r(hx + 1, ht + 3, 4, 3, '#1a1f1c'); p.r(hx + 2, ht + 4, 2, 2, '#8fd14f'); p.px(hx + 2, ht + 4, '#e0ff90'); p.r(hx + 5, ht + 7, 3, 3, '#555c58'); p.r(hx + 5, ht + 7, 3, 1, '#8a928c'); p.r(hx - 5, ht + 2, 11, 1, '#1a1c1a'); p.r(hx + 2, ht + 9, 3, 1, '#1a1f1c'); break; }
    case 'mask': case 'reaper': {
      if (A.maskStyle === 'skull') { p.r(hx - 4, ht + 1, 9, 9, '#e6dcc0'); p.r(hx - 3, ht, 7, 1, '#e6dcc0'); p.r(hx + 4, ht + 2, 1, 7, '#a89c80'); p.r(hx + 1, ht + 3, 3, 3, '#1a1010'); p.px(hx + 2, ht + 4, A.boss ? '#ff3020' : '#6a1a10'); p.r(hx - 3, ht + 3, 2, 2, '#1a1010'); p.px(hx + 3, ht + 7, '#1a1010'); p.r(hx + 1, ht + 8, 4, 1, '#1a1010'); p.px(hx + 2, ht + 9, '#1a1010'); p.px(hx + 4, ht + 9, '#1a1010'); p.px(hx - 3, ht + 1, '#fff'); }
      else { p.r(hx - 4, ht + 1, 9, 9, '#d8d2c0'); p.r(hx - 3, ht, 7, 1, '#d8d2c0'); p.r(hx + 4, ht + 2, 1, 7, '#9a9484'); p.r(hx + 1, ht + 3, 3, 2, '#1a1010'); p.px(hx + 2, ht + 6, '#1a1010'); p.px(hx + 3, ht + 6, '#1a1010'); p.px(hx + 2, ht + 7, '#1a1010'); p.px(hx + 3, ht + 8, '#1a1010'); p.px(hx + 1, ht + 8, '#1a1010'); p.px(hx - 1, ht + 2, A.accent); p.px(hx - 2, ht + 3, A.accent); p.px(hx, ht + 3, A.accent); }
      if (A.head === 'reaper') { const h = '#7a1d17'; p.r(hx - 6, ht - 3, 12, 5, h); p.r(hx - 5, ht - 4, 9, 1, h); p.r(hx - 7, ht + 1, 4, 12, shade(h, 0.75)); p.r(hx - 6, ht - 3, 10, 1, shade(h, 1.4)); p.r(hx + 3, ht - 3, 3, 6, shade(h, 0.65)); p.px(hx - 5, ht - 6, '#e6dcc0'); p.px(hx - 5, ht - 5, '#e6dcc0'); p.px(hx + 3, ht - 6, '#e6dcc0'); p.px(hx + 3, ht - 5, '#e6dcc0'); }
      break; }
  }
}

function flash(p, x, y, ang) {
  const c = Math.cos(rad(ang)), s = Math.sin(rad(ang));
  p.line(x, y, x + c * 7, y + s * 7, '#ffe27a', 3); p.line(x + c * 2, y + s * 2, x + c * 9, y + s * 9, '#fff6c8', 1);
  for (const [a, l] of [[-40, 4], [40, 4], [-80, 3], [80, 3]]) p.line(x, y, x + Math.cos(rad(ang + a)) * l, y + Math.sin(rad(ang + a)) * l, '#ff9a30', 1);
}

// ---------- beasts ----------
function drawBeast(p, A, o) {
  const v = A.variant || 'dog'; const rat = v === 'rat', boar = v === 'boar', wolf = v === 'wolf';
  const s = rat ? 0.68 : boar ? 1.15 : 1; const col = rat ? '#6a5a50' : wolf ? '#6a625a' : boar ? '#5a3e30' : A.cloth && A.R ? ['#6a4a30', '#5a5048', '#8a6a40', '#4a4038'][A.seed % 4] : '#6a4a30';
  const bl = Math.round(22 * s), bh = Math.round(10 * s), ll = Math.round(9 * s);
  const cx = CX + (o.dx || 0), bodyY = GY - ll - bh / 2 + (o.bob || 0), phase = o.phase || 0;
  const dk = shade(col, 0.6), lt = shade(col, 1.3), bel = shade(col, 1.15);
  const R = rng(A.seed);
  const front = cx + bl / 2 - 2, rear = cx - bl / 2 + 3;
  // tail
  if (rat) { for (let i = 0; i < 12; i++) { p.px(rear - 2 - i, GY - 3 - Math.round(Math.sin(i * 0.7 + phase) * 1.5) + (i > 8 ? -(i - 8) : 0), '#c98a88'); } }
  else { p.line(rear - 1, bodyY - 2, rear - 6, bodyY - 7 - (o.tailUp || 0), dk, 2); p.px(rear - 7, bodyY - 8 - (o.tailUp || 0), shade(col, 0.8)); }
  const leg = (x, ph, far) => {
    const sw = Math.sin(ph) * 4, lift = Math.max(0, Math.cos(ph)) * 3, c = far ? shade(col, 0.62) : shade(col, 0.82);
    const fx = x + sw, fy = GY - lift; const kx = x + sw * 0.4 + 2;
    p.line(x, bodyY + bh / 2 - 2, kx, GY - ll * 0.45 - lift * 0.5, c, 3); p.line(kx, GY - ll * 0.45 - lift * 0.5, fx, fy - 1, c, 2);
    p.r(fx - 1, fy - 1, 4, 2, far ? '#2a2018' : '#3a2c20');
  };
  leg(rear + 2, phase + 3.14, true); leg(front - 2, phase, true);
  // body
  p.ell(cx, bodyY, bl / 2, bh / 2, col); p.ell(cx, bodyY + 1, bl / 2 - 1, bh / 2 - 1, col);
  p.r(cx - bl / 2 + 3, bodyY - bh / 2, bl - 6, 2, lt); p.r(cx - bl / 2 + 2, bodyY + bh / 2 - 2, bl - 4, 2, dk); p.r(cx - 3, bodyY + 1, 7, 2, bel);
  const mang = (A.seed >>> 3) % 3; for (let k = 0; k < 7; k++) p.px(cx - bl / 2 + 3 + R() * (bl - 6), bodyY - bh / 2 + 2 + R() * (bh - 3), R() < 0.5 ? dk : lt);
  if (!rat && !boar) { for (let k = 0; k < 4; k++) p.line(cx - 4 + k * 3, bodyY - 1, cx - 3 + k * 3, bodyY + 2, shade(col, 0.65), 1); } // ribs
  if (A.mutation || A.seed % 5 === 0) { for (let k = 0; k < 4; k++) { p.px(cx - 6 + k * 3, bodyY - bh / 2 - 1, '#c8e04a'); p.px(cx - 6 + k * 3, bodyY - bh / 2, '#6a8a2a'); } p.px(cx + 2, bodyY - 1, '#c8e04a'); p.px(cx + 3, bodyY - 1, '#7a9a2a'); }
  if (boar) { for (let k = 0; k < 5; k++) p.line(cx - 8 + k * 3, bodyY - bh / 2 + 1, cx - 8 + k * 3 + 1, bodyY - bh / 2 - 2, dk, 1); }
  leg(rear, phase + 3.14 + 0.6, false); leg(front, phase + 0.6, false);
  // head
  const hy = bodyY - bh / 2 + 1 + (o.headDy || 0), hx = cx + bl / 2 + 1 + (o.lunge || 0);
  const hr = rat ? 4 : boar ? 6 : 5;
  p.ell(hx, hy + 2, hr, hr - 1, col);
  p.r(hx + hr - 2, hy + 1, rat ? 6 : 7, rat ? 3 : 4, shade(col, 1.05)); // snout
  p.r(hx + hr - 2, hy + 1, rat ? 6 : 7, 1, lt);
  p.px(hx + hr + (rat ? 4 : 5), hy + 1, '#1a1010'); p.px(hx + hr + (rat ? 4 : 5), hy + 2, '#1a1010'); // nose
  const jaw = o.jaw || 0;
  p.r(hx + hr - 2, hy + 4 + jaw, rat ? 5 : 6, 2, dk);
  if (jaw) { p.r(hx + hr - 1, hy + 4, 5, jaw, '#7a1d17'); p.px(hx + hr, hy + 4, '#fff'); p.px(hx + hr + 2, hy + 4, '#fff'); p.px(hx + hr + 4, hy + 4, '#fff'); p.px(hx + hr + 1, hy + 4 + jaw, '#fff'); p.px(hx + hr + 3, hy + 4 + jaw, '#fff'); }
  else if (!rat) { p.px(hx + hr + 1, hy + 4, '#fff'); p.px(hx + hr + 3, hy + 4, '#fff'); }
  if (rat) { p.px(hx + hr + 3, hy + 4, '#fff'); for (let k = 0; k < 3; k++) p.px(hx + hr + 5 + k, hy + 2 + (k % 2) * 2, '#ddd'); }
  // ears
  p.line(hx - 2, hy, hx - 3, hy - (rat ? 4 : 5), dk, 2); p.px(hx - 3, hy - (rat ? 5 : 6), shade(col, 0.5)); if (rat) p.r(hx - 4, hy - 4, 3, 3, '#c98a88');
  p.line(hx + 1, hy, hx + 1, hy - 4, shade(col, 0.7), 2);
  // eye
  const eye = A.mutation || wolf || A.seed % 3 === 0 ? '#ff3020' : '#f2c03b';
  p.px(hx + 2, hy + 1, eye); p.px(hx + 3, hy + 1, eye); p.px(hx + 3, hy, '#fff'); p.px(hx + 1, hy + 1, shade(eye, 0.6));
  if (A.mutation || mang === 1) { p.px(hx + 1, hy - 1, '#d8e84a'); p.px(hx, hy - 1, '#d8e84a'); }
}
function beastPose(anim, i, A) {
  const o = { phase: 0, dx: 0, bob: 0, jaw: 0, lunge: 0, headDy: 0 };
  switch (anim) {
    case 'idle': o.bob = [0, 0, 1, 0][i]; o.headDy = [0, 1, 1, 0][i]; o.phase = 0.2; o.tailUp = [0, 1, 2, 1][i]; break;
    case 'walk': o.phase = i * Math.PI / 2; o.bob = [0, 1, 0, 1][i]; o.headDy = [0, -1, 0, -1][i]; break;
    case 'attack': o.dx = [-3, 1, 5, 2][i]; o.lunge = [-1, 2, 3, 1][i]; o.jaw = [0, 3, 3, 0][i]; o.phase = [0.3, 1.2, 2, 0][i]; o.headDy = [1, 0, 2, 0][i]; o.bob = [1, -1, 0, 0][i]; o.swoosh = i === 2 ? 1 : 0; break;
    case 'shoot': o.dx = [-2, 0, 0][i]; o.headDy = [-2, -3, -1][i]; o.jaw = [2, 3, 1][i]; o.bob = [0, -1, 0][i]; o.spit = i === 1; break;
    case 'hurt': o.dx = [-2, -1][i]; o.headDy = [-2, -1][i]; o.jaw = [3, 1][i]; o.bob = 0; break;
    case 'cast': o.headDy = [-1, -3, -3][i]; o.jaw = [0, 2, 2][i]; o.bob = [0, 0, 1][i]; o.tailUp = 3; break;
    case 'die': o.dx = [-2, -2, 0, 0][i]; o.jaw = 2; o.headDy = [-2, 1, 1, 1][i]; o.bob = [0, 0, 0, 0][i]; o.phase = 0.5; break;
  }
  return o;
}

// ---------- insects ----------
function drawInsect(p, A, o) {
  const v = A.variant; const cx = CX + (o.dx || 0);
  const base = ['#3f7a2a', '#7a3a1a', '#5a3a6a', '#2a4a6a', '#7a6a1a'][A.seed % 5];
  const c = v === 'spider' ? '#3a2e3a' : v === 'scorpion' ? '#8a6a2a' : base, dk = shade(c, 0.55), lt = shade(c, 1.5), ph = o.phase || 0;
  const by = GY - 9 + (o.bob || 0);
  const bug = (bx, by2, sc, t) => {
    const legc = shade(c, 0.5), n = v === 'spider' ? 4 : 3;
    for (let k = 0; k < n; k++) for (const side of [0, 1]) {
      const bxk = bx - 3 * sc + k * 3.2 * sc + (v === 'spider' ? 1 : 0); const sw = Math.sin(ph + k * 1.6 + side * 3.14) * 2.5 * sc, lf = Math.max(0, Math.cos(ph + k * 1.6 + side * 3.14)) * 2;
      const fx = bxk + (k - 1.5) * 5.5 * sc + sw + (side ? 1 : -1), fy = GY - lf;
      const col = side ? shade(legc, 0.8) : legc; const mx = bxk + (k - 1.5) * 4.2 * sc + (side ? 1 : -1), my = by2 - 6 * sc - (v === 'spider' ? 3 : 0);
      p.line(bxk, by2, mx, my, col, 1); p.line(mx, my, fx, fy, col, 1);
    }
    // abdomen, thorax, head
    p.ell(bx - 5 * sc, by2 - 1, 7 * sc, 5 * sc, c); p.ell(bx - 5 * sc, by2 - 1, 5 * sc, 3 * sc, shade(c, 1.15)); p.r(bx - 9 * sc, by2 - 4 * sc, 7 * sc, 1, lt); p.r(bx - 9 * sc, by2 + 2 * sc, 8 * sc, 1, dk);
    p.ell(bx + 2 * sc, by2 - 2, 4 * sc, 3.5 * sc, shade(c, 1.1)); p.r(bx, by2 - 5 * sc, 4 * sc, 1, lt);
    p.ell(bx + 6 * sc, by2 - 1, 3 * sc, 2.6 * sc, dk);
    const mj = o.jaw || 0;
    p.px(bx + 7 * sc, by2 - 2, '#ff4030'); p.px(bx + 8 * sc, by2 - 2, '#ff9a80'); p.px(bx + 6 * sc, by2 - 3, '#ff4030');
    p.line(bx + 8 * sc, by2, bx + 11 * sc + mj, by2 + 2 + mj, '#d8d0b0', 1); p.line(bx + 8 * sc, by2 + 1, bx + 10 * sc, by2 + 4 + mj, '#d8d0b0', 1);
    p.line(bx + 7 * sc, by2 - 3, bx + 11 * sc, by2 - 8 + Math.sin(ph) * 1, dk, 1);
    if (A.mutation || A.seed % 4 === 0) { p.px(bx - 5 * sc, by2 - 3 * sc, '#c8e04a'); p.px(bx - 3 * sc, by2 - 2 * sc, '#c8e04a'); p.px(bx - 7 * sc, by2 - 1, '#8fd14f'); }
    if (v === 'scorpion') { p.line(bx - 11 * sc, by2 - 1, bx - 14 * sc, by2 - 7, c, 2); p.line(bx - 14 * sc, by2 - 7, bx - 11 * sc, by2 - 12, c, 2); p.line(bx - 11 * sc, by2 - 12, bx - 7 * sc, by2 - 12 - (o.jaw ? 1 : 0), c, 2); p.px(bx - 6 * sc, by2 - 12, '#c8e04a'); p.line(bx + 8, by2 + 1, bx + 12, by2 - 2, c, 2); p.r(bx + 12, by2 - 4, 3, 3, lt); }
    else { p.line(bx - 10 * sc, by2 + 1, bx - 12 * sc, by2 + 3, dk, 1); }
  };
  if (v === 'swarm') { const R = rng(A.seed); const t = o.phase || 0; for (let k = 0; k < 6; k++) { const bx = cx - 12 + (k % 3) * 11 + (k > 2 ? 4 : 0) + Math.round(Math.sin(t + k) * 1.5), by2 = GY - 4 - (k > 2 ? 9 : 0) - (k === 4 ? 4 : 0) + (o.bob || 0); bugSmall(p, bx, by2, c, ph + k); } return; }
  bug(cx, by, v === 'spider' ? 1 : 1, 0);
}
function bugSmall(p, x, y, c, ph) {
  const dk = shade(c, 0.5);
  for (let k = 0; k < 3; k++) { const lx = x - 3 + k * 3, sw = Math.round(Math.sin(ph * 2 + k * 2) * 1.5); p.line(lx, y - 1, lx + sw - 1, y + 3, dk, 1); }
  p.ell(x - 2, y - 2, 4, 3, c); p.ell(x - 2, y - 3, 3, 1, shade(c, 1.4)); p.ell(x + 3, y - 2, 2, 2, dk); p.px(x + 4, y - 3, '#ff4030'); p.px(x + 5, y - 2, '#d8d0b0');
}
function insectPose(anim, i, A) {
  const o = { phase: 0, dx: 0, bob: 0, jaw: 0 };
  switch (anim) {
    case 'idle': o.phase = [0, 0.5, 0.2, 0.7][i]; o.bob = [0, 0, 1, 0][i]; break;
    case 'walk': o.phase = i * Math.PI / 2 * 1.5; o.bob = [0, -1, 0, -1][i]; break;
    case 'attack': o.dx = [-3, 2, 6, 2][i]; o.jaw = [0, 3, 3, 0][i]; o.phase = i; o.bob = [-1, -2, 0, 0][i]; break;
    case 'shoot': o.dx = [-1, -2, 0][i]; o.jaw = [1, 3, 2][i]; o.bob = [-2, -3, -1][i]; o.spit = i === 1; break;
    case 'hurt': o.dx = [-3, -1][i]; o.jaw = 3; o.bob = -1; break;
    case 'cast': o.bob = [0, -2, -2][i]; o.jaw = [0, 2, 3][i]; break;
    case 'die': o.dx = [-2, -2, 0, 0][i]; o.jaw = 3; o.phase = 0; break;
  }
  return o;
}

// ---------- drone ----------
function drawDrone(p, A, o) {
  const cx = CX + (o.dx || 0), cy = 24 + (o.bob || 0), t = o.t || 0;
  const hull = ['#6a727a', '#7a6a5a', '#5a6a7a'][A.seed % 3];
  // rotor blur
  for (const sx of [-9, 9]) { p.line(cx + sx, cy - 8, cx + sx, cy - 5, '#444b52', 1); const w = t % 2 ? 7 : 5; p.r(cx + sx - w, cy - 9, w * 2, 1, t % 2 ? '#aab4ba' : '#d8e0e4'); p.r(cx + sx - w + 2, cy - 10, w * 2 - 4, 1, '#7a828a'); }
  // legs / gun
  p.r(cx - 3, cy + 7, 6, 2, '#2a2f34'); p.r(cx + 4, cy + 4, 9, 3, '#3c4249'); p.r(cx + 4, cy + 4, 9, 1, '#6a727a'); p.r(cx + 12, cy + 5, 3, 1, '#1a1f22');
  p.ell(cx, cy, 10, 7, hull); p.ell(cx, cy + 1, 9, 6, hull);
  p.r(cx - 7, cy - 5, 13, 1, shade(hull, 1.5)); p.r(cx - 8, cy - 4, 5, 1, shade(hull, 1.35)); p.r(cx - 7, cy + 4, 14, 2, shade(hull, 0.55)); p.r(cx + 5, cy - 3, 4, 7, shade(hull, 0.72));
  p.line(cx - 9, cy, cx + 9, cy, shade(hull, 0.6), 1);
  p.ell(cx + 3, cy - 1, 4, 3, '#1a1010'); p.ell(cx + 3, cy - 1, 3, 2, '#d8281a'); p.px(cx + 2, cy - 2, '#ff9a80'); p.px(cx + 3, cy - 1, '#fff0c0');
  p.px(cx - 7, cy + 1, '#46f2c8'); p.px(cx - 6, cy + 1, t % 2 ? '#46f2c8' : '#2a6a5a');
  p.line(cx - 4, cy - 7, cx - 6, cy - 14, '#aab', 1); p.px(cx - 6, cy - 15, t % 2 ? '#ff3020' : '#7a1d17');
  if (o.flash) flash(p, cx + 15, cy + 5, 0);
  if (A.mutation) p.px(cx - 4, cy + 3, '#8fd14f');
}
function dronePose(anim, i) {
  const o = { dx: 0, bob: 0, t: i };
  switch (anim) {
    case 'idle': o.bob = [0, -1, -2, -1][i]; break;
    case 'walk': o.bob = [0, -1, 0, -1][i]; o.dx = [0, 1, 0, -1][i]; break;
    case 'attack': o.dx = [-3, 2, 6, 3][i]; o.bob = [-1, 0, 2, 0][i]; break;
    case 'shoot': o.dx = [-1, -2, 0][i]; o.flash = i === 1; o.bob = [0, 1, 0][i]; break;
    case 'hurt': o.dx = [-3, -1][i]; o.bob = [2, 1][i]; break;
    case 'cast': o.bob = [0, -3, -3][i]; break;
    case 'die': o.dx = [-2, -3, -3, -3][i]; o.bob = [2, 8, 14, 18][i]; break;
  }
  return o;
}
// ---------- turret ----------
function drawTurret(p, A, o) {
  const cx = CX + (o.dx || 0), by = GY - (o.dead ? 0 : 0); const m = '#5a626a';
  p.r(cx - 10, by - 3, 20, 3, '#3a3f44'); p.r(cx - 10, by - 3, 20, 1, '#6a727a');
  p.r(cx - 8, by - 6, 16, 3, '#4a5058'); p.r(cx - 8, by - 6, 16, 1, '#7a828a');
  p.r(cx - 4, by - 12, 8, 6, '#444b52'); p.r(cx - 4, by - 12, 8, 1, '#7a828a');
  // sandbag ring
  for (let k = 0; k < 4; k++) { p.r(cx - 14 + k * 3, by - 2, 3, 2, '#a89060'); p.r(cx + 7 + k * 3, by - 2, 3, 2, '#a89060'); p.r(cx - 14 + k * 3, by - 2, 3, 1, '#c8b080'); p.r(cx + 7 + k * 3, by - 2, 3, 1, '#c8b080'); }
  const ang = o.ang || 0, hy = by - 18 + (o.hy || 0);
  p.r(cx - 6, hy, 12, 8, m); p.r(cx - 6, hy, 12, 2, '#8a929a'); p.r(cx - 6, hy + 6, 12, 2, '#3a4048'); p.r(cx + 2, hy + 1, 4, 6, '#40474e');
  const bx = cx + 6 - (o.recoil || 0), byy = hy + 4 + ang;
  p.r(bx, byy - 1, 10, 3, '#2e3338'); p.r(bx, byy - 1, 10, 1, '#6a727a'); p.r(bx + 10, byy - 2, 3, 5, '#1a1f22'); p.r(bx + 4, byy + 2, 4, 1, '#5a626a');
  p.r(cx - 3, hy + 2, 3, 2, o.blink ? '#ff3020' : '#6a1a10'); p.px(cx - 3, hy + 2, o.blink ? '#ffb0a0' : '#6a1a10');
  p.px(cx - 5, hy - 2, '#aab'); p.line(cx - 5, hy, cx - 5, hy - 5, '#889', 1);
  if (o.flash) flash(p, bx + 14, byy, 0);
  if (A.mutation || o.dead) { }
}
function turretPose(anim, i) {
  const o = { dx: 0, blink: i % 2 === 0 };
  switch (anim) {
    case 'idle': o.ang = [0, 0, 1, 1][i]; break;
    case 'walk': o.ang = [0, 1, 0, -1][i]; break;
    case 'attack': o.recoil = [0, 2, 0, 0][i]; o.flash = i === 1; break;
    case 'shoot': o.recoil = [0, 3, 1][i]; o.flash = i === 1; o.hy = [0, 1, 0][i]; break;
    case 'hurt': o.dx = [-1, 1][i]; o.ang = 2; break;
    case 'cast': o.ang = -1; break;
    case 'die': o.dead = true; o.ang = [2, 5, 8, 9][i]; o.hy = [1, 2, 3, 3][i]; o.blink = false; break;
  }
  return o;
}

// ---------- sheet builder ----------
function transformFrame(g, T, spec, ox, oy) {
  g.save(); g.translate(ox, oy);
  if (spec) {
    g.translate(spec.px + (spec.tx || 0), spec.py + (spec.ty || 0)); g.rotate(rad(spec.rot || 0)); if (spec.sc) g.scale(spec.sc, spec.sc); g.translate(-spec.px, -spec.py);
  }
  g.drawImage(T, 0, 0); g.restore();
}

export function buildSheet(A) {
  const cols = 4, rows = ANIM_ORDER.length;
  const [sheet, sg] = mkCanvas(FW * cols, FH * rows);
  const [T, tg] = mkCanvas(FW, FH); const tp = new Pix(tg);
  const info = {};
  ANIM_ORDER.forEach((anim, r) => {
    const n = ANIMS[anim].n; info[anim] = { row: r, n };
    for (let i = 0; i < n; i++) {
      tg.clearRect(0, 0, FW, FH);
      let spec = null, post = null;
      if (A.kind === 'human') {
        const P = humanPose(anim, i, A); drawHuman(tp, A, P);
        if (anim === 'die') spec = [null, { px: CX, py: GY, rot: -35, tx: -2 }, { px: CX, py: GY, rot: -72, tx: 5, ty: -1 }, { px: CX, py: GY, rot: -90, tx: 21, ty: -5, sc: 0.92 }][i];
        if (P.swoosh && P.front) post = (g, ox, oy) => swoosh(g, P, A, ox, oy);
      } else if (A.kind === 'beast') {
        const o = beastPose(anim, i, A); drawBeast(tp, A, o);
        if (anim === 'die') spec = [null, { px: CX, py: GY - 12, rot: -40 }, { px: CX, py: GY - 12, rot: -140, ty: 3 }, { px: CX, py: GY - 12, rot: -180, ty: 6 }][i];
        if (o.spit) post = (g) => { const q = new Pix(g); for (let k = 0; k < 6; k++) q.px(44 + k * 2 + (k % 2), GY - 22 + k * 1.5, k % 2 ? '#8fd14f' : '#d8e84a'); };
      } else if (A.kind === 'insect') {
        const o = insectPose(anim, i, A); drawInsect(tp, A, o);
        if (anim === 'die') spec = [null, { px: CX, py: GY - 8, rot: -30 }, { px: CX, py: GY - 8, rot: -120, ty: 2 }, { px: CX, py: GY - 8, rot: -180, ty: 5 }][i];
        if (o.spit) post = (g) => { const q = new Pix(g); for (let k = 0; k < 6; k++) q.px(42 + k * 2, GY - 14 + k, k % 2 ? '#8fd14f' : '#d8e84a'); };
      } else if (A.kind === 'drone') {
        const o = dronePose(anim, i); drawDrone(tp, A, o);
        if (anim === 'die') spec = [null, { px: CX, py: 24, rot: 15 }, { px: CX, py: 24, rot: 40 }, { px: CX, py: 24, rot: 70, tx: 0 }][i];
      } else {
        const o = turretPose(anim, i); drawTurret(tp, A, o);
      }
      const ox = i * FW, oy = r * FH;
      transformFrame(sg, T, spec, ox, oy);
      outlineRegion(sg, ox, oy, FW, FH, '#150e0b');
      if (post) post(sg, ox, oy);
      if (anim === 'die' && i === 3) deathDecor(sg, A, ox, oy);
    }
  });
  return { canvas: sheet, info };
}
function swoosh(g, P, A, ox, oy) {
  const [a0, a1] = P.swoosh, [sx, sy] = P.shoulder; const wp = weaponParts(A.weapon); const r = 9 + (wp ? wp.len * 0.75 : 10);
  const q = new Pix(g);
  for (let k = 0; k <= 12; k++) { const a = rad(a0 + (a1 - a0) * k / 12); const x = ox + sx + Math.cos(a) * r, y = oy + sy + Math.sin(a) * r; q.px(x, y, k > 5 ? '#fff4d8' : '#d8cfae'); if (k > 2) q.px(ox + sx + Math.cos(a) * (r - 2), oy + sy + Math.sin(a) * (r - 2), '#b8ad8c'); }
}
function deathDecor(g, A, ox, oy) {
  const p = new Pix(g);
  if (A.kind === 'drone') { for (let k = 0; k < 4; k++) p.px(ox + 24 + k * 3, oy + 40 - k, k % 2 ? '#ff7a1e' : '#ffd24a'); }
}
export { Pix };
