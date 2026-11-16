/* Zapis gry: zapis -> odczyt -> zapis daje te same bajty; oryginał i odczytana kopia grają dalej identycznie. */
#include <stdio.h>
#include <string.h>
#include "../src/core/save.h"

static int fails = 0, checks = 0;
#define CHECK(c, ...) do { checks++; if (!(c)) { fails++; printf("FAIL %s:%d: ", __FILE__, __LINE__); printf(__VA_ARGS__); printf("\n"); } } while (0)

static uint8_t B1[SAVE_MAX_BYTES], B2[SAVE_MAX_BYTES];

static void campaign_case(int seed) {
  static CampaignState a, b;
  uint8_t picks[4];
  char s[32];
  Rng ra, rb;
  int i, n1, n2, step;
  for (i = 0; i < 4; i++) picks[i] = (uint8_t)((i * 5 + seed) % 16);
  sprintf(s, "save:%d", seed);
  rng_seed_str(&ra, s);
  start_campaign(&a, picks, 4, &ra);
  for (step = 0; step < 3; step++) {
    MissionResult mr;
    DebriefSummary sum;
    memset(&mr, 0, sizeof mr);
    mr.result = step == 1 ? MRES_RETREAT : MRES_SUCCESS;
    mr.xp = 300;
    mr.scrap = 20;
    mr.loot[0].id = ITEM_BANDAGE;
    mr.loot[0].qty = 1;
    mr.n_loot = 1;
    add_condition(&a.party[0], COND_WOUNDED, 1);
    apply_mission_result(&a, &mr, 0, &ra, &sum);
    rest_day(&a, &ra);
  }
  n1 = campaign_save(&a, B1, sizeof B1);
  CHECK(n1 > 0, "campaign_save");
  CHECK(campaign_load(&b, B1, n1), "campaign_load");
  n2 = campaign_save(&b, B2, sizeof B2);
  CHECK(n1 == n2 && !memcmp(B1, B2, (size_t)n1), "kampania %d: ponowny zapis rozny (%d/%d bajtow)", seed, n1, n2);
  rb = ra;
  for (step = 0; step < 3; step++) {
    rest_day(&a, &ra);
    rest_day(&b, &rb);
  }
  n1 = campaign_save(&a, B1, sizeof B1);
  n2 = campaign_save(&b, B2, sizeof B2);
  CHECK(n1 == n2 && !memcmp(B1, B2, (size_t)n1), "kampania %d: rozjazd po wczytaniu", seed);
}

typedef struct { uint8_t type, level, biome, n; uint8_t enemies[8]; } Sim;
#define E(x) ENEMY_##x
static const Sim SIMS[6] = {
  {OBJ_ELIMINATE, 2, BIOME_RUINS, 4, {E(RAIDER_THUG), E(RAIDER_GUNNER), E(DOG_MUTANT), E(DRONE)}},
  {OBJ_RESCUE, 3, BIOME_RUINS, 3, {E(RAIDER_THUG), E(RAIDER_GUNNER), E(RAIDER_PSYCHO)}},
  {OBJ_HACK, 3, BIOME_BUNKER, 3, {E(DRONE), E(ROBOT), E(RAIDER_GUNNER)}},
  {OBJ_LIBERATE, 4, BIOME_WASTES, 4, {E(RAIDER_THUG), E(RAIDER_GUNNER), E(DOG_MUTANT), E(RAIDER_CHIEF)}},
  {OBJ_PURGE, 3, BIOME_INDUSTRIAL, 4, {E(RAT_MUTANT), E(RAT_MUTANT), E(SCORPION), E(GHOUL)}},
  {OBJ_RETRIEVE, 2, BIOME_INDUSTRIAL, 3, {E(RAIDER_THUG), E(DRONE), E(TURRET)}},
};

