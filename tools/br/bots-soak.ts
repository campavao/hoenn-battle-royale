// What bots do over a whole match, in numbers (POK-437, POK-388). The room and host for real,
// the fights in the host's simulator, nobody playing, no window: it plays a match to its end
// and prints one line a seed. A change to how bots walk moves fights about, so run it before
// and after (memory: six seeds, fights and the worst gap).
//
//   cd web && npx vite-node ../tools/br/bots-soak.ts -- --seeds 1,2,3,4,5,6 --bots 31
import { readFileSync } from 'node:fs';
import type { WorldMap } from '../../web/src/bots/world';
import type { PatchTable } from '../../web/src/bots/patches';
import { Host } from '../../web/spike-b/shared/host';
import { SAFARI, makeRoom } from '../../web/spike-b/shared/room';

const arg = (name: string, or: string) => {
  const at = process.argv.indexOf(`--${name}`);
  return at > 0 ? process.argv[at + 1] : or;
};
const read = (p: string) => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));
const MAPS = (read('../../web/spike-b/data/world.json') as { maps: WorldMap[] }).maps;
const PATCHES = read('../../web/src/data/patches.json') as PatchTable;
const bots = Number(arg('bots', '31'));

async function soak(seed: number) {
  const room = makeRoom(MAPS, PATCHES, seed);
  room.simBots = true;
  const host = new Host(room, bots, MAPS, 0);
  await host.simReady();
  room.apply({ c: 'lock' });
  let fights = 0, last = 0, worst = 0, ticks = 0;
  const legends = new Map<number, number>();
  // A bot's pickings on the field: what it took in the Zone is the Zone's.
  const zonePicks = new Set<number>(), fieldPicks = new Set<number>();
  const started = Date.now();
  const limit = 60 * 60 * 40;
  while (!room.results.winner && ticks++ < limit && room.actors.length) {
    const { events } = host.advance();
    for (const e of events) if (e.type === 'bots') {
      fights++;
      worst = Math.max(worst, room.tick - last);
      last = room.tick;
    }
    if (ticks % 60) continue;
    for (const [key, s] of room.spills) if (s.legend && !legends.has(key)) legends.set(key, room.tick);
    for (const [key, id] of room.picked) {
      if (room.ring().safari) zonePicks.add(key);
      else if (!zonePicks.has(key) && room.results.entrants.some(([e]) => e === id)) fieldPicks.add(key);
    }
  }
  const fallen = room.results.fallen;
  const hms = room.actors.length;
  const taken = [...legends.keys()].filter((k) => room.picked.has(k)).length;
  return {
    seed,
    mins: +(room.tick / 3600).toFixed(1),
    fights,
    worstGapMins: +(worst / 3600).toFixed(1),
    fog: fallen.filter((f) => !f.by).length,
    fought: fallen.filter((f) => f.by).length,
    left: hms,
    winner: room.results.winner ?? null,
    legends: legends.size,
    legendsTaken: taken,
    picks: fieldPicks.size,
    ground: room.ground().size,
    zone: room.actors.filter((a) => a.m.spot.map.startsWith(SAFARI)).length,
    wallS: Math.round((Date.now() - started) / 1000),
  };
}

for (const seed of arg('seeds', '1,2,3,4,5,6').split(',').map(Number)) console.log(JSON.stringify(await soak(seed)));
