import Phaser from 'phaser';
import type { PixelText } from './BitmapFont';
import { SoundManager } from '../../audio/SoundManager';
import { campaign } from '../../core/campaign/session';
import { type CampaignState, freshState } from '../../core/campaign/state';
import { NAME_COLORS, NAME_MAX, checkName } from '../../core/data/names';
import { itemStatLine } from '../../core/HudState';
import { abilityDef, itemDef } from '../../core/rules/lookup';
import { abilityIcon, abilityKind, itemIcon } from '../legacy/icons';
import { portraitCanvas } from '../legacy/portraits';
import { addHiRes } from '../iso/HiRes';
import { BASE_H, BASE_W, PAL, type UiButton, ZOOM, autoZoom, button, hex, label, panel, parseColor } from './Kit';
import { RES_CHOICES, type ResSetting, Settings } from './Settings';

// Okna, podpowiedzi, listy przewijane, pole tekstowe, opcje i zapis gry - odpowiedniki UI.modal / UI.toast / UI.tooltip,
// Settings.open, nameEditor i Game.save z Oldgame, zbudowane z obiektów Phasera (bez DOM-owej nakładki).

const D_MODAL = 1000;
const D_TIP = 1500;
const D_TOAST = 1600;

// ------------------------------------------------------------------ zapis gry (Oldgame/src/core/game.js)

const SAVE_KEY = 'pyl-i-rdza-save-v1';

export const Save = {
  write(): boolean {
    try {
      window.localStorage.setItem(SAVE_KEY, JSON.stringify(campaign.state));
      return true;
    } catch {
      return false;
    }
  },
  exists(): boolean {
    try {
      return !!window.localStorage.getItem(SAVE_KEY);
    } catch {
      return false;
    }
  },
  load(): boolean {
    try {
      const s = JSON.parse(window.localStorage.getItem(SAVE_KEY) ?? 'null') as Partial<CampaignState> | null;
      if (s && s.version === 1 && Array.isArray(s.party)) {
        campaign.state = Object.assign(freshState(), s);
        return true;
      }
    } catch {
      /* uszkodzony zapis traktujemy jak brak zapisu */
    }
    return false;
  },
  clear(): void {
    try {
      window.localStorage.removeItem(SAVE_KEY);
    } catch {
      /* brak dostępu do pamięci przeglądarki */
    }
  },
};

// ------------------------------------------------------------------ portrety i ikony (malowane kodem z Oldgame/src/gfx)

interface PortraitSource {
  id?: string;
  recruitId?: string;
  name?: string;
  classId?: string;
  ancestry?: string;
  look?: object;
}

const hashStr = (s: string): string => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
};

/** Klucz tekstury portretu 64x64 (budowany raz na wygląd). */
/**
 * Tekstura portretu o rozmiarze projektowym `size` (domyślnie 32). Portret jest malowany w 2x gęstości projektowej
 * (32 -> 64 px, 40 -> 80 px), a HiRes dokłada Scale2x do gęstości płótna - bez skalowania na GPU, więc jest ostry.
 * Wyświetlaj go w tym samym rozmiarze, w jakim został zamówiony.
 */
export function portraitKey(scene: Phaser.Scene, ch: PortraitSource, size = 32): string {
  const id = hashStr(`${ch.recruitId ?? ch.id ?? ch.name}|${ch.classId}|${ch.ancestry}|${JSON.stringify(ch.look ?? {})}`);
  const key = size === 32 ? `por_${id}` : `por_${id}_${size}`;
  if (!scene.textures.exists(key)) addHiRes(scene, key, portraitCanvas(ch, size * 2) as HTMLCanvasElement, { w: size, h: size });
  return key;
}

/** Portret w ramce; (x, y) = lewy górny róg, size w pikselach projektowych. */
export function portrait(scene: Phaser.Scene, x: number, y: number, ch: PortraitSource, size = 32, frame: number = PAL.edge): Phaser.GameObjects.Container {
  const img = scene.add.image(0, 0, portraitKey(scene, ch)).setOrigin(0).setDisplaySize(size, size);
  const edge = scene.add.rectangle(0, 0, size, size).setOrigin(0).setStrokeStyle(1, frame);
  return scene.add.container(x, y, [img, edge]);
}

