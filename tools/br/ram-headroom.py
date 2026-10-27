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
for that reason and held to a floor of its own, STACK_FLOOR: on agbcc it was down to
796 B, and a deep frame (the sound mixer's VBlank on top of a battle) wrote over gBrTally,
the last thing in IWRAM -- the results said WON 769 and STEPS 30608 (2026-10-27).
BR_INTR_MAIN_WORDS gave it back IntrMain_Buffer's unused tail; the same run checks that
IntrMain, which is copied into that buffer, still fits it.

Output is one Markdown line per map, so CI can append it to the step summary as is.
"""
import re
import sys

EWRAM_SIZE = 0x40000
IWRAM_SIZE = 0x8000
STACK_TOP = IWRAM_SIZE - 0x1C0  # sp_sys, as an offset into IWRAM
# What the stack is held to. Retail Emerald left it about 1.4 KB; a short battle driver
# already reaches about 790 B down on agbcc.
STACK_FLOOR = 1536

# A symbol line: "                0x08000248                IntrMain", or agbcc's RAM
# symbols from sym_*.ld, "0x03002970   IntrMain_Buffer = .".
SYMBOL = re.compile(r"^\s+0x([0-9a-fA-F]{8,16})\s+([A-Za-z_]\w*)(?:\s*=\s*\.)?\s*$")

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


def symbols(path):
    out = {}
    with open(path, encoding="utf-8", errors="replace") as f:
        for line in f:
            m = SYMBOL.match(line)
            if m:
                out.setdefault(m.group(2), int(m.group(1), 16))
    return out


def intr_main_fit(path):
    """(IntrMain's size, IntrMain_Buffer's), both in bytes: the code runs from below the
    next symbol in the text (AgbMain, crt0.s then main.c), the buffer up to the next RAM
    symbol. None where the map does not say."""
    syms = symbols(path)
    if not all(k in syms for k in ("IntrMain", "AgbMain", "IntrMain_Buffer")):
        return None
    buf = syms["IntrMain_Buffer"]
    after = [a for a in syms.values() if buf < a < 0x03008000]
    if not after:
        return None
    return syms["AgbMain"] - syms["IntrMain"], min(after) - buf


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
        if stack < STACK_FLOOR:
            low.append(f"the stack ({STACK_FLOOR} B)")
        fit = intr_main_fit(path)
        if fit is None or fit[0] <= 0:
            low.append("IntrMain or IntrMain_Buffer not measurable in the map")
        elif fit[0] > fit[1]:
            low.append(f"IntrMain ({fit[0]:#x} B) past IntrMain_Buffer ({fit[1]:#x} B)")
        mark = "**UNDER THE FLOOR**" if low else "ok"
        print(
            f"- `{path}`: EWRAM {ewram_free} B free ({s['ewram']:#x} of {EWRAM_SIZE:#x}); "
            f"IWRAM {iwram_free} B free ({s['iwram']:#x} of {IWRAM_SIZE:#x}, the stack gets {stack} B of it); "
            f"floor {floor} B: {mark}{' (' + ', '.join(low) + ')' if low else ''}"
        )
        if low:
            ok = False
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
