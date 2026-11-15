// Opcje gracza (port Oldgame/src/core/settings.js): rozdzielczość, rozmiar interfejsu, efekty retro, profil Amiga. Głośność i wyciszenie trzyma SoundManager.
// Zapis w localStorage pod tym samym kluczem co w Oldgame - osobno od zapisu gry. `?res=auto|2..6` w URL nadpisuje (bez zapisu).
// Moduł bez zależności od Kit.ts (Kit czyta stąd rozdzielczość przy starcie).

const KEY = 'pyl-i-rdza-settings-v1';

/** 'auto' = największy zoom mieszczący się w oknie; liczba = stały zoom (piksele płótna na piksel projektowy 480x270). */
export type ResSetting = 'auto' | 2 | 3 | 4 | 5 | 6;
export const RES_CHOICES: readonly ResSetting[] = ['auto', 2, 3, 4, 5, 6];

/** Rozmiar interfejsu (Oldgame/src/core/settings.js:9 UI_SIZES): skala okien, podpowiedzi i komunikatów. */
export const UI_SIZES: readonly (readonly [number, string])[] = [[0.9, 'Mały'], [1, 'Normalny'], [1.15, 'Duży'], [1.3, 'Bardzo duży']];

export interface SettingsValues {
  res: ResSetting;
  /** Rozmiar interfejsu: jedna z wartości UI_SIZES (0.9 / 1 / 1.15 / 1.3). */
  ui: number;
  scanlines: boolean;
  grain: boolean;
  dither: boolean;
  /**
   * Profil sprzętowy A1200 + PiStorm (miniGL): logika i rysowanie w 50 Hz (PAL), bez pełnoekranowych nakładek
   * z mieszaniem alfa (linie / ziarno / raster), bez tekstur większych niż 256x256 w logo. Podgląd budżetu docelowego.
   */
  amiga: boolean;
}

const DEFAULTS: SettingsValues = { res: 'auto', ui: 1, scanlines: true, grain: true, dither: true, amiga: false };

const validRes = (v: unknown): v is ResSetting => v === 'auto' || (typeof v === 'number' && [2, 3, 4, 5, 6].includes(v));

function read(): SettingsValues {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || 'null') as Partial<SettingsValues> | null;
    if (s && typeof s === 'object') {
      const v = { ...DEFAULTS, ...s };
      // stare zapisy z Oldgame miały nazwy presetów ('hd', 'fhd'...) - te mapujemy na 'auto'
      if (!validRes(v.res)) v.res = 'auto';
      if (!UI_SIZES.some(([k]) => Math.abs(k - Number(v.ui)) < 0.01)) v.ui = 1;
      return v;
    }
  } catch {
    /* brak localStorage / zły JSON */
  }
  return { ...DEFAULTS };
}

type Listener = (v: SettingsValues) => void;
const listeners = new Set<Listener>();

export const Settings = {
  values: read(),
  /** Skala interfejsu (okna, podpowiedzi, komunikaty, HUD-y, które ją czytają). */
  get uiScale(): number {
    return Number(this.values.ui) || 1;
  },
  /** Rozdzielczość, z którą wystartowała ta sesja (później zmieniana na żywo przez Kit.applyZoom, poza misją). */
  get startRes(): ResSetting {
    const q = new URLSearchParams(window.location.search).get('res');
    if (q) {
      const n = q === 'auto' ? 'auto' : Number(q);
      if (validRes(n)) return n;
    }
    return this.values.res;
  },
  /** Profil Amiga, z którym wystartowała sesja (`?profile=amiga|pc` w URL nadpisuje; zmiana wymaga restartu). */
  get startAmiga(): boolean {
    const q = new URLSearchParams(window.location.search).get('profile');
    if (q === 'amiga') return true;
    if (q === 'pc') return false;
    return this.values.amiga;
  },
  set<K extends keyof SettingsValues>(k: K, v: SettingsValues[K]): void {
    this.values = { ...this.values, [k]: v };
    try {
      // zachowujemy ewentualne inne pola (np. z Oldgame: ui)
      const prev = JSON.parse(localStorage.getItem(KEY) || '{}') as Record<string, unknown>;
      localStorage.setItem(KEY, JSON.stringify({ ...prev, ...this.values }));
    } catch {
      /* ignoruj */
    }
    for (const f of listeners) f(this.values);
  },
  /** Subskrypcja zmian; zwraca funkcję wypisującą. */
  onChange(f: Listener): () => void {
    listeners.add(f);
    return () => listeners.delete(f);
  },
};
