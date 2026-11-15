import Phaser from 'phaser';
import type { PixelText } from './ui/BitmapFont';
import { SoundManager } from '../audio/SoundManager';
import { BIOME_NAMES, TYPE_NAMES, difficulty } from '../core/campaign/contracts';
import { FAUNA_CHANCE, FAUNA_KINDS, EVENTS, faunaAttackEvent, type EventChoice, type TravelEvent } from '../core/campaign/events';
import { HOME, SECTORS, WQ, buildRoute, contractSpots, heightQ8, routePointAt, routeTicks, sectorOf, type Route, type WPos } from '../core/campaign/region';
import { campaign } from '../core/campaign/session';
import { type Contract, campaignPartyLevel } from '../core/campaign/state';
import { bestForChoice, choiceDC, resolveEventChoice, rollTravelEvent } from '../core/campaign/travel';
import { TickClock, isin } from '../core/frontend';
import { shortName } from '../core/data/names';
import { DEGREE_NAMES, SKILLS } from '../core/data/rules';
import type { ObjectiveType } from '../core/tactical/mission';
import { getStat } from '../core/rules/stats';
import { ENEMIES } from '../core/data/enemies';
import type { EnemyShape } from '../core/data/types';
import { paintCreatureSheet } from './iso/CreatureArt';
import { ArtBook } from './iso/IsoArt';
import { beaconPos, paintRegion, regionFires, scrX, scrY } from './iso/RegionArt';
import { addUnit, unitLookOf } from './iso/UnitLooks';
import { BASE_H, BASE_W, Motes, PAL, ZOOM, ZOOM_EVENT, type UiButton, button, campfire, cut, enter, goto, label, panel, parseColor, tiledImage } from './ui/Kit';
import { modalOpen, openWindow } from './ui/Widgets';

// Mapa regionu i podróż na miejsce zlecenia (port Oldgame/src/scenes/worldmap.js + meta/worldterrain.js).
// Teren z wysokościami, sektory i trasy: src/core/campaign/region.ts (Q8, ticki 50 Hz).
// Malowanie krajobrazu: iso/RegionArt.ts. Zdarzenia w drodze: src/core/campaign/travel.ts.
//
// Dwie kamery: główna (mapa: kółko = przybliżenie w całkowitych krokach, żeby piksele zostały ostre; przeciąganie,
// WSAD / strzałki = przesuwanie; R = cały region; w marszu podąża za drużyną) i kamera interfejsu (panele, napisy,
// okna zdarzeń) ze stałym zoomem. Obiekty dodane po zbudowaniu mapy trafiają do warstwy interfejsu (ADDED_TO_SCENE).

const TYPE_COLOR: Record<ObjectiveType, number> = { eliminate: 0xc43d2f, retrieve: 0x7fc46a, rescue: 0x4aa8ff, hunt: 0xf2a93b, boss: 0xff30ff };
const TONE = { good: PAL.good, amber: PAL.amber, bad: PAL.bad } as const;
const Q = (v: number): number => Math.round(v * WQ);
/** Punkt świata (Q8) -> ekran z wysokością terenu. */
const scr = (p: WPos, up = 0): { x: number; y: number } => ({ x: scrX(p.x), y: scrY(Math.round(p.x), Math.round(p.z), up) });

/** Przybliżenia mapy (krotność zoomu podstawowego): całkowite, więc piksel mapy zawsze ma równy rozmiar. */
const Z_MIN = 1, Z_MAX = 4, Z_TRAVEL = 2, Z_EVENT = 3;
/** Opóźnienie automatycznego wymarszu po przyjściu z Przystani ze zleceniem (Oldgame/src/scenes/worldmap.js:74). */
const AUTO_DEPART_MS = 700;
const LIST_X = 6, LIST_Y = 18, LIST_W = 124, ROW_H = 29;
const SIDE_W = 150, SIDE_X = BASE_W - SIDE_W - 6, SIDE_Y = 18;
const D_LABEL = 5, D_PANEL = 20;

export interface TravelSceneData {
  /** Zlecenie (albo jego id, np. z ?contract= w URL). Podane = auto-wymarsz po 700 ms (klik / klawisz anuluje). */
  contract?: Contract | string;
  /** Dev: wymuszone zdarzenie (id z EVENTS albo 'fauna_attack'), jak ?event= w Oldgame. */
  event?: string;
}

/** Napis przypięty do punktu mapy, rysowany w warstwie interfejsu (stały rozmiar przy każdym przybliżeniu). */
interface MapLabel {
  box: Phaser.GameObjects.Container;
  wx: number;
  wy: number;
  id?: string;
  /** Połowa szerokości napisu (liczona przy pierwszym użyciu). */
  hw?: number;
}

/** Zmutowana bestia krążąca po mapie regionu - pozycja w świecie (Q8), ekran liczony z rzutu z wysokością. */
interface Beast {
  sprite: Phaser.GameObjects.Sprite;
  name: string;
  x: number;
  z: number;
  hx: number;
  hz: number;
  alpha: number;
  wait: number;
  dead: boolean;
  busy: boolean;
}

/** Kolory skóry i oczu bestii losowane przy każdej wizycie (Oldgame/src/scenes/worldmap.js: spawnFauna). */
const BEAST_SKINS = ['#8a6a4a', '#5a5a62', '#7a8a4a', '#9a4a5a', '#4a7a8a', '#b89a5a', '#6a4a8a', '#3a3a3e', '#c8c0b0', '#8fb36a'];
const BEAST_EYES = ['#ff3a2a', '#ffe040', '#40ffc0', '#ff60ff', '#8fff40'];

