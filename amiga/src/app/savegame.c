/* Zapis gry na dysku i okno slotów. Plik w UTF-8, napisy przekodowuje tools/amiga/latin2_literals.py. */
#include <stdio.h>
#include <string.h>
#include <time.h>
#include "savegame.h"
#include "game.h"
#include "app.h"
#include "ui.h"
#include "../core/save.h"
#include "../gfx/r2d.h"
#include "../data/assets.h"

#if defined(NAJ_AMIGA)
#define SAVE_DIR "PROGDIR:"
#else
#define SAVE_DIR ""
#endif

Mission *g_save_mission;
int g_resume_len;
uint8_t g_resume[65536];
int g_entry_len;
uint8_t g_entry[16384];

static uint8_t buf[SAVE_MAX_BYTES + 49152];
static CampaignState tmp;

static void path_of(int slot, char *out, int cap) {
  if (slot) snprintf(out, (size_t)cap, SAVE_DIR "najemnicy_slot%d.sav", slot);
  else snprintf(out, (size_t)cap, SAVE_DIR "najemnicy_auto.sav");
}

static void w32(uint8_t *p, uint32_t v) {
  p[0] = (uint8_t)(v >> 24);
  p[1] = (uint8_t)(v >> 16);
  p[2] = (uint8_t)(v >> 8);
  p[3] = (uint8_t)v;
}
static uint32_t r32(const uint8_t *p) { return (uint32_t)p[0] << 24 | (uint32_t)p[1] << 16 | (uint32_t)p[2] << 8 | p[3]; }

/* "NSAV" u8 wersja, u32 czas, u8 misja, u32 dł. kampanii, kampania, [u8 zlecenie, u32 dł. misji, misja, u32 dł. wejścia, wejście] */
static int build(uint8_t *out, int cap) {
  int n = 14, c, mlen = 0;
  memcpy(out, "NSAV", 4);
  out[4] = 1;
  w32(out + 5, (uint32_t)time(NULL));
  c = campaign_save(&g_camp, out + 14, cap - 14);
  if (!c) return 0;
  w32(out + 10, (uint32_t)c);
  n += c;
  out[9] = 0;
  if (g_save_mission && g_save_mission->mode == MODE_EXPLORE && g_job >= 0 && g_entry_len > 0) {
    mlen = mission_save(g_save_mission, out + n + 5, cap - n - 5 - 4 - g_entry_len);
    if (mlen) {
      out[9] = 1;
      out[n] = (uint8_t)g_job;
      w32(out + n + 1, (uint32_t)mlen);
      n += 5 + mlen;
      w32(out + n, (uint32_t)g_entry_len);
      memcpy(out + n + 4, g_entry, (size_t)g_entry_len);
      n += 4 + g_entry_len;
    }
  }
  return n;
}

static int write_file(int slot, const uint8_t *b, int n) {
  char p[64];
  FILE *f;
  path_of(slot, p, sizeof p);
  f = fopen(p, "wb");
  if (!f) return 0;
  if (fwrite(b, 1, (size_t)n, f) != (size_t)n) {
    fclose(f);
    return 0;
  }
  return fclose(f) == 0;
}

static int read_file(int slot, uint8_t *b, int cap) {
  char p[64];
  FILE *f;
  int n;
  path_of(slot, p, sizeof p);
  f = fopen(p, "rb");
  if (!f) return 0;
  n = (int)fread(b, 1, (size_t)cap, f);
  fclose(f);
  return n >= 14 && !memcmp(b, "NSAV", 4) ? n : 0;
}

int save_write(int slot) {
  int n = build(buf, sizeof buf);
  if (!n) return 0;
  if (!write_file(slot, buf, n)) return 0;
  return slot ? write_file(0, buf, n) : 1;
}

int save_exists(int slot) { return read_file(slot, buf, sizeof buf) > 0; }

int save_any_slot(void) {
  int i;
  for (i = 1; i <= SAVE_SLOTS; i++) if (save_exists(i)) return 1;
  return 0;
}

