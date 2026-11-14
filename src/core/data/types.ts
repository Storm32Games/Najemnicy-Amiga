// Pure data types for "Pył i Rdza" (migrated from Oldgame/src/rules). Zero Phaser/Three.js dependencies.
import type {
  AbilityId, AncestryId, AttrId, ClassId, ConditionId, ItemId, SkillId, WeaponTrait,
} from './ids.ts';

export type * from './ids.ts';

// ---------- basics
/** Dice expression, e.g. '1d8', '2d6+4', '1d10+5'. */
export type DiceExpr = string;
export type DamageType = 'P' | 'S' | 'B' | 'fire' | 'acid' | 'elec' | 'poison' | 'bleed' | 'rad';
/** Proficiency rank: 0 untrained, 1 trained, 2 expert, 3 master, 4 legendary. */
export type ProfRank = 0 | 1 | 2 | 3 | 4;
export type SaveId = 'fortitude' | 'reflex' | 'will';
export type Attributes = Record<AttrId, number>;
export type DamageMods = Partial<Record<DamageType, number>>;
/** Hex color, e.g. '#c8a040'. */
export type Color = string;

// ---------- rules tables
export interface SkillDef { readonly name: string; readonly attr: AttrId }

export type ConditionKind = 'flag' | 'decay' | 'timed' | 'persistent' | 'consume' | 'short';
export interface ConditionDef {
  readonly name: string;
  readonly desc: string;
  readonly kind: ConditionKind;
  /** Condition carries a numeric value (frightened 2, dying 3...). */
  readonly valued?: boolean;
  /** Damage type for persistent conditions. */
  readonly dmgType?: DamageType;
  readonly hidden?: boolean;
}

// ---------- characters
export interface Proficiencies {
  readonly perception: ProfRank;
  readonly fortitude: ProfRank;
  readonly reflex: ProfRank;
  readonly will: ProfRank;
  readonly classDC: ProfRank;
  readonly skills: Partial<Record<SkillId, ProfRank>>;
  readonly attacks: Readonly<Record<WeaponCategory, ProfRank>>;
  readonly defense: Readonly<Record<DefenseCategory, ProfRank>>;
}
/** Partial proficiency upgrade applied on level-up. */
export type ProfProgression = Partial<Omit<Proficiencies, 'skills' | 'attacks' | 'defense'>> & {
  readonly skills?: Partial<Record<SkillId, ProfRank>>;
  readonly attacks?: Partial<Record<WeaponCategory, ProfRank>>;
  readonly defense?: Partial<Record<DefenseCategory, ProfRank>>;
};

export type BodyType = 'light' | 'medium' | 'heavy';
export type AncestryTrait = 'human' | 'humanoid' | 'mutant' | 'cyborg' | 'machine' | 'nomad' | 'ratling' | 'ogrin';

export interface AncestryDef {
  readonly id: AncestryId;
  readonly name: string;
  /** Source PF2e ancestry this one re-skins. */
  readonly pf2e: string;
  readonly desc: string;
  /** Ancestry hit points (added once). */
  readonly hp: number;
  /** +1 per listed attribute; `free` boosts follow the class boostOrder. */
  readonly attrBoosts: Partial<Record<AttrId | 'free', number>>;
  readonly attrFlaw?: Partial<Record<AttrId, number>>;
  /** Speed in tiles per Stride. */
  readonly speed: number;
  readonly traits: readonly AncestryTrait[];
  readonly skills: Partial<Record<SkillId, ProfRank>>;
  readonly acBonus?: number;
  readonly resist?: DamageMods;
  readonly weak?: DamageMods;
  readonly perk: string;
  readonly look: {
    readonly skin: readonly Color[];
    readonly hair: readonly Color[];
    readonly mutation?: boolean;
    readonly cyber?: boolean;
  };
}

