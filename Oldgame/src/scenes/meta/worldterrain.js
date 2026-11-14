// worldterrain.js — 3D diorama of the region for the world map (2026-11-12):
// mountains with the bunker, wasteland dunes and mesas with a Nomad camp, the ruined city with broken skyscrapers
// and a collapsed overpass, the industrial zone with chimneys and a cooling tower, a toxic crater lake, a dry riverbed,
// the highway with power pylons, and Przystań (walled train depot). Everything procedural (no image files).
import { THREE, rngSeed, building, prop, makeFire, clamp } from './common.js';
import { buildFloraAtlas } from '../../gfx/flora.js';

export const HOME = new THREE.Vector2(-17, 8);
export const ZONES = { ruins: [2.5, 2], wastes: [23, 10], industrial: [12, -11.5], bunker: [-12, -9] };
// 2026-11-13 (v3): a big city (11x9 blocks on a 2.6 grid) with real streets, a main avenue, empty lots used as
// contract plazas, ruins and wrecks; named sectors with ground outlines and fixed contract spots.
export const CITY = { x: 2.5, z: 2, rx: 13.6, rz: 10.2, G: 2.6 };
const blk = (gx, gz) => [CITY.x + gx * CITY.G, CITY.z + gz * CITY.G];
const PLAZA_CELLS = [[-2, -1], [3, 1], [-3, 2], [1, -3], [0, 3], [4, -1], [-1, 1], [2, -2]];
export const PLAZAS = PLAZA_CELLS.map(([gx, gz]) => blk(gx, gz));
export const AVENUE_Z = CITY.z + 0.5 * CITY.G, GATE = [CITY.x - 4.5 * CITY.G - 1.6, CITY.z + 0.5 * CITY.G];
/** Street polyline from the west gate to a plaza: along the main avenue, then up/down the nearest cross street. */
export function cityRoute(px, pz) { const sx = px - CITY.G / 2; return [[GATE[0], AVENUE_Z], [sx, AVENUE_Z], [sx, pz], [px - 0.35, pz]]; }
export const inCity = (x, z) => ((x - CITY.x) / (CITY.rx - 0.4)) ** 2 + ((z - CITY.z) / (CITY.rz - 0.4)) ** 2 < 1;
export const SECTORS = [
  { id: 'ruins', name: 'RUINY MIASTA', sub: 'sektor miejski', color: 0xf2a93b, x: CITY.x, z: CITY.z, rx: CITY.rx + 0.5, rz: CITY.rz + 0.5, label: [2.5, 13.6], spots: PLAZAS },
  { id: 'wastes', name: 'PUSTKOWIA', sub: 'wydmy i obóz Nomadów', color: 0xd8c090, x: 24, z: 11, rx: 7.2, rz: 7.6, label: [24, 19.6], spots: [[21.5, 11.5], [27.5, 7.5], [20.5, 16], [27, 15], [23.5, 5.6]] },
  { id: 'industrial', name: 'STREFA PRZEMYSŁOWA', sub: 'fabryki i krater', color: 0xe0703a, x: 15, z: -12, rx: 8.6, rz: 4.4, label: [25, -16.8], spots: [[10.5, -14.2], [18.5, -10.6], [14.5, -9.6], [20.5, -13.6]] },
  { id: 'bunker', name: 'GÓRY · BUNKIER', sub: 'schrony w skałach', color: 0x6ab0ff, x: -15, z: -11, rx: 9, rz: 5.2, label: [-15, -5.2], spots: [[-13, -7.6], [-19.5, -8.2], [-9, -10.2], [-16.5, -12.5]] },
];
const CRATER = [19.5, -6], MESAS = [[25, 2, 2.4], [18, 17, 1.8], [29, 12, 2.0], [-8, 15.5, 1.6], [-24, -2, 2.2]];

const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
const g2 = (x, z, cx, cz, rx, rz) => Math.exp(-(((x - cx) / rx) ** 2 + ((z - cz) / rz) ** 2));
// river: sinuous dry bed from north-east down to south-west
const riverX = (z) => -2 + Math.sin(z * 0.28) * 4 + z * 0.35;
export function riverDist(x, z) { return Math.abs(x - riverX(z)); }

