// The news line in pixels, not characters (#64's review): the ticker is 27 cells of the
// dialogue font, 216 px, and a line is printed from its left edge with no wrap. LINE_MAX
// keeps every line inside the ROM's 40-byte buffer, which is wider than the window, so
// this measures the worst case of every line the page writes with FONT_NORMAL's own
// widths from src/fonts.c.
import { describe, expect, it } from 'vitest';
import { encodeGen3 } from '../text/gen3';
import { LINES } from '../bots/lines';
import { BOSSES } from './bosses';
import regionMap from '../data/regionmap.json';
import { chest, event, felled, opening, outs, said, won } from './ticker';
import fonts from '../../../src/fonts.c?raw';

/** The ticker window: sTickerTemplate in src/br/br_hud.c, 27 cells wide. */
const TICKER_PX = 27 * 8;

const WIDTHS = fonts
  .split('gFontNormalLatinGlyphWidths[] = {')[1]
  .split('};')[0]
  .match(/\d+/g)!
  .map(Number);

function px(text: string): number {
  let sum = 0;
  for (const b of encodeGen3(text)) if (b !== 0xff) sum += WIDTHS[b];
  return sum;
}

/** Seven of the widest capital, Emerald's longest name. */
const WIDE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
  .split('')
  .reduce((a, b) => (px(b) > px(a) ? b : a))
  .repeat(7);

// A name with a control code in it ({AQUA} HIDEOUT) is not plain text: a story there
// names itself ('AQUA HIDEOUT', story.ts), which the plain names here already outrun.
const sections = Object.values((regionMap as { sections: Record<string, { name: string }> }).sections)
  .map((s) => s.name)
  .filter((n) => !n.includes('{'));

describe('every news line fits the ticker', () => {
  it('reads 256 glyph widths', () => {
    expect(WIDTHS.length).toBeGreaterThanOrEqual(256);
  });

  const cases: [string, string | undefined][] = [
    ['outs, two names', outs(0, [WIDE, WIDE], 32)?.text],
    ['outs, beaten by', outs(0, [WIDE], 32, WIDE)?.text],
    ['outs, more', outs(0, [WIDE, WIDE, WIDE], 32)?.text],
    ['opening', opening(0, 999)?.text],
    ['chest', chest(0, WIDE)?.text],
    ['won', won(0, WIDE)?.text],
    ...BOSSES.map((b): [string, string | undefined] => [`felled ${b.name}`, felled(0, WIDE, b.name)?.text]),
    ...sections.flatMap((s): [string, string | undefined][] => [
      [`event ${s}`, event(0, s)?.text],
      [`rare ${s}`, event(0, s, false)?.text],
    ]),
    ...LINES.map((l): [string, string | undefined] => [`said ${l}`, said(0, WIDE, l)?.text]),
  ];

  it.each(cases)('%s', (_name, text) => {
    expect(text).toBeDefined();
    expect(px(text!)).toBeLessThanOrEqual(TICKER_PX);
  });
});
