/* Kampania: stan, zlecenia, wątek fabularny, handlarz, lecznica, karczma, podróż, rozliczenie misji.
 * Port src/core/campaign/{state,contracts,economy,debrief,travel,session}.ts. */
#ifndef CAMPAIGN_H
#define CAMPAIGN_H

#include "combat.h"

#define MAX_STASH 96
#define MAX_CONTRACTS 16
#define MAX_COMPLETED 64
#define MAX_FALLEN 16
#define CONTRACT_ENEMIES_MAX 12

typedef struct {
  char id[24];
  int8_t story;                /* -1 = poboczne, inaczej indeks STORY_CONTRACTS */
  const char *title, *giver, *desc;
  uint8_t faction, type, level, biome, mood;
  uint8_t n_enemies, enemies[CONTRACT_ENEMIES_MAX];
  uint8_t obj_item;            /* retrieve: przedmiot celu; inaczej ITEM_NONE */
  uint16_t reward_scrap, reward_xp;
  uint8_t n_reward_items, reward_items[2];
  int8_t reward_rep[FACTION_COUNT];
  uint8_t travel_days;
} Contract;

typedef struct {
  Character party[MAX_PARTY];
  int n_party;
  int scrap, day;
  int rep[FACTION_COUNT];
  ItemInst stash[MAX_STASH];
  uint8_t n_stash;
  Contract contracts[MAX_CONTRACTS];
  int n_contracts;
  char completed[MAX_COMPLETED][24];
  int n_completed;
  int story;
  char fallen[MAX_FALLEN][NAME_MAX + 1];
  int n_fallen;
  uint8_t fallen_ids[MAX_FALLEN];
  int n_fallen_ids;
  uint8_t victory;
  int n_log;
} CampaignState;

void campaign_fresh(CampaignState *st);
int campaign_party_level(const CampaignState *st);
void js_radix36(double v, char *out); /* Number.prototype.toString(36) z V8 */

/* zlecenia */
uint8_t roll_item(int spec, int level, Rng *r); /* spec: ITEMSPEC_ANY albo ITEMSPEC_TYPE(t) albo ItemId */
typedef struct { int biomes[BIOME_COUNT]; const char *titles[MAX_CONTRACTS + 4]; int n_titles; } BoardUse;
void make_contract(const CampaignState *st, uint8_t type, int level, Rng *r, BoardUse *board, Contract *out);
void generate_contracts(CampaignState *st, Rng *r);
int story_unlocked(const CampaignState *st);
void refresh_board(CampaignState *st, int drop, Rng *r);
int difficulty_of(int contract_level, int party_level); /* 0 łatwe, 1 standardowe, 2 trudne, 3 śmiertelne */

/* handlarz i lecznica */
double nomad_discount(const CampaignState *st);
int buy_price(uint8_t item, const CampaignState *st);
int sell_price(uint8_t item, const CampaignState *st);
int shop_stock(int day, int party_level, uint8_t *out); /* zwraca liczbę */
int shop_buy(CampaignState *st, uint8_t item);
int shop_sell(CampaignState *st, ItemInst *from, uint8_t *n_from, int index);
int heal_cost(const Character *c);
int heal_at_clinic(CampaignState *st, Character *c);
void rest_day(CampaignState *st, Rng *r);

/* karczma */
int hire_cost(const CampaignState *st);
int tavern_recruits(const CampaignState *st, uint8_t *out);
int hire_recruit(CampaignState *st, uint8_t recruit, Rng *r);
void start_campaign(CampaignState *st, const uint8_t *picks, int n, Rng *r);

/* podróż */
const TravelEvent *roll_travel_event(Rng *r, double chance);
Character *best_for_choice(CampaignState *st, const EventChoice *choice);
int choice_dc(const EventChoice *choice, int contract_level);
typedef struct { uint8_t degree; Character *who; uint8_t has_check; CheckResult check; const EventOutcome *outcome;
                 int scrap, n_items; uint8_t items[3]; int rep[FACTION_COUNT]; int xp, days, hp; Character *hurt; } EventResolution;
void resolve_event_choice(CampaignState *st, int contract_level, const EventChoice *choice, Rng *r, EventResolution *out);

/* rozliczenie misji */
typedef struct {
  uint8_t result;
  int scrap, stolen, xp;
  int n_items;
  uint8_t items[MAX_LOOT + 4];
  int rep[FACTION_COUNT];
  int n_fallen;
  uint8_t levels_gained[MAX_PARTY];
  uint8_t story, win, tpk;
} DebriefSummary;
void apply_mission_result(CampaignState *st, const MissionResult *mr, int contract_index, Rng *r, DebriefSummary *out);

#endif
