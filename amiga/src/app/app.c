/* Maszyna ekranów i przejścia. */
#include "app.h"
#include "../gfx/r2d.h"
#include "game.h"

static const Screen *const SCREENS[10] = {&SCREEN_LOGO, &SCREEN_INTRO, &SCREEN_TITLE, &SCREEN_RECRUIT, &SCREEN_HUB, &SCREEN_TRAVEL, &SCREEN_MISSION, &SCREEN_DEBRIEF, &SCREEN_GAMEOVER, &SCREEN_VICTORY};
static ScreenId cur = SCR_LOGO, next_scr;
static int fade_ms, fade_total, fading_out, out_ms, in_ms, started;

void app_sfx(const char *name, int vol_q8, int pitch_q8) { (void)name; (void)vol_q8; (void)pitch_q8; }

static void start(ScreenId s, int ms_in) {
  cur = s;
  fading_out = 0;
  fade_ms = fade_total = ms_in;
  if (s != SCR_QUIT && SCREENS[s]->enter) SCREENS[s]->enter();
}

void app_init(void) {
  font_init();
  start(SCR_LOGO, 300);
  started = 1;
}

void app_goto(ScreenId s) {
  if (started && cur != SCR_QUIT && SCREENS[cur]->leave) SCREENS[cur]->leave();
  start(s, 0);
}
ScreenId app_screen(void) { return cur; }
int app_leaving(void) { return fading_out; }

void app_switch(ScreenId to, int ms_out, int ms_in) {
  if (fading_out) return;
  fading_out = 1;
  next_scr = to;
  out_ms = ms_out + 20;     /* goto(): delayedCall(ms + 20) */
  in_ms = ms_in;
  fade_ms = fade_total = ms_out;
}

int app_frame(unsigned held, unsigned pressed, int ms) {
  const Screen *s;
  int a = 0;
  if (cur == SCR_QUIT) return 0;
  g_entropy = g_entropy * 1664525u + 1013904223u + (uint32_t)ms * 2654435761u + held;   /* ziarno losowań */
  s = SCREENS[cur];
  if (fading_out) {
    held = pressed = 0;     /* scene.input.enabled = false */
    out_ms -= ms;
    fade_ms -= ms;
    if (out_ms <= 0) {
      if (s->leave) s->leave();
      if (next_scr == SCR_QUIT) {
        cur = SCR_QUIT;
        return 0;
      }
      start(next_scr, in_ms);
      s = SCREENS[cur];
    }
  } else if (fade_ms > 0) fade_ms -= ms;
  if (s->update) s->update(held, pressed, ms);
  r2d_frame_begin(0);
  if (s->draw) s->draw();
  /* wygaszenie / wejście z czerni (Phaser camera fade: liniowo) */
  if (fade_total > 0) {
    int f = fade_ms < 0 ? 0 : fade_ms;
    a = fading_out ? 255 - (255 * f) / fade_total : (255 * f) / fade_total;
    if (fading_out && fade_ms <= 0) a = 255;
  }
  if (a > 0) r2d_rect(0, 0, V_W, V_H, 0, a);
  r2d_frame_end();
  return 1;
}
