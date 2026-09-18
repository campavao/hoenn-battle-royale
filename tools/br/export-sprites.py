#!/usr/bin/env python3
"""Export every object-event graphic as a sprite sheet, for the people on the field
past the picture (POK-318, web/src/field.ts).

    python tools/br/export-sprites.py   -> web/public/field-sprites/<gfx id>.png
                                           web/src/data/sprites.json

The ROM only draws the people inside its 240x160 window; the page draws them whole
across its edge and beyond it, from these sheets, at the frame the ROM's own sprite
table says it is on. So the sheets have to be the ROM's frames in the ROM's order:

  gObjectEventGraphicsInfoPointers[gfx id]  -> gObjectEventGraphicsInfo_X
      .width/.height, .paletteTag, .images = sPicTable_Y
  sPicTable_Y[frame]                        -> overworld_frame(gObjectEventPic_Z, w, h, n)
                                               n-th w*8 x h*8 frame of Z's PNG, left to right
  gObjectEventPic_Z                         -> graphics/object_events/pics/<..>.png (indexed)
  OBJ_EVENT_PAL_TAG_T                       -> graphics/object_events/palettes/<..>.pal

Colour 0 is transparent. A picture table can draw on several PNGs (Brendan's normal
frames then his running ones), so frames are taken table entry by table entry. The
animation tables are NOT exported: the page reads the current frame's image index off
the ROM bytes it already holds, through the sprite's own `anims` pointer.
"""
import json
import os
import re
import sys

from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'web', 'public', 'field-sprites')
DATA = os.path.join(ROOT, 'web', 'src', 'data', 'sprites.json')
SRC = os.path.join(ROOT, 'src', 'data', 'object_events')


def read(path):
    return open(path, encoding='utf-8').read()


def load_palette(path):
    lines = read(path).split('\n')
    assert lines[0].strip() == 'JASC-PAL', path
    n = int(lines[2])
    return [tuple(int(v) for v in lines[3 + i].split()) for i in range(n)]


