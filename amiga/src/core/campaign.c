/* Kampania. Port src/core/campaign/{state,contracts,economy,debrief,travel,session}.ts. */
#include <string.h>
#include <stdio.h>
#include "campaign.h"
#include "names.h"

/* ================================================================ Number.prototype.toString(36) jak w V8 */
static double next_double(double v) {
  union { double d; uint64_t u; } x;
  x.d = v;
  if (v == 0) { x.u = 1; return x.d; }
  x.u += v > 0 ? 1 : (uint64_t)-1;
  return x.d;
}

void js_radix36(double value, char *out) {
  static const char CH[] = "0123456789abcdefghijklmnopqrstuvwxyz";
  char frac[1100];
  int fc = 0, neg = value < 0, n = 0, i;
  double integer, fraction, delta;
  char ibuf[64];
  int ic = 0;
  if (neg) value = -value;
  integer = floor(value);
  fraction = value - integer;
  delta = 0.5 * (next_double(value) - value);
  if (next_double(0.0) > delta) delta = next_double(0.0);
  if (fraction >= delta) {
    do {
      int digit;
      fraction *= 36;
      delta *= 36;
      digit = (int)fraction;
      frac[fc++] = CH[digit];
      fraction -= digit;
      if (fraction > 0.5 || (fraction == 0.5 && (digit & 1))) {
        if (fraction + delta > 1) {
          for (;;) {
            int d;
            char c;
            fc--;
            if (fc < 0) {
              fc = 0;
              integer += 1;
              break;
            }
            c = frac[fc];
            d = c > '9' ? c - 'a' + 10 : c - '0';
            if (d + 1 < 36) {
              frac[fc++] = CH[d + 1];
              break;
            }
          }
          break;
        }
      }
    } while (fraction >= delta && fc < 1090);
  }
  /* część całkowita (dla rng() zawsze 0 albo 1) */
  do {
    double rem = fmod(integer, 36);
    ibuf[ic++] = CH[(int)rem];
    integer = (integer - rem) / 36;
  } while (integer > 0 && ic < 60);
  if (neg) out[n++] = '-';
  for (i = ic - 1; i >= 0; i--) out[n++] = ibuf[i];
  if (fc) {
    out[n++] = '.';
    for (i = 0; i < fc && n < 120; i++) out[n++] = frac[i];
  }
  out[n] = 0;
}

/* ================================================================ stan */
void campaign_fresh(CampaignState *st) {
  memset(st, 0, sizeof *st);
  st->scrap = 120;
  st->day = 1;
}

int campaign_party_level(const CampaignState *st) {
  int i, sum = 0, l;
  if (!st || !st->n_party) return 1;
  for (i = 0; i < st->n_party; i++) sum += st->party[i].level ? st->party[i].level : 1;
  l = (int)js_round((double)sum / st->n_party);
  return l < 1 ? 1 : l;
}

static int pick_i(Rng *r, int n) { return (int)floor(rng_f(r) * n); }
static int clampi(int v, int a, int b) { return v < a ? a : v > b ? b : v; }

/* ================================================================ zlecenia (contracts.ts) */
static int is_boss_enemy(uint8_t id) { return ENEMY_DEFS[id].ai == AI_BOSS || id == ENEMY_KOSTUCHA; }
static int has_faction(uint8_t mask, uint8_t id) { return (mask >> ENEMY_DEFS[id].faction) & 1; }

static int pool(uint8_t factions, int all_factions, int level, uint8_t *out) {
  int i, n = 0;
  for (i = 0; i < ENEMY_COUNT; i++)
    if (!is_boss_enemy((uint8_t)i) && (all_factions || has_faction(factions, (uint8_t)i)) && abs(ENEMY_DEFS[i].level - level) <= 1) out[n++] = (uint8_t)i;
  if (!n)
    for (i = 0; i < ENEMY_COUNT; i++) if (!is_boss_enemy((uint8_t)i) && (all_factions || has_faction(factions, (uint8_t)i))) out[n++] = (uint8_t)i;
  if (!n)
    for (i = 0; i < ENEMY_COUNT; i++) if (!is_boss_enemy((uint8_t)i)) out[n++] = (uint8_t)i;
  return n;
}

