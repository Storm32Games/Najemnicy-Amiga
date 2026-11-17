/* Przystań (port src/scenes/HubScene.ts): tablica zleceń, handlarz, lecznica, drużyna (ekwipunek), karczma.
 * Logika: core/campaign (refresh_board, shop_*, heal_*, rest_day, hire_recruit), core/rules (equip_item, move_item,
 * use_consumable). Tło 'hub' + mieszkańcy + drużyna przy ognisku wypieczone z gry.
 * Sterowanie: strefa treści zakładki albo menu po prawej (w prawo z ostatniej kolumny / w lewo z menu);
 * góra / dół - wiersze, fire - akcja, Esc - zamknij okno / wróć do tablicy / menu główne.
 * Plik pisany w UTF-8, napisy przekodowuje tools/amiga/latin2_literals.py (po każdej zmianie). */
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
#include "../core/character.h"
#include "../core/rules.h"
#include "../data/gamedata.h"
#include "../data/assets.h"

#define PAL_TOXIC 0x8fd14fUL
#define PAL_BLOOD_ 0xc43d2fUL
#define WX 6
#define WY 22
#define WW 376
#define WH 242
#define BX WX                 /* początek treści zakładki (kontener body) */
#define BY (WY + 20)
#define BH (WH - 20 - 4)
#define SMALL 0.75f
#define TIP_MS 350
#define M 24

enum { TAB_BOARD, TAB_SHOP, TAB_HEAL, TAB_PARTY, TAB_TAVERN, TAB_N };
static const char *const TITLES[TAB_N] = {"TABLICA ZLECE\321", "HANDLARZ NOMAD\323W", "LECZNICA", "DRU\257YNA", "KARCZMA"};
enum { M_TAB0 = 0, M_OPTIONS = TAB_N, M_SAVE, M_LOAD, M_MAIN };
static const char *const OBJECTIVE_TXT[OBJ_COUNT] = {
  "Wyeliminuj wszystkich wrog\363w.", "", "Odnajd\274 i uratuj je\361ca.", "Wytrop i zabij cel polowania.", "Zabij Kostuch\352.",
  "W\263am si\352 do serwera i wr\363\346 z danymi.", "Pokonaj szabrownik\363w i uwolnij osadnik\363w.", "Zniszcz gniazda i wybij zmutowan\261 faun\352.",
  "Odeprzyj kolejne fale napastnik\363w.",
};
static const char *const SLOT_NAME[SLOT_COUNT] = {"Bro\361 g\263\363wna", "Bro\361 zapasowa", "Pancerz", "Tarcza"};
static const char *const DIFF_NAME[4] = {"\243atwe", "Standardowe", "Trudne", "\246miertelne"};
static const uint32_t DIFF_COL[4] = {PAL_GOOD, PAL_AMBER, PAL_BAD, PAL_BAD};

enum { L_SKY, L_CLOUDS, L_FAR, L_MID, L_GROUND, L_NPC, L_PARTY, L_PORTRAITS, L_ICONS, L_N };
static const char *const LAYER[L_N] = {"hub_sky", "hub_clouds", "hub_far", "hub_mid", "hub_ground", "hub_npc", "hub_party", "portraits", "icons"};
static Img img[L_N];
static int loaded;

/* mieszkańcy: x, y, lustro (TownFolk) */
static const int16_t NPC[5][3] = {{392, 226, 0}, {420, 222, 0}, {470, 226, 1}, {448, 220, 1}, {404, 238, 0}};

static TickClock clock;
static BgState bg;
static MoteField dust;
static UnitAnim units;
static UnitPlace place[MAX_PARTY + 5];
static UnitSet party_set, npc_set;
static UnitAnim npc_anim;
static int32_t w_pan;
static Rng rng;

/* stan UI */
static int tab, zone;            /* zone 0 = treść, 1 = menu */
static int menu_ids[12], menu_n, menu_focus;
static int tip_ms;
static int board_sel, board_off;
static int shop_col, shop_row[2], shop_off[2];
static int heal_row;
static int ch_idx, pcol, psub, prow, poff[5];   /* drużyna: kolumna, podstrefa, wiersz, przesunięcia list */
static int tav_row, tav_off;
static UiDialog dlg;
enum { D_NONE, D_HURT, D_PACK, D_QUIT };
static int dlg_kind, dlg_item;
static int main_open, main_focus;
static int pick_open, pick_focus, pick_off, pick_slot;

/* ------------------------------------------------------------------ pomocnicze */
static void signed_str(int v, char *out) { sprintf(out, "%s%d", v >= 0 ? "+" : "", v); }

static void cut(const char *s, int n, char *out, int cap) {
  int len = (int)strlen(s);
  if (len <= n || n < 1) {
    snprintf(out, (size_t)cap, "%s", s);
    return;
  }
  if (n > cap - 1) n = cap - 1;
  memcpy(out, s, (size_t)(n - 1));
  out[n - 1] = (char)0x96;   /* … */
  out[n] = 0;
}

/* tekst przycięty do szerokości px (label z maxW) */
static void text_max(float x, float y, const char *s, uint32_t col, int maxw, float k) {
  char buf[200];
  int n;
  snprintf(buf, sizeof buf, "%s", s);
  n = (int)strlen(buf);
  if (font_measure(buf, 0) * k > maxw) {
    while (n > 1 && font_measure(buf, 0) * k > maxw) {
      buf[--n] = 0;
      buf[n - 1] = (char)0x96;
    }
  }
  font_draw(x, y, buf, col, 255, FONT_OUTLINE, 0, k);
}

static void T(float x, float y, const char *s, uint32_t col) { font_draw(x, y, s, col, 255, FONT_OUTLINE, 0, 1); }
static void TR(float x, float y, const char *s, uint32_t col) { font_draw_at(x, y, 1, 0, s, col, 255, FONT_OUTLINE, 0, 1); }

static void plain_short(const char *s, char *out, int cap) {   /* shortName: pierwsze słowo bez pseudonimu */
  int n = 0, q = 0;
  for (; *s && n < cap - 1; s++) {
    if (*s == '"') { q = !q; continue; }
    if (q) continue;
    if (*s == ' ') {
      if (n) break;
      continue;
    }
    out[n++] = *s;
  }
  out[n] = 0;
}

static uint32_t name_col(const Character *c, uint32_t def) { return c->name_color != COLOR_NONE ? c->name_color : def; }

static void portrait(int recruit, int size, int x, int y, uint32_t frame) {
  int per = size == 40 ? 6 : 8, y0 = size == 40 ? 0 : size == 30 ? 120 : 180;
  if (recruit < RECRUIT_COUNT) img_draw_part(&img[L_PORTRAITS], (recruit % per) * size, y0 + (recruit / per) * size, size, size, (float)x, (float)y, 1, 0, 0xffffff, 255);
  else r2d_rect((float)x, (float)y, (float)size, (float)size, 0x1c1612, 255);
  r2d_frame((float)x, (float)y, (float)size, (float)size, frame, 255);
}

static void item_icon(int item, int size, int x, int y) {
  int per = size == 10 ? 25 : 23, y0 = size == 10 ? 0 : 30;
  if (item >= ITEM_COUNT) return;
  img_draw_part(&img[L_ICONS], (item % per) * size, y0 + (item / per) * size, size, size, (float)x, (float)y, 1, 0, 0xffffff, 255);
}

static void ability_icon(int a, int x, int y) { img_draw_part(&img[L_ICONS], (a % 36) * 7, 63 + (a / 36) * 7, 7, 7, (float)x, (float)y, 1, 0, 0xffffff, 255); }

static void mini_button(int x, int y, int w, const char *text, int kind, int focus, int enabled) { ui_button(x, y, w, 11, text, kind, focus, enabled); }

/* itemRow(): tło, ikona, nazwa (×N), krótka statystyka albo `extra` */
static void item_row(int x, int y, int w, int item, int qty, const char *extra, int focus) {
  char name[64], nm[64], stat[64], st[32];
  int nw;
  r2d_rect((float)x, (float)y, (float)w, 12, focus ? 0x3a2c1e : 0, focus ? 255 : 64);
  if (focus) r2d_frame((float)x, (float)y, (float)w, 12, PAL_EDGE_HI, 255);
  item_icon(item, 10, x + 1, y + 1);
  if (qty > 1) snprintf(name, sizeof name, "%s \327%d", ITEM_DEFS[item].name, qty);
  else snprintf(name, sizeof name, "%s", ITEM_DEFS[item].name);
  cut(name, 24, nm, sizeof nm);
  T((float)(x + 14), (float)(y + 2), nm, PAL_TEXT);
  nw = font_measure(nm, 0);
  if (extra && *extra) snprintf(stat, sizeof stat, "%s", extra);
  else item_stat_line(item, 1, stat, sizeof stat);
  if (*stat && strcmp(stat, " ")) {
    cut(stat, 14, st, sizeof st);
    T((float)(x + 14 + nw + 4), y + 2.5f, st, PAL_DIM);
  }
}

