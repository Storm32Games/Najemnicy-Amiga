import Phaser from 'phaser';
import type { PixelText } from './ui/BitmapFont';
import { SoundManager } from '../audio/SoundManager';
import { TYPE_NAMES } from '../core/campaign/contracts';
import { FAUNA_CHANCE, FAUNA_KINDS, EVENTS, faunaAttackEvent, type EventChoice, type TravelEvent } from '../core/campaign/events';
import { campaign } from '../core/campaign/session';
import type { Contract } from '../core/campaign/state';
import { bestForChoice, choiceDC, resolveEventChoice, rollTravelEvent } from '../core/campaign/travel';
import { shortName } from '../core/data/names';
import { DEGREE_NAMES, SKILLS } from '../core/data/rules';
import type { Biome } from '../core/tactical/mapgen';
import type { ObjectiveType } from '../core/tactical/mission';
import { getStat } from '../core/rules/stats';
import { ENEMIES } from '../core/data/enemies';
import type { EnemyShape } from '../core/data/types';
import { paintCreatureSheet } from './iso/CreatureArt';
import { ArtBook } from './iso/IsoArt';
import { addUnit, unitLookOf } from './iso/UnitLooks';
import { BASE_H, BASE_W, Motes, PAL, button, canvasTexture, cut, enter, goto, hex, label, panel, parseColor, seeded } from './ui/Kit';
import { openWindow } from './ui/Widgets';

// Mapa regionu i podróż na miejsce zlecenia (port Oldgame/src/scenes/worldmap.js + meta/worldterrain.js).
// Krajobraz 3D zastąpiony mapą malowaną z góry; zdarzenia w drodze rozstrzyga src/core/campaign/travel.ts.

/** Współrzędne świata ze starej mapy (x: zachód-wschód, z: północ-południe) -> piksele projektowe. */
const sx = (x: number): number => Math.round(232 + x * 7.4);
const sy = (z: number): number => Math.round(112 + z * 5.6);

const HOME = { x: -17, z: 8 };
const SECTORS: { id: Biome; name: string; sub: string; color: number; x: number; z: number; rx: number; rz: number; label: [number, number]; spots: [number, number][] }[] = [
  { id: 'ruins', name: 'RUINY MIASTA', sub: 'sektor miejski', color: 0xf2a93b, x: 2.5, z: 2, rx: 14.1, rz: 10.7, label: [2.5, 13.8], spots: [[-3, -2], [7.5, 5], [1, 7.5], [9, -3.5], [-6, 5]] },
  { id: 'wastes', name: 'PUSTKOWIA', sub: 'wydmy i obóz Nomadów', color: 0xd8c090, x: 24, z: 11, rx: 7.2, rz: 7.6, label: [24, 17.8], spots: [[21.5, 11.5], [27.5, 7.5], [20.5, 15], [27, 14], [23.5, 5.6]] },
  { id: 'industrial', name: 'STREFA PRZEMYSŁOWA', sub: 'fabryki i krater', color: 0xe0703a, x: 15, z: -12, rx: 8.6, rz: 4.4, label: [24, -17.4], spots: [[10.5, -14.2], [18.5, -10.6], [14.5, -9.6], [20.5, -13.6]] },
  { id: 'bunker', name: 'GÓRY · BUNKIER', sub: 'schrony w skałach', color: 0x6ab0ff, x: -15, z: -11, rx: 9, rz: 5.2, label: [-15, -17.4], spots: [[-13, -7.6], [-19.5, -8.2], [-9, -10.2], [-16.5, -12.5]] },
];
const TYPE_COLOR: Record<ObjectiveType, number> = { eliminate: 0xc43d2f, retrieve: 0x7fc46a, rescue: 0x4aa8ff, hunt: 0xf2a93b, boss: 0xff30ff };

export interface TravelSceneData {
  contract: Contract;
  /** Dev: wymuszone zdarzenie (id z EVENTS albo 'fauna_attack'), jak ?event= w Oldgame. */
  event?: string;
}

