// tools/br/wire-protocols.txt is append-only (POK-331 #21): a row, once committed, is the
// hash of the message table that protocol went out with, for good.
//
// wire-ids.test.ts holds the file's last row to the table and to BR_PROTOCOL, and
// br_wire.c's STATIC_ASSERT holds the ROM to the same. Neither can tell a new protocol
// from a new hash pasted over the old one under the same number: both leave the last row
// agreeing with everything. Only the file's history can, so this reads every version git
// has of it and fails when one of their rows is no longer here as it was.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { protocolRows, rowsChanged } from '../src/net/wire-protocols.testutil';

const repo = resolve(__dirname, '..', '..');
const PATH = 'tools/br/wire-protocols.txt';
const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
const hex = (n: number) => `0x${n.toString(16).toUpperCase().padStart(8, '0')}`;

describe('the protocol rows (tools/br/wire-protocols.txt)', () => {
  it('keep every row that was ever committed as it was', () => {
    // A shallow clone has no history to hold the rows to, so it is refused rather than
    // passed: CI's web job checks the whole history out (blobless).
    expect(git('rev-parse', '--is-shallow-repository').trim(), `${PATH}'s history is needed: fetch-depth 0`).toBe('false');
    const now = protocolRows(readFileSync(join(repo, PATH), 'utf8'));
    const shas = git('log', '--format=%H', '--', PATH).split('\n').filter(Boolean);
    expect(shas.length, `${PATH} has never been committed`).toBeGreaterThan(0);
    for (const sha of shas) {
      const changed = rowsChanged(protocolRows(git('show', `${sha}:${PATH}`)), now);
      expect(
        changed.map((r) => `${r.protocol} ${hex(r.hash)}`),
        `${PATH} had these rows at ${sha.slice(0, 9)}: a table that changes shape is a new row under the next protocol, never a new hash under an old one`,
      ).toEqual([]);
    }
  });

  it('count a row re-pinned in place, or dropped, as changed, and a row added as not', () => {
    const committed = protocolRows('1 0x777CC3AA\n2 0x0000BEEF\n');
    expect(rowsChanged(committed, protocolRows('1 0x777CC3AA\n2 0x0000BEEF\n3 0x12345678\n'))).toEqual([]);
    expect(rowsChanged(committed, protocolRows('1 0x777CC3AA\n2 0x12345678\n'))).toEqual([{ protocol: 2, hash: 0xbeef }]);
    expect(rowsChanged(committed, protocolRows('1 0x777CC3AA\n'))).toEqual([{ protocol: 2, hash: 0xbeef }]);
  });
});
