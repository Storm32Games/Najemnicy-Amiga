// Zasoby graficzne dla portu C: czcionka "PYŁ 6x8" (src/scenes/ui/FontGlyphs.ts) i próbka logo (bake_logo.ts).
// Uruchom: node tools/amiga/gen_assets.ts  ->  amiga/src/data/assets.h + assets.c
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CELL_H, LINE_H, SPACING, TOP, glyph } from '../../src/scenes/ui/FontGlyphs.ts';
import { SPECIALS, charOf } from './charmap.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = join(ROOT, 'amiga', 'src', 'data');
const ROWS = CELL_H - TOP; // wiersze od TOP (-1) do 7

function glyphRow(code: number, bold: boolean): string {
  const ch = code < 32 || code === 127 ? '?' : charOf(code);
  const g = glyph(ch, bold);
  const rows = new Array<number>(ROWS).fill(0);
  for (const [x, y] of g.px) {
    if (x > 7) throw new Error(`glif ${ch} szerszy niż 8 px`);
    rows[y - TOP] |= 1 << x;
  }
  return `{${g.w}, ${g.adv}, {${rows.join(', ')}}}`;
}
const table = (bold: boolean): string => Array.from({ length: 256 }, (_, c) => `  ${glyphRow(c, bold)},`).join('\n');

const logo = readFileSync(join(ROOT, 'amiga', 'data', 'bake', 'logo_sample.rgb'));
const bytes: string[] = [];
for (let i = 0; i < logo.length; i += 24) bytes.push('  ' + Array.from(logo.subarray(i, i + 24)).join(', ') + ',');

writeFileSync(join(OUT, 'assets.h'), `/* Wygenerowane przez tools/amiga/gen_assets.ts. NIE EDYTUJ RĘCZNIE. */
#ifndef ASSETS_H
#define ASSETS_H
#include <stdint.h>

/* Czcionka "PYŁ 6x8": wiersz 0 = y ${TOP} (akcenty wielkich liter), bit x = piksel w kolumnie x.
 * Indeks = bajt: ISO-8859-2, a 0x80..0x9F = znaki spoza Latin-2 (tools/amiga/charmap.ts): ${SPECIALS.map((c, i) => `${(0x80 + i).toString(16)}=${c}`).join(' ')} */
#define FONT_CELL_H ${CELL_H}
#define FONT_LINE_H ${LINE_H}
#define FONT_SPACING ${SPACING}
#define FONT_TOP (${TOP})
#define FONT_ROWS ${ROWS}
typedef struct { int8_t w, adv; uint8_t rows[FONT_ROWS]; } FontGlyph;
extern const FontGlyph FONT_REGULAR[256], FONT_BOLD[256];

/* Logo STORM 32 próbkowane do siatki 160x90 RGB (jak LogoScene.sample w przeglądarce). */
extern const uint8_t LOGO_SAMPLE_RGB[160 * 90 * 3];

#endif
`);
writeFileSync(join(OUT, 'assets.c'), `/* Wygenerowane przez tools/amiga/gen_assets.ts. NIE EDYTUJ RĘCZNIE. */
#include "assets.h"

const FontGlyph FONT_REGULAR[256] = {
${table(false)}
};
const FontGlyph FONT_BOLD[256] = {
${table(true)}
};

const uint8_t LOGO_SAMPLE_RGB[160 * 90 * 3] = {
${bytes.join('\n')}
};
`);
console.log('OK: amiga/src/data/assets.h + assets.c');
