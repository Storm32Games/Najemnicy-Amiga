// Core engine: WebGL renderer with selectable render resolution, main loop, input dispatch.
//
// Resolution model ("HD-2D"): the game is composed on a fixed 640x360 *design grid* (W, H) — cameras,
// UI layout, pixel-art textures and every "pixel" size in effects are expressed in these design pixels.
// The actual render target is W*pixelScale x H*pixelScale (presets below: 640x360 ... 3840x2160).
// The renderer's pixelRatio = pixelScale, so THREE.Points sizes (sizeAttenuation:false), viewports and
// getSize() stay in design pixels automatically; the post pass scales its pixel effects the same way.
// Code that needs real render pixels uses Engine.pixelScale / Engine.RW / Engine.RH and Engine.onResize(cb).
import * as THREE from '../../vendor/three.module.min.js';
import { createPost } from '../gfx/post.js';

export { THREE };

/** Design grid (composition) size. Kept for compatibility: NOT the render size any more (see Engine.RW/RH). */
export const W = 640, H = 360;

/** Selectable render resolutions. scale = render px per design px. */
export const RES_PRESETS = [
  { id: 'classic', w: 640, h: 360, scale: 1, label: 'Klasyczna 640×360', short: '640×360', note: 'gruby piksel, jak dawniej' },
  { id: 'hd', w: 1280, h: 720, scale: 2, label: 'HD 1280×720', short: 'HD' },
  { id: 'hdplus', w: 1600, h: 900, scale: 2.5, label: 'HD+ 1600×900', short: 'HD+' },
  { id: 'fhd', w: 1920, h: 1080, scale: 3, label: 'Full HD 1920×1080', short: 'FHD' },
  { id: 'qhd', w: 2560, h: 1440, scale: 4, label: 'QHD 2560×1440', short: 'QHD' },
  { id: 'uhd', w: 3840, h: 2160, scale: 6, label: '4K 3840×2160', short: '4K', note: 'wymaga mocnej karty' },
];
export const presetById = (id) => RES_PRESETS.find(p => p.id === id) || null;

/** Preset picked by "Automatyczna": the largest of HD..QHD whose height fits the physical pixel height of the game area. */
export function autoPreset() {
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const wrap = document.getElementById('wrap');
  const cssH = wrap?.clientHeight || Math.min(window.innerHeight, window.innerWidth * 9 / 16);
  const physH = cssH * dpr;
  const cands = RES_PRESETS.filter(p => ['hd', 'hdplus', 'fhd', 'qhd'].includes(p.id));
  let best = cands[0];
  for (const p of cands) if (p.h <= physH * 1.08) best = p;
  return best;
}

