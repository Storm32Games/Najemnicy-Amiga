// Title screen: big pixel logo over an animated dusk wasteland; menu Nowa gra / Kontynuuj / Opcje / Autorzy.
import { THREE, UI, Audio, GFX, disposeObj, gradientTexture, rngSeed, skyline, dunes, particles, makeFire, sprite, fadeLayer } from './meta/common.js';
import { Game } from '../core/game.js';
import { textCanvas } from './meta/font.js';
import { CREDITS } from '../data/story.js';
import { RECRUITS } from '../data/recruits.js';
import { Settings } from '../core/settings.js';

// Volume is persisted by Audio itself; kept for compatibility with older imports.
export function loadVolume() { return Audio.getVolume ? Audio.getVolume() : { master: 0.8, music: 0.7, sfx: 0.9 }; }
let T = null;

export default {
  scene: null, camera: null,
  enter() {
    const scene = new THREE.Scene(); scene.background = gradientTexture([[0, '#1a1030'], [0.4, '#7a3a4a'], [0.7, '#e0803a'], [1, '#f6c070']]);
    scene.fog = new THREE.Fog(0xc07048, 40, 160);
    const cam = new THREE.PerspectiveCamera(48, 16 / 9, 0.1, 400); this.scene = scene; this.camera = cam;
    scene.add(new THREE.AmbientLight(0xffc090, 1.6)); const sun = new THREE.DirectionalLight(0xffa050, 3); sun.position.set(-30, 8, -40); scene.add(sun);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(14, 28), new THREE.MeshBasicMaterial({ color: 0xffe0a0, fog: false })); disc.position.set(-10, 14, -170); scene.add(disc);
    const g = dunes(360, 240, { amp: 2.2, scale: 0.08, base: [0.7, 0.46, 0.3], seed: 21 }); g.position.set(0, -1, -20); scene.add(g);
    const city = skyline(rngSeed(5), { n: 46, x0: -110, x1: 110, z: -120, hMin: 6, hMax: 34, color: 0x24141a, lit: false }); scene.add(city);
    const city2 = skyline(rngSeed(6), { n: 28, x0: -90, x1: 90, z: -80, hMin: 4, hMax: 18, color: 0x1a0f12, lit: true }); scene.add(city2);
    // foreground: wrecked car + lone scout + fire
    try { const car = GFX.createProp('car'); car.position.set(7, 0, -2); car.rotation.y = 0.5; car.scale.setScalar(2); scene.add(car); } catch { }
    try { const tr = GFX.createProp('tree_dead'); tr.position.set(-9, 0, -4); tr.scale.setScalar(2.4); scene.add(tr); } catch { }
    const fire = makeFire(0.9); fire.position.set(-3.8, 0, 0.5); scene.add(fire);
    const sps = [RECRUITS[1], RECRUITS[0]].filter(Boolean).map((r, i) => { const sp = sprite({ ...r }, 1); sp.object3d.position.set(-2.4 + i * 2.2, 0, 0.5 + i * 0.4); scene.add(sp.object3d); sp.play('idle'); return sp; });
    const dust = particles(200, { box: [80, 8, 50], center: [0, 0, -15], color: 0xf0c080, size: 2, vel: [3, 0.1, 0.3], seed: 8, opacity: 0.5 }); scene.add(dust);
    T = { fire, sps, dust, t: 0, menu: null };
    // --- UI ---
    const logo = textCanvas('PYŁ I RDZA', 9, { top: '#ffe08a', bottom: '#c0501e', spacing: 2 });
    const sub = textCanvas('NAJEMNICY', 5, { top: '#c8e08a', bottom: '#4f8a2a', spacing: 2 });
    logo.style.cssText = 'width:62%;display:block;margin:0 auto;animation:ttl 4s ease-in-out infinite;filter:drop-shadow(0 0 1.2em #f2a93b66)'; sub.style.cssText = 'width:30%;display:block;margin:.2em auto 0';
    const style = UI.el('style', {}, '@keyframes ttl{0%,100%{transform:translateY(0)}50%{transform:translateY(-.4em)}} @keyframes fl{0%,100%{opacity:1}92%{opacity:1}94%{opacity:.4}96%{opacity:1}98%{opacity:.6}}');
    const head = UI.add(UI.el('div', { style: 'position:absolute;left:0;right:0;top:6%;text-align:center' }, style, logo, sub));
    sub.style.animation = 'fl 5s infinite';
    const menu = UI.add(UI.el('div', { style: 'position:absolute;right:6%;bottom:9%;display:flex;flex-direction:column;gap:.6em;min-width:15em' }));
    const bs = 'font-size:1.2em;padding:.5em 1em;text-align:left';
    const add = (label, fn, o = {}) => { const b = UI.button(label, fn, o); b.style.cssText = bs; menu.append(b); return b; };
    add('▶ Nowa gra', () => { Audio.sfx('door'); this.go('recruit'); }, { class: 'primary' });
    if (Game.hasSave()) add('Kontynuuj', () => { if (Game.load()) this.go('hub'); else UI.toast('Nie udało się wczytać zapisu'); });
    add('Opcje', () => this.options());
    add('Autorzy', () => this.credits());
    UI.add(UI.el('div', { style: 'position:absolute;left:2%;bottom:2%;color:var(--dim);font-size:.8em;text-shadow:1px 1px 0 #000' }, 'STORM 32 · v1.0 · Pathfinder 2e w świecie po zagładzie'));
    T.fade = fadeLayer('#000');
    Audio.music('title'); Audio.ambience('wind');
  },
  go(n) { T.fade.to(1, 400); setTimeout(() => { if (Game.current === this) Game.goto(n); }, 410); },
  options() { return Settings.open(); },
  credits() {
    const body = UI.el('div', { style: 'line-height:1.8;min-width:30em' }, ...CREDITS.slice(1).map(([a, b]) => UI.el('div', {}, UI.el('span', { class: 'amber' }, a + ': '), b)));
    UI.modal({ title: 'Autorzy — STORM 32', body, buttons: [{ label: 'Zamknij', value: true }] });
  },
  update(dt, time) {
    if (!T) return; T.t += dt; T.fire.userData.update(T.t); T.dust.userData.update(dt); T.sps.forEach(s => s.update(dt));
    const t = T.t; this.camera.position.set(Math.sin(t * 0.1) * 5, 2.4 + Math.sin(t * 0.17) * 0.3, 11 - Math.min(t, 40) * 0.05); this.camera.lookAt(-1 + Math.sin(t * 0.1) * 2, 3.2, -20);
  },
  exit() { if (this.scene) { disposeObj(this.scene); T?.sps.forEach(s => s.dispose?.()); } T = null; this.scene = null; },
};
