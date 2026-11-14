// Postacie, statystyki, walka. Postacie to czysty JSON (bez funkcji).
import { d, roll, parseDice, check, flatCheck, dcForLevel, profBonus, fmtMod } from './dice.js';
import { ATTRS, SKILLS, CONDITIONS, PERSISTENT, ANCESTRIES, ANCESTRY_ALIASES, CLASSES, UNIVERSAL_ABILITIES, XP_PER_LEVEL, MAX_LEVEL } from './content.js';
import { ITEMS, UNARMED } from './items.js';
import { ENEMIES } from './enemies.js';
import { ABILITIES } from './abilities.js';

let uidN = 0;
const uid = (p) => p + Math.random().toString(36).slice(2, 8) + (++uidN).toString(36);
export const newItem = (id, qty = 1) => ({ uid: uid('i'), id, qty });
export const ancestryOf = (id) => ANCESTRIES[ANCESTRY_ALIASES[id] || id] || ANCESTRIES.human;
const hash = (s) => { let h = 7; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; };
const clone = (o) => JSON.parse(JSON.stringify(o));
const pick = (arr, h) => arr[h % arr.length];

export const DMG_ADJ = { P: 'kłutych', S: 'ciętych', B: 'obuchowych', fire: 'ogniowych', acid: 'żrących', elec: 'elektrycznych', poison: 'trujących', bleed: 'od krwawienia', rad: 'radiacyjnych' };
export const acc = (ch) => ch.nameAcc || ch.name;

// ---------- warunki
export const isOffGuard = (ch) => !!(ch.conditions.off_guard || ch.conditions.distracted || ch.conditions.prone);
export const hasCondition = (ch, id) => !!ch.conditions[id];
export const condValue = (ch, id) => { const v = ch.conditions[id]; return typeof v === 'number' ? v : v ? 1 : 0; };
export function addCondition(ch, id, value = 1) {
  const meta = CONDITIONS[id];
  if (ch.conditions.dead && id !== 'dead') return;
  if (ch.immune && (ch.immune.includes(id) || (id === 'poisoned' && ch.immune.includes('poison')))) return;
  const cur = ch.conditions[id];
  if (PERSISTENT.includes(id)) { ch.conditions[id] = value; return; }
  if (meta && (meta.valued || meta.kind === 'timed' || meta.kind === 'decay' || meta.kind === 'consume')) ch.conditions[id] = Math.max(typeof cur === 'number' ? cur : 0, value);
  else ch.conditions[id] = value === undefined ? 1 : value;
}
export function removeCondition(ch, id) { delete ch.conditions[id]; }

const statusPenalty = (ch) => Math.max(condValue(ch, 'frightened'), condValue(ch, 'sickened'));
export function attrMod(ch, a) {
  let v = ch.attrs[a] || 0;
  if (a === 'dex') v -= condValue(ch, 'clumsy');
  if (a === 'str') v -= condValue(ch, 'enfeebled');
  return v;
}

// ---------- statystyki
const armorOf = (ch) => (ch.equipment && ch.equipment.armor ? ITEMS[ch.equipment.armor.id]?.armor || null : null);
const shieldOf = (ch) => (ch.equipment && ch.equipment.shield ? ITEMS[ch.equipment.shield.id]?.shield || null : null);
const SAVE_ATTR = { fortitude: 'con', reflex: 'dex', will: 'wis' };

