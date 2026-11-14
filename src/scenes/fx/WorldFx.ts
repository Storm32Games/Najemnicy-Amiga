// Efekty walki w świecie (port Oldgame/src/gfx/effects.js:46-108 do pixel artu 2D):
// błysk wylotowy, smugi pocisków wg broni, wybuch (błysk, fala, kule ognia, dym, odłamki), dym granatu,
// ogień, pył, iskry maszyn, krew, leczenie, wzmocnienie. Krótkotrwałe światła trafiają do `lights`
// (czyta je Atmosphere: mapa oświetlenia nocą).
// Współrzędne = piksele świata (te same co sprite'y jednostek); scena podaje warstwy głębi.

import Phaser from 'phaser';
import type { ArtBook } from '../iso/IsoArt';
import {
  paintChevron, paintDebris, paintFireball, paintFlicker, paintHealCross, paintMuzzle, paintPuffs, paintShockRing, paintSpark,
} from '../iso/FxArt';
import { mix } from '../iso/Pixel';

export interface FxLight {
  x: number;
  y: number;
  color: number;
  /** Promień w pikselach świata. */
  r: number;
  a: number;
  t: number;
  life: number;
  /** Migotanie (ogień). */
  flicker?: boolean;
}

export interface FxDepths {
  /** Na ziemi pod postaciami (fala uderzeniowa, krąg wzmocnienia). */
  ground: number;
  /** Ponad wszystkim w świecie (iskry, błyski, smugi). */
  air: number;
  /** Dym zasłaniający pole (pod napisami). */
  smoke: number;
}

export type TracerStyle = 'pistol' | 'rifle' | 'smg' | 'shotgun' | 'laser' | 'plasma' | 'flame' | 'lob';

/** Styl smugi z nazwy dźwięku broni (NormWeapon.sfx) i typu obrażeń. */
export function tracerStyleFor(sfx: string, dmgType?: string, weaponId?: string | null): TracerStyle {
  if (dmgType === 'fire' && sfx === 'explosion') return 'flame';
  if (sfx === 'shot_laser') return weaponId && /plasma|pulse|tesla/.test(weaponId) ? 'plasma' : 'laser';
  if (dmgType === 'elec') return 'plasma';
  if (sfx === 'shot_smg') return 'smg';
  if (sfx === 'shot_shotgun') return 'shotgun';
  if (sfx === 'shot_rifle') return 'rifle';
  if (sfx === 'explosion') return 'lob';
  return 'pistol';
}

const R = (a: number, b: number): number => a + Math.random() * (b - a);

export class WorldFx {
  readonly lights: FxLight[] = [];
  private readonly scene: Phaser.Scene;
  private readonly d: FxDepths;

  constructor(scene: Phaser.Scene, depths: FxDepths) {
    this.scene = scene;
    this.d = depths;
  }

  /** Rejestruje tekstury efektów (raz na scenę; ArtBook pomija istniejące). */
  static textures(art: ArtBook): void {
    const one = (key: string, pc: ReturnType<typeof paintSpark>) => art.get(key, () => ({ pc, ax: 0, ay: 0 }));
    const fb = paintFireball();
    art.sheet('fxa_fireball', fb.pc, fb.frames);
    const pf = paintPuffs();
    art.sheet('fxa_puff', pf.pc, pf.frames);
    const fl = paintFlicker();
    art.sheet('fxa_flicker', fl.pc, fl.frames);
    const mz = paintMuzzle();
    art.sheet('fxa_muzzle', mz.pc, mz.frames);
    const rg = paintShockRing();
    art.sheet('fxa_ring', rg.pc, rg.frames);
    const db = paintDebris();
    art.sheet('fxa_debris', db.pc, db.frames);
    one('fxa_cross', paintHealCross());
    one('fxa_chevron', paintChevron());
    one('fxa_spark', paintSpark());
  }

  update(dt: number): void {
    for (let i = this.lights.length - 1; i >= 0; i--) {
      const l = this.lights[i];
      l.t += dt;
      if (l.t >= l.life) this.lights.splice(i, 1);
    }
  }