export class TravelScene extends Phaser.Scene {
  private job: Contract | null = null;
  private all: Contract[] = [];
  private routes = new Map<string, Route>();
  private spots = new Map<string, WPos>();
  private marker!: Phaser.GameObjects.Sprite;
  private route: Route | null = null;
  /** Postęp marszu w tickach 50 Hz i czas całej trasy (Oldgame: max(6 s, długość / 4.2)). */
  private tick = 0;
  private dur = 300;
  private readonly clock = new TickClock();
  private pos: WPos = { x: 0, z: 0 };
  private state: 'idle' | 'moving' | 'event' | 'arrived' = 'idle';
  private eventTick = -1;
  private ambushTick = -1;
  private event: TravelEvent | null = null;
  private stepT = 0;
  private dust: Motes | null = null;
  private pulse: Phaser.GameObjects.Arc | null = null;
  private trail: Phaser.GameObjects.Graphics | null = null;
  private flags = new Map<string, Phaser.GameObjects.Rectangle>();
  private fires: ((t: number) => void)[] = [];
  private beacon: Phaser.GameObjects.Rectangle | null = null;
  private t = 0;
  private fauna: Beast[] = [];
  private backBtn: UiButton | null = null;
  private forced: string | null = null;
  private autoDepart = false;
  private autoTimer: Phaser.Time.TimerEvent | null = null;

  // --- kamera mapy: cel (widok gracza) i bieżący stan (płynne dojście)
  private uiCam!: Phaser.Cameras.Scene2D.Camera;
  private uiLayer = false;
  private view = { x: BASE_W / 2, y: BASE_H / 2, z: 1 };
  private cur = { x: BASE_W / 2, y: BASE_H / 2, z: 1 };
  private drag: { x: number; y: number; moved: boolean } | null = null;
  private keys: Record<string, Phaser.Input.Keyboard.Key> = {};

  // --- interfejs
  private labels: MapLabel[] = [];
  private top!: Phaser.GameObjects.Container;
  private list!: Phaser.GameObjects.Container;
  private side!: Phaser.GameObjects.Container;
  private hint!: PixelText;
  private log!: Phaser.GameObjects.Container;

  constructor() {
    super('TravelScene');
  }

  init(data: TravelSceneData): void {
    const st = campaign.state;
    const c = data?.contract;
    this.job = typeof c === 'string' ? (st.contracts.find((k) => k.id === c) ?? null) : (c ?? null);
    this.autoDepart = !!this.job;
    this.forced = data?.event ?? null;
  }

