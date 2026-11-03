// A watched bots' fight stays on screen (Cam's 11-02 play-test: "that game just kind of short
// circuited"). Two real duels in a row on one proxy instance, as a match has them, then each one's
// stream through a hidden ROM's replay: it has to agree with its fighter on every turn the two
// compare, or the ROM's turn check ends it and the watcher is back on the field. The second duel
// is the one the stale seed broke, the first the one the badges broke.
import { expect, test } from '@playwright/test';
import { romExists, romHashParam, romPath } from './symbols';

test.skip(!romExists(), `no ROM at ${romPath()} -- set HBR_ROM or place pokeemerald.gba at the repo root, then run tools/br/dev-patch.sh`);

type Run = {
  seeds: string[];
  replays: { checks: number; drifts: number; lastTurn: number; fighterTurns: number }[];
};

test('two duels in a row: each replay agrees with its fighter to the last turn', async ({ page }) => {
  test.setTimeout(300_000);
  await page.goto(`/?rom=${romHashParam()}#solo&nobots&safari=0&fog=900&seed=7`);
  await page.locator('#intro-go').click({ timeout: 90_000 });
  await page.waitForFunction(() => { const s = (window as any).__spike; return !!s?.rom && !!s.link?.room.actor(s.link.me); }, undefined, { timeout: 120_000 });
  await page.waitForTimeout(2000);
  const run: Run = await page.evaluate(async () => {
    const s = (window as any).__spike;
    const sym = (n: string) => s.art.sym(n) as number;
    const { makeJudge } = await import('/spike-b/judge.ts' as string);
    const rom = new Uint8Array(await (await fetch('/patch/pokeemerald.gba')).arrayBuffer());
    let msgs: any[] = [];
    const judge = makeJudge({ rom, sym }, (m: any) => msgs.push(m));
    const mon = (species: number, moves: number[], personality: number) => ({ species, level: 50, hp: 150, maxHp: 150, status: 0, moves: moves.map((id) => ({ id, pp: 30 })), heldItem: 0, otId: 1234, personality, exp: 125000, nickname: 'A', ot: 'B' });
    const a = [mon(4, [10, 45, 52, 99], 11), mon(7, [33, 39, 55, 145], 12)];
    const b = [mon(1, [33, 45, 22, 73], 21), mon(25, [84, 98, 45, 39], 22)];
    const fights: any[][] = [];
    for (let n = 0; n < 2; n++) {
      msgs = [];
      await judge({ seat: 2, party: a }, { seat: 8, party: b });
      fights.push(msgs);
    }
    const emu = s.rom.emu, jank = sym('gBrJank'), res = sym('gBattleResults');
    const replays: Run['replays'] = [];
    for (const fight of fights) {
      const q = [...fight];
      // Read as it runs: the page's repark at the end puts the ROM's RAM back.
      let lastTurn = 0, checks = 0, drifts = 0;
      const was = [emu.read(jank + 10, 16), emu.read(jank + 12, 16)];
      const off = emu.onFrame(() => {
        lastTurn = Math.max(lastTurn, emu.read(res + 0x13, 8));
        checks = emu.read(jank + 10, 16) - was[0];
        drifts = emu.read(jank + 12, 16) - was[1];
      });
      const t0 = performance.now();
      await s.rom.mirror({ peek: () => q[0] ?? null, shift: () => { q.shift(); }, over: () => !q.length, stopped: () => performance.now() - t0 > 90_000, turned: false, skins: [0, 0] }, () => {});
      off();
      // The fighter's own count: a check run, 0xC0 3 <turn> <sum>, in its TURNs.
      const fighterTurns = Math.max(0, ...fight.filter((m) => m.t === 'turn' && m.data[0] === 0xc0).map((m) => m.data[2]));
      replays.push({ checks, drifts, lastTurn, fighterTurns });
    }
    return { seeds: fights.map((f) => f[0].data.slice(0, 4).join()), replays };
  });
  console.log(JSON.stringify(run));
  expect(run.seeds[1], 'each fight publishes its own seed').not.toBe(run.seeds[0]);
  for (const r of run.replays) {
    expect(r.fighterTurns, 'a fight with turns to compare').toBeGreaterThan(0);
    expect(r.checks, 'turns compared').toBeGreaterThan(0);
    expect(r.drifts, 'turns the replay disagreed with its fighter').toBe(0);
    expect(r.lastTurn, 'played to where the fight got').toBeGreaterThanOrEqual(r.fighterTurns);
  }
});
