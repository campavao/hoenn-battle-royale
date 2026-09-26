// The page's copies of the ROM's numbers, held to the ROM's own sources (POK-330 #32).
//
// Nothing compiles on both sides of the mailbox, so the contract is copied by hand:
// message ids, the mailbox's layout, the offsets the page reads RAM at, the rules a bot
// has to play by the ROM's way. Each copy was tied to its source by a comment, and a
// comment does not fail when one side moves -- BR_HUD_OFF_HELD/QUEUE sat four bytes off
// the struct they named until an audit looked. So this reads the C: the #defines, the
// tables, and the `/* n */` offset comments the BR structs carry, and holds each copy to
// them. A STATIC_ASSERT(offsetof(...)) or sizeof pin in the C is held to the same
// comment, so once the ROM pins a struct, the compiler, the comment and the page all
// have to agree. pret's structs with no offset comments (CameraObject, PaletteFadeControl,
// Weather, ChooseMoveStruct) are laid out from their declarations the way agbcc does.
//
// (zone.test.ts, ticker.test.ts, relay.test.ts, caps.test.ts and field.test.ts already
// hold their own: BrZone, BR_CHEST_KEY, MAX_SEAT to the relay, the reassembly caps and
// the band.)
//
// Not held here, on purpose: field.ts's LCD_LEFT/LCD_TOP (measured off a driver, in no
// source), FOG_TILE (the fog sprite's 64x64, in a sprite template), ROM_BASE (the GBA's
// memory map), and the page's own timings (HELD_FADE_MAX, SHAKE_FRAMES).
//
// Every source read here is tracked. include/constants/map_groups.h and its siblings are
// made by the build and are in no checkout, so CI's web job, which runs no make, would
// fail this whole file at import: map ids come from data/maps instead.
import { describe, expect, it } from 'vitest';
import wireH from '../../include/br/br_wire.h?raw';
import wireIdsH from '../../include/br/br_wire_ids.h?raw';
import mailboxH from '../../include/br/br_mailbox.h?raw';
import configH from '../../include/br/br_config.h?raw';
import versionH from '../../include/br/br_version.h?raw';
import bootH from '../../include/br/br_boot.h?raw';
import hudH from '../../include/br/br_hud.h?raw';
import ringH from '../../include/br/br_ring.h?raw';
import pickH from '../../include/br/br_pick.h?raw';
import battleH from '../../include/br/br_battle.h?raw';
import ghostsH from '../../include/br/br_ghosts.h?raw';
import matchH from '../../include/br/br_match.h?raw';
import engageH from '../../include/br/br_engage.h?raw';
import levelsC from '../../src/br/br_levels.c?raw';
import matchC from '../../src/br/br_match.c?raw';
import engageC from '../../src/br/br_engage.c?raw';
import lootC from '../../src/br/br_loot.c?raw';
import ringC from '../../src/br/br_ring.c?raw';
import spectateC from '../../src/br/br_spectate.c?raw';
import ghostsC from '../../src/br/br_ghosts.c?raw';
import mapGroups from '../../data/maps/map_groups.json';
import eventObjectsH from '../../include/constants/event_objects.h?raw';
import itemsH from '../../include/constants/items.h?raw';
import varsH from '../../include/constants/vars.h?raw';
import weatherH from '../../include/constants/weather.h?raw';
import constantsGlobalH from '../../include/constants/global.h?raw';
import globalH from '../../include/global.h?raw';
import fieldmapH from '../../include/global.fieldmap.h?raw';
import mainH from '../../include/main.h?raw';
import spriteH from '../../include/sprite.h?raw';
import fieldCameraH from '../../include/field_camera.h?raw';
import paletteH from '../../include/palette.h?raw';
import fieldWeatherH from '../../include/field_weather.h?raw';
import weatherCountsH from '../../include/constants/field_weather.h?raw';
import pretBattleH from '../../include/battle.h?raw';
import controllersH from '../../include/battle_controllers.h?raw';
import controllersC from '../../src/battle_controllers.c?raw';
import playerControllerC from '../../src/battle_controller_player.c?raw';
import ioRegH from '../../include/gba/io_reg.h?raw';
import serverJs from '../../relay/server.js?raw';
// Copies that are not exported: read as text, the same way as the C.
import appTs from './app.ts?raw';
import brainTs from './bots/brain.ts?raw';
import lootTs from './match/loot.ts?raw';
import uiData from './data/ui.json';
import { BR_CONT_FLAG, BR_MSG } from './net/slots';
import { MAILBOX } from './net/mailbox';
import { MAX_SEAT, PARTY_BAG_MAX, PROTOCOL } from './net/wire';
import { HUD } from './net/hud';
import { LADDER } from './bots/party';
import { MAX_SEATS } from './bots/roster';
import { SIGHT_RANGE } from './bots/sight';
import { ITEM } from './bots/bag';
import { SAFARI_CELLS } from './match/safari';
import { LINE_MAX } from './match/ticker';
import { CODE_ALPHABET, CODE_LENGTH } from './match/lobby';
import { KEY_BIT } from './emu';
import * as field from './field';
import * as touch from './touch';

