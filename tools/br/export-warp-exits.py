#!/usr/bin/env python3
"""How each warp lands you, into the page's world.

    python tools/br/export-warp-exits.py   -> web/spike-b/data/world.json, in place

Through a warp the ROM turns the player by the landing tile's behaviour
(GetAdjustedInitialDirection, overworld.c) and walks them one step off it only if it is a
door (SetUpWarpExitTask, field_screen_effect.c: Task_ExitDoor, Task_ExitNonAnimDoor):

  MB_DEEP_SOUTH_WARP                        face north, walk on
  escalator (EscalatorWarpIn, field_effect.c) face east, walk on
  door (MetatileBehavior_IsDoor/IsNonAnimDoor) face south, walk on
  south / north / west / east arrow warp    face north / south / east / west, walk on (*)
  ladder                                    keep the way you were going, stand
  anything else (stairs in a cave, a warp pad) face south, stand

(*) The ROM stands you on a mat; Cam's rule (play-test 11-01, PLAYTEST.md) is that a door
never stops you on the mat, so a mat walks you off it the way it faces you.

Each warp gets `face` (north/south/west/east, absent for a ladder's "keep") and `walk`
(1, or absent), read off the cell it lands on. sim.ts used to walk you on the way you had
come through every warp, and on Devon Corp 1F's stairs, a non-animated door you come down
facing north, that was into the dead end behind them, whose only way out was back up
(issue #397).

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

DOORS = {"MB_ANIMATED_DOOR", "MB_PETALBURG_GYM_DOOR", "MB_NON_ANIMATED_DOOR", "MB_WATER_DOOR"}
ARROWS = {
    "MB_SOUTH_ARROW_WARP": "north", "MB_WATER_SOUTH_ARROW_WARP": "north",
    "MB_NORTH_ARROW_WARP": "south",
    "MB_WEST_ARROW_WARP": "east",
    "MB_EAST_ARROW_WARP": "west",
}
LADDER = "MB_LADDER"
ESCALATORS = {"MB_UP_ESCALATOR", "MB_DOWN_ESCALATOR"}


def exit_of(behavior):
    """(face, walk) for landing on `behavior`; face None keeps the way you were going."""
    if behavior == "MB_DEEP_SOUTH_WARP":
        return "north", True
    if behavior in DOORS:
        return "south", True
    if behavior in ESCALATORS:
        return "east", True
    if behavior in ARROWS:
        return ARROWS[behavior], True
    if behavior == LADDER:
        return None, False
    return "south", False


class Behaviors:
    """The metatile behaviour at a map's cell, as the map is played."""

    def __init__(self):
        self.layouts = ew.load_layouts()
        self.maps = {}
        for _, _, folder in ew.load_map_order():
            mj = ew.load_json("data", "maps", folder, "map.json")
            self.maps[mj["id"]] = mj
        self.cache = {}

    def at(self, map_id, x, y):
        if map_id not in self.cache:
            mj = self.maps.get(map_id)
            if not mj:
                self.cache[map_id] = None
            else:
                layout = self.layouts.get(ew.LAYOUT_AS_PLAYED.get(map_id, mj["layout"]))
                primary = ew.load_metatile_attrs(ew.resolve_tileset_dir(layout["primary_tileset"], "primary"))
                second = ew.resolve_tileset_dir(layout.get("secondary_tileset"), "secondary")
                secondary = ew.load_metatile_attrs(second) if second else None
                raw = open(ew.rp(layout["blockdata_filepath"]), "rb").read()
                cells = struct.unpack("<%dH" % (len(raw) // 2), raw)
                self.cache[map_id] = (layout["width"], layout["height"], cells, primary, secondary)
        got = self.cache[map_id]
        if not got:
            return None
        w, h, cells, primary, secondary = got
        if not (0 <= x < w and 0 <= y < h):
            return None
        return ew.metatile_behavior_name(primary, secondary, cells[y * w + x] & ew.MAPGRID_METATILE_ID_MASK)


def main():
    path = os.path.join(ROOT, "web", "spike-b", "data", "world.json")
    with open(path, encoding="utf-8", newline="") as f:
        world = json.load(f)
    beh = Behaviors()
    counts = {}
    for m in world["maps"]:
        for w in m.get("warps") or []:
            w.pop("face", None)
            w.pop("walk", None)
            if w.get("toX") is None or w.get("toY") is None:
                continue
            b = beh.at(w["to"], w["toX"], w["toY"])
            if b is None:
                continue
            # A hole drops you onto plain floor (setholewarp): you land where you fell.
            if w.get("kind") == "hole":
                continue
            face, walk = exit_of(b)
            if face:
                w["face"] = face
            if walk:
                w["walk"] = 1
            key = f"{face or 'keep'}{' walk' if walk else ''}"
            counts[key] = counts.get(key, 0) + 1
    with open(path, "w", encoding="utf-8", newline="") as f:
        json.dump(world, f, separators=(",", ":"))
    for k in sorted(counts):
        print(f"{counts[k]:5d}  {k}")


if __name__ == "__main__":
    main()
