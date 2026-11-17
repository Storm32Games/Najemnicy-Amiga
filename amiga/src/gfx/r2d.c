/* Renderer 2D: GL (MiniGL na Amidze, OpenGL na hoście). Opis w r2d.h. */
#include <string.h>
#include <stdlib.h>
#include "r2d.h"
#include "../data/assets.h"

#if defined(NAJ_AMIGA)
#include <exec/types.h>
#include <proto/minigl.h>
#include <libraries/minigl_dispatch.h>
#elif defined(__APPLE__)
#define GL_SILENCE_DEPRECATION 1
#include <OpenGL/gl.h>
#else
#include <GL/gl.h>
#endif

static struct {
  int view_w, view_h, vx, vy, vw, vh, batch;
  int open, nq;
  unsigned cur_tex;            /* 0 = bez tekstury */
} G;

/* ------------------------------------------------------------------ paczki quadów */
static void flush(void) {
  if (G.open) {
    glEnd();
    G.open = 0;
    G.nq = 0;
  }
}
static void use_tex(unsigned id) {
  if (G.open && id == G.cur_tex && G.nq < G.batch) return;
  flush();
  if (id != G.cur_tex) {
    if (id) {
      if (!G.cur_tex) glEnable(GL_TEXTURE_2D);
      glBindTexture(GL_TEXTURE_2D, id);
    } else glDisable(GL_TEXTURE_2D);
    G.cur_tex = id;
  }
}
static void begin_quad(void) {
  if (!G.open) {
    glBegin(GL_QUADS);
    G.open = 1;
    G.nq = 0;
  }
  G.nq++;
}

void r2d_init(int view_w, int view_h, int batch) {
  float zx = (float)view_w / V_W, zy = (float)view_h / V_H, z = zx < zy ? zx : zy;
  memset(&G, 0, sizeof G);
  G.view_w = view_w;
  G.view_h = view_h;
  G.batch = batch < 1 ? 1 : batch > 64 ? 64 : batch;
  G.vw = (int)(V_W * z + 0.5f);
  G.vh = (int)(V_H * z + 0.5f);
  G.vx = (view_w - G.vw) / 2;
  G.vy = (view_h - G.vh) / 2;
  glDisable(GL_DEPTH_TEST);
  glDisable(GL_CULL_FACE);
  glDisable(GL_TEXTURE_2D);
  glEnable(GL_BLEND);
  glBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA);
  glTexEnvi(GL_TEXTURE_ENV, GL_TEXTURE_ENV_MODE, GL_MODULATE);
  glMatrixMode(GL_MODELVIEW);
  glLoadIdentity();
}

void r2d_frame_begin(uint32_t rgb) {
  glViewport(0, 0, G.view_w, G.view_h);
  glClearColor(0, 0, 0, 1);
  glClear(GL_COLOR_BUFFER_BIT);
  glViewport(G.vx, G.vy, G.vw, G.vh);
  glMatrixMode(GL_PROJECTION);
  glLoadIdentity();
  glOrtho(0.0, (double)V_W, (double)V_H, 0.0, -1.0, 1.0);
  glMatrixMode(GL_MODELVIEW);
  G.cur_tex = 0;
  glDisable(GL_TEXTURE_2D);
  r2d_rect(0, 0, V_W, V_H, rgb, 255);
}

void r2d_frame_end(void) { flush(); }

void r2d_rect(float x, float y, float w, float h, uint32_t rgb, int a) {
  if (a <= 0 || w <= 0 || h <= 0) return;
  use_tex(0);
  begin_quad();
  glColor4ub((GLubyte)(rgb >> 16), (GLubyte)(rgb >> 8), (GLubyte)rgb, (GLubyte)(a > 255 ? 255 : a));
  glVertex2f(x, y);
  glVertex2f(x + w, y);
  glVertex2f(x + w, y + h);
  glVertex2f(x, y + h);
}

/* ------------------------------------------------------------------ tekstury */
static int pow2(int v) { int p = 1; while (p < v) p <<= 1; return p; }

int r2d_tex_create(RTex *t, int w, int h, const uint8_t *rgba) {
  uint8_t *buf;
  int y;
  flush();
  t->w = w;
  t->h = h;
  t->tw = pow2(w);
  t->th = pow2(h);
  buf = (uint8_t *)calloc((size_t)t->tw * t->th, 4);
  if (!buf) return 0;
  if (rgba) for (y = 0; y < h; y++) memcpy(buf + (size_t)y * t->tw * 4, rgba + (size_t)y * w * 4, (size_t)w * 4);
  glGenTextures(1, &t->id);
  glBindTexture(GL_TEXTURE_2D, t->id);
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_NEAREST);
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_NEAREST);
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP);
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP);
  glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA, t->tw, t->th, 0, GL_RGBA, GL_UNSIGNED_BYTE, buf);
  free(buf);
  if (G.cur_tex) glBindTexture(GL_TEXTURE_2D, G.cur_tex);
  return 1;
}

void r2d_tex_update(RTex *t, int x, int y, int w, int h, const uint8_t *rgba) {
  flush();
  glBindTexture(GL_TEXTURE_2D, t->id);
  glTexSubImage2D(GL_TEXTURE_2D, 0, x, y, w, h, GL_RGBA, GL_UNSIGNED_BYTE, rgba);
  if (G.cur_tex && G.cur_tex != t->id) glBindTexture(GL_TEXTURE_2D, G.cur_tex);
}

