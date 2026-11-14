// Lights, fog, gradient sky (screen-space background), drifting dust/ash/spores, light shafts.
import { THREE } from '../core/engine.js';
import { mkCanvas, canvasTex, rng, parseHex, mix, bayer, clamp } from './util.js';
import { glowTexture } from './builder.js';

export const fxLights = new WeakMap();
export function getFxLights(scene) {
  let l = fxLights.get(scene);
  if (!l) { l = [0, 1].map(() => { const p = new THREE.PointLight(0xffaa55, 0, 9, 2); p.userData.free = true; scene.add(p); return p; }); fxLights.set(scene, l); }
  return l;
}

const MOODS = {
  day: { top: '#5f8eb0', mid: '#b8c8c0', hor: '#e8d8a8', sunC: '#fff2d0', sunI: 2.6, dir: [0.55, 0.85, 0.4], hemiS: '#cfe0f0', hemiG: '#7a6a54', hemiI: 1.05, fog: '#cdbd92', dens: 0.011, dust: ['#f0dcaa', 160, 0.5], disc: [0.78, 0.22, '#fff6d8'], shafts: 0.03 },
  dusk: { top: '#2e2748', mid: '#a0583e', hor: '#f2a050', sunC: '#ff9a50', sunI: 2.4, dir: [-0.85, 0.42, 0.5], hemiS: '#9a7aaa', hemiG: '#6a4a3a', hemiI: 1.15, fog: '#b0704a', dens: 0.015, dust: ['#ffc880', 220, 0.55], disc: [0.2, 0.62, '#ffd890'], shafts: 0.045 },
  night: { top: '#06081a', mid: '#101a34', hor: '#243252', sunC: '#7a9ade', sunI: 1.1, dir: [0.4, 0.8, -0.45], hemiS: '#4a5a8a', hemiG: '#222232', hemiI: 1.0, fog: '#0c1220', dens: 0.017, dust: ['#a8b8d8', 90, 0.35], disc: [0.8, 0.2, '#dde8ff'], shafts: 0 },
  toxic: { top: '#2a3a14', mid: '#5a7a22', hor: '#a8c04a', sunC: '#d8e070', sunI: 1.6, dir: [0.3, 0.7, 0.6], hemiS: '#9ab860', hemiG: '#3a4a1c', hemiI: 0.95, fog: '#5c7a24', dens: 0.022, dust: ['#b8ff60', 260, 0.6], disc: [0.5, 0.3, '#e8f090'], shafts: 0.05 },
  storm: { top: '#6a4a26', mid: '#9a7440', hor: '#c8a060', sunC: '#e8b878', sunI: 1.3, dir: [0.7, 0.55, 0.3], hemiS: '#b89a68', hemiG: '#6a5030', hemiI: 0.95, fog: '#a8844a', dens: 0.04, dust: ['#e8c88a', 520, 0.55], disc: [0.65, 0.3, '#f0d090'], shafts: 0 },
};

function skyTexture(M, mood) {
  const W = 128, H = 72, [c, g] = mkCanvas(W, H), id = g.createImageData(W, H), d = id.data;
  const T = parseHex(M.top), Mi = parseHex(M.mid), Ho = parseHex(M.hor), R = rng(mood.length * 31 + 7);
  const sx = M.disc[0] * W, sy = M.disc[1] * H, sc = parseHex(M.disc[2]);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const t = y / (H - 1); let r, gg, b;
    if (t < 0.55) { const k = t / 0.55; r = T[0] + (Mi[0] - T[0]) * k; gg = T[1] + (Mi[1] - T[1]) * k; b = T[2] + (Mi[2] - T[2]) * k; } else { const k = (t - 0.55) / 0.45; r = Mi[0] + (Ho[0] - Mi[0]) * k; gg = Mi[1] + (Ho[1] - Mi[1]) * k; b = Mi[2] + (Ho[2] - Mi[2]) * k; }
    const dd = Math.hypot((x - sx) * 0.7, y - sy); const glow = clamp(1 - dd / 34, 0, 1);
    const q = Math.floor(glow * glow * 6 + bayer(x, y)) / 6;
    r += (sc[0] - r) * q * 0.5; gg += (sc[1] - gg) * q * 0.5; b += (sc[2] - b) * q * 0.5;
    const i = (y * W + x) * 4; d[i] = r; d[i + 1] = gg; d[i + 2] = b; d[i + 3] = 255;
  }
  g.putImageData(id, 0, 0);
  if (mood === 'night') { for (let i = 0; i < 90; i++) { g.fillStyle = R() < 0.2 ? '#fff' : '#8a9acb'; g.fillRect(R() * W, R() * H * 0.6, 1, 1); } g.fillStyle = '#e8eeff'; g.beginPath(); g.arc(sx, sy, 5, 0, 6.3); g.fill(); g.fillStyle = '#06081a'; g.beginPath(); g.arc(sx + 2, sy - 1, 4.2, 0, 6.3); g.fill(); g.fillStyle = '#e8eeff'; g.fillRect(sx - 3, sy + 1, 2, 2); }
  else { g.fillStyle = M.disc[2]; g.beginPath(); g.arc(sx, sy, mood === 'dusk' ? 6 : 4, 0, 6.3); g.fill(); g.fillStyle = '#fff'; g.beginPath(); g.arc(sx, sy, 2.4, 0, 6.3); g.fill(); }
  for (let i = 0; i < (mood === 'storm' ? 40 : mood === 'toxic' ? 22 : 8); i++) { const x = R() * W, y = 6 + R() * H * 0.5, w = 12 + R() * 30; g.fillStyle = mood === 'toxic' ? 'rgba(40,70,10,0.35)' : mood === 'storm' ? 'rgba(90,60,30,0.3)' : mood === 'night' ? 'rgba(10,12,30,0.4)' : 'rgba(40,20,30,0.18)'; g.fillRect(x, y, w, 1 + R() * 2); }
  return canvasTex(c);
}

