// Visual effects: pixel particles, flashes, explosions, tracers, floating damage text.
import { THREE } from '../core/engine.js';
import { mkCanvas, canvasTex, rng, parseHex, Pix, clamp } from './util.js';
import { textCanvas } from './font.js';
import { getFxLights } from './atmosphere.js';
import { flameSprite, glowSprite, glowTexture } from './builder.js';

const live = [];
let _tex = null;
function T() {
  if (_tex) return _tex;
  const mk = (w, h, fn) => { const [c, g] = mkCanvas(w, h); fn(g, new Pix(g)); return canvasTex(c); };
  _tex = {
    puff: mk(16, 16, (g) => { for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { const d = Math.hypot(x - 7.5, y - 7.5) / 8; if (d < 1) { const n = Math.sin(x * 2.1 + y * 1.3) * 0.12; const v = d + n; g.fillStyle = v < 0.45 ? '#fff' : v < 0.75 ? '#c8c8c8' : '#888'; g.fillRect(x, y, 1, 1); } } }),
    star: mk(16, 16, (g, p) => { p.r(7, 0, 2, 16, '#fff6c0'); p.r(0, 7, 16, 2, '#fff6c0'); p.line(2, 2, 13, 13, '#ffd060', 1); p.line(13, 2, 2, 13, '#ffd060', 1); p.ell(8, 8, 4, 4, '#ffe890'); p.ell(8, 8, 2, 2, '#ffffff'); }),
    plus: mk(7, 7, (g, p) => { p.r(2, 0, 3, 7, '#fff'); p.r(0, 2, 7, 3, '#fff'); p.r(3, 1, 1, 5, '#b8ffb8'); p.r(1, 3, 5, 1, '#b8ffb8'); }),
    ring: mk(32, 32, (g) => { for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) { const d = Math.hypot(x - 15.5, y - 15.5) / 16; if (d < 1 && d > 0.72) { g.fillStyle = d > 0.88 ? '#fff' : '#cfe'; g.fillRect(x, y, 1, 1); } } }),
  };
  return _tex;
}
const V = (v) => (v && v.isVector3 ? v.clone() : new THREE.Vector3(v?.x || 0, v?.y || 0, v?.z || 0));
const col = (c) => new THREE.Color(c);

function takeLight(scene, color, intensity) {
  const ls = getFxLights(scene); const l = ls.find(x => x.userData.free); if (!l) return null;
  l.userData.free = false; l.color.set(color); l.intensity = intensity; return l;
}
function spriteFx(scene, tex, pos, size, color, { additive = true, opacity = 1 } = {}) {
  const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color, transparent: true, opacity, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, fog: false }));
  m.position.copy(pos); m.scale.set(size, size, 1); m.renderOrder = 8; scene.add(m); return m;
}
function pointsFx(scene, pos, n, colors, { speed = 3, up = 1.5, spread = 1, size = 2, life = 0.6, grav = 8, additive = false, drag = 0 } = {}) {
  const geo = new THREE.BufferGeometry(); const p = new Float32Array(n * 3), v = new Float32Array(n * 3), c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    p[i * 3] = pos.x; p[i * 3 + 1] = pos.y; p[i * 3 + 2] = pos.z;
    const a = Math.random() * 6.283, s = speed * (0.3 + Math.random() * 0.7) * spread; v[i * 3] = Math.cos(a) * s; v[i * 3 + 1] = up * (0.4 + Math.random()) * (speed / 3 + 0.5); v[i * 3 + 2] = Math.sin(a) * s;
    const cc = col(colors[(Math.random() * colors.length) | 0]); c[i * 3] = cc.r; c[i * 3 + 1] = cc.g; c[i * 3 + 2] = cc.b;
  }
  geo.setAttribute('position', new THREE.BufferAttribute(p, 3)); geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
  const mat = new THREE.PointsMaterial({ size, sizeAttenuation: false, vertexColors: true, transparent: true, depthWrite: false, fog: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending });
  const pts = new THREE.Points(geo, mat); pts.frustumCulled = false; pts.renderOrder = 8; scene.add(pts);
  let t = 0;
  return { update(dt) { t += dt; for (let i = 0; i < n; i++) { const k = i * 3; v[k + 1] -= grav * dt; if (drag) { v[k] *= 1 - drag * dt; v[k + 2] *= 1 - drag * dt; } p[k] += v[k] * dt; p[k + 1] += v[k + 1] * dt; p[k + 2] += v[k + 2] * dt; if (p[k + 1] < 0.02) { p[k + 1] = 0.02; v[k + 1] *= -0.25; v[k] *= 0.6; v[k + 2] *= 0.6; } } geo.attributes.position.needsUpdate = true; mat.opacity = clamp(1 - (t / life - 0.6) / 0.4, 0, 1); return t < life; }, dispose() { scene.remove(pts); geo.dispose(); mat.dispose(); } };
}

