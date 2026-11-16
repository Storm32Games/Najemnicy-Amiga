// Stany, cechy, statystyki pochodne (KP, rzuty obronne, umiejętności) i broń.
// Migracja z Oldgame/src/rules/core.js (sekcje "warunki", "statystyki", "broń").
import { UNARMED } from '../data/items.ts';
import { BASE_AC, COVER_AC, MAP, PERSISTENT, SKILLS } from '../data/rules.ts';
import type { ArmorStats, AttrId, ConditionId, SaveId, ShieldStats, SkillId } from '../data/types.ts';
import { check, profBonus, type CheckResult, type Rng } from './dice.ts';
import { ancestryOf, classDef, conditionDef, itemDef } from './lookup.ts';
import type { AttackLike, Character, ConditionValue, NormWeapon, WeaponItemLike, WeaponRef } from './types.ts';

// ---------- stany
const PERSISTENT_SET: ReadonlySet<ConditionId> = new Set(PERSISTENT);
export const isPersistent = (id: ConditionId): boolean => PERSISTENT_SET.has(id);

export const isOffGuard = (ch: Character): boolean => !!(ch.conditions.off_guard || ch.conditions.distracted || ch.conditions.prone);
export const hasCondition = (ch: Character, id: ConditionId): boolean => !!ch.conditions[id];
/** Wartość liczbowa stanu (flaga = 1, brak = 0, kości ciągłe = 1). */
export function condValue(ch: Character, id: ConditionId): number {
  const v = ch.conditions[id];
  return typeof v === 'number' ? v : v ? 1 : 0;
}

/**
 * Nakłada stan. Obrażenia ciągłe nadpisują kość; stany z wartością / czasowe biorą maksimum;
 * martwi i odporni (np. maszyny na truciznę) są pomijani.
 */
export function addCondition(ch: Character, id: ConditionId, value: ConditionValue = 1): void {
  if (ch.conditions.dead && id !== 'dead') return;
  if (ch.immune && (ch.immune.includes(id) || (id === 'poisoned' && ch.immune.includes('poison')))) return;
  if (isPersistent(id)) {
    ch.conditions[id] = value;
    return;
  }
  const meta = conditionDef(id);
  const cur = ch.conditions[id];
  if (meta && (meta.valued || meta.kind === 'timed' || meta.kind === 'decay' || meta.kind === 'consume')) {
    ch.conditions[id] = Math.max(typeof cur === 'number' ? cur : 0, typeof value === 'number' ? value : 1);
  } else {
    ch.conditions[id] = value;
  }
}
export function removeCondition(ch: Character, id: ConditionId): void {
  delete ch.conditions[id];
}

/** Kara statusowa: chory. (Przerażony nie daje kary - połowi kości, patrz dieHalves.) */
export const statusPenalty = (ch: Character): number => condValue(ch, 'sickened');

/** Zastraszenie: przerażona postać dzieli każdy swój rzut kością na 2 (zaokrąglenie w górę). */
export const dieHalves = (ch: Character): number => (hasCondition(ch, 'frightened') ? 1 : 0);
/**
 * Ukrycie celu: atakujący dzieli kość testu trafienia na 2. Ukryty (hidden) - każdy atak;
 * Kryj się (in_cover nadane umiejętnością) - ataki dystansowe, tak jak premia osłony do KP.
 */
export const concealHalves = (def: Character, ranged: boolean): number =>
  hasCondition(def, 'hidden') || (ranged && hasCondition(def, 'in_cover')) ? 1 : 0;
/** Test k20 wykonywany przez postać: przerażona połowi kość. `extra` - dodatkowe połowienia (ukryty cel). */
export const checkBy = (ch: Character, mod: number, dc: number, rng: Rng = Math.random, extra = 0): CheckResult =>
  check(mod, dc, rng, dieHalves(ch) + extra);
/** Połowienia k20 testu trafienia: przerażony atakujący + ukryty cel (sumują się). */
export const attackHalves = (att: Character, def: Character, ranged: boolean): number => dieHalves(att) + concealHalves(def, ranged);

