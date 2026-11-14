// Game over (TPK): somber cinematic, epitaph, back to title / last save.
import { THREE, UI, Audio, disposeObj, rngSeed, dunes, skyline, particles, sprite, atmosphere, fadeLayer, Typewriter, className } from './meta/common.js';
import { Game } from '../core/game.js';
import { textCanvas } from './meta/font.js';
import { GAMEOVER_LINES } from '../data/story.js';
import { RECRUITS } from '../data/recruits.js';

let G = null;
export default {
  scene: null, camera: null,
  enter(params = {}) {
    const st = Game.state; if (!st.party.length && !(st.flags.fallen || []).length) st.party = RECRUITS.slice(0, 4).map(r => ({ ...r, level: 1 }));
    const crew = st.party.length ? st.party : [];
    const names = (params.casualties?.length ? params.casualties : [...(st.flags.fallen || []), ...crew.map(c => c.name)]).slice(-4);
    G = { t: 0, sps: [] };
    const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 200); this.scene = scene; this.camera = cam;
    atmosphere(scene, 'night'); scene.fog = new THREE.Fog(0x120a0c, 12, 60);
    const g = dunes(120, 60, { amp: 0.4, base: [0.24, 0.2, 0.2], seed: 9 }); g.position.z = -10; scene.add(g);
    scene.add(skyline(rngSeed(13), { n: 24, x0: -50, x1: 50, z: -35, hMin: 5, hMax: 20, color: 0x0e0a0a, lit: false }));
    const l = new THREE.PointLight(0xc43d2f, 18, 20); l.position.set(0, 3, 4); scene.add(l);
    const six = crew.length ? crew : RECRUITS.slice(0, 4);
    six.slice(0, 4).forEach((ch, i) => { const sp = sprite(ch, 1.2); sp.object3d.position.set((i - 1.5) * 2.6, 0, 1 + (i % 2) * 0.6); sp.object3d.rotation.z = 0; scene.add(sp.object3d); sp.play('die'); G.sps.push(sp); });
    G.dust = particles(120, { box: [40, 5, 20], center: [0, 0, 0], color: 0x9a8a80, size: 1.5, vel: [3, 0.1, 0.2], seed: 11, opacity: 0.45 }); scene.add(G.dust);
    cam.position.set(0, 1.6, 10); cam.lookAt(0, 1, 0);
    const title = textCanvas('KONIEC DROGI', 9, { top: '#e07a6a', bottom: '#6a1410', spacing: 2 }); title.style.cssText = 'width:55%;display:block;margin:0 auto';
    UI.add(UI.el('div', { style: 'position:absolute;inset:0;background:radial-gradient(transparent 35%,#300a 100%);pointer-events:none' }));
    UI.add(UI.el('div', { style: 'position:absolute;left:0;right:0;top:8%;text-align:center' }, title));
    const box = UI.add(UI.el('div', { class: 'panel', style: 'position:absolute;left:14%;right:14%;bottom:6%;text-align:center;background:#0a0606ee' }));
    G.txt = UI.el('div', { style: 'font-size:1.2em;line-height:1.6;min-height:3.2em' });
    box.append(UI.el('div', { class: 'bad', style: 'margin-bottom:.4em' }, 'Polegli: ' + (names.map(n => n.replace(/"[^"]*"\s*/, '')).join(', ') || '—')), G.txt,
      UI.el('div', { class: 'dim', style: 'margin:.4em 0' }, `Przetrwaliście do dnia ${st.day}. Ukończone zlecenia: ${st.completed.length}.`));
    G.btns = UI.el('div', { style: 'display:flex;gap:.8em;justify-content:center;opacity:0;transition:opacity 1s' });
    if (Game.hasSave()) G.btns.append(UI.button('Wczytaj ostatni zapis', () => { if (Game.load() && Game.state.party.length) this.go('hub'); else UI.toast('Brak użytecznego zapisu.'); }, { class: 'primary' }));
    G.btns.append(UI.button('Menu główne', () => { Game.newGame(); this.go('title'); }, { class: 'danger' })); box.append(G.btns);
    G.tw = new Typewriter(G.txt, GAMEOVER_LINES.join(' '), 28); G.fade = fadeLayer('#000');
    Audio.music('defeat'); Audio.ambience('wind'); Audio.sfx('defeat');
  },
  go(n) { G.fade.to(1, 500); setTimeout(() => { if (Game.current === this) Game.goto(n); }, 520); },
  update(dt) { if (!G) return; G.t += dt; G.dust.userData.update(dt); G.sps.forEach(s => s.update(dt)); G.tw.update(dt); if (G.tw.done || G.t > 3) G.btns.style.opacity = 1; this.camera.position.x = Math.sin(G.t * 0.1) * 1.5; this.camera.lookAt(0, 1, 0); },
  exit() { if (G) { G.sps.forEach(s => s.dispose?.()); disposeObj(this.scene); } G = null; this.scene = null; },
};
