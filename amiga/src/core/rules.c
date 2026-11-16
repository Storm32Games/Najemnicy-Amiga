/* Obrażenia, umieranie, tura, atak bronią, ekwipunek, zamki. Port src/core/rules/{damage,turn,strike,equipment,locks}.ts. */
#include <string.h>
#include "rules.h"

/* ================================================================ wynik akcji */
void result_clear(ActionResult *r) { memset(r, 0, sizeof *r); }

RuleEvent *result_event(ActionResult *r, uint8_t type, Character *target) {
  static RuleEvent sink;
  RuleEvent *e = r->n_events < RESULT_EVENTS_MAX ? &r->events[r->n_events++] : &sink;
  memset(e, 0, sizeof *e);
  e->type = type;
  e->target = target;
  e->degree = NONE8;
  e->persistent = COND_NONE;
  e->dmg_type = DMG_NONE;
  e->cond = COND_NONE;
  e->item = ITEM_NONE;
  return e;
}

/* ================================================================ obrażenia (damage.ts) */
int is_alive(const Character *ch) { return !is_dead(ch) && (ch->is_enemy ? ch->hp > 0 : 1); }
int is_down(const Character *ch) { return !is_dead(ch) && ch->hp <= 0; }
int can_act(const Character *ch) { return !is_dead(ch) && ch->hp > 0 && !ch->cond[COND_UNCONSCIOUS]; }

static void kill_char(Character *ch) {
  ch->cond[COND_DEAD] = 1;
  ch->cond[COND_DYING] = 0;
}

DamageOutcome apply_damage(Character *ch, int amount, uint8_t type, int crit) {
  DamageOutcome o = {0, 0, 0};
  const int8_t *res, *weak;
  int a, from_temp, was_up;
  if (is_dead(ch)) {
    o.dead = 1;
    return o;
  }
  a = amount < 0 ? 0 : amount;
  if (type >= DMG_COUNT) type = DMG_P;
  if (ch->is_enemy) {
    res = ENEMY_DEFS[ch->template_id].resist;
    weak = ENEMY_DEFS[ch->template_id].weak;
  } else {
    res = ANCESTRY_DEFS[ch->ancestry].resist;
    weak = ANCESTRY_DEFS[ch->ancestry].weak;
  }
  if (res[type]) a = a - res[type] < 0 ? 0 : a - res[type];
  if (weak[type]) a += weak[type];
  if (ch->is_enemy && (ENEMY_DEFS[ch->template_id].immune & (1u << type))) a = 0;

  was_up = ch->hp > 0;
  from_temp = ch->temp_hp < a ? ch->temp_hp : a;
  ch->temp_hp = (int16_t)(ch->temp_hp - from_temp);
  a -= from_temp;
  ch->hp = (int16_t)(ch->hp - a < 0 ? 0 : ch->hp - a);

  if (ch->hp <= 0) {
    if (ch->is_enemy) {
      ch->cond[COND_DEAD] = 1;
      o.downed = was_up;
      o.dead = 1;
    } else if (was_up) {
      int d = 1 + ch->cond[COND_WOUNDED] + (crit ? 1 : 0);
      o.downed = 1;
      ch->cond[COND_DYING] = (int8_t)(d > DYING_MAX ? DYING_MAX : d);
      ch->cond[COND_UNCONSCIOUS] = 1;
      ch->cond[COND_PRONE] = 1;
      ch->cond[COND_RAISED_SHIELD] = 0;
      ch->cond[COND_IN_COVER] = 0;
      if (ch->cond[COND_DYING] >= DYING_MAX) {
        kill_char(ch);
        o.dead = 1;
      }
    } else if (a > 0 && ch->cond[COND_DYING]) {
      int d = ch->cond[COND_DYING] + (crit ? 2 : 1);
      ch->cond[COND_DYING] = (int8_t)(d > DYING_MAX ? DYING_MAX : d);
      if (ch->cond[COND_DYING] >= DYING_MAX) {
        kill_char(ch);
        o.dead = 1;
      }
    }
  }
  o.dealt = a + from_temp;
  return o;
}

