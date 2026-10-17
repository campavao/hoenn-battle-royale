#ifndef GUARD_BR_STRIP_H
#define GUARD_BR_STRIP_H

#include "global.h"

// The map's own people, cleared off (2026-10-13, the speed-up redesign: "get rid of all
// NPCs except for Gym Leaders"). Route trainers' eyelines, a house of people with one
// line each and a tree in the way of every short cut were most of what slowed a match
// down that was not a battle.
//
// A filter at spawn time, not a flag sweep: Gen 3 draws people, cut trees, smash rocks
// and Strength boulders all as object events, and every way one appears -- scrolling into
// view, a map load, a script's `addobject` -- goes through TrySpawnObjectEventTemplate.
// What a match keeps: the eight leaders on their gyms (br_gym.c's table), the CENTER
// nurse and the MART clerk (the only people who do something for you), MR. BRINEY and
// the ferry attendants (the boats still run, br_boot.c), item balls and berry trees, and
// the Pokemon and props. What code spawns (a cutscene's camera, loot, ghosts) is never
// the map's.
// tools/br/export-trainers.py applies the same rule for the page's trainer table.

// TRUE: this template never becomes an object on this map. Only in a match.
bool8 BrStrip_Stripped(const struct ObjectEventTemplate *template, u8 mapNum, u8 mapGroup);

// The same rule, row by row, for the map's templates as they are copied into the save
// block (LoadObjEventTemplatesFromHeader): bit i of gBrStripped is
// gSaveBlock1Ptr->objectEventTemplates[i], set when a match never makes that row an
// object. The page draws the map's people past the ROM's box from those rows
// (web/src/field-ghosts.ts), and a person the ROM strips is nobody's to draw there either
// (Cam's 2026-10-17 play-test: Mossdeep's BLACK BELT on the water, drawn by the page past
// the box and gone inside it). Marked whatever the phase -- the page asks gBrMatch.phase
// itself, as BrStrip_Stripped does -- so a match starting on the map we stand on needs no
// second pass. A game is always a new one (br_boot.c), so every map's rows come in here;
// the Battle Pyramid's and the Trainer Hill's own loaders do not, and need not: they are
// indoors, where the page draws nobody past the box.
#define BR_STRIPPED_WORDS (OBJECT_EVENT_TEMPLATES_COUNT / 32)
extern u32 gBrStripped[BR_STRIPPED_WORDS];
void BrStrip_MarkTemplates(void);

#endif // GUARD_BR_STRIP_H
