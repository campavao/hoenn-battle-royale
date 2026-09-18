#!/usr/bin/env python3
"""Check the ROM's offscreen rule for the band past the LCD (POK-319).

    bash tools/br/drive.sh objects-band | python3 tools/br/objects-band.py

Reads the driver's dumps of gSpriteCoordOffsetX/Y, gObjectEvents (16 x 0x24) and
gSprites (64 x 0x44), and for every active object that is not the player asserts that
its sprite is invisible exactly when BrField_OffScreen (src/br/br_field.c) says so:

    x >= 240 + 16 + 16  or  x + width < -16  or  y >= 160 + 56  or  y < -40

with (x, y) the sprite's top-left the way UpdateObjectEventOffscreen computes it. The
widths come from the sprite sheets the page exports (web/src/data/sprites.json), keyed
by graphics id. Exits 1 on any mismatch, and 2 when no object was in the band at all --
a driver that never puts anyone out there proves nothing.
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SHEETS = json.loads((ROOT / "web/src/data/sprites.json").read_text(encoding="utf-8"))

BAND_LEFT, BAND_TOP, BAND_RIGHT, BAND_BOTTOM = 0, 40, 16, 56
OBJ_SIZE, OBJ_COUNT = 0x24, 16
SPR_SIZE = 0x44


def s16(v):
    return v - 0x10000 if v & 0x8000 else v


def s8(v):
    return v - 0x100 if v & 0x80 else v


def parse(text):
    """The harness prints `dump 0xADDR:` then rows of hex bytes; `say` lines name them."""
    dumps = {}
    name = None
    cur = None
    for line in text.splitlines():
        if line.startswith("dump 0x"):
            cur = bytearray()
            dumps[name] = dumps.get(name, []) + [cur]
        elif line.startswith("  ") and cur is not None:
            cur.extend(int(b, 16) for b in line.split())
        elif re.match(r"^[a-z][\w-]*$", line):
            name = line
            cur = None
    return dumps


def main():
    dumps = parse(sys.stdin.read())
    off_x = s16(int.from_bytes(dumps["coord-offset"][0], "little"))
    off_y = s16(int.from_bytes(dumps["coord-offset"][1], "little"))
    objs = dumps["objects"][0]
    sprs = dumps["sprites"][0]
    bad = 0
    in_band = 0
    seen = 0
    for i in range(OBJ_COUNT):
        o = objs[i * OBJ_SIZE:(i + 1) * OBJ_SIZE]
        if not (o[0] & 1) or (o[2] & 1):  # inactive, or the player
            continue
        gfx = o[5]
        if o[1] & 0x20:  # the object's own invisible bit: hidden for other reasons
            print(f"obj {i:2} gfx {gfx:3} hidden by its own invisible bit; skipped")
            continue
        sheet = SHEETS.get(str(gfx))
        if not sheet:
            print(f"obj {i:2} gfx {gfx:3} has no sheet in sprites.json; skipped")
            continue
        s = sprs[o[4] * SPR_SIZE:(o[4] + 1) * SPR_SIZE]
        flags = int.from_bytes(s[0x3E:0x40], "little")
        on_camera = bool(flags & 2)
        x = s16(int.from_bytes(s[0x20:0x22], "little")) + s16(int.from_bytes(s[0x24:0x26], "little")) + s8(s[0x28]) + (off_x if on_camera else 0)
        y = s16(int.from_bytes(s[0x22:0x24], "little")) + s16(int.from_bytes(s[0x26:0x28], "little")) + s8(s[0x29]) + (off_y if on_camera else 0)
        invisible = bool(flags & 4)
        want = x >= 240 + BAND_RIGHT + 16 or x + sheet["w"] < -BAND_LEFT - 16 or y >= 160 + BAND_BOTTOM or y < -BAND_TOP
        on_lcd = 0 <= x < 240 and 0 <= y < 160
        band = not want and not on_lcd
        in_band += band
        seen += 1
        mark = "band" if band else ("lcd" if on_lcd else "off")
        ok = invisible == want
        bad += not ok
        print(f"obj {i:2} gfx {gfx:3} at ({x:4},{y:4}) {sheet['w']}x{sheet['h']} {mark:4} invisible={int(invisible)} want={int(want)} {'ok' if ok else 'MISMATCH'}")
    print(f"{seen} objects, {in_band} in the band, {bad} wrong")
    if bad:
        sys.exit(1)
    if not in_band:
        sys.exit(2)


if __name__ == "__main__":
    main()