void r2d_tex_free(RTex *t) {
  if (!t->id) return;
  flush();
  if (G.cur_tex == t->id) {
    glDisable(GL_TEXTURE_2D);
    G.cur_tex = 0;
  }
  glDeleteTextures(1, &t->id);
  t->id = 0;
}

void r2d_image(const RTex *t, float x, float y, float w, float h, float sx, float sy, float sw, float sh, uint32_t tint, int a) {
  float u0, v0, u1, v1;
  if (a <= 0 || !t->id) return;
  u0 = sx / t->tw;
  v0 = sy / t->th;
  u1 = (sx + sw) / t->tw;
  v1 = (sy + sh) / t->th;
  use_tex(t->id);
  begin_quad();
  glColor4ub((GLubyte)(tint >> 16), (GLubyte)(tint >> 8), (GLubyte)tint, (GLubyte)(a > 255 ? 255 : a));
  glTexCoord2f(u0, v0); glVertex2f(x, y);
  glTexCoord2f(u1, v0); glVertex2f(x + w, y);
  glTexCoord2f(u1, v1); glVertex2f(x + w, y + h);
  glTexCoord2f(u0, v1); glVertex2f(x, y + h);
}

/* ------------------------------------------------------------------ czcionka */
/* Dwa atlasy 256x256, w każdym 3 zestawy (styl x grubość); komórka 9 x 11 px (glif <= 7 px + obrys 1 px z każdej strony),
 * 28 komórek w wierszu, 192 znaki (32..126, 160..255) = 7 wierszy = 77 px na zestaw. */
#define CELL_W 9
#define CELL_HH (FONT_ROWS + 2)
#define PER_ROW 28
#define SET_H (7 * CELL_HH)
static RTex font_tex[2];
static uint8_t font_atlas[256 * 256 * 4];

static int glyph_cell(int set, int code, int *cx, int *cy) {
  int i;
  if (code < 32 || (code >= 127 && code < 160)) return 0;
  i = code < 128 ? code - 32 : code - 160 + 95;
  *cx = (i % PER_ROW) * CELL_W;
  *cy = (set % 3) * SET_H + (i / PER_ROW) * CELL_HH;
  return 1;
}

static void put_px(int x, int y, int white) {
  uint8_t *p;
  if (x < 0 || y < 0 || x >= 256 || y >= 256) return;
  p = &font_atlas[(y * 256 + x) * 4];
  if (white) { p[0] = p[1] = p[2] = 255; p[3] = 255; }
  else if (p[3] == 0) { p[0] = p[1] = p[2] = 0; p[3] = 255; }
}

void font_init(void) {
  int tex, set, code;
  for (tex = 0; tex < 2; tex++) {
    memset(font_atlas, 0, sizeof font_atlas);
    for (set = tex * 3; set < tex * 3 + 3; set++) {
      int style = set >> 1, bold = set & 1;
      const FontGlyph *tab = bold ? FONT_BOLD : FONT_REGULAR;
      for (code = 32; code < 256; code++) {
        int cx, cy, r, b;
        const FontGlyph *g = &tab[code];
        if (!glyph_cell(set, code, &cx, &cy)) continue;
        for (r = 0; r < FONT_ROWS; r++)
          for (b = 0; b < 8; b++) {
            int px = cx + 1 + b, py = cy + 1 + r, dx, dy;
            if (!(g->rows[r] >> b & 1)) continue;
            if (style == FONT_OUTLINE)
              for (dy = -1; dy <= 1; dy++) for (dx = -1; dx <= 1; dx++) put_px(px + dx, py + dy, 0);
            else if (style == FONT_SHADOW) put_px(px + 1, py + 1, 0);
          }
        for (r = 0; r < FONT_ROWS; r++)
          for (b = 0; b < 8; b++) if (g->rows[r] >> b & 1) put_px(cx + 1 + b, cy + 1 + r, 1);
      }
    }
    r2d_tex_create(&font_tex[tex], 256, 256, font_atlas);
  }
}

int font_measure(const char *s, int bold) {
  const FontGlyph *tab = bold ? FONT_BOLD : FONT_REGULAR;
  const unsigned char *p = (const unsigned char *)s;
  int x = 0;
  for (; *p && *p != '\n'; p++) x += tab[*p].adv;
  return x > FONT_SPACING ? x - FONT_SPACING : 0;
}

void font_draw(float x, float y, const char *s, uint32_t rgb, int a, int style, int bold, float scale) {
  const FontGlyph *tab = bold ? FONT_BOLD : FONT_REGULAR;
  const unsigned char *p = (const unsigned char *)s;
  int set = style * 2 + bold;
  const RTex *t = &font_tex[set / 3];
  float cx = x;
  for (; *p; p++) {
    int gx, gy;
    if (*p == '\n') {
      cx = x;
      y += FONT_LINE_H * scale;
      continue;
    }
    if (*p != ' ' && glyph_cell(set, *p, &gx, &gy)) {
      float w = tab[*p].w + 2.0f;
      /* komórka zaczyna się 1 px przed glifem i 1 wiersz nad wierszem TOP (-1) */
      r2d_image(t, cx - scale, y + (FONT_TOP - 1) * scale, w * scale, CELL_HH * scale, (float)gx, (float)gy, w, CELL_HH, rgb, a);
    }
    cx += tab[*p].adv * scale;
  }
}

void font_draw_at(float x, float y, float ox, float oy, const char *s, uint32_t rgb, int a, int style, int bold, float scale) {
  float w = font_measure(s, bold) * scale, h = FONT_CELL_H * scale;
  font_draw(x - w * ox, y - h * oy, s, rgb, a, style, bold, scale);
}
