/* Ekran tytułowy (port src/scenes/TitleScene.ts + tło fx/Backdrops.ts 'title'): pustkowie o zmierzchu z paralaksą,
 * chmurami, promieniami, migającymi oknami, ptakami, ogniskiem, dwójką rekrutów i pyłem; logo, podtytuł i menu
 * (core/frontend menu: fokus góra/dół, ogień). Warstwy wypieczone z gry: tools/amiga/bake_scenes.ts + pack_scenes.py. */
#include <stdio.h>
#include <string.h>
#include "app.h"
#include "ui.h"
#include "../gfx/r2d.h"
#include "../gfx/img.h"
#include "../core/frontend.h"
#include "../data/gamedata.h"
#include "../data/scenes.h"
#include "scenefx.h"

#ifndef NAJ_VERSION
#define NAJ_VERSION "?"
#endif

#define M 24              /* zapas warstw paralaksy */

enum { L_SKY, L_CLOUDS, L_FAR, L_MID, L_GROUND, L_LOGO, L_SUB, L_UNITS, L_N };
static const char *const LAYER[L_N] = {"title_sky", "title_clouds", "title_far", "title_mid", "title_ground", "title_logo", "title_sub", "title_units"};

/* etykiety pozycji menu (core/frontend/menu.ts), wielkimi literami jak button() */
static const char *const MENU_LABEL[] = {
  "\215 NOWA GRA", "KONTYNUUJ", "WCZYTAJ GR\312", "OPCJE", "INTRO", "AUTORZY", "WYJD\254 Z GRY",
};

static Img img[L_N];
static int loaded;
static TickClock clock;
static MenuModel menu;
static MoteField dust;
static BgState bg;
static UnitAnim units;
static const UnitPlace TITLE_U[2] = {{0, 178, 232, 1, 50}, {1, 208, 235, 1, 50}};   /* sowa, hak */
static const UnitSet TITLE_UNITS = {32, 36, 2, TITLE_U};
static int w_pan, w_logo;
static int credits, quit_dlg, quit_focus, quitting;
static int btn_y[MENU_MAX];

static void enter(void) {
  int i, y;
  for (i = 0; i < L_N; i++) {
    if (!img_load(&img[i], LAYER[i])) {
      fprintf(stderr, "Najemnicy: %s\n", img_error());
      break;
    }
  }
  loaded = i == L_N;
  clock_reset(&clock, 0);
  fx_init();
  w_pan = ang_q8(0.045);
  w_logo = ang_q8(3.14159265358979 / 2);
  motes_init(&dust, 150, 0, 90, V_W, 150, 18, 1, 8, 0.5);
  bg_init(&bg, &BG_TITLE);
  units_init(&units, &TITLE_UNITS);
  title_menu(&menu, 0, 0);    /* zapisy na Amidze: jeszcze nie */
  y = 158;
  if (V_H - 8 - 15 - 24 - 19 * (menu.n - 2) < y) y = V_H - 8 - 15 - 24 - 19 * (menu.n - 2);
  for (i = 0; i < menu.n; i++) {
    btn_y[i] = y;
    y += menu.items[i].id == MENU_NEW ? 24 : 19;
  }
  credits = quit_dlg = quitting = 0;
}

static void leave(void) {
  int i;
  for (i = 0; i < L_N; i++) img_free(&img[i]);
  loaded = 0;
}

/* ------------------------------------------------------------------ okna */
#define CR_W 280
#define CR_H (34 + (CREDITS_COUNT + 1) * 14)
#define DLG_W 260
static const char *const QUIT_BODY = "Na pewno chcesz opu\266ci\346 pustkowie? Niezapisany post\352p przepadnie (autozapis zostaje).";

static void run(int id) {
  switch (id) {
    case MENU_NEW:
      ui_toast("Werbunek dru\277yny nie jest jeszcze przeniesiony na Amig\352.", PAL_AMBER);
      return;
    case MENU_OPTIONS:
      ui_toast("Opcje nie s\261 jeszcze przeniesione na Amig\352.", PAL_AMBER);
      return;
    case MENU_INTRO:
      app_sfx("click", 256, 256);
      app_switch(SCR_INTRO, 400, 700);
      return;
    case MENU_CREDITS:
      credits = 1;
      return;
    case MENU_QUIT:
      quit_dlg = 1;
      quit_focus = 0;
      return;
  }
}

static void update(unsigned held, unsigned pressed, int ms) {
  int n;
  (void)held;
  n = clock_advance(&clock, ms, 10);
  while (n-- > 0) {
    motes_step(&dust);
    bg_tick(&bg);
  }
  units_update(&units, &TITLE_UNITS, ms);
  ui_toast_update(ms);
  if (app_leaving() || quitting) return;
  if (quit_dlg) {
    if (pressed & (IN_LEFT | IN_UP)) quit_focus = 0;
    if (pressed & (IN_RIGHT | IN_DOWN)) quit_focus = 1;
    if (pressed & IN_BACK) quit_dlg = 0;
    else if (pressed & IN_OK) {
      quit_dlg = 0;
      if (quit_focus) {
        quitting = 1;
        app_switch(SCR_QUIT, 600, 0);
      }
    }
    return;
  }
  if (credits) {
    if (pressed & (IN_OK | IN_BACK)) credits = 0;
    return;
  }
  if (pressed & IN_UP) {
    if (menu_move(&menu, -1)) app_sfx("hover", 256, 256);
  } else if (pressed & IN_DOWN) {
    if (menu_move(&menu, 1)) app_sfx("hover", 256, 256);
  } else if (pressed & IN_OK) {
    int id = menu_activate(&menu);
    if (id >= 0) {
      app_sfx("click", 256, 256);
      run(id);
    }
  } else if (pressed & IN_BACK) run(MENU_QUIT);   /* Amiga: Esc = wyjście (z potwierdzeniem) */
}

