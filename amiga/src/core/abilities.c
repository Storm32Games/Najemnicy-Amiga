/* Efekty zdolności i przedmiotów jednorazowych. Port src/core/rules/abilities.ts i consumables.ts. */
#include <string.h>
#include "rules.h"

typedef void (*AbilityFn)(AbilityContext *ctx, ActionResult *res);

static Dice mk(int n, int sides, int mod) {
  Dice d;
  d.n = (uint8_t)n;
  d.sides = (uint8_t)sides;
  d.mod = (int8_t)mod;
  return d;
}

int is_machine(const Character *t) {
  if (t->is_enemy) return t->template_id != ENEMY_NONE && (ENEMY_DEFS[t->template_id].traits & ET_MACHINE);
  return (ANCESTRY_DEFS[t->ancestry].traits & AT_MACHINE) != 0;
}

static void spend(Character *u, uint8_t id) {
  if (u->uses[id] != USES_UNSET && u->uses[id] > 0) u->uses[id]--;
}

static Character *first(AbilityContext *ctx) { return ctx->n_targets ? ctx->targets[0] : NULL; }
static int alive(const Character *t) { return t->hp > 0; }

/* DC z obrony celu: 10 + statystyka. */
static int dc_of(const Character *t, int key) { return 10 + get_stat(t, key, 0); }

/* Strike z parametrami kontekstu (PWA, pierwsza broń). */
static void ctx_strike(AbilityContext *ctx, Character *t, StrikeOptions *o, ActionResult *res) {
  o->map_index = ctx->map_index;
  strike(ctx->user, t, o, ctx->rng, res);
}

/* Łączy wynik pod-akcji (ataku) z wynikiem zdolności: zdarzenia i pierwszy k20. */
static void merge(ActionResult *res, const ActionResult *r) {
  int i;
  for (i = 0; i < r->n_events && res->n_events < RESULT_EVENTS_MAX; i++) res->events[res->n_events++] = r->events[i];
  if (r->has_d20 && !res->has_d20) {
    res->d20 = r->d20;
    res->has_d20 = 1;
  }
}

static int same_value(const Character *t, uint8_t id, int v0, Dice d0) {
  return t->cond[id] == v0 && t->cond_dice[id].n == d0.n && t->cond_dice[id].sides == d0.sides && t->cond_dice[id].mod == d0.mod;
}

/* cond(): nakłada stan; zdarzenie tylko, gdy wartość się zmieniła. */
void cond_ev(ActionResult *res, Character *t, uint8_t id, int value) {
  int v0 = t->cond[id];
  Dice d0 = t->cond_dice[id];
  add_condition(t, id, value);
  if (t->cond[id] && !same_value(t, id, v0, d0)) {
    RuleEvent *e = result_event(res, EV_CONDITION, t);
    e->cond = id;
    e->has_value = 1;
    e->value = t->cond[id];
    e->value_dice = t->cond_dice[id];
  }
}
void cond_ev_dice(ActionResult *res, Character *t, uint8_t id, Dice d) {
  int v0 = t->cond[id];
  Dice d0 = t->cond_dice[id];
  add_condition_dice(t, id, d);
  if (t->cond[id] && !same_value(t, id, v0, d0)) {
    RuleEvent *e = result_event(res, EV_CONDITION, t);
    e->cond = id;
    e->has_value = 1;
    e->value = t->cond[id];
    e->value_dice = t->cond_dice[id];
  }
}
/* quietCond(): zawsze zdarzenie (bez wartości). */
static void quiet(ActionResult *res, Character *t, uint8_t id, int value) {
  add_condition(t, id, value);
  result_event(res, EV_CONDITION, t)->cond = id;
}
static void quiet_dice(ActionResult *res, Character *t, uint8_t id, Dice d) {
  add_condition_dice(t, id, d);
  result_event(res, EV_CONDITION, t)->cond = id;
}

static DamageOutcome hurt(ActionResult *res, Character *t, int amount, uint8_t type, int crit) {
  DamageOutcome a = apply_damage(t, amount, type, crit);
  RuleEvent *e = result_event(res, EV_DAMAGE, t);
  e->amount = (int16_t)a.dealt;
  e->dmg_type = type;
  if (a.dead) result_event(res, EV_DEATH, t);
  else if (a.downed) result_event(res, EV_DOWN, t);
  return a;
}

static int do_heal(ActionResult *res, Character *t, int amount) {
  int n = heal(t, amount);
  result_event(res, EV_HEAL, t)->amount = (int16_t)n;
  return n;
}

static void copy_roll(DamageRoll *dr, const RollResult *rr, int flat, int mult2, int total) {
  int i;
  memset(dr, 0, sizeof *dr);
  for (i = 0; i < rr->n && i < ROLL_MAX_DICE; i++) dr->dice[i] = rr->dice[i];
  dr->n = rr->n;
  dr->flat = (int16_t)flat;
  dr->mult2 = (uint8_t)mult2;
  dr->total = (int16_t)total;
}

/* Rzut leczenia: suma + zapis kości (pierwszy rzut w akcji). */
static int heal_roll(ActionResult *res, Dice expr, Rng *r, int extra, const Character *by) {
  RollResult rr;
  int total = roll(r, expr, by ? die_halves(by) : 0, &rr) + extra;
  if (!res->has_heal) {
    copy_roll(&res->heal, &rr, rr.mod + extra, 2, total);
    res->has_heal = 1;
  }
  return total;
}