int heal(Character *ch, int amount) {
  int n, before;
  if (is_dead(ch)) return 0;
  n = amount < 0 ? 0 : amount;
  before = ch->hp;
  if (ch->hp <= 0 && n > 0) {
    if (ch->cond[COND_DYING]) ch->cond[COND_WOUNDED] = (int8_t)(ch->cond[COND_WOUNDED] + 1 > 3 ? 3 : ch->cond[COND_WOUNDED] + 1);
    ch->cond[COND_DYING] = 0;
    ch->cond[COND_UNCONSCIOUS] = 0;
  }
  ch->hp = (int16_t)(ch->hp + n > ch->max_hp ? ch->max_hp : ch->hp + n);
  return ch->hp - before;
}

void grant_temp_hp(Character *ch, int n) {
  if (ch->temp_hp < n) ch->temp_hp = (int16_t)n;
}

void recovery_check(Character *ch, Rng *r, RecoveryResult *out) {
  int dying = ch->cond[COND_DYING], nd = dying;
  flat_check(r, 10 + dying, &out->c);
  out->before = dying;
  out->dead = out->stable = 0;
  if (out->c.degree == 3) nd -= 2;
  else if (out->c.degree == 2) nd -= 1;
  else if (out->c.degree == 0) nd += 2;
  else nd += 1;
  if (nd >= DYING_MAX) {
    kill_char(ch);
    out->dead = 1;
  } else if (nd <= 0) {
    ch->cond[COND_DYING] = 0;
    ch->cond[COND_WOUNDED] = (int8_t)(ch->cond[COND_WOUNDED] + 1 > 3 ? 3 : ch->cond[COND_WOUNDED] + 1);
    out->stable = 1;
  } else {
    ch->cond[COND_DYING] = (int8_t)nd;
  }
}

/* ================================================================ tura (turn.ts) */
void check_by(const Character *ch, int mod, int dc, Rng *r, int extra_halves, CheckResult *out) {
  check(r, mod, dc, die_halves(ch) + extra_halves, out);
}
void skill_check(const Character *ch, int stat_key, int dc, Rng *r, CheckResult *out) {
  check_by(ch, get_stat(ch, stat_key, 0), dc, r, 0, out);
}

void start_turn(Character *ch, Rng *r, int *actions, ActionResult *ev) {
  int i, a;
  *actions = 0;
  if (is_dead(ch)) return;
  if (ch->cond[COND_DYING]) {
    RecoveryResult rr;
    RuleEvent *e;
    recovery_check(ch, r, &rr);
    e = result_event(ev, EV_RECOVERY, ch);
    e->degree = rr.c.degree;
    return;
  }
  for (i = 0; i < PERSISTENT_COUNT; i++) {
    uint8_t pid = PERSISTENT_CONDS[i];
    int total;
    DamageOutcome o;
    RuleEvent *e;
    CheckResult fc;
    if (!ch->cond[pid] || is_dead(ch)) continue;
    total = roll(r, ch->cond_dice[pid], 0, NULL);
    o = apply_damage(ch, total, CONDITION_DEFS[pid].dmg_type, 0);
    e = result_event(ev, EV_DAMAGE, ch);
    e->amount = (int16_t)o.dealt;
    e->dmg_type = CONDITION_DEFS[pid].dmg_type;
    e->persistent = pid;
    if (o.dead || o.downed) result_event(ev, o.dead ? EV_DEATH : EV_DOWN, ch);
    if (!is_dead(ch)) {
      flat_check(r, PERSISTENT_END_DC, &fc);
      if (fc.degree >= 2) remove_condition(ch, pid);
    }
  }
  if (is_dead(ch)) return;
  ch->cond[COND_RAISED_SHIELD] = 0;
  ch->cond[COND_DODGING] = 0;
  if (ch->hp <= 0 || ch->cond[COND_UNCONSCIOUS]) return;
  a = ACTIONS_PER_TURN;
  if (ch->cond[COND_QUICKENED]) a += 1;
  if (ch->cond[COND_STUNNED]) {
    a -= ch->cond[COND_STUNNED];
    ch->cond[COND_STUNNED] = 0;
  }
  if (ch->cond[COND_SLOWED]) {
    a -= ch->cond[COND_SLOWED];
    ch->cond[COND_SLOWED] = 0;
  }
  *actions = a < 0 ? 0 : a;
}

