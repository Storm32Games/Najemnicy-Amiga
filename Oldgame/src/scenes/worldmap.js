// World map: stylized 3D region, contract markers, animated party travel, random skill-check events.
import { THREE, UI, Audio, R, GFX, disposeObj, rngSeed, particles, sprite, atmosphere, fadeLayer, className, itemName, stat, signed, skillName, partyLevel, addToStash, pick, clamp, itemTip, iconOf } from './meta/common.js';
import { Game } from '../core/game.js';
import { Engine } from '../core/engine.js';
import { shortName } from '../data/names.js';
import { EVENTS } from '../data/events.js';
import { HOME, ZONES, SECTORS, GATE, CITY, inCity, cityRoute, hgt, buildWorld } from './meta/worldterrain.js';
import { rollItem, DIFFICULTY, TYPE_NAMES, BIOME_NAMES, FACTION_NAMES } from '../data/contracts.js';

let M = null;
const COLORS = { eliminate: 0xc43d2f, retrieve: 0x7fc46a, rescue: 0x4aa8ff, hunt: 0xf2a93b, boss: 0xff30ff };
const world = (v, y = 0) => new THREE.Vector3(v.x, hgt(v.x, v.y ?? v.z) + y, v.y ?? v.z);

export default {
  scene: null, camera: null,
  enter(params = {}) {
    const st = Game.state; if (!st.party.length) Game.quickParty?.();
    let c = params.contract; if (typeof c === 'string') c = st.contracts.find(k => k.id === c); if (!c && params.contract) c = null;
    M = { t: 0, sel: c || null, travel: null, labels: [], contracts: st.contracts, force: params.event, state: 'idle', sps: [], view: { x: -1.5, z: 1.5, zoom: 1.14 }, keys: new Set(), drag: null };
    const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(46, 16 / 9, 0.1, 200); this.scene = scene; this.camera = cam;
    M.atmo = atmosphere(scene, 'dusk');
    M.world = buildWorld(scene);   // 2026-11-12: pelny krajobraz regionu (worldterrain.js)
    M.labels.push({ pos: world(HOME, 2.6), text: 'PRZYSTAŃ', cls: 'amber', kind: 'home' });
    for (const sc of SECTORS) M.labels.push({ pos: world(new THREE.Vector2(sc.label[0], sc.label[1]), 0.4), text: sc.name, sub: sc.sub, kind: 'sector', color: '#' + sc.color.toString(16).padStart(6, '0') });
    // contract markers + roads
    const boxMat = (c) => new THREE.MeshLambertMaterial({ color: c, flatShading: true });
    M.pts = {}; const used = {};
    st.contracts.forEach((k, i) => {
      const z = ZONES[k.biome] || ZONES.ruins, n = (used[k.biome] = (used[k.biome] || 0) + 1);
      // fixed open spots per sector (city plazas etc.); the story contract takes the first one; fallback: spiral
      const sec = SECTORS.find(q => q.id === k.biome) || SECTORS[0], spot = sec.spots[n - 1];
      const placed = Object.values(M.pts); let v = spot ? new THREE.Vector2(spot[0], spot[1]) : null;
      for (let t = 0; t < 60 && !v; t++) {
        const a = n * 2.4 + i + t * 0.9, rr = 3 + t * 0.35;
        const c = new THREE.Vector2(clamp(z[0] + Math.cos(a) * rr, -26, 30), clamp(z[1] + Math.sin(a) * rr * 0.75, -15, 15));
        if (placed.every(o => Math.abs(o.x - c.x) > 5 || Math.abs(o.y - c.y) > 3)) v = c;
      }
      v ||= new THREE.Vector2(z[0], z[1] + i * 2.8); M.pts[k.id] = v;
      // marker: tall pole + big flag + light column + a floating diamond that is drawn over buildings (always visible)
      const col = COLORS[k.type] || 0xffffff, top = { depthTest: false, depthWrite: false, fog: false, transparent: true };
      const m = new THREE.Group(), pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 3.2, 4), boxMat(0x1c1c1c)); pole.position.y = 1.6; m.add(pole);
      const fl = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.8, 0.06), new THREE.MeshBasicMaterial({ color: col, fog: false })); fl.position.set(0.65, 2.75, 0); m.add(fl);
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 7, 6, 1, true), new THREE.MeshBasicMaterial({ color: col, opacity: 0.22, side: THREE.DoubleSide, ...top })); beam.position.y = 3.5; beam.renderOrder = 30; m.add(beam);
      const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.42, 0), new THREE.MeshBasicMaterial({ color: col, opacity: 0.95, ...top })); gem.position.y = 4.3; gem.renderOrder = 31; m.add(gem); m.userData.gem = gem;
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.85, 0.08, 4, 20), new THREE.MeshBasicMaterial({ color: k.story ? 0xff30ff : 0xf2a93b, fog: false })); ring.rotation.x = Math.PI / 2; ring.position.y = 0.14; m.add(ring); m.userData.ring = ring;
      m.position.copy(world(v)); scene.add(m); (M.mk ||= {})[k.id] = m;
      M.labels.push({ pos: world(v, 5.1), text: (k.story ? '★ ' : '') + k.title, sub: `${TYPE_NAMES[k.type] || k.type} · poz. ${k.level}`, kind: 'contract', color: '#' + col.toString(16).padStart(6, '0'), id: k.id });
      this.road(scene, v, i);
    });
    try { this.spawnFauna(scene); } catch (e) { console.warn('fauna', e); }
    M.dust = particles(100, { box: [48, 5, 30], center: [0, 0, 0], color: 0xf0c080, size: 1.5, vel: [1.4, 0.05, 0.2], seed: 4, opacity: 0.35 }); scene.add(M.dust);
    // party marker
    const lead = st.party.find(c => R.isAlive(c)) || st.party[0]; M.sp = sprite(lead, 1.4); M.sp.object3d.position.copy(world(HOME, 0)).add(new THREE.Vector3(1.6, 0, 0.8)); scene.add(M.sp.object3d); M.sp.play('idle');
    cam.position.set(M.view.x, 35, M.view.z + 24); cam.lookAt(M.view.x, 0, M.view.z); M.camGoal = new THREE.Vector3(); M.look = new THREE.Vector3(M.view.x, 0, M.view.z);
    // DOM
    M.labelBox = UI.add(UI.el('div', { class: 'passthru', style: 'position:absolute;inset:0;pointer-events:none!important' }));
    const SH = 'text-shadow:1px 1px 0 #000,-1px -1px 0 #000,1px -1px 0 #000,-1px 1px 0 #000;white-space:nowrap;';
    M.labels.forEach(l => {
      if (l.kind === 'sector') l.el = UI.el('div', { style: `position:absolute;transform:translate(-50%,-50%);text-align:center;letter-spacing:.3em;font-size:1.05em;font-weight:bold;color:${l.color};opacity:.9;${SH}` }, l.text, UI.el('div', { style: 'font-size:.62em;letter-spacing:.12em;font-weight:normal;color:#c9b890' }, l.sub));
      else if (l.kind === 'contract') l.el = UI.el('div', { style: `position:absolute;transform:translate(-50%,-100%);background:#14100ce6;border:2px solid ${l.color};border-left-width:.5em;padding:.18em .55em .22em;font-size:.82em;line-height:1.25;white-space:nowrap;box-shadow:2px 2px 0 #000a` }, UI.el('b', {}, l.text), UI.el('div', { style: 'font-size:.82em;color:#b8a888' }, l.sub));
      else l.el = UI.el('div', { style: `position:absolute;transform:translate(-50%,-100%);font-size:.95em;font-weight:bold;letter-spacing:.15em;${SH}`, class: l.cls || '' }, l.text);
      M.labelBox.append(l.el);
    });
    // contract list (always visible, click = select + centre the map)
    M.list = UI.add(UI.el('div', { class: 'panel', style: 'position:absolute;left:1.5%;top:9%;width:23%;display:flex;flex-direction:column;gap:.3em;padding:.6em .7em' }));
    M.hint = UI.add(UI.el('div', { class: 'dim', style: 'position:absolute;right:1.5%;bottom:3%;font-size:.8em;text-align:right;text-shadow:1px 1px 0 #000' }, 'Kółko: przybliż / oddal · przeciągnij lub WSAD: przesuń mapę · R: cały region'));
    UI.add(UI.el('div', { class: 'panel', style: 'position:absolute;left:0;top:0;right:0;display:flex;gap:1.6em;padding:.35em 1.2em;border-width:0 0 3px 0' }, UI.el('b', { class: 'amber', style: 'letter-spacing:.15em' }, 'MAPA REGIONU'), UI.el('span', {}, 'Złom: ', UI.el('b', { class: 'amber' }, String(st.scrap))), UI.el('span', {}, 'Dzień: ' + st.day), UI.el('span', { class: 'dim', style: 'margin-left:auto' }, 'Kliknij flagę zlecenia, aby je wybrać')));
    M.side = UI.add(UI.el('div', { class: 'panel', style: 'position:absolute;right:1.5%;top:9%;width:26%;display:none;flex-direction:column;gap:.4em' }));
    M.back = UI.add(UI.button('◀ Wróć do Przystani', () => this.leave('hub'), {})); M.back.style.cssText = 'position:absolute;left:1.5%;bottom:3%';
    M.log = UI.add(UI.el('div', { style: 'position:absolute;left:1.5%;bottom:10%;width:34%;display:flex;flex-direction:column;gap:.3em' }));
    M.side.style.zIndex = 6; M.list.style.zIndex = 6; M.back.style.zIndex = 6;
    M.fade = fadeLayer('#000'); this.drawList(); this.drawSide();
    Audio.music('wastes'); Audio.ambience('wind');
    if (M.sel && params.contract) setTimeout(() => this.depart(), 700);
  },
  /** Route to a contract: highway to the city gate + streets for city jobs, a winding dirt track elsewhere. Drawn as a
   *  terrain-hugging ribbon (packed dirt with ruts); the selected route gets a pulsing amber overlay. */
  road(scene, v, i) {
    const k = M.contracts[i], a = world(HOME), b = world(v); let curve, from = 0;
    const V3 = (x, z) => new THREE.Vector3(x, hgt(x, z), z);
    if (k.biome === 'ruins') {
      const hw = []; for (let j = 0; j <= 6; j++) { const t = j / 6; hw.push(V3(HOME.x + (GATE[0] - HOME.x) * t, HOME.y + (GATE[1] - HOME.y) * t + Math.sin(t * Math.PI) * 0.9)); }
      const st = cityRoute(v.x, v.y).map(([x, z]) => V3(x, z)), pts = [...hw, ...st.slice(1)];
      curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.06); from = (hw.length - 1) / (pts.length - 1);   // the highway part is already asphalt
    } else {
      const d = b.clone().sub(a), n = new THREE.Vector3(-d.z, 0, d.x).normalize(), sgn = i % 2 ? 1 : -1, len = d.length();
      // tracks never cut through the city: targets beyond it are reached around its south or north edge
      const hit = (() => { for (let t = 0.05; t < 1; t += 0.05) if (inCity(a.x + d.x * t, a.z + d.z * t)) return true; return false; })();
      if (hit) {
        const south = b.z > CITY.z - 2, ring = (south ? [[-9.5, 11.2], [-3, 13.8], [2.5, 14.6], [9, 13.6], [15, 10.6]] : [[-11.5, -4.6], [-5, -8.4], [2.5, -10.2], [9, -9], [14.5, -6]]).filter(([x]) => x < b.x - 2.5);
        curve = new THREE.CatmullRomCurve3([a, ...ring.map(([x, z]) => V3(x, z)), b], false, 'centripetal');
      } else {
        const p1 = a.clone().lerp(b, 0.3).addScaledVector(n, sgn * len * 0.1), p2 = a.clone().lerp(b, 0.68).addScaledVector(n, -sgn * len * 0.07);
        curve = new THREE.CatmullRomCurve3([a, p1, p2, b], false, 'centripetal');
      }
    }
    const N = 160, W = 0.42, pos = [], uv = [], idx = [], pts = curve.getSpacedPoints(N); let dist = 0;
    for (let j = 0; j <= N; j++) {
      const p = pts[j], q = pts[Math.min(N, j + 1)], o = pts[Math.max(0, j - 1)], tx = q.x - o.x, tz = q.z - o.z, tl = Math.hypot(tx, tz) || 1, nx = -tz / tl, nz = tx / tl;
      if (j) dist += p.distanceTo(pts[j - 1]);
      for (const sd of [-1, 1]) { const x = p.x + nx * W * sd, z = p.z + nz * W * sd; pos.push(x, Math.max(hgt(x, z), hgt(p.x, p.z)) + 0.09, z); uv.push(dist / 1.6, sd < 0 ? 0 : 1); }
      if (j < N && j / N >= from - 0.01) idx.push(j * 2, j * 2 + 1, j * 2 + 2, j * 2 + 1, j * 2 + 3, j * 2 + 2);
    }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geo.setIndex(idx); geo.computeVertexNormals();
    const track = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: this.trackTex(), transparent: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })); track.renderOrder = 3; scene.add(track);
    const glow = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xffc050, transparent: true, opacity: 0, depthWrite: false, depthTest: false, side: THREE.DoubleSide, fog: false })); glow.renderOrder = 4; glow.scale.y = 1; glow.position.y = 0.04; scene.add(glow);
    (M.glows ||= {})[k.id] = glow;
    // way-stones along the track
    const sm = new THREE.MeshLambertMaterial({ color: 0x8a7a66, flatShading: true });
    for (let j = 12; j < N - 6; j += 14) { if (j / N < from) continue; const p = pts[j], q = pts[j + 1], tx = q.x - p.x, tz = q.z - p.z, tl = Math.hypot(tx, tz) || 1; const st = new THREE.Mesh(new THREE.DodecahedronGeometry(0.1, 0), sm); const x = p.x - tz / tl * 0.62 * (j % 28 ? 1 : -1), z = p.z + tx / tl * 0.62 * (j % 28 ? 1 : -1); st.position.set(x, hgt(x, z) + 0.06, z); st.scale.y = 0.7; scene.add(st); }
    (M.curves ||= {})[k.id] = curve;
  },
  trackTex() {
    if (M.trackT) return M.trackT; const c = document.createElement('canvas'); c.width = 64; c.height = 32; const g = c.getContext('2d'), id = g.createImageData(64, 32); let sd = 9; const r = () => (sd = (sd * 16807) % 2147483647) / 2147483647;
    for (let y = 0; y < 32; y++) for (let x = 0; x < 64; x++) { const v = Math.abs(y - 15.5) / 15.5, n = r(), rut = Math.abs(v - 0.45) < 0.14, o = (y * 64 + x) * 4; let col = rut ? [92, 72, 50] : [150, 122, 84]; if (n > 0.86) col = [176, 150, 108]; if (n < 0.08) col = [78, 62, 44];
      id.data[o] = col[0]; id.data[o + 1] = col[1]; id.data[o + 2] = col[2]; id.data[o + 3] = v > 0.96 ? 0 : v > 0.78 ? (n > (v - 0.78) / 0.2 ? 235 : 0) : 240; }
    g.putImageData(id, 0, 0); const t = new THREE.CanvasTexture(c); t.wrapS = THREE.RepeatWrapping; t.magFilter = THREE.NearestFilter; t.colorSpace = THREE.SRGBColorSpace; return (M.trackT = t);
  },
  /** Randomly mutated wildlife wandering the region: random species, hide colour, eye colour and size on every visit. */
  spawnFauna(scene) {
    const POL = { dog_mutant: 'pies', rat_mutant: 'szczur', wolf_beast: 'wilk', boar_beast: 'dzik', scorpion: 'skorpion', spider: 'pająk', beetle: 'chrząszcz', kret_mole: 'kretowij' };
    const kinds = ['dog_mutant', 'rat_mutant', 'wolf_beast', 'boar_beast', 'scorpion', 'spider', 'beetle', 'kret_mole'], names = { dog_mutant: 'pies', rat_mutant: 'szczur', wolf_beast: 'wilk', boar_beast: 'dzik', scorpion: 'skorpion', spider: 'pajak', beetle: 'chrzaszcz', kret_mole: 'kret' };
    const skins = ['#8a6a4a', '#5a5a62', '#7a8a4a', '#9a4a5a', '#4a7a8a', '#b89a5a', '#6a4a8a', '#3a3a3e', '#c8c0b0', '#8fb36a'], eyes = ['#ff3a2a', '#ffe040', '#40ffc0', '#ff60ff', '#8fff40'];
    const pick = (a) => a[(Math.random() * a.length) | 0]; M.fauna = [];
    // 2026-11-13: fewer animals (6, was 12) and none of them starts close to a route
    const route = []; for (const c of Object.values(M.curves || {})) for (const p of c.getSpacedPoints(40)) route.push(p);
    for (let i = 0; i < 6; i++) {
      let x = 0, z = 0; for (let t = 0; t < 60; t++) { x = -26 + Math.random() * 56; z = -14 + Math.random() * 32; if (hgt(x, z) < 1.2 && Math.hypot(x - HOME.x, z - HOME.y) > 6 && Object.values(M.pts).every(p => Math.hypot(p.x - x, p.y - z) > 3) && route.every(p => Math.hypot(p.x - x, p.z - z) > 4)) break; }
      const tid = pick(kinds), sc = 0.8 + Math.random() * 0.7;
      const sp = sprite({ id: 'fauna' + i, templateId: tid, isEnemy: true, name: names[tid], look: { skin: pick(skins), accent: pick(eyes), mut: 1 + ((Math.random() * 1e6) | 0) } }, sc);
      sp.object3d.scale.setScalar(sc); sp.object3d.position.set(x, hgt(x, z), z); scene.add(sp.object3d); sp.play('idle');
      M.fauna.push({ sp, x, z, hx: x, hz: z, tx: x, tz: z, wait: Math.random() * 3, sp_: 0.5 + Math.random() * 0.7, tid, name: POL[tid] || 'stwór' });
    }
  },
  updateFauna(dt) {
    const T = M.travel, pp = M.sp.object3d.position;
    // ambush: on some trips a mutated beast near the route charges the party (or one crawls out of hiding nearby)
    if (M.state === 'travel' && T && T.ambush && !T.ambDone && T.u >= T.ambAt && M.fauna?.length) {
      T.ambDone = true; let f = null, bd = 1e9; for (const q of M.fauna) { if (q.dead) continue; const d = Math.hypot(q.x - pp.x, q.z - pp.z); if (d < bd) { bd = d; f = q; } }
      if (f) {
        if (bd > 7) { const a = Math.random() * 6.28; f.x = pp.x + Math.cos(a) * 6; f.z = pp.z + Math.sin(a) * 6; f.sp.object3d.position.set(f.x, hgt(f.x, f.z), f.z); }
        f.charge = true; M.state = 'ambush'; M.attacker = f; M.sp.play('idle'); f.sp.play('walk'); Audio.sfx('alarm', { vol: 0.5 }); this.msg(`Uwaga! Zmutowany ${f.name} szarżuje na drużynę!`, 'bad');
      }
    }
    for (const f of M.fauna || []) {
      if (f.dead) { f.sp.update(dt); continue; }
      if (f.charge) {
        const dx = pp.x - f.x, dz = pp.z - f.z, d = Math.hypot(dx, dz); f.sp.setFacing?.(dx);
        if (d > 0.9) { const st = Math.min(d - 0.85, 7 * dt); f.x += dx / d * st; f.z += dz / d * st; f.sp.object3d.position.set(f.x, hgt(f.x, f.z), f.z); }
        else if (M.state === 'ambush') { f.charge = false; f.sp.play('attack'); M.sp.setFacing?.(-dx); M.sp.play('hurt'); Audio.sfx('hit'); this.fightFauna(f); }
        f.sp.update(dt); continue;
      }
      if (f.flee > 0) { f.flee -= dt; const dx = f.x - pp.x, dz = f.z - pp.z, d = Math.hypot(dx, dz) || 1; f.x += dx / d * 5 * dt; f.z += dz / d * 5 * dt; f.hx = f.tx = f.x; f.hz = f.tz = f.z; f.sp.setFacing?.(dx); f.sp.object3d.position.set(f.x, hgt(f.x, f.z), f.z); f.sp.update(dt); continue; }
      const dx = f.tx - f.x, dz = f.tz - f.z, d = Math.hypot(dx, dz);
      if (d < 0.08) { if ((f.wait -= dt) <= 0) { const a = Math.random() * 6.28, r = 0.8 + Math.random() * 2.2; f.tx = f.hx + Math.cos(a) * r; f.tz = f.hz + Math.sin(a) * r; if (hgt(f.tx, f.tz) > 1.6) { f.tx = f.hx; f.tz = f.hz; } f.wait = 1 + Math.random() * 4; f.sp.play('walk'); f.sp.setFacing?.(f.tx - f.x); } else if (f.sp.anim !== 'idle') f.sp.play('idle'); }
      else { const st = Math.min(d, f.sp_ * dt); f.x += dx / d * st; f.z += dz / d * st; f.sp.object3d.position.set(f.x, hgt(f.x, f.z), f.z); }
      f.sp.update(dt);
    }
  },
  /** The ambush itself: a skill-check event (fight / scare off / run). A won fight kills the beast, otherwise it runs away. */
  async fightFauna(f) {
    const n = f.name, N = n[0].toUpperCase() + n.slice(1);
    const ev = { id: 'fauna_attack', title: `Atak: zmutowany ${n}`, text: `${N} wypada zza wydmy prosto na Was — za duży, za szybki, a jego narośla świecą w półmroku. Nie ma czasu na ustawienie szyku.`,
      choices: [
        { label: 'Walczcie!', skill: 'athletics', out: {
          0: { text: `${N} rozrywa szyk i znika z kawałkiem czyjegoś ekwipunku w pysku. Ktoś mocno krwawi.`, hp: '2d6', scrap: -10 },
          1: { text: 'Odpieracie atak, ale bestia zdążyła kogoś poharatać, zanim uciekła.', hp: '1d6', xp: 15 },
          2: { text: `${N} pada. Wycinacie gruczoł — alchemicy w Przystani dobrze za niego zapłacą.`, items: ['mutant_gland'], xp: 40 },
          3: { text: 'Czysta robota: jedno uderzenie, jedno truchło. Przy legowisku znajdujecie resztki po mniej szczęśliwych podróżnych.', items: ['mutant_gland', '@consumable'], scrap: 15, xp: 60 } } },
        { label: 'Odstraszcie ją ogniem i krzykiem', skill: 'intimidation', out: {
          0: { text: 'Krzyk tylko ją rozjusza. Zanim odpuści, ktoś obrywa.', hp: '1d8' },
          1: { text: 'Bestia krąży, kąsa i dopiero po chwili daje za wygraną.', hp: '1d4' },
          2: { text: `${N} cofa się, warczy i odchodzi w pustkowia.`, xp: 20 },
          3: { text: 'Bestia podkula ogon i ucieka. Wy idziecie dalej raźniejszym krokiem.', xp: 35 } } },
        { label: 'Uciekajcie między skały', skill: 'acrobatics', out: {
          0: { text: 'Ktoś się potyka. Bestia dopada go pierwsza, a kluczenie kosztuje Was dzień.', hp: '1d8', days: 1 },
          1: { text: 'Gubicie ją, ale nadkładacie drogi.', days: 1 },
          2: { text: 'Gubicie bestię w rumowisku i wracacie na szlak.' },
          3: { text: 'Znikacie jej z oczu tak sprawnie, że po drodze trafiacie na czyjś porzucony schowek.', items: ['@consumable'] } } },
      ] };
    const res = await this.runEvent(ev); if (!M) return;
    if (res && res.choice === 0 && res.degree >= 2) { f.dead = true; f.sp.play('die'); } else { f.flee = 4; f.sp.play('walk'); }
    M.attacker = null;
  },
  select(k, centre) { if (!M || M.state !== 'idle') return; M.sel = k; Audio.sfx('click'); if (centre && k) { const v = M.pts[k.id]; M.view.x = clamp(v.x * 0.6, -14, 14); M.view.z = clamp(v.y * 0.6, -8, 8); } this.drawList(); this.drawSide(); },
  drawList() {
    const lvl = partyLevel(Game.state);
    M.list.replaceChildren(UI.el('b', { class: 'amber', style: 'letter-spacing:.12em' }, 'ZLECENIA'), ...M.contracts.map(k => {
      const df = DIFFICULTY(k.level, lvl), col = '#' + (COLORS[k.type] || 0xffffff).toString(16).padStart(6, '0');
      const b = UI.button('', () => this.select(k, true), { class: k === M.sel ? 'primary on' : '' }); b.style.cssText = `display:block;width:100%;text-align:left;padding:.35em .6em;border-left:.5em solid ${col};font-size:.85em;line-height:1.3`;
      b.append(UI.el('div', {}, (k.story ? '★ ' : '') + k.title), UI.el('div', { class: 'dim', style: 'font-size:.85em;text-transform:none;letter-spacing:0' }, `${BIOME_NAMES[k.biome] || k.biome} · `, UI.el('span', { class: df.cls }, df.label), ` · ${k.reward.scrap} Z`)); return b;
    }));
  },
  drawSide() {
    const k = M.sel, box = M.side; if (!k) { box.style.display = 'none'; return; }
    const lvl = partyLevel(Game.state), df = DIFFICULTY(k.level, lvl); box.style.display = 'flex';
    box.replaceChildren(UI.el('h2', { style: 'margin:0' }, (k.story ? '★ ' : '') + k.title), UI.el('div', { class: 'dim', style: 'font-size:.85em' }, `${TYPE_NAMES[k.type]} · ${BIOME_NAMES[k.biome]} · ${k.giver}`),
      UI.el('div', { style: 'line-height:1.4;font-size:.95em' }, k.desc), UI.el('div', {}, 'Trudność: ', UI.el('b', { class: df.cls }, df.label), ` (poz. ${k.level})`),
      UI.el('div', {}, 'Nagroda: ', UI.el('b', { class: 'amber' }, k.reward.scrap + ' Z'), ' + ' + k.reward.xp + ' PD'),
      UI.el('div', { class: 'dim' }, `Podróż: ${k.travelDays || 1} d.`), UI.button('Wyrusz ▶', () => this.depart(), { class: 'primary' }));
  },
  leave(n) { M.fade.to(1, 400); setTimeout(() => { if (Game.current === this) Game.goto(n); }, 420); },
  depart() {
    if (M.state !== 'idle' || !M.sel) return; const k = M.sel, curve = M.curves[k.id]; if (!curve) return;
    M.state = 'travel'; M.side.style.display = 'none'; M.list.style.display = 'none'; M.hint.style.display = 'none'; M.back.textContent = '◀ Zawróć'; M.back.disabled = false;
    const ev = M.force ? EVENTS.find(e => e.id === M.force) : (Math.random() < 0.3 ? this.rollEvent() : null);
    const amb = M.force === 'fauna_attack' || Math.random() < 0.22;
    M.travel = { u: 0, curve, dur: Math.max(6, curve.getLength() / 4.2), ev: M.force === 'fauna_attack' ? null : ev, evAt: 0.55 + Math.random() * 0.25, evDone: false, k, ambush: amb, ambAt: 0.18 + Math.random() * 0.25, ambDone: false };
    M.sp.play('walk'); Audio.sfx('step'); this.msg(`Wyruszacie: ${k.title}`);
  },
  rollEvent() { const tot = EVENTS.reduce((a, e) => a + (e.weight || 1), 0); let r = Math.random() * tot; for (const e of EVENTS) { r -= e.weight || 1; if (r <= 0) return e; } return EVENTS[0]; },
  msg(t, cls = '') { const e = UI.el('div', { class: 'panel ' + cls, style: 'padding:.4em .7em;font-size:.9em' }, t); M.log.append(e); setTimeout(() => e.remove(), 6000); while (M.log.children.length > 5) M.log.firstChild.remove(); },
  // ---- events ----
  async runEvent(ev) {
    M.state = 'event'; M.sp.play('idle'); Audio.sfx('alarm', { vol: 0.4 });
    const st = Game.state, k = M.travel.k, dc = R.dcForLevel ? R.dcForLevel(k.level) : 14 + k.level * 2;
    const alive = st.party.filter(c => R.isAlive(c) && !c.conditions?.dead);
    const back = UI.el('div', { class: 'modal-back' }), box = UI.el('div', { class: 'panel', style: 'width:52%;max-height:90%;overflow:auto' }); back.append(box); UI.add(back);
    const show = (...n) => box.replaceChildren(...n);
    const choose = () => new Promise(res => {
      const btns = ev.choices.map((c, i) => {
        let lab = c.label, tip = '';
        if (c.skill) { const best = alive.reduce((a, b) => (stat(b, c.skill) > stat(a, c.skill) ? b : a), alive[0]); lab += ` — ${skillName(c.skill)} ${signed(stat(best, c.skill))} (${shortName(best.name)}, KT ${dc})`; }
        const b = UI.button(lab, () => res(c), { class: i ? '' : 'primary' }); b.style.cssText = 'display:block;width:100%;text-align:left;margin-top:.5em;padding:.6em .9em'; return b;
      });
      show(UI.el('h2', {}, ev.title), UI.el('div', { style: 'line-height:1.5;margin-bottom:.5em' }, ev.text), ...btns);
    });
    const c = await choose(); let degree = 2, who = null, d20 = null;
    if (c.skill) {
      who = alive.reduce((a, b) => (stat(b, c.skill) > stat(a, c.skill) ? b : a), alive[0]); d20 = R.skillCheck(who, c.skill, dc); degree = d20.degree;
      show(UI.el('h2', {}, ev.title), UI.el('div', {}, `${shortName(who.name)} próbuje: ${skillName(c.skill)}…`));
      try { await GFX.showD20Roll({ ...d20, label: skillName(c.skill) }); } catch { await new Promise(r => setTimeout(r, 700)); }
    }
    const out = c.out[degree] || c.out[2] || c.out[1] || { text: '…' }, eff = [];
    if (out.scrap) { const d = Math.max(-st.scrap, out.scrap); st.scrap += d; eff.push([`${d > 0 ? '+' : ''}${d} Złomu`, d > 0 ? 'good' : 'bad']); }
    for (const spec of out.items || []) { const id = rollItem(spec, k.level); if (id) { addToStash(st, R.newItem(id)); eff.push([`Zdobyto: ${itemName(id)}`, 'good']); } }
    if (out.hp) { const v = typeof out.hp === 'number' ? out.hp : R.roll(out.hp).total, tgt = pick(alive); tgt.hp = Math.max(1, tgt.hp - v); eff.push([`${shortName(tgt.name)} traci ${v} PW`, 'bad']); Audio.sfx('hit'); }
    for (const [f, v] of Object.entries(out.rep || {})) { st.rep[f] = (st.rep[f] || 0) + v; eff.push([`${f === 'nomads' ? 'Nomadzi' : 'Ocaleni'} ${v > 0 ? '+' : ''}${v}`, v > 0 ? 'good' : 'bad']); }
    if (out.xp) { for (const m of alive) R.addXP(m, out.xp); eff.push([`+${out.xp} PD dla każdego`, 'good']); }
    if (out.days) { st.day = Math.max(1, st.day + out.days); eff.push([out.days > 0 ? `Strata czasu: +${out.days} d.` : 'Zyskany czas: −1 d.', out.days > 0 ? 'bad' : 'good']); }
    Audio.sfx(degree >= 2 ? (degree === 3 ? 'crit' : 'pickup') : 'miss');
    await new Promise(res => { const b = UI.button('Dalej ▶', res, { class: 'primary' }); show(UI.el('h2', {}, ev.title), d20 ? UI.el('div', { class: degree >= 2 ? 'good' : 'bad', style: 'font-weight:bold' }, `${R.DEGREE_NAMES[degree]} (${d20.d20} ${signed(d20.mod)} = ${d20.total} vs ${d20.dc})`) : null, UI.el('div', { style: 'line-height:1.5;margin:.5em 0' }, out.text), ...eff.map(([t, cl]) => UI.el('div', { class: cl }, '• ' + t)), UI.el('div', { style: 'text-align:right;margin-top:.8em' }, b)); });
    back.remove(); M.state = 'travel'; M.sp.play('walk'); return { degree, choice: ev.choices.indexOf(c) };
  },
  // ---- input ----
  onPointerDown(ev, ndc) {
    if (!M || M.state !== 'idle') return; M.drag = { x: ev.clientX, y: ev.clientY, moved: false, ndc: { x: ndc.x, y: ndc.y } };
  },
  onPointerMove(ev) {
    const d = M?.drag; if (!d || M.state !== 'idle') return; const dx = ev.clientX - d.x, dy = ev.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < 6) return; d.moved = true; d.x = ev.clientX; d.y = ev.clientY;
    const k = 60 * M.view.zoom / (Engine.canvas.getBoundingClientRect().width || 1280);
    M.view.x = clamp(M.view.x - dx * k, -24, 26); M.view.z = clamp(M.view.z - dy * k * 1.5, -14, 14);
  },
  onPointerUp() {
    const d = M?.drag; if (!M) return; M.drag = null; if (!d || d.moved || M.state !== 'idle') return;
    let best = null, bd = 0.14;   // click a flag, its beacon or its label
    for (const l of M.labels) { if (!l.id) continue; const p = l.pos.clone().project(this.camera), d2 = Math.hypot((p.x - d.ndc.x) * 1.78, (p.y - 0.05 - d.ndc.y) * 0.8); if (d2 < bd) { bd = d2; best = l; } }
    if (best) this.select(M.contracts.find(c => c.id === best.id));
  },
  onWheel(ev) { if (!M || M.state !== 'idle') return; M.view.zoom = clamp(M.view.zoom * (ev.deltaY < 0 ? 1 / 1.15 : 1.15), 0.35, 1.3); },
  onKey(ev) {
    if (!M) return; const k = ev.key.toLowerCase();
    if (ev.type === 'keyup') { M.keys.delete(k); return; }
    if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) { M.keys.add(k); if (!M.keyUp) { M.keyUp = (e) => M?.keys.delete(e.key.toLowerCase()); window.addEventListener('keyup', M.keyUp); } }
    if (k === 'r') M.view = { x: -1.5, z: 1.5, zoom: 1.14 }; if (k === '+' || k === '=') M.view.zoom = Math.max(0.4, M.view.zoom / 1.2); if (k === '-') M.view.zoom = Math.min(1.25, M.view.zoom * 1.2);
  },
  update(dt) {
    if (!M) return; M.t += dt; M.world?.update(dt, M.t); M.dust.userData.update(dt); M.atmo.update?.(dt); M.sp.update(dt);
    for (const k of M.contracts) { const mm = M.mk?.[k.id]; if (mm) { mm.userData.ring.scale.setScalar(1 + 0.15 * Math.sin(M.t * 3 + (k === M.sel ? 0 : 2))); mm.rotation.y = k === M.sel ? M.t : 0; } }
    { const K = M.keys, sp = 16 * dt * M.view.zoom; if (K.has('a') || K.has('arrowleft')) M.view.x -= sp; if (K.has('d') || K.has('arrowright')) M.view.x += sp; if (K.has('w') || K.has('arrowup')) M.view.z -= sp; if (K.has('s') || K.has('arrowdown')) M.view.z += sp; M.view.x = clamp(M.view.x, -24, 26); M.view.z = clamp(M.view.z, -14, 14); }
    this.updateFauna(dt); for (const k of M.contracts) { const gl = M.glows?.[k.id]; if (gl) gl.material.opacity = k === M.sel ? 0.28 + 0.16 * Math.sin(M.t * 4) : 0; }
    for (const k of M.contracts) { const g = M.mk?.[k.id]?.userData.gem; if (g) { g.rotation.y = M.t * 2; g.position.y = 4.3 + 0.18 * Math.sin(M.t * 2.5 + k.level); g.scale.setScalar(k === M.sel ? 1.5 : 1); } }
    let focus = new THREE.Vector3(M.view.x, 0, M.view.z), zoom = M.view.zoom;
    if (M.state === 'travel') {
      const T = M.travel; T.u = Math.min(1, T.u + dt / T.dur); const p = T.curve.getPointAt(T.u); M.sp.object3d.position.set(p.x, hgt(p.x, p.z) + Math.abs(Math.sin(M.t * 8)) * 0.08, p.z);
      const q = T.curve.getPointAt(Math.min(1, T.u + 0.02)); if (Math.abs(q.x - p.x) > 0.02) M.sp.setFacing?.(q.x - p.x);
      focus = p.clone(); zoom = 0.45;
      if (T.ev && !T.evDone && T.u >= T.evAt) { T.evDone = true; this.runEvent(T.ev); }
      if (T.u >= 1 && M.state === 'travel') { M.state = 'arrive'; this.msg('Jesteście na miejscu.'); Audio.sfx('door'); M.fade.to(1, 600); setTimeout(() => { if (Game.current === this) { const k = M.travel.k; Game.goto('mission', { contract: k }); } }, 700); }
    }
    if ((M.state === 'ambush' || M.state === 'event') && M.travel) { focus = M.sp.object3d.position.clone(); focus.y = 0; zoom = 0.4; }
    const goalPos = focus.clone().add(new THREE.Vector3(0, 33 * zoom + 2, 23 * zoom + 1));   // nizsza kamera: widac horyzont i niebo
    this.camera.position.lerp(goalPos, Math.min(1, dt * (M.drag?.moved ? 12 : 2.5))); M.look.lerp(focus, Math.min(1, dt * (M.drag?.moved ? 12 : 3))); this.camera.lookAt(M.look);
    for (const l of M.labels) {
      const p = l.pos.clone().project(this.camera), vis = p.z < 1 && Math.abs(p.x) < 1.15 && p.y > -1.1 && p.y < 1.05;
      const x = l.kind === 'contract' ? clamp((p.x * 0.5 + 0.5) * 100, 8, 92) : (p.x * 0.5 + 0.5) * 100, y = Math.max(l.kind === 'contract' ? 11 : 6, (-p.y * 0.5 + 0.5) * 100);
      l.el.style.left = x + '%'; l.el.style.top = y + '%'; l.el.style.display = vis ? '' : 'none';
      l.el.style.opacity = M.state === 'idle' ? (l.kind === 'contract' && M.sel && l.id !== M.sel.id ? 0.8 : 1) : (l.id === M.sel?.id ? 1 : 0.3);
      if (l.kind === 'contract') l.el.style.zIndex = l.id === M.sel?.id ? 3 : 2;
    }
  },
  exit() { if (M) { if (M.keyUp) window.removeEventListener('keyup', M.keyUp); for (const f of M.fauna || []) f.sp.dispose?.(); M.sp.dispose?.(); disposeObj(this.scene); } M = null; this.scene = null; },
};
