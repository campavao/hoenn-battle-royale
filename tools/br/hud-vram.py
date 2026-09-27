#!/usr/bin/env python3
"""Check that BG0's shared tiles always show the window that owns them (POK-329).

    bash tools/br/drive.sh hud-vram | python3 tools/br/hud-vram.py

The HUD's corner, box and ticker live in tiles the start menu and the field's message
box also use (include/br/br_hud.h's tile map), and hand them over when one of those
comes up (BrHud_Yield, src/br/br_hud.c). The drivers that pipe into this watch every
frame through each window opening and closing over the HUD (`watch`, tools/br/README.md):
gMain.callback2 (4 bytes), gBrHud's first 16 bytes, BG0's tilemap in VRAM (0x0600F800),
the tiles 0x139..0x1FF in VRAM (0x0600A720), and every live BG0 window -- its template
and its pixel buffer. And the ring's three layers: BG1..3CNT (0x0400000A, 6 bytes), each
layer's tilemap in VRAM where BrField_InitRingBgs puts it (0x0600C800, 0x0600D800,
0x0600E800), and the field's three tilemap buffers, pointer (gOverworldTilemapBuffer_BgN,
4 bytes) and heap buffer (*gOverworldTilemapBuffer_BgN) both.

A frame's VRAM is what the frame before it queued: the harness stops at VBlank's start,
before the handler runs the DMA queue, so the tilemap and tiles dumped at frame f are
the buffers as they stood at frame f - 1. So for every overworld frame f whose frame
f - 1 was watched too:

  * no BG0 cell names a tile at or above 0x240, where BG2's tilemap starts (the HUD's own
    cells did, 0x23D..0x2FF, until this ticket);
  * BG1, BG2 and BG3 each show the field's own buffer: the tilemap at the screen block
    its BGxCNT names holds, at f, what the buffer held at f - 1. A text tile run past the
    ceiling lands in BG2's map and fails here, and so does a copy to a block the register
    does not name. Unless the main loop's pass was still running at f - 1: its buffers
    are half drawn there, and their copies are queued at the pass's end (the PC's
    turn-on flicker redraws the whole map five times, three frames a pass, in
    hud-vram-pc.txt). BrHud_Tick counts gBrHud.clockFrames once a pass, so a frame
    whose count is the one before's started no pass since, and is not compared;
  * every cell naming a tile in 0x139..0x1FF has an owner at f - 1: a live window whose
    rectangle holds the cell and maps it to that tile;
  * and the tile holds that owner's pixels: its 32 bytes are ones some owner's buffer
    held for that tile at a watched frame up to f - 1, since the window came to be.
    A window's cells showing another window's pixels -- the corner inside the start
    menu, a menu or the message box drawn over by the HUD -- fails here;
  * the corner, and the ticker when it has a line and nothing pauses it (a script, the
    start menu), are back -- first cell and every tile -- within two frames of the last
    window over them going: BrHud_Tick draws them the frame after.

Exits 1 on any failure, and 2 when no window ever covered a HUD window or no frame's
BG1..3 maps were compared with their buffers: a driver that never opens one over the HUD,
or never watches the ring, proves nothing.
"""
import json
import re
import sys

