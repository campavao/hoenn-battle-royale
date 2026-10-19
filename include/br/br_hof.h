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
// The last screen, `frames` in: somebody else's parade moves on by itself after a few
// seconds (a watcher is not made to press A to get their results); our own waits for A.
bool8 BrHof_LetGo(u16 frames);
// The parade is over: let go of the champion's team.
void BrHof_Done(void);

#endif // GUARD_BR_HOF_H
