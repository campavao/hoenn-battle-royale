#ifndef GUARD_BR_LOOT_H
#define GUARD_BR_LOOT_H

#include "br/br_config.h"

// Loot on the ground (POK-232): when a trainer goes out, their team lies where they
// fell as Poké Balls and their bag as a bag. Kanto's rule -- the world is a record of
// the match, and the first person to walk over a ball gets what is in it.
//
// The ROM does not decide where anything lands. A spill arrives as BR_MSG_SPILL, one
// row a mon plus an optional bag, and every ROM in the room spawns the same objects in
// the same cells from it; BR_MSG_PICKUP takes one away everywhere. Coordinates are map
// grid coords the way ObjectEvent.currentCoords holds them (MAP_OFFSET included), the
// same convention as a ghost's.
//
// The table only has to hold what could be on one map at once: the object event table
// is 16 slots and the ghosts already want 12, so the ground gets the handful left.

#define BR_MAX_LOOT 8
// Object-event local ids for loot, below the ghosts' 0xE0 and far above any map's own.
#define BR_LOOT_LOCAL_ID_BASE 0xC0

// "nothing held" for the ticker's held line (POK-289). A key is `(seat << 8) | n` and
// seats are well under 32, so 0xFFFF is never one -- 0 IS one (seat 0's first ball),
// which is why that is not the sentinel.
#define BR_HELD_NONE 0xFFFF

#define BR_LOOT_NONE 0
#define BR_LOOT_MON 1
#define BR_LOOT_BAG 2
// An item ball the Zone dealt (POK-261). `species` holds the item id: a ball is a ball
// on the ground either way, and the field that says which is which is `kind`.
#define BR_LOOT_ITEM 3

// Key spaces, so two things on the ground can never claim the same key:
//
//   0x0000..0x1FFF  a fallen trainer's team and bag -- `(seat << 8) | n`, minted by the
//                   page, which is what decides where an elimination scatters.
//   0x4000..0x5FFF  a Pokemon the player RELEASED to make room (POK-294). Minted in the
//                   ROM, because nobody else is watching the moment it happens.
//   0x8000..0xFFFF  one of Hoenn's own trainers -- `0x8000 | (party index << 11) | id`.
#define BR_LOOT_KEY_FREED 0x4000

struct BrLootItem
{
    /* 0 */ u16 key;      // the wire's instance id, unique for the match
    /* 2 */ s16 x;
    /* 4 */ s16 y;
    /* 6 */ u16 species;  // 0 for a bag
    /* 8 */ u8 mapGroup;
    /* 9 */ u8 mapNum;
    /* 10 */ u8 level;
    /* 11 */ u8 kind;     // BR_LOOT_*
    /* 12 */ u8 objId;    // object event id while spawned here, else BR_NO_OBJ
    /* 13 */ u8 pad[3];
    /* 16 */ u32 money;   // a bag's cash; 0 on a ball
};                        // 20 bytes

struct BrLoot
{
    /* 0x00 */ struct BrLootItem items[BR_MAX_LOOT]; // 160 bytes
    /* 0xA0 */ u8 count;    // rows in use, for drivers
    /* 0xA1 */ u8 spawned;  // objects on this map right now, for drivers
    /* 0xA2 */ u8 taken;    // pieces this player has picked up, for drivers
    /* 0xA3 */ u8 gone;     // beaten trainers this sweep has taken off a map, for drivers
    /* 0xA4 */ u8 freed;    // Pokemon this player has released (POK-294), and the low
                            // half of their keys. Free padding: the struct was already
                            // rounded up to here.
};

// Trainers we have beaten: Emerald leaves a beaten trainer standing on the map, and
// Kanto's rule is that a farmed route shows it. Small on purpose -- EWRAM is full.
//
// It used to hold only the trainers THIS player had beaten, and sixteen was generous for
// that. Since POK-287 it holds the room's: every client hears every npcout, and a
// twelve-player match beats far more than sixteen route trainers between them. So it is a
// ring -- the newest sixteen win. A despawn that falls off is a trainer who stands back
// up on a route somebody cleared a long time ago, which is the least bad way to run out.
#define BR_MAX_DESPAWN 16

struct BrDespawned
{
    u8 mapGroup;
    u8 mapNum;
    u8 localId; // 0 = empty
};

extern struct BrLoot gBrLoot;
extern struct BrDespawned gBrDespawned[BR_MAX_DESPAWN];

void BrLoot_Init(void);
// Each frame: makes the object events on this map agree with the table.
void BrLoot_Tick(void);
// The loot item standing on this cell of the current map, or NULL.
struct BrLootItem *BrLoot_At(s16 x, s16 y);

// Take the piece with this key off the ground, everywhere. Used when a pickup that was
// waiting on a decision finally goes through (POK-294); a no-op if it has already gone.
void BrLoot_ClaimKey(u16 key);
// We are out: drop our own team and bag where we stand, and tell the room. Every
// other ROM spawns what this message describes; ours spawns it from the same message
// coming back is not how it works -- we never hear our own, so we add ours here too.
void BrLoot_SpillOwn(void);
// One of Hoenn's own trainers just lost to us: they leave the map for the rest of the
// match, and one of their team is on the ground where they stood (Kanto BR-9b).
void BrLoot_TrainerBeaten(u16 trainerId, u8 localId);

// A Pokemon the player let go of to make room for a catch lands at their feet as a ball
// anybody can pick up (POK-294). Kanto's rule, from its README: "The released Pokemon
// lands as a ball at your feet, claimable by anyone -- trading up leaves a trace."
// Nothing ever leaves a match.
void BrLoot_Released(struct Pokemon *mon);
// Puts one dealt item ball on the ground (POK-261). Every ROM deals the same ones from
// the match seed, so nothing is sent: they simply agree. The key's top bit is set, the
// way a beaten trainer's is -- it belongs to nobody, so nothing trade-evolves from it.
void BrLoot_AddItem(u16 key, u8 mapGroup, u8 mapNum, s16 x, s16 y, u16 item);
// One Pokemon the match itself put on the ground rather than anybody dropping it: the
// DAY CARE's chest (POK-306). A `level` of 0 means "the rung the match is at when it is
// picked up", which is what a prize that has been lying there since the drop wants.
void BrLoot_AddMon(u16 key, u8 mapGroup, u8 mapNum, s16 x, s16 y, u16 species, u8 level);
// Take a piece off the ground here and say nothing: no PICKUP, so no other ROM's ground
// changes. For loot that has gone out of reach rather than been taken -- the Zone's own
// balls once the opening is over (BrZone_ItemsGone).
void BrLoot_DropKey(u16 key);

#endif // GUARD_BR_LOOT_H
