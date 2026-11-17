/* Ładowanie .ntx i rysowanie kafli. Opis formatu: tools/amiga/pack_scenes.py. */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "img.h"

#if defined(NAJ_AMIGA)
#define GFX_DIR "PROGDIR:gfx/"
#else
#define GFX_DIR "gfx/"
#endif

static char err[192];
const char *img_error(void) { return err; }

static uint8_t *read_file(const char *path, long *len) {
  FILE *f = fopen(path, "rb");
  uint8_t *buf;
  if (!f) return NULL;
  fseek(f, 0, SEEK_END);
  *len = ftell(f);
  fseek(f, 0, SEEK_SET);
  buf = (uint8_t *)malloc((size_t)*len);
  if (buf && fread(buf, 1, (size_t)*len, f) != (size_t)*len) {
    free(buf);
    buf = NULL;
  }
  fclose(f);
  return buf;
}

int img_load(Img *im, const char *name) {
  char path[96];
  long len, p;
  uint8_t *f, *rgba, *tilebuf;
  int w, h, n, i, ok = 0;
  long px = 0, total;
  memset(im, 0, sizeof *im);
  snprintf(path, sizeof path, GFX_DIR "%s.ntx", name);
  f = read_file(path, &len);
  if (!f) {
    snprintf(err, sizeof err, "brak pliku %s", path);
    return 0;
  }
  if (len < 10 || (memcmp(f, "NTX1", 4) && memcmp(f, "NTX2", 4))) {
    snprintf(err, sizeof err, "zly format %s", path);
    free(f);
    return 0;
  }
  w = f[4] << 8 | f[5];
  h = f[6] << 8 | f[7];
  n = f[8] << 8 | f[9];
  total = (long)w * h;
  rgba = (uint8_t *)malloc((size_t)total * 4);
  tilebuf = (uint8_t *)malloc(256 * 256 * 4);
  if (!rgba || !tilebuf) {
    snprintf(err, sizeof err, "brak pamieci na %s", name);
    goto out;
  }
  p = 10 + (long)n * 4;
  if (f[3] == '2') {
    /* LZ: kopie z odległości wstecz w obrębie obrazu (indeksy w rgba jako bajty, potem rozwinięcie przez paletę) */
    uint8_t *idx = rgba + total * 3;   /* ostatnia ćwiartka bufora RGBA */
    while (px < total && p < len) {
      int c = f[p++];
      if (c < 128) {
        int k = c + 1;
        while (k-- && px < total && p < len) idx[px++] = f[p++];
      } else {
        int k = c - 125;
        long d = (long)f[p] << 16 | (long)f[p + 1] << 8 | f[p + 2];
        p += 3;
        while (k-- && px < total) {
          idx[px] = idx[px - d];
          px++;
        }
      }
    }
    if (px < total) {
      snprintf(err, sizeof err, "uciety plik %s", path);
      goto out;
    }
    for (px = 0; px < total; px++) memcpy(rgba + px * 4, f + 10 + idx[px] * 4, 4);   /* idx za rgba[px*4]: bezpieczne */
  }
  /* RLE indeksów palety -> RGBA */
  while (f[3] == '1' && px < total && p < len) {
    int c = f[p++];
    if (c < 128) {
      int k = c + 1;
      while (k-- && px < total && p < len) memcpy(rgba + px++ * 4, f + 10 + f[p++] * 4, 4);
    } else {
      int k = c - 125;
      const uint8_t *col = f + 10 + f[p++] * 4;
      while (k-- && px < total) memcpy(rgba + px++ * 4, col, 4);
    }
  }
  if (px < total) {
    snprintf(err, sizeof err, "uciety plik %s", path);
    goto out;
  }
  im->w = w;
  im->h = h;
  im->n = pot_tiles(w, h, 256, im->tile, IMG_MAX_TILES);
  if (im->n > IMG_MAX_TILES) {
    im->n = 0;
    snprintf(err, sizeof err, "za duzy obraz %s", name);
    goto out;
  }
  for (i = 0; i < im->n; i++) {
    const TexTile *t = &im->tile[i];
    int y;
    for (y = 0; y < t->h; y++) memcpy(tilebuf + (long)y * t->w * 4, rgba + ((long)(t->y + y) * w + t->x) * 4, (size_t)t->w * 4);
    if (!r2d_tex_create(&im->tex[i], t->w, t->h, tilebuf)) {
      snprintf(err, sizeof err, "brak pamieci tekstur (%s)", name);
      goto out;
    }
  }
  ok = 1;
out:
  free(f);
  free(rgba);
  free(tilebuf);
  if (!ok) img_free(im);
  return ok;
}

void img_free(Img *im) {
  int i;
  for (i = 0; i < IMG_MAX_TILES; i++) r2d_tex_free(&im->tex[i]);
  im->n = 0;
}

void img_draw(const Img *im, float x, float y, int a) {
  int i;
  for (i = 0; i < im->n; i++) {
    const TexTile *t = &im->tile[i];
    r2d_image(&im->tex[i], x + t->x, y + t->y, (float)t->w, (float)t->h, 0, 0, (float)t->w, (float)t->h, 0xffffff, a);
  }
}

void img_draw_scaled(const Img *im, float x, float y, float ax, float ay, float k, uint32_t tint, int a) {
  int i;
  for (i = 0; i < im->n; i++) {
    const TexTile *t = &im->tile[i];
    r2d_image(&im->tex[i], x + ax + (t->x - ax) * k, y + ay + (t->y - ay) * k, t->w * k, t->h * k, 0, 0, (float)t->w, (float)t->h, tint, a);
  }
}

