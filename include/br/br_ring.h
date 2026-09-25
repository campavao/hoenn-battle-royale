#ifndef GUARD_BR_RING_H
#define GUARD_BR_RING_H

#include "br/br_config.h"

// The ring (POK-224): a circle on the Hoenn region map, in section units, that the
// host shrinks on the clock. A map is inside when its region-map rectangle touches
// the circle. Outside, the weather is fog and the party bleeds; the fog never clamps,
// the last phase is everywhere (r = -1).

struct BrRing
{
    /* 0 */ u8 active;      // a ring message has arrived
    /* 1 */ u8 phase;       // 1.. from the host
    /* 2 */ s8 cx;          // centre, region-map section coords
    /* 3 */ s8 cy;
    /* 4 */ s8 r;           // radius in sections; -1 = fog everywhere
    /* 5 */ u8 outside;     // this map is outside the ring right now
    /* 6 */ u8 applied;     // fog weather has been applied for this map
    /* 7 */ u8 out;         // the party fainted to the fog; OUT was sent
    /* 8 */ u16 damageTimer; // frames until the next bleed
    /* 10 */ u16 damageDealt; // total HP taken by the fog, for drivers
    /* 12 */ u8 appliedMapGroup;
    /* 13 */ u8 appliedMapNum;
    /* 14 */ u8 pad[2];
};                          // 16 bytes
// web/src/field.ts reads `outside` and `damageTimer` (RING_OUTSIDE, RING_TIMER).
BR_OFFSET(BrRing, active, 0)
BR_OFFSET(BrRing, phase, 1)
BR_OFFSET(BrRing, cx, 2)
BR_OFFSET(BrRing, cy, 3)
BR_OFFSET(BrRing, r, 4)
BR_OFFSET(BrRing, outside, 5)
BR_OFFSET(BrRing, applied, 6)
BR_OFFSET(BrRing, out, 7)
BR_OFFSET(BrRing, damageTimer, 8)
BR_OFFSET(BrRing, damageDealt, 10)
BR_OFFSET(BrRing, appliedMapGroup, 12)
BR_OFFSET(BrRing, appliedMapNum, 13)
BR_SIZE(BrRing, 16)

#define BR_FOG_TICK_FRAMES 240

extern struct BrRing gBrRing;

void BrRing_Init(void);
void BrRing_Tick(void);
// Geometry, exposed for the page's tests and other systems: is the section inside?
bool8 BrRing_SectionInside(u8 mapsec);
// Special for scripts: 1 when this map is outside the ring.
u16 BrRing_Outside(void);

#endif // GUARD_BR_RING_H
