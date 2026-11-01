// A play-test run again from its file (web/spike-b/recorder.ts): the room rebuilt from the
// recorded state, every frame's inputs played through it, the hash held against the page's
// frame by frame, and what happened around each mark.
//
//   cd web && npx vite-node ../tools/br/replay.ts -- <file.json[.gz]> [--around <seconds>]
//
// Exits 1 if any hash differs. A world that differs from the recording's (version.world,
// web/spike-b/world-hash.json) will differ honestly: check out the commit it was played on.
import fs from 'node:fs';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import type { PatchTable } from '../../web/src/bots/patches';
import { WorldIndex } from '../../web/src/bots/hoenn';
import type { WorldMap } from '../../web/src/bots/world';
import patchJson from '../../web/src/data/patches.json';
import worldJson from '../../web/spike-b/data/world.json';
import hashJson from '../../web/spike-b/world-hash.json';
import { parseFile, replay } from '../../web/spike-b/replay';
import { makeRoom } from '../../web/spike-b/shared/room';

const args = process.argv.slice(2).filter((a) => a !== '--');
const around = args.indexOf('--around');
const aroundMs = around >= 0 ? Number(args.splice(around, 2)[1]) * 1000 : 5000;
const name = args[0];
if (!name) {
  console.error('usage: npx vite-node ../tools/br/replay.ts -- <file.json[.gz]> [--around <seconds>]');
  process.exit(2);
}
const bytes = fs.readFileSync(path.resolve(process.env.INIT_CWD ?? process.cwd(), name));
const text = bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes).toString('utf8') : bytes.toString('utf8');
const file = parseFile(text);

const hoenn = new WorldIndex((worldJson as { maps: WorldMap[] }).maps);
const make = (seed: number) => makeRoom(hoenn.maps, patchJson as unknown as PatchTable, seed, hoenn.world);

console.log(`recorded ${new Date(file.saved).toISOString()}  ${file.version?.line ?? '(no version line)'}`);
if (file.device) console.log(`device ${file.device}`);
const here = (hashJson as { hash: string }).hash;
if (file.version && !here.startsWith(file.version.world)) console.log(`WARNING: recorded on world ${file.version.world}, this tree is ${here.slice(0, 8)}: hashes will differ`);

const r = replay(file, make, aroundMs);
const clock = (t: number) => new Date(file.origin + t).toLocaleTimeString();
console.log(`${r.matches} match start(s), ${r.frames} frames, ${r.held} hashes held, ${r.mismatches.length} differ; room states ${r.statesHeld} held, ${r.statesLost} differ`);
if (r.mismatches.length) {
  const m = r.mismatches[0];
  console.log(`FIRST DIFFERENCE at tick ${m.tick} (${clock(m.t)}): page ${m.want}, replay ${m.got}`);
}
for (const { mark, mine, inLog, around: moments } of r.marks) {
  console.log(`\nMARK ${mark.n} (${mark.via}) at ${clock(mark.t)}, tick ${mark.tick}: camera ${mark.map} ${mark.x},${mark.y}` + (mine ? `; my trainer ${mine.map} ${mine.x},${mine.y}` : ''));
  if (!inLog) console.log('  (older than the recording kept)');
  for (const x of moments) {
    const d = (x.t - mark.t) / 1000;
    console.log(`  ${d >= 0 ? '+' : ''}${d.toFixed(2)}s tick ${x.tick}  ${x.text}`);
  }
}
process.exit(r.mismatches.length || r.statesLost ? 1 : 0);
