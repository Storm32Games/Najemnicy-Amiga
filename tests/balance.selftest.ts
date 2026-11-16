// Port brakujących części Oldgame/src/rules/selftest.mjs: kontrola treści, drobne mechaniki i symulacja balansu walk 4v4.
// Uruchom: node tests/balance.selftest.ts   (zero Phasera / DOM; ten sam seed co w Oldgame -> te same wyniki)
/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  ABILITIES, ABILITY_EFFECTS, ANCESTRIES, CLASSES, ENEMIES, ITEMS,
  addCondition, canUse, check, createCharacter, createEnemy, encounterXP, endTurn, getStat, getWeapon, hasCondition, makeRng, newItem,
  normWeapon, rollInitiative, startTurn, strike, useConsumable,
} from '../src/core/index.ts';

let fails = 0;
let checks = 0;
const ok = (c: unknown, msg: string): void => {
  checks++;
  if (!c) {
    fails++;
    console.log('FAIL:', msg);
  }
};
const A = ABILITIES as Record<string, any>, I = ITEMS as Record<string, any>, E = ENEMIES as Record<string, any>, C = CLASSES as Record<string, any>;
const noFn = (o: unknown): boolean => {
  let bad = false;
  JSON.stringify(o, (_k, v) => {
    if (typeof v === 'function') bad = true;
    return v;
  });
  return !bad;
};

// ---- treść (selftest.mjs:36-49)
ok(Object.keys(ANCESTRIES).length >= 4, '>=4 ancestries');
ok(Object.keys(ITEMS).length >= 25, '>=25 items');
ok(Object.keys(ENEMIES).length >= 12, '>=12 enemies');
for (const c of Object.values(C)) {
  ok(c.abilities.length >= 3 && c.abilities.length <= 5, c.id + ' abilities 3-5');
  for (const a of c.abilities) ok(A[a], c.id + ' ability exists ' + a);
  for (const g of c.startGear) ok(I[g], c.id + ' gear exists ' + g);
}
for (const e of Object.values(E)) {
  for (const a of e.abilities ?? []) ok(A[a], e.id + ' ability ' + a);
  for (const l of e.loot ?? []) ok(I[l.id], e.id + ' loot ' + l.id);
}
for (const a of Object.values(A))
  ok(a.name && a.desc && typeof (ABILITY_EFFECTS as any)[a.id] === 'function' && [0, 1, 2, 3, 'reaction'].includes(a.actions), 'ability fields ' + a.id);
for (const i of Object.values(I)) ok(i.name && i.desc && i.price >= 0 && i.icon, 'item fields ' + i.id);
ok(noFn(ITEMS), 'items plain');

// ---- mechaniki (selftest.mjs:30,72,77,101-104,153,155)
{
  const fx = (n: number) => () => (n - 1) / 20 + 0.001;
  ok(check(0, 15, fx(20)).nat20 && check(0, 15, fx(1)).nat1, 'nat flags');
  const c = createCharacter({ name: 'F', ancestry: 'human', classId: 'soldier' });
  const ac0 = getStat(c, 'ac'), will0 = getStat(c, 'will');
  addCondition(c, 'frightened', 2);
  ok(getStat(c, 'ac') === ac0 && getStat(c, 'will') === will0, 'frightened: no flat AC/Will penalty (dice halved instead)');
  const heavy = createCharacter({ name: 'H', ancestry: 'human', classId: 'scout' });
  heavy.attrs.dex = 5;
  heavy.equipment.armor = newItem('riot_armor');
  const cap = I.riot_armor.armor.dexCap;
  const acHi = getStat(heavy, 'ac');
  heavy.attrs.dex = Math.min(5, cap);
  ok(cap < 5 && acHi === getStat(heavy, 'ac'), 'armor dex cap');
  // deadly/fatal: krytyk rewolweru (selftest.mjs:101-104)
  const rv = createCharacter({ name: 'R', ancestry: 'human', classId: 'soldier' });
  rv.equipment.weapon = newItem('revolver');
  const rr0 = makeRng(12345);
  let sawCrit = false;
  for (let i = 0; i < 400 && !sawCrit; i++) {
    const t = createEnemy('mutant_brute');
    const r: any = strike(rv, t, { rng: rr0 });
    if (r.events.some((x: any) => x.type === 'crit')) {
      sawCrit = true;
      ok(r.events[0].amount >= 2 * (1 + 3), 'fatal crit dmg');
    }
  }
  ok(sawCrit, 'saw a crit');
  ok(encounterXP(1, [createEnemy('kostucha')]) > 0, 'xp boss');
  for (const cid of Object.keys(CLASSES)) {
    const x = createCharacter({ name: 'x', ancestry: 'cyborg', classId: cid as any, level: 5 });
    ok(x.level === 5 && x.hp === x.maxHp, 'create lvl5 ' + cid);
  }
  // logi zdolności to napisy, warunki bez funkcji (selftest.mjs:125-126)
  const rr = makeRng(9);
  for (const cid of Object.keys(CLASSES)) {
    const u = createCharacter({ name: 'U', ancestry: 'human', classId: cid as any, level: 5 });
    for (const id of u.abilities) {
      const ab = A[id];
      if (!ab || ab.actions === 'reaction') continue;
      const foes = [createEnemy('raider_thug'), createEnemy('raider_gunner')];
      const ally = createCharacter({ name: 'Al', ancestry: 'human', classId: 'soldier' });
      const tg = ab.target === 'self' ? [u] : ab.target === 'ally' ? [ally] : foes;
      const res: any = (ABILITY_EFFECTS as any)[id]({ user: u, targets: tg, rng: rr, mapIndex: 0 });
      ok(res.log.every((l: unknown) => typeof l === 'string'), 'log strings ' + id);
      ok(tg.every((t) => noFn(t.conditions)), 'conditions plain ' + id);
    }
  }
}