/* ------------------------------------------------------------------ menu po prawej */
static int tavern_open(void) {
  int i;
  if (g_camp.n_party < MAX_PARTY) return 1;
  for (i = 0; i < g_camp.n_party; i++) if (is_dead(&g_camp.party[i])) return 1;
  return 0;
}

static void build_menu(void) {
  int t;
  menu_n = 0;
  for (t = 0; t < TAB_N; t++) if (t != TAB_TAVERN || tavern_open()) menu_ids[menu_n++] = t;
  menu_ids[menu_n++] = M_OPTIONS;
  menu_ids[menu_n++] = M_SAVE;
  menu_ids[menu_n++] = M_LOAD;
  menu_ids[menu_n++] = M_MAIN;
  if (menu_focus >= menu_n) menu_focus = menu_n - 1;
}

static void open_tab(int t) {
  if (tab != t) app_sfx("door", 128, 256);
  tab = t;
  tip_ms = 0;
  build_menu();
}

/* ------------------------------------------------------------------ wejście / wyjście */
static void enter(void) {
  int i;
  loaded = 1;
  for (i = 0; i < L_N; i++)
    if (!img_load(&img[i], LAYER[i])) {
      fprintf(stderr, "Najemnicy: %s\n", img_error());
      loaded = 0;
    }
  game_rng(&rng);
  refresh_board(&g_camp, 0, &rng);
  clock_reset(&clock, 0);
  fx_init();
  bg_init(&bg, &BG_HUB);
  motes_init(&dust, 50, 380, 150, 100, 120, 8, 1, 6, 0.4);
  w_pan = ang_q8(0.045);
  /* drużyna: arkusz hub_party (wiersz = rekrut, 7 na blok 256 px) */
  for (i = 0; i < g_camp.n_party; i++) {
    UnitPlace *u = &place[i];
    u->row = g_camp.party[i].recruit < RECRUIT_COUNT ? g_camp.party[i].recruit : 0;
    u->x = (int16_t)(398 + i * 22);
    u->y = (int16_t)(262 - (i % 2) * 5);
    u->flip = i > 1;
    u->depth10 = 30;
  }
  party_set.fw = 32;
  party_set.fh = 36;
  party_set.n = g_camp.n_party;
  party_set.u = place;
  units_init(&units, &party_set);
  for (i = 0; i < 5; i++) {
    UnitPlace *u = &place[MAX_PARTY + i];
    u->row = (uint8_t)i;
    u->x = NPC[i][0];
    u->y = NPC[i][1];
    u->flip = (uint8_t)NPC[i][2];
    u->depth10 = 20;
  }
  npc_set.fw = 24;
  npc_set.fh = 32;
  npc_set.n = 5;
  npc_set.u = place + MAX_PARTY;
  units_init(&npc_anim, &npc_set);
  tab = TAB_BOARD;
  zone = 0;
  menu_focus = 0;
  board_sel = board_off = 0;
  shop_col = 0;
  memset(shop_row, 0, sizeof shop_row);
  memset(shop_off, 0, sizeof shop_off);
  heal_row = ch_idx = pcol = psub = prow = tav_row = tav_off = 0;
  memset(poff, 0, sizeof poff);
  dlg.open = main_open = pick_open = 0;
  build_menu();
  save_write(0);   /* autozapis przy wejściu do Przystani (Save.write w create) */
  if (g_notice[0]) {
    ui_toast(g_notice, PAL_AMBER);
    g_notice[0] = 0;
  }
}

static void leave(void) {
  int i;
  for (i = 0; i < L_N; i++) img_free(&img[i]);
}

/* ------------------------------------------------------------------ listy treści */
typedef struct { ItemInst *arr; uint8_t *n; int index; char src[24]; } MineRow;
static MineRow mine[MAX_STASH + MAX_PARTY * INV_MAX];

static int mine_rows(void) {
  int n = 0, i, k;
  for (i = 0; i < g_camp.n_stash; i++) {
    mine[n].arr = g_camp.stash;
    mine[n].n = &g_camp.n_stash;
    mine[n].index = i;
    snprintf(mine[n].src, sizeof mine[n].src, "Skrytka");
    n++;
  }
  for (k = 0; k < g_camp.n_party; k++)
    for (i = 0; i < g_camp.party[k].n_inv; i++) {
      mine[n].arr = g_camp.party[k].inv;
      mine[n].n = &g_camp.party[k].n_inv;
      mine[n].index = i;
      plain_short(g_camp.party[k].name, mine[n].src, sizeof mine[n].src);
      n++;
    }
  return n;
}

static uint8_t stock[ITEM_COUNT];
static int stock_n(void) { return shop_stock(g_camp.day, campaign_party_level(&g_camp), stock); }

static uint8_t tav[RECRUIT_COUNT];

/* drużyna: długości list w kolumnach */
static int plen(int col, int sub) {
  const Character *ch = &g_camp.party[ch_idx];
  if (col == 0) return g_camp.n_party;
  if (col == 1) return sub == 0 ? SKILL_COUNT : SLOT_COUNT;
  return sub == 0 ? ch->n_abilities : sub == 1 ? ch->n_inv : g_camp.n_stash;
}
static int pcount(int col) { return col == 0 ? 1 : col == 1 ? 2 : 3; }

/* ------------------------------------------------------------------ akcje */
static void toast_bad(const char *s) {
  app_sfx("error", 256, 256);
  ui_toast(s, PAL_BAD);
}

static void accept_contract(void) {
  char body[256] = "", nm[40];
  int i, alive = 0, hurt = 0;
  for (i = 0; i < g_camp.n_party; i++) {
    const Character *c = &g_camp.party[i];
    if (is_dead(c) || c->hp <= 0) continue;
    alive++;
    if (c->hp * 10 < c->max_hp * 6) {
      plain_short(c->name, nm, sizeof nm);   /* plainName: tu wystarczy imię */
      if (hurt++) strncat(body, ", ", sizeof body - strlen(body) - 1);
      strncat(body, nm, sizeof body - strlen(body) - 1);
    }
  }
  if (!alive) {
    toast_bad("Brak sprawnych najemnik\363w!");
    return;
  }
  if (hurt) {
    static const char *const B[2] = {"WR\323\306 DO PRZYSTANI", "WYRUSZAMY"};
    static const int K[2] = {BTN_PLAIN, BTN_PRIMARY};
    strncat(body, " \200 nie w pe\263ni si\263. Wyruszy\346 mimo to?", sizeof body - strlen(body) - 1);
    ui_dialog_open(&dlg, "RANNI NAJEMNICY", body, 2, B, K, 1);
    dlg_kind = D_HURT;
    return;
  }
  app_sfx("door", 256, 256);
  g_job = board_sel;
  app_switch(SCR_TRAVEL, 400, 500);
}

