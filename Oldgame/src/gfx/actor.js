// ActorSprite: billboard mesh using a cached pre-drawn sheet; animation by UV offset.
import { THREE } from '../core/engine.js';
import { analyze } from './look.js';
import { buildSheet, FW, FH, GY, ANIMS } from './spritedraw.js';
import { buildHeroSheet } from './hero.js';
import { buildCreatureSheet } from './creature.js';
import { canvasTex, mkCanvas } from './util.js';

const sheets = new Map();
function getSheet(A) {
  let s = sheets.get(A.key);
  if (!s) {
    const b = A.kind === 'human' ? buildHeroSheet(A) : (buildCreatureSheet(A) || { ...buildSheet(A), anims: ANIMS, fw: FW, fh: FH, gy: GY, hpx: 44, cols: 4, rows: 7 });
    s = { ...b, tex: canvasTex(b.canvas) }; sheets.set(A.key, s);
  }
  return s;
}
let geo = null, shadowTex = null, ringGeo = null;
function shadowTexture() {
  if (shadowTex) return shadowTex;
  const [c, g] = mkCanvas(32, 16);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 32; x++) { const dx = (x + 0.5 - 16) / 16, dy = (y + 0.5 - 8) / 8, d = dx * dx + dy * dy; if (d < 1) { const a = d < 0.3 ? 0.95 : d < 0.55 ? 0.78 : d < 0.8 ? 0.5 : 0.25; g.fillStyle = `rgba(10,6,4,${a})`; g.fillRect(x, y, 1, 1); } }
  return (shadowTex = canvasTex(c));
}

function makeMaterial(sheet) {
  const m = new THREE.MeshBasicMaterial({ map: sheet.tex, transparent: true, alphaTest: 0.5, side: THREE.DoubleSide, fog: true });
  const u = { uUv: { value: new THREE.Vector4(0, 0, 1, 1) }, uTint: { value: new THREE.Vector3(1, 1, 1) }, uFlash: { value: 0 }, uOut: { value: new THREE.Vector4(0, 0, 0, 0) }, uTexel: { value: new THREE.Vector2(1 / sheet.canvas.width, 1 / sheet.canvas.height) }, uShade: { value: new THREE.Vector3(1, 1, 1) } };
  m.userData.u = u;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader.replace('#include <uv_vertex>', '#ifdef USE_MAP\n vMapUv = uv * uUv.zw + uUv.xy;\n#endif').replace('void main() {', 'uniform vec4 uUv;\nvoid main() {');
    sh.fragmentShader = sh.fragmentShader.replace('void main() {', 'uniform vec3 uTint; uniform float uFlash; uniform vec4 uOut; uniform vec2 uTexel; uniform vec3 uShade;\nvoid main() {')
      .replace('#include <map_fragment>', `#include <map_fragment>
        if (uOut.a > 0.0 && sampledDiffuseColor.a < 0.5) {
          float na = texture2D(map, vMapUv + vec2(uTexel.x, 0.0)).a + texture2D(map, vMapUv - vec2(uTexel.x, 0.0)).a + texture2D(map, vMapUv + vec2(0.0, uTexel.y)).a + texture2D(map, vMapUv - vec2(0.0, uTexel.y)).a;
          if (na > 0.5) diffuseColor = vec4(uOut.rgb, 1.0);
        }
        diffuseColor.rgb = mix(diffuseColor.rgb * uShade, uTint, uFlash * step(0.5, diffuseColor.a));`);
  };
  m.customProgramCacheKey = () => 'actorsprite';
  return m;
}

