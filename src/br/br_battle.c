// The shot clock and the RUN roll (POK-231). See include/br/br_battle.h.
#include "global.h"
#include "random.h"
#include "window.h"
#include "text.h"
#include "string_util.h"
#include "battle.h"
#include "battle_main.h"
#include "battle_anim.h"
#include "battle_interface.h"
#include "battle_controllers.h"
#include "battle_util.h"
#include "main.h"
#include "pokemon.h"
#include "recorded_battle.h"
#include "constants/characters.h"
#include "constants/items.h"
#include "br/br_mailbox.h"
#include "br/br_wire.h"
#include "br/br_wire_c.h"
#include "br/br_ghosts.h"
#include "br/br_netlink.h"
#include "br/br_battle.h"

EWRAM_DATA struct BrBattle gBrBattle = {0};
// The party slot, and move, the last bag item in this battle went to (PARTY_SIZE: none),
// and which item that was.
static EWRAM_DATA u8 sItemSlot = 0;
static EWRAM_DATA u8 sItemMove = 0;
static EWRAM_DATA u16 sItemNoted = 0;

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
    sItemSlot = PARTY_SIZE;
    sItemMove = 0;
    sItemNoted = ITEM_NONE;
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

// ---- the record a spectator replays (POK-330 #12) ------------------------------------

// A replay of our link battle is a RECORDED_LINK one, and Emerald bans the bag in those
// too: the ban wrote 0xFF over the replay's own read cursor, and the replay waited on it
// for good the first time a fighter drank a potion.
bool8 BrBattle_ItemsAllowed(void)
{
    return gBrNetlink.active || RecordedBattle_IsSpectateLive();
}

// RUN's kind rides in its return value (BR_RUN_*), and the replay's RUN is decided by the
// same byte: a DOLL gets away, a forfeit loses, nothing is "Can't escape!".
void BrBattle_RecordChoice(u8 battler)
{
    if (gBattleBufferB[battler][1] == B_ACTION_RUN)
        RecordedBattle_SetBattlerAction(battler, gBattleBufferB[battler][2]);
}

void BrBattle_NoteItemTarget(u16 item, u8 partyIndex, u8 moveIndex)
{
    if (!gMain.inBattle)
        return;
    sItemNoted = item;
    sItemSlot = partyIndex;
    sItemMove = moveIndex;
}

// ---- the bag in a link battle (POK-331 #7) --------------------------------------------
//
// A bag item is used where it is chosen: the party menu puts the POTION on the mon, on the
// chooser's own ROM, and all the engine's player branch does with it later is nothing. The
// other ROM heard only "item 13" and ran the opponent's branch, which does what the AI's
// item type says -- nothing, for a person. So a challenged player's potion never reached
// the challenger's engine, whose HP is the one every move is dealt against: healed on one
// screen, not on the other, and wasted. And a challenger's jammed the link for good (see
// BrBattle_AfterItemHeal).
//
// Now the return value says whom the item went to, and each ROM uses the other trainer's
// item on its own copy of their mon as the choice arrives -- the same call on the same
// data, so the two copies agree, and on the challenger's ROM that copy is the engine's.

void BrBattle_EmitItemChoice(u16 item)
{
    u8 ret[4];
    u8 i;

    ret[0] = CONTROLLER_ONERETURNVALUE;
    ret[1] = item;
    ret[2] = (item & 0xFF00) >> 8;
    // Only a note made for this item: one tried on a mon it would do nothing for, and
    // then swapped for a ball, leaves a note behind that is not this item's.
    ret[3] = 0;
    if (item != ITEM_NONE && item == sItemNoted && sItemSlot < PARTY_SIZE)
        ret[3] = BR_ITEM_TARGET(sItemSlot, sItemMove);
    sItemNoted = ITEM_NONE;
    sItemSlot = PARTY_SIZE;
    sItemMove = 0;
    // battle_controllers.c's PrepareBufferDataTransfer, which is static.
    if (gBattleTypeFlags & BATTLE_TYPE_LINK)
        PrepareBufferDataTransferLink(B_COMM_TO_ENGINE, sizeof(ret), ret);
    else
        for (i = 0; i < sizeof(ret); i++)
            gBattleBufferB[gActiveBattler][i] = ret[i];
}

// The same call the bag made, on the given team's mon, and its healthbox if it is out. It
// can run while this ROM's own player has the bag open, so what the bag is in the middle
// of -- the battler it belongs to, the active one -- is put back.
static void UseItemOn(u8 battler, struct Pokemon *party, u8 slot, u16 item, u8 move)
{
    u8 active = gActiveBattler;
    u8 inMenu = gBattlerInMenuId;
    u8 potential = gPotentialItemEffectBattler;

    if (item == ITEM_NONE || item >= ITEMS_COUNT || slot >= PARTY_SIZE)
        return;
    if (move >= MAX_MON_MOVES)
        move = 0;
    gBattlerInMenuId = battler; // whose side it was, and whose stats an X item raises
    PokemonUseItemEffects(&party[slot], item, slot, move, FALSE);
    gActiveBattler = active;
    gBattlerInMenuId = inMenu;
    gPotentialItemEffectBattler = potential;
    // Under the bag the healthboxes are gone, and come back drawn from the party.
    if (gBattlerPartyIndexes[battler] == slot && gMain.callback2 == BattleMainCB2)
        UpdateHealthboxAttribute(gHealthboxSpriteIds[battler], &party[slot], HEALTHBOX_ALL);
}

