#!/usr/bin/env python3
"""Where the main menu's backdrop pans (HBR-30): Hoenn's outdoor maps laid out as they
join, and a camera path through the towns in gym order.

    python tools/br/export-menu-pan.py   -> web/src/data/menupan.json

Cam, 2026-10-20: "instead of a black screen background, it's a slow pan over of the hoenn
map ... going thru each place in accordance to what gym is there". The maps are placed by
walking world.json's seams (each map's connections, with their offsets) out from
Littleroot, in pixels, 16 to a tile; the pictures are render-maps.py's field-maps. Maps
only a warp reaches (Petalburg Woods, Sootopolis, the Safari Zone) have no place on that
walk and are left out. The path is each town's middle, in the order its gym comes, with
the towns between where the road bends through them.
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
WORLD = ROOT / "web/src/data/world.json"
OUT = ROOT / "web/src/data/menupan.json"
MAPS_DIR = ROOT / "web/public/field-maps"

START = "MAP_LITTLEROOT_TOWN"
# Littleroot, then each gym's town in the order a player meets them, through the towns
# the road between them goes by. Sootopolis (the eighth) is only reached by diving.
PATH = [
    "MAP_LITTLEROOT_TOWN",
    "MAP_OLDALE_TOWN",
    "MAP_PETALBURG_CITY",
    "MAP_RUSTBORO_CITY",  # Roxanne
    "MAP_ROUTE104",
    "MAP_DEWFORD_TOWN",  # Brawly
    "MAP_SLATEPORT_CITY",
    "MAP_MAUVILLE_CITY",  # Wattson
    "MAP_LAVARIDGE_TOWN",  # Flannery
    "MAP_MAUVILLE_CITY",
    "MAP_PETALBURG_CITY",  # Norman
    "MAP_MAUVILLE_CITY",
    "MAP_FORTREE_CITY",  # Winona
    "MAP_LILYCOVE_CITY",
    "MAP_MOSSDEEP_CITY",  # Tate and Liza
    "MAP_EVER_GRANDE_CITY",
]


def main():
    maps = {m["id"]: m for m in json.loads(WORLD.read_text())["maps"]}
    pos = {START: (0, 0)}
    queue = [START]
    while queue:
        a = queue.pop(0)
        m = maps[a]
        ax, ay = pos[a]
        for s in m.get("seams") or []:
            b = s["to"]
            if b in pos or b not in maps:
                continue
            n, o = maps[b], s["offset"]
            p = {
                "north": (ax + o, ay - n["h"]),
                "south": (ax + o, ay + m["h"]),
                "west": (ax - n["w"], ay + o),
                "east": (ax + m["w"], ay + o),
            }.get(s["dir"])
            if p:
                pos[b] = p
                queue.append(b)
    placed = [k for k in pos if (MAPS_DIR / f"{k}.png").exists()]
    left = min(pos[k][0] for k in placed)
    top = min(pos[k][1] for k in placed)
    out = {
        "maps": [
            [k[4:], (pos[k][0] - left) * 16, (pos[k][1] - top) * 16, maps[k]["w"] * 16, maps[k]["h"] * 16]
            for k in sorted(placed)
        ],
        "path": [
            [(pos[k][0] - left) * 16 + maps[k]["w"] * 8, (pos[k][1] - top) * 16 + maps[k]["h"] * 8]
            for k in PATH
        ],
    }
    OUT.write_text(json.dumps(out, separators=(",", ":")) + "\n")
    print(f"{OUT.relative_to(ROOT)}: {len(placed)} maps, {len(PATH)} stops, {OUT.stat().st_size} bytes")


if __name__ == "__main__":
    main()
