// Two players on spike B, through the relay: what one trainer is (their MY VOICE), what
// they carry (their BAG, for a watcher's START) and what they win with (their team, in
// everybody's Hall of Fame) reaches the other trainer's page. Unit tests cover each
// half; this is the wire between two real pages and two real ROMs.
import { test, expect, type Page } from '@playwright/test';
import { romExists, romHashParam, romPath } from './symbols';

test.beforeAll(() => {
  test.skip(!romExists(), `no ROM at ${romPath()} -- set HBR_ROM or place pokeemerald.gba at the repo root, then run tools/br/dev-patch.sh`);
});

/** Presses a room option until its label reads `want` (each press steps it once). */
async function setOption(page: Page, id: string, want: string): Promise<void> {
  const b = page.locator(`#${id}`);
  for (let i = 0; i < 6 && (await b.textContent())?.trim() !== want; i++) {
    const was = await b.textContent();
    await b.click();
    await expect(b).not.toHaveText(was ?? '', { timeout: 10_000 });
  }
  await expect(b).toHaveText(want);
}

/** The walk to the nearest marked Safari spot nobody has taken, over the room's own
 *  step function, as directions: 1 south, 2 north, 3 west, 4 east (spikeb.spec.ts route). */
async function toPatch(page: Page): Promise<number[] | null> {
  return page.evaluate(() => {
    const s = (window as unknown as { __spike: { link: { me: number; room: any } } }).__spike;
    const room = s.link.room, a = room.actor(s.link.me);
    const ok = (p: { map: string; x: number; y: number }) => room.patchesOn(p.map).some((q: { x: number; y: number }) => q.x === p.x && q.y === p.y) && !room.taken.has(room.patchKey ? room.patchKey(p) : -1);
    const step = room.stepFor(a);
    const k = (p: { map: string; x: number; y: number }) => `${p.map}:${p.x}:${p.y}`;
    const from = new Map<string, [string, number] | null>([[k(a.m.spot), null]]);
    const q = [a.m.spot];
    for (let i = 0; i < q.length && i < 6000; i++) {
      const p = q[i];
      if (i > 0 && ok(p)) {
        const dirs: number[] = [];
        for (let c = k(p); from.get(c); c = from.get(c)![0]) dirs.unshift(from.get(c)![1]);
        return dirs;
      }
      for (const d of [1, 2, 3, 4]) {
        const r = step(p, d);
        if (!r || r.warp || r.water || from.has(k(r.to))) continue;
        from.set(k(r.to), [k(p), d]);
        q.push(r.to);
      }
    }
    return null;
  });
}

const KEY = { 1: 'ArrowDown', 2: 'ArrowUp', 3: 'ArrowLeft', 4: 'ArrowRight', a: 'z' } as Record<number | string, string>;
const key = (page: Page, k: string, down: boolean) => page.evaluate(([k, down]) => dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { key: k as string, bubbles: true })), [k, down] as const);

/** To marked spots until something is caught; the party count after. */
async function catchOne(page: Page): Promise<number> {
  type S = { link: { me: number; room: { actor(id: number): { m: { spot: { map: string; x: number; y: number } } } | undefined } }; rom?: { partyCount(): number }; battle: unknown };
  const s = <T>(f: (s: S) => T) => page.evaluate((src) => new Function('s', `return (${src})(s)`)((window as unknown as { __spike: S }).__spike), f.toString()) as Promise<T>;
  const spot = () => s((s) => { const p = s.link.room.actor(s.link.me)?.m.spot; return p ? `${p.map}:${p.x}:${p.y}` : ''; });
  let caught = 0;
  for (let tries = 0; tries < 8 && !caught; tries++) {
    const dirs = await toPatch(page);
    if (!dirs) break;
    for (const d of dirs) {
      const was = await spot();
      await key(page, KEY[d], true);
      await expect.poll(async () => (await spot()) !== was || !!(await s((s) => s.battle)), { timeout: 15_000, intervals: [30] }).toBe(true);
      await key(page, KEY[d], false);
      if (await s((s) => s.battle)) break;
    }
    await expect.poll(() => s((s) => !!s.battle), { timeout: 5_000 }).toBe(true).catch(() => undefined);
    for (let t = 0; t < 45 && (await s((s) => !!s.battle)); t++) {
      await key(page, KEY.a, true); await page.waitForTimeout(150); await key(page, KEY.a, false);
      await page.waitForTimeout(1850);
    }
    caught = await s((s) => s.rom?.partyCount() ?? 0);
  }
  return caught;
}

