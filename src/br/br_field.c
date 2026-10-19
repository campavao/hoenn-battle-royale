// The picture past the LCD (POK-319). See include/br/br_field.h.
#include "global.h"
#include "bg.h"
#include "main.h"
#include "malloc.h"
#include "overworld.h"
#include "palette.h"
#include "sprite.h"
#include "task.h"
#include "event_data.h"
#include "event_object_movement.h"
#include "fieldmap.h"
#include "script.h"
#include "field_camera.h"
#include "field_weather.h"
#include "br/br_event.h"
#include "br/br_field.h"
#include "br/br_ghosts.h"
#include "br/br_loot.h"

// THE RING (br_field.h): gBrRingStale's bits are the rows still to (re)draw. Its top bit
// is the far row, which a step down leaves there and which waits for the step to
// complete: until then its slot is the one the band's top rows show (the old top row, a
// row above the new one).
EWRAM_DATA u32 gBrRingStale = 0;
// A step right's far column, pos.x + 15, likewise: its slot is the band's left edge
// until the step completes.
static u8 sFarColumnPending;
// This frame's step drew its slices: stale rows wait for a frame with less to do.
static u8 sSliced;
// THE WIDE RING (br_field.h): the BGs are 512x256, latched by BrField_InitRingBgs. Its
// far row, pos.y+15, waits for a step down to complete the way the tall ring's far
// column does; its far column is gBrRingStale's top bit.
// The page reads the latch (gBrFieldWide) to know which ring its band clip reads.
EWRAM_DATA bool8 gBrFieldWide = FALSE;
static u8 sFarRowPending;

#define ROW_BIT(dy) (1u << ((dy) + BR_RING_ABOVE))
#define FAR_ROW (BR_RING_ROWS - 1 - BR_RING_ABOVE)
#define FAR_COLUMN 15
// Rows pos.y..pos.y+14: pret draws each one as it comes in, so they are never stale.
#define PRET_ROWS (ROW_BIT(15) - ROW_BIT(0))
// Every ring row.
#define ALL_ROWS 0xFFFFFFFFu
// Stale rows BrField_Tick draws a frame: 16 metatiles each, the cost of one of pret's
// slices.
#define ROWS_A_FRAME 2

// ---- THE WIDE RING ----

#define COLUMN_BIT(dx) (1u << ((dx) + BR_WIDE_LEFT))
#define FAR_WIDE_COLUMN (BR_WIDE_COLUMNS - 1 - BR_WIDE_LEFT)
#define FAR_WIDE_ROW 15
// Columns pos.x..pos.x+14: pret draws each one as it comes in.
#define PRET_COLUMNS (COLUMN_BIT(15) - COLUMN_BIT(0))

// Ring columns x0..x1-1 of ring rows y0..y1-1.
static void DrawCells(s16 x0, s16 x1, s16 y0, s16 y1)
{
    s16 x, y;

    for (y = y0; y < y1; y++)
    {
        for (x = x0; x < x1; x++)
            CurrentMapDrawMetatileAt(gSaveBlock1Ptr->pos.x + x, gSaveBlock1Ptr->pos.y + y);
    }
}

// The ring's columns past the far column while it waits: its slot is still the band's
// left edge.
static s16 WideRight(void)
{
    return (gBrRingStale & COLUMN_BIT(FAR_WIDE_COLUMN)) ? FAR_WIDE_COLUMN : FAR_WIDE_COLUMN + 1;
}

// The wide ring's column dx, and it is no longer stale. The far row's cell waits with it.
static void DrawWideColumn(s16 dx)
{
    DrawCells(dx, dx + 1, 0, sFarRowPending ? FAR_WIDE_ROW : 16);
    gBrRingStale &= ~COLUMN_BIT(dx);
}

// The stale column nearest the LCD, among `columns`: pos.x+15 and pos.x-1 first, then
// outwards. 0 when there is none (column 0 is pret's, never stale).
static s16 NearestStaleColumn(u32 columns)
{
    s16 k;

    for (k = 0; 15 + k <= FAR_WIDE_COLUMN || k < BR_WIDE_LEFT; k++)
    {
        if (15 + k <= FAR_WIDE_COLUMN && (columns & COLUMN_BIT(15 + k)))
            return 15 + k;
        if (k < BR_WIDE_LEFT && (columns & COLUMN_BIT(-1 - k)))
            return -1 - k;
    }
    return 0;
}

static s32 WideRingOffset(u8 xTileOffset, u8 yTileOffset, s32 x, s32 y)
{
    s32 tx;

    x -= gSaveBlock1Ptr->pos.x;
    y -= gSaveBlock1Ptr->pos.y;
    if (x < -BR_WIDE_LEFT || x > FAR_WIDE_COLUMN || y < 0 || y >= 16)
        return -1;
    tx = (xTileOffset + 2 * x) & 63;
    return ((tx & 32) << 5) + ((yTileOffset + 2 * y) & 31) * 32 + (tx & 31);
}

