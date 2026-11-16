/* Kontroler walki turowej. Port src/core/tactical/combat.ts (bez dziennika tekstowego - widok buduje go z sygnałów). */
#include <string.h>
#include "combat.h"

/* ================================================================ sortowanie jak V8 (n < 64) */
void js_sort_ptr(void **a, int n, JsCmp cmp, void *ctx) {
  int lo, run, start;
  if (n < 2) return;
  /* CountAndMakeRun */
  lo = 1;
  run = 2;
  if (n == 1) return;
  {
    int desc = cmp(ctx, a[1], a[0]) < 0, i;
    void *prev = a[1];
    for (i = 2; i < n; i++) {
      double o = cmp(ctx, a[i], prev);
      if (desc ? o >= 0 : o < 0) break;
      prev = a[i];
      run++;
    }
    if (desc) {
      int x = 0, y = run - 1;
      while (x < y) {
        void *t = a[x];
        a[x] = a[y];
        a[y] = t;
        x++;
        y--;
      }
    }
  }
  (void)lo;
  /* BinaryInsertionSort(0, run, n) */
  for (start = run; start < n; start++) {
    int left = 0, right = start, p;
    void *pivot = a[start];
    while (left < right) {
      int mid = left + ((right - left) >> 1);
      if (cmp(ctx, pivot, a[mid]) < 0) right = mid;
      else left = mid + 1;
    }
    for (p = start; p > left; p--) a[p] = a[p - 1];
    a[left] = pivot;
  }
}

/* ================================================================ pomocnicze */
static void emit(Combat *c, CombatSignal *s) {
  int i;
  for (i = 0; i < c->n_listeners; i++) c->listeners[i](c->listener_ctx[i], s);
}
static void sig_init(CombatSignal *s, int kind) {
  memset(s, 0, sizeof *s);
  s->kind = (uint8_t)kind;
}
static ActionOutcome fail(int reason) {
  ActionOutcome o;
  memset(&o, 0, sizeof o);
  o.reason = (uint8_t)reason;
  return o;
}
static ActionOutcome okay(void) {
  ActionOutcome o;
  memset(&o, 0, sizeof o);
  o.ok = 1;
  return o;
}

void combat_init(Combat *c, const Battlefield *f, Rng *rng) {
  memset(c, 0, sizeof *c);
  c->field = *f;
  c->rng = rng;
  c->round = 1;
  c->idx = -1;
}
void combat_on(Combat *c, CombatListener fn, void *ctx) {
  if (c->n_listeners < 4) {
    c->listeners[c->n_listeners] = fn;
    c->listener_ctx[c->n_listeners] = ctx;
    c->n_listeners++;
  }
}

static int n_act(const Combat *c) { return *c->field.n_actors; }
static Actor *act(const Combat *c, int i) { return c->field.actors[i]; }

int combat_foes_of(const Combat *c, const Actor *a, Actor **out) {
  int i, n = 0;
  for (i = 0; i < n_act(c); i++) {
    Actor *x = act(c, i);
    if (a->side == SIDE_PC) {
      if (x->side != SIDE_ENEMY || !x->engaged) continue;
    } else if (x->side != SIDE_PC) continue;
    if (x->state == AST_UP) out[n++] = x;
  }
  return n;
}

Actor *combat_actor_at(const Combat *c, int gx, int gy) {
  int i;
  for (i = 0; i < n_act(c); i++) {
    Actor *a = act(c, i);
    if (a->state != AST_DEAD && a->side != SIDE_NEUTRAL && a->gx == gx && a->gy == gy) return a;
  }
  return NULL;
}
int combat_occupied(const Combat *c, int gx, int gy) {
  return combat_actor_at(c, gx, gy) != NULL || (c->field.is_blocked && c->field.is_blocked(c->field.ctx, gx, gy));
}
int combat_speed_of(const Actor *a) {
  int s = get_stat(a->ch, STAT_SPEED, 0);
  int v = s ? s : 5; /* Math.round(speed) || 5 */
  return v < 1 ? 1 : v;
}

/* ---------------------------------------------------------------- stan up/down/dead */
static int sync_one(Combat *c, Actor *a) {
  Character *ch = a->ch;
  int s = !is_alive(ch) ? AST_DEAD : (is_down(ch) || ch->hp <= 0) ? AST_DOWN : AST_UP;
  if (a->side == SIDE_ENEMY && s != AST_UP) s = AST_DEAD;
  if (s != a->state) {
    CombatSignal sg;
    int from = a->state;
    a->state = (uint8_t)s;
    sig_init(&sg, SIG_STATE);
    sg.actor = a;
    sg.from = (uint8_t)from;
    sg.to = (uint8_t)s;
    emit(c, &sg);
  }
  return s;
}
void combat_sync_all(Combat *c) {
  int i;
  for (i = 0; i < n_act(c); i++) if (act(c, i)->side != SIDE_NEUTRAL) sync_one(c, act(c, i));
}

