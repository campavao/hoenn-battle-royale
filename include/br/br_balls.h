#ifndef GUARD_BR_BALLS_H
#define GUARD_BR_BALLS_H

#include "global.h"

// What a ball on the ground holds, and its colour (Cam, 2026-10-13: "colour-coded: red =
// items, blue = TMs, gold = rare"). Moves come off the ground as well as the rung, so a
// quarter of the maps' own item balls hold a TM this match instead of what the
// cartridge put in them, dealt from the match seed so every ROM sees the same ones.
//
// The colour is a palette borrowed from the weather (br_balls.c, PaletteFor): the same
// picture under it for blue, the picture with its reds moved for gold. Route 111 and 120
// need that palette for their sandstorm and clouds, so their balls stay red. Gold is the
// strongest machines and the few items worth a detour; the maps' balls never deal it --
// it is for house caches.

#define BR_BALL_RED 0
#define BR_BALL_BLUE 1
#define BR_BALL_GOLD 2

struct ObjectEvent;
struct Sprite;

// What the map's item ball at this local id holds this match, given what its script says
// (`item`): that, or a TM dealt in its place.
u16 BrBalls_Deal(u8 mapGroup, u8 mapNum, u8 localId, u16 item);
u8 BrBalls_Tier(u16 item);
// An object's sprite was just made: an item ball worth more than an item is drawn blue or
// gold.
void BrBalls_Tint(struct ObjectEvent *obj, struct Sprite *sprite);

// The house caches: one ball a house, put down as we walk in and gone with us as we
// leave, until somebody takes it -- then gone for everybody (NoteTaken, on every PICKUP).
void BrBalls_Init(void);
void BrBalls_Tick(void);
void BrBalls_NoteTaken(u16 key);

#endif // GUARD_BR_BALLS_H
