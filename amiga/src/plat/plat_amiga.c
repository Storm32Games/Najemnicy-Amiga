/* plat_amiga.c - AmigaOS 3.x (A1200 + PiStorm / karta RTG z CyberGraphX albo Picasso96) dla Najemników.
 *
 * Ekran : 32-bitowy ekran RTG (HD 1280x720, potem FHD / 640x480 - SCREEN=); całość rysuje minigl.library (PiStorm3D / Warp3D)
 *         w kontekście na naszym oknie. Na ekranie 16-bitowym PiStorm3D pokazywał śmieci (doświadczenie z Cube Rally), stąd 32 bity.
 * Wejście: klawiatura (kursory, Enter / Spacja = OK, Esc = wstecz, każdy klawisz = pomiń), mysz (lewy = OK, prawy = wstecz),
 *         joystick w porcie 2 (ogień = OK).
 * Wzorzec: warstwa platformy Cube Rally (~/AmigaGames/Claude/kostka-rally/src/plat_amiga.c), sprawdzona na A1200 + PiStorm.
 * Opcje (CLI albo tooltypes): SCREEN=HD|FHD|VGA|WxH, MODEID=$xxxxxxxx, FPS, MGLBATCH=n, NOJOY. */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <ctype.h>
#include <stddef.h>
#include <exec/types.h>
#include <exec/memory.h>
#include <intuition/intuition.h>
#include <intuition/screens.h>
#include <graphics/gfx.h>
#include <graphics/modeid.h>
#include <graphics/displayinfo.h>
#include <graphics/gfxbase.h>
#include <devices/inputevent.h>
#include <devices/timer.h>
#include <dos/dos.h>
#include <workbench/startup.h>
#include <workbench/workbench.h>
#include <proto/exec.h>
#include <proto/intuition.h>
#include <proto/graphics.h>
#include <proto/dos.h>
#include <proto/icon.h>
#include <proto/timer.h>
#include <proto/minigl.h>
#include <libraries/minigl_dispatch.h>
#include "../app/app.h"
#include "../gfx/r2d.h"

struct Library *IconBase;
struct Device *TimerBase;
static struct Library *CyberGfxBase;

#define STACK_BYTES 262144UL

/* ------------------------------------------------------------------ cybergraphics.library (LVO z cybergraphics_lib.fd) */
#define CYBRMATTR_PIXFMT 0x80000004UL
#define CYBRIDATTR_PIXFMT 0x80000001UL
#define CYBRIDATTR_WIDTH 0x80000002UL
#define CYBRIDATTR_HEIGHT 0x80000003UL
#define CYBRIDATTR_DEPTH 0x80000004UL
#define PIXFMT_ARGB32 11UL
#define PIXFMT_RGBA32 13UL

static ULONG cgx_IsCyberModeID(ULONG id) {
  register ULONG d0 __asm("d0") = id;
  register struct Library *a6 __asm("a6") = CyberGfxBase;
  __asm volatile("jsr -54(%%a6)" : "+r"(d0) : "r"(a6) : "d1", "a0", "a1", "memory", "cc");
  return d0;
}
static ULONG cgx_GetCyberIDAttr(ULONG attr, ULONG id) {
  register ULONG d0 __asm("d0") = attr;
  register ULONG d1 __asm("d1") = id;
  register struct Library *a6 __asm("a6") = CyberGfxBase;
  __asm volatile("jsr -102(%%a6)" : "+r"(d0), "+r"(d1) : "r"(a6) : "a0", "a1", "memory", "cc");
  return d0;
}

/* ------------------------------------------------------------------ opcje */
static int pref_w = 1280, pref_h = 720, opt_batch = 8, opt_fps, opt_joy = 1;
static ULONG opt_modeid = INVALID_ID;
static char msg_buf[160];

