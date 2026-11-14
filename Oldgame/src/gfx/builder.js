// Geometry builder that merges many transformed primitives into one mesh per material (fast scenery).
import { THREE } from '../core/engine.js';
import { surf } from './textures.js';
import { canvasTex, mkCanvas } from './util.js';

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1), _n = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0), _d = new THREE.Vector3(), _nm = new THREE.Matrix3();

export function boxGeo(w, h, d, tpu = 1) {
  const g = new THREE.BoxGeometry(w, h, d); const uv = g.attributes.uv;
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) for (let i = 0; i < 4; i++) { const k = f * 4 + i; uv.setXY(k, uv.getX(k) * dims[f][0] * tpu, uv.getY(k) * dims[f][1] * tpu); }
  return g;
}

export class Builder {
  constructor() { this.parts = new Map(); this.extras = []; }
  _slot(mat) { const k = typeof mat === 'string' ? mat : mat.uuid; let s = this.parts.get(k); if (!s) { s = { mat, pos: [], nor: [], uv: [], idx: [], base: 0 }; this.parts.set(k, s); } return s; }
  geo(geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
    const s = this._slot(mat); _q.setFromEuler(_e.set(rx, ry, rz)); _m.compose(_v.set(x, y, z), _q, _s.set(sx, sy, sz));
    _nm.getNormalMatrix(_m); const p = geo.attributes.position, n = geo.attributes.normal, uv = geo.attributes.uv;
    for (let i = 0; i < p.count; i++) { _v.fromBufferAttribute(p, i).applyMatrix4(_m); s.pos.push(_v.x, _v.y, _v.z); _n.fromBufferAttribute(n, i).applyMatrix3(_nm).normalize(); s.nor.push(_n.x, _n.y, _n.z); s.uv.push(uv.getX(i), uv.getY(i)); }
    if (geo.index) for (let i = 0; i < geo.index.count; i++) s.idx.push(geo.index.getX(i) + s.base); else for (let i = 0; i < p.count; i++) s.idx.push(i + s.base);
    s.base += p.count; return this;
  }
  box(w, h, d, x, y, z, mat, o = {}) { return this.geo(boxGeo(w, h, d, o.tpu || 1), mat, x, y, z, o.rx || 0, o.ry || 0, o.rz || 0); }
  cyl(rt, rb, h, seg, x, y, z, mat, o = {}) { const g = new THREE.CylinderGeometry(rt, rb, h, seg, 1, !!o.open); if (o.uvs) { const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * o.uvs, uv.getY(i) * (o.uvt || o.uvs)); } return this.geo(g, mat, x, y, z, o.rx || 0, o.ry || 0, o.rz || 0); }
  /** cylinder/beam between two points */
  limb(x0, y0, z0, x1, y1, z1, r0, r1, mat, seg = 5) {
    _d.set(x1 - x0, y1 - y0, z1 - z0); const len = _d.length(); if (len < 1e-5) return this; _d.normalize(); _q.setFromUnitVectors(_up, _d); const e = new THREE.Euler().setFromQuaternion(_q);
    const g = new THREE.CylinderGeometry(r1, r0, len, seg, 1); return this.geo(g, mat, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, e.x, e.y, e.z);
  }
  beam(x0, y0, z0, x1, y1, z1, th, mat) {
    _d.set(x1 - x0, y1 - y0, z1 - z0); const len = _d.length(); _d.normalize(); _q.setFromUnitVectors(_up, _d); const e = new THREE.Euler().setFromQuaternion(_q);
    return this.geo(boxGeo(th, len, th), mat, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, e.x, e.y, e.z);
  }
  extra(fn) { this.extras.push(fn); return this; }
  finish() {
    const parts = [];
    for (const s of this.parts.values()) {
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(s.pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(s.nor, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(s.uv, 2)); g.setIndex(s.idx); g.computeBoundingSphere(); g.computeBoundingBox();
      parts.push({ geo: g, mat: typeof s.mat === 'string' ? surf(s.mat) : s.mat, key: typeof s.mat === 'string' ? s.mat : '' });
    }
    return { parts, extras: this.extras };
  }
}
export function instantiate(spec, { cast = true } = {}) {
  const root = new THREE.Group();
  for (const p of spec.parts) { const m = new THREE.Mesh(p.geo, p.mat); m.castShadow = cast; m.receiveShadow = true; root.add(m); }
  for (const f of spec.extras) { const o = f(); if (o) root.add(o); }
  return root;
}

