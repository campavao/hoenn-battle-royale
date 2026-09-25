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
#include "constants/items.h"
#include "constants/moves.h"
#include "data.h"
#include "item.h"
#include "money.h"
#include "br/br_mailbox.h"
#include "br/br_wire.h"
#include "br/br_wire_c.h"
#include "br/br_ghosts.h"
#include "br/br_netlink.h"
#include "br/br_battle.h"
#include "br/br_spectate.h"
#include "br/br_duel.h"

EWRAM_DATA struct BrSpectate gBrSpectate = {0};
// The per-frame turn scratch, kept in EWRAM on purpose: a plain function-local static
// lands in the battle-tight IWRAM, and the stream is never on a hot path. It doubles as
// the receive side's reassembly buffer -- the two never overlap, because a ROM that is
// fighting never spectates (ParseBstart refuses while the netlink is up) and a ROM that
// is spectating never emits (BrSpectate_Tick's first guard).
static EWRAM_DATA u8 sTurnBuf[BR_CAP_TURN] = {0};
static EWRAM_DATA struct BrAssembler sBstartAsm = {0};
static EWRAM_DATA struct BrAssembler sTurnAsm = {0};

// The battle's id on the wire: the seat pair, low seat then high. The challenger is
// the lower seat (the engage's lower seat initiates), so our seat is the low one.
//
// A proxy duel (POK-238) is two bots' seats, neither of them ours: the hidden instance
// has no seat at all. Its fight is published under the pair the same way (POK-300), so
// a spectator following either bot is handed it like any other.
static u16 BattleId(void)
{
    u8 mine = gBrDuel.running ? gBrDuel.seatA : gBrMySeat;
    u8 theirs = gBrDuel.running ? gBrDuel.seatB : gBrNetlink.peerSeat;
    u8 lo = mine < theirs ? mine : theirs;
    u8 hi = mine < theirs ? theirs : mine;

    return lo | (hi << 8);
}