void end_turn(Character *ch, ActionResult *ev) {
  int i;
  (void)ev;
  if (is_dead(ch)) return;
  for (i = 0; i < COND_COUNT; i++) {
    const ConditionDef *m = &CONDITION_DEFS[i];
    if (!ch->cond[i] || (m->kind != CKIND_DECAY && m->kind != CKIND_TIMED)) continue;
    if (ch->cond[i] - 1 > 0) ch->cond[i]--;
    else remove_condition(ch, (uint8_t)i);
  }
}

InitiativeRoll roll_initiative(const Character *ch, Rng *r) {
  InitiativeRoll ir;
  ir.mod = get_stat(ch, STAT_PERCEPTION, 0);
  ir.d20 = halve_die(die(r, 20), die_halves(ch));
  ir.total = ir.d20 + ir.mod;
  return ir;
}

/* ================================================================ atak (strike.ts) */
void strike_options_default(StrikeOptions *o) {
  memset(o, 0, sizeof *o);
  o->hit_halves = -1;
}

static void dmg_die(Rng *r, int sides, int halves, DieRoll *list, uint8_t *n, int cap, int *sum) {
  int v = halve_die(die(r, sides), halves);
  if (*n < cap) {
    list[*n].sides = (uint8_t)sides;
    list[*n].value = (uint8_t)v;
    (*n)++;
  }
  *sum += v;
}

void strike(Character *att, Character *def, const StrikeOptions *o, Rng *r, ActionResult *res) {
  NormWeapon w;
  NormWeapon list[2];
  int bonus, dc, crit, dice, sides, flat, sneak = 0, total = 0, sum = 0, i, sn, dmg_halves, halves;
  CheckResult c;
  DamageOutcome out;
  RuleEvent *e;
  DamageRoll *dr = &res->dmg;

  res->attack = 1;
  if (o->weapon) w = *o->weapon;
  else {
    get_weapons(att, list);
    w = list[0];
  }
  bonus = get_attack_bonus(att, &w, o->map_index, o->range_increments) + o->bonus;
  dc = get_stat(def, STAT_AC, o->ignore_cover || w.range == 0);
  halves = o->hit_halves >= 0 ? o->hit_halves : attack_halves(att, def);
  check(r, bonus, dc, halves, &c);
  res->d20 = c;
  res->has_d20 = 1;
  res->weapon = w;
  res->has_weapon = 1;
  if (c.degree <= 1) {
    e = result_event(res, EV_MISS, def);
    e->degree = c.degree;
    return;
  }
  crit = c.degree == 3;
  dice = w.dmg.n + o->extra_dice;
  sides = crit && w.fatal ? w.fatal : w.dmg.sides;
  dmg_halves = die_halves(att);
  memset(dr, 0, sizeof *dr);
  for (i = 0; i < dice; i++) dmg_die(r, sides, dmg_halves, dr->dice, &dr->n, ROLL_MAX_DICE, &sum);

  flat = w.dmg.mod + o->damage_bonus;
  if (!att->is_enemy && (w.range == 0 || (w.traits & WT_THROWN))) flat += attr_mod(att, ATTR_STR);
  if (att->cond[COND_RAGING] && w.range == 0) flat += 2 + att->level / 5;
  if (att->cond[COND_TUNED]) flat += 2;
  if (att->class_id == CLASS_SCOUT && def->cond[COND_HUNTED]) flat += 2 + att->level / 4;

  sn = att->class_id == CLASS_SCAVENGER ? (att->level + 1) / 2 : 0;
  if (sn && (is_off_guard(def) || o->sneak))
    for (i = 0; i < sn; i++) dmg_die(r, 6, dmg_halves, dr->dice, &dr->n, ROLL_MAX_DICE, &sneak);

  total = sum + flat + sneak;
  if (crit) {
    total *= 2;
    if (w.fatal) dmg_die(r, w.fatal, dmg_halves, dr->post, &dr->n_post, 4, &total);
    else if (w.deadly) {
      int k = dice >= 3 ? 2 : 1;
      for (i = 0; i < k; i++) dmg_die(r, w.deadly, dmg_halves, dr->post, &dr->n_post, 4, &total);
    }
  }
  if (total < 1) total = 1;
  dr->flat = (int16_t)flat;
  dr->mult2 = crit ? 4 : 2;
  dr->total = (int16_t)total;
  res->has_dmg = 1;

  out = apply_damage(def, total, w.type, crit);
  e = result_event(res, EV_DAMAGE, def);
  e->amount = (int16_t)out.dealt;
  e->degree = c.degree;
  e->dmg_type = w.type;
  if (crit) {
    e = result_event(res, EV_CRIT, def);
    e->degree = 3;
  }
  if (out.dead) result_event(res, EV_DEATH, def);
  else if (out.downed) result_event(res, EV_DOWN, def);
  res->hit = 1;
  res->dealt = (int16_t)out.dealt;
}

