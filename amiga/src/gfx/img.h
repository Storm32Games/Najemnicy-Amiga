/* Obrazy z plików .ntx (tools/amiga/pack_scenes.py): paleta <= 256 + RLE, ładowane do kafli tekstur <= 256 px
 * (core/frontend pot_tiles - jak tiledImage() w grze). */
#ifndef IMG_H
#define IMG_H

#include "r2d.h"
#include "../core/frontend.h"

#define IMG_MAX_TILES 16
typedef struct {
  int w, h, n;
  TexTile tile[IMG_MAX_TILES];
  RTex tex[IMG_MAX_TILES];
} Img;

/* Dekodowanie .ntx z pamięci (malloc, w * h * 4) i obraz z gotowych pikseli (kafle <= 256). */
uint8_t *ntx_decode(const uint8_t *f, long len, int *w, int *h);
int img_from_rgba(Img *im, const uint8_t *rgba, int w, int h);
/* "title_sky" -> gfx/title_sky.ntx (na Amidze PROGDIR:gfx/). 0 = błąd (brak pliku / pamięci). */
int img_load(Img *im, const char *name);
void img_free(Img *im);
/* Cały obraz 1:1 z lewym górnym rogiem w (x, y); a = krycie 0..255. */
void img_draw(const Img *im, float x, float y, int a);
/* Wycinek (sx, sy, sw, sh) obrazu z jednego kafla (np. klatka postaci), skala k, flip = lustro w poziomie. */
void img_draw_part(const Img *im, int sx, int sy, int sw, int sh, float x, float y, float k, int flip, uint32_t tint, int a);
/* Cały obraz przeskalowany: k wokół punktu (ax, ay) obrazu stojącego w (x, y) - jak setScale z setOrigin. */
void img_draw_scaled(const Img *im, float x, float y, float ax, float ay, float k, uint32_t tint, int a);
/* Ostatni błąd img_load (do komunikatu). */
const char *img_error(void);

/* ---- animacja .nta (klatki z jednej palety, LZ względem poprzedniej klatki) */
typedef struct {
  int w, h, n, ms, t0, at;
  uint8_t pal[256 * 4];
  uint8_t *data;          /* cały plik */
  long *ofs;              /* początki klatek */
  uint8_t *prev, *cur, *rgba;
  Img img;
} Anim;
int anim_load(Anim *a, const char *name);
void anim_free(Anim *a);
/* Ustawia klatkę `f` (dekoduje kolejno od ostatniej, przy cofaniu od zera) i ładuje ją do tekstur. */
void anim_seek(Anim *a, int f);

/* ---- biblioteki .ntl (wiele obrazów z kluczami, tools/amiga/pack_scenes.py write_library) */
typedef struct { char key[40]; int w, h, ax, ay; uint32_t off, size; } LibEntry;
typedef struct { uint8_t *data; long len; int n; LibEntry *e; } Lib;
int lib_load(Lib *l, const char *name);
void lib_free(Lib *l);
const LibEntry *lib_find(const Lib *l, const char *key);
uint8_t *lib_decode(const Lib *l, const LibEntry *e);   /* malloc RGBA */

/* ---- atlas składany w locie: półki w teksturach 256x256 */
#define ATLAS_MAX 48
typedef struct { uint8_t tex, sx, sy, w; uint16_t h; } AtlasImg;
typedef struct { RTex tex[ATLAS_MAX]; uint8_t *buf[ATLAS_MAX]; int n, x, y, shelf; } Atlas;
void atlas_init(Atlas *a);
int atlas_add(Atlas *a, const uint8_t *rgba, int w, int h, AtlasImg *out);
int atlas_finish(Atlas *a);   /* wysyła bufory do tekstur */
void atlas_free(Atlas *a);
void atlas_draw(const Atlas *a, const AtlasImg *im, float x, float y, int flip, uint32_t tint, int alpha);

#endif
