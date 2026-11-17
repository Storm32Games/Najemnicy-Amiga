/* Mapa regionu i podróż (port src/scenes/TravelScene.ts): krajobraz wypieczony z gry (iso/RegionArt.ts), trasy i miejsca
 * zleceń z core/region, marsz drużyny gęsiego po trasie, budynki zasłaniające postacie, bestie krążące po nizinach,
 * zdarzenia w drodze (core/campaign: roll_travel_event, resolve_event_choice) z rzutem k20, zasadzka bestii.
 * Sterowanie: góra / dół - zlecenie, lewo / prawo - przybliżenie, fire - wyrusz, Esc - Przystań (w marszu: zawróć).
 * Plik w UTF-8, napisy przekodowuje tools/amiga/latin2_literals.py. */
#include <stdio.h>
#include <string.h>
#include <stdlib.h>
#include "app.h"
#include "ui.h"
#include "game.h"
#include "scenefx.h"
#include "../gfx/r2d.h"
#include "../gfx/img.h"
#include "../core/frontend.h"
#include "../core/character.h"
#include "../core/region.h"
#include "../data/gamedata.h"
#include "../data/assets.h"

#undef MAP_W
#undef MAP_H
#define MAP_W 1000   /* mapa regionu w pikselach (RegionArt.ts) */
#define MAP_H 700
#define OX 488
#define OY 380
#define WQ 256
#define Q(v) ((int32_t)((v) * WQ + ((v) < 0 ? -0.5 : 0.5)))
#define GAP 141                 /* round(0.55 * WQ) */
#define AUTO_DEPART_MS 700
#define LIST_X 6
#define LIST_Y 18
#define LIST_W 124
#define SIDE_W 150
#define SIDE_X (V_W - SIDE_W - 6)
#define SIDE_Y 18
#define DQ(d) ((int32_t)(((d) - 5.0f) * 65536))
static const WPos HOME = {-17 * WQ, 8 * WQ};
static const uint32_t TYPE_COLOR[OBJ_COUNT] = {0xc43d2f, 0x7fc46a, 0x4aa8ff, 0xf2a93b, 0xff30ff, 0x40e0d0, 0xe8d070, 0x9c6ad8, 0xe0e0e0};
static const char *const DIFF_NAME[4] = {"\243atwe", "Standardowe", "Trudne", "\246miertelne"};
static const uint32_t DIFF_COL[4] = {PAL_GOOD, PAL_AMBER, PAL_BAD, PAL_BAD};
#define N_ZOOM 5
static const float Z_LEVELS[N_ZOOM] = {0.48f, 1, 2, 3, 4};   /* [0] = cały region: max(480 / 1000, 270 / 700) */
#define Z_TRAVEL 2.0f
#define Z_EVENT 3.0f

enum { S_IDLE, S_MOVING, S_EVENT, S_ARRIVED };
enum { L_MAP, L_FAUNA, L_OCC0, L_N = L_OCC0 + TRAVEL_ATLASES };
static Img img[L_N], walk_img[MAX_PARTY];
static int loaded;

/* zlecenia, trasy, miejsca */
static int n_all, job;          /* job: indeks w g_camp.contracts albo -1 */
static Route routes[MAX_CONTRACTS];
static WPos spots[MAX_CONTRACTS];
typedef struct { int16_t x, y; } Dot;
static Dot dots[MAX_CONTRACTS][160];
static int n_dots[MAX_CONTRACTS];

/* drużyna */
typedef struct { float x, z; int dir, frame, ms, walk; } Walker;
static Walker walkers[MAX_PARTY];
static int n_walk, walk_row[MAX_PARTY];

/* bestie */
typedef struct { float x, z, hx, hz, tx, tz, sx, sz, alpha, a0, a1, scale; int kind, flip, dead, busy, flee, walk, frame, ms; float wait, t, dur; } Beast;
static Beast fauna[5];

static int state, tick, dur, event_tick, ambush_tick, auto_ms;
static const TravelEvent *event;
static TickClock clock;
static MoteField dust;
static float t_sec;
static float cam_x, cam_y, cam_z, view_x, view_y, view_z;
static int shake_ms;
static Rng rng;

/* okna zdarzeń */
enum { W_NONE, W_EVENT, W_ROLL, W_RESULT };
static int win, win_focus, roll_n, roll_ms, roll_shown, ev_fauna, ev_beast;
static TravelEvent fauna_ev;
static EventChoice fauna_choices[3];
static EventOutcome fauna_out[3][4];
static char fauna_txt[32][200];
static const EventChoice *chosen;
static EventResolution res;

/* dziennik wiadomości */
typedef struct { char text[128]; uint32_t col; int ms; } Msg;
static Msg msgs[5];
static int n_msgs;

/* ------------------------------------------------------------------ rzut */
static int scr_x(int32_t x, int32_t z) { return OX + (int)rdiv((x - z) * 12, WQ); }
static int scr_y(int32_t x, int32_t z, int32_t up) { return OY + (int)rdiv((x + z) * 6, WQ) - (int)rdiv((height_q8(x, z) + up) * 12, WQ); }
static float scr_xf(float x, float z) { return OX + (x - z) * 12 / WQ; }
static float scr_yf(float x, float z) { return OY + (x + z) * 6 / WQ - height_q8((int32_t)x, (int32_t)z) * 12.0f / WQ; }
static int32_t key_depth(float key) {
  float k = (key + 60) / 120;
  return DQ(5 + (k < 0 ? 0 : k > 0.999f ? 0.999f : k));
}
static int32_t unit_depth(float x, float z) { return key_depth((x + z) / WQ) + 33; }

static void msg(const char *text, uint32_t col) {
  if (n_msgs == 5) {
    memmove(msgs, msgs + 1, sizeof(Msg) * 4);
    n_msgs--;
  }
  snprintf(msgs[n_msgs].text, sizeof msgs[n_msgs].text, "%s", text);
  msgs[n_msgs].col = col;
  msgs[n_msgs].ms = 6000;
  n_msgs++;
}

static void fauna_event_open(void);
static float frand(void) { return (float)rng_below(&rng, 65536) / 65536.0f; }

/* ------------------------------------------------------------------ drużyna: szyk i kierunek */
static const Route *route(void) { return job >= 0 ? &routes[job] : NULL; }

static void start_dir(float *dx, float *dz) {
  const Route *r = route();
  WPos a, b;
  float l;
  if (!r) {
    *dx = WQ;
    *dz = 0;
    return;
  }
  a = route_point_at(r, 0);
  b = route_point_at(r, Q(1));
  l = (float)int_sqrt((b.x - a.x) * (b.x - a.x) + (b.z - a.z) * (b.z - a.z));
  if (l < 1) l = 1;
  *dx = (b.x - a.x) * WQ / l;
  *dz = (b.z - a.z) * WQ / l;
}

/* formation(): miejsce i-tego po przebyciu d przez prowadzącego; przed trasą - kolumna za Przystanią */
static void formation(int i, float d, float *x, float *z) {
  float di = d - i * GAP, dx, dz, back, side;
  const Route *r = route();
  if (r && di >= 0) {
    WPos p = route_point_at(r, (int32_t)di);
    *x = (float)p.x;
    *z = (float)p.z;
    return;
  }
  start_dir(&dx, &dz);
  back = -di / WQ;
  side = i % 2 ? 0.18f : -0.18f;
  *x = HOME.x + dx * back - dz * side * (i ? 1 : 0);
  *z = HOME.z + dz * back + dx * side * (i ? 1 : 0);
}

