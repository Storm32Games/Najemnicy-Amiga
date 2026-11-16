/* Generator imion najemników. Port src/core/data/names.ts (rawName, generateName); teksty w ISO-8859-2. */
#include <string.h>
#include <stdio.h>
#include "names.h"
#include "tactical.h"

static const char *pick(const StrList *l, Rng *r) { return l->items[(int)floor(rng_f(r) * l->n) % l->n]; }
/* pick z połączenia dwóch list ([...a, ...b]) */
static const char *pick2(const StrList *a, const StrList *b, Rng *r) {
  int n = a->n + b->n, i = (int)floor(rng_f(r) * n) % n;
  return i < a->n ? a->items[i] : b->items[i - a->n];
}

static int ends_with(const char *s, const char *suf) {
  size_t a = strlen(s), b = strlen(suf);
  return a >= b && !strcmp(s + a - b, suf);
}
static int is_vowel(unsigned char c) { return strchr("aeiouy", c) != NULL || c == 0xB1 /* ą */ || c == 0xEA /* ę */ || c == 0xF3 /* ó */; }

/* Żeńska forma przymiotnikowego nazwiska. */
void fem_surname(const char *s, char *out) {
  size_t n = strlen(s);
  strcpy(out, s);
  if (ends_with(s, "ski") || ends_with(s, "cki") || ends_with(s, "dzki")) out[n - 1] = 'a';
  else if (n >= 2 && s[n - 1] == 'y' && !is_vowel((unsigned char)s[n - 2])) out[n - 1] = 'a';
}
static void surname(char g, Rng *r, char *out) {
  const char *s = pick(&NAMES_SURNAMES, r);
  if (g == 'f') fem_surname(s, out);
  else strcpy(out, s);
}
static const char *fem(const char *w, char g) {
  int i;
  if (g == 'f') {
    for (i = 0; i < NAMES_FEM_N; i++) if (!strcmp(NAMES_FEM[i].from, w)) return NAMES_FEM[i].to;
  } else {
    for (i = 0; i < NAMES_MASC_N; i++) if (!strcmp(NAMES_MASC[i].from, w)) return NAMES_MASC[i].to;
  }
  return w;
}

