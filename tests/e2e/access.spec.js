// Accessibility. WCAG 2.2 AA is the bar the playbook sets, and the clauses
// that matter most for this product are the ones a CV scanner's audience will
// actually hit: a keyboard-only journey, labelled controls, honest headings,
// and colour that is never the only thing carrying a meaning.

import { test, expect } from '@playwright/test';
import { fixture } from '../fixtures/cvs.js';

const address = (name) => `${name}-${Date.now()}@example.test`;

const PAGES = ['/', '/about', '/privacy', '/app'];

test.describe('accessibility', () => {
  for (const path of PAGES) {
    test(`${path} has one h1, ordered headings, and a landmark`, async ({ page }) => {
      await page.goto(path);

      const h1s = await page.locator('h1:visible').count();
      expect(h1s, `${path} should have exactly one visible h1`).toBe(1);

      await expect(page.locator('main#main')).toHaveCount(1);
      await expect(page.locator('nav')).not.toHaveCount(0);

      // Heading levels must not skip: a screen reader's outline is the only
      // structure some people get.
      const levels = await page.locator('h1:visible, h2:visible, h3:visible, h4:visible')
        .evaluateAll((nodes) => nodes.map((node) => Number(node.tagName.slice(1))));
      for (let index = 1; index < levels.length; index += 1) {
        expect(levels[index] - levels[index - 1],
          `${path} skips from h${levels[index - 1]} to h${levels[index]}`).toBeLessThanOrEqual(1);
      }
    });

    test(`${path} labels every control and names every link`, async ({ page }) => {
      await page.goto(path);

      const unlabelled = await page.locator('input:visible, select:visible, textarea:visible')
        .evaluateAll((nodes) => nodes
          .filter((node) => {
            if (node.getAttribute('aria-label') || node.getAttribute('aria-labelledby')) return false;
            if (node.id && document.querySelector(`label[for="${node.id}"]`)) return false;
            return !node.closest('label');
          })
          .map((node) => node.id || node.name || node.tagName));
      expect(unlabelled, `${path} has controls with no label`).toEqual([]);

      const nameless = await page.locator('a:visible, button:visible').evaluateAll((nodes) => nodes
        .filter((node) => !(node.textContent || '').trim()
          && !node.getAttribute('aria-label')
          && !node.getAttribute('title'))
        .map((node) => node.outerHTML.slice(0, 60)));
      expect(nameless, `${path} has controls with no accessible name`).toEqual([]);
    });

    test(`${path} keeps a visible focus ring on every focusable thing`, async ({ page }) => {
      await page.goto(path);
      // Tab through the first dozen stops and confirm each one is both focused
      // and visibly marked. A focus ring removed for looks is a page that
      // cannot be used without a mouse.
      for (let step = 0; step < 12; step += 1) {
        await page.keyboard.press('Tab');
        const focused = await page.evaluate(() => {
          const node = document.activeElement;
          if (!node || node === document.body) return null;
          const style = getComputedStyle(node);
          return {
            tag: node.tagName,
            outline: style.outlineStyle,
            outlineWidth: style.outlineWidth,
            boxShadow: style.boxShadow,
          };
        });
        if (!focused) break;
        const marked = (focused.outline !== 'none' && focused.outlineWidth !== '0px')
          || (focused.boxShadow && focused.boxShadow !== 'none');
        expect(marked, `${path}: ${focused.tag} takes focus with no visible ring`).toBe(true);
      }
    });
  }

  test('the first tab stop is a skip link that actually moves focus', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press('Tab');
    const first = await page.evaluate(() => document.activeElement.textContent.trim());
    expect(first).toBe('Skip to content');
    await page.keyboard.press('Enter');
    await expect(page.locator('#main')).toBeInViewport();
  });

  test('the whole journey works without a mouse', async ({ page }) => {
    // Sign in, upload, read the score, open a fold — using only the keyboard.
    await page.goto('/app');

    await page.getByLabel('Email address').focus();
    await page.keyboard.type(address('a11y'));
    const codeRequest = page.waitForResponse((response) =>
      response.url().includes('/api/auth/request-code'));
    await page.keyboard.press('Enter');
    const { debug_code: code } = await (await codeRequest).json();

    // Waiting for the response is not waiting for the render — the same trap
    // as incident 58. `focus()` does not wait for visibility, so without this
    // the keystrokes go to an input that is not on screen yet.
    await expect(page.getByRole('heading', { name: 'Enter your code' })).toBeVisible();
    await page.getByLabel('Six-digit code').focus();

    // OTP_ECHO pre-fills this field in dev, and `maxlength="6"` then swallows
    // every keystroke — no input event, no auto-submit, and a test that looks
    // like a broken app. Clear it from the keyboard first, so what is being
    // exercised is a person typing their code.
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.press('Backspace');
    await expect(page.getByLabel('Six-digit code')).toHaveValue('');
    await page.keyboard.type(code);
    await expect(page.getByRole('heading', { name: 'You are signed in' })).toBeVisible();

    // The file input is reachable by keyboard, which a div-based drop zone
    // would not be.
    await page.locator('#file').focus();
    await expect(page.locator('#file')).toBeFocused();
    await page.setInputFiles('#file', {
      name: 'cv.pdf', mimeType: 'application/pdf', buffer: Buffer.from(fixture('clean')),
    });

    await page.getByRole('button', { name: 'Scan this CV' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#screen-result')).toBeVisible();

    // A fold is a native <details>, so Enter opens it.
    const fold = page.getByText('What the machine actually reads');
    await fold.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#machine-view .mline').first()).toBeVisible();

    // And Back returns to the upload panel.
    await page.getByRole('button', { name: 'Back to upload' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#card-history')).toBeVisible();
  });

  test('severity and risk are never carried by colour alone', async ({ page }) => {
    // Someone who cannot distinguish the colours must get the same information.
    await page.goto('/app');
    await page.getByLabel('Email address').fill(address('a11y-colour'));
    const codeRequest = page.waitForResponse((r) => r.url().includes('/api/auth/request-code'));
    await page.getByRole('button', { name: 'Email me a code' }).click();
    const { debug_code: code } = await (await codeRequest).json();
    await page.getByLabel('Six-digit code').fill(code);
    await page.setInputFiles('#file', {
      name: 'cv.pdf', mimeType: 'application/pdf', buffer: Buffer.from(fixture('twoColumn')),
    });
    await page.getByRole('button', { name: 'Scan this CV' }).click();
    await expect(page.locator('#screen-result')).toBeVisible();

    // Every severity chip says its severity in words.
    const chips = await page.locator('#fix-list .chip').allTextContents();
    expect(chips.length).toBeGreaterThan(0);
    for (const chip of chips) {
      expect(['Critical', 'Major', 'Minor']).toContain(chip.trim());
    }
    // Every engine risk says its band in words.
    const risks = await page.locator('#engine-list .risk').allTextContents();
    for (const risk of risks) expect(risk).toMatch(/low|medium|high/);
    // Every pillar bar has its number beside it.
    const numbers = await page.locator('#pillar-list .pillarnum').allTextContents();
    for (const number of numbers) expect(number).toMatch(/\d+ \/ \d+/);
    // And the score dial is described for a screen reader.
    await expect(page.locator('#score-dial')).toHaveAttribute('aria-label', /out of 100/);
  });

  test('the page survives being zoomed to 200% without losing content', async ({ page }) => {
    // WCAG 1.4.10. Emulated by halving the viewport, which is what 200% zoom
    // does to the layout.
    await page.setViewportSize({ width: 215, height: 466 });
    for (const path of PAGES) {
      await page.goto(path);
      const overflow = await page.evaluate(() =>
        document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `${path} scrolls sideways at 200% zoom`).toBeLessThanOrEqual(1);
    }
  });

  test('the results screen survives 200% zoom too', async ({ page }) => {
    // The four pages above are the ones a URL can reach, so they were the only
    // ones this suite checked — and the results screen, which is the whole
    // product and exists only after a scan, went unmeasured. It was overflowing
    // by 26px the entire time: the engine cards are grid items, a grid item's
    // min-width defaults to auto, and "Greenhouse" beside "medium risk" is
    // wider than the column at this size.
    await page.goto('/app');
    await page.getByLabel('Email address').fill(address('a11y-zoom'));
    const codeRequest = page.waitForResponse((r) => r.url().includes('/api/auth/request-code'));
    await page.getByRole('button', { name: 'Email me a code' }).click();
    const { debug_code: code } = await (await codeRequest).json();
    await page.getByLabel('Six-digit code').fill(code);
    await page.setInputFiles('#file', {
      name: 'cv.pdf', mimeType: 'application/pdf', buffer: Buffer.from(fixture('twoColumn')),
    });
    await page.getByRole('button', { name: 'Scan this CV' }).click();
    await expect(page.locator('#screen-result')).toBeVisible();

    await page.setViewportSize({ width: 215, height: 466 });
    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, 'the results screen scrolls sideways at 200% zoom').toBeLessThanOrEqual(1);

    // Every fold on it, opened, is also part of the screen.
    for (const fold of await page.locator('#screen-result details').all()) {
      await fold.locator('summary').click();
    }
    const opened = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(opened, 'an opened fold scrolls the results screen sideways').toBeLessThanOrEqual(1);
  });
});
