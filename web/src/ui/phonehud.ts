// The phone's HUD (Cam's sketch, 2026-10-14, mockup v2 approved in broad strokes): the
// route sign top left, the fog window top right, and under the D-pad a dock of four
// Emerald windows -- PARTY and MAP, START and the context button -- with the room menu
// between them. All of it is drawn in Emerald's own font, frames, sign and item icons
// (tools/br/export-ui.py), at the field's scale, so it reads as the game's.
//
// Nothing here is new game logic. The buttons press what a thumb would (touch.ts):
// PARTY and MAP open START and walk its cursor, START is START, and the context button
// registers a key item and presses SELECT -- UseRegisteredKeyItemOnField decides
// whether it works. What the windows say is read off the ROM every frame: the map's
// section (its sign and name), gBrHud's clock, count and eyes, gBrRing's place, the
// avatar's flags and the cell it faces. The ROM's own corner box says the same three
// things, so while this is up the page sets gBrHud.noCorner and the corner comes off.
import uiData from '../data/ui.json';
import regionData from '../data/regionmap.json';
import type { WorldMap } from '../bots/world';
import { decodeGen3 } from '../text/gen3';
import { HUD } from '../net/hud';
import { MAP_OFFSET } from '../net/cells';
import { MAIN_CALLBACK2 } from '../field';
import { DIR_OF, OWN_DIR, OWN_GROUP, OWN_NUM, OWN_X, OWN_Y } from '../touch';
import {
  EmeraldCanvas,
  TEXT_BLUE,
  TEXT_DARK,
  TEXT_GRAY,
  TEXT_RED,
  measure,
  fitText,
  type TextColor,
} from './emerald';

// ---- what the ROM says ---------------------------------------------------------------

/** `struct PlayerAvatar.flags` (include/global.fieldmap.h): PLAYER_AVATAR_FLAG_*. */
export const AVATAR_FLAGS = 0;
export const AVATAR_MACH_BIKE = 0x02;
export const AVATAR_ACRO_BIKE = 0x04;
export const AVATAR_SURFING = 0x08;
/** The cell a trainer facing DIR_* looks at, one step on. */
export const FACING: Record<number, [number, number]> = {
  [DIR_OF.south]: [0, 1],
  [DIR_OF.north]: [0, -1],
  [DIR_OF.west]: [-1, 0],
  [DIR_OF.east]: [1, 0],
};
/** `struct BrRing` (include/br/br_ring.h). */
export const RING_ACTIVE = 0;
export const RING_R = 4;
export const RING_PLACE = 14;
export const RING_PLACE_MAX = 16;
/** `struct BrLevels.rod` (include/br/br_levels.h): the rod in the bag right now. */
export const LEVELS_ROD = 4;
/** `gBrHud`'s fields the ROM keeps (include/br/br_hud.h). */
export const HUD_FOG_FRAMES = 5;
/** include/constants/items.h. */
export const ITEM_MACH_BIKE = 259;
export const ITEM_ACRO_BIKE = 272;
export const ITEM_POKE_BALL = 4;
export const ITEM_TOWN_MAP = 361;
/** `struct BagPocket` (include/item.h) and `struct ItemSlot` (include/global.h): the
 *  slots' pointer then the capacity; an item's id then its (encrypted) count. */
export const POCKET_SIZE = 8;
export const POCKET_CAPACITY = 4;
export const SLOT_SIZE = 4;
/** include/constants/item.h: gBagPockets' rows. */
export const ITEMS_POCKET = 0;
export const KEYITEMS_POCKET = 4;

/** Which of `items` the bag's `pocket` holds, by gBagPockets. An empty slot is id 0; the
 *  bag keeps no slot for a count of nothing (CheckBagHasItem reads it the same way). */
export function bagHolds(emu: HudRead, sym: (name: string) => number | undefined, pocket: number, items: number[]): Set<number> {
  const out = new Set<number>();
  const pockets = sym('gBagPockets');
  if (pockets === undefined) return out;
  const p = pockets + pocket * POCKET_SIZE;
  const slots = emu.read(p, 32);
  const cap = emu.read(p + POCKET_CAPACITY, 8);
  for (let i = 0; i < cap; i++) {
    const id = emu.read(slots + i * SLOT_SIZE, 16);
    if (items.includes(id)) out.add(id);
  }
  return out;
}