// Who publishes: the master of a link battle, and the proxy instance for the duel it is
// fighting (POK-300). Nobody else -- a spectator never emits, and the bot fight in a
// player's own ROM is that player's, not a thing the room watches.
static bool8 Publishing(void)
{
    if (gBrDuel.running)
        return TRUE;
    return gBrNetlink.active && gBrNetlink.myId == 0;
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
    u32 seed, flags;
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
    // A duel is BATTLE_TYPE_TRAINER with both sides on the AI. The replay is built for a
    // link fight's flags (RecordedBattle_StartSpectate masks LINK off and puts RECORDED_LINK
    // on), so a duel goes out looking like one: the same shape the replay already plays.
    flags = gBattleTypeFlags;
    if (gBrDuel.running)
        flags |= BATTLE_TYPE_LINK | BATTLE_TYPE_IS_MASTER;
    buf[len++] = flags & 0xFF;
    buf[len++] = (flags >> 8) & 0xFF;
    buf[len++] = (flags >> 16) & 0xFF;
    buf[len++] = (flags >> 24) & 0xFF;
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
STATIC_ASSERT(BR_CAP_BSTART >= 28 + 2 * (1 + PARTY_SIZE * sizeof(struct Pokemon)), BrBstartCapHoldsTwoParties)
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
        sBstartAsm.buf = Alloc(BR_CAP_BSTART);
        if (sBstartAsm.buf == NULL)
            return;
        sBstartAsm.cap = BR_CAP_BSTART;
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
#define BR_PEEK_OFF_STATUS 7
#define BR_PEEK_OFF_MOVES 8
// The bag behind the rows (POK-297): money u32, stacks u8, then id u16 + n u8 a stack.
// web/src/net/wire.ts's PARTY_BAG_MAX.
#define BR_PEEK_BAG_MAX 20
STATIC_ASSERT(BR_CAP_PARTY >= 2 + PARTY_SIZE * BR_PEEK_ROW + 5 + 3 * BR_PEEK_BAG_MAX, BrPartyCapHoldsARowsAndBag)
#define BR_PEEK_OFF_NICKLEN 36
#define BR_PEEK_OFF_NICK 37

// The rows live in the assembler's own heap buffer -- a whole party is 602 bytes, and
// this is a box a spectator opens now and then, not something to keep in EWRAM.
static EWRAM_DATA struct BrAssembler sPartyAsm = {0};
static EWRAM_DATA u8 sPeekSeat = 0xFF;
static EWRAM_DATA u8 sPeekWin = WINDOW_NONE;

// bg, left, top, width, height, palette, baseBlock. Palette 15, and the 180 tiles from
// 0x008: where the field puts its own transient boxes (Safari balls, money, a script's
// multichoice), none of which can open while we are following somebody -- field controls
// are locked. It used to share the HUD box's 0x294, which ran to 0x347: past the end of
// BG0's tiles at 0x300 and clean through BG2's tilemap. See br_hud.h's tile map.
static const struct WindowTemplate sPeekTemplate = { 0, 2, 2, 18, 10, 15, 0x008 };
STATIC_ASSERT(0x008 + 18 * 10 <= 0x107, BrPeekFitsBelowTheMapNamePopup)
static const u8 sPeekColors[] = { TEXT_COLOR_DARK_GRAY, TEXT_COLOR_WHITE, TEXT_COLOR_LIGHT_GRAY };
static const u8 sText_PeekLv[] = _(" Lv");
static const u8 sText_PeekNone[] = _("no party seen yet");

// Which one, not just whether (POK-297): a spectator judging the next fight wants to know
// SLP from PAR. 0 none, then the order sText_PeekStatus is written in.
static u8 StatusCode(u32 status)
{
    if (status & STATUS1_SLEEP)
        return 1;
    if (status & STATUS1_TOXIC_POISON)
        return 6;
    if (status & STATUS1_POISON)
        return 2;
    if (status & STATUS1_BURN)
        return 3;
    if (status & STATUS1_FREEZE)
        return 4;
    if (status & STATUS1_PARALYSIS)
        return 5;
    return 0;
}

// What we are carrying, behind our own party's rows: the pockets a fight or a MOVES
// screen can spend. Not the key items, and not the eight HMs -- everybody has those.
static u16 PackOwnBag(u8 *out)
{
    static const u8 sPockets[] = { ITEMS_POCKET, BALLS_POCKET, BERRIES_POCKET, TMHM_POCKET };
    u32 money = GetMoney(&gSaveBlock1Ptr->money);
    u8 count = 0, p, i;

    out[0] = money;
    out[1] = money >> 8;
    out[2] = money >> 16;
    out[3] = money >> 24;
    for (p = 0; p < ARRAY_COUNT(sPockets); p++)
    {
        struct BagPocket *pocket = &gBagPockets[sPockets[p]];

        for (i = 0; i < pocket->capacity && count < BR_PEEK_BAG_MAX; i++)
        {
            u16 item = pocket->itemSlots[i].itemId;
            u16 n = pocket->itemSlots[i].quantity ^ (u16)gSaveBlock2Ptr->encryptionKey;

            if (item == ITEM_NONE || n == 0 || item >= ITEM_HM01)
                continue;
            BrWire_WriteU16(out + 5 + 3 * count, item);
            out[5 + 3 * count + 2] = n > 99 ? 99 : n;
            count++;
        }
    }
    out[4] = count;
    return 5 + 3 * count;
}

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
    row[BR_PEEK_OFF_STATUS] = StatusCode(GetMonData(mon, MON_DATA_STATUS, NULL));
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
//
// Any party, under any seat: a bot's team lives on the host's page, but the fight it
// just had ran here (POK-238), so this ROM is the only thing that knows what came out
// of it alive. Reporting gEnemyParty under the bot's seat is how the page finds out.
void BrSpectate_SendPartyOf(struct Pokemon *party, u8 seat)
{
    u8 *buf = Alloc(BR_CAP_PARTY);
    u16 len;
    u8 count = 0, i;

    if (buf == NULL)
        return;
    for (i = 0; i < PARTY_SIZE; i++)
    {
        if (GetMonData(&party[i], MON_DATA_SPECIES, NULL) == SPECIES_NONE)
            break;
        PackOwnMon(&party[i], buf + 2 + count * BR_PEEK_ROW);
        count++;
    }
    buf[0] = seat;
    buf[1] = count;
    len = 2 + count * BR_PEEK_ROW;
    // Our own bag goes with our own team. A bot's lives on the host's page, which is what
    // answers a peek about it; its party only comes through here after a fight.
    if (party == gPlayerParty)
        len += PackOwnBag(buf + len);
    if (count > 0)
        BrWire_SendLarge(BR_MSG_PARTY, buf, len);
    Free(buf);
}

void BrSpectate_SendParty(void)
{
    BrSpectate_SendPartyOf(gPlayerParty, gBrMySeat);
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

static void RefreshPeek(void);

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
    // The asking is on a timer (match/spectate.ts), so an open box is a live one: HP
    // moves, a potion leaves the bag. It used to show whatever was true when it opened.
    RefreshPeek();
}

static void HandleParty(const u8 *payload, u8 len)
{
    if (sPartyAsm.buf == NULL)
    {
        sPartyAsm.buf = Alloc(BR_CAP_PARTY);
        if (sPartyAsm.buf == NULL)
            return;
        sPartyAsm.cap = BR_CAP_PARTY;
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

// "NICKNAME Lv12 34/56 PSN", one line per mon -- and, a page on, what each of them can
// do and what their trainer is carrying (POK-297). Kanto's spectator reads "team with
// levels, HP and moves, their bag": enough to judge whether the trainer they are watching
// can win the next fight, which is mostly a question about moves and FULL RESTOREs.
//
// Pages, A or RIGHT for the next and LEFT for the last: the team, then one page a mon
// (its four moves and their PP), then the bag five stacks at a time under the money.
#define BR_PEEK_BAG_PER_PAGE 5

static const u8 sText_PeekPP[] = _(" PP ");
static const u8 sText_PeekTimes[] = _(" x");
static const u8 sText_PeekMoney[] = _("MONEY ");
static const u8 sText_PeekNoBag[] = _("bag not seen yet");
static const u8 sText_PeekEmpty[] = _("nothing in the bag");
static const u8 sText_PeekStatus[][5] =
{
    _(""), _(" SLP"), _(" PSN"), _(" BRN"), _(" FRZ"), _(" PAR"), _(" TOX"),
};

// The bag rides behind the last party row: money u32, stacks u8, then id u16 and n u8 a
// stack. NULL when the party came without one (an older page, a champion's parade).
static const u8 *PeekBag(void)
{
    u16 off = 2 + gBrSpectate.peekMons * BR_PEEK_ROW;

    if (sPartyAsm.buf == NULL || (u16)(off + 5) > sPartyAsm.total)
        return NULL;
    return sPartyAsm.buf + off;
}

static u8 PeekBagStacks(void)
{
    const u8 *bag = PeekBag();
    u16 room;
    u8 n;

    if (bag == NULL)
        return 0;
    n = bag[4];
    room = (sPartyAsm.total - (2 + gBrSpectate.peekMons * BR_PEEK_ROW) - 5) / 3;
    if (n > room)
        n = room;
    return n > BR_PEEK_BAG_MAX ? BR_PEEK_BAG_MAX : n;
}

static u8 PeekPages(void)
{
    u8 stacks = PeekBagStacks();
    u8 bagPages = stacks == 0 ? 1 : (stacks + BR_PEEK_BAG_PER_PAGE - 1) / BR_PEEK_BAG_PER_PAGE;

    return 1 + gBrSpectate.peekMons + bagPages;
}

static void PeekLine(u8 row, const u8 *text)
{
    AddTextPrinterParameterized3(sPeekWin, FONT_SMALL, 2, (u8)(2 + row * 12), sPeekColors,
        (s8)TEXT_SKIP_DRAW, text);
}

// "NICKNAME Lv12" into `p`; returns the new end.
static u8 *PeekWho(u8 *p, const u8 *row)
{
    u8 j, len = row[BR_PEEK_OFF_NICKLEN];

    if (len > 10)
        len = 10;
    for (j = 0; j < len; j++)
        *p++ = row[BR_PEEK_OFF_NICK + j];
    *p = EOS;
    p = StringCopy(p, sText_PeekLv);
    return ConvertIntToDecimalStringN(p, row[BR_PEEK_OFF_LEVEL], STR_CONV_MODE_LEFT_ALIGN, 3);
}

static void DrawPeekTeam(void)
{
    u8 line[40];
    u8 *p;
    u8 i;

    for (i = 0; i < gBrSpectate.peekMons; i++)
    {
        const u8 *row = sPartyAsm.buf + 2 + i * BR_PEEK_ROW;

        p = PeekWho(line, row);
        *p++ = CHAR_SPACE;
        p = ConvertIntToDecimalStringN(p, BrWire_ReadU16(row + BR_PEEK_OFF_HP),
            STR_CONV_MODE_LEFT_ALIGN, 3);
        *p++ = CHAR_SLASH;
        p = ConvertIntToDecimalStringN(p, BrWire_ReadU16(row + BR_PEEK_OFF_MAXHP),
            STR_CONV_MODE_LEFT_ALIGN, 3);
        if (row[BR_PEEK_OFF_STATUS] < ARRAY_COUNT(sText_PeekStatus))
            StringCopy(p, sText_PeekStatus[row[BR_PEEK_OFF_STATUS]]);
        PeekLine(i, line);
    }
}

static void DrawPeekMoves(u8 index)
{
    const u8 *row = sPartyAsm.buf + 2 + index * BR_PEEK_ROW;
    u8 line[40];
    u8 *p;
    u8 i, shown = 1;

    PeekWho(line, row);
    PeekLine(0, line);
    for (i = 0; i < MAX_MON_MOVES; i++)
    {
        u16 move = BrWire_ReadU16(row + BR_PEEK_OFF_MOVES + i * 4);

        if (move == MOVE_NONE || move >= MOVES_COUNT)
            continue;
        p = StringCopy(line, gMoveNames[move]);
        p = StringCopy(p, sText_PeekPP);
        ConvertIntToDecimalStringN(p, row[BR_PEEK_OFF_MOVES + i * 4 + 2], STR_CONV_MODE_LEFT_ALIGN, 2);
        PeekLine(shown++, line);
    }
}

static void DrawPeekBag(u8 page)
{
    const u8 *bag = PeekBag();
    u8 line[40];
    u8 *p;
    u8 i, stacks = PeekBagStacks();
    u32 money;

    if (bag == NULL)
    {
        PeekLine(0, sText_PeekNoBag);
        return;
    }
    money = bag[0] | (bag[1] << 8) | (bag[2] << 16) | ((u32)bag[3] << 24);
    p = StringCopy(line, sText_PeekMoney);
    ConvertIntToDecimalStringN(p, money, STR_CONV_MODE_LEFT_ALIGN, 6);
    PeekLine(0, line);
    if (stacks == 0)
    {
        PeekLine(1, sText_PeekEmpty);
        return;
    }
    for (i = 0; i < BR_PEEK_BAG_PER_PAGE && page * BR_PEEK_BAG_PER_PAGE + i < stacks; i++)
    {
        const u8 *it = bag + 5 + 3 * (page * BR_PEEK_BAG_PER_PAGE + i);
        u16 item = BrWire_ReadU16(it);

        if (item == ITEM_NONE || item >= ITEMS_COUNT)
            continue;
        p = StringCopy(line, GetItemName(item));
        p = StringCopy(p, sText_PeekTimes);
        ConvertIntToDecimalStringN(p, it[2], STR_CONV_MODE_LEFT_ALIGN, 2);
        PeekLine(1 + i, line);
    }
}

static void DrawPeek(void)
{
    FillWindowPixelBuffer(sPeekWin, PIXEL_FILL(TEXT_COLOR_DARK_GRAY));
    if (gBrSpectate.peekMons == 0 || sPartyAsm.buf == NULL || sPeekSeat != gBrSpectate.follow)
    {
        PeekLine(0, sText_PeekNone);
        return;
    }
    // A party that shrank under us (a faint, a release) can leave the page past the end.
    if (gBrSpectate.peekPage >= PeekPages())
        gBrSpectate.peekPage = 0;
    if (gBrSpectate.peekPage == 0)
        DrawPeekTeam();
    else if (gBrSpectate.peekPage <= gBrSpectate.peekMons)
        DrawPeekMoves(gBrSpectate.peekPage - 1);
    else
        DrawPeekBag(gBrSpectate.peekPage - 1 - gBrSpectate.peekMons);
}

// A or RIGHT for the next page, LEFT for the one before. Round and round: there is no
// cursor and nothing to choose, only more to read.
static void TurnPeekPage(s8 by)
{
    u8 pages = PeekPages();

    gBrSpectate.peekPage = (u8)((gBrSpectate.peekPage + pages + by) % pages);
    DrawPeek();
    CopyWindowToVram(sPeekWin, COPYWIN_GFX);
}

static void RefreshPeek(void)
{
    if (!gBrSpectate.peeking || sPeekWin == WINDOW_NONE)
        return;
    DrawPeek();
    CopyWindowToVram(sPeekWin, COPYWIN_GFX);
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
    gBrSpectate.peekPage = 0;
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
    else if (gBrSpectate.peeking && (JOY_NEW(A_BUTTON) || JOY_NEW(DPAD_RIGHT)))
    {
        TurnPeekPage(1);
    }
    else if (gBrSpectate.peeking && JOY_NEW(DPAD_LEFT))
    {
        TurnPeekPage(-1);
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
    if (!Publishing())
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