// ---- symulacja walk (selftest.mjs:158-289; ten sam seed i AI)
type Ch = any;
const live = (a: Ch[]) => a.filter((x) => x.hp > 0 && !x.conditions.dead);
const resolve = (id: string, ctx: any): any => (ABILITY_EFFECTS as any)[id](ctx);
const PC_AI = (u: Ch, allies: Ch[], foes: Ch[], rng: () => number): void => {
  const st = startTurn(u, rng);
  let acts = st.actions, map = 0, guard = 0;
  while (acts > 0 && guard++ < 8 && u.hp > 0) {
    const tg = live(foes).sort((a: Ch, b: Ch) => a.hp - b.hp)[0];
    if (!tg) return;
    const hurt = allies.filter((a) => !a.conditions.dead && a.hp < a.maxHp * 0.55).sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0];
    const downA = allies.find((a) => !a.conditions.dead && a.hp <= 0);
    let act: [string, Ch[]] | null = null;
    const can = (id: string) => canUse(u, id as any) && A[id].actions <= acts;
    const w = normWeapon(getWeapon(u));
    const ranged = w.range > 0;
    if (u.classId === 'medic') {
      if (downA && can('adrenaline')) act = ['adrenaline', [downA]];
      else if (hurt && can('field_dressing')) act = ['field_dressing', [hurt]];
      else if (hurt && u.inventory.find((i: any) => i.id === 'stimpak') && acts >= 1) {
        useConsumable(u, 'stimpak', [hurt], rng);
        acts -= 1;
        continue;
      } else if (can('stimulant') && !hasCondition(allies.find((a) => a.classId === 'soldier' && a.hp > 0) || u, 'stimmed'))
        act = ['stimulant', [allies.find((a) => a.hp > 0 && a !== u) || u]];
      else if (can('field_clinic') && allies.filter((a) => a.hp < a.maxHp * 0.7).length >= 2) act = ['field_clinic', live(allies)];
    } else if (u.classId === 'techie') {
      if (can('combat_drone')) act = ['combat_drone', [tg]];
      else if (can('emp_grenade') && live(foes).some((f: Ch) => getStat(f, 'speed') >= 0 && (f.traits || []).includes('machine'))) act = ['emp_grenade', live(foes)];
      else if (can('weapon_tune') && acts >= 1 && !hasCondition(allies[0], 'tuned')) act = ['weapon_tune', [allies.find((a) => a.hp > 0 && a !== u) || u]];
      else if (can('repair_armor') && hurt) act = ['repair_armor', [hurt]];
    } else if (u.classId === 'soldier') {
      if (can('rally') && allies.some((a) => hasCondition(a, 'frightened'))) act = ['rally', live(allies)];
      else if (can('suppressive_fire') && live(foes).length >= 3 && ranged) act = ['suppressive_fire', live(foes).slice(0, 3)];
      else if (acts >= 2 && map === 0 && can('double_strike')) act = ['double_strike', [tg]];
    } else if (u.classId === 'scout') {
      if (!hasCondition(tg, 'hunted')) act = ['mark_target', [tg]];
      else if (acts >= 2 && can('precise_shot')) act = ['precise_shot', [tg]];
      else if (acts >= 2 && can('volley') && map === 0) act = ['volley', [tg]];
    } else if (u.classId === 'scavenger') {
      if (acts >= 2 && map === 0) act = ['sneak_attack', [tg]];
      else if (can('dirty_trick') && !hasCondition(tg, 'distracted')) act = ['dirty_trick', [tg]];
    } else if (u.classId === 'brute') {
      if (!hasCondition(u, 'raging')) act = ['rage', [u]];
      else if (can('roar') && live(foes).length >= 2) act = ['roar', live(foes)];
      else if (acts >= 2 && can('rend') && map === 0) act = ['rend', [tg]];
      else if (can('second_wind') && u.hp < u.maxHp * 0.5) act = ['second_wind', [u]];
    }
    if (!act) act = ['strike', [tg]];
    const ab = A[act[0]];
    const res = resolve(act[0], { user: u, targets: act[1], rng, mapIndex: map });
    acts -= ab.actions;
    if (res.attack) map += res.attacks || 1;
  }
  endTurn(u, rng);
};
const E_AI = (u: Ch, pcs: Ch[], rng: () => number, round: number): void => {
  const st = startTurn(u, rng);
  let acts = st.actions, map = 0, guard = 0;
  if (getStat(u, 'speed') > 0 && round === 1) acts -= u.attacks[0].range > 0 ? 0 : 1;
  while (acts > 0 && guard++ < 6 && u.hp > 0) {
    const L = pcs.filter((x) => x.hp > 0 && !x.conditions.dead);
    if (!L.length) return;
    const tg = rng() < 0.6 ? [...L].sort((a, b) => a.hp - b.hp)[0] : L[Math.floor(rng() * L.length)];
    let act: [string, Ch[]] | null = null;
    for (const id of u.abilities) {
      if (id === 'strike') continue;
      const ab = A[id];
      if (ab.actions > acts || (ab.uses && !canUse(u, id))) continue;
      if (id === 'frenzy' && hasCondition(u, 'raging')) continue;
      if (id === 'self_destruct' && u.hp > u.maxHp * 0.3) continue;
      if (id === 'chief_rally' || id === 'kostucha_command') {
        act = [id, [u]];
        break;
      }
      if (id === 'frenzy') {
        act = [id, [u]];
        break;
      }
      if (ab.target === 'area' && L.length >= 2 && rng() < 0.5) {
        act = [id, L.slice(0, 3)];
        break;
      }
      if (ab.target !== 'area' && rng() < 0.3) {
        act = [id, [tg]];
        break;
      }
    }
    if (!act) act = ['strike', [tg]];
    const ab = A[act[0]];
    const res = resolve(act[0], { user: u, targets: act[1], rng, mapIndex: map });
    acts -= ab.actions;
    if (res.attack) map += res.attacks || 1;
  }
  endTurn(u, rng);
};
function fight(party: Ch[], foes: Ch[], rng: () => number): { win: boolean; round: number } {
  const order = [...party.map((p) => ({ u: p, pc: true })), ...foes.map((p) => ({ u: p, pc: false }))]
    .map((x) => ({ ...x, ini: rollInitiative(x.u, rng).total }))
    .sort((a, b) => b.ini - a.ini);
  for (let round = 1; round <= 25; round++) {
    for (const o of order) {
      if (o.u.conditions.dead) continue;
      if (foes.every((f) => f.conditions.dead)) return { win: true, round };
      if (party.every((p) => p.conditions.dead || p.hp <= 0)) return { win: false, round };
      if (o.pc) PC_AI(o.u, party, foes, rng);
      else E_AI(o.u, party, rng, round);
    }
  }
  return { win: false, round: 25 };
}
const GEAR: Record<number, Record<string, [string | null, string | null]>> = {
  3: { soldier: ['assault_rifle', 'riot_armor'], scout: ['hunting_rifle', null], medic: ['revolver', 'nomad_cloak'], techie: ['revolver', 'scrap_armor'], scavenger: ['smg', 'nomad_cloak'], brute: [null, 'riot_armor'], gunslinger: ['hunting_rifle', 'nomad_cloak'], champion: ['fire_axe', 'riot_armor'], alchemist: ['shotgun', 'nomad_cloak'], herald: ['smg', 'nomad_cloak'], monk: ['fire_axe', null], hacker: ['revolver', 'nomad_cloak'] },
  5: { soldier: ['laser_rifle', 'riot_armor'], scout: ['laser_pistol', 'kevlar'], medic: ['laser_pistol', 'kevlar'], techie: ['laser_pistol', 'riot_armor'], scavenger: ['monoblade', 'kevlar'], brute: ['monoblade', 'riot_armor'], gunslinger: ['laser_pistol', 'kevlar'], champion: ['monoblade', 'riot_armor'], alchemist: ['laser_pistol', 'kevlar'], herald: ['laser_pistol', 'kevlar'], monk: ['monoblade', null], hacker: ['laser_pistol', 'kevlar'] },
};
function upgrade(ch: Ch): void {
  for (const L of [3, 5])
    if (ch.level >= L) {
      const [w, a] = GEAR[L][ch.classId];
      if (w) ch.equipment.weapon = newItem(w as any);
      if (a) ch.equipment.armor = newItem(a as any);
    }
}
const CLS = Object.keys(CLASSES), ANC = Object.keys(ANCESTRIES);
function randomParty(rng: () => number, level = 1): Ch[] {
  const picks = [...CLS].sort(() => rng() - 0.5).slice(0, 4);
  if (!picks.includes('medic') && rng() < 0.6) picks[3] = 'medic';
  const FRONT = ['soldier', 'brute', 'champion', 'monk'];
  if (!picks.some((c) => FRONT.includes(c))) picks[0] = FRONT[Math.floor(rng() * FRONT.length)];
  return picks.map((c, i) => {
    const ch = createCharacter({ name: `P${i}`, ancestry: ANC[Math.floor(rng() * ANC.length)] as any, classId: c as any, level });
    upgrade(ch);
    return ch;
  });
}
const SCENARIOS = [
  ['raider_thug', 'raider_gunner', 'raider_gunner', 'rat_mutant'],
  ['raider_thug', 'raider_thug', 'raider_gunner', 'drone'],
  ['dog_mutant', 'dog_mutant', 'rat_mutant', 'rat_mutant'],
  ['raider_psycho', 'raider_gunner', 'rat_mutant', 'rat_mutant'],
  ['raider_thug', 'raider_gunner', 'rat_mutant'],
  ['fly_swarm', 'raider_thug', 'raider_gunner', 'rat_mutant'],
];
const rngS = makeRng(777);
let totalWin = 0, totalN = 0, rounds = 0;
for (const foesIds of SCENARIOS) {
  let w = 0;
  const n = 80;
  for (let i = 0; i < n; i++) {
    const r = fight(randomParty(rngS, 1), foesIds.map((f) => createEnemy(f as any)), rngS);
    if (r.win) w++;
    rounds += r.round;
  }
  totalWin += w;
  totalN += n;
  console.log(`  L1 ${foesIds.join('+')}: win ${((w / n) * 100).toFixed(0)}%`);
}
const rate = totalWin / totalN;
console.log(`4v4 level 1: ${totalN} fights, win rate ${(rate * 100).toFixed(1)}%, avg rounds ${(rounds / totalN).toFixed(1)}`);
ok(rate >= 0.6 && rate <= 0.9, 'level-1 win rate in 60-90%');
{
  let w = 0;
  for (let i = 0; i < 60; i++) if (fight(randomParty(rngS, 3), ['raider_chief', 'raider_sniper', 'raider_thug', 'raider_gunner'].map((f) => createEnemy(f as any)), rngS).win) w++;
  console.log(`4v4 level 3 vs Herszt+świta: win ${((w / 60) * 100).toFixed(0)}%`);
  ok(w / 60 >= 0.35 && w / 60 <= 0.95, 'lvl3 chief fight sane');
  w = 0;
  for (let i = 0; i < 60; i++) if (fight(randomParty(rngS, 6), ['kostucha', 'raider_chief', 'raider_sniper', 'raider_thug'].map((f) => createEnemy(f as any)), rngS).win) w++;
  console.log(`4v4 level 6 vs Kostucha+świta: win ${((w / 60) * 100).toFixed(0)}%`);
  ok(w / 60 >= 0.2 && w / 60 <= 0.95, 'boss fight sane');
}

console.log(`\n${checks} checks, ${fails} failures`);
process.exit(fails ? 1 : 0);
