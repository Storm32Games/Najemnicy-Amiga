// Kodowanie tekstów dla portu na Amigę: ISO-8859-2 + 32 znaki czcionki "PYŁ 6x8" spoza Latin-2 na kodach 0x80..0x9F
// (w Latin-2 to znaki sterujące, więc są wolne). Wspólne dla gen_headers.ts (teksty gry) i gen_assets.ts (czcionka).
export const SPECIALS = [
  '—', '–', '−', '─', '═', '·', '•', '●', '○', '◐', '◆', '◇', '★', '▶', '►', '◀',
  '▲', '▼', '→', '←', '±', '≤', '…', '„', '”', '“', '″', '’', '‘', '‹', '›', '«',
] as const;
// » nie mieści się w 0x80..0x9F - zastępowany przez › (‹ › « już są)
const dec = new TextDecoder('iso-8859-2');
const toByte = new Map<string, number>();
for (let b = 0xa0; b <= 0xff; b++) toByte.set(dec.decode(new Uint8Array([b])), b);
SPECIALS.forEach((c, i) => toByte.set(c, 0x80 + i));
toByte.set('»', toByte.get('›')!);

/** Bajt znaku w kodowaniu portu albo undefined (brak w czcionce i w Latin-2). */
export function byteOf(ch: string): number | undefined {
  const c = ch.codePointAt(0)!;
  if (c >= 32 && c < 127) return c;
  return toByte.get(ch);
}
/** Znak dla bajtu (do czcionki). */
export function charOf(b: number): string {
  if (b >= 0x80 && b < 0xa0) return SPECIALS[b - 0x80];
  return dec.decode(new Uint8Array([b]));
}
/** Literał C (ósemkowe escape'y dla bajtów > 127). */
export function cLiteral(s: string, onMissing: (ch: string) => string = (ch) => {
  throw new Error(`Znak bez kodu: "${ch}" w: ${s}`);
}): string {
  let out = '"';
  for (const ch of s) {
    const b = byteOf(ch);
    if (ch === '"' || ch === '\\') out += '\\' + ch;
    else if (ch === '\n') out += '\\n';
    else if (b === undefined) out += onMissing(ch);
    else if (b < 127) out += ch;
    else out += '\\' + b.toString(8).padStart(3, '0');
  }
  return out + '"';
}
