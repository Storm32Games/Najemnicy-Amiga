// Intro: 6 animated Three.js dioramas + typewriter narration -> title.
import { THREE, UI, Audio, GFX, disposeObj, gradientTexture, rngSeed, skyline, dunes, particles, makeFire, sprite, fadeLayer, Typewriter } from './meta/common.js';
import { Game } from '../core/game.js';
import { Engine } from '../core/engine.js';
import { INTRO_SLIDES } from '../data/story.js';
import { RECRUITS } from '../data/recruits.js';

const mk = (sky, fogCol, near = 20, far = 80, fov = 50) => {
  const scene = new THREE.Scene(); scene.background = gradientTexture(sky);
  if (fogCol != null) scene.fog = new THREE.Fog(fogCol, near, far);
  const camera = new THREE.PerspectiveCamera(fov, 16 / 9, 0.1, 300);
  return { scene, camera, upd: [] };
};
const dark = (c = 0x14100d) => new THREE.MeshLambertMaterial({ color: c, flatShading: true });
const LOOK = (cloth, accent, skin = '#b08060') => ({ body: 'medium', skin, hair: '#2a2018', hairStyle: 1, cloth, accent });

const BUILD = {
  // 1 - missiles, flash, mushroom cloud over skyline
  bomb(ctx) {
    const s = mk([[0, '#1a2038'], [0.5, '#6a4a5a'], [0.85, '#e0905a'], [1, '#f2c27a']], 0x9a6a58, 40, 140);
    s.scene.add(new THREE.AmbientLight(0xffc9a0, 1.2)); const sun = new THREE.DirectionalLight(0xffa860, 2); sun.position.set(-5, 6, 10); s.scene.add(sun);
    s.camera.position.set(0, 3, 22); s.camera.lookAt(0, 8, -30);
    const g = dunes(260, 160, { amp: 0.5, base: [0.35, 0.27, 0.2], seed: 4 }); g.position.set(0, -0.2, -40); s.scene.add(g);
    const sk = skyline(rngSeed(11), { n: 40, x0: -60, x1: 60, z: -50, hMin: 5, hMax: 26, color: 0x2a1f1c, lit: true }); s.scene.add(sk);
    const sk2 = skyline(rngSeed(12), { n: 24, x0: -50, x1: 50, z: -35, hMin: 3, hMax: 12, color: 0x1d1512, lit: true }); s.scene.add(sk2);
    // missiles
    const ms = [];
    for (let i = 0; i < 3; i++) {
      const head = new THREE.Mesh(new THREE.ConeGeometry(0.25, 1.2, 5), new THREE.MeshBasicMaterial({ color: 0xffeecc })); head.rotation.z = 0; s.scene.add(head);
      const trail = []; for (let j = 0; j < 16; j++) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), new THREE.MeshBasicMaterial({ color: j < 4 ? 0xffc060 : 0x8a7a70 })); s.scene.add(b); trail.push(b); }
      ms.push({ head, trail, sx: 30 - i * 14, sy: 50 + i * 8, ex: -10 + i * 14, ey: 4, ez: -46 + i * 4, d: 0.4 + i * 0.3 });
    }
    // mushroom cloud
    const cloud = new THREE.Group(); cloud.position.set(4, 0, -48); s.scene.add(cloud);
    const orange = new THREE.MeshBasicMaterial({ color: 0xff8a30 }), red = new THREE.MeshBasicMaterial({ color: 0xc43d1a }), gray = new THREE.MeshBasicMaterial({ color: 0x5a4a44 });
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 2.4, 1, 8, 1), red); cloud.add(stem);
    const cap = [];
    for (let i = 0; i < 7; i++) { const m = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1), i % 2 ? orange : red); m.userData.a = i / 7 * Math.PI * 2; cloud.add(m); cap.push(m); }
    const top = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1), gray); cloud.add(top);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1, 0.15, 4, 24), new THREE.MeshBasicMaterial({ color: 0xffe0a0, transparent: true, opacity: 0.8 })); ring.rotation.x = Math.PI / 2; ring.position.set(4, 0.5, -48); s.scene.add(ring);
    const glow = new THREE.PointLight(0xff9040, 0, 200); glow.position.set(4, 8, -40); s.scene.add(glow);
    const T = 2.6; // detonation time
    s.upd.push((t) => {
      ms.forEach(m => {
        const u = Math.min(1, Math.max(0, (t - m.d * 0.3) / 2.2)), vis = u > 0 && u < 1; m.head.visible = vis;
        const pos = (uu) => [m.sx + (m.ex - m.sx) * uu, m.sy + (m.ey - m.sy) * uu, 0 + (m.ez - 0) * uu];
        const p = pos(u); m.head.position.set(...p); m.head.rotation.z = Math.atan2(m.ex - m.sx, m.sy - m.ey) * -1 + Math.PI;
        m.trail.forEach((b, j) => { const uu = u - (j + 1) * 0.015; b.visible = vis && uu > 0; if (b.visible) { b.position.set(...pos(uu)); b.scale.setScalar(1 - j / 18); } });
      });
      const k = Math.max(0, t - T), grow = 1 - Math.exp(-k * 0.45);
      cloud.visible = t > T; glow.intensity = t > T ? Math.max(0, 8000 * Math.exp(-k * 0.5)) : 0;
      if (cloud.visible) {
        const h = 22 * grow; stem.scale.set(0.8 + grow * 0.6, h, 0.8 + grow * 0.6); stem.position.y = h / 2;
        cap.forEach(m => { const r = 3 + 7 * grow; m.position.set(Math.cos(m.userData.a + k * 0.1) * r, h - 1 + Math.sin(m.userData.a * 2) * 0.8, Math.sin(m.userData.a + k * 0.1) * r * 0.6); m.scale.set(2.2 + 3 * grow, 1.6 + 1.8 * grow, 2.2 + 3 * grow); });
        top.position.set(0, h + 1 * grow, 0); top.scale.set(4 + 6 * grow, 2.5 + 2 * grow, 4 + 6 * grow);
        ring.visible = k < 3; ring.scale.setScalar(1 + k * 20); ring.material.opacity = Math.max(0, 0.9 - k * 0.3);
      } else ring.visible = false;
      ctx.flash(t > T ? Math.max(0, 1 - (t - T) * 1.1) : 0);
      if (t > T && !s._boom) { s._boom = true; Audio.sfx('explosion'); }
      s.camera.position.x = Math.sin(t * 0.3) * 1.5; s.camera.position.y = 3 + (k > 0 ? Math.sin(k * 40) * Math.max(0, 0.6 - k * 0.2) : 0); s.camera.lookAt(0, 9, -30);
    });
    return s;
  },
  // 2 - ruined city in green fog
  ruins(ctx) {
    const s = mk([[0, '#0f1a14'], [0.6, '#2d4030'], [1, '#4f6a46']], 0x3f6045, 10, 85);
    s.scene.add(new THREE.AmbientLight(0xa8cca8, 2.6)); const l = new THREE.DirectionalLight(0xb8d890, 2.4); l.position.set(-6, 10, 5); s.scene.add(l);
    const road = new THREE.Mesh(new THREE.PlaneGeometry(10, 200), dark(0x2a2a28)); road.rotation.x = -Math.PI / 2; s.scene.add(road);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), dark(0x24301f)); ground.rotation.x = -Math.PI / 2; ground.position.y = -0.05; s.scene.add(ground);
    const rng = rngSeed(21);
    for (let side = -1; side <= 1; side += 2) for (let i = 0; i < 18; i++) {
      const w = 4 + rng() * 5, h = 8 + rng() * 26, z = -i * 9 + 5, x = side * (8 + w / 2 + rng() * 6);
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, 6 + rng() * 4), new THREE.MeshLambertMaterial({ color: 0x2c302a, map: null }));
      b.position.set(x, h / 2, z); b.rotation.z = (rng() - 0.5) * 0.1; s.scene.add(b);
      const wm = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.9, h * 0.9), new THREE.MeshBasicMaterial({ map: (() => { const t = GFX_win(); return t; })(), transparent: true, opacity: 0.6 }));
      wm.position.set(x - side * (w / 2 + 0.01), h / 2, z); wm.rotation.y = -side * Math.PI / 2; wm.scale.x = 0.7; s.scene.add(wm);
      if (rng() < 0.5) { const c = new THREE.Mesh(new THREE.BoxGeometry(w * 0.7, 2, 3), dark(0x1a1d18)); c.position.set(x, h + 0.5, z); c.rotation.set(rng(), rng(), rng()); s.scene.add(c); }
    }
    for (let i = 0; i < 14; i++) { // wrecks
      const c = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.1, 4), dark(0x3a3028)); c.position.set((rng() - 0.5) * 7, 0.55, -rng() * 120 + 2); c.rotation.y = (rng() - 0.5) * 0.8; s.scene.add(c);
    }
    const eyes = [];
    for (let i = 0; i < 7; i++) {
      const gp = new THREE.Group(); const x = (rng() > 0.5 ? 1 : -1) * (5 + rng() * 6), z = -10 - i * 12 - rng() * 6;
      for (const dx of [-0.18, 0.18]) { const e = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.08, 0.05), new THREE.MeshBasicMaterial({ color: i % 2 ? 0xff3a20 : 0xb8ff40 })); e.position.x = dx; gp.add(e); }
      gp.position.set(x, 0.7 + rng() * 1.5, z); gp.userData = { ph: rng() * 10 }; s.scene.add(gp); eyes.push(gp);
    }
    const ash = particles(220, { box: [24, 14, 60], center: [0, 0, -25], color: 0xb0c0a0, size: 2, vel: [0.3, -0.5, 0], seed: 2, opacity: 0.6 }); s.scene.add(ash);
    s.upd.push((t, dt) => {
      s.camera.position.set(Math.sin(t * 0.25) * 1.2, 2.2 + Math.sin(t * 0.4) * 0.1, 8 - t * 0.9); s.camera.lookAt(0, 4, s.camera.position.z - 30);
      eyes.forEach(e => { e.visible = Math.sin(t * 1.5 + e.userData.ph) > -0.7 && Math.sin(t * 7 + e.userData.ph) > -0.95; });
      ash.userData.update(dt);
    });
    return s;
  },
  // 3 - raiders around a fire
  raiders(ctx) {
    const s = mk([[0, '#05060a'], [0.7, '#1a1220'], [1, '#2a1c1c']], 0x120c10, 8, 45);
    s.scene.add(new THREE.AmbientLight(0x6a6a9a, 1.8));
    const g = dunes(120, 80, { amp: 0.4, base: [0.3, 0.24, 0.18], seed: 6 }); s.scene.add(g);
    const fire = makeFire(1.6); s.scene.add(fire);
    const logs = new THREE.Group(); for (let i = 0; i < 4; i++) { const l = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.2, 0.2), dark(0x3a2410)); l.rotation.y = i * 0.8; l.position.y = 0.1; logs.add(l); } s.scene.add(logs);
    const members = [], looks = [LOOK('#4a3a30', '#c43d2f', '#8a6a50'), LOOK('#2a2a2e', '#b4532a'), LOOK('#5a4a28', '#c9a23a', '#a07858'), LOOK('#3a2a3a', '#c43d2f'), LOOK('#40382a', '#8fd14f', '#7a9a62')];
    looks.forEach((lk, i) => {
      const a = (i / looks.length) * Math.PI * 2 + 0.3, sp = sprite({ classId: ['brute', 'scavenger', 'soldier', 'scavenger', 'brute'][i], look: { ...lk, mask: i % 2 === 0 } }, 1);
      sp.object3d.position.set(Math.cos(a) * 3.2, 0, Math.sin(a) * 2.6); s.scene.add(sp.object3d); sp.play('idle'); members.push(sp);
    });
    // flag: skull on pole
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 5, 5), dark(0x2a2018)); pole.position.set(-6, 2.5, -4); s.scene.add(pole);
    const fc = document.createElement('canvas'); fc.width = 32; fc.height = 20; const fg = fc.getContext('2d'); fg.fillStyle = '#5a1010'; fg.fillRect(0, 0, 32, 20); fg.fillStyle = '#e8dcc0'; fg.fillRect(11, 4, 10, 8); fg.fillRect(13, 12, 6, 3); fg.fillStyle = '#000'; fg.fillRect(13, 7, 2, 2); fg.fillRect(17, 7, 2, 2); fg.fillStyle = '#8a8a90'; fg.fillRect(8, 16, 16, 2);
    const ft = new THREE.CanvasTexture(fc); ft.magFilter = THREE.NearestFilter; const flag = new THREE.Mesh(new THREE.PlaneGeometry(3, 1.9, 6, 1), new THREE.MeshBasicMaterial({ map: ft, side: THREE.DoubleSide })); flag.position.set(-4.5, 4.1, -4); s.scene.add(flag);
    for (const [x, z, r] of [[-7, -2, 0.5], [7, -3, -0.4], [2, -7, 0.1]]) { try { const t = GFX.createProp('tent'); t.position.set(x, 0, z); t.rotation.y = r; t.scale.setScalar(2); s.scene.add(t); } catch { } }
    const sparks = particles(40, { box: [3, 7, 3], center: [0, 0, 0], color: 0xffa040, size: 2, vel: [0.2, 1.2, 0], seed: 3, opacity: 0.9 }); s.scene.add(sparks);
    s.upd.push((t, dt) => {
      fire.userData.update(t); sparks.userData.update(dt); members.forEach(m => m.update(dt));
      const p = flag.geometry.attributes.position; for (let i = 0; i < p.count; i++) p.setZ(i, Math.sin(t * 4 + p.getX(i) * 2) * 0.15 * (p.getX(i) + 1.5) / 3); p.needsUpdate = true;
      const a = 0.6 + Math.sin(t * 0.15) * 0.35; s.camera.position.set(Math.sin(a) * 10, 2.2, Math.cos(a) * 10); s.camera.lookAt(0, 1.3, 0);
    });
    s.dispose = () => members.forEach(m => m.dispose?.());
    return s;
  },
  // 4 - nomad caravan on dunes at sunset
  nomads(ctx) {
    const s = mk([[0, '#3a2a5a'], [0.45, '#c0603a'], [0.75, '#f0a050'], [1, '#f8d090']], 0xd89058, 30, 140);
    s.scene.add(new THREE.AmbientLight(0xffd0a0, 1.6)); const sun = new THREE.DirectionalLight(0xffa050, 2.6); sun.position.set(-30, 6, -30); s.scene.add(sun);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(9, 24), new THREE.MeshBasicMaterial({ color: 0xffe0a0, fog: false })); disc.position.set(-20, 12, -120); s.scene.add(disc);
    const g = dunes(300, 200, { amp: 3, scale: 0.07, base: [0.85, 0.62, 0.38], seed: 8 }); s.scene.add(g);
    const grp = new THREE.Group(); s.scene.add(grp); const walkers = [];
    const mkBeast = () => {
      const b = new THREE.Group(), body = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.9, 0.7), dark(0x6a4a30)); body.position.y = 1.3; b.add(body);
      const neck = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.9, 0.3), dark(0x6a4a30)); neck.position.set(0.8, 1.8, 0); neck.rotation.z = -0.4; b.add(neck);
      const hd = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.3, 0.3), dark(0x7a5a38)); hd.position.set(1.1, 2.3, 0); b.add(hd);
      const hump = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.4, 0.6), dark(0x5a3a22)); hump.position.set(-0.2, 1.9, 0); b.add(hump);
      const legs = []; for (const [x, z] of [[-0.6, -0.25], [-0.6, 0.25], [0.6, -0.25], [0.6, 0.25]]) { const l = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.9, 0.18), dark(0x5a3a22)); l.position.set(x, 0.45, z); b.add(l); legs.push(l); }
      b.userData.legs = legs; return b;
    };
    const slots = [['p', 0], ['b', 3], ['p', 6], ['b', 9.5], ['p', 12], ['p', 14]];
    slots.forEach(([k, x], i) => {
      if (k === 'b') { const b = mkBeast(); b.position.x = -x; grp.add(b); walkers.push({ o: b, beast: true, ph: i }); if (i === 3) { const crate = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.9, 1), dark(0x8a7a50)); crate.position.set(-0.2, 2.3, 0); b.add(crate); } }
      else { const sp = sprite({ classId: ['scout', 'soldier', 'techie', 'scavenger'][i % 4], look: { ...LOOK('#a08a60', '#b4532a', '#8a5e44'), mask: true, hairStyle: 3 } }, 1); sp.object3d.position.x = -x; grp.add(sp.object3d); sp.play('walk'); walkers.push({ o: sp.object3d, sp, ph: i }); }
    });
    const dust = particles(120, { box: [60, 6, 40], center: [0, 0, -10], color: 0xf0c080, size: 2, vel: [2, 0.1, 0], seed: 5, opacity: 0.5 }); s.scene.add(dust);
    s.upd.push((t, dt) => {
      grp.position.set(-12 + t * 0.9, 0.3, -8);
      walkers.forEach(w => { if (w.sp) w.sp.update(dt); const bob = Math.abs(Math.sin(t * 3 + w.ph)) * (w.beast ? 0.08 : 0.06); w.o.position.y = bob; if (w.beast) w.o.userData.legs.forEach((l, i) => { l.rotation.z = Math.sin(t * 4 + i * 1.6) * 0.3; }); });
      dust.userData.update(dt); s.camera.position.set(2 + Math.sin(t * 0.2) * 2, 1.6, 6); s.camera.lookAt(2 + t * 0.4 - 4, 2.2, -8);
    });
    s.dispose = () => walkers.forEach(w => w.sp?.dispose?.());
    return s;
  },
  // 5 - Przystan lights
  haven(ctx) {
    const s = mk([[0, '#04060e'], [0.6, '#10182c'], [1, '#2a2838']], 0x151a2a, 12, 70);
    s.scene.add(new THREE.AmbientLight(0x4a5a8a, 1.1));
    const g = dunes(200, 120, { amp: 0.6, base: [0.28, 0.24, 0.2], seed: 12, flatNear: 0 }); g.position.y = -0.1; s.scene.add(g);
    const rng = rngSeed(31);
    const stars = new Float32Array(300 * 3); for (let i = 0; i < 300; i++) { const a = rng() * Math.PI, b = rng() * Math.PI; stars[i * 3] = Math.cos(a) * 100 * (rng() > 0.5 ? 1 : -1); stars[i * 3 + 1] = 20 + rng() * 70; stars[i * 3 + 2] = -60 - rng() * 40; }
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(stars, 3)); s.scene.add(new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 1, sizeAttenuation: false, fog: false })));
    const far = skyline(rngSeed(33), { n: 30, x0: -90, x1: 90, z: -70, hMin: 6, hMax: 30, color: 0x0e0e14, lit: false }); s.scene.add(far);
    // depot hall
    const hall = new THREE.Mesh(new THREE.BoxGeometry(18, 5, 8), dark(0x3a3530)); hall.position.set(0, 2.5, -6); s.scene.add(hall);
    const roof = new THREE.Mesh(new THREE.CylinderGeometry(4.2, 4.2, 18, 8, 1, false, 0, Math.PI), dark(0x4a3a30)); roof.rotation.z = Math.PI / 2; roof.rotation.y = 0; roof.position.set(0, 5, -6); roof.scale.set(1, 1, 1.9); s.scene.add(roof);
    const winM = new THREE.MeshBasicMaterial({ color: 0xffc860 });
    for (let i = 0; i < 9; i++) { const w = new THREE.Mesh(new THREE.BoxGeometry(1, 1.4, 0.1), winM); w.position.set(-7.2 + i * 1.8, 2.4, -1.95); s.scene.add(w); }
    const door = new THREE.Mesh(new THREE.BoxGeometry(2.6, 3, 0.1), new THREE.MeshBasicMaterial({ color: 0xffa040 })); door.position.set(0, 1.5, -1.95); s.scene.add(door);
    // wall + towers
    for (const x of [-14, 14]) { const t = new THREE.Mesh(new THREE.BoxGeometry(2.4, 8, 2.4), dark(0x2e2a26)); t.position.set(x, 4, -3); s.scene.add(t); const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.5, 0.7), new THREE.MeshBasicMaterial({ color: 0xfff0a0 })); lamp.position.set(x, 8.4, -3); s.scene.add(lamp); const pl = new THREE.PointLight(0xffd080, 25, 22); pl.position.set(x, 8, -1); s.scene.add(pl); }
    const wall = new THREE.Mesh(new THREE.BoxGeometry(34, 2.2, 0.8), dark(0x38322c)); wall.position.set(0, 1.1, -0.5); s.scene.add(wall);
    const gate = new THREE.PointLight(0xffa850, 30, 18); gate.position.set(0, 2.5, 1); s.scene.add(gate);
    // little fires & lamps in front
    const fires = []; for (const [x, z] of [[-6, 3], [7, 4]]) { const f = makeFire(0.8); f.position.set(x, 0, z); s.scene.add(f); fires.push(f); }
    for (let i = 0; i < 5; i++) { const sp = sprite({ classId: ['medic', 'techie', 'soldier', 'scavenger', 'scout'][i], look: LOOK(['#8a7a60', '#5a6a70', '#4a5a40', '#6a4a40', '#7a6a50'][i], '#c9a23a') }, 1); sp.object3d.position.set(-3 + i * 1.6, 0, 3 + (i % 2)); s.scene.add(sp.object3d); sp.play('idle'); (s.sps ||= []).push(sp); }
    const smoke = particles(40, { box: [4, 6, 3], center: [-6, 1, 3], color: 0x9a9aa0, size: 2, vel: [0.3, 0.6, 0], seed: 5, opacity: 0.4 }); s.scene.add(smoke);
    s.upd.push((t, dt) => { fires.forEach(f => f.userData.update(t)); smoke.userData.update(dt); s.sps.forEach(sp => sp.update(dt)); s.camera.position.set(Math.sin(t * 0.15) * 3, 2 + t * 0.35, 16 - t * 0.25); s.camera.lookAt(0, 3.5 + t * 0.12, -6); });
    s.dispose = () => s.sps.forEach(sp => sp.dispose?.());
    return s;
  },
  // 6 - the mercenaries
  crew(ctx) {
    const s = mk([[0, '#1a1030'], [0.5, '#a0402a'], [0.78, '#f0902a'], [1, '#ffd070']], 0xe08040, 20, 120);
    s.scene.add(new THREE.AmbientLight(0xffb080, 1.1)); const back = new THREE.DirectionalLight(0xffb060, 3); back.position.set(-8, 4, -20); s.scene.add(back);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(12, 28), new THREE.MeshBasicMaterial({ color: 0xffe8a0, fog: false })); disc.position.set(0, 7, -100); s.scene.add(disc);
    const g = dunes(260, 160, { amp: 1.2, scale: 0.12, base: [0.5, 0.34, 0.22], seed: 14, flatNear: 0 }); g.position.y = -0.3; s.scene.add(g);
    const city = skyline(rngSeed(40), { n: 34, x0: -70, x1: 70, z: -80, hMin: 4, hMax: 22, color: 0x1a1010, lit: false }); s.scene.add(city);
    const picks = [RECRUITS[0], RECRUITS[1], RECRUITS[2], RECRUITS[3]].filter(Boolean), sps = [];
    picks.forEach((r, i) => { const sp = sprite({ ...r, classId: r.classId, look: r.look }, 1.15); sp.object3d.position.set(-3.6 + i * 2.4, 0, 0); s.scene.add(sp.object3d); sp.play('idle'); sps.push(sp); });
    const dust = particles(120, { box: [40, 6, 20], center: [0, 0, -5], color: 0xffc070, size: 2, vel: [1.2, 0.1, 0], seed: 17, opacity: 0.55 }); s.scene.add(dust);
    s.upd.push((t, dt) => { sps.forEach(sp => sp.update(dt)); dust.userData.update(dt); s.camera.position.set(Math.sin(t * 0.12) * 1.5, 0.7 + Math.min(t * 0.08, 0.7), 7.5 - Math.min(t * 0.25, 1.8)); s.camera.lookAt(0, 1.6, -5); });
    s.dispose = () => sps.forEach(sp => sp.dispose?.());
    return s;
  },
};
let _w = null; function GFX_win() { return _w ||= (() => { const c = document.createElement('canvas'); c.width = 8; c.height = 16; const g = c.getContext('2d'); const rng = rngSeed(5); for (let y = 0; y < 16; y += 2) for (let x = 0; x < 8; x += 2) { const r = rng(); if (r < 0.15) { g.fillStyle = '#c8e890'; g.fillRect(x, y, 1, 1); } else if (r < 0.7) { g.fillStyle = '#000'; g.fillRect(x, y, 1, 1); } } const t = new THREE.CanvasTexture(c); t.magFilter = THREE.NearestFilter; return t; })(); }

