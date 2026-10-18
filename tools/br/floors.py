#!/usr/bin/env python3
"""Every floor gets something (Cam, 2026-10-18; POK-413): "an item, trader, or both on
every floor of a place in a town or in the wild". This finds the floors, picks where on
each the things stand, and writes br_balls.c's sRooms from them, so a map nobody thought
of is not left empty and nothing is put where nobody can reach it.

A floor is a map you can walk into from a town or route (warps and connections, never
through a closed door, br_match.c) that is not a town or route itself, is not a Centre,
a Mart, a Gym, a link room, an elevator, the Trainer Hill's challenge or the MYSTERY
EVENTS house, and has a region-map section (the rest are the Frontier's and the like,
out of the match). A room is a floor that gets something:

  every house (HOUSES, in the order its keys were dealt in): a cache, and one in eight
  of them somebody at home (POK-379)
  every other floor with none of its own item balls: a cache
  every floor of BIG_FLOOR cells or more you can walk to: somebody who trades

Both stand where floor.py's Pick says: on a floor tile you can walk to from a door, from
the middle of the room outward.

  tools/br/floors.py           print the census
  tools/br/floors.py --write   rewrite sRooms in src/br/br_balls.c
  tools/br/floors.py --check   fail if sRooms is not what --write would write (CI)
"""
import importlib.util
import os
import re
import struct
import sys
from collections import deque

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
BALLS_C = os.path.join(ROOT, "src", "br", "br_balls.c")

spec = importlib.util.spec_from_file_location("export_world", os.path.join(HERE, "export-world.py"))
ew = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ew)

BIG_FLOOR = 150
# A metatile laid this often is the map's floor; a sofa or a desk's top is a tile or two
# of its own, open to walk on in places and no place for a ball.
FLOOR_REPEAT = 3
# Nothing is met by walking on a cave's floor, the ABANDONED SHIP's, MT. CHIMNEY's top or SKY
# PILLAR's sand now (no step encounters), so they are floor like any other.
FLOOR = {"MB_NORMAL", "MB_CAVE", "MB_INDOOR_ENCOUNTER", "MB_MOUNTAIN_TOP", "MB_SAND"}
# sRooms' key budget (br_balls.c asserts the same): a cache key's low byte, and the
# floor traders' 64 keys.
MAX_ROOMS = 0x100
MAX_TRADERS = 0x40

