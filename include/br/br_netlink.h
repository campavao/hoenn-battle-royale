#ifndef GUARD_BR_NETLINK_H
#define GUARD_BR_NETLINK_H

// The third link transport (POK-229): Emerald's own link battle with the cable replaced
// by BT messages over the mailbox. link.c's block interface (SendBlock, the received
// flags, the player count and ids) is answered from here while gWirelessCommType is
// BR_WIRELESS_NETLINK; the battle code above it is untouched. Two players only: link
// id 0 is the challenger (the link master), id 1 the challenged.

#define BR_WIRELESS_NETLINK 5

struct BrNetlink
{
    /* 0 */ u8 active;      // a session is open (gWirelessCommType is ours)
    /* 1 */ u8 myId;        // 0 or 1
    /* 2 */ u8 peerSeat;    // the other side's roster seat
    /* 3 */ u8 recvFlags;   // bit per link id, like gBlockReceivedStatus
    /* 4 */ u16 sendSeq;    // BT counter, ours
    /* 6 */ u16 recvSeq;    // last BT counter seen from the peer
    /* 8 */ u8 loopback;    // drivers: deliver our own blocks as the peer's too
    /* 9 */ u8 pendingLen;  // a block that did not fit the ring yet, in pending[]
    /* 10 */ u8 startState; // the battle-start task's step, 0 idle
    /* 11 */ u8 lastOutcome;
    /* 12 */ u16 blocksSent;
    /* 14 */ u16 blocksRecv;
};

extern struct BrNetlink gBrNetlink;

void BrNetlink_Init(void);
void BrNetlink_Tick(void);
// Opens a session with the peer seat, as link id myId, and starts the link battle
// (fade, CB2_InitBattle) from the overworld.
void BrNetlink_StartBattle(u8 myId, u8 peerSeat);

// link.c asks these while gWirelessCommType == BR_WIRELESS_NETLINK.
bool8 BrNetlink_SendBlock(const void *src, u16 size);
bool8 BrNetlink_IsTaskFinished(void);
u8 BrNetlink_GetBlockReceivedStatus(void);
void BrNetlink_ResetBlockReceivedFlag(u8 who);
u8 BrNetlink_GetMultiplayerId(void);

#endif // GUARD_BR_NETLINK_H
