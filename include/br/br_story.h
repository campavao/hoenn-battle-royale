#ifndef GUARD_BR_STORY_H
#define GUARD_BR_STORY_H

#include "global.h"

// Story events (web/src/match/story.ts): events set where Emerald set that beat, the
// fossils at the top of MIRAGE TOWER or the FOCUS BAND in SHOAL CAVE. What they put down
// is ordinary event loot (br_event.h); what is here is what the place needs to be a place
// you can get to in a match, and the beat that stands between you and the reward.
//
// Nothing here is told which story the host chose. A story's pieces are event loot on its
// own map (BR_EVENT_KEY_BASE keys), and that is the whole of what the ROM needs: a REGI's
// door is worth opening, and a person stands where the page's row says one does, because
// the event's loot lies there. web/src/parity.test.ts pins the cells to story.ts.

struct BrLootItem;

// SHOAL CAVE is at low tide all match: the tide is the hour on each player's own clock,
// so two ROMs in the cave could stand in two different caves, and the FOCUS BAND's room is
// only there at low tide. TRUE: the flag is cleared (clear is low tide) for the match and
// pret's hour is not asked. The one hook in UpdateShoalTideFlag.
bool8 BrStory_Tide(void);

// The three REGI chambers' sealed doors, each opened its own way with no HM to teach
// (br_hm.h): DESERT RUINS's on A at its wall, as Rock Smash would; ANCIENT TOMB's on A at
// its wall with a Flying-type in the party (FLY itself cannot be taught: no HMs); ISLAND
// CAVE's by itself once the ring has moved on a phase from the one its event dropped on,
// or sooner by Emerald's own way in, the braille's lap of the room, which a player who
// knows it may still walk (a bot waits). Opened for this ROM only, as
// Emerald opens it for you and not for anybody else. Each frame, before the loot's: the A
// that opens a door is that door's.
void BrStory_Tick(void);

// A story's person: the gfx a piece at his cell stands as (STEVEN in GRANITE CAVE with
// his TM, CAPTAIN STERN in SLATEPORT's harbour, a gate's boss), or 0 for a ball. The FLAG_HIDE_* sweep
// at boot has already stood their own objects down. Taking one is "A GIFT: ...", as a gift-giver's is.
u8 BrStory_Person(const struct BrLootItem *it);

// FALSE: the person wants something first, and has said so (STERN, the SCANNER from the
// ABANDONED SHIP), or wants a fight first and it has started (a gate: MAXIE holding
// GROUDON in his hideout), or the piece is one a gate's boss is still guarding. TRUE:
// hand it over, which takes what he wanted out of the bag.
bool8 BrStory_Hands(const struct BrLootItem *it);

// A gate's boss: his win drops no team and sends no NPCOUT (br_loot.c), because the
// object he stands as is the story's piece, and what he gives is its reward.
bool8 BrStory_IsGate(u16 trainerId);

// The special the gate's post-battle script calls: the win hands over what he held.
void BrStory_GateBeaten(void);

#endif // GUARD_BR_STORY_H
