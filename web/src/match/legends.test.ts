import { describe, expect, it } from 'vitest';
import { LEGEND_GFX, legendGfx } from './legends';

describe('legendGfx', () => {
  it("stands the match's own legendary as itself, and a trader holding one as a trader", () => {
    expect(legendGfx(0xb010, 407)).toBe(LEGEND_GFX.get(407));
    expect(legendGfx(0x8c21, 407), 'a house trader (Cam, 2026-10-23)').toBeUndefined();
    expect(legendGfx(0x8c92, 407), "a floor's trader").toBeUndefined();
    expect(legendGfx(0x0300, 407), "one out of a trainer's team").toBeUndefined();
  });
});
