// Zdolności (uniwersalne, klasowe, wrogów) i użycie przedmiotów. resolve(ctx) MUTUJE postacie.
import { d, roll, check, dcForLevel, fmtMod } from './dice.js';
import { CONDITIONS } from './content.js';
import { ITEMS } from './items.js';
import { ENEMIES } from './enemies.js';
import { strike, applyDamage, heal, addCondition, removeCondition, hasCondition, condValue, getStat, getWeapon, normWeapon, attrMod, acc, DMG_ADJ, ancestryOf, newItem, isDead } from './core.js';

const R = () => ({ log: [], events: [], attack: false });
const merge = (res, r) => { res.log.push(...r.log); res.events.push(...r.events); if (r.d20 && !res.d20) res.d20 = r.d20; return r; };
const SAVE_NAMES = { fortitude: 'Wytrz.', reflex: 'Refleks', will: 'Wola' };
const dcOf = (t, kind) => 10 + getStat(t, kind);
const isMachine = (t) => !!((t.traits && t.traits.includes('machine')) || (!t.isEnemy && ancestryOf(t.ancestry).traits.includes('machine')));
const spend = (u, id) => { if (u.uses && u.uses[id] !== undefined) u.uses[id] = Math.max(0, u.uses[id] - 1); };
const first = (ctx) => (ctx.targets && ctx.targets[0]) || null;
const noTarget = () => { const r = R(); r.log.push('Brak celu.'); return r; };
const rngOf = (ctx) => ctx.rng || Math.random;
const mapOf = (ctx) => ctx.mapIndex || 0;

function cond(res, t, id, value = 1, label) {
  const before = t.conditions[id];
  addCondition(t, id, value);
  if (t.conditions[id] !== undefined && t.conditions[id] !== before) {
    res.events.push({ type: 'condition', target: t, condition: id, value: t.conditions[id] });
    res.log.push(label || `${t.name}: ${CONDITIONS[id].name.toLowerCase()}${typeof value === 'number' && CONDITIONS[id].valued ? ' ' + value : ''}.`);
  }
}
function hurt(res, t, amount, type, crit = false) {
  const a = applyDamage(t, amount, type, { crit });
  res.events.push({ type: 'damage', target: t, amount: a.dealt, dmgType: type });
  if (a.dead) { res.log.push(`${t.name} ginie.`); res.events.push({ type: 'death', target: t }); }
  else if (a.downed) { res.log.push(`${t.name} traci przytomność!`); res.events.push({ type: 'down', target: t }); }
  return a;
}
function doHeal(res, t, amount, label) {
  const n = heal(t, amount);
  res.events.push({ type: 'heal', target: t, amount: n });
  res.log.push(`${label}: ${t.name} odzyskuje ${n} PW.`);
  return n;
}
function tempHp(res, t, n) {
  if ((t.tempHp || 0) < n) t.tempHp = n;
  res.events.push({ type: 'heal', target: t, amount: n, temp: true });
}
// zwykły rzut obronny z obrażeniami (podstawowy): kryt.sukces 0, sukces 1/2, porażka pełne, kryt.porażka x2
function basicSave(res, t, kind, dc, expr, type, rng) {
  const c = check(getStat(t, kind), dc, rng);
  if (!res.d20) res.d20 = c;
  const r = roll(expr, rng);
  const amt = c.degree === 3 ? 0 : c.degree === 2 ? Math.floor(r.total / 2) : c.degree === 1 ? r.total : r.total * 2;
  let a = { dealt: 0 };
  if (amt > 0) a = hurt(res, t, amt, type, c.degree === 0);
  else res.events.push({ type: 'miss', target: t, degree: c.degree });
  res.log.push(`${t.name}: ${a.dealt} obrażeń ${DMG_ADJ[type] || ''} (${SAVE_NAMES[kind]} k20 ${c.d20}${fmtMod(getStat(t, kind))}=${c.total} vs WT ${dc})`);
  return { c, a };
}
function simpleAttack(res, user, t, { label, bonus, expr, type, rng, crit2 = true }) {
  const dc = getStat(t, 'ac', { ignoreCover: false });
  const c = check(bonus, dc, rng);
  if (!res.d20) res.d20 = c;
  const info = `k20 ${c.d20}${fmtMod(bonus)}=${c.total} vs KP ${dc}`;
  if (c.degree <= 1) { res.log.push(`${label} pudłuje (${info}).`); res.events.push({ type: 'miss', target: t, degree: c.degree }); return { hit: false, c }; }
  let tot = roll(expr, rng).total; if (c.degree === 3) tot *= 2;
  const a = hurt(res, t, tot, type, c.degree === 3);
  res.log.push(`${label} trafia ${c.degree === 3 ? 'krytycznie ' : ''}${acc(t)}: ${a.dealt} obrażeń ${DMG_ADJ[type] || ''} (${info}).`);
  return { hit: true, c, a };
}
const hitOf = (r) => !!r.hit;

export const ABILITIES = {};
function def(id, o, resolve) { ABILITIES[id] = { id, target: 'enemy', range: 1, uses: null, fx: 'melee', icon: id, ...o, resolve }; }

