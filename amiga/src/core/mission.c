/* Misja taktyczna. Port src/core/tactical/mission.ts (bez zapisu stanu - snapshot/restore są w planie). */
#include <string.h>
#include "combat.h"

/* ---------------------------------------------------------------- sygnały */
static void memit(Mission *m, MissionSignal *s) {
  int i;
  for (i = 0; i < m->n_listeners; i++) m->listeners[i](m->listener_ctx[i], s);
}
static void msig(MissionSignal *s, int kind) {
  memset(s, 0, sizeof *s);
  s->kind = (uint8_t)kind;
}
static void emit_simple(Mission *m, int kind) {
  MissionSignal s;
  msig(&s, kind);
  memit(m, &s);
}
static void emit_objectives(Mission *m) { emit_simple(m, MSIG_OBJECTIVE); }
void mission_on(Mission *m, MissionListener fn, void *ctx) {
  if (m->n_listeners < 4) {
    m->listeners[m->n_listeners] = fn;
    m->listener_ctx[m->n_listeners] = ctx;
    m->n_listeners++;
  }
}

/* ---------------------------------------------------------------- zapytania */
static int level_of(const Mission *m) { return m->contract.level ? m->contract.level : 1; }
int mission_in_combat(const Mission *m) { return m->mode == MODE_COMBAT; }
MissionThing *mission_thing_at(Mission *m, int gx, int gy) {
  int i;
  for (i = 0; i < m->n_things; i++)
    if (m->things[i].gx == gx && m->things[i].gy == gy && !m->things[i].done) return &m->things[i];
  return NULL;
}
static Actor *actor_at(Mission *m, int gx, int gy) { return combat_actor_at(&m->combat, gx, gy); }
static int neutral_at(const Mission *m, int gx, int gy, const Actor *except) {
  int i;
  for (i = 0; i < m->n_neutral; i++)
    if (m->neutral[i] != except && m->neutral[i]->gx == gx && m->neutral[i]->gy == gy) return 1;
  return 0;
}
int mission_is_visible(const Mission *m, Pos p) { return m->vis[gidx(p.gx, p.gy)] != 0; }

void mission_update_visibility(Mission *m) {
  static int16_t cells[GRID_N];
  int i, k, n;
  memset(m->vis, 0, sizeof m->vis);
  for (i = 0; i < m->n_pcs; i++) {
    if (m->pcs[i]->state == AST_DEAD) continue;
    n = grid_visible(&m->map.grid, apos(m->pcs[i]), SIGHT_PC_R, cells);
    for (k = 0; k < n; k++) m->vis[cells[k]] = m->explored[cells[k]] = 1;
  }
  for (i = 0; i < m->n_neutral; i++) {
    if (!m->neutral[i]->following) continue;
    n = grid_visible(&m->map.grid, apos(m->neutral[i]), SIGHT_NEUTRAL_R, cells);
    for (k = 0; k < n; k++) m->vis[cells[k]] = m->explored[cells[k]] = 1;
  }
  emit_simple(m, MSIG_VISIBILITY);
}

/* ---------------------------------------------------------------- rozmieszczanie */
static Actor *make_actor(Mission *m, Character *ch, int side, Pos pos, EnemyGroup *grp) {
  Actor *a = &m->actor_store[m->n_actors];
  memset(a, 0, sizeof *a);
  a->ch = ch;
  a->side = (uint8_t)side;
  a->gx = pos.gx;
  a->gy = pos.gy;
  a->group = grp;
  if (side == SIDE_ENEMY) a->state = is_alive(ch) ? AST_UP : AST_DEAD;
  else a->state = is_down(ch) ? AST_DOWN : is_alive(ch) ? AST_UP : AST_DEAD;
  m->actors[m->n_actors++] = a;
  return a;
}

static int cell_ok(Mission *m, Pos c, int solid) {
  int i;
  if (!grid_free(&m->map.grid, c.gx, c.gy) || in_entry_zone(&m->map.entry, c)) return 0;
  for (i = 0; i < m->n_actors; i++) if (m->actors[i]->gx == c.gx && m->actors[i]->gy == c.gy) return 0;
  for (i = 0; i < m->n_things; i++) if (m->things[i].gx == c.gx && m->things[i].gy == c.gy) return 0;
  for (i = 0; i < m->map.n_finds; i++) if (m->map.finds[i].gx == c.gx && m->map.finds[i].gy == c.gy) return 0;
  if (!solid) return 1;
  return grid_free(&m->map.grid, c.gx + 1, c.gy) && grid_free(&m->map.grid, c.gx - 1, c.gy) && grid_free(&m->map.grid, c.gx, c.gy + 1) &&
         grid_free(&m->map.grid, c.gx, c.gy - 1);
}

typedef int (*MPred)(Mission *m, const ReachCell *r, void *ctx);
static int pick_cell(Mission *m, MPred pred, void *ctx, int solid, Pos *out) {
  static int16_t cand[GRID_N];
  int i, n = 0;
  for (i = 0; i < m->map.n_reach; i++) {
    const ReachCell *r = &m->map.reach[i];
    if (pred(m, r, ctx) && cell_ok(m, mkpos(r->gx, r->gy), solid)) cand[n++] = (int16_t)i;
  }
  if (!n) return 0;
  i = cand[(int)floor(rng_f(m->rng) * n)];
  *out = mkpos(m->map.reach[i].gx, m->map.reach[i].gy);
  return 1;
}
typedef struct { Pos p; double r0, r1; } RingCtx;
static int p_ring(Mission *m, const ReachCell *r, void *c) {
  RingCtx *k = (RingCtx *)c;
  double d = js_hypot(r->gx - k->p.gx, r->gy - k->p.gy);
  (void)m;
  return d >= k->r0 && d <= k->r1;
}
static int free_cell(Mission *m, Pos p, double r0, double r1, int solid, Pos *out) {
  RingCtx k;
  k.p = p;
  k.r0 = r0;
  k.r1 = r1;
  return pick_cell(m, p_ring, &k, solid, out);
}
typedef struct { double far; } NestCtx;
static int p_nest(Mission *m, const ReachCell *r, void *c) {
  int i;
  if (!(r->d >= ((NestCtx *)c)->far)) return 0;
  for (i = 0; i < m->n_nests; i++) if (cheb(mkpos(m->things[m->nests[i]].gx, m->things[m->nests[i]].gy), mkpos(r->gx, r->gy)) < 7) return 0;
  return 1;
}
static int p_d8(Mission *m, const ReachCell *r, void *c) { (void)m; (void)c; return r->d >= 8; }

