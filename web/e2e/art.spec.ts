// The field's pictures, cut from the ROM in the page (HBR-66), held to the ones the site
// used to ship. Until v0.3.38 every map's ground, cover and border and every sprite sheet
// was a PNG in web/public, drawn from pret's files by tools/br/render-maps.py and
// export-sprites.py; art.sha1.json is the hash of each of those PNGs' pixels, at the
// ROM's own 5-bit colour, taken before they were deleted. The page's cut of the same
// path must hash the same.
//
// A change to a map's or a sprite's graphics changes its hash on purpose: look at the
// new picture, then `HBR_ART_WRITE=1 npx playwright test e2e/art.spec.ts` to take the
// page's hashes as the new truth.
import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { romExists, romHashParam, romPath } from './symbols';

const __dirname = import.meta.dirname;
const HASHES = path.join(__dirname, 'art.sha1.json');
const WORLD = path.resolve(__dirname, '../src/data/world.json');
const SHEETS = path.resolve(__dirname, '../src/data/sprites.json');

test.beforeAll(() => {
  test.skip(!romExists(), `no ROM at ${romPath()} -- set HBR_ROM, then run tools/br/dev-patch.sh`);
});

/** Every path the page draws the field's art from. */
function artPaths(): string[] {
  const maps = (JSON.parse(fs.readFileSync(WORLD, 'utf8')) as { maps: { id: string; outdoor?: boolean }[] }).maps.filter((m) => m.outdoor);
  const sheets = Object.keys(JSON.parse(fs.readFileSync(SHEETS, 'utf8')) as Record<string, unknown>);
  return [
    ...maps.flatMap((m) => ['', '.cover', '.border'].map((l) => `/field-maps/${m.id}${l}.png`)),
    ...[...sheets, 'fog', 'patch-tall-grass', 'patch-water', 'patch-shadow'].map((s) => `/field-sprites/${s}.png`),
  ].sort();
}

type W = { __hbr: { art(path: string): Promise<string> } };

test('every map and sprite the page cuts from the ROM is the picture the site used to ship', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto(`/#solo&nobots&testmon&safari=15&seed=5376&land=MAP_LITTLEROOT_TOWN,10,10&rom=${romHashParam()}`);
  await page.waitForSelector('body.in-match', { timeout: 60_000 });
  // HBR_ART_FILES=1 hashes the files at the same paths instead (the dev server's public/,
  // while they were still there): how art.sha1.json was first made.
  const fromFiles = process.env.HBR_ART_FILES === '1';
  const got = await page.evaluate(async ([paths, files]) => {
    const out: Record<string, string> = {};
    for (const p of paths) {
      try {
        const url = files ? p : await (window as unknown as W).__hbr.art(p);
        const res = await fetch(url);
        if (!res.ok) throw new Error(String(res.status));
        const img = await createImageBitmap(await res.blob());
        const c = new OffscreenCanvas(img.width, img.height);
        const g = c.getContext('2d')!;
        g.drawImage(img, 0, 0);
        const px = g.getImageData(0, 0, img.width, img.height).data;
        // Each pixel at 5 bits a channel, bit 15 where drawn: what the GBA can show.
        const q = new Uint16Array(2 + px.length / 4);
        q[0] = img.width;
        q[1] = img.height;
        for (let i = 0; i < px.length; i += 4) q[2 + i / 4] = px[i + 3] ? 0x8000 | (px[i] >> 3) | ((px[i + 1] >> 3) << 5) | ((px[i + 2] >> 3) << 10) : 0;
        const sha = new Uint8Array(await crypto.subtle.digest('SHA-1', q));
        out[p] = `${img.width}x${img.height} ${Array.from(sha, (b) => b.toString(16).padStart(2, '0')).join('')}`;
      } catch (err) {
        out[p] = `missing: ${err instanceof Error ? err.message : String(err)}`;
      }
    }
    return out;
  }, [artPaths(), fromFiles] as const);

  if (process.env.HBR_ART_WRITE === '1') {
    fs.writeFileSync(HASHES, JSON.stringify(got, null, 1) + '\n');
    console.log(`wrote ${Object.keys(got).length} hashes to ${HASHES}`);
    return;
  }
  const want = JSON.parse(fs.readFileSync(HASHES, 'utf8')) as Record<string, string>;
  const differ = Object.keys({ ...want, ...got }).filter((p) => want[p] !== got[p]).map((p) => `${p}: want ${want[p]}, got ${got[p]}`);
  console.log(`${Object.keys(got).length - differ.length}/${Object.keys(got).length} pictures as shipped`);
  expect(differ, 'pictures not as shipped').toEqual([]);
});
