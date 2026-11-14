// Post pipeline: render scene to a target at render resolution, then one full-screen pass to the canvas:
// bloom, grade, ordered dither + colour quantisation, vignette, scanlines, grain.
// Pixel-based effect sizes are expressed in *design pixels* (640x360 grid) and scaled with the render
// resolution, so the retro character survives at HD/FHD/QHD instead of turning into 1-pixel noise.
// Above 640x360 the bloom reads a cheap 640x360 linear downsample (one tiny extra pass), which keeps the
// classic bloom shape without ring artefacts from sparse taps at large offsets.
import * as THREE from '../../vendor/three.module.min.js';

const VERT = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const FRAG = `
precision highp float;
uniform sampler2D tDiffuse; uniform sampler2D tBloom;
uniform vec2 uRes; uniform vec2 uBloomRes; uniform float uTime; uniform float uSrgb;
uniform float uDitherPx; uniform float uScanPx; uniform float uGrainPx;
uniform float uDither; uniform float uScan; uniform float uGrain;
varying vec2 vUv;
float bayer4(vec2 p){
  vec2 q = mod(floor(p), 4.0);
  float i = q.x + q.y * 4.0;
  // 4x4 bayer
  float v = 0.0;
  if(i<0.5) v=0.0; else if(i<1.5) v=8.0; else if(i<2.5) v=2.0; else if(i<3.5) v=10.0;
  else if(i<4.5) v=12.0; else if(i<5.5) v=4.0; else if(i<6.5) v=14.0; else if(i<7.5) v=6.0;
  else if(i<8.5) v=3.0; else if(i<9.5) v=11.0; else if(i<10.5) v=1.0; else if(i<11.5) v=9.0;
  else if(i<12.5) v=15.0; else if(i<13.5) v=7.0; else if(i<14.5) v=13.0; else v=5.0;
  return (v + 0.5) / 16.0;
}
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec3 toS(vec3 c){ return mix(c * 12.92, 1.055 * pow(max(c, 0.0), vec3(1.0/2.4)) - 0.055, step(0.0031308, c)); }
void main(){
  vec2 px = 1.0 / uBloomRes;            // one design pixel
  vec3 c = texture2D(tDiffuse, vUv).rgb;
  // cheap bloom: bright neighbours (in linear light)
  vec3 b = vec3(0.0);
  for(int i=0;i<8;i++){
    float a = float(i) * 0.785398;
    vec2 o = vec2(cos(a), sin(a));
    vec3 s1 = texture2D(tBloom, vUv + o * px * 2.0).rgb;
    vec3 s2 = texture2D(tBloom, vUv + o * px * 5.0).rgb;
    b += max(s1 - 0.8, 0.0) * 0.55 + max(s2 - 0.75, 0.0) * 0.45;
  }
  c += b * 0.16 * vec3(1.0, 0.92, 0.8);
  c = (uSrgb > 0.5) ? toS(clamp(c, 0.0, 1.0)) : clamp(c, 0.0, 1.0);
  // gentle grade: warm highlights, cool-purple shadows, slight contrast
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  c = mix(c, c * vec3(1.06, 1.0, 0.9), smoothstep(0.35, 0.9, l));
  c = mix(c, c * vec3(0.9, 0.92, 1.1) + vec3(0.01, 0.0, 0.025), 1.0 - smoothstep(0.0, 0.4, l));
  c = mix(vec3(l), c, 1.08);
  c = (c - 0.5) * 1.06 + 0.5;
  // ordered dithering + colour quantisation (28 levels); off -> plain 8-bit output
  vec2 fp = vUv * uRes;
  float lv = 28.0;
  if (uDither > 0.5) c = floor(c * lv + bayer4(fp / uDitherPx) * 0.9 + 0.05) / lv;
  // vignette
  vec2 d = vUv - 0.5; d.x *= 1.05;
  float v = 1.0 - smoothstep(0.38, 0.95, length(d) * 1.15);
  c *= mix(0.62, 1.0, v);
  // faint scanlines
  c *= 1.0 - uScan * 0.045 * step(1.0, mod(floor(fp.y / uScanPx), 2.0));
  // film grain
  float g = hash12(floor(fp / uGrainPx) + floor(uTime * 24.0) * 17.0) - 0.5;
  c += g * 0.028 * uGrain;
  gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;
// 4 bilinear taps = 4x4 source texels averaged per design pixel (for scale <= 4; enough for bloom input)
const DOWN = `
precision highp float; uniform sampler2D tSrc; uniform vec2 uDst; varying vec2 vUv;
void main(){ vec2 o = 0.25 / uDst;
  gl_FragColor = vec4((texture2D(tSrc, vUv + vec2(-o.x,-o.y)).rgb + texture2D(tSrc, vUv + vec2(o.x,-o.y)).rgb
    + texture2D(tSrc, vUv + vec2(-o.x,o.y)).rgb + texture2D(tSrc, vUv + vec2(o.x,o.y)).rgb) * 0.25, 1.0); }`;

/**
 * Effect pixel sizes per render scale (render px per "effect pixel"). Tuned from screenshots:
 * dither cell and grain follow roughly half the design pixel (finer than classic, still visible),
 * scanlines keep the classic pitch of 2 design pixels (subtle CRT feel at any resolution).
 */
function fxSizes(s) {
  if (s <= 1) return { dither: 1, scan: 1, grain: 1 };
  return { dither: Math.max(1, Math.round(s / 2)), scan: Math.max(1, Math.round(s * 0.5)), grain: Math.max(1, Math.round(s / 2)) };
}

export function createPost(renderer, W, H) {
  let type = THREE.HalfFloatType, scale = 1, rw = W, rh = H;
  const dw = W, dh = H;   // design grid = bloom resolution
  const mkRT = (w, h, filt, depth) => new THREE.WebGLRenderTarget(w, h, { type, minFilter: filt, magFilter: filt, depthBuffer: depth, generateMipmaps: false });
  let rt = mkRT(W, H, THREE.NearestFilter, true);
  let small = null;   // design-resolution bloom source, only when scale > 1
  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG, depthTest: false, depthWrite: false,
    uniforms: {
      tDiffuse: { value: rt.texture }, tBloom: { value: rt.texture }, uRes: { value: new THREE.Vector2(W, H) }, uBloomRes: { value: new THREE.Vector2(W, H) },
      uTime: { value: 0 }, uSrgb: { value: 1 }, uDitherPx: { value: 1 }, uScanPx: { value: 1 }, uGrainPx: { value: 1 },
      uDither: { value: 1 }, uScan: { value: 1 }, uGrain: { value: 1 },
    },
  });
  const downMat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: DOWN, depthTest: false, depthWrite: false, uniforms: { tSrc: { value: rt.texture }, uDst: { value: new THREE.Vector2(dw, dh) } } });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat); quad.frustumCulled = false;
  const scene = new THREE.Scene(); scene.add(quad);
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  let failed = false;
  const api = {
    target: rt,
    get scale() { return scale; },
    /** Resize to render size w x h (real px); s = render px per design px. Recreates targets (no per-frame cost). */
    setSize(w, h, s = w / W) {
      rw = w; rh = h; scale = s;
      rt.dispose(); rt = mkRT(w, h, s > 1 ? THREE.LinearFilter : THREE.NearestFilter, true); api.target = rt;
      if (s > 1) { if (!small) small = mkRT(dw, dh, THREE.LinearFilter, false); }
      else if (small) { small.dispose(); small = null; }
      mat.uniforms.tDiffuse.value = rt.texture; downMat.uniforms.tSrc.value = rt.texture;
      mat.uniforms.tBloom.value = small ? small.texture : rt.texture;
      mat.uniforms.uRes.value.set(w, h); mat.uniforms.uBloomRes.value.set(small ? dw : w, small ? dh : h);
      const f = fxSizes(s); mat.uniforms.uDitherPx.value = f.dither; mat.uniforms.uScanPx.value = f.scan; mat.uniforms.uGrainPx.value = f.grain;
    },
    setEffects({ scanlines, grain, dither } = {}) {
      if (scanlines != null) mat.uniforms.uScan.value = scanlines ? 1 : 0;
      if (grain != null) mat.uniforms.uGrain.value = grain ? 1 : 0;
      if (dither != null) mat.uniforms.uDither.value = dither ? 1 : 0;
    },
    render(sc, camera) {
      if (failed) return renderer.render(sc, camera);
      mat.uniforms.uSrgb.value = renderer.outputColorSpace === THREE.SRGBColorSpace ? 1 : 0;
      mat.uniforms.uTime.value = performance.now() / 1000;
      const prevTarget = renderer.getRenderTarget();
      renderer.setRenderTarget(rt); renderer.clear(); renderer.render(sc, camera);
      if (small) { quad.material = downMat; renderer.setRenderTarget(small); renderer.render(scene, cam); quad.material = mat; }
      renderer.setRenderTarget(prevTarget); renderer.render(scene, cam);
    },
    dispose() { rt.dispose(); small?.dispose(); mat.dispose(); downMat.dispose(); },
  };
  return api;
}