/** Zmutowana bestia krążąca po mapie regionu. */
interface Beast {
  sprite: Phaser.GameObjects.Sprite;
  name: string;
  home: { x: number; y: number };
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
  private from = { x: 0, y: 0 };
  private to = { x: 0, y: 0 };
  private k = 0;
  private state: 'idle' | 'moving' | 'event' | 'arrived' = 'idle';
  private eventAt = -1;
  private event: TravelEvent | null = null;
  private stepT = 0;
  private info!: PixelText;
  private buttons: Phaser.GameObjects.Container[] = [];
  private dust: Motes | null = null;
  private pulse: Phaser.GameObjects.Arc | null = null;
  private t = 0;
  /** Czas całej podróży w s (Oldgame: max(6 s, długość trasy / 4.2)). */
  private dur = 6;
  private ambushAt = -1;
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
    this.k = 0;
    this.t = 0;
    this.buttons = [];
    this.fauna = [];

    this.paintMap();
    this.add.image(0, 0, 'travel_map').setOrigin(0);
    for (const s of SECTORS) {
      label(this, sx(s.label[0]), sy(s.label[1]), s.name, { size: 7, bold: true, color: s.color }).setOrigin(0.5, 0).setAlpha(0.9);
      label(this, sx(s.label[0]), sy(s.label[1]) + 9, s.sub, { size: 5, color: 0xc9b890 }).setOrigin(0.5, 0);
    }
    label(this, sx(HOME.x), sy(HOME.z) + 9, 'PRZYSTAŃ', { size: 7, bold: true, color: PAL.amber }).setOrigin(0.5, 0);

    // znaczniki zleceń: stałe miejsca w sektorze, cel podświetlony
    const used: Partial<Record<Biome, number>> = {};
    const pts = new Map<string, { x: number; y: number }>();
    for (const c of st.contracts) {
      const sec = SECTORS.find((q) => q.id === c.biome) ?? SECTORS[0];
      const n = (used[c.biome] = (used[c.biome] ?? 0) + 1);
      const spot = sec.spots[(n - 1) % sec.spots.length];
      pts.set(c.id, { x: sx(spot[0]), y: sy(spot[1]) });
    }
    if (!pts.has(this.job.id)) {
      const sec = SECTORS.find((q) => q.id === this.job.biome) ?? SECTORS[0];
      pts.set(this.job.id, { x: sx(sec.spots[0][0]), y: sy(sec.spots[0][1]) });
    }
    this.from = { x: sx(HOME.x) + 10, y: sy(HOME.z) + 4 };
    this.to = pts.get(this.job.id)!;

    const route = this.add.graphics().setDepth(2);
    const len = Phaser.Math.Distance.Between(this.from.x, this.from.y, this.to.x, this.to.y);
    for (let d = 0; d < len; d += 6) {
      const k = d / len;
      route.fillStyle(0xf2a93b, 0.75).fillRect(Math.round(this.from.x + (this.to.x - this.from.x) * k), Math.round(this.from.y + (this.to.y - this.from.y) * k), 2, 2);
    }
    for (const c of st.contracts.some((k) => k.id === this.job.id) ? st.contracts : [...st.contracts, this.job]) {
      const p = pts.get(c.id)!;
      const col = TYPE_COLOR[c.type] ?? 0xffffff, target = c.id === this.job.id;
      this.add.rectangle(p.x, p.y - 7, 1, 14, 0x1c1c1c).setDepth(3);
      this.add.rectangle(p.x + 4, p.y - 11, 7, 5, col).setDepth(3).setAlpha(target ? 1 : 0.55);
      if (target) {
        this.pulse = this.add.circle(p.x, p.y, 6).setStrokeStyle(1, c.story ? 0xff30ff : PAL.amber).setDepth(3);
        const t = label(this, p.x, p.y - 26, (c.story ? '★ ' : '') + cut(c.title, 30), { size: 6, bold: true }).setOrigin(0.5, 0).setDepth(6);
        this.add.rectangle(p.x, p.y - 22, t.displayWidth + 8, 10, 0x14100c, 0.92).setStrokeStyle(1, col).setDepth(5);
      }
    }

    const lead = st.party.find((c) => !c.conditions.dead && c.hp > 0) ?? st.party[0];
    this.marker = addUnit(this, this.from.x, this.from.y, `pc_${lead.recruitId ?? lead.id}`, unitLookOf(lead)).setDepth(8);
    this.marker.setFlipX(this.to.x < this.from.x);
    this.dust = new Motes(this, 90, { x: 0, y: 0, w: BASE_W, h: 232 }, 0xf0c080, 12, 1, 4, 0.35, 9);
    this.dur = Math.max(6, len / 7.4 / 4.2);
    this.spawnFauna();

