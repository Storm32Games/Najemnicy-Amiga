import Phaser from 'phaser';
import { MOODS, backdrop } from './fx/Backdrops';
import { SoundManager } from '../audio/SoundManager';
import { recruitCharacter, startCampaign } from '../core/campaign/session';
import { MAX_PARTY } from '../core/campaign/state';
import { ANCESTRIES } from '../core/data/ancestries';
import { CLASSES } from '../core/data/classes';
import { NAME_COLORS, generateName, plainName } from '../core/data/names';
import { RECRUITS } from '../core/data/recruits';
import { ATTRS, ATTR_NAMES, PROF_NAMES, SKILLS, UNIVERSAL_ABILITIES } from '../core/data/rules';
import type { AncestryDef, RecruitDef, SkillId } from '../core/data/types';
import { abilityDef, ancestryOf, classDef, itemDef } from '../core/rules/lookup';
import { getStat } from '../core/rules/stats';
import type { Character } from '../core/rules/types';
import { BASE_H, BASE_W, Motes, PAL, PixelText, SMALL_TEXT, type UiButton, button, cut, enter, goto, hex, label, panel, parseColor } from './ui/Kit';
import { SPRITE_DIRS, hasSprite, spriteIdOf, spriteTexKey } from './iso/SpriteUnits';
import { Tip, miniButton, modalOpen, namePrompt, openWindow, portrait } from './ui/Widgets';

// Werbunek (port Oldgame/src/scenes/recruit.js): wybierz dokładnie 4 z 16 gotowych najemników.

const ATTR_SHORT: Record<(typeof ATTRS)[number], string> = { str: 'SIŁ', dex: 'ZRĘ', con: 'KON', int: 'INT', wis: 'MĄD', cha: 'CHA' };
const signed = (n: number): string => (n >= 0 ? '+' : '') + n;
const GRID_X = 8, GRID_Y = 34, CARD_W = 38, CARD_H = 46, GAP = 3;
const DET_X = 182, DET_Y = 22, DET_W = 290, DET_H = 212;

interface Card {
  r: RecruitDef;
  bg: Phaser.GameObjects.Rectangle;
  mark: PixelText;
  name: PixelText;
}

export class RecruitScene extends Phaser.Scene {
  private bgUpdate: (t: number, dt: number) => void = () => {};
  private bgT = 0;
  private picks: RecruitDef[] = [];
  private cards: Card[] = [];
  private previews = new Map<string, Character>();
  /** Imiona i kolory zmienione przez gracza (wg id rekruta). */
  private custom = new Map<string, { name?: string; nameColor?: string }>();
  private view: RecruitDef = RECRUITS[0];
  /** Najemnik, którego pokaże trwający obrót karty (null = karta nie obraca się). */
  private flipTo: RecruitDef | null = null;
  private detail!: Phaser.GameObjects.Container;
  private count!: PixelText;
  private hint!: PixelText;
  private start!: UiButton;
  private dust: Motes | null = null;
  private tip!: Tip;
  /** Wybrani najemnicy stojący na placu pod panelami (Oldgame/src/scenes/recruit.js:122-123). */
  private figures = new Map<string, Phaser.GameObjects.Container>();
  /** Zegary losowych obrotów sylwetek (sprite'y z 8 kierunkami). */
  private turners = new Map<string, Phaser.Time.TimerEvent>();

  constructor() {
    super('RecruitScene');
  }

  private preview(r: RecruitDef): Character {
    let ch = this.previews.get(r.id);
    if (!ch) this.previews.set(r.id, (ch = recruitCharacter(r)));
    return ch;
  }