static void parse_opt(const char *a) {
  char key[16];
  const char *eq = strchr(a, '=');
  size_t n = eq ? (size_t)(eq - a) : strlen(a), i;
  const char *val = eq ? eq + 1 : "";
  if (n == 0 || n >= sizeof(key)) return;
  for (i = 0; i < n; i++) key[i] = (char)toupper((unsigned char)a[i]);
  key[n] = 0;
  if (!strcmp(key, "SCREEN")) {
    int w, h;
    if (!strcasecmp(val, "FHD")) { pref_w = 1920; pref_h = 1080; }
    else if (!strcasecmp(val, "HD")) { pref_w = 1280; pref_h = 720; }
    else if (!strcasecmp(val, "VGA")) { pref_w = 640; pref_h = 480; }
    else if (sscanf(val, "%dx%d", &w, &h) == 2 && w >= 320 && h >= 200) { pref_w = w; pref_h = h; }
  } else if (!strcmp(key, "MODEID")) opt_modeid = (ULONG)strtoul(val[0] == '$' ? val + 1 : val, NULL, 16);
  else if (!strcmp(key, "FPS")) opt_fps = 1;
  else if (!strcmp(key, "MGLBATCH")) { int b = atoi(val); if (b >= 1 && b <= 64) opt_batch = b; }
  else if (!strcmp(key, "NOJOY")) opt_joy = 0;
}

/* ------------------------------------------------------------------ czas */
static struct MsgPort *timer_port;
static struct timerequest *timer_req;
static int timer_ok;

static void timer_open(void) {
  timer_port = CreateMsgPort();
  if (!timer_port) return;
  timer_req = (struct timerequest *)CreateIORequest(timer_port, sizeof(struct timerequest));
  if (!timer_req) return;
  if (OpenDevice((STRPTR) "timer.device", UNIT_MICROHZ, (struct IORequest *)timer_req, 0) != 0) {
    DeleteIORequest((struct IORequest *)timer_req);
    timer_req = NULL;
    return;
  }
  TimerBase = timer_req->tr_node.io_Device;
  timer_ok = 1;
}
static void timer_close(void) {
  if (timer_ok) { CloseDevice((struct IORequest *)timer_req); timer_ok = 0; }
  if (timer_req) { DeleteIORequest((struct IORequest *)timer_req); timer_req = NULL; }
  if (timer_port) { DeleteMsgPort(timer_port); timer_port = NULL; }
  TimerBase = NULL;
}
static uint32_t ticks_ms(void) {
  if (timer_ok) {
    struct EClockVal ev;
    unsigned long long t;
    ULONG f = ReadEClock(&ev);
    t = ((unsigned long long)ev.ev_hi << 32) | ev.ev_lo;
    return (uint32_t)(t / (f / 1000UL));
  } else {
    struct DateStamp ds;
    DateStamp(&ds);
    return (uint32_t)((((unsigned long)ds.ds_Days * 1440UL + (unsigned long)ds.ds_Minute) * 60000UL + (unsigned long)ds.ds_Tick * 20UL));
  }
}

/* ------------------------------------------------------------------ ekran */
static struct Screen *scr;
static struct Window *win;
static int scr_w, scr_h;
static UWORD *chip_blank;

