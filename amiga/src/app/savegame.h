/* Zapis gry na dysku (port obiektu Save z src/scenes/ui/Widgets.ts): autozapis ("Kontynuuj") i 3 sloty, pliki obok gry
 * (Amiga: PROGDIR:najemnicy_auto.sav, najemnicy_slot1..3.sav). Treść: kampania (core/save.c) i - w eksploracji misji -
 * zlecenie, stan misji i kampania z chwili wejścia na teren. Okno slotów jak openSaveSlots. */
#ifndef SAVEGAME_H
#define SAVEGAME_H

#include <stdint.h>
#include "../core/combat.h"

#define SAVE_SLOTS 3

typedef struct { int day, scrap, level; char party[96]; char mission[64]; char time[20]; } SlotInfo;

/* Dostawca misji w toku: ekran misji ustawia przy wejściu, zeruje przy wyjściu. NULL = zapis bez misji. */
extern Mission *g_save_mission;
/* Misja z ostatnio wczytanego zapisu (ekran misji odtwarza ją przy wejściu). */
extern int g_resume_len;
extern uint8_t g_resume[65536];
/* Kampania z chwili wejścia na teren misji (do zapisu razem z misją). */
extern int g_entry_len;
extern uint8_t g_entry[16384];

int save_write(int slot);        /* 0 = autozapis, 1..3 = slot; slot zapisuje też autozapis */
int save_load(int slot);         /* do g_camp (+ misja do g_resume) */
int save_exists(int slot);
int save_info(int slot, SlotInfo *out);
int save_any_slot(void);
/* Po wczytaniu: misja w toku -> jej mapa, inaczej Przystań (enterLoaded). */
void save_enter_loaded(void);

/* okno slotów: open(mode 0 = zapis, 1 = wczytanie); input zwraca -1 (dalej), 0 (zamknięte), slot (zapisano / wczytano) */
void saveui_open(int load);
int saveui_input(unsigned pressed);
void saveui_draw(void);
int saveui_is_open(void);
int saveui_loading(void);   /* okno w trybie wczytywania */

#endif
