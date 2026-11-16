// AUTO-EXTRACTED from Oldgame/src/rules/content.js, dice.js, core.js. Pure data, zero Phaser/Three.js dependencies.
import type { AttrId, ConditionId, SkillId } from './ids.ts';
import type { AbilityId } from './ids.ts';
import type { ConditionDef, DamageType, SkillDef } from './types.ts';

/** Action points per turn (PF2e 3-action economy). +1 when quickened, -X when stunned/slowed. */
export const ACTIONS_PER_TURN = 3;
export const XP_PER_LEVEL = 1000;
export const MAX_LEVEL = 10;
/** Base Armor Class before dexterity, proficiency and armor. */
export const BASE_AC = 10;
/** Dying value at which a character dies. */
export const DYING_MAX = 4;
/** Flat-check DC to end persistent damage at the start of the turn. */
export const PERSISTENT_END_DC = 15;
/** Multiple attack penalty for 2nd / 3rd+ attack in a turn. */
export const MAP = { normal: [0, -5, -10], agile: [0, -4, -8] } as const;
/** AC circumstance bonus from cover (in_cover = 1 / 2). */
export const COVER_AC = { 1: 2, 2: 4 } as const;

export const ATTRS = ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const satisfies readonly AttrId[];
export const ATTR_NAMES = { str: 'Siła', dex: 'Zręczność', con: 'Kondycja', int: 'Inteligencja', wis: 'Mądrość', cha: 'Charyzma' } as const satisfies Readonly<Record<AttrId, string>>;

export const SKILLS = {
  athletics: { name: 'Atletyka', attr: 'str' },
  acrobatics: { name: 'Akrobatyka', attr: 'dex' },
  stealth: { name: 'Skradanie', attr: 'dex' },
  thievery: { name: 'Złodziejstwo', attr: 'dex' },
  crafting: { name: 'Technika', attr: 'int' },
  society: { name: 'Wiedza', attr: 'int' },
  medicine: { name: 'Medycyna', attr: 'wis' },
  survival: { name: 'Przetrwanie', attr: 'wis' },
  nature: { name: 'Natura', attr: 'wis' },
  perception: { name: 'Percepcja', attr: 'wis' },
  intimidation: { name: 'Zastraszanie', attr: 'cha' },
  diplomacy: { name: 'Dyplomacja', attr: 'cha' },
  deception: { name: 'Oszustwo', attr: 'cha' },
} as const satisfies Readonly<Record<SkillId, SkillDef>>;

