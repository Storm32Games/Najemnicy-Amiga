/* Wygenerowane przez tools/amiga/gen_headers.ts z src/core. NIE EDYTUJ RĘCZNIE. */
#ifndef GAMEDATA_H
#define GAMEDATA_H

#include <stdint.h>
#include <stddef.h>

/* Kości: n x k(sides) + mod. n = 0 -> sama stała. */
typedef struct { uint8_t n, sides; int8_t mod; } Dice;

#define NONE8 0xFF
#define COLOR_NONE 0xFFFFFFFFUL

/* ---- stałe zasad */
#define ACTIONS_PER_TURN 3
#define XP_PER_LEVEL 1000
#define MAX_LEVEL 10
#define BASE_AC 10
#define DYING_MAX 4
#define PERSISTENT_END_DC 15
#define IMPROVISED_PENALTY (-2)
#define MAP_W 32
#define MAP_H 32
#define SIGHT_PC 9
#define SIGHT_NEUTRAL 5
#define MAX_PARTY 4
#define ACTIONS_REACTION 0xFF
/* rng() < p  <=>  u32 <= LE */
#define EVENT_CHANCE_LE 1288490188UL
#define FAUNA_CHANCE_LE 944892805UL

typedef enum {
  ATTR_STR = 0,
  ATTR_DEX = 1,
  ATTR_CON = 2,
  ATTR_INT = 3,
  ATTR_WIS = 4,
  ATTR_CHA = 5,
  ATTR_COUNT = 6
} AttrId;

typedef enum {
  SKILL_ATHLETICS = 0,
  SKILL_ACROBATICS = 1,
  SKILL_STEALTH = 2,
  SKILL_THIEVERY = 3,
  SKILL_CRAFTING = 4,
  SKILL_SOCIETY = 5,
  SKILL_MEDICINE = 6,
  SKILL_SURVIVAL = 7,
  SKILL_NATURE = 8,
  SKILL_PERCEPTION = 9,
  SKILL_INTIMIDATION = 10,
  SKILL_DIPLOMACY = 11,
  SKILL_DECEPTION = 12,
  SKILL_COUNT = 13,
  SKILL_NONE = 0xFF
} SkillId;

typedef enum {
  COND_OFF_GUARD = 0,
  COND_FRIGHTENED = 1,
  COND_SICKENED = 2,
  COND_CLUMSY = 3,
  COND_ENFEEBLED = 4,
  COND_DISTRACTED = 5,
  COND_PRONE = 6,
  COND_BLEEDING = 7,
  COND_BURNING = 8,
  COND_POISONED = 9,
  COND_STUNNED = 10,
  COND_SLOWED = 11,
  COND_QUICKENED = 12,
  COND_DYING = 13,
  COND_WOUNDED = 14,
  COND_UNCONSCIOUS = 15,
  COND_DEAD = 16,
  COND_HIDDEN = 17,
  COND_RAISED_SHIELD = 18,
  COND_DODGING = 19,
  COND_IN_COVER = 20,
  COND_HUNTED = 21,
  COND_RAGING = 22,
  COND_STIMMED = 23,
  COND_TUNED = 24,
  COND_REINFORCED = 25,
  COND_DEM_IMM = 26,
  COND_COUNT = 27,
  COND_NONE = 0xFF
} ConditionId;

typedef enum {
  ANC_HUMAN = 0,
  ANC_HUMANOID = 1,
  ANC_MUTANT = 2,
  ANC_CYBORG = 3,
  ANC_NOMAD = 4,
  ANC_VAULT = 5,
  ANC_RATLING = 6,
  ANC_OGRIN = 7,
  ANC_COUNT = 8
} AncestryId;

typedef enum {
  CLASS_SOLDIER = 0,
  CLASS_SCOUT = 1,
  CLASS_MEDIC = 2,
  CLASS_TECHIE = 3,
  CLASS_SCAVENGER = 4,
  CLASS_BRUTE = 5,
  CLASS_GUNSLINGER = 6,
  CLASS_CHAMPION = 7,
  CLASS_ALCHEMIST = 8,
  CLASS_HERALD = 9,
  CLASS_MONK = 10,
  CLASS_HACKER = 11,
  CLASS_COUNT = 12,
  CLASS_NONE = 0xFF
} ClassId;