const TYPES = {
  muzzle(scene, pos, o) {
    const dir = o.dir ? V(o.dir).normalize() : new THREE.Vector3(1, 0, 0);
    const s = spriteFx(scene, T().star, pos.clone().addScaledVector(dir, 0.18), 0.85, 0xffffff); const light = takeLight(scene, 0xffc060, 22);
    const sp = pointsFx(scene, pos, 7, ['#ffe27a', '#fff6c8', '#ff9a30'], { speed: 3.5, up: 0.4, size: 2, life: 0.22, grav: 4, additive: true }); let t = 0;
    return { update(dt) { t += dt; s.material.opacity = 1 - t / 0.09; s.scale.setScalar(0.85 * (1 + t * 3)); if (light) { light.position.copy(pos).add(new THREE.Vector3(0, 0.2, 0)); light.intensity = Math.max(0, 22 * (1 - t / 0.1)); } sp.update(dt); return t < 0.22; }, dispose() { scene.remove(s); s.material.dispose(); sp.dispose(); if (light) { light.intensity = 0; light.userData.free = true; } } };
  },
  blood(scene, pos, o) {
    const n = o.amount || 16; const sp = pointsFx(scene, pos, n, ['#c43d2f', '#8a1d17', '#e0604a', '#6a1410'], { speed: 2.4, up: 2.2, size: 2, life: 0.7, grav: 9 });
    return { update: (dt) => sp.update(dt), dispose: () => sp.dispose() };
  },
  spark(scene, pos, o) {
    const sp = pointsFx(scene, pos, 14, ['#fff6c0', '#ffd060', '#ff9a30'], { speed: 4, up: 2, size: 2, life: 0.4, grav: 7, additive: true });
    return { update: (dt) => sp.update(dt), dispose: () => sp.dispose() };
  },
  explosion(scene, pos, o) {
    const r = o.radius || 1.5; const group = new THREE.Group(); group.position.copy(pos); scene.add(group);
    const flash = spriteFx(scene, glowTexture(), pos.clone().add(new THREE.Vector3(0, 0.5, 0)), 3.2 * r, 0xffe0a0);
    const puffs = []; for (let i = 0; i < 9; i++) { const s = spriteFx(scene, T().puff, pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * r, 0.3 + Math.random() * 0.5, (Math.random() - 0.5) * r)), 0.6, 0xff8a20); s.userData.v = new THREE.Vector3((Math.random() - 0.5) * 2 * r, 1 + Math.random() * 2, (Math.random() - 0.5) * 2 * r); puffs.push(s); }
    const smoke = []; for (let i = 0; i < 6; i++) { const s = spriteFx(scene, T().puff, pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * r, 0.5, (Math.random() - 0.5) * r)), 0.5, 0x3a3430, { additive: false, opacity: 0 }); s.userData.d = Math.random() * 0.25; smoke.push(s); }
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 24), new THREE.MeshBasicMaterial({ color: 0xffd080, transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending })); ring.rotation.x = -Math.PI / 2; ring.position.copy(pos).setY(0.08); scene.add(ring);
    const deb = pointsFx(scene, pos.clone().setY(0.4), 26, ['#3a2a20', '#7a4a2a', '#ff9a30', '#8a8478'], { speed: 4.5 * r, up: 3.2, size: 2, life: 0.9, grav: 11 });
    const light = takeLight(scene, 0xff9a40, 60); let t = 0;
    return {
      update(dt) {
        t += dt; flash.material.opacity = clamp(1 - t / 0.18, 0, 1); flash.scale.setScalar(3.2 * r * (1 + t * 1.5));
        for (const s of puffs) { s.position.addScaledVector(s.userData.v, dt); s.userData.v.multiplyScalar(1 - dt * 2.5); const k = t / 0.7; s.scale.setScalar(0.7 + r * 1.6 * Math.sqrt(k)); s.material.opacity = clamp(1 - k, 0, 1); s.material.color.setRGB(1, clamp(0.55 - k * 0.5, 0.05, 1), clamp(0.15 - k * 0.15, 0, 1)); }
        for (const s of smoke) { const k = (t - s.userData.d) / 1.0; if (k > 0) { s.position.y += dt * 1.2; s.scale.setScalar(0.6 + r * 1.2 * k); s.material.opacity = clamp(0.7 * (1 - k) * Math.min(1, k * 6), 0, 0.7); } }
        ring.scale.setScalar(0.3 + t * 5 * r); ring.material.opacity = clamp(1 - t / 0.35, 0, 1);
        if (light) { light.position.copy(pos).setY(1); light.intensity = Math.max(0, 60 * (1 - t / 0.6)); light.distance = 9 + r * 3; }
        deb.update(dt); return t < 1.35;
      },
      dispose() { scene.remove(group, flash, ring, ...puffs, ...smoke); flash.material.dispose(); ring.geometry.dispose(); ring.material.dispose(); for (const s of [...puffs, ...smoke]) s.material.dispose(); deb.dispose(); if (light) { light.intensity = 0; light.userData.free = true; light.distance = 9; } },
    };
  },
  heal(scene, pos, o) {
    const items = []; for (let i = 0; i < 8; i++) { const s = spriteFx(scene, T().plus, pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.7, 0.2 + Math.random() * 0.8, (Math.random() - 0.5) * 0.7)), 0.28, 0x6aff7a, { opacity: 0 }); s.userData.d = i * 0.07; s.userData.x = s.position.x; items.push(s); }
    const sp = pointsFx(scene, pos.clone().setY(0.2), 16, ['#b8ffb8', '#6aff7a', '#ffffff'], { speed: 0.8, up: 1.2, size: 2, life: 1.0, grav: -0.5, additive: true });
    const light = takeLight(scene, 0x60ff80, 9); let t = 0;
    return { update(dt) { t += dt; for (const s of items) { const k = t - s.userData.d; if (k > 0) { s.position.y += dt * 0.9; s.position.x = s.userData.x + Math.sin(k * 8) * 0.06; s.material.opacity = clamp(Math.sin(Math.min(1, k / 0.9) * 3.14), 0, 1); } } if (light) { light.position.copy(pos).setY(1); light.intensity = Math.max(0, 9 * (1 - t / 1.0)); } sp.update(dt); return t < 1.1; }, dispose() { scene.remove(...items); items.forEach(s => s.material.dispose()); sp.dispose(); if (light) { light.intensity = 0; light.userData.free = true; } } };
  },
  dust(scene, pos, o) {
    const puffs = []; for (let i = 0; i < 6; i++) { const s = spriteFx(scene, T().puff, pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.5, 0.1, (Math.random() - 0.5) * 0.5)), 0.3, o.color || 0xb09068, { additive: false, opacity: 0.55 }); s.userData.v = new THREE.Vector3((Math.random() - 0.5) * 0.8, 0.4 + Math.random() * 0.4, (Math.random() - 0.5) * 0.8); puffs.push(s); } let t = 0;
    return { update(dt) { t += dt; for (const s of puffs) { s.position.addScaledVector(s.userData.v, dt); s.scale.setScalar(0.3 + t * 1.1); s.material.opacity = clamp(0.55 * (1 - t / 0.8), 0, 1); } return t < 0.8; }, dispose() { scene.remove(...puffs); puffs.forEach(s => s.material.dispose()); } };
  },
  smoke(scene, pos, o) {
    const dur = o.duration || 3, puffs = []; const c = o.color || 0x8a8a8a; let t = 0, acc = 0;
    return { update(dt) { t += dt; acc += dt; if (acc > 0.18 && t < dur - 1.2) { acc = 0; const s = spriteFx(scene, T().puff, pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.3, 0.2, (Math.random() - 0.5) * 0.3)), 0.4, c, { additive: false, opacity: 0.6 }); s.userData.a = 0; puffs.push(s); } for (let i = puffs.length - 1; i >= 0; i--) { const s = puffs[i]; s.userData.a += dt; const k = s.userData.a / 1.4; s.position.y += dt * 0.9; s.position.x += dt * 0.15; s.scale.setScalar(0.4 + k * 1.3); s.material.opacity = clamp(0.6 * (1 - k), 0, 0.6); if (k >= 1) { scene.remove(s); s.material.dispose(); puffs.splice(i, 1); } } return t < dur; }, dispose() { puffs.forEach(s => { scene.remove(s); s.material.dispose(); }); } };
  },
  fire(scene, pos, o) {
    const dur = o.duration || 3; const g = new THREE.Group(); g.position.copy(pos); scene.add(g);
    const fl = [flameSprite(0, 0, 0, 0.7), flameSprite(0.2, 0, 0.1, 0.5), flameSprite(-0.2, 0, -0.1, 0.55), flameSprite(0.05, 0, -0.25, 0.45)]; fl.forEach(f => g.add(f));
    const gl = glowSprite(0xff8a30, 2.8, 0, 0.4, 0, { pulse: 9, opacity: 0.5 }); g.add(gl); const light = takeLight(scene, 0xff8a30, 14);
    const em = pointsFx(scene, pos.clone().setY(0.3), 10, ['#ff9a30', '#ffd060'], { speed: 0.3, up: 1.5, size: 2, life: dur, grav: -0.5, additive: true }); let t = 0;
    return { update(dt) { t += dt; const k = t > dur - 0.6 ? clamp((dur - t) / 0.6, 0, 1) : 1; g.scale.setScalar(k); if (light) { light.position.copy(pos).setY(0.8); light.intensity = 14 * k * (0.8 + Math.random() * 0.4); } return t < dur; }, dispose() { scene.remove(g); em.dispose(); if (light) { light.intensity = 0; light.userData.free = true; } } };
  },
  buff(scene, pos, o) {
    const c = col(o.color || '#46f2c8'); const ring = new THREE.Mesh(new THREE.RingGeometry(0.4, 0.5, 20), new THREE.MeshBasicMaterial({ color: c, transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending })); ring.rotation.x = -Math.PI / 2; ring.position.copy(pos).setY(0.05); scene.add(ring);
    const sp = pointsFx(scene, pos.clone().setY(0.1), 14, [c.getStyle(), '#ffffff'], { speed: 0.5, up: 1.4, size: 2, life: 0.9, grav: -1, additive: true }); let t = 0;
    return { update(dt) { t += dt; ring.position.y = 0.05 + t * 1.6; ring.scale.setScalar(1 + t * 0.3); ring.material.opacity = clamp(1 - t / 0.9, 0, 1); sp.update(dt); return t < 0.95; }, dispose() { scene.remove(ring); ring.geometry.dispose(); ring.material.dispose(); sp.dispose(); } };
  },
};

