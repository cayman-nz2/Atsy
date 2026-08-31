// Email one-time-code sign-in and sessions.
//
// Codes are six digits, stored only as a SHA-256 hash, valid for ten minutes,
// and rate limited per email and per IP. Sessions are 256-bit tokens, also
// stored hashed, so a copy of the database cannot be replayed as a login.
// Responses never reveal whether an address has an account.

import {
  json, err, nowSec, randDigits, randToken, sha256Hex, hashIp,
  getCookie, sessionCookie, validEmail, readJson,
} from './util.js';
import { sendEmail, notifyOwner, maskCode } from './notify.js';

const OTP_TTL_SEC = 10 * 60;
const OTP_MAX_ATTEMPTS = 5;
const OTP_MAX_PER_EMAIL_HOUR = 5;
// Per-IP cap. Configurable only so that E2E, where every request comes from
// one address, is not order-dependent; the flag is passed with
// `wrangler dev --var` and a unit test forbids it in wrangler.jsonc.
const OTP_MAX_PER_IP_HOUR_DEFAULT = 20;
const SESSION_TTL_SEC = 90 * 24 * 3600;
const SESSION_REFRESH_UNDER_SEC = 60 * 24 * 3600;

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

const signInEmail = (code) => [
  'Here is your Atsy sign-in code:',
  '',
  `    ${code}`,
  '',
  'It works for the next 10 minutes and can only be used once.',
  "If you did not ask to sign in, you can ignore this email — nobody can use the code without it.",
  '',
  'Atsy — a free CV scanner. https://atsy.vibecod3.app',
];

export async function requestCode(request, env) {
  const body = await readJson(request);
  if (!body || !validEmail(body.email)) return err('invalid_email', 400);
  const email = body.email.trim().toLowerCase();
  const ip = request.headers.get('cf-connecting-ip') || null;
  const ipHash = await hashIp(env, ip);

  if (!(await verifyTurnstile(env, body.turnstileToken, ip))) return err('turnstile_failed', 403);

  const hourAgo = nowSec() - 3600;
  const { count: emailCount } = await env.DB
    .prepare('SELECT COUNT(*) AS count FROM otp_codes WHERE email = ? AND created_at > ?')
    .bind(email, hourAgo).first();
  if (emailCount >= OTP_MAX_PER_EMAIL_HOUR) return err('too_many_requests', 429);

  if (ipHash) {
    const ipCap = Number(env.OTP_MAX_PER_IP_HOUR) || OTP_MAX_PER_IP_HOUR_DEFAULT;
    const { count: ipCount } = await env.DB
      .prepare('SELECT COUNT(*) AS count FROM otp_codes WHERE ip_hash = ? AND created_at > ?')
      .bind(ipHash, hourAgo).first();
    if (ipCount >= ipCap) return err('too_many_requests', 429);
  }

  const code = randDigits(6);
  await env.DB.prepare(
    'INSERT INTO otp_codes (email, code_hash, ip_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)',
  ).bind(email, await sha256Hex(code), ipHash, nowSec() + OTP_TTL_SEC, nowSec()).run();

  // Local dev and E2E only: skip sending and hand the code back so tests can
  // sign in deterministically. Never set in production.
  if (env.OTP_ECHO === '1') return json({ sent: true, debug_code: code });

  try {
    const body = signInEmail(code);
    const subject = `${code} is your Atsy sign-in code`;
    await sendEmail(env, email, subject, body, {
      // The owner's copy records that a code went out, without carrying the
      // code itself: a second inbox holding live sign-in codes would let
      // anyone with access to it sign in as any user. The subject line needs
      // masking as much as the body does — it starts with the code.
      copyLines: maskCode(body, code),
      copySubject: maskCode([subject], code)[0],
    });
  } catch (error) {
    console.log('sign-in email failed:', error.message);
    return err('email_unavailable', 502);
  }
  return json({ sent: true });
}