static void DrawWholeWideRing(void)
{
    DrawCells(0, 16, 0, 16);
    gBrRingStale = ALL_ROWS & ~(COLUMN_BIT(16) - COLUMN_BIT(0));
}

// pret's slices, then the wide ring's part of the step (br_field.h, THE WIDE RING).
static void RedrawWideSlices(int x, int y)
{
    u32 fresh = 0;

    if (x > 0)
    {
        DrawCells(14, 15, 0, 16);
        // Every column moves left one; the new far column waits for the step to complete.
        gBrRingStale = (gBrRingStale >> 1) | COLUMN_BIT(FAR_WIDE_COLUMN);
    }
    if (x < 0)
    {
        DrawCells(0, 1, 0, 16);
        // Every column moves right one, the far one out of the ring, and the new left
        // column goes into its slot now: nothing shows that slot.
        gBrRingStale <<= 1;
        DrawWideColumn(-BR_WIDE_LEFT);
        fresh = COLUMN_BIT(-BR_WIDE_LEFT);
    }
    if (y > 0)
    {
        DrawCells(0, 16, 14, 15);
        sFarRowPending = TRUE;
    }
    if (y < 0)
    {
        DrawCells(0, 16, 0, 1);
        // The rest of the new top row, now: its slot is the one spare row, below the band.
        DrawCells(-BR_WIDE_LEFT, 0, 0, 1);
        DrawCells(16, WideRight(), 0, 1);
    }
    gBrRingStale &= ~PRET_COLUMNS;
    if (gCamera.active)
        gBrRingStale |= ALL_ROWS & ~PRET_COLUMNS & ~fresh;
    sSliced = TRUE;
}

static void WideTick(void)
{
    s16 dx;
    u8 budget = ROWS_A_FRAME;
    u32 columns;

    if (sFarRowPending && gFieldCamera.y == 0)
    {
        sFarRowPending = FALSE;
        DrawCells(-BR_WIDE_LEFT, WideRight(), FAR_WIDE_ROW, FAR_WIDE_ROW + 1);
        budget = 0;
    }
    if ((gBrRingStale & COLUMN_BIT(FAR_WIDE_COLUMN)) && gFieldCamera.x == 0)
    {
        DrawWideColumn(FAR_WIDE_COLUMN);
        if (budget != 0)
            budget--;
    }
    if (sSliced)
    {
        sSliced = FALSE;
        return;
    }
    columns = gBrRingStale;
    if (gFieldCamera.x != 0)
        columns &= ~COLUMN_BIT(FAR_WIDE_COLUMN);
    for (; budget != 0; budget--)
    {
        dx = NearestStaleColumn(columns);
        if (dx == 0)
            break;
        DrawWideColumn(dx);
        columns &= ~COLUMN_BIT(dx);
    }
}

// ---- THE RING ----

// The ring's row dy, and it is no longer stale. The far column's cell waits with it.
static void DrawRingRow(s16 dy)
{
    int i;
    int n = sFarColumnPending ? FAR_COLUMN : 16;

    for (i = 0; i < n; i++)
        CurrentMapDrawMetatileAt(gSaveBlock1Ptr->pos.x + i, gSaveBlock1Ptr->pos.y + dy);
    gBrRingStale &= ~ROW_BIT(dy);
}

// All 32 rows of the ring's column dx.
static void DrawRingColumn(s16 dx)
{
    int i;

    for (i = -BR_RING_ABOVE; i < BR_RING_ROWS - BR_RING_ABOVE; i++)
        CurrentMapDrawMetatileAt(gSaveBlock1Ptr->pos.x + dx, gSaveBlock1Ptr->pos.y + i);
}

// The stale row nearest the LCD, among `rows`: pos.y+15 and pos.y-1 first, then
// outwards. 0 when there is none (row 0 is pret's, never stale).
static s16 NearestStaleRow(u32 rows)
{
    s16 k;

    for (k = 0; 15 + k <= FAR_ROW || k < BR_RING_ABOVE; k++)
    {
        if (15 + k <= FAR_ROW && (rows & ROW_BIT(15 + k)))
            return 15 + k;
        if (k < BR_RING_ABOVE && (rows & ROW_BIT(-1 - k)))
            return -1 - k;
    }
    return 0;
}

s32 BrField_RingOffset(u8 xTileOffset, u8 yTileOffset, s32 x, s32 y)
{
    if (gBrFieldWide)
        return WideRingOffset(xTileOffset, yTileOffset, x, y);
    x -= gSaveBlock1Ptr->pos.x;
    y -= gSaveBlock1Ptr->pos.y;
    if (x < 0 || x >= 16 || y < -BR_RING_ABOVE || y >= BR_RING_ROWS - BR_RING_ABOVE)
        return -1;
    return ((yTileOffset + 2 * y) & (BR_RING_TILE_ROWS - 1)) * 32 + ((xTileOffset + 2 * x) & 31);
}