/* ---------------------------------------------------------------- informacje o ataku */
int combat_flanked(const Combat *c, uint8_t side, Pos pos, const Actor *def, const NormWeapon *w) {
  int ox, oy, i;
  if (w->range > 0 || cheb(pos, apos(def)) > 1) return 0;
  ox = def->gx - (pos.gx - def->gx);
  oy = def->gy - (pos.gy - def->gy);
  for (i = 0; i < n_act(c); i++) {
    Actor *z = act(c, i);
    if (z->side == side && z->state == AST_UP && z->gx == ox && z->gy == oy) return 1;
  }
  return 0;
}

/* withTemp: tymczasowa osłona geometryczna / flankowanie na obrońcy. */
typedef struct { int8_t ic, og; } TempSave;
static TempSave temp_apply(Actor *def, int geo, int flank) {
  TempSave s;
  int8_t *cd = def->ch->cond;
  s.ic = cd[COND_IN_COVER];
  s.og = cd[COND_OFF_GUARD];
  if (geo) cd[COND_IN_COVER] = (int8_t)(s.ic >= 1 ? 2 : 1);
  if (flank && !s.og) cd[COND_OFF_GUARD] = 1;
  return s;
}
static void temp_restore(Actor *def, TempSave s) {
  if (def->ch->hp > 0) def->ch->cond[COND_IN_COVER] = s.ic;
  def->ch->cond[COND_OFF_GUARD] = s.og;
}

void combat_strike_info(Combat *c, Actor *att, Actor *def, const NormWeapon *w, Pos pos, StrikeInfo *info) {
  int d, r, cover = 0, hit, crit;
  TempSave ts;
  memset(info, 0, sizeof *info);
  info->weapon = *w;
  info->ranged = w->range > 0;
  d = cheb(pos, apos(def));
  r = w->range;
  if (r == 0) {
    int reach = (w->traits & WT_REACH) ? 2 : 1;
    if (d > reach) {
      info->reason = R_TOO_FAR;
      info->melee = 1;
      return;
    }
  } else {
    Los los;
    if (d > r * 6) {
      info->reason = R_OUT_OF_RANGE;
      return;
    }
    los = grid_los(c->field.grid, pos, apos(def));
    if (!los.clear) {
      info->reason = R_NO_LOS;
      return;
    }
    cover = los.cover;
    info->inc = (uint8_t)((int)ceil((double)d / r) - 1);
  }
  info->flank = (uint8_t)combat_flanked(c, att->side, pos, def, w);
  info->geo_cover = (uint8_t)(r > 0 && cover);
  info->map_idx = (uint8_t)(att->map_n < 2 ? att->map_n : 2);
  info->mod = get_attack_bonus(att->ch, w, info->map_idx, info->inc);
  info->concealed = conceal_halves(def->ch) > 0;
  info->frightened = die_halves(att->ch) > 0;
  info->halves = (uint8_t)attack_halves(att->ch, def->ch);
  ts = temp_apply(def, info->geo_cover, info->flank);
  info->ac = get_stat(def->ch, STAT_AC, r == 0);
  temp_restore(def, ts);
  info->base_ac = get_stat(def->ch, STAT_AC, r == 0);
  hit_chances(info->mod, info->ac, info->halves, &hit, &crit);
  info->hit = hit / 20.0;
  info->crit = crit / 20.0;
  info->ok = 1;
}

/* ---------------------------------------------------------------- ruch */
typedef struct { const Combat *c; uint8_t side; } PassCtx;
static int pass_side(void *ctx, int gx, int gy) {
  PassCtx *p = (PassCtx *)ctx;
  Actor *o = combat_actor_at(p->c, gx, gy);
  return !o || o->side == p->side;
}
void combat_reach_for(Combat *c, const Actor *a, int actions, Search *res, int *sp) {
  PassCtx p;
  *sp = combat_speed_of(a);
  p.c = c;
  p.side = a->side;
  grid_search(c->field.grid, apos(a), (double)(*sp * actions), pass_side, &p, res);
}

int combat_exploring(const Combat *c) { return !c->active && c->field.free_actions && c->field.free_actions(c->field.ctx); }

static int can_act_err(const Combat *c, const Actor *a, int cost) {
  const TurnInfo *t = c->turn;
  if (combat_exploring(c) && a->side == SIDE_PC) return a->state != AST_UP ? R_CANT_ACT : 0;
  if (!c->active || !t || t->actor != a) return R_NOT_TURN;
  if (a->state != AST_UP) return R_CANT_ACT;
  if (cost > t->actions) return R_NO_ACTIONS;
  return 0;
}

int combat_spend_actions(Combat *c, Actor *a, int n) {
  if (can_act_err(c, a, n)) return 0;
  if (combat_exploring(c)) return 1;
  c->turn->actions = (uint8_t)(c->turn->actions - n);
  if (n > 0) c->turn->used = 1;
  return 1;
}

static void move_along(Combat *c, Actor *a, const Pos *path, int n) {
  CombatSignal s;
  if (n <= 0) return;
  a->ch->cond[COND_IN_COVER] = 0;
  a->gx = path[n - 1].gx;
  a->gy = path[n - 1].gy;
  sig_init(&s, SIG_MOVE);
  s.actor = a;
  s.path = path;
  s.path_n = n;
  emit(c, &s);
  if (a->side == SIDE_PC) combat_engage_visible(c);
}

