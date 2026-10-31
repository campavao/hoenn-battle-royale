import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** The WORLD_HASH tools/br/bundle-world.mjs stamped into relay/world/service.js: what the
 *  relay steps. The page's builds define it as __WORLD_HASH__ and send it with every join
 *  (spike-b/net.ts), so a page is never in a room of another world. A dev server reads it
 *  once, at its start: bundle the world again and restart it. */
export function worldHash(): string {
  const bundle = readFileSync(resolve(import.meta.dirname, '../relay/world/service.js'), 'utf8');
  const m = /export const WORLD_HASH = "([0-9a-f]+)";\s*$/.exec(bundle);
  if (!m) throw new Error('relay/world/service.js has no WORLD_HASH: run node tools/br/bundle-world.mjs');
  return m[1];
}
