#!/usr/bin/env python3
"""Export every trainer front picture, for the trainers parked beside a battle (#18,
web/src/ui/sides.ts).

    python tools/br/export-trainer-pics.py   -> build/br-art/trainer-pics/<pic id>.png

The reference for the page's own cut from the player's ROM (HBR-67, web/src/art/romart.ts,
web/e2e/art.sha1.json): the site ships none of these.

Cam's 2026-10-19 play-test: "We have the real estate to show the opposing trainer top
right and yours bottom left ... When the trainer slides out, instead of disappearing off
the right, have them persist there and show their name underneath." The ROM says which
picture each side wears (gBrSides, include/br/br_battle.h); the page draws it from here.

The pic id is the picture's place in gTrainerFrontPicTable
(src/data/trainer_graphics/front_pic_tables.h), the same number as TRAINER_PIC_*:

  TRAINER_SPRITE(HIKER, gTrainerFrontPic_Hiker, ...)   -> pic 0
  gTrainerFrontPic_Hiker -> graphics/trainers/front_pics/hiker.png (src/data/graphics/trainers.h)

The PNG is indexed and carries its own palette (the ROM's .gbapal is made from it).
Colour 0 is transparent.
"""
import os
import re

from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'build', 'br-art', 'trainer-pics')


def read(path):
    return open(path, encoding='utf-8').read()


def main():
    table = read(os.path.join(ROOT, 'src', 'data', 'trainer_graphics', 'front_pic_tables.h'))
    body = table[table.index('gTrainerFrontPicTable[]'):]
    body = body[:body.index('};')]
    order = re.findall(r'TRAINER_SPRITE\(\s*\w+\s*,\s*(gTrainerFrontPic_\w+)', body)

    files = {}
    for m in re.finditer(r'const u32 (gTrainerFrontPic_\w+)\[\] = INCGFX_U32\("([^"]+\.png)"',
                         read(os.path.join(ROOT, 'src', 'data', 'graphics', 'trainers.h'))):
        files[m.group(1)] = m.group(2)

    os.makedirs(OUT, exist_ok=True)
    for pic, name in enumerate(order):
        src = Image.open(os.path.join(ROOT, files[name]))
        assert src.mode == 'P', name
        out = src.convert('RGBA')
        px = out.load()
        idx = src.load()
        for y in range(src.height):
            for x in range(src.width):
                if idx[x, y] == 0:
                    px[x, y] = (0, 0, 0, 0)
        out.save(os.path.join(OUT, '%d.png' % pic), optimize=True)
    print('%d pictures -> %s' % (len(order), OUT))


if __name__ == '__main__':
    main()
