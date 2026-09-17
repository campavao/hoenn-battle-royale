#ifndef GUARD_BR_MOVES_H
#define GUARD_BR_MOVES_H

#include "global.h"

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

// A move the player chose stays chosen (POK-290).
//
// The rung teaches moves on its own now, and Kanto's rule is that it may take a slot the
// player left alone and never one they filled on purpose. Emerald has nowhere to write
// "this one was a decision", so BR keeps the note: four bits a party slot, cleared when
// the slot changes hands, and gone with the match.
void BrMoves_ClearKept(void);
void BrMoves_ForgetKept(u8 partyIndex);
// Mark whichever of this mon's four slots holds `move`. Called where a move is taught
// deliberately -- the relearner's two paths -- rather than passed a slot, because the
// empty-slot path does not know which slot GiveMoveToMon used.
void BrMoves_Keep(u8 partyIndex, u16 move);
bool8 BrMoves_IsKept(u8 partyIndex, u8 slot);

#endif // GUARD_BR_MOVES_H