/** Modyfikator cechy po stanach (niezdarny obniża ZR, osłabiony SIŁ). */
export function attrMod(ch: Character, a: AttrId): number {
  let v = ch.attrs[a] || 0;
  if (a === 'dex') v -= condValue(ch, 'clumsy');
  if (a === 'str') v -= condValue(ch, 'enfeebled');
  return v;
}

// ---------- ekwipunek
export function armorOf(ch: Character): ArmorStats | null {
  const def = itemDef(ch.equipment?.armor?.id);
  return def && def.type === 'armor' ? def.armor : null;
}
export function shieldOf(ch: Character): ShieldStats | null {
  const def = itemDef(ch.equipment?.shield?.id);
  return def && def.type === 'shield' ? def.shield : null;
}

// ---------- statystyki
export type StatKey = 'ac' | 'speed' | 'perception' | 'classDC' | SaveId | SkillId;
const SAVE_ATTR: Readonly<Record<SaveId, AttrId>> = { fortitude: 'con', reflex: 'dex', will: 'wis' };
const isSave = (k: string): k is SaveId => k in SAVE_ATTR;
const isSkill = (k: string): k is SkillId => k in SKILLS;

export interface StatOptions {
  /** Pomija premię z osłony (ataki wręcz, precyzyjne strzały). */
  ignoreCover?: boolean;
}

/** Statystyka pochodna z uwzględnieniem pancerza, stanów i osłony. */
export function getStat(ch: Character, key: StatKey, opts: StatOptions = {}): number {
  const lvl = ch.level;
  const pen = statusPenalty(ch);
  let v: number;
  if (key === 'speed') {
    if (ch.speed === 0) return 0;
    const ar = armorOf(ch);
    return Math.max(1, ch.speed - (ar ? ar.speedPenalty || 0 : 0));
  }
  if (ch.base) {
    const b = ch.base;
    if (key === 'ac') v = b.ac;
    else if (key === 'fortitude') v = b.fortitude;
    else if (key === 'reflex') v = b.reflex - condValue(ch, 'clumsy');
    else if (key === 'will') v = b.will;
    else if (key === 'perception') v = b.perception;
    else if (key === 'classDC') v = b.classDC;
    else v = b.skills[key] ?? b.perception - 1;
  } else {
    const prof = ch.prof;
    if (key === 'ac') {
      const ar = armorOf(ch);
      const cat = ar ? ar.category : 'unarmored';
      let dx = attrMod(ch, 'dex');
      if (ar) dx = Math.min(dx, ar.dexCap);
      v = BASE_AC + dx + profBonus(prof.defense[cat] || 0, lvl) + (ar ? ar.ac : 0) + (ancestryOf(ch.ancestry).acBonus || 0);
    } else if (isSave(key)) v = attrMod(ch, SAVE_ATTR[key]) + profBonus(prof[key] || 0, lvl);
    else if (key === 'perception') v = attrMod(ch, 'wis') + profBonus(prof.perception || 0, lvl);
    else if (key === 'classDC') v = 10 + attrMod(ch, classDef(ch.classId)?.keyAttr ?? 'str') + profBonus(prof.classDC || 0, lvl);
    else if (isSkill(key)) {
      const sk = SKILLS[key];
      v = attrMod(ch, sk.attr) + profBonus(prof.skills[key] || 0, lvl);
      if (sk.attr === 'str' || sk.attr === 'dex') {
        const ar = armorOf(ch);
        if (ar) v -= ar.checkPenalty || 0;
      }
    } else v = 0;
  }
  if (key === 'ac') {
    if (isOffGuard(ch)) v -= 2;
    let circ = 0;
    const cov = condValue(ch, 'in_cover');
    if (!opts.ignoreCover && cov) circ = Math.max(circ, cov >= 2 ? COVER_AC[2] : COVER_AC[1]);
    if (hasCondition(ch, 'raised_shield')) circ = Math.max(circ, (shieldOf(ch) ?? { ac: 2 }).ac);
    if (hasCondition(ch, 'dodging')) circ = Math.max(circ, 2);
    v += circ;
    if (hasCondition(ch, 'reinforced')) v += 1;
    if (hasCondition(ch, 'raging')) v -= 1;
  }
  return v - pen;
}

