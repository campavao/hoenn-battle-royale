#ifndef GUARD_BR_EVENT_H
#define GUARD_BR_EVENT_H

#include "br/br_config.h"

// Events (Cam, 2026-10-13): "start every other ring from the first shrink. An event drops
// a cluster of placed NPCs, items, rares and a legendary at a location marked on the map.
// There's no completion or claim. Final ring: centres on the last event."
//
// The host deals all of it (web/src/match/events.ts). What drops is ordinary loot, SPILLs
// under keys of the events' own, so the ROM draws it, picks it up and hands it over the
// way it does a fallen trainer's. What is new here is the mark on the MAP and the trader.
// An EVENT says which section, and which key is the legendary, and the mark goes gray
// once somebody's PICKUP names that key. It also says where the event's trader stands and
// what he offers: A on him asks, the party menu picks one of ours, and he swaps it for
// his at our rung. Once a match for each of us, and he keeps what he is given.

// Phases 2, 4, 6 and 8: four.
#define BR_EVENT_MAX 4

// A piece's key, `0xB000 | (n << 4) | i`: past every trainer's (0x8000 | slot << 11 | id
// ends at 0xAB56 for slot 5), in nobody's space, so it is never read as a seat's own.
#define BR_EVENT_KEY_BASE 0xB000
#define BR_EVENT_KEY(n, i) ((u16)(BR_EVENT_KEY_BASE | ((n) << 4) | (i)))

// The traders' object local ids, 0xBC..0xBF: just below loot's 0xC0, so the run the match
// puts on a map (none of it solid, br_ghosts.c) starts here.
#define BR_EVENT_LOCAL_ID_BASE 0xBC

// Where an event's trader stands, grid coords with MAP_OFFSET as a ghost's, and what he
// offers. A species of 0 is no trader.
struct BrEventTrader
{
    /* 0 */ s16 x;
    /* 2 */ s16 y;
    /* 4 */ u16 species;
    /* 6 */ u8 mapGroup;
    /* 7 */ u8 mapNum;
};                       // 8 bytes
BR_OFFSET(BrEventTrader, x, 0)
BR_OFFSET(BrEventTrader, y, 2)
BR_OFFSET(BrEventTrader, species, 4)
BR_OFFSET(BrEventTrader, mapGroup, 6)
BR_OFFSET(BrEventTrader, mapNum, 7)
BR_SIZE(BrEventTrader, 8)

struct BrEvents
{
    /*  0 */ u32 seed;               // the match these are for; another's are forgotten
    /*  4 */ u16 key[BR_EVENT_MAX];  // the legendary's loot key
    /* 12 */ u8 mapsec[BR_EVENT_MAX];
    /* 16 */ u8 live;                // a bit an event that has dropped
    /* 17 */ u8 taken;               // a bit an event whose legendary somebody has
    /* 18 */ u8 traded;              // a bit a trader we have traded with
    /* 19 */ u8 trading;             // the trader the open trade script is with
    /* 20 */ struct BrEventTrader trader[BR_EVENT_MAX];
    /* 52 */ u8 objId[BR_EVENT_MAX]; // the trader's object while spawned, else BR_NO_OBJ
};                                    // 56 bytes
BR_OFFSET(BrEvents, seed, 0)
BR_OFFSET(BrEvents, key, 4)
BR_OFFSET(BrEvents, mapsec, 12)
BR_OFFSET(BrEvents, live, 16)
BR_OFFSET(BrEvents, taken, 17)
BR_OFFSET(BrEvents, traded, 18)
BR_OFFSET(BrEvents, trader, 20)
BR_OFFSET(BrEvents, objId, 52)
BR_SIZE(BrEvents, 56)

extern struct BrEvents gBrEvents;

void BrEvent_Init(void);
// Somebody's PICKUP, ours included: an event's legendary under that key is gone.
void BrEvent_NoteTaken(u16 key);
// The marks on the MAP, over the region map at (left, top) in cells.
void BrEvent_DrawOnMap(s16 left, s16 top);
// Traders on this map in the view box: how many want an object. BrField_ShareObjects
// gives them theirs before anybody else's.
u8 BrEvent_Wanted(void);
// Each frame, before the loot's: the traders on this map agree with the table, and A on
// one we face asks him for a trade.
void BrEvent_Tick(void);
// The trade script's special: gSpecialVar_0x8004 is the slot the party menu chose.
void BrEvent_Trade(void);

#endif // GUARD_BR_EVENT_H
