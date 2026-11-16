/* Ślad regionu kampanii - zgodny z amiga/data/traces/region.txt (tools/amiga/trace_region.ts). */
#include <stdio.h>
#include "trace_fmt.h"
#include "../src/core/region.h"

static const char *const BIOME_K[4] = {"ruins", "wastes", "industrial", "bunker"};

int main(void) {
  static Route r;
  static Contract list[40];
  WPos spots[40];
  int s, si, idx, i, k;
  int32_t x, z;
  for (s = 0; s < SECTOR_COUNT; s++) {
    const SectorDef *sec = &SECTOR_DEFS[s];
    for (si = 0; si < sec->n_spots; si++) {
      for (idx = 0; idx < 2; idx++) {
        uint32_t h = 7;
        build_route(sec->spots[si], sec->biome, idx + si, &r);
        for (i = 0; i < r.n; i++) h = h * 31u + (uint32_t)(r.x[i] * 3 + r.z[i]);
        printf("route %s %d %d n=%d len=%ld from=%d ticks=%d h=%lu", BIOME_K[sec->biome], si, idx, r.n, (long)r.len, r.track_from, route_ticks(&r), (unsigned long)h);
        for (k = 0; k <= 7; k++) {
          WPos p = route_point_at(&r, (int32_t)(((int64_t)r.len * k) / 7));
          printf("%s%ld,%ld", k ? ";" : " ", (long)p.x, (long)p.z);
        }
        printf("\n");
      }
    }
  }
  for (z = -24 * 256; z <= 24 * 256; z += 777) {
    printf("h %ld ", (long)z);
    for (x = -36 * 256; x <= 36 * 256; x += 613) {
      WPos p;
      p.x = x;
      p.z = z;
      printf("%s%d%s", x == -36 * 256 ? "" : ",", height_q8(x, z), in_city(p) ? "*" : "");
    }
    printf("\n");
  }
  for (i = 0; i < 40; i++) list[i].biome = (uint8_t)((i * 7) % 4);
  contract_spots(list, 40, spots);
  printf("spots");
  for (i = 0; i < 40; i++) printf("%s%ld,%ld", i ? ";" : " ", (long)spots[i].x, (long)spots[i].z);
  printf("\n");
  return 0;
}
