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
  3. An open coast is sand on water, then grass, then trees. Same metatiles, same palettes as the
     real maps, so it reads as one map.
  4. Nobody can stand on any of it, so near where somebody can stand it doesn't look as if they
     could (Cam, 11-04: "it almost looks like I can walk over here but I can't"): no grass within
     WALK_GAP cells of a map's walkable cell, trees instead. Water keeps its beach all the same
     (Cam, 11-04: "let's change this to beaches along the water in general").
  5. MOUNTAINS say where Hoenn is one range (Cam, 11-04: "it looks like this all is one big
     mountain region", and the map of Hoenn Cam sent), each in the rock of the real map beside it.
  6. Which metatile goes in a cell is learnt from the real maps: a piece goes only beside what the
     maps put it beside, the real cells at the edge included, and a mountain's face comes from a
     real mountain (Cam, 11-04: "we should never have a hard cut"; "ideally we should never see
     a tree cut off"). solve() does it, and `seams()` counts what it couldn't.

  7. map-paint.json goes on top of all that, cell for cell: what Cam painted at /map/
     (Cam, 11-05: "use a tile editor or something on mobile to clean up the map").
     apply-map-paint.py adds to it.

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
import sys

import numpy as np

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'web', 'spike-b', 'data', 'world-fill.json')
PAINT = os.path.join(ROOT, 'tools', 'br', 'map-paint.json')

WATER, SAND, GRASS, TREE, ROCK = 0, 1, 2, 3, 4
NAMES = 'WSGTR'
# The sea's metatile in every outdoor tileset (General's).
SEA = 0x170
# How far land reaches past a map's edge, in cells, before the sea takes over: an open coast.
LAND_REACH = 18
# Cells of sea or land kept past the world's rectangle before the page's own endless sea.
MARGIN = 72

# room.ts LOOSE_SEAM: the walk that lays the plane doesn't cross it.
LOOSE_SEAM = {'MAP_PETALBURG_CITY', 'MAP_ROUTE102'}

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
                if not t or not t.get('outdoor') or t['id'] in self.at or {i, t['id']} == LOOSE_SEAM:
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
        self.grids = {}

    def classes(self, map_id):
        """The map's walk classes, a cell at a time."""
        if map_id not in self.grids:
            out = []
            for run in self.maps[map_id]['grid'].split(';'):
                if run:
                    n, v = run.split('x')
                    out += [int(v)] * int(n)
            self.grids[map_id] = out
        return self.grids[map_id]

    def cell_kind(self, map_id, x, y):
        """kind() at a cell. A blue roof or a town's paving has water's colours and isn't water, which
        made a sea of VERDANTURF's west edge: colours that say water count only with water in reach
        (a rock in the sea)."""
        m = self.maps[map_id]
        w, h = m['w'], m['h']
        k = self.kind(map_id, self.blocks[map_id][y * w + x] & 0x3ff)
        if k != WATER:
            return k
        g = self.classes(map_id)
        for dy in range(-4, 5):
            for dx in range(-4, 5):
                u, v = x + dx, y + dy
                if 0 <= u < w and 0 <= v < h and g[v * w + u] == CLASS_WATER:
                    return WATER
        return GRASS

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


# General's own pieces.
ROCK_BODY = 0x71
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
# A ridge is at least this many cells each way from its middle.
RIDGE = 3
# Sand this thick on an open coast, then grass, then the trees.
BEACH = 3
MEADOW = 5
# Cells from anywhere a trainer can stand before the fill may be open ground.
WALK_GAP = 4
# world.json's walk classes (bots/world.ts).
CLASS_WALL, CLASS_WATER = 1, 2


# Hoenn's ranges, where the holes between the maps are one mountain, in the picture's pixels (
# world-artboard.json: a cell is a pixel >> 4, then plane.worldX, worldY). Each: a map whose
# tilesets draw it, the rectangle of that map whose faces it takes after, and where.
# `calm` is how much of it is the rock's flat top rather than its faces, 0 to 1, that top's pieces,
# how many faces may stand side by side, and how long a cliff may run (None: as the real rock has).
MOUNTAINS = [
    # Behind ROUTE 114, FALLARBOR and ROUTE 113, in ROUTE 114's terraces.
    ('MAP_ROUTE114', [('MAP_ROUTE114', (4, 1, 30, 9))], (0.35, {0x279}, None, None), [(720, 60), (3380, 60), (3380, 256), (1536, 256), (896, 256), (896, 560), (720, 560)]),
    # ROUTE 114's and 115's grey range, on past the map's edge to the east and south.
    ('MAP_ROUTE114', [('MAP_ROUTE114', (0, 28, 40, 50))], (0.8, {0x241}, None, None), [(500, 640), (860, 560), (1560, 560), (1940, 576), (1940, 1200), (1880, 1560), (1650, 1820), (880, 1840), (780, 1700), (896, 1536), (896, 896), (500, 896)]),
    # MT. CHIMNEY's, where the ropeway goes, north and west of LAVARIDGE.
    ('MAP_ROUTE112', [('MAP_ROUTE112', (0, 8, 28, 40))], (0.6, {0x271, 0x269}, 3, None), [(2160, 576), (2830, 576), (2830, 1536), (3000, 1720), (2500, 2040), (2100, 1760), (2090, 1560), (2160, 1200)]),
]
# Any other rock the land has, and the massifs: General's, as the maps lay it on grass, sand and water.
PLAIN_ROCK = ('MAP_ROUTE116', [('MAP_ROUTE116', (0, 0, 60, 20)), ('MAP_ROUTE103', (0, 0, 80, 22)), ('MAP_ROUTE118', (0, 0, 80, 20)), ('MAP_ROUTE120', (0, 0, 40, 100))], (0.85, {ROCK_BODY}, None, 7), [])
# Whole massifs of plain rock, in the same pixels, that stand where they are.
MASSIFS = [
    # Between ROUTE 116, LAVARIDGE and ROUTE 111.
    [(1500, 1800), (2000, 1760), (2500, 2040), (3000, 1720), (3440, 1650), (3440, 2440), (1500, 2440)],
    # East of ROUTE 111, down to ROUTE 118.
    [(4096, 40), (4400, 40), (4400, 2496), (4096, 2496)],
    # North of ROUTE 112, against ROUTE 111.
    [(3380, 40), (4100, 40), (4100, 256), (3380, 256)],
]
TAPERS = {'MAP_ROUTE103', 'MAP_ROUTE110', 'MAP_ROUTE117', 'MAP_ROUTE118', 'MAP_ROUTE119', 'MAP_ROUTE120', 'MAP_ROUTE121', 'MAP_ROUTE122', 'MAP_ROUTE123', 'MAP_ROUTE124', 'MAP_ROUTE126', 'MAP_FORTREE_CITY', 'MAP_LILYCOVE_CITY', 'MAP_MAUVILLE_CITY'}
# How far a range's outline wanders off the polygon, in cells.
RAGGED = 7
# What a real map's rock may not lend a range: the ropeway, a cave's mouth, a sign, what grows on it.
ROPEWAY = set(range(0x250, 0x266))
NOT_FACES = {
    'gTileset_Lavaridge': ROPEWAY | {0x203, 0x210, 0x211, 0x218, 0x21A, 0x224, 0x241, 0x24A, 0x2EE, 0x3B8},
    'gTileset_Fallarbor': {0x208, 0x20E, 0x20F, 0x22A},
}
# General's, in any tileset: grass, stairs, the forests.
NOT_ROCK_PIECES = {0x1, 0xAF, 0xCF, 0xC6, 0xC7, 0xE, 0xF, 0x16, 0x17, 0x4, 0xD, 0x15, 0x1D4, 0x1D5, 0x1DC, 0x1DD, 0x1D6, 0x1D7, 0x1E4, 0x1E5}
# Rarer than this in its rectangle isn't part of the rock.
FACE_MIN = 4
# Pieces a cell of each kind may be, the commonest of its tileset's.
CHOICES = 36
# The pair count a pair never seen in a real map scores.
UNSEEN = 0.02


RANGES = MOUNTAINS + [PLAIN_ROCK]
# General's rock's rim and foot, by what it meets, as the real maps lay them.
EDGES = {
    GRASS: {'t': 0x69, 'tl': 0x68, 'tr': 0x6A, 'l': 0x70, 'r': 0x72, 'b': 0x79, 'bl': 0x78, 'br': 0x7A},
    SAND: {'t': 0x81, 'tl': 0x80, 'tr': 0x82, 'l': 0x88, 'r': 0x8A, 'b': 0x91, 'bl': 0x90, 'br': 0x92},
    WATER: {'t': 0x173, 'tl': 0x172, 'tr': 0x174, 'l': 0x17A, 'r': 0x17C, 'b': 0x79, 'bl': 0x182, 'br': 0x184},
}
# General's rock, on grass, sand and water.
PLAIN_PIECES = set(range(0x68, 0x80)) | set(range(0x80, 0x98)) | set(range(0x172, 0x188))


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
                wet = c is None or plane.cell_kind(i, c[0], c[1]) == WATER
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


class Pairs:
    """What the real maps put beside what, per tileset; General's pieces over all of them."""

    def __init__(self, plane):
        self.plane = plane
        self.h = collections.defaultdict(collections.Counter)
        self.v = collections.defaultdict(collections.Counter)
        self.h_to = collections.defaultdict(collections.Counter)
        self.v_to = collections.defaultdict(collections.Counter)
        self.count = collections.defaultdict(collections.Counter)
        self.faces = {}
        for n, (_, sources, _, _) in enumerate(RANGES):
            c = collections.Counter()
            for i, r in sources:
                m = plane.maps[i]
                for y in range(r[1], min(m['h'], r[1] + r[3])):
                    for x in range(r[0], min(m['w'], r[0] + r[2])):
                        c[plane.blocks[i][y * m['w'] + x] & 0x3ff] += 1
            i = sources[0][0]
            if n < len(MOUNTAINS):
                no = NOT_ROCK_PIECES | NOT_FACES.get(self.key(i), set())
                self.faces[n] = {t: k for t, k in c.items() if k >= FACE_MIN and t not in no and plane.kind(i, t) != WATER}
            else:
                self.faces[n] = {t: k for t, k in c.items() if t in PLAIN_PIECES}
        for i in plane.at:
            m = plane.maps[i]
            w, h = m['w'], m['h']
            b = plane.blocks[i]
            t = self.key(i)
            for y in range(h):
                for x in range(w):
                    a = b[y * w + x] & 0x3ff
                    self.count[t][a] += 1
                    if x + 1 < w:
                        self.note(self.h, self.h_to, t, a, b[y * w + x + 1] & 0x3ff, i)
                    if y + 1 < h:
                        self.note(self.v, self.v_to, t, a, b[(y + 1) * w + x] & 0x3ff, i)

    def key(self, map_id):
        return self.plane.layouts[map_id]['secondary_tileset']

    def note(self, pairs, to, t, a, b, i):
        pairs[t][(a, b)] += 1
        if a < 512 and b < 512:
            pairs[None][(a, b)] += 1
        to[t][(a, self.plane.kind(i, b))] += 1

    def seen(self, pairs, ta, a, tb, b):
        if a < 512 and b < 512:
            return pairs[None][(a, b)]
        if ta == tb or b < 512:
            return pairs[ta][(a, b)]
        if a < 512:
            return pairs[tb][(a, b)]
        return 0


def tree_kind(plane, map_id, mid):
    """Which forest carries on from this edge piece of `map_id`."""
    if mid is not None:
        for name, t in (('a', FOREST_A), ('b', FOREST_B)):
            if any(mid in part for part in t.values()):
                return name
    return forest_of(plane, map_id, mid if mid is not None else 0)[0]


def lay_forests(plane, grid, blank, family, cover, tile, tset, pairs, near, x0, y0, W, H):
    """The forests, in whole trees on the two by two their own map's grid has, as the page tiles a
    map's border: so a tree stops at a map's edge where a tree of that map would, and is never cut
    (Cam, 11-04: "ideally we should never see a tree cut off"). Where two forests' trees won't fit
    together what's left over is grass, a clearing rather than a line between them."""
    forest = {}
    # Grass left beside where somebody can stand, by a neck of sand or the like, is trees all the same.
    for y, x in zip(*np.nonzero(blank & (grid == GRASS) & (family < 0) & near)):
        if (int(x), int(y)) in cover:
            grid[y, x] = TREE
    for y, x in zip(*np.nonzero(blank & (grid == TREE) & (family < 0))):
        x, y = int(x), int(y)
        i, mid, _ = cover[(x, y)]
        name = tree_kind(plane, i, mid)
        gx, gy = plane.at[i]
        forest[(x, y)] = (name, gx & 1, gy & 1, i if name == 'own' else None)
    def real_tree(u, v):
        return 0 <= u < W and 0 <= v < H and not blank[v, u] and grid[v, u] == TREE
    # Beside where somebody can stand it stays trees (rule 4), so the rest of each of those trees is
    # a tree too, whatever the coast's grass would have been.
    for (x, y), f in list(forest.items()):
        if not near[y, x]:
            continue
        tx = x - ((x + x0 - f[1]) & 1)
        ty = y - ((y + y0 - f[2]) & 1)
        for a, b in ((0, 0), (1, 0), (0, 1), (1, 1)):
            u, v = tx + a, ty + b
            if 0 <= u < W and 0 <= v < H and blank[v, u] and family[v, u] < 0 and grid[v, u] in (GRASS, SAND, TREE) and (u, v) in cover:
                grid[v, u] = TREE
                forest[(u, v)] = f
    whole = {}
    for (x, y), f in forest.items():
        tx = x - ((x + x0 - f[1]) & 1)
        ty = y - ((y + y0 - f[2]) & 1)
        whole[(x, y)] = f[0] == 'own' or all(forest.get((tx + a, ty + b)) == f or real_tree(tx + a, ty + b) for a in (0, 1) for b in (0, 1))
    for c, ok in whole.items():
        if not ok:
            grid[c[1], c[0]] = GRASS
            del forest[c]
    blocks = {}
    def by_world(ids, f):
        # As the file has a block: by the world's x & 1, y & 1.
        return tuple(ids[((yy ^ f[2]) << 1) | (xx ^ f[1])] for yy in (0, 1) for xx in (0, 1))
    for (x, y), f in forest.items():
        wx, wy = x + x0, y + y0
        u, v = (wx - f[1]) & 1, (wy - f[2]) & 1
        if f[0] == 'own':
            border = forest_of(plane, f[3], 0)[2]
            tile[y, x] = border[(v << 1) | u]
            blocks[(x, y)] = (f[3],) + by_world(border, f)
        else:
            t = FOREST_A if f[0] == 'a' else FOREST_B
            if v == 0 and forest.get((x, y - 2)) != f and not real_tree(x, y - 2):
                tile[y, x] = t['top'][u]
            elif v == 1 and forest.get((x, y + 2)) != f and not real_tree(x, y + 2):
                tile[y, x] = t['bottom'][u]
            else:
                tile[y, x] = t['inside'][(v << 1) | u]
                blocks[(x, y)] = (None,) + by_world(t['inside'], f)
        tset[(x, y)] = pairs.key(cover[(x, y)][0])
    return blocks


def solve(plane, ids, owner, x0, y0, W, H, blank, grid, family, ts_of, cover, near):
    """A metatile for every cell of the holes, outward from the real maps: at each step the cell with
    the most neighbours settled takes the piece the real maps best agree goes there."""
    pairs = Pairs(plane)
    default = next(iter(plane.at))
    tile = np.full((H, W), -1, dtype=int)
    tset = {}
    for n, i in enumerate(ids):
        gx, gy = plane.at[i]
        m = plane.maps[i]
        t = pairs.key(i)
        for y in range(m['h']):
            for x in range(m['w']):
                tile[gy + y - y0, gx + x - x0] = plane.blocks[i][y * m['w'] + x] & 0x3ff
                tset[(gx + x - x0, gy + y - y0)] = t
    sea = blank & (grid == WATER)
    tile[sea] = SEA
    ref_of = {}

    def choices(k, f, i):
        t = pairs.key(i)
        key = (k, f, t)
        if key not in ref_of:
            if f >= 0:
                c = list(pairs.faces[f])
            else:
                c = [a for a, _ in pairs.count[t].most_common() if plane.kind(i, a) == k and a not in ROPEWAY][:CHOICES]
            ref_of[key] = c or [GRASS_CELL]
        return ref_of[key]

    def score(x, y, t, a, f):
        total = 0.0
        for dx, dy, pp, to, here_first in ((1, 0, pairs.h, pairs.h_to, True), (-1, 0, pairs.h, pairs.h_to, False), (0, 1, pairs.v, pairs.v_to, True), (0, -1, pairs.v, pairs.v_to, False)):
            u, v = x + dx, y + dy
            if not (0 <= u < W and 0 <= v < H):
                continue
            b = tile[v, u]
            if b >= 0:
                tb = tset.get((u, v), t)
                n = pairs.seen(pp, t, int(a), tb, int(b)) if here_first else pairs.seen(pp, tb, int(b), t, int(a))
                total += math.log(n + UNSEEN)
            elif here_first:
                total += 0.4 * math.log(to[t][(int(a), int(grid[v, u]))] + UNSEEN)
        return total

    def settle(x, y):
        i = ts_of.get((x, y), default)
        t = pairs.key(i)
        tset[(x, y)] = t
        f = int(family[y, x])
        cs = choices(int(grid[y, x]), f, i)
        return max((score(x, y, t, a, f), a) for a in cs)[1]

    # The ranges first: everything else fits round them.
    for n, (i, sources, calm, _) in enumerate(RANGES):
        draw_range(plane, pairs, sources, calm, n, tile, family, blank, grid, x0, y0, W, H)
        t = pairs.key(i)
        for y, x in zip(*np.nonzero(family == n)):
            tset[(int(x), int(y))] = t
    forest_blocks = lay_forests(plane, grid, blank, family, cover, tile, tset, pairs, near, x0, y0, W, H)
    todo = {(int(x), int(y)) for y, x in zip(*np.nonzero(blank & ~sea & (family < 0) & (tile < 0)))}
    def settled_round(x, y):
        return sum(1 for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)) if 0 <= x + dx < W and 0 <= y + dy < H and tile[y + dy, x + dx] >= 0)
    heap = [(-settled_round(x, y), y, x) for x, y in todo]
    heapq.heapify(heap)
    while heap:
        n, y, x = heapq.heappop(heap)
        if (x, y) not in todo:
            continue
        have = settled_round(x, y)
        if -n != have:
            heapq.heappush(heap, (-have, y, x))
            continue
        tile[y, x] = settle(x, y)
        todo.discard((x, y))
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            u, v = x + dx, y + dy
            if (u, v) in todo:
                heapq.heappush(heap, (-settled_round(u, v), v, u))
    # What greed painted itself into: another look at any cell beside a pair no map has.
    repair(plane, pairs, tile, tset, blank, grid, family, sea, W, H, score, choices, ts_of, cover, default)
    plane.seams_left = seams(pairs, tile, tset, blank, W, H)
    palette = {}
    def sym(entry):
        return palette.setdefault(entry, len(palette))
    sym(('sea',))
    out = np.zeros((H, W), dtype=int)
    for y in range(H):
        for x in range(W):
            if not blank[y, x]:
                out[y, x] = -1
            elif tile[y, x] != SEA and not (x in (0, W - 1) or y in (0, H - 1)):
                a = int(tile[y, x])
                ref = ts_of.get((x, y), default) if a >= 512 else None
                # A forest's inside is one symbol, so a chunk of it is a pattern and never cut.
                out[y, x] = sym(('block',) + forest_blocks[(x, y)]) if (x, y) in forest_blocks else sym(('block', ref, a, a, a, a))
    return out, palette


