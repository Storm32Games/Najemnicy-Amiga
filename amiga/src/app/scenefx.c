/* Wspólne elementy scen. */
#include "scenefx.h"
#include "../gfx/r2d.h"

int sin_fine(int32_t a) {
  int i = (int)((a >> 4) & 255), f = (int)(a & 15);
  int s0 = isin_q14(i), s1 = isin_q14(i + 1);
  return s0 + (s1 - s0) * f / 16;
}

int int_sqrt(int32_t v) {
  int32_t r = 0, b = 1L << 30;
  if (v <= 0) return 0;
  while (b > v) b >>= 2;
  while (b) {
    if (v >= r + b) {
      v -= r + b;
      r = (r >> 1) + b;
    } else r >>= 1;
    b >>= 2;
  }
  return (int)r;
}

int32_t rdiv(int32_t a, int32_t b) {
  int32_t n = 2 * a + b, d = 2 * b;
  return n >= 0 ? n / d : -((-n + d - 1) / d);
}

int parallax_x(int margin, int32_t pan_q8, int k_milli) { return -margin - (int)rdiv(pan_q8 * k_milli, 256000); }

void drift_draw(const Img *im, int32_t tick, int32_t speed_milli, float y, int a) {
  int32_t span = (int32_t)im->w * 1000, v = (tick * speed_milli / TICK_HZ) % span;
  int x;
  if (v < 0) v += span;
  x = (int)((v + 500) / 1000);
  img_draw(im, (float)(x - im->w), y, a);
  img_draw(im, (float)x, y, a);
}

int32_t smooth_pan_q8(int32_t tq, int from, int to, int dur_s) {
  int32_t dur = (int32_t)dur_s * TICK_HZ * 256, u = tq >= dur ? FQ12 : (int32_t)((tq / 16) * FQ12 / (dur / 16));
  int32_t s = (u * u / FQ12) * (3 * FQ12 - 2 * u) / FQ12;   /* u^2 (3 - 2u), Q12 */
  return (int32_t)from * 256 + (int32_t)(to - from) * 256 * s / FQ12;
}

/* ------------------------------------------------------------------ tło */
void bg_init(BgState *s, const BgFx *def) {
  int i;
  s->def = def;
  for (i = 0; i < def->nbird && i < BG_MAX_BIRDS; i++) s->bird_x[i] = def->bird[i].x_q8 * TICK_HZ;
}

void bg_tick(BgState *s) {
  const BgFx *d = s->def;
  int i;
  const int32_t K = 256L * TICK_HZ;
  for (i = 0; i < d->nbird && i < BG_MAX_BIRDS; i++) {
    s->bird_x[i] += d->bird[i].v_q8 * d->bird_dir;
    if (d->bird_dir > 0 && s->bird_x[i] > (d->bird_x + d->bird_w + 20) * K) s->bird_x[i] = (d->bird_x - 20) * K;
    if (d->bird_dir < 0 && s->bird_x[i] < (d->bird_x - 20) * K) s->bird_x[i] = (d->bird_x + d->bird_w + 20) * K;
  }
}

void bg_rays(const BgFx *def, int32_t tq) {
  int i;
  const float ox = def->orb_x, oy = def->orb_y;
  if (!def->nray) return;
  r2d_blend_add(1);
  for (i = 0; i < def->nray; i++) {
    const BgRay *r = &def->ray[i];
    int32_t d = wave_q14(tq, W_RAY_SWAY, r->ph), s = wave_q14(tq, W_RAY_PULSE, r->ph);
    /* krycie: alpha * (0.55 + 0.45 sin) */
    int a = (int)((255L * def->ray_milli * (9011 + (45L * s) / 100)) / (1000L * 16384));
    float x1 = ox + (r->e[0] + ((int32_t)r->e[2] * d >> 14)) / 16.0f, y1 = oy + (r->e[1] + ((int32_t)r->e[3] * d >> 14)) / 16.0f;
    float x2 = ox + (r->e[4] + ((int32_t)r->e[6] * d >> 14)) / 16.0f, y2 = oy + (r->e[5] + ((int32_t)r->e[7] * d >> 14)) / 16.0f;
    r2d_tri(ox, oy, x1, y1, x2, y2, def->ray_col, a);
    r2d_tri(ox, oy, (ox + x1 * 2) / 3, (oy + y1 * 2) / 3, (ox + x2 * 2) / 3, (oy + y2 * 2) / 3, def->ray_col, a * 6 / 10);
  }
  r2d_blend_add(0);
}

