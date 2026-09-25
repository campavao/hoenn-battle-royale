// net/netlink.ts reads gBrNetlink at offsets and leans on br_netlink.c's watchdog to close
// a quiet fight (POK-331 #3, #5). Nothing compiles on both sides, so this reads the C.
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

/** The body of one C function. */
function fn(src: string, name: string): string {
  const start = new RegExp(`^(?:static )?\\w+ ${name}\\(void\\)\\s*\\n\\{`, 'm').exec(src);
  if (!start) throw new Error(`no ${name}`);
  const end = src.indexOf('\n}\n', start.index);
  return src.slice(start.index, end);
}

describe('gBrNetlink, as the page reads and writes it', () => {
  it('sits where br_netlink.h says', () => {
    const at = offsets(netlinkH, 'BrNetlink');
    expect([at.active, at.peerSeat, at.blocksRecv, at.silent]).toEqual([
      NETLINK.OFF_ACTIVE,
      NETLINK.OFF_PEER_SEAT,
      NETLINK.OFF_BLOCKS_RECV,
      NETLINK.OFF_SILENT,
    ]);
  });

  it('is written into the state TickWatchdog closes a link in', () => {
    const hello = /#define BR_NETLINK_HELLO\s+\(?\s*(\d+)\s*\*\s*(\d+)\s*\)?/.exec(netlinkC);
    expect(hello, 'BR_NETLINK_HELLO').not.toBeNull();
    expect(NETLINK.HELLO_FRAMES).toBe(Number(hello![1]) * Number(hello![2]));
    // closeAsSilent zeroes blocksRecv and sets silent to HELLO: the watchdog must still
    // stand down only on a block heard, count silent up to HELLO, and then forfeit.
    const body = fn(netlinkC, 'TickWatchdog');
    const steps = [
      /if \(gBrNetlink\.blocksRecv != 0 \|\| gBrNetlink\.loopback\)/,
      /if \(\+\+gBrNetlink\.silent < BR_NETLINK_HELLO\)\s*return;/,
      /gBattleOutcome = B_OUTCOME_FORFEITED;/,
      /Abandon\(\);/,
    ];
    let from = 0;
    for (const step of steps) {
      const m = step.exec(body.slice(from));
      expect(m, `TickWatchdog: ${step}`).not.toBeNull();
      from += m!.index + m![0].length;
    }
  });

  it('is what HandleChallenge ignores a challenge on', () => {
    expect(netlinkC).toMatch(/static void HandleChallenge[\s\S]*?if \(n < 4 \|\| gBrNetlink\.active\)\s*return;/);
  });
});