  /** Bieżąca jasność światła (0..1) z zanikiem i migotaniem. */
  static lightK(l: FxLight): number {
    const k = l.life === Infinity ? 1 : Math.max(0, 1 - l.t / l.life);
    return l.a * k * (l.flicker ? 0.8 + Math.random() * 0.3 : 1);
  }

  light(x: number, y: number, color: number, r: number, a: number, life: number, flicker = false): FxLight {
    const l: FxLight = { x, y, color, r, a, t: 0, life, flicker };
    this.lights.push(l);
    return l;
  }

  // ------------------------------------------------------------------ prymitywy

  private img(x: number, y: number, key: string, frame?: string, depth = this.d.air): Phaser.GameObjects.Image {
    return this.scene.add.image(Math.round(x), Math.round(y), key, frame).setDepth(depth);
  }

  /** Odtwarza klatki f0..f(n-1) w czasie `ms`, potem onDone. */
  private frames(o: Phaser.GameObjects.Image, n: number, ms: number, onDone?: () => void, from = 0): void {
    const st = { f: from };
    this.scene.tweens.add({
      targets: st, f: n - 0.001, duration: ms, ease: 'Linear',
      onUpdate: () => { if (o.active) o.setFrame(`f${Math.floor(st.f)}`); },
      onComplete: () => onDone?.(),
    });
  }

  /** Pocisk balistyczny (odłamek, kropla, iskra): lot w bok + łuk w górę i opad. */
  private ballistic(o: Phaser.GameObjects.Image, vx: number, up: number, fall: number, ms: number, fade = 260): void {
    const x0 = o.x, y0 = o.y;
    const st = { t: 0 };
    this.scene.tweens.add({
      targets: st, t: 1, duration: ms, ease: 'Linear',
      onUpdate: () => {
        const t = st.t;
        o.setPosition(Math.round(x0 + vx * t), Math.round(y0 - up * 4 * t * (1 - t) + fall * t));
      },
      onComplete: () => this.scene.tweens.add({ targets: o, alpha: 0, duration: fade, onComplete: () => o.destroy() }),
    });
  }

  private glow(x: number, y: number, color: number, scale: number, alpha: number, ms: number, depth = this.d.air): void {
    const g = this.img(x, y, 'fx_glow', undefined, depth).setBlendMode(Phaser.BlendModes.ADD).setTint(color).setScale(scale * 0.6).setAlpha(alpha);
    this.scene.tweens.add({ targets: g, alpha: 0, scale, duration: ms, ease: 'Quad.easeOut', onComplete: () => g.destroy() });
  }

  // ------------------------------------------------------------------ broń

  /** Błysk wylotowy przy broni strzelca + krótka poświata i iskry w stronę strzału. */
  muzzle(x: number, y: number, dirX: number, dirY: number, color = 0xffc060): void {
    const s = this.img(x, y, 'fxa_muzzle', 'f0').setBlendMode(Phaser.BlendModes.ADD);
    this.frames(s, 3, 110, () => s.destroy());
    this.glow(x, y, color, 0.45, 0.85, 140);
    this.light(x, y + 10, color, 70, 0.9, 0.12);
    const len = Math.hypot(dirX, dirY) || 1;
    for (let i = 0; i < 5; i++) {
      const p = this.img(x, y, 'fx_px').setBlendMode(Phaser.BlendModes.ADD).setTint(i % 2 ? 0xffe27a : 0xff9a30).setScale(0.5);
      const sp = R(8, 18);
      this.scene.tweens.add({
        targets: p, x: x + (dirX / len) * sp + R(-3, 3), y: y + (dirY / len) * sp + R(-3, 2), alpha: 0, duration: R(120, 200),
        onComplete: () => p.destroy(),
      });
    }
  }

