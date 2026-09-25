// Every element app.ts asks for by id is in index.html (POK-330 #63).
//
// app.ts's `$` throws on a missing element now, which names the problem; this finds it
// before anybody runs the one mode that reaches the lookup. POK-320 took `#room-leave`
// out of the drawer and solo fell over on it with "Startup failed" (7a4713615), and no
// test that did not go through solo could have seen it.
import { describe, expect, it } from 'vitest';
import appSource from './app.ts?raw';
import indexHtml from '../index.html?raw';

const ids = new Set(Array.from(indexHtml.matchAll(/\bid="([^"]+)"/g), (m) => m[1]));
/** `$('#x')`, `$<T>('#x')` and `$(\`#x-${y}\`)`, with the id (or its literal prefix). */
const lookups = Array.from(appSource.matchAll(/\$(?:<[^>()]+>)?\((['"`])#([^'"`]+)\1/g), (m) => m[2]);

describe("app.ts's element lookups", () => {
  it('finds the lookups at all', () => {
    // A regex that silently matches nothing would make the next test vacuous.
    expect(lookups.length).toBeGreaterThan(30);
  });

  it('every literal id is in index.html', () => {
    const missing = lookups.filter((id) => !id.includes('${')).filter((id) => !ids.has(id));
    expect(missing).toEqual([]);
  });

  it('every templated id has something in index.html it could be', () => {
    for (const id of lookups.filter((l) => l.includes('${'))) {
      const prefix = id.slice(0, id.indexOf('${'));
      expect([...ids].some((known) => known.startsWith(prefix)), `#${id}`).toBe(true);
    }
  });
});
