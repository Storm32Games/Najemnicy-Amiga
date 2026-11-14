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
  hpRatio,
  hpTone,
  stateLabel,
  statPairs,
} from '../core/HudState';
import type { Character } from '../core/rules/types';
import { TurnPhase } from '../core/TurnManager';
import { BASE_H, BASE_W, PAL, ZOOM, button as kitButton, fitCamera, label } from './ui/Kit';
import { type Window as UiWindow, abilityIconImage, itemIconImage, modalOpen, openOptions, openWindow, portraitKey } from './ui/Widgets';

// HUD misji - port Oldgame/src/mission/hud.js (DOM) do Phasera, w stylu terminala CRT.
//   lewy górny:   karta drużyny (portret-skrót, PW, AP, stany)       <- H.party_
//   środek góra:  runda + pasek widocznych wrogów z PW                 <- H.initBar
//   prawy górny:  przyciski: koniec tury, ekwipunek, zmiana broni      <- H.menu
//   lewy dół:     opis pola/wroga pod kursorem                         <- H.showInfo
//   prawy dół:    dziennik walki (kółko = przewijanie, zwijany)        <- H.log
//   panel (I):    karta postaci: statystyki, wyposażenie, plecak       <- H.sheet
// Cały stan pochodzi z HudState (src/core); polecenia wracają przez hud.command().

// ------------------------------------------------------------------ paleta / czcionka

const C = {
  bg: 0x050a06,
  green: 0x33ff66,
  greenDim: 0x0f5a24,
  amber: 0xffb000,
  amberDim: 0x5a3e00,
  red: 0xff4444,
  redDim: 0x5a1414,
  grey: 0x8fa596,
  greyDim: 0x2a3a2e,
  white: 0xe8f5e0,
} as const;

const TONE: Record<LogTone, number> = { dim: C.grey, good: C.green, bad: C.red, amber: C.amber, hd: C.white };
const HP_TONE = { good: C.green, amber: C.amber, bad: C.red } as const;

const cut = (s: string, n: number): string => (s.length > n ? s.slice(0, n - 1) + '…' : s);

const M = 4; // margines od krawędzi
const LH = 9; // wysokość linii tekstu

// geometria paneli
const PARTY_W = 124;
const PARTY_H = 44;
const BTN_W = 78;
const BTN_H = 11;
const LOG_W = 196;
const LOG_LINES = 9;
const LOG_H = 13 + LOG_LINES * LH + 3;
const SHEET_W = 186;
const SHEET_Y = M + PARTY_H + 4;
const FOE_W = 44;
const FOE_H = 17;
/** Prawa kolumna: siatka przycisków 2 x 4 + panel celów. */
const RCOL_W = BTN_W * 2 + 4;
const RCOL_X = BASE_W - M - RCOL_W;
const OBJ_Y = M + (BTN_H + 2) * 4 + 2;
/** Środek góry: między kartami drużyny a prawą kolumną. */
const MID_X0 = M + PARTY_W + 4;
const MID_X1 = RCOL_X - 4;
const INIT_W = 30;
const INIT_H = 19;
/** Pasek akcji: dół, między kartami drużyny a dziennikiem. */
const AB_X = M + PARTY_W + 4;
const AB_W = BASE_W - M - LOG_W - 4 - AB_X;
const AB_COLS = 2;
const AB_BW = Math.floor((AB_W - 2) / AB_COLS);
const AB_BH = 11;

