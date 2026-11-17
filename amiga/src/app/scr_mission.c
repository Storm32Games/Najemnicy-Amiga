/* Misja taktyczna (port src/scenes/WorldScene.ts) - etap 1: świat izometryczny z biblioteki grafik (lib_common +
 * lib_<biom>, klucze jak ArtBook w buildWorld), mgła wojny (mission.vis / explored), drużyna i wrogowie (biblioteki
 * klatek unit_<id>), kursor pola joystickiem, ruch w eksploracji (mission_explore_move); etap 2: walka turowa -
 * sygnały logiki (combat_on / mission_on) kopiowane do kolejki i odgrywane po kolei (ruch, atak, trafienia, stany),
 * tura gracza (zasięg ruchu, szansa trafienia, menu tury), tura wrogów (ai_step). Akcje specjalne, przedmioty,
 * interakcje i pełny HUD - kolejne etapy. Plik w UTF-8, napisy przekodowuje tools/amiga/latin2_literals.py. */
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
#include "../core/rules.h"
#include "../core/character.h"
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

typedef struct { AtlasImg img; int16_t x, y; int32_t depth; int16_t cell; uint8_t flip, flat, tag, hidden; } Spr;
enum { TAG_NONE, TAG_CRATE, TAG_OBJECTIVE, TAG_NEST };
static Spr spr[MAX_SPR];
static int n_spr;
static uint8_t cell_state[GRID_N];   /* 0 nieodkryte, 1 zapamiętane, 2 widoczne */
static uint8_t cell_reveal[GRID_N];  /* 0..255 */
static uint32_t memory_tint;

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
  s->tag = TAG_NONE;
  s->hidden = 0;
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
  for (i = 0; i < m->n_crates; i++) {
    Spr *c = place(m->crates[i].gx, m->crates[i].gy, "loot_crate", obj_depth(m->crates[i].gx, m->crates[i].gy, L_PROP), 0, 0);
    if (c) c->tag = TAG_CRATE;
  }
  if (m->has_obj && mission.item_thing >= 0 && !mission.things[mission.item_thing].done) {
    Spr *o = place(m->obj.gx, m->obj.gy, "objective", obj_depth(m->obj.gx, m->obj.gy, L_PROP), 0, 0);
    if (o) o->tag = TAG_OBJECTIVE;
  }
  for (i = 0; i < mission.n_things; i++) {
    const MissionThing *th = &mission.things[i];
    if (!th->objective || (th->kind != TH_DEVICE && th->kind != TH_NEST) || (th->kind == TH_NEST && th->done)) continue;
    if (th->kind == TH_DEVICE) snprintf(k, sizeof k, "prop_terminal_0_0");
    else snprintf(k, sizeof k, "mission_nest_%d", (th->gx * 7 + th->gy * 13) % 3);
    {
      Spr *n = place(th->gx, th->gy, k, obj_depth(th->gx, th->gy, L_PROP), 0, 0);
      if (n && th->kind == TH_NEST) n->tag = TAG_NEST;
    }
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
static const char *const DIR8[8] = {"east", "south-east", "south", "south-west", "west", "north-west", "north", "north-east"};
enum { P_NONE, P_ATTACK, P_SHOOT, P_HURT, P_DIE, P_N };
static const char *const POSE_NAME[P_N] = {"", "attack", "shoot", "hurt", "die"};
static const int POSE_FRAMES[P_N] = {0, 5, 4, 3, 7};
#define FRAME_DOWN 4
#define FRAME_CORPSE 6

typedef struct {
  Actor *a;
  int pc;                            /* 1 = najemnik (PixelLab, 8 kierunków spoczynku / chodu) */
  AtlasImg idle[8][5], walk[8][8];   /* pc: [kierunek]; wróg: [0] przód, [1] tył */
  AtlasImg pose[2][P_N][7];          /* [przód / tył][poza][klatka] */
  int has_walk, n_walk;
  float x, y;                        /* stopy na ekranie */
  int dir, step, ms, walking;
  Pos path[MAX_PATH];
  int n_path, path_i, path_ms;
  Pos from;
  int pose_k, pose_f, pose_ms, hurt_ms;
} UnitV;
static UnitV units[MAX_UNITS];
static int n_units;
static AtlasImg img_shadow, img_cursor, img_crate_open;
static int crate_open_ax, crate_open_ay;

/* obraz obiektu na polu (tag) - podmiana / ukrycie po interakcji */
static Spr *spr_at(Pos p, int tag) {
  int i;
  for (i = 0; i < n_spr; i++) if (spr[i].tag == tag && spr[i].cell == gidx(p.gx, p.gy)) return &spr[i];
  return NULL;
}
static int leader;
static Pos cursor;
static float cam_x, cam_y;
static int rep_ms;
static TickClock clock;
static UiDialog dlg;

/* ---- kolejka sygnałów (dane kopiowane: bufory logiki są ważne tylko do następnej akcji) */
#define EV_MAX 8
typedef struct { Character *t; uint8_t type, degree, cond; int16_t amount; } EvHit;
typedef struct {
  uint8_t kind;                      /* SIG_* albo 100 + MSIG_* */
  Actor *a, *b;
  Pos path[MAX_PATH];
  int n_path;
  uint8_t ranged, from, to, ambush, has_d20;
  CheckResult d20;
  int dmg;
  EvHit ev[EV_MAX];
  int n_ev;
  char label[40];
} Sig;
#define QUEUE_MAX 96
static Sig queue[QUEUE_MAX];
static int q_head, q_n;

/* ---- przebieg */
enum { M_EXPLORE, M_COMBAT, M_PLAYER, M_AI, M_OVER };
static int mode, wait_ms, stall, over_ms;
static TurnInfo *turn;
static Actor *ai_actor;
static int turn_banner_enemy;
static Search reach;
static int reach_sp, reach_ok;

/* ---- menu akcji, celowanie, interakcje, pytania */
static UiMenu menu;
static UiChoice choice;
enum { MD_NONE, MD_STEP, MD_STRIKE, MD_ABILITY, MD_ITEM };
static int tmode, tmode_arg, sub_items;
static char tmode_hint[120];
enum { CH_SKILL, CH_AFTER, CH_EXTRACT, CH_RETREAT };
static int choice_kind;
static uint8_t choice_skill[UI_CHOICE_MAX];
static MissionThing *pending_th, *choice_th;
static int complete_ask, extract_asked, after_explore;
enum { A_STRIDE = 1, A_STEP, A_STRIKE, A_ITEMS, A_BACK, A_INTERACT, A_DELAY, A_END, A_RETREAT, A_LEADER, A_ABIL = 100, A_ITEM = 200 };

/* ---- napisy nad postaciami, baner, dziennik */
typedef struct { float x, y; char text[24]; uint32_t col; int ms; } Float;
static Float floats[24];
static int n_floats;
static char banner[48], banner_sub[48];
static uint32_t banner_col;
static int banner_ms;
#define LOG_N 5
static char log_line[LOG_N][120];
static uint32_t log_col[LOG_N];
static int n_log;

static void push_log(const char *t, uint32_t col) {
  if (n_log == LOG_N) {
    memmove(log_line, log_line + 1, sizeof log_line[0] * (LOG_N - 1));
    memmove(log_col, log_col + 1, sizeof log_col[0] * (LOG_N - 1));
    n_log--;
  }
  snprintf(log_line[n_log], sizeof log_line[0], "%s", t);
  log_col[n_log++] = col;
}

static void show_banner(const char *t, const char *sub, uint32_t col) {
  strncpy(banner, t, sizeof banner - 1);   /* przycięcie do bufora banera */
  banner[sizeof banner - 1] = 0;
  snprintf(banner_sub, sizeof banner_sub, "%s", sub ? sub : "");
  banner_col = col;
  banner_ms = 1400;
}

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
  int d, f, p, fb;
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
  for (fb = 0; fb < 2; fb++)
    for (p = 1; p < P_N; p++)
      for (f = 0; f < POSE_FRAMES[p]; f++) {
        snprintf(name, sizeof name, "%s_%s%d", fb ? "b" : "f", POSE_NAME[p], f);
        load_frame(&l, name, &u->pose[fb][p][f]);
      }
  lib_free(&l);
  u->x = iso_x((float)a->gx, (float)a->gy);
  u->y = iso_y((float)a->gx, (float)a->gy) + TILE_H / 2;
  u->dir = 2;
  u->step = (int)floor(hash2(a->gx, a->gy, 5) * 4);
  n_units++;
}

static void face(UnitV *u, int dgx, int dgy) {
  float sx = (float)(dgx - dgy), sy = (dgx + dgy) * 0.5f, ax = sx < 0 ? -sx : sx, ay = sy < 0 ? -sy : sy;
  if (!dgx && !dgy) return;
  if (ay < ax * 0.41421f) u->dir = sx >= 0 ? 0 : 4;
  else if (ax < ay * 0.41421f) u->dir = sy >= 0 ? 2 : 6;
  else if (sx >= 0) u->dir = sy >= 0 ? 1 : 7;
  else u->dir = sy >= 0 ? 3 : 5;
}

static UnitV *unit_of(const Actor *a) {
  int i;
  for (i = 0; i < n_units; i++) if (units[i].a == a) return &units[i];
  return NULL;
}
static UnitV *unit_of_ch(const Character *c) {
  int i;
  for (i = 0; i < n_units; i++) if (units[i].a->ch == c) return &units[i];
  return NULL;
}

