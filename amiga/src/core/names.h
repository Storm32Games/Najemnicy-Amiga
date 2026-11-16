/* Generator imion najemników (port src/core/data/names.ts). */
#ifndef NAMES_H
#define NAMES_H

#include "character.h"

/* gender: 'm' / 'f' albo 0 = losowo; out: bufor >= NAME_MAX + 1 */
void generate_name(uint8_t ancestry, uint8_t class_id, char gender, const char *const *taken, int n_taken, Rng *rng, char *out);
void fem_surname(const char *s, char *out);
void name_key(const char *s, char *out);
unsigned char name_lower(unsigned char c); /* małe litery ISO-8859-2 (także polskie) */

#endif
