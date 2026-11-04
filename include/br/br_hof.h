#ifndef GUARD_BR_HOF_H
#define GUARD_BR_HOF_H

#include "br/br_config.h"

// The Hall of Fame for everybody still in the match (POK-417). The champion's own ROM
// parades its own party (br_match.c); every other page sends its ROM a FAME once it
// has the champion's PARTY, and this parades that team, under that name and sprite,
// through the same screen. hall_of_fame.c asks the three questions below wherever it
// would have read the save: whose team, whose name, whose picture.

void BrHof_Init(void);
// Each frame: a FAME waiting for the field to come free starts its parade.
void BrHof_Tick(void);
// The party the parade is of: the champion's while a FAME's parade is on, else ours.
struct Pokemon *BrHof_Party(void);
// The name in the box beside the trainer at the end.
const u8 *BrHof_Name(void);
// The trainer's picture at the end: the champion's sprite on a FAME's parade, `pic`
// (ours) otherwise.
u16 BrHof_TrainerPic(u16 pic);
// The box beside the trainer: the name and nothing else (POK-418: the IDNo. was always
// 00000, and the save's play TIME is not the match's).
const struct WindowTemplate *BrHof_PlayerWindow(void);
void BrHof_PrintPlayer(u8 windowId, const u8 *colors);
// A mon's name on its card: `nickname` (an EOS-ended copy), then "/SPECIES" only when
// somebody renamed it, then its gender a space off.
void BrHof_PrintMonName(u8 windowId, const u8 *nickname, u16 species, u32 personality, const u8 *colors);
// How long the parade dwells, in frames (Cam, 11-04: "let's make this a little faster"; a
// team of six took 34 seconds on Emerald's numbers). Each mon still comes on and does its
// animation, which takes about as long again as its name stays up.
#define BR_HOF_MON_FRAMES 36      // Emerald's 120: a mon's name, up, before the next comes on
#define BR_HOF_CONFETTI_FRAMES 190 // Emerald's 400: "Welcome to the HALL OF FAME!"; the last 110 let it land
#define BR_HOF_CONFETTI_EVERY 1   // Emerald's 3: a piece every other frame, in the shorter time
#define BR_HOF_PLAYER_FRAMES 30   // Emerald's 120: the trainer, before stepping aside
// The last screen, `frames` in: it moves on by itself after a moment, or at A.
bool8 BrHof_LetGo(u16 frames);
// The parade is over: let go of the champion's team.
void BrHof_Done(void);

#endif // GUARD_BR_HOF_H
