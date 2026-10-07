#ifndef GUARD_BR_FIELD_H
#define GUARD_BR_FIELD_H

#include "br/br_config.h"

// The picture past the LCD (POK-319). In the browser the emulator draws the field's BG
// and OBJ state onto a picture bigger than 240x160, from the same registers, so the map
// keeps going past the GBA's window. The ROM's part is small, because Emerald already
// keeps a ring of tiles around the camera (256x256 in pret, 32x32 tiles at BG1..3's
// tilemaps; 256x512 since POK-329, THE RING below) and object events two tiles past the
// screen:
//
//   * The LCD sits 40 rows below pos.y's top at rest (BG VOFS = 8 + the 32 of the
//     camera's standing vertical pan) and at column 0, so pret's 16x16 metatiles hold 40
//     rows above it, 56 below and 16 columns to the right. That is the whole 256-row
//     period of the hardware's 8-bit sprite y: the sprite window below.
//   * pret's slice redraws on a step draw rows pos.y..pos.y+14 and columns
//     pos.x..pos.x+14 only, so the ring's sixteenth column (and row, before POK-329) is
//     BR's to draw, when the step completes (THE RING).
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
// and the page asks the core for the window and for no more view than that, so a core,
// a ROM and a page from different deploys never disagree about the picture: a ROM
// without the symbol gets the legacy band, 0/40/16/56 with the window 40/56. Of the
// view the page asks only for the rows its layout shows past the LCD (web/src/field.ts
// askBand, measured before each boot): a desktop, or a phone on its side, shows none of
// them and gets the window alone; a portrait phone gets the whole view. The rows are
// the core's to draw and the page's to upload every frame, so a row nobody sees is not
// asked for.

// THE RING (POK-329). BG1..3 are 256x512 text BGs, so the ring is 32x64 tiles: 16
// metatile columns (pos.x .. pos.x+15, as pret's) and 32 metatile rows, pos.y -
// BR_RING_ABOVE .. pos.y + 31 - BR_RING_ABOVE. Grid row pos.y + dy lives in tile rows
// (yTileOffset + 2*dy) & 63, which is where pret keeps pos.y (dy 0) too, so the LCD sees
// the same tiles at the same scroll: VOFS is 9 bits now (yPixelOffset is a u16,
// field_camera.c) and at rest points at pos.y's slot + 40, as it did.
//
//   * pret's own draws stay exactly as they were -- rows pos.y..pos.y+15 on a whole-map
//     draw, row pos.y on a step up and pos.y+14 on a step down, column pos.x on a step
//     left and pos.x+14 on a step right, 16 metatiles each -- so every row the LCD can
//     show is drawn when pret draws it, from the map pret would read.
//   * The rest is BR's (BrField_RedrawSlices): a step up draws the new top row pos.y -
//     BR_RING_ABOVE at once, into the slot the old bottom row leaves (off every picture:
//     the view keeps one metatile of the ring spare below it). A step left draws the new
//     column's other 16 rows at once. A step down marks the new bottom row, and a step
//     right the far column pos.x+15 (32 rows): each goes into the slot the band's top
//     rows, or its left columns, show until the step completes, so BrField_Tick draws it
//     on that frame, not before (Cam's 2026-09-18 "jittering on the top left").
//   * The ring's other rows -- the BR_RING_ABOVE above pos.y and pos.y+15 down -- were
//     drawn from the map of their day, and a row drawn more than MAP_OFFSET past a map's
//     edge is border. So a whole-map draw and a map connection mark them stale, and
//     BrField_Tick redraws them, the nearest first, two rows a frame on the frames no
//     step draws: a whole-map draw costs pret's 256 metatiles on its frame, and the ring
//     is whole about eight frames later.

// Metatile rows of the ring above pos.y. The view's top may reach no further up than
// the ring does, and its bottom must leave the ring one row spare.
#define BR_RING_ABOVE 4
// Tile rows in the ring: 64, two screen blocks a layer.
#define BR_RING_TILE_ROWS 64
#define BR_RING_ROWS (BR_RING_TILE_ROWS / 2)

