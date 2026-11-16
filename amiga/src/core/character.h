/* Postać (najemnik albo wróg), stany, statystyki pochodne, broń, tworzenie i awans.
 * Port src/core/rules/types.ts (Character), stats.ts i character.ts. */
#ifndef CHARACTER_H
#define CHARACTER_H

#include <stdint.h>
#include "../data/gamedata.h"
#include "rng.h"

#define NAME_MAX 24
#define INV_MAX 32
#define CHAR_ABIL_MAX 16
#define USES_UNSET 0xFF

enum { SLOT_WEAPON, SLOT_WEAPON2, SLOT_ARMOR, SLOT_SHIELD, SLOT_COUNT };

/* Klucze statystyk: 0..SKILL_COUNT-1 = umiejętności (SkillId), dalej reszta. SKILL_PERCEPTION = STAT_PERCEPTION. */
enum { STAT_AC = SKILL_COUNT, STAT_SPEED, STAT_PERCEPTION, STAT_CLASS_DC, STAT_FORT, STAT_REF, STAT_WILL };

typedef struct { uint8_t id, qty; } ItemInst; /* id = ITEM_NONE: puste */

typedef struct {
  uint8_t body;                /* BodyType */
  uint32_t skin, hair, cloth, accent; /* COLOR_NONE = brak */
  uint8_t hair_style;
  uint8_t mask, mutation, cyber;
} CharLook;

typedef struct {
  char name[NAME_MAX + 1];     /* ISO-8859-2 */
  const char *name_acc;        /* biernik do dziennika (wrogowie); NULL = name */
  uint8_t is_enemy;
  uint8_t ancestry;            /* AncestryId; NONE8 u wrogów */
  uint8_t class_id;            /* CLASS_NONE u wrogów */
  uint8_t recruit;             /* RecruitId albo NONE8 */
  uint8_t template_id;         /* EnemyId albo ENEMY_NONE */
  uint8_t level;
  uint16_t xp;
  int8_t attrs[ATTR_COUNT];
  int16_t max_hp, hp, temp_hp;
  Prof prof;
  uint8_t n_skill_order, skill_order[SKILL_COUNT]; /* kolejność kluczy prof.skills jak w TS */
  ItemInst equip[SLOT_COUNT];
  uint8_t n_inv;
  ItemInst inv[INV_MAX];
  uint8_t n_abilities, abilities[CHAR_ABIL_MAX];
  uint8_t uses[ABIL_COUNT];    /* pozostałe użycia; USES_UNSET = bez limitu / nieznana */
  int8_t cond[COND_COUNT];     /* wartość stanu; 0 = brak */
  Dice cond_dice[COND_COUNT];  /* kość obrażeń ciągłych (bleeding/burning/poisoned) */
  uint8_t speed;
  CharLook look;
  /* tylko wrogowie (base w TS) */
  uint8_t ac_base;
  int8_t fort_base, ref_base, will_base, perception_base, class_dc_base;
  uint8_t n_attacks;
  EnemyAttack attacks[2];      /* kopie z premią/obrażeniami po levelAdj */
  uint8_t stolen;
  uint16_t stolen_scrap;
  uint32_t name_color;         /* COLOR_NONE = domyślny */
} Character;

/* Broń sprowadzona do wspólnej postaci (przedmiot gracza albo atak wroga). */
typedef struct {
  const char *name;
  uint8_t item;                /* ItemId albo ITEM_NONE dla ataku wroga */
  Dice dmg;
  uint8_t type, range;
  uint8_t category;            /* WeaponCategory albo NONE8 */
  uint16_t traits;             /* WT_* */
  uint8_t deadly, fatal, sfx, potency, hands;
  uint8_t has_flat;            /* stała premia do trafienia (ataki wrogów) */
  int8_t flat;
} NormWeapon;

/* ---- stany (stats.ts) */
int cond_value(const Character *ch, uint8_t id);
int has_cond(const Character *ch, uint8_t id);
void add_condition(Character *ch, uint8_t id, int value);
void add_condition_dice(Character *ch, uint8_t id, Dice d);
void remove_condition(Character *ch, uint8_t id);
int is_off_guard(const Character *ch);
int status_penalty(const Character *ch);
int die_halves(const Character *ch);
int conceal_halves(const Character *def);
int attack_halves(const Character *att, const Character *def);
int attr_mod(const Character *ch, uint8_t attr);

/* ---- ekwipunek i statystyki */
const ArmorStats *armor_of(const Character *ch);
const ShieldStats *shield_of(const Character *ch);
int get_stat(const Character *ch, int key, int ignore_cover);

/* ---- broń */
void norm_from_item(uint8_t item, NormWeapon *out);
void norm_from_attack(const EnemyAttack *a, NormWeapon *out);
int get_weapons(const Character *ch, NormWeapon out[2]); /* zwraca liczbę (min. 1 - Pięść) */
int get_attack_bonus(const Character *ch, const NormWeapon *w, int map_index, int range_increments);

/* ---- tworzenie, awans, odpoczynek (character.ts) */
static inline int is_dead(const Character *ch) { return ch->cond[COND_DEAD] != 0; }
void char_create(Character *ch, const char *name, uint8_t ancestry, uint8_t class_id, int level, uint8_t recruit);
void char_from_recruit(Character *ch, uint8_t recruit, const char *name, int level); /* name NULL = z rekruta */
void char_create_enemy(Character *ch, uint8_t template_id, int level_adj);
void recalc_hp(Character *ch);
int level_up(Character *ch);
int add_xp(Character *ch, int xp);
int encounter_xp(int party_level, const uint8_t *enemy_levels, int n);
void refresh_uses(Character *ch, int which); /* which: -1 wszystkie, USES_ENCOUNTER, USES_DAY */
void end_encounter(Character *ch);
void long_rest(Character *ch);
int inv_add(Character *ch, uint8_t item, int qty); /* bez łączenia w stosy (jak push w TS); 0 = brak miejsca */
int roll_loot(Rng *r, uint8_t template_id, ItemInst *items, int max_items, int *n_items); /* zwraca Złom */

#endif
