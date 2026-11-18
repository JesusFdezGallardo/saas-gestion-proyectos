import { defineConfig, devices } from '@playwright/test';
import { ORIGIN, PORT } from './env';

export default defineConfig({
  testDir: './tests',
  // Every spec shares one seeded database and edits the same demo board: one file at a time.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: ORIGIN,
    trace: 'retain-on-failure',
    locale: 'es-ES',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1920, height: 1080 } },
    },
  ],
  webServer: {
    command: 'node scripts/serve.mjs',
    url: `http://localhost:${PORT}/api/health`,
    // Reuse only on purpose (E2E_REUSE=1, to debug against a running server).
    reuseExistingServer: process.env.E2E_REUSE === '1',
    timeout: 240_000,
    stdout: 'ignore',
    stderr: 'pipe',
    gracefulShutdown: { signal: 'SIGTERM', timeout: 5000 },
  },
});
