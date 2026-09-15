// The netlink transport (POK-229). See include/br/br_netlink.h.
#include "global.h"
#include "main.h"
#include "link.h"
#include "battle.h"
#include "battle_setup.h"
#include "overworld.h"
#include "palette.h"
#include "field_screen_effect.h"
#include "field_weather.h"
#include "constants/field_weather.h"
#include "sound.h"
#include "string_util.h"
#include "script.h"
#include "task.h"
#include "constants/battle.h"
#include "constants/songs.h"
#include "constants/trainers.h"
#include "br/br_mailbox.h"
#include "br/br_wire.h"
#include "br/br_wire_c.h"
#include "br/br_ghosts.h"
#include "br/br_match.h"
#include "br/br_netlink.h"

EWRAM_DATA struct BrNetlink gBrNetlink = {0};
// BT payload: seat, seq u16, len u16, then up to BLOCK_BUFFER_SIZE bytes.
#define BR_BT_HDR 5
static EWRAM_DATA u8 sPending[BR_BT_HDR + BLOCK_BUFFER_SIZE];
static EWRAM_DATA u8 sRecvBuf[BR_BT_HDR + BLOCK_BUFFER_SIZE];
static EWRAM_DATA struct BrAssembler sRecvAsm = {0};

static const u8 sText_Rival[] = _("RIVAL");

static void Deliver(u8 who, const u8 *data, u16 len)
{
    u16 i;
    u8 *dst = (u8 *)gBlockRecvBuffer[who];

    if (len > BLOCK_BUFFER_SIZE)
        len = BLOCK_BUFFER_SIZE;
    for (i = 0; i < len; i++)
        dst[i] = data[i];
    gBrNetlink.recvFlags |= 1 << who;
}

static void HandleBt(const u8 *payload, u8 len, bool8 isCont)
{
    if (!BrWire_Assemble(&sRecvAsm, BR_MSG_BT, isCont, payload, len))
        return;
    if (sRecvAsm.total < BR_BT_HDR || !gBrNetlink.active)
        return;
    gBrNetlink.recvSeq = BrWire_ReadU16(sRecvBuf + 1);
    gBrNetlink.blocksRecv++;
    Deliver(gBrNetlink.myId ^ 1, sRecvBuf + BR_BT_HDR, BrWire_ReadU16(sRecvBuf + 3));
}

static void HandleBtFirst(const u8 *payload, u8 len) { HandleBt(payload, len, FALSE); }
static void HandleBtCont(const u8 *payload, u8 len) { HandleBt(payload, len, TRUE); }

// CHALLENGE {challenger, opponent, nonce}: the page sends it to both sides once the
// engage is settled. The challenger is link id 0.
static void HandleChallenge(const u8 *payload, u8 len)
{
    const u8 *d;
    u8 n = BrWire_Unframe(payload, len, &d);

    if (n < 4 || gBrNetlink.active)
        return;
    if (d[0] == gBrMySeat)
        BrNetlink_StartBattle(0, d[1]);
    else if (d[1] == gBrMySeat)
        BrNetlink_StartBattle(1, d[0]);
}

static bool8 FlushPending(void)
{
    if (gBrNetlink.pendingLen == 0)
        return TRUE;
    if (!BrWire_SendLarge(BR_MSG_BT, sPending, gBrNetlink.pendingLen))
        return FALSE;
    gBrNetlink.pendingLen = 0;
    return TRUE;
}

bool8 BrNetlink_SendBlock(const void *src, u16 size)
{
    const u8 *s = src;
    u16 i;

    if (!gBrNetlink.active || gBrNetlink.pendingLen != 0 || size > BLOCK_BUFFER_SIZE)
        return FALSE;
    // The cable echoes our own block back to us; do the same.
    Deliver(gBrNetlink.myId, s, size);
    if (gBrNetlink.loopback)
        Deliver(gBrNetlink.myId ^ 1, s, size);
    gBrNetlink.sendSeq++;
    sPending[0] = gBrMySeat;
    BrWire_WriteU16(sPending + 1, gBrNetlink.sendSeq);
    BrWire_WriteU16(sPending + 3, size);
    for (i = 0; i < size; i++)
        sPending[BR_BT_HDR + i] = s[i];
    gBrNetlink.pendingLen = BR_BT_HDR + size;
    gBrNetlink.blocksSent++;
    FlushPending();
    return TRUE;
}

bool8 BrNetlink_IsTaskFinished(void)
{
    return gBrNetlink.pendingLen == 0;
}

u8 BrNetlink_GetBlockReceivedStatus(void)
{
    return gBrNetlink.recvFlags;
}

void BrNetlink_ResetBlockReceivedFlag(u8 who)
{
    gBrNetlink.recvFlags &= ~(1 << who);
}

u8 BrNetlink_GetMultiplayerId(void)
{
    return gBrNetlink.myId;
}

