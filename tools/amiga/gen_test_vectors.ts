// Wektory testowe z amiga/data/test_vectors.json -> nagłówek C dla testów portu.
// Uruchom po node tools/amiga/export_data.ts:  node tools/amiga/gen_test_vectors.ts  ->  amiga/tests/vectors_dice.h
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const v: Any = JSON.parse(readFileSync(join(ROOT, 'amiga', 'data', 'test_vectors.json'), 'utf8'));

/** Unicode -> bajt ISO-8859-2 (odwrotność dekodera). */
const dec = new TextDecoder('iso-8859-2');
const toLatin2 = new Map<string, number>();
for (let b = 0xa0; b <= 0xff; b++) toLatin2.set(dec.decode(new Uint8Array([b])), b);
function cLatin2(s: string): string {
  let out = '"';
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (ch === '"' || ch === '\\') out += '\\' + ch;
    else if (c >= 32 && c < 127) out += ch;
    else {
      const byte = toLatin2.get(ch);
      if (byte === undefined) throw new Error('Znak spoza ISO-8859-2: ' + ch);
      out += '\\' + byte.toString(8).padStart(3, '0');
    }
  }
  return out + '"';
}
const u32 = (n: number): string => `${n >>> 0}UL`;
const list = (a: readonly (number | string)[]): string => `{${a.join(', ')}}`;

const L: string[] = [];
L.push(`/* Wygenerowane przez tools/amiga/gen_test_vectors.ts z amiga/data/test_vectors.json. NIE EDYTUJ RĘCZNIE. */
#ifndef VECTORS_DICE_H
#define VECTORS_DICE_H
#include <stdint.h>
`);

// hashSeed
L.push(`typedef struct { const char *s; uint32_t h; } VecHash;
static const VecHash VEC_HASH[] = {
${v.hashSeed.map((x: Any) => `  {${cLatin2(x.s)}, ${u32(x.h)}},`).join('\n')}
};
#define VEC_HASH_N (sizeof VEC_HASH / sizeof VEC_HASH[0])
`);

// mulberry32: ziarno liczbowe albo tekstowe
L.push(`typedef struct { const char *seed_str; uint32_t seed; uint8_t n; uint32_t u32[16]; } VecMulberry;
static const VecMulberry VEC_MULBERRY[] = {
${v.mulberry32.map((x: Any) => `  {${typeof x.seed === 'string' ? cLatin2(x.seed) : 'NULL'}, ${typeof x.seed === 'number' ? u32(x.seed) : '0UL'}, ${x.u32.length}, ${list(x.u32.map(u32))}},`).join('\n')}
};
#define VEC_MULBERRY_N (sizeof VEC_MULBERRY / sizeof VEC_MULBERRY[0])
`);

const D = v.dice;
L.push(`typedef struct { const char *seed; uint8_t sides; uint8_t values[24]; } VecDieSeq;
static const VecDieSeq VEC_DIE_SEQ[] = {
${D.seq.map((x: Any) => `  {${cLatin2(x.seed)}, ${x.sides}, ${list(x.values)}},`).join('\n')}
};
#define VEC_DIE_SEQ_N (sizeof VEC_DIE_SEQ / sizeof VEC_DIE_SEQ[0])

static const char *const VEC_RANDINT_SEED = ${cLatin2(D.randInts.seed)};
static const int32_t VEC_RANDINT_A = ${D.randInts.a}, VEC_RANDINT_B = ${D.randInts.b};
static const int8_t VEC_RANDINT[24] = ${list(D.randInts.values)};
`);

const parse = (expr: string): [number, number, number] => {
  const m = /^(\d*)d(\d+)([+-]\d+)?$/.exec(expr);
  if (m) return [m[1] === '' ? 1 : Number(m[1]), Number(m[2]), m[3] ? Number(m[3]) : 0];
  return [0, 0, Number(expr)];
};
L.push(`typedef struct { const char *seed; uint8_t n, sides; int8_t mod; uint8_t halves; int16_t total; uint8_t values[8]; } VecRoll;
static const VecRoll VEC_ROLL[] = {
${D.rolls.map((x: Any) => {
  const [n, s, m] = parse(x.expr);
  return `  {${cLatin2(x.seed)}, ${n}, ${s}, ${m}, ${x.halves}, ${x.total}, ${list(x.values.length ? x.values : [0])}},`;
}).join('\n')}
};
#define VEC_ROLL_N (sizeof VEC_ROLL / sizeof VEC_ROLL[0])

/* Testy k20: ten sam strumień (seed) dla kolejnych k = 0..5. */
typedef struct { const char *seed; uint8_t k; int8_t mod; uint8_t dc, halves, raw, d20; int16_t total; uint8_t degree; } VecCheck;
static const VecCheck VEC_CHECK[] = {
${D.checks.map((x: Any) => `  {${cLatin2(x.seed)}, ${x.k}, ${x.mod}, ${x.dc}, ${x.halves}, ${x.raw}, ${x.d20}, ${x.total}, ${x.degree}},`).join('\n')}
};
#define VEC_CHECK_N (sizeof VEC_CHECK / sizeof VEC_CHECK[0])

typedef struct { int8_t mod; uint8_t dc, halves, hit20, crit20; } VecChance;
static const VecChance VEC_CHANCE[] = {
${D.chances.map((x: Any) => `  {${x.mod}, ${x.dc}, ${x.halves}, ${x.hit20}, ${x.crit20}},`).join('\n')}
};
#define VEC_CHANCE_N (sizeof VEC_CHANCE / sizeof VEC_CHANCE[0])

#endif
`);

