/* Ślad walki, AI i misji - zgodny z amiga/data/traces/mission.txt (tools/amiga/trace_mission.ts). */
#include <stdio.h>
#include <string.h>
#include "trace_fmt.h"
#include "../src/core/combat.h"

static Mission M;
static const char *const AST[3] = {"up", "down", "dead"};
static const char *const MODES[3] = {"explore", "combat", "over"};
static const char *const OUTC[3] = {"defeat", "target", "cleared"};
static const char *const MRES[3] = {"success", "fail", "retreat"};
static const char *const OBJECTIVE_KEYS[9] = {"eliminate", "retrieve", "rescue", "hunt", "boss", "hack", "liberate", "purge", "defend"};
static const char *const AIACT[4] = {"strike", "move", "ability", "cover"};

static char labbuf[8][8];
static int labi;
static const char *lab(const Actor *a) {
  int i;
  char *b = labbuf[labi++ & 7];
  if (!a) return "-";
  for (i = 0; i < M.n_actors; i++) if (M.actors[i] == a) { sprintf(b, "a%d", i); return b; }
  return "?";
}
static const char *lab_ch(const Character *ch) {
  int i;
  for (i = 0; i < M.n_actors; i++) if (M.actors[i]->ch == ch) return lab(M.actors[i]);
  return "?";
}
static void print_path(const Pos *p, int n) {
  int i;
  for (i = 0; i < n; i++) printf("%s%d,%d", i ? ";" : "", p[i].gx, p[i].gy);
}
static void print_list(Actor *const *l, int n) {
  int i;
  for (i = 0; i < n; i++) printf("%s%s", i ? "," : "", lab(l[i]));
}

static void on_combat(void *ctx, const CombatSignal *s) {
  (void)ctx;
  switch (s->kind) {
    case SIG_COMBAT_START: printf("C start "); print_list(s->list, s->n_list); printf(" boss=%d amb=%d\n", s->boss, s->ambush); break;
    case SIG_JOIN: printf("C join "); print_list(s->list, s->n_list); printf("\n"); break;
    case SIG_ROUND: printf("C round %d\n", s->round); break;
    case SIG_TURN_START: printf("C turn %s %d r%d\n", lab(s->turn->actor), s->turn->actions, s->round); break;
    case SIG_TURN_END: printf("C tend %s\n", lab(s->actor)); break;
    case SIG_MOVE: printf("C move %s ", lab(s->actor)); print_path(s->path, s->path_n); printf("\n"); break;
    case SIG_STRIKE:
      printf("C strike %s>%s mod=%d ac=%d hit=%d fl=%d gc=%d inc=%d map=%d\n", lab(s->actor), lab(s->other), s->info->mod, s->info->ac,
             (int)js_round(s->info->hit * 20), s->info->flank, s->info->geo_cover, s->info->inc, s->info->map_idx);
      print_res(stdout, s->result, lab_ch);
      break;
    case SIG_ABILITY:
      printf("C ability %s %s ", lab(s->actor), ABILITY_DEFS[s->ability].key);
      print_list(s->list, s->n_list);
      if (s->has_cell) printf(" cell=%d,%d\n", s->cell.gx, s->cell.gy); else printf(" cell=-\n");
      print_res(stdout, s->result, lab_ch);
      break;
    case SIG_ITEM:
      printf("C item %s %s ", lab(s->actor), ITEM_DEFS[s->item].key);
      print_list(s->list, s->n_list);
      printf("\n");
      print_res(stdout, s->result, lab_ch);
      break;
    case SIG_RULES: {
      ActionResult r;
      result_clear(&r);
      r.n_events = s->result->n_events;
      memcpy(r.events, s->result->events, sizeof(RuleEvent) * r.n_events);
      printf("C rules %s ", lab(s->actor));
      print_res(stdout, &r, lab_ch);
      break;
    }
    case SIG_STATE: printf("C state %s %s>%s\n", lab(s->actor), AST[s->from], AST[s->to]); break;
    case SIG_NOISE: printf("C noise %s %d\n", lab(s->actor), s->radius); break;
    case SIG_END: printf("C end %s\n", OUTC[s->outcome]); break;
  }
}

static int group_index(const EnemyGroup *g) {
  int i;
  for (i = 0; i < M.n_groups; i++) if (M.groups[i] == g) return i;
  return -1;
}
static void print_items(const ItemInst *it, int n) {
  int i;
  for (i = 0; i < n; i++) printf("%s%s", i ? "," : "", ITEM_DEFS[it[i].id].key);
}

