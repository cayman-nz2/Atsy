// Screenshot tour. Runs only with TOUR=1 (npm run tour, which rebuilds dist
// first — never invoke this spec directly, Pricey incident #30).
// It must show exactly what a user sees: real self-hosted fonts, settled
// layout, both themes, and the owner's device size.
import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { fixture } from '../fixtures/cvs.js';

// A full-page capture repaints sticky bars over whatever is scrolled under
// them, which is a rendering lie: reviewers cannot tell it from a real overlap
// (Pricey incident #35). Pin them to the top of the document for the capture.
// The page's own CSP forbids injected inline styles — as it should — so the
// rule goes into the existing same-origin stylesheet through the CSSOM.
async function unstick(page) {
  await page.evaluate(() => {
    const sheet = [...document.styleSheets].find((s) => (s.href || '').endsWith('/atsy.css'));
    sheet.insertRule('.nav { position: static; }', sheet.cssRules.length);
  });
}

const RUN = process.env.TOUR === '1';
const SIZES = [
  { name: 'phone-393', width: 393, height: 851 },
  { name: 'phone-430', width: 430, height: 932 },
  { name: 'desktop-1280', width: 1280, height: 900 },
];
const SCREENS = [
  { name: 'landing', path: '/' },
  { name: 'signin', path: '/app' },
  { name: 'about', path: '/about' },
  { name: 'privacy', path: '/privacy' },
  { name: 'not-found', path: '/no-such-page' },
];

test.describe('screenshot tour', () => {
  test.skip(!RUN, 'set TOUR=1 (npm run tour) to capture screenshots');

  for (const size of SIZES) {
    for (const theme of ['light', 'dark']) {
      for (const screen of SCREENS) {
        test(`${screen.name} · ${size.name} · ${theme}`, async ({ page }) => {
          mkdirSync('screenshots', { recursive: true });
          await page.setViewportSize({ width: size.width, height: size.height });
          await page.emulateMedia({ colorScheme: theme });
          await page.goto(screen.path);
          await unstick(page);
          await page.evaluate(() => document.fonts.ready);
          await page.screenshot({
            path: `screenshots/${screen.name}-${size.name}-${theme}.png`,
            fullPage: true,
          });
        });
      }
    }
  }

  // The screens behind the sign-in flow need driving, so they get their own
  // pass rather than being missed by the review.
  for (const theme of ['light', 'dark']) {
    test(`code and account screens · phone-430 · ${theme}`, async ({ page }) => {
      mkdirSync('screenshots', { recursive: true });
      await page.setViewportSize({ width: 430, height: 932 });
      await page.emulateMedia({ colorScheme: theme });
      await page.goto('/app');
      await unstick(page);

      await page.getByLabel('Email address').fill(`tour-${Date.now()}@example.test`);
      const codeRequest = page.waitForResponse((r) => r.url().includes('/api/auth/request-code'));
      await page.getByRole('button', { name: 'Email me a code' }).click();
      const { debug_code: code } = await (await codeRequest).json();
      await expect(page.getByRole('heading', { name: 'Enter your code' })).toBeVisible();
      await page.screenshot({ path: `screenshots/code-phone-430-${theme}.png`, fullPage: true });

      await page.getByLabel('Six-digit code').fill(code);
      await expect(page.getByRole('heading', { name: 'You are signed in' })).toBeVisible();
      await page.screenshot({ path: `screenshots/account-phone-430-${theme}.png`, fullPage: true });

      // The result card, with a real scan behind it. A screen the reviewer
      // cannot see is a screen nobody has checked.
      await page.setInputFiles('#file', {
        name: 'priya-raman-cv.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.from(fixture('twoColumn')),
      });
      await page.getByRole('button', { name: 'Scan this CV' }).click();
      await expect(page.locator('#card-read')).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: `screenshots/scan-result-phone-430-${theme}.png`, fullPage: true });
    });
  }

  test('machine view · phone-430 · light', async ({ page }) => {
    mkdirSync('screenshots', { recursive: true });
    await page.setViewportSize({ width: 430, height: 932 });
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('/');
    await unstick(page);
    await page.getByRole('button', { name: 'What the machine reads' }).click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: 'screenshots/machine-view-phone-430-light.png', fullPage: true });
  });
});