// The sprite window: rows above and below the LCD, 256 - 160 between them.
#define BR_SPRITE_TOP    40
#define BR_SPRITE_BOTTOM 56

// The view: what the core draws past the LCD on each side. Sideways it is the ring's 256
// columns, as it always was. Up and down it is the whole ring less the one spare row a
// step needs: its top is the ring's top at rest (BR_RING_ABOVE rows above pos.y, which
// the LCD's top sits 40 below), and its bottom leaves the ring's last row spare, so
// 160 + 104 + 232 = 496 rows, 31 of the ring's 32 -- at rest the player's rows -11 to +19.
// Past the sprite window the core draws only BG1..3 (512 rows) and the weather; the
// people out there are the page's (web/src/field.ts's overlay), since the ROM hides every
// sprite whose top leaves the window.
//
// Why 104 above and 232 below, not the same each way: a portrait phone puts the LCD high,
// above the pad, so it has much more field below the picture than above it. 390x844 with
// the pad (layoutField: scale 1.625, LCD at canvas row 118) shows 118 rows above and 242
// below; 390x763 (the installed app) 93 and 217; 390x664 (Safari) 63 and 186, and all
// but the first fit. With one ring row fewer above (BR_RING_ABOVE 3) 390x844 would be 30
// rows short at the top; with one more (5), 26 short at the bottom and 390x763 one.
#define BR_VIEW_LEFT   0
#define BR_VIEW_TOP    104
#define BR_VIEW_RIGHT  16
#define BR_VIEW_BOTTOM 232

STATIC_ASSERT(BR_SPRITE_TOP + BR_SPRITE_BOTTOM == 256 - DISPLAY_HEIGHT, BrSpriteWindowIsOneOamPeriod)
STATIC_ASSERT(BR_SPRITE_TOP % 8 == 0 && BR_SPRITE_BOTTOM % 8 == 0, BrSpriteWindowInEights)
STATIC_ASSERT(BR_VIEW_LEFT % 8 == 0 && BR_VIEW_TOP % 8 == 0 && BR_VIEW_RIGHT % 8 == 0 && BR_VIEW_BOTTOM % 8 == 0, BrViewInEights)
STATIC_ASSERT(BR_VIEW_TOP <= BR_SPRITE_TOP + 16 * BR_RING_ABOVE, BrViewTopInsideRing)
// ...and it is exactly the ring's top: every row the ring holds above pos.y is shown.
STATIC_ASSERT(BR_VIEW_TOP == BR_SPRITE_TOP + 16 * BR_RING_ABOVE, BrViewTopIsTheRingsTop)
// The view is the ring less one metatile row: the slot a step down fills when it lands.
STATIC_ASSERT(DISPLAY_HEIGHT + BR_VIEW_TOP + BR_VIEW_BOTTOM == 16 * BR_RING_ROWS - 16, BrViewIsTheRingLessOneRow)
// The core draws at most 256 rows on a side (hbr-exports.patch's _brClampBand).
STATIC_ASSERT(BR_VIEW_TOP <= 256 && BR_VIEW_BOTTOM <= 256 && BR_VIEW_LEFT <= 128 && BR_VIEW_RIGHT <= 128, BrViewTheCoreDraws)
// At rest the picture runs from pos.y's top + 40 - BR_VIEW_TOP down; mid-step up it is
// up to one metatile lower, and that row has to be in the ring too.
STATIC_ASSERT(BR_SPRITE_TOP + DISPLAY_HEIGHT + BR_VIEW_BOTTOM + 16 <= 16 * (BR_RING_ROWS - BR_RING_ABOVE), BrViewBottomInsideRing)
// pret's rows pos.y..pos.y+15 are ring rows; BrField_Tick's stale rows are one u32.
STATIC_ASSERT(BR_RING_ABOVE >= 0 && BR_RING_ABOVE + 16 <= BR_RING_ROWS, BrPretRowsInsideRing)
STATIC_ASSERT(BR_RING_ROWS == 32, BrRingRowsAreOneWord)

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
// Each layer's tilemap: two screen blocks, a 256x512 text BG (BGxCNT size 2).
#define BR_RING_SCREEN_SIZE 2
#define BR_RING_MAP_SIZE (2 * BG_SCREEN_SIZE)