uint8_t roll_item(int spec, int level, Rng *r) {
  uint8_t c[ITEM_COUNT];
  int i, n = 0;
  if (spec >= 0) return spec < ITEM_COUNT ? (uint8_t)spec : ITEM_NONE;
  for (i = 0; i < ITEM_COUNT; i++) {
    const ItemDef *d = &ITEM_DEFS[i];
    int ok;
    if (spec == ITEMSPEC_ANY) ok = d->type == ITYPE_WEAPON || d->type == ITYPE_ARMOR || d->type == ITYPE_SHIELD || d->type == ITYPE_CONSUMABLE || d->type == ITYPE_TECH;
    else ok = d->type == -2 - spec;
    if (ok && d->level <= level + 1 && d->price > 0) c[n++] = (uint8_t)i;
  }
  return n ? c[pick_i(r, n)] : ITEM_NONE;
}

static int title_used(const BoardUse *b, const char *t) {
  int i;
  for (i = 0; i < b->n_titles; i++) if (!strcmp(b->titles[i], t)) return 1;
  return 0;
}
static const char *pick_title(const ContractTemplate *T, BoardUse *board, Rng *r) {
  const char *free_[6];
  int nf = 0, i;
  const char *t;
  for (i = 0; i < T->n_titles; i++) if (!board || !title_used(board, T->titles[i])) free_[nf++] = T->titles[i];
  t = nf ? free_[pick_i(r, nf)] : T->titles[pick_i(r, T->n_titles)];
  if (board && board->n_titles < MAX_CONTRACTS + 4) board->titles[board->n_titles++] = t;
  return t;
}

static int enemy_cost(int plv, uint8_t id) {
  uint8_t lv = ENEMY_DEFS[id].level;
  int x = encounter_xp(plv, &lv, 1);
  return x ? x : 40;
}

static const int BONUS[OBJ_COUNT] = {0, 0, 0, 10, 0, 0, 10, 10, 20};        /* eliminate retrieve rescue hunt boss hack liberate purge defend */
static const double MULT[OBJ_COUNT] = {1, 1, 1.15, 1, 1, 1.1, 1.2, 1.15, 1.25};

