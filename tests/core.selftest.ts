// Testy logiki src/core (port Oldgame/src/rules/selftest.mjs + mapy, walka taktyczna, AI, kampania).
// Uruchom: node tests/core.selftest.ts   (Node >= 22.18 usuwa typy sam; zero Phasera / DOM)
import {
  ABILITIES, ABILITY_EFFECTS, ANCESTRIES, CLASSES, DEGREE_NAMES, ENEMIES, ITEMS,
  addCondition, addXP, applyDamage, canAct, check, createCharacter, createEnemy, dcForLevel, encounterXP, endTurn, equip,
  getAttackBonus, getStat, heal, isAlive, isDown, longRest, makeRng, newItem, profBonus, removeCondition, roll, rollInitiative,
  skillCheck, startTurn, strike, summarize, useAbility, useConsumable, d,
  generateMap, Mission, runAiTurn, CellKind, MAP_W, MAP_H,
  freshState, generateContracts, applyMissionResult, EVENTS, resolveEventChoice, shopStock, buy, sellPrice, restDay,
} from '../src/core/index.ts';
import { HudState, backpackRows, conditionChips, equipmentRows, hpTone, plural, statPairs } from '../src/core/HudState.ts';
import { itemTargeting, previewStrike } from '../src/core/SkirmishRules.ts';
import type { AbilityDef, AbilityId, Character, ClassId, EnemyId, Contract, Biome } from '../src/core/index.ts';

let fails = 0;
let checks = 0;
const ok = (c: unknown, msg: string): void => {
  checks++;
  if (!c) {
    fails++;
    console.log('FAIL:', msg);
  }
};
const rng0 = makeRng(12345);
const noFn = (o: unknown): boolean => {
  let bad = false;
  JSON.stringify(o, (_k, v) => {
    if (typeof v === 'function') bad = true;
    return v;
  });
  return !bad;
};

// ---- kości
{
  const r = makeRng(1);
  const r2 = makeRng(1);
  ok(r() === r2(), 'seeded rng deterministic');
  let range = true;
  for (let i = 0; i < 1000; i++) {
    const v = d(20, rng0);
    if (v < 1 || v > 20) range = false;
  }
  ok(range, 'd20 range');
  const x = roll('2d6+3', rng0);
  ok(x.total >= 5 && x.total <= 15 && x.rolls.length === 2 && x.mod === 3, 'roll 2d6+3');
  ok(roll('1d4-1', rng0).total >= 0, 'roll 1d4-1');
  ok(roll('5').total === 5, 'roll flat');
  const fx = (n: number) => () => (n - 1) / 20 + 0.001;
  const t = (mod: number, dc: number, nat: number) => check(mod, dc, fx(nat));
  ok(t(5, 15, 10).degree === 2, 'meets DC = success');
  ok(t(4, 15, 10).degree === 1, 'below DC = failure');
  ok(t(15, 15, 10).degree === 3, '+10 = crit success');
  ok(t(-5, 15, 10).degree === 0, '-10 = crit fail');
  ok(t(-10, 15, 20).degree === 2, 'nat20 raises failure to success');
  ok(t(5, 15, 20).degree === 3, 'nat20 raises success to crit');
  ok(t(30, 15, 1).degree === 2, 'nat1 lowers crit to success');
  ok(t(0, 15, 1).degree === 0, 'nat1 lowers fail to crit fail');
  ok(profBonus(0, 5) === 0 && profBonus(1, 1) === 3 && profBonus(2, 3) === 7 && profBonus(4, 10) === 18, 'profBonus');
  ok(dcForLevel(0) === 14 && dcForLevel(1) === 15 && dcForLevel(3) === 18, 'dcForLevel');
  ok(DEGREE_NAMES.length === 4, 'degree names');
}

// ---- treść
ok(Object.keys(CLASSES).length === 12, '12 classes');
ok(Object.keys(ENEMIES).length >= 12, '>=12 enemies');
for (const id of Object.keys(ABILITIES) as AbilityId[]) ok(typeof ABILITY_EFFECTS[id] === 'function', 'effect for ' + id);

