/* Ekrany końcowe (port src/scenes/EndScenes.ts): KONIEC DROGI po wybiciu drużyny i ZWYCIĘSTWO (epilog, napisy).
 * Tła 'over' (krwawa łuna, krzyże) i 'win' (świt) wypieczone z gry. Upadek poległych: klatki f_hurt -> f_die
 * z bibliotek postaci zamiast obrotu sprite'a. Plik w UTF-8, napisy przekodowuje tools/amiga/latin2_literals.py. */
#include <stdio.h>
#include <string.h>
#include <stdlib.h>
#include "app.h"
#include "ui.h"
#include "game.h"
#include "scenefx.h"
#include "../gfx/r2d.h"
#include "../gfx/img.h"
#include "../core/frontend.h"
#include "../data/gamedata.h"
#include "../data/assets.h"

#define M 24
enum { L_SKY, L_CLOUDS, L_FAR, L_MID, L_GROUND, L_EXTRA1, L_EXTRA2, L_EXTRA3, L_EXTRA4, L_N };
static Img img[L_N], party_img;
static Atlas atlas;
static int loaded, victory, t_ms;
static TickClock clock, tw_clock;
static MoteField dust;
static BgState bg;
static int32_t w_pan;
static TypeProgress tp;
static char text[600], wrapped[700];
static int line, rolling, roll_ms, buttons, focus;

/* polegli */
typedef struct { int recruit, flip; float x, y; AtlasImg hurt, die[7]; } Fallen;
static Fallen fallen[MAX_PARTY];
static int n_fallen;
static UnitAnim ua;
static UnitPlace place[MAX_PARTY];
static UnitSet set;

static void start_text(const char *s, int wrap_w, int cps) {
  snprintf(text, sizeof text, "%s", s);
  font_wrap(text, 0, wrap_w, wrapped, sizeof wrapped);
  type_init(&tp, (int)strlen(wrapped), cps);
  clock_reset(&tw_clock, 0);
}

static void load_layers(const char *const *names, int n) {
  int i;
  loaded = 1;
  for (i = 0; i < n; i++)
    if (!img_load(&img[i], names[i])) {
      fprintf(stderr, "Najemnicy: %s\n", img_error());
      loaded = 0;
    }
}

static int load_frame(Lib *l, const char *name, AtlasImg *out) {
  const LibEntry *e = lib_find(l, name);
  uint8_t *rgba;
  int ok;
  if (!e) return 0;
  rgba = lib_decode(l, e);
  if (!rgba) return 0;
  ok = atlas_add(&atlas, rgba, e->w, e->h, out);
  free(rgba);
  return ok;
}

static void common_enter(void) {
  clock_reset(&clock, 0);
  fx_init();
  w_pan = ang_q8(0.045);
  t_ms = 0;
  line = rolling = buttons = focus = 0;
  roll_ms = 0;
}

/* ================================================================== KONIEC DROGI */
static void over_enter(void) {
  static const char *const L[7] = {"over_sky", "over_clouds", "over_far", "over_mid", "over_ground", "over_vig", "over_title"};
  int i, n = 0;
  victory = 0;
  load_layers(L, 7);
  common_enter();
  bg_init(&bg, &BG_OVER);
  motes_init(&dust, 80, 0, 60, V_W, 150, 14, 2, 9, 0.4);
  /* polegli: wg imion z g_fallen, inaczej cała drużyna (do 4) */
  atlas_init(&atlas);
  for (i = 0; i < g_camp.n_party && n < 4; i++) {
    int k, named = !g_n_fallen;
    for (k = 0; k < g_n_fallen; k++) named |= !strcmp(g_fallen[k], g_camp.party[i].name);
    if (named) fallen[n++].recruit = g_camp.party[i].recruit;
  }
  if (!n) fallen[n++].recruit = 0;
  n_fallen = n;
  for (i = 0; i < n; i++) {
    Fallen *f = &fallen[i];
    Lib l;
    char name[32];
    int k;
    f->x = (float)(int)(V_W / 2 + (i - (n - 1) / 2.0f) * 84);
    f->y = 182 + (i % 2) * 6.0f;
    f->flip = i % 2;
    snprintf(name, sizeof name, "unit_%s", RECRUIT_DEFS[f->recruit < RECRUIT_COUNT ? f->recruit : 0].key);
    if (!lib_load(&l, name)) continue;
    load_frame(&l, "f_hurt", &f->hurt);
    for (k = 0; k < 7; k++) {
      snprintf(name, sizeof name, "f_die%d", k);
      load_frame(&l, name, &f->die[k]);
    }
    lib_free(&l);
  }
  atlas_finish(&atlas);
  {
    char all[400] = "";
    for (i = 0; i < (int)(sizeof GAMEOVER_LINES / sizeof GAMEOVER_LINES[0]); i++) {
      if (i) strncat(all, " ", sizeof all - strlen(all) - 1);
      strncat(all, GAMEOVER_LINES[i], sizeof all - strlen(all) - 1);
    }
    start_text(all, V_W - 132, 28);
  }
  app_sfx("defeat", 256, 256);
}

