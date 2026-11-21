import { describe, expect, it } from 'vitest';
import { explainRom, unpackRom, zipEntries } from './romfile';

const MiB16 = 16 * 1024 * 1024;

async function pack(data: Uint8Array, format: 'deflate-raw' | 'gzip'): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream(format));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);

/** A 16 MiB "ROM" with a game code, its bytes not all alike so deflate has work to do. */
function rom(code = 'BPEE'): Uint8Array {
  const b = new Uint8Array(MiB16);
  for (let i = 0; i < 4096; i++) b[i * 4099] = i & 0xff;
  for (let i = 0; i < 4; i++) b[0xac + i] = code.charCodeAt(i);
  return b;
}

/** A one-or-more-file zip, the way a zip tool writes it. */
async function zip(files: { name: string; data: Uint8Array; store?: boolean }[]): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const name = new TextEncoder().encode(f.name);
    const packed = f.store ? f.data : await pack(f.data, 'deflate-raw');
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(8, f.store ? 0 : 8, true);
    local.setUint32(18, packed.length, true);
    local.setUint32(22, f.data.length, true);
    local.setUint16(26, name.length, true);
    const cen = new DataView(new ArrayBuffer(46));
    cen.setUint32(0, 0x02014b50, true);
    cen.setUint16(10, f.store ? 0 : 8, true);
    cen.setUint32(20, packed.length, true);
    cen.setUint32(24, f.data.length, true);
    cen.setUint16(28, name.length, true);
    cen.setUint32(42, offset, true);
    parts.push(new Uint8Array(local.buffer), name, packed);
    central.push(new Uint8Array(cen.buffer), name);
    offset += 30 + name.length + packed.length;
  }
  const cenSize = central.reduce((n, p) => n + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, cenSize, true);
  end.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of all) { out.set(p, at); at += p.length; }
  return out;
}

describe('the file a player picks (Cam, 11-21: conversion)', () => {
  it('takes a bare .gba as it is', async () => {
    const r = rom();
    const got = await unpackRom(r);
    expect(got.ok && got.bytes).toBe(r);
  });

  it('takes the .gba out of a zip, deflated or stored, past a readme', async () => {
    const r = rom();
    for (const store of [false, true]) {
      const z = await zip([{ name: 'readme.txt', data: new TextEncoder().encode('hi'), store }, { name: 'Pokemon - Emerald Version (USA, Europe).gba', data: r, store }]);
      expect(zipEntries(z).map((e) => e.name)).toHaveLength(2);
      const got = await unpackRom(z);
      expect(got.ok, `store ${store}`).toBe(true);
      if (got.ok) {
        expect(got.from).toMatch(/\.gba$/);
        expect(got.bytes.length).toBe(MiB16);
        expect(same(got.bytes, r)).toBe(true);
      }
    }
  });

  it('takes a .gz', async () => {
    const r = rom();
    const got = await unpackRom(await pack(r, 'gzip'));
    expect(got.ok && got.bytes.length).toBe(MiB16);
  });

  it('says what to do with a zip with no ROM in it, a .7z and a .rar', async () => {
    const none = await unpackRom(await zip([{ name: 'a.txt', data: new Uint8Array(10) }, { name: 'b.txt', data: new Uint8Array(10) }]));
    expect(!none.ok && none.reason).toMatch(/no 16 MiB \.gba/);
    const sevenZ = await unpackRom(new Uint8Array([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c, 0, 0]));
    expect(!sevenZ.ok && sevenZ.reason).toMatch(/\.7z/);
    const rar = await unpackRom(new Uint8Array([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07]));
    expect(!rar.ok && rar.reason).toMatch(/\.rar/);
  });

  it('explains a no in words a player can act on', () => {
    const no = { ok: false, sha1: '' };
    expect(explainRom(new Uint8Array(8 * 1024 * 1024), no)).toMatch(/8\.0 MiB.*exactly 16 MiB/);
    expect(explainRom(rom('BPRE'), no)).toBe("That's Pokemon FireRed. This plays on Pokemon Emerald (US).");
    expect(explainRom(rom('BPED'), no)).toMatch(/German Emerald.*US\/English/);
    expect(explainRom(rom('ABCD'), no)).toMatch(/isn't Pokemon Emerald/);
    expect(explainRom(rom(), no)).toMatch(/changed copy/);
  });
});
