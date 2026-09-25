#ifndef GUARD_BR_WIRE_H
#define GUARD_BR_WIRE_H

// Message types on the mailbox rings. The page's web/src/net/slots.ts carries the
// same numbers (BR_MSG in that file); docs/WIRE.md is the table of record (POK-217).
// Keep them stable; add at the end; never reuse a retired number within a protocol
// version.
//
// Continuation scheme (slots.ts): a slot's payload is at most BR_SLOT_PAYLOAD_MAX
// (62) bytes. Every packed message -- even a one-slot one -- opens with a 3-byte
// header on its FIRST slot: totalLen (u16 LE, the packed message's own length before
// slot-splitting) then seq (u8, always 0 on the first slot). If totalLen fits in the
// first slot's remaining 59 bytes, that slot is the whole message. Otherwise the
// rest follows in CONTINUATION slots: type | BR_MSG_CONT (0x80), payload seq (u8: 1,
// 2, 3, ...) then up to 61 more bytes. A dropped or reordered slot must never
// silently reassemble into a different message -- the reader has to see the seq gap.
#define BR_MSG_CONT 0x80

#define BR_MSG_NONE 0
// page -> ROM: payload echoed back as BR_MSG_ECHO. The bridge's heartbeat and the
// harness's first test.
#define BR_MSG_ECHO 1

// ---- overworld --------------------------------------------------------------

// ROM <-> page, ~4x/second per seat: where a seat is and its status.
// Payload (11 bytes before framing):
//   0:    seat      u8   0..31
//   1:    hasMap    u8   0 = still in the lobby (fields 2..7 are 0 and unused)
//   2:    mapGroup  u8
//   3:    mapNum    u8
//   4..5: x         s16 LE
//   6..7: y         s16 LE
//   8:    facing    u8   DIR_SOUTH=1 DIR_NORTH=2 DIR_WEST=3 DIR_EAST=4
//   9:    status    u8   0=lobby 1=alive 2=battle 3=out
//   10:   spriteId  u8   0 = default skin
#define BR_MSG_PLACE 2

// ROM <-> page: a step just committed.
// Payload (8 bytes):
//   0:    seat  u8
//   1:    d     u8   DIR_SOUTH..DIR_EAST, as BR_MSG_PLACE
//   2..3: x     s16 LE
//   4..5: y     s16 LE
//   6:    mapGroup u8
//   7:    mapNum   u8
#define BR_MSG_STEP 3

// ROM <-> page: a turn in place.
// Payload (4 bytes):
//   0: seat     u8
//   1: f        u8   facing, as BR_MSG_PLACE
//   2: mapGroup u8
//   3: mapNum   u8
#define BR_MSG_FACE 4

// ---- battle ------------------------------------------------------------------

// page -> ROM: the resolved engage. Sent to BOTH sides once a challenge/accept
// negotiation (JSON-only, web/src/net/wire.ts) settles, so each side's
// `br_netlink.c` knows who to exchange link blocks with.
// Payload (4 bytes):
//   0:   seat     u8   the challenger
//   1:   opponent u8   the seat being engaged
//   2..3: nonce   u16 LE  (the wire's own nonce, truncated to 16 bits)
#define BR_MSG_CHALLENGE 5

// ROM <-> page: one raw GBA link-block exchange -- the actual bytes
// `SendBlock`/`gBlockRecvBuffer` trade, carried across the mailbox instead of a
// cable. `seq` is the link exchange's own counter (distinct from the mailbox slot
// continuation's seq). Spans slots: a full block is BLOCK_BUFFER_SIZE (256) bytes.
// Payload (4 + len bytes, len up to 256):
//   0:   seat  u8
//   1..2: seq  u16 LE
//   3..4: len  u16 LE
//   5..: data  len bytes
#define BR_MSG_BT 6

