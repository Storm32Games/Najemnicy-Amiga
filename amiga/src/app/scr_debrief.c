/* Rozliczenie misji (port src/scenes/DebriefScene.ts): wynik z apply_mission_result (g_debrief, wyliczony przy końcu misji),
 * stan najemników sprzed naliczenia (g_before), odsłanianie po kolei: Złom (licznik), PD, reputacja, łup, polegli, wątek
 * fabularny, karty najemników z paskiem PD i awansem. Tło 'debrief' (sukces, zmierzch) albo 'debriefn' (odwrót, noc).
 * Plik w UTF-8, napisy przekodowuje tools/amiga/latin2_literals.py. */
#include <stdio.h>
#include <string.h>
#include "app.h"
#include "ui.h"
#include "game.h"
#include "scenefx.h"
#include "savegame.h"
#include "../gfx/r2d.h"
#include "../gfx/img.h"
#include "../core/frontend.h"
#include "../data/gamedata.h"
#include "../data/assets.h"

#define PX 24
#define PY 14
#define PW (V_W - 48)
#define PH 228
#define LX 10
#define RX 196
#define RW (PW - RX - 10)
#define M 24

enum { L_SKY, L_CLOUDS, L_FAR, L_MID, L_GROUND, L_PARTY, L_PORTRAITS, L_ICONS, L_N };
static Img img[L_N];
static int loaded, ok, t_ms, scrap_shown, step, n_steps, done_ms;
static TickClock clock;
static MoteField dust;
static BgState bg;
static int32_t w_pan;
static UnitAnim ua;
static UnitPlace place[MAX_PARTY];
static UnitSet set;

/* oś czasu: chwile odsłonięcia kolejnych elementów (ms) */
enum { S_SCRAP, S_STOLEN, S_XP, S_REP, S_LOOT, S_FALLEN, S_STORY, S_MEMBER0, S_BUTTON = S_MEMBER0 + MAX_PARTY, S_N };
static int at_ms[S_N], used[S_N];

static void short_txt(const char *s, int n, char *out, int cap) {
  int len = (int)strlen(s);
  if (len <= n) {
    snprintf(out, (size_t)cap, "%s", s);
    return;
  }
  memcpy(out, s, (size_t)(n - 1));
  out[n - 1] = (char)0x96;
  out[n] = 0;
}

static void enter(void) {
  static const char *const DAY[5] = {"debrief_sky", "debrief_clouds", "debrief_far", "debrief_mid", "debrief_ground"};
  static const char *const NIGHT[5] = {"debriefn_sky", "debriefn_clouds", "debriefn_far", "debriefn_mid", "debriefn_ground"};
  const DebriefSummary *r = &g_debrief;
  int i, t = 400;
  ok = r->result == MRES_SUCCESS;
  loaded = 1;
  for (i = 0; i < L_N; i++) {
    const char *name = i < 5 ? (ok ? DAY[i] : NIGHT[i]) : i == L_PARTY ? "hub_party" : i == L_PORTRAITS ? "portraits" : "icons";
    if (!img_load(&img[i], name)) {
      fprintf(stderr, "Najemnicy: %s\n", img_error());
      loaded = 0;
    }
  }
  clock_reset(&clock, 0);
  fx_init();
  bg_init(&bg, &BG_DEBRIEF);
  motes_init(&dust, 50, 0, 150, V_W, 120, 9, 1, 3, 0.4);
  w_pan = ang_q8(0.045);
  /* drużyna przy ognisku: po obu stronach, prawa połowa odwrócona */
  for (i = 0; i < g_camp.n_party; i++) {
    int n = g_camp.n_party;
    place[i].row = g_camp.party[i].recruit < RECRUIT_COUNT ? g_camp.party[i].recruit : 0;
    place[i].x = (int16_t)(V_W / 2 + (i - (n - 1) / 2.0f) * 30 + (i >= n / 2.0f ? 14 : -14));
    place[i].y = 266;
    place[i].flip = i >= n / 2.0f;
    place[i].depth10 = 30;
  }
  set.fw = 32;
  set.fh = 36;
  set.n = g_camp.n_party;
  set.u = place;
  units_init(&ua, &set);
  memset(used, 0, sizeof used);
  /* oś czasu jak script() w DebriefScene (sekundy -> ms) */
#define AT(k, d) do { t += (d); at_ms[k] = t; used[k] = 1; } while (0)
  AT(S_SCRAP, 200);
  if (r->stolen) AT(S_STOLEN, 300);
  AT(S_XP, 800);
  {
    int any = 0;
    for (i = 0; i < FACTION_COUNT; i++) any |= r->rep[i] != 0;
    if (any) AT(S_REP, 500);
  }
  if (r->n_items) AT(S_LOOT, 500);
  if (r->n_fallen) AT(S_FALLEN, 600);
  if (r->story) AT(S_STORY, 600);
  for (i = 0; i < g_camp.n_party && i < MAX_PARTY; i++) AT(S_MEMBER0 + i, i == 0 ? 500 : 350);
  AT(S_BUTTON, 1600);
#undef AT
  t_ms = 0;
  scrap_shown = 0;
  step = n_steps = 0;
  done_ms = 0;
  if (!g_debrief.tpk) save_write(0);   /* po TPK zapis zostaje (ekran porażki proponuje wczytanie) */
  app_sfx(ok ? "victory" : "defeat", 256, 256);
}