MAP_ADDR = 0x0600F800
TILES_ADDR = 0x06008000 + 0x139 * 32
FIRST, END = 0x139, 0x200
CEILING = 0x240
# BG1CNT, BG2CNT, BG3CNT; the field's buffer for each layer (symbols.py exports them).
BGCNT_ADDR = 0x0400000A
# A map load's tilemap copies wait in the DMA queue behind its tilesets (40 KB a VBlank),
# so for the first few overworld frames after one -- five on the warp in hud-vram.txt,
# under a fade still at full black, and the same in pret's layout -- VRAM's maps are
# still the load's cleared blocks. A layer may lag its buffer that long, and only until
# it first matches.
LOAD_LAG = 30
RING = {1: "gOverworldTilemapBuffer_Bg1", 2: "gOverworldTilemapBuffer_Bg2", 3: "gOverworldTilemapBuffer_Bg3"}
# The HUD's windows (br_hud.c's templates): (left, top, base) -> name.
HUD = {(20, 1, 0x139): "corner", (1, 11, 0x154): "box", (1, 17, 0x1C8): "ticker"}
START_MENU = (22, 1, 0x139)
MESSAGE_BOX = (2, 15, 0x194)
BACK_WITHIN = 2
# gBrHud: clockFrames at +0x04, shown +0x09, queueLen +0x0A, held +0x0C, scriptWas +0x0E
# (br_hud.h).
HUD_CLOCK, HUD_SHOWN, HUD_QUEUE, HUD_HELD, HUD_SCRIPT = 0x04, 0x09, 0x0A, 0x0C, 0x0E


class Win:
    __slots__ = ("slot", "bg", "left", "top", "w", "h", "pal", "base", "data")

    def __init__(self, fields, data):
        self.slot, self.bg, self.left, self.top, self.w, self.h, self.pal, self.base = fields
        self.data = data

    @property
    def key(self):
        return (self.slot, self.left, self.top, self.w, self.h, self.base)

    @property
    def hud(self):
        return HUD.get((self.left, self.top, self.base))

    def tile_at(self, x, y):
        if self.left <= x < self.left + self.w and self.top <= y < self.top + self.h:
            return self.base + (y - self.top) * self.w + (x - self.left)
        return None

    def shares(self, other):
        return self.base < other.base + other.w * other.h and other.base < self.base + self.w * self.h

    def extent(self):
        return (self.left - 1, self.top - 1, self.left + self.w, self.top + self.h)


def meet(a, b):
    return a[0] <= b[2] and b[0] <= a[2] and a[1] <= b[3] and b[1] <= a[3]


def sym(symbols, name):
    return int(symbols[name], 16) if symbols and name in symbols else None


def read(frame, addr, n):
    """n bytes at addr out of whichever of the frame's dumps holds them, or None."""
    for a, d in frame["at"].items():
        if a <= addr and addr + n <= a + len(d):
            return d[addr - a:addr - a + n]
    return None


def parse(stream):
    """`frame n` lines open a frame; the dumps and windows after it are its watches. A
    `say` line (a bare lowercase word) labels the frames after it, and closes the frame
    so a driver's own dump is not read as a watch. Every dump is kept by its address;
    gMain.callback2 and gBrHud are found by theirs (by their length, 4 and 16, when the
    run names no symbol table)."""
    frames = []
    symbols = None
    cur = None
    buf = None
    buf_addr = 0
    pending_win = None
    label = None
    for line in stream:
        if line.startswith("  ") and buf is not None:
            buf.append(line)
            continue
        if buf is not None:
            data = bytes.fromhex("".join(buf).replace("\n", " ").replace(" ", ""))
            if pending_win is not None:
                cur["windows"].append(Win(pending_win, data))
                pending_win = None
            else:
                cur["at"][buf_addr] = data
                if buf_addr == MAP_ADDR:
                    cur["map"] = [data[i] | data[i + 1] << 8 for i in range(0, len(data), 2)]
                elif buf_addr == TILES_ADDR:
                    cur["tiles"] = data
                elif symbols is not None:
                    if buf_addr == sym(symbols, "gMain") + 4:
                        cur["cb2"] = int.from_bytes(data, "little")
                    elif buf_addr == sym(symbols, "gBrHud"):
                        cur["hud"] = data
                elif len(data) == 4:
                    cur["cb2"] = int.from_bytes(data, "little")
                elif len(data) == 16:
                    cur["hud"] = data
            buf = None
        m = re.match(r"^symbols: \d+ from (.+)$", line.strip())
        if m:
            symbols = json.load(open(m.group(1), encoding="utf-8"))
            continue
        if line.startswith("frame "):
            cur = {"n": int(line.split()[1]), "windows": [], "at": {}, "label": label}
            frames.append(cur)
            continue
        if line.startswith("window ") and cur is not None:
            pending_win = tuple(int(v) for v in line.split()[1:9])
            continue
        m = re.match(r"^dump 0x([0-9A-Fa-f]{8}):", line)
        if m and cur is not None:
            buf = []
            buf_addr = int(m.group(1), 16)
            continue
        if re.match(r"^[a-z][\w-]*$", line.strip()):
            label = line.strip()
            cur = None
    return frames, symbols


