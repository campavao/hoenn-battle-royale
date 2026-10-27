#ifndef GUARD_BR_WILD_H
#define GUARD_BR_WILD_H

#include "br/br_config.h"

// A wild battle the page asks for (spike B, web/spike-b/rom.ts). There the page owns the
// overworld and draws the marked spots itself, the way br_patch.c deals them; this ROM
// stands hidden in a town and is only asked to fight. Stepping on a spot writes the map
// the page's trainer is on, and this starts the battle that spot would have started:
// that map's own table at Emerald's odds, the ladder's level, and this match's national
// stand-in (BrZone_NationalOn), on grass or water as the spot was.
//
// The page writes mapGroup, mapNum and water, then state = ASKED. The ROM answers
// FIGHTING once the battle is on its way, and DONE with the species and the outcome when
// it is back on the field. A map with no table for the spot's kind answers DONE at once,
// species SPECIES_NONE.
#define BR_WILD_IDLE 0
#define BR_WILD_ASKED 1
#define BR_WILD_FIGHTING 2
#define BR_WILD_DONE 3

struct BrWildAsk
{
    /* 0 */ u8 state;
    /* 1 */ u8 mapGroup;
    /* 2 */ u8 mapNum;
    /* 3 */ u8 water;    // the spot was water: the map's water table, not its land one
    /* 4 */ u16 species; // what came out
    /* 6 */ u8 level;
    /* 7 */ u8 outcome;  // gBattleOutcome, at DONE
};
BR_OFFSET(BrWildAsk, state, 0)
BR_OFFSET(BrWildAsk, mapGroup, 1)
BR_OFFSET(BrWildAsk, mapNum, 2)
BR_OFFSET(BrWildAsk, water, 3)
BR_OFFSET(BrWildAsk, species, 4)
BR_OFFSET(BrWildAsk, level, 6)
BR_OFFSET(BrWildAsk, outcome, 7)
BR_SIZE(BrWildAsk, 8)

extern struct BrWildAsk gBrWildAsk;

// Every frame: an ASKED battle starts once the field is running.
void BrWild_Tick(void);

#endif // GUARD_BR_WILD_H