def main():
    # gfx id constants
    ids = {}
    for m in re.finditer(r'#define\s+(OBJ_EVENT_GFX_\w+)\s+(\d+)', read(os.path.join(ROOT, 'include', 'constants', 'event_objects.h'))):
        ids[m.group(1)] = int(m.group(2))

    # id -> info name
    info_of = {}
    for m in re.finditer(r'\[(OBJ_EVENT_GFX_\w+)\]\s*=\s*&(gObjectEventGraphicsInfo_\w+)', read(os.path.join(SRC, 'object_event_graphics_info_pointers.h'))):
        if m.group(1) in ids:
            info_of[ids[m.group(1)]] = m.group(2)

    # info name -> fields
    infos = {}
    for m in re.finditer(r'const struct ObjectEventGraphicsInfo (gObjectEventGraphicsInfo_\w+) = \{(.*?)\};', read(os.path.join(SRC, 'object_event_graphics_info.h')), re.S):
        body = m.group(2)
        f = dict(re.findall(r'\.(\w+)\s*=\s*([^,\n]+)', body))
        infos[m.group(1)] = f

    # pic tables
    tables = {}
    for m in re.finditer(r'static const struct SpriteFrameImage (sPicTable_\w+)\[\] = \{(.*?)\};', read(os.path.join(SRC, 'object_event_pic_tables.h')), re.S):
        entries = []
        for e in re.finditer(r'overworld_frame\((\w+),\s*(\d+),\s*(\d+),\s*(\d+)\)|obj_frame_tiles\((\w+)\)', m.group(2)):
            if e.group(1):
                entries.append((e.group(1), int(e.group(2)), int(e.group(3)), int(e.group(4))))
            else:
                entries.append((e.group(5), None, None, 0))
        tables[m.group(1)] = entries

    # pics and palettes -> files
    graphics = read(os.path.join(SRC, 'object_event_graphics.h'))
    pic_path = {m.group(1): m.group(2) for m in re.finditer(r'(gObjectEventPic_\w+)\[\] = INCGFX_U32\("([^"]+)"', graphics)}
    pal_path = {m.group(1): m.group(2) for m in re.finditer(r'(gObjectEventPal_\w+)\[\] = INCGFX_U16\("([^"]+)"', graphics)}
    movement = read(os.path.join(ROOT, 'src', 'event_object_movement.c'))
    tag_value = {m.group(1): int(m.group(2), 16) for m in re.finditer(r'#define\s+(OBJ_EVENT_PAL_TAG_\w+)\s+(0x[0-9A-Fa-f]+)', movement)}
    pal_of_tag = {}
    for m in re.finditer(r'\{(gObjectEventPal_\w+),\s*(OBJ_EVENT_PAL_TAG_\w+)\}', movement):
        if m.group(2) in tag_value:
            pal_of_tag[m.group(2)] = m.group(1)

    os.makedirs(OUT, exist_ok=True)
    out = {}
    pics = {}
    missing = []
    for gfx_id in sorted(info_of):
        name = info_of[gfx_id]
        f = infos.get(name)
        if not f:
            missing.append(f'{gfx_id}: no info {name}')
            continue
        w, h = int(f['width']), int(f['height'])
        table = tables.get(f['images'].strip())
        if table is None:
            missing.append(f'{gfx_id}: no pic table {f["images"]}')
            continue
        pal = None
        tag = f.get('paletteTag', '').strip()
        if tag in pal_of_tag:
            pal = load_palette(os.path.join(ROOT, pal_path[pal_of_tag[tag]]))
        sheet = Image.new('RGBA', (w * len(table), h), (0, 0, 0, 0))
        for i, (pic, fw, fh, n) in enumerate(table):
            if pic not in pic_path:
                missing.append(f'{gfx_id}: no pic {pic}')
                break
            if pic not in pics:
                pics[pic] = Image.open(os.path.join(ROOT, pic_path[pic])).convert('P')
            src = pics[pic]
            fw_px = (fw * 8) if fw else src.size[0]
            fh_px = (fh * 8) if fh else src.size[1]
            per_row = max(1, src.size[0] // fw_px)
            x0 = (n % per_row) * fw_px
            y0 = (n // per_row) * fh_px
            frame = src.crop((x0, y0, x0 + fw_px, y0 + fh_px))
            colours = pal if pal else [tuple(frame.getpalette()[3 * k:3 * k + 3]) for k in range(16)]
            px = frame.load()
            for y in range(min(fh_px, h)):
                for x in range(min(fw_px, w)):
                    c = px[x, y]
                    if c == 0:
                        continue
                    r, g, b = colours[c % len(colours)]
                    sheet.putpixel((i * w + x, y), (r, g, b, 255))
        sheet.save(os.path.join(OUT, f'{gfx_id}.png'), optimize=True)
        out[str(gfx_id)] = {'name': name[len('gObjectEventGraphicsInfo_'):], 'w': w, 'h': h, 'frames': len(table)}

    # The fog (WEATHER_FOG_HORIZONTAL): one 64x64 tile the ROM repeats over the screen,
    # with graphics/weather/fog.pal -- purple, Cam's ask -- so the page's fog past the
    # picture is the ROM's fog, colour for colour.
    fog = Image.open(os.path.join(ROOT, 'graphics', 'weather', 'fog_horizontal.png')).convert('P')
    fog_pal = load_palette(os.path.join(ROOT, 'graphics', 'weather', 'fog.pal'))
    fog_out = Image.new('RGBA', fog.size, (0, 0, 0, 0))
    fpx = fog.load()
    for y in range(fog.size[1]):
        for x in range(fog.size[0]):
            c = fpx[x, y]
            if c:
                fog_out.putpixel((x, y), fog_pal[c] + (255,))
    fog_out.save(os.path.join(OUT, 'fog.png'), optimize=True)

    json.dump(out, open(DATA, 'w', encoding='utf-8'), indent=1)
    print(f'{len(out)} sheets into {OUT}; {DATA}')
    for m in missing:
        print('  skipped', m, file=sys.stderr)


if __name__ == '__main__':
    main()