/* dirOfVector: 0 E, 1 SE, 2 S, 3 SW, 4 W, 5 NW, 6 N, 7 NE (y w dół) */
static int dir_of(float dx, float dy) {
  float ax = dx < 0 ? -dx : dx, ay = dy < 0 ? -dy : dy;
  if (ay < ax * 0.41421f) return dx >= 0 ? 0 : 4;
  if (ax < ay * 0.41421f) return dy >= 0 ? 2 : 6;
  if (dx >= 0) return dy >= 0 ? 1 : 7;
  return dy >= 0 ? 3 : 5;
}

static void face(Walker *w, float dx, float dy) {
  if (dx * dx + dy * dy < 4) return;
  w->dir = dir_of(dx, dy);
}

/* ------------------------------------------------------------------ głębia względem budynków (depthAt) */
static int32_t depth_at(float x, float z, float L, float T, float R, float B, int *hidden) {
  int32_t own = unit_depth(x, z), lo = INT32_MIN, hi = INT32_MAX;
  float k = (x + z) / WQ, u = (x - z) / WQ;
  int i;
  for (i = 0; i < TRAVEL_BLOCK_N; i++) {
    const TravelBlock *b = &TRAVEL_BLOCK[i];
    float x0, x1, z0, z1, uc, front;
    if (b->x1 <= L || b->x0 >= R || b->y1 <= T || b->y0 >= B) continue;
    x0 = b->bx0 / 256.0f;
    x1 = b->bx1 / 256.0f;
    z0 = b->bz0 / 256.0f;
    z1 = b->bz1 / 256.0f;
    uc = u > x0 - z1 ? u : x0 - z1;
    if (uc > x1 - z0) uc = x1 - z0;
    front = uc >= x1 - z1 ? 2 * x1 - uc : uc + 2 * z1;
    if (k < front) {
      if (b->depth < hi) hi = b->depth;
    } else if (b->depth > lo) lo = b->depth;
  }
  *hidden = hi != INT32_MAX;
  if (own > lo && own < hi) return own;
  if (lo < hi) return hi == INT32_MAX ? lo + 33 : lo == INT32_MIN ? hi - 33 : lo + (hi - lo) / 2;
  return hi - 33;
}

/* ------------------------------------------------------------------ bestie */
static int far_enough(float x, float z, float px, float pz, float min) { return (x - px) * (x - px) + (z - pz) * (z - pz) > min * WQ * min * WQ; }

static void spawn_fauna(void) {
  int i, t, k, ok;
  for (i = 0; i < 5; i++) {
    Beast *f = &fauna[i];
    float x = 0, z = 0;
    for (t = 0; t < 60; t++) {
      x = (float)Q(-26 + frand() * 56);
      z = (float)Q(-14 + frand() * 30);
      if (height_q8((int32_t)x, (int32_t)z) >= Q(1.2) || !far_enough(x, z, HOME.x, HOME.z, 6)) continue;
      ok = 1;
      for (k = 0; k < n_all && ok; k++) ok = far_enough(x, z, spots[k].x, spots[k].z, 3);
      for (k = 0; k < n_all && ok; k++) {
        int j;
        for (j = 0; j < routes[k].n && ok; j += 6) ok = far_enough(x, z, routes[k].x[j], routes[k].z[j], 3);
      }
      if (ok) break;
    }
    memset(f, 0, sizeof *f);
    f->kind = (int)rng_below(&rng, 8);
    f->x = f->hx = x;
    f->z = f->hz = z;
    f->alpha = 1;
    f->wait = frand() * 3;
    {
      float s = FAUNA_SCALE_Q8[f->kind] / 256.0f;
      f->scale = 0.42f * (s < 1.4f ? s : 1.4f) * (0.8f + frand() * 0.4f);
    }
  }
}

/* liniowy ruch (tween bez easingu) z (sx, sz) do (tx, tz) w dur s, opcjonalnie alfa a0 -> a1 */
static void beast_go(Beast *f, float tx, float tz, float dur_s, float a1) {
  f->sx = f->x;
  f->sz = f->z;
  f->tx = tx;
  f->tz = tz;
  f->t = 0;
  f->dur = dur_s > 0.01f ? dur_s : 0.01f;
  f->a0 = f->alpha;
  f->a1 = a1;
  f->busy = 1;
  f->walk = 1;
  f->frame = 0;
  f->ms = 0;
}

static void update_fauna(float dt, int ms) {
  int i;
  for (i = 0; i < 5; i++) {
    Beast *f = &fauna[i];
    /* animacja: spoczynek 2 klatki po 625 ms, chód 4 klatki po 91 ms */
    if (!(f->dead && !f->busy)) {
      f->ms += ms;
      while (f->ms >= (f->walk ? 91 : 625)) {
        f->ms -= f->walk ? 91 : 625;
        f->frame = (f->frame + 1) % (f->walk ? 4 : 2);
      }
    }
    if (f->busy) {
      float k;
      f->t += dt;
      k = f->t / f->dur;
      if (k > 1) k = 1;
      f->x = f->sx + (f->tx - f->sx) * k;
      f->z = f->sz + (f->tz - f->sz) * k;
      f->alpha = f->a0 + (f->a1 - f->a0) * k;
      if (k >= 1) {
        f->busy = 0;
        f->walk = 0;
        f->frame = 0;
        if (f->flee) f->dead = 1;
        if (ev_beast == i && win == W_NONE && state == S_EVENT && !f->dead) fauna_event_open();   /* koniec szarży */
      }
      continue;
    }
    if (f->dead) continue;
    f->wait -= dt;
    if (f->wait > 0) continue;
    f->wait = 1 + frand() * 4;
    {
      int32_t a = (int32_t)rng_below(&rng, 4096);
      float rr = 0.8f + frand() * 2.2f, tx = f->hx + Q(cos_fine(a) * rr / 16384.0f), tz = f->hz + Q(sin_fine(a) * rr / 16384.0f), d;
      if (height_q8((int32_t)tx, (int32_t)tz) > Q(1.6)) {
        tx = f->hx;
        tz = f->hz;
      }
      d = (float)int_sqrt((int32_t)((tx - f->x) * (tx - f->x) + (tz - f->z) * (tz - f->z))) / WQ;
      f->flip = tx - tz < f->x - f->z;
      beast_go(f, tx, tz, d / (0.5f + frand() * 0.7f), f->alpha);
    }
  }
}

/* ------------------------------------------------------------------ zdarzenia */
/* faunaAttackEvent(name): {N} - nazwa wielką literą, {n} - nazwa */
static const char *subst(const char *src, const char *name) {
  static int slot;
  char *out = fauna_txt[slot++ & 31];
  int n = 0;
  for (; *src && n < 196; src++) {
    if (src[0] == '{' && (src[1] == 'N' || src[1] == 'n') && src[2] == '}') {
      int k;
      for (k = 0; name[k] && n < 196; k++) {
        char c[2];
        c[0] = name[k];
        c[1] = 0;
        if (!k && src[1] == 'N') latin2_upper(c);   /* pierwsza litera */
        out[n++] = c[0];
      }
      src += 2;
    } else out[n++] = *src;
  }
  out[n] = 0;
  return out;
}

static void build_fauna_event(int kind) {
  const char *name = FAUNA_NAMES[kind];
  int c, d;
  fauna_ev = FAUNA_ATTACK_EVENT;
  fauna_ev.title = subst(FAUNA_ATTACK_EVENT.title, name);
  fauna_ev.text = subst(FAUNA_ATTACK_EVENT.text, name);
  for (c = 0; c < fauna_ev.n_choices; c++) {
    fauna_choices[c] = FAUNA_ATTACK_EVENT.choices[c];
    for (d = 0; d < 4; d++)
      if (FAUNA_ATTACK_EVENT.choices[c].out[d]) {
        fauna_out[c][d] = *FAUNA_ATTACK_EVENT.choices[c].out[d];
        fauna_out[c][d].text = subst(fauna_out[c][d].text, name);
        fauna_choices[c].out[d] = &fauna_out[c][d];
      }
    fauna_ev.choices[c] = fauna_choices[c];
  }
}

