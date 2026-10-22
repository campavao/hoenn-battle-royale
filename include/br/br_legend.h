#ifndef GUARD_BR_LEGEND_H
#define GUARD_BR_LEGEND_H

#include "br/br_config.h"
#include "br/br_loot.h"

// Legendaries you fight (POK-410). Cam, 2026-10-18: "getting legendaries is a bit too
// easy, I would like us to use overworld sprites when we can and you have to initiate a
// battle with them".
//
// A legendary the match itself put down -- an event's or a story's, BR_EVENT_KEY_BASE
// keys -- stands on its cell as its own overworld sprite, and A on it is its cry and a
// legendary battle, not a ball into the party. Its cry asks the host for it first (a
// PICKUP of BR_LEGEND_CLAIM_KEY, as an event's trader is asked for): the host's PICKUP of
// the piece naming us takes it off the ground for the whole room and starts the battle,
// and one naming somebody else is "got there first". So two trainers never both fight it,
// nor both catch it -- except when the host takes longer than BR_CLAIM_FRAMES to answer
// and we claim it ourselves the old way, where the seat tie-break keeps the put-back to
// one (BrLegend_NoteTaken). Only a catch keeps it: running, knocking it out, losing or
// cancelling a full party's release puts it back where it stood, for everybody (a SPILL
// under its own key, which also un-grays its event's mark).
//
// A legendary in a fallen trainer's team, or one released, stays a ball: somebody caught
// it already. One a story's person stands as (MAXIE with GROUDON) is his to hand over.
// One with no overworld sprite would stay a ball too; every one the match deals today has
// one (web/src/match/legends.ts holds the same table for the page).

// Asking for piece `key` (0xB0xx): web/src/match/events.ts's legendClaimKey.
#define BR_LEGEND_CLAIM_KEY(key) ((u16)((key) | 0x0800))

// Is this one of the match's legendaries (the table the map's ones stand as)?
bool8 BrLegend_Is(u16 species);

void BrLegend_Init(void);
// Each frame: a put-back the ring had no room for goes out.
void BrLegend_Tick(void);
// The overworld sprite this piece stands as, or 0 when it is an ordinary ball.
u8 BrLegend_Gfx(const struct BrLootItem *it);
// A on one (br_loot.c's Take): BrLegend_Ask, its cry, then BrLegend_Battle.
void BrLegend_Challenge(const struct BrLootItem *it);
// The script's special before the cry: asks the host. VAR_RESULT FALSE when it is gone.
void BrLegend_Ask(void);
// The script's special after the cry, before its waitstate: the host's answer, then the
// battle, or "got there first" and the script goes on.
void BrLegend_Battle(void);
// Somebody's PICKUP of it: the host's answer while we ask; while we fight it, a lower seat
// that claimed it too puts it back, not us.
void BrLegend_NoteTaken(u16 key, u8 seat);
// The release screen a full party's catch asked was cancelled (br_catch.c): back it goes.
void BrLegend_CatchCancelled(void);

#endif // GUARD_BR_LEGEND_H
