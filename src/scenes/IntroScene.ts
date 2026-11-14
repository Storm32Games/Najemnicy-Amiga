import Phaser from 'phaser';
import { SoundManager } from '../audio/SoundManager';
import { RECRUITS } from '../core/data/recruits';
import { INTRO_SLIDES, type IntroSlideId } from '../core/data/story';
import { addUnit, raiderLook, unitLookOf } from './iso/UnitLooks';
import {
  BASE_H, BASE_W, type Ctx2D, Motes, PAL, type Stops, Typewriter, type UiButton, button, campfire, canvasTexture, dunes, enter, goto, label, panel, seeded,
  skyGradient, skyline,
} from './ui/Kit';

// Wprowadzenie do świata (port Oldgame/src/scenes/intro.js): 6 animowanych plansz + narracja pisana "na maszynie".
// Dioramy Three.js zastąpione pixel-artowymi scenkami 2D: tło malowane raz na płótnie, ruchome elementy jako obiekty.

type Updater = (t: number, dt: number) => void;

const D_FLASH = 20;
const D_UI = 30;

export class IntroScene extends Phaser.Scene {
  private index = 0;
  private t = 0;
  private waited = 0;
  private switching = false;
  private slideObjects: Phaser.GameObjects.GameObject[] = [];
  private updaters: Updater[] = [];
  private tw: Typewriter | null = null;
  private text!: Phaser.GameObjects.Text;
  private dots!: Phaser.GameObjects.Text;
  private flash!: Phaser.GameObjects.Rectangle;
  private next!: UiButton;
  private boomed = false;

  constructor() {
    super('IntroScene');
  }

  create(): void {
    enter(this, 700);
    this.cameras.main.setBackgroundColor(0x000000);
    this.slideObjects = [];
    this.updaters = [];
    this.switching = false;

    this.flash = this.add.rectangle(0, 0, BASE_W, BASE_H, 0xffffff, 1).setOrigin(0).setAlpha(0).setDepth(D_FLASH);
    panel(this, 38, 204, 404, 54, PAL.edge, 0.87).setDepth(D_UI);
    this.text = label(this, 46, 209, '', { size: 8, wrap: 316, lineSpacing: 2 }).setDepth(D_UI + 1);
    this.next = button(this, 376, 222, 'Dalej ▶', () => this.advance(), { primary: true, w: 58 });
    this.next.box.setDepth(D_UI + 1);
    this.dots = label(this, BASE_W / 2, 264, '', { size: 5, color: PAL.dim }).setOrigin(0.5).setDepth(D_UI + 1);
    button(this, BASE_W - 84, 6, 'Pomiń intro ▶▶', () => this.finish(), { w: 78, size: 6 }).box.setDepth(D_UI + 1);

    this.input.on('pointerdown', () => this.advance());
    const kb = this.input.keyboard;
    kb?.on('keydown-ESC', () => this.finish());
    for (const k of ['ENTER', 'SPACE', 'RIGHT']) kb?.on(`keydown-${k}`, () => this.advance());

    this.show(0);
    SoundManager.music('intro');
  }

  private show(n: number): void {
    for (const o of this.slideObjects) o.destroy();
    this.slideObjects = [];
    this.updaters = [];
    this.index = n;
    this.t = 0;
    this.waited = 0;
    this.boomed = false;
    this.flash.setAlpha(0);

    const before = new Set(this.children.list);
    this.build(INTRO_SLIDES[n].id);
    this.slideObjects = this.children.list.filter((o) => !before.has(o));
    for (const u of this.updaters) u(0, 0.016);

    this.tw = new Typewriter(this.text, INTRO_SLIDES[n].text, 34);
    this.dots.setText(INTRO_SLIDES.map((_, k) => (k === n ? '◆' : '◇')).join('  '));
  }

  private advance(): void {
    if (this.switching || this.data.get('leaving')) return;
    if (this.tw && !this.tw.done) {
      this.tw.finish();
      return;
    }
    if (this.index + 1 >= INTRO_SLIDES.length) {
      this.finish();
      return;
    }
    this.switching = true;
    const cam = this.cameras.main;
    cam.fadeOut(450, 0, 0, 0);
    this.time.delayedCall(480, () => {
      this.show(this.index + 1);
      cam.fadeIn(650, 0, 0, 0);
      this.switching = false;
    });
  }