// ---- reading C -----------------------------------------------------------------------

const NUMBER = '(-?(?:0x[0-9a-fA-F]+|\\d+))';

/** `#define NAME <number>`. */
function define(src: string, name: string): number {
  const m = new RegExp(`^[ \\t]*#define[ \\t]+${name}[ \\t]+${NUMBER}\\b`, 'm').exec(src);
  if (!m) throw new Error(`no #define ${name} with a plain number`);
  return Number(m[1]);
}

/** The numbers in `name[]...[] = { ... };`, flattened, comments dropped. */
function table(src: string, name: string): number[] {
  const code = src.replace(/\/\/.*$/gm, '');
  const m = new RegExp(`\\b${name}(?:\\[[^\\]]*\\])+\\s*=\\s*\\{([\\s\\S]*?)\\};`).exec(code);
  if (!m) throw new Error(`no table ${name}`);
  return [...m[1].matchAll(new RegExp(NUMBER, 'g'))].map((x) => Number(x[1]));
}

/** The names in `name[] = { A, B, ... };`, in order. */
function names(src: string, name: string, prefix: string): string[] {
  const m = new RegExp(`\\b${name}\\[\\]\\s*=\\s*\\{([^}]*)\\}`).exec(src);
  if (!m) throw new Error(`no table ${name}`);
  return m[1].match(new RegExp(`\\b${prefix}\\w+`, 'g')) ?? [];
}

/** Where `struct name { ... }`'s braces are, nested ones and all. */
function braces(src: string, name: string): { open: number; close: number } {
  const head = new RegExp(`^struct ${name}\\s*\\{`, 'm').exec(src);
  if (!head) throw new Error(`no struct ${name}`);
  const open = head.index + head[0].length - 1;
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return { open, close: i };
  }
  throw new Error(`struct ${name} never closes`);
}

function body(src: string, name: string): string {
  const { open, close } = braces(src, name);
  return src.slice(open + 1, close);
}

const SCALAR: Record<string, number> = { u8: 1, s8: 1, bool8: 1, u16: 2, s16: 2, vu16: 2, bool16: 2, u32: 4, s32: 4, bool32: 4 };

interface Layout {
  /** Field -> byte offset. A bitfield's is the byte its run starts in. */
  at: Record<string, number>;
  /** Bitfield -> where it is: the byte of its run and the bit within it. */
  bits: Record<string, { byte: number; bit: number }>;
  /** Array field -> its length, when it has one dimension and that is a plain number. */
  count: Record<string, number>;
  /** From a bare `/* n *\/` closing the struct, pret's `/*size = n*\/`, or a
   *  `};  // 16 bytes` after it. */
  size?: number;
}

/** A struct's layout as its offset comments say: `/* 0x18 *\/ struct BrHudLine heldLine;`.
 *  A line with no comment carries on the bitfield run above it; anything else without
 *  one is not recorded. */
function layout(src: string, name: string): Layout {
  const out: Layout = { at: {}, bits: {}, count: {} };
  let byte = -1;
  let bit = 0;
  for (const raw of body(src, name).split(/\r?\n/)) {
    const size = /\/\*\s*size\s*=\s*(0x[0-9a-fA-F]+|\d+)\s*\*\//.exec(raw);
    if (size) {
      out.size = Number(size[1]);
      continue;
    }
    const lead = /^\s*\/\*\s*(0x[0-9a-fA-F]+|\d+)\s*\*\/(.*)$/.exec(raw);
    let rest = raw;
    let commented = false;
    if (lead) {
      const off = Number(lead[1]);
      if (!lead[2].trim()) {
        out.size = off;
        continue;
      }
      if (off !== byte) bit = 0;
      byte = off;
      rest = lead[2];
      commented = true;
    }
    const decl = rest.replace(/\/\/.*$/, '').replace(/\/\*.*?\*\//g, '').trim();
    if (!decl.endsWith(';')) continue;
    const parts = decl.slice(0, -1).split(',');
    const first = /^(.*?)\b([A-Za-z_]\w*)\s*((?:\[\s*\w+\s*\])*)\s*(?::\s*(\d+))?$/.exec(parts[0].trim());
    if (!first) continue;
    const [, type, field, dims, width] = first;
    const dim = /^\[\s*(\d+)\s*\]$/.exec(dims)?.[1];
    if (width !== undefined) {
      if (byte < 0) continue;
      out.bits[field] = { byte, bit };
      out.at[field] = byte;
      bit += Number(width);
      continue;
    }
    if (!commented) continue;
    out.at[field] = byte;
    if (dim !== undefined) out.count[field] = Number(dim);
    // `s16 x, y;`: the rest follow at the type's own size.
    const step = SCALAR[type.trim()];
    parts.slice(1).forEach((p, i) => {
      if (step === undefined) throw new Error(`${name}: ${decl} needs a scalar type to place ${p}`);
      out.at[p.trim()] = byte + step * (i + 1);
    });
  }
  const after = /^\};[ \t]*\/\/[ \t]*(0x[0-9a-fA-F]+|\d+) bytes/.exec(src.slice(braces(src, name).close));
  if (after) out.size ??= Number(after[1]);
  return out;
}

