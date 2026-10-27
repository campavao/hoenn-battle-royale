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
// Weather, ChooseMoveStruct) are laid out from their declarations the way agbcc does, and
// every offset the page derives of pret's structs is pinned in src/br/br_pins.c: the last
// test of that block fails on one the ROM does not pin at the same number (POK-331 #22).
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
import lootH from '../../include/br/br_loot.h?raw';
import menuH from '../../include/br/br_menu.h?raw';
import levelsH from '../../include/br/br_levels.h?raw';
import hmH from '../../include/br/br_hm.h?raw';
import startMenuC from '../../src/start_menu.c?raw';
import popupC from '../../src/map_name_popup.c?raw';
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
import speciesH from '../../include/constants/species.h?raw';
import speciesInfoH from '../../src/data/pokemon/species_info.h?raw';
import trainersH from '../../src/data/trainers.h?raw';
import trainerPartiesH from '../../src/data/trainer_parties.h?raw';
import varsH from '../../include/constants/vars.h?raw';
import scriptCmdsH from '../../include/constants/battle_script_commands.h?raw';
import weatherH from '../../include/constants/weather.h?raw';
import constantsGlobalH from '../../include/constants/global.h?raw';
import globalH from '../../include/global.h?raw';
import fieldmapH from '../../include/global.fieldmap.h?raw';
import mainH from '../../include/main.h?raw';
import pokemonH from '../../include/pokemon.h?raw';
import constantsPokemonH from '../../include/constants/pokemon.h?raw';
import battleMainH from '../../include/battle_main.h?raw';
import spriteH from '../../include/sprite.h?raw';
import gbaTypesH from '../../include/gba/types.h?raw';
import fieldCameraH from '../../include/field_camera.h?raw';
import paletteH from '../../include/palette.h?raw';
import fieldWeatherH from '../../include/field_weather.h?raw';
import weatherCountsH from '../../include/constants/field_weather.h?raw';
import pretBattleH from '../../include/battle.h?raw';
import controllersH from '../../include/battle_controllers.h?raw';
import controllersC from '../../src/battle_controllers.c?raw';
import playerControllerC from '../../src/battle_controller_player.c?raw';
import ioRegH from '../../include/gba/io_reg.h?raw';
import fieldmapFnH from '../../include/fieldmap.h?raw';
import flagsH from '../../include/constants/flags.h?raw';
import movementH from '../../include/constants/event_object_movement.h?raw';
import objectEventsC from '../../src/event_object_movement.c?raw';
import overworldC from '../../src/overworld.c?raw';
import graphicsInfoPointersH from '../../src/data/object_events/object_event_graphics_info_pointers.h?raw';
import objectEventGraphicsInfoH from '../../src/data/object_events/object_event_graphics_info.h?raw';
import objectEventAnimsH from '../../src/data/object_events/object_event_anims.h?raw';
import serverJs from '../../relay/server.js?raw';
// Copies that are not exported: read as text, the same way as the C.
import appTs from './app.ts?raw';
import brainTs from './bots/brain.ts?raw';
import lootTs from './match/loot.ts?raw';
import { PATCH_KEY_BASE } from './match/loot';
import { LEGEND_GFX } from './match/legends';
import { EVENT_KEY_BASE, EVENT_MAX, EVENT_PIECES, GOLD, LEGENDS, RARES, claimKey, traderKey } from './match/events';
import { GIFT_KEY_BASE, GIFTS } from './match/gifts';
import { DOOR_Y, FLYING, STORIES } from './match/story';
import uiData from './data/ui.json';
import { BR_CONT_FLAG, BR_MSG, TICKER_KIND_ORDER } from './net/slots';
import { MAILBOX } from './net/mailbox';
import { MAX_SEAT, PARTY_BAG_MAX, PROTOCOL } from './net/wire';
import { HUD, HUD_PAGE } from './net/hud';
import { LADDER } from './bots/party';
import { MAX_SEATS } from './bots/roster';
import { SIGHT_RANGE } from './bots/sight';
import { ITEM } from './bots/bag';
import { SAFARI_CELLS } from './match/safari';
import { LINE_MAX } from './match/ticker';
import { CODE_ALPHABET, CODE_LENGTH } from './match/lobby';
import { KEY_BIT } from './emu';
import * as field from './field';
import * as fieldExtra from './field-extra';
import * as ghosts from './field-ghosts';
import * as touch from './touch';
import * as phone from './ui/phonehud';
import * as movebook from './battle/movebook';
import * as bmenu from './ui/battlemenu';
import battleConstH from '../../include/constants/battle.h?raw';
import itemH from '../../include/item.h?raw';
import itemConstH from '../../include/constants/item.h?raw';

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

const brAll = Object.values(brSources);

/** The wasm core's patch (tools/br/mgba-wasm), for what the core reads of the ROM's RAM. */
const coreJs = Object.values(import.meta.glob<string>('../public/emu/mgba.js', { query: '?raw', import: 'default', eager: true }))[0] ?? '';
const corePatch = (Object.values(import.meta.glob<string>('../../tools/br/mgba-wasm/hbr-exports.patch', { query: '?raw', import: 'default', eager: true }))[0] ?? '').replace(/\r\n/g, '\n');

/** The BR source that declares `struct name`, if one does. A struct none does is pret's. */
const brStructSource = (name: string) => brAll.find((s) => new RegExp(`^struct ${name}\\s*\\{`, 'm').test(s));

interface Pin {
  file: string;
  /** The struct, or for an array's row `gBattleBufferA[0]`. */
  struct: string;
  /** The field; none on a size pin. */
  field?: string;
  /** The number as the C writes it: a literal or a BR #define. */
  text: string;
}

/** A pin's number. */
function pinValue(text: string): number {
  if (/^(0x[0-9a-fA-F]+|\d+)$/.test(text)) return Number(text);
  const src = brAll.find((s) => new RegExp(`#define\\s+${text}\\s`).test(s));
  if (!src) throw new Error(`no #define ${text} in the BR sources`);
  return define(src, text);
}

/** Every offset and size the C pins -- BR_OFFSET, BR_SIZE, STATIC_ASSERT(offsetof(...))
 *  and STATIC_ASSERT(sizeof(...)) -- in every BR source. */
