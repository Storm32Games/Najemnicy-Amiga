/* Werbunek (port src/scenes/RecruitScene.ts): wybierz dokładnie 4 z 16 najemników. Tło 'recruit' (backdrop jak menu),
 * siatka 4 x 4 kart z portretami, karta wybranego najemnika (obraca się przy zmianie), plac z wybranymi, Pomoc.
 * Sterowanie (joystick / klawiatura): strzałki - fokus po kartach i przyciskach (fokus = pokazany najemnik),
 * fire / Enter - wybierz / odrzuć albo przycisk, Esc - zamknij Pomoc / wróć do menu. */
#include <stdio.h>
#include <string.h>
#include "app.h"
#include "ui.h"
#include "scenefx.h"
#include "../gfx/r2d.h"
#include "../gfx/img.h"
#include "../core/frontend.h"
#include "../core/character.h"
#include "../core/campaign.h"
#include "../data/gamedata.h"
#include "../data/assets.h"

#define GRID_X 8
#define GRID_Y 34
#define CARD_W 38
#define CARD_H 46
#define GAP 3
#define DET_X 182
#define DET_Y 22
#define DET_W 290
#define DET_H 212
#define SMALL 0.75f
#define M 24
#define PAL_TOXIC 0x8fd14fUL
#define N_BTN 4
enum { B_BACK, B_HELP, B_RANDOM, B_START };

enum { L_SKY, L_CLOUDS, L_FAR, L_MID, L_GROUND, L_PORTRAITS, L_N };
static const char *const LAYER[L_N] = {"recruit_sky", "recruit_clouds", "recruit_far", "recruit_mid", "recruit_ground", "recruit_portraits"};
static const char *const ATTR_SHORT[ATTR_COUNT] = {"SI\243", "ZR\312", "KON", "INT", "M\241D", "CHA"};
static const uint32_t NAME_COLORS[10] = {0xf2a93b, 0xff6a50, 0xff7ac0, 0xc890ff, 0x6ab0ff, 0x40d8d0, 0x8fe06a, 0xe8e060, 0xffffff, 0xb8a888};

static Img img[L_N], spr;
static int loaded, spr_for;
static TickClock clock;
static BgState bg;
static MoteField dust;
static Character prev[RECRUIT_COUNT];
static uint32_t name_col[RECRUIT_COUNT];   /* COLOR_NONE = domyślny */
static int picks[MAX_PARTY], n_picks;
static int focus;                 /* 0..15 karty, 16.. przyciski */
static int view, flip_to, flip_ms;  /* obrót karty: flip_to >= 0 trwa, flip_ms od początku */
static int help, help_ms;
static int hint_bad;
static int dir, turn_wait, turn_left, turn_ms;   /* rozglądanie się postaci */
static float fig_x[RECRUIT_COUNT], fig_a[RECRUIT_COUNT];
static int fig_on[RECRUIT_COUNT];
static Rng rng;
static uint32_t entropy;
static CampaignState camp;
static int32_t w_pan;

/* ------------------------------------------------------------------ dane */
static int picked(int r) {
  int i;
  for (i = 0; i < n_picks; i++) if (picks[i] == r) return i;
  return -1;
}

/* plainName: bez pseudonimu w cudzysłowie */
static void plain_name(const char *s, char *out, int cap) {
  int n = 0, q = 0;
  for (; *s && n < cap - 1; s++) {
    if (*s == '"') {
      q = !q;
      if (!q) while (s[1] == ' ') s++;
      continue;
    }
    if (!q) out[n++] = *s;
  }
  while (n > 0 && out[n - 1] == ' ') n--;
  out[n] = 0;
}

static void cut(const char *s, int n, char *out, int cap) {
  int len = (int)strlen(s);
  if (len <= n) {
    snprintf(out, (size_t)cap, "%s", s);
    return;
  }
  if (n > cap - 1) n = cap - 1;
  memcpy(out, s, (size_t)(n - 1));
  out[n - 1] = (char)0x96;   /* … */
  out[n] = 0;
}

static void signed_str(int v, char *out) { sprintf(out, "%s%d", v >= 0 ? "+" : "", v); }

