import Phaser from 'phaser';
import { SoundManager } from '../audio/SoundManager';
import { campaign } from '../core/campaign/session';
import { RECRUITS } from '../core/data/recruits';
import { CREDITS, GAME_SUBTITLE, GAME_TITLE } from '../core/data/story';
import { type MenuModel, type TitleMenuId, titleMenu } from '../core/frontend';
import { addUnit, unitLookOf } from './iso/UnitLooks';
import { BASE_H, BASE_W, Motes, PAL, type UiButton, button, campfire, canvasTexture, dunes, enter, goto, label, panel, seeded, skyGradient, skyline } from './ui/Kit';
import { titleTexture } from './ui/PixelFont';
import { Save, modalOpen, openOptions, toast } from './ui/Widgets';

// Ekran tytułowy (port Oldgame/src/scenes/title.js): pikselowe logo nad pustkowiem o zmierzchu + menu.

export class TitleScene extends Phaser.Scene {
  private t = 0;
  private fire: (t: number) => void = () => {};
  private dust: Motes | null = null;
  private credits: Phaser.GameObjects.Container | null = null;
  private menu: MenuModel<TitleMenuId> = titleMenu(false);
  private buttons: UiButton[] = [];

  constructor() {
    super('TitleScene');
  }

  create(): void {
    enter(this);
    this.t = 0;
    this.credits = null;

    canvasTexture(this, 'title_bg', BASE_W, BASE_H, (g, w, h) => {
      skyGradient(g, w, h, [[0, '#1a1030'], [0.35, '#7a3a4a'], [0.58, '#e0803a'], [0.76, '#f6c070']]);
      g.fillStyle = '#ffe0a0';
      g.beginPath();
      g.arc(196, 150, 34, 0, Math.PI * 2);
      g.fill();
      skyline(g, w, seeded(5), { n: 46, base: 186, hMin: 14, hMax: 84, color: '#24141a', lit: null });
      skyline(g, w, seeded(6), { n: 28, base: 192, hMin: 8, hMax: 40, color: '#1a0f12', lit: '#ffb84a', wMin: 10, wMax: 24 });
      dunes(g, w, h, 190, 4, '#5a3424', 21, 0.02);
      dunes(g, w, h, 208, 3, '#3c2218', 7, 0.035);
      // wrak samochodu i martwe drzewo na pierwszym planie
      g.fillStyle = '#1c1210';
      g.fillRect(318, 214, 54, 12);
      g.fillRect(330, 204, 28, 11);
      g.fillStyle = '#e0803a';
      g.fillRect(334, 207, 9, 6);
      g.fillRect(346, 207, 9, 6);
      g.fillStyle = '#0e0908';
      g.fillRect(324, 224, 10, 6);
      g.fillRect(356, 224, 10, 6);
      g.fillStyle = '#1c1210';
      g.fillRect(70, 170, 4, 58);
      for (const [x, y, dx, dy] of [[72, 184, -18, -14], [72, 176, 16, -18], [72, 196, 14, -8], [56, 172, -8, -10]] as const) {
        g.strokeStyle = '#1c1210';
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x + dx, y + dy);
        g.stroke();
      }
    });
    this.add.image(0, 0, 'title_bg').setOrigin(0);
    this.fire = campfire(this, 150, 230, 1.6, 4);
    [RECRUITS[1], RECRUITS[0]].forEach((r, i) => addUnit(this, 178 + i * 30, 232 + i * 3, `rec_${r.id}`, unitLookOf(r), 'idle', 2).setDepth(5).setFlipX(true));
    this.dust = new Motes(this, 150, { x: 0, y: 90, w: BASE_W, h: 150 }, 0xf0c080, 18, 1, 8, 0.5, 6);