// pret's whole-map draw, rows pos.y..pos.y+15, on its frame; the ring's other rows are
// stale, and BrField_Tick has them whole within about eight frames.
void BrField_DrawWholeRing(void)
{
    int i, j;

    if (gBrFieldWide)
    {
        DrawWholeWideRing();
        return;
    }
    for (i = 0; i < 16; i++)
    {
        for (j = 0; j < 16; j++)
            CurrentMapDrawMetatileAt(gSaveBlock1Ptr->pos.x + j, gSaveBlock1Ptr->pos.y + i);
    }
    gBrRingStale = ALL_ROWS & ~(ROW_BIT(16) - ROW_BIT(0));
}

// pret's four slices, in pret's order, each as pret draws it -- then BR's part of the
// step (br_field.h, THE RING).
void BrField_RedrawSlices(int x, int y)
{
    int i;
    u32 fresh = 0;

    if (gBrFieldWide)
    {
        RedrawWideSlices(x, y);
        return;
    }
    if (x > 0)
    {
        for (i = 0; i < 16; i++)
            CurrentMapDrawMetatileAt(gSaveBlock1Ptr->pos.x + 14, gSaveBlock1Ptr->pos.y + i);
        sFarColumnPending = TRUE;
    }
    if (x < 0)
    {
        for (i = 0; i < 16; i++)
            CurrentMapDrawMetatileAt(gSaveBlock1Ptr->pos.x, gSaveBlock1Ptr->pos.y + i);
        // The rest of the new column, now: its slot is the band's right edge, which
        // shows the column that just left until the step is done either way.
        for (i = -BR_RING_ABOVE; i < 0; i++)
            CurrentMapDrawMetatileAt(gSaveBlock1Ptr->pos.x, gSaveBlock1Ptr->pos.y + i);
        for (i = 16; i < BR_RING_ROWS - BR_RING_ABOVE; i++)
            CurrentMapDrawMetatileAt(gSaveBlock1Ptr->pos.x, gSaveBlock1Ptr->pos.y + i);
    }
    if (y > 0)
    {
        for (i = 0; i < 16; i++)
            CurrentMapDrawMetatileAt(gSaveBlock1Ptr->pos.x + i, gSaveBlock1Ptr->pos.y + 14);
        // Every row moves up one; the new bottom row waits for the step to complete.
        gBrRingStale = (gBrRingStale >> 1) | ROW_BIT(FAR_ROW);
    }
    if (y < 0)
    {
        for (i = 0; i < 16; i++)
            CurrentMapDrawMetatileAt(gSaveBlock1Ptr->pos.x + i, gSaveBlock1Ptr->pos.y);
        // Every row moves down one, the bottom one out of the ring, and the new top row
        // goes into its slot now: nothing shows that slot.
        gBrRingStale <<= 1;
        DrawRingRow(-BR_RING_ABOVE);
        fresh = ROW_BIT(-BR_RING_ABOVE);
    }
    gBrRingStale &= ~PRET_ROWS;
    // A map connection: the ring's rows past pret's were drawn from the last map, and
    // one more than MAP_OFFSET past its edge is its border, where this map may be.
    if (gCamera.active)
        gBrRingStale |= ALL_ROWS & ~PRET_ROWS & ~fresh;
    sSliced = TRUE;
}

void BrField_Tick(void)
{
    s16 dy;
    u8 budget = ROWS_A_FRAME;
    u32 rows;

    if (gBrFieldWide)
    {
        WideTick();
        return;
    }
    if (sFarColumnPending && gFieldCamera.x == 0)
    {
        sFarColumnPending = FALSE;
        DrawRingColumn(FAR_COLUMN);
        budget = 0;
    }
    if ((gBrRingStale & ROW_BIT(FAR_ROW)) && gFieldCamera.y == 0)
    {
        DrawRingRow(FAR_ROW);
        if (budget != 0)
            budget--;
    }
    if (sSliced)
    {
        sSliced = FALSE;
        return;
    }
    rows = gBrRingStale;
    if (gFieldCamera.y != 0)
        rows &= ~ROW_BIT(FAR_ROW);
    for (; budget != 0; budget--)
    {
        dy = NearestStaleRow(rows);
        if (dy == 0)
            break;
        DrawRingRow(dy);
        rows &= ~ROW_BIT(dy);
    }
}

