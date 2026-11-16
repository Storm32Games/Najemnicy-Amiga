// Ślad referencyjny generatora imion (TS) -> amiga/data/traces/names.txt. Ten sam scenariusz: amiga/tests/trace_names.c.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ANCESTRIES, CLASSES, RECRUITS, generateName, hireRecruit, makeRng, startCampaign } from '../../src/core/index.ts';
import { SURNAMES, femSurname } from '../../src/core/data/names.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const out: string[] = [];
const TAKEN = ['Sowa', 'Kruk', 'Bizon', 'Igła Wrońska', 'Szept'];
for (const anc of Object.keys(ANCESTRIES)) {
  for (const cls of Object.keys(CLASSES)) {
    for (const g of ['m', 'f', null] as const) {
      for (const v of [0, 1]) {
        const rng = makeRng(`name:${anc}:${cls}:${g ?? '-'}:${v}`);
        const n = generateName({ ancestry: anc, classId: cls, gender: g, taken: v ? TAKEN : [], rng });
        out.push(`name ${anc} ${cls} ${g ?? '-'} ${v} ${n}`);
      }
    }
  }
}
out.push(`fem ${SURNAMES.map(femSurname).join(',')}`);
for (let k = 0; k < 6; k++) {
  const rng = makeRng(`hire:${k}`);
  const st = startCampaign([RECRUITS[k], RECRUITS[k + 1], RECRUITS[k + 2]], rng);
  st.party[0].name = RECRUITS[k + 5].name.toUpperCase();
  st.scrap = 1000;
  const ok = hireRecruit(st, RECRUITS[k + 5], rng).ok;
  out.push(`hire ${k} ${ok ? 1 : 0} ${st.party.map((c) => c.name).join('|')}`);
}
mkdirSync(join(ROOT, 'amiga', 'data', 'traces'), { recursive: true });
const file = join(ROOT, 'amiga', 'data', 'traces', 'names.txt');
writeFileSync(file, out.join('\n') + '\n');
console.log(`OK: ${file} (${out.length} linii)`);