/** Terrain height (world units). Used for placing everything and by the travel animation. */
export function hgt(x, z) {
  let h = 0.35 * Math.sin(x * 0.31) * Math.cos(z * 0.27) + 0.22 * Math.sin(x * 0.73 + z * 0.51) + 0.12 * Math.sin(x * 1.7 - z * 1.3);
  // northern mountain range (bunker) with ridges
  const mnt = g2(x, z, -13, -13, 11, 5.5) + 0.7 * g2(x, z, -24, -10, 6, 7) + 0.5 * g2(x, z, 0, -17, 9, 3);
  h += mnt * (4.2 + 1.4 * Math.abs(Math.sin(x * 0.9 + z * 0.4)) + 0.8 * Math.sin(x * 2.1) * Math.cos(z * 1.7));
  // dunes in the eastern wastes
  const wastes = smooth(14, 20, x) * smooth(-4, 4, z);
  h += wastes * (0.55 * Math.max(0, Math.sin(x * 0.85 + Math.sin(z * 0.6) * 1.2)) ** 2);
  // mesas: flat-topped rocks with steep sides
  for (const [mx, mz, r] of MESAS) { const d = Math.hypot(x - mx, (z - mz) * 1.2); h += 1.7 * (1 - smooth(r - 0.35, r + 0.25, d)); }
  // toxic crater with a rim
  const dc = Math.hypot(x - CRATER[0], z - CRATER[1]); h += -1.5 * (1 - smooth(1.2, 2.8, dc)) + 0.55 * Math.exp(-((dc - 3) ** 2) / 0.8);
  // dry riverbed
  h -= 0.55 * (1 - smooth(0.4, 1.6, riverDist(x, z)));
  // flatten the city and Przystań
  { const e = ((x - CITY.x) / CITY.rx) ** 2 + ((z - CITY.z) / CITY.rz) ** 2; h *= 1 - 0.97 * (1 - smooth(0.85, 1.35, e)); }
  h *= 1 - 0.8 * g2(x, z, HOME.x, HOME.y, 3.5, 3);
  return h;
}

function terrainTexture(W, H, x0, z0, sx, sz) {
  const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d'), id = g.createImageData(W, H), rng = rngSeed(7);
  const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  for (let py = 0; py < H; py++) for (let px = 0; px < W; px++) {
    const x = x0 + px / W * sx, z = z0 + py / H * sz, h = hgt(x, z), n = rng();
    let col = [178, 142, 92];                                                          // sand
    col = mix(col, [198, 162, 104], 0.5 + 0.5 * Math.sin((x + z * 0.6) * 1.3));       // ripples
    col = mix(col, [126, 104, 76], smooth(-3, 6, x) * (1 - smooth(-4, 4, z)) * 0.5);    // dirt to the north-east
    if (h > 1.4) col = mix(col, [104, 92, 82], smooth(1.4, 3.2, h));                     // rock
    if (h > 4.2) col = mix(col, [150, 140, 132], smooth(4.2, 6, h) * 0.8);               // pale peaks
    const r = riverDist(x, z); if (r < 1.6) col = mix(col, [120, 98, 72], (1 - smooth(0.4, 1.6, r)) * 0.8);
    const dc = Math.hypot(x - CRATER[0], z - CRATER[1]); if (dc < 3.6) col = mix(col, [70, 76, 46], 1 - smooth(1.4, 3.6, dc));
    { const e = ((x - CITY.x) / CITY.rx) ** 2 + ((z - CITY.z) / CITY.rz) ** 2;
      if (e < 1.12) {
        const k = 1 - smooth(0.92, 1.12, e), G = CITY.G, fx = (((x - CITY.x) / G - 0.5) % 1 + 1) % 1, fz = (((z - CITY.z) / G - 0.5) % 1 + 1) % 1;
        const dx = Math.min(fx, 1 - fx) * G, dz = Math.min(fz, 1 - fz) * G, ds = Math.min(dx, dz);          // distance to the nearest street axis
        const ave = Math.abs(z - AVENUE_Z) < 0.62 || Math.abs(x - (CITY.x + 0.5 * G)) < 0.55, sw = ave ? 0.6 : 0.4;
        let c;
        if (ds < sw || ave) {                                                                               // asphalt + worn centre line + cracks
          c = [50 + n * 10, 48 + n * 10, 48 + n * 9];
          const along = dx < dz ? z : x, dAxis = ave ? Math.min(Math.abs(z - AVENUE_Z), Math.abs(x - (CITY.x + 0.5 * G))) : ds;
          if (dAxis < 0.06 && ((along * 1.6) % 1 + 1) % 1 < 0.55 && n > 0.25) c = [196, 170, 84];
          if (n > 0.93) c = [34, 32, 32];
        } else if (ds < sw + 0.16) c = [132, 126, 116];                                                     // kerb / pavement
        else { const lot = (Math.floor((x - CITY.x) / G + 0.5) * 7 + Math.floor((z - CITY.z) / G + 0.5) * 13) & 3; c = [[96, 86, 76], [84, 80, 74], [104, 90, 72], [78, 72, 66]][lot]; if (n > 0.8) c = [c[0] - 22, c[1] - 22, c[2] - 20]; if (n < 0.08) c = [c[0] + 26, c[1] + 22, c[2] + 14]; }
        col = mix(col, c, k);
      } }
    const ind = g2(x, z, 12, -10.5, 5.5, 3.2); if (ind > 0.35) col = mix(col, [96, 72, 56], smooth(0.35, 0.7, ind));
    const home = g2(x, z, HOME.x, HOME.y, 3.2, 2.4); if (home > 0.3) col = mix(col, [140, 122, 92], 0.7);
    const j = (n - 0.5) * 16, o = (py * W + px) * 4;
    id.data[o] = clamp(col[0] + j, 0, 255); id.data[o + 1] = clamp(col[1] + j, 0, 255); id.data[o + 2] = clamp(col[2] + j, 0, 255); id.data[o + 3] = 255;
  }
  g.putImageData(id, 0, 0); const t = new THREE.CanvasTexture(c); t.magFilter = THREE.NearestFilter; t.minFilter = THREE.LinearFilter; t.colorSpace = THREE.SRGBColorSpace; return t;
}

