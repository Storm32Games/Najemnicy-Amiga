import Phaser from 'phaser';
import { type SfxName, SoundManager } from '../audio/SoundManager';
import { campaign } from '../core/campaign/session';
import type { Contract } from '../core/campaign/state';
import type { EnemyId } from '../core/data/ids';
import type { AbilityDef, AbilityId, ClassId, EnemyLook, SkillId } from '../core/data/types';
import { GAMEOVER_LINES } from '../core/data/story';
import { SKILLS } from '../core/data/rules';
import { type ActionButton, type HudCommand, type InitEntry, HudState } from '../core/HudState';
import { usesLeft } from '../core/rules/abilities';
import { createCharacter } from '../core/rules/character';
import { useConsumable } from '../core/rules/consumables';
import { fmtMod, hitChances } from '../core/rules/dice';
import { swapWeapons } from '../core/rules/equipment';
import { abilityDef, conditionDef, enemyDef, itemDef } from '../core/rules/lookup';
import { getStat, getWeapon, hasCondition, normWeapon } from '../core/rules/stats';
import type { CheckResult } from '../core/rules/dice';
import type { ActionResult, Character, GridPos } from '../core/rules/types';
import { aiStep } from '../core/tactical/ai';
import { type ActionOutcome, type Actor, type ActorState, type CombatSignal, type TurnInfo, Combat } from '../core/tactical/combat';
import { CellKind, type SearchResult, UNREACHABLE, cheb, strideActions } from '../core/tactical/grid';
import type { Biome, MapProp, PropType, TacticalMap } from '../core/tactical/mapgen';
import { CRATE_SKILLS, type MissionContract, type MissionFind, type MissionResult, type MissionSignal, type MissionThing, Mission } from '../core/tactical/mission';
import { TurnPhase } from '../core/TurnManager';
import { MAX_ACTION_POINTS } from '../core/TurnState';
import {
  ArtBook, BIOME_STYLE, type DecalType, FLOOR_SPILL, paintAO, paintBlend, paintBlobShadow, paintBlock, paintCursor, paintDecal, paintEdge, paintFlames,
  paintExtractPost, paintFloor, paintGlow, paintLootCrate, paintLootCrateOpen, paintObjective, paintPathDot, paintProp, paintSparkle, paintText,
  paintVignette, paintWall,
} from './iso/IsoArt';
import { PixelCanvas, hash2, rng } from './iso/Pixel';
import { enemySheet, enemyUnitLook, ensureUnit, isCreatureLook, unitLookOf } from './iso/UnitLooks';
import { BASE_H, BASE_W, SX0, SY0, ZOOM, label } from './ui/Kit';
import { LOOK_RAIDER, LOOK_SOLDIER, UNIT_FH, UNIT_FOOT_X, UNIT_FOOT_Y, UNIT_FW, type UnitLook, paintUnitSheet } from './iso/UnitArt';

// Pełna walka PF2e z src/core/tactical (Mission + Combat + AI): drużyna 3 najemników, grupy wrogów,
// wykrywanie w eksploracji, inicjatywa, 3 akcje na turę, PWA, flankowanie, osłona, dołączanie grup.
// Logika żyje w src/core; ta scena tylko animuje sygnały (combat.on / mission.on) i zbiera kliknięcia.

// ------------------------------------------------------------------ rzut izometryczny (tylko warstwa renderowania)

const TILE_W = 32;
const TILE_H = 16;
/** Górny wierzchołek rombu pola (gx, gy) w świecie. */
const isoX = (gx: number, gy: number): number => (gx - gy) * (TILE_W / 2);
const isoY = (gx: number, gy: number): number => (gx + gy) * (TILE_H / 2);
/** Środek pola - tu stoją stopy postaci. */
const tileCenter = (p: GridPos): { x: number; y: number } => ({ x: isoX(p.gx, p.gy), y: isoY(p.gx, p.gy) + TILE_H / 2 });
/** Odwrotność rzutu: punkt świata -> pole siatki. */
const worldToGrid = (wx: number, wy: number): GridPos => {
  const a = wx / (TILE_W / 2), b = wy / (TILE_H / 2);
  return { gx: Math.floor((b + a) / 2), gy: Math.floor((b - a) / 2) };
};

// ------------------------------------------------------------------ warstwy głębi

const D_EDGE = 0;
const D_GROUND = 1;
const D_DECAL = 2;
const D_AO = 3;
const D_GROUND_GLOW = 4;
const D_CURSOR = 5;
const D_PATH = 6;
const D_UNIT_SHADOW = 7;
/** Obiekty sortowane po gx+gy: D_OBJ + suma * 4 + warstwa. */
const D_OBJ = 10;
const L_PROP = 1;
const L_UNIT = 2;
const L_FX = 3;
const D_TEXT = 9000;
const D_SCREEN = 9500;
const objDepth = (gx: number, gy: number, layer: number): number => D_OBJ + (gx + gy) * 4 + layer;

// ------------------------------------------------------------------ rozgrywka

const STEP_DURATION = 130;
const ATTACK_SFX: readonly SfxName[] = ['shot_pistol', 'shot_rifle', 'shot_shotgun', 'shot_smg', 'shot_laser', 'melee', 'explosion'];
const isAttackSfx = (s: string): s is SfxName => (ATTACK_SFX as readonly string[]).includes(s);

const TINT_VISIBLE = 0xffffff;
const COLOR_OK = 0x9ad84a;
const COLOR_FAR = 0xd84a3a;
const COLOR_HOSTILE = 0xff5040;

type Facing = 'f' | 'b';
type CellState = 0 | 1 | 2; // nieodkryte / zapamiętane / widoczne

interface CellView {
  /** Wszystko, co ma przyciemnienie mgły (podłoga, kalkomanie, rekwizyty). */
  imgs: Phaser.GameObjects.Image[];
  state: CellState;
  reveal: number;
}

interface TallView {
  img: Phaser.GameObjects.Image;
  gx: number;
  gy: number;
  /** Ile pól "przed" obiektem może on zasłonić. */
  reach: number;
  fade: number;
}

interface LightView {
  img: Phaser.GameObjects.Image;
  cell: number;
  base: number;
  kind: 'steady' | 'flicker' | 'pulse' | 'blink';
  phase: number;
}

interface Unit {
  sprite: Phaser.GameObjects.Sprite;
  shadow: Phaser.GameObjects.Image;
  /** Pozycja na ekranie (nadąża za actor.gx/gy w trakcie animacji). */
  pos: GridPos;
  facing: Facing;
  name: string;
  actor: Actor;
}

type Signal = CombatSignal | MissionSignal;

/** Tryb celowania w turze najemnika (port t.mode ze starego combat.js). null = Marsz / atak klikiem. */
type Mode = { type: 'stride' } | { type: 'step' } | { type: 'strike' } | { type: 'ability'; id: AbilityId } | { type: 'item'; uid: string };

const BIOME_MUSIC: Record<Biome, 'ruins' | 'wastes'> = { ruins: 'ruins', wastes: 'wastes', industrial: 'ruins', bunker: 'ruins' };
const SPEEDS = [1, 2, 4] as const;
/** Kolory zasięgu ruchu wg kosztu w akcjach (niebieski / żółty / pomarańczowy) i Kroku (zielony). */
const MOVE_COL: Record<string, [number, number, number]> = {
  1: [0x468cff, 0.3, 0x8cbeff], 2: [0xf0c832, 0.26, 0xffe15a], 3: [0xf07828, 0.24, 0xff9646], s: [0x46c88c, 0.32, 0x78ffbe],
};
/** Kontury postaci (port OL). */
const OL = { foe: 0xff3b2b, ally: 0x4dff88, hover: 0xffe95a, blast: 0xff9a1a, blastAlly: 0xffe95a, off: 0x8c8c8c } as const;
const C_CRIT = 0xffe060;
const C_COND = 0xe0a0ff;
const C_LOOT = 0xffd040;
const C_COVER = 0x7fb8ff;

declare global {
  interface Window {
    __mission?: unknown;
  }
}

const COLOR_ALLY = 0xe0b040;

/** Wygląd drużyny demonstracyjnej wg klasy (w kampanii kolory pochodzą z postaci: unitLookOf). */
const DEMO_LOOKS: Partial<Record<ClassId, UnitLook>> = {
  soldier: LOOK_SOLDIER,
  scout: { ...LOOK_SOLDIER, cloth: 0x6a5a3a, pants: 0x3a3a30, accent: 0x8aa070, hair: 0x6a4424, head: 'hood', pack: 0x5a4a30 },
  medic: { ...LOOK_SOLDIER, cloth: 0xb0ac9c, pants: 0x5a5a52, accent: 0xc83a2a, hair: 0x2a1a10, head: 'hood', pack: 0x8a2a20 },
};
const LOOK_CAPTIVE: UnitLook = { ...LOOK_SOLDIER, skin: 0xc9a27c, cloth: 0x7a6a50, pants: 0x4a4038, accent: 0xc0a030, hair: 0x4a3a2a, head: 'hood', weapon: 'pipe', pack: 0x5a4a3a };
const LOOK_GUNNER: UnitLook = { ...LOOK_RAIDER, cloth: 0x4a3a2e, accent: 0x8a8a7a, head: 'hood', weapon: 'rifle' };

/** Drużyna i zlecenie demonstracyjne (tylko przy starcie sceny bez kampanii: ?scene=WorldScene). */
const PARTY: readonly { name: string; acc: string; classId: ClassId }[] = [
  { name: 'Kruk', acc: 'Kruka', classId: 'soldier' },
  { name: 'Sowa', acc: 'Sowę', classId: 'scout' },
  { name: 'Igła', acc: 'Igłę', classId: 'medic' },
];
const ENEMIES = ['raider_thug', 'raider_gunner', 'raider_thug', 'raider_thug', 'raider_gunner'] as EnemyId[];

export interface WorldSceneData {
  contract?: Contract;
}

export class WorldScene extends Phaser.Scene {
  /** Zlecenie z tablicy (null = tryb demonstracyjny). */
  private job: Contract | null = null;
  private map!: TacticalMap;
  private biome: Biome = 'ruins';
  private art!: ArtBook;
  /** Misja z src/core/tactical: drużyna, wrogowie, mgła, wykrywanie; w środku walka (Combat). */
  private mission!: Mission;
  /** Stan HUD-u (src/core) - współdzielony z UIScene. */
  private hud!: HudState;

  private cells: CellView[] = [];
  private tall: TallView[] = [];
  private glows: LightView[] = [];
  private revealing = new Set<number>();
  private sparkles = new Map<number, Phaser.GameObjects.Sprite>();

  private units = new Map<Actor, Unit>();
  /** Postać śledzona przez kamerę (i odsłaniana z wysokich obiektów). */
  private focus!: Unit;
  private cursor!: Phaser.GameObjects.Image;
  private pathDots: Phaser.GameObjects.Image[] = [];
  private costLabel: Phaser.GameObjects.Image | null = null;
  private dust: { img: Phaser.GameObjects.Image; vx: number; vy: number; ph: number }[] = [];
  private panKeys: Record<string, Phaser.Input.Keyboard.Key> = {};

  /** Sygnały z logiki czekające na animację (odtwarzane po kolei w flush()). */
  private signals: Signal[] = [];
  /** Tura najemnika sterowanego przez gracza (null = tura wroga / eksploracja). */
  private playerTurn: TurnInfo | null = null;
  private turnDone: (() => void) | null = null;
  private reachCache: { res: SearchResult; sp: number } | null = null;
  private combatRunning = false;
  private over = false;
  private seenGroups = new Set<number>();
  private following = false;
  private elapsed = 0;
  /** Tempo animacji (x1/x2/x4) = timeScale zegara i tweenów sceny. */
  private speed = 1;
  /** Przybliżenie kamery względem ZOOM (0.5 - 2). */
  private camZoom = 1;
  /** Warstwa ekranowa (winieta, nastrój, pył) - skalowana razem z przybliżeniem. */
  private overlay!: Phaser.GameObjects.Container;
  private rangeGfx!: Phaser.GameObjects.Graphics;
  private aimGfx!: Phaser.GameObjects.Graphics;
  private ringGfx!: Phaser.GameObjects.Graphics;
  private barGfx!: Phaser.GameObjects.Graphics;
  private barMarks = new Map<Actor, Phaser.GameObjects.Image>();
  private outline = new Map<Actor, number>();
  private hoverOutline = new Map<Actor, number>();
  private mode: Mode | null = null;
  private sub: 'items' | null = null;
  /** Podpowiedź trybu celowania (gdy kursor nic nie wskazuje). */
  private modeHint: string | null = null;
  private extractAsked = false;
  private crates = new Map<number, { img: Phaser.GameObjects.Image; sparkle: Phaser.GameObjects.Sprite | null }>();
  private objMarker: { imgs: Phaser.GameObjects.Image[]; light: LightView | null } | null = null;
  private extract: { caps: Phaser.GameObjects.Image[]; posts: Phaser.GameObjects.Image[]; beacon: Phaser.GameObjects.Container } | null = null;
  private floatStack = new Map<Actor, { t: number; n: number }>();
  private drag: { x: number; y: number; moved: boolean; btn: number } | null = null;
  /** Mnożnik prędkości pyłu (burza). */
  private stormy = 1;

  private get combat(): Combat {
    return this.mission.combat;
  }

  /** Aktor wybrany w HUD-zie (lider w eksploracji / postać w turze). */
  private get selected(): Actor | null {
    const ch = this.hud.active;
    return this.mission.pcs.find((p) => p.ch === ch) ?? null;
  }

  constructor() {
    super('WorldScene');
  }

  init(data: WorldSceneData): void {
    this.job = data?.contract ?? null;
  }

