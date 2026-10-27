#ifndef GUARD_BR_HM_H
#define GUARD_BR_HM_H

#include "global.h"
#include "br/br_config.h"

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
// a bike"). The MACH BIKE when there are both. A registered item still comes first --
// but a rod only facing water (br_hm.c). UseRegisteredKeyItemOnField, ahead of its
// registered-item test.
void BrHm_SelectBike(void);

// The page's field-move icons (Cam's 10-27 play-test, HBR-78: "icons on the screen to
// indicate when you can do things like Surf, Fly, Cut"). Bit n is HM n+1's move, as
// sHmMoves has them: CUT, FLY, SURF, STRENGTH, WATERFALL, DIVE. FLASH is on for everybody
// (br_boot.c) and the smash rocks are gone (br_strip.c), so neither bit is ever set.
#define BR_HM_CUT       (1 << 0)
#define BR_HM_FLY       (1 << 1)
#define BR_HM_SURF      (1 << 2)
#define BR_HM_STRENGTH  (1 << 3)
#define BR_HM_WATERFALL (1 << 6)
#define BR_HM_DIVE      (1 << 7)

struct BrHmView
{
    /* 0 */ u8 can;   // somebody in the party could use it (BrHm_Slot)
    /* 1 */ u8 ready; // ...and it would work on what we face or stand on, this frame
    /* 2 */ u8 pad[2]; // a struct rounds to 4 bytes on both compilers
};
BR_OFFSET(BrHmView, can, 0)
BR_OFFSET(BrHmView, ready, 1)
BR_SIZE(BrHmView, 4)

// Both 0 outside the match proper (the Safari, out, a ROM with no match); `ready` is 0 off
// the field and while a script runs, and `can` keeps its last value there.
extern struct BrHmView gBrHmView;

// Every frame from BrFrame: `ready` each field frame; `can` takes one mon's read every
// BR_HM_VIEW_FRAMES of them (br_hm.c), so the whole party every dozen frames.
void BrHm_Tick(void);

#endif // GUARD_BR_HM_H