// pret's six lines, with the map bases moved down and the maps twice as tall
// (br_field.h). InitBgsFromTemplates has just set BG1..3 to sOverworldBgTemplates'
// 29/28/30 at 256x256; this changes the base and the size, in the config every tilemap
// copy reads its destination and length from, before InitOverworldGraphicsRegisters
// schedules the first one -- so nothing is ever copied to the old blocks, and every copy
// is the whole 4 KB -- and its ShowBg writes them to BGxCNT.
void BrField_InitRingBgs(void)
{
    u8 size;

    gBrFieldWide = gBrFieldShown.left != 0;
    sFarRowPending = FALSE;
    sFarColumnPending = FALSE;
    size = gBrFieldWide ? BR_WIDE_SCREEN_SIZE : BR_RING_SCREEN_SIZE;
    gOverworldTilemapBuffer_Bg1 = AllocZeroed(BR_RING_MAP_SIZE);
    gOverworldTilemapBuffer_Bg2 = AllocZeroed(BR_RING_MAP_SIZE);
    gOverworldTilemapBuffer_Bg3 = AllocZeroed(BR_RING_MAP_SIZE);
    SetBgTilemapBuffer(1, gOverworldTilemapBuffer_Bg1);
    SetBgTilemapBuffer(2, gOverworldTilemapBuffer_Bg2);
    SetBgTilemapBuffer(3, gOverworldTilemapBuffer_Bg3);
    SetBgAttribute(1, BG_ATTR_MAPBASEINDEX, BR_FIELD_MAP_BASE_BG1);
    SetBgAttribute(2, BG_ATTR_MAPBASEINDEX, BR_FIELD_MAP_BASE_BG2);
    SetBgAttribute(3, BG_ATTR_MAPBASEINDEX, BR_FIELD_MAP_BASE_BG3);
    SetBgAttribute(1, BG_ATTR_SCREENSIZE, size);
    SetBgAttribute(2, BG_ATTR_SCREENSIZE, size);
    SetBgAttribute(3, BG_ATTR_SCREENSIZE, size);
}

// The picture the core is asked to draw, and the sprite window it reads OAM y against
// (POK-329): the page reads these twelve bytes out of the patched ROM before it boots
// the core. field-view.txt pins them.
const struct BrFieldView gBrFieldView =
{
    BR_VIEW_LEFT,
    BR_VIEW_TOP,
    BR_VIEW_RIGHT,
    BR_VIEW_BOTTOM,
    BR_SPRITE_TOP,
    BR_SPRITE_BOTTOM,
};

const struct BrFieldView gBrFieldViewWide =
{
    BR_WIDE_VIEW_LEFT,
    BR_WIDE_VIEW_TOP,
    BR_WIDE_VIEW_RIGHT,
    BR_WIDE_VIEW_BOTTOM,
    BR_SPRITE_TOP,
    BR_SPRITE_BOTTOM,
};

EWRAM_DATA struct BrFieldShown gBrFieldShown = {0};
EWRAM_DATA u8 gBrOamHi[BR_OAM_HI_SIZE] ALIGNED(2) = {0};
// Built with the OAM buffer. In IWRAM, which C-STYLE keeps for the engine, because EWRAM
// has no room for both copies: 64 bytes of the stack's headroom (tools/br/ram-headroom.py).
static u8 sOamHiNext[BR_OAM_HI_SIZE] ALIGNED(2);
static bool8 sOamMarking;
// BrField_InObjectView's room, and the frame it was counted on.
static u32 sRoomFrame;
static bool8 sRoomGrows;

// The rows past the LCD a sprite's top may be in and still be drawn: the rows the page
// shows, when its core reads the side table; the sprite window otherwise, where a top
// has one reading -- past it the core would draw the sprite at the other end.
static s16 ShownTop(void)
{
    return gBrFieldShown.top > BR_SPRITE_TOP ? min(gBrFieldShown.top, BR_VIEW_TOP) : BR_SPRITE_TOP;
}

static s16 ShownBottom(void)
{
    return gBrFieldShown.bottom > BR_SPRITE_BOTTOM ? min(gBrFieldShown.bottom, BR_VIEW_BOTTOM) : BR_SPRITE_BOTTOM;
}

// The columns beside the LCD likewise: the view's own 0 and 16, or the wide view's that
// the page shows (the core reads every marked sprite's left from the side table).
static s16 ShownLeft(void)
{
    return gBrFieldShown.left > BR_VIEW_LEFT ? min(gBrFieldShown.left, BR_WIDE_VIEW_LEFT) : BR_VIEW_LEFT;
}

static s16 ShownRight(void)
{
    return gBrFieldShown.right > BR_VIEW_RIGHT ? min(gBrFieldShown.right, BR_WIDE_VIEW_RIGHT) : BR_VIEW_RIGHT;
}

// Sideways the columns shown (16 more for a sprite's width); up and down the rows shown
// (ShownTop). Inside the sprite window a top has one reading, so it is the top that must
// stay in it; past the window the core reads every top from the side table, and a sprite
// is drawn while its bottom (y2) is still in the shown rows, as pret's own test.
bool8 BrField_OffScreen(s16 x, s16 x2, s16 y, s16 y2)
{
    if (x >= DISPLAY_WIDTH + ShownRight() + 16 || x2 < -ShownLeft() - 16)
        return TRUE;
    if (y >= DISPLAY_HEIGHT + ShownBottom())
        return TRUE;
    if (ShownTop() > BR_SPRITE_TOP)
        return y2 < -ShownTop();
    return y < -BR_SPRITE_TOP;
}

// Only the field's sprites are marked: a battle, a menu or a screen that writes the OAM
// itself keeps the hardware's reading of every top, and the sprite window's rule.
void BrField_OamClear(void)
{
    sOamMarking = BrField_OverworldRunning();
    CpuFill16(0, sOamHiNext, sizeof(sOamHiNext));
}

