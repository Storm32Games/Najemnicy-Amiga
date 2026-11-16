/* Ślad kampanii - zgodny z amiga/data/traces/campaign.txt (tools/amiga/trace_campaign.ts). */
#include <stdio.h>
#include <string.h>
#include "trace_fmt.h"
#include "../src/core/campaign.h"

static const char *const TYPE_K[9] = {"eliminate", "retrieve", "rescue", "hunt", "boss", "hack", "liberate", "purge", "defend"};
static const char *const BIOME_K[4] = {"ruins", "wastes", "industrial", "bunker"};
static const char *const MOOD_K[5] = {"day", "dusk", "night", "toxic", "storm"};
static const char *const FACTION_K[2] = {"survivors", "nomads"};
static const char *const RESULT_K[3] = {"success", "fail", "retreat"};

static int ptr_index(const char *const *arr, int n, const char *p) {
  int i;
  for (i = 0; i < n; i++) if (arr[i] == p) return i;
  return -1;
}

static void contract_line(const Contract *c) {
  const ContractTemplate *T = &CONTRACT_TEMPLATES[c->type];
  int t, g, d, i;
  if (c->story >= 0) { t = c->story; g = -1; d = -1; }
  else {
    t = ptr_index(T->titles, T->n_titles, c->title);
    g = ptr_index(GIVERS[c->faction], 5, c->giver);
    d = ptr_index(T->descs, T->n_descs, c->desc);
  }
  printf("c %s %d %s %d %s %s %s t=%d g=%d d=%d e=", c->id, c->story >= 0, TYPE_K[c->type], c->level, BIOME_K[c->biome], MOOD_K[c->mood], FACTION_K[c->faction], t, g, d);
  for (i = 0; i < c->n_enemies; i++) printf("%s%s", i ? "," : "", ENEMY_DEFS[c->enemies[i]].key);
  printf(" obj=%s r=%d/%d/", c->obj_item == ITEM_NONE ? "-" : ITEM_DEFS[c->obj_item].key, c->reward_scrap, c->reward_xp);
  for (i = 0; i < c->n_reward_items; i++) printf("%s%s", i ? "," : "", ITEM_DEFS[c->reward_items[i]].key);
  printf("/%d,%d days=%d\n", c->reward_rep[FACTION_SURVIVORS], c->reward_rep[FACTION_NOMADS], c->travel_days);
}

static void state_lines(const CampaignState *st) {
  int i;
  printf("st day=%d scrap=%d rep=%d,%d story=%d done=%d plv=%d unlocked=%d victory=%d\n", st->day, st->scrap, st->rep[FACTION_SURVIVORS],
         st->rep[FACTION_NOMADS], st->story, st->n_completed, campaign_party_level(st), story_unlocked(st), st->victory);
  printf("party");
  for (i = 0; i < st->n_party; i++) {
    const Character *c = &st->party[i];
    printf(" %s:%d:%d:%d/%d", RECRUIT_DEFS[c->recruit].key, c->level, c->xp, c->hp, c->max_hp);
  }
  printf("\nstash ");
  for (i = 0; i < st->n_stash; i++) printf("%s%s:%d", i ? "," : "", ITEM_DEFS[st->stash[i].id].key, st->stash[i].qty);
  printf("\nfallen ");
  for (i = 0; i < st->n_fallen_ids; i++) printf("%s%s", i ? "," : "", RECRUIT_DEFS[st->fallen_ids[i]].key);
  printf("\n");
  for (i = 0; i < st->n_contracts; i++) contract_line(&st->contracts[i]);
}

