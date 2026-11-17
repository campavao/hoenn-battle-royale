// A first visit is dealt one of Emerald's trainers' names, not CAM (Cam, 11-16), and keeps it.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NAMES } from '../src/bots/roster';

function store(init: Record<string, string> = {}) {
  const m = new Map(Object.entries(init));
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); }, m };
}

describe('who I am on a first visit', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('is an Emerald trainer, dealt once and kept', async () => {
    const s = store();
    vi.stubGlobal('localStorage', s);
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const { me } = await import('./lobby');
    const first = me();
    expect(NAMES).toContain(first.name);
    expect(first.name).not.toBe('CAM');
    expect(JSON.parse(s.m.get('hbr:career')!).name).toBe(first.name);
    vi.spyOn(Math, 'random').mockReturnValue(0.01);
    expect(me().name).toBe(first.name);
  });

  it('keeps a name the player chose', async () => {
    vi.stubGlobal('localStorage', store({ 'hbr:career': JSON.stringify({ name: 'ZIGGY' }) }));
    const { me } = await import('./lobby');
    expect(me().name).toBe('ZIGGY');
  });
});
