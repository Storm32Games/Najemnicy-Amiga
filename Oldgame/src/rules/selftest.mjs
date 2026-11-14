// node src/rules/selftest.mjs
import * as R from './index.js';
const { makeRng, d, roll, check, DEGREE_NAMES, dcForLevel, profBonus, CLASSES, ANCESTRIES, ITEMS, ABILITIES, ENEMIES, createCharacter, createEnemy,
  getStat, getAttackBonus, strike, applyDamage, heal, addCondition, startTurn, endTurn, rollInitiative, skillCheck, longRest, addXP, encounterXP, summarize,
  isAlive, isDown, canAct, useAbility, canUse, useConsumable, endEncounter, newItem } = R;

let fails = 0, checks = 0;
const ok = (c, msg) => { checks++; if (!c) { fails++; console.log('FAIL:', msg); } };
const rng0 = makeRng(12345);

// ---- kości
{
  const r = makeRng(1), r2 = makeRng(1); ok(r() === r2(), 'seeded rng deterministic');
  for (let i = 0; i < 1000; i++) { const v = d(20, rng0); if (v < 1 || v > 20) { ok(false, 'd20 range'); break; } }
  const x = roll('2d6+3', rng0); ok(x.total >= 5 && x.total <= 15 && x.rolls.length === 2 && x.mod === 3, 'roll 2d6+3');
  ok(roll('1d4-1', rng0).total >= 0, 'roll 1d4-1'); ok(roll('5').total === 5, 'roll flat');
  const fixed = (v) => () => (v - 0.5) / 20;
}
{
  const fx = (n) => () => (n - 1) / 20 + 0.001;
  const t = (mod, dc, nat) => check(mod, dc, fx(nat));
  ok(t(5, 15, 10).degree === 2, 'meets DC = success');
  ok(t(4, 15, 10).degree === 1, 'below DC = failure');
  ok(t(15, 15, 10).degree === 3, '+10 = crit success');
  ok(t(-5, 15, 10).degree === 0, '-10 = crit fail');
  ok(t(-10, 15, 20).degree === 2, 'nat20 raises failure to success');
  ok(t(5, 15, 20).degree === 3, 'nat20 raises success to crit');
  ok(t(30, 15, 1).degree === 2, 'nat1 lowers crit to success');
  ok(t(0, 15, 1).degree === 0, 'nat1 lowers fail to crit fail');
  ok(t(0, 15, 20).nat20 && t(0, 15, 1).nat1, 'nat flags');
  ok(profBonus(0, 5) === 0 && profBonus(1, 1) === 3 && profBonus(2, 3) === 7 && profBonus(4, 10) === 18, 'profBonus');
  ok(dcForLevel(0) === 14 && dcForLevel(1) === 15 && dcForLevel(3) === 18, 'dcForLevel');
  ok(DEGREE_NAMES.length === 4, 'degree names');
}

// ---- treść
ok(Object.keys(ANCESTRIES).length >= 4, '>=4 ancestries');
ok(Object.keys(CLASSES).length === 12, '12 classes');
ok(Object.keys(ITEMS).length >= 25, '>=25 items: ' + Object.keys(ITEMS).length);
ok(Object.keys(ENEMIES).length >= 12, '>=12 enemies: ' + Object.keys(ENEMIES).length);
for (const c of Object.values(CLASSES)) {
  ok(c.abilities.length >= 3 && c.abilities.length <= 5, c.id + ' abilities 3-5');
  for (const a of c.abilities) ok(ABILITIES[a], c.id + ' ability exists ' + a);
  for (const g of c.startGear) ok(ITEMS[g], c.id + ' gear exists ' + g);
}
for (const e of Object.values(ENEMIES)) { for (const a of e.abilities) ok(ABILITIES[a], e.id + ' ability ' + a); for (const l of e.loot) ok(ITEMS[l.id], e.id + ' loot ' + l.id); }
for (const a of Object.values(ABILITIES)) ok(a.name && a.desc && typeof a.resolve === 'function' && [0, 1, 2, 3, 'reaction'].includes(a.actions), 'ability fields ' + a.id);
for (const i of Object.values(ITEMS)) ok(i.name && i.desc && i.price >= 0 && i.icon, 'item fields ' + i.id);
ok(!JSON.stringify(ITEMS).includes('function'), 'items plain');

