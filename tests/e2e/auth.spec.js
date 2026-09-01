import { test, expect } from '@playwright/test';

// Each test uses its own address: the suite shares one local database, and
// tests that collide on a user are tests that lie.
const address = (name) => `${name}-${Date.now()}@example.test`;

// Session checks must run inside the page. Playwright's request context will
// not attach a `Secure` cookie to an http:// URL, so `page.request.get('/api/me')`
// answers "signed out" for a signed-in browser — an assertion that passes for
// the wrong reason.
const me = (page) => page.evaluate(() =>
  fetch('/api/me', { credentials: 'same-origin' }).then((response) => response.json()));

// The code field submits itself on the sixth digit, so this helper never
// touches the button: filling the field is the whole interaction.
async function signIn(page, email) {
  await page.goto('/app');
  await page.getByLabel('Email address').fill(email);
  const codeRequest = page.waitForResponse((response) =>
    response.url().includes('/api/auth/request-code'));
  await page.getByRole('button', { name: 'Email me a code' }).click();
  const { debug_code: code } = await (await codeRequest).json();
  expect(code, 'OTP_ECHO must hand the code back in dev/E2E').toMatch(/^\d{6}$/);
  await page.getByLabel('Six-digit code').fill(code);
  await expect(page.getByRole('heading', { name: 'You are signed in' })).toBeVisible();
  return code;
}

test.describe('sign in', () => {
  test('with no bot check configured, the form is usable immediately', async ({ page }) => {
    // E2E runs without a site key. The button must not sit disabled waiting
    // for a widget that will never appear — that is the shape of the bug that
    // locked everyone out of the live site.
    await page.goto('/app');
    await expect(page.getByRole('button', { name: 'Email me a code' })).toBeEnabled();
  });

  test('the sixth digit signs you in on its own, and the session survives a reload', async ({ page }) => {
    const email = address('happy');
    await signIn(page, email);
    await expect(page.locator('#account-email')).toHaveText(email);

    await page.reload();
    await expect(page.getByRole('heading', { name: 'You are signed in' })).toBeVisible();

    expect((await me(page)).user.email).toBe(email);
  });

  test('a wrong code is refused and the form stays usable', async ({ page }) => {
    const email = address('wrong');
    await page.goto('/app');
    await page.getByLabel('Email address').fill(email);
    await page.getByRole('button', { name: 'Email me a code' }).click();
    await expect(page.getByRole('heading', { name: 'Enter your code' })).toBeVisible();

    // Filling six digits submits on its own; no button press needed.
    await page.getByLabel('Six-digit code').fill('000000');
    await expect(page.locator('#code-error')).toContainText('not right');
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeEnabled();
    expect((await me(page)).user).toBeNull();
  });

  test('signing out ends the session', async ({ page }) => {
    await signIn(page, address('signout'));
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page.getByRole('heading', { name: 'Sign in to Atsy' })).toBeVisible();
    expect((await me(page)).user).toBeNull();
  });

  test('deleting the account removes it, and signing in again creates a new one', async ({ page }) => {
    const email = address('delete');
    await signIn(page, email);

    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'Delete everything' }).click();
    await expect(page.getByRole('heading', { name: 'Sign in to Atsy' })).toBeVisible();
    expect((await me(page)).user, 'the deleted session must not survive').toBeNull();

    // The address is free to sign up again — deletion means gone, not banned.
    await signIn(page, email);
    await expect(page.getByRole('heading', { name: 'You are signed in' })).toBeVisible();
  });

  test('the browser Back button returns to the email step', async ({ page }) => {
    await page.goto('/app');
    await page.getByLabel('Email address').fill(address('back'));
    await page.getByRole('button', { name: 'Email me a code' }).click();
    await expect(page.getByRole('heading', { name: 'Enter your code' })).toBeVisible();

    await page.goBack();
    await expect(page.getByRole('heading', { name: 'Sign in to Atsy' })).toBeVisible();
  });
});