void BrBattle_PeerItem(u8 battler)
{
    const u8 *ret;

    if (!gBrNetlink.active || battler >= gBattlersCount || GetBattlerSide(battler) == B_SIDE_PLAYER)
        return;
    ret = gBattleBufferB[battler];
    if (ret[0] != CONTROLLER_ONERETURNVALUE || ret[3] == 0)
        return;
    UseItemOn(battler, gEnemyParty, BR_ITEM_TARGET_SLOT(ret[3]), ret[1] | (ret[2] << 8), BR_ITEM_TARGET_MOVE(ret[3]));
}

// PokemonUseItemEffects looks for the item's mon among the battlers on its user's side,
// starting from the side's own number: pret's player is battler 0. The challenged ROM's is
// battler 1, so its potion was written into the other trainer's gBattleMons. A side is a
// battler and the one two along, and its first is whichever of 0 and 1 is on it.
u8 BrBattle_FirstOnSide(u8 battler)
{
    return battler & 1;
}

// After a bag item healed a mon that is out, pret asks that battler's controller for its
// data. The ask is a command, and over a link a command goes out from inside the menu to a
// queue both ROMs run in order; on the challenger's ROM the controller it names is the one
// still holding the bag, so the queue waits on it -- and what the bag hands back, the item
// and its "done", is queued behind the ask. Both ROMs waited for good. Nothing reads the
// answer (the heal is already in gBattleMons), so over our link it is not asked.
void BrBattle_AfterItemHeal(void)
{
    if (gBattleTypeFlags & BATTLE_TYPE_LINK)
        return;
    BtlController_EmitGetMonData(B_COMM_TO_CONTROLLER, REQUEST_ALL_BATTLE, 0);
    MarkBattlerForControllerExec(gActiveBattler);
}

// Recorded on every item action, a bag closed empty included (item 0): the replay reads
// the same four bytes and closes its own bag the same way.
void BrBattle_RecordItem(u8 battler)
{
    u16 item = gBattleBufferB[battler][1] | (gBattleBufferB[battler][2] << 8);
    u8 target = gBattleBufferB[battler][3];
    u8 a, b;

    if (GetBattlerSide(battler) == B_SIDE_PLAYER || (gBattleTypeFlags & BATTLE_TYPE_LINK))
    {
        // A person's bag: whom it went to came back with the item (BrBattle_EmitItemChoice).
        a = BR_ITEM_TARGET_SLOT(target);
        b = BR_ITEM_TARGET_MOVE(target);
        if (a >= PARTY_SIZE)
        {
            a = PARTY_SIZE;
            b = 0;
        }
        // The other trainer's is marked, since a replay's opponent is otherwise an AI. With
        // nobody to go to it reads as the AI's "no item", which is what it was.
        if (GetBattlerSide(battler) != B_SIDE_PLAYER)
            a = a < PARTY_SIZE ? (BR_ITEM_PEER | a) : 0;
    }
    else
    {
        a = *(gBattleStruct->AI_itemType + battler / 2);
        b = *(gBattleStruct->AI_itemFlags + battler / 2);
    }
    RecordedBattle_SetBattlerAction(battler, item & 0x7F);
    RecordedBattle_SetBattlerAction(battler, (item >> 7) & 0x7F);
    RecordedBattle_SetBattlerAction(battler, a);
    RecordedBattle_SetBattlerAction(battler, b);
}

u16 BrBattle_ReplayItem(u8 battler, const u8 *rec)
{
    u16 item = rec[0] | (rec[1] << 7);

    // A stream that ended in the middle reads 0xFF for what never came: nothing to play.
    if (rec[0] > 0x7F || rec[1] > 0x7F || item >= ITEMS_COUNT)
        return ITEM_NONE;
    if (GetBattlerSide(battler) == B_SIDE_PLAYER)
    {
        // The fighter's bag put it straight on the mon before the turn -- the party menu,
        // or the active mon for an X item -- and the engine's player branch does nothing
        // more, so this is the whole of it: the same call, on the same mon.
        UseItemOn(battler, gPlayerParty, rec[2], item, rec[3]);
    }
    else if (rec[2] & BR_ITEM_PEER)
    {
        // The other trainer, a person: done here as their own ROM's opponent did it
        // (BrBattle_PeerItem), which leaves the AI's branch nothing to do.
        *(gBattleStruct->AI_itemType + battler / 2) = 0;
        *(gBattleStruct->AI_itemFlags + battler / 2) = 0;
        UseItemOn(battler, gEnemyParty, rec[2] & ~BR_ITEM_PEER, item, rec[3]);
    }
    else
    {
        // The engine's opponent branch runs the AI's own script for it, off these two.
        *(gBattleStruct->AI_itemType + battler / 2) = rec[2];
        *(gBattleStruct->AI_itemFlags + battler / 2) = rec[3];
    }
    return item;
}
