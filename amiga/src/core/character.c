/* Tworzenie najemników i wrogów, awans, PD, odpoczynek, łup. Port src/core/rules/character.ts. */
#include <string.h>
#include "character.h"

/* ---------------------------------------------------------------- pomocnicze */
static void copy_name(char *dst, const char *src) {
  size_t n = strlen(src);
  if (n > NAME_MAX) n = NAME_MAX;
  memcpy(dst, src, n);
  dst[n] = 0;
}

/* hashName: h = 7; h = (h * 31 + kod) mod 2^32 po znakach (Unicode) imienia, id rasy i id klasy. */
static uint32_t hash_feed(uint32_t h, const char *s) {
  const unsigned char *p = (const unsigned char *)s;
  for (; *p; p++) h = h * 31u + latin2_unicode(*p);
  return h;
}

static void clear_char(Character *ch) {
  int i;
  memset(ch, 0, sizeof *ch);
  ch->ancestry = NONE8;
  ch->class_id = CLASS_NONE;
  ch->recruit = NONE8;
  ch->template_id = ENEMY_NONE;
  for (i = 0; i < SLOT_COUNT; i++) ch->equip[i].id = ITEM_NONE;
  for (i = 0; i < ABIL_COUNT; i++) ch->uses[i] = USES_UNSET;
  ch->name_color = COLOR_NONE;
  ch->look.body = BODY_NONE;
  ch->look.skin = ch->look.hair = ch->look.cloth = ch->look.accent = COLOR_NONE;
}

static int has_ability(const Character *ch, uint8_t id) {
  int i;
  for (i = 0; i < ch->n_abilities; i++) if (ch->abilities[i] == id) return 1;
  return 0;
}

static void give_ability(Character *ch, uint8_t id) {
  const AbilityDef *ab = &ABILITY_DEFS[id];
  if (!has_ability(ch, id) && ch->n_abilities < CHAR_ABIL_MAX) ch->abilities[ch->n_abilities++] = id;
  if (ab->uses != USES_UNLIMITED && ch->uses[id] == USES_UNSET) ch->uses[id] = ab->uses_max ? ab->uses_max : 1;
}

/* mergeProf: rangi tylko w górę; nowe umiejętności dopisywane na koniec kolejności. */
static void merge_skill(Character *ch, uint8_t s, uint8_t rank) {
  int i, known = 0;
  if (!rank) return;
  for (i = 0; i < ch->n_skill_order; i++) if (ch->skill_order[i] == s) known = 1;
  if (!known) ch->skill_order[ch->n_skill_order++] = s;
  if (ch->prof.skills[s] < rank) ch->prof.skills[s] = rank;
}
#define UPMAX(a, b) do { if ((a) < (b)) (a) = (b); } while (0)
static void merge_prof(Character *ch, const Prof *add, const uint8_t *order, int n_order) {
  int i;
  UPMAX(ch->prof.perception, add->perception);
  UPMAX(ch->prof.fortitude, add->fortitude);
  UPMAX(ch->prof.reflex, add->reflex);
  UPMAX(ch->prof.will, add->will);
  UPMAX(ch->prof.class_dc, add->class_dc);
  if (order) {
    for (i = 0; i < n_order; i++) merge_skill(ch, order[i], add->skills[order[i]]);
  } else {
    /* progresja klasy: tylko istniejące klucze (sprawdzane przez gen_headers.ts) */
    for (i = 0; i < SKILL_COUNT; i++) merge_skill(ch, (uint8_t)i, add->skills[i]);
  }
  for (i = 0; i < WCAT_COUNT; i++) UPMAX(ch->prof.attacks[i], add->attacks[i]);
  for (i = 0; i < DEF_COUNT; i++) UPMAX(ch->prof.defense[i], add->defense[i]);
}

static void sync_abilities(Character *ch) {
  const ClassDef *c;
  int i;
  if (ch->class_id >= CLASS_COUNT) return;
  c = &CLASS_DEFS[ch->class_id];
  for (i = 0; i < UNIVERSAL_ABILITY_COUNT; i++) give_ability(ch, UNIVERSAL_ABILITIES[i]);
  for (i = 0; i < c->n_abilities; i++) if (c->unlock_level[i] <= ch->level) give_ability(ch, c->abilities[i]);
}

int inv_add(Character *ch, uint8_t item, int qty) {
  if (ch->n_inv >= INV_MAX) return 0;
  ch->inv[ch->n_inv].id = item;
  ch->inv[ch->n_inv].qty = (uint8_t)qty;
  ch->n_inv++;
  return 1;
}

static int is_two_handed(uint8_t item) {
  return item < ITEM_COUNT && ITEM_DEFS[item].weapon && ITEM_DEFS[item].weapon->hands == 2;
}

