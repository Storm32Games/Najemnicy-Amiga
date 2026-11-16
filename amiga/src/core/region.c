/* Region kampanii. Port src/core/campaign/region.ts - same liczby całkowite (Q8). */
#include "region.h"

#define SEG 16
#define Q04 102     /* q(0.4)  */
#define Q16 410     /* q(1.6)  */
#define Q25 640     /* q(2.5)  */
#define Q2 512      /* q(2)    */
#define Q09 230     /* q(0.9)  */

int isqrt32(int32_t n) {
  uint32_t r = 0, bit = 1u << 30, v;
  if (n <= 0) return 0;
  v = (uint32_t)n;
  while (bit > v) bit >>= 2;
  while (bit) {
    if (v >= r + bit) {
      v -= r + bit;
      r = (r >> 1) + bit;
    } else r >>= 1;
    bit >>= 2;
  }
  return (int)r;
}

int in_city(WPos p) {
  int32_t ex = ((p.x - REGION_CITY.x) * 256) / (REGION_CITY.rx - Q04);
  int32_t ez = ((p.z - REGION_CITY.z) * 256) / (REGION_CITY.rz - Q04);
  return ex * ex + ez * ez < 65536;
}

static int city_route(WPos plaza, WPos *out) {
  int32_t sx = plaza.x - (REGION_CITY.g >> 1);
  out[0].x = REGION_GATE.x; out[0].z = REGION_AVENUE_Z;
  out[1].x = sx; out[1].z = REGION_AVENUE_Z;
  out[2].x = sx; out[2].z = plaza.z;
  out[3].x = plaza.x - 90; /* q(0.35) */
  out[3].z = plaza.z;
  return 4;
}

int height_q8(int32_t x, int32_t z) {
  const int32_t maxX = (HMAP_W - 1) * HMAP_STEP - 1, maxZ = (HMAP_H - 1) * HMAP_STEP - 1;
  int32_t fx = x - HMAP_X0, fz = z - HMAP_Z0, i, j, ax, az, o, top, bot;
  fx = fx < 0 ? 0 : fx > maxX ? maxX : fx;
  fz = fz < 0 ? 0 : fz > maxZ ? maxZ : fz;
  i = fx >> 7;
  j = fz >> 7;
  ax = fx & 127;
  az = fz & 127;
  o = j * HMAP_W + i;
  top = REGION_HEIGHT[o] * (128 - ax) + REGION_HEIGHT[o + 1] * ax;
  bot = REGION_HEIGHT[o + HMAP_W] * (128 - ax) + REGION_HEIGHT[o + HMAP_W + 1] * ax;
  return (top * (128 - az) + bot * az) >> 14;
}

/* ---------------------------------------------------------------- trasy */
typedef struct { WPos p[ROUTE_MAX]; int n; } PtList;
static void push(PtList *l, int32_t x, int32_t z) {
  if (l->n < ROUTE_MAX) {
    l->p[l->n].x = x;
    l->p[l->n].z = z;
    l->n++;
  }
}

static void catmull(const WPos *pts, int n, PtList *out) {
  int i, s;
  if (!out->n) push(out, pts[0].x, pts[0].z);
  for (i = 0; i + 1 < n; i++) {
    WPos p0 = pts[i > 0 ? i - 1 : 0], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2 < n ? i + 2 : n - 1];
    for (s = 1; s <= SEG; s++) {
      int32_t t = (s * 256) / SEG, t2 = (t * t) >> 8, t3 = (t2 * t) >> 8;
      int32_t w0 = -t3 + 2 * t2 - t, w1 = 3 * t3 - 5 * t2 + 512, w2 = -3 * t3 + 4 * t2 + t, w3 = t3 - t2;
      push(out, (w0 * p0.x + w1 * p1.x + w2 * p2.x + w3 * p3.x) >> 9, (w0 * p0.z + w1 * p1.z + w2 * p2.z + w3 * p3.z) >> 9);
    }
  }
}

static void polyline(const WPos *pts, int n, PtList *out) {
  int i, s;
  if (!out->n) push(out, pts[0].x, pts[0].z);
  for (i = 0; i + 1 < n; i++) {
    WPos a = pts[i], b = pts[i + 1];
    for (s = 1; s <= SEG; s++) push(out, a.x + ((b.x - a.x) * s) / SEG, a.z + ((b.z - a.z) * s) / SEG);
  }
}

static void finish_route(const PtList *l, int track_from, Route *r) {
  int i;
  r->n = l->n;
  for (i = 0; i < l->n; i++) {
    r->x[i] = l->p[i].x;
    r->z[i] = l->p[i].z;
    if (i) {
      int32_t dx = r->x[i] - r->x[i - 1], dz = r->z[i] - r->z[i - 1];
      r->cum[i] = r->cum[i - 1] + isqrt32(dx * dx + dz * dz);
    } else r->cum[i] = 0;
  }
  r->len = r->cum[l->n - 1];
  r->track_from = track_from;
}

