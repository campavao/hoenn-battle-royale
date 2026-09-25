#ifndef GUARD_BR_FIELD_H
#define GUARD_BR_FIELD_H

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
// The page's field.ts carries the same four numbers; web/src/field.test.ts pins them
// against this header.

#define BR_VIEW_LEFT   0
#define BR_VIEW_TOP    40
#define BR_VIEW_RIGHT  16
#define BR_VIEW_BOTTOM 56

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
// and loot is owed up to BR_LOOT_SHARE of what is left before the ghosts take the rest.
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
