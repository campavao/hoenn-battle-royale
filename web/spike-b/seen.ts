// A newcomer's way in, counted (Cam, 11-21: "improve conversion to people playing the
// game"; there were no numbers to tell what helps). Each step goes to the relay's POST
// /seen once per browser: the menu before a ROM, a tile pressed, a file turned away and
// why, the ROM taken, a first match. One word -- no id, no name -- so the relay logs
// `seen <step>` and play-log.mjs counts them by day for /play.html.
//
// Only a browser that came in by the menu before a ROM counts past it: somebody who had a
// ROM before this shipped is not a newcomer, and their first match since would read as one.
// Nothing is sent from a test (navigator.webdriver), a dev build, or a page whose player
// turned play stats off.
import { loadStats } from '../src/match/stats';

export type SeenStep = 'landing' | 'ask' | 'rom' | 'match' | `bad-${'archive' | 'size' | 'game' | 'changed'}`;

const KEY = 'hbr:seen:';

export interface SeenDeps {
  store: Pick<Storage, 'getItem' | 'setItem'>;
  send: (step: SeenStep) => void;
  /** A test or a dev build: count nothing. */
  quiet: boolean;
}

function defaults(): SeenDeps {
  return {
    store: localStorage,
    send: (step) => {
      try { navigator.sendBeacon(seenUrl(), new Blob([step], { type: 'text/plain' })); } catch { /* not counted */ }
    },
    quiet: import.meta.env.DEV || navigator.webdriver === true,
  };
}

/** The relay's /seen, from the same address the world's socket uses. */
export function seenUrl(relay = (import.meta.env.VITE_RELAY_URL as string | undefined) || DEFAULT_RELAY_URL): string {
  return `${relay.replace(/^ws/, 'http')}/seen`;
}

/** The live relay (main.ts connects its world socket here too). */
export const DEFAULT_RELAY_URL = 'wss://hoenn-relay-production.up.railway.app';

/** Reports `step` if this browser has not yet, and returns whether it did. */
export function seen(step: SeenStep, deps: SeenDeps = defaults()): boolean {
  try {
    if (deps.quiet) return false;
    if (deps.store.getItem(KEY + step)) return false;
    if (step !== 'landing' && !deps.store.getItem(KEY + 'landing')) return false;
    if (loadStats(deps.store).off) return false;
    deps.store.setItem(KEY + step, '1');
    deps.send(step);
    return true;
  } catch {
    return false; // storage refused: nothing counted, nothing broken
  }
}
