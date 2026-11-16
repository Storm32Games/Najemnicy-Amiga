/* Zasady walki: wynik akcji (zdarzenia), obrażenia, umieranie, tura, atak, zdolności, przedmioty, ekwipunek, zamki.
 * Port src/core/rules/{types,damage,turn,strike,abilities,consumables,equipment,locks}.ts.
 * Dziennik walki (teksty) nie jest generowany w logice - widok buduje go ze zdarzeń. */
#ifndef RULES_H
#define RULES_H

#include "character.h"
#include "dice.h"

/* ---------------------------------------------------------------- zdarzenia i wynik akcji */
typedef enum { EV_DAMAGE, EV_HEAL, EV_MISS, EV_CONDITION, EV_CRIT, EV_DEATH, EV_DOWN, EV_RECOVERY, EV_STEAL, EV_SCRAP } RuleEventType;
#define COND_STABLE 0xFE /* EV_CONDITION: stabilizacja umierającego */

typedef struct {
  uint8_t type;
  Character *target;          /* NULL dla EV_SCRAP */
  int16_t amount;
  uint8_t dmg_type;           /* EV_DAMAGE */
  uint8_t degree;             /* EV_DAMAGE / EV_MISS / EV_RECOVERY / EV_CRIT; NONE8 = brak */
  uint8_t persistent;         /* EV_DAMAGE: id stanu ciągłego albo COND_NONE */
  uint8_t temp;               /* EV_HEAL: tymczasowe PW */
  uint8_t cond;               /* EV_CONDITION */
  uint8_t has_value;
  int8_t value;               /* EV_CONDITION: wartość po nałożeniu */
  Dice value_dice;            /* EV_CONDITION: kość (obrażenia ciągłe) */
  uint8_t item;               /* EV_STEAL */
} RuleEvent;

/* Rzut obrażeń / leczenia do pokazania: kości (sumowane i mnożone), stała, mnożnik, kości po mnożeniu. */
typedef struct {
  uint8_t n, n_post;
  DieRoll dice[ROLL_MAX_DICE];
  DieRoll post[4];
  int16_t flat;
  uint8_t mult2;              /* mnożnik x2: 0 = x0, 1 = x0.5, 2 = x1, 4 = x2 */
  int16_t total;
} DamageRoll;

#define RESULT_EVENTS_MAX 48
typedef struct {
  uint8_t attack;             /* liczy się do PWA */
  uint8_t attacks;            /* ile ataków doliczyć (0 = 1, gdy attack) */
  uint8_t has_d20, has_dmg, has_heal, has_weapon;
  uint8_t hit, consumed;
  int16_t dealt;
  CheckResult d20;
  DamageRoll dmg, heal;
  NormWeapon weapon;
  uint8_t n_events;
  RuleEvent events[RESULT_EVENTS_MAX];
} ActionResult;

void result_clear(ActionResult *r);
RuleEvent *result_event(ActionResult *r, uint8_t type, Character *target);

/* ---------------------------------------------------------------- obrażenia (damage.ts) */
typedef struct { int dealt, downed, dead; } DamageOutcome;
int is_alive(const Character *ch);
int is_down(const Character *ch);
int can_act(const Character *ch);
DamageOutcome apply_damage(Character *ch, int amount, uint8_t type, int crit);
int heal(Character *ch, int amount);
void grant_temp_hp(Character *ch, int n);
typedef struct { CheckResult c; int before, dead, stable; } RecoveryResult;
void recovery_check(Character *ch, Rng *r, RecoveryResult *out);

/* ---------------------------------------------------------------- tura (turn.ts) */
void start_turn(Character *ch, Rng *r, int *actions, ActionResult *events);
void end_turn(Character *ch, ActionResult *events);
typedef struct { int d20, mod, total; } InitiativeRoll;
InitiativeRoll roll_initiative(const Character *ch, Rng *r);
void check_by(const Character *ch, int mod, int dc, Rng *r, int extra_halves, CheckResult *out);
void skill_check(const Character *ch, int stat_key, int dc, Rng *r, CheckResult *out);

/* ---------------------------------------------------------------- atak (strike.ts) */
typedef struct {
  const NormWeapon *weapon;   /* NULL = pierwsza broń atakującego */
  int map_index;
  int bonus, damage_bonus, extra_dice;
  int ignore_cover, range_increments, sneak;
  int hit_halves;             /* -1 = attack_halves(atakujący, obrońca) */
} StrikeOptions;
void strike_options_default(StrikeOptions *o);
void strike(Character *att, Character *def, const StrikeOptions *o, Rng *r, ActionResult *res);

/* ---------------------------------------------------------------- zdolności (abilities.ts) */
#define CTX_TARGETS_MAX 24
typedef struct {
  Character *user;
  Character *targets[CTX_TARGETS_MAX];
  int n_targets;
  Rng *rng;
  int map_index;
  int bonus, damage_bonus;
} AbilityContext;
int is_machine(const Character *t);
int can_use(const Character *u, uint8_t id);
int uses_left(const Character *u, uint8_t id); /* 255 = bez limitu */
void use_ability(uint8_t id, AbilityContext *ctx, ActionResult *res);
/* pomocnicze wspólne z przedmiotami */
void cond_ev(ActionResult *res, Character *t, uint8_t id, int value);
void cond_ev_dice(ActionResult *res, Character *t, uint8_t id, Dice d);
void basic_save(ActionResult *res, Character *t, uint8_t save, int dc, Dice expr, uint8_t type, Rng *r, const Character *by, CheckResult *c_out);

/* ---------------------------------------------------------------- przedmioty jednorazowe (consumables.ts) */
void use_consumable(Character *user, int inv_index, Character **targets, int n_targets, Rng *r, ActionResult *res);

/* ---------------------------------------------------------------- ekwipunek (equipment.ts); listy: tablica + licznik + pojemność */
void add_to_stack(ItemInst *list, uint8_t *n, int cap, ItemInst inst);
int is_two_handed(uint8_t item);
int equip_item(Character *ch, int slot, ItemInst *from, uint8_t *n_from, int from_index, ItemInst *stash, uint8_t *n_stash, int cap);
int unequip_item(Character *ch, int slot, ItemInst *stash, uint8_t *n_stash, int cap);
int swap_weapons(Character *ch);
void move_item(ItemInst *from, uint8_t *n_from, int index, ItemInst *to, uint8_t *n_to, int cap, int all);

/* ---------------------------------------------------------------- zamki i hakowanie (locks.ts) */
typedef struct { uint8_t dc, needed, progress, jammed; int8_t force_penalty; } LockState;
typedef struct {
  CheckResult roll;
  uint8_t skill, gained, opened, broke_tool, jammed, broken, alarm, improvised;
} LockAttempt;
void lock_state(LockState *l, uint8_t quality);
void device_state(LockState *l, uint8_t device, int mission_level);
uint8_t lock_for_level(int level, Rng *r);
int has_lockpick(const Character *ch);
void pick_lock(Character *ch, LockState *lock, uint8_t skill, Rng *r, LockAttempt *out);
void hack_device(Character *ch, LockState *dev, uint8_t skill, Rng *r, LockAttempt *out);

#endif
