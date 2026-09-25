// The probes here boot cores of their own in the page, and a core boots only from its
// own filesystem. Since POK-330 #40 the page keeps the patched game in memory, never in
// IndexedDB, so a probe that loads a path it did not write loads nothing: headless-probe
// did, from /data/games/patched.gba (POK-331 #17).
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const probes = readdirSync(__dirname).filter((f) => f.endsWith('.mjs'));

describe('the probes', () => {
  it('load only images they wrote', () => {
    const unwritten: string[] = [];
    let loads = 0;
    for (const file of probes) {
      const src = readFileSync(join(__dirname, file), 'utf8');
      for (const [, path] of src.matchAll(/loadGame\(\s*'([^']+)'/g)) {
        loads++;
        if (!src.includes(`FS.writeFile('${path}'`)) unwritten.push(`${file}: ${path}`);
      }
    }
    expect(loads, 'some probe boots a core of its own').toBeGreaterThan(0);
    expect(unwritten).toEqual([]);
  });
});
