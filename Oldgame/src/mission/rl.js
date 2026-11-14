// Defensive shim over RULES / GFX / AUDIO: namespace imports never throw on missing exports.
import * as R from '../rules/index.js';
import * as GR from '../gfx/index.js';
import { fb } from './fb.js';
import { Audio } from '../audio/audio.js';
export { R, Audio };
// GFX with per-function fallback (resolved at call time, so a real implementation is used as soon as it exists)
export const G = new Proxy({}, { get: (_, k) => (typeof GR[k] === 'function' ? GR[k] : fb[k] ?? GR[k]) });

const has = (n) => typeof R[n] === 'function';
export const rnd = Math.random;
export const dd = (n, rng = rnd) => 1 + Math.floor(rng() * n);
export function roll(expr, rng = rnd) {
  if (has('roll')) { try { return R.roll(expr, rng); } catch (e) {} }
  const m = /^(\d+)d(\d+)([+-]\d+)?$/.exec(String(expr).replace(/\s/g, '')) || [0, 1, 4, 0];
  const rolls = []; for (let i = 0; i < +m[1]; i++) rolls.push(dd(+m[2], rng));
  const mod = +(m[3] || 0); return { total: rolls.reduce((a, b) => a + b, 0) + mod, rolls, expr, mod };
}
export function degreeOf(d20, mod, dc) {
  const t = d20 + mod; let g = t >= dc + 10 ? 3 : t >= dc ? 2 : t <= dc - 10 ? 0 : 1;
  if (d20 === 20) g = Math.min(3, g + 1); else if (d20 === 1) g = Math.max(0, g - 1);
  return g;
}
export function check(mod, dc, rng = rnd) {
  if (has('check')) { try { return R.check(mod, dc, rng); } catch (e) {} }
  const d20 = dd(20, rng); return { d20, mod, total: d20 + mod, dc, degree: degreeOf(d20, mod, dc), nat20: d20 === 20, nat1: d20 === 1 };
}
export const DEGREE_NAMES = R.DEGREE_NAMES || ['Krytyczna porażka', 'Porażka', 'Sukces', 'Krytyczny sukces'];
export const ABILITIES = R.ABILITIES || {};
export const ITEMS = R.ITEMS || {};
export const ENEMIES = R.ENEMIES || {};
export const CONDITIONS = R.CONDITIONS || {};
export const SKILLS = R.SKILLS || {};
export function getStat(ch, key, opts) { if (has('getStat')) { try { const v = R.getStat(ch, key, opts); if (Number.isFinite(v)) return v; } catch (e) {} } return key === 'speed' ? (ch.speed || 5) : key === 'ac' ? 12 : key === 'perception' ? 3 : 2; }
export function getWeapon(ch) {
  if (has('getWeapon')) { try { const w = R.getWeapon(ch); if (w) return w; } catch (e) {} }
  const t = ENEMIES[ch.templateId]; if (t?.attacks?.[0]) return t.attacks[0];
  const it = ch.equipment?.weapon && ITEMS[ch.equipment.weapon.id]; return it?.weapon || { name: 'Pięść', damage: '1d4', range: 0, bonus: 3 };
}
export function getWeapons(ch) { if (has('getWeapons')) { try { const l = R.getWeapons(ch); if (l?.length) return l; } catch (e) {} } return [getWeapon(ch)]; }
export function atkBonus(ch, w, map, opts) {
  if (has('getAttackBonus')) { try { const v = R.getAttackBonus(ch, w, map, opts); if (Number.isFinite(v)) return v; } catch (e) {} }
  const agile = w.traits?.includes?.('agile'); const pen = map === 0 ? 0 : agile ? 4 * map : 5 * map;
  return (w.bonus ?? ((ch.level || 1) + 4)) - pen;
}
export function applyDamage(ch, amt, type) {
  if (has('applyDamage')) return R.applyDamage(ch, amt, type);
  ch.hp = Math.max(0, ch.hp - amt); return { dealt: amt, downed: ch.hp <= 0, dead: ch.hp <= 0 && ch.isEnemy };
}
export function heal(ch, amt) { if (has('heal')) return R.heal(ch, amt); const n = Math.min(ch.maxHp - ch.hp, amt); ch.hp += n; return n; }
export function addCondition(ch, id, v = 1) { if (has('addCondition')) return R.addCondition(ch, id, v); ch.conditions = ch.conditions || {}; ch.conditions[id] = v; }
export function removeCondition(ch, id) { if (has('removeCondition')) return R.removeCondition(ch, id); if (ch.conditions) delete ch.conditions[id]; }
export const hasCondition = (ch, id) => has('hasCondition') ? !!R.hasCondition(ch, id) : !!ch.conditions?.[id];
export function isAlive(ch) { return has('isAlive') ? !!R.isAlive(ch) : ch.hp > 0; }
export function isDown(ch) { if (has('isDown')) return !!R.isDown(ch); return ch.hp <= 0 || !!ch.conditions?.dying; }
export function canAct(ch) { if (has('canAct')) return !!R.canAct(ch); return ch.hp > 0; }
export function startTurn(ch, rng = rnd) { if (has('startTurn')) { try { return R.startTurn(ch, rng) || { log: [], actions: 3, events: [] }; } catch (e) { console.warn(e); } } return { log: [], actions: 3, events: [] }; }
export function endTurn(ch, rng = rnd) { if (has('endTurn')) { try { return R.endTurn(ch, rng) || { log: [], events: [] }; } catch (e) { console.warn(e); } } return { log: [], events: [] }; }
export function rollInitiative(ch, rng = rnd) { if (has('rollInitiative')) { try { const r = R.rollInitiative(ch, rng); if (r && Number.isFinite(r.total)) return r; } catch (e) {} } const d20 = dd(20, rng); const mod = getStat(ch, 'perception'); return { d20, mod, total: d20 + mod }; }
export function skillCheck(ch, skill, dc, rng = rnd) { if (has('skillCheck')) { try { return R.skillCheck(ch, skill, dc, rng); } catch (e) {} } return check(getStat(ch, skill), dc, rng); }
export function dcForLevel(l) { return has('dcForLevel') ? R.dcForLevel(l) : 14 + Math.round(l * 1.2); }
export function newItem(id, q = 1) { return has('newItem') ? R.newItem(id, q) : { uid: 'i' + Math.random().toString(36).slice(2, 8), id, qty: q }; }
export function createEnemy(id, o) {
  if (has('createEnemy')) { try { const e = R.createEnemy(id, o); if (e) return e; } catch (e) { console.warn('createEnemy', id, e); } }
  const t = ENEMIES[id] || {}; return { id: 'e' + Math.random().toString(36).slice(2, 8), name: t.name || id, isEnemy: true, templateId: id, level: t.level || 1, maxHp: t.hp || 15, hp: t.hp || 15, attrs: {}, conditions: {}, abilities: t.abilities || [], inventory: [], equipment: {}, uses: {}, speed: t.speed || 5 };
}
export function encounterXP(lvl, enemies) {
  if (has('encounterXP')) { try { return R.encounterXP(lvl, enemies); } catch (e) {} }
  const T = { '-4': 10, '-3': 15, '-2': 20, '-1': 30, '0': 40, '1': 60, '2': 80, '3': 120, '4': 160 };
  return enemies.reduce((s, e) => s + (T[Math.max(-4, Math.min(4, (e.level || 1) - lvl))] || 40), 0);
}
// ---- strike (with fallback) ----
export function doStrikeRule(att, def, o) {
  if (has('strike')) { try { return R.strike(att, def, o); } catch (e) { console.warn('strike failed', e); } }
  const w = o.weapon || getWeapon(att);
  const bonus = atkBonus(att, w, o.mapIndex || 0) + (o.bonus || 0); const ac = getStat(def, 'ac');
  const c = check(bonus, ac, o.rng);
  const ev = [], log = [];
  if (c.degree >= 2) {
    let amt = roll(w.damage || '1d4', o.rng).total; if (c.degree === 3) amt *= 2;
    const r = applyDamage(def, amt, w.dmgType); ev.push({ type: 'damage', target: def, amount: r.dealt ?? amt, degree: c.degree });
    log.push(`${att.name} trafia ${def.name} (${w.name || 'atak'}) za ${amt}${c.degree === 3 ? ' — KRYT!' : ''}.`);
  } else { ev.push({ type: 'miss', target: def }); log.push(`${att.name} pudłuje ${def.name}.`); }
  return { log, events: ev, attack: true, d20: c };
}
export function normW(w) {
  if (has('normWeapon')) { try { return R.normWeapon(w); } catch (e) {} }
  const x = w?.weapon || w || {}; return { name: w?.name, dmg: x.damage, range: x.range || 0, sfx: x.sfx, traits: x.traits || [] };
}
export const weaponName = (w) => normW(w)?.name || 'broń';
export const weaponRange = (w) => { const r = normW(w)?.range; return r > 0 ? r : 0; };
export function useConsumable(user, ref, targets, rng = rnd) { return R.useConsumable(user, ref, targets, rng); }
export function partyLevel(party) { const l = party.map(c => c.level || 1); return l.length ? Math.round(l.reduce((a, b) => a + b, 0) / l.length) : 1; }
export const condName = (id) => { const c = CONDITIONS[id]; return (typeof c === 'string' ? c : c?.name) || id; };
