/* Obrazy z plików .ntx (tools/amiga/pack_scenes.py): paleta <= 256 + RLE, ładowane do kafli tekstur <= 256 px
 * (core/frontend pot_tiles - jak tiledImage() w grze). */
#ifndef IMG_H
#define IMG_H

#include "r2d.h"
#include "../core/frontend.h"

#define IMG_MAX_TILES 8
typedef struct {
  int w, h, n;
  TexTile tile[IMG_MAX_TILES];
  RTex tex[IMG_MAX_TILES];
} Img;

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

#endif
