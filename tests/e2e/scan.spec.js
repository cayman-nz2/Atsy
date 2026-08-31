import { test, expect } from '@playwright/test';
import { fixture } from '../fixtures/cvs.js';

// One address per test: the suite shares a local database, and tests that
// collide on a user are tests that lie.
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

// Playwright's setInputFiles takes a buffer, so the generated fixtures go
// straight in — the browser sends exactly the bytes the unit tests parse.
async function upload(page, name, filename = 'cv.pdf') {
  await page.setInputFiles('#file', {
    name: filename,
    mimeType: 'application/pdf',
    buffer: Buffer.from(fixture(name)),
  });
  const scanRequest = page.waitForResponse((response) =>
    response.url().endsWith('/api/scans') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Scan this CV' }).click();
  const status = (await scanRequest).status();

  // The response arriving is not the same as the page having rendered it: the
  // submit handler still has to parse the JSON and paint. Returning on the
  // response alone let two tests read the result card before it existed — and
  // one of them passed anyway, because the unrendered href was "#", which
  // fetches the app page and answers 200. Wait for the outcome the callers
  // actually depend on.
  if (status === 201) {
    await expect(page.locator('#screen-result')).toBeVisible();
    await expect(page.locator('#score-number')).not.toHaveText('—');
    await expect(page.locator('#read-download')).toHaveAttribute(
      'href', /^\/api\/scans\/[0-9a-f]{32}\/file$/);
  } else {
    await expect(page.locator('#upload-error')).toBeVisible();
  }
  return status;
}

test.describe('scanning a CV', () => {
  test('a clean CV uploads and reports what a parser read', async ({ page }) => {
    await signIn(page, address('scan-clean'));

    // The panel is on the account screen, not behind another click.
    await expect(page.getByRole('heading', { name: 'Scan your CV' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Scan this CV' })).toBeEnabled();

    expect(await upload(page, 'clean', 'priya-raman-cv.pdf')).toBe(201);

    const read = page.locator('#screen-result');
    await expect(read).toBeVisible();
    await expect(page.locator('#score-file')).toContainText('priya-raman-cv.pdf');

    // The facts a reader can act on, not a number Atsy has not computed.
    const facts = page.locator('#read-facts');
    await expect(facts).toContainText('Columns');
    await expect(facts).toContainText('Sections found');
    await expect(facts).toContainText('experience');
    await expect(facts).toContainText('Text order on the page');
    await expect(page.locator('#score-band')).not.toHaveText('Scanning…');
  });

  test('a two-column CV reports the columns and the sections they cost', async ({ page }) => {
    await signIn(page, address('scan-columns'));
    expect(await upload(page, 'twoColumn')).toBe(201);

    const facts = page.locator('#read-facts');
    await expect(facts.locator('[data-fact="Columns"]')).toContainText('more than one');
    // The verdict now lives in the fix list, worst first, with the points it
    // costs — which is more use than a sentence.
    const fixes = page.locator('#fix-list');
    await expect(fixes.locator('li').first()).toContainText('column');
    await expect(fixes.locator('li').first()).toContainText('6 points');

    // A high text-order percentage on a two-column CV means the columns
    // interleave. It must never read as the reassuring green it looks like.
    const order = facts.locator('[data-fact="Text order on the page"]');
    await expect(order).toContainText('the columns interleave');
    await expect(order.locator('dd')).toHaveClass(/is-bad/);
  });

  test('a CV with hidden keywords says so in the reader\'s words', async ({ page }) => {
    await signIn(page, address('scan-hidden'));
    expect(await upload(page, 'hiddenText')).toBe(201);
    await expect(page.locator('#read-facts')).toContainText('this is what gets a CV rejected');
  });

  test('a picture of a CV is refused with an explanation, not a score', async ({ page }) => {
    await signIn(page, address('scan-image'));
    expect(await upload(page, 'imageOnly')).toBe(422);

    await expect(page.locator('#upload-error')).toBeVisible();
    await expect(page.locator('#upload-error')).toContainText('picture of a CV');
    // No results screen for a scan that did not happen.
    await expect(page.locator('#screen-result')).toBeHidden();
  });

  test('a file that is not a PDF is refused before it is scanned', async ({ page }) => {
    await signIn(page, address('scan-notpdf'));
    await page.setInputFiles('#file', {
      name: 'cv.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('This is a Word document that has been renamed.'),
    });
    await page.getByRole('button', { name: 'Scan this CV' }).click();
    await expect(page.locator('#upload-error')).toContainText('not a PDF');
  });

  test('the stored copy comes back as a PDF and is never cacheable', async ({ page }) => {
    await signIn(page, address('scan-file'));
    expect(await upload(page, 'clean')).toBe(201);

    const href = await page.locator('#read-download').getAttribute('href');
    expect(href).toMatch(/^\/api\/scans\/[0-9a-f]{32}\/file$/);

    // Fetched inside the page: the session cookie is Secure, so Playwright's
    // own request context would be signed out over http and the assertion
    // would pass for the wrong reason.
    const result = await page.evaluate(async (path) => {
      const response = await fetch(path, { credentials: 'same-origin' });
      const bytes = new Uint8Array(await response.arrayBuffer());
      return {
        status: response.status,
        type: response.headers.get('content-type'),
        cache: response.headers.get('cache-control'),
        header: String.fromCharCode(...bytes.slice(0, 5)),
      };
    }, href);
    expect(result.status).toBe(200);
    expect(result.type).toBe('application/pdf');
    expect(result.cache).toContain('no-store');
    expect(result.header).toBe('%PDF-');
  });

  test('history lists the scan, and deleting it clears both the card and the list', async ({ page }) => {
    await signIn(page, address('scan-history'));
    expect(await upload(page, 'clean', 'first-draft.pdf')).toBe(201);

    // Back to the upload panel: the history card lives there, and the scan is
    // in it with its score.
    await page.getByRole('button', { name: 'Back to upload' }).click();
    await expect(page.locator('#card-history')).toBeVisible();
    await expect(page.locator('#history-list')).toContainText('first-draft.pdf');
    await expect(page.locator('#history-list')).toContainText('/100');

    // Re-opening from history brings the score back without another upload.
    await page.getByRole('button', { name: /first-draft\.pdf/ }).click();
    await expect(page.locator('#screen-result')).toBeVisible();
    await expect(page.locator('#score-number')).not.toHaveText('—');

    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'Delete this scan' }).click();
    await expect(page.locator('#screen-result')).toBeHidden();
    await expect(page.locator('#history-list')).not.toContainText('first-draft.pdf');
  });

  test('a signed-out browser cannot upload or read a scan', async ({ page }) => {
    await signIn(page, address('scan-owner'));
    expect(await upload(page, 'clean')).toBe(201);
    const href = await page.locator('#read-download').getAttribute('href');

    await page.getByRole('button', { name: 'Back to upload' }).click();
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page.getByRole('heading', { name: 'Sign in to Atsy' })).toBeVisible();

    const status = await page.evaluate(async (path) => {
      const response = await fetch(path, { credentials: 'same-origin' });
      return response.status;
    }, href);
    expect(status).toBe(401);
  });

  test('deleting the account takes the scans and the stored files with it', async ({ page }) => {
    await signIn(page, address('scan-erase'));
    expect(await upload(page, 'clean')).toBe(201);
    const href = await page.locator('#read-download').getAttribute('href');

    await page.getByRole('button', { name: 'Back to upload' }).click();
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'Delete everything' }).click();
    await expect(page.getByRole('heading', { name: 'Sign in to Atsy' })).toBeVisible();

    // The session is gone, so this is 401 rather than 404 — but the record and
    // the ciphertext are gone too, which the unit tests assert directly.
    const status = await page.evaluate(async (path) => {
      const response = await fetch(path, { credentials: 'same-origin' });
      return response.status;
    }, href);
    expect(status).toBe(401);
  });

  test('the results screen shows the score, the pillars, the fixes and the engines', async ({ page }) => {
    await signIn(page, address('scan-results'));
    expect(await upload(page, 'twoColumn')).toBe(201);

    // A score a reader can act on, not a number on its own.
    await expect(page.locator('#score-band')).toHaveText(/Excellent|Strong|Needs work|At risk/);
    await expect(page.locator('#score-dial')).toHaveAttribute('data-band', /excellent|strong|work|risk/);
    await expect(page.locator('#score-lede')).not.toHaveText('');

    // Five pillars, each with its score out of its weight.
    await expect(page.locator('#pillar-list li')).toHaveCount(5);
    await expect(page.locator('#pillar-list')).toContainText('Parse & structure');
    await expect(page.locator('#pillar-list')).toContainText('/ 35');

    // Six engines, each with a risk band and a reason in plain words.
    await expect(page.locator('#engine-list li')).toHaveCount(6);
    await expect(page.locator('#engine-list')).toContainText('Oracle Taleo');
    await expect(page.locator('#engine-list')).toContainText('Because');
    await expect(page.locator('#engine-disclaimer'))
      .toContainText('not a score from the engine itself');

    // The fix list is ordered worst first and priced.
    const first = page.locator('#fix-list li').first();
    await expect(first).toContainText('Critical');
    await expect(first).toContainText('points');
  });

  test('the machine view shows the text in the order the file stores it', async ({ page }) => {
    await signIn(page, address('scan-machine'));
    expect(await upload(page, 'twoColumn')).toBe(201);

    // Folds ship closed, so the reader opens this one deliberately.
    await page.getByText('What the machine actually reads').click();
    const machine = page.locator('#machine-view');
    await expect(machine.locator('.mline').first()).toBeVisible();
    // The two-column fixture interleaves across the gutter, which is the whole
    // point of showing this: SKILLS and EXPERIENCE end up adjacent.
    await expect(machine).toContainText('SKILLS');
    await expect(machine).toContainText('EXPERIENCE');
  });

  test('a fatal finding caps the score and explains the cap', async ({ page }) => {
    await signIn(page, address('scan-capped'));
    expect(await upload(page, 'hiddenText')).toBe(201);

    await expect(page.locator('#score-number')).toHaveText('40');
    await expect(page.locator('#score-cap')).toBeVisible();
    await expect(page.locator('#score-cap')).toContainText('capped');
    await expect(page.locator('#fix-list li').first()).toContainText('caps your score');
  });

  test('a re-opened scan keeps its score but not the text, which was never stored', async ({ page }) => {
    await signIn(page, address('scan-reopen'));
    expect(await upload(page, 'noMetrics')).toBe(201);
    const score = await page.locator('#score-number').textContent();

    await page.getByRole('button', { name: 'Back to upload' }).click();
    await page.getByRole('button', { name: /noMetrics|cv\.pdf/ }).first().click();

    await expect(page.locator('#score-number')).toHaveText(score);
    await expect(page.locator('#fix-list li').first()).toBeVisible();
    // The machine view is gone, because the text was never written down.
    await expect(page.locator('#machine-view')).toBeHidden();
  });

  test('the retention sweep is wired to the cron trigger and runs clean', async ({ page }) => {
    // The sweep's decisions are unit-tested against real SQL. What this proves
    // is the part a unit test cannot: that the scheduled handler is exported
    // and reachable, so the cron in wrangler.jsonc has something to call.
    await signIn(page, address('scan-cron'));
    expect(await upload(page, 'clean')).toBe(201);

    const response = await page.request.get('/cdn-cgi/local/scheduled');
    expect(response.status()).toBe(200);

    // Nothing was due, so the scan and its file are untouched.
    await page.reload();
    await expect(page.locator('#card-history')).toBeVisible();
    await expect(page.locator('#history-list')).toContainText('cv.pdf');
  });

  test('the upload panel and the result card fit the phone without sideways scroll', async ({ page }) => {
    await signIn(page, address('scan-layout'));
    expect(await upload(page, 'clean', 'a-very-long-filename-that-should-wrap-not-overflow.pdf')).toBe(201);

    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, 'the result card pushed the page sideways').toBeLessThanOrEqual(1);
  });
});
