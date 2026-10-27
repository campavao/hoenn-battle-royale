#!/usr/bin/env python3
"""Emerald's own font, window frame and message box, and the skin ladder, as page assets
for the UI outside the game (POK-320).

    python tools/br/export-ui.py   -> web/public/ui/font-normal.png    the 512 glyphs, 16x16
                                                                       each, R = colour index
                                                                       (1..3), A = 255 where drawn
                                      web/public/ui/frame-1.png        the standard window
                                                                       frame, 3x3 tiles of 8 px
                                      web/public/ui/message-box.png    the message box, 7x2 tiles
                                      web/public/ui/popup-<theme>.png  the map-name sign, 96x40,
                                                                       each of its six themes
                                      web/public/ui/items.png          every item icon, 24x24,
                                                                       16 to a row by item id
                                      web/public/ui/types.png          the summary screen's type
                                                                       icons, 32x16, one per row
                                                                       by type id
                                      web/public/ui/trainer-card.png   the TRAINER CARD's front with
                                                                       no text on it, 240x160, one
                                                                       per row: each star count
                                                                       (0..4) as a boy's then a girl's
                                      web/public/ui/card-badges.png    the eight badges, 16x16, then
                                                                       the card's star, 8x8
                                      web/public/ui/trainer-pics.png   each skin's trainer portrait,
                                                                       64x64, in skin order
                                      web/src/data/ui.json             glyph widths, the text
                                                                       palettes, the skin ladder,
                                                                       the sign each section wears

The font is `graphics/fonts/latin_normal.png`: a 16-column grid of 16x16 glyphs indexed
by charmap byte (row = id / 16, column = id % 16), 4 colours where 0 is transparent and
the ROM's text palette gives 1..3 their colour (`graphics/text_window/text_pal1.pal`:
background, foreground, shadow). Widths are `gFontNormalLatinGlyphWidths` in
src/fonts.c. The frame is `graphics/text_window/1.png` with its own palette, the one
Emerald's options menu shows by default; the message box is `message_box.png`. The
sign is `graphics/map_popup/<theme>.png` inside its outline tiles, put the way
src/map_name_popup.c's DrawMapNamePopUpFrame puts them, in the palette
LoadMapNamePopUpWindowBg loads; `sMapSectionToThemeId` there says which section wears
which. The item icons are `gItemIconTable` (src/data/item_icon_table.h), each in its own
palette (src/data/graphics/items.h). The skins are `sSkinGraphics` in src/br/br_ghosts.c, resolved to gfx ids through
include/constants/event_objects.h, whose sheets export-sprites.py already wrote to
build/br-art/field-sprites/<gfx>.png. The type icons are graphics/types/<type>.png, each in
the palette src/pokemon_summary_screen.c's sMoveTypeToOamPaletteNum gives it (OBJ
palettes 13..15 are move_types_1..3.pal, loaded together from gMoveTypes_Pal). The card
is src/trainer_card.c's front: `bg.bin` (BG2) under `front.bin` (BG0), both in
`tiles.png`, in the palette sHoennTrainerCardPals gives its star count, with
female_bg.pal over palette 1 for a girl. Its star is tile 143 of the same sheet in
star.pal; the badges are `badges.png` in its own palette. The portraits are
graphics/trainers/front_pics, each in its own palette, the class that dresses like the
skin's sheet.
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


POPUP_THEMES = ["wood", "marble", "stone", "brick", "underwater", "stone2"]
ICON_CELL = 24
ICON_COLS = 16


def recolor(path: Path, pal: list, transparent0=True) -> Image.Image:
    """An indexed image in a palette other than its own, as RGBA."""
    im = Image.open(path)
    assert im.mode == "P", path
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
                c = pal[i % len(pal)]
                op[x, y] = (c[0], c[1], c[2], 255)
    return out


def own_palette(path: Path) -> list:
    raw = Image.open(path).getpalette()[:48]
    return [raw[i : i + 3] for i in range(0, 48, 3)]


def popup(theme: str) -> Image.Image:
    """The sign as the ROM draws it: the 80x24 body inside a tile of outline all round
    (twelve tiles along the top and the bottom, three down each side)."""
    d = ROOT / "graphics/map_popup"
    if theme == "wood":
        pal = own_palette(d / "wood.png")
    elif theme == "underwater":
        pal = jasc_pal(d / "underwater.pal")
    else:
        pal = own_palette(d / f"{theme}_outline.png")
    outline = Image.open(d / f"{theme}_outline.png")
    tiles = []
    for ty in range(outline.size[1] // 8):
        for tx in range(outline.size[0] // 8):
            tiles.append(outline.crop((tx * 8, ty * 8, tx * 8 + 8, ty * 8 + 8)))
    out = Image.new("RGBA", (96, 40), (0, 0, 0, 0))

    def put(t: int, x: int, y: int):
        src = tiles[t].load()
        op = out.load()
        for yy in range(8):
            for xx in range(8):
                i = src[xx, yy]
                if i:
                    c = pal[i]
                    op[x + xx, y + yy] = (c[0], c[1], c[2], 255)

    for i in range(12):
        put(i, i * 8, 0)
        put(18 + i, i * 8, 32)
    for r in range(3):
        put(12 + r * 2, 0, 8 + r * 8)
        put(13 + r * 2, 88, 8 + r * 8)
    out.paste(recolor(d / f"{theme}.png", pal, transparent0=False), (8, 8))
    return out


def popup_themes() -> dict:
    """MAPSEC_* -> theme name, for every section the ROM gives a sign."""
    src = (ROOT / "src/map_name_popup.c").read_text(encoding="utf-8")
    body = re.search(r"sMapSectionToThemeId\[[^\]]*\]\s*=\s*\{([^}]*)\}", src).group(1)
    return {m: t.lower() for m, t in re.findall(r"\[(MAPSEC_\w+)[^\]]*\]\s*=\s*MAPPOPUP_THEME_(\w+)", body)}


def item_icons() -> Image.Image:
    consts = (ROOT / "include/constants/items.h").read_text(encoding="utf-8")
    # An enum from ITEM_NONE (0), one apiece, to ITEMS_COUNT.
    body = consts[consts.index("ITEM_NONE,") : consts.index("ITEMS_COUNT")]
    ids = {n: i for i, n in enumerate(re.findall(r"\b(ITEM_\w+)\s*,", body))}
    gfx = (ROOT / "src/data/graphics/items.h").read_text(encoding="utf-8") + (ROOT / "src/br/br_items.c").read_text(encoding="utf-8")
    files = dict(re.findall(r"const u32 (\w+)\[\]\s*=\s*INCGFX_U32\(\"([^\"]+?)\.(?:png|pal)\"", gfx))
    table = (ROOT / "src/data/item_icon_table.h").read_text(encoding="utf-8")
    # The BR build's: an `#if BR` keeps its first half, so the `#else` halves go.
    table = re.sub(r"#else.*?#endif", "", table, flags=re.S)
    rows = re.findall(r"\[(ITEM_\w+)\]\s*=\s*\{(\w+),\s*(\w+)\}", table)
    top = max(ids[n] for n, _, _ in rows)
    sheet = Image.new("RGBA", (ICON_COLS * ICON_CELL, (top // ICON_COLS + 1) * ICON_CELL), (0, 0, 0, 0))
    for name, icon, pal in rows:
        i = ids[name]
        img = recolor(ROOT / (files[icon] + ".png"), jasc_pal(ROOT / (files[pal] + ".pal")))
        sheet.paste(img.crop((0, 0, ICON_CELL, ICON_CELL)), ((i % ICON_COLS) * ICON_CELL, (i // ICON_COLS) * ICON_CELL))
    return sheet


TYPE_W, TYPE_H = 32, 16


def type_icons() -> Image.Image:
    consts = (ROOT / "include/constants/pokemon.h").read_text(encoding="utf-8")
    ids = {n: int(v) for n, v in re.findall(r"#define TYPE_(\w+)\s+(\d+)\b", consts) if n not in ("NONE",)}
    src = (ROOT / "src/pokemon_summary_screen.c").read_text(encoding="utf-8")
    body = re.search(r"sMoveTypeToOamPaletteNum\[[^\]]*\]\s*=\s*\{([^}]*)\}", src).group(1)
    pals = {n: int(v) for n, v in re.findall(r"\[TYPE_(\w+)\]\s*=\s*(\d+)", body)}
    d = ROOT / "graphics/types"
    # The art's file names: FIGHTING is fight.png, the rest their own names.
    file = {"FIGHTING": "fight"}
    sheet = Image.new("RGBA", (TYPE_W, len(pals) * TYPE_H), (0, 0, 0, 0))
    for name, pal in pals.items():
        img = recolor(d / f"{file.get(name, name.lower())}.png", jasc_pal(d / f"move_types_{pal - 12}.pal"))
        sheet.paste(img, (0, ids[name] * TYPE_H))
    return sheet


CARD_W, CARD_H = 240, 160
CARD_STAR_TILE = 143  # DrawStarsAndBadgesOnCard
CARD_TIERS = ["green", "bronze", "copper", "silver", "gold"]
# The portrait each skin's sheet goes with (sSkinGraphics' order): the rivals are the
# same two people.
SKIN_PICS = {
    "BRENDAN_NORMAL": "brendan", "MAY_NORMAL": "may",
    "RIVAL_BRENDAN_NORMAL": "brendan", "RIVAL_MAY_NORMAL": "may",
    "HIKER": "hiker", "BEAUTY": "beauty", "CAMPER": "camper", "PICNICKER": "picnicker",
    "SWIMMER_M": "swimmer_m", "SWIMMER_F": "swimmer_f", "EXPERT_M": "expert_m",
    "EXPERT_F": "expert_f", "POKEFAN_M": "pokefan_m", "POKEFAN_F": "pokefan_f",
    "YOUNGSTER": "youngster", "LASS": "lass",
}


def card_front(tier: str, female: bool) -> Image.Image:
    """The card as DrawCardScreenBackground and DrawCardFrontOrBack lay it: 30x20 tiles
    of each map, entries the GBA's (tile, h flip, v flip, palette), BG0 over BG2 over
    the backdrop (palette 0's colour 0)."""
    d = ROOT / "graphics/trainer_card"
    pal = jasc_pal(d / f"{tier}.pal")
    if female:
        pal[16:32] = jasc_pal(d / "female_bg.pal")
    sheet = Image.open(d / "tiles.png")
    src = sheet.load()
    cols = sheet.size[0] // 8
    out = Image.new("RGBA", (CARD_W, CARD_H), tuple(pal[0]) + (255,))
    op = out.load()
    for name in ("bg.bin", "front.bin"):
        raw = (d / name).read_bytes()
        for ty in range(20):
            for tx in range(30):
                e = raw[(ty * 30 + tx) * 2] | raw[(ty * 30 + tx) * 2 + 1] << 8
                t, hf, vf, pn = e & 0x3FF, e >> 10 & 1, e >> 11 & 1, e >> 12
                sx, sy = (t % cols) * 8, (t // cols) * 8
                for y in range(8):
                    for x in range(8):
                        # The sheet's indices carry a bank above the low four bits; the
                        # tile is 4bpp and the map's palette is the bank.
                        i = src[sx + (7 - x if hf else x), sy + (7 - y if vf else y)] & 15
                        if i:
                            c = pal[pn * 16 + i]
                            op[tx * 8 + x, ty * 8 + y] = (c[0], c[1], c[2], 255)
    return out


def card_badges() -> Image.Image:
    d = ROOT / "graphics/trainer_card"
    out = Image.new("RGBA", (128 + 8, 16), (0, 0, 0, 0))
    out.paste(indexed_to_rgba(d / "badges.png"), (0, 0))
    star_pal = jasc_pal(d / "star.pal")
    sheet = Image.open(d / "tiles.png")
    src = sheet.load()
    op = out.load()
    cols = sheet.size[0] // 8
    sx, sy = (CARD_STAR_TILE % cols) * 8, (CARD_STAR_TILE // cols) * 8
    for y in range(8):
        for x in range(8):
            i = src[sx + x, sy + y] & 15
            if i:
                c = star_pal[i]
                op[128 + x, y] = (c[0], c[1], c[2], 255)
    return out


def trainer_pics() -> Image.Image:
    src = (ROOT / "src/br/br_ghosts.c").read_text(encoding="utf-8")
    body = re.search(r"sSkinGraphics\[\]\s*=\s*\{([^}]*)\}", src).group(1)
    names = re.findall(r"OBJ_EVENT_GFX_(\w+)", body)
    out = Image.new("RGBA", (64 * len(names), 64), (0, 0, 0, 0))
    for i, n in enumerate(names):
        out.paste(indexed_to_rgba(ROOT / f"graphics/trainers/front_pics/{SKIN_PICS[n]}.png"), (i * 64, 0))
    return out


def main():
    font_mask(ROOT / "graphics/fonts/latin_normal.png").save(OUT / "font-normal.png")
    indexed_to_rgba(ROOT / "graphics/text_window/1.png").save(OUT / "frame-1.png")
    indexed_to_rgba(ROOT / "graphics/text_window/message_box.png").save(OUT / "message-box.png")
    for theme in POPUP_THEMES:
        popup(theme).save(OUT / f"popup-{theme}.png")
    item_icons().save(OUT / "items.png")
    type_icons().save(OUT / "types.png")
    cards = Image.new("RGBA", (CARD_W, CARD_H * 2 * len(CARD_TIERS)), (0, 0, 0, 0))
    for stars, tier in enumerate(CARD_TIERS):
        for female in (0, 1):
            cards.paste(card_front(tier, bool(female)), (0, (stars * 2 + female) * CARD_H))
    cards.save(OUT / "trainer-card.png")
    card_badges().save(OUT / "card-badges.png")
    trainer_pics().save(OUT / "trainer-pics.png")
    data = {
        "font": {"cell": 16, "cols": 16, "widths": widths()},
        # Emerald's text palettes: [background, foreground, shadow] and on.
        "textPalettes": {f"pal{i}": jasc_pal(ROOT / f"graphics/text_window/text_pal{i}.pal") for i in (1, 2, 3, 4)},
        "skins": skins(),
        "popupThemes": popup_themes(),
        "itemIcons": {"cell": ICON_CELL, "cols": ICON_COLS},
        "typeIcons": {"w": TYPE_W, "h": TYPE_H},
    }
    (ROOT / "web/src/data/ui.json").write_text(json.dumps(data, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"font {len(data['font']['widths'])} widths, skins {data['skins']}")


if __name__ == "__main__":
    main()