  create(): void {
    enter(this);
    this.picks = [];
    this.cards = [];
    this.previews = new Map();
    this.custom = new Map();
    this.figures = new Map();
    this.flipTo = null;
    this.turners = new Map();

    this.bgT = 0;
    this.bgUpdate = backdrop(this, 'recruit', { mood: MOODS.dusk, seed: 9, orb: [452, 196, 22], farBase: 226, midBase: 234, midH: [40, 150], groundY: 236, clouds: 9 });
    this.dust = new Motes(this, 60, { x: 0, y: 120, w: BASE_W, h: 150 }, 0xf0c080, 10, 1, 3, 0.4, 1);

    label(this, GRID_X, 6, 'ZBIERZ DRUŻYNĘ', { size: 12, bold: true, color: PAL.amber });
    this.count = label(this, BASE_W - 8, 8, '', { size: 9 }).setOrigin(1, 0);

    // ---- lewa strona: siatka 4 x 4
    panel(this, GRID_X - 4, 22, 4 * CARD_W + 3 * GAP + 8, 212);
    label(this, GRID_X, 25, 'NAJEMNICY DO WZIĘCIA', { size: 6, bold: true, color: PAL.amber });
    RECRUITS.forEach((r, i) => {
      const x = GRID_X + (i % 4) * (CARD_W + GAP), y = GRID_Y + Math.floor(i / 4) * (CARD_H + GAP);
      const bg = this.add.rectangle(x, y, CARD_W, CARD_H, PAL.panel2, 1).setOrigin(0).setStrokeStyle(1, PAL.edge).setInteractive({ useHandCursor: true });
      // portret (popiersie), pod nim drobnym drukiem imię, klasa i rasa; cała postać dopiero w karcie po prawej
      portrait(this, x + 4, y + 1, this.preview(r), 30, 0x000000);
      const sm = { small: true, maxW: CARD_W - 2 };
      const name = label(this, x + CARD_W / 2, y + 31, plainName(r.name), sm).setOrigin(0.5, 0);
      label(this, x + CARD_W / 2, y + 36, classDef(r.classId)?.name ?? r.classId, { ...sm, color: PAL.amber }).setOrigin(0.5, 0);
      label(this, x + CARD_W / 2, y + 41, ancestryOf(r.ancestry)?.name ?? r.ancestry, { ...sm, color: PAL.dim }).setOrigin(0.5, 0);
      const mark = label(this, x + CARD_W - 3, y + 2, '', { size: 7, bold: true, color: PAL.toxic }).setOrigin(1, 0);
      bg.on('pointerover', () => !modalOpen(this) && this.show(r));
      bg.on('pointerdown', () => {
        this.toggle(r);
        this.show(r);
      });
      this.cards.push({ r, bg, mark, name });
    });

    // ---- prawa strona: karta najemnika
    panel(this, DET_X, DET_Y, DET_W, DET_H);
    this.detail = this.add.container(DET_X, DET_Y);

    // ---- dół
    button(this, 8, BASE_H - 26, '◀ Wróć', () => goto(this, 'TitleScene'), { w: 50 });
    // podpowiedź w nagłówku - dół między przyciskami zajmują sylwetki wybranych
    this.hint = label(this, BASE_W - 90, 9, '', { size: 7, color: PAL.dim }).setOrigin(1, 0);
    this.tip = new Tip(this, 180);
    button(this, BASE_W - 254, BASE_H - 26, 'Pomoc', () => this.help(), { w: 44 });
    button(this, BASE_W - 204, BASE_H - 26, 'Losuj drużynę', () => this.randomParty(), { w: 92 });
    this.start = button(this, BASE_W - 106, BASE_H - 28, 'Rozpocznij ▶', () => this.begin(), { primary: true, w: 98, h: 20, size: 9 });

    this.show(RECRUITS[0]);
    this.refresh(false);
    SoundManager.music('title');
    SoundManager.ambience('town');
    // dev: ?pick=0,1,2,3 zaznacza rekrutów (Oldgame/src/scenes/recruit.js:74)
    const q = new URLSearchParams(window.location.search).get('pick');
    if (q) for (const i of q.split(',')) if (RECRUITS[+i]) this.toggle(RECRUITS[+i]);
  }

  /**
   * Pokazuje najemnika w karcie po prawej. Zmiana najemnika = obrót karty w 3D wokół pionowej osi: treść zwęża
   * się do krawędzi (scaleX 1 -> 0, z lekkim powiększeniem w pionie i przyciemnieniem jak bok odwracanej
   * tabliczki), w połowie podmienia się na nowego, i rozwija z powrotem. Dźwięk 'flip'. Gdy obrót trwa,
   * kolejne przełączenie tylko podmienia, kogo pokazać w połowie obrotu (szybkie przesuwanie myszą po kartach).
   */
  private show(r: RecruitDef): void {
    if (this.flipTo) {
      this.flipTo = r;
      return;
    }
    if (r === this.view || !this.detail.length) {
      this.build(r);
      return;
    }
    this.flipTo = r;
    this.tip?.hide();
    SoundManager.sfx('flip', { vol: 0.7 });
    const D = this.detail, half = DET_W / 2;
    this.tweens.add({
      targets: D,
      scaleX: 0,
      scaleY: 1.04,
      x: DET_X + half,
      y: DET_Y - DET_H * 0.02,
      alpha: 0.55,
      duration: 110,
      ease: 'Sine.easeIn',
      onComplete: () => {
        const next = this.flipTo ?? r;
        this.build(next);
        this.tweens.add({
          targets: D,
          scaleX: 1,
          scaleY: 1,
          x: DET_X,
          y: DET_Y,
          alpha: 1,
          duration: 140,
          ease: 'Sine.easeOut',
          onComplete: () => {
            const late = this.flipTo;
            this.flipTo = null;
            // w trakcie rozwijania wskazano jeszcze kogoś innego - kolejny obrót
            if (late && late !== this.view) this.show(late);
          },
        });
      },
    });
  }