/* Jeden krok eksploracji (jak w trace_mission.c): skrzynie / cel / wróg. Zwraca 0, gdy koniec albo walka. */
static int explore_step(Mission *m) {
  Actor *lead = NULL;
  int i, ti = -1;
  static ExploreResult er;
  if (m->mode != MODE_EXPLORE) return 0;
  for (i = 0; i < m->n_pcs && !lead; i++) if (m->pcs[i]->state == AST_UP) lead = m->pcs[i];
  if (!lead) return 0;
  for (i = 0; i < m->n_things && ti < 0; i++) if (!m->things[i].done) ti = i;
  if (ti >= 0) {
    MissionThing *th = &m->things[ti];
    if (cheb(apos(lead), mkpos(th->gx, th->gy)) <= 1) {
      uint8_t skill = th->kind == TH_DEVICE ? SKILL_CRAFTING : th->kind == TH_CRATE ? SKILL_THIEVERY : SKILL_NONE;
      if (!mission_interact(m, lead, th, skill)) th->done = 1;
    } else {
      mission_explore_move(m, lead, mkpos(th->gx, th->gy), 1, &er);
      if (!er.ok) th->done = 1;
    }
  } else {
    Actor *e = NULL;
    for (i = 0; i < m->n_enemies && !e; i++) if (m->enemies[i]->state == AST_UP) e = m->enemies[i];
    if (!e) return 0;
    mission_explore_move(m, lead, apos(e), 1, &er);
    if (!er.ok) return 0;
  }
  return m->mode == MODE_EXPLORE;
}

static void mission_case(int k) {
  static Mission A, B;
  static Character pa[4], pb[4];
  Character *ppa[4], *ppb[4];
  MissionContract mc;
  char id[32], seed[32];
  Rng ra, rb;
  int i, n1, n2, it, saved = 0;
  const Sim *s = &SIMS[k];
  for (i = 0; i < 4; i++) {
    char_from_recruit(&pa[i], (uint8_t)((i * 3 + k) % 16), NULL, s->level);
    ppa[i] = &pa[i];
    ppb[i] = &pb[i];
  }
  memset(&mc, 0, sizeof mc);
  sprintf(id, "save:m%d", k);
  mc.id = id;
  mc.type = s->type;
  mc.level = s->level;
  mc.biome = s->biome;
  mc.n_enemies = s->n;
  memcpy(mc.enemies, s->enemies, s->n);
  mc.item = ITEM_CIRCUIT;
  sprintf(seed, "save:m%d:rng", k);
  rng_seed_str(&ra, seed);
  mission_init(&A, &mc, ppa, 4, &ra);
  for (it = 0; it < 4; it++) if (!explore_step(&A)) break;
  if (A.mode != MODE_EXPLORE) {
    printf("  misja %d: walka/koniec przed zapisem - pomijam porownanie dalszej gry\n", k);
  }
  n1 = mission_save(&A, B1, sizeof B1);
  if (A.mode == MODE_EXPLORE) CHECK(n1 > 0, "mission_save %d", k);
  else {
    CHECK(n1 == 0, "zapis w walce powinien byc niedostepny");
    return;
  }
  for (i = 0; i < 4; i++) pb[i] = pa[i];
  rb = ra;
  CHECK(mission_load(&B, &mc, ppb, 4, &rb, B1, n1), "mission_load %d", k);
  n2 = mission_save(&B, B2, sizeof B2);
  CHECK(n1 == n2 && !memcmp(B1, B2, (size_t)n1), "misja %d: ponowny zapis rozny (%d/%d bajtow)", k, n1, n2);
  saved = 1;
  for (it = 0; it < 12 && saved; it++) {
    int ga = explore_step(&A), gb = explore_step(&B);
    CHECK(ga == gb, "misja %d krok %d: rozny przebieg", k, it);
    if (!ga) break;
    n1 = mission_save(&A, B1, sizeof B1);
    n2 = mission_save(&B, B2, sizeof B2);
    CHECK(n1 == n2 && !memcmp(B1, B2, (size_t)n1), "misja %d krok %d: rozjazd po wczytaniu", k, it);
  }
}

int main(void) {
  int i;
  for (i = 0; i < 6; i++) campaign_case(i);
  for (i = 0; i < 6; i++) mission_case(i);
  printf("test_save: %d checks, %d failures\n", checks, fails);
  return fails ? 1 : 0;
}
