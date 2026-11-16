/* Walka turowa, AI i misja. Port src/core/tactical/{combat,ai,mission}.ts.
 * Zamiast obiektów i Map z TS: stałe tablice i wskaźniki; sygnały przez słuchaczy (callback + kontekst). */
#ifndef COMBAT_H
#define COMBAT_H

#include "tactical.h"

/* Sortowanie jak Array.prototype.sort w V8 dla tablic < 64 elementów (także przy niespójnym komparatorze). */
typedef double (*JsCmp)(void *ctx, const void *a, const void *b);
void js_sort_ptr(void **arr, int n, JsCmp cmp, void *ctx);

#define MAX_ACTORS 32
#define MAX_PATH 256

typedef enum { SIDE_PC, SIDE_ENEMY, SIDE_NEUTRAL } Side;
typedef enum { AST_UP, AST_DOWN, AST_DEAD } ActorState;

struct Actor;
typedef struct EnemyGroup {
  uint8_t idx, n;
  struct Actor *actors[MAX_GROUP_MEMBERS];
  uint8_t alerted;
  int16_t next_notice;
  Pos center;
} EnemyGroup;

typedef struct Actor {
  int8_t gx, gy;
  Character *ch;
  uint8_t side, state;
  EnemyGroup *group;
  uint8_t engaged;
  uint8_t has_roam, roam_has_dest;
  Pos roam_home, roam_dest;
  uint8_t map_n;
  int16_t init;
  uint64_t used_free, used_b;  /* a.used['_free_<id>'], a.used['b_<id>'] (nigdy nie czyszczone, jak w TS) */
  uint8_t ambushed;            /* a.used._ambushed */
  uint8_t has_saved, saved_actions;
  int16_t saved_round;
  uint8_t is_target, following;
  uint64_t rest_used;          /* Combat.restUsed: zdolności użyte na tym celu od ostatniej walki */
} Actor;
static inline Pos apos(const Actor *a) { return mkpos(a->gx, a->gy); }

typedef struct {
  Actor *actor;
  uint8_t actions, full, used, delayed, switched;
} TurnInfo;

typedef enum { R_OK = 0, R_NOT_TURN, R_CANT_ACT, R_NO_ACTIONS, R_OCCUPIED, R_NO_PATH, R_STEP, R_TOO_FAR, R_OUT_OF_RANGE, R_NO_LOS,
               R_NEED_MOVE, R_CANT_APPROACH, R_UNKNOWN, R_NOT_KNOWN, R_NO_USES, R_COMBAT_ONLY, R_USED_THIS_TURN, R_NEED_TARGET,
               R_REST_SPENT, R_NOT_USABLE, R_WRONG_SIDE, R_NO_WEAPON2 } Reason;

typedef struct {
  uint8_t ok, reason;          /* reason: R_TOO_FAR (melee), R_OUT_OF_RANGE, R_NO_LOS */
  uint8_t melee;               /* cel poza zasięgiem broni białej (można podejść) */
  NormWeapon weapon;
  int mod, ac, base_ac;
  double hit, crit;            /* 0..1 */
  uint8_t flank, geo_cover, halves, concealed, frightened, inc, map_idx, ranged;
} StrikeInfo;

typedef enum {
  SIG_COMBAT_START, SIG_JOIN, SIG_ROUND, SIG_TURN_START, SIG_TURN_END, SIG_MOVE, SIG_STRIKE, SIG_ABILITY, SIG_ITEM, SIG_RULES,
  SIG_STATE, SIG_NOISE, SIG_END
} CombatSignalKind;
typedef enum { END_DEFEAT, END_TARGET, END_CLEARED } CombatEnd;

typedef struct {
  uint8_t kind;
  Actor *actor, *other;        /* strike: actor = atakujący, other = obrońca */
  Actor *const *list;          /* combatStart: kolejność; join: dołączający; ability/item: cele */
  int n_list;
  const Pos *path;
  int path_n;
  const ActionResult *result;
  const StrikeInfo *info;
  uint8_t ability, item;       /* SIG_ABILITY / SIG_ITEM */
  uint8_t has_cell;
  Pos cell;
  int round;
  uint8_t from, to;            /* SIG_STATE */
  int radius;                  /* SIG_NOISE */
  uint8_t outcome;             /* SIG_END */
  uint8_t boss, ambush;        /* SIG_COMBAT_START */
  const TurnInfo *turn;        /* SIG_TURN_START */
} CombatSignal;
typedef void (*CombatListener)(void *ctx, const CombatSignal *s);

typedef struct {
  Grid *grid;
  Actor **actors;              /* wszystkie postacie (kolejność jak w TS) */
  int *n_actors;
  EnemyGroup **groups;
  int *n_groups;
  Actor *target;
  int (*is_blocked)(void *ctx, int gx, int gy);
  int (*in_sight)(void *ctx, const Actor *a);
  int (*free_actions)(void *ctx);
  void *ctx;
} Battlefield;