static void fauna_event_open(void) {
  app_sfx("hit", 256, 256);
  shake_ms = 140;
  build_fauna_event(fauna[ev_beast].kind);
  event = &fauna_ev;
  ev_fauna = 1;
  win = W_EVENT;
  win_focus = 0;
  app_sfx("alarm", 128, 256);
}

static void open_event(const TravelEvent *ev) {
  event = ev;
  ev_fauna = 0;
  win = W_EVENT;
  win_focus = 0;
  app_sfx("radio", 128, 256);
}

static void choose(int i) {
  chosen = &event->choices[i];
  game_rng(&rng);
  resolve_event_choice(&g_camp, g_camp.contracts[job].level, chosen, &rng, &res);
  if (res.has_check && res.who && chosen->skill != SKILL_NONE) {
    win = W_ROLL;
    roll_n = roll_ms = 0;
    roll_shown = 1 + (int)rng_below(&rng, 20);
    app_sfx("dice", 256, 256);
  } else {
    win = W_RESULT;
    win_focus = 0;
  }
}

static void result_effects_log(void);

static void close_result(void) {
  int i = (int)(chosen - event->choices);
  win = W_NONE;
  if (ev_fauna) {
    Beast *f = &fauna[ev_beast];
    WPos p;
    p.x = (int32_t)walkers[0].x;
    p.z = (int32_t)walkers[0].z;
    if (i == 0 && res.degree >= 2) {
      f->dead = 1;
      f->walk = 0;
      f->a0 = f->alpha;
      beast_go(f, f->x, f->z, 0.3f, 0.5f);
      f->walk = 0;
    } else {
      float dx = f->x - p.x, dz = f->z - p.z, l = (float)int_sqrt((int32_t)(dx * dx + dz * dz));
      if (l < 1) l = 1;
      f->flip = dx - dz < 0;
      f->flee = 1;
      beast_go(f, f->x + dx / l * Q(9), f->z + dz / l * Q(9), 1.6f, 0);
    }
    ev_beast = -1;
  }
  event = NULL;
  state = S_MOVING;
  for (i = 0; i < n_walk; i++) walkers[i].walk = 1;
}

static int effects(char out[][96], uint32_t *col) {
  int n = 0, i;
  if (res.scrap) {
    sprintf(out[n], "%s%d Z\263omu", res.scrap > 0 ? "+" : "", res.scrap);
    col[n++] = res.scrap > 0 ? PAL_GOOD : PAL_BAD;
  }
  for (i = 0; i < res.n_items; i++) {
    snprintf(out[n], 96, "Zdobyto: %s", ITEM_DEFS[res.items[i]].name);
    col[n++] = PAL_GOOD;
  }
  for (i = 0; i < FACTION_COUNT; i++)
    if (res.rep[i]) {
      sprintf(out[n], "%s %s%d", i == FACTION_NOMADS ? "Nomadzi" : "Ocaleni", res.rep[i] > 0 ? "+" : "", res.rep[i]);
      col[n++] = res.rep[i] > 0 ? PAL_GOOD : PAL_BAD;
    }
  if (res.xp) {
    sprintf(out[n], "+%d PD dla ka\277dego", res.xp);
    col[n++] = PAL_GOOD;
  }
  if (res.days) {
    if (res.days > 0) sprintf(out[n], "Strata czasu: +%d d.", res.days);
    else sprintf(out[n], "Zyskany czas: \2021 d.");
    col[n++] = res.days > 0 ? PAL_BAD : PAL_GOOD;
  }
  if (res.hp && res.hurt) {
    snprintf(out[n], 96, "%s traci %d PW", res.hurt->name, res.hp);
    col[n++] = PAL_BAD;
  }
  return n;
}

static void result_effects_log(void) {
  char e[8][96];
  uint32_t c[8];
  int n = effects(e, c), i, bad = 0;
  for (i = 0; i < n; i++) {
    msg(e[i], c[i]);
    if (c[i] == PAL_BAD) bad = 1;
  }
  app_sfx(res.degree == 3 ? "crit" : res.degree >= 2 ? "pickup" : "miss", 256, 256);
  if (bad) app_sfx("hit", 128, 256);
}

/* ------------------------------------------------------------------ wybór zlecenia, wymarsz */
static void select_job(int j, int centre) {
  if (state != S_IDLE || j < 0 || j >= n_all) return;
  job = j;
  dur = route_ticks(&routes[j]);
  if (centre && view_z >= 1) {
    view_x = (float)scr_x(spots[j].x, spots[j].z);
    view_y = (float)scr_y(spots[j].x, spots[j].z, 0);
  }
  {
    /* drużyna patrzy w stronę pierwszego odcinka trasy */
    WPos b = route_point_at(&routes[j], Q(1.5));
    int i;
    for (i = 0; i < n_walk; i++) face(&walkers[i], scr_xf((float)b.x, (float)b.z) - scr_xf((float)HOME.x, (float)HOME.z), scr_yf((float)b.x, (float)b.z) - scr_yf((float)HOME.x, (float)HOME.z));
  }
}

static void depart(void) {
  int i;
  char buf[160];
  if (state != S_IDLE || job < 0) return;
  auto_ms = -1;
  state = S_MOVING;
  tick = 0;
  game_rng(&rng);
  if (g_force_event >= 0) event = g_force_event < TRAVEL_EVENT_COUNT ? &TRAVEL_EVENTS[g_force_event] : NULL;
  else event = roll_travel_event(&rng, 0.3);
  event_tick = event ? (dur * (55 + (int)rng_below(&rng, 26))) / 100 : -1;
  {
    int live = 0, ambush = g_force_event == 99 || (g_force_event < 0 && rng_next(&rng) < FAUNA_CHANCE_LE);
    for (i = 0; i < 5; i++) live += !fauna[i].dead;
    ambush_tick = ambush && live ? (dur * (18 + (int)rng_below(&rng, 26))) / 100 : -1;
  }
  snprintf(buf, sizeof buf, "Wyruszacie: %s", g_camp.contracts[job].title);
  msg(buf, PAL_TEXT);
  for (i = 0; i < n_walk; i++) {
    walkers[i].walk = 1;
    walkers[i].frame = (int)rng_below(&rng, 4);
  }
  app_sfx("step", 256, 256);
}

static int start_ambush(void) {
  float px = walkers[0].x, pz = walkers[0].z, best = 0;
  int i, b = -1;
  char buf[96];
  for (i = 0; i < 5; i++) {
    float d;
    if (fauna[i].dead) continue;
    d = (fauna[i].x - px) * (fauna[i].x - px) + (fauna[i].z - pz) * (fauna[i].z - pz);
    if (b < 0 || d < best) {
      best = d;
      b = i;
    }
  }
  if (b < 0) return 0;
  {
    Beast *f = &fauna[b];
    if (best > (float)Q(7) * Q(7)) {
      int32_t a = (int32_t)rng_below(&rng, 4096);
      f->x = px + Q(cos_fine(a) * 6 / 16384.0f);
      f->z = pz + Q(sin_fine(a) * 6 / 16384.0f);
    }
    state = S_EVENT;
    for (i = 0; i < n_walk; i++) walkers[i].walk = 0;
    snprintf(buf, sizeof buf, "Uwaga! Zmutowany %s szar\277uje na dru\277yn\352!", FAUNA_NAMES[f->kind]);
    msg(buf, PAL_BAD);
    app_sfx("growl", 256, 256);
    f->flip = px - pz < f->x - f->z;
    ev_beast = b;
    beast_go(f, px + (f->x < px ? -Q(0.9) : Q(0.9)), pz, 0.7f, f->alpha);
  }
  return 1;
}

