// The X-ray: the reader's own PDF drawn in their own browser with the findings
// marked on it.
//
// This is the one part of Atsy that depends on a renderer, a web worker, and a
// content policy all agreeing with each other. Every one of those fails
// silently — a blocked worker logs to a console nobody is reading and leaves a
// blank frame — so the assertions here are about pixels and positions, not
// about whether an element exists.

import { test, expect } from '@playwright/test';
import { fixture } from '../fixtures/cvs.js';

const address = (name) => `${name}-${Date.now()}@example.test`;

async function signIn(page, email) {
  await page.goto('/app');
  await page.getByLabel('Email address').fill(email);
  const codeRequest = page.waitForResponse((response) =>
    response.url().includes('/api/auth/request-code'));
  await page.getByRole('button', { name: 'Email me a code' }).click();
  const { debug_code: code } = await (await codeRequest).json();
  await page.getByLabel('Six-digit code').fill(code);
  await expect(page.getByRole('heading', { name: 'You are signed in' })).toBeVisible();
}

async function scan(page, name) {
  await page.setInputFiles('#file', {
    name: 'cv.pdf', mimeType: 'application/pdf', buffer: Buffer.from(fixture(name)),
  });
  await page.getByRole('button', { name: 'Scan this CV' }).click();
  await expect(page.locator('#screen-result')).toBeVisible();
  await expect(page.locator('#score-number')).not.toHaveText('—');
}

/**
 * Open the fold and wait for a page to actually be on the canvas.
 *
 * Waiting on the canvas element itself does not work: an untouched canvas is
 * 300x150, so "it has a size" is true before anything is drawn and every
 * assertion after it reads a blank frame. The renderer stamps the stage when a
 * page is genuinely on it.
 */
async function openXray(page) {
  await page.getByText('Your page, with the findings marked on it').click();
  await expect(page.locator('#xray-stage')).toHaveAttribute('data-rendered', '1',
    { timeout: 30_000 });
}

test.describe('the X-ray', () => {
  test('renders the reader\'s PDF and marks the findings on it', async ({ page }) => {
    // Anything the renderer or the policy refuses shows up here and nowhere
    // else: a blocked worker is a console error and an empty canvas.
    const problems = [];
    page.on('console', (message) => {
      if (message.type() === 'error') problems.push(message.text());
    });
    page.on('pageerror', (error) => problems.push(String(error)));

    await signIn(page, address('xray'));
    await scan(page, 'twoColumn');

    // Nothing is fetched and nothing is rendered until the reader asks: PDF.js
    // is 1.7 MB, and the rest of the screen must not wait for it.
    const requested = [];
    page.on('request', (request) => {
      if (request.url().includes('/vendor/pdfjs/')) requested.push(request.url());
    });
    await expect(page.locator('#xray-canvas')).toBeHidden();
    expect(requested, 'PDF.js was fetched before the fold was opened').toEqual([]);

    await openXray(page);
    expect(requested.some((url) => url.endsWith('/pdf.mjs')), 'the library was never fetched')
      .toBe(true);

    // The canvas has real content on it, not a white rectangle.
    const inked = await page.locator('#xray-canvas').evaluate((canvas) => {
      const pixels = canvas.getContext('2d')
        .getImageData(0, 0, canvas.width, canvas.height).data;
      let dark = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i] < 200 && pixels[i + 3] > 0) dark += 1;
      }
      return dark;
    });
    expect(inked, 'the canvas is blank — the PDF did not render').toBeGreaterThan(500);

    // A two-column CV has findings that carry geometry, so it must be marked.
    const marks = page.locator('#xray-marks .xmark');
    await expect(marks.first()).toBeVisible();
    expect(await marks.count()).toBeGreaterThan(0);

    expect(problems, `the page logged errors: ${problems.join(' | ')}`).toEqual([]);
  });

  test('every mark sits on the page it is drawn over', async ({ page }) => {
    // A mark outside the canvas points at nothing, and a zero-sized one cannot
    // be clicked. Both are what a coordinate-space mistake looks like.
    await signIn(page, address('xray-bounds'));
    await scan(page, 'twoColumn');
    await openXray(page);

    const stage = await page.locator('#xray-stage').boundingBox();
    const marks = page.locator('#xray-marks .xmark');
    const count = await marks.count();
    expect(count).toBeGreaterThan(0);

    for (let index = 0; index < count; index += 1) {
      const box = await marks.nth(index).boundingBox();
      expect(box.width, `mark ${index} has no width`).toBeGreaterThan(0);
      expect(box.height, `mark ${index} has no height`).toBeGreaterThan(0);
      expect(box.x).toBeGreaterThanOrEqual(stage.x - 12);
      expect(box.y).toBeGreaterThanOrEqual(stage.y - 12);
      expect(box.x + box.width).toBeLessThanOrEqual(stage.x + stage.width + 12);
      expect(box.y + box.height).toBeLessThanOrEqual(stage.y + stage.height + 12);
    }
  });

  test('a mark takes the reader to the fix it belongs to', async ({ page }) => {
    await signIn(page, address('xray-link'));
    await scan(page, 'twoColumn');
    await openXray(page);

    const mark = page.locator('#xray-marks .xmark').first();
    const label = await mark.getAttribute('aria-label');
    // The mark names the finding rather than being a bare coloured rectangle.
    expect(label).toMatch(/^Finding \d+: .+\. Go to the fix\.$/);

    await mark.click();
    const called = page.locator('.fixes li.is-called');
    await expect(called).toBeVisible();
    // The number on the mark and the number on the card are the same finding.
    const number = label.match(/^Finding (\d+):/)[1];
    await expect(called.locator('.fixpin')).toHaveText(number);
  });

  test('the fold is not offered when the stored file is gone', async ({ page }) => {
    // The findings live for 30 days, the PDF for 24 hours. After the purge there
    // is nothing to render, and offering an X-ray that cannot work would be a
    // dead end rather than a feature.
    await signIn(page, address('xray-purged'));
    await scan(page, 'clean');
    await expect(page.locator('#xray-fold')).toBeVisible();

    await page.evaluate(() => {
      const scan = { id: 'a'.repeat(32), file_available: false };
      window.AtsyXray.mount({ scanId: scan.id, findings: [], sizes: [], fileAvailable: false });
    });
    await expect(page.locator('#xray-fold')).toBeHidden();
  });

  test('the X-ray survives being zoomed to 200%', async ({ page }) => {
    // WCAG 1.4.10. A canvas with a fixed pixel width is the classic way to
    // break reflow, and percentage-positioned marks are the reason this holds.
    await signIn(page, address('xray-zoom'));
    await scan(page, 'twoColumn');
    await openXray(page);

    await page.setViewportSize({ width: 215, height: 466 });
    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, 'the X-ray scrolls the page sideways at 200% zoom')
      .toBeLessThanOrEqual(1);

    // And the marks are still over the page, not left behind at the old size.
    const stage = await page.locator('#xray-stage').boundingBox();
    const box = await page.locator('#xray-marks .xmark').first().boundingBox();
    expect(box.x + box.width).toBeLessThanOrEqual(stage.x + stage.width + 12);
  });
});
