// Misja taktyczna: rozstawienie, eksploracja (mgła wojny, ruch drużyny), wykrywanie przez wrogów,
// znaleziska, skrzynie, cele zlecenia, ewakuacja, podsumowanie.
// Migracja logiki z Oldgame/src/scenes/mission.js (bez kamery, sprite'ów, HUD-u i modali).
import { SKILLS } from '../data/rules.ts';
import type { EnemyId, ItemId, SkillId } from '../data/types.ts';
import { createCharacter, createEnemy, encounterXP, endEncounter, newItem, partyLevel, rollLoot } from '../rules/character.ts';
import { applyDamage, isAlive } from '../rules/damage.ts';
import { check, dcForLevel, roll, type CheckResult, type Rng } from '../rules/dice.ts';
import { allItems, itemDef } from '../rules/lookup.ts';
import { getStat } from '../rules/stats.ts';
import { skillCheck } from '../rules/turn.ts';
import type { Character, GridPos, ItemInstance } from '../rules/types.ts';
import { Combat, makeActor, type Actor, type CombatEnd, type EnemyGroup, type LogTone } from './combat.ts';
import { cheb, dist, TacticalGrid, UNREACHABLE } from './grid.ts';
import { generateMap, inEntryZone, type Biome, type FindKind, type FindSpawn, type TacticalMap } from './mapgen.ts';

export type ObjectiveType = 'eliminate' | 'retrieve' | 'rescue' | 'hunt' | 'boss';
export type MissionOutcome = 'success' | 'fail' | 'retreat';

/** Minimum danych zlecenia potrzebne misji (pełny typ: campaign/contracts.ts). */
export interface MissionContract {
  id: string;
  title?: string;
  type: ObjectiveType;
  level: number;
  biome: Biome;
  enemies: readonly EnemyId[];
  objective?: { type: ObjectiveType; itemId?: ItemId | null };
}

export type ThingKind = 'crate' | 'item' | 'captive';
export interface MissionThing extends GridPos {
  kind: ThingKind;
  name: string;
  done: boolean;
  itemId?: ItemId;
  /** Nieudane próby otwarcia skrzyni. */
  tries?: number;
  freed?: boolean;
  actor?: Actor;
}
export interface MissionFind extends FindSpawn {
  found: boolean;
  taken: boolean;
  tried: boolean;
}
export interface ObjectiveLine {
  text: string;
  done: boolean;
  /** Wskazówka "idź do ewakuacji". */
  go?: boolean;
  tone?: LogTone;
}

export interface MissionResult {
  contractId: string;
  result: MissionOutcome;
  xp: number;
  loot: ItemInstance[];
  scrap: number;
  casualties: string[];
}

export type MissionSignal =
  | { kind: 'log'; text: string; tone: LogTone }
  | { kind: 'discover'; find: MissionFind; by: Actor; roll: CheckResult }
  | { kind: 'pickup'; find: MissionFind; by: Actor; scrap: number; items: ItemInstance[] }
  | { kind: 'spotted'; group: EnemyGroup; by: Actor; close: boolean }
  | { kind: 'crate'; thing: MissionThing; by: Actor; roll: CheckResult; scrap: number; items: ItemInstance[]; trapDamage: number }
  | { kind: 'interact'; thing: MissionThing; by: Actor }
  | { kind: 'objective'; lines: ObjectiveLine[] }
  | { kind: 'visibility' }
  | { kind: 'finish'; result: MissionResult };

export const CRATE_SKILLS: readonly SkillId[] = ['thievery', 'crafting', 'athletics'];
const FIND_LOOT: Readonly<Record<FindKind, readonly (ItemId | '@any')[]>> = {
  scrap: [], cache: ['@any'], medical: ['bandage', 'stimpak', 'medkit'], tech: ['circuit', 'battery', 'memory_card', 'radio_part', 'vacuum_tube'],
  food: ['canned_food'], ammo: ['ammo_box'],
};
const FIND_NAMES: Readonly<Record<FindKind, string>> = {
  scrap: 'stertę złomu', cache: 'ukrytą skrytkę', medical: 'porzuconą apteczkę', tech: 'resztki elektroniki', food: 'zapasy jedzenia', ammo: 'skrzynkę amunicji',
};
/** Zasięg wzroku najemnika / jeńca (pola). */
export const SIGHT_PC = 9;
export const SIGHT_NEUTRAL = 5;