export interface ClassDef {
  readonly id: ClassId;
  readonly pf2e: string;
  readonly name: string;
  readonly role: string;
  readonly keyAttr: AttrId;
  /** HP per level (plus CON modifier). */
  readonly hpPerLevel: number;
  readonly color: Color;
  readonly desc: string;
  /** Starting attribute modifiers before ancestry boosts (capped at +4). */
  readonly attrs: Attributes;
  /** Order in which free / level-5 boosts are applied. */
  readonly boostOrder: readonly AttrId[];
  readonly prof: Proficiencies;
  readonly startGear: readonly ItemId[];
  readonly abilities: readonly AbilityId[];
  /** Level at which each class ability unlocks. */
  readonly unlocks: Partial<Record<AbilityId, number>>;
  readonly progression: Readonly<Partial<Record<number, ProfProgression>>>;
}

export interface CharacterLook {
  readonly body: BodyType;
  readonly skin: Color;
  readonly hair: Color;
  readonly hairStyle: number;
  readonly cloth: Color;
  readonly accent: Color;
  readonly mask?: boolean;
  readonly mutation?: boolean;
  readonly cyber?: boolean;
}

export interface RecruitDef {
  readonly id: string;
  readonly gender: 'm' | 'f';
  readonly name: string;
  readonly ancestry: AncestryId;
  readonly classId: ClassId;
  readonly look: Partial<CharacterLook>;
  readonly bio: string;
}

// ---------- items
export type ItemType = 'weapon' | 'armor' | 'shield' | 'consumable' | 'junk' | 'tech' | 'ammo';
export type WeaponCategory = 'simple' | 'martial' | 'advanced' | 'unarmed';
export type WeaponGroup = 'melee' | 'bow' | 'firearm' | 'laser' | 'unarmed';
export type DefenseCategory = 'unarmored' | 'light' | 'medium' | 'heavy';
export type ArmorCategory = Exclude<DefenseCategory, 'unarmored'>;
export type AttackSfx = 'melee' | 'shot_pistol' | 'shot_shotgun' | 'shot_smg' | 'shot_rifle' | 'shot_laser' | 'explosion';

interface ItemBase {
  readonly id: ItemId;
  readonly name: string;
  readonly desc: string;
  readonly type: ItemType;
  /** Buy price in Złom. */
  readonly price: number;
  /** Minimum party level for shop stock. */
  readonly level: number;
  readonly icon: string;
}

export interface WeaponStats {
  readonly damage: DiceExpr;
  readonly dmgType: DamageType;
  /** Range in tiles; 0 = melee. */
  readonly range: number;
  readonly category: WeaponCategory;
  readonly hands: 1 | 2;
  readonly traits: readonly WeaponTrait[];
  readonly group: WeaponGroup;
  readonly sfx: AttackSfx;
  /** Item bonus to attack rolls. */
  readonly potency: number;
  readonly ammo?: boolean;
  readonly tech?: boolean;
}
export interface WeaponItem extends ItemBase { readonly type: 'weapon'; readonly weapon: WeaponStats }

export interface ArmorStats {
  /** Item bonus to AC. */
  readonly ac: number;
  readonly dexCap: number;
  readonly checkPenalty: number;
  /** Speed reduction in tiles. */
  readonly speedPenalty: number;
  readonly category: ArmorCategory;
  readonly tech?: boolean;
}
export interface ArmorItem extends ItemBase { readonly type: 'armor'; readonly armor: ArmorStats }

export interface ShieldStats { readonly ac: number; readonly hardness: number; readonly hp: number }
export interface ShieldItem extends ItemBase { readonly type: 'shield'; readonly shield: ShieldStats }

