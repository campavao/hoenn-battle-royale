#!/usr/bin/env python3
"""Render every outdoor map to a PNG, for the drop painter (POK-314).

    python tools/br/render-maps.py            -> web/painter-maps/<MAP_ID>.png

Cam, painting: "I have to see the actual map sprites to know what I'm painting." So this
draws each map the way the GBA does, from pret's own data: the layout's map.bin says which
metatile stands in each block, the tileset's metatiles.bin says which eight tiles make
that metatile (four below, four above), tiles.png is the 4bpp tile sheet and the sixteen
.pal files are its palettes. Primary tileset: tiles 0..511, metatiles 0..511, palettes
0..5. Secondary: 512.., 512.., 6..12. The top layer's colour 0 is transparent.

No object events, no animation, no player: a still of the ground, one block = 16 px, which
is what the painter lays its grid over. The output directory is gitignored; run this once
on a fresh clone before opening /painter.html.
"""
import json
import os
import re
import struct
import sys

from PIL import Image

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
OUT = os.path.join(ROOT, 'web', 'painter-maps')
TILE = 8
BLOCK = 16


def tileset_dir(name):
    """gTileset_BattleFrontierOutsideEast -> battle_frontier_outside_east."""
    body = name[len('gTileset_'):]
    snake = re.sub(r'(?<!^)(?=[A-Z0-9])', '_', body).lower()
    for kind in ('primary', 'secondary'):
        d = os.path.join(ROOT, 'data', 'tilesets', kind, snake)
        if os.path.isdir(d):
            return d, kind
    raise FileNotFoundError(name)


def load_palette(path):
    lines = open(path, encoding='utf-8').read().split('\n')
    return [tuple(int(v) for v in l.split()) for l in lines[3:19]]


_tilesets = {}


def load_tileset(name):
    if name in _tilesets:
        return _tilesets[name]
    d, kind = tileset_dir(name)
    sheet = Image.open(os.path.join(d, 'tiles.png')).convert('P')
    w, h = sheet.size
    px = sheet.load()
    tiles = []
    for i in range((w // TILE) * (h // TILE)):
        tx, ty = (i % (w // TILE)) * TILE, (i // (w // TILE)) * TILE
        tiles.append([[px[tx + x, ty + y] for x in range(TILE)] for y in range(TILE)])
    raw = open(os.path.join(d, 'metatiles.bin'), 'rb').read()
    metatiles = [struct.unpack('<8H', raw[i:i + 16]) for i in range(0, len(raw), 16)]
    pals = [load_palette(os.path.join(d, 'palettes', f'{i:02d}.pal')) for i in range(16)]
    _tilesets[name] = (tiles, metatiles, pals, kind)
    return _tilesets[name]


def draw_tile(canvas, x0, y0, tile, pal, hflip, vflip, transparent):
    for y in range(TILE):
        row = tile[TILE - 1 - y] if vflip else tile[y]
        for x in range(TILE):
            c = row[TILE - 1 - x] if hflip else row[x]
            if transparent and c == 0:
                continue
            canvas.putpixel((x0 + x, y0 + y), pal[c])


def render(layout):
    primary = load_tileset(layout['primary_tileset'])
    secondary = load_tileset(layout['secondary_tileset'])
    palettes = primary[2][:6] + secondary[2][6:13] + primary[2][13:]
    w, h = layout['width'], layout['height']
    blocks = struct.unpack(f'<{w * h}H', open(os.path.join(ROOT, layout['blockdata_filepath']), 'rb').read()[: w * h * 2])
    img = Image.new('RGB', (w * BLOCK, h * BLOCK), (0, 0, 0))
    for i, block in enumerate(blocks):
        mid = block & 0x3FF
        if mid < 512:
            mt = primary[1][mid] if mid < len(primary[1]) else None
        else:
            mt = secondary[1][mid - 512] if mid - 512 < len(secondary[1]) else None
        if mt is None:
            continue
        bx, by = (i % w) * BLOCK, (i // w) * BLOCK
        for layer in (0, 1):
            for t in range(4):
                entry = mt[layer * 4 + t]
                tid = entry & 0x3FF
                tile = primary[0][tid] if tid < 512 else (secondary[0][tid - 512] if tid - 512 < len(secondary[0]) else None)
                if tile is None:
                    continue
                pal = palettes[(entry >> 12) & 0xF]
                draw_tile(img, bx + (t % 2) * TILE, by + (t // 2) * TILE, tile, pal, entry & 0x400, entry & 0x800, layer == 1)
    return img


def main():
    world = json.load(open(os.path.join(ROOT, 'web', 'src', 'data', 'world.json'), encoding='utf-8'))
    layouts = {l['id']: l for l in json.load(open(os.path.join(ROOT, 'data', 'layouts', 'layouts.json'), encoding='utf-8'))['layouts']}
    os.makedirs(OUT, exist_ok=True)
    done = 0
    for m in world['maps']:
        if not m.get('outdoor'):
            continue
        mp = os.path.join(ROOT, 'data', 'maps', m['id'][len('MAP_'):].title().replace('_', ''), 'map.json')
        # The directory name is the map's CamelCase name; map.json carries the layout id.
        # Find it by id rather than guessing the casing.
        layout_id = None
        for d in os.listdir(os.path.join(ROOT, 'data', 'maps')):
            p = os.path.join(ROOT, 'data', 'maps', d, 'map.json')
            if not os.path.exists(p):
                continue
            j = json.load(open(p, encoding='utf-8'))
            if j['id'] == m['id']:
                layout_id = j['layout']
                break
        if layout_id is None or layout_id not in layouts:
            print(f'{m["id"]}: no layout', file=sys.stderr)
            continue
        render(layouts[layout_id]).save(os.path.join(OUT, f'{m["id"]}.png'))
        done += 1
    print(f'{done} maps rendered into {OUT}')


if __name__ == '__main__':
    main()
