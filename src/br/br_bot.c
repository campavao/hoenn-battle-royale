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
#include "br/br_engage.h"
#include "br/br_bot.h"

EWRAM_DATA struct BrBotFight gBrBotFight = {0};
// A staged party is six rows plus a header -- 610 bytes, which EWRAM at 99.9% does not
// have. It goes on the heap for the few frames between the first slot and the mons
// being built, and never outlives that: the battle it is for resets the heap on its way
// in (BrBot_HeapReset), and by then this is long since freed.
#define BR_TRAINER_MAX (3 + PLAYER_NAME_LENGTH + PARTY_SIZE * 100)
static EWRAM_DATA struct BrAssembler sTrainerAsm = {0};

// The wire's PackedMon (br_wire.h) into a real mon. Only the fields a fight needs:
// species and level make the stats, the moves make the fight, the HP makes it a mon
// that has already been somewhere.
static void BuildMon(const u8 *row, struct Pokemon *mon)
{
    u16 species = BrWire_ReadU16(row);
    u8 level = row[2];
    u16 hp = BrWire_ReadU16(row + 3);
    u8 nickname[POKEMON_NAME_LENGTH + 1];
    u8 i, len;

    if (level == 0)
        level = 5;
    CreateMon(mon, species, level, USE_RANDOM_IVS, FALSE, 0, OT_ID_PLAYER_ID, 0);
    for (i = 0; i < MAX_MON_MOVES; i++)
    {
        u16 move = BrWire_ReadU16(row + 8 + i * 4);
        u8 pp = row[10 + i * 4];

        if (move == MOVE_NONE)
            continue;
        SetMonData(mon, MON_DATA_MOVE1 + i, &move);
        SetMonData(mon, MON_DATA_PP1 + i, &pp);
    }
    for (len = 0; len < POKEMON_NAME_LENGTH && row[37 + len] != 0 && len < row[36]; len++)
        nickname[len] = row[37 + len];
    nickname[len] = EOS;
    if (len > 0)
        SetMonData(mon, MON_DATA_NICKNAME, nickname);
    if (hp > 0)
        SetMonData(mon, MON_DATA_HP, &hp);
}

// TRAINER: seat, nameLen, name, count, count * PackedMon. Straight into gEnemyParty,
// which is where a link battle's opponent lives too -- and where the engine will leave
// it, because BrBot_PartyIsStaged tells CB2_InitBattleInternal not to ask gTrainers.
static void ParseTrainer(const u8 *d, u16 n)
{
    u8 nameLen, count, i;
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

    ZeroEnemyPartyMons();
    for (i = 0; i < count; i++)
        BuildMon(d + off + i * 100, &gEnemyParty[i]);
    for (i = 0; i < nameLen; i++)
        gBrBotFight.name[i] = d[2 + i];
    gBrBotFight.name[nameLen] = EOS;
    gBrBotFight.seat = d[0];
    gBrBotFight.count = count;
    gBrBotFight.staged = TRUE;
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
        sTrainerAsm.buf = Alloc(BR_TRAINER_MAX);
        if (sTrainerAsm.buf == NULL)
            return;
        sTrainerAsm.cap = BR_TRAINER_MAX;
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

// Where the fight comes back to. The same errand as the netlink's own return: say what
// happened, and a loss is an elimination like any other.
static void CB2_BrReturnFromBotFight(void)
{
    u8 buf[2];

    Overworld_ResetMapMusic();
    gBrBotFight.fighting = FALSE;
    gBrBotFight.staged = FALSE;
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
