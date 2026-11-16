// AI postaci w walce: wybór broni, celu, ruchu (osłona, flankowanie, ucieczka tchórzy), użycie zdolności.
// Migracja z Oldgame/src/mission/combat.js (sekcja "AI"). Działa też jako auto-tura dla najemników.
import type { AbilityDef, EnemyAI } from '../data/types.ts';
import { usesLeft } from '../rules/abilities.ts';
import { abilityDef } from '../rules/lookup.ts';
import { getAttackBonus, getWeapons, hasCondition, normWeapon } from '../rules/stats.ts';
import type { GridPos, WeaponRef } from '../rules/types.ts';
import { Combat, isUniversalAbility, type ActionOutcome, type Actor, type StrikeInfo } from './combat.ts';
import { cheb, strideActions, UNREACHABLE } from './grid.ts';

export type AiKind = EnemyAI | 'pc';
export const aiKind = (a: Actor): AiKind => (a.side === 'enemy' ? (a.ch.ai ?? 'melee') : 'pc');

/** Co AI zrobiło w danym kroku (do animacji / testów). */
export type AiAction =
  | { type: 'strike'; target: Actor; outcome: ActionOutcome }
  | { type: 'move'; outcome: ActionOutcome }
  | { type: 'ability'; ability: AbilityDef; targets: Actor[]; outcome: ActionOutcome }
  | { type: 'cover'; outcome: ActionOutcome };

const weaponRange = (w: WeaponRef): number => normWeapon(w).range;
const isFleeing = (a: Actor): boolean => aiKind(a) === 'coward' && a.ch.hp < a.ch.maxHp * 0.4;

/** Najlepsza broń: taka, która sięga kogoś teraz; inaczej wg roli (strzelcy - zasięg, reszta - wręcz). */
export function pickWeapon(c: Combat, a: Actor, foes: Actor[]): WeaponRef {
  const ws = getWeapons(a.ch);
  if (ws.length <= 1) return ws[0];
  const ranged = aiKind(a) === 'ranged';
  let best = ws[0];
  let bs = -1e9;
  for (const w of ws) {
    let s = getAttackBonus(a.ch, w, Math.min(2, a.mapN));
    if (foes.some((f) => c.strikeInfo(a, f, w).ok)) s += 50;
    else s += ranged ? weaponRange(w) : -weaponRange(w);
    if (s > bs) {
      bs = s;
      best = w;
    }
  }
  return best;
}

/** Cel ataku: ranni, łatwi do trafienia, blisko, flankowani. Bestie po prostu gryzą najbliższego. */
export function bestTarget(c: Combat, a: Actor, w: WeaponRef, foes: Actor[]): { f: Actor; i: StrikeInfo } | null {
  let best: { f: Actor; i: StrikeInfo } | null = null;
  let bs = -1e9;
  for (const f of foes) {
    const i = c.strikeInfo(a, f, w);
    if (!i.ok) continue;
    const hpf = f.ch.hp / f.ch.maxHp;
    let s = (1 - hpf) * 30 + i.hit * 25 - cheb(a, f) * 1.5 + (i.flank ? 6 : 0);
    if (aiKind(a) === 'beast') s = -cheb(a, f) * 3 + i.hit * 10;
    if (f.state !== 'up') s -= 100;
    if (s > bs) {
      bs = s;
      best = { f, i };
    }
  }
  return best;
}