static int mode_dims(ULONG id, LONG *w, LONG *h) {
  struct DimensionInfo dim;
  LONG got = GetDisplayInfoData(NULL, (UBYTE *)&dim, sizeof(dim), DTAG_DIMS, id);
  if (got < (LONG)(offsetof(struct DimensionInfo, Nominal) + sizeof(struct Rectangle))) {
    *w = (LONG)cgx_GetCyberIDAttr(CYBRIDATTR_WIDTH, id);
    *h = (LONG)cgx_GetCyberIDAttr(CYBRIDATTR_HEIGHT, id);
    return *w > 0 && *h > 0;
  }
  *w = dim.Nominal.MaxX - dim.Nominal.MinX + 1;
  *h = dim.Nominal.MaxY - dim.Nominal.MinY + 1;
  return 1;
}
static int mode_usable(ULONG id, LONG *w, LONG *h) {
  struct DisplayInfo di;
  ULONG d, fmt;
  LONG got = GetDisplayInfoData(NULL, (UBYTE *)&di, sizeof(di), DTAG_DISP, id);
  if (got < (LONG)(offsetof(struct DisplayInfo, NotAvailable) + sizeof(di.NotAvailable)) || di.NotAvailable) return 0;
  if (!cgx_IsCyberModeID(id)) return 0;
  d = cgx_GetCyberIDAttr(CYBRIDATTR_DEPTH, id);
  fmt = cgx_GetCyberIDAttr(CYBRIDATTR_PIXFMT, id);
  if ((d != 24 && d != 32) || fmt < PIXFMT_ARGB32 || fmt > PIXFMT_RGBA32) return 0;
  return mode_dims(id, w, h);
}
/* Najlepszy tryb: żądany rozmiar, potem 1280x720, potem najmniejszy >= 640x360. */
static ULONG pick_mode(void) {
  LONG mw, mh;
  ULONG id, best = INVALID_ID;
  long best_score = -1;
  if (opt_modeid != INVALID_ID && mode_usable(opt_modeid, &mw, &mh)) return opt_modeid;
  for (id = NextDisplayInfo(INVALID_ID); id != INVALID_ID; id = NextDisplayInfo(id)) {
    long score;
    if (!mode_usable(id, &mw, &mh) || mw < 640 || mh < 360) continue;
    score = (mw == pref_w && mh == pref_h) ? 2000000L : (mw == 1280 && mh == 720) ? 1000000L : 500000L - (long)(mw * mh / 100);
    if (score > best_score) { best_score = score; best = id; }
  }
  return best;
}
static void list_modes(void) {
  LONG w, h;
  ULONG id;
  PutStr((STRPTR) "Tryby RTG (ID rozmiar glebokosc format; potrzebny 24/32 bity, format 11..13):\n");
  for (id = NextDisplayInfo(INVALID_ID); id != INVALID_ID; id = NextDisplayInfo(id)) {
    if (!mode_dims(id, &w, &h) || !cgx_IsCyberModeID(id)) continue;
    Printf((STRPTR) "  %08lx %ldx%ld glebokosc %ld format %ld\n", id, w, h, (LONG)cgx_GetCyberIDAttr(CYBRIDATTR_DEPTH, id), (LONG)cgx_GetCyberIDAttr(CYBRIDATTR_PIXFMT, id));
  }
}
static void close_display(void) {
  if (win) { ClearPointer(win); CloseWindow(win); win = NULL; }
  if (scr) { CloseScreen(scr); scr = NULL; }
  if (chip_blank) { FreeVec(chip_blank); chip_blank = NULL; }
}
static int open_display(void) {
  ULONG mode = pick_mode();
  LONG mw, mh;
  if (mode == INVALID_ID) return 0;
  mode_dims(mode, &mw, &mh);
  scr_w = (int)mw;
  scr_h = (int)mh;
  scr = OpenScreenTags(NULL, SA_Width, scr_w, SA_Height, scr_h, SA_Depth, cgx_GetCyberIDAttr(CYBRIDATTR_DEPTH, mode), SA_Quiet, TRUE, SA_ShowTitle, FALSE,
                       SA_Type, CUSTOMSCREEN, SA_DisplayID, mode, TAG_DONE);
  if (!scr) return 0;
  win = OpenWindowTags(NULL, WA_CustomScreen, (ULONG)scr, WA_Left, 0, WA_Top, 0, WA_Width, scr_w, WA_Height, scr_h, WA_Borderless, TRUE, WA_Backdrop, TRUE,
                       WA_Activate, TRUE, WA_RMBTrap, TRUE, WA_IDCMP, IDCMP_RAWKEY | IDCMP_MOUSEBUTTONS | IDCMP_CLOSEWINDOW, TAG_DONE);
  if (!win) { CloseScreen(scr); scr = NULL; return 0; }
  chip_blank = (UWORD *)AllocVec(16, MEMF_CHIP | MEMF_CLEAR);
  if (chip_blank) SetPointer(win, chip_blank, 1, 1, 0, 0);
  ScreenToFront(scr);
  ActivateWindow(win);
  return 1;
}

/* ------------------------------------------------------------------ wejście */
static unsigned key_held, key_latch;
static int joy_active;

