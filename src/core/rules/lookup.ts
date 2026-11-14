// Bezpieczne odczyty tabel danych po identyfikatorach typu string (np. z zapisu gry).
import { ABILITIES } from '../data/abilities.ts';
import { ANCESTRIES, ANCESTRY_ALIASES } from '../data/ancestries.ts';
import { CLASSES } from '../data/classes.ts';
import { ENEMIES } from '../data/enemies.ts';
import { ITEMS } from '../data/items.ts';
import { CONDITIONS } from '../data/rules.ts';
import type {
  AbilityDef, AbilityId, AncestryDef, AncestryId, ClassDef, ConditionDef, ConditionId, EnemyDef, EnemyId, ItemDef, ItemId,
} from '../data/types.ts';

const ITEM_TABLE: Readonly<Record<string, ItemDef | undefined>> = ITEMS;
const ENEMY_TABLE: Readonly<Record<string, EnemyDef | undefined>> = ENEMIES;
const CLASS_TABLE: Readonly<Record<string, ClassDef | undefined>> = CLASSES;
const ANCESTRY_TABLE: Readonly<Record<string, AncestryDef | undefined>> = ANCESTRIES;
const ALIAS_TABLE: Readonly<Record<string, AncestryId | undefined>> = ANCESTRY_ALIASES;
const ABILITY_TABLE: Readonly<Record<string, AbilityDef | undefined>> = ABILITIES;
const CONDITION_TABLE: Readonly<Record<string, ConditionDef | undefined>> = CONDITIONS;

export const itemDef = (id: string | null | undefined): ItemDef | undefined => (id ? ITEM_TABLE[id] : undefined);
export const enemyDef = (id: string | null | undefined): EnemyDef | undefined => (id ? ENEMY_TABLE[id] : undefined);
export const classDef = (id: string | null | undefined): ClassDef | undefined => (id ? CLASS_TABLE[id] : undefined);
export const abilityDef = (id: string | null | undefined): AbilityDef | undefined => (id ? ABILITY_TABLE[id] : undefined);
export const conditionDef = (id: string): ConditionDef | undefined => CONDITION_TABLE[id];

export const isItemId = (id: string): id is ItemId => id in ITEM_TABLE;
export const isEnemyId = (id: string): id is EnemyId => id in ENEMY_TABLE;
export const isAbilityId = (id: string): id is AbilityId => id in ABILITY_TABLE;
export const isConditionId = (id: string): id is ConditionId => id in CONDITION_TABLE;

/** Id rasy po aliasach ('nomad-born' -> 'nomad'); nieznane -> undefined. */
export function resolveAncestryId(id: string | null | undefined): AncestryId | undefined {
  if (!id) return undefined;
  if (ANCESTRY_TABLE[id]) return id as AncestryId;
  return ALIAS_TABLE[id];
}
export const ancestryOf = (id: string | null | undefined): AncestryDef => ANCESTRY_TABLE[resolveAncestryId(id) ?? 'human'] ?? ANCESTRIES.human;

export const allItems = (): ItemDef[] => Object.values(ITEMS);
export const allEnemyIds = (): EnemyId[] => Object.keys(ENEMIES) as EnemyId[];