  private finish(): void {
    if (this.switching) return;
    goto(this, 'TitleScene');
  }

  update(_time: number, delta: number): void {
    const dt = Math.min(delta / 1000, 0.1);
    this.t += dt;
    this.tw?.update(dt);
    for (const u of this.updaters) u(this.t, dt);
    if (this.tw?.done && !this.switching && !this.data.get('leaving')) {
      this.waited += dt;
      if (this.waited > 4.5) this.advance();
    }
  }

  // ================================================================== plansze

  private bg(key: string, draw: (g: Ctx2D, w: number, h: number) => void): Phaser.GameObjects.Image {
    return this.add.image(0, 0, canvasTexture(this, key, BASE_W, BASE_H, draw)).setOrigin(0).setDepth(0);
  }

  private build(id: IntroSlideId): void {
    switch (id) {
      case 'bomb': return this.buildBomb();
      case 'ruins': return this.buildRuins();
      case 'raiders': return this.buildRaiders();
      case 'nomads': return this.buildNomads();
      case 'haven': return this.buildHaven();
      case 'crew': return this.buildCrew();
    }
  }

  /** 1 - rakiety, błysk i grzyb atomowy nad miastem. */
  private buildBomb(): void {
    const sky: Stops = [[0, '#1a2038'], [0.5, '#6a4a5a'], [0.85, '#e0905a'], [1, '#f2c27a']];
    this.bg('intro_bomb', (g, w, h) => {
      skyGradient(g, w, 200, sky);
      skyline(g, w, seeded(11), { n: 40, base: 196, hMin: 24, hMax: 104, color: '#2a1f1c', lit: '#ffb84a' });
      skyline(g, w, seeded(12), { n: 26, base: 202, hMin: 10, hMax: 46, color: '#1d1512', lit: '#ffb84a', wMin: 10, wMax: 26 });
      dunes(g, w, h, 200, 2, '#3a2a20', 4);
    });
    const BOOM = 2.6, cx = 262, gy = 198;
    const cloud = this.add.graphics().setDepth(2);
    const missiles = [0, 1, 2].map((i) => ({
      sx: 420 - i * 70, sy: -20 - i * 20, ex: 180 + i * 62, ey: 190, d: 0.12 + i * 0.09,
      head: this.add.rectangle(0, 0, 2, 3, 0xffeecc).setDepth(3),
      trail: Array.from({ length: 14 }, (_, j) => this.add.rectangle(0, 0, 2, 2, j < 4 ? 0xffc060 : 0x8a7a70).setDepth(3)),
    }));
    this.updaters.push((t) => {
      for (const m of missiles) {
        const u = Math.min(1, Math.max(0, (t - m.d) / 2.2));
        const vis = u > 0 && u < 1 && t < BOOM;
        const pos = (uu: number): [number, number] => [m.sx + (m.ex - m.sx) * uu, m.sy + (m.ey - m.sy) * uu];
        m.head.setVisible(vis).setPosition(...pos(u));
        m.trail.forEach((b, j) => {
          const uu = u - (j + 1) * 0.016;
          b.setVisible(vis && uu > 0);
          if (b.visible) b.setPosition(...pos(uu)).setAlpha(1 - j / 16);
        });
      }
      const k = Math.max(0, t - BOOM), grow = 1 - Math.exp(-k * 0.45);
      cloud.clear();
      if (t > BOOM) {
        const h = 120 * grow;
        const sw = 8 + grow * 8;
        cloud.fillStyle(0xc43d1a, 1).fillRect(cx - sw / 2, gy - h, sw, h);
        cloud.fillStyle(0x8a2a14, 1).fillRect(cx + sw / 2 - 3, gy - h, 3, h);
        const r = 14 + 38 * grow;
        for (let i = 0; i < 7; i++) {
          const a = (i / 7) * Math.PI * 2 + k * 0.1;
          cloud.fillStyle(i % 2 ? 0xff8a30 : 0xc43d1a, 1).fillEllipse(cx + Math.cos(a) * r, gy - h + 4 + Math.sin(a * 2) * 3, (20 + 26 * grow) * 1.3, 14 + 14 * grow);
        }
        cloud.fillStyle(0x5a4a44, 1).fillEllipse(cx, gy - h - 6 * grow, 44 + 62 * grow, 18 + 16 * grow);
        cloud.fillStyle(0xffc860, 1).fillEllipse(cx, gy - 1, 30 + 60 * grow, 5);
        if (k < 3) cloud.lineStyle(2, 0xffe0a0, Math.max(0, 0.9 - k * 0.3)).strokeEllipse(cx, gy - 2, 20 + k * 220, 4 + k * 26);
      }
      this.flash.setAlpha(t > BOOM ? Math.max(0, 1 - (t - BOOM) * 1.1) : 0);
      if (t > BOOM && !this.boomed) {
        this.boomed = true;
        SoundManager.sfx('explosion');
        this.cameras.main.shake(1400, 0.004);
      }
    });
  }