static void content_ok(void) {
  Character *ch = &g_camp.party[ch_idx];
  int n, i;
  switch (tab) {
    case TAB_BOARD:
      if (g_camp.n_contracts) accept_contract();
      return;
    case TAB_SHOP:
      if (shop_col == 0) {
        n = stock_n();
        if (shop_row[0] >= n) return;
        if (!shop_buy(&g_camp, stock[shop_row[0]])) toast_bad("Za ma\263o Z\263omu.");
        else app_sfx("buy", 256, 256);
      } else {
        n = mine_rows();
        if (shop_row[1] >= n) return;
        if (shop_sell(&g_camp, mine[shop_row[1]].arr, mine[shop_row[1]].n, mine[shop_row[1]].index)) app_sfx("coin", 256, 256);
        n = mine_rows();
        if (shop_row[1] >= n && n) shop_row[1] = n - 1;
      }
      return;
    case TAB_HEAL: {
      int total = 0;
      if (heal_row < g_camp.n_party) {
        Character *c = &g_camp.party[heal_row];
        if (is_dead(c) || !heal_cost(c)) return;
        if (!heal_at_clinic(&g_camp, c)) toast_bad("Za ma\263o Z\263omu.");
        else app_sfx("heal", 256, 256);
        return;
      }
      for (i = 0; i < g_camp.n_party; i++) if (!is_dead(&g_camp.party[i])) total += heal_cost(&g_camp.party[i]);
      if (heal_row == g_camp.n_party) {
        if (!total) return;
        if (g_camp.scrap < total) {
          toast_bad("Za ma\263o Z\263omu.");
          return;
        }
        for (i = 0; i < g_camp.n_party; i++) heal_at_clinic(&g_camp, &g_camp.party[i]);
        app_sfx("heal", 256, 256);
      } else {
        char msg[48];
        game_rng(&rng);
        rest_day(&g_camp, &rng);
        app_sfx("heal", 256, 256);
        snprintf(msg, sizeof msg, "Dzie\361 %d. Wypocz\352ci.", g_camp.day);
        ui_toast(msg, PAL_GOOD);
      }
      return;
    }
    case TAB_PARTY:
      if (pcol == 0) {
        ch_idx = prow;
        app_sfx("click", 256, 256);
      } else if (pcol == 1 && psub == 1) {
        pick_open = 1;
        pick_slot = prow;
        pick_focus = pick_off = 0;
      } else if (pcol == 2 && psub == 1 && prow < ch->n_inv) {
        const ItemDef *d = &ITEM_DEFS[ch->inv[prow].id];
        int usable = d->type == ITYPE_CONSUMABLE && d->consumable->effect == CEFFECT_HEAL;
        static const char *const B3[3] = {"ANULUJ", "DO SKRYTKI", "U\257YJ"};
        static const int K3[3] = {BTN_PLAIN, BTN_PLAIN, BTN_PRIMARY};
        ui_dialog_open(&dlg, d->name, usable ? "U\277y\346 teraz albo od\263o\277y\346 do skrytki dru\277yny?" : "Od\263o\277y\346 do skrytki dru\277yny?", usable ? 3 : 2, B3, K3, usable ? 2 : 1);
        dlg_kind = D_PACK;
        dlg_item = prow;
      } else if (pcol == 2 && psub == 2 && prow < g_camp.n_stash) {
        move_item(g_camp.stash, &g_camp.n_stash, prow, ch->inv, &ch->n_inv, INV_MAX, 1);
        if (prow >= g_camp.n_stash && prow) prow--;
      }
      return;
    case TAB_TAVERN:
      n = tavern_recruits(&g_camp, tav);
      if (tav_row >= n) return;
      game_rng(&rng);
      if (g_camp.n_party >= MAX_PARTY) toast_bad("Dru\277yna jest pe\263na.");
      else if (g_camp.scrap < hire_cost(&g_camp)) toast_bad("Za ma\263o Z\263omu.");
      else if (hire_recruit(&g_camp, tav[tav_row], &rng)) {
        app_sfx("buy", 256, 256);
        leave();
        enter();   /* scene.restart: nowa postać przy ognisku */
        open_tab(g_camp.n_party < MAX_PARTY ? TAB_TAVERN : TAB_PARTY);
      }
      return;
  }
}

static void dialog_result(int r) {
  Character *ch = &g_camp.party[ch_idx];
  if (dlg_kind == D_HURT && r == 1) {
    app_sfx("door", 256, 256);
    g_job = board_sel;
    app_switch(SCR_TRAVEL, 400, 500);
  } else if (dlg_kind == D_PACK && r >= 1 && dlg_item < ch->n_inv) {
    if (r == 2) {
      Character *t[1];
      ActionResult res;
      int before = ch->hp;
      char msg[64], nm[32];
      t[0] = ch;
      game_rng(&rng);
      use_consumable(ch, dlg_item, t, 1, &rng, &res);
      app_sfx("heal", 256, 256);
      plain_short(ch->name, nm, sizeof nm);
      snprintf(msg, sizeof msg, "%s: +%d PW", nm, ch->hp - before);
      ui_toast(msg, PAL_GOOD);
    } else move_item(ch->inv, &ch->n_inv, dlg_item, g_camp.stash, &g_camp.n_stash, MAX_STASH, 1);
    if (prow >= ch->n_inv && prow) prow--;
  } else if (dlg_kind == D_QUIT && r == 1) app_switch(SCR_TITLE, 400, 500);
  dlg_kind = D_NONE;
}

/* wybór przedmiotu do gniazda: pierwszy wiersz = założony (Zdejmij), dalej pasujące ze skrytki i plecaka */
typedef struct { ItemInst *arr; uint8_t *n; int index; } PickRow;
static PickRow picks[MAX_STASH + INV_MAX + 1];
static int pick_rows(void) {
  Character *ch = &g_camp.party[ch_idx];
  int n = 0, i;
  static const uint8_t SLOT_TYPE_[SLOT_COUNT] = {ITYPE_WEAPON, ITYPE_WEAPON, ITYPE_ARMOR, ITYPE_SHIELD};
  if (ch->equip[pick_slot].id != ITEM_NONE) {
    picks[n].arr = NULL;
    n++;
  }
  for (i = 0; i < g_camp.n_stash; i++)
    if (ITEM_DEFS[g_camp.stash[i].id].type == SLOT_TYPE_[pick_slot]) {
      picks[n].arr = g_camp.stash;
      picks[n].n = &g_camp.n_stash;
      picks[n++].index = i;
    }
  for (i = 0; i < ch->n_inv; i++)
    if (ITEM_DEFS[ch->inv[i].id].type == SLOT_TYPE_[pick_slot]) {
      picks[n].arr = ch->inv;
      picks[n].n = &ch->n_inv;
      picks[n++].index = i;
    }
  return n;
}

static void pick_ok(void) {
  Character *ch = &g_camp.party[ch_idx];
  int n = pick_rows();
  if (pick_focus >= n) {
    pick_open = 0;   /* Zamknij */
    return;
  }
  if (!picks[pick_focus].arr) unequip_item(ch, pick_slot, g_camp.stash, &g_camp.n_stash, MAX_STASH);
  else {
    int had_shield = ch->equip[SLOT_SHIELD].id != ITEM_NONE;
    const PickRow *p = &picks[pick_focus];
    if (pick_slot == SLOT_SHIELD && is_two_handed(ch->equip[SLOT_WEAPON].id)) {
      toast_bad("Bro\361 dwur\352czna: nie mo\277na trzyma\346 tarczy.");
      return;
    }
    if (!equip_item(ch, pick_slot, p->arr, p->n, p->index, g_camp.stash, &g_camp.n_stash, MAX_STASH)) {
      toast_bad("Ten przedmiot nie pasuje do tego miejsca.");
      return;
    }
    if (had_shield && ch->equip[SLOT_SHIELD].id == ITEM_NONE) ui_toast("Bro\361 dwur\352czna: tarcza trafi\263a do skrytki.", PAL_AMBER);
  }
  app_sfx("pickup", 256, 256);
  pick_open = 0;
}

static void main_ok(void) {
  switch (main_focus) {
    case 0: saveui_open(0); break;
    case 1: saveui_open(1); break;
    case 2:
      save_write(0);
      app_switch(SCR_TITLE, 400, 500);
      break;
    case 3: {
      static const char *const B[2] = {"ZOSTA\321", "WYJD\254 BEZ ZAPISU"};
      static const int K[2] = {BTN_PLAIN, BTN_DANGER};
      ui_dialog_open(&dlg, "WYJ\246\306 BEZ ZAPISU?", "Zmiany od ostatniego zapisu zostan\261 utracone.", 2, B, K, 0);
      dlg_kind = D_QUIT;
      break;
    }
    default: break;
  }
  main_open = 0;
}

/* ------------------------------------------------------------------ nawigacja */
static void nav_content(unsigned p) {
  int n, moved = 1;
  switch (tab) {
    case TAB_BOARD:
      n = g_camp.n_contracts;
      if (p & IN_UP && board_sel > 0) board_sel--;
      else if (p & IN_DOWN && board_sel < n - 1) board_sel++;
      else if (p & IN_RIGHT) zone = 1;
      else moved = 0;
      break;
    case TAB_SHOP:
      n = shop_col ? mine_rows() : stock_n();
      if (p & IN_UP && shop_row[shop_col] > 0) shop_row[shop_col]--;
      else if (p & IN_DOWN && shop_row[shop_col] < n - 1) shop_row[shop_col]++;
      else if (p & IN_LEFT && shop_col) shop_col = 0;
      else if (p & IN_RIGHT) {
        if (shop_col) zone = 1;
        else shop_col = 1;
      } else moved = 0;
      break;
    case TAB_HEAL:
      if (p & IN_UP && heal_row > 0) heal_row--;
      else if (p & IN_DOWN && heal_row < g_camp.n_party + 1) heal_row++;
      else if (p & IN_RIGHT) zone = 1;
      else moved = 0;
      break;
    case TAB_PARTY:
      n = plen(pcol, psub);
      if (p & IN_UP) {
        if (prow > 0) prow--;
        else if (psub > 0) {
          psub--;
          prow = plen(pcol, psub) - 1;
          if (prow < 0) prow = 0;
        } else moved = 0;
      } else if (p & IN_DOWN) {
        if (prow < n - 1) prow++;
        else if (psub < pcount(pcol) - 1) {
          psub++;
          prow = 0;
        } else moved = 0;
      } else if (p & IN_LEFT && pcol > 0) {
        pcol--;
        psub = pcol == 1 ? 1 : 0;
        prow = pcol == 0 ? ch_idx : 0;
      } else if (p & IN_RIGHT) {
        if (pcol == 2) zone = 1;
        else {
          pcol++;
          psub = pcol == 1 ? 1 : 1;   /* ekwipunek / plecak */
          prow = 0;
        }
      } else moved = 0;
      if (pcol == 0) ch_idx = prow;
      break;
    case TAB_TAVERN:
      n = tavern_recruits(&g_camp, tav);
      if (p & IN_UP && tav_row > 0) tav_row--;
      else if (p & IN_DOWN && tav_row < n - 1) tav_row++;
      else if (p & IN_RIGHT) zone = 1;
      else moved = 0;
      break;
  }
  if (moved) {
    tip_ms = 0;
    app_sfx("hover", 256, 256);
  }
}

