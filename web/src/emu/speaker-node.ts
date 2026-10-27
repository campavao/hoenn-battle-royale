// The page's side of the core's speaker (HBR-59): an AudioContext, the worklet that reads
// the core's sound ring (speaker-worklet.ts), and the ticks it sends back for the audio
// meter. The main thread only sets it up, pauses it and hears ticks: no sound passes
// through it, so a busy page no longer makes the speaker crackle.

import workletUrl from './speaker-worklet.ts?worker&url';
import type { SpeakerMessage } from './speaker-worklet';
import type { SpeakerTick } from './speaker';

/** What the speaker needs of the core. */
export interface SpeakerCore {
  _brAudioWorkletAt?(rate: number): number;
  HEAPU8: Uint8Array;
}

/** With the context running and a game unpaused, this long with no sound out of the
 *  ring is a speaker that will not play: say so (the audio meter's `starved`). */
const STARVED_MS = 2000;

export class Speaker {
  private listeners = new Set<(tick: SpeakerTick) => void>();
  private paused = true;
  /** When the ring last had sound, or the speaker last unpaused. */
  private soundAt = 0;
  /** When the worklet last ticked: one whose process() never runs sends none at all. */
  private tickAt = 0;
  /** No sound for STARVED_MS while it should have had some: warned once. */
  starved = false;

  private constructor(
    readonly context: AudioContext,
    private readonly node: AudioWorkletNode,
  ) {
    // Ticks stop while a context is suspended: the wait for sound starts when it runs.
    context.addEventListener('statechange', () => {
      if (context.state === 'running') this.soundAt = this.tickAt = performance.now();
    });
    node.port.onmessage = (e: MessageEvent<SpeakerTick>) => {
      const now = performance.now();
      this.tickAt = now;
      if (e.data.played > 0) this.soundAt = now;
      else this.checkStarved(now - this.soundAt);
      for (const l of this.listeners) l(e.data);
    };
    // No tick at all is no sound too, and nothing else would say so.
    setInterval(() => {
      if (this.checkStarved(performance.now() - this.tickAt)) {
        const silent: SpeakerTick = { frames: 0, played: 0, late: false, cut: false, skipped: 0, heard: false, dropped: 0 };
        for (const l of this.listeners) l(silent);
      }
    }, 1000);
  }

  /** Whether `quietMs` without sound, now, made the speaker starved (once). */
  private checkStarved(quietMs: number): boolean {
    if (this.paused || this.starved || this.context.state !== 'running' || quietMs <= STARVED_MS) return false;
    this.starved = true;
    console.warn('hbr: the speaker has had no sound from the core for 2 s');
    return true;
  }

  /** The core's speaker on a worklet, or null where it cannot be: an older core, a
   *  browser without AudioWorklet, memory that is not shared, or a worklet that would not
   *  take it. Must run before the core's first loadGame. The core is told to leave SDL's
   *  audio closed only once the worklet holds the ring, so on any failure SDL plays. */
  static async open(core: SpeakerCore): Promise<Speaker | null> {
    if (!core._brAudioWorkletAt || typeof AudioWorkletNode === 'undefined') return null;
    const memory = core.HEAPU8.buffer;
    if (typeof SharedArrayBuffer === 'undefined' || !(memory instanceof SharedArrayBuffer)) return null;
    let context: AudioContext | null = null;
    try {
      context = new AudioContext({ latencyHint: 'interactive' });
      await context.audioWorklet.addModule(workletUrl);
      const node = new AudioWorkletNode(context, 'hbr-speaker', { numberOfInputs: 0, outputChannelCount: [2] });
      // The ring's address, with nothing switched yet (a rate of 0).
      node.port.postMessage({ memory, ring: core._brAudioWorkletAt(0) } satisfies SpeakerMessage);
      node.connect(context.destination);
      core._brAudioWorkletAt(context.sampleRate);
      const speaker = new Speaker(context, node);
      speaker.resumeOnGesture();
      return speaker;
    } catch (err) {
      console.warn('hbr: no AudioWorklet speaker, SDL plays instead', err);
      void context?.close().catch(() => {});
      return null;
    }
  }

  /** A browser starts an AudioContext suspended until the player touches the page, and
   *  iOS interrupts one for a call or another app's sound. */
  private resumeOnGesture(): void {
    const resume = () => {
      const state: string = this.context.state;
      if (state !== 'suspended' && state !== 'interrupted') return;
      void this.context.resume().catch(() => {});
    };
    for (const type of ['pointerdown', 'keydown', 'touchend'] as const) {
      document.addEventListener(type, resume, { capture: true, passive: true });
    }
    resume();
  }

  /** Paused, the worklet plays silence and counts nothing, and waits for a lead of sound
   *  again after. It starts paused: no game yet. */
  pause(paused: boolean): void {
    this.paused = paused;
    if (!paused) this.soundAt = this.tickAt = performance.now();
    this.node.port.postMessage({ paused } satisfies SpeakerMessage);
  }

  onTick(listener: (tick: SpeakerTick) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
