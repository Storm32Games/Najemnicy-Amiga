#!/usr/bin/env python3
"""Pakuje wypieczone tekstury (amiga/data/bake/<cel>/, z tools/amiga/bake_scenes.ts) do plików .ntx dla portu na Amigę
i generuje tablice animacji tła (okna, ptaki, promienie) w amiga/src/data/scenes.{h,c}.

Format .ntx (big-endian, jak na 68k): "NTX1", u16 w, u16 h, u16 n (kolory palety, <= 256), n * RGBA,
potem indeksy pikseli w RLE: bajt c < 128 -> c + 1 bajtów dosłownie; c >= 128 -> powtórz następny bajt (c - 125) razy.
"NTX2": to samo, ale indeksy w LZ jak klatka .nta (niżej) - dla obrazów z drobnym ditheringiem (mapa regionu).
Format .nta (animacja, np. wybuch z fx/NukeArt.ts): "NTA1", u16 w, h, n (klatki), ms (na klatkę), t0 (ms planszy
pierwszej klatki), u16 kolory, paleta RGBA (wspólna), potem n * (u32 długość, strumień LZ indeksów). LZ: bajt c < 128 ->
c + 1 bajtów dosłownie; c >= 128 -> kopia (c - 125) bajtów z odległości u24 (big-endian) wstecz - odległość może sięgać
do poprzedniej klatki (bufor poprzedniej + bieżącej), więc niezmienione piksele kosztują 4 bajty na 130.
Uruchom: python3 tools/amiga/pack_scenes.py
"""
import json
import re
import math
import os
import struct
import sys

from PIL import Image

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..')
BAKE = os.path.join(ROOT, 'amiga', 'data', 'bake')
OUT = os.path.join(ROOT, 'amiga', 'gfx')
SRC = os.path.join(ROOT, 'amiga', 'src', 'data')


def js_round(x):
    return math.floor(x + 0.5)


def rle(idx):
    out = bytearray()
    i, n = 0, len(idx)
    lit = bytearray()

    def flush():
        nonlocal lit
        while lit:
            chunk = lit[:128]
            out.append(len(chunk) - 1)
            out.extend(chunk)
            lit = lit[128:]

    while i < n:
        j = i
        while j < n and j - i < 130 and idx[j] == idx[i]:
            j += 1
        if j - i >= 3:
            flush()
            out.append(j - i + 125)
            out.append(idx[i])
            i = j
        else:
            lit.append(idx[i])
            i += 1
    flush()
    return bytes(out)


def to_indexed(im):
    """RGBA -> (paleta, indeksy). Przezroczyste piksele -> jeden kolor (0,0,0,0). > 256 kolorów: kwantyzacja."""
    im = im.convert('RGBA')
    px = [p if p[3] else (0, 0, 0, 0) for p in im.get_flattened_data()]
    count = {}
    for p in px:
        count[p] = count.get(p, 0) + 1
    if len(count) > 320:
        # dużo kolorów (arkusze postaci): kwantyzacja median cut po RGB; alfa zostaje (zwykle 0 albo 255), półprzezroczyste
        # piksele dostają kolor z palety najbliższy ich RGB
        rgb = im.convert('RGB').quantize(255, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
        pal_rgb = rgb.getpalette()[:255 * 3]
        q = rgb.tobytes()
        px = [(0, 0, 0, 0) if p[3] == 0 else (pal_rgb[q[i] * 3], pal_rgb[q[i] * 3 + 1], pal_rgb[q[i] * 3 + 2], p[3]) for i, p in enumerate(px)]
        count = {}
        for p in px:
            count[p] = count.get(p, 0) + 1
    remap = {}
    # > 256 kolorów: najrzadszy kolor -> najbliższy z pozostałych (zwykle kilka kolorów z winiety / poświaty)
    while len(count) > 256:
        rare = min(count, key=lambda c: (count[c], c))
        n = count.pop(rare)
        near = min(count, key=lambda c: sum((a - b) ** 2 for a, b in zip(c, rare)))
        count[near] += n
        for k, v in list(remap.items()):
            if v == rare:
                remap[k] = near
        remap[rare] = near
    if remap:
        px = [remap.get(p, p) for p in px]
    cols = sorted(set(px))
    pal = {c: i for i, c in enumerate(cols)}
    return cols, bytes(pal[p] for p in px)


def ntx_bytes(im):
    pal, idx = to_indexed(im)
    head = struct.pack('>HHH', im.width, im.height, len(pal)) + b''.join(bytes(c) for c in pal)
    a, b = rle(idx), lz_frame(b'', idx)
    # NTX1 = RLE, NTX2 = LZ (jak klatki .nta, bez poprzedniej klatki) - mniejszy wygrywa
    return ((b'NTX1' + head + a) if len(a) <= len(b) else (b'NTX2' + head + b)), pal


def write_library(name, entries):
    """Biblioteka .ntl: "NTL1", u16 n, n * (u8 długość klucza, klucz, u16 w, h, i16 ax, ay, u32 offset, u32 rozmiar),
    potem obrazy jako pliki .ntx (offset od początku pliku). Klucze posortowane (wyszukiwanie binarne w C)."""
    entries = sorted(entries, key=lambda e: e[0])
    blobs = [ntx_bytes(im)[0] for _, im, _, _ in entries]
    head_len = 6 + sum(1 + len(k.encode()) + 16 for k, _, _, _ in entries)
    out = bytearray(b'NTL1' + struct.pack('>H', len(entries)))
    off = head_len
    for (k, im, ax, ay), blob in zip(entries, blobs):
        kb = k.encode()
        out += bytes([len(kb)]) + kb + struct.pack('>HHhhII', im.width, im.height, ax, ay, off, len(blob))
        off += len(blob)
    for blob in blobs:
        out += blob
    with open(os.path.join(OUT, name + '.ntl'), 'wb') as f:
        f.write(out)
    print(f'  {name}.ntl {len(entries)} obrazków, {len(out)} B')


def write_ntx(name, im):
    data, pal = ntx_bytes(im)
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, name + '.ntx'), 'wb') as f:
        f.write(data)
    print(f'  {name}.ntx {im.width}x{im.height} {len(pal)} kolorów, {len(data)} B')


