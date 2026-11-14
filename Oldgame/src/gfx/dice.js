// Animated 3D d20 roll overlay (own small WebGL renderer), result line in pixel font. Queued, click to skip.
import { THREE, Engine } from '../core/engine.js';
import { mkCanvas, canvasTex, shade } from './util.js';
import { drawPixelText, measurePixelText } from './font.js';

const DEG = ['KRYTYCZNA PORAŻKA', 'PORAŻKA', 'SUKCES', 'KRYTYCZNY SUKCES'];
const DEG_COL = ['#ff5a45', '#b0a49a', '#8fe06a', '#ffd24a'];
let R3 = null, die = null, scene = null, cam = null;
const CELL = 160;   // 2026-11-13: high-res faces, smooth engraved numerals, bevel highlights, antialiased render
// die canvas: 112 px at 640x360, scaled with the render resolution (crisp 3D, pixel-art numbers magnified)
const dieSize = () => Math.round(Math.min(640, 150 * Math.min(4, Math.max(2, Engine.pixelScale || 1))));

function build() {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 112;
  const r = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true }); r.setPixelRatio(1); r.setSize(112, 112, false); r.outputColorSpace = THREE.SRGBColorSpace; r.setClearColor(0x000000, 0);
  scene = new THREE.Scene(); cam = new THREE.PerspectiveCamera(32, 1, 0.5, 20); cam.position.set(0, 0, 5.2);
  scene.add(new THREE.AmbientLight(0xffffff, 0.75)); const dl = new THREE.DirectionalLight(0xfff4e0, 3.0); dl.position.set(-2.5, 3.5, 5); scene.add(dl); const rl = new THREE.DirectionalLight(0xff9a50, 1.6); rl.position.set(4, -2, 1.5); scene.add(rl); const bl = new THREE.DirectionalLight(0x6090ff, 0.9); bl.position.set(2, 3, -4); scene.add(bl);
  const geo = new THREE.IcosahedronGeometry(1.25, 0); const pos = geo.attributes.position; const faces = pos.count / 3;
  // atlas
  const [ac, g] = mkCanvas(CELL * 5, CELL * 4);
  const normals = [], cents = [], ups = [];
  for (let f = 0; f < faces; f++) { const a = new THREE.Vector3().fromBufferAttribute(pos, f * 3), b = new THREE.Vector3().fromBufferAttribute(pos, f * 3 + 1), c = new THREE.Vector3().fromBufferAttribute(pos, f * 3 + 2); const cen = a.clone().add(b).add(c).divideScalar(3); const n = b.clone().sub(a).cross(c.clone().sub(a)).normalize(); if (n.dot(cen) < 0) n.negate(); normals.push(n); cents.push(cen); ups.push(a.clone().sub(cen).normalize()); }
  // numbers: opposite faces sum to 21
  const num = new Array(faces).fill(0); let nx = 1;
  for (let f = 0; f < faces; f++) { if (num[f]) continue; let o = -1, best = 2; for (let k = 0; k < faces; k++) { if (k !== f && !num[k]) { const d = normals[f].dot(normals[k]); if (d < best) { best = d; o = k; } } } num[f] = nx; num[o] = 21 - nx; nx++; }
  const K = CELL / 64, uv = []; const T0 = [32 * K, 4 * K], T1 = [3 * K, 60 * K], T2 = [61 * K, 60 * K];
  const tri = (cx, cy, inset) => { const gx = 32 * K, gy = 41.3 * K, q = (p) => [cx + gx + (p[0] - gx) * (1 - inset), cy + gy + (p[1] - gy) * (1 - inset)]; g.beginPath(); g.moveTo(...q(T0)); g.lineTo(...q(T1)); g.lineTo(...q(T2)); g.closePath(); };
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
  for (let f = 0; f < faces; f++) {
    const cx = (f % 5) * CELL, cy = Math.floor(f / 5) * CELL;
    g.fillStyle = '#f2dfae'; g.fillRect(cx, cy, CELL, CELL);                                   // bright bevel on the edges
    tri(cx, cy, 0.045); g.fillStyle = '#e2b85a'; g.fill();                                      // brass rim
    const gr = g.createLinearGradient(cx, cy + 6 * K, cx + 20 * K, cy + 60 * K); const tone = 0.92 + ((f * 7) % 5) * 0.03;
    gr.addColorStop(0, shade('#c0392a', tone)); gr.addColorStop(0.55, shade('#96271b', tone)); gr.addColorStop(1, shade('#6a1a12', tone));
    tri(cx, cy, 0.1); g.fillStyle = gr; g.fill();                                               // enamel face
    tri(cx, cy, 0.19); g.strokeStyle = 'rgba(255,220,170,.22)'; g.lineWidth = 1.2 * K; g.stroke();   // thin inner inlay line
    const txt = String(num[f]), fs = (txt.length > 1 ? 21 : 25) * K, tx = cx + 32 * K, ty = cy + 42 * K;
    g.font = `900 ${fs}px "Arial Black", "Helvetica Neue", Impact, sans-serif`;
    g.fillStyle = 'rgba(40,8,4,.75)'; g.fillText(txt, tx + 1.2 * K, ty + 1.6 * K);              // engraved shadow
    g.strokeStyle = '#3a0e08'; g.lineWidth = 2.2 * K; g.strokeText(txt, tx, ty);
    const ng = g.createLinearGradient(0, ty - fs / 2, 0, ty + fs / 2); ng.addColorStop(0, '#fffbe6'); ng.addColorStop(1, '#f0cf88'); g.fillStyle = ng; g.fillText(txt, tx, ty);
    if (num[f] === 6 || num[f] === 9) { const w = g.measureText(txt).width; g.fillStyle = '#f6e8c0'; g.fillRect(tx - w / 2, ty + fs * 0.5, w, 1.8 * K); }
    for (const [u, v] of [T0, T1, T2]) uv.push((cx + u) / (CELL * 5), 1 - (cy + v) / (CELL * 4));
  }
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  const atlas = new THREE.CanvasTexture(ac); atlas.colorSpace = THREE.SRGBColorSpace; atlas.anisotropy = 8; atlas.generateMipmaps = true; atlas.minFilter = THREE.LinearMipmapLinearFilter; atlas.magFilter = THREE.LinearFilter;
  const mat = new THREE.MeshStandardMaterial({ map: atlas, flatShading: true, roughness: 0.32, metalness: 0.25 });
  die = new THREE.Mesh(geo, mat); die.userData = { normals, ups, num }; scene.add(die);
  R3 = r; return r;
}
function finalQuat(face) {
  const n = die.userData.normals[face], u = die.userData.ups[face];
  const y = u.clone().sub(n.clone().multiplyScalar(u.dot(n))).normalize(), x = new THREE.Vector3().crossVectors(y, n).normalize();
  const m = new THREE.Matrix4().set(x.x, x.y, x.z, 0, y.x, y.y, y.z, 0, n.x, n.y, n.z, 0, 0, 0, 0, 1); return new THREE.Quaternion().setFromRotationMatrix(m);
}
const clamp01 = (v) => Math.max(0, Math.min(1, v)), sm = (t) => t * t * (3 - 2 * t);