export function getStat(ch, key, opts = {}) {
  const lvl = ch.level, pen = statusPenalty(ch);
  let v;
  if (key === 'speed') {
    const ar = armorOf(ch);
    v = ch.speed - (ar ? ar.speedPenalty || 0 : 0);
    if (ch.speed === 0) return 0;
    return Math.max(1, v);
  }
  if (ch.base) { // wróg
    const b = ch.base;
    if (key === 'ac') v = b.ac;
    else if (key === 'fortitude') v = b.fortitude;
    else if (key === 'reflex') v = b.reflex - condValue(ch, 'clumsy');
    else if (key === 'will') v = b.will;
    else if (key === 'perception') v = b.perception;
    else if (key === 'classDC') v = b.classDC;
    else v = (b.skills && b.skills[key]) ?? (b.perception - 1);
  } else {
    const prof = ch.prof;
    const cls = CLASSES[ch.classId];
    if (key === 'ac') {
      const ar = armorOf(ch);
      const cat = ar ? ar.category : 'unarmored';
      let dx = attrMod(ch, 'dex'); if (ar) dx = Math.min(dx, ar.dexCap);
      v = 10 + dx + profBonus(prof.defense[cat] || 0, lvl) + (ar ? ar.ac : 0) + (ancestryOf(ch.ancestry).acBonus || 0);
    } else if (SAVE_ATTR[key]) v = attrMod(ch, SAVE_ATTR[key]) + profBonus(prof[key] || 0, lvl);
    else if (key === 'perception') v = attrMod(ch, 'wis') + profBonus(prof.perception || 0, lvl);
    else if (key === 'classDC') v = 10 + attrMod(ch, cls ? cls.keyAttr : 'str') + profBonus(prof.classDC || 0, lvl);
    else if (SKILLS[key]) {
      const sk = SKILLS[key];
      v = attrMod(ch, sk.attr) + profBonus((prof.skills && prof.skills[key]) || 0, lvl);
      if (sk.attr === 'str' || sk.attr === 'dex') { const ar = armorOf(ch); if (ar) v -= ar.checkPenalty || 0; }
    } else v = 0;
  }
  if (key === 'ac') {
    if (isOffGuard(ch)) v -= 2;
    let circ = 0;
    const cov = condValue(ch, 'in_cover');
    if (!opts.ignoreCover && cov) circ = Math.max(circ, cov >= 2 ? 4 : 2);
    if (hasCondition(ch, 'raised_shield')) circ = Math.max(circ, (shieldOf(ch) || { ac: 2 }).ac);
    if (hasCondition(ch, 'dodging')) circ = Math.max(circ, 2);
    v += circ;
    if (hasCondition(ch, 'reinforced')) v += 1;
    if (hasCondition(ch, 'raging')) v -= 1;
  }
  return v - pen;
}

// ---------- broń
export function normWeapon(w) {
  if (!w) w = UNARMED;
  if (w.def && w.dmg !== undefined) return w;
  if (typeof w === 'string') w = ITEMS[w] || UNARMED;
  if (w.uid !== undefined && w.id && ITEMS[w.id]) w = ITEMS[w.id];
  if (w.weapon) { const x = w.weapon; return { id: w.id, name: w.name, dmg: x.damage, type: x.dmgType, range: x.range || 0, category: x.category, traits: x.traits || [], sfx: x.sfx, potency: x.potency || 0, hands: x.hands || 1, def: w }; }
  return { id: null, name: w.name, dmg: w.damage, type: w.dmgType, range: w.range || 0, traits: w.traits || [], sfx: w.sfx || 'melee', flat: w.bonus, potency: 0, hands: 1, def: w };
}
const traitVal = (w, name) => { const t = w.traits.find((x) => x === name || x.startsWith(name + ':')); return t ? (t.includes(':') ? +t.split(':')[1] : true) : null; };
export function getWeapons(ch) {
  if (ch.attacks) return ch.attacks;
  const out = [];
  for (const slot of ['weapon', 'weapon2']) { const it = ch.equipment[slot]; if (it && ITEMS[it.id] && ITEMS[it.id].weapon) out.push(ITEMS[it.id]); }
  return out.length ? out : [UNARMED];
}
export const getWeapon = (ch) => getWeapons(ch)[0];