static void avoid_halls(PtList *l) {
  int h, i, j, k;
  for (h = 0; h < HALL_COUNT; h++) {
    int32_t x0 = HALL_BOXES[h][0], x1 = HALL_BOXES[h][1], z0 = HALL_BOXES[h][2], z1 = HALL_BOXES[h][3];
#define INSIDE(p) ((p).x > x0 && (p).x < x1 && (p).z > z0 && (p).z < z1)
    for (i = 0; i < l->n; i++) {
      WPos m;
      int32_t d[4], best;
      int e = 0;
      if (!INSIDE(l->p[i])) continue;
      j = i;
      while (j + 1 < l->n && INSIDE(l->p[j + 1])) j++;
      m = l->p[(i + j) >> 1];
      d[0] = m.x - x0;
      d[1] = x1 - m.x;
      d[2] = m.z - z0;
      d[3] = z1 - m.z;
      best = d[0];
      for (k = 1; k < 4; k++) if (d[k] < best) { best = d[k]; e = k; }
      for (k = i; k <= j; k++) {
        if (e == 0) l->p[k].x = x0;
        else if (e == 1) l->p[k].x = x1;
        else if (e == 2) l->p[k].z = z0;
        else l->p[k].z = z1;
      }
      i = j;
    }
#undef INSIDE
  }
}

static int highway(WPos *out) {
  int j;
  for (j = 0; j <= 6; j++) {
    int32_t bulge = (SIN_LUT[((j * 128) / 6) & 255] * Q09) >> 12;
    out[j].x = REGION_HOME.x + ((REGION_GATE.x - REGION_HOME.x) * j) / 6;
    out[j].z = REGION_HOME.z + ((REGION_GATE.z - REGION_HOME.z) * j) / 6 + bulge;
  }
  return 7;
}

void build_route(WPos b, uint8_t biome, int index, Route *out) {
  static PtList l;
  WPos a = REGION_HOME;
  int32_t dx, dz;
  int k, hit = 0;
  l.n = 0;
  if (biome == BIOME_RUINS) {
    WPos hw[7], cr[4];
    int from;
    highway(hw);
    catmull(hw, 7, &l);
    from = l.n - 1;
    city_route(b, cr);
    polyline(cr, 4, &l);
    finish_route(&l, from, out);
    return;
  }
  dx = b.x - a.x;
  dz = b.z - a.z;
  for (k = 1; k < 20 && !hit; k++) {
    WPos p;
    p.x = a.x + (dx * k) / 20;
    p.z = a.z + (dz * k) / 20;
    hit = in_city(p);
  }
  if (hit) {
    WPos pts[RING_LEN + 2];
    const WPos *ring = b.z > REGION_CITY.z - Q2 ? RING_S : RING_N;
    int n = 0, i;
    pts[n++] = a;
    for (i = 0; i < RING_LEN; i++) if (ring[i].x < b.x - Q25) pts[n++] = ring[i];
    pts[n++] = b;
    catmull(pts, n, &l);
  } else {
    int32_t sg = index % 2 ? 1 : -1;
    WPos pts[4];
    pts[0] = a;
    pts[1].x = a.x + (dx * 3) / 10 + (sg * -dz) / 10;
    pts[1].z = a.z + (dz * 3) / 10 + (sg * dx) / 10;
    pts[2].x = a.x + (dx * 68) / 100 - (sg * -dz * 7) / 100;
    pts[2].z = a.z + (dz * 68) / 100 - (sg * dx * 7) / 100;
    pts[3] = b;
    catmull(pts, 4, &l);
  }
  avoid_halls(&l);
  finish_route(&l, 0, out);
}

WPos route_point_at(const Route *r, int32_t d) {
  WPos p;
  int lo = 0, hi = r->n - 1;
  int32_t span, k;
  if (d <= 0) { p.x = r->x[0]; p.z = r->z[0]; return p; }
  if (d >= r->len) { p.x = r->x[r->n - 1]; p.z = r->z[r->n - 1]; return p; }
  while (hi - lo > 1) {
    int mid = (lo + hi) >> 1;
    if (r->cum[mid] <= d) lo = mid;
    else hi = mid;
  }
  span = r->cum[hi] - r->cum[lo];
  if (!span) span = 1;
  k = d - r->cum[lo];
  p.x = r->x[lo] + ((r->x[hi] - r->x[lo]) * k) / span;
  p.z = r->z[lo] + ((r->z[hi] - r->z[lo]) * k) / span;
  return p;
}

int route_ticks(const Route *r) {
  int t = (int)(((int64_t)r->len * 1000) / 10752);
  return t > 400 ? t : 400;
}

const SectorDef *sector_of(uint8_t biome) {
  int i;
  for (i = 0; i < SECTOR_COUNT; i++) if (SECTOR_DEFS[i].biome == biome) return &SECTOR_DEFS[i];
  return &SECTOR_DEFS[0];
}

void contract_spots(const Contract *contracts, int n, WPos *out) {
  int used[BIOME_COUNT] = {0}, i;
  for (i = 0; i < n; i++) {
    const SectorDef *sec = sector_of(contracts[i].biome);
    int c = ++used[contracts[i].biome], lap = (c - 1) / sec->n_spots;
    WPos s = sec->spots[(c - 1) % sec->n_spots];
    if (!lap) out[i] = s;
    else {
      int32_t dx = sec->x - s.x, dz = sec->z - s.z, len = (dx < 0 ? -dx : dx) + (dz < 0 ? -dz : dz), k;
      if (len < 1) len = 1;
      k = Q16 * lap < (len >> 1) ? Q16 * lap : len >> 1;
      out[i].x = s.x + (dx * k) / len;
      out[i].z = s.z + (dz * k) / len;
    }
  }
}
