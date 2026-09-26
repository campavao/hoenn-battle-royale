// The cells the drop may use (POK-251).
//
// `tools/br/landing-reach.ts` marks every landing cell with no route to the rest of
// Hoenn -- a map's border filler, which is walkable in the grid and unreachable in the
// game, and the genuinely gated corners (Sootopolis, Mt Chimney, Southern Island).
// Dropping somebody there strands them for the whole match.
//
// This is the one place that filter lives. The Director builds its ring sections from
// the same pool, so keeping it here also keeps the fog off places nobody can be -- and
// anything else that wants landing cells (the bots, the replay tool, the tests) gets
// the same answer instead of quietly reading the raw file.
//
// landing.json is fetched on demand, as world.json is (bots/hoenn.ts): the tables below
// are live bindings that throw until worldReady() has filled them.
import handData from '../data/landing-hand.json';
import { loadHoenn, notYet } from '../bots/hoenn';
import type { LandingCell } from './director';

export let LANDING: LandingCell[] = notYet('LANDING');

/** Where a town's buildings put you when you step out (POK-307).
 *
 *  Cam, after a drop that put him on the wrong map entirely: "if a location cannot be
 *  found, drop them in front of a Poke Center, a Poke Mart, or a Building." He is owed
 *  one either way, and half the towns the picker offers have nothing else to give him --
 *  the flood above runs on foot, and on foot most of eastern Hoenn is across water, so
 *  Fortree, Lilycove, Mossdeep, Dewford, Pacifidlog, Sootopolis and Ever Grande come out
 *  of it with every ordinary cell marked off.
 *
 *  Already ranked by `landing-reach.ts`, nicest first: a CENTRE, then a MART, then a
 *  gym, then any other door. A fallback only -- never mixed into the ordinary pool, or
 *  every drop would cluster on doorsteps. */
export let DOORSTEPS: LandingCell[] = notYet('DOORSTEPS');

/** Cam's own picks (POK-314): "maybe we should have a follow up where I paint droppable
 *  lines for you and you can save those coordinates?" Painted in web/painter.html, saved
 *  to landing-hand.json by hand and committed; landing-reach.ts never writes that file,
 *  so hand work survives every re-export. A section with any of these deals from them
 *  alone. landing.test.ts holds every one to a standable cell in the current world.json,
 *  so a re-export that moves a map fails a test rather than dropping somebody in a wall. */
export const HAND: LandingCell[] = handData as LandingCell[];

/** Every cell the exporter found, marks and all -- for the tools that check the marks. */
export let LANDING_ALL: LandingCell[] = notYet('LANDING_ALL');

let loading: Promise<void> | undefined;

/** The world data -- world.json into HOENN, landing.json into the tables above -- fetched
 *  once. The page asks as it starts and waits before anything walks or deals; the tests
 *  (vitest.setup.ts) and the tools wait before they read. */
export function worldReady(): Promise<void> {
  loading ??= Promise.all([loadHoenn(), import('../data/landing.json')]).then(([, m]) => {
    LANDING_ALL = m.default as LandingCell[];
    LANDING = LANDING_ALL.filter((c) => !c.off && c.door === undefined);
    DOORSTEPS = LANDING_ALL.filter((c) => c.door !== undefined);
  });
  return loading;
}
