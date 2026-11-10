#!/usr/bin/env python3
"""Checker for fog-friendship-zubat.txt and fog-beauty-feebas.txt (BR_DRIVER names which).

Reads the driver's log on stdin: each `say stage N ...` is followed by a `dump` of the
first party mon (100 bytes). Friendship and beauty are in the encrypted half of a
Pokemon, so this decrypts it: key = personality ^ otId over the 48 bytes at +0x20,
substructures in the order personality % 24 names (G growth, A attacks, E EVs/condition,
M misc). Growth holds friendship at +9; condition holds beauty at +7.
"""
import os
import re
import struct
import sys
from itertools import permutations

ORDERS = list(permutations("GAEM"))  # 24, GAEM first: the order gPokemonSubstructOrder walks


def decrypt(raw):
    pid, otid = struct.unpack_from("<II", raw, 0)
    key = pid ^ otid
    words = [w ^ key for w in struct.unpack_from("<12I", raw, 0x20)]
    sec = struct.pack("<12I", *words)
    order = ORDERS[pid % 24]
    sub = {c: sec[i * 12:(i + 1) * 12] for i, c in enumerate(order)}
    return {"friendship": sub["G"][9], "beauty": sub["E"][7]}


def stages(text):
    out = {}
    cur = None
    buf = []
    for line in text.splitlines():
        m = re.match(r"stage (\d+)", line)
        if m:
            cur = int(m.group(1))
            buf = []
            continue
        if cur is not None and re.match(r"^\s+([0-9a-f]{2} ?)+$", line):
            buf += [int(x, 16) for x in line.split()]
            if len(buf) >= 100:
                out[cur] = decrypt(bytes(buf[:100]))
                cur = None
    return out


def main():
    name = os.environ.get("BR_DRIVER", "")
    got = stages(sys.stdin.read())
    if "feebas" in name:
        want = {5: ("beauty", 0), 0: ("beauty", 0), 1: ("beauty", 60), 2: ("beauty", 120), 3: ("beauty", 180)}
    else:
        want = {5: ("friendship", 70), 0: ("friendship", 70), 1: ("friendship", 120), 2: ("friendship", 170),
                3: ("friendship", 220), 4: ("friendship", 255)}
    bad = 0
    for st, (field, v) in sorted(want.items()):
        have = got.get(st)
        ok = have is not None and have[field] == v
        print("%s stage %d %s %s (want %d)" % ("ok  " if ok else "FAIL", st, field,
              "missing" if have is None else have[field], v))
        bad += not ok
    sys.exit(1 if bad else 0)


main()
