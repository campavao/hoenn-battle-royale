// CI's e2e shards (scripts/e2e-shard.mjs): every test in exactly one, cut by time.
import { describe, expect, it } from 'vitest';
import { cut, FILE_SECONDS, UNKNOWN_SECONDS } from './e2e-shard.mjs';

const at = (file: string, ...lines: number[]) => lines.map((line) => ({ file, line }));

describe('e2e-shard', () => {
  it('puts every test in one shard and no test in two', () => {
    const tests = [
      ...at('lobby.spec.ts', 18, 64, 105, 151),
      ...at('play-again.spec.ts', 32, 139, 199, 206),
      ...at('picture.spec.ts', 289, 380),
      ...at('boot.spec.ts', 14),
    ];
    const filters = cut(tests, 3).flatMap((s) => s.filters);
    expect(filters.sort()).toEqual(tests.map((t) => `e2e/${t.file}:${t.line}`).sort());
  });

  it('cuts by time, not count: the four long tests go four ways', () => {
    const shards = cut([...at('lobby.spec.ts', 18, 64, 105, 151), ...at('play-again.spec.ts', 32, 139, 199, 206)], 4);
    for (const s of shards) expect(s.filters.filter((f) => f.startsWith('e2e/play-again.spec.ts'))).toHaveLength(1);
    const each = FILE_SECONDS['play-again.spec.ts'] / 4;
    expect(Math.max(...shards.map((s) => s.seconds))).toBeLessThanOrEqual(Math.round(each + FILE_SECONDS['lobby.spec.ts']));
  });

  it('runs a spec the table has never seen, and keeps two tests on one line one filter', () => {
    const shards = cut([...at('brand-new.spec.ts', 9), ...at('perf.spec.ts', 61, 61)], 2);
    const filters = shards.flatMap((s) => s.filters);
    expect(filters.sort()).toEqual(['e2e/brand-new.spec.ts:9', 'e2e/perf.spec.ts:61']);
    expect(shards.map((s) => s.seconds).sort((a, b) => a - b)).toEqual([UNKNOWN_SECONDS, FILE_SECONDS['perf.spec.ts']]);
  });

  it('names the path from web/, so watch.spec.ts cannot also pick out-watch.spec.ts', () => {
    const [s] = cut(at('watch.spec.ts', 19), 1);
    expect(s.filters).toEqual(['e2e/watch.spec.ts:19']);
  });
});
