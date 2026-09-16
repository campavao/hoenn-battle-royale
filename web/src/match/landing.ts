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
import landingData from '../data/landing.json';
import type { LandingCell } from './director';

export const LANDING: LandingCell[] = (landingData as LandingCell[]).filter((c) => !c.off);

/** Every cell the exporter found, marks and all -- for the tools that check the marks. */
export const LANDING_ALL = landingData as LandingCell[];
