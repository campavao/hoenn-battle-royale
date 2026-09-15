import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

// Vitest's own default include (`**/*.{test,spec}.?(c|m)[jt]s?(x)`) matches the
// Playwright specs in web/e2e/ too -- exclude that directory explicitly so `npm test`
// never tries to run @playwright/test's `test()` calls as vitest tests (npm run e2e is
// its own runner, its own webServer, its own timeouts).
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      exclude: ['**/node_modules/**', '**/dist/**', 'e2e/**'],
    },
  }),
);