type Spike = {
  link: { me: number; teams: Map<number, { species: number }[]>; bags: Map<number, { items: { id: number; n: number }[]; money: number }>; room: { actor(id: number): unknown; results: { winner: number } } };
  room: { members: { id: number; rec?: { intro?: number; win?: number; lose?: number } }[] } | null;
  rom?: { fameTeam(): Promise<{ species: number }[]>; paradeOf(mons: { species: number }[], name: string, skin: number, onStart: () => void): Promise<void> };
  goOut(why: string): void;
  isOut: boolean;
};
const spike = <T>(p: Page, f: (s: Spike) => T | Promise<T>) => p.evaluate(`(${f.toString()})(window.__spike)`) as Promise<T>;

test('two players: my lines, my bag and my winning team reach the other page', async ({ browser }) => {
  test.setTimeout(400_000);
  const [hc, gc] = [await browser.newContext(), await browser.newContext()];
  // The guest's MY VOICE picks (career.ts), as their MY LOOK would have saved them.
  await gc.addInitScript(() => localStorage.setItem('hbr:career', JSON.stringify({ matches: 0, wins: 0, intro: 5, win: 6, lose: 7 })));
  try {
    const [host, guest] = [await hc.newPage(), await gc.newPage()];
    await host.goto(`/?rom=${romHashParam()}#host`);
    await expect(host.locator('#room-code')).toHaveText(/Room [A-Z0-9]{6}/, { timeout: 90_000 });
    await setOption(host, 'room-fill', 'FILL OFF');
    await setOption(host, 'room-safari', 'SAFARI 180s');
    await guest.goto(`/?rom=${romHashParam()}${new URL(host.url()).hash}`);
    await expect(host.locator('#room-roster li', { hasText: 'CAM' })).toHaveCount(2, { timeout: 90_000 });
    await expect(host.locator('#room-start')).toBeEnabled();
    await host.locator('#room-start').click();
    await host.waitForFunction(() => !!(window as unknown as { __spike: Spike }).__spike.rom, undefined, { timeout: 90_000 });
    await guest.waitForFunction(() => !!(window as unknown as { __spike: Spike }).__spike.rom, undefined, { timeout: 90_000 });
    const guestId = await spike(guest, (s) => s.link.me);

    // MY VOICE: the guest's card in the host's room carries their three lines.
    expect(await spike(host, (s) => JSON.stringify(s.room?.members.find((m) => m.id !== (s as Spike).link.me)?.rec ?? null))).toContain('"intro":5,"win":6,"lose":7');

    // Their BAG and team: told to the room, and on the host's page for its START.
    await expect.poll(() => host.evaluate((id) => {
      const b = (window as unknown as { __spike: Spike }).__spike.link.bags.get(id);
      return b ? typeof b.money : 'none';
    }, guestId), { timeout: 60_000 }).toBe('number');
    // A team to win with: the guest catches something in the Safari (spikeb.spec.ts's own
    // walk to a marked spot, BALL on A).
    expect(await catchOne(guest), 'a POKeMON caught in the Safari').toBeGreaterThan(0);
    const theirs = await spike(guest, async (s) => (await s.rom!.fameTeam()).map((m) => m.species));
    expect(theirs.length).toBeGreaterThan(0);
    await expect.poll(() => host.evaluate((id) => ((window as unknown as { __spike: Spike }).__spike.link.teams.get(id) ?? []).map((m) => m.species).join(','), guestId), { timeout: 60_000 }).toBe(theirs.join(','));

    // The host goes out; the guest is the last one standing, and the host's ROM shows
    // the guest's own team in its Hall of Fame (rom.ts paradeOf), not its own.
    await host.evaluate(() => {
      const s = (window as unknown as { __spike: Spike & { __paraded?: unknown } }).__spike, r = s.rom!, f = r.paradeOf.bind(r);
      (window as unknown as { __paraded: unknown }).__paraded = null;
      r.paradeOf = (mons, name, skin, onStart) => { (window as unknown as { __paraded: unknown }).__paraded = { species: mons.map((m) => m.species), name }; return f(mons, name, skin, onStart); };
      s.goOut('');
    });
    await expect.poll(() => spike(host, (s) => s.link.room.results.winner), { timeout: 60_000 }).toBe(guestId);
    await expect.poll(() => host.evaluate(() => JSON.stringify((window as unknown as { __paraded: unknown }).__paraded)), { timeout: 60_000 }).toContain(`"species":[${theirs.join(',')}]`);
    // And the end waits for it: the results come up after the parade, for both.
    await expect(host.locator('#results-panel')).toBeVisible({ timeout: 120_000 });
    await expect(guest.locator('#results-panel')).toBeVisible({ timeout: 120_000 });
  } finally {
    await hc.close();
    await gc.close();
  }
});
