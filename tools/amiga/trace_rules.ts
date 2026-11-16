// Ślad referencyjny zasad (TS) -> amiga/data/traces/rules.txt. Ten sam scenariusz: amiga/tests/trace_rules.c.
// Uruchom: node tools/amiga/trace_rules.ts
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ABILITIES, CLASSES, ENEMIES, ITEMS, RECRUITS, UNIVERSAL_ABILITIES, LOCKS, DEVICES,
  addCondition, addXP, applyDamage, createEnemy, endEncounter, endTurn, equip, longRest, lockForLevel, lockState, deviceState, makeRng,
  moveItem, newItem, pickLock, hackDevice, recruitCharacter, rollInitiative, rollLoot, startTurn, strike, swapWeapons, unequip, useAbility,
  useConsumable, addToStack,
  type AbilityId, type ActionResult, type Character, type ConditionId, type EnemyId, type ItemId, type ItemInstance, type SkillId,
} from '../../src/core/index.ts';
import { resStr, snap, type LabelOf } from './trace_fmt.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const out: string[] = [];
const P = (s: string): void => {
  out.push(s);
};
const ENEMY_IDS = Object.keys(ENEMIES) as EnemyId[];
const ABIL_IDS = Object.keys(ABILITIES) as AbilityId[];
const R = (i: number, lvl: number): Character => recruitCharacter(RECRUITS[i], RECRUITS[i].name, lvl);
const labels = (pairs: [Character, string][]): LabelOf => (c) => pairs.find((p) => p[0] === c)?.[1] ?? '?';
const evOnly = (events: ActionResult['events']): ActionResult => ({ log: [], events, attack: false });

// ---- R1: ataki rekrut -> wróg i odwet każdym atakiem wroga
for (let ri = 0; ri < RECRUITS.length; ri++) {
  for (const lvl of [1, 3, 6]) {
    for (const eid of ENEMY_IDS) {
      const a = R(ri, lvl);
      const d = createEnemy(eid);
      const L = labels([[a, 'A'], [d, 'D']]);
      const rng = makeRng(`st:${ri}:${lvl}:${eid}`);
      P(`strike ${RECRUITS[ri].id} ${lvl} ${eid}`);
      P(resStr(strike(a, d, { rng }), L));
      P(snap('D', d));
      for (let k = 0; k < (d.attacks?.length ?? 0); k++) {
        P(resStr(strike(d, a, { weapon: d.attacks![k], rng }), L));
        P(snap('A', a));
      }
    }
  }
}

// ---- R2: ataki ze stanami na atakującym albo obrońcy
const MODS: ConditionId[] = ['frightened', 'hidden', 'prone', 'in_cover', 'off_guard', 'raging', 'hunted', 'stimmed', 'tuned', 'clumsy', 'sickened', 'enfeebled', 'raised_shield', 'dodging', 'reinforced'];
for (let ri = 0; ri < RECRUITS.length; ri++) {
  for (const m of MODS) {
    for (const side of [0, 1]) {
      const a = R(ri, 4);
      const d = createEnemy('raider_thug');
      addCondition(side ? d : a, m, 2);
      const L = labels([[a, 'A'], [d, 'D']]);
      const rng = makeRng(`sm:${ri}:${m}:${side}`);
      P(`strikemod ${RECRUITS[ri].id} ${m} ${side}`);
      P(resStr(strike(a, d, { rng, mapIndex: side }), L));
      P(resStr(strike(d, a, { rng }), L));
      P(snap('A', a));
      P(snap('D', d));
    }
  }
}