/* ------------------------------------------------------------------ wejście / wyjście */
static void enter(void) {
  int i;
  char name[32];
  loaded = 1;
  for (i = 0; i < L_N; i++) {
    if (i < L_OCC0) snprintf(name, sizeof name, "%s", i == L_MAP ? "travel_map" : "travel_fauna");
    else snprintf(name, sizeof name, "travel_occ%d", i - L_OCC0);
    if (!img_load(&img[i], name)) {
      fprintf(stderr, "Najemnicy: %s\n", img_error());
      loaded = 0;
    }
  }
  game_rng(&rng);
  n_all = g_camp.n_contracts;
  job = g_job >= 0 && g_job < n_all ? g_job : -1;
  contract_spots(g_camp.contracts, n_all, spots);
  for (i = 0; i < n_all; i++) {
    int k, nd = 0;
    int32_t next;
    build_route(spots[i], g_camp.contracts[i].biome, i, &routes[i]);
    next = routes[i].cum[routes[i].track_from];
    for (k = routes[i].track_from; k < routes[i].n && nd < 160; k++) {
      if (routes[i].cum[k] < next) continue;
      next = routes[i].cum[k] + Q(0.9);
      dots[i][nd].x = (int16_t)scr_x(routes[i].x[k], routes[i].z[k]);
      dots[i][nd].y = (int16_t)scr_y(routes[i].x[k], routes[i].z[k], 0);
      nd++;
    }
    n_dots[i] = nd;
  }
  /* drużyna: żywi (prowadzący = pierwszy żywy) */
  n_walk = 0;
  for (i = 0; i < g_camp.n_party; i++)
    if (!is_dead(&g_camp.party[i]) && g_camp.party[i].hp > 0) walk_row[n_walk++] = i;
  if (!n_walk) walk_row[n_walk++] = 0;
  for (i = 0; i < n_walk; i++) {
    const Character *c = &g_camp.party[walk_row[i]];
    snprintf(name, sizeof name, "walk_%s", RECRUIT_DEFS[c->recruit < RECRUIT_COUNT ? c->recruit : 0].key);
    if (!img_load(&walk_img[i], name)) fprintf(stderr, "Najemnicy: %s\n", img_error());
    memset(&walkers[i], 0, sizeof walkers[i]);
    walkers[i].dir = 2;
    walkers[i].frame = (int)((i * 37 % 100) * 8 / 100);   /* kroki nie w takt */
  }
  state = S_IDLE;
  tick = 0;
  dur = 300;
  t_sec = 0;
  win = W_NONE;
  ev_beast = -1;
  n_msgs = 0;
  shake_ms = 0;
  clock_reset(&clock, 0);
  fx_init();
  motes_init(&dust, 90, 0, 0, MAP_W, MAP_H, 12, 1, 4, 0.35);
  view_x = cam_x = MAP_W * 0.45f;
  view_y = cam_y = MAP_H * 0.56f;
  view_z = cam_z = 1;
  spawn_fauna();
  for (i = 0; i < n_walk; i++) formation(i, 0, &walkers[i].x, &walkers[i].z);
  if (job >= 0) {
    select_job(job, 1);
    msg("Wyruszacie za chwil\352\226 (dowolny klawisz: zosta\361 na mapie)", PAL_TEXT);
    auto_ms = AUTO_DEPART_MS;
  } else auto_ms = -1;
}

static void leave(void) {
  int i;
  for (i = 0; i < L_N; i++) img_free(&img[i]);
  for (i = 0; i < MAX_PARTY; i++) img_free(&walk_img[i]);
}

/* ------------------------------------------------------------------ aktualizacja */
static void clamp_view(float *x, float *y, float z) {
  float hw = V_W / (2 * z), hh = V_H / (2 * z);
  if (*x < hw) *x = hw;
  if (*x > MAP_W - hw) *x = MAP_W - hw;
  if (*y < hh) *y = hh;
  if (*y > MAP_H - hh) *y = MAP_H - hh;
}

static void zoom_by(int step) {
  int i, i0 = N_ZOOM - 1;
  for (i = 0; i < N_ZOOM; i++)
    if (Z_LEVELS[i] >= view_z - 0.001f) {
      i0 = i;
      break;
    }
  i0 += step;
  if (i0 < 0) i0 = 0;
  if (i0 >= N_ZOOM) i0 = N_ZOOM - 1;
  if (Z_LEVELS[i0] == view_z) return;
  view_z = Z_LEVELS[i0];
  app_sfx("hover", 102, 256);
}

static void update(unsigned held, unsigned pressed, int ms) {
  float dt = (ms > 100 ? 100 : ms) / 1000.0f;
  int ticks = clock_advance(&clock, ms, 10), i;
  (void)held;
  t_sec += dt;
  for (i = 0; i < ticks; i++) motes_step(&dust);
  for (i = 0; i < n_msgs; i++)
    if ((msgs[i].ms -= ms) <= 0) {
      memmove(msgs + i, msgs + i + 1, sizeof(Msg) * (size_t)(n_msgs - i - 1));
      n_msgs--;
      i--;
    }
  if (shake_ms > 0) shake_ms -= ms;
  update_fauna(dt, ms);
  /* animacja chodu: 8 klatek po 100 + 105 ms */
  for (i = 0; i < n_walk; i++) {
    Walker *w = &walkers[i];
    if (!w->walk) {
      w->frame = 0;
      continue;
    }
    w->ms += ms;
    while (w->ms >= 205) {
      w->ms -= 205;
      w->frame = (w->frame + 1) & 7;
    }
  }
  /* okna zdarzeń */
  if (win == W_ROLL) {
    roll_ms += ms;
    while (roll_ms >= 55 && roll_n < 14) {
      roll_ms -= 55;
      roll_n++;
      roll_shown = roll_n >= 14 ? res.check.d20 : 1 + (int)rng_below(&rng, 20);
    }
    if (roll_n >= 14 && roll_ms >= 450) {
      win = W_RESULT;
      win_focus = 0;
      result_effects_log();
    }
  } else if (win == W_EVENT && pressed) {
    if (pressed & IN_UP && win_focus > 0) win_focus--;
    else if (pressed & IN_DOWN && win_focus < event->n_choices - 1) win_focus++;
    else if (pressed & IN_OK) choose(win_focus);
  } else if (win == W_RESULT && pressed & (IN_OK | IN_BACK)) close_result();
  if (win != W_NONE) goto camera;

  /* wejście */
  if (auto_ms >= 0) {
    if (pressed) {
      auto_ms = -1;
      msg("Wymarsz wstrzymany \200 wybierz zlecenie i wci\266nij fire.", PAL_TEXT);
      pressed = 0;
    } else if ((auto_ms -= ms) < 0) depart();
  }
  if (!app_leaving() && pressed) {
    if (pressed & IN_BACK && (state == S_IDLE || state == S_MOVING)) {
      app_switch(SCR_HUB, 400, 500);
      return;
    }
    if (state == S_IDLE) {
      if (pressed & IN_UP) select_job(job <= 0 ? n_all - 1 : job - 1, 1);
      else if (pressed & IN_DOWN) select_job(job < 0 || job >= n_all - 1 ? 0 : job + 1, 1);
      else if (pressed & IN_LEFT) zoom_by(-1);
      else if (pressed & IN_RIGHT) zoom_by(1);
      else if (pressed & IN_OK) depart();
      if (pressed & (IN_UP | IN_DOWN)) app_sfx("click", 256, 256);
    }
  }
  /* marsz */
  if (state == S_IDLE) {
    float k = dt * 6 > 1 ? 1 : dt * 6;
    for (i = 0; i < n_walk; i++) {
      float tx, tz;
      formation(i, 0, &tx, &tz);
      walkers[i].x += (tx - walkers[i].x) * k;
      walkers[i].z += (tz - walkers[i].z) * k;
    }
  } else if (state == S_MOVING && job >= 0) {
    int before = tick;
    float tf, d;
    tick = tick + ticks > dur ? dur : tick + ticks;
    tf = tick + (tick < dur ? clock_alpha_q8(&clock) / 256.0f : 0);
    if (tf > dur) tf = (float)dur;
    d = routes[job].len * tf / dur;
    for (i = 0; i < n_walk; i++) {
      float di = d - i * GAP;
      WPos here, ahead;
      formation(i, d, &walkers[i].x, &walkers[i].z);
      if (di < 0) di = 0;
      here = route_point_at(&routes[job], (int32_t)di);
      ahead = route_point_at(&routes[job], (int32_t)di + Q(0.6));
      face(&walkers[i], scr_xf((float)ahead.x, (float)ahead.z) - scr_xf((float)here.x, (float)here.z), scr_yf((float)ahead.x, (float)ahead.z) - scr_yf((float)here.x, (float)here.z));
    }
    if (ambush_tick >= 0 && before < ambush_tick && tick >= ambush_tick) {
      ambush_tick = -1;
      if (start_ambush()) goto camera;
    }
    if (event && before < event_tick && tick >= event_tick) {
      state = S_EVENT;
      for (i = 0; i < n_walk; i++) walkers[i].walk = 0;
      open_event(event);
      goto camera;
    }
    if (tick >= dur) {
      state = S_ARRIVED;
      for (i = 0; i < n_walk; i++) walkers[i].walk = 0;
      msg("Jeste\266cie na miejscu.", PAL_GOOD);
      app_sfx("door", 256, 256);
      snprintf(g_notice, sizeof g_notice, "Misje taktyczne nie s\261 jeszcze przeniesione na Amig\352.");
      app_switch(SCR_HUB, 600, 500);
    }
  }
camera:
  {
    /* kamera: w marszu podąża za drużyną, przy zdarzeniu bliżej */
    float gx = view_x, gy = view_y, gz = view_z, kz = dt * 6 > 1 ? 1 : dt * 6, kp = dt * 4 > 1 ? 1 : dt * 4;
    clamp_view(&view_x, &view_y, view_z);
    gx = view_x;
    gy = view_y;
    if (state != S_IDLE) {
      gx = scr_xf(walkers[0].x, walkers[0].z);
      gy = scr_yf(walkers[0].x, walkers[0].z) - 8;
      gz = state == S_EVENT ? Z_EVENT : Z_TRAVEL;
      clamp_view(&gx, &gy, gz);
    }
    cam_z += (gz - cam_z) * kz;
    if (cam_z - gz < 0.01f && gz - cam_z < 0.01f) cam_z = gz;
    cam_x += (gx - cam_x) * kp;
    cam_y += (gy - cam_y) * kp;
    clamp_view(&cam_x, &cam_y, cam_z);
  }
}

