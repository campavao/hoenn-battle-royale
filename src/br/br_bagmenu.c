// A trainer's bag on the field: POKeMON or BAG, and the BAG's list. See include/br/br_bagmenu.h.
#include "global.h"
#include "event_object_lock.h"
#include "international_string_util.h"
#include "item.h"
#include "main.h"
#include "menu.h"
#include "palette.h"
#include "script.h"
#include "sound.h"
#include "string_util.h"
#include "task.h"
#include "text.h"
#include "text_window.h"
#include "window.h"
#include "constants/items.h"
#include "constants/songs.h"
#include "br/br_bagmenu.h"
#include "br/br_field.h"
#include "br/br_loot.h"
#include "br/br_netlink.h"

// The spoils box's frame and tiles (br_loot.c): the HUD's copy of the standard frame in
// the palette nothing on the field loads over, and BG0 tiles from 0x008, clear of the
// HUD's (br_hud.h's tile map), which yields to a box over it on its own.
#define BR_BAGMENU_FRAME 0x214
#define BR_BAGMENU_FRAME_PALETTE 13
#define BR_BAGMENU_TILES 0x008
#define BR_BAGMENU_ROWS 8 // a GIVE's most (br_loot.c's HandleGive)
// A third of a second before a press counts: the box opens under thumbs still on A.
#define BR_BAGMENU_DEAF_FRAMES 20

#define tWin   data[0]
#define tTimer data[1]
#define tKey   data[2]

static const u8 sText_Pokemon[] = _("POKéMON");
static const u8 sText_Bag[] = _("BAG");
static const u8 sText_TakeAll[] = _("TAKE ALL");

// The list's rows, the GIVE's layout. IWRAM: EWRAM has no byte to spare.
static u8 sRows[BR_BAGMENU_ROWS * 3];
static u8 sRowCount;

static void Task_Choose(u8 taskId);
static void Task_List(u8 taskId);

// By its task, not a flag: a battle's ResetTasks takes the box without closing it.
bool8 BrBagMenu_Up(void)
{
    return FuncIsActiveTask(Task_Choose) || FuncIsActiveTask(Task_List);
}

// What closes a box without a pick: the field going, a challenge on its way, a script.
static bool8 Interrupted(void)
{
    return !BrField_OverworldRunning() || gBrNetlink.pendingPeer != 0xFF || ScriptContext_IsEnabled()
        || BrField_Leaving();
}

// At tile row `top`: the list's eight items and TAKE ALL are eighteen rows, and with the
// frame round them that is the whole screen from row 0.
static u8 OpenBox(u8 width, u8 rows, u8 top)
{
    struct WindowTemplate t = { 0, 1, 2, 0, 0, 15, BR_BAGMENU_TILES };
    u8 win;

    t.tilemapTop = top;
    t.width = width;
    t.height = 2 * rows;
    win = AddWindow(&t);
    if (win == WINDOW_NONE)
        return WINDOW_NONE;
    LoadUserWindowBorderGfxOnBg(0, BR_BAGMENU_FRAME, BG_PLTT_ID(BR_BAGMENU_FRAME_PALETTE));
    DrawStdFrameWithCustomTileAndPalette(win, FALSE, BR_BAGMENU_FRAME, BR_BAGMENU_FRAME_PALETTE);
    FillWindowPixelBuffer(win, PIXEL_FILL(TEXT_COLOR_WHITE));
    return win;
}

static void CloseBox(u8 taskId)
{
    s16 *data = gTasks[taskId].data;

    // Gone with the field: its teardown freed the window, and the id may be the next
    // screen's by now (br_loot.c's CloseSpoils).
    if (BrField_OverworldRunning())
    {
        ClearStdWindowAndFrameToTransparent(tWin, TRUE);
        RemoveWindow(tWin);
        if (!ScriptContext_IsEnabled() && !BrField_Leaving())
            UnlockPlayerFieldControls();
    }
    DestroyTask(taskId);
}

// ---- POKeMON / BAG ------------------------------------------------------------------

static void Task_Choose(u8 taskId)
{
    s16 *data = gTasks[taskId].data;
    s8 pick;
    u16 key = (u16)tKey;

    if (Interrupted())
    {
        CloseBox(taskId);
        return;
    }
    if (++tTimer < BR_BAGMENU_DEAF_FRAMES)
        return;
    pick = Menu_ProcessInputNoWrap();
    if (pick == MENU_NOTHING_CHOSEN)
        return;
    CloseBox(taskId);
    if (pick != MENU_B_PRESSED)
        BrLoot_BagChosen(key, (u8)pick);
}

