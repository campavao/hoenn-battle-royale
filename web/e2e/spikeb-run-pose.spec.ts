// The run, frame by frame, as the page draws it (Cam, 11-14: "there is stuttering with the run
// animation for the brendan"). His recording showed the walk's upright stand for one frame in
// eight while he ran: the frame between two run steps fell back to FACE. Held down here, every
// frame the field draws mid-run must come off the run sheet (poses.ts).
import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { romExists, romHashParam, romPath } from './symbols';

test.skip(!romExists(), `no ROM at ${romPath()} -- set HBR_ROM or place pokeemerald.gba at the repo root, then run tools/br/dev-patch.sh`);

/* eslint-disable @typescript-eslint/no-explicit-any */
const spike = <T>(page: Page, f: (s: any, arg?: any) => T, arg?: unknown) =>
  page.evaluate(([src, arg]) => new Function('s', 'arg', `return (${src})(s, arg)`)((window as any).__spike, arg), [f.toString(), arg] as const) as Promise<T>;

const SCRATCH = process.env.HBR_E2E_SCRATCH || '';
const out = (name: string) => {
  const to = SCRATCH ? path.join(SCRATCH, name) : test.info().outputPath(name);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  return to;
};

test('running holds the run sheet between steps', async ({ page }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(`/?rom=${romHashParam()}#solo&nobots&safari=0&fog=900&seed=7`);
  await page.locator('#intro-go').click({ timeout: 120_000 });
  await page.waitForFunction(() => { const s = (window as any).__spike; return !!s?.rom && !!s.link?.room.actor(s.link.me) && !!s.art; }, undefined, { timeout: 180_000 });

  // Brendan, on open ground with eight clear steps south of him on one map.
  const start = await spike(page, (s) => {
    const room = s.link.room, a = room.actor(s.link.me);
    a.skin = 0;
    const step = room.stepFor(a);
    const map = a.m.spot.map, w = s.placed.get(map).m;
    for (let y = 0; y < w.h - 9; y++) {
      for (let x = 0; x < w.w; x++) {
        let at = { map, x, y }, ok = true;
        for (let i = 0; i < 8 && ok; i++) {
          const to = step(at, 1);
          ok = !!to && !to.hop && !to.warp && !to.water && to.to.map === map && to.to.y === at.y + 1;
          if (ok) at = to.to;
        }
        if (ok) {
          const spot = { map, x, y };
          a.m = { ...a.m, spot, prev: spot, facing: 1, moveDir: 1, action: null, px: 0, py: 0, run: true };
          a.calm = 0;
          return spot;
        }
      }
    }
    return null;
  });
  expect(start, 'eight clear steps south somewhere on the start map').not.toBeNull();
  await page.waitForTimeout(500);

  // Every frame drawn while Down is held: the pose, the step under way, and the picture of him.
  await page.evaluate(() => {
    const s = (window as any).__spike;
    const strip = document.createElement('canvas');
    strip.width = 32 * 48;
    strip.height = 48;
    const g = strip.getContext('2d')!;
    const seen: any[] = [];
    // Every rAF: when, and which sim frame it drew (the field's pacing, no recorder in the way).
    const rafs: { ts: number; f: number }[] = [];
    (window as any).__runStrip = { strip, seen, rafs };
    const look = (ts: number) => {
      rafs.push({ ts, f: s.frame });
      const me = s.link.mine();
      if (me && (!seen.length || seen[seen.length - 1].f !== s.frame)) {
        const act = me.m.action;
        seen.push({ f: s.frame, pose: s.frameOf(me), kind: act?.kind ?? null, t: act?.t ?? null, y: me.m.spot.y, py: me.m.py });
        const n = seen.length - 1;
        if (n < 48) {
          const c = s.canvas as HTMLCanvasElement;
          g.drawImage(c, Math.round(c.width / 2) - 16, Math.round(c.height / 2) - 32, 32, 48, n * 32, 0, 32, 48);
        }
      }
      if (seen.length < 200) requestAnimationFrame(look);
    };
    requestAnimationFrame(look);
  });
  await page.keyboard.down('ArrowDown');
  await page.waitForTimeout(900);
  await page.keyboard.up('ArrowDown');
  await page.waitForTimeout(400);
  const got = await page.evaluate(() => {
    const r = (window as any).__runStrip;
    return { rafs: r.rafs as { ts: number; f: number }[], seen: r.seen as { f: number; pose: number; kind: string | null; t: number | null; y: number; py: number }[], png: (r.strip as HTMLCanvasElement).toDataURL('image/png') };
  });
  fs.writeFileSync(out('run-strip.png'), Buffer.from(got.png.split(',')[1], 'base64'));
  fs.writeFileSync(out('run-frames.json'), JSON.stringify(got.seen));
  fs.writeFileSync(out('run-rafs.json'), JSON.stringify(got.rafs));

  // Mid-run: from the first run step's start to the last one's end. The stand after letting go
  // is the walk's FACE, as it was.
  const first = got.seen.findIndex((x) => x.kind === 'step');
  let last = got.seen.length - 1;
  while (last > 0 && got.seen[last].kind !== 'step') last -= 1;
  const mid = got.seen.slice(first, last + 1);
  expect(mid.length, 'frames drawn mid-run').toBeGreaterThan(24);
  const offSheet = mid.filter((x) => x.pose < 9);
  expect(offSheet, 'walk-sheet frames drawn mid-run').toEqual([]);
  expect(got.seen[got.seen.length - 1].pose, 'standing once let go').toBe(0);
  expect(errors).toEqual([]);
});
