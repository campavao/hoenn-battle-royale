#!/usr/bin/env python3
"""Fill the holes in Hoenn: what stands past the edge of a map, as map cells.

    python tools/br/export-fill.py [--preview out.png]  -> web/spike-b/data/world-fill.json

Cam, 11-02, on the field past a map's edge: "fill this in kind of like matching the seams
... this kind of extends in the mountain over here ... in these large swaths we can just
keep this blue ... shore this up over here so it doesn't extend too far out". The ROM has
nothing there: on a GBA the picture never reaches it. The page used to tile the 2x2 border
block of whichever map the camera was over, so the space changed as you crossed a seam.

The rule, on the plane main.ts layout() lays the outdoor maps on (the same walk over the
seams):
  1. Every cell of a real map says what it is, from the colours of its metatile: water,
     sand, grass, tree or rock.
  2. Each empty cell near a map takes after the map's edge: the sea carries on from a sea,
     the trees and ridges from theirs (a noisy distance, so a line between two is not ruled).
     Land stops LAND_REACH cells out, so a hole with the sea in it, or open to the world
     outside, is a coast with sea beyond. A hole shut in with little water on its rim is all
     land. Past the rectangle, for ever, is the sea.
  3. Each kind is cut from General's own pieces, the ones the real maps use: sand on water
     for an open coast (then grass, then whole trees), a ridge's rim, faces and foot on
     whatever is next to it. Same metatiles, same palettes, so it reads as one map.

What ships is metatile numbers, from the pret tree, as the rest of the world's data does; the
page cuts the pictures from the player's own ROM (romart.ts fillChunk). Nothing here is
random from run to run. Only the page reads this: the relay never sees it, so it is
outside WORLD_HASH.
"""
import argparse
import collections
import heapq
import importlib.util
import json
import math
import os
import struct

import numpy as np

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'web', 'spike-b', 'data', 'world-fill.json')

WATER, SAND, GRASS, TREE, ROCK = 0, 1, 2, 3, 4
NAMES = 'WSGTR'
# The sea's metatile in every outdoor tileset (General's).
SEA = 0x170
# How far land reaches past a map's edge, in cells, before the sea takes over: an open coast.
LAND_REACH = 18
# Cells of sea or land kept past the world's rectangle before the page's own endless sea.
MARGIN = 72

_spec = importlib.util.spec_from_file_location('render_maps', os.path.join(ROOT, 'tools', 'br', 'render-maps.py'))
rm = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(rm)


def hash_noise(x, y, cell):
    """Smooth value noise in 0..1, the same every run."""
    def h(i, j):
        v = (i * 374761393 + j * 668265263) & 0xFFFFFFFF
        v = ((v ^ (v >> 13)) * 1274126177) & 0xFFFFFFFF
        return ((v ^ (v >> 16)) & 0xFFFF) / 65535
    fx, fy = x / cell, y / cell
    i, j = math.floor(fx), math.floor(fy)
    tx, ty = fx - i, fy - j
    tx, ty = tx * tx * (3 - 2 * tx), ty * ty * (3 - 2 * ty)
    a = h(i, j) * (1 - tx) + h(i + 1, j) * tx
    b = h(i, j + 1) * (1 - tx) + h(i + 1, j + 1) * tx
    return a * (1 - ty) + b * ty


def noise(x, y):
    return 0.6 * hash_noise(x, y, 11) + 0.4 * hash_noise(x + 57, y - 31, 4)


