#!/usr/bin/env python3
"""Check the field's 32x64-tile ring, cell by cell, against the map (POK-329).

    bash tools/br/drive.sh ring-tall | python3 tools/br/ring-tall.py

BG1..3 are 256x512 text BGs, and their tilemaps hold 32 metatile rows around the camera:
grid rows pos.y - BR_RING_ABOVE .. pos.y + 31 - BR_RING_ABOVE, each in tile rows
(yTileOffset + 2*dy) & 63, and pret's 16 columns pos.x .. pos.x+15 in tile columns
(xTileOffset + 2*dx) & 31 (include/br/br_field.h, THE RING). The driver walks and dumps,
at rest and on a step's first, second and middle frames: the position and map
(*gSaveBlock1Ptr), gFieldCamera, BG0..3CNT (0x04000008), gSpriteCoordOffsetX/Y, and the
three layers' heap buffers (*gOverworldTilemapBuffer_Bg1..3, 4 KB each, what the next
VBlank copies to VRAM).

The rotation is the one the steps imply: tile offsets (0,0) at the landing (a map load
resets the camera), and two tiles each way per step, the step being where pos moved.
At rest it is checked against the camera's pixels, which the scroll registers are
written from and which the harness cannot read back (write-only, open bus):
gSpriteCoordOffset = -(the camera's pixel offset) - the standing pan and its 8, both
reset by the same map load (UpdateCameraPanning).

For each record, every ring cell whose grid cell is inside the map it is on is
compared with what DrawMetatile puts there -- the layout's block, its metatile's eight
tiles and its layer type, read out of the pret sources -- on all three layers:

  * BG1..3CNT are 256x512 (size 2): the parent's 256x256 fails here;
  * at rest, all 32 x 16 metatiles, at the rotation the scroll registers give;
  * on a step up and a step left, the whole ring from the step's first frame: the new
    top row (and the new column's 32 rows) go in at once;
  * on a step down, the new bottom row's slot still holds the row the step left behind
    it until the step completes -- that slot is the band's top rows until then -- and
    the row itself at rest; a step right's far column the same;
  * after a map connection, at rest, the rows past pret's own that were drawn from the
    last map: this one's, not its border.

Exits 1 on any wrong cell, 2 when the run did not exercise all of that.
"""
import json
import os
import re
import struct
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
FIELD_H = open(os.path.join(ROOT, "include", "br", "br_field.h"), encoding="utf-8").read()


def define(name):
    m = re.search(r"^#define\s+%s\s+(\d+)\s*$" % name, FIELD_H, re.M)
    if not m:
        sys.exit("ring-tall.py: no plain #define %s in include/br/br_field.h" % name)
    return int(m.group(1))


ABOVE = define("BR_RING_ABOVE")
TILE_ROWS = define("BR_RING_TILE_ROWS")
ROWS = TILE_ROWS // 2
MAP_OFFSET = 7
PAN = 32 + 8  # the standing vertical pan and FieldUpdateBgTilemapScroll's 8
LAYER_NORMAL, LAYER_COVERED, LAYER_SPLIT = 0, 1, 2
NUM_PRIMARY = 512


def tileset_dir(name):
    short = name[len("gTileset_"):]
    snake = "".join(("_" + c.lower()) if c.isupper() and i else c.lower() for i, c in enumerate(short))
    for kind in ("primary", "secondary"):
        d = os.path.join(ROOT, "data", "tilesets", kind, snake)
        if os.path.isdir(d):
            return d
    sys.exit("ring-tall.py: no tileset dir for %s" % name)