/* ================================================================== ZWYCIĘSTWO */
static void win_enter(void) {
  static const char *const L[8] = {"win_sky", "win_clouds", "win_far", "win_mid", "win_ground", "win_title", "win_game", "win_studio"};
  int i, n = g_camp.n_party;
  victory = 1;
  load_layers(L, 8);
  if (!img_load(&party_img, "hub_party")) loaded = 0;
  common_enter();
  bg_init(&bg, &BG_WIN);
  motes_init(&dust, 100, 0, 80, V_W, 140, 10, -3, 21, 0.6);
  for (i = 0; i < n; i++) {
    place[i].row = g_camp.party[i].recruit < RECRUIT_COUNT ? g_camp.party[i].recruit : 0;
    place[i].x = (int16_t)(V_W / 2 + (i - (n - 1) / 2.0f) * 44);
    place[i].y = 206;
    place[i].flip = i >= n / 2.0f;
    place[i].depth10 = 40;
  }
  set.fw = 32;
  set.fh = 36;
  set.n = n;
  set.u = place;
  units_init(&ua, &set);
  start_text(EPILOGUE[0], V_W - 200, 30);
  app_sfx("victory", 256, 256);
}

static void leave(void) {
  int i;
  for (i = 0; i < L_N; i++) img_free(&img[i]);
  img_free(&party_img);
  atlas_free(&atlas);
}

static void update(unsigned held, unsigned pressed, int ms) {
  int n = clock_advance(&clock, ms, 10);
  (void)held;
  while (n-- > 0) {
    motes_step(&dust);
    bg_tick(&bg);
  }
  t_ms += ms;
  if (victory) units_update(&ua, &set, ms);
  if (!type_done(&tp)) type_step(&tp, clock_advance(&tw_clock, ms, 10));
  if (rolling && !buttons) {
    roll_ms += ms;
    if (roll_ms >= 34000) buttons = 1;
  }
  if (!victory && (type_done(&tp) || t_ms > 3000)) buttons = 1;
  if (app_leaving() || !pressed) return;
  if (buttons) {
    int nb = victory ? 2 : 1;
    if (pressed & (IN_LEFT | IN_UP) && focus > 0) focus--;
    if (pressed & (IN_RIGHT | IN_DOWN) && focus < nb - 1) focus++;
    if (pressed & IN_OK) {
      if (victory && focus == 0) app_switch(SCR_HUB, 400, 500);
      else app_switch(SCR_TITLE, 400, 500);
    }
    return;
  }
  if (!(pressed & (IN_OK | IN_RIGHT | IN_ANY))) return;
  if (!victory) {
    type_finish(&tp);
    buttons = 1;
    return;
  }
  if (rolling) {
    buttons = 1;
    return;
  }
  if (!type_done(&tp)) type_finish(&tp);
  else if (line + 1 < EPILOGUE_COUNT) start_text(EPILOGUE[++line], V_W - 200, 30);
  else {
    rolling = 1;
    roll_ms = 0;
  }
}

