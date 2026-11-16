/* AI postaci w walce. Port src/core/tactical/ai.ts (oceny w double, ta sama kolejność działań co w TS). */
#include <string.h>
#include "combat.h"

static uint8_t ai_kind(const Actor *a) { return a->side == SIDE_ENEMY ? ENEMY_DEFS[a->ch->template_id].ai : 0xFF; } /* 0xFF = najemnik */
static int is_fleeing(const Actor *a) { return ai_kind(a) == AI_COWARD && a->ch->hp < a->ch->max_hp * 0.4; }

static int is_universal(uint8_t id) {
  int i;
  for (i = 0; i < UNIVERSAL_ABILITY_COUNT; i++) if (UNIVERSAL_ABILITIES[i] == id) return 1;
  return 0;
}

/* Najlepsza broń: taka, która sięga kogoś teraz; inaczej strzelcy - zasięg, reszta - wręcz. */
static void pick_weapon(Combat *c, Actor *a, Actor **foes, int nf, NormWeapon *out) {
  NormWeapon ws[2];
  int n = get_weapons(a->ch, ws), i, k, ranged = ai_kind(a) == AI_RANGED;
  double bs = -1e9;
  *out = ws[0];
  if (n <= 1) return;
  for (i = 0; i < n; i++) {
    double s = get_attack_bonus(a->ch, &ws[i], a->map_n < 2 ? a->map_n : 2, 0);
    int reach = 0;
    for (k = 0; k < nf && !reach; k++) {
      StrikeInfo si;
      combat_strike_info(c, a, foes[k], &ws[i], apos(a), &si);
      reach = si.ok;
    }
    if (reach) s += 50;
    else s += ranged ? ws[i].range : -(double)ws[i].range;
    if (s > bs) {
      bs = s;
      *out = ws[i];
    }
  }
}

/* Cel ataku: ranni, łatwi do trafienia, blisko, flankowani. Bestie gryzą najbliższego. */
static Actor *best_target(Combat *c, Actor *a, const NormWeapon *w, Actor **foes, int nf, StrikeInfo *best_info) {
  Actor *best = NULL;
  double bs = -1e9;
  int i;
  for (i = 0; i < nf; i++) {
    Actor *f = foes[i];
    StrikeInfo si;
    double hpf, s;
    combat_strike_info(c, a, f, w, apos(a), &si);
    if (!si.ok) continue;
    hpf = (double)f->ch->hp / f->ch->max_hp;
    s = (1 - hpf) * 30 + si.hit * 25 - cheb(apos(a), apos(f)) * 1.5 + (si.flank ? 6 : 0);
    if (ai_kind(a) == AI_BEAST) s = -cheb(apos(a), apos(f)) * 3 + si.hit * 10;
    if (f->state != AST_UP) s -= 100;
    if (s > bs) {
      bs = s;
      best = f;
      *best_info = si;
    }
  }
  return best;
}

static int pass_all(void *ctx, int gx, int gy) { (void)ctx; (void)gx; (void)gy; return 1; }

/* Ruch: pozycja, z której da się trafić (strzelcy wolą dystans i osłonę, wręcz - flankowanie); tchórz ucieka. */
static int ai_move(Combat *c, Actor *a, const NormWeapon *w, Actor **foes, int nf) {
  static Search res, fr;
  static float dm[GRID_N];
  TurnInfo *t = c->turn;
  int max_a, sp, i, k, ranged, flee, found = 0, best_here = 0;
  double bs = -1e9;
  Pos best = mkpos(0, 0);
  ActionOutcome o;
  if (!t || t->actor != a || t->actions <= 0) return 0;
  max_a = t->actions;
  combat_reach_for(c, a, max_a, &res, &sp);
  ranged = w->range > 0;
  for (i = 0; i < GRID_N; i++) dm[i] = UNREACHABLE;
  for (k = 0; k < nf; k++) {
    grid_search(c->field.grid, apos(foes[k]), 160, pass_all, NULL, &fr);
    for (i = 0; i < GRID_N; i++) if (fr.cost[i] < dm[i]) dm[i] = fr.cost[i];
  }
  flee = is_fleeing(a);
  for (i = 0; i < GRID_N; i++) {
    double cost = res.cost[i], s = 0;
    Pos pos;
    int here, n, rem, nd = 1 << 30;
    if (cost >= UNREACHABLE) continue;
    pos = mkpos(i % MAP_W, i / MAP_W);
    here = pos.gx == a->gx && pos.gy == a->gy;
    if (!here && combat_occupied(c, pos.gx, pos.gy)) continue;
    n = here ? 0 : stride_actions(cost, sp);
    rem = max_a - n;
    for (k = 0; k < nf; k++) {
      int d = cheb(apos(foes[k]), pos);
      if (d < nd) nd = d;
    }
    if (flee) s = nd * 6 - cost * 0.2;
    else {
      int can_hit = 0, flank = 0;
      if (rem >= 1) {
        for (k = 0; k < nf && !can_hit; k++) {
          StrikeInfo si;
          combat_strike_info(c, a, foes[k], w, pos, &si);
          can_hit = si.ok;
        }
      }
      if (can_hit) s += 100 + (rem >= 2 ? 15 : 0);
      s -= dm[i] * 2 + (here ? 0 : cost * 0.1);
      if (ranged) {
        if (nd < 3) s -= 12;
        if (grid_has_low_cover_near(c->field.grid, pos)) s += 7;
      } else if (can_hit) {
        for (k = 0; k < nf && !flank; k++) {
          StrikeInfo si;
          combat_strike_info(c, a, foes[k], w, pos, &si);
          flank = si.flank;
        }
        if (flank) s += 8;
      }
    }
    if (s > bs) {
      bs = s;
      best = pos;
      best_here = here;
      found = 1;
    }
  }
  if (!found || best_here) return 0;
  o = combat_stride(c, a, best);
  return o.ok;
}

