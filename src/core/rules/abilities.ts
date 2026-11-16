// Efekty zdolności (uniwersalne, klasowe, wrogów). Metadane (koszt, zasięg, użycia) są w data/abilities.ts.
// Migracja z Oldgame/src/rules/abilities.js. Resolvery MUTUJĄ postacie (PW, stany, użycia).
import { DMG_ADJ } from '../data/rules.ts';
import type { AbilityId, ConditionDef, ConditionId, DamageType, SaveId } from '../data/types.ts';
import { CONDITIONS } from '../data/rules.ts';
import { check, d, dcForLevel, fmtD20, halveDie, fmtMod, roll, type CheckResult, type Rng } from './dice.ts';
import { applyDamage, grantTempHp, heal, isDead, type DamageOutcome } from './damage.ts';
import { abilityDef, ancestryOf, enemyDef, itemDef } from './lookup.ts';
import { newItem } from './character.ts';
import { acc, strike, type StrikeOptions } from './strike.ts';
import { addCondition, attrMod, checkBy, concealHalves, condValue, dieHalves, getStat, getWeapon, hasCondition, normWeapon, removeCondition, type StatKey } from './stats.ts';
import type { AbilityContext, ActionResult, AttackLike, Character, ConditionValue } from './types.ts';

const R = (): ActionResult => ({ log: [], events: [], attack: false });
const merge = (res: ActionResult, r: ActionResult): ActionResult => {
  res.log.push(...r.log);
  res.events.push(...r.events);
  if (r.d20 && !res.d20) res.d20 = r.d20;
  return r;
};
const SAVE_NAMES: Readonly<Record<SaveId, string>> = { fortitude: 'Wytrz.', reflex: 'Refleks', will: 'Wola' };
/** ST z obrony celu: 10 + statystyka. */
const dcOf = (t: Character, kind: StatKey): number => 10 + getStat(t, kind);
export const isMachine = (t: Character): boolean => !!(t.traits?.includes('machine') || (!t.isEnemy && ancestryOf(t.ancestry).traits.includes('machine')));
const spend = (u: Character, id: AbilityId): void => {
  const v = u.uses[id];
  if (v !== undefined) u.uses[id] = Math.max(0, v - 1);
};
const first = (ctx: AbilityContext): Character | null => ctx.targets[0] ?? null;
const noTarget = (): ActionResult => {
  const r = R();
  r.log.push('Brak celu.');
  return r;
};
const rngOf = (ctx: AbilityContext): Rng => ctx.rng ?? Math.random;
const mapOf = (ctx: AbilityContext): number => ctx.mapIndex || 0;
const condMeta = (id: ConditionId): ConditionDef => CONDITIONS[id];
const alive = (t: Character): boolean => t.hp > 0;

/** Strike z parametrami z kontekstu (broń, PWA, przyrosty zasięgu). */
const ctxStrike = (ctx: AbilityContext, t: Character, extra: StrikeOptions = {}): ActionResult =>
  strike(ctx.user, t, { weapon: ctx.weapon, mapIndex: mapOf(ctx), rng: rngOf(ctx), rangeIncrements: ctx.rangeIncrements, ...extra });

export function cond(res: ActionResult, t: Character, id: ConditionId, value: ConditionValue = 1, label?: string): void {
  const before = t.conditions[id];
  addCondition(t, id, value);
  const after = t.conditions[id];
  if (after !== undefined && after !== before) {
    res.events.push({ type: 'condition', target: t, condition: id, value: after });
    const meta = condMeta(id);
    res.log.push(label || `${t.name}: ${meta.name.toLowerCase()}${typeof value === 'number' && meta.valued ? ' ' + value : ''}.`);
  }
}
/** Nakłada stan po cichu (tylko zdarzenie, bez wpisu w dzienniku). */
function quietCond(res: ActionResult, t: Character, id: ConditionId, value: ConditionValue = 1): void {
  addCondition(t, id, value);
  res.events.push({ type: 'condition', target: t, condition: id });
}
function hurt(res: ActionResult, t: Character, amount: number, type: DamageType, crit = false): DamageOutcome {
  const a = applyDamage(t, amount, type, { crit });
  res.events.push({ type: 'damage', target: t, amount: a.dealt, dmgType: type });
  if (a.dead) {
    res.log.push(`${t.name} ginie.`);
    res.events.push({ type: 'death', target: t });
  } else if (a.downed) {
    res.log.push(`${t.name} traci przytomność!`);
    res.events.push({ type: 'down', target: t });
  }
  return a;
}
function doHeal(res: ActionResult, t: Character, amount: number, label: string): number {
  const n = heal(t, amount);
  res.events.push({ type: 'heal', target: t, amount: n });
  res.log.push(`${label}: ${t.name} odzyskuje ${n} PW.`);
  return n;
}
/** Rzut leczenia: suma + zapis kości do pokazu (res.heal, tylko pierwszy rzut w akcji). */
function healRoll(res: ActionResult, expr: string, rng: Rng, extra = 0, by?: Character): number {
  const rr = roll(expr, rng, by ? dieHalves(by) : 0);
  const total = rr.total + extra;
  if (!res.heal) res.heal = { dice: rr.dice, flat: rr.mod + extra, mult: 1, post: [], total };
  return total;
}
function tempHp(res: ActionResult, t: Character, n: number): void {
  grantTempHp(t, n);
  res.events.push({ type: 'heal', target: t, amount: n, temp: true });
}

