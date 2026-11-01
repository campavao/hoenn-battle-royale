// What the new game's specs share: a walk over the room's own step function, and a key
// held on the page.
import type { Page } from '@playwright/test';

/** The walk to the nearest cell `goal` takes, over the room's own step function (bots
 *  walk the same one), as directions: 1 south, 2 north, 3 west, 4 east. */
export async function route(page: Page, goal: string): Promise<number[] | null> {
  return page.evaluate((goal) => {
    const s = (window as unknown as { __spike: { link: { me: number; room: any } } }).__spike;
    const room = s.link.room, a = room.actor(s.link.me);
    const ok = new Function('p', 'room', `return (${goal})(p, room)`) as (p: unknown, room: unknown) => boolean;
    const step = room.stepFor(a);
    const k = (p: { map: string; x: number; y: number }) => `${p.map}:${p.x}:${p.y}`;
    const from = new Map<string, [string, number] | null>([[k(a.m.spot), null]]);
    const q = [a.m.spot];
    for (let i = 0; i < q.length && i < 6000; i++) {
      const p = q[i];
      if (i > 0 && ok(p, room)) {
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
  }, goal);
}

export const KEY = { 1: 'ArrowDown', 2: 'ArrowUp', 3: 'ArrowLeft', 4: 'ArrowRight', a: 'z' } as Record<number | string, string>;
export const key = (page: Page, k: string, down: boolean) => page.evaluate(([k, down]) => dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { key: k as string, bubbles: true })), [k, down] as const);

