/* Stany, statystyki pochodne i broń. Port src/core/rules/stats.ts. */
#include "character.h"
#include "dice.h"

/* ---------------------------------------------------------------- stany */
int cond_value(const Character *ch, uint8_t id) { return ch->cond[id]; }
int has_cond(const Character *ch, uint8_t id) { return ch->cond[id] != 0; }

static int is_persistent(uint8_t id) {
  int i;
  for (i = 0; i < PERSISTENT_COUNT; i++) if (PERSISTENT_CONDS[i] == id) return 1;
  return 0;
}

/* Wspólne bramki addCondition: martwi i niewrażliwi (w TS tylko 'poisoned' przy niewrażliwości na 'poison'). */
static int cond_blocked(const Character *ch, uint8_t id) {
  if (ch->cond[COND_DEAD] && id != COND_DEAD) return 1;
  if (ch->is_enemy && ch->template_id != ENEMY_NONE && id == COND_POISONED &&
      (ENEMY_DEFS[ch->template_id].immune & (1u << DMG_POISON)))
    return 1;
  return 0;
}

static void set_cond(Character *ch, uint8_t id, int value) {
  const ConditionDef *m = &CONDITION_DEFS[id];
  if (m->valued || m->kind == CKIND_TIMED || m->kind == CKIND_DECAY || m->kind == CKIND_CONSUME) {
    int cur = ch->cond[id];
    ch->cond[id] = (int8_t)(cur > value ? cur : value);
  } else {
    ch->cond[id] = (int8_t)value;
  }
}

void add_condition(Character *ch, uint8_t id, int value) {
  if (cond_blocked(ch, id)) return;
  if (is_persistent(id)) {
    ch->cond[id] = (int8_t)value;
    ch->cond_dice[id].n = 0;
    ch->cond_dice[id].sides = 0;
    ch->cond_dice[id].mod = (int8_t)value;
    return;
  }
  set_cond(ch, id, value);
}

void add_condition_dice(Character *ch, uint8_t id, Dice d) {
  if (cond_blocked(ch, id)) return;
  if (is_persistent(id)) {
    ch->cond[id] = 1; /* condValue kości = 1 */
    ch->cond_dice[id] = d;
    return;
  }
  set_cond(ch, id, 1);
}

void remove_condition(Character *ch, uint8_t id) {
  ch->cond[id] = 0;
  ch->cond_dice[id].n = ch->cond_dice[id].sides = 0;
  ch->cond_dice[id].mod = 0;
}

int is_off_guard(const Character *ch) { return ch->cond[COND_OFF_GUARD] || ch->cond[COND_DISTRACTED] || ch->cond[COND_PRONE]; }
int status_penalty(const Character *ch) { return ch->cond[COND_SICKENED]; }
int die_halves(const Character *ch) { return ch->cond[COND_FRIGHTENED] ? 1 : 0; }
int conceal_halves(const Character *def) { return def->cond[COND_HIDDEN] ? 1 : 0; }
int attack_halves(const Character *att, const Character *def) { return die_halves(att) + conceal_halves(def); }

int attr_mod(const Character *ch, uint8_t attr) {
  int v = ch->attrs[attr];
  if (attr == ATTR_DEX) v -= ch->cond[COND_CLUMSY];
  if (attr == ATTR_STR) v -= ch->cond[COND_ENFEEBLED];
  return v;
}

/* ---------------------------------------------------------------- ekwipunek */
const ArmorStats *armor_of(const Character *ch) {
  uint8_t id = ch->equip[SLOT_ARMOR].id;
  return id < ITEM_COUNT ? ITEM_DEFS[id].armor : NULL;
}
const ShieldStats *shield_of(const Character *ch) {
  uint8_t id = ch->equip[SLOT_SHIELD].id;
  return id < ITEM_COUNT ? ITEM_DEFS[id].shield : NULL;
}

/* ---------------------------------------------------------------- statystyki */
static const uint8_t SAVE_ATTR[3] = {ATTR_CON, ATTR_DEX, ATTR_WIS};

