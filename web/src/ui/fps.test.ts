import { describe, expect, it, vi } from 'vitest';
import type { Emulator } from '../emu';
import { FrameMeter, type Metered } from './fps';

/** An emulator that runs a frame, and whose listeners' throws go where the real one's do. */
function fakeEmu() {
  const frames = new Set<() => void>();
  const errors = new Set<(err: unknown) => void>();
  const emu: Metered = {
    onFrame: (l) => {
      frames.add(l);
      return () => frames.delete(l);
    },
    onListenerError: (l) => {
      errors.add(l);
      return () => errors.delete(l);
    },
  };
  return {
    emu,
    frame: () => frames.forEach((l) => l()),
    threw: (err: unknown) => errors.forEach((l) => l(err)),
  };
}

describe('the dev fps line (POK-331 #29)', () => {
  it('reads frames a second since the last read', () => {
    const clock = { t: 0 };
    const gba = fakeEmu();
    const meter = new FrameMeter(gba.emu, () => clock.t, () => {});
    for (let i = 0; i < 60; i++) gba.frame();
    clock.t = 1000;
    expect(meter.read()).toBe('60 fps');
    for (let i = 0; i < 15; i++) gba.frame();
    clock.t = 1500;
    expect(meter.read()).toBe('30 fps');
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
