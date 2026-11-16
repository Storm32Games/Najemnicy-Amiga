/* Proceduralny generator mapy taktycznej. Port src/core/tactical/mapgen.ts - kolejność losowań identyczna.
 * Uwaga: w C kolejność obliczania argumentów funkcji jest nieokreślona, więc każde losowanie trafia do osobnej zmiennej
 * w kolejności z TS (argumenty JS liczą się od lewej). */
#include <string.h>
#include "tactical.h"

const char *const FLOOR_KEYS[FL_COUNT] = {"sand", "asphalt", "asphalt_cracked", "rubble", "concrete", "dirt", "toxic", "grass_dead", "metal", "tiles"};
const char *const PROP_KEYS[PR_COUNT] = {
  "car", "bus", "barrel", "barrel_toxic", "crate", "debris", "sandbags", "container", "fence", "generator", "pillar",
  "terminal", "tent", "tank_trap", "scrap_pile", "wall", "wall_broken",
  "lamp", "sign", "antenna", "tree_dead", "skeleton", "campfire", "door",
  "flora_saguaro", "flora_pear", "flora_deadbush", "flora_shrooms", "flora_flower", "flora_reeds", "flora_grass", "flora_vine",
  "flora_pod", "flora_fern", "flora_crystal",
};
const char *const FIND_KEYS[FIND_COUNT] = {"scrap", "cache", "medical", "tech", "food", "ammo"};

/* Ile blokuje obiekt (brak wpisu = niska osłona). */
static uint8_t prop_kind(int t) {
  switch (t) {
    case PR_BUS: case PR_CONTAINER: case PR_GENERATOR: case PR_PILLAR: case PR_TENT: case PR_WALL: return CELL_HIGH;
    default: return CELL_LOW;
  }
}
static int is_decor(int t) { return t == PR_LAMP || t == PR_SIGN || t == PR_ANTENNA || t == PR_TREE_DEAD || t == PR_SKELETON || t == PR_CAMPFIRE; }

#define W MAP_W
#define H MAP_H
#define I(x, y) ((y) * W + (x))

typedef struct {
  TacticalMap *m;
  Rng *rng;
  uint8_t block[GRID_N];
  int ex, ey;
  double K;
  Pos interiors[128];
  int n_interiors;
  uint8_t used[GRID_N];
} Gen;

static double R(Gen *g) { return rng_f(g->rng); }
static int ri(Gen *g, int a, int b) { return rng_ri(g->rng, a, b); }
static int pick_i(Gen *g, int n) { return (int)floor(R(g) * n); }
static int kn(Gen *g, int n) { return (int)js_round(n * g->K); }
static int inb(int x, int y) { return x >= 0 && y >= 0 && x < W && y < H; }
static int reserved(Gen *g, int x, int y) { return x >= g->ex - 1 && x <= g->ex + 4 && y >= g->ey - 1 && y <= g->ey + 4; }

/* put(type, x, y, {force?, rot?}): rot < 0 = losowy. */
static int put(Gen *g, int type, int x, int y, int force, int rot) {
  MapProp *p;
  int r, s;
  if (!inb(x, y) || g->block[I(x, y)] || (!force && reserved(g, x, y))) return 0;
  g->block[I(x, y)] = prop_kind(type);
  r = rot >= 0 ? rot : ri(g, 0, 3);
  s = ri(g, 1, 9999);
  if (g->m->n_props < MAX_PROPS) {
    p = &g->m->props[g->m->n_props++];
    p->type = (uint8_t)type;
    p->gx = (int8_t)x;
    p->gy = (int8_t)y;
    p->rot = (uint8_t)r;
    p->seed = (uint16_t)s;
  }
  return 1;
}
static void set_floor(Gen *g, int x, int y, int t) {
  if (inb(x, y)) g->m->floor[I(x, y)] = (uint8_t)t;
}
static int rect_free(Gen *g, int x0, int y0, int w, int h) {
  int x, y;
  for (y = y0 - 1; y <= y0 + h; y++)
    for (x = x0 - 1; x <= x0 + w; x++)
      if (!inb(x, y) || reserved(g, x, y) || g->block[I(x, y)]) return 0;
  return 1;
}
static void scatter(Gen *g, const uint8_t *types, int nt, int n, int tries) {
  int c = 0;
  while (c < n && tries-- > 0) {
    int t = types[pick_i(g, nt)];
    int x = ri(g, 0, W - 1);
    int y = ri(g, 0, H - 1);
    if (put(g, t, x, y, 0, -1)) c++;
  }
}
static void line(Gen *g, int type, int x, int y, int len, int horiz, int gap) {
  int i;
  for (i = 0; i < len; i++) {
    if (i == gap) continue;
    put(g, type, horiz ? x + i : x, horiz ? y : y + i, 0, horiz ? 0 : 1);
  }
}
static void add_decor(Gen *g, int type, int x, int y) {
  if (g->m->n_decor < MAX_DECOR) {
    Decor *d = &g->m->decor[g->m->n_decor++];
    d->type = (uint8_t)type;
    d->gx = (int8_t)x;
    d->gy = (int8_t)y;
  }
}
/* Ogrodzony teren z jedną bramą. */
static int compound(Gen *g, int x0, int y0, int w, int h, int wall_type) {
  int side, gap, x, y, a, b;
  uint8_t biome = g->m->biome;
  if (!rect_free(g, x0, y0, w, h)) return 0;
  side = ri(g, 0, 3);
  gap = ri(g, 1, (side < 2 ? w : h) - 2);
  for (y = y0; y < y0 + h; y++) {
    for (x = x0; x < x0 + w; x++) {
      int edge = x == x0 || y == y0 || x == x0 + w - 1 || y == y0 + h - 1, on_gap, t;
      set_floor(g, x, y, biome == BIOME_WASTES ? FL_DIRT : FL_CONCRETE);
      if (!edge) continue;
      on_gap = (side == 0 && y == y0 && x - x0 == gap) || (side == 1 && y == y0 + h - 1 && x - x0 == gap) ||
               (side == 2 && x == x0 && y - y0 == gap) || (side == 3 && x == x0 + w - 1 && y - y0 == gap);
      if (on_gap) {
        if (biome == BIOME_BUNKER || biome == BIOME_INDUSTRIAL) add_decor(g, PR_DOOR, x, y);
        continue;
      }
      t = R(g) < 0.18 ? PR_WALL_BROKEN : wall_type;
      put(g, t, x, y, 0, y == y0 || y == y0 + h - 1 ? 0 : 1);
    }
  }
  a = ri(g, 0, w - 3);
  b = ri(g, 0, h - 3);
  if (g->n_interiors < 128) g->interiors[g->n_interiors++] = mkpos(x0 + 1 + a, y0 + 1 + b);
  return 1;
}
static int building(Gen *g, int x0, int y0, int w, int d, int h) {
  int x, y;
  MapBuilding *b;
  if (!rect_free(g, x0, y0, w, d)) return 0;
  for (y = y0; y < y0 + d; y++)
    for (x = x0; x < x0 + w; x++) {
      g->block[I(x, y)] = CELL_HIGH;
      set_floor(g, x, y, FL_CONCRETE);
    }
  if (g->m->n_buildings < MAX_BUILDINGS) {
    b = &g->m->buildings[g->m->n_buildings++];
    b->gx = (int8_t)x0;
    b->gy = (int8_t)y0;
    b->w = (uint8_t)w;
    b->d = (uint8_t)d;
    b->h = (uint8_t)h;
    b->seed = (uint16_t)ri(g, 1, 9999);
  } else {
    ri(g, 1, 9999);
  }
  return 1;
}