/* ------------------------------------------------------------------ rysowanie */
static void draw_credits(void) {
  int x = (V_W - CR_W) / 2, y = (V_H - CR_H) / 2, i;
  char line[64];
  r2d_rect(x + 2, y + 2, CR_W, CR_H, 0, 128);
  r2d_rect(x, y, CR_W, CR_H, PAL_PANEL, 255);
  r2d_frame(x, y, CR_W, CR_H, PAL_EDGE_HI, 255);
  font_draw(x + 10, y + 8, "AUTORZY", PAL_AMBER, 255, FONT_OUTLINE, 0, 1);
  for (i = 0; i <= CREDITS_COUNT; i++) {
    int kw;
    const char *val = i < CREDITS_COUNT ? CREDITS[i][1] : "v" NAJ_VERSION;
    snprintf(line, sizeof line, "%s: ", i < CREDITS_COUNT ? CREDITS[i][0] : "Wersja");
    kw = font_measure(line, 0) + 1;
    font_draw(x + 10, y + 26 + i * 14, line, PAL_AMBER, 255, FONT_OUTLINE, 0, 1);
    ui_text(x + 10 + kw, y + 26 + i * 14, val, PAL_TEXT, CR_W - 20 - kw, 0, 0);
  }
  ui_button(x + CR_W - 62, y + CR_H - 20, 54, 15, "ZAMKNIJ", BTN_PLAIN, 1, 1);
}

static void draw_quit(void) {
  int bh = ui_text_h(QUIT_BODY, DLG_W - 20, 2), h = bh + 54, x = (V_W - DLG_W) / 2, y = (V_H - h) / 2;
  int w_go = ui_button_w("WYJD\254"), w_stay = ui_button_w("ZOSTAJ\312");
  r2d_rect(0, 0, V_W, V_H, 0, 168);
  ui_panel(x, y, DLG_W, h, PAL_EDGE_HI);
  font_draw(x + 8, y + 6, "WYJ\246CIE Z GRY", PAL_AMBER, 255, FONT_OUTLINE, 0, 1);
  ui_text(x + 10, y + 22, QUIT_BODY, PAL_TEXT, DLG_W - 20, 2, 0);
  ui_button(x + DLG_W - 8 - w_go, y + h - 22, w_go, 15, "WYJD\254", BTN_DANGER, quit_focus == 1, 1);
  ui_button(x + DLG_W - 8 - w_go - 6 - w_stay, y + h - 22, w_stay, 15, "ZOSTAJ\312", BTN_PLAIN, quit_focus == 0, 1);
}

static void draw(void) {
  int32_t tq = clock_time_q8(&clock), pan;
  int i, dx_mid;
  if (!loaded) {
    font_draw_at(V_W / 2, V_H / 2, 0.5f, 0.5f, "Brak plik\363w grafiki (katalog gfx/)", PAL_BAD, 255, FONT_OUTLINE, 0, 1);
    return;
  }
  /* backdrop(): p = sin(t * 0.045) * 14; warstwy: niebo 0.05, chmury 2.2 px/s, promienie, daleko 0.25, bliżej 0.6 */
  pan = rdiv(14L * 256 * wave_q14(tq, w_pan, 0), 16384);
  img_draw(&img[L_SKY], (float)parallax_x(M, pan, 50), 0, 255);
  drift_draw(&img[L_CLOUDS], clock.tick, 2200, 0, 242);
  bg_rays(&BG_TITLE, tq);
  img_draw(&img[L_FAR], (float)parallax_x(M, pan, 250), 0, 255);
  dx_mid = parallax_x(M, pan, 600) + M;
  img_draw(&img[L_MID], (float)(dx_mid - M), 0, 255);
  bg_windows(&BG_TITLE, tq, dx_mid);
  bg_birds(&bg, tq);
  img_draw(&img[L_GROUND], 0, 0, 255);
  fx_campfire(150, 230, 1.6f, tq);
  units_draw(&img[L_UNITS], &TITLE_UNITS, &units, 2, 0xffffff, 0, 255);
  motes_draw(&dust, 0xf0c080);
  /* logo: 50 -> 47 -> 50 px w 4 s; podtytuł przygasa co ~4.8 s */
  img_draw(&img[L_LOGO], V_W / 2 - img[L_LOGO].w / 2, 50 - (3 * (16384 - icos_q14(phase_at(tq, w_logo)))) / 32768.0f - img[L_LOGO].h / 2, 255);
  img_draw(&img[L_SUB], V_W / 2 - img[L_SUB].w / 2, 86 - img[L_SUB].h / 2, blink_alpha_q8(tq >> 8, 242, 5, 3, 115) * 255 / 256);
  for (i = 0; i < menu.n; i++) {
    int first = menu.items[i].id == MENU_NEW;
    ui_button(V_W - 128, btn_y[i], 100, first ? 18 : 15, MENU_LABEL[menu.items[i].id], first ? BTN_PRIMARY : BTN_PLAIN, i == menu.focus && !credits && !quit_dlg, menu.items[i].enabled);
  }
  font_draw_at(6, V_H - 6, 0, 1, "Pathfinder 2e w \266wiecie po zag\263adzie", PAL_DIM, 255, FONT_OUTLINE, 0, 1);
  if (credits) draw_credits();
  if (quit_dlg) draw_quit();
  ui_toast_draw();
}

const Screen SCREEN_TITLE = {enter, update, draw, leave};
