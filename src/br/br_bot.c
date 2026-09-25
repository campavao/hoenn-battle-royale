// Fighting a bot (POK-238). See include/br/br_bot.h for why this is a trainer battle.
#include "global.h"
#include "main.h"
#include "overworld.h"
#include "battle.h"
#include "battle_setup.h"
#include "pokemon.h"
#include "task.h"
#include "palette.h"
#include "field_screen_effect.h"
#include "field_weather.h"
#include "string_util.h"
#include "sound.h"
#include "constants/battle.h"
#include "constants/field_weather.h"
#include "constants/pokemon.h"
#include "constants/songs.h"
#include "constants/characters.h"
#include "constants/trainers.h"
#include "constants/moves.h"
#include "malloc.h"
#include "br/br_mailbox.h"
#include "br/br_wire.h"
#include "br/br_wire_c.h"
#include "br/br_ghosts.h"
#include "br/br_match.h"
#include "br/br_spectate.h"
#include "br/br_engage.h"
#include "br/br_bot.h"

EWRAM_DATA struct BrBotFight gBrBotFight = {0};
// A staged party is six rows, a header and the bag's tail -- 619 bytes, which EWRAM at
// 99.9% does not have. It goes on the heap for the few frames between the first slot and
// the mons being built, and never outlives that: the battle it is for resets the heap on
// its way in (BrBot_HeapReset), and by then this is long since freed. The cap was 610
// until POK-330 #11 -- no room for the tail -- so a full card with a seven-letter name
// never arrived at all.
STATIC_ASSERT(BR_CAP_TRAINER >= 3 + PLAYER_NAME_LENGTH + PARTY_SIZE * 100 + 1 + BR_BOT_ITEMS * 2, BrTrainerCapHoldsAFullCard)
static EWRAM_DATA struct BrAssembler sTrainerAsm = {0};

// The wire's PackedMon (br_wire.h) into a real mon. Only the fields a fight needs:
// species and level make the stats, the moves make the fight, the HP makes it a mon
// that has already been somewhere. Shared with br_duel.c, which reads the same rows
// for both sides of a bot-vs-bot fight (POK-238).
//
// FALSE, and nothing built, for a species the ROM has no mon for: CreateMon would read
// gSpeciesInfo and the pic tables past their ends (POK-330 #43). A move past gBattleMoves
// is left to CreateMon's own, as MOVE_NONE always was, and a level past 100 is 100.
bool8 BrBot_BuildMon(const u8 *row, struct Pokemon *mon)
{
    u16 species = BrWire_Species(BrWire_ReadU16(row));
    u8 level = BrWire_Level(row[2]);
    u16 hp = BrWire_ReadU16(row + 3);
    u8 nickname[POKEMON_NAME_LENGTH + 1];
    u8 i, len;

    if (species == SPECIES_NONE)
        return FALSE;
    if (level == 0)
        level = 5;
    CreateMon(mon, species, level, USE_RANDOM_IVS, FALSE, 0, OT_ID_PLAYER_ID, 0);
    for (i = 0; i < MAX_MON_MOVES; i++)
    {
        u16 move = BrWire_Move(BrWire_ReadU16(row + 8 + i * 4));
        u8 pp = row[10 + i * 4];

        if (move == MOVE_NONE)
            continue;
        SetMonData(mon, MON_DATA_MOVE1 + i, &move);
        SetMonData(mon, MON_DATA_PP1 + i, &pp);
    }
    // The card's nickname is NOT applied (POK-237, and the play-test: "the bot's
    // Pokemon names were all weird, most were numbers like 289, but then one was a
    // Lovedisc named Makuhita"). CreateMon has already given this species its real
    // name from the ROM's own table; the page's is a display string from a pool that
    // does not cover Hoenn, so it is a number for anything the pool never heard of and
    // the wrong name for anything that evolved on the way. A bot's mon is not a
    // nicknamed mon -- it is a Luvdisc, and the ROM knows what a Luvdisc is called.
    (void)nickname;
    if (hp > 0)
        SetMonData(mon, MON_DATA_HP, &hp);
    return TRUE;
}

