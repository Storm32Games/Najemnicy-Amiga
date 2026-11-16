#include "dice.h"

int die(Rng *r, int sides) { return 1 + (int)rng_below(r, (uint32_t)sides); }

int halve_die(int v, int halves) {
  for (; halves > 0; halves--) v = (v + 1) >> 1; /* ceil(v / 2) dla v >= 0 */
  return v;
}

int roll_dice(Rng *r, int n, int sides, int mod, int halves, RollResult *out) {
  int total = 0, i;
  if (out) out->n = 0;
  for (i = 0; i < n; i++) {
    int v = halve_die(die(r, sides), halves);
    if (out && out->n < ROLL_MAX_DICE) {
      out->dice[out->n].sides = (uint8_t)sides;
      out->dice[out->n].value = (uint8_t)v;
      out->n++;
    }
    total += v;
  }
  total += mod;
  if (out) {
    out->total = (int16_t)total;
    out->mod = (int16_t)mod;
  }
  return total;
}

int roll(Rng *r, Dice d, int halves, RollResult *out) {
  return roll_dice(r, d.n, d.sides, d.mod, halves, out);
}

int degree_of(int total, int dc, int nat) {
  int deg = total >= dc + 10 ? 3 : total >= dc ? 2 : total <= dc - 10 ? 0 : 1;
  if (nat == 20) deg = deg < 3 ? deg + 1 : 3;
  else if (nat == 1) deg = deg > 0 ? deg - 1 : 0;
  return deg;
}

void check(Rng *r, int mod, int dc, int halves, CheckResult *out) {
  int raw = die(r, 20);
  int v = halve_die(raw, halves);
  int total = v + mod;
  out->raw = (uint8_t)raw;
  out->d20 = (uint8_t)v;
  out->halves = (uint8_t)halves;
  out->mod = (int16_t)mod;
  out->total = (int16_t)total;
  out->dc = (int16_t)dc;
  out->degree = (uint8_t)degree_of(total, dc, v);
  out->nat20 = v == 20;
  out->nat1 = v == 1;
}

void flat_check(Rng *r, int dc, CheckResult *out) { check(r, 0, dc, 0, out); }

void hit_chances(int mod, int dc, int halves, int *hit20, int *crit20) {
  int k, hit = 0, crit = 0;
  for (k = 1; k <= 20; k++) {
    int v = halve_die(k, halves);
    int g = degree_of(v + mod, dc, v);
    if (g >= 2) hit++;
    if (g == 3) crit++;
  }
  *hit20 = hit;
  *crit20 = crit;
}

int dc_for_level(int level) {
  if (level < 0) level = 0;
  if (level > DC_TABLE_LEN - 1) level = DC_TABLE_LEN - 1;
  return DC_TABLE[level];
}

int prof_bonus(int rank, int level) { return rank > 0 ? 2 * rank + level : 0; }
