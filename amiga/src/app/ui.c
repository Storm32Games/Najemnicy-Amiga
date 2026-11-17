#include <stdio.h>
/* Widżety UI. */
#include <string.h>
#include "ui.h"
#include "../gfx/r2d.h"
#include "../data/assets.h"
#include "app.h"

static char wrapbuf[1024];

int ui_button_w(const char *text) { return font_measure(text, 0) + 14; }

void ui_button(int x, int y, int w, int h, const char *text, int kind, int focus, int enabled) {
  uint32_t base = kind == BTN_PRIMARY ? PAL_AMBER : kind == BTN_DANGER ? PAL_BAD : PAL_TEXT;
  uint32_t edge = kind == BTN_PRIMARY ? PAL_AMBER : kind == BTN_DANGER ? PAL_BLOOD : PAL_EDGE;
  int hov = focus && enabled, a = enabled ? 255 : 102;
  r2d_rect(x + 1.5f, y + 1.5f, (float)w, (float)h, 0, 204 * a / 255);
  r2d_rect((float)x, (float)y, (float)w, (float)h, hov ? 0x3a2c1e : PAL_PANEL2, a);
  r2d_frame((float)x, (float)y, (float)w, (float)h, hov ? PAL_EDGE_HI : edge, a);
  {
    /* napis zawsze mieści się w przycisku (setMaxLineWidth(w - 6)): za długi - ściśnięty w poziomie */
    int tw = font_measure(text, 0);
    if (tw > w - 6) r2d_scale((float)(w - 6) / tw, 1, x + w / 2.0f, y + h / 2.0f);
    font_draw_at(x + w / 2.0f, y + h / 2.0f, 0.5f, 0.5f, text, hov ? 0xffffff : base, a, FONT_OUTLINE, 0, 1);
    if (tw > w - 6) r2d_scale(1, 1, 0, 0);
  }
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

/* ------------------------------------------------------------------ paski, listy, okna */
void ui_bar(int x, int y, int w, int h, int ratio_q12, uint32_t col, uint32_t back) {
  int k = ratio_q12 < 0 ? 0 : ratio_q12 > 4096 ? 4096 : ratio_q12, fw = (w * k + 2048) / 4096;
  if (k > 0 && fw < 1) fw = 1;
  r2d_rect((float)x, (float)y, (float)w, (float)h, back, 255);
  if (fw) r2d_rect((float)x, (float)y, (float)fw, (float)h, col, 255);
}

void ui_scrollbar(int x, int y, int w, int h, int total, int visible, int offset) {
  float th, ty;
  if (total <= visible) return;
  th = (float)h * visible / total;
  if (th < 8) th = 8;
  ty = (h - th) * offset / (float)(total - visible > 1 ? total - visible : 1);
  r2d_rect((float)(x + w - 3), (float)y, 3, (float)h, 0, 102);
  r2d_rect((float)(x + w - 3), y + ty, 3, th, PAL_EDGE, 255);
}

int ui_scroll_follow(int offset, int focus, int total, int visible) {
  if (focus < offset) offset = focus;
  if (focus >= offset + visible) offset = focus - visible + 1;
  if (offset > total - visible) offset = total - visible;
  return offset < 0 ? 0 : offset;
}

void latin2_upper(char *s) {
  unsigned char *p = (unsigned char *)s;
  for (; *p; p++) {
    if (*p >= 'a' && *p <= 'z') *p = (unsigned char)(*p - 32);
    else if (*p >= 0xe0 && *p <= 0xfe && *p != 0xf7) *p = (unsigned char)(*p - 0x20);   /* ć ę ń ó ... */
    else if (*p >= 0xb1 && *p <= 0xbf && *p != 0xb4 && *p != 0xb7 && *p != 0xbd) *p = (unsigned char)(*p - 0x10);   /* ą ł ś ź ż */
  }
}

void ui_window(int w, int h, const char *title, int *x, int *y) {
  char t[96];
  *x = (V_W - w) / 2;
  *y = (V_H - h) / 2;
  r2d_rect(0, 0, V_W, V_H, 0, 168);
  ui_panel(*x, *y, w, h, PAL_EDGE_HI);
  if (title && *title) {
    snprintf(t, sizeof t, "%s", title);
    latin2_upper(t);   /* openWindow: tytuł wielkimi literami */
    font_draw((float)(*x + 8), (float)(*y + 6), t, PAL_AMBER, 255, FONT_OUTLINE, 0, 1);
  }
}

void ui_tip(int x, int y, const char *text) {
  char buf[600], *line, *nl;
  int n = font_wrap(text, 0, 200, buf, sizeof buf), i, w = 0, h, bx, by;
  for (line = buf; line; line = nl ? nl + 1 : NULL) {
    int lw;
    nl = strchr(line, '\n');
    if (nl) *nl = 0;
    lw = font_measure(line, 0);
    if (lw > w) w = lw;
    if (nl) *nl = '\n';
  }
  w += 8;
  h = (int)(n * (FONT_LINE_H + 1.5f) - 1.5f) + 6;
  bx = x + 6 + w > V_W - 2 ? V_W - 2 - w : x + 6;
  by = y + 12 + h > V_H - 2 ? y - h - 2 : y + 12;
  if (bx < 2) bx = 2;
  if (by < 2) by = 2;
  r2d_rect((float)bx, (float)by, (float)w, (float)h, 0x120e0a, 247);
  r2d_frame((float)bx, (float)by, (float)w, (float)h, PAL_EDGE_HI, 255);
  for (i = 0, line = buf; line; line = nl ? nl + 1 : NULL, i++) {
    nl = strchr(line, '\n');
    if (nl) *nl = 0;
    font_draw((float)(bx + 4), by + 3 + i * (FONT_LINE_H + 1.5f), line, PAL_TEXT, 255, FONT_OUTLINE, 0, 1);
  }
}

/* ------------------------------------------------------------------ dialog */
void ui_dialog_open(UiDialog *d, const char *title, const char *body, int n, const char *const *btn, const int *kind, int focus) {
  int i;
  d->open = 1;
  d->n = n > UI_DLG_MAX ? UI_DLG_MAX : n;
  d->focus = focus;
  strncpy(d->title, title, sizeof d->title - 1);
  d->title[sizeof d->title - 1] = 0;
  strncpy(d->body, body, sizeof d->body - 1);
  d->body[sizeof d->body - 1] = 0;
  for (i = 0; i < d->n; i++) {
    d->btn[i] = btn[i];
    d->kind[i] = kind ? kind[i] : BTN_PLAIN;
  }
}

int ui_dialog_input(UiDialog *d, unsigned pressed) {
  if (!d->open) return -1;
  if (pressed & (IN_LEFT | IN_UP) && d->focus > 0) d->focus--;
  if (pressed & (IN_RIGHT | IN_DOWN) && d->focus < d->n - 1) d->focus++;
  if (pressed & IN_BACK) {
    d->open = 0;
    return 0;
  }
  if (pressed & IN_OK) {
    d->open = 0;
    return d->focus;
  }
  return -1;
}

void ui_dialog_draw(const UiDialog *d) {
  const int w = 260;
  int bh, h, x, y, bx, i;
  if (!d->open) return;
  bh = ui_text_h(d->body, w - 20, 2);
  h = bh + 54;
  ui_window(w, h, d->title, &x, &y);
  ui_text(x + 10, y + 22, d->body, PAL_TEXT, w - 20, 2, 0);
  bx = x + w - 8;
  for (i = d->n - 1; i >= 0; i--) {
    int bw = ui_button_w(d->btn[i]);
    bx -= bw;
    ui_button(bx, y + h - 22, bw, 15, d->btn[i], d->kind[i], d->focus == i, 1);
    bx -= 6;
  }
}
