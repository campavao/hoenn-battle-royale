// Why did that bot go there? (POK-236, Kanto's `Bots.decisions`.)
//
// A match is sixteen minutes of eight bots walking, and the only honest way to answer
// a question about one of them is to watch the rule fire. This runs the real brain --
// the same `Bots` the host's tab runs, on the real world.json -- with the clock in a
// loop instead of a timer, and prints every decision it made with the time on it.
//
//   npx vite-node tools/br/bots-replay.ts -- --seed 1234 --minutes 16 --seat 31
//
// No emulator, no relay, no page: the brain has never needed any of them.
import { Bots, STEP_MS, type Decision } from '../../web/src/bots/brain';
import { dealBots } from '../../web/src/bots/roster';
import { dealParty } from '../../web/src/bots/party';
import { World, type WorldMap } from '../../web/src/bots/world';
import { mulberry32 } from '../../web/src/match/clock';
import worldData from '../../web/src/data/world.json';
import landingData from '../../web/src/data/landing.json';

function arg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0 || i + 1 >= process.argv.length) return fallback;
  const n = Number(process.argv[i + 1]);
  return Number.isFinite(n) ? n : fallback;
}

const seed = arg('seed', 1234);
const minutes = arg('minutes', 16);
const only = arg('seat', -1);
const count = arg('bots', 8);

const maps = (worldData as { maps: WorldMap[] }).maps;
const world = new World(maps);
const refById = new Map(maps.map((m) => [m.id, { group: m.group, num: m.num }]));
const outdoor = new Set(maps.filter((m) => m.outdoor).map((m) => m.id));
const targets = (landingData as { map: string; x: number; y: number }[])
  .filter((c) => outdoor.has(c.map) && refById.has(c.map))
  .map((c) => ({ mapId: c.map, x: c.x, y: c.y }));

const lines: string[] = [];
const tally = new Map<string, number>();
const bots = new Bots({
  world,
  targets,
  mapRef: (id) => refById.get(id),
  send: () => {},
  rng: mulberry32(seed ^ 0x51ce),
  deal: (bot, phase) => dealParty(seed, bot.seat, phase),
  centres: () => world.centres(),
  onDecision: (d: Decision) => {
    if (only >= 0 && d.seat !== only) return;
    tally.set(d.rule, (tally.get(d.rule) ?? 0) + 1);
    const t = Math.floor(d.at / 1000);
    const clock = `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
    lines.push(
      `${clock}  seat ${String(d.seat).padStart(2)}  ${d.rule.padEnd(7)}  ` +
        `${d.spot.map} ${d.spot.x},${d.spot.y}${d.detail ? `  (${d.detail})` : ''}`,
    );
  },
});

const spawns = targets.map((t) => ({ mapId: t.mapId, map: refById.get(t.mapId)!, x: t.x, y: t.y }));
const dealt = dealBots(seed, count, [], spawns);
bots.start(dealt, 0);
// The ring phase climbs the way the Director moves it: six rungs over the match.
const end = minutes * 60_000;
const perPhase = end / 6;
let phase = 0;
for (let t = STEP_MS; t <= end; t += STEP_MS) {
  const next = Math.floor(t / perPhase);
  if (next !== phase) {
    phase = next;
    bots.ringMoved(phase);
  }
  bots.tick(t);
}

console.log(lines.join('\n'));
console.log(`\n${lines.length} decisions over ${minutes} min, seed ${seed}, ${dealt.length} bots`);
console.log([...tally].map(([r, n]) => `${r} ${n}`).join('  '));
