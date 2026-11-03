import { afterEach, describe, expect, it } from 'vitest';
import { hintFor, inputKeyboard, inputPad, legendRows, onHintsChange, padButtonName, padFamily, padIsLast } from './hints';

const XBOX = 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 02fd)';
const PS = 'Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 09cc)';
const SWITCH = 'Pro Controller (STANDARD GAMEPAD Vendor: 057e Product: 2009)';
// The page's default map (spike-b/main.ts PAD_DEFAULT).
const MAP: Record<number, string> = { 0: 'a', 1: 'b', 2: 'b', 3: 'a', 4: 'l', 5: 'r', 8: 'select', 9: 'start', 12: 'up', 13: 'down', 14: 'left', 15: 'right' };
const KEYBOARD: [string, string][] = [['ARROWS', 'move'], ['Q  L', 'PARTY']];

afterEach(() => inputKeyboard());

describe('the key hints', () => {
  it('know a pad by its id, Xbox before the PlayStation "Wireless Controller"', () => {
    expect(padFamily(XBOX)).toBe('xbox');
    expect(padFamily(PS)).toBe('playstation');
    expect(padFamily(SWITCH)).toBe('nintendo');
    expect(padFamily('Some Arcade Stick (Vendor: 1234)')).toBe('generic');
  });

  it("are the keyboard's until a pad is pressed, and Q and E are never a pad's", () => {
    expect(padIsLast()).toBe(false);
    expect(hintFor('l', 'Q')).toBe('Q');
    expect(legendRows(KEYBOARD)).toBe(KEYBOARD);
    inputPad(XBOX, MAP);
    expect(padIsLast()).toBe(true);
    expect(hintFor('l', 'Q')).toBe('LB');
    expect(hintFor('r', 'E')).toBe('RB');
    expect(legendRows(KEYBOARD).map(([k]) => k)).toEqual(['D-PAD', 'A', 'B', 'LB', 'RB', 'VIEW']);
    inputKeyboard();
    expect(hintFor('l', 'Q')).toBe('Q');
  });

  it('name the buttons the pad has, whatever its make', () => {
    expect(padButtonName(PS, MAP, 'l')).toBe('L1');
    expect(padButtonName(PS, MAP, 'a')).toBe('X');
    expect(padButtonName(PS, MAP, 'b')).toBe('O');
    // The bottom button of a Nintendo pad is its B; the page maps it to the GBA's A.
    expect(padButtonName(SWITCH, MAP, 'a')).toBe('B');
    expect(padButtonName(SWITCH, MAP, 'r')).toBe('R');
    // A remap puts R on the right trigger.
    expect(padButtonName(XBOX, { ...MAP, 5: 'a', 7: 'r' }, 'r')).toBe('RT');
    // An unknown pad is named in the GBA's words; a key the map leaves out too.
    expect(padButtonName('Arcade Stick', MAP, 'l')).toBe('L');
    expect(padButtonName(XBOX, { 0: 'a' }, 'select')).toBe('SELECT');
  });

  it('tell the windows when they change, and only then', () => {
    let n = 0;
    onHintsChange(() => n++);
    inputKeyboard();
    expect(n).toBe(0);
    inputPad(XBOX, MAP);
    inputPad(XBOX, MAP);
    expect(n).toBe(1);
    inputKeyboard();
    expect(n).toBe(2);
  });
});