static MissionThing *add_thing(Mission *m, int kind, Pos p) {
  MissionThing *t = &m->things[m->n_things++];
  memset(t, 0, sizeof *t);
  t->kind = (uint8_t)kind;
  t->gx = p.gx;
  t->gy = p.gy;
  t->item = ITEM_NONE;
  return t;
}

MissionThing *mission_add_locked_door(Mission *m, int gx, int gy, uint8_t quality) {
  MissionThing *t = add_thing(m, TH_DOOR, mkpos(gx, gy));
  t->quality = quality;
  t->has_lock = 1;
  lock_state(&t->lock, quality);
  grid_set(&m->map.grid, gx, gy, CELL_HIGH);
  return t;
}
MissionThing *mission_add_device(Mission *m, int gx, int gy, uint8_t device) {
  MissionThing *t = add_thing(m, TH_DEVICE, mkpos(gx, gy));
  t->device = device;
  t->has_lock = 1;
  device_state(&t->lock, device, level_of(m));
  return t;
}

static Character *new_char(Mission *m) { return &m->char_store[m->n_chars++]; }

static double cmp_level_desc(void *ctx, const void *p, const void *q) { (void)ctx; return ((const Actor *)q)->ch->level - ((const Actor *)p)->ch->level; }

static Actor *populate(Mission *m, Character **party, int n_party) {
  static const int SLOTS[4] = {5, 6, 9, 10};
  static const char *const NAMES[5] = {"Osadnik", "Osadniczka", "Starzec", "Pasterz", "Kowalka"};
  Actor *target = NULL;
  int i, k, placed = 0;
  Pos oc;
  for (i = 0; i < n_party && placed < 4; i++) {
    Actor *a;
    if (!is_alive(party[i])) continue;
    a = make_actor(m, party[i], SIDE_PC, entry_cell(&m->map.entry, SLOTS[placed]), NULL);
    m->pcs[m->n_pcs++] = a;
    placed++;
  }
  for (i = 0; i < m->map.n_groups; i++) {
    const GroupSpawn *g = &m->map.groups[i];
    EnemyGroup *grp = &m->group_store[i];
    memset(grp, 0, sizeof *grp);
    grp->idx = (uint8_t)i;
    grp->center = mkpos(g->center.gx, g->center.gy);
    for (k = 0; k < g->n; k++) {
      Character *ch = new_char(m);
      Actor *a;
      char_create_enemy(ch, g->members[k], 0);
      a = make_actor(m, ch, SIDE_ENEMY, g->cells[k], grp);
      if (g->roam) {
        a->has_roam = 1;
        a->roam_home = apos(a);
        a->roam_has_dest = 0;
      }
      grp->actors[grp->n++] = a;
      m->enemies[m->n_enemies++] = a;
    }
    m->groups[m->n_groups++] = grp;
  }
  if ((m->obj_type == OBJ_HUNT || m->obj_type == OBJ_BOSS) && m->n_enemies) {
    for (i = 0; i < m->n_enemies && !target; i++) {
      const Character *ch = m->enemies[i]->ch;
      if (ENEMY_DEFS[ch->template_id].ai == AI_BOSS || ch->template_id == ENEMY_KOSTUCHA) target = m->enemies[i];
    }
    if (!target) {
      Actor *sorted[MAX_ACTORS];
      memcpy(sorted, m->enemies, sizeof(Actor *) * (size_t)m->n_enemies);
      js_sort_ptr((void **)sorted, m->n_enemies, cmp_level_desc, NULL);
      target = sorted[0];
    }
    target->is_target = 1;
  }
  for (i = 0; i < m->map.n_crates; i++) add_thing(m, TH_CRATE, m->map.crates[i]);
  oc = mkpos(m->map.obj.gx, m->map.obj.gy);
  if (m->map.has_obj && m->obj_type == OBJ_RETRIEVE) {
    MissionThing *t = add_thing(m, TH_ITEM, oc);
    t->item = m->contract.item != ITEM_NONE ? m->contract.item : ITEM_SCRAP_METAL;
    m->item_thing = (int)(t - m->things);
  } else if (m->map.has_obj && m->obj_type == OBJ_RESCUE) {
    Character *ch = new_char(m);
    Actor *a;
    MissionThing *t;
    char_create(ch, "Jeniec", ANC_HUMAN, CLASS_SCAVENGER, 1, NONE8);
    ch->max_hp = 10;
    ch->hp = 10;
    a = make_actor(m, ch, SIDE_NEUTRAL, oc, NULL);
    m->neutral[m->n_neutral++] = a;
    t = add_thing(m, TH_CAPTIVE, oc);
    t->actor = a;
    m->captive = (int)(t - m->things);
  } else if (m->map.has_obj && m->obj_type == OBJ_HACK) {
    Pos c;
    MissionThing *t;
    if (cell_ok(m, oc, 1)) c = oc;
    else if (!free_cell(m, oc, 1, 4, 1, &c)) c = oc;
    t = mission_add_device(m, c.gx, c.gy, DEVICE_SERVER);
    t->objective = 1;
    m->obj_device = (int)(t - m->things);
    grid_set(&m->map.grid, c.gx, c.gy, CELL_LOW);
  } else if (m->map.has_obj && m->obj_type == OBJ_LIBERATE) {
    int n = 3 + (level_of(m) >= 4 ? 1 : 0);
    for (i = 0; i < n; i++) {
      Pos c;
      Character *ch;
      Actor *a;
      MissionThing *t;
      if (i == 0) c = oc;
      else if (!free_cell(m, oc, 1.5, 5, 0, &c)) break;
      ch = new_char(m);
      char_create(ch, NAMES[i % 5], ANC_HUMAN, CLASS_SCAVENGER, 1, NONE8);
      ch->max_hp = 10;
      ch->hp = 10;
      a = make_actor(m, ch, SIDE_NEUTRAL, c, NULL);
      m->neutral[m->n_neutral++] = a;
      t = add_thing(m, TH_CAPTIVE, c);
      t->actor = a;
      t->objective = 1;
      m->settlers[m->n_settlers++] = (int)(t - m->things);
    }
  } else if (m->obj_type == OBJ_PURGE) {
    int n = 2 + (level_of(m) >= 3 ? 1 : 0);
    NestCtx nc;
    nc.far = m->map.max_d * 0.4;
    for (i = 0; i < n; i++) {
      Pos c;
      int ok = 0;
      MissionThing *t;
      if (i == 0 && m->map.has_obj) ok = free_cell(m, oc, 1, 4, 1, &c);
      if (!ok) ok = pick_cell(m, p_nest, &nc, 1, &c);
      if (!ok) ok = pick_cell(m, p_d8, NULL, 1, &c);
      if (!ok) break;
      t = &m->things[m->n_things];
      memset(t, 0, sizeof *t);
      t->kind = TH_NEST;
      t->gx = c.gx;
      t->gy = c.gy;
      t->item = ITEM_NONE;
      t->objective = 1;
      grid_set(&m->map.grid, c.gx, c.gy, CELL_LOW);
      m->nests[m->n_nests++] = m->n_things;
      m->n_things++;
    }
  }
  return target;
}

