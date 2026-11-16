/* Region kampanii: miasto, trasy podróży, wysokość terenu, miejsca zleceń. Port src/core/campaign/region.ts (Q8, bez FPU). */
#ifndef REGION_H
#define REGION_H

#include "campaign.h"

#define ROUTE_MAX 512
typedef struct {
  int32_t x[ROUTE_MAX], z[ROUTE_MAX], cum[ROUTE_MAX];
  int n;
  int32_t len;
  int track_from;
} Route;

int isqrt32(int32_t n);
int in_city(WPos p);
int height_q8(int32_t x, int32_t z);
void build_route(WPos target, uint8_t biome, int index, Route *out);
WPos route_point_at(const Route *r, int32_t d);
int route_ticks(const Route *r);
const SectorDef *sector_of(uint8_t biome);
/* Miejsca zleceń na mapie (w kolejności tablicy zleceń). */
void contract_spots(const Contract *contracts, int n, WPos *out);

#endif
