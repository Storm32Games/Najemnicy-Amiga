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
static uint32_t be32(const uint8_t *p);
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

/* Dekoduje obraz .ntx z pamięci do nowego bufora RGBA (malloc). NULL = błąd (opis w err). */
uint8_t *ntx_decode(const uint8_t *f, long len, int *w_out, int *h_out) {
  int w, h, n;
  long p, px = 0, total;
  uint8_t *rgba;
  if (len < 10 || (memcmp(f, "NTX1", 4) && memcmp(f, "NTX2", 4))) {
    snprintf(err, sizeof err, "zly format obrazu");
    return NULL;
  }
  w = f[4] << 8 | f[5];
  h = f[6] << 8 | f[7];
  n = f[8] << 8 | f[9];
  total = (long)w * h;
  rgba = (uint8_t *)malloc((size_t)total * 4 + 4);
  if (!rgba) {
    snprintf(err, sizeof err, "brak pamieci");
    return NULL;
  }
  p = 10 + (long)n * 4;
  if (f[3] == '2') {
    /* LZ: indeksy w ostatniej ćwiartce bufora, potem rozwinięcie przez paletę od początku */
    uint8_t *idx = rgba + total * 3;
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
    if (px == total)
      for (px = 0; px < total; px++) memcpy(rgba + px * 4, f + 10 + idx[px] * 4, 4);
  } else
    while (px < total && p < len) {
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
    free(rgba);
    snprintf(err, sizeof err, "uciety obraz");
    return NULL;
  }
  *w_out = w;
  *h_out = h;
  return rgba;
}

int img_from_rgba(Img *im, const uint8_t *rgba, int w, int h) {
  uint8_t *tilebuf;
  int i;
  memset(im, 0, sizeof *im);
  im->w = w;
  im->h = h;
  im->n = pot_tiles(w, h, 256, im->tile, IMG_MAX_TILES);
  if (im->n > IMG_MAX_TILES) {
    im->n = 0;
    snprintf(err, sizeof err, "za duzy obraz");
    return 0;
  }
  tilebuf = (uint8_t *)malloc(256 * 256 * 4);
  if (!tilebuf) return 0;
  for (i = 0; i < im->n; i++) {
    const TexTile *t = &im->tile[i];
    int y;
    for (y = 0; y < t->h; y++) memcpy(tilebuf + (long)y * t->w * 4, rgba + ((long)(t->y + y) * w + t->x) * 4, (size_t)t->w * 4);
    if (!r2d_tex_create(&im->tex[i], t->w, t->h, tilebuf)) {
      snprintf(err, sizeof err, "brak pamieci tekstur");
      free(tilebuf);
      img_free(im);
      return 0;
    }
  }
  free(tilebuf);
  return 1;
}

