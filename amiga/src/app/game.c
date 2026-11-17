/* Stan gry i formatowanie przedmiotów. */
#include <stdio.h>
#include <string.h>
#include "game.h"

CampaignState g_camp;
uint32_t g_entropy = 0x2545f491u;
int g_job = -1;
char g_notice[128];
int g_force_event = -1;

void game_rng(Rng *r) {
  g_entropy = g_entropy * 1664525u + 1013904223u;
  rng_seed(r, g_entropy);
}

void dice_fmt(Dice d, char *out) {
  if (d.mod > 0) sprintf(out, "%dd%d+%d", d.n, d.sides, d.mod);
  else if (d.mod < 0) sprintf(out, "%dd%d%d", d.n, d.sides, d.mod);
  else sprintf(out, "%dd%d", d.n, d.sides);
}

void item_stat_line(int item, int short_form, char *out, int cap) {
  const ItemDef *it = &ITEM_DEFS[item];
  char d[16];
  out[0] = 0;
  switch (it->type) {
    case ITYPE_WEAPON:
      dice_fmt(it->weapon->damage, d);
      if (short_form) {
        if (it->weapon->range) snprintf(out, (size_t)cap, "%s z%d", d, it->weapon->range);
        else snprintf(out, (size_t)cap, "%s wr\352cz", d);
      } else if (it->weapon->range) snprintf(out, (size_t)cap, "%s %s \205 zasi\352g %d", d, DMG_ADJ[it->weapon->dmg_type], it->weapon->range);
      else snprintf(out, (size_t)cap, "%s %s \205 wr\352cz", d, DMG_ADJ[it->weapon->dmg_type]);
      break;
    case ITYPE_ARMOR: snprintf(out, (size_t)cap, "KP +%d", it->armor->ac); break;
    case ITYPE_SHIELD: snprintf(out, (size_t)cap, "tarcza +%d", it->shield->ac); break;
    case ITYPE_CONSUMABLE:
      if (it->consumable->amount.n) dice_fmt(it->consumable->amount, out);
      break;
    default: break;
  }
}

void item_tip(int item, const char *extra, char *out, int cap) {
  static const char *const TYPE_LABEL[ITYPE_COUNT] = {"bro\361", "pancerz", "tarcza", "zu\277ywalne", "z\263om", "technika", "amunicja"};
  const ItemDef *it = &ITEM_DEFS[item];
  char head[96], stat[96] = "", d[16];
  if (it->level) snprintf(head, sizeof head, "%s  (%s, poz. %d)", it->name, TYPE_LABEL[it->type], it->level);
  else snprintf(head, sizeof head, "%s  (%s)", it->name, TYPE_LABEL[it->type]);
  if (it->type == ITYPE_WEAPON) {
    const WeaponStats *w = it->weapon;
    char rng_s[24];
    dice_fmt(w->damage, d);
    if (w->range) snprintf(rng_s, sizeof rng_s, " \205 zasi\352g %d", w->range);
    else snprintf(rng_s, sizeof rng_s, " \205 wr\352cz");
    snprintf(stat, sizeof stat, "Obra\277enia %s (%s)%s%s", d, DMG_ADJ[w->dmg_type], rng_s, w->hands == 2 ? " \205 dwur\352czna" : "");
  } else if (it->type == ITYPE_ARMOR) {
    if (it->armor->speed_penalty) snprintf(stat, sizeof stat, "KP +%d \205 limit Zr\352. %d \205 pr\352dko\266\346 \202%d", it->armor->ac, it->armor->dex_cap, it->armor->speed_penalty);
    else snprintf(stat, sizeof stat, "KP +%d \205 limit Zr\352. %d", it->armor->ac, it->armor->dex_cap);
  } else if (it->type == ITYPE_SHIELD) snprintf(stat, sizeof stat, "Tarcza: KP +%d \205 twardo\266\346 %d", it->shield->ac, it->shield->hardness);
  else item_stat_line(item, 0, stat, sizeof stat);
  snprintf(out, (size_t)cap, "%s%s%s%s%s\nCena: %d Z\263omu%s", head, it->desc && *it->desc ? "\n" : "", it->desc ? it->desc : "", *stat ? "\n" : "", stat, it->price, extra ? extra : "");
}
