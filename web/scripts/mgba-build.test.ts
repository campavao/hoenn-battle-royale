// tools/br/mgba-wasm/build.sh starts by wiping the directory it is given, and the patch it
// builds is edited as uncommitted changes in another mGBA tree on the same box
// (docs/DEPLOY.md). This runs the script under bash with emcc and git stubbed -- the stub
// git makes .git on `init` and fails everything else, so a run that gets past the guard
// stops at the fetch -- and reads back what was left on disk (POK-331 #16 review).
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { findBash } from './bash.testutil';

const script = resolve(__dirname, '../../tools/br/mgba-wasm/build.sh').split('\\').join('/');
const bash = findBash();
const work = mkdtempSync(join(tmpdir(), 'hbr-mgba-build-'));
afterAll(() => rmSync(work, { recursive: true, force: true }));

const bin = join(work, 'bin');
mkdirSync(bin);
const stubs: Record<string, string> = {
  emcc: 'echo 6.0.5',
  git: '[ "$3" = init ] && { mkdir -p "$2/.git"; exit 0; }\necho "git $*" >&2\nexit 1',
};
for (const [name, body] of Object.entries(stubs)) {
  writeFileSync(join(bin, name), `#!/bin/bash\n${body}\n`);
  chmodSync(join(bin, name), 0o755);
}

let runs = 0;
/** A fresh path under the work dir, forward slashes for bash. */
function fresh(): string {
  return join(work, `tree-${++runs}`).split('\\').join('/');
}

function build(dir: string): { status: number | null; stderr: string } {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  env.PATH = `${bin}${delimiter}${env.PATH ?? env.Path ?? ''}`;
  delete env.Path;
  const r = spawnSync(bash!, ['--noprofile', '--norc', script, dir], { env, encoding: 'utf8' });
  return { status: r.status, stderr: r.stderr };
}

const marker = (dir: string) => join(dir, '.git', 'hbr-mgba-build');

// Each run is a bash and a dozen tools, which Windows takes most of a second to start.
describe.skipIf(!bash)('tools/br/mgba-wasm/build.sh', { timeout: 30_000 }, () => {
  it('leaves a directory with files in it that it did not make', () => {
    const dir = fresh();
    mkdirSync(join(dir, '.git'), { recursive: true });
    writeFileSync(join(dir, 'unexported.c'), 'an edit not yet in hbr-exports.patch\n');
    const { status, stderr } = build(dir);
    expect(status).toBe(1);
    expect(stderr).toContain('build.sh did not make it');
    expect(existsSync(join(dir, 'unexported.c'))).toBe(true);
    expect(existsSync(marker(dir))).toBe(false);
  });

  it('wipes a tree it made before, and marks the new one', () => {
    const dir = fresh();
    mkdirSync(join(dir, '.git'), { recursive: true });
    writeFileSync(marker(dir), '');
    mkdirSync(join(dir, 'build-wasm'));
    writeFileSync(join(dir, 'build-wasm', 'stale.o'), '');
    const { stderr } = build(dir);
    expect(stderr).toContain(' fetch ');
    expect(existsSync(join(dir, 'build-wasm', 'stale.o'))).toBe(false);
    expect(existsSync(marker(dir))).toBe(true);
  });

  it('starts in a new directory, and marks it', () => {
    const dir = fresh();
    expect(build(dir).stderr).toContain(' fetch ');
    expect(existsSync(marker(dir))).toBe(true);
  });

  it('starts in an empty directory, and marks it', () => {
    const dir = fresh();
    mkdirSync(dir);
    expect(build(dir).stderr).toContain(' fetch ');
    expect(existsSync(marker(dir))).toBe(true);
  });
});