export const Engine = {
  THREE, W, H,
  /** Current render size in real pixels and render px per design px. */
  RW: W, RH: H, pixelScale: 1, preset: RES_PRESETS[0], resMode: 'classic',
  canvas: null, renderer: null, post: null,
  time: 0,
  current: null,          // current scene object
  _resizeCbs: new Set(),
  _shadowK: 1,
  init() {
    this.canvas = document.getElementById('view');
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: false });
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(W, H, false);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.BasicShadowMap;
    this.renderer.setClearColor(0x000000, 1);
    try { this.post = createPost(this.renderer, W, H); } catch (e) { console.warn('post disabled', e); this.post = null; }
    this._bindInput();
    let rt = 0;
    window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => this._onWindowResize(), 200); });
    document.addEventListener('fullscreenchange', () => setTimeout(() => this._onWindowResize(), 120));
  },
  /**
   * Set the render resolution: a preset id ('classic','hd','hdplus','fhd','qhd','uhd') or 'auto'.
   * Applies immediately (renderer, post targets, shadow maps); scene state is untouched.
   */
  setResolution(mode = 'auto') {
    const p = mode === 'auto' ? autoPreset() : (presetById(mode) || autoPreset());
    this.resMode = presetById(mode) ? mode : 'auto';
    const changed = p !== this.preset || !this.renderer || this.canvas.width !== Math.floor(W * p.scale);
    this.preset = p;
    if (changed && this.renderer) {
      const s = p.scale; this.pixelScale = s;
      this.renderer.setPixelRatio(s);
      this.renderer.setSize(W, H, false);              // canvas buffer = W*s x H*s; CSS size is set by #view rules
      this.RW = this.canvas.width; this.RH = this.canvas.height;
      this.post?.setSize?.(this.RW, this.RH, s);
      // shadow maps: keep shadow texel density roughly matched to screen pixels (base 1024 at 640x360)
      this._shadowK = s <= 1 ? 1 : s <= 2 ? 2 : s <= 3 ? 3 : 4;
      for (const cb of this._resizeCbs) { try { cb({ width: this.RW, height: this.RH, scale: s, preset: p }); } catch (e) { console.error(e); } }
    }
    this._updateCanvasFilter();
    return p;
  },
  /** Subscribe to render-resolution changes: cb({width, height, scale, preset}). Returns an unsubscribe function. */
  onResize(cb) { this._resizeCbs.add(cb); return () => this._resizeCbs.delete(cb); },
  /** Design pixels -> render pixels. */
  px(n) { return n * this.pixelScale; },
  /** Post-effect toggles: {scanlines, grain, dither} (booleans). */
  setEffects(fx) { this.post?.setEffects?.(fx); },
  _onWindowResize() {
    if (this.resMode === 'auto') this.setResolution('auto'); else this._updateCanvasFilter();
  },
  /** Nearest-neighbour CSS upscale only where it looks right (integer-ish or large magnification); smooth otherwise. */
  _updateCanvasFilter() {
    if (!this.canvas) return;
    const dpr = window.devicePixelRatio || 1, shown = (this.canvas.clientWidth || this.canvas.width) * dpr;
    const k = shown / this.canvas.width;
    const pix = k >= 1.9 || Math.abs(k - Math.round(k)) < 0.04;
    this.canvas.style.imageRendering = pix ? 'pixelated' : 'auto';
  },
  /** Render a scene with the post pipeline (if available). */
  render(scene, camera) {
    this._syncShadows(scene);
    if (this.post && this.post.render) this.post.render(scene, camera);
    else this.renderer.render(scene, camera);
  },
  /** Scale shadow map sizes of every shadow-casting light in the scene with the render resolution. */
  _syncShadows(scene) {
    const u = scene.userData; const n = (u.__shN = (u.__shN || 0) + 1);
    if (u.__shK === this._shadowK && n % 120 !== 0) return;   // re-check periodically for lights added later
    u.__shK = this._shadowK;
    const max = Math.min(4096, this.renderer.capabilities.maxTextureSize || 4096);
    scene.traverse(o => {
      if (!o.isLight || !o.castShadow || !o.shadow) return;
      const sh = o.shadow, base = (o.userData.__shBase ||= sh.mapSize.x);
      const want = Math.min(max, base * this._shadowK);
      if (sh.mapSize.x !== want) { sh.mapSize.set(want, want); if (sh.map) { sh.map.dispose(); sh.map = null; } }
    });
  },
  /** Convert a DOM pointer event to normalized device coords (-1..1) over the canvas. */
  pointerNDC(ev) {
    const r = this.canvas.getBoundingClientRect();
    return new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
  },
  /** True when keyboard focus is in a text field (scene hotkeys must not fire). */
  typing(ev) {
    const t = ev?.target || document.activeElement;
    return !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || '')) && !(t.tagName === 'INPUT' && /^(range|checkbox|radio|button)$/.test(t.type));
  },
  _bindInput() {
    const c = this.canvas;
    const call = (fn, ev, withNdc = true) => {
      const s = this.current; if (!s || typeof s[fn] !== 'function') return;
      try { s[fn](ev, withNdc ? this.pointerNDC(ev) : undefined); } catch (e) { console.error(e); }
    };
    c.addEventListener('pointerdown', e => call('onPointerDown', e));
    c.addEventListener('pointermove', e => call('onPointerMove', e));
    c.addEventListener('pointerup', e => call('onPointerUp', e));
    c.addEventListener('wheel', e => { e.preventDefault(); call('onWheel', e); }, { passive: false });
    c.addEventListener('contextmenu', e => e.preventDefault());
    window.addEventListener('keydown', e => {
      if (this.typing(e)) return;                       // typing a name etc.: no scene hotkeys
      if (document.querySelector('#ui .settings-back')) return;   // options modal open
      call('onKey', e, false);
    });
  },
  start(tick) {
    let last = performance.now();
    const loop = (now) => {
      const dt = Math.min(0.1, (now - last) / 1000); last = now; this.time += dt;
      try { tick(dt, this.time); } catch (e) { console.error(e); }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  },
};