/** The world's water class (tools/br/export-world.py, bots/world.ts). */
const CLASS_WATER = 2;

/** What the context button does where we stand. `item` is what it registers. */
export interface Ctx {
  label: 'FISH' | 'BIKE' | 'WALK';
  item: number;
  enabled: boolean;
}

/** What the HUD shows, read off the ROM. */
export interface HudView {
  /** The overworld is running (no battle, no bag, no fade to a menu). */
  onField: boolean;
  /** The map's section, as its sign says it, and the sign's theme. */
  place: string;
  theme: string;
  clock: number;
  left: number;
  eyes: number;
  /** gBrHud's FOG! flash: 0 none, 1 the off beat, 2 the on beat (br_hud.c FogPhase). */
  flash: 0 | 1 | 2;
  /** Where the fog closes to, or FOG EVERYWHERE; null before the ring (the Safari). */
  ring: string | null;
  fogEverywhere: boolean;
  ctx: Ctx;
  /** gPlayerPartyCount: the start menu has no POKeMON row before the first catch. */
  party: number;
}

/** The context button for a trainer with `flags`, facing a cell of class `facing`, on a
 *  map that is `outdoor`, with `rod` and `bike` in the bag (0 for none). Riding, it gets
 *  off; facing water with a rod, it fishes (surfing too); on foot outdoors with a bike,
 *  it rides it; anywhere else it is BIKE, greyed out. */
export function contextFor(flags: number, facing: number, outdoor: boolean, rod: number, bike = ITEM_MACH_BIKE): Ctx {
  if (flags & AVATAR_ACRO_BIKE) return { label: 'WALK', item: ITEM_ACRO_BIKE, enabled: true };
  if (flags & AVATAR_MACH_BIKE) return { label: 'WALK', item: ITEM_MACH_BIKE, enabled: true };
  if (facing === CLASS_WATER && rod !== 0) return { label: 'FISH', item: rod, enabled: true };
  return { label: 'BIKE', item: bike || ITEM_MACH_BIKE, enabled: bike !== 0 && outdoor && !(flags & AVATAR_SURFING) };
}

/** The FOG! flash's beat, as br_hud.c's FogPhase has it. */
export function fogPhase(frames: number): 0 | 1 | 2 {
  if (frames === 0) return 0;
  return (frames >> 3) & 1 ? 1 : 2;
}

const SECTIONS = (regionData as { sections: Record<string, { name: string }> }).sections;
const THEMES = uiData.popupThemes as Record<string, string>;

/** A section's sign: its name and its theme, wood when the ROM gives it none. */
export function signFor(section: string): { name: string; theme: string } {
  return { name: SECTIONS[section]?.name ?? '', theme: THEMES[section] ?? 'wood' };
}

export interface HudRead {
  read(addr: number, bits: 8 | 16 | 32): number;
}

export interface HudWorld {
  map(group: number, num: number): Pick<WorldMap, 'id' | 'section' | 'outdoor'> | undefined;
  cell(id: string, x: number, y: number): number;
}

/** The bike in the bag: the MACH BIKE if it is there, the ACRO BIKE if that is; 0 for
 *  none. Without gBagPockets (an older patch) the MACH BIKE, as before. */
function bikeIn(emu: HudRead, sym: (name: string) => number | undefined): number {
  if (sym('gBagPockets') === undefined) return ITEM_MACH_BIKE;
  const has = bagHolds(emu, sym, KEYITEMS_POCKET, [ITEM_MACH_BIKE, ITEM_ACRO_BIKE]);
  return has.has(ITEM_MACH_BIKE) ? ITEM_MACH_BIKE : has.has(ITEM_ACRO_BIKE) ? ITEM_ACRO_BIKE : 0;
}

