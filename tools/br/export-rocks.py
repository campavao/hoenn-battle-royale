#!/usr/bin/env python3
"""ROCK SMASH's rocks, as a class of their own in the page's world.

    python tools/br/export-rocks.py   -> web/spike-b/data/world.json and
                                         web/src/data/world.json, in place

export-world.py laid a Rock Smash rock (OBJ_EVENT_GFX_BREAKABLE_ROCK) as class 9, the cut
tree's class, so a team with CUT broke rocks and one with only ROCK SMASH stood at them, and
the HUD lit CUT at a rock (11-22). export-world.py now lays rocks as class 11; this moves the
committed worlds over without a whole re-export (later in-place passes, export-acro.py,
open-gym-puzzles.py and the rest, have edited them since). Each rock's cell that is class 9
becomes 11; nothing else is touched.

Idempotent: run it again and nothing changes.
"""
import glob
import importlib.util
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
spec = importlib.util.spec_from_file_location("export_world", os.path.join(ROOT, "tools", "br", "export-world.py"))
ew = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ew)

CLASS_CUT, CLASS_SMASH = 9, 11


def decode(grid, cells):
    out = []
    for token in filter(None, grid.split(";")):
        count, value = token.split("x")
        out += [int(value)] * int(count)
    return (out + [0] * cells)[:cells]


def rocks():
    """Every map's Rock Smash rocks: {map id: [(x, y), ...]}."""
    out = {}
    for path in glob.glob(os.path.join(ROOT, "data", "maps", "*", "map.json")):
        mj = json.load(open(path, encoding="utf-8"))
        cells = [(oe["x"], oe["y"]) for oe in mj.get("object_events") or [] if oe.get("graphics_id") == ew.ROCK_SMASH_GFX]
        if cells:
            out[mj["id"]] = cells
    return out


def main():
    found = rocks()
    for rel in (("web", "spike-b", "data", "world.json"), ("web", "src", "data", "world.json")):
        path = os.path.join(ROOT, *rel)
        with open(path, encoding="utf-8", newline="") as f:
            world = json.load(f)
        moved = 0
        for m in world["maps"]:
            cells = found.get(m["id"])
            if not cells:
                continue
            w, h = m["w"], m["h"]
            grid = decode(m["grid"], w * h)
            for x, y in cells:
                if 0 <= x < w and 0 <= y < h and grid[y * w + x] == CLASS_CUT:
                    grid[y * w + x] = CLASS_SMASH
                    moved += 1
            m["grid"] = ew.rle_encode(grid)
        with open(path, "w", encoding="utf-8", newline="") as f:
            json.dump(world, f, separators=(",", ":"))
        print("/".join(rel), moved, "rocks now ROCK SMASH")


if __name__ == "__main__":
    main()