/* ------------------------------------------------------------------ rysowanie mapy */
typedef struct { int32_t depth; int kind, idx; } Draw;
enum { D_OCC, D_FIRE, D_BEACON, D_FLAG, D_WALKER, D_BEAST };
static Draw dl[TRAVEL_OCC_N + 64];

static int cmp_draw(const void *a, const void *b) {
  const Draw *x = (const Draw *)a, *y = (const Draw *)b;
  if (x->depth != y->depth) return x->depth < y->depth ? -1 : 1;
  if (x->kind != y->kind) return x->kind - y->kind;
  return x->idx - y->idx;   /* jak kolejność tworzenia w Phaserze */
}

static void walker_rect(const Walker *w, float *L, float *T, float *R, float *B) {
  float x = scr_xf(w->x, w->z), y = scr_yf(w->x, w->z), k = 0.6f;
  *L = x - 16 * k;
  *T = y - 31.5f * k;
  *R = *L + 32 * k;
  *B = *T + 36 * k;
}

static void beast_rect(const Beast *f, float *L, float *T, float *R, float *B) {
  float x = scr_xf(f->x, f->z), y = scr_yf(f->x, f->z);
  *L = x - 12 * f->scale;
  *T = y - 32 * 0.85f * f->scale;
  *R = *L + 24 * f->scale;
  *B = *T + 32 * f->scale;
}

static void draw_walker(int i, uint32_t tint, int a) {
  const Walker *w = &walkers[i];
  float L, T, R, B;
  int fy = (w->dir / 7) * 256 + (w->dir % 7) * 36;
  walker_rect(w, &L, &T, &R, &B);
  img_draw_part(&walk_img[i], w->frame * 32, fy, 32, 36, L, T, 0.6f, 0, tint, a);
}

static void draw_beast(int i) {
  const Beast *f = &fauna[i];
  float L, T, R, B;
  int fr = f->walk ? 2 + f->frame : f->frame;
  beast_rect(f, &L, &T, &R, &B);
  img_draw_part(&img[L_FAUNA], fr * 24, f->kind * 32, 24, 32, L, T, f->scale, f->flip, 0xffffff, (int)(255 * f->alpha));
}

static void ring(float cx, float cy, float r, uint32_t col, int a) {
  int k;
  for (k = 0; k < 40; k++) {
    int32_t ang = k * 4096 / 40;
    r2d_rect(cx + cos_fine(ang) * r / 16384 - 0.5f, cy + sin_fine(ang) * r / 16384 - 0.5f, 1, 1, col, a);
  }
}

