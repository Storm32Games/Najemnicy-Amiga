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
  float ox, oy;                /* przesunięcie (wstrząs kamery) */
  float sx, sy, cx, cy;        /* skala wokół (cx, cy) - obrót karty */
  int amul;                    /* mnożnik krycia 0..255 */
} G;
#define TX(x) (G.cx + ((x) - G.cx) * G.sx + G.ox)
#define TY(y) (G.cy + ((y) - G.cy) * G.sy + G.oy)
#define AM(a) (G.amul == 255 ? (a) : (a) * G.amul / 255)

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
  G.sx = G.sy = 1;
  G.amul = 255;
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

void r2d_offset(float dx, float dy) {
  G.ox = dx;
  G.oy = dy;
}

void r2d_scale(float sx, float sy, float cx, float cy) {
  G.sx = sx;
  G.sy = sy;
  G.cx = cx;
  G.cy = cy;
}

void r2d_alpha(int a) { G.amul = a < 0 ? 0 : a > 255 ? 255 : a; }

void r2d_rect(float x, float y, float w, float h, uint32_t rgb, int a) {
  float x0, y0, x1, y1;
  a = AM(a);
  if (a <= 0 || w <= 0 || h <= 0) return;
  use_tex(0);
  begin_quad();
  glColor4ub((GLubyte)(rgb >> 16), (GLubyte)(rgb >> 8), (GLubyte)rgb, (GLubyte)(a > 255 ? 255 : a));
  x0 = TX(x);
  y0 = TY(y);
  x1 = TX(x + w);
  y1 = TY(y + h);
  glVertex2f(x0, y0);
  glVertex2f(x1, y0);
  glVertex2f(x1, y1);
  glVertex2f(x0, y1);
}

void r2d_tri(float x0, float y0, float x1, float y1, float x2, float y2, uint32_t rgb, int a) {
  a = AM(a);
  if (a <= 0) return;
  use_tex(0);
  begin_quad();
  glColor4ub((GLubyte)(rgb >> 16), (GLubyte)(rgb >> 8), (GLubyte)rgb, (GLubyte)(a > 255 ? 255 : a));
  glVertex2f(TX(x0), TY(y0));
  glVertex2f(TX(x1), TY(y1));
  glVertex2f(TX(x2), TY(y2));
  glVertex2f(TX(x2), TY(y2));
}

void r2d_frame(float x, float y, float w, float h, uint32_t rgb, int a) {
  r2d_rect(x, y, w, 1, rgb, a);
  r2d_rect(x, y + h - 1, w, 1, rgb, a);
  r2d_rect(x, y + 1, 1, h - 2, rgb, a);
  r2d_rect(x + w - 1, y + 1, 1, h - 2, rgb, a);
}

static int isqrt(int v) {
  int r = 0, b = 1 << 30;
  while (b > v) b >>= 2;
  while (b) {
    if (v >= r + b) {
      v -= r + b;
      r = (r >> 1) + b;
    } else r >>= 1;
    b >>= 2;
  }
  return r;
}

void r2d_ellipse(float cx, float cy, float rx, float ry, uint32_t rgb, int a) {
  int iry = (int)(ry + 0.5f), irx = (int)(rx * 16 + 0.5f), y;
  if (iry < 1 || a <= 0) return;
  for (y = -iry; y < iry; y++) {
    /* półszerokość paska w 1/16 px: rx * sqrt(1 - (y + 0.5)^2 / ry^2) */
    int yy = 2 * y + 1, k = isqrt((4 * iry * iry - yy * yy) * 64);   /* sqrt(...)*16 / (2*ry) */
    float hw = (float)irx * k / (16.0f * 16 * iry);
    if (hw > 0) r2d_rect(cx - hw, cy + y, 2 * hw, 1, rgb, a);
  }
}

void r2d_blend_add(int on) {
  flush();
  glBlendFunc(GL_SRC_ALPHA, on ? GL_ONE : GL_ONE_MINUS_SRC_ALPHA);
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
  float u0, v0, u1, v1, x0, y0, x1, y1;
  a = AM(a);
  if (a <= 0 || !t->id) return;
  x0 = TX(x);
  y0 = TY(y);
  x1 = TX(x + w);
  y1 = TY(y + h);
  u0 = sx / t->tw;
  v0 = sy / t->th;
  u1 = (sx + sw) / t->tw;
  v1 = (sy + sh) / t->th;
  use_tex(t->id);
  begin_quad();
  glColor4ub((GLubyte)(tint >> 16), (GLubyte)(tint >> 8), (GLubyte)tint, (GLubyte)(a > 255 ? 255 : a));
  glTexCoord2f(u0, v0); glVertex2f(x0, y0);
  glTexCoord2f(u1, v0); glVertex2f(x1, y0);
  glTexCoord2f(u1, v1); glVertex2f(x1, y1);
  glTexCoord2f(u0, v1); glVertex2f(x0, y1);
}

/* ------------------------------------------------------------------ czcionka */
/* Trzy atlasy 256x256, w każdym 2 zestawy (styl x grubość); komórka 9 x 11 px (glif <= 7 px + obrys 1 px z każdej strony),
 * 28 komórek w wierszu, 223 znaki (32..126, 128..255: Latin-2 + znaki specjalne 0x80..0x9F) = 8 wierszy = 88 px na zestaw. */
#define CELL_W 9
#define CELL_HH (FONT_ROWS + 2)
#define PER_ROW 28
#define SET_H (8 * CELL_HH)
#define SETS_PER_TEX 2
static RTex font_tex[3];
static uint8_t font_atlas[256 * 256 * 4];

static int glyph_cell(int set, int code, int *cx, int *cy) {
  int i;
  if (code < 32 || code == 127) return 0;
  i = code < 127 ? code - 32 : code - 33;
  *cx = (i % PER_ROW) * CELL_W;
  *cy = (set % SETS_PER_TEX) * SET_H + (i / PER_ROW) * CELL_HH;
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
  for (tex = 0; tex < 3; tex++) {
    memset(font_atlas, 0, sizeof font_atlas);
    for (set = tex * SETS_PER_TEX; set < tex * SETS_PER_TEX + SETS_PER_TEX; set++) {
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
  const RTex *t = &font_tex[set / SETS_PER_TEX];
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

int font_wrap(const char *s, int bold, int wrap, char *buf, int cap) {
  const FontGlyph *tab = bold ? FONT_BOLD : FONT_REGULAR;
  const unsigned char *p = (const unsigned char *)s;
  int n = 0, lines = 1, x = 0;
  while (*p && n < cap - 1) {
    /* następne słowo (ze spacjami przed nim) */
    const unsigned char *q = p;
    int ww = 0, sp = 0;
    while (*q == ' ') { sp += tab[' '].adv; q++; }
    if (*q == '\n') {
      buf[n++] = '\n';
      lines++;
      x = 0;
      p = q + 1;
      continue;
    }
    while (*q && *q != ' ' && *q != '\n') ww += tab[*q++].adv;
    if (x > 0 && x + sp + ww - FONT_SPACING > wrap) {
      buf[n++] = '\n';
      lines++;
      x = 0;
      while (*p == ' ') p++;
    } else x += sp;
    while (p < q && n < cap - 1) buf[n++] = (char)*p++;
    x += ww;
  }
  buf[n] = 0;
  return lines;
}

void font_draw_at(float x, float y, float ox, float oy, const char *s, uint32_t rgb, int a, int style, int bold, float scale) {
  float w = font_measure(s, bold) * scale, h = FONT_CELL_H * scale;
  font_draw(x - w * ox, y - h * oy, s, rgb, a, style, bold, scale);
}