static void pose(UnitV *u, int p) {
  if (!u) return;
  u->pose_k = p;
  u->pose_f = 0;
  u->pose_ms = 0;
}

static void float_above(const Actor *a, const char *t, uint32_t col) {
  UnitV *u = unit_of(a);
  int i, stack = 0;
  if (!u || n_floats >= 24) return;
  for (i = 0; i < n_floats; i++) if (floats[i].ms > 600 && floats[i].x == u->x) stack++;
  floats[n_floats].x = u->x;
  floats[n_floats].y = u->y - 34 - stack * 9;
  snprintf(floats[n_floats].text, sizeof floats[0].text, "%s", t);
  floats[n_floats].col = col;
  floats[n_floats].ms = 1000;
  n_floats++;
}

static int unit_visible(const UnitV *u) {
  Pos p = mkpos((int)u->a->gx, (int)u->a->gy);
  if (u->a->side == SIDE_PC) return 1;
  if (u->a->side == SIDE_NEUTRAL) return mission_is_visible(&mission, p) || u->a->following;
  return u->a->state == AST_DEAD ? mission.explored[gidx(p.gx, p.gy)] : mission_is_visible(&mission, p);
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

/* ------------------------------------------------------------------ słuchacze logiki */
static Sig *push_sig(int kind) {
  Sig *s;
  if (q_n >= QUEUE_MAX) return NULL;
  s = &queue[(q_head + q_n) % QUEUE_MAX];
  memset(s, 0, sizeof *s);
  s->kind = (uint8_t)kind;
  q_n++;
  return s;
}

static void copy_events(Sig *s, const ActionResult *r) {
  int i;
  if (!r) return;
  for (i = 0; i < r->n_events && s->n_ev < EV_MAX; i++) {
    const RuleEvent *e = &r->events[i];
    if (!e->target) continue;
    s->ev[s->n_ev].t = e->target;
    s->ev[s->n_ev].type = e->type;
    s->ev[s->n_ev].degree = e->degree;
    s->ev[s->n_ev].cond = e->cond;
    s->ev[s->n_ev].amount = e->amount;
    s->n_ev++;
  }
  if (r->has_d20) {
    s->has_d20 = 1;
    s->d20 = r->d20;
  }
  if (r->has_dmg) s->dmg = r->dmg.total;
}

static void on_combat(void *ctx, const CombatSignal *cs) {
  Sig *s;
  (void)ctx;
  switch (cs->kind) {
    case SIG_COMBAT_START: case SIG_ROUND: case SIG_TURN_START: case SIG_MOVE: case SIG_STRIKE: case SIG_ABILITY: case SIG_ITEM:
    case SIG_RULES: case SIG_STATE: break;
    default: return;
  }
  s = push_sig(cs->kind);
  if (!s) return;
  s->a = cs->actor;
  s->b = cs->other;
  s->ambush = cs->ambush;
  s->from = cs->from;
  s->to = cs->to;
  if (cs->kind == SIG_MOVE && cs->path) {
    s->n_path = cs->path_n < MAX_PATH ? cs->path_n : MAX_PATH;
    memcpy(s->path, cs->path, sizeof(Pos) * (size_t)s->n_path);
  }
  if (cs->info) s->ranged = cs->info->ranged;
  if (cs->kind == SIG_STRIKE && cs->info) snprintf(s->label, sizeof s->label, "%s", cs->info->weapon.name ? cs->info->weapon.name : "");
  if (cs->kind == SIG_ABILITY) snprintf(s->label, sizeof s->label, "%s", ABILITY_DEFS[cs->ability].name);
  if (cs->kind == SIG_ITEM) snprintf(s->label, sizeof s->label, "%s", ITEM_DEFS[cs->item].name);
  if (cs->kind == SIG_ROUND) s->n_path = cs->round;
  copy_events(s, cs->result);
}

static void on_mission(void *ctx, const MissionSignal *ms) {
  Sig *s;
  (void)ctx;
  if (ms->kind == MSIG_VISIBILITY || ms->kind == MSIG_OBJECTIVE) return;
  s = push_sig(100 + ms->kind);
  if (!s) return;
  s->a = ms->by;
  s->dmg = ms->kind == MSIG_CRATE ? ms->trap_damage : ms->scrap;
  if (ms->roll) {
    s->has_d20 = 1;
    s->d20 = *ms->roll;
  }
  if (ms->attempt) {
    s->has_d20 = 1;
    s->d20 = ms->attempt->roll;
    s->from = ms->attempt->opened;
    s->to = ms->attempt->alarm;
  }
  if (ms->thing) {
    s->path[0] = mkpos(ms->thing->gx, ms->thing->gy);
    s->ambush = ms->thing->kind;
    s->ranged = ms->thing->done;
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
  q_head = q_n = n_floats = n_log = 0;
  mode = M_EXPLORE;
  wait_ms = banner_ms = 0;
  turn = NULL;
  dlg.open = 0;
  menu.open = choice.open = 0;
  tmode = MD_NONE;
  sub_items = complete_ask = extract_asked = after_explore = 0;
  pending_th = choice_th = NULL;
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
  combat_on(&mission.combat, on_combat, NULL);
  mission_on(&mission, on_mission, NULL);
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
    art("loot_crate_open", &img_crate_open, &crate_open_ax, &crate_open_ay);
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
  push_log(c->title, PAL_AMBER);
  loaded = 1;
}

static void leave(void) {
  atlas_free(&atlas);
  n_units = 0;
}

/* ------------------------------------------------------------------ odgrywanie sygnałów */
static void start_walk(UnitV *u, const Pos *path, int n) {
  if (!u || !n) return;
  memcpy(u->path, path, sizeof(Pos) * (size_t)n);
  u->n_path = n;
  u->path_i = 0;
  u->path_ms = 0;
  u->walking = 1;
}

static int any_walking(void) {
  int i;
  for (i = 0; i < n_units; i++) if (units[i].walking) return 1;
  return 0;
}

static void short_name(const Character *c, char *out, int cap) {
  int k = 0;
  const char *s = c->name;
  while (*s && *s != ' ' && k < cap - 1) {
    if (*s != '"') out[k++] = *s;
    s++;
  }
  out[k] = 0;
}

static void show_events(const Sig *s) {
  int i;
  char t[24];
  for (i = 0; i < s->n_ev; i++) {
    const EvHit *e = &s->ev[i];
    UnitV *u = unit_of_ch(e->t);
    if (!u) continue;
    if (e->type == EV_DAMAGE && e->amount > 0) {
      int crit = e->degree == 3;
      if (u->a->state == AST_UP) pose(u, P_HURT);
      u->hurt_ms = 110;
      snprintf(t, sizeof t, crit ? "-%d!" : "-%d", e->amount);
      float_above(u->a, t, u->a->side == SIDE_PC ? 0xff5040 : crit ? 0xffe060 : 0x9ad84a);
      app_sfx(crit ? "crit" : "hit", 179, 256);
    } else if (e->type == EV_MISS) {
      float_above(u->a, "PUD\243O", 0xbbbbbb);
      app_sfx("miss", 154, 256);
    } else if (e->type == EV_HEAL && e->amount > 0) {
      snprintf(t, sizeof t, "+%d", e->amount);
      float_above(u->a, t, 0x7fe05a);
    } else if (e->type == EV_CONDITION && e->cond < COND_COUNT && e->cond != COND_DEAD && e->cond != COND_DYING) {
      float_above(u->a, CONDITION_DEFS[e->cond].name, 0xe0a0ff);
    }
  }
}

/* zaczyna odgrywać sygnał; czas trwania w wait_ms (ruch: do końca chodu) */
static void play(const Sig *s) {
  char buf[160], an[32], bn[32];
  UnitV *ua = s->a ? unit_of(s->a) : NULL, *ub = s->b ? unit_of(s->b) : NULL;
  switch (s->kind) {
    case SIG_COMBAT_START:
      show_banner(s->ambush ? "ZASADZKA!" : "WALKA!", NULL, s->ambush ? PAL_AMBER : PAL_BAD);
      app_sfx("alarm", 154, 256);
      update_fog();
      wait_ms = 450;
      break;
    case SIG_ROUND:
      snprintf(buf, sizeof buf, "Runda %d", s->n_path);
      push_log(buf, PAL_DIM);
      break;
    case SIG_TURN_START:
      if (s->a && s->a->side == SIDE_PC) {
        short_name(s->a->ch, an, sizeof an);
        snprintf(buf, sizeof buf, "TURA: %s", an);
        latin2_upper(buf);
        show_banner(buf, NULL, PAL_GOOD);
        turn_banner_enemy = 0;
      } else if (!turn_banner_enemy) {
        show_banner("TURA WROGA", NULL, PAL_BAD);
        turn_banner_enemy = 1;
      }
      app_sfx("turn", 256, 256);
      break;
    case SIG_MOVE:
      if (ua && s->n_path) {
        if (s->a->side != SIDE_PC && !unit_visible(ua)) {
          /* ruch w mgle: bez animacji */
          Pos e = s->path[s->n_path - 1];
          ua->x = iso_x(e.gx, e.gy);
          ua->y = iso_y(e.gx, e.gy) + TILE_H / 2;
        } else start_walk(ua, s->path, s->n_path);
      }
      break;
    case SIG_STRIKE:
      if (ua && ub) {
        face(ua, s->b->gx - s->a->gx, s->b->gy - s->a->gy);
        pose(ua, s->ranged ? P_SHOOT : P_ATTACK);
      }
      if (s->a && s->b && s->has_d20) {
        short_name(s->a->ch, an, sizeof an);
        short_name(s->b->ch, bn, sizeof bn);
        snprintf(buf, sizeof buf, "%s \222 %s (%s): k20 %d%s%d = %d vs KP %d \200 %s%s", an, bn, s->label, s->d20.d20, s->d20.mod >= 0 ? "+" : "", s->d20.mod, s->d20.total, s->d20.dc,
                 DEGREE_NAMES[s->d20.degree], "");
        push_log(buf, s->a->side == SIDE_PC ? (s->d20.degree >= 2 ? PAL_GOOD : PAL_DIM) : (s->d20.degree >= 2 ? PAL_BAD : PAL_DIM));
      }
      app_sfx(s->ranged ? "shot_rifle" : "melee", 256, 256);
      wait_ms = 200;
      break;
    case SIG_ABILITY: case SIG_ITEM:
      if (s->a) {
        short_name(s->a->ch, an, sizeof an);
        snprintf(buf, sizeof buf, "%s: %s", an, s->label);
        push_log(buf, PAL_AMBER);
      }
      show_events(s);
      wait_ms = 400;
      break;
    case SIG_RULES:
      if (s->n_ev) {
        show_events(s);
        wait_ms = 220;
      }
      break;
    case SIG_STATE:
      if (ua) {
        if (s->to == AST_DEAD) {
          if (s->from != AST_DOWN) pose(ua, P_DIE);
          if (s->a->side == SIDE_PC) float_above(s->a, "ZGIN\241\243", 0xff5040);
          app_sfx("death", 179, 256);
        } else if (s->to == AST_DOWN) {
          pose(ua, P_DIE);
          float_above(s->a, "POWALONY!", 0xff5040);
          app_sfx("scream", 256, 256);
        } else pose(ua, P_NONE);
      }
      break;
    case 100 + MSIG_SPOTTED:
      if (s->a && mission_is_visible(&mission, apos(s->a))) float_above(s->a, "!", 0xff5040);
      break;
    case 100 + MSIG_PICKUP:
      if (s->a) {
        snprintf(buf, sizeof buf, "+%d Z\263omu", s->dmg);
        float_above(s->a, buf, 0xffd040);
        app_sfx("coin", 256, 256);
      }
      break;
    case 100 + MSIG_DISCOVER:
      if (s->a) float_above(s->a, "!", 0xffd040);
      app_sfx("pickup", 128, 256);
      break;
    case 100 + MSIG_CRATE:
      if (s->a && s->has_d20) {
        short_name(s->a->ch, an, sizeof an);
        snprintf(buf, sizeof buf, "%s: skrzynia \200 k20 %d%s%d = %d vs KT %d \200 %s", an, s->d20.d20, s->d20.mod >= 0 ? "+" : "", s->d20.mod, s->d20.total, s->d20.dc, DEGREE_NAMES[s->d20.degree]);
        push_log(buf, s->d20.degree >= 2 ? PAL_GOOD : PAL_BAD);
        if (s->d20.degree == 0) {
          snprintf(buf, sizeof buf, "-%d", s->dmg);
          float_above(s->a, buf, 0xff5040);
          pose(ua, P_HURT);
          app_sfx("explosion", 256, 256);
        } else if (s->d20.degree == 1) float_above(s->a, s->ranged ? "ZACI\312TA" : "ZAMKNI\312TA", 0xbbbbbb);
        else {
          float_above(s->a, "\243up!", 0xffd040);
          app_sfx("coin", 256, 256);
        }
      }
      if (s->ranged && (!s->has_d20 || s->d20.degree != 1)) {
        Spr *c = spr_at(s->path[0], TAG_CRATE);
        if (c) {
          c->img = img_crate_open;
          c->x = (int16_t)(iso_x(s->path[0].gx, s->path[0].gy) - crate_open_ax);
          c->y = (int16_t)(iso_y(s->path[0].gx, s->path[0].gy) - crate_open_ay);
        }
      }
      wait_ms = 500;
      break;
    case 100 + MSIG_LOCK:
      if (s->a && s->has_d20) {
        short_name(s->a->ch, an, sizeof an);
        snprintf(buf, sizeof buf, "%s: %s \200 k20 %d%s%d = %d vs ST %d \200 %s", an, s->ambush == TH_DEVICE ? "hakowanie" : "zamek", s->d20.d20, s->d20.mod >= 0 ? "+" : "", s->d20.mod,
                 s->d20.total, s->d20.dc, DEGREE_NAMES[s->d20.degree]);
        push_log(buf, s->d20.degree >= 2 ? PAL_GOOD : PAL_BAD);
        float_above(s->a, s->from ? "OTWARTE" : s->to ? "ALARM!" : s->d20.degree >= 2 ? "POST\312P" : "NIEUDANE", s->from ? PAL_GOOD : s->to ? 0xff5040 : 0xbbbbbb);
      }
      wait_ms = 500;
      break;
    case 100 + MSIG_INTERACT:
      if (s->a) {
        static const char *const WHAT[6] = {"Skrzynia", "Cel zabrany!", "Uwolniony!", "Drzwi", "Urz\261dzenie", "Gniazdo zniszczone!"};
        float_above(s->a, WHAT[s->ambush < 6 ? s->ambush : 0], 0xffd040);
        if (s->ambush == TH_ITEM && spr_at(s->path[0], TAG_OBJECTIVE)) spr_at(s->path[0], TAG_OBJECTIVE)->hidden = 1;
        if (s->ambush == TH_NEST && s->ranged && spr_at(s->path[0], TAG_NEST)) spr_at(s->path[0], TAG_NEST)->hidden = 1;
        app_sfx("pickup", 256, 256);
      }
      wait_ms = 300;
      break;
    case 100 + MSIG_COMPLETE:
      complete_ask = 1;
      if (!mission_needs_extraction(&mission)) show_banner("CEL WYKONANY", NULL, PAL_GOOD);
      push_log("Cel zlecenia wykonany.", PAL_GOOD);
      app_sfx("radio", 179, 256);
      break;
    case 100 + MSIG_FINISH:
      mode = M_OVER;
      menu.open = choice.open = 0;
      if (mission.result.result == MRES_FAIL) {
        over_ms = 3600;
        show_banner("SYGNA\243 UTRACONY", NULL, PAL_BAD);
        push_log("Dru\277yna pada. Sygna\263 utracony.", PAL_BAD);
      } else {
        over_ms = mission.result.result == MRES_RETREAT ? 2200 : 4500;
        show_banner(mission.result.result == MRES_RETREAT ? "ODWR\323T" : "ZLECENIE WYKONANE", NULL, mission.result.result == MRES_RETREAT ? PAL_AMBER : PAL_GOOD);
      }
      break;
  }
}


static void set_mode(int m, int arg, const char *hint);
static void use_ability_at(Actor *a, int id, Pos cell, Actor *who);
static void use_item_at(Actor *a, int inv, Pos cell, Actor *who);
static void interact_with(Actor *a, MissionThing *th);

/* drugi etap ataku: wynik nad celem po animacji */
static Sig pending_hit;
static int pending_ms;

/* ------------------------------------------------------------------ akcje gracza */
static void refresh_reach(void) {
  reach_ok = 0;
  if (mode != M_PLAYER || !turn || turn->actions < 1) return;
  combat_reach_for(&mission.combat, turn->actor, turn->actions, &reach, &reach_sp);
  reach_ok = 1;
}

static Actor *visible_actor_at(Pos p) {
  int i;
  for (i = 0; i < mission.n_actors; i++) {
    Actor *a = mission.actors[i];
    UnitV *u;
    if (a->gx != p.gx || a->gy != p.gy || a->state == AST_DEAD) continue;
    u = unit_of(a);
    if (u && unit_visible(u)) return a;
  }
  return NULL;
}

static void after_action(const ActionOutcome *o) {
  static const char *const REASON[] = {"", "To nie twoja tura.", "Posta\346 nie mo\277e dzia\263a\346.", "Brak akcji.", "Pole zaj\352te.", "Brak drogi.", "Krok tylko o jedno pole.",
                                       "Za daleko.", "Poza zasi\352giem.", "Brak linii strza\263u.", "Trzeba podej\266\346.", "Nie mo\277na podej\266\346.", "", "", "Brak u\277y\346.", "Tylko w walce.",
                                       "Ju\277 u\277yte w tej turze.", "Wska\277 cel.", "", "Nie da si\352 u\277y\346.", "Z\263y cel.", "Brak drugiej broni."};
  if (!o->ok && o->reason < sizeof REASON / sizeof REASON[0] && *REASON[o->reason]) {
    push_log(REASON[o->reason], PAL_DIM);
    app_sfx("error", 128, 256);
  }
  reach_ok = 0;
}

static void player_ok(void) {
  Actor *a = turn->actor, *who = visible_actor_at(cursor);
  ActionOutcome o;
  MissionThing *th;
  if (tmode == MD_STEP) {
    o = combat_step(&mission.combat, a, cursor);
    set_mode(MD_NONE, 0, NULL);
    after_action(&o);
    return;
  }
  if (tmode == MD_ABILITY) {
    use_ability_at(a, tmode_arg, cursor, who);
    return;
  }
  if (tmode == MD_ITEM) {
    use_item_at(a, tmode_arg, cursor, who);
    return;
  }
  if (tmode == MD_STRIKE && !(who && who->side == SIDE_ENEMY)) {
    push_log("Wska\277 wroga.", PAL_DIM);
    return;
  }
  th = mission_thing_at(&mission, cursor.gx, cursor.gy);
  if (!who && th && !th->done) {
    interact_with(a, th);
    return;
  }
  if (who && who->side == SIDE_ENEMY) {
    NormWeapon w[2];
    if (turn->actions < 1) {
      push_log("Brak akcji.", PAL_DIM);
      return;
    }
    get_weapons(a->ch, w);
    o = combat_attack_target(&mission.combat, a, who, &w[0]);
    set_mode(MD_NONE, 0, NULL);
  } else if (who) return;
  else o = combat_stride(&mission.combat, a, cursor);
  after_action(&o);
}

/* ------------------------------------------------------------------ menu akcji (refreshActions) */
static Actor *actor_now(void) {
  if (mode == M_PLAYER && turn) return turn->actor;
  if (mode == M_EXPLORE && mission.pcs[leader]->state == AST_UP) return mission.pcs[leader];
  return NULL;
}

static MissionThing *thing_near(const Actor *a) {
  int i;
  for (i = 0; i < mission.n_things; i++) {
    MissionThing *th = &mission.things[i];
    if (!th->done && cheb(apos(a), mkpos(th->gx, th->gy)) <= 1) return th;
  }
  return NULL;
}

static int consumable_ok(const Actor *a, int inv, int free_) {
  const ItemDef *d = &ITEM_DEFS[a->ch->inv[inv].id];
  (void)free_;
  return d->type == ITYPE_CONSUMABLE && d->consumable;
}

static const char *const INTERACT_NAME[6] = {"Otw\363rz skrzyni\352", "Zabierz cel", "Uwolnij", "Otw\363rz drzwi", "Hakuj", "Zniszcz gniazdo"};

static void build_menu(void) {
  Actor *a = actor_now();
  int free_ = mode != M_PLAYER, n = free_ ? 99 : turn->actions, i, cnt = 0;
  char buf[64], tip[160], nm[32];
  MissionThing *th;
  if (!a) {
    menu.open = 0;
    return;
  }
  short_name(a->ch, nm, sizeof nm);
  if (sub_items) {
    snprintf(buf, sizeof buf, "PRZEDMIOTY \200 %s", nm);
    latin2_upper(buf);
    ui_menu_clear(&menu, buf);
    for (i = 0; i < a->ch->n_inv; i++) {
      const ItemDef *d = &ITEM_DEFS[a->ch->inv[i].id];
      int ok;
      if (!consumable_ok(a, i, free_)) continue;
      ok = !free_ || explore_item_ok(a->ch->inv[i].id);
      if (a->ch->inv[i].qty > 1) snprintf(buf, sizeof buf, "%s x%d", d->name, a->ch->inv[i].qty);
      else snprintf(buf, sizeof buf, "%s", d->name);
      snprintf(tip, sizeof tip, "%s: %s%s", d->name, d->desc ? d->desc : "", ok ? "" : " \200 tylko w walce");
      ui_menu_add(&menu, A_ITEM + i, buf, free_ ? -1 : d->consumable->actions, ok && (free_ || d->consumable->actions <= n), tmode == MD_ITEM && tmode_arg == i, tip);
    }
    ui_menu_add(&menu, A_BACK, "Wr\363\346", -1, 1, 0, "Powr\363t do akcji.");
    if (!free_) ui_menu_add(&menu, A_END, "Koniec tury", -1, 1, 0, "Zako\361cz tur\352.");
    return;
  }
  ui_menu_clear(&menu, free_ ? "EKSPLORACJA" : nm);
  if (!free_) {
    NormWeapon w[2];
    int map = a->map_n > 2 ? 2 : a->map_n, agile = 0;
    get_weapons(a->ch, w);
    agile = (w[0].traits & WT_AGILE) != 0;
    ui_menu_add(&menu, A_STRIDE, "Marsz", 1, n >= 1, tmode == MD_NONE, "Marsz \200 do swojej Pr\352dko\266ci za 1 akcj\352 (niebieskie pola 1 akcja, \277\363\263te 2, pomara\361czowe 3).");
    ui_menu_add(&menu, A_STEP, "Krok", 1, n >= 1, tmode == MD_STEP, "Krok \200 przesu\361 si\352 o 1 pole.");
    if (map) snprintf(buf, sizeof buf, "Atak: %s (-%d)", w[0].name, (agile ? 4 : 5) * map);
    else snprintf(buf, sizeof buf, "Atak: %s", w[0].name);
    snprintf(tip, sizeof tip, "Atak: %s, %s. Kolejne ataki: kara PWA.", w[0].name, w[0].range ? "dystansowa" : "wr\352cz");
    ui_menu_add(&menu, A_STRIKE, buf, 1, n >= 1, tmode == MD_STRIKE, tip);
  }
  for (i = 0; i < a->ch->n_abilities; i++) {
    int id = a->ch->abilities[i], left, ok, cost;
    const AbilityDef *ab = &ABILITY_DEFS[id];
    if (id == ABIL_STRIKE || (free_ && id == ABIL_STAND)) continue;
    if (!free_ && id == ABIL_STAND && !has_cond(a->ch, COND_PRONE)) continue;
    if (id == ABIL_RAISE_SHIELD && a->ch->equip[SLOT_SHIELD].id == ITEM_NONE) continue;
    left = uses_left(a->ch, (uint8_t)id);
    if (ab->uses) snprintf(buf, sizeof buf, "%s (%d)", ab->name, left);
    else snprintf(buf, sizeof buf, "%s", ab->name);
    snprintf(tip, sizeof tip, "%s: %s", ab->name, ab->desc ? ab->desc : "");
    if (free_) {
      ok = explore_ability_ok((uint8_t)id) && left > 0;
      if (!explore_ability_ok((uint8_t)id)) strncat(tip, " \200 tylko w walce", sizeof tip - strlen(tip) - 1);
      ui_menu_add(&menu, A_ABIL + id, buf, -1, ok, tmode == MD_ABILITY && tmode_arg == id, tip);
    } else {
      int reaction = ab->actions == ACTIONS_REACTION;
      cost = reaction ? -2 : ab->actions;
      ok = !reaction && left > 0 && !(ab->actions == 0 && ((a->used_free >> id) & 1)) && (reaction || ab->actions <= n);
      ui_menu_add(&menu, A_ABIL + id, buf, cost, ok, tmode == MD_ABILITY && tmode_arg == id, tip);
    }
  }
  for (i = 0; i < a->ch->n_inv; i++) if (consumable_ok(a, i, free_)) cnt += a->ch->inv[i].qty;
  if (cnt) {
    snprintf(buf, sizeof buf, "Przedmioty (%d)", cnt);
    ui_menu_add(&menu, A_ITEMS, buf, -1, 1, 0, "U\277yj przedmiotu z plecaka.");
  }
  th = thing_near(a);
  if (th) ui_menu_add(&menu, A_INTERACT, INTERACT_NAME[th->kind < 6 ? th->kind : 0], free_ ? -1 : 1, free_ || n >= 1, 0, "Interakcja z obiektem obok.");
  if (!free_) {
    ui_menu_add(&menu, A_DELAY, "Od\263\363\277 tur\352", -1, 1, 0, "Przesu\361 swoj\261 tur\352 na koniec rundy.");
    ui_menu_add(&menu, A_END, "Koniec tury", -1, 1, 0, "Zako\361cz tur\352.");
  } else {
    int up = 0;
    for (i = 0; i < mission.n_pcs; i++) up += mission.pcs[i]->state == AST_UP;
    if (up > 1) ui_menu_add(&menu, A_LEADER, "Nast\352pny najemnik", -1, 1, 0, "Prowadzi kolejny najemnik (reszta idzie za nim).");
  }
  ui_menu_add(&menu, A_RETREAT, mission_objective_done(&mission) ? "Powr\363t do Przystani" : "Odwr\363t", -1, 1, 0, "Opu\266\346 teren zlecenia.");
}

static void set_mode(int m, int arg, const char *hint) {
  tmode = m;
  tmode_arg = arg;
  snprintf(tmode_hint, sizeof tmode_hint, "%s", hint ? hint : "");
  menu.open = 0;
  reach_ok = 0;
}

static void ask_retreat(void) {
  int done = mission_objective_done(&mission) && mission.obj_type != OBJ_RESCUE;
  ui_choice_open(&choice, done ? "Powr\363t?" : "Odwr\363t?",
                 done ? "Cel zlecenia jest wykonany \200 wracacie z nagrod\261. Czego nie zabrali\266cie, zostaje na miejscu."
                      : "Wycofujecie si\352 ze zlecenia. Nagroda za cel przepada, ale zachowujecie \263upy i do\266wiadczenie za pokonanych wrog\363w.",
                 300);
  ui_choice_add(&choice, "Zosta\361", BTN_PLAIN);
  ui_choice_add(&choice, done ? "Powr\363t" : "Odwr\363t", done ? BTN_PRIMARY : BTN_DANGER);
  choice.focus = 0;
  choice_kind = CH_RETREAT;
}

/* wybór umiejętności do skrzyni / drzwi / urządzenia (pickThingSkill) */
static void ask_skill(Actor *a, MissionThing *th) {
  char body[400], lab[64], nm[32];
  int i, best = -1, best_pct = -1, n = 0;
  static const uint8_t CRATE_S[3] = {SKILL_THIEVERY, SKILL_CRAFTING, SKILL_ATHLETICS};
  static const uint8_t LOCK_S[2] = {SKILL_THIEVERY, SKILL_ATHLETICS};
  static const uint8_t HACK_S[2] = {SKILL_CRAFTING, SKILL_THIEVERY};
  const uint8_t *list = th->kind == TH_DOOR ? LOCK_S : th->kind == TH_DEVICE ? HACK_S : CRATE_S;
  int nl = th->kind == TH_CRATE ? 3 : 2, tools = has_lockpick(a->ch), pct[3], mods[3];
  short_name(a->ch, nm, sizeof nm);
  if (th->kind == TH_DOOR && th->has_lock)
    snprintf(body, sizeof body, "%s ogl\261da zamek: ST %d, post\352p %d/%d sukces\363w.\nWytrych: sukces = 1, kryt. sukces = 2; kryt. pora\277ka \263amie wytrych%s. 2 akcje w walce.\nWywa\277enie: ST %d, kara -2 bez \263omu; sukces otwiera, ale niszczy zamek.",
             nm, th->lock.dc, th->lock.progress, th->lock.needed, tools ? "" : " (brak wytrych\363w: kara -2)", th->lock.dc + 5);
  else if (th->kind == TH_DEVICE && th->has_lock)
    snprintf(body, sizeof body, "%s pod\263\261cza si\352 do urz\261dzenia: ST %d, zabezpieczenia %d/%d.\nSukces \263amie 1 warstw\352, kryt. sukces 2. Kryt. pora\277ka blokuje urz\261dzenie i w\263\261cza alarm. 2 akcje w walce.",
             nm, th->lock.dc, th->lock.progress, th->lock.needed);
  else
    snprintf(body, sizeof body, "%s przygl\261da si\352 zamkowi. Jak go otworzy\346? (KT %d)\nKrytyczna pora\277ka uruchamia pu\263apk\352; zwyk\263a pora\277ka - zamek si\352 zacina (2 pr\363by).", nm, dc_for_level(mission.contract.level) + 1);
  ui_choice_open(&choice, th->kind == TH_CRATE ? "Zamkni\352ta skrzynia" : th->kind == TH_DOOR ? "Zamkni\352te drzwi" : "Urz\261dzenie", body, 380);
  ui_choice_add(&choice, "Zostaw", BTN_PLAIN);
  choice_skill[0] = SKILL_NONE;
  for (i = 0; i < nl; i++) {
    int sk = list[i], dc, mod, hit, crit;
    if (th->kind == TH_DOOR) {
      dc = sk == SKILL_ATHLETICS ? th->lock.dc + 5 : th->lock.dc;
      mod = get_stat(a->ch, sk, 0) + (sk == SKILL_ATHLETICS ? IMPROVISED_PENALTY + th->lock.force_penalty : tools ? 0 : IMPROVISED_PENALTY);
    } else if (th->kind == TH_DEVICE) {
      dc = th->lock.dc;
      mod = get_stat(a->ch, sk, 0);
    } else {
      dc = dc_for_level(mission.contract.level) + 1;
      mod = get_stat(a->ch, sk, 0);
    }
    hit_chances(mod, dc, 0, &hit, &crit);
    pct[i] = hit * 5;
    mods[i] = mod;
    if (pct[i] > best_pct) {
      best_pct = pct[i];
      best = i;
    }
  }
  for (i = 0; i < nl; i++) {
    const char *nmk = th->kind == TH_DOOR ? (list[i] == SKILL_ATHLETICS ? "Wywa\277enie (Atletyka)" : "Wytrych (Z\263odziejstwo)")
                    : th->kind == TH_DEVICE ? (list[i] == SKILL_CRAFTING ? "Hakowanie (Technika)" : "Obej\266cie (Z\263odziejstwo)")
                                            : SKILL_DEFS[list[i]].name;
    snprintf(lab, sizeof lab, "%s %s%d (%d%%)", nmk, mods[i] >= 0 ? "+" : "", mods[i], pct[i]);
    ui_choice_add(&choice, lab, i == best ? BTN_PRIMARY : BTN_PLAIN);
    choice_skill[++n] = list[i];
  }
  choice_kind = CH_SKILL;
  choice_th = th;
}

static void do_interact(Actor *a, MissionThing *th, uint8_t skill) {
  UnitV *u = unit_of(a);
  if (u) face(u, th->gx - a->gx, th->gy - a->gy);
  if (mode == M_PLAYER && turn) {
    int need = (th->kind == TH_DEVICE || (th->kind == TH_DOOR && skill != SKILL_ATHLETICS)) ? 2 : 1;
    if (turn->actions < need) {
      push_log(need == 2 ? "Potrzeba 2 akcji." : "Brak akcji.", PAL_DIM);
      return;
    }
  }
  if (!mission_interact(&mission, a, th, skill)) push_log("Nic si\352 nie sta\263o.", PAL_DIM);
  if (mode == M_EXPLORE) after_explore = 1;
  reach_ok = 0;
}

/* interakcja: w eksploracji najpierw podejście; skrzynia / drzwi / urządzenie - wybór umiejętności */
static void interact_with(Actor *a, MissionThing *th) {
  if (cheb(apos(a), mkpos(th->gx, th->gy)) > 1) {
    Pos cell;
    static ExploreResult r;
    int i;
    if (mode == M_PLAYER) {
      push_log("Podejd\274 bli\277ej (obok obiektu).", PAL_DIM);
      return;
    }
    if (!mission_interact_cell(&mission, a, mkpos(th->gx, th->gy), &cell)) {
      push_log("Nie mo\277na doj\266\346.", PAL_DIM);
      app_sfx("error", 128, 256);
      return;
    }
    mission_explore_move(&mission, a, cell, 0, &r);
    if (!r.ok) {
      push_log("Nie mo\277na doj\266\346.", PAL_DIM);
      return;
    }
    for (i = 0; i < r.n; i++) start_walk(unit_of(r.paths[i].actor), r.paths[i].path, r.paths[i].n);
    update_fog();
    pending_th = th;   /* po dojściu */
    return;
  }
  if (th->kind == TH_CRATE || th->kind == TH_DOOR || th->kind == TH_DEVICE) ask_skill(a, th);
  else do_interact(a, th, SKILL_NONE);
}

static void use_ability_at(Actor *a, int id, Pos cell, Actor *who) {
  const AbilityDef *ab = &ABILITY_DEFS[id];
  ActionOutcome o;
  Actor *targets[MAX_ACTORS];
  int n, i, ok = 0;
  if (ab->target == TARGET_ENEMY || ab->target == TARGET_ALLY) {
    n = combat_ability_targets(&mission.combat, a, (uint8_t)id, targets);
    for (i = 0; i < n; i++) if (targets[i] == who) ok = 1;
    if (!who || !ok) {
      push_log(ab->target == TARGET_ALLY ? "Wska\277 sojusznika w zasi\352gu." : "Wska\277 wroga w zasi\352gu i na linii strza\263u.", PAL_DIM);
      app_sfx("error", 128, 256);
      return;
    }
    o = combat_use_ability(&mission.combat, a, (uint8_t)id, &who, 1, NULL);
  } else if (ab->target == TARGET_AREA) {
    if (!combat_area_cell_ok(&mission.combat, a, cell, ab->range)) {
      push_log("Poza zasi\352giem / brak linii.", PAL_DIM);
      return;
    }
    o = combat_use_ability(&mission.combat, a, (uint8_t)id, NULL, 0, &cell);
  } else o = combat_use_ability(&mission.combat, a, (uint8_t)id, NULL, 0, NULL);
  set_mode(MD_NONE, 0, NULL);
  after_action(&o);
  if (mode == M_EXPLORE) after_explore = 1;
}

static void use_item_at(Actor *a, int inv, Pos cell, Actor *who) {
  const ConsumableStats *c = ITEM_DEFS[a->ch->inv[inv].id].consumable;
  ActionOutcome o;
  if (c->target == TARGET_AREA) {
    if (!combat_area_cell_ok(&mission.combat, a, cell, c->range ? c->range : 6)) {
      push_log("Poza zasi\352giem.", PAL_DIM);
      return;
    }
    o = combat_use_item(&mission.combat, a, inv, NULL, &cell);
  } else {
    if (!who) {
      push_log("Wska\277 cel.", PAL_DIM);
      return;
    }
    o = combat_use_item(&mission.combat, a, inv, who == a ? NULL : who, NULL);
  }
  set_mode(MD_NONE, 0, NULL);
  sub_items = 0;
  after_action(&o);
  if (mode == M_EXPLORE) after_explore = 1;
}

static void menu_pick(int id) {
  Actor *a = actor_now();
  char hint[120];
  if (!a) return;
  if (id == A_STRIDE) set_mode(MD_NONE, 0, NULL);
  else if (id == A_STEP) set_mode(MD_STEP, 0, "Krok: wska\277 pole obok. [Esc = anuluj]");
  else if (id == A_STRIKE) set_mode(MD_STRIKE, 0, "Atak: wska\277 wroga. [Esc = anuluj]");
  else if (id == A_ITEMS) {
    sub_items = 1;
    menu.focus = 0;
  } else if (id == A_BACK) {
    sub_items = 0;
    menu.focus = 0;
  } else if (id == A_END) {
    menu.open = 0;
    if (mode == M_PLAYER) mode = M_COMBAT;
  } else if (id == A_DELAY) {
    menu.open = 0;
    combat_delay(&mission.combat);
    if (mode == M_PLAYER) mode = M_COMBAT;
  } else if (id == A_RETREAT) {
    menu.open = 0;
    ask_retreat();
  } else if (id == A_LEADER) {
    int k;
    for (k = 1; k <= mission.n_pcs; k++) {
      int j = (leader + k) % mission.n_pcs;
      if (mission.pcs[j]->state == AST_UP) {
        leader = j;
        break;
      }
    }
    cursor = apos(mission.pcs[leader]);
    menu.open = 0;
  } else if (id == A_INTERACT) {
    MissionThing *th = thing_near(a);
    menu.open = 0;
    if (th) interact_with(a, th);
  } else if (id >= A_ITEM) {
    int inv = id - A_ITEM;
    const ConsumableStats *c = ITEM_DEFS[a->ch->inv[inv].id].consumable;
    if (c->target == TARGET_SELF) {
      ActionOutcome o = combat_use_item(&mission.combat, a, inv, NULL, NULL);
      menu.open = 0;
      sub_items = 0;
      after_action(&o);
      if (mode == M_EXPLORE) after_explore = 1;
    } else {
      snprintf(hint, sizeof hint, "%s: %s. [Esc = anuluj]", ITEM_DEFS[a->ch->inv[inv].id].name, c->target == TARGET_AREA ? "wska\277 pole" : "wska\277 cel");
      set_mode(MD_ITEM, inv, hint);
    }
  } else if (id >= A_ABIL) {
    int ab_id = id - A_ABIL;
    const AbilityDef *ab = &ABILITY_DEFS[ab_id];
    Actor *t[MAX_ACTORS];
    if ((ab->target == TARGET_AREA && ab->range <= 0) || ab->target == TARGET_SELF || ab->target == TARGET_NONE) {
      menu.open = 0;
      use_ability_at(a, ab_id, apos(a), NULL);
    } else if ((ab->target == TARGET_ENEMY || ab->target == TARGET_ALLY) && !combat_ability_targets(&mission.combat, a, (uint8_t)ab_id, t)) {
      push_log("Brak cel\363w w zasi\352gu.", PAL_DIM);
      app_sfx("error", 128, 256);
    } else {
      if (ab->target == TARGET_AREA) snprintf(hint, sizeof hint, "%s: wska\277 pole (promie\361 %d, zasi\352g %d). [Esc = anuluj]", ab->name, ab->radius ? ab->radius : 1, ab->range);
      else snprintf(hint, sizeof hint, "%s: wska\277 %s. [Esc = anuluj]", ab->name, ab->target == TARGET_ALLY ? "sojusznika" : "wroga");
      set_mode(MD_ABILITY, ab_id, hint);
    }
  }
}

/* po ruchu / akcji w eksploracji: pytanie o cel wykonany i ewakuację (afterExplore) */
static void after_explore_checks(void) {
  if (mode != M_EXPLORE || mission.mode != MODE_EXPLORE) return;
  if (complete_ask) {
    complete_ask = 0;
    if (!mission_needs_extraction(&mission)) {
      char body[400] = "Zlecenie zaliczone. Na terenie zosta\263o jeszcze:", line[64];
      int i, crates = 0, finds = 0, hidden = 0, dev = 0, foes = 0, any = 0;
      for (i = 0; i < mission.n_things; i++) {
        const MissionThing *t = &mission.things[i];
        if (t->kind == TH_CRATE && !t->done) crates++;
        if (t->kind == TH_DEVICE && !t->done && !(t->has_lock && t->lock.jammed) && !t->objective) dev++;
      }
      for (i = 0; i < mission.n_finds; i++) {
        if (mission.finds[i].found && !mission.finds[i].taken) finds++;
        if (!mission.finds[i].found && !mission.finds[i].taken) hidden++;
      }
      for (i = 0; i < mission.n_enemies; i++) foes += mission.enemies[i]->state != AST_DEAD;
#define LEFT(cond, ...) if (cond) { snprintf(line, sizeof line, __VA_ARGS__); strncat(body, line, sizeof body - strlen(body) - 1); any = 1; }
      LEFT(crates, "\n- zamkni\352te skrzynie: %d", crates)
      LEFT(finds, "\n- znaleziska do zabrania: %d", finds)
      LEFT(hidden, "\n- ukryte znaleziska do odkrycia")
      LEFT(dev, "\n- urz\261dzenia do zhakowania: %d", dev)
      LEFT(foes, "\n- wrogowie: %d", foes)
#undef LEFT
      if (!any) {
        mission_finish(&mission, MRES_SUCCESS);
        return;
      }
      strncat(body, "\n\nMo\277ecie dalej przeszukiwa\346 okolic\352, a potem wr\363ci\346 do strefy ewakuacji - nagroda za zlecenie zostaje.", sizeof body - strlen(body) - 1);
      ui_choice_open(&choice, "Cel wykonany", body, 360);
      ui_choice_add(&choice, "Przeszukaj teren", BTN_PRIMARY);
      ui_choice_add(&choice, "Ewakuacja teraz", BTN_PLAIN);
      choice_kind = CH_AFTER;
      return;
    }
  }
  if (mission_can_extract(&mission)) {
    if (!extract_asked) {
      extract_asked = 1;
      ui_choice_open(&choice, "Strefa ewakuacji", "Cel zlecenia wykonany, dru\277yna jest w strefie ewakuacji. Opu\266ci\346 teren?", 300);
      ui_choice_add(&choice, "Jeszcze nie", BTN_PLAIN);
      ui_choice_add(&choice, "Ewakuacja", BTN_PRIMARY);
      choice_kind = CH_EXTRACT;
    }
  } else extract_asked = 0;
}

static void choice_result(int r) {
  if (choice_kind == CH_SKILL && r > 0 && choice_th) {
    Actor *a = actor_now();
    if (a) do_interact(a, choice_th, choice_skill[r]);
  } else if (choice_kind == CH_AFTER && r == 1) mission_finish(&mission, MRES_SUCCESS);
  else if (choice_kind == CH_EXTRACT && r == 1) mission_finish(&mission, MRES_SUCCESS);
  else if (choice_kind == CH_RETREAT && r == 1) mission_retreat(&mission);
  choice_th = NULL;
}

/* ------------------------------------------------------------------ aktualizacja */
static void update_units(int ms) {
  int i;
  for (i = 0; i < n_units; i++) {
    UnitV *u = &units[i];
    if (u->hurt_ms > 0) u->hurt_ms -= ms;
    if (u->pose_k) {
      u->pose_ms += ms;
      while (u->pose_k && u->pose_ms >= 110) {
        u->pose_ms -= 110;
        if (u->pose_f + 1 < POSE_FRAMES[u->pose_k] && (u->pose_k != P_DIE || u->pose_f + 1 <= (u->a->state == AST_DEAD ? FRAME_CORPSE : FRAME_DOWN))) u->pose_f++;
        else if (u->pose_k != P_DIE) u->pose_k = P_NONE;
        else break;
      }
    }
    if (u->walking) {
      Pos to = u->path[u->path_i];
      float tx = iso_x(to.gx, to.gy), ty = iso_y(to.gx, to.gy) + TILE_H / 2, k, fx, fy;
      if (!u->path_ms) {
        int gx = (int)floor((u->x / 16 + (u->y - 8) / 8) / 2 + 0.5f), gy = (int)floor(((u->y - 8) / 8 - u->x / 16) / 2 + 0.5f);
        face(u, to.gx - gx, to.gy - gy);
        u->from.gx = (int8_t)gx;
        u->from.gy = (int8_t)gy;
      }
      u->path_ms += ms;
      k = u->path_ms / (float)STEP_MS;
      if (k > 1) k = 1;
      fx = iso_x(u->from.gx, u->from.gy);
      fy = iso_y(u->from.gx, u->from.gy) + TILE_H / 2;
      u->x = fx + (tx - fx) * k;
      u->y = fy + (ty - fy) * k;
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
    } else {
      u->ms += ms;
      while (u->ms >= 100 + UNIT_IDLE[u->step % UNIT_IDLE_STEPS].ms) {
        u->ms -= 100 + UNIT_IDLE[u->step % UNIT_IDLE_STEPS].ms;
        u->step = (u->step + 1) % UNIT_IDLE_STEPS;
      }
    }
  }
}

static void explore_to(Pos target) {
  static ExploreResult r;
  Actor *sel = mission.pcs[leader];
  int i;
  if (sel->state != AST_UP) return;
  mission_explore_move(&mission, sel, target, 1, &r);
  if (!r.ok) {
    app_sfx("error", 128, 256);
    return;
  }
  for (i = 0; i < r.n; i++) start_walk(unit_of(r.paths[i].actor), r.paths[i].path, r.paths[i].n);
  update_fog();
}

static void next_combat_turn(void) {
  /* kolejna tura albo koniec walki (runCombat) */
  if (!mission_in_combat(&mission) || !mission.combat.active) {
    int i, all_dead = 1;
    for (i = 0; i < mission.n_enemies; i++) if (mission.enemies[i]->state != AST_DEAD) all_dead = 0;
    show_banner(all_dead ? "TEREN CZYSTY" : "WALKA ZAKO\321CZONA", NULL, PAL_GOOD);
    mode = M_EXPLORE;
    turn = NULL;
    turn_banner_enemy = 0;
    for (i = 0; i < mission.n_pcs; i++)
      if (mission.pcs[i]->state == AST_UP) {
        leader = i;
        break;
      }
    update_fog();
    return;
  }
  turn = combat_next_turn(&mission.combat);
  update_fog();
  if (!turn) {
    if (++stall > 5) {
      mode = M_EXPLORE;
      stall = 0;
    }
    return;
  }
  stall = 0;
  if (turn->actor->side == SIDE_PC) {
    int i;
    mode = M_PLAYER;
    for (i = 0; i < mission.n_pcs; i++) if (mission.pcs[i] == turn->actor) leader = i;
    cursor = apos(turn->actor);
    reach_ok = 0;
  } else {
    UnitV *u = unit_of(turn->actor);
    mode = M_AI;
    ai_actor = turn->actor;
    wait_ms = u && unit_visible(u) ? 320 : 120;
  }
}

static void update(unsigned held, unsigned pressed, int ms) {
  int i;
  ui_toast_update(ms);
  clock_advance(&clock, ms, 10);
  for (i = 0; i < GRID_N; i++)
    if (cell_state[i] && cell_reveal[i] < 255) cell_reveal[i] = (uint8_t)(cell_reveal[i] + ms * 255 / 250 > 255 ? 255 : cell_reveal[i] + ms * 255 / 250);
  update_units(ms);
  for (i = 0; i < n_floats; i++)
    if ((floats[i].ms -= ms) <= 0) {
      floats[i--] = floats[--n_floats];
    }
  if (banner_ms > 0) banner_ms -= ms;
  if (wait_ms > 0) wait_ms -= ms;
  if (pending_ms > 0 && (pending_ms -= ms) <= 0) show_events(&pending_hit);

  /* kamera: za postacią w turze albo liderem */
  {
    UnitV *u = unit_of(mode == M_AI && ai_actor ? ai_actor : mission.pcs[leader]);
    float k = ms / 250.0f > 1 ? 1 : ms / 250.0f;
    if (u && (mode != M_AI || unit_visible(u))) {
      cam_x += (u->x - cam_x) * k;
      cam_y += (u->y - 20 - cam_y) * k;
    }
  }

  /* kolejka sygnałów: po kolei, kolejny po zakończeniu animacji poprzedniego */
  if (wait_ms <= 0 && pending_ms <= 0 && !any_walking() && q_n) {
    Sig *s = &queue[q_head];
    q_head = (q_head + 1) % QUEUE_MAX;
    q_n--;
    play(s);
    if (s->kind == SIG_STRIKE) {
      pending_hit = *s;
      pending_ms = s->ranged ? 150 : 120;
      wait_ms = 450;
    }
    if (s->kind == SIG_MOVE || s->kind == SIG_STRIKE || s->kind == SIG_STATE) update_fog();
    return;
  }
  if (wait_ms > 0 || pending_ms > 0 || any_walking() || q_n) return;
  update_fog();

  if (mode == M_OVER) {
    if ((over_ms -= ms) <= 0 && !app_leaving()) {
      Rng r;
      int k;
      g_n_fallen = 0;
      if (mission.result.result == MRES_FAIL) {
        /* wybicie drużyny: od razu KONIEC DROGI (bez rozliczenia) */
        for (k = 0; k < mission.n_pcs && g_n_fallen < MAX_PARTY; k++) snprintf(g_fallen[g_n_fallen++], sizeof g_fallen[0], "%s", mission.pcs[k]->ch->name);
        app_switch(SCR_GAMEOVER, 1700, 1200);
        return;
      }
      /* stan sprzed naliczenia (paski PD i awanse w rozliczeniu) */
      memset(g_before, 0, sizeof g_before);
      for (k = 0; k < g_camp.n_party; k++) {
        const Character *c = &g_camp.party[k];
        if (c->recruit >= RECRUIT_COUNT) continue;
        g_before[c->recruit].valid = 1;
        g_before[c->recruit].level = c->level;
        g_before[c->recruit].xp = (int16_t)c->xp;
        g_before[c->recruit].max_hp = c->max_hp;
        g_before[c->recruit].n_abil = c->n_abilities;
        memcpy(g_before[c->recruit].abil, c->abilities, c->n_abilities);
      }
      for (k = 0; k < mission.result.n_casualties && g_n_fallen < MAX_PARTY; k++) snprintf(g_fallen[g_n_fallen++], sizeof g_fallen[0], "%s", mission.result.casualties[k]->name);
      snprintf(g_debrief_title, sizeof g_debrief_title, "%s", g_camp.contracts[g_job].title);
      game_rng(&r);
      apply_mission_result(&g_camp, &mission.result, g_job, &r, &g_debrief);
      app_switch(SCR_DEBRIEF, 900, 500);
    }
    return;
  }
  if (mode == M_EXPLORE && mission_in_combat(&mission)) {
    mode = M_COMBAT;
    return;
  }
  if (mode == M_COMBAT) {
    next_combat_turn();
    return;
  }
  if (mode == M_AI) {
    AiAction act;
    UnitV *u = unit_of(ai_actor);
    if (!mission.combat.turn || mission.combat.turn->actor != ai_actor || !ai_step(&mission.combat, ai_actor, &act)) {
      if (mission.combat.turn && mission.combat.turn->actor == ai_actor) mission.combat.turn->actions = 0;
      mode = M_COMBAT;
    } else wait_ms = u && unit_visible(u) ? 160 : 40;
    return;
  }
  if (mode == M_PLAYER && (!mission.combat.active || mission.combat.turn != turn || turn->actions <= 0 || turn->actor->state != AST_UP)) {
    mode = M_COMBAT;
    wait_ms = 300;
    return;
  }
  if (mode == M_PLAYER && !reach_ok) refresh_reach();

  /* eksploracja po animacjach: dojście do obiektu, pytania o cel i ewakuację */
  if (mode == M_EXPLORE && !choice.open) {
    if (pending_th) {
      MissionThing *th = pending_th;
      Actor *a = mission.pcs[leader];
      pending_th = NULL;
      if (mission_in_combat(&mission)) return;
      if (cheb(apos(a), mkpos(th->gx, th->gy)) <= 1) {
        if (th->kind == TH_CRATE || th->kind == TH_DOOR || th->kind == TH_DEVICE) ask_skill(a, th);
        else do_interact(a, th, SKILL_NONE);
      } else push_log("Za daleko na jeden ruch \200 podejd\274 bli\277ej.", PAL_DIM);
      return;
    }
    if (after_explore) {
      after_explore = 0;
      after_explore_checks();
      return;
    }
  }

  if (app_leaving()) return;
  if (choice.open) {
    int r = ui_choice_input(&choice, pressed);
    if (r >= 0) choice_result(r);
    return;
  }
  if (menu.open) {
    int r;
    build_menu();
    r = ui_menu_input(&menu, pressed);
    if (r >= 0) menu_pick(r);
    else if (r == -2) sub_items = 0;
    return;
  }
  if (pressed & IN_BACK) {
    if (tmode != MD_NONE) set_mode(MD_NONE, 0, NULL);
    else if (actor_now()) {
      menu.open = 1;
      menu.focus = 0;
      sub_items = 0;
      build_menu();
    } else if (mode == M_EXPLORE) ask_retreat();
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
      dgx = dgx > 1 ? 1 : dgx < -1 ? -1 : dgx;
      dgy = dgy > 1 ? 1 : dgy < -1 ? -1 : dgy;
      if (in_bounds(cursor.gx + dgx, cursor.gy + dgy)) {
        cursor.gx = (int8_t)(cursor.gx + dgx);
        cursor.gy = (int8_t)(cursor.gy + dgy);
      }
    }
  }
  if (g_debug_cmd == 2) {
    /* testy: kursor na najbliższą nieotwartą skrzynię */
    int best = 1 << 30;
    g_debug_cmd = 0;
    for (i = 0; i < mission.n_things; i++) {
      MissionThing *t = &mission.things[i];
      int d = cheb(apos(mission.pcs[leader]), mkpos(t->gx, t->gy));
      if (t->kind == TH_CRATE && !t->done && d < best) {
        best = d;
        cursor = mkpos(t->gx, t->gy);
      }
    }
  }
  if (g_debug_cmd == 1) {
    /* testy: kursor na najbliższego żywego wroga */
    int best = 1 << 30;
    Pos me = apos(mission.pcs[leader]);
    g_debug_cmd = 0;
    for (i = 0; i < mission.n_enemies; i++) {
      Actor *e = mission.enemies[i];
      int d = cheb(me, apos(e));
      if (e->state != AST_DEAD && d < best) {
        best = d;
        cursor = apos(e);
      }
    }
  }
  if (pressed & IN_OK) {
    if (mode == M_EXPLORE) {
      Actor *a = mission.pcs[leader], *who = visible_actor_at(cursor);
      MissionThing *th = mission_thing_at(&mission, cursor.gx, cursor.gy);
      if (tmode == MD_ABILITY) use_ability_at(a, tmode_arg, cursor, who);
      else if (tmode == MD_ITEM) use_item_at(a, tmode_arg, cursor, who);
      else if (th && !th->done && !who && mission.explored[gidx(cursor.gx, cursor.gy)]) interact_with(a, th);
      else if (who && who->side == SIDE_PC && who != a) {
        int k;
        for (k = 0; k < mission.n_pcs; k++) if (mission.pcs[k] == who && who->state == AST_UP) leader = k;
      } else {
        explore_to(cursor);
        after_explore = 1;
      }
    } else if (mode == M_PLAYER) player_ok();
  }
}

/* ------------------------------------------------------------------ rysowanie */
static void draw_unit(const UnitV *u) {
  const AtlasImg *im;
  int flip = 0, back = u->dir >= 5 || u->dir == 0, a = 255;
  uint32_t tint = 0xffffff;
  if (!u->a->ch) return;
  flip = u->dir >= 3 && u->dir <= 6;
  if (u->a->state != AST_UP) {
    int f = u->pose_k == P_DIE ? u->pose_f : u->a->state == AST_DEAD ? FRAME_CORPSE : FRAME_DOWN;
    im = &u->pose[back][P_DIE][f];
    tint = u->a->state == AST_DEAD ? 0xa09090 : 0x9a7a7a;
  } else if (u->pose_k) {
    im = &u->pose[back][u->pose_k][u->pose_f];
  } else if (u->pc) {
    im = u->walking && u->has_walk ? &u->walk[u->dir][u->step % 8] : &u->idle[u->dir][UNIT_IDLE[u->step % UNIT_IDLE_STEPS].frame];
    flip = 0;
  } else
    im = u->walking && u->has_walk ? &u->walk[back][u->step % 4] : &u->idle[back][UNIT_IDLE[u->step % UNIT_IDLE_STEPS].frame];
  if (!im->w) im = u->pc ? &u->idle[u->dir][0] : &u->idle[back][0];
  if (!im->w) return;
  if (u->hurt_ms > 0) tint = 0xff6a5a;
  atlas_draw(&atlas, im, u->x - im->w * 0.5f, u->y - im->h * 0.875f, flip, tint, a);
}

/* romb pola (dwa trójkąty) */
static void diamond(int gx, int gy, uint32_t col, int a) {
  float x = iso_x(gx, gy), y = iso_y(gx, gy);
  r2d_tri(x, y, x + 16, y + 8, x, y + 16, col, a);
  r2d_tri(x, y, x, y + 16, x - 16, y + 8, col, a);
}

static void draw_overlay(void) {
  int i;
  if (mode == M_PLAYER && reach_ok && turn) {
    static const uint32_t COL[4] = {0, 0x468cff, 0xf0c832, 0xf07828};
    static const int AL[4] = {0, 77, 66, 61};
    for (i = 0; i < GRID_N; i++) {
      int n;
      if (!cell_state[i] || reach.cost[i] >= UNREACHABLE || reach.cost[i] <= 0) continue;
      n = stride_actions(reach.cost[i], reach_sp);
      if (n < 1 || n > turn->actions || n > 3) continue;
      diamond(i % MAP_W, i / MAP_W, COL[n], AL[n]);
    }
  }
  atlas_draw(&atlas, &img_cursor, iso_x(cursor.gx, cursor.gy) - img_cursor.w / 2.0f, iso_y(cursor.gx, cursor.gy), 0, 0xffffff, 255);
}

static void draw_hud(void) {
  char buf[160];
  int i;
  float x;
  r2d_rect(0, 0, V_W, 13, PAL_PANEL, 230);
  r2d_rect(0, 13, V_W, 1, PAL_EDGE, 255);
  if (mode == M_PLAYER || mode == M_AI || mode == M_COMBAT) snprintf(buf, sizeof buf, "WALKA \205 runda %d", mission.combat.round);
  else snprintf(buf, sizeof buf, "%s", g_camp.contracts[g_job].title);
  font_draw(6, 3, buf, mode == M_EXPLORE ? PAL_AMBER : PAL_BAD, 255, FONT_OUTLINE, 0, 1);
  x = V_W - 6;
  for (i = mission.n_pcs - 1; i >= 0; i--) {
    const Actor *a = mission.pcs[i];
    char nm[32];
    short_name(a->ch, nm, sizeof nm);
    snprintf(buf, sizeof buf, "%s %d/%d", nm, a->ch->hp > 0 ? a->ch->hp : 0, a->ch->max_hp);
    x -= font_measure(buf, 0);
    font_draw(x, 3, buf, a->state != AST_UP ? PAL_BAD : i == leader ? PAL_AMBER : PAL_TEXT, 255, FONT_OUTLINE, 0, 1);
    x -= 12;
  }
  /* akcje tury i podpowiedź celu */
  if (mode == M_PLAYER && turn) {
    char nm[32];
    Actor *who = visible_actor_at(cursor);
    short_name(turn->actor->ch, nm, sizeof nm);
    r2d_rect(6, 18, 150, 24, PAL_PANEL, 220);
    r2d_frame(6, 18, 150, 24, PAL_EDGE, 255);
    font_draw(10, 21, nm, PAL_AMBER, 255, FONT_OUTLINE, 0, 1);
    for (i = 0; i < turn->full; i++) {
      /* ◆ dostępna akcja, ◇ zużyta */
      font_draw(10 + font_measure(nm, 0) + 6 + i * 9, 21, i < turn->actions ? "\212" : "\213", i < turn->actions ? PAL_AMBER : PAL_DIM, 255, FONT_OUTLINE, 0, 1);
    }
    if (who && who->side == SIDE_ENEMY) {
      StrikeInfo si;
      NormWeapon w[2];
      get_weapons(turn->actor->ch, w);
      combat_strike_info(&mission.combat, turn->actor, who, &w[0], apos(turn->actor), &si);
      if (si.ok) snprintf(buf, sizeof buf, "%s: trafienie %d%%, krytyk %d%%", w[0].name, (int)(si.hit * 100 + 0.5), (int)(si.crit * 100 + 0.5));
      else if (si.melee) snprintf(buf, sizeof buf, "%s: podejd\274 i zaatakuj", w[0].name);
      else snprintf(buf, sizeof buf, "%s: poza zasi\352giem / brak linii strza\263u", w[0].name);
      font_draw(10, 31, buf, si.ok ? PAL_GOOD : PAL_DIM, 255, FONT_OUTLINE, 0, 1);
    } else font_draw(10, 31, tmode != MD_NONE ? tmode_hint : "fire: ruch / atak \205 Esc: akcje", PAL_DIM, 255, FONT_OUTLINE, 0, 1);
  }
  /* dziennik */
  for (i = 0; i < n_log; i++) {
    float y = V_H - 12 - (n_log - 1 - i) * 9;
    r2d_rect(4, y - 1, (float)font_measure(log_line[i], 0) + 4, 9, 0, 140);
    font_draw(6, y, log_line[i], log_col[i], 255, FONT_OUTLINE, 0, 1);
  }
  if (banner_ms > 0) {
    int a = banner_ms > 1100 ? (1400 - banner_ms) * 255 / 300 : banner_ms < 300 ? banner_ms * 255 / 300 : 255;
    int w = font_measure(banner, 1) * 2 + 24;
    r2d_rect(V_W / 2.0f - w / 2.0f, 60, (float)w, 26, 0, a * 3 / 4);
    font_draw_at(V_W / 2.0f, 73, 0.5f, 0.5f, banner, banner_col, a, FONT_OUTLINE, 1, 2);
  }
  if (mode == M_EXPLORE) font_draw_at(V_W - 6, V_H - 4, 1, 1, tmode != MD_NONE ? tmode_hint : "Strza\263ki: kursor \205 fire: id\274 / obiekt \205 Esc: akcje", PAL_DIM, 255, FONT_OUTLINE, 0, 1);
}

static void draw(void) {
  int i, j, order[MAX_UNITS], n = 0;
  int32_t ud[MAX_UNITS];
  r2d_rect(0, 0, V_W, V_H, BIOME_BG[biome], 255);
  if (!loaded) {
    font_draw_at(V_W / 2, V_H / 2, 0.5f, 0.5f, "Brak plik\363w grafiki misji (katalog gfx/)", PAL_BAD, 255, FONT_OUTLINE, 0, 1);
    return;
  }
  r2d_offset((float)(int)(V_W / 2.0f - cam_x), (float)(int)(V_H / 2.0f - cam_y));
  for (i = 0; i < n_units; i++) {
    const UnitV *u = &units[i];
    int gx = (int)floor((u->x / 16 + (u->y - 8) / 8) / 2 + 0.5f), gy = (int)floor(((u->y - 8) / 8 - u->x / 16) / 2 + 0.5f);
    if (!unit_visible(u)) continue;
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
      int st;
      if (!overlay && (!s || s->depth > D_AO)) {
        int k;
        overlay = 1;
        draw_overlay();
        for (k = 0; k < n; k++) {
          const UnitV *u = &units[order[k]];
          if (u->a->state == AST_UP) atlas_draw(&atlas, &img_shadow, u->x - img_shadow.w / 2.0f, u->y - img_shadow.h / 2.0f, 0, 0xffffff, 255);
        }
      }
      if (!s) break;
      while (j < n && ud[order[j]] < s->depth) draw_unit(&units[order[j++]]);
      if (s->hidden) continue;
      if (s->cell < 0) {
        atlas_draw(&atlas, &s->img, s->x, s->y, s->flip, 0xffffff, 255);
        continue;
      }
      st = cell_state[s->cell];
      if (!st) continue;
      atlas_draw(&atlas, &s->img, s->x, s->y, s->flip, st == 2 ? 0xffffff : memory_tint, cell_reveal[s->cell]);
    }
  }
  while (j < n) draw_unit(&units[order[j++]]);
  for (i = 0; i < n_floats; i++) {
    const Float *f = &floats[i];
    int a = f->ms < 300 ? f->ms * 255 / 300 : 255;
    font_draw_at(f->x, f->y - (1000 - f->ms) * 16 / 1000.0f, 0.5f, 0.5f, f->text, f->col, a, FONT_OUTLINE, 1, 1);
  }
  r2d_offset(0, 0);
  draw_hud();
  ui_menu_draw(&menu, 6, V_H - 2 - 6 * 9);
  ui_choice_draw(&choice);
  ui_toast_draw();
}

const Screen SCREEN_MISSION = {enter, update, draw, leave};
