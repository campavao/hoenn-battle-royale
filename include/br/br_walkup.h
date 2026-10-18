#ifndef GUARD_BR_WALKUP_H
#define GUARD_BR_WALKUP_H

#include "task.h"
#include "br/br_engage.h"

// The walk-up before a fight (POK-373, POK-409): Emerald's own trainer approach
// (trainer_see.c). The "!" over the one who looked, who then walks the eyeline to the
// cell next to the other, who turns to meet them. Whoever walks walks on their own
// side: our ROM walks our trainer, and a walk by the other side reaches us as their
// ghost's steps (a person's ROM, or the page that walks a bot, bots/brain.ts).
//
// Each side gives it the eyeline's length in walks and the wire's lag, then goes in
// regardless: a fight never waits on a walk that cannot finish.
#define BR_APPROACH_FRAMES ((BR_SIGHT_RANGE + 1) * 16 + 90)
// How long both sides wait for each other's last step or turn to land before deciding
// who walks: the decision reads facings, and both must read the same two.
#define BR_APPROACH_SETTLE 60

// Who walks. A person: the one facing down the line at the other, and on a tie (both,
// or neither) the challenger, link id 0. A bot is a map trainer: it walks when it faces
// us down the line, and otherwise we looked, so we do -- the page reads the same one
// facing (brain.ts walksUp), so both pick the same walker.
#define BR_WALKUP_FIRST 0  // a person, and we are link id 0
#define BR_WALKUP_ANSWER 1 // a person, and we are link id 1
#define BR_WALKUP_BOT 2

// The walk-up keeps its state in the caller's task, in these words; the caller's own
// state stays below them. They start at 0, which CreateTask gives every word.
#define BR_WALKUP_DATA 12 // data[12..14]

// One frame of the walk-up with `seat`. TRUE once it is over, however it ended.
bool8 BrWalkup_Run(struct Task *task, u8 seat, u8 rule);

#endif // GUARD_BR_WALKUP_H
