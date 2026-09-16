// The spectator stream, emit side (POK-233). See include/br/br_spectate.h.
#include "global.h"
#include "main.h"
#include "battle.h"
#include "recorded_battle.h"
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

// Only the challenger (link id 0) streams: it records its own actions and receives the
// peer's over the netlink, so it alone holds both sides of the fight.
void BrSpectate_Tick(void)
{
    // sTurnBuf (EWRAM) holds the [battle][delta] payload; 128 leaves ample room for a
    // whole turn arriving from the peer in one frame without ever splitting a run.
    u16 id;
    u8 n;

    if (!gBrNetlink.active || gBrNetlink.myId != 0 || !gMain.inBattle)
        return;

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
