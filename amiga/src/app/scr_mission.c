/* Misja taktyczna (port src/scenes/WorldScene.ts) - etap 1: świat izometryczny z biblioteki grafik (lib_common +
 * lib_<biom>, klucze jak ArtBook w buildWorld), mgła wojny (mission.vis / explored), drużyna i wrogowie (biblioteki
 * klatek unit_<id>), kursor pola joystickiem i ruch w eksploracji (mission_explore_move). Walka, akcje, interakcje
 * i pełny HUD - kolejne etapy. Plik w UTF-8, napisy przekodowuje tools/amiga/latin2_literals.py. */
#include <stdio.h>
#include <string.h>
#include <stdlib.h>
#include "app.h"
#include "ui.h"
#include "game.h"
#include "scenefx.h"
#include "../gfx/r2d.h"
#include "../gfx/img.h"
#include "../core/frontend.h"
#include "../core/combat.h"
#include "../data/gamedata.h"
#include "../data/assets.h"

#define TILE_W 32
#define TILE_H 16
#define D_EDGE 0
#define D_GROUND 1
#define D_DECAL 2
#define D_AO 3
#define D_CURSOR 5
#define D_UNIT_SHADOW 7
#define D_OBJ 10
#define L_PROP 1
#define L_UNIT 2
#define STEP_MS 130
#define MAX_SPR 4096
#define MAX_UNITS MAX_ACTORS

/* ------------------------------------------------------------------ hash2 / rng z iso/Pixel.ts */
static double hash2(int x, int y, int seed) {
  uint32_t h = ((uint32_t)x ^ 0x27d4eb2du) * 0x165667b1u ^ ((uint32_t)y + 0x9e3779b9u) * 0x85ebca6bu ^ (uint32_t)seed * 0xc2b2ae35u;
  h ^= h >> 15;
  h *= 0x2c1b3c6du;
  h ^= h >> 12;
  h *= 0x297a2d39u;
  h ^= h >> 15;
  return h / 4294967296.0;
}
typedef struct { uint32_t a; } Mul;
static double mul_next(Mul *m) {
  uint32_t t;
  m->a += 0x6d2b79f5u;
  t = (m->a ^ (m->a >> 15)) * (1u | m->a);
  t = (t + (t ^ (t >> 7)) * (61u | t)) ^ t;
  return (t ^ (t >> 14)) / 4294967296.0;
}
static int jround(double v) { double f = floor(v); return (int)(v - f >= 0.5 ? f + 1 : f); }

/* ------------------------------------------------------------------ stan */
static Mission mission;
static Rng mrng;
static Character *party_ptr[MAX_PARTY];
static Lib lib_common, lib_biome;
static Atlas atlas;
static int loaded;
static uint8_t biome;
static const char *const BIOME_KEYS[4] = {"ruins", "wastes", "industrial", "bunker"};
static const uint32_t BIOME_BG[4] = {0x141217, 0x141316, 0x121416, 0x0a0b0d};

typedef struct { AtlasImg img; int16_t x, y; int32_t depth; int16_t cell; uint8_t flip, flat; } Spr;
static Spr spr[MAX_SPR];
static int n_spr;
static uint8_t cell_state[GRID_N];   /* 0 nieodkryte, 1 zapamiętane, 2 widoczne */
static uint8_t cell_reveal[GRID_N];  /* 0..255 */
static uint32_t memory_tint;

/* klatki postaci w atlasie */
static const char *const DIR8[8] = {"east", "south-east", "south", "south-west", "west", "north-west", "north", "north-east"};
typedef struct {
  Actor *a;
  int pc;                      /* 1 = najemnik (8 kierunków PixelLab), 0 = wróg (przód / tył + lustro) */
  AtlasImg idle[8][5], walk[8][8];   /* pc: [kierunek][klatka]; wróg: [0] przód, [1] tył */
  int has_walk, n_walk;
  float x, y;                  /* pozycja na ekranie (stopy) */
  int dir, step, ms, walking;
  Pos path[MAX_PATH];
  int n_path, path_i, path_ms;
  Pos from;
} UnitV;
static UnitV units[MAX_UNITS];
static int n_units;
static AtlasImg img_shadow, img_cursor;
static int leader;            /* indeks w mission.pcs */
static Pos cursor;
static float cam_x, cam_y;
static int busy, rep_ms, combat_note;
static TickClock clock;
static UiDialog dlg;

/* ------------------------------------------------------------------ rzut */
static float iso_x(float gx, float gy) { return (gx - gy) * (TILE_W / 2); }
static float iso_y(float gx, float gy) { return (gx + gy) * (TILE_H / 2); }
static int32_t obj_depth(int gx, int gy, int layer) { return D_OBJ + (gx + gy) * 4 + layer; }