class Plane:
    """The outdoor maps where main.ts layout() puts them, with their cells."""

    def __init__(self):
        world = json.load(open(os.path.join(ROOT, 'web', 'spike-b', 'data', 'world.json'), encoding='utf-8'))['maps']
        self.maps = {m['id']: m for m in world}
        layouts = {l['id']: l for l in json.load(open(os.path.join(ROOT, 'data', 'layouts', 'layouts.json'), encoding='utf-8'))['layouts'] if 'id' in l}
        layout_of = {}
        for d in sorted(os.listdir(os.path.join(ROOT, 'data', 'maps'))):
            f = os.path.join(ROOT, 'data', 'maps', d, 'map.json')
            if os.path.exists(f):
                j = json.load(open(f, encoding='utf-8'))
                layout_of[j['id']] = j['layout']
        start = 'MAP_LITTLEROOT_TOWN'
        self.at = {start: (0, 0)}
        q = collections.deque([start])
        while q:
            i = q.popleft()
            m = self.maps[i]
            gx, gy = self.at[i]
            for s in m['seams']:
                t = self.maps.get(s['to'])
                if not t or not t.get('outdoor') or t['id'] in self.at:
                    continue
                o, d = s['offset'], s['dir']
                self.at[t['id']] = (gx + o, gy - t['h']) if d == 'north' else (gx + o, gy + m['h']) if d == 'south' else (gx - t['w'], gy + o) if d == 'west' else (gx + m['w'], gy + o)
                q.append(t['id'])
        self.layouts = {i: layouts[layout_of[i]] for i in self.at}
        self.x0 = min(p[0] for p in self.at.values())
        self.y0 = min(p[1] for p in self.at.values())
        self.x1 = max(p[0] + self.maps[i]['w'] for i, p in self.at.items())
        self.y1 = max(p[1] + self.maps[i]['h'] for i, p in self.at.items())
        self.blocks = {}
        for i, l in self.layouts.items():
            w, h = l['width'], l['height']
            raw = open(os.path.join(ROOT, l['blockdata_filepath']), 'rb').read()
            self.blocks[i] = struct.unpack(f'<{w * h}H', raw[: w * h * 2])
        self.tilesets = {}
        self.kinds = {}

    def ts(self, map_id):
        l = self.layouts[map_id]
        key = (l['primary_tileset'], l['secondary_tileset'])
        if key not in self.tilesets:
            self.tilesets[key] = rm.Tilesets(l)
        return self.tilesets[key], key

    def block_px(self, map_id, mid):
        from PIL import Image
        ts, key = self.ts(map_id)
        k = ('px', key if mid >= 512 else None, mid)
        if k not in self.kinds:
            img = Image.new('RGB', (16, 16), (0, 0, 0))
            ts.draw_block(img, 0, 0, mid)
            self.kinds[k] = img
        return self.kinds[k]

    def kind(self, map_id, mid):
        """Water, sand, grass, tree or rock, by what most of the metatile's pixels are."""
        _, key = self.ts(map_id)
        k = ('kind', key if mid >= 512 else None, mid)
        if k not in self.kinds:
            a = np.asarray(self.block_px(map_id, mid), dtype=int)
            r, g, b = a[..., 0], a[..., 1], a[..., 2]
            water = (b > r + 24) & (b > g)
            sand = (r > 190) & (g > 160) & (b < 170) & (r > b + 50) & (g > b + 30)
            grass = (g > r + 24) & (g > 150) & (b > 110)
            tree = (g > r) & (g > b) & ~grass
            rock = (r >= g) & ~sand
            n = [water.sum(), sand.sum(), grass.sum(), tree.sum(), rock.sum()]
            self.kinds[k] = int(np.argmax(n))
        return self.kinds[k]


# General's own pieces, as the real maps lay them: each kind's nine-slice on what is next to it.
SAND_ON_WATER = {'tl': 0x11B, 't': 0x11C, 'tr': 0x11D, 'l': 0x123, 'c': 0x124, 'r': 0x125, 'bl': 0x12B, 'b': 0x12C, 'br': 0x12D,
                 'nw': 0x13D, 'ne': 0x13E, 'sw': 0x145, 'se': 0x146}
SAND_ON_GRASS = {'tl': 0x118, 't': 0x119, 'tr': 0x11A, 'l': 0x120, 'c': 0x121, 'r': 0x122, 'bl': 0x128, 'b': 0x129, 'br': 0x12A,
                 'nw': 0x121, 'ne': 0x121, 'sw': 0x121, 'se': 0x121}
