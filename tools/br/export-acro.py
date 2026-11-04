#!/usr/bin/env python3
"""The ACRO BIKE's ground, into the page's world.

    python tools/br/export-acro.py   -> web/spike-b/data/world.json, in place

The page's field runs on web/spike-b/data/world.json, a walker's grid of cell classes: a
rail or a bumpy slope is class 1, a wall, to everybody who walks, and that stays (bots,
tap-to-walk and the landing reach all read it). This adds, to each map that has any,
`acro`: [[y * w + x, kind], ...] from the map's own metatile behaviours, for the one rider
who may go there (web/spike-b/sim.ts):

  kind 1  MB_BUMPY_SLOPE                hopped up, B held (COLLISION_WHEELIE_HOP)
       2  MB_ISOLATED_VERTICAL_RAIL     only jumped onto, from the side
       3  MB_ISOLATED_HORIZONTAL_RAIL
       4  MB_VERTICAL_RAIL              ridden along, jumped onto from the side
       5  MB_HORIZONTAL_RAIL

A cell whose collision bits are set is a wall to the ACRO BIKE too (four of Route 119's,
GetCollisionAtCoords comes first), so it is not listed.

The other two things it does to those cells:
  - `elev` gets each cell's real height back. export-world.py lets a wall carry the height
    before it, as nobody asks a wall's; a rider stands on one and steps off it.
  - The Safari Zone's are made walls here. export-world.py leaves them ground because
    no bike rode there, and /classic/ still runs on web/src/data/world.json's grid.

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

KIND = {
    "MB_BUMPY_SLOPE": 1,
    "MB_ISOLATED_VERTICAL_RAIL": 2,
    "MB_ISOLATED_HORIZONTAL_RAIL": 3,
    "MB_VERTICAL_RAIL": 4,
    "MB_HORIZONTAL_RAIL": 5,
}
assert set(KIND) == ew.ACRO_BEHAVIORS


def decode(grid, cells):
    out = []
    for token in filter(None, grid.split(";")):
        count, value = token.split("x")
        out += [int(value)] * int(count)
    return (out + [0] * cells)[:cells]


def acro_cells(mj, layouts):
    """[(cell, kind, height)] of the map's ACRO ground with no collision bits."""
    layout = layouts.get(ew.LAYOUT_AS_PLAYED.get(mj["id"], mj["layout"]))
    primary = ew.load_metatile_attrs(ew.resolve_tileset_dir(layout["primary_tileset"], "primary"))
    second = ew.resolve_tileset_dir(layout.get("secondary_tileset"), "secondary")
    secondary = ew.load_metatile_attrs(second) if second else None
    raw = open(ew.rp(layout["blockdata_filepath"]), "rb").read()
    out = []
    for i, val in enumerate(struct.unpack("<%dH" % (len(raw) // 2), raw)):
        kind = KIND.get(ew.metatile_behavior_name(primary, secondary, val & ew.MAPGRID_METATILE_ID_MASK))
        if kind and not val & ew.MAPGRID_COLLISION_MASK:
            out.append((i, kind, val >> ew.MAPGRID_ELEVATION_SHIFT))
    return out


def main():
    path = os.path.join(ROOT, "web", "spike-b", "data", "world.json")
    with open(path, encoding="utf-8", newline="") as f:
        world = json.load(f)
    layouts = ew.load_layouts()
    by_id = {}
    for _, _, folder in ew.load_map_order():
        mj = ew.load_json("data", "maps", folder, "map.json")
        by_id[mj["id"]] = mj
    total = 0
    for m in world["maps"]:
        mj = by_id.get(m["id"])
        cells = acro_cells(mj, layouts) if mj else []
        if not cells:
            continue
        n = m["w"] * m["h"]
        grid, elev = decode(m["grid"], n), decode(m.get("elev", ""), n)
        for cell, _, height in cells:
            # A warp painted over one stays the door it is, in class and in height.
            if grid[cell] in (0, 1):
                grid[cell] = 1
                elev[cell] = height
        cells = [c for c in cells if grid[c[0]] == 1]
        m["grid"], m["elev"] = ew.rle_encode(grid), ew.rle_encode(elev)
        m["acro"] = [[cell, kind] for cell, kind, _ in cells]
        total += len(cells)
        print(m["id"], len(cells))
    with open(path, "w", encoding="utf-8", newline="") as f:
        json.dump(world, f, separators=(",", ":"))
    print("acro cells:", total)


if __name__ == "__main__":
    main()
