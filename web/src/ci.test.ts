// The BR workflows' actions, one version each (audit leftover g).
//
// A bump that misses a job goes unseen until that job runs, and the tag-only jobs run
// once a release: `pret` was still on checkout@v4 and cache@v4 -- Node 20 actions --
// after every other job had moved on (POK-331 #28), because it had never run. So every
// `uses:` of an action names the same version as every other. build.yml is pret's own.
import { describe, expect, it } from 'vitest';
import ci from '../../.github/workflows/ci.yml?raw';
import playLog from '../../.github/workflows/play-log.yml?raw';

describe('the BR workflows', () => {
  it('use one version of each action, in every job', () => {
    const versions = new Map<string, Set<string>>();
    for (const source of [ci, playLog]) {
      for (const m of source.matchAll(/^\s*(?:-\s+)?uses:\s*([\w./-]+)@(\S+)/gm)) {
        const seen = versions.get(m[1]) ?? new Set<string>();
        seen.add(m[2]);
        versions.set(m[1], seen);
      }
    }
    // A pattern that matched nothing would pass by saying nothing.
    expect(versions.get('actions/checkout')?.size ?? 0).toBeGreaterThan(0);
    const split = [...versions].filter(([, v]) => v.size > 1).map(([action, v]) => `${action}@${[...v].sort().join('|')}`);
    expect(split).toEqual([]);
  });
});
