// Nastrój misji (port Oldgame/src/gfx/atmosphere.js do 2D): pora dnia i pogoda jako warstwy ekranowe.
//   night - ciemność (mapa oświetlenia MULTIPLY) z plamami światła lamp, ognisk, terminali i postaci
//   dusk  - ciepły gradient od fioletu do pomarańczu + złote promienie, długie cienie (robi scena)
//   day   - jasna, ciepła mgiełka i promienie słońca
//   storm - burza pyłowa: brunatny półmrok, smugi deszczu i pyłu, podmuchy, błyskawice z grzmotem
//   toxic - zielona mgła w dryfujących ławicach, świecące zarodniki
// Wszystkie warstwy żyją w kontenerze ekranowym sceny (piksele projektowe 0..BASE_W x 0..BASE_H).

import Phaser from 'phaser';
import { SoundManager } from '../../audio/SoundManager';
import type { ArtBook } from '../iso/IsoArt';
import { paintFogBank, paintLightPool, paintLightning, paintScreenGradient, paintSpore, paintStreak, paintSunShafts } from '../iso/FxArt';
import { type RGB, rng } from '../iso/Pixel';
import { type FxLight, WorldFx } from './WorldFx';

export type MoodName = 'day' | 'dusk' | 'night' | 'storm' | 'toxic';
export const MOOD_NAMES: readonly MoodName[] = ['day', 'dusk', 'night', 'storm', 'toxic'];
export const asMood = (s: string | null | undefined): MoodName => (MOOD_NAMES as readonly string[]).includes(s ?? '') ? (s as MoodName) : 'dusk';

/** Źródło światła w świecie (piksele świata). */
export interface WorldLight {
  x: number;
  y: number;
  color: number;
  /** Promień w pikselach świata. */
  r: number;
  a: number;
}

interface MoodDef {
  /** Gradient mapy oświetlenia od góry do dołu ekranu (null = bez mapy). */
  shade: RGB[] | null;
  /** Mnożnik siły świateł lamp. */
  lamp: number;
  /** Ciepła mgiełka ADD. */
  haze: [RGB, number] | null;
  dust: [RGB, number, number];
  shafts: [RGB, number] | null;
}

const MOODS: Record<MoodName, MoodDef> = {
  day: { shade: null, lamp: 0, haze: [0xfff0c0, 0.07], dust: [0xf0dcaa, 40, 0.5], shafts: [0xfff2d0, 0.5] },
  dusk: { shade: [0xc4acd8, 0xf0bc9c, 0xffd4a0, 0xffe2b4], lamp: 0.55, haze: [0xff9a50, 0.05], dust: [0xffc880, 55, 0.55], shafts: [0xffb060, 0.6] },
  night: { shade: [0x28345e, 0x344476, 0x3e5088], lamp: 1.25, haze: null, dust: [0xa8b8d8, 30, 0.35], shafts: null },
  storm: { shade: [0x9c8468, 0xb89a78, 0xc8aa84], lamp: 0.8, haze: [0x7a5a30, 0.1], dust: [0xe8c88a, 0, 0.5], shafts: null },
  toxic: { shade: [0xa4c474, 0xc4dc8c, 0xd0e69c], lamp: 0.75, haze: [0x5a8a20, 0.08], dust: [0xb8ff60, 30, 0.6], shafts: [0xd8f080, 0.35] },
};

/**
 * Tint pól "pamiętanych" (mgła wojny) skompensowany względem mapy światła nastroju:
 * ciepły gradient (zmierzch/burza/toksyny) mnoży scenę, więc kanały, które gradient
 * tłumi, podbijamy - po złożeniu pole wychodzi ciemne i neutralne zamiast brązowego.
 */
export function fogMemoryTint(base: RGB, mood: MoodName): RGB {
  const shade = MOODS[mood].shade;
  if (!shade) return base;
  let r = 0, g = 0, b = 0;
  for (const c of shade) (r += (c >> 16) & 255), (g += (c >> 8) & 255), (b += c & 255);
  const n = shade.length, m = Math.max(r, g, b) / n;
  const ch = (v: number, avg: number): number => Math.min(255, Math.round((v * m) / Math.max(1, avg / n)));
  return (ch((base >> 16) & 255, r) << 16) | (ch((base >> 8) & 255, g) << 8) | ch(base & 255, b);
}