static void update(unsigned held, unsigned pressed, int ms) {
  int n;
  (void)held;
  for (n = clock_advance(&clock, ms, 10); n > 0; n--) {
    motes_step(&dust);
    bg_tick(&bg);
  }
  units_update(&units, &party_set, ms);
  units_update(&npc_anim, &npc_set, ms);
  ui_toast_update(ms);
  tip_ms += ms;
  if (app_leaving() || !pressed) return;
  if (saveui_is_open()) {
    if (saveui_input(pressed) > 0 && saveui_loading()) save_enter_loaded();   /* misja w toku albo Przystań od nowa */
    return;
  }
  if (dlg.open) {
    int r = ui_dialog_input(&dlg, pressed);
    if (r >= 0) dialog_result(r);
    return;
  }
  if (main_open) {
    if (pressed & IN_UP && main_focus > 0) main_focus--;
    else if (pressed & IN_DOWN && main_focus < 4) main_focus++;
    else if (pressed & IN_BACK) main_open = 0;
    else if (pressed & IN_OK) main_ok();
    return;
  }
  if (pick_open) {
    int rows = pick_rows();
    if (pressed & IN_UP && pick_focus > 0) pick_focus--;
    else if (pressed & IN_DOWN && pick_focus < rows) pick_focus++;
    else if (pressed & IN_BACK) pick_open = 0;
    else if (pressed & IN_OK) pick_ok();
    tip_ms = 0;
    return;
  }
  if (pressed & IN_BACK) {
    if (tab != TAB_BOARD) open_tab(TAB_BOARD);
    else {
      main_open = 1;
      main_focus = 4;
    }
    return;
  }
  if (zone == 1) {
    if (pressed & IN_UP && menu_focus > 0) menu_focus--;
    else if (pressed & IN_DOWN && menu_focus < menu_n - 1) menu_focus++;
    else if (pressed & IN_LEFT) zone = 0;
    else if (pressed & IN_OK) {
      int id = menu_ids[menu_focus];
      app_sfx("click", 256, 256);
      if (id < TAB_N) {
        open_tab(id);
        zone = 0;
      } else if (id == M_OPTIONS) ui_toast("Opcje nie s\261 jeszcze przeniesione na Amig\352.", PAL_AMBER);
      else if (id == M_SAVE || id == M_LOAD) saveui_open(id == M_LOAD);
      else {
        main_open = 1;
        main_focus = 4;
      }
    }
    return;
  }
  if (pressed & IN_OK) content_ok();
  else nav_content(pressed);
}

/* ------------------------------------------------------------------ rysowanie: rama */
static void draw_top(void) {
  const CampaignState *st = &g_camp;
  char v[48];
  float x = 8;
#define PUT(k, val, col) do { if (*(k)) { T(x, 4, k, PAL_TEXT); x += font_measure(k, 0); } T(x, 4, val, col); x += font_measure(val, 0) + 14; } while (0)
  r2d_rect(0, 0, V_W, 17, PAL_PANEL, 242);
  r2d_rect(0, 17, V_W, 1, PAL_EDGE, 255);
  PUT("", "PRZYSTA\321", PAL_AMBER);
  sprintf(v, "%d", st->scrap);
  PUT("Z\263om: ", v, PAL_AMBER);
  sprintf(v, "%d", st->day);
  PUT("Dzie\361: ", v, PAL_TEXT);
  signed_str(st->rep[FACTION_NOMADS], v);
  PUT("Nomadzi: ", v, st->rep[FACTION_NOMADS] >= 0 ? PAL_GOOD : PAL_BAD);
  signed_str(st->rep[FACTION_SURVIVORS], v);
  PUT("Ocaleni: ", v, st->rep[FACTION_SURVIVORS] >= 0 ? PAL_GOOD : PAL_BAD);
#undef PUT
  snprintf(v, sizeof v, "Poziom dru\277yny: %d \205 Uko\361czone: %d", campaign_party_level(st), st->n_completed);
  TR(V_W - 8, 5, v, PAL_DIM);
}

static void draw_menu(void) {
  int i, y = 22, story = 0;
  char buf[48];
  for (i = 0; i < g_camp.n_contracts; i++) if (g_camp.contracts[i].story >= 0) story = 1;
  for (i = 0; i < menu_n; i++) {
    int id = menu_ids[i], kind = BTN_PLAIN;
    const char *t = buf;
    if (id == M_OPTIONS) y += 6;
    switch (id) {
      case TAB_BOARD: snprintf(buf, sizeof buf, "TABLICA ZLECE\321%s", story ? " \214" : ""); break;
      case TAB_SHOP: t = "HANDLARZ"; break;
      case TAB_HEAL: t = "LECZNICA"; break;
      case TAB_PARTY: t = "DRU\257YNA"; break;
      case TAB_TAVERN: t = "KARCZMA"; kind = tab != TAB_TAVERN ? BTN_DANGER : BTN_PLAIN; break;
      case M_OPTIONS: t = "OPCJE"; break;
      case M_SAVE: t = "ZAPISZ GR\312"; break;
      case M_LOAD: t = "WCZYTAJ GR\312"; break;
      default: t = "MENU G\243\323WNE"; break;
    }
    if (id < TAB_N && id == tab) kind = BTN_PRIMARY;
    ui_button(388, y, 86, 15, t, kind, zone == 1 && i == menu_focus, 1);
    y += 19;
  }
}

/* ------------------------------------------------------------------ zakładki */
static int ctx_tip_x, ctx_tip_y;
static char ctx_tip[600];

static void set_tip(int x, int y, const char *s) {
  ctx_tip_x = x;
  ctx_tip_y = y;
  snprintf(ctx_tip, sizeof ctx_tip, "%s", s);
}