/* ---------------------------------------------------------------- PW */
void recalc_hp(Character *ch) {
  int nm, diff;
  if (ch->is_enemy || ch->class_id >= CLASS_COUNT) return;
  nm = ANCESTRY_DEFS[ch->ancestry].hp + (CLASS_DEFS[ch->class_id].hp_per_level + ch->attrs[ATTR_CON]) * ch->level;
  diff = nm - ch->max_hp;
  ch->max_hp = (int16_t)nm;
  if (diff > 0 && ch->hp > 0) ch->hp = (int16_t)(ch->hp + diff);
  if (ch->hp > ch->max_hp) ch->hp = ch->max_hp;
}

/* ---------------------------------------------------------------- tworzenie */
static uint8_t class_body(uint8_t c) {
  if (c == CLASS_BRUTE || c == CLASS_SOLDIER || c == CLASS_CHAMPION || c == CLASS_MONK) return BODY_HEAVY;
  if (c == CLASS_SCAVENGER || c == CLASS_SCOUT || c == CLASS_GUNSLINGER || c == CLASS_HACKER || c == CLASS_HERALD) return BODY_LIGHT;
  return BODY_MEDIUM;
}

void char_create(Character *ch, const char *name, uint8_t ancestry, uint8_t class_id, int level, uint8_t recruit) {
  const ClassDef *c = &CLASS_DEFS[class_id < CLASS_COUNT ? class_id : CLASS_SOLDIER];
  const AncestryDef *a;
  uint32_t h;
  int i, target;
  clear_char(ch);
  if (ancestry >= ANC_COUNT) ancestry = ANC_HUMAN;
  a = &ANCESTRY_DEFS[ancestry];
  copy_name(ch->name, name && *name ? name : "Najemnik");
  ch->ancestry = ancestry;
  ch->class_id = (uint8_t)(c - CLASS_DEFS);
  ch->recruit = recruit;
  ch->level = 1;

  /* cechy: klasa + premie rasy (dowolne wg boost_order) + wady, maks. +4 */
  for (i = 0; i < ATTR_COUNT; i++) ch->attrs[i] = (int8_t)(c->attrs[i] + a->attr_boost[i] + a->attr_flaw[i]);
  for (i = 0; i < a->free_boosts && i < 4; i++) ch->attrs[c->boost_order[i]]++;
  for (i = 0; i < ATTR_COUNT; i++) if (ch->attrs[i] > 4) ch->attrs[i] = 4;

  /* biegłości: klasa, potem umiejętności rasy (kolejność kluczy jak w TS) */
  ch->prof = c->prof;
  ch->n_skill_order = c->n_skill_order;
  memcpy(ch->skill_order, c->skill_order, SKILL_COUNT);
  {
    Prof add;
    memset(&add, 0, sizeof add);
    memcpy(add.skills, a->skills, SKILL_COUNT);
    merge_prof(ch, &add, a->skill_order, a->n_skill_order);
  }

  /* wygląd (pickBy z hasha imienia; hair: w TS `h >> 3` jest ze znakiem - ujemny indeks = brak koloru, -0 = pierwszy) */
  h = hash_feed(hash_feed(hash_feed(7u, ch->name), a->key), c->key);
  ch->look.body = class_body(ch->class_id);
  ch->look.skin = a->n_skin ? a->skin[h % a->n_skin] : 0xC9A07AUL;
  if (a->n_hair) {
    int32_t s = (int32_t)h >> 3; /* przesunięcie arytmetyczne jak w JS (gcc/clang) */
    int32_t m = s % (int32_t)a->n_hair;
    ch->look.hair = m < 0 ? COLOR_NONE : a->hair[m];
  } else {
    ch->look.hair = 0x222222UL;
  }
  ch->look.hair_style = (uint8_t)(h % 6u);
  ch->look.cloth = c->color;
  ch->look.accent = 0xC8A040UL;
  ch->look.mask = 0;
  ch->look.mutation = a->mutation;
  ch->look.cyber = a->cyber;
  if (recruit < RECRUIT_COUNT) {
    const RecruitLook *l = &RECRUIT_DEFS[recruit].look;
    if (l->body != BODY_NONE) ch->look.body = l->body;
    if (l->skin != COLOR_NONE) ch->look.skin = l->skin;
    if (l->hair != COLOR_NONE) ch->look.hair = l->hair;
    if (l->cloth != COLOR_NONE) ch->look.cloth = l->cloth;
    if (l->accent != COLOR_NONE) ch->look.accent = l->accent;
    if (l->hair_style >= 0) ch->look.hair_style = (uint8_t)l->hair_style;
    if (l->mask >= 0) ch->look.mask = (uint8_t)l->mask;
    if (l->mutation >= 0) ch->look.mutation = (uint8_t)l->mutation;
    if (l->cyber >= 0) ch->look.cyber = (uint8_t)l->cyber;
  }

  ch->speed = a->speed;
  recalc_hp(ch);
  ch->hp = ch->max_hp;

  /* ekwipunek startowy */
  for (i = 0; i < c->n_start_gear; i++) {
    uint8_t id = c->start_gear[i];
    const ItemDef *it = &ITEM_DEFS[id];
    int two = is_two_handed(ch->equip[SLOT_WEAPON].id);
    if (it->type == ITYPE_WEAPON && ch->equip[SLOT_WEAPON].id == ITEM_NONE) ch->equip[SLOT_WEAPON].id = id, ch->equip[SLOT_WEAPON].qty = 1;
    else if (it->type == ITYPE_WEAPON && ch->equip[SLOT_WEAPON2].id == ITEM_NONE) ch->equip[SLOT_WEAPON2].id = id, ch->equip[SLOT_WEAPON2].qty = 1;
    else if (it->type == ITYPE_ARMOR && ch->equip[SLOT_ARMOR].id == ITEM_NONE) ch->equip[SLOT_ARMOR].id = id, ch->equip[SLOT_ARMOR].qty = 1;
    else if (it->type == ITYPE_SHIELD && ch->equip[SLOT_SHIELD].id == ITEM_NONE && !two) ch->equip[SLOT_SHIELD].id = id, ch->equip[SLOT_SHIELD].qty = 1;
    else {
      int k, found = -1;
      for (k = 0; k < ch->n_inv; k++) if (ch->inv[k].id == id) { found = k; break; }
      if (found >= 0 && it->type == ITYPE_CONSUMABLE) ch->inv[found].qty++;
      else inv_add(ch, id, 1);
    }
  }
  sync_abilities(ch);
  target = level < 1 ? 1 : level > MAX_LEVEL ? MAX_LEVEL : level;
  while (ch->level < target) level_up(ch);
}

