// The netlink transport (POK-229). See include/br/br_netlink.h.
#include "global.h"
#include "main.h"
#include "link.h"
#include "battle.h"
#include "battle_controllers.h"
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
#include "start_menu.h"
#include "event_object_lock.h"
#include "field_effect.h"
#include "field_player_avatar.h"
#include "event_object_movement.h"
#include "constants/field_effects.h"
#include "constants/battle.h"
#include "constants/songs.h"
#include "constants/trainers.h"
#include "br/br_mailbox.h"
#include "br/br_wire.h"
#include "br/br_wire_c.h"
#include "br/br_ghosts.h"
#include "br/br_match.h"
#include "br/br_engage.h"
#include "br/br_battle.h"
#include "br/br_bot.h"
#include "br/br_netlink.h"
#include "br/br_field.h"

EWRAM_DATA struct BrNetlink gBrNetlink = {0};
// BT payload: seat, seq u16, len u16, then up to BLOCK_BUFFER_SIZE bytes.
#define BR_BT_HDR 5
static EWRAM_DATA u8 sPending[BR_BT_HDR + BLOCK_BUFFER_SIZE] = {0};
STATIC_ASSERT(BR_CAP_BT == BR_BT_HDR + BLOCK_BUFFER_SIZE, BrBtCapIsOneBlock)
static EWRAM_DATA u8 sRecvBuf[BR_CAP_BT] = {0};
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

// Drivers only. The loopback peer is our mirror: once the battle is running, the
// controller blocks we send come back as the other player's. Commands (buffer A) are
// the master's alone and are not echoed. While only one battler has a command
// pending (the intro's one-at-a-time data requests) the peer acknowledges the same
// battler; while both do (the choice of action and move) the peer is our reflection:
// its player controls the other battler, so replies and acks swap battler, and a
// move's target flips to the other side.
// Block layout (battle_controllers.c's private enum): bufferId @0, battler @1, data @8.
#define BR_LINK_BUFF_BATTLER 1
#define BR_LINK_BUFF_DATA 8
static void DeliverMirrored(u8 who, const u8 *data, u16 len)
{
    u8 *dst = (u8 *)gBlockRecvBuffer[who];
    bool8 paired = (gBattleControllerExecFlags & 0x1111) && (gBattleControllerExecFlags & 0x2222);

    if (!(gBattleTypeFlags & BATTLE_TYPE_LINK_IN_BATTLE))
    {
        Deliver(who, data, len);
        return;
    }
    if (data[0] == B_COMM_TO_CONTROLLER)
        return;
    Deliver(who, data, len);
    if (data[0] == B_COMM_CONTROLLER_IS_DONE)
        dst[BR_LINK_BUFF_DATA] = who;
    if (!paired)
        return;
    dst[BR_LINK_BUFF_BATTLER] ^= 1;
    if (data[0] != B_COMM_CONTROLLER_IS_DONE
     && dst[BR_LINK_BUFF_DATA] == CONTROLLER_TWORETURNVALUES && dst[BR_LINK_BUFF_DATA + 1] == B_ACTION_EXEC_SCRIPT)
        dst[BR_LINK_BUFF_DATA + 3] ^= 1; // the move's target is the other battler
}

static void HandleBt(const u8 *payload, u8 len, bool8 isCont)
{
    if (!BrWire_Assemble(&sRecvAsm, BR_MSG_BT, isCont, payload, len))
        return;
    if (sRecvAsm.total < BR_BT_HDR || !gBrNetlink.active)
        return;
    // Only the seat we are linked with. A page that lost track of its opponent (a
    // rejoin mid-fight) broadcast its blocks to the whole room, and every other link
    // battle in it took them as its own peer's and desynced (POK-330 #20).
    if (sRecvBuf[0] != gBrNetlink.peerSeat)
        return;
    gBrNetlink.recvSeq = BrWire_ReadU16(sRecvBuf + 1);
    gBrNetlink.blocksRecv++;
    Deliver(gBrNetlink.myId ^ 1, sRecvBuf + BR_BT_HDR, BrWire_ReadU16(sRecvBuf + 3));
}

static void HandleBtFirst(const u8 *payload, u8 len) { HandleBt(payload, len, FALSE); }
static void HandleBtCont(const u8 *payload, u8 len) { HandleBt(payload, len, TRUE); }

