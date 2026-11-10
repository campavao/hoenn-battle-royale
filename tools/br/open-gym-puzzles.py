#!/usr/bin/env python3
"""Gym puzzles the page cannot play, opened in the page's world.

    python tools/br/open-gym-puzzles.py   -> web/spike-b/data/world.json, in place

MAUVILLE's gym is a switch puzzle: four floor switches (field_specials.c
MauvilleGymPressSwitch) raise and drop its electric beams, and the layout ships with three
of them up (the beams' "On" metatiles with their collision bit set: the pair across
Wattson's room at y=7, the pair at (4..5, 14) and the pair at (1..2, 11)). The page's grid is
that layout, and walking has no switches, so Wattson's room was shut for good and the gym
could not be finished (Cam, 2026-11-10: "audit every gym"). This lays the grid as
MauvilleGymDeactivatePuzzle leaves it, the state the game itself sets once Wattson falls: the
beams are off, passable; the poles stay walls.

web/spike-b/main.ts paints the same metatiles (MAUVILLE_BEAMS_OFF) so what is drawn is what
is walked.

Idempotent: run it again and nothing changes.
"""
import importlib.util
import json
import os
import struct

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
spec = importlib.util.spec_from_file_location("export_world", os.path.join(ROOT, "tools", "br", "export-world.py"))
ew = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ew)

# metatile_labels.h: METATILE_MauvilleGym_{Green,Red}BeamH{3,4}_On, the beams that carry
# MAPGRID_IMPASSABLE in the layout, and the ids MauvilleGymDeactivatePuzzle swaps them for.
BEAMS_OFF = {0x228: 0x238, 0x229: 0x239, 0x22A: 0x23A, 0x22B: 0x23B}


def decode(grid, cells):
    out = []
    for token in filter(None, grid.split(";")):
        count, value = token.split("x")
        out += [int(value)] * int(count)
    return (out + [0] * cells)[:cells]


def main():
    path = os.path.join(ROOT, "web", "spike-b", "data", "world.json")
    with open(path, encoding="utf-8", newline="") as f:
        world = json.load(f)
    mj = ew.load_json("data", "maps", "MauvilleCity_Gym", "map.json")
    layout = ew.load_layouts()[mj["layout"]]
    raw = open(ew.rp(layout["blockdata_filepath"]), "rb").read()
    blocks = struct.unpack("<%dH" % (len(raw) // 2), raw)
    m = next(x for x in world["maps"] if x["id"] == mj["id"])
    n = m["w"] * m["h"]
    grid, elev = decode(m["grid"], n), decode(m["elev"], n)
    opened = []
    for i, val in enumerate(blocks[:n]):
        if (val & ew.MAPGRID_METATILE_ID_MASK) in BEAMS_OFF and grid[i] == 1:
            grid[i] = 0
            elev[i] = val >> ew.MAPGRID_ELEVATION_SHIFT
            opened.append((i % m["w"], i // m["w"]))
    m["grid"], m["elev"] = ew.rle_encode(grid), ew.rle_encode(elev)
    with open(path, "w", encoding="utf-8", newline="") as f:
        json.dump(world, f, separators=(",", ":"))
    print(mj["id"], "opened", opened)


if __name__ == "__main__":
    main()
