// net/netlink.ts reads gBrNetlink at offsets (POK-331 #5). Nothing compiles on both
// sides, so this reads the C.
import { describe, expect, it } from 'vitest';
import netlinkH from '../../../include/br/br_netlink.h?raw';
import netlinkC from '../../../src/br/br_netlink.c?raw';
import { NETLINK } from './netlink';

/** The offset comments on one struct's fields, by name. */
function offsets(src: string, struct: string): Record<string, number> {
  const body = new RegExp(`struct ${struct}\\s*\\{([\\s\\S]*?)\\};`).exec(src)?.[1];
  if (!body) throw new Error(`no struct ${struct}`);
  const at: Record<string, number> = {};
  for (const m of body.matchAll(/\/\*\s*(\d+)\s*\*\/\s*\w+\s+(\w+)\s*;/g)) at[m[2]] = Number(m[1]);
  return at;
}

describe('gBrNetlink, as the page reads it', () => {
  it('sits where br_netlink.h says', () => {
    const at = offsets(netlinkH, 'BrNetlink');
    expect([at.active, at.peerSeat]).toEqual([NETLINK.OFF_ACTIVE, NETLINK.OFF_PEER_SEAT]);
  });

  it('is what HandleChallenge ignores a challenge on', () => {
    expect(netlinkC).toMatch(/static void HandleChallenge[\s\S]*?if \(n < 4 \|\| gBrNetlink\.active\)\s*return;/);
  });
});