int get_stat(const Character *ch, int key, int ignore_cover) {
  int v, pen = status_penalty(ch), lvl = ch->level;
  if (key == SKILL_PERCEPTION) key = STAT_PERCEPTION;
  if (key == STAT_SPEED) {
    const ArmorStats *ar;
    int s;
    if (ch->speed == 0) return 0;
    ar = armor_of(ch);
    s = ch->speed - (ar ? ar->speed_penalty : 0);
    return s < 1 ? 1 : s;
  }
  if (ch->is_enemy) {
    switch (key) {
      case STAT_AC: v = ch->ac_base; break;
      case STAT_FORT: v = ch->fort_base; break;
      case STAT_REF: v = ch->ref_base - ch->cond[COND_CLUMSY]; break;
      case STAT_WILL: v = ch->will_base; break;
      case STAT_PERCEPTION: v = ch->perception_base; break;
      case STAT_CLASS_DC: v = ch->class_dc_base; break;
      default: v = ch->perception_base - 1; /* wrogowie nie mają umiejętności */
    }
  } else {
    const Prof *p = &ch->prof;
    if (key == STAT_AC) {
      const ArmorStats *ar = armor_of(ch);
      int cat = ar ? ar->category : DEF_UNARMORED;
      int dx = attr_mod(ch, ATTR_DEX);
      if (ar && dx > ar->dex_cap) dx = ar->dex_cap;
      v = BASE_AC + dx + prof_bonus(p->defense[cat], lvl) + (ar ? ar->ac : 0) + ANCESTRY_DEFS[ch->ancestry].ac_bonus;
    } else if (key == STAT_FORT || key == STAT_REF || key == STAT_WILL) {
      int s = key - STAT_FORT;
      int rank = s == 0 ? p->fortitude : s == 1 ? p->reflex : p->will;
      v = attr_mod(ch, SAVE_ATTR[s]) + prof_bonus(rank, lvl);
    } else if (key == STAT_PERCEPTION) {
      v = attr_mod(ch, ATTR_WIS) + prof_bonus(p->perception, lvl);
    } else if (key == STAT_CLASS_DC) {
      uint8_t ka = ch->class_id < CLASS_COUNT ? CLASS_DEFS[ch->class_id].key_attr : ATTR_STR;
      v = 10 + attr_mod(ch, ka) + prof_bonus(p->class_dc, lvl);
    } else if (key >= 0 && key < SKILL_COUNT) {
      uint8_t a = SKILL_DEFS[key].attr;
      v = attr_mod(ch, a) + prof_bonus(p->skills[key], lvl);
      if (a == ATTR_STR || a == ATTR_DEX) {
        const ArmorStats *ar = armor_of(ch);
        if (ar) v -= ar->check_penalty;
      }
    } else {
      v = 0;
    }
  }
  if (key == STAT_AC) {
    int circ = 0, cov = ch->cond[COND_IN_COVER];
    if (is_off_guard(ch)) v -= 2;
    if (!ignore_cover && cov) circ = COVER_AC[cov >= 2 ? 2 : 1];
    if (ch->cond[COND_RAISED_SHIELD]) {
      const ShieldStats *sh = shield_of(ch);
      int s = sh ? sh->ac : 2;
      if (s > circ) circ = s;
    }
    if (ch->cond[COND_DODGING] && circ < 2) circ = 2;
    v += circ;
    if (ch->cond[COND_REINFORCED]) v += 1;
    if (ch->cond[COND_RAGING]) v -= 1;
  }
  return v - pen;
}

/* ---------------------------------------------------------------- broń */
void norm_from_item(uint8_t item, NormWeapon *out) {
  const ItemDef *d = item <= ITEM_COUNT && ITEM_DEFS[item].weapon ? &ITEM_DEFS[item] : &ITEM_DEFS[ITEM_FIST];
  const WeaponStats *w = d->weapon;
  out->name = d->name;
  out->item = (uint8_t)(d - ITEM_DEFS);
  out->dmg = w->damage;
  out->type = w->dmg_type;
  out->range = w->range;
  out->category = w->category;
  out->traits = w->traits;
  out->deadly = w->deadly;
  out->fatal = w->fatal;
  out->sfx = w->sfx;
  out->potency = w->potency;
  out->hands = w->hands ? w->hands : 1;
  out->has_flat = 0;
  out->flat = 0;
}

void norm_from_attack(const EnemyAttack *a, NormWeapon *out) {
  out->name = a->name;
  out->item = ITEM_NONE;
  out->dmg = a->damage;
  out->type = a->dmg_type;
  out->range = a->range;
  out->category = NONE8;
  out->traits = a->traits;
  out->deadly = a->deadly;
  out->fatal = a->fatal;
  out->sfx = a->sfx;
  out->potency = 0;
  out->hands = 1;
  out->has_flat = 1;
  out->flat = a->bonus;
}

int get_weapons(const Character *ch, NormWeapon out[2]) {
  int n = 0, s;
  if (ch->is_enemy && ch->n_attacks) {
    for (s = 0; s < ch->n_attacks; s++) norm_from_attack(&ch->attacks[s], &out[s]);
    return ch->n_attacks;
  }
  for (s = SLOT_WEAPON; s <= SLOT_WEAPON2; s++) {
    uint8_t id = ch->equip[s].id;
    if (id < ITEM_COUNT && ITEM_DEFS[id].weapon) norm_from_item(id, &out[n++]);
  }
  if (!n) norm_from_item(ITEM_FIST, &out[n++]);
  return n;
}

int get_attack_bonus(const Character *ch, const NormWeapon *w, int map_index, int range_increments) {
  int b, m;
  if (map_index < 0) map_index = 0;
  if (map_index > 2) map_index = 2;
  if (ch->is_enemy || w->has_flat) {
    b = w->has_flat ? w->flat : 0;
  } else {
    if (w->range > 0) m = attr_mod(ch, ATTR_DEX);
    else if (w->traits & WT_FINESSE) {
      int s = attr_mod(ch, ATTR_STR), d = attr_mod(ch, ATTR_DEX);
      m = s > d ? s : d;
    } else m = attr_mod(ch, ATTR_STR);
    b = m + prof_bonus(w->category < WCAT_COUNT ? ch->prof.attacks[w->category] : 0, ch->level) + w->potency;
  }
  if (ch->cond[COND_STIMMED]) b += 1;
  if (ch->cond[COND_PRONE]) b -= 2;
  if (ch->is_enemy && w->range > 0) b -= ch->cond[COND_CLUMSY];
  b -= status_penalty(ch);
  b -= 2 * range_increments;
  return b + MAP_PENALTY[(w->traits & WT_AGILE) ? 1 : 0][map_index];
}