/** Podstawowy rzut obronny: kryt. sukces 0, sukces 1/2, porażka całość, kryt. porażka x2. */
export function basicSave(
  res: ActionResult, t: Character, kind: SaveId, dc: number, expr: string, type: DamageType, rng: Rng, by?: Character,
): { c: CheckResult; a: DamageOutcome } {
  const c = checkBy(t, getStat(t, kind), dc, rng);
  if (!res.d20) res.d20 = c;
  const r = roll(expr, rng, by ? dieHalves(by) : 0);
  const amt = c.degree === 3 ? 0 : c.degree === 2 ? Math.floor(r.total / 2) : c.degree === 1 ? r.total : r.total * 2;
  if (!res.dmg) res.dmg = { dice: r.dice, flat: r.mod, mult: [0, 0.5, 1, 2][3 - c.degree], post: [], total: Math.max(0, amt) };
  let a: DamageOutcome = { dealt: 0, downed: false, dead: false };
  if (amt > 0) a = hurt(res, t, amt, type, c.degree === 0);
  else res.events.push({ type: 'miss', target: t, degree: c.degree });
  res.log.push(`${t.name}: ${a.dealt} obrażeń ${DMG_ADJ[type] || ''} (${SAVE_NAMES[kind]} k20 ${fmtD20(c)}${fmtMod(getStat(t, kind))}=${c.total} vs WT ${dc})`);
  return { c, a };
}

/** Prosty atak z własną premią (dron itp.) - bez broni. */
function simpleAttack(
  res: ActionResult, t: Character, o: { label: string; bonus: number; expr: string; type: DamageType; rng: Rng },
): { hit: boolean; c: CheckResult } {
  const dc = getStat(t, 'ac');
  const c = check(o.bonus, dc, o.rng, concealHalves(t));
  if (!res.d20) res.d20 = c;
  const info = `k20 ${fmtD20(c)}${fmtMod(o.bonus)}=${c.total} vs KP ${dc}`;
  if (c.degree <= 1) {
    res.log.push(`${o.label} pudłuje (${info}).`);
    res.events.push({ type: 'miss', target: t, degree: c.degree });
    return { hit: false, c };
  }
  const rr = roll(o.expr, o.rng);
  let tot = rr.total;
  if (c.degree === 3) tot *= 2;
  if (!res.dmg) res.dmg = { dice: rr.dice, flat: rr.mod, mult: c.degree === 3 ? 2 : 1, post: [], total: tot };
  const a = hurt(res, t, tot, o.type, c.degree === 3);
  res.log.push(`${o.label} trafia ${c.degree === 3 ? 'krytycznie ' : ''}${acc(t)}: ${a.dealt} obrażeń ${DMG_ADJ[o.type] || ''} (${info}).`);
  return { hit: true, c };
}

/** Atak wroga o indeksie i (z jego listy ataków). */
const enemyAttack = (ctx: AbilityContext, i = 0): AttackLike | undefined => ctx.user.attacks?.[i];
const targetsOrSelf = (ctx: AbilityContext): Character[] => (ctx.targets.length ? ctx.targets : [ctx.user]);
const deadNote = (r: ActionResult, t: Character): ActionResult => {
  r.log.push(`${t.name} nie żyje.`);
  return r;
};

export type AbilityResolver = (ctx: AbilityContext) => ActionResult;

const rage: AbilityResolver = (ctx) => {
  const u = ctx.user;
  const r = R();
  if (hasCondition(u, 'raging')) {
    r.log.push(`${u.name} już jest w szale.`);
    return r;
  }
  addCondition(u, 'raging', 5);
  const n = u.level + Math.max(0, attrMod(u, 'con'));
  tempHp(r, u, n);
  r.events.push({ type: 'condition', target: u, condition: 'raging' });
  r.log.push(`${u.name} wpada w szał! (+${n} tymcz. PW, +obrażenia, -1 KP)`);
  return r;
};