void img_draw_part(const Img *im, int sx, int sy, int sw, int sh, float x, float y, float k, int flip, uint32_t tint, int a) {
  int i;
  for (i = 0; i < im->n; i++) {
    const TexTile *t = &im->tile[i];
    if (sx < t->x || sy < t->y || sx + sw > t->x + t->w || sy + sh > t->y + t->h) continue;
    if (flip) r2d_image(&im->tex[i], x, y, sw * k, sh * k, (float)(sx - t->x + sw), (float)(sy - t->y), (float)-sw, (float)sh, tint, a);
    else r2d_image(&im->tex[i], x, y, sw * k, sh * k, (float)(sx - t->x), (float)(sy - t->y), (float)sw, (float)sh, tint, a);
    return;
  }
}

/* ------------------------------------------------------------------ animacja .nta */
static uint32_t be32(const uint8_t *p) { return (uint32_t)p[0] << 24 | (uint32_t)p[1] << 16 | (uint32_t)p[2] << 8 | p[3]; }

int anim_load(Anim *a, const char *name) {
  char path[96];
  long len, p;
  int i, ncol;
  memset(a, 0, sizeof *a);
  snprintf(path, sizeof path, GFX_DIR "%s.nta", name);
  a->data = read_file(path, &len);
  if (!a->data) {
    snprintf(err, sizeof err, "brak pliku %s", path);
    return 0;
  }
  if (len < 16 || memcmp(a->data, "NTA1", 4)) goto bad;
  a->w = a->data[4] << 8 | a->data[5];
  a->h = a->data[6] << 8 | a->data[7];
  a->n = a->data[8] << 8 | a->data[9];
  a->ms = a->data[10] << 8 | a->data[11];
  a->t0 = a->data[12] << 8 | a->data[13];
  ncol = a->data[14] << 8 | a->data[15];
  if (ncol > 256) goto bad;
  memcpy(a->pal, a->data + 16, (size_t)ncol * 4);
  a->ofs = (long *)malloc(sizeof(long) * (size_t)a->n);
  a->prev = (uint8_t *)malloc((size_t)a->w * a->h);
  a->cur = (uint8_t *)malloc((size_t)a->w * a->h);
  a->rgba = (uint8_t *)malloc(256 * 256 * 4);
  if (!a->ofs || !a->prev || !a->cur || !a->rgba) {
    snprintf(err, sizeof err, "brak pamieci na %s", name);
    anim_free(a);
    return 0;
  }
  p = 16 + (long)ncol * 4;
  for (i = 0; i < a->n; i++) {
    if (p + 4 > len) goto bad;
    a->ofs[i] = p + 4;
    p += 4 + (long)be32(a->data + p);
  }
  a->img.w = a->w;
  a->img.h = a->h;
  a->img.n = pot_tiles(a->w, a->h, 256, a->img.tile, IMG_MAX_TILES);
  if (a->img.n > IMG_MAX_TILES) goto bad;
  for (i = 0; i < a->img.n; i++)
    if (!r2d_tex_create(&a->img.tex[i], a->img.tile[i].w, a->img.tile[i].h, NULL)) {
      snprintf(err, sizeof err, "brak pamieci tekstur (%s)", name);
      anim_free(a);
      return 0;
    }
  a->at = -1;
  anim_seek(a, 0);
  return 1;
bad:
  snprintf(err, sizeof err, "zly format %s", path);
  anim_free(a);
  return 0;
}

void anim_free(Anim *a) {
  img_free(&a->img);
  free(a->data);
  free(a->ofs);
  free(a->prev);
  free(a->cur);
  free(a->rgba);
  memset(a, 0, sizeof *a);
}

static void decode(Anim *a, int f) {
  const uint8_t *s = a->data + a->ofs[f], *end = s + be32(a->data + a->ofs[f] - 4);
  long n = (long)a->w * a->h, o = 0;
  uint8_t *t = a->prev;
  a->prev = a->cur;     /* poprzednia klatka = dotychczasowa bieżąca */
  a->cur = t;
  while (s < end && o < n) {
    int c = *s++;
    if (c < 128) {
      int k = c + 1;
      while (k-- && o < n) a->cur[o++] = *s++;
    } else {
      int k = c - 125;
      long d = (long)s[0] << 16 | (long)s[1] << 8 | s[2], from = o - d;
      s += 3;
      while (k-- && o < n) {
        a->cur[o++] = from < 0 ? a->prev[n + from] : a->cur[from];
        from++;
      }
    }
  }
}

void anim_seek(Anim *a, int f) {
  int i;
  if (f < 0) f = 0;
  if (f >= a->n) f = a->n - 1;
  if (f == a->at) return;
  if (f < a->at || a->at < 0) a->at = -1;
  while (a->at < f) decode(a, ++a->at);
  for (i = 0; i < a->img.n; i++) {
    const TexTile *t = &a->img.tile[i];
    int x, y;
    for (y = 0; y < t->h; y++) {
      const uint8_t *src = a->cur + (long)(t->y + y) * a->w + t->x;
      uint8_t *dst = a->rgba + (long)y * t->w * 4;
      for (x = 0; x < t->w; x++, dst += 4) memcpy(dst, a->pal + src[x] * 4, 4);
    }
    r2d_tex_update(&a->img.tex[i], 0, 0, t->w, t->h, a->rgba);
  }
}