static void draw_map(void) {
  float vx0 = cam_x - V_W / (2 * cam_z) - 4, vx1 = cam_x + V_W / (2 * cam_z) + 4;
  float vy0 = cam_y - V_H / (2 * cam_z) - 4, vy1 = cam_y + V_H / (2 * cam_z) + 4;
  int n = 0, i, k, hidden[MAX_PARTY];
  float sx = 0, sy = 0;
  int32_t tq = clock_time_q8(&clock);
  if (shake_ms > 0) {
    sx = ((int)rng_below(&rng, 39) - 19) / 10.0f;
    sy = ((int)rng_below(&rng, 23) - 11) / 10.0f;
  }
  r2d_scale(cam_z, cam_z, cam_x, cam_y);
  r2d_offset(V_W / 2.0f - cam_x + sx, V_H / 2.0f - cam_y + sy);
  img_draw(&img[L_MAP], 0, 0, 255);
  /* szlaki: wszystkie przygaszone, wybrany pulsuje */
  for (i = 0; i < n_all; i++)
    for (k = 0; k < n_dots[i]; k++) {
      r2d_rect(dots[i][k].x, dots[i][k].y + 1.0f, 2, 1, 0x1a120c, 122);
      r2d_rect(dots[i][k].x, dots[i][k].y - 1.0f, 2, 2, 0x8a6a48, 204);
    }
  if (job >= 0) {
    int a = (int)(255 * (0.55f + 0.35f * wave_q14(tq, ang_q8(4), 0) / 16384));
    for (k = 0; k < n_dots[job]; k++) {
      r2d_rect(dots[job][k].x, dots[job][k].y + 1.0f, 2, 1, 0x1a120c, a * 6 / 10);
      r2d_rect(dots[job][k].x, dots[job][k].y - 1.0f, 2, 2, 0xffc050, a);
    }
    ring((float)scr_x(spots[job].x, spots[job].z), (float)scr_y(spots[job].x, spots[job].z, 0), 6 * (1 + 0.25f * wave_q14(tq, ang_q8(4), 0) / 16384),
         g_camp.contracts[job].story >= 0 ? 0xff30ff : PAL_AMBER, 255);
  }
  /* obiekty z głębią: budynki, ogniska, latarnia, flagi, drużyna, bestie */
  for (i = 0; i < TRAVEL_OCC_N; i++) {
    const TravelOcc *o = &TRAVEL_OCC[i];
    if (o->x + o->w < vx0 || o->x > vx1 || o->y + o->h < vy0 || o->y > vy1) continue;
    dl[n].depth = o->depth;
    dl[n].kind = D_OCC;
    dl[n++].idx = i;
  }
  for (i = 0; i < TRAVEL_FIRE_N; i++) {
    dl[n].depth = TRAVEL_FIRE[i].depth;
    dl[n].kind = D_FIRE;
    dl[n++].idx = i;
  }
  dl[n].depth = TRAVEL_BEACON.depth;
  dl[n].kind = D_BEACON;
  dl[n++].idx = 0;
  for (i = 0; i < n_all; i++) {
    dl[n].depth = unit_depth((float)spots[i].x, (float)spots[i].z);
    dl[n].kind = D_FLAG;
    dl[n++].idx = i;
  }
  for (i = 0; i < n_walk; i++) {
    float L, T, R, B;
    walker_rect(&walkers[i], &L, &T, &R, &B);
    dl[n].depth = depth_at(walkers[i].x, walkers[i].z, L, T, R, B, &hidden[i]);
    dl[n].kind = D_WALKER;
    dl[n++].idx = i;
  }
  for (i = 0; i < 5; i++) {
    float L, T, R, B;
    int h;
    beast_rect(&fauna[i], &L, &T, &R, &B);
    if (fauna[i].alpha <= 0) continue;
    dl[n].depth = depth_at(fauna[i].x, fauna[i].z, L, T, R, B, &h);
    dl[n].kind = D_BEAST;
    dl[n++].idx = i;
  }
  qsort(dl, (size_t)n, sizeof dl[0], cmp_draw);
  for (i = 0; i < n; i++) {
    int j = dl[i].idx;
    switch (dl[i].kind) {
      case D_OCC: {
        const TravelOcc *o = &TRAVEL_OCC[j];
        img_draw_part(&img[L_OCC0 + o->atlas], o->sx, o->sy, o->w, o->h, o->x, o->y, 1, 0, 0xffffff, 255);
        break;
      }
      case D_FIRE: fx_campfire(TRAVEL_FIRE[j].x, TRAVEL_FIRE[j].y, TRAVEL_FIRE[j].size_q8 / 256.0f, tq); break;
      case D_BEACON:
        if ((clock.tick & 31) < 16) r2d_rect(TRAVEL_BEACON.x - 1.0f, TRAVEL_BEACON.y - 1.0f, 2, 2, 0xff3020, 255);
        break;
      case D_FLAG: {
        int px = scr_x(spots[j].x, spots[j].z), py = scr_y(spots[j].x, spots[j].z, 0), a = job < 0 || j == job ? 255 : 140;
        r2d_rect(px - 0.5f, py - 14.0f, 1, 14, 0x1c1c1c, 255);
        r2d_rect(px + 0.5f, py - 13.5f, 7, 5, TYPE_COLOR[g_camp.contracts[j].type], a);
        break;
      }
      case D_WALKER: draw_walker(j, 0xffffff, 255); break;
      default: draw_beast(j); break;
    }
  }
  /* sylwetki drużyny za budynkami */
  for (i = 0; i < n_walk; i++)
    if (hidden[i]) draw_walker(i, 0xffd27a, 102);
  motes_draw(&dust, 0xf0c080);
  r2d_scale(1, 1, 0, 0);
  r2d_offset(0, 0);
}

/* ------------------------------------------------------------------ interfejs */
static int row_h(void) { return n_all > 7 ? 17 : 29; }

static float map_to_x(float wx) { return V_W / 2.0f + (wx - cam_x) * cam_z; }
static float map_to_y(float wy) { return V_H / 2.0f + (wy - cam_y) * cam_z; }

static void cut(const char *s, int n, char *out, int cap) {
  int len = (int)strlen(s);
  if (len <= n) {
    snprintf(out, (size_t)cap, "%s", s);
    return;
  }
  memcpy(out, s, (size_t)(n - 1));
  out[n - 1] = (char)0x96;
  out[n] = 0;
}

static void text_max(float x, float y, const char *s, uint32_t col, int maxw) {
  char buf[160];
  int n;
  snprintf(buf, sizeof buf, "%s", s);
  n = (int)strlen(buf);
  while (n > 1 && font_measure(buf, 0) > maxw) {
    buf[--n] = 0;
    buf[n - 1] = (char)0x96;
  }
  font_draw(x, y, buf, col, 255, FONT_OUTLINE, 0, 1);
}

static void draw_labels(void) {
  typedef struct { float x0, y0, x1, y1; } Rc;
  static Rc placed[MAX_CONTRACTS + 1];
  int np = 0, i, pass, travel = state != S_IDLE;
  float list_bottom = LIST_Y + 18 + n_all * (row_h() + 2);
  char t1[112], t2[96], tt[96];
  /* sektory i Przystań */
  for (i = 0; i < SECTOR_COUNT; i++) {
    const SectorDef *s = &SECTOR_DEFS[i];
    float wx = (float)scr_x(s->label.x, s->label.z), wy = (float)scr_y(s->label.x, s->label.z, 0), x, y, hw;
    wx = wx < 70 ? 70 : wx > MAP_W - 70 ? MAP_W - 70 : wx;
    wy = wy < 30 ? 30 : wy > MAP_H - 30 ? MAP_H - 30 : wy;
    x = map_to_x(wx);
    y = map_to_y(wy);
    hw = font_measure(s->name, 0) / 2.0f;
    if (!travel && y < list_bottom && y + 18 > LIST_Y && x - hw < LIST_X + LIST_W + 4) continue;
    if (x < -30 || x > V_W + 30 || y < 16 || y > V_H + 10) continue;
    font_draw_at((float)(int)x, (float)(int)y, 0.5f, 0, s->name, s->color, 230, FONT_OUTLINE, 0, 1);
    font_draw_at((float)(int)x, (float)(int)y + 9, 0.5f, 0, s->sub, 0xc9b890, 255, FONT_OUTLINE, 0, 1);
  }
  {
    float x = map_to_x((float)scr_x(HOME.x, HOME.z)), y = map_to_y((float)scr_y(HOME.x, HOME.z, 0) + 13);
    if (x > -30 && x < V_W + 30 && y > 16 && y < V_H + 10) font_draw_at((float)(int)x, (float)(int)y, 0.5f, 0, "PRZYSTA\321", PAL_AMBER, 255, FONT_OUTLINE, 0, 1);
  }
  /* napisy zleceń: wybrane pierwsze, kolidujące chowane */
  for (pass = 0; pass < 2; pass++)
    for (i = 0; i < n_all; i++) {
      const Contract *c = &g_camp.contracts[i];
      int sel = i == job, w, a, show;
      float x, y, hw;
      uint32_t col = TYPE_COLOR[c->type];
      if ((pass == 0) != sel) continue;
      cut(c->title, 26, tt, sizeof tt);
      snprintf(t1, sizeof t1, "%s%s", c->story >= 0 ? "\214 " : "", tt);
      snprintf(t2, sizeof t2, "%s \205 poz. %d", OBJECTIVE_NAMES[c->type], c->level);
      w = (font_measure(t1, 0) > font_measure(t2, 0) ? font_measure(t1, 0) : font_measure(t2, 0)) + 10;
      hw = w / 2.0f;
      x = map_to_x((float)scr_x(spots[i].x, spots[i].z) + 3);
      y = map_to_y((float)scr_y(spots[i].x, spots[i].z, 0) - 16);
      x = x < 40 ? 40 : x > V_W - 40 ? V_W - 40 : x;
      if (!travel && y - 21 < list_bottom && y + 18 > LIST_Y && x < LIST_X + LIST_W + 5 + hw) x = LIST_X + LIST_W + 5 + hw;
      if (!(x > -30 && x < V_W + 30 && y > 38 && y < V_H + 10)) continue;
      show = 1;
      if (!sel) {
        int k;
        for (k = 0; k < np; k++)
          if (x - hw < placed[k].x1 && x + hw > placed[k].x0 && y - 21 < placed[k].y1 && y > placed[k].y0) show = 0;
      }
      if (!show) continue;
      placed[np].x0 = x - hw;
      placed[np].y0 = y - 21;
      placed[np].x1 = x + hw;
      placed[np++].y1 = y;
      x = (float)(int)(x + 0.5f);
      y = (float)(int)(y + 0.5f);
      a = travel ? (sel ? 255 : 77) : job >= 0 && !sel ? 204 : 255;
      r2d_alpha(a);
      r2d_rect(x - hw, y - 21, (float)w, 21, 0x14100c, 230);
      r2d_frame(x - hw, y - 21, (float)w, 21, col, 255);
      r2d_rect(x - hw, y - 21, 3, 21, col, 255);
      font_draw_at(x, y - 19, 0.5f, 0, t1, PAL_TEXT, 255, FONT_OUTLINE, 0, 1);
      font_draw_at(x, y - 10, 0.5f, 0, t2, 0xb8a888, 255, FONT_OUTLINE, 0, 1);
      r2d_alpha(255);
    }
}

