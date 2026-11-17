/* Logo studia STORM 32 - port src/scenes/LogoScene.ts (profil Amiga: bez przenikania do pełnego JPG-a).
 * Wylądowane kostki trafiają raz do tekstury 256x128 (glTexSubImage2D tylko gdy coś doszło),
 * co klatkę rysowane są tylko kostki w locie: cień, ściana, jasna krawędź górna i lewa. */
#include <string.h>
#include "app.h"
#include "../gfx/r2d.h"
#include "../core/frontend.h"
#include "../data/assets.h"

#define P 3.0f /* piksele projektowe na kostkę: 160 * 3 = 480 */
static LogoCubes cubes;
static LogoShow show;
static TickClock clk;
static RTex landed_tex;
static uint8_t landed_px[LOGO_GW * LOGO_GH * 4];
static int finished, dirty;
static int32_t tq8_now;

static void stamp(void *ctx, int i) {
  uint8_t *p = &landed_px[(cubes.y[i] * LOGO_GW + cubes.x[i]) * 4];
  uint32_t c = cubes.col[i];
  (void)ctx;
  p[0] = (uint8_t)(c >> 16);
  p[1] = (uint8_t)(c >> 8);
  p[2] = (uint8_t)c;
  p[3] = 255;
  dirty = 1;
}

static void enter(void) {
  int i;
  clock_reset(&clk, 0);
  finished = 0;
  dirty = 0;
  for (i = 0; i < LOGO_GW * LOGO_GH; i++) {
    landed_px[i * 4] = (uint8_t)(LOGO_BG >> 16);
    landed_px[i * 4 + 1] = (uint8_t)(LOGO_BG >> 8);
    landed_px[i * 4 + 2] = (uint8_t)LOGO_BG;
    landed_px[i * 4 + 3] = 255;
  }
  r2d_tex_create(&landed_tex, LOGO_TEX_W, LOGO_TEX_H, NULL);
  r2d_tex_update(&landed_tex, 0, 0, LOGO_GW, LOGO_GH, landed_px);
  logo_cubes_init(&cubes, LOGO_SAMPLE_RGB, 3, 32);
  logo_show_init(&show, &cubes);
  app_sfx("logo", 256, 256);
}

static void leave(void) { r2d_tex_free(&landed_tex); }

static void skip(void) {
  if (finished) return;
  finished = 1;
  app_sfx("click", 256, 256);
  app_switch(SCR_INTRO, 250, 500);
}

static void update(unsigned held, unsigned pressed, int ms) {
  int ev;
  (void)held;
  if (pressed) skip();
  clock_advance(&clk, ms, 5);
  tq8_now = clock_time_q8(&clk);
  logo_drain_landed(&cubes, tq8_now, stamp, NULL);
  if (dirty) {
    r2d_tex_update(&landed_tex, 0, 0, LOGO_GW, LOGO_GH, landed_px);
    dirty = 0;
  }
  ev = logo_show_update(&show, tq8_now >> 8);
  if (ev & LOGO_EV_STEP) app_sfx("step", 31, logo_step_pitch_q8(&show));
  if (ev & LOGO_EV_REVEAL) app_sfx("hit", 128, 179);
  if ((ev & LOGO_EV_DONE) && !finished) {
    finished = 1;
    app_switch(SCR_INTRO, 450, 500);
  }
}

static void draw_cube(void *ctx, int i, const CubePose *p) {
  const float k = P / FQ12;
  float x = p->x * k, y = p->y * k, s = p->s * k;
  (void)ctx;
  r2d_rect(x + 0.5f, y + 0.5f, s, s, cubes.lo[i], 255);
  r2d_rect(x, y, s, s, cubes.col[i], 255);
  r2d_rect(x, y, s, 0.5f, cubes.hi[i], 255);
  r2d_rect(x, y, 0.5f, s, cubes.hi[i], 255);
}

static void draw(void) {
  r2d_rect(0, 0, V_W, V_H, LOGO_BG, 255);
  r2d_image(&landed_tex, 0, 0, LOGO_GW * P, LOGO_GH * P, 0, 0, LOGO_GW, LOGO_GH, 0xFFFFFF, 255);
  logo_for_each_flying(&cubes, tq8_now, draw_cube, NULL);
  font_draw_at(V_W - 6, V_H - 6, 1, 1, "kliknij, aby pomin\261\346", 0x556666, 255, FONT_OUTLINE, 0, 1);
}

const Screen SCREEN_LOGO = {enter, update, draw, leave};
