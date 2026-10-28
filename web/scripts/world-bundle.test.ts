// relay/world/service.js is web/spike-b/shared, bundled (tools/br/bundle-world.mjs): a change in
// web/spike-b/shared that is not bundled again would leave the relay stepping an older room than the
// page, and every phone would resync forever.
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { it } from 'vitest';

it('relay/world/service.js is the bundle of web/spike-b/shared', () => {
  execFileSync(process.execPath, [resolve(__dirname, '../../tools/br/bundle-world.mjs'), '--check'], { stdio: 'pipe' });
});