// ================= uniwersalne
def('strike', { name: 'Atak', desc: 'Atak bronią. Każdy kolejny atak w turze ma karę (PWA -5/-10).', actions: 1, range: 1, fx: 'melee' }, (ctx) => {
  const t = first(ctx); if (!t) return noTarget();
  const r = strike(ctx.user, t, { weapon: ctx.weapon, mapIndex: mapOf(ctx), rng: rngOf(ctx), rangeIncrements: ctx.rangeIncrements, bonus: ctx.bonus || 0, damageBonus: ctx.damageBonus || 0 });
  return r;
});
def('raise_shield', { name: 'Podnieś tarczę', desc: '+KP z tarczy do początku następnej tury.', actions: 1, target: 'self', range: 0, fx: 'buff', icon: 'shield' }, (ctx) => {
  const r = R(), u = ctx.user;
  if (!u.equipment || !u.equipment.shield) { r.log.push(`${u.name} nie ma tarczy.`); return r; }
  cond(r, u, 'raised_shield', 1, `${u.name} podnosi tarczę (+${ITEMS[u.equipment.shield.id].shield.ac} KP).`);
  return r;
});
def('take_cover', { name: 'Schowaj się', desc: '+2 KP przeciw atakom dystansowym (+4 jeśli już w osłonie).', actions: 1, target: 'self', range: 0, fx: 'buff', icon: 'cover' }, (ctx) => {
  const r = R(), u = ctx.user, cur = condValue(u, 'in_cover');
  u.conditions.in_cover = cur >= 1 ? 2 : 1;
  r.events.push({ type: 'condition', target: u, condition: 'in_cover', value: u.conditions.in_cover });
  r.log.push(`${u.name} kryje się za osłoną (+${u.conditions.in_cover === 2 ? 4 : 2} KP).`);
  return r;
});
def('demoralize', { name: 'Zastrasz', desc: 'Zastraszanie vs Wola: cel jest przerażony (kryt. = 2).', actions: 1, range: 6, fx: 'shout', icon: 'shout' }, (ctx) => {
  const t = first(ctx); if (!t) return noTarget();
  const r = R(), u = ctx.user, rng = rngOf(ctx);
  if (hasCondition(t, 'dem_imm')) { r.log.push(`${t.name} jest odporny na zastraszanie.`); return r; }
  const dc = dcOf(t, 'will'), c = check(getStat(u, 'intimidation'), dc, rng);
  r.d20 = c;
  addCondition(t, 'dem_imm', 4);
  const info = `Zastraszanie k20 ${c.d20}${fmtMod(c.mod)}=${c.total} vs WT ${dc}`;
  if (c.degree >= 2) { cond(r, t, 'frightened', c.degree === 3 ? 2 : 1, `${u.name} zastrasza ${acc(t)}: przerażony ${c.degree === 3 ? 2 : 1} (${info}).`); }
  else r.log.push(`${u.name} nie zastrasza ${acc(t)} (${info}).`);
  return r;
});
def('first_aid', { name: 'Pierwsza pomoc', desc: 'Stabilizuje umierającego, tamuje krwawienie lub lekko leczy (Medycyna).', actions: 2, target: 'ally', range: 1, fx: 'heal', icon: 'aid' }, (ctx) => {
  const t = first(ctx) || ctx.user; const r = R(), u = ctx.user, rng = rngOf(ctx);
  if (isDead(t)) { r.log.push(`${t.name} nie żyje.`); return r; }
  const dying = condValue(t, 'dying');
  const dc = dying ? 15 + dying : hasCondition(t, 'bleeding') ? 15 : dcForLevel(u.level);
  const c = check(getStat(u, 'medicine'), dc, rng); r.d20 = c;
  const info = `Medycyna k20 ${c.d20}${fmtMod(c.mod)}=${c.total} vs WT ${dc}`;
  if (c.degree <= 1) {
    if (c.degree === 0 && dying) { t.conditions.dying = Math.min(3, dying + 1); r.log.push(`${u.name} pogarsza stan ${acc(t)} (${info}).`); }
    else r.log.push(`${u.name} nie pomaga ${t.name} (${info}).`);
    return r;
  }
  if (dying) { delete t.conditions.dying; t.conditions.wounded = Math.min(3, condValue(t, 'wounded') + 1); r.log.push(`${u.name} stabilizuje ${acc(t)} (${info}).`); r.events.push({ type: 'condition', target: t, condition: 'stable' }); if (c.degree === 3) doHeal(r, t, roll('1d6', rng).total, 'Opatrunek'); return r; }
  if (hasCondition(t, 'bleeding')) { removeCondition(t, 'bleeding'); r.log.push(`${u.name} tamuje krwawienie ${acc(t) === t.name ? t.name : t.name} (${info}).`); return r; }
  doHeal(r, t, roll(c.degree === 3 ? '2d6' : '1d6', rng).total + 1, `Pierwsza pomoc (${info})`);
  return r;
});
def('stand', { name: 'Wstań', desc: 'Podnieś się z ziemi.', actions: 1, target: 'self', range: 0, fx: 'buff', icon: 'stand' }, (ctx) => {
  const r = R(), u = ctx.user;
  if (u.hp > 0 && hasCondition(u, 'prone')) { removeCondition(u, 'prone'); r.log.push(`${u.name} wstaje.`); } else r.log.push(`${u.name} już stoi.`);
  return r;
});

