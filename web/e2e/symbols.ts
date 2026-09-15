// Reads the dev sidecars tools/br/dev-patch.sh writes (br-symbols.json, br-version.json)
// straight off disk -- Node side of the same contract src/release.ts reads over HTTP.
// Kept separate from src/ on purpose: e2e is not part of the shipped bundle or its
// tsconfig, and has no business importing app code.
import fs from 'node:fs';
import path from 'node:path';

// web/package.json sets "type": "module" -- import.meta.dirname (Node 20.11+/24)
// stands in for __dirname, which does not exist in ESM scope.
const __dirname = import.meta.dirname;

const PATCH_DIR = path.resolve(__dirname, '../public/patch');
export const SYMBOLS_PATH = path.join(PATCH_DIR, 'br-symbols.json');
export const VERSION_PATH = path.join(PATCH_DIR, 'br-version.json');

export function sidecarsExist(): boolean {
  return fs.existsSync(SYMBOLS_PATH) && fs.existsSync(VERSION_PATH);
}

/** name -> bus address, parsed from the hex strings br-symbols.json stores. */
export function loadSymbols(): Record<string, number> {
  const raw = JSON.parse(fs.readFileSync(SYMBOLS_PATH, 'utf8')) as Record<string, string>;
  const out: Record<string, number> = {};
  for (const [name, hex] of Object.entries(raw)) out[name] = Number.parseInt(hex, 16);
  return out;
}

/** Absolute path to the pre-patched local build, forward-slashed for the `#rom=`
 *  hash param (app.ts fetches it through Vite's /@fs/ route). */
export function romPath(): string {
  const configured = process.env.HBR_ROM || path.resolve(__dirname, '../../pokeemerald.gba');
  return path.resolve(configured);
}

export function romExists(): boolean {
  return fs.existsSync(romPath());
}

export function romHashParam(): string {
  return romPath().replace(/\\/g, '/');
}
