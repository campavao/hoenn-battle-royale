#!/usr/bin/env python3
"""Print how much EWRAM and IWRAM a build has left, and fail below a floor.

    python3 tools/br/ram-headroom.py pokeemerald.map [pokeemerald_modern.map ...] [--floor 128]

EWRAM is 256 KB and was down to its last 80 bytes before POK-330 #21 took the message
handler table back: every BR struct, the mailbox rings and the heap live there, and
features were being cut to fit. The linker only says so once a build is already over,
in the middle of whatever feature did it. This says so while there is still room to
choose -- every CI build prints the numbers, and one that drops under the floor fails
with them.

IWRAM is 32 KB, but the stack grows down from IWRAM_END - 0x1C0 (src/crt0.s's sp_sys)
into the same space, so its "free" is what the stack has, not spare room. It is printed
for that reason and held to the same floor.

Output is one Markdown line per map, so CI can append it to the step summary as is.
"""
import re
import sys

EWRAM_SIZE = 0x40000
IWRAM_SIZE = 0x8000
STACK_TOP = IWRAM_SIZE - 0x1C0  # sp_sys, as an offset into IWRAM

# The output section lines of a GNU ld map: "ewram           0x02000000    0x3ffb0"
SECTION = re.compile(r"^(ewram|iwram)\s+0x([0-9a-fA-F]+)\s+0x([0-9a-fA-F]+)\s*$")


def sections(path):
    found = {}
    with open(path, encoding="utf-8", errors="replace") as f:
        for line in f:
            m = SECTION.match(line)
            if m and m.group(1) not in found:
                found[m.group(1)] = int(m.group(3), 16)
    return found


def main(argv):
    floor = 128
    maps = []
    i = 0
    while i < len(argv):
        if argv[i] == "--floor":
            floor = int(argv[i + 1])
            i += 2
        else:
            maps.append(argv[i])
            i += 1
    if not maps:
        sys.exit(__doc__)

    ok = True
    for path in maps:
        s = sections(path)
        if "ewram" not in s or "iwram" not in s:
            print(f"- `{path}`: no ewram/iwram section in the map")
            ok = False
            continue
        ewram_free = EWRAM_SIZE - s["ewram"]
        iwram_free = IWRAM_SIZE - s["iwram"]
        stack = STACK_TOP - s["iwram"]
        low = [name for name, free in (("EWRAM", ewram_free), ("IWRAM", iwram_free)) if free < floor]
        mark = "**UNDER THE FLOOR**" if low else "ok"
        print(
            f"- `{path}`: EWRAM {ewram_free} B free ({s['ewram']:#x} of {EWRAM_SIZE:#x}); "
            f"IWRAM {iwram_free} B free ({s['iwram']:#x} of {IWRAM_SIZE:#x}, the stack gets {stack} B of it); "
            f"floor {floor} B: {mark}"
        )
        if low:
            ok = False
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
