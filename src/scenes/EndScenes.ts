import Phaser from 'phaser';
import type { PixelText } from './ui/BitmapFont';
import { SoundManager } from '../audio/SoundManager';
import { campaign, recruitCharacter } from '../core/campaign/session';
import { freshState } from '../core/campaign/state';
import { plainName } from '../core/data/names';
import { RECRUITS } from '../core/data/recruits';
import type { Character } from '../core/rules/types';
import { CREDITS, EPILOGUE, GAMEOVER_LINES } from '../core/data/story';
import { addUnit, unitLookOf } from './iso/UnitLooks';
import { BASE_H, BASE_W, Motes, PAL, Typewriter, type UiButton, button, campfire, canvasTexture, dunes, enter, goto, label, panel, seeded, skyGradient, skyline } from './ui/Kit';
import { titleTexture } from './ui/PixelFont';
import { Save, toast } from './ui/Widgets';

// Ekrany końcowe (port Oldgame/src/scenes/gameover.js i victory.js).

/**
 * Dane startowe GameOverScene. Pełne wybicie drużyny (Oldgame/src/scenes/mission.js:565-568) startuje tę scenę od razu,
 * bez podsumowania misji: `scene.start('GameOverScene', { fallen: [imiona poległych] })`.
 * Bez `fallen` imiona biorą się z campaign.state.flags.fallen + bieżącej drużyny (jak `casualties` w gameover.js).
 */
export interface GameOverData {
  fallen?: string[];
}

export class GameOverScene extends Phaser.Scene {
  private names: string[] = [];
  private tw: Typewriter | null = null;
  private t = 0;
  private text!: PixelText;
  private dust: Motes | null = null;
  private buttons!: Phaser.GameObjects.Container;

  constructor() {
    super('GameOverScene');
  }

  init(data: GameOverData): void {
    const st = campaign.state;
    const given = Array.isArray(data?.fallen) ? data.fallen.filter((n) => typeof n === 'string' && n) : [];
    // Oldgame/src/scenes/gameover.js:12 - polegli z misji albo dotychczasowi polegli + drużyna (ostatnie 4 imiona)
    const pool = given.length ? given : [...(st.flags.fallen ?? []), ...st.party.map((c) => c.name)];
    this.names = [...new Set(pool)].slice(-4);
  }

  /** Postaci leżące na ziemi: polegli z drużyny (po imieniu), inaczej drużyna, inaczej pierwsi rekruci. */
  private crew(): Character[] {
    const party = campaign.state.party;
    const named = party.filter((c) => this.names.includes(c.name));
    const list = named.length ? named : party.length ? party : RECRUITS.slice(0, 4).map((r) => recruitCharacter(r));
    return list.slice(0, 4);
  }