HOUSES = [
    "MAP_DEWFORD_TOWN_HOUSE1",
    "MAP_DEWFORD_TOWN_HOUSE2",
    "MAP_FALLARBOR_TOWN_COZMOS_HOUSE",
    "MAP_FALLARBOR_TOWN_MOVE_RELEARNERS_HOUSE",
    "MAP_FORTREE_CITY_HOUSE1",
    "MAP_FORTREE_CITY_HOUSE2",
    "MAP_FORTREE_CITY_HOUSE3",
    "MAP_FORTREE_CITY_HOUSE4",
    "MAP_FORTREE_CITY_HOUSE5",
    "MAP_LAVARIDGE_TOWN_HOUSE",
    "MAP_LILYCOVE_CITY_HOUSE1",
    "MAP_LILYCOVE_CITY_HOUSE2",
    "MAP_LILYCOVE_CITY_HOUSE3",
    "MAP_LILYCOVE_CITY_HOUSE4",
    "MAP_LILYCOVE_CITY_MOVE_DELETERS_HOUSE",
    "MAP_LITTLEROOT_TOWN_BRENDANS_HOUSE_1F",
    "MAP_LITTLEROOT_TOWN_BRENDANS_HOUSE_2F",
    "MAP_LITTLEROOT_TOWN_MAYS_HOUSE_1F",
    "MAP_LITTLEROOT_TOWN_MAYS_HOUSE_2F",
    "MAP_MAUVILLE_CITY_HOUSE1",
    "MAP_MAUVILLE_CITY_HOUSE2",
    "MAP_MOSSDEEP_CITY_HOUSE1",
    "MAP_MOSSDEEP_CITY_HOUSE2",
    "MAP_MOSSDEEP_CITY_HOUSE3",
    "MAP_MOSSDEEP_CITY_HOUSE4",
    "MAP_MOSSDEEP_CITY_STEVENS_HOUSE",
    "MAP_OLDALE_TOWN_HOUSE1",
    "MAP_OLDALE_TOWN_HOUSE2",
    "MAP_PACIFIDLOG_TOWN_HOUSE1",
    "MAP_PACIFIDLOG_TOWN_HOUSE2",
    "MAP_PACIFIDLOG_TOWN_HOUSE3",
    "MAP_PACIFIDLOG_TOWN_HOUSE4",
    "MAP_PACIFIDLOG_TOWN_HOUSE5",
    "MAP_PETALBURG_CITY_HOUSE1",
    "MAP_PETALBURG_CITY_HOUSE2",
    "MAP_PETALBURG_CITY_WALLYS_HOUSE",
    "MAP_ROUTE104_MR_BRINEYS_HOUSE",
    "MAP_ROUTE109_SEASHORE_HOUSE",
    "MAP_ROUTE111_WINSTRATE_FAMILYS_HOUSE",
    "MAP_ROUTE114_FOSSIL_MANIACS_HOUSE",
    "MAP_ROUTE114_LANETTES_HOUSE",
    "MAP_ROUTE116_TUNNELERS_REST_HOUSE",
    "MAP_ROUTE119_HOUSE",
    "MAP_ROUTE123_BERRY_MASTERS_HOUSE",
    "MAP_ROUTE124_DIVING_TREASURE_HUNTERS_HOUSE",
    "MAP_RUSTBORO_CITY_CUTTERS_HOUSE",
    "MAP_RUSTBORO_CITY_HOUSE1",
    "MAP_RUSTBORO_CITY_HOUSE2",
    "MAP_RUSTBORO_CITY_HOUSE3",
    "MAP_SLATEPORT_CITY_HOUSE",
    "MAP_SLATEPORT_CITY_NAME_RATERS_HOUSE",
    "MAP_SOOTOPOLIS_CITY_HOUSE1",
    "MAP_SOOTOPOLIS_CITY_HOUSE2",
    "MAP_SOOTOPOLIS_CITY_HOUSE3",
    "MAP_SOOTOPOLIS_CITY_HOUSE4",
    "MAP_SOOTOPOLIS_CITY_HOUSE5",
    "MAP_SOOTOPOLIS_CITY_HOUSE6",
    "MAP_SOOTOPOLIS_CITY_HOUSE7",
    "MAP_SOOTOPOLIS_CITY_LOTAD_AND_SEEDOT_HOUSE",
    "MAP_VERDANTURF_TOWN_FRIENDSHIP_RATERS_HOUSE",
    "MAP_VERDANTURF_TOWN_HOUSE",
    "MAP_VERDANTURF_TOWN_WANDAS_HOUSE",
]

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
STEPS = ((0, -1), (0, 1), (-1, 0), (1, 0))


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