ActionOutcome combat_stride(Combat *c, Actor *a, Pos dest) {
  static Search res;
  int err = can_act_err(c, a, 1), sp, n;
  double cost;
  ActionOutcome o;
  if (err || !c->turn) return fail(err ? err : R_NOT_TURN);
  if (combat_occupied(c, dest.gx, dest.gy)) return fail(R_OCCUPIED);
  combat_reach_for(c, a, c->turn->actions, &res, &sp);
  cost = res.cost[gidx(dest.gx, dest.gy)];
  if (!(cost > 0 && cost < UNREACHABLE)) return fail(R_NO_PATH);
  n = grid_path_from(&res, dest, c->path, MAX_PATH);
  if (n < 0) return fail(R_NO_PATH);
  c->path_n = n;
  combat_spend_actions(c, a, stride_actions(cost, sp));
  move_along(c, a, c->path, n);
  o = okay();
  o.path = c->path;
  o.path_n = n;
  return o;
}

ActionOutcome combat_step(Combat *c, Actor *a, Pos dest) {
  int err = can_act_err(c, a, 1), dx, dy, ok_corner;
  ActionOutcome o;
  Grid *g = c->field.grid;
  if (err) return fail(err);
  dx = dest.gx - a->gx;
  dy = dest.gy - a->gy;
  ok_corner = !dx || !dy || (grid_free(g, a->gx + dx, a->gy) && grid_free(g, a->gx, a->gy + dy));
  if (cheb(apos(a), dest) != 1 || !grid_free(g, dest.gx, dest.gy) || combat_occupied(c, dest.gx, dest.gy) || !ok_corner) return fail(R_STEP);
  combat_spend_actions(c, a, 1);
  c->path[0] = dest;
  c->path_n = 1;
  move_along(c, a, c->path, 1);
  o = okay();
  o.path = c->path;
  o.path_n = 1;
  return o;
}

int combat_approach_cell(Combat *c, Actor *a, Actor *target, int actions, const NormWeapon *w, Pos *cell, double *cost, Search *res, int *sp) {
  int dx, dy, found = 0;
  double bc = UNREACHABLE;
  combat_reach_for(c, a, actions, res, sp);
  for (dy = -1; dy <= 1; dy++) {
    for (dx = -1; dx <= 1; dx++) {
      int x = target->gx + dx, y = target->gy + dy, here;
      double cc;
      if ((!dx && !dy) || !grid_free(c->field.grid, x, y)) continue;
      here = x == a->gx && y == a->gy;
      if (!here && combat_occupied(c, x, y)) continue;
      cc = here ? 0 : res->cost[gidx(x, y)];
      if (!here && (cc <= 0 || cc >= UNREACHABLE)) continue;
      if (w) {
        StrikeInfo si;
        combat_strike_info(c, a, target, w, mkpos(x, y), &si);
        if (si.flank) cc -= 0.5;
      }
      if (cc < bc) {
        bc = cc;
        *cell = mkpos(x, y);
        found = 1;
      }
    }
  }
  if (found) *cost = bc > 0 ? bc : 0;
  return found;
}

/* ---------------------------------------------------------------- atak */
static void weapon_of(const Actor *a, NormWeapon *w) {
  NormWeapon ws[2];
  get_weapons(a->ch, ws);
  *w = ws[0];
}

ActionOutcome combat_strike(Combat *c, Actor *att, Actor *def, const NormWeapon *wp) {
  StrikeInfo info;
  NormWeapon w;
  StrikeOptions o;
  TempSave ts;
  CombatSignal s;
  ActionOutcome out;
  int err = can_act_err(c, att, 1);
  if (err) return fail(err);
  if (wp) w = *wp;
  else weapon_of(att, &w);
  combat_strike_info(c, att, def, &w, apos(att), &info);
  if (!info.ok) return fail(info.reason);
  combat_spend_actions(c, att, 1);
  strike_options_default(&o);
  o.weapon = &w;
  o.map_index = info.map_idx;
  o.range_increments = info.inc;
  o.hit_halves = info.halves;
  result_clear(&c->last);
  ts = temp_apply(def, info.geo_cover, info.flank);
  strike(att->ch, def->ch, &o, c->rng, &c->last);
  temp_restore(def, ts);
  att->map_n++;
  att->ch->cond[COND_IN_COVER] = 0;
  sig_init(&s, SIG_STRIKE);
  s.actor = att;
  s.other = def;
  s.info = &info;
  s.result = &c->last;
  emit(c, &s);
  if (info.ranged) combat_noise(c, att, 9);
  combat_sync_all(c);
  combat_check_end(c);
  out = okay();
  out.result = &c->last;
  return out;
}