function run(o) {
  return new Promise((resolve) => {
    if (!R3) build();
    const DS = dieSize(); if (R3.domElement.width !== DS || R3.domElement.height !== DS) { R3.setPixelRatio(1); R3.setSize(DS, DS, false); }
    const d20 = Math.max(1, Math.min(20, o.d20 | 0 || 1)), degree = o.degree ?? 2;
    const face = die.userData.num.indexOf(d20); const qF = finalQuat(face);
    const q0 = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.random() * 6, Math.random() * 6, Math.random() * 6));
    const axis = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
    const host = document.getElementById('ui') || document.body;
    const box = document.createElement('div'); box.style.cssText = 'position:absolute;left:0;right:0;top:34%;display:flex;flex-direction:column;align-items:center;z-index:45;pointer-events:none;user-select:none;transition:opacity .15s';
    const dcv = document.createElement('canvas'); dcv.width = dcv.height = DS; dcv.style.cssText = 'width:21%;aspect-ratio:1;image-rendering:auto;filter:drop-shadow(0 .5em .6em #000c) drop-shadow(0 0 1.2em #ff8a3044)';
    const dg = dcv.getContext('2d'); dg.imageSmoothingEnabled = true;
    const label = o.label ? String(o.label) : '';
    const sign = (o.mod ?? 0) >= 0 ? '+' : '-', mod = Math.abs(o.mod ?? 0);
    const dcStr = o.dc != null ? ` vs ${o.dcLabel || 'KP'} ${o.dc}` : '';
    const tl = `k20: ${d20} ${sign} ${mod} = ${o.total ?? d20 + (o.mod ?? 0)}${dcStr} — ${o.degreeName ? String(o.degreeName).toUpperCase() : DEG[degree]}`;
    const tw = Math.max(measurePixelText(tl, 1), label ? measurePixelText(label, 1) : 0) + 14, th = label ? 31 : 21;
    const tc = document.createElement('canvas'); tc.width = tw; tc.height = th; tc.className = 'pix'; tc.style.cssText = `width:${(tw / 480 * 100).toFixed(2)}%;image-rendering:pixelated;margin-top:-1.5%;opacity:0;transform:scale(.8);transition:opacity .08s,transform .1s`;
    const tg = tc.getContext('2d'); tg.imageSmoothingEnabled = false; const colr = DEG_COL[degree];
    tg.fillStyle = '#0d0a09ee'; tg.fillRect(0, 0, tw, th); tg.fillStyle = colr; tg.fillRect(0, 0, tw, 1); tg.fillRect(0, th - 1, tw, 1); tg.fillRect(0, 0, 1, th); tg.fillRect(tw - 1, 0, 1, th); tg.fillStyle = '#000'; tg.fillRect(1, 1, tw - 2, 1);
    let ty = 7; if (label) { drawPixelText(tg, label, (tw - measurePixelText(label, 1)) / 2 | 0, 6, { color: '#c9b890', shadow: true }); ty = 18; }
    drawPixelText(tg, tl, 7, ty - (label ? 0 : 0), { color: colr, shadow: true });
    dcv.style.pointerEvents = tc.style.pointerEvents = 'auto'; dcv.style.cursor = tc.style.cursor = 'pointer';   // only the die and its label catch clicks; the rest of the strip stays click-through
    box.append(dcv, tc); host.appendChild(box);
    let t = 0, done = false, shown = false, last = performance.now(); const DUR = 1.1 + (o.hold || 0);
    const finish = () => { if (done) return; done = true; box.style.opacity = '0'; setTimeout(() => box.remove(), 160); resolve(); };
    box.addEventListener('pointerdown', (e) => { e.stopPropagation(); finish(); });
    setTimeout(finish, 1900 + (o.hold || 0) * 1000);
    const frame = (n) => {
      if (done) return;
      const dt = Math.max(0, Math.min(0.05, (n - last) / 1000)) || 0.016; last = n; t += dt;   // never negative (rAF time can lag performance.now())
      const k = clamp01(t / 0.72), spin = Math.pow(1 - k, 1.6) * 16;
      die.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(axis, spin * dt)); if (t === dt) die.quaternion.copy(q0);
      const blend = sm(clamp01((t - 0.3) / 0.45)); const qa = die.quaternion.clone().slerp(qF, blend * 0.5 + (k >= 1 ? 0.5 : 0)); die.quaternion.copy(k >= 0.99 ? qF : qa);
      const bounce = Math.abs(Math.sin(Math.min(t, 0.72) * 9)) * (1 - k) * 0.5; die.position.set((1 - k) * (Math.sin(t * 5)) * 0.25, bounce, 0); die.scale.setScalar(t < 0.1 ? 0.6 + Math.max(0, t) * 4 : 1 + (t > 0.72 && t < 0.85 ? Math.sin((t - 0.72) / 0.13 * 3.14) * 0.1 : 0));
      R3.setViewport(0, 0, DS, DS); R3.render(scene, cam); dg.clearRect(0, 0, DS, DS); dg.drawImage(R3.domElement, 0, 0, R3.domElement.width, R3.domElement.height, 0, 0, DS, DS);
      if (!shown && t > 0.62) { shown = true; tc.style.opacity = '1'; tc.style.transform = 'scale(1)'; }
      if (t >= DUR) return finish();
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
}
let chain = Promise.resolve();
export function showD20Roll(opts = {}) { const p = chain.then(() => run(opts)).catch((e) => { console.error(e); }); chain = p; return p; }