export function itemIconImage(scene: Phaser.Scene, x: number, y: number, id: string, size = 12): Phaser.GameObjects.Image {
  const def = itemDef(id);
  const key = `ico_${def?.icon ?? ''}_${def?.type ?? id}_${id}_${size}`;
  if (!scene.textures.exists(key)) addHiRes(scene, key, itemIcon(def ?? id, 32) as HTMLCanvasElement, { w: size, h: size });
  return scene.add.image(x, y, key).setOrigin(0).setDisplaySize(size, size);
}

/** Ikona zdolności (Oldgame/src/gfx/icons.js: abilityIcon) - odznaka z glifem wg icon/id/fx zdolności. */
export function abilityIconImage(scene: Phaser.Scene, x: number, y: number, id: string, size = 12): Phaser.GameObjects.Image {
  const def = abilityDef(id);
  const src = def ? { icon: def.icon, id: def.id, name: def.name, fx: def.fx } : id;
  const key = `abico_${abilityKind(src)}_${size}`;
  if (!scene.textures.exists(key)) addHiRes(scene, key, abilityIcon(src, 24) as HTMLCanvasElement, { w: size, h: size });
  return scene.add.image(x, y, key).setOrigin(0).setDisplaySize(size, size);
}

const TYPE_LABEL: Record<string, string> = { weapon: 'broń', armor: 'pancerz', shield: 'tarcza', consumable: 'zużywalne', junk: 'złom', tech: 'technika', ammo: 'amunicja' };

/** Opis przedmiotu do podpowiedzi (port itemTip z Oldgame/src/scenes/meta/common.js). */
export function itemTip(id: string, extra = ''): string {
  const it = itemDef(id);
  if (!it) return id;
  const lines = [`${it.name}  (${TYPE_LABEL[it.type] ?? it.type}${it.level ? `, poz. ${it.level}` : ''})`, it.desc];
  if (it.type === 'weapon') {
    const w = it.weapon;
    lines.push(`Obrażenia ${w.damage} (${w.dmgType})${w.range ? ` · zasięg ${w.range}` : ' · wręcz'}${w.hands === 2 ? ' · dwuręczna' : ''}${w.traits.length ? ` · ${w.traits.join(', ')}` : ''}`);
  } else if (it.type === 'armor') {
    lines.push(`KP +${it.armor.ac} · limit Zrę. ${it.armor.dexCap}${it.armor.speedPenalty ? ` · prędkość −${it.armor.speedPenalty}` : ''}`);
  } else if (it.type === 'shield') {
    lines.push(`Tarcza: KP +${it.shield.ac} · twardość ${it.shield.hardness}`);
  } else {
    const st = itemStatLine(it);
    if (st) lines.push(st);
  }
  lines.push(`Cena: ${it.price} Złomu${extra}`);
  return lines.filter(Boolean).join('\n');
}

// ------------------------------------------------------------------ podpowiedź pod kursorem

export class Tip {
  private readonly box: Phaser.GameObjects.Container;
  private readonly bg: Phaser.GameObjects.Rectangle;
  private readonly text: PixelText;
  private owner: Phaser.GameObjects.GameObject | null = null;

  constructor(scene: Phaser.Scene, wrap = 200) {
    this.bg = scene.add.rectangle(0, 0, 10, 10, 0x120e0a, 0.97).setOrigin(0).setStrokeStyle(1, PAL.edgeHi);
    this.text = label(scene, 4, 3, '', { size: 6, wrap, lineSpacing: 1.5 });
    this.box = scene.add.container(0, 0, [this.bg, this.text]).setDepth(D_TIP).setVisible(false);
    scene.input.on('pointermove', (p: Phaser.Input.Pointer) => this.box.visible && this.place(p));
  }

  private place(p: Phaser.Input.Pointer): void {
    const w = this.bg.width, h = this.bg.height;
    let x = p.worldX + 8, y = p.worldY + 8;
    if (x + w > BASE_W - 2) x = p.worldX - w - 6;
    if (y + h > BASE_H - 2) y = p.worldY - h - 6;
    this.box.setPosition(Math.max(2, x), Math.max(2, y));
  }

  /** Pokazuje `content()` po najechaniu na obiekt (obiekt musi być interaktywny). */
  attach<T extends Phaser.GameObjects.GameObject>(obj: T, content: () => string): T {
    obj.on('pointerover', (p: Phaser.Input.Pointer) => {
      const s = content();
      if (!s) return;
      this.owner = obj;
      this.text.setText(s);
      this.bg.setSize(this.text.displayWidth + 8, this.text.displayHeight + 7);
      this.box.setVisible(true);
      this.place(p);
    });
    const hide = (): void => {
      if (this.owner === obj) this.hide();
    };
    obj.on('pointerout', hide);
    obj.on('pointerdown', hide);
    obj.once('destroy', hide);
    return obj;
  }

