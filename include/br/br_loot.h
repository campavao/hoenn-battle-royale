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

#define BR_LOOT_NONE 0
#define BR_LOOT_MON 1
#define BR_LOOT_BAG 2
// An item ball the Zone dealt (POK-261). `species` holds the item id: a ball is a ball
// on the ground either way, and the field that says which is which is `kind`.
#define BR_LOOT_ITEM 3

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
};

// Trainers we have beaten: Emerald leaves a beaten trainer standing on the map, and
// Kanto's rule is that a farmed route shows it. Small on purpose -- EWRAM is full, and
// a match does not walk past that many.
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
// We are out: drop our own team and bag where we stand, and tell the room. Every
// other ROM spawns what this message describes; ours spawns it from the same message
// coming back is not how it works -- we never hear our own, so we add ours here too.
void BrLoot_SpillOwn(void);
// One of Hoenn's own trainers just lost to us: they leave the map for the rest of the
// match, and one of their team is on the ground where they stood (Kanto BR-9b).
void BrLoot_TrainerBeaten(u16 trainerId, u8 localId);
// Puts one dealt item ball on the ground (POK-261). Every ROM deals the same ones from
// the match seed, so nothing is sent: they simply agree. The key's top bit is set, the
// way a beaten trainer's is -- it belongs to nobody, so nothing trade-evolves from it.
void BrLoot_AddItem(u16 key, u8 mapGroup, u8 mapNum, s16 x, s16 y, u16 item);

#endif // GUARD_BR_LOOT_H