def repair(plane, pairs, tile, tset, blank, grid, family, sea, W, H, score, choices, ts_of, cover, default):
    cells = sorted((int(x), int(y)) for y, x in zip(*np.nonzero(blank & ~sea & (family < 0) & (grid != TREE))))
    for _ in range(6):
        changed = 0
        for x, y in cells:
            i = ts_of.get((x, y), default)
            t = pairs.key(i)
            f = int(family[y, x])
            a = tile[y, x]
            if score(x, y, t, a, f) > 4 * math.log(1 + UNSEEN) - 0.01 and not unseen_at(pairs, tile, tset, x, y, W, H):
                continue
            best = max((score(x, y, t, c, f), c) for c in choices(int(grid[y, x]), f, i))
            if best[1] != a and best[0] > score(x, y, t, a, f):
                tile[y, x] = best[1]
                changed += 1
        if not changed:
            break


# Round a cell, with what agreeing on each is worth: the sides tell the most, and two cells off
# keep a long terrace going.
ROUND = [(-1, 0, 4), (0, -1, 4), (1, 0, 4), (0, 1, 4), (-1, -1, 2), (1, -1, 2), (-1, 1, 2), (1, 1, 2), (-2, 0, 1), (0, -2, 1), (2, 0, 1), (0, 2, 1)]
# What isn't this rock, as it matters to a cliff's foot.
EDGE_WEIGHT = 3
ANY_ROCK = -9
NOT_ROCK = {WATER: -2, SAND: -3, GRASS: -4, TREE: -4, ROCK: -4}


