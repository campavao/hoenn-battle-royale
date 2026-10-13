#ifndef GUARD_BR_HM_H
#define GUARD_BR_HM_H

#include "global.h"

// Field moves without the HMs (2026-10-13, the speed-up redesign: "get rid of the need
// for HMs, make it easy to get around"). Cut trees, smash rocks and Strength boulders are
// gone from the maps (br_strip.h), so what is left is the water: walk into it and you
// are surfing, walk up a waterfall and you climb it, press A on a dive spot and you go
// down. No Pokemon has to know the move, nothing asks "would you like to", and no field
// move plays its cut-in. The eight HMs are no longer in the starting bag (br_boot.c).

// Walking into water from the shore, or up a waterfall while surfing: start the field
// move instead of bumping. TRUE when it did. The one hook in PlayerNotOnBikeMoving.
bool8 BrHm_WalkInto(u8 direction, u8 collision);

// Pressing A at the water: the script that runs, or NULL. GetInteractedWaterScript.
const u8 *BrHm_WaterScript(u8 metatileBehavior);

// Pressing A on a dive spot, down or up: TrySetupDive{Down,Emerge}Script.
const u8 *BrHm_DiveScript(void);

// TRUE: the field move's Pokemon cut-in does not play. Every field move waits for it --
// SURF's jump, WATERFALL's climb, DIVE's warp, FLY's bird -- and it is a second and a
// half of a match each time. FldEff_FieldMoveShowMonInit.
bool8 BrHm_SkipCutIn(void);

#endif // GUARD_BR_HM_H
