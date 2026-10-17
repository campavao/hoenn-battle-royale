// Promo footage, not a test: a solo match played in a 9:16 phone viewport, every frame
// screencast to disk with its time, and the game's own audio taped off its AudioContext.
// HBR_PROMO_OUT=<dir> npx playwright test -c playwright.promo.config.ts
import fs from 'node:fs';
import path from 'node:path';
import { chromium, test } from '@playwright/test';
import { loadSymbols, romHashParam } from './symbols';
import { ram, rig, tap, type Ram } from './play';

const OUT = process.env.HBR_PROMO_OUT ?? path.resolve(import.meta.dirname, 'out/promo');
const SEED = Number(process.env.HBR_PROMO_SEED ?? 5376);
const VIEW = { width: 405, height: 720 };
const LAND = process.env.HBR_PROMO_LAND ?? 'MAP_ROUTE118,56,8';
const DSF = Number(process.env.HBR_PROMO_DSF ?? 1080 / 405);

test.use({ trace: 'off' });

const TAPE_AUDIO = () => {
  const w = window;
  const connect = AudioNode.prototype.connect as (this: AudioNode, ...a: unknown[]) => unknown;
  (AudioNode.prototype as unknown as { connect: unknown }).connect = function (this: AudioNode, dest: unknown, ...rest: unknown[]) {
    const r = connect.call(this, dest, ...rest);
    if (dest instanceof AudioDestinationNode) {
      const ctx = dest.context as AudioContext & { __rec?: MediaStreamAudioDestinationNode };
      if (!ctx.__rec) {
        ctx.__rec = ctx.createMediaStreamDestination();
        const rec = new MediaRecorder(ctx.__rec.stream, { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 192_000 });
        const tape = { chunks: [] as Blob[], t0: Date.now() };
        ((w as unknown as { __tapes?: unknown[] }).__tapes ??= []).push(tape);
        rec.ondataavailable = (e) => tape.chunks.push(e.data);
        rec.start(1000);
      }
      connect.call(this, ctx.__rec);
    }
    return r;
  };
};