const _v = new THREE.Vector3();
export function createActorSprite(desc) {
  const A = analyze(desc || {}); const sheet = getSheet(A);
  if (!geo) { geo = new THREE.PlaneGeometry(1, 1); ringGeo = new THREE.RingGeometry(0.42, 0.52, 32); }
  const root = new THREE.Object3D(); root.name = 'actor';
  const SW = sheet.fw, SH = sheet.fh, SG = sheet.gy, AN = sheet.anims;
  const u = 1.7 / sheet.hpx, sc = A.scale;   // sheet.hpx = sheet pixels per 1.7 world units
  const mat = makeMaterial(sheet);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.scale.set(SW * u * sc, SH * u * sc, 1);
  mesh.position.y = (SH / 2 - (SH - SG)) * u * sc; // ground row -> y=0
  mesh.frustumCulled = false; mesh.renderOrder = 2;
  const holder = new THREE.Object3D(); holder.add(mesh); root.add(holder);
  let facing = 1, flip = 1;
  mesh.onBeforeRender = (r, s, cam) => {
    const tn = s && s.userData && s.userData.spriteTint; if (tn) u2.uShade.value.set(tn.r * shadeK, tn.g * shadeK, tn.b * shadeK);
    cam.getWorldDirection(_v); const yaw = Math.atan2(-_v.x, -_v.z);
    mesh.quaternion.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, yaw);
    mesh.scale.x = Math.abs(mesh.scale.x) * flip; mesh.updateMatrix();
    mesh.matrixWorld.multiplyMatrices(root.matrixWorld, mesh.matrix);
  };
  // shadow blob
  const sh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false, opacity: 0.55, fog: false }));
  const shw = sheet.shadow ? sheet.shadow * sc : (A.kind === 'beast' ? 1.5 : A.kind === 'insect' ? 1.3 : A.kind === 'turret' ? 1.7 : 1.0) * sc * (A.variant === 'rat' ? 0.7 : 1);
  sh.rotation.order = 'YXZ'; sh.rotation.x = -Math.PI / 2;
  sh.onBeforeRender = (r, s2, cam) => { if (!dead || !sheet.lyingShadow) return; cam.getWorldDirection(_v); sh.rotation.y = Math.atan2(-_v.x, -_v.z); sh.position.x = -0.35 * flip * sc * Math.cos(sh.rotation.y); sh.position.z = 0.35 * flip * sc * Math.sin(sh.rotation.y); sh.updateMatrix(); sh.matrixWorld.multiplyMatrices(root.matrixWorld, sh.matrix); }; sh.scale.set(shw, shw * 0.55, 1); sh.position.y = 0.02; sh.renderOrder = 1; root.add(sh);
  // selection ring
  const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xf2c03b, transparent: true, opacity: 0.95, depthWrite: false, fog: false }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.04; ring.visible = false; ring.renderOrder = 1; ring.scale.set(sc, sc * 0.8, 1); root.add(ring);
  // state
  let shadeK = 1, anim = 'idle', frame = 0, step = 0, t = 0, selected = false, flashT = 0, hl = null, dead = false, time = Math.random() * 10;
  // per-anim playback: optional seq (frame order) and durs (per-step durations); legacy sheets use n x dur
  const steps = (a) => a.seq ? a.seq.length : a.n;
  const durOf = (a, k) => (a.durs && a.durs[k] != null) ? a.durs[k] : a.dur;
  const frameOf = (a, k) => a.seq ? a.seq[k] : k;
  const setFrame = () => {
    const row = sheet.info[anim].row;
    u2.uUv.value.set(frame / sheet.cols, 1 - (row + 1) / sheet.rows, 1 / sheet.cols, 1 / sheet.rows);
  };
  const u2 = mat.userData.u;
  if (AN.idle && AN.idle.loop && steps(AN.idle) > 1) { step = Math.floor(Math.random() * steps(AN.idle)); frame = frameOf(AN.idle, step); t = Math.random() * durOf(AN.idle, step); }
  setFrame();
  const api = {
    object3d: root, kind: A.kind, appearance: A,
    play(a) {
      if (!AN[a]) a = 'idle'; if (dead) return; if (a === anim && AN[a].loop) return;   // looping anims (idle/walk) continue instead of restarting
      anim = a; step = 0; t = 0; frame = frameOf(AN[a], 0); if (a === 'die') dead = true; if (a === 'hurt') flashT = 0.2; setFrame();
    },
    setFacing(dx) { if (dx > 0.001) flip = 1; else if (dx < -0.001) flip = -1; },
    update(dt) {
      time += dt; const a = AN[anim];
      t += dt;
      let cur = AN[anim], guard = 0;
      while (t >= durOf(cur, step) && guard++ < 64) {
        t -= durOf(cur, step); step++;
        if (step >= steps(cur)) {
          if (cur.loop) step = 0; else if (cur.hold) { step = steps(cur) - 1; t = 0; break; } else { anim = 'idle'; step = 0; cur = AN.idle; }
        }
      }
      frame = frameOf(cur, step);
      setFrame();
      // hit flash: a white pop, then a short red fade
      if (flashT > 0) { flashT -= dt; const k = flashT > 0.13 ? 1 : Math.max(0, flashT / 0.13) * 0.55; u2.uFlash.value = k; if (flashT > 0.13) u2.uTint.value.set(1, 1, 1); else u2.uTint.value.set(1, 0.25, 0.18); } else u2.uFlash.value = 0;
      if (selected && !dead) { ring.material.opacity = 0.65 + 0.3 * Math.sin(time * 6); const k = 1 + 0.04 * Math.sin(time * 6); ring.scale.set(sc * k, sc * k * 0.8, 1); }
      if (dead) { sh.material.opacity = Math.max(0.35, sh.material.opacity - dt * 0.3); if (sheet.lyingShadow) { sh.scale.x = Math.min(shw * 1.8, sh.scale.x + dt * shw * 4); } }
    },
    setHighlight(c) {
      hl = c || null;
      if (c) { const col = new THREE.Color(c); u2.uOut.value.set(col.r, col.g, col.b, 1); shadeK = 1.12; }
      else { u2.uOut.value.set(0, 0, 0, 0); shadeK = 1; }
    },
    setSelected(b) { selected = !!b; ring.visible = selected && !dead; },
    get anim() { return anim; }, get facing() { return flip; },
    dispose() { mat.dispose(); sh.material.dispose(); ring.material.dispose(); root.removeFromParent(); },
  };
  const hlPulse = false;
  return api;
}
/** Debug/utility: the pre-drawn sprite sheet canvas for a desc (layout: see sheet.info / cols / rows). */
export function spriteSheetCanvas(desc) { return getSheet(analyze(desc || {})).canvas; }