int main(void) {
  static CampaignState st;
  Rng rng;
  char buf[160];
  int i, s, step;
  static const double SPECIAL[8] = {0.5, 0.1, 1.0 / 3, 0.999999999999, 1e-10, 0.25, 0.75, 2.0 / 3};

  for (i = 0; i < 8; i++) { js_radix36(SPECIAL[i], buf); printf("radix %s\n", buf); }
  rng_seed_str(&rng, "radix");
  for (i = 0; i < 3000; i++) { js_radix36(rng_f(&rng), buf); printf("radix %s\n", buf); }

  for (s = 0; s < 6; s++) {
    uint8_t picks[4];
    char seed[32];
    for (i = 0; i < 4; i++) picks[i] = (uint8_t)((i * 4 + s) % 16);
    sprintf(seed, "camp:%d", s);
    rng_seed_str(&rng, seed);
    start_campaign(&st, picks, 4, &rng);
    printf("campaign %d\n", s);
    state_lines(&st);
    for (step = 0; step < 8; step++) {
      int ci, result, plv, n, k;
      Contract contract;
      const TravelEvent *ev;
      EventResolution er;
      MissionResult mr;
      DebriefSummary sum;
      uint8_t stock[24];
      if (!st.n_party) break;
      ci = step % st.n_contracts;
      contract = st.contracts[ci];
      printf("day %d contract %s\n", step, contract.id);
      ev = roll_travel_event(&rng, 0.3);
      if (ev) {
        int chi = step % ev->n_choices;
        resolve_event_choice(&st, contract.level, &ev->choices[chi], &rng, &er);
        printf("ev %s %d deg=%d who=%s chk=", ev->key, chi, er.degree, er.who ? RECRUIT_DEFS[er.who->recruit].key : "-");
        if (er.has_check) printf("%d/%d\n", er.check.total, er.check.dc); else printf("-\n");
      }
      if (step % 3 == 0) {
        resolve_event_choice(&st, contract.level, &FAUNA_ATTACK_EVENT.choices[step % 3], &rng, &er);
        printf("fauna %d deg=%d who=%s\n", step % 3, er.degree, er.who ? RECRUIT_DEFS[er.who->recruit].key : "-");
      }
      state_lines(&st);
      result = (step + s) % 3; /* TS: ['success','retreat','fail'] */
      memset(&mr, 0, sizeof mr);
      mr.result = result == 0 ? MRES_SUCCESS : result == 1 ? MRES_RETREAT : MRES_FAIL;
      if (step == 5 && st.n_party > 1) {
        Character *victim = &st.party[st.n_party - 1];
        apply_damage(victim, victim->hp + 50, DMG_P, 0);
        victim->cond[COND_DEAD] = 1;
        mr.casualties[mr.n_casualties++] = victim;
      }
      if (step == 2) st.party[0].stolen_scrap = 9;
      mr.xp = 40 * step + 20;
      mr.scrap = 7 * step + 3;
      mr.loot[0].id = ITEM_BANDAGE; mr.loot[0].qty = 1;
      mr.loot[1].id = ITEM_CIRCUIT; mr.loot[1].qty = 1;
      mr.loot[2].id = step % 2 ? ITEM_STIMPAK : ITEM_SCRAP_METAL; mr.loot[2].qty = 1;
      mr.n_loot = 3;
      apply_mission_result(&st, &mr, ci, &rng, &sum);
      printf("debrief %s scrap=%d stolen=%d xp=%d items=", RESULT_K[sum.result], sum.scrap, sum.stolen, sum.xp);
      for (k = 0; k < sum.n_items; k++) printf("%s%s", k ? "," : "", ITEM_DEFS[sum.items[k]].key);
      printf(" rep=%d,%d fallen=%d gained=", sum.rep[FACTION_SURVIVORS], sum.rep[FACTION_NOMADS], sum.n_fallen);
      for (k = 0; k < st.n_party; k++) printf("%s%d", k ? "," : "", sum.levels_gained[k]);
      printf(" story=%d win=%d tpk=%d\n", sum.story, sum.win, sum.tpk);
      plv = campaign_party_level(&st);
      n = shop_stock(st.day, plv, stock);
      printf("shop ");
      for (k = 0; k < n; k++) printf("%s%s", k ? "," : "", ITEM_DEFS[stock[k]].key);
      printf("\nprices ");
      for (k = 0; k < n; k++) printf("%s%d/%d", k ? "," : "", buy_price(stock[k], &st), sell_price(stock[k], &st));
      printf("\n");
      for (k = 0; k < n && k < 2; k++) printf("buy %s %d\n", ITEM_DEFS[stock[k]].key, shop_buy(&st, stock[k]));
      if (st.n_stash) {
        uint8_t id = st.stash[0].id;
        int p = shop_sell(&st, st.stash, &st.n_stash, 0);
        printf("sell %s %d\n", ITEM_DEFS[id].key, p);
      }
      if (st.n_party) {
        int cost;
        apply_damage(&st.party[0], 5, DMG_S, 0);
        cost = heal_cost(&st.party[0]);
        printf("clinic %d %d\n", cost, heal_at_clinic(&st, &st.party[0]));
      }
      rest_day(&st, &rng);
      if (st.n_party < 4) {
        uint8_t list[RECRUIT_COUNT];
        int nl = tavern_recruits(&st, list);
        printf("tavern ");
        for (k = 0; k < nl; k++) printf("%s%s", k ? "," : "", RECRUIT_DEFS[list[k]].key);
        printf(" cost=%d\n", hire_cost(&st));
        if (nl) printf("hire %s %d\n", RECRUIT_DEFS[list[0]].key, hire_recruit(&st, list[0], &rng));
      }
      state_lines(&st);
    }
  }
  {
    static const int NEED[3] = {2, 4, 7};
    static const uint8_t P4[4] = {0, 1, 2, 3};
    int k;
    rng_seed_str(&rng, "story");
    start_campaign(&st, P4, 4, &rng);
    for (k = 0; k < 3; k++) {
      MissionResult mr;
      DebriefSummary sum;
      int ci = -1;
      while (st.n_completed < NEED[k]) { sprintf(st.completed[st.n_completed], "x%d", st.n_completed); st.n_completed++; }
      st.rep[FACTION_SURVIVORS] = 5 * (k + 1);
      st.rep[FACTION_NOMADS] = 5 * (k + 1);
      refresh_board(&st, 0, &rng);
      state_lines(&st);
      for (i = 0; i < st.n_contracts && ci < 0; i++) if (st.contracts[i].story >= 0) ci = i;
      memset(&mr, 0, sizeof mr);
      mr.result = MRES_SUCCESS;
      mr.xp = 100;
      mr.scrap = 10;
      apply_mission_result(&st, &mr, ci, &rng, &sum);
      printf("storydone %d story=%d win=%d\n", k, sum.story, sum.win);
      state_lines(&st);
    }
  }
  {
    static const int REPS[6] = {-15, -3, 0, 4, 9, 20};
    uint8_t one = 0;
    rng_seed_str(&rng, "prices");
    start_campaign(&st, &one, 1, &rng);
    for (s = 0; s < 6; s++) {
      st.rep[FACTION_NOMADS] = REPS[s];
      printf("rep %d ", REPS[s]);
      for (i = 0; i < ITEM_COUNT; i++) printf("%s%d/%d", i ? "," : "", buy_price((uint8_t)i, &st), sell_price((uint8_t)i, &st));
      printf("\n");
    }
  }
  return 0;
}