/* ------------------------------------------------------------------ wejście, zmiana pokazanego */
static void spr_load(int r) {
  char name[32];
  if (spr_for == r) return;
  img_free(&spr);
  snprintf(name, sizeof name, "spr_%s", RECRUIT_DEFS[r].key);
  if (!img_load(&spr, name)) fprintf(stderr, "Najemnicy: %s\n", img_error());
  spr_for = r;
  dir = 0;                       /* zaczyna przodem */
  turn_wait = 600 + (int)rng_below(&rng, 1801);
  turn_left = turn_ms = 0;
}

static void show(int r) {
  if (flip_to >= 0) {
    flip_to = r;
    return;
  }
  if (r == view) return;
  flip_to = r;
  flip_ms = 0;
  app_sfx("flip", 179, 256);
}

static void toggle(int r) {
  int i = picked(r);
  hint_bad = 0;
  if (i >= 0) {
    memmove(&picks[i], &picks[i + 1], sizeof(int) * (size_t)(n_picks - i - 1));
    n_picks--;
  } else if (n_picks < MAX_PARTY) picks[n_picks++] = r;
  else {
    app_sfx("error", 256, 256);
    hint_bad = 1;
    return;
  }
  app_sfx(n_picks ? "pickup" : "click", 128, 256);
}

static void random_party(void) {
  int pool[RECRUIT_COUNT], cols[10], i, j, t;
  for (i = 0; i < RECRUIT_COUNT; i++) pool[i] = i;
  for (i = 0; i < 10; i++) cols[i] = i;
  rng_seed(&rng, entropy);
  /* Phaser.Utils.Array.Shuffle (Fisher-Yates od końca) */
  for (i = RECRUIT_COUNT - 1; i > 0; i--) {
    j = (int)rng_below(&rng, (uint32_t)i + 1);
    t = pool[i]; pool[i] = pool[j]; pool[j] = t;
  }
  for (i = 9; i > 0; i--) {
    j = (int)rng_below(&rng, (uint32_t)i + 1);
    t = cols[i]; cols[i] = cols[j]; cols[j] = t;
  }
  n_picks = 0;
  /* możliwie różne klasy, potem dopełnienie */
  for (i = 0; i < RECRUIT_COUNT && n_picks < MAX_PARTY; i++) {
    int dup = 0;
    for (j = 0; j < n_picks; j++) if (RECRUIT_DEFS[picks[j]].class_id == RECRUIT_DEFS[pool[i]].class_id) dup = 1;
    if (!dup) picks[n_picks++] = pool[i];
  }
  for (i = 0; i < RECRUIT_COUNT && n_picks < MAX_PARTY; i++)
    if (picked(pool[i]) < 0) picks[n_picks++] = pool[i];
  for (i = 0; i < n_picks; i++) {
    name_col[picks[i]] = NAME_COLORS[cols[i % 10]];
    prev[picks[i]].name_color = name_col[picks[i]];
  }
  hint_bad = 0;
  app_sfx("pickup", 128, 256);
  show(picks[0]);
}

static void begin(void) {
  uint8_t p[MAX_PARTY];
  int i;
  if (n_picks != MAX_PARTY) return;
  for (i = 0; i < MAX_PARTY; i++) p[i] = (uint8_t)picks[i];
  rng_seed(&rng, entropy);
  start_campaign(&camp, p, MAX_PARTY, &rng);
  for (i = 0; i < MAX_PARTY; i++) camp.party[i].name_color = name_col[picks[i]];
  ui_toast("Dru\277yna zebrana. Przysta\361 nie jest jeszcze przeniesiona na Amig\352.", PAL_AMBER);
}

static void press_button(int b) {
  app_sfx("click", 256, 256);
  switch (b) {
    case B_BACK: app_switch(SCR_TITLE, 400, 500); break;
    case B_HELP: help = 1; help_ms = 0; break;
    case B_RANDOM: random_party(); break;
    case B_START: begin(); break;
  }
}

/* ------------------------------------------------------------------ ekran */
static void enter(void) {
  int i;
  loaded = 1;
  for (i = 0; i < L_N; i++)
    if (!img_load(&img[i], LAYER[i])) {
      fprintf(stderr, "Najemnicy: %s\n", img_error());
      loaded = 0;
    }
  memset(&spr, 0, sizeof spr);
  spr_for = -1;
  clock_reset(&clock, 0);
  fx_init();
  bg_init(&bg, &BG_RECRUIT);
  motes_init(&dust, 60, 0, 120, V_W, 150, 10, 1, 3, 0.4);
  w_pan = ang_q8(0.045);
  for (i = 0; i < RECRUIT_COUNT; i++) {
    char_from_recruit(&prev[i], (uint8_t)i, NULL, 1);
    name_col[i] = COLOR_NONE;
    fig_on[i] = 0;
  }
  n_picks = 0;
  focus = view = 0;
  flip_to = -1;
  help = hint_bad = 0;
  rng_seed(&rng, entropy ^ 0x9e3779b9u);
  spr_load(0);
}