/** The HUD's view, read off the ROM; null without the symbols it needs. */
export function readHudView(emu: HudRead, sym: (name: string) => number | undefined, world: HudWorld | null): HudView | null {
  const hud = sym('gBrHud');
  const own = sym('gBrOwnPos');
  const avatar = sym('gPlayerAvatar');
  const main = sym('gMain');
  const overworld = sym('CB2_Overworld');
  if (hud === undefined || own === undefined || avatar === undefined) return null;
  const s16 = (v: number) => (v << 16) >> 16;
  const group = emu.read(own + OWN_GROUP, 8);
  const num = emu.read(own + OWN_NUM, 8);
  const map = world?.map(group, num);
  const sign = signFor(map?.section ?? '');
  const ring = sym('gBrRing');
  let ringPlace: string | null = null;
  let everywhere = false;
  if (ring !== undefined && emu.read(ring + RING_ACTIVE, 8) !== 0) {
    if (((emu.read(ring + RING_R, 8) << 24) >> 24) < 0) {
      everywhere = true;
      ringPlace = 'FOG EVERYWHERE';
    } else {
      const bytes: number[] = [];
      for (let i = 0; i < RING_PLACE_MAX; i++) {
        const b = emu.read(ring + RING_PLACE + i, 8);
        if (b === 0xff) break;
        bytes.push(b);
      }
      ringPlace = bytes.length ? decodeGen3(Uint8Array.from(bytes)) : null;
    }
  }
  const flags = emu.read(avatar + AVATAR_FLAGS, 8);
  const [dx, dy] = FACING[emu.read(own + OWN_DIR, 8)] ?? [0, 0];
  const x = s16(emu.read(own + OWN_X, 16)) - MAP_OFFSET + dx;
  const y = s16(emu.read(own + OWN_Y, 16)) - MAP_OFFSET + dy;
  const facing = map && world ? world.cell(map.id, x, y) : 0;
  const partyCount = sym('gPlayerPartyCount');
  const levels = sym('gBrLevels');
  const rod = levels === undefined ? 0 : emu.read(levels + LEVELS_ROD, 16);
  return {
    onField: main !== undefined && overworld !== undefined && (emu.read(main + MAIN_CALLBACK2, 32) & ~1) === overworld,
    place: sign.name,
    theme: sign.theme,
    clock: emu.read(hud + HUD.OFF_CLOCK_SECS, 16),
    left: emu.read(hud + HUD.OFF_LEFT, 8),
    eyes: emu.read(hud + HUD.OFF_EYES, 8),
    flash: fogPhase(emu.read(hud + HUD_FOG_FRAMES, 8)),
    ring: ringPlace,
    fogEverywhere: everywhere,
    ctx: contextFor(flags, facing, !!map?.outdoor, rod, bikeIn(emu, sym)),
    party: partyCount === undefined ? 0 : emu.read(partyCount, 8),
  };
}

// ---- what the windows say --------------------------------------------------------------

/** The fog window's width, GBA pixels: room inside for FOG EVERYWHERE. */
export const FOG_W = 120;
export const SIGN_W = 96;
export const SIGN_H = 40;
/** How long the sign stays up on a new section before it goes, as Emerald's map popup
 *  does (Cam, 2026-10-17). */
export const SIGN_MS = 3000;
export const DOCK_W = 96;
export const DOCK_H = 40;
const LINE = 14;

export interface Line {
  left?: { text: string; color: TextColor };
  right?: { text: string; color: TextColor };
}

/** m:ss */
export function clockText(secs: number): string {
  return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
}

/** The fog window's lines: FOG and the clock (FOG! in its flash), FOG EVERYWHERE once
 *  it is, and how many are left, with the eyes on this trainer when anybody watches.
 *  Not where the ring closes to (Cam, 2026-10-17): MAP shows that. */
export function fogLines(v: HudView): Line[] {
  const inner = FOG_W - 16;
  const clock: Line['right'] =
    v.flash === 2 ? { text: 'FOG!', color: TEXT_RED } : v.flash === 1 ? undefined : { text: clockText(v.clock), color: v.clock <= 30 ? TEXT_RED : TEXT_DARK };
  const lines: Line[] = [{ left: { text: v.ring === null ? 'SAFARI' : 'FOG', color: TEXT_BLUE }, right: clock }];
  if (v.fogEverywhere && v.ring !== null) lines.push({ left: { text: fitText(v.ring, inner), color: TEXT_RED } });
  lines.push({
    left: { text: `${v.left} LEFT`, color: TEXT_BLUE },
    right: v.eyes > 0 ? { text: `${v.eyes} WATCH`, color: TEXT_GRAY } : undefined,
  });
  return lines;
}

/** The fog window's height for `n` lines, in whole tiles. */
export function fogHeight(n: number): number {
  return Math.ceil((16 + n * LINE) / 8) * 8;
}

// ---- drawing ---------------------------------------------------------------------------