/* ---------------------------------------------------------------- słuchacz walki */
static void on_combat_end(Mission *m, int outcome);
static void on_combat(void *ctx, const CombatSignal *s) {
  Mission *m = (Mission *)ctx;
  if (s->kind == SIG_STATE && s->actor->side == SIDE_ENEMY && s->to == AST_DEAD) {
    int i, known = 0;
    for (i = 0; i < m->n_killed; i++) if (m->killed[i] == s->actor->ch) known = 1;
    if (known) return;
    m->killed[m->n_killed++] = s->actor->ch;
    emit_objectives(m);
    mission_check_objective(m);
  } else if (s->kind == SIG_JOIN || s->kind == SIG_MOVE) {
    mission_update_visibility(m);
  } else if (s->kind == SIG_ROUND && m->mode == MODE_COMBAT) {
    mission_advance_world(m, NULL);
    combat_engage_visible(&m->combat);
  } else if (s->kind == SIG_END) {
    on_combat_end(m, s->outcome);
  }
}
static int bf_blocked(void *ctx, int gx, int gy) { return neutral_at((Mission *)ctx, gx, gy, NULL); }
static int bf_in_sight(void *ctx, const Actor *a) { return mission_is_visible((Mission *)ctx, apos(a)); }
static int bf_free(void *ctx) { return ((Mission *)ctx)->mode == MODE_EXPLORE; }

void mission_init(Mission *m, const MissionContract *contract, Character **party, int n_party, Rng *rng) {
  MapSpec spec;
  Battlefield f;
  int i;
  memset(m, 0, sizeof *m);
  m->contract = *contract;
  m->obj_type = contract->type;
  m->rng = rng;
  m->party = party;
  m->n_party = n_party;
  m->item_thing = m->captive = m->obj_device = -1;
  m->next_wave = 3;
  m->mode = MODE_EXPLORE;
  spec.id = contract->id;
  spec.biome = contract->biome;
  spec.level = contract->level;
  spec.type = contract->type;
  generate_map(&spec, contract->enemies, contract->n_enemies, &m->map);
  for (i = 0; i < m->map.n_finds; i++) {
    m->finds[i].f = m->map.finds[i];
    m->finds[i].found = !m->map.finds[i].hidden;
  }
  m->n_finds = m->map.n_finds;
  m->target = populate(m, party, n_party);
  memset(&f, 0, sizeof f);
  f.grid = &m->map.grid;
  f.actors = m->actors;
  f.n_actors = &m->n_actors;
  f.groups = m->groups;
  f.n_groups = &m->n_groups;
  f.target = m->target;
  f.is_blocked = bf_blocked;
  f.in_sight = bf_in_sight;
  f.free_actions = bf_free;
  f.ctx = m;
  combat_init(&m->combat, &f, rng);
  combat_on(&m->combat, on_combat, m);
  mission_update_visibility(m);
}

/* ---------------------------------------------------------------- ruch eksploracyjny */
int mission_move_range(Mission *m, const Actor *sel, int group) {
  int i, best = -1;
  if (group) {
    for (i = 0; i < m->n_pcs; i++) {
      int s;
      if (m->pcs[i]->state != AST_UP) continue;
      s = combat_speed_of(m->pcs[i]);
      if (best < 0 || s < best) best = s;
    }
    if (best >= 0) return best;
  }
  return combat_speed_of(sel);
}
static int pass_pcs(void *ctx, int gx, int gy) {
  Actor *a = actor_at((Mission *)ctx, gx, gy);
  return !a || a->side == SIDE_PC;
}

static int nearest_free(Mission *m, Pos t, const Actor *who, const uint8_t *taken, Pos *out) {
  int x, y, found = 0;
  double bd = 1e9;
  for (y = t.gy - 4; y <= t.gy + 4; y++) {
    for (x = t.gx - 4; x <= t.gx + 4; x++) {
      Actor *a;
      MissionThing *th;
      double d;
      if (!grid_free(&m->map.grid, x, y) || (taken && taken[gidx(x, y)])) continue;
      a = actor_at(m, x, y);
      th = mission_thing_at(m, x, y);
      if ((a && a != who) || (th && th->kind == TH_CRATE)) continue;
      if (neutral_at(m, x, y, who)) continue;
      d = js_hypot(x - t.gx, y - t.gy) + (th ? 0.2 : 0);
      if (d < bd) {
        bd = d;
        *out = mkpos(x, y);
        found = 1;
      }
    }
  }
  return found;
}

static int clip_path(Mission *m, const Pos *path, int n, const Actor *from, double max, int solo) {
  double c = 0;
  int px = from->gx, py = from->gy, k = 0, i;
  for (i = 0; i < n; i++) {
    c += path[i].gx != px && path[i].gy != py ? 1.5 : 1;
    if (c > max + 1e-6) break;
    k++;
    px = path[i].gx;
    py = path[i].gy;
  }
  while (k > 0) {
    Pos t = path[k - 1];
    Actor *o = actor_at(m, t.gx, t.gy);
    MissionThing *th = mission_thing_at(m, t.gx, t.gy);
    int ok = (!o || o == from || (o->side == SIDE_PC && !solo)) && !(th && th->kind == TH_CRATE) && !neutral_at(m, t.gx, t.gy, NULL);
    if (ok) break;
    k--;
  }
  return k;
}