static unsigned rawkey_mask(UWORD c) {
  switch (c) {
    case 0x4C: case 0x11: return IN_UP;      /* kursor w górę, W */
    case 0x4D: case 0x21: return IN_DOWN;    /* kursor w dół, S */
    case 0x4F: case 0x20: return IN_LEFT;    /* kursor w lewo, A */
    case 0x4E: case 0x22: return IN_RIGHT;   /* kursor w prawo, D */
    case 0x44: case 0x43: case 0x40: return IN_OK; /* Return, Enter, Spacja */
    case 0x45: return IN_BACK;               /* Esc */
  }
  return 0;
}
static int poll_events(void) {
  struct IntuiMessage *msg;
  int quit = 0;
  while ((msg = (struct IntuiMessage *)GetMsg(win->UserPort)) != NULL) {
    ULONG cls = msg->Class;
    UWORD code = msg->Code;
    ReplyMsg((struct Message *)msg);
    if (cls == IDCMP_RAWKEY) {
      unsigned m = rawkey_mask((UWORD)(code & 0x7F));
      if (code & IECODE_UP_PREFIX) key_held &= ~m;
      else { key_held |= m; key_latch |= m | IN_ANY; }
    } else if (cls == IDCMP_MOUSEBUTTONS) {
      if (code == SELECTDOWN) { key_held |= IN_OK; key_latch |= IN_OK | IN_ANY; }
      else if (code == SELECTUP) key_held &= ~IN_OK;
      else if (code == MENUDOWN) { key_held |= IN_BACK; key_latch |= IN_BACK | IN_ANY; }
      else if (code == MENUUP) key_held &= ~IN_BACK;
    } else if (cls == IDCMP_CLOSEWINDOW) quit = 1;
  }
  return quit;
}
/* Joystick w porcie 2: JOY1DAT $DFF00C, ogień = CIAA PRA bit 7 (aktywny w stanie niskim).
 * Ogień wciśnięty już przy starcie (nic nie podłączone, pływająca linia) jest ignorowany, dopóki nie zostanie raz puszczony;
 * kierunki dopiero po pierwszym prawdziwym ogniu (mysz w porcie dawałaby fantomowe ruchy). */
static unsigned joy_mask(void) {
  volatile UWORD *joy1dat = (volatile UWORD *)0xDFF00C;
  volatile UBYTE *ciaapra = (volatile UBYTE *)0xBFE001;
  static int inited, fire_stuck;
  unsigned m = 0;
  UWORD j;
  int fire;
  if (!opt_joy) return 0;
  if (!inited) {
    inited = 1;
    fire_stuck = !(*ciaapra & 0x80);
  }
  fire = !(*ciaapra & 0x80);
  if (!fire) fire_stuck = 0;
  if (fire && !fire_stuck) { joy_active = 1; m |= IN_OK; }
  if (joy_active) {
    j = *joy1dat;
    if ((j >> 1) & 1) m |= IN_RIGHT;
    if ((j >> 9) & 1) m |= IN_LEFT;
    if (((j >> 1) ^ j) & 1) m |= IN_DOWN;
    if (((j >> 9) ^ (j >> 8)) & 1) m |= IN_UP;
  }
  return m;
}

