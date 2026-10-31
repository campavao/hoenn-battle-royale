import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** The WORLD_HASH tools/br/bundle-world.mjs stamped into relay/world/service.js: what the
 *  relay steps. The page's builds define it as __WORLD_HASH__ and send it with every join
 *  (spike-b/net.ts), so a page is never in a room of another world. Read from the copy the
 *  bundler writes inside web/ (spike-b/world-hash.json; --check holds the two together):
 *  Vercel builds the site from web/ alone, where relay/ is not. A dev server reads it once,
 *  at its start: bundle the world again and restart it. */
export function worldHash(): string {
  const { hash } = JSON.parse(readFileSync(resolve(import.meta.dirname, 'spike-b/world-hash.json'), 'utf8')) as { hash?: string };
  if (!hash || !/^[0-9a-f]+$/.test(hash)) throw new Error('web/spike-b/world-hash.json has no hash: run node tools/br/bundle-world.mjs');
  return hash;
}
