// Opcje gracza (port Oldgame/src/core/settings.js): rozdzielczość, efekty retro. Głośność i wyciszenie trzyma SoundManager.
// Zapis w localStorage pod tym samym kluczem co w Oldgame - osobno od zapisu gry. `?res=auto|2..6` w URL nadpisuje (bez zapisu).
// Moduł bez zależności od Kit.ts (Kit czyta stąd rozdzielczość przy starcie).

const KEY = 'pyl-i-rdza-settings-v1';

/** 'auto' = największy zoom mieszczący się w oknie; liczba = stały zoom (piksele płótna na piksel projektowy 480x270). */
export type ResSetting = 'auto' | 2 | 3 | 4 | 5 | 6;
export const RES_CHOICES: readonly ResSetting[] = ['auto', 2, 3, 4, 5, 6];

export interface SettingsValues {
  res: ResSetting;
  scanlines: boolean;
  grain: boolean;
  dither: boolean;
}

const DEFAULTS: SettingsValues = { res: 'auto', scanlines: true, grain: true, dither: true };

const validRes = (v: unknown): v is ResSetting => v === 'auto' || (typeof v === 'number' && [2, 3, 4, 5, 6].includes(v));

function read(): SettingsValues {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || 'null') as Partial<SettingsValues> | null;
    if (s && typeof s === 'object') {
      const v = { ...DEFAULTS, ...s };
      // stare zapisy z Oldgame miały nazwy presetów ('hd', 'fhd'...) - te mapujemy na 'auto'
      if (!validRes(v.res)) v.res = 'auto';
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
  /** Rozdzielczość, z którą wystartowała ta sesja (zmiana wymaga ponownego uruchomienia). */
  get startRes(): ResSetting {
    const q = new URLSearchParams(window.location.search).get('res');
    if (q) {
      const n = q === 'auto' ? 'auto' : Number(q);
      if (validRes(n)) return n;
    }
    return this.values.res;
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
