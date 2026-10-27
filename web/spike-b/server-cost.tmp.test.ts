import { it } from 'vitest';
import { World, type WorldMap } from '../src/bots/world';
import worldJson from './data/world.json';
import { newMover, tick, stepFn, type Keys } from './sim';
it('room sim cost in node', () => {
  const maps = (worldJson as { maps: WorldMap[] }).maps;
  const world = new World(maps);
  const step = stepFn(world);
  const ms = [];
  let r = 1;
  const rnd = () => { r ^= r << 13; r ^= r >>> 17; r ^= r << 5; return (r >>> 0) / 4294967296; };
  const movers = [];
  while (movers.length < 100) {
    const m = maps[Math.floor(rnd() * maps.length)];
    if (!m.outdoor) continue;
    movers.push(newMover({ map: m.id, x: Math.floor(rnd() * m.w), y: Math.floor(rnd() * m.h) }));
  }
  const keys: Keys[] = movers.map(() => ({}));
  const N = 60 * 60 * 5; // five minutes of ticks
  let steps = 0;
  const t0 = performance.now();
  for (let t = 0; t < N; t++) {
    for (let i = 0; i < movers.length; i++) {
      if (t % 30 === i % 30) { const d = Math.floor(rnd() * 5); keys[i] = { up: d === 1, down: d === 2, left: d === 3, right: d === 4 }; }
      const before = movers[i].strides;
      tick(movers[i], keys[i], step);
      if (movers[i].strides !== before) steps++;
    }
  }
  const el = performance.now() - t0;
  console.log(`100 trainers, 5 min of 60 Hz: ${el.toFixed(0)} ms total, ${(el / N * 1000).toFixed(1)} us/tick, ${(steps / 300).toFixed(0)} step events/s`);
});
