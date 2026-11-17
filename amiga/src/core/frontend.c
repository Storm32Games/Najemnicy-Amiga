/* Logika ekranów startowych. Port src/core/frontend/{fixed,logo,flow,menu,fx}.ts. */
#include <string.h>
#include <math.h>
#include "frontend.h"

#define PI_D 3.141592653589793
static double jsround(double x) { double f = floor(x); return x - f >= 0.5 ? f + 1 : f; }

int ease_out3(int k) {
  int i, f, a;
  if (k <= 0) return 0;
  if (k >= FQ12) return FQ12;
  i = k >> 6;
  f = k & 63;
  a = EASE_OUT3_LUT[i];
  return a + (((EASE_OUT3_LUT[i + 1] - a) * f) >> 6);
}

/* ================================================================ zegar */
#define TICK_US 20000
void clock_reset(TickClock *c, int32_t tick) { c->tick = tick; c->acc_us = 0; }
int clock_advance(TickClock *c, int32_t ms, int max_ticks) {
  int n;
  c->acc_us += ms > 0 ? ms * 1000 : 0;
  n = c->acc_us / TICK_US;
  c->acc_us -= n * TICK_US;
  if (n > max_ticks) {
    n = max_ticks;
    c->acc_us = 0;
  }
  c->tick += n;
  return n;
}
int clock_alpha_q8(const TickClock *c) { return (int)(((int64_t)c->acc_us * FQ8) / TICK_US); }
int32_t clock_time_q8(const TickClock *c) { return c->tick * FQ8 + clock_alpha_q8(c); }

/* ================================================================ logo */
void logo_cubes_init(LogoCubes *c, const uint8_t *rgb, int stride, uint32_t seed) {
  static int16_t tx[LOGO_MAX_CUBES], ty[LOGO_MAX_CUBES], tsx[LOGO_MAX_CUBES], tsy[LOGO_MAX_CUBES];
  static uint16_t td[LOGO_MAX_CUBES], tu[LOGO_MAX_CUBES];
  static uint32_t tc[LOGO_MAX_CUBES];
  static uint32_t bucket[1024];
  Rng rng;
  int n = 0, x, y, i, max_land = 0;
  rng_seed(&rng, seed);
  for (y = 0; y < LOGO_GH; y++)
    for (x = 0; x < LOGO_GW; x++) {
      int o = (y * LOGO_GW + x) * stride, R = rgb[o], G = rgb[o + 1], B = rgb[o + 2];
      int mx = R > G ? (R > B ? R : B) : (G > B ? G : B), mn = R < G ? (R < B ? R : B) : (G < B ? G : B);
      int lum = mx, sat = mx - mn;
      if (lum < 58 && sat < 34) continue;
      td[n] = (uint16_t)(2 + (x * 45) / LOGO_GW + (int)rng_below(&rng, 38) + (lum > 200 ? 8 : 0));
      tx[n] = (int16_t)x;
      ty[n] = (int16_t)y;
      tsx[n] = (int16_t)(x + (int)rng_below(&rng, 59) - 29 + 15);
      tsy[n] = (int16_t)(-7 - (int)rng_below(&rng, 76));
      tu[n] = (uint16_t)(LOGO_DUR_MIN + (int)rng_below(&rng, LOGO_DUR_SPAN + 1));
      tc[n] = ((uint32_t)R << 16) | ((uint32_t)G << 8) | (uint32_t)B;
      n++;
    }
  c->count = n;
  c->cursor = 0;
  for (i = 0; i < n; i++) if (td[i] + tu[i] > max_land) max_land = td[i] + tu[i];
  memset(bucket, 0, sizeof(uint32_t) * (size_t)(max_land + 2));
  for (i = 0; i < n; i++) bucket[td[i] + tu[i] + 1]++;
  for (i = 1; i < max_land + 2; i++) bucket[i] += bucket[i - 1];
  for (i = 0; i < n; i++) {
    int j = (int)bucket[td[i] + tu[i]]++;
    uint32_t col = tc[i], R = col >> 16, G = (col >> 8) & 255, B = col & 255;
    c->x[j] = tx[i];
    c->y[j] = ty[i];
    c->sx[j] = tsx[i];
    c->sy[j] = tsy[i];
    c->delay[j] = td[i];
    c->dur[j] = tu[i];
    c->land[j] = (uint16_t)(td[i] + tu[i]);
    c->col[j] = col;
    c->hi[j] = ((R + 46 > 255 ? 255 : R + 46) << 16) | ((G + 46 > 255 ? 255 : G + 46) << 8) | (B + 46 > 255 ? 255 : B + 46);
    c->lo[j] = (((R * 141) >> 8) << 16) | (((G * 141) >> 8) << 8) | ((B * 154) >> 8);
  }
}

