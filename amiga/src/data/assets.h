/* Wygenerowane przez tools/amiga/gen_assets.ts. NIE EDYTUJ RĘCZNIE. */
#ifndef ASSETS_H
#define ASSETS_H
#include <stdint.h>

/* Czcionka "PYŁ 6x8": wiersz 0 = y -1 (akcenty wielkich liter), bit x = piksel w kolumnie x. Indeks = bajt ISO-8859-2. */
#define FONT_CELL_H 8
#define FONT_LINE_H 9
#define FONT_SPACING 1
#define FONT_TOP (-1)
#define FONT_ROWS 9
typedef struct { int8_t w, adv; uint8_t rows[FONT_ROWS]; } FontGlyph;
extern const FontGlyph FONT_REGULAR[256], FONT_BOLD[256];

/* Logo STORM 32 próbkowane do siatki 160x90 RGB (jak LogoScene.sample w przeglądarce). */
extern const uint8_t LOGO_SAMPLE_RGB[160 * 90 * 3];

#endif