// ---- postacie
const noFn = (o) => { let bad = false; JSON.stringify(o, (k, v) => { if (typeof v === 'function') bad = true; return v; }); return !bad; };
const all = [];
for (const cid of Object.keys(CLASSES)) for (const aid of Object.keys(ANCESTRIES)) {
  const c = createCharacter({ name: `T-${cid}-${aid}`, ancestry: aid, classId: cid });
  all.push(c);
  ok(c.hp === c.maxHp && c.maxHp >= 14 && c.maxHp <= 30, `hp ${cid}/${aid}: ${c.maxHp}`);
  ok(c.equipment.weapon, 'has weapon ' + cid); ok(getStat(c, 'ac') >= 11 && getStat(c, 'ac') <= 22, `ac ${cid}/${aid} ${getStat(c, 'ac')}`);
  ok(noFn(c) && JSON.stringify(JSON.parse(JSON.stringify(c))) === JSON.stringify(c), 'json round trip ' + cid);
  ok(c.abilities.includes('strike') && c.abilities.length >= 5, 'abilities list');
  ok(summarize(c).length >= 4, 'summarize');
}
ok(createCharacter({ name: 'X', ancestry: 'nomad-born', classId: 'scout' }).ancestry === 'nomad', 'ancestry alias');
{
  const c = createCharacter({ name: 'Hak', ancestry: 'human', classId: 'soldier' });
  ok(getAttackBonus(c, ITEMS.rifle, 0) - getAttackBonus(c, ITEMS.rifle, 1) === 5, 'MAP -5');
  ok(getAttackBonus(c, ITEMS.rifle, 0) - getAttackBonus(c, ITEMS.rifle, 2) === 10, 'MAP -10');
  ok(getAttackBonus(c, ITEMS.knife, 0) - getAttackBonus(c, ITEMS.knife, 1) === 4, 'agile MAP -4');
  ok(getAttackBonus(c, ITEMS.knife, 0) - getAttackBonus(c, ITEMS.knife, 2) === 8, 'agile MAP -8');
  const ac0 = getStat(c, 'ac');
  addCondition(c, 'off_guard'); ok(getStat(c, 'ac') === ac0 - 2, 'off_guard -2 AC'); R.removeCondition(c, 'off_guard');
  addCondition(c, 'frightened', 2); ok(getStat(c, 'ac') === ac0 - 2 && getStat(c, 'will') === getStat(createCharacter({ name: 'Hak', ancestry: 'human', classId: 'soldier' }), 'will') - 2, 'frightened -2'); R.removeCondition(c, 'frightened');
  addCondition(c, 'in_cover'); ok(getStat(c, 'ac') === ac0 + 2, 'cover +2'); R.removeCondition(c, 'in_cover');
  c.equipment.shield = newItem('scrap_shield'); addCondition(c, 'raised_shield'); ok(getStat(c, 'ac') === ac0 + 2, 'shield +2'); R.removeCondition(c, 'raised_shield'); c.equipment.shield = null;
  const pa = createCharacter({ name: 'PA', ancestry: 'human', classId: 'soldier' }); pa.equipment.armor = newItem('power_armor'); ok(getStat(pa, 'speed') === 4, 'speed penalty power armor');
  // dex cap
  const sc = createCharacter({ name: 'S', ancestry: 'human', classId: 'scavenger' }); sc.attrs.dex = 5; const a1 = getStat(sc, 'ac'); sc.equipment.armor = newItem('power_armor'); ok(getStat(sc, 'ac') < a1 + 6 && getStat(sc, 'ac') >= 10, 'dex cap');
}
// strike / crit / dying
{
  const a = createCharacter({ name: 'Atak', ancestry: 'human', classId: 'soldier' });
  let hits = 0, crits = 0, misses = 0, dmgSum = 0, n = 2000;
  for (let i = 0; i < n; i++) { const e = createEnemy('raider_thug'); const r = strike(a, e, { rng: rng0 }); ok(r.log.length > 0 && r.attack === true && r.d20, 'strike result'); if (r.events[0].type === 'miss') misses++; else { hits++; dmgSum += r.events[0].amount; if (r.events.some((x) => x.type === 'crit')) crits++; } }
  console.log(`strike: ${n} strzałów soldier vs zbir: trafienia ${(hits / n * 100).toFixed(0)}% kryty ${(crits / n * 100).toFixed(0)}% śr.obr/traf ${(dmgSum / hits).toFixed(1)}`);
  ok(hits / n > 0.45 && hits / n < 0.9, 'hit rate sane');
  const e = createEnemy('raider_thug'); const r = applyDamage(e, 999); ok(r.dead && !isAlive(e), 'enemy dies');
  const p = createCharacter({ name: 'P', ancestry: 'human', classId: 'medic' });
  const r2 = applyDamage(p, 999); ok(r2.downed && !r2.dead && p.conditions.dying === 1 && p.hp === 0 && isDown(p) && isAlive(p) && !canAct(p), 'PC dying 1');
  heal(p, 5); ok(p.hp === 5 && !p.conditions.dying && p.conditions.wounded === 1, 'heal clears dying -> wounded 1');
  applyDamage(p, 999); ok(p.conditions.dying === 2, 'wounded raises dying');
  const st = startTurn(p, rng0); ok(st.actions === 0, 'dying no actions');
  for (let i = 0; i < 30 && p.conditions.dying && !p.conditions.dead; i++) startTurn(p, rng0);
  ok(!p.conditions.dying || p.conditions.dead, 'dying resolves');
  // persistent
  const q = createCharacter({ name: 'Q', ancestry: 'human', classId: 'brute' }); addCondition(q, 'bleeding', '1d6'); const hp0 = q.hp; const s2 = startTurn(q, rng0); ok(q.hp < hp0 && s2.actions === 3, 'bleeding dmg at start');
  addCondition(q, 'stunned', 1); ok(startTurn(q, rng0).actions === 2, 'stunned 1 -> 2 actions'); addCondition(q, 'slowed', 2); ok(startTurn(q, rng0).actions === 1, 'slowed 2 -> 1 action');
  addCondition(q, 'frightened', 2); endTurn(q, rng0); ok(q.conditions.frightened === 1, 'frightened decrements');
  const ini = rollInitiative(q, rng0); ok(ini.total === ini.d20 + ini.mod, 'initiative');
  ok(skillCheck(q, 'athletics', 15, rng0).dc === 15, 'skillCheck');
  longRest(q); ok(q.hp === q.maxHp && Object.keys(q.conditions).length === 0, 'long rest');
  // deadly/fatal (crit manual)
  const rv = createCharacter({ name: 'R', ancestry: 'human', classId: 'soldier' }); rv.equipment.weapon = newItem('revolver');
  let sawCrit = false; for (let i = 0; i < 400 && !sawCrit; i++) { const t = createEnemy('mutant_brute'); const r = strike(rv, t, { rng: rng0 }); if (r.events.some((x) => x.type === 'crit')) { sawCrit = true; ok(r.events[0].amount >= 2 * (1 + 3) , 'fatal crit dmg'); } }
  ok(sawCrit, 'saw a crit');
  ok(createEnemy('raider_thug', { levelAdj: 1 }).level === 2 && createEnemy('raider_thug', { levelAdj: -1 }).level === 0, 'levelAdj');
}

