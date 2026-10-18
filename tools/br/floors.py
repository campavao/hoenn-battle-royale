#!/usr/bin/env python3
"""Every floor gets something (Cam, 2026-10-18): "an item, trader, or both on every floor
of a place in a town or in the wild". This finds the floors and writes br_balls.c's two
tables from them, so a map nobody thought of is not left empty.

A floor is a map you can walk into from a town or route (warps and connections, never
through a closed door, br_match.c) that is not a town or route itself, is not a Centre,
a Mart, a Gym, a link room, an elevator or the TRICK HOUSE's or the MYSTERY EVENTS
house's, and has a region-map section (the rest are the Frontier's and the like, out of
the match).

  sFloors       every floor with none of its own item balls and not already a house
                (sHouses): one cache each.
  sTraderFloors every floor of BIG_FLOOR walkable cells or more: somebody standing there
                who trades a Pokemon for one of yours, beside the cache if it has one.

  tools/br/floors.py           print the census
  tools/br/floors.py --write   rewrite the tables in src/br/br_balls.c
  tools/br/floors.py --check   fail if the tables are not what --write would write (CI)
"""
import importlib.util
import json
import os
import re
import struct
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
BALLS_C = os.path.join(ROOT, "src", "br", "br_balls.c")

spec = importlib.util.spec_from_file_location("export_world", os.path.join(HERE, "export-world.py"))
ew = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ew)

BIG_FLOOR = 150
# br_balls.c's BR_FLOOR_REPEAT: a metatile laid this often is the map's floor.
FLOOR_REPEAT = 3
# CacheCellOk's floor behaviours.
FLOOR = {"MB_NORMAL", "MB_CAVE", "MB_INDOOR_ENCOUNTER", "MB_MOUNTAIN_TOP"}
MAP_OFFSET = 7

# br_match.c's sClosedDoors: the walk stops at these.
CLOSED = {
    "MAP_LITTLEROOT_TOWN_PROFESSOR_BIRCHS_LAB",
    "MAP_FALLARBOR_TOWN_BATTLE_TENT_LOBBY",
    "MAP_VERDANTURF_TOWN_BATTLE_TENT_LOBBY",
    "MAP_SLATEPORT_CITY_BATTLE_TENT_LOBBY",
    "MAP_ROUTE110_TRICK_HOUSE_ENTRANCE",
    "MAP_ROUTE121_SAFARI_ZONE_ENTRANCE",
    "MAP_EVER_GRANDE_CITY_HALL5",
}
NOT_A_FLOOR = re.compile(
    r"POKEMON_CENTER|_MART$|_GYM|UNION_ROOM|TRADE_CENTER|ELEVATOR|UNDERWATER|MYSTERY_EVENTS"
    r"|TRAINER_HILL_(?!ENTRANCE)|POKEMON_LEAGUE_2F"
)


def walk_maps():
    order = ew.load_map_order()
    mg = ew.load_json("data", "maps", "map_groups.json")
    maps = {}
    for group, num, folder in order:
        mj = ew.load_json("data", "maps", folder, "map.json")
        maps[mj["id"]] = (mg["group_order"][group], mj)
    start = [i for i, (g, _) in maps.items() if g == "gMapGroup_TownsAndRoutes"]
    seen, todo = set(start), list(start)
    while todo:
        mj = maps[todo.pop()][1]
        nexts = [w["dest_map"] for w in mj.get("warp_events", [])]
        nexts += [c["map"] for c in mj.get("connections") or []]
        for d in nexts:
            if d in maps and d not in seen and d not in CLOSED:
                seen.add(d)
                todo.append(d)
    return maps, seen


def cache_cells(mj, layouts):
    """How many cells br_balls.c's CacheCellOk takes, read off the same data."""
    layout = layouts[ew.LAYOUT_AS_PLAYED.get(mj["id"], mj["layout"])]
    w, h = layout["width"], layout["height"]
    prim = ew.load_metatile_attrs(ew.resolve_tileset_dir(layout["primary_tileset"], "primary"))
    sec_dir = ew.resolve_tileset_dir(layout.get("secondary_tileset"), "secondary")
    sec = ew.load_metatile_attrs(sec_dir) if sec_dir else None
    raw = open(ew.rp(layout["blockdata_filepath"]), "rb").read()
    cells = struct.unpack("<%dH" % (w * h), raw)
    warps = [(e["x"], e["y"]) for e in mj.get("warp_events", [])]
    objs = {(e["x"], e["y"]) for e in mj.get("object_events", [])}
    laid = {}
    for v in cells:
        laid[v & ew.MAPGRID_METATILE_ID_MASK] = laid.get(v & ew.MAPGRID_METATILE_ID_MASK, 0) + 1
    walk = cache = 0
    for y in range(h):
        for x in range(w):
            v = cells[y * w + x]
            if (v & ew.MAPGRID_COLLISION_MASK) != 0:
                continue
            walk += 1
            if ew.metatile_behavior_name(prim, sec, v & ew.MAPGRID_METATILE_ID_MASK) not in FLOOR:
                continue
            if y + 1 >= h or (cells[(y + 1) * w + x] & ew.MAPGRID_COLLISION_MASK) != 0:
                continue
            if any(abs(x - wx) + abs(y - wy) <= 2 for wx, wy in warps) or (x, y) in objs:
                continue
            if laid[v & ew.MAPGRID_METATILE_ID_MASK] < FLOOR_REPEAT:
                continue
            cache += 1
    return walk, cache


