#!/usr/bin/env python3
"""Check tools/br/drivers/world-shown-crowd.txt: the grown object box on a crowded map.

    bash tools/br/drive.sh world-shown-crowd | python3 tools/br/world-shown-crowd.py

Reads gObjectEvents (16 x 0x24) at three points -- "base" (nothing shown past the sprite
window), "grown" and "again" (a portrait phone's rows shown, a step apart, back on the
same tile) -- and gMain.oamBuffer's first 64 entries at the last two. Asserts:

  * every map person who had an object in "base" still has one in "grown": the grown
    rows never take a near person's slot (2026-10-14 review of PR #29);
  * "grown" has more of the map's people than "base": the box did grow;
  * "grown" and "again" hold the same people: a step does not cull and respawn the far
    ones (the blink the review found);
  * the grown rows leave BR_NPC_HEADROOM + BR_GROW_SPARE - 1 slots past what BR holds:
    BR's own (seats 1-4, beside us) and the headroom come before a far berry tree, and
    the cull's BR_NPC_HEADROOM is never reached, so nothing blinks;
  * fewer than gOamLimit (64) OAM entries are used, there and at "busy" (twelve seats in
    view, the ring's fog up): no sprite is silently dropped.
"""
import re
import sys

OBJ_SIZE, OBJ_COUNT = 0x24, 16
OAM_LIMIT = 64
HEADROOM, GROW_SPARE = 3, 4
BR_LOCAL_BASE, PLAYER = 0xBC, 0xFF


def parse(text):
    dumps, name, cur = {}, None, None
    for line in text.splitlines():
        if line.startswith("dump 0x"):
            cur = bytearray()
            dumps.setdefault(name, []).append(cur)
        elif line.startswith("  ") and cur is not None:
            cur.extend(int(b, 16) for b in line.split())
        elif re.match(r"^[a-z][\w-]*$", line):
            name, cur = line, None
    return dumps


def people(objs):
    """(localId, mapNum, mapGroup) of the map's own active people, and the slots neither
    they nor BR hold."""
    out, room = set(), 0
    for i in range(OBJ_COUNT):
        o = objs[i * OBJ_SIZE:(i + 1) * OBJ_SIZE]
        active = o[0] & 1
        local = o[8]
        if not active:
            room += 1
        if active and local < BR_LOCAL_BASE:
            out.add((local, o[9], o[10]))
    return out, room


DUMMY = bytes([0xA0, 0x00, 0x30, 0x01, 0x00, 0x0C])  # sprite.c's gDummyOamData, attrs 0-2


def oam_used(oam):
    """Entries of the first gOamLimit that are not the dummy BuildOamBuffer fills the rest with."""
    return sum(1 for i in range(OAM_LIMIT) if bytes(oam[i * 8:i * 8 + 6]) != DUMMY)


def main():
    d = parse(sys.stdin.read())
    base, room0 = people(d["base"][0])
    grown, room1 = people(d["grown"][0])
    again, room2 = people(d["again"][0])
    oam1, oam2 = oam_used(d["grown"][-1]), oam_used(d["again"][-1])
    busy_people = sum(1 for i in range(OBJ_COUNT) if d["busy"][0][i * OBJ_SIZE] & 1)
    oam3 = oam_used(d["busy"][-1])
    print("base %d people, grown %d, again %d; free %d/%d/%d; OAM %d/%d of %d"
          % (len(base), len(grown), len(again), room0, room1, room2, oam1, oam2, OAM_LIMIT))
    print("busy: %d objects up, OAM %d of %d" % (busy_people, oam3, OAM_LIMIT))
    bad = []
    if not base:
        bad.append("no one in pret's box: the driver proves nothing")
    if base - grown:
        bad.append("near people lost their slot: %s" % sorted(base - grown))
    if len(grown) <= len(base):
        bad.append("the box did not grow")
    if grown != again:
        bad.append("a step changed who is up: %s" % sorted(grown ^ again))
    if min(room1, room2) < HEADROOM + GROW_SPARE - 1:
        bad.append("the grown rows ate into the headroom or BR's share: %d/%d free" % (room1, room2))
    if busy_people < 12:
        bad.append("busy has only %d objects up: it measures nothing" % busy_people)
    if max(oam1, oam2, oam3) >= OAM_LIMIT:
        bad.append("OAM full: sprites past %d are dropped" % OAM_LIMIT)
    for b in bad:
        print("FAIL world-shown-crowd: " + b)
    sys.exit(1 if bad else 0)


main()
