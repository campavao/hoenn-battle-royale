import { defineConfig, type Plugin } from 'vite';
import { resolve } from 'node:path';
import { readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

// The threaded mGBA core needs SharedArrayBuffer, which needs cross-origin
// isolation. These two headers are the whole requirement; vercel.json sets the
// same ones in production.
const isolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

// public/ is copied into dist/ verbatim, and tools/br/dev-patch.sh leaves a full,
// patched, copyrighted Emerald in public/patch/ so the dev shell can skip the file
// picker. app.ts only ever fetches that file under import.meta.env.DEV and says so in
// its own comment -- "nothing ships this file" -- but nothing enforced it, and one
// `vite build` was all it would have taken. The ROM lives on the player's device.
//
// Dropped rather than refused, because a local build for `vite preview` is an ordinary
// thing to do and the e2e's own ROM comes from the repo root through /@fs/, not from
// here. scripts/no-rom.mjs then asserts the result, so the rule holds even if this
// plugin is ever removed.
function dropRoms(): Plugin {
  const banned = /\.(gba|sav|ss[0-9])$/i;

  return {
    name: 'br-drop-roms',
    apply: 'build',
    closeBundle() {
      const out = resolve(__dirname, 'dist');
      const walk = (dir: string): void => {
        for (const name of readdirSync(dir)) {
          const path = join(dir, name);
          if (statSync(path).isDirectory()) walk(path);
          else if (banned.test(name)) {
            rmSync(path);
            this.warn(`left the ROM out of the build: ${name}`);
          }
        }
      };
      try {
        walk(out);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      }
    },
  };
}

export default defineConfig({
  plugins: [dropRoms()],
  server: {
    headers: isolation,
    host: true,
    fs: { allow: [".", "C:/Users/cam95/Documents/Github"] },
  },
  preview: { headers: isolation, host: true },
  build: {
    target: "es2022",
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        spike: resolve(__dirname, "spike/index.html"),
      },
    },
    outDir: "dist", // Forces Vite to output to the "dist" folder
  },
  // mgba.js spawns its pthread workers from its own URL; leave it unbundled.
  optimizeDeps: { exclude: ["/emu/mgba.js"] },
});
