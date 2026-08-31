// Screenshot tour. Runs only with TOUR=1 (npm run tour, which rebuilds dist
// first — never invoke this spec directly, Pricey incident #30).
// It must show exactly what a user sees: real self-hosted fonts, settled
// layout, both themes, and the owner's device size.
import { test } from '@playwright/test';
import { mkdirSync } from 'node:fs';

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
