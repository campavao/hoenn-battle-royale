#!/usr/bin/env python3
"""POK-235 (+ data halves of POK-223/224): export Hoenn's world from the
pokeemerald decomp data files into JSON for the web shell's bots, drop
dealer and ring.

Reads:
  data/maps/map_groups.json                 -> MAP group/num ordering
  data/maps/*/map.json                      -> layout, connections, warps,
                                                object_events, section, etc.
  data/layouts/layouts.json                 -> per-layout dims + tileset refs
  data/layouts/<Layout>/map.bin             -> u16 collision + elevation grid
  data/tilesets/{primary,secondary}/<name>/metatile_attributes.bin
                                             -> u16 behavior/layer per metatile
  include/constants/metatile_behaviors.h    -> MB_* ordinal ids (a plain enum,
                                                so the ordinal *is* the id)
  include/fieldmap.h                        -> NUM_METATILES_IN_PRIMARY
  include/global.fieldmap.h                 -> MAPGRID_*/METATILE_ATTR_* packing
  src/data/region_map/region_map_sections.json
                                             -> per-MAPSEC {x,y,w,h,name} on the
                                                28x15 region map (same data the
                                                auto-generated region_map_entries.h
                                                is templated from -- reading the
                                                JSON avoids parsing C)

Writes (relative to repo root):
  web/src/data/world.json
  web/src/data/world.meta.json
  web/src/data/regionmap.json
  web/src/data/landing.json

Run `npx vite-node tools/br/landing-reach.ts` (from web/) afterwards. It walks the
world this wrote and marks every landing cell with no route out of it, which is the
only thing standing between the drop and a trainer stranded for a whole match
(POK-251). It rewrites landing.json in place.
"""
import glob
import gzip
import json
import os
import re
import struct
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def rp(*parts):
    return os.path.join(ROOT, *parts)


def load_json(*parts):
    with open(rp(*parts), encoding="utf-8") as f:
        return json.load(f)


# ---------------------------------------------------------------------------
# Metatile behaviors: include/constants/metatile_behaviors.h is a plain
# `enum { MB_NORMAL, MB_SECRET_BASE_WALL, ... }` with no explicit values, so
# each name's id is just its position in the list (verified against
# METATILE_ATTR_BEHAVIOR_MASK below: behavior is stored in a full byte, 0-255,
# matching a plain incrementing enum with room to spare).
# ---------------------------------------------------------------------------
def load_metatile_behaviors():
    text = open(rp("include", "constants", "metatile_behaviors.h"), encoding="utf-8").read()
    enum_body = re.search(r"enum\s*\{(.*?)\};", text, re.S).group(1)
    names = []
    for line in enum_body.splitlines():
        line = re.sub(r"//.*", "", line).strip().rstrip(",")
        if not line:
            continue
        m = re.match(r"^([A-Za-z_][A-Za-z0-9_]*)$", line)
        if m:
            names.append(m.group(1))
    return {name: i for i, name in enumerate(names)}


MB = load_metatile_behaviors()

# include/global.fieldmap.h:
#   MAPGRID_METATILE_ID_MASK 0x03FF, MAPGRID_COLLISION_MASK 0x0C00 (shift 10),
#   MAPGRID_ELEVATION_MASK 0xF000 (shift 12)
#   METATILE_ATTR_BEHAVIOR_MASK 0x00FF (shift 0), METATILE_ATTR_LAYER_MASK 0xF000 (shift 12)
MAPGRID_METATILE_ID_MASK = 0x03FF
MAPGRID_COLLISION_MASK = 0x0C00
MAPGRID_COLLISION_SHIFT = 10
MAPGRID_ELEVATION_SHIFT = 12
METATILE_ATTR_BEHAVIOR_MASK = 0x00FF

# include/fieldmap.h
NUM_METATILES_IN_PRIMARY = 512