def draw_range(plane, pairs, sources, calm, n, tile, family, blank, grid, x0, y0, W, H):
    """A range's cells, a row at a time, each copied from somewhere on the real maps whose rock it is,
    a place with the same neighbours: its pieces, in their order, ending as that rock ends, on what
    it ends on."""
    faces = pairs.faces[n]
    around, pick = [], []
    for i, r in sources:
        m = plane.maps[i]
        w, h = m['w'], m['h']
        src = np.array([plane.blocks[i][y * w + x] & 0x3ff for y in range(h) for x in range(w)]).reshape(h, w)
        rock = np.isin(src, list(faces))
        cls = np.zeros((h, w), dtype=int)
        for y in range(h):
            for x in range(w):
                cls[y, x] = src[y, x] if rock[y, x] else NOT_ROCK[plane.kind(i, int(src[y, x]))]
        pad = np.pad(cls, 2, constant_values=NOT_ROCK[GRASS])
        inside = np.zeros((h, w), dtype=bool)
        inside[r[1]:r[1] + r[3], r[0]:r[0] + r[2]] = True
        ys, xs = np.nonzero(rock & inside)
        around.append(np.array([pad[ys + 2 + dy, xs + 2 + dx] for dx, dy, _ in ROUND]))
        pick.append(src[ys, xs])
    around = np.concatenate(around, axis=1)
    pick = np.concatenate(pick)
    calm, flats, run, drop = calm
    is_flat = np.isin(pick, list(flats))
    def known(x, y):
        got = []
        for k, (dx, dy, wt) in enumerate(ROUND):
            u, v = x + dx, y + dy
            if not (0 <= u < W and 0 <= v < H):
                got.append((k, NOT_ROCK[WATER], wt))
            elif family[v, u] == n:
                got.append((k, int(tile[v, u]) if tile[v, u] >= 0 else ANY_ROCK, wt))
            elif not blank[v, u] and int(tile[v, u]) in faces:
                got.append((k, int(tile[v, u]), wt))
            else:
                got.append((k, NOT_ROCK[int(grid[v, u])], wt))
        return tuple(got)
    cache = {}
    def stripe(x, y):
        if run is None:
            return False
        return all(x - k >= 0 and family[y, x - k] == n and tile[y, x - k] >= 0 and int(tile[y, x - k]) not in flats for k in range(1, run + 1))
    def too_long(x, y):
        # A cliff no longer than a real one: by neighbours alone a face follows the last for ever.
        return drop is not None and all(y - k >= 0 and family[y - k, x] == n and tile[y - k, x] >= 0 and int(tile[y - k, x]) not in flats for k in range(1, drop + 1))
    def draw(x, y):
        key = known(x, y)
        best = cache.get(key)
        if best is None:
            sc = np.zeros(len(pick), dtype=int)
            for k, val, wt in key:
                if val == ANY_ROCK:
                    sc += (around[k] >= 0) * wt * EDGE_WEIGHT
                elif val < 0:
                    sc += (around[k] == val) * wt * EDGE_WEIGHT
                else:
                    # This rock at all, on a side that has it, then this piece.
                    sc += (around[k] == val) * wt + (around[k] >= 0) * wt
            top = np.nonzero(sc == sc.max())[0]
            flat = top[is_flat[top]]
            best = (top, flat)
            cache[key] = best
        top, flat = best
        # A cell at the rock's edge is what the real rock has there: a foot, a rim. Inside, patches of
        # quiet rock among the faces: a field over the range, not a per-cell coin.
        inside = not any(val < 0 and val != ANY_ROCK for _, val, _ in key)
        if inside and (too_long(x, y) or (len(flat) and (hash_noise(x + x0 + 13, y + y0 - 29, 9) < calm or stripe(x, y)))):
            if len(flat):
                top = flat
            else:
                return min(flats)
        r = (hash_noise(x + x0, y + y0, 1) * 7919.0 + hash_noise(y + y0 + 91, x + x0 + 17, 1) * 104729.0) % 1
        return int(pick[top[int(r * len(top))]])
    cells = [(int(x), int(y)) for y, x in zip(*np.nonzero(family == n))]
    for x, y in sorted(cells, key=lambda c: (c[1], c[0])):
        tile[y, x] = draw(x, y)
    # Now with everything round them known, for what a row couldn't know of the real map below it.
    for _ in range(2):
        for x, y in sorted(cells, key=lambda c: (-c[1], c[0])):
            tile[y, x] = draw(x, y)
    # General's flat rock never just stops: where it meets anything else it has the rim or the
    # front-facing foot a real map has there (Cam, 11-04: "This should be front facing"), whatever
    # the texture said.
    if n >= len(MOUNTAINS):
        def rock(u, v):
            return not (0 <= u < W and 0 <= v < H) or family[v, u] == n or (not blank[v, u] and grid[v, u] == ROCK)
        def beside(u, v):
            g = int(grid[v, u]) if 0 <= u < W and 0 <= v < H else WATER
            return g if g in EDGES else GRASS
        rims = []
        for x, y in cells:
            # Over water, any piece: it stands on its foot.
            if y + 1 < H and grid[y + 1, x] == WATER and rock(x - 1, y) and rock(x + 1, y):
                rims.append((x, y, EDGES[WATER]['b']))
                continue
            if int(tile[y, x]) != ROCK_BODY:
                continue
            up, down, left, right = rock(x, y - 1), rock(x, y + 1), rock(x - 1, y), rock(x + 1, y)
            if up and down and left and right:
                continue
            side = 'b' if not down else 't' if not up else ''
            side += 'l' if not left else 'r' if not right else ''
            other = (x, y + 1) if not down else (x, y - 1) if not up else (x - 1, y) if not left else (x + 1, y)
            rims.append((x, y, EDGES[beside(*other)][side]))
        for x, y, piece in rims:
            tile[y, x] = piece


