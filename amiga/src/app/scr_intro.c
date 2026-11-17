/* Intro (port src/scenes/IntroScene.ts): 6 plansz z tekstem z maszyny do pisania, przejścia przez czerń (core/frontend
 * IntroFlow), animacje plansz. Tła i warstwy wypieczone z gry (tools/amiga/bake_scenes.ts + pack_scenes.py); wybuch
 * atomowy (fx/NukeArt.ts liczy każdy piksel co klatkę) jako animacja intro_bomb.nta - klatki co 100 ms.
 * Klawisze: Enter / spacja / fire / w prawo = dalej, Esc = pomiń intro. */
#include <stdio.h>
#include <string.h>
#include "app.h"
#include "ui.h"
#include "scenefx.h"
#include "../gfx/r2d.h"
#include "../gfx/img.h"
#include "../core/frontend.h"
#include "../core/rng.h"
#include "../data/gamedata.h"
#include "../data/assets.h"

#define SEC (TICK_HZ * 256)   /* tq (ticki Q8) na sekundę */
#define NSLIDES 6
#define MAX_IMG 8
#define PI 3.14159265358979

/* kąt w 1/4096 obrotu; prędkość dla fine_phase (stała liczona raz) */
static int32_t a4096(double rad) { return (int32_t)(rad * 4096 / (2 * PI) + (rad < 0 ? -0.5 : 0.5)); }
static int32_t fine_w(double rad_s) { return (int32_t)(rad_s * 4096 / (2 * PI) / SEC * 65536 + 0.5); }
static int32_t fine_phase(int32_t tq, int32_t w) { return ((tq >> 2) * w) >> 14; }

static IntroFlow flow;
static TickClock clock, anim, tw_clock;
static TypeProgress tp;
static char wrapped[512];
static int slide, fade_dir, fade_ms, fade_total, boomed, loaded;
static Img img[MAX_IMG];
static Anim blast;
static int has_blast;
static MoteField mot[2];
static BgState bg;
static UnitAnim units;
static Rng shake_rng;

static void load(int i, const char *name) {
  if (!img_load(&img[i], name)) {
    fprintf(stderr, "Najemnicy: %s\n", img_error());
    loaded = 0;
  }
}

static void free_slide(void) {
  int i;
  for (i = 0; i < MAX_IMG; i++) img_free(&img[i]);
  if (has_blast) anim_free(&blast);
  has_blast = 0;
}

/* ================================================================== 1: bomba */
#define BOOM (SEC * 26 / 10)
#define FLIGHT (SEC * 22 / 10)
static const int16_t SPOT_XY[4][2] = {{96, 196}, {214, 198}, {352, 197}, {430, 196}};
static int32_t spot_a0[4], spot_w[4];
static int spot_ph[4];
static const int16_t BLINK_XY[5][2] = {{121, 113}, {236, 104}, {288, 98}, {417, 98}, {440, 106}};
typedef struct { int sx, sy, ex, ey; int32_t d; int ux, uy; } Missile;   /* ux, uy: kierunek Q14 */
static Missile mis[3];
static int32_t w_t1, w_t60;   /* sin(t), sin(t * 60) */

static void bomb_init(void) {
  static const double A0[4] = {-1.9, -1.45, -1.2, -1.7}, SP[4] = {0.9, 1.3, 0.7, 1.1};
  int i;
  load(0, "intro_bomb_pall");
  has_blast = anim_load(&blast, "intro_bomb");
  if (!has_blast) {
    fprintf(stderr, "Najemnicy: %s\n", img_error());
    loaded = 0;
  }
  for (i = 0; i < 4; i++) {
    spot_a0[i] = a4096(A0[i]);
    spot_w[i] = ang_q8(SP[i]);
    spot_ph[i] = ang_u8(SPOT_XY[i][0]);   /* sin(t * sp + x) */
  }
  for (i = 0; i < 3; i++) {
    Missile *m = &mis[i];
    double dx, dy, len;
    m->sx = 430 - i * 74;
    m->sy = -24 - i * 22;
    m->ex = 196 + i * 58;
    m->ey = 192;
    m->d = sec_to_q8(0.12 + i * 0.09);
    dx = m->ex - m->sx;
    dy = m->ey - m->sy;
    len = int_sqrt((int32_t)(dx * dx + dy * dy) * 256) / 16.0;   /* Math.hypot */
    m->ux = (int)(dx / len * 16384);
    m->uy = (int)(dy / len * 16384);
  }
  w_t1 = ang_q8(1);
  w_t60 = ang_q8(60);
  motes_init(&mot[0], 110, 0, 0, V_W, 200, 4, 10, 1, 0.5);
  rng_seed(&shake_rng, 1);
}