test.describe('sign-in API rules', () => {
  test('an unauthenticated delete is refused', async ({ request }) => {
    const response = await request.delete('/api/me');
    expect(response.status()).toBe(401);
    expect(await response.json()).toEqual({ error: 'unauthorised' });
  });

  test('a malformed address never reaches the database', async ({ request }) => {
    const response = await request.post('/api/auth/request-code', { data: { email: 'nope' } });
    expect(response.status()).toBe(400);
    expect(await response.json()).toEqual({ error: 'invalid_email' });
  });

  test('the sixth code request in an hour is refused', async ({ request }) => {
    const email = address('flood');
    for (let i = 0; i < 5; i += 1) {
      const allowed = await request.post('/api/auth/request-code', { data: { email } });
      expect(allowed.status(), `request ${i + 1} should be allowed`).toBe(200);
    }
    const refused = await request.post('/api/auth/request-code', { data: { email } });
    expect(refused.status()).toBe(429);
    expect(await refused.json()).toEqual({ error: 'too_many_requests' });
  });

  test('a wrong code cannot be guessed more than five times', async ({ request }) => {
    const email = address('brute');
    await request.post('/api/auth/request-code', { data: { email } });
    for (let i = 0; i < 5; i += 1) {
      const attempt = await request.post('/api/auth/verify', { data: { email, code: '111111' } });
      expect(attempt.status(), `attempt ${i + 1} should be a plain rejection`).toBe(400);
    }
    const locked = await request.post('/api/auth/verify', { data: { email, code: '111111' } });
    expect(locked.status()).toBe(429);
    expect(await locked.json()).toEqual({ error: 'too_many_attempts' });
  });

  test('a used code cannot be replayed', async ({ page, request }) => {
    const email = address('replay');
    const code = await signIn(page, email);

    const replay = await request.post('/api/auth/verify', { data: { email, code } });
    expect(replay.status()).toBe(400);
    expect((await replay.json()).error).toBe('code_expired');
  });

  // A page served two Content-Security-Policy headers is held to BOTH, and the
  // browser enforces whichever is stricter for each directive. _headers applies
  // every matching rule rather than letting the specific one win, so the
  // site-wide `script-src 'self'` and the /app rule that admits Turnstile both
  // shipped — and the strict one silently won. The bot check never loaded on
  // the live sign-in page. `headers()` cannot see this: it joins duplicates
  // with ", ", so a `toContain` on the merged string passed throughout.
  test('the sign-in page is served exactly one CSP, not two that intersect', async ({ request }) => {
    const policies = (await request.get('/app')).headersArray()
      .filter((h) => h.name.toLowerCase() === 'content-security-policy');
    expect(policies).toHaveLength(1);
    expect(policies[0].value).toContain('https://challenges.cloudflare.com');
    expect(policies[0].value).toContain("default-src 'self'");
    expect(policies[0].value).toContain("object-src 'none'");

    const landing = (await request.get('/')).headersArray()
      .filter((h) => h.name.toLowerCase() === 'content-security-policy');
    expect(landing).toHaveLength(1);
    expect(landing[0].value).not.toContain('challenges.cloudflare.com');
  });

  // Asserting on the header text is still a reading of the policy rather than
  // the policy itself. Ask the browser instead: a CSP block raises
  // securitypolicyviolation, and a network failure does not — so this says
  // "the policy permits it" whether or not the sandbox can reach Cloudflare.
  test('a browser on the sign-in page is allowed to fetch the bot check', async ({ page }) => {
    await page.goto('/app');
    const violated = await page.evaluate(() => new Promise((resolve) => {
      let directive = null;
      document.addEventListener('securitypolicyviolation', (event) => {
        if (event.blockedURI.includes('challenges.cloudflare.com')) directive = event.violatedDirective;
      });
      const script = document.createElement('script');
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      const settle = () => setTimeout(() => resolve(directive), 0);
      script.onload = settle;
      script.onerror = settle;
      document.head.appendChild(script);
      setTimeout(() => resolve(directive), 5000);
    }));
    expect(violated).toBeNull();
  });
});
