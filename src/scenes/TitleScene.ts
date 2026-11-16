import Phaser from 'phaser';
import { SoundManager } from '../audio/SoundManager';
import { campaign } from '../core/campaign/session';
import { RECRUITS } from '../core/data/recruits';
import { CREDITS, GAME_SUBTITLE, GAME_TITLE } from '../core/data/story';
import { type MenuModel, Q8, TickClock, type TitleMenuId, angQ8, blinkAlphaQ8, icos, phaseAt, secToQ8, titleMenu } from '../core/frontend';
import { addUnit, unitLookOf } from './iso/UnitLooks';
import { BASE_H, BASE_W, Motes, PAL, type UiButton, button, campfire, enter, goto, label, seeded, tiledImage } from './ui/Kit';
import { MOODS, backdrop, paintWreck } from './fx/Backdrops';
import { deadTree } from './fx/Painter';
import { wastelandTexture } from './ui/WastelandFont';
import { Save, dialog, enterLoaded, modalOpen, openOptions, openSaveSlots, toast } from './ui/Widgets';

// Ekran tytułowy (port Oldgame/src/scenes/title.js): pikselowe logo nad pustkowiem o zmierzchu + menu.

const SEC = secToQ8(1);
const W_LOGO = angQ8(Math.PI / 2); // okres 4 s

export class TitleScene extends Phaser.Scene {
  /** Czas ekranu w tickach 50 Hz (animacje z core/frontend/fx.ts). */
  private clock = new TickClock();
  private logo: Phaser.GameObjects.Container | null = null;
  private sub: Phaser.GameObjects.Container | null = null;
  private fire: (t: number) => void = () => {};
  private bgUpdate: (t: number, dt: number) => void = () => {};
  private dust: Motes | null = null;
  private credits: Phaser.GameObjects.Container | null = null;
  private menu: MenuModel<TitleMenuId> = titleMenu(false);
  private buttons: UiButton[] = [];

  constructor() {
    super('TitleScene');
  }

