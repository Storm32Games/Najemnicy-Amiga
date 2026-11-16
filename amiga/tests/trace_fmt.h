/* Wspólny format śladów (C <-> TS, tools/amiga/trace_fmt.ts). */
#ifndef TRACE_FMT_H
#define TRACE_FMT_H
#include <stdio.h>
#include "../src/core/rules.h"

typedef const char *(*LabelFn)(const Character *ch);
void print_snap(FILE *f, const char *label, const Character *ch);
void print_res(FILE *f, const ActionResult *r, LabelFn L);
void dice_str(char *buf, Dice d);

#endif
