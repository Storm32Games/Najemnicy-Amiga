/* Widżety UI. */
#include <string.h>
#include "ui.h"
#include "../gfx/r2d.h"
#include "../data/assets.h"

static char wrapbuf[1024];

int ui_button_w(const char *text) { return font_measure(text, 0) + 14; }

void ui_button(int x, int y, int w, int h, const char *text, int kind, int focus, int enabled) {
  uint32_t base = kind == BTN_PRIMARY ? PAL_AMBER : kind == BTN_DANGER ? PAL_BAD : PAL_TEXT;
  uint32_t edge = kind == BTN_PRIMARY ? PAL_AMBER : kind == BTN_DANGER ? PAL_BLOOD : PAL_EDGE;
  int hov = focus && enabled, a = enabled ? 255 : 102;
  r2d_rect(x + 1.5f, y + 1.5f, (float)w, (float)h, 0, 204 * a / 255);
  r2d_rect((float)x, (float)y, (float)w, (float)h, hov ? 0x3a2c1e : PAL_PANEL2, a);
  r2d_frame((float)x, (float)y, (float)w, (float)h, hov ? PAL_EDGE_HI : edge, a);
  font_draw_at(x + w / 2.0f, y + h / 2.0f, 0.5f, 0.5f, text, hov ? 0xffffff : base, a, FONT_OUTLINE, 0, 1);
}

void ui_panel(int x, int y, int w, int h, uint32_t edge) {
  r2d_rect((float)x + 2, (float)y + 2, (float)w, (float)h, 0, 128);
  r2d_rect((float)x, (float)y, (float)w, (float)h, PAL_PANEL, 255);
  r2d_frame((float)x, (float)y, (float)w, (float)h, edge, 255);
}

int ui_text_h(const char *s, int wrap, int spacing) {
  int n = wrap > 0 ? font_wrap(s, 0, wrap, wrapbuf, sizeof wrapbuf) : 1;
  return n * (FONT_LINE_H + spacing) - spacing;
}

int ui_text(int x, int y, const char *s, uint32_t rgb, int wrap, int spacing, int center) {
  int n = 1, i = 0;
  const char *line;
  if (wrap > 0) n = font_wrap(s, 0, wrap, wrapbuf, sizeof wrapbuf);
  else {
    strncpy(wrapbuf, s, sizeof wrapbuf - 1);
    wrapbuf[sizeof wrapbuf - 1] = 0;
  }
  line = wrapbuf;
  while (line) {
    char *nl = strchr(line, '\n');
    if (nl) *nl = 0;
    if (center) font_draw_at((float)x, (float)(y + i * (FONT_LINE_H + spacing)), 0.5f, 0, line, rgb, 255, FONT_OUTLINE, 0, 1);
    else font_draw((float)x, (float)(y + i * (FONT_LINE_H + spacing)), line, rgb, 255, FONT_OUTLINE, 0, 1);
    i++;
    line = nl ? nl + 1 : NULL;
  }
  return n * (FONT_LINE_H + spacing) - spacing;
}

/* ---- toast */
static char toast_msg[160];
static uint32_t toast_tone;
static int toast_ms = -1;

void ui_toast(const char *msg, uint32_t tone) {
  strncpy(toast_msg, msg, sizeof toast_msg - 1);
  toast_msg[sizeof toast_msg - 1] = 0;
  toast_tone = tone;
  toast_ms = 0;
}
void ui_toast_update(int ms) {
  if (toast_ms < 0) return;
  toast_ms += ms;
  if (toast_ms >= 2600) toast_ms = -1;
}
void ui_toast_draw(void) {
  int a, y, w, h, tw;
  if (toast_ms < 0) return;
  /* tweeny: wejście 160 ms (alfa 0->1, y 30->36), wyjście od 2200 ms przez 400 ms */
  if (toast_ms < 160) {
    a = 255 * toast_ms / 160;
    y = 30 + 6 * toast_ms / 160;
  } else {
    a = toast_ms < 2200 ? 255 : 255 - 255 * (toast_ms - 2200) / 400;
    y = 36;
  }
  tw = font_wrap(toast_msg, 0, 280, wrapbuf, sizeof wrapbuf) > 1 ? 280 : font_measure(toast_msg, 0);
  h = ui_text_h(toast_msg, 280, 0) + 8;
  w = tw + 16;
  r2d_rect(V_W / 2.0f - w / 2.0f, y - h / 2.0f, (float)w, (float)h, 0x120e0a, 245 * a / 255);
  r2d_frame(V_W / 2.0f - w / 2.0f, y - h / 2.0f, (float)w, (float)h, toast_tone, a);
  if (a > 0) {
    /* tekst wyśrodkowany linia po linii */
    char *line = wrapbuf, *nl;
    int i = 0, top = y - (h - 8) / 2;
    font_wrap(toast_msg, 0, 280, wrapbuf, sizeof wrapbuf);
    while (line) {
      nl = strchr(line, '\n');
      if (nl) *nl = 0;
      font_draw_at(V_W / 2.0f, (float)(top + i * FONT_LINE_H), 0.5f, 0, line, toast_tone, a, FONT_OUTLINE, 0, 1);
      i++;
      line = nl ? nl + 1 : NULL;
    }
  }
}