static void leave(void) {
  int i;
  for (i = 0; i < L_N; i++) img_free(&img[i]);
  img_free(&spr);
  spr_for = -1;
}

static void nav(unsigned pressed) {
  int col = focus % 4, row = focus / 4;
  if (focus < 16) {
    if (pressed & IN_LEFT && col > 0) focus--;
    else if (pressed & IN_RIGHT && col < 3) focus++;
    else if (pressed & IN_UP && row > 0) focus -= 4;
    else if (pressed & IN_DOWN) focus = row < 3 ? focus + 4 : 16 + col;
    else if (pressed & IN_OK) {
      toggle(focus);
      show(focus);
      return;
    } else return;
    app_sfx("hover", 256, 256);
    if (focus < 16) show(focus);
  } else {
    int b = focus - 16;
    if (pressed & IN_LEFT && b > 0) focus--;
    else if (pressed & IN_RIGHT && b < N_BTN - 1) focus++;
    else if (pressed & IN_UP) focus = 12 + b;
    else if (pressed & IN_OK) {
      if (b != B_START || n_picks == MAX_PARTY) press_button(b);
      return;
    } else return;
    app_sfx("hover", 256, 256);
    if (focus < 16) show(focus);
  }
}

static void update(unsigned held, unsigned pressed, int ms) {
  int n, i;
  (void)held;
  entropy = entropy * 1664525u + 1013904223u + (uint32_t)ms + pressed * 2654435761u;
  for (n = clock_advance(&clock, ms, 10); n > 0; n--) {
    motes_step(&dust);
    bg_tick(&bg);
  }
  ui_toast_update(ms);
  if (help) help_ms += ms;
  /* obrót karty: 110 ms zwężania, podmiana, 140 ms rozwijania */
  if (flip_to >= 0) {
    int before = flip_ms;
    flip_ms += ms;
    if (before < 110 && flip_ms >= 110) {
      view = flip_to;
      spr_load(view);
    }
    if (flip_ms >= 250) {
      int late = flip_to;
      flip_to = -1;
      if (late != view) show(late);
    }
  }
  /* rozglądanie się: co 0.6-2.4 s 1-4 kroki w lewo / prawo, 80 ms na krok */
  if (turn_left) {
    turn_ms += ms;
    while (turn_left && turn_ms >= 80) {
      turn_ms -= 80;
      dir = (dir + (turn_left > 0 ? 1 : 7)) % 8;
      turn_left += turn_left > 0 ? -1 : 1;
      if (!turn_left) turn_wait = 600 + (int)rng_below(&rng, 1801);
    }
  } else if ((turn_wait -= ms) <= 0) {
    int steps = 1 + (int)rng_below(&rng, 4);
    turn_left = rng_below(&rng, 2) ? steps : -steps;
    turn_ms = 0;   /* pierwszy krok po 80 ms */
  }
  /* plac: wybrani w kolejności wyboru, nowy z przenikaniem 200 ms, przesuw 180 ms */
  for (i = 0; i < RECRUIT_COUNT; i++) {
    int k = picked(i);
    if (k < 0) {
      fig_on[i] = 0;
      continue;
    }
    {
      float tx = (float)(int)(142 + (k - (n_picks - 1) / 2.0f) * 34 - 13 + 0.5f);
      if (!fig_on[i]) {
        fig_on[i] = 1;
        fig_x[i] = tx;
        fig_a[i] = 0;
      }
      fig_x[i] += (tx - fig_x[i]) * (ms >= 60 ? 1 : ms / 60.0f);   /* dojazd ~180 ms */
      fig_a[i] += ms / 200.0f;
      if (fig_a[i] > 1) fig_a[i] = 1;
    }
  }
  if (app_leaving()) return;
  if (help) {
    if (pressed & (IN_OK | IN_BACK)) help = 0;
    return;
  }
  if (pressed & IN_BACK) {
    press_button(B_BACK);
    return;
  }
  nav(pressed);
}