static int roads_x[3], roads_y[3];
static int is_road(int x, int y) {
  int i;
  for (i = 0; i < 3; i++) if ((x >= roads_x[i] && x < roads_x[i] + 2) || (y >= roads_y[i] && y < roads_y[i] + 2)) return 1;
  return 0;
}

static void gen_ruins(Gen *g) {
  static const uint8_t T1[8] = {PR_BARREL, PR_DEBRIS, PR_DEBRIS, PR_SANDBAGS, PR_SCRAP_PILE, PR_BARREL_TOXIC, PR_CRATE, PR_TANK_TRAP};
  static const uint8_t T2[6] = {PR_LAMP, PR_SIGN, PR_TREE_DEAD, PR_SKELETON, PR_ANTENNA, PR_CAMPFIRE};
  int i, t, x, y, n;
  for (i = 0; i < GRID_N; i++) g->m->floor[i] = R(g) < 0.25 ? FL_ASPHALT_CRACKED : FL_ASPHALT;
  roads_x[0] = ri(g, 5, 7); roads_x[1] = ri(g, 14, 16); roads_x[2] = ri(g, 23, 25);
  roads_y[0] = ri(g, 5, 7); roads_y[1] = ri(g, 14, 16); roads_y[2] = ri(g, 23, 25);
  for (y = 0; y < H; y++)
    for (x = 0; x < W; x++)
      if (!is_road(x, y)) set_floor(g, x, y, R(g) < 0.4 ? FL_RUBBLE : FL_CONCRETE);
  n = kn(g, 40);
  for (t = 0; t < n; t++) {
    int w = ri(g, 3, 5), d = ri(g, 3, 4), x0, y0, on = 0;
    x0 = ri(g, 0, W - w);
    y0 = ri(g, 0, H - d);
    for (y = y0; y < y0 + d; y++) for (x = x0; x < x0 + w; x++) if (is_road(x, y)) on = 1;
    if (on) continue;
    if (R(g) < 0.45) {
      int h = ri(g, 1, 3);
      building(g, x0, y0, w, d, h);
    } else compound(g, x0, y0, w > 4 ? w : 4, d > 4 ? d : 4, PR_WALL);
  }
  n = kn(g, 9);
  for (i = 0; i < n; i++) {
    int cand[6][2], k, r0, r1, dx, rot;
    for (k = 0; k < 3; k++) { cand[k][0] = roads_x[k]; cand[k][1] = ri(g, 0, H - 1); }
    for (k = 0; k < 3; k++) { cand[3 + k][0] = ri(g, 0, W - 1); cand[3 + k][1] = roads_y[k]; }
    k = pick_i(g, 6);
    r0 = cand[k][0];
    r1 = cand[k][1];
    dx = ri(g, 0, 1);
    rot = ri(g, 0, 1) * 2;
    put(g, PR_CAR, r0 + dx, r1, 0, rot);
  }
  scatter(g, T1, 8, kn(g, 26), 200);
  scatter(g, T2, 6, kn(g, 12), 160);
  n = kn(g, 2);
  for (i = 0; i < n; i++) {
    int bx = ri(g, 0, W - 1);
    put(g, PR_BUS, bx, roads_y[i % 3], 0, 0);
  }
}