  hide(): void {
    this.owner = null;
    this.box.setVisible(false);
  }
}

// ------------------------------------------------------------------ komunikaty i okna modalne

export type Tone = 'good' | 'amber' | 'bad';
const TONE: Record<Tone, number> = { good: PAL.good, amber: PAL.amber, bad: PAL.bad };

export function toast(scene: Phaser.Scene, msg: string, tone: Tone = 'amber'): void {
  const t = label(scene, 0, 0, msg, { size: 7, color: TONE[tone], wrap: 280, align: 'center' }).setOrigin(0.5);
  const bg = scene.add.rectangle(0, 0, t.displayWidth + 16, t.displayHeight + 8, 0x120e0a, 0.96).setStrokeStyle(1, TONE[tone]);
  const box = scene.add.container(BASE_W / 2, 30, [bg, t]).setDepth(D_TOAST).setAlpha(0);
  scene.tweens.add({ targets: box, alpha: 1, y: 36, duration: 160 });
  scene.tweens.add({ targets: box, alpha: 0, delay: 2200, duration: 400, onComplete: () => box.destroy() });
}

/** Czy nad sceną wisi okno modalne (skróty klawiszowe sceny powinny wtedy milczeć). */
export const modalOpen = (scene: Phaser.Scene): boolean => (scene.data.get('modals') ?? 0) > 0;

export interface Window {
  box: Phaser.GameObjects.Container;
  w: number;
  h: number;
  add<T extends Phaser.GameObjects.GameObject>(o: T): T;
  close(): void;
}

/** Zdarzenia Esc już obsłużone (jedno naciśnięcie zamyka jedno okno). */
const escSeen = new WeakSet<KeyboardEvent>();
/** Czy to naciśnięcie Esc zamknęło już okno (skróty sceny powinny je wtedy zignorować). */
export const escConsumed = (e: KeyboardEvent): boolean => escSeen.has(e);

/**
 * Okno na przyciemnionym tle, które połyka kliknięcia. `onClose` woła się raz przy zamknięciu.
 * Esc albo klik w tło zamyka najwyższe okno (Oldgame/src/core/settings.js:47-49), chyba że `dismiss: false`.
 */
export function openWindow(scene: Phaser.Scene, w: number, h: number, title: string, onClose?: () => void, opts: { dismiss?: boolean } = {}): Window {
  scene.data.set('modals', (scene.data.get('modals') ?? 0) + 1);
  const depth = D_MODAL + (scene.data.get('modals') as number) * 10;
  const back = scene.add.rectangle(0, 0, BASE_W, BASE_H, 0x000000, 0.66).setOrigin(0).setInteractive().setDepth(depth);
  const x = Math.round((BASE_W - w) / 2), y = Math.round((BASE_H - h) / 2);
  const box = panel(scene, x, y, w, h, PAL.edgeHi, 0.98).setDepth(depth + 1);
  if (title) box.add(label(scene, 8, 6, title.toUpperCase(), { size: 9, bold: true, color: PAL.amber }));
  let closed = false;
  const level = scene.data.get('modals') as number;
  const dismiss = opts.dismiss !== false;
  // tylko najwyższe okno reaguje na Esc (poziom = liczba otwartych okien w chwili otwarcia)
  const onEsc = (e: KeyboardEvent): void => {
    if (escSeen.has(e)) return; // Phaser potrafi wyemitować to samo zdarzenie drugi raz
    if (e.key === 'Escape' && dismiss && (scene.data.get('modals') as number) === level) {
      escSeen.add(e);
      win.close();
    }
  };
  if (dismiss) back.on('pointerdown', () => win.close());
  // klawisz rejestrujemy w następnej klatce, żeby Esc otwierający okno go od razu nie zamknął
  scene.time.delayedCall(0, () => !closed && scene.input.keyboard?.on('keydown', onEsc));
  const win: Window = {
    box, w, h,
    add(o) {
      box.add(o);
      return o;
    },
    close() {
      if (closed) return;
      closed = true;
      scene.input.keyboard?.off('keydown', onEsc);
      scene.data.set('modals', Math.max(0, ((scene.data.get('modals') as number) ?? 1) - 1));
      back.destroy();
      box.destroy();
      onClose?.();
    },
  };
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => scene.input.keyboard?.off('keydown', onEsc));
  return win;
}