// ---- R3: zdolności
const AREA_ALLIES = new Set<string>(['rally', 'field_clinic', 'chief_rally', 'kostucha_command']);
const UNIVERSAL = new Set<string>(UNIVERSAL_ABILITIES);
for (let ai = 0; ai < ABIL_IDS.length; ai++) {
  const id = ABIL_IDS[ai];
  const ab = ABILITIES[id];
  for (let v = 0; v < 8; v++) {
    const w = v % 4;
    let user: Character;
    let enemyUser = false;
    if (UNIVERSAL.has(id)) user = R((ai + v) % RECRUITS.length, 5);
    else {
      const ri = RECRUITS.findIndex((r) => (CLASSES[r.classId].abilities as readonly string[]).includes(id));
      if (ri >= 0) user = R(ri, 5);
      else {
        user = createEnemy(ENEMY_IDS.find((e) => (ENEMIES[e].abilities as readonly string[]).includes(id))!);
        enemyUser = true;
      }
    }
    let foes: Character[];
    let allies: Character[];
    if (enemyUser) {
      foes = [R(0, 3), R(5, 3)];
      allies = [createEnemy('raider_thug')];
    } else {
      foes = [createEnemy('raider_thug'), createEnemy(v % 2 ? 'robot' : 'ghoul')];
      allies = [R(2, 3)];
    }
    const ally = allies[0];
    applyDamage(ally, Math.floor(ally.maxHp / 2), 'P');
    addCondition(ally, 'bleeding', '1d6');
    addCondition(ally, 'frightened', 1);
    if (w === 3) applyDamage(ally, ally.hp + 5, 'P');
    if (w === 2) {
      addCondition(foes[0], 'off_guard', 1);
      addCondition(user, 'hidden', 1);
    }
    let targets: Character[];
    if (ab.target === 'enemy') targets = [foes[0]];
    else if (ab.target === 'ally') targets = [ally];
    else if (ab.target === 'self') targets = [];
    else if (ab.target === 'area') targets = AREA_ALLIES.has(id) ? [...allies, user] : ab.range > 0 ? [...foes, ally] : [...foes];
    else targets = [...foes];
    const L = labels([[user, 'U'], [foes[0], 'F0'], [foes[1], 'F1'], [ally, 'A0']]);
    P(`ability ${id} ${v}`);
    P(resStr(useAbility(id, { user, targets, rng: makeRng(`ab:${id}:${v}`), mapIndex: w === 1 ? 1 : 0 }), L));
    P(snap('U', user));
    P(snap('F0', foes[0]));
    P(snap('F1', foes[1]));
    P(snap('A0', ally));
  }
}

// ---- R4: przedmioty jednorazowe
const CONSUMABLES = (Object.keys(ITEMS) as ItemId[]).filter((k) => ITEMS[k].type === 'consumable');
for (const id of CONSUMABLES) {
  const def = ITEMS[id];
  if (def.type !== 'consumable') continue;
  for (let v = 0; v < 3; v++) {
    const user = R(v * 3, 3);
    const inst = newItem(id, 2);
    user.inventory.push(inst);
    const ally = R(v * 3 + 1, 3);
    applyDamage(ally, Math.floor(ally.maxHp / 2), 'P');
    addCondition(ally, 'bleeding', '1d6');
    addCondition(ally, 'poisoned', '1d4');
    addCondition(ally, 'burning', 2);
    addCondition(ally, 'sickened', 1);
    const f0 = createEnemy('raider_thug');
    const f1 = createEnemy(v === 1 ? 'drone' : 'robot');
    const c = def.consumable;
    const targets = c.target === 'area' ? [f0, f1, ally] : c.target === 'self' ? [] : [ally];
    const L = labels([[user, 'U'], [f0, 'F0'], [f1, 'F1'], [ally, 'A0']]);
    P(`item ${id} ${v}`);
    P(resStr(useConsumable(user, inst, targets, makeRng(`it:${id}:${v}`)), L));
    P(snap('U', user));
    P(snap('F0', f0));
    P(snap('F1', f1));
    P(snap('A0', ally));
  }
}