/* disc() z IntroScene: koło z poziomych pasków, r w Q12 */
static void disc(float x, float y, int32_t r_q12, uint32_t col, int a) {
  int R = (int)((r_q12 + 2048) >> 12), dy;
  int ix = (int)(x + (x < 0 ? -0.5f : 0.5f)), iy = (int)(y + (y < 0 ? -0.5f : 0.5f));
  if (R <= 0) {
    r2d_rect((float)ix, (float)iy, 1, 1, col, a);
    return;
  }
  for (dy = -R; dy <= R; dy++) {
    /* w = round(sqrt(R^2 - dy^2 + 0.6 R)) */
    int32_t v = ((int32_t)(R * R - dy * dy) * 256 + 154 * R) * 4;
    int w = (int_sqrt(v) + 16) >> 5;
    r2d_rect((float)(ix - w), (float)(iy + dy), (float)(w * 2 + 1), 1, col, a);
  }
}

static void bomb_tick(void) {
  int32_t k = clock_time_q8(&anim) - BOOM;
  if (k > 3 * SEC) motes_step(&mot[0]);
}

static void bomb_draw(int32_t tq, int ms) {
  int32_t k = tq - BOOM;
  int pre = tq < BOOM, i, m;
  (void)ms;
  /* wstrząs kamery 1.6 s po wybuchu (intensywność 0.005) */
  if (k > 0 && k < sec_to_q8(1.6)) r2d_offset((float)((int)rng_below(&shake_rng, 49) - 24) / 10, (float)((int)rng_below(&shake_rng, 27) - 13) / 10);
  if (has_blast) {
    int f = (int)((tq * 5 / 64 - blast.t0 + blast.ms / 2) / blast.ms);   /* tq * 5 / 64 = ms planszy */
    anim_seek(&blast, f);
    img_draw_scaled(&blast.img, 0, 0, V_W / 2, V_H / 2, 1.03f, 0xffffff, 255);
  }
  if (pre) {
    /* reflektory obrony przeciwlotniczej */
    r2d_blend_add(1);
    for (i = 0; i < 4; i++) {
      float x = SPOT_XY[i][0], y = SPOT_XY[i][1];
      int32_t a = spot_a0[i] + (wave_q14(tq, spot_w[i], spot_ph[i]) * 228 >> 14);
      const int32_t wd = 29, wd2 = 10, L = 240;
      r2d_tri(x, y, x + cos_fine(a - wd) * L / 16384.0f, y + sin_fine(a - wd) * L / 16384.0f, x + cos_fine(a + wd) * L / 16384.0f, y + sin_fine(a + wd) * L / 16384.0f, 0xd8e0ff, 18);
      r2d_tri(x, y, x + cos_fine(a - wd2) * L / 16384.0f, y + sin_fine(a - wd2) * L / 16384.0f, x + cos_fine(a + wd2) * L / 16384.0f, y + sin_fine(a + wd2) * L / 16384.0f, 0xd8e0ff, 15);
    }
    r2d_blend_add(0);
    /* światła masztów: floor(t * 1.4 + i * 0.37) % 2 == 0 */
    for (i = 0; i < 5; i++)
      if (((tq * 14 / 10 + i * 37 * SEC / 100) / SEC) % 2 == 0) r2d_rect(BLINK_XY[i][0], BLINK_XY[i][1], 1, 1, 0xff3020, 255);
  }
  /* całun dymu schodzi z góry 3 s po wybuchu */
  if (k > 3 * SEC) {
    int32_t v = k - 3 * SEC > 6 * SEC ? FQ12 : (k - 3 * SEC) / 16 * FQ12 / (6 * SEC / 16);
    drift_draw(&img[0], (k - 3 * SEC) / 256, -5000, -110.0f + 110.0f * v / FQ12, 230);
  }
  /* rakiety: smugi dymu, potem głowice z płomieniem (addytywnie) */
  for (m = 0; m < 3; m++) {
    const Missile *s = &mis[m];
    int32_t u = progress_q12(tq, s->d, FLIGHT);
    float dx = (float)(s->ex - s->sx), dy = (float)(s->ey - s->sy);
    if (u <= 0 || !pre) continue;
    {
      int n = (int)((u * 40) >> 12), j;
      for (j = n; j >= 0; j--) {
        /* age = u - j / 40 (Q12) */
        int32_t age = u - j * FQ12 / 40, al = 3072 - age * 9 / 10;   /* 0.75 - 0.9 age */
        float uu = j / 40.0f;
        int32_t sw = isin_q14(ang_u8(j * 1.7) + phase_at(tq, w_t1));
        float x = s->sx + dx * uu + sw * (float)age * 6 / (16384.0f * FQ12), y = s->sy + dy * uu;
        uint32_t col = age < 164 ? 0xffb060 : age < 410 ? 0xb09080 : 0x6a5a66;
        if (al <= 82) continue;
        disc(x, y, 2458 + age * 7, col, (int)(al * 255 / FQ12));
      }
    }
  }
  r2d_blend_add(1);
  for (m = 0; m < 3; m++) {
    const Missile *s = &mis[m];
    int32_t u = progress_q12(tq, s->d, FLIGHT), fl, kk;
    float hx, hy;
    if (u <= 0 || u >= FQ12 || !pre) continue;
    hx = (float)lerp_q12(s->sx * 256, s->ex * 256, u) / 256;
    hy = (float)lerp_q12(s->sy * 256, s->ey * 256, u) / 256;
    disc(hx - s->ux * 3 / 16384.0f, hy - s->uy * 3 / 16384.0f, 3 * FQ12, 0xff8a30, 128);
    fl = 3 * 16384 + wave_q14(tq, w_t60, ang_u8(s->sx)) * 12 / 10;   /* 3 + 1.2 sin(60t + sx), Q14 */
    for (kk = 1; kk * 16384 <= fl; kk++) {
      float px = hx - s->ux * kk / 16384.0f, py = hy - s->uy * kk / 16384.0f;
      r2d_rect((float)(int)(px + 0.5f), (float)(int)(py + 0.5f), 1, 1, 0xffd080, 230);
    }
    r2d_rect((float)(int)(hx + 0.5f), (float)(int)(hy + 0.5f), 2, 2, 0xffffff, 255);
  }
  r2d_blend_add(0);
  motes_draw(&mot[0], 0x9a8070);
  /* czysta biel przez 0.1 s, dalej błysk w klatkach wybuchu */
  if (k > 0 && k < sec_to_q8(0.1)) r2d_rect(0, 0, V_W, V_H, 0xffffff, 255);
  if (k > 0 && !boomed) {
    boomed = 1;
    app_sfx("explosion", 256, 256);
  }
}

