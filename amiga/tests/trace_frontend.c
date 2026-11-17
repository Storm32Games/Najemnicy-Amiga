/* Ślad logiki ekranów startowych - zgodny z amiga/data/traces/frontend.txt (tools/amiga/trace_frontend.ts). */
#include <stdio.h>
#include "trace_fmt.h"
#include "../src/core/frontend.h"

static uint32_t h32(uint32_t h, int32_t v) { return h * 31u + (uint32_t)v; }
static LogoCubes C;
static uint32_t hf;
static void fly_fn(void *ctx, int i, const CubePose *p) { (void)ctx; hf = h32(h32(h32(h32(hf, i), p->x), p->y), p->s); }

int main(void) {
  static uint8_t rgb[LOGO_GW * LOGO_GH * 3];
  int i, k, t;
  fx_init();
  {
    TickClock c;
    static const int MS[11] = {16, 17, 16, 33, 7, 120, 20, 19, 21, 250, 3};
    clock_reset(&c, 0);
    printf("clock");
    for (i = 0; i < 11; i++) {
      int n = clock_advance(&c, MS[i], 5);
      printf(" %d:%ld:%d:%ld", n, (long)c.tick, clock_alpha_q8(&c), (long)clock_time_q8(&c));
    }
    printf("\n");
  }
  {
    Rng r;
    int x, y;
    rng_seed(&r, 7);
    for (y = 0; y < LOGO_GH; y++)
      for (x = 0; x < LOGO_GW; x++) {
        int o = (y * LOGO_GW + x) * 3, in = (x - 80) * (x - 80) + (y - 45) * (y - 45) * 4 < 1600;
        rgb[o] = (uint8_t)(in ? 200 + (int)rng_below(&r, 56) : (x * 3) & 255);
        rgb[o + 1] = (uint8_t)(in ? 40 + (int)rng_below(&r, 80) : (y * 5) & 255);
        rgb[o + 2] = (uint8_t)((x + y) % 7 == 0 ? 30 : (int)rng_below(&r, 90));
      }
  }
  {
    static const uint32_t SEEDS[2] = {32, 99};
    int s;
    for (s = 0; s < 2; s++) {
      uint32_t h = 7;
      LogoShow show;
      logo_cubes_init(&C, rgb, 3, SEEDS[s]);
      for (i = 0; i < C.count; i++) h = h32(h32(h32(h32(h32(h, C.x[i]), C.y[i]), C.sx[i]), C.sy[i]), (int32_t)(C.land[i] ^ C.col[i] ^ C.hi[i] ^ C.lo[i]));
      printf("cubes %lu n=%d h=%lu\n", (unsigned long)SEEDS[s], C.count, (unsigned long)h);
      for (t = 0; t <= 200 * 256; t += 1777) {
        int nf, nd;
        hf = 7;
        nf = logo_for_each_flying(&C, t, fly_fn, NULL);
        nd = logo_drain_landed(&C, t, NULL, NULL);
        printf("fly %d %d %lu landed=%d/%d\n", t, nf, (unsigned long)hf, nd, C.cursor);
      }
      logo_show_init(&show, &C);
      C.cursor = 0;
      printf("show");
      k = 0;
      for (t = 0; t < 340; t++) {
        int e;
        logo_drain_landed(&C, t * 256, NULL, NULL);
        e = logo_show_update(&show, t);
        if (e) {
          printf("%s%d:%d", k++ ? " " : " ", t, e);
          if (e & 1) printf("/%d", logo_step_pitch_q8(&show));
        }
      }
      printf("\n");
    }
  }
  {
    TypeProgress tp, typing;
    IntroFlow f;
    printf("type");
    type_init(&tp, 137, 34);
    for (k = 0; k < 12; k++) {
      int n = type_step(&tp, k % 4 + 1);
      printf(" %d/%d/%d", n, type_shown(&tp), type_done(&tp));
    }
    type_finish(&tp);
    printf(" fin=%d\n", type_shown(&tp));
    intro_init(&f, 6);
    type_init(&typing, 90, 34);
    printf("intro");
    for (t = 0; t < 2600; t++) {
      int r = intro_tick(&f, type_done(&typing));
      if (r == 3) { type_finish(&typing); typing.acc = 0; }
      else type_step(&typing, 1);
      if (t % 97 == 13) r = r * 10 + intro_press(&f, type_done(&typing));
      if (t == 2400) r = r * 10 + intro_skip(&f);
      if (r) printf(" %d:%d:%d", t, r, f.index);
    }
    printf("\n");
  }
  {
    static const int CASES[4][2] = {{0, 0}, {1, 0}, {1, 1}, {0, 1}};
    static const char *const IDS[7] = {"new", "continue", "load", "options", "intro", "credits", "quit"};
    static const int DIRS[11] = {1, 1, -1, -1, -1, 1, 1, 1, 1, 1, 1};
    int c;
    for (c = 0; c < 4; c++) {
      MenuModel m;
      int a, ok;
      title_menu(&m, CASES[c][0], CASES[c][1]);
      printf("menu %d%d ", CASES[c][0], CASES[c][1]);
      for (i = 0; i < m.n; i++) printf("%s%s", i ? "," : "", IDS[m.items[i].id]);
      printf(" %d", m.focus);
      for (i = 0; i < 11; i++) { ok = menu_move(&m, DIRS[i]); printf(" %d%d", ok, m.focus); }
      ok = menu_set_focus(&m, 3);
      printf(" f%d%d", ok, m.focus);
      a = menu_activate(&m);
      printf(" a%s\n", a >= 0 ? IDS[a] : "null");
    }
  }
  {
    static const double A[8] = {0.8, 1.1, 2, 9, 23, 0.045, 3.7, 12.5}, Q[4] = {0.1, 0.48, 1.25, 3.33};
    printf("ang");
    for (i = 0; i < 8; i++) printf("%s%ld", i ? "," : " ", (long)ang_q8(A[i]));
    printf(" q8");
    for (i = 0; i < 4; i++) printf("%s%ld", i ? "," : " ", (long)sec_to_q8(Q[i]));
    printf("\nprog %ld,%ld,%ld,%ld\n", (long)progress_q12(0, 0, 5000), (long)progress_q12(2560, 0, 12800), (long)progress_q12(99999, 100, 12800), (long)progress_q12(-5, 0, 256));
  }
  {
    static const double RATES[3] = {2.2, 0.7, 5};
    static const int STEPS[3] = {16, 8, 4};
    static const int32_t TS[8] = {-1, 0, 100, 1000, 4000, 9000, 40000, 300000};
    int c;
    for (c = 0; c < 3; c++) {
      ApproachCurve ac;
      approach_init(&ac, RATES[c], STEPS[c]);
      printf("approach %g %d", RATES[c], STEPS[c]);
      for (i = 0; i < 8; i++) printf("%s%d", i ? "," : " ", approach_at(&ac, TS[i]));
      printf("\n");
    }
  }
  printf("flame");
  for (t = 0; t < 30000; t += 413) printf(" %d/%d/%d", flame_k_q12(t, t % 4), flame_sway_q8(t, (t >> 3) % 4), glow_alpha_q8(t));
  printf("\n");
  {
    static MoteField mf, mg;
    uint32_t h = 7;
    motes_init(&mf, 40, 10, 120, 300, 140, 3.5, -6, 4242, 0.6);
    motes_init(&mg, 25, 0, 0, 480, 270, -12, 2, 77, 0.35);
    for (k = 0; k < 400; k++) { motes_step(&mf); motes_step(&mg); }
    for (i = 0; i < mf.n; i++) h = h32(h32(h32(h, mf.x[i]), mf.y[i]), mf.alpha[i]);
    for (i = 0; i < mg.n; i++) h = h32(h32(h32(h, mg.x[i]), mg.y[i]), mg.alpha[i]);
    printf("motes %lu %ld,%ld %ld,%ld\n", (unsigned long)h, (long)mf.x[0], (long)mf.y[0], (long)mg.x[3], (long)mg.y[3]);
  }
  printf("blink");
  for (i = 0; i < 30; i++) printf("%s%d", i ? "," : " ", blink_alpha_q8(i * 9, 242, 5, 3, 115));
  printf(" %d\n", blink_alpha_q8(500, 100, 7, 4, 60));
  {
    TexTile tl[16];
    int n = pot_tiles(480, 270, 256, tl, 16);
    printf("tiles");
    for (i = 0; i < n; i++) printf("%s%d,%d,%d,%d,%d,%d", i ? ";" : " ", tl[i].x, tl[i].y, tl[i].w, tl[i].h, tl[i].tex_w, tl[i].tex_h);
    printf(" %d\n", pot_tiles(600, 130, 128, tl, 16));
  }
  return 0;
}