static void on_mission(void *ctx, const MissionSignal *s) {
  (void)ctx;
  switch (s->kind) {
    case MSIG_DISCOVER: printf("M discover f%d %s %d/%d\n", (int)(s->find - M.finds), lab(s->by), s->roll->total, s->roll->degree); break;
    case MSIG_PICKUP: printf("M pickup f%d %s %d ", (int)(s->find - M.finds), lab(s->by), s->scrap); print_items(s->items, s->n_items); printf("\n"); break;
    case MSIG_SPOTTED: printf("M spotted g%d %s %d\n", group_index(s->group), lab(s->by), s->close); break;
    case MSIG_CRATE:
      printf("M crate t%d %s %d/%d %d ", (int)(s->thing - M.things), lab(s->by), s->roll->total, s->roll->degree, s->scrap);
      print_items(s->items, s->n_items);
      printf(" trap=%d\n", s->trap_damage);
      break;
    case MSIG_INTERACT: printf("M interact t%d %s\n", (int)(s->thing - M.things), lab(s->by)); break;
    case MSIG_LOCK:
      printf("M lock t%d %s %d/%d o=%d h=%d\n", (int)(s->thing - M.things), lab(s->by), s->attempt->roll.total, s->attempt->roll.degree, s->attempt->opened, s->hack);
      break;
    case MSIG_OBJECTIVE: printf("M objective\n"); break;
    case MSIG_COMPLETE: printf("M complete\n"); break;
    case MSIG_FINISH: {
      const MissionResult *r = s->result;
      int i;
      printf("M finish %s xp=%d scrap=%d loot=", MRES[r->result], r->xp, r->scrap);
      for (i = 0; i < r->n_loot; i++) printf("%s%s:%d", i ? "," : "", ITEM_DEFS[r->loot[i].id].key, r->loot[i].qty);
      printf(" dead=%d\n", r->n_casualties);
      break;
    }
    default: break;
  }
}

static void state(const char *tag) {
  int i;
  printf("%s mode=%s stage=%d steps=%d scrap=%d loot=%d wave=%d/%d", tag, MODES[M.mode], M.stage, M.steps, M.scrap, M.n_loot, M.wave, M.next_wave);
  for (i = 0; i < M.n_actors; i++) {
    const Actor *a = M.actors[i];
    printf(" a%d:%d,%d,%s,%d,%d", i, a->gx, a->gy, AST[a->state], a->ch->hp, a->engaged);
  }
  printf("\n");
}

static void run_combat(void) {
  Combat *c = &M.combat;
  int guard = 0;
  TurnInfo *t = combat_next_turn(c);
  while (t && c->active && guard++ < 300) {
    AiAction acts[16];
    Actor *a = t->actor;
    int n = run_ai_turn(c, a, acts, 16), i;
    printf("ai %s ", lab(a));
    for (i = 0; i < n && i < 16; i++) printf("%s%s", i ? "," : "", AIACT[acts[i].type]);
    printf("\n");
    t = combat_next_turn(c);
  }
}

typedef struct { uint8_t type, level, biome, n; uint8_t enemies[8]; uint8_t party[4]; uint8_t plevel, item; } Sim;
#define E(x) ENEMY_##x
static const Sim SIMS[9] = {
  {OBJ_ELIMINATE, 2, BIOME_RUINS, 6, {E(RAIDER_THUG), E(RAIDER_GUNNER), E(DOG_MUTANT), E(RAIDER_PSYCHO), E(DRONE), E(RAIDER_CHIEF)}, {0, 1, 2, 3}, 2, ITEM_NONE},
  {OBJ_HUNT, 3, BIOME_WASTES, 6, {E(RAT_MUTANT), E(RAT_MUTANT), E(SCORPION), E(FLY_SWARM), E(GHOUL), E(MUTANT_BRUTE)}, {4, 5, 6, 7}, 3, ITEM_NONE},
  {OBJ_BOSS, 5, BIOME_BUNKER, 7, {E(KOSTUCHA), E(RAIDER_THUG), E(RAIDER_THUG), E(RAIDER_GUNNER), E(RAIDER_SNIPER), E(RAIDER_PSYCHO), E(RAIDER_BURNER)}, {8, 9, 10, 11}, 5, ITEM_NONE},
  {OBJ_RETRIEVE, 2, BIOME_INDUSTRIAL, 4, {E(RAIDER_THUG), E(RAIDER_GUNNER), E(DRONE), E(TURRET)}, {12, 13, 14, 15}, 2, ITEM_CIRCUIT},
  {OBJ_RESCUE, 3, BIOME_RUINS, 6, {E(RAIDER_THUG), E(RAIDER_GUNNER), E(DOG_MUTANT), E(RAIDER_PSYCHO), E(DRONE), E(RAIDER_CHIEF)}, {0, 5, 10, 15}, 3, ITEM_NONE},
  {OBJ_HACK, 3, BIOME_BUNKER, 3, {E(DRONE), E(ROBOT), E(RAIDER_GUNNER)}, {3, 7, 11, 15}, 3, ITEM_NONE},
  {OBJ_LIBERATE, 4, BIOME_WASTES, 6, {E(RAIDER_THUG), E(RAIDER_GUNNER), E(DOG_MUTANT), E(RAIDER_PSYCHO), E(DRONE), E(RAIDER_CHIEF)}, {1, 2, 12, 13}, 4, ITEM_NONE},
  {OBJ_PURGE, 3, BIOME_INDUSTRIAL, 6, {E(RAT_MUTANT), E(RAT_MUTANT), E(SCORPION), E(FLY_SWARM), E(GHOUL), E(MUTANT_BRUTE)}, {5, 6, 7, 0}, 3, ITEM_NONE},
  {OBJ_DEFEND, 2, BIOME_WASTES, 5, {E(RAIDER_THUG), E(RAIDER_GUNNER), E(RAT_MUTANT), E(RAT_MUTANT), E(DOG_MUTANT)}, {0, 1, 2, 3}, 2, ITEM_NONE},
};