export function getAttackBonus(ch, weapon, mapIndex = 0, opts = {}) {
  const w = normWeapon(weapon || getWeapon(ch));
  const agile = !!traitVal(w, 'agile');
  const map = mapIndex <= 0 ? 0 : (agile ? (mapIndex === 1 ? -4 : -8) : (mapIndex === 1 ? -5 : -10));
  let b;
  if (ch.base || w.flat !== undefined) b = w.flat ?? 0;
  else {
    let m;
    if (w.range > 0) m = attrMod(ch, 'dex');
    else if (traitVal(w, 'finesse')) m = Math.max(attrMod(ch, 'str'), attrMod(ch, 'dex'));
    else m = attrMod(ch, 'str');
    b = m + profBonus((ch.prof.attacks && ch.prof.attacks[w.category]) || 0, ch.level) + w.potency;
  }
  if (hasCondition(ch, 'stimmed')) b += 1;
  if (hasCondition(ch, 'prone')) b -= 2;
  if (ch.base && w.range > 0) b -= condValue(ch, 'clumsy');
  b -= statusPenalty(ch);
  b -= 2 * (opts.rangeIncrements || 0);
  return b + map;
}

// ---------- obrażenia i leczenie
export const isDead = (ch) => !!ch.conditions.dead;
export const isAlive = (ch) => !isDead(ch) && (ch.isEnemy ? ch.hp > 0 : true);
export const isDown = (ch) => !isDead(ch) && ch.hp <= 0;
export const canAct = (ch) => !isDead(ch) && ch.hp > 0 && !hasCondition(ch, 'unconscious');

export function applyDamage(ch, amount, type = 'P', opts = {}) {
  if (isDead(ch)) return { dealt: 0, downed: false, dead: true };
  let a = Math.max(0, Math.round(amount));
  const anc = ch.isEnemy ? ch : ancestryOf(ch.ancestry);
  if (anc.resist && anc.resist[type]) a = Math.max(0, a - anc.resist[type]);
  if (anc.weak && anc.weak[type]) a += anc.weak[type];
  if (ch.immune && ch.immune.includes(type)) a = 0;
  if (ch.isEnemy && ch.resist && ch.resist[type]) a = Math.max(0, a - ch.resist[type]);
  const wasUp = ch.hp > 0;
  const fromTemp = Math.min(ch.tempHp || 0, a);
  ch.tempHp = (ch.tempHp || 0) - fromTemp; a -= fromTemp;
  const dealt = a;
  ch.hp = Math.max(0, ch.hp - a);
  let downed = false, dead = false;
  if (ch.hp <= 0) {
    if (ch.isEnemy) { ch.conditions.dead = 1; downed = wasUp; dead = true; }
    else if (wasUp) {
      downed = true;
      const wd = condValue(ch, 'wounded');
      ch.conditions.dying = Math.min(4, 1 + wd + (opts.crit ? 1 : 0));
      ch.conditions.unconscious = 1; ch.conditions.prone = 1;
      delete ch.conditions.raised_shield; delete ch.conditions.in_cover;
      if (ch.conditions.dying >= 4) { ch.conditions.dead = 1; delete ch.conditions.dying; dead = true; }
    } else if (a > 0 && ch.conditions.dying) {
      ch.conditions.dying = Math.min(4, ch.conditions.dying + (opts.crit ? 2 : 1));
      if (ch.conditions.dying >= 4) { ch.conditions.dead = 1; delete ch.conditions.dying; dead = true; }
    }
  }
  return { dealt: dealt + fromTemp, downed, dead };
}
export function heal(ch, amount) {
  if (isDead(ch)) return 0;
  amount = Math.max(0, Math.round(amount));
  const before = ch.hp;
  if (ch.hp <= 0 && amount > 0) {
    if (ch.conditions.dying) ch.conditions.wounded = Math.min(3, condValue(ch, 'wounded') + 1);
    delete ch.conditions.dying; delete ch.conditions.unconscious;
  }
  ch.hp = Math.min(ch.maxHp, ch.hp + amount);
  return ch.hp - before;
}
export function recoveryCheck(ch, rng) {
  const dying = condValue(ch, 'dying');
  const r = flatCheck(10 + dying, rng);
  let nd = dying;
  if (r.degree === 3) nd -= 2; else if (r.degree === 2) nd -= 1; else if (r.degree === 0) nd += 2; else nd += 1;
  r.before = dying;
  if (nd >= 4) { ch.conditions.dead = 1; delete ch.conditions.dying; r.dead = true; }
  else if (nd <= 0) { delete ch.conditions.dying; ch.conditions.wounded = Math.min(3, condValue(ch, 'wounded') + 1); r.stable = true; }
  else ch.conditions.dying = nd;
  return r;
}