export class Mission {
  readonly contract: MissionContract;
  readonly objType: ObjectiveType;
  readonly map: TacticalMap;
  readonly grid: TacticalGrid;
  readonly rng: Rng;
  readonly actors: Actor[] = [];
  readonly pcs: Actor[] = [];
  readonly enemies: Actor[] = [];
  readonly neutral: Actor[] = [];
  readonly groups: EnemyGroup[] = [];
  readonly things: MissionThing[] = [];
  readonly finds: MissionFind[];
  readonly combat: Combat;
  readonly target: Actor | null = null;
  itemThing: MissionThing | null = null;
  captive: MissionThing | null = null;
  mode: 'explore' | 'combat' | 'over' = 'explore';
  /** 1 = cel zdobyty / jeniec uwolniony. */
  stage = 0;
  /** Licznik kroków eksploracji (rytm testów wypatrywania). */
  steps = 0;
  scrap = 0;
  loot: ItemInstance[] = [];
  killed: Character[] = [];
  readonly explored: Uint8Array;
  readonly vis: Uint8Array;
  result: MissionResult | null = null;
  private listeners = new Set<(s: MissionSignal) => void>();

  constructor(contract: MissionContract, party: readonly Character[], rng: Rng = Math.random) {
    this.contract = contract;
    this.objType = contract.objective?.type ?? contract.type ?? 'eliminate';
    this.rng = rng;
    this.map = generateMap(contract, contract.enemies);
    this.grid = this.map.grid;
    const N = this.map.width * this.map.height;
    this.explored = new Uint8Array(N);
    this.vis = new Uint8Array(N);

    // drużyna w strefie wejścia
    const slots = [5, 6, 9, 10];
    party.filter(isAlive).slice(0, 4).forEach((ch, i) => {
      const a = makeActor(ch, 'pc', this.map.entry.cells[slots[i] ?? i]);
      this.pcs.push(a);
      this.actors.push(a);
    });
    // grupy wrogów
    this.map.groups.forEach((g, gi) => {
      const grp: EnemyGroup = { idx: gi, actors: [], alerted: false, nextNotice: 0, center: g.center };
      g.members.forEach((id, k) => {
        const a = makeActor(createEnemy(id), 'enemy', g.cells[k] ?? g.center, grp);
        grp.actors.push(a);
        this.enemies.push(a);
        this.actors.push(a);
      });
      this.groups.push(grp);
    });
    // cel polowania / boss
    if ((this.objType === 'hunt' || this.objType === 'boss') && this.enemies.length) {
      this.target =
        this.enemies.find((a) => a.ch.ai === 'boss' || /kostucha/i.test(a.ch.templateId ?? '')) ??
        this.enemies.slice().sort((a, b) => b.ch.level - a.ch.level)[0];
      this.target.isTarget = true;
    }
    for (const c of this.map.crates) this.things.push({ kind: 'crate', gx: c.gx, gy: c.gy, done: false, name: 'Skrzynia' });
    this.finds = this.map.finds.map((f) => ({ ...f, found: !f.hidden, taken: false, tried: false }));
    const oc = this.map.objCell;
    if (oc && this.objType === 'retrieve') {
      const itemId = contract.objective?.itemId ?? 'scrap_metal';
      this.itemThing = { kind: 'item', gx: oc.gx, gy: oc.gy, done: false, name: itemDef(itemId)?.name ?? 'Cel zlecenia', itemId };
      this.things.push(this.itemThing);
    } else if (oc && this.objType === 'rescue') {
      const ch = createCharacter({ name: 'Jeniec', classId: 'scavenger', ancestry: 'human' });
      ch.maxHp = 10;
      ch.hp = 10;
      const a = makeActor(ch, 'neutral', oc);
      this.neutral.push(a);
      this.actors.push(a);
      this.captive = { kind: 'captive', gx: oc.gx, gy: oc.gy, done: false, name: 'Jeniec', actor: a };
      this.things.push(this.captive);
    }

    this.combat = new Combat(
      {
        grid: this.grid, actors: this.actors, groups: this.groups, target: this.target,
        isBlocked: (gx, gy) => this.neutral.some((n) => n.gx === gx && n.gy === gy),
      },
      rng,
    );
    this.combat.on((s) => {
      if (s.kind === 'state' && s.actor.side === 'enemy' && s.to === 'dead' && !this.killed.includes(s.actor.ch)) {
        this.killed.push(s.actor.ch);
        this.emitObjectives();
      } else if (s.kind === 'join' || s.kind === 'move') this.updateVisibility();
      else if (s.kind === 'end') this.onCombatEnd(s.outcome);
    });
    this.updateVisibility();
  }