/** Efekt każdej zdolności. Klucze = AbilityId, więc brak efektu to błąd kompilacji. */
export const ABILITY_EFFECTS: Readonly<Record<AbilityId, AbilityResolver>> = {
  // ================= uniwersalne
  strike: (ctx) => {
    const t = first(ctx);
    if (!t) return noTarget();
    return ctxStrike(ctx, t, { bonus: ctx.bonus || 0, damageBonus: ctx.damageBonus || 0 });
  },
  raise_shield: (ctx) => {
    const r = R();
    const u = ctx.user;
    const sh = itemDef(u.equipment.shield?.id);
    if (!sh || sh.type !== 'shield') {
      r.log.push(`${u.name} nie ma tarczy.`);
      return r;
    }
    cond(r, u, 'raised_shield', 1, `${u.name} podnosi tarczę (+${sh.shield.ac} KP).`);
    return r;
  },
  take_cover: (ctx) => {
    const r = R();
    const u = ctx.user;
    const lvl = condValue(u, 'in_cover') >= 1 ? 2 : 1;
    u.conditions.in_cover = lvl;
    r.events.push({ type: 'condition', target: u, condition: 'in_cover', value: lvl });
    r.log.push(`${u.name} kryje się za osłoną (+${lvl === 2 ? 4 : 2} KP).`);
    return r;
  },
  demoralize: (ctx) => {
    const t = first(ctx);
    if (!t) return noTarget();
    const r = R();
    const u = ctx.user;
    if (hasCondition(t, 'dem_imm')) {
      r.log.push(`${t.name} jest odporny na zastraszanie.`);
      return r;
    }
    const dc = dcOf(t, 'will');
    const c = checkBy(u, getStat(u, 'intimidation'), dc, rngOf(ctx));
    r.d20 = c;
    addCondition(t, 'dem_imm', 4);
    const info = `Zastraszanie k20 ${fmtD20(c)}${fmtMod(c.mod)}=${c.total} vs WT ${dc}`;
    if (c.degree >= 2) {
      const v = c.degree === 3 ? 2 : 1;
      cond(r, t, 'frightened', v, `${u.name} zastrasza ${acc(t)}: przerażony ${v} (${info}).`);
    } else r.log.push(`${u.name} nie zastrasza ${acc(t)} (${info}).`);
    return r;
  },
  first_aid: (ctx) => {
    const u = ctx.user;
    const t = first(ctx) ?? u;
    const r = R();
    const rng = rngOf(ctx);
    if (isDead(t)) return deadNote(r, t);
    const dying = condValue(t, 'dying');
    const dc = dying ? 15 + dying : hasCondition(t, 'bleeding') ? 15 : dcForLevel(u.level);
    const c = checkBy(u, getStat(u, 'medicine'), dc, rng);
    r.d20 = c;
    const info = `Medycyna k20 ${fmtD20(c)}${fmtMod(c.mod)}=${c.total} vs WT ${dc}`;
    if (c.degree <= 1) {
      if (c.degree === 0 && dying) {
        t.conditions.dying = Math.min(3, dying + 1);
        r.log.push(`${u.name} pogarsza stan ${acc(t)} (${info}).`);
      } else r.log.push(`${u.name} nie pomaga ${t.name} (${info}).`);
      return r;
    }
    if (dying) {
      delete t.conditions.dying;
      t.conditions.wounded = Math.min(3, condValue(t, 'wounded') + 1);
      r.log.push(`${u.name} stabilizuje ${acc(t)} (${info}).`);
      r.events.push({ type: 'condition', target: t, condition: 'stable' });
      if (c.degree === 3) doHeal(r, t, healRoll(r, '1d6', rng, 0, u), 'Opatrunek');
      return r;
    }
    if (hasCondition(t, 'bleeding')) {
      removeCondition(t, 'bleeding');
      r.log.push(`${u.name} tamuje krwawienie ${t.name} (${info}).`);
      return r;
    }
    doHeal(r, t, healRoll(r, c.degree === 3 ? '2d6' : '1d6', rng, 1, u), `Pierwsza pomoc (${info})`);
    return r;
  },
  stand: (ctx) => {
    const r = R();
    const u = ctx.user;
    if (u.hp > 0 && hasCondition(u, 'prone')) {
      removeCondition(u, 'prone');
      r.log.push(`${u.name} wstaje.`);
    } else r.log.push(`${u.name} już stoi.`);
    return r;
  },

  // ================= Żołnierz
  suppressive_fire: (ctx) => {
    const r = R();
    const u = ctx.user;
    const rng = rngOf(ctx);
    r.attack = true;
    if (!ctx.targets.length) return noTarget();
    const w = normWeapon(getWeapon(u));
    if (w.range <= 0) {
      r.log.push(`${u.name} potrzebuje broni dystansowej.`);
      r.attack = false;
      return r;
    }
    spend(u, 'suppressive_fire');
    const dc = getStat(u, 'classDC');
    r.log.push(`${u.name} otwiera ogień zaporowy!`);
    const dmg = w.dmg.replace(/[+-]\d+$/, '');
    for (const t of ctx.targets) {
      const c = checkBy(t, getStat(t, 'reflex'), dc, rng);
      if (!r.d20) r.d20 = c;
      if (c.degree === 3) {
        r.log.push(`${t.name} unika ognia.`);
        continue;
      }
      const rr = roll(dmg, rng, dieHalves(u));
      let amt = rr.total;
      if (c.degree === 2) amt = Math.floor(amt / 2);
      if (c.degree === 0) amt *= 2;
      if (!r.dmg) r.dmg = { dice: rr.dice, flat: rr.mod, mult: c.degree === 2 ? 0.5 : c.degree === 0 ? 2 : 1, post: [], total: amt };
      const a = hurt(r, t, amt, w.type, c.degree === 0);
      r.log.push(`${t.name}: ${a.dealt} obrażeń (Refleks k20 ${fmtD20(c)}=${c.total} vs WT ${dc}).`);
      if (c.degree <= 1) cond(r, t, 'distracted', 2, `${t.name} kuli się pod ogniem.`);
      if (c.degree === 0) cond(r, t, 'frightened', 1);
    }
    return r;
  },
  double_strike: (ctx) => {
    const t = first(ctx);
    if (!t) return noTarget();
    const r = R();
    r.attack = true;
    r.attacks = 2;
    for (let i = 0; i < 2; i++) if (!isDead(t) && alive(t)) merge(r, ctxStrike(ctx, t));
    return r;
  },
  charge: (ctx) => {
    const t = first(ctx);
    if (!t) return noTarget();
    const r = strike(ctx.user, t, { weapon: ctx.weapon, mapIndex: mapOf(ctx), rng: rngOf(ctx), bonus: 1, damageBonus: 2 });
    r.log.unshift(`${ctx.user.name} szarżuje!`);
    return r;
  },
  rally: (ctx) => {
    const r = R();
    const u = ctx.user;
    spend(u, 'rally');
    r.log.push(`${u.name} woła: do mnie!`);
    const n = 4 + u.level * 2;
    for (const t of targetsOrSelf(ctx)) {
      removeCondition(t, 'frightened');
      tempHp(r, t, n);
      r.log.push(`${t.name}: +${n} tymcz. PW.`);
    }
    return r;
  },

  // ================= Zwiadowca
  mark_target: (ctx) => {
    const t = first(ctx);
    if (!t) return noTarget();
    const r = R();
    quietCond(r, t, 'hunted', 5);
    r.log.push(`${ctx.user.name} wyznacza cel: ${t.name}.`);
    return r;
  },
  precise_shot: (ctx) => {
    const t = first(ctx);
    if (!t) return noTarget();
    return ctxStrike(ctx, t, { bonus: 2, extraDice: 1, ignoreCover: true });
  },
  crippling_shot: (ctx) => {
    const t = first(ctx);
    if (!t) return noTarget();
    const u = ctx.user;
    const rng = rngOf(ctx);
    const r = ctxStrike(ctx, t);
    if (r.hit && alive(t)) {
      const c = checkBy(t, getStat(t, 'fortitude'), getStat(u, 'classDC'), rng);
      if (c.degree <= 1) {
        const v = c.degree === 0 ? 2 : 1;
        cond(r, t, 'slowed', v, `${t.name} kuleje (spowolniony ${v}).`);
      }
    }
    return r;
  },
  volley: (ctx) => {
    const t = first(ctx);
    if (!t) return noTarget();
    const r = R();
    r.attack = true;
    r.attacks = 2;
    spend(ctx.user, 'volley');
    for (let i = 0; i < 2; i++) if (alive(t)) merge(r, ctxStrike(ctx, t, { bonus: 1 }));
    return r;
  },

  // ================= Medyk
  field_dressing: (ctx) => {
    const u = ctx.user;
    const t = first(ctx) ?? u;
    const r = R();
    const rng = rngOf(ctx);
    if (isDead(t)) return deadNote(r, t);
    spend(u, 'field_dressing');
    const dc = dcForLevel(u.level);
    const c = checkBy(u, getStat(u, 'medicine'), dc, rng);
    r.d20 = c;
    const bonus = Math.max(0, attrMod(u, 'wis')) + u.level;
    const info = `Medycyna k20 ${fmtD20(c)}${fmtMod(c.mod)}=${c.total} vs WT ${dc}`;
    if (c.degree === 3) {
      doHeal(r, t, healRoll(r, `4d6+${bonus}`, rng, 0, u), `Opatrunek (${info})`);
      removeCondition(t, 'bleeding');
      removeCondition(t, 'poisoned');
    } else if (c.degree === 2) {
      doHeal(r, t, healRoll(r, `2d6+${bonus}`, rng, 0, u), `Opatrunek (${info})`);
      removeCondition(t, 'bleeding');
    } else if (c.degree === 1) doHeal(r, t, healRoll(r, '1d4', rng, 0, u), `Marny opatrunek (${info})`);
    else r.log.push(`${u.name} partaczy opatrunek ${t.name} (${info}).`);
    return r;
  },
  stimulant: (ctx) => {
    const u = ctx.user;
    const t = first(ctx) ?? u;
    const r = R();
    spend(u, 'stimulant');
    if (isDead(t)) return deadNote(r, t);
    const n = 4 + 2 * u.level;
    tempHp(r, t, n);
    quietCond(r, t, 'stimmed', 5);
    r.log.push(`${u.name} aplikuje stymulant: ${t.name} +${n} tymcz. PW, +1 do trafienia.`);
    return r;
  },
  adrenaline: (ctx) => {
    const u = ctx.user;
    const t = first(ctx) ?? u;
    const r = R();
    if (isDead(t)) return deadNote(r, t);
    spend(u, 'adrenaline');
    if (t.hp <= 0) {
      doHeal(r, t, healRoll(r, '1d8', rngOf(ctx), Math.max(0, attrMod(u, 'wis')) + u.level, u), `Adrenalina: ${t.name} wraca do walki`);
      removeCondition(t, 'prone');
    } else {
      quietCond(r, t, 'quickened', 1);
      r.log.push(`${t.name} dostaje zastrzyk adrenaliny: +1 akcja.`);
    }
    return r;
  },
  field_clinic: (ctx) => {
    const u = ctx.user;
    const r = R();
    const rng = rngOf(ctx);
    spend(u, 'field_clinic');
    for (const t of targetsOrSelf(ctx)) {
      if (!isDead(t)) doHeal(r, t, healRoll(r, '1d8', rng, Math.max(0, attrMod(u, 'wis')) + u.level, u), 'Punkt medyczny');
    }
    return r;
  },

  // ================= Technik
  combat_drone: (ctx) => {
    const t = first(ctx);
    if (!t) return noTarget();
    const u = ctx.user;
    const r = R();
    const rng = rngOf(ctx);
    spend(u, 'combat_drone');
    const b = getStat(u, 'classDC') - 10;
    const int = Math.max(0, attrMod(u, 'int'));
    r.log.push(`${u.name} wypuszcza drona bojowego.`);
    for (let i = 0; i < 2; i++) if (alive(t)) simpleAttack(r, t, { label: 'Dron', bonus: b - 5 * i, expr: `1d6+${int}`, type: 'P', rng });
    return r;
  },
  emp_grenade: (ctx) => {
    const u = ctx.user;
    const r = R();
    const rng = rngOf(ctx);
    spend(u, 'emp_grenade');
    if (!ctx.targets.length) return noTarget();
    const dc = getStat(u, 'classDC');
    r.log.push(`${u.name} rzuca granat EMP!`);
    for (const t of ctx.targets) {
      const mach = isMachine(t);
      const { c } = basicSave(r, t, 'reflex', dc, mach ? `2d6+${u.level}` : '1d4', 'elec', rng, u);
      if (mach && c.degree <= 1 && alive(t)) {
        const v = c.degree === 0 ? 2 : 1;
        cond(r, t, 'stunned', v, `${t.name} zwiera układy (ogłuszony ${v}).`);
      }
    }
    return r;
  },
  repair_armor: (ctx) => {
    const u = ctx.user;
    const t = first(ctx) ?? u;
    const r = R();
    if (isDead(t)) return deadNote(r, t);
    spend(u, 'repair_armor');
    const dc = dcForLevel(u.level);
    const c = checkBy(u, getStat(u, 'crafting'), dc, rngOf(ctx));
    r.d20 = c;
    const info = `Technika k20 ${fmtD20(c)}${fmtMod(c.mod)}=${c.total} vs WT ${dc}`;
    const n = 3 + 2 * u.level;
    if (c.degree >= 2) {
      const amt = c.degree === 3 ? n * 2 : n;
      tempHp(r, t, amt);
      quietCond(r, t, 'reinforced', 4);
      r.log.push(`${u.name} naprawia pancerz ${t.name}: +${amt} tymcz. PW, +1 KP (${info}).`);
    } else r.log.push(`${u.name} nie daje rady naprawić pancerza (${info}).`);
    return r;
  },
  weapon_tune: (ctx) => {
    const u = ctx.user;
    const t = first(ctx) ?? u;
    const r = R();
    spend(u, 'weapon_tune');
    quietCond(r, t, 'tuned', 4);
    r.log.push(`${u.name} stroi broń: ${t.name} +2 do obrażeń.`);
    return r;
  },

  // ================= Szczur
  sneak_attack: (ctx) => {
    const t = first(ctx);
    if (!t) return noTarget();
    const u = ctx.user;
    const r = R();
    let sneak = hasCondition(u, 'hidden');
    if (!sneak) {
      const dc = dcOf(t, 'perception');
      const c = checkBy(u, getStat(u, 'stealth'), dc, rngOf(ctx));
      r.d20 = c;
      sneak = c.degree >= 2;
      r.log.push(sneak ? `${u.name} wymyka się czujności ${t.name} (Skradanie k20 ${fmtD20(c)}=${c.total} vs ${dc}).` : `${t.name} zauważa ${u.name}.`);
    }
    removeCondition(u, 'hidden');
    const s = ctxStrike(ctx, t, { sneak });
    merge(r, s);
    r.attack = true;
    r.hit = s.hit;
    if (s.d20) r.d20 = s.d20;
    return r;
  },
  dodge: (ctx) => {
    const r = R();
    cond(r, ctx.user, 'dodging', 1, `${ctx.user.name} wymija ciosy (+2 KP).`);
    return r;
  },
  steal: (ctx) => {
    const t = first(ctx);
    if (!t) return noTarget();
    const u = ctx.user;
    const r = R();
    const rng = rngOf(ctx);
    if (t.stolen) {
      r.log.push(`${t.name} nie ma już nic do zabrania.`);
      return r;
    }
    const dc = dcOf(t, 'perception');
    const c = checkBy(u, getStat(u, 'thievery'), dc, rng);
    r.d20 = c;
    const info = `Złodziejstwo k20 ${fmtD20(c)}${fmtMod(c.mod)}=${c.total} vs ${dc}`;
    if (c.degree >= 2) {
      t.stolen = 1;
      const pool = (enemyDef(t.templateId)?.loot ?? []).filter((l) => {
        const def = itemDef(l.id);
        return def && def.type !== 'ammo';
      });
      const l = pool.length ? pool[Math.floor(rng() * pool.length)] : null;
      if (l) {
        const it = newItem(l.id, 1);
        u.inventory.push(it);
        r.log.push(`${u.name} kradnie ${t.name}: ${itemDef(l.id)?.name ?? l.id} (${info}).`);
        r.events.push({ type: 'steal', target: t, item: it });
      } else r.log.push(`${u.name} przeszukuje ${acc(t)}, ale nic nie znajduje (${info}).`);
      if (c.degree === 3) {
        const sc = 2 + halveDie(d(6, rng), dieHalves(u));
        u.stolenScrap = (u.stolenScrap || 0) + sc;
        r.events.push({ type: 'scrap', amount: sc });
        r.log.push(`Do tego ${sc} Złomu.`);
      }
    } else if (c.degree === 0) cond(r, u, 'clumsy', 1, `${u.name} daje się przyłapać! (${info}).`);
    else r.log.push(`${u.name} nie zdołał nic zabrać (${info}).`);
    return r;
  },
  dirty_trick: (ctx) => {
    const t = first(ctx);
    if (!t) return noTarget();
    const u = ctx.user;
    const r = R();
    const c = checkBy(t, getStat(t, 'reflex'), getStat(u, 'classDC'), rngOf(ctx));
    r.d20 = c;
    if (c.degree >= 2) {
      r.log.push(`${t.name} unika piasku.`);
      return r;
    }
    cond(r, t, 'distracted', 2, `${u.name} sypie piasek w oczy ${acc(t)}!`);
    cond(r, t, 'clumsy', c.degree === 0 ? 2 : 1);
    return r;
  },

  // ================= Brutal
  rage,
  roar: (ctx) => {
    const u = ctx.user;
    const r = R();
    const rng = rngOf(ctx);
    spend(u, 'roar');
    if (!ctx.targets.length) {
      r.log.push(`${u.name} ryczy w pustkę.`);
      return r;
    }
    r.log.push(`${u.name} wydaje straszliwy ryk!`);
    for (const t of ctx.targets) {
      const dc = dcOf(t, 'will');
      const c = checkBy(u, getStat(u, 'intimidation'), dc, rng);
      if (!r.d20) r.d20 = c;
      if (c.degree >= 2) cond(r, t, 'frightened', c.degree === 3 ? 2 : 1, `${t.name} cofa się w strachu (Zastraszanie k20 ${fmtD20(c)}=${c.total} vs ${dc}).`);
      else r.log.push(`${t.name} nie daje się zastraszyć.`);
    }
    return r;
  },
  rend: (ctx) => {
    const t = first(ctx);
    if (!t) return noTarget();
    const r = strike(ctx.user, t, { weapon: ctx.weapon, mapIndex: mapOf(ctx), rng: rngOf(ctx), extraDice: 1 });
    if (r.hit && alive(t)) {
      quietCond(r, t, 'bleeding', r.d20?.degree === 3 ? '2d6' : '1d6');
      r.log.push(`${t.name} krwawi!`);
    }
    return r;
  },
  shove: (ctx) => {
    const t = first(ctx);
    if (!t) return noTarget();
    const u = ctx.user;
    const r = R();
    const rng = rngOf(ctx);
    const dc = dcOf(t, 'reflex');
    const c = checkBy(u, getStat(u, 'athletics'), dc, rng);
    r.d20 = c;
    const info = `Atletyka k20 ${fmtD20(c)}${fmtMod(c.mod)}=${c.total} vs ${dc}`;
    if (c.degree >= 2) {
      cond(r, t, 'prone', 1, `${u.name} powala ${acc(t)} (${info}).`);
      if (c.degree === 3) hurt(r, t, roll('1d6', rng, dieHalves(u)).total, 'B');
    } else if (c.degree === 0) cond(r, u, 'prone', 1, `${u.name} potyka się! (${info}).`);
    else r.log.push(`${u.name} nie zdołał powalić ${acc(t)} (${info}).`);
    return r;
  },
  second_wind: (ctx) => {
    const u = ctx.user;
    const r = R();
    spend(u, 'second_wind');
    doHeal(r, u, healRoll(r, '1d8', rngOf(ctx), Math.max(0, attrMod(u, 'con')) + u.level + 4, u), 'Drugi oddech');
    return r;
  },

  // ================= zdolności wrogów
  bite_trip: (ctx) => {
    const t = first(ctx);
    if (!t) return noTarget();
    const u = ctx.user;
    const rng = rngOf(ctx);
    const r = strike(u, t, { weapon: enemyAttack(ctx), mapIndex: mapOf(ctx), rng });
    if (r.hit && alive(t) && checkBy(t, getStat(t, 'reflex'), getStat(u, 'classDC'), rng).degree <= 1) cond(r, t, 'prone', 1, `${t.name} upada!`);
    return r;
  },
  swarm_cloud: (ctx) => {
    const u = ctx.user;
    const r = R();
    const rng = rngOf(ctx);
    if (!ctx.targets.length) return noTarget();
    for (const t of ctx.targets) {
      const { c } = basicSave(r, t, 'fortitude', getStat(u, 'classDC'), '1d6+1', 'poison', rng, u);
      if (c.degree <= 1) cond(r, t, 'sickened', 1);
    }
    return r;
  },
  poison_sting: (ctx) => {
    const t = first(ctx);
    if (!t) return noTarget();
    const u = ctx.user;
    const rng = rngOf(ctx);
    const sting: AttackLike = { name: 'Żądło', bonus: u.attacks?.[0]?.bonus ?? 0, damage: '1d6+3', dmgType: 'P', traits: [] };
    const r = strike(u, t, { weapon: sting, mapIndex: mapOf(ctx), rng });
    if (r.hit && alive(t)) {
      const c = checkBy(t, getStat(t, 'fortitude'), getStat(u, 'classDC'), rng);
      if (c.degree <= 1) {
        cond(r, t, 'poisoned', '1d6', `${t.name} zatruty!`);
        if (c.degree === 0) cond(r, t, 'sickened', 1);
      }
    }
    return r;
  },
  quake: (ctx) => {
    const u = ctx.user;
    const r = R();
    const rng = rngOf(ctx);
    if (!ctx.targets.length) return noTarget();
    for (const t of ctx.targets) {
      const { c } = basicSave(r, t, 'reflex', getStat(u, 'classDC'), '2d6+3', 'B', rng, u);
      if (c.degree <= 1 && alive(t)) cond(r, t, 'prone', 1);
    }
    return r;
  },
  rad_touch: (ctx) => {
    const t = first(ctx);
    if (!t) return noTarget();
    const u = ctx.user;
    const rng = rngOf(ctx);
    const r = strike(u, t, { weapon: enemyAttack(ctx), mapIndex: mapOf(ctx), rng });
    if (r.hit && alive(t)) {
      const c = checkBy(t, getStat(t, 'fortitude'), getStat(u, 'classDC'), rng);
      if (c.degree <= 1) cond(r, t, 'sickened', c.degree === 0 ? 2 : 1, `${t.name} choruje od promieniowania.`);
    }
    return r;
  },
  frenzy: (ctx) => {
    const u = ctx.user;
    const r = R();
    if (hasCondition(u, 'raging')) {
      r.log.push(`${u.name} już szaleje.`);
      return r;
    }
    addCondition(u, 'raging', 5);
    tempHp(r, u, 5 + u.level);
    r.events.push({ type: 'condition', target: u, condition: 'raging' });
    r.log.push(`${u.name} wpada w szał!`);
    return r;
  },
  throw_molotov: (ctx) => {
    const u = ctx.user;
    const r = R();
    const rng = rngOf(ctx);
    spend(u, 'throw_molotov');
    if (!ctx.targets.length) return noTarget();
    r.log.push(`${u.name} ciska koktajl Mołotowa!`);
    for (const t of ctx.targets) {
      const { c } = basicSave(r, t, 'reflex', 16 + Math.floor(u.level / 2), '1d6+2', 'fire', rng, u);
      if (c.degree <= 1 && alive(t)) cond(r, t, 'burning', '1d4', `${t.name} płonie!`);
    }
    return r;
  },
  headshot: (ctx) => {
    const t = first(ctx);
    if (!t) return noTarget();
    return strike(ctx.user, t, { weapon: enemyAttack(ctx), mapIndex: mapOf(ctx), rng: rngOf(ctx), bonus: 2, extraDice: 1, ignoreCover: true });
  },
  chief_rally: (ctx) => {
    const u = ctx.user;
    const r = R();
    spend(u, 'chief_rally');
    r.log.push(`${u.name} ryczy: do roboty, kundle!`);
    for (const t of targetsOrSelf(ctx)) {
      tempHp(r, t, 6);
      addCondition(t, 'stimmed', 4);
    }
    return r;
  },
  self_destruct: (ctx) => {
    const u = ctx.user;
    const r = R();
    const rng = rngOf(ctx);
    r.log.push(`${u.name} wybucha!`);
    for (const t of ctx.targets) basicSave(r, t, 'reflex', 16, '2d8', 'P', rng, u);
    u.hp = 0;
    u.conditions.dead = 1;
    r.events.push({ type: 'death', target: u });
    return r;
  },
  turret_burst: (ctx) => {
    const t = first(ctx);
    if (!t) return noTarget();
    const r = R();
    r.attack = true;
    r.attacks = 3;
    for (let i = 0; i < 3; i++) if (alive(t)) merge(r, strike(ctx.user, t, { weapon: enemyAttack(ctx), mapIndex: mapOf(ctx) + i, rng: rngOf(ctx) }));
    return r;
  },
  rocket_salvo: (ctx) => {
    const u = ctx.user;
    const r = R();
    const rng = rngOf(ctx);
    spend(u, 'rocket_salvo');
    if (!ctx.targets.length) return noTarget();
    r.log.push(`${u.name} odpala salwę rakiet!`);
    for (const t of ctx.targets) basicSave(r, t, 'reflex', getStat(u, 'classDC'), '3d6+4', 'B', rng, u);
    return r;
  },
  kostucha_cull: (ctx) => {
    const r = R();
    r.attack = true;
    const ts = ctx.targets.slice(0, 2);
    if (!ts.length) return noTarget();
    r.attacks = ts.length;
    r.log.push(`${ctx.user.name} zamaszyście tnie kosą!`);
    for (const t of ts) merge(r, strike(ctx.user, t, { weapon: enemyAttack(ctx, 0), mapIndex: mapOf(ctx), rng: rngOf(ctx) }));
    return r;
  },
  kostucha_barrage: (ctx) => {
    const u = ctx.user;
    const r = R();
    const rng = rngOf(ctx);
    spend(u, 'kostucha_barrage');
    if (!ctx.targets.length) return noTarget();
    r.log.push(`${u.name} wzywa gradobicie!`);
    for (const t of ctx.targets) {
      const { c } = basicSave(r, t, 'reflex', 22, '3d6+2', 'P', rng, u);
      if (c.degree <= 1 && alive(t)) cond(r, t, 'distracted', 2);
    }
    return r;
  },
  kostucha_command: (ctx) => {
    const u = ctx.user;
    const r = R();
    spend(u, 'kostucha_command');
    r.log.push(`${u.name}: "Żniwa czas zacząć!"`);
    tempHp(r, u, 15);
    for (const t of ctx.targets.filter((x) => x !== u).slice(0, 3)) {
      addCondition(t, 'quickened', 1);
      addCondition(t, 'stimmed', 3);
      r.log.push(`${t.name} dostaje dodatkową akcję.`);
    }
    return r;
  },
};

