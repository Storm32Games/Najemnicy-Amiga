/* Tymczasowe ekrany intro i menu (zastępowane kolejno przez scr_intro.c i scr_title.c). */
#include "app.h"
#include "../gfx/r2d.h"

static void intro_update(unsigned held, unsigned pressed, int ms) {
  (void)held; (void)ms;
  if (pressed) app_switch(SCR_TITLE, 400, 500);
}
static void intro_draw(void) { font_draw_at(V_W / 2, V_H / 2, 0.5f, 0.5f, "INTRO", 0xd8c9a0, 255, FONT_OUTLINE, 1, 2); }
static void title_update(unsigned held, unsigned pressed, int ms) {
  (void)held; (void)ms;
  if (pressed & IN_BACK) app_switch(SCR_QUIT, 300, 0);
}
static void title_draw(void) { font_draw_at(V_W / 2, V_H / 2, 0.5f, 0.5f, "PY\243 I RDZA", 0xf2a93b, 255, FONT_OUTLINE, 1, 3); }

const Screen SCREEN_INTRO = {0, intro_update, intro_draw, 0};
const Screen SCREEN_TITLE = {0, title_update, title_draw, 0};
