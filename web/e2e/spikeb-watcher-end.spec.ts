// A watcher's end of a match (Cam, 11-21, on a phone: "WATCHING SINBAD", SINBAD won, the Hall of
// Fame played, and then the field came back, not the menu). A page that came into a room's match
// after it locked is no entrant: it got the old panel over the field, where an entrant got the
// results. Now both get the results, and LAST MATCH on the menu opens them again.
//
// The real relay's code, a room of two seats (the host and one bot), a phone that comes in once
// the match is on, and the host out: the bot is the champion at once, on the relay's own rules.
//
// $HBR_E2E_SCRATCH, if set: screenshots of the phone's end.
import http from 'node:http';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { romExists, romHashParam, romPath } from './symbols';

test.skip(!romExists(), `no ROM at ${romPath()} -- set HBR_ROM or place pokeemerald.gba at the repo root, then run tools/br/dev-patch.sh`);

/* eslint-disable @typescript-eslint/no-explicit-any */
const spike = <T>(page: Page, f: (s: any) => T) => page.evaluate((src) => new Function('s', `return (${src})(s)`)((window as any).__spike), f.toString()) as Promise<T>;

const PORT = Number(process.env.HBR_E2E_PORT || 7820) + 6;
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

test('a watcher who never played ends on the results, champion and all, and LAST MATCH opens them again', async ({ browser }) => {
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
    expect(hosted.room.results.entrants.length, 'the host and one bot').toBe(2);

    // The phone comes in once the match is on: on the bench, watching.
    const phone = await pc.newPage();
    phone.on('pageerror', (e) => errors.push(`phone: ${e.message}`));
    await phone.goto(`${url}${new URL(host.url()).hash}`);
    await expect.poll(() => spike(phone, (s) => !!s?.rom && !!s.link?.room && s.waiting && s.spectating), { timeout: 180_000 }).toBe(true);
    const me = await spike(phone, (s) => s.link.me);
    expect(hosted.room.results.entrants.some(([id]: [number, string]) => id === me), 'the phone is no entrant').toBe(false);

    // The host goes out: the bot is the champion, the relay ends the match.
    await spike(host, (s) => s.goOut('out'));
    await expect.poll(() => hosted.room.results.winner, { timeout: 30_000 }).toBeGreaterThan(0);
    const champion = hosted.room.actor(hosted.room.results.winner)?.name as string;

    // The champion's Hall of Fame on the phone's ROM, then the results: not the field.
    await expect(phone.locator('#results-panel'), 'the phone ends on the results').toBeVisible({ timeout: 150_000 });
    await expect(phone.locator('#win'), 'not the panel over the field').toBeHidden();
    await expect(phone.locator('#results-line')).toContainText(`${champion} won`);
    await expect(phone.locator('#results-record'), 'no record of a match it never played').toHaveCount(0);
    await expect(host.locator('#results-panel'), 'and the host, out and watching, as before').toBeVisible({ timeout: 150_000 });
    if (SCRATCH) await phone.screenshot({ path: path.join(SCRATCH, 'watcher-end-results-390x844.png') });
    // The champion's page: their team.
    await phone.locator('#results-page').click();
    await expect(phone.locator('#results-fame')).toContainText(`The champion: ${champion}`);
    if (SCRATCH) await phone.screenshot({ path: path.join(SCRATCH, 'watcher-end-champion-390x844.png') });

    // MAIN MENU: the menu, with LAST MATCH on it, which opens the same results again.
    await phone.locator('#results-menu').click();
    await expect(phone.locator('#lobby-last-match')).toBeVisible({ timeout: 10_000 });
    if (SCRATCH) await phone.screenshot({ path: path.join(SCRATCH, 'watcher-end-menu-390x844.png') });
    await phone.locator('#lobby-last-match').click();
    await expect(phone.locator('#results-panel')).toBeVisible();
    await expect(phone.locator('#results-line')).toContainText(`${champion} won`);
    await expect(phone.locator('#results-again'), 'no PLAY AGAIN off the menu').toHaveCount(0);
    await phone.locator('#results-page').click();
    await expect(phone.locator('#results-fame')).toContainText(`The champion: ${champion}`);
    if (SCRATCH) await phone.screenshot({ path: path.join(SCRATCH, 'watcher-end-last-match-390x844.png') });
    await phone.locator('#results-menu').click();
    await expect(phone.locator('#lobby-last-match'), 'and back to the menu').toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await hc.close();
    await pc.close();
    await r.close();
  }
});