WATER_BEHAVIORS = {
    "MB_POND_WATER", "MB_INTERIOR_DEEP_WATER", "MB_DEEP_WATER", "MB_WATERFALL",
    "MB_SOOTOPOLIS_DEEP_WATER", "MB_OCEAN_WATER", "MB_UNUSED_SOOTOPOLIS_DEEP_WATER",
    "MB_NO_SURFACING", "MB_UNUSED_SOOTOPOLIS_DEEP_WATER_2", "MB_SEAWEED",
    "MB_SEAWEED_NO_SURFACING",
}
# MB_SHALLOW_WATER / MB_PUDDLE are walkable without Surf -> left as class 0.

JUMP_DIR = {  # ledge behavior -> the direction you hop (S/N/W/E only, per ticket)
    "MB_JUMP_SOUTH": "S", "MB_JUMP_NORTH": "N", "MB_JUMP_WEST": "W", "MB_JUMP_EAST": "E",
    # Diagonal ledges are rare (a handful of Fortree/Route maps); approximate them
    # onto their vertical component since the schema only has 4 jump classes.
    "MB_JUMP_SOUTHEAST": "S", "MB_JUMP_SOUTHWEST": "S",
    "MB_JUMP_NORTHEAST": "N", "MB_JUMP_NORTHWEST": "N",
}
JUMP_CLASS = {"S": 3, "N": 4, "W": 5, "E": 6}

GRASS_BEHAVIORS = {"MB_TALL_GRASS", "MB_LONG_GRASS", "MB_LONG_GRASS_SOUTH_EDGE"}

IMPASSABLE_BEHAVIORS = {name for name in MB if name.startswith("MB_IMPASSABLE")}

CUT_TREE_GFX = "OBJ_EVENT_GFX_CUTTABLE_TREE"
ROCK_SMASH_GFX = "OBJ_EVENT_GFX_BREAKABLE_ROCK"

DIR_MAP = {"up": "north", "down": "south", "left": "west", "right": "east"}

OUTDOOR_MAP_TYPES = {"MAP_TYPE_TOWN", "MAP_TYPE_CITY", "MAP_TYPE_ROUTE", "MAP_TYPE_OCEAN_ROUTE"}


# Tileset resolution: don't guess directory names from the label (several
# gTileset_SecretBase* variants -- RedCave, BrownCave, Shrub, ... -- share one
# underlying secret_base/ directory, keyed off a single gMetatileAttributes_
# symbol, so CamelCase->snake_case guessing breaks on them). Instead read the
# two generated files pret's own build trusts:
#   src/data/tilesets/headers.h  : gTileset_<Label> -> .metatileAttributes = gMetatileAttributes_<Sym>
#   src/data/tilesets/metatiles.h: gMetatileAttributes_<Sym> = INCBIN_U16("data/tilesets/.../metatile_attributes.bin")
_TILESET_LABEL_TO_SYM = {}
_TILESET_SYM_TO_PATH = {}


def _load_tileset_tables():
    if _TILESET_LABEL_TO_SYM:
        return
    headers = open(rp("src", "data", "tilesets", "headers.h"), encoding="utf-8").read()
    for m in re.finditer(
        r"const struct Tileset (gTileset_\w+)\s*=\s*\{(.*?)\};", headers, re.S
    ):
        label, body = m.group(1), m.group(2)
        am = re.search(r"\.metatileAttributes\s*=\s*(gMetatileAttributes_\w+)", body)
        if am:
            _TILESET_LABEL_TO_SYM[label] = am.group(1)

    metatiles = open(rp("src", "data", "tilesets", "metatiles.h"), encoding="utf-8").read()
    for m in re.finditer(
        r"(gMetatileAttributes_\w+)\[\]\s*=\s*INCBIN_U16\(\"(data/tilesets/[^\"]+)\"\)", metatiles
    ):
        _TILESET_SYM_TO_PATH[m.group(1)] = m.group(2)