// ---- postacie
for (const cid of Object.keys(CLASSES) as ClassId[]) {
  for (const aid of Object.keys(ANCESTRIES)) {
    const c = createCharacter({ name: `T-${cid}-${aid}`, ancestry: aid, classId: cid });
    ok(c.hp === c.maxHp && c.maxHp >= 14 && c.maxHp <= 30, `hp ${cid}/${aid}: ${c.maxHp}`);
    ok(c.equipment.weapon, 'has weapon ' + cid);
    ok(getStat(c, 'ac') >= 11 && getStat(c, 'ac') <= 22, `ac ${cid}/${aid} ${getStat(c, 'ac')}`);
    ok(noFn(c) && JSON.stringify(JSON.parse(JSON.stringify(c))) === JSON.stringify(c), 'json round trip ' + cid);
    ok(c.abilities.includes('strike') && c.abilities.length >= 5, 'abilities list');
    ok(summarize(c).length >= 4, 'summarize');
  }
}
ok(createCharacter({ name: 'X', ancestry: 'nomad-born', classId: 'scout' }).ancestry === 'nomad', 'ancestry alias');
{
  const c = createCharacter({ name: 'Hak', ancestry: 'human', classId: 'soldier' });
  ok(getAttackBonus(c, ITEMS.rifle, 0) - getAttackBonus(c, ITEMS.rifle, 1) === 5, 'MAP -5');
  ok(getAttackBonus(c, ITEMS.rifle, 0) - getAttackBonus(c, ITEMS.rifle, 2) === 10, 'MAP -10');
  ok(getAttackBonus(c, ITEMS.knife, 0) - getAttackBonus(c, ITEMS.knife, 1) === 4, 'agile MAP -4');
  ok(getAttackBonus(c, ITEMS.knife, 0) - getAttackBonus(c, ITEMS.knife, 2) === 8, 'agile MAP -8');
  const ac0 = getStat(c, 'ac');
  addCondition(c, 'off_guard');
  ok(getStat(c, 'ac') === ac0 - 2, 'off_guard -2 AC');
  removeCondition(c, 'off_guard');
  addCondition(c, 'frightened', 2);
  ok(getStat(c, 'ac') === ac0 - 2, 'frightened -2');
  removeCondition(c, 'frightened');
  addCondition(c, 'in_cover');
  ok(getStat(c, 'ac') === ac0 + 2, 'cover +2');
  removeCondition(c, 'in_cover');
  c.equipment.shield = newItem('scrap_shield');
  addCondition(c, 'raised_shield');
  ok(getStat(c, 'ac') === ac0 + 2, 'shield +2');
  removeCondition(c, 'raised_shield');
  c.equipment.shield = null;
  const pa = createCharacter({ name: 'PA', ancestry: 'human', classId: 'soldier' });
  pa.equipment.armor = newItem('power_armor');
  ok(getStat(pa, 'speed') === 4, 'speed penalty power armor');
}
// ekwipunek
{
  const c = createCharacter({ name: 'Eq', ancestry: 'human', classId: 'champion' });
  const stash = [newItem('scrap_shield')];
  c.equipment.shield = null;
  ok(equip(c, 'shield', stash[0], stash, stash).ok && c.equipment.shield, 'equip shield');
  const sh = newItem('sledgehammer');
  const bag = [sh];
  const r = equip(c, 'weapon', sh, bag, stash);
  ok(r.ok && !c.equipment.shield && stash.some((i) => i.id === 'scrap_shield'), 'two-hander drops shield to stash');
  ok(!equip(c, 'shield', stash.find((i) => i.id === 'scrap_shield')!, stash, stash).ok, 'no shield with two-hander');
  ok(!equip(c, 'armor', newItem('knife'), [], stash).ok, 'slot type check');
}
// atak / krytyk / umieranie
{
  const a = createCharacter({ name: 'Atak', ancestry: 'human', classId: 'soldier' });
  let hits = 0;
  const n = 2000;
  for (let i = 0; i < n; i++) {
    const e = createEnemy('raider_thug');
    const r = strike(a, e, { rng: rng0 });
    if (r.events[0].type !== 'miss') hits++;
  }
  ok(hits / n > 0.45 && hits / n < 0.9, 'hit rate sane ' + hits / n);
  const e = createEnemy('raider_thug');
  ok(applyDamage(e, 999).dead && !isAlive(e), 'enemy dies');
  const p = createCharacter({ name: 'P', ancestry: 'human', classId: 'medic' });
  const r2 = applyDamage(p, 999);
  ok(r2.downed && !r2.dead && p.conditions.dying === 1 && p.hp === 0 && isDown(p) && isAlive(p) && !canAct(p), 'PC dying 1');
  heal(p, 5);
  ok(p.hp === 5 && !p.conditions.dying && p.conditions.wounded === 1, 'heal clears dying -> wounded 1');
  applyDamage(p, 999);
  ok(p.conditions.dying === 2, 'wounded raises dying');
  ok(startTurn(p, rng0).actions === 0, 'dying no actions');
  for (let i = 0; i < 30 && p.conditions.dying && !p.conditions.dead; i++) startTurn(p, rng0);
  ok(!p.conditions.dying || p.conditions.dead, 'dying resolves');
  const q = createCharacter({ name: 'Q', ancestry: 'human', classId: 'brute' });
  addCondition(q, 'bleeding', '1d6');
  const hp0 = q.hp;
  const s2 = startTurn(q, rng0);
  ok(q.hp < hp0 && s2.actions === 3, 'bleeding dmg at start');
  addCondition(q, 'stunned', 1);
  ok(startTurn(q, rng0).actions === 2, 'stunned 1 -> 2 actions');
  addCondition(q, 'slowed', 2);
  ok(startTurn(q, rng0).actions === 1, 'slowed 2 -> 1 action');
  addCondition(q, 'frightened', 2);
  endTurn(q);
  ok(q.conditions.frightened === 1, 'frightened decrements');
  const ini = rollInitiative(q, rng0);
  ok(ini.total === ini.d20 + ini.mod, 'initiative');
  ok(skillCheck(q, 'athletics', 15, rng0).dc === 15, 'skillCheck');
  longRest(q);
  ok(q.hp === q.maxHp && Object.keys(q.conditions).length === 0, 'long rest');
  // odporność wroga liczona raz; dane mają wartości efektywne z Oldgame (rój much: resist P 6 = stare 3 odjęte dwa razy)
  const sw = createEnemy('fly_swarm');
  const before = sw.hp;
  applyDamage(sw, 10, 'P');
  ok(before - sw.hp === 4, 'enemy resistance applied once (old effective value)');
  ok(createEnemy('raider_thug', { levelAdj: 1 }).level === 2 && createEnemy('raider_thug', { levelAdj: -1 }).level === 0, 'levelAdj');
}

