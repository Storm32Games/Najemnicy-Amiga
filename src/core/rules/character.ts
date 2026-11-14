// Tworzenie postaci i wrogów, łup, doświadczenie, awans, odpoczynek, opisy.
// Migracja z Oldgame/src/rules/core.js (sekcje "tworzenie postaci", "doświadczenie", "odpoczynek", "opisy").
import { ABILITIES } from '../data/abilities.ts';
import { ANCESTRIES, ANCESTRY_ALIASES } from '../data/ancestries.ts';
import { CLASSES } from '../data/classes.ts';
import { ATTRS, CONDITIONS, DMG_ADJ, ENCOUNTER_XP, MAX_LEVEL, UNIVERSAL_ABILITIES, XP_PER_LEVEL } from '../data/rules.ts';
import type {
  AbilityDef, AbilityId, AncestryDef, AncestryId, Attributes, CharacterLook, ClassDef, ClassId, ConditionDef, EnemyId,
  ItemId, ProfProgression,
} from '../data/types.ts';
import { fmtMod, type Rng } from './dice.ts';
import { isDead } from './damage.ts';
import { abilityDef, ancestryOf, classDef, enemyDef, itemDef, resolveAncestryId } from './lookup.ts';
import { getAttackBonus, getStat, getWeapons, normWeapon } from './stats.ts';
import type { CharProficiencies, Character, ItemInstance } from './types.ts';

// ---------- identyfikatory i przedmioty
let uidN = 0;
const uid = (prefix: string): string => prefix + Math.random().toString(36).slice(2, 8) + (++uidN).toString(36);
export const newItem = (id: ItemId, qty = 1): ItemInstance => ({ uid: uid('i'), id, qty });

const hashName = (s: string): number => {
  let h = 7;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h;
};
const pickBy = <T>(arr: readonly T[], h: number): T => arr[h % arr.length];

// ---------- biegłości
function cloneProf(p: ClassDef['prof']): CharProficiencies {
  return {
    perception: p.perception, fortitude: p.fortitude, reflex: p.reflex, will: p.will, classDC: p.classDC,
    skills: { ...p.skills }, attacks: { ...p.attacks }, defense: { ...p.defense },
  };
}
const SCALAR_PROF = ['perception', 'fortitude', 'reflex', 'will', 'classDC'] as const;
/** Podnosi rangi do co najmniej podanych (nigdy nie obniża). */
function mergeProf(prof: CharProficiencies, add: ProfProgression | undefined): void {
  if (!add) return;
  for (const k of SCALAR_PROF) {
    const v = add[k];
    if (v !== undefined) prof[k] = Math.max(prof[k] || 0, v);
  }
  for (const group of ['skills', 'attacks', 'defense'] as const) {
    const src: Readonly<Record<string, number | undefined>> | undefined = add[group];
    if (!src) continue;
    const dst = prof[group] as Record<string, number | undefined>;
    for (const [s, r] of Object.entries(src)) if (r !== undefined) dst[s] = Math.max(dst[s] || 0, r);
  }
}

function baseAttrs(cls: ClassDef, anc: AncestryDef): Attributes {
  const a: Attributes = { ...cls.attrs };
  for (const [k, v] of Object.entries(anc.attrBoosts)) {
    if (v === undefined) continue;
    if (k === 'free') {
      let n = v;
      for (const t of cls.boostOrder) {
        if (n-- <= 0) break;
        a[t] += 1;
      }
    } else a[k as keyof Attributes] += v;
  }
  for (const [k, v] of Object.entries(anc.attrFlaw ?? {})) if (v !== undefined) a[k as keyof Attributes] += v;
  for (const k of ATTRS) a[k] = Math.min(4, a[k]);
  return a;
}

/** maxHp = PW rasy + (PW klasy + KON) * poziom. Przy wzroście maxHp podnosi też bieżące PW. */
export function recalcHp(ch: Character): void {
  if (ch.isEnemy) return;
  const cls = classDef(ch.classId);
  if (!cls) return;
  const nm = ancestryOf(ch.ancestry).hp + (cls.hpPerLevel + (ch.attrs.con || 0)) * ch.level;
  const diff = nm - ch.maxHp;
  ch.maxHp = nm;
  if (diff > 0 && ch.hp > 0) ch.hp += diff;
  ch.hp = Math.min(ch.hp, ch.maxHp);
}

