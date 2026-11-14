// settings.js — player options: render resolution, fullscreen, retro effects, UI size, audio.
// Persisted in localStorage (separate from the save game). Contract: Settings.open() shows the options
// modal and returns a Promise resolved when it is closed. Settings.init() applies stored options at boot.
import { Engine, RES_PRESETS, presetById, autoPreset } from './engine.js';
import { UI } from './ui.js';
import { Audio } from '../audio/audio.js';

const KEY = 'pyl-i-rdza-settings-v1';
const DEFAULTS = { res: 'auto', scanlines: true, grain: true, dither: true, ui: 1 };
const UI_SIZES = [[0.9, 'Mały'], [1, 'Normalny'], [1.15, 'Duży'], [1.3, 'Bardzo duży']];

function read() {
  try { const s = JSON.parse(localStorage.getItem(KEY) || 'null'); if (s && typeof s === 'object') return { ...DEFAULTS, ...s }; } catch { }
  return { ...DEFAULTS };
}
function write(o) { try { localStorage.setItem(KEY, JSON.stringify(o)); } catch { } }

let open = null;   // resolves the open modal

export const Settings = {
  values: { ...DEFAULTS },
  /** Apply stored settings (call once after Engine.init / UI.init). `?res=<id|auto>` in the URL overrides (not saved). */
  init() {
    this.values = read();
    const q = new URLSearchParams(location.search).get('res');
    if (q && (q === 'auto' || presetById(q))) this.values.res = q;
    if (!(this.values.res === 'auto' || presetById(this.values.res))) this.values.res = 'auto';
    this.apply();
  },
  apply() {
    const v = this.values;
    Engine.setResolution(v.res);
    Engine.setEffects({ scanlines: v.scanlines, grain: v.grain, dither: v.dither });
    document.documentElement.style.setProperty('--ui-scale', String(+v.ui || 1));
  },
  set(k, val) { this.values[k] = val; write(this.values); this.apply(); },
  /** Show the options modal. Resolves when closed. */
  open() {
    if (open && open.back.isConnected) return open.p;
    if (open) open.cleanup();
    let resolve; const p = new Promise(r => (resolve = r));
    const back = UI.el('div', { class: 'modal-back settings-back' });
    const box = UI.el('div', { class: 'panel modal settings' });
    back.append(box);
    const cleanup = () => { window.removeEventListener('keydown', onKey, true); document.removeEventListener('fullscreenchange', draw); open = null; resolve(); };
    const close = () => { if (!open) return; back.remove(); cleanup(); };
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } };
    window.addEventListener('keydown', onKey, true);
    back.addEventListener('pointerdown', (e) => { if (e.target === back) close(); });
    const v = this.values;
    const opt = (label, on, fn, title) => { const b = UI.button(label, fn, { title, class: on ? 'primary on' : '' }); return b; };
    const toggle = (label, key, title) => UI.el('div', { class: 'set-row' }, UI.el('span', {}, label),
      opt(v[key] ? 'Wł.' : 'Wył.', v[key], () => { this.set(key, !v[key]); draw(); }, title));
    const slider = (label, key, vol) => {
      const out = UI.el('span', { class: 'amber', style: 'width:3.2em;text-align:right' }, Math.round(vol[key] * 100) + '%');
      const inp = UI.el('input', { type: 'range', min: 0, max: 100, value: Math.round(vol[key] * 100), style: 'flex:1;accent-color:#f2a93b;min-width:6em' });
      inp.addEventListener('input', () => { vol[key] = inp.value / 100; out.textContent = inp.value + '%'; Audio.setVolume({ [key]: vol[key] }); });
      inp.addEventListener('change', () => Audio.sfx('click'));
      return UI.el('div', { class: 'set-row' }, UI.el('span', {}, label), inp, out);
    };
    const draw = () => {
      const cur = Engine.preset, auto = autoPreset();
      const res = UI.el('div', { class: 'set-res' });
      const mk = (id, label, sub) => { const on = v.res === id; const b = UI.button('', () => { this.set('res', id); Audio.sfx('click'); draw(); }, { class: on ? 'primary on' : '' }); b.append(UI.el('span', {}, (on ? '● ' : '○ ') + label), sub ? UI.el('small', { class: 'dim' }, sub) : ''); return b; };
      res.append(mk('auto', 'Automatyczna', `dopasowana do okna — teraz ${auto.short} ${auto.w}×${auto.h}`));
      for (const pr of RES_PRESETS) res.append(mk(pr.id, pr.label, pr.note || ''));
      const dpr = window.devicePixelRatio || 1, wrap = document.getElementById('wrap');
      const physW = Math.round((wrap?.clientWidth || 0) * dpr), physH = Math.round((wrap?.clientHeight || 0) * dpr);
      const fs = !!document.fullscreenElement;
      const uiRow = UI.el('div', { class: 'set-row' }, UI.el('span', {}, 'Rozmiar interfejsu'),
        UI.el('div', { class: 'set-seg' }, ...UI_SIZES.map(([k, l]) => opt(l, Math.abs((+v.ui || 1) - k) < 0.01, () => { this.set('ui', k); draw(); }))));
      const vol = Audio.getVolume ? Audio.getVolume() : { master: 0.8, music: 0.5, sfx: 0.8 };
      box.replaceChildren(
        UI.el('h2', {}, 'Opcje'),
        UI.el('div', { class: 'set-cols' },
          UI.el('div', {},
            UI.el('h3', {}, 'Rozdzielczość obrazu'), res,
            UI.el('div', { class: 'dim set-note' }, `Teraz: ${cur.w}×${cur.h} · obszar gry na ekranie: ${physW}×${physH} px`)),
          UI.el('div', {},
            UI.el('h3', {}, 'Ekran'),
            UI.el('div', { class: 'set-row' }, UI.el('span', {}, 'Pełny ekran'), opt(fs ? 'Wł.' : 'Wył.', fs, () => this.toggleFullscreen(), 'Klawisz F11 w przeglądarce działa tak samo')),
            uiRow,
            UI.el('h3', { style: 'margin-top:.8em' }, 'Efekty retro'),
            toggle('Linie skanowania', 'scanlines', 'Delikatne poziome pasy jak na monitorze CRT'),
            toggle('Ziarno filmu', 'grain', 'Migoczący szum obrazu'),
            toggle('Dithering i paleta', 'dither', 'Ograniczona paleta z rastrem Bayera'),
            UI.el('h3', { style: 'margin-top:.8em' }, 'Dźwięk'),
            slider('Głośność', 'master', vol), slider('Muzyka', 'music', vol), slider('Efekty', 'sfx', vol),
            UI.el('div', { class: 'set-row' }, UI.el('span', {}, 'Wycisz wszystko'), opt(Audio.muted ? 'Tak' : 'Nie', Audio.muted, () => { Audio.muted = !Audio.muted; draw(); })))),
        UI.el('div', { class: 'row' }, UI.button('Gotowe', close, { class: 'primary' })));
    };
    document.addEventListener('fullscreenchange', draw);
    draw();
    UI.root.append(back);
    open = { p, close, cleanup, back };
    return p;
  },
  close() { open?.close(); },
  get isOpen() { return !!open; },
  async toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
    } catch (e) { UI.toast('Pełny ekran niedostępny w tej przeglądarce.'); }
  },
};