/* ================================================================== 2: ruiny */
static int eye_ph[RUIN_EYES];
static int32_t w_sway, w_eye, w_blink;

static void ruins_init(void) {
  Rng r;
  int i;
  load(0, "intro_ruins");
  load(1, "intro_ruins_fog1");
  load(2, "intro_ruins_fog2");
  rng_seed(&r, 22);
  for (i = 0; i < RUIN_EYES; i++) eye_ph[i] = (int)rng_below(&r, 256);
  w_sway = ang_q8(0.25);
  w_eye = ang_q8(1.5);
  w_blink = ang_q8(7);
  motes_init(&mot[0], 140, 0, 0, V_W, V_H, 3, 9, 2, 0.6);
  bg_init(&bg, &BG_RUINS);
}

static void ruins_tick(void) {
  motes_step(&mot[0]);
  bg_tick(&bg);
}

static void ruins_draw(int32_t tq) {
  /* marsz w głąb ulicy: skala 1 + 0.012/s (do 14 s), kołysanie ±3 px; punkt zaczepienia (240, 128) */
  int32_t z = FQ12 + (tq < 14 * SEC ? tq : 14 * SEC) * 49 / SEC;
  float x = 240 + wave_q14(tq, w_sway, 0) * 3 / 16384.0f;
  int i;
  img_draw_scaled(&img[0], x - 240, 0, 240, 128, (float)z / FQ12, 0xffffff, 255);
  for (i = 0; i < RUIN_EYES; i++) {
    const EyePair *e = &RUIN_EYE[i];
    if (wave_q14(tq, w_eye, eye_ph[i]) > -11469 && wave_q14(tq, w_blink, eye_ph[i]) > -15565) {
      r2d_rect(e->xa, e->y, 1, 1, e->col, 255);
      r2d_rect(e->xb, e->y, 1, 1, e->col, 255);
    }
  }
  bg_birds(&bg, tq);
  drift_draw(&img[1], anim.tick, 4000, 150, 82);
  drift_draw(&img[2], anim.tick, -2500, 172, 56);
  motes_draw(&mot[0], 0xb0c0a0);
}

