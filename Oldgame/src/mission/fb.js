// Fallback GFX (used only for functions the GFX module does not export yet).
import { THREE } from '../core/engine.js';
const cache = {};
const COL = { sand: '#b89a62', asphalt: '#3c3b3a', asphalt_cracked: '#46433f', rubble: '#6a5f52', concrete: '#7b7a74', dirt: '#6b5030', toxic: '#58c02a', grass_dead: '#7a7a40', metal: '#555c62', tiles: '#6a7378' };
function noiseTex(col) {
  const c = document.createElement('canvas'); c.width = c.height = 16; const g = c.getContext('2d'); g.fillStyle = col; g.fillRect(0, 0, 16, 16);
  let s = 7; for (let i = 0; i < 60; i++) { s = (s * 1103515245 + 12345) & 0x7fffffff; g.fillStyle = s % 2 ? 'rgba(0,0,0,.14)' : 'rgba(255,255,255,.08)'; g.fillRect(s % 16, (s >> 4) % 16, 1 + (s >> 8) % 2, 1); }
  g.strokeStyle = 'rgba(0,0,0,.25)'; g.strokeRect(0.5, 0.5, 15, 15);
  const t = new THREE.CanvasTexture(c); t.magFilter = THREE.NearestFilter; t.colorSpace = THREE.SRGBColorSpace; return t;
}
export const fb = {
  tileMaterial(type) { return cache['t' + type] || (cache['t' + type] = new THREE.MeshLambertMaterial({ map: noiseTex(COL[type] || '#888') })); },
  createProp(type, o = {}) {
    const sz = { wall: [1, 2, .3], wall_broken: [1, .9, .3], pillar: [.5, 2, .5], car: [.9, .8, .5], bus: [.9, 1.3, .6], barrel: [.5, .8, .5], barrel_toxic: [.5, .8, .5], crate: [.7, .6, .7], debris: [.9, .4, .9], sandbags: [.9, .5, .4], container: [1, 1.4, .6], fence: [1, .9, .08], generator: [.8, 1, .6], terminal: [.5, .9, .4], tent: [.9, 1.1, .9], tank_trap: [.7, .5, .7], scrap_pile: [.8, .5, .8], lamp: [.1, 2.2, .1], sign: [.1, 1.6, .5], antenna: [.1, 2.8, .1], tree_dead: [.2, 2, .2], skeleton: [.5, .1, .3], campfire: [.4, .3, .4], door: [.8, 1.6, .15] }[type] || [.8, .8, .8];
    const colr = { wall: 0x7b756a, wall_broken: 0x6f695e, car: 0x8a4a2a, bus: 0x9a8030, barrel: 0x7a3a2a, barrel_toxic: 0x5aa02a, crate: 0x8a6a3a, container: 0x3a5a7a, generator: 0x777a30, sandbags: 0xa89868, tent: 0x7a6a50, campfire: 0xff8030, terminal: 0x2a6a4a, lamp: 0x555555, skeleton: 0xddddcc }[type] || 0x6a6a60;
    const m = new THREE.Mesh(new THREE.BoxGeometry(sz[0], sz[1], sz[2]), new THREE.MeshLambertMaterial({ color: colr })); m.position.y = sz[1] / 2; m.castShadow = m.receiveShadow = true;
    const o3 = new THREE.Object3D(); o3.add(m); return o3;
  },
  createBuilding({ w = 3, d = 3, h = 1 } = {}) { const m = new THREE.Mesh(new THREE.BoxGeometry(w - .1, h * 2.5, d - .1), new THREE.MeshLambertMaterial({ color: 0x5a5650 })); m.position.y = h * 1.25; m.castShadow = m.receiveShadow = true; const o = new THREE.Object3D(); o.add(m); return o; },
  setupAtmosphere(scene, mood) {
    scene.add(new THREE.AmbientLight(0xffe6c0, 0.9)); const l = new THREE.DirectionalLight(0xffd8a0, 1.6); l.position.set(-10, 20, 8); l.castShadow = true; l.shadow.mapSize.set(1024, 1024); const s = l.shadow.camera; s.left = -20; s.right = 20; s.top = 20; s.bottom = -20; s.far = 80; scene.add(l);
    scene.background = new THREE.Color(mood === 'night' ? 0x0a0c18 : 0x3a3020); return { update() {} };
  },
  floatText(scene, text, pos, color = '#fff') {
    const c = document.createElement('canvas'); c.width = 128; c.height = 32; const g = c.getContext('2d'); g.font = 'bold 22px monospace'; g.textAlign = 'center'; g.lineWidth = 4; g.strokeStyle = '#000'; g.strokeText(text, 64, 24); g.fillStyle = color; g.fillText(text, 64, 24);
    const t = new THREE.CanvasTexture(c); t.magFilter = THREE.NearestFilter; const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true })); sp.scale.set(2, .5, 1); sp.position.copy(pos); sp.renderOrder = 30; scene.add(sp);
    LIVE.push({ o: sp, life: 1.2, vy: 0.9 });
  },
  spawnTracer(scene, a, b, color = 0xffe090) { const g = new THREE.BufferGeometry().setFromPoints([a, b]); const l = new THREE.Line(g, new THREE.LineBasicMaterial({ color })); scene.add(l); LIVE.push({ o: l, life: .12, vy: 0 }); },
  spawnEffect(scene, type, pos) { const col = { muzzle: 0xffee88, blood: 0xaa1111, spark: 0xffcc44, explosion: 0xff7a22, heal: 0x66ff88, dust: 0xaa9977, smoke: 0x666666, fire: 0xff5511, buff: 0x88aaff }[type] || 0xffffff; const m = new THREE.Mesh(new THREE.SphereGeometry(type === 'explosion' ? 1.2 : .25, 8, 6), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: .8 })); m.position.copy(pos); scene.add(m); LIVE.push({ o: m, life: .35, vy: 0, grow: 1.5 }); },
  updateEffects(dt) { for (let i = LIVE.length - 1; i >= 0; i--) { const e = LIVE[i]; e.life -= dt; e.o.position.y += e.vy * dt; if (e.grow) e.o.scale.multiplyScalar(1 + e.grow * dt); if (e.life <= 0) { e.o.parent?.remove(e.o); e.o.geometry?.dispose?.(); LIVE.splice(i, 1); } } },
  portraitCanvas(d, s = 64) { const c = document.createElement('canvas'); c.width = c.height = s; const g = c.getContext('2d'); g.fillStyle = d?.isEnemy || d?.templateId ? '#6a3030' : '#304a6a'; g.fillRect(0, 0, s, s); g.fillStyle = '#d8b890'; g.fillRect(s * .3, s * .2, s * .4, s * .45); return c; },
  itemIcon(i, s = 32) { const c = document.createElement('canvas'); c.width = c.height = s; c.getContext('2d').fillStyle = '#775'; c.getContext('2d').fillRect(4, 4, s - 8, s - 8); return c; },
  abilityIcon(i, s = 24) { const c = document.createElement('canvas'); c.width = c.height = s; const g = c.getContext('2d'); g.fillStyle = '#557'; g.fillRect(2, 2, s - 4, s - 4); return c; },
  showD20Roll(r) { return new Promise(res => { const d = document.createElement('div'); d.style.cssText = 'position:absolute;left:50%;top:40%;transform:translate(-50%,-50%);font-size:2em;color:#fff;background:#000c;padding:.4em .8em;border:3px solid #c08a3e;z-index:90;pointer-events:none'; d.textContent = `${r.label || ''}: ${r.d20}${r.mod >= 0 ? '+' : ''}${r.mod} = ${r.total} vs ${r.dc}`; document.getElementById('ui')?.append(d); setTimeout(() => { d.remove(); res(); }, 700); }); },
};
const LIVE = [];