static void gen_wastes(Gen *g) {
  static const uint8_t T1[6] = {PR_SCRAP_PILE, PR_DEBRIS, PR_BARREL, PR_SANDBAGS, PR_TANK_TRAP, PR_CRATE};
  static const uint8_t T2[4] = {PR_SKELETON, PR_TREE_DEAD, PR_SIGN, PR_ANTENNA};
  static const uint8_t WR[3] = {PR_CAR, PR_BUS, PR_CAR};
  int i, p, n, x, y, k;
  for (i = 0; i < GRID_N; i++) g->m->floor[i] = R(g) < 0.3 ? FL_DIRT : FL_SAND;
  n = kn(g, 4);
  for (p = 0; p < n; p++) {
    int cx = ri(g, 3, W - 4), cy = ri(g, 3, H - 4), r = ri(g, 1, 2);
    if (cx > g->ex - 4 && cx < g->ex + 8 && cy > g->ey - 4 && cy < g->ey + 8) continue;
    for (y = cy - r; y < cy - r + r * 2 + 1; y++)
      for (x = cx - r; x < cx - r + r * 2 + 1; x++)
        if (js_hypot(x - cx, y - cy) <= r + 0.3 && inb(x, y) && !reserved(g, x, y)) {
          set_floor(g, x, y, FL_TOXIC);
          g->block[I(x, y)] = CELL_HAZARD;
        }
  }
  n = kn(g, 12);
  for (i = 0; i < n; i++) {
    int x0 = ri(g, 0, W - 3), y0 = ri(g, 0, H - 3);
    for (k = 0; k < ri(g, 1, 3); k++) {
      int t = R(g) < 0.6 ? PR_WALL_BROKEN : PR_PILLAR;
      int a = ri(g, 0, 2), b = 0;
      b = ri(g, 0, 2);
      put(g, t, x0 + a, y0 + b, 0, -1);
    }
  }
  n = kn(g, 2);
  for (i = 0; i < n; i++) {
    int x0 = ri(g, 2, W - 8), y0, w, h;
    y0 = ri(g, 2, H - 7);
    w = ri(g, 4, 5);
    h = ri(g, 4, 5);
    compound(g, x0, y0, w, h, PR_WALL_BROKEN);
  }
  n = kn(g, 5);
  for (i = 0; i < n; i++) {
    int t = WR[pick_i(g, 3)], a = ri(g, 0, W - 1), b;
    b = ri(g, 0, H - 1);
    put(g, t, a, b, 0, -1);
  }
  n = kn(g, 3);
  for (i = 0; i < n; i++) {
    int a = ri(g, 2, W - 3), b;
    b = ri(g, 2, H - 3);
    if (put(g, PR_TENT, a, b, 0, -1)) add_decor(g, PR_CAMPFIRE, a + 1, b);
  }
  scatter(g, T1, 6, kn(g, 16), 200);
  scatter(g, T2, 4, kn(g, 12), 160);
}

static void gen_industrial(Gen *g) {
  static const uint8_t T1[3] = {PR_GENERATOR, PR_GENERATOR, PR_TERMINAL};
  static const uint8_t T2[6] = {PR_BARREL, PR_BARREL_TOXIC, PR_CRATE, PR_DEBRIS, PR_TANK_TRAP, PR_SCRAP_PILE};
  static const uint8_t T3[4] = {PR_ANTENNA, PR_LAMP, PR_SIGN, PR_SKELETON};
  int i, r, n;
  for (i = 0; i < GRID_N; i++) g->m->floor[i] = R(g) < 0.2 ? FL_METAL : FL_CONCRETE;
  n = kn(g, 5);
  for (r = 0; r < n; r++) {
    int x = ri(g, 0, W - 5), y = 0, horiz, ax, ay, len, gap;
    y = ri(g, 0, H - 1);
    horiz = R(g) < 0.5;
    ax = horiz ? x : ri(g, 0, W - 1);
    ay = horiz ? y : ri(g, 0, H - 5);
    len = ri(g, 3, 5);
    gap = ri(g, -1, 3);
    line(g, PR_CONTAINER, ax, ay, len, horiz, gap);
  }
  n = kn(g, 4);
  for (r = 0; r < n; r++) {
    int a = ri(g, 0, W - 7), b, len, gap;
    b = ri(g, 0, H - 1);
    len = ri(g, 4, 7);
    gap = ri(g, 1, 4);
    line(g, PR_FENCE, a, b, len, 1, gap);
  }
  n = kn(g, 3);
  for (r = 0; r < n; r++) {
    int a = ri(g, 0, W - 1), b, len, gap;
    b = ri(g, 0, H - 7);
    len = ri(g, 4, 7);
    gap = ri(g, 1, 4);
    line(g, PR_FENCE, a, b, len, 0, gap);
  }
  n = kn(g, 2);
  for (i = 0; i < n; i++) {
    int x0 = ri(g, 2, W - 8), y0, w, h;
    y0 = ri(g, 2, H - 7);
    w = ri(g, 4, 6);
    h = ri(g, 4, 5);
    compound(g, x0, y0, w, h, PR_WALL);
  }
  scatter(g, T1, 3, kn(g, 5), 200);
  scatter(g, T2, 6, kn(g, 22), 200);
  scatter(g, T3, 4, kn(g, 7), 120);
}

