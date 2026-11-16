// Eksport danych i wektorów testowych dla portu na A1200 + PiStorm (C99 + miniGL).
// Uruchom: node tools/amiga/export_data.ts   (Node >= 22.18 usuwa typy sam; zero Phasera / DOM)
// Wynik:
//   amiga/data/game_data.json     - wszystkie tabele treści i stałe zasad (źródło dla generatora nagłówków C)
//   amiga/data/test_vectors.json  - oczekiwane wyniki (RNG, hash, statystyki postaci, mapy, ataki) do testów portu
//   amiga/data/region_height.bin  - wypieczona siatka wysokości regionu: int16 big-endian (68k), 145 x 97, Q8
// Dane są brane wprost z src/core, więc po każdej zmianie zasad wystarczy uruchomić skrypt ponownie.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ABILITIES, ANCESTRIES, ANCESTRY_ALIASES, ATTRS, ATTR_NAMES, BASE_AC, CLASSES, CONDITIONS, COVER_AC, DC_TABLE, DEGREE_NAMES, DMG_ADJ, DYING_MAX,
  ENCOUNTER_XP, ENEMIES, EPILOGUE, EVENTS, GAME_SUBTITLE, GAME_TITLE, GAMEOVER_LINES, INTRO_SLIDES, ITEMS, MAP, MAP_H, MAP_W, MAX_LEVEL,
  PERSISTENT, PERSISTENT_END_DC, PROF_NAMES, RECRUITS, SKILLS, STORY_CONTRACTS, TIPS, UNIVERSAL_ABILITIES, XP_PER_LEVEL, ACTIONS_PER_TURN,
  LOCKS, DEVICES, PROP_KIND, SIDE_TYPES, BIOME_NAMES, TYPE_NAMES, FACTION_NAMES, MOOD_NAMES, EVENT_CHANCE, EXTRACTION_OBJECTIVES,
  SIGHT_PC, SIGHT_NEUTRAL, CRATE_SKILLS, LOCK_SKILLS, HACK_SKILLS, IMPROVISED_PENALTY, CREDITS,
  createCharacter, createEnemy, generateMap, getAttackBonus, getStat, getWeapons, hashSeed, makeRng, normWeapon, recruitCharacter, strike,
  allEnemyIds, CellKind, HMAP, heightGrid, SECTORS, HOME, CITY, GATE, CRATER, PLAZAS, d, roll, check, hitChances, randInt,
  type Biome, type Character, type StatKey,
} from '../../src/core/index.ts';
import { FAUNA_CHANCE, FAUNA_KINDS, faunaAttackEvent } from '../../src/core/campaign/events.ts';
import { SIN_LUT, EASE_OUT3_LUT, TICK_HZ, Q12, Q8 } from '../../src/core/frontend/fixed.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = join(ROOT, 'amiga', 'data');
mkdirSync(OUT, { recursive: true });

// ---------------------------------------------------------------- game_data.json
const gameData = {
  _info: 'Wygenerowane przez tools/amiga/export_data.ts z src/core. Nie edytuj ręcznie.',
  rules: {
    ACTIONS_PER_TURN, XP_PER_LEVEL, MAX_LEVEL, BASE_AC, DYING_MAX, PERSISTENT_END_DC, MAP, COVER_AC, DC_TABLE, ENCOUNTER_XP,
    ATTRS, ATTR_NAMES, SKILLS, CONDITIONS, PERSISTENT, UNIVERSAL_ABILITIES, DMG_ADJ, PROF_NAMES, DEGREE_NAMES,
    IMPROVISED_PENALTY, CRATE_SKILLS, LOCK_SKILLS, HACK_SKILLS, LOCKS, DEVICES,
  },
  ancestries: ANCESTRIES,
  ancestryAliases: ANCESTRY_ALIASES,
  classes: CLASSES,
  items: ITEMS,
  enemies: ENEMIES,
  abilities: ABILITIES,
  recruits: RECRUITS,
  tactical: { MAP_W, MAP_H, CellKind, PROP_KIND, SIGHT_PC, SIGHT_NEUTRAL, EXTRACTION_OBJECTIVES },
  campaign: {
    SIDE_TYPES, BIOME_NAMES, TYPE_NAMES, FACTION_NAMES, MOOD_NAMES, STORY_CONTRACTS, EVENT_CHANCE, EVENTS,
    FAUNA_CHANCE, FAUNA_KINDS, faunaAttackTemplate: faunaAttackEvent('{name}'),
  },
  region: { HMAP, HOME, CITY, GATE, CRATER, PLAZAS, SECTORS },
  story: { GAME_TITLE, GAME_SUBTITLE, INTRO_SLIDES, EPILOGUE, GAMEOVER_LINES, TIPS, CREDITS },
  fixed: { TICK_HZ, Q12, Q8, SIN_LUT: Array.from(SIN_LUT), EASE_OUT3_LUT: Array.from(EASE_OUT3_LUT) },
};
writeFileSync(join(OUT, 'game_data.json'), JSON.stringify(gameData, null, 1) + '\n');