// TRAINER: seat, nameLen, name, count, count * PackedMon. Straight into gEnemyParty,
// which is where a link battle's opponent lives too -- and where the engine will leave
// it, because BrBot_PartyIsStaged tells CB2_InitBattleInternal not to ask gTrainers.
static void ParseTrainer(const u8 *d, u16 n)
{
    u8 nameLen, count, built, i;
    u16 off;

    if (n < 3)
        return;
    nameLen = d[1];
    if (nameLen > PLAYER_NAME_LENGTH || (u16)(2 + nameLen + 1) > n)
        return;
    count = d[2 + nameLen];
    if (count == 0 || count > PARTY_SIZE)
        return;
    off = 3 + nameLen;
    if ((u16)(off + count * 100) > n)
        return;

    // A row with no real species is left out, not the card: the rest close up behind it,
    // since the engine reads a party up to its first empty slot. Nothing left, no fight.
    ZeroEnemyPartyMons();
    built = 0;
    for (i = 0; i < count; i++)
    {
        if (BrBot_BuildMon(d + off + i * 100, &gEnemyParty[built]))
            built++;
    }
    if (built == 0)
    {
        gBrBotFight.staged = FALSE; // whatever was staged is gone with gEnemyParty
        return;
    }
    for (i = 0; i < nameLen; i++)
        gBrBotFight.name[i] = d[2 + i];
    gBrBotFight.name[nameLen] = EOS;
    gBrBotFight.seat = d[0];
    gBrBotFight.count = built;
    // The bag, after the party: itemCount then that many u16s (POK-237). An older page
    // sends no tail at all, and a bot with an empty bag sends a zero -- both leave the
    // AI on the rung's own potion, which is what it had before there was a bag.
    gBrBotFight.itemCount = 0;
    gBrBotFight.spent = 0;
    off += count * 100;
    if ((u16)(off + 1) <= n)
    {
        u8 items = d[off];

        if (items > BR_BOT_ITEMS)
            items = BR_BOT_ITEMS;
        if ((u16)(off + 1 + items * 2) <= n)
        {
            for (i = 0; i < items; i++)
                gBrBotFight.items[i] = BrWire_ReadU16(d + off + 1 + i * 2);
            gBrBotFight.itemCount = items;
        }
    }
    gBrBotFight.staged = TRUE;
}

// The AI reached for one of the four (battle_ai_switch_items.c). Remembered as a bit
// rather than a list: the page knows what it handed over and in what order, so which
// slots went is the whole report.
void BrBot_NoteItemUsed(u16 item)
{
    u8 i;

    if (!gBrBotFight.fighting)
        return;
    for (i = 0; i < gBrBotFight.itemCount; i++)
    {
        if (gBrBotFight.items[i] == item && !(gBrBotFight.spent & (1 << i)))
        {
            gBrBotFight.spent |= 1 << i;
            return;
        }
    }
}

static void DoneWithBuffer(void)
{
    if (sTrainerAsm.buf != NULL)
        Free(sTrainerAsm.buf);
    sTrainerAsm.buf = NULL;
    sTrainerAsm.cap = 0;
    sTrainerAsm.type = 0;
}

static void HandleTrainer(const u8 *payload, u8 len)
{
    if (sTrainerAsm.buf == NULL)
    {
        sTrainerAsm.buf = Alloc(BR_CAP_TRAINER);
        if (sTrainerAsm.buf == NULL)
            return;
        sTrainerAsm.cap = BR_CAP_TRAINER;
        sTrainerAsm.type = 0;
    }
    if (BrWire_Assemble(&sTrainerAsm, BR_MSG_TRAINER, FALSE, payload, len))
    {
        ParseTrainer(sTrainerAsm.buf, sTrainerAsm.total);
        DoneWithBuffer();
    }
}

static void HandleTrainerCont(const u8 *payload, u8 len)
{
    if (sTrainerAsm.buf != NULL
     && BrWire_Assemble(&sTrainerAsm, BR_MSG_TRAINER, TRUE, payload, len))
    {
        ParseTrainer(sTrainerAsm.buf, sTrainerAsm.total);
        DoneWithBuffer();
    }
}

// The heap went away under us (src/malloc.c's InitHeap): let go, and the next first
// slot starts over.
void BrBot_HeapReset(void)
{
    sTrainerAsm.buf = NULL;
    sTrainerAsm.cap = 0;
    sTrainerAsm.type = 0;
}

bool8 BrBot_IsStaged(u8 seat)
{
    return gBrBotFight.staged && gBrBotFight.seat == seat;
}

bool8 BrBot_PartyIsStaged(void)
{
    return gBrBotFight.staged || gBrBotFight.fighting;
}

