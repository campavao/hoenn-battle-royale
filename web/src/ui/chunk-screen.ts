// A screen out of a lazily loaded chunk (POK-407, #105, #111): nothing until the chunk
// has it, then that screen, in full -- its look and its touches as well as its paint and
// keys, so a screen that sits over the game (FEEDBACK mid-match) still does.
import type { DrawnScreen, Look } from './stage';

export function chunkScreen<M>(
  ui: () => M | undefined,
  load: () => Promise<void>,
  make: (m: M) => DrawnScreen,
  /** Before it lands (or if it never does, a deploy having taken the old chunk away):
   *  B still goes back, and the look is the one the real screen will have. */
  waiting: { back: () => void; look?: () => Look },
): DrawnScreen {
  let real: DrawnScreen | undefined;
  const get = (): DrawnScreen | undefined => {
    const m = ui();
    if (!real && m) real = make(m);
    if (!real) void load();
    return real;
  };
  return {
    paint: (c, h) => get()?.paint(c, h) ?? { widgets: [] },
    back: () => {
      const screen = get();
      if (screen) screen.back?.();
      else waiting.back();
    },
    key: (k, on) => get()?.key?.(k, on) ?? false,
    char: (key) => get()?.char?.(key) ?? false,
    look: () => {
      const screen = get();
      return (screen ? screen.look?.() : waiting.look?.()) ?? 'full';
    },
    touched: () => get()?.touched?.(),
  };
}
