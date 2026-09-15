#ifndef GUARD_BR_CONFIG_H
#define GUARD_BR_CONFIG_H

#include "br/br_version.h"

// Compile-time knobs for the battle royale. Everything the match director can change
// at runtime lives in the mailbox instead (struct BrMatch); these are the fixed shapes.

// 'BR' little-endian: the first thing the shell checks in EWRAM to know the patch is
// awake and where the mailbox begins.
#define BR_MAGIC 0x4252

// Mailbox rings (POK-216): slots of BR_SLOT_BYTES, BR_RING_SLOTS per direction.
#define BR_RING_SLOTS 64
#define BR_SLOT_BYTES 64

// Roster seats: humans and bots together. The relay seats 16 humans; MAX goes to 30.
#define BR_MAX_SEATS 32

// Ghost object events use local ids from this base (POK-219). Object event templates on
// maps use small ids, so a high range never collides.
#define BR_GHOST_LOCAL_ID_BASE 0xE0

#endif // GUARD_BR_CONFIG_H