typedef struct { int x, y, w, h; } Room;
static Pos room_cen(const Room *r) { return mkpos(r->x + (r->w >> 1), r->y + (r->h >> 1)); }

static void carve(Gen *g, int x, int y) {
  if (inb(x, y) && x > 0 && y > 0 && x < W - 1 && y < H - 1) {
    g->block[I(x, y)] = CELL_FREE;
    if (g->m->floor[I(x, y)] == FL_TILES && R(g) < 0.5) g->m->floor[I(x, y)] = FL_CONCRETE;
  }
}

static void gen_bunker(Gen *g, int corner) {
  static const uint8_t T[6] = {PR_TERMINAL, PR_BARREL, PR_CRATE, PR_GENERATOR, PR_PILLAR, PR_SANDBAGS};
  Room rooms[64], order[64];
  int nr = 0, i, t, x, y, k, maxr;
  memset(g->block, CELL_HIGH, sizeof g->block);
  for (i = 0; i < GRID_N; i++) g->m->floor[i] = R(g) < 0.3 ? FL_METAL : FL_TILES;
  rooms[0].x = g->ex - (corner & 1 ? 1 : 0);
  rooms[0].y = g->ey - (corner & 2 ? 1 : 0);
  rooms[0].w = 5;
  rooms[0].h = 5;
  nr = 1;
  maxr = kn(g, 8);
  for (t = 0; t < 200 && nr < maxr; t++) {
    int w = ri(g, 4, 7), h, rx, ry, clash = 0;
    h = ri(g, 4, 6);
    rx = ri(g, 1, W - w - 1);
    ry = ri(g, 1, H - h - 1);
    for (i = 0; i < nr; i++) {
      Room *r = &rooms[i];
      if (rx < r->x + r->w + 2 && rx + w + 2 > r->x && ry < r->y + r->h + 2 && ry + h + 2 > r->y) { clash = 1; break; }
    }
    if (clash) continue;
    rooms[nr].x = rx; rooms[nr].y = ry; rooms[nr].w = w; rooms[nr].h = h;
    nr++;
  }
  for (i = 0; i < nr; i++)
    for (y = rooms[i].y; y < rooms[i].y + rooms[i].h; y++)
      for (x = rooms[i].x; x < rooms[i].x + rooms[i].w; x++) carve(g, x, y);
  /* stabilne sortowanie po x + y środka */
  memcpy(order, rooms, sizeof(Room) * (size_t)nr);
  for (i = 1; i < nr; i++) {
    Room v = order[i];
    Pos cv = room_cen(&v);
    int j = i;
    while (j > 0) {
      Pos cj = room_cen(&order[j - 1]);
      if (cj.gx + cj.gy - (cv.gx + cv.gy) <= 0) break;
      order[j] = order[j - 1];
      j--;
    }
    order[j] = v;
  }
  for (i = 0; i + 1 < nr; i++) {
    Pos a = room_cen(&order[i]), b = room_cen(&order[i + 1]);
    x = a.gx;
    y = a.gy;
    while (x != b.gx) {
      carve(g, x, y);
      carve(g, x, y + 1);
      x += b.gx > x ? 1 : -1;
    }
    while (y != b.gy) {
      carve(g, x, y);
      carve(g, x + 1, y);
      y += b.gy > y ? 1 : -1;
    }
  }
  for (i = 1; i < nr; i++) {
    Room *r = &rooms[i];
    for (k = 0; k < ri(g, 2, 4); k++) {
      int tp = T[pick_i(g, 6)], a = ri(g, r->x, r->x + r->w - 1), b;
      b = ri(g, r->y, r->y + r->h - 1);
      put(g, tp, a, b, 0, -1);
    }
    if (g->n_interiors < 128) g->interiors[g->n_interiors++] = room_cen(r);
  }
  for (y = g->ey; y < g->ey + 4; y++)
    for (x = g->ex; x < g->ex + 4; x++) g->block[I(x, y)] = CELL_FREE;
}

/* ---------------------------------------------------------------- rozstawienie */
static int same(ReachCell r, Pos p) { return r.gx == p.gx && r.gy == p.gy; }

typedef int (*CellPred)(Gen *g, const ReachCell *r, void *ctx);
static int take_cell(Gen *g, CellPred pred, void *ctx, ReachCell *out) {
  static int16_t cand[GRID_N];
  int n = 0, i, k;
  for (i = 0; i < g->m->n_reach; i++) {
    const ReachCell *r = &g->m->reach[i];
    if (!g->used[I(r->gx, r->gy)] && pred(g, r, ctx)) cand[n++] = (int16_t)i;
  }
  if (!n) return 0;
  k = cand[pick_i(g, n)];
  *out = g->m->reach[k];
  g->used[I(out->gx, out->gy)] = 1;
  return 1;
}
typedef struct { double min_d; Pos centers[MAX_MAP_GROUPS * 2]; int n_centers; double apart; } PredCtx;
static int p_min_d(Gen *g, const ReachCell *r, void *c) { (void)g; return r->d >= ((PredCtx *)c)->min_d; }
static int p_any(Gen *g, const ReachCell *r, void *c) { (void)g; (void)r; (void)c; return 1; }
static int p_apart(Gen *g, const ReachCell *r, void *c) {
  PredCtx *p = (PredCtx *)c;
  int i;
  (void)g;
  if (!(r->d >= p->min_d)) return 0;
  for (i = 0; i < p->n_centers; i++) if (js_hypot(p->centers[i].gx - r->gx, p->centers[i].gy - r->gy) < p->apart) return 0;
  return 1;
}
static int p_crate(Gen *g, const ReachCell *r, void *c) {
  static const int8_t D4[4][2] = {{1, 0}, {-1, 0}, {0, 1}, {0, -1}};
  int k, n = 0;
  (void)c;
  if (r->d < 6) return 0;
  for (k = 0; k < 4; k++) {
    int x = r->gx + D4[k][0], y = r->gy + D4[k][1];
    if (inb(x, y) && g->block[I(x, y)] == CELL_FREE) n++;
  }
  return n >= 2;
}
static int p_find(Gen *g, const ReachCell *r, void *c) { (void)c; return r->d >= 4 && g->block[I(r->gx, r->gy)] == CELL_FREE; }