test('promo: a solo match, filmed in portrait', async ({ baseURL }) => {
  test.setTimeout(900_000);
  fs.mkdirSync(path.join(OUT, 'frames'), { recursive: true });
  // Playwright's own viewport emulation screencasts at CSS pixels; the browser's real
  // scale factor and a metrics override of our own give device pixels, 1080x1920.
  const browser = await chromium.launch({
    executablePath: process.env.HBR_CHROME || undefined,
    args: ['--autoplay-policy=no-user-gesture-required', `--force-device-scale-factor=${DSF}`, '--window-size=600,900'],
  });
  const ctx = await browser.newContext({ viewport: null, hasTouch: true, baseURL });
  await ctx.addInitScript(TAPE_AUDIO);
  const page = await ctx.newPage();
  page.on('console', (m) => { if (/error|tape/i.test(m.text())) console.log('[page]', m.text()); });
  const sym = loadSymbols();

  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Emulation.setDeviceMetricsOverride', { ...VIEW, deviceScaleFactor: 0, mobile: true });
  const frames: { f: string; t: number }[] = [];
  let n = 0;
  cdp.on('Page.screencastFrame', (e) => {
    const f = `${String(n++).padStart(6, '0')}.jpg`;
    fs.writeFileSync(path.join(OUT, 'frames', f), Buffer.from(e.data, 'base64'));
    frames.push({ f, t: e.metadata.timestamp ?? Date.now() / 1000 });
    void cdp.send('Page.screencastFrameAck', { sessionId: e.sessionId }).catch(() => {});
  });
  const marks: { t: number; what: string }[] = [];
  const mark = (what: string) => { marks.push({ t: Date.now() / 1000, what }); console.log('[promo]', what); };

  if (process.env.HBR_PROMO_LOBBY) {
    // The lobby first, as a player meets it, for the take's opening shot.
    await page.goto(`/#rom=${romHashParam()}`);
    await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: 1080, maxHeight: 1920, everyNthFrame: 1 });
    await page.addStyleTag({ content: '#fps{display:none!important}' }).catch(() => {});
    await page.waitForTimeout(5_000);
    mark('lobby');
    await page.goto('about:blank');
  }
  await page.goto(`/#solo&safari=45&fog=${process.env.HBR_PROMO_FOG ?? 20}&testmon&seed=${SEED}&land=${LAND}&rom=${romHashParam()}`);
  await page.addStyleTag({ content: '#fps{display:none!important}' }).catch(() => {});
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: 1080, maxHeight: 1920, everyNthFrame: 1 });
  await page.waitForFunction(() => (window as unknown as { __hbr?: unknown }).__hbr !== undefined, { timeout: 60_000 });
  await page.waitForSelector('body.in-match', { timeout: 60_000 });
  mark('in-match');

  const until = async (ok: (r: Ram) => boolean, ms: number) => {
    const end = Date.now() + ms;
    for (;;) {
      const r = await ram(page, sym);
      if (ok(r) || Date.now() > end) return r;
      await page.waitForTimeout(250);
    }
  };
  // A battle, played: A through it, the foe rigged weak so a real move lands and wins.
  const fight = async (how: 'weak' | 'won', label: string) => {
    mark(`battle:${label}`);
    const end = Date.now() + 60_000;
    for (;;) {
      const r = await ram(page, sym);
      if (!r.inBattle && r.onOverworld) break;
      if (r.inBattle) await rig(page, sym, Date.now() > end ? 'called' : how);
      await tap(page, 'z');
      await page.waitForTimeout(450);
    }
    mark(`battle-end:${label}`);
  };

  await until((x) => x.phase === 1 && x.onOverworld && x.map === '26:13', 30_000);
  await page.addStyleTag({ content: '#fps{display:none!important}' });
  await page.waitForTimeout(1_500);
  // A patch of grass a tile west, as play.spec.ts puts one.
  await page.evaluate(([a]) => {
    const emu = (window as unknown as { __hbr: { emu: { read(a: number, b: number): number; write(a: number, v: number, b: number): void } } }).__hbr.emu;
    emu.write(a + 16, 14 + 7, 16);
    emu.write(a + 32, 14 + 7, 16);
    emu.write(a + 4, 1, 8);
  }, [sym.gBrPatch] as const);
  mark('safari');
  let dir = 'ArrowLeft';
  for (let i = 0; i < 80 && !(await ram(page, sym)).inBattle; i++) {
    await page.keyboard.down(dir);
    await page.waitForTimeout(300);
    await page.keyboard.up(dir);
    dir = dir === 'ArrowLeft' ? 'ArrowRight' : 'ArrowLeft';
  }
  if ((await ram(page, sym)).inBattle) await fight('weak', 'safari');

  // Wander the Zone until the buzzer.
  const DIRS = ['ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight'];
  const wander = async (stop: (r: Ram) => boolean, ms: number, label: string) => {
    const end = Date.now() + ms;
    let k = 0;
    for (;;) {
      const r = await ram(page, sym);
      if (stop(r) || Date.now() > end) return r;
      if (r.inBattle) { await fight('won', `${label}-${k}`); continue; }
      const d = DIRS[(k++ * 7 + SEED) % 4];
      await page.keyboard.down(d);
      await page.waitForTimeout(400 + (k % 3) * 300);
      await page.keyboard.up(d);
    }
  };
  await wander((x) => x.pick, 75_000, 'zone');
  mark('drop-map');
  await page.waitForTimeout(2_500);
  // Scroll the map a little so the pick reads as a choice, then take it.
  // HBR_PROMO_PICK: the cursor's path, ending on the section HBR_PROMO_LAND is in (the
  // default ends over sea, which reads as a water drop on screen).
  for (const d of (process.env.HBR_PROMO_PICK ?? 'ArrowRight,ArrowRight,ArrowUp,ArrowUp,ArrowLeft').split(',')) { await tap(page, d); await page.waitForTimeout(700); }
  await page.waitForTimeout(800);
  for (let i = 0; i < 20 && (await ram(page, sym)).pick; i++) { await tap(page, 'z'); await page.waitForTimeout(1_000); }
  mark('landed');
  const home = await until((x) => !x.pick && x.onOverworld, 20_000);
  // HBR_PROMO_STOP=<secs>: a pickup take of the drop alone, ended that long after landing.
  const stopAt = process.env.HBR_PROMO_STOP ? Date.now() + Number(process.env.HBR_PROMO_STOP) * 1000 : Infinity;
  // Then to the end of the match, pacing near the landing (the ring closes on it).
  const end = Date.now() + 420_000;
  let k = 0;
  while (!(await page.locator('#results-panel').isVisible()) && Date.now() < end && Date.now() < stopAt) {
    const r = await ram(page, sym);
    if (r.inBattle) { await fight('won', `late-${k++}`); continue; }
    if (!r.onOverworld) { await page.waitForTimeout(300); continue; }
    // HBR_PROMO_HEAL: the party shrugs the fog off, so the take ends on a win.
    if (process.env.HBR_PROMO_HEAL) {
      await page.evaluate((party) => {
        const emu = (window as unknown as { __hbr: { emu: { read(a: number, b: number): number; write(a: number, v: number, b: number): void } } }).__hbr.emu;
        for (let i = 0; i < 6; i++) {
          const m = party + i * 100;
          const hp = emu.read(m + 86, 16), max = emu.read(m + 88, 16);
          if (hp > 0 && hp < max) emu.write(m + 86, max, 16);
        }
      }, sym.gPlayerParty);
    }
    k++;
    const dx = r.x - home.x, dy = r.y - home.y;
    const d = Math.abs(dx) > 3 ? (dx > 0 ? 'ArrowLeft' : 'ArrowRight') : Math.abs(dy) > 2 ? (dy > 0 ? 'ArrowUp' : 'ArrowDown') : DIRS[(k * 5 + (k >> 2)) % 4];
    await page.keyboard.down(d); await page.waitForTimeout(250 + (k % 4) * 150); await page.keyboard.up(d);
    if (k % 6 === 0) await page.waitForTimeout(1_200);
  }
  mark('results');
  await page.waitForTimeout(5_000);
  await cdp.send('Page.stopScreencast');

  const audio = await page.evaluate(async () => {
    const tapes = (window as unknown as { __tapes?: { chunks: Blob[]; t0: number }[] }).__tapes ?? [];
    if (!tapes.length) return null;
    await new Promise((r) => setTimeout(r, 1200));
    const tape = tapes.reduce((a, b) => (b.chunks.length > a.chunks.length ? b : a));
    console.log(`tape: ${tapes.length} recorders, ${tape.chunks.length} chunks`);
    const b = new Blob(tape.chunks, { type: 'audio/webm' });
    const buf = new Uint8Array(await b.arrayBuffer());
    let s = '';
    for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return { t0: tape.t0 / 1000, b64: btoa(s) };
  });
  if (audio) fs.writeFileSync(path.join(OUT, 'audio.webm'), Buffer.from(audio.b64, 'base64'));
  fs.writeFileSync(path.join(OUT, 'timeline.json'), JSON.stringify({ frames, marks, audioT0: audio?.t0 ?? null }, null, 1));
  await browser.close();
});
