// The shot clock and the RUN roll (POK-231). See include/br/br_battle.h.
#include "global.h"
#include "random.h"
#include "window.h"
#include "gpu_regs.h"
#include "palette.h"
#include "constants/rgb.h"
#include "text.h"
#include "string_util.h"
#include "battle.h"
#include "battle_main.h"
#include "battle_anim.h"
#include "battle_interface.h"
#include "battle_controllers.h"
#include "battle_util.h"
#include "battle_scripts.h"
#include "item.h"
#include "battle_message.h"
#include "battle_setup.h"
#include "constants/trainers.h"
#include "constants/battle_script_commands.h"
#include "constants/battle_string_ids.h"
#include "main.h"
#include "menu.h"
#include "pokemon.h"
#include "recorded_battle.h"
#include "constants/characters.h"
#include "constants/items.h"
#include "constants/songs.h"
#include "br/br_mailbox.h"
#include "br/br_wire.h"
#include "br/br_wire_c.h"
#include "br/br_ghosts.h"
#include "br/br_netlink.h"
#include "br/br_battle.h"
#include "br/br_bot.h"
#include "br/br_spectate.h"

EWRAM_DATA struct BrBattle gBrBattle = {0};
EWRAM_DATA u8 gBrSeeThrough[2] = {0};

// The opponent's three lines, for the one seat they are about (BrBattle_SetVoice).
struct BrVoice
{
    u8 seat;
    u8 text[3][BR_VOICE_LEN + 1];
    u8 pad;
};
static EWRAM_DATA struct BrVoice sVoice = {0};
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
    sVoice.seat = BR_NO_SEAT;
}

bool8 BrBattle_AnimationsOff(void)
{
    return gSaveBlock2Ptr->optionsBattleSceneOff == TRUE;
}

void BrBattle_SeeThrough(void)
{
    if (!gBrSeeThrough[0])
        return;
    ClearGpuRegBits(REG_OFFSET_DISPCNT, DISPCNT_BG3_ON);
    gPlttBufferUnfaded[0] = BR_SEE_THROUGH_KEY;
    if (!gPaletteFade.active)
        gPlttBufferFaded[0] = BR_SEE_THROUGH_KEY;
    gBrSeeThrough[1] = 2;
}

void BrBattle_TickSeeThrough(void)
{
    if (gBrSeeThrough[1] != 0)
        gBrSeeThrough[1]--;
}

u8 BrBattle_LinkTextSpeed(void)
{
    return GetPlayerTextSpeedDelay();
}

