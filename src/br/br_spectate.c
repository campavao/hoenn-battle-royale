// The spectator stream, emit side (POK-233). See include/br/br_spectate.h.
#include "global.h"
#include "main.h"
#include "battle.h"
#include "malloc.h"
#include "link.h"
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
// lands in the battle-tight IWRAM, and the stream is never on a hot path.
static EWRAM_DATA u8 sTurnBuf[128] = {0};

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

// Only the challenger (link id 0) publishes: it records its own actions and receives
// the peer's over the netlink, so it alone holds both sides of the fight.
void BrSpectate_Tick(void)
{
    u16 id;
    u8 n;

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
