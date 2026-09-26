// The dev readout in the corner: frames a second, and how many frame listeners have
// thrown (POK-331 #29).
//
// The emulator catches a listener that throws, so the frame carries on, and reports only
// its first throw (emu/index.ts): the listener is still called every frame, and may fail
// every frame, while the page looks fine and a piece of it -- the mailbox pump, the field
// painter, a bot loop -- quietly does nothing. The console had the first throw; the
// readout says so where somebody trying the page is already looking.

/** What the meter needs of the emulator. */
export interface Metered {
  onFrame(listener: () => void): () => void;
  onListenerError(listener: (err: unknown) => void): () => void;
}

export class FrameMeter {
  private frames = 0;
  private errors = 0;
  private since: number;

  constructor(
    emu: Metered,
    private readonly now: () => number = () => performance.now(),
    /** Hearing the errors takes them off the console, which is where the emulator puts
     *  them with nobody listening: so they go back there as well. */
    log: (err: unknown) => void = (err) => console.error('[emu] a frame listener threw; the frame carries on without it', err),
  ) {
    this.since = now();
    emu.onFrame(() => this.frames++);
    emu.onListenerError((err) => {
      this.errors++;
      log(err);
    });
  }

  /** The line: frames a second since the last read, and how many listeners have thrown
   *  so far -- each counted once, at its first throw, since that is all the emulator
   *  reports. Listeners that have thrown, not ones that stopped: they are still called. */
  read(): string {
    const now = this.now();
    const fps = (this.frames * 1000) / Math.max(1, now - this.since);
    this.frames = 0;
    this.since = now;
    const threw = this.errors === 0 ? '' : ` · ${this.errors} listener${this.errors === 1 ? '' : 's'} threw`;
    return `${fps.toFixed(0)} fps${threw}`;
  }
}