  private build(r: RecruitDef): void {
    this.view = r;
    this.markFigures();
    const ch = this.preview(r);
    const cls = classDef(r.classId), anc = ancestryOf(ch.ancestry);
    const D = this.detail;
    this.tip?.hide();
    D.removeAll(true);
    const add = <T extends Phaser.GameObjects.GameObject>(o: T): T => (D.add(o), o);
    const L = (x: number, y: number, s: string, o: Parameters<typeof label>[4] = {}) => add(label(this, x, y, s, o));

    // sylwetka
    // cała postać (sprite 64x64 w skali 1 = 64 px projektowych) w ramce portretu; bez sprite'a - portret
    const sprite = spriteIdOf(r);
    this.turners.get('detail')?.remove();
    if (hasSprite(this, sprite)) {
      // cała postać losowo rozgląda się (przez sąsiednie kierunki), zaczyna przodem
      add(this.add.rectangle(8, 8, 64, 64, 0x1c1612).setOrigin(0).setStrokeStyle(1, PAL.edge));
      const fig = add(this.add.image(8 + 32, 8 + 63, spriteTexKey(sprite, 'south')).setOrigin(0.5, 63 / 64));
      this.turn('detail', sprite, fig, SPRITE_DIRS.indexOf('south'));
    } else add(portrait(this, 8, 8, ch, 64));
    const nm = L(78, 8, ch.name, { size: 12, color: parseColor(ch.nameColor, PAL.amber), maxW: DET_W - 76 - 84 });
    add(miniButton(this, Math.min(DET_W - 76, 84 + nm.displayWidth), 7, '✎ Zmień imię', () => void this.rename(r), { w: 70 }).box);
    L(78, 22, `${cls?.name ?? r.classId} — ${cls?.role ?? ''}`, { color: PAL.amber });
    L(78, 33, `${anc.name} · poz. 1${cls?.pf2e ? `  (PF2e: ${cls.pf2e} / ${anc.pf2e})` : ''}`, { color: PAL.dim });
    L(78, 45, `„${r.bio}”`, { size: 7, italic: true, color: 0xcbbf9f, wrap: DET_W - 88 });

    // cechy
    ATTRS.forEach((a, i) => {
      const x = 8 + i * 46, v = ch.attrs[a];
      add(this.add.rectangle(x, 88, 43, 22, 0x000000, 0.4).setOrigin(0).setStrokeStyle(1, PAL.edge));
      L(x + 21.5, 89, ATTR_SHORT[a], { size: 6, color: PAL.dim }).setOrigin(0.5, 0);
      L(x + 21.5, 96, signed(v), { size: 10, bold: true, color: v > 0 ? PAL.good : v < 0 ? PAL.bad : PAL.text }).setOrigin(0.5, 0);
    });

    // statystyki pochodne
    const stats: [string, string, number][] = [
      ['PW', String(ch.maxHp), PAL.good], ['KP', String(getStat(ch, 'ac')), PAL.amber], ['Szybk.', String(getStat(ch, 'speed')), PAL.text],
      ['Wytrz.', signed(getStat(ch, 'fortitude')), PAL.text], ['Refleks', signed(getStat(ch, 'reflex')), PAL.text], ['Wola', signed(getStat(ch, 'will')), PAL.text],
    ];
    stats.forEach(([k, v, col], i) => {
      const x = 8 + (i % 3) * 92, y = 114 + Math.floor(i / 3) * 10;
      const kl = L(x, y, `${k} `, { color: PAL.dim });
      L(x + kl.displayWidth, y, v, { bold: true, color: col });
    });

    const chips = (y: number, title: string, items: string[], color: number, edge: number, tips: string[] = []): number => {
      L(8, y, title, { size: 6, color: PAL.dim });
      let x = 8, cy = y + 9;
      for (const [i, s] of (items.length ? items : ['—']).entries()) {
        const t = label(this, 0, 0, s, { size: 7, color });
        const tw = t.displayWidth;
        if (x + tw + 6 > DET_W - 8) {
          x = 8;
          cy += 12;
        }
        const chip = add(this.add.rectangle(x, cy, tw + 6, 10, 0x000000, 0.35).setOrigin(0).setStrokeStyle(1, edge));
        // opis po najechaniu (UI.tooltip w recruit.js:34)
        if (tips[i]) this.tip.attach(chip.setInteractive(), () => (modalOpen(this) ? '' : tips[i]));
        add(t.setPosition(x + 3, cy + 0.5));
        x += tw + 9;
      }
      return cy + 13;
    };
    const skills = (Object.entries(ch.prof.skills) as [SkillId, number][])
      .filter(([, rank]) => rank > 0)
      .map(([id, rank]) => ({ id, rank, v: getStat(ch, id) }))
      .sort((a, b) => b.v - a.v)
      .slice(0, 5);
    const gear = [ch.equipment.weapon, ch.equipment.weapon2, ch.equipment.armor, ch.equipment.shield].map((i) => (i ? itemDef(i.id)?.name ?? i.id : null)).filter((n): n is string => !!n);
    L(8, 136, cut(`Wyposażenie: ${gear.join(', ') || '—'}`, 76), { size: 6, color: PAL.dim });
    const universal: readonly string[] = UNIVERSAL_ABILITIES;
    const y = chips(146, 'KLUCZOWE UMIEJĘTNOŚCI', skills.map((s) => `${SKILLS[s.id]?.name ?? s.id} ${signed(s.v)} (${PROF_NAMES[s.rank]?.slice(0, 3) ?? ''}.)`), PAL.text, PAL.edge);
    const abil = ch.abilities.filter((id) => !universal.includes(id)).map((id) => abilityDef(id)).filter((a): a is NonNullable<typeof a> => !!a?.name).slice(0, 5);
    chips(y, 'ZDOLNOŚCI KLASY', abil.map((a) => a.name), PAL.toxic, 0x4f6a2a, abil.map((a) => `${a.name}\n${a.desc ?? ''}`.trim()));

    for (const c of this.cards) c.bg.setStrokeStyle(1, c.r === r ? PAL.edgeHi : this.picks.includes(c.r) ? PAL.toxic : PAL.edge);
  }