static void draw_typed(float x, float y, int center, uint32_t col) {
  char buf[700], *ln = buf, *nl;
  int shown = type_shown(&tp), i = 0;
  if (shown > (int)sizeof buf - 1) shown = sizeof buf - 1;
  memcpy(buf, wrapped, (size_t)shown);
  buf[shown] = 0;
  for (; ln; ln = nl ? nl + 1 : NULL, i++) {
    nl = strchr(ln, '\n');
    if (nl) *nl = 0;
    if (center) font_draw_at(x, y + i * (FONT_LINE_H + 2), 0.5f, 0, ln, col, 255, FONT_OUTLINE, 0, 1);
    else font_draw(x, y + i * (FONT_LINE_H + 2), ln, col, 255, FONT_OUTLINE, 0, 1);
  }
}

static void draw_bg(int32_t tq, int pan_px, const BgFx *fx, int rays) {
  int32_t pan = rdiv((int32_t)pan_px * 256 * wave_q14(tq, w_pan, 0), 16384);
  int dx;
  img_draw(&img[L_SKY], (float)parallax_x(M, pan, 50), 0, 255);
  drift_draw(&img[L_CLOUDS], clock.tick, 2200, 0, 242);
  if (rays) bg_rays(fx, tq);
  img_draw(&img[L_FAR], (float)parallax_x(M, pan, 250), 0, 255);
  dx = parallax_x(M, pan, 600) + M;
  img_draw(&img[L_MID], (float)(dx - M), 0, 255);
  bg_windows(fx, tq, dx);
  bg_birds(&bg, tq);
  img_draw(&img[L_GROUND], 0, 0, 255);
}

static void draw_over(void) {
  int32_t tq = clock_time_q8(&clock);
  int i;
  char buf[256];
  draw_bg(tq, 8, &BG_OVER, 0);
  r2d_ellipse(V_W / 2.0f, 176, 150, 30, 0xc43d2f, 31);
  for (i = 0; i < n_fallen; i++) {
    const Fallen *f = &fallen[i];
    int start = 600 + i * 380, d = t_ms - start, k;
    const AtlasImg *im;
    if (d < 0) im = &f->hurt;
    else {
      k = d * 7 / 420;
      im = &f->die[k > 6 ? 6 : k];
    }
    r2d_ellipse(f->x, f->y + 2, 25, 3.5f, 0, 115);
    if (im->w) atlas_draw_k(&atlas, im, f->x - im->w, f->y - im->h * 1.75f, 2, f->flip, d >= 420 ? 0xb09090 : 0xffffff, 255);
    (void)k;
  }
  img_draw(&img[L_EXTRA1], 0, 0, 255);   /* winieta */
  motes_draw(&dust, 0xa08070);
  img_draw(&img[L_EXTRA2], V_W / 2 - img[L_EXTRA2].w / 2.0f, 34 - img[L_EXTRA2].h / 2.0f, 255);
  ui_panel(56, 196, V_W - 112, 68, PAL_BLOOD);
  snprintf(buf, sizeof buf, "Polegli: ");
  for (i = 0; i < g_n_fallen; i++) {
    if (i) strncat(buf, ", ", sizeof buf - strlen(buf) - 1);
    strncat(buf, g_fallen[i], sizeof buf - strlen(buf) - 1);
  }
  if (!g_n_fallen) strncat(buf, "\200", sizeof buf - strlen(buf) - 1);
  font_draw_at(V_W / 2.0f, 200, 0.5f, 0, buf, PAL_BAD, 255, FONT_OUTLINE, 0, 1);
  draw_typed(V_W / 2.0f, 211, 1, PAL_TEXT);
  snprintf(buf, sizeof buf, "Przetrwali\266cie do dnia %d. Uko\361czone zlecenia: %d.", g_camp.day, g_camp.n_completed);
  font_draw_at(V_W / 2.0f, 236, 0.5f, 0, buf, PAL_DIM, 255, FONT_OUTLINE, 0, 1);
  if (buttons) ui_button(V_W / 2 - 50, 246, 100, 15, "MENU G\243\323WNE", BTN_DANGER, 1, 1);
}

