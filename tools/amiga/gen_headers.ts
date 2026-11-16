// Generator nagłówków C99 dla portu na A1200 + PiStorm (miniGL) z tabel w src/core.
// Uruchom: node tools/amiga/gen_headers.ts   ->  amiga/src/data/gamedata.h + gamedata.c
// Po każdej zmianie danych w src/core/data uruchom ponownie (i node tools/amiga/export_data.ts dla wektorów).
//
// Konwencje:
//  - id z TS -> enum (ITEM_KNIFE, ENEMY_RAT_MUTANT ...) w tej samej kolejności co w TS; pole `key` trzyma tekstowe id (zapisy gry).
//  - kości "NdS+K" -> Dice {n, sides, mod}; liczba bez kości -> {0, 0, K}.
//  - prawdopodobieństwo p (rng() < p) -> próg `le` (uint32): sukces gdy u32 z mulberry32 <= le  (le = ceil(p * 2^32) - 1).
//  - teksty w ISO-8859-2 (polskie litery), znaki spoza Latin-2 zamienione na ASCII; bajty > 127 jako ósemkowe \ooo.
//  - brak wartości: 0xFF (uint8), -1 (int8/int16), 0xFFFFFFFF (kolor).
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ABILITIES, ANCESTRIES, ATTRS, ATTR_NAMES, CLASSES, CONDITIONS, COVER_AC, DC_TABLE, DEGREE_NAMES, DMG_ADJ, ENCOUNTER_XP, ENEMIES, EPILOGUE,
  EVENTS, GAME_SUBTITLE, GAME_TITLE, GAMEOVER_LINES, INTRO_SLIDES, ITEMS, MAP, PERSISTENT, PROF_NAMES, RECRUITS, SKILLS, STORY_CONTRACTS, TIPS,
  UNIVERSAL_ABILITIES, LOCKS, DEVICES, BIOME_NAMES, TYPE_NAMES, FACTION_NAMES, MOOD_NAMES, EVENT_CHANCE, CREDITS,
  ACTIONS_PER_TURN, XP_PER_LEVEL, MAX_LEVEL, BASE_AC, DYING_MAX, PERSISTENT_END_DC, MAP_W, MAP_H, SIGHT_PC, SIGHT_NEUTRAL, IMPROVISED_PENALTY,
  MAX_PARTY,
} from '../../src/core/index.ts';
import { UNARMED } from '../../src/core/data/items.ts';
import { CONTRACT_TYPES, GIVERS, SIDE_TYPES, STORY_BUDGET, STORY_NEED } from '../../src/core/campaign/contracts.ts';
import { FAUNA_CHANCE, FAUNA_KINDS, faunaAttackEvent } from '../../src/core/campaign/events.ts';
import { EASE_OUT3_LUT, SIN_LUT } from '../../src/core/frontend/fixed.ts';
import { ANC as NAME_ANC, CALL as NAME_CALL, FEM as NAME_FEM, FIRST as NAME_FIRST, MASC as NAME_MASC, NICK as NAME_NICK, SURNAMES as NAME_SURNAMES, TITLE_HUMAN as NAME_TITLE_HUMAN } from '../../src/core/data/names.ts';
import { AVENUE_Z, CITY, CRATER, GATE, HALLS, HMAP, HOME, RING_N, RING_S, SECTORS, WQ, heightGrid } from '../../src/core/campaign/region.ts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = join(ROOT, 'amiga', 'src', 'data');
mkdirSync(OUT, { recursive: true });

// ------------------------------------------------------------------ pomocnicze
const fail = (msg: string): never => {
  throw new Error(msg);
};
const up = (s: string): string => s.toUpperCase().replace(/[^A-Z0-9]+/g, '_');
const keys = (o: object): string[] => Object.keys(o);