int main(void) {
  static Character party[4];
  static ExploreResult er;
  Character *pp[4];
  char id[32], seed[48], tag[32];
  Rng rng;
  int k, mode, i, v;
  for (k = 0; k < 9; k++) {
    for (mode = 0; mode < 2; mode++) for (v = 0; v < 3; v++) {
      const Sim *s = &SIMS[k];
      MissionContract mc;
      for (i = 0; i < 4; i++) {
        char_from_recruit(&party[i], s->party[i], NULL, s->plevel);
        pp[i] = &party[i];
      }
      sprintf(id, "sim:%d", k);
      sprintf(seed, "sim:%d:%s:%d", k, mode ? "explore" : "fight", v);
      rng_seed_str(&rng, seed);
      memset(&mc, 0, sizeof mc);
      mc.id = id;
      mc.type = s->type;
      mc.level = s->level;
      mc.biome = s->biome;
      mc.n_enemies = s->n;
      memcpy(mc.enemies, s->enemies, s->n);
      mc.item = s->item;
      mission_init(&M, &mc, pp, 4, &rng);
      printf("sim %d %s %d %s\n", k, mode ? "explore" : "fight", v, OBJECTIVE_KEYS[s->type]);
      combat_on(&M.combat, on_combat, NULL);
      mission_on(&M, on_mission, NULL);
      state("init");
      if (!mode) {
        int n;
        for (n = 0; n < 8 && M.mode != MODE_OVER; n++) {
          EnemyGroup *g = NULL;
          int gi;
          for (gi = 0; gi < M.n_groups && !g; gi++)
            for (i = 0; i < M.groups[gi]->n; i++) if (M.groups[gi]->actors[i]->state != AST_DEAD) { g = M.groups[gi]; break; }
          if (!g) break;
          mission_start_combat(&M, g, n == 0);
          run_combat();
          sprintf(tag, "fight%d", n);
          state(tag);
        }
        if (M.mode != MODE_OVER) mission_retreat(&M);
      } else {
        uint8_t skip[MAX_THINGS];
        int it;
        memset(skip, 0, sizeof skip);
        for (it = 0; it < 60 && M.mode != MODE_OVER; it++) {
          Actor *lead = NULL;
          int ti = -1;
          if (mission_in_combat(&M)) {
            run_combat();
            sprintf(tag, "combat%d", it);
            state(tag);
            continue;
          }
          for (i = 0; i < M.n_pcs && !lead; i++) if (M.pcs[i]->state == AST_UP) lead = M.pcs[i];
          if (!lead) break;
          for (i = 0; i < M.n_things && ti < 0; i++) {
            MissionThing *t = &M.things[i];
            if (!t->done && !skip[i] && !(t->kind == TH_DEVICE && t->has_lock && t->lock.jammed)) ti = i;
          }
          if (ti >= 0) {
            MissionThing *th = &M.things[ti];
            if (cheb(apos(lead), mkpos(th->gx, th->gy)) <= 1) {
              uint8_t skill = th->kind == TH_DEVICE ? SKILL_CRAFTING : (th->kind == TH_CRATE || th->kind == TH_DOOR) ? SKILL_THIEVERY : SKILL_NONE;
              int ok = mission_interact(&M, lead, th, skill);
              printf("interact t%d %d\n", ti, ok);
              if (!ok) skip[ti] = 1;
            } else {
              mission_explore_move(&M, lead, mkpos(th->gx, th->gy), 1, &er);
              printf("move t%d ok=%d combat=%d\n", ti, er.ok, er.combat);
              if (!er.ok) skip[ti] = 1;
            }
          } else if (mission_objective_done(&M)) {
            if (mission_can_extract(&M) || !mission_needs_extraction(&M)) {
              mission_finish(&M, MRES_SUCCESS);
              break;
            }
            mission_explore_move(&M, lead, entry_cell(&M.map.entry, 5), 1, &er);
            printf("move exit ok=%d\n", er.ok);
          } else {
            Actor *e = NULL;
            for (i = 0; i < M.n_enemies && !e; i++) if (M.enemies[i]->state == AST_UP) e = M.enemies[i];
            if (!e) break;
            mission_explore_move(&M, lead, apos(e), 1, &er);
            printf("move enemy ok=%d combat=%d\n", er.ok, er.combat);
            if (!er.ok) break;
          }
          sprintf(tag, "it%d", it);
          state(tag);
        }
        if (M.mode != MODE_OVER) mission_retreat(&M);
      }
      state("end");
    }
  }
  return 0;
}
