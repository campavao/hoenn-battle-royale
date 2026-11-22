#!/usr/bin/env python3
"""The MACH BIKE's two floors, into the page's world.

    python tools/br/export-bike-floors.py   -> web/spike-b/data/world.json, in place

Emerald has two kinds of ground that only the MACH BIKE at full speed gets over, and the
page's grid had both as plain floor (Cam, play-test 2026-11-22: "these spots are supposed to
fall through", "allowing folks to walk up and down without bike"). This adds, to each map
that has any:

  `cracks`: [y * w + x, ...] its MB_CRACKED_FLOOR (and _HOLE) cells, and `hole`: the map
            below, the one its scripts' setholewarp names. Step onto one slower than the
            MACH BIKE's top speed and you fall through, onto the same cell of `hole`
            (field_tasks.c CrackedFloorPerStepCallback, data/scripts/cave_hole.inc); ride
            over it at speed and it breaks behind you.
  `slopes`: [y * w + x, ...] its MB_MUDDY_SLOPE cells. Anybody on one slides south unless
            they are heading north on the MACH BIKE at its top speed
            (field_player_avatar.c ForcedMovement_MuddySlope).
  `bike`:   true on a map that is not outdoors but has either, where Emerald lets you ride
            (map.json allow_cycling): the page rides only outdoors otherwise, and these are
            nothing without the bike.

Not the Safari Zone's slope: the page's Zone has the ACRO BIKE alone (sim.ts), which no slope
lets up, and its spawn cells are past it.

Only cells with no collision bits, as the walker's own grid has them. The grid itself is not
touched: a crack is floor (class 0) or, on SKY PILLAR 4F, the hole warp export-world.py lays
for the bots, who never ride; a slope is floor, and web/src/bots/world.ts makes it one-way.

Idempotent: run it again and nothing changes.
"""
import importlib.util
import json
import os
import re
import struct

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
spec = importlib.util.spec_from_file_location("export_world", os.path.join(ROOT, "tools", "br", "export-world.py"))
ew = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ew)

CRACK = {"MB_CRACKED_FLOOR", "MB_CRACKED_FLOOR_HOLE"}
assert CRACK == ew.CRACKED_BEHAVIORS
SLOPE = {"MB_MUDDY_SLOPE"}


def hole_below(folder):
    """The map a hole on this one drops you to: its scripts' setholewarp, or None."""
    try:
        with open(ew.rp("data", "maps", folder, "scripts.inc"), encoding="utf-8") as f:
            text = f.read()
    except OSError:
        return None
    m = re.search(r"setholewarp\s+(MAP_\w+)", text)
    return m.group(1) if m else None


def cells_of(mj, layouts, kinds):
    """[y * w + x] of the map's cells with one of `kinds`' behaviours and no collision bits."""
    layout = layouts.get(ew.LAYOUT_AS_PLAYED.get(mj["id"], mj["layout"]))
    primary = ew.load_metatile_attrs(ew.resolve_tileset_dir(layout["primary_tileset"], "primary"))
    second = ew.resolve_tileset_dir(layout.get("secondary_tileset"), "secondary")
    secondary = ew.load_metatile_attrs(second) if second else None
    raw = open(ew.rp(layout["blockdata_filepath"]), "rb").read()
    out = []
    for i, val in enumerate(struct.unpack("<%dH" % (len(raw) // 2), raw)):
        name = ew.metatile_behavior_name(primary, secondary, val & ew.MAPGRID_METATILE_ID_MASK)
        if name in kinds and not val & ew.MAPGRID_COLLISION_MASK:
            out.append(i)
    return out


def main():
    path = os.path.join(ROOT, "web", "spike-b", "data", "world.json")
    with open(path, encoding="utf-8", newline="") as f:
        world = json.load(f)
    have = {m["id"] for m in world["maps"]}
    layouts = ew.load_layouts()
    by_id = {}
    for _, _, folder in ew.load_map_order():
        mj = ew.load_json("data", "maps", folder, "map.json")
        by_id[mj["id"]] = (folder, mj)
    for m in world["maps"]:
        for k in ("cracks", "hole", "slopes", "bike"):
            m.pop(k, None)
        if m["id"] not in by_id:
            continue
        folder, mj = by_id[m["id"]]
        below = hole_below(folder)
        cracks = cells_of(mj, layouts, CRACK) if below in have else []
        slopes = [] if m["id"].startswith("MAP_SAFARI_ZONE") else cells_of(mj, layouts, SLOPE)
        if cracks:
            m["cracks"], m["hole"] = cracks, below
        if slopes:
            m["slopes"] = slopes
        if (cracks or slopes) and not m["outdoor"] and mj.get("allow_cycling"):
            m["bike"] = True
        if cracks or slopes:
            print(m["id"], "cracks", len(cracks), "->", below if cracks else "-", "slopes", len(slopes), "bike" if m.get("bike") else "")
    with open(path, "w", encoding="utf-8", newline="") as f:
        json.dump(world, f, separators=(",", ":"))


if __name__ == "__main__":
    main()
