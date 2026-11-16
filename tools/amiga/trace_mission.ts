// Ślad referencyjny walki, AI i misji (TS) -> amiga/data/traces/mission.txt. Ten sam scenariusz: amiga/tests/trace_mission.c.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ENEMIES, RECRUITS, Mission, cheb, makeRng, recruitCharacter, runAiTurn,
  type Actor, type Biome, type Character, type CombatSignal, type EnemyId, type ItemId, type MissionContract, type MissionSignal, type ObjectiveType,
} from '../../src/core/index.ts';
import { resStr } from './trace_fmt.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const out: string[] = [];
const P = (s: string): void => {
  out.push(s);
};
const DEG = (n: number | undefined): string => (n === undefined ? '-' : String(n));
void ENEMIES;

const L1: EnemyId[] = ['raider_thug', 'raider_gunner', 'dog_mutant', 'raider_psycho', 'drone', 'raider_chief'];
const L2: EnemyId[] = ['kostucha', 'raider_thug', 'raider_thug', 'raider_gunner', 'raider_sniper', 'raider_psycho', 'raider_burner'];
const L3: EnemyId[] = ['rat_mutant', 'rat_mutant', 'scorpion', 'fly_swarm', 'ghoul', 'mutant_brute'];
interface Sim { type: ObjectiveType; biome: Biome; level: number; enemies: EnemyId[]; party: number[]; plevel: number; item?: ItemId }
export const SIMS: Sim[] = [
  { type: 'eliminate', biome: 'ruins', level: 2, enemies: L1, party: [0, 1, 2, 3], plevel: 2 },
  { type: 'hunt', biome: 'wastes', level: 3, enemies: L3, party: [4, 5, 6, 7], plevel: 3 },
  { type: 'boss', biome: 'bunker', level: 5, enemies: L2, party: [8, 9, 10, 11], plevel: 5 },
  { type: 'retrieve', biome: 'industrial', level: 2, enemies: ['raider_thug', 'raider_gunner', 'drone', 'turret'], party: [12, 13, 14, 15], plevel: 2, item: 'circuit' },
  { type: 'rescue', biome: 'ruins', level: 3, enemies: L1, party: [0, 5, 10, 15], plevel: 3 },
  { type: 'hack', biome: 'bunker', level: 3, enemies: ['drone', 'robot', 'raider_gunner'], party: [3, 7, 11, 15], plevel: 3 },
  { type: 'liberate', biome: 'wastes', level: 4, enemies: L1, party: [1, 2, 12, 13], plevel: 4 },
  { type: 'purge', biome: 'industrial', level: 3, enemies: L3, party: [5, 6, 7, 0], plevel: 3 },
  { type: 'defend', biome: 'wastes', level: 2, enemies: ['raider_thug', 'raider_gunner', 'rat_mutant', 'rat_mutant', 'dog_mutant'], party: [0, 1, 2, 3], plevel: 2 },
];

function attach(ms: Mission): void {
  const lab = (a: Actor | undefined | null): string => (a ? 'a' + ms.actors.indexOf(a) : '-');
  const labCh = (ch: Character | undefined): string => {
    const a = ms.actors.find((x) => x.ch === ch);
    return a ? lab(a) : '?';
  };
  const path = (p: readonly { gx: number; gy: number }[]): string => p.map((q) => `${q.gx},${q.gy}`).join(';');
  ms.combat.on((s: CombatSignal) => {
    switch (s.kind) {
      case 'combatStart': P(`C start ${s.order.map(lab).join(',')} boss=${s.boss ? 1 : 0} amb=${s.ambush ? 1 : 0}`); break;
      case 'join': P(`C join ${s.actors.map(lab).join(',')}`); break;
      case 'round': P(`C round ${s.round}`); break;
      case 'turnStart': P(`C turn ${lab(s.turn.actor)} ${s.turn.actions} r${s.round}`); break;
      case 'turnEnd': P(`C tend ${lab(s.actor)}`); break;
      case 'move': P(`C move ${lab(s.actor)} ${path(s.path)}`); break;
      case 'strike':
        P(`C strike ${lab(s.attacker)}>${lab(s.defender)} mod=${s.info.mod} ac=${s.info.ac} hit=${Math.round(s.info.hit * 20)} fl=${s.info.flank ? 1 : 0} gc=${s.info.geoCover ? 1 : 0} inc=${s.info.inc} map=${s.info.mapIdx}`);
        P(resStr(s.result, labCh));
        break;
      case 'ability':
        P(`C ability ${lab(s.actor)} ${s.ability.id} ${s.targets.map(lab).join(',')} cell=${s.cell ? `${s.cell.gx},${s.cell.gy}` : '-'}`);
        P(resStr(s.result, labCh));
        break;
      case 'item':
        P(`C item ${lab(s.actor)} ${s.item.id} ${s.targets.map(lab).join(',')}`);
        P(resStr(s.result, labCh));
        break;
      case 'rules': P(`C rules ${lab(s.actor)} ${resStr({ log: [], events: s.result.events, attack: false }, labCh)}`); break;
      case 'state': P(`C state ${lab(s.actor)} ${s.from}>${s.to}`); break;
      case 'noise': P(`C noise ${lab(s.actor)} ${s.radius}`); break;
      case 'end': P(`C end ${s.outcome}`); break;
      default: break;
    }
  });
  ms.on((s: MissionSignal) => {
    switch (s.kind) {
      case 'discover': P(`M discover f${ms.finds.indexOf(s.find)} ${lab(s.by)} ${s.roll.total}/${s.roll.degree}`); break;
      case 'pickup': P(`M pickup f${ms.finds.indexOf(s.find)} ${lab(s.by)} ${s.scrap} ${s.items.map((i) => i.id).join(',')}`); break;
      case 'spotted': P(`M spotted g${ms.groups.indexOf(s.group)} ${lab(s.by)} ${s.close ? 1 : 0}`); break;
      case 'crate': P(`M crate t${ms.things.indexOf(s.thing)} ${lab(s.by)} ${s.roll.total}/${s.roll.degree} ${s.scrap} ${s.items.map((i) => i.id).join(',')} trap=${s.trapDamage}`); break;
      case 'interact': P(`M interact t${ms.things.indexOf(s.thing)} ${lab(s.by)}`); break;
      case 'lock': P(`M lock t${ms.things.indexOf(s.thing)} ${lab(s.by)} ${s.attempt.roll.total}/${s.attempt.roll.degree} o=${s.attempt.opened ? 1 : 0} h=${s.hack ? 1 : 0}`); break;
      case 'objective': P('M objective'); break;
      case 'complete': P('M complete'); break;
      case 'finish': {
        const r = s.result;
        P(`M finish ${r.result} xp=${r.xp} scrap=${r.scrap} loot=${r.loot.map((i) => `${i.id}:${i.qty}`).join(',')} dead=${r.casualties.length}`);
        break;
      }
      default: break;
    }
  });
}