static void draw_board(void) {
  const CampaignState *st = &g_camp;
  const int LW = 168, X = BX + 6, Y = BY, VIS = 6, DX = BX + LW + 14, DW = WW - (LW + 14) - 8;
  int lvl = campaign_party_level(st), n = st->n_contracts, i, y, w;
  char buf[256], buf2[128];
  const Contract *cur;
  if (board_sel >= n) board_sel = n ? n - 1 : 0;
  board_off = ui_scroll_follow(board_off, board_sel, n, VIS);
  w = LW - (n > VIS ? 5 : 0);
  for (i = 0; i < VIS && board_off + i < n; i++) {
    const Contract *c = &st->contracts[board_off + i];
    int on = board_off + i == board_sel, d = difficulty_of(c->level, lvl), ry = Y + i * 30, rw;
    r2d_rect((float)X, (float)ry, (float)w, 27, on ? 0x3a2c1e : PAL_PANEL2, 255);
    r2d_frame((float)X, (float)ry, (float)w, 27, on ? PAL_EDGE_HI : c->story >= 0 ? PAL_BLOOD_ : PAL_EDGE, 255);
    snprintf(buf2, sizeof buf2, "%d Z", c->reward_scrap);
    rw = font_measure(buf2, 0);
    TR((float)(X + w - 4), (float)(ry + 1), buf2, PAL_AMBER);
    snprintf(buf, sizeof buf, "%s%s", c->story >= 0 ? "\214 " : "", c->title);
    text_max((float)(X + 4), (float)(ry + 1), buf, c->story >= 0 ? PAL_AMBER : PAL_TEXT, w - 12 - rw, 1);
    snprintf(buf, sizeof buf, "%s \205 %s", c->giver, FACTION_NAMES[c->faction]);
    text_max((float)(X + 4), (float)(ry + 10), buf, PAL_DIM, w - 8, 1);
    rw = font_measure(DIFF_NAME[d], 0);
    TR((float)(X + w - 4), (float)(ry + 18), DIFF_NAME[d], DIFF_COL[d]);
    snprintf(buf, sizeof buf, "%s \205 poz. %d \205 %s", OBJECTIVE_NAMES[c->type], c->level, BIOME_NAMES[c->biome]);
    text_max((float)(X + 4), (float)(ry + 18), buf, PAL_TOXIC, w - 12 - rw, 1);
  }
  ui_scrollbar(X, Y, LW, 180, n, VIS, board_off);
  if (!n) ui_text(X + 2, Y + 4, "Tablica jest pusta. Odpocznij, a kto\266 co\266 dopisze.", PAL_DIM, LW - 8, 0, 0);
  if (st->story >= STORY_CONTRACT_COUNT) snprintf(buf, sizeof buf, "Kostucha nie \277yje.");
  else snprintf(buf, sizeof buf, "Kolejne zlecenie fabularne: %d uko\361czone zlecenia i %d pkt reputacji.", STORY_NEED[st->story].completed, STORY_NEED[st->story].rep);
  ui_text(X, Y + 186, buf, PAL_DIM, LW, 0, 0);
  /* szczegóły */
  r2d_rect((float)(DX - 4), (float)Y, (float)(DW + 8), BH - 2, 0, 64);
  r2d_frame((float)(DX - 4), (float)Y, (float)(DW + 8), BH - 2, PAL_EDGE, 255);
  if (!n) {
    T((float)DX, (float)(Y + 6), "Wybierz zlecenie z listy.", PAL_DIM);
    return;
  }
  cur = &st->contracts[board_sel];
  {
    int d = difficulty_of(cur->level, lvl), descy, k, j;
    char foes[200] = "";
    text_max((float)DX, (float)(Y + 4), cur->title, PAL_AMBER, DW, 1);
    snprintf(buf, sizeof buf, "Zleceniodawca: %s (%s)", cur->giver, FACTION_NAMES[cur->faction]);
    descy = 6 + FONT_LINE_H + ui_text(DX, Y + 6 + FONT_LINE_H, buf, PAL_DIM, DW, 0, 0) + 3;
    y = descy + ui_text(DX, Y + descy, cur->desc, PAL_TEXT, DW, 2, 0) + 6;
    if (y < 66) y = 66;
#define ROW(k, v, col) do { int kw_ = font_measure(k, 0); T((float)DX, (float)(Y + y), k, PAL_DIM); { int h_ = ui_text(DX + kw_, Y + y, v, col, DW - kw_, 0, 0); y += h_ + 2 > 10 ? h_ + 2 : 10; } } while (0)
    if (cur->type == OBJ_RETRIEVE) snprintf(buf, sizeof buf, "Odzyskaj: %s.", cur->obj_item < ITEM_COUNT ? ITEM_DEFS[cur->obj_item].name : "");
    else snprintf(buf, sizeof buf, "%s", OBJECTIVE_TXT[cur->type]);
    ROW("Cel: ", buf, PAL_TEXT);
    snprintf(buf, sizeof buf, "%s, %s", BIOME_NAMES[cur->biome], MOOD_NAMES[cur->mood]);
    ROW("Miejsce: ", buf, PAL_TEXT);
    snprintf(buf, sizeof buf, "%s (zlecenie poz. %d vs dru\277yna %d)", DIFF_NAME[d], cur->level, lvl);
    ROW("Trudno\266\346: ", buf, DIFF_COL[d]);
    snprintf(buf, sizeof buf, "%d dn.", cur->travel_days ? cur->travel_days : 1);
    ROW("Podr\363\277: ", buf, PAL_TEXT);
    /* zwiad: liczba wrogów każdego rodzaju w kolejności pierwszego wystąpienia */
    for (k = 0; k < cur->n_enemies; k++) {
      int seen = 0, cnt = 0;
      for (j = 0; j < k; j++) if (!strcmp(ENEMY_DEFS[cur->enemies[j]].name, ENEMY_DEFS[cur->enemies[k]].name)) seen = 1;
      if (seen) continue;
      for (j = k; j < cur->n_enemies; j++) if (!strcmp(ENEMY_DEFS[cur->enemies[j]].name, ENEMY_DEFS[cur->enemies[k]].name)) cnt++;
      snprintf(buf2, sizeof buf2, "%s%d\327 %s", *foes ? ", " : "", cnt, ENEMY_DEFS[cur->enemies[k]].name);
      strncat(foes, buf2, sizeof foes - strlen(foes) - 1);
    }
    ROW("Zwiad: ", foes, PAL_TEXT);
    y += 2;
    snprintf(buf, sizeof buf, "%d Z\263omu \205 %d PD", cur->reward_scrap, cur->reward_xp);
    for (k = 0; k < cur->n_reward_items; k++) {
      strncat(buf, " \205 ", sizeof buf - strlen(buf) - 1);
      strncat(buf, ITEM_DEFS[cur->reward_items[k]].name, sizeof buf - strlen(buf) - 1);
    }
    for (k = 0; k < FACTION_COUNT; k++)
      if (cur->reward_rep[k]) {
        char r[8];
        signed_str(cur->reward_rep[k], r);
        snprintf(buf2, sizeof buf2, " \205 %s %s", k == FACTION_NOMADS ? "Nomadzi" : "Ocaleni", r);
        strncat(buf, buf2, sizeof buf - strlen(buf) - 1);
      }
    ROW("Nagroda: ", buf, PAL_AMBER);
#undef ROW
    ui_button(DX + DW - 120, Y + BH - 26, 120, 20, "PRZYJMIJ ZLECENIE \215", BTN_PRIMARY, zone == 0, 1);
  }
}

static void draw_shop(void) {
  const CampaignState *st = &g_camp;
  const int CW = 178, X = BX + 6, Y = BY, VIS = 14, RX = BX + CW + 17;
  int n = stock_n(), m, i, w, off;
  char buf[96], tip[600];
  snprintf(buf, sizeof buf, "TOWARY (rabat %d%%)", (int)(nomad_discount(st) * 100 + 0.5));
  T((float)X, (float)Y, buf, PAL_AMBER);
  if (shop_row[0] >= n) shop_row[0] = n ? n - 1 : 0;
  off = shop_off[0] = ui_scroll_follow(shop_off[0], shop_row[0], n, VIS);
  w = CW - (n > VIS ? 5 : 0);
  for (i = 0; i < VIS && off + i < n; i++) {
    int it = stock[off + i], price = buy_price((uint8_t)it, st), foc = zone == 0 && shop_col == 0 && shop_row[0] == off + i, ry = Y + 10 + i * 14;
    item_row(X, ry, w - 40, it, 1, NULL, foc);
    snprintf(buf, sizeof buf, "%d Z", price);
    mini_button(X + w - 38, ry + 1, 38, buf, BTN_PLAIN, foc, st->scrap >= price);
    if (foc) {
      item_tip(it, NULL, tip, sizeof tip);
      set_tip(X + 20, ry, tip);
    }
  }
  ui_scrollbar(X, Y + 10, CW, 196, n, VIS, off);
  r2d_rect((float)(BX + CW + 11), (float)Y, 1, BH - 4, PAL_EDGE, 255);
  T((float)RX, (float)Y, "TWOJE RZECZY (sprzeda\277)", PAL_AMBER);
  m = mine_rows();
  if (shop_row[1] >= m) shop_row[1] = m ? m - 1 : 0;
  off = shop_off[1] = ui_scroll_follow(shop_off[1], shop_row[1], m, VIS);
  w = CW - 6 - (m > VIS ? 5 : 0);
  if (!m) ui_text(RX + 2, Y + 12, "Nic do sprzedania.", PAL_DIM, w - 4, 0, 0);
  for (i = 0; i < VIS && off + i < m; i++) {
    const MineRow *r = &mine[off + i];
    const ItemInst *inst = &r->arr[r->index];
    int price = sell_price(inst->id, st), foc = zone == 0 && shop_col == 1 && shop_row[1] == off + i, ry = Y + 10 + i * 14;
    item_row(RX, ry, w - 44, inst->id, inst->qty, r->src, foc);
    if (price) snprintf(buf, sizeof buf, "+%d Z", price);
    else snprintf(buf, sizeof buf, "\200");
    mini_button(RX + w - 42, ry + 1, 42, buf, BTN_PLAIN, foc, price > 0);
    if (foc) {
      item_tip(inst->id, NULL, tip, sizeof tip);
      set_tip(RX + 20, ry, tip);
    }
  }
  ui_scrollbar(RX, Y + 10, CW - 6, 196, m, VIS, off);
}