/* ================================================================== 3: szabrownicy */
static int32_t w_flick, w_flag, w_23;
static const char *const SKULL[7] = {"..#####..", ".#######.", ".#.###.#.", ".#######.", "..##.##..", "..#####..", "...#.#..."};

static void raiders_init(void) {
  load(0, "intro_raiders_sky");
  load(1, "intro_raiders_smoke");
  load(2, "intro_raiders_far");
  load(3, "intro_raiders_camp");
  load(4, "intro_raiders_glow");
  load(5, "intro_raiders_units");
  units_init(&units, &INTRO_RAIDERS_UNITS);
  motes_init(&mot[0], 46, 240 - 20, 100, 40, 80, 2, -26, 3, 0.95);
  motes_init(&mot[1], 40, 0, 0, V_W, 200, 6, 6, 11, 0.4);
  w_flick = ang_q8(11);
  w_flag = ang_q8(4);
  w_23 = ang_q8(23);
}

static void raiders_draw(int32_t tq) {
  const int FX = 240, FY = 184, M = 20;
  int32_t p = smooth_pan_q8(tq, -14, 14, 18);
  int flick = 210 + ((wave_q14(tq, w_flick, 0) * 46) >> 14), px, x, i;
  int32_t ga;
  float gs;
  uint32_t tint;
  img_draw(&img[0], (float)parallax_x(M, p, 100), 0, 255);
  drift_draw(&img[1], anim.tick, -3000, 0, 217);
  img_draw(&img[2], (float)parallax_x(M, p, 300), 0, 255);
  img_draw(&img[3], (float)parallax_x(M, p, 550), 0, 255);
  /* łuna ognia: alfa 0.55 + (flick - 210) / 120 + 0.06 sin(23t), skala 1 + (flick - 210) / 900 */
  ga = 141 + (flick - 210) * 255 / 120 + wave_q14(tq, w_23, 0) * 15 / 16384;
  gs = 1 + (flick - 210) / 900.0f;
  r2d_blend_add(1);
  img_draw_scaled(&img[4], FX - 100, FY - 10 - 50, 100, 50, gs, 0xffffff, ga < 0 ? 0 : ga);
  r2d_blend_add(0);
  /* maszt i flaga z czaszką */
  px = (int)rdiv(p * 55, 25600);
  r2d_rect((float)(150 - px), 98, 2, 86, 0x2a1810, 255);
  r2d_rect((float)(151 - px), 98, 1, 86, 0xc06a3a, 255);
  for (x = 0; x < 34; x++) {
    int w0 = wave_q14(tq, w_flag, (x * 57) >> 2), w1 = wave_q14(tq, w_flag, ((x + 1) * 57) >> 2);
    int dy = (int)rdiv(w0 * 22 * x, 16384L * 10 * 34), slope = w1 - w0, sx = x - 12;
    uint32_t col = slope > 600 ? 0x8a2018 : slope < -600 ? 0x3a0808 : 0x5e1210;
    float fx = (float)(152 + x - px);
    r2d_rect(fx, (float)(100 + dy), 1, 22, col, 255);
    r2d_rect(fx, (float)(121 + dy), 1, 1, 0x1a0404, 255);
    if (x > 26 && (x * 7) % 5 == 0) r2d_rect(fx, (float)(118 + dy - (x % 3)), 1, 4, 0, 255);
    if (sx >= 0 && sx < 9)
      for (i = 0; i < 7; i++)
        if (SKULL[i][sx] == '#') r2d_rect(fx, (float)(106 + i + dy), 1, 1, slope < -600 ? 0xa89c84 : 0xe8dcc0, 255);
  }
  /* cienie pod postaciami */
  for (i = 0; i < INTRO_RAIDERS_UNITS.n; i++) {
    const UnitPlace *u = &INTRO_RAIDERS_UNITS.u[i];
    r2d_ellipse(u->x + (u->x - FX) * 0.25f, u->y + 1.0f, 11 * (1 + (flick - 210) / 300.0f), 2, 0, 115);
  }
  tint = (uint32_t)((255 * flick) >> 8) << 16 | (uint32_t)((175 * flick) >> 8) << 8 | (uint32_t)((130 * flick) >> 8);
  /* głębie: postacie za ogniskiem (3), ognisko (3-4), postacie przed nim (5), iskry i popiół (6) */
  r2d_ellipse((float)FX, FY - 4.4f, 50.6f, 24.2f, 0xff8a30, (41 * glow_alpha_q8(tq)) >> 8);
  units_draw(&img[5], &INTRO_RAIDERS_UNITS, &units, 2, tint, 0, 40);
  {
    /* fx_campfire bez poświaty (narysowana wyżej, pod postaciami) */
    static const uint32_t cols[FLAME_TONGUES] = {0xc43d1a, 0xff8a30, 0xffc860, 0xfff0a0};
    const float k = 2.2f;
    r2d_rect(FX - 4.5f * k, FY - k, 9 * k, 2 * k, 0x3a2410, 255);
    for (i = 0; i < FLAME_TONGUES; i++) {
      float w = (7 - i * 1.6f) * k, h = (9 - i * 2) * k * flame_k_q12(tq, i) / FQ12, cx = FX + flame_sway_q8(tq, i) * k / FQ8;
      if (h < 1) h = 1;
      r2d_rect(cx - w / 2, FY - 1 - h, w, h, cols[i], 255);
    }
  }
  units_draw(&img[5], &INTRO_RAIDERS_UNITS, &units, 2, tint, 41, 255);
  motes_draw(&mot[0], 0xffb050);
  motes_draw(&mot[1], 0x8a6a60);
}