// ---------- tura
export function startTurn(ch, rng = Math.random) {
  const out = { log: [], actions: 0, events: [] };
  if (isDead(ch)) return out;
  if (ch.conditions.dying) {
    const r = recoveryCheck(ch, rng);
    out.log.push(r.dead ? `${ch.name} umiera.` : r.stable ? `${ch.name} stabilizuje się (nieprzytomny). (k20 ${r.d20} vs WT ${r.dc})` : `${ch.name} walczy o życie: umieranie ${condValue(ch, 'dying')} (k20 ${r.d20} vs WT ${r.dc})`);
    out.events.push({ type: 'recovery', target: ch, degree: r.degree });
    return out;
  }
  for (const pid of PERSISTENT) {
    if (!ch.conditions[pid] || isDead(ch)) continue;
    const r = roll(String(ch.conditions[pid]), rng);
    const dt = CONDITIONS[pid].dmgType;
    const res = applyDamage(ch, r.total, dt);
    out.log.push(`${ch.name} cierpi: ${CONDITIONS[pid].name.toLowerCase()} (${res.dealt} obrażeń).`);
    out.events.push({ type: 'damage', target: ch, amount: res.dealt, dmgType: dt, persistent: pid });
    if (res.dead || res.downed) { out.log.push(res.dead ? `${ch.name} ginie.` : `${ch.name} traci przytomność!`); out.events.push({ type: res.dead ? 'death' : 'down', target: ch }); }
    if (!isDead(ch)) { const f = flatCheck(15, rng); if (f.degree >= 2) { delete ch.conditions[pid]; out.log.push(`${ch.name}: ${CONDITIONS[pid].name.toLowerCase()} ustaje.`); } }
  }
  if (isDead(ch)) return out;
  for (const id of ['raised_shield', 'dodging']) delete ch.conditions[id];
  if (ch.hp <= 0 || ch.conditions.unconscious) return out;
  let actions = 3;
  if (hasCondition(ch, 'quickened')) actions += 1;
  for (const id of ['stunned', 'slowed']) if (ch.conditions[id]) { const n = condValue(ch, id); actions -= n; out.log.push(`${ch.name} jest ${CONDITIONS[id].name.toLowerCase()} (-${n} akcji).`); delete ch.conditions[id]; }
  out.actions = Math.max(0, actions);
  return out;
}
export function endTurn(ch, rng = Math.random) {
  const out = { log: [], events: [] };
  if (isDead(ch)) return out;
  for (const id of Object.keys(ch.conditions)) {
    const k = CONDITIONS[id] && CONDITIONS[id].kind;
    if (k === 'decay') { ch.conditions[id] -= 1; if (ch.conditions[id] <= 0) { delete ch.conditions[id]; if (!CONDITIONS[id].hidden) out.log.push(`${ch.name}: ${CONDITIONS[id].name.toLowerCase()} mija.`); } }
    else if (k === 'timed') { ch.conditions[id] -= 1; if (ch.conditions[id] <= 0) { delete ch.conditions[id]; if (!CONDITIONS[id].hidden) out.log.push(`${ch.name}: ${CONDITIONS[id].name.toLowerCase()} mija.`); } }
  }
  return out;
}
export function rollInitiative(ch, rng = Math.random) {
  const mod = getStat(ch, 'perception');
  const d20 = d(20, rng);
  return { d20, mod, total: d20 + mod };
}
export function skillCheck(ch, skillId, dc, rng = Math.random) { return check(getStat(ch, skillId), dc, rng); }