export async function verifyCode(request, env, ctx) {
  const body = await readJson(request);
  if (!body || !validEmail(body.email) || !/^\d{6}$/.test(body.code || '')) {
    return err('invalid_request', 400);
  }
  const email = body.email.trim().toLowerCase();

  // Accept any unexpired code for this address, not only the newest: when a
  // slow first email lands after the user has asked for another, the code in
  // their hand is still the one they will type. Attempts are capped across all
  // outstanding codes so this cannot widen a brute force.
  const rows = (await env.DB.prepare(
    'SELECT id, code_hash, attempts FROM otp_codes WHERE email = ? AND expires_at > ? ORDER BY created_at DESC LIMIT 6',
  ).bind(email, nowSec()).all()).results;
  if (!rows.length) return err('code_expired', 400);
  if (rows.reduce((sum, row) => sum + row.attempts, 0) >= OTP_MAX_ATTEMPTS) {
    return err('too_many_attempts', 429);
  }

  const hash = await sha256Hex(body.code);
  if (!rows.some((row) => row.code_hash === hash)) {
    await env.DB.prepare('UPDATE otp_codes SET attempts = attempts + 1 WHERE id = ?')
      .bind(rows[0].id).run();
    return err('wrong_code', 400);
  }

  // The code is spent the moment it works: every outstanding code for this
  // address goes, so none can be replayed.
  await env.DB.prepare('DELETE FROM otp_codes WHERE email = ?').bind(email).run();

  const country = (request.cf && request.cf.country) || null;
  const inserted = await env.DB.prepare(
    'INSERT OR IGNORE INTO users (email, country, created_at, last_seen) VALUES (?, ?, ?, ?)',
  ).bind(email, country, nowSec(), nowSec()).run();
  const user = await env.DB.prepare('SELECT id, email FROM users WHERE email = ?')
    .bind(email).first();

  if (inserted.meta.changes) {
    notifyOwner(env, ctx, 'New Atsy sign-up', [
      'Someone just created an Atsy account.',
      '',
      `Email: ${email}`,
      `Country: ${country || 'unknown'}`,
      `Signed up: ${new Date().toUTCString()}`,
    ]);
  }

  const token = randToken();
  await env.DB.prepare(
    'INSERT INTO sessions (token_hash, user_id, created_at, expires_at, last_used) VALUES (?, ?, ?, ?, ?)',
  ).bind(await sha256Hex(token), user.id, nowSec(), nowSec() + SESSION_TTL_SEC, nowSec()).run();

  return json({ ok: true, email: user.email }, 200, {
    'set-cookie': sessionCookie(token, SESSION_TTL_SEC),
  });
}

export async function currentUser(request, env) {
  const token = getCookie(request, 'sid');
  if (!token) return null;
  const hash = await sha256Hex(token);
  const row = await env.DB.prepare(
    `SELECT s.expires_at, u.id, u.email, u.created_at, u.last_seen
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.expires_at > ?`,
  ).bind(hash, nowSec()).first();
  if (!row) return null;

  // Rolling expiry: refresh once the session is inside its last 30 days.
  if (row.expires_at - nowSec() < SESSION_REFRESH_UNDER_SEC) {
    await env.DB.prepare('UPDATE sessions SET expires_at = ?, last_used = ? WHERE token_hash = ?')
      .bind(nowSec() + SESSION_TTL_SEC, nowSec(), hash).run();
  }
  // Activity heartbeat, at most one write an hour.
  if (nowSec() - (row.last_seen || 0) > 3600) {
    await env.DB.prepare('UPDATE users SET last_seen = ? WHERE id = ?').bind(nowSec(), row.id).run();
  }
  return { id: row.id, email: row.email, created_at: row.created_at };
}

export async function logout(request, env) {
  const token = getCookie(request, 'sid');
  if (token) {
    await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?')
      .bind(await sha256Hex(token)).run();
  }
  return json({ ok: true }, 200, { 'set-cookie': sessionCookie('', 0) });
}

// Irreversible, and it says so in the interface before it is called. Every
// table that will ever hold this user's data must be deleted here — later
// milestones add scans, findings, matches and the stored file.
export async function deleteAccount(request, env, user) {
  await env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(user.id).run();
  await env.DB.prepare('DELETE FROM otp_codes WHERE email = ?').bind(user.email).run();
  const removed = await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(user.id).run();
  if (!removed.meta.changes) return err('not_found', 404);
  return json({ ok: true, deleted: { account: 1 } }, 200, {
    'set-cookie': sessionCookie('', 0),
  });
}

export function isAdmin(env, user) {
  const admins = (env.ADMIN_EMAILS || '').toLowerCase().split(',').map((s) => s.trim()).filter(Boolean);
  return !!user && admins.includes(user.email.toLowerCase());
}
