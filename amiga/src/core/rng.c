#include "rng.h"

/* ISO-8859-2 0xA0..0xFF -> Unicode. */
static const uint16_t LATIN2_HI[96] = {
  0x00a0, 0x0104, 0x02d8, 0x0141, 0x00a4, 0x013d, 0x015a, 0x00a7, 0x00a8, 0x0160, 0x015e, 0x0164, 0x0179, 0x00ad, 0x017d, 0x017b,
  0x00b0, 0x0105, 0x02db, 0x0142, 0x00b4, 0x013e, 0x015b, 0x02c7, 0x00b8, 0x0161, 0x015f, 0x0165, 0x017a, 0x02dd, 0x017e, 0x017c,
  0x0154, 0x00c1, 0x00c2, 0x0102, 0x00c4, 0x0139, 0x0106, 0x00c7, 0x010c, 0x00c9, 0x0118, 0x00cb, 0x011a, 0x00cd, 0x00ce, 0x010e,
  0x0110, 0x0143, 0x0147, 0x00d3, 0x00d4, 0x0150, 0x00d6, 0x00d7, 0x0158, 0x016e, 0x00da, 0x0170, 0x00dc, 0x00dd, 0x0162, 0x00df,
  0x0155, 0x00e1, 0x00e2, 0x0103, 0x00e4, 0x013a, 0x0107, 0x00e7, 0x010d, 0x00e9, 0x0119, 0x00eb, 0x011b, 0x00ed, 0x00ee, 0x010f,
  0x0111, 0x0144, 0x0148, 0x00f3, 0x00f4, 0x0151, 0x00f6, 0x00f7, 0x0159, 0x016f, 0x00fa, 0x0171, 0x00fc, 0x00fd, 0x0163, 0x02d9,
};

uint16_t latin2_unicode(unsigned char c) { return c >= 0xA0 ? LATIN2_HI[c - 0xA0] : c; }

#define FNV_OFFSET 2166136261UL
#define FNV_PRIME 16777619UL

uint32_t hash_seed_utf16(const uint16_t *units, size_t n) {
  uint32_t h = FNV_OFFSET;
  size_t i;
  for (i = 0; i < n; i++) {
    h ^= units[i];
    h *= FNV_PRIME; /* Math.imul: mnożenie modulo 2^32 */
  }
  return h;
}

uint32_t hash_seed_latin2(const char *s) {
  uint32_t h = FNV_OFFSET;
  const unsigned char *p = (const unsigned char *)s;
  for (; *p; p++) {
    h ^= latin2_unicode(*p);
    h *= FNV_PRIME;
  }
  return h;
}

void rng_seed(Rng *r, uint32_t seed) { r->a = seed; }
void rng_seed_str(Rng *r, const char *latin2) { r->a = hash_seed_latin2(latin2); }

uint32_t rng_next(Rng *r) {
  uint32_t t;
  r->a += 0x6D2B79F5UL;
  t = r->a;
  t = (t ^ (t >> 15)) * (t | 1u);
  t ^= t + (t ^ (t >> 7)) * (t | 61u);
  return t ^ (t >> 14);
}

uint32_t rng_below(Rng *r, uint32_t n) {
  return (uint32_t)(((uint64_t)rng_next(r) * n) >> 32);
}

int rng_chance(Rng *r, uint32_t le) { return rng_next(r) <= le; }

int32_t rng_int(Rng *r, int32_t a, int32_t b) {
  return a + (int32_t)rng_below(r, (uint32_t)(b - a + 1));
}