int img_load(Img *im, const char *name) {
  char path[96];
  long len;
  uint8_t *f, *rgba;
  int w, h, ok;
  memset(im, 0, sizeof *im);
  snprintf(path, sizeof path, GFX_DIR "%s.ntx", name);
  f = read_file(path, &len);
  if (!f) {
    snprintf(err, sizeof err, "brak pliku %s", path);
    return 0;
  }
  rgba = ntx_decode(f, len, &w, &h);
  free(f);
  if (!rgba) {
    snprintf(err + strlen(err), sizeof err - strlen(err), " (%s)", name);
    return 0;
  }
  ok = img_from_rgba(im, rgba, w, h);
  free(rgba);
  if (!ok) snprintf(err + strlen(err), sizeof err - strlen(err), " (%s)", name);
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
static uint32_t be32(const uint8_t *p) {
  return (uint32_t)p[0] << 24 | (uint32_t)p[1] << 16 | (uint32_t)p[2] << 8 | p[3]; }

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

/* ------------------------------------------------------------------ biblioteki .ntl i atlasy składane w locie */
int lib_load(Lib *l, const char *name) {
  char path[96];
  long len, p = 6;
  int i;
  memset(l, 0, sizeof *l);
  snprintf(path, sizeof path, GFX_DIR "%s.ntl", name);
  l->data = read_file(path, &len);
  if (!l->data) {
    snprintf(err, sizeof err, "brak pliku %s", path);
    return 0;
  }
  l->len = len;
  if (len < 6 || memcmp(l->data, "NTL1", 4)) goto bad;
  l->n = l->data[4] << 8 | l->data[5];
  l->e = (LibEntry *)calloc((size_t)l->n, sizeof(LibEntry));
  if (!l->e) goto bad;
  for (i = 0; i < l->n; i++) {
    LibEntry *e = &l->e[i];
    int kl;
    const uint8_t *q;
    if (p >= len) goto bad;
    kl = l->data[p++];
    if (kl > (int)sizeof e->key - 1 || p + kl + 16 > len) goto bad;
    memcpy(e->key, l->data + p, (size_t)kl);
    e->key[kl] = 0;
    p += kl;
    q = l->data + p;
    e->w = q[0] << 8 | q[1];
    e->h = q[2] << 8 | q[3];
    e->ax = (int16_t)(q[4] << 8 | q[5]);
    e->ay = (int16_t)(q[6] << 8 | q[7]);
    e->off = be32(q + 8);
    e->size = be32(q + 12);
    p += 16;
  }
  return 1;
bad:
  snprintf(err, sizeof err, "zly format %s", path);
  lib_free(l);
  return 0;
}

void lib_free(Lib *l) {
  free(l->data);
  free(l->e);
  memset(l, 0, sizeof *l);
}

const LibEntry *lib_find(const Lib *l, const char *key) {
  int lo = 0, hi = l->n - 1;
  while (lo <= hi) {
    int mid = (lo + hi) / 2, c = strcmp(l->e[mid].key, key);
    if (!c) return &l->e[mid];
    if (c < 0) lo = mid + 1;
    else hi = mid - 1;
  }
  return NULL;
}

uint8_t *lib_decode(const Lib *l, const LibEntry *e) {
  int w, h;
  if (e->off + e->size > (uint32_t)l->len) return NULL;
  return ntx_decode(l->data + e->off, (long)e->size, &w, &h);
}

void atlas_init(Atlas *a) { memset(a, 0, sizeof *a); }

int atlas_add(Atlas *a, const uint8_t *rgba, int w, int h, AtlasImg *out) {
  int y;
  if (w > 256 || h > 256) return 0;
  if (!a->n || a->x + w > 256) {
    a->x = 0;
    a->y += a->shelf;
    a->shelf = 0;
  }
  if (!a->n || a->y + h > 256) {
    if (a->n >= ATLAS_MAX) return 0;
    a->buf[a->n] = (uint8_t *)calloc(256 * 256, 4);
    if (!a->buf[a->n]) return 0;
    a->n++;
    a->x = a->y = a->shelf = 0;
  }
  for (y = 0; y < h; y++) memcpy(a->buf[a->n - 1] + ((long)(a->y + y) * 256 + a->x) * 4, rgba + (long)y * w * 4, (size_t)w * 4);
  out->tex = (uint8_t)(a->n - 1);
  out->sx = (uint8_t)a->x;
  out->sy = (uint8_t)a->y;
  out->w = (uint8_t)(w > 255 ? 255 : w);
  out->h = (uint16_t)h;
  a->x += w;
  if (h > a->shelf) a->shelf = h;
  return 1;
}

int atlas_finish(Atlas *a) {
  int i, ok = 1;
  for (i = 0; i < a->n; i++) {
    if (!r2d_tex_create(&a->tex[i], 256, 256, a->buf[i])) ok = 0;
    free(a->buf[i]);
    a->buf[i] = NULL;
  }
  return ok;
}

void atlas_free(Atlas *a) {
  int i;
  for (i = 0; i < ATLAS_MAX; i++) {
    r2d_tex_free(&a->tex[i]);
    free(a->buf[i]);
  }
  memset(a, 0, sizeof *a);
}

void atlas_draw(const Atlas *a, const AtlasImg *im, float x, float y, int flip, uint32_t tint, int alpha) {
  const RTex *t = &a->tex[im->tex];
  if (flip) r2d_image(t, x, y, im->w, im->h, (float)(im->sx + im->w), im->sy, -(float)im->w, im->h, tint, alpha);
  else r2d_image(t, x, y, im->w, im->h, im->sx, im->sy, im->w, im->h, tint, alpha);
}

void atlas_draw_k(const Atlas *a, const AtlasImg *im, float x, float y, float k, int flip, uint32_t tint, int alpha) {
  const RTex *t = &a->tex[im->tex];
  if (flip) r2d_image(t, x, y, im->w * k, im->h * k, (float)(im->sx + im->w), im->sy, -(float)im->w, im->h, tint, alpha);
  else r2d_image(t, x, y, im->w * k, im->h * k, im->sx, im->sy, im->w, im->h, tint, alpha);
}
