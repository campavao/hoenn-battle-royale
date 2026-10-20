#!/usr/bin/env python3
"""The HOW TO PLAY panels' pictures (POK-430), out of the game's own art.

    python tools/br/export-howto.py   -> web/public/ui/howto.png

One sheet, 240 wide (the screen's width), its pictures 150 tall, top to bottom:

    0    the Safari Zone from above: its six areas (field-maps/MAP_SAFARI_ZONE_*.png, as
         the maps' connections put them) shrunk to a bird's-eye view
    150  Hoenn: the POKéNAV's region map, `graphics/pokenav/region_map/map.png` laid out by
         its affine tilemap `map.bin` in `map.pal` (loaded at palette 7, hence the pixels'
         112 offset), at its own scale
    300  a field for the fog to roll over, Route 101
    450  a battle about to start: BRENDAN and MAY face to face on Route 101, the
         trainer's "!" (field_effects/pics/emotion_exclamation.png) over each
    600  an event the way a ROM shows it, in Route 111's desert (src/br/br_loot.c's Spawn):
         GROUDON surfacing (gfx 198, br_legend.c), its two rares as red balls, three gold
         balls (br_item_ball_gold.png in sShades' gold, src/br/br_balls.c), BIRCH's bag of
         supplies, and the trader, a GENTLEMAN facing down (br_event.c)
    750  the evolution scene's backdrop, twelve frames of its palette cycle: bg_inner.bin
         over bg.png, in sBgAnim_Pal by sBgAnim_PalIndexes rows 13..24, the loop
         Task_UpdateBgPalette runs while a POKéMON evolves (src/evolution_scene.c)
    2550 CHARMANDER, CHARMELEON, CHARIZARD, 64x64 each, in their own colours; under them,
         at 2614, the same three in white, the way they flash while they change

The field sprites are the sheets export-sprites.py wrote to web/public/field-sprites:
standing south is frame 0, west frame 2; east is west mirrored, as the ROM draws it.
"""
import json
import struct
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "web/public/ui/howto.png"
MAPS = ROOT / "web/public/field-maps"
SPRITES = ROOT / "web/public/field-sprites"
SHEETS = json.loads((ROOT / "web/src/data/sprites.json").read_text())

BANG = ROOT / "graphics/field_effects/pics/emotion_exclamation.png"
W, H = 240, 150
EVO_FRAMES = range(13, 25)
MONS = ["charmander", "charmeleon", "charizard"]
SHEET_H = H * 5 + H * len(EVO_FRAMES) + 64 * 2

GFX_BRENDAN, GFX_MAY, GFX_GENTLEMAN = 0, 89, 48
GFX_ITEM_BALL, GFX_BIRCHS_BAG, GFX_GROUDON = 59, 97, 198


def jasc(path: Path) -> list:
    lines = path.read_text().split("\n")[3:]
    return [tuple(int(v) for v in l.split()) for l in lines if l.strip()]


def own_palette(path: Path) -> list:
    return [tuple(c) for c in zip(*[iter(Image.open(path).getpalette())] * 3)]


def rgb5(r: int, g: int, b: int) -> tuple:
    return tuple((v << 3) | (v >> 2) for v in (r, g, b))


def frame(gfx: int, n: int, mirror=False) -> Image.Image:
    info = SHEETS[str(gfx)]
    w, h = info["w"], info["h"]
    im = Image.open(SPRITES / f"{gfx}.png").convert("RGBA").crop((n * w, 0, n * w + w, h))
    return im.transpose(Image.FLIP_LEFT_RIGHT) if mirror else im


def paletted(path: Path, pal: list, offset=0, transparent0=True) -> Image.Image:
    im = Image.open(path)
    out = Image.new("RGBA", im.size)
    out.putdata([
        (0, 0, 0, 0) if transparent0 and v == 0 else pal[v - offset if v else 0] + (255,)
        for v in im.tobytes()
    ])
    return out


