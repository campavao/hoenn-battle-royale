// The gate every patch passes before it goes anywhere a player can fetch it (POK-254,
// POK-330 #2). The name is history: this file used to ENCODE the patch, with the page's
// test-only same-offset encoder (web/src/patch/bps.testutil.ts). Every upstream hook
// shifts everything linked after it, an encoder with no SourceCopy re-emits all of that
// as literals, and the live patch it built was 10.2 MB -- about 9 MB of it retail ROM,
// on a public URL. flips encodes now (tools/br/make-patch.sh); this checks what it
// wrote, with the decoder the page itself runs:
//
//   vite-node tools/br/make-bps.ts -- <baseline.gba> <fork.gba> <patch.bps>
//     the baseline is retail Emerald (U), the patch turns it into exactly fork.gba,
//     and it is under the size ceiling
//   vite-node tools/br/make-bps.ts -- --shipped <fork.gba> <patch.bps>
//     for release-web.sh, which has no baseline to hand: the ceiling, and the footer's
//     CRCs say retail in and fork.gba out
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { applyBps, crc32 } from '../../web/src/patch/bps';
import { EMERALD_SHA1 } from '../../web/src/rom/emerald';

// CI's flips patch for the September builds is ~720 KB; the same-offset one was 10.2 MB.
// A line in this file rather than an env var, so raising it is a commit somebody reads.
const MAX_BYTES = 2 * 1024 * 1024;
const EMERALD_CRC32 = 0x1f1c08fb; // retail Emerald (U), the same file EMERALD_SHA1 names

const args = process.argv.slice(2).filter((a) => a !== '--');
const shipped = args[0] === '--shipped';
const [baselinePath, forkPath, patchPath] = shipped ? [undefined, args[1], args[2]] : args;
if ((!shipped && !baselinePath) || !forkPath || !patchPath) {
  console.error('usage: make-bps.ts <baseline.gba> <fork.gba> <patch.bps>');
  console.error('       make-bps.ts --shipped <fork.gba> <patch.bps>');
  process.exit(2);
}

const sha1 = (bytes: Uint8Array) => createHash('sha1').update(bytes).digest('hex');
const hex = (n: number) => n.toString(16).padStart(8, '0');
function fail(why: string): never {
  console.error(`REFUSING ${patchPath}: ${why}`);
  process.exit(1);
}

const fork = new Uint8Array(readFileSync(forkPath));
const patch = new Uint8Array(readFileSync(patchPath));
console.log(`patch ${patchPath} ${patch.length} bytes, for ${forkPath} sha1 ${sha1(fork)}`);

if (patch.length > MAX_BYTES) {
  fail(
    `${patch.length} bytes is over the ${MAX_BYTES}-byte ceiling. A patch this size is ` +
      'almost certainly shifted retail ROM, not our changes: was it built by flips in delta mode?',
  );
}

if (baselinePath) {
  // A wrong baseline round-trips perfectly (it is the source of its own patch) and then
  // matches no player's ROM, so the round trip alone cannot catch it.
  const baseline = new Uint8Array(readFileSync(baselinePath));
  if (sha1(baseline) !== EMERALD_SHA1) {
    fail(`the baseline ${baselinePath} is sha1 ${sha1(baseline)}, not retail Emerald (U) ${EMERALD_SHA1}`);
  }
  // Never ship a patch without applying it: an encoder bug is silent until somebody's
  // only copy of the ROM has been turned into 16MB of noise.
  let rebuilt: Uint8Array;
  try {
    rebuilt = applyBps(baseline, patch);
  } catch (err) {
    fail(`the page's decoder rejects it: ${(err as Error).message}`);
  }
  if (sha1(rebuilt) !== sha1(fork)) fail(`round-trip gives sha1 ${sha1(rebuilt)}, wanted ${sha1(fork)}`);
  console.log('round-trip ok: retail + patch = the fork, byte for byte');
} else {
  // The footer is three LE CRC32s: source, target, and the patch itself. applyBps checks
  // all three when it runs; with no baseline here, the first two are what bind this
  // file to retail-in and fork-out.
  const view = new DataView(patch.buffer, patch.byteOffset, patch.byteLength);
  const source = view.getUint32(patch.length - 12, true);
  const target = view.getUint32(patch.length - 8, true);
  if (source !== EMERALD_CRC32) fail(`its source CRC is ${hex(source)}, not retail Emerald's ${hex(EMERALD_CRC32)}`);
  if (target !== crc32(fork)) fail(`its target CRC is ${hex(target)}, but ${forkPath} is ${hex(crc32(fork))}: a patch for another build`);
  console.log('footer ok: retail in, this build out');
}
