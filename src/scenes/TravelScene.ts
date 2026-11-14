import Phaser from 'phaser';
import type { PixelText } from './ui/BitmapFont';
import { SoundManager } from '../audio/SoundManager';
import { TYPE_NAMES } from '../core/campaign/contracts';
import { FAUNA_CHANCE, FAUNA_KINDS, EVENTS, faunaAttackEvent, type EventChoice, type TravelEvent } from '../core/campaign/events';
import { HOME, SECTORS, WQ, buildRoute, contractSpots, heightQ8, routePointAt, routeTicks, sectorOf, type Route, type WPos } from '../core/campaign/region';
import { campaign } from '../core/campaign/session';
import type { Contract } from '../core/campaign/state';
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
import { BASE_H, BASE_W, Motes, PAL, button, campfire, cut, enter, goto, hex, label, panel, parseColor, tiledImage } from './ui/Kit';
import { openWindow } from './ui/Widgets';

// Mapa regionu i podróż na miejsce zlecenia (port Oldgame/src/scenes/worldmap.js + meta/worldterrain.js).
// Teren z wysokościami, sektory i trasy: src/core/campaign/region.ts (Q8, ticki 50 Hz).
// Malowanie krajobrazu: iso/RegionArt.ts. Zdarzenia w drodze: src/core/campaign/travel.ts.

const TYPE_COLOR: Record<ObjectiveType, number> = { eliminate: 0xc43d2f, retrieve: 0x7fc46a, rescue: 0x4aa8ff, hunt: 0xf2a93b, boss: 0xff30ff };
const Q = (v: number): number => Math.round(v * WQ);
/** Punkt świata (Q8) -> ekran z wysokością terenu. */
const scr = (p: WPos, up = 0): { x: number; y: number } => ({ x: scrX(p.x), y: scrY(Math.round(p.x), Math.round(p.z), up) });

export interface TravelSceneData {
  contract: Contract;
  /** Dev: wymuszone zdarzenie (id z EVENTS albo 'fauna_attack'), jak ?event= w Oldgame. */
  event?: string;
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
  private job!: Contract;
  private marker!: Phaser.GameObjects.Sprite;
  private route!: Route;
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
  private info!: PixelText;
  private buttons: Phaser.GameObjects.Container[] = [];
  private dust: Motes | null = null;
  private pulse: Phaser.GameObjects.Arc | null = null;
  private trail: Phaser.GameObjects.Graphics | null = null;
  private fires: ((t: number) => void)[] = [];
  private beacon: Phaser.GameObjects.Rectangle | null = null;
  private t = 0;
  private fauna: Beast[] = [];
  private backBtn: ReturnType<typeof button> | null = null;

  constructor() {
    super('TravelScene');
  }

  private forced: string | null = null;

  init(data: TravelSceneData): void {
    // dev: ?scene=TravelScene&contract=<id>&event=<id|fauna_attack>
    const q = new URLSearchParams(window.location.search);
    const dev = import.meta.env.DEV && q.get('scene') === 'TravelScene';
    const st = campaign.state;
    this.job = data?.contract ?? (dev ? (st.contracts.find((c) => c.id === q.get('contract')) ?? st.contracts[0]) : (undefined as unknown as Contract));
    this.forced = data?.event ?? (import.meta.env.DEV ? q.get('event') : null);
  }

