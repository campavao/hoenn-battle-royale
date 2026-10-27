#ifndef GUARD_BR_BATTLE_H
#define GUARD_BR_BATTLE_H

#include "br/br_config.h"

// In-battle rules (POK-231): the 30-second shot clock on every choice, and RUN against
// another trainer, which takes a POKe DOLL (POK-293).

#define BR_SHOT_CLOCK_FRAMES (30 * 60)

// What a RUN action's return value carries, so both ROMs of a link battle agree on what
// kind of RUN it was without re-reading a bag or a clock neither can see (POK-231/292).
#define BR_RUN_ROLL 0    // a plain RUN, which fails against a trainer (POK-293)
#define BR_RUN_DOLL 1    // a POKe DOLL: a sure getaway, and nobody is eliminated
#define BR_RUN_FORFEIT 2 // the shot clock ran out: a definite loser and a definite winner
#define BR_RUN_OVER 3    // the match was decided while we fought: a sure way out of anything

// How often B is pressed once a screen the battle put up has held the clock past it.
// Kanto's BAG_BACKOUT_SECONDS: often enough to unwind a picker over a bag over a battle
// in about a second, slow enough to read as a press.
#define BR_BAG_BACKOUT_FRAMES 21

struct BrBattle
{
    /* 0 */ u16 shotFrames;  // frames spent on the current choice
    /* 2 */ u16 timedOut;    // choices the clock made for the player
    /* 4 */ u16 runRolls;    // RUN attempts against a trainer
    /* 6 */ u16 runEscapes;  // ...of which got away, which is one per POKe DOLL spent
    /* 8 */ u8 menu;          // BR_MENU_*: the choice menu the player's controller is on
                              // this frame. The page's tap-to-choose reads it; it is set
                              // by the three input handlers and cleared when a choice is
                              // made (was autoMove until POK-313).
    /* 9 */ u8 stalled;       // a sub-screen already ran this turn's clock out
    /* 10 */ u16 stallFrames; // frames a screen the battle put up has held the clock
};
// web/src/touch.ts reads `menu` (BATTLE_MENU).
BR_OFFSET(BrBattle, shotFrames, 0)
BR_OFFSET(BrBattle, timedOut, 2)
BR_OFFSET(BrBattle, runRolls, 4)
BR_OFFSET(BrBattle, runEscapes, 6)
BR_OFFSET(BrBattle, menu, 8)
BR_OFFSET(BrBattle, stalled, 9)
BR_OFFSET(BrBattle, stallFrames, 10)
BR_SIZE(BrBattle, 12)

extern struct BrBattle gBrBattle;

// Who is fighting, for the page to park both trainers beside the battle with their names
// and the balls they have left (Cam's 2026-10-19 play-test, #18; web/src/ui/sides.ts).
// Filled when the opponent's picture is drawn (BrBattle_OpponentPic), which every trainer
// battle's intro does before anything else of it shows; the page reads it only while
// a trainer battle runs. Names are the ROM's charset, EOS-terminated. In IWRAM: EWRAM is
// at its floor.
struct BrSides
{
    /* 0 */ u8 foePic;       // TRAINER_PIC_*: web/public/trainer-pics/<pic>.png
    /* 1 */ u8 minePic;
    /* 2 */ u8 foeName[16];  // B_TRAINER1_NAME, or B_LINK_OPPONENT1_NAME in a link battle
    /* 18 */ u8 mineName[PLAYER_NAME_LENGTH + 1];
    /* 26 */ u16 serial;     // +1 a battle: the page tells this fight from the last
};
BR_OFFSET(BrSides, foePic, 0)
BR_OFFSET(BrSides, minePic, 1)
BR_OFFSET(BrSides, foeName, 2)
BR_OFFSET(BrSides, mineName, 18)
BR_OFFSET(BrSides, serial, 26)
BR_SIZE(BrSides, 28)

extern struct BrSides gBrSides;

