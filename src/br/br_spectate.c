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
#include "window.h"
#include "text.h"
#include "menu.h"
#include "string_util.h"
#include "constants/characters.h"
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
#include "br/br_battle.h"
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
static EWRAM_DATA u8 sEarlyTurns[64] = {0};
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

// ---- peek: what the trainer we watch is carrying -------------------------------

// A party row on the wire, BR_MSG_PARTY's PackedMon: 100 fixed bytes, unencrypted.
#define BR_PEEK_ROW 100
#define BR_PEEK_OFF_SPECIES 0
#define BR_PEEK_OFF_LEVEL 2
#define BR_PEEK_OFF_HP 3
#define BR_PEEK_OFF_MAXHP 5
#define BR_PEEK_OFF_NICKLEN 36
#define BR_PEEK_OFF_NICK 37

// The rows live in the assembler's own heap buffer -- a whole party is 602 bytes, and
// this is a box a spectator opens now and then, not something to keep in EWRAM.
static EWRAM_DATA struct BrAssembler sPartyAsm = {0};
static EWRAM_DATA u8 sPeekSeat = 0xFF;
static EWRAM_DATA u8 sPeekWin = WINDOW_NONE;

// bg, left, top, width, height, palette, baseBlock. Palette 15 and baseBlock 0x294
// (above the HUD's ticker, below the tilemap at 0x3C0) -- see br_hud.h's tile map.
static const struct WindowTemplate sPeekTemplate = { 0, 2, 2, 18, 10, 15, 0x294 };
static const u8 sPeekColors[] = { TEXT_COLOR_DARK_GRAY, TEXT_COLOR_WHITE, TEXT_COLOR_LIGHT_GRAY };
static const u8 sText_PeekLv[] = _(" Lv");
static const u8 sText_PeekNone[] = _("no party seen yet");

// Our own party in BR_MSG_PARTY's PackedMon shape (br_wire.h): a fixed, unencrypted
// 100 bytes a page or another ROM can read without knowing this ROM's keys. Only the
// fields a spectator is allowed to see get filled; the rest stays zero.
static void PackOwnMon(struct Pokemon *mon, u8 *row)
{
    u8 name[POKEMON_NAME_LENGTH + 1];
    u16 v;
    u8 i, len;

    for (i = 0; i < BR_PEEK_ROW; i++)
        row[i] = 0;
    v = GetMonData(mon, MON_DATA_SPECIES, NULL);
    BrWire_WriteU16(row + BR_PEEK_OFF_SPECIES, v);
    row[BR_PEEK_OFF_LEVEL] = GetMonData(mon, MON_DATA_LEVEL, NULL);
    BrWire_WriteU16(row + BR_PEEK_OFF_HP, GetMonData(mon, MON_DATA_HP, NULL));
    BrWire_WriteU16(row + BR_PEEK_OFF_MAXHP, GetMonData(mon, MON_DATA_MAX_HP, NULL));
    row[7] = GetMonData(mon, MON_DATA_STATUS, NULL) != 0;
    for (i = 0; i < MAX_MON_MOVES; i++)
    {
        BrWire_WriteU16(row + 8 + i * 4, GetMonData(mon, MON_DATA_MOVE1 + i, NULL));
        row[10 + i * 4] = GetMonData(mon, MON_DATA_PP1 + i, NULL);
    }
    BrWire_WriteU16(row + 24, GetMonData(mon, MON_DATA_HELD_ITEM, NULL));
    GetMonData(mon, MON_DATA_NICKNAME, name);
    for (len = 0; len < POKEMON_NAME_LENGTH && name[len] != EOS; len++)
        row[BR_PEEK_OFF_NICK + len] = name[len];
    row[BR_PEEK_OFF_NICKLEN] = len;
}

