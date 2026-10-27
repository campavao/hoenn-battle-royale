// A watcher is out, not in (Cam's 2026-10-26 play-test: "I refreshed and for some reason
// I can play again?"). The host went out, reloaded, and took the menu's WATCH: its page
// joined as a watcher, followed nobody, and left the ROM's own trainer standing in
// Littleroot to walk -- and its START menu was a player's, whose BAG was nobody's.
//
// Two trainers in a match and a third page through `#watch=CODE`: the watcher follows
// one of them without being asked, its own trainer stays put, and START's BAG is the
// watched trainer's bag (the peek box, gBrSpectate.peeking).
import fs from 'node:fs';
import path from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { loadSymbols, romExists, romHashParam, romPath } from './symbols';

const __dirname = import.meta.dirname;
const OUT_DIR = path.resolve(__dirname, 'out');
const BR_NO_SEAT = 0xff;
/** include/br/br_spectate.h: struct BrSpectate. */
const SPECTATE_FOLLOW = 8;
const SPECTATE_PEEKING = 10;

test.beforeAll(() => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  test.skip(!romExists(), `no ROM at ${romPath()} -- set HBR_ROM or place pokeemerald.gba at the repo root, then run tools/br/dev-patch.sh`);
});

type Ram = { read(addr: number, width: 8 | 16 | 32): number };
type Dev = { __br: { bridge: { seat: number }; mailbox: { ram: Ram } } };

test('a watcher follows somebody, cannot walk, and its BAG is theirs', async ({ browser }) => {
  test.setTimeout(240_000);
  const rom = romHashParam();
  const sym = loadSymbols();
  const ctxs = await Promise.all([browser.newContext(), browser.newContext(), browser.newContext()]);
  try {
    const ready = async (p: Page) => {
      await p.waitForFunction(() => (window as unknown as { __br?: unknown }).__br !== undefined, { timeout: 30_000 });
      await p.waitForFunction((addr) => (window as unknown as Dev).__br.mailbox.ram.read(addr, 16) === 0x4252, sym.gBrMailbox, { timeout: 30_000 });
    };
    const host = await ctxs[0].newPage();
    await host.goto(`/#host&noauto&nobots&testmon&rom=${rom}`);
    await ready(host);
    const codeEl = host.locator('#room-code');
    await expect(codeEl).toHaveText(/Room [A-Z0-9]{6}/, { timeout: 30_000 });
    const code = ((await codeEl.textContent()) ?? '').match(/Room ([A-Z0-9]{6})/)?.[1];
    if (!code) throw new Error('could not parse a room code');
    const guest = await ctxs[1].newPage();
    await guest.goto(`/#join=${code}&noauto&nobots&testmon&rom=${rom}`);
    await ready(guest);
    await host.locator('#room-start').click();
    await guest.waitForSelector('body.in-match', { timeout: 60_000 });
    const seats = [
      await host.evaluate(() => (window as unknown as Dev).__br.bridge.seat),
      await guest.evaluate(() => (window as unknown as Dev).__br.bridge.seat),
    ];

    const watcher = await ctxs[2].newPage();
    await watcher.goto(`/#watch=${code}&rom=${rom}`);
    await ready(watcher);
    const follow = () =>
      watcher.evaluate(([addr, off]) => (window as unknown as Dev).__br.mailbox.ram.read(addr + off, 8), [sym.gBrSpectate, SPECTATE_FOLLOW]);
    await expect.poll(follow, { timeout: 60_000, message: 'the watcher follows somebody without being asked' }).not.toBe(BR_NO_SEAT);
    expect(seats).toContain(await follow());

    const onField = () =>
      watcher.evaluate(([main, cb2]) => ((window as unknown as Dev).__br.mailbox.ram.read(main + 4, 32) & ~1) === cb2, [sym.gMain, sym.CB2_Overworld & ~1]);
    await expect.poll(onField, { timeout: 30_000, message: 'on the field' }).toBe(true);
    await watcher.waitForTimeout(1500);

    // Its own trainer stays where it is: DOWN held is nobody's step.
    const pos = () =>
      watcher.evaluate(([obj, id]) => {
        const r = (window as unknown as Dev).__br.mailbox.ram;
        const me = obj + r.read(id, 8) * 0x24;
        return `${r.read(me + 0x10, 16)},${r.read(me + 0x12, 16)}`;
      }, [sym.gObjectEvents, sym.gPlayerAvatar + 5]);
    const before = await pos();
    await watcher.keyboard.down('ArrowDown');
    await watcher.waitForTimeout(1200);
    await watcher.keyboard.up('ArrowDown');
    await watcher.waitForTimeout(500);
    expect(await pos(), 'the watcher took no step').toBe(before);

    // START, down to BAG, A: the watched trainer's bag, in the peek box. Each key held
    // a few frames, as a thumb does: a press inside one frame can fall between two.
    const tap = async (key: string) => {
      await watcher.keyboard.down(key);
      await watcher.waitForTimeout(120);
      await watcher.keyboard.up(key);
      await watcher.waitForTimeout(400);
    };
    await tap('Enter');
    await tap('ArrowDown');
    await tap('z');
    const peeking = () =>
      watcher.evaluate(([addr, off]) => (window as unknown as Dev).__br.mailbox.ram.read(addr + off, 8), [sym.gBrSpectate, SPECTATE_PEEKING]);
    await expect.poll(peeking, { timeout: 10_000, message: "BAG opened the watched trainer's bag" }).toBe(1);
    await watcher.waitForTimeout(500);
    await watcher.screenshot({ path: path.join(OUT_DIR, 'watch-locked-bag.png') });
  } finally {
    for (const c of ctxs) await c.close().catch(() => {});
  }
});