#define BR_MENU_NONE   0
#define BR_MENU_ACTION 1 // FIGHT / BAG / POKeMON / RUN, bottom right, 2x2
#define BR_MENU_MOVE   2 // the four moves, bottom left, 2x2
#define BR_MENU_SAFARI 3 // BALL / POKeBLOCK / GO NEAR / RUN, bottom right, 2x2
#define BR_MENU_TARGET 4 // a double battle's target: the bouncing healthbox, picked with the pad

void BrBattle_Init(void);
// The player controller: reset when a choice opens, tick each frame it is open.
void BrBattle_ShotReset(void);
bool8 BrBattle_ShotTick(void);
// Every frame from BrFrame, whatever is on top: the same clock over the BAG and the
// party screen, which the two above cannot see (POK-292).
void BrBattle_TickStall(void);
// RUN from a fight with another trainer. Not a roll -- Cam's rule (POK-293) is that a
// POKe DOLL is the only way out, and without one there is no way out.
// ChooseRun: the player's controller, RUN chosen: spends a doll if there is one and
// returns the BR_RUN_* the action carries.
u8 BrBattle_ChooseRun(void);
// HandleRun: HandleAction_Run, first thing. TRUE when it decided the RUN (got away, or
// "Can't escape!"), from what the action carried, the same on both ROMs of a link
// battle; FALSE leaves it to pret: a forfeit, a wild battle, the AI's side.
bool8 BrBattle_HandleRun(void);
// The drawn shot clock: the seconds left, top-right of the battle screen. Draw each
// frame a choice menu is open (it follows bg0's scroll so it stays top-right in both
// the action and move menus); hide it when selection ends.
void BrBattle_DrawClock(void);
// The same clock with the seconds handed in: what a spectator draws, since a replay
// has no choice menu of its own to count down (POK-231's `clock` for spectators).
void BrBattle_DrawClockSecs(u8 secs);
void BrBattle_HideClock(void);
// The player's controller, the frame a choice menu scrolls onto the screen: on a phone
// the page draws the menu under the picture (gBrHud.noBattleBox), so the screen keeps the
// plain message box -- with the prompt in it, when `prompt` (the action menu's).
void BrBattle_MenuBoxOff(bool8 prompt);
// ...and every frame the menu is up, so a page that comes or goes mid-menu (the phone
// turned on its side) takes the box off or puts it back: bg0 at `menuY`, or at the top
// with `prompt` put in the message box.
void BrBattle_MenuBoxFollow(u16 menuY, const u8 *prompt);
// BattlePutTextOnWindow, after pret's own choice: on a phone (gBrHud.noBattleBox) the
// battle's text runs on by itself in every battle, as a link battle's does -- the page
// takes the stick and A/B away while the battle plays (web/src/ui/battlemenu.ts).
void BrBattle_PhoneAutoScroll(void);
// text.c: TRUE where that autoScroll is the phone's, not a link's -- the letters keep the
// room's TEXT pace, not autoScroll's fixed 3 frames a letter, which halved TEXT FAST.
bool8 BrBattle_PhoneTextPace(void);
// battle_main.c: a battle ran to its result. Counts it for the match's stats, and puts
// its fog away: gBrRing.battleFog said this fight was in the fog, and the page draws the
// fog behind a fight that is (HBR-38), so left set it fogged every menu and every
// unpublished wild fight after it.
void BrBattle_Finished(void);

// battle_main.c: tear a battle down that the engine cannot end on its own, and hand
// the trainer back to gMain.savedCallback. Only br_netlink.c calls it: a peer that
// never answered, or one that went out mid-fight.
void BrBattle_Unwind(void);

// A bag item's return value is Emerald's CONTROLLER_ONERETURNVALUE, [cmd][id lo][id hi]
// and a last byte pret leaves 0. Ours says whom the item went to, so the other ROM of a
// link battle can use it on its own copy of the same mon (POK-331 #7):
//   bits 0-2  the party slot + 1 (0: nobody -- a ball, a doll, a bag closed empty)
//   bits 4-5  the move a PP item chose
#define BR_ITEM_TARGET(slot, move) ((u8)(((slot) + 1) | (((move) & 3) << 4)))
#define BR_ITEM_TARGET_SLOT(t) ((u8)(((t) & 7) - 1)) // 0xFF for nobody
#define BR_ITEM_TARGET_MOVE(t) (((t) >> 4) & 3)

