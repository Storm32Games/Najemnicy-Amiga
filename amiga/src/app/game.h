/* Stan gry wspólny dla ekranów: kampania, RNG, entropia (czas i wejście - ziarno losowań jak Math.random w grze). */
#ifndef GAME_H
#define GAME_H

#include "../core/campaign.h"

extern CampaignState g_camp;
extern uint32_t g_entropy;
/* świeże ziarno dla losowania w odpowiedzi na akcję gracza */
void game_rng(Rng *r);

/* formatowanie przedmiotów (HudState.itemStatLine, Widgets.itemTip) */
void dice_fmt(Dice d, char *out);
void item_stat_line(int item, int short_form, char *out, int cap);
void item_tip(int item, const char *extra, char *out, int cap);

#endif