    // dolny pasek
    panel(this, 6, 236, BASE_W - 12, 30).setDepth(20);
    label(this, 12, 240, cut(this.job.title, 44), { size: 8, bold: true, color: PAL.amber }).setDepth(21);
    this.info = label(this, 12, 252, `${TYPE_NAMES[this.job.type]} · poz. ${this.job.level} · podróż: ${this.job.travelDays || 1} dn.`, { size: 6, color: PAL.dim }).setDepth(21);
    // "Zawróć" działa także w trakcie marszu (Oldgame/src/scenes/worldmap.js:264)
    const back = (this.backBtn = button(this, BASE_W - 190, 243, '◀ Wróć do Przystani', () => this.state !== 'event' && goto(this, 'HubScene'), { w: 96, size: 6.5 }));
    const go = button(this, BASE_W - 88, 241, 'Wyrusz ▶', () => this.depart(), { primary: true, w: 76, h: 20, size: 8 });
    back.box.setDepth(21);
    this.buttons = [go.box.setDepth(21)];
    this.input.keyboard?.on('keydown-ENTER', () => this.depart());

    SoundManager.music('wastes');
    SoundManager.ambience('wind');
  }

  /** Mapa regionu z góry: piasek, miasto w siatce ulic, wydmy, fabryki z kraterem, góry z bunkrami, Przystań. */
  private paintMap(): void {
    canvasTexture(this, 'travel_map', BASE_W, BASE_H, (g, w, h) => {
      const r = seeded(77);
      g.fillStyle = '#8a6a44';
      g.fillRect(0, 0, w, h);
      for (let i = 0; i < 2600; i++) {
        g.fillStyle = r() < 0.5 ? '#94734a' : '#7c5e3c';
        g.fillRect(Math.floor(r() * w), Math.floor(r() * h), 1 + Math.floor(r() * 2), 1);
      }
      const blob = (cx: number, cy: number, rx: number, ry: number, col: string, n = 1): void => {
        g.fillStyle = col;
        for (let i = 0; i < n; i++) {
          g.beginPath();
          g.ellipse(cx + (r() - 0.5) * rx * 0.5 * (n > 1 ? 1 : 0), cy + (r() - 0.5) * ry * 0.5 * (n > 1 ? 1 : 0), rx * (n > 1 ? 0.6 + r() * 0.4 : 1), ry * (n > 1 ? 0.6 + r() * 0.4 : 1), 0, 0, Math.PI * 2);
          g.fill();
        }
      };
      // pustkowia: jasne wydmy
      const W = SECTORS[1];
      blob(sx(W.x), sy(W.z), W.rx * 7.4, W.rz * 5.6, '#b89460', 5);
      for (let i = 0; i < 40; i++) {
        const x = sx(W.x) + (r() - 0.5) * W.rx * 14, y = sy(W.z) + (r() - 0.5) * W.rz * 10;
        g.fillStyle = '#d0ac74';
        g.fillRect(x, y, 6 + r() * 8, 1);
        g.fillStyle = '#967448';
        g.fillRect(x + 2, y + 1, 6 + r() * 8, 1);
      }
      for (const [x, y] of [[sx(22), sy(11)], [sx(24), sy(12)], [sx(23), sy(9.6)]]) {
        g.fillStyle = '#6a3c22';
        g.beginPath();
        g.moveTo(x - 4, y + 3);
        g.lineTo(x, y - 4);
        g.lineTo(x + 4, y + 3);
        g.fill();
      }
      // góry z bunkrami
      const B = SECTORS[3];
      blob(sx(B.x), sy(B.z), B.rx * 7.4, B.rz * 5.6, '#5a5650', 5);
      for (let i = 0; i < 26; i++) {
        const x = sx(B.x) + (r() - 0.5) * B.rx * 13, y = sy(B.z) + (r() - 0.5) * B.rz * 9, s = 5 + r() * 8;
        g.fillStyle = '#44403c';
        g.beginPath();
        g.moveTo(x - s, y + s * 0.6);
        g.lineTo(x, y - s);
        g.lineTo(x + s, y + s * 0.6);
        g.fill();
        g.fillStyle = '#8a8680';
        g.beginPath();
        g.moveTo(x - s * 0.35, y - s * 0.4);
        g.lineTo(x, y - s);
        g.lineTo(x + s * 0.2, y - s * 0.5);
        g.fill();
      }
      // strefa przemysłowa + krater
      const I = SECTORS[2];
      blob(sx(I.x), sy(I.z), I.rx * 7.4, I.rz * 5.6, '#5c4a3c', 4);
      for (let i = 0; i < 16; i++) {
        const x = sx(I.x) + (r() - 0.5) * I.rx * 12, y = sy(I.z) + (r() - 0.5) * I.rz * 8, bw = 8 + r() * 12, bh = 5 + r() * 6;
        g.fillStyle = '#3a3230';
        g.fillRect(x, y, bw, bh);
        g.fillStyle = '#4c4440';
        g.fillRect(x, y, bw, 2);
        if (r() < 0.5) {
          g.fillStyle = '#2a2422';
          g.fillRect(x + 2, y - 5, 2, 6);
          g.fillStyle = 'rgba(160,150,140,0.5)';
          g.fillRect(x + 1, y - 8, 4, 3);
        }
      }
      g.fillStyle = '#2c2420';
      g.beginPath();
      g.ellipse(sx(19.5), sy(-6), 13, 8, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#6fae3c';
      g.beginPath();
      g.ellipse(sx(19.5), sy(-6), 7, 4, 0, 0, Math.PI * 2);
      g.fill();
      // ruiny miasta: siatka ulic i kwartały
      const C = SECTORS[0];
      blob(sx(C.x), sy(C.z), C.rx * 7.4, C.rz * 5.6, '#4a4640', 1);
      const cell = 13;
      for (let gy = -5; gy <= 5; gy++)
        for (let gx = -8; gx <= 8; gx++) {
          const x = sx(C.x) + gx * cell, y = sy(C.z) + gy * (cell - 3);
          const dx = (x - sx(C.x)) / (C.rx * 7.4), dy = (y - sy(C.z)) / (C.rz * 5.6);
          if (dx * dx + dy * dy > 0.86 || r() < 0.12) continue;
          const v = 44 + Math.floor(r() * 26);
          g.fillStyle = `rgb(${v + 8},${v + 4},${v})`;
          g.fillRect(x - 5, y - 4, 10, 7);
          g.fillStyle = `rgb(${v + 26},${v + 22},${v + 16})`;
          g.fillRect(x - 5, y - 4, 10, 2);
          if (r() < 0.3) {
            g.fillStyle = '#2a2622';
            g.fillRect(x - 5 + Math.floor(r() * 6), y - 2, 4, 4);
          }
        }
      // roślinność pustkowi (Oldgame/src/gfx/flora.js w skali mapy): suche krzaki, martwe drzewa, kaktusy, trawy
      const fr = seeded(31);
      const nearSector = (x: number, y: number): boolean => SECTORS.some((q) => ((x - sx(q.x)) / (q.rx * 7.4)) ** 2 + ((y - sy(q.z)) / (q.rz * 5.6)) ** 2 < 1.1);
      for (let i = 0; i < 140; i++) {
        const x = Math.round(fr() * w), y = Math.round(10 + fr() * (h - 50));
        if (nearSector(x, y) || Math.hypot(x - sx(HOME.x), y - sy(HOME.z)) < 22) continue;
        const kind = fr();
        if (kind < 0.4) {
          // kępa suchej trawy
          g.fillStyle = fr() < 0.5 ? '#a08a4a' : '#7a6a38';
          for (let k = 0; k < 4; k++) g.fillRect(x + k - 2, y - (k % 2 ? 3 : 2), 1, k % 2 ? 3 : 2);
        } else if (kind < 0.7) {
          // krzak
          g.fillStyle = '#4a4a2a';
          g.fillRect(x - 2, y - 2, 5, 2);
          g.fillStyle = fr() < 0.3 ? '#6a7a3a' : '#5a5232';
          g.fillRect(x - 1, y - 3, 3, 2);
        } else if (kind < 0.88) {
          // martwe drzewo
          g.fillStyle = '#3a2a1e';
          g.fillRect(x, y - 7, 1, 7);
          g.fillRect(x - 2, y - 6, 2, 1);
          g.fillRect(x + 1, y - 5, 2, 1);
          g.fillRect(x - 3, y - 7, 1, 1);
          g.fillStyle = 'rgba(0,0,0,0.25)';
          g.fillRect(x + 1, y, 4, 1);
        } else {
          // kaktus / zmutowany sukulent
          g.fillStyle = fr() < 0.5 ? '#5a7a3a' : '#7a8a4a';
          g.fillRect(x, y - 5, 2, 5);
          g.fillRect(x - 2, y - 4, 1, 2);
          g.fillRect(x - 1, y - 3, 1, 1);
          g.fillRect(x + 2, y - 3, 1, 1);
          g.fillRect(x + 3, y - 4, 1, 2);
          if (fr() < 0.3) {
            g.fillStyle = '#c8ff60';
            g.fillRect(x, y - 6, 1, 1);
          }
        }
      }
      // Przystań: mur, hala, światła
      const hx = sx(HOME.x), hy = sy(HOME.z);
      g.fillStyle = '#38322c';
      g.fillRect(hx - 13, hy - 9, 26, 18);
      g.fillStyle = '#6a5a48';
      g.fillRect(hx - 11, hy - 7, 22, 14);
      g.fillStyle = '#4a3a30';
      g.fillRect(hx - 8, hy - 5, 16, 8);
      g.fillStyle = '#ffc860';
      for (const [dx, dy] of [[-12, -8], [11, -8], [-12, 7], [11, 7], [-2, 3]]) g.fillRect(hx + dx, hy + dy, 2, 2);
      // winieta
      const grad = g.createRadialGradient(w / 2, h / 2, h * 0.35, w / 2, h / 2, h * 0.95);
      grad.addColorStop(0, 'rgba(0,0,0,0)');
      grad.addColorStop(1, 'rgba(20,8,4,0.6)');
      g.fillStyle = grad;
      g.fillRect(0, 0, w, h);
    });
  }

  private depart(): void {
    if (this.state !== 'idle') return;
    this.state = 'moving';
    for (const b of this.buttons) b.setVisible(false);
    const forced = this.forced;
    this.event = forced ? (forced === 'fauna_attack' ? null : EVENTS.find((e) => e.id === forced) ?? null) : rollTravelEvent();
    this.eventAt = this.event ? 0.55 + Math.random() * 0.25 : -1;
    const ambush = forced === 'fauna_attack' || (!forced && Math.random() < FAUNA_CHANCE);
    this.ambushAt = ambush && this.fauna.some((f) => !f.dead) ? 0.18 + Math.random() * 0.25 : -1;
    this.backBtn?.setLabel('◀ Zawróć');
    this.info.setText(`Wyruszacie: ${cut(this.job.title, 40)}`);
    this.marker.play(this.marker.anims.currentAnim!.key.replace('_idle', '_walk'));
    SoundManager.sfx('click');
  }

  update(_time: number, delta: number): void {
    const dt = Math.min(delta / 1000, 0.1);
    this.t += dt;
    this.dust?.update(dt);
    this.pulse?.setScale(1 + 0.25 * Math.sin(this.t * 4));
    this.updateFauna(dt);
    if (this.state !== 'moving') return;
    const before = this.k;
    this.k = Math.min(1, this.k + dt / this.dur);
    this.marker.setPosition(this.from.x + (this.to.x - this.from.x) * this.k, this.from.y + (this.to.y - this.from.y) * this.k);
    this.stepT += dt;
    if (this.stepT > 0.3) {
      this.stepT = 0;
      SoundManager.sfx('step', { vol: 0.3 });
    }
    if (this.ambushAt >= 0 && before < this.ambushAt && this.k >= this.ambushAt) {
      this.ambushAt = -1;
      if (this.startAmbush()) return;
    }
    if (this.event && before < this.eventAt && this.k >= this.eventAt) {
      this.state = 'event';
      this.marker.play(this.marker.anims.currentAnim!.key.replace('_walk', '_idle'));
      this.showEvent(this.event);
      return;
    }
    if (this.k >= 1) {
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

  /** 5 bestii z dala od Przystani, celów i trasy. */
  private spawnFauna(): void {
    const distToRoute = (x: number, y: number): number => {
      const dx = this.to.x - this.from.x, dy = this.to.y - this.from.y, l2 = dx * dx + dy * dy || 1;
      const k = Phaser.Math.Clamp(((x - this.from.x) * dx + (y - this.from.y) * dy) / l2, 0, 1);
      return Math.hypot(x - (this.from.x + dx * k), y - (this.from.y + dy * k));
    };
    for (let i = 0; i < 5; i++) {
      let x = 0, y = 0;
      for (let t = 0; t < 60; t++) {
        x = 30 + Math.random() * (BASE_W - 60);
        y = 24 + Math.random() * 190;
        if (Math.hypot(x - this.from.x, y - this.from.y) > 40 && distToRoute(x, y) > 28) break;
      }
      const kind = FAUNA_KINDS[Math.floor(Math.random() * FAUNA_KINDS.length)];
      this.fauna.push({ sprite: this.beastSprite(kind.templateId, i, x, y), name: kind.name, home: { x, y }, wait: Math.random() * 3, dead: false, busy: false });
    }
  }

  /** Bestie spacerują wokół legowiska. */
  private updateFauna(dt: number): void {
    for (const f of this.fauna) {
      if (f.dead || f.busy) continue;
      f.wait -= dt;
      if (f.wait > 0) continue;
      f.wait = 1.5 + Math.random() * 4;
      const a = Math.random() * Math.PI * 2, r = 6 + Math.random() * 16;
      const tx = f.home.x + Math.cos(a) * r, ty = f.home.y + Math.sin(a) * r * 0.7;
      const name = f.sprite.getData('anim') as string;
      f.busy = true;
      f.sprite.setFlipX(tx < f.sprite.x).play(`${name}_walk`);
      this.tweens.add({ targets: f.sprite, x: tx, y: ty, duration: Math.hypot(tx - f.sprite.x, ty - f.sprite.y) * 90, onComplete: () => {
        f.busy = false;
        if (!f.dead) f.sprite.play(`${name}_idle`);
      } });
    }
  }

  /** Najbliższa bestia szarżuje na drużynę, potem zdarzenie walka / odstraszenie / ucieczka. */
  private startAmbush(): boolean {
    const m = this.marker;
    const live = this.fauna.filter((f) => !f.dead);
    if (!live.length) return false;
    const f = live.reduce((a, b) => (Phaser.Math.Distance.Between(a.sprite.x, a.sprite.y, m.x, m.y) <= Phaser.Math.Distance.Between(b.sprite.x, b.sprite.y, m.x, m.y) ? a : b));
    this.tweens.killTweensOf(f.sprite);
    f.busy = true;
    if (Phaser.Math.Distance.Between(f.sprite.x, f.sprite.y, m.x, m.y) > 60) {
      const a = Math.random() * Math.PI * 2;
      f.sprite.setPosition(m.x + Math.cos(a) * 44, m.y + Math.sin(a) * 30);
    }
    this.state = 'event';
    m.play(m.anims.currentAnim!.key.replace('_walk', '_idle'));
    this.info.setText(`Uwaga! Zmutowany ${f.name} szarżuje na drużynę!`).setColor(hex(PAL.bad));
    SoundManager.sfx('growl');
    const name = f.sprite.getData('anim') as string;
    f.sprite.setFlipX(m.x < f.sprite.x).play(`${name}_walk`);
    this.tweens.add({ targets: f.sprite, x: m.x + (f.sprite.x < m.x ? -8 : 8), y: m.y, duration: 700, onComplete: () => {
      SoundManager.sfx('hit');
      this.cameras.main.shake(140, 0.004);
      this.showEvent(faunaAttackEvent(f.name), (choice, degree) => {
        if (choice === 0 && degree >= 2) {
          f.dead = true;
          f.sprite.anims.stop();
          this.tweens.add({ targets: f.sprite, angle: f.sprite.flipX ? 90 : -90, alpha: 0.5, duration: 300 });
        } else {
          const ax = f.sprite.x + (f.sprite.x < m.x ? -80 : 80), ay = f.sprite.y + (Math.random() - 0.5) * 60;
          f.sprite.setFlipX(ax < f.sprite.x);
          this.tweens.add({ targets: f.sprite, x: ax, y: ay, alpha: 0, duration: 1600, onComplete: () => (f.dead = true) });
        }
      });
    } });
    return true;
  }
}