// The answer to a peek: everyone hears it, and the asker's page is the one that keeps
// it (match/spectate.ts drops a party from a seat it is not watching).
void BrSpectate_SendParty(void)
{
    u8 *buf = Alloc(2 + PARTY_SIZE * BR_PEEK_ROW);
    u8 count = 0, i;

    if (buf == NULL)
        return;
    for (i = 0; i < PARTY_SIZE; i++)
    {
        if (GetMonData(&gPlayerParty[i], MON_DATA_SPECIES, NULL) == SPECIES_NONE)
            break;
        PackOwnMon(&gPlayerParty[i], buf + 2 + count * BR_PEEK_ROW);
        count++;
    }
    buf[0] = gBrMySeat;
    buf[1] = count;
    BrWire_SendLarge(BR_MSG_PARTY, buf, (u16)(2 + count * BR_PEEK_ROW));
    Free(buf);
}

// The seconds left on the watched fighter's choice. Their ROM publishes it as it
// turns over, and 0 once they have chosen.
static void HandleShot(const u8 *payload, u8 len)
{
    const u8 *d;
    u8 n = BrWire_Unframe(payload, len, &d);

    if (n < 2 || d[0] != gBrSpectate.follow)
        return;
    gBrSpectate.shotSecs = d[1];
}

static void HandlePeek(const u8 *payload, u8 len)
{
    const u8 *d;
    u8 n = BrWire_Unframe(payload, len, &d);

    if (n < 2 || d[1] != gBrMySeat)
        return; // a broadcast; only the trainer being asked about answers
    BrSpectate_SendParty();
}

static void ParseParty(const u8 *d, u16 n)
{
    u8 count;

    if (n < 2)
        return;
    count = d[1];
    if (count > PARTY_SIZE || (u16)(2 + count * BR_PEEK_ROW) > n)
        return;
    sPeekSeat = d[0];
    gBrSpectate.peekMons = count;
}

static void HandleParty(const u8 *payload, u8 len)
{
    if (sPartyAsm.buf == NULL)
    {
        sPartyAsm.buf = Alloc(2 + PARTY_SIZE * BR_PEEK_ROW);
        if (sPartyAsm.buf == NULL)
            return;
        sPartyAsm.cap = 2 + PARTY_SIZE * BR_PEEK_ROW;
    }
    if (BrWire_Assemble(&sPartyAsm, BR_MSG_PARTY, FALSE, payload, len))
        ParseParty(sPartyAsm.buf, sPartyAsm.total);
}

static void HandlePartyCont(const u8 *payload, u8 len)
{
    if (sPartyAsm.buf != NULL
     && BrWire_Assemble(&sPartyAsm, BR_MSG_PARTY, TRUE, payload, len))
        ParseParty(sPartyAsm.buf, sPartyAsm.total);
}

// "NICKNAME Lv12 34/56", one line per mon -- what Kanto's peek shows without handing
// over anything that would let a spectator rebuild the record.
static void DrawPeek(void)
{
    const u8 *row;
    u8 line[40];
    u8 *p;
    u8 i, j, len;

    FillWindowPixelBuffer(sPeekWin, PIXEL_FILL(TEXT_COLOR_DARK_GRAY));
    if (gBrSpectate.peekMons == 0 || sPartyAsm.buf == NULL || sPeekSeat != gBrSpectate.follow)
    {
        AddTextPrinterParameterized3(sPeekWin, FONT_SMALL, 2, 2, sPeekColors,
            (s8)TEXT_SKIP_DRAW, sText_PeekNone);
        return;
    }
    for (i = 0; i < gBrSpectate.peekMons; i++)
    {
        row = sPartyAsm.buf + 2 + i * BR_PEEK_ROW;
        len = row[BR_PEEK_OFF_NICKLEN];
        if (len > 10)
            len = 10;
        p = line;
        for (j = 0; j < len; j++)
            *p++ = row[BR_PEEK_OFF_NICK + j];
        *p = EOS;
        p = StringCopy(p, sText_PeekLv);
        p = ConvertIntToDecimalStringN(p, row[BR_PEEK_OFF_LEVEL], STR_CONV_MODE_LEFT_ALIGN, 3);
        *p++ = CHAR_SPACE;
        p = ConvertIntToDecimalStringN(p, BrWire_ReadU16(row + BR_PEEK_OFF_HP),
            STR_CONV_MODE_LEFT_ALIGN, 3);
        *p++ = CHAR_SLASH;
        ConvertIntToDecimalStringN(p, BrWire_ReadU16(row + BR_PEEK_OFF_MAXHP),
            STR_CONV_MODE_LEFT_ALIGN, 3);
        AddTextPrinterParameterized3(sPeekWin, FONT_SMALL, 2, (u8)(2 + i * 12), sPeekColors,
            (s8)TEXT_SKIP_DRAW, line);
    }
}

