#!/usr/bin/env python3
"""Writes a room painting (web/rooms/, the COPY or SHARE of /rooms/) into br_balls.c's sRooms,
the one table the live match and spike B both read, then remakes spike B's rooms.json.

    tools/br/apply-room-paint.py room-paint.json

A file of {"MAP_X": {"item": [x, y] or null, "person": [x, y]}}. A room with no item keeps its
old cell in the table, with its cache flag off. Then the usual: node tools/br/bundle-world.mjs,
and a ROM build, since the table is in the ROM."""
import json, re, subprocess, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / 'src/br/br_balls.c'


def apply(src, painted):
    start = src.index('static const struct BrRoom sRooms[] =')
    end = src.index('};', start)
    body = src[start:end]
    missing = set(painted)

    def row(m):
        name, cx, cy, px, py, cache, trader = m.groups()
        if name not in painted:
            return m.group(0)
        missing.discard(name)
        p = painted[name]
        item = p['item']
        cx, cy = (item if item else (cx, cy))
        return '{ %s, %s, %s, %d, %d, %s, %s }' % (name, cx, cy, p['person'][0], p['person'][1], 'TRUE' if item else 'FALSE', trader)

    body = re.sub(r'\{ (MAP_\w+), (\d+), (\d+), (\d+), (\d+), (TRUE|FALSE), (\w+) \}', row, body)
    if missing:
        sys.exit('not rooms in the table: ' + ', '.join(sorted(missing)))
    return src[:start] + body + src[end:]


if __name__ == '__main__':
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    painted = json.loads(Path(sys.argv[1]).read_text())
    raw = SRC.read_bytes().decode()
    SRC.write_bytes(apply(raw, painted).encode())
    subprocess.run([sys.executable, str(ROOT / 'tools/br/spike-rooms.py')], check=True)
    print(f'{len(painted)} rooms written; now bundle-world.mjs and a ROM build')