static int add_lib_img(const Lib *l, const char *key, AtlasImg *out, int *ax, int *ay) {
  const LibEntry *e = lib_find(l, key);
  uint8_t *rgba;
  int ok;
  if (!e) return 0;
  rgba = lib_decode(l, e);
  if (!rgba) return 0;
  ok = atlas_add(&atlas, rgba, e->w, e->h, out);
  free(rgba);
  if (ax) *ax = e->ax;
  if (ay) *ay = e->ay;
  return ok;
}

/* obraz z biblioteki (najpierw wspólna, potem biomu) - każdy klucz w atlasie tylko raz */
#define CACHE_N 1024
static struct { char key[40]; AtlasImg img; int ax, ay; } cache[CACHE_N];
static int n_cache;
static int art(const char *key, AtlasImg *img, int *ax, int *ay) {
  int i;
  for (i = 0; i < n_cache; i++)
    if (!strcmp(cache[i].key, key)) {
      *img = cache[i].img;
      *ax = cache[i].ax;
      *ay = cache[i].ay;
      return 1;
    }
  if (n_cache >= CACHE_N) return 0;
  if (!add_lib_img(&lib_common, key, &cache[n_cache].img, &cache[n_cache].ax, &cache[n_cache].ay) &&
      !add_lib_img(&lib_biome, key, &cache[n_cache].img, &cache[n_cache].ax, &cache[n_cache].ay)) {
    fprintf(stderr, "Najemnicy: brak grafiki %s\n", key);
    return 0;
  }
  snprintf(cache[n_cache].key, sizeof cache[n_cache].key, "%s", key);
  *img = cache[n_cache].img;
  *ax = cache[n_cache].ax;
  *ay = cache[n_cache].ay;
  n_cache++;
  return 1;
}

/* place(): obraz zaczepiony wierzchołkiem rombu pola (gx, gy) */
static Spr *place(int gx, int gy, const char *key, int32_t depth, int dx, int dy) {
  Spr *s;
  int ax, ay;
  if (n_spr >= MAX_SPR) return NULL;
  s = &spr[n_spr];
  if (!art(key, &s->img, &ax, &ay)) return NULL;
  s->x = (int16_t)(iso_x((float)gx, (float)gy) - ax + dx);
  s->y = (int16_t)(iso_y((float)gx, (float)gy) - ay + dy);
  s->depth = depth;
  s->cell = (int16_t)gidx(gx, gy);
  s->flip = 0;
  s->flat = 0;
  n_spr++;
  return s;
}

/* ------------------------------------------------------------------ budowa świata (buildWorld) */
static const float FLOOR_SPILL[FL_COUNT] = {3, 0, 0, 1, 0, 2, 0, 2.5f, 0, 0};   /* sand, ..., rubble 1, dirt 2, grass_dead 2.5 */
static const uint8_t FACADES_N[4] = {4, 2, 2, 1};

static int high(int gx, int gy) { return in_bounds(gx, gy) && grid_kind(&mission.map.grid, gx, gy) == CELL_HIGH; }

