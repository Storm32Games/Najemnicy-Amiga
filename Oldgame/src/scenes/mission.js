// MISSION scene: tactical map, camera, exploration, objectives. Combat lives in ../mission/combat.js.
import { Engine, THREE } from '../core/engine.js';
import { UI } from '../core/ui.js';
import { Game } from '../core/game.js';
import { R, G, Audio, ENEMIES, ITEMS, getStat, createEnemy, isAlive, isDown, check, skillCheck, dcForLevel, newItem, roll, partyLevel, encounterXP, rnd, applyDamage, SKILLS } from '../mission/rl.js';
import { generateMap, MAP_W, MAP_H, mulberry } from '../mission/map.js';
import { Grid, sleep, cheb, dist } from '../mission/util.js';
import { createHud } from '../mission/hud.js';
import { createCombat } from '../mission/combat.js';

let M = null;
const BIOME_MUSIC = { ruins: 'ruins', wastes: 'wastes', industrial: 'ruins', bunker: 'ruins' };
const SPEEDS = [1, 2, 4];

function resolveContract(c) {
  const st = Game.state;
  if (typeof c === 'string') c = st.contracts?.find(x => x.id === c);
  if (c && typeof c === 'object') return c;
  return { id: 'fallback', title: 'Zlecenie na gwałt', type: 'eliminate', level: 1, biome: 'ruins', mood: 'dusk', enemies: ['raider_thug', 'raider_gunner', 'raider_thug'], objective: { type: 'eliminate' }, reward: { scrap: 50, xp: 60, items: [], rep: {} } };
}

