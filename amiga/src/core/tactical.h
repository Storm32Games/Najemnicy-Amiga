/* Warstwa taktyczna: siatka, generator map, walka turowa, AI, misja. Port src/core/tactical (TS).
 * Liczby zmiennoprzecinkowe: double (IEEE 754) z tą samą kolejnością działań co w TS; na Amidze soft-float. */
#ifndef TACTICAL_H
#define TACTICAL_H

#include <math.h>
#include <stdlib.h>
#include "rules.h"

/* ---------------------------------------------------------------- pomocnicze JS */
static inline double rng_f(Rng *r) { return rng_next(r) / 4294967296.0; }            /* rng() */
static inline int rng_ri(Rng *r, int a, int b) { return a + (int)floor(rng_f(r) * (b - a + 1)); }
static inline double js_round(double x) { double f = floor(x); return x - f >= 0.5 ? f + 1 : f; } /* Math.round */
static inline double js_hypot(double dx, double dy) { return sqrt(dx * dx + dy * dy); }

typedef struct { int8_t gx, gy; } Pos;
static inline int cheb(Pos a, Pos b) { int dx = abs(a.gx - b.gx), dy = abs(a.gy - b.gy); return dx > dy ? dx : dy; }
static inline double pdist(Pos a, Pos b) { return js_hypot(a.gx - b.gx, a.gy - b.gy); }
static inline Pos mkpos(int x, int y) { Pos p; p.gx = (int8_t)x; p.gy = (int8_t)y; return p; }

/* ---------------------------------------------------------------- siatka (grid.ts) */
enum { CELL_FREE = 0, CELL_LOW = 1, CELL_HIGH = 2, CELL_HAZARD = 3 };
#define GRID_N (MAP_W * MAP_H)
#define UNREACHABLE 1e9f

typedef struct { uint8_t cells[GRID_N]; } Grid; /* MAP_W x MAP_H, indeks gy * MAP_W + gx */
typedef struct { float cost[GRID_N]; int16_t prev[GRID_N]; } Search;
typedef int (*PassFn)(void *ctx, int gx, int gy);
typedef struct { int clear, cover; } Los;

static inline int in_bounds(int gx, int gy) { return gx >= 0 && gy >= 0 && gx < MAP_W && gy < MAP_H; }
static inline int gidx(int gx, int gy) { return gy * MAP_W + gx; }
int grid_kind(const Grid *g, int gx, int gy);
int grid_free(const Grid *g, int gx, int gy);
void grid_set(Grid *g, int gx, int gy, int kind);
void grid_search(const Grid *g, Pos start, double max_cost, PassFn pass, void *ctx, Search *out);
int grid_reachable(const Search *s, Pos p);
int grid_path_from(const Search *s, Pos target, Pos *path, int max); /* długość albo -1 */
int grid_find_path(const Grid *g, Pos a, Pos b, PassFn pass, void *ctx, double max_cost, Pos *path, int max);
Los grid_los(const Grid *g, Pos a, Pos b);
int grid_visible(const Grid *g, Pos origin, int r, int16_t *out); /* indeksy pól; zwraca liczbę */
int grid_has_low_cover_near(const Grid *g, Pos p);
int stride_actions(double cost, int speed);

/* ---------------------------------------------------------------- generator map (mapgen.ts) */
/* Biome z gamedata.h: BIOME_RUINS, BIOME_WASTES, BIOME_INDUSTRIAL, BIOME_BUNKER */
typedef enum { FL_SAND, FL_ASPHALT, FL_ASPHALT_CRACKED, FL_RUBBLE, FL_CONCRETE, FL_DIRT, FL_TOXIC, FL_GRASS_DEAD, FL_METAL, FL_TILES, FL_COUNT } FloorType;
typedef enum {
  PR_CAR, PR_BUS, PR_BARREL, PR_BARREL_TOXIC, PR_CRATE, PR_DEBRIS, PR_SANDBAGS, PR_CONTAINER, PR_FENCE, PR_GENERATOR, PR_PILLAR,
  PR_TERMINAL, PR_TENT, PR_TANK_TRAP, PR_SCRAP_PILE, PR_WALL, PR_WALL_BROKEN,
  PR_LAMP, PR_SIGN, PR_ANTENNA, PR_TREE_DEAD, PR_SKELETON, PR_CAMPFIRE, PR_DOOR,
  PR_FLORA_SAGUARO, PR_FLORA_PEAR, PR_FLORA_DEADBUSH, PR_FLORA_SHROOMS, PR_FLORA_FLOWER, PR_FLORA_REEDS, PR_FLORA_GRASS, PR_FLORA_VINE,
  PR_FLORA_POD, PR_FLORA_FERN, PR_FLORA_CRYSTAL, PR_COUNT
} PropType;
typedef enum { FIND_SCRAP, FIND_CACHE, FIND_MEDICAL, FIND_TECH, FIND_FOOD, FIND_AMMO, FIND_COUNT } FindKind;
extern const char *const FLOOR_KEYS[FL_COUNT];
extern const char *const PROP_KEYS[PR_COUNT];
extern const char *const FIND_KEYS[FIND_COUNT];

#define MAX_PROPS 640
#define MAX_DECO 256
#define MAX_DECOR 48
#define MAX_BUILDINGS 96
#define MAX_MAP_GROUPS 16
#define MAX_GROUP_MEMBERS 16
#define MAX_CRATES 8
#define MAX_FINDS 24
#define MAX_ENEMIES_IN 16

typedef struct { int8_t gx, gy; uint8_t type, rot; uint16_t seed; } MapProp;
typedef struct { int8_t gx, gy; uint8_t w, d, h; uint16_t seed; } MapBuilding;
typedef struct { int8_t gx, gy; int16_t d; } ReachCell;
typedef struct { int8_t gx, gy; uint8_t near; } Solid;
typedef struct { uint8_t type; int8_t gx, gy; } Decor;
typedef struct {
  ReachCell center;
  uint8_t n, roam;
  uint8_t members[MAX_GROUP_MEMBERS]; /* EnemyId */
  Pos cells[MAX_GROUP_MEMBERS];
} GroupSpawn;
typedef struct { int8_t gx, gy; uint8_t kind, hidden; } FindSpawn;
typedef struct { int8_t x0, y0, x1, y1; } EntryZone; /* pola wejścia: y0..y1 x x0..x1 (y zewnętrzne) */

typedef struct {
  uint8_t biome;
  Grid grid;
  uint8_t floor[GRID_N];
  uint16_t n_props, n_deco, n_solids, n_reach;
  uint8_t n_decor, n_buildings, n_groups, n_crates, n_finds, has_obj;
  MapProp props[MAX_PROPS];
  MapProp deco[MAX_DECO];
  Decor decor[MAX_DECOR];
  MapBuilding buildings[MAX_BUILDINGS];
  Solid solids[GRID_N];
  EntryZone entry;
  GroupSpawn groups[MAX_MAP_GROUPS];
  Pos crates[MAX_CRATES];
  FindSpawn finds[MAX_FINDS];
  ReachCell obj;
  ReachCell reach[GRID_N];
  int16_t max_d;
  uint32_t seed;
} TacticalMap;

typedef struct {
  const char *id;               /* ziarno mapy (id zlecenia) */
  uint8_t biome;
  int level;
  uint8_t type;                 /* ObjectiveType */
} MapSpec;

void generate_map(const MapSpec *spec, const uint8_t *enemy_ids, int n_enemies, TacticalMap *m);
Pos entry_cell(const EntryZone *e, int i); /* i-te pole strefy wejścia (0..15) */
int in_entry_zone(const EntryZone *e, Pos p);

#endif