// ================= Żołnierz
def('suppressive_fire', { name: 'Ogień zaporowy', desc: 'Zasypujesz obszar pociskami. Refleks vs WT klasy: porażka = pełne obrażenia i dezorientacja, kryt. = x2 i strach.', actions: 2, target: 'area', range: 12, radius: 2, uses: 'encounter', usesMax: 2, fx: 'shot', icon: 'barrage' }, (ctx) => {
  const r = R(), u = ctx.user, rng = rngOf(ctx); r.attack = true;
  if (!ctx.targets || !ctx.targets.length) return noTarget();
  const w = normWeapon(getWeapon(u));
  if (w.range <= 0) { r.log.push(`${u.name} potrzebuje broni dystansowej.`); r.attack = false; return r; }
  spend(u, 'suppressive_fire');
  const dc = getStat(u, 'classDC');
  r.log.push(`${u.name} otwiera ogień zaporowy!`);
  for (const t of ctx.targets) {
    const c = check(getStat(t, 'reflex'), dc, rng); if (!r.d20) r.d20 = c;
    const dmg = w.dmg.replace(/[+-]\d+$/, '');
    if (c.degree === 3) { r.log.push(`${t.name} unika ognia.`); continue; }
    let amt = roll(dmg, rng).total; if (c.degree === 2) amt = Math.floor(amt / 2); if (c.degree === 0) amt *= 2;
    const a = hurt(r, t, amt, w.type, c.degree === 0);
    r.log.push(`${t.name}: ${a.dealt} obrażeń (Refleks k20 ${c.d20}=${c.total} vs WT ${dc}).`);
    if (c.degree <= 1) cond(r, t, 'distracted', 2, `${t.name} kuli się pod ogniem.`);
    if (c.degree === 0) cond(r, t, 'frightened', 1);
  }
  return r;
});
def('double_strike', { name: 'Podwójny cios', desc: 'Dwa ataki, oba z karą z bieżącego PWA (liczą się jako 2 ataki).', actions: 2, range: 1, fx: 'melee', icon: 'double' }, (ctx) => {
  const t = first(ctx); if (!t) return noTarget();
  const r = R(); r.attack = true; r.attacks = 2;
  for (let i = 0; i < 2; i++) { if (!isDead(t) && t.hp > 0) merge(r, strike(ctx.user, t, { weapon: ctx.weapon, mapIndex: mapOf(ctx), rng: rngOf(ctx), rangeIncrements: ctx.rangeIncrements })); }
  return r;
});
def('charge', { name: 'Natarcie', desc: 'Rzuć się na wroga (ruch w cenie) i uderz z impetem: +1 do trafienia, +2 obrażeń.', actions: 2, range: 1, move: true, fx: 'melee', icon: 'charge' }, (ctx) => {
  const t = first(ctx); if (!t) return noTarget();
  const r = strike(ctx.user, t, { weapon: ctx.weapon, mapIndex: mapOf(ctx), rng: rngOf(ctx), bonus: 1, damageBonus: 2 });
  r.log.unshift(`${ctx.user.name} szarżuje!`); return r;
});
def('rally', { name: 'Zew dowódcy', desc: 'Sojusznicy w pobliżu zrzucają strach i zyskują tymczasowe PW.', actions: 1, target: 'area', range: 0, radius: 4, uses: 'encounter', usesMax: 1, fx: 'shout', icon: 'rally' }, (ctx) => {
  const r = R(), u = ctx.user; spend(u, 'rally');
  r.log.push(`${u.name} woła: do mnie!`);
  for (const t of ctx.targets && ctx.targets.length ? ctx.targets : [u]) { removeCondition(t, 'frightened'); tempHp(r, t, 4 + u.level * 2); r.log.push(`${t.name}: +${4 + u.level * 2} tymcz. PW.`); }
  return r;
});

// ================= Zwiadowca
def('mark_target', { name: 'Wyznacz cel', desc: 'Oznacz wroga: trafienia Zwiadowcy zadają mu dodatkowe obrażenia.', actions: 1, range: 12, fx: 'buff', icon: 'mark' }, (ctx) => {
  const t = first(ctx); if (!t) return noTarget();
  const r = R(); addCondition(t, 'hunted', 5);
  r.events.push({ type: 'condition', target: t, condition: 'hunted' }); r.log.push(`${ctx.user.name} wyznacza cel: ${t.name}.`); return r;
});
def('precise_shot', { name: 'Precyzyjny strzał', desc: 'Strzał +2 do trafienia, ignoruje osłonę, dodatkowa kość obrażeń.', actions: 2, range: 14, fx: 'shot', icon: 'aim' }, (ctx) => {
  const t = first(ctx); if (!t) return noTarget();
  const r = strike(ctx.user, t, { weapon: ctx.weapon, mapIndex: mapOf(ctx), rng: rngOf(ctx), rangeIncrements: ctx.rangeIncrements, bonus: 2, extraDice: 1, ignoreCover: true });
  return r;
});
def('crippling_shot', { name: 'Strzał w nogę', desc: 'Strzał, który po trafieniu może spowolnić cel (Wytrzymałość vs WT klasy).', actions: 2, range: 12, fx: 'shot', icon: 'cripple' }, (ctx) => {
  const t = first(ctx); if (!t) return noTarget();
  const u = ctx.user, rng = rngOf(ctx);
  const r = strike(u, t, { weapon: ctx.weapon, mapIndex: mapOf(ctx), rng, rangeIncrements: ctx.rangeIncrements });
  if (hitOf(r) && t.hp > 0) {
    const dc = getStat(u, 'classDC'), c = check(getStat(t, 'fortitude'), dc, rng);
    if (c.degree <= 1) cond(r, t, 'slowed', c.degree === 0 ? 2 : 1, `${t.name} kuleje (spowolniony ${c.degree === 0 ? 2 : 1}).`);
  }
  return r;
});
def('volley', { name: 'Seria strzałów', desc: 'Dwa szybkie strzały z tą samą karą PWA (liczą się jako 2 ataki).', actions: 2, range: 12, uses: 'encounter', usesMax: 2, fx: 'shot', icon: 'volley' }, (ctx) => {
  const t = first(ctx); if (!t) return noTarget();
  const r = R(); r.attack = true; r.attacks = 2; spend(ctx.user, 'volley');
  for (let i = 0; i < 2; i++) if (t.hp > 0) merge(r, strike(ctx.user, t, { weapon: ctx.weapon, mapIndex: mapOf(ctx), rng: rngOf(ctx), rangeIncrements: ctx.rangeIncrements, bonus: 1 }));
  return r;
});

