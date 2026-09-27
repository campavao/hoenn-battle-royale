#ifndef GUARD_BR_FIELD_H
#define GUARD_BR_FIELD_H

#include "br/br_config.h"

// The picture past the LCD (POK-319). In the browser the emulator draws the field's BG
// and OBJ state onto a picture bigger than 240x160, from the same registers, so the map
// keeps going past the GBA's window. The ROM's part is small, because Emerald already
// keeps a 256x256 ring of tiles around the camera (32x32 tiles at BG1..3's tilemaps)
// and object events two tiles past the screen:
//
//   * The LCD sits at ring rows 40..199 at rest (BG VOFS = 8 + the 32 of the camera's
//     standing vertical pan) and columns 0..239, so the ring holds 40 rows above, 56
//     below and 16 columns to the right. That is the whole 256-row period of the
//     hardware's 8-bit sprite y, so the band is exactly one ring.
//   * The ring's sixteenth row and column are stale: the slice redraws on a step draw
//     rows pos.y..pos.y+14 and columns pos.x..pos.x+14 only. BrField_MarkFarRow and
//     BrField_MarkFarColumn note the sixteenth after a step down or right and BrField_Tick
//     draws it when the step completes (a step up or left rotates a fresh one in on its
//     own; drawing it earlier would paint over the slot still on screen).
//   * Emerald hides an object's sprite once it is 16 pixels past the LCD. The band's
//     sprites need their OAM y to be unambiguous -- 8 bits, so a top in [-40, 0) is
//     216..255 and a top in [160, 216) is 160..215 -- which is why BrField_OffScreen
//     keys on the sprite's TOP, not its bottom: a top below -40 would be read as a
//     row near the band's bottom. The page draws what the ROM hides (web/src/field.ts).
//
// POK-329 splits the band in two. The SPRITE WINDOW is those 256 rows of OAM y, and it
// stays 40/56 whatever the ring does: BrField_OffScreen keeps every sprite's top inside
// it, and the core reads each sprite's y against it. The VIEW is the band the core is
// asked to draw, which may run past the window once BG1..3 are 512 rows tall (the core
// draws only those, and the weather, out there). The ROM declares both in gBrFieldView
// and the page asks the core for exactly that, so a core, a ROM and a page from
// different deploys never disagree about the picture: a ROM without the symbol gets
// the legacy band, 0/40/16/56 with the window 40/56.

// Metatile rows of the ring above pos.y (the ring's top is pos.y - BR_RING_ABOVE):
// none yet. The view's top may reach no further up than the ring does.
#define BR_RING_ABOVE 0

// The sprite window: rows above and below the LCD, 256 - 160 between them.
#define BR_SPRITE_TOP    40
#define BR_SPRITE_BOTTOM 56

// The view: what the core draws past the LCD on each side. Set by hand until the ring
// is tall enough to feed more rows than the window.
#define BR_VIEW_LEFT   0
#define BR_VIEW_TOP    40
#define BR_VIEW_RIGHT  16
#define BR_VIEW_BOTTOM 56

STATIC_ASSERT(BR_SPRITE_TOP + BR_SPRITE_BOTTOM == 256 - DISPLAY_HEIGHT, BrSpriteWindowIsOneOamPeriod)
STATIC_ASSERT(BR_SPRITE_TOP % 8 == 0 && BR_SPRITE_BOTTOM % 8 == 0, BrSpriteWindowInEights)
STATIC_ASSERT(BR_VIEW_LEFT % 8 == 0 && BR_VIEW_TOP % 8 == 0 && BR_VIEW_RIGHT % 8 == 0 && BR_VIEW_BOTTOM % 8 == 0, BrViewInEights)
STATIC_ASSERT(BR_VIEW_TOP <= BR_SPRITE_TOP + 16 * BR_RING_ABOVE, BrViewTopInsideRing)

// Where the ring lives in VRAM (POK-329). pret puts BG2's tilemap at screen block 28,
// BG1's at 29 and BG3's at 30, one 2 KB block each, right under BG0's at 31. A 256x512
// ring needs two blocks a layer, so BrField_InitRingBgs moves them down to 25, 27 and 29
// -- pret's order, each with the block after it free to grow into -- and BG0 keeps 31.
// BG2's map at 25 (0x0600C800) is then the first thing past BG0's text tiles in char
// block 2 (0x06008000): tile 0x240 is their ceiling (br_hud.h), where it was 0x300.
#define BR_FIELD_MAP_BASE_BG2 25
#define BR_FIELD_MAP_BASE_BG1 27
#define BR_FIELD_MAP_BASE_BG3 29
// BG0's tilemap, sOverworldBgTemplates' (src/overworld.c): the blocks stop short of it.
#define BR_FIELD_MAP_BASE_BG0 31
// Each layer's tilemap: one screen block while the ring is 256x256.
#define BR_RING_MAP_SIZE BG_SCREEN_SIZE

STATIC_ASSERT(BR_FIELD_MAP_BASE_BG1 == BR_FIELD_MAP_BASE_BG2 + 2 && BR_FIELD_MAP_BASE_BG3 == BR_FIELD_MAP_BASE_BG1 + 2
    && BR_FIELD_MAP_BASE_BG0 == BR_FIELD_MAP_BASE_BG3 + 2, BrRingMapsTwoBlocksApart)
