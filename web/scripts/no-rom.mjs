// A build must never carry a ROM. Runs after `vite build`, because public/ is copied
// into dist/ verbatim and the dev ROM lives in public/patch/ (tools/br/dev-patch.sh).
//
// The shell only ever fetches that file under import.meta.env.DEV, and .vercelignore
// keeps it out of an upload -- but both of those are a rule somebody has to remember.
// This is the one that does not need remembering. A published ROM is somebody else's
// copyright and the project's own rule is that it lives on the player's device.
//
// By name AND by content (POK-330 #57): every other lock matches the extension, so a ROM
// renamed to .bin, or saved without one, walked straight past all three. A save has no
// header to find, so saves are still caught by name only.
import { closeSync, openSync, readSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const BANNED = /\.(gba|sav|ss[0-9])$/i;

// The cartridge header, which a rename does not touch: the first bytes of the Nintendo
// logo at 0x04 (the BIOS refuses to boot without it) with the fixed 0x96 at 0xB2 that
// every GBA ROM carries, or Emerald's own game code, 'BPEE', at 0xAC.
const HEADER_LEN = 0xc0;
const LOGO_HEAD = [0x24, 0xff, 0xae, 0x51, 0x69, 0x9a, 0xa2, 0x21];

/** Does this file's first 0xC0 bytes look like a GBA ROM, whatever it is called? */
export function looksLikeRom(head) {
  if (head.length < HEADER_LEN) return false;
  const logo = LOGO_HEAD.every((b, i) => head[4 + i] === b) && head[0xb2] === 0x96;
  const emerald = head[0xac] === 0x42 && head[0xad] === 0x50 && head[0xae] === 0x45 && head[0xaf] === 0x45;
  return logo || emerald;
}

function readHead(path) {
  const buf = new Uint8Array(HEADER_LEN);
  const fd = openSync(path, 'r');
  try {
    return buf.subarray(0, readSync(fd, buf, 0, HEADER_LEN, 0));
  } finally {
    closeSync(fd);
  }
}

/** Every file under `dir` that is a ROM or a save, by name or by its header. */
export function findRoms(dir) {
  const found = [];
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const path = join(d, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (BANNED.test(name) || looksLikeRom(readHead(path))) found.push(path);
    }
  };
  walk(dir);
  return found;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let found;
  try {
    found = findRoms('dist');
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
}