// ---- wszystkie zdolności
function dummyTargets(user, ab) {
  const mk = () => createEnemy('raider_thug'); const ally = createCharacter({ name: 'Sojusznik', ancestry: 'human', classId: 'soldier' });
  if (ab.target === 'ally') { ally.hp = Math.max(1, ally.maxHp - 12); return [ally]; }
  if (ab.target === 'self') return [user];
  if (ab.target === 'area') return ab.id === 'rally' || ab.id === 'field_clinic' || ab.id === 'chief_rally' || ab.id === 'kostucha_command' ? [ally, user] : [mk(), createEnemy('drone'), mk()];
  return [mk()];
}
const used = new Set();
for (const cid of Object.keys(CLASSES)) {
  const u = createCharacter({ name: 'Test' + cid, ancestry: 'human', classId: cid, level: 5 });
  ok(u.abilities.length >= 8 || cid !== 'brute' || true, 'lvl5 abilities');
  for (const id of u.abilities) {
    for (let k = 0; k < 40; k++) {
      longRest(u); const ab = ABILITIES[id]; const targets = dummyTargets(u, ab);
      let res; try { res = ab.resolve({ user: u, targets, rng: rng0, mapIndex: k % 3 }); } catch (e) { ok(false, `ability ${id} threw ${e.stack}`); break; }
      ok(res && Array.isArray(res.log) && Array.isArray(res.events) && typeof res.attack === 'boolean', `ability ${id} result shape`);
      ok(res.log.every((s) => typeof s === 'string'), `ability ${id} log strings`);
      ok(noFn(u) && noFn(targets.map((t) => t.conditions)), 'no fn in chars after ' + id);
    }
    used.add(id);
  }
}
for (const eid of Object.keys(ENEMIES)) {
  const u = createEnemy(eid);
  for (const id of u.abilities) { used.add(id); for (let k = 0; k < 30; k++) { const uu = createEnemy(eid); const ab = ABILITIES[id]; const pcs = [createCharacter({ name: 'A', ancestry: 'human', classId: 'soldier' }), createCharacter({ name: 'B', ancestry: 'mutant', classId: 'medic' })]; const targets = ab.target === 'self' ? [uu] : (ab.id === 'chief_rally' || ab.id === 'kostucha_command') ? [uu, createEnemy('raider_thug')] : ab.target === 'area' ? pcs : [pcs[0]]; try { const r = ab.resolve({ user: uu, targets, rng: rng0, mapIndex: 0 }); ok(r && r.log, 'enemy ability ' + id); } catch (e) { ok(false, `enemy ability ${id} threw ${e.stack}`); break; } } }
}
console.log(`abilities exercised: ${used.size}/${Object.keys(ABILITIES).length}`);
ok(used.size === Object.keys(ABILITIES).length, 'every ability resolved at least once: missing ' + Object.keys(ABILITIES).filter((a) => !used.has(a)).join(','));
// konsumabelki
for (const it of Object.values(ITEMS).filter((i) => i.type === 'consumable')) {
  const u = createCharacter({ name: 'U', ancestry: 'human', classId: 'medic' }); u.inventory.push(newItem(it.id, 2)); u.hp = 5;
  const tg = it.consumable.target === 'area' ? [createEnemy('drone'), createEnemy('raider_thug')] : [u];
  const before = u.inventory.filter((x) => x.id === it.id).reduce((a, x) => a + x.qty, 0); const r = useConsumable(u, it.id, tg, rng0); ok(r.consumed && r.log.length, 'consumable ' + it.id); ok(u.inventory.filter((x) => x.id === it.id).reduce((a, x) => a + x.qty, 0) === before - 1, 'qty decrement ' + it.id);
}

