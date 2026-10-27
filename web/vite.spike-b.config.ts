import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// Engine spike B (/spike-b/), built on its own after the game: as a second input of the
// main build it would pull the code it shares with the game out of main.js into a chunk
// both load. On its own it keeps its own copy and the game's build is untouched. It
// plays on the ROM the player picked on the game page (same origin, same storage).
export default defineConfig({
  base: '/spike-b/',
  root: resolve(__dirname, 'spike-b'),
  publicDir: false,
  build: {
    target: 'es2022',
    outDir: resolve(__dirname, 'dist/spike-b'),
    emptyOutDir: true,
  },
  optimizeDeps: { exclude: ['/emu/mgba.js'] },
});
