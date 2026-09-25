// Does a second, headless core instance emulate, and leave the first's canvas alone?
// (The bots' core is one; emscripten's SDL names its canvas "#canvas" by selector, so a
// windowed second instance resized the first's canvas -- the squashed picture of
// 2026-09-18.) Boots solo in Chromium, waits for the match, then makes one instance each
// way and reports.
//
//   node scripts/headless-probe.mjs "<rom path>"
import { chromium } from 'playwright';

const rom = (process.argv[2] ?? '').replace(/\\/g, '/');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
page.on('console', (m) => { if (m.type() === 'error') console.log('console:', m.text()); });
await page.goto(`http://localhost:5199/#solo&rom=${rom}`);
await page.waitForSelector('body.in-match', { timeout: 180_000 });
console.log('in match');

for (const headless of [true, false]) {
  const r = await page.evaluate(async (headless) => {
    const mod = await import('/emu/mgba.js');
    const syms = await (await fetch('/patch/br-symbols.json')).json();
    const gMain = parseInt(syms.gMain, 16);
    // The image the page booted, out of its core's memory: since POK-330 #40 the patched
    // game is never stored in IndexedDB, so a second core is handed the bytes and writes
    // them itself, as the bots' core does (app.ts, other.startBytes).
    const image = window.__hbr.emu.m.FS.readFile('/patched.gba');
    const hidden = document.createElement('canvas');
    const m = await mod.default({ canvas: hidden, brHeadless: headless });
    await m.FSInit();
    m.FS.writeFile('/patched.gba', image);
    const ok = m.loadGame('/patched.gba');
    const rd = () => { const u = m.HEAPU8; const p = m._brIwramPtr() + (gMain + 4 - 0x03000000); return ((u[p] | (u[p + 1] << 8) | (u[p + 2] << 16) | (u[p + 3] << 24)) >>> 0).toString(16); };
    await new Promise((r) => setTimeout(r, 4000));
    const cb2 = rd();
    m.screenshot('p.png');
    const bytes = m.FS.readFile('/data/screenshots/p.png');
    const img = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height;
    const ctx = cv.getContext('2d'); ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, img.width, img.height).data;
    const set = new Set();
    for (let i = 0; i < d.length; i += 4 * 53) set.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]);
    const c = document.querySelector('#canvas');
    m.quitGame();
    return { headless, ok, cb2, colours: set.size, mainCanvas: `${c.width}x${c.height}` };
  }, headless);
  console.log(JSON.stringify(r));
}
await browser.close();
