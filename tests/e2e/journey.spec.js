import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

// A dev server that snapshotted an older dist/ will happily keep serving it,
// and every screenshot and assertion after that describes a build which no
// longer exists on disk. Fail here rather than review a ghost.
test('the server is serving this build, not a stale one', async ({ page }) => {
  const local = JSON.parse(readFileSync('dist/build.json', 'utf8'));
  const served = await (await page.request.get('/build.json')).json();
  expect(served.build, 'restart the dev server: it is serving a stale dist/').toBe(local.build);
});


test.describe('landing', () => {
  test('serves the hero, the demo and a version, with no console errors', async ({ page }) => {
    const errors = [];
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('pageerror', (error) => errors.push(String(error)));

    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('hiring machine');
    await expect(page.getByRole('link', { name: 'See what a parser reads' })).toBeVisible();

    const health = await page.request.get('/api/health');
    expect(health.ok()).toBeTruthy();
    const body = await health.json();
    expect(body.version).toMatch(/^\d+\.\d+\.\d+$/);
    await expect(page.locator('#version')).toHaveText(`v${body.version}`);

    expect(errors).toEqual([]);
  });

  test('the machine view toggle swaps the two views and keeps state accessible', async ({ page }) => {
    await page.goto('/');
    const paper = page.locator('#view-paper');
    const machine = page.locator('#view-machine');

    await expect(paper).toHaveAttribute('aria-hidden', 'false');
    await expect(machine).toHaveAttribute('aria-hidden', 'true');

    await page.getByRole('button', { name: 'What the machine reads' }).click();
    await expect(machine).toHaveAttribute('aria-hidden', 'false');
    await expect(paper).toHaveAttribute('aria-hidden', 'true');
    await expect(machine).toContainText('Skills My journey');

    await page.getByRole('button', { name: 'The page' }).click();
    await expect(paper).toHaveAttribute('aria-hidden', 'false');
  });

  test('the theme toggle switches themes and survives a reload', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /Switch to (dark|light) theme/ }).click();
    const chosen = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    expect(['dark', 'light']).toContain(chosen);
    await page.reload();
    await expect.poll(() =>
      page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe(chosen);
  });

  test('the first tab stop is a working skip link', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press('Tab');
    const focused = page.locator(':focus');
    await expect(focused).toHaveText('Skip to content');
    await expect(focused).toBeVisible();
  });

  test('unknown paths return a 404 page, unknown API paths return JSON', async ({ page }) => {
    const html = await page.request.get('/no-such-page');
    expect(html.status()).toBe(404);
    expect(await html.text()).toContain('That page is not here');

    const api = await page.request.get('/api/no-such-endpoint');
    expect(api.status()).toBe(404);
    expect(await api.json()).toEqual({ error: 'not_found' });
    expect(api.headers()['cache-control']).toBe('no-store');
  });

  test('static assets carry the security headers and the CSP', async ({ page }) => {
    const response = await page.request.get('/');
    const headers = response.headers();
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['referrer-policy']).toBe('no-referrer');
    expect(headers['content-security-policy']).toContain("default-src 'self'");
    expect(headers['content-security-policy']).not.toContain('http://');
  });
});

// Layout collisions are a build failure, not a review catch (Pricey incident #33).
const SURFACES = '.card, .note, .find, .stage, .btn, .toggle, .cta-note, .pin, .cv .lbl, .cv h4, .cv .job';

// Every page, not just the home page: a shared component that collides only on
// /about is still a collision the owner will find.
const PAGES = ['/', '/about', '/privacy', '/app', '/no-such-page'];

for (const [label, width, height] of [['small phone', 393, 851], ['large phone', 430, 932], ['desktop', 1280, 900]]) {
  test(`no overlapping surfaces at ${label} (${width}x${height})`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    for (const path of PAGES) {
      await page.goto(path);
      await page.evaluate(() => document.fonts.ready);

      const collisions = await page.evaluate((selector) => {
      const nodes = [...document.querySelectorAll(selector)]
        .filter((node) => node.getClientRects().length > 0);
      const hits = [];
      for (let i = 0; i < nodes.length; i += 1) {
        for (let j = i + 1; j < nodes.length; j += 1) {
          const a = nodes[i];
          const b = nodes[j];
          if (a.contains(b) || b.contains(a)) continue;
          const ra = a.getBoundingClientRect();
          const rb = b.getBoundingClientRect();
          const overlapX = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
          const overlapY = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
          // 1px tolerance for sub-pixel rounding on shared edges.
          if (overlapX > 1 && overlapY > 1) {
            hits.push(`${a.className || a.tagName} ↔ ${b.className || b.tagName}`);
          }
        }
      }
        return hits;
      }, SURFACES);

      expect(collisions, `overlapping surfaces on ${path} at ${width}x${height}`).toEqual([]);
    }
  });

  test(`no horizontal page scroll at ${label} (${width}x${height})`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    for (const path of PAGES) {
      await page.goto(path);
      const overflow = await page.evaluate(() =>
        document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `${path} scrolls sideways at ${width}px`).toBeLessThanOrEqual(1);
    }
  });
}