static void draw_top(void) {
  char buf[64];
  float x = 8;
  r2d_rect(0, 0, V_W, 13, PAL_PANEL, 242);
  r2d_rect(0, 13, V_W, 1, PAL_EDGE, 255);
  font_draw(x, 3, "MAPA REGIONU", PAL_AMBER, 255, FONT_OUTLINE, 0, 1);
  x += font_measure("MAPA REGIONU", 0) + 16;
  font_draw(x, 3, "Z\263om: ", PAL_TEXT, 255, FONT_OUTLINE, 0, 1);
  x += font_measure("Z\263om: ", 0);
  sprintf(buf, "%d", g_camp.scrap);
  font_draw(x, 3, buf, PAL_AMBER, 255, FONT_OUTLINE, 0, 1);
  x += font_measure(buf, 0) + 16;
  sprintf(buf, "Dzie\361: %d", g_camp.day);
  font_draw(x, 3, buf, PAL_TEXT, 255, FONT_OUTLINE, 0, 1);
  font_draw_at(V_W - 8, 3, 1, 0, state == S_IDLE ? "G\363ra / d\363\263: zlecenie \205 fire: wyrusz" : "W drodze\226", PAL_DIM, 255, FONT_OUTLINE, 0, 1);
}

static void draw_list(void) {
  int RH = row_h(), compact = RH != 29, H = 16 + n_all * (RH + 2), lvl = campaign_party_level(&g_camp), i;
  char buf[160];
  ui_panel(LIST_X, LIST_Y, LIST_W, H, PAL_EDGE);
  font_draw(LIST_X + 6, LIST_Y + 4, "ZLECENIA", PAL_AMBER, 255, FONT_OUTLINE, 0, 1);
  for (i = 0; i < n_all; i++) {
    const Contract *c = &g_camp.contracts[i];
    int y = LIST_Y + 14 + i * (RH + 2), on = i == job, d = difficulty_of(c->level, lvl), by, bw;
    r2d_rect(LIST_X + 4, (float)y, LIST_W - 8, (float)RH, on ? 0x3a2c1e : PAL_PANEL2, 255);
    r2d_frame(LIST_X + 4, (float)y, LIST_W - 8, (float)RH, on ? PAL_AMBER : PAL_EDGE, 255);
    r2d_rect(LIST_X + 4, (float)y, 3, (float)RH, TYPE_COLOR[c->type], 255);
    snprintf(buf, sizeof buf, "%s%s", c->story >= 0 ? "\214 " : "", c->title);
    text_max(LIST_X + 10, (float)(y + 2), buf, on ? 0xffffff : PAL_TEXT, LIST_W - 18);
    if (!compact) text_max(LIST_X + 10, (float)(y + 10), BIOME_NAMES[c->biome], PAL_DIM, LIST_W - 18);
    by = y + (compact ? 10 : 18);
    font_draw(LIST_X + 10, (float)by, DIFF_NAME[d], DIFF_COL[d], 255, FONT_OUTLINE, 0, 1);
    bw = font_measure(DIFF_NAME[d], 0);
    snprintf(buf, sizeof buf, " \205 %d Z \205 %s", c->reward_scrap, OBJECTIVE_NAMES[c->type]);
    text_max((float)(LIST_X + 10 + bw), (float)by, buf, PAL_DIM, LIST_W - 18 - bw);
  }
}

static void draw_side(void) {
  const Contract *c;
  char buf[256];
  int y = 5, d, h, x;
  if (job < 0 || state != S_IDLE) return;
  c = &g_camp.contracts[job];
  d = difficulty_of(c->level, campaign_party_level(&g_camp));
  /* wysokość: najpierw zmierzyć */
  snprintf(buf, sizeof buf, "%s%s", c->story >= 0 ? "\214 " : "", c->title);
  h = 5 + ui_text_h(buf, SIDE_W - 12, 0) + 3;
  {
    char b2[200];
    snprintf(b2, sizeof b2, "%s \205 %s \205 %s", OBJECTIVE_NAMES[c->type], BIOME_NAMES[c->biome], c->giver);
    h += ui_text_h(b2, SIDE_W - 12, 0) + 4;
  }
  h += ui_text_h(c->desc, SIDE_W - 12, 1) + 5 + 10 + 10 + FONT_LINE_H + 4 + 20;
  ui_panel(SIDE_X, SIDE_Y, SIDE_W, h, PAL_EDGE);
  y = SIDE_Y + 5;
  y += ui_text(SIDE_X + 6, y, buf, PAL_AMBER, SIDE_W - 12, 0, 0) + 3;
  snprintf(buf, sizeof buf, "%s \205 %s \205 %s", OBJECTIVE_NAMES[c->type], BIOME_NAMES[c->biome], c->giver);
  y += ui_text(SIDE_X + 6, y, buf, PAL_DIM, SIDE_W - 12, 0, 0) + 4;
  y += ui_text(SIDE_X + 6, y, c->desc, PAL_TEXT, SIDE_W - 12, 1, 0) + 5;
  x = SIDE_X + 6;
  font_draw((float)x, (float)y, "Trudno\266\346: ", PAL_TEXT, 255, FONT_OUTLINE, 0, 1);
  x += font_measure("Trudno\266\346: ", 0);
  font_draw((float)x, (float)y, DIFF_NAME[d], DIFF_COL[d], 255, FONT_OUTLINE, 0, 1);
  x += font_measure(DIFF_NAME[d], 0);
  snprintf(buf, sizeof buf, " (poz. %d)", c->level);
  font_draw((float)x, (float)y, buf, PAL_DIM, 255, FONT_OUTLINE, 0, 1);
  y += 10;
  x = SIDE_X + 6;
  font_draw((float)x, (float)y, "Nagroda: ", PAL_TEXT, 255, FONT_OUTLINE, 0, 1);
  x += font_measure("Nagroda: ", 0);
  snprintf(buf, sizeof buf, "%d Z", c->reward_scrap);
  font_draw((float)x, (float)y, buf, PAL_AMBER, 255, FONT_OUTLINE, 0, 1);
  x += font_measure(buf, 0);
  snprintf(buf, sizeof buf, " + %d PD", c->reward_xp);
  font_draw((float)x, (float)y, buf, PAL_TEXT, 255, FONT_OUTLINE, 0, 1);
  y += 10;
  snprintf(buf, sizeof buf, "Podr\363\277: %d d.", c->travel_days ? c->travel_days : 1);
  font_draw(SIDE_X + 6, (float)y, buf, PAL_DIM, 255, FONT_OUTLINE, 0, 1);
  y += FONT_LINE_H + 4;
  ui_button(SIDE_X + SIDE_W - 74, y, 68, 16, "WYRUSZ \215", BTN_PRIMARY, 1, 1);
}