  create(): void {
    enter(this, 1200);
    const st = campaign.state;
    this.t = 0;
    canvasTexture(this, 'over_bg', BASE_W, BASE_H, (g, w, h) => {
      skyGradient(g, w, h, [[0, '#050308'], [0.6, '#1c0c10'], [1, '#3a1410']]);
      skyline(g, w, seeded(13), { n: 30, base: 190, hMin: 12, hMax: 70, color: '#0c0608', lit: null });
      dunes(g, w, h, 190, 3, '#140a0a', 4, 0.02);
      // krzyże z rur na pierwszym planie
      g.fillStyle = '#0a0506';
      for (const [x, s] of [[110, 1], [170, 0.8], [300, 0.9], [360, 1.1], [236, 0.7]] as const) {
        g.fillRect(x, 190 - 26 * s, 3, 30 * s);
        g.fillRect(x - 6 * s, 190 - 18 * s, 14 * s, 3);
      }
    });
    this.add.image(0, 0, 'over_bg').setOrigin(0);
    // czerwona poświata nad poległymi (PointLight z gameover.js)
    this.add.ellipse(BASE_W / 2, 176, 300, 60, 0xc43d2f, 0.12).setDepth(1);
    // polegli: poza "die" - przewracają się jeden po drugim i zostają na ziemi
    const crew = this.crew();
    crew.forEach((ch, i) => {
      const x = Math.round(BASE_W / 2 + (i - (crew.length - 1) / 2) * 84), y = 182 + (i % 2) * 6;
      const sp = addUnit(this, x, y, `pc_${ch.recruitId ?? ch.id}`, unitLookOf(ch), 'idle', 2).setDepth(3 + (i % 2)).setFlipX(i % 2 === 1);
      sp.anims.stop();
      sp.setFrame('f_hurt');
      this.tweens.add({
        targets: sp, angle: sp.flipX ? -90 : 90, y: y + 2, delay: 600 + i * 380, duration: 420, ease: 'Quad.easeIn',
        onStart: () => SoundManager.sfx('hit', { vol: 0.25 }),
        onComplete: () => sp.setTint(0xb09090),
      });
      this.add.ellipse(x, y + 2, 50, 7, 0x000000, 0.45).setDepth(2);
    });
    const vignette = canvasTexture(this, 'over_vig', BASE_W, BASE_H, (g, w, h) => {
      const grad = g.createRadialGradient(w / 2, h / 2, h * 0.3, w / 2, h / 2, h);
      grad.addColorStop(0, 'rgba(0,0,0,0)');
      grad.addColorStop(1, 'rgba(48,0,0,0.65)');
      g.fillStyle = grad;
      g.fillRect(0, 0, w, h);
    });
    this.add.image(0, 0, vignette).setOrigin(0).setDepth(5);
    this.dust = new Motes(this, 80, { x: 0, y: 60, w: BASE_W, h: 150 }, 0xa08070, 14, 2, 9, 0.4, 6);
    this.add.image(BASE_W / 2, 34, titleTexture(this, 'over_title', 'KONIEC DROGI', 5, { top: '#e07a6a', bottom: '#6a1410', spacing: 2 })).setDepth(7);

    panel(this, 56, 196, BASE_W - 112, 68, PAL.blood, 0.93).setDepth(8);
    label(this, BASE_W / 2, 200, 'Polegli: ' + (this.names.map(plainName).join(', ') || '—'), { size: 7, color: PAL.bad, wrap: BASE_W - 132, align: 'center' }).setOrigin(0.5, 0).setDepth(9);
    this.text = label(this, BASE_W / 2, 211, '', { size: 7, wrap: BASE_W - 132, lineSpacing: 2, align: 'center' }).setOrigin(0.5, 0).setDepth(9);
    label(this, BASE_W / 2, 236, `Przetrwaliście do dnia ${st.day}. Ukończone zlecenia: ${st.completed.length}.`, { size: 6, color: PAL.dim }).setOrigin(0.5, 0).setDepth(9);
    this.buttons = this.add.container(0, 0).setAlpha(0).setDepth(9);
    if (Save.exists())
      this.buttons.add(button(this, BASE_W / 2 - 130, 246, 'Wczytaj ostatni zapis', () => {
        if (Save.load() && campaign.state.party.length) goto(this, 'HubScene');
        else toast(this, 'Brak użytecznego zapisu.', 'bad');
      }, { w: 120, size: 7, primary: true }).box);
    this.buttons.add(button(this, BASE_W / 2 + 10, 246, 'Menu główne', () => {
      campaign.state = freshState();
      goto(this, 'TitleScene');
    }, { w: 100, size: 7, danger: true }).box);
    // całe epitafium jednym ciągiem maszyny do pisania (gameover.js:29)
    this.tw = new Typewriter(this.text, GAMEOVER_LINES.join(' '), 28);
    // klik / klawisz kończy tekst i od razu pokazuje przyciski
    const skip = (): void => {
      this.tw?.finish();
      this.showButtons();
    };
    this.input.on('pointerdown', skip);
    this.input.keyboard?.on('keydown-SPACE', skip);
    this.input.keyboard?.on('keydown-ENTER', skip);
    SoundManager.music('defeat');
    SoundManager.ambience('wind');
    SoundManager.sfx('defeat');
  }

  update(_time: number, delta: number): void {
    const dt = Math.min(delta / 1000, 0.1);
    this.t += dt;
    this.dust?.update(dt);
    this.tw?.update(dt);
    // przyciski po skończeniu tekstu albo po 3 s (gameover.js:37)
    if (this.tw?.done || this.t > 3) this.showButtons();
  }

  private showButtons(): void {
    if (this.buttons.alpha > 0 || this.tweens.isTweening(this.buttons)) return;
    this.tweens.add({ targets: this.buttons, alpha: 1, duration: 900 });
  }
}

export class VictoryScene extends Phaser.Scene {
  private tw: Typewriter | null = null;
  private line = 0;
  private text!: PixelText;
  private box!: Phaser.GameObjects.Container;
  private next!: Phaser.GameObjects.Container;
  private nextBtn: UiButton | null = null;
  private title!: Phaser.GameObjects.Image;
  private rolling = false;
  private t = 0;
  private fire: (t: number) => void = () => {};
  private dust: Motes | null = null;

  constructor() {
    super('VictoryScene');
  }