def main():
    frames, symbols = parse(sys.stdin)
    if not frames:
        print("hud-vram: no watched frames in the input")
        sys.exit(1)
    cb2 = int(symbols["CB2_Overworld"], 16) + 1 if symbols else None
    history = {}   # window key -> {tile index -> set of 32-byte tiles}
    bad = 0
    checked = 0
    covered_frames = 0
    ring_checked = 0
    ring_mid_pass = 0
    ring_settled = set()   # layers that have matched their buffer since the field came back
    loaded_at = None       # the first overworld frame after a watched frame that was not
    due = {}       # "corner"/"ticker" -> the frame by which it must be back
    wanted = {}    # "corner"/"ticker" -> whether it should be up, last frame
    prev = None

    def fail(f, msg):
        nonlocal bad
        bad += 1
        if bad <= 40:
            print(f"frame {f['n']} ({f['label']}): {msg}")

    def check_ring(f, prev):
        # Each of BG1..3: the tilemap VRAM holds at the block its BGxCNT names (both as
        # frame f - 1 left them), against the field's buffer at f - 1. Right after a map
        # load a layer may lag its buffer while it has never matched it (see LOAD_LAG).
        nonlocal ring_checked, ring_mid_pass, loaded_at
        if prev.get("cb2") != f.get("cb2"):
            loaded_at = f["n"]
            ring_settled.clear()
        if prev.get("hud") is not None and f.get("hud") is not None                 and prev["hud"][HUD_CLOCK] == f["hud"][HUD_CLOCK]:
            ring_mid_pass += 1
            return
        cnt = read(f, BGCNT_ADDR, 6)
        if cnt is None or not all(sym(symbols, n) is not None for n in RING.values()):
            return
        for bg in (1, 2, 3):
            v = cnt[2 * (bg - 1)] | cnt[2 * (bg - 1) + 1] << 8
            base = 0x06000000 + ((v >> 8) & 0x1F) * 0x800
            size = 0x800 * (1, 2, 2, 4)[v >> 14]
            vram = read(f, base, size)
            if vram is None:
                fail(f, f"BG{bg}CNT is 0x{v:04X}, and its tilemap (0x{base:08X}, {size} bytes) is not watched")
                continue
            ptr = read(prev, sym(symbols, RING[bg]), 4)
            if ptr is None:
                fail(f, f"{RING[bg]} is not watched")
                continue
            heap = read(prev, int.from_bytes(ptr, "little"), size)
            if heap is None:
                fail(f, f"*{RING[bg]} (0x{int.from_bytes(ptr, 'little'):08X}, {size} bytes) is not watched")
                continue
            ring_checked += 1
            if vram == heap:
                ring_settled.add(bg)
                continue
            if bg not in ring_settled and loaded_at is not None and f["n"] - loaded_at < LOAD_LAG:
                continue
            ring_settled.add(bg)
            i = next(i for i in range(0, size, 2) if vram[i:i + 2] != heap[i:i + 2])
            cell = i // 2
            fail(f, f"BG{bg}'s tilemap at 0x{base:08X} is not its buffer at frame {prev['n']}: cell "
                    f"({cell % 32},{cell // 32}) is 0x{vram[i] | vram[i + 1] << 8:04X} in VRAM and "
                    f"0x{heap[i] | heap[i + 1] << 8:04X} in the buffer")

    def remember(f):
        # What each window's buffer held at frame f, for the frame after it to check
        # VRAM against; a window that is gone takes its history with it.
        for w in f["windows"]:
            h = history.setdefault(w.key, {})
            for i in range(w.w * w.h):
                h.setdefault(i, set()).add(w.data[i * 32:(i + 1) * 32])
        live = {w.key for w in f["windows"]}
        for k in list(history):
            if k not in live:
                del history[k]

    for f in frames:
        consecutive = prev is not None and prev["n"] == f["n"] - 1
        overworld = cb2 is None or f.get("cb2") == cb2
        if not consecutive or not overworld or "map" not in f or "tiles" not in f:
            remember(f)
            prev = f
            due.clear()
            wanted.clear()
            if not consecutive:
                loaded_at = None
                ring_settled.clear()
            continue
        checked += 1
        check_ring(f, prev)
        m = f["map"]
        before = prev["windows"]
        for y in range(32):
            for x in range(32):
                t = m[y * 32 + x] & 0x3FF
                if t >= CEILING:
                    fail(f, f"cell ({x},{y}) names tile 0x{t:03X}, at or above the ceiling 0x{CEILING:03X}")
                    continue
                if not FIRST <= t < END:
                    continue
                owners = [w for w in before if w.tile_at(x, y) == t]
                if not owners:
                    fail(f, f"cell ({x},{y}) names 0x{t:03X} and no window at frame {prev['n']} puts that tile there")
                    continue
                px = f["tiles"][(t - FIRST) * 32:(t - FIRST + 1) * 32]
                if not any(px in history.get(w.key, {}).get(t - w.base, ()) for w in owners):
                    names = ", ".join(f"slot {w.slot} base 0x{w.base:03X}" for w in owners)
                    fail(f, f"cell ({x},{y}) names 0x{t:03X} but the tile holds pixels its owner ({names}) never had")

        # Who is over a HUD window at frame f - 1, whose cells VRAM shows now. The field's
        # message box (window 0) lives all the time; it is over the HUD while it is up.
        huds = {w.hud: w for w in before if w.hud}
        box_up = m[MESSAGE_BOX[1] * 32 + MESSAGE_BOX[0]] & 0x3FF == MESSAGE_BOX[2]
        menu_up = any((w.left, w.top, w.base) == START_MENU for w in before)
        covered = set()
        for o in before:
            if o.hud or o.bg != 0 or (o.slot == 0 and not box_up):
                continue
            for name, hw in huds.items():
                if o.shares(hw) or meet(o.extent(), hw.extent()):
                    covered.add(name)
        covered_frames += bool(covered)

        # Back when nothing is over it any more (and, for the ticker, it has a line and
        # nothing pauses it): its first cell its own and its tiles its buffer's.
        hud = prev.get("hud")
        for name in ("corner", "ticker"):
            hw = huds.get(name)
            want = hw is not None and name not in covered
            if name == "ticker":
                want = want and hud is not None and hud[HUD_SCRIPT] == 0 and not menu_up and not box_up \
                    and (hud[HUD_QUEUE] > 0 or hud[HUD_HELD])
            if want and not wanted.get(name, True):
                due[name] = f["n"] + BACK_WITHIN
            wanted[name] = want
            if not want:
                due.pop(name, None)
                continue
            if name not in due:
                continue
            first = m[hw.top * 32 + hw.left] & 0x3FF == hw.base
            tiles = f["tiles"][(hw.base - FIRST) * 32:(hw.base - FIRST + hw.w * hw.h) * 32]
            if first and tiles == hw.data:
                del due[name]
            elif f["n"] >= due[name]:
                fail(f, f"the {name} is not back {BACK_WITHIN} frames after nothing was over it")
                del due[name]
        remember(f)
        prev = f
    print(f"{len(frames)} frames watched, {checked} checked, {covered_frames} with a window over the HUD, "
          f"{ring_checked} ring maps compared with their buffers ({ring_mid_pass} frames mid-pass not), "
          f"{bad} failures")
    if bad:
        sys.exit(1)
    if not covered_frames or not ring_checked:
        sys.exit(2)


if __name__ == "__main__":
    main()