// ---------- billboard helpers & glow ----------
const _bv = new THREE.Vector3();
export function yawBillboard(mesh, anim) {
  mesh.onBeforeRender = (r, s, cam) => {
    cam.getWorldDirection(_bv); mesh.quaternion.setFromAxisAngle(_up, Math.atan2(-_bv.x, -_bv.z)); mesh.updateMatrix();
    if (mesh.parent) mesh.matrixWorld.multiplyMatrices(mesh.parent.matrixWorld, mesh.matrix); else mesh.matrixWorld.copy(mesh.matrix);
    if (anim) anim(mesh, performance.now() / 1000);
  };
  mesh.frustumCulled = false; return mesh;
}
let glowTex = null, flameTex = null, planeGeo = null;
export function glowTexture() {
  if (glowTex) return glowTex;
  const [c, g] = mkCanvas(32, 32);
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) { const d = Math.hypot(x - 15.5, y - 15.5) / 16; if (d >= 1) continue; const a = Math.floor((1 - d) * (1 - d) * 5) / 5; g.fillStyle = `rgba(255,255,255,${a})`; g.fillRect(x, y, 1, 1); }
  return (glowTex = canvasTex(c));
}
export function flameTexture() {
  if (flameTex) return flameTex;
  const [c, g] = mkCanvas(16, 24);
  const cols = ['#c8300a', '#ff6a14', '#ffb02a', '#fff0a0'];
  cols.forEach((col, i) => { const w = 6 - i * 1.6, h = 20 - i * 4.5; g.fillStyle = col; for (let y = 0; y < h; y++) { const t = y / h; const ww = Math.max(1, Math.round(w * Math.sin(Math.PI * Math.pow(t, 0.7)) + (t > 0.85 ? 0 : 0.5))); g.fillRect(8 - ww, 23 - i * 0.5 - y, ww * 2, 1); } });
  return (flameTex = canvasTex(c));
}
export function planeG() { return planeGeo || (planeGeo = new THREE.PlaneGeometry(1, 1)); }
export function glowSprite(color, size, x, y, z, { pulse = 0, phase = 0, opacity = 0.7 } = {}) {
  const m = new THREE.Mesh(planeG(), new THREE.MeshBasicMaterial({ map: glowTexture(), color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, opacity }));
  m.scale.set(size, size, 1); m.position.set(x, y, z); m.renderOrder = 5;
  const ph = Math.random() * 6 + phase;
  yawBillboard(m, pulse ? (mm, t) => { mm.material.opacity = opacity * (0.75 + 0.25 * Math.sin(t * pulse + ph) + 0.1 * Math.sin(t * pulse * 2.7 + ph * 2)); } : null);
  return m;
}
export function flameSprite(x, y, z, size = 0.5) {
  const m = new THREE.Mesh(planeG(), new THREE.MeshBasicMaterial({ map: flameTexture(), transparent: true, alphaTest: 0.3, depthWrite: false, fog: false, side: THREE.DoubleSide }));
  m.position.set(x, y, z); m.renderOrder = 4; const ph = Math.random() * 10;
  yawBillboard(m, (mm, t) => { const f = Math.sin(t * 17 + ph) * 0.5 + Math.sin(t * 29 + ph * 2) * 0.5; const k = size * (1 + f * 0.14); mm.scale.set(k * 0.66 * (1 - f * 0.1), k, 1); mm.position.y = y + k * 0.5; });
  return m;
}