// ROM <-> page: a trainer's party -- either a bot roster seat's (so
// `CreateNPCTrainerParty` can build a trainer battle from it) or a player's, for the
// Hall of Fame. Spans slots: 6 mons * 100 bytes is well past one slot.
// Payload (2 + 100*count bytes):
//   0: seat  u8
//   1: count u8   1..6
//   2..: count PackedMon rows, 100 bytes each (see below)
//   ..:  OPTIONAL bag tail, on the answer to a PEEK (POK-297): money u32 LE, stacks u8
//        (<= 20), then stacks * (item id u16 LE, n u8). A party without one ends at its
//        last row, as it always did.
//
// PackedMon (100 bytes) -- NOT the ROM's real encrypted struct Pokemon; a fixed,
// unencrypted shape sized to match it (100 bytes) so the continuation-slot math for
// a full party lines up with a real party's size:
//   0..1:   species     u16 LE
//   2:      level       u8
//   3..4:   hp          u16 LE
//   5..6:   maxHp       u16 LE
//   7:      status      u8   0 none, 1 SLP, 2 PSN, 3 BRN, 4 FRZ, 5 PAR, 6 TOX (from a ROM)
//   8..23:  moves[4]    4 bytes each: id u16 LE, pp u8, ppUps u8 (id 0 = empty slot)
//   24..25: heldItem    u16 LE
//   26..27: otId        u16 LE
//   28..31: personality u32 LE
//   32..35: exp         u32 LE
//   36:     nicknameLen u8   (<= 10)
//   37..46: nickname    Gen 3 charmap bytes (web/src/text/gen3.ts), unused tail zero
//   47:     otLen       u8   (<= 7)
//   48..54: ot          Gen 3 charmap bytes, unused tail zero
//   55:     flags       u8   bit0 = traded
//   56..99: reserved    zero
#define BR_MSG_PARTY 7

// ROM -> page: a party slot fainted (spectator/HUD state, not elimination).
// Payload (2 bytes): seat u8, index u8 (0..5)
#define BR_MSG_FAINT 8

// ROM <-> page: this seat has been eliminated from the match.
// Payload (1 byte): seat u8
#define BR_MSG_OUT 9

// ROM <-> page: a ground item is gone, or part of a bag is (a bare key with
// item/n/cash all zero is the whole piece; with item set, that many left the bag
// and the rest is still there).
// Payload (8 bytes):
//   0..1: seat    (byte 0: seat u8)
//   1..2: key     u16 LE   ground-item instance id
//   3:    hasItem u8
//   4..5: item    u16 LE
//   6:    n       u8      1..99
//   7:    cash    u8      0/1
#define BR_MSG_PICKUP 10

// ROM <-> page: a trainer's team hit the ground, optionally with their bag.
// Spans slots when the bag is present.
// Payload:
//   0: seat     u8
//   1: mapGroup u8
//   2: mapNum   u8
//   3: count    u8   0..6
//   4..: count rows, 9 bytes each: key u16 LE, x s16 LE, y s16 LE, species u16 LE,
//        level u8
//   next: hasBag u8
//   if hasBag: key u16 LE, x s16 LE, y s16 LE, itemCount u8 (<=8),
//              itemCount * (id u16 LE, n u8), money u32 LE,
//              nameLen u8 (<=7) + name (Gen 3 charmap bytes)
#define BR_MSG_SPILL 11

// Host -> page/ROM: where the fog is now. `sx`/`sy` are region-map SECTION
// coordinates (gRegionMapEntries), Hoenn's analogue of Kanto's town-map cell.
// Payload (up to 25 bytes):
//   0:  seat      u8   the host
//   1:  phase     u8   1..64
//   2:  sx        s8   -64..64
//   3:  sy        s8   -64..64
//   4:  r         s8   radius in sections; -1 = everywhere
//   5:  placeLen  u8   (<=16)
//   6..: place    Gen 3 charmap bytes, placeLen of them
//   next: hasElapsed u8
//   next..+1: elapsed u16 LE   seconds since the match began
#define BR_MSG_RING 12

// Host -> page/ROM: a countdown the room is watching (the Safari opening's clock
// today; generic so any future shared countdown can reuse it).
// Payload (3 bytes): seat u8, left u16 LE (seconds, 0..3600)
#define BR_MSG_CLOCK 13

// Host -> page/ROM: the match begins. Spans slots once there are more than a
// handful of spawns.
// Payload:
//   0..3: seed      u32 LE
//   4:    spawnCount u8   1..32
//   5..6: safari     u16 LE   seconds; 0 = no Safari opening
//   7..8: fog        u16 LE   seconds; 0 = reader keeps its own option
//   9:    paceFlags  u8   bit0 = pace present, bit1 = animations,
//                          bits2..3 = text speed index (0->1, 1->3, 2->5)
//   10..: spawnCount rows, 8 bytes each: seat u8, mapGroup u8, mapNum u8,
//         x s16 LE, y s16 LE, outFlag u8 (only ever set on a `late`-derived resend)
#define BR_MSG_START 14