static void leave(void) {
  int i;
  for (i = 0; i < L_N; i++) img_free(&img[i]);
}

static void go_on(void) {
  if (g_debrief.tpk) app_switch(SCR_GAMEOVER, 400, 1200);
  else if (g_debrief.win) app_switch(SCR_VICTORY, 400, 1000);
  else app_switch(SCR_HUB, 400, 500);
}

static void update(unsigned held, unsigned pressed, int ms) {
  int n = clock_advance(&clock, ms, 10);
  (void)held;
  while (n-- > 0) {
    motes_step(&dust);
    bg_tick(&bg);
  }
  units_update(&ua, &set, ms);
  t_ms += ms;
  /* licznik Złomu: krok max(1, ceil(|reszta| * dt * 4)) */
  if (used[S_SCRAP] && t_ms >= at_ms[S_SCRAP] && scrap_shown != g_debrief.scrap) {
    int left = g_debrief.scrap - scrap_shown, st = (abs(left) * ms * 4 + 999) / 1000;
    if (st < 1) st = 1;
    scrap_shown += left > 0 ? (st > left ? left : st) : (st > -left ? left : -st);
  }
  if (app_leaving()) return;
  if (pressed & (IN_OK | IN_BACK)) {
    if (t_ms < at_ms[S_BUTTON]) t_ms = at_ms[S_BUTTON] + 1100;   /* pomiń odsłanianie */
    else go_on();
  }
}

static int fade_in(int k) {
  int d;
  if (!used[k] || t_ms < at_ms[k]) return 0;
  d = t_ms - at_ms[k];
  return d >= 380 ? 255 : d * 255 / 380;
}

static void draw_line(int *ly, const char *s, uint32_t col, int a) {
  r2d_alpha(a);
  *ly += ui_text(PX + LX, PY + *ly, s, col, RX - LX - 10, 0, 0) + 4;
  r2d_alpha(255);
}