/* ================================================================== 4: nomadzi */
typedef struct { int16_t x, y, w, h; } R4;
static int32_t w_walk, w_camel;
static int ph_i[7], ph_ci[7];

static void nomads_init(void) {
  int i;
  load(0, "intro_nomads_sky");
  load(1, "intro_nomads_clouds");
  load(2, "intro_nomads_far");
  load(3, "intro_nomads_dunes");
  load(4, "intro_nomads_near");
  motes_init(&mot[0], 110, 0, 120, V_W, 110, 16, 1, 5, 0.5);
  motes_init(&mot[1], 40, 0, 150, V_W, 40, 4, -2, 9, 0.25);
  w_walk = fine_w(5.2);
  w_camel = fine_w(5.2 * 0.8);
  for (i = 0; i < 7; i++) {
    ph_i[i] = a4096(i * 1.3);
    ph_ci[i] = a4096(i * 1.3 * 0.8);
  }
}

static int round_q14(int32_t v, int k) { return (int)rdiv(v * k, 16384); }   /* Math.round(sin * k) */

static int person(R4 *r, int32_t ph, int kid) {
  int s = sin_fine(ph), l1 = round_q14(s, 2), n = 0;
  static const R4 base[7] = {{-2, -17, 4, 4}, {-3, -18, 6, 2}, {-3, -13, 6, 8}, {-4, -6, 8, 3}, {0, -3, 2, 3}, {0, -3, 2, 3}, {3, -16, 1, 16}};
  for (n = 0; n < 7; n++) r[n] = base[n];
  r[4].x = (int16_t)(-1 + l1);
  r[5].x = (int16_t)(-1 - l1);
  if (kid % 2 == 0) r[n++] = (R4){-6, -14, 3, 6};
  if (kid % 3 == 1) r[n++] = (R4){-4, -20, 2, 3};
  return n;
}

static int camel(R4 *r, int32_t ph, int loaded_) {
  static const R4 body[8] = {{-12, -22, 24, 10}, {-10, -24, 20, 3}, {-6, -28, 10, 5}, {12, -26, 4, 10}, {13, -32, 4, 7}, {15, -34, 8, 4}, {21, -32, 3, 2}, {-14, -20, 2, 7}};
  int s = sin_fine(ph), c = cos_fine(ph), n, i;
  const int lx[4] = {-10, -7, 7, 10}, la[4] = {s, -s, c, -c};
  for (n = 0; n < 8; n++) r[n] = body[n];
  for (i = 0; i < 4; i++) {
    r[n++] = (R4){(int16_t)(lx[i] + round_q14(la[i], 2)), -12, 2, 7};
    r[n++] = (R4){(int16_t)(lx[i] + round_q14(la[i], 3)), -5, 2, 5};
  }
  if (loaded_) {
    r[n++] = (R4){-9, -33, 14, 6};
    r[n++] = (R4){-11, -27, 3, 8};
    r[n++] = (R4){6, -27, 3, 8};
  } else r[n++] = (R4){-5, -31, 8, 3};
  return n;
}