static ActorPath *paths_slot(ExploreResult *out, Actor *a) {
  int i;
  for (i = 0; i < out->n; i++) if (out->paths[i].actor == a) return &out->paths[i];
  if (out->n >= MAX_ACTORS) return NULL;
  out->paths[out->n].actor = a;
  out->paths[out->n].n = 0;
  return &out->paths[out->n++];
}

static int follow_neutral(Mission *m, const Actor *lead, Pos *path) {
  static uint8_t taken[GRID_N];
  MissionThing *cap;
  Actor *n;
  Pos c;
  int i, len;
  if (m->captive < 0) return 0;
  cap = &m->things[m->captive];
  n = cap->actor;
  if (!cap->freed || !n) return 0;
  memset(taken, 0, sizeof taken);
  for (i = 0; i < m->n_pcs; i++) taken[gidx(m->pcs[i]->gx, m->pcs[i]->gy)] = 1;
  if (!nearest_free(m, apos(lead), n, taken, &c)) return 0;
  len = grid_find_path(&m->map.grid, apos(n), c, NULL, NULL, 60, path, MAX_PATH);
  if (len <= 0) return 0;
  n->gx = c.gx;
  n->gy = c.gy;
  mission_update_visibility(m);
  return len;
}

void mission_explore_move(Mission *m, Actor *sel, Pos target, int group, ExploreResult *out) {
  static Pos full[MAX_PATH], pp[MAX_PATH];
  static uint8_t taken[GRID_N];
  Pos dest, end;
  int nfull, n, i, spotted = 0, walked = 0;
  Actor *movers[MAX_PARTY];
  Pos form[MAX_PARTY];
  int nform = 0;
  ActorPath *ap;
  memset(out, 0, sizeof *out);
  if (m->mode != MODE_EXPLORE || sel->state != AST_UP) return;
  if (!nearest_free(m, target, sel, NULL, &dest)) return;
  nfull = grid_find_path(&m->map.grid, apos(sel), dest, pass_pcs, m, 80, full, MAX_PATH);
  if (nfull <= 0) return;
  n = clip_path(m, full, nfull, sel, mission_move_range(m, sel, group), !group);
  if (!n) return;
  out->ok = 1;
  end = full[n - 1];
  memset(taken, 0, sizeof taken);
  taken[gidx(end.gx, end.gy)] = 1;
  if (group) {
    for (i = 0; i < m->n_pcs; i++) {
      Actor *p = m->pcs[i];
      Pos c;
      if (p == sel || p->state != AST_UP) continue;
      if (nearest_free(m, end, p, taken, &c)) {
        taken[gidx(c.gx, c.gy)] = 1;
        movers[nform] = p;
        form[nform] = c;
        nform++;
      }
    }
  }
  ap = paths_slot(out, sel);
  for (i = 0; i < n; i++) {
    sel->gx = full[i].gx;
    sel->gy = full[i].gy;
    if (ap) ap->path[ap->n++] = full[i];
    walked++;
    m->steps++;
    mission_update_visibility(m);
    mission_check_finds(m);
    if (mission_check_spotting(m)) {
      spotted = 1;
      break;
    }
  }
  for (i = 0; i < nform; i++) {
    Actor *p = movers[i];
    int len = grid_find_path(&m->map.grid, apos(p), form[i], pass_pcs, m, 80, pp, MAX_PATH), k;
    Pos last;
    if (len <= 0) continue;
    if (spotted && len > walked) len = walked;
    if (!len) continue;
    last = pp[len - 1];
    if (actor_at(m, last.gx, last.gy)) continue;
    p->gx = last.gx;
    p->gy = last.gy;
    ap = paths_slot(out, p);
    if (ap) {
      ap->n = 0;
      for (k = 0; k < len; k++) ap->path[ap->n++] = pp[k];
    }
  }
  mission_update_visibility(m);
  if (m->mode == MODE_EXPLORE) {
    int len;
    mission_advance_world(m, out);
    mission_check_finds(m);
    mission_check_spotting(m);
    len = follow_neutral(m, sel, pp);
    if (len > 0 && m->captive >= 0 && m->things[m->captive].actor) {
      int k;
      ap = paths_slot(out, m->things[m->captive].actor);
      if (ap) {
        ap->n = 0;
        for (k = 0; k < len; k++) ap->path[ap->n++] = pp[k];
      }
    }
  }
  out->combat = mission_in_combat(m);
}

/* ---------------------------------------------------------------- znaleziska */
static const uint8_t FIND_MED[3] = {ITEM_BANDAGE, ITEM_STIMPAK, ITEM_MEDKIT};
static const uint8_t FIND_TECH_ITEMS[5] = {ITEM_CIRCUIT, ITEM_BATTERY, ITEM_MEMORY_CARD, ITEM_RADIO_PART, ITEM_VACUUM_TUBE};

static void loot_push(Mission *m, uint8_t id) {
  if (m->n_loot < MAX_LOOT) {
    m->loot[m->n_loot].id = id;
    m->loot[m->n_loot].qty = 1;
    m->n_loot++;
  }
}

static double cmp_perception_desc(void *ctx, const void *p, const void *q) {
  (void)ctx;
  return get_stat(((const Actor *)q)->ch, STAT_PERCEPTION, 0) - get_stat(((const Actor *)p)->ch, STAT_PERCEPTION, 0);
}