  /** 2 - zrujnowane miasto w zielonej mgle: ulica w perspektywie, ślepia w cieniu, opadający popiół. */
  private buildRuins(): void {
    const VX = 240, VY = 128, F = 46;
    const img = this.bg('intro_ruins', (g, w, h) => {
      skyGradient(g, w, h, [[0, '#0f1a14'], [0.6, '#2d4030'], [1, '#4f6a46']]);
      const rnd = seeded(21);
      const fog = [63, 96, 69], near = [26, 32, 24];
      for (let i = 17; i >= 0; i--) {
        const z = 1.1 + i * 0.75;
        const k = Math.min(1, i / 12);
        const col = near.map((c, j) => Math.round(c + (fog[j] - c) * k));
        for (const side of [-1, 1]) {
          const bw = 4 + rnd() * 5, bh = 8 + rnd() * 26, X = side * (5.5 + rnd() * 3);
          const x0 = VX + (X * F) / z, x1 = VX + ((X + side * bw) * F) / z;
          const yb = VY + (2.2 * F) / z, yt = VY - ((bh - 2.2) * F) / z;
          const L = Math.round(Math.min(x0, x1)), R = Math.round(Math.max(x0, x1));
          g.fillStyle = `rgb(${col})`;
          g.fillRect(L, Math.round(yt), R - L, Math.round(yb - yt));
          if (rnd() < 0.5) g.fillRect(L + Math.round(rnd() * (R - L) * 0.5), Math.round(yt) - 3, Math.max(2, Math.round((R - L) * 0.4)), 4);
          // okna: martwe i pojedyncze świecące na zielono
          const step = Math.max(2, Math.round(9 / z));
          for (let wy = Math.round(yt) + step; wy < yb - step; wy += step * 2)
            for (let wx = L + step; wx < R - step; wx += step * 2) {
              const r = rnd();
              if (r < 0.1) g.fillStyle = '#c8e890';
              else if (r < 0.65) g.fillStyle = '#0c120c';
              else continue;
              g.fillRect(wx, wy, Math.max(1, step - 1), Math.max(1, step - 1));
            }
        }
      }
      // ziemia + jezdnia zbiegająca się w punkcie zbiegu, wraki
      g.fillStyle = '#24301f';
      g.fillRect(0, VY + 8, w, h);
      g.fillStyle = '#2a2a28';
      g.beginPath();
      g.moveTo(VX - 4, VY + 6);
      g.lineTo(VX + 4, VY + 6);
      g.lineTo(VX + 190, h);
      g.lineTo(VX - 190, h);
      g.fill();
      for (let i = 0; i < 12; i++) {
        const z = 1.4 + rnd() * 9, X = (rnd() - 0.5) * 6;
        const cw = Math.max(2, Math.round(70 / z)), chh = Math.max(1, Math.round(26 / z));
        g.fillStyle = '#3a3028';
        g.fillRect(Math.round(VX + (X * F) / z - cw / 2), Math.round(VY + (2.2 * F) / z - chh), cw, chh);
        g.fillStyle = '#1c1814';
        g.fillRect(Math.round(VX + (X * F) / z - cw / 2), Math.round(VY + (2.2 * F) / z - chh * 0.45), cw, 1);
      }
    });
    const rnd = seeded(22);
    const eyes = Array.from({ length: 7 }, (_, i) => {
      const side = rnd() > 0.5 ? 1 : -1, z = 2 + i * 1.1 + rnd();
      const x = VX + (side * (3 + rnd() * 2.5) * F) / z, y = VY + ((1.4 - rnd() * 1.2) * F) / z;
      const col = i % 2 ? 0xff3a20 : 0xb8ff40;
      const gap = Math.max(2, Math.round(8 / z));
      return { a: this.add.rectangle(x - gap / 2, y, 1, 1, col).setDepth(2), b: this.add.rectangle(x + gap / 2, y, 1, 1, col).setDepth(2), ph: rnd() * 10 };
    });
    const ash = new Motes(this, 140, { x: 0, y: 0, w: BASE_W, h: BASE_H }, 0xb0c0a0, 3, 9, 2, 0.6);
    img.setOrigin(VX / BASE_W, VY / BASE_H).setPosition(VX, VY);
    this.updaters.push((t, dt) => {
      // powolny marsz w głąb ulicy
      img.setScale(1 + Math.min(t, 14) * 0.012);
      img.x = VX + Math.sin(t * 0.25) * 3;
      for (const e of eyes) {
        const vis = Math.sin(t * 1.5 + e.ph) > -0.7 && Math.sin(t * 7 + e.ph) > -0.95;
        e.a.setVisible(vis);
        e.b.setVisible(vis);
      }
      ash.update(dt);
    });
  }

