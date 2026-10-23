#!/usr/bin/env python3
"""Check tools/br/drivers/seam-world.txt: over a seam, gBrWorld's anchor is the grid's.

    bash tools/br/drive.sh seam-world | python3 tools/br/seam-world.py

gBrWorld's lcdY less its vofs is where the ring's row 0 sits on the backup grid: the same
on every frame of one map, whatever the scroll. At "mid" a VBlank has landed inside
CameraMove's load of ROUTE 110 (gBrMidFrame 1, pos in ROUTE 110's frame, the step not
yet added): the grid the core reads is ROUTE 110's from then on, so the anchor has to be
ROUTE 110's too, as on the whole frames after it (HBR-58). Held to the old map's, the band
past the LCD draws a map's height off for that frame.
"""
import re
import struct
import sys

POINTS = ("before", "mid", "mid2", "after", "after2")
OLD, NEW = 2, 25  # MAUVILLE CITY, ROUTE 110 (map group 0)


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


def dist(v):
    """A 9-bit scroll's distance, in [-256, 256) (ScrollDistance, br_field.c)."""
    return ((v & 0x1FF) ^ 0x100) - 0x100


def main():
    dumps = parse(sys.stdin.read())
    bad, anchor = [], {}
    for p in POINTS:
        if len(dumps.get(p, [])) != 2:
            print(f"FAIL {p}: no dumps")
            return 1
        world, pos = dumps[p]
        hofs, vofs, lcd_x, lcd_y = struct.unpack_from("<HHhh", world)
        x, y = struct.unpack_from("<hh", pos)
        m = pos[5]
        a = (lcd_x - dist(hofs), lcd_y - dist(vofs))
        print(f"{p}: map {m} pos {x},{y} scroll {hofs},{vofs} lcd {lcd_x},{lcd_y} ring origin {a[0]},{a[1]}")
        if m not in (OLD, NEW):
            bad.append(f"{p}: on map {m}, not the walk's")
            continue
        if anchor.setdefault(m, a) != a:
            bad.append(f"{p}: the ring's origin is {a[0]},{a[1]} on map {m}, {anchor[m][0]},{anchor[m][1]} on its other frames")
    if dumps["mid"][1][5] != NEW:
        bad.append("mid: the VBlank did not land inside the load (the walk changed)")
    if OLD not in anchor or NEW not in anchor:
        bad.append("the walk did not cross the seam")
    for b in bad:
        print("FAIL " + b)
    print("ok" if not bad else f"{len(bad)} failed")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