static void ClosePeek(void)
{
    if (sPeekWin != WINDOW_NONE)
    {
        ClearWindowTilemap(sPeekWin);
        CopyWindowToVram(sPeekWin, COPYWIN_MAP);
        RemoveWindow(sPeekWin);
        sPeekWin = WINDOW_NONE;
    }
    gBrSpectate.peeking = FALSE;
}

static void OpenPeek(void)
{
    sPeekWin = (u8)AddWindow(&sPeekTemplate);
    if (sPeekWin == WINDOW_NONE)
        return;
    DrawPeek();
    PutWindowTilemap(sPeekWin);
    CopyWindowToVram(sPeekWin, COPYWIN_FULL);
    gBrSpectate.peeking = TRUE;
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
        ClosePeek();
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
    gBrSpectate.shotSecs = 0;
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
    // No roster row yet: wait. A spectator who starts watching mid-fight has never
    // heard a place from that seat -- they are in a battle, not walking -- and giving
    // up here would cancel the watch before it began.
    if (!them->present)
        return;
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
    // START opens what they are carrying, and closes it again. Field controls are
    // locked while following, so the start menu never sees the press.
    if (JOY_NEW(START_BUTTON) || (gBrSpectate.peeking && JOY_NEW(B_BUTTON)))
    {
        if (gBrSpectate.peeking)
            ClosePeek();
        else
            OpenPeek();
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

// A heap reset does not free anything -- it forgets everything, and hands the same
// memory out again. A pointer we kept across one is a pointer into somebody else's
// allocation, so the only safe thing is to let go of all of them. The assemblers start
// over on their next first slot; a watch that was still parsing is abandoned, which is
// correct: the battle that reset the heap is the one that would have replaced it.
void BrSpectate_HeapReset(void)
{
    sBstartAsm.buf = NULL;
    sBstartAsm.cap = 0;
    sBstartAsm.type = 0;
    sPartyAsm.buf = NULL;
    sPartyAsm.cap = 0;
    sPartyAsm.type = 0;
    gBrSpectate.peekMons = 0;
    if (sPendParties != NULL)
    {
        sPendParties = NULL;
        gBrSpectate.watching = FALSE;
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
    BrNet_On(BR_MSG_SHOT, HandleShot);
    BrNet_On(BR_MSG_PEEK, HandlePeek);
    BrNet_On(BR_MSG_PARTY, HandleParty);
    BrNet_On(BR_MSG_PARTY | BR_MSG_CONT, HandlePartyCont);
    sPartyAsm.buf = NULL;
    sPartyAsm.cap = 0;
    sPartyAsm.type = 0;
    sPeekWin = WINDOW_NONE;
    sPeekSeat = BR_NO_SEAT;
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
        // The fighter's own shot clock, drawn on the replay. The replay is a turn
        // behind, so this is the pressure they are under now, not then -- which is the
        // point of showing it at all.
        if (gMain.inBattle)
        {
            if (gBrSpectate.shotSecs != 0)
                BrBattle_DrawClockSecs(gBrSpectate.shotSecs);
            else
                BrBattle_HideClock();
        }
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