  create(): void {
    enter(this);
    const st = campaign.state;
    if (!this.job || !st.party.length) {
      this.scene.start('HubScene');
      return;
    }
    this.state = 'idle';
    this.tick = 0;
    this.t = 0;
    this.buttons = [];
    this.fauna = [];
    this.fires = [];
    this.clock.reset();

    // krajobraz z wysokościami (w profilu Amiga: kafle <= 256 px)
    paintRegion(this, 'travel_map', BASE_W, BASE_H);
    tiledImage(this, 'travel_map');
    for (const f of regionFires()) this.fires.push(campfire(this, f.x, f.y, f.size, 2));
    const bp = beaconPos();
    this.beacon = this.add.rectangle(bp.x, bp.y, 2, 2, 0xff3020).setDepth(2);
    for (const s of SECTORS) {
      label(this, scrX(s.label.x), scrY(s.label.x, s.label.z), s.name, { size: 7, bold: true, color: s.color }).setOrigin(0.5, 0).setAlpha(0.9).setDepth(4);
      label(this, scrX(s.label.x), scrY(s.label.x, s.label.z) + 9, s.sub, { size: 5, color: 0xc9b890 }).setOrigin(0.5, 0).setDepth(4);
    }
    const home = scr(HOME);
    label(this, home.x, home.y + 13, 'PRZYSTAŃ', { size: 7, bold: true, color: PAL.amber }).setOrigin(0.5, 0).setDepth(4);

    // miejsca zleceń: stałe punkty w sektorach; trasy jak w Oldgame (autostrada + ulice, objazd miasta, kręte szlaki)
    const all = st.contracts.some((k) => k.id === this.job.id) ? st.contracts : [...st.contracts, this.job];
    const spots = contractSpots(all);
    const routes = new Map<string, Route>();
    all.forEach((c, i) => routes.set(c.id, buildRoute(spots.get(c.id) ?? sectorOf(c.biome).spots[0], c.biome, i)));
    this.route = routes.get(this.job.id)!;
    this.dur = routeTicks(this.route);

    // szlaki: inne zlecenia przygaszone, wybrana trasa pulsuje (rysowana od końca autostrady)
    const tracks = this.add.graphics().setDepth(2);
    for (const c of all) {
      if (c.id === this.job.id) continue;
      this.drawTrack(tracks, routes.get(c.id)!, 0x8a6a48, 0.8);
    }
    this.trail = this.add.graphics().setDepth(2);
    this.drawTrack(this.trail, this.route, 0xffc050, 1);

    for (const c of all) {
      const p = scr(spots.get(c.id)!);
      const col = TYPE_COLOR[c.type] ?? 0xffffff, target = c.id === this.job.id;
      this.add.rectangle(p.x, p.y - 7, 1, 14, 0x1c1c1c).setDepth(3);
      this.add.rectangle(p.x + 4, p.y - 11, 7, 5, col).setDepth(3).setAlpha(target ? 1 : 0.55);
      if (target) {
        this.pulse = this.add.circle(p.x, p.y, 6).setStrokeStyle(1, c.story ? 0xff30ff : PAL.amber).setDepth(3);
        const ty = Math.max(3, p.y - 26);
        const t = label(this, p.x, ty, (c.story ? '★ ' : '') + cut(c.title, 30), { size: 6, bold: true }).setOrigin(0.5, 0).setDepth(6);
        this.add.rectangle(p.x, ty + 4, t.displayWidth + 8, 10, 0x14100c, 0.92).setStrokeStyle(1, col).setDepth(5);
      }
    }

    const lead = st.party.find((c) => !c.conditions.dead && c.hp > 0) ?? st.party[0];
    this.pos = routePointAt(this.route, 0);
    const p0 = scr(this.pos);
    this.marker = addUnit(this, p0.x, p0.y, `pc_${lead.recruitId ?? lead.id}`, unitLookOf(lead)).setDepth(8);
    const ahead = routePointAt(this.route, Q(1.5));
    this.marker.setFlipX(ahead.x < this.pos.x);
    this.dust = new Motes(this, 90, { x: 0, y: 0, w: BASE_W, h: 232 }, 0xf0c080, 12, 1, 4, 0.35, 9);
    this.spawnFauna();

    // dolny pasek
    panel(this, 6, 236, BASE_W - 12, 30).setDepth(20);
    label(this, 12, 240, cut(this.job.title, 44), { size: 8, bold: true, color: PAL.amber }).setDepth(21);
    this.info = label(this, 12, 252, `${TYPE_NAMES[this.job.type]} · poz. ${this.job.level} · podróż: ${this.job.travelDays || 1} dn. · ${sectorOf(this.job.biome).name.toLowerCase()}`, { size: 6, color: PAL.dim }).setDepth(21);
    // "Zawróć" działa także w trakcie marszu (Oldgame/src/scenes/worldmap.js:264)
    const back = (this.backBtn = button(this, BASE_W - 190, 243, '◀ Wróć do Przystani', () => this.state !== 'event' && goto(this, 'HubScene'), { w: 96, size: 6.5 }));
    const go = button(this, BASE_W - 88, 241, 'Wyrusz ▶', () => this.depart(), { primary: true, w: 76, h: 20, size: 8 });
    back.box.setDepth(21);
    this.buttons = [go.box.setDepth(21)];
    this.input.keyboard?.on('keydown-ENTER', () => this.depart());

    SoundManager.music('wastes');
    SoundManager.ambience('wind');
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
    if (this.state !== 'idle') return;
    this.state = 'moving';
    for (const b of this.buttons) b.setVisible(false);
    const forced = this.forced;
    this.event = forced ? (forced === 'fauna_attack' ? null : EVENTS.find((e) => e.id === forced) ?? null) : rollTravelEvent();
    this.eventTick = this.event ? Math.floor((this.dur * (55 + Math.floor(Math.random() * 26))) / 100) : -1;
    const ambush = forced === 'fauna_attack' || (!forced && Math.random() < FAUNA_CHANCE);
    this.ambushTick = ambush && this.fauna.some((f) => !f.dead) ? Math.floor((this.dur * (18 + Math.floor(Math.random() * 26))) / 100) : -1;
    this.backBtn?.setLabel('◀ Zawróć');
    this.info.setText(`Wyruszacie: ${cut(this.job.title, 40)}`);
    this.marker.play(this.marker.anims.currentAnim!.key.replace('_idle', '_walk'));
    SoundManager.sfx('click');
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
    if (this.state !== 'moving') {
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
      this.info.setText('Jesteście na miejscu.');
      this.backBtn?.box.setVisible(false);
      SoundManager.sfx('door');
      SoundManager.ambience(null);
      goto(this, 'WorldScene', { contract: this.job }, 600);
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
      const hintText = ch.skill && who ? `${SKILLS[ch.skill].name} ${getStat(who, ch.skill) >= 0 ? '+' : ''}${getStat(who, ch.skill)} (${shortName(who.name)}) vs ST ${choiceDC(ch, this.job)}` : 'bez testu';
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
    const res = resolveEventChoice(campaign.state, this.job, choice);
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
    this.info.setText('W drodze...').setColor(hex(PAL.dim));
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
    const r = this.route, spots = [...contractSpots(campaign.state.contracts).values()];
    const far = (x: number, z: number, px: number, pz: number, min: number): boolean => (x - px) ** 2 + (z - pz) ** 2 > (min * WQ) ** 2;
    for (let i = 0; i < 5; i++) {
      let x = 0, z = 0;
      for (let t = 0; t < 60; t++) {
        x = Q(-26 + Math.random() * 56);
        z = Q(-14 + Math.random() * 30);
        if (heightQ8(x, z) >= Q(1.2) || !far(x, z, HOME.x, HOME.z, 6) || !spots.every((s) => far(x, z, s.x, s.z, 3))) continue;
        let ok = true;
        for (let k = 0; k < r.n && ok; k += 4) ok = far(x, z, r.x[k], r.z[k], 4);
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
    this.info.setText(`Uwaga! Zmutowany ${f.name} szarżuje na drużynę!`).setColor(hex(PAL.bad));
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
