import { defineConfig, devices } from '@playwright/test';

// Browser tests of the landing and policy pages (web/). `pnpm test:web` builds them, serves dist/web
// with Vite's preview server (client-side routes fall back to index.html) and mocks the one auth
// call the header makes (web/e2e/fixtures.ts).
export default defineConfig({
  testDir: 'web/e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  // The preview servers are always started fresh: reusing whatever already listens on a port could
  // silently test another project's build (several BLEN servers use the same ports).
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'pnpm exec vite preview --config web/vite.config.ts --host 127.0.0.1 --port 4173 --strictPort',
      url: 'http://127.0.0.1:4173',
      reuseExistingServer: false,
    },
  ],
});
