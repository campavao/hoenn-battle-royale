#!/usr/bin/env python3
"""The whole outdoor world as the game draws it, one picture, for the page Cam marks up.

    (from web/) HBR_ARTBOARD=<dir> HBR_E2E_PORT=N npx playwright test e2e/spikeb-world.spec.ts \\
                  -g "whole outdoor world" --project=spikeb-world --retries=0
    python tools/br/world-artboard.py <dir> <out-dir>   -> world-artboard.png, world-artboard.json

Cam, 11-04: "have the map in a big kind of like ... artboard where I can like click and drag and
like highlight areas and say like this needs to change". The spec photographs the real page's
field a window at a time; this stitches the windows, and lays the outdoors that aren't on the
plane (the Zone, the islands, the towns and peaks a warp reaches) in a strip below it.

The JSON says what a pixel is. One cell is `cell` pixels. A pixel in a map's `rect` is that map's
cell ((px - rect.x) >> 4, (py - rect.y) >> 4); `grid` is the map's walk classes as in world.json
(run-length, 1 is a wall). A pixel in `plane` and in no map's rect is past the maps' edges, drawn
by world-fill.json at world cell (px >> 4) + plane.worldX, (py >> 4) + plane.worldY: nobody can
stand on it, and export-fill.py is what changes it.
"""
import json
import os
import sys

from PIL import Image

CELL = 16
LIMIT = 15 * 1000 * 1000


def main():
    src, out = sys.argv[1], sys.argv[2]
    meta = json.load(open(os.path.join(src, 'meta.json'), encoding='utf-8'))
    x0, y0, x1, y1 = meta['x0'], meta['y0'], meta['x1'], meta['y1']
    pw, ph = x1 - x0, y1 - y0
    on = set(meta['mainland'])
    byid = {m['id']: m for m in meta['maps']}
    # The strip: tallest first, a cell's gap, wrapped to the plane's width.
    apart = sorted(meta['pics'], key=lambda p: (-byid[p['id']]['h'], p['id']))
    x, y, row = 0, ph + 2 * CELL, 0
    places = {}
    for p in apart:
        m = byid[p['id']]
        w, h = m['w'] * CELL, m['h'] * CELL
        if x and x + w > pw:
            x, y, row = 0, y + row + 2 * CELL, 0
        places[p['id']] = (x, y)
        x += w + 2 * CELL
        row = max(row, h)
    H = y + row if apart else ph
    img = Image.new('RGB', (pw, H), (24, 24, 32))
    for t in meta['tiles']:
        with Image.open(os.path.join(src, t['file'])) as tile:
            img.paste(tile.convert('RGB'), (t['x'] - x0, t['y'] - y0))
    for p in apart:
        with Image.open(os.path.join(src, p['file'])) as pic:
            img.paste(pic.convert('RGB'), places[p['id']])
    maps = []
    for m in meta['maps']:
        if m['id'] in on:
            rect = {'x': m['gx'] * CELL - x0, 'y': m['gy'] * CELL - y0}
        elif m['id'] in places:
            rect = {'x': places[m['id']][0], 'y': places[m['id']][1]}
        else:
            continue
        rect.update(w=m['w'] * CELL, h=m['h'] * CELL)
        maps.append({'id': m['id'], 'group': m['group'], 'num': m['num'], 'w': m['w'], 'h': m['h'], 'onPlane': m['id'] in on, 'gx': m['gx'] if m['id'] in on else None, 'gy': m['gy'] if m['id'] in on else None, 'rect': rect, 'grid': m['grid']})
    os.makedirs(out, exist_ok=True)
    png = os.path.join(out, 'world-artboard.png')
    img.save(png, optimize=True)
    size = os.path.getsize(png)
    if size > LIMIT:
        # A few hundred colours in all: a palette of 256 is all but the same picture.
        img.quantize(256, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE).save(png, optimize=True)
        size = os.path.getsize(png)
    doc = {
        'image': 'world-artboard.png', 'width': img.width, 'height': img.height, 'cell': CELL,
        'plane': {'x': 0, 'y': 0, 'w': pw, 'h': ph, 'worldX': x0 // CELL, 'worldY': y0 // CELL},
        'maps': maps,
    }
    with open(os.path.join(out, 'world-artboard.json'), 'w', encoding='utf-8') as f:
        json.dump(doc, f, separators=(',', ':'))
    print(f'{png} {img.width} x {img.height}, {size / 1e6:.1f} MB; {len(maps)} maps, {sum(m["onPlane"] for m in maps)} on the plane')


if __name__ == '__main__':
    main()
