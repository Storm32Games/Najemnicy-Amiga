/* Losowość: FNV-1a (ziarna map i sklepów) i mulberry32. Port src/core/rules/dice.ts (hashSeed, makeRng).
 * Zgodność bitowa z przeglądarką: amiga/tests/test_dice.c (wektory z test_vectors.json). */
#ifndef RNG_H
#define RNG_H

#include <stdint.h>
#include <stddef.h>

/* FNV-1a po jednostkach kodu UTF-16 (jak JS charCodeAt). */
uint32_t hash_seed_utf16(const uint16_t *units, size_t n);
/* Tekst ISO-8859-2 zakończony zerem (bajty przekładane na Unicode; ASCII bez zmian). */
uint32_t hash_seed_latin2(const char *s);

/* mulberry32: stan 32-bit. JS rng() = rng_next(r) / 2^32. */
typedef struct { uint32_t a; } Rng;

void rng_seed(Rng *r, uint32_t seed);
void rng_seed_str(Rng *r, const char *latin2); /* makeRng('tekst') */
uint32_t rng_next(Rng *r);

/* floor(rng() * n) - identycznie jak w JS, n >= 1. */
uint32_t rng_below(Rng *r, uint32_t n);
/* rng() < p, gdzie le = ceil(p * 2^32) - 1 (progi *_LE w gamedata.h). */
int rng_chance(Rng *r, uint32_t le);
/* randInt(a, b): a + floor(rng() * (b - a + 1)). */
int32_t rng_int(Rng *r, int32_t a, int32_t b);

#endif