typedef struct {
  Battlefield field;
  Rng *rng;
  uint8_t active;
  Actor *order[MAX_ACTORS * 2];
  int n_order;
  int round, idx;
  TurnInfo turn_data;
  TurnInfo *turn;              /* NULL = brak tury */
  CombatListener listeners[4];
  void *listener_ctx[4];
  int n_listeners;
  /* bufory wyników ostatniej akcji (ważne do następnej akcji) */
  ActionResult last;
  Pos path[MAX_PATH];
  int path_n;
} Combat;

typedef struct { uint8_t ok, reason; const ActionResult *result; const Pos *path; int path_n; } ActionOutcome;

void combat_init(Combat *c, const Battlefield *f, Rng *rng);
void combat_on(Combat *c, CombatListener fn, void *ctx);
int combat_foes_of(const Combat *c, const Actor *a, Actor **out);
Actor *combat_actor_at(const Combat *c, int gx, int gy);
int combat_occupied(const Combat *c, int gx, int gy);
int combat_speed_of(const Actor *a);
void combat_sync_all(Combat *c);
int combat_flanked(const Combat *c, uint8_t side, Pos pos, const Actor *def, const NormWeapon *w);
void combat_strike_info(Combat *c, Actor *att, Actor *def, const NormWeapon *w, Pos pos, StrikeInfo *out);
void combat_reach_for(Combat *c, const Actor *a, int actions, Search *res, int *sp);
int combat_exploring(const Combat *c);
int combat_spend_actions(Combat *c, Actor *a, int n);
ActionOutcome combat_stride(Combat *c, Actor *a, Pos dest);
ActionOutcome combat_step(Combat *c, Actor *a, Pos dest);
int combat_approach_cell(Combat *c, Actor *a, Actor *target, int actions, const NormWeapon *w, Pos *cell, double *cost, Search *res, int *sp);
ActionOutcome combat_strike(Combat *c, Actor *att, Actor *def, const NormWeapon *w);
ActionOutcome combat_attack_target(Combat *c, Actor *att, Actor *def, const NormWeapon *w);
int combat_ability_cost(uint8_t id);
int combat_ability_targets(Combat *c, Actor *a, uint8_t id, Actor **out);
int combat_area_targets(Combat *c, Pos cell, int radius, Actor **out);
int combat_area_targets_for(Combat *c, Actor *a, uint8_t id, Pos cell, Actor **out);
int combat_area_cell_ok(Combat *c, Actor *a, Pos cell, int range);
ActionOutcome combat_use_ability(Combat *c, Actor *a, uint8_t id, Actor **targets, int n_targets, const Pos *cell);
ActionOutcome combat_use_item(Combat *c, Actor *a, int inv_index, Actor *target, const Pos *cell);
ActionOutcome combat_swap_weapon(Combat *c, Actor *a);
ActionOutcome combat_take_cover(Combat *c, Actor *a);
void combat_noise(Combat *c, Actor *a, int radius);
void combat_engage(Combat *c, Actor **list, int n);
void combat_engage_visible(Combat *c);
void combat_relocate(Combat *c, Actor *a, const Pos *path, int n);
int combat_start(Combat *c, Actor **foes, int n, int ambush);
TurnInfo *combat_next_turn(Combat *c);
void combat_end_turn(Combat *c);
void combat_delay(Combat *c);
int combat_switch_to(Combat *c, Actor *b, int *immediate);
int combat_check_end(Combat *c); /* -1 = trwa, inaczej CombatEnd */
int area_affects(uint8_t id);    /* 0 sojusznicy, 1 wrogowie, 2 wszyscy */
int explore_ability_ok(uint8_t id);
int explore_item_ok(uint8_t item);

/* ---------------------------------------------------------------- AI (ai.ts) */
typedef enum { AI_ACT_STRIKE, AI_ACT_MOVE, AI_ACT_ABILITY, AI_ACT_COVER } AiActionType;
typedef struct { uint8_t type, ability; Actor *target; } AiAction;
int ai_step(Combat *c, Actor *a, AiAction *out); /* 0 = nic więcej */
int run_ai_turn(Combat *c, Actor *a, AiAction *done, int max);

/* ---------------------------------------------------------------- misja (mission.ts) */
typedef enum { TH_CRATE, TH_ITEM, TH_CAPTIVE, TH_DOOR, TH_DEVICE, TH_NEST } ThingKind;
typedef enum { MODE_EXPLORE, MODE_COMBAT, MODE_OVER } MissionMode;
typedef enum { MRES_SUCCESS, MRES_FAIL, MRES_RETREAT } MissionOutcome;

typedef struct {
  int8_t gx, gy;
  uint8_t kind, done, item, tries, freed, objective;
  Actor *actor;
  uint8_t has_lock;
  LockState lock;
  uint8_t quality, device;
  uint8_t name_kind;           /* do opisu w UI */
} MissionThing;