const pictures = new Map<string, HTMLImageElement>();
export function picture(src: string, onLoad: () => void): HTMLImageElement {
  let img = pictures.get(src);
  if (!img) {
    img = new Image();
    img.decoding = 'async';
    img.src = src;
    pictures.set(src, img);
  }
  if (!img.complete) img.addEventListener('load', onLoad, { once: true });
  return img;
}

const ICONS = uiData.itemIcons as { cell: number; cols: number };

/** One window of the HUD: a canvas of `w` x `h` GBA pixels shown at the HUD's scale. */
export class Win {
  readonly canvas: HTMLCanvasElement;
  readonly c: EmeraldCanvas;
  private key = '';
  constructor(
    readonly el: HTMLElement,
    w: number,
    h: number,
    private readonly paint: (c: EmeraldCanvas, redo: () => void) => void,
  ) {
    this.canvas = document.createElement('canvas');
    this.canvas.setAttribute('aria-hidden', 'true');
    el.appendChild(this.canvas);
    this.c = new EmeraldCanvas(this.canvas);
    this.c.resize(w, h, 1);
    this.c.onLoad = () => this.redraw();
  }

  size(w: number, h: number, scale: number): void {
    if (this.c.width !== w || this.c.height !== h) this.key = '';
    this.c.resize(w, h, scale);
    this.key = '';
    this.redraw();
  }

  /** Paint when what it shows changed (`key`), or always when key is omitted. */
  show(key: string): void {
    if (key === this.key) return;
    this.key = key;
    this.redraw();
  }

  redraw(): void {
    this.c.clearAll();
    this.paint(this.c, () => this.redraw());
  }
}

function drawIcon(c: EmeraldCanvas, item: number, x: number, y: number, redo: () => void): void {
  const img = picture('/ui/items.png', redo);
  const n = ICONS.cell;
  c.drawPicture(img, (item % ICONS.cols) * n, Math.floor(item / ICONS.cols) * n, n, n, x, y);
}

export interface PhoneHudDeps {
  /** Over the field, top: the sign and the fog window go here. */
  top: HTMLElement;
  /** The dock: PARTY, MAP, START, the context button (the room menu sits between). */
  dock: HTMLElement;
  onParty(): void;
  onMap(): void;
  onStart(): void;
  onUse(item: number): void;
}

/** When the sign comes up: on a section it was not last showing. Forgotten when the HUD
 *  goes off the glass, so the next match brings it up even in the section the last one
 *  ended in. */
export class SignCue {
  private key = '';
  /** True when `key` is a new section to show. */
  next(key: string): boolean {
    if (key === this.key) return false;
    this.key = key;
    return true;
  }
  reset(): void {
    this.key = '';
  }
}

export class PhoneHud {
  private view: HudView | null = null;
  private scale = 1;
  private readonly signCue = new SignCue();
  private signTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly sign: Win;
  private readonly fog: Win;
  private readonly party: Win;
  private readonly map: Win;
  private readonly start: Win;
  private readonly ctx: Win;
  readonly buttons: Record<'party' | 'map' | 'start' | 'ctx', HTMLButtonElement>;

