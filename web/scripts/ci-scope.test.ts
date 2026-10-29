// What BR CI runs on a pull request (scripts/ci-scope.mjs): from the files it changes.
import { describe, expect, it } from 'vitest';
import { scope } from './ci-scope.mjs';

describe('ci-scope', () => {
  it('runs nothing of the ROM or the e2e suite for a spike B change', () => {
    // #172's files.
    expect(
      scope([
        'relay/world.js',
        'relay/world.test.js',
        'relay/world/service.js',
        'web/spike-b/main.ts',
        'web/spike-b/shared/host.ts',
        'tools/br/bundle-world.mjs',
      ]),
    ).toEqual({ rom: false, e2e: [] });
  });

  it('runs nothing for words', () => {
    expect(scope(['docs/DESIGN.md', 'relay/README.md', 'CLAUDE.md', '.claude/hooks/rom-fresh.sh'])).toEqual({ rom: false, e2e: [] });
  });

  it('runs the specs a change touches, and every spec for a helper they share', () => {
    expect(scope(['web/e2e/tap.spec.ts', 'web/e2e/boot.spec.ts'])).toEqual({ rom: false, e2e: ['boot.spec.ts', 'tap.spec.ts'] });
    expect(scope(['web/e2e/tap.spec.ts', 'web/e2e/symbols.ts'])).toEqual({ rom: false, e2e: 'all' });
  });

  it('runs every spec but not the ROM for the shell or the relay', () => {
    expect(scope(['web/src/app.ts'])).toEqual({ rom: false, e2e: 'all' });
    expect(scope(['relay/server.js', 'web/spike-b/main.ts'])).toEqual({ rom: false, e2e: 'all' });
  });

  it('runs the ROM job for the shell files it reads: the BPS decoder, the version, the sprite sheets', () => {
    for (const path of ['web/src/patch/bps.ts', 'web/src/rom/emerald.ts', 'web/src/data/sprites.json', 'web/package.json']) {
      expect(scope([path]), path).toEqual({ rom: true, e2e: 'all' });
    }
  });

  it('runs everything for the ROM, the tools, CI, or a path no rule names', () => {
    for (const path of ['src/br/br_loot.c', 'tools/br/drivers/smoke.txt', '.github/workflows/ci.yml', 'Makefile', 'somewhere/new.txt']) {
      expect(scope(['docs/DESIGN.md', path]), path).toEqual({ rom: true, e2e: 'all' });
    }
  });
});
