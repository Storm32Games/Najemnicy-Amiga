// Game: scene manager + persistent campaign state.
import { Engine } from './engine.js';
import { UI } from './ui.js';

const SAVE_KEY = 'pyl-i-rdza-save-v1';

export function freshState() {
  return {
    version: 1,
    party: [],            // up to 4 Character objects (see docs/DESIGN.md)
    scrap: 120,           // currency: "Złom"
    day: 1,
    rep: { nomads: 0, survivors: 0 },
    stash: [],            // shared inventory: item instances {uid, id, qty}
    contracts: [],        // current contract board: contract objects (see DESIGN)
    completed: [],        // contract ids completed
    story: 0,             // main story progression stage
    flags: {},
    log: [],
  };
}

export const Game = {
  scenes: {},
  current: null, currentName: null,
  state: freshState(),
  params: new URLSearchParams(location.search),
  register(name, scene) { this.scenes[name] = scene; },
  goto(name, params = {}) {
    const next = this.scenes[name];
    if (!next) { console.error('Unknown scene', name); return; }
    if (this.current) { try { this.current.exit?.(); } catch (e) { console.error(e); } }
    UI.clear();
    this.current = next; this.currentName = name; Engine.current = next;
    try { next.enter?.(params); } catch (e) { console.error('enter failed: ' + name, e); }
  },
  newGame() { this.state = freshState(); },
  save() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(this.state)); return true; } catch (e) { console.warn(e); return false; } },
  hasSave() { try { return !!localStorage.getItem(SAVE_KEY); } catch { return false; } },
  load() {
    try { const s = JSON.parse(localStorage.getItem(SAVE_KEY)); if (s && s.version === 1) { this.state = Object.assign(freshState(), s); return true; } } catch (e) { console.warn(e); }
    return false;
  },
  deleteSave() { try { localStorage.removeItem(SAVE_KEY); } catch {} },
  tick(dt, t) {
    const s = this.current; if (!s) return;
    s.update?.(dt, t);
    if (s.render) s.render(Engine);
    else if (s.scene && s.camera) Engine.render(s.scene, s.camera);
  },
};
window.Game = Game; // for testing / debugging in the console
