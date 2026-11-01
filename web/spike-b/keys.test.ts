import { describe, expect, it } from 'vitest';
import { capsByKey } from '../src/ui/keys';
import { KEYMAP, MENU_KEY, legendMap } from './keys';

describe("the desktop's key legend", () => {
  it('shows only keys the map presses, each as the button it presses', () => {
    for (const [k, b] of Object.entries(legendMap())) {
      if (k === MENU_KEY) expect(b).toBe('start');
      else expect(KEYMAP[k]).toBe(b);
    }
  });

  it('puts the keys on their buttons as the caps read', () => {
    const caps = capsByKey(legendMap());
    expect(caps.get('up')).toEqual(['↑', 'W']);
    expect(caps.get('left')).toEqual(['←', 'A']);
    expect(caps.get('a')).toEqual(['Z']);
    expect(caps.get('b')).toEqual(['X']);
    expect(caps.get('select')).toEqual(['SHIFT']);
    expect(caps.get('start')).toEqual(['M']);
    expect(caps.has('l') || caps.has('r')).toBe(false);
  });
});