function shaftTexture() {
  const [c, g] = mkCanvas(16, 64);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 16; x++) { const a = (1 - Math.abs(x - 7.5) / 8) * (1 - y / 64); const q = Math.floor(Math.max(0, a) * 10) / 10; g.fillStyle = `rgba(255,255,255,${q})`; g.fillRect(x, y, 1, 1); }
  return canvasTex(c);
}

export function setupAtmosphere(scene, mood = 'dusk') {
  const M = MOODS[mood] || MOODS.dusk; mood = MOODS[mood] ? mood : 'dusk';
  const R = rng(1234);
  const hemi = new THREE.HemisphereLight(new THREE.Color(M.hemiS), new THREE.Color(M.hemiG), M.hemiI); scene.add(hemi);
  const sun = new THREE.DirectionalLight(new THREE.Color(M.sunC), M.sunI);
  const dir = new THREE.Vector3(...M.dir).normalize(); sun.position.copy(dir).multiplyScalar(40); sun.target.position.set(0, 0, 0);
  sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024); const sc = sun.shadow.camera; sc.left = -22; sc.right = 22; sc.top = 22; sc.bottom = -22; sc.near = 1; sc.far = 100;
  sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.03; scene.add(sun, sun.target);
  scene.fog = new THREE.FogExp2(new THREE.Color(M.fog), M.dens);
  const sky = skyTexture(M, mood); scene.background = sky;
  getFxLights(scene);
  scene.userData.spriteTint = new THREE.Color(...({ day: [1, 1, 1], dusk: [1, 0.9, 0.82], night: [0.66, 0.74, 0.98], toxic: [0.86, 1, 0.72], storm: [1, 0.9, 0.74] }[mood]));
  // particles
  const [col, N, op] = M.dust; const objs = [];
  const mk = (n, size, colr, speed) => {
    const geo = new THREE.BufferGeometry(); const pos = new Float32Array(n * 3), vel = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { pos[i * 3] = (R() - 0.5) * 40; pos[i * 3 + 1] = R() * 9; pos[i * 3 + 2] = (R() - 0.5) * 40; vel[i * 3] = (R() - 0.3) * speed; vel[i * 3 + 1] = (R() - 0.5) * 0.25 - (mood === 'night' ? 0.1 : 0); vel[i * 3 + 2] = (R() - 0.5) * speed * 0.5; }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({ color: colr, size, sizeAttenuation: false, transparent: true, opacity: op, depthWrite: false, fog: false }));
    pts.frustumCulled = false; pts.renderOrder = 6; scene.add(pts); objs.push({ pts, pos, vel, n, geo }); return pts;
  };
  const wind = mood === 'storm' ? 7 : mood === 'toxic' ? 0.5 : 0.6;
  mk(Math.floor(N * 0.7), 1, col, wind); mk(Math.floor(N * 0.3), 2, mix(col, '#ffffff', 0.15), wind * 1.4);
  if (mood === 'toxic') { const p = mk(40, 3, '#d8ff70', 0.3); p.material.opacity = 0.35; }
  // light shafts
  const shafts = [];
  if (M.shafts) {
    const tex = shaftTexture(); const mat = new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(M.sunC), transparent: true, opacity: M.shafts, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
    for (let i = 0; i < 5; i++) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1.4 + R() * 1.6, 16), mat.clone()); const up = new THREE.Vector3(0, 1, 0); const q = new THREE.Quaternion().setFromUnitVectors(up, dir);
      m.quaternion.copy(q); m.position.set((R() - 0.5) * 24 + dir.x * 6, 6 + R() * 2, (R() - 0.5) * 24 + dir.z * 6); m.rotateY(R() * 3); m.renderOrder = 7; m.userData.ph = R() * 6; m.userData.base = M.shafts * (0.6 + R() * 0.6); scene.add(m); shafts.push(m);
    }
  }
  let t = 0;
  return {
    mood, sun, hemi, sky,
    update(dt) {
      t += dt;
      for (const o of objs) { const p = o.pos, v = o.vel; for (let i = 0; i < o.n; i++) { const k = i * 3; p[k] += v[k] * dt + Math.sin(t * 0.7 + i) * 0.003; p[k + 1] += v[k + 1] * dt; p[k + 2] += v[k + 2] * dt; if (p[k] > 20) p[k] -= 40; else if (p[k] < -20) p[k] += 40; if (p[k + 2] > 20) p[k + 2] -= 40; else if (p[k + 2] < -20) p[k + 2] += 40; if (p[k + 1] > 9) p[k + 1] = 0; else if (p[k + 1] < 0) p[k + 1] = 9; } o.geo.attributes.position.needsUpdate = true; }
      for (const s of shafts) s.material.opacity = s.userData.base * (0.65 + 0.35 * Math.sin(t * 0.4 + s.userData.ph));
    },
    dispose() { scene.remove(hemi, sun, sun.target); for (const o of objs) { scene.remove(o.pts); o.geo.dispose(); o.pts.material.dispose(); } for (const s of shafts) { scene.remove(s); s.geometry.dispose(); s.material.dispose(); } sky.dispose(); if (scene.background === sky) scene.background = null; },
  };
}
export { MOODS };
