// Is six Zone areas too thin for a two-minute opening? (POK-285)
//
// From the 2026-09-16 play-test: "I still did not see any other players in the Safari."
// Twelve contestants over six areas is two per area, and a contestant walks past one
// area in two minutes -- so the opening may be too spread out to feel like a shared
// place. A pacing decision, and one to make with a number rather than a feeling.
//
// Runs the real bot brain over the real Zone -- the same `Bots` the host walks, on the
// same twenty-four cells the ROM deals the player -- for the opening's length, across
// many seeds, and counts company: how often two contestants share an area, how long
// before the first two do, and how long before two are within an eyeline of each other.
//
//   npx vite-node tools/br/zone-occupancy.ts -- --seeds 40 --contestants 12 --secs 120
//
// Every contestant is a bot here. A player walks about as much as one does in the
// Zone, and it is the bots' own walk that is being asked about.
import { Bots, STEP_MS } from '../../web/src/bots/brain';
import { dealBots } from '../../web/src/bots/roster';
import { dealBag } from '../../web/src/bots/bag';
import { dealParty } from '../../web/src/bots/party';
import { botGround } from '../../web/src/bots/host';
import { mulberry32 } from '../../web/src/match/clock';
import { SAFARI_MAPS } from '../../web/src/match/safari';

function arg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0 || i + 1 >= process.argv.length) return fallback;
  const n = Number(process.argv[i + 1]);
  return Number.isFinite(n) ? n : fallback;
}

const seeds = arg('seeds', 40);
const contestants = arg('contestants', 12);
const secs = arg('secs', 120);
/** How near is "you would have seen them": the eyeline is four cells (POK-259). */
const EYELINE = 4;

// The Zone as the host's bots walk it (bots/host.ts): the opening's own cells.
const { world, refById, safariTargets: targets } = botGround();
const spawns = targets.map((t) => ({ mapId: t.mapId, map: refById.get(t.mapId)!, x: t.x, y: t.y }));

interface Run {
  /** Seconds until two contestants first stood on the same area, or null. */
  firstShared: number | null;
  /** Seconds until two first stood within an eyeline of each other, or null. Pairs
   *  dealt onto the same cell at the start do not count: dealBots draws spawns with
   *  replacement, so some of the field begins stacked, and that is not a meeting. */
  firstSeen: number | null;
  /** How many contestants came within an eyeline of somebody they did not start on
   *  top of -- the play-test's "I did not see any other players", by the number. */
  sawSomebody: number;
  /** Pairs dealt onto the same cell at the start. */
  stacked: number;
  /** Of the seconds sampled, the fraction in which some area held two or more. */
  sharedFraction: number;
  /** The most contestants any one area held at once. */
  peak: number;
  /** Areas that had nobody in them for the whole opening. */
  empty: number;
}

function run(seed: number): Run {
  const bots = new Bots({
    world,
    targets,
    mapRef: (id) => refById.get(id),
    send: () => {},
    rng: mulberry32(seed ^ 0x51ce),
    inside: () => true, // no fog in the opening
    deal: (bot, phase) => dealParty(seed, bot.seat, phase),
    bagFor: (bot, phase) => dealBag(seed, bot.seat, phase, bot.grade),
    seed,
    fights: () => false, // nobody fights in the Zone
    centres: () => world.centres(),
  });
  const dealt = dealBots(seed, contestants, [], spawns);
  bots.start(dealt, 0);
  const visited = new Set<string>();
  // Who started where, so a pair stacked at the deal is not counted as having met.
  const startCell = new Map(dealt.map((b) => [b.seat, `${b.mapId}:${b.x},${b.y}`]));
  const together = (a: number, b: number) => startCell.get(a) === startCell.get(b);
  let stacked = 0;
  for (let i = 0; i < dealt.length; i++) for (let j = i + 1; j < dealt.length; j++) if (together(dealt[i].seat, dealt[j].seat)) stacked++;
  const saw = new Set<number>();
  let firstShared: number | null = null;
  let firstSeen: number | null = null;
  let sharedTicks = 0;
  let samples = 0;
  let peak = 0;
  let nextSample = 1000;
  for (let t = STEP_MS; t <= secs * 1000; t += STEP_MS) {
    bots.tick(t);
    if (t < nextSample) continue;
    nextSample += 1000;
    samples++;
    const where = bots.positions();
    const byMap = new Map<string, { seat: number; x: number; y: number }[]>();
    for (const w of where) {
      visited.add(w.map);
      const on = byMap.get(w.map) ?? [];
      on.push({ seat: w.seat, x: w.x, y: w.y });
      byMap.set(w.map, on);
    }
    let shared = false;
    for (const on of byMap.values()) {
      if (on.length > peak) peak = on.length;
      if (on.length < 2) continue;
      shared = true;
      for (let i = 0; i < on.length; i++) {
        for (let j = i + 1; j < on.length; j++) {
          if (together(on[i].seat, on[j].seat)) continue;
          if (Math.abs(on[i].x - on[j].x) + Math.abs(on[i].y - on[j].y) > EYELINE) continue;
          if (firstSeen === null) firstSeen = t / 1000;
          saw.add(on[i].seat);
          saw.add(on[j].seat);
        }
      }
    }
    if (shared) {
      sharedTicks++;
      if (firstShared === null) firstShared = t / 1000;
    }
  }
  return {
    firstShared,
    firstSeen,
    sawSomebody: saw.size,
    stacked,
    sharedFraction: samples ? sharedTicks / samples : 0,
    peak,
    empty: SAFARI_MAPS.filter((m) => !visited.has(m)).length,
  };
}

const runs: Run[] = [];
for (let s = 1; s <= seeds; s++) runs.push(run(s * 7919));

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const shared = runs.filter((r) => r.firstShared !== null);
const seen = runs.filter((r) => r.firstSeen !== null);
console.log(`${seeds} openings of ${secs}s, ${contestants} contestants over ${SAFARI_MAPS.length} areas`);
console.log(
  `two on one area at some point: ${shared.length}/${seeds}` +
    (shared.length ? `, first at ${avg(shared.map((r) => r.firstShared!)).toFixed(0)}s on average` : ''),
);
console.log(
  `two within an eyeline (${EYELINE} cells) at some point: ${seen.length}/${seeds}` +
    (seen.length ? `, first at ${avg(seen.map((r) => r.firstSeen!)).toFixed(0)}s on average` : ''),
);
console.log(
  `contestants who saw somebody they did not start on top of: ${avg(runs.map((r) => r.sawSomebody)).toFixed(1)} of ${contestants}` +
    ` (${(100 * avg(runs.map((r) => r.sawSomebody / contestants))).toFixed(0)}%); pairs dealt onto one cell: ${avg(runs.map((r) => r.stacked)).toFixed(1)}`,
);
console.log(`share of the opening with company on some area: ${(100 * avg(runs.map((r) => r.sharedFraction))).toFixed(0)}%`);
console.log(`most on one area at once: ${avg(runs.map((r) => r.peak)).toFixed(1)} on average, ${Math.max(...runs.map((r) => r.peak))} at most`);
console.log(`areas nobody set foot in: ${avg(runs.map((r) => r.empty)).toFixed(1)} of ${SAFARI_MAPS.length} on average`);