int logo_drain_landed(LogoCubes *c, int32_t tq8, void (*fn)(void *ctx, int i), void *ctx) {
  int k = 0;
  while (c->cursor < c->count && (int32_t)c->land[c->cursor] * FQ8 <= tq8) {
    if (fn) fn(ctx, c->cursor);
    c->cursor++;
    k++;
  }
  return k;
}

int logo_pose(const LogoCubes *c, int i, int32_t tq8, CubePose *out) {
  int32_t t0 = (int32_t)c->delay[i] * FQ8, k, e;
  if (tq8 <= t0 || tq8 >= (int32_t)c->land[i] * FQ8) return 0;
  k = ((tq8 - t0) * 16) / c->dur[i];
  e = ease_out3(k);
  out->x = c->sx[i] * FQ12 + (c->x[i] - c->sx[i]) * e;
  out->y = c->sy[i] * FQ12 + (c->y[i] - c->sy[i]) * e;
  out->s = FQ12 + ((FQ12 - e) * 8) / 5;
  return 1;
}

int logo_for_each_flying(const LogoCubes *c, int32_t tq8, CubeFn fn, void *ctx) {
  int k = 0, i;
  int32_t tick = tq8 >> 8;
  CubePose p;
  for (i = c->cursor; i < c->count; i++) {
    if ((int32_t)c->land[i] - LOGO_MAX_DUR > tick) break;
    if (logo_pose(c, i, tq8, &p)) {
      if (fn) fn(ctx, i, &p);
      k++;
    }
  }
  return k;
}

#define STEP_EVERY 5
#define STEP_UNTIL (LOGO_T_FLY - 20)
void logo_show_init(LogoShow *s, const LogoCubes *cubes) {
  s->step_at = 0;
  s->flags = 0;
  rng_seed(&s->rng, 0x5732);
  s->cubes = cubes;
}
int logo_show_update(LogoShow *s, int32_t tick) {
  int ev = 0;
  const LogoCubes *c = s->cubes;
  if (c && tick < STEP_UNTIL && c->cursor < c->count && tick - s->step_at >= STEP_EVERY) {
    s->step_at = tick;
    ev |= LOGO_EV_STEP;
  }
  if (tick >= LOGO_T_FLY && !(s->flags & LOGO_EV_REVEAL)) ev |= LOGO_EV_REVEAL;
  if (tick >= LOGO_TOTAL - 25 && !(s->flags & LOGO_EV_DONE)) ev |= LOGO_EV_DONE;
  s->flags |= ev & (LOGO_EV_REVEAL | LOGO_EV_DONE);
  return ev;
}
int logo_step_pitch_q8(LogoShow *s) { return 410 + (int)rng_below(&s->rng, 256); }

/* ================================================================ intro */
void type_init(TypeProgress *t, int length, int cps) {
  t->acc = 0;
  t->length = length;
  t->per_tick = (cps * FQ8) / TICK_HZ;
}
int type_shown(const TypeProgress *t) { int n = t->acc >> 8; return n < t->length ? n : t->length; }
int type_done(const TypeProgress *t) { return type_shown(t) >= t->length; }
int type_step(TypeProgress *t, int ticks) {
  int before;
  if (type_done(t)) return 0;
  before = type_shown(t);
  t->acc += ticks * t->per_tick;
  return type_shown(t) - before;
}
void type_finish(TypeProgress *t) { t->acc = t->length << 8; }