  /** Losowa drużyna: 4 najemników, możliwie różne role. */
  private randomParty(): void {
    const pool = Phaser.Utils.Array.Shuffle(RECRUITS.slice());
    const picks: RecruitDef[] = [];
    for (const r of pool) if (picks.length < MAX_PARTY && !picks.some((p) => p.classId === r.classId)) picks.push(r);
    for (const r of pool) if (picks.length < MAX_PARTY && !picks.includes(r)) picks.push(r);
    // wylosowani dostają też losowy (różny) kolor imienia - można go potem zmienić
    const cols = Phaser.Utils.Array.Shuffle(NAME_COLORS.filter((c): c is string => !!c));
    picks.forEach((r, i) => this.setCustom(r, { nameColor: cols[i % cols.length] }));
    this.picks = picks;
    this.refresh();
    this.show(picks[0]);
  }

  private setCustom(r: RecruitDef, c: { name?: string; nameColor?: string | null }): void {
    const cur = { ...this.custom.get(r.id) };
    if (c.name !== undefined) cur.name = c.name === r.name ? undefined : c.name;
    if (c.nameColor !== undefined) cur.nameColor = c.nameColor ?? undefined;
    this.custom.set(r.id, cur);
    const ch = this.preview(r);
    ch.name = cur.name ?? r.name;
    if (cur.nameColor) ch.nameColor = cur.nameColor;
    else delete ch.nameColor;
    const card = this.cards.find((k) => k.r === r);
    card?.name.setText(cut(plainName(ch.name), 9)).setColor(cur.nameColor ?? hex(PAL.text));
  }

  private async rename(r: RecruitDef): Promise<void> {
    const ch = this.preview(r);
    const others = (): string[] => RECRUITS.filter((x) => x !== r).map((x) => this.preview(x).name);
    const res = await namePrompt(this, {
      value: ch.name, color: ch.nameColor ?? null, taken: others,
      generate: () => generateName({ ancestry: r.ancestry, classId: r.classId, gender: r.gender, taken: others() }),
      reset: () => r.name,
    });
    if (!res) return;
    this.setCustom(r, { name: res.name, nameColor: res.color });
    this.show(r);
  }

