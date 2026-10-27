#ifndef GUARD_BR_SPECTATE_H
#define GUARD_BR_SPECTATE_H

#include "br/br_config.h"

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
    /* 15 */ u8 catchUp; // BR_CATCH_UP_*: how far behind the fight the replay is, for the page's pace
};

// gBrSpectate.catchUp. TURNS: turns of the fight are waiting, a late watch's backlog --
// the page runs the replay at 8x, silent. LAG: the fighter has ended a turn the replay is
// still playing, or chosen one it has not reached -- 3x with its sound, until it is level
// (HBR-63: the replay's text waits out its timers where the fighter taps through it, and
// a watched fight ran seconds behind and further each turn).
#define BR_CATCH_UP_TURNS 1
#define BR_CATCH_UP_LAG   2

// gBrSpectate.follow when nobody is being followed. Matches the wire's stop byte.
#define BR_NO_SEAT 0xFF

// A battler's record in a replay, in action bytes: recorded_battle.c's
// BATTLER_RECORD_SIZE, which asserts the two agree. Turns that land before the replay
// exists are held up to this much (br_spectate.c's BrEarlyTurns).
#define BR_SPECTATE_RECORD_SIZE 664

extern struct BrSpectate gBrSpectate;

// How janky watching was, as numbers (POK-376): the page reads these when a match is
// decided and sends them to the relay's log, so a teleport or a stuck replay in a real
// match shows up in the play log instead of only in somebody's memory of it. Counted
// from boot; the page sends what changed over the match.
struct BrJank
{
    /* 0 */ u16 snaps;     // a ghost on our map snapped to its roster cell (its queue overflowed)
    /* 2 */ u16 camSnaps;  // ...and it was the one the camera rides
    /* 4 */ u16 lost;      // a step whose cell was not where the ghost's walk had it
    /* 6 */ u16 stalls;    // a live replay waited BR_JANK_STALL_SECS or more on the stream
    /* 8 */ u16 longest;   // the longest such wait, in seconds
    /* 10 */ u16 checks;   // replayed turns checked against the fighter's (BR_SPECTATE_CHECK)
    /* 12 */ u16 drifts;   // ...that disagreed: the replay was showing a different fight
    /* 14 */ u16 watchSecs; // seconds spent following somebody or replaying their fight
};
BR_OFFSET(BrJank, snaps, 0)
BR_OFFSET(BrJank, camSnaps, 2)
BR_OFFSET(BrJank, lost, 4)
BR_OFFSET(BrJank, stalls, 6)
BR_OFFSET(BrJank, longest, 8)
BR_OFFSET(BrJank, checks, 10)
BR_OFFSET(BrJank, drifts, 12)
BR_OFFSET(BrJank, watchSecs, 14)
BR_SIZE(BrJank, 16)
extern struct BrJank gBrJank;

// A replay that sat this long on a choice that had not come, while the trainer we follow
// was not choosing (their shot clock off), is a stall: the other side's choice can take
// the whole shot clock (br_battle.h), and nothing takes longer than that.
#define BR_JANK_STALL_SECS (BR_SHOT_CLOCK_FRAMES / 60 + 5)

// The fighter's word on each turn (POK-376): a TURN can carry, after the battlers' action
// runs, one run under this battler number -- which no battler has, so a replay that does
// not know it skips it (RecordedBattle_FeedSpectate) -- holding the number of the turn
// before and a checksum of every battler's species and HP as that turn ended. The replay works out the
// same sum when its own turn ends; a sum that differs is a replay showing a fight that
// did not happen, and it is ended rather than played on to the wrong winner.
#define BR_SPECTATE_CHECK 0xC0
#define BR_SPECTATE_CHECK_LEN 3

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
// The last PARTY the page handed us for `seat`, built into `party` as real POKeMON with
// each row's own personality: how many there were, 0 when what we hold is not theirs.
u8 BrSpectate_PartyOf(u8 seat, struct Pokemon *party);
// The same message for somebody else's party under somebody else's seat -- how a bot's
// team gets back to the page that walks it after a fight it lost mons in (POK-238).
void BrSpectate_SendPartyOf(struct Pokemon *party, u8 seat);
// Is this ROM publishing the fight it is in? A replay is built from the fight's seed and
// its choices alone, so a published fight must draw nothing from the generator the
// replay does not: no turn of it on the frame (VBlankCB_Battle), no fog on the clock.
bool8 BrSpectate_Publishing(void);
// The opponent's choice -- the AI's, or a wild POKeMON's pick -- reaches a replay as a
// recorded action, which rolls nothing. TRUE turns Random() over to Random2's generator
// for the choice, FALSE gives the battle its own back where it left it, so a published
// fight's choice draws nothing from the battle's generator either (HBR-63).
void BrSpectate_HoldRng(bool8 hold);

// The peek box is up where the map-name popup goes: a sign due now waits for it to close
// (Cam's 2026-10-14 play-test, POK-370: the ROUTE 118 sign drew into the box's corner,
// and its erase took the box's cells with it). Task_MapNamePopUpWindow's print wait.
bool8 BrSpectate_HoldsSign(void);
// The watcher's START menu (POK-369): pret's menu, its rows the watched trainer's.
// Watching: a seat is being followed. The three are the rows' callbacks.
extern u8 gBrFollowName[];
// The look a replay's side walks around in (POK-411): side 0 has its back to the camera,
// side 1 faces it. BR_NO_SEAT for a side with no seat, or when no replay is on.
u8 BrSpectate_SideSkin(u8 side);
bool8 BrSpectate_Watching(void);
bool8 BrSpectate_MenuParty(void);
bool8 BrSpectate_MenuBag(void);
bool8 BrSpectate_MenuCard(void);

// The peek box down, before a screen that frees every window (br_hof.c's parade).
void BrSpectate_ClosePeek(void);

#endif // GUARD_BR_SPECTATE_H