void intro_init(IntroFlow *f, int slides) {
  f->index = 0;
  f->waited = 0;
  f->switch_t = -1;
  f->slides = slides;
  f->auto_ticks = INTRO_AUTO_TICKS;
  f->switch_ticks = INTRO_SWITCH_TICKS;
}
int intro_switching(const IntroFlow *f) { return f->switch_t >= 0; }
static int intro_advance(IntroFlow *f) {
  if (f->index + 1 >= f->slides) return INTRO_FINISH;
  f->switch_t = 0;
  return INTRO_FADE_OUT;
}
int intro_press(IntroFlow *f, int typing_done) {
  if (intro_switching(f)) return INTRO_NONE;
  if (!typing_done) return INTRO_SKIP_TEXT;
  return intro_advance(f);
}
int intro_skip(IntroFlow *f) { return intro_switching(f) ? INTRO_NONE : INTRO_FINISH; }
int intro_tick(IntroFlow *f, int typing_done) {
  if (intro_switching(f)) {
    if (++f->switch_t < f->switch_ticks) return INTRO_NONE;
    f->switch_t = -1;
    f->index++;
    f->waited = 0;
    return INTRO_SHOW;
  }
  if (!typing_done) return INTRO_NONE;
  if (++f->waited > f->auto_ticks) return intro_advance(f);
  return INTRO_NONE;
}

/* ================================================================ menu */
void menu_init(MenuModel *m, const MenuItem *items, int n) {
  int i;
  m->n = n;
  memcpy(m->items, items, sizeof(MenuItem) * (size_t)n);
  m->focus = -1;
  for (i = 0; i < n; i++) if (items[i].enabled) { m->focus = i; break; }
}
int menu_set_focus(MenuModel *m, int i) {
  if (i < 0 || i >= m->n || !m->items[i].enabled || i == m->focus) return 0;
  m->focus = i;
  return 1;
}
int menu_move(MenuModel *m, int dir) {
  int k, n = m->n;
  if (m->focus < 0) return 0;
  for (k = 1; k <= n; k++) {
    int i = (((m->focus + dir * k) % n) + n) % n;
    if (m->items[i].enabled) {
      if (i == m->focus) return 0;
      m->focus = i;
      return 1;
    }
  }
  return 0;
}
int menu_activate(const MenuModel *m) { return m->focus >= 0 && m->items[m->focus].enabled ? m->items[m->focus].id : -1; }
void title_menu(MenuModel *m, int has_save, int has_slots) {
  MenuItem it[MENU_MAX];
  int n = 0;
  it[n].id = MENU_NEW; it[n++].enabled = 1;
  if (has_save) { it[n].id = MENU_CONTINUE; it[n++].enabled = 1; }
  if (has_slots) { it[n].id = MENU_LOAD; it[n++].enabled = 1; }
  it[n].id = MENU_OPTIONS; it[n++].enabled = 1;
  it[n].id = MENU_INTRO; it[n++].enabled = 1;
  it[n].id = MENU_CREDITS; it[n++].enabled = 1;
  it[n].id = MENU_QUIT; it[n++].enabled = 1;
  menu_init(m, it, n);
  if (has_save) menu_set_focus(m, 1);
}

/* ================================================================ drobne animacje */
int32_t ang_q8(double rad) { return (int32_t)jsround(((rad * 256) / (2 * PI_D) / TICK_HZ) * FQ8); }
int ang_u8(double rad) { return (int)jsround((rad * 256) / (2 * PI_D)) & 255; }
int32_t sec_to_q8(double s) { return (int32_t)jsround(s * TICK_HZ * FQ8); }
int32_t progress_q12(int32_t tq8, int32_t t0q8, int32_t dur_q8) {
  int32_t v = ((tq8 - t0q8) * 16) / (dur_q8 >> 8);
  return v < 0 ? 0 : v > FQ12 ? FQ12 : v;
}

void approach_init(ApproachCurve *a, double rate, int step) {
  int i;
  a->step = step;
  for (i = 0; i <= 64; i++) a->lut[i] = (uint16_t)jsround((1 - exp((-rate * i * step) / TICK_HZ)) * FQ12);
}
int approach_at(const ApproachCurve *a, int32_t tq8) {
  int32_t span = a->step * FQ8, i, f;
  if (tq8 <= 0) return 0;
  i = tq8 / span;
  if (i >= 64) return a->lut[64];
  f = tq8 - i * span;
  return a->lut[i] + ((a->lut[i + 1] - a->lut[i]) * f) / span;
}