  create(): void {
    enter(this);
    this.clock.reset();
    this.credits = null;
    this.data.set('quit', false);
    this.data.set('leaving', false);

    this.bgUpdate = backdrop(this, 'title', {
      mood: MOODS.dusk, seed: 5, orb: [196, 150, 28], farBase: 196, midBase: 202, midH: [12, 58], groundY: 200,
      props: (g) => {
        paintWreck(g, 318, 230, '#1e1012', '#d0784a', '#e88a40');
        deadTree(g, 72, 232, 70, seeded(77), '#1a0e0c', '#c0683a', -1);
        // drogowskaz i beczki
        g.fillStyle = '#1a0e0c';
        g.fillRect(426, 196, 2, 34);
        g.fillRect(414, 198, 24, 7);
        g.fillStyle = '#c0683a';
        g.fillRect(414, 198, 24, 1);
        g.fillRect(426, 196, 1, 34);
        for (const [x, y] of [[392, 230], [402, 233]] as const) {
          g.fillStyle = '#2a1510';
          g.fillRect(x, y - 10, 8, 10);
          g.fillStyle = '#5a2a18';
          g.fillRect(x, y - 7, 8, 1);
          g.fillRect(x, y - 3, 8, 1);
          g.fillStyle = '#d07040';
          g.fillRect(x, y - 10, 1, 10);
        }
      },
    });
    this.fire = campfire(this, 150, 230, 1.6, 4);
    [RECRUITS[1], RECRUITS[0]].forEach((r, i) => addUnit(this, 178 + i * 30, 232 + i * 3, `rec_${r.id}`, unitLookOf(r), 'idle', 2).setDepth(5).setFlipX(true));
    this.dust = new Motes(this, 150, { x: 0, y: 90, w: BASE_W, h: 150 }, 0xf0c080, 18, 1, 8, 0.5, 6);

    // logo
    // logo ma > 256 px szerokości - w profilu Amiga idzie jako kafle; zaczepione w środku, jak wcześniej obraz
    const centered = (key: string, y: number): Phaser.GameObjects.Container => {
      const src = this.textures.get(key).get(); // wymiary projektowe (obraz źródłowy jest ART razy większy)
      return tiledImage(this, key, BASE_W / 2 - src.width / 2, y - src.height / 2, src.width / 2, src.height / 2).setDepth(10);
    };
    this.logo = centered(wastelandTexture(this, 'title_logo', GAME_TITLE, 4, { top: '#ffe08a', bottom: '#b0461a', spacing: 2 }), 50);
    this.sub = centered(wastelandTexture(this, 'title_sub', GAME_SUBTITLE, 2, { top: '#c8e08a', bottom: '#4f6a2a', spacing: 3, wear: 0.5, jitter: false }), 86);

    // menu: model z core/frontend/menu.ts (fokus + nawigacja góra/dół/ogień jak joystickiem), scena tylko rysuje
    this.menu = titleMenu(Save.exists(), Save.anySlot());
    const mx = BASE_W - 128;
    // przy większej liczbie pozycji (Kontynuuj + Wczytaj) menu podnosi się, żeby zmieściło się nad dolną krawędzią
    let y = Math.min(158, BASE_H - 8 - 15 - 24 - 19 * (this.menu.items.length - 2));
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
    label(this, 6, BASE_H - 6, 'Pathfinder 2e w świecie po zagładzie', { size: 6, color: PAL.dim }).setOrigin(0, 1).setDepth(10);

    const kb = this.input.keyboard;
    const nav = (dir: -1 | 1) => () => {
      if (modalOpen(this) || this.credits || this.data.get('leaving') || this.data.get('quit')) return;
      if (this.menu.move(dir)) this.focus(this.menu.focus, true);
    };
    for (const k of ['UP', 'W']) kb?.on(`keydown-${k}`, nav(-1));
    for (const k of ['DOWN', 'S']) kb?.on(`keydown-${k}`, nav(1));
    const fire = (): void => {
      if (modalOpen(this) || this.data.get('leaving') || this.data.get('quit')) return;
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
    if (this.credits) return; // okno Autorzy blokuje menu do zamknięcia
    this.menu.setFocus(i);
    this.paintFocus();
    if (sound) SoundManager.sfx('hover');
  }

  private paintFocus(): void {
    this.buttons.forEach((b, i) => b.setFocus(i === this.menu.focus));
  }

  private run(id: TitleMenuId): void {
    if (this.data.get('quit') || this.credits) return;
    switch (id) {
      case 'new':
        SoundManager.sfx('door');
        goto(this, 'RecruitScene');
        return;
      case 'continue':
        if (Save.load() && campaign.state.party.length) enterLoaded(this);
        else toast(this, 'Nie udało się wczytać zapisu.', 'bad');
        return;
      case 'load':
        void openSaveSlots(this, 'load').then((slot) => slot !== null && enterLoaded(this));
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
      case 'quit':
        void this.confirmQuit();
        return;
    }
  }

  /** "Wyjdź z gry": potwierdzenie, potem zamknięcie karty / okna; gdy przeglądarka nie pozwala - ekran pożegnalny. */
  private async confirmQuit(): Promise<void> {
    const yes = await dialog(this, {
      title: 'WYJŚCIE Z GRY',
      body: 'Na pewno chcesz opuścić pustkowie? Niezapisany postęp przepadnie (autozapis zostaje).',
      buttons: [{ label: 'Zostaję', value: false }, { label: 'Wyjdź', value: true, danger: true }],
    });
    if (!yes) return;
    this.data.set('leaving', true);
    SoundManager.music(null);
    SoundManager.ambience(null);
    this.cameras.main.fadeOut(600, 0, 0, 0);
    this.cameras.main.once('camerafadeoutcomplete', () => {
      this.data.set('quit', true);
      this.data.set('leaving', false);
      for (const btn of this.buttons) btn.box.setVisible(false).each((o: Phaser.GameObjects.GameObject) => o.disableInteractive());
      // window.close() działa tylko dla okien otwartych skryptem (np. wersja w osobnym oknie / PWA);
      // w zwykłej karcie przeglądarka je ignoruje, więc zostaje czarny ekran z pożegnaniem
      window.close();
      const D = 100;
      this.add.rectangle(-BASE_W, -BASE_H, BASE_W * 3, BASE_H * 3, 0x000000, 1).setOrigin(0).setDepth(D);
      label(this, BASE_W / 2, BASE_H / 2 - 10, 'Do zobaczenia na pustkowiu.', { size: 9, bold: true, color: PAL.amber }).setOrigin(0.5).setDepth(D + 1);
      label(this, BASE_W / 2, BASE_H / 2 + 8, 'Możesz zamknąć kartę przeglądarki.', { size: 7, color: PAL.dim }).setOrigin(0.5).setDepth(D + 1);
      this.time.delayedCall(1200, () => button(this, BASE_W / 2 - 40, BASE_H / 2 + 26, 'Wróć do menu', () => this.scene.restart(), { w: 80, size: 7 }).box.setDepth(D + 2));
      this.cameras.main.resetFX();
      this.cameras.main.fadeIn(400, 0, 0, 0);
    });
  }

  private toggleCredits(): void {
    if (this.credits) {
      this.credits.destroy();
      this.credits = null;
      return;
    }
    const w = 280, h = 34 + (CREDITS.length + 1) * 14;
    // własne, zawsze w pełni kryjące tło (bez ustawienia przezroczystości okien) + zasłona łapiąca kliknięcia w menu
    const box = this.add.container((BASE_W - w) / 2, (BASE_H - h) / 2, [
      this.add.rectangle(-BASE_W, -BASE_H, BASE_W * 3, BASE_H * 3, 0x000000, 0.001).setOrigin(0).setInteractive(),
      this.add.rectangle(2, 2, w, h, 0x000000, 0.5).setOrigin(0),
      this.add.rectangle(0, 0, w, h, PAL.panel, 1).setOrigin(0).setStrokeStyle(1, PAL.edgeHi).setInteractive(),
    ]).setDepth(50);
    box.add(label(this, 10, 8, 'AUTORZY', { size: 9, bold: true, color: PAL.amber }));
    CREDITS.forEach(([a, b], i) => {
      const k = label(this, 10, 26 + i * 14, `${a}: `, { color: PAL.amber });
      box.add([k, label(this, 10 + k.displayWidth, 26 + i * 14, b, { wrap: w - 20 - k.displayWidth })]);
    });
    const vy = 26 + CREDITS.length * 14;
    const vk = label(this, 10, vy, 'Wersja: ', { color: PAL.amber });
    box.add([vk, label(this, 10 + vk.displayWidth, vy, `v${__GAME_VERSION__}`)]);
    const close = button(this, w - 62, h - 20, 'Zamknij', () => this.toggleCredits(), { w: 54, size: 7 });
    box.add(close.box);
    this.credits = box;
  }

  update(_time: number, delta: number): void {
    const dt = Math.min(delta / 1000, 0.1);
    this.clock.advance(delta, 10);
    const tq = this.clock.timeQ8;
    this.fire(tq / SEC);
    this.bgUpdate(tq / SEC, dt);
    this.dust?.update(dt);
    // logo: 50 -> 47 -> 50 px w 4 s (cosinus z tablicy), podtytuł: krótkie przygaszenie co ~4.8 s
    this.logo?.setY(50 - (3 * (16384 - icos(phaseAt(tq, W_LOGO)))) / 32768);
    this.sub?.setAlpha(blinkAlphaQ8(tq >> 8) / Q8);
  }
}