static void FillLinkPlayers(u8 myId, u8 peerSeat)
{
    struct LinkPlayer *me = &gLinkPlayers[myId];
    struct LinkPlayer *peer = &gLinkPlayers[myId ^ 1];

    me->trainerId = gSaveBlock2Ptr->playerTrainerId[0] | (gSaveBlock2Ptr->playerTrainerId[1] << 8)
                  | (gSaveBlock2Ptr->playerTrainerId[2] << 16) | (gSaveBlock2Ptr->playerTrainerId[3] << 24);
    StringCopy(me->name, gSaveBlock2Ptr->playerName);
    me->gender = gSaveBlock2Ptr->playerGender;
    me->linkType = LINKTYPE_BATTLE;
    me->language = LANGUAGE_ENGLISH;
    me->version = VERSION_EMERALD + 0x4000;
    me->lp_field_2 = 0x8000;
    me->progressFlags = 0;
    me->id = myId;

    peer->trainerId = 1000 + peerSeat;
    StringCopy(peer->name, sText_Rival);
    peer->gender = gBrSeats[peerSeat].skin & 1;
    peer->linkType = LINKTYPE_BATTLE;
    peer->language = LANGUAGE_ENGLISH;
    peer->version = VERSION_EMERALD + 0x4000;
    peer->lp_field_2 = 0x8000;
    peer->progressFlags = 0;
    peer->id = myId ^ 1;
    gLocalLinkPlayerId = myId;
}

static void Close(void)
{
    gBrNetlink.active = FALSE;
    gWirelessCommType = 0;
    gReceivedRemoteLinkPlayers = FALSE;
    gLinkCallback = NULL;
}

// Where the cable club came back to: no LoadPlayerParty (the damage stays), RESULT
// out, a lost fight is an elimination, then the field.
static void CB2_BrReturnFromBattle(void)
{
    u8 buf[2];

    gBattleTypeFlags &= ~BATTLE_TYPE_LINK_IN_BATTLE;
    Overworld_ResetMapMusic();
    gBrNetlink.lastOutcome = gBattleOutcome;
    buf[0] = gBrMySeat;
    switch (gBattleOutcome)
    {
    case B_OUTCOME_WON: buf[1] = 0; break;
    case B_OUTCOME_LOST: buf[1] = 1; break;
    case B_OUTCOME_DREW: buf[1] = 2; break;
    default: buf[1] = 3; break;
    }
    BrWire_Send(BR_MSG_RESULT, buf, 2);
    Close();
    if (gBattleOutcome == B_OUTCOME_LOST || gBattleOutcome == B_OUTCOME_DREW)
        BrMatch_WhiteOut();
    gFieldCallback = NULL;
    SetMainCallback2(CB2_ReturnToField);
}

#define tState data[0]
#define tTimer data[1]

// The cable club's Task_StartWiredCableClubBattle, minus the cable.
static void Task_BrStartLinkBattle(u8 taskId)
{
    struct Task *task = &gTasks[taskId];

    switch (task->tState)
    {
    case 0:
        FadeScreen(FADE_TO_BLACK, 0);
        gLinkType = LINKTYPE_BATTLE;
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
        gBattleTypeFlags = BATTLE_TYPE_LINK | BATTLE_TYPE_TRAINER;
        CleanupOverworldWindowsAndTilemaps();
        gTrainerBattleOpponent_A = TRAINER_LINK_OPPONENT;
        SetMainCallback2(CB2_InitBattle);
        gMain.savedCallback = CB2_BrReturnFromBattle;
        gBrNetlink.startState = 0;
        DestroyTask(taskId);
        break;
    }
}

void BrNetlink_StartBattle(u8 myId, u8 peerSeat)
{
    if (gBrNetlink.active)
        return;
    gBrNetlink.active = TRUE;
    gBrNetlink.myId = myId;
    gBrNetlink.peerSeat = peerSeat;
    gBrNetlink.recvFlags = 0;
    gBrNetlink.sendSeq = 0;
    gBrNetlink.recvSeq = 0;
    gBrNetlink.pendingLen = 0;
    gBrNetlink.startState = 1;
    sRecvAsm.type = 0;
    gWirelessCommType = BR_WIRELESS_NETLINK;
    gReceivedRemoteLinkPlayers = TRUE;
    gLinkCallback = NULL;
    FillLinkPlayers(myId, peerSeat);
    LockPlayerFieldControls();
    CreateTask(Task_BrStartLinkBattle, 10);
}

void BrNetlink_Init(void)
{
    CpuFill32(0, &gBrNetlink, sizeof(gBrNetlink));
    sRecvAsm.buf = sRecvBuf;
    sRecvAsm.cap = sizeof(sRecvBuf);
    sRecvAsm.type = 0;
    BrNet_On(BR_MSG_BT, HandleBtFirst);
    BrNet_On(BR_MSG_BT | BR_MSG_CONT, HandleBtCont);
    BrNet_On(BR_MSG_CHALLENGE, HandleChallenge);
}

void BrNetlink_Tick(void)
{
    if (gBrNetlink.active && gBrNetlink.pendingLen)
        FlushPending();
}
