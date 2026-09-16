#ifndef GUARD_BR_SPECTATE_H
#define GUARD_BR_SPECTATE_H

// The spectator stream (POK-233): a fighter (the challenger, which sees both sides'
// actions) publishes its link battle so an eliminated player can replay it on the real
// battle screen as a BATTLE_TYPE_RECORDED, running a turn behind. This half is the
// emit; the replay side sets up the recorded battle from these messages.

struct BrSpectate
{
    /* 0 */ u16 turns;   // BR_MSG_TURN messages emitted, for drivers
    /* 2 */ u16 bytes;   // action bytes streamed
    /* 4 */ u8 started;  // BR_MSG_BSTART sent for the current battle
    /* 5 */ u8 pad[3];
};

extern struct BrSpectate gBrSpectate;

// Each frame: emit BR_MSG_BSTART once the battle is set up, then stream new action
// bytes as BR_MSG_TURN (challenger only, in a battle).
void BrSpectate_Tick(void);

#endif // GUARD_BR_SPECTATE_H