// ---- R5: początek i koniec tury
for (let v = 0; v < 6; v++) {
  const ch = R(v, 2);
  const rng = makeRng(`turn:${v}`);
  addCondition(ch, 'bleeding', '1d6');
  addCondition(ch, 'burning', '1d4');
  addCondition(ch, 'poisoned', 2);
  addCondition(ch, 'stunned', 1);
  addCondition(ch, 'quickened', 1);
  addCondition(ch, 'frightened', 2);
  addCondition(ch, 'raised_shield', 1);
  const L = labels([[ch, 'C']]);
  for (let t = 0; t < 5; t++) {
    const st = startTurn(ch, rng);
    P(`turn ${v} ${t} actions=${st.actions}`);
    P(resStr(evOnly(st.events), L));
    endTurn(ch);
    P(snap('C', ch));
  }
  const dy = R(v + 6, 1);
  applyDamage(dy, dy.hp + 3, 'P', { crit: v % 2 === 1 });
  const L2 = labels([[dy, 'Y']]);
  for (let t = 0; t < 6; t++) {
    const st = startTurn(dy, rng);
    P(`dying ${v} ${t} actions=${st.actions}`);
    P(resStr(evOnly(st.events), L2));
    P(snap('Y', dy));
  }
}

// ---- R6: inicjatywa
for (let ri = 0; ri < RECRUITS.length; ri++) {
  const ch = R(ri, 1 + (ri % 5));
  if (ri % 3 === 0) addCondition(ch, 'frightened', 1);
  const rng = makeRng(`init:${ri}`);
  const rs = [0, 1, 2].map(() => rollInitiative(ch, rng));
  P(`init ${RECRUITS[ri].id} ${rs.map((r) => `${r.d20}/${r.mod}/${r.total}`).join(' ')}`);
}

// ---- R7: zamki, wyważanie, hakowanie
const LOCK_IDS = Object.keys(LOCKS) as (keyof typeof LOCKS)[];
const DEVICE_IDS = Object.keys(DEVICES) as (keyof typeof DEVICES)[];
for (let ri = 0; ri < RECRUITS.length; ri++) {
  const ch = R(ri, 3);
  if (ri % 2 === 0) ch.inventory.push(newItem('lockpick', 2));
  const rng = makeRng(`lock:${ri}`);
  for (const q of LOCK_IDS) {
    const lock = lockState(q);
    const parts: string[] = [];
    for (let k = 0; k < 6 && lock.progress < lock.needed; k++) {
      const at = pickLock(ch, lock, 'thievery', rng);
      parts.push(`${at.roll.total}/${at.roll.degree}/${at.gained}/${at.opened ? 1 : 0}/${at.brokeTool ? 1 : 0}/${at.improvised ? 1 : 0}`);
    }
    const force = lockState(q);
    for (let k = 0; k < 3 && force.progress < force.needed; k++) {
      const at = pickLock(ch, force, 'athletics', rng);
      parts.push(`F${at.roll.total}/${at.roll.degree}/${at.opened ? 1 : 0}/${at.broken ? 1 : 0}/${at.jammed ? 1 : 0}/${force.forcePenalty}`);
    }
    P(`lock ${RECRUITS[ri].id} ${q} ${parts.join(' ')} prog=${lock.progress}/${lock.needed}`);
  }
  for (const k of DEVICE_IDS) {
    const dev = deviceState(k, 3);
    const parts: string[] = [];
    const skill: SkillId = ri % 2 ? 'crafting' : 'thievery';
    for (let n = 0; n < 6 && dev.progress < dev.needed && !dev.jammed; n++) {
      const at = hackDevice(ch, dev, skill, rng);
      parts.push(`${at.roll.total}/${at.roll.degree}/${at.gained}/${at.opened ? 1 : 0}/${at.alarm ? 1 : 0}`);
    }
    P(`hack ${RECRUITS[ri].id} ${k} dc=${dev.dc} ${parts.join(' ')} prog=${dev.progress}/${dev.needed} j=${dev.jammed ? 1 : 0}`);
  }
  P(snap('C', ch));
}
{
  const rng = makeRng('lockForLevel');
  const qs: string[] = [];
  for (let lvl = 0; lvl <= 10; lvl++) for (let k = 0; k < 3; k++) qs.push(lockForLevel(lvl, rng));
  P(`lockForLevel ${qs.join(',')}`);
}

