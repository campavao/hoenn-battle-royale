#ifndef GUARD_BR_GYM_H
#define GUARD_BR_GYM_H

#include "global.h"

// Gym leaders as one-shot bosses (POK-295, DESIGN.md: "Gyms are one-shot bosses,
// first-to-beat closes them").
//
// Kanto's rule, from its README: "Bosses talk for one page. A gym leader in a match says
// the first page of their speech and the fight opens; a win prints the purse line -- the
// prize TM and the money -- and nothing else: no badge pages, no TM explanation, no
// vanilla TM (the match's own prize is the TM)."
//
// The closing is not here: a beaten trainer already leaves every ROM's map (NPCOUT,
// POK-287), a leader included, and the page draws the cross-map line off that same
// message (web/src/match/bosses.ts). What is here is the speech, the prize and the
// ceremony that no longer plays. One byte of EWRAM: which of the eight are down, for the
// MAP's leader heads (2026-10-05 play-test: "show gym leader icons on the map, grayed out
// when defeated", in place of the ticker's line).

// Is this one of the eight? Rematch ids are not: nothing in a match can reach one.
bool8 BrGym_IsBoss(u16 trainerId);

// The first page of a boss's intro, cut at its first page break into gStringVar4; any
// other trainer's text comes back untouched. The one hook in ShowTrainerIntroSpeech.
const u8 *BrGym_Intro(u16 trainerId, const u8 *speech);

// The script a win goes on to: the gym's own (badge, fanfare, TM, explanation) for
// anybody else, and for a boss one that lets go of the player and ends. The one hook in
// BattleSetup_GetTrainerPostBattleScript.
const u8 *BrGym_AfterScript(u16 trainerId, const u8 *script);

// The purse: the gym's TM and 1000, straight into the bag, and one line saying so.
// Called from BrLoot_TrainerBeaten, which every trainer win already goes through.
void BrGym_Beaten(u16 trainerId);

// Bit i: sBosses[i] has been beaten, by us or by anybody (NPCOUT). Not by the fog: a gym
// the fog swept is closed, not won.
extern u8 gBrGymsBeaten;
void BrGym_Init(void);
// NPCOUT from a seat: if that trainer was a leader, they are down.
void BrGym_NoteOut(u8 mapGroup, u8 mapNum, u8 localId);
// The MAP's leader heads (br_map.c / region_map.c): one 16x16 head per gym over its
// town, grayed once beaten.
void BrGym_DrawOnMap(s16 left, s16 top);

#endif // GUARD_BR_GYM_H
