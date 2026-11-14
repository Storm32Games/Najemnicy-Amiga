// Ekwipunek: sloty, broń dwuręczna vs tarcza, zamiana broni, wspólna skrytka drużyny.
// Migracja logiki z Oldgame/src/scenes/hub.js (okno Drużyna) i scenes/meta/common.js (addToStash).
import type { ItemType } from '../data/types.ts';
import { itemDef } from './lookup.ts';
import type { Character, EquipSlot, ItemInstance } from './types.ts';

/** Jaki typ przedmiotu pasuje do slotu. */
export const SLOT_TYPE: Readonly<Record<EquipSlot, ItemType>> = { weapon: 'weapon', weapon2: 'weapon', armor: 'armor', shield: 'shield' };

/** Dokłada przedmiot do stosu: konsumabelki i amunicja się łączą, reszta to osobne sztuki. */
export function addToStack(list: ItemInstance[], inst: ItemInstance): void {
  const type = itemDef(inst.id)?.type;
  const stackable = type === 'consumable' || type === 'ammo';
  const ex = stackable ? list.find((i) => i.id === inst.id) : undefined;
  if (ex) ex.qty = (ex.qty || 1) + (inst.qty || 1);
  else list.push(inst);
}

export const isTwoHanded = (inst: ItemInstance | null | undefined): boolean => {
  const def = itemDef(inst?.id);
  return def?.type === 'weapon' && def.weapon.hands === 2;
};

export interface EquipResult {
  ok: boolean;
  reason?: string;
  /** Przedmioty zdjęte przy okazji (poprzedni w slocie, tarcza przy broni dwuręcznej) - trafiają do `stash`. */
  removed: ItemInstance[];
}

/**
 * Zakłada `inst` do slotu. Przedmiot jest wyjmowany z `from` (plecak/skrytka), zdjęte rzeczy trafiają do `stash`.
 * Broń dwuręczna w slocie głównym zdejmuje tarczę; tarczy nie da się założyć do broni dwuręcznej.
 */
export function equip(ch: Character, slot: EquipSlot, inst: ItemInstance, from: ItemInstance[], stash: ItemInstance[]): EquipResult {
  const def = itemDef(inst.id);
  if (!def || def.type !== SLOT_TYPE[slot]) return { ok: false, reason: 'Ten przedmiot nie pasuje do tego miejsca.', removed: [] };
  if (slot === 'shield' && isTwoHanded(ch.equipment.weapon)) return { ok: false, reason: 'Broń dwuręczna: nie można trzymać tarczy.', removed: [] };
  const idx = from.indexOf(inst);
  if (idx >= 0) from.splice(idx, 1);
  const removed: ItemInstance[] = [];
  const cur = ch.equipment[slot];
  if (cur) removed.push(cur);
  ch.equipment[slot] = inst;
  if (slot === 'weapon' && isTwoHanded(inst) && ch.equipment.shield) {
    removed.push(ch.equipment.shield);
    ch.equipment.shield = null;
  }
  for (const r of removed) addToStack(stash, r);
  return { ok: true, removed };
}

/** Zdejmuje przedmiot ze slotu do `stash`. */
export function unequip(ch: Character, slot: EquipSlot, stash: ItemInstance[]): ItemInstance | null {
  const cur = ch.equipment[slot];
  if (!cur) return null;
  ch.equipment[slot] = null;
  addToStack(stash, cur);
  return cur;
}

/** Zamienia broń główną z zapasową (w walce kosztuje 1 akcję). Zwraca false, gdy nie ma zapasowej. */
export function swapWeapons(ch: Character): boolean {
  const e = ch.equipment;
  if (!e.weapon2) return false;
  // Jak w oryginale: zamiana nie zdejmuje tarczy, nawet jeśli nowa broń główna jest dwuręczna.
  [e.weapon, e.weapon2] = [e.weapon2, e.weapon];
  return true;
}

/** Przenosi przedmiot między listami (plecak <-> skrytka). */
export function moveItem(inst: ItemInstance, from: ItemInstance[], to: ItemInstance[]): void {
  const i = from.indexOf(inst);
  if (i >= 0) from.splice(i, 1);
  addToStack(to, inst);
}
