#!/usr/bin/env python3
"""Adds a room painting (web/rooms/, the COPY or SHARE of /rooms/) to room-paint.json, which
floors.py lays over what it picks, then rewrites br_balls.c's sRooms, the one table the live
match and spike B both read, and remakes spike B's rooms.json.

    tools/br/apply-room-paint.py room-paint.json

A file of {"MAP_X": {"item": [x, y] or null, "person": [x, y]}}. A room with no item keeps its
old cell in the table, with its cache flag off. Then the usual: node tools/br/bundle-world.mjs,
and a ROM build, since the table is in the ROM."""
import json, subprocess, sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
PAINT = HERE / 'room-paint.json'


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    painted = json.loads(Path(sys.argv[1]).read_text())
    kept = json.loads(PAINT.read_text())
    kept.update(painted)
    rows = ['  %s: %s' % (json.dumps(k), json.dumps(kept[k])) for k in sorted(kept)]
    PAINT.write_bytes(('{
' + ',
'.join(rows) + '
}
').encode())
    subprocess.run([sys.executable, str(HERE / 'floors.py'), '--write'], check=True)
    subprocess.run([sys.executable, str(HERE / 'spike-rooms.py')], check=True)
    print(f'{len(painted)} rooms written; now bundle-world.mjs and a ROM build')


if __name__ == '__main__':
    main()
