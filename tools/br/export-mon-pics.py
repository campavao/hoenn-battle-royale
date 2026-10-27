#!/usr/bin/env python3
"""Export every POKeMON's front picture, normal and shiny, for the champion's team on the
results (HBR-47, web/src/ui/results-team.ts).

    python tools/br/export-mon-pics.py   -> build/br-art/mon-pics/<species>.png, <species>s.png

The reference for the page's own cut from the player's ROM (HBR-67, web/src/art/romart.ts,
web/e2e/art.sha1.json): the site ships none of these.

Cam's 10-20 play-test, #14: "show the champion's team like the hall of fame cards, and
tap one for its summary." The species number is the ROM's own (SPECIES_*), the order of
gMonFrontPicTable (src/data/pokemon_graphics/front_pic_table.h); the picture is the still
one Emerald's summary screen shows (gMonStillFrontPic_*, src/data/graphics/pokemon.h),
its first 64x64 frame, in the species' normal.pal or shiny.pal. Colour 0 is transparent.
Castform's are under castform/normal/, as graphics_file_rules.mk builds them, and the
Unown letters' palettes are unown/'s.
"""
import os
import re

from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'build', 'br-art', 'mon-pics')


def read(path):
    return open(path, encoding='utf-8').read()


def load_pal(path):
    lines = read(path).split('\n')
    assert lines[0].strip() == 'JASC-PAL', path
    return [tuple(int(v) for v in l.split()) for l in lines[3:3 + 16]]


def main():
    table = read(os.path.join(ROOT, 'src', 'data', 'pokemon_graphics', 'front_pic_table.h'))
    order = re.findall(r'SPECIES_SPRITE\(\s*(\w+)\s*,\s*gMonFrontPic_(\w+)\)', table)
    stills = dict(re.findall(r'gMonStillFrontPic_(\w+)\[\] = INCGFX_U32\("([^"]+)"',
                             read(os.path.join(ROOT, 'src', 'data', 'graphics', 'pokemon.h'))))
    os.makedirs(OUT, exist_ok=True)
    made = 0
    for species, (_, name) in enumerate(order):
        path = stills.get(name)
        if species == 0 or path is None:
            continue
        folder = os.path.dirname(os.path.join(ROOT, path))
        if path.endswith('.4bpp'):
            folder = os.path.join(folder, 'normal')
        png = os.path.join(folder, 'front.png')
        # Unown's letters share the palettes one folder up.
        pals = folder if os.path.exists(os.path.join(folder, 'normal.pal')) else os.path.dirname(folder)
        if not os.path.exists(png) or not all(os.path.exists(os.path.join(pals, f)) for f in ('normal.pal', 'shiny.pal')):
            continue
        src = Image.open(png).crop((0, 0, 64, 64))
        assert src.mode == 'P', png
        for suffix, pal in (('', 'normal.pal'), ('s', 'shiny.pal')):
            colours = load_pal(os.path.join(pals, pal))
            out = src.copy()
            flat = [c for rgb in colours for c in rgb]
            out.putpalette(flat + [0] * (768 - len(flat)))
            out.info['transparency'] = 0
            out.save(os.path.join(OUT, '%d%s.png' % (species, suffix)), optimize=True, transparency=0)
        made += 1
    print('%d species -> %s' % (made, OUT))


if __name__ == '__main__':
    main()
