import { defineConfig, devices } from '@playwright/test';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';

// web/package.json sets "type": "module", so this config loads as ESM -- no
// __dirname; import.meta.dirname is Node 20.11+/24's replacement.
const __dirname = import.meta.dirname;

// Fixed, out-of-the-way ports so this never fights a `npm run dev` (5173) or a real
// relay (7790) the developer already has open.
const RELAY_PORT = 7791;
const VITE_PORT = 5174;
// The built site, served the way it ships. The service worker registers only in a
// production build (POK-246), so offline behaviour cannot be tested against the dev
// server at all -- it needs this one.
const PREVIEW_PORT = 5175;

export default defineConfig({
  testDir: './e2e',
  globalSetup: resolve(__dirname, 'e2e/global-setup.ts'),
  outputDir: './test-results',
  timeout: 30_000,
  // One player's ROM has to boot before the other can join it; running specs in
  // parallel workers would mean two Chromium instances each trying to drive the same
  // ROM file and the same fixed-port relay/vite pair.
  fullyParallel: false,
  workers: 1,
  // Two mgba wasm/pthread cores with their own WebGL context, in one headless
  // Chromium, occasionally crash a renderer (a bare browserContext.close() failing
  // with "Failed to find context with id..." is the tell) -- and the guest/host room
  // in walk-and-see.spec.ts races the mod's own auto-match-start against the walk
  // (see that spec's comment). Both are environment-timing issues a plain rerun
  // recovers from; retry locally too, not just in CI.
  retries: 2,
  reporter: process.env.CI ? [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${VITE_PORT}`,
    trace: 'retain-on-failure',
    // Cross-origin isolation (SharedArrayBuffer) comes from the dev server's own
    // COOP/COEP headers (vite.config.ts), not a Chromium flag.
  },
  // One project per spec file, so every file gets a worker -- and a Chromium -- of its
  // own (POK-272). A worker is reused across files that share a project, and with one
  // worker the whole suite shared one browser for twenty-odd wasm-heavy tests, each
  // leaking a little (a renderer that crashed mid-close keeps its core). Projects run in
  // order, one at a time, so nothing fights over the ROM file or the fixed ports; a
  // fresh browser costs about a second a file.
  //
  // For the record: walk-and-see's "3/3 in a full run, first try alone" was NOT this.
  // It was the opening dealing the host and the guest into different Safari areas five
  // times in six (see the seed pinned in that spec), and a fresh browser per file did
  // not change that by itself.
  projects: readdirSync(resolve(__dirname, 'e2e'))
    .filter((f) => f.endsWith('.spec.ts'))
    .sort()
    .map((f) => ({ name: f.replace(/\.spec\.ts$/, ''), testMatch: f, use: { ...devices['Desktop Chrome'] } })),
  webServer: [
    {
      command: `node ../relay/server.js`,
      cwd: __dirname,
      env: { PORT: String(RELAY_PORT) },
      port: RELAY_PORT,
      reuseExistingServer: !process.env.CI,
      timeout: 15_000,
    },
    {
      // `vite preview` serves dist/ with the same COOP/COEP headers production sends,
      // and builds first so what it serves is this checkout rather than whatever was
      // last built. The build is about half a second.
      command: `npx vite build && npx vite preview --port ${PREVIEW_PORT} --strictPort`,
      cwd: __dirname,
      port: PREVIEW_PORT,
      reuseExistingServer: true,
      timeout: 60_000,
    },
    {
      command: `npx vite --port ${VITE_PORT} --strictPort`,
      cwd: __dirname,
      env: { VITE_RELAY_URL: `ws://localhost:${RELAY_PORT}` },
      port: VITE_PORT,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
  ],
});