static void draw_heal(void) {
  const CampaignState *st = &g_camp;
  const int X = BX, Y = BY, SX = BX + 246;
  int i, total = 0;
  char buf[128], b2[128];
  ui_text(X + 6, Y, "\227Poka\277 r\352k\352. Nie, drug\261. Ta wygl\261da, jakby prze\277y\263a wojn\352.\230 \200 Doktor Mika", PAL_DIM, 230, 0, 0);
  for (i = 0; i < st->n_party; i++) {
    const Character *c = &st->party[i];
    int y = Y + 20 + i * 40, dead = is_dead(c), k = heal_cost(c), j, hp_q12 = c->max_hp > 0 ? (c->hp > 0 ? c->hp : 0) * 4096 / c->max_hp : 0;
    r2d_rect((float)(X + 6), (float)y, 230, 36, PAL_PANEL2, 255);
    r2d_frame((float)(X + 6), (float)y, 230, 36, PAL_EDGE, 255);
    portrait(c->recruit, 30, X + 9, y + 3, PAL_EDGE);
    cut(c->name, 26, buf, sizeof buf);
    T((float)(X + 44), (float)(y + 3), buf, name_col(c, PAL_TEXT));
    snprintf(b2, sizeof b2, "%s poz. %d", CLASS_DEFS[c->class_id].name, c->level);
    {
      int first = 1;
      for (j = 0; j < COND_COUNT; j++)
        if (c->cond[j]) {
          strncat(b2, first ? " \205 " : ", ", sizeof b2 - strlen(b2) - 1);
          strncat(b2, CONDITION_DEFS[j].name, sizeof b2 - strlen(b2) - 1);
          first = 0;
        }
    }
    cut(b2, 42, buf, sizeof buf);
    font_draw((float)(X + 44), (float)(y + 13), buf, PAL_DIM, 255, FONT_OUTLINE, 0, 1);
    ui_bar(X + 44, y + 22, 100, 4, hp_q12, hp_q12 * 100 < 34 * 4096 ? PAL_BAD : PAL_GOOD, 0x3a1410);
    snprintf(buf, sizeof buf, "PW %d/%d", c->hp > 0 ? c->hp : 0, c->max_hp);
    T((float)(X + 148), (float)(y + 20), buf, PAL_TEXT);
    if (dead) snprintf(buf, sizeof buf, "POLEG\243");
    else if (k) snprintf(buf, sizeof buf, "ULECZ (%d Z)", k);
    else snprintf(buf, sizeof buf, "ZDR\323W");
    ui_button(X + 180, y + 4, 52, 13, buf, BTN_PLAIN, zone == 0 && heal_row == i, !dead && k > 0);
    if (!dead) total += k;
  }
  if (total) snprintf(buf, sizeof buf, "ULECZ WSZYSTKICH (%d Z)", total);
  else snprintf(buf, sizeof buf, "WSZYSCY ZDROWI");
  ui_button(SX, Y + 20, 122, 18, buf, BTN_PRIMARY, zone == 0 && heal_row == st->n_party, total > 0);
  r2d_rect((float)SX, (float)(Y + 46), 122, 86, PAL_PANEL2, 255);
  r2d_frame((float)SX, (float)(Y + 46), 122, 86, PAL_EDGE, 255);
  T((float)(SX + 5), (float)(Y + 50), "ODPOCZYNEK", PAL_AMBER);
  ui_text(SX + 5, Y + 62, "Prze\266pij noc w kwaterze: pe\263ne PW i zdolno\266ci, ale mija dzie\361 \200 tablica zlece\361 si\352 zmienia.", PAL_TEXT, 112, 2, 0);
  ui_button(SX + 5, Y + 110, 112, 15, "ODPOCZNIJ (NAST\312PNY DZIE\321)", BTN_PLAIN, zone == 0 && heal_row == st->n_party + 1, 1);
}

static void box(int x, int y, int w, int h, const char *title) {
  r2d_rect((float)x, (float)y, (float)w, (float)h, 0, 64);
  r2d_frame((float)x, (float)y, (float)w, (float)h, PAL_EDGE, 255);
  T((float)(x + 3), (float)(y + 2), title, PAL_AMBER);
}

static void kv(int x, int y, int w, const char *k, const char *v, uint32_t col) {
  T((float)x, (float)y, k, PAL_DIM);
  TR((float)(x + w), (float)y, v, col);
}

static int pfoc(int col, int sub, int row) { return zone == 0 && pcol == col && psub == sub && prow == row; }

