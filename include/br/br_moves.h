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
// A hold item off the ground (Cam, 2026-10-27: "We should prompt to give an item to a
// pokemon when picked up (only items that have hold effects)"): the same wait, then the
// bag's own GIVE screen, "Give to which POKeMON?". B there keeps it in the bag, and the
// ticker says so; a mon already holding something asks to switch, the old one to the bag.
void BrMoves_HoldSoon(u16 item);
void BrMoves_Tick(void);
// The party screen's way back, CB2_ShowPartyMenuForItemUse's and CB2_ChooseMonToGiveItem's:
// to the field for a TM or a hold item off the ground, else `callback` (the bag).
MainCallback BrMoves_TeachExit(MainCallback callback);

// The moves the player set by hand (Cam, 2026-10-20: "replace any moves the player didn't
// manually place, and swap them out for better moves, just like Kanto version"). Per
// slot, as Cam put it: Kanto's DESIGN D12 locks the whole moveset once any of it is
// customized. A level-up lift asks nothing: it swaps in better level-up moves itself
// (br_levels.c) around these. Set wherever the player picks a move: a TM or HM, the
// MOVES list, the forget screen of a RARE CANDY or an evolution. Kept in the mon, one
// bit per move slot, so it follows the mon through the party, the PC and a trade, and
// the summary screen's and the fight menu's move swaps carry it along.
void BrMoves_Placed(struct Pokemon *mon, u16 move);
u8 BrMoves_PlacedSlots(struct Pokemon *mon);
// A slot a lift has written over: its new move is the lift's, not the player's.
void BrMoves_Unplace(struct Pokemon *mon, u8 slot);
void BrMoves_SwapPlaced(struct BoxPokemon *mon, u8 a, u8 b);

#endif // GUARD_BR_MOVES_H