export interface DialogButton<T> {
  label: string;
  value: T;
  primary?: boolean;
  danger?: boolean;
}

/** Okno z tekstem i przyciskami (port UI.modal). Esc / klik w tło = pierwsza wartość z listy. */
export function dialog<T>(scene: Phaser.Scene, o: { title: string; body: string; buttons: DialogButton<T>[]; w?: number; tone?: number }): Promise<T> {
  return new Promise<T>((resolve) => {
    const w = o.w ?? 260;
    const probe = label(scene, 0, 0, o.body, { size: 7, wrap: w - 20, lineSpacing: 2, color: o.tone ?? PAL.text });
    const h = Math.ceil(probe.displayHeight) + 54;
    // Esc / klik w tło = pierwsza wartość z listy
    const win = openWindow(scene, w, h, o.title, () => resolve(o.buttons[0].value));
    win.add(probe.setPosition(10, 22));
    let x = w - 8;
    for (const b of [...o.buttons].reverse()) {
      const btn = button(scene, 0, 0, b.label, () => {
        resolve(b.value);
        win.close();
      }, { primary: b.primary, danger: b.danger, size: 7 });
      const bw = (btn.box.list[1] as Phaser.GameObjects.Rectangle).width;
      x -= bw;
      btn.box.setPosition(x, h - 22);
      x -= 6;
      win.add(btn.box);
    }
  });
}

// ------------------------------------------------------------------ opcje (Oldgame/src/core/settings.js)

