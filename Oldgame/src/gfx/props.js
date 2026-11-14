// Low-poly props (1x1 tile footprint) and ruined buildings. Merged geometry, pixel textures, animated emissives.
import { THREE } from '../core/engine.js';
import { Builder, instantiate, glowSprite, flameSprite, planeG } from './builder.js';
import { surf, paintSurface } from './textures.js';
import { rng, hash, mkCanvas, canvasTex, Pix, shade } from './util.js';
import { drawPixelText, measurePixelText } from './font.js';

const pick = (R, a) => a[(R() * a.length) | 0];
const basic = (hex, o = {}) => new THREE.MeshBasicMaterial({ color: hex, ...o });
const emiCache = new Map();
const emissive = (hex) => { let m = emiCache.get(hex); if (!m) { m = new THREE.MeshBasicMaterial({ color: hex }); emiCache.set(hex, m); } return m; };
const CAR_COLS = ['9a3a28', '3a5a7a', '5a6a3a', 'a89a4a', 'b8b4a8', '6a3a5a', '2a2a2e'];

const PROPS = {
  wall(b, R) {
    const m = R() < 0.5 ? 'concrete' : 'brick';
    b.box(1.0, 1.5, 0.3, 0, 0.75, 0, m); b.box(0.46, 0.55, 0.3, -0.27, 1.77, 0, m); b.box(0.3, 0.3, 0.3, 0.3, 1.65, 0, m);
    b.box(1.04, 0.1, 0.34, 0, 0.05, 0, 'concrete:#6a645a'); b.box(0.1, 0.1, 0.34, 0.5, 0.05, 0, 'concrete:#6a645a');
    for (let i = 0; i < 3; i++) b.limb(-0.35 + i * 0.1 + R() * 0.1, 1.9, 0, -0.35 + i * 0.1 + R() * 0.2, 2.2 + R() * 0.2, (R() - 0.5) * 0.1, 0.012, 0.012, 'rust:#7a3a20', 4);
    b.box(0.6, 0.02, 0.02, 0.1, 1.2, 0.16, 'dark:#1a1410');
  },
  wall_broken(b, R) {
    const m = R() < 0.5 ? 'concrete' : 'brick';
    b.box(1.0, 0.7, 0.3, 0, 0.35, 0, m);
    for (let i = 0; i < 5; i++) { const h = 0.2 + R() * 0.8, x = -0.4 + i * 0.2; b.box(0.19, h, 0.3, x, 0.7 + h / 2, 0, m, { ry: (R() - 0.5) * 0.1 }); }
    for (let i = 0; i < 5; i++) b.limb(-0.4 + R() * 0.8, 1.2 + R() * 0.2, (R() - 0.5) * 0.1, -0.4 + R() * 0.8 + (R() - 0.5) * 0.3, 1.6 + R() * 0.4, (R() - 0.5) * 0.2, 0.012, 0.012, 'rust:#7a3a20', 4);
    for (let i = 0; i < 7; i++) { const s = 0.08 + R() * 0.18; b.box(s, s * 0.7, s, (R() - 0.5) * 1.2, s * 0.35, 0.25 + R() * 0.2 * (R() < 0.5 ? 1 : -1.6), 'concrete', { ry: R() * 3, rx: (R() - 0.5) * 0.5 }); }
  },
  pillar(b, R) {
    b.box(0.7, 0.18, 0.7, 0, 0.09, 0, 'concrete:#6a645a'); b.box(0.5, 2.0, 0.5, 0, 1.18, 0, 'concrete'); b.box(0.3, 0.55, 0.3, -0.07, 2.45, 0.05, 'concrete', { rx: 0.05 });
    b.box(0.54, 0.08, 0.54, 0, 0.5, 0, 'concrete:#6a645a'); b.box(0.54, 0.08, 0.54, 0, 1.6, 0, 'concrete:#6a645a');
    for (let i = 0; i < 4; i++) b.limb(-0.2 + (i % 2) * 0.35, 2.55, -0.15 + (i >> 1) * 0.3, -0.2 + (i % 2) * 0.35 + (R() - 0.5) * 0.3, 3.0 + R() * 0.2, -0.15 + (i >> 1) * 0.3 + (R() - 0.5) * 0.2, 0.014, 0.014, 'rust:#7a3a20', 4);
    for (let i = 0; i < 5; i++) { const s = 0.06 + R() * 0.12; b.box(s, s * 0.7, s, (R() - 0.5) * 0.9, s * 0.35, (R() - 0.5) * 0.9, 'concrete', { ry: R() * 3 }); }
  },
  car(b, R, seed) {
    const col = pick(R, CAR_COLS), body = 'car:' + col, burnt = R() < 0.25, B = burnt ? 'rust:#2a2018' : body;
    const lo = burnt ? 0 : 0.0;
    b.box(0.96, 0.14, 0.5, 0, 0.17, 0, 'dark:#241c16'); b.box(0.96, 0.2, 0.52, 0, 0.32, 0, B); b.box(0.28, 0.06, 0.5, 0.34, 0.46, 0, B, { rz: -0.15 }); b.box(0.24, 0.06, 0.5, -0.38, 0.45, 0, B, { rz: 0.1 });
    b.box(0.5, 0.21, 0.47, -0.04, 0.54, 0, burnt ? 'dark:#0e0a08' : 'glass'); b.box(0.52, 0.04, 0.5, -0.04, 0.66, 0, B, { rz: R() < 0.4 ? 0.04 : 0 });
    for (const [x, z] of [[0.22, 0.23], [-0.3, 0.23], [0.22, -0.23], [-0.3, -0.23]]) b.box(0.04, 0.22, 0.04, x, 0.54, z, B);
    for (const [x, z] of [[0.3, 0.27], [-0.3, 0.27], [0.3, -0.27], [-0.3, -0.27]]) { if (R() < 0.15) continue; b.cyl(0.115, 0.115, 0.09, 8, x, 0.115, z, 'dark:#18130f', { rx: Math.PI / 2 }); b.cyl(0.05, 0.05, 0.1, 6, x, 0.115, z, 'metal', { rx: Math.PI / 2 }); }
    b.box(0.03, 0.05, 0.4, 0.49, 0.3, 0, 'metal'); b.box(0.03, 0.05, 0.4, -0.49, 0.3, 0, 'metal');
    if (R() < 0.5) b.box(0.3, 0.02, 0.4, 0.3, 0.5, 0, 'rust:#7a3a20', { rz: -0.15 });
    if (burnt) b.box(0.6, 0.02, 0.4, -0.04, 0.68, 0, 'rust:#3a2418');
  },
  bus(b, R) {
    const col = pick(R, ['c8a82a', 'b8b4a8', '3a6a5a', '9a3a28']), body = 'car:' + col;
    b.box(1.0, 0.18, 0.56, 0, 0.2, 0, 'dark:#241c16'); b.box(1.0, 0.3, 0.6, 0, 0.42, 0, body); b.box(1.0, 0.26, 0.6, 0, 0.7, 0, 'glass'); b.box(1.04, 0.05, 0.64, 0, 0.86, 0, body);
    for (let i = 0; i < 5; i++) b.box(0.04, 0.26, 0.62, -0.4 + i * 0.2, 0.7, 0, body);
    for (const [x, z] of [[0.33, 0.3], [-0.33, 0.3], [0.33, -0.3], [-0.33, -0.3]]) b.cyl(0.14, 0.14, 0.1, 8, x, 0.14, z, 'dark:#18130f', { rx: Math.PI / 2 });
    b.box(0.03, 0.3, 0.5, 0.52, 0.55, 0, 'glass'); b.box(0.5, 0.02, 0.3, -0.1, 0.89, 0.05, 'rust:#7a3a20'); b.box(0.3, 0.08, 0.3, -0.3, 0.92, 0, 'metal');
  },
  barrel(b, R) {
    const c = pick(R, ['8a4a28', '4a6a8a', '6a6a3a', '8a8a8a']);
    b.cyl(0.26, 0.26, 0.7, 10, 0, 0.35, 0, 'barrel:' + c, { uvs: 1.6, uvt: 0.9 }); b.cyl(0.24, 0.24, 0.02, 10, 0, 0.71, 0, 'dark:#2a2018');
    if (R() < 0.6) b.cyl(0.2, 0.2, 0.55, 9, 0.42, 0.275, -0.34, 'barrel:' + pick(R, ['8a4a28', '6a6a3a']), { uvs: 1.4, uvt: 0.7 });
    b.box(0.1, 0.03, 0.1, 0.1, 0.72, 0.05, 'rust:#7a3a20');
  },
  barrel_toxic(b, R) {
    b.cyl(0.27, 0.27, 0.72, 10, 0, 0.36, 0, 'toxbarrel', { uvs: 1.7, uvt: 1 }); b.cyl(0.25, 0.25, 0.02, 10, 0, 0.73, 0, 'dark:#1c1c10');
    b.cyl(0.4, 0.44, 0.02, 10, 0.05, 0.015, 0.1, emissive(0x6adf2a));
    b.cyl(0.18, 0.18, 0.5, 8, 0.45, 0.26, -0.3, 'toxbarrel', { rx: 0.2, rz: Math.PI / 2 * 0 , uvs: 1.2, uvt: 0.7 });
    b.extra(() => glowSprite(0x6adf2a, 1.6, 0.1, 0.35, 0.1, { pulse: 2.2, opacity: 0.45 }));
  },
  crate(b, R) {
    const c = pick(R, ['8a6236', '7a5a32', '6a4e2c']);
    b.box(0.66, 0.62, 0.66, 0, 0.31, 0, 'wood:' + c, { ry: (R() - 0.5) * 0.2 });
    for (const s of [-1, 1]) for (const t of [-1, 1]) b.box(0.07, 0.66, 0.07, s * 0.3, 0.31, t * 0.3, 'wood:5a3e22');
    b.box(0.68, 0.06, 0.68, 0, 0.62, 0, 'wood:5a3e22'); b.box(0.68, 0.06, 0.68, 0, 0.03, 0, 'wood:5a3e22');
    if (R() < 0.6) b.box(0.4, 0.34, 0.4, (R() - 0.5) * 0.2, 0.8, (R() - 0.5) * 0.2, 'wood:' + c, { ry: R() });
    b.box(0.2, 0.01, 0.12, 0.34, 0.35, 0.1, 'hazard');
  },
  debris(b, R) {
    for (let i = 0; i < 9; i++) { const s = 0.1 + R() * 0.28; b.box(s, s * (0.4 + R() * 0.6), s * (0.6 + R() * 0.6), (R() - 0.5) * 0.8, s * 0.25, (R() - 0.5) * 0.8, pick(R, ['concrete', 'concrete:#6a655c', 'brick']), { ry: R() * 3, rx: (R() - 0.5) * 0.6, rz: (R() - 0.5) * 0.6 }); }
    b.limb(-0.3, 0.1, 0.2, 0.3, 0.3, -0.1, 0.012, 0.012, 'rust:#7a3a20', 4); b.limb(-0.2, 0.08, -0.3, 0.2, 0.24, 0.3, 0.012, 0.012, 'rust:#7a3a20', 4);
    b.geo(new THREE.TorusGeometry(0.1, 0.045, 5, 8), 'dark:#18130f', 0.25, 0.1, 0.25, Math.PI / 2 - 0.3, 0.4, 0);
    b.box(0.5, 0.03, 0.2, -0.2, 0.2, 0.0, 'metal', { rz: 0.3, ry: 0.5 });
  },
  lamp(b, R) {
    b.box(0.2, 0.14, 0.2, 0, 0.07, 0, 'concrete:#6a645a'); b.cyl(0.035, 0.055, 2.4, 6, 0, 1.3, 0, 'metal:#4a525a', { uvs: 0.5, uvt: 2 });
    const bent = R() < 0.4; b.beam(0, 2.45, 0, 0.45, 2.5 - (bent ? 0.25 : 0), 0, 0.04, 'metal:#4a525a');
    b.box(0.26, 0.06, 0.14, 0.5, 2.48 - (bent ? 0.28 : 0), 0, 'metal:#3a424a'); b.box(0.2, 0.025, 0.1, 0.5, 2.44 - (bent ? 0.28 : 0), 0, emissive(0xffc260));
    b.extra(() => glowSprite(0xffb050, 1.7, 0.5, 2.3 - (bent ? 0.28 : 0), 0, { pulse: 3, opacity: 0.55 }));
  },
  tree_dead(b, R) {
    b.cyl(0.07, 0.15, 1.5, 6, 0, 0.75, 0, 'bark', { uvs: 0.8, uvt: 1.5 }); b.cyl(0.2, 0.17, 0.12, 6, 0, 0.05, 0, 'bark');
    const br = (x0, y0, z0, ang, up, len, r, depth) => {
      const dx = Math.cos(ang) * Math.cos(up) * len, dz = Math.sin(ang) * Math.cos(up) * len, dy = Math.sin(up) * len;
      b.limb(x0, y0, z0, x0 + dx, y0 + dy, z0 + dz, r, r * 0.55, 'bark', 5);
      if (depth > 0) { const n = 2 + (R() < 0.4); for (let i = 0; i < n; i++) br(x0 + dx, y0 + dy, z0 + dz, ang + (R() - 0.5) * 2.2, up + (R() - 0.3) * 0.7, len * (0.6 + R() * 0.2), r * 0.6, depth - 1); }
    };
    for (let i = 0; i < 5; i++) br(0, 0.9 + i * 0.16, 0, R() * 6.28, 0.5 + R() * 0.6, 0.55 + R() * 0.3, 0.045, 2);
    br(0, 1.45, 0, R() * 6.28, 1.2, 0.4, 0.04, 1);
  },
  tent(b, R) {
    const c = pick(R, ['b89a62', '8a5a38', '6a7a4a', 'a8a090']);
    b.cyl(0.02, 0.66, 1.0, 4, 0, 0.5, 0, 'canvas:' + c, { ry: Math.PI / 4, uvs: 2, uvt: 1 }); b.cyl(0.015, 0.015, 0.35, 4, 0, 1.15, 0, 'wood:6a4a2a');
    b.box(0.26, 0.42, 0.03, 0.0, 0.21, 0.4, 'dark:#140e0a', { rx: -0.45 });
    b.box(0.08, 0.5, 0.03, -0.17, 0.2, 0.38, 'canvas:' + c, { rx: -0.45, rz: 0.1 }); b.box(0.08, 0.5, 0.03, 0.17, 0.2, 0.38, 'canvas:' + c, { rx: -0.45, rz: -0.1 });
    b.limb(0.5, 0.0, 0.5, 0.55, 0.3, 0.55, 0.015, 0.015, 'wood:6a4a2a', 4); b.box(0.22, 0.12, 0.22, 0.55, 0.06, -0.45, 'canvas:8a4a28');
    b.extra(() => null);
  },
  campfire(b, R) {
    for (let i = 0; i < 9; i++) { const a = i / 9 * 6.28; b.box(0.13, 0.1 + R() * 0.05, 0.1, Math.cos(a) * 0.32, 0.06, Math.sin(a) * 0.32, 'concrete:#5a564f', { ry: -a }); }
    b.cyl(0.28, 0.28, 0.02, 9, 0, 0.02, 0, 'dark:#0e0a08');
    for (let i = 0; i < 3; i++) { const a = i * 2.1 + R(); b.limb(Math.cos(a) * 0.25, 0.05, Math.sin(a) * 0.25, -Math.cos(a) * 0.1, 0.22, -Math.sin(a) * 0.1, 0.045, 0.04, 'bark', 5); }
    b.box(0.12, 0.2, 0.12, 0.55, 0.1, 0.1, 'bark', { rz: 0.3 }); b.box(0.2, 0.16, 0.3, -0.55, 0.08, 0.3, 'canvas:6a5a3a', { ry: 0.4 });
    b.extra(() => { const g = new THREE.Group(); g.add(flameSprite(0, 0.1, 0, 0.62), flameSprite(0.07, 0.08, 0.05, 0.42), flameSprite(-0.07, 0.08, -0.04, 0.5), glowSprite(0xff8a30, 3.2, 0, 0.35, 0, { pulse: 7, opacity: 0.5 })); return g; });
  },
  terminal(b, R) {
    b.box(0.66, 0.5, 0.42, 0, 0.25, 0, 'metal:#5a626a'); b.box(0.68, 0.04, 0.44, 0, 0.5, 0, 'metal:#3a424a'); b.box(0.6, 0.06, 0.3, 0, 0.58, 0.04, 'metal:#2a2f34', { rx: -0.3 });
    b.box(0.58, 0.42, 0.2, 0, 0.8, -0.08, 'metal:#4a525a', { rx: -0.2 }); b.box(0.5, 0.34, 0.02, 0, 0.82, 0.03, screenMat(R));
    for (let i = 0; i < 4; i++) b.box(0.04, 0.04, 0.02, -0.22 + i * 0.08, 0.38, 0.22, emissive([0x46f2c8, 0xff5a3a, 0xffc040, 0x46f2c8][i]));
    b.limb(0.3, 0.1, -0.2, 0.6, 0.0, -0.4, 0.02, 0.02, 'dark:#101010', 4);
    b.extra(() => glowSprite(0x46f2c8, 1.5, 0, 0.8, 0.15, { pulse: 5, opacity: 0.32 }));
  },
  sandbags(b, R) {
    for (let r = 0; r < 3; r++) { const n = 4 - r; for (let i = 0; i < n; i++) { const x = -0.38 + i * 0.5 / (n > 3 ? 1 : 1) * (4 / (n + 0.0)) * 0.25 + r * 0.12 - (n === 4 ? 0 : 0); b.box(0.46, 0.17, 0.26, (i - (n - 1) / 2) * 0.48, 0.09 + r * 0.17, (R() - 0.5) * 0.04, 'sandbag', { ry: (R() - 0.5) * 0.12 }); } }
    b.box(0.3, 0.14, 0.24, 0.1, 0.07, 0.3, 'sandbag', { ry: 0.5 });
  },
  container(b, R) {
    const c = pick(R, ['9a3a28', '2e5a82', '3a6a48', 'b8651a', '6a6a70']), mat = 'corr:' + c;
    b.box(0.98, 0.84, 0.54, 0, 0.45, 0, mat); b.box(1.0, 0.05, 0.56, 0, 0.88, 0, 'rust:#5a3a28'); b.box(1.0, 0.06, 0.56, 0, 0.03, 0, 'metal:#3a3f44');
    for (const s of [-1, 1]) { b.box(0.02, 0.76, 0.24, s * 0.5, 0.46, -0.13, 'metal:#6a6a70'); b.box(0.02, 0.76, 0.24, s * 0.5, 0.46, 0.13, 'metal:#6a6a70'); b.box(0.04, 0.6, 0.02, s * 0.51, 0.46, -0.02, 'metal:#2a2f34'); b.box(0.04, 0.6, 0.02, s * 0.51, 0.46, 0.03, 'metal:#2a2f34'); }
    b.box(0.2, 0.2, 0.002, 0.2, 0.5, 0.275, 'dark:#0e0a08');
  },
  fence(b, R) {
    for (const x of [-0.5, 0, 0.5]) b.cyl(0.03, 0.035, 1.4, 5, x, 0.7, 0, 'metal:#5a626a');
    b.beam(-0.5, 1.35, 0, 0.5, 1.35, 0, 0.03, 'metal:#5a626a'); b.beam(-0.5, 0.08, 0, 0.5, 0.08, 0, 0.03, 'metal:#5a626a');
    b.extra(() => { const m = new THREE.Mesh(planeG(), fenceMat()); m.scale.set(1.0, 1.25, 1); m.position.set(0, 0.72, 0); return m; });
    for (let i = 0; i < 6; i++) b.box(0.08, 0.02, 0.02, -0.45 + i * 0.18, 1.42, 0, 'metal:#3a3f44', { rz: (i % 2 ? 0.6 : -0.6) });
    if (R() < 0.5) b.box(0.3, 0.02, 0.3, 0.3, 0.02, 0.2, 'rust:#5a3a28', { ry: 0.5 });
  },
  skeleton(b, R) {
    const B = 'bone', y = 0.04;
    b.geo(new THREE.SphereGeometry(0.075, 6, 5), B, -0.38, 0.08, 0.02); b.box(0.08, 0.05, 0.06, -0.3, 0.05, 0.02, B);
    b.limb(-0.28, y, 0, 0.2, y, 0.02, 0.018, 0.018, B, 4);
    for (let i = 0; i < 6; i++) { const x = -0.2 + i * 0.07; b.limb(x, y + 0.02, 0, x + 0.02, y + 0.05, 0.14 + (i % 2) * 0.02, 0.012, 0.01, B, 4); b.limb(x, y + 0.02, 0, x + 0.02, y + 0.05, -0.14 - (i % 2) * 0.02, 0.012, 0.01, B, 4); }
    b.box(0.2, 0.06, 0.18, 0.28, 0.035, 0, B); b.limb(0.3, y, 0.05, 0.55, y, 0.2, 0.02, 0.016, B, 4); b.limb(0.3, y, -0.05, 0.5, y, -0.25, 0.02, 0.016, B, 4);
    b.limb(-0.2, y, 0.1, -0.05, y, 0.35, 0.015, 0.014, B, 4); b.limb(-0.2, y, -0.1, -0.4, y, -0.3, 0.015, 0.014, B, 4);
    b.box(0.5, 0.02, 0.4, 0, 0.012, 0, 'cloth:4a3a2a', { ry: 0.3 }); b.box(0.35, 0.025, 0.08, 0.35, 0.03, 0.35, 'rust:#6a4a30', { ry: 0.5 });
  },
  scrap_pile(b, R) {
    for (let i = 0; i < 18; i++) { const h = 1 - Math.min(1, i / 18), s = 0.12 + R() * 0.3; const a = R() * 6.28, r = R() * 0.38 * (0.5 + (1 - h) * 0.7); b.box(s, s * (0.3 + R() * 0.5), s * (0.5 + R() * 0.8), Math.cos(a) * r, 0.08 + h * h * 0.32 + R() * 0.05, Math.sin(a) * r, pick(R, ['rust:#8a4a28', 'metal', 'rust:#6a3a20', 'metal:#7a828a', 'car:' + pick(R, CAR_COLS)]), { ry: R() * 3.1, rx: (R() - 0.5) * 0.8, rz: (R() - 0.5) * 0.8 }); }
    b.geo(new THREE.TorusGeometry(0.15, 0.06, 5, 9), 'dark:#18130f', 0.25, 0.14, 0.3, 1.2, 0.3, 0); b.limb(-0.3, 0.1, 0.3, 0.2, 0.5, -0.2, 0.025, 0.025, 'metal', 5); b.limb(0.1, 0.2, -0.3, -0.4, 0.45, 0.1, 0.012, 0.012, 'rust:#7a3a20', 4);
  },
  generator(b, R) {
    b.box(0.78, 0.08, 0.5, 0, 0.04, 0, 'metal:#3a3f44'); b.box(0.7, 0.46, 0.44, 0, 0.31, 0, 'metal:#4a6a4a'); b.box(0.72, 0.04, 0.46, 0, 0.55, 0, 'metal:#3a4a3a');
    b.cyl(0.11, 0.11, 0.5, 8, 0, 0.7, 0, 'rust:#8a4a28', { rz: Math.PI / 2 }); b.limb(0.28, 0.55, -0.15, 0.36, 1.05, -0.15, 0.035, 0.03, 'dark:#2a2018', 6);
    for (let i = 0; i < 4; i++) b.box(0.2, 0.025, 0.02, -0.2, 0.2 + i * 0.07, 0.225, 'dark:#16120f');
    b.box(0.24, 0.16, 0.02, 0.18, 0.34, 0.225, 'hazard'); b.box(0.06, 0.06, 0.02, 0.1, 0.45, 0.23, emissive(0xffa030)); b.box(0.06, 0.06, 0.02, 0.26, 0.45, 0.23, emissive(0x46f2c8));
    b.limb(-0.35, 0.2, -0.1, -0.55, 0.02, -0.3, 0.02, 0.02, 'dark:#101010', 4);
    b.extra(() => glowSprite(0xffa030, 1.0, 0.1, 0.45, 0.3, { pulse: 6, opacity: 0.4 }));
  },
  door(b, R) {
    b.box(0.14, 2.0, 0.34, -0.45, 1.0, 0, 'concrete'); b.box(0.14, 2.0, 0.34, 0.45, 1.0, 0, 'concrete'); b.box(1.04, 0.2, 0.34, 0, 2.05, 0, 'concrete');
    const c = pick(R, ['5a6a5a', '6a5a4a', '4a5a6a']); b.box(0.78, 1.85, 0.07, 0, 0.93, 0, 'metal:' + c, { ry: R() < 0.3 ? 0.12 : 0 });
    b.box(0.5, 0.2, 0.02, 0, 1.45, 0.045, 'glass'); b.box(0.06, 0.06, 0.06, 0.28, 0.95, 0.06, 'metal:#c9a043'); b.box(0.74, 0.14, 0.02, 0, 0.3, 0.045, 'hazard'); b.box(0.2, 0.2, 0.02, 0, 1.0, 0.045, 'rust:#7a3a20');
  },
  tank_trap(b, R) {
    const m = 'rust:#6a4a30', h = 0.38, t = 0.09, L = 0.42;
    for (const [x, z, y] of [[1, 0.2, 1], [0.2, 1, -1], [0, 0, 1]]) { }
    b.beam(-0.42, 0.04, -0.2, 0.42, 0.76, 0.2, t, m); b.beam(0.42, 0.04, -0.2, -0.42, 0.76, 0.2, t, m); b.beam(-0.2, 0.4, -0.42, 0.2, 0.4, 0.42, t, m);
    b.box(0.2, 0.02, 0.2, 0, 0.01, 0, 'dark:#18130f');
  },
  sign(b, R, seed) {
    b.cyl(0.03, 0.035, 1.9, 5, 0, 0.95, 0, 'metal:#5a626a'); const tilt = (R() - 0.5) * 0.3;
    b.geo(new THREE.BoxGeometry(0.64, 0.64, 0.04), signMat(seed % 4), 0, 1.75, 0.04, 0, 0, tilt); b.box(0.1, 0.02, 0.02, 0.0, 1.45, 0.02, 'metal:#3a3f44');
  },
  antenna(b, R) {
    const H = 3.6, B0 = 0.28, T = 0.05, M = 'metal:#7a828a';
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    for (const [sx, sz] of corners) b.limb(sx * B0, 0, sz * B0, sx * T, H, sz * T, 0.018, 0.012, M, 4);
    for (let i = 1; i <= 6; i++) { const y = i * H / 7, k = B0 + (T - B0) * (y / H); for (let c = 0; c < 4; c++) { const [ax, az] = corners[c], [bx, bz] = corners[(c + 1) % 4]; b.beam(ax * k, y, az * k, bx * k, y, bz * k, 0.012, M); const y2 = y + H / 7, k2 = B0 + (T - B0) * (Math.min(y2, H) / H); b.beam(ax * k, y, az * k, bx * k2, Math.min(y2, H), bz * k2, 0.01, M); } }
    b.cyl(0.02, 0.02, 0.6, 4, 0, H + 0.3, 0, M); b.cyl(0.02, 0.28, 0.12, 8, 0.12, H - 0.5, 0.1, 'metal:#aab4ba', { rx: Math.PI / 2 - 0.5, rz: 0.4 });
    b.box(0.3, 0.3, 0.2, 0.0, 0.25, 0.0, 'metal:#4a525a');
    b.extra(() => glowSprite(0xff3a2a, 0.7, 0, H + 0.62, 0, { pulse: 4, opacity: 0.9 }));
  },
};