static void temp_hp(ActionResult *res, Character *t, int n) {
  RuleEvent *e;
  grant_temp_hp(t, n);
  e = result_event(res, EV_HEAL, t);
  e->amount = (int16_t)n;
  e->temp = 1;
}

static const uint8_t SAVE_STAT[3] = {STAT_FORT, STAT_REF, STAT_WILL};

void basic_save(ActionResult *res, Character *t, uint8_t save, int dc, Dice expr, uint8_t type, Rng *r, const Character *by, CheckResult *c_out) {
  CheckResult c;
  RollResult rr;
  int total, amt;
  static const uint8_t MULT2[4] = {4, 2, 1, 0}; /* [stopień] */
  check_by(t, get_stat(t, SAVE_STAT[save], 0), dc, r, 0, &c);
  if (!res->has_d20) {
    res->d20 = c;
    res->has_d20 = 1;
  }
  total = roll(r, expr, by ? die_halves(by) : 0, &rr);
  amt = c.degree == 3 ? 0 : c.degree == 2 ? (total >= 0 ? total / 2 : -((-total + 1) / 2)) : c.degree == 1 ? total : total * 2;
  if (!res->has_dmg) {
    copy_roll(&res->dmg, &rr, rr.mod, MULT2[c.degree], amt < 0 ? 0 : amt);
    res->has_dmg = 1;
  }
  if (amt > 0) hurt(res, t, amt, type, c.degree == 0);
  else result_event(res, EV_MISS, t)->degree = c.degree;
  if (c_out) *c_out = c;
}

/* Prosty atak z własną premią (dron). */
static int simple_attack(ActionResult *res, Character *t, int bonus, Dice expr, uint8_t type, Rng *r) {
  int dc = get_stat(t, STAT_AC, 0), tot;
  CheckResult c;
  RollResult rr;
  check(r, bonus, dc, conceal_halves(t), &c);
  if (!res->has_d20) {
    res->d20 = c;
    res->has_d20 = 1;
  }
  if (c.degree <= 1) {
    result_event(res, EV_MISS, t)->degree = c.degree;
    return 0;
  }
  tot = roll(r, expr, 0, &rr);
  if (c.degree == 3) tot *= 2;
  if (!res->has_dmg) {
    copy_roll(&res->dmg, &rr, rr.mod, c.degree == 3 ? 4 : 2, tot);
    res->has_dmg = 1;
  }
  hurt(res, t, tot, type, c.degree == 3);
  return 1;
}

static int wis_bonus(const Character *u) { int w = attr_mod(u, ATTR_WIS); return w > 0 ? w : 0; }
static int con_bonus(const Character *u) { int w = attr_mod(u, ATTR_CON); return w > 0 ? w : 0; }

/* ================================================================ uniwersalne */
static void ab_strike(AbilityContext *ctx, ActionResult *res) {
  StrikeOptions o;
  Character *t = first(ctx);
  if (!t) return;
  strike_options_default(&o);
  o.bonus = ctx->bonus;
  o.damage_bonus = ctx->damage_bonus;
  ctx_strike(ctx, t, &o, res);
}
static void ab_raise_shield(AbilityContext *ctx, ActionResult *res) {
  Character *u = ctx->user;
  if (!shield_of(u)) return;
  cond_ev(res, u, COND_RAISED_SHIELD, 1);
}
static void ab_take_cover(AbilityContext *ctx, ActionResult *res) {
  Character *u = ctx->user;
  int lvl = u->cond[COND_IN_COVER] >= 1 ? 2 : 1;
  RuleEvent *e;
  u->cond[COND_IN_COVER] = (int8_t)lvl;
  e = result_event(res, EV_CONDITION, u);
  e->cond = COND_IN_COVER;
  e->has_value = 1;
  e->value = (int8_t)lvl;
}
static void ab_demoralize(AbilityContext *ctx, ActionResult *res) {
  Character *t = first(ctx), *u = ctx->user;
  CheckResult c;
  int dc;
  if (!t || t->cond[COND_DEM_IMM]) return;
  dc = dc_of(t, STAT_WILL);
  check_by(u, get_stat(u, SKILL_INTIMIDATION, 0), dc, ctx->rng, 0, &c);
  res->d20 = c;
  res->has_d20 = 1;
  add_condition(t, COND_DEM_IMM, 4);
  if (c.degree >= 2) cond_ev(res, t, COND_FRIGHTENED, c.degree == 3 ? 2 : 1);
}
static void ab_first_aid(AbilityContext *ctx, ActionResult *res) {
  Character *u = ctx->user, *t = first(ctx) ? first(ctx) : ctx->user;
  int dying, dc;
  CheckResult c;
  if (is_dead(t)) return;
  dying = t->cond[COND_DYING];
  dc = dying ? 15 + dying : t->cond[COND_BLEEDING] ? 15 : dc_for_level(u->level);
  check_by(u, get_stat(u, SKILL_MEDICINE, 0), dc, ctx->rng, 0, &c);
  res->d20 = c;
  res->has_d20 = 1;
  if (c.degree <= 1) {
    if (c.degree == 0 && dying) t->cond[COND_DYING] = (int8_t)(dying + 1 > 3 ? 3 : dying + 1);
    return;
  }
  if (dying) {
    t->cond[COND_DYING] = 0;
    t->cond[COND_WOUNDED] = (int8_t)(t->cond[COND_WOUNDED] + 1 > 3 ? 3 : t->cond[COND_WOUNDED] + 1);
    result_event(res, EV_CONDITION, t)->cond = COND_STABLE;
    if (c.degree == 3) do_heal(res, t, heal_roll(res, mk(1, 6, 0), ctx->rng, 0, u));
    return;
  }
  if (t->cond[COND_BLEEDING]) {
    remove_condition(t, COND_BLEEDING);
    return;
  }
  do_heal(res, t, heal_roll(res, c.degree == 3 ? mk(2, 6, 0) : mk(1, 6, 0), ctx->rng, 1, u));
}
static void ab_stand(AbilityContext *ctx, ActionResult *res) {
  Character *u = ctx->user;
  (void)res;
  if (u->hp > 0 && u->cond[COND_PRONE]) remove_condition(u, COND_PRONE);
}