STATIC_ASSERT(BR_RING_MAP_SIZE <= 2 * BG_SCREEN_SIZE, BrRingMapFitsItsBlocks)

// InitOverworldBgs's tilemap buffers and where they go (src/overworld.c, `#if BR`): the
// three BR_RING_MAP_SIZE buffers, and BG1..3's map bases above.
void BrField_InitRingBgs(void);

// What the page reads out of the patched ROM before it boots the core (web/src/field.ts
// romBand), every field a u16. In ROM: it costs no RAM.
struct BrFieldView
{
    /* 0 */ u16 left;
    /* 2 */ u16 top;
    /* 4 */ u16 right;
    /* 6 */ u16 bottom;
    /* 8 */ u16 spriteTop;
    /* 10 */ u16 spriteBottom;
};
BR_OFFSET(BrFieldView, left, 0)
BR_OFFSET(BrFieldView, top, 2)
BR_OFFSET(BrFieldView, right, 4)
BR_OFFSET(BrFieldView, bottom, 6)
BR_OFFSET(BrFieldView, spriteTop, 8)
BR_OFFSET(BrFieldView, spriteBottom, 10)
BR_SIZE(BrFieldView, 12)

extern const struct BrFieldView gBrFieldView;

// A step down or right leaves the ring's sixteenth row or column stale: mark it, and
// BrField_Tick (every frame from CameraUpdate) draws it once the step has completed.
void BrField_MarkFarRow(void);
void BrField_MarkFarColumn(void);
void BrField_Tick(void);
// TRUE when a sprite whose top-left is (x, y) and right edge x2 is past the picture.
bool8 BrField_OffScreen(s16 x, s16 x2, s16 y);

// ---- leaving the field -----------------------------------------------------------

// The overworld with no battle over it: where every field tick does its work.
bool8 BrField_OverworldRunning(void);

// Every object BR takes off a map goes through here (POK-328). A battle -- or the bag,
// or any screen that is not the field -- leaves the object table standing and rebuilds
// the objects' sprites on the way back (SpawnObjectEventsOnReturnToField), so while it
// is up an object's spriteId is an old number, and the sprite under it is the other
// screen's. RemoveObjectEventByLocalIdAndMap destroys that sprite: an NPCOUT for a
// trainer on our map, heard mid-fight, took a battle sprite out from under the battle
// (sprites 1 and 2 at Route 102's action menu, npcout-in-battle.txt).
//
// So off the field the object is held -- left in the table, sprite and all -- and
// BrField_RemoveHeld takes it off on the first frame the field runs again, while the
// screen is still black from the way back. TRUE when the object is there and is gone
// or going; FALSE when there is no such object, or it is already on its way.
bool8 BrField_RemoveObject(u8 localId, u8 mapNum, u8 mapGroup);
// BrFrame, every frame, before the ticks that spawn: does nothing off the field.
void BrField_RemoveHeld(void);
// Leave the field for another screen (a battle, a replay, the fly map): fade to black,
// let the fade finish, wait `frames` more, hand the overworld's windows and tilemaps
// back before the next screen claims the heap, then enter(), which sets callback2.
// One at a time: FALSE, and nothing started, while another leave is still on its way
// out -- the caller has not left and keeps whatever it would have set.
bool8 BrField_Leave(u8 frames, void (*enter)(void));
// A leave has started and not yet entered.
bool8 BrField_Leaving(void);
// ...and it is the one into enter().
bool8 BrField_LeavingFor(void (*enter)(void));
// The leave into enter() stops where it is, if that is the one on its way out.
void BrField_CancelLeave(void (*enter)(void));

// ---- object slots (POK-330 #48) ----------------------------------------------------

// OBJECT_EVENTS_COUNT is 16, and the map's own people -- its trainers above all -- need
// theirs as they scroll into view. BR's ghosts and loot never take the last
// BR_NPC_HEADROOM free slots (and give theirs back when the map's people eat into them),
// and loot is owed up to BR_LOOT_SHARE of what is left before the ghosts take the rest
// -- after the ghosts within engage range, which cannot be challenged without one.
#define BR_NPC_HEADROOM 3
#define BR_LOOT_SHARE 2
// Inside the box RemoveObjectEventIfOutsideView keeps an object in (object coords,
// MAP_OFFSET included). The engine removes anything outside it on every camera step,
// so a ghost or a ball is spawned only in it.
bool8 BrField_InObjectView(s16 x, s16 y);
// Tiles from the middle of the view, which is where the player stands (or the ghost a
// spectator rides): who gets a slot first when there are not enough.
u16 BrField_ViewDistance(s16 x, s16 y);
// This frame's share of the object table: how many ghosts and how many pieces of loot
// may be up, the nearest first. BR's own spawns and despawns do not change it, so the
// two ticks agree whichever runs first.
void BrField_ShareObjects(u8 *ghosts, u8 *loot);

#endif // GUARD_BR_FIELD_H
