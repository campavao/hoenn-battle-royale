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

struct BrZone
{
    /*  0 */ u32 dealtFor;                 // the seed these were dealt from; 0 = none yet
    /*  4 */ u16 species[BR_ZONE_SLOTS];
};                                          // 28 bytes

extern struct BrZone gBrZone;

void BrZone_Init(void);
// Deals the pool for the current match seed if it has not been dealt yet. Cheap to
// call: it does nothing once the seed it was dealt for still matches.
void BrZone_Ensure(void);
// The species a wild encounter in the opening should use, or SPECIES_NONE outside one
// (the caller then keeps whatever the map's own table gave it).
u16 BrZone_Pick(void);

#endif // GUARD_BR_ZONE_H