static void build_world(void) {
  const TacticalMap *m = &mission.map;
  int gx, gy, i;
  char k[48];
  static int16_t bld_at[GRID_N];
  static uint8_t solid[GRID_N], prop_at[GRID_N];
  n_spr = 0;
  for (gy = 0; gy < MAP_H; gy++)
    for (gx = 0; gx < MAP_W; gx++) {
      int type = m->floor[gidx(gx, gy)], h = (int)floor(hash2(gx, gy, (int)m->seed) * 1000);
      int variant = type == FL_METAL && h % 9 == 0 ? 3 : h % 3, d, mask = 0;
      float mine = FLOOR_SPILL[type];
      int spill[FL_COUNT];
      static const int8_t NB[4][3] = {{-1, 0, 1}, {0, -1, 2}, {1, 0, 4}, {0, 1, 8}};
      snprintf(k, sizeof k, "floor_%s_%d", FLOOR_KEYS[type], variant);
      place(gx, gy, k, D_GROUND, 0, 0);
      /* przejścia terenu: miękki materiał sąsiada wchodzi na pole (rosnąco wg FLOOR_SPILL) */
      memset(spill, 0, sizeof spill);
      for (d = 0; d < 4; d++) {
        int nx = gx + NB[d][0], ny = gy + NB[d][1], other;
        if (!in_bounds(nx, ny)) continue;
        other = m->floor[gidx(nx, ny)];
        if (FLOOR_SPILL[other] > mine) spill[other] |= NB[d][2];
      }
      {
        static const int ORDER[4] = {FL_RUBBLE, FL_DIRT, FL_GRASS_DEAD, FL_SAND};
        for (d = 0; d < 4; d++)
          if (spill[ORDER[d]]) {
            snprintf(k, sizeof k, "blend_%s_%d_%d", FLOOR_KEYS[ORDER[d]], spill[ORDER[d]], h % 2);
            place(gx, gy, k, D_GROUND, 0, 0);
          }
      }
      if (gy == MAP_H - 1) {
        snprintf(k, sizeof k, "edge_l_%s", BIOME_KEYS[biome]);
        place(gx, gy, k, D_EDGE, 0, 0);
      }
      if (gx == MAP_W - 1) {
        snprintf(k, sizeof k, "edge_r_%s", BIOME_KEYS[biome]);
        place(gx, gy, k, D_EDGE, 0, 0);
      }
      if (!high(gx, gy)) {
        mask = (high(gx - 1, gy) ? 1 : 0) | (high(gx, gy - 1) ? 2 : 0) | (high(gx + 1, gy) ? 4 : 0) | (high(gx, gy + 1) ? 8 : 0);
        if (!(mask & 3) && high(gx - 1, gy - 1)) mask |= 16;
        if (mask) {
          snprintf(k, sizeof k, "ao_%d", mask);
          place(gx, gy, k, D_AO, 0, 0);
        }
      }
    }
  /* kalkomanie */
  {
    static const char *const DEC[4][7] = {{"scorch", "oil", "stain", "stain", "moss", "sand"}, {"stain", "stain", "scorch", "scorch", "moss", "stain", "blood"},
                                          {"oil", "oil", "stain", "scorch", "moss"}, {"oil", "stain", "stain", "blood", "moss"}};
    static const int DEC_N[4] = {6, 7, 5, 5};
    Mul R;
    int n = jround(MAP_W * MAP_H / 11.0);
    R.a = m->seed ^ 0x5eedu;
    for (i = 0; i < n; i++) {
      int x = (int)floor(mul_next(&R) * MAP_W), y = (int)floor(mul_next(&R) * MAP_H), v, ddx, ddy;
      const char *type;
      Spr *s;
      if (grid_kind(&m->grid, x, y) == CELL_HIGH) continue;
      type = DEC[biome][(int)floor(mul_next(&R) * DEC_N[biome])];
      v = (int)floor(mul_next(&R) * 5);
      ddx = jround((mul_next(&R) - 0.5) * 12);
      ddy = jround((mul_next(&R) - 0.5) * 6);
      snprintf(k, sizeof k, "decal_%s_%d", type, v);
      s = place(x, y, k, D_DECAL, ddx, ddy);
      if (mul_next(&R) < 0.5 && s) s->flip = 1;
    }
  }
  /* budynki */
  for (i = 0; i < GRID_N; i++) bld_at[i] = -1;
  for (i = 0; i < m->n_buildings; i++) {
    const MapBuilding *b = &m->buildings[i];
    int x, y;
    for (y = b->gy; y < b->gy + b->d; y++)
      for (x = b->gx; x < b->gx + b->w; x++)
        if (in_bounds(x, y)) bld_at[gidx(x, y)] = (int16_t)i;
  }
#define SAMEB(x, y, bi) (in_bounds(x, y) && bld_at[gidx(x, y)] == (bi))
  for (i = 0; i < m->n_buildings; i++) {
    const MapBuilding *b = &m->buildings[i];
    int x, y, ci = b->seed % FACADES_N[biome];
    for (y = b->gy; y < b->gy + b->d; y++)
      for (x = b->gx; x < b->gx + b->w; x++) {
        int open, seed;
        if (!in_bounds(x, y)) continue;
        open = (SAMEB(x, y + 1, i) ? 0 : 1) | (SAMEB(x + 1, y, i) ? 0 : 2) | (SAMEB(x - 1, y, i) ? 0 : 4) | (SAMEB(x, y - 1, i) ? 0 : 8);
        seed = b->seed * 131 + x * 31 + y * 17;
        snprintf(k, sizeof k, "bld_%d_%d_%d_%d", b->h, open, ci, seed % 3);
        place(x, y, k, obj_depth(x, y, L_PROP), 0, 0);
      }
  }
  /* lite ściany bunkra */
  memset(solid, 0, sizeof solid);
  for (i = 0; i < m->n_solids; i++) solid[gidx(m->solids[i].gx, m->solids[i].gy)] = 1;
#define ISSOLID(x, y) (!in_bounds(x, y) || solid[gidx(x, y)])
  for (i = 0; i < m->n_solids; i++) {
    int x = m->solids[i].gx, y = m->solids[i].gy, open = (ISSOLID(x, y + 1) ? 0 : 1) | (ISSOLID(x + 1, y) ? 0 : 2);
    snprintf(k, sizeof k, "bunker_%d_%d", open, (int)floor(hash2(x, y, 3) * 4));
    place(x, y, k, obj_depth(x, y, L_PROP), 0, 0);
  }
  /* rekwizyty, dekoracje, drzwi */
  memset(prop_at, 0xff, sizeof prop_at);
  for (i = 0; i < m->n_props; i++) prop_at[gidx(m->props[i].gx, m->props[i].gy)] = m->props[i].type;
  for (i = 0; i < m->n_decor; i++) prop_at[gidx(m->decor[i].gx, m->decor[i].gy)] = m->decor[i].type;
#define ISWALL(x, y) (in_bounds(x, y) && (prop_at[gidx(x, y)] == PR_WALL || prop_at[gidx(x, y)] == PR_WALL_BROKEN || prop_at[gidx(x, y)] == PR_DOOR))
  {
    int pass;
    for (pass = 0; pass < 3; pass++) {
      int n = pass == 0 ? m->n_props : pass == 1 ? m->n_deco : m->n_decor, j;
      for (j = 0; j < n; j++) {
        MapProp p;
        int x, y;
        if (pass == 0) p = m->props[j];
        else if (pass == 1) p = m->deco[j];
        else {
          p.gx = m->decor[j].gx;
          p.gy = m->decor[j].gy;
          p.type = m->decor[j].type;
          p.rot = 0;
          p.seed = (uint16_t)(p.gx * 7 + p.gy);
        }
        x = p.gx;
        y = p.gy;
        if (p.type == PR_WALL || p.type == PR_WALL_BROKEN) {
          int conn = (ISWALL(x - 1, y) ? 1 : 0) | (ISWALL(x + 1, y) ? 2 : 0) | (ISWALL(x, y - 1) ? 4 : 0) | (ISWALL(x, y + 1) ? 8 : 0);
          int shape = conn ? conn : (p.rot % 2 ? 12 : 3);
          snprintf(k, sizeof k, "wall_%d_%d_%d_%d", conn, shape, p.type == PR_WALL_BROKEN, p.seed % 3);
          place(x, y, k, obj_depth(x, y, L_PROP), 0, 0);
        } else {
          int v = p.seed % (p.type == PR_CAR || p.type == PR_SCRAP_PILE ? 7 : 3);
          int rot = p.type == PR_DOOR ? (ISWALL(x - 1, y) || ISWALL(x + 1, y) ? 0 : 1) : p.rot;
          Spr *s;
          snprintf(k, sizeof k, "prop_%s_%d_%d", PROP_KEYS[p.type], rot % 2, v);
          s = place(x, y, k, p.type == PR_SKELETON ? D_DECAL : obj_depth(x, y, L_PROP), 0, 0);
          if (s && p.type == PR_SKELETON) s->flat = 1;
        }
      }
    }
  }
  /* skrzynie, cel "odzyskaj", obiekty celów */
  for (i = 0; i < m->n_crates; i++) place(m->crates[i].gx, m->crates[i].gy, "loot_crate", obj_depth(m->crates[i].gx, m->crates[i].gy, L_PROP), 0, 0);
  if (m->has_obj && mission.item_thing >= 0 && !mission.things[mission.item_thing].done)
    place(m->obj.gx, m->obj.gy, "objective", obj_depth(m->obj.gx, m->obj.gy, L_PROP), 0, 0);
  for (i = 0; i < mission.n_things; i++) {
    const MissionThing *th = &mission.things[i];
    if (!th->objective || (th->kind != TH_DEVICE && th->kind != TH_NEST) || (th->kind == TH_NEST && th->done)) continue;
    if (th->kind == TH_DEVICE) snprintf(k, sizeof k, "prop_terminal_0_0");
    else snprintf(k, sizeof k, "mission_nest_%d", (th->gx * 7 + th->gy * 13) % 3);
    place(th->gx, th->gy, k, obj_depth(th->gx, th->gy, L_PROP), 0, 0);
  }
  /* strefa ewakuacji: słupki w rogach (lekko na zewnątrz) */
  {
    const EntryZone *e = &m->entry;
    const int P[4][2] = {{e->x0, e->y0}, {e->x1, e->y0}, {e->x0, e->y1}, {e->x1, e->y1}};
    for (i = 0; i < 4; i++) {
      float cx = P[i][0] + 0.5f + (P[i][0] == e->x0 ? -0.42f : 0.42f), cy = P[i][1] + 0.5f + (P[i][1] == e->y0 ? -0.42f : 0.42f);
      int ax, ay;
      Spr *s = &spr[n_spr];
      if (n_spr >= MAX_SPR || !art("extract_post", &s->img, &ax, &ay)) continue;
      s->x = (int16_t)(iso_x(cx - 0.5f, cy - 0.5f) - ax);
      s->y = (int16_t)(iso_y(cx - 0.5f, cy - 0.5f) - ay);
      s->depth = obj_depth((int)cx, (int)cy, L_PROP);
      s->cell = -1;
      s->flip = s->flat = 0;
      n_spr++;
    }
  }
}