ActionOutcome combat_attack_target(Combat *c, Actor *att, Actor *def, const NormWeapon *wp) {
  StrikeInfo info;
  NormWeapon w;
  ActionOutcome o;
  int err = can_act_err(c, att, 1), path_n = 0;
  if (err || !c->turn) return fail(err ? err : R_NOT_TURN);
  if (wp) w = *wp;
  else weapon_of(att, &w);
  combat_strike_info(c, att, def, &w, apos(att), &info);
  if (!info.ok && info.melee) {
    static Search res;
    Pos cell;
    double cost;
    int sp, n;
    if (c->turn->actions < 2) return fail(R_NEED_MOVE);
    if (!combat_approach_cell(c, att, def, c->turn->actions - 1, &w, &cell, &cost, &res, &sp)) return fail(R_CANT_APPROACH);
    n = grid_path_from(&res, cell, c->path, MAX_PATH);
    if (n < 0) return fail(R_CANT_APPROACH);
    c->path_n = n;
    combat_spend_actions(c, att, stride_actions(res.cost[gidx(cell.gx, cell.gy)], sp));
    move_along(c, att, c->path, n);
    path_n = n;
    if (!c->active) {
      o = okay();
      o.path = c->path;
      o.path_n = n;
      return o;
    }
    combat_strike_info(c, att, def, &w, apos(att), &info);
  }
  if (!info.ok) {
    o = fail(info.reason);
    o.path = c->path;
    o.path_n = path_n;
    return o;
  }
  o = combat_strike(c, att, def, &w);
  o.path = c->path;
  o.path_n = path_n;
  return o;
}

/* ---------------------------------------------------------------- zdolności */
int combat_ability_cost(uint8_t id) { return ABILITY_DEFS[id].actions == ACTIONS_REACTION ? 99 : ABILITY_DEFS[id].actions; }

int area_affects(uint8_t id) {
  if (id == ABIL_RALLY || id == ABIL_FIELD_CLINIC || id == ABIL_CHIEF_RALLY || id == ABIL_KOSTUCHA_COMMAND) return 0;
  return ABILITY_DEFS[id].range > 0 ? 2 : 1;
}
int explore_ability_ok(uint8_t id) {
  const AbilityDef *ab = &ABILITY_DEFS[id];
  if (id == ABIL_STRIKE || id == ABIL_RAISE_SHIELD || id == ABIL_TAKE_COVER || id == ABIL_DODGE || id == ABIL_RAGE || id == ABIL_FRENZY || id == ABIL_STAND) return 0;
  if (ab->actions == ACTIONS_REACTION) return 0;
  return ab->target == TARGET_SELF || ab->target == TARGET_ALLY || (ab->target == TARGET_AREA && area_affects(id) == 0);
}
int explore_item_ok(uint8_t item) {
  const ConsumableStats *cs = ITEM_DEFS[item].consumable;
  return cs && cs->target != TARGET_ENEMY && cs->target != TARGET_AREA;
}

static int in_range_los(Combat *c, Actor *a, Actor *t, int range) {
  return cheb(apos(a), apos(t)) <= range && (range <= 1 || grid_los(c->field.grid, apos(a), apos(t)).clear);
}

int combat_ability_targets(Combat *c, Actor *a, uint8_t id, Actor **out) {
  const AbilityDef *ab = &ABILITY_DEFS[id];
  int range = ab->move ? combat_speed_of(a) + 1 : ab->range, n = 0, i;
  if (ab->target == TARGET_ENEMY) {
    Actor *foes[MAX_ACTORS];
    int nf = combat_foes_of(c, a, foes);
    for (i = 0; i < nf; i++) if (in_range_los(c, a, foes[i], range)) out[n++] = foes[i];
    return n;
  }
  if (ab->target == TARGET_ALLY) {
    for (i = 0; i < n_act(c); i++) {
      Actor *x = act(c, i);
      if (x->side == a->side && x->state != AST_DEAD && (x == a || in_range_los(c, a, x, range))) out[n++] = x;
    }
  }
  return n;
}

int combat_area_targets(Combat *c, Pos cell, int radius, Actor **out) {
  int i, n = 0;
  for (i = 0; i < n_act(c); i++) {
    Actor *x = act(c, i);
    if (x->side != SIDE_NEUTRAL && x->state != AST_DEAD && js_hypot(x->gx - cell.gx, x->gy - cell.gy) <= (radius ? radius : 1) + 0.45) out[n++] = x;
  }
  return n;
}

int combat_area_targets_for(Combat *c, Actor *a, uint8_t id, Pos cell, Actor **out) {
  Actor *all[MAX_ACTORS];
  int na = combat_area_targets(c, cell, ABILITY_DEFS[id].radius ? ABILITY_DEFS[id].radius : 1, all), i, n = 0, aff = area_affects(id);
  for (i = 0; i < na; i++) {
    if (aff == 0 && all[i]->side != a->side) continue;
    if (aff == 1 && all[i]->side == a->side) continue;
    out[n++] = all[i];
  }
  return n;
}

int combat_area_cell_ok(Combat *c, Actor *a, Pos cell, int range) {
  return cheb(apos(a), cell) <= range && grid_los(c->field.grid, apos(a), cell).clear && grid_kind(c->field.grid, cell.gx, cell.gy) != CELL_HIGH;
}

static int rest_spent(const Actor *t, uint8_t id) { return (t->rest_used >> id) & 1; }

