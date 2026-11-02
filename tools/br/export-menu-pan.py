#!/usr/bin/env python3
"""Where the main menu's backdrop pans (HBR-30): Hoenn's outdoor maps laid out as they
join, and a camera path through the towns in gym order.

    python tools/br/export-menu-pan.py   -> web/src/data/menupan.json

Cam, 2026-10-20: "instead of a black screen background, it's a slow pan over of the hoenn
map ... going thru each place in accordance to what gym is there". The maps are placed by
walking world.json's seams (each map's connections, with their offsets) out from
Littleroot, in pixels, 16 to a tile; the pictures are render-maps.py's field-maps. Maps
only a warp reaches (Petalburg Woods, Sootopolis, the Safari Zone) have no place on that
walk and are left out. The path follows the roads map by map in the order a player goes
(Cam, 2026-11-01), in straight lines through the seam each pair of maps share: a diagonal
across a corner of the world showed black.
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
WORLD = ROOT / "web/src/data/world.json"
OUT = ROOT / "web/src/data/menupan.json"
MAPS_DIR = ROOT / "web/public/field-maps"

START = "MAP_LITTLEROOT_TOWN"
# The stops in the order a player goes; the maps between are found along the seams.
PATH = [
    "MAP_LITTLEROOT_TOWN",
    "MAP_ROUTE101",
    "MAP_OLDALE_TOWN",
    "MAP_ROUTE103",
    "MAP_OLDALE_TOWN",
    "MAP_ROUTE102",
    "MAP_PETALBURG_CITY",
    "MAP_ROUTE104",
    "MAP_RUSTBORO_CITY",  # Roxanne
    "MAP_ROUTE104",
    "MAP_ROUTE105",
    "MAP_DEWFORD_TOWN",  # Brawly
    "MAP_SLATEPORT_CITY",
    "MAP_MAUVILLE_CITY",  # Wattson
    "MAP_FALLARBOR_TOWN",
    "MAP_MAUVILLE_CITY",
    "MAP_FORTREE_CITY",  # Winona
    "MAP_LILYCOVE_CITY",
    "MAP_MOSSDEEP_CITY",  # Tate and Liza
    "MAP_EVER_GRANDE_CITY",
]


def chain(maps, placed, a, b):
    """The maps from a to b along the seams, fewest first."""
    came = {a: None}
    queue = [a]
    while queue:
        k = queue.pop(0)
        if k == b:
            out = []
            while k:
                out.append(k)
                k = came[k]
            return out[::-1]
        for s in maps[k].get("seams") or []:
            if s["to"] in placed and s["to"] not in came:
                came[s["to"]] = k
                queue.append(s["to"])
    raise SystemExit(f"no way from {a} to {b}")


def straight(rect, a, b, path):
    """From a's middle to b's, on straight lines, through the edge the two share."""
    ax, ay, aw, ah = rect[a]
    bx, by, bw, bh = rect[b]
    if ax + aw == bx or bx + bw == ax:  # side by side
        y = (max(ay, by) + min(ay + ah, by + bh)) // 2
        turns = [(ax + aw // 2, y), (bx + bw // 2, y)]
    else:  # one over the other
        x = (max(ax, bx) + min(ax + aw, bx + bw)) // 2
        turns = [(x, ay + ah // 2), (x, by + bh // 2)]
    for p in [*turns, (bx + bw // 2, by + bh // 2)]:
        if p != path[-1]:
            path.append(p)


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
        "path": [],
    }
    rect = {k: ((pos[k][0] - left) * 16, (pos[k][1] - top) * 16, maps[k]["w"] * 16, maps[k]["h"] * 16) for k in placed}
    x, y, w, h = rect[PATH[0]]
    path = [(x + w // 2, y + h // 2)]
    for a, b in zip(PATH, PATH[1:]):
        steps = chain(maps, rect, a, b)
        for p, q in zip(steps, steps[1:]):
            straight(rect, p, q, path)
    out["path"] = [list(p) for p in path]
    OUT.write_text(json.dumps(out, separators=(",", ":")) + "\n")
    print(f"{OUT.relative_to(ROOT)}: {len(placed)} maps, {len(path)} turns, {OUT.stat().st_size} bytes")


if __name__ == "__main__":
    main()
