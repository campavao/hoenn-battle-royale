// The spectator stream, emit side (POK-233). See include/br/br_spectate.h.
#include "global.h"
#include "main.h"
#include "battle.h"
#include "malloc.h"
#include "link.h"
#include "overworld.h"
#include "palette.h"
#include "task.h"
#include "script.h"
#include "fieldmap.h"
#include "field_screen_effect.h"
#include "sprite.h"
#include "event_object_movement.h"
#include "field_player_avatar.h"
#include "field_weather.h"
#include "constants/field_weather.h"
#include "pokemon.h"
#include "recorded_battle.h"
#include "constants/species.h"
#include "br/br_mailbox.h"
#include "br/br_wire.h"
#include "br/br_wire_c.h"
#include "br/br_ghosts.h"
#include "br/br_netlink.h"
#include "br/br_spectate.h"

EWRAM_DATA struct BrSpectate gBrSpectate = {0};
// The per-frame turn scratch, kept in EWRAM on purpose: a plain function-local static
// lands in the battle-tight IWRAM, and the stream is never on a hot path. It doubles as
// the receive side's reassembly buffer -- the two never overlap, because a ROM that is
// fighting never spectates (ParseBstart refuses while the netlink is up) and a ROM that
// is spectating never emits (BrSpectate_Tick's first guard).
static EWRAM_DATA u8 sTurnBuf[128] = {0};
static EWRAM_DATA struct BrAssembler sBstartAsm = {0};
static EWRAM_DATA struct BrAssembler sTurnAsm = {0};

// The battle's id on the wire: the seat pair, low seat then high. The challenger is
// the lower seat (the engage's lower seat initiates), so our seat is the low one.
static u16 BattleId(void)
{
    u8 lo = gBrMySeat < gBrNetlink.peerSeat ? gBrMySeat : gBrNetlink.peerSeat;
    u8 hi = gBrMySeat < gBrNetlink.peerSeat ? gBrNetlink.peerSeat : gBrMySeat;

    return lo | (hi << 8);
}

// The seed and both parties are up: the recorded replay can be built. The seed is set
// in RecordedBattle_SetTrainerInfo after the parties are exchanged, and the peer's
// party lands in gEnemyParty over the netlink -- so all three ready together.
static bool8 BattleReady(void)
{
    return gRecordedBattleRngSeed != 0
        && GetMonData(&gPlayerParty[0], MON_DATA_SPECIES, NULL) != SPECIES_NONE
        && GetMonData(&gEnemyParty[0], MON_DATA_SPECIES, NULL) != SPECIES_NONE;
}

// [count u8][count * struct Pokemon (100 B each, real bytes -- portable across ROMs,
// keyed by each mon's own personality^otId)]. Returns bytes written.
static u16 PackParty(struct Pokemon *party, u8 *dst)
{
    const u8 *src;
    u16 idx = 1;
    u8 count = 0, i, j;

    for (i = 0; i < PARTY_SIZE; i++)
    {
        if (GetMonData(&party[i], MON_DATA_SPECIES, NULL) == SPECIES_NONE)
            break;
        count++;
        src = (const u8 *)&party[i];
        for (j = 0; j < sizeof(struct Pokemon); j++)
            dst[idx++] = src[j];
    }
    dst[0] = count;
    return idx;
}

// Publish the battle so a spectator can build the BATTLE_TYPE_RECORDED: the seed, both
// trainers' names and genders, and both real parties. Assembled on the heap -- ~1.2 KB
// once per battle is no place for a permanent EWRAM buffer.
static void SendBstart(void)
{
    u8 *buf = Alloc(28 + 2 * (1 + PARTY_SIZE * sizeof(struct Pokemon)));
    u16 len = 0, id;
    u32 seed;
    u8 i;

    if (buf == NULL)
        return;
    id = BattleId();
    buf[len++] = id & 0xFF;
    buf[len++] = id >> 8;
    seed = gRecordedBattleRngSeed;
    buf[len++] = seed & 0xFF;
    buf[len++] = (seed >> 8) & 0xFF;
    buf[len++] = (seed >> 16) & 0xFF;
    buf[len++] = (seed >> 24) & 0xFF;
    buf[len++] = gBattleTypeFlags & 0xFF;
    buf[len++] = (gBattleTypeFlags >> 8) & 0xFF;
    buf[len++] = (gBattleTypeFlags >> 16) & 0xFF;
    buf[len++] = (gBattleTypeFlags >> 24) & 0xFF;
    for (i = 0; i < PLAYER_NAME_LENGTH + 1; i++)
        buf[len++] = gLinkPlayers[0].name[i];
    for (i = 0; i < PLAYER_NAME_LENGTH + 1; i++)
        buf[len++] = gLinkPlayers[1].name[i];
    buf[len++] = gLinkPlayers[0].gender;
    buf[len++] = gLinkPlayers[1].gender;
    len += PackParty(gPlayerParty, buf + len);
    len += PackParty(gEnemyParty, buf + len);
    BrWire_SendLarge(BR_MSG_BSTART, buf, len);
    Free(buf);
}