int save_load(int slot) {
  int n = read_file(slot, buf, sizeof buf), c, p;
  if (!n) return 0;
  c = (int)r32(buf + 10);
  if (14 + c > n || !campaign_load(&tmp, buf + 14, c) || !tmp.n_party) return 0;
  g_camp = tmp;
  g_resume_len = 0;
  g_job = -1;
  p = 14 + c;
  if (buf[9] && p + 5 <= n) {
    int ml = (int)r32(buf + p + 1), el;
    if (p + 5 + ml + 4 <= n && ml <= (int)sizeof g_resume) {
      g_job = buf[p];
      memcpy(g_resume, buf + p + 5, (size_t)ml);
      g_resume_len = ml;
      el = (int)r32(buf + p + 5 + ml);
      if (el <= (int)sizeof g_entry && p + 9 + ml + el <= n) {
        memcpy(g_entry, buf + p + 9 + ml, (size_t)el);
        g_entry_len = el;
      }
    }
  }
  /* autozapis = kopia wczytanego slotu */
  if (slot) write_file(0, buf, n);
  return 1;
}

int save_info(int slot, SlotInfo *o) {
  int n = read_file(slot, buf, sizeof buf), c, i, k = 0;
  time_t t;
  struct tm *tmv;
  if (!n) return 0;
  c = (int)r32(buf + 10);
  if (14 + c > n || !campaign_load(&tmp, buf + 14, c)) return 0;
  memset(o, 0, sizeof *o);
  o->day = tmp.day;
  o->scrap = tmp.scrap;
  o->level = 1;
  for (i = 0; i < tmp.n_party; i++) {
    const Character *ch = &tmp.party[i];
    if (is_dead(ch)) continue;
    if (ch->level > o->level) o->level = ch->level;
    if (k++) strncat(o->party, ", ", sizeof o->party - strlen(o->party) - 1);
    strncat(o->party, ch->name, sizeof o->party - strlen(o->party) - 1);
  }
  if (buf[9]) {
    int j = buf[14 + c];
    if (j < tmp.n_contracts) snprintf(o->mission, sizeof o->mission, "%s", tmp.contracts[j].title);
  }
  t = (time_t)r32(buf + 5);
  tmv = localtime(&t);
  if (tmv) snprintf(o->time, sizeof o->time, "%02d.%02d.%04d %02d:%02d", tmv->tm_mday, tmv->tm_mon + 1, tmv->tm_year + 1900, tmv->tm_hour, tmv->tm_min);
  return 1;
}

void save_enter_loaded(void) {
  if (g_resume_len && g_job >= 0) app_switch(SCR_MISSION, 400, 500);
  else app_switch(SCR_HUB, 400, 500);
}

/* ------------------------------------------------------------------ okno slotów (openSaveSlots) */
static int ui_open, ui_load, ui_focus, ui_confirm;
static SlotInfo info[SAVE_SLOTS + 1];
static int has[SAVE_SLOTS + 1];
static UiDialog confirm;

static void refresh(void) {
  int i;
  for (i = 1; i <= SAVE_SLOTS; i++) has[i] = save_info(i, &info[i]);
}

void saveui_open(int load) {
  ui_open = 1;
  ui_load = load;
  ui_focus = 0;
  ui_confirm = 0;
  refresh();
}
int saveui_is_open(void) { return ui_open; }
int saveui_loading(void) { return ui_load; }

static int act(int slot) {
  char msg[64];
  if (ui_load) {
    if (!has[slot]) return -1;
    if (save_load(slot)) {
      ui_open = 0;
      return slot;
    }
    ui_toast("Nie uda\263o si\352 wczyta\346 zapisu.", PAL_BAD);
    return -1;
  }
  if (save_write(slot)) {
    app_sfx("pickup", 256, 256);
    snprintf(msg, sizeof msg, "Gra zapisana w slocie %d.", slot);
    ui_toast(msg, PAL_GOOD);
    ui_open = 0;
    return slot;
  }
  ui_toast("Zapis nie powi\363d\263 si\352!", PAL_BAD);
  return -1;
}

