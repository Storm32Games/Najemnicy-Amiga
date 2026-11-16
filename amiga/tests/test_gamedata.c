/* Test wygenerowanych tabel (amiga/src/data). Natywnie: make -C amiga test; pod 68k: make -C amiga m68k */
#include <stdio.h>
#include <string.h>
#include "../src/data/gamedata.h"

static int fails = 0, checks = 0;
#define CHECK(c) do { checks++; if (!(c)) { fails++; printf("FAIL %s:%d: %s\n", __FILE__, __LINE__, #c); } } while (0)

int main(void) {
  int i;
  /* liczności */
  CHECK(ITEM_COUNT == 53 && ENEMY_COUNT == 17 && ABIL_COUNT == 46 && CLASS_COUNT == 12 && ANC_COUNT == 8);
  CHECK(RECRUIT_COUNT == 16 && COND_COUNT == 27 && SKILL_COUNT == 13);

  /* klucze w kolejności enumów */
  CHECK(strcmp(ITEM_DEFS[ITEM_KNIFE].key, "knife") == 0);
  CHECK(strcmp(ITEM_DEFS[ITEM_FIST].key, "fist") == 0);
  CHECK(strcmp(ENEMY_DEFS[ENEMY_KOSTUCHA].key, "kostucha") == 0);
  CHECK(strcmp(ABILITY_DEFS[ABIL_KOSTUCHA_COMMAND].key, "kostucha_command") == 0);
  CHECK(strcmp(RECRUIT_DEFS[RECRUIT_ZERO].key, "zero") == 0);

  /* broń: Nóż 1d4 kłute, agile + finesse; Rewolwer fatal 12; Łuk deadly 10 */
  {
    const WeaponStats *w = ITEM_DEFS[ITEM_KNIFE].weapon;
    CHECK(w && w->damage.n == 1 && w->damage.sides == 4 && w->damage.mod == 0 && w->dmg_type == DMG_P);
    CHECK(w && (w->traits & WT_AGILE) && (w->traits & WT_FINESSE) && !(w->traits & WT_REACH));
    CHECK(ITEM_DEFS[ITEM_REVOLVER].weapon->fatal == 12 && ITEM_DEFS[ITEM_BOW].weapon->deadly == 10);
    CHECK(ITEM_DEFS[ITEM_KNIFE].armor == NULL && ITEM_DEFS[ITEM_KEVLAR].armor != NULL);
    CHECK(ITEM_DEFS[ITEM_FIST].weapon->category == WCAT_UNARMED);
  }
  /* pancerz wspomagany: KP 6, limit ZR 0, kara Prędkości 1, ciężki */
  CHECK(ITEM_DEFS[ITEM_POWER_ARMOR].armor->ac == 6 && ITEM_DEFS[ITEM_POWER_ARMOR].armor->speed_penalty == 1 &&
        ITEM_DEFS[ITEM_POWER_ARMOR].armor->category == DEF_HEAVY);
  /* koktajl: obszar, RO Refleks ST 15, płonie 1k4 */
  {
    const ConsumableStats *c = ITEM_DEFS[ITEM_MOLOTOV].consumable;
    CHECK(c && c->effect == CEFFECT_DAMAGE && c->save == SAVE_REFLEX && c->dc == 15 && c->cond == COND_BURNING);
    CHECK(c && c->cond_value.dice.n == 1 && c->cond_value.dice.sides == 4);
    CHECK(ITEM_DEFS[ITEM_MEDKIT].consumable->cures == ((1UL << COND_BLEEDING) | (1UL << COND_POISONED)));
  }

  /* klasy */
  CHECK(CLASS_DEFS[CLASS_SOLDIER].hp_per_level == 10 && CLASS_DEFS[CLASS_BRUTE].hp_per_level == 12);
  CHECK(CLASS_DEFS[CLASS_SOLDIER].start_gear[0] == ITEM_RIFLE && CLASS_DEFS[CLASS_SOLDIER].n_start_gear == 5);
  CHECK(CLASS_DEFS[CLASS_SOLDIER].progression[3].fortitude == 3 && CLASS_DEFS[CLASS_SOLDIER].progression[5].attacks[WCAT_MARTIAL] == 3);
  CHECK(CLASS_DEFS[CLASS_SOLDIER].progression[4].fortitude == 0);
  CHECK(CLASS_DEFS[CLASS_SOLDIER].abilities[3] == ABIL_RALLY && CLASS_DEFS[CLASS_SOLDIER].unlock_level[3] == 5);

  /* rasy: cyborg +1 KP, słabość prąd 3; mutant odporność trucizna 2; ogrzyn 1 dowolna premia */
  CHECK(ANCESTRY_DEFS[ANC_CYBORG].ac_bonus == 1 && ANCESTRY_DEFS[ANC_CYBORG].weak[DMG_ELEC] == 3);
  CHECK(ANCESTRY_DEFS[ANC_CYBORG].traits & AT_MACHINE);
  CHECK(ANCESTRY_DEFS[ANC_MUTANT].resist[DMG_POISON] == 2 && ANCESTRY_DEFS[ANC_OGRIN].free_boosts == 1);
  CHECK(ANCESTRY_DEFS[ANC_HUMAN].free_boosts == 2 && ANCESTRY_DEFS[ANC_HUMANOID].attr_flaw[ATTR_CON] == -1);

  /* wrogowie */
  {
    const EnemyDef *k = &ENEMY_DEFS[ENEMY_KOSTUCHA];
    CHECK(k->level == 6 && k->hp == 125 && k->ac == 24 && k->ai == AI_BOSS && k->n_attacks == 2 && k->n_abilities == 3);
    CHECK(k->attacks[0].damage.n == 2 && k->attacks[0].damage.sides == 8 && k->attacks[0].damage.mod == 7);
    CHECK(ENEMY_DEFS[ENEMY_TURRET].speed == 0 && ENEMY_DEFS[ENEMY_RAT_MUTANT].look.scale_q8 == 205);
    /* szansa łupu 0.25 -> u32 <= 1073741823 */
    CHECK(ENEMY_DEFS[ENEMY_RAT_MUTANT].loot[0].chance_le == 1073741823UL);
    for (i = 0; i < ENEMY_COUNT; i++) {
      int j;
      for (j = 0; j < ENEMY_DEFS[i].n_loot; j++) CHECK(ENEMY_DEFS[i].loot[j].item < ITEM_COUNT);
    }
  }

  /* zdolności */
  CHECK(ABILITY_DEFS[ABIL_STRIKE].actions == 1 && ABILITY_DEFS[ABIL_FIRST_AID].actions == 2);
  CHECK(ABILITY_DEFS[ABIL_RALLY].uses == USES_ENCOUNTER && ABILITY_DEFS[ABIL_RALLY].radius == 4);

  /* zasady */
  CHECK(DC_TABLE[0] == 14 && DC_TABLE[3] == 18 && ENCOUNTER_XP[4] == 40 && ENCOUNTER_XP[8] == 160);
  CHECK(MAP_PENALTY[0][2] == -10 && MAP_PENALTY[1][1] == -4 && COVER_AC[2] == 4);
  CHECK(PERSISTENT_CONDS[0] == COND_BLEEDING);

  /* zdarzenia i zlecenia */
  CHECK(TRAVEL_EVENT_COUNT == 10 && TRAVEL_EVENTS[0].n_choices == 2 && FAUNA_ATTACK_EVENT.n_choices == 3);
  CHECK(TRAVEL_EVENTS[0].choices[0].out[3]->items[1] == ITEMSPEC_ANY);
  CHECK(STORY_CONTRACTS[2].type == OBJ_BOSS && STORY_CONTRACTS[2].enemies[0] == ENEMY_KOSTUCHA);
  CHECK(CONTRACT_TEMPLATES[OBJ_LIBERATE].giver == FACTION_NOMADS && CONTRACT_TEMPLATES[OBJ_BOSS].n_titles == 0);

  /* teksty ISO-8859-2: "Żołnierz" = AF 6F B3 6E 69 65 72 7A */
  CHECK((unsigned char)CLASS_DEFS[CLASS_SOLDIER].name[0] == 0xAF && (unsigned char)CLASS_DEFS[CLASS_SOLDIER].name[2] == 0xB3);

  /* tablice stałoprzecinkowe */
  CHECK(SIN_LUT[0] == 0 && SIN_LUT[64] == 16384 && SIN_LUT[192] == -16384); /* Q14 */

  printf("%d checks, %d failures\n", checks, fails);
  return fails ? 1 : 0;
}