// SLOW keeps pret's hold; MID and FAST give a line about two thirds and a third of it.
// Long enough to read a line at a glance, and the same on both ROMs of a link battle,
// which got one TEXT at START.
u8 BrBattle_AutoScrollFrames(void)
{
    if (!gMain.inBattle)
        return 49;
    switch (gSaveBlock2Ptr->optionsTextSpeed)
    {
    case OPTIONS_TEXT_SPEED_FAST:
        return 18;
    case OPTIONS_TEXT_SPEED_MID:
        return 32;
    default:
        return 49;
    }
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
static bool8 TakeRun(bool8 doll)
{
    gBrBattle.runRolls++;
    if (!doll)
        return FALSE;
    gBrBattle.runEscapes++;
    return TRUE;
}

// RUN at selection (POK-231, POK-293). The doll is spent here, on the runner's own bag
// alone, and the action's return value says so, so both ROMs of a link battle agree.
// BR_RUN_ROLL is "asked to leave, had nothing to leave with". Every Mart sells them.
u8 BrBattle_ChooseRun(void)
{
    if (CheckBagHasItem(ITEM_POKE_DOLL, 1))
    {
        RemoveBagItem(ITEM_POKE_DOLL, 1);
        return BR_RUN_DOLL;
    }
    return BR_RUN_ROLL;
}

bool8 BrBattle_HandleRun(void)
{
    u8 how = gBattleBufferB[gBattlerAttacker][2];

    if (gBattleTypeFlags & (BATTLE_TYPE_LINK | BATTLE_TYPE_RECORDED_LINK))
    {
        // A forfeit is not a flee (POK-292). The shot clock ran out, and that has a
        // definite loser and a definite winner -- which is pret's own link branch, so
        // this steps aside and lets it run.
        if (how == BR_RUN_FORFEIT)
            return FALSE;
    }
    // A bot's fight is a TRAINER battle rather than a link one, and pret decides RUN
    // there by the speed roll -- while the POKe DOLL had already been spent at
    // selection: you paid and got a coin toss (POK-293). So it gets the same rule.
    // Against a wild Pokemon RUN is left to pret, because the Zone is not somebody
    // else's time; and the AI's side never runs from a trainer.
    else if (GetBattlerSide(gBattlerAttacker) != B_SIDE_PLAYER
          || !(gBattleTypeFlags & BATTLE_TYPE_TRAINER))
    {
        return FALSE;
    }
    if (!TakeRun(how == BR_RUN_DOLL))
    {
        ClearFuryCutterDestinyBondGrudge(gBattlerAttacker);
        gBattleCommunication[MULTISTRING_CHOOSER] = B_MSG_CANT_ESCAPE_2;
        gBattlescriptCurrInstr = BattleScript_PrintFailedToRunString;
        gCurrentActionFuncId = B_ACTION_EXEC_SCRIPT;
        return TRUE;
    }
    gCurrentTurnActionNumber = gBattlersCount;
    if (GetBattlerSide(gBattlerAttacker) == B_SIDE_PLAYER)
        gBattleOutcome = B_OUTCOME_RAN;
    else
        gBattleOutcome = B_OUTCOME_MON_FLED;
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

// A duel's side A is a bot on the player's side (POK-331 leftover h). pret sends the
// player's side's items down the player's script, which does nothing -- a bag has already
// used them -- so A's AI spent its X ATTACK out of the bag and nothing went up. It is used
// here the way a bag would, as its choice is handed back, on the mon that is out; and it
// is recorded as a bag item, so a spectator's replay plays exactly this call again.
void BrBattle_UseAsBag(u8 battler, struct Pokemon *party, u16 item)
{
    u8 slot = gBattlerPartyIndexes[battler];

    UseItemOn(battler, party, slot, item, 0);
    BrBattle_NoteItemTarget(item, slot, 0);
    BrBattle_EmitItemChoice(item);
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

// ---- whose item it was (POK-331 #7) ----------------------------------------------------
//
// A bag item is used by the time its turn comes -- in the drinker's party menu, and on the
// other ROM and in a replay the moment the choice arrived (BrBattle_PeerItem,
// BrBattle_ReplayItem) -- so pret's script for it, the player's, says nothing. For the
// other trainer that was the AI's script, and a person has no AI item type, so it was the
// player's too: the watching screen's healthbar just jumped. Kanto's link battle says
// "RED used POTION!" there.
//
// The line goes before the item's own script, and that script runs after it as it did.
// The engine runs on the challenger's ROM alone and every line it prints goes to both, so
// it names whoever's battler used it, from each ROM's own gLinkPlayers: the other trainer
// on the watching screen, the drinker's own name on theirs, the fighter in a replay.

extern const u8 *const gBattlescriptsForUsingItem[];

static const u8 sText_UsedItem[] = _("{B_LINK_SCR_TRAINER_NAME} used\n{B_LAST_ITEM}!");
static const u8 sText_FogHurt[] = _("{B_ATK_NAME_WITH_PREFIX} is hurt\nby the fog!");
static const u8 sText_NewPage[] = _("\p");
// A bot whose lines never arrived still says something when it slides back in: pret's
// own speech for TRAINER_NONE is whatever the last trainerbattle script left behind.
static const u8 sText_BotLost[] = _("Huh? Did I just lose?");
static const u8 sText_BotWon[] = _("Better luck next time!");


// BattleScript_OpponentUsesHealItem's first five lines (data/battle_scripts_2.s) with our
// line in place of its trainer's, then back to the script the engine picked.
static const u8 sScript_UsedItem[] =
{
    B_SCR_OP_PRINTSTRING, STRINGID_EMPTYSTRING3 & 0xFF, STRINGID_EMPTYSTRING3 >> 8,
    B_SCR_OP_PAUSE, B_WAIT_TIME_MED & 0xFF, B_WAIT_TIME_MED >> 8,
    B_SCR_OP_PLAYSE, SE_USE_ITEM & 0xFF, SE_USE_ITEM >> 8,
    B_SCR_OP_PRINTSTRING, BR_STRINGID_USED_ITEM & 0xFF, BR_STRINGID_USED_ITEM >> 8,
    B_SCR_OP_WAITMESSAGE, B_WAIT_TIME_LONG & 0xFF, B_WAIT_TIME_LONG >> 8,
    B_SCR_OP_RETURN,
};

void BrBattle_SayItemUsed(void)
{
    if (!(gBattleTypeFlags & (BATTLE_TYPE_LINK | BATTLE_TYPE_RECORDED_LINK)))
        return;
    // Only the player's script: a ball, a doll and an AI's own item (a duel's replay)
    // have theirs, and the AI's says its trainer's line already.
    if (gBattlescriptCurrInstr != gBattlescriptsForUsingItem[0] || gLastUsedItem == ITEM_NONE)
        return;
    gBattleScripting.battler = gBattlerAttacker;
    BattleScriptPush(gBattlescriptCurrInstr);
    gBattlescriptCurrInstr = sScript_UsedItem;
}

// Whom this battle is against: the bot we are fighting, or the netlink's other side.
static u8 OpponentSeat(void)
{
    if (gBrBotFight.fighting)
        return gBrBotFight.seat;
    if (gBrNetlink.active)
        return gBrNetlink.peerSeat;
    return BR_NO_SEAT;
}

// One of the opponent's lines, or NULL when they have not told us that one.
static const u8 *Said(u8 which)
{
    u8 seat = OpponentSeat();

    if (seat == BR_NO_SEAT || sVoice.seat != seat || which > BR_VOICE_LOSE || sVoice.text[which][0] == EOS)
        return NULL;
    return sVoice.text[which];
}

void BrBattle_SetVoice(u8 seat, u8 which, const u8 *text, u8 len)
{
    u8 i;

    if (which > BR_VOICE_LOSE || seat == BR_NO_SEAT)
        return;
    // One trainer's lines at a time: the next one we are about to fight.
    if (sVoice.seat != seat)
    {
        sVoice.seat = seat;
        for (i = 0; i < 3; i++)
            sVoice.text[i][0] = EOS;
    }
    if (len > BR_VOICE_LEN)
        len = BR_VOICE_LEN;
    for (i = 0; i < len && text[i] != EOS; i++)
        sVoice.text[which][i] = text[i];
    sVoice.text[which][i] = EOS;
}

bool8 BrBattle_BufferString(u16 stringId)
{
    // An AI's item in a replay -- a bot's X ATTACK in a duel we are watching -- is its
    // trainer's line, and a replay's trainer is TRAINER_LINK_OPPONENT: 2048, far past the
    // end of gTrainers, so the class and name came out of whatever ROM bytes lie there.
    // On agbcc that was garbage; on modern it never ended, and the replay waited on the
    // message for good. The AI's script already set the battler, so it gets our line.
    if (stringId == STRINGID_TRAINER1USEDITEM && gTrainerBattleOpponent_A == TRAINER_LINK_OPPONENT)
        stringId = BR_STRINGID_USED_ITEM;
    if (stringId == BR_STRINGID_FOG_HURT)
    {
        BattleStringExpandPlaceholdersToDisplayedString(sText_FogHurt);
        return TRUE;
    }
    // A bot slides back in at the end of its fight and says its own line, won or lost.
    if (gBrBotFight.fighting && (stringId == STRINGID_TRAINER1LOSETEXT || stringId == STRINGID_TRAINER1WINTEXT))
    {
        const u8 *line = Said(stringId == STRINGID_TRAINER1WINTEXT ? BR_VOICE_WIN : BR_VOICE_LOSE);

        if (line == NULL)
            line = stringId == STRINGID_TRAINER1WINTEXT ? sText_BotWon : sText_BotLost;
        // ...and holds it for A: the money line comes straight after.
        StringAppend(StringCopy(gDisplayedStringBattle, line), sText_NewPage);
        return TRUE;
    }
    if (stringId != BR_STRINGID_USED_ITEM)
        return FALSE;
    BattleStringExpandPlaceholdersToDisplayedString(sText_UsedItem);
    return TRUE;
}

void BrBattle_AfterString(u16 stringId)
{
    const u8 *line = NULL;
    u16 end;
    bool8 held;

    if (stringId == STRINGID_INTROMSG)
        line = Said(BR_VOICE_INTRO);
    // A link battle's last line, "<PLAYER> defeated <NAME>!": theirs after it. The bot's
    // end is its own slide-in (BrBattle_BufferString), and a run or a forfeit has no line.
    else if (stringId == STRINGID_BATTLEEND && gBrNetlink.active && gBattleOutcome == B_OUTCOME_WON)
        line = Said(BR_VOICE_LOSE);
    else if (stringId == STRINGID_BATTLEEND && gBrNetlink.active && gBattleOutcome == B_OUTCOME_LOST)
        line = Said(BR_VOICE_WIN);
    if (line == NULL)
        return;
    // A trainer's intro already ends on a page break, to hold before "sent out": the
    // line goes on the page after it, and the break after the line.
    end = StringLength(gDisplayedStringBattle);
    held = end > 0 && gDisplayedStringBattle[end - 1] == CHAR_PROMPT_CLEAR;
    if (held)
        gDisplayedStringBattle[end - 1] = EOS;
    StringAppend(gDisplayedStringBattle, sText_NewPage);
    StringAppend(gDisplayedStringBattle, line);
    if (held)
        StringAppend(gDisplayedStringBattle, sText_NewPage);
}

// Index for index with br_ghosts.c's sSkinGraphics and the page's SKINS: the walking
// sprite's own trainer class. The two rival skins are the same BRENDAN and MAY.
static const u8 sSkinPics[] =
{
    TRAINER_PIC_BRENDAN,
    TRAINER_PIC_MAY,
    TRAINER_PIC_BRENDAN,
    TRAINER_PIC_MAY,
    TRAINER_PIC_HIKER,
    TRAINER_PIC_BEAUTY,
    TRAINER_PIC_CAMPER,
    TRAINER_PIC_PICNICKER,
    TRAINER_PIC_SWIMMER_M,
    TRAINER_PIC_SWIMMER_F,
    TRAINER_PIC_EXPERT_M,
    TRAINER_PIC_EXPERT_F,
    TRAINER_PIC_POKEFAN_M,
    TRAINER_PIC_POKEFAN_F,
    TRAINER_PIC_YOUNGSTER,
    TRAINER_PIC_LASS,
};

bool8 BrBattle_RecordedWildOpponent(void)
{
    return RecordedBattle_IsSpectateLive();
}

u32 BrBattle_OpponentPic(u32 pic)
{
    u8 seat = OpponentSeat();
    u8 skin;

    if (seat >= BR_MAX_SEATS || !gBrSeats[seat].present)
        return pic;
    skin = gBrSeats[seat].skin;
    if (skin >= ARRAY_COUNT(sSkinPics))
        return pic;
    return sSkinPics[skin];
}