export type ConsumableEffect = 'heal' | 'cleanse' | 'damage' | 'smoke' | 'buff';
export type TargetKind = 'self' | 'ally' | 'enemy' | 'area' | 'none';
export interface ConsumableStats {
  readonly effect: ConsumableEffect;
  /** Action cost (AP). */
  readonly actions: number;
  readonly target: TargetKind;
  readonly range: number;
  readonly radius?: number;
  readonly amount?: DiceExpr;
  readonly dmgType?: DamageType;
  readonly save?: SaveId;
  readonly dc?: number;
  readonly cures?: readonly ConditionId[];
  readonly condition?: { readonly id: ConditionId; readonly value: number | DiceExpr };
  readonly buffs?: readonly { readonly id: ConditionId; readonly value: number }[];
  /** Only affects targets with this trait. */
  readonly only?: 'machine';
}
export interface ConsumableItem extends ItemBase { readonly type: 'consumable'; readonly consumable: ConsumableStats }

export interface JunkItem extends ItemBase { readonly type: 'junk' | 'tech' | 'ammo' }

export type ItemDef = WeaponItem | ArmorItem | ShieldItem | ConsumableItem | JunkItem;

// ---------- enemies
export type EnemyAI = 'melee' | 'ranged' | 'beast' | 'coward' | 'boss';
export type Faction = 'raider' | 'mutant' | 'beast' | 'machine';
export type EnemyTrait = 'animal' | 'swarm' | 'mutant' | 'boss' | 'machine';
export type EnemyShape = 'quad' | 'swarm' | 'big' | 'humanoid' | 'drone' | 'turret';

export interface EnemyAttack {
  readonly name: string;
  /** Total attack bonus. */
  readonly bonus: number;
  /** Damage incl. flat bonus. */
  readonly damage: DiceExpr;
  readonly dmgType: DamageType;
  readonly range: number;
  readonly traits: readonly (WeaponTrait | 'reach')[];
  readonly sfx: AttackSfx;
}
export interface LootEntry { readonly id: ItemId; readonly chance: number; readonly qty: number }

export interface EnemyLook {
  readonly shape: EnemyShape;
  readonly skin: Color;
  readonly accent: Color;
  readonly scale?: number;
  readonly body?: BodyType;
  readonly cloth?: Color;
  readonly hair?: Color;
  readonly mask?: boolean;
  readonly mutation?: boolean;
  readonly cyber?: boolean;
}

export interface EnemyDef {
  readonly id: string;
  readonly name: string;
  /** Polish accusative form for the combat log. */
  readonly acc: string;
  readonly desc: string;
  readonly level: number;
  readonly hp: number;
  /** Armor Class. */
  readonly ac: number;
  readonly saves: { readonly fort: number; readonly ref: number; readonly will: number };
  readonly perception: number;
  /** Speed in tiles; 0 = stationary. */
  readonly speed: number;
  readonly faction: Faction;
  readonly ai: EnemyAI;
  readonly traits: readonly EnemyTrait[];
  readonly attacks: readonly EnemyAttack[];
  readonly abilities: readonly AbilityId[];
  readonly loot: readonly LootEntry[];
  /** Złom drop range [min, max]. */
  readonly scrap: readonly [number, number];
  readonly resist?: DamageMods;
  readonly weak?: DamageMods;
  readonly immune?: readonly (DamageType | 'poison' | 'bleed')[];
  readonly look: EnemyLook;
}

// ---------- abilities
export type AbilityFx = 'melee' | 'buff' | 'shout' | 'heal' | 'shot' | 'explosion';
export interface AbilityDef {
  readonly id: string;
  readonly name: string;
  readonly desc: string;
  /** Cost in actions (AP); 0 = free. */
  readonly actions: number | 'reaction';
  readonly target: TargetKind;
  /** Range in tiles (1 = melee, 0 = self). */
  readonly range: number;
  readonly radius?: number;
  /** null = unlimited; 'encounter' = refreshed after each fight. */
  readonly uses: null | 'encounter' | 'day';
  readonly usesMax?: number;
  /** Ability includes movement (e.g. charge). */
  readonly move?: boolean;
  readonly fx: AbilityFx;
  readonly icon: string;
}
