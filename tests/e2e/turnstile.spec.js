// The bot check, exercised for real.
//
// The suite used to blank TURNSTILE_SITE_KEY so the client behaved as though no
// shield were configured. The reason given was that a sandbox cannot reach
// Cloudflare, and that with a key the submit button "correctly waits forever
// for a token — the same lockout that hit the live site". It was not correct
// and it was not the sandbox: the slot hid itself while empty, the renderer
// refused to render into a hidden element, and so the widget never appeared on
// the live sign-in page either. Blanking the key removed the only path that
// could have shown it.
//
// Cloudflare's script is stubbed instead. The network is unreachable either
// way; what matters is that the page's own logic hands a measurable element to
// whatever answers, and that is entirely testable offline.

import { test, expect } from '@playwright/test';

const SITE_KEY = '0xSTUBSITEKEYFORTESTSONLY';

// Stands in for challenges.cloudflare.com/turnstile/v0/api.js. It records the
// conditions it was called under — a real widget cannot report "you gave me a
// zero-sized box", it just silently never appears.
const STUB_API_JS = `
  window.__turnstile = { calls: [] };
  window.turnstile = {
    render: function (slot, options) {
      var box = slot.getBoundingClientRect();
      window.__turnstile.calls.push({
        slotId: slot.id,
        sitekey: options.sitekey,
        theme: options.theme,
        laidOut: slot.offsetParent !== null,
        width: box.width,
      });
      var widget = document.createElement('div');
      widget.className = 'stub-turnstile';
      widget.style.height = '65px';
      slot.appendChild(widget);
      setTimeout(function () { options.callback('stub-token'); }, 0);
      return 'widget-' + window.__turnstile.calls.length;
    },
    reset: function () {},
    remove: function () {},
  };
`;

async function stubTurnstile(page) {
  // Give the client a site key without changing the server the whole suite
  // shares: everything else in /api/config stays as the Worker sent it.
  await page.route('**/api/config', async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    await route.fulfill({ json: { ...body, turnstileSiteKey: SITE_KEY } });
  });
  await page.route('https://challenges.cloudflare.com/**', (route) => route.fulfill({
    status: 200, contentType: 'application/javascript', body: STUB_API_JS,
  }));
}

const address = (name) => `${name}-${Date.now()}@example.test`;

test.describe('the bot check', () => {
  test('is handed a slot it can measure, and lets the sign-in button go', async ({ page }) => {
    await stubTurnstile(page);
    await page.goto('/app');

    const submit = page.locator('#email-submit');
    // Until a token arrives the button is held disabled, reading "Checking your
    // browser…". Stuck on that is exactly what a reader reported.
    await expect(submit).toBeEnabled();
    await expect(submit).toHaveText('Email me a code');

    const calls = await page.evaluate(() => window.__turnstile.calls);
    expect(calls, 'the widget was never asked to render').toHaveLength(1);
    expect(calls[0].slotId).toBe('turnstile-slot');
    expect(calls[0].sitekey).toBe(SITE_KEY);
    expect(calls[0].laidOut, 'Turnstile was handed a slot that is display:none').toBe(true);
    expect(calls[0].width, 'the slot had no width to draw the widget in').toBeGreaterThan(0);
    // An explicit theme, always: the widget must not follow the phone into dark
    // mode inside a light card.
    expect(['light', 'dark']).toContain(calls[0].theme);

    // And the widget is actually on the page, not merely rendered into the void.
    await expect(page.locator('#turnstile-slot .stub-turnstile')).toBeVisible();
  });

  test('reaches the upload form too, once that screen is shown', async ({ page }) => {
    await stubTurnstile(page);
    await page.goto('/app');
    await expect(page.locator('#email-submit')).toBeEnabled();

    await page.getByLabel('Email address').fill(address('shield'));
    const codeRequest = page.waitForResponse((r) => r.url().includes('/api/auth/request-code'));
    await page.locator('#email-submit').click();
    const { debug_code: code } = await (await codeRequest).json();
    await page.getByLabel('Six-digit code').fill(code);

    // The account screen is hidden while the code screen is up, so its slot is
    // rendered only when the screen is shown — the case the screen check exists
    // for, and the one that must still hold now that it asks the screen.
    const upload = page.locator('#upload-submit');
    await expect(upload).toBeEnabled();
    await expect(page.locator('#upload-turnstile .stub-turnstile')).toBeVisible();

    const calls = await page.evaluate(() => window.__turnstile.calls);
    const slots = calls.map((call) => call.slotId);
    expect(slots).toContain('upload-turnstile');
    for (const call of calls) {
      expect(call.laidOut, `${call.slotId} was hidden when Turnstile was given it`).toBe(true);
    }
  });
});