void mission_check_finds(Mission *m) {
  Actor *ups[MAX_PARTY];
  int nu = 0, i, k, dc;
  if (m->mode != MODE_EXPLORE) return;
  for (i = 0; i < m->n_pcs; i++) if (m->pcs[i]->state == AST_UP) ups[nu++] = m->pcs[i];
  if (!nu) return;
  dc = dc_for_level(level_of(m));
  for (i = 0; i < m->n_finds; i++) {
    MissionFind *f = &m->finds[i];
    Pos fp = mkpos(f->f.gx, f->f.gy);
    Actor *near[MAX_PARTY], *taker = NULL;
    int nn = 0, scrap, base;
    MissionSignal s;
    ItemInst got[1];
    int ngot = 0;
    if (f->taken) continue;
    for (k = 0; k < nu; k++) if (cheb(apos(ups[k]), fp) <= 2) near[nn++] = ups[k];
    if (!nn) continue;
    if (!f->found) {
      CheckResult r;
      if (f->tried) continue;
      f->tried = 1;
      js_sort_ptr((void **)near, nn, cmp_perception_desc, NULL);
      check_by(near[0]->ch, get_stat(near[0]->ch, STAT_PERCEPTION, 0), dc, m->rng, 0, &r);
      if (r.degree >= 2) {
        f->found = 1;
        msig(&s, MSIG_DISCOVER);
        s.find = f;
        s.by = near[0];
        s.roll = &r;
        memit(m, &s);
      }
      continue;
    }
    for (k = 0; k < nu && !taker; k++) if (cheb(apos(ups[k]), fp) <= 1) taker = ups[k];
    if (!taker) continue;
    f->taken = 1;
    base = f->f.kind == FIND_SCRAP ? 10 : f->f.kind == FIND_CACHE ? 6 : 2;
    scrap = (int)js_round(base + rng_f(m->rng) * 8 * (1 + level_of(m) * 0.4));
    m->scrap += scrap;
    if (f->f.kind != FIND_SCRAP) {
      uint8_t id = ITEM_SCRAP_METAL;
      if (f->f.kind == FIND_CACHE) {
        uint8_t any[ITEM_COUNT];
        int na = 0, j;
        (void)floor(rng_f(m->rng) * 1); /* pick z ['@any'] */
        for (j = 0; j < ITEM_COUNT; j++) {
          uint8_t t = ITEM_DEFS[j].type;
          if ((t == ITYPE_CONSUMABLE || t == ITYPE_TECH || t == ITYPE_JUNK) && ITEM_DEFS[j].level <= level_of(m) + 1) any[na++] = (uint8_t)j;
        }
        if (na) id = any[(int)floor(rng_f(m->rng) * na)];
      } else if (f->f.kind == FIND_MEDICAL) id = FIND_MED[(int)floor(rng_f(m->rng) * 3)];
      else if (f->f.kind == FIND_TECH) id = FIND_TECH_ITEMS[(int)floor(rng_f(m->rng) * 5)];
      else if (f->f.kind == FIND_FOOD) { (void)rng_f(m->rng); id = ITEM_CANNED_FOOD; }
      else { (void)rng_f(m->rng); id = ITEM_AMMO_BOX; }
      loot_push(m, id);
      got[0].id = id;
      got[0].qty = 1;
      ngot = 1;
    }
    msig(&s, MSIG_PICKUP);
    s.find = f;
    s.by = taker;
    s.scrap = scrap;
    s.items = got;
    s.n_items = ngot;
    memit(m, &s);
  }
}

/* ---------------------------------------------------------------- wykrywanie */
static int group_alive(const EnemyGroup *g) {
  int k;
  for (k = 0; k < g->n; k++) if (g->actors[k]->state != AST_DEAD) return 1;
  return 0;
}

static void check_wave(Mission *m) {
  int i;
  if (m->obj_type != OBJ_DEFEND || m->steps < m->next_wave) return;
  for (i = 0; i < m->n_groups; i++) {
    EnemyGroup *g = m->groups[i];
    if (!g->alerted && group_alive(g)) {
      m->wave++;
      g->alerted = 1;
      m->next_wave = m->steps + 10;
      return;
    }
  }
}

EnemyGroup *mission_check_spotting(Mission *m) {
  Actor *ups[MAX_PARTY];
  int nu = 0, i, k, j;
  if (m->mode != MODE_EXPLORE) return NULL;
  check_wave(m);
  for (i = 0; i < m->n_pcs; i++) if (m->pcs[i]->state == AST_UP) ups[nu++] = m->pcs[i];
  if (!nu) return NULL;
  for (i = 0; i < m->n_groups; i++) {
    EnemyGroup *g = m->groups[i];
    Actor *seers[MAX_GROUP_MEMBERS], *seer = NULL;
    int ns = 0, close;
    double best = 1e300;
    MissionSignal s;
    for (k = 0; k < g->n; k++) if (g->actors[k]->state == AST_UP && mission_is_visible(m, apos(g->actors[k]))) seers[ns++] = g->actors[k];
    for (k = 0; k < ns; k++)
      for (j = 0; j < nu; j++) {
        double d = pdist(apos(seers[k]), apos(ups[j]));
        if (d < best && grid_los(&m->map.grid, apos(seers[k]), apos(ups[j])).clear) {
          best = d;
          seer = seers[k];
        }
      }
    if (!seer) continue;
    close = best <= 3.2;
    if (!g->alerted && !close) {
      int per = -9, dc = -1000;
      CheckResult r;
      if (m->steps < g->next_notice) continue;
      g->next_notice = (int16_t)(m->steps + 3);
      for (k = 0; k < ns; k++) {
        int p = get_stat(seers[k]->ch, STAT_PERCEPTION, 0);
        if (p > per) per = p;
      }
      for (j = 0; j < nu; j++) {
        int st = get_stat(ups[j]->ch, SKILL_STEALTH, 0);
        if (st > dc) dc = st;
      }
      check(m->rng, per, 10 + dc, 0, &r);
      if (r.degree < 2) continue;
    }
    msig(&s, MSIG_SPOTTED);
    s.group = g;
    s.by = seer;
    s.close = close;
    memit(m, &s);
    mission_start_combat(m, g, 0);
    return g;
  }
  return NULL;
}

void mission_start_combat(Mission *m, EnemyGroup *g, int ambush) {
  Actor *foes[MAX_ACTORS];
  int n = 0, i;
  m->mode = MODE_COMBAT;
  for (i = 0; i < m->n_enemies; i++)
    if (m->enemies[i]->state == AST_UP && mission_is_visible(m, apos(m->enemies[i]))) foes[n++] = m->enemies[i];
  if (!n)
    for (i = 0; i < g->n; i++) if (g->actors[i]->state != AST_DEAD) foes[n++] = g->actors[i];
  g->alerted = 1;
  combat_start(&m->combat, foes, n, ambush);
  mission_update_visibility(m);
}

