/* Zgodność stats.c i character.c z przeglądarką: karty 16 rekrutów (poz. 1/5/10) i 17 wrogów (słaby/zwykły/elitarny). */
#include <stdio.h>
#include <string.h>
#include "../src/core/character.h"
#include "../src/core/dice.h"
#include "vectors_char.h"

static int fails = 0, checks = 0;
#define CHECK(c, ...) do { checks++; if (!(c)) { fails++; printf("FAIL %s:%d: ", __FILE__, __LINE__); printf(__VA_ARGS__); printf("\n"); } } while (0)

static const char *who_key(const VecSheet *v) { return v->kind ? ENEMY_DEFS[v->who].key : RECRUIT_DEFS[v->who].key; }

static void check_sheet(const VecSheet *v) {
  Character ch;
  NormWeapon w[2];
  int i, n;
  const char *k = who_key(v);
  if (v->kind == 0) char_from_recruit(&ch, v->who, NULL, v->arg);
  else char_create_enemy(&ch, v->who, v->arg);

  CHECK(ch.level == v->level, "%s/%d poziom %d != %d", k, v->arg, ch.level, v->level);
  CHECK(ch.max_hp == v->max_hp && ch.hp == v->max_hp, "%s/%d PW %d != %d", k, v->arg, ch.max_hp, v->max_hp);
  for (i = 0; i < ATTR_COUNT; i++) CHECK(ch.attrs[i] == v->attrs[i], "%s/%d cecha %d: %d != %d", k, v->arg, i, ch.attrs[i], v->attrs[i]);

  CHECK(ch.n_abilities == v->n_abil, "%s/%d liczba zdolnosci %d != %d", k, v->arg, ch.n_abilities, v->n_abil);
  for (i = 0; i < v->n_abil && i < ch.n_abilities; i++)
    CHECK(ch.abilities[i] == v->abil[i], "%s/%d zdolnosc %d: %s != %s", k, v->arg, i, ABILITY_DEFS[ch.abilities[i]].key, ABILITY_DEFS[v->abil[i]].key);
  {
    int tracked = 0;
    for (i = 0; i < ABIL_COUNT; i++) if (ch.uses[i] != USES_UNSET) tracked++;
    CHECK(tracked == v->n_uses, "%s/%d liczba limitow %d != %d", k, v->arg, tracked, v->n_uses);
    for (i = 0; i < v->n_uses; i++)
      CHECK(ch.uses[v->uses[i].id] == v->uses[i].n, "%s/%d uzycia %s: %d != %d", k, v->arg, ABILITY_DEFS[v->uses[i].id].key, ch.uses[v->uses[i].id], v->uses[i].n);
  }

  for (i = 0; i < SLOT_COUNT; i++) CHECK(ch.equip[i].id == v->equip[i], "%s/%d slot %d: %d != %d", k, v->arg, i, ch.equip[i].id, v->equip[i]);
  CHECK(ch.n_inv == v->n_inv, "%s/%d plecak %d != %d", k, v->arg, ch.n_inv, v->n_inv);
  for (i = 0; i < v->n_inv && i < ch.n_inv; i++)
    CHECK(ch.inv[i].id == v->inv[i].id && ch.inv[i].qty == v->inv[i].qty, "%s/%d plecak[%d]", k, v->arg, i);

  for (i = 0; i < v->n_stats; i++) {
    int s = get_stat(&ch, v->stats[i].key, 0);
    CHECK(s == v->stats[i].value, "%s/%d stat %d: %d != %d", k, v->arg, v->stats[i].key, s, v->stats[i].value);
  }

  n = get_weapons(&ch, w);
  CHECK(n == v->n_attacks, "%s/%d liczba broni %d != %d", k, v->arg, n, v->n_attacks);
  for (i = 0; i < n && i < v->n_attacks; i++) {
    const VecAttack *a = &v->attacks[i];
    int m;
    CHECK(w[i].dmg.n == a->dmg.n && w[i].dmg.sides == a->dmg.sides && w[i].dmg.mod == a->dmg.mod && w[i].range == a->range,
          "%s/%d bron %d: %dd%d%+d r%d != %dd%d%+d r%d", k, v->arg, i, w[i].dmg.n, w[i].dmg.sides, w[i].dmg.mod, w[i].range,
          a->dmg.n, a->dmg.sides, a->dmg.mod, a->range);
    for (m = 0; m < 3; m++) {
      int b = get_attack_bonus(&ch, &w[i], m, 0);
      CHECK(b == a->bonus[m], "%s/%d bron %d PWA %d: %d != %d", k, v->arg, i, m, b, a->bonus[m]);
    }
  }
}

int main(void) {
  unsigned i;
  for (i = 0; i < VEC_SHEETS_N; i++) check_sheet(&VEC_SHEETS[i]);

  /* stany (wartości oczekiwane policzone w TS): Hak poz. 1 ma KP 19; wartości, maksimum, martwi, niewrażliwi na truciznę, kości ciągłe */
  {
    Character ch, robot;
    Dice d1d6 = {1, 6, 0};
    char_from_recruit(&ch, RECRUIT_HAK, NULL, 1);
    add_condition(&ch, COND_FRIGHTENED, 1);
    add_condition(&ch, COND_FRIGHTENED, 2);
    add_condition(&ch, COND_FRIGHTENED, 1);
    CHECK(cond_value(&ch, COND_FRIGHTENED) == 2 && die_halves(&ch) == 1, "frightened max");
    add_condition_dice(&ch, COND_BLEEDING, d1d6);
    CHECK(cond_value(&ch, COND_BLEEDING) == 1 && ch.cond_dice[COND_BLEEDING].sides == 6, "bleeding dice");
    add_condition(&ch, COND_SICKENED, 2);
    CHECK(get_stat(&ch, STAT_AC, 0) == 17 && status_penalty(&ch) == 2, "sickened AC %d", get_stat(&ch, STAT_AC, 0));
    remove_condition(&ch, COND_SICKENED);
    add_condition(&ch, COND_PRONE, 1);
    CHECK(get_stat(&ch, STAT_AC, 0) == 17 && is_off_guard(&ch), "prone AC %d", get_stat(&ch, STAT_AC, 0));
    add_condition(&ch, COND_IN_COVER, 2);
    CHECK(get_stat(&ch, STAT_AC, 0) == 21 && get_stat(&ch, STAT_AC, 1) == 17, "cover AC %d", get_stat(&ch, STAT_AC, 0));
    add_condition(&ch, COND_DEAD, 1);
    add_condition(&ch, COND_STUNNED, 1);
    CHECK(!has_cond(&ch, COND_STUNNED), "dead blocks conditions");
    char_create_enemy(&robot, ENEMY_ROBOT, 0);
    add_condition_dice(&robot, COND_POISONED, d1d6);
    CHECK(!has_cond(&robot, COND_POISONED), "robot immune to poison");
  }

  /* PD: 1000 na poziom, maks. 10, nadwyżka obcięta */
  {
    Character ch;
    char_from_recruit(&ch, RECRUIT_SOWA, NULL, 1);
    CHECK(add_xp(&ch, 2500) == 2 && ch.level == 3 && ch.xp == 500, "add_xp");
    CHECK(add_xp(&ch, 20000) == 7 && ch.level == 10 && ch.xp == 999, "add_xp cap %d %d", ch.level, ch.xp);
    {
      uint8_t lv[3] = {1, 3, 0};
      CHECK(encounter_xp(1, lv, 3) == 40 + 80 + 30, "encounter_xp");
    }
  }

  printf("test_character: %d checks, %d failures\n", checks, fails);
  return fails ? 1 : 0;
}