ActionOutcome combat_use_ability(Combat *c, Actor *a, uint8_t id, Actor **targets, int n_targets, const Pos *cellp) {
  const AbilityDef *ab;
  int cost, err, free_, i, n_tg = 0, has_cell = 0, path_n = 0;
  Actor *tg[MAX_ACTORS];
  Pos cell = mkpos(0, 0);
  AbilityContext ctx;
  CombatSignal s;
  ActionOutcome o;
  if (id >= ABIL_COUNT) return fail(R_UNKNOWN);
  ab = &ABILITY_DEFS[id];
  cost = combat_ability_cost(id);
  err = can_act_err(c, a, cost);
  if (err) return fail(err);
  {
    int known = 0;
    for (i = 0; i < a->ch->n_abilities; i++) if (a->ch->abilities[i] == id) known = 1;
    if (!known) return fail(R_NOT_KNOWN);
  }
  if (ab->uses != USES_UNLIMITED && !can_use(a->ch, id)) return fail(R_NO_USES);
  free_ = combat_exploring(c);
  if (free_ && !explore_ability_ok(id)) return fail(R_COMBAT_ONLY);
  if (!free_ && cost == 0 && ((a->used_free >> id) & 1)) return fail(R_USED_THIS_TURN);

  if (ab->target == TARGET_ENEMY || ab->target == TARGET_ALLY) {
    Actor *valid[MAX_ACTORS];
    int nv = combat_ability_targets(c, a, id, valid), k, all_spent = 1;
    for (i = 0; i < n_targets; i++)
      for (k = 0; k < nv; k++)
        if (valid[k] == targets[i]) {
          tg[n_tg++] = targets[i];
          break;
        }
    if (!n_tg) return fail(R_NEED_TARGET);
    if (free_ && ab->uses == USES_UNLIMITED) {
      for (i = 0; i < n_tg; i++) if (!rest_spent(tg[i], id)) all_spent = 0;
      if (all_spent) return fail(R_REST_SPENT);
    }
  } else if (ab->target == TARGET_AREA) {
    if (ab->range > 0) {
      if (!cellp || !combat_area_cell_ok(c, a, *cellp, ab->range)) return fail(R_OUT_OF_RANGE);
      cell = *cellp;
      has_cell = 1;
      n_tg = combat_area_targets_for(c, a, id, cell, tg);
    } else {
      int has_a = 0;
      cell = apos(a);
      has_cell = 1;
      n_tg = combat_area_targets_for(c, a, id, cell, tg);
      for (i = 0; i < n_tg; i++) if (tg[i] == a) has_a = 1;
      if (area_affects(id) == 0 && !has_a) tg[n_tg++] = a;
    }
  } else if (ab->target == TARGET_SELF) {
    tg[n_tg++] = a;
  } else {
    n_tg = combat_foes_of(c, a, tg);
  }

  if (free_ && ab->uses == USES_UNLIMITED && (ab->target == TARGET_SELF || ab->target == TARGET_ALLY)) {
    if (ab->target == TARGET_SELF && rest_spent(a, id)) return fail(R_REST_SPENT);
    for (i = 0; i < n_tg; i++) tg[i]->rest_used |= (uint64_t)1 << id;
  }
  combat_spend_actions(c, a, cost);
  if (cost == 0 && !free_) a->used_free |= (uint64_t)1 << id;

  if (ab->move && n_tg && tg[0] != a && cheb(apos(a), apos(tg[0])) > 1) {
    static Search res;
    Pos ap;
    double acost;
    int sp;
    if (combat_approach_cell(c, a, tg[0], 1, NULL, &ap, &acost, &res, &sp)) {
      int n = grid_path_from(&res, ap, c->path, MAX_PATH);
      if (n > 0) {
        c->path_n = n;
        move_along(c, a, c->path, n);
        path_n = n;
      }
    }
  }
  memset(&ctx, 0, sizeof ctx);
  ctx.user = a->ch;
  for (i = 0; i < n_tg && i < CTX_TARGETS_MAX; i++) ctx.targets[ctx.n_targets++] = tg[i]->ch;
  ctx.rng = c->rng;
  ctx.map_index = a->map_n < 2 ? a->map_n : 2;
  use_ability(id, &ctx, &c->last);
  if (c->last.attack) a->map_n = (uint8_t)(a->map_n + (c->last.attacks ? c->last.attacks : 1));
  sig_init(&s, SIG_ABILITY);
  s.actor = a;
  s.ability = id;
  s.list = tg;
  s.n_list = n_tg;
  s.has_cell = (uint8_t)has_cell;
  s.cell = cell;
  s.result = &c->last;
  emit(c, &s);
  if (ab->fx == FX_SHOT) combat_noise(c, a, 9);
  else if (ab->fx == FX_EXPLOSION) combat_noise(c, a, 10);
  combat_sync_all(c);
  combat_check_end(c);
  o = okay();
  o.result = &c->last;
  o.path = c->path;
  o.path_n = path_n;
  return o;
}

