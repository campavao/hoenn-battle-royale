#!/usr/bin/env python3
"""Checker for spike-fish-safari.txt.

Reads the driver's log on stdin: each `cast <kind> <n>` is followed by a `dump` of the
enemy battler (gBattleMons[1], 36 bytes; species at +0, types at +0x21 and +0x22). Every
cast, Safari or plain, must have hooked a WATER Pokemon (TYPE_WATER, 11), and all ten casts
must have happened.
"""
import re
import sys

TYPE_WATER = 11


def casts(text):
    out = []
    cur = None
    buf = []
    for line in text.splitlines():
        m = re.match(r"cast (\w+) (\d+)", line)
        if m:
            if cur is not None:
                out.append((cur, buf))
            cur, buf = m.group(1) + " " + m.group(2), []
            continue
        if cur is not None and re.match(r"^\s+([0-9a-f]{2} ?)+$", line):
            buf += [int(x, 16) for x in line.split()]
    if cur is not None:
        out.append((cur, buf))
    return out


def main():
    got = casts(sys.stdin.read())
    bad = 0
    for name, b in got:
        if len(b) < 0x23:
            print(f"{name}: no dump")
            bad += 1
            continue
        species = b[0] | b[1] << 8
        types = (b[0x21], b[0x22])
        ok = TYPE_WATER in types
        print(f"{name}: species {species} types {types[0]}/{types[1]} {'water' if ok else 'NOT WATER'}")
        bad += 0 if ok else 1
    if len(got) != 10:
        print(f"{len(got)} casts, want 10")
        bad += 1
    print("fish water ok" if bad == 0 else f"fish water FAILED ({bad})")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