def resolve_tileset_dir(label, kind):
    """label like 'gTileset_Petalburg' or '0'/None for no secondary tileset."""
    if not label or label == "0":
        return None
    _load_tileset_tables()
    sym = _TILESET_LABEL_TO_SYM.get(label)
    if not sym:
        raise KeyError(f"no tileset header entry for {label!r}")
    path = _TILESET_SYM_TO_PATH.get(sym)
    if not path:
        raise KeyError(f"no INCBIN path for {sym!r} (from {label!r})")
    return rp(os.path.dirname(path))


_ATTR_CACHE = {}


def load_metatile_attrs(tileset_dir):
    if tileset_dir in _ATTR_CACHE:
        return _ATTR_CACHE[tileset_dir]
    path = os.path.join(tileset_dir, "metatile_attributes.bin")
    data = open(path, "rb").read()
    count = len(data) // 2
    attrs = struct.unpack("<%dH" % count, data)
    behaviors = [a & METATILE_ATTR_BEHAVIOR_MASK for a in attrs]
    _ATTR_CACHE[tileset_dir] = behaviors
    return behaviors


BEHAVIOR_NAME_BY_ID = {v: k for k, v in MB.items()}


def metatile_behavior_name(primary_behaviors, secondary_behaviors, metatile_id):
    if metatile_id < NUM_METATILES_IN_PRIMARY:
        beh_id = primary_behaviors[metatile_id] if metatile_id < len(primary_behaviors) else 0
    else:
        idx = metatile_id - NUM_METATILES_IN_PRIMARY
        beh_id = secondary_behaviors[idx] if secondary_behaviors and idx < len(secondary_behaviors) else 0
    return BEHAVIOR_NAME_BY_ID.get(beh_id, "MB_NORMAL")


# ---------------------------------------------------------------------------
# Load map_groups.json -> ordered list of (group, num, folder_name)
# ---------------------------------------------------------------------------
def load_map_order():
    mg = load_json("data", "maps", "map_groups.json")
    order = []
    for group_idx, group_key in enumerate(mg["group_order"]):
        for num, folder in enumerate(mg[group_key]):
            order.append((group_idx, num, folder))
    return order


def load_layouts():
    ld = load_json("data", "layouts", "layouts.json")
    return {l["id"]: l for l in ld["layouts"]}


def load_region_map_sections():
    rm = load_json("src", "data", "region_map", "region_map_sections.json")
    # include/constants/region_map_sections.h is generated from this file in order, so a
    # section's index here IS its MAPSEC_* value -- which is what the ROM puts on the
    # wire when a trainer picks where to drop (POK-223).
    return {s["id"]: dict(s, num=i) for i, s in enumerate(rm["map_sections"])}


def base_building_name(folder):
    """Strip a trailing floor suffix (_1F, _2F, _B1F, _3F, ...) for 'same
    building, different floor' warp-kind detection."""
    return re.sub(r"_(B?\d+F)$", "", folder)


def classify_warp_kind(src_folder, dest_map_id, maps_by_id):
    if dest_map_id in ("MAP_DYNAMIC", "MAP_NONE", "MAP_UNDEFINED"):
        return "other"
    dest = maps_by_id.get(dest_map_id)
    dest_folder = dest["folder"] if dest else dest_map_id
    if "PokemonCenter" in dest_folder:
        return "centre"
    if re.search(r"(?:^|_)Mart(?:_|$)", dest_folder):
        return "mart"
    if "_Gym" in dest_folder:
        return "gym"
    if base_building_name(dest_folder) == base_building_name(src_folder) and dest_folder != src_folder:
        return "stairs"
    return "door"


def rle_encode(cells):
    """Run-length encode a flat list of small ints (a class 0-9, a height 0-15) as
    '<count>x<class>;<count>x<class>;...' -- compact, ASCII, trivially
    decodable, and gzip loves the repetition even before this pass."""
    out = []
    i = 0
    n = len(cells)
    while i < n:
        j = i + 1
        while j < n and cells[j] == cells[i]:
            j += 1
        out.append("%dx%d" % (j - i, cells[i]))
        i = j
    return ";".join(out)