    // logo
    const logo = this.add.image(BASE_W / 2, 50, titleTexture(this, 'title_logo', GAME_TITLE, 5, { top: '#ffe08a', bottom: '#c0501e', spacing: 2 })).setDepth(10);
    const sub = this.add.image(BASE_W / 2, 86, titleTexture(this, 'title_sub', GAME_SUBTITLE, 2, { top: '#c8e08a', bottom: '#4f8a2a', spacing: 2 })).setDepth(10);
    this.tweens.add({ targets: logo, y: 47, duration: 2000, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    this.tweens.add({ targets: sub, alpha: 0.45, duration: 90, yoyo: true, repeat: -1, repeatDelay: 4600, hold: 60 });

    // menu: model z core/frontend/menu.ts (fokus + nawigacja góra/dół/ogień jak joystickiem), scena tylko rysuje
    this.menu = titleMenu(Save.exists());
    const mx = BASE_W - 128;
    let y = 158;
    this.buttons = this.menu.items.map((it, i) => {
      const first = it.id === 'new';
      const b = button(this, mx, y, it.label, () => {
        this.menu.setFocus(i);
        this.run(it.id);
      }, first ? { primary: true, w: 100, h: 18, size: 9, onOver: () => this.focus(i, false) } : { w: 100, h: 15, onOver: () => this.focus(i, false) });
      b.box.setDepth(10);
      y += first ? 24 : 19;
      return b;
    });
    this.paintFocus();
    label(this, 6, BASE_H - 6, 'STORM 32 · Pathfinder 2e w świecie po zagładzie', { size: 6, color: PAL.dim }).setOrigin(0, 1).setDepth(10);

    const kb = this.input.keyboard;
    const nav = (dir: -1 | 1) => () => {
      if (modalOpen(this) || this.credits || this.data.get('leaving')) return;
      if (this.menu.move(dir)) this.focus(this.menu.focus, true);
    };
    for (const k of ['UP', 'W']) kb?.on(`keydown-${k}`, nav(-1));
    for (const k of ['DOWN', 'S']) kb?.on(`keydown-${k}`, nav(1));
    const fire = (): void => {
      if (modalOpen(this) || this.data.get('leaving')) return;
      if (this.credits) return this.toggleCredits();
      const id = this.menu.activate();
      if (id) {
        SoundManager.sfx('click');
        this.run(id);
      }
    };
    kb?.on('keydown-ENTER', fire);
    kb?.on('keydown-SPACE', fire);
    kb?.on('keydown-ESC', () => this.credits && !modalOpen(this) && this.toggleCredits());
    SoundManager.music('title');
    SoundManager.ambience('wind');
  }

  private focus(i: number, sound: boolean): void {
    this.menu.setFocus(i);
    this.paintFocus();
    if (sound) SoundManager.sfx('hover');
  }

  private paintFocus(): void {
    this.buttons.forEach((b, i) => b.setFocus(i === this.menu.focus));
  }

  private run(id: TitleMenuId): void {
    switch (id) {
      case 'new':
        SoundManager.sfx('door');
        goto(this, 'RecruitScene');
        return;
      case 'continue':
        if (Save.load() && campaign.state.party.length) goto(this, 'HubScene');
        else toast(this, 'Nie udało się wczytać zapisu.', 'bad');
        return;
      case 'options':
        void openOptions(this);
        return;
      case 'intro':
        goto(this, 'IntroScene');
        return;
      case 'credits':
        this.toggleCredits();
        return;
    }
  }

  private toggleCredits(): void {
    if (this.credits) {
      this.credits.destroy();
      this.credits = null;
      return;
    }
    const w = 280, h = 34 + CREDITS.length * 14;
    const box = panel(this, (BASE_W - w) / 2, (BASE_H - h) / 2, w, h, PAL.edgeHi, 0.97).setDepth(50);
    box.add(label(this, 10, 8, 'AUTORZY — STORM 32', { size: 9, bold: true, color: PAL.amber }));
    CREDITS.forEach(([a, b], i) => {
      const k = label(this, 10, 26 + i * 14, `${a}: `, { color: PAL.amber });
      box.add([k, label(this, 10 + k.displayWidth, 26 + i * 14, b, { wrap: w - 20 - k.displayWidth })]);
    });
    const close = button(this, w - 62, h - 20, 'Zamknij', () => this.toggleCredits(), { w: 54, size: 7 });
    box.add(close.box);
    this.credits = box;
  }

  update(_time: number, delta: number): void {
    const dt = Math.min(delta / 1000, 0.1);
    this.t += dt;
    this.fire(this.t);
    this.dust?.update(dt);
  }
}