// ================= zasady użycia
/** Postać zna zdolność i ma jeszcze użycia. */
export function canUse(u: Character, id: AbilityId): boolean {
  const ab = abilityDef(id);
  if (!ab || !u.abilities.includes(id)) return false;
  if (ab.uses && (u.uses[id] === undefined || (u.uses[id] ?? 0) <= 0)) return false;
  return true;
}
export const usesLeft = (u: Character, id: AbilityId): number => (abilityDef(id)?.uses ? (u.uses[id] ?? 0) : Infinity);

/**
 * Rozpatruje zdolność. Jeżeli zdolność ma limit użyć, a resolver go nie zmniejszył,
 * zmniejsza go tutaj (tak robił stary kontroler walki).
 */
export function useAbility(id: AbilityId, ctx: AbilityContext): ActionResult {
  const ab = abilityDef(id);
  if (!ab) throw new Error('Nieznana zdolność: ' + id);
  if (ab.uses && !canUse(ctx.user, id)) {
    const r = R();
    r.log.push(`${ctx.user.name}: brak użyć (${ab.name}).`);
    return r;
  }
  const before = ctx.user.uses[id];
  const res = ABILITY_EFFECTS[id](ctx);
  if (ab.uses && typeof before === 'number' && ctx.user.uses[id] === before) ctx.user.uses[id] = Math.max(0, before - 1);
  return res;
}