void make_contract(const CampaignState *st, uint8_t type, int level, Rng *r, BoardUse *board, Contract *c) {
  const ContractTemplate *T = &CONTRACT_TEMPLATES[type];
  uint8_t factions = T->factions, faction;
  int plv = campaign_party_level(st), hard = level > plv, budget, i, maxN, np = 0, nfb, guard;
  uint8_t p[ENEMY_COUNT], fb[ENEMY_COUNT];
  char rad[128];
  uint8_t any_item, tech_item = ITEM_NONE, biome;
  memset(c, 0, sizeof *c);
  c->story = -1;
  c->obj_item = ITEM_NONE;
  if (type == OBJ_DEFEND) {
    uint8_t list[4];
    int n = 0;
    for (i = 0; i < 4; i++) if ((T->factions >> i) & 1) list[n++] = (uint8_t)i;
    factions = (uint8_t)(1u << list[pick_i(r, n)]);
  }
  faction = T->giver != FACTION_NONE ? T->giver : (rng_f(r) < 0.55 ? FACTION_SURVIVORS : FACTION_NOMADS);
  budget = (hard ? 125 : 85 + (int)floor(rng_f(r) * 25)) + BONUS[type];
  if (type == OBJ_HUNT) {
    uint8_t strong[ENEMY_COUNT];
    int ns = 0;
    for (i = 0; i < ENEMY_COUNT; i++)
      if (!is_boss_enemy((uint8_t)i) && has_faction(factions, (uint8_t)i) && ENEMY_DEFS[i].level >= level && ENEMY_DEFS[i].level <= plv + 2) strong[ns++] = (uint8_t)i;
    if (ns) {
      uint8_t s0 = strong[pick_i(r, ns)];
      c->enemies[c->n_enemies++] = s0;
      budget -= enemy_cost(plv, s0);
    }
  }
  for (i = 0; i < ENEMY_COUNT; i++)
    if (!is_boss_enemy((uint8_t)i) && has_faction(factions, (uint8_t)i) && ENEMY_DEFS[i].level <= level && ENEMY_DEFS[i].level >= level - 3) p[np++] = (uint8_t)i;
  nfb = pool(factions, 0, level, fb);
  maxN = type == OBJ_DEFEND ? 10 : 8;
  for (guard = 0; guard < 24 && c->n_enemies < maxN; guard++) {
    uint8_t fit[ENEMY_COUNT];
    const uint8_t *src = np ? p : fb;
    int ns = np ? np : nfb, nfit = 0;
    for (i = 0; i < ns; i++) if (enemy_cost(plv, src[i]) <= budget) fit[nfit++] = src[i];
    if (!nfit) break;
    {
      uint8_t id = fit[pick_i(r, nfit)];
      c->enemies[c->n_enemies++] = id;
      budget -= enemy_cost(plv, id);
    }
  }
  while (c->n_enemies < 2) {
    uint8_t cand[ENEMY_COUNT * 2];
    int nc = 0;
    for (i = 0; i < nfb; i++) if (ENEMY_DEFS[fb[i]].level <= plv) cand[nc++] = fb[i];
    for (i = 0; i < nfb; i++) cand[nc++] = fb[i];
    if (nc > 3) nc = 3;
    c->enemies[c->n_enemies++] = cand[pick_i(r, nc)];
  }
  if (type == OBJ_RETRIEVE) {
    uint8_t it = roll_item(ITEMSPEC_TYPE(ITYPE_TECH), 5, r);
    if (it == ITEM_NONE) it = roll_item(ITEMSPEC_TYPE(ITYPE_CONSUMABLE), 5, r);
    c->obj_item = it == ITEM_NONE ? ITEM_SCRAP_METAL : it;
  }
  any_item = roll_item(ITEMSPEC_ANY, level, r);
  if (type == OBJ_HACK) tech_item = roll_item(ITEMSPEC_TYPE(ITYPE_TECH), level, r);
  {
    uint8_t cand[3];
    int nb = 0, least = 1 << 30;
    if (board) {
      for (i = 0; i < T->n_biomes; i++) if (board->biomes[T->biomes[i]] < least) least = board->biomes[T->biomes[i]];
      for (i = 0; i < T->n_biomes; i++) if (board->biomes[T->biomes[i]] == least) cand[nb++] = T->biomes[i];
    } else for (i = 0; i < T->n_biomes; i++) cand[nb++] = T->biomes[i];
    biome = cand[pick_i(r, nb)];
    if (board) board->biomes[biome]++;
  }
  js_radix36(rng_f(r), rad);
  {
    char five[6];
    int len = (int)strlen(rad), k, j = 0;
    for (k = 2; k < 7 && k < len; k++) five[j++] = rad[k];
    five[j] = 0;
    sprintf(c->id, "k%d_%s", st ? st->day : 1, five);
  }
  c->title = pick_title(T, board, r);
  c->giver = GIVERS[faction][pick_i(r, 5)];
  c->faction = faction;
  c->desc = T->descs[pick_i(r, T->n_descs)];
  c->type = type;
  c->level = (uint8_t)level;
  c->biome = biome;
  c->mood = T->moods[pick_i(r, T->n_moods)];
  {
    double base = 35 + level * 32 + floor(rng_f(r) * 30);
    c->reward_scrap = (uint16_t)js_round(base * (hard ? 1.2 : 1) * MULT[type]);
  }
  c->reward_xp = (uint16_t)(300 + level * 100 + (type == OBJ_DEFEND || type == OBJ_LIBERATE ? 100 : 0));
  if (tech_item != ITEM_NONE) c->reward_items[c->n_reward_items++] = tech_item;
  else if (rng_f(r) < 0.4 && any_item != ITEM_NONE) c->reward_items[c->n_reward_items++] = any_item;
  c->reward_rep[faction] = (int8_t)(1 + (hard ? 1 : 0) + (type == OBJ_LIBERATE || type == OBJ_DEFEND ? 1 : 0));
  c->travel_days = (uint8_t)(1 + (rng_f(r) < 0.25 ? 1 : 0));
}

int story_unlocked(const CampaignState *st) {
  int s = st->story, rep;
  if (s >= STORY_CONTRACT_COUNT) return 0;
  rep = st->rep[FACTION_NOMADS] + st->rep[FACTION_SURVIVORS];
  return st->n_completed >= STORY_NEED[s].completed && rep >= STORY_NEED[s].rep;
}