// The spectator's replay (POK-330 #12) reads a fight off its record, so what the record
// did not carry, the replay could not do. A bag item goes on it as four bytes after its
// action, none of them 0xFF, which is the record's "not here yet":
//   [item & 0x7F][item >> 7][a][b]
// For a battler on the player's side, a is the party slot the bag's item went to
// (PARTY_SIZE for none: a ball, a doll, the AI's) and b the move slot a PP item chose.
// On the opponent's side they are the AI's item type and flags, which its script reads --
// or, when the other side is a person, BR_ITEM_PEER | the slot, and the move.
#define BR_ITEM_RECORD_BYTES 4
#define BR_ITEM_PEER 0x40
// battle_main.c: the bag works in our link battles, and so in a replay of one.
bool8 BrBattle_ItemsAllowed(void);
// battle_main.c, as the choices go on the record: RUN's kind after it, a bag item's bytes.
void BrBattle_RecordChoice(u8 battler);
void BrBattle_RecordItem(u8 battler);
// pokemon.c's ExecuteTableBasedItemEffect: which party slot, and move, a bag item went to.
void BrBattle_NoteItemTarget(u16 item, u8 partyIndex, u8 moveIndex);
// battle_controller_player.c, the bag closing: the item, and whom it went to.
void BrBattle_EmitItemChoice(u16 item);
// br_duel.c: a bot's item on the player's side of a duel, used as a bag uses one, and
// handed back to the engine as the bag's choice is.
void BrBattle_UseAsBag(u8 battler, struct Pokemon *party, u16 item);
// battle_controllers.c, a return value arriving over the link: the other trainer's bag
// item, used on this ROM's copy of their mon.
void BrBattle_PeerItem(u8 battler);
// pokemon.c, PokemonUseItemEffects: the first battler on a side, whichever ROM this is.
u8 BrBattle_FirstOnSide(u8 battler);
// pokemon.c, PokemonUseItemEffects: pret's request for a healed battler's data, which
// jams our link.
void BrBattle_AfterItemHeal(void);
// recorded_battle.c: a recorded item played onto the replay. Returns its id.
u16 BrBattle_ReplayItem(u8 battler, const u8 *rec);
// battle_util.c, HandleAction_UseItem: a person's bag item in a link battle or a replay
// of one says whose it was, "<NAME> used POTION!", before its own script (POK-331 #7).
void BrBattle_SayItemUsed(void);
// The battle's own lines, past the end of pret's string table. battle_message.c's
// BufferStringBattle hands every id here first; FALSE for one of pret's.
#define BR_STRINGID_USED_ITEM BATTLESTRINGS_COUNT
#define BR_STRINGID_FOG_HURT (BATTLESTRINGS_COUNT + 1) // br_ring.c, the fog's turn
bool8 BrBattle_BufferString(u16 stringId);
// A trainer's own three lines in the battle with them (2026-10-05 play-test: "the chosen
// text should show in battle"). The page sends the opponent's before the fight, as TICKER
// kinds 3..5 (br_hud.c): which is BR_VOICE_*, text is charmap bytes, len without an EOS.
#define BR_VOICE_INTRO 0
#define BR_VOICE_WIN 1
#define BR_VOICE_LOSE 2
#define BR_VOICE_LEN 30
void BrBattle_SetVoice(u8 seat, u8 which, const u8 *text, u8 len);
// battle_message.c, the end of BufferStringBattle: the intro and a link battle's last
// line get the opponent's own after them, on a page of its own.
void BrBattle_AfterString(u16 stringId);
// The room's TEXT and ANIM in every battle (2026-10-05 play-test: "animations off and
// text fast don't seem to be applying"). pret ignores both in a link battle -- every
// animation plays, every line prints at 1 and then holds 49 frames for the cable -- and
// those are the fights a match is made of.
// battle_main.c: HITMARKER_NO_ANIMATIONS, in a link battle and a replay of one too.
bool8 BrBattle_AnimationsOff(void);
// battle_message.c: a link battle's print speed, the player's own.
u8 BrBattle_LinkTextSpeed(void);
// text.c: how long an auto-scrolling line holds (pret: 49 frames). Shorter on a faster
// TEXT, in a battle; pret's 49 everywhere else.
u8 BrBattle_AutoScrollFrames(void);
// battle_script_commands.c's waitmessage and pause: how long a printed line holds before
// the next, and the beats between (pret: B_WAIT_TIME_LONG is 64 frames, the pause before
// a faint is one). Cut on a faster TEXT, in a battle.
u16 BrBattle_Wait(u16 frames);
// The battle over the map, an experiment (2026-10-05 play-test: "disable the white battle
// background so the battle overlays the map"). [0] the page writes: nonzero asks for it.
// [1] the ROM keeps: frames left in which a battle drew its picture see-through, 2 from
// every battle VBlank, one off each BrFrame -- the page keys the picture while it is up.
// See-through keys the backdrop and the environment's stripes BR_SEE_THROUGH_KEY, pure
// blue, which the page's filter makes transparent so the field it draws under the picture
// shows; the platforms stay, in the environment's colours (2026-10-07 play-test).
#define BR_SEE_THROUGH_KEY RGB(0, 0, 31)
extern u8 gBrSeeThrough[2];
// battle_main.c, VBlankCB_Battle, before the palettes go up.
void BrBattle_SeeThrough(void);
// br_main.c, every frame.
void BrBattle_TickSeeThrough(void);
// battle_main.c: TRUE while the battlers are still choosing, when the engine may yet take
// a recorded byte back off the record.
bool8 BrBattle_Choosing(void);
// The opponent's front picture, in a bot's fight or a netlink: the trainer class of the
// skin that seat walks around in, so the HIKER on the map is the HIKER in the battle
// (2026-10-05 play-test). Anything else keeps pret's pick.
u32 BrBattle_OpponentPic(u32 pic);
// battle_controllers.c: a spectator's replay of somebody's wild battle (br_spectate.c).
// pret's own non-link replay runs the opponent on the AI again, which only works for a
// frontier trainer whose AI is all there is to it; a wild POKeMON chooses with Random(),
// and the fighter's ROM recorded what it chose, so the replay reads that instead.
bool8 BrBattle_RecordedWildOpponent(void);
// battle_controller_opponent.c: the battler a both-foes move (GROWL, LEER, TAIL WHIP) is
// aimed at. pret's opponent controller names the player's side outright, which is right
// for the side it was written for -- and in a proxy duel side A is on this controller too,
// so its GROWL lowered its own ATTACK (2026-10-06 play-test, seen on the replay). The
// mirror of `target` when it is on the chooser's own side; `target` otherwise.
u8 BrBattle_FoeOf(u8 battler, u8 target);
// A spectator's replay seen from battler 1's side (HBR-53), and what that turns.
bool8 BrBattle_ReplayTurned(void);
u8 BrBattle_HomeSide(u8 battler);
struct Pokemon *BrBattle_PartyOf(u8 battler);
// The move menu's TYPE/ line, with how the move lands on the foe (Cam's 2026-10-19
// play-test: the phone's move menu says it and the desktop's GBA box did not):
// "GRASS ×2" in green, "FIRE ×0.5" in red. TRUE when it drew the line; FALSE leaves
// pret's TYPE/ line to draw (a move that does no damage, a double battle).
// A link battle's slave: the parts of gBattleMons the menus read, from the parties
// (br_battle.c). Each frame, from BrFrame.
void BrBattle_FillSlaveMons(void);
bool8 BrBattle_MoveTypeLine(u16 move);

#endif // GUARD_BR_BATTLE_H