// ================= Medyk
def('field_dressing', { name: 'Opatrunek polowy', desc: 'Test Medycyny (WT wg poziomu): leczy 2k6+Mąd+poz., kryt. 4k6. Tamuje krwawienie.', actions: 2, target: 'ally', range: 1, uses: 'encounter', usesMax: 3, fx: 'heal', icon: 'bandage' }, (ctx) => {
  const u = ctx.user, t = first(ctx) || u, r = R(), rng = rngOf(ctx);
  if (isDead(t)) { r.log.push(`${t.name} nie żyje.`); return r; }
  spend(u, 'field_dressing');
  const dc = dcForLevel(u.level), c = check(getStat(u, 'medicine'), dc, rng); r.d20 = c;
  const bonus = Math.max(0, attrMod(u, 'wis')) + u.level;
  const info = `Medycyna k20 ${c.d20}${fmtMod(c.mod)}=${c.total} vs WT ${dc}`;
  if (c.degree === 3) { doHeal(r, t, roll(`4d6+${bonus}`, rng).total, `Opatrunek (${info})`); removeCondition(t, 'bleeding'); removeCondition(t, 'poisoned'); }
  else if (c.degree === 2) { doHeal(r, t, roll(`2d6+${bonus}`, rng).total, `Opatrunek (${info})`); removeCondition(t, 'bleeding'); }
  else if (c.degree === 1) doHeal(r, t, roll('1d4', rng).total, `Marny opatrunek (${info})`);
  else r.log.push(`${u.name} partaczy opatrunek ${acc(t) === t.name ? t.name : t.name} (${info}).`);
  return r;
});
def('stimulant', { name: 'Stymulant', desc: 'Zastrzyk: tymczasowe PW (4+2/poz.) i +1 do trafienia na 4 rundy.', actions: 1, target: 'ally', range: 1, uses: 'encounter', usesMax: 2, fx: 'buff', icon: 'stim' }, (ctx) => {
  const u = ctx.user, t = first(ctx) || u, r = R(); spend(u, 'stimulant');
  if (isDead(t)) { r.log.push(`${t.name} nie żyje.`); return r; }
  const n = 4 + 2 * u.level; tempHp(r, t, n); addCondition(t, 'stimmed', 5);
  r.events.push({ type: 'condition', target: t, condition: 'stimmed' });
  r.log.push(`${u.name} aplikuje stymulant: ${t.name} +${n} tymcz. PW, +1 do trafienia.`); return r;
});
def('adrenaline', { name: 'Adrenalina', desc: 'Postaw powaloną postać na nogi (1k8+Mąd+poz. PW). Przytomnym daje dodatkową akcję.', actions: 1, target: 'ally', range: 1, uses: 'encounter', usesMax: 1, fx: 'heal', icon: 'adrenaline' }, (ctx) => {
  const u = ctx.user, t = first(ctx) || u, r = R(), rng = rngOf(ctx);
  if (isDead(t)) { r.log.push(`${t.name} nie żyje.`); return r; }
  spend(u, 'adrenaline');
  if (t.hp <= 0) { doHeal(r, t, roll('1d8', rng).total + Math.max(0, attrMod(u, 'wis')) + u.level, `Adrenalina: ${t.name} wraca do walki`); removeCondition(t, 'prone'); }
  else { addCondition(t, 'quickened', 1); r.events.push({ type: 'condition', target: t, condition: 'quickened' }); r.log.push(`${t.name} dostaje zastrzyk adrenaliny: +1 akcja.`); }
  return r;
});
def('field_clinic', { name: 'Punkt medyczny', desc: 'Leczy wszystkich sojuszników w pobliżu (1k8+Mąd+poz.).', actions: 2, target: 'area', range: 0, radius: 2, uses: 'encounter', usesMax: 1, fx: 'heal', icon: 'clinic' }, (ctx) => {
  const u = ctx.user, r = R(), rng = rngOf(ctx); spend(u, 'field_clinic');
  for (const t of ctx.targets && ctx.targets.length ? ctx.targets : [u]) if (!isDead(t)) doHeal(r, t, roll('1d8', rng).total + Math.max(0, attrMod(u, 'wis')) + u.level, 'Punkt medyczny');
  return r;
});

// ================= Technik
def('combat_drone', { name: 'Dron bojowy', desc: 'Dron strzela dwa razy w cel (trafienie wg Int + klasa), niezależnie od PWA.', actions: 2, range: 8, uses: 'encounter', usesMax: 2, fx: 'shot', icon: 'drone' }, (ctx) => {
  const t = first(ctx); if (!t) return noTarget();
  const u = ctx.user, r = R(), rng = rngOf(ctx); spend(u, 'combat_drone');
  const b = getStat(u, 'classDC') - 10, int = Math.max(0, attrMod(u, 'int'));
  r.log.push(`${u.name} wypuszcza drona bojowego.`);
  for (let i = 0; i < 2; i++) if (t.hp > 0) simpleAttack(r, u, t, { label: 'Dron', bonus: b - 5 * i, expr: `1d6+${int}`, type: 'P', rng });
  return r;
});
def('emp_grenade', { name: 'Granat EMP', desc: 'Impuls elektromagnetyczny: maszynom i cyborgom zadaje obrażenia i ogłusza (Refleks vs WT klasy).', actions: 2, target: 'area', range: 6, radius: 2, uses: 'encounter', usesMax: 2, fx: 'explosion', icon: 'emp' }, (ctx) => {
  const u = ctx.user, r = R(), rng = rngOf(ctx); spend(u, 'emp_grenade');
  if (!ctx.targets || !ctx.targets.length) return noTarget();
  const dc = getStat(u, 'classDC');
  r.log.push(`${u.name} rzuca granat EMP!`);
  for (const t of ctx.targets) {
    const mach = isMachine(t);
    const { c } = basicSave(r, t, 'reflex', dc, mach ? `2d6+${u.level}` : '1d4', 'elec', rng);
    if (mach && c.degree <= 1 && t.hp > 0) cond(r, t, 'stunned', c.degree === 0 ? 2 : 1, `${t.name} zwiera układy (ogłuszony ${c.degree === 0 ? 2 : 1}).`);
  }
  return r;
});
def('repair_armor', { name: 'Naprawa pancerza', desc: 'Test Techniki: tymczasowe PW (kryt. x2) i +1 KP na 3 rundy.', actions: 2, target: 'ally', range: 1, uses: 'encounter', usesMax: 3, fx: 'buff', icon: 'repair' }, (ctx) => {
  const u = ctx.user, t = first(ctx) || u, r = R(), rng = rngOf(ctx);
  if (isDead(t)) { r.log.push(`${t.name} nie żyje.`); return r; }
  spend(u, 'repair_armor');
  const dc = dcForLevel(u.level), c = check(getStat(u, 'crafting'), dc, rng); r.d20 = c;
  const info = `Technika k20 ${c.d20}${fmtMod(c.mod)}=${c.total} vs WT ${dc}`;
  const n = 3 + 2 * u.level;
  if (c.degree >= 2) { const amt = c.degree === 3 ? n * 2 : n; tempHp(r, t, amt); addCondition(t, 'reinforced', 4); r.events.push({ type: 'condition', target: t, condition: 'reinforced' }); r.log.push(`${u.name} naprawia pancerz ${acc(t) === t.name ? t.name : t.name}: +${amt} tymcz. PW, +1 KP (${info}).`); }
  else r.log.push(`${u.name} nie daje rady naprawić pancerza (${info}).`);
  return r;
});
def('weapon_tune', { name: 'Strojenie broni', desc: 'Sojusznik zadaje +2 obrażeń przez 3 rundy.', actions: 1, target: 'ally', range: 6, uses: 'encounter', usesMax: 2, fx: 'buff', icon: 'tune' }, (ctx) => {
  const u = ctx.user, t = first(ctx) || u, r = R(); spend(u, 'weapon_tune');
  addCondition(t, 'tuned', 4); r.events.push({ type: 'condition', target: t, condition: 'tuned' });
  r.log.push(`${u.name} stroi broń: ${t.name} +2 do obrażeń.`); return r;
});