typedef struct { Actor *a; } CmpCtx;
static double cmp_hp(void *ctx, const void *p, const void *q) { (void)ctx; return ((const Actor *)p)->ch->hp - ((const Actor *)q)->ch->hp; }
static double cmp_hp_ratio(void *ctx, const void *p, const void *q) {
  const Actor *x = (const Actor *)p, *y = (const Actor *)q;
  (void)ctx;
  return (double)x->ch->hp / x->ch->max_hp - (double)y->ch->hp / y->ch->max_hp;
}
static double cmp_level_desc(void *ctx, const void *p, const void *q) { (void)ctx; return ((const Actor *)q)->ch->level - ((const Actor *)p)->ch->level; }

/* Próba użycia zdolności (wrogowie z szansą 65%). */
static int ai_ability(Combat *c, Actor *a, Actor **foes, int nf, AiAction *out) {
  TurnInfo *t = c->turn;
  int i;
  if (!t) return 0;
  for (i = 0; i < a->ch->n_abilities; i++) {
    uint8_t id = a->ch->abilities[i];
    const AbilityDef *ab = &ABILITY_DEFS[id];
    int cost;
    ActionOutcome o;
    if (ab->actions == ACTIONS_REACTION || is_universal(id)) continue;
    cost = combat_ability_cost(id);
    if (cost > t->actions || uses_left(a->ch, id) <= 0 || (cost == 0 && ((a->used_free >> id) & 1))) continue;
    if (a->side == SIDE_ENEMY && rng_f(c->rng) > 0.65) continue;
    out->type = AI_ACT_ABILITY;
    out->ability = id;
    out->target = NULL;
    if (ab->target == TARGET_ENEMY) {
      Actor *tg[MAX_ACTORS];
      int n = combat_ability_targets(c, a, id, tg);
      if (!n || (ab->fx == FX_MELEE && a->map_n >= 2)) continue;
      js_sort_ptr((void **)tg, n, cmp_hp, NULL);
      o = combat_use_ability(c, a, id, &tg[0], 1, NULL);
      if (o.ok) {
        out->target = tg[0];
        return 1;
      }
      continue;
    }
    if (ab->target == TARGET_ALLY || ab->target == TARGET_SELF) {
      Actor *cands[MAX_ACTORS];
      int n;
      if (ab->target == TARGET_SELF) {
        cands[0] = a;
        n = 1;
      } else n = combat_ability_targets(c, a, id, cands);
      if (ab->fx == FX_HEAL) {
        Actor *wl[MAX_ACTORS];
        int nw = 0, k;
        for (k = 0; k < n; k++) {
          Actor *x = cands[k];
          if (x->state != AST_DEAD && (x->ch->hp < x->ch->max_hp * 0.55 || x->state == AST_DOWN)) wl[nw++] = x;
        }
        if (nw) {
          js_sort_ptr((void **)wl, nw, cmp_hp_ratio, NULL);
          o = combat_use_ability(c, a, id, &wl[0], 1, NULL);
          if (o.ok) {
            out->target = wl[0];
            return 1;
          }
        }
      } else if (!((a->used_b >> id) & 1) && nf) {
        Actor *pickd;
        a->used_b |= (uint64_t)1 << id;
        if (n) {
          js_sort_ptr((void **)cands, n, cmp_level_desc, NULL);
          pickd = cands[0];
        } else pickd = a;
        o = combat_use_ability(c, a, id, &pickd, 1, NULL);
        if (o.ok) {
          out->target = pickd;
          return 1;
        }
      }
      continue;
    }
    if (ab->target == TARGET_AREA) {
      if (!(ab->range > 0)) {
        Actor *tg[MAX_ACTORS];
        int n = combat_area_targets_for(c, a, id, apos(a), tg), k, m = 0;
        for (k = 0; k < n; k++) if (tg[k] != a) m++;
        if (m && !((a->used_b >> id) & 1)) {
          a->used_b |= (uint64_t)1 << id;
          o = combat_use_ability(c, a, id, NULL, 0, NULL);
          if (o.ok) return 1;
        }
        continue;
      } else {
        Pos best = mkpos(0, 0);
        int found = 0, k, rad = ab->radius ? ab->radius : 1;
        double bs = 0;
        for (k = 0; k < nf; k++) {
          Actor *f = foes[k], *hit[MAX_ACTORS];
          int nh, h, en = 0, al = 0;
          double s;
          if (cheb(apos(a), apos(f)) > ab->range || !grid_los(c->field.grid, apos(a), apos(f)).clear) continue;
          nh = combat_area_targets(c, apos(f), rad, hit);
          for (h = 0; h < nh; h++) {
            if (hit[h]->side != a->side) en++;
            else al++;
          }
          s = en * 2 - al * 4;
          if (s > bs) {
            bs = s;
            best = apos(f);
            found = 1;
          }
        }
        if (found) {
          o = combat_use_ability(c, a, id, NULL, 0, &best);
          if (o.ok) return 1;
        }
        continue;
      }
    }
    if (ab->target == TARGET_NONE && nf && !((a->used_b >> id) & 1)) {
      a->used_b |= (uint64_t)1 << id;
      o = combat_use_ability(c, a, id, foes, nf, NULL);
      if (o.ok) return 1;
    }
  }
  return 0;
}

