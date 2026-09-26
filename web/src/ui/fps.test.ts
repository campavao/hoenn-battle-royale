import { describe, expect, it, vi } from 'vitest';
import type { AudioTick } from '../emu/audio-meter';
import type { Emulator } from '../emu';
import { FrameMeter, Histogram, PerfProbe, perfLines, type Metered } from './fps';

/** An emulator that runs a frame, and whose listeners' throws go where the real one's do. */
function fakeEmu() {
  const frames = new Set<() => void>();
  const errors = new Set<(err: unknown) => void>();
  const work = new Set<(ms: number) => void>();
  const audio = new Set<(tick: AudioTick) => void>();
  const emu = {
    pauses: 0,
    onFrame: (l: () => void) => {
      frames.add(l);
      return () => frames.delete(l);
    },
    onListenerError: (l: (err: unknown) => void) => {
      errors.add(l);
      return () => errors.delete(l);
    },
    onFrameWork: (l: (ms: number) => void) => {
      work.add(l);
      return () => work.delete(l);
    },
    onAudio: (l: (tick: AudioTick) => void) => {
      audio.add(l);
      return () => audio.delete(l);
    },
  };
  return {
    emu,
    frame: (workMs = 0) => {
      frames.forEach((l) => l());
      work.forEach((l) => l(workMs));
    },
    threw: (err: unknown) => errors.forEach((l) => l(err)),
    audio: (tick: AudioTick) => audio.forEach((l) => l(tick)),
  };
}

describe('the dev fps line (POK-331 #29)', () => {
  it('reads frames a second since the last read', () => {
    const clock = { t: 0 };
    const gba = fakeEmu();
    const meter = new FrameMeter(gba.emu, () => clock.t, () => {});
    for (let i = 0; i < 60; i++) {
      gba.frame();
      clock.t += 1000 / 60;
    }
    expect(meter.read()).toBe('60 fps · p95 17 · max 17 ms');
    for (let i = 0; i < 15; i++) {
      gba.frame();
      clock.t += 1000 / 30;
    }
    expect(meter.read()).toBe('30 fps · p95 33 · max 33 ms');
  });

  it('counts the frame listeners that threw, and keeps counting them', () => {
    const clock = { t: 0 };
    const gba = fakeEmu();
    const logged = vi.fn();
    const meter = new FrameMeter(gba.emu, () => clock.t, logged);
    gba.threw(new Error('the pump'));
    clock.t = 1000;
    expect(meter.read()).toBe('0 fps · 1 listener threw');
    gba.threw(new Error('the painter'));
    clock.t = 2000;
    expect(meter.read()).toBe('0 fps · 2 listeners threw');
    // ...and the console still has each one, which hearing them took it off
    expect(logged.mock.calls.map(([err]) => (err as Error).message)).toEqual(['the pump', 'the painter']);
  });

  it('meters the real emulator', () => {
    // What wireFps hands it: the type is the check.
    const fits: (emu: Emulator) => Metered = (emu) => emu;
    expect(fits).toBeTypeOf('function');
  });
});

describe('frame times (POK-247)', () => {
  it('a histogram answers to its bin, never past the largest it saw', () => {
    const h = new Histogram(0.5, 200);
    expect(h.quantile(0.95)).toBe(0);
    for (let i = 0; i < 99; i++) h.add(16.7);
    h.add(250); // past the last bin: counted, and the max is exact
    expect(h.quantile(0.5)).toBe(17);
    expect(h.quantile(0.99)).toBe(17);
    expect(h.quantile(1)).toBe(250);
    expect(h.max).toBe(250);
    h.clear();
    h.add(3.2);
    expect(h.quantile(0.5)).toBe(3.2);
  });

  it('one slow frame shows in the max and the p99, and not the p50', () => {
    const clock = { t: 0 };
    const gba = fakeEmu();
    const meter = new FrameMeter(gba.emu, () => clock.t, () => {});
    for (let i = 0; i < 60; i++) {
      clock.t += i === 30 ? 50 : 16;
      gba.frame();
    }
    const s = meter.stats();
    expect(s.frames).toBe(60);
    expect(s.p50).toBe(16.5);
    expect(s.p99).toBe(50);
    expect(s.max).toBe(50);
    expect(meter.read()).toBe('0 fps'); // a new window, with nothing in it yet
  });

  it('the gap across a pause is not a frame', () => {
    const clock = { t: 0 };
    const gba = fakeEmu();
    const meter = new FrameMeter(gba.emu, () => clock.t, () => {});
    gba.frame();
    clock.t = 16;
    gba.frame();
    gba.emu.pauses++; // the lobby holds the ROM still
    clock.t = 20_000;
    gba.frame();
    clock.t = 20_016;
    gba.frame();
    expect(meter.stats().max).toBe(16);
  });

  it("times the page's own share of each frame", () => {
    const gba = fakeEmu();
    const meter = new FrameMeter(gba.emu, () => 0, () => {});
    for (let i = 0; i < 19; i++) gba.frame(1);
    gba.frame(9);
    const { work } = meter.stats();
    expect(work.mean).toBeCloseTo(1.4, 5);
    expect(work.p95).toBeCloseTo(1.1, 5); // the top of 1.0's bin: a p95 is never understated
    expect(work.max).toBe(9);
  });
});

describe('the #perf readout (POK-247)', () => {
  it('reads frames, audio, the heap and the proxy together, a window at a time', () => {
    const clock = { t: 0 };
    const gba = fakeEmu();
    const proxy = { booted: true, frames: 480, fought: 3, timedOut: 0, fellBack: 1 };
    const now = new PerfProbe(gba.emu, () => proxy, { now: () => clock.t, log: () => {}, heap: () => 93 * 1024 * 1024 });
    const all = new PerfProbe(gba.emu, () => proxy, { now: () => clock.t, log: () => {}, heap: () => 93 * 1024 * 1024 });
    for (let i = 0; i < 60; i++) {
      clock.t += 16;
      gba.frame(1.2);
    }
    gba.audio({ at: 0, bufferMs: 21.3, late: true, starved: false, flat: false, state: 'running' });
    clock.t = 1000;
    const lines = perfLines(now.sample(), all.sample(false));
    expect(lines).toEqual([
      '60 fps · p95 16 · max 16 ms · work 1.2 ms · audio 1 late 0 starved',
      'all 60 frames · p95 16 p99 16 max 16 ms · work p95 1.2 ms · audio 1 late 0 starved · heap 93 MB · proxy 3 fought 1 fell back 480 frames',
    ]);
    // The second's window starts over; the whole page's does not.
    expect(now.sample().frames.frames).toBe(0);
    expect(all.sample(false).frames.frames).toBe(60);
  });

  it('says so when the page has no audio running, no heap to read and no proxy', () => {
    const gba = fakeEmu();
    const probe = new PerfProbe(gba.emu, () => null, { now: () => 0, log: () => {}, heap: () => null });
    const [, second] = perfLines(probe.sample(false), probe.sample(false));
    expect(second).toBe('all 0 frames · p95 0 p99 0 max 0 ms · work p95 0.0 ms · audio off');
  });
});
