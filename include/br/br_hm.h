#ifndef GUARD_BR_HM_H
#define GUARD_BR_HM_H

#include "global.h"

// Field moves without the HMs (2026-10-13, the speed-up redesign: "get rid of the need
// for HMs, make it easy to get around"): walk into water and you are surfing, walk up a
// waterfall and you climb it, press A on a dive spot and you go down, walk into a CUT
// tree and it comes down, walk into a boulder and it moves. Nothing asks "would you like
// to", and no field move plays its cut-in. The eight HMs are no longer in the starting
// bag (br_boot.c). Since Cam's 10-19 play-test (#7) each needs somebody in the party who
// could learn its HM -- not know it -- and the CUT trees and STRENGTH boulders are back
// on the maps (br_strip.c); smash rocks stay gone.
// All of it only in a match: a ROM with none is pret's Hoenn, HMs and all.

// A match is running, so the water is free. GetInteractedWaterScript's gate.
bool8 BrHm_Free(void);

// Walking into water from the shore, or up a waterfall while surfing: start the field
// move instead. TRUE when it did. The one hook in PlayerNotOnBikeMoving, ahead of its
// collision test: the shore's water is a collision, but a waterfall is not -- pret lets
// you onto it and its current pushes you back down.
bool8 BrHm_WalkInto(u8 direction, u8 collision);

// The same on a bike, where every move asks GetBikeCollision first: COLLISION_STOP_SURFING
// when the field move started (each bike path takes that one as handled elsewhere and
// neither bonks nor moves), else `collision` as it was.
u8 BrHm_BikeInto(u8 direction, u8 collision);

// Pressing A at the water in a match: the script that runs, or NULL.
const u8 *BrHm_WaterScript(u8 metatileBehavior);

// Pressing A on a dive spot, down or up: ours in a match, else pret's own `script`.
// TrySetupDive{Down,Emerge}Script.
const u8 *BrHm_DiveScript(const u8 *script);

// Who in the party could use this HM's move in the field (Cam's 10-19 play-test, #7:
// "only surf if you have a water Pokemon, and only fly if you have ... a Pokemon that
// could learn Fly"): the first that knows it, or whose species could learn its HM by
// pret's own learnsets. PARTY_SIZE for nobody, and for a move that is not an HM's. SURF,
// WATERFALL, DIVE (down), CUT, STRENGTH and FLY all ask it in a match.
u8 BrHm_Slot(u16 move);

// ScrCmd_checkpartymove, after its own search found nobody who knows the move: in a match
// somebody who could learn its HM will do (VAR_RESULT and VAR_0x8004 as pret sets them).
void BrHm_PartyMove(u16 move);

// TryPushBoulder: in a match STRENGTH is on while somebody could use it, so walking into
// a boulder pushes it.
void BrHm_Strength(void);
// callnative from EventScript_CutTree / EventScript_StrengthBoulder: VAR_RESULT TRUE when a
// match lets the tree fall or the boulder move with no question.
void BrHm_AskCut(void);
void BrHm_AskStrength(void);

// CanSpeciesLearnTMHM's BR rule, any mon any machine: FALSE only while BrHm_Slot asks
// pret's own table.
bool8 BrHm_AnyMachine(void);

// TRUE: the field move's Pokemon cut-in does not play. Every field move waits for it --
// SURF's jump, WATERFALL's climb, DIVE's warp, FLY's bird -- and it is a second and a
// half of a match each time. FldEff_FieldMoveShowMonInit.
bool8 BrHm_SkipCutIn(void);

// SELECT with nothing registered: a bike in the bag is registered first, so SELECT rides
// it (Cam's 2026-10-14 play-test, POK-347: "your select button should automatically select
// a bike"). The MACH BIKE when there are both. A registered item still comes first.
// UseRegisteredKeyItemOnField, ahead of its registered-item test.
void BrHm_SelectBike(void);

#endif // GUARD_BR_HM_H