/* ================================================================ Żołnierz */
static void ab_suppressive_fire(AbilityContext *ctx, ActionResult *res) {
  Character *u = ctx->user;
  NormWeapon w[2];
  int dc, i;
  Dice dmg;
  res->attack = 1;
  if (!ctx->n_targets) return;
  get_weapons(u, w);
  if (w[0].range <= 0) {
    res->attack = 0;
    return;
  }
  spend(u, ABIL_SUPPRESSIVE_FIRE);
  dc = get_stat(u, STAT_CLASS_DC, 0);
  dmg = w[0].dmg;
  dmg.mod = 0; /* obrażenia broni bez stałej */
  for (i = 0; i < ctx->n_targets; i++) {
    Character *t = ctx->targets[i];
    CheckResult c;
    RollResult rr;
    int amt;
    check_by(t, get_stat(t, STAT_REF, 0), dc, ctx->rng, 0, &c);
    if (!res->has_d20) {
      res->d20 = c;
      res->has_d20 = 1;
    }
    if (c.degree == 3) continue;
    amt = roll(ctx->rng, dmg, die_halves(u), &rr);
    if (c.degree == 2) amt = amt / 2;
    if (c.degree == 0) amt *= 2;
    if (!res->has_dmg) {
      copy_roll(&res->dmg, &rr, rr.mod, c.degree == 2 ? 1 : c.degree == 0 ? 4 : 2, amt);
      res->has_dmg = 1;
    }
    hurt(res, t, amt, w[0].type, c.degree == 0);
    if (c.degree <= 1) cond_ev(res, t, COND_DISTRACTED, 2);
    if (c.degree == 0) cond_ev(res, t, COND_FRIGHTENED, 1);
  }
}
static void ab_double_strike(AbilityContext *ctx, ActionResult *res) {
  Character *t = first(ctx);
  int i;
  if (!t) return;
  res->attack = 1;
  res->attacks = 2;
  for (i = 0; i < 2; i++) {
    if (!is_dead(t) && alive(t)) {
      ActionResult sub;
      StrikeOptions o;
      result_clear(&sub);
      strike_options_default(&o);
      ctx_strike(ctx, t, &o, &sub);
      merge(res, &sub);
    }
  }
}
static void ab_charge(AbilityContext *ctx, ActionResult *res) {
  Character *t = first(ctx);
  StrikeOptions o;
  if (!t) return;
  strike_options_default(&o);
  o.bonus = 1;
  o.damage_bonus = 2;
  ctx_strike(ctx, t, &o, res);
}
static void ab_rally(AbilityContext *ctx, ActionResult *res) {
  Character *u = ctx->user;
  int n = 4 + u->level * 2, i;
  spend(u, ABIL_RALLY);
  if (!ctx->n_targets) {
    remove_condition(u, COND_FRIGHTENED);
    temp_hp(res, u, n);
    return;
  }
  for (i = 0; i < ctx->n_targets; i++) {
    remove_condition(ctx->targets[i], COND_FRIGHTENED);
    temp_hp(res, ctx->targets[i], n);
  }
}

/* ================================================================ Zwiadowca */
static void ab_mark_target(AbilityContext *ctx, ActionResult *res) {
  Character *t = first(ctx);
  if (t) quiet(res, t, COND_HUNTED, 5);
}
static void ab_precise_shot(AbilityContext *ctx, ActionResult *res) {
  Character *t = first(ctx);
  StrikeOptions o;
  if (!t) return;
  strike_options_default(&o);
  o.bonus = 2;
  o.extra_dice = 1;
  o.ignore_cover = 1;
  ctx_strike(ctx, t, &o, res);
}
static void ab_crippling_shot(AbilityContext *ctx, ActionResult *res) {
  Character *t = first(ctx), *u = ctx->user;
  StrikeOptions o;
  if (!t) return;
  strike_options_default(&o);
  ctx_strike(ctx, t, &o, res);
  if (res->hit && alive(t)) {
    CheckResult c;
    check_by(t, get_stat(t, STAT_FORT, 0), get_stat(u, STAT_CLASS_DC, 0), ctx->rng, 0, &c);
    if (c.degree <= 1) cond_ev(res, t, COND_SLOWED, c.degree == 0 ? 2 : 1);
  }
}
static void ab_volley(AbilityContext *ctx, ActionResult *res) {
  Character *t = first(ctx);
  int i;
  if (!t) return;
  res->attack = 1;
  res->attacks = 2;
  spend(ctx->user, ABIL_VOLLEY);
  for (i = 0; i < 2; i++) {
    if (alive(t)) {
      ActionResult sub;
      StrikeOptions o;
      result_clear(&sub);
      strike_options_default(&o);
      o.bonus = 1;
      ctx_strike(ctx, t, &o, &sub);
      merge(res, &sub);
    }
  }
}