  /** Pomoc: klasy i rasy gry obok odpowiedników z Pathfindera 2e. */
  private help(): void {
    const W = 468, H = 256;
    const win = openWindow(this, W, H, 'Pomoc — klasy i rasy a Pathfinder 2e');
    // drobny druk (SMALL_TEXT): kolumny liczone z szerokości napisów, ostatnia kolumna przycinana do ramki okna
    const K = SMALL_TEXT, PAD = 8, GAP = 6, ROW = 7, RIGHT = W - PAD;
    const T = (x: number, y: number, t: string, color: number = PAL.text, maxW = RIGHT - x): void => {
      win.add(label(this, x, y, t, { small: true, color, maxW }));
    };
    const cols = (rows: string[][]): number[] => {
      const xs = [PAD];
      for (let c = 0; c < rows[0].length - 1; c++) xs.push(xs[c] + Math.max(...rows.map((r) => PixelText.measure(r[c]) * K)) + GAP);
      return xs;
    };
    const table = (y: number, head: string[], rows: { cells: string[]; color: number }[]): number => {
      const xs = cols([head, ...rows.map((r) => r.cells)]);
      head.forEach((h, i) => T(xs[i], y, h, PAL.amber));
      for (const r of rows) {
        y += ROW;
        r.cells.forEach((c, i) => T(xs[i], y, c, i === 0 ? r.color : i === r.cells.length - 1 ? 0xcbbf9f : PAL.text));
      }
      return y;
    };
    win.add(label(this, PAD, 20, 'Zasady Pathfinder 2e: k20 + modyfikatory, 3 akcje na turę, cztery stopnie sukcesu. Każda klasa i rasa to odpowiednik z PF2e.', { small: true, color: PAL.dim, wrap: W - 2 * PAD }));
    let y = table(34, ['Klasa', 'PF2e', 'Rola', 'PW/poz.', 'Zdolności'], Object.values(CLASSES).map((c) => ({
      color: parseColor(c.color, PAL.text),
      cells: [c.name, c.pf2e, c.role, String(c.hpPerLevel), c.abilities.map((id) => abilityDef(id)?.name ?? id).join(', ')],
    })));
    table(y + 11, ['Rasa', 'PF2e', 'PW', 'Prędk.', 'Premie / wada'], (Object.values(ANCESTRIES) as AncestryDef[]).map((a) => {
      const boosts = Object.entries(a.attrBoosts).map(([k, v]) => (k === 'free' ? ((v ?? 0) > 1 ? `${v} dowolne` : 'jedna dowolna') : ATTR_NAMES[k as keyof typeof ATTR_NAMES] ?? k));
      const flaws = Object.keys(a.attrFlaw ?? {}).map((k) => '−' + (ATTR_NAMES[k as keyof typeof ATTR_NAMES] ?? k));
      return { color: PAL.text, cells: [a.name, a.pf2e, String(a.hp), String(a.speed), boosts.join(', ') + (flaws.length ? ' / ' + flaws.join(', ') : '') + (a.perk ? ` — ${a.perk}` : '')] };
    }));
    win.add(button(this, W - 62, H - 20, 'Zamknij', () => win.close(), { w: 54, size: 7, primary: true }).box);
  }

  private toggle(r: RecruitDef): void {
    const i = this.picks.indexOf(r);
    if (i >= 0) this.picks.splice(i, 1);
    else if (this.picks.length < MAX_PARTY) this.picks.push(r);
    else {
      SoundManager.sfx('error');
      this.hint.setText('Drużyna jest pełna — odrzuć kogoś najpierw.').setColor(hex(PAL.bad));
      return;
    }
    this.refresh();
  }

