// The walk seam-probe.mjs --check and firefox-probe.mjs --check take (POK-329): solo, no
// bots, dropped on Rustboro City's (21,25), where the ROM's whole band -- 104 rows above
// the LCD, 232 below -- is inside the map, then down, up, right and left along the paths
// picture.spec.ts walks, with the core's picture held to the map's still every `every`
// ms (e2e/still.ts). Returns one report per direction and whether all of them are clean.
import fs from 'node:fs';
import path from 'node:path';
import { installStill } from '../e2e/still.ts';

const __dirname = import.meta.dirname;
const SYMBOLS = path.resolve(__dirname, '../public/patch/br-symbols.json');

/** field.ts's romBand for this ROM, and what a portrait phone shows (layoutField). */
export const ROM_BAND = { left: 0, top: 104, right: 16, bottom: 232 };
const RUSTBORO = { id: 'MAP_RUSTBORO_CITY', ref: '0:3' };
const LAND = { x: 21, y: 25 };
const SEED = 5376;
/** picture.spec.ts's thresholds. */
const STILL = { tolerance: 10, pass: 0.5, minPixels: 64 };
const FRAME_PASS = 0.9;

export function landingHash(rom) {
  return `#solo&nobots&testmon&safari=15&seed=${SEED}&land=${RUSTBORO.id},${LAND.x},${LAND.y}&rom=${rom}`;
}

function symbols() {
  const raw = JSON.parse(fs.readFileSync(SYMBOLS, 'utf8'));
  return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, Number.parseInt(v, 16)]));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Where the player is, and whether the drop map is up. */
function where(page, sym) {
  return page.evaluate((s) => {
    const emu = window.__hbr.emu;
    const sb1 = emu.read(s.gSaveBlock1Ptr, 32);
    const s16 = (v) => (v << 16) >> 16;
    return {
      pick: emu.read(s.gBrPick, 8) !== 0,
      field: (emu.read(s.gMain + 4, 32) & ~1) === s.CB2_Overworld,
      map: sb1 ? `${emu.read(sb1 + 4, 8)}:${emu.read(sb1 + 5, 8)}` : '',
      x: sb1 ? s16(emu.read(sb1, 16)) : -1,
      y: sb1 ? s16(emu.read(sb1 + 2, 16)) : -1,
    };
  }, sym);
}

async function walk(page, key, done, ms) {
  await page.keyboard.down(key);
  try {
    const until = Date.now() + ms;
    while (Date.now() < until && !(await done())) await sleep(20);
  } finally {
    await page.keyboard.up(key);
  }
  await sleep(500);
}

/** On a page already at landingHash(): lands, checks the band, walks, reports. `out` is a
 *  directory for the worst picture of each direction. */
export async function checkWalk(page, { every = 40, out = null, log = console.log } = {}) {
  const sym = symbols();
  await page.waitForFunction(() => window.__hbr !== undefined, null, { timeout: 180_000 });
  await page.waitForSelector('body.in-match', { timeout: 180_000 });
  for (let t = Date.now(); ; ) {
    const w = await where(page, sym);
    if (w.pick) {
      await page.keyboard.down('KeyZ');
      await sleep(90);
      await page.keyboard.up('KeyZ');
    }
    if (!w.pick && w.field && w.map === RUSTBORO.ref && w.x === LAND.x && w.y === LAND.y) break;
    if (Date.now() - t > 120_000) throw new Error(`never landed on Rustboro ${LAND.x},${LAND.y}: ${JSON.stringify(w)}`);
    await sleep(1000);
  }
  await sleep(3000);

  let clean = true;
  const band = await page.evaluate(() => window.__hbr.emu.viewport);
  log(`band ${JSON.stringify(band)}`);
  if (!band || band.top < ROM_BAND.top || band.bottom < ROM_BAND.bottom) {
    log(`FAIL the core draws ${band?.top ?? 0} rows above the LCD and ${band?.bottom ?? 0} below; a portrait phone shows about ${ROM_BAND.top} and ${ROM_BAND.bottom} of the ROM's ring, and past the band they are the page's still, not the ROM's map`);
    clean = false;
  }

  await page.evaluate(installStill, {
    sym: { gSaveBlock1Ptr: sym.gSaveBlock1Ptr, gSaveBlock2Ptr: sym.gSaveBlock2Ptr, gTasks: sym.gTasks, gFieldCamera: sym.gFieldCamera, gMain: sym.gMain, CB2_Overworld: sym.CB2_Overworld },
    stills: { [RUSTBORO.ref]: `/field-maps/${RUSTBORO.id}.png` },
    every,
    ...STILL,
  });
  const here = () => where(page, sym);
  const legs = [
    ['down', 'ArrowDown', async () => (await here()).y >= LAND.y + 6, 5_000],
    ['up', 'ArrowUp', async () => (await here()).y <= 11, 12_000],
    ['right', 'ArrowRight', async () => (await here()).x >= LAND.x + 6, 5_000],
    ['left', 'ArrowLeft', async () => (await here()).x <= LAND.x, 5_000],
  ];
  const reports = {};
  for (const [name, key, done, ms] of legs) {
    await page.evaluate(() => window.__still.start());
    await walk(page, key, done, ms);
    const r = await page.evaluate(() => window.__still.stop());
    reports[name] = r;
    const ok = r.samples > 10 && r.missed === 0 && r.worstFrame >= FRAME_PASS && r.picture?.height === 160 + (band?.top ?? 0) + (band?.bottom ?? 0);
    if (!ok) clean = false;
    const w = r.worstAt;
    log(`${ok ? 'ok  ' : 'FAIL'} ${name.padEnd(5)} ${r.samples} pictures (${r.moving} mid-step, ${r.lagged} lagged), ${r.cells} cells, ${r.missed} not the still; worst picture ${(100 * r.worstFrame).toFixed(1)}%, worst cell ${(100 * r.worst).toFixed(1)}%${w ? ` at ${w.x},${w.y} (${w.cam.x},${w.cam.y} sub ${w.cam.subX},${w.cam.subY})` : ''}`);
    if (out) {
      const png = await page.evaluate(() => window.__still.worstPng());
      if (png) fs.writeFileSync(path.join(out, `check-${name}-worst.png`), Buffer.from(png.split(',')[1], 'base64'));
    }
  }
  return { clean, band, reports };
}