// ================= Szczur
def('sneak_attack', { name: 'Atak z ukrycia', desc: 'Test Skradania vs Percepcja: udany = cios w odsłoniętego (+k6 obrażeń, więcej z poziomem).', actions: 2, range: 1, fx: 'melee', icon: 'ambush' }, (ctx) => {
  const t = first(ctx); if (!t) return noTarget();
  const u = ctx.user, rng = rngOf(ctx), r = R();
  let sneak = hasCondition(u, 'hidden');
  if (!sneak) {
    const dc = dcOf(t, 'perception'), c = check(getStat(u, 'stealth'), dc, rng); r.d20 = c;
    sneak = c.degree >= 2;
    r.log.push(sneak ? `${u.name} wymyka się czujności ${acc(t) === t.name ? t.name : t.name} (Skradanie k20 ${c.d20}=${c.total} vs ${dc}).` : `${t.name} zauważa ${u.name}.`);
  }
  removeCondition(u, 'hidden');
  const s = strike(u, t, { weapon: ctx.weapon, mapIndex: mapOf(ctx), rng, rangeIncrements: ctx.rangeIncrements, sneak });
  merge(r, s); r.attack = true; if (s.d20) r.d20 = s.d20; return r;
});
def('dodge', { name: 'Unik', desc: '+2 do KP do początku następnej tury.', actions: 1, target: 'self', range: 0, fx: 'buff', icon: 'dodge' }, (ctx) => {
  const r = R(), u = ctx.user; cond(r, u, 'dodging', 1, `${u.name} wymija ciosy (+2 KP).`); return r;
});
def('steal', { name: 'Kradzież', desc: 'Złodziejstwo vs Percepcja: zabierasz wrogowi coś z kieszeni (raz na wroga).', actions: 1, range: 1, fx: 'melee', icon: 'steal' }, (ctx) => {
  const t = first(ctx); if (!t) return noTarget();
  const u = ctx.user, r = R(), rng = rngOf(ctx);
  if (t.stolen) { r.log.push(`${t.name} nie ma już nic do zabrania.`); return r; }
  const dc = dcOf(t, 'perception'), c = check(getStat(u, 'thievery'), dc, rng); r.d20 = c;
  const info = `Złodziejstwo k20 ${c.d20}${fmtMod(c.mod)}=${c.total} vs ${dc}`;
  if (c.degree >= 2) {
    t.stolen = 1;
    const tmpl = ENEMIES[t.templateId]; const pool = tmpl ? tmpl.loot.filter((l) => ITEMS[l.id] && ITEMS[l.id].type !== 'ammo') : [];
    const l = pool.length ? pool[Math.floor(rng() * pool.length)] : null;
    if (l) { const it = newItem(l.id, 1); u.inventory.push(it); r.log.push(`${u.name} kradnie ${acc(t) === t.name ? t.name : t.name}: ${ITEMS[l.id].name} (${info}).`); r.events.push({ type: 'steal', target: t, item: it }); }
    else r.log.push(`${u.name} przeszukuje ${acc(t)}, ale nic nie znajduje (${info}).`);
    if (c.degree === 3) { const sc = 2 + d(6, rng); u.stolenScrap = (u.stolenScrap || 0) + sc; r.events.push({ type: 'scrap', amount: sc }); r.log.push(`Do tego ${sc} Złomu.`); }
  } else if (c.degree === 0) { cond(r, u, 'clumsy', 1, `${u.name} daje się przyłapać! (${info}).`); }
  else r.log.push(`${u.name} nie zdołał nic zabrać (${info}).`);
  return r;
});
def('dirty_trick', { name: 'Rzut piaskiem', desc: 'Refleks vs WT klasy: cel jest zdezorientowany i niezdarny.', actions: 1, range: 1, fx: 'melee', icon: 'dirty' }, (ctx) => {
  const t = first(ctx); if (!t) return noTarget();
  const u = ctx.user, r = R(), rng = rngOf(ctx);
  const dc = getStat(u, 'classDC'), c = check(getStat(t, 'reflex'), dc, rng); r.d20 = c;
  if (c.degree >= 2) { r.log.push(`${t.name} unika piasku.`); return r; }
  cond(r, t, 'distracted', 2, `${u.name} sypie piasek w oczy ${acc(t)}!`);
  cond(r, t, 'clumsy', c.degree === 0 ? 2 : 1);
  return r;
});