void char_from_recruit(Character *ch, uint8_t recruit, const char *name, int level) {
  const RecruitDef *r = &RECRUIT_DEFS[recruit];
  char_create(ch, name ? name : r->name, r->ancestry, r->class_id, level, recruit);
}

void char_create_enemy(Character *ch, uint8_t template_id, int adj) {
  const EnemyDef *t = &ENEMY_DEFS[template_id];
  static const int8_t ENEMY_ATTRS[ATTR_COUNT] = {2, 2, 2, 0, 1, 0};
  int i, hp, lvl;
  clear_char(ch);
  copy_name(ch->name, t->name);
  ch->name_acc = t->acc ? t->acc : t->name;
  ch->is_enemy = 1;
  ch->template_id = template_id;
  /* PW: x1.25 / x0.8 zaokrąglone jak Math.round */
  hp = adj == 0 ? t->hp : adj > 0 ? (5 * t->hp + 2) / 4 : (8 * t->hp + 5) / 10;
  ch->max_hp = ch->hp = (int16_t)(hp < 1 ? 1 : hp);
  lvl = t->level + adj;
  ch->level = (uint8_t)(lvl < 0 ? 0 : lvl);
  memcpy(ch->attrs, ENEMY_ATTRS, sizeof ENEMY_ATTRS);
  ch->n_attacks = t->n_attacks;
  for (i = 0; i < t->n_attacks; i++) {
    ch->attacks[i] = t->attacks[i];
    if (adj) {
      ch->attacks[i].bonus = (int8_t)(t->attacks[i].bonus + adj);
      ch->attacks[i].damage.mod = (int8_t)(t->attacks[i].damage.mod + 2 * adj);
    }
  }
  ch->abilities[ch->n_abilities++] = ABIL_STRIKE;
  for (i = 0; i < t->n_abilities; i++) {
    uint8_t id = t->abilities[i];
    ch->abilities[ch->n_abilities++] = id;
    if (ABILITY_DEFS[id].uses != USES_UNLIMITED) ch->uses[id] = ABILITY_DEFS[id].uses_max ? ABILITY_DEFS[id].uses_max : 1;
  }
  ch->speed = t->speed;
  ch->ac_base = (uint8_t)(t->ac + adj);
  ch->fort_base = (int8_t)(t->fort + adj);
  ch->ref_base = (int8_t)(t->ref + adj);
  ch->will_base = (int8_t)(t->will + adj);
  ch->perception_base = (int8_t)(t->perception + adj);
  ch->class_dc_base = (int8_t)(10 + t->attacks[0].bonus + adj);
  ch->look.body = t->look.body;
  ch->look.skin = t->look.skin;
  ch->look.hair = t->look.hair;
  ch->look.cloth = t->look.cloth;
  ch->look.accent = t->look.accent;
  ch->look.mask = t->look.mask;
  ch->look.mutation = t->look.mutation;
  ch->look.cyber = t->look.cyber;
}