/* ---------------------------------------------------------------- przedmioty */
ActionOutcome combat_use_item(Combat *c, Actor *a, int idx, Actor *target, const Pos *cell) {
  const ConsumableStats *cs;
  Actor *tg[MAX_ACTORS];
  Character *tch[MAX_ACTORS];
  int n = 0, err, i, item;
  CombatSignal s;
  ActionOutcome o;
  if (idx < 0 || idx >= a->ch->n_inv) return fail(R_NOT_USABLE);
  item = a->ch->inv[idx].id;
  cs = ITEM_DEFS[item].consumable;
  if (!cs) return fail(R_NOT_USABLE);
  if (combat_exploring(c) && !explore_item_ok((uint8_t)item)) return fail(R_COMBAT_ONLY);
  err = can_act_err(c, a, cs->actions);
  if (err) return fail(err);
  tg[n++] = a;
  if (cs->target == TARGET_AREA) {
    if (!cell || !combat_area_cell_ok(c, a, *cell, cs->range ? cs->range : 6)) return fail(R_OUT_OF_RANGE);
    n = combat_area_targets(c, *cell, cs->radius ? cs->radius : 1, tg);
  } else if (cs->target != TARGET_SELF && target) {
    int rng = cs->range ? cs->range : 1;
    if (cs->target == TARGET_ENEMY && target->side == a->side) return fail(R_WRONG_SIDE);
    if (cs->target != TARGET_ENEMY && target->side != a->side) return fail(R_WRONG_SIDE);
    if (cheb(apos(a), apos(target)) > (rng > 1 ? rng : 1)) return fail(R_TOO_FAR);
    tg[0] = target;
    n = 1;
  }
  combat_spend_actions(c, a, cs->actions);
  for (i = 0; i < n; i++) tch[i] = tg[i]->ch;
  use_consumable(a->ch, idx, tch, n, c->rng, &c->last);
  sig_init(&s, SIG_ITEM);
  s.actor = a;
  s.item = (uint8_t)item;
  s.list = tg;
  s.n_list = n;
  s.has_cell = cell != NULL;
  if (cell) s.cell = *cell;
  s.result = &c->last;
  emit(c, &s);
  if (cs->effect == CEFFECT_DAMAGE) combat_noise(c, a, 10);
  combat_sync_all(c);
  combat_check_end(c);
  o = okay();
  o.result = &c->last;
  return o;
}

ActionOutcome combat_swap_weapon(Combat *c, Actor *a) {
  int err = can_act_err(c, a, 1);
  if (err) return fail(err);
  if (a->ch->equip[SLOT_WEAPON2].id == ITEM_NONE) return fail(R_NO_WEAPON2);
  combat_spend_actions(c, a, 1);
  swap_weapons(a->ch);
  return okay();
}

ActionOutcome combat_take_cover(Combat *c, Actor *a) {
  AbilityContext ctx;
  CombatSignal s;
  ActionOutcome o;
  Actor *self[1];
  int err = can_act_err(c, a, 1);
  if (err) return fail(err);
  combat_spend_actions(c, a, 1);
  memset(&ctx, 0, sizeof ctx);
  ctx.user = a->ch;
  ctx.targets[0] = a->ch;
  ctx.n_targets = 1;
  ctx.rng = c->rng;
  use_ability(ABIL_TAKE_COVER, &ctx, &c->last);
  self[0] = a;
  sig_init(&s, SIG_ABILITY);
  s.actor = a;
  s.ability = ABIL_TAKE_COVER;
  s.list = self;
  s.n_list = 1;
  s.result = &c->last;
  emit(c, &s);
  o = okay();
  o.result = &c->last;
  return o;
}

/* ---------------------------------------------------------------- hałas i dołączanie wrogów */
void combat_noise(Combat *c, Actor *a, int radius) {
  CombatSignal s;
  int gi, k;
  sig_init(&s, SIG_NOISE);
  s.actor = a;
  s.radius = radius;
  emit(c, &s);
  for (gi = 0; gi < *c->field.n_groups; gi++) {
    EnemyGroup *g = c->field.groups[gi];
    int alive = 0, near = 0;
    if (g->alerted) continue;
    for (k = 0; k < g->n; k++) if (g->actors[k]->state != AST_DEAD) alive = 1;
    if (!alive) continue;
    for (k = 0; k < g->n; k++) if (g->actors[k]->state != AST_DEAD && cheb(apos(g->actors[k]), apos(a)) <= radius) near = 1;
    if (!near) continue;
    g->alerted = 1;
  }
  combat_engage_visible(c);
}

static void roll_init(Combat *c, Actor *a) {
  InitiativeRoll r = roll_initiative(a->ch, c->rng);
  a->init = (int16_t)r.total;
}

static int in_sight(Combat *c, const Actor *e) {
  int i;
  if (c->field.in_sight) return c->field.in_sight(c->field.ctx, e);
  for (i = 0; i < n_act(c); i++) {
    Actor *p = act(c, i);
    if (p->side == SIDE_PC && p->state != AST_DEAD && cheb(apos(e), apos(p)) <= 9 && grid_los(c->field.grid, apos(p), apos(e)).clear) return 1;
  }
  return 0;
}

