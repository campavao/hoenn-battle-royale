#ifndef GUARD_BR_VERSION_H
#define GUARD_BR_VERSION_H

// The patch number is what the shell, the relay and the other player's ROM compare.
// Bump it on every release that changes ROM behaviour; the relay refuses a room whose
// host runs a different patch (POK-244). CI reads these two defines into br-version.json.
#define BR_PATCH_VERSION 1

// The wire protocol between the ROM, the shell and the relay (POK-217). Bump when a
// message layout changes, and with it wire.ts's PROTOCOL.
//
// The message table's shape is part of it (POK-331 #21): a message added, retired or
// renumbered, or a cap moved, is a new row in tools/br/wire-protocols.txt under the
// next protocol, and br_wire.c does not build until this is that row's protocol.
#define BR_PROTOCOL 1

#endif // GUARD_BR_VERSION_H