static void draw_party(void) {
  CampaignState *st = &g_camp;
  const int X = BX, Y = BY, X0 = BX + 48, Y0 = BY + 46;
  const int C1 = X0, W1 = 92, C2 = C1 + W1 + 4, W2 = 112, C3 = C2 + W2 + 4, W3 = BX + WW - C3 - 6;
  const Character *ch;
  char buf[160], v[24], tip[600];
  int i, n, off, w;
  if (ch_idx >= st->n_party) ch_idx = 0;
  ch = &st->party[ch_idx];
  for (i = 0; i < st->n_party; i++) {
    const Character *c = &st->party[i];
    int y = Y + i * 46, on = i == ch_idx;
    char nm[32], cn[32];
    r2d_rect((float)(X + 6), (float)y, 36, 43, on ? 0x3a2c1e : PAL_PANEL2, 255);
    r2d_frame((float)(X + 6), (float)y, 36, 43, on || pfoc(0, 0, i) ? PAL_AMBER : PAL_EDGE, 255);
    if (pfoc(0, 0, i)) r2d_frame((float)(X + 5), (float)(y - 1), 38, 45, PAL_EDGE_HI, 200);
    portrait(c->recruit, 30, X + 9, y + 3, PAL_EDGE);
    plain_short(c->name, nm, sizeof nm);
    cut(nm, 8, cn, sizeof cn);
    font_draw_at((float)(X + 24), (float)(y + 35), 0.5f, 0, cn, name_col(c, PAL_TEXT), 255, FONT_OUTLINE, 0, 1);
  }
  /* nagłówek */
  portrait(ch->recruit, 40, X0, Y, PAL_EDGE);
  cut(ch->name, 26, buf, sizeof buf);
  T((float)(X0 + 46), (float)Y, buf, name_col(ch, PAL_AMBER));
  snprintf(buf, sizeof buf, "%s \205 %s \205 poz. %d", CLASS_DEFS[ch->class_id].name, ANCESTRY_DEFS[ch->ancestry].name, ch->level);
  T((float)(X0 + 46), (float)(Y + 13), buf, PAL_AMBER);
  T((float)(X0 + 46), (float)(Y + 24), "PD", PAL_DIM);
  ui_bar(X0 + 60, Y + 26, 90, 4, ch->xp * 4096 / XP_PER_LEVEL, PAL_AMBER, 0x3a2c10);
  snprintf(buf, sizeof buf, "%d/%d", ch->xp, XP_PER_LEVEL);
  T((float)(X0 + 154), (float)(Y + 24), buf, PAL_TEXT);
  T((float)(X0 + 46), (float)(Y + 33), "PW", PAL_DIM);
  {
    int hp = ch->max_hp > 0 ? (ch->hp > 0 ? ch->hp : 0) * 4096 / ch->max_hp : 0;
    ui_bar(X0 + 60, Y + 35, 90, 4, hp, hp * 100 < 34 * 4096 ? PAL_BAD : PAL_GOOD, 0x3a1410);
  }
  snprintf(buf, sizeof buf, "%d/%d", ch->hp > 0 ? ch->hp : 0, ch->max_hp);
  T((float)(X0 + 154), (float)(Y + 33), buf, PAL_TEXT);
  /* kolumna 1: cechy, obrona */
  box(C1, Y0, W1, 62, "CECHY");
  for (i = 0; i < ATTR_COUNT; i++) {
    signed_str(ch->attrs[i], v);
    kv(C1 + 4, Y0 + 11 + i * 8, W1 - 8, ATTR_NAMES[i], v, ch->attrs[i] > 0 ? PAL_GOOD : ch->attrs[i] < 0 ? PAL_BAD : PAL_TEXT);
  }
  box(C1, Y0 + 65, W1, 70, "OBRONA");
  {
    static const char *const K[7] = {"KP", "Percepcja", "Wytrzyma\263o\266\346", "Refleks", "Wola", "KT klasy", "Pr\352dko\266\346"};
    static const int S[7] = {STAT_AC, STAT_PERCEPTION, STAT_FORT, STAT_REF, STAT_WILL, STAT_CLASS_DC, STAT_SPEED};
    for (i = 0; i < 7; i++) {
      int val = get_stat(ch, S[i], 0);
      if (i == 0 || i == 5) sprintf(v, "%d", val);
      else if (i == 6) sprintf(v, "%d p\363l", val);
      else signed_str(val, v);
      kv(C1 + 4, Y0 + 76 + i * 8, W1 - 8, K[i], v, i == 0 ? PAL_AMBER : PAL_TEXT);
    }
  }
  /* kolumna 2: umiejętności (lista z przewijaniem), ekwipunek */
  box(C2, Y0, W2, 100, "UMIEJ\312TNO\246CI");
  n = SKILL_COUNT;   /* Object.keys(SKILLS); percepcja z rangą prof.perception */
  off = poff[0] = ui_scroll_follow(poff[0], pcol == 1 && psub == 0 ? prow : poff[0], n, 11);
  w = W2 - 5 - (n > 11 ? 5 : 0);
  for (i = 0; i < 11 && off + i < n; i++) {
    int s = off + i, rank, val, y = Y0 + 11 + i * 8;
    const char *name;
    char pr[8];
    name = SKILL_DEFS[s].name;
    if (s == SKILL_PERCEPTION) {
      rank = ch->prof.perception;
      val = get_stat(ch, STAT_PERCEPTION, 0);
    } else {
      rank = ch->prof.skills[s];
      val = get_stat(ch, s, 0);
    }
    if (pfoc(1, 0, s)) r2d_rect((float)(C2 + 2), (float)(y - 1), (float)(w + 2), 9, 0x3a2c1e, 255);
    T((float)(C2 + 3), (float)y, name, rank ? PAL_TEXT : 0x6a5f4c);
    signed_str(val, v);
    TR((float)(C2 + 3 + w - 1), (float)y, v, rank ? PAL_TEXT : 0x6a5f4c);
    snprintf(pr, 5, "%s", PROF_NAMES[rank]);
    TR((float)(C2 + 3 + w - 16), y + 0.5f, pr, PAL_DIM);
  }
  ui_scrollbar(C2 + 3, Y0 + 11, W2 - 5, 88, n, 11, off);
  box(C2, Y0 + 103, W2, 66, "EKWIPUNEK");
  for (i = 0; i < SLOT_COUNT; i++) {
    int y = Y0 + 113 + i * 14, it = ch->equip[i].id, foc = pfoc(1, 1, i);
    r2d_rect((float)(C2 + 2), (float)y, (float)(W2 - 4), 13, foc ? 0x3a2c1e : 0, foc ? 255 : 77);
    r2d_frame((float)(C2 + 2), (float)y, (float)(W2 - 4), 13, foc ? PAL_EDGE_HI : PAL_EDGE, 255);
    if (it != ITEM_NONE) {
      item_icon(it, 11, C2 + 3, y + 1);
      cut(ITEM_DEFS[it].name, 22, buf, sizeof buf);
      T((float)(C2 + 16), (float)(y + 3), buf, PAL_TEXT);
      if (foc) {
        char t2[560];
        item_tip(it, NULL, t2, sizeof t2);
        snprintf(tip, sizeof tip, "%s\n%s", SLOT_NAME[i], t2);
        set_tip(C2 + 20, y, tip);
      }
    } else {
      char low[32];
      int k;
      snprintf(low, sizeof low, "%s", SLOT_NAME[i]);
      for (k = 0; low[k]; k++) if (low[k] >= 'A' && low[k] <= 'Z') low[k] = (char)(low[k] + 32);   /* nazwy gniazd: wielka tylko pierwsza (ASCII) */
      snprintf(buf, sizeof buf, "\200 %s \200", low);
      T((float)(C2 + 16), (float)(y + 3), buf, PAL_DIM);
    }
  }
  /* kolumna 3: zdolności, plecak, skrytka */
  box(C3, Y0, W3, 62, "ZDOLNO\246CI");
  n = ch->n_abilities;
  off = poff[1] = ui_scroll_follow(poff[1], pcol == 2 && psub == 0 ? prow : poff[1], n, 6);
  w = W3 - 5 - (n > 6 ? 5 : 0);
  for (i = 0; i < 6 && off + i < n; i++) {
    const AbilityDef *a = &ABILITY_DEFS[ch->abilities[off + i]];
    int y = Y0 + 11 + i * 8, foc = pfoc(2, 0, off + i);
    char cost[16];
    if (a->actions == ACTIONS_REACTION) snprintf(cost, sizeof cost, "reakcja");
    else if (a->actions == 0) snprintf(cost, sizeof cost, "darmowa");
    else snprintf(cost, sizeof cost, "%d akc.", a->actions);
    if (foc) {
      r2d_rect((float)(C3 + 2), (float)(y - 1), (float)(w + 2), 9, 0x3a2c1e, 255);
      if (a->uses && ch->uses[ch->abilities[off + i]] != USES_UNSET) snprintf(tip, sizeof tip, "%s [%s] \205 %d u\277y\346\n%s", a->name, cost, ch->uses[ch->abilities[off + i]], a->desc);
      else snprintf(tip, sizeof tip, "%s [%s]\n%s", a->name, cost, a->desc);
      set_tip(C3 + 20, y, tip);
    }
    ability_icon(ch->abilities[off + i], C3 + 3, y);
    cut(a->name, 13, buf, sizeof buf);
    T((float)(C3 + 12), (float)y, buf, PAL_TOXIC);
    TR((float)(C3 + 3 + w - 1), y + 0.5f, cost, PAL_DIM);
  }
  ui_scrollbar(C3 + 3, Y0 + 11, W3 - 5, 50, n, 6, off);
  box(C3, Y0 + 65, W3, 50, "PLECAK");
  n = ch->n_inv;
  off = poff[2] = ui_scroll_follow(poff[2], pcol == 2 && psub == 1 ? prow : poff[2], n, 3);
  w = W3 - 3 - (n > 3 ? 5 : 0);
  if (!n) T((float)(C3 + 4), (float)(Y0 + 77), "Pusty.", PAL_DIM);
  for (i = 0; i < 3 && off + i < n; i++) {
    const ItemInst *inst = &ch->inv[off + i];
    const ItemDef *d = &ITEM_DEFS[inst->id];
    int usable = d->type == ITYPE_CONSUMABLE && d->consumable->effect == CEFFECT_HEAL, y = Y0 + 75 + i * 13, foc = pfoc(2, 1, off + i);
    item_row(C3 + 2, y, w - (usable ? 40 : 14), inst->id, inst->qty, " ", foc);
    if (usable) mini_button(C3 + 2 + w - 39, y + 1, 24, "U\257YJ", BTN_PLAIN, foc, 1);
    mini_button(C3 + 2 + w - 13, y + 1, 13, "\222", BTN_PLAIN, foc, 1);
    if (foc) {
      item_tip(inst->id, NULL, tip, sizeof tip);
      set_tip(C3 + 20, y, tip);
    }
  }
  ui_scrollbar(C3 + 2, Y0 + 75, W3 - 3, 39, n, 3, off);
  box(C3, Y0 + 118, W3, 51, "SKRYTKA DRU\257YNY");
  n = st->n_stash;
  off = poff[3] = ui_scroll_follow(poff[3], pcol == 2 && psub == 2 ? prow : poff[3], n, 3);
  w = W3 - 3 - (n > 3 ? 5 : 0);
  if (!n) T((float)(C3 + 4), (float)(Y0 + 130), "Pusta.", PAL_DIM);
  for (i = 0; i < 3 && off + i < n; i++) {
    const ItemInst *inst = &st->stash[off + i];
    int y = Y0 + 128 + i * 13, foc = pfoc(2, 2, off + i);
    item_row(C3 + 2, y, w - 14, inst->id, inst->qty, " ", foc);
    mini_button(C3 + 2 + w - 13, y + 1, 13, "\223", BTN_PLAIN, foc, 1);
    if (foc) {
      item_tip(inst->id, NULL, tip, sizeof tip);
      set_tip(C3 + 20, y, tip);
    }
  }
  ui_scrollbar(C3 + 2, Y0 + 128, W3 - 3, 39, n, 3, off);
}