/* sortowanie po głębi, przy równej - kolejność dodania (jak lista wyświetlania Phasera) */
static int cmp_spr(const void *a, const void *b) {
  const Spr *x = (const Spr *)a, *y = (const Spr *)b;
  if (x->depth != y->depth) return x->depth < y->depth ? -1 : 1;
  return x < y ? -1 : x > y;
}
static void sort_world(void) {
  /* stabilnie: qsort nie jest stabilny - indeks w wysokich bitach nie mieści się, więc sortowanie przez wstawianie */
  int i, j;
  for (i = 1; i < n_spr; i++) {
    Spr t = spr[i];
    for (j = i; j > 0 && spr[j - 1].depth > t.depth; j--) spr[j] = spr[j - 1];
    spr[j] = t;
  }
  (void)cmp_spr;
}

/* ------------------------------------------------------------------ postacie */
static int load_frame(Lib *l, const char *name, AtlasImg *out) {
  const LibEntry *e = lib_find(l, name);
  uint8_t *rgba;
  int ok;
  if (!e) return 0;
  rgba = lib_decode(l, e);
  if (!rgba) return 0;
  ok = atlas_add(&atlas, rgba, e->w, e->h, out);
  free(rgba);
  return ok;
}

static void make_unit(Actor *a) {
  UnitV *u = &units[n_units];
  Lib l;
  char name[48];
  int d, f;
  memset(u, 0, sizeof *u);
  u->a = a;
  u->pc = a->side == SIDE_PC;
  if (u->pc) snprintf(name, sizeof name, "unit_%s", RECRUIT_DEFS[a->ch->recruit < RECRUIT_COUNT ? a->ch->recruit : 0].key);
  else if (a->side == SIDE_ENEMY && a->ch->template_id < ENEMY_COUNT) snprintf(name, sizeof name, "unit_en_%s", ENEMY_DEFS[a->ch->template_id].key);
  else snprintf(name, sizeof name, "unit_en_raider_thug");
  if (!lib_load(&l, name)) {
    fprintf(stderr, "Najemnicy: %s\n", img_error());
    return;
  }
  if (u->pc) {
    for (d = 0; d < 8; d++) {
      for (f = 0; f < 5; f++) {
        snprintf(name, sizeof name, "d_%s_idle%d", DIR8[d], f);
        load_frame(&l, name, &u->idle[d][f]);
      }
      for (f = 0; f < 8; f++) {
        snprintf(name, sizeof name, "d_%s_walk%d", DIR8[d], f);
        if (load_frame(&l, name, &u->walk[d][f])) u->has_walk = 1;
      }
    }
    u->n_walk = 8;
  } else {
    for (f = 0; f < 5; f++) {
      snprintf(name, sizeof name, "f_idle%d", f);
      load_frame(&l, name, &u->idle[0][f]);
      snprintf(name, sizeof name, "b_idle%d", f);
      load_frame(&l, name, &u->idle[1][f]);
    }
    for (f = 0; f < 4; f++) {
      snprintf(name, sizeof name, "f_walk%d", f);
      if (load_frame(&l, name, &u->walk[0][f])) u->has_walk = 1;
      snprintf(name, sizeof name, "b_walk%d", f);
      load_frame(&l, name, &u->walk[1][f]);
    }
    u->n_walk = 4;
  }
  lib_free(&l);
  u->x = iso_x((float)a->gx, (float)a->gy);
  u->y = iso_y((float)a->gx, (float)a->gy) + TILE_H / 2;
  u->dir = 2;
  u->step = (int)floor(hash2(a->gx, a->gy, 5) * 4);
  n_units++;
}