def safari() -> Image.Image:
    grid = [["NORTHWEST", "NORTH", "NORTHEAST"], ["SOUTHWEST", "SOUTH", "SOUTHEAST"]]
    big = Image.new("RGBA", (640 * 3, 640 * 2))
    for j, row in enumerate(grid):
        for i, name in enumerate(row):
            big.paste(Image.open(MAPS / f"MAP_SAFARI_ZONE_{name}.png").convert("RGBA"), (i * 640, j * 640))
    small = big.resize((W, W * 2 // 3), Image.BOX)
    top = (small.height - H) // 2
    return small.crop((0, top, W, top + H))


def hoenn() -> Image.Image:
    rm = ROOT / "graphics/pokenav/region_map"
    tiles = paletted(rm / "map.png", jasc(rm / "map.pal"), offset=112, transparent0=False)
    tilemap = (rm / "map.bin").read_bytes()
    out = Image.new("RGBA", (512, 512))
    for i, t in enumerate(tilemap):
        out.paste(tiles.crop(((t % 16) * 8, (t // 16) * 8, (t % 16) * 8 + 8, (t // 16) * 8 + 8)), ((i % 64) * 8, (i // 64) * 8))
    return out.crop((7, 0, 7 + W, H))


def route101() -> Image.Image:
    return Image.open(MAPS / "MAP_ROUTE101.png").convert("RGBA").crop((32, 112, 32 + W, 112 + H))


def battle() -> Image.Image:
    im = route101()
    bang = paletted(BANG, own_palette(BANG))
    # Three steps apart on the path, BRENDAN facing east and MAY west.
    foot = 96
    for gfx, x, mirror in ((GFX_BRENDAN, 64, True), (GFX_MAY, 112, False)):
        im.alpha_composite(frame(gfx, 2, mirror), (x, foot - 32))
        im.alpha_composite(bang, (x, foot - 32 - 16))
    return im


def gold_ball() -> Image.Image:
    path = ROOT / "graphics/object_events/pics/misc/br_item_ball_gold.png"
    pal = own_palette(path)
    shades = [rgb5(31, 25, 6), rgb5(25, 18, 3), rgb5(14, 10, 0)]
    for i, c in enumerate(shades):
        pal[8 + i] = c
    return paletted(path, pal)


def event() -> Image.Image:
    # On whole tiles of the map (the crop is 16-aligned): a 16 wide piece fills its tile,
    # a 32 wide one stands centred on it, and anything taller stands with its feet on it.
    im = Image.open(MAPS / "MAP_ROUTE111.png").convert("RGBA").crop((336, 848, 336 + W, 848 + H))

    def put(piece: Image.Image, tx: int, ty: int) -> None:
        im.alpha_composite(piece, (tx * 16 - (piece.width - 16) // 2, (ty + 1) * 16 - piece.height))

    ball, gold, bag = frame(GFX_ITEM_BALL, 0), gold_ball(), frame(GFX_BIRCHS_BAG, 0)
    put(frame(GFX_GROUDON, 0), 7, 4)
    for tx, ty, piece in ((5, 5, ball), (9, 5, ball), (6, 6, gold), (7, 6, gold), (8, 6, gold), (4, 6, bag)):
        put(piece, tx, ty)
    put(frame(GFX_GENTLEMAN, 0), 10, 4)
    return im


def evolution_backdrop() -> list:
    g = ROOT / "graphics/evolution_scene"
    tiles = Image.open(g / "bg.png")
    pal = jasc(g / "bg_anim.pal")
    src = (ROOT / "src/evolution_scene.c").read_text()
    start = src.index("sBgAnim_PalIndexes[][16] = {")
    rows = []
    for line in src[start:].split("\n")[1:]:
        line = line.strip()
        if not line.startswith("{"):
            break
        rows.append([int(v) for v in line.strip("{},").split(",")])
    tilemap = (g / "bg_inner.bin").read_bytes()
    index = Image.new("L", (256, 256))
    for i in range(1024):
        e = struct.unpack_from("<H", tilemap, i * 2)[0]
        t = e & 0x3FF
        tile = tiles.crop(((t % 16) * 8, (t // 16) * 8, (t % 16) * 8 + 8, (t // 16) * 8 + 8))
        if e & 0x400:
            tile = tile.transpose(Image.FLIP_LEFT_RIGHT)
        if e & 0x800:
            tile = tile.transpose(Image.FLIP_TOP_BOTTOM)
        index.paste(tile, ((i % 32) * 8, (i // 32) * 8))
    # bg.png is greyscale, 17 a step: the colour index times 17. Its last two indexes,
    # the corners the GBA's 240 never quite reaches, stay black in every row; here they
    # wear the outermost ring's colour so the picture has no ragged edge.
    index = index.crop((8, 5, 8 + W, 5 + H))
    out = []
    for r in EVO_FRAMES:
        im = Image.new("RGBA", (W, H))
        im.putdata([pal[rows[r][min(v // 17, 13)]] + (255,) for v in index.tobytes()])
        out.append(im)
    return out


def mons() -> tuple:
    colour, white = [], []
    for name in MONS:
        d = ROOT / "graphics/pokemon" / name
        im = paletted(d / "front.png", jasc(d / "normal.pal"))
        colour.append(im)
        flash = Image.new("RGBA", im.size, (255, 255, 255, 255))
        flash.putalpha(im.getchannel("A"))
        white.append(flash)
    return colour, white


def main():
    sheet = Image.new("RGBA", (W, SHEET_H))
    for i, im in enumerate((safari(), hoenn(), route101(), battle(), event())):
        sheet.paste(im, (0, i * H))
    for i, im in enumerate(evolution_backdrop()):
        sheet.paste(im, (0, H * 5 + i * H))
    colour, white = mons()
    y = H * 5 + H * len(EVO_FRAMES)
    for i, (c, w) in enumerate(zip(colour, white)):
        sheet.paste(c, (i * 64, y))
        sheet.paste(w, (i * 64, y + 64))
    sheet.save(OUT, optimize=True)
    print(f"{OUT.relative_to(ROOT)} {sheet.size[0]}x{sheet.size[1]}, {OUT.stat().st_size} bytes")


if __name__ == "__main__":
    main()