// Host/page -> ROM: a line for the overworld ticker/HUD window (kill feed, system
// line, or a chat line riding the same pipe -- Hoenn has no separate chat).
// Payload (2 + textLen bytes):
//   0: seat u8   who said it / who the line is about
//   1: kind u8   0=system 1=kill 2=say
//   2: textLen u8 (<=96)
//   3..: text  Gen 3 charmap bytes
#define BR_MSG_TICKER 15

// ROM -> page: a link/trainer battle this seat was in just concluded. Distinct from
// the room's overall winner and from BR_MSG_OUT -- a lost PvP fight does not by
// itself eliminate anyone.
// Payload (2 bytes): seat u8, outcome u8 (0=win 1=lose 2=draw 3=forfeit)
#define BR_MSG_RESULT 16

// ROM <-> page: what a seat is doing that is not walking, edge-triggered (POK-230).
// The engage skips a seat in a battle; a menu is not a hiding place and is not skipped.
// Payload (2 bytes): seat u8, kind u8 (0 on the map, 1 in a menu, 2 in a battle)
#define BR_MSG_BUSY 17

// ROM -> page -> spectators: a link battle starting, so a spectator can replay it as a
// BATTLE_TYPE_RECORDED (POK-233). The challenger emits it (it has both sides). Spans
// slots: two 6-mon parties are ~1.2 KB. Payload (variable):
//   0..1:  battle    u16 LE   the challenger's seat pair id (loSeat | hiSeat<<8)
//   2..5:  seed      u32 LE   gRecordedBattleRngSeed, so the replay is deterministic
//   6..9:  flags     u32 LE   the fighters' gBattleTypeFlags (the replay ORs RECORDED)
//   10:    names     2 * (PLAYER_NAME_LENGTH+1) bytes, player then opponent
//   ..:    genders   u8 player, u8 opponent
//   ..:    party     u8 pCount, then pCount struct Pokemon (100 bytes; portable, keyed
//                    by each mon's own personality^otId), then u8 oCount + oCount mons
#define BR_MSG_BSTART 18

// ROM -> page -> spectators: the action bytes a battle produced since the last turn
// message, streamed so the spectator's recorded replay stays a turn behind (POK-233).
// The challenger emits it. Payload (variable, the RecordedBattle delta):
//   0..1:  battle  u16 LE
//   2..:   one or more [battler u8, count u8, count action bytes] runs
#define BR_MSG_TURN 19

// page -> ROM: watch this seat walk around (POK-233). The spectator's camera rides
// their ghost; the seat's own ROM never sees this. 0xFF stops following and gives the
// camera, the sprite and the controls back.
// Payload (1 byte): seat u8 (0xFF = stop)
#define BR_MSG_FOLLOW 20

// A spectator asks what the trainer they watch is carrying (POK-233). Broadcast, so
// every ROM sees it and only `target` answers -- with a BR_MSG_PARTY of its own party,
// which is how the asker's peek box gets its rows and how the answerer counts the eyes
// on it.
// Payload (2 bytes): asker u8, target u8
#define BR_MSG_PEEK 21

// ROM -> page -> spectators: the seconds left on a fighter's shot clock (POK-231), so
// somebody watching sees the pressure the fighter is under. Each fighter publishes its
// own; a spectator draws the one belonging to the seat it follows. 0 means the choice
// is made and the clock is gone.
// Payload (2 bytes): seat u8, secs u8 (0..30)
#define BR_MSG_SHOT 22

// page -> ROM: the party of a bot about to challenge us (POK-238). A bot has no ROM on
// the other end of a link, so the fight is an ordinary trainer battle and this is the
// trainer: the ROM builds these straight into gEnemyParty and leaves gTrainers alone.
// The CHALLENGE that follows starts it.
// Payload (variable):
//   0:    seat     u8   the bot's roster seat
//   1:    nameLen  u8   (<= PLAYER_NAME_LENGTH)
//   2..:  name     Gen 3 charmap bytes
//   ..:   count    u8   1..6
//   ..:   party    count * PackedMon (100 bytes each, as BR_MSG_PARTY)
//   ..:   items    u8   how many of its bag it may spend here, 0..4 (POK-237)
//   ..:   ids      items * u16  Gen 3 item ids, straight into BATTLE_HISTORY
// The tail is optional: a card without one leaves the AI on the rung's own potion.
#define BR_MSG_TRAINER 23
#define BR_MSG_PICK 24      // ROM -> page: the section this trainer chose to drop into
#define BR_MSG_LAND 25      // page -> ROM: the cell the host dealt them inside it