/* ================================================================ Medyk */
static void ab_field_dressing(AbilityContext *ctx, ActionResult *res) {
  Character *u = ctx->user, *t = first(ctx) ? first(ctx) : ctx->user;
  int dc, bonus;
  CheckResult c;
  if (is_dead(t)) return;
  spend(u, ABIL_FIELD_DRESSING);
  dc = dc_for_level(u->level);
  check_by(u, get_stat(u, SKILL_MEDICINE, 0), dc, ctx->rng, 0, &c);
  res->d20 = c;
  res->has_d20 = 1;
  bonus = wis_bonus(u) + u->level;
  if (c.degree == 3) {
    do_heal(res, t, heal_roll(res, mk(4, 6, bonus), ctx->rng, 0, u));
    remove_condition(t, COND_BLEEDING);
    remove_condition(t, COND_POISONED);
  } else if (c.degree == 2) {
    do_heal(res, t, heal_roll(res, mk(2, 6, bonus), ctx->rng, 0, u));
    remove_condition(t, COND_BLEEDING);
  } else if (c.degree == 1) {
    do_heal(res, t, heal_roll(res, mk(1, 4, 0), ctx->rng, 0, u));
  }
}
static void ab_stimulant(AbilityContext *ctx, ActionResult *res) {
  Character *u = ctx->user, *t = first(ctx) ? first(ctx) : ctx->user;
  spend(u, ABIL_STIMULANT);
  if (is_dead(t)) return;
  temp_hp(res, t, 4 + 2 * u->level);
  quiet(res, t, COND_STIMMED, 5);
}
static void ab_adrenaline(AbilityContext *ctx, ActionResult *res) {
  Character *u = ctx->user, *t = first(ctx) ? first(ctx) : ctx->user;
  if (is_dead(t)) return;
  spend(u, ABIL_ADRENALINE);
  if (t->hp <= 0) {
    do_heal(res, t, heal_roll(res, mk(1, 8, 0), ctx->rng, wis_bonus(u) + u->level, u));
    remove_condition(t, COND_PRONE);
  } else {
    quiet(res, t, COND_QUICKENED, 1);
  }
}
static void ab_field_clinic(AbilityContext *ctx, ActionResult *res) {
  Character *u = ctx->user;
  int i, n = ctx->n_targets ? ctx->n_targets : 1;
  spend(u, ABIL_FIELD_CLINIC);
  for (i = 0; i < n; i++) {
    Character *t = ctx->n_targets ? ctx->targets[i] : u;
    if (!is_dead(t)) do_heal(res, t, heal_roll(res, mk(1, 8, 0), ctx->rng, wis_bonus(u) + u->level, u));
  }
}

/* ================================================================ Technik */
static void ab_combat_drone(AbilityContext *ctx, ActionResult *res) {
  Character *t = first(ctx), *u = ctx->user;
  int b, in, i;
  if (!t) return;
  spend(u, ABIL_COMBAT_DRONE);
  b = get_stat(u, STAT_CLASS_DC, 0) - 10;
  in = attr_mod(u, ATTR_INT);
  if (in < 0) in = 0;
  for (i = 0; i < 2; i++) if (alive(t)) simple_attack(res, t, b - 5 * i, mk(1, 6, in), DMG_P, ctx->rng);
}
static void ab_emp_grenade(AbilityContext *ctx, ActionResult *res) {
  Character *u = ctx->user;
  int dc, i;
  spend(u, ABIL_EMP_GRENADE);
  if (!ctx->n_targets) return;
  dc = get_stat(u, STAT_CLASS_DC, 0);
  for (i = 0; i < ctx->n_targets; i++) {
    Character *t = ctx->targets[i];
    int mach = is_machine(t);
    CheckResult c;
    basic_save(res, t, SAVE_REFLEX, dc, mach ? mk(2, 6, u->level) : mk(1, 4, 0), DMG_ELEC, ctx->rng, u, &c);
    if (mach && c.degree <= 1 && alive(t)) cond_ev(res, t, COND_STUNNED, c.degree == 0 ? 2 : 1);
  }
}
static void ab_repair_armor(AbilityContext *ctx, ActionResult *res) {
  Character *u = ctx->user, *t = first(ctx) ? first(ctx) : ctx->user;
  int dc, n;
  CheckResult c;
  if (is_dead(t)) return;
  spend(u, ABIL_REPAIR_ARMOR);
  dc = dc_for_level(u->level);
  check_by(u, get_stat(u, SKILL_CRAFTING, 0), dc, ctx->rng, 0, &c);
  res->d20 = c;
  res->has_d20 = 1;
  n = 3 + 2 * u->level;
  if (c.degree >= 2) {
    temp_hp(res, t, c.degree == 3 ? n * 2 : n);
    quiet(res, t, COND_REINFORCED, 4);
  }
}
static void ab_weapon_tune(AbilityContext *ctx, ActionResult *res) {
  Character *u = ctx->user, *t = first(ctx) ? first(ctx) : ctx->user;
  spend(u, ABIL_WEAPON_TUNE);
  quiet(res, t, COND_TUNED, 4);
}

