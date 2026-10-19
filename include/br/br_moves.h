#ifndef GUARD_BR_MOVES_H
#define GUARD_BR_MOVES_H

#include "global.h"
#include "main.h"

// The MOVES row on the party screen (POK-279), and what it opens.
//
// Kanto's rule, README "MOVES swaps any of a Pokemon's four moves for any move it could
// ever learn -- level-up moves at any level, every compatible TM and HM -- no tutor, no
// item, no ceremony". Emerald has half of that already: the move relearner is a whole
// screen, with the move's description, its PP, power and accuracy, the contest hearts and
// scroll arrows that size themselves off the list. What it does not have is the machines.
//
// So this is a list, not a menu. `BrMoves_AppendMachines` is the one hook into
// move_relearner.c's list builder; everything downstream -- the rows, the CANCEL line,
// the selection, the overwrite flow -- reads a plain move id and needs no change.
//
// A machine is offered only while it is in the bag, and teaching from here spends it
// exactly as the cartridge does: a TM goes, an HM does not (party_menu.c's own rule, and
// Kanto's -- lib/moves.lua, "a TM is spent by teaching; an HM is a tool").

// Append every move a machine in the bag could teach this mon, after `count` level-up
// moves already in `moves`. Skips what it already knows and what is already in the list.
// Returns the new count, never above `max`.
u8 BrMoves_AppendMachines(struct Pokemon *mon, u16 *moves, u8 count, u8 max);

// The machine in the bag that teaches `move`, or ITEM_NONE. The list carries move ids
// only, so the item is found again on the way back rather than carried along.
u16 BrMoves_MachineFor(u16 move);

// Is there anything at all to show this mon -- a relearnable move, or a machine it can
// take? The gate on opening the screen, so "NO NEW MOVES" is only ever the truth.
bool8 BrMoves_HasAny(struct Pokemon *mon);

// A move has just been taught: take the TM that taught it out of the bag. An HM stays.
void BrMoves_Spend(u16 move);

// A slot is about to be written over, from the MOVES list or a TM used from the bag.
// TMs go round: a move this mon could only have had from a TM goes back in the bag as
// that TM (Cam, 2026-10-17: "make swapping moves among pokemon also easy"), so MOVES on a
// teammate offers it next. It used to drop on the ground (2026-10-13); it still does when
// the bag already holds that TM (one copy each) or the TM pocket has no room. A move it learns on its own by now does not -- a TM for that
// would be one made out of nothing -- and neither does an HM's, which never left the bag.
// A trainer's mon can come with a TM's move (a gym party's, spilled as loot when it is
// beaten): its TM comes back as well, the trainer's machine come with the mon. From the
// MOVES list, a TM used from the bag, and a move learnt on evolving.
void BrMoves_Forgetting(struct Pokemon *mon, u8 slot);

// A TM off the ground (Cam, 2026-10-14: "moves that are picked up should immediately go
// into the teach screen and if not teachable stay on the ground"). Every way a TM comes
// up -- a map's item ball, a dealt ball or a house cache, a TM somebody forgot -- asks
// BrMoves_Teachable first and leaves the ball where it lies on FALSE. On TRUE it is taken
// as before and BrMoves_TeachSoon opens the party screen to teach it, the bag's own TM
// screen, once it is in the bag and the field is ours again. B there keeps it in the bag.
// TMs only: an HM is a field tool the player carries anyway, so it goes to the bag as
// before.
bool8 BrMoves_IsTm(u16 item);
// Some mon in the party could learn it and does not know it already.
bool8 BrMoves_Teachable(u16 item);
// Call before the TM goes in the bag: the screen waits for the bag to gain one.
void BrMoves_TeachSoon(u16 item);
void BrMoves_Tick(void);
// CB2_ShowPartyMenuForItemUse's way back: to the field for a TM off the ground, else
// `callback` (the bag).
MainCallback BrMoves_TeachExit(MainCallback callback);

// The cartridge's question when a level brings a fifth move (Cam, 2026-10-18, POK-400:
// "show the normal learn/replace prompt"). A lift fills an empty slot as it always did;
// a move that finds four already there is no longer swapped in by BrLevels' own pick but
// asked about, party_menu.c's own "wants to learn ... should a move be deleted" and the
// summary screen to choose the one to forget, the next time START's POKéMON is opened.
//
// The party's slot `slot` climbed from level `from`: every learnset move above `from`
// and at or under its level that it does not know is asked about, in learnset order.
// `count` is the party's size now; if it is not the same when the question comes, the
// party has changed under it and nothing is asked (MOVES still has every one of them).
void BrMoves_AskFrom(u8 slot, u8 from, u8 count);
// The next move to ask about, for party_menu.c: TRUE with the slot and the move, and
// FALSE when there is nothing left. A mon with a slot free by now just learns it.
bool8 BrMoves_NextAsk(u8 *slot, u16 *move);
// Whether a question waits. The ticker says so once (Cam, 2026-10-18: "it can wait"), and
// START's POKéMON asks them rather than the screen fading into it on its own.
bool8 BrMoves_AskWaiting(void);

// What is waiting to be asked. `off` is for drivers that lift a party for some other
// reason (fog-news.txt, grows-up.txt...) and do not want a party screen in the middle of
// it: a lift then picks the best four itself, as a match's opening climb does. The page
// never sets it, and learn-ask.txt is the prompt's own.
struct BrAsk
{
    /* 0 */ u8 from[PARTY_SIZE]; // the level each slot climbed from, 0 for nothing to ask
    /* 6 */ u8 count;            // the party's size when it climbed
    /* 7 */ u8 off;
};
extern struct BrAsk gBrAsk;

#endif // GUARD_BR_MOVES_H