  /** Smuga pocisku (styl wg broni). Promise kończy się, gdy pocisk dotrze do celu. */
  tracer(x0: number, y0: number, x1: number, y1: number, style: TracerStyle): Promise<void> {
    switch (style) {
      case 'laser':
      case 'plasma':
        return this.beam(x0, y0, x1, y1, style === 'laser' ? [0xffffff, 0xff3a3a, 0xff1a40] : [0xffffff, 0x46f2ff, 0x2a8aff]);
      case 'flame':
        return this.flameJet(x0, y0, x1, y1);
      case 'lob':
        return this.lob(x0, y0, x1, y1);
      case 'smg': {
        const shots = [0, 55, 110].map((delay) => new Promise<void>((res) =>
          this.scene.time.delayedCall(delay, () => void this.bullet(x0, y0, x1 + R(-3, 3), y1 + R(-3, 3), 1, 0.35).then(res))));
        return shots[0].then(() => undefined);
      }
      case 'shotgun': {
        const all = Array.from({ length: 6 }, () => this.bullet(x0, y0, x1 + R(-7, 7), y1 + R(-5, 5), 1, 0.22, 0xffd890));
        return all[0];
      }
      case 'rifle':
        return this.bullet(x0, y0, x1, y1, 2, 0.5);
      default:
        return this.bullet(x0, y0, x1, y1, 1, 0.3);
    }
  }

  /** Jasny pocisk z poświatą: rdzeń `w` px, ogon = `tail` długości toru. */
  private bullet(x0: number, y0: number, x1: number, y1: number, w: number, tail: number, core = 0xfff6c8): Promise<void> {
    const g = this.scene.add.graphics().setDepth(this.d.air);
    const gl = this.scene.add.graphics().setDepth(this.d.air).setBlendMode(Phaser.BlendModes.ADD);
    const len = Math.hypot(x1 - x0, y1 - y0);
    const dur = Math.max(70, Math.min(170, len * 0.9));
    const st = { k: 0 };
    return new Promise<void>((resolve) => {
      let done = false;
      this.scene.tweens.add({
        targets: st, k: 1 + tail, duration: dur * (1 + tail), ease: 'Linear',
        onUpdate: () => {
          const h = Math.min(1, st.k), t = Math.max(0, st.k - tail);
          const hx = x0 + (x1 - x0) * h, hy = y0 + (y1 - y0) * h, tx = x0 + (x1 - x0) * t, ty = y0 + (y1 - y0) * t;
          g.clear().lineStyle(w, core, 1).lineBetween(tx, ty, hx, hy);
          g.fillStyle(0xffffff, 1).fillRect(Math.round(hx) - 1, Math.round(hy) - 1, 2, 2);
          gl.clear().lineStyle(w + 2, 0xffa030, 0.45).lineBetween(tx, ty, hx, hy);
          if (st.k >= 1 && !done) { done = true; resolve(); }
        },
        onComplete: () => { g.destroy(); gl.destroy(); if (!done) resolve(); },
      });
    });
  }

  /** Wiązka energii: natychmiastowa, migocze i gaśnie; trzy warstwy (rdzeń / kolor / poświata). */
  private beam(x0: number, y0: number, x1: number, y1: number, cols: [number, number, number]): Promise<void> {
    const g = this.scene.add.graphics().setDepth(this.d.air).setBlendMode(Phaser.BlendModes.ADD);
    const core = this.scene.add.graphics().setDepth(this.d.air);
    const draw = (k: number): void => {
      g.clear().lineStyle(5, cols[2], 0.28 * k).lineBetween(x0, y0, x1, y1).lineStyle(3, cols[1], 0.75 * k).lineBetween(x0, y0, x1, y1);
      core.clear().lineStyle(1, cols[0], k).lineBetween(x0, y0, x1, y1);
    };
    draw(1);
    this.light(x1, y1 + 8, cols[1], 60, 0.9, 0.25);
    this.light((x0 + x1) / 2, (y0 + y1) / 2 + 8, cols[1], 50, 0.5, 0.2);
    for (let i = 0; i < 6; i++) {
      const p = this.img(x1, y1, 'fxa_spark').setBlendMode(Phaser.BlendModes.ADD).setTint(i % 2 ? cols[1] : 0xffffff);
      this.ballistic(p, R(-12, 12), R(3, 9), R(2, 8), R(160, 260), 120);
    }
    const st = { k: 1 };
    return new Promise<void>((resolve) => {
      this.scene.time.delayedCall(40, resolve);
      this.scene.tweens.add({
        targets: st, k: 0, duration: 230, ease: 'Quad.easeIn',
        onUpdate: () => draw(st.k * (0.75 + Math.random() * 0.25)),
        onComplete: () => { g.destroy(); core.destroy(); },
      });
    });
  }