typedef enum {
  ITEM_KNIFE = 0,
  ITEM_PIPE = 1,
  ITEM_MACHETE = 2,
  ITEM_FIRE_AXE = 3,
  ITEM_SLEDGEHAMMER = 4,
  ITEM_MONOBLADE = 5,
  ITEM_BOW = 6,
  ITEM_CROSSBOW = 7,
  ITEM_PISTOL = 8,
  ITEM_REVOLVER = 9,
  ITEM_SAWEDOFF = 10,
  ITEM_SHOTGUN = 11,
  ITEM_SMG = 12,
  ITEM_RIFLE = 13,
  ITEM_HUNTING_RIFLE = 14,
  ITEM_ASSAULT_RIFLE = 15,
  ITEM_LASER_PISTOL = 16,
  ITEM_LASER_RIFLE = 17,
  ITEM_LEATHER = 18,
  ITEM_NOMAD_CLOAK = 19,
  ITEM_SCRAP_ARMOR = 20,
  ITEM_SCRAP_PLATE = 21,
  ITEM_KEVLAR = 22,
  ITEM_RIOT_ARMOR = 23,
  ITEM_POWER_ARMOR = 24,
  ITEM_SCRAP_SHIELD = 25,
  ITEM_RIOT_SHIELD = 26,
  ITEM_STIMPAK = 27,
  ITEM_BANDAGE = 28,
  ITEM_MEDKIT = 29,
  ITEM_ANTIRAD = 30,
  ITEM_FRAG_GRENADE = 31,
  ITEM_MOLOTOV = 32,
  ITEM_SMOKE_GRENADE = 33,
  ITEM_EMP_GRENADE = 34,
  ITEM_COMBAT_STIM = 35,
  ITEM_SCRAP_METAL = 36,
  ITEM_COPPER_WIRE = 37,
  ITEM_CANNED_FOOD = 38,
  ITEM_OLD_WATCH = 39,
  ITEM_TROPHY_TEETH = 40,
  ITEM_MUTANT_GLAND = 41,
  ITEM_FUEL_CAN = 42,
  ITEM_BATTERY = 43,
  ITEM_LOCKPICK = 44,
  ITEM_GAS_MASK = 45,
  ITEM_MEMORY_CARD = 46,
  ITEM_RADIO_PART = 47,
  ITEM_CIRCUIT = 48,
  ITEM_VACUUM_TUBE = 49,
  ITEM_DRONE_PARTS = 50,
  ITEM_POWER_CORE = 51,
  ITEM_AMMO_BOX = 52,
  ITEM_COUNT = 53,
  ITEM_FIST = 53 /* Pięść (broń domyślna), poza sklepem */,
  ITEM_NONE = 0xFF
} ItemId;

typedef enum {
  ENEMY_RAT_MUTANT = 0,
  ENEMY_DOG_MUTANT = 1,
  ENEMY_FLY_SWARM = 2,
  ENEMY_SCORPION = 3,
  ENEMY_KRETOWIJ = 4,
  ENEMY_GHOUL = 5,
  ENEMY_MUTANT_BRUTE = 6,
  ENEMY_RAIDER_THUG = 7,
  ENEMY_RAIDER_GUNNER = 8,
  ENEMY_RAIDER_BURNER = 9,
  ENEMY_RAIDER_PSYCHO = 10,
  ENEMY_RAIDER_SNIPER = 11,
  ENEMY_RAIDER_CHIEF = 12,
  ENEMY_KOSTUCHA = 13,
  ENEMY_DRONE = 14,
  ENEMY_TURRET = 15,
  ENEMY_ROBOT = 16,
  ENEMY_COUNT = 17,
  ENEMY_NONE = 0xFF
} EnemyId;

