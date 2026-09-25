#ifndef GUARD_BR_ZONE_H
#define GUARD_BR_ZONE_H

#include "br/br_config.h"

// The Safari's catch pool, dealt from the match seed (POK-255).
//
// Emerald's own Safari tables give every match the same handful of species in the same
// proportions, which makes the opening's one real decision -- what do I take into the
// match -- the same decision every time. Kanto deals the zone its own twelve species
// per match (v0.44.0): a rare slice worth going looking for, and an open slice so
// there is always something to throw a ball at.
//
// Nothing goes over the wire for this. Every ROM in the room already has the match seed
// from the START, and the deal is a pure function of it, so all of them work out the
// same twelve without anybody sending them.

#define BR_ZONE_SLOTS 12
// Of those twelve, the first four come from the rare table.
#define BR_ZONE_RARES 4

// One item ball per area of the Zone (POK-261), dealt from the same seed. Kanto's rule
// (v0.49.0): the opening's second decision is whether to spend two minutes catching or
// to go and look, and a one-in-eight Master Ball is what makes looking worth it.
#define BR_ZONE_ITEMS 6

struct BrZone
{
    /*  0 */ u32 dealtFor;                 // the seed these were dealt from; 0 = none yet
    /*  4 */ u16 species[BR_ZONE_SLOTS];
    /* 28 */ u16 items[BR_ZONE_ITEMS];     // what is in each area's ball
    /* 40 */ u8 placed;                    // the balls have been put on the ground
    /* 41 */ u8 chestPlaced;               // ...and the DAY CARE's one Pokemon (POK-306)
    /* 42 */ u16 chest;                    // the species waiting on its floor
};                                          // 44 bytes -- the last three were padding
// web/src/match/zone.ts reads dealtFor and species (BR_ZONE).
BR_OFFSET(BrZone, dealtFor, 0)
BR_OFFSET(BrZone, species, 4)
BR_OFFSET(BrZone, items, 28)
BR_OFFSET(BrZone, placed, 40)
BR_OFFSET(BrZone, chestPlaced, 41)
BR_OFFSET(BrZone, chest, 42)
BR_SIZE(BrZone, 44)

extern struct BrZone gBrZone;

void BrZone_Init(void);
// Deals the pool for the current match seed if it has not been dealt yet. Cheap to
// call: it does nothing once the seed it was dealt for still matches.
void BrZone_Ensure(void);
// The species a wild encounter in the opening should use, or SPECIES_NONE outside one
// (the caller then keeps whatever the map's own table gave it).
u16 BrZone_Pick(void);
// Puts this match's item balls on the ground, once. Safe to call every tick.
void BrZone_PlaceItems(void);
// The opening is over: the balls nobody picked up come off the ground. Six of the eight
// rows the whole match has to share were holding item balls on Safari maps that nobody
// can walk back to, from the buzzer to the last ring -- so a trainer eliminated on a
// route dropped two pieces of a team and the rest fell through the floor.
void BrZone_ItemsGone(void);
// The DAY CARE as a chest (POK-306), Cam's own alternative to closing the door: one
// strong Pokemon on the floor of the room and the first trainer through the door takes
// it. Dealt from the match seed like everything else here, so nothing is sent and every
// ROM in the room agrees what is in there; put on the floor once the match proper is on.
// Safe to call every tick.
void BrZone_PlaceChest(void);

#endif // GUARD_BR_ZONE_H
