// E2E runs against a local `wrangler dev`, the same Worker that ships.
// Serial, no retries: a retry that passes on the second attempt is hiding a
// real bug (Pricey rule).
import { defineConfig, devices } from '@playwright/test';

const PORT = 8787;
// 32 bytes of 'A', base64. Development and E2E only; never a real key.
const DEV_CV_KEY = Buffer.alloc(32, 0x41).toString('base64');

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
    // Every request in the suite comes from one address, so the per-IP cap is
    // raised here — and only here — to keep the suite order-independent. The
    // per-email cap keeps its production value and is asserted in auth.spec.js.
    // TURNSTILE_SITE_KEY is blanked as well as bypassed: with a real key the
    // page tries to load a widget it cannot reach from a sandbox, and the
    // submit button correctly waits forever for a token — the same lockout
    // that hit the live site. A test environment with no shield should look
    // like one to the client as well as the server.
    // CV_MASTER_KEY is a Worker secret in production and has no counterpart in
    // wrangler.jsonc, so local dev has none and every upload would fail closed
    // with "storage unavailable" — correctly, and uselessly for a test. This
    // is a fixed, obviously-fake development key: 32 bytes of 'A'. A unit test
    // forbids it from ever appearing in wrangler.jsonc.
    command: `npx wrangler dev --port ${PORT} --ip 127.0.0.1`
      + ' --var OTP_ECHO:1 --var TURNSTILE_BYPASS:1 --var OTP_MAX_PER_IP_HOUR:500'
      + ' --var TURNSTILE_SITE_KEY:'
      + ` --var CV_MASTER_KEY:${DEV_CV_KEY}`,
    url: `http://127.0.0.1:${PORT}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
