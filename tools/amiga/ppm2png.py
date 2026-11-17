#!/usr/bin/env python3
"""PPM -> PNG (zrzuty z amiga/build/gl_host). Użycie: ppm2png.py plik.ppm [...]"""
import sys
from PIL import Image
for p in sys.argv[1:]:
    Image.open(p).save(p[:-4] + '.png')
    print(p[:-4] + '.png')