// What the AI spent out of the bot's bag (POK-237), under the bot's own seat. Sent
// even when nothing went: the page staked those units on this fight and a silent
// report would leave them staked for ever.
static void SendSpent(void)
{
    u8 buf[2 + BR_BOT_ITEMS * 2];
    u8 len = 2, i;

    buf[0] = gBrBotFight.seat;
    buf[1] = 0;
    for (i = 0; i < gBrBotFight.itemCount; i++)
    {
        if (!(gBrBotFight.spent & (1 << i)))
            continue;
        buf[len++] = gBrBotFight.items[i] & 0xFF;
        buf[len++] = (gBrBotFight.items[i] >> 8) & 0xFF;
        buf[1]++;
    }
    BrWire_Send(BR_MSG_SPENT, buf, len);
}

// Where the fight comes back to. The same errand as the netlink's own return: say what
// happened, and a loss is an elimination like any other.
static void CB2_BrReturnFromBotFight(void)
{
    u8 buf[2];

    Overworld_ResetMapMusic();
    gBrBotFight.fighting = FALSE;
    gBrBotFight.staged = FALSE;
    // The fight ran here, so this is the only ROM that knows what the bot has left.
    // Its own page deals it a team but never watches it fight; this is the report.
    BrSpectate_SendPartyOf(gEnemyParty, gBrBotFight.seat);
    SendSpent();
    BrEngage_OnBattleEnd(gBrBotFight.seat, gBattleOutcome);
    buf[0] = gBrMySeat;
    switch (gBattleOutcome)
    {
    case B_OUTCOME_WON: buf[1] = 0; break;
    case B_OUTCOME_LOST: buf[1] = 1; break;
    case B_OUTCOME_DREW: buf[1] = 2; break;
    default: buf[1] = 3; break;
    }
    BrWire_Send(BR_MSG_RESULT, buf, 2);
    // The bot lost: the room is told so its team hits the ground (the host spills it).
    if (gBattleOutcome == B_OUTCOME_WON)
    {
        buf[0] = gBrBotFight.seat;
        buf[1] = 1;
        BrWire_Send(BR_MSG_RESULT, buf, 2);
    }
    if (gBattleOutcome == B_OUTCOME_LOST || gBattleOutcome == B_OUTCOME_DREW)
        BrMatch_WhiteOut();
    gFieldCallback = NULL;
    SetMainCallback2(CB2_ReturnToField);
}

#define tState data[0]
#define tTimer data[1]

// Task_BrStartLinkBattle's shape, minus the link: fade, wait it out, hand the
// overworld's windows back, and into an ordinary trainer battle.
static void Task_BrStartBotFight(u8 taskId)
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
        // TRAINER_NONE: the party is already staged, so this is only ever read for the
        // class and the sprite. A bot's own name is a follow-up (POK-238 `trainer`).
        gTrainerBattleOpponent_A = 0;
        gTrainerBattleOpponent_B = 0;
        CleanupOverworldWindowsAndTilemaps();
        gBrBotFight.fighting = TRUE;
        gMain.savedCallback = CB2_BrReturnFromBotFight;
        SetMainCallback2(CB2_InitBattle);
        DestroyTask(taskId);
        break;
    }
}

#undef tState
#undef tTimer

bool8 BrBot_StartFight(u8 seat)
{
    if (!BrBot_IsStaged(seat) || gBrBotFight.fighting)
        return FALSE;
    if (gMain.callback2 != CB2_Overworld || gMain.inBattle)
        return FALSE;
    CreateTask(Task_BrStartBotFight, 80);
    return TRUE;
}

void BrBot_Init(void)
{
    CpuFill32(0, &gBrBotFight, sizeof(gBrBotFight));
    sTrainerAsm.buf = NULL;
    sTrainerAsm.cap = 0;
    sTrainerAsm.type = 0;
    BrNet_On(BR_MSG_TRAINER, HandleTrainer);
    BrNet_On(BR_MSG_TRAINER | BR_MSG_CONT, HandleTrainerCont);
}

void BrBot_Tick(void)
{
    // A staged party that never got its challenge would sit in gEnemyParty forever and
    // stop the engine filling it for a real trainer. One map's worth of patience.
    if (gBrBotFight.staged && !gBrBotFight.fighting && gMain.inBattle)
        gBrBotFight.staged = FALSE;
}
