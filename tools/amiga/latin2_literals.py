#!/usr/bin/env python3
"""Zamienia znaki spoza ASCII w literałach C ("..." i '...') na ósemkowe kody portu: ISO-8859-2 + 32 znaki czcionki
spoza Latin-2 na 0x80..0x9F (tools/amiga/charmap.ts). Komentarze zostają w UTF-8. Plik zmieniany w miejscu.
Dzięki temu ekrany pisze się z normalnymi polskimi literami: "Złom" -> "Z\\263om".
Uruchom: python3 tools/amiga/latin2_literals.py amiga/src/app/scr_hub.c [...]
"""
import os
import re
import sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..')
src = open(os.path.join(ROOT, 'tools', 'amiga', 'charmap.ts'), encoding='utf-8').read()
SPECIALS = re.findall(r"'(.)'", src[src.index('SPECIALS = ['):src.index('] as const')])
assert len(SPECIALS) == 32, SPECIALS
CODE = {c: 0x80 + i for i, c in enumerate(SPECIALS)}
CODE['»'] = CODE['›']


def byte_of(ch):
    if ch in CODE:
        return CODE[ch]
    try:
        b = ch.encode('iso-8859-2')
    except UnicodeEncodeError:
        raise SystemExit(f'Znak bez kodu w czcionce: {ch!r} (U+{ord(ch):04x})')
    return b[0]


def convert(text):
    out, i, n = [], 0, len(text)
    while i < n:
        c = text[i]
        if text.startswith('//', i):
            j = text.find('\n', i)
            j = n if j < 0 else j
            out.append(text[i:j])
            i = j
        elif text.startswith('/*', i):
            j = text.find('*/', i + 2)
            j = n if j < 0 else j + 2
            out.append(text[i:j])
            i = j
        elif c in '"\'':
            j = i + 1
            lit = [c]
            while j < n and text[j] != c:
                if text[j] == '\\':
                    lit.append(text[j:j + 2])
                    j += 2
                    continue
                ch = text[j]
                if ord(ch) < 128:
                    lit.append(ch)
                else:
                    # ósemkowo zawsze 3 cyfry - następna cyfra nie zostanie wciągnięta do kodu
                    lit.append('\\%03o' % byte_of(ch))
                j += 1
            lit.append(c)
            out.append(''.join(lit))
            i = j + 1
        else:
            out.append(c)
            i += 1
    return ''.join(out)


if __name__ == '__main__':
    for path in sys.argv[1:]:
        t = open(path, encoding='utf-8').read()
        u = convert(t)
        if u != t:
            open(path, 'w', encoding='utf-8').write(u)
            print('przekodowano:', path)
