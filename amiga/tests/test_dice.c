/* Zgodność rng.c i dice.c z logiką przeglądarki (wektory z src/core przez test_vectors.json). */
#include <stdio.h>
#include "../src/core/rng.h"
#include "../src/core/dice.h"
#include "vectors_dice.h"

static int fails = 0, checks = 0;
#define CHECK(c, ...) do { checks++; if (!(c)) { fails++; printf("FAIL %s:%d: ", __FILE__, __LINE__); printf(__VA_ARGS__); printf("\n"); } } while (0)

int main(void) {
  unsigned i, j;
  Rng r;

  for (i = 0; i < VEC_HASH_N; i++) {
    uint32_t h = hash_seed_latin2(VEC_HASH[i].s);
    CHECK(h == VEC_HASH[i].h, "hash \"%s\": %lu != %lu", VEC_HASH[i].s, (unsigned long)h, (unsigned long)VEC_HASH[i].h);
  }

  for (i = 0; i < VEC_MULBERRY_N; i++) {
    const VecMulberry *m = &VEC_MULBERRY[i];
    if (m->seed_str) rng_seed_str(&r, m->seed_str);
    else rng_seed(&r, m->seed);
    for (j = 0; j < m->n; j++) {
      uint32_t u = rng_next(&r);
      CHECK(u == m->u32[j], "mulberry32 #%u[%u]: %lu != %lu", i, j, (unsigned long)u, (unsigned long)m->u32[j]);
    }
  }

  for (i = 0; i < VEC_DIE_SEQ_N; i++) {
    rng_seed_str(&r, VEC_DIE_SEQ[i].seed);
    for (j = 0; j < 24; j++) {
      int v = die(&r, VEC_DIE_SEQ[i].sides);
      CHECK(v == VEC_DIE_SEQ[i].values[j], "d%u[%u]: %d != %u", VEC_DIE_SEQ[i].sides, j, v, VEC_DIE_SEQ[i].values[j]);
    }
  }

  rng_seed_str(&r, VEC_RANDINT_SEED);
  for (j = 0; j < 24; j++) {
    int32_t v = rng_int(&r, VEC_RANDINT_A, VEC_RANDINT_B);
    CHECK(v == VEC_RANDINT[j], "randInt[%u]: %ld != %d", j, (long)v, VEC_RANDINT[j]);
  }

  for (i = 0; i < VEC_ROLL_N; i++) {
    const VecRoll *x = &VEC_ROLL[i];
    RollResult rr;
    Dice d;
    int total;
    d.n = x->n;
    d.sides = x->sides;
    d.mod = x->mod;
    rng_seed_str(&r, x->seed);
    total = roll(&r, d, x->halves, &rr);
    CHECK(total == x->total, "roll %s: %d != %d", x->seed, total, x->total);
    for (j = 0; j < rr.n; j++) CHECK(rr.dice[j].value == x->values[j], "roll %s kosc %u: %u != %u", x->seed, j, rr.dice[j].value, x->values[j]);
  }

  {
    const char *seed = NULL;
    for (i = 0; i < VEC_CHECK_N; i++) {
      const VecCheck *x = &VEC_CHECK[i];
      CheckResult c;
      if (seed != x->seed) {
        rng_seed_str(&r, x->seed);
        seed = x->seed;
      }
      check(&r, x->mod, x->dc, x->halves, &c);
      CHECK(c.raw == x->raw && c.d20 == x->d20 && c.total == x->total && c.degree == x->degree,
            "check %s k=%u: raw %u/%u d20 %u/%u total %d/%d deg %u/%u", x->seed, x->k, c.raw, x->raw, c.d20, x->d20, c.total, x->total, c.degree, x->degree);
    }
  }

  for (i = 0; i < VEC_CHANCE_N; i++) {
    const VecChance *x = &VEC_CHANCE[i];
    int hit, crit;
    hit_chances(x->mod, x->dc, x->halves, &hit, &crit);
    CHECK(hit == x->hit20 && crit == x->crit20, "chances mod %d dc %u h %u: %d/%d != %u/%u", x->mod, x->dc, x->halves, hit, crit, x->hit20, x->crit20);
  }

  /* drobne */
  CHECK(halve_die(20, 1) == 10 && halve_die(20, 2) == 5 && halve_die(1, 3) == 1 && halve_die(7, 1) == 4, "halve_die");
  CHECK(dc_for_level(-1) == 14 && dc_for_level(3) == 18 && dc_for_level(99) == DC_TABLE[DC_TABLE_LEN - 1], "dc_for_level");
  CHECK(prof_bonus(0, 5) == 0 && prof_bonus(2, 3) == 7, "prof_bonus");
  CHECK(degree_of(25, 15, 5) == 3 && degree_of(24, 15, 20) == 3 && degree_of(15, 15, 1) == 1 && degree_of(5, 15, 1) == 0, "degree_of");

  printf("test_dice: %d checks, %d failures\n", checks, fails);
  return fails ? 1 : 0;
}
