// Przedmioty jednorazowe (stymulanty, granaty, bandaże). Migracja z Oldgame/src/rules/abilities.js -> useConsumable.
import type { Rng } from './dice.ts';
import { roll } from './dice.ts';
import { heal, isDead } from './damage.ts';
import { itemDef } from './lookup.ts';
import { addCondition, removeCondition } from './stats.ts';
import { basicSave, cond, isMachine } from './abilities.ts';
import type { ActionResult, Character, ItemInstance } from './types.ts';

/** Szuka przedmiotu w plecaku po instancji, uid albo id. */
export function findItem(ch: Character, ref: ItemInstance | string): ItemInstance | undefined {
  const uid = typeof ref === 'string' ? ref : ref.uid;
  const id = typeof ref === 'string' ? ref : ref.id;
  return ch.inventory.find((i) => i === ref || i.uid === uid) ?? ch.inventory.find((i) => i.id === id);
}

/** Zużywa 1 sztukę i rozpatruje efekt. Cele obszarowe podaje warstwa taktyczna. */
export function useConsumable(user: Character, ref: ItemInstance | string, targets: Character[] = [], rng: Rng = Math.random): ActionResult {
  const r: ActionResult = { log: [], events: [], attack: false };
  const inst = findItem(user, ref);
  if (!inst) {
    r.log.push('Brak przedmiotu.');
    return r;
  }
  const def = itemDef(inst.id);
  if (!def || def.type !== 'consumable') {
    r.log.push('Tego nie da się użyć.');
    return r;
  }
  const c = def.consumable;
  const tg = targets.length ? targets : [user];
  r.log.push(`${user.name} używa: ${def.name}.`);
  switch (c.effect) {
    case 'heal': {
      const t = tg[0];
      if (isDead(t)) {
        r.log.push(`${t.name} nie żyje.`);
        return r;
      }
      const rr = roll(c.amount ?? '1d4', rng);
      r.heal = { dice: rr.dice, flat: rr.mod, mult: 1, post: [], total: rr.total };
      const n = heal(t, rr.total);
      r.events.push({ type: 'heal', target: t, amount: n });
      r.log.push(`${def.name}: ${t.name} odzyskuje ${n} PW.`);
      for (const k of c.cures ?? []) removeCondition(t, k);
      break;
    }
    case 'cleanse':
      for (const k of c.cures ?? []) removeCondition(tg[0], k);
      r.log.push('Skutki zatrucia ustępują.');
      break;
    case 'damage':
      for (const t of tg) {
        if (c.only === 'machine' && !isMachine(t)) continue;
        const { c: sc } = basicSave(r, t, c.save ?? 'reflex', c.dc ?? 15, c.amount ?? '1d6', c.dmgType ?? 'P', rng);
        if (c.condition && sc.degree <= 1 && t.hp > 0) {
          cond(r, t, c.condition.id, c.condition.value);
        }
      }
      break;
    case 'buff':
      for (const b of c.buffs ?? []) {
        addCondition(tg[0], b.id, b.value);
        r.events.push({ type: 'condition', target: tg[0], condition: b.id });
      }
      r.log.push('Środek zaczyna działać.');
      break;
    case 'smoke':
      for (const t of tg) addCondition(t, 'dodging', 1);
      r.log.push('Gęsty dym utrudnia celowanie (+2 KP do końca tury).');
      break;
  }
  inst.qty -= 1;
  if (inst.qty <= 0) user.inventory.splice(user.inventory.indexOf(inst), 1);
  r.consumed = true;
  return r;
}
