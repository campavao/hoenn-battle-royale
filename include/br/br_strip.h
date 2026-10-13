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
// nurse and the MART clerk (the only people who do something for you), MR. BRINEY and the
// ferry attendants (the boats still run, br_boot.c), item balls and berry trees, and the
// Pokemon and props. BR's own objects (loot, ghosts) are never the map's.
// tools/br/export-trainers.py applies the same rule for the page's trainer table.

// TRUE: this template never becomes an object on this map. Only in a match.
bool8 BrStrip_Stripped(const struct ObjectEventTemplate *template, u8 mapNum, u8 mapGroup);

#endif // GUARD_BR_STRIP_H