ROCK_BODY = 0x71
ROCK_ON_GRASS = {'tl': 0x68, 't': 0x69, 'tr': 0x6A, 'l': 0x70, 'c': ROCK_BODY, 'r': 0x72, 'bl': 0x78, 'b': 0x79, 'br': 0x7A,
                 'nw': ROCK_BODY, 'ne': ROCK_BODY, 'sw': 0x77, 'se': 0x76}
ROCK_ON_SAND = {'tl': 0x80, 't': 0x81, 'tr': 0x82, 'l': 0x88, 'c': ROCK_BODY, 'r': 0x8A, 'bl': 0x90, 'b': 0x91, 'br': 0x92,
                'nw': ROCK_BODY, 'ne': ROCK_BODY, 'sw': 0x77, 'se': 0x76}
ROCK_ON_WATER = {'tl': 0x172, 't': 0x173, 'tr': 0x174, 'l': 0x17A, 'c': ROCK_BODY, 'r': 0x17C, 'bl': 0x182, 'b': 0x17D, 'br': 0x184,
                 'nw': ROCK_BODY, 'ne': ROCK_BODY, 'sw': 0x77, 'se': 0x76}
# The row above a cliff's foot: rock darkening into the face.
ROCK_FACE = 0x89
GRASS_CELL = 0x1
# The forests: inside, as a 2 x 2 (x & 1, y & 1 on its own map's grid); the top row over open
# ground; the bottom row over open ground.
FOREST_A = {'inside': (0x1D4, 0x1D5, 0x1DC, 0x1DD), 'top': (0x1D6, 0x1D7), 'bottom': (0x1E4, 0x1E5)}
FOREST_B = {'inside': (0xC6, 0xC7, 0xC7, 0xC6), 'top': (0xE, 0xF), 'bottom': (0x16, 0x17)}
FOREST_B_IDS = {0xC6, 0xC7, 0xE, 0xF, 0x16, 0x17, 0x4, 0xD, 0x15}
# A hole shut in by the maps is a sea if this much of its rim is water, else all land.
SEA_RIM = 0.35
# Fewer land cells than this along an edge is a rock in the sea, not a shore.
SHORE_RUN = 6
# Sand this thick on an open coast, then grass, then the trees.
BEACH = 3
MEADOW = 5


def slice_of(table, here):
    """`here(dx, dy)` is True where this kind goes on: the piece for that shape."""
    n, e, s, w = here(0, -1), here(1, 0), here(0, 1), here(-1, 0)
    if not n:
        return table['tl'] if not w else table['tr'] if not e else table['t']
    if not s:
        return table['bl'] if not w else table['br'] if not e else table['b']
    if not w:
        return table['l']
    if not e:
        return table['r']
    if not here(-1, -1):
        return table['nw']
    if not here(1, -1):
        return table['ne']
    if not here(-1, 1):
        return table['sw']
    if not here(1, 1):
        return table['se']
    return table['c']


def edge_runs(plane):
    """Each map's edge cells that are land, with how long the run of land along that edge is."""
    runs = {}
    for i, (gx, gy) in plane.at.items():
        m = plane.maps[i]
        w, h = m['w'], m['h']
        lines = [[(x, 0) for x in range(w)], [(x, h - 1) for x in range(w)], [(0, y) for y in range(h)], [(w - 1, y) for y in range(h)]]
        for line in lines:
            run = []
            for c in line + [None]:
                wet = c is None or plane.kind(i, plane.blocks[i][c[1] * w + c[0]] & 0x3ff) == WATER
                if not wet:
                    run.append(c)
                elif run:
                    for x, y in run:
                        runs[(gx + x, gy + y)] = max(runs.get((gx + x, gy + y), 0), len(run))
                    run = []
    return runs


def forest_of(plane, map_id, mid):
    """(forest table or a block with its map for a tileset's own, phase x, phase y)."""
    border = [b & 0x3ff for b in struct.unpack('<4H', open(os.path.join(ROOT, plane.layouts[map_id]['border_filepath']), 'rb').read()[:8])]
    if plane.kind(map_id, border[0]) == TREE and border[0] >= 512:
        return ('own', map_id, tuple(border))
    if mid in FOREST_B_IDS or (plane.kind(map_id, border[0]) == TREE and border[0] in FOREST_B_IDS):
        return ('b',)
    return ('a',)


