// Zasady potyczki używane przez WorldScene: podgląd ataku (szansa trafienia) i przedmioty z plecaka.
// Wersja uproszczona względem tactical/combat.ts (bez flankowania/osłony), ale te same wzory PF2e.
// Zero zależności od Phasera / DOM.
import { hitChances } from './rules/dice.ts';
import { itemDef } from './rules/lookup.ts';
import { attackHalves, getAttackBonus, getStat, getWeapon, normWeapon, traitVal } from './rules/stats.ts';
import type { Character, GridPos, ItemInstance, NormWeapon } from './rules/types.ts';

export interface StrikePreview {
  ok: boolean;
  reason?: string;
  weapon: NormWeapon;
  /** Premia do trafienia (z PWA i dystansem). */
  mod: number;
  ac: number;
  /** 0..1 */
  hit: number;
  crit: number;
  /** Przyrosty zasięgu (każdy -2). */
  inc: number;
  mapIdx: number;
}

/** Odległość Czebyszewa na siatce. */
export const chebyshev = (a: GridPos, b: GridPos): number => Math.max(Math.abs(a.gx - b.gx), Math.abs(a.gy - b.gy));

/**
 * Czy `attacker` może trafić `defender` z pola `from` i z jaką szansą.
 * @param attacksMade ataki wykonane już w tej turze (kara za wielokrotny atak)
 * @param hasLos      czy jest linia wzroku (liczy ją warstwa wyżej, np. LineOfSight)
 */
export function previewStrike(attacker: Character, defender: Character, from: GridPos, to: GridPos, attacksMade: number, hasLos: boolean): StrikePreview {
  const w = normWeapon(getWeapon(attacker));
  const out: StrikePreview = { ok: false, weapon: w, mod: 0, ac: 0, hit: 0, crit: 0, inc: 0, mapIdx: Math.min(2, attacksMade) };
  const d = chebyshev(from, to);
  if (w.range === 0) {
    const reach = traitVal(w, 'reach') ? 2 : 1;
    if (d > reach) return { ...out, reason: 'za daleko' };
  } else {
    if (d > w.range * 6) return { ...out, reason: 'poza zasięgiem' };
    if (!hasLos) return { ...out, reason: 'brak linii strzału' };
    out.inc = Math.ceil(d / w.range) - 1;
  }
  out.mod = getAttackBonus(attacker, w, out.mapIdx, { rangeIncrements: out.inc });
  out.ac = getStat(defender, 'ac', { ignoreCover: w.range === 0 });
  const ch = hitChances(out.mod, out.ac, attackHalves(attacker, defender, w.range > 0));
  out.hit = ch.hit;
  out.crit = ch.crit;
  out.ok = true;
  return out;
}

/** Komu przedmiot jednorazowy jest przeznaczony: sobie (leczenie, buff) czy wrogowi (granat). */
export type ItemTargeting = 'self' | 'foe' | 'none';

export function itemTargeting(inst: ItemInstance): ItemTargeting {
  const def = itemDef(inst.id);
  if (!def || def.type !== 'consumable') return 'none';
  const t = def.consumable.target;
  if (t === 'enemy' || t === 'area') return 'foe';
  return 'self';
}

/** Zasięg rzutu przedmiotu w polach (0 = na siebie). */
export function itemRange(inst: ItemInstance): number {
  const def = itemDef(inst.id);
  return def?.type === 'consumable' ? (def.consumable.range ?? 0) : 0;
}
