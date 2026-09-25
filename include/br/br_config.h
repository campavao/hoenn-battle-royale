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
// maps use small ids, so a high range never collides -- but not TOO high: 0xE0 + seat 31
// was 255, LOCALID_PLAYER, and to a good part of the engine that ghost was the player
// (POK-315). 0xC8..0xE7 sits above the loot balls (0xC0..0xC7) and below the berry
// blender's 236..240, which is the next thing up.
#define BR_GHOST_LOCAL_ID_BASE 0xC8

// A field the page or a driver reads by its offset, pinned where its struct is declared
// (POK-330 #32): moving it fails the build instead of a play-test. Offsets agree between
// agbcc and modern GCC; sizes need not -- agbcc rounds every struct up to a whole word,
// so a 6-byte struct is 8 there -- and BR_SIZE is only for sizes already a multiple of 4.
#define BR_OFFSET(type, field, off) STATIC_ASSERT(offsetof(struct type, field) == (off), BrOffset_##type##_##field)
#define BR_SIZE(type, size) STATIC_ASSERT(sizeof(struct type) == (size), BrSize_##type)

#endif // GUARD_BR_CONFIG_H