  // ---------- sygnały
  on(fn: (s: MissionSignal) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit(s: MissionSignal): void {
    for (const fn of this.listeners) fn(s);
  }
  log(text: string, tone: LogTone = 'dim'): void {
    this.emit({ kind: 'log', text, tone });
  }

  // ---------- zapytania
  /** Metoda (nie pole), bo tryb zmienia się w trakcie ruchu - TS nie zawęża wtedy typu. */
  inCombat(): boolean {
    return this.mode === 'combat';
  }
  get level(): number {
    return this.contract.level || 1;
  }
  thingAt(gx: number, gy: number): MissionThing | undefined {
    return this.things.find((t) => t.gx === gx && t.gy === gy && !t.done);
  }
  actorAt(gx: number, gy: number): Actor | null {
    return this.combat.actorAt(gx, gy);
  }
  inExtraction(p: GridPos): boolean {
    return inEntryZone(this.map.entry, p);
  }
  isVisible(p: GridPos): boolean {
    return !!this.vis[this.grid.index(p.gx, p.gy)];
  }
  isExplored(p: GridPos): boolean {
    return !!this.explored[this.grid.index(p.gx, p.gy)];
  }

  /** Mgła wojny: co widzą najemnicy (9 pól) i idący za nimi jeniec (5 pól). */
  updateVisibility(): void {
    this.vis.fill(0);
    const mark = (a: Actor, r: number): void => {
      for (const i of this.grid.visible(a, r)) {
        this.vis[i] = 1;
        this.explored[i] = 1;
      }
    };
    for (const a of this.pcs) if (a.state !== 'dead') mark(a, SIGHT_PC);
    for (const n of this.neutral) if (n.following) mark(n, SIGHT_NEUTRAL);
    this.emit({ kind: 'visibility' });
  }

  // ---------- ruch eksploracyjny
  /** Zasięg ruchu w eksploracji: Prędkość wybranego, a w trybie drużynowym - najwolniejszego. */
  moveRange(sel: Actor, group: boolean): number {
    const ups = this.pcs.filter((p) => p.state === 'up');
    return group && ups.length ? Math.min(...ups.map((p) => this.combat.speedOf(p))) : this.combat.speedOf(sel);
  }
  private passForPcs = (gx: number, gy: number): boolean => {
    const a = this.actorAt(gx, gy);
    return !a || a.side === 'pc';
  };
  /** Pola osiągalne jednym ruchem (do podświetlenia). */
  exploreReach(sel: Actor, group: boolean): GridPos[] {
    if (sel.state !== 'up') return [];
    const res = this.grid.search(sel, this.moveRange(sel, group), this.passForPcs);
    const out: GridPos[] = [];
    for (let i = 0; i < res.cost.length; i++) {
      const c = res.cost[i];
      if (c <= 0 || c >= UNREACHABLE || !this.explored[i]) continue;
      const p = this.grid.posOf(i);
      if (this.thingAt(p.gx, p.gy)?.kind === 'crate') continue;
      const o = this.actorAt(p.gx, p.gy);
      if (o && (o.side !== 'pc' || !group)) continue;
      out.push(p);
    }
    return out;
  }

  /** Najbliższe wolne pole przy (tx, ty) w promieniu 4 (dla formacji drużyny). */
  nearestFree(t: GridPos, who: Actor, taken?: ReadonlySet<number>): GridPos | null {
    let best: GridPos | null = null;
    let bd = 1e9;
    for (let y = t.gy - 4; y <= t.gy + 4; y++) {
      for (let x = t.gx - 4; x <= t.gx + 4; x++) {
        if (!this.grid.isFree(x, y) || taken?.has(this.grid.index(x, y))) continue;
        const a = this.actorAt(x, y);
        if ((a && a !== who) || this.thingAt(x, y)?.kind === 'crate') continue;
        if (this.neutral.some((n) => n !== who && n.gx === x && n.gy === y)) continue;
        const d = Math.hypot(x - t.gx, y - t.gy) + (this.thingAt(x, y) ? 0.2 : 0);
        if (d < bd) {
          bd = d;
          best = { gx: x, gy: y };
        }
      }
    }
    return best;
  }

  /** Przycina ścieżkę do kosztu `max` (1 / 1.5 po przekątnej); ostatnie pole musi być wolne. */
  clipPath(path: GridPos[], from: Actor, max: number, solo: boolean): GridPos[] {
    let c = 0;
    let px = from.gx;
    let py = from.gy;
    let n = 0;
    for (const st of path) {
      c += st.gx !== px && st.gy !== py ? 1.5 : 1;
      if (c > max + 1e-6) break;
      n++;
      px = st.gx;
      py = st.gy;
    }
    const ok = (t: GridPos): boolean => {
      const o = this.actorAt(t.gx, t.gy);
      return (!o || o === from || (o.side === 'pc' && !solo)) && this.thingAt(t.gx, t.gy)?.kind !== 'crate' && !this.neutral.some((q) => q.gx === t.gx && q.gy === t.gy);
    };
    while (n > 0 && !ok(path[n - 1])) n--;
    return path.slice(0, n);
  }

  /**
   * Jeden ruch eksploracyjny (= jedna akcja). Lider idzie krok po kroku (na każdym kroku: znaleziska i wypatrywanie
   * przez wrogów - wykrycie przerywa ruch i zaczyna walkę), reszta drużyny ustawia się w formacji.
   * Zwraca przebyte ścieżki do animacji.
   */
  exploreMove(sel: Actor, target: GridPos, opts: { group?: boolean } = {}): { ok: boolean; reason?: string; paths: Map<Actor, GridPos[]>; combat: boolean } {
    const paths = new Map<Actor, GridPos[]>();
    if (this.mode !== 'explore' || sel.state !== 'up') return { ok: false, reason: 'Teraz nie można się ruszać.', paths, combat: false };
    const group = opts.group ?? true;
    const dest = this.nearestFree(target, sel);
    if (!dest) return { ok: false, reason: 'Nie da się tam dojść.', paths, combat: false };
    const full = this.grid.findPath(sel, dest, this.passForPcs, 80);
    if (!full || !full.length) return { ok: false, reason: 'Nie da się tam dojść.', paths, combat: false };
    const path = this.clipPath(full, sel, this.moveRange(sel, group), !group);
    if (!path.length) return { ok: false, reason: 'Brak wolnego pola w zasięgu ruchu.', paths, combat: false };
    const end = path[path.length - 1];
    // cele formacji wokół końca ruchu lidera
    const movers = group ? this.pcs.filter((p) => p !== sel && p.state === 'up') : [];
    const taken = new Set([this.grid.index(end.gx, end.gy)]);
    const formation = new Map<Actor, GridPos>();
    for (const p of movers) {
      const c = this.nearestFree(end, p, taken);
      if (c) {
        taken.add(this.grid.index(c.gx, c.gy));
        formation.set(p, c);
      }
    }
    // lider: krok po kroku
    const walked: GridPos[] = [];
    let spotted = false;
    for (const st of path) {
      sel.gx = st.gx;
      sel.gy = st.gy;
      walked.push(st);
      this.steps++;
      this.updateVisibility();
      this.checkFinds();
      if (this.checkSpotting()) {
        spotted = true;
        break;
      }
    }
    paths.set(sel, walked);
    // reszta drużyny
    for (const [p, c] of formation) {
      const pp = this.grid.findPath(p, c, this.passForPcs, 80);
      if (!pp || !pp.length) continue;
      const walkedP = spotted ? pp.slice(0, Math.min(pp.length, walked.length)) : pp;
      if (!walkedP.length) continue;
      const last = walkedP[walkedP.length - 1];
      if (this.actorAt(last.gx, last.gy)) continue;
      p.gx = last.gx;
      p.gy = last.gy;
      paths.set(p, walkedP);
    }
    this.updateVisibility();
    if (this.mode === 'explore') {
      this.checkFinds();
      this.checkSpotting();
      const np = this.followNeutral(sel);
      if (np && this.captive?.actor) paths.set(this.captive.actor, np);
    }
    return { ok: true, paths, combat: this.inCombat() };
  }

  /** Uwolniony jeniec idzie za liderem. */
  followNeutral(lead: Actor): GridPos[] | null {
    const cap = this.captive;
    const n = cap?.actor;
    if (!cap || !cap.freed || !n) return null;
    const c = this.nearestFree(lead, n, new Set(this.pcs.map((p) => this.grid.index(p.gx, p.gy))));
    if (!c) return null;
    const p = this.grid.findPath(n, c, () => true, 60);
    if (!p || !p.length) return null;
    n.gx = c.gx;
    n.gy = c.gy;
    this.updateVisibility();
    return p;
  }

  // ---------- znaleziska
  /** Ukryte znaleziska w promieniu 2 odkrywa test Percepcji najlepszego najemnika; odkryte zbiera ten, kto stoi obok. */
  checkFinds(): void {
    if (this.mode !== 'explore') return;
    const pcs = this.pcs.filter((p) => p.state === 'up');
    if (!pcs.length) return;
    const dc = dcForLevel(this.level);
    for (const f of this.finds) {
      if (f.taken) continue;
      const near = pcs.filter((p) => cheb(p, f) <= 2);
      if (!near.length) continue;
      if (!f.found) {
        if (f.tried) continue;
        f.tried = true;
        const best = near.slice().sort((a, b) => getStat(b.ch, 'perception') - getStat(a.ch, 'perception'))[0];
        const r = check(getStat(best.ch, 'perception'), dc, this.rng);
        if (r.degree >= 2) {
          f.found = true;
          this.log(`${best.ch.name} dostrzega coś w gruzach (Percepcja ${r.total} vs KT ${dc}).`, 'amber');
          this.emit({ kind: 'discover', find: f, by: best, roll: r });
        }
        continue;
      }
      const taker = pcs.find((p) => cheb(p, f) <= 1);
      if (!taker) continue;
      f.taken = true;
      const scrap = Math.round((f.kind === 'scrap' ? 10 : f.kind === 'cache' ? 6 : 2) + this.rng() * 8 * (1 + this.level * 0.4));
      this.scrap += scrap;
      const got = [`${scrap} Złomu`];
      const items: ItemInstance[] = [];
      const pool = FIND_LOOT[f.kind];
      if (pool.length) {
        let id = pool[Math.floor(this.rng() * pool.length)];
        if (id === '@any') {
          const any = allItems().filter((i) => ['consumable', 'tech', 'junk'].includes(i.type) && i.level <= this.level + 1);
          id = any.length ? any[Math.floor(this.rng() * any.length)].id : 'scrap_metal';
        }
        const it = newItem(id);
        this.loot.push(it);
        items.push(it);
        got.push(itemDef(id)?.name ?? id);
      }
      this.log(`${taker.ch.name} znajduje ${FIND_NAMES[f.kind]}: ${got.join(', ')}.`, 'good');
      this.emit({ kind: 'pickup', find: f, by: taker, scrap, items });
    }
  }

  // ---------- wykrywanie przez wrogów
  /**
   * Grupy wrogów wypatrują drużyny (≤11 pól, linia wzroku). Bardzo blisko (≤3.2) = wykrycie od razu;
   * dalej - Percepcja najlepszego wroga vs 10 + najlepsze Skradanie drużyny, co 3 kroki. Wykrycie zaczyna walkę.
   */
  checkSpotting(): EnemyGroup | null {
    if (this.mode !== 'explore') return null;
    for (const g of this.groups) {
      if (g.alerted) continue;
      const alive = g.actors.filter((a) => a.state !== 'dead');
      if (!alive.length) continue;
      let seer: Actor | null = null;
      let seen: Actor | null = null;
      let close = false;
      outer: for (const e of alive) {
        for (const p of this.pcs) {
          if (p.state !== 'up') continue;
          const d = dist(e, p);
          if (d > 11 || !this.grid.los(e, p).clear) continue;
          if (d <= 3.2) {
            close = true;
            seer = e;
            seen = p;
            break outer;
          }
          if (!seer || !seen || d < dist(seer, seen)) {
            seer = e;
            seen = p;
          }
        }
      }
      if (!seer) continue;
      if (!close) {
        if (this.steps < g.nextNotice) continue;
        g.nextNotice = this.steps + 3;
        const best = alive.reduce((m, e) => Math.max(m, getStat(e.ch, 'perception')), -9);
        const dc = 10 + Math.max(...this.pcs.filter((p) => p.state === 'up').map((p) => getStat(p.ch, 'stealth')));
        const r = check(best, dc, this.rng);
        this.log(`${seer.ch.name} wypatruje czegoś (Percepcja ${r.total} vs Skradanie ${dc}): ${r.degree >= 2 ? 'ZAUWAŻA!' : 'nic nie widzi.'}`, r.degree >= 2 ? 'bad' : 'dim');
        if (r.degree < 2) continue;
      } else this.log(`${seer.ch.name} jest tuż obok — wykrywa drużynę!`, 'bad');
      this.emit({ kind: 'spotted', group: g, by: seer, close });
      this.startCombat(g);
      return g;
    }
    return null;
  }

  /** Walka z grupą; `ambush` = drużyna zaczyna z zaskoczenia (patrz Combat.start). */
  startCombat(g: EnemyGroup, ambush = false): void {
    this.mode = 'combat';
    this.combat.start(g, { ambush });
    this.updateVisibility();
  }

  /**
   * Atak z ukrycia na nieświadomą grupę: Skradanie atakującego vs 10 + najlepsza Percepcja grupy.
   * Sukces = zasadzka (Combat.start ambush), porażka = zwykła walka (grupa w porę dostrzega drużynę).
   * W Oldgame kliknięcie wroga tylko podchodziło; tu atak jest dostępny, ale wymaga udanego testu.
   */
  ambushAttack(a: Actor, g: EnemyGroup): CheckResult {
    const alive = g.actors.filter((e) => e.state !== 'dead');
    const dc = 10 + Math.max(0, ...alive.map((e) => getStat(e.ch, 'perception')));
    const r = check(getStat(a.ch, 'stealth'), dc, this.rng);
    const ok = r.degree >= 2;
    this.log(`${a.ch.name}: Skradanie ${r.d20}${r.mod >= 0 ? '+' : ''}${r.mod} = ${r.total} vs ST ${dc} — ${ok ? 'zasadzka!' : 'wrogowie dostrzegają ruch.'}`, ok ? 'amber' : 'bad');
    this.startCombat(g, ok);
    return r;
  }

  private onCombatEnd(outcome: CombatEnd): void {
    if (outcome === 'defeat') {
      // Cała drużyna powalona = koniec drogi (Oldgame mission.js:558-568: ekran końca gry, polegli = faktycznie martwi).
      this.finish('fail');
      return;
    }
    if (outcome === 'target') {
      this.log('CEL ELIMINOWANY', 'good');
      this.finish('success');
      return;
    }
    this.mode = 'explore';
    this.steps += 3;
    this.emitObjectives();
    if (this.objType === 'eliminate' && this.enemies.every((e) => e.state === 'dead')) this.finish('success');
  }

  // ---------- interakcje
  /**
   * Interakcja z obiektem obok (cel, jeniec, skrzynia). Skrzynia wymaga wyboru umiejętności (`skill`).
   * W walce kosztuje 1 akcję. Zwraca false, gdy nic się nie stało.
   */
  interact(a: Actor, th: MissionThing, skill?: SkillId): boolean {
    if (th.done || cheb(a, th) > 1 || a.state !== 'up') return false;
    // Oldgame combat.js:450: akcja schodzi tylko, gdy interakcja się udała.
    if (th.kind === 'crate' && !skill) return false;
    if (this.mode === 'combat' && !this.combat.spendActions(a, 1)) return false;
    if (th.kind === 'item') {
      th.done = true;
      this.stage = Math.max(this.stage, 1);
      this.loot.push(newItem(th.itemId ?? 'scrap_metal'));
      this.log(`${a.ch.name} zabiera: ${th.name}. Czas wracać do strefy ewakuacji!`, 'good');
      this.emit({ kind: 'interact', thing: th, by: a });
      this.emitObjectives();
      return true;
    }
    if (th.kind === 'captive') {
      th.done = true;
      th.freed = true;
      if (th.actor) th.actor.following = true;
      this.stage = Math.max(this.stage, 1);
      this.log(`${a.ch.name} uwalnia jeńca. Trzeba go wyprowadzić do strefy ewakuacji.`, 'good');
      this.emit({ kind: 'interact', thing: th, by: a });
      this.updateVisibility();
      this.emitObjectives();
      return true;
    }
    return skill ? this.openCrate(a, th, skill) : false;
  }

  /**
   * Pole, z którego `a` dosięgnie obiektu (sąsiednie, najtańsze po drodze; obecne, jeśli już stoi obok).
   * null = nie da się dojść.
   */
  interactCell(a: Actor, th: GridPos): GridPos | null {
    if (cheb(a, th) <= 1) return { gx: a.gx, gy: a.gy };
    const res = this.grid.search(a, 80, this.passForPcs);
    let best: GridPos | null = null;
    let bc = UNREACHABLE;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const x = th.gx + dx;
        const y = th.gy + dy;
        if ((!dx && !dy) || !this.grid.isFree(x, y)) continue;
        const o = this.actorAt(x, y);
        if ((o && o !== a) || this.thingAt(x, y) || this.neutral.some((n) => n.gx === x && n.gy === y)) continue;
        const c = res.cost[this.grid.index(x, y)];
        if (c > 0 && c < bc) {
          bc = c;
          best = { gx: x, gy: y };
        }
      }
    }
    return best;
  }

  /** ST zamka skrzyni. */
  crateDC(): number {
    return dcForLevel(this.level) + 1;
  }

  /**
   * Otwieranie skrzyni (Złodziejstwo / Technika / Atletyka vs ST poziomu + 1).
   * Kryt. porażka = pułapka 1k6; porażka = zamknięta (2 próby); sukces = Złom + 1 przedmiot; kryt. = x1.5 i 2 przedmioty.
   */
  openCrate(a: Actor, th: MissionThing, skill: SkillId): boolean {
    if (th.kind !== 'crate' || th.done) return false;
    const dc = this.crateDC();
    th.done = true;
    const r = skillCheck(a.ch, skill, dc, this.rng);
    const DEG = ['KRYTYCZNA PORAŻKA', 'porażka', 'sukces', 'KRYTYCZNY SUKCES'];
    this.log(`${a.ch.name}: ${SKILLS[skill]?.name ?? skill} ${r.total} vs KT ${dc} — ${DEG[r.degree]}`, r.degree >= 2 ? 'good' : 'bad');
    let trapDamage = 0;
    let scrap = 0;
    const items: ItemInstance[] = [];
    if (r.degree === 0) {
      trapDamage = roll('1d6', this.rng).total;
      applyDamage(a.ch, trapDamage);
      this.log(`Pułapka! ${a.ch.name} traci ${trapDamage} PW.`, 'bad');
      this.combat.syncAll();
    } else if (r.degree === 1) {
      this.log('Zamek się nie poddaje — skrzynia pozostaje zamknięta.');
      th.tries = (th.tries ?? 0) + 1;
      th.done = th.tries >= 2;
    } else {
      const n = r.degree === 3 ? 2 : 1;
      scrap = Math.round((8 + this.rng() * 14) * (1 + this.level * 0.5) * (r.degree === 3 ? 1.5 : 1));
      this.scrap += scrap;
      this.log(`Znaleziono ${scrap} Złomu.`, 'amber');
      const pool = allItems().filter((i) => ['consumable', 'junk', 'tech', 'ammo'].includes(i.type) && i.level <= this.level + 1);
      for (let i = 0; i < n && pool.length; i++) {
        const it = pool[Math.floor(this.rng() * pool.length)];
        const inst = newItem(it.id);
        this.loot.push(inst);
        items.push(inst);
        this.log(`Łup: ${it.name}.`, 'good');
      }
    }
    this.emit({ kind: 'crate', thing: th, by: a, roll: r, scrap, items, trapDamage });
    this.emitObjectives();
    return true;
  }

  // ---------- cele i ewakuacja
  objectiveDone(): boolean {
    return this.stage >= 1;
  }

  objectives(): ObjectiveLine[] {
    const alive = this.enemies.filter((a) => a.state !== 'dead').length;
    const tot = this.enemies.length;
    const L: ObjectiveLine[] = [];
    const t = this.objType;
    if (t === 'eliminate') L.push({ text: `Wyeliminuj wszystkich wrogów (${tot - alive}/${tot})`, done: alive === 0 });
    else if (t === 'hunt' || t === 'boss') {
      L.push({ text: `Zabij cel: ${this.target?.ch.name ?? 'cel'}`, done: this.target?.state === 'dead' });
      L.push({ text: `Eskorta wrogów: ${alive}`, done: false, tone: 'dim' });
    } else if (t === 'retrieve') {
      L.push({ text: `Odzyskaj: ${this.itemThing?.name ?? 'cel'}`, done: this.stage >= 1 });
      L.push({ text: 'Wróć do strefy ewakuacji', done: false, go: this.stage >= 1 });
    } else {
      L.push({ text: 'Znajdź i uwolnij jeńca', done: this.stage >= 1 });
      L.push({ text: 'Doprowadź go do strefy ewakuacji', done: false, go: this.stage >= 1 });
    }
    const crates = this.things.filter((x) => x.kind === 'crate');
    L.push({ text: `Skrzynie: ${crates.filter((x) => x.done).length}/${crates.length}`, done: false, tone: 'dim' });
    return L;
  }
  private emitObjectives(): void {
    this.emit({ kind: 'objective', lines: this.objectives() });
  }

  /** Cel wykonany, wszyscy przytomni (i uwolniony jeniec) stoją w strefie ewakuacji. */
  canExtract(): boolean {
    if (this.mode !== 'explore' || !this.objectiveDone()) return false;
    const up = this.pcs.filter((p) => p.state === 'up');
    if (!up.length || !up.every((p) => this.inExtraction(p))) return false;
    const cap = this.captive;
    return !cap || !cap.freed || !cap.actor || this.inExtraction(cap.actor);
  }

  // ---------- zakończenie
  /** Kończy misję: PD za zabitych, łup z wrogów, ukradziony Złom, polegli. */
  finish(result: MissionOutcome): MissionResult {
    if (this.result) return this.result;
    this.mode = 'over';
    this.combat.active = false;
    const casualties = this.pcs.filter((a) => !isAlive(a.ch)).map((a) => a.ch.name);
    const xp = encounterXP(partyLevel(this.pcs.map((a) => a.ch)), this.killed);
    for (const ch of this.killed) {
      const lo = rollLoot(ch, this.rng);
      this.loot.push(...lo.items);
      this.scrap += lo.scrap;
    }
    for (const a of this.pcs) {
      if (a.ch.stolenScrap) {
        this.scrap += a.ch.stolenScrap;
        a.ch.stolenScrap = 0;
      }
      if (result !== 'fail') endEncounter(a.ch);
    }
    this.result = { contractId: this.contract.id, result, xp, loot: this.loot.slice(), scrap: this.scrap, casualties };
    this.emit({ kind: 'finish', result: this.result });
    return this.result;
  }

  /** Odwrót z misji (w eksploracji i w walce - stary przycisk "Odwrót" działał zawsze). */
  retreat(): MissionResult | null {
    return this.mode === 'over' ? null : this.finish('retreat');
  }
}
