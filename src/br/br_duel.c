// Two bots fighting, for real (POK-238). See include/br/br_duel.h for why this rides
// the bot fight's entry path rather than a boot mode of its own.
#include "global.h"
#include "main.h"
#include "overworld.h"
#include "battle.h"
#include "battle_setup.h"
#include "battle_anim.h"
#include "pokemon.h"
#include "task.h"
#include "palette.h"
#include "field_screen_effect.h"
#include "field_weather.h"
#include "constants/field_weather.h"
#include "sound.h"
#include "constants/battle.h"
#include "constants/songs.h"
#include "malloc.h"
#include "br/br_mailbox.h"
#include "br/br_wire.h"
#include "br/br_wire_c.h"
#include "br/br_match.h"
#include "br/br_bot.h"
#include "data.h"
#include "constants/items.h"
#include "br/br_duel.h"

EWRAM_DATA struct BrDuel gBrDuel = {0};
// Two parties is 1200 bytes: the heap, for the few frames between the message landing
// and the mons being built, exactly as br_bot.c does it.
#define BR_DUEL_MAX (4 + 2 * BR_DUEL_MAX_MONS * 100)
static EWRAM_DATA struct BrAssembler sDuelAsm = {0};

// DUEL: seatA, seatB, countA, countB, then countA + countB PackedMon rows. A goes into
// gPlayerParty and B into gEnemyParty -- which side is which matters only for reading
// the result back, since both of them are played by the AI.
static void ParseDuel(const u8 *d, u16 n)
{
    u8 countA, countB, i, side;
    u16 off;

    if (n < 4)
        return;
    countA = d[2];
    countB = d[3];
    if (countA == 0 || countA > BR_DUEL_MAX_MONS || countB == 0 || countB > BR_DUEL_MAX_MONS)
        return;
    off = 4;
    if ((u16)(off + (countA + countB) * 100) > n)
        return;

    ZeroPlayerPartyMons();
    ZeroEnemyPartyMons();
    for (i = 0; i < countA; i++)
        BrBot_BuildMon(d + off + i * 100, &gPlayerParty[i]);
    for (i = 0; i < countB; i++)
        BrBot_BuildMon(d + off + (countA + i) * 100, &gEnemyParty[i]);
    // Filling the array is not enough: the battle reads the count, and a stale one
    // sends the wrong number of mons into the fight.
    CalculatePlayerPartyCount();
    gBrDuel.seatA = d[0];
    gBrDuel.seatB = d[1];
    gBrDuel.countA = countA;
    gBrDuel.countB = countB;
    // The two bags, after the parties (POK-237): a count then that many u16s, A's
    // first. Absent -- an older page, or two bots with nothing left -- and the duel is
    // fought bare, which is what it did before there were bags at all.
    off += (countA + countB) * 100;
    gBrDuel.itemCount[0] = 0;
    gBrDuel.itemCount[1] = 0;
    gBrDuel.spent[0] = 0;
    gBrDuel.spent[1] = 0;
    for (side = 0; side < 2; side++)
    {
        u8 count;

        if ((u16)(off + 1) > n)
            break;
        count = d[off];
        if (count > BR_BOT_ITEMS || (u16)(off + 1 + count * 2) > n)
            break;
        for (i = 0; i < count; i++)
            gBrDuel.items[side][i] = BrWire_ReadU16(d + off + 1 + i * 2);
        gBrDuel.itemCount[side] = count;
        off += 1 + count * 2;
    }
    gBrDuel.staged = TRUE;
    gBrDuel.proxy = TRUE;
}

// Which side of the duel a battler is on: 0 is the party in gPlayerParty.
static u8 SideOf(u8 battler)
{
    return GetBattlerSide(battler) == B_SIDE_PLAYER ? 0 : 1;
}

void BrDuel_LoadItems(u8 battler)
{
    u8 side, i, n = 0;

    if (!gBrDuel.running || gBattleResources == NULL)
        return;
    side = SideOf(battler);
    for (i = 0; i < MAX_TRAINER_ITEMS; i++)
        gBattleResources->battleHistory->trainerItems[i] = ITEM_NONE;
    for (i = 0; i < gBrDuel.itemCount[side]; i++)
    {
        if (gBrDuel.spent[side] & (1 << i))
            continue;
        gBattleResources->battleHistory->trainerItems[n++] = gBrDuel.items[side][i];
    }
    gBattleResources->battleHistory->itemsNo = n;
}

void BrDuel_NoteItemUsed(u16 item)
{
    u8 side, i;

    if (!gBrDuel.running)
        return;
    side = SideOf(gActiveBattler);
    for (i = 0; i < gBrDuel.itemCount[side]; i++)
    {
        if (gBrDuel.items[side][i] == item && !(gBrDuel.spent[side] & (1 << i)))
        {
            gBrDuel.spent[side] |= 1 << i;
            return;
        }
    }
}

static void DoneWithBuffer(void)
{
    if (sDuelAsm.buf != NULL)
        Free(sDuelAsm.buf);
    sDuelAsm.buf = NULL;
    sDuelAsm.cap = 0;
    sDuelAsm.type = 0;
}

static void HandleDuel(const u8 *payload, u8 len)
{
    if (sDuelAsm.buf == NULL)
    {
        sDuelAsm.buf = Alloc(BR_DUEL_MAX);
        if (sDuelAsm.buf == NULL)
            return;
        sDuelAsm.cap = BR_DUEL_MAX;
        sDuelAsm.type = 0;
    }
    if (BrWire_Assemble(&sDuelAsm, BR_MSG_DUEL, FALSE, payload, len))
    {
        ParseDuel(sDuelAsm.buf, sDuelAsm.total);
        DoneWithBuffer();
    }
}

