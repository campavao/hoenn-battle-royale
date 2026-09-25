// The picture past the LCD (POK-319). See include/br/br_field.h.
#include "global.h"
#include "main.h"
#include "overworld.h"
#include "palette.h"
#include "task.h"
#include "field_camera.h"
#include "field_weather.h"
#include "br/br_field.h"

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

void BrField_CancelLeave(void (*enter)(void))
{
    u8 taskId = FindTaskIdByFunc(Task_BrLeaveField);

    if (taskId != TASK_NONE && GetWordTaskArg(taskId, ENTER_ARG) == (u32)enter)
        DestroyTask(taskId);
}

#undef tState
#undef tTimer
#undef tFrames
#undef ENTER_ARG
