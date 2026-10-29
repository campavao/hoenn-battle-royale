#!/usr/bin/env node
// What a pull request can break, from the files it changes:
//
//     node scripts/ci-scope.mjs <changed file>...   # -> rom=true|false, e2e=all|none|<spec files>
//
// BR CI runs the rom job (both ROM builds and every driver) and the whole e2e suite on every
// push, tag and release. On a pull request this decides how much of that the change can
// touch. Most of October's PRs were spike B's: web/spike-b and relay/world, which no driver
// and no e2e spec loads, and each paid half an hour of CI for them. Cam, 2026-10-29: run
// only what a PR can break, and the full suite before every release.
//
// A path takes the first rule it matches; a path no rule names runs everything, so a new
// directory is covered until someone says otherwise.
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

/** `rom`: the change can alter the ROM or its drivers. `e2e`: 'all', or the spec files it is (none: []). */
export const RULES = [
  // Words: nothing builds or runs them.
  { match: /^docs\/|\.md$|^\.claude\//, rom: false, e2e: [] },
  // Spike B: the /spike-b/ page and the relay's /world socket (world.js, and service.js
  // bundled from web/spike-b/shared). The shell only links to the page (ui/profile.ts), no
  // spec opens it or /world, and its checks are the web job's unit tests and the relay job's
  // suite, which imports server.js and with it world.js.
  { match: /^web\/spike-b\/|^relay\/world(\.js|\.test\.js|\/)|^tools\/br\/bundle-world\.mjs$/, rom: false, e2e: [] },
  // A spec changed: that spec. Helpers beside the specs (symbols.ts, play.ts, ...) fall through
  // to the web/ rule below, since every spec uses them.
  { match: /^web\/e2e\/[^/]+\.spec\.ts$/, rom: false, e2e: (path) => [basename(path)] },
  // The shell and the relay: every spec drives both, but neither goes into the ROM.
  { match: /^web\/|^relay\//, rom: false, e2e: 'all' },
];
const EVERYTHING = { rom: true, e2e: 'all' };

/** Folds the changed paths into one { rom, e2e } scope. */
export function scope(paths) {
  let rom = false;
  let specs = new Set();
  let all = false;
  for (const path of paths) {
    const rule = RULES.find((r) => r.match.test(path)) ?? EVERYTHING;
    rom ||= rule.rom;
    const e2e = typeof rule.e2e === 'function' ? rule.e2e(path) : rule.e2e;
    if (e2e === 'all') all = true;
    else for (const spec of e2e) specs.add(spec);
  }
  return { rom, e2e: all ? 'all' : [...specs].sort() };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const paths = process.argv.slice(2);
  const { rom, e2e } = scope(paths);
  const e2eOut = e2e === 'all' ? 'all' : e2e.length === 0 ? 'none' : e2e.join(' ');
  console.error(`${paths.length} files changed: rom ${rom}, e2e ${e2eOut}`);
  console.log(`rom=${rom}`);
  console.log(`e2e=${e2eOut}`);
}