void BrBagMenu_Choose(u16 key)
{
    u8 taskId;
    s16 *data;

    if (BrBagMenu_Up())
        return;
    taskId = CreateTask(Task_Choose, 80);
    data = gTasks[taskId].data;
    tWin = OpenBox(8, 2, 2);
    if (tWin == WINDOW_NONE)
    {
        DestroyTask(taskId);
        return;
    }
    tTimer = 0;
    tKey = (s16)key;
    LockPlayerFieldControls();
    AddTextPrinterParameterized(tWin, FONT_NORMAL, sText_Pokemon, 8, 1, TEXT_SKIP_DRAW, NULL);
    AddTextPrinterParameterized(tWin, FONT_NORMAL, sText_Bag, 8, 17, TEXT_SKIP_DRAW, NULL);
    InitMenuNormal(tWin, FONT_NORMAL, 0, 1, 16, 2, 0);
    CopyWindowToVram(tWin, COPYWIN_FULL);
}

// ---- the BAG's list -------------------------------------------------------------------

#define LIST_WIDTH 14

static void DrawList(u8 taskId, u8 cursor)
{
    s16 *data = gTasks[taskId].data;
    u8 line[32];
    u8 *p;
    u8 i;

    FillWindowPixelBuffer(tWin, PIXEL_FILL(TEXT_COLOR_WHITE));
    AddTextPrinterParameterized(tWin, FONT_NORMAL, sText_TakeAll, 8, 1, TEXT_SKIP_DRAW, NULL);
    for (i = 0; i < sRowCount; i++)
    {
        const u8 *row = sRows + 3 * i;

        AddTextPrinterParameterized(tWin, FONT_NORMAL, GetItemName(row[0] | (row[1] << 8)), 8, 17 + 16 * i,
                                    TEXT_SKIP_DRAW, NULL);
        line[0] = CHAR_MULT_SIGN;
        p = ConvertIntToDecimalStringN(line + 1, row[2], STR_CONV_MODE_LEFT_ALIGN, 2);
        *p = EOS;
        AddTextPrinterParameterized(tWin, FONT_NORMAL, line,
                                    GetStringRightAlignXOffset(FONT_NORMAL, line, LIST_WIDTH * 8 - 2), 17 + 16 * i,
                                    TEXT_SKIP_DRAW, NULL);
    }
    InitMenuNormal(tWin, FONT_NORMAL, 0, 1, 16, 1 + sRowCount, cursor);
    CopyWindowToVram(tWin, COPYWIN_FULL);
}

// Row `i` into the bag, whole. FALSE when its pocket has no room; the row stays.
static bool8 TakeRow(u8 i)
{
    u8 j;

    if (!AddBagItem(sRows[3 * i] | (sRows[3 * i + 1] << 8), sRows[3 * i + 2]))
        return FALSE;
    for (j = 3 * i; j + 3 < 3 * sRowCount; j++)
        sRows[j] = sRows[j + 3];
    sRowCount--;
    return TRUE;
}

static void CloseList(u8 taskId)
{
    CloseBox(taskId);
    BrLoot_BagListed(sRows, sRowCount); // what is left goes back down as the bag it was
}

static void Task_List(u8 taskId)
{
    s16 *data = gTasks[taskId].data;
    s8 pick;
    u8 i;
    bool8 full = FALSE;

    if (Interrupted())
    {
        CloseList(taskId);
        return;
    }
    if (++tTimer < BR_BAGMENU_DEAF_FRAMES)
        return;
    pick = Menu_ProcessInputNoWrap();
    if (pick == MENU_NOTHING_CHOSEN)
        return;
    if (pick == MENU_B_PRESSED)
    {
        CloseList(taskId);
        return;
    }
    if (pick == 0)
    {
        for (i = 0; i < sRowCount;)
        {
            if (TakeRow(i))
                continue;
            full = TRUE;
            i++;
        }
    }
    else if (!TakeRow(pick - 1))
    {
        full = TRUE;
    }
    PlaySE(full ? SE_FAILURE : SE_SELECT);
    if (sRowCount == 0)
    {
        CloseList(taskId);
        return;
    }
    DrawList(taskId, pick > sRowCount ? sRowCount : pick);
}

void BrBagMenu_List(const u8 *rows, u8 count)
{
    u8 taskId, i;
    s16 *data;

    if (count > BR_BAGMENU_ROWS)
        count = BR_BAGMENU_ROWS;
    for (i = 0; i < 3 * count; i++)
        sRows[i] = rows[i];
    sRowCount = count;
    taskId = CreateTask(Task_List, 80);
    data = gTasks[taskId].data;
    tWin = OpenBox(LIST_WIDTH, 1 + count, 1);
    if (tWin == WINDOW_NONE)
    {
        DestroyTask(taskId);
        BrLoot_BagListed(sRows, sRowCount);
        return;
    }
    tTimer = 0;
    LockPlayerFieldControls();
    DrawList(taskId, 0);
}