interface Mote {
  img: Phaser.GameObjects.Image;
  vx: number;
  vy: number;
  ph: number;
  amp: number;
}

export interface AtmosphereOpts {
  art: ArtBook;
  seed: number;
  width: number;
  height: number;
  /** Lampy / ogniska / terminale widoczne teraz (piksele świata). */
  lamps: () => WorldLight[];
  /** Krótkotrwałe światła efektów (błyski, wybuchy, ogień). */
  fx: readonly FxLight[];
  /** Kolor pyłu biomu (nadpisuje kolor nastroju, gdy podany). */
  dustColor?: number;
}

export class Atmosphere {
  readonly mood: MoodName;
  private readonly scene: Phaser.Scene;
  private readonly overlay: Phaser.GameObjects.Container;
  private readonly o: AtmosphereOpts;
  private readonly def: MoodDef;
  private lightmap: Phaser.GameObjects.RenderTexture | null = null;
  private baseKey: string | null = null;
  private motes: Mote[] = [];
  private streaks: Mote[] = [];
  private fogs: { img: Phaser.GameObjects.Image; vx: number; ph: number; base: number }[] = [];
  private shafts: Phaser.GameObjects.Image | null = null;
  private flash: Phaser.GameObjects.Rectangle | null = null;
  private flashK = 0;
  private nextBolt = 6;
  private t = 0;
  private gust = 0;

  constructor(scene: Phaser.Scene, overlay: Phaser.GameObjects.Container, mood: MoodName, o: AtmosphereOpts) {
    this.scene = scene;
    this.overlay = overlay;
    this.mood = mood;
    this.o = o;
    this.def = MOODS[mood];
    this.build();
  }

