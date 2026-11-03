import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LEVEL_UP } from '../spike-b/shared/engine/gen3.mjs';
import FIXES from '../spike-b/shared/learnset-fixes.json';

const root = resolve(import.meta.dirname, '../..');
const script = resolve(root, 'tools/br/learnset-fixes.mjs');

/** A list straight off the header, by the name of its array: nothing shared with the script. */
function header(array: string): number[] {
  const text = readFileSync(resolve(root, 'src/data/pokemon/level_up_learnsets.h'), 'utf8');
  const moves = readFileSync(resolve(root, 'include/constants/moves.h'), 'utf8');
  const body = new RegExp(`${array}\\[\\] = \\{([\\s\\S]*?)\\};`).exec(text)![1];
  return [...body.matchAll(/LEVEL_UP_MOVE\(\s*(\d+),\s*(MOVE_\w+)\)/g)].flatMap((m) => [Number(m[1]), Number(new RegExp(`#define ${m[2]}\\s+(\\d+)`).exec(moves)![1])]);
}

describe("the engine's learnsets, corrected to Emerald's (tools/br/learnset-fixes.mjs)", () => {
  it('the table is what the headers say now', () => {
    execFileSync(process.execPath, [script, '--check'], { stdio: 'pipe' });
  });

  it('is the header, level and move, for the species that were wrong', () => {
    const fixes = FIXES as Record<string, number[]>;
    expect(fixes.cacturne).toEqual(header('sCacturneLevelUpLearnset'));
    expect(fixes.charizard).toEqual(header('sCharizardLevelUpLearnset'));
    expect(fixes.mrmime).toEqual(header('sMrMimeLevelUpLearnset'));
    expect(LEVEL_UP.cacturne.join()).not.toBe(fixes.cacturne.join());
  });

  it('numbers only, and nothing a right list did not need', () => {
    const fixes = FIXES as Record<string, number[]>;
    for (const [id, row] of Object.entries(fixes)) {
      expect(LEVEL_UP[id], id).toBeDefined();
      expect(row.length % 2, id).toBe(0);
      for (const n of row) expect(Number.isInteger(n) && n > 0 && n <= 354, `${id}: ${n}`).toBe(true);
      expect(row.join(), `${id} is the engine's already`).not.toBe(LEVEL_UP[id].join());
    }
    // A species the engine has right is not in it.
    expect(fixes.treecko ?? header('sTreeckoLevelUpLearnset')).toEqual(LEVEL_UP.treecko);
  });
});
