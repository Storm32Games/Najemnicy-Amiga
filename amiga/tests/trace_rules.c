/* Ślad zasad w C - musi być identyczny z amiga/data/traces/rules.txt (tools/amiga/trace_rules.ts). */
#include <stdio.h>
#include <string.h>
#include "trace_fmt.h"

static const Character *LA[8];
static const char *LN[8];
static int NL;
static void labels_clear(void) { NL = 0; }
static void label(const Character *c, const char *n) { LA[NL] = c; LN[NL] = n; NL++; }
static const char *L(const Character *c) {
  int i;
  for (i = 0; i < NL; i++) if (LA[i] == c) return LN[i];
  return "?";
}
static void R(Character *ch, int i, int lvl) { char_from_recruit(ch, (uint8_t)i, NULL, lvl); }
static void E(Character *ch, uint8_t id) { char_create_enemy(ch, id, 0); }
static void Rs(Rng *r, const char *fmt_seed) { rng_seed_str(r, fmt_seed); }
static Dice mk(int n, int s, int m) { Dice d; d.n = (uint8_t)n; d.sides = (uint8_t)s; d.mod = (int8_t)m; return d; }

static const char *LOCK_KEYS[LOCK_COUNT] = {"poor", "simple", "average", "good", "superior"};
static const char *DEVICE_KEYS[DEVICE_COUNT] = {"terminal", "computer", "server", "security", "robot"};

static int in_list(const uint8_t *list, int n, uint8_t id) {
  int i;
  for (i = 0; i < n; i++) if (list[i] == id) return 1;
  return 0;
}

static void print_stash(const char *tag, const ItemInst *s, int n, int ok) {
  int i;
  if (ok >= 0) printf("%s %d stash=", tag, ok);
  else printf("%s stash=", tag);
  for (i = 0; i < n; i++) printf("%s%s:%d", i ? "," : "", ITEM_DEFS[s[i].id].key, s[i].qty);
  printf("\n");
}
static int find_in(const ItemInst *s, int n, uint8_t id) {
  int i;
  for (i = 0; i < n; i++) if (s[i].id == id) return i;
  return -1;
}