static void draw_win(void) {
  int32_t tq = clock_time_q8(&clock);
  int i;
  draw_bg(tq, 14, &BG_WIN, 1);
  fx_campfire(V_W / 2.0f, 204, 1.5f, tq);
  for (i = 0; i < set.n; i++) {
    const UnitPlace *u = &place[i];
    int fy = (u->row / 7) * 256 + (u->row % 7) * 36;
    img_draw_part(&party_img, UNIT_IDLE[ua.step[i]].frame * 32, fy, 32, 36, u->x - 32.0f, u->y - 63.0f, 2, u->flip, 0xffffff, 255);
  }
  motes_draw(&dust, 0xffe0a0);
  {
    int a = rolling ? (roll_ms >= 1200 ? 0 : 255 - roll_ms * 255 / 1200) : 255;
    img_draw(&img[L_EXTRA1], V_W / 2 - img[L_EXTRA1].w / 2.0f, 36 - img[L_EXTRA1].h / 2.0f, a);
  }
  if (!rolling) {
    ui_panel(56, 212, V_W - 112, 50, PAL_EDGE_HI);
    draw_typed(64, 218, 0, PAL_TEXT);
    ui_button(56 + V_W - 112 - 66, 228, 58, 16, line == EPILOGUE_COUNT - 1 ? "NAPISY \215" : "DALEJ \215", BTN_PRIMARY, 1, 1);
    return;
  }
  /* napisy końcowe: kolumna jedzie w górę przez 34 s */
  {
    int shade = roll_ms >= 1200 ? 140 : roll_ms * 140 / 1200, total = 40 + CREDITS_COUNT * 30 + 70;
    float y0 = V_H + 10 - (V_H + 10 + total) * (roll_ms > 34000 ? 1 : roll_ms / 34000.0f), y = 0;
    char up[64];
    r2d_rect(0, 0, V_W, V_H, 0, shade);
    img_draw(&img[L_EXTRA2], V_W / 2 - img[L_EXTRA2].w / 2.0f, y0 + y - img[L_EXTRA2].h / 2.0f, 255);
    y += 40;
    for (i = 0; i < CREDITS_COUNT; i++) {
      snprintf(up, sizeof up, "%s", CREDITS[i][0]);
      latin2_upper(up);
      font_draw_at(V_W / 2.0f, y0 + y, 0.5f, 0, up, PAL_AMBER, 255, FONT_OUTLINE, 0, 1);
      font_draw_at(V_W / 2.0f, y0 + y + 9, 0.5f, 0, CREDITS[i][1], PAL_TEXT, 255, FONT_OUTLINE, 0, 1);
      y += 30;
    }
    img_draw(&img[L_EXTRA3], V_W / 2 - img[L_EXTRA3].w / 2.0f, y0 + y + 20 - img[L_EXTRA3].h / 2.0f, 255);
    font_draw_at(V_W / 2.0f, y0 + y + 46, 0.5f, 0, "Dzi\352kujemy za gr\352.", PAL_DIM, 255, FONT_OUTLINE, 0, 1);
  }
  if (buttons) {
    ui_button(V_W / 2 - 170, 240, 180, 15, "WR\323\306 DO PRZYSTANI (GRAJ DALEJ)", BTN_PRIMARY, focus == 0, 1);
    ui_button(V_W / 2 + 20, 240, 100, 15, "MENU G\243\323WNE", BTN_PLAIN, focus == 1, 1);
  }
}

static void draw(void) {
  if (!loaded) {
    font_draw_at(V_W / 2, V_H / 2, 0.5f, 0.5f, "Brak plik\363w grafiki (katalog gfx/)", PAL_BAD, 255, FONT_OUTLINE, 0, 1);
    return;
  }
  if (victory) draw_win();
  else draw_over();
}

const Screen SCREEN_GAMEOVER = {over_enter, update, draw, leave};
const Screen SCREEN_VICTORY = {win_enter, update, draw, leave};
