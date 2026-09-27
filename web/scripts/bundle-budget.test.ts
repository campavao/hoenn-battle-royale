// The main script's budget (the audit's leftover e): vite.config.ts fails the build when
// main is over 350 KB, or carries the world data that is fetched on demand.
import { describe, expect, it } from 'vitest';
import { MAIN_BUDGET, overBudget } from '../vite.config';

const chunk = (bytes: number, moduleIds: string[] = ['/r/web/index.html?html-proxy&index=0.js', '/r/web/src/app.ts']) => ({
  fileName: 'assets/main-X.js',
  code: 'x'.repeat(bytes),
  moduleIds,
});

describe('the bundle budget', () => {
  it('passes a main under the line with no world data in it', () => {
    expect(overBudget(chunk(231_440))).toEqual([]);
    expect(overBudget(chunk(MAIN_BUDGET))).toEqual([]);
  });

  it('fails a main over the line, by the byte', () => {
    expect(overBudget(chunk(MAIN_BUDGET + 1))).toEqual([`assets/main-X.js is ${MAIN_BUDGET + 1} B, over the ${MAIN_BUDGET} B budget`]);
    // Bytes, not characters: an em dash is three of them.
    expect(overBudget({ ...chunk(0), code: '—'.repeat(MAIN_BUDGET / 3 + 1) })).toHaveLength(1);
  });

  it('fails a main that carries world.json or landing.json, however small', () => {
    const problems = overBudget(chunk(1000, ['C:/r/web/src/app.ts', 'C:/r/web/src/data/world.json', '/r/web/src/data/landing.json']));
    expect(problems).toHaveLength(2);
    expect(problems[0]).toContain('world.json');
    expect(problems[1]).toContain('landing.json');
    // The small tables stay in main: only the two big ones are fetched on demand.
    expect(overBudget(chunk(1000, ['/r/web/src/data/regionmap.json', '/r/web/src/data/landing-hand.json']))).toEqual([]);
  });
});
