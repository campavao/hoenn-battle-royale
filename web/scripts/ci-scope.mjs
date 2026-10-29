#!/usr/bin/env node
// What a pull request can break, from the files it changes:
//
//     git diff -z --no-renames --name-only A B | node scripts/ci-scope.mjs   # -> rom=..., e2e=...
//
// Paths come NUL-separated on stdin (no argument limit to split them across two runs). It
// prints rom=true|false and e2e=all|none|<spec files>. No paths at all is everything: an
// empty diff is more likely a broken checkout than a PR that changes nothing.
//
// BR CI runs the rom job (both ROM builds and every driver) and the whole e2e suite on every
// push, tag and release. On a pull request this decides how much of that the change can
// touch. Most of October's PRs were spike B's: web/spike-b and relay/world, which no driver
// and no e2e spec loads, and each paid half an hour of CI for them. Cam, 2026-10-29: run
// only what a PR can break, and the full suite before every release.
//
// A path takes the first rule it matches; a path no rule names runs everything, so a new
// directory is covered until someone says otherwise.
import { readFileSync } from 'node:fs';
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
  // Shell files the rom job reads too: make-patch.sh checks the BPS with the page's own
  // decoder (tools/br/make-bps.ts, under web's vite-node), version-json.sh reads the shell's
  // version, and objects-band.py, a driver's checker, reads the sprite sheets.
  { match: /^web\/src\/(patch|rom)\/|^web\/src\/data\/sprites\.json$|^web\/package(-lock)?\.json$/, rom: true, e2e: 'all' },
  // The rest of the shell, and the relay: every spec drives both, but neither goes into the ROM.
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
  const paths = readFileSync(0, 'utf8').split('\0').filter(Boolean);
  const { rom, e2e } = paths.length === 0 ? EVERYTHING : scope(paths);
  const e2eOut = e2e === 'all' ? 'all' : e2e.length === 0 ? 'none' : e2e.join(' ');
  console.error(`${paths.length} files changed: rom ${rom}, e2e ${e2eOut}`);
  console.log(`rom=${rom}`);
  console.log(`e2e=${e2eOut}`);
}
