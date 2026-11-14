// Every picture the page cuts from the player's ROM is the file the site used to ship.
//
// Until 2026-11-14 web/public carried 1,552 Nintendo-derived PNGs at /field-maps/,
// /field-sprites/, /mon-pics/, /trainer-pics/ and /ui/; the page asks for the same paths, and
// spike B cuts each from the ROM (spike-b/romcuts.ts, src/art/pictures.ts). art.sha1.json is
// each old file's hash at the ROM's own 5-bit colour (tools/br/art-hashes.py, which says how a
// hash is made), taken before they were deleted. The page's cut of the same path must hash the
// same, so a cut that is one pixel off, a palette off, or laid out differently fails here.
//
// A change to a graphic in the ROM changes its hash on purpose: look at the new picture, run
// the exporters (they write build/br-art), then `python tools/br/art-hashes.py build/br-art >
// web/e2e/art.sha1.json`.
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { romExists, romHashParam, romPath } from './symbols';

const HASHES = path.join(import.meta.dirname, 'art.sha1.json');

test.skip(!romExists(), `no ROM at ${romPath()} -- set HBR_ROM or place pokeemerald.gba at the repo root, then run tools/br/dev-patch.sh`);

test('every picture the page cuts from the ROM is the one the site used to ship', async ({ page }) => {
  test.setTimeout(240_000);
  const want = JSON.parse(fs.readFileSync(HASHES, 'utf8')) as Record<string, string>;
  await page.goto(`/?rom=${romHashParam()}`);
  await expect(page.locator('#lobby-rows button', { hasText: 'QUICK PLAY' })).toBeVisible({ timeout: 90_000 });
  const got = await page.evaluate(async (paths) => {
    const pictures = await import(/* @vite-ignore */ '/src/art/pictures.ts' as string) as typeof import('../src/art/pictures');
    const out: Record<string, string> = {};
    for (const p of paths) {
      // A cut whose data is still loading (the fill's) is asked again.
      let cv = pictures.romPicture(p);
      for (let i = 0; cv === undefined && i < 100; i++) {
        await new Promise((r) => setTimeout(r, 100));
        cv = pictures.romPicture(p);
      }
      if (!cv) { out[p] = cv === null ? 'none' : 'never cut'; continue; }
      const px = cv.getContext('2d')!.getImageData(0, 0, cv.width, cv.height).data;
      const font = p === '/ui/font-normal.png';
      const q = new Uint16Array(2 + px.length / 4);
      q[0] = cv.width;
      q[1] = cv.height;
      for (let i = 0; i < px.length; i += 4) {
        q[2 + i / 4] = !px[i + 3] ? 0 : font ? 0x8000 | px[i] : 0x8000 | (px[i] >> 3) | ((px[i + 1] >> 3) << 5) | ((px[i + 2] >> 3) << 10);
      }
      const sha = new Uint8Array(await crypto.subtle.digest('SHA-1', q));
      out[p] = `${cv.width}x${cv.height} ${Array.from(sha, (b) => b.toString(16).padStart(2, '0')).join('')}`;
    }
    return out;
  }, Object.keys(want));
  // HBR_ART_GOT=<file>: the page's hashes, in art.sha1.json's form, to look at a difference.
  if (process.env.HBR_ART_GOT) fs.writeFileSync(process.env.HBR_ART_GOT, JSON.stringify(got, null, 1) + '\n');
  const differ = Object.keys(want).filter((p) => want[p] !== got[p]).map((p) => `${p}: want ${want[p]}, got ${got[p]}`);
  console.log(`${Object.keys(want).length - differ.length}/${Object.keys(want).length} pictures cut as shipped`);
  expect(differ, 'pictures not as shipped').toEqual([]);
});
