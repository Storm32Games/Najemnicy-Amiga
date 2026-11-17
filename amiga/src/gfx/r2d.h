/* Renderer 2D na OpenGL 1.1 / MiniGL (minigl.library: PiStorm3D, Warp3D) i OpenGL na hoście (testy, zrzuty).
 * Wirtualny ekran 480x270 (jak siatka projektowa gry w przeglądarce), skalowany do ekranu z czarnymi pasami.
 * Bezpieczny podzbiór GL sprawdzony na A1200 w Cube Rally: glBegin(GL_QUADS) w małych paczkach, tekstury RGBA8
 * o bokach potęgi dwójki <= 256, filtr najbliższego sąsiada, mieszanie src-alpha, glColor4ub. */
#ifndef R2D_H
#define R2D_H

#include <stdint.h>

#define V_W 480
#define V_H 270

typedef struct { unsigned id; int w, h, tw, th; } RTex;

void r2d_init(int view_w, int view_h, int batch_quads);
void r2d_frame_begin(uint32_t rgb);
void r2d_frame_end(void);
/* Przesunięcie wszystkiego, co rysowane dalej (wstrząs kamery); 0, 0 = wyłączone. */
void r2d_offset(float dx, float dy);
/* Skala (sx, sy) wokół punktu (cx, cy) dla wszystkiego, co rysowane dalej (1, 1 = wyłączona). */
void r2d_scale(float sx, float sy, float cx, float cy);
/* Mnożnik krycia 0..255 (255 = bez zmian). */
void r2d_alpha(int a);

void r2d_rect(float x, float y, float w, float h, uint32_t rgb, int a);
/* Trójkąt jednolitym kolorem (jako zdegenerowany quad w tej samej paczce). */
void r2d_tri(float x0, float y0, float x1, float y1, float x2, float y2, uint32_t rgb, int a);
/* Ramka 1 px wewnątrz prostokąta (setStrokeStyle(1) w Phaserze). */
void r2d_frame(float x, float y, float w, float h, uint32_t rgb, int a);
/* Elipsa z poziomych pasków 1 px (środek, półosie). */
void r2d_ellipse(float cx, float cy, float rx, float ry, uint32_t rgb, int a);
/* 1 = mieszanie addytywne (BlendModes.ADD), 0 = zwykłe. */
void r2d_blend_add(int on);
/* Tekstura w x h (<= 256) z pikseli RGBA (w * h * 4 bajtów, NULL = przezroczysta); bok tekstury = potęga dwójki. */
int r2d_tex_create(RTex *t, int w, int h, const uint8_t *rgba);
void r2d_tex_update(RTex *t, int x, int y, int w, int h, const uint8_t *rgba); /* rgba: w * h * 4, ciasno */
void r2d_tex_free(RTex *t);
/* Wycinek (sx, sy, sw, sh) tekstury w prostokącie (x, y, w, h); tint 0xRRGGBB mnoży kolor, a = krycie 0..255. */
void r2d_image(const RTex *t, float x, float y, float w, float h, float sx, float sy, float sw, float sh, uint32_t tint, int a);

/* ---- tekst "PYŁ 6x8" (Latin-2) */
enum { FONT_OUTLINE, FONT_SHADOW, FONT_PLAIN };
enum { ALIGN_LEFT, ALIGN_CENTER, ALIGN_RIGHT };
void font_init(void);
int font_measure(const char *s, int bold);
/* (x, y) = lewy górny róg komórki pierwszej linii (jak label() z punktem zaczepienia 0,0); scale: 1 = 8 px wysokości. */
void font_draw(float x, float y, const char *s, uint32_t rgb, int a, int style, int bold, float scale);
/* Zawijanie słów do szerokości `wrap` px: zwraca liczbę linii; linie zapisane w buf rozdzielone '\n'. */
int font_wrap(const char *s, int bold, int wrap, char *buf, int cap);
/* Z punktem zaczepienia (ox, oy) w ułamku rozmiaru napisu, jak setOrigin w Phaserze. */
void font_draw_at(float x, float y, float ox, float oy, const char *s, uint32_t rgb, int a, int style, int bold, float scale);

#endif
