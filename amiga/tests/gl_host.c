/* gl_host.c - uruchamia aplikację (ekrany) na Macu w OpenGL bez okna (CGL + FBO) i zapisuje zrzuty PPM.
 * użycie: gl_host WxH klatki prefiks [skrypt]
 *   skrypt: "klatka:KLAWISZ ..." (KLAWISZ: OK BACK UP DOWN LEFT RIGHT ANY), "klatka:shot", "klatka:goto=intro|title|logo" */
#define GL_SILENCE_DEPRECATION 1
#include <OpenGL/OpenGL.h>
#include <OpenGL/gl.h>
#include <OpenGL/glext.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "../src/app/app.h"
#include "../src/app/game.h"

/* quickParty: pierwsi 4 rekruci (do testów Przystani) */
static int party_n = 4;
static void quick_party(void) {
  static const uint8_t p[4] = {0, 1, 2, 3};
  Rng r;
  rng_seed(&r, 7);
  start_campaign(&g_camp, p, party_n, &r);
  g_camp.scrap = 500;   /* na zatrudnienie w karczmie */
}
#include "../src/gfx/r2d.h"

static void shot(const char *prefix, int frame, int vw, int vh) {
  unsigned char *px = malloc((size_t)vw * vh * 4);
  char name[256];
  FILE *f;
  int y, x;
  glReadPixels(0, 0, vw, vh, GL_RGBA, GL_UNSIGNED_BYTE, px);
  snprintf(name, sizeof name, "%s_%04d.ppm", prefix, frame);
  f = fopen(name, "wb");
  fprintf(f, "P6\n%d %d\n255\n", vw, vh);
  for (y = vh - 1; y >= 0; y--) for (x = 0; x < vw; x++) fwrite(px + ((size_t)y * vw + x) * 4, 1, 3, f);
  fclose(f);
  free(px);
  printf("zrzut %s\n", name);
}

static unsigned key_of(const char *k) {
  if (!strcmp(k, "OK")) return IN_OK | IN_ANY;
  if (!strcmp(k, "BACK")) return IN_BACK | IN_ANY;
  if (!strcmp(k, "UP")) return IN_UP | IN_ANY;
  if (!strcmp(k, "DOWN")) return IN_DOWN | IN_ANY;
  if (!strcmp(k, "LEFT")) return IN_LEFT | IN_ANY;
  if (!strcmp(k, "RIGHT")) return IN_RIGHT | IN_ANY;
  if (!strcmp(k, "ANY")) return IN_ANY;
  return 0;
}

int main(int argc, char **argv) {
  int vw = 1280, vh = 720, frames, i;
  CGLPixelFormatAttribute attr[] = {kCGLPFAColorSize, (CGLPixelFormatAttribute)24, (CGLPixelFormatAttribute)0};
  CGLPixelFormatObj pf;
  GLint npix;
  CGLContextObj ctx;
  GLuint fbo, col;
  const char *script = argc > 4 ? argv[4] : "";
  if (argc < 4) {
    fprintf(stderr, "uzycie: gl_host WxH klatki prefiks [skrypt]\n");
    return 1;
  }
  sscanf(argv[1], "%dx%d", &vw, &vh);
  frames = atoi(argv[2]);
  if (CGLChoosePixelFormat(attr, &pf, &npix) || CGLCreateContext(pf, NULL, &ctx)) return 2;
  CGLSetCurrentContext(ctx);
  glGenFramebuffersEXT(1, &fbo);
  glBindFramebufferEXT(GL_FRAMEBUFFER_EXT, fbo);
  glGenRenderbuffersEXT(1, &col);
  glBindRenderbufferEXT(GL_RENDERBUFFER_EXT, col);
  glRenderbufferStorageEXT(GL_RENDERBUFFER_EXT, GL_RGBA8, vw, vh);
  glFramebufferRenderbufferEXT(GL_FRAMEBUFFER_EXT, GL_COLOR_ATTACHMENT0_EXT, GL_RENDERBUFFER_EXT, col);
  if (glCheckFramebufferStatusEXT(GL_FRAMEBUFFER_EXT) != GL_FRAMEBUFFER_COMPLETE_EXT) return 3;
  r2d_init(vw, vh, 8);
  app_init();
  for (i = 0; i < frames; i++) {
    unsigned pressed = 0;
    int do_shot = 0;
    const char *p = script;
    while (*p) {
      int f = atoi(p);
      const char *c = strchr(p, ':'), *e;
      char tok[32];
      size_t n;
      if (!c) break;
      e = strchr(c, ' ');
      n = e ? (size_t)(e - c - 1) : strlen(c + 1);
      if (n >= sizeof tok) n = sizeof tok - 1;
      memcpy(tok, c + 1, n);
      tok[n] = 0;
      if (f == i) {
        if (!strcmp(tok, "shot")) do_shot = 1;
        else if (!strcmp(tok, "enemy")) g_debug_cmd = 1;
        else if (!strncmp(tok, "event=", 6)) g_force_event = atoi(tok + 6);
        else if (!strncmp(tok, "job=", 4)) {
          quick_party();
          g_job = atoi(tok + 4);
          app_goto(SCR_MISSION);
        }
        else if (!strncmp(tok, "goto=", 5)) app_goto(!strcmp(tok + 5, "intro") ? SCR_INTRO : !strcmp(tok + 5, "title") ? SCR_TITLE : !strcmp(tok + 5, "recruit") ? SCR_RECRUIT : !strcmp(tok + 5, "hub") ? (quick_party(), SCR_HUB) : !strcmp(tok + 5, "hub3") ? (party_n = 3, quick_party(), SCR_HUB) : !strcmp(tok + 5, "travel") ? (quick_party(), g_job = 0, SCR_TRAVEL) : !strcmp(tok + 5, "mission") ? (quick_party(), g_job = 0, SCR_MISSION) : SCR_LOGO);
        else pressed |= key_of(tok);
      }
      p = e ? e + 1 : p + strlen(p);
    }
    if (!app_frame(pressed, pressed, 20)) {
      printf("koniec aplikacji w klatce %d\n", i);
      break;
    }
    glFinish();
    if (do_shot || i == frames - 1) shot(argv[3], i, vw, vh);
  }
  printf("ekran %d, glerr=%x\n", (int)app_screen(), glGetError());
  return 0;
}
