#!/usr/bin/env python3
"""Spike B's hidden items: every map's hidden_item bg event (pret's data/maps), on the
maps spike B's world has, as web/spike-b/data/hidden.json -- [map, x, y, item id]. In a
match they stay buried and every trainer starts with an ITEMFINDER (br_levels.c); each
trainer can dig each one up once, as each ROM's own flag allows."""
import glob, json, re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def main():
    # items.h is one enum from ITEM_NONE (0), in order.
    src = (ROOT / 'include/constants/items.h').read_text()
    body = src[src.index('ITEM_NONE'):]
    body = body[:body.index('}')]
    names = re.findall(r'^\s*(ITEM_\w+)\s*,', re.sub(r'//[^\n]*', '', body), re.M)
    ids = {n: i for i, n in enumerate(names)}
    assert ids['ITEM_TM01'] == 289, ids['ITEM_TM01']
    world = {m['id'] for m in json.loads((ROOT / 'web/spike-b/data/world.json').read_text())['maps']}
    rows = []
    for f in sorted(glob.glob(str(ROOT / 'data/maps/*/map.json'))):
        d = json.loads(Path(f).read_text())
        if d['id'] not in world:
            continue
        for e in d.get('bg_events', []):
            if e.get('type') == 'hidden_item' and e['item'] in ids:
                rows.append([d['id'], e['x'], e['y'], ids[e['item']]])
    out = ROOT / 'web/spike-b/data/hidden.json'
    out.write_text(json.dumps(rows, separators=(',', ':')) + '\n')
    print(f'wrote {out} ({len(rows)} hidden items)')


if __name__ == '__main__':
    main()
