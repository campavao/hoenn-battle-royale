// tools/br/wire-protocols.txt, read the way tools/br/wire-ids.py reads it (POK-331 #21):
// every message table the wire protocol has had, one `PROTOCOL 0xHASH` row a protocol,
// oldest first, append-only. wire-ids.test.ts holds the last row to the table and to
// BR_PROTOCOL; web/scripts/wire-protocols.test.ts holds every committed row to what it
// was.

export type ProtocolRow = { protocol: number; hash: number };

/** The file's rows, in its order. `#` starts a comment. */
export function protocolRows(text: string): ProtocolRow[] {
  const out: ProtocolRow[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.split('#')[0].trim();
    if (!line) continue;
    const m = /^(\d+)\s+0x([0-9A-F]{8})$/.exec(line);
    if (!m) throw new Error(`wire-protocols.txt: not PROTOCOL 0xHASH: ${raw}`);
    out.push({ protocol: Number(m[1]), hash: parseInt(m[2], 16) });
  }
  return out;
}

/** The rows of `committed` that `now` no longer has as they were: re-pinned, or gone. */
export function rowsChanged(committed: readonly ProtocolRow[], now: readonly ProtocolRow[]): ProtocolRow[] {
  const byProtocol = new Map(now.map((r) => [r.protocol, r.hash]));
  return committed.filter((r) => byProtocol.get(r.protocol) !== r.hash);
}