/* ------------------------------------------------------------------ rysowanie */
static void portrait(int r, int size, int x, int y, uint32_t frame) {
  int sx = (r % 8) * size, sy = (size == 30 ? 0 : 60) + (r / 8) * size;
  img_draw_part(&img[L_PORTRAITS], sx, sy, size, size, (float)x, (float)y, 1, 0, 0xffffff, 255);
  r2d_frame((float)x, (float)y, (float)size, (float)size, frame, 255);
}

/* drobny druk wyśrodkowany, przycięty z "…" do szerokości karty (label z small + maxW) */
static void small_c(float x, float y, const char *s, uint32_t col) {
  char buf[64];
  int n;
  snprintf(buf, sizeof buf, "%s", s);
  n = (int)strlen(buf);
  if (font_measure(buf, 0) * SMALL > CARD_W - 2) {
    do {
      buf[--n] = 0;
      buf[n - 1] = (char)0x96;
    } while (n > 1 && font_measure(buf, 0) * SMALL > CARD_W - 2);
  }
  font_draw_at(x, y, 0.5f, 0, buf, col, 255, FONT_OUTLINE, 0, SMALL);
}

/* "chipy" (umiejętności, zdolności): zwraca y pod nimi */
static int chips(int y, const char *title, const char *const *items, int n, uint32_t col, uint32_t edge) {
  int x = 8, cy = y + 9, i;
  font_draw(DET_X + 8, (float)(DET_Y + y), title, PAL_DIM, 255, FONT_OUTLINE, 0, 1);
  if (!n) {
    static const char *const dash[1] = {"\200"};
    items = dash;
    n = 1;
  }
  for (i = 0; i < n; i++) {
    int tw = font_measure(items[i], 0);
    if (x + tw + 6 > DET_W - 8) {
      x = 8;
      cy += 12;
    }
    r2d_rect((float)(DET_X + x), (float)(DET_Y + cy), (float)(tw + 6), 10, 0, 89);
    r2d_frame((float)(DET_X + x), (float)(DET_Y + cy), (float)(tw + 6), 10, edge, 255);
    font_draw((float)(DET_X + x + 3), DET_Y + cy + 0.5f, items[i], col, 255, FONT_OUTLINE, 0, 1);
    x += tw + 9;
  }
  return cy + 13;
}

