// The picture past the LCD (POK-319). See include/br/br_field.h.
#include "global.h"
#include "field_camera.h"
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
