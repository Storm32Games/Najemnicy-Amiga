/* Logika ekranów startowych (logo, intro, menu): liczby całkowite, ticki 50 Hz. Port src/core/frontend (TS). */
#ifndef FRONTEND_H
#define FRONTEND_H

#include <stdint.h>
#include "rng.h"
#include "../data/gamedata.h"

#define TICK_HZ 50
#define FQ12 4096
#define FQ8 256

static inline int32_t idiv32(int32_t a, int32_t b) { return a / b; }  /* jak (a / b) | 0 w JS */
static inline int isin_q14(int a) { return SIN_LUT[a & 255]; }
static inline int icos_q14(int a) { return SIN_LUT[(a + 64) & 255]; }
int ease_out3(int kq12);

/* ---------------------------------------------------------------- zegar o stałym kroku (TickClock) */
typedef struct { int32_t tick; int32_t acc_us; } TickClock;
void clock_reset(TickClock *c, int32_t tick);
int clock_advance(TickClock *c, int32_t ms, int max_ticks); /* ms całkowite (na Amidze z timer.device) */
int clock_alpha_q8(const TickClock *c);
int32_t clock_time_q8(const TickClock *c);

/* ---------------------------------------------------------------- logo STORM 32 (logo.ts) */
#define LOGO_GW 160
#define LOGO_GH 90
#define LOGO_TEX_W 256
#define LOGO_TEX_H 128
#define LOGO_T_FLY 160      /* 3.2 s */
#define LOGO_T_FADE 35      /* 0.7 s */
#define LOGO_T_HOLD 130     /* 2.6 s */
#define LOGO_TOTAL (LOGO_T_FLY + LOGO_T_FADE + LOGO_T_HOLD)
#define LOGO_BG 0x060a14UL
#define LOGO_DUR_MIN 38     /* secToTicks(0.75) = round(37.5) */
#define LOGO_DUR_SPAN 25
#define LOGO_MAX_DUR (LOGO_DUR_MIN + LOGO_DUR_SPAN)
#define LOGO_MAX_CUBES (LOGO_GW * LOGO_GH)
enum { LOGO_EV_STEP = 1, LOGO_EV_REVEAL = 2, LOGO_EV_DONE = 4 };

typedef struct { int32_t x, y, s; } CubePose; /* Q12 jednostek kostki */
typedef struct {
  int count, cursor;
  int16_t x[LOGO_MAX_CUBES], y[LOGO_MAX_CUBES], sx[LOGO_MAX_CUBES], sy[LOGO_MAX_CUBES];
  uint16_t delay[LOGO_MAX_CUBES], dur[LOGO_MAX_CUBES], land[LOGO_MAX_CUBES];
  uint32_t col[LOGO_MAX_CUBES], hi[LOGO_MAX_CUBES], lo[LOGO_MAX_CUBES];
} LogoCubes;
/* rgb: piksele siatki 160x90, `stride` bajtów na piksel (3 = RGB, 4 = RGBA) */
void logo_cubes_init(LogoCubes *c, const uint8_t *rgb, int stride, uint32_t seed);
typedef void (*CubeFn)(void *ctx, int i, const CubePose *p);
int logo_drain_landed(LogoCubes *c, int32_t tq8, void (*fn)(void *ctx, int i), void *ctx);
int logo_pose(const LogoCubes *c, int i, int32_t tq8, CubePose *out);
int logo_for_each_flying(const LogoCubes *c, int32_t tq8, CubeFn fn, void *ctx);

typedef struct { int32_t step_at; int flags; Rng rng; const LogoCubes *cubes; } LogoShow;
void logo_show_init(LogoShow *s, const LogoCubes *cubes);
int logo_show_update(LogoShow *s, int32_t tick);
int logo_step_pitch_q8(LogoShow *s);

/* ---------------------------------------------------------------- intro (flow.ts) */
typedef struct { int32_t acc, per_tick, length; } TypeProgress;
void type_init(TypeProgress *t, int length, int cps);
int type_shown(const TypeProgress *t);
int type_done(const TypeProgress *t);
int type_step(TypeProgress *t, int ticks);
void type_finish(TypeProgress *t);

enum { INTRO_NONE, INTRO_SKIP_TEXT, INTRO_FADE_OUT, INTRO_SHOW, INTRO_FINISH };
#define INTRO_AUTO_TICKS 225   /* round(4.5 * 50) */
#define INTRO_SWITCH_TICKS 24  /* round(0.48 * 50) */
typedef struct { int index, waited, switch_t, slides, auto_ticks, switch_ticks; } IntroFlow;
void intro_init(IntroFlow *f, int slides);
int intro_switching(const IntroFlow *f);
int intro_press(IntroFlow *f, int typing_done);
int intro_skip(IntroFlow *f);
int intro_tick(IntroFlow *f, int typing_done);

/* ---------------------------------------------------------------- menu (menu.ts) */
enum { MENU_NEW, MENU_CONTINUE, MENU_LOAD, MENU_OPTIONS, MENU_INTRO, MENU_CREDITS, MENU_QUIT };
#define MENU_MAX 8
typedef struct { uint8_t id, enabled; } MenuItem;
typedef struct { MenuItem items[MENU_MAX]; int n, focus; } MenuModel;
void menu_init(MenuModel *m, const MenuItem *items, int n);
int menu_set_focus(MenuModel *m, int i);
int menu_move(MenuModel *m, int dir);
int menu_activate(const MenuModel *m); /* id albo -1 */
void title_menu(MenuModel *m, int has_save, int has_slots);

/* ---------------------------------------------------------------- drobne animacje (fx.ts) */
int32_t ang_q8(double rad_per_sec);          /* stała przy starcie (w TS: Math.round) */
int ang_u8(double rad);
static inline int phase_at(int32_t tq8, int32_t w) { return (int)(((uint32_t)tq8 * (uint32_t)w) >> 16) & 255; }
static inline int wave_q14(int32_t tq8, int32_t w, int ph) { return isin_q14(phase_at(tq8, w) + ph); }
static inline int32_t lerp_q12(int32_t a, int32_t b, int32_t k) { return a + (b - a) * k / FQ12; }
int32_t progress_q12(int32_t tq8, int32_t t0q8, int32_t dur_q8);
int32_t sec_to_q8(double s);

typedef struct { uint16_t lut[65]; int step; } ApproachCurve;
void approach_init(ApproachCurve *a, double rate_per_sec, int step);
int approach_at(const ApproachCurve *a, int32_t tq8);

#define FLAME_TONGUES 4
void fx_init(void);                           /* liczy stałe kątowe (raz) */
int flame_k_q12(int32_t tq8, int i);
int flame_sway_q8(int32_t tq8, int i);
int glow_alpha_q8(int32_t tq8);

#define MOTES_MAX 96
typedef struct {
  int n;
  int32_t x[MOTES_MAX], y[MOTES_MAX], vx[MOTES_MAX], vy[MOTES_MAX];
  uint8_t alpha[MOTES_MAX], ph[MOTES_MAX];
  int32_t bx, by, bw, bh, tick;
} MoteField;
void motes_init(MoteField *f, int n, double bx, double by, double bw, double bh, double vx, double vy, uint32_t seed, double alpha);
void motes_step(MoteField *f);

int blink_alpha_q8(int32_t tick, int period, int down, int hold, int low_q8);

typedef struct { int x, y, w, h, tex_w, tex_h; } TexTile;
int next_pow2(int v);
int pot_tiles(int w, int h, int max, TexTile *out, int cap);

#endif