/* ---------------------------------------------------------------- świat poza walką */
typedef struct { Mission *m; const Actor *e; Pos goal; } PassFor;
static int pass_for(void *ctx, int gx, int gy) {
  PassFor *p = (PassFor *)ctx;
  return (gx == p->goal.gx && gy == p->goal.gy) || (gx == p->e->gx && gy == p->e->gy) || !combat_occupied(&p->m->combat, gx, gy);
}
static int clip_walk(Mission *m, const Pos *path, int n, int max, int stop_on_sight, Pos *out) {
  int k = 0, i;
  for (i = 0; i < n; i++) {
    if (k >= max || combat_occupied(&m->combat, path[i].gx, path[i].gy)) break;
    out[k++] = path[i];
    if (stop_on_sight && mission_is_visible(m, path[i])) break;
  }
  while (k && mission_thing_at(m, out[k - 1].gx, out[k - 1].gy)) k--;
  return k;
}
static int roam_dest(Mission *m, const Actor *e, Pos *out) {
  static int16_t cand[GRID_N];
  Pos h = e->has_roam ? e->roam_home : apos(e);
  int i, n = 0;
  for (i = 0; i < m->map.n_reach; i++) {
    const ReachCell *r = &m->map.reach[i];
    Pos rp = mkpos(r->gx, r->gy);
    if (cheb(rp, h) <= 7 && cheb(rp, apos(e)) >= 2 && grid_free(&m->map.grid, r->gx, r->gy) && !in_entry_zone(&m->map.entry, rp) &&
        !combat_occupied(&m->combat, r->gx, r->gy))
      cand[n++] = (int16_t)i;
  }
  if (!n) return 0;
  i = cand[(int)floor(rng_f(m->rng) * n)];
  *out = mkpos(m->map.reach[i].gx, m->map.reach[i].gy);
  return 1;
}

int mission_advance_world(Mission *m, ExploreResult *out) {
  static Pos full[MAX_PATH], path[MAX_PATH];
  Actor *ups[MAX_PARTY];
  int nu = 0, i, fighting, moved = 0;
  for (i = 0; i < m->n_pcs; i++) if (m->pcs[i]->state == AST_UP) ups[nu++] = m->pcs[i];
  if (!nu || m->mode == MODE_OVER) return 0;
  fighting = mission_in_combat(m);
  for (i = 0; i < m->n_enemies; i++) {
    Actor *e = m->enemies[i];
    int speed, n = 0, nfull, k;
    PassFor pf;
    if (e->state != AST_UP || e->engaged) continue;
    speed = combat_speed_of(e);
    pf.m = m;
    pf.e = e;
    if (e->group && e->group->alerted) {
      Actor *near = ups[0];
      for (k = 1; k < nu; k++) if (pdist(apos(ups[k]), apos(e)) < pdist(apos(near), apos(e))) near = ups[k];
      pf.goal = apos(near);
      nfull = grid_find_path(&m->map.grid, apos(e), apos(near), pass_for, &pf, 240, full, MAX_PATH);
      if (nfull > 1) n = clip_walk(m, full, nfull - 1, fighting ? speed * 2 : speed, 1, path);
    } else if (e->has_roam) {
      if (rng_f(m->rng) < 0.35) continue;
      if (!e->roam_has_dest || (e->roam_dest.gx == e->gx && e->roam_dest.gy == e->gy)) e->roam_has_dest = (uint8_t)roam_dest(m, e, &e->roam_dest);
      if (!e->roam_has_dest) continue;
      pf.goal = e->roam_dest;
      nfull = grid_find_path(&m->map.grid, apos(e), e->roam_dest, pass_for, &pf, 120, full, MAX_PATH);
      if (nfull <= 0) {
        e->roam_has_dest = 0;
        continue;
      }
      n = clip_walk(m, full, nfull, speed < 4 ? speed : 4, fighting, path);
    }
    if (n <= 0) continue;
    if (fighting) combat_relocate(&m->combat, e, path, n);
    else {
      e->gx = path[n - 1].gx;
      e->gy = path[n - 1].gy;
    }
    if (out) {
      ActorPath *ap = paths_slot(out, e);
      if (ap) {
        ap->n = 0;
        for (k = 0; k < n; k++) ap->path[ap->n++] = path[k];
      }
    }
    moved++;
  }
  return moved;
}

void mission_ambush_attack(Mission *m, Actor *a, EnemyGroup *g, CheckResult *out) {
  int k, best = 0;
  for (k = 0; k < g->n; k++) {
    int p;
    if (g->actors[k]->state == AST_DEAD) continue;
    p = get_stat(g->actors[k]->ch, STAT_PERCEPTION, 0);
    if (p > best) best = p;
  }
  check_by(a->ch, get_stat(a->ch, SKILL_STEALTH, 0), 10 + best, m->rng, 0, out);
  mission_start_combat(m, g, out->degree >= 2);
}

static void on_combat_end(Mission *m, int outcome) {
  if (outcome == END_DEFEAT) {
    mission_finish(m, MRES_FAIL);
    return;
  }
  m->mode = MODE_EXPLORE;
  m->steps += 3;
  if (m->obj_type == OBJ_DEFEND) m->next_wave = m->steps + 2;
  emit_objectives(m);
  mission_check_objective(m);
}

/* ---------------------------------------------------------------- interakcje */
static void emit_thing(Mission *m, int kind, MissionThing *th, Actor *by) {
  MissionSignal s;
  msig(&s, kind);
  s.thing = th;
  s.by = by;
  memit(m, &s);
}

static int open_lock(Mission *m, Actor *a, MissionThing *th, uint8_t skill) {
  LockAttempt at;
  MissionSignal s;
  if (th->kind != TH_DOOR || th->done || !th->has_lock) return 0;
  pick_lock(a->ch, &th->lock, skill, m->rng, &at);
  if (at.opened) {
    th->done = 1;
    grid_set(&m->map.grid, th->gx, th->gy, CELL_FREE);
    mission_update_visibility(m);
  }
  msig(&s, MSIG_LOCK);
  s.thing = th;
  s.by = a;
  s.attempt = &at;
  memit(m, &s);
  return 1;
}

