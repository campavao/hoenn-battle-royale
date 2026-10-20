import { afterEach, describe, expect, it, vi } from 'vitest';
import { guessedStickKeys, learnAxis, loadStickMap, onWindows, padReadout, pollPads, startStickLearn, stickKeys, stickLearnStep, type StickMap } from './pad';

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

describe('the pad is polled only while one is there, except on Windows (POK-247)', () => {
  afterEach(() => void vi.useRealTimers());

  /** The window's pad events, and what navigator.getGamepads() would say. */
  function padHost(present: number[] = [], always = false) {
    const win = new EventTarget();
    const pads = new Set(present);
    const event = (type: string, index: number) => Object.assign(new Event(type), { gamepad: { index } }) as unknown as GamepadEvent;
    return {
      on: { win, pads: () => [0, 1, 2, 3].map((i) => (pads.has(i) ? ({ index: i } as Gamepad) : null)), always },
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

  it('on Windows polls from load to unload, pad or no pad, on one timer a pad leaving never stops', () => {
    vi.useFakeTimers();
    const host = padHost([], true);
    const poll = vi.fn();
    const stop = pollPads(poll, () => {}, () => {}, host.on);
    vi.advanceTimersByTime(160);
    expect(poll).toHaveBeenCalledTimes(10);
    host.plug(0);
    host.unplug(0);
    poll.mockClear();
    vi.advanceTimersByTime(160);
    expect(poll, 'still the one timer').toHaveBeenCalledTimes(10);
    stop();
    poll.mockClear();
    vi.advanceTimersByTime(1000);
    expect(poll).not.toHaveBeenCalled();
  });

  it('knows Windows by userAgentData where the browser has it, and by the user-agent string where not', () => {
    const chromeWin = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
    const firefoxWin = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:143.0) Gecko/20100101 Firefox/143.0';
    const android = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36';
    const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
    expect(onWindows({ userAgent: chromeWin, userAgentData: { platform: 'Windows' } })).toBe(true);
    expect(onWindows({ userAgent: firefoxWin })).toBe(true);
    expect(onWindows({ userAgent: android, userAgentData: { platform: 'Android' } })).toBe(false);
    expect(onWindows({ userAgent: iphone })).toBe(false);
  });
});

describe('learning the stick (POK-350)', () => {
  const up = { axis: 1, sign: -1 as const };
  const right = { axis: 0, sign: 1 as const };
  const feed = (inputs: Parameters<typeof stickLearnStep>[1][]) => inputs.reduce(stickLearnStep, startStickLearn());

  it('waits for the stick at rest between UP and RIGHT, so a held UP is not the answer twice', () => {
    // The UP still held when RIGHT is asked for: the old wizard ended there with no stick.
    const held = feed([null, up, up, up]);
    expect(held.phase).toBe('right');
    expect(feed([null, up, up, null, right])).toMatchObject({ phase: 'done', result: { up, right } });
  });

  it('takes no push before it has seen the stick at rest', () => {
    expect(feed([up]).phase).toBe('up');
    expect(feed([up, null, up]).phase).toBe('right');
  });

  it('ignores RIGHT on the same axis as UP, and a button skips', () => {
    expect(feed([null, up, null, { axis: 1, sign: 1 }]).phase).toBe('right');
    expect(feed([null, up, 'skip'])).toMatchObject({ phase: 'done', result: null });
  });
});

describe('the pad readout (Cam, 2026-10-19: "never gotten a clear answer")', () => {
  const pad = (axes: number[], pressed: number[] = [], mapping = '') => ({
    id: '0000-0000-Wireless Gamepad',
    mapping,
    axes,
    buttons: Array.from({ length: 12 }, (_, i) => ({ pressed: pressed.includes(i) })),
  });
  const rest = [0, 0, 0, 0, 0, 0];

  it('names the pad, how many axes the browser gives it, and nudges an untaught non-standard pad', () => {
    expect(padReadout(pad(rest), rest, [], false)).toBe('Gamepad: 0000-0000-Wireless Gamepad (non-standard, 6 axes) -- REMAP PAD to teach it');
    expect(padReadout(pad(rest), rest, [], true)).toBe('Gamepad: 0000-0000-Wireless Gamepad (non-standard, 6 axes)');
    expect(padReadout(pad(rest, [], 'standard'), rest, [], false)).toBe('Gamepad: 0000-0000-Wireless Gamepad (standard, 6 axes)');
  });

  it('shows every axis away from rest with its value, even a part push, and every button down by number', () => {
    expect(padReadout(pad([0, 0, -0.98, 0.3, 0, 0], [8]), rest, ['up'], true)).toBe(
      'Gamepad: 0000-0000-Wireless Gamepad (non-standard, 6 axes) -- up [axis 2:-0.98 3:+0.30] [button 8]',
    );
    // a resting wobble is not a push
    expect(padReadout(pad([0.1, -0.1, 0, 0, 0, 0]), rest, [], true)).toBe('Gamepad: 0000-0000-Wireless Gamepad (non-standard, 6 axes)');
  });
});
