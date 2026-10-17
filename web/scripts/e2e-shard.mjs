#!/usr/bin/env node
// One CI shard of the e2e suite, cut by time instead of by count.
//
//     node scripts/e2e-shard.mjs 2/4     # -> e2e/lobby.spec.ts:18 e2e/play-again.spec.ts:32 ...
//
// The suite runs one test at a time (playwright.config.ts: one ROM file, fixed ports),
// and one at a time it was 44 of the rom job's 52 minutes. Each shard is its own runner
// with its own ports and its own ROM, so four of them run side by side. Playwright's
// own --shard cuts by test count in file order, and these tests run from a second to
// four minutes: lobby.spec.ts's fourteen tests take less than one of play-again's four.
// So this lists the suite, gives every test its file's share of FILE_SECONDS, and deals
// the heaviest first to the lightest shard. What it prints is `file:line` filters for
// `playwright test`. A test it does not know gets UNKNOWN_SECONDS: a new spec still runs,
// in some shard; the table only decides which.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// Seconds per spec file, summed from CI's own list reporter (BR CI run 38784449512,
// 2026-10-15, the v0.3.3 release). Refresh it when a shard runs much longer than the
// others: the numbers are in the e2e step's log, one line per test.
export const FILE_SECONDS = {
  'battle-menu.spec.ts': 32,
  'boot.spec.ts': 4,
  'bots.spec.ts': 3,
  'curtain.spec.ts': 11,
  'lobby.spec.ts': 103,
  'match.spec.ts': 198,
  'migration.spec.ts': 111,
  'out-watch.spec.ts': 144,
  'passcode.spec.ts': 7,
  'patch.spec.ts': 1,
  'people-past-box.spec.ts': 10,
  'perf.spec.ts': 119,
  'phone-hud.spec.ts': 9,
  'phone.spec.ts': 10,
  'picture.spec.ts': 216,
  'play-again.spec.ts': 930,
  'play.spec.ts': 264,
  'pvp-items.spec.ts': 72,
  'pwa.spec.ts': 4,
  'refresh-rate.spec.ts': 30, // estimated: two 6 s windows plus boots
  'solo.spec.ts': 204,
  'spectate-dpad.spec.ts': 13,
  'spectate.spec.ts': 72,
  'stall.spec.ts': 41,
  'tap.spec.ts': 6,
  'walk-and-see.spec.ts': 13,
  'watch.spec.ts': 42,
  'world-moves.spec.ts': 10,
  // Skipped in CI: these need the deployed site, or HBR_SOAK.
  'live-room.spec.ts': 0,
  'live.spec.ts': 0,
  'soak.spec.ts': 0,
};
export const UNKNOWN_SECONDS = 60;

/**
 * Deals tests ({ file, line }, one entry per test; perf.spec.ts's two share a line) into
 * `total` shards of about equal time. A shard is its `file:line` filters, sorted.
 */
export function cut(tests, total) {
  const perFile = new Map();
  for (const t of tests) perFile.set(t.file, (perFile.get(t.file) ?? 0) + 1);
  // One unit per file:line, since that is the finest filter the CLI takes.
  const units = new Map();
  for (const t of tests) {
    const key = `${t.file}:${t.line}`;
    const known = FILE_SECONDS[t.file];
    const each = known === undefined ? UNKNOWN_SECONDS : known / perFile.get(t.file);
    units.set(key, { file: t.file, line: t.line, seconds: (units.get(key)?.seconds ?? 0) + each });
  }
  const order = [...units.values()].sort(
    (a, b) => b.seconds - a.seconds || a.file.localeCompare(b.file) || a.line - b.line,
  );
  const shards = Array.from({ length: total }, () => ({ seconds: 0, units: [] }));
  for (const u of order) {
    const lightest = shards.reduce((min, s) => (s.seconds < min.seconds ? s : min));
    lightest.seconds += u.seconds;
    lightest.units.push(u);
  }
  return shards.map((s) => ({
    seconds: Math.round(s.seconds),
    filters: s.units
      .sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)
      // `e2e/` in front: a filter is a regex on the path, and `watch.spec.ts` alone
      // would also pick out-watch.spec.ts.
      .map((u) => `e2e/${u.file}:${u.line}`),
  }));
}

/** Every test playwright would run here, from its own --list. */
function listTests(web) {
  // Node and the CLI's own file rather than `npx`, which is npx.cmd on Windows.
  const cli = resolve(web, 'node_modules/@playwright/test/cli.js');
  const out = execFileSync(process.execPath, [cli, 'test', '--list', '--reporter=json'], {
    cwd: web,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  const tests = [];
  const walk = (suite) => {
    // One spec is one test: a local run lists play.spec.ts under play-firefox too, as a
    // second entry in the same spec's `tests`, and the filter is the same one.
    for (const spec of suite.specs ?? []) tests.push({ file: spec.file, line: spec.line });
    for (const child of suite.suites ?? []) walk(child);
  };
  for (const suite of JSON.parse(out).suites) walk(suite);
  return tests;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const m = /^(\d+)\/(\d+)$/.exec(process.argv[2] ?? '');
  if (!m || +m[1] < 1 || +m[1] > +m[2]) {
    console.error('usage: e2e-shard.mjs <index>/<total>, e.g. 2/4');
    process.exit(2);
  }
  const shards = cut(listTests(resolve(dirname(fileURLToPath(import.meta.url)), '..')), +m[2]);
  const mine = shards[+m[1] - 1];
  // No filters would be no filter at all: playwright would run the whole suite.
  if (mine.filters.length === 0) {
    console.error(`shard ${m[0]} has no tests; use fewer shards`);
    process.exit(1);
  }
  console.error(`shard ${m[0]}: ~${mine.seconds}s (${shards.map((s) => s.seconds).join(' / ')})`);
  console.log(mine.filters.join(' '));
}