/* Najemnik pod AI: najpierw ratuje umierających i wstaje z ziemi. */
static int pc_support(Combat *c, Actor *a, Actor **foes, int nf, AiAction *out) {
  TurnInfo *t = c->turn;
  Actor *dying[MAX_ACTORS], *adjacent = NULL;
  int nd = 0, i;
  ActionOutcome o;
  for (i = 0; i < *c->field.n_actors; i++) {
    Actor *p = c->field.actors[i];
    if (p->side == SIDE_PC && p->state == AST_DOWN && p->ch->cond[COND_DYING]) dying[nd++] = p;
  }
  for (i = 0; i < nd && !adjacent; i++) if (cheb(apos(a), apos(dying[i])) <= 1) adjacent = dying[i];
  if (adjacent && t->actions >= 2) {
    o = combat_use_ability(c, a, ABIL_FIRST_AID, &adjacent, 1, NULL);
    if (o.ok) {
      out->type = AI_ACT_ABILITY;
      out->ability = ABIL_FIRST_AID;
      out->target = adjacent;
      return 1;
    }
  }
  if (a->ch->cond[COND_PRONE]) {
    Actor *self = a;
    o = combat_use_ability(c, a, ABIL_STAND, &self, 1, NULL);
    if (o.ok) {
      out->type = AI_ACT_ABILITY;
      out->ability = ABIL_STAND;
      out->target = a;
      return 1;
    }
  }
  if (nd && t->actions >= 3) {
    int near = 0;
    for (i = 0; i < nf; i++) if (cheb(apos(foes[i]), apos(a)) <= 1) near = 1;
    if (!near) {
      static Search res;
      Pos cell;
      double cost;
      int sp;
      if (combat_approach_cell(c, a, dying[0], t->actions - 1, NULL, &cell, &cost, &res, &sp) && !(cell.gx == a->gx && cell.gy == a->gy)) {
        o = combat_stride(c, a, cell);
        if (o.ok) {
          out->type = AI_ACT_MOVE;
          out->target = NULL;
          return 1;
        }
      }
    }
  }
  return 0;
}

int ai_step(Combat *c, Actor *a, AiAction *out) {
  TurnInfo *t = c->turn;
  Actor *foes[MAX_ACTORS], *tgt;
  int nf, flee;
  NormWeapon w;
  StrikeInfo si;
  if (!t || t->actor != a || t->actions <= 0 || !c->active || a->state != AST_UP) return 0;
  nf = combat_foes_of(c, a, foes);
  if (!nf) return 0;
  if (a->side == SIDE_PC && pc_support(c, a, foes, nf, out)) return 1;
  if (ai_ability(c, a, foes, nf, out)) return 1;
  pick_weapon(c, a, foes, nf, &w);
  flee = is_fleeing(a);
  if (flee && ai_move(c, a, &w, foes, nf)) {
    out->type = AI_ACT_MOVE;
    out->target = NULL;
    return 1;
  }
  tgt = best_target(c, a, &w, foes, nf, &si);
  if (tgt && !flee && (a->map_n < 2 || si.hit >= 0.3)) {
    ActionOutcome o = combat_strike(c, a, tgt, &w);
    if (o.ok) {
      out->type = AI_ACT_STRIKE;
      out->target = tgt;
      return 1;
    }
  }
  if (ai_move(c, a, &w, foes, nf)) {
    out->type = AI_ACT_MOVE;
    out->target = NULL;
    return 1;
  }
  if (!a->ch->cond[COND_IN_COVER] && (grid_has_low_cover_near(c->field.grid, apos(a)) || w.range > 0) && t->actions >= 1) {
    ActionOutcome o = combat_take_cover(c, a);
    if (o.ok) {
      out->type = AI_ACT_COVER;
      out->target = NULL;
      return 1;
    }
  }
  return 0;
}

int run_ai_turn(Combat *c, Actor *a, AiAction *done, int max) {
  int n = 0, guard;
  AiAction tmp;
  for (guard = 0; guard < 10; guard++) {
    if (!ai_step(c, a, n < max ? &done[n] : &tmp)) break;
    n++;
  }
  if (c->turn && c->turn->actor == a) c->turn->actions = 0;
  return n;
}