/* ================================================================ ekwipunek (equipment.ts) */
void add_to_stack(ItemInst *list, uint8_t *n, int cap, ItemInst inst) {
  uint8_t t = inst.id < ITEM_COUNT ? ITEM_DEFS[inst.id].type : ITYPE_JUNK;
  int i;
  if (t == ITYPE_CONSUMABLE || t == ITYPE_AMMO) {
    for (i = 0; i < *n; i++) {
      if (list[i].id == inst.id) {
        list[i].qty = (uint8_t)((list[i].qty ? list[i].qty : 1) + (inst.qty ? inst.qty : 1));
        return;
      }
    }
  }
  if (*n < cap) list[(*n)++] = inst;
}

int is_two_handed(uint8_t item) { return item < ITEM_COUNT && ITEM_DEFS[item].weapon && ITEM_DEFS[item].weapon->hands == 2; }

static void list_remove(ItemInst *list, uint8_t *n, int index) {
  int i;
  for (i = index; i + 1 < *n; i++) list[i] = list[i + 1];
  (*n)--;
}

static const uint8_t SLOT_TYPE[SLOT_COUNT] = {ITYPE_WEAPON, ITYPE_WEAPON, ITYPE_ARMOR, ITYPE_SHIELD};

int equip_item(Character *ch, int slot, ItemInst *from, uint8_t *n_from, int idx, ItemInst *stash, uint8_t *n_stash, int cap) {
  ItemInst inst = from[idx], removed[2];
  int nr = 0, i;
  if (inst.id >= ITEM_COUNT || ITEM_DEFS[inst.id].type != SLOT_TYPE[slot]) return 0;
  if (slot == SLOT_SHIELD && is_two_handed(ch->equip[SLOT_WEAPON].id)) return 0;
  list_remove(from, n_from, idx);
  if (ch->equip[slot].id != ITEM_NONE) removed[nr++] = ch->equip[slot];
  ch->equip[slot] = inst;
  if (slot == SLOT_WEAPON && is_two_handed(inst.id) && ch->equip[SLOT_SHIELD].id != ITEM_NONE) {
    removed[nr++] = ch->equip[SLOT_SHIELD];
    ch->equip[SLOT_SHIELD].id = ITEM_NONE;
    ch->equip[SLOT_SHIELD].qty = 0;
  }
  for (i = 0; i < nr; i++) add_to_stack(stash, n_stash, cap, removed[i]);
  return 1;
}

int unequip_item(Character *ch, int slot, ItemInst *stash, uint8_t *n_stash, int cap) {
  if (ch->equip[slot].id == ITEM_NONE) return 0;
  add_to_stack(stash, n_stash, cap, ch->equip[slot]);
  ch->equip[slot].id = ITEM_NONE;
  ch->equip[slot].qty = 0;
  return 1;
}

int swap_weapons(Character *ch) {
  ItemInst t;
  if (ch->equip[SLOT_WEAPON2].id == ITEM_NONE) return 0;
  t = ch->equip[SLOT_WEAPON];
  ch->equip[SLOT_WEAPON] = ch->equip[SLOT_WEAPON2];
  ch->equip[SLOT_WEAPON2] = t;
  return 1;
}

void move_item(ItemInst *from, uint8_t *n_from, int index, ItemInst *to, uint8_t *n_to, int cap, int all) {
  ItemInst inst;
  if (index < 0 || index >= *n_from) return;
  inst = from[index];
  if (!all && inst.qty > 1) {
    ItemInst one;
    from[index].qty--;
    one.id = inst.id;
    one.qty = 1;
    add_to_stack(to, n_to, cap, one);
    return;
  }
  list_remove(from, n_from, index);
  add_to_stack(to, n_to, cap, inst);
}

