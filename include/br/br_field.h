#ifndef GUARD_BR_FIELD_H
#define GUARD_BR_FIELD_H

#include "br/br_config.h"

struct Sprite;

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
#define BR_RING_ABOVE 9
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
// 160 + 184 + 152 = 496 rows, 31 of the ring's 32 -- at rest the player's rows -16 to +14.
// Past the sprite window a core without the OAM side table (THE VIEW THE PAGE SHOWS,
// below) draws only BG1..3 (512 rows) and the weather, and the ROM hides every sprite
// whose top leaves the window; with it, the sprites are the core's too.
//
// Why 184 above and 152 below (POK-378): a portrait phone puts the LCD on the pad, so the
// ticker along its bottom is by the thumbs (Cam, 2026-10-17), and layoutField brings it
// down only as far as the band reaches above it. In a match the pad and dock are 282..309
// CSS px, so the LCD wants 174 rows down on 390x844 (scale 1.625), 124 on 390x763 (the
// installed app), 60 on 390x664 (Safari), 184 on 430x932 and 168 on 360x780: all of them
// fit under 184, which is nine ring rows above. Below it they want 176 to 192 rows, and
// the 152 left reach to the dock: the last 24 to 40 rows, the screen's bottom edge under
// PARTY / MAP / START, are the page's still map. At 104/232 the picture stopped 70 rows
// (114 CSS px) short of the pad on 390x844, and the 70 above it were the still map.
#define BR_VIEW_LEFT   0
#define BR_VIEW_TOP    184
#define BR_VIEW_RIGHT  16
#define BR_VIEW_BOTTOM 152

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

// THE WIDE RING (Cam, 2026-10-14: one phone's zoom on every screen). A screen wider than
// it is tall -- a desktop, a phone on its side -- shows far more map beside the LCD than
// above and below it, so there the same two blocks a layer are a 512x256 BG (BGxCNT size
// 1) and the ring is 64x32 tiles: 32 metatile columns, pos.x - BR_WIDE_LEFT ..
// pos.x + 31 - BR_WIDE_LEFT, and pret's 16 rows, pos.y .. pos.y+15. Grid cell
// (pos.x + dx, pos.y + dy) lives in tile column (xTileOffset + 2*dx) & 63, of which the
// low 32 are the first block and the high 32 the second, and tile row
// (yTileOffset + 2*dy) & 31. It is THE RING above turned on its side:
//
//   * pret's draws stay exactly as they were, in the 16 columns pos.x..pos.x+15.
//   * A step left draws the new left column's 16 rows at once, into the slot the old
//     right column leaves (off every picture: the wide view keeps one metatile column of
//     the ring spare right of it), and a step up the rest of its new top row. A step
//     right marks the far column pos.x + 31 - BR_WIDE_LEFT, and a step down the far row
//     pos.y+15 (all 32 columns): each goes into the slot the band's left columns, or its
//     top rows, show until the step completes, so BrField_Tick draws it on that frame.
//   * The ring's columns past pret's 15 are stale after a whole-map draw and a map
//     connection, and BrField_Tick redraws them, the nearest first, two columns a frame.
//     gBrRingStale's bits are columns then: bit (dx + BR_WIDE_LEFT).
//
// The page asks for the wide ring by writing the columns it shows left of the LCD into
// gBrFieldShown before the field's BGs are set up (BrField_InitRingBgs latches it, on
// every way into the field); a page that writes none gets THE RING.
#define BR_WIDE_LEFT 8
#define BR_WIDE_COLUMNS 32
#define BR_WIDE_SCREEN_SIZE 1
// The wide view: 128 columns each side, the ring less its one spare column (31 x 16 =
// 240 + 128 + 128), and 40 rows each side, pret's 16 rows less the one spare row a step
// needs (15 x 16 = 160 + 40 + 40). The LCD's left is pos.x's left, and its top 40 rows
// below pos.y's top, as in pret.
#define BR_WIDE_VIEW_LEFT   128
#define BR_WIDE_VIEW_TOP    40
#define BR_WIDE_VIEW_RIGHT  128
#define BR_WIDE_VIEW_BOTTOM 40

