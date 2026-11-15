import Phaser from 'phaser';
import { type PixelText, pixelText } from './ui/BitmapFont';
import { D20_SETTLE, D20_SIZE, D20_TUMBLE, paintD20Sheet } from './ui/D20Art';
import { SoundManager } from '../audio/SoundManager';
import {
  type ActionButton,
  type HudChange,
  HudState,
  type InitEntry,
  type InventoryRow,
  type LogEntry,
  type LogTone,
  abilityRows,
  backpackRows,
  degreeName,
  classLabel,
  conditionChips,
  equipmentRows,
  itemStatLine,
  hpRatio,
  hpTone,
  stateLabel,
  statPairs,
} from '../core/HudState';
import type { Character, EquipSlot } from '../core/rules/types';
import { itemDef } from '../core/rules/lookup';
import { normWeapon } from '../core/rules/stats';
import { TurnPhase } from '../core/TurnManager';
import { BASE_H, BASE_W, PAL, ZOOM, button as kitButton, fitCamera, label, parseColor } from './ui/Kit';
import { fitText } from './ui/FontGlyphs';
import { type Window as UiWindow, abilityIconImage, itemIconImage, modalOpen, openOptions, openWindow, portraitKey } from './ui/Widgets';

// HUD misji - port Oldgame/src/mission/hud.js (DOM) do Phasera, w stylu terminala CRT.
//   lewy górny:   karta drużyny (portret-skrót, PW, AP, stany)       <- H.party_
//   środek góra:  runda + pasek widocznych wrogów z PW                 <- H.initBar
//   prawy górny:  przyciski: pomoc, opcje, tempo, mapa, ekwipunek       <- H.menu
//   panel akcji:  bronie (klik = wybór) + akcje walki; przesuwany        <- C.refreshBar
//   lewy dół:     opis pola/wroga pod kursorem                         <- H.showInfo
//   prawy dół:    dziennik walki (kółko = przewijanie, zwijany)        <- H.log
//   panel (I):    karta postaci: statystyki, wyposażenie, plecak       <- H.sheet
// Cały stan pochodzi z HudState (src/core); polecenia wracają przez hud.command().

// ------------------------------------------------------------------ paleta / czcionka

// Paleta Oldgame (Oldgame/index.html :root + mission/hud.js) - te same kolory co PAL w ui/Kit.ts.
// Nazwy zostały po dawnym zielonym terminalu: green = "dobrze/aktywne", greenDim = zwykła rdzawa ramka.
const C = {
  bg: 0x120e0b, // tło .m-card / paneli
  green: PAL.good,
  greenDim: PAL.edge,
  amber: PAL.amber,
  amberDim: 0x4a3417, // tło aktywnego przycisku .m-ab.act
  red: PAL.bad,
  redDim: 0x5a1e16,
  grey: PAL.dim,
  greyDim: 0x4a3c2c,
  white: PAL.text,
} as const;

/** Kolory dziennika w palecie Oldgame (.m-log). */
const TONE: Record<LogTone, number> = { dim: 0x9c958a, good: PAL.good, bad: PAL.bad, amber: PAL.amber, hd: PAL.text };
const HP_TONE = { good: PAL.good, amber: PAL.amber, bad: PAL.bad } as const;
/** Kolory paska PW na kartach drużyny (hpCol('pc') z Oldgame/src/mission/hud.js). */
const HP_FILL = { good: PAL.good, amber: PAL.amber, bad: PAL.bad } as const;

const cut = (s: string, n: number): string => (s.length > n ? s.slice(0, n - 1) + '…' : s);

const M = 4; // margines od krawędzi
const LH = 9; // wysokość linii tekstu

// geometria paneli
/** Karta najemnika (port .m-card z Oldgame/src/mission/hud.js): duży portret, imię na dole portretu, pasek PW pod nim. */
const PC_PT = 40;
const PARTY_W = PC_PT + 4;
const PC_HPB = 9;
const PARTY_H = 2 + PC_PT + 1 + PC_HPB + 2;
const PC_GAP = 3;
/** Menu po prawej (port .m-menu): siatka 2 kolumn + szeroki "Odwrót". */
const BTN_W = 78;
const BTN_H = 12;
const BTN_GAP = 2;
const MENU_ROWS = 5;
const LOG_W = 196;
const LOG_LINES = 9;
const LOG_H = 13 + LOG_LINES * LH + 3;
const SHEET_W = 186;
const SHEET_X = M + PARTY_W + 4;
const FOE_W = 44;
const FOE_H = 17;
/** Prawa kolumna: siatka przycisków 2 x 4 + panel celów. */
const RCOL_W = BTN_W * 2 + 4;
const RCOL_X = BASE_W - M - RCOL_W;
const OBJ_Y = M + (BTN_H + BTN_GAP) * MENU_ROWS + 2;
/** Środek góry: między kartami drużyny a prawą kolumną. */
const MID_X0 = M + PARTY_W + 4;
const MID_X1 = RCOL_X - 4;
const INIT_W = 30;
const INIT_H = 19;
const SHEET_Y = M + LH + 1 + INIT_H + 8;
/** Pasek akcji: dół, między kartami drużyny a dziennikiem. */
const AB_X = M + PARTY_W + 4;
const AB_W = BASE_W - M - LOG_W - 4 - AB_X;
const AB_COLS = 2;
const AB_BW = Math.floor((AB_W - 2) / AB_COLS);
const AB_BH = 11;
/** Kafel broni w panelu akcji (ikona + nazwa + obrażenia). */
const WT_H = 13;

type BtnVariant = 'normal' | 'primary' | 'danger';
type DragTarget = 'log' | 'sheet' | 'actions' | 'logSize' | 'logThumb';

interface Button {
  bg: Phaser.GameObjects.Rectangle;
  text: PixelText;
  enabled: boolean;
  hovered: boolean;
  color: number;
  set(label: string, enabled: boolean): void;
}

/** Pozycje przesuniętych paneli (null = domyślna); na poziomie modułu, żeby przetrwały kolejne misje. */
let logPos: { x: number; y: number } | null = null;
let sheetPos: { x: number; y: number } | null = null;
let actPos: { x: number; y: number } | null = null;
/** Rozmiar dziennika (zmieniany uchwytem w prawym dolnym rogu). */
let logSize = { w: LOG_W, h: LOG_H };
/**
 * Skale czcionki dziennika: tylko k / ZOOM (1 piksel czcionki = k pikseli płótna), żeby litery zostały ostre.
 * Zakres ~0.5x - 2x rozmiaru bazowego.
 */
const LOG_FONT_SCALES: number[] = (() => {
  const out: number[] = [];
  for (let k = Math.max(1, Math.ceil(ZOOM / 2)); k <= ZOOM * 2; k++) out.push(k / ZOOM);
  return out;
})();
let logFont = Math.max(0, LOG_FONT_SCALES.indexOf(1));
const LOG_MIN_W = 120;
const LOG_HEAD = 13; // nagłówek + linia

interface DisplayLine {
  text: string;
  tone: LogTone;
}

export interface UISceneData {
  hud: HudState;
}

/**
 * Równoległa scena HUD nad WorldScene. Uruchamiana przez `scene.launch('UIScene', { hud })`.
 */
export class UIScene extends Phaser.Scene {
  private hud!: HudState;

  private partyLayer!: Phaser.GameObjects.Container;
  private foeLayer!: Phaser.GameObjects.Container;
  private roundText!: PixelText;

  private btnInv!: Button;
  private btnHelp!: Button;
  private btnGroup!: Button;
  private btnSpeed!: Button;
  private btnRetreat!: Button;
  private btnOptions!: Button;
  private btnZoomOut!: Button;
  private btnZoomIn!: Button;
  private objLayer!: Phaser.GameObjects.Container;
  private initLayer!: Phaser.GameObjects.Container;
  private actionLayer!: Phaser.GameObjects.Container;
  private rollBox: Phaser.GameObjects.Container | null = null;
  private helpBox: Phaser.GameObjects.Container | null = null;
  private shownPrompt = 0;
  private promptWin: UiWindow | null = null;

  private hoverBg!: Phaser.GameObjects.Rectangle;
  private hoverText!: PixelText;

  // dziennik
  private logPanel!: Phaser.GameObjects.Container;
  private logBg!: Phaser.GameObjects.Rectangle;
  private logLineTexts: PixelText[] = [];
  private logMeasure!: PixelText;
  private logWrapCache = new Map<number, string[]>();
  private logScroll = 0; // linii od dołu
  private logUnseen = 0;
  private logCollapsed = false;
  private logSeenId = 0;
  private logNewBtn!: PixelText;
  private logColBtn!: PixelText;
  private logScrollBar!: Phaser.GameObjects.Graphics;
  private logUpBtn!: PixelText;
  private logDownBtn!: PixelText;
  private logTrack!: Phaser.GameObjects.Rectangle;
  private logNewBg!: Phaser.GameObjects.Rectangle;
  private logHeadLine!: Phaser.GameObjects.Graphics;
  private logGrip!: Phaser.GameObjects.Rectangle;
  private logFontBtns: PixelText[] = [];
  private logResize!: Phaser.GameObjects.Rectangle;
  private logResizeMark!: Phaser.GameObjects.Graphics;
  private logLayoutKey = '';

  // karta postaci / ekwipunek
  private sheet!: Phaser.GameObjects.Container;
  private sheetFooter: PixelText | null = null;

  // przeciąganie paneli za nagłówek
  private drag: { target: DragTarget; dx: number; dy: number } | null = null;
  private logRepeat: Phaser.Time.TimerEvent | null = null;
  private logThumb = { y: 0, h: 0, trackY: 0, trackH: 0 };

  private banner: Phaser.GameObjects.Container | null = null;

  constructor() {
    super('UIScene');
  }

