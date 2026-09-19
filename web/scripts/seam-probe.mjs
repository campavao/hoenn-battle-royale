// The seam between the core's band and the page's map copy, photographed while walking
// (Cam, 2026-09-18 phone: "NPCs cut off above the band as I move back and forth" and "the
// screen jittering on the top left, up, down, based on which way you're going"). Boots
// solo in Chromium at phone size, holds Up then Down, and saves a strip around the band's
// top edge ten times a second into e2e/out/seam/<dir>-NN.png plus the layout numbers.
//
//   node scripts/seam-probe.mjs "<rom path>"
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const rom = (process.argv[2] ?? '').replace(/\\/g, '/');
const out = path.resolve('e2e/out/seam');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
await page.goto(`http://localhost:5199/#solo&rom=${rom}`);
await page.waitForSelector('body.in-match', { timeout: 180_000 });
await page.waitForTimeout(3000);

const lay = await page.evaluate(() => {
  const c = document.querySelector('#canvas');
  const r = c.getBoundingClientRect();
  const b = window.__hbr.emu.viewport;
  return { canvasTop: r.top, canvasH: r.height, scale: r.width / (240 + (b?.left ?? 0) + (b?.right ?? 0)), band: b };
});
console.log(JSON.stringify(lay));
// The strip: 40 CSS px above the band's top edge to 60 below it.
const seamY = lay.canvasTop;
const clip = { x: 0, y: Math.max(0, seamY - 60), width: 390, height: 140 };

for (const [dir, key] of [['up', 'ArrowUp'], ['down', 'ArrowDown'], ['up2', 'ArrowUp']]) {
  await page.keyboard.down(key);
  for (let i = 0; i < 24; i++) {
    await page.screenshot({ path: path.join(out, `${dir}-${String(i).padStart(2, '0')}.png`), clip });
    await page.waitForTimeout(40);
  }
  await page.keyboard.up(key);
  await page.waitForTimeout(400);
}
await page.screenshot({ path: path.join(out, 'whole.png') });
await browser.close();
console.log('done');