// CHALLENGE {challenger, opponent, nonce}: the page sends it to both sides once the
// engage is settled. The challenger is link id 0.
// The overworld with nothing open: a battle can start from here right now. Not while
// the field is already on its way out (BrField_Leave) -- a bot fight's fade locks
// nothing, and a link opened under it lost its start task to the battle's own init.
static bool8 FieldFree(void)
{
    return gMain.callback2 == CB2_Overworld && !gMain.inBattle
        && !ScriptContext_IsEnabled() && !ArePlayerFieldControlsLocked()
        && !BrField_Leaving();
}

// Where the challenger's ghost is: on the map we are standing on, or it did not see us.
static bool8 OnOurMap(u8 seat)
{
    const struct BrSeat *s = &gBrSeats[seat];

    return s->present
        && s->mapGroup == gSaveBlock1Ptr->location.mapGroup
        && s->mapNum == gSaveBlock1Ptr->location.mapNum;
}

// A menu is not a hiding place (POK-230): a CHALLENGE that lands with something open
// waits in pendingPeer; BrNetlink_Tick closes the START menu, lets a sub-screen (bag,
// party, fly map) settle and starts the fight from inside it, and waits out a running
// script. Not a battle, though: see TickPendingChallenge.
static void HandleChallenge(const u8 *payload, u8 len)
{
    const u8 *d;
    u8 n = BrWire_Unframe(payload, len, &d);

    if (n < 4 || gBrNetlink.active)
        return;
    // Both seats index gBrSeats (the peer's skin, the ghost the ! goes over), so both
    // are on the board or the challenge is nobody's (POK-330 #6).
    if (d[0] >= BR_MAX_SEATS || d[1] >= BR_MAX_SEATS || d[0] == d[1])
        return;
    // An engage is two trainers on one map seeing each other in the match proper -- our
    // own eyeline's rule (CanEngage), checked here against what this ROM can see, since
    // any member of the room can send a CHALLENGE naming anybody at any time: not in the
    // lobby, not in the Safari opening, not once we are out, and not from a seat whose
    // ghost is not standing on our map (POK-330 #24).
    if (gBrMatch.phase != BR_PHASE_PLAY)
        return;
    if (d[0] != gBrMySeat && !OnOurMap(d[0]))
        return;
    // A bot has no ROM to link with: if its party is already staged, this is a trainer
    // battle, not an exchange (POK-238) -- now, or from the menu it found us in once
    // that has settled, but never a link, which would wait for blocks nobody sends.
    if (d[1] == gBrMySeat && BrBot_IsStaged(d[0]))
    {
        if (!BrBot_StartFight(d[0]))
            gBrNetlink.pendingPeer = d[0];
        return;
    }
    // Our own challenge, handed back: our engage starts its own side from the field
    // (TickWait), and nowhere else is a link ours to open. Under a fade the battle's own
    // init killed the start task, in a battle the link sat under a fight not its own,
    // and either way the hello watchdog forfeited that fight for it (POK-331 #12).
    if (d[0] == gBrMySeat)
    {
        if (FieldFree())
            BrNetlink_StartBattle(0, d[1]);
    }
    else if (d[1] == gBrMySeat)
    {
        if (FieldFree())
            BrNetlink_StartBattle(1, d[0]);
        else
            gBrNetlink.pendingPeer = d[0];
    }
}

#define BR_MENU_SETTLE 30

