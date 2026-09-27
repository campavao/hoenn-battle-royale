// Reads the dev sidecars tools/br/dev-patch.sh writes (br-symbols.json, br-version.json)
// straight off disk -- Node side of the same contract src/release.ts reads over HTTP.
// Kept separate from src/ on purpose: e2e is not part of the shipped bundle or its
// tsconfig, and has no business importing app code.
import fs from 'node:fs';
import path from 'node:path';
import { expect, type Page } from '@playwright/test';

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

/** The picture the ROM declares (POK-329): `struct BrFieldView` (include/br/br_field.h),
 *  six u16s at gBrFieldView, read here off the ROM file the page boots -- a spec cannot
 *  import field.ts's romBand. */
export function romView(): { viewport: { left: number; top: number; right: number; bottom: number }; sprites: { top: number; bottom: number } } {
  const at = loadSymbols().gBrFieldView;
  if (at === undefined) throw new Error('no gBrFieldView in br-symbols.json: run tools/br/dev-patch.sh on a build that has it');
  const rom = fs.readFileSync(romPath());
  const u16 = (i: number) => rom.readUInt16LE(at - 0x08000000 + 2 * i);
  return { viewport: { left: u16(0), top: u16(1), right: u16(2), bottom: u16(3) }, sprites: { top: u16(4), bottom: u16(5) } };
}

/** The host presses START once `members` are seated (POK-320: a hosted room waits for
 *  its host, the way Cam asked; only quick play and the daily start themselves). The
 *  seats are counted first because a room that fills with bots has START lit before
 *  anybody else arrives, and pressing it then locks the door on the guest. */
export async function startWith(host: Page, members: number): Promise<void> {
  await expect(host.locator('#room-roster li')).toHaveCount(members, { timeout: 60_000 });
  const start = host.locator('#room-start');
  await expect(start).toBeEnabled({ timeout: 60_000 });
  await start.click();
}

export function romHashParam(): string {
  return romPath().replace(/\\/g, '/');
}
