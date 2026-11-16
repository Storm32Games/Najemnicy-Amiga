// Atak bronią (Strike): trafienie vs KP, krytyki, cechy deadly/fatal, atak z ukrycia, premie klasowe.
// Migracja z Oldgame/src/rules/core.js -> strike().
import { DMG_ADJ } from '../data/rules.ts';
import { check, d, fmtD20, fmtMod, halveDie, parseDice, type DieRoll, type Rng } from './dice.ts';
import { applyDamage } from './damage.ts';
import { attackHalves, attrMod, dieHalves, getAttackBonus, getStat, getWeapon, hasCondition, isOffGuard, normWeapon, traitDie, traitVal } from './stats.ts';
import type { ActionResult, Character, WeaponRef } from './types.ts';

export interface StrikeOptions {
  weapon?: WeaponRef | null;
  /** Liczba ataków wykonanych już w tej turze (kara PWA). */
  mapIndex?: number;
  rng?: Rng;
  /** Premia do trafienia (np. Natarcie +1). */
  bonus?: number;
  damageBonus?: number;
  /** Dodatkowe kości obrażeń (Precyzyjny strzał, Rozpłatanie). */
  extraDice?: number;
  ignoreCover?: boolean;
  rangeIncrements?: number;
  /** Wymusza atak z ukrycia (Szczur). */
  sneak?: boolean;
  /** Połowienia k20 trafienia; domyślnie attackHalves(atakujący, obrońca). */
  hitHalves?: number;
}

/** Imię w bierniku do dziennika. */
export const acc = (ch: Character): string => ch.nameAcc || ch.name;

/** Kości ataku z ukrycia: tylko Szczur, 1/1/2/2/3... wg poziomu. */
const sneakDice = (ch: Character): number => (ch.classId === 'scavenger' ? Math.floor((ch.level + 1) / 2) : 0);

/** Wykonuje atak. MUTUJE obrońcę (PW, stany). */
export function strike(attacker: Character, defender: Character, o: StrikeOptions = {}): ActionResult {
  const res: ActionResult = { log: [], events: [], attack: true };
  const w = normWeapon(o.weapon ?? getWeapon(attacker));
  const bonus = getAttackBonus(attacker, w, o.mapIndex || 0, { rangeIncrements: o.rangeIncrements }) + (o.bonus || 0);
  const dc = getStat(defender, 'ac', { ignoreCover: !!o.ignoreCover || w.range === 0 });
  const rng = o.rng ?? Math.random;
  const c = check(bonus, dc, rng, o.hitHalves ?? attackHalves(attacker, defender));
  res.d20 = c;
  res.weapon = w;
  const info = `k20 ${fmtD20(c)}${fmtMod(bonus)}=${c.total} vs KP ${dc}`;
  if (c.degree <= 1) {
    res.log.push(`${attacker.name} pudłuje (${info}).`);
    res.events.push({ type: 'miss', target: defender, degree: c.degree });
    return res;
  }
  const crit = c.degree === 3;
  const p = parseDice(w.dmg);
  const dice = p.n + (o.extraDice || 0);
  const fatal = traitDie(w, 'fatal');
  const deadly = traitDie(w, 'deadly');
  const sides = crit && fatal ? fatal : p.sides;
  const rolled: DieRoll[] = [];
  const post: DieRoll[] = [];
  const dmgHalves = dieHalves(attacker);
  const die = (n: number, out: DieRoll[]): number => {
    const v = halveDie(d(n, rng), dmgHalves);
    out.push({ sides: n, value: v });
    return v;
  };
  let sum = 0;
  for (let i = 0; i < dice; i++) sum += die(sides, rolled);

  let flat = p.mod + (o.damageBonus || 0);
  const isPc = !attacker.base;
  if (isPc && (w.range === 0 || traitVal(w, 'thrown'))) flat += attrMod(attacker, 'str');
  if (hasCondition(attacker, 'raging') && w.range === 0) flat += 2 + Math.floor(attacker.level / 5);
  if (hasCondition(attacker, 'tuned')) flat += 2;
  if (attacker.classId === 'scout' && hasCondition(defender, 'hunted')) flat += 2 + Math.floor(attacker.level / 4);

  let sneak = 0;
  const sn = sneakDice(attacker);
  if (sn && (isOffGuard(defender) || o.sneak)) for (let i = 0; i < sn; i++) sneak += die(6, rolled);

  let total = sum + flat + sneak;
  if (crit) {
    total *= 2;
    if (fatal) total += die(fatal, post);
    else if (deadly) for (let i = 0; i < (dice >= 3 ? 2 : 1); i++) total += die(deadly, post);
  }
  total = Math.max(1, total);
  res.dmg = { dice: rolled, flat, mult: crit ? 2 : 1, post, total };

  const r = applyDamage(defender, total, w.type, { crit });
  res.events.push({ type: 'damage', target: defender, amount: r.dealt, degree: c.degree, dmgType: w.type });
  if (crit) res.events.push({ type: 'crit', target: defender, degree: 3 });
  res.log.push(
    `${attacker.name} trafia ${crit ? 'krytycznie ' : ''}${acc(defender)}: ${r.dealt} obrażeń ${DMG_ADJ[w.type] || ''}` +
      `${sneak ? ' (z ukrycia +' + sneak + ')' : ''} (${info}).`,
  );
  if (r.dead) {
    res.log.push(`${defender.name} ginie.`);
    res.events.push({ type: 'death', target: defender });
  } else if (r.downed) {
    res.log.push(`${defender.name} traci przytomność!`);
    res.events.push({ type: 'down', target: defender });
  }
  res.hit = true;
  res.dealt = r.dealt;
  return res;
}
