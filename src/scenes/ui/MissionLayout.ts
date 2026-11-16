// Zapis układu okien HUD misji (pozycje, skale, rozmiar dziennika, karty drużyny) w localStorage.
// Zapis działa tylko przy włączonej opcji "Zapamiętuj układ okien misji" (Settings.layout); bez niej układ żyje do przeładowania strony.
// Moduł bez zależności od Phasera i UIScene (Widgets wywołuje stąd reset bez cyklu importów).
import { Settings } from './Settings';

const KEY = 'pyl-i-rdza-mission-layout-v1';

export interface XY {
  x: number;
  y: number;
}

export interface MissionLayoutData {
  panelPos: Record<string, XY | null>;
  panelScale: Record<string, number>;
  partyPos: XY | null;
  partyHoriz: boolean;
  partyScale: number;
  logSize: { w: number; h: number };
  /** Stopień czcionki paneli (0 = domyślna, ujemny = mniejsza, dodatni = większa). */
  fontStep?: Record<string, number>;
}

const isXY = (v: unknown): v is XY => !!v && typeof v === 'object' && Number.isFinite((v as XY).x) && Number.isFinite((v as XY).y);

const resetListeners = new Set<() => void>();
let source: (() => MissionLayoutData) | null = null;

export const MissionLayout = {
  /** Zapisany układ (null = brak / opcja wyłączona / uszkodzony zapis). Pola sprawdza wywołujący, poza kształtem. */
  load(): Partial<MissionLayoutData> | null {
    if (!Settings.values.layout) return null;
    try {
      const s = JSON.parse(localStorage.getItem(KEY) || 'null') as Partial<MissionLayoutData> | null;
      if (!s || typeof s !== 'object') return null;
      const out: Partial<MissionLayoutData> = {};
      if (s.panelPos && typeof s.panelPos === 'object') {
        out.panelPos = {};
        for (const [k, v] of Object.entries(s.panelPos)) out.panelPos[k] = isXY(v) ? { x: v.x, y: v.y } : null;
      }
      if (s.panelScale && typeof s.panelScale === 'object') {
        out.panelScale = {};
        for (const [k, v] of Object.entries(s.panelScale)) if (typeof v === 'number' && v > 0.1 && v < 4) out.panelScale[k] = v;
      }
      if (s.partyPos === null || isXY(s.partyPos)) out.partyPos = s.partyPos;
      if (typeof s.partyHoriz === 'boolean') out.partyHoriz = s.partyHoriz;
      if (typeof s.partyScale === 'number' && s.partyScale > 0.1 && s.partyScale < 4) out.partyScale = s.partyScale;
      if (s.fontStep && typeof s.fontStep === 'object') {
        out.fontStep = {};
        for (const [k, v] of Object.entries(s.fontStep)) if (Number.isInteger(v) && Math.abs(v) <= 8) out.fontStep[k] = v;
      }
      if (s.logSize && Number.isFinite(s.logSize.w) && Number.isFinite(s.logSize.h)) out.logSize = { w: s.logSize.w, h: s.logSize.h };
      return out;
    } catch {
      return null;
    }
  },
  /** Zapis układu (tylko przy włączonej opcji). */
  save(data: MissionLayoutData): void {
    if (!Settings.values.layout) return;
    try {
      localStorage.setItem(KEY, JSON.stringify(data));
    } catch {
      /* brak localStorage */
    }
  },
  /** Źródło bieżącego układu (UIScene) - do zapisu w chwili włączenia opcji. */
  setSource(f: () => MissionLayoutData): void {
    source = f;
  },
  /** Włącza / wyłącza zapamiętywanie: włączenie zapisuje bieżący układ, wyłączenie usuwa zapis. */
  setEnabled(on: boolean): void {
    Settings.set('layout', on);
    if (on && source) this.save(source());
    else if (!on) this.clear();
  },
  /** Usuwa zapis (bez zmiany bieżącego układu). */
  clear(): void {
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* ignoruj */
    }
  },
  /** Układ domyślny: usuwa zapis i powiadamia HUD misji (także poza misją - zeruje stan trzymany w pamięci). */
  reset(): void {
    this.clear();
    for (const f of resetListeners) f();
  },
  onReset(f: () => void): () => void {
    resetListeners.add(f);
    return () => resetListeners.delete(f);
  },
};