def houses():
    src = open(BALLS_C, encoding="utf-8").read()
    body = re.search(r"sHouses\[\] =\s*\{(.*?)\};", src, re.S).group(1)
    return set(re.findall(r"MAP_\w+", body))


def census():
    maps, seen = walk_maps()
    layouts = ew.load_layouts()
    rows = []
    for map_id in sorted(seen):
        group, mj = maps[map_id]
        if group == "gMapGroup_TownsAndRoutes" or NOT_A_FLOOR.search(map_id):
            continue
        if mj.get("region_map_section", "MAPSEC_NONE") == "MAPSEC_NONE":
            continue
        balls = sum(1 for o in mj.get("object_events", []) if o.get("graphics_id") == "OBJ_EVENT_GFX_ITEM_BALL")
        walk, cache = cache_cells(mj, layouts)
        rows.append((map_id, balls, walk, cache))
    return rows


def tables(rows):
    inhouse = houses()
    floors = [r[0] for r in rows if r[1] == 0 and r[0] not in inhouse]
    traders = [r[0] for r in rows if r[2] >= BIG_FLOOR]
    # A house's person and a trader would stand on the same cell (br_balls.c's Tick).
    both = inhouse.intersection(traders)
    if both:
        sys.exit("a house is big enough for a trader: %s" % ", ".join(sorted(both)))
    return floors, traders


def c_list(name, ids):
    lines = ["static const u16 %s[] =" % name, "{"]
    for i in range(0, len(ids), 2):
        lines.append("    " + " ".join(m + "," for m in ids[i:i + 2]))
    lines.append("};")
    return "\n".join(lines)


def rewrite(src, floors, traders):
    for name, ids in (("sFloors", floors), ("sTraderFloors", traders)):
        pat = re.compile(r"static const u16 %s\[\] =\n\{.*?\n\};" % name, re.S)
        if not pat.search(src):
            sys.exit("no %s table in %s" % (name, BALLS_C))
        src = pat.sub(lambda _: c_list(name, ids), src)
    return src


def short(rows, floors, traders, inhouse):
    """Floors whose cache or trader has no cell to stand on: the ROM would put nothing."""
    out = []
    for map_id, _, _, cache in rows:
        need = (map_id in floors or map_id in inhouse) + (map_id in traders)
        if cache < need:
            out.append(map_id)
    return out


def main():
    rows = census()
    floors, traders = tables(rows)
    inhouse = houses()
    empty = short(rows, floors, traders, inhouse)
    if "--write" in sys.argv or "--check" in sys.argv:
        src = open(BALLS_C, encoding="utf-8").read()
        new = rewrite(src, floors, traders)
        if "--check" in sys.argv:
            if new != src:
                sys.exit("src/br/br_balls.c's floor tables are stale: run tools/br/floors.py --write")
            if empty:
                sys.exit("no cell for a cache or trader on: %s" % ", ".join(empty))
            print("floors: %d caches, %d traders, every floor has something" % (len(floors), len(traders)))
            return
        open(BALLS_C, "w", encoding="utf-8", newline="\n").write(new)
        print("wrote %d floors, %d trader floors" % (len(floors), len(traders)))
        return
    for map_id, balls, walk, cache in rows:
        what = []
        if balls:
            what.append("%d ball%s" % (balls, "s" if balls > 1 else ""))
        if map_id in inhouse:
            what.append("house cache")
        if map_id in floors:
            what.append("cache")
        if map_id in traders:
            what.append("trader")
        warn = "  NO CELL" if map_id in empty else ""
        print("%-48s %4d walk %4d free  %s%s" % (map_id, walk, cache, ", ".join(what), warn))
    print("%d floors: %d new caches, %d traders" % (len(rows), len(floors), len(traders)))


if __name__ == "__main__":
    main()