void combat_engage(Combat *c, Actor **list, int n) {
  Actor *fresh[MAX_ACTORS];
  int nf = 0, i;
  CombatSignal s;
  for (i = 0; i < n; i++) if (list[i]->side == SIDE_ENEMY && !list[i]->engaged && list[i]->state != AST_DEAD) fresh[nf++] = list[i];
  if (!nf) return;
  for (i = 0; i < nf; i++) {
    fresh[i]->engaged = 1;
    if (fresh[i]->group) fresh[i]->group->alerted = 1;
    fresh[i]->has_roam = 0;
  }
  if (!c->active) return;
  for (i = 0; i < nf; i++) {
    roll_init(c, fresh[i]);
    if (c->n_order < MAX_ACTORS * 2) c->order[c->n_order++] = fresh[i];
  }
  sig_init(&s, SIG_JOIN);
  s.list = fresh;
  s.n_list = nf;
  emit(c, &s);
}

void combat_engage_visible(Combat *c) {
  Actor *seen[MAX_ACTORS];
  int n = 0, i;
  if (!c->active) return;
  for (i = 0; i < n_act(c); i++) {
    Actor *e = act(c, i);
    if (e->side == SIDE_ENEMY && !e->engaged && e->state == AST_UP && in_sight(c, e)) seen[n++] = e;
  }
  if (n) combat_engage(c, seen, n);
}

void combat_relocate(Combat *c, Actor *a, const Pos *path, int n) {
  CombatSignal s;
  if (n <= 0) return;
  a->gx = path[n - 1].gx;
  a->gy = path[n - 1].gy;
  sig_init(&s, SIG_MOVE);
  s.actor = a;
  s.path = path;
  s.path_n = n;
  emit(c, &s);
}

/* ---------------------------------------------------------------- przebieg walki */
static int g_ambush;
static double init_cmp(void *ctx, const void *pa, const void *pb) {
  const Actor *x = (const Actor *)pa, *y = (const Actor *)pb;
  double r;
  (void)ctx;
  r = g_ambush && x->side != y->side ? (x->side == SIDE_PC ? -1 : 1) : 0;
  if (r) return r;
  r = y->init - x->init;
  if (r) return r;
  return x->side == SIDE_PC ? -1 : 1;
}

int combat_start(Combat *c, Actor **foes, int n, int ambush) {
  Actor *enemies[MAX_ACTORS], *parts[MAX_ACTORS];
  uint8_t unaware[MAX_ACTORS];
  int ne = 0, np = 0, i;
  CombatSignal s;
  if (c->active) {
    combat_engage(c, foes, n);
    return c->n_order;
  }
  for (i = 0; i < n_act(c); i++) act(c, i)->rest_used = 0;
  for (i = 0; i < n; i++) if (foes[i]->side == SIDE_ENEMY && foes[i]->state != AST_DEAD) enemies[ne++] = foes[i];
  for (i = 0; i < ne; i++) unaware[i] = !(enemies[i]->group && enemies[i]->group->alerted);
  for (i = 0; i < ne; i++) {
    enemies[i]->engaged = 1;
    enemies[i]->has_roam = 0;
    if (enemies[i]->group) enemies[i]->group->alerted = 1;
  }
  c->active = 1;
  c->round = 1;
  c->idx = -1;
  c->turn = NULL;
  for (i = 0; i < n_act(c); i++) if (act(c, i)->side == SIDE_PC && act(c, i)->state != AST_DEAD) parts[np++] = act(c, i);
  for (i = 0; i < ne; i++) parts[np++] = enemies[i];
  for (i = 0; i < np; i++) roll_init(c, parts[i]);
  g_ambush = ambush;
  js_sort_ptr((void **)parts, np, init_cmp, NULL);
  for (i = 0; i < np; i++) c->order[i] = parts[i];
  c->n_order = np;
  if (ambush) {
    for (i = 0; i < ne; i++) {
      if (!unaware[i]) continue;
      if (!enemies[i]->ch->cond[COND_OFF_GUARD]) {
        enemies[i]->ch->cond[COND_OFF_GUARD] = 1;
        enemies[i]->ambushed = 1;
      }
    }
  }
  sig_init(&s, SIG_COMBAT_START);
  s.list = c->order;
  s.n_list = c->n_order;
  for (i = 0; i < ne; i++) if (enemies[i]->ch->is_enemy && ENEMY_DEFS[enemies[i]->ch->template_id].ai == AI_BOSS) s.boss = 1;
  s.ambush = (uint8_t)ambush;
  emit(c, &s);
  return c->n_order;
}