/* kierunek patrzenia z wektora siatki: ekran = (dx - dy, (dx + dy) / 2) */
static void face(UnitV *u, int dgx, int dgy) {
  float sx = (float)(dgx - dgy), sy = (dgx + dgy) * 0.5f, ax = sx < 0 ? -sx : sx, ay = sy < 0 ? -sy : sy;
  if (!dgx && !dgy) return;
  if (ay < ax * 0.41421f) u->dir = sx >= 0 ? 0 : 4;
  else if (ax < ay * 0.41421f) u->dir = sy >= 0 ? 2 : 6;
  else if (sx >= 0) u->dir = sy >= 0 ? 1 : 7;
  else u->dir = sy >= 0 ? 3 : 5;
}

/* ------------------------------------------------------------------ mgła wojny */
static void update_fog(void) {
  int i;
  for (i = 0; i < GRID_N; i++) {
    int next = mission.vis[i] ? 2 : mission.explored[i] ? 1 : 0;
    if (next && !cell_state[i]) cell_reveal[i] = 0;
    cell_state[i] = (uint8_t)next;
  }
}

/* ------------------------------------------------------------------ wejście / wyjście */
static void enter(void) {
  static const uint32_t MEMORY[4] = {0x2a2e48, 0x262c4a, 0x283044, 0x262c42};
  MissionContract mc;
  const Contract *c;
  char name[32];
  int i;
  loaded = 0;
  n_units = n_cache = 0;
  busy = combat_note = 0;
  dlg.open = 0;
  if (g_job < 0 || g_job >= g_camp.n_contracts) return;
  c = &g_camp.contracts[g_job];
  biome = c->biome;
  memset(&mc, 0, sizeof mc);
  mc.id = c->id;
  mc.type = c->type;
  mc.level = c->level;
  mc.biome = c->biome;
  mc.n_enemies = c->n_enemies;
  memcpy(mc.enemies, c->enemies, (size_t)c->n_enemies);
  mc.item = c->obj_item;
  for (i = 0; i < g_camp.n_party; i++) party_ptr[i] = &g_camp.party[i];
  game_rng(&mrng);
  mission_init(&mission, &mc, party_ptr, g_camp.n_party, &mrng);
  if (!lib_load(&lib_common, "lib_common")) {
    fprintf(stderr, "Najemnicy: %s\n", img_error());
    return;
  }
  snprintf(name, sizeof name, "lib_%s", BIOME_KEYS[biome]);
  if (!lib_load(&lib_biome, name)) {
    fprintf(stderr, "Najemnicy: %s\n", img_error());
    return;
  }
  atlas_init(&atlas);
  build_world();
  sort_world();
  {
    int ax, ay;
    art("fx_shadow", &img_shadow, &ax, &ay);
    art("fx_cursor", &img_cursor, &ax, &ay);
  }
  for (i = 0; i < mission.n_actors; i++) make_unit(mission.actors[i]);
  atlas_finish(&atlas);
  lib_free(&lib_common);
  lib_free(&lib_biome);
  memory_tint = MEMORY[biome];
  memset(cell_state, 0, sizeof cell_state);
  update_fog();
  memset(cell_reveal, 255, sizeof cell_reveal);
  leader = 0;
  cursor = apos(mission.pcs[0]);
  cam_x = iso_x(cursor.gx, cursor.gy);
  cam_y = iso_y(cursor.gx, cursor.gy);
  clock_reset(&clock, 0);
  loaded = 1;
}