int saveui_input(unsigned pressed) {
  if (!ui_open || !pressed) return -1;
  if (confirm.open) {
    int r = ui_dialog_input(&confirm, pressed);
    if (r == 1) return act(ui_focus + 1);
    return -1;
  }
  if (pressed & IN_UP && ui_focus > 0) ui_focus--;
  if (pressed & IN_DOWN && ui_focus < SAVE_SLOTS) ui_focus++;
  if (pressed & IN_BACK || (pressed & IN_OK && ui_focus == SAVE_SLOTS)) {
    ui_open = 0;
    return 0;
  }
  if (pressed & IN_OK) {
    int slot = ui_focus + 1;
    if (!ui_load && has[slot]) {
      static const char *const B[2] = {"ANULUJ", "NADPISZ"};
      static const int K[2] = {BTN_PLAIN, BTN_DANGER};
      char body[96];
      snprintf(body, sizeof body, "Slot %d zawiera ju\277 zapis (dzie\361 %d). Nadpisa\346 go?", slot, info[slot].day);
      ui_dialog_open(&confirm, "NADPISA\306 ZAPIS?", body, 2, B, K, 0);
      return -1;
    }
    return act(slot);
  }
  return -1;
}

void saveui_draw(void) {
  const int W = 260, ROW = 34, H = 30 + SAVE_SLOTS * (ROW + 4) + 24;
  int x, y, i;
  char line[160];
  if (!ui_open) return;
  ui_window(W, H, ui_load ? "Wczytaj gr\352" : "Zapisz gr\352", &x, &y);
  for (i = 1; i <= SAVE_SLOTS; i++) {
    int ry = y + 22 + (i - 1) * (ROW + 4), rx = x + 8, can = !ui_load || has[i];
    r2d_rect((float)rx, (float)ry, W - 16, ROW, 0, 89);
    r2d_frame((float)rx, (float)ry, W - 16, ROW, ui_focus == i - 1 ? PAL_EDGE_HI : PAL_EDGE, 255);
    snprintf(line, sizeof line, "SLOT %d", i);
    font_draw((float)(rx + 6), (float)(ry + 4), line, PAL_AMBER, 255, FONT_OUTLINE, 0, 1);
    if (has[i]) {
      font_draw((float)(rx + 48), (float)(ry + 4), info[i].time, PAL_DIM, 255, FONT_OUTLINE, 0, 1);
      if (info[i].mission[0]) snprintf(line, sizeof line, "Dzie\361 %d \205 misja: %.24s", info[i].day, info[i].mission);
      else snprintf(line, sizeof line, "Dzie\361 %d \205 poz. %d \205 %d Z\263omu", info[i].day, info[i].level, info[i].scrap);
      font_draw((float)(rx + 6), (float)(ry + 14), line, info[i].mission[0] ? PAL_AMBER : PAL_TEXT, 255, FONT_OUTLINE, 0, 1);
      snprintf(line, sizeof line, "%.40s", info[i].party[0] ? info[i].party : "(brak \277ywych najemnik\363w)");
      font_draw((float)(rx + 6), (float)(ry + 23), line, PAL_DIM, 255, FONT_OUTLINE, 0, 0.75f);
    } else font_draw((float)(rx + 6), (float)(ry + 15), "\200 pusty \200", PAL_DIM, 255, FONT_OUTLINE, 0, 1);
    ui_button(rx + W - 16 - 58, ry + (ROW - 15) / 2, 54, 15, ui_load ? "WCZYTAJ" : "ZAPISZ", BTN_PRIMARY, ui_focus == i - 1, can);
  }
  ui_button(x + W - 62, y + H - 20, 54, 15, "ANULUJ", BTN_PLAIN, ui_focus == SAVE_SLOTS, 1);
  ui_dialog_draw(&confirm);
}
