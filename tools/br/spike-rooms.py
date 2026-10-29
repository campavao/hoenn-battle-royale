#!/usr/bin/env python3
"""Spike B's houses and floors, from br_balls.c's sRooms (the live match's table, made by
floors.py): web/spike-b/data/rooms.json, one row a room -- [map, cacheX, cacheY, house,
cache, personX, personY, trader]. `house` is a row before BR_HOUSES (a cache there is
gold one time in three, a floor's one in eight, and one house in eight has somebody
home); `trader` a floor with somebody who trades. room.test.ts checks it still matches."""
import json, re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def rooms():
    src = (ROOT / 'src/br/br_balls.c').read_text()
    houses = int(re.search(r'#define BR_HOUSES (\d+)', src).group(1))
    body = src[src.index('static const struct BrRoom sRooms[] ='):]
    body = body[:body.index('};')]
    rows = re.findall(r'\{ (MAP_\w+), (\d+), (\d+), (\d+), (\d+), (TRUE|FALSE), (\w+) \}', body)
    return [[m, int(cx), int(cy), i < houses, cache == 'TRUE', int(px), int(py), t != 'BR_NO_TRADER']
            for i, (m, cx, cy, px, py, cache, t) in enumerate(rows)]


if __name__ == '__main__':
    out = ROOT / 'web/spike-b/data/rooms.json'
    text = json.dumps(rooms(), separators=(',', ':')) + '\n'
    if '--check' in sys.argv:
        sys.exit(0 if out.read_text() == text else 'rooms.json is stale: run tools/br/spike-rooms.py')
    out.write_text(text)
    print(f'wrote {out} ({len(rooms())} rooms)')