static void draw_tavern(void) {
  CampaignState *st = &g_camp;
  const int X = BX + 6, Y = BY, VIS = 5;
  int cost = hire_cost(st), lvl = campaign_party_level(st), slots = MAX_PARTY - st->n_party, n, i, w;
  char buf[256], b2[256];
  if (slots > 0) snprintf(buf, sizeof buf, "W dru\277ynie brakuje %d os. Najemnicy \277\261daj\261 %d Z\263omu za podpis.", slots, cost);
  else snprintf(buf, sizeof buf, "Dru\277yna kompletna.");
  T((float)X, (float)Y, buf, PAL_DIM);
  if (st->n_fallen) {
    snprintf(b2, sizeof b2, "Polegli: ");
    for (i = 0; i < st->n_fallen; i++) {
      if (i) strncat(b2, ", ", sizeof b2 - strlen(b2) - 1);
      strncat(b2, st->fallen[i], sizeof b2 - strlen(b2) - 1);
    }
    cut(b2, 90, buf, sizeof buf);
    T((float)X, (float)(Y + 9), buf, PAL_BAD);
  }
  n = tavern_recruits(st, tav);
  if (tav_row >= n) tav_row = n ? n - 1 : 0;
  tav_off = ui_scroll_follow(tav_off, tav_row, n, VIS);
  w = WW - 12 - (n > VIS ? 5 : 0);
  if (!n) ui_text(X + 2, Y + 22, "Nikogo wi\352cej w karczmie nie ma.", PAL_DIM, w - 4, 0, 0);
  for (i = 0; i < VIS && tav_off + i < n; i++) {
    int r = tav[tav_off + i], y = Y + 20 + i * 38;
    const RecruitDef *rd = &RECRUIT_DEFS[r];
    Character ch;
    char_from_recruit(&ch, (uint8_t)r, NULL, lvl);
    r2d_rect((float)X, (float)y, (float)w, 35, PAL_PANEL2, 255);
    r2d_frame((float)X, (float)y, (float)w, 35, zone == 0 && tav_row == tav_off + i ? PAL_EDGE_HI : PAL_EDGE, 255);
    portrait(r, 29, X + 3, y + 3, PAL_EDGE);
    T((float)(X + 37), (float)(y + 2), rd->name, PAL_TEXT);
    snprintf(buf, sizeof buf, "%s \205 %s \205 poz. %d \205 PW %d \205 KP %d", CLASS_DEFS[rd->class_id].name, ANCESTRY_DEFS[ch.ancestry].name, lvl, ch.max_hp, get_stat(&ch, STAT_AC, 0));
    T((float)(X + 37), (float)(y + 11), buf, PAL_AMBER);
    cut(rd->bio, 132, buf, sizeof buf);
    ui_text(X + 37, y + 19, buf, PAL_DIM, w - 130, 1, 0);
    snprintf(buf, sizeof buf, "ZATRUDNIJ (%d Z)", cost);
    ui_button(X + w - 84, y + 10, 80, 14, buf, BTN_PLAIN, zone == 0 && tav_row == tav_off + i, slots > 0 && st->scrap >= cost);
  }
  ui_scrollbar(X, Y + 20, WW - 12, 192, n, VIS, tav_off);
}

static void draw_pick(void) {
  const Character *ch = &g_camp.party[ch_idx];
  int x, y, n = pick_rows(), i, w = 230 - 16, off;
  char title[64], tip[600];
  snprintf(title, sizeof title, "Wybierz: %s", SLOT_NAME[pick_slot]);
  ui_window(230, 150, title, &x, &y);
  off = pick_off = ui_scroll_follow(pick_off, pick_focus < n ? pick_focus : pick_off, n, 7);
  if (n > 7) w -= 5;
  if (!n) ui_text(x + 10, y + 24, "Brak pasuj\261cych przedmiot\363w w skrytce ani plecaku.", PAL_DIM, w - 4, 0, 0);
  for (i = 0; i < 7 && off + i < n; i++) {
    const PickRow *p = &picks[off + i];
    const ItemInst *inst = p->arr ? &p->arr[p->index] : &ch->equip[pick_slot];
    int ry = y + 22 + i * 14, foc = pick_focus == off + i;
    item_row(x + 8, ry, w - 44, inst->id, inst->qty, NULL, foc);
    mini_button(x + 8 + w - 42, ry + 1, 42, p->arr ? "ZA\243\323\257" : "ZDEJMIJ", p->arr ? BTN_PRIMARY : BTN_PLAIN, foc, 1);
    if (foc && tip_ms >= TIP_MS) {
      item_tip(inst->id, NULL, tip, sizeof tip);
      set_tip(x + 28, ry, tip);
    }
  }
  ui_scrollbar(x + 8, y + 22, 230 - 16, 98, n, 7, off);
  ui_button(x + 230 - 62, y + 150 - 22, 54, 15, "ZAMKNIJ", BTN_PLAIN, pick_focus >= n, 1);
}

static void draw_main(void) {
  static const char *const L[5] = {"ZAPISZ GR\312", "WCZYTAJ GR\312", "ZAPISZ I WYJD\254", "WYJD\254 BEZ ZAPISU", "WR\323\306 DO GRY"};
  static const int K[5] = {BTN_PLAIN, BTN_PLAIN, BTN_PRIMARY, BTN_DANGER, BTN_PLAIN};
  int x, y, i;
  ui_window(150, 128, "MENU G\243\323WNE", &x, &y);
  for (i = 0; i < 5; i++) ui_button(x + 15, y + 22 + i * 20, 120, 15, L[i], K[i], main_focus == i, 1);
}

static void draw(void) {
  int32_t tq = clock_time_q8(&clock), pan;
  int dx_mid;
  if (!loaded) {
    font_draw_at(V_W / 2, V_H / 2, 0.5f, 0.5f, "Brak plik\363w grafiki (katalog gfx/)", PAL_BAD, 255, FONT_OUTLINE, 0, 1);
    return;
  }
  /* tło (backdrop 'hub'), ognisko, tablica ogłoszeń, mieszkańcy, drużyna */
  pan = rdiv(14L * 256 * wave_q14(tq, w_pan, 0), 16384);
  img_draw(&img[L_SKY], (float)parallax_x(M, pan, 50), 0, 255);
  drift_draw(&img[L_CLOUDS], clock.tick, 2200, 0, 242);
  bg_rays(&BG_HUB, tq);
  img_draw(&img[L_FAR], (float)parallax_x(M, pan, 250), 0, 255);
  dx_mid = parallax_x(M, pan, 600) + M;
  img_draw(&img[L_MID], (float)(dx_mid - M), 0, 255);
  bg_windows(&BG_HUB, tq, dx_mid);
  bg_birds(&bg, tq);
  img_draw(&img[L_GROUND], 0, 0, 255);
  r2d_ellipse(432, 254 - 2.8f, 32.2f, 15.4f, 0xff8a30, (41 * glow_alpha_q8(tq)) >> 8);
  r2d_rect(427, 200, 2, 22, 0x2a1c12, 255);
  r2d_rect(441, 200, 2, 22, 0x2a1c12, 255);
  r2d_rect(425, 196, 20, 12, 0x6a4a2a, 255);
  r2d_rect(427, 198, 5, 4, 0xe8dcc0, 255);
  r2d_rect(434, 199, 4, 5, 0xe8dcc0, 255);
  r2d_rect(439, 198, 4, 3, 0xe8dcc0, 255);
  motes_draw(&dust, 0xf0c080);
  {
    /* płomienie (głębia 2) bez poświaty - narysowana wyżej */
    static const uint32_t cols[FLAME_TONGUES] = {0xc43d1a, 0xff8a30, 0xffc860, 0xfff0a0};
    const float k = 1.4f, x = 432, y = 254;
    int i;
    r2d_rect(x - 4.5f * k, y - k, 9 * k, 2 * k, 0x3a2410, 255);
    for (i = 0; i < FLAME_TONGUES; i++) {
      float w = (7 - i * 1.6f) * k, h = (9 - i * 2) * k * flame_k_q12(tq, i) / FQ12, cx = x + flame_sway_q8(tq, i) * k / FQ8;
      if (h < 1) h = 1;
      r2d_rect(cx - w / 2, y - 1 - h, w, h, cols[i], 255);
    }
  }
  r2d_alpha(235);
  units_draw(&img[L_NPC], &npc_set, &npc_anim, 1, 0xffffff, 0, 255);
  r2d_alpha(255);
  {
    /* drużyna: arkusz z blokami po 7 rekrutów (patrz pack_scenes.py) */
    int i;
    for (i = 0; i < party_set.n; i++) {
      const UnitPlace *u = &party_set.u[i];
      int fy = (u->row / 7) * 256 + (u->row % 7) * 36;
      img_draw_part(&img[L_PARTY], UNIT_IDLE[units.step[i]].frame * 32, fy, 32, 36, u->x - 16.0f, u->y - 31.5f, 1, u->flip, 0xffffff, 255);
    }
  }
  draw_top();
  draw_menu();
  ui_panel(WX, WY, WW, WH, PAL_EDGE);
  T(WX + 8, WY + 5, TITLES[tab], PAL_AMBER);
  ctx_tip[0] = 0;
  switch (tab) {
    case TAB_BOARD: draw_board(); break;
    case TAB_SHOP: draw_shop(); break;
    case TAB_HEAL: draw_heal(); break;
    case TAB_PARTY: draw_party(); break;
    default: draw_tavern(); break;
  }
  if (pick_open) {
    ctx_tip[0] = 0;
    draw_pick();
  }
  if (ctx_tip[0] && tip_ms >= TIP_MS && !dlg.open && !main_open) ui_tip(ctx_tip_x, ctx_tip_y, ctx_tip);
  if (main_open) draw_main();
  ui_dialog_draw(&dlg);
  saveui_draw();
  ui_toast_draw();
}

const Screen SCREEN_HUB = {enter, update, draw, leave};