static void TickPendingChallenge(void)
{
    static EWRAM_DATA MainCallback sLastCb2 = NULL;

    if (gBrNetlink.pendingPeer == 0xFF || gBrNetlink.active)
        return;
    // Out of the match since it landed (the fog): there is no fight to have.
    if (gBrMatch.phase != BR_PHASE_PLAY)
    {
        gBrNetlink.pendingPeer = 0xFF;
        return;
    }
    // A battle is where a parked challenge ends. It used to be waited out and then
    // taken, but by then there is nobody to take it from: a challenger's ROM gives up on
    // a seat that says it is fighting (TickWait) or, once linked, after ten silent
    // seconds, and a bot's card goes with the battle (BrBot_Tick). Taken anyway it was a
    // link with nobody on the other end -- a second bot that engaged us on the same step
    // as the first got one, ten seconds of black after that fight (POK-330 #45).
    if (gMain.inBattle)
    {
        gBrNetlink.pendingPeer = 0xFF;
        return;
    }
    if (gMain.callback2 == CB2_Overworld)
    {
        gBrNetlink.stableFrames = 0;
        if (FuncIsActiveTask(Task_ShowStartMenu))
        {
            DestroyTask(FindTaskIdByFunc(Task_ShowStartMenu));
            HideStartMenu();
            ScriptUnfreezeObjectEvents();
            UnlockPlayerFieldControls();
        }
        if (!FieldFree())
            return; // a script (a sign, the nurse) runs to its end, a fade to its screen
    }
    else
    {
        // A sub-screen: once it has sat on one callback for a while it is a menu
        // idling, not a transition, and the start task runs inside it. The battle's
        // own init resets tasks, sprites and windows; what the menu allocated leaks
        // until the next page load, which is what PLAY AGAIN is.
        if (gMain.callback2 != sLastCb2 || gPaletteFade.active)
        {
            sLastCb2 = gMain.callback2;
            gBrNetlink.stableFrames = 0;
            return;
        }
        if (gBrNetlink.stableFrames < BR_MENU_SETTLE)
        {
            gBrNetlink.stableFrames++;
            return;
        }
    }
    // A staged bot is a trainer battle from here, as HandleChallenge's would have been.
    if (BrBot_IsStaged(gBrNetlink.pendingPeer))
    {
        if (!BrBot_StartFightHere(gBrNetlink.pendingPeer))
            return;
    }
    else
    {
        BrNetlink_StartBattle(1, gBrNetlink.pendingPeer);
    }
    gBrNetlink.pendingPeer = 0xFF;
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
        DeliverMirrored(gBrNetlink.myId ^ 1, s, size);
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
    gBattleTypeFlags &= ~BATTLE_TYPE_LINK_IN_BATTLE;
    Overworld_ResetMapMusic();
    gBrNetlink.lastOutcome = gBattleOutcome;
    // A turn the bag's clock already spent is this fight's (BrBattle_TickStall). Torn
    // down by Abandon before the menu came back to spend it, it stayed set and forfeited
    // the next link fight's first choice (POK-331 #11).
    gBrBattle.stalled = FALSE;
    gBrBattle.stallFrames = 0;
    BrEngage_OnBattleEnd(gBrNetlink.peerSeat, gBattleOutcome);
    BrMatch_SendResult(gBrMySeat, gBattleOutcome);
    Close();
    if (gBattleOutcome == B_OUTCOME_LOST || gBattleOutcome == B_OUTCOME_DREW)
        BrMatch_WhiteOut();
    gFieldCallback = NULL;
    SetMainCallback2(CB2_ReturnToField);
}

#define tState data[0]
#define tTimer data[1]

// The ! bubble over the challenger: our own trainer when we challenged, their ghost
// when they did (or ourselves if their ghost is not on this map).
static void StartExclamation(void)
{
    struct ObjectEvent *obj = &gObjectEvents[gPlayerAvatar.objectEventId];

    if (gBrNetlink.myId == 1 && gBrSeats[gBrNetlink.peerSeat].objId != BR_NO_OBJ)
        obj = &gObjectEvents[gBrSeats[gBrNetlink.peerSeat].objId];
    ObjectEventGetLocalIdAndMap(obj, &gFieldEffectArguments[0], &gFieldEffectArguments[1], &gFieldEffectArguments[2]);
    FieldEffectStart(FLDEFF_EXCLAMATION_MARK_ICON);
}

static void EnterLinkBattle(void)
{
    PlayMapChosenOrBattleBGM(MUS_VS_TRAINER);
    gBattleTypeFlags = BATTLE_TYPE_LINK | BATTLE_TYPE_TRAINER;
    gTrainerBattleOpponent_A = TRAINER_LINK_OPPONENT;
    SetMainCallback2(CB2_InitBattle);
    gMain.savedCallback = CB2_BrReturnFromBattle;
    gBrNetlink.startState = 0;
}