  /** 3 - szabrownicy przy ognisku pod flagą z czaszką. */
  private buildRaiders(): void {
    this.bg('intro_raiders', (g, w, h) => {
      skyGradient(g, w, h, [[0, '#05060a'], [0.7, '#1a1220'], [1, '#2a1c1c']]);
      skyline(g, w, seeded(41), { n: 26, base: 154, hMin: 8, hMax: 40, color: '#0c0a10', lit: null });
      dunes(g, w, h, 154, 3, '#1c1512', 6, 0.02);
      dunes(g, w, h, 174, 2, '#2a1f18', 9, 0.035);
      // namioty
      for (const [x, y, s] of [[96, 180, 30], [386, 178, 26], [300, 166, 18]] as const) {
        g.fillStyle = '#3a2c20';
        g.beginPath();
        g.moveTo(x - s, y);
        g.lineTo(x, y - s * 0.9);
        g.lineTo(x + s, y);
        g.fill();
        g.fillStyle = '#120c0a';
        g.beginPath();
        g.moveTo(x - s * 0.22, y);
        g.lineTo(x, y - s * 0.5);
        g.lineTo(x + s * 0.22, y);
        g.fill();
      }
      // krąg światła ogniska na ziemi
      for (let i = 5; i > 0; i--) {
        g.fillStyle = `rgba(255,140,50,${0.035 * (6 - i)})`;
        g.beginPath();
        g.ellipse(240, 184, 22 * i, 6 * i, 0, 0, Math.PI * 2);
        g.fill();
      }
      g.fillStyle = '#2a2018';
      g.fillRect(150, 98, 2, 86); // maszt
    });
    const flag = this.add.graphics().setDepth(2);
    const SKULL = ['..#####..', '.#######.', '.#.###.#.', '.#######.', '..##.##..', '..#####..', '...#.#...'];
    const fire = campfire(this, 240, 184, 2, 4);
    const members = [0, 1, 2, 3, 4].map((i) => {
      const a = (i / 5) * Math.PI * 2 + 0.3;
      const s = addUnit(this, 240 + Math.cos(a) * 62, 188 + Math.sin(a) * 11, `intro_raider${i}`, raiderLook(i), 'idle', 2);
      s.setFlipX(Math.cos(a) > 0).setDepth(Math.sin(a) < 0 ? 3 : 5);
      return s;
    });
    const sparks = new Motes(this, 30, { x: 222, y: 108, w: 36, h: 70 }, 0xffa040, 1, -22, 3, 0.9, 6);
    this.updaters.push((t, dt) => {
      fire(t);
      sparks.update(dt);
      const flick = 0.82 + 0.18 * Math.sin(t * 11);
      for (const m of members) m.setTint(Phaser.Display.Color.GetColor(255 * flick, 190 * flick, 150 * flick));
      flag.clear();
      for (let x = 0; x < 34; x++) {
        const dy = Math.round(Math.sin(t * 4 + x * 0.35) * 2.2 * (x / 34));
        flag.fillStyle(x % 5 === 4 ? 0x4a0c0c : 0x5a1010, 1).fillRect(152 + x, 100 + dy, 1, 22);
        const sx = x - 12;
        if (sx >= 0 && sx < 9) SKULL.forEach((row, sy) => row[sx] === '#' && flag.fillStyle(0xe8dcc0, 1).fillRect(152 + x, 106 + sy + dy, 1, 1));
      }
    });
  }

