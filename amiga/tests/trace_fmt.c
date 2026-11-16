#include <string.h>
#include "trace_fmt.h"

void dice_str(char *buf, Dice d) { sprintf(buf, "%dd%d%s%d", d.n, d.sides, d.mod >= 0 ? "+" : "", d.mod); }

static int is_persistent(int id) {
  int i;
  for (i = 0; i < PERSISTENT_COUNT; i++) if (PERSISTENT_CONDS[i] == id) return 1;
  return 0;
}

void print_snap(FILE *f, const char *label, const Character *ch) {
  int i, first;
  char b[32];
  fprintf(f, "%s hp=%d/%d thp=%d lvl=%d xp=%d cond=", label, ch->hp, ch->max_hp, ch->temp_hp, ch->level, ch->xp);
  for (i = 0, first = 1; i < COND_COUNT; i++) {
    if (!ch->cond[i]) continue;
    if (is_persistent(i)) {
      dice_str(b, ch->cond_dice[i]);
      fprintf(f, "%s%s:%s", first ? "" : ",", CONDITION_DEFS[i].key, b);
    } else {
      fprintf(f, "%s%s:%d", first ? "" : ",", CONDITION_DEFS[i].key, ch->cond[i]);
    }
    first = 0;
  }
  fprintf(f, " uses=");
  for (i = 0, first = 1; i < ABIL_COUNT; i++) {
    if (ch->uses[i] == USES_UNSET) continue;
    fprintf(f, "%s%s:%d", first ? "" : ",", ABILITY_DEFS[i].key, ch->uses[i]);
    first = 0;
  }
  fprintf(f, " eq=");
  for (i = 0; i < SLOT_COUNT; i++) fprintf(f, "%s%s", i ? "," : "", ch->equip[i].id == ITEM_NONE ? "-" : ITEM_DEFS[ch->equip[i].id].key);
  fprintf(f, " inv=");
  for (i = 0; i < ch->n_inv; i++) fprintf(f, "%s%s:%d", i ? "," : "", ITEM_DEFS[ch->inv[i].id].key, ch->inv[i].qty);
  fprintf(f, " st=%d/%d\n", ch->stolen, ch->stolen_scrap);
}

static void print_roll(FILE *f, const DamageRoll *x, int has) {
  int i;
  if (!has) {
    fputc('-', f);
    return;
  }
  fprintf(f, "%d|%d|%d|", x->total, x->flat, x->mult2);
  for (i = 0; i < x->n; i++) fprintf(f, "%s%d", i ? "." : "", x->dice[i].value);
  fputc('|', f);
  for (i = 0; i < x->n_post; i++) fprintf(f, "%s%d", i ? "." : "", x->post[i].value);
}

void print_res(FILE *f, const ActionResult *r, LabelFn L) {
  int i;
  char b[32];
  fprintf(f, "res att=%d/%d hit=%d dealt=%d cons=%d d20=", r->attack, r->attacks, r->hit, r->dealt, r->consumed);
  if (r->has_d20) fprintf(f, "%d/%d/%d/%d/%d", r->d20.raw, r->d20.d20, r->d20.total, r->d20.dc, r->d20.degree);
  else fputc('-', f);
  fprintf(f, " dmg=");
  print_roll(f, &r->dmg, r->has_dmg);
  fprintf(f, " heal=");
  print_roll(f, &r->heal, r->has_heal);
  fprintf(f, " ev=");
  for (i = 0; i < r->n_events; i++) {
    const RuleEvent *e = &r->events[i];
    if (i) fputc(';', f);
    switch (e->type) {
      case EV_DAMAGE:
        fprintf(f, "dmg:%s:%d:%d:", L(e->target), e->amount, e->dmg_type);
        if (e->degree == NONE8) fputc('-', f); else fprintf(f, "%d", e->degree);
        fprintf(f, ":%s", e->persistent == COND_NONE ? "-" : CONDITION_DEFS[e->persistent].key);
        break;
      case EV_HEAL: fprintf(f, "heal:%s:%d:%d", L(e->target), e->amount, e->temp); break;
      case EV_MISS: fprintf(f, "miss:%s:%d", L(e->target), e->degree); break;
      case EV_CONDITION:
        fprintf(f, "cond:%s:%s:", L(e->target), e->cond == COND_STABLE ? "stable" : CONDITION_DEFS[e->cond].key);
        if (!e->has_value) fputc('-', f);
        else if (e->cond != COND_STABLE && is_persistent(e->cond)) { dice_str(b, e->value_dice); fputs(b, f); }
        else fprintf(f, "%d", e->value);
        break;
      case EV_CRIT: fprintf(f, "crit:%s", L(e->target)); break;
      case EV_DEATH: fprintf(f, "death:%s", L(e->target)); break;
      case EV_DOWN: fprintf(f, "down:%s", L(e->target)); break;
      case EV_RECOVERY: fprintf(f, "rec:%s:%d", L(e->target), e->degree); break;
      case EV_STEAL: fprintf(f, "steal:%s:%s", L(e->target), ITEM_DEFS[e->item].key); break;
      case EV_SCRAP: fprintf(f, "scrap:%d", e->amount); break;
    }
  }
  fputc('\n', f);
}
