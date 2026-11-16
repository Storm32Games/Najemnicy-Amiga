// Ślad referencyjny warstwy taktycznej (TS) -> amiga/data/traces/tactical.txt. Ten sam scenariusz: amiga/tests/trace_tactical.c.
// Część 1: generator map, Dijkstra, ścieżki, pole widzenia. (Walka, AI i misje: trace_mission.ts.)
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateMap, UNREACHABLE, type Biome, type EnemyId, type TacticalMap } from '../../src/core/index.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const out: string[] = [];
const P = (s: string): void => {
  out.push(s);
};
const FLOORS = ['sand', 'asphalt', 'asphalt_cracked', 'rubble', 'concrete', 'dirt', 'toxic', 'grass_dead', 'metal', 'tiles'];

export const MAP_LISTS: EnemyId[][] = [
  [],
  ['raider_thug', 'raider_gunner', 'dog_mutant', 'raider_psycho', 'drone', 'raider_chief'],
  ['kostucha', 'raider_thug', 'raider_thug', 'raider_gunner', 'raider_sniper', 'raider_psycho', 'raider_burner'],
  ['rat_mutant', 'rat_mutant', 'rat_mutant', 'rat_mutant', 'scorpion', 'fly_swarm', 'ghoul', 'mutant_brute'],
];
export const BIOMES: Biome[] = ['ruins', 'wastes', 'industrial', 'bunker'];

export function dumpMap(m: TacticalMap, P: (s: string) => void): void {
  P(`seed=${m.seed} entry=${m.entry.x0},${m.entry.y0} maxD=${m.maxD} obj=${m.objCell ? `${m.objCell.gx},${m.objCell.gy},${m.objCell.d}` : '-'}`);
  for (let y = 0; y < m.height; y++) {
    let c = '';
    let f = '';
    for (let x = 0; x < m.width; x++) {
      c += m.grid.cells[y * m.width + x];
      f += String.fromCharCode(97 + FLOORS.indexOf(m.floor[y * m.width + x]));
    }
    P(`row ${c} ${f}`);
  }
  P(`props ${m.props.map((p) => `${p.type}@${p.gx},${p.gy}/${p.rot}/${p.seed}`).join(';')}`);
  P(`deco ${m.deco.map((p) => `${p.type}@${p.gx},${p.gy}/${p.rot}/${p.seed}`).join(';')}`);
  P(`decor ${m.decor.map((p) => `${p.type}@${p.gx},${p.gy}`).join(';')}`);
  P(`buildings ${m.buildings.map((b) => `${b.gx},${b.gy},${b.w},${b.d},${b.h},${b.seed}`).join(';')}`);
  P(`solids ${m.solids.length} ${m.solids.filter((s) => s.near).length}`);
  for (const g of m.groups) P(`group ${g.center.gx},${g.center.gy},${g.center.d} roam=${g.roam ? 1 : 0} ${g.members.join(',')} ${g.cells.map((c) => `${c.gx},${c.gy}`).join(';')}`);
  P(`crates ${m.crates.map((c) => `${c.gx},${c.gy}`).join(';')}`);
  P(`finds ${m.finds.map((f) => `${f.gx},${f.gy},${f.kind},${f.hidden ? 1 : 0}`).join(';')}`);
  P(`reach ${m.reach.length}`);
}

for (const biome of BIOMES) {
  for (let k = 0; k < 12; k++) {
    const id = `map:${biome}:${k}`;
    const type = k % 5 === 4 ? 'defend' : 'eliminate';
    const level = 1 + (k % 5);
    const m = generateMap({ id, biome, level, type }, MAP_LISTS[k % 4]);
    P(`map ${id} ${type} ${level}`);
    dumpMap(m, P);
    if (k < 3) {
      const s = m.entry.cells[5];
      for (const maxCost of [6, 12.5, 40]) {
        const res = m.grid.search(s, maxCost);
        let n = 0;
        let sum = 0;
        for (let i = 0; i < res.cost.length; i++) {
          if (res.cost[i] >= UNREACHABLE) continue;
          n++;
          sum = (sum + (i + 1) * Math.round(res.cost[i] * 2) + (res.prev[i] + 1) * 7) >>> 0;
        }
        P(`search ${maxCost} n=${n} sum=${sum}`);
      }
      if (m.objCell) {
        const path = m.grid.findPath(s, m.objCell);
        P(`path ${path ? path.map((p) => `${p.gx},${p.gy}`).join(';') : 'null'}`);
      }
      for (const r of [5, 9]) {
        const v = m.grid.visible(s, r);
        P(`visible ${r} ${v.length} ${v.reduce((a, i) => (a * 31 + i) >>> 0, 7)}`);
      }
    }
  }
}

mkdirSync(join(ROOT, 'amiga', 'data', 'traces'), { recursive: true });
const file = join(ROOT, 'amiga', 'data', 'traces', 'tactical.txt');
writeFileSync(file, out.join('\n') + '\n');
console.log(`OK: ${file} (${out.length} linii)`);
