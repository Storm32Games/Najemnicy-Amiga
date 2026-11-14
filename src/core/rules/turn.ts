// Początek / koniec tury postaci, inicjatywa, testy umiejętności. Migracja z Oldgame/src/rules/core.js.
import { ACTIONS_PER_TURN, CONDITIONS, PERSISTENT, PERSISTENT_END_DC } from '../data/rules.ts';
import type { ConditionDef, ConditionId } from '../data/types.ts';
import { check, d, flatCheck, roll, type CheckResult, type Rng } from './dice.ts';
import { applyDamage, isDead, recoveryCheck } from './damage.ts';
import { conditionDef } from './lookup.ts';
import { condValue, getStat, hasCondition, type StatKey } from './stats.ts';
import type { Character, CombatEvent } from './types.ts';

export interface TurnStartResult {
  log: string[];
  /** Akcje do wydania w tej turze (3, +1 przyspieszony, -X ogłuszony/spowolniony; 0 = brak tury). */
  actions: number;
  events: CombatEvent[];
}

const condName = (id: ConditionId): string => (CONDITIONS[id] as ConditionDef).name.toLowerCase();

/** Test ratunkowy (umierający), obrażenia ciągłe, zdjęcie krótkich stanów, liczba akcji. */
export function startTurn(ch: Character, rng: Rng = Math.random): TurnStartResult {
  const out: TurnStartResult = { log: [], actions: 0, events: [] };
  if (isDead(ch)) return out;
  if (ch.conditions.dying) {
    const r = recoveryCheck(ch, rng);
    out.log.push(
      r.dead
        ? `${ch.name} umiera.`
        : r.stable
          ? `${ch.name} stabilizuje się (nieprzytomny). (k20 ${r.d20} vs WT ${r.dc})`
          : `${ch.name} walczy o życie: umieranie ${condValue(ch, 'dying')} (k20 ${r.d20} vs WT ${r.dc})`,
    );
    out.events.push({ type: 'recovery', target: ch, degree: r.degree });
    return out;
  }
  for (const pid of PERSISTENT) {
    const dice = ch.conditions[pid];
    if (!dice || isDead(ch)) continue;
    const r = roll(String(dice), rng);
    const dt = CONDITIONS[pid].dmgType;
    const res = applyDamage(ch, r.total, dt);
    out.log.push(`${ch.name} cierpi: ${condName(pid)} (${res.dealt} obrażeń).`);
    out.events.push({ type: 'damage', target: ch, amount: res.dealt, dmgType: dt, persistent: pid });
    if (res.dead || res.downed) {
      out.log.push(res.dead ? `${ch.name} ginie.` : `${ch.name} traci przytomność!`);
      out.events.push({ type: res.dead ? 'death' : 'down', target: ch });
    }
    if (!isDead(ch) && flatCheck(PERSISTENT_END_DC, rng).degree >= 2) {
      delete ch.conditions[pid];
      out.log.push(`${ch.name}: ${condName(pid)} ustaje.`);
    }
  }
  if (isDead(ch)) return out;
  delete ch.conditions.raised_shield;
  delete ch.conditions.dodging;
  if (ch.hp <= 0 || ch.conditions.unconscious) return out;
  let actions = ACTIONS_PER_TURN;
  if (hasCondition(ch, 'quickened')) actions += 1;
  for (const id of ['stunned', 'slowed'] as const) {
    if (!ch.conditions[id]) continue;
    const n = condValue(ch, id);
    actions -= n;
    out.log.push(`${ch.name} jest ${condName(id)} (-${n} akcji).`);
    delete ch.conditions[id];
  }
  out.actions = Math.max(0, actions);
  return out;
}

/** Koniec tury: stany "decay" i "timed" maleją o 1. */
export function endTurn(ch: Character): { log: string[]; events: CombatEvent[] } {
  const out = { log: [] as string[], events: [] as CombatEvent[] };
  if (isDead(ch)) return out;
  for (const id of Object.keys(ch.conditions) as ConditionId[]) {
    const meta = conditionDef(id);
    if (!meta || (meta.kind !== 'decay' && meta.kind !== 'timed')) continue;
    const next = condValue(ch, id) - 1;
    if (next > 0) {
      ch.conditions[id] = next;
      continue;
    }
    delete ch.conditions[id];
    if (!meta.hidden) out.log.push(`${ch.name}: ${meta.name.toLowerCase()} mija.`);
  }
  return out;
}

export interface InitiativeRoll {
  d20: number;
  mod: number;
  total: number;
}
/** Inicjatywa = Percepcja + k20. */
export function rollInitiative(ch: Character, rng: Rng = Math.random): InitiativeRoll {
  const mod = getStat(ch, 'perception');
  const d20 = d(20, rng);
  return { d20, mod, total: d20 + mod };
}

export const skillCheck = (ch: Character, skill: StatKey, dc: number, rng: Rng = Math.random): CheckResult => check(getStat(ch, skill), dc, rng);