static void draw_detail(int r) {
  const Character *ch = &prev[r];
  const RecruitDef *rd = &RECRUIT_DEFS[r];
  const ClassDef *cls = &CLASS_DEFS[rd->class_id];
  const AncestryDef *anc = &ANCESTRY_DEFS[ch->ancestry];
  char buf[256], v[16];
  static char skill_txt[5][48];
  const char *items[6];
  int i, n, y;
  const int X = DET_X, Y = DET_Y;
  /* cała postać 64x64 w ramce, rozgląda się */
  r2d_rect(X + 8, Y + 8, 64, 64, 0x1c1612, 255);
  r2d_frame(X + 8, Y + 8, 64, 64, PAL_EDGE, 255);
  if (spr_for == r && spr.n) img_draw_part(&spr, (dir % 4) * 64, (dir / 4) * 64, 64, 64, X + 8, Y + 8, 1, 0, 0xffffff, 255);
  font_draw(X + 78, Y + 8, ch->name, ch->name_color != COLOR_NONE ? ch->name_color : PAL_AMBER, 255, FONT_OUTLINE, 1, 1);
  snprintf(buf, sizeof buf, "%s \200 %s", cls->name, cls->role);
  font_draw(X + 78, Y + 22, buf, PAL_AMBER, 255, FONT_OUTLINE, 0, 1);
  if (cls->pf2e && *cls->pf2e) snprintf(buf, sizeof buf, "%s \205 poz. 1  (PF2e: %s / %s)", anc->name, cls->pf2e, anc->pf2e);
  else snprintf(buf, sizeof buf, "%s \205 poz. 1", anc->name);
  font_draw(X + 78, Y + 33, buf, PAL_DIM, 255, FONT_OUTLINE, 0, 1);
  snprintf(buf, sizeof buf, "\227%s\230", rd->bio);
  ui_text(X + 78, Y + 45, buf, 0xcbbf9f, DET_W - 88, 0, 0);
  /* cechy */
  for (i = 0; i < ATTR_COUNT; i++) {
    int x = X + 8 + i * 46, a = ch->attrs[i];
    r2d_rect((float)x, Y + 88, 43, 22, 0, 102);
    r2d_frame((float)x, Y + 88, 43, 22, PAL_EDGE, 255);
    font_draw_at(x + 21.5f, Y + 89, 0.5f, 0, ATTR_SHORT[i], PAL_DIM, 255, FONT_OUTLINE, 0, 1);
    signed_str(a, v);
    font_draw_at(x + 21.5f, Y + 96, 0.5f, 0, v, a > 0 ? PAL_GOOD : a < 0 ? PAL_BAD : PAL_TEXT, 255, FONT_OUTLINE, 0, 1);
  }
  /* statystyki pochodne */
  {
    static const char *const K[6] = {"PW ", "KP ", "Szybk. ", "Wytrz. ", "Refleks ", "Wola "};
    const int key[6] = {-1, STAT_AC, STAT_SPEED, STAT_FORT, STAT_REF, STAT_WILL};
    const uint32_t col[6] = {PAL_GOOD, PAL_AMBER, PAL_TEXT, PAL_TEXT, PAL_TEXT, PAL_TEXT};
    for (i = 0; i < 6; i++) {
      int x = X + 8 + (i % 3) * 92, yy = Y + 114 + (i / 3) * 10, val = key[i] < 0 ? ch->max_hp : get_stat(ch, key[i], 0);
      if (i < 3) sprintf(v, "%d", val);
      else signed_str(val, v);
      font_draw((float)x, (float)yy, K[i], PAL_DIM, 255, FONT_OUTLINE, 0, 1);
      font_draw((float)(x + font_measure(K[i], 0) + 1), (float)yy, v, col[i], 255, FONT_OUTLINE, 0, 1);
    }
  }
  /* wyposażenie */
  {
    char gear[160] = "";
    static const int slots[4] = {SLOT_WEAPON, SLOT_WEAPON2, SLOT_ARMOR, SLOT_SHIELD};
    for (i = 0; i < 4; i++) {
      uint8_t id = ch->equip[slots[i]].id;
      if (id == ITEM_NONE) continue;
      if (*gear) strncat(gear, ", ", sizeof gear - strlen(gear) - 1);
      strncat(gear, ITEM_DEFS[id].name, sizeof gear - strlen(gear) - 1);
    }
    snprintf(buf, sizeof buf, "Wyposa\277enie: %s", *gear ? gear : "\200");
    cut(buf, 76, gear, sizeof gear);
    font_draw(X + 8, Y + 136, gear, PAL_DIM, 255, FONT_OUTLINE, 0, 1);
  }
  /* kluczowe umiejętności: 5 najlepszych z rangą > 0 (sortowanie stabilne po wartości malejąco, kolejność kluczy z TS) */
  {
    int ids[SKILL_COUNT], vals[SKILL_COUNT], k, j;
    n = 0;
    for (k = 0; k < ch->n_skill_order; k++) {
      int s = ch->skill_order[k];
      if (ch->prof.skills[s] > 0) {
        ids[n] = s;
        vals[n++] = get_stat(ch, s, 0);
      }
    }
    for (k = 1; k < n; k++)
      for (j = k; j > 0 && vals[j] > vals[j - 1]; j--) {
        int t = vals[j]; vals[j] = vals[j - 1]; vals[j - 1] = t;
        t = ids[j]; ids[j] = ids[j - 1]; ids[j - 1] = t;
      }
    if (n > 5) n = 5;
    for (k = 0; k < n; k++) {
      char rank[8];
      signed_str(vals[k], v);
      snprintf(rank, 4, "%s", PROF_NAMES[ch->prof.skills[ids[k]]]);
      snprintf(skill_txt[k], sizeof skill_txt[k], "%s %s (%s.)", SKILL_DEFS[ids[k]].name, v, rank);
      items[k] = skill_txt[k];
    }
  }
  y = chips(146, "KLUCZOWE UMIEJ\312TNO\246CI", items, n, PAL_TEXT, PAL_EDGE);
  /* zdolności klasy (bez uniwersalnych), do 5 */
  n = 0;
  for (i = 0; i < ch->n_abilities && n < 5; i++) {
    int a = ch->abilities[i], u, uni = 0;
    for (u = 0; u < UNIVERSAL_ABILITY_COUNT; u++) if (UNIVERSAL_ABILITIES[u] == a) uni = 1;
    if (!uni && ABILITY_DEFS[a].name && *ABILITY_DEFS[a].name) items[n++] = ABILITY_DEFS[a].name;
  }
  chips(y, "ZDOLNO\246CI KLASY", items, n, PAL_TOXIC, 0x4f6a2a);
}

