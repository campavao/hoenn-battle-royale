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
    /* 5 */ u8 watching; // a replay of someone else's battle is on screen
    /* 6 */ u16 watchId; // the battle being watched, as BR_MSG_BSTART's battle id
    /* 8 */ u8 follow;   // seat whose walk we are watching, BR_NO_SEAT for nobody
    /* 9 */ u8 followed; // the camera is on their ghost: its sprite id + 1 (0 while warping to their map)
    /* 10 */ u8 peeking; // the peek box is up
    /* 11 */ u8 peekMons; // party rows held for the followed seat, 0..PARTY_SIZE
    /* 12 */ u8 shotSecs; // the followed seat's shot clock, 0 = no choice pending
    /* 13 */ u8 peekPage; // which page of the peek box: team, a mon's moves, the bag (POK-297)
    /* 14 */ u8 warpWait; // frames a warp to the followed seat's map is left to get going
    /* 15 */ u8 catchUp; // the replay is turns behind what has arrived: the page fast-forwards
};

// gBrSpectate.follow when nobody is being followed. Matches the wire's stop byte.
#define BR_NO_SEAT 0xFF

extern struct BrSpectate gBrSpectate;

// Registers the BSTART/TURN handlers. A spectator only ever receives what the page
// chooses to deliver: the page is the "watch this fight" gate, the ROM just plays what
// lands.
void BrSpectate_Init(void);
// Each frame: emit BR_MSG_BSTART once the battle is set up, then stream new action
// bytes as BR_MSG_TURN (challenger only, in a battle); on a spectator, retire the watch
// once the replay is over.
void BrSpectate_Tick(void);
// A fighter's battle concluded (from br_match's RESULT handler). When it is the battle
// we are watching, the stream is closed: the replay plays out what it has and ends
// rather than waiting for a turn that is never coming.
void BrSpectate_OnResult(u8 seat);
// A seat's BUSY changed (br_ghosts.c). A wild POKeMON's fight sends no RESULT -- nobody
// else's seat is in it -- so its fighter being back on the map is what ends its replay.
void BrSpectate_OnBusy(u8 seat);
// Watch a seat walk (BR_NO_SEAT to stop). The camera rides their ghost, our own
// trainer goes invisible where it stood, and field controls are locked.
void BrSpectate_Follow(u8 seat);
// The camera off the followed ghost and back on our own trainer, where it stands, for
// as long as that ghost's sprite is about to go or jump (br_ghosts.c). FollowTick takes
// the ghost up again, centred, once it is at rest.
void BrSpectate_LetGo(void);
// The heap was just re-initialised (malloc.c's InitHeap, which CB2_InitBattle calls on
// the way into every battle). Everything this module is holding there is gone with it.
void BrSpectate_HeapReset(void);
// Our party, on the wire (BR_MSG_PARTY). Sent when somebody peeks, and again whenever
// the team changes -- a spectator's peek box and the director both want it current.
void BrSpectate_SendParty(void);
// The same message for somebody else's party under somebody else's seat -- how a bot's
// team gets back to the page that walks it after a fight it lost mons in (POK-238).
void BrSpectate_SendPartyOf(struct Pokemon *party, u8 seat);
// Is this ROM publishing the fight it is in? A replay is built from the fight's seed and
// its choices alone, so a published fight must draw nothing from the generator the
// replay does not: no turn of it on the frame (VBlankCB_Battle), no fog on the clock.
bool8 BrSpectate_Publishing(void);

#endif // GUARD_BR_SPECTATE_H
