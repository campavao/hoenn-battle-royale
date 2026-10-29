#!/usr/bin/env python3
"""Spike B's house and floor caches, from br_balls.c's sRooms (the live match's table,
made by floors.py): web/spike-b/data/rooms.json, one row a room with a cache --
[map, x, y, house]. `house` is a row before BR_HOUSES (a cache there is gold one time
in three, a floor's one in eight). room.test.ts checks the json still matches."""
import json, re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def rooms():
    src = (ROOT / 'src/br/br_balls.c').read_text()
    houses = int(re.search(r'#define BR_HOUSES (\d+)', src).group(1))
    body = src[src.index('static const struct BrRoom sRooms[] ='):]
    body = body[:body.index('};')]
    rows = re.findall(r'\{ (MAP_\w+), (\d+), (\d+), (\d+), (\d+), (TRUE|FALSE), (\w+) \}', body)
    return [[m, int(cx), int(cy), i < houses] for i, (m, cx, cy, _px, _py, cache, _t) in enumerate(rows) if cache == 'TRUE']


if __name__ == '__main__':
    out = ROOT / 'web/spike-b/data/rooms.json'
    text = json.dumps(rooms(), separators=(',', ':')) + '\n'
    if '--check' in sys.argv:
        sys.exit(0 if out.read_text() == text else 'rooms.json is stale: run tools/br/spike-rooms.py')
    out.write_text(text)
    print(f'wrote {out} ({len(rooms())} rooms)')