STATIC_ASSERT(BR_WIDE_COLUMNS == 32, BrWideColumnsAreOneWord)
STATIC_ASSERT(BR_WIDE_VIEW_LEFT == 16 * BR_WIDE_LEFT, BrWideViewLeftIsTheRingsLeft)
STATIC_ASSERT(DISPLAY_WIDTH + BR_WIDE_VIEW_LEFT + BR_WIDE_VIEW_RIGHT == 16 * BR_WIDE_COLUMNS - 16, BrWideViewIsTheRingLessOneColumn)
STATIC_ASSERT(BR_WIDE_VIEW_TOP == BR_SPRITE_TOP && DISPLAY_HEIGHT + BR_WIDE_VIEW_TOP + BR_WIDE_VIEW_BOTTOM == 16 * 16 - 16, BrWideViewIsPretsRowsLessOne)
STATIC_ASSERT(BR_WIDE_VIEW_LEFT <= 128 && BR_WIDE_VIEW_RIGHT <= 128, BrWideViewTheCoreDraws)
STATIC_ASSERT(BR_WIDE_VIEW_LEFT % 8 == 0 && BR_WIDE_VIEW_RIGHT % 8 == 0 && BR_WIDE_VIEW_BOTTOM % 8 == 0, BrWideViewInEights)

// InitOverworldBgs's tilemap buffers and where they go (src/overworld.c, `#if BR`): the
// three BR_RING_MAP_SIZE buffers, BG1..3's map bases above, and their size: 256x512, or
// 512x256 when the page shows columns left of the LCD (THE WIDE RING).
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
// ...and the wide ring's (THE WIDE RING), which the page asks for instead on a screen it
// covers more of.
extern const struct BrFieldView gBrFieldViewWide;

// ---- THE VIEW THE PAGE SHOWS ------------------------------------------------------
//
// Emerald's world is its window. An object exists only in a box about the LCD, a sprite
// is hidden 16 pixels past it, and the hardware's OAM y has 8 bits, so past the 256-row
// sprite window the core used to draw no sprite at all and the page drew imitations
// (web/src/field.ts's overlay, field-ghosts.ts). With the OAM side table the core draws
// every sprite at its true rows, so the ROM can keep its world as big as the picture the
// page shows: the page writes the rows it shows past the LCD into gBrFieldShown before
// the first frame (only when its core reads the table), and the ROM hides a sprite, and
// keeps an object, by those rows instead of the sprite window. 0, 0 is the old world.
// left and right are the columns it shows beside the LCD the same way: past the view's
// own 0 and 16 only with the wide ring, and left > 0 is what asks for that ring.
struct BrFieldShown
{
    /* 0 */ u16 top;
    /* 2 */ u16 bottom;
    /* 4 */ u16 left;
    /* 6 */ u16 right;
};
BR_OFFSET(BrFieldShown, top, 0)
BR_OFFSET(BrFieldShown, bottom, 2)
BR_OFFSET(BrFieldShown, left, 4)
BR_OFFSET(BrFieldShown, right, 6)
BR_SIZE(BrFieldShown, 8)

extern struct BrFieldShown gBrFieldShown;

// The OAM side table the patched core reads (hbr-exports.patch, brSetOamTable): a nibble
// an OAM entry, entry i in byte i / 2 (the low nibble for an even i). Bit 2 marks an entry
// the hooks below wrote; bits 0-1 are the 256s its true top is past its 8-bit y, signed
// (-2..1): the view runs 104 rows above the LCD to 232 below, so a top there is -1, 0 or 1
// 256s out. The core draws a marked entry once at its true rows, the LCD's included, and
// an unmarked one -- an OAM entry some screen writes for itself -- as it always did.
// Latched when the OAM is, so the band, drawn at VBlank before the next copy, reads what
// the hardware has.
// Bit 3 of a marked entry: its true left is its 9-bit x less 512 (left of the LCD), not
// the x itself -- the wide view runs 128 columns left of the LCD to 368 right of its left
// edge, which the hardware's reading (x past 255 is negative) cannot tell apart. Only
// sprites on the camera's offset are marked: one the ROM places on the screen itself (the
// weather's grids) is read as the hardware reads it.
#define BR_OAM_HI_SIZE 64
#define BR_OAM_HI_MARK 4
#define BR_OAM_HI_LEFT 8
extern u8 gBrOamHi[BR_OAM_HI_SIZE];
// sprite.c, BuildOamBuffer, once the OAM's own copy is held off: every entry unmarked.
void BrField_OamClear(void);
// sprite.c, as each OAM entry is written: the entry's true top-left is the sprite's own
// (as UpdateOamCoords puts it) moved by (dx, dy) -- a subsprite's offset, or 0, 0.
void BrField_OamEntry(u8 index, const struct Sprite *sprite, s16 dx, s16 dy);
// sprite.c, LoadOam: the table goes out with the OAM it describes.
void BrField_OamLatch(void);
// event_object_movement.c: pret's object box, grown by the rows the page shows past the
// sprite window and the columns it shows past the view's own. TrySpawnObjectEvents spawns
// pret's box and then BrField_SpawnGrown the grown cells, each person while BR_GROW_SPARE slots are spare past
// the headroom; RemoveObjectEventIfOutsideView and BrField_InObjectView keep the grown box
// while the headroom is. spawn is event_object_movement.c's TrySpawnObjectEventTemplate.
#define BR_GROW_SPARE 4
struct ObjectEventTemplate;
typedef u8 (*BrSpawnTemplateFunc)(const struct ObjectEventTemplate *, u8, u8, s16, s16);
void BrField_SpawnGrown(u8 count, s16 cameraX, s16 cameraY, BrSpawnTemplateFunc spawn);
void BrField_GrowObjectBox(s16 *left, s16 *right, s16 *top, s16 *bottom);