// ---------------------------------------------------------------- region_height.bin (int16 BE)
const hg = heightGrid();
const hb = Buffer.alloc(hg.length * 2);
hg.forEach((v, i) => hb.writeInt16BE(v, i * 2));
writeFileSync(join(OUT, 'region_height.bin'), hb);

// ---------------------------------------------------------------- test_vectors.json
/** mulberry32 jako uint32 (rng() * 2^32 jest dokładne). */
const rngU32 = (seed: number | string, n: number): number[] => {
  const r = makeRng(seed);
  return Array.from({ length: n }, () => r() * 4294967296);
};

const STAT_KEYS: StatKey[] = ['ac', 'speed', 'perception', 'classDC', 'fortitude', 'reflex', 'will',
  'athletics', 'acrobatics', 'stealth', 'thievery', 'crafting', 'society', 'medicine', 'survival', 'nature', 'intimidation', 'diplomacy', 'deception'];
const sheet = (ch: Character) => ({
  name: ch.name, level: ch.level, maxHp: ch.maxHp, attrs: ch.attrs, abilities: ch.abilities, uses: ch.uses,
  equipment: Object.fromEntries(Object.entries(ch.equipment).map(([k, v]) => [k, v?.id ?? null])),
  inventory: ch.inventory.map((i) => [i.id, i.qty]),
  stats: Object.fromEntries(STAT_KEYS.map((k) => [k, getStat(ch, k)])),
  attacks: getWeapons(ch).map((w) => {
    const n = normWeapon(w);
    return { name: n.name, dmg: n.dmg, range: n.range, bonus: [0, 1, 2].map((m) => getAttackBonus(ch, w, m)) };
  }),
});

const recruits = RECRUITS.flatMap((r) => [1, 5, 10].map((lvl) => ({ id: r.id, ...sheet(recruitCharacter(r, r.name, lvl)) })));
const enemies = allEnemyIds().flatMap((id) => [-1, 0, 1].map((adj) => ({ id, levelAdj: adj, ...sheet(createEnemy(id, { levelAdj: adj })) })));

// Deterministyczne ataki: każdy rekrut lvl 3 atakuje każdego wroga raz, RNG z ziarna (jeden strumień na parę).
const strikes: unknown[] = [];
for (const r of RECRUITS.slice(0, 8)) {
  for (const eid of ['raider_thug', 'ghoul', 'robot', 'fly_swarm'] as const) {
    const seed = `strike:${r.id}:${eid}`;
    const att = recruitCharacter(r, r.name, 3);
    const def = createEnemy(eid);
    const res = strike(att, def, { rng: makeRng(seed) });
    strikes.push({
      seed, attacker: r.id, attackerLevel: 3, defender: eid, d20: res.d20?.d20, total: res.d20?.total, dc: res.d20?.dc, degree: res.d20?.degree,
      dice: res.dmg?.dice.map((x) => x.value), post: res.dmg?.post.map((x) => x.value), dealt: res.dealt ?? 0, defenderHp: def.hp,
    });
  }
}

// Mapy: siatka kolizji jako tekst (32 wiersze po 32 znaki 0..3) + rozstawienie.
const BIOMES: Biome[] = ['ruins', 'wastes', 'industrial', 'bunker'];
const maps = BIOMES.flatMap((biome) => ['alpha', 'beta', 'gamma'].map((s) => {
  const id = `vec_${biome}_${s}`;
  const enemiesIn = ['raider_thug', 'raider_gunner', 'dog_mutant', 'raider_psycho', 'drone', 'raider_chief'] as const;
  const m = generateMap({ id, biome, level: 3, type: 'eliminate' }, [...enemiesIn]);
  const rows: string[] = [];
  for (let y = 0; y < m.height; y++) rows.push(Array.from(m.grid.cells.slice(y * m.width, (y + 1) * m.width)).join(''));
  return {
    id, biome, seed: m.seed, cells: rows,
    floor: Array.from({ length: m.height }, (_, y) => m.floor.slice(y * m.width, (y + 1) * m.width).map((f) => f[0]).join('')),
    entry: { x0: m.entry.x0, y0: m.entry.y0 },
    objCell: m.objCell, maxD: m.maxD,
    groups: m.groups.map((g) => ({ center: [g.center.gx, g.center.gy], members: g.members, cells: g.cells.map((c) => [c.gx, c.gy]), roam: !!g.roam })),
    crates: m.crates.map((c) => [c.gx, c.gy]),
    finds: m.finds.map((f) => [f.gx, f.gy, f.kind, f.hidden]),
    props: m.props.map((p) => [p.gx, p.gy, p.type, p.rot]),
    buildings: m.buildings.map((b) => [b.gx, b.gy, b.w, b.d, b.h]),
  };
}));

