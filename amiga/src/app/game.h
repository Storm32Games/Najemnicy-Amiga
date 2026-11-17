/* Stan gry wspólny dla ekranów: kampania, RNG, entropia (czas i wejście - ziarno losowań jak Math.random w grze). */
#ifndef GAME_H
#define GAME_H

#include "../core/campaign.h"
#include "../core/character.h"

extern CampaignState g_camp;
extern uint32_t g_entropy;
extern int g_job;              /* zlecenie wybrane w Przystani (indeks w g_camp.contracts) albo -1 */
extern char g_notice[128];
extern int g_force_event;
extern int g_debug_cmd;
/* rozliczenie misji (DebriefScene): wynik i stan najemników sprzed naliczenia (wg rekruta) */
typedef struct { uint8_t valid, level, n_abil; int16_t xp, max_hp; uint8_t abil[CHAR_ABIL_MAX]; } BeforeMember;
extern DebriefSummary g_debrief;
extern BeforeMember g_before[RECRUIT_COUNT];
extern char g_debrief_title[96];
/* polegli do ekranu końca drogi */
extern char g_fallen[MAX_PARTY][NAME_MAX + 1];
extern int g_n_fallen;        /* testy: 1 = kursor misji na najbliższego wroga */      /* testy (jak ?event= w grze): indeks TRAVEL_EVENTS, 99 = atak bestii, -1 = losowo */     /* komunikat do pokazania po wejściu do Przystani */
/* świeże ziarno dla losowania w odpowiedzi na akcję gracza */
void game_rng(Rng *r);

/* formatowanie przedmiotów (HudState.itemStatLine, Widgets.itemTip) */
void dice_fmt(Dice d, char *out);
void item_stat_line(int item, int short_form, char *out, int cap);
void item_tip(int item, const char *extra, char *out, int cap);

#endif
