// Model menu głównego: lista pozycji, fokus, nawigacja klawiaturą / joystickiem (góra-dół-ogień).
// Na Amidze menu musi działać bez myszy (joystick w porcie 2, klawiatura), więc fokus jest częścią logiki, a nie sceny.
// Czysty TypeScript - w C: tablica struktur { id, enabled } + int focus.

export interface MenuItem<Id extends string = string> {
  id: Id;
  label: string;
  enabled: boolean;
}

export class MenuModel<Id extends string = string> {
  readonly items: MenuItem<Id>[];
  private f = -1;

  constructor(items: MenuItem<Id>[]) {
    this.items = items;
    this.f = this.firstEnabled();
  }

  /** Indeks pozycji z fokusem (-1 = brak aktywnych). */
  get focus(): number {
    return this.f;
  }

  get focused(): MenuItem<Id> | null {
    return this.f >= 0 ? this.items[this.f] : null;
  }

  private firstEnabled(): number {
    for (let i = 0; i < this.items.length; i++) if (this.items[i].enabled) return i;
    return -1;
  }

  /** Ustawia fokus (np. najechanie myszą); pozycje nieaktywne są ignorowane. Zwraca true, gdy fokus się zmienił. */
  setFocus(i: number): boolean {
    if (i < 0 || i >= this.items.length || !this.items[i].enabled || i === this.f) return false;
    this.f = i;
    return true;
  }

  /** Przesuwa fokus o `dir` (-1 w górę, +1 w dół) z zawijaniem, pomijając nieaktywne. Zwraca true, gdy się zmienił. */
  move(dir: -1 | 1): boolean {
    const n = this.items.length;
    if (this.f < 0) return false;
    for (let k = 1; k <= n; k++) {
      const i = (((this.f + dir * k) % n) + n) % n;
      if (this.items[i].enabled) {
        if (i === this.f) return false;
        this.f = i;
        return true;
      }
    }
    return false;
  }

  /** Id pozycji do wykonania (ogień / Enter) albo null. */
  activate(): Id | null {
    const it = this.focused;
    return it && it.enabled ? it.id : null;
  }

  indexOf(id: Id): number {
    return this.items.findIndex((it) => it.id === id);
  }
}

export type TitleMenuId = 'new' | 'continue' | 'load' | 'options' | 'intro' | 'credits' | 'quit';

/**
 * Menu ekranu tytułowego; "Kontynuuj" tylko gdy istnieje autozapis (fokus startuje na nim - jak w większości gier),
 * "Wczytaj grę" gdy któryś z ręcznych slotów jest zajęty; "Wyjdź z gry" zawsze na końcu.
 */
export function titleMenu(hasSave: boolean, hasSlots = false): MenuModel<TitleMenuId> {
  const items: MenuItem<TitleMenuId>[] = [
    { id: 'new', label: '▶ Nowa gra', enabled: true },
    ...(hasSave ? [{ id: 'continue' as const, label: 'Kontynuuj', enabled: true }] : []),
    ...(hasSlots ? [{ id: 'load' as const, label: 'Wczytaj grę', enabled: true }] : []),
    { id: 'options', label: 'Opcje', enabled: true },
    { id: 'intro', label: 'Intro', enabled: true },
    { id: 'credits', label: 'Autorzy', enabled: true },
    { id: 'quit', label: 'Wyjdź z gry', enabled: true },
  ];
  const m = new MenuModel(items);
  if (hasSave) m.setFocus(1);
  return m;
}
