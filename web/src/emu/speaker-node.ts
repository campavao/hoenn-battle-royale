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

export class Speaker {
  private listeners = new Set<(tick: SpeakerTick) => void>();

  private constructor(
    readonly context: AudioContext,
    private readonly node: AudioWorkletNode,
  ) {
    node.port.onmessage = (e: MessageEvent<SpeakerTick>) => {
      for (const l of this.listeners) l(e.data);
    };
  }

  /** The core's speaker on a worklet, or null where it cannot be: an older core, a
   *  browser without AudioWorklet, or memory that is not shared. Must run before the
   *  core's first loadGame, which is when the core opens SDL's audio otherwise. */
  static async open(core: SpeakerCore): Promise<Speaker | null> {
    if (!core._brAudioWorkletAt || typeof AudioWorkletNode === 'undefined') return null;
    const memory = core.HEAPU8.buffer;
    if (typeof SharedArrayBuffer === 'undefined' || !(memory instanceof SharedArrayBuffer)) return null;
    let context: AudioContext;
    try {
      context = new AudioContext({ latencyHint: 'interactive' });
      await context.audioWorklet.addModule(workletUrl);
    } catch {
      return null;
    }
    const node = new AudioWorkletNode(context, 'hbr-speaker', { numberOfInputs: 0, outputChannelCount: [2] });
    node.connect(context.destination);
    const ring = core._brAudioWorkletAt(context.sampleRate);
    node.port.postMessage({ memory, ring } satisfies SpeakerMessage);
    const speaker = new Speaker(context, node);
    speaker.resumeOnGesture();
    return speaker;
  }

  /** A browser starts an AudioContext suspended until the player touches the page. */
  private resumeOnGesture(): void {
    const resume = () => {
      if (this.context.state !== 'suspended') return;
      void this.context.resume().catch(() => {});
    };
    for (const type of ['pointerdown', 'keydown', 'touchend'] as const) {
      document.addEventListener(type, resume, { capture: true, passive: true });
    }
    resume();
  }

  /** Paused, the worklet plays silence and counts nothing, and waits for a lead of sound
   *  again after. */
  pause(paused: boolean): void {
    this.node.port.postMessage({ paused } satisfies SpeakerMessage);
  }

  onTick(listener: (tick: SpeakerTick) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