// ---------- strike
const sneakN = (ch) => (ch.classId === 'scavenger' ? Math.floor((ch.level + 1) / 2) : 0); // 1:1 2:1 3:2 5:3

export function strike(attacker, defender, o = {}) {
  const res = { log: [], events: [], attack: true };
  const w = normWeapon(o.weapon || getWeapon(attacker));
  const bonus = getAttackBonus(attacker, w, o.mapIndex || 0, { rangeIncrements: o.rangeIncrements }) + (o.bonus || 0);
  const dc = getStat(defender, 'ac', { ignoreCover: !!o.ignoreCover || w.range === 0 });
  const rng = o.rng || Math.random;
  const c = check(bonus, dc, rng);
  res.d20 = c;
  const info = `k20 ${c.d20}${fmtMod(bonus)}=${c.total} vs KP ${dc}`;
  const an = attacker.name;
  if (c.degree <= 1) {
    res.log.push(`${an} pudłuje (${info}).`);
    res.events.push({ type: 'miss', target: defender, degree: c.degree });
    return res;
  }
  const crit = c.degree === 3;
  const p = parseDice(w.dmg);
  let dice = p.n + (o.extraDice || 0);
  const fatal = traitVal(w, 'fatal'), deadly = traitVal(w, 'deadly');
  let sides = p.sides;
  if (crit && fatal) sides = fatal;
  let sum = 0;
  for (let i = 0; i < dice; i++) sum += d(sides, rng);
  let flat = p.mod + (o.damageBonus || 0);
  if (!attacker.base && w.range === 0 || (!attacker.base && traitVal(w, 'thrown'))) flat += attrMod(attacker, 'str');
  if (hasCondition(attacker, 'raging') && w.range === 0) flat += 2 + Math.floor(attacker.level / 5);
  if (hasCondition(attacker, 'tuned')) flat += 2;
  if (attacker.classId === 'scout' && hasCondition(defender, 'hunted')) { flat += 2 + Math.floor(attacker.level / 4); }
  let sneak = 0;
  const sn = sneakN(attacker);
  if (sn && (isOffGuard(defender) || o.sneak)) { for (let i = 0; i < sn; i++) sneak += d(6, rng); }
  let total = sum + flat + sneak;
  if (crit) {
    total *= 2;
    if (fatal) total += d(fatal, rng);
    else if (deadly) total += d(deadly, rng) * (dice >= 3 ? 2 : 1);
  }
  total = Math.max(1, total);
  const r = applyDamage(defender, total, w.type, { crit });
  res.events.push({ type: 'damage', target: defender, amount: r.dealt, degree: c.degree, dmgType: w.type });
  if (crit) res.events.push({ type: 'crit', target: defender, degree: 3 });
  res.log.push(`${an} trafia ${crit ? 'krytycznie ' : ''}${acc(defender)}: ${r.dealt} obrażeń ${DMG_ADJ[w.type] || ''}${sneak ? ' (z ukrycia +' + sneak + ')' : ''} (${info}).`);
  if (r.dead) { res.log.push(`${defender.name} ginie.`); res.events.push({ type: 'death', target: defender }); }
  else if (r.downed) { res.log.push(`${defender.name} traci przytomność!`); res.events.push({ type: 'down', target: defender }); }
  res.hit = true; res.dealt = r.dealt; res.weapon = w;
  return res;
}