/** Dodaje odblokowane zdolności (uniwersalne + klasowe wg poziomu) i ich limity użyć. */
function syncAbilities(ch: Character): void {
  const cls = classDef(ch.classId);
  if (!cls) return;
  const ids: AbilityId[] = [...UNIVERSAL_ABILITIES];
  for (const id of cls.abilities) if ((cls.unlocks[id] ?? 1) <= ch.level) ids.push(id);
  for (const id of ids) {
    if (!ch.abilities.includes(id)) ch.abilities.push(id);
    const ab = abilityDef(id);
    if (ab?.uses && ch.uses[id] === undefined) ch.uses[id] = ab.usesMax || 1;
  }
}

const HEAVY_BODY: ReadonlySet<string> = new Set(['brute', 'soldier', 'champion', 'monk']);
const LIGHT_BODY: ReadonlySet<string> = new Set(['scavenger', 'scout', 'gunslinger', 'hacker', 'herald']);

export interface CreateCharacterOptions {
  name?: string;
  ancestry?: AncestryId | keyof typeof ANCESTRY_ALIASES | string;
  classId?: ClassId;
  attrs?: Partial<Attributes>;
  look?: Partial<CharacterLook>;
  bio?: string;
  level?: number;
  recruitId?: string;
}

/** Nowy najemnik: cechy z klasy + rasy, biegłości, PW, ekwipunek startowy, zdolności. */
export function createCharacter(o: CreateCharacterOptions = {}): Character {
  const cls: ClassDef = (o.classId && CLASSES[o.classId]) || CLASSES.soldier;
  const ancId: AncestryId = resolveAncestryId(o.ancestry) ?? 'human';
  const anc: AncestryDef = ANCESTRIES[ancId];
  const name = o.name || 'Najemnik';
  const h = hashName(name + ancId + cls.id);
  const attrs = baseAttrs(cls, anc);
  if (o.attrs) for (const k of ATTRS) if (o.attrs[k] !== undefined) attrs[k] = o.attrs[k];
  const prof = cloneProf(cls.prof);
  mergeProf(prof, { skills: anc.skills });
  const body = HEAVY_BODY.has(cls.id) ? 'heavy' : LIGHT_BODY.has(cls.id) ? 'light' : 'medium';
  const lk = anc.look;
  const look: Partial<CharacterLook> = {
    body, skin: pickBy(lk.skin.length ? lk.skin : ['#c9a07a'], h), hair: pickBy(lk.hair.length ? lk.hair : ['#222'], h >> 3),
    hairStyle: h % 6, cloth: cls.color, accent: '#c8a040', mask: false, mutation: !!lk.mutation, cyber: !!lk.cyber, ...(o.look ?? {}),
  };
  const ch: Character = {
    id: uid('c'), name, ancestry: ancId, classId: cls.id, level: 1, xp: 0, isEnemy: false, attrs, maxHp: 0, hp: 0, tempHp: 0, prof,
    equipment: { weapon: null, weapon2: null, armor: null, shield: null }, inventory: [], abilities: [], uses: {}, conditions: {},
    speed: anc.speed, look, bio: o.bio || '',
  };
  if (o.recruitId) ch.recruitId = o.recruitId;
  recalcHp(ch);
  ch.hp = ch.maxHp;
  for (const id of cls.startGear) {
    const it = itemDef(id);
    if (!it) continue;
    const inst = newItem(id);
    const e = ch.equipment;
    const mainDef = itemDef(e.weapon?.id);
    const twoHanded = mainDef?.type === 'weapon' && mainDef.weapon.hands === 2;
    if (it.type === 'weapon' && !e.weapon) e.weapon = inst;
    else if (it.type === 'weapon' && !e.weapon2) e.weapon2 = inst;
    else if (it.type === 'armor' && !e.armor) e.armor = inst;
    else if (it.type === 'shield' && !e.shield && !twoHanded) e.shield = inst;
    else {
      const ex = ch.inventory.find((x) => x.id === id);
      if (ex && it.type === 'consumable') ex.qty++;
      else ch.inventory.push(inst);
    }
  }
  syncAbilities(ch);
  const target = Math.max(1, Math.min(MAX_LEVEL, o.level || 1));
  while (ch.level < target) levelUp(ch);
  return ch;
}