// A top outside -256..511 has no reading in two bits; -2 puts it 257 rows or more above
// the LCD, past any band.
void BrField_OamEntry(u8 index, const struct Sprite *sprite, s16 dx, s16 dy)
{
    s16 x = sprite->x + sprite->x2 + sprite->centerToCornerVecX + dx;
    s16 y = sprite->y + sprite->y2 + sprite->centerToCornerVecY + dy;
    s16 page;
    u8 nibble;

    // A sprite the ROM places on the screen itself, off the camera's offset (the weather's
    // grids: a column scrolled off the left kept as x & 0x1FF), is left unmarked: the core
    // reads its 9 bits as the hardware does, and repeats a grid's to cover the band.
    if (!sOamMarking || !sprite->coordOffsetEnabled)
        return;
    x += gSpriteCoordOffsetX;
    y += gSpriteCoordOffsetY;
    page = y >> 8;
    if (page < -1 || page > 1)
        page = -2;
    nibble = BR_OAM_HI_MARK | (page & 3);
    if (x < 0)
        nibble |= BR_OAM_HI_LEFT;
    sOamHiNext[index / 2] |= nibble << (4 * (index & 1));
}

// Off the field the table goes out empty, whether or not the screen built its OAM with
// BuildOamBuffer (save_failed_screen.c writes gMain.oamBuffer itself): the last field
// frame's marks never land on another screen's sprites.
void BrField_OamLatch(void)
{
    if (!BrField_OverworldRunning())
    {
        CpuFill16(0, gBrOamHi, sizeof(gBrOamHi));
    }
    else if (!gMain.oamLoadDisabled)
    {
        CpuCopy16(sOamHiNext, gBrOamHi, sizeof(gBrOamHi));
    }
}

// The slots BR could hold: every free one and every one it holds already. The same count
// shares the table out (BrField_ShareObjects) and sets the box BR's own are wanted in
// (BrField_InObjectView), so BR's ghosts and loot never shrink the box that let them in.
static u8 ObjectRoom(void)
{
    u8 i, n = 0;

    for (i = 0; i < OBJECT_EVENTS_COUNT; i++)
    {
        if (!gObjectEvents[i].active || BrGhosts_Ours(gObjectEvents[i].localId))
            n++;
    }
    return n;
}

// What is left of that once BR has what it wants in view: the room the map's people in
// the grown rows may have. A player beside you comes before a berry tree 15 rows off.
static u8 SpareRoom(void)
{
    u8 room = ObjectRoom();
    u8 want = BrEvent_Wanted() + min(BrGhosts_Wanted(), BR_MAX_GHOSTS) + min(BrLoot_Wanted(), BR_LOOT_SHARE);

    return room > want ? room - want : 0;
}

// pret's box runs 2 tiles past the sprite window's 40 rows above the LCD and its 56
// below (the player's rows -7..+9), and 2 columns past the view's 0 left of the LCD and
// its 16 right; each 16 rows or columns shown past those is one more.
static void Grow(s16 *left, s16 *right, s16 *top, s16 *bottom)
{
    *left -= (ShownLeft() - BR_VIEW_LEFT + 15) / 16;
    *right += (ShownRight() - BR_VIEW_RIGHT + 15) / 16;
    *top -= (ShownTop() - BR_SPRITE_TOP + 15) / 16;
    *bottom += (ShownBottom() - BR_SPRITE_BOTTOM + 15) / 16;
}

// The page shows rows past the sprite window, or columns past the view: there is a
// grown box at all. Without it (an old core) none of the counting below is done.
static bool8 Grows(void)
{
    return ShownTop() > BR_SPRITE_TOP || ShownBottom() > BR_SPRITE_BOTTOM
        || ShownLeft() > BR_VIEW_LEFT || ShownRight() > BR_VIEW_RIGHT;
}

// The grown rows are spare room. pret spawns its own box first, in template order, so
// the people at your feet have their slots before anyone farther off is asked about;
// then each person in the grown rows spawns only while BR_GROW_SPARE slots are spare past
// the headroom and what BR wants (SpareRoom), counted afresh for each. They are let go
// once the headroom itself is eaten into, and the gap between the two keeps a person on
// the edge from blinking out and back on every step.
void BrField_SpawnGrown(u8 count, s16 cameraX, s16 cameraY, BrSpawnTemplateFunc spawn)
{
    s16 pretLeft = gSaveBlock1Ptr->pos.x - 2;
    s16 pretRight = gSaveBlock1Ptr->pos.x + MAP_OFFSET_W + 2;
    s16 pretTop = gSaveBlock1Ptr->pos.y;
    s16 pretBottom = gSaveBlock1Ptr->pos.y + MAP_OFFSET_H + 2;
    s16 left = pretLeft, right = pretRight, top = pretTop, bottom = pretBottom;
    s16 x, y;
    u8 i;

    if (gMapHeader.events == NULL || !Grows())
        return;
    Grow(&left, &right, &top, &bottom);
    for (i = 0; i < count; i++)
    {
        struct ObjectEventTemplate *template = &gSaveBlock1Ptr->objectEventTemplates[i];

        x = template->x + MAP_OFFSET;
        y = template->y + MAP_OFFSET;
        if (y >= pretTop && y <= pretBottom && x >= pretLeft && x <= pretRight)
            continue; // pret's own box: spawned already, or not to be
        if (y < top || y > bottom || x < left || x > right || FlagGet(template->flagId))
            continue;
        if (SpareRoom() < BR_NPC_HEADROOM + BR_GROW_SPARE)
            return;
        spawn(template, gSaveBlock1Ptr->location.mapNum, gSaveBlock1Ptr->location.mapGroup, cameraX, cameraY);
    }
}