static void raw_name(uint8_t ancestry, uint8_t class_id, char gender, Rng *rng, char *out) {
  char g = gender == 'f' || gender == 'm' ? gender : (rng_f(rng) < 0.4 ? 'f' : 'm');
  const StrList *call = &NAMES_CALL[class_id < CLASS_COUNT ? class_id : CLASS_SOLDIER];
  const StrList *firsts = g == 'f' ? &NAMES_FIRST_F : &NAMES_FIRST_M;
  char a[64], b[64];
  double r = rng_f(rng);
  if (ancestry == ANC_MUTANT) {
    if (r < 0.35) { strcpy(out, pick(&NAMES_MUT_CALL, rng)); return; }
    if (r < 0.65) { const char *t = fem(pick(&NAMES_MUT_TITLE, rng), g); sprintf(out, "%s %s", t, pick(&NAMES_MUT_CALL, rng)); return; }
    if (r < 0.85) { const char *f = pick(firsts, rng); sprintf(out, "%s \"%s\"", f, pick(&NAMES_MUT_CALL, rng)); return; }
    strcpy(out, pick(call, rng));
    return;
  }
  if (ancestry == ANC_CYBORG) {
    if (r < 0.3) { strcpy(out, pick(&NAMES_CYB_CALL, rng)); return; }
    if (r < 0.55) { const char *c = pick(&NAMES_CYB_CALL, rng); sprintf(out, "%s-%d", c, 2 + (int)floor(rng_f(rng) * 98)); return; }
    if (r < 0.7) {
      const char *se = pick(&NAMES_CYB_SERIAL, rng);
      int num = 10 + (int)floor(rng_f(rng) * 890);
      sprintf(out, "%s-%d \"%s\"", se, num, pick2(&NAMES_CYB_CALL, call, rng));
      return;
    }
    if (r < 0.85) {
      const char *f = pick(firsts, rng), *c = pick(&NAMES_CYB_CALL, rng);
      surname(g, rng, a);
      sprintf(out, "%s \"%s\" %s", f, c, a);
      return;
    }
    strcpy(out, pick(call, rng));
    return;
  }
  if (ancestry == ANC_NOMAD) {
    if (r < 0.35) { strcpy(out, pick(&NAMES_NOM_CALL, rng)); return; }
    if (r < 0.6) { const char *c = pick(&NAMES_NOM_CALL, rng); sprintf(out, "%s %s", c, pick(&NAMES_NOM_FROM, rng)); return; }
    if (r < 0.8) { const char *c = pick(&NAMES_NOM_CALL, rng); surname(g, rng, a); sprintf(out, "%s %s", c, a); return; }
    { const char *f = pick(firsts, rng); sprintf(out, "%s %s", f, pick(&NAMES_NOM_FROM, rng)); }
    return;
  }
  if (r < 0.28) {
    const char *f = pick(firsts, rng), *n = pick(&NAMES_NICK, rng);
    surname(g, rng, a);
    sprintf(out, "%s \"%s\" %s", f, n, a);
    return;
  }
  if (r < 0.46) { const StrList *l = rng_f(rng) < 0.6 ? call : &NAMES_NICK; strcpy(out, pick(l, rng)); return; }
  if (r < 0.64) { const char *c = pick2(call, &NAMES_NICK, rng); surname(g, rng, a); sprintf(out, "%s %s", c, a); return; }
  if (r < 0.8) { const char *f = pick(firsts, rng); surname(g, rng, a); sprintf(out, "%s %s", f, a); return; }
  if (r < 0.9) { const char *f = pick(firsts, rng); sprintf(out, "%s \"%s\"", f, pick2(&NAMES_NICK, call, rng)); return; }
  strcpy(b, fem(pick(&NAMES_TITLE_HUMAN, rng), g));
  sprintf(out, "%s %s", b, pick(firsts, rng));
}

/* key(): małe litery (także polskie), ciągi ["\s.-] -> spacja, przycięcie. */
unsigned char name_lower(unsigned char c) {
  if (c >= 'A' && c <= 'Z') return (unsigned char)(c + 32);
  switch (c) {
    case 0xA1: return 0xB1; case 0xC6: return 0xE6; case 0xCA: return 0xEA; case 0xA3: return 0xB3; case 0xD1: return 0xF1;
    case 0xD3: return 0xF3; case 0xA6: return 0xB6; case 0xAC: return 0xBC; case 0xAF: return 0xBF;
    default: return c;
  }
}
void name_key(const char *s, char *out) {
  const unsigned char *p = (const unsigned char *)s;
  int n = 0, sep = 0;
  for (; *p; p++) {
    if (*p == '"' || *p == ' ' || *p == '\t' || *p == '.' || *p == '-') { sep = 1; continue; }
    if (sep && n) out[n++] = ' ';
    sep = 0;
    out[n++] = (char)name_lower(*p);
  }
  out[n] = 0;
}

void generate_name(uint8_t ancestry, uint8_t class_id, char gender, const char *const *taken, int n_taken, Rng *rng, char *out) {
  char n[128], k1[128], k2[128];
  int i, t;
  n[0] = 0;
  for (i = 0; i < 60; i++) {
    int clash = 0;
    raw_name(ancestry, class_id, gender, rng, n);
    if (strlen(n) > NAME_MAX) continue;
    name_key(n, k1);
    for (t = 0; t < n_taken && !clash; t++) {
      name_key(taken[t], k2);
      if (!strcmp(k1, k2)) clash = 1;
    }
    if (!clash) {
      strcpy(out, n);
      return;
    }
  }
  memcpy(out, n, NAME_MAX);
  out[NAME_MAX] = 0;
}
