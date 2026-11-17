/* Stan gry wspólny dla ekranów: kampania, RNG, entropia (czas i wejście - ziarno losowań jak Math.random w grze). */
#ifndef GAME_H
#define GAME_H

#include "../core/campaign.h"

extern CampaignState g_camp;
extern uint32_t g_entropy;
extern int g_job;              /* zlecenie wybrane w Przystani (indeks w g_camp.contracts) albo -1 */
extern char g_notice[128];
extern int g_force_event;
extern int g_debug_cmd;        /* testy: 1 = kursor misji na najbliższego wroga */      /* testy (jak ?event= w grze): indeks TRAVEL_EVENTS, 99 = atak bestii, -1 = losowo */     /* komunikat do pokazania po wejściu do Przystani */
/* świeże ziarno dla losowania w odpowiedzi na akcję gracza */
void game_rng(Rng *r);

/* formatowanie przedmiotów (HudState.itemStatLine, Widgets.itemTip) */
void dice_fmt(Dice d, char *out);
void item_stat_line(int item, int short_form, char *out, int cap);
void item_tip(int item, const char *extra, char *out, int cap);

#endif
