#ifndef GUARD_BR_VERSION_H
#define GUARD_BR_VERSION_H

// The patch number is what the shell, the relay and the other player's ROM compare.
// Bump it on every release that changes ROM behaviour; the relay refuses a room whose
// host runs a different patch (POK-244). CI reads these two defines into br-version.json.
#define BR_PATCH_VERSION 1

// The wire protocol between the ROM, the shell and the relay (POK-217). Bump when a
// message layout changes.
#define BR_PROTOCOL 1

#endif // GUARD_BR_VERSION_H