function cPins(): Pin[] {
  const out: Pin[] = [];
  for (const [file, src] of Object.entries(brSources)) {
    const code = src.replace(/^[ \t]*#define.*$/gm, ''); // not the macros' own definitions
    const offsets = [
      ...code.matchAll(/\bBR_OFFSET\(\s*(\w+)\s*,\s*(\w+)\s*,\s*(\w+)\s*\)/g),
      ...code.matchAll(/STATIC_ASSERT\(\s*offsetof\(\s*struct\s+(\w+)\s*,\s*(\w+)\s*\)\s*==\s*\(?\s*(\w+)\s*\)?\s*,/g),
    ];
    for (const [, struct, field, text] of offsets) out.push({ file, struct, field, text });
    const sizes = [
      ...code.matchAll(/\bBR_SIZE\(\s*(\w+)\s*,\s*(\w+)\s*\)/g),
      ...code.matchAll(/STATIC_ASSERT\(\s*sizeof\(\s*struct\s+(\w+)\s*\)\s*==\s*\(?\s*(\w+)\s*\)?\s*,/g),
    ];
    for (const [, struct, text] of sizes) out.push({ file, struct, text });
    for (const [, array, text] of code.matchAll(/STATIC_ASSERT\(\s*sizeof\(\s*(\w+)\s*\[\s*0\s*\]\s*\)\s*==\s*\(?\s*(\w+)\s*\)?\s*,/g)) {
      out.push({ file, struct: `${array}[0]`, text });
    }
  }
  return out;
}

describe('the C and its own offset comments', () => {
  it('reads every BR source', () => {
    expect(Object.keys(brSources).length).toBeGreaterThan(30);
    expect(Object.keys(brSources).some((k) => k.endsWith('br_mailbox.h'))).toBe(true);
  });

  it("every offset and size the C pins (BR_OFFSET, BR_SIZE, STATIC_ASSERT) is the struct's comment", () => {
    // pret's structs are held further down, to what the page derives of them.
    for (const { file, struct, field, text } of cPins()) {
      const src = brStructSource(struct);
      if (!src) continue;
      if (field !== undefined) {
        const at = layout(src, struct).at[field];
        // A field with no comment has nothing to disagree with; the compiler holds the pin.
        if (at !== undefined) expect(at, `${file}: ${struct}.${field} is pinned at ${text}`).toBe(pinValue(text));
      } else {
        const size = layout(src, struct).size;
        if (size !== undefined) expect(size, `${file}: sizeof(struct ${struct}) is pinned at ${text}`).toBe(pinValue(text));
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
    expect(hud.size, 'the comments add up').toBe(hud.at.noBattleBox + 1);
  });

  it('gBrRing, gBrPick and gBrMatch (field.ts, app.ts)', () => {
    const ring = layout(ringH, 'BrRing');
    expect([field.RING_OUTSIDE, field.RING_TIMER]).toEqual([ring.at.outside, ring.at.damageTimer]);
    expect(field.PICK_ACTIVE).toBe(layout(pickH, 'BrPick').at.active);
    // app.ts reads the phase at the struct's base.
    expect(layout(matchH, 'BrMatch').at.phase).toBe(0);
    expect(tsConst(appTs, 'BR_PHASE_DONE')).toBe(define(matchH, 'BR_PHASE_DONE'));
  });

  it("the phone's HUD and dock: the start menu's rows, SELECT's item, and what the windows read (ui/phonehud.ts)", () => {
    const menu = layout(menuH, 'BrStartMenu').at;
    expect([touch.START_MENU_CURSOR, touch.START_MENU_COUNT, touch.START_MENU_ACTIONS]).toEqual([menu.cursor, menu.count, menu.actions]);
    // A function pointer layout() does not read; its comment, which BR_OFFSET holds the compiler to.
    expect(Number(/\/\*\s*(0x[0-9A-F]+)\s*\*\/\s*bool8 \(\*input\)/.exec(menuH)?.[1])).toBe(touch.START_MENU_INPUT);
    const actions = /enum\s*\{\s*MENU_ACTION_POKEDEX,([\s\S]*?)\};/.exec(startMenuC)![1].replace(/#else[\s\S]*?#endif/, '').replace(/\/\/.*$/gm, '');
    const rows = ['MENU_ACTION_POKEDEX', ...(actions.match(/MENU_ACTION_\w+/g) ?? [])];
    expect([touch.START_POKEMON, touch.START_BR_MAP]).toEqual([rows.indexOf('MENU_ACTION_POKEMON'), rows.indexOf('MENU_ACTION_BR_MAP')]);
    expect(touch.SAVE1_REGISTERED_ITEM).toBe(watch('SaveBlock1', layout(globalH, 'SaveBlock1')).at.registeredItem);
    expect(phone.AVATAR_FLAGS).toBe(watch('PlayerAvatar', layout(fieldmapH, 'PlayerAvatar')).at.flags);
    const bit = (n: string) => 1 << Number(new RegExp(`#define\\s+${n}\\s+\\(1 << (\\d+)\\)`).exec(fieldmapH)![1]);
    expect([phone.AVATAR_MACH_BIKE, phone.AVATAR_ACRO_BIKE, phone.AVATAR_SURFING]).toEqual(
      ['PLAYER_AVATAR_FLAG_MACH_BIKE', 'PLAYER_AVATAR_FLAG_ACRO_BIKE', 'PLAYER_AVATAR_FLAG_SURFING'].map(bit),
    );
    const ring = layout(ringH, 'BrRing').at;
    expect([phone.RING_ACTIVE, phone.RING_R]).toEqual([ring.active, ring.r]);
    expect(Number(/\/\*\s*(\d+)\s*\*\/\s*u8 place\[BR_RING_PLACE_MAX \+ 1\]/.exec(ringH)?.[1])).toBe(phone.RING_PLACE);
    expect(phone.RING_PLACE_MAX).toBe(define(ringH, 'BR_RING_PLACE_MAX'));
    expect(phone.LEVELS_ROD).toBe(layout(levelsH, 'BrLevels').at.rod);
    expect(phone.HUD_FOG_FRAMES).toBe(layout(hudH, 'BrHud').at.fogFrames);
    const hm = layout(hmH, 'BrHmView').at;
    expect([phone.HM_CAN, phone.HM_READY]).toEqual([hm.can, hm.ready]);
    const hmBit = (n: string) => Number(new RegExp(`#define\\s+BR_HM_${n}\\s+\\(1 << (\\d+)\\)`).exec(hmH)![1]);
    expect(phone.fieldMoves(0xff, 0).map((m) => m.hm)).toEqual(['CUT', 'FLY', 'SURF', 'STRENGTH', 'WATERFALL', 'DIVE'].map(hmBit));
    const list = /enum\s*\{([\s\S]*?)\};/.exec(itemsH)![1].replace(/\/\/.*$/gm, '');
    const ids = list.split(',').map((x) => x.trim()).filter(Boolean);
    expect([phone.ITEM_MACH_BIKE, phone.ITEM_ACRO_BIKE, phone.ITEM_POKE_BALL, phone.ITEM_TOWN_MAP]).toEqual(
      ['ITEM_MACH_BIKE', 'ITEM_ACRO_BIKE', 'ITEM_POKE_BALL', 'ITEM_TOWN_MAP'].map((n) => ids.indexOf(n)),
    );
    // The signs: every section map_name_popup.c gives one, with its theme.
    const themes = /sMapSectionToThemeId\[[^\]]*\]\s*=\s*\{([\s\S]*?)\};/.exec(popupC)![1];
    const want = Object.fromEntries([...themes.matchAll(/\[(MAPSEC_\w+)[^\]]*\]\s*=\s*MAPPOPUP_THEME_(\w+)/g)].map((m) => [m[1], m[2].toLowerCase()]));
    expect(uiData.popupThemes).toEqual(want);
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
    expect([touch.MENU_ACTION, touch.MENU_MOVE, touch.MENU_SAFARI, touch.MENU_TARGET]).toEqual([
      define(battleH, 'BR_MENU_ACTION'),
      define(battleH, 'BR_MENU_MOVE'),
      define(battleH, 'BR_MENU_SAFARI'),
      define(battleH, 'BR_MENU_TARGET'),
    ]);
  });

  it('gBrSeats, gBrLoot and gBrDespawned: the people past the object box (field-ghosts.ts)', () => {
    const seat = layout(ghostsH, 'BrSeat');
    expect([ghosts.SEAT_PRESENT, ghosts.SEAT_SKIN, ghosts.SEAT_MAP_GROUP, ghosts.SEAT_MAP_NUM, ghosts.SEAT_X, ghosts.SEAT_Y, ghosts.SEAT_DIR]).toEqual([
      seat.at.present, seat.at.skin, seat.at.mapGroup, seat.at.mapNum, seat.at.x, seat.at.y, seat.at.dir,
    ]);
    expect([ghosts.SEAT_SIZE, ghosts.SEAT_COUNT]).toEqual([seat.size, define(configH, 'BR_MAX_SEATS')]);
    const item = layout(lootH, 'BrLootItem');
    expect(layout(lootH, 'BrLoot').at.items).toBe(0);
    expect([ghosts.LOOT_X, ghosts.LOOT_Y, ghosts.LOOT_SPECIES, ghosts.LOOT_MAP_GROUP, ghosts.LOOT_MAP_NUM, ghosts.LOOT_KIND]).toEqual([
      item.at.x, item.at.y, item.at.species, item.at.mapGroup, item.at.mapNum, item.at.kind,
    ]);
    expect([ghosts.LOOT_SIZE, ghosts.LOOT_COUNT]).toEqual([item.size, define(lootH, 'BR_MAX_LOOT')]);
    expect([ghosts.LOOT_NONE, ghosts.LOOT_BAG]).toEqual([define(lootH, 'BR_LOOT_NONE'), define(lootH, 'BR_LOOT_BAG')]);
    const gone = layout(lootH, 'BrDespawned');
    expect([ghosts.DESPAWN_MAP_GROUP, ghosts.DESPAWN_MAP_NUM, ghosts.DESPAWN_LOCAL_ID]).toEqual([gone.at.mapGroup, gone.at.mapNum, gone.at.localId]);
    expect([ghosts.DESPAWN_SIZE, ghosts.DESPAWN_COUNT]).toEqual([gone.size, define(lootH, 'BR_MAX_DESPAWN')]);
    // A live object's local id says which seat's ghost or which row's ball it is.
    expect([ghosts.GHOST_LOCAL_ID_BASE, ghosts.LOOT_LOCAL_ID_BASE]).toEqual([define(configH, 'BR_GHOST_LOCAL_ID_BASE'), define(lootH, 'BR_LOOT_LOCAL_ID_BASE')]);
    // ...and what br_loot.c's Gfx draws the ground as: a bag unless it is one thing, and a
    // team packed in its bag as the bag (HBR-82).
    const spawn = /\(it->kind == BR_LOOT_BAG && !OneThing\(it\)\) \|\| Packed\(it\) \?\s*(OBJ_EVENT_GFX_\w+)\s*:\s*(OBJ_EVENT_GFX_\w+);/.exec(lootC);
    expect(spawn, "br_loot.c's Spawn picks the bag or the ball").not.toBeNull();
    expect([ghosts.GFX_BIRCHS_BAG, ghosts.GFX_ITEM_BALL]).toEqual([define(eventObjectsH, spawn![1]), define(eventObjectsH, spawn![2])]);
    // ...and a gift-giver as sGiftGfx says, by his key (br_loot.h's BR_LOOT_KEY_GIFT_BASE).
    expect(ghosts.GIFT_KEY_BASE).toBe(define(lootH, 'BR_LOOT_KEY_GIFT_BASE'));
    expect(ghosts.GIFT_GFX).toEqual(names(lootC, 'sGiftGfx', 'OBJ_EVENT_GFX_').map((n) => define(eventObjectsH, n)));
    expect(ghosts.LOOT_KEY).toBe(item.at.key);
    expect(ghosts.LOOT_MON).toBe(define(lootH, 'BR_LOOT_MON'));
  });

  it("a legendary to fight stands as sLegends in br_legend.c says (POK-410)", () => {
    const legendC = brAll.find((src) => /\bsLegends\[\]/.test(src))!;
    const body = /sLegends\[\]\[2\] = \{([\s\S]*?)\};/.exec(legendC)![1];
    const rows = [...body.matchAll(/\{\s*(SPECIES_\w+),\s*(OBJ_EVENT_GFX_\w+)\s*\}/g)].map((m) => [define(speciesH, m[1]), define(eventObjectsH, m[2])]);
    expect(rows.length).toBeGreaterThan(0);
    expect([...LEGEND_GFX.entries()].sort((a, b) => a[0] - b[0])).toEqual(rows.sort((a, b) => a[0] - b[0]));
    // Every legendary an event or a story deals has a sprite: none falls back to a ball.
    for (const list of LEGENDS) for (const species of list) expect(LEGEND_GFX.has(species), `species ${species}`).toBe(true);
  });

  it("the box the ROM keeps objects in: BrField_InObjectView, and Emerald's own spawn and cull", () => {
    const brField = brSources['../../src/br/br_field.c'];
    const view = /BrField_InObjectView\(s16 x, s16 y\)\s*\{\s*s16 left = gSaveBlock1Ptr->pos\.x - (\d+);\s*s16 right = gSaveBlock1Ptr->pos\.x \+ (\d+);\s*s16 top = gSaveBlock1Ptr->pos\.y;\s*s16 bottom = gSaveBlock1Ptr->pos\.y \+ (\d+);[\s\S]*?if \(sRoomGrows\)\s*Grow\(&left, &right, &top, &bottom\);\s*return x >= left && x <= right && y >= top && y <= bottom;/.exec(brField);
    expect(view, 'BrField_InObjectView reads as four bounds on pos, grown').not.toBeNull();
    expect(ghosts.VIEW).toEqual({ left: -Number(view![1]), right: Number(view![2]), top: 0, bottom: Number(view![3]) });
    // The map's own people: spawned in one box and culled outside another, and both are it.
    const box = (fn: string): Record<string, number> => {
      const m = new RegExp(`${fn}\\([^)]*\\)\\s*\\{([\\s\\S]*?)\\n\\}`).exec(objectEventsC.replace(/\r\n/g, '\n'));
      if (!m) throw new Error(`no ${fn}`);
      const at = (side: string, axis: string): number => {
        const b = new RegExp(`s16 ${side} =\\s*gSaveBlock1Ptr->pos\\.${axis}(?:\\s*([+-])\\s*([^;]+))?;`).exec(m[1]);
        if (!b) throw new Error(`${fn}: no ${side}`);
        return b[1] ? (b[1] === '-' ? -1 : 1) * evaluate([fieldmapFnH], b[2].trim()) : 0;
      };
      return { left: at('left', 'x'), right: at('right', 'x'), top: at('top', 'y'), bottom: at('bottom', 'y') };
    };
    expect(box('void TrySpawnObjectEvents')).toEqual(ghosts.VIEW);
    expect(box('static void RemoveObjectEventIfOutsideView')).toEqual(ghosts.VIEW);
    const body = (fn: string): string => new RegExp(`${fn}\\([^)]*\\)\\s*\\{([\\s\\S]*?)\\n\\}`).exec(objectEventsC.replace(/\r\n/g, '\n'))![1];
    // pret's box spawns first, then the grown rows (so the people at your feet are never
    // short of a slot), and the cull keeps the grown box.
    expect(body('void TrySpawnObjectEvents'), 'TrySpawnObjectEvents spawns the grown rows after its own box').toMatch(
      /TrySpawnObjectEventTemplate\(template, [^;]+;\s*\}\s*#if BR\s*BrField_SpawnGrown\(objectCount, cameraX, cameraY, TrySpawnObjectEventTemplate\);\s*#endif\s*\}$/);
    expect(body('static void RemoveObjectEventIfOutsideView'), 'the cull grows its box').toMatch(/#if BR\s*BrField_GrowObjectBox\(&left, &right, &top, &bottom\);\s*#endif/);
    expect(ghosts.MAP_OFFSET).toBe(define(fieldmapFnH, 'MAP_OFFSET'));
  });

  it("the OAM side table is one layout on both sides: the ROM packs what the core's patch unpacks", () => {
    const brField = brSources['../../src/br/br_field.c'];
    const fieldH = brSources['../../include/br/br_field.h'];
    // A nibble an entry, entry i in byte i / 2: a mark, two signed bits of y's 256s, and
    // a bit for an x left of the LCD (its 9 bits less 512).
    expect(define(fieldH, 'BR_OAM_HI_MARK')).toBe(4);
    expect(define(fieldH, 'BR_OAM_HI_LEFT')).toBe(8);
    expect(brField).toMatch(/nibble = BR_OAM_HI_MARK \| \(page & 3\);\s*if \(x < 0\)\s*nibble \|= BR_OAM_HI_LEFT;\s*sOamHiNext\[index \/ 2\] \|= nibble << \(4 \* \(index & 1\)\);/);
    // Only sprites on the camera's offset are marked; a weather grid (off it) is read as
    // the hardware reads it, and the core draws an unmarked semi-transparent one 320
    // columns either side too.
    expect(brField).toMatch(/if \(!sOamMarking \|\| !sprite->coordOffsetEnabled\)\s*return;/);
    expect(corePatch).toMatch(/OBJ_MODE_SEMITRANSPARENT && !_brMarked\(renderer, sprite->index\)\) \{\s*\+\s*renderer->brShiftX = -320;[^]*?renderer->brShiftX = 320;/);
    expect(corePatch).toMatch(/x \+= renderer->objOffsetX \+ renderer->brLeft \+ renderer->brShiftX;/);
    expect(corePatch).toMatch(/return renderer->brOamHi && \(\(renderer->brOamHi\[index >> 1\] >> \(4 \* \(index & 1\)\)\) & 4\);/);
    expect(corePatch).toMatch(/if \(_brMarked\(renderer, sprite->index\)\) \{\s*\+\s*int nibble = renderer->brOamHi\[sprite->index >> 1\] >> \(4 \* \(sprite->index & 1\)\);\s*\+\s*top \+= 256 \* \(\(\(nibble & 3\) \^ 2\) - 2\);/);
    expect(corePatch).toMatch(/int nibble = renderer->brOamHi\[index >> 1\] >> \(4 \* \(index & 1\)\);\s*\+\s*if \(nibble & 4\) \{\s*\+\s*x = GBAObjAttributesBGetX\(sprite->b\) - \(\(nibble & 8\) \? 512 : 0\);/);
    expect(define(fieldH, 'BR_OAM_HI_SIZE')).toBe(64);
    expect(corePatch).toMatch(/brOamTable = offset >= 0 && offset \+ 64 <= GBA_SIZE_EWRAM/);
    // ...and the shipped core has the export the page calls.
    expect(coreJs).toContain('_brSetOamTable');
  });

  it("a ghost the page walks walks as DriveGhost walks its object: the queue, the pace, the stride (field-ghosts.ts, POK-323)", () => {
    expect(ghosts.STEP_QUEUE).toBe(define(ghostsH, 'BR_STEP_QUEUE'));
    // A queued step is walked at PaceWalk's pace...
    expect(ghostsC).toMatch(/ObjectEventSetHeldMovement\(obj, PaceWalk\(seat, dir\)\);/);
    expect(table(ghostsC, 'sFrames')).toEqual([...ghosts.PACE_FRAMES]);
    expect(ghosts.PACE_FAST_AT).toBe(define(ghostsC, 'BR_PACE_FAST_AT'));
    expect(ghosts.PACE_FASTER_AT).toBe(define(ghostsC, 'BR_PACE_FASTER_AT'));
    expect(ghosts.PACE_IDLE_MAX).toBe(define(ghostsC, 'BR_PACE_IDLE_MAX'));
    expect(ghostsC).toMatch(/if \(pace == BR_PACE_FASTER\)\s*return GetWalkFasterMovementAction\(dir\);\s*if \(pace == BR_PACE_FAST\)\s*return GetWalkFastMovementAction\(dir\);\s*return GetWalkNormalMovementAction\(dir\);/);
    const moves = objectEventsC.replace(/\r\n/g, '\n');
    // ...two and four pixels a frame at the faster two, for as many frames as their tables have
    for (const d of ['Down', 'Up', 'Left', 'Right']) {
      expect(moves, `WalkFast${d}`).toMatch(new RegExp(`MovementAction_WalkFast${d}_Step0\\([^)]*\\)\\s*\\{\\s*InitMovementNormal\\(objectEvent, sprite, DIR_\\w+, MOVE_SPEED_FAST_1\\);`));
      expect(moves, `WalkFaster${d}`).toMatch(new RegExp(`MovementAction_WalkFaster${d}_Step0\\([^)]*\\)\\s*\\{\\s*InitMovementNormal\\(objectEvent, sprite, DIR_\\w+, MOVE_SPEED_FASTER\\);`));
    }
    expect(moves).toMatch(/\[MOVE_SPEED_FAST_1\] = ARRAY_COUNT\(sStep2Funcs\),/);
    expect(moves).toMatch(/\[MOVE_SPEED_FASTER\] = ARRAY_COUNT\(sStep4Funcs\),/);
    expect(/\bsStep2Funcs\[\]\s*=\s*\{([^}]*)\}/.exec(moves)![1].match(/\bStep2\b/g)!.length).toBe(ghosts.PACE_FRAMES[1]);
    expect(/\bsStep4Funcs\[\]\s*=\s*\{([^}]*)\}/.exec(moves)![1].match(/\bStep4\b/g)!.length).toBe(ghosts.PACE_FRAMES[2]);
    for (const d of ['Down', 'Up', 'Left', 'Right']) {
      expect(moves, `WalkNormal${d}`).toMatch(new RegExp(`MovementAction_WalkNormal${d}_Step0\\([^)]*\\)\\s*\\{\\s*InitMovementNormal\\(objectEvent, sprite, DIR_\\w+, MOVE_SPEED_NORMAL\\);`));
    }
    // ...a pixel a frame, for as many frames as sStep1Funcs has entries.
    expect(moves).toMatch(/\[MOVE_SPEED_NORMAL\] = ARRAY_COUNT\(sStep1Funcs\),/);
    expect(/\bsStep1Funcs\[\]\s*=\s*\{([^}]*)\}/.exec(moves)![1].match(/\bStep1\b/g)!.length).toBe(ghosts.WALK_FRAMES);
    expect(moves).toMatch(/static void Step1\(struct Sprite \*sprite, u8 dir\)\s*\{\s*sprite->x \+= sDirectionToVectors\[dir\]\.x;\s*sprite->y \+= sDirectionToVectors\[dir\]\.y;\s*\}/);
    // The feet alternate by the step table's animPos, read the way the page reads it.
    expect(moves).toMatch(/static void InitMovementNormal\([^)]*\)\s*\{[^}]*SetStepAnimHandleAlternation\(objectEvent, sprite, /);
    expect(moves).toMatch(
      /if \(sprite->animCmdIndex == stepTable->animPos\[0\]\)\s*sprite->animCmdIndex\s*= stepTable->animPos\[3\];\s*else if \(sprite->animCmdIndex == stepTable->animPos\[1\]\)\s*sprite->animCmdIndex = stepTable->animPos\[2\];/,
    );

    // The stride and the standing frames, by direction.
    const anims = objectEventAnimsH.replace(/\r\n/g, '\n');
    const frames = (name: string) => {
      const m = new RegExp(`\\b${name}\\[\\]\\s*=\\s*\\{([^}]*)\\}`).exec(anims);
      if (!m) throw new Error(`no ${name}`);
      return [...m[1].matchAll(/ANIMCMD_FRAME\((\d+),\s*(\d+)(,\s*\.hFlip\s*=\s*TRUE)?\)/g)].map((f) => ({ frame: Number(f[1]), ticks: Number(f[2]), hFlip: !!f[3] }));
    };
    const dirs = { South: 'DIR_SOUTH', North: 'DIR_NORTH', West: 'DIR_WEST', East: 'DIR_EAST' };
    for (const [name, macro] of Object.entries(dirs)) {
      const dir = define(constantsGlobalH, macro);
      const east = dir === ghosts.DIR_EAST;
      const go = frames(`sAnim_Go${name}`);
      expect(go.map((f) => f.frame), `sAnim_Go${name}`).toEqual(ghosts.GO_FRAMES[dir]);
      expect(go.every((f) => f.ticks === ghosts.GO_FRAME_TICKS && f.hFlip === east), `sAnim_Go${name}'s ticks and mirror`).toBe(true);
      // The faster go anims are the same stride at the pace's share of the ticks.
      for (const [fast, i] of [['Fast', 1], ['Faster', 2]] as const) {
        const f = frames(`sAnim_Go${fast}${name}`);
        expect(f.map((c) => c.frame), `sAnim_Go${fast}${name}`).toEqual(ghosts.GO_FRAMES[dir]);
        expect(f.every((c) => c.ticks * 2 === ghosts.PACE_FRAMES[i] && c.hFlip === east), `sAnim_Go${fast}${name}'s ticks`).toBe(true);
      }
      const face = frames(`sAnim_Face${name}`)[0];
      expect([face.frame, face.hFlip], `sAnim_Face${name}`).toEqual([ghosts.FACE_FRAMES[dir], east]);
    }
    expect([ghosts.DIR_NORTH, ghosts.DIR_WEST, ghosts.DIR_EAST]).toEqual(['DIR_NORTH', 'DIR_WEST', 'DIR_EAST'].map((d) => define(constantsGlobalH, d)));
    expect(ghosts.GO_FRAME_TICKS * 2, 'a stride is two of its commands').toBe(ghosts.WALK_FRAMES);

    // ...which is what every skin walks on: its graphics' anim table has these for its
    // face and go anims, and its step table alternates at STEP_ANIM_POS.
    const infos = objectEventGraphicsInfoH.replace(/\r\n/g, '\n');
    for (const skin of names(ghostsC, 'sSkinGraphics', 'OBJ_EVENT_GFX_')) {
      const info = new RegExp(`\\[${skin}\\]\\s*=\\s*&(\\w+),`).exec(graphicsInfoPointersH)?.[1];
      const table = info && new RegExp(`\\b${info} = \\{[^}]*\\.anims = (\\w+),`).exec(infos)?.[1];
      expect(table, `${skin}'s anim table`).toBeTruthy();
      const body = new RegExp(`\\b${table}\\[\\]\\s*=\\s*\\{([^}]*)\\}`).exec(anims)![1];
      for (const [name, macro] of Object.entries(dirs)) {
        const std = macro.replace('DIR_', '');
        expect(body, `${table}: face ${name}`).toMatch(new RegExp(`\\[ANIM_STD_FACE_${std}\\] = sAnim_Face${name},`));
        expect(body, `${table}: go ${name}`).toMatch(new RegExp(`\\[ANIM_STD_GO_${std}\\] = sAnim_Go${name},`));
      }
      const pos = new RegExp(`\\.anims = ${table},\\s*\\.animPos = \\{([^}]*)\\}`).exec(anims);
      expect(pos, `${table} in sStepAnimTables`).not.toBeNull();
      expect(pos![1].split(',').map((n) => Number(n.trim()))).toEqual(ghosts.STEP_ANIM_POS);
    }
  });
});

/** The C's pins of pret's structs (src/br/br_pins.c), by `Struct.field`, or `sizeof Struct`
 *  for a size. */
const pretPins = new Map(
  cPins()
    .filter((p) => !brStructSource(p.struct))
    .map((p) => [p.field === undefined ? `sizeof ${p.struct}` : `${p.struct}.${p.field}`, p]),
);
const pinned = (key: string): number | undefined => {
  const pin = pretPins.get(key);
  return pin && pinValue(pin.text);
};

/** What the tests of pret's structs below read, struct by struct: the layout they derived,
 *  and the fields they took out of it (`sizeof` for its size). */
const pretReads = new Map<string, { layout: Layout | Natural; read: Set<string> }>();

/** `l`, noting each field a test reads out of it, so the last test can hold the ROM to
 *  having pinned every one (POK-331 #22). */
function watch<T extends Layout | Natural>(struct: string, l: T): T {
  const entry = pretReads.get(struct) ?? { layout: l, read: new Set<string>() };
  pretReads.set(struct, entry);
  const note = (o: object) =>
    new Proxy(o, {
      get(target, key, receiver) {
        if (typeof key === 'string' && key in target) entry.read.add(key);
        return Reflect.get(target, key, receiver);
      },
    });
  return new Proxy(l, {
    get(target, key, receiver) {
      if (key === 'at' || key === 'bits') return note(Reflect.get(target, key, receiver));
      if (key === 'size') entry.read.add('sizeof');
      return Reflect.get(target, key, receiver);
    },
  });
}

describe("the battle script commands the phone's D-pad and A/B wait on (ui/battlemenu.ts)", () => {
  it('ASKS_PAD: the opcodes, as enum BattleScriptOpcode counts them', () => {
    const body = scriptCmdsH.slice(scriptCmdsH.indexOf('enum BattleScriptOpcode'));
    const names = body.slice(body.indexOf('{') + 1, body.indexOf('}')).replace(/\/\/.*$/gm, '').split(',').map((n) => n.trim()).filter(Boolean);
    const op = (n: string) => names.indexOf(`B_SCR_OP_${n}`);
    const want = ['YESNOBOXLEARNMOVE', 'YESNOBOXSTOPLEARNINGMOVE', 'YESNOBOX', 'DISPLAYDEXINFO', 'TRYGIVECAUGHTMONNICK'].map(op);
    expect(want.every((n) => n > 0)).toBe(true);
    expect([...bmenu.ASKS_PAD].sort((a, b) => a - b)).toEqual(want.sort((a, b) => a - b));
  });
});

describe("pret's structs the page reads at an offset (field.ts, touch.ts)", () => {
  // These move only on a pret merge, and their headers carry the offsets in comments.
  it('gMain: callback2, and inBattle in its bitfield', () => {
    const main = watch('Main', layout(mainH, 'Main'));
    expect(field.MAIN_CALLBACK2).toBe(main.at.callback2);
    expect(touch.MAIN_IN_BATTLE_BYTE).toBe(main.bits.inBattle.byte);
    expect(touch.MAIN_IN_BATTLE_BIT).toBe(1 << main.bits.inBattle.bit);
  });

  it('gSaveBlock1Ptr: where we stand, on which map, and the vars', () => {
    const sb1 = watch('SaveBlock1', layout(globalH, 'SaveBlock1'));
    const coords = watch('Coords16', natural(globalH, 'Coords16')).at;
    const warp = watch('WarpData', natural(globalH, 'WarpData')).at;
    expect([field.SB1_POS_X, field.SB1_POS_Y]).toEqual([sb1.at.pos + coords.x, sb1.at.pos + coords.y]);
    expect([field.SB1_MAP_GROUP, field.SB1_MAP_NUM]).toEqual([sb1.at.location + warp.mapGroup, sb1.at.location + warp.mapNum]);
    expect(field.SB1_VARS).toBe(sb1.at.vars);
    expect(field.VAR_OBJ_GFX_ID_0).toBe(define(varsH, 'VAR_OBJ_GFX_ID_0'));
    expect(field.VARS_START).toBe(define(varsH, 'VARS_START'));
  });

  it('gFieldCamera: x and y, where the sub-tile offset is', () => {
    const cam = watch('CameraObject', natural(fieldCameraH, 'CameraObject'));
    expect([field.CAMERA_X, field.CAMERA_Y]).toEqual([cam.at.x, cam.at.y]);
  });

  it('gPaletteFade: the palettes it touches, and y, blendColor and active, bit for bit', () => {
    const fade = watch('PaletteFadeControl', natural(paletteH, 'PaletteFadeControl'));
    expect(field.FADE_SELECTED).toBe(fade.at.multipurpose1);
    expect(field.FADE_BG_PALETTES).toBe(define(paletteH, 'PALETTES_BG'));
    // field.ts reads the bitfields a u16 at a time: the word each sits in, then its bits.
    const word = (f: string) => 2 * Math.floor(fade.bits[f].bit / 16);
    expect(field.FADE_Y_WORD).toBe(word('y'));
    expect(field.FADE_COLOR_WORD).toBe(word('blendColor'));
    expect(word('active')).toBe(field.FADE_COLOR_WORD);
    expect(field.FADE_TOGGLE_WORD).toBe(word('objPaletteToggle'));
    // The natural layout is modern GCC's; agbcc's straddles the word before (field.ts).
    const bit = 1 << (fade.bits.objPaletteToggle.bit % 16);
    expect(field.FADE_TOGGLE_BITS & bit).not.toBe(0);
    expect(field.toggleBitOf(0x0200, 0x0200 | bit), 'learned from a flip').toBe(bit);
    expect(field.toggleBitOf(0x0a, 0x0e), "agbcc's, off a traced fade-in").toBe(0x4);
    expect(field.toggleBitOf(0x0a, 0x0a), 'a delay frame says nothing').toBe(0);
    // ...and the finishing frames say nothing either: in this layout the counter they run
    // holds the other candidate bit, and the mask is clear while it counts (HBR-56).
    const counter = fade.bits.softwareFadeFinishingCounter;
    const other = field.FADE_TOGGLE_BITS & ~bit;
    expect(word('softwareFadeFinishingCounter')).toBe(field.FADE_TOGGLE_WORD);
    expect(other >= 1 << (counter.bit % 16) && other < 1 << ((counter.bit % 16) + counter.width), 'the counter holds the other bit').toBe(true);
    expect(field.toggleBlending({ active: true }, 0, 0), 'a finishing frame').toBe(false);
    expect(field.toggleBlending({ active: true }, 0, 0xffff), 'a blending frame').toBe(true);
    expect(field.toggleBlending({ active: true }, 0x100, 0xffff), 'a fast fade').toBe(false);
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
    const obj = watch('ObjectEvent', layout(fieldmapH, 'ObjectEvent'));
    expect(field.OBJ_SIZE).toBe(obj.size);
    expect(field.OBJ_COUNT).toBe(define(constantsGlobalH, 'OBJECT_EVENTS_COUNT'));
    expect(obj.bits.active).toEqual({ byte: field.OBJ_ACTIVE_BYTE, bit: 0 });
    expect(obj.bits.invisible.byte).toBe(field.OBJ_INVISIBLE_BYTE);
    expect(1 << obj.bits.invisible.bit).toBe(field.OBJ_INVISIBLE_BIT);
    expect(obj.bits.offScreen.byte, 'the same byte as invisible').toBe(field.OBJ_INVISIBLE_BYTE);
    expect(1 << obj.bits.offScreen.bit).toBe(field.OBJ_OFFSCREEN_BIT);
    expect(obj.bits.isPlayer).toEqual({ byte: field.OBJ_PLAYER_BYTE, bit: 0 });
    expect([field.OBJ_SPRITE_ID, field.OBJ_GFX]).toEqual([obj.at.spriteId, obj.at.graphicsId]);
    expect([field.OBJ_CURRENT_X, field.OBJ_CURRENT_Y]).toEqual([obj.at.currentCoords, obj.at.currentCoords + 2]);
    expect(obj.bits.movementDirection, "the SURF blob's facing, the high nibble").toEqual({ byte: field.OBJ_DIRECTION_BYTE, bit: 4 });
    expect(obj.bits.currentElevation, "touch.ts's, the low nibble").toEqual({ byte: touch.OBJ_ELEVATION_BYTE, bit: 0 });
  });

  it('gSprites', () => {
    const spr = watch('Sprite', layout(spriteH, 'Sprite'));
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
    // The last field is a u8, and the stride is the ROM's sizeof.
    expect(field.SPR_SIZE).toBe(spr.at.subpriority + 1);
    expect(pinned('sizeof Sprite'), 'src/br/br_pins.c').toBe(field.SPR_SIZE);
    // The flags, as bits of the u16 at SPR_FLAGS.
    const flag = (f: string) => 1 << ((spr.bits[f].byte - field.SPR_FLAGS) * 8 + spr.bits[f].bit);
    expect([field.SPR_IN_USE, field.SPR_ON_CAMERA, field.SPR_INVISIBLE]).toEqual([
      flag('inUse'),
      flag('coordOffsetEnabled'),
      flag('invisible'),
    ]);
    // The flip the hardware draws is the OAM's (field.ts oamFlipped): the OamData the
    // Sprite starts with, matrixNum's ST_OAM_HFLIP in the u16 at 2, after x's bits.
    expect(/^\s*\/\*0x00\*\/ struct OamData oam;/m.test(/struct Sprite\s*\{([\s\S]*?)\};/.exec(spriteH)![1]), 'oam first').toBe(true);
    const oam = /struct OamData\s*\{([\s\S]*?)\};/.exec(gbaTypesH)![1];
    expect(oam).toMatch(/\/\*0x02\*\/ u32 x:9;\s*u32 matrixNum:5;/);
    expect(oam).toMatch(/\/\*0x01\*\/ u32 affineMode:2;/);
    expect([field.SPR_OAM_MODE, field.SPR_OAM_ATTR1]).toEqual([1, 2]);
    // The priority drawCovered reads, and the elevation table the page maps a cell by.
    expect(oam).toMatch(/\/\*0x04\*\/ u16 tileNum:10;[^\n]*\n\s*u16 priority:2;/);
    expect([field.SPR_OAM_ATTR2, field.OAM_PRIORITY_SHIFT]).toEqual([4, 10]);
    const table = /sElevationToPriority\[\]\s*=\s*\{([^}]*)\}/.exec(objectEventsC)![1];
    expect(fieldExtra.ELEVATION_TO_PRIORITY).toEqual(table.split(',').map((v) => v.trim()).filter(Boolean).map(Number));
    expect(field.SPR_OAM_HFLIP).toBe(evaluate([gbaTypesH], 'ST_OAM_HFLIP') << 9);
    expect(field.OAM_AFFINE_ON).toBe(evaluate([gbaTypesH], 'ST_OAM_AFFINE_ON_MASK'));
  });

  it('a graphics id past the table names a var', () => {
    expect(field.GFX_VARS).toBe(evaluate([eventObjectsH], 'OBJ_EVENT_GFX_VARS'));
  });

  it("gWeather: the weather, the fog's scroll and the blend", () => {
    const weather = watch('Weather', natural(fieldWeatherH, 'Weather', [fieldWeatherH, weatherCountsH]));
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
    expect(pinned('sizeof gBattleBufferA[0]'), 'src/br/br_pins.c').toBe(touch.BUFFER_A_ROW);
    // The controller command's four bytes, then the struct: the player's controller reads
    // it where BtlController_EmitChooseMove wrote it, and the move ids lead it.
    const read = /\(struct ChooseMoveStruct \*\)\(&gBattleBufferA\[gActiveBattler\]\[(\d+)\]\)/.exec(playerControllerC);
    const wrote = /sBattleBuffersTransferData\[(\d+) \+ i\] = \*\(\(u8 \*\)\(movePPData\) \+ i\)/.exec(controllersC);
    expect([Number(read?.[1]), Number(wrote?.[1])]).toEqual([touch.CHOOSE_MOVE_MOVES, touch.CHOOSE_MOVE_MOVES]);
    expect(watch('ChooseMoveStruct', natural(controllersH, 'ChooseMoveStruct', [constantsGlobalH])).at.moves).toBe(0);
  });

  it("what a move is, read out of the ROM's tables (battle/movebook.ts)", () => {
    const move = watch('BattleMove', natural(pokemonH, 'BattleMove'));
    expect([movebook.MOVE_POWER, movebook.MOVE_TYPE, movebook.MOVE_ACCURACY, movebook.MOVE_PP]).toEqual([move.at.power, move.at.type, move.at.accuracy, move.at.pp]);
    // agbcc (and modern, with -mstructure-size-boundary=32) rounds a struct up to a word:
    // nine bytes of fields, twelve to an entry.
    expect(movebook.MOVE_SIZE).toBe(Math.ceil(natural(pokemonH, 'BattleMove').size / 4) * 4);
    expect(pinned('sizeof gBattleMoves[0]'), 'src/br/br_pins.c').toBe(movebook.MOVE_SIZE);
    expect(movebook.MOVE_NAME_SIZE).toBe(define(constantsGlobalH, 'MOVE_NAME_LENGTH') + 1);
    expect(movebook.TYPE_NAME_SIZE).toBe(define(constantsGlobalH, 'TYPE_NAME_LENGTH') + 1);
    expect(movebook.TYPE_MYSTERY).toBe(define(constantsPokemonH, 'TYPE_MYSTERY'));
    expect([movebook.TYPE_FORESIGHT, movebook.TYPE_ENDTABLE, movebook.TYPE_MUL_NORMAL]).toEqual(
      ['TYPE_FORESIGHT', 'TYPE_ENDTABLE', 'TYPE_MUL_NORMAL'].map((n) => define(battleMainH, n)),
    );
  });

  it("the phone's battle menu: our moves and PP, the foe, the flags and the bag (ui/battlemenu.ts)", () => {
    const mon = watch('BattlePokemon', natural(pokemonH, 'BattlePokemon', [constantsGlobalH, constantsPokemonH]));
    expect([bmenu.MON_MOVES, bmenu.MON_TYPES, bmenu.MON_PP, bmenu.MON_NICKNAME, bmenu.MON_PP_BONUSES]).toEqual([
      mon.at.moves,
      mon.at.types,
      mon.at.pp,
      mon.at.nickname,
      mon.at.ppBonuses,
    ]);
    expect(bmenu.MON_SIZE).toBe(mon.size);
    expect(pinned('sizeof gBattleMons[0]'), 'src/br/br_pins.c').toBe(bmenu.MON_SIZE);
    expect(bmenu.NICKNAME_SIZE).toBe(define(constantsGlobalH, 'POKEMON_NAME_LENGTH') + 1);
    const bit = (n: string) => 1 << Number(new RegExp(`#define\\s+${n}\\s+\\(1 << (\\d+)\\)`).exec(battleConstH)![1]);
    expect([bmenu.BATTLE_TYPE_LINK, bmenu.BATTLE_TYPE_TRAINER, bmenu.BATTLE_TYPE_SAFARI, bmenu.BATTLE_TYPE_RECORDED]).toEqual(
      ['BATTLE_TYPE_LINK', 'BATTLE_TYPE_TRAINER', 'BATTLE_TYPE_SAFARI', 'BATTLE_TYPE_RECORDED'].map(bit),
    );
    const pocket = watch('BagPocket', natural(itemH, 'BagPocket'));
    expect([0, phone.POCKET_CAPACITY]).toEqual([pocket.at.itemSlots, pocket.at.capacity]);
    expect(pinned('sizeof gBagPockets[0]'), 'src/br/br_pins.c').toBe(phone.POCKET_SIZE);
    const slot = watch('ItemSlot', natural(globalH, 'ItemSlot'));
    expect([slot.at.itemId, slot.size]).toEqual([0, phone.SLOT_SIZE]);
    expect([phone.ITEMS_POCKET, phone.KEYITEMS_POCKET]).toEqual([define(itemConstH, 'ITEMS_POCKET'), define(itemConstH, 'KEYITEMS_POCKET')]);
    const list = /enum\s*\{([\s\S]*?)\};/.exec(itemsH)![1].replace(/\/\/.*$/gm, '');
    expect(bmenu.ITEM_POKE_DOLL).toBe(list.split(',').map((x) => x.trim()).filter(Boolean).indexOf('ITEM_POKE_DOLL'));
    // Who is local: the battler at PLAYER_LEFT (touch.ts localBattler).
    const positions = /enum BattlerPosition\s*\{([\s\S]*?)\};/.exec(battleConstH)![1].split(',').map((x) => x.trim()).filter(Boolean);
    expect(touch.POSITION_PLAYER_LEFT).toBe(positions.indexOf('B_POSITION_PLAYER_LEFT'));
    // The type icons: one per type, in the summary screen's palettes.
    expect(uiData.typeIcons).toEqual({ w: 32, h: 16 });
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

  it("the map's own people: its templates, the flags that hide them, and an object's local id (field-ghosts.ts)", () => {
    const sb1 = watch('SaveBlock1', layout(globalH, 'SaveBlock1'));
    expect([ghosts.SB1_TEMPLATES, ghosts.SB1_FLAGS]).toEqual([sb1.at.objectEventTemplates, sb1.at.flags]);
    expect(ghosts.TEMPLATE_COUNT).toBe(define(constantsGlobalH, 'OBJECT_EVENT_TEMPLATES_COUNT'));
    expect(ghosts.SPECIAL_FLAGS_START).toBe(define(flagsH, 'SPECIAL_FLAGS_START'));
    const tpl = watch('ObjectEventTemplate', layout(fieldmapH, 'ObjectEventTemplate'));
    expect([ghosts.TPL_LOCAL_ID, ghosts.TPL_GFX, ghosts.TPL_X, ghosts.TPL_Y, ghosts.TPL_MOVEMENT_TYPE, ghosts.TPL_FLAG_ID]).toEqual([
      tpl.at.localId, tpl.at.graphicsId, tpl.at.x, tpl.at.y, tpl.at.movementType, tpl.at.flagId,
    ]);
    // Its last field is flagId, and it holds a pointer, so the row rounds up to a word.
    expect(ghosts.TEMPLATE_SIZE).toBe(Math.ceil((tpl.at.flagId + 2) / 4) * 4);
    expect(pinned('sizeof ObjectEventTemplate'), 'src/br/br_pins.c').toBe(ghosts.TEMPLATE_SIZE);
    const obj = watch('ObjectEvent', layout(fieldmapH, 'ObjectEvent'));
    expect([ghosts.OBJ_LOCAL_ID, ghosts.OBJ_MAP_NUM, ghosts.OBJ_MAP_GROUP]).toEqual([obj.at.localId, obj.at.mapNum, obj.at.mapGroup]);
    // ...less the rows a match strips: gBrStripped, a bit a row, marked as the rows are
    // copied in, and read only while gBrMatch's phase is not BR_PHASE_NONE.
    const stripH = brSources['../../include/br/br_strip.h'];
    expect(stripH).toMatch(/^#define BR_STRIPPED_WORDS \(OBJECT_EVENT_TEMPLATES_COUNT \/ 32\)$/m);
    expect(ghosts.STRIPPED_WORDS * 32, 'a bit for every row').toBe(ghosts.TEMPLATE_COUNT);
    expect(stripH).toMatch(/^extern u32 gBrStripped\[BR_STRIPPED_WORDS\];$/m);
    expect([ghosts.MATCH_PHASE, ghosts.PHASE_NONE]).toEqual([layout(matchH, 'BrMatch').at.phase, define(matchH, 'BR_PHASE_NONE')]);
    expect(overworldC.replace(/\r\n/g, '\n'), 'LoadObjEventTemplatesFromHeader marks the rows it copies').toMatch(
      /void LoadObjEventTemplatesFromHeader\(void\)\s*\{[^}]*CpuCopy32\([^;]*;\s*#if BR\s*BrStrip_MarkTemplates\(\);\s*#endif\s*\}/);
  });

  it("a person's standing frame and the way they face, off the ROM's own tables", () => {
    const info = watch('ObjectEventGraphicsInfo', layout(fieldmapH, 'ObjectEventGraphicsInfo'));
    expect(ghosts.GFX_INFO_ANIMS).toBe(info.at.anims);
    const cmd = watch('AnimFrameCmd', natural(spriteH, 'AnimFrameCmd'));
    expect(ghosts.ANIM_HFLIP_BIT).toBe(cmd.bits.hFlip.bit);
    expect(cmd.size, 'one word: the command is read as a u32').toBe(4);
    // The two tables the page reads off the ROM, by the symbols tools/br/symbols.py exports:
    // a pointer a graphics id, and a direction byte a movement type.
    expect(graphicsInfoPointersH).toMatch(/^const struct ObjectEventGraphicsInfo \*const gObjectEventGraphicsInfoPointers\[/m);
    expect(objectEventsC).toMatch(/^const u8 gInitialMovementTypeFacingDirections\[\] = \{/m);
    expect(ghosts.NUM_MOVEMENT_TYPES).toBe(define(movementH, 'NUM_MOVEMENT_TYPES'));
    // sFaceDirectionAnimNums: a direction's face anim.
    const faces = /\bsFaceDirectionAnimNums\[\]\s*=\s*\{([^}]*)\}/.exec(objectEventsC);
    expect(faces, 'sFaceDirectionAnimNums in event_object_movement.c').not.toBeNull();
    const table: number[] = [];
    for (const [, dir, anim] of faces![1].matchAll(/\[(DIR_\w+)\]\s*=\s*(ANIM_STD_\w+)/g)) table[define(constantsGlobalH, dir)] = define(movementH, anim);
    expect(ghosts.FACE_ANIM).toEqual(table);
    expect(ghosts.DIR_SOUTH).toBe(define(constantsGlobalH, 'DIR_SOUTH'));
    expect(ghosts.HIDDEN_MOVEMENT_TYPES).toEqual(
      ['MOVEMENT_TYPE_BERRY_TREE_GROWTH', 'MOVEMENT_TYPE_TREE_DISGUISE', 'MOVEMENT_TYPE_MOUNTAIN_DISGUISE', 'MOVEMENT_TYPE_BURIED', 'MOVEMENT_TYPE_INVISIBLE'].map((n) => define(movementH, n)),
    );
  });

  // Last: it checks what the tests above read (POK-331 #22).
  it('every offset above is pinned in the ROM, at the number derived here (src/br/br_pins.c)', () => {
    expect(pretReads.size, 'run it with the tests above: it checks what they read').toBeGreaterThan(0);
    // What has to be pinned, and at what: each plain field read, each size read, and for a
    // bitfield the plain fields either side of its run -- or the size, where the run ends
    // the struct -- since a bitfield has no offsetof.
    const want = new Map<string, number | undefined>();
    for (const [struct, { layout: l, read }] of pretReads) {
      const bits: Record<string, { byte?: number; bit: number }> = l.bits;
      const plain = Object.entries(l.at).filter(([f]) => !(f in bits) && !f.includes('.'));
      for (const f of read) {
        if (f === 'sizeof') want.set(`sizeof ${struct}`, l.size);
        else if (!(f in bits)) want.set(`${struct}.${f}`, l.at[f]);
        else {
          const byte = bits[f].byte ?? Math.floor(bits[f].bit / 8);
          const before = plain.filter(([, at]) => at < byte).sort((a, b) => b[1] - a[1])[0];
          const after = plain.filter(([, at]) => at > byte).sort((a, b) => a[1] - b[1])[0];
          if (before) want.set(`${struct}.${before[0]}`, before[1]);
          if (after) want.set(`${struct}.${after[0]}`, after[1]);
          else if (l.size !== undefined) want.set(`sizeof ${struct}`, l.size);
        }
      }
    }
    expect(want.size).toBeGreaterThan(30);
    for (const [key, at] of want) {
      expect(at, `${key}: derived`).toBeDefined();
      expect(pinned(key), `${key}: pin it in src/br/br_pins.c`).toBe(at);
    }
    // And a pin of one of these structs the page does not read still agrees with the rest.
    for (const [key, { file, struct, field: f }] of pretPins) {
      const l = pretReads.get(struct)?.layout;
      const at = f === undefined ? l?.size : l?.at[f];
      if (at !== undefined) expect(pinned(key), `${file}: ${key}`).toBe(at);
    }
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

  it("a patch's key space is br_patch.h's", () => {
    const patchH = brAll.find((src) => /#define\s+BR_PATCH_KEY_BASE\s/.test(src))!;
    expect(PATCH_KEY_BASE).toBe(define(patchH, 'BR_PATCH_KEY_BASE'));
  });

  it("an event's keys and count are br_event.h's", () => {
    const eventH = brAll.find((src) => /#define\s+BR_EVENT_KEY_BASE\s/.test(src))!;
    expect(EVENT_KEY_BASE).toBe(define(eventH, 'BR_EVENT_KEY_BASE'));
    expect(EVENT_MAX).toBe(define(eventH, 'BR_EVENT_MAX'));
    // Past every trainer's key: 0x8000 | slot << 11 | id, slots 0..5, ids under 0x400.
    expect(EVENT_KEY_BASE).toBeGreaterThan(0x8000 | (5 << 11) | 0x3ff);
    // His key and the ask for him (POK-392): events.ts's traderKey and claimKey.
    expect(eventH).toMatch(/^#define BR_EVENT_TRADER_KEY\(n\) BR_EVENT_KEY\(n, 15\)$/m);
    expect(eventH).toMatch(/^#define BR_EVENT_CLAIM_KEY\(n\) BR_EVENT_KEY\(n, 14\)$/m);
    expect([traderKey(0), claimKey(0)]).toEqual([EVENT_KEY_BASE | 15, EVENT_KEY_BASE | 14]);
  });

  it("gBrEvents: the traders past the object box (field-ghosts.ts)", () => {
    const eventH = brAll.find((src) => /#define\s+BR_EVENT_KEY_BASE\s/.test(src))!;
    const events = layout(eventH, 'BrEvents');
    expect([ghosts.EVENTS_SEED, ghosts.EVENTS_LIVE, ghosts.EVENTS_USED, ghosts.EVENTS_TRADER, ghosts.EVENTS_SIZE]).toEqual([
      events.at.seed, events.at.live, events.at.used, events.at.trader, events.size,
    ]);
    const t = layout(eventH, 'BrEventTrader');
    expect([ghosts.TRADER_X, ghosts.TRADER_Y, ghosts.TRADER_SPECIES, ghosts.TRADER_MAP_GROUP, ghosts.TRADER_MAP_NUM, ghosts.TRADER_SIZE]).toEqual([
      t.at.x, t.at.y, t.at.species, t.at.mapGroup, t.at.mapNum, t.size,
    ]);
    expect([ghosts.EVENT_MAX, ghosts.EVENT_LOCAL_ID_BASE]).toEqual([define(eventH, 'BR_EVENT_MAX'), define(eventH, 'BR_EVENT_LOCAL_ID_BASE')]);
    expect(ghosts.MATCH_SEED).toBe(layout(matchH, 'BrMatch').at.seed);
    const eventC = brAll.find((src) => /SpawnSpecialObjectEventParameterized\((OBJ_EVENT_GFX_\w+),[\s\S]*?BR_EVENT_LOCAL_ID_BASE/.test(src))!;
    const gfx = /SpawnSpecialObjectEventParameterized\((OBJ_EVENT_GFX_\w+),[\s\S]*?BR_EVENT_LOCAL_ID_BASE/.exec(eventC)![1];
    expect(ghosts.GFX_TRADER).toBe(define(eventObjectsH, gfx));
    // The trader's key is the one past every piece's.
    expect(EVENT_PIECES).toBeLessThan(15);
    expect(traderKey(2)).toBe(define(eventH, 'BR_EVENT_KEY_BASE') | (2 << 4) | 15);
  });

  it("a gift-giver's key is br_loot.h's, past every event's, and his gifts are items.h's", () => {
    expect(GIFT_KEY_BASE).toBe(define(lootH, 'BR_LOOT_KEY_GIFT_BASE'));
    expect(GIFT_KEY_BASE).toBeGreaterThan(EVENT_KEY_BASE | ((EVENT_MAX - 1) << 4) | 15);
    const list = /enum\s*\{([\s\S]*?)\};/.exec(itemsH)![1].replace(/\/\/.*$/gm, '');
    const ids = list.split(',').map((s) => s.trim()).filter(Boolean);
    expect(GIFTS).toEqual(
      ['BRIGHT_POWDER', 'WHITE_HERB', 'QUICK_CLAW', 'CHOICE_BAND', 'KINGS_ROCK', 'FOCUS_BAND', 'SCOPE_LENS', 'LEFTOVERS', 'SHELL_BELL'].map((n) => ids.indexOf(`ITEM_${n}`)),
    );
  });

  it("a story's people and doors are br_story.c's sPeople and sDoors", () => {
    const storyC = brSources['../../src/br/br_story.c'];
    const list = /enum\s*\{([\s\S]*?)\};/.exec(itemsH)![1].replace(/\/\/.*$/gm, '');
    const ids = list.split(',').map((s) => s.trim()).filter(Boolean);
    const people = [
      ...storyC.matchAll(/\{MAP_GROUP\((MAP_\w+)\),\s*MAP_NUM\(\1\),\s*(\d+),\s*(\d+),\s*(OBJ_EVENT_GFX_\w+),\s*(ITEM_\w+),\s*(TRAINER_\w+),/g),
    ].map((m) => ({
      map: m[1],
      x: Number(m[2]),
      y: Number(m[3]),
      gfx: m[4],
      wants: m[5] === 'ITEM_NONE' ? undefined : ids.indexOf(m[5]),
      trainer: m[6] === 'TRAINER_NONE' ? undefined : m[6],
    }));
    const pages = STORIES.flatMap((s) =>
      (s.people ?? []).map((p) => ({ map: s.cells[p.at].map ?? s.map, x: s.cells[p.at].x, y: s.cells[p.at].y, gfx: p.gfx, wants: p.wants, trainer: p.trainer })),
    );
    expect(people.length).toBeGreaterThan(0);
    expect(people).toEqual(pages);
    const rule = { BR_DOOR_SMASH: 'smash', BR_DOOR_FLY: 'fly', BR_DOOR_WAIT: 'wait' } as Record<string, string>;
    const doors = [...storyC.matchAll(/\{FLAG_\w+,\s*MAP_GROUP\((MAP_\w+)\),\s*MAP_NUM\(\1\),\s*(BR_DOOR_\w+)\}/g)].map((m) => ({ map: m[1], door: rule[m[2]] }));
    const byMap = (a: { map: string }, b: { map: string }) => a.map.localeCompare(b.map);
    expect(doors.sort(byMap)).toEqual(STORIES.filter((s) => s.door).map((s) => ({ map: s.map, door: s.door })).sort(byMap));
    expect(define(storyC, 'BR_DOOR_Y')).toBe(DOOR_Y);
  });

  it("a gate boss's team, which a bot fights for his piece, is trainer_parties.h's", () => {
    const bosses = STORIES.flatMap((s) => s.people ?? []).filter((p) => p.trainer !== undefined);
    expect(bosses.length).toBeGreaterThan(0);
    for (const boss of bosses) {
      const party = new RegExp(`\\[${boss.trainer}\\]\\s*=\\s*\\{[\\s\\S]*?\\.party\\s*=\\s*\\w+\\((sParty_\\w+)\\)`).exec(trainersH)![1];
      const body = new RegExp(`${party}\\[\\]\\s*=\\s*\\{([\\s\\S]*?)\\n\\};`).exec(trainerPartiesH)![1];
      const species = [...body.matchAll(/\.species\s*=\s*(SPECIES_\w+)/g)].map((m) => define(speciesH, m[1]));
      expect(boss.party, boss.trainer).toEqual(species);
    }
  });

  it("ANCIENT TOMB's fliers are species_info.h's Flying-types", () => {
    const flying = [...speciesInfoH.matchAll(/\[(SPECIES_\w+)\]\s*=\s*\{[\s\S]*?\.types\s*=\s*\{([^}]*)\}/g)]
      .filter((m) => m[2].includes('TYPE_FLYING'))
      .map((m) => define(speciesH, m[1]));
    expect(flying.length).toBeGreaterThan(40);
    expect([...FLYING].sort((a, b) => a - b)).toEqual([...new Set(flying)].sort((a, b) => a - b));
  });

  it("an event's gold balls are sGold in br_balls.c, and its Pokemon are species.h's", () => {
    const list = /enum\s*\{([\s\S]*?)\};/.exec(itemsH)![1].replace(/\/\/.*$/gm, '');
    const ids = list.split(',').map((s) => s.trim()).filter(Boolean);
    const ballsC = brAll.find((src) => /\bsGold\[\]/.test(src))!;
    expect(GOLD).toEqual(names(ballsC, 'sGold', 'ITEM_').map((n) => ids.indexOf(n)));
    const species = (n: string) => define(speciesH, `SPECIES_${n}`);
    expect(LEGENDS).toEqual([
      ['REGIROCK', 'REGICE', 'REGISTEEL'].map(species),
      ['LATIAS', 'LATIOS'].map(species),
      ['KYOGRE', 'GROUDON'].map(species),
      ['RAYQUAZA'].map(species),
    ]);
    expect(RARES).toEqual(
      ['DRATINI', 'LARVITAR', 'LAPRAS', 'SCYTHER', 'AERODACTYL', 'EEVEE', 'RALTS', 'BAGON', 'BELDUM', 'ABSOL', 'FEEBAS'].map(species),
    );
  });

  it('seats, a ticker line, a peeked bag', () => {
    expect(MAX_SEATS).toBe(define(configH, 'BR_MAX_SEATS'));
    expect(MAX_SEAT).toBe(define(configH, 'BR_MAX_SEATS') - 1);
    expect(LINE_MAX).toBe(define(hudH, 'BR_HUD_LINE_MAX'));
    expect(PARTY_BAG_MAX).toBe(define(spectateC, 'BR_PEEK_BAG_MAX'));
  });

  it('ticker kinds and the page values of noCorner are br_hud.h\'s', () => {
    TICKER_KIND_ORDER.forEach((k, i) => expect(define(hudH, `BR_HUD_KIND_${k.toUpperCase()}`), k).toBe(i));
    expect([HUD_PAGE.SIGNS, HUD_PAGE.CORNER]).toEqual([define(hudH, 'BR_HUD_PAGE_SIGNS'), define(hudH, 'BR_HUD_PAGE_CORNER')]);
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