// ---- receive: the spectator ----------------------------------------------------

// Two 6-mon parties and the header. Allocated on the first bstart slot and kept for the
// match: EWRAM is full, the heap is not.
#define BR_BSTART_MAX (28 + 2 * (1 + PARTY_SIZE * (u16)sizeof(struct Pokemon)))
// Where the packed parties start: battle u16, seed u32, flags u32, 2 names, 2 genders.
#define BR_BSTART_PARTIES 28

// A bstart parsed and waiting on the fade: the parties on the heap, the rest here.
static EWRAM_DATA struct Pokemon *sPendParties = NULL;
static EWRAM_DATA u32 sPendSeed = 0;
static EWRAM_DATA u32 sPendFlags = 0;
static EWRAM_DATA u8 sPendNames[2 * (PLAYER_NAME_LENGTH + 1)] = {0};
static EWRAM_DATA u8 sPendGenders[2] = {0};
// Turns that arrive while the field is still fading out. The fighters do not wait for
// a spectator to be ready, so the opening turn of a fight can land before the replay
// exists; held here, they are flushed into the record the moment it does.
static EWRAM_DATA u8 sEarlyTurns[96] = {0};
static EWRAM_DATA u8 sEarlyLen = 0;

static void CB2_BrReturnFromSpectate(void)
{
    Overworld_ResetMapMusic();
    gFieldCallback = NULL;
    SetMainCallback2(CB2_ReturnToField);
}

// Reads [count u8][count * struct Pokemon] at d, into aligned party slots. The wire
// bytes land at whatever offset the message put them at, and a struct copy on the GBA
// wants a word boundary -- so this copies byte by byte into a heap party the engine can
// then assign. Returns the bytes consumed, 0 if the count runs past the message.
static u16 UnpackParty(const u8 *d, u16 avail, struct Pokemon *party)
{
    u16 size = sizeof(struct Pokemon);
    u8 *dst = (u8 *)party;
    u16 i, n;
    u8 count;

    if (avail < 1)
        return 0;
    count = d[0];
    if (count > PARTY_SIZE || (u16)(1 + count * size) > avail)
        return 0;
    n = count * size;
    for (i = 0; i < n; i++)
        dst[i] = d[1 + i];
    return 1 + n;
}

#define tState data[0]

// Leaving the field for a battle is the same errand whichever battle it is: fade, let
// the fade finish, then hand the overworld's windows and tilemaps back before the battle
// claims the heap. Task_BrStartLinkBattle does it for a fight; this does it for a watch.
// Skipping the cleanup is what made the spectate crash the sound driver on agbcc.
static void Task_BrStartSpectate(u8 taskId)
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
        CleanupOverworldWindowsAndTilemaps();
        RecordedBattle_StartSpectate(sPendSeed, sPendFlags, sPendParties,
            sPendParties + PARTY_SIZE, sPendNames, sPendGenders, CB2_BrReturnFromSpectate);
        Free(sPendParties);
        sPendParties = NULL;
        if (sEarlyLen != 0)
        {
            RecordedBattle_FeedSpectate(sEarlyTurns, sEarlyLen);
            sEarlyLen = 0;
        }
        DestroyTask(taskId);
        break;
    }
}

#undef tState

// A fight worth watching landed: build the recorded battle and run it. The page decides
// who gets this -- it only forwards a bstart to a ROM whose player chose to watch.
static void ParseBstart(const u8 *d, u16 n)
{
    struct Pokemon *parties;
    u32 seed, flags;
    u16 id, off, used;

    if (n < BR_BSTART_PARTIES + 2)
        return;
    // A fighter must never self-spectate, and a replay must start from the field.
    if (gMain.inBattle || gBrNetlink.active || gBrSpectate.watching)
        return;
    if (gMain.callback2 != CB2_Overworld)
        return;
    id = BrWire_ReadU16(d);
    seed = d[2] | (d[3] << 8) | (d[4] << 16) | ((u32)d[5] << 24);
    flags = d[6] | (d[7] << 8) | (d[8] << 16) | ((u32)d[9] << 24);

    parties = AllocZeroed(2 * PARTY_SIZE * sizeof(struct Pokemon));
    if (parties == NULL)
        return;
    off = BR_BSTART_PARTIES;
    used = UnpackParty(d + off, n - off, parties);
    if (used == 0)
    {
        Free(parties);
        return;
    }
    off += used;
    if (UnpackParty(d + off, n - off, parties + PARTY_SIZE) == 0)
    {
        Free(parties);
        return;
    }

    for (used = 0; used < (u16)sizeof(sPendNames); used++)
        sPendNames[used] = d[10 + used];
    sPendGenders[0] = d[26];
    sPendGenders[1] = d[27];
    sPendSeed = seed;
    sPendFlags = flags;
    sPendParties = parties;
    sEarlyLen = 0;
    gBrSpectate.watching = TRUE;
    gBrSpectate.watchId = id;
    CreateTask(Task_BrStartSpectate, 80);
}