  constructor(private readonly deps: PhoneHudDeps) {
    const doc = deps.top.ownerDocument;
    const box = (cls: string) => {
      const el = doc.createElement('div');
      el.className = cls;
      deps.top.appendChild(el);
      return el;
    };
    const button = (id: string, label: string, onPress: () => void) => {
      const b = doc.createElement('button');
      b.type = 'button';
      b.id = id;
      b.className = 'hud-btn';
      b.setAttribute('aria-label', label);
      b.addEventListener('click', (ev) => {
        ev.preventDefault();
        if (b.getAttribute('aria-disabled') !== 'true') onPress();
      });
      deps.dock.appendChild(b);
      return b;
    };
    this.sign = new Win(box('hud-sign'), SIGN_W, SIGN_H, (c, redo) => {
      const v = this.view;
      if (!v) return;
      c.drawPicture(picture(`/ui/popup-${v.theme}.png`, redo), 0, 0, SIGN_W, SIGN_H, 0, 0);
      const name = fitText(v.place, SIGN_W - 16);
      c.drawTextCentred(name, SIGN_W / 2, 13, TEXT_DARK);
    });
    this.fog = new Win(box('hud-fog'), FOG_W, fogHeight(3), (c) => {
      const v = this.view;
      if (!v) return;
      const lines = fogLines(v);
      c.drawFrame({ x: 0, y: 0, w: FOG_W, h: fogHeight(lines.length) });
      lines.forEach((l, i) => {
        const y = 7 + i * LINE;
        if (l.left) c.drawText(l.left.text, 8, y, l.left.color);
        if (l.right) c.drawText(l.right.text, FOG_W - 8 - measure(l.right.text), y, l.right.color);
      });
    });
    const dockWin = (b: HTMLButtonElement, item: () => number | null, label: () => string, sub: () => string | null) =>
      new Win(b, DOCK_W, DOCK_H, (c, redo) => {
        c.drawFrame({ x: 0, y: 0, w: DOCK_W, h: DOCK_H });
        const icon = item();
        const x = icon === null ? 32 : 34;
        if (icon !== null) drawIcon(c, icon, 7, 8, redo);
        const s = sub();
        const dark = b.getAttribute('aria-disabled') === 'true' ? TEXT_GRAY : TEXT_DARK;
        if (s === null) c.drawText(label(), x, 13, dark);
        else {
          c.drawText(label(), x, 7, dark);
          c.drawText(s, x, 19, TEXT_GRAY);
        }
      });
    this.buttons = {
      party: button('hud-party', 'Party', () => deps.onParty()),
      map: button('hud-map', 'Map', () => deps.onMap()),
      start: button('hud-start', 'Start', () => deps.onStart()),
      ctx: button('hud-ctx', 'Select', () => this.view && deps.onUse(this.view.ctx.item)),
    };
    this.party = dockWin(this.buttons.party, () => ITEM_POKE_BALL, () => 'PARTY', () => null);
    this.map = dockWin(this.buttons.map, () => ITEM_TOWN_MAP, () => 'MAP', () => null);
    this.start = dockWin(this.buttons.start, () => null, () => 'START', () => null);
    this.ctx = dockWin(this.buttons.ctx, () => this.view?.ctx.item ?? ITEM_MACH_BIKE, () => this.view?.ctx.label ?? 'BIKE', () => 'SELECT');
  }

  /** CSS pixels per GBA pixel: the field's. */
  setScale(scale: number): void {
    if (!(scale > 0) || scale === this.scale) return;
    this.scale = scale;
    this.sign.size(SIGN_W, SIGN_H, scale);
    this.fog.size(FOG_W, this.fog.c.height, scale);
    for (const w of [this.party, this.map, this.start, this.ctx]) w.size(DOCK_W, DOCK_H, scale);
  }

  private grey(b: HTMLButtonElement, w: Win, off: boolean): void {
    if (b.getAttribute('aria-disabled') === String(off)) return;
    b.setAttribute('aria-disabled', String(off));
    w.redraw();
  }

  /** Off the glass (a match over, the phone turned): the next update shows the sign. */
  hide(): void {
    this.signCue.reset();
    clearTimeout(this.signTimer);
    this.sign.el.classList.add('gone');
  }

  update(v: HudView): void {
    this.view = v;
    this.deps.top.classList.toggle('off-field', !v.onField);
    this.deps.dock.classList.toggle('off-field', !v.onField);
    const signKey = `${v.theme}|${v.place}`;
    if (this.signCue.next(signKey)) {
      this.sign.show(signKey);
      // A section with no name (the map not known yet) has no sign to show.
      this.sign.el.classList.toggle('gone', !v.place);
      clearTimeout(this.signTimer);
      if (v.place) this.signTimer = setTimeout(() => this.sign.el.classList.add('gone'), SIGN_MS);
    }
    const lines = fogLines(v);
    const h = fogHeight(lines.length);
    if (this.fog.c.height !== h) this.fog.size(FOG_W, h, this.scale);
    this.fog.show(JSON.stringify(lines.map((l) => [l.left?.text, l.left?.color.fg, l.right?.text, l.right?.color.fg])));
    // The start menu has a POKeMON row once there is a party, and MAP once the ring is
    // up (start_menu.c): before that each is grey, not a START that opens and shuts.
    this.grey(this.buttons.party, this.party, v.party === 0);
    this.grey(this.buttons.map, this.map, v.ring === null);
    const ctx = this.buttons.ctx;
    ctx.setAttribute('aria-disabled', String(!v.ctx.enabled));
    ctx.setAttribute('aria-label', `Select: ${v.ctx.label}`);
    this.ctx.show(`${v.ctx.label}|${v.ctx.item}|${v.ctx.enabled}`);
  }
}