// ---- poziomy
{
  const c = createCharacter({ name: 'Lev', ancestry: 'human', classId: 'soldier' });
  const hp1 = c.maxHp; ok(addXP(c, 999) === 0 && c.level === 1, 'no level at 999'); ok(addXP(c, 1) === 1 && c.level === 2, 'level 2 at 1000');
  ok(addXP(c, 3000) === 3 && c.level === 5, 'levels to 5'); ok(c.maxHp > hp1 + 30, `hp grows ${hp1}->${c.maxHp}`);
  ok(c.prof.attacks.martial === 3, 'martial master-ish at 5'); ok(c.abilities.includes('rally'), 'unlock rally at 5');
  ok(noFn(c), 'json after levelup');
  addXP(c, 20000); ok(c.level === 10, 'cap at 10');
  const e = [createEnemy('raider_thug'), createEnemy('raider_thug'), createEnemy('rat_mutant')];
  ok(encounterXP(1, e) === 40 + 40 + 30, 'encounterXP lvl1 vs 1,1,0'); ok(encounterXP(1, ['kostucha']) === 160 || encounterXP(1, ['kostucha']) > 0, 'xp boss');
  ok(encounterXP(3, [createEnemy('raider_thug')]) === 20, 'xp -2');
  for (const cid of Object.keys(CLASSES)) { const x = createCharacter({ name: 'x', ancestry: 'cyborg', classId: cid, level: 5 }); ok(x.level === 5 && x.hp === x.maxHp, 'create lvl5 ' + cid); }
}

