// Looking at the fog (POK-263). See include/br/br_map.h.
#include "global.h"
#include "main.h"
#include "overworld.h"
#include "task.h"
#include "palette.h"
#include "field_screen_effect.h"
#include "field_weather.h"
#include "constants/field_weather.h"
#include "region_map.h"
#include "br/br_match.h"
#include "br/br_pick.h"
#include "br/br_map.h"

EWRAM_DATA struct BrMap gBrMap = {0};

// The START menu row, and the prompt over the map once it is open.
const u8 gBrText_MenuMap[] = _("MAP");
const u8 gBrText_TheFog[] = _("The FOG.");

void BrMap_Init(void)
{
    gBrMap.active = FALSE;
}

bool8 BrMap_Looking(void)
{
    return gBrMap.active;
}

void BrMap_Close(void)
{
    gBrMap.active = FALSE;
}

#define tState data[0]
#define tTimer data[1]

// Task_BrPick's shape, and for the same reason: the fly map wants the overworld's
// windows and tilemaps cleaned up before it takes the screen.
static void Task_BrMap(u8 taskId)
{
    struct Task *task = &gTasks[taskId];

    switch (task->tState)
    {
    case 0:
        FadeScreen(FADE_TO_BLACK, 0);
        task->tState++;
        break;
    case 1:
        if (!gPaletteFade.active)
            task->tState++;
        break;
    case 2:
        if (++task->tTimer > 20)
            task->tState++;
        break;
    case 3:
        CleanupOverworldWindowsAndTilemaps();
        gMain.state = 0;
        SetMainCallback2(CB2_OpenFlyMap);
        DestroyTask(taskId);
        break;
    }
}

#undef tState
#undef tTimer

bool8 BrMap_Open(void)
{
    // Not while the drop's own picker is up, and not before there is a match to look
    // at: the map outside one is Emerald's, and it belongs to Emerald.
    if (gBrMap.active || BrPick_Picking() || gBrMatch.phase != BR_PHASE_PLAY)
        return FALSE;
    if (gMain.callback2 != CB2_Overworld || gMain.inBattle)
        return FALSE;
    gBrMap.active = TRUE;
    CreateTask(Task_BrMap, 80);
    return TRUE;
}
