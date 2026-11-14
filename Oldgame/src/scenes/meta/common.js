// Shared helpers for META scenes.
import { THREE } from '../../core/engine.js';
import { UI } from '../../core/ui.js';
import { Audio } from '../../audio/audio.js';
import * as R from '../../rules/index.js';
import * as GFX from '../../gfx/index.js';

export { THREE, UI, Audio, R, GFX };

export function rngSeed(seed) {
  let a = seed >>> 0;
  return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
export const pick = (arr, rng = Math.random) => arr[Math.floor(rng() * arr.length)];
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ---- names (guarded) ----
export const className = (id) => R.CLASSES?.[id]?.name ?? id;
export const ancName = (id) => R.ANCESTRIES?.[id]?.name ?? id;
export const itemName = (id) => R.ITEMS?.[id]?.name ?? id;
export const skillName = (id) => R.SKILLS?.[id]?.name ?? id;
export const profName = (rank) => (R.PROF_NAMES || ['Nieszkolony', 'Wyszkolony', 'Ekspert', 'Mistrz', 'Legenda'])[rank] ?? '';
export const ATTR_LIST = R.ATTRS || ['str', 'dex', 'con', 'int', 'wis', 'cha'];
export const attrName = (a) => (R.ATTR_NAMES || { str: 'Siła', dex: 'Zręczność', con: 'Kondycja', int: 'Inteligencja', wis: 'Mądrość', cha: 'Charyzma' })[a] ?? a;
export const signed = (n) => (n >= 0 ? '+' : '') + n;
export const stat = (ch, key) => { try { return R.getStat(ch, key); } catch { return 0; } };
export const partyLevel = (state) => {
  const p = state.party || []; if (!p.length) return 1;
  return Math.max(1, Math.round(p.reduce((s, c) => s + (c.level || 1), 0) / p.length));
};
export const iconOf = (id, size = 32) => { try { return GFX.itemIcon(id, size); } catch { const c = document.createElement('canvas'); c.width = c.height = size; return c; } };
export const portrait = (ch, size = 64) => { try { return GFX.portraitCanvas(ch, size); } catch { const c = document.createElement('canvas'); c.width = c.height = size; return c; } };

// ---- THREE helpers ----
export function disposeObj(root) {
  root?.traverse?.(o => {
    o.geometry?.dispose?.();
    const ms = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of ms) { for (const k of Object.keys(m)) if (m[k]?.isTexture) m[k].dispose(); m.dispose?.(); }
  });
}
export function gradientTexture(stops, h = 128) {
  const c = document.createElement('canvas'); c.width = 4; c.height = h; const g = c.getContext('2d');
  const gr = g.createLinearGradient(0, 0, 0, h); stops.forEach(([p, col]) => gr.addColorStop(p, col));
  g.fillStyle = gr; g.fillRect(0, 0, 4, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
export function pixelTexture(w, h, fn) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); fn(g, w, h);
  const t = new THREE.CanvasTexture(c); t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.colorSpace = THREE.SRGBColorSpace; return t;
}
let _winTex = null;
export function windowTexture() {
  if (_winTex) return _winTex;
  const rng = rngSeed(77);
  _winTex = pixelTexture(16, 32, (g, w, h) => {
    g.fillStyle = '#23201c'; g.fillRect(0, 0, w, h);
    for (let y = 1; y < h - 1; y += 3) for (let x = 1; x < w - 1; x += 3) {
      const r = rng(); g.fillStyle = r < 0.07 ? '#ffb84a' : r < 0.1 ? '#8fd14f' : r < 0.5 ? '#14110f' : '#2e2a24'; g.fillRect(x, y, 2, 2);
    }
  });
  _winTex.wrapS = _winTex.wrapT = THREE.RepeatWrapping; return _winTex;
}
/** Row of box "buildings" forming a skyline; returns Group. */
export function skyline(rng, { n = 30, x0 = -40, x1 = 40, z = -30, hMin = 4, hMax = 18, wMin = 2, wMax = 5, color = 0x1a1512, lit = true, ruin = true } = {}) {
  const g = new THREE.Group(); const tex = lit ? windowTexture() : null;
  for (let i = 0; i < n; i++) {
    const w = wMin + rng() * (wMax - wMin), h = hMin + rng() * (hMax - hMin), d = w * (0.7 + rng() * 0.6);
    const m = new THREE.MeshLambertMaterial({ color, map: tex ? tex.clone() : null });
    if (m.map) { m.map.needsUpdate = true; m.map.repeat.set(Math.ceil(w / 2), Math.ceil(h / 4)); m.map.wrapS = m.map.wrapT = THREE.RepeatWrapping; }
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    b.position.set(x0 + (x1 - x0) * (i + rng() * 0.6) / n, h / 2, z + (rng() - 0.5) * 8);
    if (ruin && rng() < 0.6) { b.rotation.z = (rng() - 0.5) * 0.08; }
    g.add(b);
    if (ruin && rng() < 0.5) { // broken top chunk
      const c = new THREE.Mesh(new THREE.BoxGeometry(w * 0.5, 1 + rng() * 2, d * 0.6), m);
      c.position.set(b.position.x + (rng() - 0.5) * w * 0.4, h + 0.4, b.position.z); c.rotation.z = (rng() - 0.5) * 0.5; g.add(c);
    }
  }
  return g;
}
/** Dune/wasteland ground. */
export function dunes(w, d, { seg = 60, amp = 1.2, scale = 0.15, base = [0.72, 0.55, 0.34], seed = 3, flatNear = 0 } = {}) {
  const geo = new THREE.PlaneGeometry(w, d, seg, seg); geo.rotateX(-Math.PI / 2);
  const p = geo.attributes.position, col = new Float32Array(p.count * 3), rng = rngSeed(seed), ph = [rng() * 6, rng() * 6, rng() * 6];
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i);
    let h = Math.sin(x * scale + ph[0]) * Math.cos(z * scale * 0.8 + ph[1]) + 0.5 * Math.sin(x * scale * 2.3 + z * scale * 1.7 + ph[2]);
    h *= amp; if (flatNear) h *= clamp(Math.abs(z + flatNear) / 6, 0.15, 1);
    p.setY(i, h); const l = 0.8 + 0.35 * (h / (amp || 1)) + (rng() - 0.5) * 0.06;
    col[i * 3] = base[0] * l; col[i * 3 + 1] = base[1] * l; col[i * 3 + 2] = base[2] * l;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3)); geo.computeVertexNormals();
  return new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
}
/** Point-cloud particles drifting in a box. */
export function particles(count, { box = [30, 10, 30], center = [0, 5, 0], color = 0xd9b070, size = 2, vel = [0.5, 0, 0], seed = 1, opacity = 0.8 } = {}) {
  const rng = rngSeed(seed), pos = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) { pos[i * 3] = (rng() - 0.5) * box[0]; pos[i * 3 + 1] = rng() * box[1]; pos[i * 3 + 2] = (rng() - 0.5) * box[2]; }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const pts = new THREE.Points(geo, new THREE.PointsMaterial({ color, size, sizeAttenuation: false, transparent: true, opacity, depthWrite: false }));
  pts.position.set(...center); pts.frustumCulled = false;
  pts.userData.update = (dt) => {
    const a = geo.attributes.position.array;
    for (let i = 0; i < count; i++) {
      a[i * 3] += vel[0] * dt; a[i * 3 + 1] += vel[1] * dt; a[i * 3 + 2] += vel[2] * dt;
      if (a[i * 3] > box[0] / 2) a[i * 3] -= box[0]; if (a[i * 3] < -box[0] / 2) a[i * 3] += box[0];
      if (a[i * 3 + 1] > box[1]) a[i * 3 + 1] -= box[1]; if (a[i * 3 + 1] < 0) a[i * 3 + 1] += box[1];
      if (a[i * 3 + 2] > box[2] / 2) a[i * 3 + 2] -= box[2]; if (a[i * 3 + 2] < -box[2] / 2) a[i * 3 + 2] += box[2];
    }
    geo.attributes.position.needsUpdate = true;
  };
  return pts;
}
/** Flickering fire: emissive flame boxes + point light. */
export function makeFire(scale = 1) {
  const g = new THREE.Group(), flames = [];
  const cols = [0xff5a1a, 0xff9a2a, 0xffd34a];
  for (let i = 0; i < 6; i++) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.16 * scale, 0.3 * scale, 0.16 * scale), new THREE.MeshBasicMaterial({ color: cols[i % 3] }));
    m.userData = { ph: Math.random() * 6, r: Math.random() * 0.18 * scale }; g.add(m); flames.push(m);
  }
  const light = new THREE.PointLight(0xff8a30, 2.2, 14 * scale, 1.6); light.position.y = 0.6 * scale; g.add(light);
  g.userData.update = (t) => {
    flames.forEach((f, i) => {
      const k = Math.sin(t * 9 + f.userData.ph);
      f.position.set(Math.cos(f.userData.ph + i) * f.userData.r, (0.15 + 0.15 * (i % 3) + 0.08 * k) * scale, Math.sin(f.userData.ph + i) * f.userData.r);
      f.scale.y = 1 + 0.6 * k;
    });
    light.intensity = 2 + Math.sin(t * 13) * 0.35 + Math.sin(t * 7.3) * 0.3;
  };
  return g;
}
/** Safe sprite creation with fallback box. */
export function sprite(desc, scale = 1) {
  let s = null;
  try { s = GFX.createActorSprite(desc); } catch (e) { console.warn('sprite', e); }
  if (!s) {
    const o = new THREE.Object3D(); const m = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.5, 0.4), new THREE.MeshLambertMaterial({ color: 0x555555 })); m.position.y = 0.75; o.add(m);
    s = { object3d: o, play() { }, setFacing() { }, update() { }, setHighlight() { }, setSelected() { }, dispose() { } };
  }
  s.object3d.scale.setScalar(scale); return s;
}
export function atmosphere(scene, mood = 'dusk') {
  let a = null;
  try { a = GFX.setupAtmosphere(scene, mood); } catch (e) { a = null; }
  if (a && typeof a === 'object') return a;
  const M = { dusk: ['#2a1a30', '#a0502e', '#f0a060', 0xc08060], night: ['#05060c', '#10162a', '#1c2236', 0x1a2040], day: ['#5a8ab0', '#a8c8d8', '#e8dcb8', 0xd8c8a0] }[mood] || ['#2a1a30', '#a0502e', '#f0a060', 0xc08060];
  scene.background = gradientTexture([[0, M[0]], [0.6, M[1]], [1, M[2]]]); scene.fog = new THREE.Fog(M[3], 25, 90);
  scene.add(new THREE.AmbientLight(0xffc8a0, mood === 'night' ? 1.2 : 1.8)); const l = new THREE.DirectionalLight(0xffb070, mood === 'night' ? 1 : 2.6); l.position.set(-10, 14, 8); l.castShadow = false; scene.add(l);
  return { update() { } };
}
/** Safe prop/building creation (GFX may be partial). */
const FB = { tent: [2.4, 1.6, 2.4, 0x7a6a4a], lamp: [0.12, 3.6, 0.12, 0x3a3a3a], crate: [0.9, 0.9, 0.9, 0x7a5a30], barrel: [0.6, 0.9, 0.6, 0x5a4a3a], barrel_toxic: [0.6, 0.9, 0.6, 0x4a7a2a], sign: [1.8, 1.4, 0.15, 0x6a4a2a], fence: [3, 1, 0.1, 0x555048], sandbags: [1.6, 0.6, 0.8, 0x8a7a55], generator: [1.4, 1.2, 1, 0x4a5a3a], antenna: [0.15, 5, 0.15, 0x666666], container: [3, 2.2, 1.4, 0x7a3a2a], campfire: [0.8, 0.2, 0.8, 0x3a2410], car: [3.4, 1.2, 1.6, 0x5a5048], tree_dead: [0.3, 3, 0.3, 0x3a2a1a] };
export function prop(type, opts) {
  try { const o = GFX.createProp(type, opts); if (o) return o; } catch (e) { }
  const d = FB[type] || [0.8, 0.8, 0.8, 0x66584a]; const o = new THREE.Object3D(); o.userData.fb = true;
  const m = new THREE.Mesh(new THREE.BoxGeometry(d[0], d[1], d[2]), new THREE.MeshLambertMaterial({ color: d[3], flatShading: true })); m.position.y = d[1] / 2; o.add(m); return o;
}
export function building(opts) { try { const o = GFX.createBuilding(opts); if (o) return o; } catch (e) { } const o = new THREE.Object3D(); const m = new THREE.Mesh(new THREE.BoxGeometry(opts.w || 3, (opts.h || 1) * 2.5, opts.d || 3), new THREE.MeshLambertMaterial({ color: 0x4a443c })); m.position.y = (opts.h || 1) * 1.25; o.add(m); return o; }
export function groundMat(type, fallback = 0x7a6a50) { try { const m = GFX.tileMaterial(type); if (m) return m; } catch (e) { } return new THREE.MeshLambertMaterial({ color: fallback }); }
// ---- DOM helpers ----
export function fadeLayer(color = '#000') {
  const f = UI.el('div', { style: `position:absolute;inset:0;background:${color};opacity:1;transition:opacity .7s;pointer-events:none;z-index:90` });
  UI.add(f); requestAnimationFrame(() => requestAnimationFrame(() => { f.style.opacity = '0'; }));
  f.to = (o, ms = 700) => { f.style.transition = `opacity ${ms}ms`; f.style.opacity = String(o); }; return f;
}
/** Typewriter driven by update(dt). */
export class Typewriter {
  constructor(el, text, cps = 40) { this.el = el; this.text = text; this.cps = cps; this.i = 0; this.acc = 0; this.done = false; el.textContent = ''; }
  update(dt) {
    if (this.done) return; this.acc += dt * this.cps;
    while (this.acc >= 1 && !this.done) {
      this.acc -= 1; const ch = this.text[this.i++]; this.el.textContent = this.text.slice(0, this.i);
      if (ch && ch !== ' ' && this.i % 2 === 0) Audio.sfx('typewriter', { vol: 0.5 });
      if (this.i >= this.text.length) this.done = true;
    }
  }
  finish() { this.i = this.text.length; this.el.textContent = this.text; this.done = true; }
}
export function bar(frac, color = 'var(--good)', w = '100%', h = '.7em') {
  return UI.el('div', { style: `width:${w};height:${h};background:#000a;border:2px solid #000;box-shadow:0 0 0 1px var(--edge)` },
    UI.el('div', { style: `width:${clamp(frac, 0, 1) * 100}%;height:100%;background:${color}` }));
}
export function addToStash(state, inst) {
  if (!inst) return;
  const ex = state.stash.find(i => i.id === inst.id && R.ITEMS?.[inst.id]?.type === 'consumable' || (i.id === inst.id && R.ITEMS?.[inst.id]?.type === 'ammo'));
  if (ex) ex.qty = (ex.qty || 1) + (inst.qty || 1); else state.stash.push(inst);
}
export function ensureScreen(scene, camera) { scene.add(camera); }