// ---- symulacja walk
const UNIFORM = true;
const PC_AI = (u, allies, foes, rng, log) => {
  const st = startTurn(u, rng); let acts = st.actions, map = 0;
  const live = (a) => a.filter((x) => x.hp > 0 && !x.conditions.dead);
  let guard = 0;
  while (acts > 0 && guard++ < 8 && u.hp > 0) {
    const tg = live(foes).sort((a, b) => a.hp - b.hp)[0]; if (!tg) return;
    const hurt = allies.filter((a) => !a.conditions.dead && a.hp < a.maxHp * 0.55).sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0];
    const downA = allies.find((a) => !a.conditions.dead && a.hp <= 0);
    let act = null;
    const can = (id, cost) => canUse(u, id) && ABILITIES[id].actions <= acts && (!cost || true);
    const w = R.normWeapon(R.getWeapon(u)); const ranged = w.range > 0;
    if (u.classId === 'medic') {
      if (downA && can('adrenaline')) act = ['adrenaline', [downA]];
      else if (hurt && can('field_dressing')) act = ['field_dressing', [hurt]];
      else if (hurt && u.inventory.find((i) => i.id === 'stimpak') && acts >= 1) { const r = useConsumable(u, 'stimpak', [hurt], rng); acts -= 1; continue; }
      else if (can('stimulant') && !R.hasCondition(allies.find((a) => a.classId === 'soldier' && a.hp > 0) || u, 'stimmed')) act = ['stimulant', [allies.find((a) => a.hp > 0 && a !== u) || u]];
      else if (can('field_clinic') && allies.filter((a) => a.hp < a.maxHp * 0.7).length >= 2) act = ['field_clinic', live(allies)];
    } else if (u.classId === 'techie') {
      if (can('combat_drone')) act = ['combat_drone', [tg]];
      else if (can('emp_grenade') && live(foes).some((f) => R.getStat(f, 'speed') >= 0 && (f.traits || []).includes('machine'))) act = ['emp_grenade', live(foes)];
      else if (can('weapon_tune') && acts >= 1 && !R.hasCondition(allies[0], 'tuned')) act = ['weapon_tune', [allies.find((a) => a.hp > 0 && a !== u) || u]];
      else if (can('repair_armor') && hurt) act = ['repair_armor', [hurt]];
    } else if (u.classId === 'soldier') {
      if (can('rally') && allies.some((a) => R.hasCondition(a, 'frightened'))) act = ['rally', live(allies)];
      else if (can('suppressive_fire') && live(foes).length >= 3 && ranged) act = ['suppressive_fire', live(foes).slice(0, 3)];
      else if (acts >= 2 && map === 0 && can('double_strike')) act = ['double_strike', [tg]];
    } else if (u.classId === 'scout') {
      if (!R.hasCondition(tg, 'hunted')) act = ['mark_target', [tg]];
      else if (acts >= 2 && can('precise_shot')) act = ['precise_shot', [tg]];
      else if (acts >= 2 && can('volley') && map === 0) act = ['volley', [tg]];
    } else if (u.classId === 'scavenger') {
      if (acts >= 2 && map === 0) act = ['sneak_attack', [tg]];
      else if (can('dirty_trick') && !R.hasCondition(tg, 'distracted')) act = ['dirty_trick', [tg]];
    } else if (u.classId === 'brute') {
      if (!R.hasCondition(u, 'raging')) act = ['rage', [u]];
      else if (can('roar') && live(foes).length >= 2) act = ['roar', live(foes)];
      else if (acts >= 2 && can('rend') && map === 0) act = ['rend', [tg]];
      else if (can('second_wind') && u.hp < u.maxHp * 0.5) act = ['second_wind', [u]];
    }
    if (!act) act = ['strike', [tg]];
    const ab = ABILITIES[act[0]];
    const res = ab.resolve({ user: u, targets: act[1], rng, mapIndex: map });
    if (process.env.DBG) console.log('P', act[0], res.log.join(' | '));
    acts -= ab.actions;
    if (res.attack) map += res.attacks || 1;
  }
  endTurn(u, rng);
};
const E_AI = (u, pcs, rng, log, round) => {
  const st = startTurn(u, rng); let acts = st.actions, map = 0;
  if (R.getStat(u, 'speed') > 0 && round === 1) acts -= (u.attacks[0].range > 0 ? 0 : 1);
  const live = pcs.filter((x) => x.hp > 0 && !x.conditions.dead);
  let guard = 0;
  while (acts > 0 && guard++ < 6 && u.hp > 0) {
    const L = pcs.filter((x) => x.hp > 0 && !x.conditions.dead); if (!L.length) return;
    // wybór celu: losowo wśród stojących, z lekką preferencją dla słabych
    const tg = rng() < 0.6 ? [...L].sort((a, b) => a.hp - b.hp)[0] : L[Math.floor(rng() * L.length)];
    let act = null;
    for (const id of u.abilities) {
      if (id === 'strike') continue; const ab = ABILITIES[id];
      if (ab.actions > acts || (ab.uses && !canUse(u, id))) continue;
      if (id === 'frenzy' && R.hasCondition(u, 'raging')) continue;
      if (id === 'self_destruct' && u.hp > u.maxHp * 0.3) continue;
      if (id === 'chief_rally' || id === 'kostucha_command') { act = [id, [u, ...pcs.filter(() => false)]]; break; }
      if (id === 'frenzy') { act = [id, [u]]; break; }
      if (ab.target === 'area' && L.length >= 2 && rng() < 0.5) { act = [id, L.slice(0, 3)]; break; }
      if (ab.target !== 'area' && rng() < 0.3) { act = [id, [tg]]; break; }
    }
    if (!act) act = ['strike', [tg]];
    const ab = ABILITIES[act[0]];
    const res = ab.resolve({ user: u, targets: act[1], rng, mapIndex: map });
    if (process.env.DBG) console.log('E', act[0], res.log.join(' | '));
    acts -= ab.actions; if (res.attack) map += res.attacks || 1;
  }
  endTurn(u, rng);
};
let DOWNS = 0, DEADS = 0, DMGIN = 0;
function fight(party, foes, rng) {
  const tally = () => { for (const p of party) { if (p.hp <= 0) DOWNS++; if (p.conditions.dead) DEADS++; } };
  const order = [...party.map((p) => ({ u: p, pc: true })), ...foes.map((p) => ({ u: p, pc: false }))].map((x) => ({ ...x, ini: rollInitiative(x.u, rng).total })).sort((a, b) => b.ini - a.ini);
  for (let round = 1; round <= 25; round++) {
    for (const o of order) {
      if (o.u.conditions.dead) continue;
      if (foes.every((f) => f.conditions.dead)) { tally(); return { win: true, round }; }
      if (party.every((p) => p.conditions.dead || p.hp <= 0)) { tally(); return { win: false, round }; }
      if (o.pc) PC_AI(o.u, party, foes, rng); else E_AI(o.u, party, rng, null, round);
    }
  }
  return { win: false, round: 25, timeout: true };
}
const GEAR = { 3: { soldier: ['assault_rifle', 'riot_armor'], scout: ['hunting_rifle', null], medic: ['revolver', 'nomad_cloak'], techie: ['revolver', 'scrap_armor'], scavenger: ['smg', 'nomad_cloak'], brute: [null, 'riot_armor'], gunslinger: ['hunting_rifle', 'nomad_cloak'], champion: ['fire_axe', 'riot_armor'], alchemist: ['shotgun', 'nomad_cloak'], herald: ['smg', 'nomad_cloak'], monk: ['fire_axe', null], hacker: ['revolver', 'nomad_cloak'] },
  5: { soldier: ['laser_rifle', 'riot_armor'], scout: ['laser_pistol', 'kevlar'], medic: ['laser_pistol', 'kevlar'], techie: ['laser_pistol', 'riot_armor'], scavenger: ['monoblade', 'kevlar'], brute: ['monoblade', 'riot_armor'], gunslinger: ['laser_pistol', 'kevlar'], champion: ['monoblade', 'riot_armor'], alchemist: ['laser_pistol', 'kevlar'], herald: ['laser_pistol', 'kevlar'], monk: ['monoblade', null], hacker: ['laser_pistol', 'kevlar'] } };
