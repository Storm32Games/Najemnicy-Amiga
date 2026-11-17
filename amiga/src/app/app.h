/* Aplikacja: maszyna ekranów (logo -> intro -> menu tytułowe), przejścia przez wygaszenie, wejście (klawiatura, joystick, mysz). */
#ifndef APP_H
#define APP_H

#include <stdint.h>

/* bity wejścia (stan wciśnięcia i "naciśnięte w tej klatce") */
enum { IN_UP = 1, IN_DOWN = 2, IN_LEFT = 4, IN_RIGHT = 8, IN_OK = 16, IN_BACK = 32, IN_ANY = 64 };

typedef enum { SCR_LOGO, SCR_INTRO, SCR_TITLE, SCR_RECRUIT, SCR_HUB, SCR_TRAVEL, SCR_MISSION, SCR_QUIT } ScreenId;

void app_init(void);
/* Jedna klatka: `ms` = czas od poprzedniej klatki. Zwraca 0, gdy aplikacja ma się zakończyć. */
int app_frame(unsigned held, unsigned pressed, int ms);
void app_goto(ScreenId s);       /* do testów: od razu na wybrany ekran */
ScreenId app_screen(void);

/* ---- wspólne dla ekranów */
typedef struct {
  void (*enter)(void);
  void (*update)(unsigned held, unsigned pressed, int ms);
  void (*draw)(void);
  void (*leave)(void);
} Screen;
extern const Screen SCREEN_LOGO, SCREEN_INTRO, SCREEN_TITLE, SCREEN_RECRUIT, SCREEN_HUB, SCREEN_TRAVEL, SCREEN_MISSION;
/* Przejście: wygaszenie w `ms_out`, potem nowy ekran wchodzi z czerni w `ms_in`. Drugie wywołanie w trakcie wyjścia jest ignorowane. */
void app_switch(ScreenId to, int ms_out, int ms_in);
int app_leaving(void);
/* Dźwięk (na razie tylko zdarzenia - port Pauli później). */
void app_sfx(const char *name, int vol_q8, int pitch_q8);

#endif