/** Okno opcji: dźwięk + wyciszenie, pełny ekran, efekty retro, rozdzielczość. Esc / klik w tło zamyka. */
export function openOptions(scene: Phaser.Scene): Promise<void> {
  return new Promise<void>((resolve) => {
    const W = 330, H = 222;
    const win = openWindow(scene, W, H, 'Opcje', resolve);
    const L = 12, R = 172;
    const head = (x: number, y: number, t: string): void => void win.add(label(scene, x, y, t.toUpperCase(), { size: 6, bold: true, color: PAL.dim }));

    // --- dźwięk (lewa kolumna)
    head(L, 22, 'Dźwięk');
    const vol = SoundManager.getVolume();
    const rows: [keyof typeof vol, string][] = [['master', 'Głośność'], ['music', 'Muzyka'], ['sfx', 'Efekty']];
    rows.forEach(([k, name], i) => {
      const y = 33 + i * 16;
      win.add(label(scene, L, y, name, { size: 6.5 }));
      const bx = L + 48, bw = 72;
      const track = win.add(scene.add.rectangle(bx, y + 1, bw, 8, 0x000000, 0.6).setOrigin(0).setStrokeStyle(1, PAL.edge).setInteractive({ useHandCursor: true }));
      const fill = win.add(scene.add.rectangle(bx + 1, y + 2, 1, 6, PAL.amber).setOrigin(0));
      const val = win.add(label(scene, bx + bw + 4, y, '', { size: 6, color: PAL.amber }));
      const paint = (): void => {
        const v = SoundManager.getVolume()[k];
        fill.setSize(Math.max(1, Math.round((bw - 2) * v)), 6);
        val.setText(`${Math.round(v * 100)}%`);
      };
      const set = (p: Phaser.Input.Pointer): void => {
        const local = (p.worldX - (win.box.x + bx)) / bw;
        SoundManager.setVolume({ [k]: Math.round(Phaser.Math.Clamp(local, 0, 1) * 20) / 20 });
        paint();
      };
      track.on('pointerdown', (p: Phaser.Input.Pointer) => {
        set(p);
        if (k !== 'music') SoundManager.sfx('click');
      });
      track.on('pointermove', (p: Phaser.Input.Pointer) => p.isDown && set(p));
      paint();
    });
    const toggle = (x: number, y: number, name: string, get: () => boolean, set: (v: boolean) => void, tipText?: string): void => {
      win.add(label(scene, x, y + 2, name, { size: 6.5 }));
      const b = button(scene, x + 100, y, '', () => {
        set(!get());
        b.setLabel(get() ? 'Wł.' : 'Wył.');
      }, { w: 44, h: 12, size: 6 });
      b.setLabel(get() ? 'Wł.' : 'Wył.');
      win.add(b.box);
      if (tipText) win.add(label(scene, x, y + 11, tipText, { size: 5, color: PAL.dim }));
    };
    toggle(L, 84, 'Wycisz wszystko', () => SoundManager.muted, (v) => (SoundManager.muted = v));

    // --- ekran
    head(L, 104, 'Ekran');
    const fs = button(scene, L, 114, '', () => {
      if (scene.scale.isFullscreen) scene.scale.stopFullscreen();
      else scene.scale.startFullscreen();
      scene.time.delayedCall(300, () => fs.setLabel(scene.scale.isFullscreen ? 'Wyjdź z pełnego ekranu' : 'Pełny ekran'));
    }, { w: 144, h: 13, size: 6.5 });
    fs.setLabel(scene.scale.isFullscreen ? 'Wyjdź z pełnego ekranu' : 'Pełny ekran');
    win.add(fs.box);

    // --- efekty retro (prawa kolumna)
    head(R, 22, 'Efekty retro');
    toggle(R, 32, 'Linie skanowania', () => Settings.values.scanlines, (v) => Settings.set('scanlines', v), 'poziome pasy jak na monitorze CRT');
    toggle(R, 54, 'Ziarno filmu', () => Settings.values.grain, (v) => Settings.set('grain', v), 'migoczący szum obrazu');
    toggle(R, 76, 'Dithering', () => Settings.values.dither, (v) => Settings.set('dither', v), 'raster Bayera jak przy ograniczonej palecie');
    toggle(R, 98, 'Profil Amiga', () => Settings.values.amiga, (v) => Settings.set('amiga', v), 'A1200/PiStorm: 50 Hz, bez nakładek (restart)');

    // --- rozdzielczość (dół, pełna szerokość)
    head(L, 136, 'Rozdzielczość obrazu');
    const marks: [ResSetting, UiButton][] = [];
    const paintRes = (): void => {
      for (const [r, b] of marks) b.setLabel((Settings.values.res === r ? '● ' : '○ ') + (r === 'auto' ? 'Auto' : `${r}×`));
      const want = Settings.values.res === 'auto' ? autoZoomFor() : Settings.values.res;
      const now = `Teraz: ${BASE_W * ZOOM}×${BASE_H * ZOOM} (${ZOOM}× siatki ${BASE_W}×${BASE_H})`;
      resNote.setText(want !== ZOOM ? `${now} → po ponownym uruchomieniu: ${BASE_W * want}×${BASE_H * want}` : now);
      restart.box.setVisible(want !== ZOOM);
    };
    RES_CHOICES.forEach((r, i) => {
      const b = button(scene, L + i * 51, 146, '', () => {
        Settings.set('res', r);
        paintRes();
      }, { w: 48, h: 13, size: 6 });
      marks.push([r, b]);
      win.add(b.box);
    });
    const resNote = win.add(label(scene, L, 163, '', { size: 5.5, color: PAL.dim }));
    win.add(label(scene, L, 172, 'Auto = największa ostra skala mieszcząca się w oknie przeglądarki.', { size: 5.5, color: PAL.dim }));
    const restart = button(scene, L, H - 22, 'Uruchom ponownie', async () => {
      const inMission = scene.scene.isActive('WorldScene');
      const ok = await dialog(scene, {
        title: 'Ponowne uruchomienie',
        body: inMission ? 'Gra zostanie przeładowana. Postęp bieżącej misji przepadnie (kampania wróci do ostatniego zapisu).' : 'Gra zostanie zapisana i przeładowana w nowej rozdzielczości.',
        buttons: [{ label: 'Anuluj', value: false }, { label: 'Uruchom ponownie', value: true, primary: true }],
      });
      if (!ok) return;
      if (!inMission && campaign.state.party.length && !scene.scene.isActive('TitleScene')) Save.write();
      window.location.reload();
    }, { w: 100, size: 6.5 });
    win.add(restart.box);
    paintRes();

    win.add(button(scene, W - 62, H - 22, 'Gotowe', () => win.close(), { w: 54, size: 7, primary: true }).box);
  });
}

/** Zoom trybu "Auto" przy obecnym oknie. */
const autoZoomFor = (): number => autoZoom();

// ------------------------------------------------------------------ imię najemnika (Oldgame/src/scenes/meta/nameedit.js)