// ---------- broń
const isNorm = (w: WeaponRef): w is NormWeapon => typeof w === 'object' && 'normalized' in w;
const isWeaponItem = (w: WeaponRef): w is WeaponItemLike => typeof w === 'object' && 'weapon' in w;
const isAttackLike = (w: WeaponRef): w is AttackLike => typeof w === 'object' && 'bonus' in w && 'damage' in w;

function fromItem(w: WeaponItemLike): NormWeapon {
  const x = w.weapon;
  return {
    normalized: true, id: w.id, name: w.name, dmg: x.damage, type: x.dmgType, range: x.range || 0, category: x.category,
    traits: x.traits || [], sfx: x.sfx, potency: x.potency || 0, hands: x.hands || 1,
  };
}

/** Sprowadza broń (id, instancję, przedmiot, atak wroga) do NormWeapon. Brak -> Pięść. */
export function normWeapon(w?: WeaponRef | null): NormWeapon {
  if (!w) return fromItem(UNARMED);
  if (isNorm(w)) return w;
  if (typeof w === 'string') {
    const def = itemDef(w);
    return fromItem(def && def.type === 'weapon' ? def : UNARMED);
  }
  if (isWeaponItem(w)) return fromItem(w);
  if (isAttackLike(w)) {
    return {
      normalized: true, id: null, name: w.name, dmg: w.damage, type: w.dmgType, range: w.range || 0,
      traits: w.traits || [], sfx: w.sfx || 'melee', flat: w.bonus, potency: 0, hands: 1,
    };
  }
  // ItemInstance
  const def = itemDef(w.id);
  return fromItem(def && def.type === 'weapon' ? def : UNARMED);
}

/** Cecha broni: 'agile' -> true, 'deadly:10' -> 10, brak -> null. */
export function traitVal(w: NormWeapon, name: string): number | true | null {
  const t = w.traits.find((x) => x === name || x.startsWith(name + ':'));
  if (!t) return null;
  return t.includes(':') ? Number(t.split(':')[1]) : true;
}
const traitDie = (w: NormWeapon, name: string): number => {
  const v = traitVal(w, name);
  return typeof v === 'number' ? v : 0;
};
export { traitDie };

/** Lista broni: wrogowie - ich ataki; postacie - broń główna i zapasowa (albo Pięść). */
export function getWeapons(ch: Character): WeaponRef[] {
  if (ch.attacks) return ch.attacks;
  const out: WeaponRef[] = [];
  for (const slot of ['weapon', 'weapon2'] as const) {
    const def = itemDef(ch.equipment[slot]?.id);
    if (def && def.type === 'weapon') out.push(def);
  }
  return out.length ? out : [UNARMED];
}
export const getWeapon = (ch: Character): WeaponRef => getWeapons(ch)[0];

export interface AttackOptions {
  /** Przyrosty zasięgu (każdy -2). */
  rangeIncrements?: number;
}

/** Premia do trafienia z karą za wielokrotny atak (mapIndex = ile ataków już było w turze). */
export function getAttackBonus(ch: Character, weapon?: WeaponRef | null, mapIndex = 0, opts: AttackOptions = {}): number {
  const w = normWeapon(weapon ?? getWeapon(ch));
  const table = traitVal(w, 'agile') ? MAP.agile : MAP.normal;
  const map = table[Math.max(0, Math.min(2, mapIndex))];
  let b: number;
  if (ch.base || w.flat !== undefined) b = w.flat ?? 0;
  else {
    let m: number;
    if (w.range > 0) m = attrMod(ch, 'dex');
    else if (traitVal(w, 'finesse')) m = Math.max(attrMod(ch, 'str'), attrMod(ch, 'dex'));
    else m = attrMod(ch, 'str');
    b = m + profBonus((w.category && ch.prof.attacks[w.category]) || 0, ch.level) + w.potency;
  }
  if (hasCondition(ch, 'stimmed')) b += 1;
  if (hasCondition(ch, 'prone')) b -= 2;
  if (ch.base && w.range > 0) b -= condValue(ch, 'clumsy');
  b -= statusPenalty(ch);
  b -= 2 * (opts.rangeIncrements || 0);
  return b + map;
}
