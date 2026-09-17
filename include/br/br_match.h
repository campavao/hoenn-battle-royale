#ifndef GUARD_BR_MATCH_H
#define GUARD_BR_MATCH_H

#include "br/br_config.h"

// The match as the ROM sees it (POK-222/POK-223): the phase, what START dealt, and
// the shared clock. The page's director owns the rules; this is the ROM's copy plus
// the transitions it has to perform itself (the Safari opening ending, the drop).

#define BR_PHASE_NONE 0
#define BR_PHASE_SAFARI 1   // in the Safari Zone, no fighting, catching only
#define BR_PHASE_PLAY 2     // dropped, the match proper
#define BR_PHASE_OUT 3      // eliminated
#define BR_PHASE_WIN 4      // last one standing: the Hall of Fame parade, then the page
// The parade is over and we are back on the map. The page waits for this before it takes
// the winner out of the match -- its ending grace is four seconds and a Hall of Fame is
// not, so without a signal the reboot lands in the middle of it. Every other reader of
// this field asks `!= BR_PHASE_NONE` or names a phase, so a fifth value changes nothing
// but the one thing it is for.
#define BR_PHASE_DONE 5

struct BrSpawn
{
    /* 0 */ u8 mapGroup;
    /* 1 */ u8 mapNum;
    /* 2 */ s16 x;      // map coords, no MAP_OFFSET (what SetWarpDestination takes)
    /* 4 */ s16 y;
};                      // 6 bytes

struct BrMatch
{
    /* 0 */ u8 phase;
    /* 1 */ u8 started;      // START received
    /* 2 */ u16 safariSecs;  // from START
    /* 4 */ u16 fogSecs;
    /* 6 */ u8 pace;         // START paceFlags
    /* 7 */ u8 spawnCount;
    /* 8 */ u32 seed;
    /* 12 */ u16 clockLeft;  // seconds, last CLOCK then counted down locally
    /* 14 */ u16 clockFrames; // frames until the next local second
    /* 16 */ u8 haveSpawn[BR_MAX_SEATS];          // a row arrived for the seat
    /* 48 */ struct BrSpawn spawns[BR_MAX_SEATS]; // 192 bytes
    /* 240 */
};

extern struct BrMatch gBrMatch;

void BrMatch_Init(void);
void BrMatch_Tick(void);
// Where in the Safari Zone this ROM starts the opening: which of the six areas (a map
// number in group 26) and which cell of it, dealt from the match seed and our seat so a
// room spreads over the whole Zone instead of piling up on one tile.
void BrMatch_SafariCell(u8 *mapNum, u8 *x, u8 *y);
// The opening's buzzer is going off and we are in a battle: the controllers press RUN.
bool8 BrMatch_BuzzerClosing(void);
// Enter the Safari opening on the current map (the boot warped us there).
void BrMatch_BeginSafari(void);
// The opening is over for us: out of time, steps or balls. Empty party -> OUT,
// else warp to our dealt spawn. Safe to call from a field step hook.
void BrMatch_SafariOver(void);
// Called from CB2_WhiteOut in place of the heal-and-Centre DoWhiteOut: sends OUT and
// marks the phase; overworld.c then re-enters the same map where they fell.
void BrMatch_WhiteOut(void);
// Out of the match, whatever did it -- a whiteout, the buzzer with nothing caught, or
// the fog. One door, so the team always hits the ground on the way through it.
void BrMatch_Out(void);
// Called by hall_of_fame.c where the credits would start: back to the map instead.
void BrMatch_HallOfFameDone(void);
// A door this ROM never opens. Kanto shuts OAK's LAB for the whole match (POK-51) and
// this is the same rule: the story's rooms are not part of the game we are playing.
// Answered for the door's destination, so the map itself is left exactly as pret has it.
bool8 BrMatch_DoorClosed(u8 mapGroup, u8 mapNum);

#endif // GUARD_BR_MATCH_H