static double g_hack_x, g_hack_y;
static double cmp_center_dist(void *ctx, const void *p, const void *q) {
  const EnemyGroup *x = (const EnemyGroup *)p, *y = (const EnemyGroup *)q;
  (void)ctx;
  return js_hypot(x->center.gx - g_hack_x, x->center.gy - g_hack_y) - js_hypot(y->center.gx - g_hack_x, y->center.gy - g_hack_y);
}

static int hack(Mission *m, Actor *a, MissionThing *th, uint8_t skill) {
  LockAttempt at;
  MissionSignal s;
  if (th->kind != TH_DEVICE || th->done || !th->has_lock || th->lock.jammed) return 0;
  hack_device(a->ch, &th->lock, skill, m->rng, &at);
  if (at.opened) th->done = 1;
  if (at.jammed && th->objective && !at.opened) {
    th->lock.jammed = 0;
    th->lock.progress = 0;
  } else if (at.jammed) th->done = 1;
  msig(&s, MSIG_LOCK);
  s.thing = th;
  s.by = a;
  s.attempt = &at;
  s.hack = 1;
  memit(m, &s);
  if (at.opened && th->objective) mission_check_objective(m);
  if (at.alarm && m->mode == MODE_EXPLORE) {
    EnemyGroup *list[MAX_MAP_GROUPS];
    int n = 0, i;
    for (i = 0; i < m->n_groups; i++) if (!m->groups[i]->alerted && group_alive(m->groups[i])) list[n++] = m->groups[i];
    if (n) {
      g_hack_x = th->gx;
      g_hack_y = th->gy;
      js_sort_ptr((void **)list, n, cmp_center_dist, NULL);
      if (js_hypot(list[0]->center.gx - th->gx, list[0]->center.gy - th->gy) <= 16) {
        list[0]->alerted = 1;
        mission_check_spotting(m);
      }
    }
  }
  return 1;
}

static int open_crate(Mission *m, Actor *a, MissionThing *th, uint8_t skill) {
  int dc, improvised, trap = 0, scrap = 0, i;
  CheckResult r;
  MissionSignal s;
  ItemInst items[2];
  int ni = 0;
  if (th->kind != TH_CRATE || th->done) return 0;
  dc = dc_for_level(level_of(m)) + 1;
  th->done = 1;
  improvised = skill == SKILL_THIEVERY && !has_lockpick(a->ch);
  if (improvised) check_by(a->ch, get_stat(a->ch, skill, 0) + IMPROVISED_PENALTY, dc, m->rng, 0, &r);
  else skill_check(a->ch, skill, dc, m->rng, &r);
  if (skill == SKILL_THIEVERY && !improvised && r.degree == 0) {
    for (i = 0; i < a->ch->n_inv; i++) {
      if (a->ch->inv[i].id == ITEM_LOCKPICK) {
        if (--a->ch->inv[i].qty == 0) {
          int k;
          for (k = i; k + 1 < a->ch->n_inv; k++) a->ch->inv[k] = a->ch->inv[k + 1];
          a->ch->n_inv--;
        }
        break;
      }
    }
  }
  if (r.degree == 0) {
    Dice d;
    d.n = 1;
    d.sides = 6;
    d.mod = 0;
    trap = roll(m->rng, d, 0, NULL);
    apply_damage(a->ch, trap, DMG_P, 0);
    combat_sync_all(&m->combat);
  } else if (r.degree == 1) {
    th->tries++;
    th->done = th->tries >= 2;
  } else {
    int n = r.degree == 3 ? 2 : 1;
    uint8_t pool[ITEM_COUNT];
    int np = 0;
    scrap = (int)js_round((8 + rng_f(m->rng) * 14) * (1 + level_of(m) * 0.5) * (r.degree == 3 ? 1.5 : 1));
    m->scrap += scrap;
    for (i = 0; i < ITEM_COUNT; i++) {
      uint8_t t = ITEM_DEFS[i].type;
      if ((t == ITYPE_CONSUMABLE || t == ITYPE_JUNK || t == ITYPE_TECH || t == ITYPE_AMMO) && ITEM_DEFS[i].level <= level_of(m) + 1) pool[np++] = (uint8_t)i;
    }
    for (i = 0; i < n && np; i++) {
      uint8_t id = pool[(int)floor(rng_f(m->rng) * np)];
      loot_push(m, id);
      items[ni].id = id;
      items[ni].qty = 1;
      ni++;
    }
  }
  msig(&s, MSIG_CRATE);
  s.thing = th;
  s.by = a;
  s.roll = &r;
  s.scrap = scrap;
  s.items = items;
  s.n_items = ni;
  s.trap_damage = trap;
  memit(m, &s);
  emit_objectives(m);
  return 1;
}

int mission_interact(Mission *m, Actor *a, MissionThing *th, uint8_t skill) {
  int cost;
  if (th->done || cheb(apos(a), mkpos(th->gx, th->gy)) > 1 || a->state != AST_UP) return 0;
  if ((th->kind == TH_CRATE || th->kind == TH_DOOR || th->kind == TH_DEVICE) && skill == SKILL_NONE) return 0;
  if ((th->kind == TH_DOOR || th->kind == TH_DEVICE) && th->has_lock && th->lock.jammed) return 0;
  cost = (th->kind == TH_DOOR && skill != SKILL_ATHLETICS) || th->kind == TH_DEVICE ? 2 : 1;
  if (m->mode == MODE_COMBAT && !combat_spend_actions(&m->combat, a, cost)) return 0;
  if (th->kind == TH_ITEM) {
    th->done = 1;
    if (m->stage < 1) m->stage = 1;
    loot_push(m, th->item != ITEM_NONE ? th->item : ITEM_SCRAP_METAL);
    emit_thing(m, MSIG_INTERACT, th, a);
    emit_objectives(m);
    return 1;
  }
  if (th->kind == TH_NEST) {
    th->done = 1;
    grid_set(&m->map.grid, th->gx, th->gy, CELL_FREE);
    emit_thing(m, MSIG_INTERACT, th, a);
    emit_objectives(m);
    mission_check_objective(m);
    return 1;
  }
  if (th->kind == TH_CAPTIVE && th->objective) {
    th->done = 1;
    th->freed = 1;
    emit_thing(m, MSIG_INTERACT, th, a);
    mission_update_visibility(m);
    emit_objectives(m);
    mission_check_objective(m);
    return 1;
  }
  if (th->kind == TH_CAPTIVE) {
    th->done = 1;
    th->freed = 1;
    if (th->actor) th->actor->following = 1;
    if (m->stage < 1) m->stage = 1;
    emit_thing(m, MSIG_INTERACT, th, a);
    mission_update_visibility(m);
    emit_objectives(m);
    return 1;
  }
  if (th->kind == TH_DOOR && skill != SKILL_NONE) return open_lock(m, a, th, skill);
  if (th->kind == TH_DEVICE && skill != SKILL_NONE) return hack(m, a, th, skill);
  return skill != SKILL_NONE ? open_crate(m, a, th, skill) : 0;
}