/** A #define's value, following the names in it and plain arithmetic:
 *  `#define OBJ_EVENT_GFX_VARS (NUM_OBJ_EVENT_GFX + 1)`. */
function evaluate(srcs: string[], expr: string): number {
  const text = expr.replace(/\b[A-Za-z_]\w*\b/g, (id) => {
    const src = srcs.find((s) => new RegExp(`^[ \\t]*#define[ \\t]+${id}\\b`, 'm').test(s));
    if (!src) throw new Error(`no #define ${id}`);
    const m = new RegExp(`^[ \\t]*#define[ \\t]+${id}[ \\t]+(.*)$`, 'm').exec(src)!;
    return `(${evaluate(srcs, m[1].replace(/\/\/.*$/, '').replace(/\/\*.*?\*\//g, '').trim())})`;
  });
  if (!/^[\s\dxa-fA-F()+\-*<>|&]*$/.test(text)) throw new Error(`cannot evaluate ${expr}`);
  return Number(new Function(`return ${text};`)());
}

interface Natural {
  /** Field -> byte offset; a bitfield's is that of the unit of its type it sits in. A
   *  nested struct's fields are `outer.inner`. */
  at: Record<string, number>;
  /** Bitfield -> its first bit, counted from the struct's start, and its width. */
  bits: Record<string, { bit: number; width: number }>;
  size: number;
  align: number;
}

/** A struct with no offset comments, laid out the way agbcc does: each field on its own
 *  size's boundary, a pointer four bytes, a union as wide as its widest member, a
 *  bitfield packed into a unit of its type unless it would straddle one, and array
 *  lengths read through the #defines in `defs`. */
function natural(src: string, name: string, defs: string[] = []): Natural {
  return members(body(src, name), false, defs);
}

/** The declarations in a struct's braces, split on the semicolons outside nested ones. */
function declarations(code: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < code.length; i++) {
    if (code[i] === '{') depth++;
    else if (code[i] === '}') depth--;
    else if (code[i] === ';' && depth === 0) {
      out.push(code.slice(start, i).trim());
      start = i + 1;
    }
  }
  return out.filter(Boolean);
}

function members(text: string, union: boolean, defs: string[]): Natural {
  const out: Natural = { at: {}, bits: {}, size: 0, align: 1 };
  let bit = 0; // the next free bit; in a union, the widest member's end
  const place = (size: number, align: number): number => {
    out.align = Math.max(out.align, align);
    const off = union ? 0 : Math.ceil(Math.ceil(bit / 8) / align) * align;
    bit = Math.max(bit, (off + size) * 8);
    return off;
  };
  const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  for (const decl of declarations(code)) {
    const nested = /^(struct|union)\s*\{([\s\S]*)\}\s*(\w+)$/.exec(decl);
    if (nested) {
      const inner = members(nested[2], nested[1] === 'union', defs);
      const off = place(inner.size, inner.align);
      out.at[nested[3]] = off;
      for (const [f, o] of Object.entries(inner.at)) out.at[`${nested[3]}.${f}`] = off + o;
      continue;
    }
    const line = decl.replace(/\s+/g, ' ');
    const fn = /^[\w ]+\( ?\* ?(\w+) ?\) ?\(.*\)$/.exec(line);
    if (fn) {
      out.at[fn[1]] = place(4, 4);
      continue;
    }
    const m = /^((?:struct )?\w+) (.+)$/.exec(line);
    if (!m) throw new Error(`${line}: not a declaration this lays out`);
    for (const d of m[2].split(',')) {
      const dm = /^(\**) ?(\w+) ?((?:\[[^\]]+\] ?)*)(?:: ?(\d+))?$/.exec(d.trim());
      if (!dm) throw new Error(`${line}: cannot read ${d}`);
      const [, stars, field, dims, width] = dm;
      const scalar = stars ? 4 : SCALAR[m[1]];
      if (scalar === undefined) throw new Error(`${line}: ${m[1]} is not a type this lays out`);
      if (width !== undefined) {
        const unit = scalar * 8;
        if (union) throw new Error(`${line}: a bitfield in a union`);
        if ((bit % unit) + Number(width) > unit) bit = Math.ceil(bit / unit) * unit;
        out.bits[field] = { bit, width: Number(width) };
        out.at[field] = Math.floor(bit / unit) * scalar;
        out.align = Math.max(out.align, scalar);
        bit += Number(width);
        continue;
      }
      const count = [...dims.matchAll(/\[([^\]]+)\]/g)].reduce((n, x) => n * evaluate(defs, x[1].trim()), 1);
      out.at[field] = place(scalar * count, scalar);
    }
  }
  out.size = Math.ceil(Math.ceil(bit / 8) / out.align) * out.align;
  return out;
}

