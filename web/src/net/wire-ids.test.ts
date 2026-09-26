// The wire table, and what tools/br/wire-ids.py made of it (POK-331 #21).
//
// The mailbox's message ids and reassembly caps are written once, in
// tools/br/wire-table.txt, and generated into the ROM's include/br/br_wire_ids.h and the
// page's wire-ids.ts. They used to be two hand copies held together by a comment. This
// reads the table and fails when either file no longer says what it does (re-run the
// script), and when the table's shape is not the one br_version.h pinned next to
// BR_PROTOCOL (bump the protocol).
import { describe, expect, it } from 'vitest';
import tableTxt from '../../../tools/br/wire-table.txt?raw';
import idsH from '../../../include/br/br_wire_ids.h?raw';
import wireH from '../../../include/br/br_wire.h?raw';
import versionH from '../../../include/br/br_version.h?raw';
import { BR_CAP, BR_MSG, WIRE_HASH } from './wire-ids';
import { BR_CONT_FLAG, BR_MSG as SLOTS_BR_MSG } from './slots';
import { PROTOCOL } from './wire';

interface Row {
  name: string;
  id: number;
  cap?: number;
}

/** The table's rows, as wire-ids.py reads them: `NAME ID [CAP] [# note]`. */
function rows(text: string): Row[] {
  const out: Row[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const m = /^([A-Z][A-Z0-9_]*)\s+(\d+)(?:\s+(\d+))?\s*(?:#.*)?$/.exec(line);
    if (!m) throw new Error(`wire-table.txt: not NAME ID [CAP] [# note]: ${line}`);
    out.push({ name: m[1], id: Number(m[2]), ...(m[3] === undefined ? {} : { cap: Number(m[3]) }) });
  }
  return out;
}

/** FNV-1a, 32 bits, over the rows by id, one `NAME ID` or `NAME ID CAP` line each. */
function hash(table: Row[]): number {
  const text = [...table]
    .sort((a, b) => a.id - b.id)
    .map((r) => (r.cap === undefined ? `${r.name} ${r.id}` : `${r.name} ${r.id} ${r.cap}`))
    .join('\n');
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return h;
}

/** `#define NAME <number>` lines, by name. */
function defines(src: string, prefix: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const m of src.matchAll(new RegExp(`^#define ${prefix}(\\w+)\\s+(0x[0-9a-fA-F]+|\\d+)\\b`, 'gm'))) out[m[1]] = Number(m[2]);
  return out;
}

const hex = (n: number) => `0x${n.toString(16).toUpperCase().padStart(8, '0')}`;

const TABLE = rows(tableTxt);
const IDS = Object.fromEntries(TABLE.map((r) => [r.name, r.id]));
const CAPS = Object.fromEntries(TABLE.filter((r) => r.cap !== undefined).map((r) => [r.name, r.cap]));
const HASH = hash(TABLE);

describe('the wire table (tools/br/wire-table.txt)', () => {
  it('names each message once, gives each its own id, and keeps them off the continuation bit', () => {
    expect(TABLE.length).toBeGreaterThan(30);
    expect(new Set(TABLE.map((r) => r.name)).size).toBe(TABLE.length);
    expect(new Set(TABLE.map((r) => r.id)).size).toBe(TABLE.length);
    for (const r of TABLE) expect(r.id & BR_CONT_FLAG, r.name).toBe(0);
    expect(IDS.NONE).toBe(0);
  });

  it('wire-ids.ts is what the script makes of it', () => {
    expect({ ...BR_MSG }).toEqual(IDS);
    expect({ ...BR_CAP }).toEqual(CAPS);
    expect(hex(WIRE_HASH), 're-run tools/br/wire-ids.py').toBe(hex(HASH));
    // slots.ts hands the same table on, rather than a copy of its own.
    expect(SLOTS_BR_MSG).toBe(BR_MSG);
  });

  it('br_wire_ids.h is what the script makes of it', () => {
    const ids = defines(idsH, 'BR_MSG_');
    expect(ids, 're-run tools/br/wire-ids.py').toEqual(IDS);
    expect(defines(idsH, 'BR_CAP_'), 're-run tools/br/wire-ids.py').toEqual(CAPS);
    const last = /^#define BR_MSG_LAST BR_MSG_(\w+)\s*$/m.exec(idsH)?.[1];
    expect(last && ids[last]).toBe(Math.max(...TABLE.map((r) => r.id)));
    expect(hex(defines(idsH, 'BR_').WIRE_HASH), 're-run tools/br/wire-ids.py').toBe(hex(HASH));
  });

  it('is the only place an id or a cap is written, and br_wire.h has every message\'s bytes', () => {
    // br_wire.h keeps the continuation bit and the dispatch table's width, and nothing
    // the table says.
    expect(Object.keys(defines(wireH, 'BR_MSG_')).sort()).toEqual(['CONT', 'COUNT']);
    expect(defines(wireH, 'BR_CAP_')).toEqual({});
    expect(wireH).toContain('#include "br/br_wire_ids.h"');
    for (const r of TABLE.filter((x) => x.name !== 'NONE')) expect(wireH, r.name).toMatch(new RegExp(`^// BR_MSG_${r.name}$`, 'm'));
  });

  it("its shape is the one pinned next to BR_PROTOCOL", () => {
    // A message added, retired or renumbered, or a cap moved, is a new protocol: a ROM
    // on the old table drops what it does not know, or cuts it short. br_wire.c's
    // STATIC_ASSERT fails the ROM's build on the same two numbers.
    const pinned = defines(versionH, 'BR_').PROTOCOL_WIRE_HASH;
    const protocol = defines(versionH, 'BR_').PROTOCOL;
    expect(
      hex(HASH),
      `the wire table changed shape: bump BR_PROTOCOL past ${protocol} (and wire.ts's PROTOCOL), and pin BR_PROTOCOL_WIRE_HASH ${hex(HASH)} beside it in include/br/br_version.h`,
    ).toBe(hex(pinned));
    expect(PROTOCOL).toBe(protocol);
  });
});