/** ISO-8859-2: polskie litery; reszta spoza ASCII zamieniana. */
const LATIN2: Record<string, number> = {
  'Ą': 0xa1, 'Ć': 0xc6, 'Ę': 0xca, 'Ł': 0xa3, 'Ń': 0xd1, 'Ó': 0xd3, 'Ś': 0xa6, 'Ź': 0xac, 'Ż': 0xaf,
  'ą': 0xb1, 'ć': 0xe6, 'ę': 0xea, 'ł': 0xb3, 'ń': 0xf1, 'ó': 0xf3, 'ś': 0xb6, 'ź': 0xbc, 'ż': 0xbf, '×': 0xd7,
};
const ASCII_SUB: Record<string, string> = {
  '—': '-', '–': '-', '−': '-', '„': '"', '”': '"', '“': '"', '’': "'", '…': '...', '·': '-', '½': '1/2', '→': '->', '←': '<-', '▶': '>', '◀': '<',
};
function cstr(s: string | null | undefined): string {
  if (s === null || s === undefined) return 'NULL';
  let out = '"';
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (ch === '"' || ch === '\\') out += '\\' + ch;
    else if (ch === '\n') out += '\\n';
    else if (c >= 32 && c < 127) out += ch;
    else if (LATIN2[ch] !== undefined) out += '\\' + LATIN2[ch].toString(8).padStart(3, '0');
    else if (ASCII_SUB[ch] !== undefined) out += ASCII_SUB[ch].replace(/["\\]/g, (m) => '\\' + m);
    else fail(`Znak spoza ISO-8859-2 bez zamiennika: "${ch}" (U+${c.toString(16)}) w: ${s}`);
  }
  return out + '"';
}

function dice(expr: string | number | undefined | null): string {
  if (expr === undefined || expr === null) return '{0, 0, 0}';
  const s = String(expr).replace(/\s+/g, '');
  const m = /^(\d*)d(\d+)([+-]\d+)?$/.exec(s);
  if (m) return `{${m[1] === '' ? 1 : Number(m[1])}, ${Number(m[2])}, ${m[3] ? Number(m[3]) : 0}}`;
  if (/^[+-]?\d+$/.test(s)) return `{0, 0, ${Number(s)}}`;
  return fail('Nieobsługiwane wyrażenie kości: ' + s);
}
const color = (hex: string | undefined): string => {
  if (!hex) return '0xFFFFFFFFUL';
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (!/^[0-9a-fA-F]{6}$/.test(h)) fail('Zły kolor: ' + hex);
  return '0x' + h.toUpperCase() + 'UL';
};
/** rng() < p  <=>  u32 <= le. */
const probLe = (p: number): string => {
  if (!(p > 0 && p <= 1)) fail('Prawdopodobieństwo poza (0, 1]: ' + p);
  return String(Math.ceil(p * 4294967296) - 1) + 'UL';
};
const b = (v: unknown): string => (v ? '1' : '0');
const arr = (items: string[], size: number, fill = '0'): string => {
  if (items.length > size) fail(`Za dużo elementów (${items.length} > ${size}): ${items.join(', ')}`);
  return '{' + [...items, ...Array(size - items.length).fill(fill)].join(', ') + '}';
};
const q8 = (v: number | undefined): number => Math.round((v ?? 1) * 256);

// ------------------------------------------------------------------ enumy
const enumBlock = (name: string, prefix: string, ids: readonly string[], extra: string[] = []): string =>
  `typedef enum {\n${ids.map((id, i) => `  ${prefix}${up(id)} = ${i},`).join('\n')}\n  ${prefix}COUNT = ${ids.length}${extra.length ? ',\n  ' + extra.join(',\n  ') : ''}\n} ${name};\n`;
const idx = (ids: readonly string[], prefix: string) => (id: string | undefined | null, none = 'NONE'): string => {
  if (id === undefined || id === null) return prefix + none;
  if (!ids.includes(id)) fail(`Nieznane id "${id}" dla ${prefix}`);
  return prefix + up(id);
};

const ATTR_IDS = [...ATTRS];
const SKILL_IDS = keys(SKILLS);
const COND_IDS = keys(CONDITIONS);
const ANC_IDS = keys(ANCESTRIES);
const CLASS_IDS = keys(CLASSES);
const ITEM_IDS = keys(ITEMS);
const ENEMY_IDS = keys(ENEMIES);
const ABIL_IDS = keys(ABILITIES);
const RECRUIT_IDS = RECRUITS.map((r) => r.id);
const DMG_IDS = ['P', 'S', 'B', 'fire', 'acid', 'elec', 'poison', 'bleed', 'rad'];
const ITYPE_IDS = ['weapon', 'armor', 'shield', 'consumable', 'junk', 'tech', 'ammo'];
const WCAT_IDS = ['simple', 'martial', 'advanced', 'unarmed'];
const DEF_IDS = ['unarmored', 'light', 'medium', 'heavy'];
const WGROUP_IDS = ['melee', 'bow', 'firearm', 'laser', 'unarmed'];
const SFX_IDS = ['melee', 'shot_pistol', 'shot_shotgun', 'shot_smg', 'shot_rifle', 'shot_laser', 'explosion'];
const WTRAIT_IDS = ['agile', 'finesse', 'forceful', 'sweep', 'shove', 'scatter', 'automatic', 'reach', 'thrown'];
const EFACTION_IDS = ['raider', 'mutant', 'beast', 'machine'];
const AI_IDS = ['melee', 'ranged', 'beast', 'coward', 'boss'];
const ETRAIT_IDS = ['animal', 'swarm', 'mutant', 'boss', 'machine'];
const SHAPE_IDS = ['quad', 'swarm', 'big', 'humanoid', 'drone', 'turret'];
const BODY_IDS = ['light', 'medium', 'heavy'];
const ATRAIT_IDS = ['human', 'humanoid', 'mutant', 'cyborg', 'machine', 'nomad', 'ratling', 'ogrin'];
const TARGET_IDS = ['self', 'ally', 'enemy', 'area', 'none'];
const FX_IDS = ['melee', 'buff', 'shout', 'heal', 'shot', 'explosion'];
const CEFFECT_IDS = ['heal', 'cleanse', 'damage', 'smoke', 'buff'];
const SAVE_IDS = ['fortitude', 'reflex', 'will'];
const CKIND_IDS = ['flag', 'decay', 'timed', 'persistent', 'consume', 'short'];
const USES_IDS = ['unlimited', 'encounter', 'day'];
const BIOME_IDS = keys(BIOME_NAMES);
const OBJ_IDS = keys(TYPE_NAMES);
const FACTION_IDS = keys(FACTION_NAMES);
const MOOD_IDS = keys(MOOD_NAMES);
const LOCK_IDS = keys(LOCKS);
const DEVICE_IDS = keys(DEVICES);

const ATTR = idx(ATTR_IDS, 'ATTR_');
const SKILL = idx(SKILL_IDS, 'SKILL_');
const COND = idx(COND_IDS, 'COND_');
const ANC = idx(ANC_IDS, 'ANC_');
const CLASS = idx(CLASS_IDS, 'CLASS_');
const ITEM = (id: string): string => (id === UNARMED.id ? 'ITEM_FIST' : idx(ITEM_IDS, 'ITEM_')(id));
const ENEMY = idx(ENEMY_IDS, 'ENEMY_');
const ABIL = idx(ABIL_IDS, 'ABIL_');
const DMG = idx(DMG_IDS, 'DMG_');
const ITYPE = idx(ITYPE_IDS, 'ITYPE_');
const WCAT = idx(WCAT_IDS, 'WCAT_');
const DEF = idx(DEF_IDS, 'DEF_');
const WGROUP = idx(WGROUP_IDS, 'WGROUP_');
const SFX = idx(SFX_IDS, 'SFX_');
const EFACTION = idx(EFACTION_IDS, 'EFACTION_');
const AI = idx(AI_IDS, 'AI_');
const SHAPE = idx(SHAPE_IDS, 'SHAPE_');
const BODY = idx(BODY_IDS, 'BODY_');
const TARGET = idx(TARGET_IDS, 'TARGET_');
const FX = idx(FX_IDS, 'FX_');
const CEFFECT = idx(CEFFECT_IDS, 'CEFFECT_');
const SAVE = idx(SAVE_IDS, 'SAVE_');
const CKIND = idx(CKIND_IDS, 'CKIND_');
const BIOME = idx(BIOME_IDS, 'BIOME_');
const OBJ = idx(OBJ_IDS, 'OBJ_');
const FACTION = idx(FACTION_IDS, 'FACTION_');
const MOOD = idx(MOOD_IDS, 'MOOD_');

const mask = (ids: readonly string[], prefix: string, list: readonly string[] | undefined): string => {
  const parts = (list ?? []).map((x) => {
    if (!ids.includes(x)) fail(`Nieznana flaga "${x}" dla ${prefix}`);
    return `${prefix}${up(x)}`;
  });
  return parts.length ? parts.join(' | ') : '0';
};
/** Cechy broni: flagi + kości deadly/fatal. */
function wtraits(list: readonly string[]): { flags: string; deadly: number; fatal: number } {
  let deadly = 0;
  let fatal = 0;
  const plain: string[] = [];
  for (const t of list) {
    const m = /^(deadly|fatal):(\d+)$/.exec(t);
    if (m) {
      if (m[1] === 'deadly') deadly = Number(m[2]);
      else fatal = Number(m[2]);
    } else plain.push(t);
  }
  return { flags: mask(WTRAIT_IDS, 'WT_', plain), deadly, fatal };
}
/** Tablica [DMG_COUNT] z mapy {typ: wartość}. */
const dmgArr = (m: Record<string, number> | undefined): string => '{' + DMG_IDS.map((d) => String(m?.[d] ?? 0)).join(', ') + '}';
const skillArr = (m: Record<string, number> | undefined): string => '{' + SKILL_IDS.map((s) => String(m?.[s] ?? 0)).join(', ') + '}';
const attrArr = (m: Record<string, number> | undefined): string => '{' + ATTR_IDS.map((a) => String(m?.[a] ?? 0)).join(', ') + '}';
/** Liczba + kolejność kluczy mapy umiejętności (JS zachowuje kolejność wstawienia; awans wybiera po stabilnym sortowaniu). */
const skillOrder = (m: Record<string, number> | undefined): string => {
  const k = keys(m ?? {});
  return `${k.length}, ${arr(k.map((s) => SKILL(s)), SKILL_IDS.length)}`;
};
// Progresja klas nie może dodawać nowych kluczy umiejętności (C dopisuje tylko z kolejności klasy + rasy).
for (const c of Object.values(CLASSES) as Any[]) {
  for (const p of Object.values(c.progression) as Any[]) {
    for (const s of keys(p.skills ?? {})) if (!(s in c.prof.skills)) fail(`Progresja klasy ${c.id} dodaje nową umiejętność ${s}`);
  }
}
for (const e of Object.values(ENEMIES) as Any[]) {
  for (const a of e.attacks) if (!/[+-]\d+$/.test(a.damage)) fail(`Atak wroga ${e.id} bez stałej premii (createEnemy jej nie zmieni): ${a.damage}`);
}
function prof(p: Any): string {
  const sc = (k: string): number => p?.[k] ?? 0;
  return `{${sc('perception')}, ${sc('fortitude')}, ${sc('reflex')}, ${sc('will')}, ${sc('classDC')}, ${skillArr(p?.skills)}, ` +
    `{${WCAT_IDS.map((c) => p?.attacks?.[c] ?? 0).join(', ')}}, {${DEF_IDS.map((c) => p?.defense?.[c] ?? 0).join(', ')}}}`;
}

// ------------------------------------------------------------------ nagłówek
const H: string[] = [];
const C: string[] = [];
H.push(`/* Wygenerowane przez tools/amiga/gen_headers.ts z src/core. NIE EDYTUJ RĘCZNIE. */
#ifndef GAMEDATA_H
#define GAMEDATA_H

#include <stdint.h>
#include <stddef.h>

/* Kości: n x k(sides) + mod. n = 0 -> sama stała. */
typedef struct { uint8_t n, sides; int8_t mod; } Dice;

#define NONE8 0xFF
#define COLOR_NONE 0xFFFFFFFFUL

/* ---- stałe zasad */
#define ACTIONS_PER_TURN ${ACTIONS_PER_TURN}
#define XP_PER_LEVEL ${XP_PER_LEVEL}
#define MAX_LEVEL ${MAX_LEVEL}
#define BASE_AC ${BASE_AC}
#define DYING_MAX ${DYING_MAX}
#define PERSISTENT_END_DC ${PERSISTENT_END_DC}
#define IMPROVISED_PENALTY (${IMPROVISED_PENALTY})
#define MAP_W ${MAP_W}
#define MAP_H ${MAP_H}
#define SIGHT_PC ${SIGHT_PC}
#define SIGHT_NEUTRAL ${SIGHT_NEUTRAL}
#define MAX_PARTY ${MAX_PARTY}
#define ACTIONS_REACTION 0xFF
/* rng() < p  <=>  u32 <= LE */
#define EVENT_CHANCE_LE ${probLe(EVENT_CHANCE)}
#define FAUNA_CHANCE_LE ${probLe(FAUNA_CHANCE)}
`);

H.push(enumBlock('AttrId', 'ATTR_', ATTR_IDS));
H.push(enumBlock('SkillId', 'SKILL_', SKILL_IDS, ['SKILL_NONE = 0xFF']));
H.push(enumBlock('ConditionId', 'COND_', COND_IDS, ['COND_NONE = 0xFF']));
H.push(enumBlock('AncestryId', 'ANC_', ANC_IDS));
H.push(enumBlock('ClassId', 'CLASS_', CLASS_IDS, ['CLASS_NONE = 0xFF']));
H.push(enumBlock('ItemId', 'ITEM_', ITEM_IDS, [`ITEM_FIST = ${ITEM_IDS.length} /* Pięść (broń domyślna), poza sklepem */`, 'ITEM_NONE = 0xFF']));
H.push(enumBlock('EnemyId', 'ENEMY_', ENEMY_IDS, ['ENEMY_NONE = 0xFF']));
H.push(enumBlock('AbilityId', 'ABIL_', ABIL_IDS, ['ABIL_NONE = 0xFF']));
H.push(enumBlock('RecruitId', 'RECRUIT_', RECRUIT_IDS));
H.push(enumBlock('DamageType', 'DMG_', DMG_IDS, ['DMG_NONE = 0xFF']));
H.push(enumBlock('ItemType', 'ITYPE_', ITYPE_IDS));
H.push(enumBlock('WeaponCategory', 'WCAT_', WCAT_IDS));
H.push(enumBlock('DefenseCategory', 'DEF_', DEF_IDS));
H.push(enumBlock('WeaponGroup', 'WGROUP_', WGROUP_IDS));
H.push(enumBlock('AttackSfx', 'SFX_', SFX_IDS));
H.push(enumBlock('EnemyFaction', 'EFACTION_', EFACTION_IDS));
H.push(enumBlock('EnemyAI', 'AI_', AI_IDS));
H.push(enumBlock('EnemyShape', 'SHAPE_', SHAPE_IDS));
H.push(enumBlock('BodyType', 'BODY_', BODY_IDS, ['BODY_NONE = 0xFF']));
H.push(enumBlock('TargetKind', 'TARGET_', TARGET_IDS));
H.push(enumBlock('AbilityFx', 'FX_', FX_IDS));
H.push(enumBlock('ConsumableEffect', 'CEFFECT_', CEFFECT_IDS));
H.push(enumBlock('SaveId', 'SAVE_', SAVE_IDS, ['SAVE_NONE = 0xFF']));
H.push(enumBlock('ConditionKind', 'CKIND_', CKIND_IDS));
H.push(enumBlock('UsesKind', 'USES_', USES_IDS));
H.push(enumBlock('Biome', 'BIOME_', BIOME_IDS));
H.push(enumBlock('ObjectiveType', 'OBJ_', OBJ_IDS));
H.push(enumBlock('FactionId', 'FACTION_', FACTION_IDS, ['FACTION_NONE = 0xFF']));
H.push(enumBlock('Mood', 'MOOD_', MOOD_IDS));
H.push(enumBlock('LockQuality', 'LOCK_', LOCK_IDS));
H.push(enumBlock('DeviceKind', 'DEVICE_', DEVICE_IDS));

const flagEnum = (prefix: string, ids: readonly string[], comment: string): string =>
  `/* ${comment} */\n${ids.map((id, i) => `#define ${prefix}${up(id)} (1u << ${i})`).join('\n')}\n`;
H.push(flagEnum('WT_', WTRAIT_IDS, 'cechy broni (bitmaska); deadly/fatal jako osobne pola z kością'));
H.push(flagEnum('ET_', ETRAIT_IDS, 'cechy wrogów (bitmaska)'));
H.push(flagEnum('AT_', ATRAIT_IDS, 'cechy ras (bitmaska)'));
H.push(`/* bitmaska typów obrażeń: (1u << DMG_x); bitmaska stanów: (1UL << COND_x) */\n`);

H.push(`/* ---- struktury */
typedef struct {
  uint8_t perception, fortitude, reflex, will, class_dc;
  uint8_t skills[SKILL_COUNT];
  uint8_t attacks[WCAT_COUNT];
  uint8_t defense[DEF_COUNT];
} Prof; /* rangi 0..4; progresja klasy: scalanie przez max */

typedef struct { const char *name; uint8_t attr; } SkillDef;

typedef struct {
  const char *key, *name, *desc;
  uint8_t kind;      /* ConditionKind */
  uint8_t valued;
  uint8_t dmg_type;  /* DamageType dla obrażeń ciągłych, inaczej DMG_NONE */
  uint8_t hidden;
} ConditionDef;

typedef struct {
  const char *key, *name, *pf2e, *desc, *perk;
  uint8_t hp, speed;
  int8_t attr_boost[ATTR_COUNT];
  uint8_t free_boosts;              /* rozdawane wg ClassDef.boost_order */
  int8_t attr_flaw[ATTR_COUNT];
  uint16_t traits;                  /* AT_* */
  uint8_t skills[SKILL_COUNT];
  uint8_t n_skill_order, skill_order[SKILL_COUNT]; /* kolejność kluczy umiejętności z TS (awans co 2 poziomy) */
  int8_t ac_bonus;
  int8_t resist[DMG_COUNT], weak[DMG_COUNT];
  uint8_t n_skin, n_hair;
  uint32_t skin[4], hair[4];
  uint8_t mutation, cyber;
} AncestryDef;

typedef struct {
  const char *key, *name, *pf2e, *role, *desc;
  uint8_t key_attr, hp_per_level;
  uint32_t color;
  int8_t attrs[ATTR_COUNT];
  uint8_t boost_order[4];
  Prof prof;
  uint8_t n_skill_order, skill_order[SKILL_COUNT]; /* kolejność kluczy prof.skills z TS */
  uint8_t n_start_gear;
  uint8_t start_gear[8];            /* ItemId */
  uint8_t n_abilities;
  uint8_t abilities[6];             /* AbilityId */
  uint8_t unlock_level[6];
  Prof progression[MAX_LEVEL + 1];  /* [poziom]; same zera = brak zmian */
} ClassDef;

typedef struct {
  Dice damage;
  uint8_t dmg_type, range, category, hands;
  uint16_t traits;                  /* WT_* */
  uint8_t deadly, fatal;            /* kość cechy albo 0 */
  uint8_t group, sfx, potency, ammo, tech;
} WeaponStats;

typedef struct { uint8_t ac, dex_cap, check_penalty, speed_penalty, category, tech; } ArmorStats; /* category: DefenseCategory */
typedef struct { uint8_t ac, hardness, hp; } ShieldStats;

typedef struct { int8_t num; Dice dice; } CondValue; /* dice.sides > 0 -> wartość to kość (obrażenia ciągłe) */
typedef struct { uint8_t cond; int8_t value; } CondBuff;

typedef struct {
  uint8_t effect, actions, target, range, radius;
  Dice amount;
  uint8_t dmg_type, save, dc;
  uint32_t cures;                   /* bitmaska stanów */
  uint8_t cond;                     /* COND_NONE gdy brak */
  CondValue cond_value;
  uint8_t n_buffs;
  CondBuff buffs[2];
  uint8_t only_machine;
} ConsumableStats;

typedef struct {
  const char *key, *name, *desc, *icon;
  uint8_t type;                     /* ItemType */
  uint16_t price;
  uint8_t level;
  const WeaponStats *weapon;
  const ArmorStats *armor;
  const ShieldStats *shield;
  const ConsumableStats *consumable;
} ItemDef;

typedef struct {
  const char *name;
  int8_t bonus;
  Dice damage;
  uint8_t dmg_type, range;
  uint16_t traits;                  /* WT_* */
  uint8_t deadly, fatal, sfx;
} EnemyAttack;

typedef struct { uint8_t item, qty; uint32_t chance_le; } LootEntry;

typedef struct {
  uint8_t shape;
  uint32_t skin, accent, cloth, hair;
  uint16_t scale_q8;
  uint8_t body;                     /* BODY_NONE gdy brak */
  uint8_t mask, mutation, cyber;
} EnemyLook;

typedef struct {
  const char *key, *name, *acc, *desc;
  uint8_t level;
  uint16_t hp;
  uint8_t ac;
  int8_t fort, ref, will, perception;
  uint8_t speed, faction, ai;
  uint16_t traits;                  /* ET_* */
  uint8_t n_attacks;
  EnemyAttack attacks[2];
  uint8_t n_abilities;
  uint8_t abilities[3];
  uint8_t n_loot;
  LootEntry loot[5];
  uint16_t scrap_min, scrap_max;
  int8_t resist[DMG_COUNT], weak[DMG_COUNT];
  uint16_t immune;                  /* (1u << DMG_x) */
  EnemyLook look;
} EnemyDef;

typedef struct {
  const char *key, *name, *desc, *icon;
  uint8_t actions;                  /* ACTIONS_REACTION = reakcja */
  uint8_t target, range, radius;
  uint8_t uses, uses_max;           /* UsesKind */
  uint8_t move, fx;
} AbilityDef;

typedef struct {
  uint8_t body;                     /* BODY_NONE = z klasy */
  uint32_t skin, hair, cloth, accent; /* COLOR_NONE = z rasy/klasy */
  int8_t hair_style;                /* -1 = z hasha imienia */
  int8_t mask, mutation, cyber;     /* -1 = z rasy */
} RecruitLook;

typedef struct {
  const char *key, *name, *bio;
  char gender;                      /* 'm' / 'f' */
  uint8_t ancestry, class_id;
  RecruitLook look;
} RecruitDef;

typedef struct { const char *name; uint8_t level, dc, successes; } LockDef;
typedef struct { const char *name; int8_t level_offset; uint8_t successes; } DeviceDef;

/* ---- zdarzenia podróży */
#define ITEMSPEC_ANY (-1)          /* '@any': broń/pancerz/tarcza/konsumabelka/tech */
#define ITEMSPEC_TYPE(t) (-2 - (t)) /* '@typ' -> ITEMSPEC_TYPE(ITYPE_x) */
typedef struct {
  const char *text;
  int16_t scrap;
  uint8_t n_items;
  int16_t items[3];                 /* ItemId albo ITEMSPEC_* */
  Dice hp;                          /* obrażenia losowego członka drużyny */
  int8_t rep[FACTION_COUNT];
  int16_t xp;
  int8_t days;
} EventOutcome;
typedef struct {
  const char *label;
  uint8_t skill;                    /* SKILL_NONE = bez testu (sukces) */
  uint8_t dc;                       /* 0 = ST wg poziomu zlecenia */
  const EventOutcome *out[4];       /* [stopień 0..3], NULL = brak */
} EventChoice;
typedef struct {
  const char *key, *title, *text;
  uint8_t weight, n_choices;
  EventChoice choices[3];
} TravelEvent;

/* ---- zlecenia */
typedef struct {
  uint8_t factions;                 /* (1u << EFACTION_x) */
  uint8_t n_biomes, biomes[3];
  uint8_t n_moods, moods[4];
  uint8_t n_titles; const char *titles[6];
  uint8_t n_descs; const char *descs[3];
  uint8_t giver;                    /* FACTION_NONE = losowo */
} ContractTemplate;
typedef struct {
  const char *key, *title, *giver, *desc;
  uint8_t faction, type, level, biome, mood, travel_days;
  uint16_t reward_scrap, reward_xp;
  int8_t reward_rep[FACTION_COUNT];
  uint8_t n_enemies, enemies[8];
} StoryContract;
typedef struct { uint8_t completed, rep; } StoryNeed;

/* ---- tabele */
extern const SkillDef SKILL_DEFS[SKILL_COUNT];
extern const ConditionDef CONDITION_DEFS[COND_COUNT];
extern const AncestryDef ANCESTRY_DEFS[ANC_COUNT];
extern const ClassDef CLASS_DEFS[CLASS_COUNT];
extern const ItemDef ITEM_DEFS[ITEM_COUNT + 1]; /* + ITEM_FIST */
extern const EnemyDef ENEMY_DEFS[ENEMY_COUNT];
extern const AbilityDef ABILITY_DEFS[ABIL_COUNT];
extern const RecruitDef RECRUIT_DEFS[RECRUIT_COUNT];
extern const LockDef LOCK_DEFS[LOCK_COUNT];
extern const DeviceDef DEVICE_DEFS[DEVICE_COUNT];
extern const TravelEvent TRAVEL_EVENTS[${EVENTS.length}];
#define TRAVEL_EVENT_COUNT ${EVENTS.length}
extern const TravelEvent FAUNA_ATTACK_EVENT; /* teksty z {N} = nazwa wielką literą, {n} = nazwa */
extern const char *const FAUNA_NAMES[${FAUNA_KINDS.length}];
extern const char *const FAUNA_TEMPLATE_KEYS[${FAUNA_KINDS.length}];
#define FAUNA_KIND_COUNT ${FAUNA_KINDS.length}
extern const ContractTemplate CONTRACT_TEMPLATES[OBJ_COUNT]; /* indeks = ObjectiveType; OBJ_BOSS puste */
extern const uint8_t SIDE_TYPES[${SIDE_TYPES.length}];
#define SIDE_TYPE_COUNT ${SIDE_TYPES.length}
extern const char *const GIVERS[FACTION_COUNT][5];
extern const StoryContract STORY_CONTRACTS[${STORY_CONTRACTS.length}];
#define STORY_CONTRACT_COUNT ${STORY_CONTRACTS.length}
extern const StoryNeed STORY_NEED[${STORY_NEED.length}];
extern const uint8_t STORY_BUDGET[${STORY_BUDGET.length}];

extern const uint8_t DC_TABLE[${DC_TABLE.length}];
#define DC_TABLE_LEN ${DC_TABLE.length}
extern const uint8_t ENCOUNTER_XP[9];   /* [roznica_poziomow + 4], roznica -4..4 */
extern const int8_t MAP_PENALTY[2][3];  /* [0] zwykla, [1] agile */
extern const uint8_t COVER_AC[3];       /* [in_cover] */
extern const uint8_t UNIVERSAL_ABILITIES[${UNIVERSAL_ABILITIES.length}];
#define UNIVERSAL_ABILITY_COUNT ${UNIVERSAL_ABILITIES.length}
extern const uint8_t PERSISTENT_CONDS[${PERSISTENT.length}];
#define PERSISTENT_COUNT ${PERSISTENT.length}

extern const char *const ATTR_NAMES[ATTR_COUNT];
extern const char *const DMG_ADJ[DMG_COUNT];
extern const char *const PROF_NAMES[5];
extern const char *const DEGREE_NAMES[4];
extern const char *const BIOME_NAMES[BIOME_COUNT];
extern const char *const OBJECTIVE_NAMES[OBJ_COUNT];
extern const char *const FACTION_NAMES[FACTION_COUNT];
extern const char *const MOOD_NAMES[MOOD_COUNT];

extern const char *const GAME_TITLE;
extern const char *const GAME_SUBTITLE;
extern const char *const INTRO_SLIDES[${INTRO_SLIDES.length}];
#define INTRO_SLIDE_COUNT ${INTRO_SLIDES.length}
extern const char *const EPILOGUE[${EPILOGUE.length}];
#define EPILOGUE_COUNT ${EPILOGUE.length}
extern const char *const GAMEOVER_LINES[${GAMEOVER_LINES.length}];
extern const char *const TIPS[${TIPS.length}];
extern const char *const CREDITS[${CREDITS.length}][2];
#define CREDITS_COUNT ${CREDITS.length}

extern const int16_t SIN_LUT[${SIN_LUT.length}];
extern const uint16_t EASE_OUT3_LUT[${EASE_OUT3_LUT.length}];
`);

// ------------------------------------------------------------------ dane
C.push(`/* Wygenerowane przez tools/amiga/gen_headers.ts z src/core. NIE EDYTUJ RĘCZNIE. Teksty: ISO-8859-2. */
#include "gamedata.h"
`);

C.push(`const SkillDef SKILL_DEFS[SKILL_COUNT] = {\n${SKILL_IDS.map((k) => {
  const s = (SKILLS as Any)[k];
  return `  {${cstr(s.name)}, ${ATTR(s.attr)}},`;
}).join('\n')}\n};\n`);

C.push(`const ConditionDef CONDITION_DEFS[COND_COUNT] = {\n${COND_IDS.map((k) => {
  const c = (CONDITIONS as Any)[k];
  return `  {${cstr(k)}, ${cstr(c.name)}, ${cstr(c.desc)}, ${CKIND(c.kind)}, ${b(c.valued)}, ${c.dmgType ? DMG(c.dmgType) : 'DMG_NONE'}, ${b(c.hidden)}},`;
}).join('\n')}\n};\n`);

C.push(`const AncestryDef ANCESTRY_DEFS[ANC_COUNT] = {\n${ANC_IDS.map((k) => {
  const a = (ANCESTRIES as Any)[k];
  const boosts = { ...a.attrBoosts };
  const free = boosts.free ?? 0;
  delete boosts.free;
  return `  {${cstr(k)}, ${cstr(a.name)}, ${cstr(a.pf2e)}, ${cstr(a.desc)}, ${cstr(a.perk)},\n   ${a.hp}, ${a.speed}, ${attrArr(boosts)}, ${free}, ${attrArr(a.attrFlaw)}, ` +
    `${mask(ATRAIT_IDS, 'AT_', a.traits)},\n   ${skillArr(a.skills)}, ${skillOrder(a.skills)}, ${a.acBonus ?? 0}, ${dmgArr(a.resist)}, ${dmgArr(a.weak)},\n` +
    `   ${a.look.skin.length}, ${a.look.hair.length}, ${arr(a.look.skin.map(color), 4)}, ${arr(a.look.hair.map(color), 4)}, ${b(a.look.mutation)}, ${b(a.look.cyber)}},`;
}).join('\n')}\n};\n`);

C.push(`const ClassDef CLASS_DEFS[CLASS_COUNT] = {\n${CLASS_IDS.map((k) => {
  const c = (CLASSES as Any)[k];
  const progression = Array.from({ length: MAX_LEVEL + 1 }, (_, lvl) => prof(c.progression[lvl] ?? {}));
  return `  {${cstr(k)}, ${cstr(c.name)}, ${cstr(c.pf2e)}, ${cstr(c.role)}, ${cstr(c.desc)},\n   ${ATTR(c.keyAttr)}, ${c.hpPerLevel}, ${color(c.color)}, ${attrArr(c.attrs)}, ` +
    `${arr(c.boostOrder.map((a: string) => ATTR(a)), 4)},\n   ${prof(c.prof)},\n   ${skillOrder(c.prof.skills)},\n   ${c.startGear.length}, ${arr(c.startGear.map(ITEM), 8)},\n` +
    `   ${c.abilities.length}, ${arr(c.abilities.map((a: string) => ABIL(a)), 6)}, ${arr(c.abilities.map((a: string) => String(c.unlocks[a] ?? 1)), 6)},\n` +
    `   {${progression.join(',\n    ')}}},`;
}).join('\n')}\n};\n`);

// przedmioty: osobne tablice statystyk + wskaźniki
const allItems: Any[] = [...ITEM_IDS.map((k) => (ITEMS as Any)[k]), UNARMED];
const wStats: string[] = [];
const aStats: string[] = [];
const sStats: string[] = [];
const cStats: string[] = [];
const itemRows = allItems.map((it) => {
  let wp = 'NULL';
  let ap = 'NULL';
  let sp = 'NULL';
  let cp = 'NULL';
  if (it.weapon) {
    const w = it.weapon;
    const t = wtraits(w.traits);
    wp = `&WEAPON_STATS[${wStats.length}]`;
    wStats.push(`  {${dice(w.damage)}, ${DMG(w.dmgType)}, ${w.range}, ${WCAT(w.category)}, ${w.hands}, ${t.flags}, ${t.deadly}, ${t.fatal}, ${WGROUP(w.group)}, ${SFX(w.sfx)}, ${w.potency ?? 0}, ${b(w.ammo)}, ${b(w.tech)}}, /* ${it.id} */`);
  }
  if (it.armor) {
    const a = it.armor;
    ap = `&ARMOR_STATS[${aStats.length}]`;
    aStats.push(`  {${a.ac}, ${a.dexCap}, ${a.checkPenalty}, ${a.speedPenalty}, ${DEF(a.category)}, ${b(a.tech)}}, /* ${it.id} */`);
  }
  if (it.shield) {
    const s = it.shield;
    sp = `&SHIELD_STATS[${sStats.length}]`;
    sStats.push(`  {${s.ac}, ${s.hardness}, ${s.hp}}, /* ${it.id} */`);
  }
  if (it.consumable) {
    const c = it.consumable;
    const cv = c.condition
      ? typeof c.condition.value === 'number' ? `{${c.condition.value}, {0, 0, 0}}` : `{0, ${dice(c.condition.value)}}`
      : '{0, {0, 0, 0}}';
    const cures = (c.cures ?? []).map((x: string) => `(1UL << ${COND(x)})`).join(' | ') || '0';
    const buffs = (c.buffs ?? []).map((x: Any) => `{${COND(x.id)}, ${x.value}}`);
    cp = `&CONSUMABLE_STATS[${cStats.length}]`;
    cStats.push(`  {${CEFFECT(c.effect)}, ${c.actions}, ${TARGET(c.target)}, ${c.range}, ${c.radius ?? 0}, ${dice(c.amount)}, ${c.dmgType ? DMG(c.dmgType) : 'DMG_NONE'}, ` +
      `${c.save ? SAVE(c.save) : 'SAVE_NONE'}, ${c.dc ?? 0}, ${cures}, ${c.condition ? COND(c.condition.id) : 'COND_NONE'}, ${cv}, ${buffs.length}, ${arr(buffs, 2, '{0, 0}')}, ${b(c.only === 'machine')}}, /* ${it.id} */`);
  }
  return `  {${cstr(it.id)}, ${cstr(it.name)}, ${cstr(it.desc)}, ${cstr(it.icon)}, ${ITYPE(it.type)}, ${it.price}, ${it.level}, ${wp}, ${ap}, ${sp}, ${cp}},`;
});
C.push(`static const WeaponStats WEAPON_STATS[${wStats.length}] = {\n${wStats.join('\n')}\n};\n`);
C.push(`static const ArmorStats ARMOR_STATS[${aStats.length}] = {\n${aStats.join('\n')}\n};\n`);
C.push(`static const ShieldStats SHIELD_STATS[${sStats.length}] = {\n${sStats.join('\n')}\n};\n`);
C.push(`static const ConsumableStats CONSUMABLE_STATS[${cStats.length}] = {\n${cStats.join('\n')}\n};\n`);
C.push(`const ItemDef ITEM_DEFS[ITEM_COUNT + 1] = {\n${itemRows.join('\n')}\n};\n`);

C.push(`const EnemyDef ENEMY_DEFS[ENEMY_COUNT] = {\n${ENEMY_IDS.map((k) => {
  const e = (ENEMIES as Any)[k];
  const atks = e.attacks.map((a: Any) => {
    const t = wtraits(a.traits);
    return `{${cstr(a.name)}, ${a.bonus}, ${dice(a.damage)}, ${DMG(a.dmgType)}, ${a.range}, ${t.flags}, ${t.deadly}, ${t.fatal}, ${SFX(a.sfx)}}`;
  });
  const loot = e.loot.map((l: Any) => `{${ITEM(l.id)}, ${l.qty}, ${probLe(l.chance)}}`);
  const immune = (e.immune ?? []).map((x: string) => `(1u << ${DMG(x)})`).join(' | ') || '0';
  const lk = e.look;
  return `  {${cstr(k)}, ${cstr(e.name)}, ${cstr(e.acc)}, ${cstr(e.desc)},\n   ${e.level}, ${e.hp}, ${e.ac}, ${e.saves.fort}, ${e.saves.ref}, ${e.saves.will}, ${e.perception}, ${e.speed}, ` +
    `${EFACTION(e.faction)}, ${AI(e.ai)}, ${mask(ETRAIT_IDS, 'ET_', e.traits)},\n   ${atks.length}, ${arr(atks, 2, '{NULL, 0, {0, 0, 0}, 0, 0, 0, 0, 0, 0}')},\n` +
    `   ${e.abilities.length}, ${arr(e.abilities.map((a: string) => ABIL(a)), 3, 'ABIL_NONE')},\n   ${loot.length}, ${arr(loot, 5, '{0, 0, 0}')},\n` +
    `   ${e.scrap[0]}, ${e.scrap[1]}, ${dmgArr(e.resist)}, ${dmgArr(e.weak)}, ${immune},\n` +
    `   {${SHAPE(lk.shape)}, ${color(lk.skin)}, ${color(lk.accent)}, ${color(lk.cloth)}, ${color(lk.hair)}, ${q8(lk.scale)}, ${lk.body ? BODY(lk.body) : 'BODY_NONE'}, ${b(lk.mask)}, ${b(lk.mutation)}, ${b(lk.cyber)}}},`;
}).join('\n')}\n};\n`);

C.push(`const AbilityDef ABILITY_DEFS[ABIL_COUNT] = {\n${ABIL_IDS.map((k) => {
  const a = (ABILITIES as Any)[k];
  const actions = a.actions === 'reaction' ? 'ACTIONS_REACTION' : String(a.actions);
  const uses = a.uses === null ? 'USES_UNLIMITED' : a.uses === 'encounter' ? 'USES_ENCOUNTER' : 'USES_DAY';
  return `  {${cstr(k)}, ${cstr(a.name)}, ${cstr(a.desc)}, ${cstr(a.icon)}, ${actions}, ${TARGET(a.target)}, ${a.range}, ${a.radius ?? 0}, ${uses}, ${a.usesMax ?? (a.uses ? 1 : 0)}, ${b(a.move)}, ${FX(a.fx)}},`;
}).join('\n')}\n};\n`);

const tri = (v: boolean | undefined): string => (v === undefined ? '-1' : v ? '1' : '0');
C.push(`const RecruitDef RECRUIT_DEFS[RECRUIT_COUNT] = {\n${RECRUITS.map((r: Any) => {
  const l = r.look ?? {};
  return `  {${cstr(r.id)}, ${cstr(r.name)}, ${cstr(r.bio)}, '${r.gender}', ${ANC(r.ancestry)}, ${CLASS(r.classId)},\n` +
    `   {${l.body ? BODY(l.body) : 'BODY_NONE'}, ${color(l.skin)}, ${color(l.hair)}, ${color(l.cloth)}, ${color(l.accent)}, ${l.hairStyle ?? -1}, ${tri(l.mask)}, ${tri(l.mutation)}, ${tri(l.cyber)}}},`;
}).join('\n')}\n};\n`);

C.push(`const LockDef LOCK_DEFS[LOCK_COUNT] = {\n${LOCK_IDS.map((k) => {
  const l = (LOCKS as Any)[k];
  return `  {${cstr(l.name)}, ${l.level}, ${l.dc}, ${l.successes}},`;
}).join('\n')}\n};\n`);
C.push(`const DeviceDef DEVICE_DEFS[DEVICE_COUNT] = {\n${DEVICE_IDS.map((k) => {
  const d = (DEVICES as Any)[k];
  return `  {${cstr(d.name)}, ${d.levelOffset}, ${d.successes}},`;
}).join('\n')}\n};\n`);

// zdarzenia
let outcomeN = 0;
const outcomeRows: string[] = [];
const itemSpec = (s: string): string => {
  if (!s.startsWith('@')) return ITEM(s);
  const t = s.slice(1);
  return t === 'any' ? 'ITEMSPEC_ANY' : `ITEMSPEC_TYPE(${ITYPE(t)})`;
};
function outcome(o: Any): string {
  const items = (o.items ?? []).map(itemSpec);
  const rep = FACTION_IDS.map((f) => String(o.rep?.[f] ?? 0));
  outcomeRows.push(`  {${cstr(o.text)}, ${o.scrap ?? 0}, ${items.length}, ${arr(items, 3)}, ${dice(o.hp)}, {${rep.join(', ')}}, ${o.xp ?? 0}, ${o.days ?? 0}},`);
  return `&EVENT_OUTCOMES[${outcomeN++}]`;
}
function eventRow(e: Any): string {
  const choices = e.choices.map((c: Any) => {
    const outs = [0, 1, 2, 3].map((d) => (c.out[d] ? outcome(c.out[d]) : 'NULL'));
    const dc = typeof c.dc === 'number' ? String(c.dc) : '0';
    return `{${cstr(c.label)}, ${c.skill ? SKILL(c.skill) : 'SKILL_NONE'}, ${dc}, {${outs.join(', ')}}}`;
  });
  return `{${cstr(e.id)}, ${cstr(e.title)}, ${cstr(e.text)}, ${e.weight}, ${choices.length}, ${arr(choices, 3, '{NULL, 0, 0, {NULL, NULL, NULL, NULL}}')}}`;
}
const eventRows = EVENTS.map((e) => '  ' + eventRow(e) + ',');
// szablon ataku fauny: nazwa 'qqq' -> {n}, 'Qqq' -> {N}
const fauna: Any = JSON.parse(JSON.stringify(faunaAttackEvent('qqq')).replace(/Qqq/g, '{N}').replace(/qqq/g, '{n}'));
const faunaRow = eventRow(fauna);
C.push(`static const EventOutcome EVENT_OUTCOMES[${outcomeRows.length}] = {\n${outcomeRows.join('\n')}\n};\n`);
C.push(`const TravelEvent TRAVEL_EVENTS[${EVENTS.length}] = {\n${eventRows.join('\n')}\n};\n`);
C.push(`const TravelEvent FAUNA_ATTACK_EVENT = ${faunaRow};\n`);
C.push(`const char *const FAUNA_NAMES[${FAUNA_KINDS.length}] = {${FAUNA_KINDS.map((f) => cstr(f.name)).join(', ')}};\n`);
C.push(`const char *const FAUNA_TEMPLATE_KEYS[${FAUNA_KINDS.length}] = {${FAUNA_KINDS.map((f) => cstr(f.templateId)).join(', ')}};\n`);

// zlecenia
C.push(`const ContractTemplate CONTRACT_TEMPLATES[OBJ_COUNT] = {\n${OBJ_IDS.map((t) => {
  const T = (CONTRACT_TYPES as Any)[t];
  if (!T) return `  {0, 0, {0}, 0, {0}, 0, {NULL}, 0, {NULL}, FACTION_NONE}, /* ${t} */`;
  const fac = T.factions.map((f: string) => `(1u << ${EFACTION(f)})`).join(' | ');
  return `  {${fac}, ${T.biomes.length}, ${arr(T.biomes.map((x: string) => BIOME(x)), 3)}, ${T.moods.length}, ${arr(T.moods.map((x: string) => MOOD(x)), 4)},\n` +
    `   ${T.titles.length}, ${arr(T.titles.map(cstr), 6, 'NULL')},\n   ${T.descs.length}, ${arr(T.descs.map(cstr), 3, 'NULL')}, ${T.giver ? FACTION(T.giver) : 'FACTION_NONE'}}, /* ${t} */`;
}).join('\n')}\n};\n`);
C.push(`const uint8_t SIDE_TYPES[${SIDE_TYPES.length}] = {${SIDE_TYPES.map((t) => OBJ(t)).join(', ')}};\n`);
C.push(`const char *const GIVERS[FACTION_COUNT][5] = {\n${FACTION_IDS.map((f) => `  ${arr((GIVERS as Any)[f].map(cstr), 5, 'NULL')},`).join('\n')}\n};\n`);
C.push(`const StoryContract STORY_CONTRACTS[${STORY_CONTRACTS.length}] = {\n${STORY_CONTRACTS.map((s: Any) => {
  const rep = FACTION_IDS.map((f) => String(s.reward.rep[f] ?? 0));
  return `  {${cstr(s.id)}, ${cstr(s.title)}, ${cstr(s.giver)}, ${cstr(s.desc)},\n   ${FACTION(s.faction)}, ${OBJ(s.type)}, ${s.level}, ${BIOME(s.biome)}, ${MOOD(s.mood)}, ${s.travelDays}, ` +
    `${s.reward.scrap}, ${s.reward.xp}, {${rep.join(', ')}}, ${s.enemies.length}, ${arr(s.enemies.map((x: string) => ENEMY(x)), 8)}},`;
}).join('\n')}\n};\n`);
C.push(`const StoryNeed STORY_NEED[${STORY_NEED.length}] = {${STORY_NEED.map((n) => `{${n.c}, ${n.r}}`).join(', ')}};\n`);
C.push(`const uint8_t STORY_BUDGET[${STORY_BUDGET.length}] = {${STORY_BUDGET.join(', ')}};\n`);

// zasady
C.push(`const uint8_t DC_TABLE[${DC_TABLE.length}] = {${DC_TABLE.join(', ')}};\n`);
C.push(`const uint8_t ENCOUNTER_XP[9] = {${[-4, -3, -2, -1, 0, 1, 2, 3, 4].map((d) => ENCOUNTER_XP[d] ?? 0).join(', ')}};\n`);
C.push(`const int8_t MAP_PENALTY[2][3] = {{${MAP.normal.join(', ')}}, {${MAP.agile.join(', ')}}};\n`);
C.push(`const uint8_t COVER_AC[3] = {0, ${COVER_AC[1]}, ${COVER_AC[2]}};\n`);
C.push(`const uint8_t UNIVERSAL_ABILITIES[${UNIVERSAL_ABILITIES.length}] = {${UNIVERSAL_ABILITIES.map((a) => ABIL(a)).join(', ')}};\n`);
C.push(`const uint8_t PERSISTENT_CONDS[${PERSISTENT.length}] = {${PERSISTENT.map((c) => COND(c)).join(', ')}};\n`);

// teksty
const strList = (name: string, list: readonly string[], size = String(list.length)): string => `const char *const ${name}[${size}] = {\n${list.map((s) => '  ' + cstr(s) + ',').join('\n')}\n};\n`;
C.push(strList('ATTR_NAMES', ATTR_IDS.map((a) => (ATTR_NAMES as Any)[a]), 'ATTR_COUNT'));
C.push(strList('DMG_ADJ', DMG_IDS.map((d) => (DMG_ADJ as Any)[d]), 'DMG_COUNT'));
C.push(strList('PROF_NAMES', PROF_NAMES, '5'));
C.push(strList('DEGREE_NAMES', DEGREE_NAMES, '4'));
C.push(strList('BIOME_NAMES', BIOME_IDS.map((x) => (BIOME_NAMES as Any)[x]), 'BIOME_COUNT'));
C.push(strList('OBJECTIVE_NAMES', OBJ_IDS.map((x) => (TYPE_NAMES as Any)[x]), 'OBJ_COUNT'));
C.push(strList('FACTION_NAMES', FACTION_IDS.map((x) => (FACTION_NAMES as Any)[x]), 'FACTION_COUNT'));
C.push(strList('MOOD_NAMES', MOOD_IDS.map((x) => (MOOD_NAMES as Any)[x]), 'MOOD_COUNT'));
C.push(`const char *const GAME_TITLE = ${cstr(GAME_TITLE)};\nconst char *const GAME_SUBTITLE = ${cstr(GAME_SUBTITLE)};\n`);
C.push(strList('INTRO_SLIDES', INTRO_SLIDES.map((s) => s.text)));
C.push(strList('EPILOGUE', EPILOGUE));
C.push(strList('GAMEOVER_LINES', GAMEOVER_LINES));
C.push(strList('TIPS', TIPS));
C.push(`const char *const CREDITS[${CREDITS.length}][2] = {\n${CREDITS.map(([a, c]) => `  {${cstr(a)}, ${cstr(c)}},`).join('\n')}\n};\n`);

// tablice stałoprzecinkowe
const chunk = (a: number[], n = 16): string => {
  const rows: string[] = [];
  for (let i = 0; i < a.length; i += n) rows.push('  ' + a.slice(i, i + n).join(', ') + ',');
  return rows.join('\n');
};
C.push(`const int16_t SIN_LUT[${SIN_LUT.length}] = {\n${chunk(Array.from(SIN_LUT))}\n};\n`);
C.push(`const uint16_t EASE_OUT3_LUT[${EASE_OUT3_LUT.length}] = {\n${chunk(Array.from(EASE_OUT3_LUT))}\n};\n`);

// ------------------------------------------------------------------ region kampanii (region.ts; Q8 jednostek świata)
{
  const wp = (p: { x: number; z: number }): string => `{${p.x}, ${p.z}}`;
  const q = (v: number): number => Math.round(v * WQ);
  const MARGIN = q(0.35);
  H.push(`/* ---- region kampanii (Q8) */
typedef struct { int32_t x, z; } WPos;
#define HMAP_X0 (${HMAP.x0})
#define HMAP_Z0 (${HMAP.z0})
#define HMAP_STEP ${HMAP.step}
#define HMAP_W ${HMAP.w}
#define HMAP_H ${HMAP.h}
#define REGION_WQ ${WQ}
extern const int16_t REGION_HEIGHT[HMAP_W * HMAP_H];
extern const WPos REGION_HOME, REGION_GATE, REGION_CRATER;
typedef struct { int32_t x, z, rx, rz, g; } CityDef;
extern const CityDef REGION_CITY;
#define REGION_AVENUE_Z (${AVENUE_Z})
typedef struct { uint8_t biome; const char *name, *sub; uint32_t color; int32_t x, z, rx, rz; WPos label; uint8_t n_spots; WPos spots[8]; } SectorDef;
extern const SectorDef SECTOR_DEFS[${SECTORS.length}];
#define SECTOR_COUNT ${SECTORS.length}
extern const WPos RING_S[${RING_S.length}], RING_N[${RING_N.length}];
#define RING_LEN ${RING_S.length}
extern const int32_t HALL_BOXES[${HALLS.length}][4]; /* x0, x1, z0, z1 z marginesem */
#define HALL_COUNT ${HALLS.length}
`);
  const hg = Array.from(heightGrid());
  const rows: string[] = [];
  for (let i = 0; i < hg.length; i += 20) rows.push('  ' + hg.slice(i, i + 20).join(', ') + ',');
  C.push(`const int16_t REGION_HEIGHT[HMAP_W * HMAP_H] = {\n${rows.join('\n')}\n};\n`);
  C.push(`const WPos REGION_HOME = ${wp(HOME)}, REGION_GATE = ${wp(GATE)}, REGION_CRATER = ${wp(CRATER)};\n`);
  C.push(`const CityDef REGION_CITY = {${CITY.x}, ${CITY.z}, ${CITY.rx}, ${CITY.rz}, ${CITY.g}};\n`);
  C.push(`const SectorDef SECTOR_DEFS[${SECTORS.length}] = {\n${SECTORS.map((sc) =>
    `  {${BIOME(sc.id)}, ${cstr(sc.name)}, ${cstr(sc.sub)}, 0x${sc.color.toString(16).toUpperCase()}UL, ${sc.x}, ${sc.z}, ${sc.rx}, ${sc.rz}, ${wp(sc.label)}, ${sc.spots.length}, ${arr(sc.spots.map(wp), 8, '{0, 0}')}},`).join('\n')}\n};\n`);
  C.push(`const WPos RING_S[${RING_S.length}] = {${RING_S.map(wp).join(', ')}};\nconst WPos RING_N[${RING_N.length}] = {${RING_N.map(wp).join(', ')}};\n`);
  C.push(`const int32_t HALL_BOXES[${HALLS.length}][4] = {\n${HALLS.map(([hx, hz, hw, hd]) =>
    `  {${q(hx - hw / 2) - MARGIN}, ${q(hx + hw / 2) + MARGIN}, ${q(hz - hd / 2) - MARGIN}, ${q(hz + hd / 2) + MARGIN}},`).join('\n')}\n};\n`);
}

// ------------------------------------------------------------------ generator imion (names.ts)
{
  H.push(`/* ---- generator imion (names.ts) */
typedef struct { const char *const *items; uint8_t n; } StrList;
typedef struct { const char *from, *to; } StrPair;
extern const StrList NAMES_FIRST_M, NAMES_FIRST_F, NAMES_SURNAMES, NAMES_NICK, NAMES_TITLE_HUMAN;
extern const StrList NAMES_CALL[CLASS_COUNT];
extern const StrList NAMES_MUT_CALL, NAMES_MUT_TITLE, NAMES_CYB_CALL, NAMES_CYB_SERIAL, NAMES_NOM_CALL, NAMES_NOM_FROM;
extern const StrPair NAMES_FEM[${Object.keys(NAME_FEM).length}], NAMES_MASC[${Object.keys(NAME_MASC).length}];
#define NAMES_FEM_N ${Object.keys(NAME_FEM).length}
#define NAMES_MASC_N ${Object.keys(NAME_MASC).length}
`);
  let k = 0;
  const list = (name: string, a: readonly string[], exported = true): string => {
    const arrName = `S_${k++}`;
    C.push(`static const char *const ${arrName}[${a.length}] = {${a.map(cstr).join(', ')}};\n`);
    return exported ? `const StrList ${name} = {${arrName}, ${a.length}};\n` : `{${arrName}, ${a.length}}`;
  };
  const defs: string[] = [];
  defs.push(list('NAMES_FIRST_M', NAME_FIRST.m), list('NAMES_FIRST_F', NAME_FIRST.f), list('NAMES_SURNAMES', NAME_SURNAMES), list('NAMES_NICK', NAME_NICK),
    list('NAMES_TITLE_HUMAN', NAME_TITLE_HUMAN), list('NAMES_MUT_CALL', NAME_ANC.mutant.call), list('NAMES_MUT_TITLE', NAME_ANC.mutant.title),
    list('NAMES_CYB_CALL', NAME_ANC.cyborg.call), list('NAMES_CYB_SERIAL', NAME_ANC.cyborg.serial), list('NAMES_NOM_CALL', NAME_ANC.nomad.call),
    list('NAMES_NOM_FROM', NAME_ANC.nomad.from));
  const calls = CLASS_IDS.map((c) => list('', NAME_CALL[c] ?? NAME_CALL.soldier, false));
  C.push(defs.join(''));
  C.push(`const StrList NAMES_CALL[CLASS_COUNT] = {${calls.join(', ')}};\n`);
  const pairs = (m: Record<string, string>): string => Object.entries(m).map(([a, b]) => `{${cstr(a)}, ${cstr(b)}}`).join(', ');
  C.push(`const StrPair NAMES_FEM[${Object.keys(NAME_FEM).length}] = {${pairs(NAME_FEM)}};\nconst StrPair NAMES_MASC[${Object.keys(NAME_MASC).length}] = {${pairs(NAME_MASC)}};\n`);
}

H.push('#endif /* GAMEDATA_H */\n');
writeFileSync(join(OUT, 'gamedata.h'), H.join('\n'));
writeFileSync(join(OUT, 'gamedata.c'), C.join('\n'));
console.log(`OK: ${join(OUT, 'gamedata.h')} + gamedata.c (${ITEM_IDS.length} przedmiotów, ${ENEMY_IDS.length} wrogów, ${ABIL_IDS.length} zdolności, ${outcomeRows.length} skutków zdarzeń)`);
