import { describe, expect, it, vi } from 'vitest';
import { chunkScreen } from './chunk-screen';
import type { DrawnScreen } from './stage';

describe('a screen out of a chunk (#111)', () => {
  it("keeps the real screen's look and touches, so FEEDBACK mid-match stays over the game", () => {
    const touched = vi.fn();
    const real: DrawnScreen = { paint: () => ({ widgets: [] }), look: () => 'overlay', touched };
    let loaded: { make: () => DrawnScreen } | undefined;
    const screen = chunkScreen(() => loaded, async () => undefined, (m) => m.make(), { back: vi.fn(), look: () => 'overlay' });
    expect(screen.look!(), 'waiting: the look it will have').toBe('overlay');
    loaded = { make: () => real };
    expect(screen.look!()).toBe('overlay');
    screen.touched!();
    expect(touched).toHaveBeenCalled();
  });

  it('goes back on B before the chunk lands, and is full with no look given', () => {
    const back = vi.fn();
    const load = vi.fn(async () => undefined);
    const screen = chunkScreen(() => undefined, load, () => ({ paint: () => ({ widgets: [] }) }), { back });
    screen.back!();
    expect(back).toHaveBeenCalled();
    expect(load).toHaveBeenCalled();
    expect(screen.look!()).toBe('full');
  });
});
