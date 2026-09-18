// A Firefox look at the picture past the LCD (POK-319, Cam's 2026-09-18 play-test was in
// Firefox): boot solo on the dev server, walk into the grass until a battle starts, and
// write what the canvas, its clip and the layout say every second, with screenshots.
//
//   node scripts/firefox-probe.mjs "<rom path>" [seconds]
import { firefox } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const rom = (process.argv[2] ?? '').replace(/\\/g, '/');
const seconds = Number(process.argv[3] ?? 90);
const out = path.resolve('e2e/out/firefox');
fs.mkdirSync(out, { recursive: true });

const browser = await firefox.launch();
const page = await browser.newPage({ viewport: { width: 540, height: 1200 } });
page.on('console', (m) => { if (m.type() === 'error') console.log('console:', m.text()); });
await page.goto(`http://localhost:5199/#solo&rom=${rom}`);
await page.waitForFunction(() => window.__hbr !== undefined, null, { timeout: 120_000 });
await page.waitForSelector('body.in-match', { timeout: 120_000 });
console.log('in match');

const state = () => page.evaluate(() => {
  const c = document.querySelector('#canvas');
  const r = c.getBoundingClientRect();
  const emu = window.__hbr.emu;
  return {
    canvas: { w: c.width, h: c.height, css: [Math.round(r.width), Math.round(r.height)], top: Math.round(r.top), style: c.getAttribute('style') },
    clip: getComputedStyle(c).clipPath,
    viewport: emu.viewport,
    box: [document.querySelector('#screen-wrap').clientWidth, document.querySelector('#screen-wrap').clientHeight],
  };
});

let walking = 'ArrowUp';
for (let t = 0; t < seconds; t++) {
  if (t % 6 === 0) {
    await page.keyboard.up(walking);
    walking = ['ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight'][(t / 6) % 4];
    await page.keyboard.down(walking);
  }
  if (t % 4 === 2) { await page.keyboard.down('KeyZ'); await page.waitForTimeout(80); await page.keyboard.up('KeyZ'); }
  await page.waitForTimeout(1000);
  const s = await state();
  console.log(`${String(t).padStart(3)}s canvas ${s.canvas.w}x${s.canvas.h} css ${s.canvas.css.join('x')} top ${s.canvas.top} clip ${s.clip} box ${s.box.join('x')}`);
  if (t % 5 === 0) await page.screenshot({ path: path.join(out, `t${String(t).padStart(3, '0')}.png`) });
}
await browser.close();
