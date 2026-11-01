// The play-test recorder (spike-b/recorder.ts) on the page: K and a held eye mark the moment,
// a tap on the eye does not, and SAVE LOG hands over a file that holds the match.
import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import { romExists, romHashParam, romPath } from './symbols';

test.beforeAll(() => {
  test.skip(!romExists(), `no ROM at ${romPath()} -- set HBR_ROM or place pokeemerald.gba at the repo root, then run tools/br/dev-patch.sh`);
});

async function intoSolo(page: Page): Promise<void> {
  await page.goto(`/?solo&rom=${romHashParam()}#seed=777&fog=600&safari=600`);
  await page.waitForFunction(() => { const s = (window as unknown as { __spike?: { link?: unknown; rom?: unknown } }).__spike; return !!s?.link && !!s?.rom; }, undefined, { timeout: 120_000 });
  await page.locator('#intro-go').click();
}

/** SAVE LOG, the row above EXIT, off the menu's first row. */
async function saveFromMenu(page: Page): Promise<void> {
  await page.waitForFunction(() => (window as unknown as { __spike: { asking: boolean } }).__spike.asking);
  for (let i = 0; i < 2; i++) {
    await page.keyboard.press('ArrowUp');
    await page.waitForTimeout(100);
  }
  await page.keyboard.press('z');
}

test.describe('on a desktop', () => {
  test('K marks, the legend says so, and SAVE LOG downloads the recording', async ({ page }) => {
    test.setTimeout(180_000);
    await intoSolo(page);
    await expect(page.locator('#keys .k-mark')).toContainText('K');
    await page.waitForTimeout(1000);
    await page.keyboard.press('k');
    await expect(page.locator('#mark-toast')).toContainText('MARK 1');
    await page.evaluate(() => console.error('recorder spec: an error for the log'));
    const download = page.waitForEvent('download');
    await page.keyboard.press('m');
    await saveFromMenu(page);
    const d = await download;
    expect(d.suggestedFilename()).toMatch(/^hoenn-playtest-.*\.json$/);
    const file = JSON.parse(fs.readFileSync(await d.path(), 'utf8')) as { format: string; version: { romSha1: string } | null; marks: { map: string; via: string }[]; log: { k: string; msg?: string }[] };
    expect(file.format).toBe('hoenn-playtest-1');
    expect(file.version?.romSha1).toMatch(/^[0-9a-f]{7}$/);
    expect(file.marks[0]).toMatchObject({ via: 'key', map: expect.stringContaining('MAP_') });
    expect(file.log[0].k).toBe('start');
    expect(file.log.filter((e) => e.k === 'f').length).toBeGreaterThan(30);
    expect(file.log.some((e) => e.k === 'err' && e.msg?.includes('an error for the log'))).toBe(true);
  });
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('holding the eye marks, a tap does not, and the share sheet gets the file', async ({ page, context }) => {
    test.setTimeout(180_000);
    await intoSolo(page);
    const eye = page.locator('#mark-eye');
    await expect(eye).toBeVisible();
    const box = (await eye.boundingBox())!;
    const cdp = await context.newCDPSession(page);
    const touch = (type: 'touchStart' | 'touchEnd') => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: box.x + box.width / 2, y: box.y + box.height / 2 }] });
    await touch('touchStart');
    await page.waitForTimeout(100);
    await touch('touchEnd');
    await page.waitForTimeout(700);
    await expect(page.locator('#mark-toast')).toBeHidden();
    await touch('touchStart');
    await page.waitForTimeout(700);
    await touch('touchEnd');
    await expect(page.locator('#mark-toast')).toContainText('MARK 1');
    // A phone that can share a file does (recorder.ts saveRecording).
    await page.evaluate(() => {
      const w = window as unknown as { shared: string[] };
      w.shared = [];
      navigator.canShare = () => true;
      navigator.share = async (d) => { w.shared.push(d!.files![0].name); };
    });
    await page.locator('#hud-start').click();
    await saveFromMenu(page);
    await expect.poll(() => page.evaluate(() => (window as unknown as { shared: string[] }).shared[0])).toMatch(/^hoenn-playtest-/);
    // One that refuses it gets the download instead.
    await page.evaluate(() => { navigator.share = async () => { throw new DOMException('no', 'NotAllowedError'); }; });
    // The dock takes START again once it has seen the menu close.
    await page.waitForTimeout(1500);
    const download = page.waitForEvent('download');
    await page.locator('#hud-start').click();
    await saveFromMenu(page);
    expect((await download).suggestedFilename()).toMatch(/^hoenn-playtest-/);
  });
});
