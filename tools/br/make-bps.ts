// The patch a player's browser applies, built here instead of in CI (POK-254).
//
// The shell was always meant to take a stock Emerald ROM and patch it in the tab --
// that is what `loadRelease` + `applyBps` do, and what the published site does. What
// dev had was a shortcut: `dev-patch.sh` wrote the sidecars and deleted the BPS, so
// `npm run dev` could only run a ROM that was already the fork's build. That made the
// local shell a different product from the deployed one, and the first real play-test
// found it within a minute.
//
// This closes it, with no flips and no WSL: the encoder is the one bps.test.ts already
// round-trips, so the patch this writes is decoded by the very code the page runs.
//
//   npx vite-node tools/br/make-bps.ts -- <baseline.gba> <fork.gba> <out.bps>
//
// The baseline is a retail Emerald (U) ROM -- sha1 f3ae088181bf583e55daf962a92bb46f4f1d07b7,
// which the agbcc build at tools/br/BASELINE_COMMIT matches byte for byte. Any ROM the
// patch is meant to apply to has to BE that, which is also why the shell checks.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { encodeBps } from '../../web/src/patch/bps.testutil';
import { applyBps } from '../../web/src/patch/bps';

const [baselinePath, forkPath, outPath] = process.argv.slice(2).filter((a) => a !== '--');
if (!baselinePath || !forkPath || !outPath) {
  console.error('usage: make-bps.ts <baseline.gba> <fork.gba> <out.bps>');
  process.exit(2);
}

const sha1 = (bytes: Uint8Array) => createHash('sha1').update(bytes).digest('hex');

const baseline = new Uint8Array(readFileSync(baselinePath));
const fork = new Uint8Array(readFileSync(forkPath));
console.log(`baseline ${baselinePath} ${baseline.length} bytes sha1 ${sha1(baseline)}`);
console.log(`fork     ${forkPath} ${fork.length} bytes sha1 ${sha1(fork)}`);

const patch = encodeBps(baseline, fork);

// Never ship a patch without applying it: an encoder bug is silent until somebody's
// only copy of the ROM has been turned into 16MB of noise.
const rebuilt = applyBps(baseline, patch);
if (sha1(rebuilt) !== sha1(fork)) {
  console.error(`round-trip FAILED: got ${sha1(rebuilt)}, wanted ${sha1(fork)}`);
  process.exit(1);
}

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, patch);
console.log(`wrote ${outPath} ${patch.length} bytes (round-trip ok)`);