static int is_boss_id(uint8_t id) { return id == ENEMY_KOSTUCHA; } /* TS: /kostucha|boss/i na id */

static void group_push(GroupSpawn *gs, uint8_t id, Pos cell) {
  if (gs->n < MAX_GROUP_MEMBERS) {
    gs->members[gs->n] = id;
    gs->cells[gs->n] = cell;
    gs->n++;
  }
}

/* ---------------------------------------------------------------- dekoracje (osobny strumień, czysto wizualne) */
static int soft(int t) { return t == FL_SAND || t == FL_DIRT || t == FL_RUBBLE || t == FL_ASPHALT_CRACKED; }

static void decorate(Gen *g) {
  TacticalMap *m = g->m;
  Rng vr;
  static uint8_t taken[GRID_N];
  int p, i, x, y, count, placed = 0, t;
  uint8_t biome = m->biome;
  rng_seed(&vr, (m->seed ^ 0x51f15eedUL));
#define VR() rng_f(&vr)
#define VI(a, b) rng_ri(&vr, (a), (b))
#define VPICK(arr) (arr)[(int)floor(VR() * (double)(sizeof(arr) / sizeof((arr)[0])))]
  if (biome == BIOME_WASTES || biome == BIOME_RUINS) {
    int patches = biome == BIOME_WASTES ? kn(g, 9) : kn(g, 7);
    for (p = 0; p < patches; p++) {
      int edge = biome == BIOME_RUINS || VR() < 0.4;
      int side = VI(0, 3), along = VI(1, W - 2), depth = VI(0, 3), cx, cy;
      double rad;
      if (edge) cx = side == 0 ? depth : side == 1 ? W - 1 - depth : along;
      else cx = VI(2, W - 3);
      if (edge) cy = side == 2 ? depth : side == 3 ? H - 1 - depth : along;
      else cy = VI(2, H - 3);
      rad = 1.4 + VR() * 2.2;
      for (y = (int)floor(cy - rad); y <= cy + rad; y++)
        for (x = (int)floor(cx - rad); x <= cx + rad; x++)
          if (js_hypot(x - cx, y - cy) <= rad - VR() * 0.9) {
            if (inb(x, y) && soft(m->floor[I(x, y)]) && g->block[I(x, y)] != CELL_HIGH) m->floor[I(x, y)] = FL_GRASS_DEAD;
          }
    }
  }
  memcpy(taken, g->used, sizeof taken);
  for (i = 0; i < m->n_props; i++) taken[I(m->props[i].gx, m->props[i].gy)] = 1;
  for (i = 0; i < m->n_deco; i++) taken[I(m->deco[i].gx, m->deco[i].gy)] = 1;
  for (i = 0; i < m->n_decor; i++) if (inb(m->decor[i].gx, m->decor[i].gy)) taken[I(m->decor[i].gx, m->decor[i].gy)] = 1;
  for (i = 0; i < m->n_crates; i++) taken[I(m->crates[i].gx, m->crates[i].gy)] = 1;
  for (i = 0; i < m->n_finds; i++) taken[I(m->finds[i].gx, m->finds[i].gy)] = 1;
  for (i = 0; i < m->n_groups; i++) {
    int k;
    for (k = 0; k < m->groups[i].n; k++) taken[I(m->groups[i].cells[k].gx, m->groups[i].cells[k].gy)] = 1;
  }
  count = biome == BIOME_WASTES ? kn(g, 46) : biome == BIOME_RUINS ? kn(g, 30) : biome == BIOME_INDUSTRIAL ? kn(g, 14) : kn(g, 12);
  for (t = 0; t < count * 6 && placed < count; t++) {
    static const uint8_t TOX[6] = {PR_FLORA_SHROOMS, PR_FLORA_SHROOMS, PR_FLORA_REEDS, PR_FLORA_POD, PR_FLORA_VINE, PR_FLORA_FERN};
    static const uint8_t WG[5] = {PR_FLORA_GRASS, PR_FLORA_GRASS, PR_FLORA_DEADBUSH, PR_FLORA_FLOWER, PR_FLORA_GRASS};
    static const uint8_t WS[8] = {PR_FLORA_SAGUARO, PR_FLORA_SAGUARO, PR_FLORA_PEAR, PR_FLORA_PEAR, PR_FLORA_DEADBUSH, PR_FLORA_GRASS, PR_FLORA_GRASS, PR_FLORA_CRYSTAL};
    static const uint8_t RG[5] = {PR_FLORA_GRASS, PR_FLORA_GRASS, PR_FLORA_DEADBUSH, PR_FLORA_FERN, PR_FLORA_FLOWER};
    static const uint8_t RR[4] = {PR_FLORA_GRASS, PR_FLORA_DEADBUSH, PR_FLORA_VINE, PR_FLORA_GRASS};
    static const uint8_t RH[3] = {PR_FLORA_VINE, PR_FLORA_FERN, PR_FLORA_GRASS};
    static const uint8_t IN[4] = {PR_FLORA_GRASS, PR_FLORA_DEADBUSH, PR_FLORA_VINE, PR_FLORA_GRASS};
    static const uint8_t BU[5] = {PR_FLORA_SHROOMS, PR_FLORA_SHROOMS, PR_FLORA_CRYSTAL, PR_FLORA_FERN, PR_FLORA_VINE};
    int idx, fl, type = -1, near_toxic = 0, dx, dy;
    x = VI(0, W - 1);
    y = VI(0, H - 1);
    idx = I(x, y);
    if (g->block[idx] != CELL_FREE || taken[idx] || reserved(g, x, y)) continue;
    fl = m->floor[idx];
    for (dy = -2; dy <= 2 && !near_toxic; dy++)
      for (dx = -2; dx <= 2; dx++)
        if (inb(x + dx, y + dy) && m->floor[I(x + dx, y + dy)] == FL_TOXIC) { near_toxic = 1; break; }
#define NEAR_HIGH() ((inb(x + 1, y) && g->block[I(x + 1, y)] == CELL_HIGH) || (inb(x - 1, y) && g->block[I(x - 1, y)] == CELL_HIGH) || \
                     (inb(x, y + 1) && g->block[I(x, y + 1)] == CELL_HIGH) || (inb(x, y - 1) && g->block[I(x, y - 1)] == CELL_HIGH))
    if (near_toxic) type = VPICK(TOX);
    else if (biome == BIOME_WASTES) {
      if (fl == FL_GRASS_DEAD) type = VPICK(WG);
      else if (fl == FL_SAND || fl == FL_DIRT) type = VPICK(WS);
    } else if (biome == BIOME_RUINS) {
      if (fl == FL_GRASS_DEAD) type = VPICK(RG);
      else if (fl == FL_RUBBLE || fl == FL_ASPHALT_CRACKED) type = VR() < 0.6 ? VPICK(RR) : -1;
      else if (NEAR_HIGH()) type = VR() < 0.5 ? VPICK(RH) : -1;
    } else if (biome == BIOME_INDUSTRIAL) {
      if (fl == FL_CONCRETE && (NEAR_HIGH() || VR() < 0.3)) type = VPICK(IN);
    } else if (NEAR_HIGH() && VR() < 0.7) type = VPICK(BU);
#undef NEAR_HIGH
    if (type < 0) continue;
    taken[idx] = 1;
    if (m->n_deco < MAX_DECO) {
      MapProp *d = &m->deco[m->n_deco++];
      d->type = (uint8_t)type;
      d->gx = (int8_t)x;
      d->gy = (int8_t)y;
      d->rot = 0;
      d->seed = (uint16_t)VI(1, 9999);
    } else VI(1, 9999);
    placed++;
  }