// ================= Brutal
const rageResolve = (ctx) => {
  const u = ctx.user, r = R();
  if (hasCondition(u, 'raging')) { r.log.push(`${u.name} już jest w szale.`); return r; }
  addCondition(u, 'raging', 5);
  const n = u.level + Math.max(0, attrMod(u, 'con')); tempHp(r, u, n);
  r.events.push({ type: 'condition', target: u, condition: 'raging' });
  r.log.push(`${u.name} wpada w szał! (+${n} tymcz. PW, +obrażenia, -1 KP)`); return r;
};
def('rage', { name: 'Szał', desc: '+2 do obrażeń w walce wręcz, tymczasowe PW, -1 KP. Trwa kilka rund.', actions: 1, target: 'self', range: 0, fx: 'buff', icon: 'rage' }, rageResolve);
def('roar', { name: 'Ryk', desc: 'Wrogowie w pobliżu: Zastraszanie vs Wola, przerażenie (kryt. = 2).', actions: 1, target: 'area', range: 0, radius: 3, uses: 'encounter', usesMax: 1, fx: 'shout', icon: 'roar' }, (ctx) => {
  const u = ctx.user, r = R(), rng = rngOf(ctx); spend(u, 'roar');
  if (!ctx.targets || !ctx.targets.length) { r.log.push(`${u.name} ryczy w pustkę.`); return r; }
  r.log.push(`${u.name} wydaje straszliwy ryk!`);
  for (const t of ctx.targets) {
    const dc = dcOf(t, 'will'), c = check(getStat(u, 'intimidation'), dc, rng); if (!r.d20) r.d20 = c;
    if (c.degree >= 2) cond(r, t, 'frightened', c.degree === 3 ? 2 : 1, `${t.name} cofa się w strachu (Zastraszanie k20 ${c.d20}=${c.total} vs ${dc}).`);
    else r.log.push(`${t.name} nie daje się zastraszyć.`);
  }
  return r;
});
def('rend', { name: 'Rozpłatanie', desc: 'Potężny cios (+1 kość obrażeń), po trafieniu cel krwawi (1k6, kryt. 2k6).', actions: 2, range: 1, fx: 'melee', icon: 'rend' }, (ctx) => {
  const t = first(ctx); if (!t) return noTarget();
  const r = strike(ctx.user, t, { weapon: ctx.weapon, mapIndex: mapOf(ctx), rng: rngOf(ctx), extraDice: 1 });
  if (hitOf(r) && t.hp > 0) { addCondition(t, 'bleeding', r.d20.degree === 3 ? '2d6' : '1d6'); r.events.push({ type: 'condition', target: t, condition: 'bleeding' }); r.log.push(`${t.name} krwawi!`); }
  return r;
});
def('shove', { name: 'Powal', desc: 'Atletyka vs Refleks: cel ląduje na ziemi (kryt. dodatkowo 1k6).', actions: 1, range: 1, fx: 'melee', icon: 'shove' }, (ctx) => {
  const t = first(ctx); if (!t) return noTarget();
  const u = ctx.user, r = R(), rng = rngOf(ctx); r.attack = false;
  const dc = dcOf(t, 'reflex'), c = check(getStat(u, 'athletics'), dc, rng); r.d20 = c;
  const info = `Atletyka k20 ${c.d20}${fmtMod(c.mod)}=${c.total} vs ${dc}`;
  if (c.degree >= 2) { cond(r, t, 'prone', 1, `${u.name} powala ${acc(t)} (${info}).`); if (c.degree === 3) hurt(r, t, roll('1d6', rng).total, 'B'); }
  else if (c.degree === 0) cond(r, u, 'prone', 1, `${u.name} potyka się! (${info}).`);
  else r.log.push(`${u.name} nie zdołał powalić ${acc(t)} (${info}).`);
  return r;
});
def('second_wind', { name: 'Drugi oddech', desc: 'Leczysz siebie: 1k8+Kon+poz. PW.', actions: 1, target: 'self', range: 0, uses: 'encounter', usesMax: 1, fx: 'heal', icon: 'breath' }, (ctx) => {
  const u = ctx.user, r = R(), rng = rngOf(ctx); spend(u, 'second_wind');
  doHeal(r, u, roll('1d8', rng).total + Math.max(0, attrMod(u, 'con')) + u.level + 4, 'Drugi oddech'); return r;
});