function state(ms: Mission, tag: string): void {
  P(`${tag} mode=${ms.mode} stage=${ms.stage} steps=${ms.steps} scrap=${ms.scrap} loot=${ms.loot.length} wave=${ms.wave}/${ms.nextWave} ` +
    ms.actors.map((a, i) => `a${i}:${a.gx},${a.gy},${a.state},${a.ch.hp},${a.engaged ? 1 : 0}`).join(' '));
}

function runCombat(ms: Mission): void {
  const c = ms.combat;
  let guard = 0;
  let t = c.nextTurn();
  while (t && c.active && guard++ < 300) {
    const acts = runAiTurn(c, t.actor);
    P(`ai ${'a' + ms.actors.indexOf(t.actor)} ${acts.map((x) => x.type).join(',')}`);
    t = c.nextTurn();
  }
}

for (let k = 0; k < SIMS.length; k++) {
  for (const mode of ['fight', 'explore'] as const) for (let v = 0; v < 3; v++) {
    const s = SIMS[k];
    const party = s.party.map((i) => recruitCharacter(RECRUITS[i], RECRUITS[i].name, s.plevel));
    const contract: MissionContract = { id: `sim:${k}`, type: s.type, level: s.level, biome: s.biome, enemies: s.enemies, objective: { type: s.type, itemId: s.item ?? null } };
    const ms = new Mission(contract, party, makeRng(`sim:${k}:${mode}:${v}`));
    P(`sim ${k} ${mode} ${v} ${s.type}`);
    attach(ms);
    state(ms, 'init');
    if (mode === 'fight') {
      for (let n = 0; n < 8 && ms.mode !== 'over'; n++) {
        const g = ms.groups.find((x) => x.actors.some((e) => e.state !== 'dead'));
        if (!g) break;
        ms.startCombat(g, n === 0);
        runCombat(ms);
        state(ms, `fight${n}`);
      }
      if (ms.mode !== 'over') ms.retreat();
    } else {
      const skip = new Set<number>();
      for (let it = 0; it < 60 && ms.mode !== 'over'; it++) {
        if (ms.inCombat()) {
          runCombat(ms);
          state(ms, `combat${it}`);
          continue;
        }
        const lead = ms.pcs.find((p) => p.state === 'up');
        if (!lead) break;
        const ti = ms.things.findIndex((t, i) => !t.done && !skip.has(i) && !(t.kind === 'device' && t.lock?.jammed));
        if (ti >= 0) {
          const th = ms.things[ti];
          if (cheb(lead, th) <= 1) {
            const skill = th.kind === 'device' ? 'crafting' : th.kind === 'crate' || th.kind === 'door' ? 'thievery' : undefined;
            const ok = ms.interact(lead, th, skill);
            P(`interact t${ti} ${ok ? 1 : 0}`);
            if (!ok) skip.add(ti);
          } else {
            const r = ms.exploreMove(lead, th);
            P(`move t${ti} ok=${r.ok ? 1 : 0} combat=${r.combat ? 1 : 0}`);
            if (!r.ok) skip.add(ti);
          }
        } else if (ms.objectiveDone()) {
          if (ms.canExtract() || !ms.needsExtraction()) {
            ms.finish('success');
            break;
          }
          const r = ms.exploreMove(lead, ms.map.entry.cells[5]);
          P(`move exit ok=${r.ok ? 1 : 0}`);
        } else {
          const e = ms.enemies.find((x) => x.state === 'up');
          if (!e) break;
          const r = ms.exploreMove(lead, e);
          P(`move enemy ok=${r.ok ? 1 : 0} combat=${r.combat ? 1 : 0}`);
          if (!r.ok) break;
        }
        state(ms, `it${it}`);
      }
      if (ms.mode !== 'over') ms.retreat();
    }
    state(ms, 'end');
  }
}

mkdirSync(join(ROOT, 'amiga', 'data', 'traces'), { recursive: true });
const file = join(ROOT, 'amiga', 'data', 'traces', 'mission.txt');
writeFileSync(file, out.join('\n') + '\n');
console.log(`OK: ${file} (${out.length} linii)`);