export function spawnEffect(scene, type, pos, opts = {}) {
  const fn = TYPES[type]; if (!fn) return null;
  const fx = fn(scene, V(pos), opts); fx.scene = scene; live.push(fx); return fx;
}
export function spawnTracer(scene, from, to, color = '#ffe27a') {
  const a = V(from), b = V(to), len = a.distanceTo(b); if (len < 0.01) return null;
  const mat = new THREE.MeshBasicMaterial({ color: col(color), transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending });
  const m = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 1), mat); m.renderOrder = 8; scene.add(m);
  const dir = b.clone().sub(a).normalize(); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir); let t = 0; const dur = Math.max(0.1, Math.min(0.22, len / 60));
  const fx = { scene, update(dt) { t += dt; const k = clamp(t / dur, 0, 1), head = k, tail = Math.max(0, k - 0.35); const L = (head - tail) * len; m.scale.z = Math.max(0.01, L); m.position.copy(a).addScaledVector(dir, (head + tail) / 2 * len); mat.opacity = k > 0.9 ? clamp(1 - (t - dur * 0.9) / 0.08, 0, 1) : 1; return t < dur + 0.08; }, dispose() { scene.remove(m); m.geometry.dispose(); mat.dispose(); } };
  live.push(fx); return fx;
}
export function floatText(scene, text, pos, color = '#fff') {
  const c = textCanvas(String(text), { scale: 2, color, outline: '#120c08', shadow: false, pad: 1 }); const tex = canvasTex(c);
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, fog: false });
  const us = String(text).length > 5 ? 0.019 : 0.028;   // words are drawn smaller than damage numbers
  const s = new THREE.Sprite(mat); const w = c.width * us, h = c.height * us; s.scale.set(w, h, 1); const p0 = V(pos); p0.y += 0.2; s.position.copy(p0); s.renderOrder = 20; scene.add(s); let t = 0; const dur = 1.1;
  const fx = { scene, update(dt) { t += dt; const k = t / dur; const e = 1 - (1 - Math.min(1, k * 1.4)) ** 3; s.position.y = p0.y + e * 1.1; const pop = t < 0.12 ? 0.6 + (t / 0.12) * 0.6 : t < 0.2 ? 1.2 - (t - 0.12) / 0.08 * 0.2 : 1; s.scale.set(w * pop, h * pop, 1); mat.opacity = k > 0.65 ? clamp(1 - (k - 0.65) / 0.35, 0, 1) : 1; return t < dur; }, dispose() { scene.remove(s); tex.dispose(); mat.dispose(); } };
  live.push(fx); return fx;
}
export function updateEffects(dt) {
  for (let i = live.length - 1; i >= 0; i--) { const f = live[i]; let ok = true; try { ok = f.update(dt); } catch (e) { console.error(e); ok = false; } if (!ok) { try { f.dispose(); } catch (e) { } live.splice(i, 1); } }
}
export function clearEffects() { for (const f of live) { try { f.dispose(); } catch (e) { } } live.length = 0; }