  create(): void {
    // Pola klasy nie są resetowane przy scene.restart(), więc ustawiamy je tutaj.
    this.elapsed = 0;
    this.cells = [];
    this.tall = [];
    this.glows = [];
    this.pathDots = [];
    this.costLabel = null;
    this.dust = [];
    this.revealing = new Set();
    this.sparkles = new Map();
    this.units = new Map();
    this.signals = [];
    this.playerTurn = null;
    this.turnDone = null;
    this.reachCache = null;
    this.combatRunning = false;
    this.over = false;
    this.seenGroups = new Set();
    this.barMarks = new Map();
    this.outline = new Map();
    this.hoverOutline = new Map();
    this.mode = null;
    this.sub = null;
    this.modeHint = null;
    this.extractAsked = false;
    this.crates = new Map();
    this.objMarker = null;
    this.extract = null;
    this.floatStack = new Map();
    this.drag = null;
    this.camZoom = 1;

    // Zlecenie z tablicy + drużyna kampanii; bez nich (start deweloperski) - zlecenie demonstracyjne.
    // Demo: ?biome=ruins|wastes|industrial|bunker&seed=abc
    let party: Character[];
    let contract: MissionContract;
    if (this.job && campaign.state.party.length) {
      party = campaign.state.party;
      contract = this.job;
      this.biome = this.job.biome;
    } else {
      this.job = null;
      const params = new URLSearchParams(window.location.search);
      const biomeParam = params.get('biome');
      this.biome = biomeParam === 'wastes' || biomeParam === 'industrial' || biomeParam === 'bunker' ? biomeParam : 'ruins';
      const seed = params.get('seed') ?? `demo-${Math.floor(Math.random() * 1e6)}`;
      party = PARTY.map((p) => {
        const ch = createCharacter({ name: p.name, classId: p.classId, ancestry: 'human' });
        ch.nameAcc = p.acc;
        return ch;
      });
      // demo: ?type=retrieve|rescue|hunt|eliminate
      const tp = params.get('type');
      const type = tp === 'retrieve' || tp === 'rescue' || tp === 'hunt' ? tp : 'eliminate';
      const titles = { eliminate: 'Oczyść teren', retrieve: 'Odzyskaj ładunek', rescue: 'Uwolnij jeńca', hunt: 'Polowanie' } as const;
      contract = { id: seed, title: titles[type], type, level: 1, biome: this.biome, enemies: ENEMIES, objective: { type, itemId: type === 'retrieve' ? 'radio_part' : null } };
    }
    this.mission = new Mission(contract, party);
    this.map = this.mission.map;
    this.mission.on((s) => this.signals.push(s));
    this.combat.on((s) => this.signals.push(s));

    this.hud = new HudState();
    this.hud.party = party;
    this.hud.maxAp = MAX_ACTION_POINTS;
    this.hud.ap = MAX_ACTION_POINTS;
    this.hud.setPhase(TurnPhase.EXPLORATION, 1);
    let sp = 1;
    try {
      sp = Number(window.localStorage.getItem('pir-speed')) || 1;
    } catch {
      sp = 1;
    }
    this.applySpeed((SPEEDS as readonly number[]).includes(sp) ? sp : 1);
    this.hud.setObjectives(contract.title ?? 'Zlecenie', this.mission.objectives().map((l) => ({ text: l.text, done: l.done, go: l.go, dim: l.tone === 'dim' })));

    this.art = new ArtBook(this);
    this.cameras.main.setBackgroundColor(BIOME_STYLE[this.biome].bg);
    this.createSharedTextures();
    this.buildWorld();
    for (const cell of this.cells) for (const img of cell.imgs) img.setVisible(false); // wszystko zaczyna w mgle
    this.createUnits();
    this.createOverlays();
    this.setupCamera();
    this.updateFogOfWar();

    this.input.mouse?.disableContextMenu();
    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      const d = this.drag;
      if (d && pointer.isDown && (d.btn === 2 || d.btn === 1)) {
        const dx = pointer.x - d.x, dy = pointer.y - d.y;
        if (Math.abs(dx) + Math.abs(dy) > 0) {
          d.moved = true;
          const cam = this.cameras.main;
          cam.stopFollow();
          this.following = false;
          cam.scrollX -= dx / cam.zoom;
          cam.scrollY -= dy / cam.zoom;
          d.x = pointer.x;
          d.y = pointer.y;
        }
        return;
      }
      this.refreshPathPreview();
    });
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (pointer.button === 2 || pointer.button === 1) {
        this.drag = { x: pointer.x, y: pointer.y, moved: false, btn: pointer.button };
        return;
      }
      if (!this.hud.canAct || pointer.button !== 0 || this.hud.prompt) return;
      const cell = this.pointerCell();
      if (!this.inMap(cell.gx, cell.gy) || this.cells[this.idx(cell.gx, cell.gy)].state === 0) return;
      if (this.hud.inCombat) void this.combatClick(cell);
      else void this.exploreClick(cell);
    });
    this.input.on('pointerup', (pointer: Phaser.Input.Pointer) => {
      const d = this.drag;
      this.drag = null;
      if (d && d.btn === 2 && !d.moved && pointer.button === 2) this.cancelMode();
    });
    this.input.on('wheel', (pointer: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => {
      if (this.overUi(pointer)) return;
      this.zoomBy(dy < 0 ? 1.15 : 1 / 1.15);
    });
    this.input.keyboard?.on('keydown', (e: KeyboardEvent) => {
      if (this.hud.prompt || this.hud.helpOpen) return;
      if (e.key === '+' || e.key === '=') this.zoomBy(1.25);
      else if (e.key === '-' || e.key === '_') this.zoomBy(1 / 1.25);
      else if (e.key === '0') this.setZoom(1);
    });

    // Polecenia z HUD-u (UIScene) -> logika
    const offCmd = this.hud.onCommand((c) => this.onHudCommand(c));
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      offCmd();
      this.hud.answer(null);
      this.finishPlayerTurn();
      if (import.meta.env.DEV) window.__mission = undefined;
      this.tweens.timeScale = 1;
      this.time.timeScale = 1;
      this.scene.stop('UIScene');
    });

    this.scene.launch('UIScene', { hud: this.hud });
    this.hud.pushLog(this.job ? `Zlecenie: ${this.job.title}. ${this.job.desc}` : 'Zlecenie: oczyść teren z szabrowników.', 'amber');
    this.hud.pushLog('Klikaj pola, by się poruszać; klik na skrzynię / cel = interakcja. Wrogowie czyhają w ciemności. [H] sterowanie.');
    this.updateFoes();
    this.refreshOverlay();
    try {
      SoundManager.music(BIOME_MUSIC[this.biome] ?? 'ruins');
      SoundManager.ambience(this.biome === 'bunker' ? 'ruins' : 'wind');
    } catch {
      // dźwięk opcjonalny
    }
    if (import.meta.env.DEV) this.devApi();
  }

  /** DEV: window.__mission (port Oldgame/src/scenes/mission.js:39-44, combat.js:592-597). */
  private devApi(): void {
    const self = this;
    window.__mission = {
      state: this.mission,
      scene: this,
      winNow: async () => {
        self.mission.finish('success');
        await self.flush();
      },
      loseNow: async () => {
        for (const p of self.mission.pcs) p.ch.conditions.dead = 1;
        self.combat.syncAll();
        self.mission.finish('fail');
        await self.flush();
      },
      autoTurn: () => self.autoTurn(),
      walkTo: (x: number, y: number) => self.exploreClick({ gx: x, gy: y }),
      get mode() {
        return self.mission.mode;
      },
    };
  }

  /** DEV: tura najemnika rozegrana przez AI. */
  private async autoTurn(): Promise<boolean> {
    const t = this.playerTurn;
    if (!t || !this.hud.canAct) return false;
    this.hud.setBusy(true);
    for (let g = 0; g < 10; g++) {
      if (!aiStep(this.combat, t.actor)) break;
      await this.flush();
      this.updateFogOfWar();
    }
    if (this.over) return true;
    this.finishPlayerTurn();
    return true;
  }

  private onHudCommand(c: HudCommand): void {
    if (this.over) return;
    switch (c.kind) {
      case 'endTurn':
        if (this.playerTurn && this.hud.canAct) this.finishPlayerTurn();
        else if (!this.hud.inCombat) {
          this.following = false;
          this.refollow();
        }
        break;
      case 'action':
        void this.onAction(c.id);
        break;
      case 'cancel':
        this.cancelMode();
        break;
      case 'retreat':
        void this.askRetreat();
        break;
      case 'zoom':
        this.zoomBy(c.f);
        break;
      case 'toggleGroup':
        this.hud.setGroupMove(!this.hud.groupMove);
        this.hud.pushLog(this.hud.groupMove ? 'Ruch: cała drużyna.' : 'Ruch: jeden najemnik.');
        this.refreshOverlay();
        this.refreshPathPreview();
        break;
      case 'cycleSpeed': {
        const i = (SPEEDS as readonly number[]).indexOf(this.speed);
        this.applySpeed(SPEEDS[(i + 1) % SPEEDS.length]);
        try {
          window.localStorage.setItem('pir-speed', String(this.speed));
        } catch {
          // brak pamięci przeglądarki
        }
        break;
      }
      case 'cycleMember': {
        if (this.hud.inCombat) {
          const a = this.combat.turn?.actor;
          const u = a && this.units.get(a);
          if (u) this.focusOn(u);
          break;
        }
        const ups = this.mission.pcs.filter((p) => p.state === 'up');
        const cur = this.selected;
        const next = ups[(ups.indexOf(cur as Actor) + 1) % ups.length];
        if (next) void this.selectMember(next);
        break;
      }
      case 'useItem':
        void this.playerUseItem(c.uid);
        break;
      case 'swapWeapons':
        void this.playerSwapWeapons();
        break;
      case 'selectMember': {
        const ch = this.hud.party[c.index];
        const a = this.mission.pcs.find((p) => p.ch === ch);
        if (a) void this.selectMember(a);
        break;
      }
    }
  }

  update(_time: number, delta: number): void {
    const dt = Math.min(delta, 50) / 1000;
    this.elapsed += dt;
    this.updateReveal(dt);
    this.updateCutaway(dt);
    this.updateLights();
    this.updateDust(dt);
    this.updateCameraPan(dt);
    this.updateMarkers();
    this.updateExtraction();
  }

  private applySpeed(s: number): void {
    this.speed = s;
    this.tweens.timeScale = s;
    this.time.timeScale = s;
    this.hud.setSpeed(s);
  }

  // ================================================================== budowa świata

  private createSharedTextures(): void {
    const plain = (key: string, pc: PixelCanvas) => this.art.get(key, () => ({ pc, ax: 0, ay: 0 }));
    plain('fx_shadow', paintBlobShadow());
    plain('fx_glow', paintGlow(96, 48));
    plain('fx_halo', paintGlow(20, 20));
    plain('fx_cursor', paintCursor());
    plain('fx_dot', paintPathDot());
    const px = new PixelCanvas(2, 2);
    px.rect(0, 0, 2, 2, 0xffffff);
    plain('fx_px', px);
    const flames = paintFlames();
    this.art.sheet('fx_flames', flames.pc, flames.frames);
    const sparkle = paintSparkle();
    this.art.sheet('fx_sparkle', sparkle.pc, sparkle.frames);
    if (!this.anims.exists('flames')) {
      this.anims.create({ key: 'flames', frames: flames.frames.map((f) => ({ key: 'fx_flames', frame: f.name })), frameRate: 9, repeat: -1 });
      this.anims.create({
        key: 'sparkle',
        frames: [...sparkle.frames, ...sparkle.frames.slice().reverse()].map((f) => ({ key: 'fx_sparkle', frame: f.name })),
        frameRate: 10,
        repeat: -1,
        repeatDelay: 1400,
      });
    }
  }

  private idx(gx: number, gy: number): number {
    return gy * this.map.width + gx;
  }

  private inMap(gx: number, gy: number): boolean {
    return gx >= 0 && gy >= 0 && gx < this.map.width && gy < this.map.height;
  }

  /** Dodaje obraz zakotwiczony wierzchołkiem rombu w polu (gx, gy). */
  private place(gx: number, gy: number, key: string, ax: number, ay: number, depth: number, dx = 0, dy = 0): Phaser.GameObjects.Image {
    const img = this.add.image(isoX(gx, gy) - ax + dx, isoY(gx, gy) - ay + dy, key).setOrigin(0, 0).setDepth(depth);
    this.cells[this.idx(gx, gy)].imgs.push(img);
    return img;
  }

  private buildWorld(): void {
    const m = this.map;
    const W = m.width, H = m.height;
    const style = BIOME_STYLE[this.biome];
    for (let i = 0; i < W * H; i++) this.cells.push({ imgs: [], state: 0, reveal: 0 });

    // --- podłoga, skarpy na krawędziach, okluzja przy wysokich przeszkodach
    const high = (gx: number, gy: number) => this.inMap(gx, gy) && m.grid.kind(gx, gy) === CellKind.HIGH;
    for (let gy = 0; gy < H; gy++)
      for (let gx = 0; gx < W; gx++) {
        const type = m.floor[this.idx(gx, gy)];
        const h = Math.floor(hash2(gx, gy, m.seed) * 1000);
        const variant = type === 'metal' && h % 9 === 0 ? 3 : h % 3; // wariant 3 (pasy ostrzegawcze) rzadko
        const key = `floor_${type}_${variant}`;
        this.art.get(key, () => ({ pc: paintFloor(type, variant), ax: 16, ay: 0 }));
        this.place(gx, gy, key, 16, 0, D_GROUND);

        // przejścia terenu: miękki materiał sąsiada wchodzi na to pole
        const mine = FLOOR_SPILL[type] ?? 0;
        const spill = new Map<string, number>();
        ([[-1, 0, 1], [0, -1, 2], [1, 0, 4], [0, 1, 8]] as const).forEach(([dx, dy, bit]) => {
          if (!this.inMap(gx + dx, gy + dy)) return;
          const other = m.floor[this.idx(gx + dx, gy + dy)];
          if ((FLOOR_SPILL[other] ?? 0) > mine) spill.set(other, (spill.get(other) ?? 0) | bit);
        });
        [...spill.entries()]
          .sort((a, b) => (FLOOR_SPILL[a[0] as keyof typeof FLOOR_SPILL] ?? 0) - (FLOOR_SPILL[b[0] as keyof typeof FLOOR_SPILL] ?? 0))
          .forEach(([other, edges]) => {
            const bv = h % 2;
            const k = `blend_${other}_${edges}_${bv}`;
            this.art.get(k, () => ({ pc: paintBlend(other as typeof type, edges, bv * 13 + edges), ax: 16, ay: 0 }));
            this.place(gx, gy, k, 16, 0, D_GROUND);
          });

        if (gy === H - 1) {
          const k = `edge_l_${this.biome}`;
          this.art.get(k, () => ({ pc: paintEdge('l', this.biome), ax: 16, ay: 0 }));
          this.place(gx, gy, k, 16, 0, D_EDGE);
        }
        if (gx === W - 1) {
          const k = `edge_r_${this.biome}`;
          this.art.get(k, () => ({ pc: paintEdge('r', this.biome), ax: 16, ay: 0 }));
          this.place(gx, gy, k, 16, 0, D_EDGE);
        }

        if (!high(gx, gy)) {
          let mask = (high(gx - 1, gy) ? 1 : 0) | (high(gx, gy - 1) ? 2 : 0) | (high(gx + 1, gy) ? 4 : 0) | (high(gx, gy + 1) ? 8 : 0);
          if (!(mask & 3) && high(gx - 1, gy - 1)) mask |= 16;
          if (mask) {
            const k = `ao_${mask}`;
            this.art.get(k, () => ({ pc: paintAO(mask), ax: 16, ay: 0 }));
            this.place(gx, gy, k, 16, 0, D_AO);
          }
        }
        if (type === 'toxic') this.addLight(gx, gy, 0x6ad030, 0.5, 0.5, 0, 0.55, 'pulse', 0.6, D_GROUND_GLOW);
      }

    // --- kalkomanie: plamy, przypalenia, nawiany piasek - rozbijają powtarzalność siatki
    const R = rng(m.seed ^ 0x5eed);
    const decals: Record<Biome, DecalType[]> = {
      ruins: ['scorch', 'oil', 'stain', 'stain', 'moss', 'sand'],
      wastes: ['stain', 'stain', 'scorch', 'scorch', 'moss', 'stain', 'blood'],
      industrial: ['oil', 'oil', 'stain', 'scorch', 'moss'],
      bunker: ['oil', 'stain', 'stain', 'blood', 'moss'],
    };
    const nDecals = Math.round((W * H) / 11);
    for (let i = 0; i < nDecals; i++) {
      const gx = Math.floor(R() * W), gy = Math.floor(R() * H);
      if (m.grid.kind(gx, gy) === CellKind.HIGH) continue;
      const list = decals[this.biome];
      const type = list[Math.floor(R() * list.length)];
      const v = Math.floor(R() * 5);
      const k = `decal_${type}_${v}`;
      this.art.get(k, () => ({ pc: paintDecal(type, v * 97 + type.length), ax: 24, ay: 4 }));
      this.place(gx, gy, k, 24, 4, D_DECAL, Math.round((R() - 0.5) * 12), Math.round((R() - 0.5) * 6)).setFlipX(R() < 0.5);
    }

    // --- budynki (bloki pięter) i lite ściany bunkra
    const buildingAt = new Int16Array(W * H).fill(-1);
    m.buildings.forEach((b, bi) => {
      for (let y = b.gy; y < b.gy + b.d; y++) for (let x = b.gx; x < b.gx + b.w; x++) if (this.inMap(x, y)) buildingAt[this.idx(x, y)] = bi;
    });
    const sameB = (x: number, y: number, bi: number) => this.inMap(x, y) && buildingAt[this.idx(x, y)] === bi;
    m.buildings.forEach((b, bi) => {
      const color = style.facade[b.seed % style.facade.length];
      for (let y = b.gy; y < b.gy + b.d; y++)
        for (let x = b.gx; x < b.gx + b.w; x++) {
          if (!this.inMap(x, y)) continue;
          const open = (sameB(x, y + 1, bi) ? 0 : 1) | (sameB(x + 1, y, bi) ? 0 : 2) | (sameB(x - 1, y, bi) ? 0 : 4) | (sameB(x, y - 1, bi) ? 0 : 8);
          const seed = b.seed * 131 + x * 31 + y * 17;
          const k = `bld_${b.h}_${open}_${color.toString(16)}_${seed}`;
          const info = this.art.get(k, () => paintBlock('building', b.h, open, color, seed));
          this.addTall(x, y, this.place(x, y, k, info.ax, info.ay, objDepth(x, y, L_PROP)), info.ay);
        }
    });
    const solid = new Uint8Array(W * H);
    for (const s of m.solids) solid[this.idx(s.gx, s.gy)] = 1;
    const isSolid = (x: number, y: number) => !this.inMap(x, y) || solid[this.idx(x, y)] === 1;
    for (const s of m.solids) {
      const open = (isSolid(s.gx, s.gy + 1) ? 0 : 1) | (isSolid(s.gx + 1, s.gy) ? 0 : 2);
      const variant = Math.floor(hash2(s.gx, s.gy, 3) * 4);
      const k = `bunker_${open}_${variant}`;
      const info = this.art.get(k, () => paintBlock('bunker', 0, open, style.wall, variant * 977 + 5));
      const img = this.place(s.gx, s.gy, k, info.ax, info.ay, objDepth(s.gx, s.gy, L_PROP));
      if (open) this.addTall(s.gx, s.gy, img, info.ay);
    }

    // --- rekwizyty blokujące, dekoracje, drzwi
    const wallLike = new Set<PropType>(['wall', 'wall_broken', 'door']);
    const propAt = new Map<number, PropType>();
    for (const p of m.props) propAt.set(this.idx(p.gx, p.gy), p.type);
    for (const d of m.decor) propAt.set(this.idx(d.gx, d.gy), d.type);
    const isWall = (x: number, y: number) => this.inMap(x, y) && wallLike.has(propAt.get(this.idx(x, y)) ?? 'crate');

    const drawProp = (p: MapProp) => {
      const { gx, gy, type } = p;
      if (type === 'wall' || type === 'wall_broken') {
        const conn = (isWall(gx - 1, gy) ? 1 : 0) | (isWall(gx + 1, gy) ? 2 : 0) | (isWall(gx, gy - 1) ? 4 : 0) | (isWall(gx, gy + 1) ? 8 : 0);
        const broken = type === 'wall_broken';
        const v = p.seed % 3;
        const k = `wall_${this.biome}_${conn}_${broken ? 1 : 0}_${v}`;
        const info = this.art.get(k, () => paintWall(conn || (p.rot % 2 ? 12 : 3), broken, style.wall, this.biome, v * 71 + conn));
        const img = this.place(gx, gy, k, info.ax, info.ay, objDepth(gx, gy, L_PROP));
        if (!broken) this.addTall(gx, gy, img, info.ay);
        return;
      }
      const v = p.seed % (type === 'car' || type === 'scrap_pile' ? 7 : 3);
      const rot = type === 'door' ? (isWall(gx - 1, gy) || isWall(gx + 1, gy) ? 0 : 1) : p.rot;
      const k = `prop_${type}_${rot % 2}_${v}_${this.biome}`;
      const info = this.art.get(k, () => paintProp(type, rot, v * 1009 + 1, this.biome));
      const flat = type === 'skeleton';
      const img = this.place(gx, gy, k, info.ax, info.ay, flat ? D_DECAL : objDepth(gx, gy, L_PROP));
      if (info.ay > 34) this.addTall(gx, gy, img, info.ay);

      // światła i efekty rekwizytów
      switch (type) {
        case 'lamp':
          this.addLight(gx, gy, 0xffb050, 0.95, 0.5, 0, 0.7, 'steady', 1.25);
          this.addLight(gx, gy, 0xffd890, 0.86, 0.5, 37, 1, 'flicker', 0.5, objDepth(gx, gy, L_FX), 'fx_halo');
          break;
        case 'campfire': {
          this.addLight(gx, gy, 0xff7a30, 0.5, 0.5, 0, 0.85, 'flicker', 1.4);
          const { x, y } = tileCenter({ gx, gy });
          const fire = this.add.sprite(x, y + 1, 'fx_flames', 'f0').setOrigin(0.5, 1).setDepth(objDepth(gx, gy, L_FX)).setBlendMode(Phaser.BlendModes.ADD);
          fire.play({ key: 'flames', startFrame: Math.floor(hash2(gx, gy, 1) * 4) });
          this.cells[this.idx(gx, gy)].imgs.push(fire as unknown as Phaser.GameObjects.Image);
          break;
        }
        case 'terminal':
          this.addLight(gx, gy, 0x46f2c8, 0.5, 0.75, 0, 0.5, 'flicker', 0.55);
          break;
        case 'barrel_toxic':
          this.addLight(gx, gy, 0x7aff50, 0.5, 0.5, 0, 0.5, 'pulse', 0.5);
          break;
        case 'antenna':
          this.addLight(gx, gy, 0xff3020, 0.5, 0.5, 62, 1, 'blink', 0.35, objDepth(gx, gy, L_FX), 'fx_halo');
          break;
        default:
          break;
      }
    };
    for (const p of m.props) drawProp(p);
    for (const p of m.deco) drawProp(p);
    for (const d of m.decor) drawProp({ ...d, rot: 0, seed: d.gx * 7 + d.gy });

    // --- skrzynie z łupem, znaleziska, cel misji
    for (const c of m.crates) {
      const info = this.art.get('loot_crate', paintLootCrate);
      const img = this.place(c.gx, c.gy, info.key, info.ax, info.ay, objDepth(c.gx, c.gy, L_PROP));
      const sparkle = this.addSparkle(c.gx, c.gy, -12);
      this.crates.set(this.idx(c.gx, c.gy), { img, sparkle });
    }
    for (const f of this.mission.finds) if (f.found) this.addFindSparkle(f);
    // znacznik celu tylko dla "odzyskaj" (jeniec jest postacią - Oldgame/src/scenes/mission.js:210-221)
    if (m.objCell && this.mission.itemThing) {
      const { gx, gy } = m.objCell;
      const info = this.art.get('objective', paintObjective);
      const img = this.place(gx, gy, info.key, info.ax, info.ay, objDepth(gx, gy, L_PROP));
      this.addLight(gx, gy, 0x60ff80, 0.66, 0.4, 20, 1, 'blink', 0.3, objDepth(gx, gy, L_FX), 'fx_halo');
      const light = this.glows[this.glows.length - 1];
      const sparkle = this.addSparkle(gx, gy, -10);
      this.objMarker = { imgs: [img, sparkle as unknown as Phaser.GameObjects.Image], light };
    }
    this.buildExtraction();
  }

  /**
   * Strefa ewakuacji: cztery zielone słupki w rogach strefy wejścia; po wykonaniu celu nad strefą
   * pojawia się świetlna kolumna z migającym napisem "EWAKUACJA" (Oldgame/src/scenes/mission.js:107-130, 587-591).
   */
  private buildExtraction(): void {
    const e = this.map.entry;
    const post = this.art.get('extract_post', paintExtractPost);
    const posts: Phaser.GameObjects.Image[] = [];
    const caps: Phaser.GameObjects.Image[] = [];
    for (const [px, py] of [[e.x0, e.y0], [e.x1, e.y0], [e.x0, e.y1], [e.x1, e.y1]] as const) {
      // punkt słupka (ciągłe współrzędne siatki), lekko na zewnątrz rogu strefy
      const cx = px + 0.5 + (px === e.x0 ? -0.42 : 0.42);
      const cy = py + 0.5 + (py === e.y0 ? -0.42 : 0.42);
      const tx = cx - 0.5, ty = cy - 0.5;
      const depth = objDepth(Math.floor(cx), Math.floor(cy), L_PROP);
      posts.push(this.add.image(isoX(tx, ty) - post.ax, isoY(tx, ty) - post.ay, post.key).setOrigin(0, 0).setDepth(depth));
      const top = { x: isoX(cx, cy), y: isoY(cx, cy) - 19 };
      caps.push(this.add.image(top.x, top.y, 'fx_px').setScale(1.5).setTint(0x9dff8a).setDepth(depth + 0.5));
      caps.push(this.add.image(top.x, top.y, 'fx_halo').setBlendMode(Phaser.BlendModes.ADD).setTint(0x8fff7a).setAlpha(0.6).setScale(0.6).setDepth(depth + 0.5));
    }
    const cx = (e.x0 + e.x1) / 2 + 0.5, cy = (e.y0 + e.y1) / 2 + 0.5;
    const beacon = this.add.container(isoX(cx, cy), isoY(cx, cy)).setDepth(D_TEXT - 10).setVisible(false);
    const column = this.add.image(0, 0, 'fx_px').setOrigin(0.5, 1).setScale(2, 40).setTint(0x8fff7a).setAlpha(0.22).setBlendMode(Phaser.BlendModes.ADD);
    const key = 'txt_EWAKUACJA';
    if (!this.textures.exists(key)) this.art.get(key, () => ({ pc: paintText('EWAKUACJA'), ax: 0, ay: 0 }));
    const sign = this.add.container(0, -58);
    const txt = this.add.image(0, 0, key).setTint(0xb8ff9a);
    const box = this.add.rectangle(0, 0, txt.width + 4, txt.height + 2, 0x0b1a0c, 0.92).setStrokeStyle(1, 0x8fff7a);
    const arrow = this.add.triangle(0, Math.ceil(box.height / 2) + 1, -4, 0, 4, 0, 0, 5, 0x8fff7a).setOrigin(0.5, 0);
    sign.add([box, txt, arrow]);
    beacon.add([column, sign]);
    beacon.setData('sign', sign);
    this.extract = { caps, posts, beacon };
  }

  /** Pulsowanie słupków i kołysanie napisu ewakuacji po wykonaniu celu. */
  private updateExtraction(): void {
    const ex = this.extract;
    if (!ex) return;
    const done = this.mission.objectiveDone() && !this.over;
    const t = this.elapsed;
    ex.beacon.setVisible(done);
    if (done) {
      const sign = ex.beacon.getData('sign') as Phaser.GameObjects.Container;
      sign.y = -58 + Math.sin(t * 3) * 2;
      sign.setAlpha(Math.sin(t * 6) > -0.4 ? 1 : 0.35);
    }
    const k = done ? 0.6 + 0.4 * Math.sin(t * 5) : 0.55;
    for (let i = 1; i < ex.caps.length; i += 2) ex.caps[i].setAlpha(k);
    for (const p of ex.posts) p.setTint(done ? 0xb8ffb0 : 0xffffff);
  }

  private addTall(gx: number, gy: number, img: Phaser.GameObjects.Image, height: number): void {
    this.tall.push({ img, gx, gy, reach: Math.max(1.5, height / 8), fade: 1 });
  }

  /**
   * Poświata (mieszanie ADD). (u, v, z) = miejsce w polu, scale = rozmiar względem 96x48.
   * Domyślnie leży na ziemi pod obiektami; halo żarówek dostaje głębię obiektu.
   */
  private addLight(
    gx: number, gy: number, color: number, u: number, v: number, z: number, alpha: number,
    kind: LightView['kind'], scale: number, depth = D_GROUND_GLOW, key = 'fx_glow',
  ): void {
    const x = isoX(gx, gy) + (u - v) * 16;
    const y = isoY(gx, gy) + (u + v) * 8 - z;
    const img = this.add.image(x, y, key).setDepth(depth).setBlendMode(Phaser.BlendModes.ADD).setTint(color).setScale(scale).setAlpha(0);
    this.glows.push({ img, cell: this.idx(gx, gy), base: alpha, kind, phase: hash2(gx, gy, 77) * 10 });
  }

  private addSparkle(gx: number, gy: number, dz: number): Phaser.GameObjects.Sprite {
    const { x, y } = tileCenter({ gx, gy });
    const s = this.add.sprite(x, y + dz, 'fx_sparkle', 's0').setDepth(objDepth(gx, gy, L_FX)).setBlendMode(Phaser.BlendModes.ADD).setTint(0xfff0c0);
    s.play({ key: 'sparkle', delay: Math.floor(hash2(gx, gy, 9) * 1500) });
    this.cells[this.idx(gx, gy)].imgs.push(s as unknown as Phaser.GameObjects.Image);
    return s;
  }

  // ================================================================== postacie

  private createUnits(): void {
    const entry = this.map.entry.cells[5] ?? this.map.entry.cells[0];
    for (const a of this.mission.actors) {
      if (a.side === 'neutral') {
        // jeniec (Oldgame/src/scenes/mission.js:217): cywil w łachmanach, widoczny w zasięgu wzroku lub gdy idzie za drużyną
        const u = this.makeUnit('captive', LOOK_CAPTIVE, a);
        this.face(u, { gx: entry.gx - a.gx, gy: entry.gy - a.gy });
        this.idle(u);
        this.setUnitVisible(u, false);
        this.units.set(a, u);
        continue;
      }
      let key: string;
      let look: UnitLook;
      let sheet: (() => ReturnType<typeof paintUnitSheet>) | undefined;
      if (a.side === 'pc') {
        key = `pc_${a.ch.recruitId ?? a.ch.id}`;
        look = this.job ? unitLookOf(a.ch) : (DEMO_LOOKS[a.ch.classId as ClassId] ?? LOOK_SOLDIER);
      } else {
        const ranged = normWeapon(getWeapon(a.ch)).range > 0;
        const lk = a.ch.look as Partial<EnemyLook>;
        key = ranged ? 'en_gunner' : 'en_raider';
        look = ranged ? LOOK_GUNNER : LOOK_RAIDER;
        if (this.job && a.ch.templateId) {
          // wygląd z szablonu wroga (iso/UnitLooks: broń z ataku, maski, robot, Kostucha; bestie - własny gatunek)
          key = `en_${a.ch.templateId}`;
          const el = enemyUnitLook(a.ch.templateId, lk);
          if (isCreatureLook(el)) sheet = () => enemySheet(a.ch.templateId!, lk);
          else look = el;
        }
      }
      const u = this.makeUnit(key, look, a, sheet);
      if (a.side === 'enemy' && (a.ch.look as Partial<EnemyLook>).scale) u.sprite.setScale(Math.min(1.5, Math.max(0.8, (a.ch.look as Partial<EnemyLook>).scale ?? 1)));
      if (a.side === 'enemy') {
        this.face(u, { gx: entry.gx - a.gx, gy: entry.gy - a.gy });
        this.idle(u);
      }
      this.units.set(a, u);
    }
    this.focus = this.units.get(this.selected ?? this.mission.pcs[0])!;
  }

  private makeUnit(name: string, look: UnitLook, actor: Actor, build?: () => ReturnType<typeof paintUnitSheet>): Unit {
    // ensureUnit przemalowuje arkusz, gdy wygląd się zmienił (np. inna broń po wizycie u handlarza)
    const tex = ensureUnit(this, name, look, build);
    const pos = { gx: actor.gx, gy: actor.gy };
    const { x, y } = tileCenter(pos);
    const shadow = this.add.image(x, y, 'fx_shadow').setDepth(D_UNIT_SHADOW);
    const sprite = this.add
      .sprite(x, y, tex, 'f_idle0')
      .setOrigin(UNIT_FOOT_X / UNIT_FW, UNIT_FOOT_Y / UNIT_FH)
      .setDepth(objDepth(pos.gx, pos.gy, L_UNIT));
    const unit: Unit = { sprite, shadow, pos, facing: 'f', name, actor };
    // drobne przesunięcie fazy, żeby drużyna nie oddychała równo
    sprite.play({ key: `${name}_f_idle`, startFrame: Math.floor(hash2(pos.gx, pos.gy, 5) * 2) });
    return unit;
  }

  private unitOfCh(ch: Character): Unit | null {
    for (const u of this.units.values()) if (u.actor.ch === ch) return u;
    return null;
  }

  /** Spoczynek po akcji: stojący wracają do oddychania, powaleni zostają na ziemi. */
  private rest(u: Unit): void {
    if (u.actor.state === 'up') this.idle(u);
    else this.pose(u, 'hurt');
  }

  /** Kierunek ruchu siatki -> kierunek sprite'a (przód/tył + odbicie). */
  private face(u: Unit, d: GridPos): void {
    if (d.gx === 0 && d.gy === 0) return;
    const alongX = Math.abs(d.gx) >= Math.abs(d.gy);
    if (alongX) {
      u.facing = d.gx > 0 ? 'f' : 'b'; // +gx = SE (przodem), -gx = NW (tyłem, odbity)
      u.sprite.setFlipX(d.gx < 0);
    } else {
      u.facing = d.gy > 0 ? 'f' : 'b'; // +gy = SW (przodem, odbity), -gy = NE (tyłem)
      u.sprite.setFlipX(d.gy > 0);
    }
  }

  private idle(u: Unit): void {
    u.sprite.play(`${u.name}_${u.facing}_idle`, true);
  }

  private pose(u: Unit, frame: 'attack' | 'hurt'): void {
    u.sprite.stop();
    u.sprite.setFrame(`${u.facing}_${frame}`);
  }

  /** Krok o jedno pole z animacją chodu; głębia = większa z sum pól, by nie wejść "pod" ściany. */
  private stepUnit(u: Unit, to: GridPos): Promise<void> {
    const from = u.pos;
    this.face(u, { gx: to.gx - from.gx, gy: to.gy - from.gy });
    u.sprite.play(`${u.name}_${u.facing}_walk`, true);
    u.sprite.setDepth(Math.max(objDepth(from.gx, from.gy, L_UNIT), objDepth(to.gx, to.gy, L_UNIT)));
    u.pos = { ...to };
    if (u.sprite.visible && (u === this.focus || u.actor.side !== 'pc')) SoundManager.sfx('step', { vol: 0.35 });
    const { x, y } = tileCenter(to);
    return new Promise((resolve) =>
      this.tweens.add({
        targets: [u.sprite, u.shadow],
        x,
        y,
        duration: STEP_DURATION,
        ease: 'Linear',
        onComplete: () => {
          u.sprite.setDepth(objDepth(to.gx, to.gy, L_UNIT));
          resolve();
        },
      }),
    );
  }

  private setUnitVisible(u: Unit, v: boolean): void {
    u.sprite.setVisible(v);
    u.shadow.setVisible(v);
  }

  // ================================================================== nakładki, kamera, atmosfera

  private createOverlays(): void {
    this.cursor = this.add.image(0, 0, 'fx_cursor').setOrigin(0.5, 0).setDepth(D_CURSOR).setVisible(false);
    this.tweens.add({ targets: this.cursor, alpha: { from: 1, to: 0.55 }, duration: 520, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });

    this.rangeGfx = this.add.graphics().setDepth(D_CURSOR - 0.5);
    this.aimGfx = this.add.graphics().setDepth(D_PATH + 0.5);
    this.ringGfx = this.add.graphics().setDepth(D_UNIT_SHADOW + 0.5);
    this.barGfx = this.add.graphics().setDepth(D_TEXT - 5);

    // warstwa ekranowa: dzieci w pikselach projektowych (0..BASE_W), kontener skalowany przy zmianie przybliżenia
    const width = BASE_W, height = BASE_H;
    this.overlay = this.add.container(SX0, SY0).setScrollFactor(0).setDepth(D_SCREEN);
    this.art.get(`fx_vignette_${width}x${height}`, () => ({ pc: paintVignette(width, height), ax: 0, ay: 0 }));
    const vignette = this.add.image(0, 0, `fx_vignette_${width}x${height}`).setOrigin(0);

    // pora dnia / pogoda ze zlecenia: barwna zasłona na cały ekran (Oldgame/src/gfx/atmosphere.js w uproszczeniu)
    const MOODS: Record<string, [number, number]> = { dusk: [0xffb878, 0.3], night: [0x5868a8, 0.55], toxic: [0x9ad060, 0.4], storm: [0xd0a060, 0.4] };
    const mood = MOODS[this.job?.mood ?? 'day'];
    if (mood) this.overlay.add(this.add.rectangle(0, 0, width, height, mood[0], mood[1]).setOrigin(0).setBlendMode(Phaser.BlendModes.MULTIPLY));
    this.stormy = this.job?.mood === 'storm' ? 6 : this.job?.mood === 'toxic' ? 0.5 : 1;

    // unoszący się pył (przestrzeń ekranu)
    const R = rng(this.map.seed);
    const dustColor = this.job?.mood === 'toxic' ? 0xa8e060 : this.biome === 'bunker' ? 0x9aa4b0 : this.biome === 'wastes' ? 0xd8b880 : 0xc8b89a;
    for (let i = 0; i < (this.stormy > 1 ? 110 : 46); i++) {
      const img = this.add
        .image(R() * width, R() * height, 'fx_px')
        .setTint(dustColor)
        .setAlpha(0.12 + R() * 0.3)
        .setScale(R() < 0.8 ? 0.5 : 1);
      this.overlay.add(img);
      this.dust.push({ img, vx: 3 + R() * 6, vy: 1 + R() * 3, ph: R() * 10 });
    }
    this.overlay.add(vignette);
  }

  // ---------- przybliżenie kamery (kółko, +/-, 0) - Oldgame/src/scenes/mission.js:639-645

  private zoomBy(f: number): void {
    this.setZoom(this.camZoom * f);
  }

  private setZoom(z: number): void {
    this.camZoom = Math.max(0.5, Math.min(2, z));
    const cam = this.cameras.main;
    cam.setZoom(ZOOM * this.camZoom);
    // kontener ekranowy: świat = środek + (px * ZOOM - środek) / zoom kamery
    const k = 1 / this.camZoom;
    this.overlay.setScale(k).setPosition(((BASE_W * ZOOM) / 2) * (1 - k / ZOOM), ((BASE_H * ZOOM) / 2) * (1 - k / ZOOM));
    this.refreshPathPreview();
  }

  /** Kursor nad panelem HUD-u (wtedy kółko przewija dziennik, nie przybliża mapy). */
  private overUi(pointer: Phaser.Input.Pointer): boolean {
    const ui = this.scene.get('UIScene');
    if (!ui || !this.scene.isActive('UIScene')) return false;
    return ui.input.hitTestPointer(pointer).length > 0;
  }

  private setupCamera(): void {
    const { width: W, height: H } = this.map;
    const cam = this.cameras.main;
    const left = isoX(0, H) - 48, right = isoX(W, 0) + 48;
    const top = -96, bottom = isoY(W, H) + 48;
    cam.setBounds(left, top, right - left, bottom - top);
    cam.setZoom(ZOOM);
    cam.setRoundPixels(true);
    this.following = false;
    this.refollow();
    cam.fadeIn(500, 0, 0, 0);

    const kb = this.input.keyboard;
    if (kb) this.panKeys = kb.addKeys('W,A,S,D,UP,DOWN,LEFT,RIGHT') as Record<string, Phaser.Input.Keyboard.Key>;
  }

  /** WASD / strzałki przesuwają kamerę; ruch gracza ponownie ją przypina. */
  private updateCameraPan(dt: number): void {
    const k = this.panKeys;
    if (!k.W) return;
    const dx = (k.D.isDown || k.RIGHT.isDown ? 1 : 0) - (k.A.isDown || k.LEFT.isDown ? 1 : 0);
    const dy = (k.S.isDown || k.DOWN.isDown ? 1 : 0) - (k.W.isDown || k.UP.isDown ? 1 : 0);
    if (!dx && !dy) return;
    const cam = this.cameras.main;
    cam.stopFollow();
    this.following = false;
    cam.scrollX += dx * 180 * dt;
    cam.scrollY += dy * 180 * dt;
    this.refreshPathPreview();
  }

  /** Kamera płynnie śledzi wskazaną postać. */
  private focusOn(u: Unit): void {
    this.focus = u;
    this.following = true;
    this.cameras.main.startFollow(u.sprite, true, 0.14, 0.14, 0, 8);
  }

  private refollow(): void {
    if (!this.following) this.focusOn(this.focus);
  }

  private updateDust(dt: number): void {
    for (const d of this.dust) {
      d.ph += dt;
      d.img.x += (d.vx * this.stormy + Math.sin(d.ph * 0.7) * 4) * dt;
      d.img.y += (d.vy + Math.cos(d.ph * 0.9) * 2) * dt;
      if (d.img.x > BASE_W + 2) d.img.x = -2;
      if (d.img.y > BASE_H + 2) d.img.y = -2;
    }
  }

  private updateLights(): void {
    const t = this.elapsed;
    for (const l of this.glows) {
      const cell = this.cells[l.cell];
      const vis = cell.state === 2 ? 1 : cell.state === 1 ? 0.35 : 0;
      if (vis === 0) {
        l.img.setVisible(false);
        continue;
      }
      let k = 1;
      switch (l.kind) {
        case 'flicker':
          k = 0.78 + Math.sin(t * 11 + l.phase) * 0.08 + Math.sin(t * 23.7 + l.phase * 2) * 0.06 + (hash2(Math.floor(t * 12), 0, l.phase | 0) - 0.5) * 0.12;
          break;
        case 'pulse':
          k = 0.65 + Math.sin(t * 2.2 + l.phase) * 0.35;
          break;
        case 'blink':
          k = (t + l.phase) % 1.6 < 0.5 ? 1 : 0.1;
          break;
        default:
          break;
      }
      l.img.setVisible(true).setAlpha(l.base * k * vis * cell.reveal);
    }
  }

  // ================================================================== mgła wojny

  /** Mgła z Mission (widok wszystkich najemników): widoczne = pełny kolor, zapamiętane = zimny półmrok, reszta ukryta. */
  private updateFogOfWar(): void {
    const m = this.mission;
    const memory = BIOME_STYLE[this.biome].memory;
    for (let i = 0; i < this.cells.length; i++) {
      const cell = this.cells[i];
      const next: CellState = m.vis[i] ? 2 : m.explored[i] ? 1 : 0;
      if (next === cell.state) continue;
      if (cell.state === 0) {
        this.revealing.add(i);
        for (const img of cell.imgs) img.setVisible(true).setAlpha(0);
      }
      cell.state = next;
      const tint = next === 2 ? TINT_VISIBLE : memory;
      for (const img of cell.imgs) if (img.blendMode !== Phaser.BlendModes.ADD) img.setTint(tint);
    }
    for (const u of this.units.values()) {
      if (u.actor.side === 'enemy') this.setUnitVisible(u, this.enemyShown(u.actor, u.pos));
      else if (u.actor.side === 'neutral') this.setUnitVisible(u, this.mission.isVisible(u.pos) || !!u.actor.following);
    }
    this.updateFoes();
  }

  /** Wróg jest widoczny na polu w zasięgu wzroku drużyny; ciało zostaje na odkrytym terenie. */
  private enemyShown(a: Actor, p: GridPos): boolean {
    return a.state === 'dead' ? this.mission.isExplored(p) : this.mission.isVisible(p);
  }

  /** Płynne odsłanianie nowo odkrytych pól. */
  private updateReveal(dt: number): void {
    if (this.revealing.size === 0) return;
    for (const i of this.revealing) {
      const cell = this.cells[i];
      cell.reveal = Math.min(1, cell.reveal + dt * 4);
      for (const img of cell.imgs) img.setAlpha(cell.reveal);
      if (cell.reveal >= 1) this.revealing.delete(i);
    }
  }

  /** Wysokie obiekty przed graczem stają się półprzezroczyste, żeby nie zasłaniały postaci. */
  private updateCutaway(dt: number): void {
    const s = this.focus.sprite;
    const pu = (s.y / 8 + s.x / 16) / 2 - 0.5;
    const pv = (s.y / 8 - s.x / 16) / 2 - 0.5;
    const psum = pu + pv, pdiff = pu - pv;
    const k = Math.min(1, dt * 10);
    for (const t of this.tall) {
      const d = t.gx + t.gy - psum;
      const occludes = d > 0.5 && d < t.reach && Math.abs(t.gx - t.gy - pdiff) < 1.6;
      const target = occludes ? 0.38 : 1;
      if (Math.abs(t.fade - target) < 0.01 && !this.revealing.has(this.idx(t.gx, t.gy))) continue;
      t.fade += (target - t.fade) * k;
      t.img.setAlpha(t.fade * this.cells[this.idx(t.gx, t.gy)].reveal);
    }
  }

  // ================================================================== eksploracja

  /** Klik poza walką: wybór lidera, interakcja z obiektem, zasadzka na wroga albo ruch drużyny (Mission.exploreMove). */
  private async exploreClick(cell: GridPos): Promise<void> {
    const sel = this.selected;
    if (!sel || this.over || !this.hud.canAct || this.hud.inCombat) return;
    const who = this.visibleActorAt(cell);
    if (who?.side === 'pc') {
      void this.selectMember(who);
      return;
    }
    const th = this.mission.thingAt(cell.gx, cell.gy);
    if (th && !who && this.mission.isExplored(cell)) return this.exploreInteract(th);
    this.hud.setBusy(true);
    this.clearPathPreview();
    this.hud.setHover(null);
    if (who?.side === 'enemy' && who.group) {
      // zasadzka: nieświadoma grupa - drużyna działa pierwsza, wrogowie odsłonięci do swojej tury
      this.hud.pushLog(`${sel.ch.name} otwiera ogień z ukrycia!`, 'amber');
      this.mission.startCombat(who.group, true);
    } else {
      const r = this.mission.exploreMove(sel, cell, { group: this.hud.groupMove });
      if (!r.ok) {
        if (r.reason) this.hud.pushLog(r.reason);
        SoundManager.sfx('error', { vol: 0.5 });
        this.hud.setBusy(false);
        this.refreshOverlay();
        return;
      }
      this.refollow();
      this.updateFogOfWar();
      await Promise.all([...r.paths].map(([a, path]) => this.walk(a, path)));
    }
    await this.afterExplore();
  }

  /** Po ruchu / interakcji w eksploracji: sygnały, walka albo powrót sterowania (i pytanie o ewakuację). */
  private async afterExplore(): Promise<void> {
    await this.flush();
    this.updateFogOfWar();
    if (this.over) return;
    if (this.mission.inCombat()) {
      await this.runCombat();
      return;
    }
    this.hud.setBusy(false);
    this.refreshOverlay();
    this.refreshPathPreview();
    await this.checkExtraction();
  }

  /** Interakcja w eksploracji: podejście (jeden ruch) do pola obok obiektu, potem skrzynia / cel / jeniec. */
  private async exploreInteract(th: MissionThing): Promise<void> {
    const sel = this.selected;
    if (!sel || sel.state !== 'up') return;
    this.hud.setBusy(true);
    this.clearPathPreview();
    this.hud.setHover(null);
    const cell = this.mission.interactCell(sel, th);
    if (!cell) {
      this.hud.pushLog('Nie można dojść.');
      SoundManager.sfx('error', { vol: 0.5 });
      this.hud.setBusy(false);
      this.refreshOverlay();
      return;
    }
    if (cell.gx !== sel.gx || cell.gy !== sel.gy) {
      const r = this.mission.exploreMove(sel, cell, { group: this.hud.groupMove });
      if (r.ok) {
        this.refollow();
        this.updateFogOfWar();
        await Promise.all([...r.paths].map(([a, path]) => this.walk(a, path)));
      }
      await this.flush();
      this.updateFogOfWar();
      if (this.mission.inCombat() || this.over) return this.afterExplore();
      if (cheb(sel, th) > 1) {
        this.hud.pushLog(r.ok ? 'Za daleko na jeden ruch — podejdź bliżej.' : (r.reason ?? 'Nie można dojść.'));
        return this.afterExplore();
      }
    }
    this.face(this.units.get(sel)!, { gx: th.gx - sel.gx, gy: th.gy - sel.gy });
    let skill: SkillId | undefined;
    if (th.kind === 'crate') {
      skill = (await this.pickCrateSkill(sel)) ?? undefined;
      this.lastCrateSkill = skill ?? null;
      if (!skill) return this.afterExplore();
    }
    this.mission.interact(sel, th, skill);
    await this.flush();
    const np = this.mission.followNeutral(sel);
    if (np && this.mission.captive?.actor) await this.walk(this.mission.captive.actor, np);
    await this.afterExplore();
  }

  /** Wybór sposobu otwarcia skrzyni (Oldgame/src/scenes/mission.js:532-549): premia najemnika i szansa vs KT. */
  private async pickCrateSkill(a: Actor): Promise<SkillId | null> {
    const dc = this.mission.crateDC();
    const opts = CRATE_SKILLS.map((id) => {
      const m = getStat(a.ch, id);
      const pct = Math.round(hitChances(m, dc).hit * 100);
      return { label: `${SKILLS[id].name} ${fmtMod(m)} (${pct}%)`, value: id as string, primary: false };
    });
    const best = opts.reduce((x, y) => (Number(/\((\d+)%/.exec(y.label)?.[1]) > Number(/\((\d+)%/.exec(x.label)?.[1]) ? y : x));
    best.primary = true;
    const v = await this.hud.ask({
      title: 'Zamknięta skrzynia',
      body: `${a.ch.name} przygląda się zamkowi. Jak go otworzyć? (KT ${dc})\nKrytyczna porażka uruchamia pułapkę; zwykła porażka - zamek się zacina (2 próby).`,
      options: [{ label: 'Zostaw', value: null }, ...opts],
      w: 360,
    });
    return (v as SkillId | null) ?? null;
  }

  /** Cel wykonany i wszyscy w strefie ewakuacji: pytanie o opuszczenie terenu (Oldgame/src/scenes/mission.js:481-492). */
  private async checkExtraction(): Promise<void> {
    if (!this.mission.canExtract()) {
      this.extractAsked = false;
      return;
    }
    if (this.extractAsked || this.over) return;
    this.extractAsked = true;
    this.hud.setBusy(true);
    const v = await this.hud.ask({
      title: 'Strefa ewakuacji',
      body: 'Cel zlecenia wykonany, drużyna jest w strefie ewakuacji. Opuścić teren?',
      options: [{ label: 'Jeszcze nie', value: null }, { label: 'Ewakuacja', value: 'go', primary: true }],
    });
    if (this.over) return;
    if (v === 'go') {
      this.mission.finish('success');
      await this.flush();
      return;
    }
    this.hud.setBusy(false);
    this.refreshOverlay();
  }

  /** Odwrót z potwierdzeniem (eksploracja i walka) - Oldgame/src/scenes/mission.js:357-361. */
  private async askRetreat(): Promise<void> {
    if (this.over || (!this.hud.canAct && !this.hud.inCombat)) return;
    if (this.hud.inCombat && !this.playerTurn) {
      this.hud.pushLog('Odwrót możliwy w turze najemnika.');
      SoundManager.sfx('error', { vol: 0.4 });
      return;
    }
    const wasBusy = this.hud.busy;
    this.hud.setBusy(true);
    const v = await this.hud.ask({
      title: 'Odwrót?',
      body: 'Wycofujecie się ze zlecenia. Nagroda za cel przepada, ale zachowujecie łupy i doświadczenie za pokonanych wrogów.',
      options: [{ label: 'Zostań', value: null }, { label: 'Odwrót', value: 'go', danger: true }],
    });
    if (this.over) return;
    if (v === 'go') {
      this.mission.retreat();
      await this.flush();
      return;
    }
    this.hud.setBusy(wasBusy);
    this.refreshOverlay();
  }

  /** Wybór najemnika: w eksploracji zmienia lidera, w walce - kolejność tury (Combat.switchTo). */
  private async selectMember(a: Actor): Promise<void> {
    if (!this.hud.canAct || a.state !== 'up') {
      if (a.state !== 'up') SoundManager.sfx('error', { vol: 0.4 });
      return;
    }
    if (!this.hud.inCombat) {
      this.hud.setActive(a.ch);
      this.focusOn(this.units.get(a)!);
      SoundManager.sfx('click');
      this.refreshOverlay();
      this.refreshPathPreview();
      return;
    }
    const t = this.playerTurn;
    if (!t || t.actor === a) return;
    const r = this.combat.switchTo(a);
    if (r.message) this.hud.pushLog(r.message, r.ok ? 'dim' : 'bad');
    if (!r.ok) SoundManager.sfx('error', { vol: 0.4 });
    await this.flush();
    this.updateInitiative();
    if (r.ok && r.immediate) this.finishPlayerTurn();
  }

  // ================================================================== walka (tactical/combat.ts)

  /** Pętla walki: kolejne tury wg inicjatywy, aż Combat ogłosi koniec. */
  private async runCombat(): Promise<void> {
    if (this.combatRunning) return;
    this.combatRunning = true;
    this.hud.setBusy(true);
    this.clearPathPreview();
    this.refreshOverlay();
    let stall = 0;
    while (this.mission.inCombat() && this.combat.active && !this.over) {
      const t = this.combat.nextTurn();
      await this.flush();
      this.updateFogOfWar();
      this.updateInitiative();
      if (!t) {
        if (++stall > 5) break;
        continue;
      }
      stall = 0;
      if (t.actor.side === 'pc') await this.playerCombatTurn(t);
      else await this.aiTurn(t.actor);
    }
    await this.flush();
    this.combatRunning = false;
    this.playerTurn = null;
    this.mode = null;
    this.sub = null;
    this.hud.setActions(null, []);
    this.hud.setInitiative([]);
    if (this.over) return;
    // powrót do eksploracji (Oldgame/src/mission/combat.js:316-324)
    SoundManager.music(BIOME_MUSIC[this.biome] ?? 'ruins');
    const lead = this.selected?.state === 'up' ? this.selected : this.mission.pcs.find((p) => p.state === 'up');
    if (lead) {
      this.hud.setActive(lead.ch);
      this.focusOn(this.units.get(lead)!);
    }
    this.hud.ap = MAX_ACTION_POINTS;
    this.hud.maxAp = MAX_ACTION_POINTS;
    this.hud.attacksMade = 0;
    this.hud.setPhase(TurnPhase.EXPLORATION, this.combat.round);
    const allDead = this.mission.enemies.every((e) => e.state === 'dead');
    this.hud.showBanner(allDead ? 'TEREN CZYSTY' : 'WALKA ZAKOŃCZONA', 'good');
    this.updateFogOfWar();
    this.hud.setBusy(false);
    this.refreshOverlay();
    this.refreshPathPreview();
    await this.checkExtraction();
  }

  /** Tura najemnika: czeka na polecenia gracza, aż skończą się akcje lub gracz zakończy turę. */
  private async playerCombatTurn(t: TurnInfo): Promise<void> {
    this.playerTurn = t;
    this.reachCache = null;
    this.mode = null;
    this.sub = null;
    this.hud.setActive(t.actor.ch);
    this.hud.attacksMade = t.actor.mapN;
    this.hud.maxAp = Math.max(MAX_ACTION_POINTS, t.full);
    this.hud.setAp(t.actions);
    this.hud.setPhase(TurnPhase.PLAYER_TURN, this.combat.round);
    this.hud.showBanner(`TURA: ${t.actor.ch.name.toUpperCase()}`, 'good', `${t.actions} ${t.actions === 1 ? 'akcja' : 'akcje'}`);
    SoundManager.sfx('turn');
    this.focusOn(this.units.get(t.actor)!);
    await new Promise<void>((resolve) => {
      this.turnDone = resolve;
      this.hud.setBusy(false);
      this.refreshActions();
      this.refreshOverlay();
      this.refreshPathPreview();
    });
    this.turnDone = null;
    this.playerTurn = null;
    this.mode = null;
    this.sub = null;
    this.modeHint = null;
    this.hud.setActions(null, []);
    this.hud.setBusy(true);
    this.clearPathPreview();
    this.refreshOverlay();
    this.hud.setHover(null);
  }

  private finishPlayerTurn(): void {
    const done = this.turnDone;
    this.turnDone = null;
    done?.();
  }

  /** Jedno polecenie gracza w jego turze: logika -> animacja sygnałów -> odświeżenie HUD-u. */
  private async combatAct(fn: (a: Actor) => ActionOutcome): Promise<void> {
    const t = this.playerTurn;
    if (!t || !this.hud.canAct) return;
    this.hud.setBusy(true);
    this.mode = null;
    this.modeHint = null;
    this.clearPathPreview();
    this.refreshOverlay();
    this.hud.setHover(null);
    const out = fn(t.actor);
    if (!out.ok && out.reason) {
      this.hud.pushLog(out.reason);
      SoundManager.sfx('error', { vol: 0.5 });
    }
    await this.flush();
    this.updateFogOfWar();
    this.updateInitiative();
    this.reachCache = null;
    this.hud.attacksMade = t.actor.mapN;
    this.hud.setAp(this.combat.turn === t ? t.actions : 0);
    this.hud.notify('inventory');
    if (this.over) return;
    if (this.sub === 'items' && !this.combat.consumables(t.actor).length) this.sub = null;
    if (!this.combat.active || this.combat.turn !== t || t.actions <= 0 || t.actor.state !== 'up') {
      this.hud.setActions(null, []);
      await this.wait(300);
      this.finishPlayerTurn();
      return;
    }
    this.hud.setBusy(false);
    this.refreshActions();
    this.refreshOverlay();
    this.refreshPathPreview();
  }

  private async combatClick(cell: GridPos): Promise<void> {
    const t = this.playerTurn;
    if (!t) return;
    const a = t.actor;
    const who = this.visibleActorAt(cell);
    const mode = this.mode;
    if (mode?.type === 'step') return this.combatAct((x) => this.combat.step(x, cell));
    if (mode?.type === 'ability') return this.abilityClick(a, mode.id, cell, who);
    if (mode?.type === 'item') return this.itemClick(a, mode.uid, cell, who);
    if (who?.side === 'enemy') {
      if (t.actions < 1) return this.deny('Brak akcji.');
      return this.combatAct((x) => this.combat.attackTarget(x, who));
    }
    if (mode?.type === 'strike') return this.deny('Wskaż wroga z czerwonym konturem.');
    if (who?.side === 'pc') {
      if (who !== a) await this.selectMember(who);
      return;
    }
    const th = this.mission.thingAt(cell.gx, cell.gy);
    if (th) return this.playerInteract(th);
    return this.combatAct((x) => this.combat.stride(x, cell));
  }

  private deny(msg: string): void {
    this.hud.pushLog(msg);
    SoundManager.sfx('error', { vol: 0.5 });
  }

  /** Interakcja w walce: obiekt obok, kosztuje 1 akcję (Oldgame/src/mission/combat.js:447-451). */
  private async playerInteract(th: MissionThing): Promise<void> {
    const t = this.playerTurn;
    if (!t || !this.hud.canAct) return;
    const a = t.actor;
    if (cheb(a, th) > 1) return this.deny('Podejdź bliżej (obok obiektu).');
    if (t.actions < 1) return this.deny('Brak akcji.');
    let skill: SkillId | undefined;
    if (th.kind === 'crate') {
      this.hud.setBusy(true);
      skill = (await this.pickCrateSkill(a)) ?? undefined;
      this.lastCrateSkill = skill ?? null;
      this.hud.setBusy(false);
      if (!skill || this.playerTurn !== t) return;
    }
    return this.combatAct((x) => (this.mission.interact(x, th, skill) ? { ok: true } : { ok: false, reason: 'Nic się nie stało.' }));
  }

  // ---------- pasek akcji (port C.refreshBar)

  private refreshActions(): void {
    const t = this.playerTurn;
    if (!t || this.over || t.actor.state !== 'up' || this.combat.turn !== t) {
      this.hud.setActions(null, []);
      return;
    }
    const a = t.actor, n = t.actions, mode = this.mode;
    const list: ActionButton[] = [];
    const add = (id: string, label: string, cost: number | 'r' | null, o: { enabled?: boolean; active?: boolean; tip?: string } = {}): void => {
      const enabled = (o.enabled ?? true) && (typeof cost !== 'number' || cost <= n);
      list.push({ id, label, cost, enabled, active: o.active, tip: o.tip });
    };
    if (this.sub === 'items') {
      for (const it of this.combat.consumables(a)) {
        const def = itemDef(it.id);
        const c = def?.type === 'consumable' ? def.consumable : null;
        if (!def || !c) continue;
        add(`item:${it.uid}`, `${def.name}${it.qty > 1 ? ' x' + it.qty : ''}`, c.actions, { active: mode?.type === 'item' && mode.uid === it.uid, tip: `${def.name}: ${def.desc}` });
      }
      add('back', 'Wróć', null, { tip: 'Powrót do akcji [Esc].' });
      add('end', 'Koniec tury', null, { tip: 'Zakończ turę [Spacja].' });
      this.hud.setActions(`PRZEDMIOTY — ${a.ch.name}`, list);
      return;
    }
    const w = normWeapon(getWeapon(a.ch));
    const mapIdx = Math.min(2, a.mapN);
    const agile = w.traits.includes('agile');
    add('stride', 'Marsz', 1, { active: mode?.type === 'stride', tip: 'Marsz — przejdź do swojej Prędkości za 1 akcję (niebieskie pola 1 akcja, żółte 2, pomarańczowe 3).' });
    add('step', 'Krok', 1, { active: mode?.type === 'step', tip: 'Krok — przesuń się o 1 pole.' });
    add('strike', `Atak: ${w.name}${mapIdx ? ` (-${(agile ? 4 : 5) * mapIdx})` : ''}`, 1, {
      active: mode?.type === 'strike',
      tip: `Atak: ${w.name}, ${w.range ? 'zasięg ' + w.range : 'wręcz'}. Wrogowie w zasięgu mają czerwony kontur. Kolejne ataki: kara PWA.`,
    });
    for (const id of a.ch.abilities) {
      const ab = abilityDef(id);
      if (!ab || id === 'strike') continue;
      if (id === 'stand' && !hasCondition(a.ch, 'prone')) continue;
      if (id === 'raise_shield' && !a.ch.equipment.shield) continue;
      const reaction = ab.actions === 'reaction';
      const cost = reaction ? 'r' : (ab.actions as number);
      const left = ab.uses ? usesLeft(a.ch, id as AbilityId) : Infinity;
      const dis = reaction || left <= 0 || (cost === 0 && !!a.used['_free_' + id]);
      const extra = ab.actions === 0 ? ' (akcja darmowa)' : reaction ? ' (reakcja)' : '';
      add(`ab:${id}`, ab.name + (ab.uses ? ` (${left})` : ''), cost, { enabled: !dis, active: mode?.type === 'ability' && mode.id === id, tip: `${ab.name}${extra}: ${ab.desc}` });
    }
    const cons = this.combat.consumables(a);
    if (cons.length) add('items', `Przedmioty (${cons.reduce((s, x) => s + x.qty, 0)})`, null, { tip: 'Użyj przedmiotu z plecaka.' });
    const th = this.mission.things.find((x) => !x.done && cheb(a, x) <= 1);
    if (th) add('interact', th.kind === 'crate' ? 'Otwórz skrzynię' : th.kind === 'item' ? 'Zabierz cel' : 'Uwolnij', 1, { tip: 'Interakcja z obiektem obok (1 akcja).' });
    if (a.ch.equipment.weapon2) add('swap', 'Zmień broń', 1, { tip: 'Zamień broń główną z zapasową [X].' });
    add('delay', 'Odłóż turę', null, { tip: 'Przesuń swoją turę na koniec rundy.' });
    add('end', 'Koniec tury', null, { tip: 'Zakończ turę [Spacja].' });
    this.hud.setActions(a.ch.name, list);
  }

  private setMode(m: Mode | null, hint: string | null = null): void {
    const same = (x: Mode | null, y: Mode | null): boolean => !!x && !!y && JSON.stringify(x) === JSON.stringify(y);
    this.mode = same(this.mode, m) ? null : m;
    this.modeHint = this.mode ? hint : null;
    this.refreshActions();
    this.refreshOverlay();
    this.refreshPathPreview();
  }

  /** Esc / PPM: anuluj tryb celowania, potem podmenu przedmiotów. */
  private cancelMode(): void {
    if (!this.playerTurn) return;
    if (this.mode) this.mode = null;
    else if (this.sub) this.sub = null;
    else return;
    this.modeHint = null;
    this.hud.setHover(null);
    this.refreshActions();
    this.refreshOverlay();
    this.refreshPathPreview();
  }

  private async onAction(id: string): Promise<void> {
    const t = this.playerTurn;
    if (!t || !this.hud.canAct) return;
    const a = t.actor;
    if (id === 'stride') return this.setMode({ type: 'stride' }, 'Marsz: kliknij podświetlone pole. [Esc = anuluj]');
    if (id === 'step') return this.setMode({ type: 'step' }, 'Krok: kliknij zielone pole obok. [Esc = anuluj]');
    if (id === 'strike') return this.setMode({ type: 'strike' }, 'Atak: kliknij wroga z czerwonym konturem. [Esc = anuluj]');
    if (id === 'items') {
      this.sub = 'items';
      this.mode = null;
      this.modeHint = null;
      this.refreshActions();
      this.refreshOverlay();
      return;
    }
    if (id === 'back') {
      this.sub = null;
      this.mode = null;
      this.modeHint = null;
      this.refreshActions();
      this.refreshOverlay();
      this.refreshPathPreview();
      return;
    }
    if (id === 'end') return this.finishPlayerTurn();
    if (id === 'delay') {
      this.combat.delay();
      return this.finishPlayerTurn();
    }
    if (id === 'swap') return this.playerSwapWeapons();
    if (id === 'interact') {
      const th = this.mission.things.find((x) => !x.done && cheb(a, x) <= 1);
      return th ? this.playerInteract(th) : undefined;
    }
    if (id.startsWith('ab:')) return this.abilityPick(a, id.slice(3) as AbilityId);
    if (id.startsWith('item:')) return this.itemPick(a, id.slice(5));
  }

  /** Wybór zdolności (port abilityPick): bez celu - od razu, z celem - tryb celowania. */
  private async abilityPick(a: Actor, id: AbilityId): Promise<void> {
    const ab = abilityDef(id);
    const t = this.playerTurn;
    if (!ab || !t) return;
    if (this.combat.abilityCost(ab) > t.actions) return this.deny('Za mało akcji.');
    if (ab.target === 'area' && !(ab.range > 0)) return this.combatAct((x) => this.combat.useAbility(x, id));
    if (ab.target === 'self' || ab.target === 'none' || !ab.target) return this.combatAct((x) => this.combat.useAbility(x, id));
    if ((ab.target === 'enemy' || ab.target === 'ally') && !this.combat.abilityTargets(a, ab).length) return this.deny('Brak celów w zasięgu.');
    const hint =
      ab.target === 'area'
        ? `${ab.name}: wskaż pole (promień ${ab.radius || 1}, zasięg ${ab.range}). [Esc = anuluj]`
        : `${ab.name}: wskaż cel z ${ab.target === 'ally' ? 'zielonym' : 'czerwonym'} konturem. [Esc = anuluj]`;
    this.setMode({ type: 'ability', id }, hint);
  }

  private async abilityClick(a: Actor, id: AbilityId, cell: GridPos, who: Actor | null): Promise<void> {
    const ab = abilityDef(id);
    if (!ab) return;
    if (ab.target === 'enemy' || ab.target === 'ally') {
      if (!who || !this.combat.abilityTargets(a, ab).includes(who)) return this.deny(ab.target === 'ally' ? 'Wskaż sojusznika w zasięgu.' : 'Wskaż wroga w zasięgu i na linii strzału.');
      return this.combatAct((x) => this.combat.useAbility(x, id, [who]));
    }
    if (ab.target === 'area') {
      if (!this.combat.areaCellOk(a, cell, ab.range)) return this.deny('Poza zasięgiem / brak linii.');
      return this.combatAct((x) => this.combat.useAbility(x, id, [], cell));
    }
    return this.combatAct((x) => this.combat.useAbility(x, id));
  }

  /** Wybór przedmiotu w walce (port itemPick): na siebie od razu, inaczej celowanie. */
  private async itemPick(a: Actor, uid: string): Promise<void> {
    const t = this.playerTurn;
    const inst = a.ch.inventory.find((i) => i.uid === uid);
    const c = inst ? this.combat.consumableOf(inst) : null;
    if (!t || !inst || !c) return;
    if (c.actions > t.actions) return this.deny('Za mało akcji.');
    if (c.target === 'self') return this.combatAct((x) => this.combat.useItem(x, inst));
    const name = itemDef(inst.id)?.name ?? 'Przedmiot';
    const hint =
      c.target === 'area'
        ? `${name}: wskaż pole (promień ${c.radius || 1}, zasięg ${c.range || 6}). [Esc = anuluj]`
        : `${name}: wskaż cel z ${c.target === 'enemy' ? 'czerwonym' : 'zielonym'} konturem. [Esc = anuluj]`;
    this.setMode({ type: 'item', uid }, hint);
  }

  private async itemClick(a: Actor, uid: string, cell: GridPos, who: Actor | null): Promise<void> {
    const inst = a.ch.inventory.find((i) => i.uid === uid);
    const c = inst ? this.combat.consumableOf(inst) : null;
    if (!inst || !c) return this.cancelMode();
    if (c.target === 'area') {
      if (!this.combat.areaCellOk(a, cell, c.range || 6)) return this.deny('Poza zasięgiem.');
      return this.combatAct((x) => this.combat.useItem(x, inst, null, cell));
    }
    if (!who) return this.deny('Wskaż cel.');
    return this.combatAct((x) => this.combat.useItem(x, inst, who === x ? null : who));
  }

  /** Tura wroga sterowana przez AI (tactical/ai.ts), decyzja po decyzji z animacją każdej. */
  private async aiTurn(a: Actor): Promise<void> {
    if (this.hud.phase !== TurnPhase.ENEMY_TURN) {
      this.hud.showBanner('TURA WROGA', 'bad');
      SoundManager.sfx('turn');
    }
    this.hud.setPhase(TurnPhase.ENEMY_TURN, this.combat.round);
    const u = this.units.get(a);
    const seen = !!u?.sprite.visible;
    if (u && seen) this.focusOn(u);
    await this.wait(seen ? 320 : 120);
    for (let guard = 0; guard < 10; guard++) {
      const step = aiStep(this.combat, a);
      if (!step) break;
      await this.flush();
      this.updateFogOfWar();
      this.updateInitiative();
      await this.wait(u?.sprite.visible ? 160 : 40);
    }
    if (this.combat.turn?.actor === a) this.combat.turn.actions = 0;
  }

  /** Pasek inicjatywy (port H.initBar): pełna kolejność z najemnikami, bieżący, runda. */
  private updateInitiative(): void {
    const c = this.combat;
    if (!c.active || this.over) {
      if (this.hud.initiative.length) this.hud.setInitiative([]);
      return;
    }
    const cur = c.turn?.actor ?? null;
    const list: InitEntry[] = [];
    c.order.forEach((a, i) => {
      if (a.state === 'dead' || (a.side === 'enemy' && !a.group?.alerted) || a.side === 'neutral') return;
      list.push({ ch: a.ch, side: a.side === 'pc' ? 'pc' : 'enemy', init: a.init, current: a === cur, done: a !== cur && i < c.idx, down: a.state === 'down' });
    });
    this.hud.round = c.round;
    this.hud.setInitiative(list);
  }

  // ================================================================== przedmioty i broń

  /** Przedmiot z plecaka (klik w ekwipunku). W walce: jak z paska akcji (celowanie). */
  private async playerUseItem(uid: string): Promise<void> {
    const sel = this.selected;
    if (!sel || !this.hud.canAct) return;
    const inst = sel.ch.inventory.find((i) => i.uid === uid);
    const def = inst && itemDef(inst.id);
    if (!inst || def?.type !== 'consumable') return;
    const c = def.consumable;
    if (!this.hud.inCombat) {
      if (c.target === 'enemy' || c.target === 'area') return this.deny('Tego można użyć tylko w walce.');
      if (c.effect === 'heal' && sel.ch.hp >= sel.ch.maxHp) return this.deny(`${sel.ch.name} ma pełne PW.`);
      const r = useConsumable(sel.ch, inst, [sel.ch]);
      this.hud.pushLines(r.log, 'amber');
      SoundManager.sfx('heal');
      this.showEvents(r);
      this.hud.notify('inventory');
      return;
    }
    if (!this.playerTurn || this.playerTurn.actor !== sel) return;
    this.hud.toggleInventory(false);
    return this.itemPick(sel, uid);
  }

  private async playerSwapWeapons(): Promise<void> {
    const sel = this.selected;
    if (!sel || !this.hud.canAct || !sel.ch.equipment.weapon2) return;
    if (this.hud.inCombat) {
      SoundManager.sfx('pickup');
      return this.combatAct((a) => this.combat.swapWeapon(a));
    }
    swapWeapons(sel.ch);
    this.hud.pushLog(`${sel.ch.name} dobywa: ${normWeapon(getWeapon(sel.ch)).name}.`);
    SoundManager.sfx('pickup');
    this.hud.notify('stats');
    this.refreshPathPreview();
  }

  // ================================================================== animacja sygnałów

  /** Odtwarza po kolei sygnały zebrane z logiki (dziennik, ruch, ataki, stany). */
  private async flush(): Promise<void> {
    for (let s = this.signals.shift(); s; s = this.signals.shift()) await this.play(s);
  }

  private async play(s: Signal): Promise<void> {
    switch (s.kind) {
      case 'log':
        this.hud.pushLog(s.text, s.tone);
        break;
      case 'combatStart': {
        this.hud.setPhase(TurnPhase.PLAYER_TURN, 1);
        this.hud.showBanner(s.ambush ? 'ZASADZKA!' : 'WALKA!', s.ambush ? 'amber' : 'bad', s.boss ? 'BOSS' : `${s.order.length} uczestników`);
        SoundManager.sfx('alarm', { vol: 0.6 });
        const boss = this.combat.enemies.some((e) => e.group?.alerted && e.state !== 'dead' && (e.ch.ai === 'boss' || enemyDef(e.ch.templateId)?.ai === 'boss'));
        SoundManager.music(s.boss || boss ? 'boss' : 'combat');
        this.updateFogOfWar();
        this.updateInitiative();
        await this.wait(450);
        break;
      }
      case 'join':
        SoundManager.sfx('alarm', { vol: 0.4 });
        if (s.group.actors.some((e) => e.ch.ai === 'boss' || enemyDef(e.ch.templateId)?.ai === 'boss')) SoundManager.music('boss');
        this.updateFogOfWar();
        this.updateInitiative();
        break;
      case 'round':
        this.hud.setPhase(this.hud.phase, s.round);
        this.updateInitiative();
        break;
      case 'turnStart':
        this.updateInitiative();
        break;
      case 'move':
        await this.walk(s.actor, s.path);
        break;
      case 'strike':
        if (s.result.d20) await this.dice(s.result.d20, `Atak: ${s.info.weapon.name}`, s.attacker);
        await this.animateAttack(s.attacker, s.defender, s.info.ranged ? 'shot' : 'melee', s.info.weapon.sfx, s.result);
        break;
      case 'ability':
        await this.animateAbility(s.actor, s.ability, s.targets, s.cell, s.result);
        break;
      case 'item': {
        const def = itemDef(s.item.id);
        const c = def?.type === 'consumable' ? def.consumable : null;
        const foe = s.targets.find((x) => x.side !== s.actor.side);
        if (s.result.d20) await this.dice(s.result.d20, def?.name ?? 'Przedmiot', s.actor);
        if (c?.target === 'area' && s.cell) await this.animateBlast(s.actor, s.cell, s.result);
        else if (c?.target === 'enemy' && foe) await this.animateAttack(s.actor, foe, 'shot', 'explosion', s.result);
        else {
          if (c?.effect === 'buff' || c?.effect === 'smoke') for (const x of s.targets) this.sparks(x, 0x7fb8ff);
          SoundManager.sfx('heal');
          this.showEvents(s.result);
          await this.wait(240);
        }
        this.hud.notify('inventory');
        break;
      }
      case 'rules':
        if (s.result.events.length) {
          this.showEvents(s.result);
          await this.wait(220);
        }
        break;
      case 'state':
        this.showState(s.actor, s.from, s.to);
        this.updateInitiative();
        break;
      case 'spotted': {
        const u = this.units.get(s.by);
        if (u) {
          this.setUnitVisible(u, true);
          this.floatAbove(s.by, '!', COLOR_HOSTILE);
        }
        break;
      }
      case 'discover':
        this.addFindSparkle(s.find);
        this.floatAbove(s.by, '!', C_LOOT);
        SoundManager.sfx('pickup', { vol: 0.5 });
        break;
      case 'pickup': {
        const i = this.idx(s.find.gx, s.find.gy);
        const sp = this.sparkles.get(i);
        if (sp) {
          this.dropCellImg(i, sp);
          this.sparkles.delete(i);
        }
        this.floatAbove(s.by, `+${s.scrap} Złomu`, C_LOOT);
        SoundManager.sfx('coin');
        break;
      }
      case 'crate':
        await this.onCrate(s.thing, s.by, s.roll, s.trapDamage);
        break;
      case 'interact':
        this.onInteract(s.thing, s.by);
        break;
      case 'objective':
        this.hud.setObjectives(this.mission.contract.title ?? 'Zlecenie', s.lines.map((l) => ({ text: l.text, done: l.done, go: l.go, dim: l.tone === 'dim' })));
        break;
      case 'finish':
        this.onMissionFinish(s.result);
        break;
      default:
        break;
    }
  }

  /** Rzut k20 w HUD-zie (port G.showD20Roll): wrogowie tylko widoczni; tempo x2 pomija rzuty wrogów, x4 wszystkie. */
  private async dice(r: CheckResult, label: string, by: Actor): Promise<void> {
    if (by.side !== 'pc' && !this.units.get(by)?.sprite.visible) return;
    const ms = this.hud.showRoll({ label, d20: r.d20, mod: r.mod, total: r.total, dc: r.dc, degree: r.degree, mine: by.side === 'pc' });
    if (ms) await this.wait(1100);
  }

  /** Usuwa obraz z listy pola (mgła) i niszczy go. */
  private dropCellImg(i: number, o: Phaser.GameObjects.Image | Phaser.GameObjects.Sprite): void {
    const imgs = this.cells[i].imgs;
    const k = imgs.indexOf(o as Phaser.GameObjects.Image);
    if (k >= 0) imgs.splice(k, 1);
    o.destroy();
  }

  /** Wynik otwierania skrzyni: kość, pułapka / łup, otwarta skrzynia. */
  private async onCrate(th: MissionThing, by: Actor, r: CheckResult, trap: number): Promise<void> {
    const skill = this.lastCrateSkill;
    await this.dice(r, skill ? `Skrzynia: ${SKILLS[skill].name}` : 'Skrzynia', by);
    const i = this.idx(th.gx, th.gy);
    const view = this.crates.get(i);
    if (r.degree === 0) {
      SoundManager.sfx('explosion');
      this.cameras.main.shake(140, 0.007);
      const c = tileCenter(th);
      const flash = this.add.image(c.x, c.y, 'fx_glow').setBlendMode(Phaser.BlendModes.ADD).setTint(0xffa040).setDepth(D_TEXT - 3).setScale(0.4);
      this.tweens.add({ targets: flash, alpha: 0, scale: 1, duration: 320, onComplete: () => flash.destroy() });
      this.floatAbove(by, `-${trap}`, COLOR_HOSTILE);
      const u = this.units.get(by);
      if (u) {
        this.pose(u, 'hurt');
        this.time.delayedCall(280, () => this.rest(u));
      }
    } else if (r.degree === 1) {
      SoundManager.sfx('error', { vol: 0.5 });
      this.floatAbove(by, th.done ? 'ZACIĘTA' : 'ZAMKNIĘTA', 0xbbbbbb);
    } else {
      SoundManager.sfx('pickup');
      SoundManager.sfx('coin');
      this.floatAbove(by, 'Łup!', C_LOOT);
    }
    if (view && th.done) {
      if (view.sparkle) {
        this.dropCellImg(i, view.sparkle);
        view.sparkle = null;
      }
      if (r.degree !== 1) {
        const info = this.art.get('loot_crate_open', paintLootCrateOpen);
        view.img.setTexture(info.key).setPosition(isoX(th.gx, th.gy) - info.ax, isoY(th.gx, th.gy) - info.ay);
      }
    }
    this.hud.notify('stats');
    await this.wait(250);
  }
  private lastCrateSkill: SkillId | null = null;

  /** Zabrany cel / uwolniony jeniec (Oldgame/src/scenes/mission.js:520-528). */
  private onInteract(th: MissionThing, by: Actor): void {
    if (th.kind === 'item') {
      SoundManager.sfx('pickup');
      this.floatAbove(by, 'Zdobyto!', C_LOOT);
      this.hud.showBanner('CEL ZDOBYTY', 'amber', 'Wróć do strefy ewakuacji');
      const m = this.objMarker;
      if (m) {
        const i = this.idx(th.gx, th.gy);
        for (const img of m.imgs) this.dropCellImg(i, img);
        if (m.light) {
          m.light.img.destroy();
          this.glows.splice(this.glows.indexOf(m.light), 1);
        }
        this.objMarker = null;
      }
    } else if (th.kind === 'captive' && th.actor) {
      SoundManager.sfx('door');
      const u = this.units.get(th.actor);
      if (u) this.setUnitVisible(u, true);
      this.floatAbove(th.actor, 'Wolny!', 0x7fc46a);
      this.hud.showBanner('JENIEC UWOLNIONY', 'good', 'Wyprowadź go do strefy ewakuacji');
    }
  }

  /** Przejście ścieżką krok po kroku (wróg w mgle pojawia się tylko na widocznych polach). */
  private async walk(a: Actor, path: readonly GridPos[]): Promise<void> {
    const u = this.units.get(a);
    if (!u || !path.length) return;
    const enemy = a.side === 'enemy' || (a.side === 'neutral' && !a.following);
    for (const step of path) {
      if (enemy) this.setUnitVisible(u, this.mission.isVisible(u.pos) || this.mission.isVisible(step));
      await this.stepUnit(u, step);
    }
    if (enemy) this.setUnitVisible(u, this.mission.isVisible(u.pos));
    this.rest(u);
  }

  /** Atak wręcz (wypad) albo strzał (smuga) z wynikiem nad celem. */
  private async animateAttack(att: Actor, def: Actor, kind: 'shot' | 'melee', sfx: string, r: ActionResult): Promise<void> {
    const a = this.units.get(att), d = this.units.get(def);
    if (!a || !d) return;
    this.face(a, { gx: d.pos.gx - a.pos.gx, gy: d.pos.gy - a.pos.gy });
    if (isAttackSfx(sfx)) SoundManager.sfx(sfx);
    const show = (): void => this.showEvents(r);
    if (kind === 'shot') {
      this.pose(a, 'attack');
      await this.tracer(a.sprite.x, a.sprite.y - 14, d.sprite.x, d.sprite.y - 12, sfx === 'explosion' ? 0xffd060 : 0xfff0a0);
      show();
    } else await this.lunge(a, d, show);
    this.rest(a);
    await this.wait(300);
  }

  /** Granat / wybuch w polu `cell`. */
  private async animateBlast(att: Actor, cell: GridPos, r: ActionResult): Promise<void> {
    const a = this.units.get(att);
    const c = tileCenter(cell);
    if (a) {
      this.face(a, { gx: cell.gx - a.pos.gx, gy: cell.gy - a.pos.gy });
      this.pose(a, 'attack');
      await this.tracer(a.sprite.x, a.sprite.y - 14, c.x, c.y - 4, 0xffd060);
    }
    SoundManager.sfx('explosion');
    this.cameras.main.shake(160, 0.009);
    const flash = this.add.image(c.x, c.y, 'fx_glow').setBlendMode(Phaser.BlendModes.ADD).setTint(0xffa040).setDepth(D_TEXT - 3).setScale(0.6);
    this.tweens.add({ targets: flash, alpha: 0, scale: 1.4, duration: 380, onComplete: () => flash.destroy() });
    this.showEvents(r);
    if (a) this.rest(a);
    await this.wait(340);
  }

  /** Efekt zdolności (port useAbility w Oldgame/src/mission/combat.js:177-188): animacja i dźwięk wg fx. */
  private async animateAbility(a: Actor, ab: AbilityDef, targets: Actor[], cell: GridPos | undefined, r: ActionResult): Promise<void> {
    const target = targets.find((x) => x !== a) ?? null;
    const fx = ab.fx;
    if (r.d20) await this.dice(r.d20, ab.name, a);
    const u = this.units.get(a);
    if (u && target) this.face(u, { gx: target.gx - a.gx, gy: target.gy - a.gy });
    if (fx === 'explosion' && (cell || target)) {
      await this.animateBlast(a, cell ?? { gx: target!.gx, gy: target!.gy }, r);
      return;
    }
    if ((fx === 'shot' || fx === 'melee') && target) {
      await this.animateAttack(a, target, fx, fx === 'shot' ? 'shot_rifle' : 'melee', r);
      return;
    }
    if (ab.id === 'take_cover') {
      this.floatAbove(a, 'W OSŁONIE', C_COVER);
      SoundManager.sfx('step');
    } else if (fx === 'buff' || fx === 'shout') {
      for (const x of targets.length ? targets : [a]) this.sparks(x, fx === 'shout' ? 0xffb050 : 0x7fb8ff);
      SoundManager.sfx(fx === 'shout' ? 'alarm' : 'heal', { vol: 0.6 });
    } else if (fx === 'heal') {
      SoundManager.sfx('heal');
    }
    if (u) this.pose(u, 'attack');
    this.showEvents(r);
    await this.wait(300);
    if (u) this.rest(u);
  }

  /** Liczby nad celami + krew / iskry na podstawie zdarzeń z ActionResult (port applyEvents). */
  private showEvents(r: Pick<ActionResult, 'events'>): void {
    for (const ev of r.events) {
      if (!('target' in ev)) continue;
      const u = this.unitOfCh(ev.target);
      if (!u) continue;
      const { x, y } = u.sprite;
      const a = u.actor;
      if (ev.type === 'damage' && ev.amount > 0) {
        const crit = ev.degree === 3;
        this.pose(u, 'hurt');
        u.sprite.setTint(0xff6a5a);
        this.time.delayedCall(110, () => this.tintFor(u));
        this.time.delayedCall(280, () => this.rest(u));
        if (u.sprite.visible) this.bloodBurst(x, y - 12);
        this.floatAbove(a, crit ? `-${ev.amount}!` : `-${ev.amount}`, a.side === 'pc' ? COLOR_HOSTILE : crit ? C_CRIT : COLOR_OK);
        if (a.side === 'pc') this.cameras.main.shake(110, 0.005);
        SoundManager.sfx(crit ? 'crit' : 'hit', { vol: 0.7 });
      } else if (ev.type === 'miss') {
        this.floatAbove(a, 'PUDŁO', 0xbbbbbb);
        SoundManager.sfx('miss', { vol: 0.6 });
      } else if (ev.type === 'heal' && ev.amount > 0) {
        this.floatAbove(a, `+${ev.amount}`, 0x7fe05a);
        this.sparks(a, 0x7fe05a);
      } else if (ev.type === 'condition') {
        const name = ev.condition === 'stable' ? 'Stabilny' : conditionDef(ev.condition)?.name;
        if (name && ev.condition !== 'dead' && ev.condition !== 'dying') this.floatAbove(a, name, C_COND);
      }
    }
    this.hud.notify('stats');
  }

  /** Iskry unoszące się z postaci (leczenie / wzmocnienie). */
  private sparks(a: Actor, color: number): void {
    const u = this.units.get(a);
    if (!u || !u.sprite.visible) return;
    const R = rng(Math.floor(this.elapsed * 997) + a.gx * 31);
    for (let i = 0; i < 8; i++) {
      const px = this.add.image(u.sprite.x + (R() - 0.5) * 12, u.sprite.y - 4 - R() * 10, 'fx_px').setTint(color).setDepth(D_TEXT - 1).setBlendMode(Phaser.BlendModes.ADD).setScale(0.5);
      this.tweens.add({ targets: px, y: px.y - 10 - R() * 8, alpha: 0, delay: R() * 200, duration: 600, onComplete: () => px.destroy() });
    }
  }

  /** Kolor sprite'a zależny od stanu (powalony / martwy). */
  private tintFor(u: Unit): void {
    if (u.actor.state === 'dead') u.sprite.setTint(0x6a4a4a);
    else if (u.actor.state === 'down') u.sprite.setTint(0x9a7a7a);
    else u.sprite.clearTint();
  }

  private showState(a: Actor, from: ActorState, to: ActorState): void {
    const u = this.units.get(a);
    if (!u) return;
    this.tweens.killTweensOf(u.shadow);
    if (to === 'dead') {
      this.pose(u, 'hurt');
      this.tintFor(u);
      this.tweens.add({ targets: [u.sprite, u.shadow], alpha: a.side === 'enemy' ? 0.35 : 0.5, duration: 500 });
      if (a.side === 'enemy') {
        const fac = a.ch.faction ?? enemyDef(a.ch.templateId)?.faction;
        SoundManager.sfx(fac === 'beast' || fac === 'mutant' ? 'scream' : 'death', { vol: 0.7 });
      } else {
        this.floatAbove(a, 'ZGINĄŁ', COLOR_HOSTILE);
        SoundManager.sfx('death');
      }
    } else if (to === 'down') {
      this.pose(u, 'hurt');
      this.tintFor(u);
      this.floatAbove(a, 'POWALONY!', COLOR_HOSTILE);
      SoundManager.sfx('scream');
    } else if (from !== 'up') {
      u.sprite.setAlpha(1);
      u.shadow.setAlpha(1);
      this.tintFor(u);
      this.idle(u);
    }
    this.hud.notify('stats');
  }

  private onMissionFinish(result: MissionResult): void {
    this.over = true;
    this.playerTurn = null;
    this.turnDone = null;
    this.hud.setBusy(true);
    this.clearPathPreview();
    this.hud.answer(null);
    this.hud.setActions(null, []);
    this.hud.setInitiative([]);
    this.rangeGfx.clear();
    this.aimGfx.clear();
    this.outline.clear();
    this.hoverOutline.clear();
    this.finishPlayerTurn();
    if (result.result === 'fail') {
      this.missionFailed(result);
      return;
    }
    const retreat = result.result === 'retreat';
    SoundManager.music(retreat ? null : 'victory');
    this.hud.setPhase(TurnPhase.EXPLORATION, this.combat.round);
    this.hud.showBanner(retreat ? 'ODWRÓT' : 'ZLECENIE WYKONANE', retreat ? 'amber' : 'good', `+${result.xp} PD · ${result.scrap} złomu`);
    this.hud.pushLog(`${retreat ? 'Odwrót' : 'Zlecenie wykonane'}: +${result.xp} PD, ${result.scrap} złomu, łupy: ${result.loot.length}.`, retreat ? 'amber' : 'good');
    if (result.casualties.length) this.hud.pushLog(`Polegli: ${result.casualties.join(', ')}.`, 'bad');
    this.hud.pushLog(this.job ? 'Powrót do Przystani...' : 'Nowe zlecenie za chwilę...', 'dim');
    this.time.delayedCall(retreat ? 2200 : 4500, () => this.cameras.main.fadeOut(900, 0, 0, 0));
    this.time.delayedCall(retreat ? 3200 : 5500, () => this.leave(result));
  }

  /** Koniec misji: podsumowanie (rozliczenie robi DebriefScene przez src/core/campaign/debrief). */
  private leave(result: MissionResult): void {
    if (!this.job) {
      this.scene.restart();
      return;
    }
    this.scene.start('DebriefScene', { result, contract: this.job });
  }

  private missionFailed(result: MissionResult): void {
    this.hud.pushLog('Drużyna pada. Sygnał utracony.', 'bad');
    if (result.casualties.length) this.hud.pushLog(`Polegli: ${result.casualties.join(', ')}.`, 'bad');
    SoundManager.music('defeat');
    this.hud.showBanner('DRUŻYNA POLEGŁA', 'bad');
    const lost = label(this, BASE_W / 2, BASE_H / 2 - 8, 'SYGNAŁ UTRACONY', { size: 14, bold: true, color: 0xff5555 }).setOrigin(0.5);
    this.overlay.add([this.add.rectangle(BASE_W / 2, BASE_H / 2 - 8, lost.width + 12, lost.height + 8, 0x050a06, 1), lost]);
    if (this.job)
      this.overlay.add(label(this, BASE_W / 2, BASE_H / 2 + 14, GAMEOVER_LINES[0], { size: 7, color: 0xc8b8a0, wrap: 300, align: 'center' }).setOrigin(0.5, 0));
    const hold = this.job ? 3600 : 100;
    this.time.delayedCall(hold, () => this.cameras.main.fadeOut(1700, 0, 0, 0));
    this.time.delayedCall(hold + 1800, () => this.leave(result));
  }

  /** Smuga pocisku między dwoma punktami świata. */
  private tracer(x0: number, y0: number, x1: number, y1: number, color = 0xfff0a0): Promise<void> {
    const g = this.add.graphics().setDepth(D_TEXT - 2);
    g.lineStyle(1, color, 1).lineBetween(x0, y0, x1, y1);
    return new Promise<void>((resolve) =>
      this.tweens.add({ targets: g, alpha: 0, duration: 140, onComplete: () => (g.destroy(), resolve()) }),
    );
  }

  private addFindSparkle(f: MissionFind): void {
    const i = this.idx(f.gx, f.gy);
    if (!this.sparkles.has(i)) this.sparkles.set(i, this.addSparkle(f.gx, f.gy, -2));
  }

  // ================================================================== podgląd pod kursorem

  private clearPathPreview(): void {
    for (const d of this.pathDots) d.setVisible(false);
    this.costLabel?.setVisible(false);
    this.cursor?.setVisible(false);
  }

  /** Zasięg Marszu aktywnej postaci (liczony raz na stan tury). */
  private reach(t: TurnInfo): { res: SearchResult; sp: number } {
    if (!this.reachCache) this.reachCache = this.combat.reachFor(t.actor, t.actions);
    return this.reachCache;
  }

  private refreshPathPreview(): void {
    const sel = this.selected;
    this.aimGfx?.clear();
    this.hoverOutline.clear();
    if (!this.hud.canAct || !sel || this.over || this.hud.prompt) {
      this.clearPathPreview();
      return;
    }
    const target = this.pointerCell();
    if (!this.inMap(target.gx, target.gy) || this.cells[this.idx(target.gx, target.gy)].state === 0) {
      this.clearPathPreview();
      this.hud.setHover(this.modeHint);
      return;
    }
    this.cursor.setPosition(isoX(target.gx, target.gy), isoY(target.gx, target.gy)).setVisible(true);
    const who = this.visibleActorAt(target);
    const t = this.playerTurn;
    const mode = this.mode;

    // celowanie obszarowe (granaty, zdolności): okrąg wybuchu, trafieni, ostrzeżenie o swoich (combat.js:383-391)
    const area = t ? this.areaSpec(t.actor) : null;
    if (t && area) {
      const a = t.actor;
      const ok = this.combat.areaCellOk(a, target, area.range);
      const hit = ok ? area.targets(target) : [];
      for (const x of hit) this.hoverOutline.set(x, x.side === a.side ? OL.blastAlly : OL.blast);
      const nf = hit.filter((x) => x.side !== a.side).length, na = hit.filter((x) => x.side === a.side).length;
      this.drawAim(target, area.r, ok);
      this.drawPath([], () => COLOR_OK);
      this.setCostLabel(null, target, 0);
      this.cursor.setTint(ok ? 0xffa028 : 0x8a8a9a);
      this.hud.setHover(
        `${area.name} (promień ${area.r}, zasięg ${area.range}) · ` +
          (ok ? `Trafi: ${nf} ${nf === 1 ? 'wroga' : 'wrogów'}${na ? ` · UWAGA: w tym sojusznicy: ${na}!` : ''}` : 'Poza zasięgiem lub brak linii strzału.'),
      );
      return;
    }

    if (who) {
      this.drawPath([], () => COLOR_OK);
      this.setCostLabel(null, target, 0);
      this.cursor.setTint(who.side === 'enemy' ? COLOR_HOSTILE : COLOR_ALLY);
      if (t && mode && (mode.type === 'ability' || mode.type === 'item')) {
        const ok = (this.outline.get(who) ?? OL.off) !== OL.off && this.outline.has(who);
        if (ok) this.hoverOutline.set(who, OL.hover);
        const name = mode.type === 'ability' ? abilityDef(mode.id)?.name : itemDef(t.actor.ch.inventory.find((i) => i.uid === mode.uid)?.id)?.name;
        this.hud.setHover(`${name ?? ''} → ${who.ch.name} · PW ${Math.max(0, who.ch.hp)}/${who.ch.maxHp} · ${ok ? 'kliknij, by użyć' : 'nieprawidłowy cel (zasięg / linia strzału)'}`);
        return;
      }
      if (who.side === 'enemy') {
        const i = this.combat.strikeInfo(sel, who);
        if (i.ok || i.melee) this.hoverOutline.set(who, OL.hover);
      }
      this.hud.setHover(who.side === 'enemy' ? this.enemyHoverText(sel, who) : this.allyHoverText(who));
      return;
    }
    const th = this.mission.thingAt(target.gx, target.gy);
    if (th && this.mission.isExplored(target)) {
      this.drawPath([], () => COLOR_OK);
      this.setCostLabel(null, target, 0);
      this.cursor.setTint(C_LOOT);
      const what = th.kind === 'crate' ? `Skrzynia (KT ${this.mission.crateDC()}) — kliknij, by otworzyć` : th.kind === 'item' ? `${th.name} — kliknij, by zabrać` : 'Jeniec — kliknij, by uwolnić';
      this.hud.setHover(`${what}${t ? ' (obok, 1 akcja)' : ''}`);
      return;
    }
    this.hud.setHover(this.modeHint);

    if (t) {
      if (mode?.type === 'step') {
        const ok = this.combat.stepOptions(t.actor).some((p) => p.gx === target.gx && p.gy === target.gy);
        this.drawPath([], () => COLOR_OK);
        this.cursor.setTint(ok ? MOVE_COL.s[2] : 0x8a8a9a);
        this.setCostLabel(ok ? '1AP' : null, target, MOVE_COL.s[2]);
        if (ok) this.hud.setHover('Krok na to pole (1 akcja)');
        return;
      }
      if (mode && mode.type !== 'stride') {
        this.drawPath([], () => COLOR_OK);
        this.setCostLabel(null, target, 0);
        this.cursor.setTint(0x8a8a9a);
        return;
      }
      // walka: Marsz - koszt w akcjach z drogi (przekątna 1.5)
      const { res, sp } = this.reach(t);
      const g = this.combat.grid;
      const c = g.costAt(res, target);
      const ok = c > 0 && c < UNREACHABLE && !this.combat.occupied(target.gx, target.gy);
      const path = ok ? (g.pathFrom(res, target) ?? []) : [];
      const band = (p: GridPos): number => MOVE_COL[String(Math.min(3, strideActions(g.costAt(res, p), sp)))][2];
      this.drawPath(path, band);
      this.cursor.setTint(ok ? band(target) : g.isFree(target.gx, target.gy) ? COLOR_FAR : 0x8a8a9a);
      this.setCostLabel(ok ? `${strideActions(c, sp)}AP` : null, target, ok ? band(target) : COLOR_FAR);
      if (ok) {
        const n = strideActions(c, sp);
        this.hud.setHover(`Marsz: ${path.length} ${path.length === 1 ? 'pole' : path.length < 5 ? 'pola' : 'pól'} — ${n} ${n === 1 ? 'akcja' : 'akcje'}`);
      }
      return;
    }

    // eksploracja: droga lidera, w zasięgu jednego ruchu na zielono
    const group = this.hud.groupMove;
    const range = this.mission.moveRange(sel, group);
    const pass = (gx: number, gy: number): boolean => {
      const o = this.combat.actorAt(gx, gy);
      return !o || o.side === 'pc';
    };
    const path = this.combat.grid.findPath(sel, target, pass, 80) ?? [];
    const within = new Set<GridPos>();
    let cost = 0;
    let prev: GridPos = sel;
    for (const p of path) {
      cost += p.gx !== prev.gx && p.gy !== prev.gy ? 1.5 : 1;
      if (cost <= range + 1e-6) within.add(p);
      prev = p;
    }
    this.drawPath(path, (p) => (within.has(p) ? COLOR_OK : COLOR_FAR));
    const last = path[path.length - 1];
    this.cursor.setTint(!last ? 0x8a8a9a : within.has(last) ? COLOR_OK : COLOR_FAR);
    this.setCostLabel(null, target, 0);
    if (last && within.has(last)) this.hud.setHover(`Ruch — ${Math.ceil(cost)} / ${range} pól${group ? ' (drużyna: najwolniejszy)' : ' (solo)'}`);
    else if (last) this.hud.setHover('Za daleko na jeden ruch — drużyna dojdzie do granicy zasięgu.');
  }

  /** Parametry celowania obszarowego aktywnego trybu (port areaSpec). */
  private areaSpec(a: Actor): { r: number; range: number; name: string; targets: (c: GridPos) => Actor[] } | null {
    const m = this.mode;
    if (m?.type === 'ability') {
      const ab = abilityDef(m.id);
      if (ab?.target === 'area' && ab.range > 0) return { r: ab.radius || 1, range: ab.range, name: ab.name, targets: (c) => this.combat.areaTargetsFor(a, ab, c) };
    }
    if (m?.type === 'item') {
      const inst = a.ch.inventory.find((i) => i.uid === m.uid);
      const c = inst ? this.combat.consumableOf(inst) : null;
      if (inst && c?.target === 'area') return { r: c.radius || 1, range: c.range || 6, name: itemDef(inst.id)?.name ?? 'Wybuch', targets: (cell) => this.combat.areaTargets(cell, c.radius || 1) };
    }
    return null;
  }

  /** Okrąg wybuchu (w rzucie izometrycznym - elipsa) + krzyżyk w środku. */
  private drawAim(cell: GridPos, r: number, ok: boolean): void {
    const g = this.aimGfx.clear();
    const c = tileCenter(cell);
    const R = (r + 0.45) * Math.SQRT2;
    const col = ok ? 0xffa028 : 0xaaaaaa;
    g.lineStyle(1, col, ok ? 0.95 : 0.6).strokeEllipse(c.x, c.y, R * TILE_W, R * TILE_H);
    g.lineStyle(1, col, 0.4).strokeEllipse(c.x, c.y, R * TILE_W - 6, R * TILE_H - 3);
    g.fillStyle(ok ? 0xffd27a : 0xaaaaaa, 1).fillRect(c.x - 4, c.y, 8, 1).fillRect(c.x, c.y - 2, 1, 5);
  }

  /**
   * Nakładka na ziemi: zasięg ruchu wg kosztu (walka: niebieski 1 / żółty 2 / pomarańczowy 3 akcje; Krok: zielony;
   * eksploracja: jeden ruch) + kontury atakowalnych wrogów / prawidłowych celów (Oldgame/src/mission/combat.js:339-361).
   */
  private refreshOverlay(): void {
    const g = this.rangeGfx;
    if (!g) return;
    g.clear();
    this.outline.clear();
    if (this.over || !this.hud.canAct || this.hud.prompt) return;
    const tiles: { gx: number; gy: number; n: string }[] = [];
    const t = this.playerTurn;
    if (t) {
      const a = t.actor, mode = this.mode;
      const foes = this.combat.foesOf(a).filter((f) => this.units.get(f)?.sprite.visible);
      if (!mode || mode.type === 'stride') {
        for (const o of this.combat.moveOptions(a)) if (this.mission.thingAt(o.gx, o.gy)?.kind !== 'crate') tiles.push({ gx: o.gx, gy: o.gy, n: String(Math.min(3, o.actions)) });
        if (t.actions > 0) for (const f of foes) if (this.combat.strikeInfo(a, f).ok) this.outline.set(f, OL.foe);
      } else if (mode.type === 'step') {
        for (const p of this.combat.stepOptions(a)) tiles.push({ ...p, n: 's' });
      } else if (mode.type === 'strike') {
        for (const f of foes) this.outline.set(f, this.combat.strikeInfo(a, f).ok ? OL.foe : OL.off);
      } else if (mode.type === 'ability') {
        const ab = abilityDef(mode.id);
        if (ab && (ab.target === 'enemy' || ab.target === 'ally')) for (const x of this.combat.abilityTargets(a, ab)) this.outline.set(x, ab.target === 'ally' ? OL.ally : OL.foe);
      } else if (mode.type === 'item') {
        const inst = a.ch.inventory.find((i) => i.uid === mode.uid);
        const c = inst ? this.combat.consumableOf(inst) : null;
        if (c?.target === 'enemy') for (const f of foes.filter((f) => cheb(a, f) <= Math.max(1, c.range || 1))) this.outline.set(f, OL.foe);
        else if (c && c.target !== 'area') for (const x of this.mission.pcs.filter((p) => p.state !== 'dead' && cheb(a, p) <= Math.max(1, c.range || 1))) this.outline.set(x, OL.ally);
      }
    } else if (!this.hud.inCombat) {
      const sel = this.selected;
      if (sel) for (const p of this.mission.exploreReach(sel, this.hud.groupMove)) tiles.push({ ...p, n: '1' });
    }
    if (!tiles.length) return;
    const band = new Map(tiles.map((p) => [this.idx(p.gx, p.gy), p.n]));
    const nb = (x: number, y: number): string | undefined => (this.inMap(x, y) ? band.get(this.idx(x, y)) : undefined);
    for (const p of tiles) {
      const [fill, alpha, edge] = MOVE_COL[p.n];
      const T = { x: isoX(p.gx, p.gy), y: isoY(p.gx, p.gy) };
      const Rt = { x: T.x + TILE_W / 2, y: T.y + TILE_H / 2 }, B = { x: T.x, y: T.y + TILE_H }, L = { x: T.x - TILE_W / 2, y: T.y + TILE_H / 2 };
      g.fillStyle(fill, alpha).beginPath().moveTo(T.x, T.y).lineTo(Rt.x, Rt.y).lineTo(B.x, B.y).lineTo(L.x, L.y).closePath().fillPath();
      g.lineStyle(1, edge, 0.75);
      if (nb(p.gx, p.gy - 1) !== p.n) g.lineBetween(T.x, T.y, Rt.x, Rt.y);
      if (nb(p.gx + 1, p.gy) !== p.n) g.lineBetween(Rt.x, Rt.y, B.x, B.y);
      if (nb(p.gx, p.gy + 1) !== p.n) g.lineBetween(B.x, B.y, L.x, L.y);
      if (nb(p.gx - 1, p.gy) !== p.n) g.lineBetween(L.x, L.y, T.x, T.y);
    }
  }

  /** Co klatkę: kontury (pierścienie pod stopami), znacznik aktywnej postaci, paski PW nad głowami. */
  private updateMarkers(): void {
    const rg = this.ringGfx, bg = this.barGfx;
    if (!rg || !bg) return;
    rg.clear();
    bg.clear();
    // aktywna postać: narożniki pola (bursztyn = drużyna, czerwień = tura wroga)
    const cur = this.over ? null : this.hud.inCombat ? (this.combat.turn?.actor ?? null) : this.selected;
    const cu = cur && this.units.get(cur);
    if (cu && cu.sprite.visible) {
      const col = cur!.side === 'pc' ? 0xffc040 : 0xff4a3a;
      const x = cu.sprite.x, y = cu.sprite.y;
      rg.fillStyle(col, 0.18).beginPath().moveTo(x, y - 7).lineTo(x + 14, y).lineTo(x, y + 7).lineTo(x - 14, y).closePath().fillPath();
      rg.lineStyle(1, col, 0.9);
      for (const [dx, dy] of [[0, -8], [16, 0], [0, 8], [-16, 0]] as const) {
        const px = x + dx, py = y + dy;
        const sx = dx ? -Math.sign(dx) : 1, sy = dy ? -Math.sign(dy) : 1;
        if (dx) rg.lineBetween(px, py, px + sx * 4, py - 2).lineBetween(px, py, px + sx * 4, py + 2);
        else rg.lineBetween(px, py, px - 4, py + sy * 2).lineBetween(px, py, px + 4, py + sy * 2);
      }
    }
    for (const [a, u] of this.units) {
      if (!u.sprite.visible) {
        this.barMarks.get(a)?.setVisible(false);
        continue;
      }
      const col = this.hoverOutline.get(a) ?? this.outline.get(a);
      if (col !== undefined && a.state !== 'dead') {
        rg.lineStyle(1, col, 1).strokeEllipse(u.sprite.x, u.sprite.y, 18, 9);
        rg.lineStyle(1, col, 0.45).strokeEllipse(u.sprite.x, u.sprite.y, 22, 11);
      }
      // pasek PW (Oldgame/src/scenes/mission.js:167-173): wrogowie odwrotna paleta; ! = powalony, X = poległy
      if (a.side === 'neutral' || (a.side === 'enemy' && a.state === 'dead')) {
        this.barMarks.get(a)?.setVisible(false);
        continue;
      }
      const top = u.sprite.y - u.sprite.displayHeight * u.sprite.originY + 2;
      const p = Math.max(0, Math.min(1, a.ch.maxHp > 0 ? a.ch.hp / a.ch.maxHp : 0));
      const fill = a.side === 'pc' ? (p > 0.5 ? 0x6fd04a : p > 0.25 ? 0xf2a93b : 0xe0553f) : p > 0.5 ? 0xd9473a : p > 0.25 ? 0xe0803a : 0xf0c040;
      const x0 = Math.round(u.sprite.x - 8), y0 = Math.round(top);
      bg.fillStyle(0x000000, 0.85).fillRect(x0 - 1, y0 - 1, 18, 4);
      bg.fillStyle(0x301010, 1).fillRect(x0, y0, 16, 2);
      bg.fillStyle(fill, 1).fillRect(x0, y0, Math.round(16 * p), 2);
      const markTxt = a.state === 'dead' ? 'X' : a.state === 'down' ? '!' : null;
      let mark = this.barMarks.get(a);
      if (markTxt) {
        const key = `txt_${markTxt}`;
        if (!this.textures.exists(key)) this.art.get(key, () => ({ pc: paintText(markTxt), ax: 0, ay: 0 }));
        if (!mark) {
          mark = this.add.image(0, 0, key).setDepth(D_TEXT - 4);
          this.barMarks.set(a, mark);
        }
        mark.setTexture(key).setTint(a.state === 'dead' ? 0xffffff : 0xff6a50).setPosition(u.sprite.x, y0 - 6).setVisible(true);
      } else mark?.setVisible(false);
    }
  }

  private drawPath(path: readonly GridPos[], tint: (p: GridPos) => number): void {
    while (this.pathDots.length < path.length) this.pathDots.push(this.add.image(0, 0, 'fx_dot').setDepth(D_PATH).setVisible(false));
    this.pathDots.forEach((dot, i) => {
      const step = path[i];
      if (!step || i === path.length - 1) {
        dot.setVisible(false);
        return;
      }
      const c = tileCenter(step);
      const col = tint(step);
      dot.setPosition(c.x, c.y).setTint(col).setAlpha(col === COLOR_FAR ? 0.6 : 0.9).setVisible(true);
    });
  }

  private setCostLabel(label: string | null, at: GridPos, color: number): void {
    if (!label) {
      this.costLabel?.setVisible(false);
      return;
    }
    const key = `txt_${label}`;
    if (!this.textures.exists(key)) this.art.get(key, () => ({ pc: paintText(label), ax: 0, ay: 0 }));
    if (!this.costLabel) this.costLabel = this.add.image(0, 0, key).setDepth(D_TEXT);
    const c = tileCenter(at);
    this.costLabel.setTexture(key).setPosition(c.x, c.y - 14).setTint(color).setVisible(true);
  }

  /** Opis wroga pod kursorem: PW, KP, szansa trafienia z flankowaniem / osłoną / PWA (Combat.strikeInfo). */
  private enemyHoverText(sel: Actor, foe: Actor): string {
    const base = `${foe.ch.name} · PW ${Math.max(0, foe.ch.hp)}/${foe.ch.maxHp}`;
    const info = this.combat.strikeInfo(sel, foe);
    const ambush = this.hud.inCombat ? '' : ' · klik = zasadzka (drużyna zaczyna, wróg odsłonięty)';
    if (!info.ok) {
      const approach = info.melee && this.playerTurn && this.playerTurn.actions >= 2 ? ' · podejście i cios (2+ AP)' : '';
      return `${base} · ${info.reason}${approach}${ambush}`;
    }
    const pct = (v: number): string => `${Math.round(v * 100)}%`;
    const notes = [info.flank && 'flankowanie', info.geoCover && 'osłona', info.mapIdx && `PWA -${info.mapIdx * 5}`, info.inc && 'dystans']
      .filter(Boolean)
      .join(', ');
    return `${base} · KP ${info.ac} · trafienie ${pct(info.hit)} (kryt. ${pct(info.crit)})${notes ? ' · ' + notes : ''} · 1 AP${ambush}`;
  }

  private allyHoverText(a: Actor): string {
    const st = a.state === 'down' ? (a.ch.conditions.dying ? ` · UMIERA ${a.ch.conditions.dying}` : ' · nieprzytomny') : a.state === 'dead' ? ' · martwy' : '';
    return `${a.ch.name} · PW ${Math.max(0, a.ch.hp)}/${a.ch.maxHp}${st}`;
  }

  // ================================================================== pomocnicze

  private pointerCell(): GridPos {
    const p = this.input.activePointer;
    const w = this.cameras.main.getWorldPoint(p.x, p.y);
    return worldToGrid(w.x, w.y);
  }

  /** Postać na polu, którą gracz widzi (wrogowie w mgle są niewidoczni). */
  private visibleActorAt(p: GridPos): Actor | null {
    const a = this.combat.actorAt(p.gx, p.gy);
    if (!a) return null;
    return a.side === 'enemy' && !this.units.get(a)?.sprite.visible ? null : a;
  }

  /** Pasek wrogów w HUD-zie: widoczni (w walce w kolejności inicjatywy). */
  private updateFoes(): void {
    const m = this.mission;
    const inCombat = m.inCombat();
    let shown = m.enemies.filter((e) => this.units.get(e)?.sprite.visible && (e.state !== 'dead' || inCombat));
    if (inCombat) {
      const order = this.combat.order;
      shown = shown.sort((p, q) => (order.indexOf(p) + 1 || 999) - (order.indexOf(q) + 1 || 999));
    }
    for (const e of shown) {
      const g = e.group?.idx ?? -1;
      if (e.state === 'dead' || this.seenGroups.has(g)) continue;
      this.seenGroups.add(g);
      if (!inCombat) {
        this.hud.pushLog(`Wróg w zasięgu wzroku: ${e.ch.name}!`, 'bad');
        SoundManager.sfx('alarm', { vol: 0.4 });
      }
    }
    this.hud.setFoes(shown.map((e) => e.ch));
  }

  /** Wypad postaci `a` w stronę `b` z wywołaniem `onHit` w punkcie zwrotnym. */
  private lunge(a: Unit, b: Unit, onHit: () => void): Promise<void> {
    const pa = tileCenter(a.pos), pb = tileCenter(b.pos);
    this.pose(a, 'attack');
    // onYoyo odpala się osobno dla x i y - trafienie pokazujemy raz.
    let hit = false;
    const once = () => {
      if (hit) return;
      hit = true;
      onHit();
    };
    return new Promise<void>((resolve) =>
      this.tweens.add({
        targets: a.sprite,
        x: pa.x + (pb.x - pa.x) * 0.35,
        y: pa.y + (pb.y - pa.y) * 0.35,
        duration: 80,
        yoyo: true,
        hold: 40,
        ease: 'Quad.easeOut',
        onYoyo: once,
        onComplete: () => resolve(),
      }),
    );
  }

  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => this.time.delayedCall(ms, resolve));
  }

  /** Napis nad postacią; kolejne w ciągu 0.6 s piętrzą się wyżej (port M.float). */
  private floatAbove(a: Actor, text: string, color: number): void {
    const u = this.units.get(a);
    if (!u || (!u.sprite.visible && a.side !== 'pc')) return;
    const now = this.time.now;
    const f = this.floatStack.get(a) ?? { t: -1e9, n: 0 };
    f.n = now - f.t < 600 ? f.n + 1 : 0;
    f.t = now;
    this.floatStack.set(a, f);
    const top = u.sprite.y - u.sprite.displayHeight * u.sprite.originY;
    this.floatingText(u.sprite.x, top - 2 - Math.min(f.n, 4) * 9, text, color);
  }

  /** Pikselowy napis (czcionka bitmapowa 6x8 z obrysem) unoszący się i zanikający. */
  private floatingText(x: number, y: number, text: string, color: number): void {
    const key = `txt_${text}`;
    if (!this.textures.exists(key)) this.art.get(key, () => ({ pc: paintText(text), ax: 0, ay: 0 }));
    const label = this.add.image(x, y, key).setTint(color).setDepth(D_TEXT);
    this.tweens.add({ targets: label, y: y - 12, duration: 500, ease: 'Quad.easeOut' });
    this.tweens.add({ targets: label, alpha: 0, delay: 450, duration: 350, onComplete: () => label.destroy() });
  }

  private bloodBurst(x: number, y: number): void {
    const R = rng(Math.floor(this.elapsed * 1000));
    for (let i = 0; i < 9; i++) {
      const px = this.add.image(x, y, 'fx_px').setTint(R() < 0.5 ? 0x9a1a14 : 0x5a0e0c).setDepth(D_TEXT - 1).setScale(R() < 0.6 ? 0.5 : 1);
      const vx = (R() - 0.5) * 28, up = 6 + R() * 10;
      this.tweens.add({ targets: px, x: x + vx, duration: 380, ease: 'Linear' });
      this.tweens.add({
        targets: px,
        y: { from: y, to: y - up },
        duration: 160,
        ease: 'Quad.easeOut',
        yoyo: true,
        onComplete: () => this.tweens.add({ targets: px, alpha: 0, duration: 300, onComplete: () => px.destroy() }),
      });
    }
  }
}