// ================= zdolności wrogów
const eAtk = (ctx, i = 0) => (ctx.user.attacks ? ctx.user.attacks[i] : undefined);
def('bite_trip', { name: 'Powalające kły', desc: 'Ugryzienie; trafiony może upaść.', actions: 2, range: 1, fx: 'melee' }, (ctx) => {
  const t = first(ctx); if (!t) return noTarget();
  const u = ctx.user, rng = rngOf(ctx);
  const r = strike(u, t, { weapon: eAtk(ctx), mapIndex: mapOf(ctx), rng });
  if (hitOf(r) && t.hp > 0) { const c = check(getStat(t, 'reflex'), getStat(u, 'classDC'), rng); if (c.degree <= 1) cond(r, t, 'prone', 1, `${t.name} upada!`); }
  return r;
});
def('swarm_cloud', { name: 'Chmura owadów', desc: 'Rój oblepia cele: Wytrzymałość, trucizna i mdłości.', actions: 2, target: 'area', range: 1, radius: 1, fx: 'melee' }, (ctx) => {
  const u = ctx.user, r = R(), rng = rngOf(ctx);
  if (!ctx.targets || !ctx.targets.length) return noTarget();
  for (const t of ctx.targets) { const { c } = basicSave(r, t, 'fortitude', getStat(u, 'classDC'), '1d6+1', 'poison', rng); if (c.degree <= 1) cond(r, t, 'sickened', 1); }
  return r;
});
def('poison_sting', { name: 'Jadowite żądło', desc: 'Atak, po którym Wytrzymałość chroni przed zatruciem.', actions: 2, range: 1, fx: 'melee' }, (ctx) => {
  const t = first(ctx); if (!t) return noTarget();
  const u = ctx.user, rng = rngOf(ctx);
  const r = strike(u, t, { weapon: { name: 'Żądło', bonus: u.attacks[0].bonus, damage: '1d6+3', dmgType: 'P', traits: [] }, mapIndex: mapOf(ctx), rng });
  if (hitOf(r) && t.hp > 0) { const c = check(getStat(t, 'fortitude'), getStat(u, 'classDC'), rng); if (c.degree <= 1) { cond(r, t, 'poisoned', '1d6', `${t.name} zatruty!`); if (c.degree === 0) cond(r, t, 'sickened', 1); } }
  return r;
});
def('quake', { name: 'Wstrząs', desc: 'Uderza w ziemię: Refleks, obrażenia obuchowe i upadek.', actions: 2, target: 'area', range: 0, radius: 2, fx: 'explosion' }, (ctx) => {
  const u = ctx.user, r = R(), rng = rngOf(ctx);
  if (!ctx.targets || !ctx.targets.length) return noTarget();
  for (const t of ctx.targets) { const { c } = basicSave(r, t, 'reflex', getStat(u, 'classDC'), '2d6+3', 'B', rng); if (c.degree <= 1 && t.hp > 0) cond(r, t, 'prone', 1); }
  return r;
});
def('rad_touch', { name: 'Skażający dotyk', desc: 'Atak; po trafieniu możesz zachorować.', actions: 2, range: 1, fx: 'melee' }, (ctx) => {
  const t = first(ctx); if (!t) return noTarget();
  const u = ctx.user, rng = rngOf(ctx);
  const r = strike(u, t, { weapon: eAtk(ctx), mapIndex: mapOf(ctx), rng });
  if (hitOf(r) && t.hp > 0) { const c = check(getStat(t, 'fortitude'), getStat(u, 'classDC'), rng); if (c.degree <= 1) cond(r, t, 'sickened', c.degree === 0 ? 2 : 1, `${t.name} choruje od promieniowania.`); }
  return r;
});
def('frenzy', { name: 'Szał bojowy', desc: 'Wpada w szał: +obrażenia, -1 KP, tymczasowe PW.', actions: 1, target: 'self', range: 0, fx: 'buff' }, (ctx) => {
  const u = ctx.user, r = R();
  if (hasCondition(u, 'raging')) { r.log.push(`${u.name} już szaleje.`); return r; }
  addCondition(u, 'raging', 5); tempHp(r, u, 5 + u.level);
  r.events.push({ type: 'condition', target: u, condition: 'raging' }); r.log.push(`${u.name} wpada w szał!`); return r;
});
def('throw_molotov', { name: 'Rzut koktajlem', desc: 'Płonąca butelka: Refleks, obrażenia ogniowe i podpalenie.', actions: 2, target: 'area', range: 6, radius: 1, uses: 'encounter', usesMax: 2, fx: 'explosion' }, (ctx) => {
  const u = ctx.user, r = R(), rng = rngOf(ctx); spend(u, 'throw_molotov');
  if (!ctx.targets || !ctx.targets.length) return noTarget();
  r.log.push(`${u.name} ciska koktajl Mołotowa!`);
  for (const t of ctx.targets) { const { c } = basicSave(r, t, 'reflex', 16 + Math.floor(u.level / 2), '1d6+2', 'fire', rng); if (c.degree <= 1 && t.hp > 0) cond(r, t, 'burning', '1d4', `${t.name} płonie!`); }
  return r;
});
def('headshot', { name: 'Strzał w głowę', desc: '+2 do trafienia, ignoruje osłonę, dodatkowa kość.', actions: 2, range: 18, fx: 'shot' }, (ctx) => {
  const t = first(ctx); if (!t) return noTarget();
  return strike(ctx.user, t, { weapon: eAtk(ctx), mapIndex: mapOf(ctx), rng: rngOf(ctx), bonus: 2, extraDice: 1, ignoreCover: true });
});
def('chief_rally', { name: 'Zew Herszta', desc: 'Szabrownicy w pobliżu dostają tymczasowe PW i +1 do trafienia.', actions: 1, target: 'area', range: 0, radius: 5, uses: 'encounter', usesMax: 1, fx: 'shout' }, (ctx) => {
  const u = ctx.user, r = R(); spend(u, 'chief_rally');
  r.log.push(`${u.name} ryczy: do roboty, kundle!`);
  for (const t of ctx.targets && ctx.targets.length ? ctx.targets : [u]) { tempHp(r, t, 6); addCondition(t, 'stimmed', 4); }
  return r;
});
def('self_destruct', { name: 'Samozniszczenie', desc: 'Wybuch: Refleks, 2k8 obrażeń. Dron ulega zniszczeniu.', actions: 2, target: 'area', range: 0, radius: 1, fx: 'explosion' }, (ctx) => {
  const u = ctx.user, r = R(), rng = rngOf(ctx);
  r.log.push(`${u.name} wybucha!`);
  for (const t of ctx.targets || []) basicSave(r, t, 'reflex', 16, '2d8', 'P', rng);
  u.hp = 0; u.conditions.dead = 1; r.events.push({ type: 'death', target: u }); return r;
});
def('turret_burst', { name: 'Seria z działka', desc: 'Trzy strzały z rosnącą karą.', actions: 2, range: 12, fx: 'shot' }, (ctx) => {
  const t = first(ctx); if (!t) return noTarget();
  const r = R(); r.attack = true; r.attacks = 3;
  for (let i = 0; i < 3; i++) if (t.hp > 0) merge(r, strike(ctx.user, t, { weapon: eAtk(ctx), mapIndex: mapOf(ctx) + i, rng: rngOf(ctx) }));
  return r;
});
def('rocket_salvo', { name: 'Salwa rakietowa', desc: 'Rakiety w obszarze: Refleks, 3k6+4.', actions: 2, target: 'area', range: 12, radius: 2, uses: 'encounter', usesMax: 2, fx: 'explosion' }, (ctx) => {
  const u = ctx.user, r = R(), rng = rngOf(ctx); spend(u, 'rocket_salvo');
  if (!ctx.targets || !ctx.targets.length) return noTarget();
  r.log.push(`${u.name} odpala salwę rakiet!`);
  for (const t of ctx.targets) basicSave(r, t, 'reflex', getStat(u, 'classDC'), '3d6+4', 'B', rng);
  return r;
});
def('kostucha_cull', { name: 'Żniwa', desc: 'Kosa tnie wszystkich w zasięgu (do 2 celów).', actions: 2, target: 'enemy', range: 1, fx: 'melee' }, (ctx) => {
  const r = R(); r.attack = true;
  const ts = (ctx.targets || []).slice(0, 2); if (!ts.length) return noTarget();
  r.attacks = ts.length;
  r.log.push(`${ctx.user.name} zamaszyście tnie kosą!`);
  for (const t of ts) merge(r, strike(ctx.user, t, { weapon: eAtk(ctx, 0), mapIndex: mapOf(ctx), rng: rngOf(ctx) }));
  return r;
});
def('kostucha_barrage', { name: 'Gradobicie Szczęk', desc: 'Salwa w obszarze: Refleks WT 22, 3k6+2; porażka = dezorientacja.', actions: 2, target: 'area', range: 10, radius: 2, uses: 'encounter', usesMax: 1, fx: 'explosion' }, (ctx) => {
  const u = ctx.user, r = R(), rng = rngOf(ctx); spend(u, 'kostucha_barrage');
  if (!ctx.targets || !ctx.targets.length) return noTarget();
  r.log.push(`${u.name} wzywa gradobicie!`);
  for (const t of ctx.targets) { const { c } = basicSave(r, t, 'reflex', 22, '3d6+2', 'P', rng); if (c.degree <= 1 && t.hp > 0) cond(r, t, 'distracted', 2); }
  return r;
});
def('kostucha_command', { name: 'Rozkaz Kostuchy', desc: 'Sojusznicy zyskują dodatkową akcję i premię do trafienia. Kostucha zyskuje tymczasowe PW.', actions: 1, target: 'area', range: 0, radius: 6, uses: 'encounter', usesMax: 1, fx: 'shout' }, (ctx) => {
  const u = ctx.user, r = R(); spend(u, 'kostucha_command');
  r.log.push(`${u.name}: "Żniwa czas zacząć!"`);
  tempHp(r, u, 15);
  for (const t of (ctx.targets || []).filter((x) => x !== u).slice(0, 3)) { addCondition(t, 'quickened', 1); addCondition(t, 'stimmed', 3); r.log.push(`${t.name} dostaje dodatkową akcję.`); }
  return r;
});