// The engine's cull, on a camera step: a ghost come into view since is room taken.
void BrField_GrowObjectBox(s16 *left, s16 *right, s16 *top, s16 *bottom)
{
    if (Grows() && SpareRoom() >= BR_NPC_HEADROOM)
        Grow(left, right, top, bottom);
}

// ---- leaving the field -----------------------------------------------------------

bool8 BrField_OverworldRunning(void)
{
    return gMain.callback2 == CB2_Overworld && !gMain.inBattle;
}

// ---- taking objects off the map (POK-328) ------------------------------------------

// What was asked off the map while the field was not running: local id and map, which
// is what the engine finds an object by. One per object slot is the most there can be
// -- only an object that is in the table is held, and never twice.
struct BrHeldObject
{
    u8 localId;
    u8 mapNum;
    u8 mapGroup;
};
static EWRAM_DATA struct BrHeldObject sHeld[OBJECT_EVENTS_COUNT] = {0};
static EWRAM_DATA u8 sHeldCount = 0;

static bool8 IsHeld(u8 localId, u8 mapNum, u8 mapGroup)
{
    u8 i;

    for (i = 0; i < sHeldCount; i++)
    {
        if (sHeld[i].localId == localId && sHeld[i].mapNum == mapNum && sHeld[i].mapGroup == mapGroup)
            return TRUE;
    }
    return FALSE;
}

// A map load took whatever it held; those have nothing left to remove.
static void DropGoneHeld(void)
{
    u8 i, kept = 0;

    for (i = 0; i < sHeldCount; i++)
    {
        if (GetObjectEventIdByLocalIdAndMap(sHeld[i].localId, sHeld[i].mapNum, sHeld[i].mapGroup) < OBJECT_EVENTS_COUNT)
            sHeld[kept++] = sHeld[i];
    }
    sHeldCount = kept;
}

bool8 BrField_RemoveObject(u8 localId, u8 mapNum, u8 mapGroup)
{
    if (GetObjectEventIdByLocalIdAndMap(localId, mapNum, mapGroup) >= OBJECT_EVENTS_COUNT)
        return FALSE;
    if (BrField_OverworldRunning())
    {
        RemoveObjectEventByLocalIdAndMap(localId, mapNum, mapGroup);
        return TRUE;
    }
    if (IsHeld(localId, mapNum, mapGroup))
        return FALSE;
    if (sHeldCount >= ARRAY_COUNT(sHeld))
        DropGoneHeld();
    if (sHeldCount >= ARRAY_COUNT(sHeld))
        return FALSE; // sixteen live objects all held: there is no seventeenth to hold
    sHeld[sHeldCount].localId = localId;
    sHeld[sHeldCount].mapNum = mapNum;
    sHeld[sHeldCount].mapGroup = mapGroup;
    sHeldCount++;
    return TRUE;
}

void BrField_RemoveHeld(void)
{
    u8 i;

    if (sHeldCount == 0 || !BrField_OverworldRunning())
        return;
    // By local id and map, not by slot: a map load in between leaves nothing to find,
    // and removes nothing it should not.
    for (i = 0; i < sHeldCount; i++)
        RemoveObjectEventByLocalIdAndMap(sHeld[i].localId, sHeld[i].mapNum, sHeld[i].mapGroup);
    sHeldCount = 0;
}

#define tState  data[0]
#define tTimer  data[1]
#define tFrames data[2]
#define tSettle data[5]
// enter() is a word in data[3] and data[4].
#define ENTER_ARG 3

