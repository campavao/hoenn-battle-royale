// PLAY AGAIN after watching (Cam, 11-22, on a phone: "Was spectating a quick play, game
// finished, I hit play again, now I'm stuck here and the game hasn't started yet" -- the room
// said "A match is on" under it). A page that came into a room while its match was on kept the
// room as it was then, and PLAY AGAIN put that back up: a match on, for good.
//
// The real relay's code, a room of two seats (the host and one bot), a phone that comes in once
// the match is on, and the host out: the bot is the champion at once, on the relay's own rules.
//
// $HBR_E2E_SCRATCH, if set: screenshots of the phone's room after PLAY AGAIN.
import http from 'node:http';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { romExists, romHashParam, romPath } from './symbols';

test.skip(!romExists(), `no ROM at ${romPath()} -- set HBR_ROM or place pokeemerald.gba at the repo root, then run tools/br/dev-patch.sh`);

/* eslint-disable @typescript-eslint/no-explicit-any */
const spike = <T>(page: Page, f: (s: any) => T) => page.evaluate((src) => new Function('s', `return (${src})(s)`)((window as any).__spike), f.toString()) as Promise<T>;

const PORT = Number(process.env.HBR_E2E_PORT || 7820) + 7;
const WORLD = `ws://localhost:${PORT}/world`;
const SCRATCH = process.env.HBR_E2E_SCRATCH || '';

async function setOption(page: Page, id: string, want: string): Promise<void> {
  const b = page.locator(`#${id}`);
  for (let i = 0; i < 12 && (await b.textContent())?.trim() !== want; i++) {
    const was = await b.textContent();
    await b.click();
    await expect(b).not.toHaveText(was ?? '', { timeout: 10_000 });
  }
  await expect(b).toHaveText(want);
}

/** The relay's own code, served here, as a deploy runs it. */
async function relay() {
  delete process.env.WORLD_BOTS;
  delete process.env.WORLD_SIM_BOTS;
  const { createWorld } = (await import('../../relay/world.js' as string)) as any;
  const world = createWorld({ log: () => undefined });
  const server = http.createServer((_, res) => res.end('ok'));
  server.on('upgrade', (req, socket, head) => world.handle(req, socket, head, '127.0.0.1'));
  const sockets = new Set<import('node:net').Socket>();
  server.on('connection', (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
  await new Promise<void>((ok) => server.listen(PORT, ok));
  return {
    match: () => [...(world.service as any).rooms.values()][0],
    close: async () => {
      const closed = new Promise((ok) => server.close(ok));
      world.close();
      for (const s of sockets) s.destroy();
      await closed;
    },
  };
}

test('a watcher who came in mid-match gets the room between matches from PLAY AGAIN', async ({ browser }) => {
  test.setTimeout(360_000);
  const r = await relay();
  const errors: string[] = [];
  const hc = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const pc = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const url = `/?rom=${romHashParam()}&world=${encodeURIComponent(WORLD)}`;
  try {
    const host = await hc.newPage();
    host.on('pageerror', (e) => errors.push(`host: ${e.message}`));
    await host.goto(`${url}#host`);
    await expect(host.locator('#room-code')).toHaveText(/Room [A-Z0-9]{6}/, { timeout: 120_000 });
    await setOption(host, 'room-max', 'MAX 2');
    await setOption(host, 'room-safari', 'NO SAFARI');
    await expect(host.locator('#room-start')).toBeEnabled({ timeout: 30_000 });
    await host.locator('#room-start').click();
    await expect.poll(() => !!r.match()?.host, { timeout: 30_000 }).toBe(true);
    await expect.poll(() => spike(host, (s) => !!s.rom && !!s.link?.room?.actor(s.link.me)), { timeout: 180_000 }).toBe(true);
    const hosted = r.match().host;

    // The phone comes in once the match is on: the room it is told of says so.
    const phone = await pc.newPage();
    phone.on('pageerror', (e) => errors.push(`phone: ${e.message}`));
    await phone.goto(`${url}${new URL(host.url()).hash}`);
    await expect.poll(() => spike(phone, (s) => !!s?.rom && !!s.link?.room && s.waiting && s.spectating), { timeout: 180_000 }).toBe(true);

    // The host goes out: the bot is the champion, the relay ends the match.
    await spike(host, (s) => s.goOut('out'));
    await expect.poll(() => hosted.room.results.winner, { timeout: 30_000 }).toBeGreaterThan(0);
    await expect.poll(() => !!r.match()?.host, { timeout: 30_000 }).toBe(false);
    await expect(phone.locator('#results-panel')).toBeVisible({ timeout: 150_000 });

    // PLAY AGAIN: the room as it is now, between matches -- not the match it walked in on.
    await phone.locator('#results-again').click();
    await expect(phone.locator('#room-code')).toHaveText(/Room [A-Z0-9]{6}/, { timeout: 10_000 });
    await expect.poll(() => spike(phone, (s) => s.lobby?.room?.playing), { timeout: 10_000 }).toBe(false);
    await expect(phone.locator('#room-note')).not.toContainText('match is on');
    await expect(phone.locator('#room-note')).toContainText('host');
    if (SCRATCH) await phone.screenshot({ path: path.join(SCRATCH, 'watcher-again-room-390x844.png') });
    expect(errors).toEqual([]);
  } finally {
    await hc.close();
    await pc.close();
    await r.close();
  }
});
