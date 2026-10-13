#ifndef GUARD_BR_EVENT_H
#define GUARD_BR_EVENT_H

#include "br/br_config.h"

// Events (Cam, 2026-10-13): "start every other ring from the first shrink. An event drops
// a cluster of items, rares and a legendary at a location marked on the map. There's no
// completion or claim. Final ring: centres on the last event."
//
// The host deals all of it (web/src/match/events.ts). What drops is ordinary loot, SPILLs
// under keys of the events' own, so the ROM draws it, picks it up and hands it over the
// way it does a fallen trainer's. The one thing that is new here is the mark on the MAP:
// an EVENT says which section, and which key is the legendary, and the mark goes gray
// once somebody's PICKUP names that key.

// Phases 2, 4, 6 and 8: four.
#define BR_EVENT_MAX 4

// A piece's key, `0xB000 | (n << 4) | i`: past every trainer's (0x8000 | slot << 11 | id
// ends at 0xAB56 for slot 5), in nobody's space, so it is never read as a seat's own.
#define BR_EVENT_KEY_BASE 0xB000
#define BR_EVENT_KEY(n, i) ((u16)(BR_EVENT_KEY_BASE | ((n) << 4) | (i)))

struct BrEvents
{
    /*  0 */ u32 seed;               // the match these are for; another's are forgotten
    /*  4 */ u16 key[BR_EVENT_MAX];  // the legendary's loot key
    /* 12 */ u8 mapsec[BR_EVENT_MAX];
    /* 16 */ u8 live;                // a bit an event that has dropped
    /* 17 */ u8 taken;               // a bit an event whose legendary somebody has
    /* 18 */ u8 pad[2];
};                                    // 20 bytes
BR_OFFSET(BrEvents, seed, 0)
BR_OFFSET(BrEvents, key, 4)
BR_OFFSET(BrEvents, mapsec, 12)
BR_OFFSET(BrEvents, live, 16)
BR_OFFSET(BrEvents, taken, 17)
BR_SIZE(BrEvents, 20)

extern struct BrEvents gBrEvents;

void BrEvent_Init(void);
// Somebody's PICKUP, ours included: an event's legendary under that key is gone.
void BrEvent_NoteTaken(u16 key);
// The marks on the MAP, over the region map at (left, top) in cells.
void BrEvent_DrawOnMap(s16 left, s16 top);

#endif // GUARD_BR_EVENT_H
