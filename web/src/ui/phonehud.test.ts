import { describe, expect, it } from 'vitest';
import {
  AVATAR_ACRO_BIKE,
  AVATAR_MACH_BIKE,
  AVATAR_SURFING,
  FOG_W,
  ITEM_ACRO_BIKE,
  ITEM_MACH_BIKE,
  LEVELS_ROD,
  RING_PLACE,
  RING_R,
  clockText,
  contextFor,
  fogHeight,
  fogLines,
  fogPhase,
  readHudView,
  signFor,
  type HudView,
} from './phonehud';
import { measure, TEXT_RED } from './emerald';
import { HUD } from '../net/hud';
import { encodeGen3 } from '../text/gen3';

const WATER = 2;
const GRASS = 0;
const SUPER_ROD = 264;

describe("the dock's context button: what SELECT does where we stand", () => {
  it('riding, it gets off the bike we are on', () => {
    expect(contextFor(AVATAR_MACH_BIKE, GRASS, true, SUPER_ROD)).toEqual({ label: 'WALK', item: ITEM_MACH_BIKE, enabled: true });
    expect(contextFor(AVATAR_ACRO_BIKE, WATER, true, SUPER_ROD)).toEqual({ label: 'WALK', item: ITEM_ACRO_BIKE, enabled: true });
  });

  it('facing water with a rod, it fishes with the rod in the bag, surfing too', () => {
    expect(contextFor(0, WATER, true, SUPER_ROD)).toEqual({ label: 'FISH', item: SUPER_ROD, enabled: true });
    expect(contextFor(AVATAR_SURFING, WATER, true, SUPER_ROD).label).toBe('FISH');
  });

  it('on foot outdoors it rides; indoors, surfing away from water or with no rod facing water, it is a grey BIKE', () => {
    expect(contextFor(0, GRASS, true, SUPER_ROD)).toEqual({ label: 'BIKE', item: ITEM_MACH_BIKE, enabled: true });
    expect(contextFor(0, GRASS, false, SUPER_ROD).enabled).toBe(false);
    expect(contextFor(AVATAR_SURFING, GRASS, true, SUPER_ROD).enabled).toBe(false);
    expect(contextFor(0, WATER, true, 0)).toEqual({ label: 'BIKE', item: ITEM_MACH_BIKE, enabled: true });
  });

  it('BIKE is the bike in the bag: the ACRO BIKE when that is the one, grey with none', () => {
    expect(contextFor(0, GRASS, true, 0, ITEM_ACRO_BIKE)).toEqual({ label: 'BIKE', item: ITEM_ACRO_BIKE, enabled: true });
    expect(contextFor(0, GRASS, true, 0, 0).enabled).toBe(false);
  });
});

describe('the sign and the fog window', () => {
  it("a section's sign is its region-map name, in map_name_popup.c's theme", () => {
    expect(signFor('MAPSEC_ROUTE_102')).toEqual({ name: 'ROUTE 102', theme: 'wood' });
    expect(signFor('MAPSEC_RUSTBORO_CITY')).toEqual({ name: 'RUSTBORO CITY', theme: 'marble' });
    expect(signFor('MAPSEC_ROUTE_105').theme).toBe('underwater');
    expect(signFor('MAPSEC_NOWHERE')).toEqual({ name: '', theme: 'wood' });
  });

  it('the clock is m:ss, and FOG! blinks in its place the way the corner did', () => {
    expect(clockText(125)).toBe('2:05');
    expect(clockText(0)).toBe('0:00');
    expect([fogPhase(0), fogPhase(8), fogPhase(7)]).toEqual([0, 1, 2]);
  });

  const view = (over: Partial<HudView> = {}): HudView => ({
    onField: true,
    place: 'ROUTE 102',
    theme: 'wood',
    clock: 95,
    left: 7,
    eyes: 0,
    flash: 0,
    ring: 'OLDALE TOWN',
    fogEverywhere: false,
    ctx: { label: 'BIKE', item: ITEM_MACH_BIKE, enabled: true },
    party: 1,
    ...over,
  });
  const text = (v: HudView) => fogLines(v).map((l) => [l.left?.text ?? '', l.right?.text ?? '']);

  it('two lines in the ring: FOG and the clock, how many are left -- not where it closes to', () => {
    expect(text(view())).toEqual([
      ['FOG', '1:35'],
      ['7 LEFT', ''],
    ]);
    expect(fogHeight(2)).toBe(48);
    expect(fogHeight(3)).toBe(64);
  });

  it('two in the Safari, red under thirty seconds, FOG! in its flash, the eyes when anybody watches', () => {
    expect(text(view({ ring: null }))).toEqual([
      ['SAFARI', '1:35'],
      ['7 LEFT', ''],
    ]);
    expect(fogLines(view({ clock: 30 }))[0].right?.color).toBe(TEXT_RED);
    expect(text(view({ flash: 2 }))[0]).toEqual(['FOG', 'FOG!']);
    expect(text(view({ flash: 1 }))[0]).toEqual(['FOG', '']);
    expect(text(view({ eyes: 3 }))[1]).toEqual(['7 LEFT', '3 WATCH']);
    expect(text(view({ ring: 'FOG EVERYWHERE', fogEverywhere: true }))).toEqual([
      ['FOG', '1:35'],
      ['FOG EVERYWHERE', ''],
      ['7 LEFT', ''],
    ]);
  });

  it('every line fits the window', () => {
    for (const over of [{}, { ring: 'FOG EVERYWHERE', fogEverywhere: true }, { eyes: 12, left: 32 }]) {
      for (const line of fogLines(view(over))) {
        const w = measure(line.left?.text ?? '') + (line.right ? measure(line.right.text) + 4 : 0);
        expect(w, line.left?.text).toBeLessThanOrEqual(FOG_W - 16);
      }
    }
  });
});