static void draw(void) {
  const DebriefSummary *r = &g_debrief;
  int32_t tq = clock_time_q8(&clock), pan;
  int i, ly = 42, a, dx;
  char buf[256];
  if (!loaded) {
    font_draw_at(V_W / 2, V_H / 2, 0.5f, 0.5f, "Brak plik\363w grafiki (katalog gfx/)", PAL_BAD, 255, FONT_OUTLINE, 0, 1);
    return;
  }
  pan = rdiv(14L * 256 * wave_q14(tq, w_pan, 0), 16384);
  img_draw(&img[L_SKY], (float)parallax_x(M, pan, 50), 0, 255);
  drift_draw(&img[L_CLOUDS], clock.tick, 2200, 0, 242);
  if (ok) bg_rays(&BG_DEBRIEF, tq);
  img_draw(&img[L_FAR], (float)parallax_x(M, pan, 250), 0, 255);
  dx = parallax_x(M, pan, 600);
  img_draw(&img[L_MID], (float)dx, 0, 255);
  bg_birds(&bg, tq);
  img_draw(&img[L_GROUND], 0, 0, 255);
  fx_campfire(V_W / 2.0f, 264, 1.3f, tq);
  for (i = 0; i < set.n; i++) {
    const UnitPlace *u = &place[i];
    int fy = (u->row / 7) * 256 + (u->row % 7) * 36;
    img_draw_part(&img[L_PARTY], UNIT_IDLE[ua.step[i]].frame * 32, fy, 32, 36, u->x - 16.0f, u->y - 31.5f, 1, u->flip, 0xffffff, 255);
  }
  motes_draw(&dust, 0xf0c080);

  /* panel */
  r2d_rect(PX + 2, PY + 2, PW, PH, 0, 128);
  r2d_rect(PX, PY, PW, PH, PAL_PANEL, 245);
  r2d_frame(PX, PY, PW, PH, PAL_EDGE_HI, 255);
  {
    const char *head = r->result == MRES_SUCCESS ? "ZLECENIE WYKONANE" : r->result == MRES_RETREAT ? "ODWR\323T" : "PORA\257KA";
    uint32_t col = r->result == MRES_SUCCESS ? PAL_GOOD : r->result == MRES_RETREAT ? PAL_AMBER : PAL_BAD;
    font_draw_at(PX + PW / 2.0f, PY + 6, 0.5f, 0, head, col, 255, FONT_OUTLINE, 1, 1);
    font_draw_at(PX + PW / 2.0f, PY + 24, 0.5f, 0, g_debrief_title, PAL_DIM, 255, FONT_OUTLINE, 0, 1);
  }
  if ((a = fade_in(S_SCRAP))) {
    r2d_alpha(a);
    font_draw(PX + LX, PY + ly, "Z\263om: ", PAL_TEXT, 255, FONT_OUTLINE, 0, 1);
    snprintf(buf, sizeof buf, "%s%d", scrap_shown >= 0 ? "+" : "", scrap_shown);
    font_draw(PX + LX + font_measure("Z\263om: ", 0), PY + ly, buf, PAL_AMBER, 255, FONT_OUTLINE, 1, 1);
    r2d_alpha(255);
    ly += 14;
  }
  if ((a = fade_in(S_STOLEN))) {
    snprintf(buf, sizeof buf, "(w tym %d z kradzie\277y Szczura)", r->stolen);
    draw_line(&ly, buf, PAL_DIM, a);
  }
  if ((a = fade_in(S_XP))) {
    snprintf(buf, sizeof buf, "Do\266wiadczenie: +%d PD dla ka\277dego \277ywego najemnika", r->xp);
    draw_line(&ly, buf, 0x8fd14f, a);
  }
  if ((a = fade_in(S_REP))) {
    int neg = 0, first = 1;
    snprintf(buf, sizeof buf, "Reputacja: ");
    for (i = FACTION_COUNT - 1; i >= 0; i--)
      if (r->rep[i]) {
        char p[32];
        snprintf(p, sizeof p, "%s%s %s%d", first ? "" : ", ", i == FACTION_NOMADS ? "Nomadzi" : "Ocaleni", r->rep[i] > 0 ? "+" : "", r->rep[i]);
        strncat(buf, p, sizeof buf - strlen(buf) - 1);
        neg |= r->rep[i] < 0;
        first = 0;
      }
    draw_line(&ly, buf, neg ? PAL_BAD : PAL_GOOD, a);
  }
  if ((a = fade_in(S_LOOT))) {
    /* łup: te same przedmioty w stosy; dwie kolumny z nazwami albo zwarta siatka ikon */
    uint8_t ids[MAX_LOOT + 4];
    int cnt[MAX_LOOT + 4], nl = 0, k, reserve = (r->n_fallen ? 14 : 0) + (r->story ? 14 : 0), room, rows;
    for (i = 0; i < r->n_items; i++) {
      for (k = 0; k < nl && ids[k] != r->items[i]; k++) {}
      if (k == nl) {
        ids[nl] = r->items[i];
        cnt[nl++] = 0;
      }
      cnt[k]++;
    }
    draw_line(&ly, "\243up:", PAL_DIM, a);
    r2d_alpha(a);
    room = PH - 28 - reserve - ly;
    rows = (nl + 1) / 2;
    if (rows * 13 <= room) {
      for (i = 0; i < nl; i++) {
        int x = PX + LX + (i % 2) * 90, y = PY + ly + (i / 2) * 13, per = 25;
        char nm[48];
        r2d_rect((float)x, (float)y, 86, 12, 0, 77);
        r2d_frame((float)x, (float)y, 86, 12, PAL_EDGE, 255);
        img_draw_part(&img[L_ICONS], (ids[i] % per) * 10, (ids[i] / per) * 10, 10, 10, (float)(x + 1), (float)(y + 1), 1, 0, 0xffffff, 255);
        short_txt(ITEM_DEFS[ids[i]].name, cnt[i] > 1 ? 14 : 17, nm, sizeof nm);
        if (cnt[i] > 1) snprintf(buf, sizeof buf, "%s \327%d", nm, cnt[i]);
        else snprintf(buf, sizeof buf, "%s", nm);
        font_draw((float)(x + 14), y + 2.5f, buf, PAL_TEXT, 255, FONT_OUTLINE, 0, 0.75f);
      }
      ly += rows * 13 + 4;
    } else {
      const int CELL = 15, cols = (RX - LX - 8) / 15;
      for (i = 0; i < nl; i++) {
        int x = PX + LX + (i % cols) * CELL, y = PY + ly + (i / cols) * CELL;
        r2d_rect((float)x, (float)y, CELL - 1, CELL - 1, 0, 77);
        r2d_frame((float)x, (float)y, CELL - 1, CELL - 1, PAL_EDGE, 255);
        img_draw_part(&img[L_ICONS], (ids[i] % 23) * 11, 30 + (ids[i] / 23) * 11, 11, 11, (float)(x + 1), (float)(y + 1), 1, 0, 0xffffff, 255);
        if (cnt[i] > 1) {
          snprintf(buf, sizeof buf, "%d", cnt[i]);
          font_draw_at((float)(x + CELL - 2), (float)(y + CELL - 7), 1, 0, buf, PAL_AMBER, 255, FONT_OUTLINE, 0, 0.75f);
        }
      }
      ly += (nl + cols - 1) / cols * CELL + 4;
    }
    r2d_alpha(255);
  }
  if ((a = fade_in(S_FALLEN))) {
    snprintf(buf, sizeof buf, "Polegli: ");
    for (i = 0; i < g_n_fallen; i++) {
      if (i) strncat(buf, ", ", sizeof buf - strlen(buf) - 1);
      strncat(buf, g_fallen[i], sizeof buf - strlen(buf) - 1);
    }
    draw_line(&ly, buf, PAL_BAD, a);
  }
  if ((a = fade_in(S_STORY))) draw_line(&ly, r->win ? "\214 Kostucha nie \277yje!" : "\214 W\261tek fabularny posun\261\263 si\352 naprz\363d.", PAL_AMBER, a);

  /* karty najemników: pasek PD dobiega do nowej wartości (1.1 s), potem awans */
  for (i = 0; i < g_camp.n_party && i < MAX_PARTY; i++) {
    const Character *m = &g_camp.party[i];
    const BeforeMember *b = m->recruit < RECRUIT_COUNT ? &g_before[m->recruit] : NULL;
    int y = PY + 42 + i * 42, d, lv = r->levels_gained[i], full = RW - 90, bl = b && b->valid ? b->level : m->level, bxp = b && b->valid ? b->xp : m->xp;
    float k0, k1, k, frac;
    char nm[48];
    if (!(a = fade_in(S_MEMBER0 + i))) continue;
    r2d_alpha(a);
    d = t_ms - at_ms[S_MEMBER0 + i];
    r2d_rect(PX + RX, (float)y, RW, 38, PAL_PANEL2, 255);
    r2d_frame(PX + RX, (float)y, RW, 38, lv && d >= 1100 ? PAL_AMBER : PAL_EDGE, 255);
    if (m->recruit < RECRUIT_COUNT) img_draw_part(&img[L_PORTRAITS], (m->recruit % 8) * 30, 120 + (m->recruit / 8) * 30, 30, 30, PX + RX + 4.0f, y + 4.0f, 1, 0, 0xffffff, 255);
    r2d_frame(PX + RX + 3.0f, y + 3.0f, 32, 32, PAL_EDGE, 255);
    short_txt(m->name, 24, nm, sizeof nm);
    font_draw(PX + RX + 40.0f, y + 3.0f, nm, m->name_color != COLOR_NONE ? m->name_color : PAL_TEXT, 255, FONT_OUTLINE, 0, 1);
    if (lv && d >= 1100) snprintf(buf, sizeof buf, "%s \205 poz. %d \222 %d \205 PW %d \222 %d", CLASS_DEFS[m->class_id].name, bl, m->level, b && b->valid ? b->max_hp : m->max_hp, m->max_hp);
    else snprintf(buf, sizeof buf, "%s \205 poz. %d", CLASS_DEFS[m->class_id].name, bl);
    font_draw(PX + RX + 40.0f, y + 13.0f, buf, lv && d >= 1100 ? PAL_AMBER : PAL_DIM, 255, FONT_OUTLINE, 0, 0.85f);
    k0 = bxp / (float)XP_PER_LEVEL;
    k1 = lv + m->xp / (float)XP_PER_LEVEL;
    {
      /* Sine.easeInOut przez 1.1 s */
      float u = d >= 1100 ? 1 : d / 1100.0f;
      int c = icos_q14((int)(u * 128));
      k = k0 + (k1 - k0) * (1 - c / 16384.0f) / 2;
    }
    frac = d >= 1100 ? k1 - (int)k1 : k - (int)k;
    r2d_rect(PX + RX + 40.0f, y + 24.0f, (float)full, 4, 0x3a2c10, 255);
    r2d_rect(PX + RX + 40.0f, y + 24.0f, (float)(full * frac < 1 ? 1 : full * frac), 4, PAL_AMBER, 255);
    snprintf(buf, sizeof buf, "%d/%d", d >= 1100 ? m->xp : (int)(frac * XP_PER_LEVEL + 0.5f), XP_PER_LEVEL);
    font_draw(PX + RX + RW - 46.0f, y + 22.0f, buf, PAL_TEXT, 255, FONT_OUTLINE, 0, 0.85f);
    if (lv && d >= 1100) {
      char ab[160] = "AWANS!";
      int j, k2, first = 1;
      for (j = 0; j < m->n_abilities; j++) {
        int had = 0;
        if (b && b->valid)
          for (k2 = 0; k2 < b->n_abil; k2++) had |= b->abil[k2] == m->abilities[j];
        if (had) continue;
        strncat(ab, first ? " Nowe: " : ", ", sizeof ab - strlen(ab) - 1);
        strncat(ab, ABILITY_DEFS[m->abilities[j]].name, sizeof ab - strlen(ab) - 1);
        first = 0;
      }
      short_txt(ab, 48, buf, sizeof buf);
      font_draw(PX + RX + 40.0f, y + 30.0f, buf, 0x8fd14f, 255, FONT_OUTLINE, 0, 0.75f);
    }
    r2d_alpha(255);
  }
  if ((a = fade_in(S_BUTTON))) {
    r2d_alpha(a);
    ui_button(PX + 10, PY + PH - 24, 120, 18, r->tpk ? "DALEJ \215" : r->win ? "EPILOG \215" : "WR\323\306 DO PRZYSTANI \215", BTN_PRIMARY, 1, 1);
    r2d_alpha(255);
  }
}

const Screen SCREEN_DEBRIEF = {enter, update, draw, leave};