int main(void) {
  char seed[96];
  Rng rng;
  int ri, lvl, e, k, v, a, side, t;
  static const int LVLS[3] = {1, 3, 6};
  static const uint8_t MODS[15] = {COND_FRIGHTENED, COND_HIDDEN, COND_PRONE, COND_IN_COVER, COND_OFF_GUARD, COND_RAGING, COND_HUNTED, COND_STIMMED,
                                    COND_TUNED, COND_CLUMSY, COND_SICKENED, COND_ENFEEBLED, COND_RAISED_SHIELD, COND_DODGING, COND_REINFORCED};
  Character A, D, U, F0, F1, A0, C, Y;
  ActionResult res;
  StrikeOptions o;

  /* ---- R1 */
  for (ri = 0; ri < RECRUIT_COUNT; ri++) {
    for (lvl = 0; lvl < 3; lvl++) {
      for (e = 0; e < ENEMY_COUNT; e++) {
        R(&A, ri, LVLS[lvl]);
        E(&D, (uint8_t)e);
        labels_clear(); label(&A, "A"); label(&D, "D");
        sprintf(seed, "st:%d:%d:%s", ri, LVLS[lvl], ENEMY_DEFS[e].key);
        Rs(&rng, seed);
        printf("strike %s %d %s\n", RECRUIT_DEFS[ri].key, LVLS[lvl], ENEMY_DEFS[e].key);
        result_clear(&res); strike_options_default(&o);
        strike(&A, &D, &o, &rng, &res);
        print_res(stdout, &res, L);
        print_snap(stdout, "D", &D);
        for (k = 0; k < D.n_attacks; k++) {
          NormWeapon w;
          norm_from_attack(&D.attacks[k], &w);
          result_clear(&res); strike_options_default(&o); o.weapon = &w;
          strike(&D, &A, &o, &rng, &res);
          print_res(stdout, &res, L);
          print_snap(stdout, "A", &A);
        }
      }
    }
  }

  /* ---- R2 */
  for (ri = 0; ri < RECRUIT_COUNT; ri++) {
    for (k = 0; k < 15; k++) {
      for (side = 0; side < 2; side++) {
        R(&A, ri, 4);
        E(&D, ENEMY_RAIDER_THUG);
        add_condition(side ? &D : &A, MODS[k], 2);
        labels_clear(); label(&A, "A"); label(&D, "D");
        sprintf(seed, "sm:%d:%s:%d", ri, CONDITION_DEFS[MODS[k]].key, side);
        Rs(&rng, seed);
        printf("strikemod %s %s %d\n", RECRUIT_DEFS[ri].key, CONDITION_DEFS[MODS[k]].key, side);
        result_clear(&res); strike_options_default(&o); o.map_index = side;
        strike(&A, &D, &o, &rng, &res);
        print_res(stdout, &res, L);
        result_clear(&res); strike_options_default(&o);
        strike(&D, &A, &o, &rng, &res);
        print_res(stdout, &res, L);
        print_snap(stdout, "A", &A);
        print_snap(stdout, "D", &D);
      }
    }
  }

  /* ---- R3 */
  for (a = 0; a < ABIL_COUNT; a++) {
    const AbilityDef *ab = &ABILITY_DEFS[a];
    int area_allies = a == ABIL_RALLY || a == ABIL_FIELD_CLINIC || a == ABIL_CHIEF_RALLY || a == ABIL_KOSTUCHA_COMMAND;
    for (v = 0; v < 8; v++) {
      int enemy_user = 0, i, w = v % 4;
      AbilityContext ctx;
      Character *ally;
      if (in_list(UNIVERSAL_ABILITIES, UNIVERSAL_ABILITY_COUNT, (uint8_t)a)) R(&U, (a + v) % RECRUIT_COUNT, 5);
      else {
        int found = -1;
        for (i = 0; i < RECRUIT_COUNT && found < 0; i++) {
          const ClassDef *c = &CLASS_DEFS[RECRUIT_DEFS[i].class_id];
          if (in_list(c->abilities, c->n_abilities, (uint8_t)a)) found = i;
        }
        if (found >= 0) R(&U, found, 5);
        else {
          for (i = 0; i < ENEMY_COUNT; i++) if (in_list(ENEMY_DEFS[i].abilities, ENEMY_DEFS[i].n_abilities, (uint8_t)a)) break;
          E(&U, (uint8_t)i);
          enemy_user = 1;
        }
      }
      if (enemy_user) {
        R(&F0, 0, 3); R(&F1, 5, 3); E(&A0, ENEMY_RAIDER_THUG);
      } else {
        E(&F0, ENEMY_RAIDER_THUG); E(&F1, v % 2 ? ENEMY_ROBOT : ENEMY_GHOUL); R(&A0, 2, 3);
      }
      ally = &A0;
      apply_damage(ally, ally->max_hp / 2, DMG_P, 0);
      add_condition_dice(ally, COND_BLEEDING, mk(1, 6, 0));
      add_condition(ally, COND_FRIGHTENED, 1);
      if (w == 3) apply_damage(ally, ally->hp + 5, DMG_P, 0);
      if (w == 2) {
        add_condition(&F0, COND_OFF_GUARD, 1);
        add_condition(&U, COND_HIDDEN, 1);
      }
      memset(&ctx, 0, sizeof ctx);
      ctx.user = &U;
      if (ab->target == TARGET_ENEMY) ctx.targets[ctx.n_targets++] = &F0;
      else if (ab->target == TARGET_ALLY) ctx.targets[ctx.n_targets++] = ally;
      else if (ab->target == TARGET_SELF) { /* brak */ }
      else if (ab->target == TARGET_AREA) {
        if (area_allies) { ctx.targets[ctx.n_targets++] = ally; ctx.targets[ctx.n_targets++] = &U; }
        else {
          ctx.targets[ctx.n_targets++] = &F0; ctx.targets[ctx.n_targets++] = &F1;
          if (ab->range > 0) ctx.targets[ctx.n_targets++] = ally;
        }
      } else { ctx.targets[ctx.n_targets++] = &F0; ctx.targets[ctx.n_targets++] = &F1; }
      sprintf(seed, "ab:%s:%d", ab->key, v);
      Rs(&rng, seed);
      ctx.rng = &rng;
      ctx.map_index = w == 1 ? 1 : 0;
      labels_clear(); label(&U, "U"); label(&F0, "F0"); label(&F1, "F1"); label(&A0, "A0");
      printf("ability %s %d\n", ab->key, v);
      use_ability((uint8_t)a, &ctx, &res);
      print_res(stdout, &res, L);
      print_snap(stdout, "U", &U);
      print_snap(stdout, "F0", &F0);
      print_snap(stdout, "F1", &F1);
      print_snap(stdout, "A0", &A0);
    }
  }

  /* ---- R4 */
  for (k = 0; k < ITEM_COUNT; k++) {
    const ConsumableStats *c = ITEM_DEFS[k].consumable;
    if (!c) continue;
    for (v = 0; v < 3; v++) {
      Character *tg[3];
      int n = 0;
      R(&U, v * 3, 3);
      inv_add(&U, (uint8_t)k, 2);
      R(&A0, v * 3 + 1, 3);
      apply_damage(&A0, A0.max_hp / 2, DMG_P, 0);
      add_condition_dice(&A0, COND_BLEEDING, mk(1, 6, 0));
      add_condition_dice(&A0, COND_POISONED, mk(1, 4, 0));
      add_condition(&A0, COND_BURNING, 2);
      add_condition(&A0, COND_SICKENED, 1);
      E(&F0, ENEMY_RAIDER_THUG);
      E(&F1, v == 1 ? ENEMY_DRONE : ENEMY_ROBOT);
      if (c->target == TARGET_AREA) { tg[n++] = &F0; tg[n++] = &F1; tg[n++] = &A0; }
      else if (c->target != TARGET_SELF) tg[n++] = &A0;
      labels_clear(); label(&U, "U"); label(&F0, "F0"); label(&F1, "F1"); label(&A0, "A0");
      sprintf(seed, "it:%s:%d", ITEM_DEFS[k].key, v);
      Rs(&rng, seed);
      printf("item %s %d\n", ITEM_DEFS[k].key, v);
      use_consumable(&U, U.n_inv - 1, tg, n, &rng, &res);
      print_res(stdout, &res, L);
      print_snap(stdout, "U", &U);
      print_snap(stdout, "F0", &F0);
      print_snap(stdout, "F1", &F1);
      print_snap(stdout, "A0", &A0);
    }
  }

  /* ---- R5 */
  for (v = 0; v < 6; v++) {
    int actions;
    R(&C, v, 2);
    sprintf(seed, "turn:%d", v);
    Rs(&rng, seed);
    add_condition_dice(&C, COND_BLEEDING, mk(1, 6, 0));
    add_condition_dice(&C, COND_BURNING, mk(1, 4, 0));
    add_condition(&C, COND_POISONED, 2);
    add_condition(&C, COND_STUNNED, 1);
    add_condition(&C, COND_QUICKENED, 1);
    add_condition(&C, COND_FRIGHTENED, 2);
    add_condition(&C, COND_RAISED_SHIELD, 1);
    labels_clear(); label(&C, "C");
    for (t = 0; t < 5; t++) {
      result_clear(&res);
      start_turn(&C, &rng, &actions, &res);
      printf("turn %d %d actions=%d\n", v, t, actions);
      print_res(stdout, &res, L);
      end_turn(&C, NULL);
      print_snap(stdout, "C", &C);
    }
    R(&Y, v + 6, 1);
    apply_damage(&Y, Y.hp + 3, DMG_P, v % 2 == 1);
    labels_clear(); label(&Y, "Y");
    for (t = 0; t < 6; t++) {
      result_clear(&res);
      start_turn(&Y, &rng, &actions, &res);
      printf("dying %d %d actions=%d\n", v, t, actions);
      print_res(stdout, &res, L);
      print_snap(stdout, "Y", &Y);
    }
  }

  /* ---- R6 */
  for (ri = 0; ri < RECRUIT_COUNT; ri++) {
    R(&C, ri, 1 + ri % 5);
    if (ri % 3 == 0) add_condition(&C, COND_FRIGHTENED, 1);
    sprintf(seed, "init:%d", ri);
    Rs(&rng, seed);
    printf("init %s", RECRUIT_DEFS[ri].key);
    for (k = 0; k < 3; k++) {
      InitiativeRoll ir = roll_initiative(&C, &rng);
      printf(" %d/%d/%d", ir.d20, ir.mod, ir.total);
    }
    printf("\n");
  }

  /* ---- R7 */
  for (ri = 0; ri < RECRUIT_COUNT; ri++) {
    R(&C, ri, 3);
    if (ri % 2 == 0) inv_add(&C, ITEM_LOCKPICK, 2);
    sprintf(seed, "lock:%d", ri);
    Rs(&rng, seed);
    for (k = 0; k < LOCK_COUNT; k++) {
      LockState lock, force;
      LockAttempt at;
      int n;
      lock_state(&lock, (uint8_t)k);
      printf("lock %s %s", RECRUIT_DEFS[ri].key, LOCK_KEYS[k]);
      for (n = 0; n < 6 && lock.progress < lock.needed; n++) {
        pick_lock(&C, &lock, SKILL_THIEVERY, &rng, &at);
        printf(" %d/%d/%d/%d/%d/%d", at.roll.total, at.roll.degree, at.gained, at.opened, at.broke_tool, at.improvised);
      }
      lock_state(&force, (uint8_t)k);
      for (n = 0; n < 3 && force.progress < force.needed; n++) {
        pick_lock(&C, &force, SKILL_ATHLETICS, &rng, &at);
        printf(" F%d/%d/%d/%d/%d/%d", at.roll.total, at.roll.degree, at.opened, at.broken, at.jammed, force.force_penalty);
      }
      printf(" prog=%d/%d\n", lock.progress, lock.needed);
    }
    for (k = 0; k < DEVICE_COUNT; k++) {
      LockState dev;
      LockAttempt at;
      int n;
      uint8_t skill = ri % 2 ? SKILL_CRAFTING : SKILL_THIEVERY;
      device_state(&dev, (uint8_t)k, 3);
      printf("hack %s %s dc=%d", RECRUIT_DEFS[ri].key, DEVICE_KEYS[k], dev.dc);
      for (n = 0; n < 6 && dev.progress < dev.needed && !dev.jammed; n++) {
        hack_device(&C, &dev, skill, &rng, &at);
        printf(" %d/%d/%d/%d/%d", at.roll.total, at.roll.degree, at.gained, at.opened, at.alarm);
      }
      printf(" prog=%d/%d j=%d\n", dev.progress, dev.needed, dev.jammed);
    }
    print_snap(stdout, "C", &C);
  }
  Rs(&rng, "lockForLevel");
  printf("lockForLevel ");
  for (lvl = 0, k = 0; lvl <= 10; lvl++) {
    int j;
    for (j = 0; j < 3; j++, k++) printf("%s%s", k ? "," : "", LOCK_KEYS[lock_for_level(lvl, &rng)]);
  }
  printf("\n");

  /* ---- R8 */
  {
    ItemInst stash[16];
    uint8_t ns = 0;
    int ok;
    ItemInst it;
    R(&C, 12, 1);
    it.qty = 1;
    it.id = ITEM_SLEDGEHAMMER; stash[ns++] = it;
    it.id = ITEM_SCRAP_SHIELD; stash[ns++] = it;
    it.id = ITEM_BANDAGE; it.qty = 3; stash[ns++] = it;
    it.id = ITEM_RIOT_ARMOR; it.qty = 1; stash[ns++] = it;
    print_stash("equip0", stash, ns, -1);
    print_snap(stdout, "C", &C);
    ok = equip_item(&C, SLOT_WEAPON, stash, &ns, 0, stash, &ns, 16);
    print_stash("equip1", stash, ns, ok);
    print_snap(stdout, "C", &C);
    ok = equip_item(&C, SLOT_SHIELD, stash, &ns, find_in(stash, ns, ITEM_SCRAP_SHIELD), stash, &ns, 16);
    print_stash("equip2", stash, ns, ok);
    ok = unequip_item(&C, SLOT_WEAPON, stash, &ns, 16);
    print_stash("equip3", stash, ns, ok);
    ok = equip_item(&C, SLOT_SHIELD, stash, &ns, find_in(stash, ns, ITEM_SCRAP_SHIELD), stash, &ns, 16);
    print_stash("equip4", stash, ns, ok);
    ok = equip_item(&C, SLOT_ARMOR, stash, &ns, find_in(stash, ns, ITEM_RIOT_ARMOR), stash, &ns, 16);
    print_stash("equip5", stash, ns, ok);
    ok = equip_item(&C, SLOT_ARMOR, stash, &ns, find_in(stash, ns, ITEM_BANDAGE), stash, &ns, 16);
    print_stash("equip6", stash, ns, ok);
    printf("swap %d\n", swap_weapons(&C));
    print_snap(stdout, "C", &C);
    move_item(stash, &ns, find_in(stash, ns, ITEM_BANDAGE), C.inv, &C.n_inv, INV_MAX, 0);
    print_stash("move1", stash, ns, -1);
    move_item(stash, &ns, find_in(stash, ns, ITEM_BANDAGE), C.inv, &C.n_inv, INV_MAX, 1);
    print_stash("move2", stash, ns, -1);
    it.id = ITEM_BANDAGE; it.qty = 2; add_to_stack(C.inv, &C.n_inv, INV_MAX, it);
    it.id = ITEM_PIPE; it.qty = 1; add_to_stack(C.inv, &C.n_inv, INV_MAX, it);
    add_to_stack(C.inv, &C.n_inv, INV_MAX, it);
    print_snap(stdout, "C", &C);
  }

  /* ---- R9 */
  for (ri = 0; ri < RECRUIT_COUNT; ri++) {
    int g0, g1, g2;
    R(&C, ri, 1);
    g0 = add_xp(&C, 450); g1 = add_xp(&C, 900); g2 = add_xp(&C, 3333);
    add_condition(&C, COND_FRIGHTENED, 2);
    add_condition_dice(&C, COND_BLEEDING, mk(1, 6, 0));
    add_condition(&C, COND_WOUNDED, 1);
    add_condition(&C, COND_RAGING, 3);
    C.temp_hp = 5;
    for (k = 0; k < ABIL_COUNT; k++) if (C.uses[k] != USES_UNSET) C.uses[k] = 0;
    printf("xp %s %d,%d,%d\n", RECRUIT_DEFS[ri].key, g0, g1, g2);
    end_encounter(&C);
    print_snap(stdout, "E", &C);
    apply_damage(&C, 7, DMG_S, 0);
    long_rest(&C);
    print_snap(stdout, "L", &C);
  }
  for (e = 0; e < ENEMY_COUNT; e++) {
    sprintf(seed, "loot:%s", ENEMY_DEFS[e].key);
    Rs(&rng, seed);
    printf("loot %s", ENEMY_DEFS[e].key);
    for (k = 0; k < 5; k++) {
      ItemInst items[5];
      int n, j, scrap = roll_loot(&rng, (uint8_t)e, items, 5, &n);
      printf(" %d[", scrap);
      for (j = 0; j < n; j++) printf("%s%s:%d", j ? "," : "", ITEM_DEFS[items[j].id].key, items[j].qty);
      printf("]");
    }
    printf("\n");
  }
  return 0;
}