const lam = (c, o = {}) => new THREE.MeshLambertMaterial({ color: c, flatShading: true, ...o });
const at = (o, x, z, y = 0) => { o.position.set(x, hgt(x, z) + y, z); return o; };

/** Build the region into `scene`. Returns { update(dt, t) } for animated bits (smoke, fires, toxic glow, caravan). */
export function buildWorld(scene) {
  const rng = rngSeed(3), anim = [];
  // terrain: larger than the play area, fading into the fog
  const SX = 84, SZ = 56, geo = new THREE.PlaneGeometry(SX, SZ, 168, 112); geo.rotateX(-Math.PI / 2);
  const p = geo.attributes.position; for (let i = 0; i < p.count; i++) p.setY(i, hgt(p.getX(i), p.getZ(i)));
  geo.computeVertexNormals();
  scene.add(new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: terrainTexture(1512, 1008, -SX / 2, -SZ / 2, SX, SZ) })));
  if (scene.fog) { scene.fog = new THREE.Fog(scene.fog.color.clone(), 52, 105); }

  // ---- ruined city: grid of blocks, tall broken towers in the core
  const rubbleMat = [lam(0x6a6058), lam(0x5a5450), lam(0x7a5a48)], wallMat = [lam(0x8a5a48), lam(0x6e6a64), lam(0x7a7468)];
  for (let gx = -5; gx <= 5; gx++) for (let gz = -4; gz <= 4; gz++) {
    const [cx, cz] = blk(gx, gz), core = Math.exp(-(gx * gx / 9 + gz * gz / 6));
    if (!inCity(cx, cz) || PLAZA_CELLS.some(([px, pz]) => px === gx && pz === gz)) continue;
    const kind = rng();   // 0..0.12 empty rubble lot, ..0.3 ruins only, else buildings
    const lot = (ox, oz) => [cx + ox * 0.5, cz + oz * 0.5];
    if (kind > 0.3) {
      const nb = 1 + (rng() < 0.75 ? 1 : 0) + (rng() < 0.35 ? 1 : 0), corners = [[-1, -1], [1, 1], [1, -1], [-1, 1]].sort(() => rng() - 0.5);
      for (let k = 0; k < nb; k++) {
        const floors = Math.max(1, Math.round(1 + core * 4.5 * rng() + (rng() < 0.12 ? 3 : 0)));
        const b = building({ w: 2 + (rng() * 2 | 0), d: 2 + (rng() * 2 | 0), h: floors, ruined: true, seed: (rng() * 9999) | 0 });
        b.scale.setScalar(0.3); b.rotation.y = (rng() * 4 | 0) * Math.PI / 2; const [bx, bz] = lot(corners[k][0], corners[k][1]);
        scene.add(at(b, bx + (rng() - 0.5) * 0.15, bz + (rng() - 0.5) * 0.15));
      }
    }
    // ruins: rubble heaps, broken wall stubs, a leaning slab
    const nr = kind > 0.3 ? 1 + (rng() * 2 | 0) : 3 + (rng() * 3 | 0);
    for (let k = 0; k < nr; k++) {
      const rx = cx + (rng() - 0.5) * 1.5, rz = cz + (rng() - 0.5) * 1.5, t = rng();
      if (t < 0.45) { const r = new THREE.Mesh(new THREE.DodecahedronGeometry(0.16 + rng() * 0.22, 0), rubbleMat[k % 3]); r.scale.y = 0.45; r.rotation.y = rng() * 3; scene.add(at(r, rx, rz, 0.04)); }
      else if (t < 0.85) { const hh = 0.3 + rng() * 0.7, w = new THREE.Mesh(new THREE.BoxGeometry(0.5 + rng() * 0.6, hh, 0.09), wallMat[k % 3]); w.rotation.y = (rng() * 2 | 0) * Math.PI / 2; scene.add(at(w, rx, rz, hh / 2));
        if (rng() < 0.5) { const w2 = new THREE.Mesh(new THREE.BoxGeometry(0.09, hh * 0.6, 0.4), wallMat[(k + 1) % 3]); w2.position.copy(w.position); w2.position.y -= hh * 0.2; w2.position.x += 0.25; scene.add(w2); } }
      else { const sl = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.07, 0.5), wallMat[1]); sl.rotation.set(0.2, rng() * 3, 0.5 + rng() * 0.4); scene.add(at(sl, rx, rz, 0.22)); }
    }
  }
  // street furniture: wrecked cars, leaning lamp posts, barricades and oil drums on the streets
  for (let k = 0; k < 26; k++) {
    const gx = Math.round((rng() - 0.5) * 10), gz = Math.round((rng() - 0.5) * 8), vert = rng() < 0.5;
    const x = vert ? CITY.x + (gx + 0.5) * CITY.G + (rng() - 0.5) * 0.3 : CITY.x + gx * CITY.G + (rng() - 0.5) * 1.6, z = vert ? CITY.z + gz * CITY.G + (rng() - 0.5) * 1.6 : CITY.z + (gz + 0.5) * CITY.G + (rng() - 0.5) * 0.3;
    if (!inCity(x, z)) continue; const t = k % 4;
    if (t === 0) { const car = prop('car', { seed: k * 7 }); car.scale.setScalar(0.26); car.rotation.y = (vert ? Math.PI / 2 : 0) + (rng() - 0.5) * 0.9; scene.add(at(car, x, z)); }
    else if (t === 1) { const lp = new THREE.Group(), m = lam(0x3a3a3e); const po = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.04, 1.3, 4), m); po.position.y = 0.65; lp.add(po); const arm = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.04, 0.04), m); arm.position.set(0.15, 1.28, 0); lp.add(arm); const on = rng() < 0.3; const bulb = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.05, 0.07), new THREE.MeshBasicMaterial({ color: on ? 0xffc060 : 0x4a4a48 })); bulb.position.set(0.3, 1.24, 0); lp.add(bulb); lp.rotation.z = (rng() - 0.5) * 0.35; lp.rotation.y = rng() * 6; scene.add(at(lp, x + 0.38, z + 0.38)); }
    else if (t === 2) { for (let j = 0; j < 3; j++) { const bb = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.16, 0.14), lam([0x8a8478, 0x6a4a2a, 0x9a3a2a][j])); bb.rotation.y = (vert ? 0 : Math.PI / 2) + (rng() - 0.5) * 0.4; scene.add(at(bb, x + (vert ? (j - 1) * 0.3 : 0), z + (vert ? 0 : (j - 1) * 0.3), 0.08)); } }
    else { const br = prop(rng() < 0.4 ? 'barrel_toxic' : 'barrel'); br.scale.setScalar(0.26); scene.add(at(br, x, z)); }
  }
  // city gate on the west end of the main avenue
  { const g = new THREE.Group(), m = lam(0x5a5048); for (const sz of [-0.75, 0.75]) { const t = new THREE.Mesh(new THREE.BoxGeometry(0.4, 1.5, 0.4), m); t.position.set(0, 0.75, sz); g.add(t); } const bar = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 1.9), lam(0x7a3a2a)); bar.position.y = 1.5; g.add(bar); scene.add(at(g, GATE[0] + 0.9, GATE[1])); }
  // skyscraper husks
  for (const [gx, gz, h, ox, oz] of [[0, 0, 9, 0.5, -0.5], [1, 0, 7, -0.5, 0.5], [0, -1, 6.5, -0.5, 0.5], [-1, 0, 6, 0.5, 0.5], [1, 1, 5.5, 0.5, -0.5], [2, -1, 5, -0.4, -0.4]]) { const x = blk(gx, gz)[0] + ox * 0.55, z = blk(gx, gz)[1] + oz * 0.55;
    const t = new THREE.Group(), w = 0.95, m = lam(0x55524e);
    const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), m); body.position.y = h / 2; t.add(body);
    const top = new THREE.Mesh(new THREE.BoxGeometry(w * 0.7, 0.9, w * 0.5), m); top.position.set(-0.2, h + 0.3, 0.2); top.rotation.z = 0.35; t.add(top);
    for (let fy = 0.6; fy < h - 0.3; fy += 0.45) for (const sx of [-1, 1]) { const win = new THREE.Mesh(new THREE.BoxGeometry(w * 0.8, 0.14, 0.02), lam(rng() < 0.08 ? 0xffb050 : 0x1a1816, rng() < 0.08 ? { emissive: 0x6a3a10 } : {})); win.position.set(0, fy, sx * (w / 2 + 0.01)); t.add(win); }
    for (let k = 0; k < 3; k++) { const rb = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.7, 3), lam(0x6a4030)); rb.position.set((rng() - 0.5) * w, h + 0.3, (rng() - 0.5) * w); rb.rotation.z = (rng() - 0.5); t.add(rb); }
    scene.add(at(t, x, z));
  }
  // collapsed overpass entering the city
  { const dk = lam(0x6a6460); for (let k = 0; k < 6; k++) { const x = -15.5 + k * 1.0, z = 7.2 - k * 0.5 - 1.3, y = 1.2; if (k === 3) continue; const deck = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.18, 0.8), dk); deck.position.set(x, hgt(x, z) + y - (k === 4 ? 0.6 : 0), z); deck.rotation.y = 0.31; deck.rotation.z = k === 4 ? 0.45 : k === 2 ? -0.12 : 0; scene.add(deck); const pil = new THREE.Mesh(new THREE.BoxGeometry(0.22, y, 0.22), dk); pil.position.set(x, hgt(x, z) + y / 2, z); scene.add(pil); } }
  // fires and smoke plumes in the city
  for (const [x, z] of [blk(1, -1), blk(-2, 1), blk(3, 2), blk(-1, -3), blk(4, 0)].map(([a, b]) => [a + 0.6, b - 0.6])) { const f = makeFire(0.5); scene.add(at(f, x, z, 0.2)); anim.push({ type: 'fire', o: f }); anim.push({ type: 'smoke', ...smokePlume(scene, x, z, 0x2a2624, 5) }); }

  // ---- industrial zone: factories, chimneys, cooling tower, containers
  for (let k = 0; k < 6; k++) { const x = 9 + (k % 3) * 2.2 + (rng() - 0.5) * 0.4, z = -11 + (k / 3 | 0) * 2.4; const f = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.8 + rng() * 0.6, 1.2), lam([0x7a4a30, 0x5a4a40, 0x6a5040][k % 3])); scene.add(at(f, x, z, 0.5)); const roof = new THREE.Mesh(new THREE.BoxGeometry(1.75, 0.08, 1.25), lam(0x3a3430)); roof.position.copy(f.position); roof.position.y += 0.5; roof.rotation.z = 0.05; scene.add(roof); }
  for (const [x, z, h] of [[9.4, -12.2, 3.2], [12.6, -12.4, 3.8], [14.2, -9.8, 2.8]]) { const ch = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.28, h, 8), lam(0x7a3a2a)); scene.add(at(ch, x, z, h / 2)); const band = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.15, 8), lam(0xd8d2c0)); band.position.copy(ch.position); band.position.y += h / 2 - 0.4; scene.add(band); anim.push({ type: 'smoke', ...smokePlume(scene, x, z, 0x6a645c, 4, hgt(x, z) + h) }); }
  { const pts = []; for (let i = 0; i <= 10; i++) { const y = i / 10 * 2.6, r = 1.0 - 0.45 * Math.sin(i / 10 * Math.PI) + (i === 10 ? 0.05 : 0); pts.push(new THREE.Vector2(r, y)); } const ct = new THREE.Mesh(new THREE.LatheGeometry(pts, 14), lam(0x8a847a, { side: THREE.DoubleSide })); scene.add(at(ct, 15.2, -12)); anim.push({ type: 'smoke', ...smokePlume(scene, 15.2, -12, 0xd8d4cc, 3.5, hgt(15.2, -12) + 2.7, 0.9) }); }
  for (let k = 0; k < 8; k++) { const c = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.38, 0.38), lam([0xa04a2a, 0x2a6a8a, 0x8a8a3a, 0x5a6a4a][k % 4])); c.rotation.y = rng() * 0.3; scene.add(at(c, 8 + rng() * 6, -7.6 + rng() * 1.2, 0.2 + (k > 5 ? 0.38 : 0))); }

  // ---- mountains: bunker entrance with antenna and red beacon
  { const bx = -12, bz = -7.2, door = new THREE.Group(); const fr = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.1, 0.5), lam(0x5a5a5e)); fr.position.y = 0.55; door.add(fr); const hole = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.8, 0.1), new THREE.MeshBasicMaterial({ color: 0x0c0e10 })); hole.position.set(0, 0.45, 0.26); door.add(hole); const light = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.06, 0.06), new THREE.MeshBasicMaterial({ color: 0xffb040 })); light.position.set(0, 0.95, 0.3); door.add(light); scene.add(at(door, bx, bz, -0.1));
    const ant = new THREE.Group(); const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.08, 3, 4), lam(0x8a8a8a)); mast.position.y = 1.5; ant.add(mast); const bea = new THREE.Mesh(new THREE.SphereGeometry(0.12, 6, 4), new THREE.MeshBasicMaterial({ color: 0xff2a1a })); bea.position.y = 3.05; ant.add(bea); scene.add(at(ant, -10.4, -9.6)); anim.push({ type: 'blink', o: bea }); }

  // ---- toxic crater lake
  { const lake = new THREE.Mesh(new THREE.CircleGeometry(2.1, 24), new THREE.MeshBasicMaterial({ color: 0x7fe040, transparent: true, opacity: 0.85 })); lake.rotation.x = -Math.PI / 2; lake.position.set(CRATER[0], hgt(CRATER[0], CRATER[1]) + 0.35, CRATER[1]); scene.add(lake); const gl = new THREE.PointLight(0x8fff40, 18, 9); gl.position.set(CRATER[0], lake.position.y + 1.2, CRATER[1]); scene.add(gl); anim.push({ type: 'toxic', o: lake, l: gl });
    for (let k = 0; k < 6; k++) { const a = k * 1.05, br = prop('barrel_toxic'); br.scale.setScalar(0.35); scene.add(at(br, CRATER[0] + Math.cos(a) * 3.1, CRATER[1] + Math.sin(a) * 2.9)); } }

  // ---- wastes: nomad caravan camp, wagons, giant skeleton, dead trees
  { const cx = 22, cz = 9.5; for (let k = 0; k < 5; k++) { const a = k * 1.25, t = new THREE.Mesh(new THREE.ConeGeometry(0.45, 0.7, 6), lam([0xc8a468, 0x9a6a3a, 0xb88a54][k % 3])); scene.add(at(t, cx + Math.cos(a) * 1.4, cz + Math.sin(a) * 1.1, 0.35)); }
    const f = makeFire(0.45); scene.add(at(f, cx, cz, 0.15)); anim.push({ type: 'fire', o: f });
    const fl = new THREE.PointLight(0xff9a40, 8, 6); fl.position.set(cx, hgt(cx, cz) + 0.8, cz); scene.add(fl); anim.push({ type: 'flicker', o: fl });
    for (let k = 0; k < 3; k++) { const wg = new THREE.Group(); const bd = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.35, 0.45), lam(0x6a4a2a)); bd.position.y = 0.35; wg.add(bd); const cv = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.9, 8, 1, false, 0, Math.PI), lam(0xd8c8a0)); cv.rotation.z = Math.PI / 2; cv.position.y = 0.52; wg.add(cv); wg.rotation.y = 0.4 + k * 0.5; scene.add(at(wg, cx + 2.2 + k * 0.9, cz - 1.4 + k * 0.6)); }
  }
  { const sx = 25, sz = 16.5; for (let k = 0; k < 7; k++) { const rib = new THREE.Mesh(new THREE.TorusGeometry(0.7 - Math.abs(k - 3) * 0.08, 0.05, 4, 10, Math.PI), lam(0xe6dcc0)); rib.rotation.y = Math.PI / 2; scene.add(at(rib, sx + k * 0.32, sz, 0)); } const sk = new THREE.Mesh(new THREE.SphereGeometry(0.35, 6, 5), lam(0xe6dcc0)); scene.add(at(sk, sx - 0.4, sz, 0.25)); }
  for (let k = 0; k < 40; k++) { const x = -30 + rng() * 62, z = -18 + rng() * 40; if (inCity(x, z)) continue; const r = new THREE.Mesh(new THREE.DodecahedronGeometry(0.12 + rng() * 0.25, 0), lam(0x7a6a5a)); r.scale.y = 0.6; scene.add(at(r, x, z, 0.05)); }

  // ---- highway from Przystań to the city, with power pylons and wrecks
  { const pts = [], N = 30; for (let i = 0; i <= N; i++) { const t = i / N, x = HOME.x + (GATE[0] - HOME.x) * t, z = HOME.y + (GATE[1] - HOME.y) * t + Math.sin(t * Math.PI) * 0.9; pts.push([x, z]); }
    const asph = lam(0x3a3634), line = new THREE.MeshBasicMaterial({ color: 0xd8c070 });
    for (let i = 0; i < N; i++) { if (i === 12 || i === 19) continue; const [ax, az] = pts[i], [bx, bz] = pts[i + 1], len = Math.hypot(bx - ax, bz - az); const seg = new THREE.Mesh(new THREE.BoxGeometry(len * 1.05, 0.05, 0.75), asph); seg.position.set((ax + bx) / 2, Math.max(hgt(ax, az), hgt(bx, bz)) + 0.04, (az + bz) / 2); seg.rotation.y = -Math.atan2(bz - az, bx - ax); scene.add(seg); if (i % 2 === 0) { const dl = new THREE.Mesh(new THREE.BoxGeometry(len * 0.5, 0.02, 0.05), line); dl.position.copy(seg.position); dl.position.y += 0.035; dl.rotation.y = seg.rotation.y; scene.add(dl); } }
    for (let i = 2; i < N; i += 4) { if (i > 28) continue; const [x, z] = pts[i], py = new THREE.Group(); const m = lam(0x4a4a4e); const l1 = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.06, 2.2, 4), m); l1.position.y = 1.1; py.add(l1); const cr = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.06, 0.06), m); cr.position.y = 2.0; py.add(cr); if (i === 14) py.rotation.z = 0.7; scene.add(at(py, x, z + 0.8)); }
    for (const i of [6, 15, 23]) { const [x, z] = pts[i], car = prop('car', { seed: i }); car.scale.setScalar(0.35); car.rotation.y = i; scene.add(at(car, x + 0.2, z + 0.1)); }
  }

  // ---- Przystań: walled depot with huts, a locomotive, watchtowers and lights
  { const g = new THREE.Group(), wall = lam(0x6a5a46);
    for (let k = 0; k < 24; k++) { const a = k / 24 * Math.PI * 2; if (k === 6) continue; const s = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.55, 0.12), wall); s.position.set(Math.cos(a) * 2.6, 0.28, Math.sin(a) * 1.9); s.rotation.y = -a + Math.PI / 2; g.add(s); }
    for (let k = 0; k < 5; k++) { const h = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.45, 0.55), lam([0x7a6a52, 0x5a4a3a, 0x8a6a4a][k % 3])); h.position.set(-1.4 + k * 0.7, 0.23, (k % 2 ? 0.7 : -0.6)); g.add(h); const rf = new THREE.Mesh(new THREE.ConeGeometry(0.5, 0.3, 4), lam(0x7a3a2a)); rf.position.set(h.position.x, 0.6, h.position.z); rf.rotation.y = Math.PI / 4; g.add(rf); }
    const loco = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.5, 0.45), lam(0x3a4a3a)); loco.position.set(0.3, 0.3, 0.05); g.add(loco); const cab = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.35, 0.45), lam(0x2a3a2a)); cab.position.set(0.9, 0.7, 0.05); g.add(cab);
    for (const [x, z] of [[-2.4, -1.2], [2.3, 1.1]]) { const tw = new THREE.Mesh(new THREE.BoxGeometry(0.3, 1.4, 0.3), lam(0x5a4a3a)); tw.position.set(x, 0.7, z); g.add(tw); const lp = new THREE.PointLight(0xffc070, 6, 5); lp.position.set(x, 1.6, z); g.add(lp); anim.push({ type: 'flicker', o: lp }); }
    const f = makeFire(0.4); f.position.set(-0.4, 0.1, 0.05); g.add(f); anim.push({ type: 'fire', o: f });
    scene.add(at(g, HOME.x, HOME.y)); anim.push({ type: 'smoke', ...smokePlume(scene, HOME.x - 0.4, HOME.y, 0x4a4440, 2.5) });
  }

  // ---- flora (2026-11-13 v2): shaded pixel-art plants (gfx/flora.js atlas) as instanced billboards that sway in the wind.
  // Species depend on the biome: glowing mushrooms / pods / reeds round the toxic crater, reeds, ferns and mutated
  // flowers in the dry riverbed, cacti in the eastern wastes, weeds and vines in the ruins, crystals in the rocks.
  const floraU = { value: 0 };
  {
    const A = buildFloraAtlas(), baseTex = new THREE.CanvasTexture(A.canvas); baseTex.magFilter = baseTex.minFilter = THREE.NearestFilter; baseTex.generateMipmaps = false; baseTex.colorSpace = THREE.SRGBColorSpace;
    const lists = new Map(), put = (type, x, z, s) => { const v = (rng() * 3) | 0, k = type + v; if (!lists.has(k)) lists.set(k, []); lists.get(k).push([x, z, s * (0.85 + rng() * 0.35), rng() < 0.5 ? -1 : 1]); };
    const pick = (arr) => arr[(rng() * arr.length) | 0];
    for (let i = 0; i < 760; i++) {
      const x = -36 + rng() * 72, z = -21 + rng() * 46; if (g2(x, z, HOME.x, HOME.y, 3, 2.4) > 0.4) continue;
      const h = hgt(x, z), city = inCity(x, z), dc = Math.hypot(x - CRATER[0], z - CRATER[1]), dr = riverDist(x, z), east = smooth(10, 20, x), t = rng();
      if (h > 4.2 || dc < 2.3) continue;
      if (city) { if (t < 0.13) put(pick(['grass', 'fern', 'vine', 'grass', 'deadbush']), x, z, 0.5); continue; }
      if (dc < 7) put(pick(['shrooms', 'shrooms', 'reeds', 'pod', 'vine', 'fern']), x, z, 0.75);
      else if (h > 1.7) { if (t < 0.5) put(pick(['crystal', 'deadbush', 'tree', 'crystal']), x, z, 0.8); }
      else if (dr < 2.4) put(pick(['reeds', 'fern', 'flower', 'shrooms', 'grass', 'fern']), x, z, 0.72);
      else if (east > 0.5) { if (t < 0.7) put(pick(['saguaro', 'saguaro', 'pear', 'deadbush', 'grass', 'pear', 'crystal']), x, z, 0.85); }
      else if (t < 0.6) put(pick(['deadbush', 'grass', 'tree', 'grass', 'pear', 'flower', 'deadbush', 'fern', 'pod']), x, z, 0.78);
    }
    const u = 0.034, geo = new THREE.PlaneGeometry(A.cw * u, A.ch * u); geo.translate(0, (A.gy - A.ch / 2) * u, 0); geo.rotateX(-0.42);
    const D = new THREE.Object3D();
    for (const cell of A.cells) {
      const list = lists.get(cell.type + cell.variant); if (!list) continue;
      const tex = baseTex.clone(); tex.repeat.set(1 / A.cols, 1 / A.rows); tex.offset.set(cell.col / A.cols, 1 - (cell.row + 1) / A.rows); tex.needsUpdate = true;
      const mat = new THREE.MeshBasicMaterial({ map: tex, alphaTest: 0.5, side: THREE.DoubleSide, color: cell.glow ? 0xffffff : 0xe0cdb8, fog: true });
      mat.onBeforeCompile = (sh) => { sh.uniforms.uT = floraU; sh.vertexShader = sh.vertexShader.replace('void main() {', 'uniform float uT;\nvoid main() {').replace('#include <begin_vertex>', '#include <begin_vertex>\n#ifdef USE_INSTANCING\n transformed.x += sin(uT * 1.6 + instanceMatrix[3].x * 1.7 + instanceMatrix[3].z * 1.1) * 0.07 * uv.y * uv.y;\n#endif'); };
      mat.customProgramCacheKey = () => 'flora-sway';
      const im = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach(([x, z, sc, flip], i) => { D.position.set(x, hgt(x, z) - 0.03, z); D.scale.set(sc * flip, sc, sc); D.updateMatrix(); im.setMatrixAt(i, D.matrix); });
      im.frustumCulled = false; im.renderOrder = 2; scene.add(im);
    }
  }

  // ---- sector outlines: dashed ground ellipses in the sector colour + plaza pavement in the city
  for (const sc of SECTORS) {
    const N = Math.round((sc.rx + sc.rz) * 3.2), mat = new THREE.MeshBasicMaterial({ color: sc.color, transparent: true, opacity: 0.55, fog: false, depthWrite: false });
    for (let k = 0; k < N; k++) { if (k % 2) continue; const a = k / N * Math.PI * 2, b = (k + 1) / N * Math.PI * 2, ax = sc.x + Math.cos(a) * sc.rx, az = sc.z + Math.sin(a) * sc.rz, bx = sc.x + Math.cos(b) * sc.rx, bz = sc.z + Math.sin(b) * sc.rz;
      const d = new THREE.Mesh(new THREE.BoxGeometry(Math.hypot(bx - ax, bz - az), 0.05, 0.16), mat); d.position.set((ax + bx) / 2, Math.max(hgt(ax, az), hgt(bx, bz)) + 0.14, (az + bz) / 2); d.rotation.y = -Math.atan2(bz - az, bx - ax); scene.add(d); }
  }
  for (const [px, pz] of PLAZAS) { const pl = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.05, 1.7), lam(0x9a9284)); scene.add(at(pl, px, pz, 0.03)); for (const [ox, oz] of [[-0.75, -0.75], [0.75, 0.75]]) { const bl = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.3, 0.12), lam(0x3a3a3e)); scene.add(at(bl, px + ox, pz + oz, 0.15)); } }

  return {
    update(dt, t) {
      floraU.value = t;
      for (const a of anim) {
        if (a.type === 'fire') a.o.userData.update?.(t);
        else if (a.type === 'smoke') a.update(dt);
        else if (a.type === 'blink') a.o.visible = Math.sin(t * 4) > 0;
        else if (a.type === 'toxic') { a.o.material.color.setHSL(0.27, 0.75, 0.45 + 0.06 * Math.sin(t * 2)); a.l.intensity = 14 + 6 * Math.sin(t * 2.3); }
        else if (a.type === 'flicker') a.o.intensity = (a.base ??= a.o.intensity) * (0.8 + 0.2 * Math.sin(t * 13 + a.o.id) * Math.sin(t * 7.3));
      }
    },
  };
}

/** Rising smoke plume made of soft billboard puffs. */
function smokePlume(scene, x, z, color, height, y0, size = 0.7) {
  const base = y0 ?? hgt(x, z) + 0.3, puffs = [];
  const c = document.createElement('canvas'); c.width = c.height = 32; const g = c.getContext('2d'); const gr = g.createRadialGradient(16, 16, 2, 16, 16, 15); gr.addColorStop(0, 'rgba(255,255,255,0.8)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 32, 32);
  const tex = new THREE.CanvasTexture(c);
  for (let i = 0; i < 9; i++) { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color, transparent: true, depthWrite: false, opacity: 0.5 })); s.userData.k = i / 9; scene.add(s); puffs.push(s); }
  return {
    update(dt) {
      for (const s of puffs) {
        s.userData.k = (s.userData.k + dt * 0.08) % 1; const k = s.userData.k;
        s.position.set(x + k * 1.6 + Math.sin(k * 9) * 0.15, base + k * height, z - k * 0.4);
        const sc = size * (0.6 + k * 2.4); s.scale.set(sc, sc, 1); s.material.opacity = 0.55 * Math.sin(k * Math.PI);
      }
    },
  };
}
