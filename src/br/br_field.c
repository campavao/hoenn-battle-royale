// The picture past the LCD (POK-319). See include/br/br_field.h.
#include "global.h"
#include "bg.h"
#include "main.h"
#include "malloc.h"
#include "overworld.h"
#include "palette.h"
#include "task.h"
#include "event_object_movement.h"
#include "fieldmap.h"
#include "field_camera.h"
#include "field_weather.h"
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
    gOverworldTilemapBuffer_Bg1 = AllocZeroed(BR_RING_MAP_SIZE);
    gOverworldTilemapBuffer_Bg2 = AllocZeroed(BR_RING_MAP_SIZE);
    gOverworldTilemapBuffer_Bg3 = AllocZeroed(BR_RING_MAP_SIZE);
    SetBgTilemapBuffer(1, gOverworldTilemapBuffer_Bg1);
    SetBgTilemapBuffer(2, gOverworldTilemapBuffer_Bg2);
    SetBgTilemapBuffer(3, gOverworldTilemapBuffer_Bg3);
    SetBgAttribute(1, BG_ATTR_MAPBASEINDEX, BR_FIELD_MAP_BASE_BG1);
    SetBgAttribute(2, BG_ATTR_MAPBASEINDEX, BR_FIELD_MAP_BASE_BG2);
    SetBgAttribute(3, BG_ATTR_MAPBASEINDEX, BR_FIELD_MAP_BASE_BG3);
    SetBgAttribute(1, BG_ATTR_SCREENSIZE, BR_RING_SCREEN_SIZE);
    SetBgAttribute(2, BG_ATTR_SCREENSIZE, BR_RING_SCREEN_SIZE);
    SetBgAttribute(3, BG_ATTR_SCREENSIZE, BR_RING_SCREEN_SIZE);
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

// Sideways the view's own columns (16 more for a sprite's width); up and down the sprite
// window, where a top has one reading -- past it the core would draw the sprite at the
// other end, however tall the view is.
bool8 BrField_OffScreen(s16 x, s16 x2, s16 y)
{
    if (x >= DISPLAY_WIDTH + BR_VIEW_RIGHT + 16 || x2 < -BR_VIEW_LEFT - 16)
        return TRUE;
    if (y >= DISPLAY_HEIGHT + BR_SPRITE_BOTTOM || y < -BR_SPRITE_TOP)
        return TRUE;
    return FALSE;
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

    switch (task->tState)
    {
    case 0:
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
#undef ENTER_ARG

// ---- object slots ------------------------------------------------------------------

bool8 BrField_InObjectView(s16 x, s16 y)
{
    return x >= gSaveBlock1Ptr->pos.x - 2 && x <= gSaveBlock1Ptr->pos.x + 17
        && y >= gSaveBlock1Ptr->pos.y && y <= gSaveBlock1Ptr->pos.y + 16;
}

void BrField_KeepWhereLeft(struct ObjectEvent *objectEvent)
{
    struct ObjectEventTemplate *t;
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
        {
            t->x = objectEvent->currentCoords.x - MAP_OFFSET;
            t->y = objectEvent->currentCoords.y - MAP_OFFSET;
            return;
        }
    }
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
    u8 i, room = 0, owed;

    // What BR could hold: every free slot and every slot it already holds.
    for (i = 0; i < OBJECT_EVENTS_COUNT; i++)
    {
        if (!gObjectEvents[i].active || BrGhosts_Insubstantial(gObjectEvents[i].localId))
            room++;
    }
    room = room > BR_NPC_HEADROOM ? room - BR_NPC_HEADROOM : 0;
    // The loot's share is what the ghosts close enough to engage leave of it. One of
    // those with no object is neither drawn nor challenged by us, though it is the lower
    // seat that challenges; a ball, even at our feet, can wait for a slot.
    owed = room > nearGhosts ? room - nearGhosts : 0;
    owed = min(min(wantLoot, BR_LOOT_SHARE), owed);
    *ghosts = min(min(wantGhosts, BR_MAX_GHOSTS), room - owed);
    *loot = min(min(wantLoot, BR_MAX_LOOT), room - *ghosts);
}