  /** Strumień miotacza ognia: kłęby płomieni lecące od dyszy do celu, rosnące i ciemniejące. */
  flameJet(x0: number, y0: number, x1: number, y1: number): Promise<void> {
    const n = 14;
    const len = Math.hypot(x1 - x0, y1 - y0);
    const dur = Math.max(160, Math.min(320, len * 2));
    this.light(x0, y0 + 10, 0xff8a30, 80, 0.9, 0.5, true);
    this.light(x1, y1 + 10, 0xff7a20, 90, 1, 0.7, true);
    for (let i = 0; i < n; i++) {
      this.scene.time.delayedCall(i * 22, () => {
        const f = this.img(x0, y0, 'fxa_fireball', 'f0').setScale(0.35).setBlendMode(i % 3 === 0 ? Phaser.BlendModes.NORMAL : Phaser.BlendModes.ADD);
        const ex = x1 + R(-6, 6), ey = y1 + R(-6, 4);
        this.scene.tweens.add({ targets: f, x: ex, y: ey, scale: R(0.8, 1.1), duration: dur, ease: 'Quad.easeOut' });
        this.frames(f, 7, dur + 140, () => f.destroy(), 0);
      });
    }
    return new Promise<void>((resolve) => this.scene.time.delayedCall(dur * 0.8, () => {
      this.fire(x1, y1 + 12, 900, 0.8);
      resolve();
    }));
  }

  /** Rzut granatu po łuku (ciemna kropka z cieniem). */
  private lob(x0: number, y0: number, x1: number, y1: number): Promise<void> {
    const nade = this.img(x0, y0, 'fx_px').setTint(0x2a2a22).setScale(1.5);
    const len = Math.hypot(x1 - x0, y1 - y0);
    const dur = Math.max(220, Math.min(480, len * 2.2));
    const arc = Math.min(48, 14 + len * 0.3);
    const st = { t: 0 };
    return new Promise<void>((resolve) =>
      this.scene.tweens.add({
        targets: st, t: 1, duration: dur, ease: 'Linear',
        onUpdate: () => nade.setPosition(Math.round(x0 + (x1 - x0) * st.t), Math.round(y0 + (y1 - y0) * st.t - arc * 4 * st.t * (1 - st.t))),
        onComplete: () => { nade.destroy(); resolve(); },
      }),
    );
  }

  // ------------------------------------------------------------------ wybuchy, dym, ogień