/** Wróg z szablonu. levelAdj -1/+1 = słabsza / elitarna wersja (PF2e weak/elite). */
export function createEnemy(templateId: EnemyId, o: { levelAdj?: number } = {}): Character {
  const t = enemyDef(templateId);
  if (!t) throw new Error('Nieznany wróg: ' + templateId);
  const adj = o.levelAdj || 0;
  const hpMul = adj === 0 ? 1 : adj > 0 ? 1.25 : 0.8;
  const attacks = t.attacks.map((a) => {
    if (!adj) return { ...a, traits: [...a.traits] };
    const damage = a.damage.replace(/([+-]\d+)$/, (m) => {
      const v = parseInt(m, 10) + 2 * adj;
      return (v >= 0 ? '+' : '') + v;
    });
    return { ...a, traits: [...a.traits], bonus: a.bonus + adj, damage };
  });
  const maxHp = Math.max(1, Math.round(t.hp * hpMul));
  const uses: Character['uses'] = {};
  for (const id of t.abilities) {
    const ab: AbilityDef = ABILITIES[id];
    if (ab.uses) uses[id] = ab.usesMax || 1;
  }
  return {
    id: uid('e'), name: t.name, nameAcc: t.acc || t.name, templateId, isEnemy: true, ancestry: '', classId: '',
    level: Math.max(0, t.level + adj), xp: 0,
    attrs: { str: 2, dex: 2, con: 2, int: 0, wis: 1, cha: 0 }, maxHp, hp: maxHp, tempHp: 0,
    prof: { perception: 0, fortitude: 0, reflex: 0, will: 0, classDC: 0, skills: {}, attacks: {}, defense: {} },
    equipment: { weapon: null, weapon2: null, armor: null, shield: null }, inventory: [],
    abilities: ['strike', ...t.abilities], uses, conditions: {}, speed: t.speed, look: { ...t.look }, bio: '',
    base: {
      ac: t.ac + adj, fortitude: t.saves.fort + adj, reflex: t.saves.ref + adj, will: t.saves.will + adj,
      perception: t.perception + adj, classDC: 10 + t.attacks[0].bonus + adj, skills: {},
    },
    attacks, faction: t.faction, ai: t.ai, traits: [...t.traits],
    resist: t.resist ? { ...t.resist } : undefined, weak: t.weak ? { ...t.weak } : undefined, immune: t.immune ? [...t.immune] : undefined,
  };
}

export interface LootRoll {
  scrap: number;
  items: ItemInstance[];
}
/** Łup z pokonanego wroga: Złom z przedziału + przedmioty wg szans. */
export function rollLoot(enemy: Character | EnemyId, rng: Rng = Math.random): LootRoll {
  const t = enemyDef(typeof enemy === 'string' ? enemy : enemy.templateId);
  const out: LootRoll = { scrap: 0, items: [] };
  if (!t) return out;
  out.scrap = t.scrap[0] + Math.floor(rng() * (t.scrap[1] - t.scrap[0] + 1));
  for (const l of t.loot) if (rng() < l.chance) out.items.push(newItem(l.id, l.qty || 1));
  return out;
}

// ---------- doświadczenie
/** Awans o poziom: progresja klasy, co 5 poz. +1 do 4 cech, co 2 poz. +1 ranga umiejętności (do Eksperta). */
export function levelUp(ch: Character): boolean {
  if (ch.isEnemy || ch.level >= MAX_LEVEL) return false;
  const cls = classDef(ch.classId);
  if (!cls) return false;
  ch.level += 1;
  mergeProf(ch.prof, cls.progression[ch.level]);
  if (ch.level % 5 === 0) {
    let n = 4;
    for (const a of cls.boostOrder) {
      if (n-- <= 0) break;
      ch.attrs[a] = Math.min(5, ch.attrs[a] + 1);
    }
  }
  if (ch.level % 2 === 0) {
    const skills = ch.prof.skills as Record<string, number>;
    const sorted = Object.keys(skills).sort((a, b) => skills[b] - skills[a]);
    const t = sorted.find((s) => skills[s] < 2);
    if (t) skills[t] += 1;
  }
  recalcHp(ch);
  syncAbilities(ch);
  return true;
}

/** Dodaje PD (1000 na poziom, maks. poziom 10). Zwraca liczbę zdobytych poziomów. */
export function addXP(ch: Character, xp: number): number {
  if (ch.isEnemy) return 0;
  ch.xp += Math.max(0, Math.round(xp));
  let gained = 0;
  while (ch.xp >= XP_PER_LEVEL && ch.level < MAX_LEVEL) {
    ch.xp -= XP_PER_LEVEL;
    levelUp(ch);
    gained++;
  }
  if (ch.level >= MAX_LEVEL) ch.xp = Math.min(ch.xp, XP_PER_LEVEL - 1);
  return gained;
}