  create(): void {
    enter(this);
    const st = campaign.state;
    if (!st.party.length) {
      this.scene.start('HubScene');
      return;
    }
    this.state = 'idle';
    this.tick = 0;
    this.t = 0;
    this.fauna = [];
    this.fires = [];
    this.labels = [];
    this.flags = new Map();
    this.drag = null;
    this.route = null;
    this.autoTimer = null;
    this.clock.reset();
    this.view = { x: BASE_W / 2, y: BASE_H / 2, z: 1 };
    this.cur = { ...this.view };

    // kamera interfejsu nad mapą; wszystko, co powstanie przed `uiLayer = true`, widzi tylko kamera mapy
    this.uiLayer = false;
    this.uiCam = this.cameras.add(0, 0, BASE_W * ZOOM, BASE_H * ZOOM).setZoom(ZOOM).centerOn(BASE_W / 2, BASE_H / 2);
    this.uiCam.fadeIn(500, 0, 0, 0);
    const onAdded = (go: Phaser.GameObjects.GameObject): void => void (this.uiLayer ? this.cameras.main.ignore(go) : this.uiCam.ignore(go));
    this.events.on(Phaser.Scenes.Events.ADDED_TO_SCENE, onAdded);
    const onZoom = (): void => void this.uiCam.setZoom(ZOOM).centerOn(BASE_W / 2, BASE_H / 2);
    this.events.on(ZOOM_EVENT, onZoom);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.events.off(Phaser.Scenes.Events.ADDED_TO_SCENE, onAdded);
      this.events.off(ZOOM_EVENT, onZoom);
    });

    // krajobraz z wysokościami (w profilu Amiga: kafle <= 256 px)
    paintRegion(this, 'travel_map', BASE_W, BASE_H);
    tiledImage(this, 'travel_map');
    for (const f of regionFires()) this.fires.push(campfire(this, f.x, f.y, f.size, 2));
    const bp = beaconPos();
    this.beacon = this.add.rectangle(bp.x, bp.y, 2, 2, 0xff3020).setDepth(2);

    // miejsca zleceń: stałe punkty w sektorach; trasy jak w Oldgame (autostrada + ulice, objazd miasta, kręte szlaki)
    const job = this.job;
    this.all = job && !st.contracts.some((k) => k.id === job.id) ? [...st.contracts, job] : st.contracts.slice();
    this.spots = contractSpots(this.all);
    this.routes = new Map();
    this.all.forEach((c, i) => this.routes.set(c.id, buildRoute(this.spots.get(c.id) ?? sectorOf(c.biome).spots[0], c.biome, i)));

    // szlaki: wszystkie przygaszone, wybrana trasa pulsuje (rysowana od końca autostrady)
    const tracks = this.add.graphics().setDepth(2);
    for (const c of this.all) this.drawTrack(tracks, this.routes.get(c.id)!, 0x8a6a48, 0.8);
    this.trail = this.add.graphics().setDepth(2);
    this.pulse = this.add.circle(0, 0, 6).setDepth(3).setVisible(false);

    for (const c of this.all) {
      const p = scr(this.spots.get(c.id)!);
      const col = TYPE_COLOR[c.type] ?? 0xffffff;
      this.add.rectangle(p.x, p.y - 7, 1, 14, 0x1c1c1c).setDepth(3);
      this.flags.set(c.id, this.add.rectangle(p.x + 4, p.y - 11, 7, 5, col).setDepth(3));
      // obszar kliknięcia: maszt + flaga (kamera mapy)
      this.add.rectangle(p.x + 2, p.y - 8, 14, 18, 0, 0).setDepth(3).setInteractive({ useHandCursor: true }).on('pointerup', () => this.clickSelect(c));
    }

    const lead = st.party.find((c) => !c.conditions.dead && c.hp > 0) ?? st.party[0];
    this.pos = { x: HOME.x, z: HOME.z };
    const p0 = scr(this.pos);
    this.marker = addUnit(this, p0.x, p0.y, `pc_${lead.recruitId ?? lead.id}`, unitLookOf(lead)).setDepth(8);
    this.dust = new Motes(this, 90, { x: 0, y: 0, w: BASE_W, h: BASE_H }, 0xf0c080, 12, 1, 4, 0.35, 9);
    this.spawnFauna();

    // ================= warstwa interfejsu
    this.uiLayer = true;
    for (const s of SECTORS) {
      const b = this.add.container(0, 0, [
        label(this, 0, 0, s.name, { size: 7, bold: true, color: s.color }).setOrigin(0.5, 0).setAlpha(0.9),
        label(this, 0, 9, s.sub, { size: 5, color: 0xc9b890 }).setOrigin(0.5, 0),
      ]).setDepth(D_LABEL - 1);
      this.labels.push({ box: b, wx: scrX(s.label.x), wy: scrY(s.label.x, s.label.z) });
    }
    const home = scr(HOME);
    this.labels.push({ box: this.add.container(0, 0, [label(this, 0, 0, 'PRZYSTAŃ', { size: 7, bold: true, color: PAL.amber }).setOrigin(0.5, 0)]).setDepth(D_LABEL), wx: home.x, wy: home.y + 13 });
    for (const c of this.all) {
      const p = scr(this.spots.get(c.id)!), col = TYPE_COLOR[c.type] ?? 0xffffff;
      const t1 = label(this, 0, -19, (c.story ? '★ ' : '') + cut(c.title, 26), { size: 6 }).setOrigin(0.5, 0);
      const t2 = label(this, 0, -10, `${TYPE_NAMES[c.type] ?? c.type} · poz. ${c.level}`, { size: 5, color: 0xb8a888 }).setOrigin(0.5, 0);
      const w = Math.max(t1.displayWidth, t2.displayWidth) + 10;
      const bg = this.add.rectangle(0, -21, w, 21, 0x14100c, 0.9).setOrigin(0.5, 0).setStrokeStyle(1, col).setInteractive({ useHandCursor: true });
      const strip = this.add.rectangle(-w / 2, -21, 3, 21, col).setOrigin(0, 0);
      bg.on('pointerup', () => this.clickSelect(c));
      this.labels.push({ box: this.add.container(0, 0, [bg, strip, t1, t2]).setDepth(D_LABEL), wx: p.x + 3, wy: p.y - 16, id: c.id });
    }

    this.top = this.add.container(0, 0).setDepth(D_PANEL);
    this.list = this.add.container(LIST_X, LIST_Y).setDepth(D_PANEL);
    this.side = this.add.container(SIDE_X, SIDE_Y).setDepth(D_PANEL);
    this.log = this.add.container(0, 0).setDepth(D_PANEL);
    this.hint = label(this, BASE_W - 6, BASE_H - 4, 'Kółko / +−: przybliż · przeciągnij, WSAD: przesuń · R: cały region', { size: 5, color: PAL.dim, align: 'right' }).setOrigin(1, 1).setDepth(D_PANEL);
    // "Zawróć" działa także w trakcie marszu (Oldgame/src/scenes/worldmap.js:264)
    const back = (this.backBtn = button(this, 6, BASE_H - 20, '◀ Wróć do Przystani', () => this.state !== 'event' && this.state !== 'arrived' && this.leave('HubScene'), { w: 132, size: 6.5 }));
    back.box.setDepth(D_PANEL);
    this.drawTop();
    this.select(this.job, true, false);

    this.setupInput();
    SoundManager.music('wastes');
    SoundManager.ambience('wind');
    if (this.job && this.autoDepart) {
      this.msg('Wyruszacie za chwilę… (klik lub Esc: zostań na mapie)');
      this.autoTimer = this.time.delayedCall(AUTO_DEPART_MS, () => {
        this.autoTimer = null;
        this.depart();
      });
    }
  }

  /** Wyjście z wygaszeniem obu kamer. */
  private leave(key: string, data?: object, ms = 400): void {
    this.cancelAuto(false);
    this.uiCam.fadeOut(ms, 0, 0, 0);
    goto(this, key, data, ms);
  }

  /** Klik / klawisz w trakcie odliczania wymarszu wstrzymuje go - gracz zostaje na mapie (przycisk Wyrusz dalej działa). */
  private cancelAuto(note = true): void {
    if (!this.autoTimer) return;
    this.autoTimer.remove();
    this.autoTimer = null;
    if (note) this.msg('Wymarsz wstrzymany — wybierz zlecenie i kliknij „Wyrusz”.');
  }

  // ================================================================== kamera i wejście (worldmap.js:246-271)

  private setupInput(): void {
    const kb = this.input.keyboard;
    if (kb) this.keys = kb.addKeys('W,A,S,D,UP,DOWN,LEFT,RIGHT', false) as Record<string, Phaser.Input.Keyboard.Key>;
    kb?.on('keydown', (e: KeyboardEvent) => {
      if (this.autoTimer) {
        this.cancelAuto();
        return;
      }
      if (modalOpen(this) || this.state !== 'idle') return;
      const k = e.key.toLowerCase();
      if (k === 'enter') this.depart();
      else if (k === 'r') this.view = { x: BASE_W / 2, y: BASE_H / 2, z: 1 };
      else if (k === '+' || k === '=') this.zoomBy(1);
      else if (k === '-' || k === '_') this.zoomBy(-1);
    });
    this.input.on('pointerdown', (p: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]) => {
      this.cancelAuto();
      if (this.state !== 'idle' || modalOpen(this)) return;
      // przeciąganie mapy także z flagi (klik bez ruchu = wybór); panele interfejsu połykają kliknięcie
      if (over.some((o) => !o.willRender(this.cameras.main))) return;
      this.drag = { x: p.x, y: p.y, moved: false };
    });
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      const d = this.drag;
      if (!d || !p.isDown || this.state !== 'idle') return;
      const dx = (p.x - d.x) / ZOOM, dy = (p.y - d.y) / ZOOM;
      if (!d.moved && Math.hypot(dx, dy) < 4) return;
      d.moved = true;
      d.x = p.x;
      d.y = p.y;
      this.view.x -= dx / this.cur.z;
      this.view.y -= dy / this.cur.z;
      this.cur.x = this.view.x;
      this.cur.y = this.view.y;
    });
    this.input.on('pointerup', () => {
      // flaga dostaje pointerup wcześniej - wybór tylko, gdy to nie było przeciąganie
      this.time.delayedCall(0, () => (this.drag = null));
    });
    this.input.on('wheel', (p: Phaser.Input.Pointer, _over: unknown, _dx: number, dy: number) => {
      if (this.state !== 'idle' || modalOpen(this) || !dy) return;
      this.zoomBy(dy < 0 ? 1 : -1, p);
    });
  }

  /** Krok przybliżenia; z kursorem - punkt pod kursorem zostaje w miejscu. */
  private zoomBy(step: number, p?: Phaser.Input.Pointer): void {
    const z0 = this.view.z, z1 = Phaser.Math.Clamp(z0 + step, Z_MIN, Z_MAX);
    if (z1 === z0) return;
    if (p) {
      const sx = p.x / ZOOM, sy = p.y / ZOOM;
      const wx = this.view.x + (sx - BASE_W / 2) / z0, wy = this.view.y + (sy - BASE_H / 2) / z0;
      this.view.x = wx - (sx - BASE_W / 2) / z1;
      this.view.y = wy - (sy - BASE_H / 2) / z1;
    }
    this.view.z = z1;
    SoundManager.sfx('hover', { vol: 0.4 });
  }

  /** Środek widoku przy danym przybliżeniu nie wychodzi poza mapę. */
  private clampView(v: { x: number; y: number; z: number }): void {
    const hw = BASE_W / (2 * v.z), hh = BASE_H / (2 * v.z);
    v.x = Phaser.Math.Clamp(v.x, hw, BASE_W - hw);
    v.y = Phaser.Math.Clamp(v.y, hh, BASE_H - hh);
  }

  private updateCamera(dt: number): void {
    const K = this.keys;
    if (this.state === 'idle' && !modalOpen(this)) {
      const sp = (160 * dt) / this.view.z;
      if (K.A?.isDown || K.LEFT?.isDown) this.view.x -= sp;
      if (K.D?.isDown || K.RIGHT?.isDown) this.view.x += sp;
      if (K.W?.isDown || K.UP?.isDown) this.view.y -= sp;
      if (K.S?.isDown || K.DOWN?.isDown) this.view.y += sp;
    }
    this.clampView(this.view);
    // w marszu kamera podąża za drużyną (Oldgame: focus = pozycja drużyny, bliżej przy zdarzeniu)
    let goal = this.view;
    if (this.state !== 'idle') {
      const m = scr(this.pos);
      goal = { x: m.x, y: m.y - 8, z: this.state === 'event' ? Z_EVENT : Z_TRAVEL };
      this.clampView(goal);
    }
    const c = this.cur, kz = Math.min(1, dt * 6), kp = Math.min(1, dt * (this.drag?.moved ? 20 : 4));
    c.z += (goal.z - c.z) * kz;
    if (Math.abs(goal.z - c.z) < 0.01) c.z = goal.z;
    c.x += (goal.x - c.x) * kp;
    c.y += (goal.y - c.y) * kp;
    this.clampView(c);
    this.cameras.main.setZoom(ZOOM * c.z).centerOn(c.x, c.y);
    // napisy przypięte do mapy (warstwa interfejsu): rzut punktu mapy na ekran
    const travel = this.state !== 'idle';
    const listBottom = LIST_Y + 18 + this.all.length * (ROW_H + 2);
    for (const l of this.labels) {
      let x = BASE_W / 2 + (l.wx - c.x) * c.z;
      const y = BASE_H / 2 + (l.wy - c.y) * c.z;
      if (l.id) x = Phaser.Math.Clamp(x, 40, BASE_W - 40);
      // lista zleceń (lewy górny róg) nie zasłania napisów: odsuwamy je w prawo od panelu
      if (!travel && y - (l.id ? 21 : 0) < listBottom && y + 18 > LIST_Y) {
        const hw = (l.hw ??= l.box.getBounds().width / 2);
        x = Math.max(x, LIST_X + LIST_W + 5 + hw);
      }
      const vis = x > -30 && x < BASE_W + 30 && y > (l.id ? 38 : 16) && y < BASE_H + 10;
      const sel = l.id === this.job?.id;
      l.box.setPosition(Math.round(x), Math.round(y)).setVisible(vis);
      if (l.id) l.box.setAlpha(travel ? (sel ? 1 : 0.3) : this.job && !sel ? 0.8 : 1).setDepth(sel ? D_LABEL + 1 : D_LABEL);
    }
  }

  // ================================================================== lista zleceń, panel szczegółów, pasek górny (worldmap.js:64-66,185-200)

  private clickSelect(c: Contract): void {
    if (this.drag?.moved || this.state !== 'idle' || modalOpen(this)) return;
    this.select(c, true);
  }

  private select(c: Contract | null, centre: boolean, sound = true): void {
    if (this.state !== 'idle') return;
    this.job = c;
    if (sound) SoundManager.sfx('click');
    this.route = c ? this.routes.get(c.id) ?? null : null;
    this.dur = this.route ? routeTicks(this.route) : 300;
    this.trail?.clear();
    if (this.route && this.trail) this.drawTrack(this.trail, this.route, 0xffc050, 1);
    for (const [id, f] of this.flags) f.setAlpha(!c || id === c.id ? 1 : 0.55);
    if (c && this.pulse) {
      const p = scr(this.spots.get(c.id)!);
      this.pulse.setPosition(p.x, p.y).setStrokeStyle(1, c.story ? 0xff30ff : PAL.amber).setVisible(true);
      if (centre && this.view.z > 1) {
        this.view.x = p.x;
        this.view.y = p.y;
      }
    } else this.pulse?.setVisible(false);
    if (this.route) this.marker.setFlipX(routePointAt(this.route, Q(1.5)).x < this.pos.x);
    this.drawList();
    this.drawSide();
  }

  private drawTop(): void {
    const st = campaign.state, T = this.top;
    T.removeAll(true);
    T.add(this.add.rectangle(0, 0, BASE_W, 13, PAL.panel, 0.95).setOrigin(0).setInteractive());
    T.add(this.add.rectangle(0, 13, BASE_W, 1, PAL.edge).setOrigin(0));
    let x = 8;
    const a = label(this, x, 3, 'MAPA REGIONU', { size: 7, color: PAL.amber });
    T.add(a);
    x += a.displayWidth + 16;
    const k = label(this, x, 3, 'Złom: ', { size: 7 });
    const v = label(this, x + k.displayWidth, 3, String(st.scrap), { size: 7, color: PAL.amber });
    T.add([k, v]);
    x += k.displayWidth + v.displayWidth + 16;
    const d = label(this, x, 3, `Dzień: ${st.day}`, { size: 7 });
    T.add(d);
    T.add(label(this, BASE_W - 8, 3, this.state === 'idle' ? 'Kliknij flagę zlecenia, aby je wybrać' : 'W drodze…', { size: 6, color: PAL.dim }).setOrigin(1, 0));
  }

  private drawList(): void {
    const L = this.list, st = campaign.state, lvl = campaignPartyLevel(st);
    L.removeAll(true);
    const H = 16 + this.all.length * (ROW_H + 2);
    L.add(panel(this, 0, 0, LIST_W, H));
    L.add(label(this, 6, 4, 'ZLECENIA', { size: 7, color: PAL.amber }));
    this.all.forEach((c, i) => {
      const y = 14 + i * (ROW_H + 2), on = c === this.job, col = TYPE_COLOR[c.type] ?? 0xffffff, df = difficulty(c.level, lvl);
      const bg = this.add.rectangle(4, y, LIST_W - 8, ROW_H, on ? 0x3a2c1e : PAL.panel2, 1).setOrigin(0).setStrokeStyle(1, on ? PAL.amber : PAL.edge).setInteractive({ useHandCursor: true });
      bg.on('pointerover', () => !on && bg.setStrokeStyle(1, PAL.edgeHi));
      bg.on('pointerout', () => !on && bg.setStrokeStyle(1, PAL.edge));
      bg.on('pointerdown', () => this.state === 'idle' && !modalOpen(this) && this.select(c, true));
      L.add(bg);
      L.add(this.add.rectangle(4, y, 3, ROW_H, col).setOrigin(0));
      L.add(label(this, 10, y + 2, (c.story ? '★ ' : '') + c.title, { size: 6, color: on ? 0xffffff : PAL.text, maxW: LIST_W - 18 }));
      const a = label(this, 10, y + 10, BIOME_NAMES[c.biome] ?? c.biome, { size: 5, color: PAL.dim, maxW: LIST_W - 18 });
      const b = label(this, 10, y + 18, df.label, { size: 5, color: TONE[df.tone] });
      const r = label(this, 10 + b.displayWidth, y + 18, ` · ${c.reward.scrap} Z`, { size: 5, color: PAL.dim });
      L.add([a, b, r]);
    });
  }

  private drawSide(): void {
    const S = this.side, c = this.job;
    S.removeAll(true);
    S.setVisible(!!c && this.state === 'idle');
    if (!c) return;
    const lvl = campaignPartyLevel(campaign.state), df = difficulty(c.level, lvl), W = SIDE_W;
    const items: Phaser.GameObjects.GameObject[] = [];
    let y = 5;
    const add = (s: string, o: Parameters<typeof label>[4], gap = 2): PixelText => {
      const t = label(this, 6, y, s, { wrap: W - 12, ...o });
      items.push(t);
      y += t.displayHeight + gap;
      return t;
    };
    add((c.story ? '★ ' : '') + c.title, { size: 7, color: PAL.amber }, 3);
    add(`${TYPE_NAMES[c.type]} · ${BIOME_NAMES[c.biome]} · ${c.giver}`, { size: 5, color: PAL.dim }, 4);
    add(c.desc, { size: 6, lineSpacing: 1 }, 5);
    const tl = label(this, 6, y, 'Trudność: ', { size: 6 });
    const tv = label(this, 6 + tl.displayWidth, y, df.label, { size: 6, color: TONE[df.tone] });
    const tp = label(this, 6 + tl.displayWidth + tv.displayWidth, y, ` (poz. ${c.level})`, { size: 6, color: PAL.dim });
    items.push(tl, tv, tp);
    y += 10;
    const rl = label(this, 6, y, 'Nagroda: ', { size: 6 });
    const rv = label(this, 6 + rl.displayWidth, y, `${c.reward.scrap} Z`, { size: 6, color: PAL.amber });
    const rx = label(this, 6 + rl.displayWidth + rv.displayWidth, y, ` + ${c.reward.xp} PD`, { size: 6 });
    items.push(rl, rv, rx);
    y += 10;
    add(`Podróż: ${c.travelDays || 1} d.`, { size: 6, color: PAL.dim }, 4);
    const go = button(this, W - 74, y, 'Wyrusz ▶', () => this.depart(), { primary: true, w: 68, h: 16, size: 7 });
    y += 20;
    S.add(panel(this, 0, 0, W, y));
    S.add(items);
    S.add(go.box);
  }

  /** Krótki dziennik wiadomości nad przyciskiem powrotu (znika po 6 s, najwyżej 5). */
  private msg(text: string, tone: keyof typeof TONE | 'text' = 'text'): void {
    const t = label(this, 4, 3, text, { size: 6, color: tone === 'text' ? PAL.text : TONE[tone], wrap: 190 });
    const box = this.add.container(0, 0, [panel(this, 0, 0, t.displayWidth + 8, t.displayHeight + 6), t]);
    this.log.add(box);
    while (this.log.length > 5) this.log.removeAt(0, true);
    this.layoutLog();
    this.time.delayedCall(6000, () => {
      if (!box.active) return;
      this.log.remove(box, true);
      this.layoutLog();
    });
  }

  private layoutLog(): void {
    let y = BASE_H - 24;
    for (const o of [...this.log.list].reverse()) {
      const b = o as Phaser.GameObjects.Container, h = (b.list[0] as Phaser.GameObjects.Container).getBounds().height;
      y -= h + 2;
      b.setPosition(6, y);
    }
  }

  /** Szlak jako kropki co ~1 jednostkę, położone na terenie (bez odcinka autostrady, ten jest na mapie). */
  private drawTrack(g: Phaser.GameObjects.Graphics, r: Route, color: number, alpha: number): void {
    let next = r.cum[r.trackFrom];
    for (let i = r.trackFrom; i < r.n; i++) {
      if (r.cum[i] < next) continue;
      next = r.cum[i] + Q(0.9);
      const x = scrX(r.x[i]), y = scrY(r.x[i], r.z[i]);
      g.fillStyle(0x1a120c, alpha * 0.6).fillRect(x, y + 1, 2, 1);
      g.fillStyle(color, alpha).fillRect(x, y - 1, 2, 2);
    }
  }

  private depart(): void {
    if (this.state !== 'idle' || !this.job || !this.route) return;
    this.cancelAuto(false);
    this.state = 'moving';
    this.tick = 0;
    this.list.setVisible(false);
    this.side.setVisible(false);
    this.hint.setVisible(false);
    this.drag = null;
    const forced = this.forced;
    this.event = forced ? (forced === 'fauna_attack' ? null : EVENTS.find((e) => e.id === forced) ?? null) : rollTravelEvent();
    this.eventTick = this.event ? Math.floor((this.dur * (55 + Math.floor(Math.random() * 26))) / 100) : -1;
    const ambush = forced === 'fauna_attack' || (!forced && Math.random() < FAUNA_CHANCE);
    this.ambushTick = ambush && this.fauna.some((f) => !f.dead) ? Math.floor((this.dur * (18 + Math.floor(Math.random() * 26))) / 100) : -1;
    this.backBtn?.setLabel('◀ Zawróć');
    this.drawTop();
    this.msg(`Wyruszacie: ${this.job.title}`);
    this.marker.play(this.marker.anims.currentAnim!.key.replace('_idle', '_walk'));
    SoundManager.sfx('step');
  }

  /** Marker drużyny na pozycji w świecie: wysokość terenu + lekkie podskakiwanie w marszu. */
  private placeMarker(): void {
    const bob = this.state === 'moving' ? Math.abs(isin((this.clock.tick * 6) & 255)) >> 11 : 0;
    const p = scr(this.pos);
    this.marker.setPosition(p.x, p.y - bob).setDepth(8 + p.y / 1000);
  }

  update(_time: number, delta: number): void {
    const dt = Math.min(delta / 1000, 0.1);
    this.t += dt;
    const ticks = this.clock.advance(delta);
    this.dust?.update(dt);
    this.pulse?.setScale(1 + 0.25 * Math.sin(this.t * 4));
    this.trail?.setAlpha(0.55 + 0.35 * Math.sin(this.t * 4));
    this.beacon?.setVisible((this.clock.tick & 31) < 16);
    for (const f of this.fires) f(this.t);
    this.updateFauna(dt);
    this.updateCamera(dt);
    if (this.state !== 'moving' || !this.route || !this.job) {
      this.placeMarker();
      return;
    }
    const before = this.tick;
    this.tick = Math.min(this.dur, this.tick + ticks);
    const d = Math.floor((this.route.len * this.tick) / this.dur);
    this.pos = routePointAt(this.route, d);
    const ahead = routePointAt(this.route, d + Q(0.6));
    if (Math.abs(ahead.x - this.pos.x) > 8) this.marker.setFlipX(ahead.x < this.pos.x);
    this.placeMarker();
    this.stepT += dt;
    if (this.stepT > 0.3) {
      this.stepT = 0;
      SoundManager.sfx('step', { vol: 0.3 });
    }
    if (this.ambushTick >= 0 && before < this.ambushTick && this.tick >= this.ambushTick) {
      this.ambushTick = -1;
      if (this.startAmbush()) return;
    }
    if (this.event && before < this.eventTick && this.tick >= this.eventTick) {
      this.state = 'event';
      this.marker.play(this.marker.anims.currentAnim!.key.replace('_walk', '_idle'));
      this.showEvent(this.event);
      return;
    }
    if (this.tick >= this.dur) {
      this.state = 'arrived';
      this.msg('Jesteście na miejscu.', 'good');
      this.backBtn?.box.setVisible(false);
      SoundManager.sfx('door');
      SoundManager.ambience(null);
      this.leave('WorldScene', { contract: this.job }, 600);
    }
  }

  // ================================================================== zdarzenie w drodze

  private showEvent(ev: TravelEvent, after?: (choice: number, degree: number) => void): void {
    SoundManager.sfx(ev.id === 'fauna_attack' ? 'alarm' : 'radio', { vol: 0.5 });
    const st = campaign.state;
    const W = 330, H = 78 + ev.choices.length * 20;
    const win = openWindow(this, W, H + 30, ev.title, undefined, { dismiss: false });
    const text = win.add(label(this, 10, 22, ev.text, { size: 7, wrap: W - 20, lineSpacing: 2 }));
    let y = Math.max(60, 26 + text.displayHeight + 6);
    ev.choices.forEach((ch) => {
      const who = bestForChoice(st, ch);
      const hintText = ch.skill && who ? `${SKILLS[ch.skill].name} ${getStat(who, ch.skill) >= 0 ? '+' : ''}${getStat(who, ch.skill)} (${shortName(who.name)}) vs ST ${choiceDC(ch, this.job!)}` : 'bez testu';
      win.add(button(this, 10, y, ch.label, () => {
        win.close();
        this.rollThen(ev, ch, after);
      }, { w: 150, h: 15, size: 6.5 }).box);
      win.add(label(this, 166, y + 4, hintText, { size: 6, color: PAL.dim }));
      y += 20;
    });
  }

  /** Rzut k20 z krótką animacją (Oldgame: GFX.showD20Roll), potem wynik. */
  private rollThen(ev: TravelEvent, choice: EventChoice, after?: (choice: number, degree: number) => void): void {
    const res = resolveEventChoice(campaign.state, this.job!, choice);
    if (!res.check || !res.who || !choice.skill) return this.resolve(ev, choice, res, after);
    const c = res.check;
    SoundManager.sfx('dice');
    const win = openWindow(this, 200, 70, ev.title, undefined, { dismiss: false });
    win.add(label(this, 100, 20, `${shortName(res.who.name)} próbuje: ${SKILLS[choice.skill].name}…`, { size: 6.5, color: PAL.dim }).setOrigin(0.5, 0));
    const die = win.add(this.add.polygon(100, 46, [0, -11, 10, -5, 10, 6, 0, 12, -10, 6, -10, -5], 0x2a2018).setStrokeStyle(1, PAL.amber));
    const num = win.add(label(this, 100, 41, '', { size: 9, bold: true, color: PAL.amber }).setOrigin(0.5, 0));
    let n = 0;
    const spin = this.time.addEvent({ delay: 55, repeat: 13, callback: () => {
      n++;
      die.setAngle(n * 37);
      num.setText(String(n >= 14 ? c.d20 : 1 + Math.floor(Math.random() * 20)));
      if (n >= 14) {
        die.setAngle(0).setStrokeStyle(1, c.d20 === 20 ? PAL.good : c.d20 === 1 ? PAL.bad : PAL.amber);
        this.time.delayedCall(450, () => {
          win.close();
          this.resolve(ev, choice, res, after);
        });
      }
    } });
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => spin.remove());
  }

  private resolve(ev: TravelEvent, choice: EventChoice, res: ReturnType<typeof resolveEventChoice>, after?: (choice: number, degree: number) => void): void {
    const good = res.degree >= 2;
    SoundManager.sfx(res.degree === 3 ? 'crit' : good ? 'pickup' : 'miss');
    const W = 320;
    const win = openWindow(this, W, 150, ev.title, () => {
      this.event = null;
      after?.(ev.choices.indexOf(choice), res.degree);
      this.state = 'moving';
      this.marker.play(this.marker.anims.currentAnim!.key.replace('_idle', '_walk'));
    });
    let y = 22;
    if (res.check && res.who && choice.skill) {
      const c = res.check;
      const line = `${shortName(res.who.name)} — ${SKILLS[choice.skill].name}: k20 ${c.d20} ${c.mod >= 0 ? '+' : ''}${c.mod} = ${c.total} vs ST ${c.dc} → ${DEGREE_NAMES[res.degree]}`;
      win.add(label(this, 10, y, line, { size: 6.5, bold: true, color: good ? PAL.good : PAL.bad, wrap: W - 20 }));
      y += 20;
    }
    const txt = win.add(label(this, 10, y, res.outcome.text, { size: 7, wrap: W - 20, lineSpacing: 2 }));
    y += txt.displayHeight + 8;
    for (const e of res.effects) {
      win.add(label(this, 10, y, `• ${e.text}`, { size: 6.5, color: e.tone === 'good' ? PAL.good : PAL.bad }));
      y += 9;
    }
    if (res.effects.some((e) => e.tone === 'bad')) this.time.delayedCall(250, () => SoundManager.sfx('hit', { vol: 0.5 }));
    win.add(button(this, W - 82, 150 - 22, 'W drogę ▶', () => win.close(), { w: 74, size: 7, primary: true }).box);
    this.drawTop();
    for (const e of res.effects) this.msg(e.text, e.tone === 'good' ? 'good' : 'bad');
  }

  // ================================================================== zmutowana fauna (Oldgame/src/scenes/worldmap.js:118-200)

  /** Arkusz klatek bestii (kształt z szablonu wroga, losowe kolory skóry i oczu). */
  private beastSprite(templateId: string, i: number, x: number, y: number): Phaser.GameObjects.Sprite {
    const def = (ENEMIES as Record<string, { look: { shape: EnemyShape; scale?: number } }>)[templateId];
    const shape = def?.look.shape ?? 'quad';
    const skin = BEAST_SKINS[Math.floor(Math.random() * BEAST_SKINS.length)], eye = BEAST_EYES[Math.floor(Math.random() * BEAST_EYES.length)];
    const name = `fauna_${i}_${Date.now() % 100000}`, tex = `unit_${name}`;
    const sh = paintCreatureSheet(shape, parseColor(skin, 0x8a6a4a), parseColor(eye, 0xff3a2a), templateId);
    new ArtBook(this).sheet(tex, sh.pc, sh.frames);
    this.anims.create({ key: `${name}_idle`, frames: ['f_idle0', 'f_idle1'].map((frame) => ({ key: tex, frame })), frameRate: 1.6, repeat: -1 });
    this.anims.create({ key: `${name}_walk`, frames: [0, 1, 2, 3].map((k) => ({ key: tex, frame: `f_walk${k}` })), frameRate: 11, repeat: -1 });
    const sp = this.add.sprite(x, y, tex, 'f_idle0').setOrigin(0.5, 0.85).setScale(0.6 * Math.min(1.4, def?.look.scale ?? 1) * (0.8 + Math.random() * 0.4)).setDepth(7);
    sp.setData('anim', name);
    sp.play(`${name}_idle`);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.anims.remove(`${name}_idle`);
      this.anims.remove(`${name}_walk`);
      sp.destroy();
      this.textures.remove(tex);
    });
    return sp;
  }


  /** Bestia na ekranie: rzut z wysokością terenu, głębia po Y. */
  private placeBeast(f: Beast): void {
    const p = scr(f);
    f.sprite.setPosition(p.x, p.y).setDepth(7 + p.y / 1000).setAlpha(f.alpha);
  }

  /** 5 bestii na nizinach (wysokość < 1.2), z dala od Przystani, miejsc zleceń i trasy (Oldgame spawnFauna). */
  private spawnFauna(): void {
    const routes = [...this.routes.values()], spots = [...this.spots.values()];
    const far = (x: number, z: number, px: number, pz: number, min: number): boolean => (x - px) ** 2 + (z - pz) ** 2 > (min * WQ) ** 2;
    for (let i = 0; i < 5; i++) {
      let x = 0, z = 0;
      for (let t = 0; t < 60; t++) {
        x = Q(-26 + Math.random() * 56);
        z = Q(-14 + Math.random() * 30);
        if (heightQ8(x, z) >= Q(1.2) || !far(x, z, HOME.x, HOME.z, 6) || !spots.every((s) => far(x, z, s.x, s.z, 3))) continue;
        let ok = true;
        for (const r of routes) for (let k = 0; k < r.n && ok; k += 6) ok = far(x, z, r.x[k], r.z[k], 3);
        if (ok) break;
      }
      const kind = FAUNA_KINDS[Math.floor(Math.random() * FAUNA_KINDS.length)];
      const f: Beast = { sprite: this.beastSprite(kind.templateId, i, 0, 0), name: kind.name, x, z, hx: x, hz: z, alpha: 1, wait: Math.random() * 3, dead: false, busy: false };
      this.placeBeast(f);
      this.fauna.push(f);
    }
  }

  /** Bestie spacerują wokół legowiska, nie wchodzą na skały (wysokość > 1.6). */
  private updateFauna(dt: number): void {
    for (const f of this.fauna) {
      this.placeBeast(f);
      if (f.dead || f.busy) continue;
      f.wait -= dt;
      if (f.wait > 0) continue;
      f.wait = 1 + Math.random() * 4;
      const a = Math.random() * Math.PI * 2, rr = 0.8 + Math.random() * 2.2;
      let tx = f.hx + Q(Math.cos(a) * rr), tz = f.hz + Q(Math.sin(a) * rr);
      if (heightQ8(tx, tz) > Q(1.6)) {
        tx = f.hx;
        tz = f.hz;
      }
      const name = f.sprite.getData('anim') as string, dist = Math.hypot(tx - f.x, tz - f.z) / WQ;
      f.busy = true;
      f.sprite.setFlipX(tx < f.x).play(`${name}_walk`);
      this.tweens.add({ targets: f, x: tx, z: tz, duration: (dist / (0.5 + Math.random() * 0.7)) * 1000, onComplete: () => {
        f.busy = false;
        if (!f.dead) f.sprite.play(`${name}_idle`);
      } });
    }
  }

  /** Najbliższa bestia szarżuje na drużynę, potem zdarzenie walka / odstraszenie / ucieczka. */
  private startAmbush(): boolean {
    const m = this.marker, P = this.pos;
    const live = this.fauna.filter((f) => !f.dead);
    if (!live.length) return false;
    const d2 = (f: Beast): number => (f.x - P.x) ** 2 + (f.z - P.z) ** 2;
    const f = live.reduce((a, b) => (d2(a) <= d2(b) ? a : b));
    this.tweens.killTweensOf(f);
    f.busy = true;
    if (d2(f) > Q(7) ** 2) {
      const a = Math.random() * Math.PI * 2;
      f.x = P.x + Q(Math.cos(a) * 6);
      f.z = P.z + Q(Math.sin(a) * 6);
    }
    this.state = 'event';
    m.play(m.anims.currentAnim!.key.replace('_walk', '_idle'));
    this.msg(`Uwaga! Zmutowany ${f.name} szarżuje na drużynę!`, 'bad');
    SoundManager.sfx('growl');
    const name = f.sprite.getData('anim') as string;
    f.sprite.setFlipX(P.x < f.x).play(`${name}_walk`);
    this.tweens.add({ targets: f, x: P.x + (f.x < P.x ? -Q(0.9) : Q(0.9)), z: P.z, duration: 700, onComplete: () => {
      SoundManager.sfx('hit');
      this.cameras.main.shake(140, 0.004);
      this.showEvent(faunaAttackEvent(f.name), (choice, degree) => {
        if (choice === 0 && degree >= 2) {
          f.dead = true;
          f.sprite.anims.stop();
          this.tweens.add({ targets: f.sprite, angle: f.sprite.flipX ? 90 : -90, duration: 300 });
          this.tweens.add({ targets: f, alpha: 0.5, duration: 300 });
        } else {
          // ucieczka od drużyny (Oldgame: flee 4 s z prędkością 5 jednostek/s), znika w oddali
          const dx = f.x - P.x, dz = f.z - P.z, l = Math.hypot(dx, dz) || 1;
          f.sprite.setFlipX(dx < 0);
          this.tweens.add({ targets: f, x: f.x + (dx / l) * Q(9), z: f.z + (dz / l) * Q(9), alpha: 0, duration: 1600, onComplete: () => (f.dead = true) });
        }
      });
    } });
    return true;
  }
}