static void leave(void) {
  atlas_free(&atlas);
  n_units = 0;
}

/* ------------------------------------------------------------------ ruch */
static UnitV *unit_of(const Actor *a) {
  int i;
  for (i = 0; i < n_units; i++) if (units[i].a == a) return &units[i];
  return NULL;
}

static void explore_to(Pos target) {
  static ExploreResult r;
  Actor *sel = mission.pcs[leader];
  int i;
  if (busy || sel->state != AST_UP) return;
  mission_explore_move(&mission, sel, target, 1, &r);
  if (!r.ok) {
    app_sfx("error", 128, 256);
    return;
  }
  for (i = 0; i < r.n; i++) {
    UnitV *u = unit_of(r.paths[i].actor);
    if (!u || !r.paths[i].n) continue;
    memcpy(u->path, r.paths[i].path, sizeof(Pos) * (size_t)r.paths[i].n);
    u->n_path = r.paths[i].n;
    u->path_i = 0;
    u->path_ms = 0;
    u->walking = 1;
    busy = 1;
  }
  update_fog();
}

static void update(unsigned held, unsigned pressed, int ms) {
  int i, ticks = clock_advance(&clock, ms, 10), moving = 0;
  (void)ticks;
  ui_toast_update(ms);
  /* odsłanianie pól */
  for (i = 0; i < GRID_N; i++)
    if (cell_state[i] && cell_reveal[i] < 255) cell_reveal[i] = (uint8_t)(cell_reveal[i] + ms * 255 / 250 > 255 ? 255 : cell_reveal[i] + ms * 255 / 250);
  /* animacje postaci: spoczynek (UNIT_IDLE) albo chód po ścieżce, krok 130 ms */
  for (i = 0; i < n_units; i++) {
    UnitV *u = &units[i];
    if (u->walking) {
      Pos to = u->path[u->path_i];
      float tx = iso_x(to.gx, to.gy), ty = iso_y(to.gx, to.gy) + TILE_H / 2, k;
      if (!u->path_ms) {
        int fx = (int)floor(((u->x - 0) / 16 + (u->y - 8) / 8) / 2 + 0.5f), fy = (int)floor(((u->y - 8) / 8 - u->x / 16) / 2 + 0.5f);
        face(u, to.gx - fx, to.gy - fy);
        u->from.gx = (int8_t)fx;
        u->from.gy = (int8_t)fy;
      }
      u->path_ms += ms;
      k = u->path_ms / (float)STEP_MS;
      if (k > 1) k = 1;
      {
        float fx = iso_x(u->from.gx, u->from.gy), fy = iso_y(u->from.gx, u->from.gy) + TILE_H / 2;
        u->x = fx + (tx - fx) * k;
        u->y = fy + (ty - fy) * k;
      }
      if (u->path_ms >= STEP_MS) {
        u->path_ms = 0;
        if (++u->path_i >= u->n_path) {
          u->walking = 0;
          u->x = tx;
          u->y = ty;
        }
      }
      u->ms += ms;
      while (u->ms >= 105) {
        u->ms -= 105;
        u->step = (u->step + 1) % u->n_walk;
      }
      moving = 1;
    } else {
      u->ms += ms;
      while (u->ms >= 100 + UNIT_IDLE[u->step % UNIT_IDLE_STEPS].ms) {
        u->ms -= 100 + UNIT_IDLE[u->step % UNIT_IDLE_STEPS].ms;
        u->step = (u->step + 1) % UNIT_IDLE_STEPS;
      }
    }
  }
  if (busy && !moving) {
    busy = 0;
    if (mission_in_combat(&mission) && !combat_note) {
      combat_note = 1;
      ui_toast("Wr\363g was zauwa\277y\263! Walka nie jest jeszcze przeniesiona \200 Esc: wycofanie.", PAL_BAD);
    }
  }
  /* kamera za liderem */
  {
    UnitV *u = unit_of(mission.pcs[leader]);
    float k = ms / 250.0f > 1 ? 1 : ms / 250.0f;
    if (u) {
      cam_x += (u->x - cam_x) * k;
      cam_y += (u->y - 20 - cam_y) * k;
    }
  }
  if (app_leaving()) return;
  if (dlg.open) {
    int r = ui_dialog_input(&dlg, pressed);
    if (r == 1) {
      snprintf(g_notice, sizeof g_notice, "Dru\277yna wycofa\263a si\352 z misji.");
      app_switch(SCR_HUB, 500, 500);
    }
    return;
  }
  if (pressed & IN_BACK) {
    static const char *const B[2] = {"ZOSTA\321", "WYCOFAJ SI\312"};
    static const int K[2] = {BTN_PLAIN, BTN_DANGER};
    ui_dialog_open(&dlg, "WYCOFA\306 SI\312?", "Dru\277yna wr\363ci do Przystani bez wykonania zlecenia.", 2, B, K, 0);
    return;
  }
  /* kursor: kierunki ekranu -> siatka (prawo = +gx -gy, dół = +gx +gy), powtarzanie przy trzymaniu */
  {
    unsigned dirs = held & (IN_UP | IN_DOWN | IN_LEFT | IN_RIGHT);
    int step = 0;
    if (pressed & (IN_UP | IN_DOWN | IN_LEFT | IN_RIGHT)) {
      step = 1;
      rep_ms = 250;
    } else if (dirs) {
      rep_ms -= ms;
      if (rep_ms <= 0) {
        step = 1;
        rep_ms = 90;
      }
    }
    if (step) {
      int sx = (dirs & IN_RIGHT ? 1 : 0) - (dirs & IN_LEFT ? 1 : 0), sy = (dirs & IN_DOWN ? 1 : 0) - (dirs & IN_UP ? 1 : 0);
      int dgx = sx + sy, dgy = sy - sx;
      if (dgx > 1) dgx = 1;
      if (dgx < -1) dgx = -1;
      if (dgy > 1) dgy = 1;
      if (dgy < -1) dgy = -1;
      if (in_bounds(cursor.gx + dgx, cursor.gy + dgy)) {
        cursor.gx = (int8_t)(cursor.gx + dgx);
        cursor.gy = (int8_t)(cursor.gy + dgy);
      }
    }
  }
  if (pressed & IN_OK && !mission_in_combat(&mission)) explore_to(cursor);
}