// ---- wszystkie zdolności
function dummyTargets(user: Character, ab: AbilityDef): Character[] {
  const mk = () => createEnemy('raider_thug');
  const ally = createCharacter({ name: 'Sojusznik', ancestry: 'human', classId: 'soldier' });
  if (ab.target === 'ally') {
    ally.hp = Math.max(1, ally.maxHp - 12);
    return [ally];
  }
  if (ab.target === 'self') return [user];
  if (ab.target === 'area') return ['rally', 'field_clinic', 'chief_rally', 'kostucha_command'].includes(ab.id) ? [ally, user] : [mk(), createEnemy('drone'), mk()];
  return [mk()];
}
const used = new Set<string>();
for (const cid of Object.keys(CLASSES) as ClassId[]) {
  const u = createCharacter({ name: 'Test' + cid, ancestry: 'human', classId: cid, level: 5 });
  for (const id of u.abilities) {
    for (let k = 0; k < 40; k++) {
      longRest(u);
      const targets = dummyTargets(u, ABILITIES[id]);
      try {
        const res = useAbility(id, { user: u, targets, rng: rng0, mapIndex: k % 3 });
        ok(Array.isArray(res.log) && Array.isArray(res.events) && typeof res.attack === 'boolean', `ability ${id} result shape`);
        ok(noFn(u), 'no fn in chars after ' + id);
      } catch (e) {
        ok(false, `ability ${id} threw ${(e as Error).stack}`);
        break;
      }
    }
    used.add(id);
  }
}
for (const eid of Object.keys(ENEMIES) as EnemyId[]) {
  for (const id of createEnemy(eid).abilities) {
    used.add(id);
    for (let k = 0; k < 30; k++) {
      const uu = createEnemy(eid);
      const ab = ABILITIES[id];
      const pcs = [createCharacter({ name: 'A', ancestry: 'human', classId: 'soldier' }), createCharacter({ name: 'B', ancestry: 'mutant', classId: 'medic' })];
      const targets = ab.target === 'self' ? [uu] : id === 'chief_rally' || id === 'kostucha_command' ? [uu, createEnemy('raider_thug')] : ab.target === 'area' ? pcs : [pcs[0]];
      try {
        ok(useAbility(id, { user: uu, targets, rng: rng0, mapIndex: 0 }).log, 'enemy ability ' + id);
      } catch (e) {
        ok(false, `enemy ability ${id} threw ${(e as Error).stack}`);
        break;
      }
    }
  }
}
ok(used.size === Object.keys(ABILITIES).length, 'every ability resolved: missing ' + Object.keys(ABILITIES).filter((a) => !used.has(a)).join(','));
// limit użyć zmniejszany także dla zdolności, które same tego nie robią
{
  const m = createCharacter({ name: 'Szef', ancestry: 'human', classId: 'soldier', level: 5 });
  const left = m.uses.suppressive_fire ?? 0;
  useAbility('suppressive_fire', { user: m, targets: [createEnemy('raider_thug')], rng: rng0 });
  ok(m.uses.suppressive_fire === left - 1, 'uses decrement');
}
// konsumabelki
for (const it of Object.values(ITEMS).filter((i) => i.type === 'consumable')) {
  const u = createCharacter({ name: 'U', ancestry: 'human', classId: 'medic' });
  u.inventory.push(newItem(it.id, 2));
  u.hp = 5;
  const tg = it.type === 'consumable' && it.consumable.target === 'area' ? [createEnemy('drone'), createEnemy('raider_thug')] : [u];
  const count = () => u.inventory.filter((x) => x.id === it.id).reduce((a, x) => a + x.qty, 0);
  const before = count();
  const r = useConsumable(u, it.id, tg, rng0);
  ok(r.consumed && r.log.length, 'consumable ' + it.id);
  ok(count() === before - 1, 'qty decrement ' + it.id);
}