// spent: which of a bot's staked items this fight actually used (POK-237). The bag
// lives on the host's page and the fight does not, so this is the only report of it.
// Payload:
//   0:    seat     u8   the bot's roster seat, not the sender's
//   1:    count    u8   0..4
//   2..:  ids      count * u16
#define BR_MSG_SPENT 26

// duel: two bot parties for the hidden proxy instance to fight properly (POK-238).
// Only that instance ever receives one -- it has no seat and is in no room.
// Payload (variable):
//   0:    seatA    u8   whose party goes into gPlayerParty
//   1:    seatB    u8   whose goes into gEnemyParty
//   2:    countA   u8   1..6
//   3:    countB   u8   1..6
//   4..:  parties  (countA + countB) * PackedMon, A's first
//   ..:   bagA     u8 count (0..4) then count * u16 item ids (POK-237)
//   ..:   bagB     the same for the other side
// The bags are optional: without them the duel is fought bare, which is what it did
// before there were bags at all.
#define BR_MSG_DUEL 27

// dresult: how it went. Not the mons -- the page sent them and still holds them --
// only what the fight changed.
//   0:    seatA    u8
//   1:    seatB    u8
//   2:    winner   u8   0 = A, 1 = B, 2 = neither (a draw, or it never resolved)
//   3:    countA   u8
//   4:    countB   u8
//   5..:  left     (countA + countB) * (hp u16, status u8), A's first
//   ..:   usedA    u8 count then count * u16: what side A spent out of its bag
//   ..:   usedB    the same for the other side
#define BR_MSG_DRESULT 28

// fled: this trainer just ran from that one (POK-266, Kanto v0.49.0). Its own signal
// rather than a fourth BUSY kind: BUSY means "cannot be challenged", and POK-231's rule
// is that only the FLEER is held off the PURSUER -- everybody else may still walk up to
// them. Reporting a flee as busy would take a runner off the board for the whole room
// for ten seconds, which is a rules change wearing a cosmetic's clothes.
// Payload:
//   0:    seat     u8   who ran
//   1:    from     u8   who they ran from
#define BR_MSG_FLED 29

// give: put these items in the bag (POK-280). Kanto's rule is that a fallen trainer's
// BAG is items AND money, taken whole in one press; ours handed over the cash and left
// the items on the floor, because `ParseSpill` never kept them -- the ROM's loot table
// has room for eight pieces on a map and no room at all for what is inside one, and
// EWRAM has eighty bytes left to argue with.
//
// So the page keeps the contents, as it already does for the whole match (match/loot.ts),
// and gives them over when it sees our own seat take the bag. The ROM does not decide
// what is in a bag any more than it decides where one lands.
// Payload:
//   0:    count    u8   1..8 stacks
//   1..:  stacks   count * (id u16, n u8)
#define BR_MSG_GIVE 30

// npcout: one of Hoenn's own route trainers has been beaten, so its sprite goes away
// for EVERYBODY (POK-287). Kanto's rule, README: "beaten means gone" -- the world is a
// record of the match, and reading a route as "somebody got here first" is the point.
//
// The spill was already broadcast and the despawn was not, so every other client saw the
// Poke Balls on the ground with the trainer still standing next to them -- and could
// fight and loot the same trainer again.
//
// docs/WIRE.md called this out as the follow-up it is: npcout was left JSON-only under
// POK-217's ROM-crossing scope, with the note that if a remote player's map trainer ever
// needs to auto-hide, it joins the crossing set. It does, so it has. Its `obj` was a
// string for the page's benefit and is a local id here: EWRAM has no room for names, and
// the object is found by id anyway.
// Payload:
//   0:    seat     u8   who beat them
//   1:    group    u8   the map they were standing on
//   2:    num      u8
//   3:    localId  u8   the object event's local id on that map
#define BR_MSG_NPCOUT 31

// The highest type in use, and how many the ROM's dispatch table has room for
// (br_mailbox.c; a STATIC_ASSERT there keeps LAST below COUNT). A new message moves
// LAST; the table grows only when LAST reaches COUNT, and it costs 8 bytes of EWRAM a
// type when it does. Anything at or past COUNT is dropped on arrival.
#define BR_MSG_LAST BR_MSG_NPCOUT
#define BR_MSG_COUNT 48

#endif // GUARD_BR_WIRE_H
