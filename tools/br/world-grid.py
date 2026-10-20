#!/usr/bin/env python3
"""Check tools/br/drivers/world-grid.txt: gBrWorld's LCD anchor follows the camera.

    bash tools/br/drive.sh world-grid | python3 tools/br/world-grid.py

At each named point ("tall", "tall-right" on the tall ring; "wide", "wide-down" after
gBrFieldShown asks for the wide one) reads gBrWorld (include/br/br_field.h) and the
player's pos. Asserts, standing, lcdX == pos.x*16 and lcdY == pos.y*16 + 40 -- the LCD's
top-left on the backup grid -- and that the walk did move the player, so a frozen anchor
cannot pass.
"""
import re
import struct
import sys

POINTS = ("tall", "tall-right", "wide", "wide-down")


def parse(text):
    dumps, name, cur = {}, None, None
    for line in text.splitlines():
        if line.startswith("dump 0x"):
            cur = bytearray()
            dumps.setdefault(name, []).append(cur)
        elif line.startswith("  ") and cur is not None:
            cur.extend(int(b, 16) for b in line.split())
        elif re.match(r"^[a-z][\w-]*$", line):
            name, cur = line, None
    return dumps


def main():
    dumps = parse(sys.stdin.read())
    bad, seen = [], {}
    for p in POINTS:
        if len(dumps.get(p, [])) != 2:
            print(f"FAIL {p}: no dumps")
            return 1
        world, pos = dumps[p]
        hofs, vofs, lcd_x, lcd_y = struct.unpack_from("<HHhh", world)
        x, y = struct.unpack_from("<hh", pos)
        seen[p] = (x, y)
        want = (x * 16, y * 16 + 40)
        print(f"{p}: pos {x},{y} scroll {hofs},{vofs} lcd {lcd_x},{lcd_y} want {want[0]},{want[1]}")
        if (lcd_x, lcd_y) != want:
            bad.append(f"{p}: the LCD's top-left is {lcd_x},{lcd_y}, the camera's {want[0]},{want[1]}")
    if seen["tall-right"][0] != seen["tall"][0] + 1:
        bad.append("tall-right: the player did not step right")
    if seen["wide"][0] != seen["tall-right"][0] - 1:
        bad.append("wide: the player did not step left")
    if seen["wide-down"][1] != seen["wide"][1] + 1:
        bad.append("wide-down: the player did not step down")
    for b in bad:
        print("FAIL " + b)
    print("ok" if not bad else f"{len(bad)} failed")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