/** Ruch: pozycja, z której da się trafić (strzelcy wolą dystans i osłonę, wręcz - flankowanie); tchórz ucieka. */
export function aiMove(c: Combat, a: Actor, w: WeaponRef, foes: Actor[]): ActionOutcome | null {
  const t = c.turn;
  if (!t || t.actor !== a || t.actions <= 0) return null;
  const maxA = t.actions;
  const { res, sp } = c.reachFor(a, maxA);
  const ranged = weaponRange(w) > 0;
  const grid = c.grid;
  // mapa odległości (po ścieżce) do najbliższego przeciwnika
  const dm = new Float32Array(res.cost.length).fill(UNREACHABLE);
  for (const f of foes) {
    const r = grid.search(f, 160, () => true);
    for (let i = 0; i < dm.length; i++) if (r.cost[i] < dm[i]) dm[i] = r.cost[i];
  }
  const flee = isFleeing(a);
  let best: { pos: GridPos; here: boolean } | null = null;
  let bs = -1e9;
  for (let i = 0; i < res.cost.length; i++) {
    const cost = res.cost[i];
    if (cost >= UNREACHABLE) continue;
    const pos = grid.posOf(i);
    const here = pos.gx === a.gx && pos.gy === a.gy;
    if (!here && c.occupied(pos.gx, pos.gy)) continue;
    const n = here ? 0 : strideActions(cost, sp);
    const rem = maxA - n;
    const nd = Math.min(...foes.map((f) => cheb(f, pos)));
    let s = 0;
    if (flee) s = nd * 6 - cost * 0.2;
    else {
      const canHit = rem >= 1 && foes.some((f) => c.strikeInfo(a, f, w, pos).ok);
      if (canHit) s += 100 + (rem >= 2 ? 15 : 0);
      s -= dm[i] * 2 + (here ? 0 : cost * 0.1);
      if (ranged) {
        if (nd < 3) s -= 12;
        if (grid.hasLowCoverNear(pos)) s += 7;
      } else if (canHit && foes.some((f) => c.strikeInfo(a, f, w, pos).flank)) s += 8;
    }
    if (s > bs) {
      bs = s;
      best = { pos, here };
    }
  }
  if (!best || best.here) return null;
  const out = c.stride(a, best.pos);
  return out.ok ? out : null;
}

/** Próba użycia zdolności (wrogowie używają ich z szansą 65%, by nie powtarzać schematu). */
export function aiAbility(c: Combat, a: Actor, foes: Actor[]): AiAction | null {
  const t = c.turn;
  if (!t) return null;
  for (const id of a.ch.abilities) {
    const ab = abilityDef(id);
    if (!ab || ab.actions === 'reaction' || isUniversalAbility(id)) continue;
    const cost = c.abilityCost(ab);
    if (cost > t.actions || usesLeft(a.ch, id) <= 0 || (cost === 0 && a.used['_free_' + id])) continue;
    if (a.side === 'enemy' && c.rng() > 0.65) continue;
    const act = (targets: Actor[], cell?: GridPos): AiAction | null => {
      const outcome = c.useAbility(a, id, targets, cell);
      return outcome.ok ? { type: 'ability', ability: ab, targets, outcome } : null;
    };
    if (ab.target === 'enemy') {
      const tg = c.abilityTargets(a, ab);
      if (!tg.length || (ab.fx === 'melee' && a.mapN >= 2)) continue;
      const weakest = tg.slice().sort((p, q) => p.ch.hp - q.ch.hp)[0];
      const r = act([weakest]);
      if (r) return r;
      continue;
    }
    if (ab.target === 'ally' || ab.target === 'self') {
      const cands = ab.target === 'self' ? [a] : c.abilityTargets(a, ab);
      if (ab.fx === 'heal') {
        const w = cands
          .filter((x) => x.state !== 'dead' && (x.ch.hp < x.ch.maxHp * 0.55 || x.state === 'down'))
          .sort((p, q) => p.ch.hp / p.ch.maxHp - q.ch.hp / q.ch.maxHp)[0];
        if (w) {
          const r = act([w]);
          if (r) return r;
        }
      } else if (!a.used['b_' + id] && foes.length) {
        a.used['b_' + id] = true;
        const r = act([cands.slice().sort((p, q) => q.ch.level - p.ch.level)[0] ?? a]);
        if (r) return r;
      }
      continue;
    }
    if (ab.target === 'area') {
      if (!(ab.range > 0)) {
        // obszar wokół siebie: wspierający - gdy obok są sojusznicy; ofensywny - gdy obok są wrogowie
        const tg = c.areaTargetsFor(a, ab).filter((x) => x !== a);
        if (tg.length && !a.used['b_' + id]) {
          a.used['b_' + id] = true;
          const r = act([]);
          if (r) return r;
        }
        continue;
      }
      let best: GridPos | null = null;
      let bs = 0;
      const rad = ab.radius || 1;
      for (const f of foes) {
        if (cheb(a, f) > ab.range || !c.grid.los(a, f).clear) continue;
        const hit = c.areaTargets(f, rad);
        const s = hit.filter((x) => x.side !== a.side).length * 2 - hit.filter((x) => x.side === a.side).length * 4;
        if (s > bs) {
          bs = s;
          best = { gx: f.gx, gy: f.gy };
        }
      }
      if (best) {
        const r = act([], best);
        if (r) return r;
      }
      continue;
    }
    if (ab.target === 'none' && foes.length && !a.used['b_' + id]) {
      a.used['b_' + id] = true;
      const r = act(foes);
      if (r) return r;
    }
  }
  return null;
}