// One errand, whichever screen it is for, and it used to be written six times. Its
// order is what those copies learned: the cleanup comes after the fade and before the
// next screen claims the heap (a replay that skipped it crashed the sound driver on
// agbcc), and nothing may start a second leave while one is fading (the duel's poll
// once stacked a start task a frame and entered CB2_InitBattle twice).
static void Task_BrLeaveField(u8 taskId)
{
    struct Task *task = &gTasks[taskId];

    // ...and locked again every frame until it goes: what it waits out (a dismount, a
    // fishing line) hands the controls back when it is done.
    if (task->tState < 3)
        LockPlayerFieldControls();
    switch (task->tState)
    {
    case 0:
        // Not out from under a step. A step off the water during MAP's fade started the
        // dismount jump, the field went mid-jump, and the way back rebuilt the avatar
        // from its sprite -- still the surfing one -- on a land tile: Cam surfing on land
        // (2026-10-18). The controls are locked from the leave on, so this is a step
        // already under way -- or one a dismount let start on the frame it handed the
        // controls back, before the re-lock above -- and a fishing line, which holds
        // preventStep until it is reeled in. A second at most either way.
        if ((gPlayerAvatar.preventStep || (ObjectEventIsMovementOverridden(&gObjectEvents[gPlayerAvatar.objectEventId])
                                            && !gObjectEvents[gPlayerAvatar.objectEventId].heldMovementFinished))
         && ++task->tSettle < 60)
            break;
        FadeScreen(FADE_TO_BLACK, 0);
        task->tState++;
        break;
    case 1:
        // With nothing to wait out, the cleanup is the very next frame, as it always
        // was: the frame a battle starts on moves its RNG.
        if (!gPaletteFade.active)
            task->tState = task->tFrames != 0 ? 2 : 3;
        break;
    case 2:
        if (++task->tTimer > task->tFrames)
            task->tState++;
        break;
    case 3:
        CleanupOverworldWindowsAndTilemaps();
        ((void (*)(void))GetWordTaskArg(taskId, ENTER_ARG))();
        DestroyTask(taskId);
        break;
    }
}

bool8 BrField_Leave(u8 frames, void (*enter)(void))
{
    u8 taskId;

    if (BrField_Leaving())
        return FALSE;
    // Every road off the field is a fade with the player still on it, and a start menu
    // entry has just given them the controls back (HideStartMenu): nothing starts a step now.
    LockPlayerFieldControls();
    taskId = CreateTask(Task_BrLeaveField, 80);
    gTasks[taskId].tFrames = frames;
    SetWordTaskArg(taskId, ENTER_ARG, (u32)enter);
    return TRUE;
}

bool8 BrField_Leaving(void)
{
    return FuncIsActiveTask(Task_BrLeaveField);
}

// The leave into enter(), if that is the one on its way out; TASK_NONE if not.
static u8 LeaveFor(void (*enter)(void))
{
    u8 taskId = FindTaskIdByFunc(Task_BrLeaveField);

    if (taskId != TASK_NONE && GetWordTaskArg(taskId, ENTER_ARG) != (u32)enter)
        taskId = TASK_NONE;
    return taskId;
}

bool8 BrField_LeavingFor(void (*enter)(void))
{
    return LeaveFor(enter) != TASK_NONE;
}

void BrField_CancelLeave(void (*enter)(void))
{
    u8 taskId = LeaveFor(enter);

    if (taskId != TASK_NONE)
        DestroyTask(taskId);
}

#undef tState
#undef tTimer
#undef tFrames
#undef tSettle
#undef ENTER_ARG

// ---- object slots ------------------------------------------------------------------

bool8 BrField_InObjectView(s16 x, s16 y)
{
    s16 left = gSaveBlock1Ptr->pos.x - 2;
    s16 right = gSaveBlock1Ptr->pos.x + 17;
    s16 top = gSaveBlock1Ptr->pos.y;
    s16 bottom = gSaveBlock1Ptr->pos.y + 16;

    // Asked for every seat, piece of loot and trader, many times a frame: the room is
    // counted once a frame, and BR's wants are not taken from it (they are what this
    // decides). The engine's own cull counts what is spare afresh (GrowObjectBox).
    if (sRoomFrame != gMain.vblankCounter1)
    {
        sRoomFrame = gMain.vblankCounter1;
        sRoomGrows = Grows() && ObjectRoom() >= BR_NPC_HEADROOM;
    }
    if (sRoomGrows)
        Grow(&left, &right, &top, &bottom);
    return x >= left && x <= right && y >= top && y <= bottom;
}

// The homes of the wanderers BrField_KeepWhereLeft has moved, by map and local id (0 is
// an empty entry: local ids start at 1). A respawn spawns where the man was left -- his
// template -- and wanders round his home, as pret's spawn would have him: the template
// alone would move the middle of his range too, a range a time (2026-10-07 review).
struct BrWanderHome
{
    u8 localId;
    u8 mapNum;
    u8 mapGroup;
    struct Coords16 home;
};

// A match strips every wandering person (br_strip.c): the wanderers it leaves are eight in
// the whole game (Route 119's house of six WINGULL, the Battle Palace corridor's AZURILL
// and WINGULL), so eight homes never let a live one go. It was 16, and gBrStripped took
// the EWRAM (2026-10-17).
#define BR_WANDER_HOMES 8
static EWRAM_DATA struct BrWanderHome sWanderHome[BR_WANDER_HOMES] = {0};
static EWRAM_DATA u8 sWanderNext = 0;

static struct BrWanderHome *WanderHomeOf(struct ObjectEvent *objectEvent)
{
    u8 i;

