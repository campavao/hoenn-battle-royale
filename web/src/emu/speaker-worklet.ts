// The AudioWorklet that plays the core's sound (HBR-59): speaker.ts, on the audio thread.
// Loaded by Emulator (index.ts) with audioWorklet.addModule; Vite bundles it on its own.

import { CutDetector, RING_DROPPED, RING_FRAMES, RING_HEADER_U32, RingReader, TICK_QUANTA, type SpeakerTick } from './speaker';

// The worklet scope's own globals, which lib.dom does not declare.
declare const AudioWorkletProcessor: { prototype: { readonly port: MessagePort }; new (): { readonly port: MessagePort } };
declare function registerProcessor(name: string, ctor: unknown): void;

/** What the page sends: the module's memory and the ring's address once, then pauses. */
export type SpeakerMessage = { memory: SharedArrayBuffer; ring: number } | { paused: boolean };

class Speaker extends AudioWorkletProcessor {
  private reader: RingReader | null = null;
  private header: Uint32Array | null = null;
  /** Until the page says a game is running (Emulator.boot). */
  private paused = true;
  private readonly cuts = new CutDetector();
  private tick: SpeakerTick = Speaker.empty();
  private quanta = 0;

  constructor() {
    super();
    this.port.onmessage = (e: MessageEvent<SpeakerMessage>) => {
      const m = e.data;
      if ('memory' in m) {
        this.header = new Uint32Array(m.memory, m.ring, RING_HEADER_U32);
        this.reader = new RingReader(this.header, new Int16Array(m.memory, m.ring + RING_HEADER_U32 * 4, RING_FRAMES * 2));
      } else {
        this.paused = m.paused;
      }
    };
  }

  private static empty(): SpeakerTick {
    return { frames: 0, played: 0, late: false, cut: false, skipped: 0, heard: false, dropped: 0 };
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const out = outputs[0];
    if (!out?.length || !this.reader || !this.header) return true;
    const left = out[0];
    // Two channels, asked for in index.ts.
    const right = out[1] ?? out[0];
    const played = this.reader.play(left, right, this.paused);
    // Paused, the game makes no sound and nobody is listening for it.
    if (this.paused) return true;
    this.tick.frames += left.length;
    this.tick.played += played.frames;
    if (played.under) this.tick.late = true;
    this.tick.skipped += played.skipped;
    if (this.cuts.feed(left, right)) this.tick.cut = true;
    if (!this.tick.heard) for (let i = 0; i < left.length && !this.tick.heard; i++) this.tick.heard = left[i] !== 0 || right[i] !== 0;
    if (++this.quanta >= TICK_QUANTA) {
      this.tick.dropped = this.header[RING_DROPPED];
      this.port.postMessage(this.tick);
      this.tick = Speaker.empty();
      this.quanta = 0;
    }
    return true;
  }
}

registerProcessor('hbr-speaker', Speaker);