typedef struct { FindSpawn f; uint8_t found, taken, tried; } MissionFind;

typedef struct {
  const char *id;
  uint8_t type, level, biome;
  uint8_t enemies[MAX_ENEMIES_IN];
  int n_enemies;
  uint8_t item;                /* przedmiot celu (retrieve) albo ITEM_NONE */
} MissionContract;

#define MAX_THINGS 24
#define MAX_LOOT 64
typedef struct {
  uint8_t result;
  int xp, scrap;
  uint8_t n_loot;
  ItemInst loot[MAX_LOOT];
  uint8_t n_casualties;
  Character *casualties[MAX_PARTY];
} MissionResult;

typedef enum { MSIG_DISCOVER, MSIG_PICKUP, MSIG_SPOTTED, MSIG_CRATE, MSIG_INTERACT, MSIG_LOCK, MSIG_OBJECTIVE, MSIG_COMPLETE, MSIG_VISIBILITY, MSIG_FINISH } MissionSignalKind;
typedef struct {
  uint8_t kind;
  Actor *by;
  MissionFind *find;
  MissionThing *thing;
  EnemyGroup *group;
  const CheckResult *roll;
  const LockAttempt *attempt;
  int scrap, trap_damage, close, hack;
  const ItemInst *items;
  int n_items;
  const MissionResult *result;
} MissionSignal;
typedef void (*MissionListener)(void *ctx, const MissionSignal *s);

typedef struct Mission {
  MissionContract contract;
  uint8_t obj_type;
  TacticalMap map;
  Rng *rng;
  Actor actor_store[MAX_ACTORS];
  Character char_store[MAX_ACTORS]; /* wrogowie i neutralni */
  int n_chars;
  Actor *actors[MAX_ACTORS];
  int n_actors;
  Actor *pcs[MAX_PARTY];
  int n_pcs;
  Actor *enemies[MAX_ACTORS];
  int n_enemies;
  Actor *neutral[8];
  int n_neutral;
  EnemyGroup group_store[MAX_MAP_GROUPS];
  EnemyGroup *groups[MAX_MAP_GROUPS];
  int n_groups;
  MissionThing things[MAX_THINGS];
  int n_things;
  MissionFind finds[MAX_FINDS];
  int n_finds;
  Combat combat;
  Actor *target;
  int item_thing, captive, obj_device;   /* indeksy w things albo -1 */
  int settlers[8], n_settlers, nests[8], n_nests;
  int wave, next_wave;
  uint8_t mode;
  int stage, steps, scrap;
  uint8_t n_loot;
  ItemInst loot[MAX_LOOT];
  Character *killed[MAX_ACTORS];
  int n_killed;
  uint8_t explored[GRID_N], vis[GRID_N];
  uint8_t has_result;
  MissionResult result;
  MissionListener listeners[4];
  void *listener_ctx[4];
  int n_listeners;
  Character **party;
  int n_party;
} Mission;

#define SIGHT_PC_R 9
#define SIGHT_NEUTRAL_R 5

void mission_init(Mission *m, const MissionContract *contract, Character **party, int n_party, Rng *rng);
void mission_on(Mission *m, MissionListener fn, void *ctx);
int mission_in_combat(const Mission *m);
MissionThing *mission_thing_at(Mission *m, int gx, int gy);
int mission_is_visible(const Mission *m, Pos p);
void mission_update_visibility(Mission *m);
int mission_move_range(Mission *m, const Actor *sel, int group);
typedef struct { Actor *actor; Pos path[MAX_PATH]; int n; } ActorPath;
typedef struct { int ok; int combat; int n; ActorPath paths[MAX_ACTORS]; } ExploreResult;
void mission_explore_move(Mission *m, Actor *sel, Pos target, int group, ExploreResult *out);
void mission_check_finds(Mission *m);
EnemyGroup *mission_check_spotting(Mission *m);
void mission_start_combat(Mission *m, EnemyGroup *g, int ambush);
int mission_advance_world(Mission *m, ExploreResult *out); /* dopisuje ścieżki do out (może być NULL) */
void mission_ambush_attack(Mission *m, Actor *a, EnemyGroup *g, CheckResult *out);
int mission_interact(Mission *m, Actor *a, MissionThing *th, uint8_t skill); /* skill: SKILL_NONE gdy brak */
MissionThing *mission_add_locked_door(Mission *m, int gx, int gy, uint8_t quality);
MissionThing *mission_add_device(Mission *m, int gx, int gy, uint8_t device);
int mission_interact_cell(Mission *m, Actor *a, Pos th, Pos *out);
int mission_objective_done(const Mission *m);
int mission_needs_extraction(const Mission *m);
void mission_check_objective(Mission *m);
int mission_can_extract(Mission *m);
const MissionResult *mission_finish(Mission *m, uint8_t result);
const MissionResult *mission_retreat(Mission *m);

#endif