def export():
    order = load_map_order()
    layouts = load_layouts()
    sections = load_region_map_sections()

    maps_meta = {}  # map_id -> {folder, group, num, json}
    for group, num, folder in order:
        mj = load_json("data", "maps", folder, "map.json")
        maps_meta[mj["id"]] = {"folder": folder, "group": group, "num": num, "json": mj}

    # second pass: resolve warp destinations, needs all maps loaded first
    result_maps = []
    warn = []

    def is_centermartgym(folder):
        return ("PokemonCenter" in folder) or re.search(r"(?:^|_)Mart(?:_|$)", folder) or ("_Gym" in folder)

    included = 0
    for map_id, meta in sorted(maps_meta.items(), key=lambda kv: (kv[1]["group"], kv[1]["num"])):
        folder, group, num, mj = meta["folder"], meta["group"], meta["num"], meta["json"]
        section = mj.get("region_map_section", "MAPSEC_NONE")
        outdoor = mj.get("map_type") in OUTDOOR_MAP_TYPES

        if section == "MAPSEC_NONE" and not is_centermartgym(folder):
            continue  # per ticket: grids only for sectioned maps + Center/Mart/Gym interiors

        layout = layouts.get(mj["layout"])
        if not layout:
            warn.append(f"{map_id}: missing layout {mj['layout']!r}")
            continue

        w, h = layout["width"], layout["height"]
        primary_dir = resolve_tileset_dir(layout["primary_tileset"], "primary")
        secondary_dir = resolve_tileset_dir(layout.get("secondary_tileset"), "secondary")
        primary_behaviors = load_metatile_attrs(primary_dir)
        secondary_behaviors = load_metatile_attrs(secondary_dir) if secondary_dir else None

        blockdata_path = rp(layout["blockdata_filepath"])
        raw = open(blockdata_path, "rb").read()
        cell_count = len(raw) // 2
        cells_raw = struct.unpack("<%dH" % cell_count, raw)
        if cell_count != w * h:
            warn.append(f"{map_id}: blockdata {cell_count} cells != {w}x{h}={w*h}")

        classes = [0] * (w * h)
        heights = [0] * (w * h)
        for i in range(min(cell_count, w * h)):
            val = cells_raw[i]
            heights[i] = val >> MAPGRID_ELEVATION_SHIFT
            metatile_id = val & MAPGRID_METATILE_ID_MASK
            collision = (val & MAPGRID_COLLISION_MASK) >> MAPGRID_COLLISION_SHIFT
            behavior = metatile_behavior_name(primary_behaviors, secondary_behaviors, metatile_id)

            if collision != 0:
                cls = 1
            elif behavior in WATER_BEHAVIORS:
                cls = 2
            elif behavior in JUMP_DIR:
                cls = JUMP_CLASS[JUMP_DIR[behavior]]
            elif behavior in GRASS_BEHAVIORS:
                cls = 7
            elif behavior in IMPASSABLE_BEHAVIORS:
                cls = 1  # approximation: directional impassables treated as fully blocked
            else:
                cls = 0
            classes[i] = cls

        # overlay: cuttable trees / smashable rocks aren't metatile behaviors in
        # Emerald (they're object events) -> approximate as class 9 at their cell.
        for oe in mj.get("object_events") or []:
            if oe.get("graphics_id") in (CUT_TREE_GFX, ROCK_SMASH_GFX):
                ox, oy = oe["x"], oe["y"]
                if 0 <= ox < w and 0 <= oy < h:
                    classes[oy * w + ox] = 9

        # seams
        seams = []
        for conn in mj.get("connections") or []:
            d = DIR_MAP.get(conn["direction"])
            if d:
                seams.append({"dir": d, "to": conn["map"], "offset": conn["offset"]})

        # warps (overlay class 8 after cut-tree/rock so warp tiles always read as doors)
        warps = []
        for we in mj.get("warp_events") or []:
            wx, wy = we["x"], we["y"]
            if 0 <= wx < w and 0 <= wy < h:
                classes[wy * w + wx] = 8
            dest_map = we.get("dest_map")
            dest_warp_id = we.get("dest_warp_id")
            to_x = to_y = None
            if dest_map in maps_meta:
                dest_json = maps_meta[dest_map]["json"]
                try:
                    idx = int(dest_warp_id)
                    dest_warp = (dest_json.get("warp_events") or [])[idx]
                    to_x, to_y = dest_warp["x"], dest_warp["y"]
                except (ValueError, TypeError, IndexError):
                    pass
            kind = classify_warp_kind(folder, dest_map, maps_meta)
            warps.append({
                "x": wx, "y": wy, "to": dest_map,
                "toX": to_x, "toY": to_y, "kind": kind,
            })

        # Heights (POK-331 #2): Emerald keeps you off a cliff top one step away by the
        # grid's elevation, not its collision bit -- a step between two heights is refused
        # unless one is 0 (a transition: stairs, a ramp) or 15 (a bridge, both levels at
        # once). The walker (web/src/bots/world.ts) asks only about cells it can stand on,
        # so a wall carries the height before it: the same answer, a quarter the bytes.
        carry = 0
        for i in range(w * h):
            if classes[i] == 1:
                heights[i] = carry
            else:
                carry = heights[i]

        centre = None
        if "PokemonCenter_1F" in folder:
            for oe in mj.get("object_events") or []:
                if oe.get("graphics_id") == "OBJ_EVENT_GFX_NURSE":
                    nx, ny = oe["x"], oe["y"]
                    # The nurse faces down and sits behind a counter: the tile
                    # directly south of her (the counter itself, MB_COUNTER)
                    # carries the impassable collision bit -- the player's
                    # actual talk-to-nurse tile is the first walkable cell
                    # further south (the engine lets a facing-up interaction
                    # reach across one counter tile). Scan down for it instead
                    # of assuming a fixed offset.
                    cy = ny + 1
                    while cy < h and classes[cy * w + nx] not in (0, 7):
                        cy += 1
                    if cy < h:
                        centre = {"counterX": nx, "counterY": cy}
                    break

        result_maps.append({
            "id": map_id, "group": group, "num": num, "w": w, "h": h,
            "section": section, "outdoor": outdoor,
            "grid": rle_encode(classes), "elev": rle_encode(heights),
            "seams": seams, "warps": warps,
            "centre": centre,
            "_folder": folder,  # internal use only, stripped before writing
        })
        included += 1

    return result_maps, sections, warn, len(maps_meta)


