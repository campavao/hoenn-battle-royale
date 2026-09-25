// Test-only fakes for the page's two ends of the wire (POK-330 #42): a relay socket and
// an emulator whose RAM is a plain array, so a test can run a Bridge -- and whatever the
// page hangs off one -- with no network and no core. Moved out of bridge.test.ts so the
// match's own tests can wire a Bridge the way app.ts does. The app never imports this.
import type { EmulatorLike } from './bridge';
import { MAILBOX, type RamAccess } from './mailbox';
import { packSlot, type BinarySlot } from './slots';
import { PROTOCOL, type Msg } from './wire';
import { RelayClient, type WebSocketLike } from './relay';

// ---- a fake WebSocket, so RelayClient needs no network (mirrors relay.test.ts) ----

export class FakeSocket implements WebSocketLike {
  readyState = 1; // OPEN from the start -- these tests drive the bridge, not reconnect
  onopen: ((ev: unknown) => void) | null = null;
  onclose: ((ev: unknown) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  sent: Record<string, unknown>[] = [];

  send(data: string): void {
    this.sent.push(JSON.parse(data));
  }
  close(): void {
    this.readyState = 3;
  }
  receive(msg: Record<string, unknown>): void {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
}

export function fakeRelay(): { relay: RelayClient; socket: FakeSocket } {
  let socket!: FakeSocket;
  const relay = new RelayClient((url) => {
    socket = new FakeSocket();
    return socket;
  });
  relay.connect('ws://relay.test');
  return { relay, socket };
}

// ---- a fake emulator: RamAccess over a plain Uint8Array, plus a manual frame() ----

export function fakeEmulator(base: number) {
  const mem = new Uint8Array(0x40000);
  const at = (addr: number) => addr - 0x02000000;
  const ram: RamAccess = {
    read: (addr, width) => {
      let v = 0;
      for (let i = width / 8 - 1; i >= 0; i--) v = (v << 8) | mem[at(addr) + i];
      return v >>> 0;
    },
    write: (addr, value, width) => {
      for (let i = 0; i < width / 8; i++) mem[at(addr) + i] = (value >>> (8 * i)) & 0xff;
    },
    bytes: (addr, len) => mem.subarray(at(addr), at(addr) + len),
  };
  let listeners: (() => void)[] = [];
  const emu: EmulatorLike = {
    ...ram,
    onFrame(l: () => void) {
      listeners.push(l);
      return () => {
        listeners = listeners.filter((x) => x !== l);
      };
    },
  };

  const romInit = () => {
    ram.write(base + MAILBOX.OFF_PROTOCOL, PROTOCOL, 16);
    ram.write(base + MAILBOX.OFF_PATCH, 1, 16);
    ram.write(base + MAILBOX.OFF_SIZE, MAILBOX.SIZE, 16);
    ram.write(base + MAILBOX.OFF_MAGIC, MAILBOX.MAGIC, 16);
  };

  // As if the ROM's own BrNet had produced this message into the out-ring.
  const romEmit = (msg: Msg): void => {
    for (const slot of packSlot(msg)) {
      const head = ram.read(base + MAILBOX.OFF_OUT_HEAD, 16);
      const tail = ram.read(base + MAILBOX.OFF_OUT_TAIL, 16);
      if (((head - tail) & 0xffff) >= MAILBOX.RING_SLOTS) throw new Error('out ring full in test setup');
      const addr = base + MAILBOX.OFF_OUT + (head % MAILBOX.RING_SLOTS) * MAILBOX.SLOT_BYTES;
      ram.write(addr, slot.type, 8);
      ram.write(addr + 1, slot.payload.length, 8);
      ram.bytes(addr + 2, slot.payload.length).set(slot.payload);
      ram.write(base + MAILBOX.OFF_OUT_HEAD, (head + 1) & 0xffff, 16);
    }
  };

  // As if the ROM had drained up to `budget` slots off the in-ring.
  const romDrainIn = (budget: number = MAILBOX.RING_SLOTS): BinarySlot[] => {
    const out: BinarySlot[] = [];
    let tail = ram.read(base + MAILBOX.OFF_IN_TAIL, 16);
    const head = ram.read(base + MAILBOX.OFF_IN_HEAD, 16);
    while (tail !== head && budget-- > 0) {
      const addr = base + MAILBOX.OFF_IN + (tail % MAILBOX.RING_SLOTS) * MAILBOX.SLOT_BYTES;
      const type = ram.read(addr, 8);
      const len = ram.read(addr + 1, 8);
      out.push({ type, payload: ram.bytes(addr + 2, len).slice() });
      tail = (tail + 1) & 0xffff;
      ram.write(base + MAILBOX.OFF_IN_TAIL, tail, 16);
    }
    return out;
  };

  const frame = () => {
    for (const l of listeners.slice()) l();
  };

  return { emu, frame, romInit, romEmit, romDrainIn, ram };
}

/** A Storage that forgets when the test does: what the career and the saved rounds are
 *  written to in place of localStorage, which vitest's node has none of. */
export function memoryStore(): Pick<Storage, 'getItem' | 'setItem'> {
  const kept = new Map<string, string>();
  return {
    getItem: (key) => kept.get(key) ?? null,
    setItem: (key, value) => {
      kept.set(key, String(value));
    },
  };
}
