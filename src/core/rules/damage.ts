// Obrażenia, leczenie, umieranie (PF2e: dying / wounded). Migracja z Oldgame/src/rules/core.js.
import { DYING_MAX } from '../data/rules.ts';
import type { DamageType } from '../data/types.ts';
import { flatCheck, type CheckResult, type Rng } from './dice.ts';
import { ancestryOf } from './lookup.ts';
import { condValue } from './stats.ts';
import type { Character } from './types.ts';

export const isDead = (ch: Character): boolean => !!ch.conditions.dead;
/** Wróg żyje, dopóki ma PW; postać gracza - dopóki nie umarła (może leżeć nieprzytomna). */
export const isAlive = (ch: Character): boolean => !isDead(ch) && (ch.isEnemy ? ch.hp > 0 : true);
export const isDown = (ch: Character): boolean => !isDead(ch) && ch.hp <= 0;
export const canAct = (ch: Character): boolean => !isDead(ch) && ch.hp > 0 && !ch.conditions.unconscious;

export interface DamageOutcome {
  dealt: number;
  downed: boolean;
  dead: boolean;
}

function kill(ch: Character): void {
  ch.conditions.dead = 1;
  delete ch.conditions.dying;
}

/**
 * Zadaje obrażenia: odporności / słabości / niewrażliwość, potem tymczasowe PW.
 * 0 PW: wróg ginie; postać gracza pada (umierający 1 + ranny, +1 przy krytyku).
 */
export function applyDamage(ch: Character, amount: number, type: DamageType = 'P', opts: { crit?: boolean } = {}): DamageOutcome {
  if (isDead(ch)) return { dealt: 0, downed: false, dead: true };
  let a = Math.max(0, Math.round(amount));
  // Wrogowie mają własne resist/weak, postacie gracza - z rasy.
  // Stary kod odejmował odporność wrogów dwa razy; tu liczona jest raz, a wartości w data/enemies.ts są podwojone,
  // więc efektywna odporność (i balans walk z Oldgame) pozostaje taka sama.
  const mods = ch.isEnemy ? ch : ancestryOf(ch.ancestry);
  const res = mods.resist?.[type];
  if (res) a = Math.max(0, a - res);
  const weak = mods.weak?.[type];
  if (weak) a += weak;
  if (ch.immune && ch.immune.includes(type)) a = 0;

  const wasUp = ch.hp > 0;
  const fromTemp = Math.min(ch.tempHp || 0, a);
  ch.tempHp = (ch.tempHp || 0) - fromTemp;
  a -= fromTemp;
  ch.hp = Math.max(0, ch.hp - a);

  let downed = false;
  let dead = false;
  if (ch.hp <= 0) {
    if (ch.isEnemy) {
      ch.conditions.dead = 1;
      downed = wasUp;
      dead = true;
    } else if (wasUp) {
      downed = true;
      const wd = condValue(ch, 'wounded');
      ch.conditions.dying = Math.min(DYING_MAX, 1 + wd + (opts.crit ? 1 : 0));
      ch.conditions.unconscious = 1;
      ch.conditions.prone = 1;
      delete ch.conditions.raised_shield;
      delete ch.conditions.in_cover;
      if (condValue(ch, 'dying') >= DYING_MAX) {
        kill(ch);
        dead = true;
      }
    } else if (a > 0 && ch.conditions.dying) {
      ch.conditions.dying = Math.min(DYING_MAX, condValue(ch, 'dying') + (opts.crit ? 2 : 1));
      if (condValue(ch, 'dying') >= DYING_MAX) {
        kill(ch);
        dead = true;
      }
    }
  }
  return { dealt: a + fromTemp, downed, dead };
}

/** Leczy; podniesienie umierającego zdejmuje dying/unconscious i zwiększa wounded. Zwraca wyleczone PW. */
export function heal(ch: Character, amount: number): number {
  if (isDead(ch)) return 0;
  const n = Math.max(0, Math.round(amount));
  const before = ch.hp;
  if (ch.hp <= 0 && n > 0) {
    if (ch.conditions.dying) ch.conditions.wounded = Math.min(3, condValue(ch, 'wounded') + 1);
    delete ch.conditions.dying;
    delete ch.conditions.unconscious;
  }
  ch.hp = Math.min(ch.maxHp, ch.hp + n);
  return ch.hp - before;
}

/** Ustawia tymczasowe PW (nie kumulują się - bierze się wyższą wartość). */
export function grantTempHp(ch: Character, n: number): void {
  if ((ch.tempHp || 0) < n) ch.tempHp = n;
}

export interface RecoveryResult extends CheckResult {
  before: number;
  dead?: boolean;
  stable?: boolean;
}

/** Test ratunkowy umierającego: płaski ST 10 + dying. */
export function recoveryCheck(ch: Character, rng: Rng = Math.random): RecoveryResult {
  const dying = condValue(ch, 'dying');
  const r: RecoveryResult = { ...flatCheck(10 + dying, rng), before: dying };
  let nd = dying;
  if (r.degree === 3) nd -= 2;
  else if (r.degree === 2) nd -= 1;
  else if (r.degree === 0) nd += 2;
  else nd += 1;
  if (nd >= DYING_MAX) {
    kill(ch);
    r.dead = true;
  } else if (nd <= 0) {
    delete ch.conditions.dying;
    ch.conditions.wounded = Math.min(3, condValue(ch, 'wounded') + 1);
    r.stable = true;
  } else ch.conditions.dying = nd;
  return r;
}