STATIC_ASSERT(BR_FIELD_MAP_BASE_BG1 == BR_FIELD_MAP_BASE_BG2 + 2 && BR_FIELD_MAP_BASE_BG3 == BR_FIELD_MAP_BASE_BG1 + 2
    && BR_FIELD_MAP_BASE_BG0 == BR_FIELD_MAP_BASE_BG3 + 2, BrRingMapsTwoBlocksApart)
STATIC_ASSERT(BR_RING_MAP_SIZE <= 2 * BG_SCREEN_SIZE, BrRingMapFitsItsBlocks)
STATIC_ASSERT(BR_RING_MAP_SIZE == BR_RING_TILE_ROWS * 32 * 2, BrRingMapIsTheRing)

// InitOverworldBgs's tilemap buffers and where they go (src/overworld.c, `#if BR`): the
// three BR_RING_MAP_SIZE buffers, BG1..3's map bases above, and their 256x512 size.
void BrField_InitRingBgs(void);

// field_camera.c's ring, under `#if BR` (see THE RING above):
// DrawWholeMapViewInternal: pret's rows pos.y..pos.y+15, the rest marked stale.
void BrField_DrawWholeRing(void);
// MapPosToBgTilemapOffset: the tilemap index of grid cell (x, y)'s top-left tile, -1
// when it is not in the ring.
s32 BrField_RingOffset(u8 xTileOffset, u8 yTileOffset, s32 x, s32 y);
// RedrawMapSlicesForCameraUpdate: a step's slices, pret's and BR's (x, y as pret passes
// them: twice the step, in tiles).
void BrField_RedrawSlices(int x, int y);

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

// Every frame from CameraUpdate: the far row or column once its step has completed, and
// then stale rows (see THE RING above).
void BrField_Tick(void);
// The ring's rows not yet (re)drawn: bit (dy + BR_RING_ABOVE) is grid row pos.y + dy, and
// the top bit, mid-step down, the far row that waits for the landing. The page cuts the
// band's rows that fall in one off the picture (web/src/field.ts bandClip), so the few
// frames a whole-map draw or a map connection takes to redraw them show the composite's
// map, not the rows the last map left there -- its border, past MAP_OFFSET.
extern u32 gBrRingStale;
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
// event_object_movement.c, RemoveObjectEventIfOutsideView: a wanderer let go of stays on
// the tile it was let go on (2026-10-07 play-test: "npcs flashing on the screen when
// moving around ... when they'd be off screen"). The box ends 40 rows above the LCD and
// 72 below, inside a phone's field, and the page draws whoever the ROM lets go of from
// their template (web/src/field-ghosts.ts): a wanderer a tile from home jumped there as
// it went. Its template now says where it was, for the page and for the ROM's own
// respawn alike; BrField_KeepHome keeps his range round the home he had. Not covered: walkers on a fixed
// route (moving their home would break the route), the facing (the page draws a
// type's first one), and a man still out when you cross a connection and back (the
// map's templates are read afresh there).
void BrField_KeepWhereLeft(struct ObjectEvent *objectEvent);
// event_object_movement.c, InitObjectEventStateFromTemplate: a wanderer respawned from
// where BrField_KeepWhereLeft left him wanders round his old home, not round that spot.
void BrField_KeepHome(struct ObjectEvent *objectEvent);
// Tiles from the middle of the view, which is where the player stands (or the ghost a
// spectator rides): who gets a slot first when there are not enough.
u16 BrField_ViewDistance(s16 x, s16 y);
// Move the view by whole tiles at once, as walking would have moved it a tile at a
// time: map seams crossed and objects spawned and culled on the way, the map redrawn
// once at the end. The camera object is not touched; what it follows stays put on the
// map, and is that many tiles nearer the middle of the screen.
void BrField_MoveCamera(s16 dx, s16 dy);
// This frame's share of the object table: how many ghosts and how many pieces of loot
// may be up, the nearest first. BR's own spawns and despawns do not change it, so the
// two ticks agree whichever runs first.
void BrField_ShareObjects(u8 *ghosts, u8 *loot);

#endif // GUARD_BR_FIELD_H