/** A `const NAME = <number or [numbers]>;` out of a TypeScript source. */
function tsConst(src: string, name: string): number | number[] {
  const m = new RegExp(`\\bconst ${name} = ([^;]+);`).exec(src);
  if (!m) throw new Error(`no const ${name}`);
  const v = m[1].trim();
  if (v.startsWith('[')) return [...v.matchAll(new RegExp(NUMBER, 'g'))].map((x) => Number(x[1]));
  return Number(v.replace(/_/g, ''));
}

/** A `const NAME = { key: <number>, ... };` out of a TypeScript source. */
function tsObject(src: string, name: string): Record<string, number> {
  const m = new RegExp(`\\bconst ${name} = \\{([^}]*)\\};`).exec(src);
  if (!m) throw new Error(`no const ${name}`);
  return Object.fromEntries([...m[1].matchAll(new RegExp(`(\\w+): ${NUMBER}`, 'g'))].map((x) => [x[1], Number(x[2])]));
}

/** data/maps/map_groups.json, which include/constants/map_groups.h is made from: a map's
 *  group is its group's place in group_order, and its num its place in the group. */
const GROUPS = mapGroups as unknown as { group_order: string[] } & Record<string, string[]>;

/** The Safari Zone's maps: their MAP_ ids, by folder. */
const SAFARI_MAPS = import.meta.glob<{ id: string }>('../../data/maps/SafariZone_*/map.json', { import: 'default', eager: true });

function mapRef(dir: string): { group: number; num: number } {
  const group = GROUPS.group_order.findIndex((g) => GROUPS[g].includes(dir));
  if (group < 0) throw new Error(`${dir} is in no map group`);
  return { group, num: GROUPS[GROUPS.group_order[group]].indexOf(dir) };
}

/** camelCase -> CAMEL_CASE, for the page's names of a struct's fields. */
const snake = (s: string) => s.replace(/[A-Z]/g, (c) => `_${c}`).toUpperCase();

// ---- the C's own pins ----------------------------------------------------------------

const brSources = {
  ...import.meta.glob<string>('../../include/br/*.h', { query: '?raw', import: 'default', eager: true }),
  ...import.meta.glob<string>('../../src/br/*.c', { query: '?raw', import: 'default', eager: true }),
};