let _fence = null;
function fenceMat() { if (_fence) return _fence; const [c, g] = mkCanvas(32, 32); g.drawImage(paintSurface('chain'), 0, 0); const t = canvasTex(c, { repeat: true }); t.repeat.set(2, 2); return (_fence = new THREE.MeshLambertMaterial({ map: t, alphaTest: 0.5, side: THREE.DoubleSide })); }
const scr = new Map();
function screenMat(R) {
  const k = (R() * 3) | 0; if (scr.has(k)) return scr.get(k);
  const [c, g] = mkCanvas(48, 32); g.fillStyle = '#04140e'; g.fillRect(0, 0, 48, 32);
  const lines = [['> SYS: OK', '> RAD: 0.3', '> DRZWI: ZAMK.'], ['SIEC: BRAK', 'ZASILANIE 41%', '> _'], ['PRZYSTAN-7', '> LOG 0412', '> ODCZYT...']][k];
  lines.forEach((l, i) => drawPixelText(g, l, 3, 3 + i * 9, { color: i === 2 ? '#d8ffe0' : '#46f2c8' }));
  for (let y = 0; y < 32; y += 2) { g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(0, y, 48, 1); }
  g.fillStyle = '#46f2c8'; g.fillRect(3 + 6 * (lines[2].length), 21, 4, 6);
  const m = new THREE.MeshBasicMaterial({ map: canvasTex(c) }); scr.set(k, m); return m;
}
const signs = new Map();
function signMat(v) {
  if (signs.has(v)) return signs.get(v); const [c, g] = mkCanvas(32, 32), p = new Pix(g);
  g.fillStyle = '#2a2420'; g.fillRect(0, 0, 32, 32);
  if (v === 0) { g.fillStyle = '#d8b020'; g.fillRect(1, 1, 30, 30); g.fillStyle = '#1a1612'; g.beginPath(); g.moveTo(16, 4); g.lineTo(29, 27); g.lineTo(3, 27); g.fill(); g.fillStyle = '#d8b020'; g.beginPath(); g.moveTo(16, 8); g.lineTo(25, 25); g.lineTo(7, 25); g.fill(); g.fillStyle = '#1a1612'; g.fillRect(15, 12, 3, 8); g.fillRect(15, 21, 3, 3); }
  else if (v === 1) { g.fillStyle = '#d8b020'; g.fillRect(1, 1, 30, 30); g.fillStyle = '#1a1612'; g.beginPath(); g.arc(16, 16, 11, 0, 6.3); g.fill(); g.fillStyle = '#d8b020'; g.beginPath(); g.arc(16, 16, 9, 0, 6.3); g.fill(); g.fillStyle = '#1a1612'; for (const a of [0, 2.09, 4.19]) { g.beginPath(); g.moveTo(16, 16); g.arc(16, 16, 8, a - 0.5 + 0.5, a + 0.5 + 0.5); g.fill(); } g.beginPath(); g.arc(16, 16, 2, 0, 6.3); g.fill(); }
  else if (v === 2) { g.fillStyle = '#a82a20'; g.fillRect(1, 1, 30, 30); g.fillStyle = '#e8e0d0'; g.fillRect(3, 3, 26, 26); g.fillStyle = '#a82a20'; g.fillRect(5, 5, 22, 22); drawPixelText(g, 'STOP', 4, 12, { color: '#f2ecde' }); }
  else { g.fillStyle = '#2a5a7a'; g.fillRect(1, 1, 30, 30); g.fillStyle = '#f2ecde'; g.fillRect(6, 14, 16, 4); g.beginPath(); g.moveTo(20, 8); g.lineTo(28, 16); g.lineTo(20, 24); g.fill(); drawPixelText(g, 'PRZ', 5, 22, { color: '#f2ecde' }); }
  const R = rng(v * 77 + 3); for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(60,30,10,${0.3 + R() * 0.4})`; g.fillRect(R() * 32, R() * 32, 1 + R() * 2, 1); } for (let i = 0; i < 4; i++) { g.fillStyle = '#7a3a1c'; g.fillRect(R() * 28, R() * 28, 3, 2); }
  g.strokeStyle = '#14100c'; g.lineWidth = 1; g.strokeRect(0.5, 0.5, 31, 31);
  const m = new THREE.MeshLambertMaterial({ map: canvasTex(c) }); signs.set(v, m); return m;
}

export const PROP_TYPES = Object.keys(PROPS);
const specCache = new Map();
export function createProp(type, opts = {}) {
  const fn = PROPS[type];
  const seed = (opts.seed ?? 0) | 0, vk = ((seed % 4) + 4) % 4;
  const key = type + '|' + vk; let spec = specCache.get(key);
  if (!spec) { const b = new Builder(), R = rng(hash(type) + vk * 101 + 7); (fn || PROPS.crate)(b, R, vk); spec = b.finish(); specCache.set(key, spec); }
  const o = instantiate(spec); o.name = 'prop_' + type; o.userData.propType = type; return o;
}
// seeded per-instance variation: rotate randomly about Y is the caller's choice
export { PROPS };

// =================== BUILDINGS ===================
const graf = new Map();
function grafMat(v) {
  if (graf.has(v)) return graf.get(v); const [c, g] = mkCanvas(64, 32);
  const R = rng(v * 991 + 5), words = ['ZLOM', 'ZELAZNE SZCZEKI', 'KOSTUCHA', 'WON!', 'TOXIC', 'ZYJ SZYBKO', 'NIE WCHODZ', 'REDRUM', 'LEGION 7'];
  const w = words[v % words.length]; const col = ['#e04a2a', '#e8c030', '#6adf2a', '#e8e0d0', '#c03a8a'][v % 5];
  if (v % 3 === 2) { // skull tag
    g.fillStyle = col; g.fillRect(24, 4, 16, 14); g.fillRect(27, 18, 10, 5); g.fillStyle = '#000'; g.fillRect(27, 9, 4, 4); g.fillRect(33, 9, 4, 4); g.fillRect(31, 15, 2, 2);
    for (let k = 0; k < 4; k++) g.fillRect(28 + k * 2, 19, 1, 3);
  } else { const s = measurePixelText(w, 1) > 40 ? 1 : 2; const x = Math.max(1, (64 - measurePixelText(w, s)) / 2 | 0); drawPixelText(g, w, x + s, 10 + s, { color: '#000', scale: s }); drawPixelText(g, w, x, 10, { color: col, scale: s }); }
  for (let i = 0; i < 6; i++) { const x = 4 + R() * 56 | 0; g.fillStyle = col; g.fillRect(x, 20, 1, 2 + R() * 8); }
  const t = canvasTex(c); const m = new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  m.color.setScalar(0.62); graf.set(v, m); return m;
}

export function createBuilding({ w = 3, d = 3, h = 2, ruined = true, seed = 1 } = {}) {
  const key = `B${w}x${d}x${h}|${ruined}|${seed}`; let spec = specCache.get(key);
  if (!spec) {
    const R = rng(hash(key)), b = new Builder(); const FH = 2.5, T = 0.26;
    const wall = pick(R, ['concrete', 'concrete:#7a7468', 'brick', 'concrete:#8c8478']), slab = 'concrete:#8a847a', trim = 'concrete:#6a645a';
    const hw = w / 2, hd = d / 2;
    const dmgBase = ruined ? 0.55 : 0, corner = (R() * 4) | 0;
    const cornerPos = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]][corner];
    // foundation
    b.box(w + 0.2, 0.16, d + 0.2, 0, 0.08, 0, 'concrete:#5a544c');
    // floors
    for (let f = 0; f < h; f++) {
      const y0 = 0.16 + f * FH;
      // slab cells (ground slab all, upper floors with holes)
      for (let i = 0; i < w; i++) for (let k = 0; k < d; k++) {
        const x = -hw + i + 0.5, z = -hd + k + 0.5;
        const nearC = Math.hypot(x - cornerPos[0], z - cornerPos[1]) < 1.7;
        if (f > 0 && ruined && (R() < 0.18 + (nearC ? 0.5 : 0) + f * 0.04)) continue;
        b.box(1.0, 0.16, 1.0, x, y0 + (f ? 0 : -0.02), z, f ? slab : 'concrete:#6a645a', { rz: f > 0 && ruined && R() < 0.12 ? 0.15 : 0 });
      }
      for (let side = 0; side < 4; side++) {
        const along = side % 2 === 0 ? w : d; // 0:+z front, 1:+x, 2:-z back, 3:-x
        for (let i = 0; i < along; i++) {
          const u = -along / 2 + i + 0.5;
          let px, pz, ry; const off = (side % 2 === 0 ? hd : hw) - T / 2;
          if (side === 0) { px = u; pz = off; ry = 0; } else if (side === 2) { px = -u; pz = -off; ry = 0; } else if (side === 1) { px = off; pz = u; ry = Math.PI / 2; } else { px = -off; pz = -u; ry = Math.PI / 2; }
          const wx = side % 2 === 0 ? px : px, wz = pz;
          const nearC = Math.hypot(wx - cornerPos[0], wz - cornerPos[1]) < 2.0;
          const top = f === h - 1;
          let collapse = false, topCut = 1;
          if (ruined) {
            const p = (top ? 0.4 : 0.1) * 1 + (nearC ? 0.35 : 0) * (f >= 1 ? 1 : 0.3);
            if (f > 0 && R() < p) collapse = true;
            if (top && !collapse) topCut = R() < 0.55 ? 0.3 + R() * 0.7 : 1;
            if (f === 0 && R() < 0.12) topCut = 0.4 + R() * 0.5;
          }
          if (collapse) continue;
          const hh = FH * topCut;
          // local wall piece builder (z=thickness axis), then rotate about Y at (px,pz)
          const ca = Math.cos(ry), sa = Math.sin(ry);
          const P = (lx, ly, lw, lh, mat, ex = {}) => {
            if (lh <= 0.02) return; const gx = px + lx * ca, gz = pz - lx * sa;
            b.box(ry ? T : lw, lh, ry ? lw : T, gx, y0 + 0.08 + ly + lh / 2, gz, mat, { tpu: 1, ...ex });
          };
          const win = !(side === 0 && f === 0 && i === (w >> 1) && R() < 0.9) ; // door gap on ground floor front
          if (!win) { P(-0.36, 0, 0.28, Math.min(hh, 2.0), wall); P(0.36, 0, 0.28, Math.min(hh, 2.0), wall); P(0, 1.9, 1.0, Math.max(0, Math.min(hh - 1.9, 0.5)), trim); continue; }
          const sillH = Math.min(hh, 0.9);
          P(0, 0, 1.0, sillH, wall);
          if (hh > 0.9) {
            const mid = Math.min(hh, 1.85) - 0.9; const broken = ruined && R() < dmgBase * 0.5;
            if (!broken) { P(-0.39, 0.9, 0.22, mid, wall); P(0.39, 0.9, 0.22, mid, wall); } else if (R() < 0.5) P(-0.39, 0.9, 0.22, mid, wall); else P(0.39, 0.9, 0.22, mid, wall);
            if (R() < 0.5 && !broken) P(0, 0.9 + mid * 0.5, 0.56, 0.04, trim); // sill frame / bars
            if (hh > 1.85) P(0, 1.85, 1.0, hh - 1.85, wall);
          }
          // rebar sticking out from cut walls
          if (ruined && topCut < 1 && R() < 0.7) { const n = 1 + (R() * 2 | 0); for (let q = 0; q < n; q++) { const lx = (R() - 0.5) * 0.8; const gx = px + lx * ca, gz = pz - lx * sa; b.limb(gx, y0 + 0.08 + hh, gz, gx + (R() - 0.5) * 0.3, y0 + 0.08 + hh + 0.3 + R() * 0.45, gz + (R() - 0.5) * 0.3, 0.012, 0.012, 'rust:#7a3a20', 4); } }
        }
      }
      // floor trim band
      for (let side = 0; side < 4; side++) { const along = side % 2 === 0 ? w : d; if (side % 2 === 0) b.box(along + 0.1, 0.1, 0.06, 0, y0 + 0.04, (side === 0 ? 1 : -1) * (hd + 0.0), trim); else b.box(0.06, 0.1, along + 0.1, (side === 1 ? 1 : -1) * hw, y0 + 0.04, 0, trim); }
    }
    // corner posts
    for (const [x, z] of [[-hw + 0.15, -hd + 0.15], [hw - 0.15, -hd + 0.15], [hw - 0.15, hd - 0.15], [-hw + 0.15, hd - 0.15]]) { const ch = (ruined ? (0.5 + R() * 0.5) : 1) * h * FH; if (Math.hypot(x - cornerPos[0], z - cornerPos[1]) < 0.5 && ruined) continue; b.box(0.3, ch, 0.3, x, 0.16 + ch / 2, z, trim); if (ruined) b.limb(x, 0.16 + ch, z, x + (R() - 0.5) * 0.2, 0.16 + ch + 0.5, z + (R() - 0.5) * 0.2, 0.014, 0.014, 'rust:#7a3a20', 4); }
    // roof
    const ytop = 0.16 + h * FH;
    for (let i = 0; i < w; i++) for (let k = 0; k < d; k++) { if (ruined && R() < 0.55) continue; b.box(1.0, 0.14, 1.0, -hw + i + 0.5, ytop + 0.07, -hd + k + 0.5, 'concrete:#7a746a', { rx: ruined ? (R() - 0.5) * 0.12 : 0, rz: ruined ? (R() - 0.5) * 0.12 : 0 }); }
    if (!ruined) { b.box(w, 0.25, 0.1, 0, ytop + 0.25, hd - 0.05, trim); b.box(w, 0.25, 0.1, 0, ytop + 0.25, -hd + 0.05, trim); b.box(0.1, 0.25, d, hw - 0.05, ytop + 0.25, 0, trim); b.box(0.1, 0.25, d, -hw + 0.05, ytop + 0.25, 0, trim); }
    // roof clutter
    if (R() < 0.7) b.box(0.7, 0.45, 0.6, -hw + 1 + R() * (w - 2), ytop + 0.35, -hd + 0.8 + R() * (d - 1.6), 'metal:#5a626a');
    if (R() < 0.5) { const x = -hw + 0.8 + R() * (w - 1.6), z = -hd + 0.8 + R() * (d - 1.6); b.cyl(0.4, 0.4, 0.7, 8, x, ytop + 0.55, z, 'rust:#7a4a30', { uvs: 2 }); b.cyl(0.42, 0.01, 0.2, 8, x, ytop + 1.0, z, 'rust:#5a3a28'); for (const s of [-1, 1]) for (const t of [-1, 1]) b.limb(x + s * 0.3, ytop + 0.2, z + t * 0.3, x + s * 0.34, ytop + 0.25, z + t * 0.34, 0.03, 0.03, 'metal:#4a525a', 4); }
    // rubble ring
    const nr = ruined ? 14 + w * d : 6;
    for (let i = 0; i < nr; i++) { const s = 0.1 + R() * 0.3, a = R() * 6.28, onC = R() < 0.4; const cx = onC ? cornerPos[0] * 1.05 : 0, cz = onC ? cornerPos[1] * 1.05 : 0; const x = onC ? cx + (R() - 0.5) * 2 : Math.cos(a) * (hw + 0.2 + R() * 0.6), z = onC ? cz + (R() - 0.5) * 2 : Math.sin(a) * (hd + 0.2 + R() * 0.6); b.box(s, s * 0.6, s * (0.7 + R() * 0.5), x, s * 0.25, z, pick(R, [wall, 'concrete:#6a655c', 'brick']), { ry: R() * 3, rx: (R() - 0.5) * 0.6, rz: (R() - 0.5) * 0.4 }); }
    // graffiti
    const ng = 1 + (R() * 2 | 0); const sides = [0, 1, 2, 3].sort(() => R() - 0.5).slice(0, ng);
    b.extra(() => null);
    spec = b.finish();
    spec.graffiti = sides.map((side, j) => { const along = side % 2 === 0 ? w : d, u = (R() - 0.5) * Math.max(0, along - 1.6); return { side, u, v: (R() * 5) | 0 + j, y: 0.7 + R() * 0.3, hw, hd }; });
    specCache.set(key, spec);
  }
  const o = instantiate(spec);
  for (const gdesc of spec.graffiti) {
    const { side, u, v, y, hw, hd } = gdesc; const m = new THREE.Mesh(planeG(), grafMat(v)); m.scale.set(1.5, 0.75, 1); const off = (side % 2 === 0 ? hd : hw) + 0.01;
    if (side === 0) { m.position.set(u, y + 0.5, off); } else if (side === 2) { m.position.set(-u, y + 0.5, -off); m.rotation.y = Math.PI; } else if (side === 1) { m.position.set(off, y + 0.5, u); m.rotation.y = Math.PI / 2; } else { m.position.set(-off, y + 0.5, -u); m.rotation.y = -Math.PI / 2; }
    m.renderOrder = 3; o.add(m);
  }
  o.name = 'building'; o.userData.footprint = { w, d, h }; return o;
}