def u16s(path):
    raw = open(path, "rb").read()
    return struct.unpack("<%dH" % (len(raw) // 2), raw)


class Layout:
    def __init__(self, layout):
        self.w, self.h = layout["width"], layout["height"]
        self.blocks = u16s(os.path.join(ROOT, layout["blockdata_filepath"]))[: self.w * self.h]
        self.sets = []
        for name in (layout["primary_tileset"], layout["secondary_tileset"]):
            d = tileset_dir(name)
            mt = u16s(os.path.join(d, "metatiles.bin"))
            self.sets.append(([mt[i:i + 8] for i in range(0, len(mt), 8)], u16s(os.path.join(d, "metatile_attributes.bin"))))

    def inside(self, mx, my):
        return 0 <= mx < self.w and 0 <= my < self.h

    def cell(self, mx, my):
        """What DrawMetatileAt puts in BG1, BG2, BG3 for map cell (mx, my): four entries
        each (top-left, top-right, bottom-left, bottom-right), or None when the metatile's
        layer type is one DrawMetatile draws nothing for."""
        mid = self.blocks[my * self.w + mx] & 0x3FF
        tiles, attrs = self.sets[0] if mid < NUM_PRIMARY else self.sets[1]
        i = mid if mid < NUM_PRIMARY else mid - NUM_PRIMARY
        t = tiles[i]
        layer = attrs[i] >> 12
        bottom, top = list(t[0:4]), list(t[4:8])
        if layer == LAYER_SPLIT:
            return top, [0] * 4, bottom
        if layer == LAYER_COVERED:
            return [0] * 4, top, bottom
        if layer == LAYER_NORMAL:
            return top, bottom, [0x3014] * 4
        return None


def maps():
    """(group, num) -> Layout, for every map in include/constants/map_groups.h."""
    ids = {}
    for m in re.finditer(r"^\s*(MAP_\w+)\s*=\s*\((\d+)\s*\|\s*\((\d+)\s*<<\s*8\)\)", open(os.path.join(ROOT, "include", "constants", "map_groups.h"), encoding="utf-8").read(), re.M):
        ids[m.group(1)] = (int(m.group(3)), int(m.group(2)))
    layouts = {l["id"]: l for l in json.load(open(os.path.join(ROOT, "data", "layouts", "layouts.json"), encoding="utf-8"))["layouts"] if "id" in l}
    out = {}
    for d in os.listdir(os.path.join(ROOT, "data", "maps")):
        p = os.path.join(ROOT, "data", "maps", d, "map.json")
        if not os.path.exists(p):
            continue
        j = json.load(open(p, encoding="utf-8"))
        if j.get("id") in ids and j.get("layout") in layouts:
            out[ids[j["id"]]] = (j["id"], j["layout"])
    return out, layouts


def s16(b):
    v = b[0] | b[1] << 8
    return v - 0x10000 if v & 0x8000 else v


def s32(b):
    v = int.from_bytes(bytes(b), "little")
    return v - (1 << 32) if v & 0x80000000 else v


# One record is these six dumps, in this order (the driver's `dump`s and `watch`es).
SIZES = (8, 24, 8, 2, 2, 4096, 4096, 4096)


def records(text):
    recs = []
    cur = None
    dumps = []
    label = None
    for line in text.splitlines():
        if line.startswith("dump 0x"):
            cur = bytearray()
            dumps.append(cur)
        elif line.startswith("  ") and cur is not None:
            cur.extend(int(b, 16) for b in line.split())
        else:
            cur = None
            if line.startswith("frame "):
                continue
            if re.match(r"^(rest|step|turn|cross)\b", line):
                label = line
        if len(dumps) == len(SIZES) and all(len(d) == n for d, n in zip(dumps, SIZES)):
            recs.append((label, dumps))
            dumps = []
            cur = None
    return recs


def main():
    text = sys.stdin.read()
    known, layouts = maps()
    loaded = {}
    recs = records(text)
    bad = 0
    stats = {"rest": 0, "first-up": 0, "first-left": 0, "held-down": 0, "held-right": 0, "cross": 0, "cells": 0}
    prev_rest = None  # (pos, map key, xTile, yTile)
    heading = None    # the way the last step seen mid-way went

    def fail(msg):
        nonlocal bad
        bad += 1
        if bad <= 40:
            print("FAIL " + msg)

    for n, (label, (save, cam, regs, sox, soy, bg1, bg2, bg3)) in enumerate(recs):
        px, py = s16(save[0:2]), s16(save[2:4])
        key = (save[4], save[5])
        camx, camy = s32(cam[16:20]), s32(cam[20:24])
        where = "record %d (%s) at (%d,%d) cam (%d,%d)" % (n, label, px, py, camx, camy)
        for bg in (1, 2, 3):
            cnt = regs[2 * bg] | regs[2 * bg + 1] << 8
            if cnt >> 14 != 2:
                fail("%s: BG%dCNT 0x%04X is not a 256x512 text BG (size %d)" % (where, bg, cnt, cnt >> 14))
        if key not in known:
            fail("%s: map %s is not in map_groups.h" % (where, key))
            continue
        if key not in loaded:
            loaded[key] = Layout(layouts[known[key][1]])
        lay = loaded[key]
        rest = camx == 0 and camy == 0
        if rest:
            if prev_rest is None:
                xt, yt = 0, 0
            else:
                (ox, oy), _, oxt, oyt = prev_rest
                dx, dy = px - ox, py - oy
                if prev_rest[1] != key:
                    # Over a connection pos jumps to the new map's frame; the camera
                    # took one step, the way the step's own frames went.
                    if heading is None:
                        fail("%s: a new map, and no step seen on the way" % where)
                        continue
                    dx, dy = heading
                elif abs(dx) + abs(dy) > 1:
                    fail("%s: more than a step from the last rest (%d,%d)" % (where, ox, oy))
                    continue
                xt, yt = (oxt + 2 * dx) & 31, (oyt + 2 * dy) & (TILE_ROWS - 1)
            # The camera's pixels, at rest a whole number of tiles.
            xpix = -s16(sox) & 0xFF
            ypix = -(s16(soy) + PAN) & 0x1FF
            if (xpix >> 3, ypix >> 3) != (xt, yt & (TILE_ROWS - 1)) or xpix & 7 or ypix & 7:
                fail("%s: the camera is at pixels (%d,%d), and the steps say tile offsets (%d,%d)"
                     % (where, xpix, ypix, xt, yt))
            crossed = prev_rest is not None and prev_rest[1] != key
        else:
            if prev_rest is None:
                fail("%s: a step with no rest before it" % where)
                continue
            (ox, oy), okey, oxt, oyt = prev_rest
            heading = ((camx > 0) - (camx < 0), (camy > 0) - (camy < 0))
            if okey != key:
                continue  # the step over a connection: its stale rows are still being drawn
            dx, dy = px - ox, py - oy
            if abs(dx) + abs(dy) != 1:
                fail("%s: not one step from the last rest (%d,%d)" % (where, ox, oy))
                continue
            xt, yt = (oxt + 2 * dx) & 31, (oyt + 2 * dy) & (TILE_ROWS - 1)
            crossed = False
        down = not rest and camy > 0
        right = not rest and camx > 0
        wrong = 0
        checked = 0
        for ry in range(-ABOVE, ROWS - ABOVE):
            for rx in range(16):
                # What should be in this slot: grid cell (pos.x + rx, pos.y + ry) -- or,
                # mid-step, the row or column the step left in the far slot.
                gx, gy = px + rx, py + ry
                if down and ry == ROWS - 1 - ABOVE:
                    gy = py - ABOVE - 1
                if right and rx == 15:
                    gx = px - 1
                mx, my = gx - MAP_OFFSET, gy - MAP_OFFSET
                if not lay.inside(mx, my):
                    continue
                want = lay.cell(mx, my)
                if want is None:
                    continue
                t = ((yt + 2 * ry) & (TILE_ROWS - 1)) * 32 + ((xt + 2 * rx) & 31)
                got = []
                for buf in (bg1, bg2, bg3):
                    got.append([buf[2 * o] | buf[2 * o + 1] << 8 for o in (t, t + 1, t + 32, t + 33)])
                checked += 1
                if got != [list(w) for w in want]:
                    wrong += 1
                    if wrong <= 3:
                        fail("%s: ring row %d column %d (map %d,%d) holds %s, not %s"
                             % (where, ry, rx, mx, my, [["%04X" % v for v in g] for g in got],
                                [["%04X" % v for v in w] for w in want]))
        if wrong > 3:
            fail("%s: %d wrong cells in all" % (where, wrong))
        stats["cells"] += checked
        if rest:
            stats["rest"] += checked == 16 * ROWS
            if crossed and checked:
                stats["cross"] += 1
            prev_rest = ((px, py), key, xt, yt)
        else:
            phase = abs(camx or camy)
            if camy < 0 and phase == 2:
                stats["first-up"] += 1
            if camx < 0 and phase == 2:
                stats["first-left"] += 1
            if down and phase in (2, 4, 8):
                stats["held-down"] += 1
            if right and phase in (2, 4, 8):
                stats["held-right"] += 1
    print("%d records, %d cells checked; %d whole rings at rest, %d first frames up, %d left, "
          "%d frames mid-step down, %d right, %d rests past a connection"
          % (len(recs), stats["cells"], stats["rest"], stats["first-up"], stats["first-left"],
             stats["held-down"], stats["held-right"], stats["cross"]))
    if bad:
        print("%d failures" % bad)
        sys.exit(1)
    if min(stats["rest"], stats["first-up"], stats["first-left"], stats["held-down"], stats["held-right"], stats["cross"]) == 0:
        print("the run did not exercise every case")
        sys.exit(2)


if __name__ == "__main__":
    main()
