/* Ślad warstwy taktycznej (mapy, Dijkstra, ścieżki, widoczność) - zgodny z amiga/data/traces/tactical.txt. */
#include <stdio.h>
#include <string.h>
#include "trace_fmt.h"
#include "../src/core/tactical.h"

static const uint8_t L1[] = {ENEMY_RAIDER_THUG, ENEMY_RAIDER_GUNNER, ENEMY_DOG_MUTANT, ENEMY_RAIDER_PSYCHO, ENEMY_DRONE, ENEMY_RAIDER_CHIEF};
static const uint8_t L2[] = {ENEMY_KOSTUCHA, ENEMY_RAIDER_THUG, ENEMY_RAIDER_THUG, ENEMY_RAIDER_GUNNER, ENEMY_RAIDER_SNIPER, ENEMY_RAIDER_PSYCHO, ENEMY_RAIDER_BURNER};
static const uint8_t L3[] = {ENEMY_RAT_MUTANT, ENEMY_RAT_MUTANT, ENEMY_RAT_MUTANT, ENEMY_RAT_MUTANT, ENEMY_SCORPION, ENEMY_FLY_SWARM, ENEMY_GHOUL, ENEMY_MUTANT_BRUTE};
static const uint8_t *const LISTS[4] = {NULL, L1, L2, L3};
static const int LIST_N[4] = {0, 6, 7, 8};
static const char *const BIOME_KEYS[4] = {"ruins", "wastes", "industrial", "bunker"};

static void dump_map(const TacticalMap *m) {
  int x, y, i, k, near = 0;
  printf("seed=%lu entry=%d,%d maxD=%d obj=", (unsigned long)m->seed, m->entry.x0, m->entry.y0, m->max_d);
  if (m->has_obj) printf("%d,%d,%d\n", m->obj.gx, m->obj.gy, m->obj.d); else printf("-\n");
  for (y = 0; y < MAP_H; y++) {
    printf("row ");
    for (x = 0; x < MAP_W; x++) putchar('0' + m->grid.cells[y * MAP_W + x]);
    putchar(' ');
    for (x = 0; x < MAP_W; x++) putchar('a' + m->floor[y * MAP_W + x]);
    putchar('\n');
  }
  printf("props ");
  for (i = 0; i < m->n_props; i++) printf("%s%s@%d,%d/%d/%d", i ? ";" : "", PROP_KEYS[m->props[i].type], m->props[i].gx, m->props[i].gy, m->props[i].rot, m->props[i].seed);
  printf("\ndeco ");
  for (i = 0; i < m->n_deco; i++) printf("%s%s@%d,%d/%d/%d", i ? ";" : "", PROP_KEYS[m->deco[i].type], m->deco[i].gx, m->deco[i].gy, m->deco[i].rot, m->deco[i].seed);
  printf("\ndecor ");
  for (i = 0; i < m->n_decor; i++) printf("%s%s@%d,%d", i ? ";" : "", PROP_KEYS[m->decor[i].type], m->decor[i].gx, m->decor[i].gy);
  printf("\nbuildings ");
  for (i = 0; i < m->n_buildings; i++) {
    const MapBuilding *b = &m->buildings[i];
    printf("%s%d,%d,%d,%d,%d,%d", i ? ";" : "", b->gx, b->gy, b->w, b->d, b->h, b->seed);
  }
  for (i = 0; i < m->n_solids; i++) near += m->solids[i].near;
  printf("\nsolids %d %d\n", m->n_solids, near);
  for (i = 0; i < m->n_groups; i++) {
    const GroupSpawn *g = &m->groups[i];
    printf("group %d,%d,%d roam=%d ", g->center.gx, g->center.gy, g->center.d, g->roam);
    for (k = 0; k < g->n; k++) printf("%s%s", k ? "," : "", ENEMY_DEFS[g->members[k]].key);
    putchar(' ');
    for (k = 0; k < g->n; k++) printf("%s%d,%d", k ? ";" : "", g->cells[k].gx, g->cells[k].gy);
    putchar('\n');
  }
  printf("crates ");
  for (i = 0; i < m->n_crates; i++) printf("%s%d,%d", i ? ";" : "", m->crates[i].gx, m->crates[i].gy);
  printf("\nfinds ");
  for (i = 0; i < m->n_finds; i++) printf("%s%d,%d,%s,%d", i ? ";" : "", m->finds[i].gx, m->finds[i].gy, FIND_KEYS[m->finds[i].kind], m->finds[i].hidden);
  printf("\nreach %d\n", m->n_reach);
}

int main(void) {
  static TacticalMap m;
  static Search s;
  static Pos path[1024];
  static int16_t vis[GRID_N];
  char id[64];
  int b, k, i;
  for (b = 0; b < 4; b++) {
    for (k = 0; k < 12; k++) {
      MapSpec spec;
      int defend = k % 5 == 4;
      sprintf(id, "map:%s:%d", BIOME_KEYS[b], k);
      spec.id = id;
      spec.biome = (uint8_t)b;
      spec.level = 1 + k % 5;
      spec.type = defend ? OBJ_DEFEND : OBJ_ELIMINATE;
      generate_map(&spec, LISTS[k % 4], LIST_N[k % 4], &m);
      printf("map %s %s %d\n", id, defend ? "defend" : "eliminate", spec.level);
      dump_map(&m);
      if (k < 3) {
        static const double COSTS[3] = {6, 12.5, 40};
        static const int RS[2] = {5, 9};
        Pos st = entry_cell(&m.entry, 5);
        int c;
        for (c = 0; c < 3; c++) {
          int n = 0;
          uint32_t sum = 0;
          grid_search(&m.grid, st, COSTS[c], NULL, NULL, &s);
          for (i = 0; i < GRID_N; i++) {
            if (s.cost[i] >= UNREACHABLE) continue;
            n++;
            sum = sum + (uint32_t)(i + 1) * (uint32_t)(s.cost[i] * 2) + (uint32_t)(s.prev[i] + 1) * 7u;
          }
          if (c == 1) printf("search 12.5 n=%d sum=%lu\n", n, (unsigned long)sum);
          else printf("search %d n=%d sum=%lu\n", (int)COSTS[c], n, (unsigned long)sum);
        }
        if (m.has_obj) {
          int n = grid_find_path(&m.grid, st, mkpos(m.obj.gx, m.obj.gy), NULL, NULL, 999, path, 1024);
          printf("path ");
          if (n < 0) printf("null");
          for (i = 0; i < n; i++) printf("%s%d,%d", i ? ";" : "", path[i].gx, path[i].gy);
          printf("\n");
        }
        for (c = 0; c < 2; c++) {
          int n = grid_visible(&m.grid, st, RS[c], vis);
          uint32_t h = 7;
          for (i = 0; i < n; i++) h = h * 31u + (uint32_t)vis[i];
          printf("visible %d %d %lu\n", RS[c], n, (unsigned long)h);
        }
      }
    }
  }
  return 0;
}
