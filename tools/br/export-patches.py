#!/usr/bin/env python3
"""POK-363: every cell a patch can be dealt on, per map, for the page's bots.

A patch (src/br/br_patch.c) is dealt by each ROM off the map as it ships: the cells a
wild battle could start on (Eligible), in row order, and the seed's picks among them.
The bots run in the page and never see a ROM's gBrPatch, so a bot walked straight over
the spots everybody else could see. This writes the same cell list, and
web/src/bots/patches.ts deals from it the way Pick() does.

Eligible, cell for cell:
  - no collision bits on the block;
  - a land table and a behaviour with encounters that is not surfable, or a water
    table and one with encounters that is surfable (MetatileBehavior_Is{Land,Water}
    WildEncounter, off sTileBitAttributes);
  - not where one of the map's object events stands (all of them, stripped or not:
    gMapHeader.events is the shipped list).

Writes web/src/data/patches.json:
  { "<MAP_ID>": { "header": n, "w": width, "runs": "start+len,start+len,..." } }
`start` indexes the layout row-major (y * w + x, no MAP_OFFSET); only maps with a wild
header and at least one eligible cell are listed.
"""
import importlib.util
import json
import os
import re
import struct

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("export_world", os.path.join(HERE, "export-world.py"))
world = importlib.util.module_from_spec(spec)
spec.loader.exec_module(world)

rp = world.rp


def tile_flags():
    text = open(rp("src", "metatile_behavior.c"), encoding="utf-8").read()
    body = re.search(r"sTileBitAttributes\[[^\]]*\]\s*=\s*\{(.*?)\};", text, re.S).group(1)
    flags = {}
    for m in re.finditer(r"\[(MB_\w+)\]\s*=\s*([^,\n]+)", body):
        names = m.group(2)
        flags[world.MB[m.group(1)]] = (
            ("TILE_FLAG_HAS_ENCOUNTERS" in names) * 1 | ("TILE_FLAG_SURFABLE" in names) * 2
        )
    return flags


def runs_of(cells):
    out = []
    start = prev = None
    for c in cells:
        if start is None:
            start = prev = c
        elif c == prev + 1:
            prev = c
        else:
            out.append(f"{start}+{prev - start + 1}")
            start = prev = c
    if start is not None:
        out.append(f"{start}+{prev - start + 1}")
    return ",".join(out)


def main():
    flags = tile_flags()
    layouts = world.load_layouts()
    folders = {}
    for group, num, folder in world.load_map_order():
        mj = world.load_json("data", "maps", folder, "map.json")
        folders[mj["id"]] = mj
    wild = world.load_json("src", "data", "wild_encounters.json")["wild_encounter_groups"][0]
    assert wild["label"] == "gWildMonHeaders"
    out = {}
    for header, enc in enumerate(wild["encounters"]):
        map_id = enc["map"]
        # HeaderOf takes the first row for a map, and a key holds seven bits of header.
        if map_id in out or header >= 0x80 or map_id not in folders:
            continue
        land, water = "land_mons" in enc, "water_mons" in enc
        mj = folders[map_id]
        layout = layouts[world.LAYOUT_AS_PLAYED.get(map_id, mj["layout"])]
        w, h = layout["width"], layout["height"]
        primary = world.load_metatile_attrs(world.resolve_tileset_dir(layout["primary_tileset"], "primary"))
        sec_dir = world.resolve_tileset_dir(layout.get("secondary_tileset"), "secondary")
        secondary = world.load_metatile_attrs(sec_dir) if sec_dir else None
        raw = open(rp(layout["blockdata_filepath"]), "rb").read()
        blocks = struct.unpack("<%dH" % (len(raw) // 2), raw)
        people = {(o["x"], o["y"]) for o in mj.get("object_events", [])}
        cells = []
        for y in range(h):
            for x in range(w):
                val = blocks[y * w + x]
                if (val & world.MAPGRID_COLLISION_MASK) >> world.MAPGRID_COLLISION_SHIFT:
                    continue
                metatile = val & world.MAPGRID_METATILE_ID_MASK
                if metatile < world.NUM_METATILES_IN_PRIMARY:
                    beh = primary[metatile] if metatile < len(primary) else 0
                else:
                    i = metatile - world.NUM_METATILES_IN_PRIMARY
                    beh = secondary[i] if secondary and i < len(secondary) else 0
                f = flags.get(beh, 0)
                if not (f & 1):
                    continue
                if not ((land and not (f & 2)) or (water and (f & 2))):
                    continue
                if (x, y) in people:
                    continue
                cells.append(y * w + x)
        if cells:
            out[map_id] = {"header": header, "w": w, "runs": runs_of(cells)}
    path = rp("web", "src", "data", "patches.json")
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(out, f, separators=(",", ":"), sort_keys=True)
        f.write("\n")
    print(f"{len(out)} maps -> {os.path.relpath(path, rp())} ({os.path.getsize(path)} bytes)")


if __name__ == "__main__":
    main()