// ---- poziomy
{
  const c = createCharacter({ name: 'Lev', ancestry: 'human', classId: 'soldier' });
  const hp1 = c.maxHp;
  ok(addXP(c, 999) === 0 && c.level === 1, 'no level at 999');
  ok(addXP(c, 1) === 1 && c.level === 2, 'level 2 at 1000');
  ok(addXP(c, 3000) === 3 && c.level === 5, 'levels to 5');
  ok(c.maxHp > hp1 + 30, `hp grows ${hp1}->${c.maxHp}`);
  ok(c.prof.attacks.martial === 3, 'martial at 5');
  ok(c.abilities.includes('rally'), 'unlock rally at 5');
  addXP(c, 20000);
  ok(c.level === 10, 'cap at 10');
  ok(encounterXP(1, [createEnemy('raider_thug'), createEnemy('raider_thug'), createEnemy('rat_mutant')]) === 110, 'encounterXP');
  ok(encounterXP(3, [createEnemy('raider_thug')]) === 20, 'xp -2');
}

// ---- mapy
{
  const biomes: Biome[] = ['ruins', 'wastes', 'industrial', 'bunker'];
  for (const biome of biomes) {
    for (let s = 0; s < 15; s++) {
      const spec = { id: `${biome}-${s}`, biome, level: 3 };
      const ids: EnemyId[] = s % 3 === 0 ? ['kostucha', 'raider_thug', 'raider_gunner', 'raider_sniper', 'raider_psycho'] : ['raider_thug', 'rat_mutant', 'dog_mutant'];
      const m = generateMap(spec, ids);
      ok(m.width === MAP_W && m.height === MAP_H && m.floor.length === MAP_W * MAP_H, 'map size');
      ok(JSON.stringify(generateMap(spec, ids).props) === JSON.stringify(m.props), 'map deterministic ' + spec.id);
      ok(m.entry.cells.every((c) => m.grid.isFree(c.gx, c.gy)), 'entry free ' + spec.id);
      const placed = m.groups.reduce((n, g) => n + g.members.length, 0);
      ok(placed === ids.length, 'all enemies placed ' + spec.id);
      if (ids[0] === 'kostucha') ok(m.groups[m.groups.length - 1].members.includes('kostucha'), 'boss in last group');
      const start = m.entry.cells[5];
      const reachable = (p: { gx: number; gy: number }) => !!m.grid.findPath(start, p, undefined, 999) || (p.gx === start.gx && p.gy === start.gy);
      ok(m.groups.every((g) => g.cells.every((c) => m.grid.isFree(c.gx, c.gy) && reachable(c))), 'enemy cells reachable ' + spec.id);
      ok(m.crates.every((c) => m.grid.kind(c.gx, c.gy) === CellKind.LOW), 'crates block ' + spec.id);
      ok(!m.objCell || reachable(m.objCell), 'objective reachable ' + spec.id);
    }
  }
}