  create(): void {
    enter(this, 1200);
    this.line = 0;
    this.rolling = false;
    this.t = 0;
    canvasTexture(this, 'win_bg', BASE_W, BASE_H, (g, w, h) => {
      skyGradient(g, w, h, [[0, '#2a3a6a'], [0.4, '#c07050'], [0.62, '#f0b060'], [0.8, '#ffe0a0']]);
      g.fillStyle = '#fff4c8';
      g.beginPath();
      g.arc(240, 150, 40, 0, Math.PI * 2);
      g.fill();
      skyline(g, w, seeded(40), { n: 34, base: 186, hMin: 8, hMax: 56, color: '#3a2420', lit: '#ffd070' });
      dunes(g, w, h, 186, 3, '#5a3a28', 14, 0.03);
      dunes(g, w, h, 200, 2, '#3c2418', 3, 0.05);
    });
    this.add.image(0, 0, 'win_bg').setOrigin(0);
    this.fire = campfire(this, BASE_W / 2, 204, 1.5, 3);
    campaign.state.party.forEach((ch, i, a) => addUnit(this, BASE_W / 2 + (i - (a.length - 1) / 2) * 44, 206, `pc_${ch.recruitId ?? ch.id}`, unitLookOf(ch), 'idle', 2).setDepth(4).setFlipX(i >= a.length / 2));
    this.dust = new Motes(this, 100, { x: 0, y: 80, w: BASE_W, h: 140 }, 0xffe0a0, 10, -3, 21, 0.6, 6);
    this.title = this.add.image(BASE_W / 2, 36, titleTexture(this, 'win_title', 'ZWYCIĘSTWO', 5, { top: '#fff0a0', bottom: '#d0801e', spacing: 2 })).setDepth(10);

    this.box = panel(this, 56, 212, BASE_W - 112, 50, PAL.edgeHi, 0.93).setDepth(10);
    this.text = label(this, 8, 6, '', { size: 7, wrap: BASE_W - 200, lineSpacing: 2 });
    this.box.add(this.text);
    const b = button(this, BASE_W - 112 - 66, 16, 'Dalej ▶', () => this.advance(), { primary: true, w: 58 });
    this.nextBtn = b;
    this.next = b.box;
    this.box.add(this.next);
    // Enter / Spacja / klik gdziekolwiek (Oldgame/src/scenes/victory.js:58)
    this.input.keyboard?.on('keydown-ENTER', () => this.advance());
    this.input.keyboard?.on('keydown-SPACE', () => this.advance());
    this.input.on('pointerdown', (_p: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]) => !over.length && this.advance());
    this.tw = new Typewriter(this.text, EPILOGUE[0], 30);
    SoundManager.music('victory');
    SoundManager.sfx('victory');
    SoundManager.ambience('wind');
  }

  private advance(): void {
    if (this.rolling) return;
    if (this.tw && !this.tw.done) return this.tw.finish();
    if (this.line + 1 < EPILOGUE.length) {
      this.tw = new Typewriter(this.text, EPILOGUE[++this.line], 30);
      if (this.line === EPILOGUE.length - 1) this.nextBtn?.setLabel('Napisy ▶');
      return;
    }
    this.credits();
  }

  /** Napisy końcowe przewijane w górę, potem przyciski. */
  private credits(): void {
    this.rolling = true;
    this.box.destroy();
    this.tweens.add({ targets: this.title, alpha: 0, duration: 1200 });
    const shade = this.add.rectangle(0, 0, BASE_W, BASE_H, 0x000000, 0.55).setOrigin(0).setDepth(11).setAlpha(0);
    this.tweens.add({ targets: shade, alpha: 1, duration: 1200 });
    const col = this.add.container(BASE_W / 2, BASE_H + 10).setDepth(12);
    let y = 0;
    col.add(this.add.image(0, y, titleTexture(this, 'win_game', 'PYŁ I RDZA', 4, { top: '#ffe08a', bottom: '#c0501e', spacing: 2 })));
    y += 40;
    for (const [a, b] of CREDITS) {
      col.add(label(this, 0, y, a.toUpperCase(), { size: 6, color: PAL.amber }).setOrigin(0.5, 0));
      col.add(label(this, 0, y + 9, b, { size: 8 }).setOrigin(0.5, 0));
      y += 30;
    }
    col.add(this.add.image(0, y + 20, titleTexture(this, 'win_studio', 'STORM 32', 4, { top: '#ffe08a', bottom: '#d0521e', spacing: 2 })));
    col.add(label(this, 0, y + 46, 'Dziękujemy za grę.', { size: 7, color: PAL.dim }).setOrigin(0.5, 0));
    this.tweens.add({
      // 34 s jak animacja crl w Oldgame/src/scenes/victory.js:42
      targets: col, y: -(y + 70), duration: 34000,
      onComplete: () => this.endButtons(),
    });
    this.input.once('pointerdown', () => this.endButtons());
  }

  private endButtons(): void {
    if (this.children.getByName('end')) return;
    const c = this.add.container(0, 0).setName('end').setDepth(20);
    c.add(button(this, BASE_W / 2 - 170, 240, 'Wróć do Przystani (graj dalej)', () => {
      Save.write();
      goto(this, 'HubScene');
    }, { w: 180, size: 7, primary: true }).box);
    c.add(button(this, BASE_W / 2 + 20, 240, 'Menu główne', () => goto(this, 'TitleScene'), { w: 100, size: 7 }).box);
  }

  update(_time: number, delta: number): void {
    const dt = Math.min(delta / 1000, 0.1);
    this.t += dt;
    this.fire(this.t);
    this.dust?.update(dt);
    this.tw?.update(dt);
  }
}
