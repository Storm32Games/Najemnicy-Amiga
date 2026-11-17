/* Wspólne widżety UI (port src/scenes/ui/Kit.ts / Widgets.ts): przycisk, panel, okno, toast. */
#ifndef UI_H
#define UI_H

#include <stdint.h>

/* paleta PAL (Kit.ts) */
#define PAL_BG 0x0b0a09UL
#define PAL_PANEL 0x1a1612UL
#define PAL_PANEL2 0x241e18UL
#define PAL_EDGE 0x6b5233UL
#define PAL_EDGE_HI 0xc08a3eUL
#define PAL_TEXT 0xe8dcc0UL
#define PAL_DIM 0x9a8b70UL
#define PAL_AMBER 0xf2a93bUL
#define PAL_BLOOD 0xc43d2fUL
#define PAL_BAD 0xe0553fUL
#define PAL_GOOD 0x7fc46aUL

enum { BTN_PLAIN, BTN_PRIMARY, BTN_DANGER };
/* button(): tekst wielkimi literami (podać już wielkimi), h = rozmiar + 8; focus = najechanie / fokus z klawiatury. */
void ui_button(int x, int y, int w, int h, const char *text, int kind, int focus, int enabled);
int ui_button_w(const char *text);                 /* szerokość domyślna: tekst + 14 */
void ui_panel(int x, int y, int w, int h, uint32_t edge);
/* Tekst z zawijaniem (label z wrap, lineSpacing); zwraca wysokość. */
int ui_text(int x, int y, const char *s, uint32_t rgb, int wrap, int spacing, int center);
int ui_text_h(const char *s, int wrap, int spacing);

/* toast(): komunikat u góry ekranu, znika po ~2.6 s */
void ui_toast(const char *msg, uint32_t tone);
void ui_toast_update(int ms);
void ui_toast_draw(void);

#endif