/* ------------------------------------------------------------------ rysowanie */
static void draw_unit(const UnitV *u) {
  const AtlasImg *im;
  int flip = 0;
  if (!u->a->ch) return;
  if (u->pc) im = u->walking && u->has_walk ? &u->walk[u->dir][u->step % 8] : &u->idle[u->dir][UNIT_IDLE[u->step % UNIT_IDLE_STEPS].frame];
  else {
    int back = u->dir >= 5 || u->dir == 0;   /* N, NE, E: tył */
    flip = u->dir >= 3 && u->dir <= 6;        /* w lewo: lustro */
    im = u->walking && u->has_walk ? &u->walk[back][u->step % 4] : &u->idle[back][UNIT_IDLE[u->step % UNIT_IDLE_STEPS].frame];
  }
  if (!im->w) return;
  atlas_draw(&atlas, im, u->x - im->w * 0.5f, u->y - im->h * 0.875f, flip, 0xffffff, 255);
}

static int unit_shown(const UnitV *u) {
  Pos p = mkpos((int)u->a->gx, (int)u->a->gy);
  if (u->a->side == SIDE_PC) return 1;
  if (u->a->side == SIDE_NEUTRAL) return mission_is_visible(&mission, p) || u->a->following;
  return u->a->state == AST_DEAD ? mission.explored[gidx(p.gx, p.gy)] : mission_is_visible(&mission, p);
}