static int32_t W_FLAME[4], W_FLICK, W_SWAY[4], W_GLOW, W_MX, W_MY;
static int PH_FLAME[4], PH_ONE[4], fx_ready;
void fx_init(void) {
  int i;
  if (fx_ready) return;
  for (i = 0; i < 4; i++) {
    W_FLAME[i] = ang_q8(9 + 3 * i);
    W_SWAY[i] = ang_q8(6 + i);
    PH_FLAME[i] = ang_u8(i * 1.7);
    PH_ONE[i] = ang_u8(i);
  }
  W_FLICK = ang_q8(23);
  W_GLOW = ang_q8(11);
  W_MX = ang_q8(0.8);
  W_MY = ang_q8(1.1);
  fx_ready = 1;
}
int flame_k_q12(int32_t tq8, int i) {
  return 3072 + (wave_q14(tq8, W_FLAME[i], PH_FLAME[i]) >> 4) + ((wave_q14(tq8, W_FLICK, PH_ONE[i]) * 1966) >> 16);
}
int flame_sway_q8(int32_t tq8, int i) { return (wave_q14(tq8, W_SWAY[i], PH_ONE[i]) * 614) >> 16; }
int glow_alpha_q8(int32_t tq8) { return 33 + ((wave_q14(tq8, W_GLOW, 0) * 51) >> 16); }

void motes_init(MoteField *f, int n, double bx, double by, double bw, double bh, double vx, double vy, uint32_t seed, double alpha) {
  Rng r;
  int i;
  int32_t vxq, vyq, aq;
  fx_init();
  if (n > MOTES_MAX) n = MOTES_MAX;
  f->n = n;
  f->tick = 0;
  f->bx = (int32_t)(bx * FQ8);
  f->by = (int32_t)(by * FQ8);
  f->bw = bw * FQ8 > 1 ? (int32_t)(bw * FQ8) : 1;
  f->bh = bh * FQ8 > 1 ? (int32_t)(bh * FQ8) : 1;
  rng_seed(&r, seed);
  vxq = (int32_t)jsround((vx * FQ8) / TICK_HZ);
  vyq = (int32_t)jsround((vy * FQ8) / TICK_HZ);
  aq = (int32_t)jsround(alpha * FQ8);
  for (i = 0; i < n; i++) {
    int32_t a;
    f->x[i] = f->bx + (int32_t)rng_below(&r, (uint32_t)f->bw);
    f->y[i] = f->by + (int32_t)rng_below(&r, (uint32_t)f->bh);
    a = (aq * (102 + (int32_t)rng_below(&r, 154))) >> 8;
    f->alpha[i] = (uint8_t)(a > 255 ? 255 : a);
    f->vx[i] = (vxq * (128 + (int32_t)rng_below(&r, 256))) >> 8;
    f->vy[i] = (vyq * (128 + (int32_t)rng_below(&r, 256))) >> 8;
    f->ph[i] = (uint8_t)rng_below(&r, 256);
  }
}
void motes_step(MoteField *f) {
  int32_t tq8 = f->tick++ * FQ8;
  int ax = phase_at(tq8, W_MX), ay = phase_at(tq8, W_MY), i;
  for (i = 0; i < f->n; i++) {
    int32_t x = f->x[i] + f->vx[i] + ((isin_q14(ax + f->ph[i]) * 61) >> 16);
    int32_t y = f->y[i] + f->vy[i] + ((isin_q14(ay + f->ph[i] + 64) * 41) >> 16);
    if (x >= f->bx + f->bw) x -= f->bw;
    else if (x < f->bx) x += f->bw;
    if (y >= f->by + f->bh) y -= f->bh;
    else if (y < f->by) y += f->bh;
    f->x[i] = x;
    f->y[i] = y;
  }
}

int blink_alpha_q8(int32_t tick, int period, int down, int hold, int low) {
  int p = (int)(tick % period);
  if (p < down) return 256 - ((256 - low) * p) / down;
  if (p < down + hold) return low;
  if (p < down * 2 + hold) return low + ((256 - low) * (p - down - hold)) / down;
  return 256;
}

int next_pow2(int v) { int p = 1; while (p < v) p <<= 1; return p; }
int pot_tiles(int w, int h, int max, TexTile *out, int cap) {
  int x, y, n = 0;
  for (y = 0; y < h; y += max)
    for (x = 0; x < w; x += max) {
      int tw = w - x < max ? w - x : max, th = h - y < max ? h - y : max;
      if (n < cap) {
        out[n].x = x; out[n].y = y; out[n].w = tw; out[n].h = th;
        out[n].tex_w = next_pow2(tw); out[n].tex_h = next_pow2(th);
      }
      n++;
    }
  return n;
}