/* ================================================================ Szczur */
static void ab_sneak_attack(AbilityContext *ctx, ActionResult *res) {
  Character *t = first(ctx), *u = ctx->user;
  int sneak;
  ActionResult s;
  StrikeOptions o;
  if (!t) return;
  sneak = u->cond[COND_HIDDEN] != 0;
  if (!sneak) {
    CheckResult c;
    check_by(u, get_stat(u, SKILL_STEALTH, 0), dc_of(t, STAT_PERCEPTION), ctx->rng, 0, &c);
    res->d20 = c;
    res->has_d20 = 1;
    sneak = c.degree >= 2;
  }
  remove_condition(u, COND_HIDDEN);
  result_clear(&s);
  strike_options_default(&o);
  o.sneak = sneak;
  ctx_strike(ctx, t, &o, &s);
  merge(res, &s);
  res->attack = 1;
  res->hit = s.hit;
  if (s.has_d20) {
    res->d20 = s.d20;
    res->has_d20 = 1;
  }
}
static void ab_dodge(AbilityContext *ctx, ActionResult *res) { cond_ev(res, ctx->user, COND_DODGING, 1); }
static void ab_steal(AbilityContext *ctx, ActionResult *res) {
  Character *t = first(ctx), *u = ctx->user;
  CheckResult c;
  if (!t || t->stolen) return;
  check_by(u, get_stat(u, SKILL_THIEVERY, 0), dc_of(t, STAT_PERCEPTION), ctx->rng, 0, &c);
  res->d20 = c;
  res->has_d20 = 1;
  if (c.degree >= 2) {
    uint8_t pool[5];
    int np = 0, i;
    t->stolen = 1;
    if (t->template_id != ENEMY_NONE) {
      const EnemyDef *ed = &ENEMY_DEFS[t->template_id];
      for (i = 0; i < ed->n_loot; i++) if (ITEM_DEFS[ed->loot[i].item].type != ITYPE_AMMO) pool[np++] = ed->loot[i].item;
    }
    if (np) {
      uint8_t id = pool[rng_below(ctx->rng, (uint32_t)np)];
      RuleEvent *e;
      inv_add(u, id, 1);
      e = result_event(res, EV_STEAL, t);
      e->item = id;
    }
    if (c.degree == 3) {
      int sc = 2 + halve_die(die(ctx->rng, 6), die_halves(u));
      u->stolen_scrap = (uint16_t)(u->stolen_scrap + sc);
      result_event(res, EV_SCRAP, NULL)->amount = (int16_t)sc;
    }
  } else if (c.degree == 0) {
    cond_ev(res, u, COND_CLUMSY, 1);
  }
}
static void ab_dirty_trick(AbilityContext *ctx, ActionResult *res) {
  Character *t = first(ctx), *u = ctx->user;
  CheckResult c;
  if (!t) return;
  check_by(t, get_stat(t, STAT_REF, 0), get_stat(u, STAT_CLASS_DC, 0), ctx->rng, 0, &c);
  res->d20 = c;
  res->has_d20 = 1;
  if (c.degree >= 2) return;
  cond_ev(res, t, COND_DISTRACTED, 2);
  cond_ev(res, t, COND_CLUMSY, c.degree == 0 ? 2 : 1);
}

/* ================================================================ Brutal */
static void ab_rage(AbilityContext *ctx, ActionResult *res) {
  Character *u = ctx->user;
  int n, c;
  if (u->cond[COND_RAGING]) return;
  add_condition(u, COND_RAGING, 5);
  c = attr_mod(u, ATTR_CON);
  n = u->level + (c > 0 ? c : 0);
  temp_hp(res, u, n);
  result_event(res, EV_CONDITION, u)->cond = COND_RAGING;
}
static void ab_roar(AbilityContext *ctx, ActionResult *res) {
  Character *u = ctx->user;
  int i;
  spend(u, ABIL_ROAR);
  for (i = 0; i < ctx->n_targets; i++) {
    Character *t = ctx->targets[i];
    CheckResult c;
    check_by(u, get_stat(u, SKILL_INTIMIDATION, 0), dc_of(t, STAT_WILL), ctx->rng, 0, &c);
    if (!res->has_d20) {
      res->d20 = c;
      res->has_d20 = 1;
    }
    if (c.degree >= 2) cond_ev(res, t, COND_FRIGHTENED, c.degree == 3 ? 2 : 1);
  }
}
static void ab_rend(AbilityContext *ctx, ActionResult *res) {
  Character *t = first(ctx);
  StrikeOptions o;
  if (!t) return;
  strike_options_default(&o);
  o.extra_dice = 1;
  ctx_strike(ctx, t, &o, res);
  if (res->hit && alive(t)) quiet_dice(res, t, COND_BLEEDING, res->has_d20 && res->d20.degree == 3 ? mk(2, 6, 0) : mk(1, 6, 0));
}
static void ab_shove(AbilityContext *ctx, ActionResult *res) {
  Character *t = first(ctx), *u = ctx->user;
  CheckResult c;
  if (!t) return;
  check_by(u, get_stat(u, SKILL_ATHLETICS, 0), dc_of(t, STAT_REF), ctx->rng, 0, &c);
  res->d20 = c;
  res->has_d20 = 1;
  if (c.degree >= 2) {
    cond_ev(res, t, COND_PRONE, 1);
    if (c.degree == 3) hurt(res, t, roll(ctx->rng, mk(1, 6, 0), die_halves(u), NULL), DMG_B, 0);
  } else if (c.degree == 0) {
    cond_ev(res, u, COND_PRONE, 1);
  }
}
static void ab_second_wind(AbilityContext *ctx, ActionResult *res) {
  Character *u = ctx->user;
  spend(u, ABIL_SECOND_WIND);
  do_heal(res, u, heal_roll(res, mk(1, 8, 0), ctx->rng, con_bonus(u) + u->level + 4, u));
}

