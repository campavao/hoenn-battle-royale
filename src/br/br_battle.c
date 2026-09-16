// The shot clock and the RUN roll (POK-231). See include/br/br_battle.h.
#include "global.h"
#include "random.h"
#include "window.h"
#include "text.h"
#include "string_util.h"
#include "battle.h"
#include "constants/characters.h"
#include "br/br_battle.h"

EWRAM_DATA struct BrBattle gBrBattle = {0};

// The drawn clock: a small window that rides bg0's scroll so it sits at the top-right
// of the screen in both the action menu (bg0 scrolled 20 tiles) and the move menu (40).
#define CLK_LEFT 26
#define CLK_WIDTH 3
#define CLK_HEIGHT 2
#define CLK_BASEBLOCK 0x0110  // free bg0 tiles above B_WIN_YESNO, only shown then

static EWRAM_DATA u8 sClockWin = WINDOW_NONE;
static EWRAM_DATA u8 sClockTop = 0xFF;    // tilemapTop it was built at, 0xFF none
static EWRAM_DATA u8 sClockSecs = 0xFF;   // seconds last drawn

static bool8 ClockLive(void)
{
    return sClockWin != WINDOW_NONE
        && gWindows[sClockWin].tileData != NULL
        && gWindows[sClockWin].window.baseBlock == CLK_BASEBLOCK;
}

void BrBattle_HideClock(void)
{
    if (ClockLive())
    {
        ClearWindowTilemap(sClockWin);
        CopyWindowToVram(sClockWin, COPYWIN_MAP);
        RemoveWindow(sClockWin);
    }
    sClockWin = WINDOW_NONE;
    sClockTop = 0xFF;
    sClockSecs = 0xFF;
}

void BrBattle_DrawClock(void)
{
    u16 remain = BR_SHOT_CLOCK_FRAMES - gBrBattle.shotFrames;
    u8 secs = (remain + 59) / 60;              // ceil to seconds
    u8 top = gBattle_BG0_Y / 8;                // screen row 0 in bg0-tile space
    struct TextPrinterTemplate tp;
    u8 buf[4];

    if (!ClockLive() || sClockTop != top)
    {
        struct WindowTemplate t = {0};

        BrBattle_HideClock();
        t.bg = 0;
        t.tilemapLeft = CLK_LEFT;
        t.tilemapTop = top;
        t.width = CLK_WIDTH;
        t.height = CLK_HEIGHT;
        t.paletteNum = 5;   // the battle menu's own text palette, loaded and stable here
        t.baseBlock = CLK_BASEBLOCK;
        sClockWin = AddWindow(&t);
        sClockTop = top;
        sClockSecs = 0xFF;
    }
    if (sClockWin == WINDOW_NONE || secs == sClockSecs)
        return;

    FillWindowPixelBuffer(sClockWin, PIXEL_FILL(TEXT_COLOR_TRANSPARENT));
    ConvertIntToDecimalStringN(buf, secs, STR_CONV_MODE_RIGHT_ALIGN, 2);
    tp.currentChar = buf;
    tp.windowId = sClockWin;
    tp.fontId = FONT_SMALL;
    tp.x = tp.currentX = 0;
    tp.y = tp.currentY = 0;
    tp.letterSpacing = 0;
    tp.lineSpacing = 0;
    tp.unk = 0;
    // Palette 5's menu-text triple: dark digits with a light shadow, the healthbox
    // number look, over a transparent fill so only the digits sit on the sky.
    tp.fgColor = 13;
    tp.bgColor = TEXT_COLOR_TRANSPARENT;
    tp.shadowColor = 15;
    AddTextPrinter(&tp, TEXT_SKIP_DRAW, NULL);
    PutWindowTilemap(sClockWin);
    CopyWindowToVram(sClockWin, COPYWIN_FULL);
    sClockSecs = secs;
}

void BrBattle_Init(void)
{
    CpuFill32(0, &gBrBattle, sizeof(gBrBattle));
}

void BrBattle_ShotReset(void)
{
    gBrBattle.shotFrames = 0;
    gBrBattle.autoMove = FALSE;
}

bool8 BrBattle_TakeAutoMove(void)
{
    if (!gBrBattle.autoMove)
        return FALSE;
    gBrBattle.autoMove = FALSE;
    return TRUE;
}

bool8 BrBattle_ShotTick(void)
{
    if (gBrBattle.shotFrames < BR_SHOT_CLOCK_FRAMES)
    {
        gBrBattle.shotFrames++;
        return FALSE;
    }
    gBrBattle.shotFrames = 0;
    gBrBattle.timedOut++;
    return TRUE;
}

bool8 BrBattle_RollRun(void)
{
    gBrBattle.runRolls++;
    // The battle RNG is in step on both sides of a link battle, so both agree.
    if (Random() % 4 == 0)
    {
        gBrBattle.runEscapes++;
        return TRUE;
    }
    return FALSE;
}