static TurnInfo *begin_turn(Combat *c, Actor *a) {
  TurnInfo *t = &c->turn_data;
  ActionResult ev;
  int actions = 0, saved;
  CombatSignal s;
  memset(t, 0, sizeof *t);
  t->actor = a;
  t->actions = 3;
  t->full = 3;
  c->turn = t;
  a->map_n = 0;
  if (a->ambushed) {
    a->ambushed = 0;
    a->ch->cond[COND_OFF_GUARD] = 0;
  }
  combat_engage_visible(c);
  if (!c->active) return NULL;
  saved = a->has_saved && a->saved_round == c->round;
  a->has_saved = 0;
  result_clear(&ev);
  if (saved) actions = a->saved_actions;
  else start_turn(a->ch, c->rng, &actions, &ev);
  if (ev.n_events) {
    sig_init(&s, SIG_RULES);
    s.actor = a;
    s.result = &ev;
    emit(c, &s);
  }
  combat_sync_all(c);
  if (a->state == AST_DEAD) {
    c->turn = NULL;
    combat_check_end(c);
    return NULL;
  }
  if (a->state == AST_DOWN) {
    combat_check_end(c);
    if (c->active) combat_end_turn(c);
    c->turn = NULL;
    return NULL;
  }
  t->actions = (uint8_t)(actions > 0 ? actions : 0);
  t->full = t->actions;
  sig_init(&s, SIG_TURN_START);
  s.actor = a;
  s.turn = t;
  s.round = c->round;
  emit(c, &s);
  if (t->actions <= 0) {
    combat_end_turn(c);
    return NULL;
  }
  return t;
}

TurnInfo *combat_next_turn(Combat *c) {
  int guard;
  if (c->turn) combat_end_turn(c);
  for (guard = 0; guard < 1000 && c->active; guard++) {
    Actor *a;
    TurnInfo *t;
    c->idx++;
    if (c->idx >= c->n_order) {
      int i, n = 0;
      CombatSignal s;
      c->idx = 0;
      c->round++;
      for (i = 0; i < c->n_order; i++) if (c->order[i]->state != AST_DEAD) c->order[n++] = c->order[i];
      c->n_order = n;
      sig_init(&s, SIG_ROUND);
      s.round = c->round;
      emit(c, &s);
      if (!c->n_order) return NULL;
    }
    a = c->idx < c->n_order ? c->order[c->idx] : NULL;
    if (!a || a->state == AST_DEAD || (a->side == SIDE_ENEMY && !a->engaged)) continue;
    t = begin_turn(c, a);
    if (t) return t;
  }
  return NULL;
}

void combat_end_turn(Combat *c) {
  TurnInfo *t = c->turn;
  Actor *a;
  CombatSignal s;
  if (!t) return;
  c->turn = NULL;
  if (t->switched) {
    c->idx--;
    return;
  }
  a = t->actor;
  end_turn(a->ch, NULL);
  if (t->delayed) {
    int i;
    for (i = c->idx; i + 1 < c->n_order; i++) c->order[i] = c->order[i + 1];
    c->order[c->n_order - 1] = a;
    c->idx--;
  }
  combat_sync_all(c);
  sig_init(&s, SIG_TURN_END);
  s.actor = a;
  emit(c, &s);
}

void combat_delay(Combat *c) {
  if (c->turn) c->turn->delayed = 1;
}

int combat_switch_to(Combat *c, Actor *b, int *immediate) {
  TurnInfo *t = c->turn;
  int bi = -1, i;
  *immediate = 0;
  if (!t || !c->active || b->side != SIDE_PC || b == t->actor || t->actor->side != SIDE_PC) return 0;
  if (b->state != AST_UP) return 0;
  for (i = 0; i < c->n_order; i++) if (c->order[i] == b) bi = i;
  if (bi < 0 || bi <= c->idx) return 0;
  for (i = bi; i + 1 < c->n_order; i++) c->order[i] = c->order[i + 1];
  c->n_order--;
  if (t->actions >= t->full && !t->used) {
    t->actor->has_saved = 1;
    t->actor->saved_actions = t->actions;
    t->actor->saved_round = (int16_t)c->round;
    for (i = c->n_order; i > c->idx; i--) c->order[i] = c->order[i - 1];
    c->order[c->idx] = b;
    c->n_order++;
    t->switched = 1;
    *immediate = 1;
    return 1;
  }
  for (i = c->n_order; i > c->idx + 1; i--) c->order[i] = c->order[i - 1];
  c->order[c->idx + 1] = b;
  c->n_order++;
  return 1;
}

static int finish_combat(Combat *c, int outcome) {
  int i;
  CombatSignal s;
  c->active = 0;
  for (i = 0; i < n_act(c); i++) {
    Actor *a = act(c, i);
    a->engaged = 0;
    if (!a->ambushed) continue;
    a->ambushed = 0;
    a->ch->cond[COND_OFF_GUARD] = 0;
  }
  c->turn = NULL;
  sig_init(&s, SIG_END);
  s.outcome = (uint8_t)outcome;
  emit(c, &s);
  return outcome;
}

int combat_check_end(Combat *c) {
  int i, any_up = 0, any_enemy = 0;
  if (!c->active) return -1;
  for (i = 0; i < n_act(c); i++) {
    Actor *a = act(c, i);
    if (a->side == SIDE_PC && a->state == AST_UP) any_up = 1;
    if (a->side == SIDE_ENEMY && a->engaged && a->state != AST_DEAD) any_enemy = 1;
  }
  if (!any_up) return finish_combat(c, END_DEFEAT);
  if (!any_enemy) {
    for (i = 0; i < n_act(c); i++) {
      Actor *a = act(c, i);
      a->map_n = 0;
      if (a->side == SIDE_PC) end_encounter(a->ch);
    }
    return finish_combat(c, END_CLEARED);
  }
  return -1;
}