class Floor:
    """One map's layout as the ROM ships it, and what a trainer can walk to on it."""

    def __init__(self, mj, layouts):
        self.house = mj["id"] in HOUSES
        layout = layouts[ew.LAYOUT_AS_PLAYED.get(mj["id"], mj["layout"])]
        self.w, self.h = layout["width"], layout["height"]
        prim = ew.load_metatile_attrs(ew.resolve_tileset_dir(layout["primary_tileset"], "primary"))
        sec_dir = ew.resolve_tileset_dir(layout.get("secondary_tileset"), "secondary")
        sec = ew.load_metatile_attrs(sec_dir) if sec_dir else None
        raw = open(ew.rp(layout["blockdata_filepath"]), "rb").read()
        self.cells = struct.unpack("<%dH" % (self.w * self.h), raw)
        self.behavior = [ew.metatile_behavior_name(prim, sec, v & ew.MAPGRID_METATILE_ID_MASK) for v in self.cells]
        self.warps = [(e["x"], e["y"]) for e in mj.get("warp_events", [])]
        self.people = {(e["x"], e["y"]) for e in mj.get("object_events", [])}
        self.laid = {}
        for v in self.cells:
            m = v & ew.MAPGRID_METATILE_ID_MASK
            self.laid[m] = self.laid.get(m, 0) + 1
        self.reach = self.flood(set())

    def at(self, x, y):
        return self.cells[y * self.w + x]

    def open(self, x, y):
        return 0 <= x < self.w and 0 <= y < self.h and (self.at(x, y) & ew.MAPGRID_COLLISION_MASK) == 0

    def flood(self, blocked):
        """Every cell you can walk (or surf, which needs no prompt now) to from a door,
        stepping between heights only through 0 or 15, as the field does."""
        seen = set()
        todo = deque(w for w in self.warps if 0 <= w[0] < self.w and 0 <= w[1] < self.h and w not in blocked)
        seen.update(todo)
        while todo:
            x, y = todo.popleft()
            here = self.at(x, y) >> ew.MAPGRID_ELEVATION_SHIFT
            for dx, dy in STEPS:
                nx, ny = x + dx, y + dy
                if (nx, ny) in seen or (nx, ny) in blocked or not self.open(nx, ny):
                    continue
                there = self.at(nx, ny) >> ew.MAPGRID_ELEVATION_SHIFT
                if here != there and here not in (0, 15) and there not in (0, 15):
                    continue
                seen.add((nx, ny))
                todo.append((nx, ny))
        return seen

    def spot_ok(self, x, y, strict):
        """A floor tile you can walk to, a step clear of every door and off where the
        map's own people stood. Strict, as well: open to the south (a ball behind a table
        is drawn on its top), two steps clear of the doors, not in front of a counter (the
        nurse and the clerk are talked to across one), a tile laid FLOOR_REPEAT times, and
        outside a house a step clear of the people too: a house's are all gone, but
        elsewhere some stay (a ferry's attendant, a story's), and are talked to from beside
        them. A room with no strict cell takes the first loose one."""
        if (x, y) not in self.reach or self.behavior[y * self.w + x] not in FLOOR:
            return False
        near = 2 if strict else 1
        if any(abs(x - wx) + abs(y - wy) <= near for wx, wy in self.warps) or (x, y) in self.people:
            return False
        if not strict:
            return True
        if not self.open(x, y + 1):
            return False
        if any(0 <= x + dx < self.w and 0 <= y + dy < self.h
               and self.behavior[(y + dy) * self.w + x + dx] == "MB_COUNTER" for dx, dy in STEPS):
            return False
        if not self.house and any(abs(x - px) + abs(y - py) <= 1 for px, py in self.people):
            return False
        return self.laid[self.at(x, y) & ew.MAPGRID_METATILE_ID_MASK] >= FLOOR_REPEAT

    def cuts(self, blocked):
        """Standing there cuts off floor you could walk to without them: things on the
        ground stay until they are taken, and a trader until he trades."""
        return len(self.flood(blocked)) < len(self.reach) - len(blocked)

    def pick(self, count):
        """`count` cells from the middle of the room outward, a ring at a time, each ring
        row by row: the cache's first, then the person's."""
        cx, cy = self.w // 2, self.h // 2
        got = []
        for strict in (True, False):
            for r in range(max(self.w, self.h)):
                for dy in range(-r, r + 1):
                    for dx in range(-r, r + 1):
                        if dx not in (-r, r) and dy not in (-r, r):
                            continue
                        x, y = cx + dx, cy + dy
                        if (x, y) in got or not self.spot_ok(x, y, strict) or self.cuts(set(got) | {(x, y)}):
                            continue
                        got.append((x, y))
                        if len(got) == count:
                            return got
        return got


