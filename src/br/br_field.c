// The picture past the LCD (POK-319). See include/br/br_field.h.
#include "global.h"
#include "main.h"
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

// The ring is 16x16 metatiles from gSaveBlock1Ptr->pos; CurrentMapDrawMetatileAt takes a
// map position and finds the ring slot itself (MapPosToBgTilemapOffset accepts +15).
//
// WHEN matters, because the ring is a torus and the band shows all of it. On a step
// down the tile offset advances on the step's first frame while the scroll lags it by
// 12, 8, 4 pixels, and the sixteenth slot -- (yTileOffset + 30) mod 32 -- is the slot
// the band's top 12 rows are still showing, the OLD pos.y row. Drawing pos.y+15 into it
// then puts the far row at the top of the band for three frames (Cam's 2026-09-18
// phone: "jittering on the top left, up, down, based on which way you're going"; a
// step right does the same to the picture's left 12 columns). So the slice redraw only
// marks the far slice, and it is drawn on the frame the step completes, when that
// slot is at the far edge and nowhere else.
static u8 sFarRowPending;
static u8 sFarColumnPending;

void BrField_MarkFarRow(void)
{
    sFarRowPending = TRUE;
}

void BrField_MarkFarColumn(void)
{
    sFarColumnPending = TRUE;
}

void BrField_Tick(void)
{
    int i;
    if (sFarRowPending && gFieldCamera.y == 0)
    {
        for (i = 0; i < 16; i++)
            CurrentMapDrawMetatileAt(gSaveBlock1Ptr->pos.x + i, gSaveBlock1Ptr->pos.y + 15);
        sFarRowPending = FALSE;
    }
    if (sFarColumnPending && gFieldCamera.x == 0)
    {
        for (i = 0; i < 16; i++)
            CurrentMapDrawMetatileAt(gSaveBlock1Ptr->pos.x + 15, gSaveBlock1Ptr->pos.y + i);
        sFarColumnPending = FALSE;
    }
}

bool8 BrField_OffScreen(s16 x, s16 x2, s16 y)
{
    if (x >= DISPLAY_WIDTH + BR_VIEW_RIGHT + 16 || x2 < -BR_VIEW_LEFT - 16)
        return TRUE;
    if (y >= DISPLAY_HEIGHT + BR_VIEW_BOTTOM || y < -BR_VIEW_TOP)
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

u16 BrField_ViewDistance(s16 x, s16 y)
{
    s16 dx = x - (gSaveBlock1Ptr->pos.x + MAP_OFFSET);
    s16 dy = y - (gSaveBlock1Ptr->pos.y + MAP_OFFSET);

    return (dx < 0 ? -dx : dx) + (dy < 0 ? -dy : dy);
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
