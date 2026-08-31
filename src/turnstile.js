// The Turnstile check, in its own module.
//
// It lives here rather than in auth.js because both sign-in and CV upload use
// it, and auth.js importing the scan pipeline while the scan pipeline imported
// auth.js would be a circular import — the kind that works until a bundler or
// an evaluation order changes and then fails at startup.

export async function verifyTurnstile(env, token, ip) {
  // Local dev and E2E only, passed with `wrangler dev --var`. It must never
  // appear in wrangler.jsonc.
  if (env.TURNSTILE_BYPASS === '1') return true;

  if (!env.TURNSTILE_SECRET_KEY) {
    // No secret means the bot shield is knowingly off. Calling siteverify with
    // Cloudflare's always-pass test secret looks harmless but is not: an empty
    // token still comes back `missing-input-response`, so an unconfigured
    // shield blocked every sign-in — failing closed for a reason that has
    // nothing to do with bots. Skip the check and say so.
    console.log('WARNING: TURNSTILE_SECRET_KEY unset — the bot shield is off; rate limits still apply');
    return true;
  }

  const secret = env.TURNSTILE_SECRET_KEY;
  const body = new FormData();
  body.set('secret', secret);
  body.set('response', token || '');
  if (ip) body.set('remoteip', ip);
  try {
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body,
    });
    const data = await response.json();
    return !!data.success;
  } catch {
    return false;
  }
}