export interface NamePromptOptions {
  value: string;
  color?: string | null;
  taken: () => string[];
  generate: () => string;
  /** Imię domyślne (przycisk "Przywróć"). */
  reset?: () => string;
}

/** Edycja imienia z klawiatury + losowanie + kolor. Zwraca null po anulowaniu. */
export function namePrompt(scene: Phaser.Scene, o: NamePromptOptions): Promise<{ name: string; color: string | null } | null> {
  return new Promise((resolve) => {
    const W = 270, H = 132;
    let value = o.value;
    let color: string | null = o.color ?? null;
    let result: { name: string; color: string | null } | null = null;
    const kb = scene.input.keyboard;
    // Phaser potrafi wyemitować to samo zdarzenie ponownie (kolejka klawiatury jest przetwarzana także przy ruchu myszy)
    const seen = new WeakSet<KeyboardEvent>();
    const onKey = (e: KeyboardEvent): void => {
      if (seen.has(e)) return;
      seen.add(e);
      if (e.key === 'Enter') return commit();
      if (e.key === 'Escape') return win.close();
      // Ctrl/Cmd+V: wklejenie imienia ze schowka (pole tekstowe w Oldgame pozwalało wkleić)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
        e.preventDefault();
        void navigator.clipboard?.readText?.().then((t) => {
          value = [...(value + t.replace(/[\r\n\t]+/g, ' '))].slice(0, NAME_MAX).join('');
          paint();
        }).catch(() => {});
        return;
      }
      if (e.key === 'Backspace') value = [...value].slice(0, -1).join('');
      else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && [...value].length < NAME_MAX) value += e.key;
      else return;
      e.preventDefault();
      paint();
    };
    const win = openWindow(scene, W, H, 'Imię najemnika', () => {
      kb?.off('keydown', onKey);
      blink.remove();
      resolve(result);
    });
    win.add(scene.add.rectangle(10, 24, W - 20, 16, 0x000000, 0.6).setOrigin(0).setStrokeStyle(1, PAL.amber));
    const field = win.add(label(scene, 14, 27, '', { size: 9, bold: true }));
    const caret = win.add(scene.add.rectangle(0, 27, 1, 10, PAL.amber).setOrigin(0));
    const err = win.add(label(scene, 10, 44, '', { size: 6, color: PAL.bad }));
    const blink = scene.time.addEvent({ delay: 420, loop: true, callback: () => caret.setVisible(!caret.visible) });
    const paint = (): void => {
      field.setText(value).setColor(color ?? hex(PAL.text));
      caret.x = 14 + field.displayWidth + 1;
      err.setText(`${[...value].length}/${NAME_MAX} · pisz z klawiatury, Enter = zatwierdź`).setColor(hex(PAL.dim));
    };
    const commit = (): void => {
      const c = checkName(value, o.taken());
      if (!c.ok) {
        SoundManager.sfx('error');
        err.setText(c.error).setColor(hex(PAL.bad));
        return;
      }
      result = { name: c.name, color };
      SoundManager.sfx('pickup', { vol: 0.5 });
      win.close();
    };
    // kolor imienia
    win.add(label(scene, 10, 58, 'Kolor imienia', { size: 6, color: PAL.dim }));
    const marks: [string | null, Phaser.GameObjects.Rectangle][] = [];
    NAME_COLORS.forEach((c, i) => {
      const sw = win.add(scene.add.rectangle(70 + i * 14, 56, 10, 10, parseColor(c ?? undefined, PAL.text)).setOrigin(0).setInteractive({ useHandCursor: true }));
      if (!c) win.add(scene.add.rectangle(70 + i * 14, 56, 5, 10, PAL.amber).setOrigin(0));
      sw.on('pointerdown', () => {
        SoundManager.sfx('click');
        color = c;
        mark();
        paint();
      });
      marks.push([c, sw]);
    });
    const mark = (): void => marks.forEach(([c, sw]) => sw.setStrokeStyle(c === color ? 2 : 1, c === color ? 0xffffff : 0x000000));
    mark();
    win.add(button(scene, 10, 76, 'Losuj imię', () => {
      value = o.generate();
      paint();
    }, { w: 70, size: 7 }).box);
    if (o.reset)
      win.add(button(scene, 86, 76, 'Przywróć', () => {
        value = o.reset!();
        paint();
      }, { w: 60, size: 7 }).box);
    win.add(button(scene, W - 128, H - 22, 'Anuluj', () => win.close(), { w: 54, size: 7 }).box);
    win.add(button(scene, W - 68, H - 22, 'Zatwierdź', () => commit(), { w: 60, size: 7, primary: true }).box);
    kb?.on('keydown', onKey);
    paint();
  });
}

