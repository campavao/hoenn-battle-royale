#!/usr/bin/env python3
"""Check a SHUFFLE transition's per-line BG1..3VOFS against the camera (POK-329).

    bash tools/br/drive.sh shuffle-vofs | python3 tools/br/shuffle-vofs.py

The ring's BGs are 512 rows (include/br/br_field.h), so VOFS is 9 bits. HBlankCB_Shuffle
writes gScanlineEffectRegBuffers[1][line] into BG1..3VOFS on every line, and
Shuffle_Init seeds that buffer with the camera's scroll before Shuffle_End's first DMA
replaces it with the camera plus a sine wobble (src/battle_transition.c).

The driver dumps gSpriteCoordOffsetY at rest before the fight (the camera's negation,
field_camera.c's UpdateCameraPanning), puts a sentinel in the buffer's first and last
lines, then watches gMain.callback2 and the whole buffer (160 lines) every frame through
the transition:

  * the first frame the buffer is not the sentinel is the Init's fill, and every line
    is the camera, in the nine bits VOFS reads;
  * every frame after it on the same callback2 (the transition runs under
    CB2_OverworldBasic; the battle's screens use the buffer for their own ends), every
    line is within MAX_WOBBLE of the camera: Shuffle_End's Sin amplitude grows 384/256
    a frame over the ~80-frame fade.

Exits 1 on any failure, 2 when the run did not exercise it: no fill seen, fewer than
two transition frames on the field, or a camera whose bit 8 a byte fill would get right.
"""
import re
import sys

SENTINEL = 0x5A5A
LINES = 160
MAX_WOBBLE = 128
MASK = 0x1FF


def parse(stream):
    """`say` words label what follows; `frame n` opens a watched frame whose dumps are,
    in order, gMain.callback2 (4 bytes) and the buffer (320)."""
    rest = []
    frames = []
    label = None
    cur = None
    buf = None
    for line in stream:
        if line.startswith("  ") and buf is not None:
            buf.extend(int(b, 16) for b in line.split())
            continue
        buf = None
        s = line.strip()
        if line.startswith("frame "):
            cur = {"n": int(line.split()[1]), "dumps": []}
            frames.append(cur)
            continue
        if re.match(r"^dump 0x[0-9A-Fa-f]{8}:", s):
            buf = bytearray()
            if cur is not None:
                cur["dumps"].append(buf)
            elif label == "rest":
                rest.append(buf)
            continue
        if re.match(r"^[a-z][\w-]*$", s):
            label = s
            cur = None
    return rest, frames


def main():
    rest, frames = parse(sys.stdin)
    if not rest:
        print("shuffle-vofs: no `rest` dump of gSpriteCoordOffsetY")
        sys.exit(2)
    offset_y = int.from_bytes(rest[0][:2], "little")
    camera = (-offset_y) & 0xFFFF
    byte_fill = ((camera & 0xFF) * 0x101) & MASK
    print(f"camera 0x{camera:04X} (VOFS 0x{camera & MASK:03X}); a byte fill would read 0x{byte_fill:03X}")
    if byte_fill == camera & MASK:
        print("shuffle-vofs: a byte fill gets this camera right; the run proves nothing")
        sys.exit(2)

    bad = 0
    seen_fill = None
    fill_cb2 = None
    after = 0
    for f in frames:
        if len(f["dumps"]) < 2 or len(f["dumps"][1]) < LINES * 2:
            print(f"frame {f['n']}: expected callback2 and a {LINES * 2}-byte buffer")
            sys.exit(1)
        cb2 = int.from_bytes(f["dumps"][0][:4], "little")
        if seen_fill is not None and cb2 != fill_cb2:
            break  # the battle's own screens use the buffer from here
        b = f["dumps"][1]
        lines = [b[2 * i] | b[2 * i + 1] << 8 for i in range(LINES)]
        if seen_fill is None:
            if lines[0] == SENTINEL and lines[-1] == SENTINEL:
                continue
            seen_fill = f["n"]
            fill_cb2 = cb2
            wrong = [i for i, v in enumerate(lines) if v & MASK != camera & MASK]
            if wrong:
                i = wrong[0]
                bad += 1
                print(f"frame {f['n']}: the Init's fill has {len(wrong)} lines off the camera: line {i} "
                      f"is 0x{lines[i]:04X} (VOFS 0x{lines[i] & MASK:03X}), the camera 0x{camera & MASK:03X}")
            else:
                print(f"frame {f['n']}: the Init's fill is the camera on all {LINES} lines")
            continue
        after += 1
        for i, v in enumerate(lines):
            d = ((v - camera + 256) & MASK) - 256
            if abs(d) > MAX_WOBBLE:
                bad += 1
                print(f"frame {f['n']}: line {i} is 0x{v:04X} (VOFS 0x{v & MASK:03X}), {d} rows off the camera")
                break
    print(f"{len(frames)} frames watched, fill at frame {seen_fill}, {after} frames of the shuffle after it, "
          f"{bad} failures")
    if bad:
        sys.exit(1)
    if seen_fill is None or after < 1:
        sys.exit(2)


if __name__ == "__main__":
    main()
