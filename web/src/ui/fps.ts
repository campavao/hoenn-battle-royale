// The dev readout in the corner: frames a second, and how many frame listeners have
// thrown (POK-331 #29).
//
// The emulator catches a listener that throws and skips it from then on (emu/index.ts),
// so the frame carries on and the page looks fine while a piece of it -- the mailbox
// pump, the field painter, a bot loop -- has quietly stopped. The console had it; the
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

  /** The line: frames a second since the last read, and every listener that has thrown
   *  so far -- they stay stopped, so the count stays up. */
  read(): string {
    const now = this.now();
    const fps = (this.frames * 1000) / Math.max(1, now - this.since);
    this.frames = 0;
    this.since = now;
    const threw = this.errors === 0 ? '' : ` · ${this.errors} listener${this.errors === 1 ? '' : 's'} threw`;
    return `${fps.toFixed(0)} fps${threw}`;
  }
}