typedef enum {
  ABIL_STRIKE = 0,
  ABIL_RAISE_SHIELD = 1,
  ABIL_TAKE_COVER = 2,
  ABIL_DEMORALIZE = 3,
  ABIL_FIRST_AID = 4,
  ABIL_STAND = 5,
  ABIL_SUPPRESSIVE_FIRE = 6,
  ABIL_DOUBLE_STRIKE = 7,
  ABIL_CHARGE = 8,
  ABIL_RALLY = 9,
  ABIL_MARK_TARGET = 10,
  ABIL_PRECISE_SHOT = 11,
  ABIL_CRIPPLING_SHOT = 12,
  ABIL_VOLLEY = 13,
  ABIL_FIELD_DRESSING = 14,
  ABIL_STIMULANT = 15,
  ABIL_ADRENALINE = 16,
  ABIL_FIELD_CLINIC = 17,
  ABIL_COMBAT_DRONE = 18,
  ABIL_EMP_GRENADE = 19,
  ABIL_REPAIR_ARMOR = 20,
  ABIL_WEAPON_TUNE = 21,
  ABIL_SNEAK_ATTACK = 22,
  ABIL_DODGE = 23,
  ABIL_STEAL = 24,
  ABIL_DIRTY_TRICK = 25,
  ABIL_RAGE = 26,
  ABIL_ROAR = 27,
  ABIL_REND = 28,
  ABIL_SHOVE = 29,
  ABIL_SECOND_WIND = 30,
  ABIL_BITE_TRIP = 31,
  ABIL_SWARM_CLOUD = 32,
  ABIL_POISON_STING = 33,
  ABIL_QUAKE = 34,
  ABIL_RAD_TOUCH = 35,
  ABIL_FRENZY = 36,
  ABIL_THROW_MOLOTOV = 37,
  ABIL_HEADSHOT = 38,
  ABIL_CHIEF_RALLY = 39,
  ABIL_SELF_DESTRUCT = 40,
  ABIL_TURRET_BURST = 41,
  ABIL_ROCKET_SALVO = 42,
  ABIL_KOSTUCHA_CULL = 43,
  ABIL_KOSTUCHA_BARRAGE = 44,
  ABIL_KOSTUCHA_COMMAND = 45,
  ABIL_COUNT = 46,
  ABIL_NONE = 0xFF
} AbilityId;

typedef enum {
  RECRUIT_HAK = 0,
  RECRUIT_SOWA = 1,
  RECRUIT_IGLA = 2,
  RECRUIT_LUT = 3,
  RECRUIT_SZCZUREK = 4,
  RECRUIT_BIZON = 5,
  RECRUIT_KRUK = 6,
  RECRUIT_PLESN = 7,
  RECRUIT_ISKRA = 8,
  RECRUIT_GRZMOT = 9,
  RECRUIT_SZEPT = 10,
  RECRUIT_ZGRZYT = 11,
  RECRUIT_MUR = 12,
  RECRUIT_RETORTA = 13,
  RECRUIT_AKSAMIT = 14,
  RECRUIT_ZERO = 15,
  RECRUIT_COUNT = 16
} RecruitId;

typedef enum {
  DMG_P = 0,
  DMG_S = 1,
  DMG_B = 2,
  DMG_FIRE = 3,
  DMG_ACID = 4,
  DMG_ELEC = 5,
  DMG_POISON = 6,
  DMG_BLEED = 7,
  DMG_RAD = 8,
  DMG_COUNT = 9,
  DMG_NONE = 0xFF
} DamageType;

typedef enum {
  ITYPE_WEAPON = 0,
  ITYPE_ARMOR = 1,
  ITYPE_SHIELD = 2,
  ITYPE_CONSUMABLE = 3,
  ITYPE_JUNK = 4,
  ITYPE_TECH = 5,
  ITYPE_AMMO = 6,
  ITYPE_COUNT = 7
} ItemType;

typedef enum {
  WCAT_SIMPLE = 0,
  WCAT_MARTIAL = 1,
  WCAT_ADVANCED = 2,
  WCAT_UNARMED = 3,
  WCAT_COUNT = 4
} WeaponCategory;

typedef enum {
  DEF_UNARMORED = 0,
  DEF_LIGHT = 1,
  DEF_MEDIUM = 2,
  DEF_HEAVY = 3,
  DEF_COUNT = 4
} DefenseCategory;