# How many cells a single map offers the section's pool. A section is usually a
# town plus its routes, and 48 is the whole section's budget, so this only has to
# be wide enough that the round-robin below has somewhere to spread.
SPREAD = 48


def build_landing(result_maps):
    by_section = {}
    for m in result_maps:
        if m["outdoor"]:
            by_section.setdefault(m["section"], []).append(m)
    for sec in by_section:
        by_section[sec].sort(key=lambda m: m["id"])

    landing_by_section = {}
    for section, maps in sorted(by_section.items()):
        candidate_iters = []
        for m in maps:
            w, h = m["w"], m["h"]
            classes = decode_rle(m["grid"], w * h)
            danger_cells = set()
            for wp in m["warps"]:
                danger_cells.add((wp["x"], wp["y"]))
            edge_excl = {"north": set(), "south": set(), "west": set(), "east": set()}
            seam_dirs = {s["dir"] for s in m["seams"]}
            cands = []
            for y in range(h):
                for x in range(w):
                    cls = classes[y * w + x]
                    if cls not in (0, 7):
                        continue
                    if "north" in seam_dirs and y < 2:
                        continue
                    if "south" in seam_dirs and y >= h - 2:
                        continue
                    if "west" in seam_dirs and x < 2:
                        continue
                    if "east" in seam_dirs and x >= w - 2:
                        continue
                    near_warp = False
                    for (dx0, dy0) in danger_cells:
                        if max(abs(x - dx0), abs(y - dy0)) < 2:
                            near_warp = True
                            break
                    if near_warp:
                        continue
                    cands.append((x, y))
            # Spread the picks over the map instead of taking the first ones found.
            # Row-major order means "first 48" is the map's top strip -- which on a
            # map with no north seam is the border filler, walkable in the grid and
            # unreachable in the game (POK-251: Lilycove's 48 cells were all y=0).
            if len(cands) > SPREAD:
                stride = len(cands) / float(SPREAD)
                cands = [cands[int(i * stride)] for i in range(SPREAD)]
            candidate_iters.append(iter(cands))

        picked = []
        exhausted = [False] * len(candidate_iters)
        while len(picked) < 48 and not all(exhausted):
            for i, it in enumerate(candidate_iters):
                if exhausted[i]:
                    continue
                try:
                    x, y = next(it)
                except StopIteration:
                    exhausted[i] = True
                    continue
                picked.append({"map": maps[i]["id"], "x": x, "y": y})
                if len(picked) >= 48:
                    break
        landing_by_section[section] = picked
    return landing_by_section