static void clone_story(const CampaignState *st, int i, Contract *c) {
  const StoryContract *s = &STORY_CONTRACTS[i];
  int plv = campaign_party_level(st), g, k;
  memset(c, 0, sizeof *c);
  strcpy(c->id, s->key);
  c->story = (int8_t)i;
  c->title = s->title;
  c->giver = s->giver;
  c->desc = s->desc;
  c->faction = s->faction;
  c->type = s->type;
  c->level = s->level;
  c->biome = s->biome;
  c->mood = s->mood;
  c->n_enemies = s->n_enemies;
  memcpy(c->enemies, s->enemies, s->n_enemies);
  c->obj_item = ITEM_NONE;
  c->reward_scrap = s->reward_scrap;
  c->reward_xp = s->reward_xp;
  memcpy(c->reward_rep, s->reward_rep, sizeof c->reward_rep);
  c->travel_days = s->travel_days;
  for (g = 0; g < 10; g++) {
    uint8_t lv[CONTRACT_ENEMIES_MAX];
    int x;
    for (k = 0; k < c->n_enemies; k++) lv[k] = ENEMY_DEFS[c->enemies[k]].level;
    x = encounter_xp(plv, lv, c->n_enemies);
    if (!(x > STORY_BUDGET[i] && c->n_enemies > 2)) break;
    k = c->n_enemies - 1;
    while (k > 0 && is_boss_enemy(c->enemies[k])) k--;
    if (k <= 0) break;
    for (; k + 1 < c->n_enemies; k++) c->enemies[k] = c->enemies[k + 1];
    c->n_enemies--;
  }
}

static int level_jitter(int lvl, Rng *r) {
  int d;
  if (rng_f(r) < 0.25) d = 1;
  else d = rng_f(r) < 0.2 ? -1 : 0;
  return clampi(lvl + d, 1, 10);
}
static int board_target(Rng *r) { return 10 + (int)floor(rng_f(r) * 2); }
static void board_use(const CampaignState *st, BoardUse *b) {
  int i;
  memset(b, 0, sizeof *b);
  for (i = 0; i < st->n_contracts; i++) {
    b->biomes[st->contracts[i].biome]++;
    if (b->n_titles < MAX_CONTRACTS + 4) b->titles[b->n_titles++] = st->contracts[i].title;
  }
}
static void insert_front(CampaignState *st, const Contract *c) {
  int i;
  if (st->n_contracts >= MAX_CONTRACTS) return;
  for (i = st->n_contracts; i > 0; i--) st->contracts[i] = st->contracts[i - 1];
  st->contracts[0] = *c;
  st->n_contracts++;
}

void generate_contracts(CampaignState *st, Rng *r) {
  int lvl = campaign_party_level(st), n, i;
  BoardUse use;
  memset(&use, 0, sizeof use);
  st->n_contracts = 0;
  n = board_target(r);
  for (i = 0; i < n && st->n_contracts < MAX_CONTRACTS; i++) {
    uint8_t type = i < SIDE_TYPE_COUNT ? SIDE_TYPES[i] : SIDE_TYPES[pick_i(r, SIDE_TYPE_COUNT)];
    int level = level_jitter(lvl, r);
    make_contract(st, type, level, r, &use, &st->contracts[st->n_contracts++]);
  }
  if (story_unlocked(st)) {
    Contract c;
    clone_story(st, st->story, &c);
    insert_front(st, &c);
  }
}

static int side_count(const CampaignState *st) {
  int i, n = 0;
  for (i = 0; i < st->n_contracts; i++) if (st->contracts[i].story < 0) n++;
  return n;
}