static void shape_draw(const R4 *r, int n, int x, int y) {
  int i;
  /* cień spłaszczony w prawo (słońce nisko po lewej), obwódka światła, sylwetka */
  for (i = 0; i < n; i++)
    r2d_rect(x + r[i].x - r[i].y * 1.6f, (float)(y - 1 + rdiv(-r[i].y * 8, 100)), r[i].w + r[i].h * 1.6f, 1, 0x5a2a16, 89);
  for (i = 0; i < n; i++) r2d_rect((float)(x + r[i].x - 1), (float)(y + r[i].y - 1), r[i].w, r[i].h, 0xffc070, 255);
  for (i = 0; i < n; i++) r2d_rect((float)(x + r[i].x), (float)(y + r[i].y), r[i].w, r[i].h, 0x2a140e, 255);
}

static void nomads_draw(int32_t tq) {
  static const struct { char kind; int16_t off; } SLOTS[7] = {{'p', 0}, {'b', 30}, {'p', 60}, {'b', 96}, {'p', 126}, {'p', 146}, {'b', 176}};
  const int M = 30;
  int32_t p = smooth_pan_q8(tq, -20, 20, 20), lead_q8;
  int i;
  R4 r[16];
  img_draw(&img[0], (float)parallax_x(M, p, 50), 0, 255);
  drift_draw(&img[1], anim.tick, 1600, 0, 235);
  bg_rays(&BG_NOMADS, tq);
  img_draw(&img[2], (float)parallax_x(M, p, 150), 0, 255);
  img_draw(&img[3], (float)parallax_x(M, p, 350), 0, 255);
  motes_draw(&mot[1], 0xfff0c0);
  /* karawana: lead = 150 + 8t - 0.6 p */
  lead_q8 = 150 * 256 + tq * 8 / TICK_HZ - p * 6 / 10;
  for (i = 0; i < 7; i++) {
    int x = (int)rdiv(lead_q8 - SLOTS[i].off * 256, 256);
    int32_t ph = fine_phase(tq, w_walk) + ph_i[i];
    int s = sin_fine(ph), bob = round_q14(s < 0 ? -s : s, 1), n;
    if (SLOTS[i].kind == 'p') n = person(r, ph, i);
    else n = camel(r, fine_phase(tq, w_camel) + ph_ci[i], i != 6);
    shape_draw(r, n, x, 199 - bob);
  }
  motes_draw(&mot[0], 0xf8d090);
  img_draw(&img[4], (float)parallax_x(M, p, 1000), 0, 255);
}

/* ================================================================== 5: Przystań */
static int32_t w_beam, w_lamp;
static int ph_beam[2], ph_lamp[2];

static void haven_init(void) {
  int i;
  load(0, "intro_haven_sky");
  load(1, "intro_haven_clouds");
  load(2, "intro_haven_far");
  load(3, "intro_haven_fort");
  load(4, "intro_haven_units");
  units_init(&units, &INTRO_HAVEN_UNITS);
  motes_init(&mot[0], 46, 150, 70, 18, 50, 4, -10, 5, 0.45);
  motes_init(&mot[1], 30, 0, 150, V_W, 70, 3, -8, 8, 0.6);
  w_beam = ang_q8(0.35);
  w_lamp = ang_q8(3);
  for (i = 0; i < 2; i++) {
    ph_beam[i] = ang_u8(i * 2.1);
    ph_lamp[i] = ang_u8(i);
  }
}