let I = null;
export default {
  enter() {
    I = { i: -1, t: 0, tw: null, cur: null, waited: 0, slides: [], leaving: false };
    this.flashEl = UI.add(UI.el('div', { style: 'position:absolute;inset:0;background:#fff;opacity:0;pointer-events:none;z-index:30' }));
    const panel = UI.add(UI.panel('left:8%;right:8%;bottom:5%;min-height:15%;display:flex;gap:1em;align-items:center;z-index:20;background:#0d0a08dd'));
    I.text = UI.el('div', { style: 'flex:1;font-size:1.25em;line-height:1.55;min-height:4.6em' });
    I.next = UI.button('Dalej ▶', () => this.advance(), { class: 'primary' });
    panel.append(I.text, I.next);
    I.dots = UI.add(UI.el('div', { style: 'position:absolute;left:0;right:0;bottom:1.5%;text-align:center;letter-spacing:.4em;color:var(--dim);z-index:20' }));
    UI.add(UI.button('Pomiń intro ▶▶', () => this.finish(), { class: '' }), UI.add(UI.el('div', { style: 'position:absolute;right:2%;top:3%;z-index:25' })));
    I.fade = fadeLayer('#000'); this.go(0);
    Audio.music('intro');
    const q = +new URLSearchParams(location.search).get('slide'); if (q) { this.go(q - 1); I.t = +new URLSearchParams(location.search).get('tt') || 0; I.tw.finish(); }
  },
  go(n) {
    if (n >= INTRO_SLIDES.length) return this.finish();
    if (I.cur) { disposeObj(I.cur.scene); I.cur.dispose?.(); }
    I.i = n; I.t = 0; I.waited = 0; this.flashEl.style.opacity = 0;
    I.cur = BUILD[INTRO_SLIDES[n].id]({ flash: (v) => { this.flashEl.style.opacity = v; } });
    I.cur.upd.forEach(f => f(0, 0.016));
    I.tw = new Typewriter(I.text, INTRO_SLIDES[n].text, 34);
    I.dots.textContent = INTRO_SLIDES.map((_, k) => k === n ? '◆' : '◇').join(' ');
    I.fade.style.transition = 'none'; I.fade.style.opacity = 1; requestAnimationFrame(() => requestAnimationFrame(() => { I.fade.to(0, 700); }));
    this.scene = I.cur.scene; this.camera = I.cur.camera;
  },
  advance() {
    if (I.leaving) return;
    if (!I.tw.done) { I.tw.finish(); return; }
    I.leaving = true; I.fade.to(1, 500); setTimeout(() => { if (!I) return; I.leaving = false; this.go(I.i + 1); }, 520);
  },
  finish() { if (!I || I.leaving) return; I.leaving = true; I.fade.to(1, 400); setTimeout(() => { if (Game.current === this) Game.goto('title'); }, 420); },
  onPointerDown() { this.advance(); },
  onKey(e) { if (e.key === 'Escape') this.finish(); else if (['Enter', ' ', 'ArrowRight'].includes(e.key)) this.advance(); },
  update(dt, time) {
    if (!I?.cur) return; I.t += dt; I.tw.update(dt);
    I.cur.upd.forEach(f => f(I.t, dt));
    if (I.tw.done && !I.leaving) { I.waited += dt; I.next.textContent = 'Dalej ▶'; if (I.waited > 4.5) this.advance(); }
  },
  exit() { if (I?.cur) { disposeObj(I.cur.scene); I.cur.dispose?.(); } I = null; this.scene = null; },
};