// ------------------------------------------------------------------ lista przewijana kółkiem

export type RowBuilder<T> = (item: T, row: Phaser.GameObjects.Container, w: number, index: number) => void;

export class ScrollList<T> {
  readonly box: Phaser.GameObjects.Container;
  private items: T[] = [];
  private offset = 0;
  private readonly scene: Phaser.Scene;
  private readonly x: number;
  private readonly y: number;
  private readonly w: number;
  private readonly h: number;
  private readonly rowH: number;
  private readonly build: RowBuilder<T>;
  private readonly onWheel: (p: Phaser.Input.Pointer, over: unknown, dx: number, dy: number) => void;
  /** Tekst pokazywany, gdy lista jest pusta. */
  empty = '';

  constructor(scene: Phaser.Scene, x: number, y: number, w: number, h: number, rowH: number, build: RowBuilder<T>, parent?: Phaser.GameObjects.Container) {
    this.scene = scene;
    this.x = x;
    this.y = y;
    this.w = w;
    this.h = h;
    this.rowH = rowH;
    this.build = build;
    this.box = scene.add.container(x, y);
    parent?.add(this.box);
    this.onWheel = (p, _over, _dx, dy) => {
      if (!this.box.active || !this.box.visible) return;
      const m = this.box.getWorldTransformMatrix();
      if (p.worldX < m.tx || p.worldX > m.tx + this.w || p.worldY < m.ty || p.worldY > m.ty + this.h) return;
      this.scroll(dy > 0 ? 1 : -1);
    };
    scene.input.on('wheel', this.onWheel);
    this.box.once('destroy', () => scene.input.off('wheel', this.onWheel));
  }

  private get visible(): number {
    return Math.max(1, Math.floor(this.h / this.rowH));
  }

  scroll(d: number): void {
    const max = Math.max(0, this.items.length - this.visible);
    const next = Phaser.Math.Clamp(this.offset + d, 0, max);
    if (next === this.offset) return;
    this.offset = next;
    this.draw();
  }

  setItems(items: T[]): void {
    this.items = items;
    this.offset = Phaser.Math.Clamp(this.offset, 0, Math.max(0, items.length - this.visible));
    this.draw();
  }

  private draw(): void {
    this.box.removeAll(true);
    const n = this.visible, total = this.items.length;
    const bar = total > n;
    const w = this.w - (bar ? 5 : 0);
    if (!total && this.empty) this.box.add(label(this.scene, 2, 2, this.empty, { size: 6, color: PAL.dim, wrap: w - 4 }));
    for (let i = 0; i < n && this.offset + i < total; i++) {
      const row = this.scene.add.container(0, i * this.rowH);
      this.box.add(row);
      this.build(this.items[this.offset + i], row, w, this.offset + i);
    }
    if (bar) {
      const th = Math.max(8, (this.h * n) / total);
      const ty = ((this.h - th) * this.offset) / Math.max(1, total - n);
      this.box.add(this.scene.add.rectangle(this.w - 3, 0, 3, this.h, 0x000000, 0.4).setOrigin(0));
      this.box.add(this.scene.add.rectangle(this.w - 3, ty, 3, th, PAL.edge).setOrigin(0));
    }
  }

  get position(): { x: number; y: number } {
    return { x: this.x, y: this.y };
  }
}

/** Mały przycisk do wierszy list. */
export function miniButton(scene: Phaser.Scene, x: number, y: number, text: string, onClick: () => void, o: { w?: number; enabled?: boolean; primary?: boolean } = {}): UiButton {
  return button(scene, x, y, text, onClick, { size: 6, h: 11, w: o.w, enabled: o.enabled, primary: o.primary });
}

/** Pasek postępu (PW / PD). */
export function bar(scene: Phaser.Scene, x: number, y: number, w: number, h: number, ratio: number, color: number, back = 0x3a1410): Phaser.GameObjects.GameObject[] {
  const k = Phaser.Math.Clamp(ratio, 0, 1);
  return [scene.add.rectangle(x, y, w, h, back).setOrigin(0), scene.add.rectangle(x, y, Math.max(k > 0 ? 1 : 0, Math.round(w * k)), h, color).setOrigin(0)];
}
