// tools/br/build-sim.mjs's output, typed only as far as battlesim.ts reads it. Showdown's own types
// are thousands of lines of what a Gen 3 fight never touches.
/* eslint-disable @typescript-eslint/no-explicit-any */
export const Battle: new (options: any) => any;
export const Dex: any;
export function toID(text: unknown): string;
/** Gen 3's level-up learnsets: species id to level, move number, level, move number... */
export const LEVEL_UP: Record<string, number[]>;