def census():
    maps, seen = walk_maps()
    layouts = ew.load_layouts()
    floors = {}
    for map_id in sorted(seen):
        group, mj = maps[map_id]
        if group == "gMapGroup_TownsAndRoutes" or NOT_A_FLOOR.search(map_id):
            continue
        if mj.get("region_map_section", "MAPSEC_NONE") == "MAPSEC_NONE":
            continue
        balls = sum(1 for o in mj.get("object_events", []) if o.get("graphics_id") == "OBJ_EVENT_GFX_ITEM_BALL")
        floors[map_id] = (balls, Floor(mj, layouts))
    missing = [h for h in HOUSES if h not in floors]
    if missing:
        sys.exit("a house is not a floor: %s" % ", ".join(missing))
    return floors


def rooms(floors):
    """(map, cache, trader, cells) for every room: houses first, in their order, then the
    rest by name. A house always gets two cells, for whoever may be home."""
    out = []
    for map_id in HOUSES:
        out.append((map_id, True, False, floors[map_id][1].pick(2)))
    for map_id in sorted(floors):
        if map_id in HOUSES:
            continue
        balls, f = floors[map_id]
        cache, trader = balls == 0, len(f.reach) >= BIG_FLOOR
        if cache or trader:
            out.append((map_id, cache, trader, f.pick(2 if trader else 1)))
    return out


def problems(table):
    out = []
    if len(table) > MAX_ROOMS:
        out.append("%d rooms, past the %d keys a cache has" % (len(table), MAX_ROOMS))
    if sum(1 for r in table if r[2]) > MAX_TRADERS:
        out.append("more than %d traders" % MAX_TRADERS)
    for map_id, cache, trader, cells in table:
        if len(cells) < (2 if trader or map_id in HOUSES else 1):
            out.append("no cell for the %s on %s" % ("trader" if trader else "cache", map_id))
    return out


def c_table(table):
    lines = ["#define BR_HOUSES %d" % len(HOUSES), "static const struct BrRoom sRooms[] =", "{"]
    traders = 0
    for map_id, cache, trader, cells in table:
        cx, cy = cells[0] if cells else (0, 0)
        px, py = cells[1] if len(cells) > 1 else (0, 0)
        if not cache:
            # a trader alone stands on the first cell
            px, py, cx, cy = cx, cy, 0, 0
        lines.append("    { %s, %d, %d, %d, %d, %s, %s }," % (
            map_id, cx, cy, px, py, "TRUE" if cache else "FALSE",
            traders if trader else "BR_NO_TRADER"))
        traders += trader
    lines.append("};")
    return "\n".join(lines)


TABLE = re.compile(r"#define BR_HOUSES \d+\nstatic const struct BrRoom sRooms\[\] =\n\{.*?\n\};", re.S)


def main():
    floors = census()
    table = rooms(floors)
    bad = problems(table)
    if "--write" in sys.argv or "--check" in sys.argv:
        src = open(BALLS_C, encoding="utf-8").read()
        if not TABLE.search(src):
            sys.exit("no sRooms table in %s" % BALLS_C)
        new = TABLE.sub(lambda _: c_table(table), src)
        if bad:
            sys.exit("\n".join(bad))
        if "--check" in sys.argv:
            if new != src:
                sys.exit("src/br/br_balls.c's sRooms is stale: run tools/br/floors.py --write")
        else:
            open(BALLS_C, "w", encoding="utf-8", newline="\n").write(new)
        print("rooms: %d (%d houses), %d caches, %d traders; every floor has something" % (
            len(table), len(HOUSES), sum(1 for r in table if r[1]), sum(1 for r in table if r[2])))
        return
    byroom = {r[0]: r for r in table}
    for map_id in sorted(floors):
        balls, f = floors[map_id]
        what = ["%d ball%s" % (balls, "s" if balls > 1 else "")] if balls else []
        if map_id in byroom:
            _, cache, trader, cells = byroom[map_id]
            what += (["cache"] if cache else []) + (["trader"] if trader else []) + ["at %s" % cells]
        print("%-48s %4d reach  %s" % (map_id, len(f.reach), ", ".join(what)))
    for line in bad:
        print("PROBLEM: " + line)


if __name__ == "__main__":
    main()