static void draw_log(void) {
  int i, y = V_H - 24;
  for (i = n_msgs - 1; i >= 0; i--) {
    char wrapped[256];
    int lines = font_wrap(msgs[i].text, 0, 190, wrapped, sizeof wrapped), w = 0, h = lines * FONT_LINE_H;
    char *line = wrapped, *nl;
    for (; line; line = nl ? nl + 1 : NULL) {
      int lw;
      nl = strchr(line, '\n');
      if (nl) *nl = 0;
      lw = font_measure(line, 0);
      if (lw > w) w = lw;
      if (nl) *nl = '\n';
    }
    y -= h + 6 + 2;
    ui_panel(6, y, w + 8, h + 6, PAL_EDGE);
    ui_text(10, y + 3, msgs[i].text, msgs[i].col, 190, 0, 0);
  }
}

static void draw_hex(float cx, float cy, int32_t ang, uint32_t edge) {
  static const int8_t P[6][2] = {{0, -11}, {10, -5}, {10, 6}, {0, 12}, {-10, 6}, {-10, -5}};
  float px[6], py[6];
  int i, cs = cos_fine(ang), sn = sin_fine(ang);
  for (i = 0; i < 6; i++) {
    px[i] = cx + (P[i][0] * cs - P[i][1] * sn) / 16384.0f;
    py[i] = cy + (P[i][0] * sn + P[i][1] * cs) / 16384.0f;
  }
  for (i = 1; i < 5; i++) r2d_tri(px[0], py[0], px[i], py[i], px[i + 1], py[i + 1], 0x2a2018, 255);
  for (i = 0; i < 6; i++) {
    int j = (i + 1) % 6, k;
    for (k = 0; k < 8; k++) r2d_rect(px[i] + (px[j] - px[i]) * k / 8 - 0.5f, py[i] + (py[j] - py[i]) * k / 8 - 0.5f, 1, 1, edge, 255);
  }
}

static void draw_windows(void) {
  int x, y, i;
  char buf[200], nm[40];
  if (win == W_EVENT) {
    const int W = 330, H = 78 + event->n_choices * 20 + 30;
    int th;
    ui_window(W, H, event->title, &x, &y);
    th = ui_text(x + 10, y + 22, event->text, PAL_TEXT, W - 20, 2, 0);
    y += 26 + th + 6 > 60 ? 26 + th + 6 : 60;
    for (i = 0; i < event->n_choices; i++) {
      const EventChoice *ch = &event->choices[i];
      Character *who = best_for_choice(&g_camp, ch);
      if (ch->skill != SKILL_NONE && who) {
        int v = get_stat(who, ch->skill, 0);
        char sh[32];
        int k = 0;
        const char *s = who->name;
        while (*s && *s != ' ' && k < 30) sh[k++] = *s++;
        sh[k] = 0;
        snprintf(buf, sizeof buf, "%s %s%d (%s) vs ST %d", SKILL_DEFS[ch->skill].name, v >= 0 ? "+" : "", v, sh, choice_dc(ch, g_camp.contracts[job].level));
      } else snprintf(buf, sizeof buf, "bez testu");
      snprintf(nm, sizeof nm, "%s", ch->label);
      latin2_upper(nm);
      ui_button(x + 10, y, 150, 15, nm, BTN_PLAIN, win_focus == i, 1);
      font_draw((float)(x + 166), (float)(y + 4), buf, PAL_DIM, 255, FONT_OUTLINE, 0, 1);
      y += 20;
    }
  } else if (win == W_ROLL) {
    char sh[32];
    int k = 0;
    const char *s = res.who->name;
    while (*s && *s != ' ' && k < 30) sh[k++] = *s++;
    sh[k] = 0;
    ui_window(200, 70, event->title, &x, &y);
    snprintf(buf, sizeof buf, "%s pr\363buje: %s\226", sh, SKILL_DEFS[chosen->skill].name);
    font_draw_at((float)(x + 100), (float)(y + 20), 0.5f, 0, buf, PAL_DIM, 255, FONT_OUTLINE, 0, 1);
    draw_hex((float)(x + 100), (float)(y + 46), roll_n >= 14 ? 0 : roll_n * 37 * 4096 / 360,
             roll_n >= 14 ? (res.check.d20 == 20 ? PAL_GOOD : res.check.d20 == 1 ? PAL_BAD : PAL_AMBER) : PAL_AMBER);
    sprintf(buf, "%d", roll_shown);
    font_draw_at((float)(x + 100), (float)(y + 41), 0.5f, 0, buf, PAL_AMBER, 255, FONT_OUTLINE, 0, 1);
  } else if (win == W_RESULT) {
    const int W = 320;
    char e[8][96];
    uint32_t col[8];
    int n = effects(e, col), good = res.degree >= 2, yy;
    ui_window(W, 150, event->title, &x, &y);
    yy = y + 22;
    if (res.has_check && res.who && chosen->skill != SKILL_NONE) {
      char sh[32];
      int k = 0;
      const char *s = res.who->name;
      while (*s && *s != ' ' && k < 30) sh[k++] = *s++;
      sh[k] = 0;
      snprintf(buf, sizeof buf, "%s \200 %s: k20 %d %s%d = %d vs ST %d \222 %s", sh, SKILL_DEFS[chosen->skill].name, res.check.d20, res.check.mod >= 0 ? "+" : "", res.check.mod,
               res.check.total, res.check.dc, DEGREE_NAMES[res.degree]);
      ui_text(x + 10, yy, buf, good ? PAL_GOOD : PAL_BAD, W - 20, 0, 0);
      yy += 20;
    }
    yy += ui_text(x + 10, yy, res.outcome ? res.outcome->text : "\226", PAL_TEXT, W - 20, 2, 0) + 8;
    for (i = 0; i < n; i++) {
      font_draw((float)(x + 10), (float)yy, "\206 ", col[i], 255, FONT_OUTLINE, 0, 1);   /* • */
      font_draw((float)(x + 10 + font_measure("\206 ", 0)), (float)yy, e[i], col[i], 255, FONT_OUTLINE, 0, 1);
      yy += 9;
    }
    ui_button(x + W - 82, y + 150 - 22, 74, 15, "W DROG\312 \215", BTN_PRIMARY, 1, 1);
  }
}

static void draw(void) {
  if (!loaded) {
    font_draw_at(V_W / 2, V_H / 2, 0.5f, 0.5f, "Brak plik\363w grafiki (katalog gfx/)", PAL_BAD, 255, FONT_OUTLINE, 0, 1);
    return;
  }
  draw_map();
  draw_labels();
  draw_top();
  if (state == S_IDLE) {
    draw_list();
    draw_side();
    font_draw_at(V_W - 6, V_H - 4, 1, 1, "Lewo / prawo: przybli\277 \205 Esc: Przysta\361", PAL_DIM, 255, FONT_OUTLINE, 0, 1);
  }
  draw_log();
  if (state != S_EVENT && state != S_ARRIVED) ui_button(6, V_H - 20, 132, 15, state == S_IDLE ? "\217 WR\323\306 DO PRZYSTANI" : "\217 ZAWR\323\306", BTN_PLAIN, 0, 1);
  draw_windows();
  ui_toast_draw();
}

const Screen SCREEN_TRAVEL = {enter, update, draw, leave};
