#ifndef GUARD_BR_WIRE_H
#define GUARD_BR_WIRE_H

// Message types on the mailbox rings. The page's web/src/net/wire.ts carries the same
// numbers; docs/WIRE.md is the table of record (POK-217). Keep them stable; add at
// the end; never reuse a retired number within a protocol version.

#define BR_MSG_NONE 0
// page -> ROM: payload echoed back as BR_MSG_ECHO. The bridge's heartbeat and the
// harness's first test.
#define BR_MSG_ECHO 1

#endif // GUARD_BR_WIRE_H