void refresh_board(CampaignState *st, int drop, Rng *r) {
  int i, lvl, target;
  BoardUse use;
  for (i = 0; i < drop; i++) {
    int side[MAX_CONTRACTS], ns = 0, k, j;
    for (k = 0; k < st->n_contracts; k++) if (st->contracts[k].story < 0) side[ns++] = k;
    if (ns > 2) {
      j = side[pick_i(r, ns)];
      for (k = j; k + 1 < st->n_contracts; k++) st->contracts[k] = st->contracts[k + 1];
      st->n_contracts--;
    }
  }
  if (story_unlocked(st)) {
    int has = 0;
    for (i = 0; i < st->n_contracts; i++) if (st->contracts[i].story >= 0) has = 1;
    if (!has) {
      Contract c;
      clone_story(st, st->story, &c);
      insert_front(st, &c);
    }
  }
  lvl = campaign_party_level(st);
  target = board_target(r);
  board_use(st, &use);
  while (side_count(st) < target && st->n_contracts < MAX_CONTRACTS) {
    int missing = -1, k, j, level;
    uint8_t type;
    for (k = 0; k < SIDE_TYPE_COUNT && missing < 0; k++) {
      int found = 0;
      for (j = 0; j < st->n_contracts; j++) if (st->contracts[j].type == SIDE_TYPES[k]) found = 1;
      if (!found) missing = SIDE_TYPES[k];
    }
    type = missing >= 0 ? (uint8_t)missing : SIDE_TYPES[pick_i(r, SIDE_TYPE_COUNT)];
    level = clampi(lvl + (rng_f(r) < 0.25 ? 1 : 0), 1, 10);
    make_contract(st, type, level, r, &use, &st->contracts[st->n_contracts++]);
  }
}

int difficulty_of(int cl, int pl) {
  int d = cl - pl;
  if (d <= -2) return 0;
  if (d <= 0) return 1;
  return d == 1 ? 2 : 3;
}

/* ================================================================ handlarz i lecznica (economy.ts) */
double nomad_discount(const CampaignState *st) {
  double v = st->rep[FACTION_NOMADS] * 0.02;
  if (v < -0.2) v = -0.2;
  if (v > 0.25) v = 0.25;
  return v;
}
int buy_price(uint8_t item, const CampaignState *st) {
  double price = item < ITEM_COUNT ? ITEM_DEFS[item].price : 10;
  int p = (int)js_round(price * (1 - nomad_discount(st)));
  return p < 1 ? 1 : p;
}
int sell_price(uint8_t item, const CampaignState *st) {
  double base = item < ITEM_COUNT && ITEM_DEFS[item].type == ITYPE_JUNK ? 0.6 : 0.4, bonus = st->rep[FACTION_NOMADS] * 0.01;
  double price = item < ITEM_COUNT ? ITEM_DEFS[item].price : 0;
  int p;
  if (bonus < 0) bonus = 0;
  if (bonus > 0.1) bonus = 0.1;
  p = (int)floor(price * (base + bonus));
  return p < 0 ? 0 : p;
}