// ---- pełne misje: drużyna i wrogowie sterowani przez AI
function simulateMission(contract: Contract, party: Character[], seed: number): { result: string; rounds: number; turns: number } {
  const rng = makeRng(seed);
  const m = new Mission(contract, party, rng);
  let turns = 0;
  for (let safety = 0; safety < 400 && m.mode !== 'over'; safety++) {
    if (m.mode === 'explore') {
      // idź do najbliższej żywej grupy wrogów / celu / strefy ewakuacji
      const leader = m.pcs.find((p) => p.state === 'up');
      if (!leader) break;
      const foe = m.enemies.find((e) => e.state !== 'dead');
      const goal = m.canExtract()
        ? null
        : m.objectiveDone()
          ? m.map.entry.cells[5]
          : (m.itemThing && !m.itemThing.done ? m.itemThing : m.captive && !m.captive.done ? m.captive : foe) ?? m.map.entry.cells[5];
      if (!goal) {
        m.finish('success');
        break;
      }
      const th = m.things.find((t) => !t.done && t.kind !== 'crate' && Math.max(Math.abs(t.gx - leader.gx), Math.abs(t.gy - leader.gy)) <= 1);
      if (th) {
        m.interact(leader, th);
        continue;
      }
      const r = m.exploreMove(leader, goal);
      if (!r.ok && foe) m.startCombat(foe.group!);
      else if (!r.ok) m.finish('retreat');
      continue;
    }
    if (m.mode === 'combat') {
      const t = m.combat.nextTurn();
      if (!t) continue;
      turns++;
      runAiTurn(m.combat, t.actor);
      if (m.combat.active) m.combat.endTurn();
      if (turns > 600) m.finish('retreat');
    }
  }
  if (m.mode !== 'over') m.finish('retreat');
  return { result: m.result!.result, rounds: m.combat.round, turns };
}
{
  const party = (lvl: number) =>
    (['soldier', 'scout', 'medic', 'brute'] as ClassId[]).map((c, i) => createCharacter({ name: `N${i}`, classId: c, ancestry: 'human', level: lvl }));
  const state = freshState();
  state.party = party(1);
  let wins = 0;
  let n = 0;
  const outcomes: Record<string, number> = {};
  for (let k = 0; k < 6; k++) {
    for (const c of generateContracts(state, makeRng(100 + k))) {
      const r = simulateMission(c, party(c.level), 1000 + n);
      outcomes[`${c.type}:${r.result}`] = (outcomes[`${c.type}:${r.result}`] ?? 0) + 1;
      if (r.result === 'success') wins++;
      n++;
    }
  }
  console.log(`missions: ${n}, success ${((wins / n) * 100).toFixed(0)}%`, outcomes);
  ok(n > 20, 'simulated missions');
  ok(wins / n > 0.3, 'AI party completes a reasonable share of missions');
}