def rock_of(plane, map_id):
    border = [b & 0x3ff for b in struct.unpack('<4H', open(os.path.join(ROOT, plane.layouts[map_id]['border_filepath']), 'rb').read()[:8])]
    if plane.kind(map_id, border[0]) == ROCK and border[0] >= 512:
        return ('own', map_id, tuple(border))
    return ('body',)


def generate():
    plane = Plane()
    x0, y0 = plane.x0 - MARGIN, plane.y0 - MARGIN
    W, H = plane.x1 - plane.x0 + 2 * MARGIN, plane.y1 - plane.y0 + 2 * MARGIN
    owner = np.full((H, W), -1, dtype=int)
    kind = np.full((H, W), -1, dtype=int)
    ids = list(plane.at)
    for n, i in enumerate(ids):
        gx, gy = plane.at[i]
        m = plane.maps[i]
        for y in range(m['h']):
            for x in range(m['w']):
                owner[gy + y - y0, gx + x - x0] = n
                kind[gy + y - y0, gx + x - x0] = plane.kind(i, plane.blocks[i][y * m['w'] + x] & 0x3ff)
    runs = edge_runs(plane)
    blank = owner < 0

    def edge_is_land(u, v):
        return kind[v, u] != WATER and runs.get((u + x0, v + y0), 0) >= SHORE_RUN

    # The holes: does the sea reach this one? The outside does; one shut in by the maps only if
    # water is a good part of its rim, not a pond that happens to touch an edge.
    region = np.full((H, W), -1, dtype=int)
    open_sea = []
    for sy in range(H):
        for sx in range(W):
            if not blank[sy, sx] or region[sy, sx] >= 0:
                continue
            r = len(open_sea)
            outside = False
            wet = dry = 0
            stack = [(sx, sy)]
            region[sy, sx] = r
            while stack:
                x, y = stack.pop()
                if x in (0, W - 1) or y in (0, H - 1):
                    outside = True
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    u, v = x + dx, y + dy
                    if 0 <= u < W and 0 <= v < H:
                        if blank[v, u]:
                            if region[v, u] < 0:
                                region[v, u] = r
                                stack.append((u, v))
                        elif edge_is_land(u, v):
                            dry += 1
                        else:
                            wet += 1
            open_sea.append(outside or wet >= SEA_RIM * (wet + dry))

    # Two floods from the edges, with a noisy cost so nothing comes out ruled: the nearest land
    # edge (and what it is, and how long a shore it is) and the nearest sea edge.
    INF = float(1 << 30)
    dland = np.full((H, W), INF)
    dsea = np.full((H, W), INF)
    source = {}
    heap_l, heap_s = [], []
    for y in range(H):
        for x in range(W):
            if not blank[y, x]:
                continue
            if x in (0, W - 1) or y in (0, H - 1):
                dsea[y, x] = 0
                heap_s.append((0.0, x, y))
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                u, v = x + dx, y + dy
                if not (0 <= u < W and 0 <= v < H) or blank[v, u]:
                    continue
                if edge_is_land(u, v):
                    dland[y, x] = 0
                    i = ids[owner[v, u]]
                    gx, gy = plane.at[i]
                    mid = plane.blocks[i][(v + y0 - gy) * plane.maps[i]['w'] + (u + x0 - gx)] & 0x3ff
                    source[(x, y)] = (i, mid, int(kind[v, u]), runs[(u + x0, v + y0)])
                    heap_l.append((0.0, x, y))
                else:
                    dsea[y, x] = 0
                    heap_s.append((0.0, x, y))
    for heap, dist, carry in ((heap_l, dland, True), (heap_s, dsea, False)):
        heapq.heapify(heap)
        while heap:
            d, x, y = heapq.heappop(heap)
            if d > dist[y, x]:
                continue
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                u, v = x + dx, y + dy
                if not (0 <= u < W and 0 <= v < H) or not blank[v, u]:
                    continue
                nd = d + 0.6 + 0.8 * noise(u + x0, v + y0)
                if nd < dist[v, u]:
                    dist[v, u] = nd
                    if carry:
                        source[(u, v)] = source[(x, y)]
                    heapq.heappush(heap, (nd, u, v))

    # The land and the sea: nearer the land's edge than the sea's, and not too far out; a short
    # shore makes a short cape.
    land = np.zeros((H, W), dtype=bool)
    for y in range(H):
        for x in range(W):
            if not blank[y, x] or (x, y) not in source:
                continue
            reach = LAND_REACH * (0.55 + 0.9 * noise(x + x0 + 200, y + y0 + 200))
            run = source[(x, y)][3]
            if not open_sea[region[y, x]]:
                land[y, x] = True
            elif dland[y, x] < dsea[y, x] and dland[y, x] < min(reach, 0.7 * run + 2):
                land[y, x] = True
    # No specks and no spits one cell wide: the pieces have no shape for them.
    for _ in range(3):
        count = np.zeros((H, W), dtype=int)
        solid = land | (~blank & (kind != WATER))
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                if dx or dy:
                    count += np.roll(np.roll(solid, dy, 0), dx, 1)
        land = blank & ((land & (count >= 4)) | (~land & (count >= 6)))

    # ...nor teeth: a land cell stands in a 3 x 3 of land, or goes under.
    solid = land | (~blank & (kind != WATER))
    square = np.ones((H, W), dtype=bool)
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            square &= np.roll(np.roll(solid, dy, 0), dx, 1)
    kept = square.copy()
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            kept |= np.roll(np.roll(square, dy, 0), dx, 1)
    land &= kept

    # What each land cell is. dcoast: cells to the nearest water (the sea or a real map's).
    grid = kind.copy()
    grid[blank & ~land] = WATER
    dcoast = np.full((H, W), 99, dtype=int)
    wet = grid == WATER
    frontier = collections.deque((x, y) for y in range(H) for x in range(W) if wet[y, x])
    for x, y in frontier:
        dcoast[y, x] = 0
    while frontier:
        x, y = frontier.popleft()
        if dcoast[y, x] >= 12:
            continue
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (1, -1), (-1, 1), (-1, -1)):
            u, v = x + dx, y + dy
            if 0 <= u < W and 0 <= v < H and dcoast[v, u] > dcoast[y, x] + 1:
                dcoast[v, u] = dcoast[y, x] + 1
                frontier.append((u, v))
    cover = {}
    for y in range(H):
        for x in range(W):
            if not (blank[y, x] and land[y, x]):
                continue
            i, mid, k, _ = source.get((x, y), ('MAP_LITTLEROOT_TOWN', 0x1D4, TREE, 0))
            if k == SAND and dland[y, x] > 3:
                k = TREE
            if k == GRASS and dland[y, x] > 2:
                k = TREE
            if k == ROCK and forest_of(plane, i, mid)[0] == 'own':
                # ROUTE 114's ash: its rock has no pieces in General's colours; its ashen
                # trees (the border the ROM repeats there) carry on instead.
                k = TREE
            if k != ROCK:
                # An open coast: sand, then grass, then the trees.
                wob = int(2 * noise(x + x0 - 400, y + y0 + 90))
                if dcoast[y, x] <= BEACH + wob:
                    k = SAND
                elif dcoast[y, x] <= MEADOW + wob and k == TREE:
                    k = GRASS
            grid[y, x] = k
            cover[(x, y)] = (i, mid, k)
    # Grass round a ridge, where trees would run straight into its foot.
    near_rock = grid == ROCK
    grown = near_rock.copy()
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            grown |= np.roll(np.roll(near_rock, dy, 0), dx, 1)
    grid[blank & grown & (grid == TREE)] = GRASS

    # The forests in whole trees, on a lattice of 2 x 2: anything left over is grass.
    forest = {}
    for (x, y), (i, mid, k) in cover.items():
        if grid[y, x] == TREE:
            forest[(x, y)] = forest_of(plane, i, mid)
    whole = {}
    for (x, y), f in forest.items():
        tx, ty = (x + x0) & ~1, (y + y0) & ~1
        cells = [(tx - x0 + a, ty - y0 + b) for a in (0, 1) for b in (0, 1)]
        whole[(x, y)] = all(forest.get(c) == f or (c[0] < W and c[1] < H and not blank[c[1], c[0]] and kind[c[1], c[0]] == TREE) for c in cells)
    for c, ok in whole.items():
        if not ok:
            grid[c[1], c[0]] = GRASS
            forest.pop(c, None)
    # A ridge is as thick as its pieces need, the same way: three by three, or it is grass.
    solid = grid == ROCK
    square = np.ones((H, W), dtype=bool)
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            square &= np.roll(np.roll(solid, dy, 0), dx, 1)
    kept = square.copy()
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            kept |= np.roll(np.roll(square, dy, 0), dx, 1)
    grid[blank & (grid == ROCK) & ~kept] = GRASS
    # A neck of sand has no piece either.
    for _ in range(2):
        for y in range(1, H - 1):
            for x in range(1, W - 1):
                if not blank[y, x] or grid[y, x] != SAND:
                    continue
                if (grid[y, x - 1] != SAND and grid[y, x + 1] != SAND) or (grid[y - 1, x] != SAND and grid[y + 1, x] != SAND):
                    grid[y, x] = GRASS
    # A puddle left in the land is land: only a sea, or a real map's water, stays water.
    seen = np.zeros((H, W), dtype=bool)
    for sy in range(H):
        for sx in range(W):
            if seen[sy, sx] or not blank[sy, sx] or grid[sy, sx] != WATER:
                continue
            seen[sy, sx] = True
            stack, cells, sea = [(sx, sy)], [], False
            while stack:
                x, y = stack.pop()
                cells.append((x, y))
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    u, v = x + dx, y + dy
                    if not (0 <= u < W and 0 <= v < H):
                        sea = True
                    elif not blank[v, u]:
                        sea = sea or kind[v, u] == WATER
                    elif grid[v, u] == WATER and not seen[v, u]:
                        seen[v, u] = True
                        stack.append((u, v))
            if not sea or len(cells) < 12:
                for x, y in cells:
                    grid[y, x] = GRASS

    palette = {}
    def sym(entry):
        return palette.setdefault(entry, len(palette))
    sym(('sea',))
    def single(mid):
        return sym(('block', None, mid, mid, mid, mid))
    out = np.zeros((H, W), dtype=int)
    for y in range(H):
        for x in range(W):
            if not blank[y, x]:
                out[y, x] = -1
                continue
            k = int(grid[y, x])
            if k == WATER or x in (0, W - 1) or y in (0, H - 1):
                continue
            g = grid[y - 1:y + 2, x - 1:x + 2]
            if k == GRASS:
                out[y, x] = single(GRASS_CELL)
            elif k == SAND:
                table = SAND_ON_WATER if (g == WATER).any() else SAND_ON_GRASS
                # Sand against a real map's cliff or trees just stops: as if it went on.
                if table is SAND_ON_WATER:
                    goes_on = lambda dx, dy: grid[y + dy, x + dx] != WATER
                else:
                    goes_on = lambda dx, dy: grid[y + dy, x + dx] != GRASS and grid[y + dy, x + dx] != TREE
                out[y, x] = single(slice_of(table, goes_on))
            elif k == ROCK:
                table = ROCK_ON_WATER if (g == WATER).any() else ROCK_ON_SAND if (g == SAND).any() else ROCK_ON_GRASS
                goes_on = lambda dx, dy: grid[y + dy, x + dx] == ROCK
                piece = slice_of(table, goes_on)
                if piece == ROCK_BODY:
                    i, mid, _ = cover.get((x, y), ('MAP_LITTLEROOT_TOWN', 0, ROCK))
                    if y + 2 < H and grid[y + 1, x] == ROCK and grid[y + 2, x] != ROCK:
                        out[y, x] = single(ROCK_FACE)
                        continue
                    own = rock_of(plane, i)
                    if own[0] == 'own':
                        out[y, x] = sym(('block', own[1]) + phased(own[2], plane.at[own[1]]))
                        continue
                out[y, x] = single(piece)
            else:
                f = forest.get((x, y))
                if not f:
                    out[y, x] = single(GRASS_CELL)
                elif f[0] == 'own':
                    out[y, x] = sym(('block', f[1]) + phased(f[2], plane.at[f[1]]))
                else:
                    t = FOREST_B if f[0] == 'b' else FOREST_A
                    wx, wy = x + x0, y + y0
                    # The row of a tree this cell is in, and whether a tree stands over or under it.
                    if not (wy & 1):
                        real = y >= 2 and not blank[y - 2, x] and kind[y - 2, x] == TREE
                        if forest.get((x, y - 2)) != f and not real:
                            out[y, x] = single(t['top'][wx & 1])
                            continue
                    else:
                        real = y + 2 < H and not blank[y + 2, x] and kind[y + 2, x] == TREE
                        if forest.get((x, y + 2)) != f and not real:
                            out[y, x] = single(t['bottom'][wx & 1])
                            continue
                    out[y, x] = sym(('block', None) + t['inside'])
    return plane, x0, y0, W, H, out, palette, None