def unseen_at(pairs, tile, tset, x, y, W, H):
    a, t = int(tile[y, x]), tset[(x, y)]
    for dx, dy, pp, first in ((1, 0, pairs.h, True), (-1, 0, pairs.h, False), (0, 1, pairs.v, True), (0, -1, pairs.v, False)):
        u, v = x + dx, y + dy
        if 0 <= u < W and 0 <= v < H and tile[v, u] >= 0:
            tb = tset.get((u, v), t)
            if not (pairs.seen(pp, t, a, tb, int(tile[v, u])) if first else pairs.seen(pp, tb, int(tile[v, u]), t, a)):
                return True
    return False


def seams(pairs, tile, tset, blank, W, H):
    """The pairs of cells, one or both of them the fill's, that no real map has side by side."""
    bad = []
    for y in range(H):
        for x in range(W):
            for dx, dy, pp in ((1, 0, pairs.h), (0, 1, pairs.v)):
                u, v = x + dx, y + dy
                if u < W and v < H and (blank[y, x] or blank[v, u]) and tile[y, x] != SEA and tile[v, u] != SEA:
                    if not pairs.seen(pp, tset.get((x, y)), int(tile[y, x]), tset.get((u, v)), int(tile[v, u])):
                        bad.append((x, y, u, v))
    return bad


