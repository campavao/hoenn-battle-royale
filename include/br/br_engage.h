#ifndef GUARD_BR_ENGAGE_H
#define GUARD_BR_ENGAGE_H

// The forced eyeline engage (POK-230): walk into another trainer's line of sight, or
// look down theirs, and the fight starts. No consent step. The lower seat initiates
// on a tie so both sides never challenge at once; the higher seat only ever answers
// the CHALLENGE the page relays to it.

#define BR_SIGHT_RANGE 5

struct BrEngage
{
    /* 0 */ u8 lastTarget;   // seat we last challenged, 0xFF none
    /* 1 */ u8 cooldown;     // frames before another challenge may go out
    /* 2 */ u16 nonce;
    /* 4 */ u16 challenges;  // sent so far, for drivers
    /* 6 */ u8 fledFrom;     // a seat we fled from: no re-challenge while fledLockout > 0, 0xFF none
    /* 7 */ u8 waitSeat;     // challenged, still waiting to learn what kind of fight it is, 0xFF none
    /* 8 */ u16 fledLockout; // frames left on the fled-from lockout
    /* 10 */ u8 waitFrames;  // frames left on that wait
    /* 11 */ u8 settleSeat;  // the engage is settling with this seat before its fight starts, 0xFF none
};

extern struct BrEngage gBrEngage;

void BrEngage_Init(void);
void BrEngage_Tick(void);
// Called when a link battle returns to the field: a grace on both sides, and a longer
// lockout on the seat we fled from (fleeing is not a way to pick when the fight
// restarts -- the pursuer keeps coming, but we do not turn and re-engage them).
void BrEngage_OnBattleEnd(u8 peerSeat, u8 outcome);
// A challenge that was never answered: the same lockout a fleer gets, and no word to
// the room. Only br_netlink.c's watchdog calls it.
void BrEngage_NoAnswer(u8 peerSeat);

// The settle: every fight an engage starts on the field waits until both screens show
// the same thing (Cam's play-test, 2026-10-05: "make sure what one person is seeing in
// the overworld ahead of time is the same as the other"). Our trainer is frozen where it
// stands, the opponent's ghost plays out every step the wire already gave it, and only
// then does the fight start. How it starts:
#define BR_SETTLE_LINK_FIRST 0  // a link battle as link id 0, the challenger
#define BR_SETTLE_LINK_ANSWER 1 // a link battle as link id 1, the challenged
#define BR_SETTLE_BOT 2         // a bot's staged trainer battle (POK-238)
// FALSE when one is already settling or a fight is already on its way.
bool8 BrEngage_Settle(u8 seat, u8 how);
// Somebody's challenge reached us while ours was still waiting to learn what kind of
// fight it is: theirs is taken, ours is dropped, and our trainer stays frozen for the
// settle theirs starts. FALSE when we were not waiting.
bool8 BrEngage_YieldWait(void);

#endif // GUARD_BR_ENGAGE_H