// The cable club's Task_StartWiredCableClubBattle, minus the cable, plus the bubble;
// then the field's own way out (BrField_Leave), once nothing else is leaving it.
static void Task_BrStartLinkBattle(u8 taskId)
{
    struct Task *task = &gTasks[taskId];

    switch (task->tState)
    {
    case 0:
        gLinkType = LINKTYPE_BATTLE;
        if (gMain.callback2 == CB2_Overworld)
            StartExclamation();
        task->tTimer = 0;
        task->tState++;
        break;
    case 1:
        if (gMain.callback2 != CB2_Overworld || !FieldEffectActiveListContains(FLDEFF_EXCLAMATION_MARK_ICON) || ++task->tTimer > 90)
        {
            task->tTimer = 0;
            task->tState++;
        }
        break;
    case 2:
        if (BrField_Leave(20, EnterLinkBattle))
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
    gBrNetlink.peerOut = FALSE;
    // Per fight, not per boot: the hello watchdog reads blocksRecv as "they have answered
    // THIS challenge", and a count left over from the last fight stood it down in every
    // fight after the first (POK-330 #7).
    gBrNetlink.blocksSent = 0;
    gBrNetlink.blocksRecv = 0;
    gBrNetlink.silent = 0;
    sRecvAsm.type = 0;
    // No outcome yet. The engine clears it only in BeginBattleIntro, after the start
    // exchange, and until then it still says how the last fight went -- which would read
    // as this one already decided (TickPeerOut).
    gBattleOutcome = 0;
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
    gBrNetlink.pendingPeer = 0xFF;
}

// How long a link battle may go without a single word from the other side before it
// is not a link battle. A real peer's first block lands within a second of the fight
// starting -- it is the start exchange, and nothing happens until both sides have
// sent one -- so this only ever fires on a link with nothing behind it: a peer that
// closed its tab in the handshake, or a challenge that reached a seat with no ROM.
//
// It matters because there is no other way out. A battle waiting for blocks that are
// not coming waits for ever, on a black screen, with the controls locked, and the
// only thing a player can do about it is reload -- which the play-test did.
#define BR_NETLINK_HELLO (10 * 60)

// The session ends without the engine ending it: tear down whatever it got to and hand
// the trainer back to the field. The caller has set gBattleOutcome.
static void Abandon(void)
{
    if (gMain.inBattle)
    {
        // The start locked the field (BrNetlink_StartBattle) and the battle's own
        // ending is what would have unlocked it.
        UnlockPlayerFieldControls();
        BrBattle_Unwind(); // -> gMain.savedCallback, which is CB2_BrReturnFromBattle
        // ...and the overworld's own callback1, which the battle never got far enough
        // to save: without it the map comes back and answers nothing, which is the
        // freeze again wearing the field's clothes.
        if (gMain.callback1 == NULL)
            gMain.callback1 = CB1_Overworld;
        return;
    }
    // Still on the way in: no battle to tear down, just the session to close.
    if (gBrNetlink.startState != 0)
    {
        if (FuncIsActiveTask(Task_BrStartLinkBattle))
            DestroyTask(FindTaskIdByFunc(Task_BrStartLinkBattle));
        BrField_CancelLeave(EnterLinkBattle);
    }
    gBrNetlink.startState = 0;
    Close();
    UnlockPlayerFieldControls();
}

// The peer is out of the match (BrNetlink_PeerOut): beaten somewhere else, fogged, or
// gone from the room. Nothing more is coming from them, so the fight is ours, and the
// RESULT CB2_BrReturnFromBattle sends is what lets anyone watching it go.
//
// Once there is a battle to end: the start task runs into one by itself within a couple
// of seconds, and closing the session under its fade would leave the screen black. A
// fight the engine has already decided is left alone -- that is how a peer who just lost
// to us goes out, and a draw is still a draw.
static void TickPeerOut(void)
{
    if (!gMain.inBattle)
        return;
    gBrNetlink.peerOut = FALSE;
    if (gBattleOutcome != 0)
        return;
    gBattleOutcome = B_OUTCOME_WON;
    Abandon();
}

void BrNetlink_PeerOut(u8 seat)
{
    if (gBrNetlink.pendingPeer == seat)
        gBrNetlink.pendingPeer = 0xFF;
    if (gBrNetlink.active && seat == gBrNetlink.peerSeat)
        gBrNetlink.peerOut = TRUE;
}

static void TickWatchdog(void)
{
    if (!gBrNetlink.active)
    {
        gBrNetlink.silent = 0;
        return;
    }
    if (gBrNetlink.peerOut)
    {
        TickPeerOut();
        return;
    }
    if (gBrNetlink.blocksRecv != 0 || gBrNetlink.loopback)
    {
        // They are there -- and a loopback peer (drivers only) is there by
        // construction: its blocks are delivered here rather than counted, because
        // they never went anywhere. A slow fight is not this function's business.
        gBrNetlink.silent = 0;
        return;
    }
    if (++gBrNetlink.silent < BR_NETLINK_HELLO)
        return;
    gBrNetlink.silent = 0;
    // Not a loss and not a flee: nobody fought. B_OUTCOME_FORFEITED is the one the
    // room reads as "something else happened" (CB2_BrReturnFromBattle's default),
    // which keeps it off BrMatch_WhiteOut and off the fled lockout.
    gBattleOutcome = B_OUTCOME_FORFEITED;
    // Their ghost is still standing in our eyeline, and the engage would challenge it
    // again the moment the grace was up.
    BrEngage_NoAnswer(gBrNetlink.peerSeat);
    Abandon();
}

void BrNetlink_Tick(void)
{
    if (gBrNetlink.active && gBrNetlink.pendingLen)
        FlushPending();
    TickPendingChallenge();
    TickWatchdog();
}