/** HTML tooltip for an item id/def. */
export function itemTip(idOrInst, extra = '') {
  const id = typeof idOrInst === 'string' ? idOrInst : idOrInst?.id; const it = R.ITEMS?.[id]; if (!it) return String(id);
  let l = `<b class="amber">${it.name}</b>${it.level ? ` <span class="dim">poz. ${it.level}</span>` : ''}<br><i>${it.desc || ''}</i>`;
  const w = it.weapon, a = it.armor, c = it.consumable;
  if (w) l += `<br>Obrażenia: <b>${w.damage}</b> (${w.dmgType})${w.range ? ' · zasięg ' + w.range : ' · wręcz'}${w.hands === 2 ? ' · dwuręczna' : ''}`;
  if (a) l += `<br>KP +<b>${a.ac}</b>${a.dexCap != null ? ' · limit Zrę. ' + a.dexCap : ''}${a.speedPenalty ? ' · prędk. -' + a.speedPenalty : ''}`;
  if (it.shield) l += `<br>Tarcza: KP +${it.shield.ac ?? 2}`;
  if (c) l += `<br>Efekt: ${c.effect}${c.amount ? ' ' + c.amount : ''}`;
  return l + extra;
}
export function itemRow(inst, { right, tip, qty } = {}) {
  const id = inst.id ?? inst, it = R.ITEMS?.[id];
  const row = UI.el('div', { style: 'display:flex;align-items:center;gap:.5em;padding:.2em .3em;border-bottom:1px solid #fff1' });
  const ic = UI.pixCanvas(iconOf(id, 32), '2.2em');
  row.append(ic, UI.el('div', { style: 'flex:1;min-width:0' }, UI.el('div', { style: 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis' }, it?.name ?? id, (qty ?? inst.qty) > 1 ? UI.el('span', { class: 'dim' }, ' ×' + (qty ?? inst.qty)) : null)),
    ...(right ? [].concat(right) : []));
  UI.tooltip(row, tip || (() => itemTip(id)));
  return row;
}