static void haven_draw(int32_t tq) {
  static const int TOWER[2] = {78, 402};
  const int M = 20;
  int32_t p = smooth_pan_q8(tq, 10, -10, 18);
  int fx = (int)rdiv(-p * 5, 2560), i;
  img_draw(&img[0], (float)parallax_x(M, p, 80), 0, 255);
  drift_draw(&img[1], anim.tick, 2000, 0, 191);
  img_draw(&img[2], (float)parallax_x(M, p, 250), 0, 255);
  img_draw(&img[3], (float)parallax_x(M, p, 500), 0, 255);
  motes_draw(&mot[0], 0x8a8a98);
  /* reflektory z wież: a = -pi/2 +- 0.55 + 0.5 sin(0.35t + 2.1i) */
  r2d_blend_add(1);
  for (i = 0; i < 2; i++) {
    int32_t a = -1024 + (i ? 358 : -358) + ((wave_q14(tq, w_beam, ph_beam[i]) * 326) >> 14);
    const int32_t wd = 46, wd2 = 18, L = 300;
    float cx = (float)(TOWER[i] + fx), cy = 107;
    r2d_tri(cx, cy, cx + cos_fine(a - wd) * L / 16384.0f, cy + sin_fine(a - wd) * L / 16384.0f, cx + cos_fine(a + wd) * L / 16384.0f, cy + sin_fine(a + wd) * L / 16384.0f, 0xfff0c0, 23);
    r2d_tri(cx, cy, cx + cos_fine(a - wd2) * L / 16384.0f, cy + sin_fine(a - wd2) * L / 16384.0f, cx + cos_fine(a + wd2) * L / 16384.0f, cy + sin_fine(a + wd2) * L / 16384.0f, 0xfff0c0, 20);
  }
  for (i = 0; i < 2; i++) {
    /* lampa: alfa (0.2 + 0.05 sin(3t + i)) * 0.25 */
    int a = (int)((255L * (3277 + (wave_q14(tq, w_lamp, ph_lamp[i]) * 819 >> 14))) / (16384 * 4));
    r2d_ellipse((float)(TOWER[i] + fx), 107, 20, 13, 0xffe0a0, a);
  }
  r2d_blend_add(0);
  fx_campfire(150, 206, 1.2f, tq);
  fx_campfire(338, 208, 1.2f, tq);
  units_draw(&img[4], &INTRO_HAVEN_UNITS, &units, 1.5f, 0xd8c8b8, 0, 255);
  motes_draw(&mot[1], 0xffb060);
}

/* ================================================================== 6: drużyna */
static int32_t w_pan;

static void crew_init(void) {
  load(0, "intro_crew_sky");
  load(1, "intro_crew_clouds");
  load(2, "intro_crew_far");
  load(3, "intro_crew_mid");
  load(4, "intro_crew_ground");
  load(5, "intro_crew_units");
  units_init(&units, &INTRO_CREW_UNITS);
  bg_init(&bg, &BG_CREW);
  motes_init(&mot[0], 110, 0, 110, V_W, 110, 12, 1, 17, 0.55);
  w_pan = ang_q8(0.045);
}

static void crew_draw(int32_t tq) {
  const int M = 24;
  int32_t p = rdiv(10L * 256 * wave_q14(tq, w_pan, 0), 16384);
  int dx_mid = parallax_x(M, p, 600) + M, i;
  img_draw(&img[0], (float)parallax_x(M, p, 50), 0, 255);
  drift_draw(&img[1], anim.tick, 2200, 0, 242);
  bg_rays(&BG_CREW, tq);
  img_draw(&img[2], (float)parallax_x(M, p, 250), 0, 255);
  img_draw(&img[3], (float)(dx_mid - M), 0, 255);
  bg_windows(&BG_CREW, tq, dx_mid);
  bg_birds(&bg, tq);
  img_draw(&img[4], 0, 0, 255);
  for (i = 0; i < INTRO_CREW_UNITS.n; i++) {
    int x = INTRO_CREW_UNITS.u[i].x;
    r2d_ellipse(x + (x - 240) * 0.08f, 205, 22, 4, 0, 102);
  }
  units_draw(&img[5], &INTRO_CREW_UNITS, &units, 3, 0xffe0c8, 0, 255);
  motes_draw(&mot[0], 0xffc070);
}

/* ================================================================== plansze, tekst, przejścia */
static void show(int n) {
  free_slide();
  slide = n;
  loaded = 1;
  boomed = 0;
  clock_reset(&anim, 0);
  clock_reset(&tw_clock, 0);
  memset(mot, 0, sizeof mot);
  switch (n) {
    case 0: bomb_init(); break;
    case 1: ruins_init(); break;
    case 2: raiders_init(); break;
    case 3: nomads_init(); break;
    case 4: haven_init(); break;
    default: crew_init(); break;
  }
  font_wrap(INTRO_SLIDES[n], 0, 316, wrapped, sizeof wrapped);
  type_init(&tp, (int)strlen(wrapped), 34);
}

static void act(int a) {
  switch (a) {
    case INTRO_SKIP_TEXT:
      type_finish(&tp);
      return;
    case INTRO_FADE_OUT:
      fade_dir = 1;
      fade_ms = 0;
      fade_total = 450;
      return;
    case INTRO_SHOW:
      show(flow.index);
      fade_dir = -1;
      fade_ms = 0;
      fade_total = 650;
      return;
    case INTRO_FINISH:
      app_switch(SCR_TITLE, 400, 500);
      return;
  }
}