  /**
   * Wybuch w punkcie (x, y) = środek pola na ziemi. r = promień w polach.
   * kind: frag (odłamkowy), fire (mołotow - ogień zostaje), elec (EMP - niebieskie wyładowania).
   */
  explosion(x: number, y: number, r = 1.5, kind: 'frag' | 'fire' | 'elec' = 'frag'): void {
    const sc = this.scene;
    const elec = kind === 'elec';
    const ringCol = elec ? 0x8ad0ff : kind === 'fire' ? 0xffa040 : 0xffd890;
    // 1. biały błysk + światło
    this.glow(x, y - 8, 0xffffff, 0.7 + r * 0.4, 1, 160);
    this.glow(x, y - 4, elec ? 0x60a0ff : 0xff9a40, 1 + r * 0.6, 0.9, 520, this.d.ground + 0.2);
    this.light(x, y, elec ? 0x80b0ff : 0xffa050, 110 + r * 40, 1, 0.7);
    // 2. fala uderzeniowa (elipsa izometryczna na ziemi)
    const ring = this.img(x, y, 'fxa_ring', 'f0', this.d.ground).setBlendMode(Phaser.BlendModes.ADD).setTint(ringCol).setScale(Math.max(0.7, r * 0.7));
    this.frames(ring, 7, 300, () => sc.tweens.add({ targets: ring, alpha: 0, duration: 120, onComplete: () => ring.destroy() }));
    // 3. kule ognia / wyładowania
    if (elec) {
      for (let i = 0; i < 5; i++) {
        sc.time.delayedCall(i * 50, () => {
          const g = sc.add.graphics().setDepth(this.d.air).setBlendMode(Phaser.BlendModes.ADD);
          let px = x, py = y - 6;
          const a = Math.random() * Math.PI * 2, L = 10 + r * 10;
          g.lineStyle(1, 0xd8f0ff, 1).beginPath().moveTo(px, py);
          for (let s = 1; s <= 5; s++) {
            px = x + Math.cos(a) * L * (s / 5) + R(-3, 3);
            py = y - 6 + Math.sin(a) * L * 0.5 * (s / 5) + R(-3, 3);
            g.lineTo(px, py);
          }
          g.strokePath();
          sc.tweens.add({ targets: g, alpha: 0, duration: 160, onComplete: () => g.destroy() });
        });
      }
    } else {
      const n = 7 + Math.round(r * 2);
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, dist = R(0, 10 + r * 6);
        const fx0 = x + Math.cos(a) * dist, fy0 = y - 6 + Math.sin(a) * dist * 0.5;
        sc.time.delayedCall(R(0, 110), () => {
          const f = this.img(fx0, fy0, 'fxa_fireball', 'f0').setScale(R(0.7, 1.1) * (0.8 + r * 0.25));
          sc.tweens.add({ targets: f, x: fx0 + Math.cos(a) * 8, y: fy0 - R(10, 22), duration: 620, ease: 'Quad.easeOut' });
          this.frames(f, 7, R(520, 700), () => sc.tweens.add({ targets: f, alpha: 0, duration: 120, onComplete: () => f.destroy() }));
        });
      }
    }
    // 4. słup dymu
    for (let i = 0; i < 7; i++) {
      sc.time.delayedCall(140 + i * 60, () => {
        const p = this.img(x + R(-8, 8) * r, y - 8 + R(-4, 2), 'fxa_puff', `f${2 + (i % 2)}`, this.d.smoke)
          .setTint(elec ? 0x5a6070 : mix(0x2a2420, 0x6a5e54, Math.random())).setAlpha(0).setScale(0.6);
        sc.tweens.add({ targets: p, alpha: { from: 0.85, to: 0 }, scale: R(1.3, 1.9), y: p.y - R(26, 44), x: p.x + R(2, 10), duration: R(1300, 1800), ease: 'Sine.easeOut', onComplete: () => p.destroy() });
      });
    }
    // 5. odłamki i żar
    for (let i = 0; i < 16; i++) {
      const isEmber = i % 3 === 0;
      const p = this.img(x, y - 6, isEmber ? 'fx_px' : 'fxa_debris', isEmber ? undefined : `f${i % 4}`)
        .setTint(isEmber ? (elec ? 0x9ad8ff : 0xffa030) : [0x3a2a20, 0x7a5a3a, 0x8a8478, 0x5a4a3a][i % 4])
        .setScale(isEmber ? 0.5 : 1);
      if (isEmber) p.setBlendMode(Phaser.BlendModes.ADD);
      const a = Math.random() * Math.PI * 2, sp = R(14, 30) * (0.7 + r * 0.35);
      this.ballistic(p, Math.cos(a) * sp, R(10, 26), Math.sin(a) * sp * 0.5 + 6, R(420, 620), isEmber ? 200 : 900);
    }
    // 6. pył przy ziemi
    this.dust(x, y, elec ? 0x8a9098 : 0x9a8a70, 8, 14 + r * 8);
    if (kind === 'fire') {
      this.fire(x, y, 2600, 1);
      for (let i = 0; i < 3; i++) this.fire(x + R(-14, 14) * r, y + R(-6, 6) * r, R(1600, 2400), 0.7);
    }
  }

  /** Dym granatu: kłębiąca się chmura nad obszarem przez `ms` (rx = promień w pikselach świata). */
  smokeCloud(x: number, y: number, rx: number, ms = 6000): void {
    const sc = this.scene;
    const ry = rx / 2;
    const spawn = (burst: boolean): void => {
      const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random());
      const px = x + Math.cos(a) * rx * d, py = y + Math.sin(a) * ry * d - R(2, 10);
      const p = this.img(px, py, 'fxa_puff', `f${2 + (Math.random() < 0.5 ? 1 : 0)}`, this.d.smoke)
        .setTint(mix(0x8a8c88, 0xd8dad4, Math.random())).setAlpha(0).setScale(burst ? 0.4 : R(0.8, 1.1)).setFlipX(Math.random() < 0.5);
      const life = R(2000, 2800);
      sc.tweens.add({ targets: p, alpha: R(0.7, 0.9), duration: burst ? 200 : 600, ease: 'Sine.easeOut' });
      sc.tweens.add({ targets: p, scale: R(1.4, 1.9), x: px + R(2, 10), y: py - R(4, 12), duration: life, ease: 'Sine.easeOut' });
      sc.tweens.add({ targets: p, alpha: 0, delay: life * 0.55, duration: life * 0.45, onComplete: () => p.destroy() });
    };
    for (let i = 0; i < 16; i++) spawn(true);
    this.dust(x, y, 0xb0b0a8, 8, rx);
    const ev = sc.time.addEvent({ delay: 110, repeat: Math.floor(ms / 110), callback: () => { spawn(false); if (Math.random() < 0.5) spawn(false); } });
    sc.time.delayedCall(ms + 200, () => ev.remove());
  }

  /** Ogień w punkcie przez `ms` (lub do destroy()): płomyki, poświata, światło, unoszący się żar. */
  fire(x: number, y: number, ms: number, scale = 1): { setPosition(x: number, y: number): void; destroy(): void } {
    const sc = this.scene;
    const flames = [0, 1, 2].map((i) => {
      const f = sc.add.image(0, 0, 'fxa_flicker', `f${i}`).setOrigin(0.5, 1).setDepth(this.d.air - 0.5).setBlendMode(i === 1 ? Phaser.BlendModes.NORMAL : Phaser.BlendModes.ADD).setScale(scale * (i === 1 ? 1.2 : 0.9));
      return { f, dx: (i - 1) * 4 * scale, dy: i === 1 ? 1 : 0, ph: i };
    });
    const glow = sc.add.image(0, 0, 'fx_glow').setDepth(this.d.ground + 0.1).setBlendMode(Phaser.BlendModes.ADD).setTint(0xff7a20).setScale(0.45 * scale).setAlpha(0.55);
    const light = this.light(x, y, 0xff8a30, 80 * scale, 0.9, Infinity, true);
    let px = x, py = y, t = 0, dead = false;
    const place = (): void => {
      for (const fl of flames) fl.f.setPosition(Math.round(px + fl.dx), Math.round(py + fl.dy));
      glow.setPosition(Math.round(px), Math.round(py - 2));
      light.x = px;
      light.y = py;
    };
    place();
    const tick = sc.time.addEvent({
      delay: 90, loop: true,
      callback: () => {
        t += 90;
        for (const fl of flames) fl.f.setFrame(`f${(Math.floor(t / 90) + fl.ph) % 4}`);
        glow.setAlpha(0.45 + Math.random() * 0.2);
        if (Math.random() < 0.5) {
          const e = sc.add.image(px + R(-4, 4) * scale, py - 6, 'fx_px').setDepth(this.d.air).setBlendMode(Phaser.BlendModes.ADD).setTint(Math.random() < 0.5 ? 0xffd060 : 0xff8a30).setScale(0.5);
          sc.tweens.add({ targets: e, y: e.y - R(10, 22), x: e.x + R(-3, 5), alpha: 0, duration: R(500, 900), onComplete: () => e.destroy() });
        }
        if (Math.random() < 0.12) {
          const s = sc.add.image(px + R(-3, 3), py - 12 * scale, 'fxa_puff', 'f0').setDepth(this.d.air - 0.6).setTint(0x3a3430).setAlpha(0.5);
          sc.tweens.add({ targets: s, y: s.y - 18, scale: 1.8, alpha: 0, duration: 1100, onComplete: () => s.destroy() });
        }
      },
    });
    const destroy = (): void => {
      if (dead) return;
      dead = true;
      tick.remove();
      light.life = light.t + 0.3;
      sc.tweens.add({ targets: [...flames.map((f) => f.f), glow], alpha: 0, scaleY: 0.3, duration: 300, onComplete: () => { flames.forEach((f) => f.f.destroy()); glow.destroy(); } });
    };
    if (Number.isFinite(ms)) sc.time.delayedCall(ms, destroy);
    return { setPosition: (nx: number, ny: number) => { px = nx; py = ny; if (!dead) place(); }, destroy };
  }

  /** Pył spod stóp / przy upadku / trafieniu w ziemię: kłęby rozchodzące się po elipsie. */
  dust(x: number, y: number, color = 0xb09068, n = 4, spread = 8): void {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + R(-0.4, 0.4);
      const p = this.img(x + Math.cos(a) * 2, y - 1, 'fxa_puff', `f${i % 2}`, this.d.ground + 0.4).setTint(color).setAlpha(0.65).setScale(R(0.5, 0.8));
      this.scene.tweens.add({
        targets: p, x: x + Math.cos(a) * spread, y: y + Math.sin(a) * spread * 0.5 - R(2, 5), scale: R(1, 1.4), alpha: 0, duration: R(420, 620), ease: 'Quad.easeOut',
        onComplete: () => p.destroy(),
      });
    }
  }

  /** Iskry z trafionej maszyny (zamiast krwi) + kapka oleju. */
  sparks(x: number, y: number, n = 12): void {
    this.glow(x, y, 0xfff0b0, 0.3, 0.9, 120);
    this.light(x, y + 10, 0xffd080, 50, 0.8, 0.15);
    for (let i = 0; i < n; i++) {
      const p = this.img(x, y, i % 3 ? 'fx_px' : 'fxa_spark').setBlendMode(Phaser.BlendModes.ADD).setTint([0xffffff, 0xfff0a0, 0xffc040, 0xff8a30][i % 4]).setScale(i % 3 ? 0.5 : 1);
      this.ballistic(p, R(-22, 22), R(6, 16), R(6, 14), R(240, 400), 90);
    }
    for (let i = 0; i < 3; i++) {
      const p = this.img(x, y, 'fx_px').setTint(0x14141a).setScale(0.5);
      this.ballistic(p, R(-8, 8), R(2, 6), R(8, 12), R(260, 360), 400);
    }
    const s = this.img(x, y - 2, 'fxa_puff', 'f0').setTint(0x3a3a40).setAlpha(0.6).setScale(0.6);
    this.scene.tweens.add({ targets: s, y: s.y - 12, scale: 1.2, alpha: 0, duration: 600, onComplete: () => s.destroy() });
  }

  /** Krew z trafionej istoty: krople po łuku, ciemne i jasne. */
  blood(x: number, y: number, n = 12): void {
    for (let i = 0; i < n; i++) {
      const p = this.img(x, y, 'fx_px').setTint([0xc43d2f, 0x8a1d17, 0xe0604a, 0x6a1410][i % 4]).setScale(i % 3 ? 0.5 : 1);
      this.ballistic(p, R(-16, 16), R(5, 13), R(8, 14), R(300, 440), 380);
    }
  }

  /** Rykoszet / chybienie: iskra i pył przy ziemi obok celu. */
  ricochet(x: number, y: number): void {
    for (let i = 0; i < 4; i++) {
      const p = this.img(x, y - 2, 'fx_px').setBlendMode(Phaser.BlendModes.ADD).setTint(0xfff0a0).setScale(0.5);
      this.ballistic(p, R(-10, 10), R(4, 10), R(-2, 4), R(150, 240), 60);
    }
    this.dust(x, y, 0xa89878, 3, 6);
  }

  /** Leczenie: zielone krzyżyki unoszą się z kołysaniem + iskierki + poświata. */
  heal(x: number, y: number): void {
    this.glow(x, y - 2, 0x60ff80, 0.5, 0.5, 700, this.d.ground + 0.2);
    this.light(x, y, 0x60ff80, 60, 0.8, 1);
    for (let i = 0; i < 7; i++) {
      this.scene.time.delayedCall(i * 75, () => {
        const cx = x + R(-9, 9), cy = y - R(2, 16);
        const c = this.img(cx, cy, 'fxa_cross').setAlpha(0);
        const st = { k: 0 };
        this.scene.tweens.add({
          targets: st, k: 1, duration: 850, ease: 'Linear',
          onUpdate: () => c.setPosition(Math.round(cx + Math.sin(st.k * 9) * 2), Math.round(cy - st.k * 16)).setAlpha(Math.sin(st.k * Math.PI)),
          onComplete: () => c.destroy(),
        });
      });
    }
    for (let i = 0; i < 10; i++) {
      const p = this.img(x + R(-8, 8), y - R(0, 6), 'fx_px').setBlendMode(Phaser.BlendModes.ADD).setTint(i % 2 ? 0xb8ffb8 : 0x6aff7a).setScale(0.5);
      this.scene.tweens.add({ targets: p, y: p.y - R(14, 26), alpha: 0, delay: R(0, 300), duration: R(600, 900), onComplete: () => p.destroy() });
    }
  }

  /** Wzmocnienie: złoty krąg wznoszący się od stóp + szewrony + iskry. */
  buff(x: number, y: number, color = 0xffd060): void {
    const ring = this.img(x, y, 'fxa_ring', 'f1', this.d.air - 0.2).setBlendMode(Phaser.BlendModes.ADD).setTint(color).setScale(0.9);
    this.scene.tweens.add({ targets: ring, y: y - 26, scale: 1.1, alpha: 0, duration: 800, ease: 'Quad.easeOut', onComplete: () => ring.destroy() });
    const ring2 = this.img(x, y, 'fxa_ring', 'f2', this.d.ground).setBlendMode(Phaser.BlendModes.ADD).setTint(color).setScale(0.6).setAlpha(0.9);
    this.scene.tweens.add({ targets: ring2, scale: 0.9, alpha: 0, duration: 600, onComplete: () => ring2.destroy() });
    this.light(x, y, color, 55, 0.7, 0.8);
    for (let i = 0; i < 3; i++) {
      const c = this.img(x + (i - 1) * 7, y - 8 - (i === 1 ? 4 : 0), 'fxa_chevron').setTint(color === 0xffd060 ? 0xffffff : color).setAlpha(0);
      this.scene.tweens.add({ targets: c, alpha: { from: 1, to: 0 }, y: c.y - 16, delay: i * 90, duration: 700, ease: 'Quad.easeOut', onComplete: () => c.destroy() });
    }
    for (let i = 0; i < 8; i++) {
      const p = this.img(x + R(-9, 9), y - R(0, 10), 'fx_px').setBlendMode(Phaser.BlendModes.ADD).setTint(i % 2 ? 0xffffff : color).setScale(0.5);
      this.scene.tweens.add({ targets: p, y: p.y - R(12, 22), alpha: 0, delay: R(0, 250), duration: 700, onComplete: () => p.destroy() });
    }
  }
}
