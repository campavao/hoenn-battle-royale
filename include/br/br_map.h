#ifndef GUARD_BR_MAP_H
#define GUARD_BR_MAP_H

#include "br/br_config.h"

// Looking at the fog (POK-263).
//
// The ring is the match's other clock and until now there was no way to read it: the
// HUD flashes FOG! when you are already in it, the ticker says a phase moved once, and
// that is the whole of it. Which way is in was something you worked out by walking
// until it stopped hurting.
//
// This is Kanto's rule (v0.24.0 drew the ring on the town map, v0.49.0 put a MAP row on
// the menu to open it): the same region map the drop uses (POK-223), opened from the
// START menu mid-match, with the ring's edge drawn on it and the eye marked. Nothing is
// chosen here -- A and B both close it -- which is what separates it from the picker.

struct BrMap
{
    /* 0 */ u8 active; // the map is open as a look, not as a pick
};

extern struct BrMap gBrMap;
extern const u8 gBrText_MenuMap[];
extern const u8 gBrText_TheFog[];

void BrMap_Init(void);
// TRUE while the region map is open to look at the fog rather than to drop into it.
bool8 BrMap_Looking(void);
// START menu's MAP row. TRUE when it took the press.
bool8 BrMap_Open(void);
// The map is closing: back to the field.
void BrMap_Close(void);

#endif // GUARD_BR_MAP_H