/* ================================================================ wrogowie */
static void enemy_strike(AbilityContext *ctx, Character *t, int attack_index, StrikeOptions *o, ActionResult *res) {
  NormWeapon w;
  Character *u = ctx->user;
  if (u->n_attacks > attack_index) {
    norm_from_attack(&u->attacks[attack_index], &w);
    o->weapon = &w;
  }
  ctx_strike(ctx, t, o, res);
}
static void ab_bite_trip(AbilityContext *ctx, ActionResult *res) {
  Character *t = first(ctx), *u = ctx->user;
  StrikeOptions o;
  if (!t) return;
  strike_options_default(&o);
  enemy_strike(ctx, t, 0, &o, res);
  if (res->hit && alive(t)) {
    CheckResult c;
    check_by(t, get_stat(t, STAT_REF, 0), get_stat(u, STAT_CLASS_DC, 0), ctx->rng, 0, &c);
    if (c.degree <= 1) cond_ev(res, t, COND_PRONE, 1);
  }
}
static void ab_swarm_cloud(AbilityContext *ctx, ActionResult *res) {
  Character *u = ctx->user;
  int i;
  for (i = 0; i < ctx->n_targets; i++) {
    CheckResult c;
    basic_save(res, ctx->targets[i], SAVE_FORTITUDE, get_stat(u, STAT_CLASS_DC, 0), mk(1, 6, 1), DMG_POISON, ctx->rng, u, &c);
    if (c.degree <= 1) cond_ev(res, ctx->targets[i], COND_SICKENED, 1);
  }
}
static void ab_poison_sting(AbilityContext *ctx, ActionResult *res) {
  Character *t = first(ctx), *u = ctx->user;
  StrikeOptions o;
  NormWeapon w;
  EnemyAttack sting;
  if (!t) return;
  memset(&sting, 0, sizeof sting);
  sting.name = "\257\261d\263o"; /* "Żądło" w ISO-8859-2 */
  sting.bonus = (int8_t)(u->n_attacks ? u->attacks[0].bonus : 0);
  sting.damage = mk(1, 6, 3);
  sting.dmg_type = DMG_P;
  sting.sfx = SFX_MELEE;
  norm_from_attack(&sting, &w);
  strike_options_default(&o);
  o.weapon = &w;
  ctx_strike(ctx, t, &o, res);
  if (res->hit && alive(t)) {
    CheckResult c;
    check_by(t, get_stat(t, STAT_FORT, 0), get_stat(u, STAT_CLASS_DC, 0), ctx->rng, 0, &c);
    if (c.degree <= 1) {
      cond_ev_dice(res, t, COND_POISONED, mk(1, 6, 0));
      if (c.degree == 0) cond_ev(res, t, COND_SICKENED, 1);
    }
  }
}
static void ab_quake(AbilityContext *ctx, ActionResult *res) {
  Character *u = ctx->user;
  int i;
  for (i = 0; i < ctx->n_targets; i++) {
    CheckResult c;
    Character *t = ctx->targets[i];
    basic_save(res, t, SAVE_REFLEX, get_stat(u, STAT_CLASS_DC, 0), mk(2, 6, 3), DMG_B, ctx->rng, u, &c);
    if (c.degree <= 1 && alive(t)) cond_ev(res, t, COND_PRONE, 1);
  }
}
static void ab_rad_touch(AbilityContext *ctx, ActionResult *res) {
  Character *t = first(ctx), *u = ctx->user;
  StrikeOptions o;
  if (!t) return;
  strike_options_default(&o);
  enemy_strike(ctx, t, 0, &o, res);
  if (res->hit && alive(t)) {
    CheckResult c;
    check_by(t, get_stat(t, STAT_FORT, 0), get_stat(u, STAT_CLASS_DC, 0), ctx->rng, 0, &c);
    if (c.degree <= 1) cond_ev(res, t, COND_SICKENED, c.degree == 0 ? 2 : 1);
  }
}
static void ab_frenzy(AbilityContext *ctx, ActionResult *res) {
  Character *u = ctx->user;
  if (u->cond[COND_RAGING]) return;
  add_condition(u, COND_RAGING, 5);
  temp_hp(res, u, 5 + u->level);
  result_event(res, EV_CONDITION, u)->cond = COND_RAGING;
}
static void ab_throw_molotov(AbilityContext *ctx, ActionResult *res) {
  Character *u = ctx->user;
  int i;
  spend(u, ABIL_THROW_MOLOTOV);
  for (i = 0; i < ctx->n_targets; i++) {
    CheckResult c;
    Character *t = ctx->targets[i];
    basic_save(res, t, SAVE_REFLEX, 16 + u->level / 2, mk(1, 6, 2), DMG_FIRE, ctx->rng, u, &c);
    if (c.degree <= 1 && alive(t)) cond_ev_dice(res, t, COND_BURNING, mk(1, 4, 0));
  }
}
static void ab_headshot(AbilityContext *ctx, ActionResult *res) {
  Character *t = first(ctx);
  StrikeOptions o;
  if (!t) return;
  strike_options_default(&o);
  o.bonus = 2;
  o.extra_dice = 1;
  o.ignore_cover = 1;
  enemy_strike(ctx, t, 0, &o, res);
}
static void ab_chief_rally(AbilityContext *ctx, ActionResult *res) {
  Character *u = ctx->user;
  int i, n = ctx->n_targets ? ctx->n_targets : 1;
  spend(u, ABIL_CHIEF_RALLY);
  for (i = 0; i < n; i++) {
    Character *t = ctx->n_targets ? ctx->targets[i] : u;
    temp_hp(res, t, 6);
    add_condition(t, COND_STIMMED, 4);
  }
}
static void ab_self_destruct(AbilityContext *ctx, ActionResult *res) {
  Character *u = ctx->user;
  int i;
  for (i = 0; i < ctx->n_targets; i++) basic_save(res, ctx->targets[i], SAVE_REFLEX, 16, mk(2, 8, 0), DMG_P, ctx->rng, u, NULL);
  u->hp = 0;
  u->cond[COND_DEAD] = 1;
  result_event(res, EV_DEATH, u);
}
static void ab_turret_burst(AbilityContext *ctx, ActionResult *res) {
  Character *t = first(ctx);
  int i;
  if (!t) return;
  res->attack = 1;
  res->attacks = 3;
  for (i = 0; i < 3; i++) {
    if (alive(t)) {
      ActionResult sub;
      StrikeOptions o;
      int m = ctx->map_index;
      result_clear(&sub);
      strike_options_default(&o);
      ctx->map_index = m + i;
      enemy_strike(ctx, t, 0, &o, &sub);
      ctx->map_index = m;
      merge(res, &sub);
    }
  }
}
static void ab_rocket_salvo(AbilityContext *ctx, ActionResult *res) {
  Character *u = ctx->user;
  int i;
  spend(u, ABIL_ROCKET_SALVO);
  for (i = 0; i < ctx->n_targets; i++) basic_save(res, ctx->targets[i], SAVE_REFLEX, get_stat(u, STAT_CLASS_DC, 0), mk(3, 6, 4), DMG_B, ctx->rng, u, NULL);
}
static void ab_kostucha_cull(AbilityContext *ctx, ActionResult *res) {
  int i, n = ctx->n_targets < 2 ? ctx->n_targets : 2;
  res->attack = 1;
  if (!n) return;
  res->attacks = (uint8_t)n;
  for (i = 0; i < n; i++) {
    ActionResult sub;
    StrikeOptions o;
    result_clear(&sub);
    strike_options_default(&o);
    enemy_strike(ctx, ctx->targets[i], 0, &o, &sub);
    merge(res, &sub);
  }
}
static void ab_kostucha_barrage(AbilityContext *ctx, ActionResult *res) {
  Character *u = ctx->user;
  int i;
  spend(u, ABIL_KOSTUCHA_BARRAGE);
  for (i = 0; i < ctx->n_targets; i++) {
    CheckResult c;
    Character *t = ctx->targets[i];
    basic_save(res, t, SAVE_REFLEX, 22, mk(3, 6, 2), DMG_P, ctx->rng, u, &c);
    if (c.degree <= 1 && alive(t)) cond_ev(res, t, COND_DISTRACTED, 2);
  }
}
static void ab_kostucha_command(AbilityContext *ctx, ActionResult *res) {
  Character *u = ctx->user;
  int i, k = 0;
  spend(u, ABIL_KOSTUCHA_COMMAND);
  temp_hp(res, u, 15);
  for (i = 0; i < ctx->n_targets && k < 3; i++) {
    Character *t = ctx->targets[i];
    if (t == u) continue;
    add_condition(t, COND_QUICKENED, 1);
    add_condition(t, COND_STIMMED, 3);
    k++;
  }
}

