import { afterEach, describe, expect, it, vi } from 'vitest';
import { guessedStickKeys, learnAxis, loadStickMap, pollPads, stickKeys, type StickMap } from './pad';

describe('a learned stick (POK-321)', () => {
  // Cam's pad: the stick's vertical is axis 0 and its horizontal axis 1, the reverse of
  // the standard layout, and pushing up reads negative.
  const rest = [0, 0, 0.2, -1];
  const learned: StickMap = { up: { axis: 0, sign: -1 }, right: { axis: 1, sign: 1 } };

  it('is learned from whichever axis moves, in whichever direction', () => {
    expect(learnAxis([-0.9, 0, 0.2, -1], rest)).toEqual({ axis: 0, sign: -1 });
    expect(learnAxis([0, 0.8, 0.2, -1], rest)).toEqual({ axis: 1, sign: 1 });
    expect(learnAxis([0.1, -0.2, 0.2, -1], rest), 'nothing past half throw').toBeNull();
    expect(learnAxis([0, 0, 0.2, -1, 0, 0, 0, 0, 0, 1], [0, 0, 0.2, -1, 0, 0, 0, 0, 0, 1.29]), 'the hat is not a stick').toBeNull();
  });

  it('reads the directions off the learned axes and nothing else', () => {
    expect(stickKeys([-0.9, 0, 0.2, -1], rest, learned)).toEqual(['up']);
    expect(stickKeys([0.9, 0, 0.2, -1], rest, learned)).toEqual(['down']);
    expect(stickKeys([0, 0.9, 0.2, -1], rest, learned)).toEqual(['right']);
    expect(stickKeys([-0.7, -0.7, 0.2, -1], rest, learned)).toEqual(['up', 'left']);
    expect(stickKeys([0, 0, 0.9, 0.9], rest, learned), 'a trigger or a second stick').toEqual([]);
  });

  it('the guess, without a lesson, is the standard layout', () => {
    expect(guessedStickKeys([-0.9, 0, 0.2, -1], rest).keys, 'and it is what Cam saw: up reads as left').toEqual(['left']);
    expect(guessedStickKeys([0, 0.9, 0.2, -1], rest)).toEqual({ keys: ['down'], moved: ['1+'] });
  });

  it('loads only a well-formed lesson', () => {
    const store = (v: string | null) => ({ getItem: () => v });
    expect(loadStickMap(store(JSON.stringify(learned)))).toEqual(learned);
    expect(loadStickMap(store('{"up":{"axis":0}}'))).toBeNull();
    expect(loadStickMap(store('nonsense'))).toBeNull();
    expect(loadStickMap(store(null))).toBeNull();
    expect(loadStickMap(null)).toBeNull();
  });
});

describe('the pad is polled only while one is there (POK-247)', () => {
  afterEach(() => void vi.useRealTimers());

  /** The window's pad events, and what navigator.getGamepads() would say. */
  function padHost(present: number[] = []) {
    const win = new EventTarget();
    const pads = new Set(present);
    const event = (type: string, index: number) => Object.assign(new Event(type), { gamepad: { index } }) as unknown as GamepadEvent;
    return {
      on: { win, pads: () => [0, 1, 2, 3].map((i) => (pads.has(i) ? ({ index: i } as Gamepad) : null)) },
      plug(index: number) {
        pads.add(index);
        win.dispatchEvent(event('gamepadconnected', index));
      },
      unplug(index: number) {
        pads.delete(index);
        win.dispatchEvent(event('gamepaddisconnected', index));
      },
    };
  }

  it('does not wake sixty times a second for a pad nobody has', () => {
    vi.useFakeTimers();
    const host = padHost();
    const poll = vi.fn();
    const heard: string[] = [];
    pollPads(poll, () => void heard.push('in'), () => void heard.push('out'), host.on);
    vi.advanceTimersByTime(1000);
    expect(poll).not.toHaveBeenCalled();

    host.plug(0);
    vi.advanceTimersByTime(160);
    expect(poll).toHaveBeenCalledTimes(10);

    // A second pad does not start a second timer; the first going leaves the second polled.
    host.plug(1);
    host.unplug(0);
    poll.mockClear();
    vi.advanceTimersByTime(160);
    expect(poll).toHaveBeenCalledTimes(10);

    // The last one out gets one more poll, which lets go of whatever it held, and then quiet.
    poll.mockClear();
    host.unplug(1);
    vi.advanceTimersByTime(1000);
    expect(poll).toHaveBeenCalledTimes(1);
    expect(heard).toEqual(['in', 'in', 'out', 'out']);
  });

  it('polls a pad the page can already see, and stops for good when unbound', () => {
    vi.useFakeTimers();
    const host = padHost([2]);
    const poll = vi.fn();
    const stop = pollPads(poll, () => {}, () => {}, host.on);
    vi.advanceTimersByTime(32);
    expect(poll).toHaveBeenCalledTimes(2);
    stop();
    host.plug(0);
    vi.advanceTimersByTime(1000);
    expect(poll).toHaveBeenCalledTimes(2);
  });
});