static void enter(void) {
  fx_init();
  intro_init(&flow, NSLIDES);
  clock_reset(&clock, 0);
  fade_dir = 0;
  show(0);
}

static void leave(void) { free_slide(); }

static void update(unsigned held, unsigned pressed, int ms) {
  int n;
  (void)held;
  if (!app_leaving()) {
    if (pressed & IN_BACK) act(intro_skip(&flow));
    else if (pressed & (IN_OK | IN_RIGHT)) act(intro_press(&flow, type_done(&tp)));
  }
  if (fade_dir) fade_ms += ms;
  if (fade_dir < 0 && fade_ms >= fade_total) fade_dir = 0;
  n = clock_advance(&anim, ms, 10);
  while (n-- > 0) {
    switch (slide) {
      case 0: bomb_tick(); break;
      case 1: ruins_tick(); break;
      case 5: bg_tick(&bg); /* fallthrough */
      default: motes_step(&mot[0]); motes_step(&mot[1]); break;
    }
  }
  if (slide == 2 || slide == 4 || slide == 5) units_update(&units, slide == 2 ? &INTRO_RAIDERS_UNITS : slide == 4 ? &INTRO_HAVEN_UNITS : &INTRO_CREW_UNITS, ms);
  if (!type_done(&tp)) type_step(&tp, clock_advance(&tw_clock, ms, 10));
  if (app_leaving()) return;
  for (n = clock_advance(&clock, ms, 10); n > 0 && !app_leaving(); n--) act(intro_tick(&flow, type_done(&tp)));
}

static void draw_text(void) {
  char buf[512];
  int shown = type_shown(&tp), i = 0;
  char *line = buf;
  if (shown > (int)sizeof buf - 1) shown = sizeof buf - 1;
  memcpy(buf, wrapped, (size_t)shown);
  buf[shown] = 0;
  while (line) {
    char *nl = strchr(line, '\n');
    if (nl) *nl = 0;
    font_draw(46, (float)(209 + i * (FONT_LINE_H + 2)), line, PAL_TEXT, 255, FONT_OUTLINE, 0, 1);
    i++;
    line = nl ? nl + 1 : NULL;
  }
}

static void draw(void) {
  int32_t tq = clock_time_q8(&anim);
  char dots[32];
  int i, k = 0;
  if (loaded) {
    switch (slide) {
      case 0: bomb_draw(tq, 0); break;
      case 1: ruins_draw(tq); break;
      case 2: raiders_draw(tq); break;
      case 3: nomads_draw(tq); break;
      case 4: haven_draw(tq); break;
      default: crew_draw(tq); break;
    }
  } else font_draw_at(V_W / 2, 100, 0.5f, 0.5f, "Brak plik\363w grafiki (katalog gfx/)", PAL_BAD, 255, FONT_OUTLINE, 0, 1);
  /* panel z tekstem, przyciski, kropki postępu */
  r2d_rect(40, 206, 404, 54, 0, 128);
  r2d_rect(38, 204, 404, 54, PAL_PANEL, 255);
  r2d_frame(38, 204, 404, 54, PAL_EDGE, 255);
  draw_text();
  ui_button(376, 222, 58, 16, "DALEJ \215", BTN_PRIMARY, 0, 1);
  for (i = 0; i < NSLIDES; i++) {
    if (i) {
      dots[k++] = ' ';
      dots[k++] = ' ';
    }
    dots[k++] = (char)(i == slide ? 0x8a : 0x8b);   /* ◆ / ◇ */
  }
  dots[k] = 0;
  font_draw_at(V_W / 2, 264, 0.5f, 0.5f, dots, PAL_DIM, 255, FONT_OUTLINE, 0, 1);
  ui_button(V_W - 84, 6, 78, 14, "POMI\321 INTRO \215\215", BTN_PLAIN, 0, 1);
  r2d_offset(0, 0);
  if (fade_dir) {
    int f = fade_ms > fade_total ? fade_total : fade_ms;
    int a = fade_dir > 0 ? 255 * f / fade_total : 255 - 255 * f / fade_total;
    r2d_rect(0, 0, V_W, V_H, 0, a);
  }
}

const Screen SCREEN_INTRO = {enter, update, draw, leave};