const scene = {
  scene: null, camera: null,
  enter(params = {}) {
    this.exit();
    if (!Game.state.party?.length) { try { Game.quickParty?.(); } catch (e) { console.warn(e); } }
    const contract = resolveContract(params.contract);
    const objType = contract.objective?.type || contract.type || 'eliminate';
    M = { contract, objType, scene: new THREE.Scene(), time: 0, speed: Number(localStorage.getItem?.('pir-speed')) || 1, group: true, mode: 'explore', busy: false, killed: [], loot: [], scrap: 0, stage: 0, steps: 0, things: [], neutral: [], listeners: [], extractAsked: false };
    this.scene = M.scene; window.__M = M;
    this.buildCamera(); this.buildWorld(); this.buildActors();
    M.hud = createHud(M); M.C = createCombat(M); M.hud.setSpeed(M.speed); M.hud.setMode(M.group);
    this.api();
    M.updateVis(); M.focusActor(M.selected, true); M.snapCamera();
    this.refreshObjective(); M.refreshAll();
    M.hud.log(`Zlecenie: ${contract.title || 'Misja'}. Wchodzicie na teren (${contract.biome}).`, 'amber');
    M.hud.log('Klikaj pola, by się poruszać. Wrogowie czyhają w ciemności. [H] sterowanie.', 'dim');
    try { Audio.music(BIOME_MUSIC[contract.biome] || 'ruins'); Audio.ambience(contract.biome === 'bunker' ? 'ruins' : 'wind'); } catch (e) {}
    window.__mission = {
      state: M, winNow: () => M.finish('success'), loseNow: () => M.finish('lose'),
      autoTurn: () => M.C.autoTurn(),
      walkTo: (x, y) => M.moveParty(x, y),
      get mode() { return M.mode; },
    };
  },
  exit() {
    if (!M) return;
    M.dead = true; try { M.atmo = null; M.sprites?.forEach(s => s.dispose?.()); } catch (e) {}
    for (const [t, f, o] of M.listeners) t.removeEventListener(f, o);
    try { this.scene?.traverse(o => { o.geometry?.dispose?.(); }); } catch (e) {}
    M = null; window.__mission = undefined; this.scene = null;
  },

  // ---------- camera
  buildCamera() {
    const cam = new THREE.OrthographicCamera(-8, 8, 4.5, -4.5, -200, 200);
    this.camera = cam; M.cam = cam;
    M.yaw = Math.PI / 4; M.yawT = M.yaw; M.pitch = THREE.MathUtils.degToRad(35); M.zoom = 1; M.zoomT = 1;
    M.camT = new THREE.Vector3(); M.targetT = new THREE.Vector3(); M.keys = new Set();
    M.snapCamera = () => { M.camT.copy(M.targetT); M.yaw = M.yawT; M.zoom = M.zoomT; applyCam(); };
    const applyCam = () => {
      const vh = 8.5 / M.zoom, vw = vh * 16 / 9;   // 2026-11-12: wieksze pola (bylo 13)
      cam.left = -vw / 2; cam.right = vw / 2; cam.top = vh / 2; cam.bottom = -vh / 2; cam.updateProjectionMatrix();
      const D = 60, cp = Math.cos(M.pitch);
      cam.position.set(M.camT.x + Math.sin(M.yaw) * cp * D, M.camT.y + Math.sin(M.pitch) * D, M.camT.z + Math.cos(M.yaw) * cp * D);
      cam.lookAt(M.camT); cam.updateMatrixWorld();
    };
    M.applyCam = applyCam;
    M.zoomBy = (f) => { M.zoomT = Math.max(0.3, Math.min(2.4, M.zoomT * f)); };
    M.focusActor = (a, snap) => { if (!a) return; M.focus(a.x, a.y); if (snap) M.snapCamera(); };
    M.focus = (x, y) => { M.targetT.set(x - MAP_W / 2 + 0.5, 0, y - MAP_H / 2 + 0.5); };
  },

  // ---------- world
  buildWorld() {
    const THREE_ = THREE, scn = M.scene, c = M.contract;
    const map = M.map = generateMap(c, c.enemies || []);
    M.grid = new Grid(map.W, map.H, map.block);
    M.atmo = null; try { M.atmo = G.setupAtmosphere(scn, c.mood || 'dusk'); } catch (e) { console.warn('atmosphere', String(e && e.message)); scn.add(new THREE.AmbientLight(0xffffff, 0.8)); }
    // The tactical camera sits ~60 units from the map: exponential atmosphere fog would wash the board out.
    // Replace it with a linear fog that only tints the far edge of the map.
    if (scn.fog) { const heavy = ['toxic', 'storm'].includes(c.mood); scn.fog = new THREE.Fog(scn.fog.color.clone(), heavy ? 50 : 56, heavy ? 92 : 105); }
    const wx = (x) => x - MAP_W / 2 + 0.5, wz = (y) => y - MAP_H / 2 + 0.5; M.wx = wx; M.wz = wz;
    // ground under everything
    const under = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), new THREE.MeshBasicMaterial({ color: 0x0b0907 })); under.rotation.x = -Math.PI / 2; under.position.y = -0.06; scn.add(under);
    // floor: instanced per tile type
    const byType = {}; map.floor.forEach((t, i) => { (byType[t] = byType[t] || []).push(i); });
    const geo = new THREE.PlaneGeometry(1, 1); geo.rotateX(-Math.PI / 2);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion();
    for (const [type, cells] of Object.entries(byType)) {
      let mat; try { mat = G.tileMaterial(type); } catch (e) { mat = new THREE.MeshLambertMaterial({ color: 0x8a7a5a }); }
      const im = new THREE.InstancedMesh(geo, mat, cells.length); im.receiveShadow = true;
      cells.forEach((ci, k) => { const x = ci % map.W, y = (ci / map.W) | 0; q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), ((x * 7 + y * 13) % 4) * Math.PI / 2); m4.compose(new THREE.Vector3(wx(x), 0, wz(y)), q, new THREE.Vector3(1, 1, 1)); im.setMatrixAt(k, m4); });
      im.frustumCulled = false; scn.add(im);
    }
    // object registry for fog-of-war visibility
    M.cellObjs = new Map(); const reg = (x, y, o) => { const k = y * map.W + x; (M.cellObjs.get(k) || M.cellObjs.set(k, []).get(k)).push(o); };
    const mk = (fn, ...a) => { try { return fn(...a); } catch (e) { console.warn('gfx', String(e && e.message), String(e && e.stack).split('\n')[1]); return null; } };
    for (const p of map.props.concat(map.deco)) { const o = mk(G.createProp, p.type, { seed: p.seed }); if (!o) continue; o.position.set(wx(p.x), 0, wz(p.y)); o.rotation.y = p.rot * Math.PI / 2; scn.add(o); reg(p.x, p.y, o); }
    for (const d of map.decor) { const o = mk(G.createProp, d.type, { seed: 3 }); if (!o) continue; o.position.set(wx(d.x), 0, wz(d.y)); scn.add(o); reg(d.x, d.y, o); }
    for (const b of map.buildings) { const o = mk(G.createBuilding, { w: b.w, d: b.d, h: b.h, ruined: true, seed: b.seed }); if (!o) continue; o.position.set(wx(b.x) + (b.w - 1) / 2, 0, wz(b.y) + (b.d - 1) / 2); scn.add(o); for (let y = b.y; y < b.y + b.d; y++) for (let x = b.x; x < b.x + b.w; x++) reg(x, y, o); }
    if (map.solids.length) {
      const near = map.solids.filter(s => s.near); let mat; try { mat = G.tileMaterial('concrete'); } catch (e) { mat = new THREE.MeshLambertMaterial({ color: 0x555555 }); }
      const bg = new THREE.BoxGeometry(1, 2.6, 1); const im = new THREE.InstancedMesh(bg, mat, near.length); im.castShadow = im.receiveShadow = true; im.frustumCulled = false;
      near.forEach((s, k) => { m4.makeTranslation(wx(s.x), 1.3, wz(s.y)); im.setMatrixAt(k, m4); }); scn.add(im); M.solidMesh = im;
    }
    // extraction zone: 3D corner posts with glowing caps (no ground highlight). When the objective is done a
    // beacon (light column + floating "EWAKUACJA" sign with arrow) appears above the zone and the posts pulse.
    const e = map.entry, cx = wx((e.x0 + e.x1) / 2), cz = wz((e.y0 + e.y1) / 2);
    const postMat = new THREE.MeshBasicMaterial({ color: 0x3fae4a, fog: false }), capMat = new THREE.MeshBasicMaterial({ color: 0x9dff8a, fog: false });
    M.extract = { posts: [], postMat, capMat, beacon: null, cx, cz };
    for (const [px, pz] of [[e.x0, e.y0], [e.x1, e.y0], [e.x0, e.y1], [e.x1, e.y1]]) {
      const g = new THREE.Group(); g.position.set(wx(px) + (px === e.x0 ? -0.42 : 0.42), 0, wz(pz) + (pz === e.y0 ? -0.42 : 0.42));
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.05, 0.1), postMat); p.position.y = 0.525; g.add(p);
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.1, 0.12), new THREE.MeshBasicMaterial({ color: 0x111111, fog: false })); stripe.position.y = 0.75; g.add(stripe);
      const cap = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2), capMat); cap.position.y = 1.12; cap.rotation.y = Math.PI / 4; g.add(cap);
      scn.add(g); M.extract.posts.push(g);
    }
    {
      const bc = new THREE.Group(); bc.position.set(cx, 0, cz); bc.visible = false;
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 7, 8, 1, true), new THREE.MeshBasicMaterial({ color: 0x8fff7a, transparent: true, opacity: 0.18, depthWrite: false, fog: false, side: THREE.DoubleSide }));
      col.position.y = 3.5; bc.add(col);
      const cv = document.createElement('canvas'); cv.width = 96; cv.height = 40; const g = cv.getContext('2d');
      g.fillStyle = '#0b1a0c'; g.fillRect(0, 0, 96, 26); g.strokeStyle = '#8fff7a'; g.lineWidth = 2; g.strokeRect(1, 1, 94, 24);
      try { const w = G.measurePixelText?.('EWAKUACJA', 1) || 54; G.drawPixelText(g, 'EWAKUACJA', Math.round((96 - w) / 2), 9, { color: '#b8ff9a', scale: 1 }); } catch (err) { g.fillStyle = '#b8ff9a'; g.font = 'bold 10px monospace'; g.textAlign = 'center'; g.fillText('EWAKUACJA', 48, 17); }
      g.fillStyle = '#8fff7a'; g.beginPath(); g.moveTo(38, 28); g.lineTo(58, 28); g.lineTo(48, 39); g.closePath(); g.fill();
      const tex = new THREE.CanvasTexture(cv); tex.magFilter = tex.minFilter = THREE.NearestFilter; tex.generateMipmaps = false;
      const sign = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, fog: false })); sign.scale.set(2.4, 1.0, 1); sign.position.y = 3.2; sign.renderOrder = 25; bc.add(sign);
      bc.userData.sign = sign; scn.add(bc); M.extract.beacon = bc;
    }
    // overlays: fog (smooth) + highlight (canvas)
    const N = map.W * map.H; const fogData = new Uint8Array(N * 4); M.fogData = fogData;
    const fogTex = new THREE.DataTexture(fogData, map.W, map.H, THREE.RGBAFormat); fogTex.magFilter = THREE.LinearFilter; fogTex.minFilter = THREE.LinearFilter; fogTex.needsUpdate = true; M.fogTex = fogTex;
    const pg = new THREE.PlaneGeometry(map.W, map.H); pg.rotateX(-Math.PI / 2);
    const fog = new THREE.Mesh(pg, new THREE.MeshBasicMaterial({ map: fogTex, transparent: true, depthWrite: false })); fog.position.y = 2.7; fog.renderOrder = 5; scn.add(fog);
    // fog plane at height 2.7 would shift on iso projection; use two planes: ground-level for tiles (0.03) and rely on prop visibility for tall things.
    fog.position.y = 0.04;
    const hc = document.createElement('canvas'); hc.width = hc.height = map.W * 16; M.hlCanvas = hc; M.hlCtx = hc.getContext('2d');
    const hlTex = new THREE.CanvasTexture(hc); hlTex.magFilter = THREE.NearestFilter; hlTex.minFilter = THREE.NearestFilter; hlTex.generateMipmaps = false; M.hlTex = hlTex;
    const hl = new THREE.Mesh(pg.clone(), new THREE.MeshBasicMaterial({ map: hlTex, transparent: true, depthWrite: false })); hl.position.y = 0.06; hl.renderOrder = 6; scn.add(hl);
    M.explored = new Uint8Array(N); M.vis = new Uint8Array(N); M.HL = { tiles: [], path: [], dest: null, aim: null, outline: new Map(), hoverOutline: new Map() };
    M.extractAt = (x, y) => x >= e.x0 && x <= e.x1 && y >= e.y0 && y <= e.y1;
    // markers
    M.marks = []; // billboard marker sprites for objectives
  },

  buildActors() {
    const map = M.map, st = Game.state; M.pcs = []; M.enemies = []; M.actors = []; M.sprites = [];
    const mkActor = (ch, side, x, y) => {
      if (!ch.id) ch.id = 'a' + Math.random().toString(36).slice(2, 8);
      // randomly mutated fauna: beasts and bugs get a random hide / eye colour and size (cosmetic only)
      let mut = 1; if (side === 'enemy' && !ch.look && /rat|dog|wolf|boar|mole|kret|scorp|skorp|spider|pajak|beetle|chrzas|szczur|pies|wilk|dzik/i.test((ch.templateId || '') + ' ' + (ch.name || '')) && Math.random() < 0.75) {
        const pk = (arr) => arr[(Math.random() * arr.length) | 0];
        ch.look = { skin: pk(['#8a6a4a', '#5a5a62', '#7a8a4a', '#9a4a5a', '#4a7a8a', '#b89a5a', '#6a4a8a', '#c8c0b0']), accent: pk(['#ff3a2a', '#ffe040', '#40ffc0', '#ff60ff', '#8fff40']), mut: 1 + ((Math.random() * 1e6) | 0) }; mut = 0.92 + Math.random() * 0.24;
      }
      let sp; try { sp = G.createActorSprite(ch); } catch (e) { console.warn('sprite', e); sp = { object3d: new THREE.Object3D(), play() {}, setFacing() {}, update() {}, setHighlight() {}, setSelected() {}, dispose() {} }; }
      const a = { ch, side, x, y, sprite: sp, state: 'up', flags: {}, mapN: 0, used: {}, px: x, py: y };
      if (mut !== 1) sp.object3d.scale.setScalar(mut);
      sp.object3d.position.set(M.wx(x), 0, M.wz(y)); M.scene.add(sp.object3d); M.sprites.push(sp);
      // hp bar billboard
      const cv = document.createElement('canvas'); cv.width = 40; cv.height = 8; const tex = new THREE.CanvasTexture(cv); tex.magFilter = tex.minFilter = THREE.NearestFilter; tex.generateMipmaps = false;
      const bar = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true })); bar.scale.set(0.95, 0.095, 1);   // 2026-11-13: paski zycia o polowe ciensze
      bar.position.y = 2.05; bar.renderOrder = 20; sp.object3d.add(bar);
      a.bar = { cv, tex, sprite: bar }; M.actors.push(a); M.drawBar(a); return a;
    };
    M.mkActor = mkActor;
    M.drawBar = (a) => {
      const g = a.bar.cv.getContext('2d'); const ch = a.ch; g.clearRect(0, 0, 40, 8); g.fillStyle = '#000'; g.fillRect(0, 0, 40, 8);
      const p = Math.max(0, Math.min(1, ch.hp / ch.maxHp)); g.fillStyle = '#301010'; g.fillRect(1, 2, 38, 4);
      g.fillStyle = a.side === 'pc' ? (p > 0.5 ? '#6fd04a' : p > 0.25 ? '#f2a93b' : '#e0553f') : (p > 0.5 ? '#d9473a' : p > 0.25 ? '#e0803a' : '#f0c040'); g.fillRect(1, 2, Math.round(38 * p), 4);
      if (a.state === 'dead' || a.state === 'down') { g.fillStyle = '#fff'; g.font = '7px monospace'; g.fillText(a.state === 'dead' ? 'X' : '!', 17, 7); }
      a.bar.tex.needsUpdate = true; a.bar.sprite.visible = a.state !== 'dead';
    };
    // party at entry
    const living = st.party.filter(c => isAlive(c)).slice(0, 4);
    living.forEach((ch, i) => { const c = map.entry.cells[[5, 6, 9, 10][i] ?? i]; M.pcs.push(mkActor(ch, 'pc', c.x, c.y)); });
    M.selected = M.pcs[0];
    for (const a of M.pcs) { a.state = (isDown(a.ch) ? 'down' : 'up'); a.mapN = 0; if (a.state === 'down') { a.sprite.play('die'); M.drawBar(a); } }
    // enemies
    const ids = M.contract.enemies || [];
    let gi = 0; M.groups = [];
    for (const g of map.groups) {
      const grp = { idx: gi++, actors: [], alerted: false, nextNotice: 0, center: g.center };
      g.members.forEach((id, k) => {
        const ch = createEnemy(id); const cell = g.cells[k] || g.center; const a = mkActor(ch, 'enemy', cell.x, cell.y);
        a.group = grp; grp.actors.push(a); M.enemies.push(a); a.sprite.object3d.visible = false;
      });
      M.groups.push(grp);
    }
    // target for hunt/boss
    if (['hunt', 'boss'].includes(M.objType) && M.enemies.length) {
      M.target = M.enemies.find(a => (ENEMIES[a.ch.templateId]?.ai === 'boss') || /kostucha/i.test(a.ch.templateId)) || M.enemies.slice().sort((a, b) => (b.ch.level || 0) - (a.ch.level || 0))[0];
      if (M.target) { M.target.isTarget = true; }
    }
    // objective things
    const free = (x, y) => M.grid.free(x, y) && !M.actorAt(x, y);
    for (const cr of map.crates) { const o = G.createProp?.('crate', { seed: cr.x * 31 + cr.y }); if (o) { o.position.set(M.wx(cr.x), 0, M.wz(cr.y)); M.scene.add(o); } M.things.push({ kind: 'crate', x: cr.x, y: cr.y, done: false, obj: o, name: 'Skrzynia' }); }
    // finds: resources discovered while exploring (visible glints + hidden caches found with Perception)
    M.finds = (map.finds || []).map(f => ({ ...f, found: !f.hidden, taken: false, tried: false, obj: null }));
    M.makeFindObj = (f) => {
      const grp = new THREE.Group();
      const base = G.createProp?.(({ scrap: 'scrap_pile', cache: 'crate', medical: 'crate', tech: 'terminal', food: 'crate', ammo: 'crate' })[f.kind] || 'scrap_pile', { seed: f.x * 13 + f.y });
      if (base) { base.scale.setScalar(0.45); grp.add(base); }
      const col = ({ medical: 0xff5a5a, tech: 0x46f2c8, food: 0x9fe060, ammo: 0xf2c03b })[f.kind] || 0xffd040;
      const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.13), new THREE.MeshBasicMaterial({ color: col, fog: false }));
      gem.position.y = 0.9; grp.add(gem); grp.userData.gem = gem;
      grp.position.set(M.wx(f.x), 0, M.wz(f.y)); M.scene.add(grp); f.obj = grp; return grp;
    };
    for (const f of M.finds) if (f.found) M.makeFindObj(f);
    if (map.objCell && (M.objType === 'retrieve' || M.objType === 'rescue')) {
      const oc = map.objCell;
      if (M.objType === 'retrieve') {
        const itemId = M.contract.objective?.itemId; const nm = ITEMS[itemId]?.name || 'Cel zlecenia';
        const m = new THREE.Mesh(new THREE.OctahedronGeometry(0.28), new THREE.MeshBasicMaterial({ color: 0xffd040 })); m.position.set(M.wx(oc.x), 0.7, M.wz(oc.y)); M.scene.add(m);
        const th = { kind: 'item', x: oc.x, y: oc.y, done: false, obj: m, name: nm, itemId, spin: true }; M.things.push(th); M.itemThing = th;
      } else {
        const ch = { id: 'captive', name: 'Jeniec', classId: 'scavenger', ancestry: 'human', level: 1, maxHp: 10, hp: 10, conditions: {}, look: { body: 'light', skin: '#c9a27c', hair: '#4a3a2a', hairStyle: 1, cloth: '#7a6a50', accent: '#c0a030' } };
        const a = mkActor(ch, 'neutral', oc.x, oc.y); M.actors.splice(M.actors.indexOf(a), 1); a.sprite.object3d.visible = false; M.actors.push(a);
        const th = { kind: 'captive', x: oc.x, y: oc.y, done: false, actor: a, name: 'Jeniec' }; M.things.push(th); M.captive = th; M.neutral.push(a);
      }
    }
    // keep objective cell block free for pickup (items are walkable); captive occupies via actor
  },

  api() {
    const hud = M.hud, grid = M.grid, map = M.map;
    M.actorAt = (x, y) => M.actors.find(a => a.state !== 'dead' && a.side !== 'neutral' && a.x === x && a.y === y) || null;
    M.occupied = (x, y) => !!M.actorAt(x, y) || M.neutral.some(n => n.x === x && n.y === y && n.sprite.object3d.visible);
    M.thingAt = (x, y) => M.things.find(t => t.x === x && t.y === y && !t.done);
    M.log = (m, c) => hud.log(m, c);
    M.sfx = (n, o) => { try { Audio.sfx(n, o); } catch (e) {} };
    M.refreshAll = () => { hud.party_(); hud.initBar(); M.C.refreshBar?.(); M.hlDirty = true; };
    M.select = (a) => { if (!a || a.side !== 'pc') return; hud.sheet?.(a); if (M.mode === 'combat' && M.turn && M.turn.actor !== a) { if (!M.C?.switchTo?.(a)) M.focusActor(a); return; } M.selected = a; M.hlDirty = true; M.focusActor(a); M.refreshAll(); };
    M.toggleGroup = () => { M.group = !M.group; hud.setMode(M.group); M.toast(M.group ? 'Ruch: cała drużyna' : 'Ruch: jeden najemnik'); };
    M.toast = (m) => UI.toast(m);
    M.cycleSpeed = () => { M.speed = SPEEDS[(SPEEDS.indexOf(M.speed) + 1) % SPEEDS.length] || 1; try { localStorage.setItem('pir-speed', M.speed); } catch (e) {} hud.setSpeed(M.speed); };
    M.wait = (ms) => (M.speed >= 8 || M.fast) ? Promise.resolve() : sleep(ms / M.speed);
    M.tween = (dur, fn) => new Promise(res => { if (M.fast || M.speed >= 8 || dur <= 0) { fn(1); return res(); } const t0 = performance.now(); const d = dur / M.speed * 1000; const step = (now) => { if (M.dead) return res(); const t = Math.min(1, ((now ?? performance.now()) - t0) / d); fn(t); t < 1 ? requestAnimationFrame(step) : res(); }; requestAnimationFrame(step); });
    M.vec = (a, y = 1) => new THREE.Vector3(M.wx(a.px ?? a.x), y, M.wz(a.py ?? a.y));
    M.vecXY = (x, y, h = 0.5) => new THREE.Vector3(M.wx(x), h, M.wz(y));
    // floating texts above one actor are stacked (each new one within 0.6 s goes a row higher) so they never overlap
    M.float = (a, text, color = '#fff', y = 1.9) => {
      try {
        const now = performance.now(), f = a._fl || (a._fl = { t: -1e9, n: 0 });
        f.n = now - f.t < 600 ? f.n + 1 : 0; f.t = now;
        G.floatText(M.scene, text, M.vec(a, y + Math.min(f.n, 4) * 0.5), color);
      } catch (e) {}
    };
    M.face = (a, tx) => { const dx = tx - a.px, s = Math.cos(M.yaw); /* screen-right = (cos yaw, -sin yaw) */ };
    M.faceToward = (a, b) => { const dx = b.x - a.x, dz = b.y - a.y; const sx = dx * Math.cos(M.yaw) - dz * Math.sin(M.yaw); if (Math.abs(sx) > 0.01) a.sprite.setFacing?.(sx > 0 ? 1 : -1); };
    M.setPos = (a, x, y) => { a.px = x; a.py = y; a.sprite.object3d.position.set(M.wx(x), 0, M.wz(y)); };
    // 2026-11-13: continuous walking — constant speed (diagonals take longer), leftover frame time carries over to the
    // next tile so there is no stop-and-go at tile borders, and the camera glides with the walker instead of hopping.
    M.walk = async (a, path, cb) => {
      a.sprite.play('walk'); let carry = 0; const lead = a === M.selected || (M.turn && M.turn.actor === a); if (lead) M.follow = a;
      try {
        for (const st of path) {
          if (M.dead) return; M.faceToward(a, st); const fx = a.x, fy = a.y, diag = st.x !== fx && st.y !== fy;
          a.x = st.x; a.y = st.y; M.hlDirty = true; // occupancy moves immediately
          carry = await M.glide(0.165 * (diag ? 1.38 : 1), carry, (t) => { M.setPos(a, fx + (st.x - fx) * t, fy + (st.y - fy) * t); });
          M.sfx('step', { vol: 0.35 });
          if (a.side === 'pc') { M.updateVis(); }
          if (cb && (await cb(a)) === false) break;
          if (a.sprite.anim !== 'walk') a.sprite.play('walk');
        }
      } finally { if (M.follow === a) M.follow = null; }
      a.sprite.play('idle'); M.setPos(a, a.x, a.y);
    };
    /** Like tween, but starts `carry` seconds into the move and resolves with the time left over after it ended. */
    M.glide = (dur, carry, fn) => new Promise(res => {
      if (M.fast || M.speed >= 8 || dur <= 0) { fn(1); return res(0); }
      const d = dur / M.speed; let el = Math.min(carry, d * 0.9), last = performance.now();
      const step = (now) => { if (M.dead) return res(0); const n = now ?? performance.now(); el += Math.min(0.1, Math.max(0, (n - last) / 1000)); last = n; if (el >= d) { fn(1); return res(el - d); } fn(el / d); requestAnimationFrame(step); };
      fn(el / d); requestAnimationFrame(step);
    });
    // ----- visibility / fog
    M.updateVis = () => { M.visRev = (M.visRev || 0) + 1;
      const N = map.W * map.H; M.vis.fill(0);
      for (const a of M.pcs) { if (a.state === 'dead') continue; for (const i of grid.visible(a, 9)) { M.vis[i] = 1; M.explored[i] = 1; } }
      for (const n of M.neutral) if (n.following) for (const i of grid.visible(n, 5)) { M.vis[i] = 1; M.explored[i] = 1; }
      const d = M.fogData;
      for (let y = 0; y < map.H; y++) for (let x = 0; x < map.W; x++) { const i = y * map.W + x, row = (map.H - 1 - y) * map.W + x; const v = M.vis[i] ? 0 : M.explored[i] ? 120 : 235; d[row * 4] = 6; d[row * 4 + 1] = 5; d[row * 4 + 2] = 8; d[row * 4 + 3] = v; }
      M.fogTex.needsUpdate = true;
      for (const [k, objs] of M.cellObjs) for (const o of objs) o.visible = !!M.explored[k];
      for (const a of M.enemies) a.sprite.object3d.visible = a.state === 'dead' ? !!M.explored[a.y * map.W + a.x] && !!M.vis[a.y * map.W + a.x] : !!M.vis[a.y * map.W + a.x];
      for (const t of M.things) { if (t.obj) t.obj.visible = !!M.explored[t.y * map.W + t.x] && !t.done || (t.kind === 'crate' && !!M.explored[t.y * map.W + t.x]); }
      for (const n of M.neutral) n.sprite.object3d.visible = !!M.vis[n.y * map.W + n.x] || !!n.following;
      if (M.solidMesh) M.solidMesh.visible = true;
      M.hlDirty = true;
    };
    // ----- highlight canvas
    M.setHL = (o) => { Object.assign(M.HL, o); M.hlDirty = true; };
    /** Whose tile is marked: in combat the actor whose turn it is, in exploration the selected merc. */
    M.focusOf = () => M.mode === 'combat' ? (M.turn?.actor && M.turn.actor.state !== 'dead' ? M.turn.actor : null) : M.mode === 'explore' ? M.selected : null;
    // Ground overlay rule: ONLY movement tiles (+ the hovered destination / its path) and the tile under the active character.
    const MOVE_COL = { 1: ['rgba(70,140,255,.30)', 'rgba(140,190,255,.75)'], 2: ['rgba(240,200,50,.26)', 'rgba(255,225,90,.7)'], 3: ['rgba(240,120,40,.24)', 'rgba(255,150,70,.65)'], s: ['rgba(70,200,140,.32)', 'rgba(120,255,190,.75)'] };
    M.drawHL = () => {
      const g = M.hlCtx, T = 16, W = map.W; g.clearRect(0, 0, W * T, W * T);
      const tiles = M.HL.tiles || []; const set = new Map(tiles.map(t => [t.y * W + t.x, t.n]));
      // movement range: soft fill per action cost + an outline only where the cost band changes (readable zones)
      for (const t of tiles) {
        const [fill, edge] = MOVE_COL[t.n] || MOVE_COL[1]; g.fillStyle = fill; g.fillRect(t.x * T, t.y * T, T, T);
        g.fillStyle = edge;
        const n = (dx, dy) => set.get((t.y + dy) * W + t.x + dx);
        if (n(0, -1) !== t.n) g.fillRect(t.x * T, t.y * T, T, 1); if (n(0, 1) !== t.n) g.fillRect(t.x * T, t.y * T + T - 1, T, 1);
        if (n(-1, 0) !== t.n) g.fillRect(t.x * T, t.y * T, 1, T); if (n(1, 0) !== t.n) g.fillRect(t.x * T + T - 1, t.y * T, 1, T);
      }
      const d = M.HL.dest; if (d) { const [, edge] = MOVE_COL[set.get(d.y * W + d.x)] || MOVE_COL[1]; g.fillStyle = 'rgba(255,255,255,.22)'; g.fillRect(d.x * T, d.y * T, T, T); g.strokeStyle = edge; g.lineWidth = 2; g.strokeRect(d.x * T + 1, d.y * T + 1, T - 2, T - 2); }
      for (const t of M.HL.path || []) { g.fillStyle = 'rgba(0,0,0,.5)'; g.fillRect(t.x * T + 6, t.y * T + 7, 5, 5); g.fillStyle = 'rgba(255,255,255,.9)'; g.fillRect(t.x * T + 6, t.y * T + 6, 4, 4); }
      // the active / selected character's own tile: corner brackets (amber = party, red = enemy turn)
      const f = M.focusOf();
      if (f && f.sprite.object3d.visible !== false) {
        const col = f.side === 'pc' ? '#ffc040' : '#ff4a3a', x0 = f.x * T, y0 = f.y * T, L = 5;
        g.fillStyle = f.side === 'pc' ? 'rgba(255,190,60,.22)' : 'rgba(255,70,50,.2)'; g.fillRect(x0 + 1, y0 + 1, T - 2, T - 2);
        g.fillStyle = col;
        for (const [cx, cy, sx, sy] of [[x0, y0, 1, 1], [x0 + T - 1, y0, -1, 1], [x0, y0 + T - 1, 1, -1], [x0 + T - 1, y0 + T - 1, -1, -1]]) { g.fillRect(sx > 0 ? cx : cx - L + 1, cy, L, 1); g.fillRect(cx, sy > 0 ? cy : cy - L + 1, 1, L); g.fillRect(sx > 0 ? cx : cx - L + 1, cy + sy, L, 1); g.fillRect(cx + sx, sy > 0 ? cy : cy - L + 1, 1, L); }
      }
      // area aiming (grenades, suppressive fire): thin blast circle + centre cross, NOT tile fills
      const aim = M.HL.aim;
      if (aim) {
        const cx = aim.x * T + T / 2, cy = aim.y * T + T / 2, R = (aim.r + 0.45) * T;
        g.save(); g.lineWidth = 2; g.strokeStyle = aim.ok ? 'rgba(255,160,40,.95)' : 'rgba(170,170,170,.7)'; g.setLineDash(aim.ok ? [] : [4, 3]);
        g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.stroke();
        g.lineWidth = 1; g.strokeStyle = aim.ok ? 'rgba(255,210,120,.5)' : 'rgba(170,170,170,.35)'; g.beginPath(); g.arc(cx, cy, R - 3, 0, Math.PI * 2); g.stroke();
        g.setLineDash([]); g.fillStyle = aim.ok ? '#ffd27a' : '#aaa'; g.fillRect(cx - 4, cy - 0.5, 8, 1); g.fillRect(cx - 0.5, cy - 4, 1, 8); g.restore();
      }
      M.hlTex.needsUpdate = true;
      // selection ring under feet = same tile as the active character only
      for (const a of M.pcs) { const on = a === f; if (a._ring !== on) { a._ring = on; a.sprite.setSelected?.(on); } }
      // sprite outlines carry everything else (attackable foes, valid targets, blast victims, hovered target)
      const base = M.HL.outline || new Map(), hov = M.HL.hoverOutline || new Map();
      for (const a of M.actors) { const c = a.state === 'dead' ? null : (hov.get(a) || base.get(a) || null); if (a._ol !== c) { a._ol = c; a.sprite.setHighlight?.(c); } }
    };
    // ----- objective
    M.objDone = () => M.stage >= 1 || M.objType === 'eliminate' && false;
    M.refreshObjective = () => this.refreshObjective();
    M.interact = (a, th) => this.interact(a, th);
    M.moveParty = (x, y, opt) => this.moveParty(x, y, opt);
    // ----- exploration movement range: one action = Speed tiles; the whole party moves at the slowest member's Speed
    M.moveRange = () => { const sel = M.selected; if (!sel) return 0; const sp = (a) => M.C.speedOf(a); const ups = M.pcs.filter(p => p.state === 'up'); return M.group && ups.length ? Math.min(...ups.map(sp)) : sp(sel); };
    M.exploreReach = () => {
      const sel = M.selected; if (!sel || sel.state !== 'up') return null;
      const sp = M.moveRange(), passFn = (x, y) => { const a = M.actorAt(x, y); return !a || a.side === 'pc'; };
      return { res: M.grid.search(sel.x, sel.y, sp, passFn), sp };
    };
    M.updateExploreHL = () => {
      if (M.mode !== 'explore' || M.busy) { M.exReach = null; return; }
      const r = M.exReach = M.exploreReach(); const tiles = [];
      if (r) for (let i = 0; i < r.res.cost.length; i++) {
        const c = r.res.cost[i]; if (c <= 0 || c >= 1e9) continue; const x = i % map.W, y = (i / map.W) | 0;
        if (!M.explored[i] || M.thingAt(x, y)?.kind === 'crate') continue; const o = M.actorAt(x, y); if (o && (o.side !== 'pc' || !M.group)) continue;
        tiles.push({ x, y, n: 1 });
      }
      M.setHL({ tiles, path: [], dest: null });
    };
    M.finish = (r) => this.finish(r);
    M.retreat = async () => {
      if (M.busy && M.mode !== 'combat') return;
      const ok = await UI.modal({ title: 'Odwrót?', body: 'Wycofujecie się ze zlecenia. Nagroda za cel przepada, ale zachowujecie łupy i doświadczenie za pokonanych wrogów.', buttons: [{ label: 'Zostań', value: false }, { label: 'Odwrót', value: true, class: 'danger' }] });
      if (ok) M.finish('retreat');
    };
    M.updateTimers = null;
  },

  refreshObjective() {
    const c = M.contract, t = M.objType, h = M.hud, alive = M.enemies.filter(a => a.state !== 'dead').length, tot = M.enemies.length;
    const L = [];
    if (t === 'eliminate') L.push({ text: `Wyeliminuj wszystkich wrogów (${tot - alive}/${tot})`, done: alive === 0 });
    else if (t === 'hunt' || t === 'boss') { L.push({ text: `Zabij cel: ${M.target?.ch.name || 'cel'}`, done: M.target?.state === 'dead' }); L.push({ text: `Eskorta wrogów: ${alive}`, done: false, cls: 'dim' }); }
    else if (t === 'retrieve') { L.push({ text: `Odzyskaj: ${M.itemThing?.name || 'cel'}`, done: M.stage >= 1 }); L.push({ text: 'Wróć do strefy ewakuacji (zielone słupki)', done: false, go: M.stage >= 1 }); }
    else if (t === 'rescue') { L.push({ text: 'Znajdź i uwolnij jeńca', done: M.stage >= 1 }); L.push({ text: 'Doprowadź go do strefy ewakuacji (zielone słupki)', done: false, go: M.stage >= 1 }); }
    L.push({ text: `Skrzynie: ${M.things.filter(x => x.kind === 'crate' && x.done).length}/${M.things.filter(x => x.kind === 'crate').length}`, done: false, cls: 'dim' });
    h.objective(c.title || 'Zlecenie', L);
  },

  // ---------- exploration movement
  async moveParty(tx, ty, opt = {}) {
    if (M.busy || M.mode !== 'explore') return;
    const sel = M.selected; if (!sel || sel.state !== 'up') return;
    const grid = M.grid;
    const passFn = (x, y) => { const a = M.actorAt(x, y); return !a || a.side === 'pc'; };
    const dest = this.nearestFree(tx, ty, sel);
    if (!dest) return;
    M.busy = true; M.setHL({ tiles: [], path: [], dest: null, aim: null, hoverOutline: new Map() }); M.hud.showInfo(null);
    try {
      const solo = !M.group || opt.solo;
      const res = grid.search(sel.x, sel.y, 80, passFn); let path = grid.pathFrom(res, dest.x, dest.y);
      if (!path || !path.length) { M.toast('Nie da się tam dojść.'); return; }
      // one click = one move action: the path is cut at the movement range (slowest member in party mode)
      const full = path.length; path = this.clipPath(path, sel, M.moveRange(), solo);
      if (!path.length) { M.toast('Brak wolnego pola w zasięgu ruchu.'); return; }
      if (path.length < full) { const e = path[path.length - 1]; dest.x = e.x; dest.y = e.y; }
      const movers = solo ? [] : M.pcs.filter(p => p !== sel && p.state === 'up');
      // formation cells around destination
      const taken = new Set([dest.y * map_W() + dest.x]); const dests = new Map();
      for (const p of movers) { const c = this.nearestFree(dest.x, dest.y, p, taken); if (c) { taken.add(c.y * map_W() + c.x); dests.set(p, c); } }
      const follow = Promise.all(movers.map(async (p, i) => {
        await M.wait(90 * (i + 1)); const c = dests.get(p); if (!c) return; const r = grid.search(p.x, p.y, 80, passFn); const pp = grid.pathFrom(r, c.x, c.y); if (pp) await M.walk(p, pp, () => M.mode === 'explore');
      }));
      await M.walk(sel, path, async () => { M.steps++; M.focus(sel.x, sel.y); this.checkFinds(); const sp = this.checkSpotting(); if (sp) return false; return true; });
      await follow;
      if (M.mode === 'explore') { this.checkFinds(); this.checkSpotting(true); await this.followNeutral(); }
    } finally { M.busy = false; M.updateVis(); M.refreshAll(); }
    if (M.mode === 'explore') this.checkExtraction();
  },
  /** Exploration finds: Perception (secret, best merc nearby) reveals hidden ones within 2 tiles; a merc next to a revealed find picks it up. */
  checkFinds() {
    if (!M || M.mode !== 'explore' || !M.finds) return;
    const pcs = M.pcs.filter(p => p.state === 'up'); if (!pcs.length) return;
    const lvl = M.contract.level || 1, dc = dcForLevel(lvl);
    for (const f of M.finds) {
      if (f.taken) continue;
      const near = pcs.filter(p => cheb(p, f) <= 2); if (!near.length) continue;
      if (!f.found) {
        if (f.tried) continue; f.tried = true;
        const best = near.slice().sort((a, b) => getStat(b.ch, 'perception') - getStat(a.ch, 'perception'))[0];
        const r = check(getStat(best.ch, 'perception'), dc);
        if (r.degree >= 2) { f.found = true; M.makeFindObj(f); M.float(best, '!', '#ffd040'); M.sfx('pickup'); M.log(`${best.ch.name} dostrzega coś w gruzach (Percepcja ${r.total} vs KT ${dc}).`, 'amber'); }
        continue;
      }
      const taker = pcs.find(p => cheb(p, f) <= 1); if (!taker) continue;
      f.taken = true; if (f.obj) f.obj.visible = false;
      const lootOf = { scrap: [], cache: ['@any'], medical: ['bandage', 'stimpak', 'medkit'], tech: ['circuit', 'battery', 'memory_card', 'radio_part', 'vacuum_tube'], food: ['canned_food'], ammo: ['ammo_box'] }[f.kind] || [];
      const scrap = Math.round((f.kind === 'scrap' ? 10 : f.kind === 'cache' ? 6 : 2) + Math.random() * 8 * (1 + lvl * 0.4));
      M.scrap += scrap; const got = [`${scrap} Złomu`];
      if (lootOf.length) {
        let id = lootOf[Math.floor(Math.random() * lootOf.length)];
        if (id === '@any') { const pool = Object.values(ITEMS).filter(i => i && ['consumable', 'tech', 'junk'].includes(i.type) && (i.level || 0) <= lvl + 1); id = pool.length ? pool[Math.floor(Math.random() * pool.length)].id : 'scrap_metal'; }
        if (ITEMS[id]) { M.loot.push(newItem(id)); got.push(ITEMS[id].name); }
      }
      const NAMES = { scrap: 'stertę złomu', cache: 'ukrytą skrytkę', medical: 'porzuconą apteczkę', tech: 'resztki elektroniki', food: 'zapasy jedzenia', ammo: 'skrzynkę amunicji' };
      M.sfx('coin'); M.float(taker, '+' + scrap + ' Złomu', '#ffd040');
      M.log(`${taker.ch.name} znajduje ${NAMES[f.kind] || 'coś cennego'}: ${got.join(', ')}.`, 'good');
    }
  },
  /** Cut a path at `max` movement cost (1 per tile, 1.5 per diagonal); the end tile must be free to stand on. */
  clipPath(path, from, max, solo) {
    let c = 0, px = from.x, py = from.y, n = 0;
    for (const st of path) { c += (st.x !== px && st.y !== py) ? 1.5 : 1; if (c > max + 1e-6) break; n++; px = st.x; py = st.y; }
    const ok = (t) => { const o = M.actorAt(t.x, t.y); return (!o || o === from || (o.side === 'pc' && !solo)) && M.thingAt(t.x, t.y)?.kind !== 'crate' && !M.neutral.some(q => q.x === t.x && q.y === t.y); };
    while (n > 0 && !ok(path[n - 1])) n--;
    return path.slice(0, n);
  },
  nearestFree(tx, ty, who, taken) {
    const grid = M.grid; let best = null, bd = 1e9;
    for (let y = ty - 4; y <= ty + 4; y++) for (let x = tx - 4; x <= tx + 4; x++) {
      if (!grid.free(x, y) || (taken && taken.has(y * map_W() + x))) continue; const a = M.actorAt(x, y); if ((a && a !== who) || M.thingAt(x, y)?.kind === 'crate') continue;
      if (M.neutral.some(n => n.x === x && n.y === y)) continue;
      const d = Math.hypot(x - tx, y - ty) + (M.thingAt(x, y) ? 0.2 : 0); if (d < bd) { bd = d; best = { x, y }; }
    } return best;
  },
  async followNeutral() {
    const cap = M.captive; if (!cap || !cap.freed) return; const n = cap.actor, lead = M.selected; if (!n || !lead) return;
    const c = this.nearestFree(lead.x, lead.y, n, new Set(M.pcs.map(p => p.y * map_W() + p.x)));
    if (!c) return; const r = M.grid.search(n.x, n.y, 60, () => true); const p = M.grid.pathFrom(r, c.x, c.y); if (p) await M.walk(n, p);
  },
  // enemy groups noticing the party
  checkSpotting(final) {
    if (M.mode !== 'explore') return false;
    for (const g of M.groups) {
      if (g.alerted) continue; const alive = g.actors.filter(a => a.state !== 'dead'); if (!alive.length) continue;
      let seer = null, seen = null, close = false;
      for (const e of alive) for (const p of M.pcs) {
        if (p.state !== 'up') continue; const d = dist(e, p); if (d > 11) continue; if (!M.grid.los(e, p).clear) continue;
        if (d <= 3.2) { close = true; seer = e; seen = p; break; }
        if (!seer || d < dist(seer, seen)) { seer = e; seen = p; }
      }
      if (!seer) continue;
      if (!close) {
        if (M.steps < g.nextNotice) continue; g.nextNotice = M.steps + 3;
        const best = alive.reduce((m, e) => Math.max(m, getStat(e.ch, 'perception')), -9);
        const dc = 10 + Math.max(...M.pcs.filter(p => p.state === 'up').map(p => getStat(p.ch, 'stealth')));
        const r = check(best, dc);
        M.log(`${seer.ch.name} wypatruje czegoś (Percepcja ${r.total} vs Skradanie ${dc}): ${r.degree >= 2 ? 'ZAUWAŻA!' : 'nic nie widzi.'}`, r.degree >= 2 ? 'bad' : 'dim');
        if (r.degree < 2) continue;
      } else M.log(`${seer.ch.name} jest tuż obok — wykrywa drużynę!`, 'bad');
      M.C.startCombat(g); return true;
    }
    return false;
  },
  checkExtraction() {
    if (M.mode !== 'explore' || !M.objDone() || M.busy) return;
    const up = M.pcs.filter(p => p.state === 'up'); if (!up.length) return;
    const inside = up.every(p => M.extractAt(p.x, p.y)) && M.pcs.filter(p => p.state === 'down').every(p => M.extractAt(p.x, p.y) || true);
    const capOk = !M.captive || !M.captive.freed || M.extractAt(M.captive.actor.x, M.captive.actor.y);
    if (inside && capOk) { if (M.extractAsked) return; M.extractAsked = true; this.askExtract(); } else M.extractAsked = false;
  },
  async askExtract() {
    M.busy = true;
    const ok = await UI.modal({ title: 'Strefa ewakuacji', body: 'Cel zlecenia wykonany, drużyna jest w strefie ewakuacji. Opuścić teren?', buttons: [{ label: 'Jeszcze nie', value: false }, { label: 'Ewakuacja', value: true, class: 'primary' }] });
    M.busy = false; if (ok) this.finish('success');
  },

  // ---------- interactions
  async interactAt(th) {
    if (M.busy) return;
    const a = M.selected; if (!a || a.state !== 'up') return;
    if (M.mode === 'combat') return M.C.playerInteract(th);
    M.busy = true;
    try {
      if (cheb(a, th) > 1) {
        const passFn = (x, y) => { const o = M.actorAt(x, y); return !o || o.side === 'pc'; };
        const res = M.grid.search(a.x, a.y, 80, passFn); let best = null, bc = 1e9;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const x = th.x + dx, y = th.y + dy; if (!M.grid.free(x, y) || M.actorAt(x, y) && M.actorAt(x, y) !== a) continue; const c = res.cost[y * M.map.W + x]; if (c < bc) { bc = c; best = { x, y }; } }
        if (!best) { M.toast('Nie można dojść.'); return; }
        let path = M.grid.pathFrom(res, best.x, best.y); const full = path ? path.length : 0;
        if (path && path.length) { path = this.clipPath(path, a, M.moveRange(), true); M.setHL({ tiles: [], path: [], dest: null }); if (path.length) await M.walk(a, path, async () => { M.steps++; return !this.checkSpotting(); }); }
        M.updateVis();
        if (M.mode !== 'explore') return;
        if (path && path.length < full) { M.toast('Za daleko na jeden ruch — podejdź bliżej.'); return; }
      }
      await this.interact(a, th);
      await this.followNeutral();
    } finally { M.busy = false; M.refreshAll(); }
    if (M.mode === 'explore') this.checkExtraction();
  },
  async interact(a, th) {
    if (th.done) return false;
    M.faceToward(a, th);
    if (th.kind === 'item') {
      th.done = true; M.stage = Math.max(M.stage, 1); if (th.obj) th.obj.visible = false;
      const it = newItem(th.itemId || 'scrap_metal'); M.loot.push(it); M.sfx('pickup'); M.float(a, 'Zdobyto!', '#ffd040');
      M.log(`${a.ch.name} zabiera: ${th.name}. Czas wracać do strefy ewakuacji!`, 'good'); M.hud.banner('CEL ZDOBYTY', 'var(--amber)', 'Wróć do strefy ewakuacji'); this.refreshObjective(); M.hlDirty = true; return true;
    }
    if (th.kind === 'captive') {
      th.done = true; th.freed = true; th.actor.following = true; M.stage = Math.max(M.stage, 1); M.sfx('door'); M.float(th.actor, 'Wolny!', '#7fc46a');
      M.log(`${a.ch.name} uwalnia jeńca. Trzeba go wyprowadzić do strefy ewakuacji.`, 'good'); M.hud.banner('JENIEC UWOLNIONY', 'var(--good)', 'Wyprowadź go do strefy ewakuacji'); this.refreshObjective(); M.updateVis(); return true;
    }
    if (th.kind === 'crate') return this.openCrate(a, th);
    return false;
  },
  async openCrate(a, th) {
    const dcBase = dcForLevel(M.contract.level || 1);
    const opts = [['thievery', 'Złodziejstwo'], ['crafting', 'Technika'], ['athletics', 'Atletyka']];
    const dc = dcBase + 1;
    const pick = await UI.modal({ title: 'Zamknięta skrzynia', body: `<div>${a.ch.name} przygląda się zamkowi. Jak go otworzyć? (KT ${dc})</div>`, buttons: [...opts.map(([id, nm]) => { const m = getStat(a.ch, id); return { label: `${SKILLS[id]?.name || nm} ${m >= 0 ? '+' : ''}${m}`, value: id }; }), { label: 'Zostaw', value: null }] });
    if (!pick) return false;
    th.done = true; if (M.mode === 'combat') {}
    const r = skillCheck(a.ch, pick, dc);
    await this.dice(r, `${SKILLS[pick]?.name || pick}`, a.side === 'pc');
    M.log(`${a.ch.name}: ${SKILLS[pick]?.name || pick} ${r.total} vs KT ${dc} — ${['KRYTYCZNA PORAŻKA', 'porażka', 'sukces', 'KRYTYCZNY SUKCES'][r.degree]}`, r.degree >= 2 ? 'good' : 'bad');
    if (r.degree === 0) { const dmg = roll('1d6').total; applyDamage(a.ch, dmg); M.sfx('explosion'); M.float(a, '-' + dmg, '#e0553f'); M.log(`Pułapka! ${a.ch.name} traci ${dmg} PW.`, 'bad'); M.C.syncAll(); M.hud.party_(); th.obj && (th.obj.visible = true); return true; }
    if (r.degree === 1) { M.log('Zamek się nie poddaje — skrzynia pozostaje zamknięta.', 'dim'); th.done = false; th.tries = (th.tries || 0) + 1; if (th.tries >= 2) th.done = true; return true; }
    M.sfx('pickup'); const n = r.degree === 3 ? 2 : 1; const lvl = M.contract.level || 1;
    const scrap = Math.round((8 + Math.random() * 14) * (1 + lvl * 0.5) * (r.degree === 3 ? 1.5 : 1)); M.scrap += scrap; M.log(`Znaleziono ${scrap} Złomu.`, 'amber');
    const pool = Object.values(ITEMS).filter(i => i && ['consumable', 'junk', 'tech', 'ammo'].includes(i.type) && (i.level || 0) <= lvl + 1);
    for (let i = 0; i < n && pool.length; i++) { const it = pool[Math.floor(Math.random() * pool.length)]; M.loot.push(newItem(it.id)); M.log(`Łup: ${it.name}.`, 'good'); }
    if (th.obj) th.obj.rotation.z = 0.2; M.float(a, 'Łup!', '#ffd040'); M.refreshObjective(); return true;
  },
  async dice(r, label, mine = true) {
    if (!r || M.fast || M.speed >= 4) return; if (!mine && M.speed >= 2) return;
    try { await G.showD20Roll({ ...r, label }); } catch (e) {}
  },

  // ---------- finishing
  finish(result) {
    if (!M || M.mode === 'over') return; M.mode = 'over'; M.C.active = false; M.C.stop?.();
    const st = Game.state; const casualties = M.pcs.filter(a => !isAlive(a.ch)).map(a => a.ch.name);
    const plvl = partyLevel(M.pcs.map(a => a.ch));
    let xp = 0; try { xp = encounterXP(plvl, M.killed) || 0; } catch (e) { xp = 0; }
    // enemy loot
    for (const ch of M.killed) { try { const lo = R.rollLoot(ch); M.loot.push(...(lo.items || [])); M.scrap += lo.scrap || 0; } catch (e) {} }
    for (const a of M.pcs) { if (a.ch.stolenScrap) { M.scrap += a.ch.stolenScrap; a.ch.stolenScrap = 0; } try { if (result !== 'lose') R.endEncounter?.(a.ch); } catch (e) {} }
    const payload = { contract: M.contract, result: result === 'lose' ? 'fail' : result, xp, loot: M.loot.slice(), scrap: M.scrap, casualties };
    const wipe = result === 'lose'; const c = M.contract;
    M.hud.banner(wipe ? 'DRUŻYNA POLEGŁA' : result === 'retreat' ? 'ODWRÓT' : 'ZLECENIE WYKONANE', wipe ? 'var(--blood)' : result === 'retreat' ? 'var(--amber)' : 'var(--good)');
    try { Audio.music(wipe ? 'defeat' : result === 'success' ? 'victory' : null); } catch (e) {}
    const done = () => { if (wipe) Game.goto('gameover', payload); else Game.goto('debrief', payload); };
    M.payload = payload;
    if (M.fast) done(); else setTimeout(() => { if (M && M.mode === 'over') done(); }, 2200);
  },

  // ---------- frame / input
  update(dt, time) {
    if (!M || M.dead) return; M.time += dt;
    const k = M.keys, pan = 9 * dt / M.zoom;
    let fx = 0, fz = 0; if (k.has('w') || k.has('arrowup')) fz -= 1; if (k.has('s') || k.has('arrowdown')) fz += 1; if (k.has('a') || k.has('arrowleft')) fx -= 1; if (k.has('d') || k.has('arrowright')) fx += 1;
    if (fx || fz) { const s = Math.sin(M.yaw), c = Math.cos(M.yaw); M.targetT.x += (fx * c + fz * s) * pan; M.targetT.z += (-fx * s + fz * c) * pan; }
    const lim = MAP_W / 2; M.targetT.x = Math.max(-lim, Math.min(lim, M.targetT.x)); M.targetT.z = Math.max(-lim, Math.min(lim, M.targetT.z));
    if (M.follow && M.follow.px != null) M.targetT.set(M.wx(M.follow.px), 0, M.wz(M.follow.py));
    const l = 1 - Math.pow(0.0005, dt); M.camT.lerp(M.targetT, l);
    let dy = M.yawT - M.yaw; M.yaw += dy * l; M.zoom += (M.zoomT - M.zoom) * l; M.applyCam();
    for (const a of M.actors) a.sprite.update?.(dt);
    for (const f of M.finds || []) if (f.obj) { f.obj.visible = !f.taken && !!M.explored[f.y * M.map.W + f.x]; const g = f.obj.userData.gem; if (g) { g.rotation.y += dt * 2.5; g.position.y = 0.85 + Math.sin(M.time * 3 + f.x) * 0.1; } }
    for (const t of M.things) if (t.spin && t.obj) { t.obj.rotation.y += dt * 2; t.obj.position.y = 0.7 + Math.sin(M.time * 3) * 0.1; }
    M.atmo?.update?.(dt); try { G.updateEffects(dt); } catch (e) {}
    if (M.extract) {
      const done = M.objDone() && M.mode !== 'over', bc = M.extract.beacon; if (bc) { bc.visible = done; if (done) { bc.userData.sign.position.y = 3.2 + Math.sin(M.time * 3) * 0.15; } }
      const k = done ? 0.6 + 0.4 * Math.sin(M.time * 5) : 0.55; M.extract.capMat.color.setRGB(0.62 * k + 0.1, 1 * k, 0.54 * k + 0.05);
      M.extract.postMat.color.setHex(done ? 0x5fe86a : 0x3fae4a);
    }
    { const sl = M.selected, key = M.mode + '|' + (M.busy ? 1 : 0) + '|' + (M.group ? 1 : 0) + '|' + (sl ? sl.ch.id + ':' + sl.x + ',' + sl.y + ':' + sl.state : '') + '|' + (M.visRev || 0);
      if (key !== M._exKey) { const was = (M._exKey || '').startsWith('explore|0'); M._exKey = key; if (M.mode === 'explore') M.updateExploreHL(); else if (was) M.exReach = null; } }
    if (M.hlDirty) { M.hlDirty = false; M.drawHL(); }
  },
  pick(ndc) {
    const cam = this.camera; let best = null, bd = 0.06;
    const v = new THREE.Vector3();
    for (const a of M.actors) { if (!a.sprite.object3d.visible || a.state === 'dead' || a.side === 'neutral') continue; v.set(M.wx(a.px), 0.9, M.wz(a.py)).project(cam); const d = Math.hypot((v.x - ndc.x) * 16 / 9 * 0.8, v.y - ndc.y); if (d < bd) { bd = d; best = a; } }
    const ray = new THREE.Raycaster(); ray.setFromCamera(ndc, cam); const p = new THREE.Vector3(); const hit = ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), p);
    let tile = null; if (hit) { const x = Math.floor(p.x + MAP_W / 2), y = Math.floor(p.z + MAP_H / 2); if (M.grid.inb(x, y)) tile = { x, y }; }
    if (best) tile = { x: best.x, y: best.y };
    return { tile, actor: best };
  },
  onPointerDown(ev) { if (!M) return; M.down = { x: ev.clientX, y: ev.clientY, btn: ev.button, moved: false, lx: ev.clientX, ly: ev.clientY }; },
  onPointerMove(ev, ndc) {
    if (!M) return;
    if (M.down && (M.down.btn === 2 || M.down.btn === 1)) {
      const dx = ev.clientX - M.down.lx, dy = ev.clientY - M.down.ly; M.down.lx = ev.clientX; M.down.ly = ev.clientY; M.down.moved = true;
      const w = Engine.canvas.getBoundingClientRect().width, vw = 8.5 / M.zoom * 16 / 9, s = vw / w;
      const sy = Math.sin(M.yaw), cy = Math.cos(M.yaw);
      const rx = -dx * s, rz = -dy * s / Math.sin(M.pitch);
      M.targetT.x += rx * cy + rz * sy * 1; M.targetT.z += -rx * sy + rz * cy; M.camT.copy(M.targetT); return;
    }
    if (M.down && M.down.btn === 0 && Math.hypot(ev.clientX - M.down.x, ev.clientY - M.down.y) > 5) M.down.moved = true;
    const h = this.pick(ndc); M.hover = h; M.C?.onHover?.(h);
    if (M.mode === 'explore' && !M.busy && M.exReach) {
      const t = h.tile, r = M.exReach, c = t ? r.res.cost[t.y * M.map.W + t.x] : 1e9;
      if (t && c > 0 && c < 1e9 && (M.HL.tiles || []).some(q => q.x === t.x && q.y === t.y)) { M.setHL({ path: M.grid.pathFrom(r.res, t.x, t.y) || [], dest: t }); M.hud.showInfo(`<b>Ruch</b> <span class="dim">— ${Math.ceil(c)} / ${r.sp} pól${M.group ? ' (drużyna: najwolniejszy)' : ''}</span>`); }
      else if (M.HL.dest) M.setHL({ path: [], dest: null });
    }
  },
  onPointerUp(ev, ndc) {
    if (!M || !M.down) return; const d = M.down; M.down = null;
    if (d.btn === 2) { if (!d.moved) M.C.cancelMode?.(); return; }
    if (d.btn !== 0 || d.moved || M.mode === 'over') return;
    const h = this.pick(ndc); this.click(h);
  },
  click(h) {
    if (!M || M.busy && M.mode !== 'combat') return;
    const { tile, actor } = h; if (!tile) return;
    if (M.mode === 'combat') return M.C.playerClick(tile, actor);
    if (actor && actor.side === 'pc') return M.select(actor);
    const th = M.thingAt(tile.x, tile.y); if (th && M.explored[tile.y * M.map.W + tile.x]) return this.interactAt(th);
    if (actor && actor.side === 'enemy') { M.toast(`${actor.ch.name}: poz. ${actor.ch.level || 1}. Podejdź, by zaatakować.`); }
    if (!M.explored[tile.y * M.map.W + tile.x]) { M.toast('Nieodkryty teren.'); }
    this.moveParty(tile.x, tile.y);
  },
  onWheel(ev) { if (!M) return; M.zoomBy(ev.deltaY < 0 ? 1.15 : 1 / 1.15); },
  onKey(ev) {
    if (!M) return; const k = ev.key.toLowerCase();
    if (ev.type === 'keydown') {
      if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) { M.keys.add(k); ev.preventDefault?.(); if (!M.keyUpBound) { M.keyUpBound = true; const up = (e) => M?.keys?.delete(e.key.toLowerCase()); window.addEventListener('keyup', up); M.listeners.push([window, 'keyup', up]); } }
      if (k === 'q') M.yawT += Math.PI / 2; if (k === 'e') M.yawT -= Math.PI / 2;
      if (k === '+' || k === '=') M.zoomBy(1.25); if (k === '-' || k === '_') M.zoomBy(1 / 1.25); if (k === '0') M.zoomT = 1;
      if (k === 'h') M.hud.help(); if (k === 'f') M.cycleSpeed(); if (k === 'g') M.toggleGroup();
      if (k === 'tab') { ev.preventDefault?.(); const n = M.pcs.filter(p => p.state !== 'dead'); const i = n.indexOf(M.selected); if (M.mode === 'combat') M.C.focusNext?.(); else M.select(n[(i + 1) % n.length]); }
      if (k === ' ') { ev.preventDefault?.(); if (M.mode === 'combat') M.C.endPlayerTurn(); else M.focusActor(M.selected); }
      if (k === 'escape') M.C.cancelMode?.();
      if (/^[1-9]$/.test(k)) M.C.hotkey?.(+k - 1);
    }
  },
};
const map_W = () => MAP_W;
export default scene;