// ================= zasady użycia
export function canUse(u, id) {
  const ab = ABILITIES[id]; if (!ab) return false;
  if (!u.abilities.includes(id)) return false;
  if (ab.uses && (u.uses[id] === undefined || u.uses[id] <= 0)) return false;
  return true;
}
export const usesLeft = (u, id) => (ABILITIES[id] && ABILITIES[id].uses ? u.uses[id] ?? 0 : Infinity);
export function useAbility(id, ctx) {
  const ab = ABILITIES[id];
  if (!ab) throw new Error('Nieznana zdolność: ' + id);
  if (ab.uses && !canUse(ctx.user, id)) { const r = R(); r.log.push(`${ctx.user.name}: brak użyć (${ab.name}).`); return r; }
  return ab.resolve(ctx);
}

// ================= przedmioty jednorazowe
export function findItem(ch, ref) {
  return ch.inventory.find((i) => i === ref || i.uid === ref || i.uid === (ref && ref.uid)) || ch.inventory.find((i) => i.id === ref || (ref && i.id === ref.id));
}
export function useConsumable(user, ref, targets = [], rng = Math.random) {
  const r = R();
  const inst = findItem(user, ref);
  if (!inst) { r.log.push('Brak przedmiotu.'); return r; }
  const def_ = ITEMS[inst.id];
  if (!def_ || !def_.consumable) { r.log.push('Tego nie da się użyć.'); return r; }
  const c = def_.consumable, tg = targets && targets.length ? targets : [user];
  r.log.push(`${user.name} używa: ${def_.name}.`);
  if (c.effect === 'heal') {
    const t = tg[0];
    if (isDead(t)) { r.log.push(`${t.name} nie żyje.`); return r; }
    doHeal(r, t, roll(c.amount, rng).total, def_.name);
    for (const k of c.cures || []) removeCondition(t, k);
  } else if (c.effect === 'cleanse') { for (const t of tg.slice(0, 1)) for (const k of c.cures) removeCondition(t, k); r.log.push('Skutki zatrucia ustępują.'); }
  else if (c.effect === 'damage') {
    for (const t of tg) {
      if (c.only === 'machine' && !isMachine(t)) continue;
      const { c: sc } = basicSave(r, t, c.save || 'reflex', c.dc, c.amount, c.dmgType, rng);
      if (c.condition && sc.degree <= 1 && t.hp > 0) cond(r, t, c.condition.id, c.condition.value);
    }
  } else if (c.effect === 'buff') { for (const t of tg.slice(0, 1)) for (const b of c.buffs) { addCondition(t, b.id, b.value); r.events.push({ type: 'condition', target: t, condition: b.id }); } r.log.push('Środek zaczyna działać.'); }
  else if (c.effect === 'smoke') { for (const t of tg) addCondition(t, 'dodging', 1); r.log.push('Gęsty dym utrudnia celowanie (+2 KP do końca tury).'); }
  inst.qty -= 1; if (inst.qty <= 0) user.inventory.splice(user.inventory.indexOf(inst), 1);
  r.consumed = true; r.attack = false;
  return r;
}