// ---- R8: ekwipunek
{
  const ch = R(12, 1); // Mur: strażnik z tarczą
  const stash: ItemInstance[] = [newItem('sledgehammer'), newItem('scrap_shield'), newItem('bandage', 3), newItem('riot_armor')];
  const st = (): string => `stash=${stash.map((i) => `${i.id}:${i.qty}`).join(',')}`;
  P(`equip0 ${st()}`);
  P(snap('C', ch));
  P(`equip1 ${equip(ch, 'weapon', stash[0], stash, stash).ok ? 1 : 0} ${st()}`);
  P(snap('C', ch));
  P(`equip2 ${equip(ch, 'shield', stash.find((i) => i.id === 'scrap_shield')!, stash, stash).ok ? 1 : 0} ${st()}`);
  P(`equip3 ${unequip(ch, 'weapon', stash) ? 1 : 0} ${st()}`);
  P(`equip4 ${equip(ch, 'shield', stash.find((i) => i.id === 'scrap_shield')!, stash, stash).ok ? 1 : 0} ${st()}`);
  P(`equip5 ${equip(ch, 'armor', stash.find((i) => i.id === 'riot_armor')!, stash, stash).ok ? 1 : 0} ${st()}`);
  P(`equip6 ${equip(ch, 'armor', stash.find((i) => i.id === 'bandage')!, stash, stash).ok ? 1 : 0} ${st()}`);
  P(`swap ${swapWeapons(ch) ? 1 : 0}`);
  P(snap('C', ch));
  moveItem(stash.find((i) => i.id === 'bandage')!, stash, ch.inventory);
  P(`move1 ${st()}`);
  moveItem(stash.find((i) => i.id === 'bandage')!, stash, ch.inventory, true);
  P(`move2 ${st()}`);
  addToStack(ch.inventory, newItem('bandage', 2));
  addToStack(ch.inventory, newItem('pipe'));
  addToStack(ch.inventory, newItem('pipe'));
  P(snap('C', ch));
}

// ---- R9: PD, koniec starcia, odpoczynek, łup
for (let ri = 0; ri < RECRUITS.length; ri++) {
  const ch = R(ri, 1);
  const g = [addXP(ch, 450), addXP(ch, 900), addXP(ch, 3333)];
  addCondition(ch, 'frightened', 2);
  addCondition(ch, 'bleeding', '1d6');
  addCondition(ch, 'wounded', 1);
  addCondition(ch, 'raging', 3);
  ch.tempHp = 5;
  for (const k of Object.keys(ch.uses) as AbilityId[]) ch.uses[k] = 0;
  P(`xp ${RECRUITS[ri].id} ${g.join(',')}`);
  endEncounter(ch);
  P(snap('E', ch));
  applyDamage(ch, 7, 'S');
  longRest(ch);
  P(snap('L', ch));
}
for (const eid of ENEMY_IDS) {
  const rng = makeRng(`loot:${eid}`);
  const parts: string[] = [];
  for (let k = 0; k < 5; k++) {
    const l = rollLoot(eid, rng);
    parts.push(`${l.scrap}[${l.items.map((i) => `${i.id}:${i.qty}`).join(',')}]`);
  }
  P(`loot ${eid} ${parts.join(' ')}`);
}

mkdirSync(join(ROOT, 'amiga', 'data', 'traces'), { recursive: true });
const file = join(ROOT, 'amiga', 'data', 'traces', 'rules.txt');
writeFileSync(file, out.join('\n') + '\n');
console.log(`OK: ${file} (${out.length} linii)`);