def phased(block, at):
    """A border block on its own map's grid, as the plane's x & 1, y & 1."""
    px, py = at[0] & 1, at[1] & 1
    return tuple(block[((yy ^ py) << 1) | (xx ^ px)] for yy in (0, 1) for xx in (0, 1))


def rle(row):
    parts = []
    run, val = 0, None
    for v in row:
        if v == val:
            run += 1
        else:
            if run:
                parts.append(f'{run}x{val}')
            run, val = 1, v
    if run:
        parts.append(f'{run}x{val}')
    return ';'.join(parts)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--preview')
    ap.add_argument('--scale', type=int, default=4)
    ap.add_argument('--crop')
    a = ap.parse_args()
    plane, x0, y0, W, H, out, palette, _ = generate()
    entries = sorted(palette, key=palette.get)
    doc = {'x0': x0, 'y0': y0, 'w': W, 'h': H, 'blocks': [list(e[1:]) if e[0] == 'block' else [] for e in entries], 'rows': rle((out.clip(min=0)).reshape(-1).tolist())}
    json.dump(doc, open(OUT, 'w', encoding='utf-8'), separators=(',', ':'))
    print('wrote', OUT, os.path.getsize(OUT), 'bytes;', len(entries), 'blocks;', W, 'x', H, 'cells')
    if a.preview:
        preview(plane, x0, y0, W, H, out, entries, a)