interface Button {
  bg: Phaser.GameObjects.Rectangle;
  text: PixelText;
  enabled: boolean;
  hovered: boolean;
  color: number;
  set(label: string, enabled: boolean, color?: number): void;
}

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

  private btnEnd!: Button;
  private btnInv!: Button;
  private btnSwap!: Button;
  private btnHelp!: Button;
  private btnGroup!: Button;
  private btnSpeed!: Button;
  private btnRetreat!: Button;
  private btnOptions!: Button;
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
  private logNewBg!: Phaser.GameObjects.Rectangle;

  // karta postaci / ekwipunek
  private sheet!: Phaser.GameObjects.Container;
  private sheetFooter: PixelText | null = null;

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
    this.sheetFooter = null;
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

    // ---- prawy górny: przyciski (2 kolumny) + cele zlecenia
    const bx = RCOL_X, bx2 = RCOL_X + BTN_W + 4, row = (i: number): number => M + (BTN_H + 2) * i;
    this.btnEnd = this.button(bx, row(0), BTN_W, '', () => this.hud.command({ kind: 'endTurn' }));
    this.btnInv = this.button(bx2, row(0), BTN_W, '', () => this.toggleSheet());
    this.btnSwap = this.button(bx, row(1), BTN_W, '', () => this.hud.command({ kind: 'swapWeapons' }));
    this.btnHelp = this.button(bx2, row(1), BTN_W, '', () => this.hud.toggleHelp());
    this.btnGroup = this.button(bx, row(2), BTN_W, '', () => this.hud.command({ kind: 'toggleGroup' }));
    this.btnSpeed = this.button(bx2, row(2), BTN_W, '', () => this.hud.command({ kind: 'cycleSpeed' }));
    this.btnRetreat = this.button(bx, row(3), BTN_W, '', () => this.hud.command({ kind: 'retreat' }));
    // Opcje w trakcie misji (menu misji w Oldgame/src/mission/hud.js)
    this.btnOptions = this.button(bx2, row(3), BTN_W, '', () => !modalOpen(this) && void openOptions(this));
    this.objLayer = this.add.container(RCOL_X, OBJ_Y);
    this.actionLayer = this.add.container(0, 0);

    // ---- lewy dół: opis pod kursorem
    this.hoverBg = this.panelRect(M, BASE_H - M - 12, 10, 12).setVisible(false);
    this.hoverText = this.text(M + 3, BASE_H - M - 11, '').setVisible(false);

    this.createLog();
    this.sheet = this.add.container(M, SHEET_Y).setVisible(false);

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

    // lekkie migotanie CRT
    this.tweens.add({ targets: [this.partyLayer, this.logPanel], alpha: { from: 1, to: 0.93 }, duration: 90, yoyo: true, repeat: -1, repeatDelay: 2300 });

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
        if (this.hud.inventoryOpen) this.drawSheet();
        break;
      case 'turn':
        this.drawTurn();
        this.drawParty();
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
  private text(x: number, y: number, s: string, color: number = C.green, size = 8): PixelText {
    return pixelText(this, x, y, s, { color, bold: size >= 11 });
  }

  private recolor(t: PixelText, color: number, _glow = true): PixelText {
    return t.setColor(color);
  }

  /** Tło panelu, które połyka kliknięcia (żeby nie przechodziły do WorldScene). */
  private panelRect(x: number, y: number, w: number, h: number, stroke: number = C.greenDim): Phaser.GameObjects.Rectangle {
    return this.add.rectangle(x, y, w, h, C.bg, 0.88).setOrigin(0).setStrokeStyle(1, stroke).setInteractive();
  }

  private scanlines(w: number, h: number): Phaser.GameObjects.Graphics {
    const g = this.add.graphics();
    g.fillStyle(0x000000, 0.3);
    for (let y = 1; y < h; y += 2) g.fillRect(0, y, w, 1);
    return g;
  }

  private bar(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number, ratio: number, color: number, dim: number): void {
    g.fillStyle(dim, 1).fillRect(x, y, w, h);
    g.fillStyle(color, 1).fillRect(x, y, Math.round(w * Math.max(0, Math.min(1, ratio))), h);
  }

  private button(x: number, y: number, w: number, label: string, onClick: () => void): Button {
    const bg = this.add.rectangle(x, y, w, BTN_H, C.bg, 0.92).setOrigin(0).setStrokeStyle(1, C.green).setInteractive({ useHandCursor: true });
    const text = this.text(x + w / 2, y + 2, label).setOrigin(0.5, 0);
    const b: Button = {
      bg, text, enabled: true, hovered: false, color: C.green,
      set: (l, enabled, color = C.green) => {
        b.enabled = enabled;
        b.color = color;
        // nawiasy "[ ... ]" zastępuje ramka przycisku - czcionka 6x8 potrzebuje tego miejsca na napis
        text.setText(l.replace(/^\[\s*|\s*\]$/g, ''));
        const filled = b.hovered && enabled;
        const dim = color === C.amber ? C.amberDim : color === C.red ? C.redDim : C.greenDim;
        bg.setStrokeStyle(1, enabled ? color : dim).setFillStyle(filled ? color : C.bg, filled ? 1 : 0.92);
        this.recolor(text, filled ? C.bg : enabled ? color : dim, !filled);
      },
    };
    bg.on('pointerover', () => {
      b.hovered = true;
      b.set(text.text, b.enabled, b.color);
    });
    bg.on('pointerout', () => {
      b.hovered = false;
      b.set(text.text, b.enabled, b.color);
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
      const y = i * (PARTY_H + 3);
      const isCurrent = ch === hud.active;
      const isActive = isCurrent && hud.phase !== TurnPhase.ENEMY_TURN && ch.hp > 0;
      const stroke = isActive ? C.amber : C.greenDim;
      const bg = this.panelRect(0, y, PARTY_W, PARTY_H, stroke);
      bg.on('pointerdown', () => this.hud.command({ kind: 'selectMember', index: i }));
      const g = this.add.graphics();

      // "portret": monogram w ramce w kolorze stanu
      const tone = HP_TONE[hpTone(ch)];
      g.lineStyle(1, tone, 1).strokeRect(3, y + 3, 16, 16);
      g.fillStyle(tone, 0.18).fillRect(4, y + 4, 14, 14);
      const mono = this.add.image(4, y + 4, portraitKey(this, ch, 14 * ZOOM)).setOrigin(0).setDisplaySize(14, 14);

      const name = this.text(23, y + 2, cut(ch.name, 18), C.white);
      const sub = this.text(23, y + 10, cut(classLabel(ch), 22), C.grey);

      // PW
      const hpLabel = this.text(3, y + 21, 'PW', C.red);
      this.bar(g, 17, y + 23, 68, 5, hpRatio(ch), tone, C.redDim);
      const st = stateLabel(ch);
      const hpVal = this.text(88, y + 21, st || `${Math.max(0, ch.hp)}/${ch.maxHp}${ch.tempHp ? '+' + ch.tempHp : ''}`, st ? C.red : tone);

      // AP (pipsy)
      const apColor = hud.ap <= 1 ? C.amber : C.green;
      const apDim = hud.ap <= 1 ? C.amberDim : C.greenDim;
      const apLabel = this.text(3, y + 30, 'AP', apColor);
      for (let k = 0; k < hud.maxAp; k++) {
        g.fillStyle(isCurrent && k < hud.ap ? apColor : apDim, 1).fillRect(17 + k * 6, y + 32, 4, 5);
      }
      const apVal = this.text(17 + hud.maxAp * 6 + 2, y + 30, isCurrent && hud.inCombat ? `${hud.ap}/${hud.maxAp}` : '', apColor);

      L.add([bg, g, mono, name, sub, hpLabel, hpVal, apLabel, apVal]);

      // stany (chipy) pod kartą
      let cx = 0;
      for (const chip of conditionChips(ch).slice(0, 5)) {
        const col = chip.bad ? C.red : C.amber;
        const t = this.text(cx + 2, y + PARTY_H + 1, chip.label, col);
        const r = this.add.rectangle(cx, y + PARTY_H, t.width + 4, LH, C.bg, 0.9).setOrigin(0).setStrokeStyle(1, col).setInteractive();
        r.on('pointerover', () => this.hud.setHover(`${chip.name}${chip.value > 1 ? ' ' + chip.value : ''}: ${chip.desc}`));
        r.on('pointerout', () => this.hud.setHover(null));
        L.add([r, t]);
        cx += t.width + 6;
      }
      L.add(this.scanlines(PARTY_W, PARTY_H).setY(y));
    });
  }

  // ================================================================== runda + wrogowie (port H.initBar)

  private drawTurn(): void {
    const hud = this.hud;
    const enemy = hud.phase === TurnPhase.ENEMY_TURN;
    const name = hud.active?.name.toUpperCase() ?? '—';
    const cur = hud.initiative.find((e) => e.current);
    if (!hud.inCombat) this.roundText.setText(cut(`EKSPLORACJA · LIDER: ${name}`, 36));
    else this.roundText.setText(cut(`RUNDA ${hud.round} · ${enemy ? `TURA: ${(cur?.ch.name ?? 'WRÓG').toUpperCase()}` : `TURA: ${name}`}`, 36));
    this.recolor(this.roundText, enemy ? C.red : hud.inCombat ? C.amber : C.green);

    const locked = !hud.canAct;
    const endLabel = enemy ? '[TURA WROGA]' : hud.inCombat ? '[KONIEC TURY]' : '[EKSPLORACJA]';
    this.btnEnd.set(endLabel, !locked && hud.inCombat, hud.ap <= 1 ? C.amber : C.green);
    this.btnInv.set(hud.inventoryOpen ? '[ZAMKNIJ  I]' : '[EKWIPUNEK I]', true);
    this.btnSwap.set('[ZMIEŃ BROŃ X]', !locked && !!hud.active?.equipment.weapon2);
    this.btnHelp.set('[STEROWANIE H]', true);
    this.btnGroup.set(hud.groupMove ? '[RUCH: DRUŻ. G]' : '[RUCH: SOLO G]', !hud.inCombat, C.green);
    this.btnSpeed.set(hud.speed >= 4 ? '[x4 BEZ KOŚCI F]' : `[TEMPO x${hud.speed} F]`, true);
    this.btnRetreat.set('[ ODWRÓT ]', !locked || (hud.inCombat && !enemy && !hud.busy), C.red);
    this.btnOptions.set('[ OPCJE ]', true);
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
    const stroke = e.current ? C.amber : enemy ? C.redDim : C.greenDim;
    const bg = this.panelRect(x, y, INIT_W, INIT_H, stroke);
    if (e.current) bg.setStrokeStyle(2, C.amber);
    const g = this.add.graphics();
    const col = e.done ? C.grey : enemy ? C.red : C.green;
    const nm = this.text(x + 2, y, cut(e.ch.name, 5), col);
    const ini = this.text(x + INIT_W - 2, y + 8, String(e.init), C.grey, 7).setOrigin(1, 0);
    this.bar(g, x + 2, y + INIT_H - 4, INIT_W - 4, 2, hpRatio(e.ch), HP_TONE[hpTone(e.ch)], enemy ? C.redDim : C.greenDim);
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
    const title = this.text(3, 1, cut(this.hud.objectiveTitle.toUpperCase() || 'ZLECENIE', 30), C.amber);
    items.push(title);
    let y = LH + 3;
    for (const r of rows) {
      const box = r.go ? '►' : r.done ? '☑' : '☐';
      const col = r.go ? C.amber : r.done ? C.green : r.dim ? C.grey : C.white;
      const t = this.text(4, y, `${box} ${r.text}`, col, 7).setWordWrapWidth(RCOL_W - 8);
      if (r.done && !r.go) t.setAlpha(0.75);
      items.push(t);
      y += Math.max(LH, Math.ceil(t.height)) + 1;
      if (r.go) this.tweens.add({ targets: t, alpha: { from: 1, to: 0.45 }, duration: 500, yoyo: true, repeat: -1 });
    }
    y += 1;
    const bg = this.panelRect(0, 0, RCOL_W, y, C.greenDim);
    const line = this.add.graphics().lineStyle(1, C.greenDim, 1).lineBetween(2, LH + 1.5, RCOL_W - 2, LH + 1.5);
    L.add([bg, line, ...items, this.scanlines(RCOL_W, y)]);
  }

  // ================================================================== pasek akcji walki (port C.refreshBar / H.abBtn)

  private drawActions(): void {
    const L = this.actionLayer;
    L.removeAll(true);
    const list = this.hud.actions;
    if (!list.length) return;
    const rows = Math.ceil(list.length / AB_COLS);
    const h = 12 + rows * (AB_BH + 1) + 2;
    const y0 = BASE_H - M - 14 - h;
    const bg = this.panelRect(AB_X, y0, AB_W, h, C.amberDim);
    const head = this.text(AB_X + 3, y0 + 1, cut((this.hud.actionsHead ?? '').toUpperCase(), 22), C.amber);
    const pipsX = AB_X + AB_W - 4;
    const g = this.add.graphics();
    for (let k = 0; k < this.hud.maxAp; k++) {
      g.fillStyle(k < this.hud.ap ? C.amber : C.amberDim, 1).fillRect(pipsX - (this.hud.maxAp - k) * 6, y0 + 3, 4, 5);
    }
    L.add([bg, head, g]);
    list.forEach((b, i) => {
      const x = AB_X + 2 + (i % AB_COLS) * AB_BW;
      const y = y0 + 12 + Math.floor(i / AB_COLS) * (AB_BH + 1);
      L.add(this.actionButton(x, y, AB_BW - 2, b, i < 9 ? String(i + 1) : ''));
    });
  }

  private actionButton(x: number, y: number, w: number, b: ActionButton, key: string): Phaser.GameObjects.GameObject[] {
    const on = b.enabled && this.hud.canAct;
    const col = b.active ? C.amber : on ? C.green : C.greyDim;
    const r = this.add.rectangle(x, y, w, AB_BH, b.active ? C.amberDim : C.bg, 0.95).setOrigin(0).setStrokeStyle(1, col).setInteractive({ useHandCursor: on });
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
      if (on) r.setFillStyle(col, 0.25);
      this.hud.setHover(b.tip ?? b.label);
    });
    r.on('pointerout', () => {
      r.setFillStyle(b.active ? C.amberDim : C.bg, 0.95);
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
    const pbg = this.add.rectangle(0, 0, pw, ph, 0x0d0a09, 0.94).setOrigin(0.5, 0).setStrokeStyle(1, col);
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
      ['KLAWISZE', '1-9 przyciski akcji (w eksploracji: wybór najemnika), Spacja = koniec tury, Esc / PPM = anuluj, Tab = następny najemnik, I = ekwipunek, X = zmiana broni, F = tempo x1/x2/x4, G = ruch drużyny/solo, H = ta pomoc.'],
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
    box.add([bg, ...items, this.scanlines(W, y + 4)]);
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

  // ================================================================== dziennik (port H.log)

  private createLog(): void {
    const x = BASE_W - M - LOG_W;
    const y = BASE_H - M - LOG_H;
    this.logPanel = this.add.container(x, y);
    this.logBg = this.panelRect(x, y, LOG_W, LOG_H);
    // panelRect jest w scenie (do getBounds w wheel) - wkładamy go jako pierwszy element, ale z pozycją względną
    this.logBg.setPosition(0, 0);

    const head = this.text(3, 1, 'DZIENNIK', C.amber);
    const line = this.add.graphics().lineStyle(1, C.greenDim, 1).lineBetween(2, 11.5, LOG_W - 2, 11.5);
    this.logColBtn = this.text(LOG_W - 3, 1, '[-]', C.green).setOrigin(1, 0).setInteractive({ useHandCursor: true });
    this.logColBtn.on('pointerdown', () => {
      SoundManager.sfx('click');
      this.logCollapsed = !this.logCollapsed;
      this.drawLog();
    });

    for (let i = 0; i < LOG_LINES; i++) this.logLineTexts.push(this.text(4, 13 + i * LH, '', C.grey));
    this.logMeasure = this.text(0, 0, '', C.grey).setWordWrapWidth(LOG_W - 14).setVisible(false);
    this.logScrollBar = this.add.graphics();

    // ciemny tekst na bursztynie: bez obrysu (jasne tło samo daje kontrast)
    this.logNewBg = this.add.rectangle(LOG_W / 2, LOG_H - 12, 10, 10, C.amber, 1).setOrigin(0.5, 0).setVisible(false);
    this.logNewBtn = this.text(LOG_W / 2, LOG_H - 11, '', C.bg)
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

    this.logPanel.add([this.logBg, head, line, this.logColBtn, ...this.logLineTexts, this.logScrollBar, this.scanlines(LOG_W, LOG_H), this.logNewBg, this.logNewBtn]);
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

    const maxScroll = Math.max(0, all.length - LOG_LINES);
    this.logScroll = Math.max(0, Math.min(maxScroll, this.logScroll));
    if (this.logScroll === 0) this.logUnseen = 0;

    // zwinięty dziennik = sam nagłówek
    const h = this.logCollapsed ? 12 : LOG_H;
    this.logBg.setSize(LOG_W, h);
    this.logBg.input?.hitArea.setSize(LOG_W, h);
    this.logPanel.setY(BASE_H - M - h);
    this.logColBtn.setText(this.logCollapsed ? '[+]' : '[-]');

    const start = all.length - LOG_LINES - this.logScroll;
    this.logLineTexts.forEach((t, i) => {
      const ln = all[start + i];
      t.setVisible(!this.logCollapsed && !!ln);
      if (!ln) return;
      t.setText(ln.text);
      this.recolor(t, TONE[ln.tone], ln.tone !== 'dim');
    });

    // pasek przewijania
    const g = this.logScrollBar.clear();
    if (!this.logCollapsed && all.length > LOG_LINES) {
      const trackY = 13, trackH = LOG_LINES * LH;
      const thumbH = Math.max(4, Math.round((trackH * LOG_LINES) / all.length));
      const pos = maxScroll ? 1 - this.logScroll / maxScroll : 1;
      g.fillStyle(C.greenDim, 1).fillRect(LOG_W - 5, trackY, 2, trackH);
      g.fillStyle(C.green, 1).fillRect(LOG_W - 5, trackY + Math.round((trackH - thumbH) * pos), 2, thumbH);
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
    this.logScroll += delta;
    this.drawLog();
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
    const close = this.text(SHEET_W - 3, y, '[X]', C.green).setOrigin(1, 0).setInteractive({ useHandCursor: true });
    close.on('pointerdown', () => {
      SoundManager.sfx('click');
      this.hud.toggleInventory(false);
    });
    items.push(this.text(3, y, cut(ch.name, 22), C.white), close);
    y += LH;
    items.push(this.text(3, y, classLabel(ch), C.grey));
    y += LH + 2;

    // statystyki 3x2
    statPairs(ch).forEach(([k, v], i) => {
      const cx = 3 + (i % 3) * 61, cy = y + Math.floor(i / 3) * LH;
      items.push(this.text(cx, cy, k, C.grey), this.text(cx + 30, cy, v, C.green));
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
      const col = ab.off ? C.grey : C.green;
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
    S.add([solid, bg, ...items, this.scanlines(SHEET_W, y)]);
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
    const bg = this.add.rectangle(0, 0, t.width + 16, t.height + 6, 0x050a06, 0.75).setStrokeStyle(1, color);
    // baner bez skalowania (skala != 1 rozjechałaby piksele czcionki z siatką) - tylko wjazd z góry i zanik
    const box = this.add.container(Math.round(BASE_W / 2), Math.round(BASE_H * 0.36) - 6, [bg, t]).setAlpha(0);
    this.banner = box;
    this.tweens.add({ targets: box, y: Math.round(BASE_H * 0.36), alpha: 1, duration: 140, ease: 'Quad.easeOut', onUpdate: () => (box.y = Math.round(box.y)) });
    this.tweens.add({ targets: box, alpha: 0, delay: 1300, duration: 400, onComplete: () => box.destroy() });
  }
}