  private refresh(sound = true): void {
    const n = this.picks.length, full = n === MAX_PARTY;
    for (const c of this.cards) {
      const on = this.picks.includes(c.r);
      c.bg.setFillStyle(on ? 0x22301a : PAL.panel2, 1).setStrokeStyle(1, c.r === this.view ? PAL.edgeHi : on ? PAL.toxic : PAL.edge);
      c.mark.setText(on ? String(this.picks.indexOf(c.r) + 1) : '');
    }
    this.count.setText(`Wybrano: ${n}/${MAX_PARTY}`).setColor(hex(full ? PAL.good : PAL.amber));
    this.start.setEnabled(full);
    let hint = full ? 'Gotowi. Pustkowia czekają.' : `Wybierz jeszcze ${MAX_PARTY - n}.`;
    if (full && new Set(this.picks.map((r) => r.classId)).size < 3) hint += ' (mało różnorodna drużyna)';
    this.hint.setText(hint).setColor(hex(PAL.dim));

    this.standFigures();
    if (sound) SoundManager.sfx(n ? 'pickup' : 'click', { vol: 0.5 });
  }

  /** Portrety wybranych w kolejności wyboru na placu pod panelami; nowy pojawia się z przenikaniem. */
  private standFigures(): void {
    for (const [id, pc] of this.figures) {
      if (this.picks.some((r) => r.id === id)) continue;
      pc.destroy();
      this.figures.delete(id);
    }
    const n = this.picks.length, size = 26;
    this.picks.forEach((r, i) => {
      const x = Math.round(142 + (i - (n - 1) / 2) * 34 - size / 2), y = BASE_H - size - 4;
      let pc = this.figures.get(r.id);
      if (!pc) {
        pc = portrait(this, x, y, this.preview(r), size).setDepth(2).setAlpha(0);
        // klik = ten najemnik w karcie po prawej (obrót karty 3D); wciśnięcie portretu i dźwięk kliknięcia
        const hit = this.add.rectangle(0, 0, size, size, 0x000000, 0).setOrigin(0).setInteractive({ useHandCursor: true });
        const p = pc;
        hit.on('pointerover', () => !modalOpen(this) && SoundManager.sfx('hover'));
        hit.on('pointerdown', () => {
          if (modalOpen(this)) return;
          SoundManager.sfx('click', { vol: 0.6 });
          const img = p.list[0] as Phaser.GameObjects.Image;
          this.tweens.killTweensOf(img);
          img.setPosition(0, 0);
          this.tweens.add({ targets: img, y: 2, duration: 60, yoyo: true, ease: 'Quad.easeOut' });
          this.show(r);
        });
        pc.add(hit);
        this.tweens.add({ targets: pc, alpha: 1, duration: 200 });
        this.figures.set(r.id, pc);
      }
      this.tweens.add({ targets: pc, x, y, duration: 180 });
    });
    this.markFigures();
  }

  /** Ramka portretu na placu: jasna u najemnika pokazanego w karcie po prawej. */
  private markFigures(): void {
    for (const [id, pc] of this.figures)
      (pc.list[1] as Phaser.GameObjects.Rectangle).setStrokeStyle(1, id === this.view.id ? PAL.edgeHi : PAL.edge);
  }

  /**
   * Losowe rozglądanie się: co 0.6-2.4 s postać wybiera nowy kierunek (1-4 kroki w lewo lub prawo) i obraca się
   * do niego krok po kroku przez sąsiednie kierunki (80 ms na krok), jak żywa postać, a nie przeskakując.
   */
  private turn(id: string, sprite: string, sp: Phaser.GameObjects.Image, dir: number): void {
    const wait = Phaser.Math.Between(600, 2400);
    const timer = this.time.delayedCall(wait, () => {
      if (!sp.active) return;
      const steps = Phaser.Math.Between(1, 4) * (Math.random() < 0.5 ? -1 : 1);
      let cur = dir;
      const stepTimer = this.time.addEvent({
        delay: 80,
        repeat: Math.abs(steps) - 1,
        callback: () => {
          if (!sp.active) return;
          cur = (cur + Math.sign(steps) + SPRITE_DIRS.length) % SPRITE_DIRS.length;
          sp.setTexture(spriteTexKey(sprite, SPRITE_DIRS[cur]));
          if (stepTimer.getRepeatCount() === 0) this.turn(id, sprite, sp, cur);
        },
      });
      this.turners.set(id, stepTimer);
    });
    this.turners.set(id, timer);
  }

  private begin(): void {
    if (this.picks.length !== MAX_PARTY) return;
    startCampaign(this.picks, Math.random, (r) => this.custom.get(r.id) ?? {});
    goto(this, 'HubScene');
  }

  update(_time: number, delta: number): void {
    this.bgT += Math.min(delta / 1000, 0.1);
    this.bgUpdate(this.bgT, Math.min(delta / 1000, 0.1));
    this.dust?.update(Math.min(delta / 1000, 0.1));
  }
}