def decode_rle(s, expected_len):
    out = []
    if s:
        for token in s.split(";"):
            count_s, cls_s = token.split("x")
            out.extend([int(cls_s)] * int(count_s))
    assert len(out) == expected_len, (len(out), expected_len)
    return out


def main():
    result_maps, sections, warn, total_maps = export()

    world = {
        "maps": [{k: v for k, v in m.items() if not k.startswith("_")} for m in result_maps]
    }
    # A handful of MAPSEC_* entries (MAPSEC_DYNAMIC, MAPSEC_SECRET_BASE, unused
    # Kanto placeholders left in region_map_sections.json) carry no x/y -- they
    # are never placed on the region map, so drop them here.
    regionmap = {
        "sections": {
            sid: {
                "id": sid,
                "num": s["num"],
                "x": s["x"],
                "y": s["y"],
                "w": s["width"],
                "h": s["height"],
                "name": s["name"],
            }
            for sid, s in sections.items()
            if "x" in s
        }
    }
    landing_by_section = build_landing(result_maps)
    landing = [
        entry
        for section in sorted(landing_by_section)
        for entry in landing_by_section[section]
    ]

    out_dir = rp("web", "src", "data")
    os.makedirs(out_dir, exist_ok=True)

    world_path = os.path.join(out_dir, "world.json")
    with open(world_path, "w", encoding="utf-8") as f:
        json.dump(world, f, separators=(",", ":"))

    with open(os.path.join(out_dir, "regionmap.json"), "w", encoding="utf-8") as f:
        json.dump(regionmap, f, separators=(",", ":"), indent=None)

    with open(os.path.join(out_dir, "landing.json"), "w", encoding="utf-8") as f:
        json.dump(landing, f, separators=(",", ":"))

    outdoor_count = sum(1 for m in result_maps if m["outdoor"])
    gzip_size = len(gzip.compress(open(world_path, "rb").read(), 9))

    meta = {
        "totalMapsInGame": total_maps,
        "mapsExported": len(result_maps),
        "outdoorMaps": outdoor_count,
        "sections": len(regionmap["sections"]),
        "outdoorSectionsWithLanding": len(landing_by_section),
        "landingCells": len(landing),
        "worldJsonBytes": os.path.getsize(world_path),
        "worldJsonGzipBytes": gzip_size,
        "warnings": warn,
    }
    with open(os.path.join(out_dir, "world.meta.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=2)

    print(json.dumps(meta, indent=2))
    if warn:
        print(f"\n{len(warn)} warnings:", file=sys.stderr)
        for w in warn[:50]:
            print(" -", w, file=sys.stderr)


if __name__ == "__main__":
    main()
