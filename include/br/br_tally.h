#ifndef GUARD_BR_TALLY_H
#define GUARD_BR_TALLY_H

#include "br/br_config.h"

// What you did in a match that only the ROM sees (POK-416). Cam: "record and show stats
// like how many battles won, favorite pokemon, favorite move, distance traveled, pokemon
// caught, items used". START zeroes this (br_match.c) and the page reads it once the
// match is decided (web/src/match/tally.ts), the way it reads gBrJank -- nothing goes on
// the wire. Everything the room already sees (RINGS, TRAINERS, DUELS, TOOK) is counted
// off the wire by web/src/match/record.ts instead.
//
// IWRAM, not EWRAM: EWRAM is down to its last bytes.

// Room for this many different species and moves; a seventh species or ninth move is
// not counted rather than pushing one out. A match rarely sees more.
#define BR_TALLY_MONS 6
#define BR_TALLY_MOVES 8

struct BrTally
{
    /* 0 */ u16 steps;      // tiles walked, biked or surfed
    /* 2 */ u16 won;        // battles won: wild, trainers, duels
    /* 4 */ u16 caught;
    /* 6 */ u16 items;      // bag items used: thrown, drunk, taught, held up
    /* 8 */ u16 species[BR_TALLY_MONS];  // who used the moves...
    /* 20 */ u16 moves[BR_TALLY_MOVES];  // ...and which
    /* 36 */ u8 speciesN[BR_TALLY_MONS]; // how many moves each used, saturating at 255
    /* 42 */ u8 movesN[BR_TALLY_MOVES];  // how many times each was used
    /* 50 */ u16 discard;   // bag items about to go that were not used: a toss, a sale
};                          // 52 bytes
BR_OFFSET(BrTally, steps, 0)
BR_OFFSET(BrTally, won, 2)
BR_OFFSET(BrTally, caught, 4)
BR_OFFSET(BrTally, items, 6)
BR_OFFSET(BrTally, species, 8)
BR_OFFSET(BrTally, moves, 20)
BR_OFFSET(BrTally, speciesN, 36)
BR_OFFSET(BrTally, movesN, 42)
BR_SIZE(BrTally, 52)

extern struct BrTally gBrTally;

// br_match.c: a match starts.
void BrTally_Reset(void);
// field_control_avatar.c: the player took a step.
void BrTally_Step(void);
// battle_util.c: `battler` is using `move`.
void BrTally_Move(u8 battler, u16 move);
// battle_main.c: a battle is over, gBattleOutcome says how.
void BrTally_BattleEnd(void);
// item.c: `n` of `item` left the bag.
void BrTally_ItemOut(u16 item, u16 n);
// item_menu.c: the next `n` to leave the bag are being thrown away or sold, not used.
void BrTally_Discard(u16 n);

#endif // GUARD_BR_TALLY_H
