// The picture past the LCD (POK-319). See include/br/br_field.h.
#include "global.h"
#include "field_camera.h"
#include "br/br_field.h"

// The ring is 16x16 metatiles from gSaveBlock1Ptr->pos; CurrentMapDrawMetatileAt takes a
// map position and finds the ring slot itself (MapPosToBgTilemapOffset accepts +15).
void BrField_DrawFarRow(void)
{
    int i;
    for (i = 0; i < 16; i++)
        CurrentMapDrawMetatileAt(gSaveBlock1Ptr->pos.x + i, gSaveBlock1Ptr->pos.y + 15);
}

void BrField_DrawFarColumn(void)
{
    int i;
    for (i = 0; i < 16; i++)
        CurrentMapDrawMetatileAt(gSaveBlock1Ptr->pos.x + 15, gSaveBlock1Ptr->pos.y + i);
}

bool8 BrField_OffScreen(s16 x, s16 x2, s16 y)
{
    if (x >= DISPLAY_WIDTH + BR_VIEW_RIGHT + 16 || x2 < -BR_VIEW_LEFT - 16)
        return TRUE;
    if (y >= DISPLAY_HEIGHT + BR_VIEW_BOTTOM || y < -BR_VIEW_TOP)
        return TRUE;
    return FALSE;
}