/* Tabela efektów w kolejności AbilityId (gen_headers.ts). */
static const struct { uint8_t id; AbilityFn fn; } EFFECTS[] = {
  {ABIL_STRIKE, ab_strike}, {ABIL_RAISE_SHIELD, ab_raise_shield}, {ABIL_TAKE_COVER, ab_take_cover}, {ABIL_DEMORALIZE, ab_demoralize},
  {ABIL_FIRST_AID, ab_first_aid}, {ABIL_STAND, ab_stand}, {ABIL_SUPPRESSIVE_FIRE, ab_suppressive_fire}, {ABIL_DOUBLE_STRIKE, ab_double_strike},
  {ABIL_CHARGE, ab_charge}, {ABIL_RALLY, ab_rally}, {ABIL_MARK_TARGET, ab_mark_target}, {ABIL_PRECISE_SHOT, ab_precise_shot},
  {ABIL_CRIPPLING_SHOT, ab_crippling_shot}, {ABIL_VOLLEY, ab_volley}, {ABIL_FIELD_DRESSING, ab_field_dressing}, {ABIL_STIMULANT, ab_stimulant},
  {ABIL_ADRENALINE, ab_adrenaline}, {ABIL_FIELD_CLINIC, ab_field_clinic}, {ABIL_COMBAT_DRONE, ab_combat_drone}, {ABIL_EMP_GRENADE, ab_emp_grenade},
  {ABIL_REPAIR_ARMOR, ab_repair_armor}, {ABIL_WEAPON_TUNE, ab_weapon_tune}, {ABIL_SNEAK_ATTACK, ab_sneak_attack}, {ABIL_DODGE, ab_dodge},
  {ABIL_STEAL, ab_steal}, {ABIL_DIRTY_TRICK, ab_dirty_trick}, {ABIL_RAGE, ab_rage}, {ABIL_ROAR, ab_roar}, {ABIL_REND, ab_rend},
  {ABIL_SHOVE, ab_shove}, {ABIL_SECOND_WIND, ab_second_wind}, {ABIL_BITE_TRIP, ab_bite_trip}, {ABIL_SWARM_CLOUD, ab_swarm_cloud},
  {ABIL_POISON_STING, ab_poison_sting}, {ABIL_QUAKE, ab_quake}, {ABIL_RAD_TOUCH, ab_rad_touch}, {ABIL_FRENZY, ab_frenzy},
  {ABIL_THROW_MOLOTOV, ab_throw_molotov}, {ABIL_HEADSHOT, ab_headshot}, {ABIL_CHIEF_RALLY, ab_chief_rally}, {ABIL_SELF_DESTRUCT, ab_self_destruct},
  {ABIL_TURRET_BURST, ab_turret_burst}, {ABIL_ROCKET_SALVO, ab_rocket_salvo}, {ABIL_KOSTUCHA_CULL, ab_kostucha_cull},
  {ABIL_KOSTUCHA_BARRAGE, ab_kostucha_barrage}, {ABIL_KOSTUCHA_COMMAND, ab_kostucha_command},
};
typedef char effects_cover_all_abilities[(sizeof EFFECTS / sizeof EFFECTS[0]) == ABIL_COUNT ? 1 : -1];