/** PD za starcie wg różnicy poziomów (PF2e). Wrogowie > 4 poziomy niżej nie dają nic. */
export function encounterXP(partyLevel: number, enemies: readonly (EnemyId | Character)[]): number {
  let sum = 0;
  for (const e of enemies) {
    const lvl = typeof e === 'string' ? (enemyDef(e)?.level ?? 0) : e.level;
    const diff = lvl - partyLevel;
    if (diff < -4) continue;
    sum += ENCOUNTER_XP[Math.min(4, diff)] ?? 0;
  }
  return sum;
}

/** Średni poziom drużyny (zaokrąglony, min. 1). */
export function partyLevel(party: readonly Character[]): number {
  if (!party.length) return 1;
  return Math.max(1, Math.round(party.reduce((s, c) => s + (c.level || 1), 0) / party.length));
}

// ---------- odpoczynek
/** Odnawia użycia zdolności (wszystkie albo tylko danego typu). */
export function refreshUses(ch: Character, which?: 'encounter' | 'day'): void {
  for (const id of Object.keys(ch.uses) as AbilityId[]) {
    const ab = abilityDef(id);
    if (!ab || !ab.uses) continue;
    if (!which || ab.uses === which) ch.uses[id] = ab.usesMax || 1;
  }
}

const KEEP_AFTER_ENCOUNTER: ReadonlySet<string> = new Set(['dying', 'wounded', 'unconscious', 'dead', 'bleeding']);
/** Po walce: zdejmuje stany bojowe (poza umieraniem/ranami/krwawieniem), zeruje tymcz. PW, odnawia zdolności "encounter". */
export function endEncounter(ch: Character): void {
  if (isDead(ch)) return;
  for (const id of Object.keys(ch.conditions) as (keyof typeof CONDITIONS)[]) {
    if (!CONDITIONS[id] || KEEP_AFTER_ENCOUNTER.has(id)) continue;
    delete ch.conditions[id];
  }
  if (ch.hp > 0) ch.tempHp = 0;
  refreshUses(ch, 'encounter');
}

/** Długi odpoczynek: pełne PW, czyste stany, wszystkie zdolności. */
export function longRest(ch: Character): void {
  if (isDead(ch)) return;
  ch.hp = ch.maxHp;
  ch.tempHp = 0;
  ch.conditions = {};
  refreshUses(ch);
}

// ---------- opisy
/** Krótkie linie statystyk do podpowiedzi. */
export function summarize(ch: Character): string[] {
  const out: string[] = [];
  const cls = classDef(ch.classId);
  out.push(`${ch.name}${cls ? ' – ' + cls.name : ''} (poz. ${ch.level})`);
  out.push(`PW ${ch.hp}/${ch.maxHp}${ch.tempHp ? ' (+' + ch.tempHp + ')' : ''} | KP ${getStat(ch, 'ac')} | Prędkość ${getStat(ch, 'speed')}`);
  out.push(
    `Wytrz. ${fmtMod(getStat(ch, 'fortitude'))} Ref. ${fmtMod(getStat(ch, 'reflex'))} Wola ${fmtMod(getStat(ch, 'will'))} Perc. ${fmtMod(getStat(ch, 'perception'))}`,
  );
  if (!ch.isEnemy) out.push('Cechy: ' + ATTRS.map((a) => `${a.toUpperCase()} ${fmtMod(ch.attrs[a])}`).join(' '));
  for (const w of getWeapons(ch)) {
    const n = normWeapon(w);
    out.push(`${n.name}: ${fmtMod(getAttackBonus(ch, w, 0))} (${n.dmg} ${DMG_ADJ[n.type] || ''})`);
  }
  const cs: string[] = [];
  for (const [k, v] of Object.entries(ch.conditions)) {
    const meta: ConditionDef | undefined = (CONDITIONS as Record<string, ConditionDef | undefined>)[k];
    if (!meta || meta.hidden) continue;
    cs.push(meta.name + (typeof v === 'number' && meta.valued ? ' ' + v : ''));
  }
  if (cs.length) out.push('Stany: ' + cs.join(', '));
  return out;
}