def load(target, key):
    # nazwy plików jak w bake_scenes.ts: znaki spoza [a-zA-Z0-9_@.-] -> '_'
    return Image.open(os.path.join(BAKE, target, re.sub(r'[^a-zA-Z0-9_@.-]', '_', key) + '.png')).convert('RGBA')


# ------------------------------------------------------------------ lcg z fx/Painter.ts
def lcg(seed):
    s = max(1, math.floor(seed)) % 2147483647

    def r():
        nonlocal s
        s = (s * 16807) % 2147483647
        return s / 2147483647
    return r


TICK_HZ = 50
RECRUIT_KEYS = ['hak', 'sowa', 'igla', 'lut', 'szczurek', 'bizon', 'kruk', 'plesn', 'iskra', 'grzmot', 'szept', 'zgrzyt', 'mur',
                'retorta', 'aksamit', 'zero']   # kolejność RECRUIT_DEFS (gamedata.c)


def ang_q8(rad_per_sec):
    return js_round(((rad_per_sec * 256) / (2 * math.pi) / TICK_HZ) * 256)


def ang(rad):
    return js_round((rad * 256) / (2 * math.pi)) & 255



# ------------------------------------------------------------------ animacja .nta
def lz_frame(prev, cur):
    """Strumień LZ klatki `cur` (bytes) względem `prev` (bytes tej samej długości albo b'')."""
    n = len(cur)
    buf = prev + cur
    base = len(prev)
    out = bytearray()
    lit = bytearray()
    last = {}

    def flush():
        nonlocal lit
        while lit:
            chunk = lit[:128]
            out.append(len(chunk) - 1)
            out.extend(chunk)
            lit = lit[128:]

    i = 0
    while i < n:
        p = base + i
        best_len, best_off = 0, 0
        cands = []
        if prev:
            cands.append(p - n)          # ten sam piksel w poprzedniej klatce
        key = buf[p:p + 4]
        if len(key) == 4 and key in last:
            cands.append(last[key])
        if p > 0:
            cands.append(p - 1)
        for c in cands:
            if c < 0 or c >= p:
                continue
            ln = 0
            while ln < 130 and i + ln < n and buf[c + ln] == buf[p + ln]:
                ln += 1
            if ln > best_len:
                best_len, best_off = ln, p - c
        if len(key) == 4:
            last[key] = p
        if best_len >= 4:
            flush()
            out.append(best_len + 125)
            out += struct.pack('>I', best_off)[1:]
            for k in range(1, best_len):
                kk = buf[p + k:p + k + 4]
                if len(kk) == 4:
                    last[kk] = p + k
            i += best_len
        else:
            lit.append(cur[i])
            i += 1
    flush()
    return bytes(out)