// The action bytes the fight produced since the last message. Fed straight into the
// replay's record, which the battle reads a turn behind.
static void ParseTurn(const u8 *d, u16 n)
{
    u8 i, len;

    if (!gBrSpectate.watching || n < 3)
        return;
    if (BrWire_ReadU16(d) != gBrSpectate.watchId)
        return;
    len = (n - 2 > 0xFF) ? 0xFF : (u8)(n - 2);
    if (sPendParties != NULL)
    {
        // Still fading into the battle: hold it. Runs concatenate, so the held bytes
        // feed as one delta once the record exists.
        for (i = 0; i < len && sEarlyLen < (u8)sizeof(sEarlyTurns); i++)
            sEarlyTurns[sEarlyLen++] = d[2 + i];
    }
    else
    {
        RecordedBattle_FeedSpectate(d + 2, len);
    }
    gBrSpectate.turns++;
}

static void HandleBstart(const u8 *payload, u8 len)
{
    if (sBstartAsm.buf == NULL)
    {
        sBstartAsm.buf = Alloc(BR_BSTART_MAX);
        if (sBstartAsm.buf == NULL)
            return;
        sBstartAsm.cap = BR_BSTART_MAX;
    }
    if (BrWire_Assemble(&sBstartAsm, BR_MSG_BSTART, FALSE, payload, len))
        ParseBstart(sBstartAsm.buf, sBstartAsm.total);
}

static void HandleBstartCont(const u8 *payload, u8 len)
{
    if (sBstartAsm.buf != NULL
     && BrWire_Assemble(&sBstartAsm, BR_MSG_BSTART, TRUE, payload, len))
        ParseBstart(sBstartAsm.buf, sBstartAsm.total);
}

static void HandleTurn(const u8 *payload, u8 len)
{
    if (BrWire_Assemble(&sTurnAsm, BR_MSG_TURN, FALSE, payload, len))
        ParseTurn(sTurnAsm.buf, sTurnAsm.total);
}

static void HandleTurnCont(const u8 *payload, u8 len)
{
    if (BrWire_Assemble(&sTurnAsm, BR_MSG_TURN, TRUE, payload, len))
        ParseTurn(sTurnAsm.buf, sTurnAsm.total);
}

// ---- follow: watching a seat walk ---------------------------------------------

static bool8 FieldRunning(void)
{
    return gMain.callback2 == CB2_Overworld && !gMain.inBattle;
}

static void ShowOwnTrainer(bool8 shown)
{
    struct ObjectEvent *self = &gObjectEvents[gPlayerAvatar.objectEventId];

    self->invisible = !shown;
    gSprites[self->spriteId].invisible = !shown;
}

// Hand the camera, the trainer and the controls back. Recentring reloads the map on
// our own tile: the camera object tracks a sprite's movement instead of jumping to it,
// so on its own it would stay wherever the ghost left it, with our trainer off screen.
// Switching to another seat skips that -- the follow warp is about to move us anyway.
static void StopFollowing(bool8 recentre)
{
    struct ObjectEvent *self;

    if (FieldRunning())
    {
        self = &gObjectEvents[gPlayerAvatar.objectEventId];
        ShowOwnTrainer(TRUE);
        CameraObjectSetFollowedSpriteId(self->spriteId);
        UnlockPlayerFieldControls();
        if (recentre && gBrSpectate.followed)
        {
            SetWarpDestination(gSaveBlock1Ptr->location.mapGroup,
                gSaveBlock1Ptr->location.mapNum, WARP_ID_NONE,
                self->currentCoords.x - MAP_OFFSET, self->currentCoords.y - MAP_OFFSET);
            DoWarp();
        }
    }
    gBrSpectate.followed = FALSE;
}

void BrSpectate_Follow(u8 seat)
{
    if (seat != BR_NO_SEAT && (seat >= BR_MAX_SEATS || seat == gBrMySeat))
        return;
    if (gBrSpectate.follow != BR_NO_SEAT && seat != gBrSpectate.follow)
        StopFollowing(seat == BR_NO_SEAT);
    gBrSpectate.follow = seat;
}

