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
import { dealBag } from '../../web/src/bots/bag';
import { dealParty } from '../../web/src/bots/party';
import { botGround } from '../../web/src/bots/host';
import { mulberry32 } from '../../web/src/match/clock';
import { sectionInside } from '../../web/src/match/ring';
import regionmapData from '../../web/src/data/regionmap.json';

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

// The ground the host's bots walk (bots/host.ts): Hoenn's landing cells to wander to and
// the spawns the deal draws from.
const { world, refById, sectionOf, targets, spawns } = botGround();

const lines: string[] = [];
const tally = new Map<string, number>();
// When the field thins, and to what (POK-273). A battle royale's shape is its pacing,
// and until now this tool counted what bots decided without ever counting what it cost
// them: a match that empties in seven minutes and one that runs the full sixteen look
// identical in a decision tally.
const outs: { at: number; seat: number }[] = [];
let duels = 0;
let now = 0;
const bots = new Bots({
  world,
  targets,
  mapRef: (id) => refById.get(id),
  send: (m) => {
    if (m.t === 'out') outs.push({ at: now, seat: m.seat });
  },
  onDuel: () => void duels++,
  rng: mulberry32(seed ^ 0x51ce),
  inside: (id: string) => ring === undefined || inFog(id),
  deal: (bot, phase) => dealParty(seed, bot.seat, phase),
  // The bag too (POK-237), so a `quaff` shows up in the decision list next to the
  // walk to a Centre it was instead of.
  bagFor: (bot, phase) => dealBag(seed, bot.seat, phase, bot.grade),
  seed,
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

// The fog, which this tool never modelled: `inside` was left undefined, so every rule
// that asks about the ring -- aiming into it, bleeding outside it, and now flying out
// of it -- was dead in here while being alive in a match. The ring closes on the first
// section of the world, the way a Director's would, and shrinks a rung at a time.
const RADII = [12, 9, 7, 5, 4, 3, 2, -1];
const SECTIONS = regionmapData.sections as Record<string, { x: number; y: number; w: number; h: number; name: string; num?: number }>;
const eye = SECTIONS[Object.keys(SECTIONS)[0]];
let ring: { sx: number; sy: number; r: number } | undefined;
const inFog = (mapId: string) => sectionInside(SECTIONS[sectionOf.get(mapId) ?? ''], ring);

const dealt = dealBots(seed, count, [], spawns);
bots.start(dealt, 0);
// The ring phase climbs the way the Director moves it: six rungs over the match.
const end = minutes * 60_000;
const perPhase = end / 6;
let phase = 0;
for (let t = STEP_MS; t <= end; t += STEP_MS) {
  now = t;
  const next = Math.floor(t / perPhase);
  if (next !== phase) {
    phase = next;
    ring = { sx: eye.x, sy: eye.y, r: RADII[Math.min(phase, RADII.length - 1)] };
    bots.ringMoved(phase);
  }
  bots.tick(t);
}

console.log(lines.join('\n'));
console.log(`\n${lines.length} decisions over ${minutes} min, seed ${seed}, ${dealt.length} bots`);
console.log([...tally].map(([r, n]) => `${r} ${n}`).join('  '));

// The survivor curve: how many were still standing at each minute, and what took the
// rest. `duel` and `fog` are the only two ways a bot goes out in here -- there is no
// player in a replay -- so the split says which one is running the match.
const fog = tally.get('fog') ?? 0;
const curve: string[] = [];
for (let t = 60_000; t <= end; t += 60_000) {
  curve.push(`${String(t / 60_000).padStart(2)}m ${String(dealt.length - outs.filter((o) => o.at <= t).length).padStart(3)}`);
}
console.log(`
survivors: ${curve.join('  ')}`);
// The question this tool exists to answer since POK-302: can a bot GET to the last
// ring? A survivor standing outside it at the end is one the fog is about to take for
// no reason but navigation, and for a long time that was almost all of them.
const standing = dealt.filter((b) => !outs.some((o) => o.seat === b.seat));
const where = bots.positions();
const insideNow = where.filter((w) => inFog(w.map));
console.log(
  `final ring: ${insideNow.length}/${where.length} of the bots still walking are inside it` +
    (where.length > insideNow.length
      ? ` -- outside: ${where.filter((w) => !inFog(w.map)).map((w) => w.map).join(', ')}`
      : ''),
);
void standing;

const half = outs[Math.floor(dealt.length / 2) - 1];
console.log(
  `${outs.length} out of ${dealt.length} over ${minutes} min` +
    (half ? `, half the field gone by ${Math.round(half.at / 1000)}s` : ', the field held') +
    ` -- ${duels} duels, ${fog} to the fog`,
);