static void draw(void) {
  int i, j, order[MAX_UNITS], n = 0;
  int32_t ud[MAX_UNITS];
  char buf[96];
  r2d_rect(0, 0, V_W, V_H, BIOME_BG[biome], 255);
  if (!loaded) {
    font_draw_at(V_W / 2, V_H / 2, 0.5f, 0.5f, "Brak plik\363w grafiki misji (katalog gfx/)", PAL_BAD, 255, FONT_OUTLINE, 0, 1);
    return;
  }
  r2d_offset(V_W / 2.0f - cam_x, V_H / 2.0f - cam_y);
  /* postacie w kolejności głębi */
  for (i = 0; i < n_units; i++) {
    const UnitV *u = &units[i];
    int gx = (int)floor((u->x / 16 + (u->y - 8) / 8) / 2 + 0.5f), gy = (int)floor(((u->y - 8) / 8 - u->x / 16) / 2 + 0.5f);
    if (!unit_shown(u)) continue;
    ud[i] = obj_depth(gx, gy, L_UNIT);
    for (j = n; j > 0 && ud[order[j - 1]] > ud[i]; j--) order[j] = order[j - 1];
    order[j] = i;
    n++;
  }
  j = 0;
  {
    int overlay = 0;
    for (i = 0; i <= n_spr; i++) {
      const Spr *s = i < n_spr ? &spr[i] : NULL;
      int st, a;
      /* kursor i cienie postaci po podłodze i okluzji (D_AO), przed obiektami */
      if (!overlay && (!s || s->depth > D_AO)) {
        int k;
        overlay = 1;
        atlas_draw(&atlas, &img_cursor, iso_x(cursor.gx, cursor.gy) - img_cursor.w / 2.0f, iso_y(cursor.gx, cursor.gy), 0, 0xffffff, 255);
        for (k = 0; k < n; k++) {
          const UnitV *u = &units[order[k]];
          atlas_draw(&atlas, &img_shadow, u->x - img_shadow.w / 2.0f, u->y - img_shadow.h / 2.0f, 0, 0xffffff, 255);
        }
      }
      if (!s) break;
      while (j < n && ud[order[j]] < s->depth) draw_unit(&units[order[j++]]);
      if (s->cell < 0) {
        atlas_draw(&atlas, &s->img, s->x, s->y, s->flip, 0xffffff, 255);
        continue;
      }
      st = cell_state[s->cell];
      if (!st) continue;
      a = cell_reveal[s->cell];
      atlas_draw(&atlas, &s->img, s->x, s->y, s->flip, st == 2 ? 0xffffff : memory_tint, a);
    }
  }
  while (j < n) draw_unit(&units[order[j++]]);
  r2d_offset(0, 0);
  /* pasek drużyny (tymczasowy HUD) */
  r2d_rect(0, 0, V_W, 13, PAL_PANEL, 230);
  r2d_rect(0, 13, V_W, 1, PAL_EDGE, 255);
  snprintf(buf, sizeof buf, "%s", g_camp.contracts[g_job].title);
  font_draw(6, 3, buf, PAL_AMBER, 255, FONT_OUTLINE, 0, 1);
  {
    float x = V_W - 6;
    for (i = mission.n_pcs - 1; i >= 0; i--) {
      const Character *ch = mission.pcs[i]->ch;
      char nm[48];
      int k = 0;
      const char *s = ch->name;
      while (*s && *s != ' ' && k < 30) nm[k++] = *s++;
      nm[k] = 0;
      snprintf(buf, sizeof buf, "%s %d/%d", nm, ch->hp, ch->max_hp);
      x -= font_measure(buf, 0);
      font_draw(x, 3, buf, i == leader ? PAL_AMBER : PAL_TEXT, 255, FONT_OUTLINE, 0, 1);
      x -= 12;
    }
  }
  font_draw_at(V_W - 6, V_H - 4, 1, 1, "Strza\263ki: kursor \205 fire: id\274 \205 Esc: wycofanie", PAL_DIM, 255, FONT_OUTLINE, 0, 1);
  ui_dialog_draw(&dlg);
  ui_toast_draw();
}

const Screen SCREEN_MISSION = {enter, update, draw, leave};