static void HandleFollow(const u8 *payload, u8 len)
{
    const u8 *d;
    u8 n = BrWire_Unframe(payload, len, &d);

    if (n < 1)
        return;
    BrSpectate_Follow(d[0]);
}

// Each frame while following: get onto their map, then ride their ghost. The camera
// object tracks a sprite's movement rather than jumping to it, so the warp is what
// puts us beside them and the camera is what keeps us there as they walk.
static void FollowTick(void)
{
    struct BrSeat *them;

    if (gBrSpectate.follow == BR_NO_SEAT)
        return;
    them = &gBrSeats[gBrSpectate.follow];
    if (!them->present)
    {
        BrSpectate_Follow(BR_NO_SEAT);
        return;
    }
    if (!FieldRunning() || ScriptContext_IsEnabled())
        return;
    if (gSaveBlock1Ptr->location.mapGroup != them->mapGroup
     || gSaveBlock1Ptr->location.mapNum != them->mapNum)
    {
        // They are somewhere else: go there. Warp coords carry no MAP_OFFSET; the
        // roster's do, the way an object event holds them.
        gBrSpectate.followed = FALSE;
        SetWarpDestination(them->mapGroup, them->mapNum, WARP_ID_NONE,
            them->x - MAP_OFFSET, them->y - MAP_OFFSET);
        DoWarp();
        return;
    }
    if (them->objId == BR_NO_OBJ)
        return; // their ghost has not spawned on this map yet
    // Reasserted every frame: a map load rebuilds our object event, and it comes back
    // visible and in charge.
    ShowOwnTrainer(FALSE);
    LockPlayerFieldControls();
    if (!gBrSpectate.followed)
    {
        CameraObjectSetFollowedSpriteId(gObjectEvents[them->objId].spriteId);
        gBrSpectate.followed = TRUE;
    }
}

void BrSpectate_Init(void)
{
    sTurnAsm.buf = sTurnBuf;
    sTurnAsm.cap = sizeof(sTurnBuf);
    sTurnAsm.type = 0;
    sBstartAsm.buf = NULL;
    sBstartAsm.cap = 0;
    sBstartAsm.type = 0;
    BrNet_On(BR_MSG_BSTART, HandleBstart);
    BrNet_On(BR_MSG_BSTART | BR_MSG_CONT, HandleBstartCont);
    BrNet_On(BR_MSG_TURN, HandleTurn);
    BrNet_On(BR_MSG_TURN | BR_MSG_CONT, HandleTurnCont);
    BrNet_On(BR_MSG_FOLLOW, HandleFollow);
    gBrSpectate.follow = BR_NO_SEAT;
}

void BrSpectate_OnResult(u8 seat)
{
    if (!gBrSpectate.watching)
        return;
    if (seat == (gBrSpectate.watchId & 0xFF) || seat == (gBrSpectate.watchId >> 8))
        RecordedBattle_EndSpectate();
}

// Only the challenger (link id 0) publishes: it records its own actions and receives
// the peer's over the netlink, so it alone holds both sides of the fight.
void BrSpectate_Tick(void)
{
    u16 id;
    u8 n;

    FollowTick();
    // Spectating: the replay owns the screen until it ends, and nothing is published.
    if (gBrSpectate.watching)
    {
        // sPendParties outlives the parse until the fade task hands it to the battle:
        // the replay is not live yet, and the watch must not retire underneath it.
        if (sPendParties == NULL && !RecordedBattle_IsSpectateLive())
            gBrSpectate.watching = FALSE;
        return;
    }
    if (!gBrNetlink.active || gBrNetlink.myId != 0)
        return;
    if (!gMain.inBattle)
    {
        gBrSpectate.started = FALSE; // ready for the next battle
        return;
    }

    if (!gBrSpectate.started && BattleReady())
    {
        SendBstart();
        gBrSpectate.started = TRUE;
    }

    // The action bytes recorded since last frame -- a handful; sTurnBuf holds a whole
    // turn arriving in one frame without splitting a run.
    id = BattleId();
    sTurnBuf[0] = id & 0xFF;
    sTurnBuf[1] = id >> 8;
    n = RecordedBattle_BufferSpectateDelta(sTurnBuf + 2);
    if (n == 0)
        return;
    if ((u16)(2 + n) <= BR_SLOT_PAYLOAD_MAX)
        BrWire_Send(BR_MSG_TURN, sTurnBuf, 2 + n);
    else
        BrWire_SendLarge(BR_MSG_TURN, sTurnBuf, 2 + n);
    gBrSpectate.turns++;
    gBrSpectate.bytes += n;
}
