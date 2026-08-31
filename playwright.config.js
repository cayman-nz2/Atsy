// E2E runs against a local `wrangler dev`, the same Worker that ships.
// Serial, no retries: a retry that passes on the second attempt is hiding a
// real bug (Pricey rule).
import { defineConfig, devices } from '@playwright/test';

const PORT = 8787;

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  reporter: process.env.CI ? [['list']] : [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
    ...devices['Pixel 5'],
  },
  webServer: {
    // OTP_ECHO / TURNSTILE_BYPASS live here and ONLY here — never in wrangler.jsonc.
    command: `npx wrangler dev --port ${PORT} --ip 127.0.0.1 --var OTP_ECHO:1 --var TURNSTILE_BYPASS:1`,
    url: `http://127.0.0.1:${PORT}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
