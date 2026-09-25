// CI's web job runs on a bare checkout with no `make`, so nothing the ROM build writes
// exists there. A `?raw` import of a generated file passes on every machine that has
// built and fails only in CI: map_groups.h did, on every push (POK-330 #1). So each file
// the unit tests read raw is tracked, or named by a step of the web job before its
// tests -- the step that makes it.
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const web = resolve(__dirname, '..');
const repo = resolve(web, '..');

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return sources(path);
    return /\.[cm]?[jt]s$/.test(e.name) ? [path] : [];
  });
}

/** Every `?raw` import under web/src and web/scripts, repo-relative with forward slashes. */
function rawImports(): string[] {
  const found = new Set<string>();
  for (const file of [...sources(join(web, 'src')), ...sources(join(web, 'scripts'))]) {
    for (const m of readFileSync(file, 'utf8').matchAll(/from\s+['"]([^'"]+)\?raw['"]/g)) {
      found.add(relative(repo, resolve(dirname(file), m[1])).split('\\').join('/'));
    }
  }
  return [...found].sort();
}

/** The web job's non-comment lines up to its `npm test`. */
function stepsBeforeTests(): string {
  const ci = readFileSync(join(repo, '.github/workflows/ci.yml'), 'utf8').replace(/\r\n/g, '\n');
  const job = ci.slice(ci.indexOf('\n  web:\n'));
  const upTo = job.indexOf('run: npm test');
  expect(upTo, 'the web job runs npm test').toBeGreaterThan(0);
  return job
    .slice(0, upTo)
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .join('\n');
}

function tracked(paths: string[]): Set<string> | null {
  try {
    const out = execFileSync('git', ['ls-files', '-z', '--', ...paths], { cwd: repo });
    return new Set(out.toString().split('\0').filter(Boolean));
  } catch {
    return null; // not a clone (an unpacked archive): nothing to compare against
  }
}

const raw = rawImports();
const inGit = tracked(raw);

describe('the web job', () => {
  it.skipIf(!inGit)('has every file the unit tests read raw', () => {
    expect(raw.length).toBeGreaterThan(0);
    const steps = stepsBeforeTests();
    const missing = raw.filter((p) => !inGit!.has(p) && !steps.includes(p));
    expect(missing).toEqual([]);
  });
});
