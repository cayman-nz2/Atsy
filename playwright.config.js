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
    // TURNSTILE_SITE_KEY is blanked as well as bypassed, so a test environment
    // with no shield looks like one to the client as well as the server, and
    // the rest of the suite never waits on a widget.
    // This comment used to add that with a real key the button "correctly waits
    // forever for a token — the same lockout that hit the live site", and
    // treated that as a sandbox limitation. It was not: the slot hid itself
    // while empty and the renderer refused to render into a hidden element, so
    // the widget never appeared in production either. Blanking the key here
    // removed the only path that could have shown it, and the front door
    // shipped broken. tests/e2e/turnstile.spec.js now covers that path with a
    // stubbed api.js, which needs no network — never delete it in favour of
    // "the sandbox cannot reach Cloudflare".
    // CV_MASTER_KEY is a Worker secret in production and has no counterpart in
    // wrangler.jsonc, so local dev has none and every upload would fail closed
    // with "storage unavailable" — correctly, and uselessly for a test. This
    // is a fixed, obviously-fake development key: 32 bytes of 'A'. A unit test
    // forbids it from ever appearing in wrangler.jsonc.
    // --local disables remote bindings. Workers AI has no local simulation, so
    // without this the AI binding sends `wrangler dev` to Cloudflare for a
    // proxy session and the whole suite fails on a missing API token. Running
    // local is also what the suite should be testing: the product must work
    // completely with AI unavailable, and here it genuinely is.
    command: `npx wrangler dev --local --port ${PORT} --ip 127.0.0.1`
      + ' --var OTP_ECHO:1 --var TURNSTILE_BYPASS:1 --var OTP_MAX_PER_IP_HOUR:500'
      + ' --var TURNSTILE_SITE_KEY:'
      + ` --var CV_MASTER_KEY:${DEV_CV_KEY}`,
    url: `http://127.0.0.1:${PORT}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