const out = join(ROOT, 'amiga', 'tests', 'vectors_dice.h');
writeFileSync(out, L.join('\n'));
console.log('OK: ' + out);

// ------------------------------------------------------------------ karty postaci (vectors_char.h)
const up = (s: string): string => s.toUpperCase().replace(/[^A-Z0-9]+/g, '_');
const ITEM = (id: string | null): string => (id === null ? 'ITEM_NONE' : id === 'fist' ? 'ITEM_FIST' : 'ITEM_' + up(id));
const STAT_KEY: Record<string, string> = {
  ac: 'STAT_AC', speed: 'STAT_SPEED', perception: 'STAT_PERCEPTION', classDC: 'STAT_CLASS_DC', fortitude: 'STAT_FORT', reflex: 'STAT_REF', will: 'STAT_WILL',
};
const statKey = (k: string): string => STAT_KEY[k] ?? 'SKILL_' + up(k);
const ATTR_ORDER = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
function sheetRow(x: Any, kind: 0 | 1): string {
  const who = kind === 0 ? `RECRUIT_${up(x.id)}` : `ENEMY_${up(x.id)}`;
  const arg = kind === 0 ? x.level : x.levelAdj;
  const uses = Object.entries(x.uses as Record<string, number>).map(([k, n]) => `{ABIL_${up(k)}, ${n}}`);
  const stats = Object.entries(x.stats as Record<string, number>).map(([k, n]) => `{${statKey(k)}, ${n}}`);
  const atks = x.attacks.map((a: Any) => {
    const [n, s, m] = parse(a.dmg);
    return `{{${n}, ${s}, ${m}}, ${a.range}, ${list(a.bonus)}}`;
  });
  const eq = ['weapon', 'weapon2', 'armor', 'shield'].map((s) => ITEM(x.equipment[s]));
  const inv = x.inventory.map(([id, q]: [string, number]) => `{${ITEM(id)}, ${q}}`);
  return `  {${kind}, ${who}, ${arg}, ${x.level}, ${x.maxHp}, ${list(ATTR_ORDER.map((a) => x.attrs[a]))},\n` +
    `   ${x.abilities.length}, ${list(x.abilities.map((a: string) => 'ABIL_' + up(a)))}, ${uses.length}, {${uses.join(', ') || '{0, 0}'}},\n` +
    `   ${list(eq)}, ${inv.length}, {${inv.join(', ') || '{0, 0}'}},\n   ${stats.length}, {${stats.join(', ')}},\n   ${atks.length}, {${atks.join(', ')}}},`;
}
const CL: string[] = [`/* Wygenerowane przez tools/amiga/gen_test_vectors.ts z amiga/data/test_vectors.json. NIE EDYTUJ RĘCZNIE. */
#ifndef VECTORS_CHAR_H
#define VECTORS_CHAR_H
#include <stdint.h>
#include "../src/core/character.h"

typedef struct { uint8_t id, n; } VecUse;
typedef struct { uint8_t id, qty; } VecInv;
typedef struct { int16_t key, value; } VecStat;
typedef struct { Dice dmg; uint8_t range; int8_t bonus[3]; } VecAttack;
/* kind 0: rekrut (who = RecruitId, arg = poziom); kind 1: wróg (who = EnemyId, arg = levelAdj) */
typedef struct {
  uint8_t kind, who; int8_t arg;
  uint8_t level; int16_t max_hp; int8_t attrs[6];
  uint8_t n_abil, abil[16];
  uint8_t n_uses; VecUse uses[8];
  uint8_t equip[4];
  uint8_t n_inv; VecInv inv[8];
  uint8_t n_stats; VecStat stats[24];
  uint8_t n_attacks; VecAttack attacks[2];
} VecSheet;

static const VecSheet VEC_SHEETS[] = {
${[...v.recruits.map((x: Any) => sheetRow(x, 0)), ...v.enemies.map((x: Any) => sheetRow(x, 1))].join('\n')}
};
#define VEC_SHEETS_N (sizeof VEC_SHEETS / sizeof VEC_SHEETS[0])

#endif
`];
const outC = join(ROOT, 'amiga', 'tests', 'vectors_char.h');
writeFileSync(outC, CL.join('\n'));
console.log('OK: ' + outC);