  init(data: UISceneData): void {
    this.hud = data.hud;
    this.logWrapCache = new Map();
    this.logLineTexts = [];
    this.logScroll = 0;
    this.logUnseen = 0;
    this.logSeenId = 0;
    this.logFontBtns = [];
    this.logLayoutKey = '';
    this.sheetFooter = null;
    this.drag = null;
    this.banner = null;
    this.rollBox = null;
    this.helpBox = null;
    this.shownPrompt = 0;
    this.promptWin = null;
  }

  create(): void {
    if (!this.hud) throw new Error('UIScene: brak HudState - uruchom przez scene.launch("UIScene", { hud })');
    fitCamera(this);

    // ---- lewy górny: drużyna
    this.partyLayer = this.add.container(M, M);

    // ---- środek góra: runda + wrogowie / inicjatywa
    this.roundText = this.text((MID_X0 + MID_X1) / 2, M, '').setOrigin(0.5, 0);
    this.foeLayer = this.add.container(0, M + LH + 1);
    this.initLayer = this.add.container(0, M + LH + 1);

    // ---- prawy górny: menu misji jak w Oldgame/src/mission/hud.js (H.menu: 2 kolumny, "Odwrót" na całą szerokość)
    //      + ekwipunek; bronie wybiera się w panelu akcji; "Koniec tury" jest w pasku akcji walki, jak tam.
    const bx = RCOL_X, bx2 = RCOL_X + BTN_W + 4, row = (i: number): number => M + (BTN_H + BTN_GAP) * i;
    this.btnHelp = this.button(bx, row(0), BTN_W, '', () => this.hud.toggleHelp());
    this.btnOptions = this.button(bx2, row(0), BTN_W, '', () => !modalOpen(this) && void openOptions(this));
    this.btnSpeed = this.button(bx, row(1), BTN_W, '', () => this.hud.command({ kind: 'cycleSpeed' }));
    this.btnGroup = this.button(bx2, row(1), BTN_W, '', () => this.hud.command({ kind: 'toggleGroup' }));
    this.btnZoomOut = this.button(bx, row(2), BTN_W, '', () => this.hud.command({ kind: 'zoom', f: 1 / 1.25 }));
    this.btnZoomIn = this.button(bx2, row(2), BTN_W, '', () => this.hud.command({ kind: 'zoom', f: 1.25 }));
    this.btnInv = this.button(bx, row(3), RCOL_W, '', () => this.toggleSheet());
    this.btnRetreat = this.button(bx, row(4), RCOL_W, '', () => this.hud.command({ kind: 'retreat' }), 'danger');
    this.objLayer = this.add.container(RCOL_X, OBJ_Y);
    this.actionLayer = this.add.container(0, 0);

    // ---- lewy dół: opis pod kursorem
    this.hoverBg = this.panelRect(M, BASE_H - M - 12, 10, 12).setVisible(false);
    this.hoverText = this.text(M + 3, BASE_H - M - 11, '').setVisible(false);

    this.createLog();
    this.sheet = this.add.container(sheetPos?.x ?? SHEET_X, sheetPos?.y ?? SHEET_Y).setVisible(false);

    // ---- przeciąganie paneli (dziennik, ekwipunek) za nagłówek
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => this.onDragMove(p));
    this.input.on('pointerup', () => {
      const thumb = this.drag?.target === 'logThumb';
      this.drag = null;
      this.stopLogRepeat();
      if (thumb) this.drawLog();
    });
    this.input.on('gameout', () => (this.drag = null));

    // ---- klawiatura (jak w starym HUD: Spacja, I, X, Esc, 1-9)
    // (Oldgame/src/scenes/mission.js:640-651: H, F, G, Tab, Spacja, Esc, 1-9)
    const kb = this.input.keyboard;
    const blocked = (): boolean => modalOpen(this) || !!this.hud.prompt;
    kb?.on('keydown-SPACE', (e: KeyboardEvent) => {
      e.preventDefault?.();
      if (!blocked() && !this.hud.helpOpen) this.hud.command({ kind: 'endTurn' });
    });
    kb?.on('keydown-I', () => !blocked() && this.toggleSheet());
    kb?.on('keydown-X', () => !blocked() && this.hud.command({ kind: 'swapWeapons' }));
    kb?.on('keydown-H', () => !blocked() && this.hud.toggleHelp());
    // dziennik: PgUp / PgDn = strona, Home = najstarsze, End = najnowsze
    kb?.on('keydown-PAGE_UP', () => !blocked() && this.scrollLog(this.logLines() - 1));
    kb?.on('keydown-PAGE_DOWN', () => !blocked() && this.scrollLog(-(this.logLines() - 1)));
    kb?.on('keydown-HOME', () => !blocked() && this.scrollLog(1e6));
    kb?.on('keydown-END', () => !blocked() && this.scrollLog(-1e6));
    kb?.on('keydown-F', () => !blocked() && this.hud.command({ kind: 'cycleSpeed' }));
    kb?.on('keydown-G', () => !blocked() && this.hud.command({ kind: 'toggleGroup' }));
    kb?.on('keydown-TAB', (e: KeyboardEvent) => {
      e.preventDefault?.();
      if (!blocked()) this.hud.command({ kind: 'cycleMember' });
    });
    kb?.on('keydown-ESC', () => {
      if (blocked()) return;
      if (this.hud.helpOpen) this.hud.toggleHelp(false);
      else if (this.hud.inventoryOpen) this.hud.toggleInventory(false);
      else this.hud.command({ kind: 'cancel' });
    });
    kb?.on('keydown', (e: KeyboardEvent) => {
      if (blocked() || this.hud.helpOpen) return;
      const n = Number(e.key);
      if (!Number.isInteger(n) || n < 1) return;
      if (this.hud.inventoryOpen) {
        const row = this.usableRows()[n - 1];
        if (row?.inst) this.useItem(row.inst.uid);
        return;
      }
      if (this.hud.inCombat && this.hud.actions.length) {
        const b = this.hud.actions[n - 1];
        if (b?.enabled && this.hud.canAct) this.hud.command({ kind: 'action', id: b.id });
        else if (b) SoundManager.sfx('error', { vol: 0.4 });
        return;
      }
      if (n <= this.hud.party.length) this.hud.command({ kind: 'selectMember', index: n - 1 });
    });

    // ---- kółko myszy nad dziennikiem = przewijanie
    this.input.on('wheel', (p: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => {
      if (this.logCollapsed || !this.logBg.getBounds().contains(p.x, p.y)) return;
      this.scrollLog(dy > 0 ? -2 : 2);
    });

    // ---- subskrypcja modelu
    const off = this.hud.on((c) => this.onHudChange(c));
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, off);