// ---- kampania
{
  const st = freshState();
  st.party = (['soldier', 'medic', 'scout', 'techie'] as ClassId[]).map((c, i) => createCharacter({ name: `K${i}`, classId: c }));
  st.contracts = generateContracts(st, makeRng(5));
  ok(st.contracts.length >= 4 && st.contracts.every((c) => c.enemies.length >= 2), 'contract board');
  const c = st.contracts[0];
  const scrap0 = st.scrap;
  const sum = applyMissionResult(st, { contractId: c.id, result: 'success', xp: 120, loot: [newItem('bandage', 2)], scrap: 25, casualties: [] });
  ok(sum.scrap === 25 + c.reward.scrap && st.scrap === scrap0 + sum.scrap, 'debrief scrap');
  ok(st.completed.includes(c.id) && !st.contracts.some((k) => k.id === c.id), 'debrief progress');
  ok(st.stash.some((i) => i.id === 'bandage'), 'debrief loot to stash');
  const ev = EVENTS[0];
  const res = resolveEventChoice(st, { level: 1 }, ev.choices[0], makeRng(9));
  ok(res.outcome.text.length > 0, 'travel event resolves');
  const stock = shopStock(st, 1);
  ok(stock.length > 5 && JSON.stringify(stock) === JSON.stringify(shopStock(st, 1)), 'shop stock deterministic');
  st.scrap = 1000;
  ok(buy(st, 'stimpak').ok && st.stash.some((i) => i.id === 'stimpak'), 'buy');
  ok(sellPrice('scrap_metal', st) >= 1, 'sell price');
  const day = st.day;
  restDay(st);
  ok(st.day === day + 1, 'rest day');
}

// ---------- HUD (HudState + SkirmishRules)
{
  const hud = new HudState();
  const pc = createCharacter({ name: 'Kruk', classId: 'soldier' });
  const foe = createEnemy('raider_thug');
  hud.party = [pc];
  const seen: string[] = [];
  const off = hud.on((c) => seen.push(c));
  hud.setAp(3);
  hud.pushLog('test', 'bad');
  ok(hud.ap === 3 && seen.includes('stats') && seen.includes('log') && hud.log[0].tone === 'bad', 'hud notifies');
  off();
  for (let i = 0; i < 400; i++) hud.pushLog('x' + i);
  ok(hud.log.length === 300 && hud.log[299].text === 'x399', 'hud log capped');
  const cmds: string[] = [];
  hud.onCommand((c) => cmds.push(c.kind));
  hud.command({ kind: 'endTurn' });
  ok(cmds[0] === 'endTurn' && hud.canAct, 'hud command + canAct');
  ok(plural(1, 'a', 'b', 'c') === 'a' && plural(3, 'a', 'b', 'c') === 'b' && plural(12, 'a', 'b', 'c') === 'c' && plural(22, 'a', 'b', 'c') === 'b', 'plural pl');
  ok(equipmentRows(pc).some((r) => r.name === 'Karabin') && backpackRows(pc).some((r) => r.usable), 'inventory rows');
  ok(statPairs(pc)[0][1] === `${pc.hp}/${pc.maxHp}` && hpTone(pc) === 'good', 'stat pairs');
  addCondition(pc, 'frightened', 2);
  ok(conditionChips(pc).some((c) => c.label === 'PRZ2' && c.bad), 'condition chips');
  const stim = pc.inventory.find((i) => i.id === 'stimpak');
  const frag = pc.inventory.find((i) => i.id === 'frag_grenade');
  ok(!!stim && itemTargeting(stim) === 'self' && !!frag && itemTargeting(frag) === 'foe', 'item targeting');
  const near = previewStrike(pc, foe, { gx: 0, gy: 0 }, { gx: 5, gy: 0 }, 0, true);
  const blind = previewStrike(pc, foe, { gx: 0, gy: 0 }, { gx: 5, gy: 0 }, 0, false);
  const map2 = previewStrike(pc, foe, { gx: 0, gy: 0 }, { gx: 5, gy: 0 }, 1, true);
  ok(near.ok && near.hit > 0 && near.hit <= 1 && !blind.ok && map2.mod === near.mod - 5, 'strike preview');
}

console.log(`\n${checks} checks, ${fails} failures`);
process.exit(fails ? 1 : 0);