/* ---------------------------------------------------------------- awans i PD */
int level_up(Character *ch) {
  const ClassDef *c;
  int i;
  if (ch->is_enemy || ch->level >= MAX_LEVEL || ch->class_id >= CLASS_COUNT) return 0;
  c = &CLASS_DEFS[ch->class_id];
  ch->level++;
  merge_prof(ch, &c->progression[ch->level], NULL, 0);
  if (ch->level % 5 == 0) {
    for (i = 0; i < 4; i++) {
      uint8_t a = c->boost_order[i];
      if (ch->attrs[a] < 5) ch->attrs[a]++;
    }
  }
  if (ch->level % 2 == 0) {
    /* stabilne sortowanie kluczy malejąco po randze, pierwsza umiejętność poniżej Eksperta +1 */
    uint8_t sorted[SKILL_COUNT];
    int n = ch->n_skill_order, j;
    memcpy(sorted, ch->skill_order, (size_t)n);
    for (i = 1; i < n; i++) {
      uint8_t x = sorted[i];
      for (j = i; j > 0 && ch->prof.skills[sorted[j - 1]] < ch->prof.skills[x]; j--) sorted[j] = sorted[j - 1];
      sorted[j] = x;
    }
    for (i = 0; i < n; i++) {
      if (ch->prof.skills[sorted[i]] < 2) {
        ch->prof.skills[sorted[i]]++;
        break;
      }
    }
  }
  recalc_hp(ch);
  sync_abilities(ch);
  return 1;
}

int add_xp(Character *ch, int xp) {
  int gained = 0;
  if (ch->is_enemy) return 0;
  if (xp > 0) ch->xp = (uint16_t)(ch->xp + xp);
  while (ch->xp >= XP_PER_LEVEL && ch->level < MAX_LEVEL) {
    ch->xp = (uint16_t)(ch->xp - XP_PER_LEVEL);
    level_up(ch);
    gained++;
  }
  if (ch->level >= MAX_LEVEL && ch->xp > XP_PER_LEVEL - 1) ch->xp = XP_PER_LEVEL - 1;
  return gained;
}

int encounter_xp(int party_level, const uint8_t *enemy_levels, int n) {
  int i, sum = 0;
  for (i = 0; i < n; i++) {
    int diff = enemy_levels[i] - party_level;
    if (diff < -4) continue;
    if (diff > 4) diff = 4;
    sum += ENCOUNTER_XP[diff + 4];
  }
  return sum;
}

/* ---------------------------------------------------------------- odpoczynek */
void refresh_uses(Character *ch, int which) {
  int i;
  for (i = 0; i < ABIL_COUNT; i++) {
    const AbilityDef *ab = &ABILITY_DEFS[i];
    if (ch->uses[i] == USES_UNSET || ab->uses == USES_UNLIMITED) continue;
    if (which < 0 || ab->uses == which) ch->uses[i] = ab->uses_max ? ab->uses_max : 1;
  }
}

void end_encounter(Character *ch) {
  int i;
  if (is_dead(ch)) return;
  for (i = 0; i < COND_COUNT; i++) {
    if (i == COND_DYING || i == COND_WOUNDED || i == COND_UNCONSCIOUS || i == COND_DEAD || i == COND_BLEEDING) continue;
    remove_condition(ch, (uint8_t)i);
  }
  if (ch->hp > 0) ch->temp_hp = 0;
  refresh_uses(ch, USES_ENCOUNTER);
}

void long_rest(Character *ch) {
  int i;
  if (is_dead(ch)) return;
  ch->hp = ch->max_hp;
  ch->temp_hp = 0;
  for (i = 0; i < COND_COUNT; i++) remove_condition(ch, (uint8_t)i);
  refresh_uses(ch, -1);
}

/* ---------------------------------------------------------------- łup */
int roll_loot(Rng *r, uint8_t template_id, ItemInst *items, int max_items, int *n_items) {
  const EnemyDef *t = &ENEMY_DEFS[template_id];
  int i, scrap = rng_int(r, t->scrap_min, t->scrap_max);
  *n_items = 0;
  for (i = 0; i < t->n_loot; i++) {
    if (rng_chance(r, t->loot[i].chance_le) && *n_items < max_items) {
      items[*n_items].id = t->loot[i].item;
      items[*n_items].qty = t->loot[i].qty ? t->loot[i].qty : 1;
      (*n_items)++;
    }
  }
  return scrap;
}