// ---------- tworzenie postaci
function baseAttrs(cls, anc) {
  const a = { ...cls.attrs };
  for (const [k, v] of Object.entries(anc.attrBoosts || {})) {
    if (k === 'free') { let n = v; for (const t of cls.boostOrder) { if (n-- <= 0) break; a[t] += 1; } } else a[k] += v;
  }
  for (const [k, v] of Object.entries(anc.attrFlaw || {})) a[k] += v;
  for (const k of ATTRS) a[k] = Math.min(4, a[k]);
  return a;
}
function mergeProf(prof, add) {
  if (!add) return;
  for (const [k, v] of Object.entries(add)) {
    if (k === 'skills' || k === 'attacks' || k === 'defense') { prof[k] = prof[k] || {}; for (const [s, r] of Object.entries(v)) prof[k][s] = Math.max(prof[k][s] || 0, r); }
    else prof[k] = Math.max(prof[k] || 0, v);
  }
}
export function recalcHp(ch) {
  if (ch.isEnemy) return;
  const cls = CLASSES[ch.classId], anc = ancestryOf(ch.ancestry);
  const nm = anc.hp + (cls.hpPerLevel + (ch.attrs.con || 0)) * ch.level;
  const diff = nm - ch.maxHp;
  ch.maxHp = nm;
  if (diff > 0 && ch.hp > 0) ch.hp += diff;
  ch.hp = Math.min(ch.hp, ch.maxHp);
}
function syncAbilities(ch) {
  const cls = CLASSES[ch.classId];
  const ids = [...UNIVERSAL_ABILITIES];
  for (const id of cls.abilities) if ((cls.unlocks[id] || 1) <= ch.level) ids.push(id);
  for (const id of ids) {
    const ab = ABILITIES[id];
    if (!ch.abilities.includes(id)) { ch.abilities.push(id); }
    if (ab && ab.uses && ch.uses[id] === undefined) ch.uses[id] = ab.usesMax || 1;
  }
}
export function createCharacter(o = {}) {
  const cls = CLASSES[o.classId] || CLASSES.soldier;
  const ancId = (ANCESTRIES[o.ancestry] ? o.ancestry : ANCESTRY_ALIASES[o.ancestry]) || 'human';
  const anc = ANCESTRIES[ancId];
  const name = o.name || 'Najemnik';
  const h = hash(name + ancId + cls.id);
  const attrs = { ...baseAttrs(cls, anc) };
  if (o.attrs) for (const k of ATTRS) if (o.attrs[k] !== undefined) attrs[k] = o.attrs[k];
  const prof = clone(cls.prof);
  mergeProf(prof, { skills: anc.skills });
  const body = ['brute', 'soldier', 'champion', 'monk'].includes(cls.id) ? 'heavy' : ['scavenger', 'scout', 'gunslinger', 'hacker', 'herald'].includes(cls.id) ? 'light' : 'medium';
  const lk = anc.look || {};
  const look = { body, skin: pick(lk.skin || ['#c9a07a'], h), hair: pick(lk.hair || ['#222'], h >> 3), hairStyle: h % 6, cloth: cls.color, accent: '#c8a040', mask: false, mutation: !!lk.mutation, cyber: !!lk.cyber, ...(o.look || {}) };
  const ch = { id: uid('c'), name, ancestry: ancId, classId: cls.id, level: 1, xp: 0, isEnemy: false, attrs, maxHp: 0, hp: 0, tempHp: 0, prof,
    equipment: { weapon: null, weapon2: null, armor: null, shield: null }, inventory: [], abilities: [], uses: {}, conditions: {}, speed: anc.speed, look, bio: o.bio || '' };
  recalcHp(ch); ch.hp = ch.maxHp;
  for (const id of cls.startGear) {
    const it = ITEMS[id]; if (!it) continue;
    const inst = newItem(id);
    if (it.type === 'weapon' && !ch.equipment.weapon) ch.equipment.weapon = inst;
    else if (it.type === 'weapon' && !ch.equipment.weapon2) ch.equipment.weapon2 = inst;
    else if (it.type === 'armor' && !ch.equipment.armor) ch.equipment.armor = inst;
    else if (it.type === 'shield' && !ch.equipment.shield && !(ITEMS[ch.equipment.weapon?.id]?.weapon.hands === 2)) ch.equipment.shield = inst;
    else { const ex = ch.inventory.find((x) => x.id === id); if (ex && it.type === 'consumable') ex.qty++; else ch.inventory.push(inst); }
  }
  syncAbilities(ch);
  const target = Math.max(1, Math.min(MAX_LEVEL, o.level || 1));
  while (ch.level < target) levelUp(ch);
  return ch;
}
export function createEnemy(templateId, o = {}) {
  const t = ENEMIES[templateId];
  if (!t) throw new Error('Nieznany wróg: ' + templateId);
  const adj = o.levelAdj || 0;
  const hpMul = adj === 0 ? 1 : adj > 0 ? 1.25 : 0.8;
  const attacks = t.attacks.map((a) => { const x = JSON.parse(JSON.stringify(a)); if (adj) { x.bonus += adj; x.damage = x.damage.replace(/([+-]\d+)$/, (m) => { const v = parseInt(m, 10) + 2 * adj; return (v >= 0 ? '+' : '') + v; }); } return x; });
  const maxHp = Math.max(1, Math.round(t.hp * hpMul));
  const dcBase = 10 + t.attacks[0].bonus + adj;
  return {
    id: uid('e'), name: t.name, nameAcc: t.acc || t.name, templateId, isEnemy: true, ancestry: '', classId: '', level: Math.max(0, t.level + adj), xp: 0,
    attrs: { str: 2, dex: 2, con: 2, int: 0, wis: 1, cha: 0 }, maxHp, hp: maxHp, tempHp: 0,
    prof: { perception: 0, fortitude: 0, reflex: 0, will: 0, classDC: 0, skills: {}, attacks: {}, defense: {} },
    equipment: { weapon: null, weapon2: null, armor: null, shield: null }, inventory: [],
    abilities: ['strike', ...t.abilities], uses: Object.fromEntries(t.abilities.filter((a) => ABILITIES[a] && ABILITIES[a].uses).map((a) => [a, ABILITIES[a].usesMax || 1])),
    conditions: {}, speed: t.speed, look: { ...t.look }, bio: '',
    base: { ac: t.ac + adj, fortitude: t.saves.fort + adj, reflex: t.saves.ref + adj, will: t.saves.will + adj, perception: t.perception + adj, classDC: dcBase, skills: {} },
    attacks, faction: t.faction, ai: t.ai, traits: [...t.traits], resist: t.resist ? { ...t.resist } : undefined, weak: t.weak ? { ...t.weak } : undefined, immune: t.immune ? [...t.immune] : undefined,
  };
}
export function rollLoot(enemy, rng = Math.random) {
  const t = ENEMIES[enemy.templateId || enemy]; const out = { scrap: 0, items: [] };
  if (!t) return out;
  out.scrap = t.scrap[0] + Math.floor(rng() * (t.scrap[1] - t.scrap[0] + 1));
  for (const l of t.loot) if (rng() < l.chance) out.items.push(newItem(l.id, l.qty || 1));
  return out;
}

