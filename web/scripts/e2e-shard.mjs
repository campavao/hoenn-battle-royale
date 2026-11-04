#!/usr/bin/env node
// One CI shard of the e2e suite, cut by time instead of by count.
//
//     node scripts/e2e-shard.mjs 2/4     # -> e2e/spikeb.spec.ts:38 e2e/spikeb-two.spec.ts:9:32 ...
//
// The suite runs one test at a time (playwright.config.ts: one ROM file, fixed ports),
// and one at a time it was 44 of the rom job's 52 minutes. Each shard is its own runner
// with its own ports and its own ROM, so four of them run side by side. Playwright's
// own --shard cuts by test count in file order, and these tests run from a second to
// four minutes: a quick spec's few tests take less than one hosted match.
// So this lists the suite, gives every test its file's share of FILE_SECONDS, and deals
// the heaviest first to the lightest shard. What it prints is `file:line` filters for
// `playwright test`. A test it does not know gets UNKNOWN_SECONDS: a new spec still runs,
// in some shard; the table only decides which.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// Seconds per spec file: each test's median first-try passing time over 10 runs of BR CI
// (41497767868 to 41534774892, 2026-11-02), summed per file. A first try that timed out is
// left out, and a retry is not counted: the shard pays for those on the day. Refresh it when
// a shard runs much longer than the others: the numbers are in the e2e step's log, one line
// per test. e2e-shard.test.ts fails a spec file that is not in it.
export const FILE_SECONDS = {
  'patch.spec.ts': 9,
  'pwa.spec.ts': 4,
  'recorder.spec.ts': 23,
  'results-scroll.spec.ts': 2,
  'spikeb-fieldfx.spec.ts': 640,
  'spikeb-menu.spec.ts': 209,
  'spikeb-banners.spec.ts': 320,
  'spikeb-people.spec.ts': 125,
  'spikeb-flow.spec.ts': 250,
  'spikeb-radial.spec.ts': 155,
  'spikeb-summary.spec.ts': 130,
  'spikeb-windows.spec.ts': 542,
  'spikeb-room.spec.ts': 230,
  'spikeb.spec.ts': 526,
  'spikeb-two.spec.ts': 102,
  'spikeb-passcode.spec.ts': 9,
  'spikeb-world.spec.ts': 230,
  'watch-replay.spec.ts': 110,
  'battleview.spec.ts': 70,
  'spikeb-battlelog.spec.ts': 450,
  'spikeb-botlegend.spec.ts': 120,
  'spikeb-weather.spec.ts': 180,
  'spikeb-watch-log.spec.ts': 420,
  'spikeb-stuck.spec.ts': 255,
  // Skipped in CI: these need the deployed site, or HBR_SOAK.
  'live-room.spec.ts': 0,
  'live.spec.ts': 0,
};
// The tests far from their file's average, by title (a line moves with every edit above it).
// These seconds come out of the file's total; the rest of its tests share what is left. A
// whole match counted as one seventeenth of spikeb.spec.ts is why one shard ran twice as
// long as two others (9.1 / 3.7 / 6.3 / 3.6 min, run 41526520443).
export const SLOW_TESTS = {
  // These four from one local run with the simulator on (2026-11-03), not yet ten of CI's.
  'a hosted room with bots plays through to its results': 246,
  'a watched bot fight, start to champion: drawn by the page, from one log, on the real relay': 216,
  "the switch off (WORLD_SIM_BOTS=0): a trainer's page fights the bots on its hidden ROM, and its ROM shows it": 80,
  // Skipped unless HBR_SIM_SOAK is set.
  'the standard match: FILL on, default Safari and fog, to a champion, one page': 0,
  'a Safari catch, the drop on the fly map, and out of the Safari': 126,
};
export const UNKNOWN_SECONDS = 60;

/**
 * Deals tests ({ file, line, title }, one entry per test; perf.spec.ts's two share a line) into
 * `total` shards of about equal time. A shard is its `file:line` filters, sorted.
 */
export function cut(tests, total) {
  const slowOf = (t) => (FILE_SECONDS[t.file] === undefined ? undefined : SLOW_TESTS[t.title]);
  const perFile = new Map();
  for (const t of tests) {
    const f = perFile.get(t.file) ?? { rest: 0, slow: new Map() };
    const slow = slowOf(t);
    // By title: a test listed under two projects is still one time.
    if (slow === undefined) f.rest += 1;
    else f.slow.set(t.title, slow);
    perFile.set(t.file, f);
  }
  // One unit per file:line, since that is the finest filter the CLI takes.
  const units = new Map();
  for (const t of tests) {
    const key = `${t.file}:${t.line}`;
    const known = FILE_SECONDS[t.file];
    const f = perFile.get(t.file);
    const slowSum = [...f.slow.values()].reduce((a, b) => a + b, 0);
    const each = known === undefined ? UNKNOWN_SECONDS : Math.max(0, known - slowSum) / f.rest;
    const slow = slowOf(t);
    units.set(key, { file: t.file, line: t.line, seconds: slow ?? (units.get(key)?.seconds ?? 0) + each });
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
    for (const spec of suite.specs ?? []) tests.push({ file: spec.file, line: spec.line, title: spec.title });
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
  // A pull request's own specs (scripts/ci-scope.mjs), space-separated; unset is the suite.
  const only = process.env.E2E_SPECS ? new Set(process.env.E2E_SPECS.split(/\s+/).filter(Boolean)) : undefined;
  const tests = listTests(resolve(dirname(fileURLToPath(import.meta.url)), '..'));
  const shards = cut(only ? tests.filter((t) => only.has(t.file)) : tests, +m[2]);
  const mine = shards[+m[1] - 1];
  // No filters would be no filter at all: playwright would run the whole suite. A few specs
  // leave some shards empty, and those print nothing; the whole suite never should.
  if (mine.filters.length === 0) {
    console.error(`shard ${m[0]} has no tests${only ? ` of the ${only.size} specs asked for` : '; use fewer shards'}`);
    process.exit(only ? 0 : 1);
  }
  console.error(`shard ${m[0]}: ~${mine.seconds}s (${shards.map((s) => s.seconds).join(' / ')})`);
  console.log(mine.filters.join(' '));
}