#undef VR
#undef VI
#undef VPICK
}

/* ---------------------------------------------------------------- generator */
Pos entry_cell(const EntryZone *e, int i) { return mkpos(e->x0 + (i & 3), e->y0 + (i >> 2)); }
int in_entry_zone(const EntryZone *e, Pos p) { return p.gx >= e->x0 && p.gx <= e->x1 && p.gy >= e->y0 && p.gy <= e->y1; }

void generate_map(const MapSpec *spec, const uint8_t *enemy_ids, int n_enemies, TacticalMap *m) {
  static Gen G;
  Gen *g = &G;
  Rng rng;
  int corner, i, x, y, k;
  static int16_t dist4[GRID_N];
  static int16_t q[GRID_N];
  int qn, qi;
  Pos start;
  uint8_t ids[MAX_ENEMIES_IN], loners[MAX_ENEMIES_IN];
  int n_ids = 0, n_loners = 0, nG, boss_idx;
  ReachCell centers[MAX_MAP_GROUPS * 2];
  int n_centers = 0;
  PredCtx pc;
  ReachCell c;

  memset(m, 0, sizeof *m);
  memset(g, 0, sizeof *g);
  g->m = m;
  g->rng = &rng;
  m->biome = spec->biome;
  m->seed = hash_seed_latin2(spec->id && *spec->id ? spec->id : "x");
  rng_seed(&rng, m->seed);
  g->K = (double)(W * H) / (24 * 24);
  for (i = 0; i < GRID_N; i++) m->floor[i] = FL_ASPHALT;

  corner = ri(g, 0, 3);
  g->ex = corner & 1 ? W - 5 : 1;
  g->ey = corner & 2 ? H - 5 : 1;
  m->entry.x0 = (int8_t)g->ex;
  m->entry.y0 = (int8_t)g->ey;
  m->entry.x1 = (int8_t)(g->ex + 3);
  m->entry.y1 = (int8_t)(g->ey + 3);

  if (m->biome == BIOME_RUINS) gen_ruins(g);
  else if (m->biome == BIOME_WASTES) gen_wastes(g);
  else if (m->biome == BIOME_INDUSTRIAL) gen_industrial(g);
  else gen_bunker(g, corner);

  /* strefa wejścia wolna, rekwizyty z niej usunięte; dekoracje nie blokują */
  for (i = 0; i < 16; i++) {
    Pos p = entry_cell(&m->entry, i);
    g->block[I(p.gx, p.gy)] = CELL_FREE;
  }
  {
    int n = 0;
    for (i = 0; i < m->n_props; i++) {
      MapProp p = m->props[i];
      if (in_entry_zone(&m->entry, mkpos(p.gx, p.gy))) continue;
      if (is_decor(p.type)) {
        g->block[I(p.gx, p.gy)] = CELL_FREE;
        if (m->n_deco < MAX_DECO) m->deco[m->n_deco++] = p;
        continue;
      }
      m->props[n++] = p;
    }
    m->n_props = (uint16_t)n;
  }
  if (m->biome == BIOME_BUNKER) {
    static uint8_t prop_at[GRID_N];
    memset(prop_at, 0, sizeof prop_at);
    for (i = 0; i < m->n_props; i++) prop_at[I(m->props[i].gx, m->props[i].gy)] = 1;
    for (y = 0; y < H; y++)
      for (x = 0; x < W; x++) {
        int near = 0, dx, dy;
        if (g->block[I(x, y)] != CELL_HIGH || prop_at[I(x, y)]) continue;
        for (dy = -1; dy <= 1; dy++)
          for (dx = -1; dx <= 1; dx++)
            if (inb(x + dx, y + dy) && g->block[I(x + dx, y + dy)] != CELL_HIGH) near = 1;
        m->solids[m->n_solids].gx = (int8_t)x;
        m->solids[m->n_solids].gy = (int8_t)y;
        m->solids[m->n_solids].near = (uint8_t)near;
        m->n_solids++;
      }
  }

  /* osiągalność (BFS 4-kierunkowy) od pola wejścia nr 5 */
  for (i = 0; i < GRID_N; i++) dist4[i] = -1;
  start = entry_cell(&m->entry, 5);
  q[0] = (int16_t)I(start.gx, start.gy);
  dist4[q[0]] = 0;
  for (qn = 1, qi = 0; qi < qn; qi++) {
    static const int8_t D4[4][2] = {{1, 0}, {-1, 0}, {0, 1}, {0, -1}};
    int cx = q[qi] % W, cy = q[qi] / W, d;
    for (d = 0; d < 4; d++) {
      int nx = cx + D4[d][0], ny = cy + D4[d][1];
      if (inb(nx, ny) && g->block[I(nx, ny)] == CELL_FREE && dist4[I(nx, ny)] < 0) {
        dist4[I(nx, ny)] = (int16_t)(dist4[q[qi]] + 1);
        q[qn++] = (int16_t)I(nx, ny);
      }
    }
  }
  m->max_d = 0;
  for (y = 0; y < H; y++)
    for (x = 0; x < W; x++) {
      int dd = dist4[I(x, y)];
      if (dd < 0) continue;
      m->reach[m->n_reach].gx = (int8_t)x;
      m->reach[m->n_reach].gy = (int8_t)y;
      m->reach[m->n_reach].d = (int16_t)dd;
      m->n_reach++;
      if (dd > m->max_d) m->max_d = (int16_t)dd;
    }

  /* cel zlecenia: daleko od wejścia */
  memset(&pc, 0, sizeof pc);
  pc.min_d = m->max_d * 0.75;
  m->has_obj = (uint8_t)take_cell(g, p_min_d, &pc, &m->obj);
  if (!m->has_obj) {
    pc.min_d = m->max_d * 0.5;
    m->has_obj = (uint8_t)take_cell(g, p_min_d, &pc, &m->obj);
  }
  if (!m->has_obj) m->has_obj = (uint8_t)take_cell(g, p_any, NULL, &m->obj);

  /* wędrowcy */
  for (i = 0; i < n_enemies && n_ids < MAX_ENEMIES_IN; i++) ids[n_ids++] = enemy_ids[i];
  if (spec->type != OBJ_DEFEND) {
    Rng sr;
    rng_seed(&sr, m->seed ^ 0x2a77e1d5UL);
    for (i = n_ids - 1; i >= 0 && n_ids > 1; i--) {
      uint8_t f = ENEMY_DEFS[ids[i]].faction;
      if (is_boss_id(ids[i]) || !(f == EFACTION_RAIDER || f == EFACTION_BEAST || f == EFACTION_MACHINE)) continue;
      if (rng_f(&sr) < 0.45) {
        loners[n_loners++] = ids[i];
        for (k = i; k + 1 < n_ids; k++) ids[k] = ids[k + 1];
        n_ids--;
      }
    }
  }

  /* grupy */
  nG = (n_ids + 2) / 3;
  if (nG > 4) nG = 4;
  if (nG < 1) nG = 1;
  boss_idx = -1;
  for (i = 0; i < n_ids; i++) if (is_boss_id(ids[i])) { boss_idx = i; break; }
  for (k = 0; k < nG; k++) {
    double min_d = k == 0 && nG > 1 ? m->max_d * 0.3 : m->max_d * 0.45;
    int ok = 0, j;
    if (k == nG - 1 && m->has_obj) {
      c = m->obj;
      ok = 1;
    } else {
      pc.min_d = min_d;
      pc.apart = 6;
      pc.n_centers = n_centers;
      for (j = 0; j < n_centers; j++) pc.centers[j] = mkpos(centers[j].gx, centers[j].gy);
      ok = take_cell(g, p_apart, &pc, &c);
      if (!ok) {
        pc.min_d = 8;
        ok = take_cell(g, p_min_d, &pc, &c);
      }
    }
    if (!ok) {
      int ix = m->n_reach - 1 - k * 3;
      c = ix >= 0 && ix < m->n_reach ? m->reach[ix] : m->reach[0];
    }
    centers[n_centers++] = c;
    memset(&m->groups[m->n_groups], 0, sizeof(GroupSpawn));
    m->groups[m->n_groups].center = c;
    m->n_groups++;
  }
  for (i = 0; i < n_ids; i++) {
    int gi = boss_idx >= 0 && ids[i] == ids[boss_idx] ? nG - 1 : i % nG;
    GroupSpawn *gs = &m->groups[gi];
    if (gs->n < MAX_GROUP_MEMBERS) gs->members[gs->n++] = ids[i];
  }
  for (k = 0; k < m->n_groups; k++) {
    GroupSpawn *gs = &m->groups[k];
    static int16_t near[GRID_N];
    static double nd[GRID_N];
    int nn = 0, nm = gs->n, j;
    for (i = 0; i < m->n_reach; i++) {
      const ReachCell *r = &m->reach[i];
      double d = js_hypot(r->gx - gs->center.gx, r->gy - gs->center.gy);
      if (d <= 3.2 && !g->used[I(r->gx, r->gy)] && !(m->has_obj && r->gx == m->obj.gx && r->gy == m->obj.gy)) {
        /* wstawianie z zachowaniem kolejności (stabilne) */
        j = nn++;
        while (j > 0 && nd[j - 1] > d) {
          near[j] = near[j - 1];
          nd[j] = nd[j - 1];
          j--;
        }
        near[j] = (int16_t)i;
        nd[j] = d;
      }
    }
    for (j = 0; j < nm; j++) {
      const ReachCell *r = j < nn ? &m->reach[near[j]] : nn ? &m->reach[near[0]] : NULL;
      if (r) {
        g->used[I(r->gx, r->gy)] = 1;
        gs->cells[j] = mkpos(r->gx, r->gy);
      } else gs->cells[j] = mkpos(gs->center.gx, gs->center.gy);
    }
  }

  /* wędrowcy pojedynczo, wstawiani na początek listy grup */
  {
    GroupSpawn solo[MAX_ENEMIES_IN];
    int ns = 0, j;
    for (i = 0; i < n_loners; i++) {
      int ok;
      pc.min_d = m->max_d * 0.3;
      pc.apart = 5;
      pc.n_centers = n_centers;
      for (j = 0; j < n_centers; j++) pc.centers[j] = mkpos(centers[j].gx, centers[j].gy);
      ok = take_cell(g, p_apart, &pc, &c);
      if (!ok) {
        pc.min_d = 8;
        ok = take_cell(g, p_min_d, &pc, &c);
      }
      if (!ok) ok = take_cell(g, p_any, NULL, &c);
      if (!ok) {
        group_push(&m->groups[0], loners[i], mkpos(m->groups[0].center.gx, m->groups[0].center.gy));
        continue;
      }
      centers[n_centers++] = c;
      memset(&solo[ns], 0, sizeof(GroupSpawn));
      solo[ns].center = c;
      solo[ns].roam = 1;
      group_push(&solo[ns], loners[i], mkpos(c.gx, c.gy));
      ns++;
    }
    if (ns) {
      for (j = m->n_groups - 1; j >= 0; j--) m->groups[j + ns] = m->groups[j];
      for (j = 0; j < ns; j++) m->groups[j] = solo[j];
      m->n_groups = (uint8_t)(m->n_groups + ns);
    }
  }

  /* skrzynie */
  {
    int n_cr = 3 + (spec->level > 2 ? 1 : 0), j;
    for (i = 0; i < g->n_interiors; i++) {
      if (m->n_crates >= n_cr - 1) break;
      for (j = 0; j < m->n_reach; j++) {
        const ReachCell *r = &m->reach[j];
        if (same(*r, g->interiors[i]) && !g->used[I(r->gx, r->gy)] && r->d > 6) {
          g->used[I(r->gx, r->gy)] = 1;
          m->crates[m->n_crates++] = mkpos(r->gx, r->gy);
          break;
        }
      }
    }
    while (m->n_crates < n_cr) {
      if (!take_cell(g, p_crate, NULL, &c)) break;
      m->crates[m->n_crates++] = mkpos(c.gx, c.gy);
    }
    for (i = 0; i < m->n_crates; i++) g->block[I(m->crates[i].gx, m->crates[i].gy)] = CELL_LOW;
  }

  /* znaleziska */
  {
    static const uint8_t FK[7] = {FIND_SCRAP, FIND_SCRAP, FIND_CACHE, FIND_MEDICAL, FIND_TECH, FIND_FOOD, FIND_AMMO};
    int n_finds = kn(g, 7) + ri(g, 0, 3);
    for (k = 0; k < n_finds; k++) {
      FindSpawn *f;
      if (!take_cell(g, p_find, NULL, &c)) break;
      if (m->n_finds >= MAX_FINDS) break;
      f = &m->finds[m->n_finds++];
      f->gx = c.gx;
      f->gy = c.gy;
      f->kind = FK[pick_i(g, 7)];
      f->hidden = R(g) < 0.55;
    }
  }

  decorate(g);
  memcpy(m->grid.cells, g->block, GRID_N);
}