def write_nta(name, frames, ms, t0):
    w, h = frames[0].size
    mont = Image.new('RGB', (w, h * len(frames)))
    for i, f in enumerate(frames):
        mont.paste(f.convert('RGB'), (0, i * h))
    q = mont.quantize(256, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
    pal = q.getpalette()[:256 * 3]
    data = bytearray(b'NTA1' + struct.pack('>HHHHHH', w, h, len(frames), ms, t0, 256))
    for i in range(256):
        data += bytes(pal[i * 3:i * 3 + 3]) + b'\xff'
    prev = b''
    raw = q.tobytes()
    for i in range(len(frames)):
        cur = raw[i * w * h:(i + 1) * w * h]
        z = lz_frame(prev, cur)
        data += struct.pack('>I', len(z)) + z
        prev = cur
    with open(os.path.join(OUT, name + '.nta'), 'wb') as f:
        f.write(data)
    print(f'  {name}.nta {w}x{h} x {len(frames)} klatek, {len(data)} B')


# ------------------------------------------------------------------ efekty tła (fx/Painter.ts) liczone na hoście
def windows(spots, seed):
    r = lcg(seed)
    out = []
    for x, y in spots:
        ph = r() * 100
        sp = 0.2 + r() * 0.6
        out.append((x, y, ang_q8(sp), ang_q8(sp * 3.1), ang(ph), ang(ph * 2)))
    return out


def birds(n, box, seed, d=1):
    r = lcg(seed)
    bx, by, bw, bh = box
    lx, ly = bx + r() * bw * 0.6, by + r() * bh * 0.5
    out = []
    for i in range(n):
        x = lx - i * (6 + r() * 6) * d
        y = ly + (1 if i % 2 else -1) * i * (2 + r() * 2)
        v = 9 + r() * 3
        ph = r() * 6.28
        s = 2 if r() < 0.3 else 1
        # x Q8, v w px/s Q8, faza skrzydeł t*7+ph w Q8, faza falowania
        out.append((js_round(x * 256), js_round(y), js_round(v * 256), js_round(ph * 256), ang(ph), s))
    return out


def rays(n, a0, a1, ln, seed):
    r = lcg(seed)
    out = []
    for i in range(n):
        a = a0 + ((a1 - a0) * (i + r() * 0.6)) / n
        w = 0.02 + r() * 0.05
        L = ln * (0.6 + r() * 0.4)
        ph = r() * 6.28
        pts = []
        for e in (a - w, a + w):
            # koniec promienia i przesunięcie przy kołysaniu (0.02 rad * sin = 1) w 1/16 px
            pts += [js_round(math.cos(e) * L * 16), js_round(math.sin(e) * L * 16),
                    js_round(-math.sin(e) * L * 0.02 * 16), js_round(math.cos(e) * L * 0.02 * 16)]
        out.append(tuple(pts) + (ang(ph),))
    return out


def bg_spots(target, layer):
    """Migające okna (Windows) z obiektów sceny: prostokąty 1x2 koloru lit, x względem spoczynku warstwy `layer`."""
    objs = json.load(open(os.path.join(BAKE, target, 'scene.json')))['objects']
    dx = next(o['x'] for o in objs if o.get('tex') == layer) + 24
    return [(round(o['x'] - dx), round(o['y'])) for o in objs
            if o['type'] == 'Rectangle' and o.get('fill') == 0xffbe5a and o['w'] == 1 and o['h'] == 2]


def scene_objs(target):
    return json.load(open(os.path.join(BAKE, target, 'scene.json')))


def idle_seq(target, key):
    a = next(a for a in scene_objs(target)['anims'] if a['key'] == key)
    return [(int(f[6:]), d) for f, d in a['frames']]


def unit_sheet(name, target, keys):
    """Klatki f_idle0..4 kolejnych postaci w wierszach jednego arkusza."""
    man = json.load(open(os.path.join(BAKE, target, 'manifest.json')))
    fw, fh = man[keys[0]]['frames']['f_idle0'][2:]
    sheet = Image.new('RGBA', (fw * 5, fh * len(keys)))
    for row, key in enumerate(keys):
        src = load(target, key)
        for f in range(5):
            x, y, w, h = man[key]['frames'][f'f_idle{f}']
            sheet.paste(src.crop((x, y, x + w, y + h)), (f * fw, row * fh))
    write_ntx(name, sheet)
    return fw, fh


def sprites(target, prefix):
    """Postacie (Sprite) z obiektów sceny: (wiersz arkusza, x, y, flip, głębia), klucze tekstur w kolejności wierszy."""
    keys, out = [], []
    for o in scene_objs(target)['objects']:
        if o['type'] != 'Sprite' or not o['tex'].startswith(prefix):
            continue
        if o['tex'] not in keys:
            keys.append(o['tex'])
        out.append((keys.index(o['tex']), round(o['x']), round(o['y']), 1 if o.get('flip') else 0, o['d']))
    return keys, out


def build():
    T = {}
    print('title:')
    for k in ['title_sky', 'title_clouds', 'title_far', 'title_mid', 'title_ground', 'title_logo', 'title_sub']:
        write_ntx(k, load('title', k))
    unit_sheet('title_units', 'title', ['unit_rec_sowa', 'unit_rec_hak'])
    T['idle'] = idle_seq('title', 'rec_sowa_f_idle')
    # backdrop 'title': seed 5, orb (196, 150)
    T['bg'] = {
        'TITLE': dict(win=windows(bg_spots('title', 'title_mid'), 5 + 9), bird=birds(5, (0, 40, 480, 60), 5 + 4),
                      ray=rays(9, -math.pi * 0.95, -math.pi * 0.05, 360, 5), ox=196, oy=150, rc=0xffc070, ra=35,
                      bc=0x1a0c12, bd=1, bx=0, bw=480),
        'CREW': dict(win=windows(bg_spots('intro6', 'intro_crew_mid'), 40 + 9), bird=birds(5, (0, 40, 480, 60), 40 + 4),
                     ray=rays(9, -math.pi * 0.95, -math.pi * 0.05, 360, 40), ox=240, oy=148, rc=0xffc070, ra=35,
                     bc=0x1a0c12, bd=1, bx=0, bw=480),
        'NOMADS': dict(win=[], bird=[], ray=rays(10, -math.pi * 0.98, -math.pi * 0.02, 380, 4), ox=150, oy=128,
                       rc=0xffd090, ra=32, bc=0, bd=1, bx=0, bw=480),
        'RUINS': dict(win=[], bird=birds(4, (0, 30, 480, 40), 7, -1), ray=[], ox=0, oy=0, rc=0, ra=0,
                      bc=0x0a100c, bd=-1, bx=0, bw=480),
    }

    print('recruit:')
    for k in ['recruit_sky', 'recruit_clouds', 'recruit_far', 'recruit_mid', 'recruit_ground']:
        write_ntx(k, load('recruit1', k))
    T['bg']['RECRUIT'] = dict(win=windows(bg_spots('recruit1', 'recruit_mid'), 9 + 9), bird=birds(5, (0, 40, 480, 60), 9 + 4),
                              ray=rays(9, -math.pi * 0.95, -math.pi * 0.05, 360, 9), ox=452, oy=196, rc=0xffc070, ra=35,
                              bc=0x1a0c12, bd=1, bx=0, bw=480)
    # portrety (kolejność RECRUIT_DEFS): 30 px w wierszach y 0 i 30, 26 px w wierszach y 60 i 86, po 8 w wierszu
    atlas = Image.new('RGBA', (256, 112))
    for i, key in enumerate(RECRUIT_KEYS):
        for size, y0 in ((30, 0), (26, 60)):
            src = None
            for t in ('recruit1', 'recruit2', 'recruit3', 'recruit4'):
                f = os.path.join(BAKE, t, f'porpl_{key}_{size}@1.png')
                if os.path.exists(f):
                    src = Image.open(f).convert('RGBA')
                    break
            assert src is not None, (key, size)
            atlas.paste(src, ((i % 8) * size, y0 + (i // 8) * size))
    write_ntx('recruit_portraits', atlas)
    # całe postacie: 8 kierunków (SPRITE_DIRS) 64x64 w arkuszu 4 x 2 na rekruta
    dirs = ['south', 'south-east', 'east', 'north-east', 'north', 'north-west', 'west', 'south-west']
    for key in RECRUIT_KEYS:
        sheet = Image.new('RGBA', (256, 128))
        for d, name in enumerate(dirs):
            sheet.paste(Image.open(os.path.join(ROOT, 'src', 'assets', 'units', key, name + '.png')).convert('RGBA'), ((d % 4) * 64, (d // 4) * 64))
        write_ntx('spr_' + key, sheet)

    print('hub:')
    for k in ['hub_sky', 'hub_clouds', 'hub_far', 'hub_mid', 'hub_ground']:
        write_ntx(k, load('hub', k))
    T['bg']['HUB'] = dict(win=windows(bg_spots('hub', 'hub_mid'), 2 + 9), bird=birds(5, (0, 40, 480, 60), 2 + 4),
                          ray=rays(9, -math.pi * 0.95, -math.pi * 0.05, 360, 2), ox=430, oy=190, rc=0xffc070, ra=35,
                          bc=0x1a0c12, bd=1, bx=0, bw=480)
    man = json.load(open(os.path.join(BAKE, 'hub', 'manifest.json')))
    def frames5(key, fw, fh, dst, x0, y0):
        src = load('hub', key)
        for f in range(5):
            x, y, w, h = man[key]['frames'][f'f_idle{f}']
            dst.paste(src.crop((x, y, x + w, y + h)), (x0 + f * fw, y0))
    # mieszkańcy (24x32): Lecznica, Tablica zleceń, Handlarz Nomadów, Mechanik, Wartownik
    npc = Image.new('RGBA', (120, 160))
    for i, k in enumerate(['Lecznica', 'Tablica zleceń', 'Handlarz Nomadów', 'Mechanik', 'Wartownik']):
        frames5('unit_npc_' + k, 24, 32, npc, 0, i * 32)
    write_ntx('hub_npc', npc)
    # drużyna: wszyscy rekruci (32x36), 7 w bloku 256 px: y = (i / 7) * 256 + (i % 7) * 36
    party = Image.new('RGBA', (160, 256 * 2 + 2 * 36))
    for i, k in enumerate(RECRUIT_KEYS):
        frames5('unit_pc_' + k, 32, 36, party, 0, (i // 7) * 256 + (i % 7) * 36)
    write_ntx('hub_party', party)
    # portrety: 40 px po 6 w wierszu od y 0, 30 px po 8 od y 120, 29 px po 8 od y 180
    por = Image.new('RGBA', (256, 256))
    for i, k in enumerate(RECRUIT_KEYS):
        for size, per, y0 in ((40, 6, 0), (30, 8, 120), (29, 8, 180)):
            por.paste(load('hub', f'bk_p{size}_{k}'), ((i % per) * size, y0 + (i // per) * size))
    write_ntx('portraits', por)
    # ikony (kolejność ITEM_DEFS / ABILITY_DEFS): przedmioty 10 px po 25 w wierszu od y 0, 11 px po 23 od y 30,
    # zdolności 7 px po 36 od y 63
    c = open(os.path.join(SRC, 'gamedata.c')).read()
    def keys(table):
        a = c.index(table)
        return re.findall(r'^\s*\{"([a-z0-9_]+)", "', c[a:c.index('};', a)], re.M)
    icons = Image.new('RGBA', (256, 128))
    for i, k in enumerate(keys('const ItemDef ITEM_DEFS')):
        for size, per, y0 in ((10, 25, 0), (11, 23, 30)):
            f = os.path.join(BAKE, 'hub', f'bk_i{size}_{k}.png')
            if os.path.exists(f):
                icons.paste(Image.open(f).convert('RGBA'), ((i % per) * size, y0 + (i // per) * size))
    for i, k in enumerate(keys('const AbilityDef ABILITY_DEFS')):
        icons.paste(load('hub', f'bk_a7_{k}'), ((i % 36) * 7, 63 + (i // 36) * 7))
    write_ntx('icons', icons)

    print('travel:')
    write_ntx('travel_map', load('travel', 'travel_map'))
    tsc = scene_objs('travel')
    tman = json.load(open(os.path.join(BAKE, 'travel', 'manifest.json')))
    sheets = {k: load('travel', k) for k in ('travel_occ0', 'travel_occ1')}
    occ = [o for o in tsc['objects'] if o.get('tex', '').startswith('travel_occ')]
    # przepakowanie klatek do atlasów 256x256 (półki od najwyższych), kolejność rysowania jak w scenie
    frames = {}
    for o in occ:
        frames.setdefault((o['tex'], o['frame']), tman[o['tex']]['frames'][o['frame']])
    order = sorted(frames, key=lambda k: -frames[k][3])
    atlases, place_ = [], {}
    cur = None
    x = y = shelf = 0
    for k in order:
        fx, fy, fw, fh = frames[k]
        if cur is None or x + fw > 256:
            x, y, shelf = 0, y + shelf, 0
        if cur is None or y + fh > 256:
            cur = Image.new('RGBA', (256, 256))
            atlases.append(cur)
            x = y = shelf = 0
        cur.paste(sheets[k[0]].crop((fx, fy, fx + fw, fy + fh)), (x, y))
        place_[k] = (len(atlases) - 1, x, y, fw, fh)
        x += fw
        shelf = max(shelf, fh)
    for i, a in enumerate(atlases):
        write_ntx(f'travel_occ{i}', a)
    def dq(d):
        return int(round((d - 5) * 65536))
    T['travel_occ'] = [(place_[(o['tex'], o['frame'])], round(o['x']), round(o['y']), dq(o['d'])) for o in occ]
    T['travel_atlases'] = len(atlases)
    ex = tsc['extra']
    T['travel_blocks'] = [(b['x0'], b['y0'], b['x1'], b['y1'], js_round(b['box']['x0'] * 256), js_round(b['box']['x1'] * 256),
                           js_round(b['box']['z0'] * 256), js_round(b['box']['z1'] * 256), dq(b['depth'])) for b in ex['blocks']]
    def kd(key):
        return dq(5 + min(0.999, max(0, (key + 60) / 120)))
    T['travel_fires'] = [(round(f['x']), round(f['y']), js_round(f['size'] * 256), kd(f['key']) + 33) for f in ex['fires']]
    T['travel_beacon'] = (round(ex['beacon']['x']), round(ex['beacon']['y']), kd(ex['beacon']['key']) + 33)
    T['fauna_scale'] = [js_round(f['scale'] * 256) for f in ex['fauna']]
    fa = Image.new('RGBA', (144, 256))
    for i in range(8):
        src = load('travel', f'bk_fauna_{i}')
        fr = tman[f'bk_fauna_{i}']['frames']
        for j, name in enumerate(['f_idle0', 'f_idle1', 'f_walk0', 'f_walk1', 'f_walk2', 'f_walk3']):
            fx, fy, fw, fh = fr[name]
            fa.paste(src.crop((fx, fy, fx + fw, fy + fh)), (j * 24, i * 32))
    write_ntx('travel_fauna', fa)
    # chód drużyny: 8 klatek d_<kierunek>_walk w wierszu, kierunki jak dirOfVector (E, SE, S, SW, W, NW, N, NE),
    # 7 kierunków w bloku 256 px: y = (d / 7) * 256 + (d % 7) * 36
    hman = json.load(open(os.path.join(BAKE, 'hub', 'manifest.json')))
    for k in RECRUIT_KEYS:
        src = load('hub', 'unit_pc_' + k)
        fr = hman['unit_pc_' + k]['frames']
        sh = Image.new('RGBA', (256, 256 + 36))
        for d, dn in enumerate(['east', 'south-east', 'south', 'south-west', 'west', 'north-west', 'north', 'north-east']):
            for f in range(8):
                fx, fy, fw, fh = fr[f'd_{dn}_walk{f}']
                sh.paste(src.crop((fx, fy, fx + fw, fy + fh)), (f * 32, (d // 7) * 256 + (d % 7) * 36))
        write_ntx('walk_' + k, sh)

    print('misja (biblioteka):')
    lib = json.load(open(os.path.join(BAKE, 'tiles', 'library.json')))
    groups = {}
    import base64
    for e in lib:
        im = Image.frombytes('RGBA', (e['w'], e['h']), base64.b64decode(e['data']))
        groups.setdefault(e['group'], []).append((e['key'], im, e['ax'], e['ay']))
    for g, ents in groups.items():
        write_library('lib_' + g, ents)
    T['lib_frames'] = scene_objs('tiles')['extra']['frames']
    # arkusze postaci jako biblioteki klatek (klucz = nazwa klatki z ArtBook / SpriteUnits): drużyna (z hub),
    # wrogowie (tiles); ekran misji wczytuje tylko potrzebne animacje do atlasu
    def unit_lib(target, key, name):
        man = json.load(open(os.path.join(BAKE, target, 'manifest.json')))
        sheet = load(target, key)
        ents = []
        for fn, (x, y, w, h) in man[key]['frames'].items():
            ents.append((fn, sheet.crop((x, y, x + w, y + h)), 0, 0))
        write_library(name, ents)
    for k in RECRUIT_KEYS:
        unit_lib('hub', 'unit_pc_' + k, 'unit_' + k)
    tman = json.load(open(os.path.join(BAKE, 'tiles', 'manifest.json')))
    for k in tman:
        if k.startswith('unit_en_'):
            unit_lib('tiles', k, k)

    print('intro:')
    layers = {
        'intro1': ['intro_bomb_pall'],
        'intro2': ['intro_ruins', 'intro_ruins_fog1', 'intro_ruins_fog2'],
        'intro3': ['intro_raiders_sky', 'intro_raiders_smoke', 'intro_raiders_far', 'intro_raiders_camp', 'intro_raiders_glow'],
        'intro4': ['intro_nomads_sky', 'intro_nomads_clouds', 'intro_nomads_far', 'intro_nomads_dunes', 'intro_nomads_near'],
        'intro5': ['intro_haven_sky', 'intro_haven_clouds', 'intro_haven_far', 'intro_haven_fort'],
        'intro6': ['intro_crew_sky', 'intro_crew_clouds', 'intro_crew_far', 'intro_crew_mid', 'intro_crew_ground'],
    }
    for t, ks in layers.items():
        for k in ks:
            write_ntx(k, load(t, k))
    T['units'] = {}
    for t, name, prefix in [('intro3', 'intro_raiders_units', 'unit_intro_raider'), ('intro5', 'intro_haven_units', 'unit_intro_haven'),
                            ('intro6', 'intro_crew_units', 'unit_rec_')]:
        keys, sp = sprites(t, prefix)
        order = sorted(keys)
        sp = [(order.index(keys[r]), x, y, fl, d) for r, x, y, fl, d in sp]
        fw, fh = unit_sheet(name, t, order)
        T['units'][name.upper()] = (fw, fh, sorted(sp, key=lambda u: (u[4], u[0])))
        for k in order:
            assert idle_seq(t, k[5:] + '_f_idle') == T['idle'], k
    # oczy w ruinach: pary 1x1 (zielone / czerwone) - lewe x, prawe x, y, kolor
    objs = scene_objs('intro2')['objects']
    dots = [o for o in objs if o['type'] == 'Rectangle' and o['w'] == 1 and o['h'] == 1 and o['fill'] in (0xb8ff40, 0xff3a20)]
    T['eyes'] = [(js_round(dots[i]['x'] - 0.5), js_round(dots[i + 1]['x'] - 0.5), js_round(dots[i]['y'] - 0.5), dots[i]['fill'])
                 for i in range(0, len(dots), 2)]
    # wybuch: klatki co 100 ms od t = 2.5 s planszy
    fdir = os.path.join(BAKE, 'intro1', 'frames')
    ts = json.load(open(os.path.join(fdir, 'index.json')))
    if '--no-anim' not in sys.argv:
        write_nta('intro_bomb', [Image.open(os.path.join(fdir, '%03d.png' % i)) for i in range(len(ts))], 100, js_round(ts[0] * 1000))
    return T


def gen_c(T):
    h = ["""/* Wygenerowane przez tools/amiga/pack_scenes.py - nie edytować. Efekty tła (fx/Painter.ts) i rozstawienie postaci. */
#ifndef SCENES_H
#define SCENES_H
#include <stdint.h>

typedef struct { int16_t x, y; int16_t w1, w2; uint8_t ph1, ph2; } BgWindow;   /* migające okno (Windows) */
typedef struct { int32_t x_q8; int16_t y; int16_t v_q8; int16_t ph_q8; uint8_t ph; uint8_t s; } BgBird;
/* promień: dwa końce (x, y, dx, dy w 1/16 px; d* = przesunięcie przy kołysaniu sin = 1), faza pulsowania */
typedef struct { int16_t e[8]; uint8_t ph; } BgRay;
typedef struct {
  const BgWindow *win; int nwin;
  const BgBird *bird; int nbird;
  const BgRay *ray; int nray;
  int16_t orb_x, orb_y; uint32_t ray_col; int16_t ray_milli;   /* krycie promieni w 1/1000 */
  uint32_t bird_col; int8_t bird_dir; int16_t bird_x, bird_w;
} BgFx;
typedef struct { uint8_t frame; uint16_t ms; } AnimStep;
/* postać: wiersz arkusza, stopy (x, y), lustro, głębia (kolejność rysowania; ułamki z gry x10) */
typedef struct { uint8_t row; int16_t x, y; uint8_t flip; uint8_t depth10; } UnitPlace;
typedef struct { int fw, fh, n; const UnitPlace *u; } UnitSet;
typedef struct { int16_t xa, xb, y; uint32_t col; } EyePair;

#define W_RAY_SWAY %d
#define W_RAY_PULSE %d
#define W_BIRD %d
#define UNIT_IDLE_STEPS %d
extern const AnimStep UNIT_IDLE[UNIT_IDLE_STEPS];
""" % (ang_q8(0.15), ang_q8(0.6), ang_q8(0.8), len(T['idle']))]
    c = ['/* Wygenerowane przez tools/amiga/pack_scenes.py - nie edytować. */\n#include "scenes.h"\n\n']
    c.append('const AnimStep UNIT_IDLE[UNIT_IDLE_STEPS] = {' + ', '.join('{%d, %d}' % s for s in T['idle']) + '};\n')
    for name, b in T['bg'].items():
        h.append('extern const BgFx BG_%s;\n' % name)
        if b['win']:
            c.append('static const BgWindow %s_WIN[] = {\n' % name + ''.join('  {%d, %d, %d, %d, %d, %d},\n' % w for w in b['win']) + '};\n')
        if b['bird']:
            c.append('static const BgBird %s_BIRD[] = {\n' % name + ''.join('  {%d, %d, %d, %d, %d, %d},\n' % x for x in b['bird']) + '};\n')
        if b['ray']:
            c.append('static const BgRay %s_RAY[] = {\n' % name + ''.join('  {{%s}, %d},\n' % (', '.join(map(str, r[:8])), r[8]) for r in b['ray']) + '};\n')
        ref = lambda k, s: ('%s_%s, %d' % (name, s, len(b[k]))) if b[k] else '0, 0'
        c.append('const BgFx BG_%s = {%s, %s, %s, %d, %d, 0x%06x, %d, 0x%06x, %d, %d, %d};\n\n' % (
            name, ref('win', 'WIN'), ref('bird', 'BIRD'), ref('ray', 'RAY'), b['ox'], b['oy'], b['rc'], b['ra'], b['bc'], b['bd'], b['bx'], b['bw']))
    for name, (fw, fh, sp) in T['units'].items():
        h.append('extern const UnitSet %s;\n' % name)
        c.append('static const UnitPlace %s_U[] = {%s};\n' % (name, ', '.join('{%d, %d, %d, %d, %d}' % (r, x, y, fl, round(d * 10)) for r, x, y, fl, d in sp)))
        c.append('const UnitSet %s = {%d, %d, %d, %s_U};\n' % (name, fw, fh, len(sp), name))
    if 'travel_occ' in T:
        h.append('''
/* mapa regionu: elementy zasłaniające (atlas, wycinek, pozycja na mapie, głębia (d - 5) * 65536), budynki do "przed / za"
 * (prostokąt na mapie, podstawa w świecie Q8, głębia), ogniska (x, y, rozmiar Q8, głębia), latarnia */
typedef struct { uint8_t atlas, sx, sy, w, h; int16_t x, y; int32_t depth; } TravelOcc;
typedef struct { int16_t x0, y0, x1, y1; int32_t bx0, bx1, bz0, bz1, depth; } TravelBlock;
typedef struct { int16_t x, y; int16_t size_q8; int32_t depth; } TravelFire;
#define TRAVEL_ATLASES %d
#define TRAVEL_OCC_N %d
#define TRAVEL_BLOCK_N %d
#define TRAVEL_FIRE_N %d
extern const TravelOcc TRAVEL_OCC[TRAVEL_OCC_N];
extern const TravelBlock TRAVEL_BLOCK[TRAVEL_BLOCK_N];
extern const TravelFire TRAVEL_FIRE[TRAVEL_FIRE_N];
extern const TravelFire TRAVEL_BEACON;
extern const int16_t FAUNA_SCALE_Q8[8];
''' % (T['travel_atlases'], len(T['travel_occ']), len(T['travel_blocks']), len(T['travel_fires'])))
        c.append('const TravelOcc TRAVEL_OCC[TRAVEL_OCC_N] = {\n' + ''.join('  {%d, %d, %d, %d, %d, %d, %d, %d},\n' % (p[0], p[1], p[2], p[3], p[4], x, y, d) for p, x, y, d in T['travel_occ']) + '};\n')
        c.append('const TravelBlock TRAVEL_BLOCK[TRAVEL_BLOCK_N] = {\n' + ''.join('  {%d, %d, %d, %d, %d, %d, %d, %d, %d},\n' % b for b in T['travel_blocks']) + '};\n')
        c.append('const TravelFire TRAVEL_FIRE[TRAVEL_FIRE_N] = {' + ', '.join('{%d, %d, %d, %d}' % f for f in T['travel_fires']) + '};\n')
        c.append('const TravelFire TRAVEL_BEACON = {%d, %d, 0, %d};\n' % T['travel_beacon'])
        c.append('const int16_t FAUNA_SCALE_Q8[8] = {%s};\n' % ', '.join(map(str, T['fauna_scale'])))
    h.append('#define RUIN_EYES %d\nextern const EyePair RUIN_EYE[RUIN_EYES];\n\n#endif\n' % len(T['eyes']))
    c.append('const EyePair RUIN_EYE[RUIN_EYES] = {%s};\n' % ', '.join('{%d, %d, %d, 0x%06x}' % e for e in T['eyes']))
    open(os.path.join(SRC, 'scenes.h'), 'w').write(''.join(h))
    open(os.path.join(SRC, 'scenes.c'), 'w').write(''.join(c))
    print('OK: amiga/src/data/scenes.{h,c}')


if __name__ == '__main__':
    gen_c(build())