int mission_interact_cell(Mission *m, Actor *a, Pos th, Pos *out) {
  static Search res;
  int dx, dy, found = 0;
  double bc = UNREACHABLE;
  if (cheb(apos(a), th) <= 1) {
    *out = apos(a);
    return 1;
  }
  grid_search(&m->map.grid, apos(a), 80, pass_pcs, m, &res);
  for (dy = -1; dy <= 1; dy++)
    for (dx = -1; dx <= 1; dx++) {
      int x = th.gx + dx, y = th.gy + dy;
      Actor *o;
      double c;
      if ((!dx && !dy) || !grid_free(&m->map.grid, x, y)) continue;
      o = actor_at(m, x, y);
      if ((o && o != a) || mission_thing_at(m, x, y) || neutral_at(m, x, y, NULL)) continue;
      c = res.cost[gidx(x, y)];
      if (c > 0 && c < bc) {
        bc = c;
        *out = mkpos(x, y);
        found = 1;
      }
    }
  return found;
}

/* ---------------------------------------------------------------- cele i ewakuacja */
int mission_objective_done(const Mission *m) { return m->stage >= 1; }
int mission_needs_extraction(const Mission *m) { return m->obj_type == OBJ_RETRIEVE || m->obj_type == OBJ_RESCUE || m->obj_type == OBJ_HACK; }
static int all_dead(const Mission *m) {
  int i;
  for (i = 0; i < m->n_enemies; i++) if (m->enemies[i]->state != AST_DEAD) return 0;
  return 1;
}
static int objective_met(const Mission *m) {
  int i;
  switch (m->obj_type) {
    case OBJ_ELIMINATE:
    case OBJ_DEFEND: return all_dead(m);
    case OBJ_HUNT:
    case OBJ_BOSS: return m->target && m->target->state == AST_DEAD;
    case OBJ_HACK: return m->obj_device >= 0 && m->things[m->obj_device].done;
    case OBJ_LIBERATE:
      if (!all_dead(m)) return 0;
      for (i = 0; i < m->n_settlers; i++) if (!m->things[m->settlers[i]].freed) return 0;
      return 1;
    case OBJ_PURGE:
      if (!all_dead(m)) return 0;
      for (i = 0; i < m->n_nests; i++) if (!m->things[m->nests[i]].done) return 0;
      return 1;
    default: return m->stage >= 1;
  }
}
void mission_check_objective(Mission *m) {
  if (m->stage >= 1 || m->mode == MODE_OVER || !objective_met(m)) return;
  m->stage = 1;
  emit_simple(m, MSIG_COMPLETE);
  emit_objectives(m);
}
int mission_can_extract(Mission *m) {
  int i, any = 0;
  if (m->mode != MODE_EXPLORE || !mission_objective_done(m)) return 0;
  for (i = 0; i < m->n_pcs; i++) {
    if (m->pcs[i]->state != AST_UP) continue;
    any = 1;
    if (!in_entry_zone(&m->map.entry, apos(m->pcs[i]))) return 0;
  }
  if (!any) return 0;
  if (m->captive >= 0) {
    MissionThing *cap = &m->things[m->captive];
    if (cap->freed && cap->actor && !in_entry_zone(&m->map.entry, apos(cap->actor))) return 0;
  }
  return 1;
}

const MissionResult *mission_finish(Mission *m, uint8_t result) {
  MissionResult *r = &m->result;
  int i, sum = 0, pl;
  uint8_t lv[MAX_ACTORS];
  MissionSignal s;
  if (m->has_result) return r;
  m->mode = MODE_OVER;
  m->combat.active = 0;
  memset(r, 0, sizeof *r);
  for (i = 0; i < m->n_pcs; i++) if (!is_alive(m->pcs[i]->ch) && r->n_casualties < MAX_PARTY) r->casualties[r->n_casualties++] = m->pcs[i]->ch;
  for (i = 0; i < m->n_pcs; i++) sum += m->pcs[i]->ch->level ? m->pcs[i]->ch->level : 1;
  pl = m->n_pcs ? (int)js_round((double)sum / m->n_pcs) : 1;
  if (pl < 1) pl = 1;
  for (i = 0; i < m->n_killed; i++) lv[i] = m->killed[i]->level;
  r->xp = encounter_xp(pl, lv, m->n_killed);
  for (i = 0; i < m->n_killed; i++) {
    ItemInst items[5];
    int n, k;
    m->scrap += roll_loot(m->rng, m->killed[i]->template_id, items, 5, &n);
    for (k = 0; k < n; k++)
      if (m->n_loot < MAX_LOOT) m->loot[m->n_loot++] = items[k];
  }
  for (i = 0; i < m->n_pcs; i++) {
    Character *ch = m->pcs[i]->ch;
    if (ch->stolen_scrap) {
      m->scrap += ch->stolen_scrap;
      ch->stolen_scrap = 0;
    }
    if (result != MRES_FAIL) end_encounter(ch);
  }
  r->result = result;
  r->scrap = m->scrap;
  r->n_loot = m->n_loot;
  memcpy(r->loot, m->loot, sizeof(ItemInst) * m->n_loot);
  m->has_result = 1;
  msig(&s, MSIG_FINISH);
  s.result = r;
  memit(m, &s);
  return r;
}

const MissionResult *mission_retreat(Mission *m) {
  if (m->mode == MODE_OVER) return NULL;
  return mission_finish(m, mission_objective_done(m) && m->obj_type != OBJ_RESCUE ? MRES_SUCCESS : MRES_RETREAT);
}