typedef struct { double key; uint8_t id; } Keyed;
static double cmp_keyed(void *ctx, const void *a, const void *b) { (void)ctx; return ((const Keyed *)a)->key - ((const Keyed *)b)->key; }
static int shuffle_take(Rng *r, const uint8_t *ids, int n, int take, uint8_t *out) {
  Keyed k[ITEM_COUNT];
  Keyed *p[ITEM_COUNT];
  int i;
  for (i = 0; i < n; i++) {
    k[i].key = rng_f(r);
    k[i].id = ids[i];
    p[i] = &k[i];
  }
  js_sort_ptr((void **)p, n, cmp_keyed, NULL);
  if (take > n) take = n;
  for (i = 0; i < take; i++) out[i] = p[i]->id;
  return take;
}
int shop_stock(int day, int plvl, uint8_t *out) {
  uint8_t cons[ITEM_COUNT], gear[ITEM_COUNT], picked[20];
  int nc = 0, ng = 0, i, n, m = 0, k;
  Rng r;
  for (i = 0; i < ITEM_COUNT; i++) {
    const ItemDef *d = &ITEM_DEFS[i];
    if (!(d->price > 0 && d->type != ITYPE_JUNK && d->level <= plvl + 1)) continue;
    if (d->type == ITYPE_CONSUMABLE || d->type == ITYPE_AMMO) cons[nc++] = (uint8_t)i;
    else gear[ng++] = (uint8_t)i;
  }
  rng_seed(&r, (uint32_t)((day ? day : 1) * 7919 + 13));
  n = shuffle_take(&r, cons, nc, 8, picked);
  n += shuffle_take(&r, gear, ng, 12, picked + n);
  for (i = 0; i < n; i++) {
    int dup = 0;
    for (k = 0; k < m; k++) if (out[k] == picked[i]) dup = 1;
    if (!dup) out[m++] = picked[i];
  }
  return m;
}
int shop_buy(CampaignState *st, uint8_t item) {
  int price;
  ItemInst it;
  if (item >= ITEM_COUNT) return 0;
  price = buy_price(item, st);
  if (st->scrap < price) return 0;
  st->scrap -= price;
  it.id = item;
  it.qty = 1;
  add_to_stack(st->stash, &st->n_stash, MAX_STASH, it);
  return 1;
}
int shop_sell(CampaignState *st, ItemInst *from, uint8_t *n_from, int idx) {
  int price = sell_price(from[idx].id, st), i;
  if (!price) return 0;
  if (from[idx].qty > 1) from[idx].qty--;
  else {
    for (i = idx; i + 1 < *n_from; i++) from[i] = from[i + 1];
    (*n_from)--;
  }
  st->scrap += price;
  return price;
}
int heal_cost(const Character *c) {
  int miss, nc = 0, i;
  if (c->cond[COND_DEAD]) return 0;
  miss = c->max_hp - c->hp;
  for (i = 0; i < COND_COUNT; i++) if (c->cond[i]) nc++;
  return miss <= 0 && !nc ? 0 : (int)ceil(miss * 1.5) + (nc ? 8 : 0);
}
int heal_at_clinic(CampaignState *st, Character *c) {
  int k = heal_cost(c), i;
  if (!k || st->scrap < k) return 0;
  st->scrap -= k;
  c->hp = c->max_hp;
  for (i = 0; i < COND_COUNT; i++) remove_condition(c, (uint8_t)i);
  return 1;
}
void rest_day(CampaignState *st, Rng *r) {
  int i;
  for (i = 0; i < st->n_party; i++) long_rest(&st->party[i]);
  st->day++;
  refresh_board(st, 2, r);
}

/* ================================================================ karczma i start (session.ts) */
int hire_cost(const CampaignState *st) { return 120 + 60 * campaign_party_level(st); }

static int fallen_name(const CampaignState *st, const char *name) {
  int i;
  for (i = 0; i < st->n_fallen; i++) if (!strcmp(st->fallen[i], name)) return 1;
  return 0;
}
int tavern_recruits(const CampaignState *st, uint8_t *out) {
  int i, k, n = 0;
  for (i = 0; i < RECRUIT_COUNT; i++) {
    int have = 0, fallen = 0;
    for (k = 0; k < st->n_party; k++)
      if (st->party[k].recruit == i || !strcmp(st->party[k].name, RECRUIT_DEFS[i].name)) have = 1;
    for (k = 0; k < st->n_fallen_ids; k++) if (st->fallen_ids[k] == i) fallen = 1;
    if (fallen_name(st, RECRUIT_DEFS[i].name)) fallen = 1;
    if (!have && !fallen) out[n++] = (uint8_t)i;
  }
  return n;
}
static int same_lower(const char *a, const char *b) {
  char ka[64], kb[64];
  int i;
  for (i = 0; a[i] && i < 63; i++) ka[i] = a[i];
  ka[i] = 0;
  for (i = 0; b[i] && i < 63; i++) kb[i] = b[i];
  kb[i] = 0;
  for (i = 0; ka[i]; i++) ka[i] = (char)name_lower((unsigned char)ka[i]);
  for (i = 0; kb[i]; i++) kb[i] = (char)name_lower((unsigned char)kb[i]);
  return !strcmp(ka, kb);
}
int hire_recruit(CampaignState *st, uint8_t recruit, Rng *r) {
  int cost = hire_cost(st), lvl, i, clash = 0;
  const RecruitDef *rd = &RECRUIT_DEFS[recruit];
  const char *taken[MAX_PARTY];
  char name[NAME_MAX + 1];
  if (st->n_party >= MAX_PARTY) return 0;
  if (st->scrap < cost) return 0;
  for (i = 0; i < st->n_party; i++) {
    taken[i] = st->party[i].name;
    if (same_lower(st->party[i].name, rd->name)) clash = 1;
  }
  if (clash) generate_name(rd->ancestry, rd->class_id, rd->gender, taken, st->n_party, r, name);
  else strcpy(name, rd->name);
  lvl = campaign_party_level(st);
  st->scrap -= cost;
  char_from_recruit(&st->party[st->n_party++], recruit, name, lvl);
  return 1;
}
void start_campaign(CampaignState *st, const uint8_t *picks, int n, Rng *r) {
  int i;
  ItemInst it;
  campaign_fresh(st);
  for (i = 0; i < n && i < MAX_PARTY; i++) char_from_recruit(&st->party[st->n_party++], picks[i], NULL, 1);
  it.id = ITEM_BANDAGE;
  it.qty = 3;
  st->stash[st->n_stash++] = it;
  it.id = ITEM_STIMPAK;
  it.qty = 1;
  st->stash[st->n_stash++] = it;
  generate_contracts(st, r);
}