// ---------- doświadczenie
export function levelUp(ch) {
  if (ch.isEnemy || ch.level >= MAX_LEVEL) return false;
  const cls = CLASSES[ch.classId];
  ch.level += 1;
  mergeProf(ch.prof, cls.progression[ch.level]);
  if (ch.level % 5 === 0) { let n = 4; for (const a of cls.boostOrder) { if (n-- <= 0) break; ch.attrs[a] = Math.min(5, ch.attrs[a] + 1); } }
  // drobna premia: co poziom parzysty +1 ranga w jednej z wyszkolonych umiejętności do Eksperta
  if (ch.level % 2 === 0) { const sk = Object.keys(ch.prof.skills).sort((a, b) => ch.prof.skills[b] - ch.prof.skills[a]); const t = sk.find((s) => ch.prof.skills[s] < 2); if (t) ch.prof.skills[t] += 1; }
  recalcHp(ch);
  syncAbilities(ch);
  return true;
}
export function addXP(ch, xp) {
  if (ch.isEnemy) return 0;
  ch.xp += Math.max(0, Math.round(xp));
  let gained = 0;
  while (ch.xp >= XP_PER_LEVEL && ch.level < MAX_LEVEL) { ch.xp -= XP_PER_LEVEL; levelUp(ch); gained++; }
  if (ch.level >= MAX_LEVEL) ch.xp = Math.min(ch.xp, XP_PER_LEVEL - 1);
  return gained;
}
const XP_TABLE = { '-4': 10, '-3': 15, '-2': 20, '-1': 30, '0': 40, '1': 60, '2': 80, '3': 120, '4': 160 };
export function encounterXP(partyLevel, enemies) {
  let sum = 0;
  for (const e of enemies) {
    const lvl = typeof e === 'string' ? ENEMIES[e].level : e.level !== undefined ? e.level : ENEMIES[e.templateId].level;
    const diff = lvl - partyLevel;
    if (diff < -4) continue;
    sum += XP_TABLE[Math.min(4, diff)];
  }
  return sum;
}

