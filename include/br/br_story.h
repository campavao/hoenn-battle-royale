#ifndef GUARD_BR_STORY_H
#define GUARD_BR_STORY_H

#include "global.h"

// Story events (web/src/match/story.ts): events set where Emerald set that beat, the
// fossils at the top of MIRAGE TOWER or the FOCUS BAND in SHOAL CAVE. What they put down
// is ordinary event loot (br_event.h); what is here is what the place needs to be a place
// you can get to in a match.

// SHOAL CAVE is at low tide all match: the tide is the hour on each player's own clock,
// so two ROMs in the cave could stand in two different caves, and the FOCUS BAND's room is
// only there at low tide. TRUE: the flag is set for the match and pret's hour is not
// asked. The one hook in UpdateShoalTideFlag.
bool8 BrStory_Tide(void);

#endif // GUARD_BR_STORY_H
