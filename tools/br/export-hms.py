#!/usr/bin/env python3
"""Which species could learn each field HM, for the bots (#7, web/src/bots/brain.ts).

    python tools/br/export-hms.py   -> web/src/data/hms.json

Cam's 2026-10-19 play-test: SURF, FLY, CUT and STRENGTH need somebody in the party who
could learn the HM (br_hm.c, BrHm_Slot). A player's ROM asks pret's own learnsets
(src/data/pokemon/tmhm_learnsets.h); a bot is walked by the page, which asks these.

Each move is a hex string, a bit a species id, low bit first: bit n of the string's
byte n / 8 (two hex digits a byte).
"""
import json
import os
import re

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'web', 'src', 'data', 'hms.json')
MOVES = ['CUT', 'FLY', 'SURF', 'STRENGTH']


def main():
    ids = {}
    for m in re.finditer(r'#define\s+(SPECIES_\w+)\s+(\d+)\b', open(os.path.join(ROOT, 'include', 'constants', 'species.h')).read()):
        ids.setdefault(m.group(1), int(m.group(2)))
    src = open(os.path.join(ROOT, 'src', 'data', 'pokemon', 'tmhm_learnsets.h')).read()
    learns = {mv: set() for mv in MOVES}
    for m in re.finditer(r'\[(SPECIES_\w+)\]\s*=\s*\{\s*\.learnset\s*=\s*\{(.*?)\}\s*\}', src, re.S):
        sp = ids[m.group(1)]
        for mv in MOVES:
            if re.search(r'\.%s\s*=\s*TRUE' % mv, m.group(2)):
                learns[mv].add(sp)
    top = max(ids.values()) + 1
    out = {}
    for mv in MOVES:
        b = bytearray((top + 7) // 8)
        for sp in learns[mv]:
            b[sp // 8] |= 1 << (sp % 8)
        out[mv.lower()] = b.hex()
    with open(OUT, 'w', newline='\n') as f:
        json.dump(out, f, indent=1)
        f.write('\n')
    print(', '.join('%s %d' % (mv, len(learns[mv])) for mv in MOVES))


if __name__ == '__main__':
    main()
