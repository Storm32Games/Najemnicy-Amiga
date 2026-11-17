/* Wspólne elementy scen menu / intro (port fx/Painter.ts, fx/Backdrops.ts, ui/Kit.ts campfire / Motes, addUnit):
 * tło z oknami, ptakami i promieniami, warstwy paralaksy i dryfu, ognisko, postacie z animacją idle, pył. */
#ifndef SCENEFX_H
#define SCENEFX_H

#include <stdint.h>
#include "../gfx/img.h"
#include "../core/frontend.h"
#include "../data/scenes.h"

#define BG_MAX_BIRDS 8
typedef struct { const BgFx *def; int32_t bird_x[BG_MAX_BIRDS]; } BgState;  /* x ptaków w 1/(256*50) px */
void bg_init(BgState *s, const BgFx *def);
void bg_tick(BgState *s);                        /* jeden tick 50 Hz */
void bg_rays(const BgFx *def, int32_t tq);       /* LightRays (addytywnie) */
void bg_windows(const BgFx *def, int32_t tq, int dx);
void bg_birds(const BgState *s, int32_t tq);

/* sin / cos w Q14 dla kąta w 1/4096 obrotu (tablica 256 + interpolacja liniowa). */
int sin_fine(int32_t a4096);
static inline int cos_fine(int32_t a4096) { return sin_fine(a4096 + 1024); }
int int_sqrt(int32_t v);
/* Math.round(a / b) dla b > 0 (także ujemne a). */
int32_t rdiv(int32_t a, int32_t b);
/* ParallaxLayer.set: x = round(-margin - pan * k), pan w Q8 px, k w 1/1000. */
int parallax_x(int margin, int32_t pan_q8, int k_milli);
/* DriftLayer: obraz w pętli co `w` px z prędkością speed (1/1000 px/s), alfa a. */
void drift_draw(const Img *im, int32_t tick, int32_t speed_milli, float y, int a);
/* IntroScene.pan: from + (to - from) * smoothstep(min(1, t / dur)), wynik w Q8 px. */
int32_t smooth_pan_q8(int32_t tq, int from, int to, int dur_s);

/* campfire(): ognisko w (x, y) o rozmiarze size. */
void fx_campfire(float x, float y, float size, int32_t tq);
void motes_draw(const MoteField *f, uint32_t rgb);

/* Postacie (addUnit, animacja idle): klatka startowa |x| % 4, klatka trwa 100 ms + duration. */
#define UNITS_MAX 8
typedef struct { int step[UNITS_MAX], ms[UNITS_MAX]; } UnitAnim;
void units_init(UnitAnim *a, const UnitSet *s);
void units_update(UnitAnim *a, const UnitSet *s, int ms);
/* Rysuje postacie o głębi (x10) w [d0, d1]; skala k, tint mnoży kolor. */
void units_draw(const Img *sheet, const UnitSet *s, const UnitAnim *a, float k, uint32_t tint, int d0, int d1);

#endif
