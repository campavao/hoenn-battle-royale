#ifndef GUARD_BR_NETLINK_H
#define GUARD_BR_NETLINK_H

// The third link transport (POK-229): Emerald's own link battle with the cable replaced
// by BT messages over the mailbox. link.c's block interface (SendBlock, the received
// flags, the player count and ids) is answered from here while gWirelessCommType is
// BR_WIRELESS_NETLINK; the battle code above it is untouched. Two players only: link
// id 0 is the challenger (the link master), id 1 the challenged.

#define BR_WIRELESS_NETLINK 5

// Upstream asks `if (gWirelessCommType)` in about sixty places, meaning "wireless", and 5
// passes every one of them (POK-330 #31). link.c's own are hooked (BR_NETLINK_ACTIVE).
// These are the others a netlink battle goes through; re-read them after a pret merge,
// and any new truthy test on the battle path:
//
//   Relied on -- with a 0 here the battle would wait for a cable:
//     battle_controllers.c   Task_HandleSendLinkBuffersData, SENDTASK_STATE_COUNT_PLAYERS:
//                            skips counting cable players (GetLinkPlayerCount_2 says 0)
//     battle_controller_player.c  SetBattleEndCallbacks / SetLinkBattleEndCallbacks: the
//                            end goes through the hooked standby and IsLinkTaskFinished,
//                            not a wait for gReceivedRemoteLinkPlayers to drop
//     battle_main.c          EndLinkBattleInSteps (8, 9) and AskRecordBattle's end: no
//                            close-link callback, straight on to gMain.savedCallback
//   A no-op for us:
//     battle_controllers.c   HandleLinkBattleSetup: SetWirelessCommType1 and OpenLink only
//                            act while gReceivedRemoteLinkPlayers is 0, and it is set
//   RFU code that runs, and is safe only because AgbMain's InitRFU runs InitRFUAPI at every
//   boot, leaving gRfuLinkStatus pointing into gRfuAPIBuffer with parentChild ==
//   MODE_NEUTRAL (netlink-loop.txt asserts both):
//     main.c                 VBlankIntr: RfuVSync, whose rfu_syncVBlank returns at once
//     battle_main.c          CB2_HandleStartBattle, and reshow_battle_screen.c: the
//                            wireless status indicator, which reads gRfuLinkStatus

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
    /* 12 */ u16 blocksSent;  // this session's, like silent: StartBattle zeroes all three
    /* 14 */ u16 blocksRecv;
    /* 16 */ u8 pendingPeer;  // a CHALLENGE that landed in a menu waits here, 0xFF none
    /* 17 */ u8 stableFrames; // frames the current non-field callback2 has held
    /* 18 */ u16 silent;      // frames this session has been open with nothing heard
    /* 20 */ u8 peerOut;      // the peer went out mid-session: the fight is ours
};

extern struct BrNetlink gBrNetlink;

void BrNetlink_Init(void);
void BrNetlink_Tick(void);
// Opens a session with the peer seat, as link id myId, and starts the link battle
// (fade, CB2_InitBattle) from the overworld.
void BrNetlink_StartBattle(u8 myId, u8 peerSeat);
// BR_MSG_OUT for a seat (br_match.c): a challenge from them that is still waiting is
// dropped, and a fight with them that has no outcome yet is won (POK-330 #5).
void BrNetlink_PeerOut(u8 seat);

// link.c asks these while gWirelessCommType == BR_WIRELESS_NETLINK.
bool8 BrNetlink_SendBlock(const void *src, u16 size);
bool8 BrNetlink_IsTaskFinished(void);
u8 BrNetlink_GetBlockReceivedStatus(void);
void BrNetlink_ResetBlockReceivedFlag(u8 who);
u8 BrNetlink_GetMultiplayerId(void);

#endif // GUARD_BR_NETLINK_H