/** kind: persistent (damage each turn, value = die), decay (-1 at end of turn), timed (value = rounds left), consume (lose X actions next turn), short (ends at owner's turn start), flag. */
export const CONDITIONS = {
  off_guard: { name: 'Odsłonięty', desc: '-2 do KP.', kind: 'flag' },
  frightened: { name: 'Przerażony', desc: 'Wszystkie rzuty kością dzielone na 2 (w górę); maleje co turę.', kind: 'decay', valued: true },
  sickened: { name: 'Chory', desc: 'Kara -X do wszystkich testów i WT; maleje co turę.', kind: 'decay', valued: true },
  clumsy: { name: 'Niezdarny', desc: 'Kara -X do Zręczności (KP, Refleks, strzały).', kind: 'decay', valued: true },
  enfeebled: { name: 'Osłabiony', desc: 'Kara -X do Siły.', kind: 'decay', valued: true },
  distracted: { name: 'Zdezorientowany', desc: 'Odsłonięty (-2 KP) przez krótki czas.', kind: 'timed' },
  prone: { name: 'Powalony', desc: '-2 do KP i ataków. Wstań (1 akcja).', kind: 'flag' },
  bleeding: { name: 'Krwawienie', desc: 'Obrażenia ciągłe (test płaski WT 15 kończy).', kind: 'persistent', dmgType: 'bleed' },
  burning: { name: 'Płonie', desc: 'Obrażenia ogniowe ciągłe.', kind: 'persistent', dmgType: 'fire' },
  poisoned: { name: 'Zatruty', desc: 'Obrażenia od trucizny ciągłe.', kind: 'persistent', dmgType: 'poison' },
  stunned: { name: 'Ogłuszony', desc: 'Traci X akcji w następnej turze.', kind: 'consume', valued: true },
  slowed: { name: 'Spowolniony', desc: 'Traci X akcji w następnej turze.', kind: 'consume', valued: true },
  quickened: { name: 'Przyspieszony', desc: '+1 akcja w turze.', kind: 'timed' },
  dying: { name: 'Umierający', desc: 'Test ratunkowy WT 10+X co turę. 4 = śmierć.', kind: 'flag', valued: true },
  wounded: { name: 'Ranny', desc: 'Kolejne umieranie zaczyna się od wyższego poziomu.', kind: 'flag', valued: true },
  unconscious: { name: 'Nieprzytomny', desc: 'Nie działa.', kind: 'flag' },
  dead: { name: 'Martwy', desc: '', kind: 'flag' },
  hidden: { name: 'Ukryty', desc: 'Rzut na trafienie w ukrytego dzielony na 2; następny atak z ukrycia uderza w odsłoniętego.', kind: 'flag' },
  raised_shield: { name: 'Tarcza w górze', desc: '+KP z tarczy do początku następnej tury.', kind: 'short' },
  dodging: { name: 'Unik', desc: '+2 do KP do początku następnej tury.', kind: 'short' },
  in_cover: { name: 'W osłonie', desc: '+2 KP (1) lub +4 (2) przeciw atakom dystansowym.', kind: 'flag', valued: true },
  hunted: { name: 'Wyznaczony cel', desc: 'Zwiadowca zadaje mu więcej obrażeń.', kind: 'timed' },
  raging: { name: 'Szał', desc: '+obrażenia w walce wręcz, -1 do KP.', kind: 'timed' },
  stimmed: { name: 'Pobudzony', desc: '+1 do trafienia.', kind: 'timed' },
  tuned: { name: 'Ulepszona broń', desc: '+2 do obrażeń.', kind: 'timed' },
  reinforced: { name: 'Wzmocniony pancerz', desc: '+1 do KP.', kind: 'timed' },
  dem_imm: { name: 'Odporny na zastraszanie', desc: '', kind: 'timed', hidden: true },
} as const satisfies Readonly<Record<ConditionId, ConditionDef>>;

export const PERSISTENT = ['bleeding', 'burning', 'poisoned'] as const satisfies readonly ConditionId[];

export const UNIVERSAL_ABILITIES = ['strike', 'raise_shield', 'take_cover', 'demoralize', 'first_aid', 'stand'] as const satisfies readonly AbilityId[];

/** Polish adjective per damage type (for combat log). */
export const DMG_ADJ = {
  P: 'kłutych',
  S: 'ciętych',
  B: 'obuchowych',
  fire: 'ogniowych',
  acid: 'żrących',
  elec: 'elektrycznych',
  poison: 'trujących',
  bleed: 'od krwawienia',
  rad: 'radiacyjnych',
} as const satisfies Readonly<Record<DamageType, string>>;

/** Proficiency rank names: 0 untrained .. 4 legendary. Bonus = rank > 0 ? 2*rank + level : 0. */
export const PROF_NAMES = ['Nieszkolony', 'Wyszkolony', 'Ekspert', 'Mistrz', 'Legenda'] as const;
export const DEGREE_NAMES = ['Krytyczna porażka', 'Porażka', 'Sukces', 'Krytyczny sukces'] as const;
/** Standard DC by level (index = level). */
export const DC_TABLE = [14, 15, 16, 18, 19, 20, 22, 23, 24, 26, 27, 28, 30, 31, 32, 34] as const;
/** Encounter XP by (enemy level - party level); below -4 gives 0. */
export const ENCOUNTER_XP: Readonly<Record<number, number>> = { [-4]: 10, [-3]: 15, [-2]: 20, [-1]: 30, 0: 40, 1: 60, 2: 80, 3: 120, 4: 160 };