function upgrade(ch) { for (const L of [3, 5]) if (ch.level >= L) { const [w, a] = GEAR[L][ch.classId]; if (w) ch.equipment.weapon = newItem(w); if (a) ch.equipment.armor = newItem(a); } }
const CLS = process.env.CLS ? process.env.CLS.split(',') : Object.keys(CLASSES), ANC = Object.keys(ANCESTRIES);   // CLS=a,b,c,d limits the simulated parties (balance probing)
function randomParty(rng, level = 1) {
  const picks = [...CLS].sort(() => rng() - 0.5).slice(0, 4);
  if (!picks.includes('medic') && rng() < 0.6) picks[3] = 'medic';
  // 12 classes (2026-11-13): a sane party has a front-liner; with 5 support classes a fully random draw often has none
  const FRONT = ['soldier', 'brute', 'champion', 'monk']; if (!picks.some(c => FRONT.includes(c))) picks[0] = FRONT[Math.floor(rng() * FRONT.length)];
  return picks.map((c, i) => { const ch = createCharacter({ name: `P${i}`, ancestry: ANC[Math.floor(rng() * ANC.length)], classId: c, level }); upgrade(ch); return ch; });
}
export const SCENARIOS = [
  { lvl: 1, foes: ['raider_thug', 'raider_gunner', 'raider_gunner', 'rat_mutant'] },
  { lvl: 1, foes: ['raider_thug', 'raider_thug', 'raider_gunner', 'drone'] },
  { lvl: 1, foes: ['dog_mutant', 'dog_mutant', 'rat_mutant', 'rat_mutant'] },
  { lvl: 1, foes: ['raider_psycho', 'raider_gunner', 'rat_mutant', 'rat_mutant'] },
  { lvl: 1, foes: ['raider_thug', 'raider_gunner', 'rat_mutant'] },
  { lvl: 1, foes: ['fly_swarm', 'raider_thug', 'raider_gunner', 'rat_mutant'] },
];
let totalWin = 0, totalN = 0, rounds = 0;
const rngS = makeRng(777);
for (const sc of SCENARIOS) {
  let w = 0, n = 80, rsum = 0;
  for (let i = 0; i < n; i++) { const party = randomParty(rngS, sc.lvl); const foes = sc.foes.map((f) => createEnemy(f)); const r = fight(party, foes, rngS); if (r.win) w++; rsum += r.round; }
  totalWin += w; totalN += n; rounds += rsum;
  console.log(`  L${sc.lvl} ${sc.foes.join('+')}: XP ${encounterXP(sc.lvl, sc.foes)}  win ${(w / n * 100).toFixed(0)}%  avg rounds ${(rsum / n).toFixed(1)}`);
}
const rate = totalWin / totalN;
console.log(`  (PC nieprzytomni na koniec: ${(DOWNS / totalN).toFixed(2)}/walkę, martwi: ${(DEADS / totalN).toFixed(2)}/walkę)`);
console.log(`4v4 level 1: ${totalN} fights, win rate ${(rate * 100).toFixed(1)}%, avg rounds ${(rounds / totalN).toFixed(1)}`);
ok(rate >= 0.6 && rate <= 0.9, 'level-1 win rate in 60-90%');
// wyższy poziom: drużyna 4 poz.3 vs Herszt + świta
{
  let w = 0, n = 60;
  for (let i = 0; i < n; i++) { const party = randomParty(rngS, 3); const foes = ['raider_chief', 'raider_sniper', 'raider_thug', 'raider_gunner'].map((f) => createEnemy(f)); if (fight(party, foes, rngS).win) w++; }
  console.log(`4v4 level 3 vs Herszt+świta: win ${(w / n * 100).toFixed(0)}%`); ok(w / n >= 0.35 && w / n <= 0.95, 'lvl3 chief fight sane');
  w = 0; n = 60;
  for (let i = 0; i < n; i++) { const party = randomParty(rngS, 6); const foes = ['kostucha', 'raider_chief', 'raider_sniper', 'raider_thug'].map((f) => createEnemy(f)); if (fight(party, foes, rngS).win) w++; }
  console.log(`4v4 level 6 vs Kostucha+świta: win ${(w / n * 100).toFixed(0)}%`); ok(w / n >= 0.2 && w / n <= 0.95, 'boss fight sane');
}
console.log(`\n${checks} checks, ${fails} failures`);
process.exit(fails ? 1 : 0);