    this.drawParty();
    this.drawFoes();
    this.drawTurn();
    this.drawLog();
    this.drawHover();
    this.drawObjectives();
    this.drawActions();
  }

  private onHudChange(c: HudChange): void {
    switch (c) {
      case 'stats':
        this.drawParty();
        this.drawFoes();
        this.drawTurn();
        this.drawActions();
        if (this.hud.inventoryOpen) this.drawSheet();
        break;
      case 'turn':
        this.drawTurn();
        this.drawParty();
        this.drawActions();
        if (this.hud.inventoryOpen) this.drawSheet();
        break;
      case 'log':
        this.drawLog();
        break;
      case 'hover':
        this.drawHover();
        break;
      case 'inventory':
        this.drawSheet();
        this.drawTurn();
        this.drawActions();
        break;
      case 'banner':
        this.showBanner();
        break;
      case 'objectives':
        this.drawObjectives();
        break;
      case 'actions':
        this.drawActions();
        break;
      case 'initiative':
        this.drawFoes();
        this.drawTurn();
        break;
      case 'roll':
        this.showRoll();
        break;
      case 'prompt':
        this.showPrompt();
        break;
      case 'settings':
        this.drawTurn();
        break;
      case 'help':
        this.drawHelp();
        break;
    }
  }

  // ================================================================== prymitywy

  /** Tekst HUD: czcionka bitmapowa 6x8 z czarnym obrysem; size >= 11 = pogrubienie (bez skalowania). */
  private text(x: number, y: number, s: string, color: number = PAL.text, size = 8): PixelText {
    return pixelText(this, x, y, s, { color, bold: size >= 11 });
  }

  private recolor(t: PixelText, color: number, _glow = true): PixelText {
    return t.setColor(color);
  }

  /** Tło panelu, które połyka kliknięcia (żeby nie przechodziły do WorldScene). */
  private panelRect(x: number, y: number, w: number, h: number, stroke: number = C.greenDim): Phaser.GameObjects.Rectangle {
    return this.add.rectangle(x, y, w, h, C.bg, 0.92).setOrigin(0).setStrokeStyle(1, stroke).setInteractive();
  }

  private bar(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number, ratio: number, color: number, dim: number): void {
    g.fillStyle(dim, 1).fillRect(x, y, w, h);
    g.fillStyle(color, 1).fillRect(x, y, Math.round(w * Math.max(0, Math.min(1, ratio))), h);
  }

  /** Przycisk menu w stylu starego .btn (Oldgame/index.html): brązowe tło, rdzawa ramka, twardy cień. */
  private button(x: number, y: number, w: number, label: string, onClick: () => void, variant: BtnVariant = 'normal'): Button {
    const edge = variant === 'primary' ? PAL.amber : variant === 'danger' ? PAL.blood : PAL.edge;
    const ink = variant === 'primary' ? PAL.amber : variant === 'danger' ? PAL.bad : PAL.text;
    this.add.rectangle(x + 1, y + 1, w, BTN_H, 0x000000, 0.8).setOrigin(0);
    const bg = this.add.rectangle(x, y, w, BTN_H, PAL.panel2, 1).setOrigin(0).setStrokeStyle(1, edge).setInteractive({ useHandCursor: true });
    const text = this.text(x + w / 2, y + 2, label, ink).setOrigin(0.5, 0);
    const b: Button = {
      bg, text, enabled: true, hovered: false, color: ink,
      set: (l, enabled) => {
        b.enabled = enabled;
        text.setText(fitText(l, w - 4));
        const hot = b.hovered && enabled;
        bg.setFillStyle(hot ? 0x3a2c1e : PAL.panel2, 1).setStrokeStyle(1, hot ? PAL.edgeHi : edge);
        text.setColor(hot ? 0xffffff : ink);
        bg.setAlpha(enabled ? 1 : 0.55);
        text.setAlpha(enabled ? 1 : 0.4);
      },
    };
    let raw = label;
    const set = b.set;
    b.set = (l, enabled) => {
      raw = l;
      set(l, enabled);
    };
    bg.on('pointerover', () => {
      b.hovered = true;
      if (b.enabled) SoundManager.sfx('hover');
      b.set(raw, b.enabled);
    });
    bg.on('pointerout', () => {
      b.hovered = false;
      b.set(raw, b.enabled);
    });
    bg.on('pointerdown', () => {
      if (!b.enabled) {
        SoundManager.sfx('error', { vol: 0.4 });
        return;
      }
      SoundManager.sfx('click');
      onClick();
    });
    b.set(label, true);
    return b;
  }

  // ================================================================== drużyna (port H.party_)

  private drawParty(): void {
    const L = this.partyLayer;
    L.removeAll(true);
    const hud = this.hud;
    hud.party.forEach((ch, i) => {
      const y = i * (PARTY_H + PC_GAP);
      const isCurrent = ch === hud.active;
      const turn = isCurrent && hud.inCombat && hud.phase !== TurnPhase.ENEMY_TURN && ch.hp > 0;
      const st = stateLabel(ch);
      const dead = !!ch.conditions.dead;
      // ramka jak .m-card / .sel / .act / .down
      const edge = turn || isCurrent ? PAL.amber : ch.hp <= 0 ? PAL.blood : PAL.edge;
      const shadow = this.add.rectangle(2, y + 2, PARTY_W, PARTY_H, 0x000000, 0.5).setOrigin(0);
      const bg = this.add.rectangle(0, y, PARTY_W, PARTY_H, 0x120e0b, 0.92).setOrigin(0).setStrokeStyle(2, edge).setInteractive({ useHandCursor: true });
      bg.on('pointerdown', () => this.hud.command({ kind: 'selectMember', index: i }));
      bg.on('pointerover', () => this.hud.setHover(this.memberTip(ch)));
      bg.on('pointerout', () => this.hud.setHover(null));
      const parts: Phaser.GameObjects.GameObject[] = [shadow, bg];
      if (turn) parts.push(this.add.rectangle(-1, y - 1, PARTY_W + 2, PARTY_H + 2).setOrigin(0).setStrokeStyle(1, PAL.amber, 0.45));

      // portret: tekstura w natywnej gęstości (1 teksel = 1 piksel płótna), więc jest ostry
      const px = 2, py = y + 2;
      const img = this.add.image(px, py, portraitKey(this, ch, PC_PT)).setOrigin(0);
      if (ch.hp <= 0) img.setTint(dead ? 0x555555 : 0x8a8a8a);
      parts.push(img, this.add.rectangle(px, py, PC_PT, PC_PT).setOrigin(0).setStrokeStyle(1, 0x000000));

      // imię na dole portretu (.m-nm)
      parts.push(this.add.rectangle(px, py + PC_PT - LH, PC_PT, LH, 0x000000, 0.72).setOrigin(0));
      const nameCol = turn || isCurrent ? PAL.amber : parseColor(ch.nameColor, PAL.text);
      parts.push(this.text(px + 1, py + PC_PT - LH + 1, fitText(ch.name, PC_PT - 2), nameCol));

      // stan (POLEGŁ / NIEPRZYT.) na środku portretu (.m-pt .st)
      if (st) {
        parts.push(this.add.rectangle(px, py + 14, PC_PT, LH + 1, 0x000000, 0.8).setOrigin(0));
        parts.push(this.text(px + PC_PT / 2, py + 15, fitText(st, PC_PT - 2), PAL.bad).setOrigin(0.5, 0));
      }

      // górny rząd na portrecie: pipsy akcji w turze + chipy stanów (.m-row)
      const g = this.add.graphics();
      parts.push(g);
      let cx = px + 1;
      if (turn) {
        for (let k = 0; k < hud.maxAp; k++) {
          g.fillStyle(0x000000, 1).fillCircle(cx + 2.5, py + 3.5, 3);
          g.lineStyle(1, PAL.amber, 1).strokeCircle(cx + 2.5, py + 3.5, 2);
          if (k < hud.ap) g.fillStyle(PAL.amber, 1).fillCircle(cx + 2.5, py + 3.5, 2);
          cx += 6;
        }
        cx += 1;
      }
      const chips = conditionChips(ch);
      const maxChips = turn ? 1 : 3;
      chips.slice(0, maxChips).forEach((chip, k) => {
        const col = chip.bad ? PAL.bad : PAL.amber;
        const rowY = turn ? py + 8 : py + 1 + k * (LH + 1);
        const t = this.text(px + 2, rowY + 1, chip.label, col);
        const r = this.add.rectangle(px + 1, rowY, t.width + 3, LH, 0x000000, 0.7).setOrigin(0).setStrokeStyle(1, PAL.edge).setInteractive();
        r.on('pointerover', () => this.hud.setHover(`${chip.name}${chip.value > 1 ? ' ' + chip.value : ''}: ${chip.desc}`));
        r.on('pointerout', () => this.hud.setHover(null));
        parts.push(r, t);
      });

      // pasek PW z liczbą w środku (.m-hpb)
      const hy = py + PC_PT + 1;
      g.fillStyle(0x000000, 1).fillRect(px, hy, PC_PT, PC_HPB);
      g.fillStyle(HP_FILL[hpTone(ch)], 1).fillRect(px + 1, hy + 1, Math.round((PC_PT - 2) * Math.max(0, Math.min(1, hpRatio(ch)))), PC_HPB - 2);
      g.lineStyle(1, 0x2a2018, 1).strokeRect(px + 0.5, hy + 0.5, PC_PT - 1, PC_HPB - 1);
      const hp = `${Math.max(0, ch.hp)}/${ch.maxHp}${ch.tempHp ? '+' + ch.tempHp : ''}`;
      parts.push(this.text(px + PC_PT / 2, hy, fitText(hp, PC_PT), 0xffffff).setOrigin(0.5, 0));

      L.add(parts);
    });
  }

  /** Opis najemnika pod kursorem (podpowiedź karty z Oldgame: imię, poziom, KP, percepcja, prędkość, stany). */
  private memberTip(ch: Character): string {
    const stats = statPairs(ch).map(([k, v]) => `${k} ${v}`).join(' · ');
    const conds = conditionChips(ch).map((c) => c.name + (c.value > 1 ? ' ' + c.value : '')).join(', ');
    return `${ch.name} · ${classLabel(ch)} · ${stats}${conds ? ' · ' + conds : ''}`;
  }

  // ================================================================== runda + wrogowie (port H.initBar)

  private drawTurn(): void {
    const hud = this.hud;
    const enemy = hud.phase === TurnPhase.ENEMY_TURN;
    const name = hud.active?.name.toUpperCase() ?? '—';
    const cur = hud.initiative.find((e) => e.current);
    if (!hud.inCombat) this.roundText.setText(cut(`EKSPLORACJA · LIDER: ${name}`, 36));
    else this.roundText.setText(cut(`RUNDA ${hud.round} · ${enemy ? `TURA: ${(cur?.ch.name ?? 'WRÓG').toUpperCase()}` : `TURA: ${name}`}`, 36));
    this.recolor(this.roundText, enemy ? C.red : C.amber);

    const locked = !hud.canAct;
    this.btnHelp.set('STEROWANIE [H]', true);
    this.btnOptions.set('OPCJE', true);
    this.btnSpeed.set(hud.speed >= 4 ? 'x4 BEZ KOŚCI [F]' : `TEMPO x${hud.speed} [F]`, true);
    this.btnGroup.set(hud.groupMove ? 'RUCH: DRUŻ. [G]' : 'RUCH: SOLO [G]', !hud.inCombat);
    this.btnZoomOut.set('MAPA −', true);
    this.btnZoomIn.set('MAPA +', true);
    this.btnInv.set(hud.inventoryOpen ? 'ZAMKNIJ [I]' : 'EKWIPUNEK [I]', true);
    this.btnRetreat.set('ODWRÓT', !locked || (hud.inCombat && !enemy && !hud.busy));
  }

  private drawFoes(): void {
    const L = this.foeLayer;
    L.removeAll(true);
    this.drawInitiative();
    if (this.hud.inCombat && this.hud.initiative.length) return;
    const max = Math.floor((MID_X1 - MID_X0 + 3) / (FOE_W + 3));
    const foes = this.hud.foes.slice(0, max);
    if (!foes.length) return;
    const total = foes.length * FOE_W + (foes.length - 1) * 3;
    let x = Math.round((MID_X0 + MID_X1) / 2 - total / 2);
    for (const f of foes) {
      L.add(this.foeCard(x, 0, f));
      x += FOE_W + 3;
    }
  }

  private foeCard(x: number, y: number, ch: Character): Phaser.GameObjects.GameObject[] {
    const dead = ch.hp <= 0;
    const bg = this.panelRect(x, y, FOE_W, FOE_H, dead ? C.greyDim : C.redDim);
    const name = this.text(x + 2, y, cut(ch.name, 8), dead ? C.grey : C.red);
    const g = this.add.graphics();
    this.bar(g, x + 2, y + 10, FOE_W - 4, 4, hpRatio(ch), HP_TONE[hpTone(ch)], C.redDim);
    bg.on('pointerover', () => this.hud.setHover(`${ch.name} (${classLabel(ch)}) · PW ${Math.max(0, ch.hp)}/${ch.maxHp}${dead ? ' · martwy' : ''}`));
    bg.on('pointerout', () => this.hud.setHover(null));
    return [bg, name, g];
  }

  // ================================================================== inicjatywa (port H.initBar)

  private drawInitiative(): void {
    const L = this.initLayer;
    L.removeAll(true);
    const list = this.hud.inCombat ? this.hud.initiative : [];
    if (!list.length) return;
    const max = Math.floor((MID_X1 - MID_X0 + 2) / (INIT_W + 2));
    // okno wokół bieżącej postaci
    const ci = Math.max(0, list.findIndex((e) => e.current));
    const start = Math.max(0, Math.min(list.length - max, ci - 1));
    const shown = list.slice(start, start + max);
    const total = shown.length * (INIT_W + 2) - 2;
    const x0 = Math.round((MID_X0 + MID_X1) / 2 - total / 2);
    let x = x0;
    for (const e of shown) {
      L.add(this.initChip(x, 0, e));
      x += INIT_W + 2;
    }
    if (start > 0) L.add(this.text(x0 - 6, 4, '‹', C.grey));
    if (start + max < list.length) L.add(this.text(x, 4, '›', C.grey));
  }

  private initChip(x: number, y: number, e: InitEntry): Phaser.GameObjects.GameObject[] {
    const enemy = e.side === 'enemy';
    const stroke = e.current ? C.amber : enemy ? PAL.blood : PAL.steel;
    const bg = this.panelRect(x, y, INIT_W, INIT_H, stroke);
    if (e.current) bg.setStrokeStyle(2, C.amber);
    const g = this.add.graphics();
    const col = e.done ? C.grey : enemy ? C.red : C.white;
    const nm = this.text(x + 2, y, cut(e.ch.name, 5), col);
    const ini = this.text(x + INIT_W - 2, y + 8, String(e.init), C.grey, 7).setOrigin(1, 0);
    this.bar(g, x + 2, y + INIT_H - 4, INIT_W - 4, 2, hpRatio(e.ch), HP_TONE[hpTone(e.ch)], 0x000000);
    const extra: Phaser.GameObjects.GameObject[] = [];
    if (e.down) extra.push(this.text(x + 2, y + 8, '!', C.red, 7));
    if (e.current) extra.push(this.text(x + INIT_W / 2, y + INIT_H, '▲', C.amber, 7).setOrigin(0.5, 0));
    bg.on('pointerover', () => this.hud.setHover(`${e.ch.name} (${classLabel(e.ch)}) · PW ${Math.max(0, e.ch.hp)}/${e.ch.maxHp} · inicjatywa ${e.init}${e.down ? ' · powalony' : ''}${e.done ? ' · już działał' : ''}`));
    bg.on('pointerout', () => this.hud.setHover(null));
    if (!enemy) {
      const i = this.hud.party.indexOf(e.ch);
      bg.on('pointerdown', () => i >= 0 && this.hud.command({ kind: 'selectMember', index: i }));
    }
    if (e.done) [nm, ini].forEach((t) => t.setAlpha(0.6));
    return [bg, g, nm, ini, ...extra];
  }

  // ================================================================== cele zlecenia (port H.objective)

  private drawObjectives(): void {
    const L = this.objLayer;
    L.removeAll(true);
    const rows = this.hud.objectives;
    if (!rows.length) return;
    const items: Phaser.GameObjects.GameObject[] = [];
    const title = this.text(3, 1, 'ZLECENIE', PAL.amber);
    const name = this.text(3, LH + 3, this.hud.objectiveTitle.toUpperCase() || '—', PAL.amber).setWordWrapWidth(RCOL_W - 6);
    items.push(title, name);
    let y = LH + 3 + Math.ceil(name.height) + 2;
    for (const r of rows) {
      const box = r.go ? '►' : r.done ? '☑' : '☐';
      const col = r.go ? PAL.toxic : r.done ? PAL.good : r.dim ? PAL.dim : PAL.text;
      const t = this.text(4, y, `${box} ${r.text}`, col, 7).setWordWrapWidth(RCOL_W - 8);
      if (r.done && !r.go) t.setAlpha(0.75);
      items.push(t);
      y += Math.max(LH, Math.ceil(t.height)) + 1;
      if (r.go) this.tweens.add({ targets: t, alpha: { from: 1, to: 0.45 }, duration: 500, yoyo: true, repeat: -1 });
    }
    y += 1;
    const shadow = this.add.rectangle(2, 2, RCOL_W, y, 0x000000, 0.5).setOrigin(0);
    const bg = this.add.rectangle(0, 0, RCOL_W, y, PAL.panel, 0.94).setOrigin(0).setStrokeStyle(1, PAL.edge).setInteractive();
    const line = this.add.graphics().lineStyle(1, PAL.edge, 1).lineBetween(2, LH + 1.5, RCOL_W - 2, LH + 1.5);
    L.add([shadow, bg, line, ...items]);
  }

  // ================================================================== pasek akcji walki (port C.refreshBar / H.abBtn)

  /**
   * Panel akcji (przesuwany za nagłówek jak dziennik, PPM na nagłówku = pozycja domyślna).
   * Na górze dostępne bronie: klik w broń = dobycie jej (zostaje do kolejnej zmiany; w walce 1 akcja).
   * Poza walką panel pokazuje tylko bronie.
   */
  private drawActions(): void {
    const L = this.actionLayer;
    L.removeAll(true);
    const ch = this.hud.active;
    const list = this.hud.actions;
    const weapons = ch && !ch.attacks ? this.weaponSlots(ch) : [];
    if (!list.length && !weapons.length) {
      L.setVisible(false);
      return;
    }
    L.setVisible(true);
    const W = AB_W;
    const wRows = Math.ceil(weapons.length / AB_COLS);
    const aRows = Math.ceil(list.length / AB_COLS);
    const wy = 12;
    const ay = wy + wRows * (WT_H + 1) + (list.length ? 3 : 0);
    const h = ay + aRows * (AB_BH + 1) + 2;

    const bg = this.panelRect(0, 0, W, h, C.amberDim);
    const head = this.text(3, 1, cut((this.hud.actionsHead ?? (ch ? `BROŃ — ${ch.name}` : '')).toUpperCase(), 22), C.amber);
    const g = this.add.graphics();
    if (list.length) {
      for (let k = 0; k < this.hud.maxAp; k++) {
        g.fillStyle(k < this.hud.ap ? C.amber : C.amberDim, 1).fillRect(W - 4 - (this.hud.maxAp - k) * 6, 3, 4, 5);
      }
      g.lineStyle(1, C.amberDim, 1).lineBetween(2, ay - 1.5, W - 2, ay - 1.5);
    }
    const grip = this.dragHandle('actions', W - (list.length ? this.hud.maxAp * 6 + 6 : 0), 11);
    L.add([bg, grip, head, g]);
    weapons.forEach((slot, i) => {
      const x = 2 + (i % AB_COLS) * AB_BW;
      const y = wy + Math.floor(i / AB_COLS) * (WT_H + 1);
      L.add(this.weaponTile(x, y, AB_BW - 2, ch!, slot));
    });
    list.forEach((b, i) => {
      const x = 2 + (i % AB_COLS) * AB_BW;
      const y = ay + Math.floor(i / AB_COLS) * (AB_BH + 1);
      L.add(this.actionButton(x, y, AB_BW - 2, b, i < 9 ? String(i + 1) : ''));
    });

    // pozycja: domyślnie nad dolną krawędzią; przesunięty panel trzyma lewy górny róg
    if (actPos) L.setPosition(Phaser.Math.Clamp(actPos.x, 30 - W, BASE_W - 30), Phaser.Math.Clamp(actPos.y, 0, BASE_H - 12));
    else L.setPosition(AB_X, BASE_H - M - 14 - h);
  }

  /**
   * Bronie postaci do wyboru (sloty z bronią; bez broni - sama Pięść w slocie głównym).
   * Stała kolejność (wg uid przedmiotu), żeby kafle nie zamieniały się miejscami po wyborze.
   */
  private weaponSlots(ch: Character): EquipSlot[] {
    const e = ch.equipment;
    if (!e.weapon2) return ['weapon'];
    return (e.weapon?.uid ?? '') <= e.weapon2.uid ? ['weapon', 'weapon2'] : ['weapon2', 'weapon'];
  }

  /** Kafel broni: wybrana ma bursztynową ramkę; klik w inną = jej dobycie. */
  private weaponTile(x: number, y: number, w: number, ch: Character, slot: EquipSlot): Phaser.GameObjects.GameObject[] {
    const sel = slot === 'weapon';
    const inst = ch.equipment[slot];
    const def = itemDef(inst?.id);
    const wp = normWeapon(inst);
    const stat = def ? itemStatLine(def, true) : `${wp.dmg} ${wp.range ? 'z' + wp.range : 'wręcz'}`;
    const on = sel || this.hud.canAct;
    const fill = sel ? C.amberDim : PAL.panel2;
    const stroke = sel ? C.amber : on ? PAL.edge : C.greyDim;
    const r = this.add.rectangle(x, y, w, WT_H, fill, 0.95).setOrigin(0).setStrokeStyle(1, stroke).setInteractive({ useHandCursor: !sel && on });
    const out: Phaser.GameObjects.GameObject[] = [r];
    let tx = x + 2;
    if (inst) {
      out.push(itemIconImage(this, tx, y + 1, inst.id, 11).setAlpha(on ? 1 : 0.5));
      tx += 13;
    }
    const cost = !sel && this.hud.inCombat;
    const right = x + w - (cost ? 6 : 2);
    const nm = this.text(tx, y + 2, '', sel ? C.white : on ? PAL.text : C.grey, 7);
    const st = this.text(right, y + 2, stat, sel ? C.amber : C.grey, 7).setOrigin(1, 0);
    nm.setText(fitText(wp.name, Math.max(12, right - st.width - 3 - tx)));
    out.push(nm, st);
    if (cost) out.push(this.add.graphics().fillStyle(on ? C.amber : C.greyDim, 1).fillRect(x + w - 4, y + 5, 3, 3));
    const tip = `${wp.name}${def ? ' · ' + itemStatLine(def) : ''} · ${sel ? 'wybrana broń' : `kliknij, aby dobyć${this.hud.inCombat ? ' (1 akcja)' : ''} [X]`}`;
    r.on('pointerover', () => {
      if (!sel && on) {
        r.setFillStyle(0x3a2c1e, 1).setStrokeStyle(1, PAL.edgeHi);
        SoundManager.sfx('hover');
      }
      this.hud.setHover(tip);
    });
    r.on('pointerout', () => {
      r.setFillStyle(fill, 0.95).setStrokeStyle(1, stroke);
      this.hud.setHover(null);
    });
    r.on('pointerdown', () => {
      if (sel) return;
      if (!on) {
        SoundManager.sfx('error', { vol: 0.4 });
        return;
      }
      SoundManager.sfx('click');
      this.hud.command({ kind: 'swapWeapons' });
    });
    return out;
  }

  private actionButton(x: number, y: number, w: number, b: ActionButton, key: string): Phaser.GameObjects.GameObject[] {
    const on = b.enabled && this.hud.canAct;
    const col = b.active ? C.amber : on ? PAL.edge : C.greyDim;
    const r = this.add.rectangle(x, y, w, AB_BH, b.active ? C.amberDim : PAL.panel2, 0.95).setOrigin(0).setStrokeStyle(1, col).setInteractive({ useHandCursor: on });
    const out: Phaser.GameObjects.GameObject[] = [r];
    let tx = x + 2;
    if (key) {
      out.push(this.text(tx, y + 1, key, on ? C.amber : C.greyDim, 7));
      tx += 6;
    }
    if (b.id.startsWith('ab:')) {
      out.push(abilityIconImage(this, tx, y + 1, b.id.slice(3), 9).setAlpha(on ? 1 : 0.4));
      tx += 10;
    }
    const pips = typeof b.cost === 'number' ? Math.min(3, b.cost) : b.cost === 'r' ? 1 : 0;
    const maxChars = Math.floor((x + w - pips * 4 - 2 - tx) / 4.3);
    out.push(this.text(tx, y + 1, cut(b.label, Math.max(4, maxChars)), on ? (b.active ? C.amber : C.white) : C.grey, 7));
    if (pips) {
      const g = this.add.graphics();
      for (let k = 0; k < pips; k++) {
        const px = x + w - 3 - (pips - k) * 4;
        if (b.cost === 'r') g.lineStyle(1, on ? C.amber : C.greyDim, 1).strokeRect(px, y + 4, 3, 3);
        else g.fillStyle(on ? C.amber : C.greyDim, 1).fillRect(px, y + 4, 3, 3);
      }
      out.push(g);
    }
    r.on('pointerover', () => {
      if (on) r.setFillStyle(0x3a2c1e, 1).setStrokeStyle(1, PAL.edgeHi);
      this.hud.setHover(b.tip ?? b.label);
    });
    r.on('pointerout', () => {
      r.setFillStyle(b.active ? C.amberDim : PAL.panel2, 0.95).setStrokeStyle(1, col);
      this.hud.setHover(null);
    });
    r.on('pointerdown', () => {
      if (!on) {
        SoundManager.sfx('error', { vol: 0.4 });
        return;
      }
      SoundManager.sfx('click');
      this.hud.command({ kind: 'action', id: b.id });
    });
    return out;
  }

  // ================================================================== rzut k20 (port G.showD20Roll)

  /**
   * Pikselowa kość k20 (ui/D20Art): toczy się z odbiciami, osiada ścianką do gracza i pokazuje wynik,
   * potem linia "14 + 7 = 21 vs KP 18 — Sukces" w kolorze stopnia. Naturalne 20 / 1 dostają rozbłysk.
   * Kontrakt bez zmian: hud.roll + r.duration (tempo x2 / x4 skraca lub pomija pokaz w HudState.showRoll).
   */
  private showRoll(): void {
    const r = this.hud.roll;
    if (!r) return;
    this.rollBox?.destroy();
    if (!this.textures.exists('d20')) {
      const sh = paintD20Sheet();
      const tex = this.textures.addCanvas('d20', sh.pc.toCanvas());
      if (tex) for (const f of sh.frames) tex.add(f.name, 0, f.x, f.y, f.w, f.h);
      this.registry.set('d20face', sh.face);
    }
    const face = (this.registry.get('d20face') as { x: number; y: number } | undefined) ?? { x: D20_SIZE / 2, y: D20_SIZE / 2 };
    const S = D20_SIZE;
    const cx = Math.round(BASE_W / 2), top = Math.round(BASE_H * 0.17);
    const box = this.add.container(cx, top).setDepth(900);
    this.rollBox = box;
    // kolory stopni jak w Oldgame/src/gfx/dice.js (DEG_COL); dla rzutów wroga sukces = zagrożenie
    const DEG_COL = [0xff5a45, 0xb0a49a, 0x8fe06a, 0xffd24a];
    const col = r.mine ? DEG_COL[r.degree] ?? C.white : r.degree >= 2 ? (r.degree === 3 ? 0xff5a45 : 0xffa040) : 0x9ab8a0;
    const nat = r.d20 === 20 ? 1 : r.d20 === 1 ? -1 : 0;
    const dieY = 12 + S / 2;

    const lab = this.text(0, 0, cut(r.label, 34), C.amber, 7).setOrigin(0.5, 0);
    const shadow = this.add.ellipse(0, dieY + S / 2 - 1, 30, 8, 0x000000, 0.55);
    const burst = this.add.graphics().setPosition(0, dieY).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0);
    const die = this.add.image(0, dieY, 'd20', 't0');
    const num = this.text(0, 0, String(r.d20), nat > 0 ? 0xfff0a0 : nat < 0 ? 0xffb0a0 : 0xfff6e0, 11).setOrigin(0.5, 0.5).setVisible(false);
    // tabliczka z wynikiem
    const sign = r.mod >= 0 ? '+' : '-';
    const lineStr = `${r.d20} ${sign} ${Math.abs(r.mod)} = ${r.total} vs KP ${r.dc} — ${degreeName(r.degree)}`;
    const line = this.text(0, 0, lineStr, col, 8).setOrigin(0.5, 0);
    const pw = Math.ceil(Math.max(line.width, lab.width)) + 14, ph = 13;
    const py = dieY + S / 2 + 5;
    const plate = this.add.container(0, py).setAlpha(0);
    const pbg = this.add.rectangle(0, 0, pw, ph, C.bg, 0.94).setOrigin(0.5, 0).setStrokeStyle(1, col);
    line.setPosition(0, 3);
    plate.add([pbg, line]);
    box.add([shadow, burst, die, num, lab, plate]);
    box.setAlpha(0);
    this.tweens.add({ targets: box, alpha: 1, duration: 70 });
    SoundManager.sfx('dice', { vol: 0.6 });

    // toczenie: 62% czasu pokazu przypada na lot kości przy x1 (~0.55 s), reszta na odczyt
    const roll = Math.max(160, Math.round(Math.min(620, r.duration * 0.52)));
    const settle = Math.round(roll * 0.22);
    const dirX = Math.random() < 0.5 ? -1 : 1;
    const st = { k: 0 };
    const tumble = this.tweens.add({
      targets: st, k: 1, duration: roll, ease: 'Linear',
      onUpdate: () => {
        const k = st.k;
        // klatki zwalniają pod koniec (ease-out), kość skacze coraz niżej i dojeżdża do środka
        const spin = 1 - Math.pow(1 - k, 1.7);
        die.setFrame(`t${Math.floor(spin * D20_TUMBLE * 1.6) % D20_TUMBLE}`);
        const hop = Math.abs(Math.sin(k * Math.PI * 2.5)) * (1 - k) * 16;
        die.setPosition(Math.round(dirX * (1 - k) * (1 - k) * 46), Math.round(dieY - hop));
        shadow.setPosition(die.x, dieY + S / 2 - 1).setScale(1 - hop / 40);
      },
      onComplete: () => {
        die.setPosition(0, dieY);
        shadow.setPosition(0, dieY + S / 2 - 1).setScale(1);
        let f = 0;
        const step = (): void => {
          if (!die.active) return;
          if (f < D20_SETTLE) {
            die.setFrame(`s${f++}`);
            this.time.delayedCall(Math.max(16, settle / D20_SETTLE), step);
            return;
          }
          die.setFrame('end');
          // liczba na ściance frontowej: wyskok 2x -> 1x
          num.setPosition(Math.round(-S / 2 + face.x), Math.round(dieY - S / 2 + face.y) + 1).setVisible(true).setScale(2);
          this.time.delayedCall(90, () => num.active && num.setScale(1));
          this.tweens.add({ targets: die, scale: { from: 1.12, to: 1 }, duration: 110, ease: 'Quad.easeOut' });
          this.tweens.add({ targets: plate, alpha: 1, y: { from: py + 3, to: py }, duration: 90 });
          if (nat !== 0) {
            // naturalne 20: złote promienie; naturalne 1: czerwony błysk i drżenie
            const c = nat > 0 ? 0xffd24a : 0xff4030;
            burst.clear();
            for (let i = 0; i < 12; i++) {
              const a = (i / 12) * Math.PI * 2, r0 = S / 2 - 4, r1 = S / 2 + (i % 2 ? 9 : 16);
              burst.fillStyle(c, i % 2 ? 0.5 : 0.85);
              burst.fillTriangle(Math.cos(a - 0.09) * r0, Math.sin(a - 0.09) * r0, Math.cos(a + 0.09) * r0, Math.sin(a + 0.09) * r0, Math.cos(a) * r1, Math.sin(a) * r1);
            }
            burst.setAlpha(1).setScale(0.7);
            this.tweens.add({ targets: burst, scale: 1.15, angle: nat > 0 ? 25 : 0, alpha: { from: 1, to: nat > 0 ? 0.45 : 0 }, duration: 320, ease: 'Quad.easeOut' });
            if (nat > 0) die.setTint(0xfff0c0);
            else {
              die.setTint(0xc08080);
              this.tweens.add({ targets: [die, num], x: { from: -2, to: 2 }, duration: 40, yoyo: true, repeat: 2, onComplete: () => { die.x = 0; num.x = Math.round(-S / 2 + face.x); } });
            }
          }
        };
        step();
      },
    });
    this.tweens.add({
      targets: box, alpha: 0, delay: r.duration - 150, duration: 150,
      onComplete: () => {
        tumble.remove();
        box.destroy();
        if (this.rollBox === box) this.rollBox = null;
      },
    });
  }

  // ================================================================== pytania (port UI.modal)

  private showPrompt(): void {
    const p = this.hud.prompt;
    if (!p) {
      // odpowiedź przyszła z zewnątrz (np. koniec misji) - zamknij okno
      this.promptWin?.close();
      return;
    }
    if (p.id === this.shownPrompt) return;
    this.promptWin?.close();
    this.shownPrompt = p.id;
    // jak Widgets.dialog, ale z uchwytem okna; Esc / klik w tło = pierwsza opcja
    const w = p.w ?? 280;
    const probe = label(this, 0, 0, p.body, { size: 7, wrap: w - 20, lineSpacing: 2, color: PAL.text });
    const h = Math.ceil(probe.displayHeight) + 54;
    let answered = false;
    const reply = (v: string | null): void => {
      if (answered) return;
      answered = true;
      if (this.hud.prompt?.id === p.id) this.hud.answer(v);
    };
    const win = openWindow(this, w, h, p.title, () => {
      if (this.promptWin === win) this.promptWin = null;
      reply(p.options[0]?.value ?? null);
    });
    this.promptWin = win;
    win.add(probe.setPosition(10, 22));
    let x = w - 8;
    for (const o of [...p.options].reverse()) {
      const btn = kitButton(this, 0, 0, o.label, () => {
        reply(o.value);
        win.close();
      }, { primary: o.primary, danger: o.danger, size: 7 });
      const bw = (btn.box.list[1] as Phaser.GameObjects.Rectangle).width;
      x -= bw;
      btn.box.setPosition(x, h - 22);
      x -= 6;
      win.add(btn.box);
    }
  }

  // ================================================================== sterowanie (port H.help)

  private drawHelp(): void {
    this.helpBox?.destroy();
    this.helpBox = null;
    if (!this.hud.helpOpen) return;
    const W = 330;
    const lines: [string, string][] = [
      ['KAMERA', 'WASD / strzałki lub PPM / środkowy + przeciągnięcie = przesuwanie; kółko, + / - = zoom, 0 = reset; Q/E obrót kamery; Spacja w eksploracji = wycentruj.'],
      ['EKSPLORACJA', 'LPM na pole = ruch (G = drużyna / solo); LPM na skrzynię / cel / jeńca = interakcja; LPM na wroga = zasadzka (drużyna zaczyna, wróg odsłonięty). Strefę ewakuacji wyznaczają zielone słupki.'],
      ['WALKA', '3 akcje na turę. Pola ruchu: niebieskie 1 akcja, żółte 2, pomarańczowe 3. Czerwony kontur = wróg w zasięgu, zielony = cel wsparcia. Kolejne ataki: kara PWA -5/-10.'],
      ['KLAWISZE', '1-9 przyciski akcji (w eksploracji: wybór najemnika), Spacja = koniec tury, Esc / PPM = anuluj, Tab = następny najemnik, I = ekwipunek, X = zmiana broni (albo klik w broń w panelu akcji), PgUp/PgDn/Home/End = przewijanie dziennika, F = tempo x1/x2/x4, G = ruch drużyny/solo, H = ta pomoc.'],
      ['PANELE', 'Ekwipunek i dziennik można przesuwać, przeciągając za nagłówek (LPM). Dziennik: róg prawy dolny = zmiana rozmiaru, A- / A+ = czcionka. PPM na nagłówku = domyślne miejsce i rozmiar.'],
      ['ZASADY', 'Osłona +2 KP; flankowanie = cel odsłonięty. Powaleni potrzebują Pierwszej pomocy, inaczej umierają. Gdy padnie cała drużyna - nikt nie wraca.'],
    ];
    const box = this.add.container(BASE_W / 2 - W / 2, 30).setDepth(950);
    const items: Phaser.GameObjects.GameObject[] = [this.text(W / 2, 4, 'STEROWANIE  [H / Esc]', C.amber).setOrigin(0.5, 0)];
    let y = 16;
    for (const [h, t] of lines) {
      items.push(this.text(6, y, h, C.amber, 7));
      const body = this.text(66, y, t, C.white, 7).setWordWrapWidth(W - 72);
      items.push(body);
      y += Math.ceil(body.height) + 4;
    }
    const bg = this.add.rectangle(0, 0, W, y + 4, C.bg, 0.97).setOrigin(0).setStrokeStyle(1, C.amber).setInteractive();
    bg.on('pointerdown', () => this.hud.toggleHelp(false));
    box.add([bg, ...items]);
    this.helpBox = box;
  }

  // ================================================================== opis pod kursorem (port H.showInfo)

  private drawHover(): void {
    const s = this.hud.hover;
    const show = !!s;
    this.hoverBg.setVisible(show);
    this.hoverText.setVisible(show);
    if (!s) return;
    const maxW = BASE_W - LOG_W - M * 3 - 6;
    this.hoverText.setText(s);
    let txt = s;
    while (this.hoverText.width > maxW && txt.length > 4) {
      txt = txt.slice(0, -2);
      this.hoverText.setText(txt + '…');
    }
    this.hoverBg.setSize(this.hoverText.width + 6, 12);
    this.hoverBg.setStrokeStyle(1, C.greenDim);
  }

  // ================================================================== przesuwane panele

  /** Niewidoczny uchwyt na nagłówku panelu: LPM + przeciągnięcie = przesuń, PPM = pozycja domyślna. */
  private dragHandle(target: 'log' | 'sheet' | 'actions', w: number, h: number): Phaser.GameObjects.Rectangle {
    const r = this.add.rectangle(0, 0, w, h, C.amber, 0).setOrigin(0).setInteractive({ cursor: 'move' });
    r.on('pointerover', () => r.setFillStyle(C.amber, 0.08));
    r.on('pointerout', () => r.setFillStyle(C.amber, 0));
    r.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (p.rightButtonDown()) {
        this.drag = null;
        if (target === 'log') {
          logPos = null;
          logSize = { w: LOG_W, h: LOG_H };
          this.drawLog();
        } else if (target === 'actions') {
          actPos = null;
          this.drawActions();
        } else {
          sheetPos = null;
          this.sheet.setPosition(M, SHEET_Y);
        }
        SoundManager.sfx('click');
        return;
      }
      const box = target === 'log' ? this.logPanel : target === 'actions' ? this.actionLayer : this.sheet;
      this.drag = { target, dx: p.worldX - box.x, dy: p.worldY - box.y };
    });
    return r;
  }

  private onDragMove(p: Phaser.Input.Pointer): void {
    const d = this.drag;
    if (!d) return;
    if (!p.isDown) {
      this.drag = null;
      return;
    }
    if (d.target === 'logSize') {
      // prawy dolny róg: lewy górny stoi w miejscu, panel nie wychodzi poza ekran
      const x0 = this.logPanel.x, y0 = this.logPanel.y;
      const minH = LOG_HEAD + 3 * this.logLH() + 3;
      const w = Phaser.Math.Clamp(Math.round(p.worldX - d.dx), LOG_MIN_W, Math.max(LOG_MIN_W, BASE_W - x0));
      const h = Phaser.Math.Clamp(Math.round(p.worldY - d.dy), minH, Math.max(minH, BASE_H - y0));
      if (w !== logSize.w || h !== logSize.h) {
        logSize = { w, h };
        this.drawLog();
      }
      return;
    }
    if (d.target === 'logThumb') {
      // przeciąganie suwaka dziennika: góra toru = najstarsze, dół = najnowsze
      const t = this.logThumb;
      const maxScroll = Math.max(0, this.logDisplayLines().length - this.logLines());
      const free = Math.max(1, t.trackH - t.h);
      const pos = Phaser.Math.Clamp((p.worldY - this.logPanel.y - d.dy - t.trackY) / free, 0, 1);
      const next = Math.round((1 - pos) * maxScroll);
      if (next !== this.logScroll) {
        this.logScroll = next;
        this.drawLog();
      }
      return;
    }
    const isLog = d.target === 'log';
    const isAct = d.target === 'actions';
    const box = isLog ? this.logPanel : isAct ? this.actionLayer : this.sheet;
    if (!box.visible) {
      this.drag = null;
      return;
    }
    const w = isLog ? logSize.w : isAct ? AB_W : SHEET_W;
    // panel może wyjechać częściowo poza ekran, ale nagłówek i 30 px szerokości zostają widoczne
    const x = Phaser.Math.Clamp(Math.round(p.worldX - d.dx), 30 - w, BASE_W - 30);
    const y = Phaser.Math.Clamp(Math.round(p.worldY - d.dy), 0, BASE_H - 12);
    box.setPosition(x, y);
    if (isLog) logPos = { x, y };
    else if (isAct) actPos = { x, y };
    else sheetPos = { x, y };
  }

  // ================================================================== dziennik (port H.log)

  private createLog(): void {
    this.logPanel = this.add.container(0, 0);
    this.logBg = this.panelRect(0, 0, LOG_W, LOG_H);

    const head = this.text(3, 1, 'DZIENNIK', C.amber);
    this.logHeadLine = this.add.graphics();
    this.logGrip = this.dragHandle('log', 10, 12);
    this.logColBtn = this.text(0, 1, '[-]', PAL.dim).setOrigin(1, 0).setInteractive({ useHandCursor: true });
    this.logColBtn.on('pointerdown', () => {
      SoundManager.sfx('click');
      this.logCollapsed = !this.logCollapsed;
      this.drawLog();
    });

    // A- / A+ = rozmiar czcionki
    this.logFontBtns = [-1, 1].map((dir) => {
      const b = this.text(0, 1, dir < 0 ? 'A-' : 'A+', PAL.dim).setOrigin(1, 0).setInteractive({ useHandCursor: true });
      b.on('pointerdown', () => this.setLogFont(logFont + dir));
      return b;
    });

    this.logMeasure = this.text(0, 0, '', C.grey).setVisible(false);
    this.logScrollBar = this.add.graphics();

    // przewijanie: ▲ / ▼ (przytrzymanie = powtarzanie), klik w tor = strona, suwak do przeciągania
    const arrow = (glyph: string, dir: number): PixelText => {
      const b = this.text(0, 0, glyph, PAL.dim, 7).setOrigin(0.5, 0).setInteractive({ useHandCursor: true });
      b.on('pointerdown', () => {
        SoundManager.sfx('click', { vol: 0.5 });
        this.scrollLog(dir);
        this.logRepeat?.remove();
        this.logRepeat = this.time.addEvent({
          delay: 70, startAt: -230, loop: true,
          callback: () => (this.input.activePointer.isDown ? this.scrollLog(dir) : this.stopLogRepeat()),
        });
      });
      b.on('pointerout', () => this.stopLogRepeat());
      b.on('pointerup', () => this.stopLogRepeat());
      return b;
    };
    this.logUpBtn = arrow('▲', 1);
    this.logDownBtn = arrow('▼', -1);
    this.logTrack = this.add.rectangle(0, 0, 7, 10, C.amber, 0).setOrigin(0).setInteractive({ useHandCursor: true });
    this.logTrack.on('pointerdown', (p: Phaser.Input.Pointer) => {
      const t = this.logThumb;
      const ly = p.worldY - this.logPanel.y;
      if (ly >= t.y && ly <= t.y + t.h) this.drag = { target: 'logThumb', dx: 0, dy: ly - t.y };
      else this.scrollLog(ly < t.y ? this.logLines() - 1 : -(this.logLines() - 1));
    });

    // ciemny tekst na bursztynie: bez obrysu (jasne tło samo daje kontrast)
    this.logNewBg = this.add.rectangle(0, 0, 10, 10, C.amber, 1).setOrigin(0.5, 0).setVisible(false);
    this.logNewBtn = this.text(0, 0, '', C.bg)
      .setFontStyle('plain')
      .setOrigin(0.5, 0)
      .setInteractive({ useHandCursor: true })
      .setVisible(false);
    this.logNewBtn.on('pointerdown', () => {
      SoundManager.sfx('click');
      this.logScroll = 0;
      this.logUnseen = 0;
      this.drawLog();
    });

    // uchwyt zmiany rozmiaru (prawy dolny róg)
    this.logResizeMark = this.add.graphics();
    this.logResize = this.add.rectangle(0, 0, 9, 9, C.amber, 0).setOrigin(1, 1).setInteractive({ cursor: 'nwse-resize' });
    this.logResize.on('pointerover', () => this.logResize.setFillStyle(C.amber, 0.2));
    this.logResize.on('pointerout', () => this.logResize.setFillStyle(C.amber, 0));
    this.logResize.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (p.rightButtonDown()) return;
      // od teraz pozycja jawna: zmiana rozmiaru trzyma lewy górny róg
      logPos = { x: this.logPanel.x, y: this.logPanel.y };
      this.drag = { target: 'logSize', dx: p.worldX - logSize.w, dy: p.worldY - logSize.h };
    });

    this.logPanel.add([this.logBg, this.logGrip, head, this.logHeadLine, this.logColBtn, ...this.logFontBtns, this.logScrollBar, this.logTrack, this.logUpBtn, this.logDownBtn, this.logNewBg, this.logNewBtn, this.logResizeMark, this.logResize]);
  }

  private logScale(): number {
    return LOG_FONT_SCALES[logFont] ?? 1;
  }

  private logLH(): number {
    return LH * this.logScale();
  }

  /** Ile linii mieści dziennik przy bieżącym rozmiarze i czcionce. */
  private logLines(): number {
    return Math.max(1, Math.floor((logSize.h - LOG_HEAD - 3) / this.logLH()));
  }

  private setLogFont(i: number): void {
    const n = Phaser.Math.Clamp(i, 0, LOG_FONT_SCALES.length - 1);
    if (n === logFont) {
      SoundManager.sfx('error', { vol: 0.3 });
      return;
    }
    SoundManager.sfx('click');
    logFont = n;
    this.drawLog();
  }

  /** Przebudowa elementów zależnych od rozmiaru panelu i czcionki (tylko gdy coś się zmieniło). */
  private layoutLog(): void {
    const { w, h } = logSize;
    const key = `${w}x${h}@${logFont}`;
    if (key === this.logLayoutKey) return;
    this.logLayoutKey = key;
    const sc = this.logScale(), lh = this.logLH(), n = this.logLines();

    this.logHeadLine.clear().lineStyle(1, C.greenDim, 1).lineBetween(2, 11.5, w - 2, 11.5);
    this.logColBtn.setX(w - 3);
    this.logFontBtns[1]?.setX(w - 25);
    this.logFontBtns[0]?.setX(w - 41);
    this.logGrip.setSize(w - 70, 12);
    this.logGrip.input?.hitArea.setSize(w - 70, 12);

    // linie tekstu
    for (const t of this.logLineTexts) t.destroy();
    this.logLineTexts = [];
    const at = this.logPanel.getIndex(this.logScrollBar);
    for (let i = 0; i < n; i++) {
      const t = this.text(4, LOG_HEAD + i * lh, '', C.grey).setScale(sc);
      this.logLineTexts.push(t);
      this.logPanel.addAt(t, at + i);
    }
    this.logMeasure.setWordWrapWidth(Math.floor((w - 14) / sc));
    this.logWrapCache.clear();

    this.logUpBtn.setPosition(w - 4, LOG_HEAD - 1);
    this.logDownBtn.setPosition(w - 4, h - 19);
    this.logTrack.setPosition(w - 7, LOG_HEAD + 8).setSize(7, Math.max(2, h - 19 - LOG_HEAD - 8));
    this.logTrack.input?.hitArea.setSize(7, Math.max(2, h - 19 - LOG_HEAD - 8));

    this.logNewBg.setPosition(w / 2, h - 12);
    this.logNewBtn.setPosition(w / 2, h - 11);
    this.logResize.setPosition(w, h);
    this.logResizeMark.clear().fillStyle(C.greenDim, 1);
    for (let i = 0; i < 3; i++) for (let j = 0; j <= i; j++) this.logResizeMark.fillRect(w - 3 - j * 2, h - 7 + i * 2, 1, 1);
  }

  /** Wszystkie wpisy złamane na linie (z pamięcią podręczną zawijania). */
  private logDisplayLines(): DisplayLine[] {
    const out: DisplayLine[] = [];
    const alive = new Set<number>();
    for (const e of this.hud.log) {
      alive.add(e.id);
      let lines = this.logWrapCache.get(e.id);
      if (!lines) {
        lines = this.wrap(e);
        this.logWrapCache.set(e.id, lines);
      }
      for (const text of lines) out.push({ text, tone: e.tone });
    }
    for (const id of this.logWrapCache.keys()) if (!alive.has(id)) this.logWrapCache.delete(id);
    return out;
  }

  private wrap(e: LogEntry): string[] {
    const src = e.tone === 'hd' ? `— ${e.text} —` : e.text;
    const lines = this.logMeasure.getWrappedText(src);
    return lines.map((l, i) => (i === 0 ? l : ' ' + l));
  }

  private drawLog(): void {
    this.layoutLog();
    const lines = this.logLines();
    const { w: W, h: H } = logSize;
    const all = this.logDisplayLines();

    // Nowe wpisy: jeśli gracz przewinął w górę, trzymamy widok w miejscu i liczymy nieprzeczytane.
    const newest = this.hud.log[this.hud.log.length - 1]?.id ?? 0;
    if (newest > this.logSeenId) {
      if (this.logScroll > 0) {
        const added = this.hud.log.filter((e) => e.id > this.logSeenId);
        this.logUnseen += added.length;
        this.logScroll += added.reduce((n, e) => n + (this.logWrapCache.get(e.id)?.length ?? 1), 0);
      }
      this.logSeenId = newest;
    }

    const maxScroll = Math.max(0, all.length - lines);
    this.logScroll = Math.max(0, Math.min(maxScroll, this.logScroll));
    if (this.logScroll === 0) this.logUnseen = 0;

    // zwinięty dziennik = sam nagłówek
    const h = this.logCollapsed ? 12 : H;
    this.logBg.setSize(W, h);
    this.logBg.input?.hitArea.setSize(W, h);
    if (logPos) this.logPanel.setPosition(logPos.x, logPos.y);
    else this.logPanel.setPosition(BASE_W - M - W, BASE_H - M - h);
    this.logColBtn.setText(this.logCollapsed ? '[+]' : '[-]');
    this.logResize.setVisible(!this.logCollapsed);
    this.logResizeMark.setVisible(!this.logCollapsed);
    this.logFontBtns.forEach((b, i) => {
      b.setVisible(!this.logCollapsed);
      const atEnd = i === 0 ? logFont === 0 : logFont === LOG_FONT_SCALES.length - 1;
      b.setColor(atEnd ? C.greyDim : PAL.dim);
    });

    const start = all.length - lines - this.logScroll;
    this.logLineTexts.forEach((t, i) => {
      const ln = all[start + i];
      t.setVisible(!this.logCollapsed && !!ln);
      if (!ln) return;
      t.setText(ln.text);
      this.recolor(t, TONE[ln.tone], ln.tone !== 'dim');
    });

    // pasek przewijania
    const g = this.logScrollBar.clear();
    const scrollable = !this.logCollapsed && all.length > lines;
    this.logUpBtn.setVisible(!this.logCollapsed).setColor(scrollable && this.logScroll < maxScroll ? C.amber : C.greyDim);
    this.logDownBtn.setVisible(!this.logCollapsed).setColor(scrollable && this.logScroll > 0 ? C.amber : C.greyDim);
    this.logTrack.setVisible(scrollable);
    if (scrollable) {
      const trackY = LOG_HEAD + 8, trackH = Math.max(2, H - 19 - trackY);
      const thumbH = Math.min(trackH, Math.max(5, Math.round((trackH * lines) / all.length)));
      const pos = maxScroll ? 1 - this.logScroll / maxScroll : 1;
      const thumbY = trackY + Math.round((trackH - thumbH) * pos);
      this.logThumb = { y: thumbY, h: thumbH, trackY, trackH };
      g.fillStyle(PAL.edge, 0.5).fillRect(W - 5, trackY, 2, trackH);
      g.fillStyle(this.drag?.target === 'logThumb' ? C.amber : PAL.edgeHi, 1).fillRect(W - 6, thumbY, 4, thumbH);
    }

    const showNew = !this.logCollapsed && this.logScroll > 0;
    this.logNewBtn.setVisible(showNew);
    this.logNewBg.setVisible(showNew);
    if (showNew) {
      this.logNewBtn.setText(`▼ NAJNOWSZE${this.logUnseen ? ` (+${this.logUnseen})` : ''}`);
      this.logNewBg.setSize(this.logNewBtn.width + 6, 10);
    }
  }

  private scrollLog(delta: number): void {
    if (this.logCollapsed) return;
    const before = this.logScroll;
    this.logScroll += delta;
    this.drawLog();
    if (this.logScroll === before) this.stopLogRepeat();
  }

  private stopLogRepeat(): void {
    this.logRepeat?.remove();
    this.logRepeat = null;
  }

  // ================================================================== karta postaci / ekwipunek (port H.sheet)

  private toggleSheet(): void {
    this.hud.toggleInventory();
  }

  private usableRows(): InventoryRow[] {
    const ch = this.hud.active;
    return ch ? backpackRows(ch).filter((r) => r.usable) : [];
  }

  private useItem(uid: string): void {
    if (!this.hud.canAct) {
      SoundManager.sfx('error', { vol: 0.4 });
      return;
    }
    this.hud.command({ kind: 'useItem', uid });
  }

  private drawSheet(): void {
    const S = this.sheet;
    S.removeAll(true);
    this.sheetFooter = null;
    const ch = this.hud.active;
    if (!this.hud.inventoryOpen || !ch) {
      S.setVisible(false);
      return;
    }
    S.setVisible(true);

    const items: Phaser.GameObjects.GameObject[] = [];
    let y = 2;
    const sec = (label: string): void => {
      items.push(this.text(3, y, label, C.amber));
      items.push(this.add.graphics().lineStyle(1, C.greenDim, 1).lineBetween(2, y + LH + 0.5, SHEET_W - 2, y + LH + 0.5));
      y += LH + 2;
    };

    // nagłówek
    const close = this.text(SHEET_W - 3, y, '[X]', C.grey).setOrigin(1, 0).setInteractive({ useHandCursor: true });
    close.on('pointerdown', () => {
      SoundManager.sfx('click');
      this.hud.toggleInventory(false);
    });
    items.push(this.text(3, y, cut(ch.name, 22), C.amber), close);
    y += LH;
    items.push(this.text(3, y, classLabel(ch), C.grey));
    y += LH + 2;

    // statystyki 3x2
    statPairs(ch).forEach(([k, v], i) => {
      const cx = 3 + (i % 3) * 61, cy = y + Math.floor(i / 3) * LH;
      items.push(this.text(cx, cy, k, C.grey), this.text(cx + 30, cy, v, C.white));
    });
    y += LH * 2 + 3;

    sec('WYPOSAŻENIE');
    for (const row of equipmentRows(ch)) {
      items.push(...this.itemRow(row, y, null));
      y += LH + 1;
    }
    y += 2;

    sec('PLECAK  (użycie: 1-2 AP)');
    const rows = backpackRows(ch);
    if (!rows.length) {
      items.push(this.text(6, y, 'pusty', C.grey));
      y += LH + 1;
    }
    let key = 0;
    for (const row of rows) {
      items.push(...this.itemRow(row, y, row.usable ? ++key : null));
      y += LH + 1;
    }

    y += 2;
    const acts = this.hud.inCombat && ch === this.hud.active ? this.hud.ap : 3;
    sec(this.hud.inCombat ? `AKCJE (zostało ${acts})` : 'AKCJE');
    for (const ab of abilityRows(ch, acts)) {
      const hit = this.add.rectangle(2, y - 1, SHEET_W - 4, LH + 1, C.amber, 0).setOrigin(0).setInteractive();
      const label = ab.name + (ab.uses !== null ? ` (${ab.uses})` : '');
      const col = ab.off ? C.grey : C.white;
      const cost = ab.cost === null ? 'reakcja' : ab.cost === 0 ? 'darmowa' : '◆'.repeat(Math.min(3, ab.cost));
      items.push(hit, abilityIconImage(this, 4, y - 1, ab.id, 9).setAlpha(ab.off ? 0.45 : 1), this.text(16, y, cut(label, 26), col), this.text(SHEET_W - 4, y, cost, ab.off ? C.greyDim : C.amber).setOrigin(1, 0));
      hit.on('pointerover', () => {
        hit.setFillStyle(C.amber, 0.15);
        this.sheetFooter?.setText(`${ab.name}${ab.cost !== null ? ` [${ab.cost} akc.]` : ''}: ${ab.desc}`);
      });
      hit.on('pointerout', () => hit.setFillStyle(C.amber, 0));
      y += LH + 1;
    }

    // stopka: opis przedmiotu pod kursorem
    y += 2;
    items.push(this.add.graphics().lineStyle(1, C.greenDim, 1).lineBetween(2, y + 0.5, SHEET_W - 2, y + 0.5));
    this.sheetFooter = this.text(3, y + 2, 'Najedź na przedmiot. 1-9 = użyj.', C.grey).setWordWrapWidth(SHEET_W - 6);
    items.push(this.sheetFooter);
    y += 2 + LH * 3;

    // nieprzezroczyste tło: karta zasłania karty drużyny pod spodem
    const solid = this.add.rectangle(0, 0, SHEET_W, y, C.bg, 1).setOrigin(0);
    const bg = this.panelRect(0, 0, SHEET_W, y, C.amber);
    S.setPosition(sheetPos?.x ?? SHEET_X, sheetPos?.y ?? SHEET_Y);
    S.add([solid, bg, this.dragHandle('sheet', SHEET_W - 20, LH * 2 + 2), ...items]);
  }

  private itemRow(row: InventoryRow, y: number, key: number | null): Phaser.GameObjects.GameObject[] {
    const out: Phaser.GameObjects.GameObject[] = [];
    const hit = this.add.rectangle(2, y - 1, SHEET_W - 4, LH + 1, C.amber, 0).setOrigin(0).setInteractive({ useHandCursor: row.usable });
    out.push(hit);
    const color = row.inst ? (row.usable ? C.green : C.white) : C.grey;
    const label = row.name + (row.qty > 1 ? ` x${row.qty}` : '');
    if (row.slot) out.push(this.text(5, y, cut(row.slot, 8), C.grey));
    else if (key) out.push(this.text(5, y, String(key), C.amber));
    // ikona przedmiotu (malowana natywnie w pikselach ekranu - Widgets.itemIconImage)
    const ix = row.slot ? 49 : 12;
    if (row.inst) out.push(itemIconImage(this, ix, y - 1, row.inst.id, 9));
    out.push(this.text(ix + 11, y, cut(label, row.slot ? 16 : 22), color));
    if (row.statShort) out.push(this.text(SHEET_W - 4, y, cut(row.statShort, 11), C.grey).setOrigin(1, 0));

    hit.on('pointerover', () => {
      hit.setFillStyle(C.amber, 0.15);
      this.sheetFooter?.setText([row.desc ? `${row.name}: ${row.desc}` : row.name, row.stat].filter(Boolean).join(' · '));
    });
    hit.on('pointerout', () => hit.setFillStyle(C.amber, 0));
    if (row.usable && row.inst) {
      const uid = row.inst.uid;
      hit.on('pointerdown', () => this.useItem(uid));
    }
    return out;
  }

  // ================================================================== baner (port H.banner)

  private showBanner(): void {
    const b = this.hud.banner;
    if (!b) return;
    this.banner?.destroy();
    const color = TONE[b.tone];
    const t = this.text(0, 0, b.sub ? `${b.text}\n${b.sub}` : b.text, color, 16).setOrigin(0.5).setAlign('center');
    const bg = this.add.rectangle(0, 0, t.width + 16, t.height + 6, C.bg, 0.85).setStrokeStyle(1, color);
    // baner bez skalowania (skala != 1 rozjechałaby piksele czcionki z siatką) - tylko wjazd z góry i zanik
    const box = this.add.container(Math.round(BASE_W / 2), Math.round(BASE_H * 0.36) - 6, [bg, t]).setAlpha(0);
    this.banner = box;
    this.tweens.add({ targets: box, y: Math.round(BASE_H * 0.36), alpha: 1, duration: 140, ease: 'Quad.easeOut', onUpdate: () => (box.y = Math.round(box.y)) });
    this.tweens.add({ targets: box, alpha: 0, delay: 1300, duration: 400, onComplete: () => box.destroy() });
  }
}
