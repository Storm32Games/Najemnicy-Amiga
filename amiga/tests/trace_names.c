/* Ślad generatora imion - zgodny z amiga/data/traces/names.txt (tools/amiga/trace_names.ts). Imiona wypisywane w UTF-8. */
#include <stdio.h>
#include <string.h>
#include "trace_fmt.h"
#include "../src/core/campaign.h"
#include "../src/core/names.h"

static void put_utf8(const char *s) {
  const unsigned char *p = (const unsigned char *)s;
  for (; *p; p++) {
    unsigned u = latin2_unicode(*p);
    if (u < 0x80) putchar((int)u);
    else if (u < 0x800) { putchar(0xC0 | (u >> 6)); putchar(0x80 | (u & 63)); }
    else { putchar(0xE0 | (u >> 12)); putchar(0x80 | ((u >> 6) & 63)); putchar(0x80 | (u & 63)); }
  }
}
static void upper_l2(char *s) {
  unsigned char *p = (unsigned char *)s;
  for (; *p; p++) {
    if (*p >= 'a' && *p <= 'z') *p = (unsigned char)(*p - 32);
    else switch (*p) {
      case 0xB1: *p = 0xA1; break; case 0xE6: *p = 0xC6; break; case 0xEA: *p = 0xCA; break; case 0xB3: *p = 0xA3; break;
      case 0xF1: *p = 0xD1; break; case 0xF3: *p = 0xD3; break; case 0xB6: *p = 0xA6; break; case 0xBC: *p = 0xAC; break; case 0xBF: *p = 0xAF; break;
      default: break;
    }
  }
}

int main(void) {
  static const char *const TAKEN[5] = {"Sowa", "Kruk", "Bizon", "Ig\263a Wro\361ska", "Szept"};
  static const char GEN[3] = {'m', 'f', 0};
  static CampaignState st;
  char seed[96], name[NAME_MAX + 1], buf[64];
  Rng rng;
  int a, c, g, v, i, k;
  for (a = 0; a < ANC_COUNT; a++)
    for (c = 0; c < CLASS_COUNT; c++)
      for (g = 0; g < 3; g++)
        for (v = 0; v < 2; v++) {
          sprintf(seed, "name:%s:%s:%s:%d", ANCESTRY_DEFS[a].key, CLASS_DEFS[c].key, g < 2 ? (g ? "f" : "m") : "-", v);
          rng_seed_str(&rng, seed);
          generate_name((uint8_t)a, (uint8_t)c, GEN[g], TAKEN, v ? 5 : 0, &rng, name);
          printf("name %s %s %s %d ", ANCESTRY_DEFS[a].key, CLASS_DEFS[c].key, g < 2 ? (g ? "f" : "m") : "-", v);
          put_utf8(name);
          printf("\n");
        }
  printf("fem ");
  for (i = 0; i < NAMES_SURNAMES.n; i++) {
    fem_surname(NAMES_SURNAMES.items[i], buf);
    if (i) putchar(',');
    put_utf8(buf);
  }
  printf("\n");
  for (k = 0; k < 6; k++) {
    uint8_t picks[3];
    int ok;
    picks[0] = (uint8_t)k; picks[1] = (uint8_t)(k + 1); picks[2] = (uint8_t)(k + 2);
    sprintf(seed, "hire:%d", k);
    rng_seed_str(&rng, seed);
    start_campaign(&st, picks, 3, &rng);
    strcpy(st.party[0].name, RECRUIT_DEFS[k + 5].name);
    upper_l2(st.party[0].name);
    st.scrap = 1000;
    ok = hire_recruit(&st, (uint8_t)(k + 5), &rng);
    printf("hire %d %d ", k, ok);
    for (i = 0; i < st.n_party; i++) { if (i) putchar('|'); put_utf8(st.party[i].name); }
    printf("\n");
  }
  return 0;
}