/* ------------------------------------------------------------------ pętla */
static int run(void) {
  int rc = 0, mgl_ok = 0, frames = 0;
  uint32_t last, fps_t0, now;
  unsigned joy_prev = 0;
  char fpsbuf[64];
  if (GfxBase->LibNode.lib_Version < 40) { PutStr((STRPTR) "Najemnicy: wymagany AmigaOS 3.1 (graphics.library v40).\n"); return 20; }
  CyberGfxBase = OpenLibrary((STRPTR) "cybergraphics.library", 40);
  if (!CyberGfxBase) { PutStr((STRPTR) "Najemnicy: brak cybergraphics.library (Picasso96 / CyberGraphX). Potrzebna karta RTG, np. PiStorm.\n"); return 10; }
  timer_open();
  if (!open_display()) {
    PutStr((STRPTR) "Najemnicy: nie mozna otworzyc 32-bitowego ekranu RTG.\n");
    list_modes();
    rc = 10;
    goto done;
  }
  {
    struct Library *probe = OpenLibrary((STRPTR) "minigl.library", 0);
    if (!probe) { PutStr((STRPTR) "Najemnicy [1]: brak minigl.library w LIBS:.\n"); rc = 10; goto done; }
    Printf((STRPTR) "minigl.library %ld.%ld (gra wymaga co najmniej %ld)\n", (LONG)probe->lib_Version, (LONG)probe->lib_Revision, (LONG)MINIGL_VERSION);
    CloseLibrary(probe);
  }
  if (!MiniGLOpen()) {
    Printf((STRPTR) "Najemnicy [2]: minigl.library nie pasuje (za stara albo inne ABI; gra oczekuje ABI %ld).\n", (LONG)MINIGL_DISPATCH_ABI_VERSION);
    rc = 10;
    goto done;
  }
  if (opt_batch > 8) mglChooseVertexBufferSize(opt_batch * 4 + 16);
  if (!mglCreateContextFromWindow(win)) {
    PutStr((STRPTR) "Najemnicy [3]: MiniGL nie utworzyl kontekstu (mglCreateContextFromWindow).\n");
    MiniGLClose();
    rc = 10;
    goto done;
  }
  mgl_ok = 1;
  Printf((STRPTR) "Najemnicy: ekran %ldx%ld, MiniGL gotowy.\n", (LONG)scr_w, (LONG)scr_h);
  r2d_init(scr_w, scr_h, opt_batch);
  app_init();
  last = fps_t0 = ticks_ms();
  for (;;) {
    unsigned joy, held, pressed;
    int ms;
    now = ticks_ms();
    ms = (int)(now - last);
    last = now;
    if (ms > 100) ms = 100;
    if (ms < 1) ms = 1;
    if (poll_events()) break;
    joy = joy_mask();
    held = key_held | joy;
    pressed = key_latch | (joy & ~joy_prev);
    if (joy & ~joy_prev) pressed |= IN_ANY;
    joy_prev = joy;
    key_latch = 0;
    if (!app_frame(held, pressed, ms)) break;
    mglSwitchDisplay();
    frames++;
    if (opt_fps && now - fps_t0 >= 1000) {
      sprintf(fpsbuf, "FPS %d (%dx%d)", frames, scr_w, scr_h);
      Printf((STRPTR) "%s\n", (LONG)fpsbuf);
      frames = 0;
      fps_t0 = now;
    }
    if (ticks_ms() - now < 14) WaitTOF();
  }
done:
  if (mgl_ok) { mglDeleteContext(); MiniGLClose(); }
  close_display();
  timer_close();
  if (CyberGfxBase) { CloseLibrary(CyberGfxBase); CyberGfxBase = NULL; }
  return rc;
}

int main(int argc, char **argv) {
  struct StackSwapStruct sss;
  APTR stk;
  int rc;
  if (argc == 0) { /* Workbench: tooltypes */
    struct WBStartup *wb = (struct WBStartup *)argv;
    IconBase = OpenLibrary((STRPTR) "icon.library", 33);
    if (IconBase && wb && wb->sm_NumArgs > 0) {
      struct DiskObject *dobj = GetDiskObject((STRPTR)wb->sm_ArgList[0].wa_Name);
      if (dobj) {
        static const char *names[] = {"SCREEN", "MODEID", "FPS", "MGLBATCH", "NOJOY"};
        int i;
        for (i = 0; i < 5; i++) {
          STRPTR v = (STRPTR)FindToolType(dobj->do_ToolTypes, (STRPTR)names[i]);
          if (v) { snprintf(msg_buf, sizeof(msg_buf), "%s=%s", names[i], (const char *)v); parse_opt(msg_buf); }
        }
        FreeDiskObject(dobj);
      }
    }
    if (IconBase) { CloseLibrary(IconBase); IconBase = NULL; }
  } else {
    int i;
    for (i = 1; i < argc; i++) parse_opt(argv[i]);
  }
  stk = AllocVec(STACK_BYTES, MEMF_PUBLIC);
  if (!stk) return 20;
  sss.stk_Lower = stk;
  sss.stk_Upper = (ULONG)stk + STACK_BYTES;
  sss.stk_Pointer = (APTR)sss.stk_Upper;
  StackSwap(&sss);
  rc = run();
  StackSwap(&sss);
  FreeVec(stk);
  return rc;
}
