/* Zapis gry: kampania i misja w trakcie eksploracji (jak MissionSnapshot w TS), binarnie, big-endian (68k).
 * Format: "NAJM" + wersja + bloki. Zapisy z przeglądarki (JSON) nie są czytane. */
#ifndef SAVE_H
#define SAVE_H

#include "campaign.h"

#define SAVE_VERSION 1
#define SAVE_MAX_BYTES 65536

/* Zwraca liczbę bajtów albo 0 (za mały bufor). */
int campaign_save(const CampaignState *st, uint8_t *buf, int cap);
int campaign_load(CampaignState *st, const uint8_t *buf, int len); /* 1 = OK */

/* Misja: tylko w eksploracji (w walce zwraca 0, jak snapshot() w TS). Najemnicy zapisywani jako indeks w `party`. */
int mission_save(const Mission *m, uint8_t *buf, int cap);
/* Odtwarza misję: mapa z generatora (id zlecenia), potem stan z zapisu. `contract` musi być tym samym zleceniem. */
int mission_load(Mission *m, const MissionContract *contract, Character **party, int n_party, Rng *rng, const uint8_t *buf, int len);

#endif