  private build(): void {
    const { width: W, height: H, art } = this.o;
    const sc = this.scene;
    const add = <T extends Phaser.GameObjects.GameObject>(g: T): T => (this.overlay.add(g), g);
    art.get('atm_pool', () => ({ pc: paintLightPool(64, 40), ax: 0, ay: 0 }));
    art.get('atm_streak', () => ({ pc: paintStreak(), ax: 0, ay: 0 }));
    art.get('atm_spore', () => ({ pc: paintSpore(), ax: 0, ay: 0 }));
    const R = rng(this.o.seed ^ 0xa7);

    // promienie słońca (pod mapą światła - też zostają przyciemnione)
    if (this.def.shafts) {
      art.get('atm_shafts', () => ({ pc: paintSunShafts(7), ax: 0, ay: 0 }));
      this.shafts = add(sc.add.image(W * 0.1, -8, 'atm_shafts').setOrigin(0).setScale(W / 160 * 0.9, H / 120 * 1.1)
        .setBlendMode(Phaser.BlendModes.ADD).setTint(this.def.shafts[0]).setAlpha(this.def.shafts[1]));
    }
    // mapa oświetlenia: gradient nastroju * (1 + światła)
    if (this.def.shade) {
      this.baseKey = `atm_base_${this.mood}_${W}x${H}`;
      const stops = this.def.shade;
      art.get(this.baseKey, () => ({ pc: paintScreenGradient(W, H, stops), ax: 0, ay: 0 }));
      this.lightmap = add(sc.add.renderTexture(0, 0, W, H).setOrigin(0).setBlendMode(Phaser.BlendModes.MULTIPLY));
    }
    if (this.def.haze) add(sc.add.rectangle(0, 0, W, H, this.def.haze[0], this.def.haze[1]).setOrigin(0).setBlendMode(Phaser.BlendModes.ADD));

    // ławice mgły / podmuchy pyłu
    if (this.mood === 'toxic' || this.mood === 'storm') {
      for (let i = 0; i < 3; i++) art.get(`atm_fog${i}`, () => ({ pc: paintFogBank(101 + i * 17), ax: 0, ay: 0 }));
      const n = this.mood === 'toxic' ? 9 : 5;
      for (let i = 0; i < n; i++) {
        const toxic = this.mood === 'toxic';
        const img = add(sc.add.image(R() * (W + 200) - 100, H * (0.15 + R() * 0.85), `atm_fog${i % 3}`)
          .setTint(toxic ? (i % 2 ? 0x8ad040 : 0x5a9a28) : 0xc8a060).setScale(1.5 + R() * 1.5, 1 + R() * 0.8).setFlipX(R() < 0.5));
        const base = toxic ? 0.25 + R() * 0.25 : 0;
        img.setAlpha(base);
        this.fogs.push({ img, vx: (toxic ? 3 + R() * 5 : 140 + R() * 80) * (toxic && i % 2 ? -1 : 1), ph: R() * 10, base });
      }
    }

    // drobiny w powietrzu
    const [dc, n, op] = this.def.dust;
    const color = this.o.dustColor !== undefined && this.mood !== 'toxic' && this.mood !== 'night' ? this.o.dustColor : dc;
    const wind = this.mood === 'storm' ? 90 : this.mood === 'toxic' ? 2 : 5;
    for (let i = 0; i < n; i++) {
      const img = add(sc.add.image(R() * W, R() * H, 'fx_px').setTint(color).setAlpha(op * (0.3 + R() * 0.7)).setScale(R() < 0.75 ? 0.5 : 1));
      this.motes.push({ img, vx: wind * (0.5 + R()), vy: (R() - 0.5) * 3 + (this.mood === 'night' ? -1 : 1), ph: R() * 10, amp: 4 });
    }
    if (this.mood === 'toxic') {
      for (let i = 0; i < 34; i++) {
        const img = add(sc.add.image(R() * W, R() * H, 'atm_spore').setTint(R() < 0.5 ? 0xd8ff70 : 0x9aff50).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0.4 + R() * 0.5));
        this.motes.push({ img, vx: (R() - 0.5) * 6, vy: -(2 + R() * 5), ph: R() * 10, amp: 8 });
      }
    }
    if (this.mood === 'storm') {
      // smugi deszczu z pyłem, pochylone z wiatrem
      for (let i = 0; i < 150; i++) {
        const rain = i % 3 !== 0;
        const img = add(sc.add.image(R() * W, R() * H, 'atm_streak').setTint(rain ? 0xc0ccd8 : 0xe0c08a).setAlpha(rain ? 0.35 + R() * 0.3 : 0.25 + R() * 0.3)
          .setScale(1, rain ? 1 + R() * 0.8 : 0.6));
        this.streaks.push({ img, vx: rain ? 70 + R() * 20 : 160 + R() * 60, vy: rain ? 200 + R() * 60 : 20 + R() * 20, ph: 0, amp: 0 });
      }
      this.flash = add(sc.add.rectangle(0, 0, W, H, 0xe8f0ff, 0).setOrigin(0).setBlendMode(Phaser.BlendModes.ADD));
      this.nextBolt = 4 + R() * 5;
    }
  }

  update(dt: number): void {
    this.t += dt;
    const { width: W, height: H } = this.o;
    const t = this.t;
    for (const m of this.motes) {
      m.ph += dt;
      m.img.x += (m.vx * (1 + this.gust * 2) + Math.sin(m.ph * 0.7) * m.amp) * dt;
      m.img.y += (m.vy + Math.cos(m.ph * 0.9) * m.amp * 0.5) * dt;
      if (m.img.x > W + 3) m.img.x -= W + 6;
      else if (m.img.x < -3) m.img.x += W + 6;
      if (m.img.y > H + 3) m.img.y -= H + 6;
      else if (m.img.y < -3) m.img.y += H + 6;
    }
    for (const s of this.streaks) {
      s.img.x += s.vx * (1 + this.gust) * dt;
      s.img.y += s.vy * dt;
      if (s.img.y > H + 8) { s.img.y -= H + 16; s.img.x = Math.random() * W - 40; }
      if (s.img.x > W + 8) s.img.x -= W + 16;
    }
    for (const f of this.fogs) {
      f.ph += dt;
      if (this.mood === 'storm') {
        // podmuch: ławica pyłu przelatuje przez ekran co kilka sekund
        f.img.x += f.vx * dt;
        f.img.setAlpha(this.gust * 0.55);
        if (f.img.x > W + 220) { f.img.x = -220 - Math.random() * 300; f.img.y = H * (0.1 + Math.random() * 0.9); }
      } else {
        f.img.x += f.vx * dt;
        f.img.y += Math.sin(f.ph * 0.3) * 2 * dt;
        f.img.setAlpha(f.base * (0.75 + 0.25 * Math.sin(f.ph * 0.5)));
        if (f.img.x > W + 200) f.img.x = -200;
        else if (f.img.x < -200) f.img.x = W + 200;
      }
    }
    if (this.shafts) this.shafts.setAlpha((this.def.shafts?.[1] ?? 0) * (0.7 + 0.3 * Math.sin(t * 0.4)));
    if (this.mood === 'storm') {
      this.gust = Math.max(0, Math.sin(t * 0.45) * Math.sin(t * 0.17 + 1)) ** 2;
      this.nextBolt -= dt;
      if (this.nextBolt <= 0) this.lightning();
      this.flashK = Math.max(0, this.flashK - dt * 3.2);
      this.flash?.setAlpha(this.flashK * 0.55);
    }
    this.drawLightmap();
  }

  /** Błyskawica: podwójny błysk ekranu, piorun na tle, grzmot z opóźnieniem. */
  private lightning(): void {
    const { width: W, height: H, art } = this.o;
    this.nextBolt = 7 + Math.random() * 9;
    const sc = this.scene;
    this.flashK = 1;
    sc.time.delayedCall(140, () => { this.flashK = Math.max(this.flashK, 0.75); });
    const seed = Math.floor(Math.random() * 6);
    const key = `atm_bolt${seed}`;
    art.get(key, () => ({ pc: paintLightning(48, 150, 900 + seed * 31), ax: 0, ay: 0 }));
    const bolt = sc.add.image(W * (0.15 + Math.random() * 0.7), 0, key).setOrigin(0.5, 0).setBlendMode(Phaser.BlendModes.ADD).setScale(1, H / 150 * 0.8);
    // błyskawica pod mapą światła (za gradientem), ale nad światem
    this.overlay.addAt(bolt, 0);
    sc.tweens.add({ targets: bolt, alpha: { from: 1, to: 0 }, duration: 260, ease: 'Stepped', easeParams: [3], onComplete: () => bolt.destroy() });
    const delay = 250 + Math.random() * 900;
    sc.time.delayedCall(delay, () => {
      try {
        SoundManager.sfx('thunder', { vol: 0.5 + Math.random() * 0.4, pitch: 0.85 + Math.random() * 0.3 });
      } catch {
        // dźwięk opcjonalny
      }
    });
  }

  /** Mapa oświetlenia: gradient nastroju + światła ADD; rysowana z MULTIPLY na scenę. */
  private drawLightmap(): void {
    const rt = this.lightmap;
    if (!rt || !this.baseKey) return;
    const cam = this.scene.cameras.main;
    const wv = cam.worldView;
    if (!wv.width) return;
    const { width: W } = this.o;
    const k = W / wv.width; // piksele projektowe na piksel świata
    const toX = (x: number): number => (x - wv.x) * k, toY = (y: number): number => (y - wv.y) * k;
    rt.clear();
    rt.stamp(this.baseKey, undefined, 0, 0, { originX: 0, originY: 0 });
    const stamp = (x: number, y: number, r: number, color: number, a: number): void => {
      const sx = toX(x), sy = toY(y), sr = r * k;
      if (a <= 0.01 || sx < -sr || sy < -sr || sx > W + sr || sy > this.o.height + sr) return;
      rt.stamp('atm_pool', undefined, Math.round(sx), Math.round(sy), { scale: (sr * 2) / 64, tint: color, alpha: Math.min(1, a), blendMode: Phaser.BlendModes.ADD });
    };
    const lamp = this.def.lamp;
    if (lamp > 0) for (const l of this.o.lamps()) stamp(l.x, l.y, l.r, l.color, l.a * lamp);
    for (const l of this.o.fx) stamp(l.x, l.y, l.r, l.color, WorldFx.lightK(l) * (this.mood === 'night' ? 1.2 : 0.8));
    if (this.flashK > 0) rt.stamp('fx_px', undefined, 0, 0, { originX: 0, originY: 0, scaleX: W / 2, scaleY: this.o.height / 2, alpha: this.flashK * 0.7, blendMode: Phaser.BlendModes.ADD });
    rt.render();
  }
}