typedef enum {
  WGROUP_MELEE = 0,
  WGROUP_BOW = 1,
  WGROUP_FIREARM = 2,
  WGROUP_LASER = 3,
  WGROUP_UNARMED = 4,
  WGROUP_COUNT = 5
} WeaponGroup;

typedef enum {
  SFX_MELEE = 0,
  SFX_SHOT_PISTOL = 1,
  SFX_SHOT_SHOTGUN = 2,
  SFX_SHOT_SMG = 3,
  SFX_SHOT_RIFLE = 4,
  SFX_SHOT_LASER = 5,
  SFX_EXPLOSION = 6,
  SFX_COUNT = 7
} AttackSfx;

typedef enum {
  EFACTION_RAIDER = 0,
  EFACTION_MUTANT = 1,
  EFACTION_BEAST = 2,
  EFACTION_MACHINE = 3,
  EFACTION_COUNT = 4
} EnemyFaction;

typedef enum {
  AI_MELEE = 0,
  AI_RANGED = 1,
  AI_BEAST = 2,
  AI_COWARD = 3,
  AI_BOSS = 4,
  AI_COUNT = 5
} EnemyAI;

typedef enum {
  SHAPE_QUAD = 0,
  SHAPE_SWARM = 1,
  SHAPE_BIG = 2,
  SHAPE_HUMANOID = 3,
  SHAPE_DRONE = 4,
  SHAPE_TURRET = 5,
  SHAPE_COUNT = 6
} EnemyShape;

typedef enum {
  BODY_LIGHT = 0,
  BODY_MEDIUM = 1,
  BODY_HEAVY = 2,
  BODY_COUNT = 3,
  BODY_NONE = 0xFF
} BodyType;

typedef enum {
  TARGET_SELF = 0,
  TARGET_ALLY = 1,
  TARGET_ENEMY = 2,
  TARGET_AREA = 3,
  TARGET_NONE = 4,
  TARGET_COUNT = 5
} TargetKind;

typedef enum {
  FX_MELEE = 0,
  FX_BUFF = 1,
  FX_SHOUT = 2,
  FX_HEAL = 3,
  FX_SHOT = 4,
  FX_EXPLOSION = 5,
  FX_COUNT = 6
} AbilityFx;

typedef enum {
  CEFFECT_HEAL = 0,
  CEFFECT_CLEANSE = 1,
  CEFFECT_DAMAGE = 2,
  CEFFECT_SMOKE = 3,
  CEFFECT_BUFF = 4,
  CEFFECT_COUNT = 5
} ConsumableEffect;

typedef enum {
  SAVE_FORTITUDE = 0,
  SAVE_REFLEX = 1,
  SAVE_WILL = 2,
  SAVE_COUNT = 3,
  SAVE_NONE = 0xFF
} SaveId;

typedef enum {
  CKIND_FLAG = 0,
  CKIND_DECAY = 1,
  CKIND_TIMED = 2,
  CKIND_PERSISTENT = 3,
  CKIND_CONSUME = 4,
  CKIND_SHORT = 5,
  CKIND_COUNT = 6
} ConditionKind;

typedef enum {
  USES_UNLIMITED = 0,
  USES_ENCOUNTER = 1,
  USES_DAY = 2,
  USES_COUNT = 3
} UsesKind;

typedef enum {
  BIOME_RUINS = 0,
  BIOME_WASTES = 1,
  BIOME_INDUSTRIAL = 2,
  BIOME_BUNKER = 3,
  BIOME_COUNT = 4
} Biome;

typedef enum {
  OBJ_ELIMINATE = 0,
  OBJ_RETRIEVE = 1,
  OBJ_RESCUE = 2,
  OBJ_HUNT = 3,
  OBJ_BOSS = 4,
  OBJ_HACK = 5,
  OBJ_LIBERATE = 6,
  OBJ_PURGE = 7,
  OBJ_DEFEND = 8,
  OBJ_COUNT = 9
} ObjectiveType;

typedef enum {
  FACTION_SURVIVORS = 0,
  FACTION_NOMADS = 1,
  FACTION_COUNT = 2,
  FACTION_NONE = 0xFF
} FactionId;

