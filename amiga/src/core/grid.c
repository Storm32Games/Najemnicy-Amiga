/* Siatka taktyczna: Dijkstra 8-kierunkowa (przekątna 1.5), linia strzału z osłoną, pole widzenia. Port grid.ts. */
#include <string.h>
#include "tactical.h"

static const int8_t DIRS8[8][2] = {{1, 0}, {-1, 0}, {0, 1}, {0, -1}, {1, 1}, {1, -1}, {-1, 1}, {-1, -1}};
static const int8_t DIRS4[4][2] = {{1, 0}, {-1, 0}, {0, 1}, {0, -1}};

int grid_kind(const Grid *g, int gx, int gy) { return in_bounds(gx, gy) ? g->cells[gidx(gx, gy)] : CELL_HIGH; }
int grid_free(const Grid *g, int gx, int gy) { return grid_kind(g, gx, gy) == CELL_FREE; }
void grid_set(Grid *g, int gx, int gy, int kind) {
  if (in_bounds(gx, gy)) g->cells[gidx(gx, gy)] = (uint8_t)kind;
}

/* Kolejka kubełkowa: koszty to wielokrotności 0.5, kubełek = 2 * koszt. W kubełku FIFO - tak samo jak w TS
 * (liniowe szukanie pierwszego minimum w tablicy, do której wpisy są dopisywane na końcu). */
#define QMAX 24576
#define BMAX 4096
static int16_t q_cell[QMAX], q_next[QMAX];
static int16_t b_head[BMAX], b_tail[BMAX];

void grid_search(const Grid *g, Pos start, double max_cost, PassFn pass, void *ctx, Search *out) {
  int i, nq = 0, maxb = (int)(max_cost * 2), cur = 0;
  if (maxb >= BMAX) maxb = BMAX - 1;
  for (i = 0; i < GRID_N; i++) {
    out->cost[i] = UNREACHABLE;
    out->prev[i] = -1;
  }
  for (i = 0; i <= maxb; i++) b_head[i] = b_tail[i] = -1;
  out->cost[gidx(start.gx, start.gy)] = 0;
  q_cell[0] = (int16_t)gidx(start.gx, start.gy);
  q_next[0] = -1;
  b_head[0] = b_tail[0] = 0;
  nq = 1;
  for (;;) {
    int e, cell, x, y, d;
    double c;
    while (cur <= maxb && b_head[cur] < 0) cur++;
    if (cur > maxb) break;
    e = b_head[cur];
    b_head[cur] = q_next[e];
    if (b_head[cur] < 0) b_tail[cur] = -1;
    cell = q_cell[e];
    c = cur * 0.5;
    if (c > out->cost[cell]) continue;
    x = cell % MAP_W;
    y = cell / MAP_W;
    for (d = 0; d < 8; d++) {
      int dx = DIRS8[d][0], dy = DIRS8[d][1], nx = x + dx, ny = y + dy, ni, b;
      double nc;
      if (!grid_free(g, nx, ny)) continue;
      if (pass && !pass(ctx, nx, ny)) continue;
      if (dx && dy && (!grid_free(g, x + dx, y) || !grid_free(g, x, y + dy))) continue;
      nc = c + (dx && dy ? 1.5 : 1);
      if (nc > max_cost) continue;
      ni = gidx(nx, ny);
      if (nc < out->cost[ni]) {
        out->cost[ni] = (float)nc;
        out->prev[ni] = (int16_t)cell;
        b = (int)(nc * 2);
        if (nq >= QMAX || b > maxb) continue; /* nie powinno się zdarzyć */
        q_cell[nq] = (int16_t)ni;
        q_next[nq] = -1;
        if (b_tail[b] >= 0) q_next[b_tail[b]] = (int16_t)nq;
        else b_head[b] = (int16_t)nq;
        b_tail[b] = (int16_t)nq;
        nq++;
      }
    }
  }
}

int grid_reachable(const Search *s, Pos p) { return in_bounds(p.gx, p.gy) && s->cost[gidx(p.gx, p.gy)] < UNREACHABLE; }

int grid_path_from(const Search *s, Pos target, Pos *path, int max) {
  int i = gidx(target.gx, target.gy), n = 0, k;
  if (s->cost[i] >= UNREACHABLE) return -1;
  while (s->prev[i] >= 0) {
    if (n < max) path[n] = mkpos(i % MAP_W, i / MAP_W);
    n++;
    i = s->prev[i];
  }
  if (n > max) n = max;
  for (k = 0; k < n / 2; k++) {
    Pos t = path[k];
    path[k] = path[n - 1 - k];
    path[n - 1 - k] = t;
  }
  return n;
}

int grid_find_path(const Grid *g, Pos a, Pos b, PassFn pass, void *ctx, double max_cost, Pos *path, int max) {
  static Search s;
  grid_search(g, a, max_cost, pass, ctx, &s);
  return grid_path_from(&s, b, path, max);
}

/* Najmniejsze k >= 0 z k*k >= v. */
static int ceil_sqrt(int v) {
  int k = (int)ceil(sqrt((double)v));
  while (k * k < v) k++;
  while (k > 0 && (k - 1) * (k - 1) >= v) k--;
  return k;
}
static int floor_div(int a, int b) { int q = a / b; return (a % b != 0 && ((a < 0) != (b < 0))) ? q - 1 : q; }

static Los clear_line(const Grid *g, Pos a, Pos b) {
  Los r = {1, 0};
  int dx = b.gx - a.gx, dy = b.gy - a.gy, n = ceil_sqrt(9 * (dx * dx + dy * dy)), n2, s, last = -1;
  if (n < 2) n = 2;
  n2 = 2 * n;
  for (s = 1; s < n; s++) {
    int x = a.gx + floor_div(2 * dx * s + n, n2);
    int y = a.gy + floor_div(2 * dy * s + n, n2);
    int key = y * MAP_W + x, k, cx, cy;
    if (key == last || (x == a.gx && y == a.gy) || (x == b.gx && y == b.gy)) continue;
    last = key;
    k = grid_kind(g, x, y);
    if (k == CELL_HIGH) {
      r.clear = 0;
      r.cover = 0;
      return r;
    }
    cx = abs(x - b.gx);
    cy = abs(y - b.gy);
    if (k == CELL_LOW && (cx > cy ? cx : cy) <= 1) r.cover = 1;
  }
  return r;
}

Los grid_los(const Grid *g, Pos a, Pos b) {
  Los r = clear_line(g, a, b);
  if (r.clear) return r;
  r.clear = clear_line(g, b, a).clear;
  r.cover = 0;
  return r;
}

int grid_visible(const Grid *g, Pos o, int r, int16_t *out) {
  int x, y, n = 0;
  for (y = o.gy - r; y <= o.gy + r; y++) {
    for (x = o.gx - r; x <= o.gx + r; x++) {
      Pos p;
      if (!in_bounds(x, y) || js_hypot(x - o.gx, y - o.gy) > r + 0.3) continue;
      p = mkpos(x, y);
      if (clear_line(g, o, p).clear || clear_line(g, p, o).clear) out[n++] = (int16_t)gidx(x, y);
    }
  }
  return n;
}

int grid_has_low_cover_near(const Grid *g, Pos p) {
  int d;
  for (d = 0; d < 4; d++) if (grid_kind(g, p.gx + DIRS4[d][0], p.gy + DIRS4[d][1]) == CELL_LOW) return 1;
  return 0;
}

int stride_actions(double cost, int speed) {
  int a = (int)ceil(cost / speed - 1e-6);
  return a < 1 ? 1 : a;
}