// ---------- odpoczynek
export function refreshUses(ch, which) {
  for (const id of Object.keys(ch.uses)) { const ab = ABILITIES[id]; if (!ab || !ab.uses) continue; if (!which || ab.uses === which) ch.uses[id] = ab.usesMax || 1; }
}
export function endEncounter(ch) {
  if (isDead(ch)) return;
  for (const id of Object.keys(ch.conditions)) {
    const m = CONDITIONS[id];
    if (!m || ['dying', 'wounded', 'unconscious', 'dead', 'bleeding'].includes(id)) continue;
    delete ch.conditions[id];
  }
  if (ch.hp > 0) ch.tempHp = 0;
  refreshUses(ch, 'encounter');
}
export function longRest(ch) {
  if (isDead(ch)) return;
  ch.hp = ch.maxHp; ch.tempHp = 0; ch.conditions = {};
  refreshUses(ch);
}

// ---------- opisy
export function summarize(ch) {
  const out = [];
  const cls = CLASSES[ch.classId];
  out.push(`${ch.name}${cls ? ' – ' + cls.name : ''} (poz. ${ch.level})`);
  out.push(`PW ${ch.hp}/${ch.maxHp}${ch.tempHp ? ' (+' + ch.tempHp + ')' : ''} | KP ${getStat(ch, 'ac')} | Prędkość ${getStat(ch, 'speed')}`);
  out.push(`Wytrz. ${fmtMod(getStat(ch, 'fortitude'))} Ref. ${fmtMod(getStat(ch, 'reflex'))} Wola ${fmtMod(getStat(ch, 'will'))} Perc. ${fmtMod(getStat(ch, 'perception'))}`);
  if (!ch.isEnemy) out.push('Cechy: ' + ATTRS.map((a) => `${a.toUpperCase()} ${fmtMod(ch.attrs[a])}`).join(' '));
  for (const w of getWeapons(ch)) { const n = normWeapon(w); out.push(`${n.name}: ${fmtMod(getAttackBonus(ch, w, 0))} (${n.dmg} ${DMG_ADJ[n.type] || ''})`); }
  const cs = Object.entries(ch.conditions).filter(([k]) => CONDITIONS[k] && !CONDITIONS[k].hidden).map(([k, v]) => CONDITIONS[k].name + (typeof v === 'number' && CONDITIONS[k].valued ? ' ' + v : ''));
  if (cs.length) out.push('Stany: ' + cs.join(', '));
  return out;
}
export { dcForLevel };
