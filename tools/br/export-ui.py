#!/usr/bin/env python3
"""Emerald's own font, window frame and message box, and the skin ladder, as page assets
for the UI outside the game (POK-320).

    python tools/br/export-ui.py   -> web/public/ui/font-normal.png    the 512 glyphs, 16x16
                                                                       each, R = colour index
                                                                       (1..3), A = 255 where drawn
                                      web/public/ui/frame-1.png        the standard window
                                                                       frame, 3x3 tiles of 8 px
                                      web/public/ui/message-box.png    the message box, 7x2 tiles
                                      web/src/data/ui.json             glyph widths, the text
                                                                       palettes, the skin ladder

The font is `graphics/fonts/latin_normal.png`: a 16-column grid of 16x16 glyphs indexed
by charmap byte (row = id / 16, column = id % 16), 4 colours where 0 is transparent and
the ROM's text palette gives 1..3 their colour (`graphics/text_window/text_pal1.pal`:
background, foreground, shadow). Widths are `gFontNormalLatinGlyphWidths` in
src/fonts.c. The frame is `graphics/text_window/1.png` with its own palette, the one
Emerald's options menu shows by default; the message box is `message_box.png`. The
skins are `sSkinGraphics` in src/br/br_ghosts.c, resolved to gfx ids through
include/constants/event_objects.h, whose sheets export-sprites.py already wrote to
web/public/field-sprites/<gfx>.png.
"""
import json
import re
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "web/public/ui"
OUT.mkdir(parents=True, exist_ok=True)


def indexed_to_rgba(path: Path, transparent0=True) -> Image.Image:
    im = Image.open(path)
    assert im.mode == "P", path
    pal = im.getpalette()
    w, h = im.size
    out = Image.new("RGBA", (w, h))
    px = im.load()
    op = out.load()
    for y in range(h):
        for x in range(w):
            i = px[x, y]
            if transparent0 and i == 0:
                op[x, y] = (0, 0, 0, 0)
            else:
                op[x, y] = (pal[i * 3], pal[i * 3 + 1], pal[i * 3 + 2], 255)
    return out


def font_mask(path: Path) -> Image.Image:
    im = Image.open(path)
    assert im.mode == "P" and im.size == (256, 512), (path, im.size)
    out = Image.new("RGBA", im.size)
    px = im.load()
    op = out.load()
    for y in range(512):
        for x in range(256):
            i = px[x, y]
            op[x, y] = (i, 0, 0, 255 if i else 0)
    return out


def widths() -> list:
    src = (ROOT / "src/fonts.c").read_text(encoding="utf-8")
    m = re.search(r"gFontNormalLatinGlyphWidths\[\]\s*=\s*\{([^}]*)\}", src)
    return [int(v) for v in re.findall(r"\d+", m.group(1))]


def jasc_pal(path: Path) -> list:
    lines = path.read_text(encoding="utf-8").splitlines()
    assert lines[0].strip() == "JASC-PAL", path
    n = int(lines[2])
    return [[int(c) for c in lines[3 + i].split()] for i in range(n)]


def skins() -> list:
    src = (ROOT / "src/br/br_ghosts.c").read_text(encoding="utf-8")
    body = re.search(r"sSkinGraphics\[\]\s*=\s*\{([^}]*)\}", src).group(1)
    names = re.findall(r"OBJ_EVENT_GFX_\w+", body)
    consts = (ROOT / "include/constants/event_objects.h").read_text(encoding="utf-8")
    ids = {}
    for name, val in re.findall(r"#define\s+(OBJ_EVENT_GFX_\w+)\s+(\d+)", consts):
        ids[name] = int(val)
    return [ids[n] for n in names]


def main():
    font_mask(ROOT / "graphics/fonts/latin_normal.png").save(OUT / "font-normal.png")
    indexed_to_rgba(ROOT / "graphics/text_window/1.png").save(OUT / "frame-1.png")
    indexed_to_rgba(ROOT / "graphics/text_window/message_box.png").save(OUT / "message-box.png")
    data = {
        "font": {"cell": 16, "cols": 16, "widths": widths()},
        # Emerald's text palettes: [background, foreground, shadow] and on.
        "textPalettes": {f"pal{i}": jasc_pal(ROOT / f"graphics/text_window/text_pal{i}.pal") for i in (1, 2, 3, 4)},
        "skins": skins(),
    }
    (ROOT / "web/src/data/ui.json").write_text(json.dumps(data, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"font {len(data['font']['widths'])} widths, skins {data['skins']}")


if __name__ == "__main__":
    main()
