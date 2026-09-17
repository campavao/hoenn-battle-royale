#!/usr/bin/env python3
"""Hoenn's own trainers, map by map, for the fog to clear (POK-299).

    python tools/br/export-trainers.py > web/src/data/trainers.json

An object event is a trainer when the script it runs starts a `trainerbattle` -- read
off the map's own scripts.inc, from the object's label to the next label. That is the
same thing the ROM does when you press A on them, so gym leaders, route trainers and
the ones lying in the grass all count; a scripted rival fight in a cutscene does not,
because the rival is not an object event that carries it.

The output is { "MAP_ID": [localId, ...] } -- a local id is the object's place in the
list from 1, exactly what NPCOUT names. Kanto's equivalent is the `trainerClass` flag
its data carries on every map object.
"""
import json
import os
import re
import sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..')
MAPS = os.path.join(ROOT, 'data', 'maps')


def scripts_with_battles(inc_path):
    """The set of script labels in this file whose body starts a trainer battle."""
    if not os.path.exists(inc_path):
        return set()
    out, label = set(), None
    for line in open(inc_path, encoding='utf-8'):
        m = re.match(r'^(\w+)::?\s*$', line)
        if m:
            label = m.group(1)
            continue
        if label and re.match(r'^\s*trainerbattle', line):
            out.add(label)
    return out


def main():
    result = {}
    for d in sorted(os.listdir(MAPS)):
        mp = os.path.join(MAPS, d, 'map.json')
        if not os.path.exists(mp):
            continue
        m = json.load(open(mp, encoding='utf-8'))
        fighters = scripts_with_battles(os.path.join(MAPS, d, 'scripts.inc'))
        ids = [i + 1 for i, o in enumerate(m.get('object_events', [])) if o.get('script') in fighters]
        if ids:
            result[m['id']] = ids
    json.dump(result, sys.stdout, indent=1, sort_keys=True)
    sys.stdout.write('\n')
    total = sum(len(v) for v in result.values())
    print(f'{total} trainers on {len(result)} maps', file=sys.stderr)


if __name__ == '__main__':
    main()
