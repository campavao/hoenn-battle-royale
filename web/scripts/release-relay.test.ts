// A tag's relay deploy (ci.yml, the release job) runs once per release, on a runner,
// with secrets nobody can see, so a wrong token only shows on release day. This runs the
// step's own script under bash with git, npm and railway stubbed, once per set of
// secrets, and reads back what railway was asked and with which token (POK-331 #15).
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { findBash } from './bash.testutil';

const repo = resolve(__dirname, '../..');

/** The step's secrets by env name, and its run script, out of ci.yml. */
function relayStep(): { env: Record<string, string>; run: string } {
  const ci = readFileSync(join(repo, '.github/workflows/ci.yml'), 'utf8').replace(/\r\n/g, '\n');
  const from = ci.indexOf('- name: Relay to Railway');
  expect(from, 'the release job has a relay step').toBeGreaterThan(0);
  const lines = ci.slice(from).split('\n');
  const env: Record<string, string> = {};
  let i = 1;
  for (; !/^\s*run: \|$/.test(lines[i]); i++) {
    const m = lines[i].match(/^\s+([A-Z_]+): \$\{\{ secrets\.([A-Z_]+) \}\}$/);
    if (m) env[m[1]] = m[2];
  }
  const indent = lines[i + 1].match(/^ */)![0];
  const run: string[] = [];
  for (i++; i < lines.length && (lines[i] === '' || lines[i].startsWith(indent)); i++) run.push(lines[i].slice(indent.length));
  return { env, run: run.join('\n') };
}

const bash = findBash();
const work = mkdtempSync(join(tmpdir(), 'hbr-relay-step-'));
afterAll(() => rmSync(work, { recursive: true, force: true }));

const stubs: Record<string, string> = {
  // `git describe` finds the previous tag; `git diff --quiet` says whether relay/ moved.
  git: '[ "$1" = describe ] && { echo v0.0.1; exit 0; }\n[ "$1" = diff ] && exit "${RELAY_UNCHANGED:-1}"\nexit 0',
  npm: 'exit 0',
  railway: 'echo "$*|${RAILWAY_TOKEN-unset}|${RAILWAY_API_TOKEN-unset}" >> "$CALLS"',
};

/** Runs the step with these secrets (a missing secret is '' on Actions). */
function runStep(secrets: Record<string, string>, extra: Record<string, string> = {}): { calls: string[]; out: string } {
  const dir = mkdtempSync(join(work, 'run-'));
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  mkdirSync(join(dir, 'relay'));
  for (const [name, body] of Object.entries(stubs)) {
    writeFileSync(join(bin, name), `#!/bin/bash\n${body}\n`);
    chmodSync(join(bin, name), 0o755);
  }
  const step = relayStep();
  writeFileSync(join(dir, 'step.sh'), step.run);
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !k.startsWith('RAILWAY_')) env[k] = v;
  for (const [name, secret] of Object.entries(step.env)) env[name] = secrets[secret] ?? '';
  Object.assign(env, extra, { TAG: 'v0.0.2', CALLS: join(dir, 'calls.txt') });
  env.PATH = `${bin}${delimiter}${env.PATH ?? env.Path ?? ''}`;
  delete env.Path;
  const out = execFileSync(bash!, ['--noprofile', '--norc', '-e', 'step.sh'], { cwd: dir, env, encoding: 'utf8' });
  const calls = existsSync(env.CALLS) ? readFileSync(env.CALLS, 'utf8').trim().split('\n') : [];
  return { calls, out };
}

const UP = 'up --service hoenn-relay --detach --ci';
const LINK = 'link --project 34e1da0b-5125-40be-9954-d90fafa3e156 --environment production --service hoenn-relay';

describe.skipIf(!bash)("the release job's relay step", () => {
  it('deploys with the project token as RAILWAY_TOKEN, unlinked', () => {
    const { calls } = runStep({ RAILWAY_PROJECT_TOKEN: 'proj' });
    expect(calls).toEqual([`${UP}|proj|unset`]);
  });

  it('prefers the project token when both are set', () => {
    const { calls } = runStep({ RAILWAY_PROJECT_TOKEN: 'proj', RAILWAY_TOKEN: 'acct' });
    expect(calls).toEqual([`${UP}|proj|unset`]);
  });

  it('falls back to the account token as RAILWAY_API_TOKEN, linked first', () => {
    const { calls } = runStep({ RAILWAY_TOKEN: 'acct' });
    expect(calls).toEqual([`${LINK}|unset|acct`, `${UP}|unset|acct`]);
  });

  it('warns and deploys nothing with neither', () => {
    const { calls, out } = runStep({});
    expect(calls).toEqual([]);
    expect(out).toContain('::warning::');
  });

  it('leaves the relay up when relay/ did not change', () => {
    const { calls, out } = runStep({ RAILWAY_PROJECT_TOKEN: 'proj' }, { RELAY_UNCHANGED: '0' });
    expect(calls).toEqual([]);
    expect(out).toContain('the relay stays up');
  });
});
