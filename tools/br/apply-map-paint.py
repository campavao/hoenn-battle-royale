#!/usr/bin/env python3
"""Lays a map painting (COPY LINK or SAVE FILE at /map/) into map-paint.json, which export-fill.py
puts over its cells, then remakes web/spike-b/data/world-fill.json.

    python tools/br/apply-map-paint.py <link, or a file holding a link or the JSON>

Cells are added to what's there, and a new one wins. Only the page reads the fill, so no ROM
build and no bundle-world: a release of the site carries it. To take paint back out, delete its
cells from map-paint.json and run export-fill.py."""
import base64
import json
import os
import re
import subprocess
import sys
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
PAINT = os.path.join(HERE, 'map-paint.json')


def read(arg):
    """The painting a link or a file says, as map-paint.json has it."""
    text = open(arg, encoding='utf-8').read() if os.path.exists(arg) else arg
    m = re.search(r'#([pj])=([\w-]+)', text)
    if not m:
        return json.loads(text)
    raw = base64.urlsafe_b64decode(m.group(2) + '=' * (-len(m.group(2)) % 4))
    return json.loads(zlib.decompress(raw, -15) if m.group(1) == 'p' else raw)


def merge(kept, new):
    """Both files' cells, the new one's over the old's, in the page's order."""
    cells = {}
    for doc in (kept, new):
        for x, y, r, mid in doc['cells']:
            cells[(y, x)] = (doc['refs'][r] if r >= 0 else None, mid)
    refs = sorted({c[0] for c in cells.values() if c[0]})
    return {'v': 1, 'refs': refs, 'cells': [[x, y, refs.index(c[0]) if c[0] else -1, c[1]] for (y, x), c in sorted(cells.items())]}


def write(doc):
    """One cell a line, so a diff of the file says what changed."""
    rows = ',\n'.join('    ' + json.dumps(c, separators=(',', ':')) for c in doc['cells'])
    text = '{\n  "v": 1,\n  "refs": %s,\n  "cells": [\n%s\n  ]\n}\n' % (json.dumps(doc['refs']), rows)
    with open(PAINT, 'w', encoding='utf-8', newline='\n') as f:
        f.write(text)


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    new = read(sys.argv[1])
    had = os.path.exists(PAINT)
    kept = json.load(open(PAINT, encoding='utf-8')) if had else {'v': 1, 'refs': [], 'cells': []}
    doc = merge(kept, new)
    write(doc)
    # export-fill.py refuses a cell on a real map: then the file is as it was.
    if subprocess.run([sys.executable, os.path.join(HERE, 'export-fill.py')]).returncode:
        if had:
            write(kept)
        else:
            os.remove(PAINT)
        sys.exit('nothing laid')
    print(f"{len(new['cells'])} cells laid; map-paint.json has {len(doc['cells'])}")


if __name__ == '__main__':
    main()
