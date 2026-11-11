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
FILL = ROOT / "web/spike-b/data/world-fill.json"
FILL_DIR = MAPS_DIR / "fill"
# room.ts LOOSE_SEAM, as export-fill.py has it.
LOOSE_SEAM = {"MAP_PETALBURG_CITY", "MAP_ROUTE102"}
# A fill picture's side, in cells: 512 px.
FILL_CELLS = 32
# How far round the camera's path the fill is drawn, in pixels: a tall phone's menu, or a wide
# screen's (1280 game pixels across), and more.
FILL_REACH = 800
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


def bake_fill(left, top, path):
    """What stands between the maps (export-fill.py's cells, Cam's painting on /map/ in them), as
    the game draws it, baked into pictures of FILL_CELLS a side along the camera's path. Cam,
    11-11: "make sure this is also the map that's shown in the background when on the main
    menu". The sea is one picture, drawn wherever a piece is all sea."""
    import importlib.util
    spec = importlib.util.spec_from_file_location("render_maps", ROOT / "tools/br/render-maps.py")
    rm = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(rm)
    from PIL import Image

    fill = json.loads(FILL.read_text())
    x0, y0, w, h = fill["x0"], fill["y0"], fill["w"], fill["h"]
    blocks = [(b[0], b[1:5]) if b else None for b in fill["blocks"]]
    cells = []
    for run in fill["rows"].split(";"):
        n, v = (int(t) for t in run.split("x"))
        cells += [v] * n
    layouts = {l["id"]: l for l in json.loads((ROOT / "data/layouts/layouts.json").read_text())["layouts"]}
    layout_of = {}
    for d in (ROOT / "data/maps").iterdir():
        j = d / "map.json"
        if j.exists():
            m = json.loads(j.read_text())
            layout_of[m["id"]] = m["layout"]
    sets, pictures = {}, {}

    def metatile(ref, mid):
        """One metatile, 16 px, with the tilesets of the map it came from (General's: Littleroot's)."""
        key = (ref, mid)
        if key not in pictures:
            lid = layout_of[ref or START]
            if lid not in sets:
                sets[lid] = rm.Tilesets(layouts[lid])
            img = Image.new("RGB", (16, 16), (0, 0, 0))
            sets[lid].draw_block(img, 0, 0, mid)
            pictures[key] = img
        return pictures[key]

    SEA = 0x170  # worldfill.ts SEA_METATILE

    def at(gx, gy):
        cx, cy = gx - x0, gy - y0
        return 0 if cx < 0 or cy < 0 or cx >= w or cy >= h else cells[cy * w + cx]

    # The camera's reach: each leg of the path, FILL_REACH round it.
    reach = []
    for (ax, ay), (bx, by) in zip(path, path[1:]):
        reach.append((min(ax, bx) - FILL_REACH, min(ay, by) - FILL_REACH, max(ax, bx) + FILL_REACH, max(ay, by) + FILL_REACH))
    side = FILL_CELLS * 16
    FILL_DIR.mkdir(parents=True, exist_ok=True)
    for old in FILL_DIR.glob("*.png"):
        old.unlink()
    sea = Image.new("RGB", (side, side))
    for y in range(FILL_CELLS):
        for x in range(FILL_CELLS):
            sea.paste(metatile(None, SEA), (x * 16, y * 16))
    rm.paletted(sea).save(FILL_DIR / "sea.png", optimize=True)
    tiles = []
    for ty in range(-(-h // FILL_CELLS)):
        for tx in range(-(-w // FILL_CELLS)):
            gx0, gy0 = x0 + tx * FILL_CELLS, y0 + ty * FILL_CELLS
            px, py = (gx0 - left) * 16, (gy0 - top) * 16
            if not any(px < r[2] and px + side > r[0] and py < r[3] and py + side > r[1] for r in reach):
                continue
            syms = [[at(gx0 + x, gy0 + y) for x in range(FILL_CELLS)] for y in range(FILL_CELLS)]
            if not any(any(row) for row in syms):
                tiles.append([px, py, "sea"])
                continue
            img = Image.new("RGB", (side, side))
            for y, row in enumerate(syms):
                for x, sym in enumerate(row):
                    b = blocks[sym] if sym else None
                    gx, gy = gx0 + x, gy0 + y
                    tile = metatile(None, SEA) if b is None else metatile(b[0], b[1][((gy & 1) << 1) | (gx & 1)])
                    img.paste(tile, (x * 16, y * 16))
            name = f"{tx}_{ty}"
            rm.paletted(img).save(FILL_DIR / f"{name}.png", optimize=True)
            tiles.append([px, py, name])
    size = sum(f.stat().st_size for f in FILL_DIR.glob("*.png"))
    print(f"{FILL_DIR.relative_to(ROOT)}: {len(tiles)} pieces, {len(list(FILL_DIR.glob('*.png')))} pictures, {size // 1024} KB")
    return {"size": side, "tiles": tiles}


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
            # The game's own plane (worldfill.ts mainlandPlane, export-fill.py): outdoor maps
            # only, and not across the loose seam, so the fill lands where the maps are.
            if b in pos or b not in maps or not maps[b].get("outdoor") or {a, b} == LOOSE_SEAM:
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
    out["fill"] = bake_fill(left, top, path)
    OUT.write_text(json.dumps(out, separators=(",", ":")) + "\n")
    print(f"{OUT.relative_to(ROOT)}: {len(placed)} maps, {len(path)} turns, {OUT.stat().st_size} bytes")


if __name__ == "__main__":
    main()
