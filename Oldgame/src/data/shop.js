// Nomad trader stock & prices.
import { ITEMS } from '../rules/index.js';
import { rngSeed } from '../scenes/meta/common.js';

export function nomadDiscount(state) { return Math.min(0.25, Math.max(-0.2, (state.rep?.nomads || 0) * 0.02)); }
export function buyPrice(id, state) { const p = ITEMS?.[id]?.price ?? 10; return Math.max(1, Math.round(p * (1 - nomadDiscount(state)))); }
export function sellPrice(id, state) {
  const it = ITEMS?.[id]; const p = it?.price ?? 0;
  const base = it?.type === 'junk' ? 0.6 : 0.4;
  return Math.max(0, Math.floor(p * (base + Math.min(0.1, Math.max(0, (state.rep?.nomads || 0) * 0.01)))));
}
/** Daily stock (deterministic per day): ids of items. */
export function shopStock(state, partyLvl = 1) {
  const all = Object.values(ITEMS || {}).filter(i => (i.price ?? 0) > 0 && i.type !== 'junk' && (i.level ?? 0) <= partyLvl + 1);
  const rng = rngSeed((state.day || 1) * 7919 + 13);
  const cons = all.filter(i => i.type === 'consumable' || i.type === 'ammo'), gear = all.filter(i => !(i.type === 'consumable' || i.type === 'ammo'));
  const shuffle = (a) => a.map(v => [rng(), v]).sort((x, y) => x[0] - y[0]).map(x => x[1]);
  return [...shuffle(cons).slice(0, 8), ...shuffle(gear).slice(0, 12)].filter((v, i, a) => a.findIndex(x => x.id === v.id) === i).map(i => i.id);
}
