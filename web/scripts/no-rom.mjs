// A build must never carry a ROM. Runs after `vite build`, because public/ is copied
// into dist/ verbatim and the dev ROM lives in public/patch/ (tools/br/dev-patch.sh).
//
// The shell only ever fetches that file under import.meta.env.DEV, and .vercelignore
// keeps it out of an upload -- but both of those are a rule somebody has to remember.
// This is the one that does not need remembering. A published ROM is somebody else's
// copyright and the project's own rule is that it lives on the player's device.
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const BANNED = /\.(gba|sav|ss[0-9])$/i;
const found = [];

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else if (BANNED.test(name)) found.push(path);
  }
}

try {
  walk('dist');
} catch (err) {
  if (err.code !== 'ENOENT') throw err;
  console.error('no dist/ to check -- did vite build run?');
  process.exit(1);
}

if (found.length > 0) {
  console.error('REFUSING THIS BUILD: it carries a ROM or a save.\n  ' + found.join('\n  '));
  console.error('\nThese are dev artifacts (tools/br/dev-patch.sh). Take them out of');
  console.error('web/public/ before building for anybody but yourself.');
  process.exit(1);
}
console.log('dist is clean: no ROM, no saves.');
