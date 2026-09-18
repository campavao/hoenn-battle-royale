#!/usr/bin/env python3
"""Render every outdoor map to a PNG, for the field past the picture and the drop painter.

    python tools/br/render-maps.py            -> web/public/field-maps/<MAP_ID>.png
                                                 web/public/field-maps/<MAP_ID>.border.png

Two readers. The page (web/src/field.ts, POK-317) draws these around the GBA's 240x160
picture, scrolled with the ROM's own camera, so the game fills the screen: the GBA draws
nothing past its window, so this is what stands in for it. The drop painter (POK-314) lays
its grid over the same still. Cam, painting: "I have to see the actual map sprites to know
what I'm painting."

Each map is drawn the way the GBA does, from pret's own data: the layout's map.bin says
which metatile stands in each block, the tileset's metatiles.bin says which eight tiles
make that metatile (four below, four above), tiles.png is the 4bpp tile sheet and the
sixteen .pal files are its palettes. Primary tileset: tiles 0..511, metatiles 0..511,
palettes 0..5. Secondary: 512.., 512.., 6..12. The top layer's colour 0 is transparent.

The border block (border.bin, 2x2 metatiles) is what the ROM repeats past a map edge that
has no connection -- Route 101's trees either side. It is a 32x32 PNG of its own; the page
tiles it under everything, aligned to the map's odd coordinates (MapGridGetMetatileIdAt
indexes it by the parity of grid coords, which carry MAP_OFFSET 7).

No object events, no animation, no player: a still of the ground, one block = 16 px. Every
map has at most a couple of hundred colours (thirteen palettes of sixteen), so the PNGs
are written with a palette, exactly, at about a third the size -- they ship with the site.
"""
import json
import os
import struct
import sys

import numpy as np
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'web', 'public', 'field-maps')
TILE = 8
BLOCK = 16

_tilesets = {}


def tileset_dir(name):
    # gTileset_General -> data/tilesets/primary/general; gTileset_Petalburg -> secondary/petalburg
    short = name[len('gTileset_'):]
    snake = ''.join(('_' + c.lower()) if c.isupper() and i else c.lower() for i, c in enumerate(short))
    for kind in ('primary', 'secondary'):
        d = os.path.join(ROOT, 'data', 'tilesets', kind, snake)
        if os.path.isdir(d):
            return d, kind
    sys.exit(f'no tileset dir for {name} ({snake})')


def load_palette(path):
    lines = open(path, encoding='utf-8').read().split('\n')
    assert lines[0].strip() == 'JASC-PAL'
    n = int(lines[2])
    return [tuple(int(v) for v in lines[3 + i].split()) for i in range(n)]


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


class Tilesets:
    def __init__(self, layout):
        self.primary = load_tileset(layout['primary_tileset'])
        self.secondary = load_tileset(layout['secondary_tileset'])
        self.palettes = self.primary[2][:6] + self.secondary[2][6:13] + self.primary[2][13:]

    def draw_block(self, img, bx, by, block):
        mid = block & 0x3FF
        if mid < 512:
            mt = self.primary[1][mid] if mid < len(self.primary[1]) else None
        else:
            mt = self.secondary[1][mid - 512] if mid - 512 < len(self.secondary[1]) else None
        if mt is None:
            return
        for layer in (0, 1):
            for t in range(4):
                entry = mt[layer * 4 + t]
                tid = entry & 0x3FF
                tile = self.primary[0][tid] if tid < 512 else (self.secondary[0][tid - 512] if tid - 512 < len(self.secondary[0]) else None)
                if tile is None:
                    continue
                pal = self.palettes[(entry >> 12) & 0xF]
                draw_tile(img, bx + (t % 2) * TILE, by + (t // 2) * TILE, tile, pal, entry & 0x400, entry & 0x800, layer == 1)


def render(layout):
    ts = Tilesets(layout)
    w, h = layout['width'], layout['height']
    blocks = struct.unpack(f'<{w * h}H', open(os.path.join(ROOT, layout['blockdata_filepath']), 'rb').read()[: w * h * 2])
    img = Image.new('RGB', (w * BLOCK, h * BLOCK), (0, 0, 0))
    for i, block in enumerate(blocks):
        ts.draw_block(img, (i % BLOCK) * BLOCK if False else (i % w) * BLOCK, (i // w) * BLOCK, block)
    return img


def render_border(layout):
    ts = Tilesets(layout)
    blocks = struct.unpack('<4H', open(os.path.join(ROOT, layout['border_filepath']), 'rb').read()[:8])
    img = Image.new('RGB', (2 * BLOCK, 2 * BLOCK), (0, 0, 0))
    for i, block in enumerate(blocks):
        ts.draw_block(img, (i % 2) * BLOCK, (i // 2) * BLOCK, block)
    return img


def paletted(img):
    """The same picture as a palette PNG, exactly, when it has 256 colours or fewer."""
    arr = np.asarray(img.convert('RGB'))
    flat = arr.reshape(-1, 3)
    packed = (flat[:, 0].astype(np.uint32) << 16) | (flat[:, 1].astype(np.uint32) << 8) | flat[:, 2]
    colours, index = np.unique(packed, return_inverse=True)
    if len(colours) > 256:
        return img
    p = Image.new('P', img.size)
    pal = []
    for c in colours:
        pal += [int(c >> 16) & 0xFF, int(c >> 8) & 0xFF, int(c) & 0xFF]
    p.putpalette(pal)
    p.putdata(index.astype(np.uint8).reshape(-1).tolist())
    return p


def main():
    world = json.load(open(os.path.join(ROOT, 'web', 'src', 'data', 'world.json'), encoding='utf-8'))
    layouts = {l['id']: l for l in json.load(open(os.path.join(ROOT, 'data', 'layouts', 'layouts.json'), encoding='utf-8'))['layouts']}
    # map id -> layout id, from every map.json once (the directory name is the map's
    # CamelCase name and guessing the casing is worse than reading the file).
    layout_of = {}
    for d in os.listdir(os.path.join(ROOT, 'data', 'maps')):
        p = os.path.join(ROOT, 'data', 'maps', d, 'map.json')
        if os.path.exists(p):
            j = json.load(open(p, encoding='utf-8'))
            layout_of[j['id']] = j['layout']
    os.makedirs(OUT, exist_ok=True)
    done = 0
    for m in world['maps']:
        if not m.get('outdoor'):
            continue
        layout_id = layout_of.get(m['id'])
        if layout_id is None or layout_id not in layouts:
            print(f'{m["id"]}: no layout', file=sys.stderr)
            continue
        paletted(render(layouts[layout_id])).save(os.path.join(OUT, f'{m["id"]}.png'), optimize=True)
        paletted(render_border(layouts[layout_id])).save(os.path.join(OUT, f'{m["id"]}.border.png'), optimize=True)
        done += 1
    print(f'{done} maps rendered into {OUT}')


if __name__ == '__main__':
    main()