describe('the C and its own offset comments', () => {
  it('reads every BR source', () => {
    expect(Object.keys(brSources).length).toBeGreaterThan(30);
    expect(Object.keys(brSources).some((k) => k.endsWith('br_mailbox.h'))).toBe(true);
  });

  it("every offset and size the C pins (BR_OFFSET, BR_SIZE, STATIC_ASSERT) is the struct's comment", () => {
    const all = Object.values(brSources);
    const structOf = (name: string): Layout => {
      const src = all.find((s) => new RegExp(`^struct ${name}\\s*\\{`, 'm').test(s));
      if (!src) throw new Error(`struct ${name} is in no BR source`);
      return layout(src, name);
    };
    const value = (v: string): number => {
      if (/^(0x[0-9a-fA-F]+|\d+)$/.test(v)) return Number(v);
      const src = all.find((s) => new RegExp(`#define\\s+${v}\\s`).test(s));
      if (!src) throw new Error(`no #define ${v} in the BR sources`);
      return define(src, v);
    };
    for (const [file, src] of Object.entries(brSources)) {
      const code = src.replace(/^[ \t]*#define.*$/gm, ''); // not the macros' own definitions
      const offsets = [
        ...code.matchAll(/\bBR_OFFSET\(\s*(\w+)\s*,\s*(\w+)\s*,\s*(\w+)\s*\)/g),
        ...code.matchAll(/STATIC_ASSERT\(\s*offsetof\(\s*struct\s+(\w+)\s*,\s*(\w+)\s*\)\s*==\s*\(?\s*(\w+)\s*\)?\s*,/g),
      ];
      for (const [, struct, f, v] of offsets) {
        const at = structOf(struct).at[f];
        // A field with no comment has nothing to disagree with; the compiler holds the pin.
        if (at !== undefined) expect(at, `${file}: ${struct}.${f} is pinned at ${v}`).toBe(value(v));
      }
      const sizes = [
        ...code.matchAll(/\bBR_SIZE\(\s*(\w+)\s*,\s*(\w+)\s*\)/g),
        ...code.matchAll(/STATIC_ASSERT\(\s*sizeof\(\s*struct\s+(\w+)\s*\)\s*==\s*\(?\s*(\w+)\s*\)?\s*,/g),
      ];
      for (const [, struct, v] of sizes) {
        const size = structOf(struct).size;
        if (size !== undefined) expect(size, `${file}: sizeof(struct ${struct}) is pinned at ${v}`).toBe(value(v));
      }
    }
  });
});

// ---- the wire and the mailbox ----------------------------------------------------------

describe('the wire (include/br/br_wire.h, br_wire_ids.h, br_version.h)', () => {
  it('every message id, both ways', () => {
    const c: Record<string, number> = {};
    for (const m of `${wireH}\n${wireIdsH}`.matchAll(/^#define BR_MSG_(\w+)\s+(0x[0-9a-fA-F]+|\d+)\b/gm)) c[m[1]] = Number(m[2]);
    // Not message types: the continuation bit, and how many types the table has room for.
    const cont = c.CONT;
    delete c.CONT;
    delete c.COUNT;
    expect(c).toEqual({ ...BR_MSG });
    expect(BR_CONT_FLAG).toBe(cont);
  });

  it('the protocol', () => {
    expect(PROTOCOL).toBe(define(versionH, 'BR_PROTOCOL'));
  });
});

describe('the mailbox (include/br/br_mailbox.h)', () => {
  const box = layout(mailboxH, 'BrMailbox');

  it('its rings and its magic', () => {
    expect(MAILBOX.MAGIC).toBe(define(configH, 'BR_MAGIC'));
    expect(MAILBOX.RING_SLOTS).toBe(define(configH, 'BR_RING_SLOTS'));
    expect(MAILBOX.SLOT_BYTES).toBe(define(configH, 'BR_SLOT_BYTES'));
    expect(MAILBOX.SLOT_HDR).toBe(define(mailboxH, 'BR_SLOT_HDR'));
    expect(MAILBOX.PAYLOAD_MAX).toBe(define(configH, 'BR_SLOT_BYTES') - define(mailboxH, 'BR_SLOT_HDR'));
  });

  it('every field where the struct has it, and its size', () => {
    const page: Record<string, number> = {};
    for (const field of ['magic', 'protocol', 'patch', 'size', 'outHead', 'outTail', 'inHead', 'inTail', 'frame', 'dropped', 'out', 'in', 'boot']) {
      page[field] = MAILBOX[`OFF_${snake(field)}` as keyof typeof MAILBOX];
    }
    expect(box.at).toEqual(page);
    expect(box.size).toBe(MAILBOX.SIZE);
    for (const d of ['OUT', 'IN', 'BOOT']) expect(define(mailboxH, `BR_MAILBOX_OFF_${d}`), d).toBe(MAILBOX[`OFF_${d}` as keyof typeof MAILBOX]);
  });

  it('the boot block, as app.ts writes it', () => {
    const boot = layout(bootH, 'BrBoot');
    // writeBootBlock puts each field at BOOT_AT's offset, and the name runs to the end.
    expect(tsObject(appTs, 'BOOT_AT')).toEqual(boot.at);
    expect(boot.at.name + boot.count.name).toBe(MAILBOX.BOOT_BYTES);
    for (const mode of ['BR_BOOT_MAP', 'BR_BOOT_SAFARI', 'BR_BOOT_FLAG_TESTMON']) expect(tsConst(appTs, mode), mode).toBe(define(bootH, mode));
    // What it writes there: a gender, and Littleroot.
    expect([tsConst(appTs, 'MALE'), tsConst(appTs, 'FEMALE')]).toEqual([define(constantsGlobalH, 'MALE'), define(constantsGlobalH, 'FEMALE')]);
    const town = tsObject(appTs, 'LITTLEROOT');
    expect({ group: town.group, num: town.num }).toEqual(mapRef('LittlerootTown'));
  });
});

// ---- what the page reads and writes in RAM -------------------------------------------------

describe("the BR structs the page reads at an offset", () => {
  it('gBrHud: the fields the header marks PAGE WRITES, and nothing else', () => {
    const hud = layout(hudH, 'BrHud');
    const writes = [...body(hudH, 'BrHud').matchAll(/\*\/\s*\w+\s+(\w+);\s*\/\/\s*PAGE WRITES/g)].map((m) => m[1]);
    expect(writes.length).toBeGreaterThan(0);
    const page = Object.fromEntries(writes.map((f) => [`OFF_${snake(f)}`, hud.at[f]]));
    expect(page).toEqual({ ...HUD });
    expect(hud.size, 'the comments add up').toBe(hud.at.boxPad + hud.count.boxPad);
  });

  it('gBrRing, gBrPick and gBrMatch (field.ts, app.ts)', () => {
    const ring = layout(ringH, 'BrRing');
    expect([field.RING_OUTSIDE, field.RING_TIMER]).toEqual([ring.at.outside, ring.at.damageTimer]);
    expect(field.PICK_ACTIVE).toBe(layout(pickH, 'BrPick').at.active);
    // app.ts reads the phase at the struct's base.
    expect(layout(matchH, 'BrMatch').at.phase).toBe(0);
    expect(tsConst(appTs, 'BR_PHASE_DONE')).toBe(define(matchH, 'BR_PHASE_DONE'));
  });

  it('gBrOwnPos and gBrBattle (touch.ts)', () => {
    const own = natural(ghostsH, 'BrOwnPos').at;
    expect([touch.OWN_GROUP, touch.OWN_NUM, touch.OWN_X, touch.OWN_Y, touch.OWN_DIR]).toEqual([own.mapGroup, own.mapNum, own.x, own.y, own.dir]);
    expect(touch.DIR_OF).toEqual({
      south: define(constantsGlobalH, 'DIR_SOUTH'),
      north: define(constantsGlobalH, 'DIR_NORTH'),
      west: define(constantsGlobalH, 'DIR_WEST'),
      east: define(constantsGlobalH, 'DIR_EAST'),
    });
    expect(touch.BATTLE_MENU).toBe(layout(battleH, 'BrBattle').at.menu);
    expect([touch.MENU_ACTION, touch.MENU_MOVE, touch.MENU_SAFARI]).toEqual([
      define(battleH, 'BR_MENU_ACTION'),
      define(battleH, 'BR_MENU_MOVE'),
      define(battleH, 'BR_MENU_SAFARI'),
    ]);
  });
});

describe("pret's structs the page reads at an offset (field.ts, touch.ts)", () => {
  // These move only on a pret merge, and their headers carry the offsets in comments.
  it('gMain: callback2, and inBattle in its bitfield', () => {
    const main = layout(mainH, 'Main');
    expect(field.MAIN_CALLBACK2).toBe(main.at.callback2);
    expect(touch.MAIN_IN_BATTLE_BYTE).toBe(main.bits.inBattle.byte);
    expect(touch.MAIN_IN_BATTLE_BIT).toBe(1 << main.bits.inBattle.bit);
  });

  it('gSaveBlock1Ptr: where we stand, on which map, and the vars', () => {
    const sb1 = layout(globalH, 'SaveBlock1');
    const coords = natural(globalH, 'Coords16').at;
    const warp = natural(globalH, 'WarpData').at;
    expect([field.SB1_POS_X, field.SB1_POS_Y]).toEqual([sb1.at.pos + coords.x, sb1.at.pos + coords.y]);
    expect([field.SB1_MAP_GROUP, field.SB1_MAP_NUM]).toEqual([sb1.at.location + warp.mapGroup, sb1.at.location + warp.mapNum]);
    expect(field.SB1_VARS).toBe(sb1.at.vars);
    expect(field.VAR_OBJ_GFX_ID_0).toBe(define(varsH, 'VAR_OBJ_GFX_ID_0'));
    expect(field.VARS_START).toBe(define(varsH, 'VARS_START'));
  });

  it('gFieldCamera: x and y, where the sub-tile offset is', () => {
    const cam = natural(fieldCameraH, 'CameraObject');
    expect([field.CAMERA_X, field.CAMERA_Y]).toEqual([cam.at.x, cam.at.y]);
  });

  it('gPaletteFade: the palettes it touches, and y, blendColor and active, bit for bit', () => {
    const fade = natural(paletteH, 'PaletteFadeControl');
    expect(field.FADE_SELECTED).toBe(fade.at.multipurpose1);
    expect(field.FADE_BG_PALETTES).toBe(define(paletteH, 'PALETTES_BG'));
    // field.ts reads the bitfields a u16 at a time: the word each sits in, then its bits.
    const word = (f: string) => 2 * Math.floor(fade.bits[f].bit / 16);
    expect(field.FADE_Y_WORD).toBe(word('y'));
    expect(field.FADE_COLOR_WORD).toBe(word('blendColor'));
    expect(word('active')).toBe(field.FADE_COLOR_WORD);
    // f's word with `v` in f and every other bit of the word set: fadeOf has to take
    // exactly f's bits out of it.
    const holding = (f: string, v: number) =>
      Object.entries(fade.bits)
        .filter(([g]) => word(g) === word(f))
        .reduce((w, [g, { bit, width }]) => w | ((g === f ? v : (1 << width) - 1) << (bit % 16)), 0);
    expect(field.fadeOf(holding('y', 0b10101), 0).y).toBe(0b10101);
    expect(field.fadeOf(0, holding('blendColor', 0x5555))).toMatchObject({ color: 0x5555, active: true });
    expect(field.fadeOf(0, holding('active', 0))).toMatchObject({ color: 0x7fff, active: false });
  });

  it('gObjectEvents', () => {
    const obj = layout(fieldmapH, 'ObjectEvent');
    expect(field.OBJ_SIZE).toBe(obj.size);
    expect(field.OBJ_COUNT).toBe(define(constantsGlobalH, 'OBJECT_EVENTS_COUNT'));
    expect(obj.bits.active).toEqual({ byte: field.OBJ_ACTIVE_BYTE, bit: 0 });
    expect(obj.bits.invisible.byte).toBe(field.OBJ_INVISIBLE_BYTE);
    expect(1 << obj.bits.invisible.bit).toBe(field.OBJ_INVISIBLE_BIT);
    expect(obj.bits.offScreen.byte, 'the same byte as invisible').toBe(field.OBJ_INVISIBLE_BYTE);
    expect(1 << obj.bits.offScreen.bit).toBe(field.OBJ_OFFSCREEN_BIT);
    expect(obj.bits.isPlayer).toEqual({ byte: field.OBJ_PLAYER_BYTE, bit: 0 });
    expect([field.OBJ_SPRITE_ID, field.OBJ_GFX]).toEqual([obj.at.spriteId, obj.at.graphicsId]);
  });

  it('gSprites', () => {
    const spr = layout(spriteH, 'Sprite');
    expect({
      anims: field.SPR_ANIMS,
      x: field.SPR_X,
      y: field.SPR_Y,
      x2: field.SPR_X2,
      y2: field.SPR_Y2,
      centerToCornerVecX: field.SPR_CTC_X,
      centerToCornerVecY: field.SPR_CTC_Y,
      animNum: field.SPR_ANIM_NUM,
      animCmdIndex: field.SPR_ANIM_CMD,
      inUse: field.SPR_FLAGS,
    }).toEqual({
      anims: spr.at.anims,
      x: spr.at.x,
      y: spr.at.y,
      x2: spr.at.x2,
      y2: spr.at.y2,
      centerToCornerVecX: spr.at.centerToCornerVecX,
      centerToCornerVecY: spr.at.centerToCornerVecY,
      animNum: spr.at.animNum,
      animCmdIndex: spr.at.animCmdIndex,
      inUse: spr.at.inUse,
    });
    // The last field is a u8.
    expect(field.SPR_SIZE).toBe(spr.at.subpriority + 1);
    // The flags, as bits of the u16 at SPR_FLAGS.
    const flag = (f: string) => 1 << ((spr.bits[f].byte - field.SPR_FLAGS) * 8 + spr.bits[f].bit);
    expect([field.SPR_IN_USE, field.SPR_ON_CAMERA, field.SPR_INVISIBLE, field.SPR_HFLIP]).toEqual([
      flag('inUse'),
      flag('coordOffsetEnabled'),
      flag('invisible'),
      flag('hFlip'),
    ]);
  });

  it('a graphics id past the table names a var', () => {
    expect(field.GFX_VARS).toBe(evaluate([eventObjectsH], 'OBJ_EVENT_GFX_VARS'));
  });

  it("gWeather: the weather, the fog's scroll and the blend", () => {
    const weather = natural(fieldWeatherH, 'Weather', [fieldWeatherH, weatherCountsH]);
    expect(field.WEATHER_FOG_HORIZONTAL).toBe(define(weatherH, 'WEATHER_FOG_HORIZONTAL'));
    expect([field.WEATHER_CURR, field.WEATHER_FOG_X, field.WEATHER_EVA, field.WEATHER_EVB]).toEqual([
      weather.at.currWeather,
      weather.at.fogHScrollPosX,
      weather.at.currBlendEVA,
      weather.at.currBlendEVB,
    ]);
  });

  it("gBattleBufferA: a battler's row, and the move ids the move menu shows", () => {
    const row = /\bgBattleBufferA\[\s*\w+\s*\]\[\s*(0x[0-9a-fA-F]+|\d+)\s*\]/.exec(pretBattleH);
    expect(row, 'gBattleBufferA in battle.h').not.toBeNull();
    expect(touch.BUFFER_A_ROW).toBe(Number(row![1]));
    // The controller command's four bytes, then the struct: the player's controller reads
    // it where BtlController_EmitChooseMove wrote it, and the move ids lead it.
    const read = /\(struct ChooseMoveStruct \*\)\(&gBattleBufferA\[gActiveBattler\]\[(\d+)\]\)/.exec(playerControllerC);
    const wrote = /sBattleBuffersTransferData\[(\d+) \+ i\] = \*\(\(u8 \*\)\(movePPData\) \+ i\)/.exec(controllersC);
    expect([Number(read?.[1]), Number(wrote?.[1])]).toEqual([touch.CHOOSE_MOVE_MOVES, touch.CHOOSE_MOVE_MOVES]);
    expect(natural(controllersH, 'ChooseMoveStruct', [constantsGlobalH]).at.moves).toBe(0);
  });

  it("the keys are KEYINPUT's bits", () => {
    const io: Record<keyof typeof KEY_BIT, string> = {
      a: 'A_BUTTON',
      b: 'B_BUTTON',
      select: 'SELECT_BUTTON',
      start: 'START_BUTTON',
      right: 'DPAD_RIGHT',
      left: 'DPAD_LEFT',
      up: 'DPAD_UP',
      down: 'DPAD_DOWN',
      r: 'R_BUTTON',
      l: 'L_BUTTON',
    };
    for (const [key, bit] of Object.entries(KEY_BIT)) expect(1 << bit, key).toBe(define(ioRegH, io[key as keyof typeof KEY_BIT]));
  });
});

// ---- the rules both sides play by --------------------------------------------------------

describe('the rules a bot plays by the ROM\'s way', () => {
  const secs = (frames: number) => (frames * 1000) / 60;

  it('the level ladder is sLadder', () => {
    expect(LADDER).toEqual(table(levelsC, 'sLadder'));
  });

  it('the fog bites every BR_FOG_TICK_FRAMES, a tenth of max HP as Bleed takes it', () => {
    expect(tsConst(brainTs, 'FOG_TICK_MS')).toBe(secs(define(ringH, 'BR_FOG_TICK_FRAMES')));
    const bite = /\bdmg = maxHp \/ (\d+);/.exec(ringC);
    expect(bite, 'Bleed divides max HP').not.toBeNull();
    expect(tsConst(brainTs, 'FOG_BITE')).toBe(Number(bite![1]));
  });

  it('sight and the re-engage grace', () => {
    expect(SIGHT_RANGE).toBe(define(engageH, 'BR_SIGHT_RANGE'));
    expect(tsConst(brainTs, 'ENGAGE_COOLDOWN_MS')).toBe(secs(define(engageC, 'BR_ENGAGE_GRACE')));
  });

  it('a spill scatters over sSpillDx/sSpillDy, in their order', () => {
    expect(tsConst(lootTs, 'SPILL_DX')).toEqual(table(lootC, 'sSpillDx'));
    expect(tsConst(lootTs, 'SPILL_DY')).toEqual(table(lootC, 'sSpillDy'));
  });

  it('the Safari opening\'s cells are sSafariCells', () => {
    // A cell is a map num in MAP_SAFARI_ZONE_SOUTH's group; the page names the map.
    expect(matchC).toMatch(/SetWarpDestination\(MAP_GROUP\(MAP_SAFARI_ZONE_SOUTH\), area,/);
    const south = Object.entries(SAFARI_MAPS).find(([, m]) => m.id === 'MAP_SAFARI_ZONE_SOUTH')![0].split('/').at(-2)!;
    const maps = GROUPS[GROUPS.group_order[mapRef(south).group]];
    const idOf = (num: number) => SAFARI_MAPS[`../../data/maps/${maps[num]}/map.json`]?.id ?? `${maps[num]}, not a Safari Zone map`;
    const flat = table(matchC, 'sSafariCells');
    const rom = [];
    for (let i = 0; i < flat.length; i += 3) rom.push({ map: idOf(flat[i]), x: flat[i + 1], y: flat[i + 2] });
    expect(SAFARI_CELLS).toEqual(rom);
  });

  it('seats, a ticker line, a peeked bag', () => {
    expect(MAX_SEATS).toBe(define(configH, 'BR_MAX_SEATS'));
    expect(MAX_SEAT).toBe(define(configH, 'BR_MAX_SEATS') - 1);
    expect(LINE_MAX).toBe(define(hudH, 'BR_HUD_LINE_MAX'));
    expect(PARTY_BAG_MAX).toBe(define(spectateC, 'BR_PEEK_BAG_MAX'));
  });

  it('the item ids a bot carries are items.h\'s', () => {
    const list = /enum\s*\{([\s\S]*?)\};/.exec(itemsH)![1].replace(/\/\/.*$/gm, '');
    const ids = list.split(',').map((s) => s.trim()).filter(Boolean);
    expect(ids.every((s) => /^ITEMS?_\w+$/.test(s)), 'a plain enum, counted from ITEM_NONE').toBe(true);
    for (const [name, id] of Object.entries(ITEM)) expect(ids.indexOf(`ITEM_${name}`), name).toBe(id);
  });

  it('a room code is the relay\'s alphabet and length', () => {
    expect(serverJs).toContain(`export const CODE_ALPHABET = "${CODE_ALPHABET}";`);
    expect(serverJs).toContain(`export const CODE_LENGTH = ${CODE_LENGTH};`);
  });
});

// ---- generated data (POK-330 #59) ------------------------------------------------------------

describe('ui.json, as tools/br/export-ui.py generated it', () => {
  it('the skins are sSkinGraphics in br_ghosts.c, through event_objects.h', () => {
    const gfx = new Map<string, number>();
    for (const m of eventObjectsH.matchAll(/#define\s+(OBJ_EVENT_GFX_\w+)\s+(\d+)\b/g)) gfx.set(m[1], Number(m[2]));
    const rom = names(ghostsC, 'sSkinGraphics', 'OBJ_EVENT_GFX_').map((n) => gfx.get(n));
    expect(rom.length).toBeGreaterThan(0);
    expect(uiData.skins, 're-run tools/br/export-ui.py').toEqual(rom);
  });
});
