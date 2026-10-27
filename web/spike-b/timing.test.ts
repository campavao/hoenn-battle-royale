// Spike B's walk against the real ROM, frame for frame.
//
// fixtures/walk-trace.txt is a tools/br/drive.sh driver: it lands in Littleroot and
// holds keys while watching the camera's pixel offset (gTotalCameraPixelOffsetX/Y), the
// player avatar and the player's object event every frame. walk-trace.json is that
// output, one row a frame. This feeds sim.ts the same keys on the same frames and
// fails on the first frame whose movement, tile or facing differs.
//
// Covered: flat-ground run and walk (B), a turn in place, a tap the way you face, a turn
// mid-run, a wall bump and its cut-short, one ledge hop south. Not covered yet: surf,
// doors and warps, sand/ice/slopes, the bike, walking into another trainer, two keys
// held through a step's end, ledges taken east/west, and a seam between maps. The
// start tile is set per trace (the first watched frame is a step south already begun).
import { describe, expect, it } from 'vitest';
import { World, type WorldMap } from '../src/bots/world';
import worldJson from './data/world.json';
import { newMover, tick, stepFn, type Keys } from './sim';
import walkRows from './fixtures/walk-trace.json';
import walkDriver from './fixtures/walk-trace.txt?raw';
import ledgeRows from './fixtures/ledge-trace.json';
import ledgeDriver from './fixtures/ledge-trace.txt?raw';

const TRACES: Record<string, { rows: unknown; driver: string }> = {
  'walk-trace': { rows: walkRows, driver: walkDriver },
  'ledge-trace': { rows: ledgeRows, driver: ledgeDriver },
};

const MAP_OFFSET = 7;
type Row = { label: string } | { f: number; cx: number; cy: number; x: number; y: number; face: number };

/** The driver's keys, one entry a frame, from the first watched frame on. `hold` holds
 *  for N frames then lets go for one (harness.c); `wait` holds nothing. */
function keysOf(driver: string): Keys[] {
  const out: Keys[] = [];
  let watching = false;
  for (const raw of driver.split('\n')) {
    const [op, a, b] = raw.trim().split(/\s+/);
    if (op === 'watch') { watching = true; continue; }
    if (!watching) continue;
    if (op === 'wait') for (let i = 0; i < Number(a); i++) out.push({});
    if (op === 'hold') {
      const k: Keys = {};
      for (const name of a.split('+')) (k as Record<string, boolean>)[name.toLowerCase()] = true;
      for (let i = 0; i < Number(b); i++) out.push(k);
      out.push({});
    }
  }
  return out;
}

describe('spike B walking matches the ROM', () => {
  it.each([
    ['walk-trace', 'MAP_LITTLEROOT_TOWN'],
    ['ledge-trace', 'MAP_ROUTE101'],
  ])('every frame of %s: pixels moved, tile and facing', (name, map) => {
    const rows = (TRACES[name].rows as Row[]).filter(
      (r): r is Exclude<Row, { label: string }> => !('label' in r),
    );
    const keys = keysOf(TRACES[name].driver);
    const world = new World((worldJson as { maps: WorldMap[] }).maps);
    const step = stepFn(world);
    const first = rows[0];
    // The first watched frame is the first of a run south, so the ROM already shows its
    // destination: the trainer stood one tile north of it.
    const m = newMover({ map, x: first.x - MAP_OFFSET, y: first.y - 1 - MAP_OFFSET }, first.face);
    let prev: { x: number; y: number } | null = null;
    let prevCam: { x: number; y: number } | null = null;
    const mismatches: string[] = [];
    for (let i = 0; i < rows.length && i < keys.length; i++) {
      tick(m, keys[i], step);
      const r = rows[i];
      const pos = { x: m.spot.x * 16 + m.px, y: m.spot.y * 16 + m.py };
      if (prev && prevCam) {
        const dSim = [pos.x - prev.x, pos.y - prev.y];
        const dRom = [-(r.cx - prevCam.x), -(r.cy - prevCam.y)];
        if (dSim[0] !== dRom[0] || dSim[1] !== dRom[1]) mismatches.push(`frame ${r.f}: moved ${dSim} px, ROM ${dRom}`);
      }
      // The watched field is the object's currentCoords (offset 0x10): the step's
      // destination from the frame it starts.
      if (m.spot.x + MAP_OFFSET !== r.x || m.spot.y + MAP_OFFSET !== r.y)
        mismatches.push(`frame ${r.f}: tile ${m.spot.x + MAP_OFFSET},${m.spot.y + MAP_OFFSET}, ROM ${r.x},${r.y}`);
      if (m.facing !== r.face) mismatches.push(`frame ${r.f}: facing ${m.facing}, ROM ${r.face}`);
      prev = pos;
      prevCam = { x: r.cx, y: r.cy };
    }
    expect(mismatches.slice(0, 12)).toEqual([]);
    expect(keys.length).toBeGreaterThanOrEqual(rows.length);
  });
});
