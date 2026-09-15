import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// The threaded mGBA core needs SharedArrayBuffer, which needs cross-origin
// isolation. These two headers are the whole requirement; vercel.json sets the
// same ones in production.
const isolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

export default defineConfig({
  server: { headers: isolation, host: true },
  preview: { headers: isolation, host: true },
  build: {
    target: 'es2022',
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        spike: resolve(__dirname, 'spike/index.html'),
      },
    },
  },
  // mgba.js spawns its pthread workers from its own URL; leave it unbundled.
  optimizeDeps: { exclude: ['/spike/vendor/mgba.js'] },
});
