// Why did that bot go there? (POK-236, Kanto's `Bots.decisions`.)
//
// A match is eighteen minutes of bots walking, and the only honest way to answer a
// question about one of them is to watch the rule fire. This runs the host's own match
// -- createHostBots and the Director, on the real world.json, through bots/offline.ts --
// with the clock in a loop instead of a timer, and prints every decision it made with
// the time on it.
//
//   npx vite-node tools/br/bots-replay.ts -- --seed 1234 --seat 31
//
// It plays the match a room would (POK-331 #25): the opening in the Zone, the drop at the
// first ring, the director's rings round the centre the seed picks, and it stops at the
// director's `win` -- or five minutes into the last ring, which is everywhere, if nobody
// has won by then. `--minutes` stops it sooner; `--safari` and `--fog` set the pace in
// seconds, as the room's FOG and SAFARI buttons do (#quick is `--safari 25 --fog 15`).
//
// `--map MAP_ROUTE104` deals every bot onto that map's own cells, to watch a start there:
// Route 104 and Route 114 are the maps a lake or a river splits in two (POK-331 #27). With
// the opening that is where the drop puts them; add `--safari 0` to start them there.
//
// No emulator, no relay, no page: the brain has never needed any of them.
import type { Decision } from '../../web/src/bots/brain';
import { BEAT_MS, offlineMatch } from '../../web/src/bots/offline';
import { RING_RADII } from '../../web/src/match/clock';
import { DEFAULT_FOG_SECS, DEFAULT_SAFARI_SECS } from '../../web/src/match/director';
import type { RingMsg } from '../../web/src/net/wire';

function arg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0 || i + 1 >= process.argv.length) return fallback;
  const n = Number(process.argv[i + 1]);
  return Number.isFinite(n) ? n : fallback;
}

const seed = arg('seed', 1234);
const safari = arg('safari', DEFAULT_SAFARI_SECS);
const fog = arg('fog', DEFAULT_FOG_SECS);
// The whole match: the opening, a ring every `fog` until the last, which is everywhere,
// and long enough in that one for the fog to finish whoever the fights did not.
const minutes = arg('minutes', (safari + fog * (RING_RADII.length - 1)) / 60 + 5);
const only = arg('seat', -1);
const count = arg('bots', 8);
const onMap = process.argv.includes('--map') ? process.argv[process.argv.indexOf('--map') + 1] : undefined;

const stamp = (ms: number) => {
  const t = Math.floor(ms / 1000);
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
};

const lines: string[] = [];
const tally = new Map<string, number>();
// When the field thins, and to what (POK-273). A battle royale's shape is its pacing,
// and until now this tool counted what bots decided without ever counting what it cost
// them: a match that empties in seven minutes and one that runs the full sixteen look
// identical in a decision tally.
const outs: { at: number; seat: number }[] = [];
let duels = 0;
// The smallest ring anybody can be inside: the last one is everywhere, and a bot is
// outside that one wherever it stands.
let lastRing: RingMsg | undefined;
const m = offlineMatch({
  seed,
  bots: count,
  safariSecs: safari,
  fogSecs: fog,
  onMap,
  onDuel: () => void duels++,
  onMsg: (msg, at) => {
    if (msg.t === 'out') outs.push({ at, seat: msg.seat });
    if (msg.t !== 'ring') return;
    if (msg.r >= 0) lastRing = msg;
    lines.push(`${stamp(at)}  ring ${msg.phase}  r ${msg.r}  round ${msg.place ?? `${msg.sx},${msg.sy}`}`);
  },
  onDecision: (d: Decision) => {
    if (only >= 0 && d.seat !== only) return;
    tally.set(d.rule, (tally.get(d.rule) ?? 0) + 1);
    lines.push(
      `${stamp(d.at)}  seat ${String(d.seat).padStart(2)}  ${d.rule.padEnd(7)}  ` +
        `${d.spot.map} ${d.spot.x},${d.spot.y}${d.detail ? `  (${d.detail})` : ''}`,
    );
  },
});
const dealt = m.host.seats;

const end = minutes * 60_000;
let ran = 0;
for (let t = BEAT_MS; t <= end && m.winner === undefined; t += BEAT_MS) {
  m.tick(t);
  ran = t;
}

console.log(lines.join('\n'));
console.log(
  `\n${lines.length} lines over ${stamp(ran)}, seed ${seed}, ${dealt.length} bots${onMap ? ` dealt on ${onMap}` : ''}` +
    `, ${safari}s opening, ${fog}s rings`,
);
console.log([...tally].map(([r, n]) => `${r} ${n}`).join('  '));

// The survivor curve: how many were still standing at each minute, and what took the
// rest. `duel` and `fog` are the only two ways a bot goes out in here -- there is no
// player in a replay -- so the split says which one is running the match.
const fogOuts = tally.get('fog') ?? 0;
const curve: string[] = [];
for (let t = 60_000; t <= ran; t += 60_000) {
  curve.push(`${String(t / 60_000).padStart(2)}m ${String(dealt.length - outs.filter((o) => o.at <= t).length).padStart(3)}`);
}
console.log(`
survivors: ${curve.join('  ')}`);
// The question this tool exists to answer since POK-302: can a bot GET to the last
// ring? A survivor standing outside it at the end is one the fog is about to take for
// no reason but navigation, and for a long time that was almost all of them.
const where = m.host.bots.positions();
const insideNow = where.filter((w) => m.inside(w.map, lastRing));
console.log(
  `${lastRing ? `ring ${lastRing.phase} (r ${lastRing.r})` : 'no ring yet'}: ` +
    `${insideNow.length}/${where.length} of the bots still walking are inside it` +
    (where.length > insideNow.length
      ? ` -- outside: ${where.filter((w) => !m.inside(w.map, lastRing)).map((w) => w.map).join(', ')}`
      : ''),
);

const half = outs[Math.floor(dealt.length / 2) - 1];
console.log(
  `${outs.length} out of ${dealt.length} by ${stamp(ran)}` +
    (half ? `, half the field gone by ${Math.round(half.at / 1000)}s` : ', the field held') +
    ` -- ${duels} duels, ${fogOuts} to the fog` +
    (m.winner === undefined ? ', no winner yet' : m.winner === null ? ', a draw' : `, won by seat ${m.winner} (${m.roster.nameOf(m.winner)})`) +
    // The fog can take the last two on one beat: the director has crowned whichever went
    // out second by the time its `out` arrives, and a match that is over stays over.
    (m.winner != null && outs.some((o) => o.seat === m.winner) ? ', who went out on the same beat' : ''),
);