static void HandleDuelCont(const u8 *payload, u8 len)
{
    if (sDuelAsm.buf != NULL && BrWire_Assemble(&sDuelAsm, BR_MSG_DUEL, TRUE, payload, len))
    {
        ParseDuel(sDuelAsm.buf, sDuelAsm.total);
        DoneWithBuffer();
    }
}

void BrDuel_HeapReset(void)
{
    sDuelAsm.buf = NULL;
    sDuelAsm.cap = 0;
    sDuelAsm.type = 0;
}

struct Pokemon *BrDuel_ControllerParty(void)
{
    if (gBrDuel.running && GetBattlerSide(gActiveBattler) == B_SIDE_PLAYER)
        return gPlayerParty;
    return gEnemyParty;
}

bool8 BrDuel_Running(void)
{
    return gBrDuel.running;
}

bool8 BrDuel_IsProxy(void)
{
    return gBrDuel.proxy;
}

// What came out of it. Not the mons -- the page sent them and still holds them -- only
// what the fight changed: who won, and what each side has left, three bytes a mon.
static void SendResult(void)
{
    u8 buf[5 + 2 * BR_DUEL_MAX_MONS * 3 + 2 * (1 + BR_BOT_ITEMS * 2)];
    u8 len = 5, i;

    buf[0] = gBrDuel.seatA;
    buf[1] = gBrDuel.seatB;
    switch (gBattleOutcome)
    {
    case B_OUTCOME_WON: buf[2] = 0; break;   // A, the party in gPlayerParty
    case B_OUTCOME_LOST: buf[2] = 1; break;  // B
    default: buf[2] = 2; break;              // a draw, or nobody: the page settles it
    }
    buf[3] = gBrDuel.countA;
    buf[4] = gBrDuel.countB;
    for (i = 0; i < gBrDuel.countA; i++)
    {
        u16 hp = GetMonData(&gPlayerParty[i], MON_DATA_HP, NULL);

        BrWire_WriteU16(buf + len, hp);
        len += 2;
        buf[len++] = GetMonData(&gPlayerParty[i], MON_DATA_STATUS, NULL) & 0xFF;
    }
    for (i = 0; i < gBrDuel.countB; i++)
    {
        u16 hp = GetMonData(&gEnemyParty[i], MON_DATA_HP, NULL);

        BrWire_WriteU16(buf + len, hp);
        len += 2;
        buf[len++] = GetMonData(&gEnemyParty[i], MON_DATA_STATUS, NULL) & 0xFF;
    }
    // What each side spent out of its own bag (POK-237), so the page can take it off
    // the right one: a count then the ids, A's first.
    for (i = 0; i < 2; i++)
    {
        u8 at = len++;
        u8 j;

        buf[at] = 0;
        for (j = 0; j < gBrDuel.itemCount[i]; j++)
        {
            if (!(gBrDuel.spent[i] & (1 << j)))
                continue;
            BrWire_WriteU16(buf + len, gBrDuel.items[i][j]);
            len += 2;
            buf[at]++;
        }
    }
    BrWire_SendLarge(BR_MSG_DRESULT, buf, len);
}

static void CB2_BrReturnFromDuel(void)
{
    Overworld_ResetMapMusic();
    gBrDuel.running = FALSE;
    gBrDuel.staged = FALSE;
    SendResult();
    // Nothing else happens here. This ROM is not in a match, nobody is standing on its
    // overworld, and the page throws the whole instance away when it is done with it --
    // the duel's only output is the message above.
    gFieldCallback = NULL;
    SetMainCallback2(CB2_ReturnToField);
}

#define tState data[0]
#define tTimer data[1]

// Task_BrStartBotFight, to the frame. The earlier attempt at this ticket wrote its own
// entry and stalled on the intro for ever; this one deliberately has no opinions.
static void Task_BrStartDuel(u8 taskId)
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
        PlayMapChosenOrBattleBGM(MUS_VS_TRAINER);
        gBattleTypeFlags = BATTLE_TYPE_TRAINER;
        gTrainerBattleOpponent_A = 0;
        gTrainerBattleOpponent_B = 0;
        CleanupOverworldWindowsAndTilemaps();
        gBrDuel.running = TRUE;
        gBrDuel.starting = FALSE;
        gMain.savedCallback = CB2_BrReturnFromDuel;
        SetMainCallback2(CB2_InitBattle);
        DestroyTask(taskId);
        break;
    }
}

#undef tState
#undef tTimer

void BrDuel_Init(void)
{
    CpuFill32(0, &gBrDuel, sizeof(gBrDuel));
    sDuelAsm.buf = NULL;
    sDuelAsm.cap = 0;
    sDuelAsm.type = 0;
    BrNet_On(BR_MSG_DUEL, HandleDuel);
    BrNet_On(BR_MSG_DUEL | BR_MSG_CONT, HandleDuelCont);
}

void BrDuel_Tick(void)
{
    if (!gBrDuel.staged || gBrDuel.running || gBrDuel.starting)
        return;
    if (gMain.callback2 != CB2_Overworld || gMain.inBattle)
        return;
    // Latched, because `running` is not set until the task's last state -- a fade and
    // twenty frames later -- and this runs every frame. Without it the tick stacked a
    // fresh Task_BrStartDuel on every one of those frames, each of which went on to
    // re-enter CB2_InitBattle after the first one had already got there. A bot fight
    // never had the problem because a CHALLENGE is an event; this is a poll.
    gBrDuel.starting = TRUE;
    // The proxy is simulating a moment in a match, and the ROM's own battle hooks ask
    // what phase it is (POK-238's first attempt ran with BR_PHASE_NONE and nothing in
    // the ROM has ever fought in that state).
    gBrMatch.phase = BR_PHASE_PLAY;
    CreateTask(Task_BrStartDuel, 80);
}