describe('the HUD read off the ROM', () => {
  const SYM: Record<string, number> = {
    gBrHud: 0x1000,
    gBrOwnPos: 0x2000,
    gPlayerAvatar: 0x3000,
    gMain: 0x4000,
    CB2_Overworld: 0x08001234,
    gBrRing: 0x5000,
    gBrLevels: 0x6000,
    gPlayerPartyCount: 0x7000,
  };
  const ram = new Map<number, number>();
  const put = (addr: number, v: number, bytes: number) => {
    for (let i = 0; i < bytes; i++) ram.set(addr + i, (v >> (8 * i)) & 0xff);
  };
  const emu = {
    read(addr: number, bits: 8 | 16 | 32) {
      let v = 0;
      for (let i = 0; i < bits / 8; i++) v |= (ram.get(addr + i) ?? 0) << (8 * i);
      return bits === 32 ? v >>> 0 : v;
    },
  };
  const world = {
    map: (g: number, n: number) => (g === 0 && n === 17 ? { id: 'MAP_ROUTE102', section: 'MAPSEC_ROUTE_102', outdoor: true } : undefined),
    // a pond at (10, 4)
    cell: (_id: string, x: number, y: number) => (x === 10 && y === 4 ? WATER : GRASS),
  };

  it('reads the sign, the clock, the count, the ring and the cell faced', () => {
    ram.clear();
    put(SYM.gBrHud + HUD.OFF_LEFT, 7, 1);
    put(SYM.gBrHud + HUD.OFF_CLOCK_SECS, 95, 2);
    put(SYM.gBrOwnPos + 1, 17, 1);
    put(SYM.gBrOwnPos + 2, 10 + 7, 2);
    put(SYM.gBrOwnPos + 4, 5 + 7, 2);
    put(SYM.gBrOwnPos + 6, 2, 1); // north, at the pond
    put(SYM.gMain + 4, SYM.CB2_Overworld + 1, 4); // a thumb function: bit 0 set
    put(SYM.gBrRing, 1, 1);
    put(SYM.gBrRing + RING_R, 2, 1);
    encodeGen3('OLDALE TOWN').forEach((b, i) => put(SYM.gBrRing + RING_PLACE + i, b, 1));
    put(SYM.gBrRing + RING_PLACE + 11, 0xff, 1);
    put(SYM.gBrLevels + LEVELS_ROD, SUPER_ROD, 2);
    put(SYM.gPlayerPartyCount, 2, 1);
    const v = readHudView(emu, (n) => SYM[n], world)!;
    expect(v).toMatchObject({ onField: true, party: 2, place: 'ROUTE 102', theme: 'wood', clock: 95, left: 7, ring: 'OLDALE TOWN', fogEverywhere: false });
    expect(v.ctx).toEqual({ label: 'FISH', item: SUPER_ROD, enabled: true });
    // turned south: grass, so the bike
    put(SYM.gBrOwnPos + 6, 1, 1);
    expect(readHudView(emu, (n) => SYM[n], world)!.ctx.label).toBe('BIKE');
    // the ring at -1 is fog everywhere; a battle is not the field
    put(SYM.gBrRing + RING_R, 0xff, 1);
    put(SYM.gMain + 4, 0x08009999, 4);
    expect(readHudView(emu, (n) => SYM[n], world)).toMatchObject({ ring: 'FOG EVERYWHERE', fogEverywhere: true, onField: false });
  });

  it('nothing without the symbols, and no world yet is no sign and a grey BIKE', () => {
    expect(readHudView(emu, () => undefined, world)).toBeNull();
    const v = readHudView(emu, (n) => SYM[n], null)!;
    expect(v.place).toBe('');
    expect(v.ctx.enabled).toBe(false);
  });
});
