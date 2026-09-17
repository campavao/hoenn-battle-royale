// The shot clock and the RUN roll (POK-231). See include/br/br_battle.h.
#include "global.h"
#include "random.h"
#include "window.h"
#include "text.h"
#include "string_util.h"
#include "battle.h"
#include "battle_main.h"
#include "main.h"
#include "constants/characters.h"
#include "br/br_mailbox.h"
#include "br/br_wire.h"
#include "br/br_wire_c.h"
#include "br/br_ghosts.h"
#include "br/br_netlink.h"
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
    if (ClockLive() && gBrNetlink.active)
    {
        u8 msg[2];

        msg[0] = gBrMySeat;
        msg[1] = 0; // the choice is made: the spectator's clock goes too
        BrWire_Send(BR_MSG_SHOT, msg, 2);
    }
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

    BrBattle_DrawClockSecs((u8)((remain + 59) / 60)); // ceil to seconds
}

void BrBattle_DrawClockSecs(u8 secs)
{
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
    // A spectator watches this number, not our menu: publish each second as it turns
    // over (and the 0 on the way out, from HideClock).
    if (gBrNetlink.active)
    {
        u8 msg[2];

        msg[0] = gBrMySeat;
        msg[1] = secs;
        BrWire_Send(BR_MSG_SHOT, msg, 2);
    }

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
}

// THE BAG IS NOT A HIDING PLACE (POK-292).
//
// Kanto's README: "The clock does not stop for an open bag: leave it open past the same
// thirty seconds and the bag closes itself." Ours stopped. BrBattle_ShotTick is called
// from the action menu and the move menu and from nowhere else, so a duellist who opened
// the BAG -- or the party screen the POKeMON row opens -- froze the clock for as long as
// they liked and held the other player there. A better stall than the one the clock was
// written to close.
//
// Counted here rather than inside those screens, because BrFrame runs every frame
// whatever is on top and neither screen is ours to edit. `callback2 != BattleMainCB2`
// while gMain.inBattle is exactly "a screen the battle put up is on top": the bag, the
// party menu, a summary over the party menu.
//
// Past the clock it puts B in the frame's keys, never A, so it can only ever back OUT
// and can never choose an item. BrFrame runs straight after ReadKeys and before the
// callback, which is what makes a synthetic press land.
//
// Link battles only: a bot fight, a wild one and the Safari are nobody else's time.
void BrBattle_TickStall(void)
{
    if (!gMain.inBattle
     || !(gBattleTypeFlags & BATTLE_TYPE_LINK)
     || gMain.callback2 == BattleMainCB2)
    {
        gBrBattle.stallFrames = 0;
        return;
    }
    if (gBrBattle.stallFrames < BR_SHOT_CLOCK_FRAMES)
    {
        gBrBattle.stallFrames++;
        return;
    }
    // Not back to zero: the next press is due in BR_BAG_BACKOUT_FRAMES, not in another
    // thirty seconds. And the menu this backs out to does not get a fresh clock either.
    gBrBattle.stallFrames = BR_SHOT_CLOCK_FRAMES - BR_BAG_BACKOUT_FRAMES;
    gBrBattle.stalled = TRUE;
    gMain.newKeys |= B_BUTTON;
    gMain.newAndRepeatedKeys |= B_BUTTON;
}

bool8 BrBattle_ShotTick(void)
{
    // A screen the battle put up already ran this turn's clock out (BrBattle_TickStall),
    // so coming back to the menu does not buy another thirty seconds -- otherwise the bag
    // is a hiding place you re-enter, and the clock never catches anybody.
    if (gBrBattle.stalled)
    {
        gBrBattle.stalled = FALSE;
        gBrBattle.shotFrames = 0;
        gBrBattle.timedOut++;
        return TRUE;
    }
    if (gBrBattle.shotFrames < BR_SHOT_CLOCK_FRAMES)
    {
        gBrBattle.shotFrames++;
        return FALSE;
    }
    gBrBattle.shotFrames = 0;
    gBrBattle.timedOut++;
    return TRUE;
}

// A POKe DOLL or nothing (POK-293).
//
// Cam: "should use poke doll, no random chance." The one-in-four roll this replaces made
// running a lottery you could keep entering, which is the worst of both -- it neither
// let you leave nor made you pay to. A doll is a decision: you bought it, you are
// spending it, and you are out of the fight. Without one the answer is simply no.
//
// Nothing is rolled here at all, so the two ROMs of a link battle cannot disagree: the
// doll was spent on the runner's own machine at selection and the fact of it rides in
// the action's return value, which both sides read.
bool8 BrBattle_TakeRun(bool8 doll)
{
    gBrBattle.runRolls++;
    if (!doll)
        return FALSE;
    gBrBattle.runEscapes++;
    return TRUE;
}