typedef enum {
  MOOD_DAY = 0,
  MOOD_DUSK = 1,
  MOOD_NIGHT = 2,
  MOOD_TOXIC = 3,
  MOOD_STORM = 4,
  MOOD_COUNT = 5
} Mood;

typedef enum {
  LOCK_POOR = 0,
  LOCK_SIMPLE = 1,
  LOCK_AVERAGE = 2,
  LOCK_GOOD = 3,
  LOCK_SUPERIOR = 4,
  LOCK_COUNT = 5
} LockQuality;

typedef enum {
  DEVICE_TERMINAL = 0,
  DEVICE_COMPUTER = 1,
  DEVICE_SERVER = 2,
  DEVICE_SECURITY = 3,
  DEVICE_ROBOT = 4,
  DEVICE_COUNT = 5
} DeviceKind;

/* cechy broni (bitmaska); deadly/fatal jako osobne pola z kością */
#define WT_AGILE (1u << 0)
#define WT_FINESSE (1u << 1)
#define WT_FORCEFUL (1u << 2)
#define WT_SWEEP (1u << 3)
#define WT_SHOVE (1u << 4)
#define WT_SCATTER (1u << 5)
#define WT_AUTOMATIC (1u << 6)
#define WT_REACH (1u << 7)
#define WT_THROWN (1u << 8)

/* cechy wrogów (bitmaska) */
#define ET_ANIMAL (1u << 0)
#define ET_SWARM (1u << 1)
#define ET_MUTANT (1u << 2)
#define ET_BOSS (1u << 3)
#define ET_MACHINE (1u << 4)

/* cechy ras (bitmaska) */
#define AT_HUMAN (1u << 0)
#define AT_HUMANOID (1u << 1)
#define AT_MUTANT (1u << 2)
#define AT_CYBORG (1u << 3)
#define AT_MACHINE (1u << 4)
#define AT_NOMAD (1u << 5)
#define AT_RATLING (1u << 6)
#define AT_OGRIN (1u << 7)

/* bitmaska typów obrażeń: (1u << DMG_x); bitmaska stanów: (1UL << COND_x) */

/* ---- struktury */
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
extern const TravelEvent TRAVEL_EVENTS[10];
#define TRAVEL_EVENT_COUNT 10
extern const TravelEvent FAUNA_ATTACK_EVENT; /* teksty z {N} = nazwa wielką literą, {n} = nazwa */
extern const char *const FAUNA_NAMES[8];
extern const char *const FAUNA_TEMPLATE_KEYS[8];
#define FAUNA_KIND_COUNT 8
extern const ContractTemplate CONTRACT_TEMPLATES[OBJ_COUNT]; /* indeks = ObjectiveType; OBJ_BOSS puste */
extern const uint8_t SIDE_TYPES[8];
#define SIDE_TYPE_COUNT 8
extern const char *const GIVERS[FACTION_COUNT][5];
extern const StoryContract STORY_CONTRACTS[3];
#define STORY_CONTRACT_COUNT 3
extern const StoryNeed STORY_NEED[3];
extern const uint8_t STORY_BUDGET[3];

extern const uint8_t DC_TABLE[16];
#define DC_TABLE_LEN 16
extern const uint8_t ENCOUNTER_XP[9];   /* [roznica_poziomow + 4], roznica -4..4 */
extern const int8_t MAP_PENALTY[2][3];  /* [0] zwykla, [1] agile */
extern const uint8_t COVER_AC[3];       /* [in_cover] */
extern const uint8_t UNIVERSAL_ABILITIES[6];
#define UNIVERSAL_ABILITY_COUNT 6
extern const uint8_t PERSISTENT_CONDS[3];
#define PERSISTENT_COUNT 3

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
extern const char *const INTRO_SLIDES[6];
#define INTRO_SLIDE_COUNT 6
extern const char *const EPILOGUE[4];
#define EPILOGUE_COUNT 4
extern const char *const GAMEOVER_LINES[2];
extern const char *const TIPS[3];
extern const char *const CREDITS[7][2];
#define CREDITS_COUNT 7

extern const int16_t SIN_LUT[256];
extern const uint16_t EASE_OUT3_LUT[65];

#endif /* GAMEDATA_H */