def generate():
    plane = Plane()
    x0, y0 = plane.x0 - MARGIN, plane.y0 - MARGIN
    W, H = plane.x1 - plane.x0 + 2 * MARGIN, plane.y1 - plane.y0 + 2 * MARGIN
    owner = np.full((H, W), -1, dtype=int)
    kind = np.full((H, W), -1, dtype=int)
    stands = np.zeros((H, W), dtype=bool)
    ids = list(plane.at)
    for n, i in enumerate(ids):
        gx, gy = plane.at[i]
        m = plane.maps[i]
        for y in range(m['h']):
            for x in range(m['w']):
                owner[gy + y - y0, gx + x - x0] = n
                kind[gy + y - y0, gx + x - x0] = plane.cell_kind(i, x, y)
                stands[gy + y - y0, gx + x - x0] = plane.classes(i)[y * m['w'] + x] not in (CLASS_WALL, CLASS_WATER)
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
                nd = d + 0.25 + 1.5 * noise(u + x0, v + y0)
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
    near = stands.copy()
    for _ in range(WALK_GAP):
        grown = near.copy()
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                grown |= np.roll(np.roll(near, dy, 0), dx, 1)
        near = grown
    cover = {}
    for y in range(H):
        for x in range(W):
            if not (blank[y, x] and land[y, x]):
                continue
            i, mid, k, _ = source.get((x, y), ('MAP_LITTLEROOT_TOWN', 0x1D4, TREE, 0))
            if k == SAND and dland[y, x] > 3:
                k = TREE
            if k == GRASS:
                k = TREE
            # A map's edge of rock doesn't carry on as a block ruled off by the next map's edge: it
            # comes down into the forest, however far this bit of it goes.
            if k == ROCK and i in TAPERS and dland[y, x] > 3 + 13 * hash_noise(x + x0 + 71, y + y0 + 13, 9):
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
                if near[y, x] and k != SAND:
                    k = TREE
            grid[y, x] = k
            cover[(x, y)] = (i, mid, k)
    # A ridge is as thick as a cliff's faces and foot need, RIDGE across, or it is trees: a strip of
    # faces is nothing a real mountain has. (A house on a map's edge has a cliff's colours: its
    # "ridge" is a sliver, and goes.)
    solid = grid == ROCK
    square = np.ones((H, W), dtype=bool)
    for dy in range(-RIDGE, RIDGE + 1):
        for dx in range(-RIDGE, RIDGE + 1):
            square &= np.roll(np.roll(solid, dy, 0), dx, 1)
    kept = square.copy()
    for dy in range(-RIDGE, RIDGE + 1):
        for dx in range(-RIDGE, RIDGE + 1):
            kept |= np.roll(np.roll(square, dy, 0), dx, 1)
    grid[blank & (grid == ROCK) & ~kept] = TREE
    # Grass round a ridge, where trees would run straight into its foot, away from anybody.
    near_rock = grid == ROCK
    grown = near_rock.copy()
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            grown |= np.roll(np.roll(near_rock, dy, 0), dx, 1)
    grid[blank & grown & ~near & (grid == TREE)] = GRASS

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

    # The ranges, over what the land was going to be.
    family = np.full((H, W), -1, dtype=int)
    plain = len(MOUNTAINS)
    for n, poly in [(plain, q) for q in MASSIFS] + [(n, m[3]) for n, m in enumerate(MOUNTAINS)]:
        cells = [((px >> 4) - 136 - x0, (py >> 4) - 298 - y0) for px, py in poly]
        for y, x in zip(*np.nonzero(blank & land & (grid != WATER) & (dcoast > BEACH))):
            # An outline a ruler didn't draw.
            wx, wy = x + RAGGED * (2 * noise(x + x0 + 311, y + y0 - 77) - 1), y + RAGGED * (2 * noise(x + x0 - 53, y + y0 + 149) - 1)
            inside = False
            for (ax, ay), (bx, by) in zip(cells, cells[1:] + cells[:1]):
                if (ay <= wy) != (by <= wy) and wx < ax + (wy - ay) * (bx - ax) / (by - ay):
                    inside = not inside
            if inside:
                family[y, x] = n
                grid[y, x] = ROCK
    # Rock anywhere else: the plain range. (A house's walls on a map's edge are no rock to carry on.)
    family[blank & (grid == ROCK) & (family < 0)] = plain
    ts_of = {}
    for (x, y), (i, _, _) in cover.items():
        ts_of[(x, y)] = i
    for (x, y) in zip(*np.nonzero(family >= 0)[::-1]):
        ts_of[(int(x), int(y))] = RANGES[family[y, x]][0]
    out, palette = solve(plane, ids, owner, x0, y0, W, H, blank, grid, family, ts_of, cover, near)
    return plane, x0, y0, W, H, out, palette, None