static AbilityFn effect_of(uint8_t id) {
  unsigned i;
  for (i = 0; i < sizeof EFFECTS / sizeof EFFECTS[0]; i++) if (EFFECTS[i].id == id) return EFFECTS[i].fn;
  return NULL;
}

int can_use(const Character *u, uint8_t id) {
  int i, known = 0;
  if (id >= ABIL_COUNT) return 0;
  for (i = 0; i < u->n_abilities; i++) if (u->abilities[i] == id) known = 1;
  if (!known) return 0;
  if (ABILITY_DEFS[id].uses != USES_UNLIMITED && (u->uses[id] == USES_UNSET || u->uses[id] == 0)) return 0;
  return 1;
}

int uses_left(const Character *u, uint8_t id) {
  if (ABILITY_DEFS[id].uses == USES_UNLIMITED) return 255;
  return u->uses[id] == USES_UNSET ? 0 : u->uses[id];
}

void use_ability(uint8_t id, AbilityContext *ctx, ActionResult *res) {
  const AbilityDef *ab = &ABILITY_DEFS[id];
  uint8_t before;
  AbilityFn fn = effect_of(id);
  result_clear(res);
  if (ab->uses != USES_UNLIMITED && !can_use(ctx->user, id)) return;
  before = ctx->user->uses[id];
  if (fn) fn(ctx, res);
  if (ab->uses != USES_UNLIMITED && before != USES_UNSET && ctx->user->uses[id] == before) ctx->user->uses[id] = before > 0 ? before - 1 : 0;
}

/* ================================================================ przedmioty jednorazowe */
void use_consumable(Character *user, int idx, Character **targets, int n_targets, Rng *r, ActionResult *res) {
  const ConsumableStats *c;
  Character *tg0;
  int i;
  result_clear(res);
  if (idx < 0 || idx >= user->n_inv) return;
  c = ITEM_DEFS[user->inv[idx].id].consumable;
  if (!c) return;
  tg0 = n_targets ? targets[0] : user;
  switch (c->effect) {
    case CEFFECT_HEAL: {
      RollResult rr;
      int total, n;
      if (is_dead(tg0)) return;
      total = roll(r, c->amount.n || c->amount.mod ? c->amount : mk(1, 4, 0), die_halves(user), &rr);
      copy_roll(&res->heal, &rr, rr.mod, 2, total);
      res->has_heal = 1;
      n = heal(tg0, total);
      result_event(res, EV_HEAL, tg0)->amount = (int16_t)n;
      for (i = 0; i < COND_COUNT; i++) if (c->cures & (1UL << i)) remove_condition(tg0, (uint8_t)i);
      break;
    }
    case CEFFECT_CLEANSE:
      for (i = 0; i < COND_COUNT; i++) if (c->cures & (1UL << i)) remove_condition(tg0, (uint8_t)i);
      break;
    case CEFFECT_DAMAGE: {
      int n = n_targets ? n_targets : 1;
      for (i = 0; i < n; i++) {
        Character *t = n_targets ? targets[i] : user;
        CheckResult sc;
        if (c->only_machine && !is_machine(t)) continue;
        basic_save(res, t, c->save != SAVE_NONE ? c->save : SAVE_REFLEX, c->dc ? c->dc : 15, c->amount.n || c->amount.mod ? c->amount : mk(1, 6, 0),
                   c->dmg_type != DMG_NONE ? c->dmg_type : DMG_P, r, user, &sc);
        if (c->cond != COND_NONE && sc.degree <= 1 && t->hp > 0) {
          if (c->cond_value.dice.sides) cond_ev_dice(res, t, c->cond, c->cond_value.dice);
          else cond_ev(res, t, c->cond, c->cond_value.num);
        }
      }
      break;
    }
    case CEFFECT_BUFF:
      for (i = 0; i < c->n_buffs; i++) {
        add_condition(tg0, c->buffs[i].cond, c->buffs[i].value);
        result_event(res, EV_CONDITION, tg0)->cond = c->buffs[i].cond;
      }
      break;
    case CEFFECT_SMOKE: {
      int n = n_targets ? n_targets : 1;
      for (i = 0; i < n; i++) add_condition(n_targets ? targets[i] : user, COND_DODGING, 1);
      break;
    }
  }
  if (--user->inv[idx].qty == 0) {
    for (i = idx; i + 1 < user->n_inv; i++) user->inv[i] = user->inv[i + 1];
    user->n_inv--;
  }
  res->consumed = 1;
}