/* ---- Pomoc: tabele klas i ras (drobny druk) */
#define HW 468
#define HH 256
static const char *const HELP_INTRO = "Zasady Pathfinder 2e, 3 akcje na tur\352. Testy i ataki: k20 + modyfikator vs ST / KP, cztery stopnie sukcesu (\22410 od ST; naturalna 20 / 1 przesuwa o stopie\361). Obra\277enia i leczenie: ko\266ci broni lub zdolno\266ci (k4, k6, k8, k10, k12) + premia; krytyk = obra\277enia \3272, udany rzut obronny = po\263owa. Ka\277da klasa i rasa to odpowiednik z PF2e.";

static void help_cell(float x, float y, const char *s, uint32_t col, float maxw) {
  char buf[200];
  int n = (int)strlen(s);
  snprintf(buf, sizeof buf, "%s", s);
  while (n > 0 && font_measure(buf, 0) * SMALL > maxw) buf[--n] = 0;   /* przycięcie do ramki okna */
  font_draw(x, y, buf, col, 255, FONT_OUTLINE, 0, SMALL);
}

static float table(float ox, float oy, float y, const char *const *head, int ncol, char cells[][5][200], const uint32_t *row_col, int nrow) {
  float xs[5];
  int c, r;
  xs[0] = 8;
  for (c = 0; c < ncol - 1; c++) {
    float w = font_measure(head[c], 0) * SMALL;
    for (r = 0; r < nrow; r++) {
      float m = font_measure(cells[r][c], 0) * SMALL;
      if (m > w) w = m;
    }
    xs[c + 1] = xs[c] + w + 6;
  }
  for (c = 0; c < ncol; c++) help_cell(ox + xs[c], oy + y, head[c], PAL_AMBER, HW - 8 - xs[c]);
  for (r = 0; r < nrow; r++) {
    y += 7;
    for (c = 0; c < ncol; c++)
      help_cell(ox + xs[c], oy + y, cells[r][c], c == 0 ? row_col[r] : c == ncol - 1 ? 0xcbbf9f : PAL_TEXT, HW - 8 - xs[c]);
  }
  return y;
}

static void draw_help(void) {
  #define HROWS ((int)CLASS_COUNT > (int)ANC_COUNT ? (int)CLASS_COUNT : (int)ANC_COUNT)
  static char cells[HROWS][5][200];
  uint32_t cols[HROWS];
  static const char *const HC[5] = {"Klasa", "PF2e", "Rola", "PW/poz.", "Zdolno\266ci"};
  static const char *const HA[5] = {"Rasa", "PF2e", "PW", "Pr\352dk.", "Premie / wada"};
  float ox = (V_W - HW) / 2, oy = (V_H - HH) / 2, y;
  int i, k, lines;
  char wrapped[700];
  r2d_rect(0, 0, V_W, V_H, 0, 168);
  ui_panel((int)ox, (int)oy, HW, HH, PAL_EDGE_HI);
  font_draw(ox + 8, oy + 6, "POMOC \200 KLASY I RASY A PATHFINDER 2E", PAL_AMBER, 255, FONT_OUTLINE, 1, 1);
  lines = font_wrap(HELP_INTRO, 0, (int)((HW - 16) / SMALL), wrapped, sizeof wrapped);
  font_draw(ox + 8, oy + 20, wrapped, PAL_DIM, 255, FONT_OUTLINE, 0, SMALL);
  y = (float)(int)(20 + lines * FONT_LINE_H * SMALL + 0.999f) + 4;
  for (i = 0; i < CLASS_COUNT; i++) {
    const ClassDef *c = &CLASS_DEFS[i];
    snprintf(cells[i][0], 200, "%s", c->name);
    snprintf(cells[i][1], 200, "%s", c->pf2e);
    snprintf(cells[i][2], 200, "%s", c->role);
    snprintf(cells[i][3], 200, "%d", c->hp_per_level);
    cells[i][4][0] = 0;
    for (k = 0; k < c->n_abilities; k++) {
      if (k) strncat(cells[i][4], ", ", 199 - strlen(cells[i][4]));
      strncat(cells[i][4], ABILITY_DEFS[c->abilities[k]].name, 199 - strlen(cells[i][4]));
    }
    cols[i] = c->color;
  }
  y = table(ox, oy, y, HC, 5, cells, cols, CLASS_COUNT);
  for (i = 0; i < ANC_COUNT; i++) {
    const AncestryDef *a = &ANCESTRY_DEFS[i];
    char *b = cells[i][4];
    int first = 1;
    snprintf(cells[i][0], 200, "%s", a->name);
    snprintf(cells[i][1], 200, "%s", a->pf2e);
    snprintf(cells[i][2], 200, "%d", a->hp);
    snprintf(cells[i][3], 200, "%d", a->speed);
    b[0] = 0;
    for (k = 0; k < ATTR_COUNT; k++)
      if (a->attr_boost[k] > 0) {
        if (!first) strncat(b, ", ", 199 - strlen(b));
        strncat(b, ATTR_NAMES[k], 199 - strlen(b));
        first = 0;
      }
    if (a->free_boosts) {
      char f[32];
      if (a->free_boosts > 1) snprintf(f, sizeof f, "%d dowolne", a->free_boosts);
      else snprintf(f, sizeof f, "jedna dowolna");
      if (!first) strncat(b, ", ", 199 - strlen(b));
      strncat(b, f, 199 - strlen(b));
    }
    first = 1;
    for (k = 0; k < ATTR_COUNT; k++)
      if (a->attr_flaw[k]) {
        strncat(b, first ? " / \202" : ", \202", 199 - strlen(b));
        strncat(b, ATTR_NAMES[k], 199 - strlen(b));
        first = 0;
      }
    if (a->perk && *a->perk) {
      strncat(b, " \200 ", 199 - strlen(b));
      strncat(b, a->perk, 199 - strlen(b));
    }
    cols[i] = PAL_TEXT;
  }
  table(ox, oy, y + 11, HA, 5, cells, cols, ANC_COUNT);
  ui_button((int)ox + HW - 62, (int)oy + HH - 20, 54, 15, "ZAMKNIJ", BTN_PRIMARY, 1, 1);
}

