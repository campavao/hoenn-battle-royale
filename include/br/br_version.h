#ifndef GUARD_BR_VERSION_H
#define GUARD_BR_VERSION_H

// The patch number is what the shell, the relay and the other player's ROM compare.
// Bump it on every release that changes ROM behaviour; the relay refuses a room whose
// host runs a different patch (POK-244). CI reads these two defines into br-version.json.
#define BR_PATCH_VERSION 1

// The wire protocol between the ROM, the shell and the relay (POK-217). Bump when a
// message layout changes.
#define BR_PROTOCOL 1

// The message table's hash at this protocol (POK-331 #21). tools/br/wire-ids.py writes
// the table's own into br_wire_ids.h as BR_WIRE_HASH, and neither br_wire.c nor
// web/src/net/wire-ids.test.ts passes while the two differ: a message added, retired or
// renumbered, or a cap moved, is a new protocol. Bump BR_PROTOCOL (and wire.ts's
// PROTOCOL) and pin the new hash here in the same change; never re-pin under an old
// number.
#define BR_PROTOCOL_WIRE_HASH 0x777CC3AA

#endif // GUARD_BR_VERSION_H