def lay_paint(plane, x0, y0, W, H, out, palette):
    """Cam's hand over the solver's: nothing here looks at what's next to it. A cell the maps have
    since grown over, or a map that has gone, stops the build rather than draw the wrong thing."""
    if not os.path.exists(PAINT):
        return 0
    doc = json.load(open(PAINT, encoding='utf-8'))
    bad = []
    for x, y, r, mid in doc['cells']:
        ref = doc['refs'][r] if r >= 0 else None
        cx, cy = x - x0, y - y0
        if not (0 <= cx < W and 0 <= cy < H) or out[cy, cx] < 0 or (ref is not None and ref not in plane.at):
            bad.append((x, y, ref, mid))
            continue
        entry = ('sea',) if mid == SEA and ref is None else ('block', ref, mid, mid, mid, mid)
        out[cy, cx] = palette.setdefault(entry, len(palette))
    if bad:
        sys.exit(f'map-paint.json: {len(bad)} cells are on a real map or off the file, first {bad[:5]}')
    return len(doc['cells'])


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
    painted = lay_paint(plane, x0, y0, W, H, out, palette)
    entries = sorted(palette, key=palette.get)
    doc = {'x0': x0, 'y0': y0, 'w': W, 'h': H, 'blocks': [list(e[1:]) if e[0] == 'block' else [] for e in entries], 'rows': rle((out.clip(min=0)).reshape(-1).tolist())}
    json.dump(doc, open(OUT, 'w', encoding='utf-8'), separators=(',', ':'))
    print('wrote', OUT, os.path.getsize(OUT), 'bytes;', len(entries), 'blocks;', W, 'x', H, 'cells;', len(plane.seams_left), 'unseen pairs;', painted, 'painted')
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