void bg_windows(const BgFx *def, int32_t tq, int dx) {
  int i;
  for (i = 0; i < def->nwin; i++) {
    const BgWindow *w = &def->win[i];
    int32_t v = wave_q14(tq, w->w1, w->ph1) + wave_q14(tq, w->w2, w->ph2) / 2;   /* sin + 0.5 sin(3.1x) */
    int a = v > 3277 ? 255 : v > -6554 ? 140 : 0;
    r2d_rect((float)(w->x + dx), w->y, 1, 2, 0xffbe5a, a);
  }
}

void bg_birds(const BgState *st, int32_t tq) {
  const BgFx *d = st->def;
  int i;
  for (i = 0; i < d->nbird && i < BG_MAX_BIRDS; i++) {
    const BgBird *b = &d->bird[i];
    int s = b->s;
    float x = (float)rdiv(st->bird_x[i], 256L * TICK_HZ);
    float y = (float)(b->y + rdiv(3L * wave_q14(tq, W_BIRD, b->ph), 16384));
    int f = (int)(((tq * 7 / TICK_HZ + b->ph_q8) >> 8) % 3);   /* floor(t * 7 + ph) % 3 */
    const uint32_t c = d->bird_col;
    r2d_rect(x - s, y, 2 * s + 1, 1, c, 255);
    if (f == 0) {
      r2d_rect(x - 2 * s, y - 1, s, 1, c, 255);
      r2d_rect(x + s + 1, y - 1, s, 1, c, 255);
      r2d_rect(x - 3 * s, y - 2, s, 1, c, 255);
      r2d_rect(x + 2 * s + 1, y - 2, s, 1, c, 255);
    } else if (f == 1) {
      r2d_rect(x - 3 * s, y, s * 2, 1, c, 255);
      r2d_rect(x + s + 1, y, s * 2, 1, c, 255);
    } else {
      r2d_rect(x - 2 * s, y + 1, s, 1, c, 255);
      r2d_rect(x + s + 1, y + 1, s, 1, c, 255);
    }
  }
}

/* ------------------------------------------------------------------ ognisko, pył */
void fx_campfire(float x, float y, float k, int32_t tq) {
  static const uint32_t cols[FLAME_TONGUES] = {0xc43d1a, 0xff8a30, 0xffc860, 0xfff0a0};
  int i;
  r2d_ellipse(x, y - 2 * k, 23 * k, 11 * k, 0xff8a30, (41 * glow_alpha_q8(tq)) >> 8);
  r2d_rect(x - 4.5f * k, y - k, 9 * k, 2 * k, 0x3a2410, 255);
  for (i = 0; i < FLAME_TONGUES; i++) {
    float w = (7 - i * 1.6f) * k, h = (9 - i * 2) * k * flame_k_q12(tq, i) / FQ12;
    float cx = x + flame_sway_q8(tq, i) * k / FQ8;
    if (h < 1) h = 1;
    r2d_rect(cx - w / 2, y - 1 - h, w, h, cols[i], 255);
  }
}

void motes_draw(const MoteField *f, uint32_t rgb) {
  int i;
  for (i = 0; i < f->n; i++) r2d_rect((float)(f->x[i] >> 8), (float)(f->y[i] >> 8), 1, 1, rgb, f->alpha[i]);
}

/* ------------------------------------------------------------------ postacie */
void units_init(UnitAnim *a, const UnitSet *s) {
  int i;
  for (i = 0; i < s->n && i < UNITS_MAX; i++) {
    a->step[i] = (s->u[i].x < 0 ? -s->u[i].x : s->u[i].x) % 4;
    a->ms[i] = 0;
  }
}

void units_update(UnitAnim *a, const UnitSet *s, int ms) {
  int i;
  for (i = 0; i < s->n && i < UNITS_MAX; i++) {
    a->ms[i] += ms;
    while (a->ms[i] >= 100 + UNIT_IDLE[a->step[i]].ms) {
      a->ms[i] -= 100 + UNIT_IDLE[a->step[i]].ms;
      a->step[i] = (a->step[i] + 1) % UNIT_IDLE_STEPS;
    }
  }
}

void units_draw(const Img *sheet, const UnitSet *s, const UnitAnim *a, float k, uint32_t tint, int d0, int d1) {
  int i;
  for (i = 0; i < s->n && i < UNITS_MAX; i++) {
    const UnitPlace *u = &s->u[i];
    if (u->depth10 < d0 || u->depth10 > d1) continue;
    /* punkt zaczepienia: środek w poziomie, 7/8 wysokości (stopy) */
    img_draw_part(sheet, UNIT_IDLE[a->step[i]].frame * s->fw, u->row * s->fh, s->fw, s->fh,
                  u->x - s->fw * k / 2, u->y - s->fh * k * 0.875f, k, u->flip, tint, 255);
  }
}