/* ================================================================ podróż (travel.ts) */
const TravelEvent *roll_travel_event(Rng *r, double chance) {
  int i, tot = 0;
  double x;
  if (rng_f(r) >= chance) return NULL;
  for (i = 0; i < TRAVEL_EVENT_COUNT; i++) tot += TRAVEL_EVENTS[i].weight ? TRAVEL_EVENTS[i].weight : 1;
  x = rng_f(r) * tot;
  for (i = 0; i < TRAVEL_EVENT_COUNT; i++) {
    x -= TRAVEL_EVENTS[i].weight ? TRAVEL_EVENTS[i].weight : 1;
    if (x <= 0) return &TRAVEL_EVENTS[i];
  }
  return &TRAVEL_EVENTS[0];
}

Character *best_for_choice(CampaignState *st, const EventChoice *choice) {
  Character *best = NULL;
  int i;
  if (choice->skill == SKILL_NONE) return NULL;
  for (i = 0; i < st->n_party; i++) {
    Character *c = &st->party[i];
    if (c->cond[COND_DEAD]) continue;
    if (!best || get_stat(c, choice->skill, 0) > get_stat(best, choice->skill, 0)) best = c;
  }
  return best;
}
int choice_dc(const EventChoice *choice, int contract_level) { return choice->dc ? choice->dc : dc_for_level(contract_level); }

void resolve_event_choice(CampaignState *st, int contract_level, const EventChoice *choice, Rng *r, EventResolution *o) {
  const EventOutcome *out;
  Character *alive[MAX_PARTY];
  int na = 0, i;
  memset(o, 0, sizeof *o);
  o->degree = 2;
  if (choice->skill != SKILL_NONE) {
    o->who = best_for_choice(st, choice);
    if (o->who) {
      skill_check(o->who, choice->skill, choice_dc(choice, contract_level), r, &o->check);
      o->has_check = 1;
      o->degree = o->check.degree;
    }
  }
  out = choice->out[o->degree] ? choice->out[o->degree] : choice->out[2] ? choice->out[2] : choice->out[1];
  o->outcome = out;
  for (i = 0; i < st->n_party; i++) if (!st->party[i].cond[COND_DEAD]) alive[na++] = &st->party[i];
  if (!out) return;
  if (out->scrap) {
    int d = out->scrap < -st->scrap ? -st->scrap : out->scrap;
    st->scrap += d;
    o->scrap = d;
  }
  for (i = 0; i < out->n_items; i++) {
    uint8_t id = roll_item(out->items[i], contract_level, r);
    ItemInst it;
    if (id == ITEM_NONE) continue;
    it.id = id;
    it.qty = 1;
    add_to_stack(st->stash, &st->n_stash, MAX_STASH, it);
    o->items[o->n_items++] = id;
  }
  for (i = 0; i < FACTION_COUNT; i++) {
    if (!out->rep[i]) continue;
    st->rep[i] += out->rep[i];
    o->rep[i] = out->rep[i];
  }
  if (out->xp) {
    for (i = 0; i < na; i++) add_xp(alive[i], out->xp);
    o->xp = out->xp;
  }
  if (out->days) {
    st->day = st->day + out->days < 1 ? 1 : st->day + out->days;
    o->days = out->days;
  }
  if ((out->hp.n || out->hp.mod) && na) {
    int v = roll(r, out->hp, 0, NULL);
    Character *t = alive[pick_i(r, na)];
    t->hp = (int16_t)(t->hp - v < 1 ? 1 : t->hp - v);
    o->hp = v;
    o->hurt = t;
  }
}