// Linia strzału: z 4 pól startowych na 4 mapach do każdego pola. Znak na pole: 0 brak linii, 1 czysta, 2 czysta z osłoną.
const los = BIOMES.map((biome) => {
  const id = `vec_${biome}_alpha`;
  const m = generateMap({ id, biome, level: 3, type: 'eliminate' }, []);
  const origins = [m.reach[0], m.reach[m.reach.length >> 2], m.reach[m.reach.length >> 1], m.reach[m.reach.length - 1]];
  return {
    map: id,
    from: origins.map((o) => {
      let s = '';
      for (let y = 0; y < m.height; y++) for (let x = 0; x < m.width; x++) {
        const r = m.grid.los(o, { gx: x, gy: y });
        s += r.clear ? (r.cover ? '2' : '1') : '0';
      }
      return { gx: o.gx, gy: o.gy, rows: Array.from({ length: m.height }, (_, y) => s.slice(y * m.width, (y + 1) * m.width)) };
    }),
  };
});

// Kości: sekwencje rzutów, wyrażenia (z połowieniem), testy k20, szanse trafienia.
const diceSeq = [20, 6, 4, 8, 10, 12].map((sides) => {
  const seed = `dice:d${sides}`;
  const r = makeRng(seed);
  return { seed, sides, values: Array.from({ length: 24 }, () => d(sides, r)) };
});
const randInts = (() => {
  const r = makeRng('dice:randint');
  return { seed: 'dice:randint', a: -3, b: 7, values: Array.from({ length: 24 }, () => randInt(-3, 7, r)) };
})();
const ROLL_EXPRS = ['1d4', '1d6+2', '2d6+4', '3d6+2', '1d12+8', '2d8+7', '4d6+6', '1d6-1', '5'];
const rolls = ROLL_EXPRS.flatMap((expr) => [0, 1, 2].map((halves) => {
  const seed = `roll:${expr}:${halves}`;
  const res = roll(expr, makeRng(seed), halves);
  return { seed, expr, halves, total: res.total, values: res.rolls, mod: res.mod };
}));
const checks: unknown[] = [];
for (const [mod, dc] of [[0, 10], [5, 15], [12, 18], [-2, 14], [20, 25], [7, 30], [3, 3]] as const) {
  for (const halves of [0, 1, 2]) {
    const seed = `check:${mod}:${dc}:${halves}`;
    const r = makeRng(seed);
    for (let k = 0; k < 6; k++) {
      const c = check(mod, dc, r, halves);
      checks.push({ seed, k, mod, dc, halves, raw: c.raw, d20: c.d20, total: c.total, degree: c.degree });
    }
  }
}
const chances: unknown[] = [];
for (let mod = -4; mod <= 24; mod += 4) for (const dc of [12, 16, 20, 24, 28]) for (const halves of [0, 1, 2]) {
  const h = hitChances(mod, dc, halves);
  chances.push({ mod, dc, halves, hit20: Math.round(h.hit * 20), crit20: Math.round(h.crit * 20) });
}

const vectors = {
  _info: 'Oczekiwane wyniki logiki z src/core. Port w C musi dawać identyczne liczby (patrz docs/AMIGA_PORT_SPEC.md, rozdz. "Determinizm").',
  hashSeed: ['x', 'alpha', 'k3_abcde', 'story1', 'vec_ruins_alpha', 'Zażółć gęślą jaźń'].map((s) => ({ s, h: hashSeed(s) })),
  mulberry32: [
    { seed: 12345, u32: rngU32(12345, 16) },
    { seed: 'story1', u32: rngU32('story1', 16) },
    { seed: 0, u32: rngU32(0, 8) },
  ],
  dice: { seq: diceSeq, randInts, rolls, checks, chances },
  recruits,
  enemies,
  strikes,
  maps,
  los,
};
writeFileSync(join(OUT, 'test_vectors.json'), JSON.stringify(vectors, null, 1) + '\n');

console.log(`OK: ${OUT}`);
console.log(`  game_data.json, test_vectors.json (${recruits.length} kart rekrutów, ${enemies.length} wrogów, ${strikes.length} ataków, ${maps.length} map), region_height.bin (${hg.length} x int16)`);