    for (i = 0; i < BR_WANDER_HOMES; i++)
    {
        if (sWanderHome[i].localId == objectEvent->localId
         && sWanderHome[i].mapNum == objectEvent->mapNum
         && sWanderHome[i].mapGroup == objectEvent->mapGroup)
            return &sWanderHome[i];
    }
    return NULL;
}

void BrField_KeepWhereLeft(struct ObjectEvent *objectEvent)
{
    struct ObjectEventTemplate *t;
    struct BrWanderHome *home;
    u8 i;

    switch (objectEvent->movementType)
    {
    case MOVEMENT_TYPE_WANDER_AROUND:
    case MOVEMENT_TYPE_WANDER_UP_AND_DOWN:
    case MOVEMENT_TYPE_WANDER_DOWN_AND_UP:
    case MOVEMENT_TYPE_WANDER_LEFT_AND_RIGHT:
    case MOVEMENT_TYPE_WANDER_RIGHT_AND_LEFT:
        break;
    default:
        return;
    }
    if (objectEvent->mapNum != gSaveBlock1Ptr->location.mapNum
     || objectEvent->mapGroup != gSaveBlock1Ptr->location.mapGroup)
        return;
    for (i = 0; i < OBJECT_EVENT_TEMPLATES_COUNT; i++)
    {
        t = &gSaveBlock1Ptr->objectEventTemplates[i];
        if (t->localId == objectEvent->localId)
            break;
    }
    if (i == OBJECT_EVENT_TEMPLATES_COUNT)
        return;
    // His home is the middle of the range he was spawned with: the map's, or the one
    // this kept for him at his last respawn (BrField_KeepHome).
    home = WanderHomeOf(objectEvent);
    if (home == NULL)
    {
        home = &sWanderHome[sWanderNext];
        sWanderNext = (sWanderNext + 1) % BR_WANDER_HOMES;
        home->localId = objectEvent->localId;
        home->mapNum = objectEvent->mapNum;
        home->mapGroup = objectEvent->mapGroup;
    }
    home->home = objectEvent->initialCoords;
    t->x = objectEvent->currentCoords.x - MAP_OFFSET;
    t->y = objectEvent->currentCoords.y - MAP_OFFSET;
}

void BrField_KeepHome(struct ObjectEvent *objectEvent)
{
    struct BrWanderHome *home = WanderHomeOf(objectEvent);

    if (home != NULL)
        objectEvent->initialCoords = home->home;
}

u16 BrField_ViewDistance(s16 x, s16 y)
{
    s16 dx = x - (gSaveBlock1Ptr->pos.x + MAP_OFFSET);
    s16 dy = y - (gSaveBlock1Ptr->pos.y + MAP_OFFSET);

    return (dx < 0 ? -dx : dx) + (dy < 0 ? -dy : dy);
}

void BrField_MoveCamera(s16 dx, s16 dy)
{
    s16 sx, sy;

    if (dx == 0 && dy == 0)
        return;
    while (dx != 0 || dy != 0)
    {
        sx = dx > 0 ? 1 : (dx < 0 ? -1 : 0);
        sy = sx != 0 ? 0 : (dy > 0 ? 1 : -1);
        // field_camera.c's MoveCameraAndRedrawMap, a tile at a time: CameraMove only
        // finds the connection it is crossing for a one-tile move.
        CameraMove(sx, sy);
        UpdateObjectEventsForCameraUpdate(sx, sy);
        gTotalCameraPixelOffsetX -= sx * 16;
        gTotalCameraPixelOffsetY -= sy * 16;
        dx -= sx;
        dy -= sy;
    }
    DrawWholeMapView();
}

// Ghosts and loot used to spawn wherever their cell was, in seat order, and again every
// frame after the engine culled them: twelve far ghosts held twelve slots at the very
// moment a route's trainers scrolling into view needed them, and those trainers were
// simply not there.
void BrField_ShareObjects(u8 *ghosts, u8 *loot)
{
    u8 wantGhosts = BrGhosts_Wanted();
    u8 nearGhosts = BrGhosts_WantedNear();
    u8 wantLoot = BrLoot_Wanted();
    u8 room = ObjectRoom(), owed;

    room = room > BR_NPC_HEADROOM ? room - BR_NPC_HEADROOM : 0;
    // An event's traders first: at most one or two on a map, and a person who blinks out
    // when a crowd walks by is not one you can trade with.
    owed = BrEvent_Wanted();
    room = room > owed ? room - owed : 0;
    // The loot's share is what the ghosts close enough to engage leave of it. One of
    // those with no object is neither drawn nor challenged by us, though it is the lower
    // seat that challenges; a ball, even at our feet, can wait for a slot.
    owed = room > nearGhosts ? room - nearGhosts : 0;
    owed = min(min(wantLoot, BR_LOOT_SHARE), owed);
    *ghosts = min(min(wantGhosts, BR_MAX_GHOSTS), room - owed);
    *loot = min(min(wantLoot, BR_MAX_LOOT), room - *ghosts);
}
