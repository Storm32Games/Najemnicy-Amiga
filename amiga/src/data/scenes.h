/* Wygenerowane przez tools/amiga/pack_scenes.py - nie edytować. Efekty tła (fx/Painter.ts) i rozstawienie postaci. */
#ifndef SCENES_H
#define SCENES_H
#include <stdint.h>

typedef struct { int16_t x, y; int16_t w1, w2; uint8_t ph1, ph2; } BgWindow;   /* migające okno (Windows) */
typedef struct { int32_t x_q8; int16_t y; int16_t v_q8; int16_t ph_q8; uint8_t ph; uint8_t s; } BgBird;
/* promień: dwa końce (x, y, dx, dy w 1/16 px; d* = przesunięcie przy kołysaniu sin = 1), faza pulsowania */
typedef struct { int16_t e[8]; uint8_t ph; } BgRay;
typedef struct {
  const BgWindow *win; int nwin;
  const BgBird *bird; int nbird;
  const BgRay *ray; int nray;
  int16_t orb_x, orb_y; uint32_t ray_col; int16_t ray_milli;   /* krycie promieni w 1/1000 */
  uint32_t bird_col; int8_t bird_dir; int16_t bird_x, bird_w;
} BgFx;
typedef struct { uint8_t frame; uint16_t ms; } AnimStep;
/* postać: wiersz arkusza, stopy (x, y), lustro, głębia (kolejność rysowania; ułamki z gry x10) */
typedef struct { uint8_t row; int16_t x, y; uint8_t flip; uint8_t depth10; } UnitPlace;
typedef struct { int fw, fh, n; const UnitPlace *u; } UnitSet;
typedef struct { int16_t xa, xb, y; uint32_t col; } EyePair;

#define W_RAY_SWAY 31
#define W_RAY_PULSE 125
#define W_BIRD 167
#define UNIT_IDLE_STEPS 8
extern const AnimStep UNIT_IDLE[UNIT_IDLE_STEPS];
extern const BgFx BG_TITLE;
extern const BgFx BG_CREW;
extern const BgFx BG_NOMADS;
extern const BgFx BG_RUINS;
extern const BgFx BG_RECRUIT;
extern const BgFx BG_HUB;
extern const UnitSet INTRO_RAIDERS_UNITS;
extern const UnitSet INTRO_HAVEN_UNITS;
extern const UnitSet INTRO_CREW_UNITS;
#define RUIN_EYES 7
extern const EyePair RUIN_EYE[RUIN_EYES];

#endif
