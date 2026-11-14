// Gallery / visual test for all GFX output. Used by gallery.html and by tools/snap.mjs scripts.
import { THREE } from '../core/engine.js';
import * as G from './index.js';

function mkRenderer(W = 480, H = 270, scale = 2.6) {
  const c = document.createElement('canvas');
  const r = new THREE.WebGLRenderer({ canvas: c, antialias: false, preserveDrawingBuffer: true });
  r.setPixelRatio(1); r.setSize(W, H, false); r.outputColorSpace = THREE.SRGBColorSpace; r.shadowMap.enabled = true; r.shadowMap.type = THREE.BasicShadowMap;
  c.style.cssText = `width:${W * scale}px;height:${H * scale}px;image-rendering:pixelated;display:block`;
  return { r, c };
}
function overlay() {
  document.getElementById('wrap') && (document.getElementById('stage').style.display = 'none');
  const d = document.createElement('div'); d.style.cssText = 'position:fixed;inset:0;background:#111;z-index:9999;overflow:auto;color:#ddd;font:12px monospace'; document.body.appendChild(d); return d;
}
const ENEMIES = ['raider_thug', 'raider_shooter', 'raider_psycho', 'raider_chief', 'kostucha', 'mutant_rat', 'wild_dog', 'giant_bug', 'ghoul_mutant', 'rogue_drone', 'sentry_turret', 'rusty_robot', 'wolf', 'scorpion', 'bug_swarm', 'spider', 'boar', 'szabrownik'];
const CLASSES = ['soldier', 'scout', 'medic', 'techie', 'scavenger', 'brute'];

