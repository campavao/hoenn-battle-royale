#ifndef GUARD_BR_LEGEND_H
#define GUARD_BR_LEGEND_H

#include "br/br_config.h"
#include "br/br_loot.h"

// Legendaries you fight (POK-410). Cam, 2026-10-18: "getting legendaries is a bit too
// easy, I would like us to use overworld sprites when we can and you have to initiate a
// battle with them".
//
// A legendary the match itself put down -- an event's or a story's, a key in the
// nobody space -- stands on its cell as its own overworld sprite, and A on it is its cry
// and a legendary battle, not a ball into the party. The battle takes it off the ground
// for the whole room as it starts (a PICKUP, the way a patch goes), so two trainers never
// both catch it. Only a catch keeps it: running, knocking it out, losing or cancelling a
// full party's release puts it back where it stood, for everybody (a SPILL under its own
// key, which also un-grays its event's mark).
//
// A legendary in a fallen trainer's team, or one released, stays a ball: somebody caught
// it already. One with no overworld sprite stays a ball too; every one the match deals
// today has one (web/src/match/legends.ts holds the same table for the page).

void BrLegend_Init(void);
// Each frame: a put-back the ring had no room for goes out.
void BrLegend_Tick(void);
// The overworld sprite this piece stands as, or 0 when it is an ordinary ball.
u8 BrLegend_Gfx(const struct BrLootItem *it);
// A on one (br_loot.c's Take): its cry, then BrLegend_Battle.
void BrLegend_Challenge(const struct BrLootItem *it);
// The script's special, after the cry: VAR_RESULT FALSE when somebody took it meanwhile.
void BrLegend_Battle(void);
// The release screen a full party's catch asked was cancelled (br_catch.c): back it goes.
void BrLegend_CatchCancelled(void);

#endif // GUARD_BR_LEGEND_H
