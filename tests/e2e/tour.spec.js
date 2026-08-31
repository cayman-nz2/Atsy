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

      // The results screen, with a real scan behind it. A screen the reviewer
      // cannot see is a screen nobody has checked.
      await page.setInputFiles('#file', {
        name: 'priya-raman-cv.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.from(fixture('twoColumn')),
      });
      await page.getByRole('button', { name: 'Scan this CV' }).click();
      await expect(page.locator('#screen-result')).toBeVisible();
      await unstick(page);
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: `screenshots/scan-result-phone-430-${theme}.png`, fullPage: true });

      // And the same screen with its folds open, which is where the machine
      // view lives — the part of the product the landing page promises.
      for (const fold of await page.locator('#screen-result .fold').all()) {
        await fold.evaluate((node) => { node.open = true; });
      }
      // One of those folds is the X-ray, which fetches PDF.js and renders a
      // page. Screenshotting before it lands captures an empty frame and the
      // review passes on a picture of nothing.
      await expect(page.locator('#xray-stage')).toHaveAttribute('data-rendered', '1',
        { timeout: 30_000 });
      await page.screenshot({ path: `screenshots/scan-folds-phone-430-${theme}.png`, fullPage: true });

      // The X-ray on its own, close enough to read: this is the one screen
      // where a mark being a few points out is visible and nothing else would
      // show it.
      await page.locator('#xray-fold').scrollIntoViewIfNeeded();
      await page.locator('#xray-fold').screenshot({
        path: `screenshots/xray-phone-430-${theme}.png`,
      });

      // Role Fit, with a real job description behind it.
      await page.locator('#jd').fill([
        'Operations Manager',
        'We need an Operations Manager for our Auckland depot network.',
        '',
        'Requirements:',
        '- 5+ years managing warehouse or dispatch operations',
        '- Strong SQL and Power BI for reporting',
        '- Lean and continuous improvement experience',
        '',
        'Nice to have:',
        '- Kubernetes',
        '- Salesforce',
      ].join('\n'));
      await page.getByRole('button', { name: 'Score the match' }).click();
      await expect(page.locator('#match-result')).toBeVisible();
      await page.locator('#form-match').locator('..').screenshot({
        path: `screenshots/role-fit-phone-430-${theme}.png`,
      });

      // A rewrite suggestion, degraded to deterministic guidance because the
      // tour runs with no AI binding — which is the path most readers hit once
      // the daily budget is spent, so it is the one worth looking at.
      const rewrite = page.locator('#fix-list li').filter({ hasText: 'Suggest a rewrite' }).first();
      if (await rewrite.count()) {
        await rewrite.getByRole('button', { name: 'Suggest a rewrite' }).click();
        await expect(rewrite.locator('.rewritebox').first()).toBeVisible();
        await rewrite.screenshot({ path: `screenshots/rewrite-phone-430-${theme}.png` });
      }
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