  /** 4 - karawana nomadów na wydmach o zachodzie słońca. */
  private buildNomads(): void {
    this.bg('intro_nomads', (g, w, h) => {
      skyGradient(g, w, h, [[0, '#3a2a5a'], [0.4, '#c0603a'], [0.62, '#f0a050'], [0.8, '#f8d090']]);
      g.fillStyle = '#ffe0a0';
      g.beginPath();
      g.arc(150, 132, 26, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#fff0c8';
      g.beginPath();
      g.arc(150, 132, 20, 0, Math.PI * 2);
      g.fill();
      dunes(g, w, h, 156, 7, '#b8703c', 1, 0.014);
      dunes(g, w, h, 172, 6, '#96562e', 3, 0.02);
      dunes(g, w, h, 198, 4, '#6a3c22', 8, 0.026);
    });
    const BASE_Y = 199;
    const beasts = this.add.graphics().setDepth(3);
    const slots: [('p' | 'b'), number][] = [['p', 0], ['b', 34], ['p', 66], ['b', 104], ['p', 136], ['p', 160]];
    const look = { classId: 'scout', look: { skin: '#8a5e44', hair: '#2a2018', cloth: '#a08a60', accent: '#b4532a', mask: true } };
    const walkers = slots.map(([kind, off], i) => ({
      kind, off, ph: i,
      sprite: kind === 'p' ? addUnit(this, 0, BASE_Y, 'intro_nomad', unitLookOf(look), 'walk', 1.5).setDepth(4) : null,
    }));
    const dust = new Motes(this, 110, { x: 0, y: 120, w: BASE_W, h: 110 }, 0xf0c080, 16, 1, 5, 0.5);
    this.updaters.push((t, dt) => {
      const lead = 180 + t * 9;
      beasts.clear();
      for (const wk of walkers) {
        const x = lead - wk.off;
        const bob = Math.abs(Math.sin(t * 3 + wk.ph)) * 1.2;
        if (wk.sprite) {
          wk.sprite.setPosition(x, BASE_Y - bob);
          continue;
        }
        const y = BASE_Y - bob;
        beasts.fillStyle(0x4a3220, 1);
        for (let k = 0; k < 4; k++) {
          const lx = x - 10 + (k < 2 ? 0 : 17) + (k % 2) * 3;
          beasts.fillRect(lx + Math.sin(t * 4 + k * 1.6) * 2, y - 12, 2, 12);
        }
        beasts.fillStyle(0x6a4a30, 1).fillRect(x - 12, y - 22, 26, 11); // tułów
        beasts.fillStyle(0x5a3a22, 1).fillRect(x - 6, y - 27, 10, 6); // garb
        beasts.fillStyle(0x6a4a30, 1).fillRect(x + 12, y - 30, 4, 12); // szyja
        beasts.fillStyle(0x7a5a38, 1).fillRect(x + 13, y - 33, 9, 5); // łeb
        if (wk.ph === 3) beasts.fillStyle(0x8a7a50, 1).fillRect(x - 9, y - 33, 16, 8); // skrzynia
      }
      dust.update(dt);
    });
  }

  /** 5 - światła Przystani: hala zajezdni, mur, wieże, ogniska. */
  private buildHaven(): void {
    this.bg('intro_haven', (g, w, h) => {
      skyGradient(g, w, h, [[0, '#04060e'], [0.6, '#10182c'], [1, '#2a2838']]);
      const rnd = seeded(31);
      for (let i = 0; i < 160; i++) {
        g.fillStyle = `rgba(255,255,255,${0.3 + rnd() * 0.7})`;
        g.fillRect(Math.floor(rnd() * w), Math.floor(rnd() * 130), 1, 1);
      }
      g.translate(0, -30);
      skyline(g, w, seeded(33), { n: 30, base: 168, hMin: 16, hMax: 70, color: '#0e0e14', lit: null });
      dunes(g, w, h + 30, 196, 2, '#221e1a', 12, 0.02);
      // hala zajezdni z łukowym dachem
      g.fillStyle = '#4a3a30';
      g.beginPath();
      g.ellipse(240, 150, 108, 34, 0, Math.PI, 0);
      g.fill();
      g.fillStyle = '#3a3530';
      g.fillRect(132, 150, 216, 46);
      g.fillStyle = '#2c2824';
      for (let x = 132; x < 348; x += 12) g.fillRect(x, 150, 1, 46);
      g.fillStyle = '#ffc860';
      for (let i = 0; i < 9; i++) if (i !== 4) g.fillRect(142 + i * 22, 160, 10, 14);
      g.fillStyle = '#ffa040';
      g.fillRect(226, 164, 28, 32); // brama hali
      // wieże i mur
      for (const x of [78, 402]) {
        g.fillStyle = '#2e2a26';
        g.fillRect(x - 12, 118, 24, 82);
        g.fillStyle = '#3a3530';
        g.fillRect(x - 15, 114, 30, 6);
        g.fillStyle = '#fff0a0';
        g.fillRect(x - 4, 106, 8, 6);
      }
      g.fillStyle = '#38322c';
      g.fillRect(60, 178, 360, 24);
      g.fillStyle = '#2a2622';
      for (let x = 60; x < 420; x += 10) g.fillRect(x, 174, 6, 4);
      g.fillStyle = '#1a1612';
      g.fillRect(222, 182, 36, 20); // brama w murze
      g.fillStyle = 'rgba(255,168,80,0.25)';
      g.fillRect(224, 184, 32, 18);
      g.setTransform(1, 0, 0, 1, 0, 0);
    });
    const lamps = [78, 402].map((x) => this.add.ellipse(x, 80, 70, 44, 0xffd080, 0.16).setDepth(1));
    const fires = [campfire(this, 150, 194, 1.2, 4), campfire(this, 338, 197, 1.2, 4)];
    const classes = ['medic', 'techie', 'soldier', 'scavenger', 'scout'];
    const cloths = ['#8a7a60', '#5a6a70', '#4a5a40', '#6a4a40', '#7a6a50'];
    classes.forEach((classId, i) => {
      const s = addUnit(this, 196 + i * 22, 195 + (i % 2) * 5, `intro_haven${i}`, unitLookOf({ classId, look: { cloth: cloths[i], accent: '#c9a23a', skin: '#b08060', hair: '#2a2018', hairStyle: i } }), 'idle', 1.5);
      s.setDepth(5 + (i % 2)).setFlipX(i > 2);
    });
    const smoke = new Motes(this, 36, { x: 136, y: 122, w: 32, h: 70 }, 0x9a9aa0, 3, -9, 5, 0.4, 3);
    this.updaters.push((t, dt) => {
      for (const f of fires) f(t);
      smoke.update(dt);
      lamps.forEach((l, i) => l.setAlpha(0.14 + 0.04 * Math.sin(t * 2 + i * 2)));
    });
  }

  /** 6 - najemnicy na tle zachodzącego słońca. */
  private buildCrew(): void {
    this.bg('intro_crew', (g, w, h) => {
      skyGradient(g, w, h, [[0, '#1a1030'], [0.4, '#a0402a'], [0.62, '#f0902a'], [0.8, '#ffd070']]);
      g.fillStyle = '#ffe8a0';
      g.beginPath();
      g.arc(240, 150, 46, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#fff4c8';
      g.beginPath();
      g.arc(240, 150, 36, 0, Math.PI * 2);
      g.fill();
      skyline(g, w, seeded(40), { n: 34, base: 182, hMin: 8, hMax: 52, color: '#1a1010', lit: null });
      dunes(g, w, h, 182, 3, '#3a2218', 14, 0.03);
      dunes(g, w, h, 196, 2, '#2a1810', 3, 0.05);
    });
    RECRUITS.slice(0, 4).forEach((r, i) => {
      addUnit(this, 150 + i * 60, 204, `rec_${r.id}`, unitLookOf(r), 'idle', 3).setDepth(4).setFlipX(i > 1);
      this.add.ellipse(150 + i * 60, 205, 44, 8, 0x000000, 0.35).setDepth(3);
    });
    const dust = new Motes(this, 110, { x: 0, y: 110, w: BASE_W, h: 110 }, 0xffc070, 12, 1, 17, 0.55, 6);
    this.updaters.push((_t, dt) => dust.update(dt));
  }
}