/** Najemnik pod kontrolą AI: najpierw ratuje umierających i wstaje z ziemi. */
function pcSupport(c: Combat, a: Actor, foes: Actor[]): AiAction | null {
  const t = c.turn!;
  const dying = c.pcs.filter((p) => p.state === 'down' && p.ch.conditions.dying);
  const adjacent = dying.find((p) => cheb(a, p) <= 1);
  const firstAid = abilityDef('first_aid');
  if (adjacent && firstAid && t.actions >= 2) {
    const outcome = c.useAbility(a, 'first_aid', [adjacent]);
    if (outcome.ok) return { type: 'ability', ability: firstAid, targets: [adjacent], outcome };
  }
  const stand = abilityDef('stand');
  if (stand && hasCondition(a.ch, 'prone')) {
    const outcome = c.useAbility(a, 'stand', [a]);
    if (outcome.ok) return { type: 'ability', ability: stand, targets: [a], outcome };
  }
  const hurt = dying[0];
  if (hurt && t.actions >= 3 && !foes.some((f) => cheb(f, a) <= 1)) {
    const ap = c.approachCell(a, hurt, t.actions - 1);
    if (ap && !(ap.cell.gx === a.gx && ap.cell.gy === a.gy)) {
      const outcome = c.stride(a, ap.cell);
      if (outcome.ok) return { type: 'move', outcome };
    }
  }
  return null;
}

/** Jeden krok AI (jedna decyzja). null = postać nie ma już nic sensownego do zrobienia. */
export function aiStep(c: Combat, a: Actor): AiAction | null {
  const t = c.turn;
  if (!t || t.actor !== a || t.actions <= 0 || !c.active || a.state !== 'up') return null;
  const foes = c.foesOf(a);
  if (!foes.length) return null;
  if (a.side === 'pc') {
    const s = pcSupport(c, a, foes);
    if (s) return s;
  }
  const ab = aiAbility(c, a, foes);
  if (ab) return ab;
  const w = pickWeapon(c, a, foes);
  const flee = isFleeing(a);
  if (flee) {
    const m = aiMove(c, a, w, foes);
    if (m) return { type: 'move', outcome: m };
  }
  const tg = bestTarget(c, a, w, foes);
  if (tg && !flee && (a.mapN < 2 || tg.i.hit >= 0.3)) {
    const outcome = c.strike(a, tg.f, w);
    if (outcome.ok) return { type: 'strike', target: tg.f, outcome };
  }
  const m = aiMove(c, a, w, foes);
  if (m) return { type: 'move', outcome: m };
  if (!a.ch.conditions.in_cover && (c.grid.hasLowCoverNear(a) || weaponRange(w) > 0) && t.actions >= 1) {
    const outcome = c.takeCover(a);
    if (outcome.ok) return { type: 'cover', outcome };
  }
  return null;
}

/** Cała tura AI (maks. 10 decyzji). Po niej wywołaj combat.nextTurn(). */
export function runAiTurn(c: Combat, a: Actor): AiAction[] {
  const done: AiAction[] = [];
  for (let guard = 0; guard < 10; guard++) {
    const step = aiStep(c, a);
    if (!step) break;
    done.push(step);
  }
  if (c.turn && c.turn.actor === a) c.turn.actions = 0;
  return done;
}