static void draw(void) {
  int32_t tq = clock_time_q8(&clock), pan;
  int i, dx_mid, full = n_picks == MAX_PARTY;
  char buf[96];
  if (!loaded) {
    font_draw_at(V_W / 2, V_H / 2, 0.5f, 0.5f, "Brak plik\363w grafiki (katalog gfx/)", PAL_BAD, 255, FONT_OUTLINE, 0, 1);
    return;
  }
  /* tło (backdrop 'recruit'), pył */
  pan = rdiv(14L * 256 * wave_q14(tq, w_pan, 0), 16384);
  img_draw(&img[L_SKY], (float)parallax_x(M, pan, 50), 0, 255);
  drift_draw(&img[L_CLOUDS], clock.tick, 2200, 0, 242);
  bg_rays(&BG_RECRUIT, tq);
  img_draw(&img[L_FAR], (float)parallax_x(M, pan, 250), 0, 255);
  dx_mid = parallax_x(M, pan, 600) + M;
  img_draw(&img[L_MID], (float)(dx_mid - M), 0, 255);
  bg_windows(&BG_RECRUIT, tq, dx_mid);
  bg_birds(&bg, tq);
  img_draw(&img[L_GROUND], 0, 0, 255);
  motes_draw(&dust, 0xf0c080);

  font_draw(GRID_X, 6, "ZBIERZ DRU\257YN\312", PAL_AMBER, 255, FONT_OUTLINE, 1, 1);
  snprintf(buf, sizeof buf, "Wybrano: %d/%d", n_picks, MAX_PARTY);
  font_draw_at(V_W - 8, 8, 1, 0, buf, full ? PAL_GOOD : PAL_AMBER, 255, FONT_OUTLINE, 0, 1);
  if (hint_bad) snprintf(buf, sizeof buf, "Dru\277yna jest pe\263na \200 odrzu\346 kogo\266 najpierw.");
  else if (full) {
    int k, j, distinct = 0;
    for (k = 0; k < n_picks; k++) {
      int seen = 0;
      for (j = 0; j < k; j++) if (RECRUIT_DEFS[picks[j]].class_id == RECRUIT_DEFS[picks[k]].class_id) seen = 1;
      distinct += !seen;
    }
    snprintf(buf, sizeof buf, "Gotowi. Pustkowia czekaj\261.%s", distinct < 3 ? " (ma\263o r\363\277norodna dru\277yna)" : "");
  } else snprintf(buf, sizeof buf, "Wybierz jeszcze %d.", MAX_PARTY - n_picks);
  font_draw_at(V_W - 90, 9, 1, 0, buf, hint_bad ? PAL_BAD : PAL_DIM, 255, FONT_OUTLINE, 0, 1);

  /* siatka kart */
  ui_panel(GRID_X - 4, 22, 4 * CARD_W + 3 * GAP + 8, 212, PAL_EDGE);
  font_draw(GRID_X, 25, "NAJEMNICY DO WZI\312CIA", PAL_AMBER, 255, FONT_OUTLINE, 0, 1);
  for (i = 0; i < RECRUIT_COUNT; i++) {
    int x = GRID_X + (i % 4) * (CARD_W + GAP), y = GRID_Y + (i / 4) * (CARD_H + GAP), k = picked(i);
    char nm[48], cn[48];
    r2d_rect((float)x, (float)y, CARD_W, CARD_H, k >= 0 ? 0x22301a : PAL_PANEL2, 255);
    r2d_frame((float)x, (float)y, CARD_W, CARD_H, i == view ? PAL_EDGE_HI : k >= 0 ? PAL_TOXIC : PAL_EDGE, 255);
    if (i == focus && i != view) r2d_frame(x - 1.0f, y - 1.0f, CARD_W + 2, CARD_H + 2, PAL_EDGE_HI, 160);
    portrait(i, 30, x + 4, y + 1, 0);
    plain_name(prev[i].name, nm, sizeof nm);
    cut(nm, 9, cn, sizeof cn);
    small_c(x + CARD_W / 2.0f, (float)(y + 31), name_col[i] != COLOR_NONE ? cn : nm, name_col[i] != COLOR_NONE ? name_col[i] : PAL_TEXT);
    small_c(x + CARD_W / 2.0f, (float)(y + 36), CLASS_DEFS[RECRUIT_DEFS[i].class_id].name, PAL_AMBER);
    small_c(x + CARD_W / 2.0f, (float)(y + 41), ANCESTRY_DEFS[RECRUIT_DEFS[i].ancestry].name, PAL_DIM);
    if (k >= 0) {
      char m[4];
      sprintf(m, "%d", k + 1);
      font_draw_at((float)(x + CARD_W - 3), (float)(y + 2), 1, 0, m, PAL_TOXIC, 255, FONT_OUTLINE, 0, 1);
    }
  }

  /* karta najemnika z obrotem 3D wokół pionowej osi */
  ui_panel(DET_X, DET_Y, DET_W, DET_H, PAL_EDGE);
  if (flip_to >= 0) {
    /* p: 0 = karta płasko, 1 = bokiem. Zwężanie Sine.easeIn (110 ms), rozwijanie Sine.easeOut (140 ms) */
    int u = flip_ms - 110 > 140 ? 140 : flip_ms - 110;
    float p = flip_ms < 110 ? 1 - (float)icos_q14(flip_ms * 64 / 110) / 16384 : 1 - (float)isin_q14(u * 64 / 140) / 16384;
    r2d_scale(1 - p, 1 + 0.04f * p, DET_X + DET_W / 2.0f, DET_Y + DET_H / 2.0f);
    r2d_alpha(255 - (int)(115 * p));
  }
  draw_detail(view);
  r2d_scale(1, 1, 0, 0);
  r2d_alpha(255);

  /* plac z wybranymi */
  for (i = 0; i < RECRUIT_COUNT; i++)
    if (fig_on[i]) {
      r2d_alpha((int)(255 * fig_a[i]));
      portrait(i, 26, (int)fig_x[i], V_H - 26 - 4, i == view ? PAL_EDGE_HI : PAL_EDGE);
    }
  r2d_alpha(255);

  ui_button(8, V_H - 26, 50, 16, "\217 WR\323\306", BTN_PLAIN, focus == 16 + B_BACK, 1);
  ui_button(V_W - 254, V_H - 26, 44, 16, "POMOC", BTN_PLAIN, focus == 16 + B_HELP, 1);
  ui_button(V_W - 204, V_H - 26, 92, 16, "LOSUJ DRU\257YN\312", BTN_PLAIN, focus == 16 + B_RANDOM, 1);
  ui_button(V_W - 106, V_H - 28, 98, 20, "ROZPOCZNIJ \215", BTN_PRIMARY, focus == 16 + B_START, full);
  if (help) draw_help();
  ui_toast_draw();
}

const Screen SCREEN_RECRUIT = {enter, update, draw, leave};