def preview(plane, x0, y0, W, H, out, entries, a):
    from PIL import Image
    S = a.scale
    crop = [int(v) for v in a.crop.split(',')] if a.crop else [0, 0, W, H]
    cx0, cy0, cw, ch = crop
    img = Image.new('RGB', (cw * 16 // S, ch * 16 // S), (0, 0, 0))
    cache = {}
    default = next(iter(plane.at))
    def tile(ref, mid):
        k = (ref if mid >= 512 else None, mid)
        if k not in cache:
            cache[k] = plane.block_px(ref or default, mid).resize((16 // S, 16 // S), Image.BOX)
        return cache[k]
    for y in range(cy0, cy0 + ch):
        for x in range(cx0, cx0 + cw):
            v = out[y, x]
            if v < 0:
                continue
            e = entries[v]
            if e[0] == 'sea':
                mid, ref = SEA, None
            else:
                ref = e[1]
                mid = e[2 + (((y + y0) & 1) << 1 | ((x + x0) & 1))]
            img.paste(tile(ref, mid), ((x - cx0) * 16 // S, (y - cy0) * 16 // S))
    for i, (gx, gy) in plane.at.items():
        f = os.path.join(ROOT, 'web', 'public', 'field-maps', i + '.png')
        if os.path.exists(f):
            im = Image.open(f).convert('RGB')
            im = im.resize((im.width // S, im.height // S), Image.BOX)
            img.paste(im, ((gx - x0 - cx0) * 16 // S, (gy - y0 - cy0) * 16 // S))
    img.save(a.preview)
    print('preview', img.size)


if __name__ == '__main__':
    main()
