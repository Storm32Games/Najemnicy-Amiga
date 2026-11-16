// Ślad referencyjny regionu kampanii (TS) -> amiga/data/traces/region.txt. Ten sam scenariusz: amiga/tests/trace_region.c.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SECTORS, buildRoute, contractSpots, heightQ8, inCity, routePointAt, routeTicks, type Biome } from '../../src/core/campaign/region.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const out: string[] = [];
for (const sec of SECTORS) {
  sec.spots.forEach((spot, si) => {
    for (const idx of [0, 1]) {
      const r = buildRoute(spot, sec.id, idx + si);
      let h = 7;
      for (let i = 0; i < r.n; i++) h = (Math.imul(h, 31) + r.x[i] * 3 + r.z[i]) >>> 0;
      const pts: string[] = [];
      for (let k = 0; k <= 7; k++) {
        const p = routePointAt(r, Math.trunc((r.len * k) / 7));
        pts.push(`${p.x},${p.z}`);
      }
      out.push(`route ${sec.id} ${si} ${idx} n=${r.n} len=${r.len} from=${r.trackFrom} ticks=${routeTicks(r)} h=${h} ${pts.join(';')}`);
    }
  });
}
for (let z = -24 * 256; z <= 24 * 256; z += 777) {
  const row: string[] = [];
  for (let x = -36 * 256; x <= 36 * 256; x += 613) row.push(`${heightQ8(x, z)}${inCity({ x, z }) ? '*' : ''}`);
  out.push(`h ${z} ${row.join(',')}`);
}
const BIOMES: Biome[] = ['ruins', 'wastes', 'industrial', 'bunker'];
const list = Array.from({ length: 40 }, (_, i) => ({ id: `c${i}`, biome: BIOMES[(i * 7) % 4] }));
const spots = contractSpots(list);
out.push(`spots ${list.map((c) => `${spots.get(c.id)!.x},${spots.get(c.id)!.z}`).join(';')}`);
mkdirSync(join(ROOT, 'amiga', 'data', 'traces'), { recursive: true });
const file = join(ROOT, 'amiga', 'data', 'traces', 'region.txt');
writeFileSync(file, out.join('\n') + '\n');
console.log(`OK: ${file} (${out.length} linii)`);
