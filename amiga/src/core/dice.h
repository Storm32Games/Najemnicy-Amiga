/* Kości, testy k20, stopnie sukcesu. Port src/core/rules/dice.ts. */
#ifndef DICE_H
#define DICE_H

#include <stdint.h>
#include "rng.h"
#include "../data/gamedata.h"

/* Stopnie sukcesu PF2e. */
enum { DEG_CRIT_FAIL = 0, DEG_FAIL = 1, DEG_SUCCESS = 2, DEG_CRIT_SUCCESS = 3 };

#define ROLL_MAX_DICE 24

typedef struct { uint8_t sides, value; } DieRoll;

/* Wynik rzutu (kości w kolejności rzutu - do animacji). */
typedef struct {
  int16_t total;
  int16_t mod;
  uint8_t n;
  DieRoll dice[ROLL_MAX_DICE];
} RollResult;

typedef struct {
  uint8_t d20;    /* po połowieniu - wchodzi do sumy */
  uint8_t raw;    /* surowy k20 */
  uint8_t halves;
  uint8_t degree;
  uint8_t nat20, nat1;
  int16_t mod, total, dc;
} CheckResult;

/* d(n) = 1 + floor(rng() * n). */
int die(Rng *r, int sides);
/* Połowienie z zaokrągleniem w górę, `halves` razy (20 -> 10 -> 5; 1 zostaje 1). */
int halve_die(int v, int halves);
/* Rzut n k sides + mod; każda kość połowiona `halves` razy. `out` może być NULL. Zwraca sumę. */
int roll_dice(Rng *r, int n, int sides, int mod, int halves, RollResult *out);
/* To samo dla Dice z gamedata.h. */
int roll(Rng *r, Dice d, int halves, RollResult *out);

int degree_of(int total, int dc, int nat);
/* Test k20 + mod vs dc; połowiona k20 nie daje naturalnej 20. */
void check(Rng *r, int mod, int dc, int halves, CheckResult *out);
void flat_check(Rng *r, int dc, CheckResult *out);
/* Szansa na co najmniej sukces / krytyk, w dwudziestkach (0..20) - do podpowiedzi UI. */
void hit_chances(int mod, int dc, int halves, int *hit20, int *crit20);

/* Standardowe ST wg poziomu (tabela PF2e, poziom obcięty do zakresu tabeli). */
int dc_for_level(int level);
/* Premia z biegłości: 0 bez szkolenia, inaczej 2 * ranga + poziom. */
int prof_bonus(int rank, int level);

#endif
