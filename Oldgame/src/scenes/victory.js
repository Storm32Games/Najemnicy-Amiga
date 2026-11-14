// Victory (Kostucha defeated): sunrise epilogue + scrolling credits "STORM 32".
import { THREE, UI, Audio, disposeObj, rngSeed, dunes, skyline, particles, makeFire, sprite, atmosphere, fadeLayer, Typewriter } from './meta/common.js';
import { Game } from '../core/game.js';
import { textCanvas } from './meta/font.js';
import { EPILOGUE, CREDITS } from '../data/story.js';
import { RECRUITS } from '../data/recruits.js';

let V = null;
export default {
  scene: null, camera: null,
  enter() {
    const st = Game.state; if (!st.party.length) st.party = RECRUITS.slice(0, 4).map(r => ({ ...r, level: 1, hp: 10, maxHp: 10, attrs: {}, inventory: [], equipment: {}, conditions: {} }));
    V = { t: 0, i: 0, sps: [], phase: 'epi' };
    const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 300); this.scene = scene; this.camera = cam;
    atmosphere(scene, 'day'); scene.background = null;
    scene.background = (await_tex()); scene.fog = new THREE.Fog(0xf0b070, 30, 140);
    scene.add(new THREE.AmbientLight(0xffd0a0, 1.6)); const sun = new THREE.DirectionalLight(0xffc070, 3); sun.position.set(0, 6, -30); scene.add(sun);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(10, 28), new THREE.MeshBasicMaterial({ color: 0xfff0b0, fog: false })); disc.position.set(0, 4, -120); scene.add(disc); V.sun = disc;
    const g = dunes(260, 160, { amp: 1.4, scale: 0.1, base: [0.8, 0.58, 0.36], seed: 18 }); g.position.y = -0.3; scene.add(g);
    scene.add(skyline(rngSeed(50), { n: 36, x0: -80, x1: 80, z: -70, hMin: 4, hMax: 24, color: 0x2a1812, lit: false }));
    V.sps = st.party.slice(0, 4).map((ch, i) => { const sp = sprite(ch, 1.3); sp.object3d.position.set((i - 1.5) * 2.3, 0, 0 + (i % 2) * 0.5); scene.add(sp.object3d); sp.play('idle'); return sp; });
    V.embers = particles(140, { box: [30, 14, 14], center: [0, 0, 0], color: 0xffd070, size: 2, vel: [0.2, 1.1, 0], seed: 5, opacity: 0.9 }); scene.add(V.embers);
    V.dust = particles(80, { box: [50, 6, 30], center: [0, 0, -5], color: 0xf8d090, size: 1.5, vel: [1, 0.1, 0], seed: 6, opacity: 0.4 }); scene.add(V.dust);
    cam.position.set(0, 1.2, 9); cam.lookAt(0, 2.3, 0);
    const title = textCanvas('ZWYCIĘSTWO', 10, { top: '#fff0a0', bottom: '#e08a20', spacing: 2 }); title.style.cssText = 'width:50%;display:block;margin:0 auto;filter:drop-shadow(0 0 1em #ffcf60aa)';
    V.title = UI.add(UI.el('div', { style: 'position:absolute;left:0;right:0;top:7%;text-align:center;transition:opacity 1.5s' }, title));
    V.box = UI.add(UI.el('div', { class: 'panel', style: 'position:absolute;left:12%;right:12%;bottom:6%;background:#120c08ee;display:flex;gap:1em;align-items:center' }));
    V.txt = UI.el('div', { style: 'flex:1;font-size:1.25em;line-height:1.6;min-height:3.2em' }); V.next = UI.button('Dalej ▶', () => this.next(), { class: 'primary' }); V.box.append(V.txt, V.next);
    V.tw = new Typewriter(V.txt, EPILOGUE[0], 34); V.fade = fadeLayer('#fff');
    Audio.music('victory'); Audio.sfx('victory'); Audio.ambience('wind');
  },
  next() {
    if (!V.tw.done) return V.tw.finish();
    if (V.phase !== 'epi') return;
    if (++V.i < EPILOGUE.length) V.tw = new Typewriter(V.txt, EPILOGUE[V.i], 34); else this.credits();
  },
  onPointerDown() { if (V?.phase === 'epi') this.next(); },
  onKey(e) { if (V?.phase === 'epi' && ['Enter', ' '].includes(e.key)) this.next(); },
  credits() {
    V.phase = 'credits'; V.box.remove(); V.title.style.opacity = 0;
    const wrap = UI.add(UI.el('div', { style: 'position:absolute;inset:0;overflow:hidden;background:linear-gradient(90deg,#0009,#0000 25%,#0000 75%,#0009);pointer-events:none' }));
    const col = UI.el('div', { style: 'position:absolute;left:25%;right:25%;top:100%;text-align:center;animation:crl 34s linear forwards;line-height:2;text-shadow:2px 2px 0 #000' });
    UI.add(UI.el('style', {}, '@keyframes crl{from{transform:translateY(0)}to{transform:translateY(-135%)}}'));
    const big = textCanvas('PYŁ I RDZA', 7, { spacing: 2 }); big.style.cssText = 'width:100%;display:block;margin-bottom:.5em'; col.append(big);
    for (const [a, b] of CREDITS.slice(1)) col.append(UI.el('div', { class: 'amber', style: 'margin-top:1.4em;letter-spacing:.2em;font-size:.9em' }, a.toUpperCase()), UI.el('div', { style: 'font-size:1.15em' }, b));
    const logo = textCanvas('STORM 32', 9, { top: '#ffe08a', bottom: '#d0521e', spacing: 2 }); logo.style.cssText = 'width:70%;display:block;margin:4em auto 0'; col.append(logo, UI.el('div', { class: 'dim', style: 'margin:1em 0 8em' }, 'Dziękujemy za grę.'));
    wrap.append(col); V.wrap = wrap; V.cT = 0;
  },
  finish() {
    const b = UI.add(UI.el('div', { style: 'position:absolute;left:0;right:0;bottom:6%;display:flex;gap:1em;justify-content:center' }));
    b.append(UI.button('Wróć do Przystani (graj dalej)', () => { Game.save(); this.go('hub'); }, { class: 'primary' }), UI.button('Menu główne', () => this.go('title')));
  },
  go(n) { V.fade.style.background = '#000'; V.fade.to(1, 600); setTimeout(() => { if (Game.current === this) Game.goto(n); }, 620); },
  update(dt) {
    if (!V) return; V.t += dt; V.tw.update(dt); V.embers.userData.update(dt); V.dust.userData.update(dt); V.sps.forEach(s => s.update(dt));
    V.sun.position.y = 4 + Math.min(V.t * 0.35, 12); this.camera.position.x = Math.sin(V.t * 0.15) * 1.5; this.camera.lookAt(0, 2.3, 0);
    if (V.phase === 'credits') { V.cT += dt; if (V.cT > 36 && !V.done) { V.done = true; this.finish(); } }
    if (V.phase === 'epi' && V.tw.done && V.i === EPILOGUE.length - 1) V.next.textContent = 'Napisy ▶';
  },
  exit() { if (V) { V.sps.forEach(s => s.dispose?.()); disposeObj(this.scene); } V = null; this.scene = null; },
};
import { gradientTexture } from './meta/common.js';
function await_tex() { return gradientTexture([[0, '#4a6aa0'], [0.45, '#f0a060'], [0.8, '#ffd890'], [1, '#fff0c0']]); }