export function buildGallery(opts = {}) {
  const view = opts.view || 'sprites';
  const root = overlay();
  const out = { updates: [] };
  if (view === 'sprites') {
    const { r, c } = mkRenderer(480, 270, 2.6); root.appendChild(c);
    const post = G.createPost(r, 480, 270);
    const scene = new THREE.Scene(); const atm = G.setupAtmosphere ? G.setupAtmosphere(scene, opts.mood || 'dusk') : null;
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), G.tileMaterial ? G.tileMaterial('sand') : new THREE.MeshBasicMaterial({ color: 0x806040 }));
    ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
    const sprites = [];
    const anim = opts.anim || 'idle';
    const list = [...CLASSES.map(c => ({ classId: c, look: { cloth: undefined }, name: c + 'x' })), ...ENEMIES.map(e => ({ templateId: e, isEnemy: true, name: e }))];
    list.forEach((d, i) => { const s = G.createActorSprite(d); const col = i % 8, row = Math.floor(i / 8); s.object3d.position.set(-7 + col * 2, 0, -3 + row * 2.2); scene.add(s.object3d); s.play(opts.anims ? opts.anims[i % opts.anims.length] : anim); s.setFacing(1); sprites.push(s); });
    const cam = new THREE.OrthographicCamera(-8 * 16 / 9 * (opts.zoom || 1), 8 * 16 / 9 * (opts.zoom || 1), 8 * (opts.zoom || 1), -8 * (opts.zoom || 1), 0.1, 200);
    cam.position.set(0, 14, 14); cam.lookAt(0, 0.5, 0);
    let last = performance.now();
    const tick = (n) => { const dt = Math.min(0.05, (n - last) / 1000); last = n; sprites.forEach(s => s.update(dt)); atm && atm.update(dt); G.updateEffects && G.updateEffects(dt); post.render(scene, cam); out.raf = requestAnimationFrame(tick); };
    out.raf = requestAnimationFrame(tick); out.sprites = sprites; out.scene = scene;
  }
  if (view === 'sheet') {
    root.style.background = '#6a5236';
    const ORDER = ['idle', 'walk', 'attack', 'shoot', 'hurt', 'die', 'cast'];
    const frames = opts.frames || [['idle', 0], ['walk', 0], ['attack', 1], ['attack', 2], ['shoot', 1], ['hurt', 0], ['die', 3], ['cast', 1]];
    const k = opts.k || 3;
    for (const d of opts.descs) {
      const c = G.spriteSheetCanvas(d); const line = document.createElement('div'); line.style.cssText = 'display:flex;height:' + 56 * k + 'px';
      for (const [an, f] of frames) { const cc = document.createElement('canvas'); cc.width = 56; cc.height = 56; cc.getContext('2d').drawImage(c, f * 56, ORDER.indexOf(an) * 56, 56, 56, 0, 0, 56, 56); cc.style.cssText = `width:${56 * k}px;height:${56 * k}px;image-rendering:pixelated;`; line.appendChild(cc); }
      root.appendChild(line);
    }
  }
  if (view === 'portraits') {
    root.style.background = '#222'; root.style.display = 'flex'; root.style.flexWrap = 'wrap';
    const k = opts.k || 4;
    for (const d of opts.descs) { const c = G.portraitCanvas(d, 64); c.style.cssText = `width:${64 * k}px;height:${64 * k}px;image-rendering:pixelated;margin:4px`; root.appendChild(c); }
  }
  if (view === 'icons') {
    root.style.background = '#2a2420'; root.style.display = 'flex'; root.style.flexWrap = 'wrap'; root.style.alignContent = 'flex-start';
    for (const id of opts.items) { const c = G.itemIcon(id, 32); c.style.cssText = 'width:96px;height:96px;image-rendering:pixelated;margin:3px;background:#3a3028'; root.appendChild(c); }
    const br = document.createElement('div'); br.style.cssText = 'flex-basis:100%'; root.appendChild(br);
    for (const id of opts.abil) { const c = G.abilityIcon(id, 24); c.style.cssText = 'width:96px;height:96px;image-rendering:pixelated;margin:3px'; root.appendChild(c); }
  }
  if (view === 'world') {
    const { r, c } = mkRenderer(480, 270, 2.6); root.appendChild(c);
    const post = G.createPost(r, 480, 270);
    const scene = new THREE.Scene(); const atm = G.setupAtmosphere(scene, opts.mood || 'dusk');
    const tg = new THREE.PlaneGeometry(1, 1); const types = ['sand', 'asphalt', 'asphalt_cracked', 'rubble', 'concrete', 'dirt', 'toxic', 'grass_dead', 'metal', 'tiles'];
    const cx = opts.cx || 0, cz = opts.cz || 0;
    for (let x = -14; x < 14; x++) for (let z = -14; z < 14; z++) {
      let t = 'sand'; if (z >= -9 && z <= -8) t = types[(x + 14) % 10]; else if (z < -9) t = 'asphalt'; else if (z > 8) t = 'dirt'; else t = (x + 14) % 7 < 3 ? 'sand' : (x + z) % 5 === 0 ? 'rubble' : 'asphalt_cracked';
      if (z === -7) t = 'concrete'; if (z === -6) t = ['sand', 'toxic', 'grass_dead'][(x + 14) % 3];
      const m = new THREE.Mesh(tg, G.tileMaterial(t, (x * 3 + z * 5) & 3)); m.rotation.x = -Math.PI / 2; m.position.set(x + 0.5, 0, z + 0.5); m.receiveShadow = true; scene.add(m);
    }
    const props = G.PROP_TYPES; props.forEach((t, i) => { const o = G.createProp(t, { seed: i }); o.position.set(-12 + (i % 13) * 1.8 + 0.5, 0, -3 + Math.floor(i / 13) * 2.4 + 0.5); scene.add(o); });
    const b1 = G.createBuilding({ w: 4, d: 3, h: 3, seed: 3 }); b1.position.set(-5, 0, 11); scene.add(b1);
    const b2 = G.createBuilding({ w: 3, d: 3, h: 2, seed: 8 }); b2.position.set(1, 0, 11); scene.add(b2);
    const b3 = G.createBuilding({ w: 3, d: 4, h: 4, seed: 12 }); b3.position.set(7, 0, 11); scene.add(b3);
    const sp = []; ['soldier', 'scout', 'medic', 'techie', 'scavenger', 'brute'].forEach((cl, i) => { const s = G.createActorSprite({ classId: cl }); s.object3d.position.set(-5 + i * 1.4, 0, 2.2); scene.add(s.object3d); sp.push(s); });
    ['raider_thug', 'kostucha', 'wild_dog', 'giant_bug', 'rogue_drone', 'sentry_turret'].forEach((e, i) => { const s = G.createActorSprite({ templateId: e, isEnemy: true }); s.object3d.position.set(-5 + i * 1.6, 0, 4.2); scene.add(s.object3d); sp.push(s); });
    sp[0].setSelected(true); sp[7].setHighlight('#ff4030');
    const z = opts.zoom || 1; const cam = new THREE.OrthographicCamera(-9 * 16 / 9 * z, 9 * 16 / 9 * z, 9 * z, -9 * z, 0.1, 200);
    cam.position.set(cx + 10, 11 + 3, cz + 14 + 0); cam.lookAt(cx, 0, cz);
    out.cam = cam; out.scene = scene;
    let last = performance.now(); const tick = (n) => { const dt = Math.min(0.05, (n - last) / 1000); last = n; sp.forEach(s => s.update(dt)); atm.update(dt); G.updateEffects(dt); post.render(scene, cam); out.raf = requestAnimationFrame(tick); }; out.raf = requestAnimationFrame(tick);
  }
  return out;
}