/* ================================================================ zamki i hakowanie (locks.ts) */
void lock_state(LockState *l, uint8_t q) {
  l->dc = LOCK_DEFS[q].dc;
  l->needed = LOCK_DEFS[q].successes;
  l->progress = 0;
  l->jammed = 0;
  l->force_penalty = 0;
}

void device_state(LockState *l, uint8_t k, int mission_level) {
  l->dc = (uint8_t)dc_for_level(mission_level + DEVICE_DEFS[k].level_offset);
  l->needed = DEVICE_DEFS[k].successes;
  l->progress = 0;
  l->jammed = 0;
  l->force_penalty = 0;
}

uint8_t lock_for_level(int level, Rng *r) {
  uint8_t ok[LOCK_COUNT];
  int n = 0, i, top0;
  for (i = 0; i < LOCK_COUNT; i++) if (LOCK_DEFS[i].level <= level + 1) ok[n++] = (uint8_t)i;
  top0 = n > 2 ? n - 2 : 0;
  if (n - top0 <= 0) return LOCK_POOR;
  return ok[top0 + (int)rng_below(r, (uint32_t)(n - top0))];
}

int has_lockpick(const Character *ch) {
  int i;
  for (i = 0; i < ch->n_inv; i++) if (ch->inv[i].id == ITEM_LOCKPICK && ch->inv[i].qty > 0) return 1;
  return 0;
}

static void break_lockpick(Character *ch) {
  int i;
  for (i = 0; i < ch->n_inv; i++) {
    if (ch->inv[i].id == ITEM_LOCKPICK && ch->inv[i].qty > 0) {
      if (--ch->inv[i].qty == 0) list_remove(ch->inv, &ch->n_inv, i);
      return;
    }
  }
}

void pick_lock(Character *ch, LockState *lock, uint8_t skill, Rng *r, LockAttempt *out) {
  memset(out, 0, sizeof *out);
  out->skill = skill;
  if (skill == SKILL_ATHLETICS) {
    int dc = lock->dc + 5;
    int mod = get_stat(ch, SKILL_ATHLETICS, 0) + IMPROVISED_PENALTY + lock->force_penalty;
    check_by(ch, mod, dc, r, 0, &out->roll);
    out->improvised = 1;
    if (out->roll.degree >= 2) {
      lock->progress = lock->needed;
      out->opened = 1;
      out->broken = out->roll.degree == 2;
      out->gained = lock->needed;
    } else if (out->roll.degree == 0) {
      lock->force_penalty = (int8_t)(lock->force_penalty - 2);
      out->jammed = 1;
    }
    return;
  }
  out->improvised = !has_lockpick(ch);
  check_by(ch, get_stat(ch, skill, 0) + (out->improvised ? IMPROVISED_PENALTY : 0), lock->dc, r, 0, &out->roll);
  out->gained = out->roll.degree == 3 ? 2 : out->roll.degree == 2 ? 1 : 0;
  lock->progress = (uint8_t)(lock->progress + out->gained > lock->needed ? lock->needed : lock->progress + out->gained);
  out->opened = lock->progress >= lock->needed;
  if (out->roll.degree == 0 && !out->improvised) {
    break_lockpick(ch);
    out->broke_tool = 1;
  }
}

void hack_device(Character *ch, LockState *dev, uint8_t skill, Rng *r, LockAttempt *out) {
  memset(out, 0, sizeof *out);
  out->skill = skill;
  check_by(ch, get_stat(ch, skill, 0), dev->dc, r, 0, &out->roll);
  out->gained = out->roll.degree == 3 ? 2 : out->roll.degree == 2 ? 1 : 0;
  dev->progress = (uint8_t)(dev->progress + out->gained > dev->needed ? dev->needed : dev->progress + out->gained);
  out->opened = dev->progress >= dev->needed;
  if (out->roll.degree == 0) {
    dev->jammed = 1;
    out->jammed = 1;
    out->alarm = 1;
  }
}