/* ================================================================ rozliczenie (debrief.ts) */
void apply_mission_result(CampaignState *st, const MissionResult *mr, int ci, Rng *r, DebriefSummary *o) {
  Contract cc, *c = NULL;
  int ok = mr->result == MRES_SUCCESS, retreat = mr->result == MRES_RETREAT, fail = mr->result == MRES_FAIL, i, k, n;
  double mult = ok ? 1 : retreat ? 0.5 : 0;
  memset(o, 0, sizeof *o);
  o->result = mr->result;
  if (ci >= 0 && ci < st->n_contracts) {
    cc = st->contracts[ci];
    c = &cc;
  }
  /* polegli */
  for (i = 0, n = 0; i < st->n_party; i++) {
    Character *m = &st->party[i];
    int dead = m->cond[COND_DEAD] != 0;
    for (k = 0; k < mr->n_casualties && !dead; k++) if (!strcmp(mr->casualties[k]->name, m->name)) dead = 1;
    if (dead) {
      if (st->n_fallen < MAX_FALLEN) strcpy(st->fallen[st->n_fallen++], m->name);
      if (m->recruit < RECRUIT_COUNT && st->n_fallen_ids < MAX_FALLEN) st->fallen_ids[st->n_fallen_ids++] = m->recruit;
      o->n_fallen++;
      continue;
    }
    if (n != i) st->party[n] = *m;
    n++;
  }
  st->n_party = n;
  /* Złom */
  o->scrap = (int)js_round(mr->scrap * (fail ? 0 : 1) + (c ? c->reward_scrap : 0) * mult);
  for (i = 0; i < st->n_party; i++) {
    if (!st->party[i].stolen_scrap) continue;
    o->scrap += st->party[i].stolen_scrap;
    o->stolen += st->party[i].stolen_scrap;
    st->party[i].stolen_scrap = 0;
  }
  st->scrap += o->scrap;
  /* przedmioty */
  if (!fail)
    for (i = 0; i < mr->n_loot; i++) {
      add_to_stack(st->stash, &st->n_stash, MAX_STASH, mr->loot[i]);
      o->items[o->n_items++] = mr->loot[i].id;
    }
  if (ok && c)
    for (i = 0; i < c->n_reward_items; i++) {
      ItemInst it;
      it.id = c->reward_items[i];
      it.qty = 1;
      add_to_stack(st->stash, &st->n_stash, MAX_STASH, it);
      o->items[o->n_items++] = it.id;
    }
  /* reputacja */
  if (ok && c) {
    for (i = 0; i < FACTION_COUNT; i++) if (c->reward_rep[i]) { st->rep[i] += c->reward_rep[i]; o->rep[i] = c->reward_rep[i]; }
  } else if (fail) {
    int f = c ? c->faction : FACTION_SURVIVORS;
    st->rep[f] -= 1;
    o->rep[f] = -1;
  }
  /* PD */
  o->xp = (int)js_round(mr->xp * (fail ? 0.25 : retreat ? 0.5 : 1) + (ok && c ? c->reward_xp : 0));
  for (i = 0; i < st->n_party; i++) {
    Character *m = &st->party[i];
    if (m->hp <= 0) m->hp = 1;
    m->cond[COND_DYING] = 0;
    m->cond[COND_UNCONSCIOUS] = 0;
    o->levels_gained[i] = (uint8_t)add_xp(m, o->xp);
  }
  /* postęp */
  if (c) {
    for (k = ci; k + 1 < st->n_contracts; k++) st->contracts[k] = st->contracts[k + 1];
    st->n_contracts--;
  }
  if (ok && c) {
    if (st->n_completed < MAX_COMPLETED) strcpy(st->completed[st->n_completed++], c->id);
    if (c->story >= 0) {
      st->story++;
      o->story = 1;
      if (c->type == OBJ_BOSS) o->win = 1;
    }
  }
  st->day += c ? c->travel_days : 1;
  st->n_log++;
  if (o->win) st->victory = 1;
  refresh_board(st, ok ? 1 : 0, r);
  o->tpk = st->n_party == 0;
}