// Every frame from CameraUpdate: the far row or column once its step has completed, and
// then stale rows (see THE RING above).
void BrField_Tick(void);
// The ring's rows not yet (re)drawn: bit (dy + BR_RING_ABOVE) is grid row pos.y + dy, and
// the top bit, mid-step down, the far row that waits for the landing. The page cuts the
// band's rows that fall in one off the picture (web/src/field.ts bandClip), so the few
// frames a whole-map draw or a map connection takes to redraw them show the composite's
// map, not the rows the last map left there -- its border, past MAP_OFFSET. With the
// wide ring the bits are its columns, bit (dx + BR_WIDE_LEFT), the top one the far
// column mid-step right, and the page cuts columns.
extern u32 gBrRingStale;
// TRUE when the field's BGs are the wide ring (latched by BrField_InitRingBgs from
// gBrFieldShown.left): which ring gBrRingStale's bits are, for the page.
extern bool8 gBrFieldWide;
// TRUE when a sprite whose top-left is (x, y) and right edge x2 is past the picture.
bool8 BrField_OffScreen(s16 x, s16 x2, s16 y, s16 y2);

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
// moving around ... when they'd be off screen"). pret's box ends 40 rows above the LCD and
// 72 below, inside a phone's field (grown to the rows shown, while slots allow: THE VIEW
// THE PAGE SHOWS), and the page draws whoever the ROM lets go of from
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

// ---- THE WHOLE WINDOW (prototype, Cam 2026-10-20: "one layer") ----------------------

// The ring is as much map as the hardware's BGs hold. A core that can draw more (the
// page's own, tools/br/mgba-wasm/hbr-exports.patch) draws the rest of the window from
// the map itself: this map grid, these metatiles, the tiles and palettes in VRAM -- so
// whatever the field shows past the ring is the field the ROM is running, animated,
// layered the way DrawMetatile layers it, with nothing of the page's in it.
//
// FieldUpdateBgTilemapScroll writes it with the scroll it gives BG1..3. The grid pixel
// at the LCD's top-left is pos * 16 plus the scroll's distance from pos's ring slot,
// which a step leaves where it was (pos and the slot move together), so a core reading
// it at VBlank against the scroll registers it is drawing with -- the ones written the
// frame before -- moves it by the difference and has the picture's own origin.
struct BrWorld
{
    /* 0x00 */ u16 hofs;          // the BG1..3 scroll written with it
    /* 0x02 */ u16 vofs;
    /* 0x04 */ s32 lcdX;          // grid pixel (MAP_OFFSET included) at the LCD's top-left
    /* 0x08 */ s32 lcdY;
    /* 0x0C */ const struct MapLayout *layout;   // gMapHeader.mapLayout: border, tilesets
    /* 0x10 */ const struct BackupMapLayout *grid; // &gBackupMapLayout
    /* 0x14 */ void (*const *cb2)(void);         // &gMain.callback2: on the field while it is
    /* 0x18 */ void (*overworld)(void);          // CB2_Overworld
};
BR_OFFSET(BrWorld, hofs, 0x00)
BR_OFFSET(BrWorld, vofs, 0x02)
BR_OFFSET(BrWorld, lcdX, 0x04)
BR_OFFSET(BrWorld, lcdY, 0x08)
BR_OFFSET(BrWorld, layout, 0x0C)
BR_OFFSET(BrWorld, grid, 0x10)
BR_OFFSET(BrWorld, cb2, 0x14)
BR_OFFSET(BrWorld, overworld, 0x18)
BR_SIZE(BrWorld, 0x1C)
extern struct BrWorld gBrWorld;
// field_camera.c, FieldUpdateBgTilemapScroll: the scroll it writes, and the ring slot of
// pos it was written for.
void BrField_PublishWorld(u16 hofs, u16 vofs, u8 xTileOffset, u8 yTileOffset);

#endif // GUARD_BR_FIELD_H
