// Unit tests. Plain node asserts, no framework, no network, no Cloudflare
// runtime — everything under test is pure or a standard web API.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { VERSION } from '../src/version.js';
import { sendEmail, maskCode } from '../src/notify.js';
import { verifyTurnstile } from '../src/turnstile.js';
import { deleteAccount } from '../src/auth.js';
import { extractDocument, UnreadablePdf } from '../src/extract/pdf.js';
import { analyseLayout } from '../src/extract/layout.js';
import { detectSections } from '../src/extract/sections.js';
import { canonicalSection } from '../src/lexicons/sections.js';
import { extractEntities, parseDate, dateFamily, findDateRanges } from '../src/extract/entities.js';
import { fixture, fixtureNames } from './fixtures/cvs.js';
import { testEnv, testUser, uploadRequest } from './fixtures/bindings.js';
import {
  buildModel, modelSummary, safeFilename, newScanId, r2KeyFor, failureMessage,
  createScan, listScans, getScan, getScanFile, deleteScan, deleteAllScansFor,
  fileRetentionSeconds, recordRetentionSeconds, MAX_UPLOAD_BYTES,
} from '../src/scan.js';
import { runRetention, purgeFiles, purgeRecords, purgeEphemera } from '../src/retention.js';
import { runChecks, ALL_CHECKS, PILLARS } from '../src/scoring/index.js';
import { buildContext } from '../src/scoring/context.js';
import { buildMatcher } from '../src/skills.js';
import { roleFit, totalTenureYears, seniorityOf } from '../src/scoring/role-fit.js';
import {
  redact, templateRewrite, rewriteBullets, spentToday, today,
  REWRITABLE, DAILY_NEURON_BUDGET,
} from '../src/rewrite.js';
import { submitFeedback, adminStats, adminFeedback, resolveFeedback } from '../src/admin.js';
import { scanReport } from '../src/report-page.js';
import { RELEASES } from '../src/report.js';
import {
  json, err, escapeHtml, nowSec, SECURITY_HEADERS,
  randDigits, randToken, sha256Hex, hashIp, getCookie, sessionCookie, validEmail, readJson,
} from '../src/util.js';

let passed = 0;
const failures = [];
async function test(name, fn) {
  try {
    await fn();
    passed += 1;
  } catch (error) {
    failures.push(`${name}\n    ${error.message.split('\n').join('\n    ')}`);
  }
}

const read = (path) => readFileSync(path, 'utf8');
const htmlPages = readdirSync('public').filter((f) => f.endsWith('.html')).map((f) => join('public', f));

/* ---------------- version discipline ---------------- */

await test('VERSION is a plain semver string', () => {
  assert.match(VERSION, /^\d+\.\d+\.\d+$/);
});

await test('newest RELEASES entry matches VERSION', () => {
  assert.ok(RELEASES.length > 0, 'RELEASES must not be empty');
  assert.equal(RELEASES[0].version, VERSION);
});

await test('every RELEASES entry has a date and plain-language notes', () => {
  for (const release of RELEASES) {
    assert.match(release.date, /^\d{4}-\d{2}-\d{2}$/, `${release.version} needs an ISO date`);
    assert.ok(Array.isArray(release.notes) && release.notes.length > 0, `${release.version} needs notes`);
  }
});

await test('package.json version matches VERSION', () => {
  assert.equal(JSON.parse(read('package.json')).version, VERSION);
});

await test('every page footer shows the current version', () => {
  for (const page of htmlPages) {
    assert.ok(read(page).includes(`v${VERSION}`), `${page} does not show v${VERSION}`);
  }
});

/* ---------------- util ---------------- */

await test('escapeHtml neutralises every HTML-significant character', () => {
  assert.equal(escapeHtml(`<script>"x"&'y'</script>`),
    '&lt;script&gt;&quot;x&quot;&amp;&#39;y&#39;&lt;/script&gt;');
});

await test('escapeHtml escapes the ampersand before the entities it produces', () => {
  assert.equal(escapeHtml('&lt;'), '&amp;lt;');
});

await test('json() responds with no-store and the security headers', async () => {
  const response = json({ ok: true });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    assert.equal(response.headers.get(name), value, `missing ${name}`);
  }
  assert.deepEqual(await response.json(), { ok: true });
});

await test('err() carries the code and the status', async () => {
  const response = err('not_found', 404);
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: 'not_found' });
});

await test('nowSec returns whole seconds', () => {
  const value = nowSec();
  assert.equal(value, Math.floor(value));
  assert.ok(Math.abs(value * 1000 - Date.now()) < 2000);
});

/* ---------------- identity primitives ---------------- */

await test('randDigits returns the asked-for number of digits, uniformly', () => {
  // `byte % 10` would make 0-5 likelier than 6-9 and shrink the real keyspace
  // of a sign-in code, so the implementation rejects the biased tail.
  const counts = new Array(10).fill(0);
  for (let i = 0; i < 4000; i += 1) {
    const value = randDigits(6);
    assert.match(value, /^\d{6}$/);
    for (const digit of value) counts[Number(digit)] += 1;
  }
  const expected = 24000 / 10;
  for (const [digit, count] of counts.entries()) {
    const drift = Math.abs(count - expected) / expected;
    assert.ok(drift < 0.15, `digit ${digit} appeared ${count} times, expected about ${expected}`);
  }
});

await test('randToken is 256 bits of URL-safe randomness and never repeats', () => {
  const seen = new Set();
  for (let i = 0; i < 500; i += 1) {
    const token = randToken();
    assert.match(token, /^[A-Za-z0-9_-]{43}$/);
    assert.ok(!seen.has(token), 'randToken repeated a value');
    seen.add(token);
  }
});

await test('sha256Hex matches the known digest for a known input', async () => {
  assert.equal(await sha256Hex('abc'),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

await test('hashIp is stable, salted, and never reveals the address', async () => {
  const one = await hashIp({ IP_HASH_SALT: 'salt-a' }, '203.0.113.7');
  const same = await hashIp({ IP_HASH_SALT: 'salt-a' }, '203.0.113.7');
  const otherSalt = await hashIp({ IP_HASH_SALT: 'salt-b' }, '203.0.113.7');
  const otherIp = await hashIp({ IP_HASH_SALT: 'salt-a' }, '203.0.113.8');
  assert.equal(one, same, 'the same address must hash the same way');
  assert.notEqual(one, otherSalt, 'a different salt must produce a different hash');
  assert.notEqual(one, otherIp, 'a different address must produce a different hash');
  assert.ok(!one.includes('203'), 'the hash must not contain the address');
  assert.equal(await hashIp({}, null), null, 'a missing address hashes to null, not a constant');
});

await test('the session cookie is HttpOnly, Secure and SameSite=Lax', () => {
  const cookie = sessionCookie('token-value', 7776000);
  assert.ok(cookie.startsWith('sid=token-value;'));
  for (const flag of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/', 'Max-Age=7776000']) {
    assert.ok(cookie.includes(flag), `session cookie is missing ${flag}`);
  }
});

await test('clearing the session cookie expires it immediately', () => {
  assert.ok(sessionCookie('', 0).includes('Max-Age=0'));
});

await test('getCookie reads one cookie out of a crowded header', () => {
  const request = new Request('https://atsy.test/', {
    headers: { cookie: 'other=1; sid=abc.def; another=2' },
  });
  assert.equal(getCookie(request, 'sid'), 'abc.def');
  assert.equal(getCookie(request, 'missing'), null);
});

await test('validEmail accepts real addresses and rejects the usual nonsense', () => {
  for (const good of ['a@b.co', 'first.last+tag@sub.domain.org']) {
    assert.equal(validEmail(good), true, `${good} should be valid`);
  }
  for (const bad of ['', 'plain', 'a@b', 'a b@c.com', '@no.local', 'no@domain.', null, 42,
    `${'x'.repeat(250)}@example.com`]) {
    assert.equal(validEmail(bad), false, `${String(bad).slice(0, 20)} should be invalid`);
  }
});

await test('readJson returns null for a malformed body instead of throwing', async () => {
  const bad = new Request('https://atsy.test/', { method: 'POST', body: 'not json' });
  assert.equal(await readJson(bad), null);
  const good = new Request('https://atsy.test/', { method: 'POST', body: '{"a":1}' });
  assert.deepEqual(await readJson(good), { a: 1 });
});

await test('no page sends a reader to GitHub, or anywhere else off the site', () => {
  // Owner rule: the product explains itself. A user chasing a rubric should
  // never land in a source repository.
  for (const page of htmlPages) {
    const links = [...read(page).matchAll(/<a[^>]+href="(https?:\/\/[^"]+)"/g)].map((m) => m[1]);
    assert.deepEqual(links, [], `${page} links off-site: ${links.join(', ')}`);
  }
});

await test('the home page reaches every other page', () => {
  const home = read('public/index.html');
  for (const path of ['/about', '/privacy', '/app']) {
    assert.ok(home.includes(`href="${path}"`), `the home page does not link to ${path}`);
  }
});

await test('every page footer carries the navigation, and no infrastructure boast', () => {
  for (const page of htmlPages) {
    const body = read(page);
    assert.ok(body.includes('class="footnav"'), `${page} has no footer navigation`);
    assert.ok(!/Built on Cloudflare/i.test(body), `${page} still names the host in the footer`);
  }
});

await test('the rubric is published on the site, in full', () => {
  // "Every check is published" is a promise on the home page. This is the
  // page that has to keep it.
  const about = read('public/about.html');
  const checks = [...about.matchAll(/<dt>([A-Z]\d{2})/g)].map((match) => match[1]);
  for (const prefix of ['P', 'B', 'C', 'D', 'E']) {
    assert.ok(checks.some((id) => id.startsWith(prefix)), `no ${prefix} checks are published`);
  }
  assert.ok(checks.length >= 45, `only ${checks.length} checks are published`);
  assert.equal(new Set(checks).size, checks.length, 'a check id is listed twice');
});

/* ---------------- bot shield ---------------- */

await test('an unconfigured bot shield lets people in rather than locking them out', async () => {
  // With no secret the shield is knowingly off. Calling siteverify with
  // Cloudflare's always-pass test secret looks harmless, but an empty token
  // still returns missing-input-response — so an unconfigured shield blocked
  // every sign-in on the live site for a reason that had nothing to do with
  // bots. Rate limits are what protect the endpoint in this state.
  let called = false;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { called = true; return new Response('{}'); };
  try {
    assert.equal(await verifyTurnstile({}, '', '203.0.113.1'), true);
    assert.equal(called, false, 'it must not even call siteverify without a secret');
  } finally {
    globalThis.fetch = realFetch;
  }
});

await test('a configured bot shield refuses a request with no token', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    success: false, 'error-codes': ['missing-input-response'],
  }));
  try {
    assert.equal(await verifyTurnstile({ TURNSTILE_SECRET_KEY: 'real-secret' }, '', null), false);
  } finally {
    globalThis.fetch = realFetch;
  }
});

await test('the local bypass works only through a dev flag', async () => {
  assert.equal(await verifyTurnstile({ TURNSTILE_BYPASS: '1' }, '', null), true);
});

await test('the shipped Turnstile site key is a real one, not a test key', () => {
  // Cloudflare's test keys (1x…, 2x…, 3x…) always pass or always fail. Any of
  // them in production means the bot shield is decoration.
  const config = read('wrangler.jsonc');
  const key = config.match(/"TURNSTILE_SITE_KEY":\s*"([^"]+)"/)[1];
  assert.ok(key.startsWith('0x'), `${key} is a Turnstile test key, not a real site key`);
});

await test('the sign-in page lets Turnstile reach its own servers', () => {
  // script-src and frame-src alone are not enough: the widget makes its own
  // network calls, and connect-src 'self' silently stopped them, so no token
  // was ever produced and every sign-in was refused.
  const headers = read('public/_headers');
  const appRule = headers.split('/app.html')[1] || headers.split('/app')[1];
  const csp = appRule.split('\n').find((line) => line.includes('Content-Security-Policy'));
  const connect = csp.match(/connect-src ([^;]+)/)[1];
  assert.ok(connect.includes('https://challenges.cloudflare.com'),
    `the sign-in CSP blocks Turnstile's own requests: connect-src ${connect}`);
});

/* ---------------- outbound email ---------------- */

// A stand-in for the Email Service binding that records what would be sent.
function fakeMailer() {
  const sent = [];
  return {
    sent,
    env: {
      EMAIL_FROM: 'atsyhello@vibecod3.app',
      BCC_EMAIL: 'owner@example.com',
      REPLY_TO_EMAIL: 'owner@example.com',
      SEND_EMAIL: { sendRaw: (message) => { sent.push(message); return Promise.resolve(); } },
    },
  };
}

await test('every email carries the sender and reply-to the owner set', async () => {
  const mailer = fakeMailer();
  await sendEmail(mailer.env, 'user@example.com', 'Subject line', ['Hello.']);
  for (const message of mailer.sent) {
    assert.match(message.raw, /From: Atsy <atsyhello@vibecod3\.app>/);
    assert.match(message.raw, /Reply-To: <owner@example\.com>/);
  }
});

await test('the owner is copied on every email, as a real second delivery', async () => {
  // A Bcc header alone delivers nothing: the Email Service envelope carries
  // exactly one recipient, so the copy has to be its own send.
  const mailer = fakeMailer();
  await sendEmail(mailer.env, 'user@example.com', 'Subject line', ['Hello.']);
  assert.equal(mailer.sent.length, 2, 'one send to the user, one to the owner');
  assert.equal(mailer.sent[0].to, 'user@example.com');
  assert.equal(mailer.sent[1].to, 'owner@example.com');
  assert.match(mailer.sent[1].raw, /\[copy of an email Atsy sent to user@example\.com\]/);
});

await test('the owner is not copied twice on an email already addressed to him', async () => {
  const mailer = fakeMailer();
  await sendEmail(mailer.env, 'owner@example.com', 'Owner notification', ['Something happened.']);
  assert.equal(mailer.sent.length, 1);
});

await test("the owner's copy of a sign-in email never contains the live code", async () => {
  // Ten minutes of account access for whoever can read that second mailbox,
  // and a contradiction of the promise on /privacy that nobody at Atsy can
  // reach a user's data.
  const mailer = fakeMailer();
  const code = '482913';
  const body = [`Your code is: ${code}`, 'It works for 10 minutes.'];
  const subject = `${code} is your Atsy sign-in code`;
  await sendEmail(mailer.env, 'user@example.com', subject, body, {
    copyLines: maskCode(body, code),
    copySubject: maskCode([subject], code)[0],
  });
  const [toUser, toOwner] = mailer.sent;
  assert.ok(toUser.raw.includes(code), 'the user must still receive their code');
  // The whole message, headers included: the subject line starts with the code.
  assert.ok(!toOwner.raw.includes(code), 'no part of the copy may carry the code');
  assert.ok(toOwner.raw.includes('······'), 'the code should be visibly masked');
});

await test('masking replaces every occurrence of the code', () => {
  assert.deepEqual(maskCode(['123456 twice: 123456', 'none here'], '123456'),
    ['······ twice: ······', 'none here']);
});

/* ---------------- configuration safety ---------------- */

await test('wrangler.jsonc never carries the dev escape hatches or a secret', () => {
  const config = read('wrangler.jsonc');
  const varsBlock = config.slice(config.indexOf('"vars"'));
  assert.ok(!varsBlock.includes('"OTP_ECHO"'), 'OTP_ECHO must only be passed via wrangler dev --var');
  assert.ok(!varsBlock.includes('"TURNSTILE_BYPASS"'), 'TURNSTILE_BYPASS must only be passed via wrangler dev --var');
  // Key material is a Worker secret. A key in a var is a key in the git
  // history, and the development key is worse than none: it is public.
  assert.ok(!varsBlock.includes('"CV_MASTER_KEY"'), 'CV_MASTER_KEY must be a Worker secret, never a var');
  assert.ok(!varsBlock.includes('"IP_HASH_SALT"'), 'IP_HASH_SALT must be a Worker secret, never a var');
  assert.ok(!varsBlock.includes('"TURNSTILE_SECRET_KEY"'), 'the Turnstile secret must be a Worker secret, never a var');
  assert.ok(!read('wrangler.jsonc').includes('QUFB'), 'the development CV key leaked into wrangler.jsonc');
  assert.ok(!varsBlock.includes('"OTP_MAX_PER_IP_HOUR"'), 'the per-IP cap must never be raised in production config');
  for (const secret of ['TURNSTILE_SECRET_KEY', 'CV_MASTER_KEY', 'IP_HASH_SALT', 'CLOUDFLARE_API_TOKEN']) {
    assert.ok(!varsBlock.includes(`"${secret}"`), `${secret} is a Worker secret, never a var`);
  }
});

await test('every migration is applied in order and never edited in place', () => {
  const files = readdirSync('migrations').filter((f) => f.endsWith('.sql')).sort();
  assert.ok(files.length > 0, 'there must be at least one migration');
  files.forEach((file, index) => {
    assert.match(file, /^\d{4}_[a-z0-9_]+\.sql$/, `${file} does not follow NNNN_name.sql`);
    assert.equal(Number(file.slice(0, 4)), index + 1, `${file} breaks the migration sequence`);
  });
});

const schemaTables = () => {
  const schema = readdirSync('migrations')
    .filter((f) => f.endsWith('.sql'))
    .map((f) => read(join('migrations', f)))
    .join('\n');
  return [...schema.matchAll(/CREATE TABLE (\w+)/g)].map((match) => match[1]);
};

// A table holds user data when a row can be traced to a person. `skills` is a
// shared reference table — deleting an account must not empty the taxonomy —
// so the distinction is derived from the columns rather than kept as a list
// somebody has to remember to update.
const OWNERSHIP_COLUMNS = ['user_id', 'scan_id', 'email'];
const userDataTables = (env) => schemaTables().filter((table) => {
  const columns = env.DB.prepare(`PRAGMA table_info(${table})`).all().results
    .map((column) => column.name);
  return OWNERSHIP_COLUMNS.some((needle) => columns.includes(needle));
});

await test('every table holding user data is named somewhere in the delete cascade', () => {
  // A structural guard, so a table added by a future migration that nobody
  // wired into the cascade fails here even if no test fixture happens to put
  // a row in it. The cascade spans auth.js and the scan half it delegates to.
  const env = testEnv();
  const cascade = `${read('src/auth.js')}\n${read('src/scan.js')}`;
  for (const table of userDataTables(env)) {
    assert.ok(cascade.includes(`FROM ${table}`),
      `nothing in the delete cascade removes rows from ${table}`);
  }
});

await test('deleting an account really empties every table, not just the ones we remembered', async () => {
  // The behavioural half: a row in every table, then one delete, then every
  // table must be empty. Being told your data is gone while a row survives is
  // the worst kind of privacy bug, so this asserts the outcome rather than
  // the presence of a statement.
  const env = testEnv();
  const user = testUser(env);
  const { scan } = await (await createScan(uploadRequest(fixture('clean')), env, user)).json();
  env.DB.prepare('INSERT INTO scan_checks (scan_id, check_id) VALUES (?, ?)').bind(scan.id, 'P01').run();
  env.DB.prepare('INSERT INTO otp_codes (email, code_hash, expires_at, created_at) VALUES (?, ?, ?, ?)')
    .bind(user.email, 'hash', nowSec() + 600, nowSec()).run();
  env.DB.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at, last_used) VALUES (?, ?, ?, ?, ?)')
    .bind('token-hash', user.id, nowSec(), nowSec() + 600, nowSec()).run();
  env.DB.prepare(
    `INSERT INTO job_matches (scan_id, user_id, created_at, jd_hash, role_fit)
     VALUES (?, ?, ?, ?, ?)`,
  ).bind(scan.id, user.id, nowSec(), 'hash', 72).run();
  env.DB.prepare('INSERT INTO ai_user_usage (user_id, day, calls) VALUES (?, ?, ?)')
    .bind(user.id, '2026-08-31', 3).run();
  env.DB.prepare('INSERT INTO feedback (user_id, email, type, message, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(user.id, user.email, 'idea', 'A thought about the scoring.', nowSec()).run();
  await getScanFile(new Request('https://atsy.test/'), env, user, scan.id);

  const tables = userDataTables(env);
  for (const table of tables) {
    const { count } = env.DB.prepare(`SELECT COUNT(*) AS count FROM ${table}`).first();
    assert.ok(count > 0, `the test did not put a row in ${table}, so it proves nothing about it`);
  }

  const response = await deleteAccount(new Request('https://atsy.test/'), env, user);
  assert.equal(response.status, 200);
  for (const table of tables) {
    const { count } = env.DB.prepare(`SELECT COUNT(*) AS count FROM ${table}`).first();
    assert.equal(count, 0, `${table} still holds rows after the account was deleted`);
  }
  assert.equal(env.CV.objects.size, 0, 'the stored CV outlived the account');
  // And the shared taxonomy is untouched: one reader leaving must not empty a
  // reference table for everyone else.
  assert.ok(env.DB.prepare('SELECT COUNT(*) AS count FROM skills').first().count > 0,
    'deleting an account emptied the shared skills taxonomy');
});

await test('the entry module exports only the fetch handler', () => {
  const worker = read('worker.js');
  const exports = worker.match(/^export\s+(?!default)/gm) || [];
  assert.equal(exports.length, 0, 'workerd rejects non-handler exports on the entry module');
});

await test('every content security policy is strict, and only the sign-in page admits Turnstile', () => {
  const headers = read('public/_headers');
  const policies = headers.split('\n').filter((line) => line.includes('Content-Security-Policy'));
  assert.ok(policies.length >= 1, '_headers must set a CSP');
  for (const csp of policies) {
    assert.ok(csp.includes("default-src 'self'"), 'every CSP must default to self');
    assert.ok(csp.includes("object-src 'none'"), 'every CSP must forbid plugins');
    assert.ok(csp.includes("base-uri 'none'"), 'every CSP must pin the base URI');
    const scriptSources = (csp.match(/script-src ([^;]+)/) || [, ''])[1];
    for (const source of scriptSources.split(/\s+/).filter((s) => s.startsWith('http'))) {
      assert.equal(source, 'https://challenges.cloudflare.com',
        `unexpected script origin in a CSP: ${source}`);
    }
  }
  // The site-wide policy stays free of any third-party script origin: only the
  // sign-in page may relax it.
  const global = policies.find((line) => headers.indexOf(line) < headers.indexOf('/app'));
  assert.ok(!/script-src[^;]*https:/.test(global), 'the site-wide CSP must have no external scripts');
});

await test('no page or stylesheet loads an asset from a third party', () => {
  // Pricey incident #30: a CDN-hosted brand font silently never rendered, and
  // the review harness could not see it. Links a user clicks are fine; assets
  // the page loads are not.
  for (const file of [...htmlPages, 'public/atsy.css']) {
    const body = read(file);
    // A <link> only loads something for some values of rel: canonical and
    // alternate are declarations about the page, not fetches.
    const loadingLinks = [...body.matchAll(/<link[^>]*>/g)]
      .map((match) => match[0])
      .filter((tag) => /href=["']https?:\/\//.test(tag))
      .filter((tag) => !/rel=["'](canonical|alternate)["']/.test(tag));
    const loaded = [
      ...(body.match(/\ssrc=["']https?:\/\/[^"']+/g) || []),
      ...loadingLinks,
      ...(body.match(/url\(["']?https?:\/\/[^)]+/g) || []),
    ];
    assert.deepEqual(loaded, [], `${file} loads an external asset: ${loaded.join(', ')}`);
  }
});

await test('the only third-party origin any script can reach is Turnstile', () => {
  // Turnstile is the single permitted external embed. Anything else appearing
  // in front-end code is a regression, whoever added it.
  const ALLOWED = new Set(['challenges.cloudflare.com']);
  for (const file of ['public/app.js', 'public/auth.js', 'public/xray.js']) {
    const origins = [...read(file).matchAll(/https?:\/\/([^/"'\s)]+)/g)].map((match) => match[1]);
    for (const origin of origins) {
      assert.ok(ALLOWED.has(origin), `${file} reaches ${origin}, which is not an allowed origin`);
    }
  }
});

await test('PDF.js is vendored, complete, and version-matched', () => {
  // The X-ray draws somebody's CV. A renderer fetched from a CDN is a renderer
  // that can stop existing, change under us, or watch who opens it — the same
  // failure mode as the brand font that silently stopped rendering for weeks.
  const build = 'public/vendor/pdfjs/';
  for (const [name, floor] of [['pdf.mjs', 200_000], ['pdf.worker.mjs', 800_000]]) {
    assert.ok(statSync(join(build, name)).size > floor,
      `${name} is missing or too small to be the real build`);
  }
  assert.ok(statSync(join(build, 'LICENSE')).size > 1000, 'the Apache-2.0 licence is not vendored');

  // The library and its worker must come from one version or the worker
  // refuses to start, and the X-ray fails for everyone at once.
  const stamped = (file) => (read(join(build, file)).match(/\b(\d+\.\d+\.\d+)\b/) || [])[1];
  assert.equal(stamped('pdf.mjs'), stamped('pdf.worker.mjs'),
    'pdf.mjs and pdf.worker.mjs are from different releases of PDF.js');
  assert.equal(read(join(build, 'VERSION')).trim(), stamped('pdf.mjs'),
    'VERSION does not match the build that is actually vendored');
});

await test('the X-ray asks for nothing the app page does not allow', () => {
  // A URL in xray.js that the page's CSP does not permit is a feature that
  // works in review and fails silently in production.
  const script = read('public/xray.js');
  const urls = [...script.matchAll(/'(\/[^']*)'/g)].map((match) => match[1])
    .filter((url) => url.startsWith('/vendor') || url.startsWith('/api'));
  assert.ok(urls.length >= 3, 'expected the library, the worker and the font directory');
  for (const url of urls) {
    if (!url.startsWith('/vendor')) continue;
    const path = join('public', url.replace(/^\//, ''));
    assert.ok(statSync(path), `${url} is referenced but not vendored`);
  }

  // The comment above the policy mentions worker-src too, so match the header
  // itself rather than the first line that happens to contain the word.
  const policy = read('public/_headers').split('\n')
    .find((line) => line.includes('Content-Security-Policy') && line.includes('worker-src'));
  assert.ok(policy, 'the app page allows no worker, so PDF.js cannot start');
  assert.ok(policy.includes("worker-src 'self'"), 'the PDF.js worker is same-origin');
  assert.ok(!policy.includes('unsafe-eval'),
    'the X-ray must not need eval — PDF.js is started with isEvalSupported false');
});

await test('every self-hosted font referenced by the stylesheet exists', () => {
  const css = read('public/atsy.css');
  const urls = [...css.matchAll(/url\('([^']+)'\)/g)].map((match) => match[1]);
  assert.ok(urls.length >= 3, 'expected three self-hosted variable fonts');
  for (const url of urls) {
    const path = join('public', url.replace(/^\//, ''));
    assert.ok(statSync(path).size > 1000, `${path} is missing or empty`);
  }
});

await test('no emoji anywhere in the interface', () => {
  // Owner order: emoji are never used as chrome, labels or decoration.
  const emoji = /\p{Extended_Pictographic}/u;
  for (const file of [...htmlPages, 'public/atsy.css', 'public/app.js']) {
    const hit = read(file).match(emoji);
    assert.equal(hit, null, `${file} contains an emoji: ${hit && hit[0]}`);
  }
});

// Read one CSS block by matching braces from a starting selector. Slicing to
// the end of the file instead — which this test used to do — silently swept
// every later component rule into "the dark block", so a component-local
// custom property looked like an undefined theme token.
function cssBlockAt(css, selector) {
  const start = css.indexOf(selector);
  if (start < 0) return '';
  let depth = 0;
  for (let index = css.indexOf('{', start); index < css.length; index += 1) {
    if (css[index] === '{') depth += 1;
    else if (css[index] === '}') {
      depth -= 1;
      if (depth === 0) return css.slice(start, index + 1);
    }
  }
  return css.slice(start);
}

await test('every colour token is defined on bare :root, not only in a theme block', () => {
  const css = read('public/atsy.css');
  const rootBlock = cssBlockAt(css, ':root {');
  const tokensIn = (block) => new Set([...block.matchAll(/(--[a-z0-9-]+):/g)].map((m) => m[1]));
  const light = tokensIn(rootBlock);

  // Both places dark is defined: the explicit toggle and the system default.
  for (const selector of [":root[data-theme='dark']", '@media (prefers-color-scheme: dark)']) {
    for (const token of tokensIn(cssBlockAt(css, selector))) {
      assert.ok(light.has(token), `${token} is defined for dark (${selector}) but never on bare :root`);
    }
  }
});

await test('no class name is styled by two different components', () => {
  // A reused class name silently inherits another component's layout. The
  // annotation pins once took the nav wordmark's display:inline-flex and 20px
  // type because both were called .mark.
  const css = read('public/atsy.css');
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const owners = new Map();
  for (const [, selector, body] of withoutComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    // Only single-class selectors with no combinator can collide this way.
    const name = selector.trim().match(/^\.([a-z0-9-]+)$/);
    if (!name || !/(^|[;\s])display\s*:/.test(body)) continue;
    owners.set(name[1], (owners.get(name[1]) || 0) + 1);
  }
  const clashes = [...owners.entries()].filter(([, count]) => count > 1).map(([name]) => `.${name}`);
  assert.deepEqual(clashes, [], `these classes set display in two separate rules: ${clashes.join(', ')}`);
});

await test('every shareable page carries the link-preview metadata a share needs', () => {
  // WhatsApp, Slack and iMessage read Open Graph tags, not the favicon: a page
  // without them shares as a bare grey link.
  //
  // A page marked noindex is not meant to be shared — the admin view is an
  // operations screen, and a preview card for it would be meaningless — so the
  // rule applies to the pages a reader might actually send someone.
  const required = ['og:title', 'og:description', 'og:image', 'og:url', 'og:type', 'og:site_name'];
  const shareable = htmlPages.filter((page) => !read(page).includes('name="robots"'));
  // Named rather than counted: the pages someone actually sends a friend are
  // the landing page and the two that explain the product, and a refactor that
  // quietly dropped one of them from this rule should fail here.
  for (const must of ['index.html', 'about.html', 'privacy.html']) {
    assert.ok(shareable.some((page) => page.endsWith(must)),
      `${must} must carry a share card`);
  }
  for (const page of shareable) {
    const body = read(page);
    for (const property of required) {
      assert.ok(body.includes(`property="${property}"`), `${page} is missing ${property}`);
    }
    assert.ok(body.includes('name="twitter:card"'), `${page} is missing the twitter card type`);
    // Relative image URLs are ignored by most preview crawlers.
    const image = body.match(/property="og:image" content="([^"]+)"/)[1];
    assert.ok(image.startsWith('https://'), `${page} has a relative og:image (${image})`);
    const url = body.match(/property="og:url" content="([^"]+)"/)[1];
    assert.ok(url.startsWith('https://atsy.vibecod3.app'), `${page} has a wrong og:url (${url})`);
    assert.ok(body.includes('rel="canonical"'), `${page} has no canonical URL`);
  }
});

await test('every icon and preview image referenced by a page exists and is a real image', () => {
  const referenced = new Set();
  for (const page of htmlPages) {
    const body = read(page);
    for (const match of body.matchAll(/(?:href|content)="(\/[^"]+\.(?:png|svg|webmanifest))"/g)) {
      referenced.add(match[1]);
    }
    for (const match of body.matchAll(/content="https:\/\/atsy\.vibecod3\.app(\/[^"]+\.png)"/g)) {
      referenced.add(match[1]);
    }
  }
  assert.ok(referenced.has('/og-image.png'), 'the share card must be referenced');
  assert.ok(referenced.has('/apple-touch-icon.png'), 'iOS needs a touch icon');
  for (const asset of referenced) {
    const stats = statSync(join('public', asset.slice(1)));
    assert.ok(stats.size > 200, `${asset} is missing or empty`);
  }
});

await test('the share card is the size preview crawlers expect, and small enough to fetch', () => {
  const declared = read('public/index.html');
  assert.ok(declared.includes('content="1200"') && declared.includes('content="630"'),
    'og:image dimensions must be declared so crawlers render the large card');
  // WhatsApp gives up on slow or oversized images.
  const bytes = statSync('public/og-image.png').size;
  assert.ok(bytes < 400_000, `og-image.png is ${Math.round(bytes / 1024)}KB, too heavy for a preview`);
});

await test('the web manifest points only at icons that exist', () => {
  const manifest = JSON.parse(read('public/site.webmanifest'));
  assert.ok(manifest.icons.length >= 2);
  for (const icon of manifest.icons) {
    assert.ok(statSync(join('public', icon.src.slice(1))).size > 200, `${icon.src} is missing`);
  }
  assert.equal(manifest.start_url, '/');
});

/* ---------------- extraction ---------------- */

const documents = new Map();
const parse = async (name) => {
  if (!documents.has(name)) documents.set(name, await extractDocument(fixture(name)));
  return documents.get(name);
};
const layoutOf = async (name) => analyseLayout(await parse(name));

await test('every fixture in the corpus parses', async () => {
  for (const name of fixtureNames) {
    const document = await parse(name);
    assert.ok(document.pageCount >= 1, `${name} produced no pages`);
  }
});

await test('the clean CV shows none of the defects', async () => {
  const document = await parse('clean');
  const layout = await layoutOf('clean');
  assert.equal(document.hasTextLayer, true);
  assert.equal(layout.multiColumn, false, 'a single-column CV must not be called two-column');
  assert.equal(layout.hasTable, false);
  assert.equal(layout.headerItems, 0, 'a name on the first line is not a running header');
  assert.equal(document.invisibleTextRuns, 0);
  assert.equal(document.backgroundColourTextRuns, 0);
  assert.ok(layout.worstReadingOrder > 0.99, 'stored order should match reading order');
});

await test('a scanned PDF is recognised as having no text layer', async () => {
  const document = await parse('imageOnly');
  assert.equal(document.hasTextLayer, false);
  assert.equal(document.charCount, 0);
  assert.ok(document.pages[0].images[0].areaRatio > 0.5, 'the scan covers most of the page');
});

await test('a two-column layout is found by its gutter', async () => {
  const layout = await layoutOf('twoColumn');
  assert.equal(layout.multiColumn, true);
  const { gutter } = layout.pages[0].columns;
  assert.ok(gutter.width >= 12, `gutter was only ${gutter.width}pt wide`);
  assert.ok(gutter.leftShare > 0.15 && gutter.rightShare > 0.15, 'both sides must hold content');
  assert.ok(gutter.pairedShare > 0.4, 'most rows should straddle the gutter');
});

await test('frame-ordered columns are found by BOTH the gutter and the reading order', async () => {
  // The two shapes of the same visual layout: text read across the gutter, and
  // a sidebar stored entirely before the main column. They damage a parse
  // differently, so they are separate findings.
  const layout = await layoutOf('twoColumnFrames');
  assert.equal(layout.multiColumn, true);
  assert.ok(layout.worstReadingOrder < 0.9,
    `stored order should diverge from reading order, got ${layout.worstReadingOrder}`);
});

await test('a table is reported as a table, and not also as two columns', async () => {
  const layout = await layoutOf('tableLayout');
  assert.ok(layout.hasTable, 'the table should be found');
  assert.equal(layout.pages[0].table.rows >= 3, true);
  assert.equal(layout.multiColumn, false, 'one problem must not be charged twice');
  assert.equal(layout.pages[0].columns.suppressedByTable, true);
});

await test('contact details in a running header are found on every page', async () => {
  const layout = await layoutOf('headerContact');
  assert.ok(layout.headerItems >= 2, 'the header band should hold the contact line');
  assert.equal(layout.repeatedHeader, true, 'the same band text on both pages is a running head');
});

await test('both kinds of hidden text are found, and only in the file that has them', async () => {
  const stuffed = await parse('hiddenText');
  assert.equal(stuffed.invisibleTextRuns, 1, 'text drawn in invisible render mode');
  assert.equal(stuffed.backgroundColourTextRuns, 1, 'text drawn in white on white');
  const clean = await parse('clean');
  assert.equal(clean.invisibleTextRuns + clean.backgroundColourTextRuns, 0);
});

await test('a photo is found with its position and size', async () => {
  const document = await parse('withPhoto');
  const [photo] = document.pages[0].images;
  assert.ok(photo, 'the photo should be found');
  assert.ok(photo.top < document.pages[0].height / 3, 'it sits in the top third');
  assert.ok(photo.areaRatio > 0.01 && photo.areaRatio < 0.2, 'it is a photo, not a scan');
});

await test('fonts are reported, including whether they are embedded', async () => {
  const document = await parse('clean');
  assert.ok(document.fonts.length >= 1);
  assert.equal(document.fonts[0].embedded, false,
    'a standard font with no embedded file must be reported as not embedded');
});

await test('page count is honoured and long documents are truncated, not refused', async () => {
  const full = await parse('fourPage');
  assert.equal(full.pageCount, 4);
  assert.equal(full.truncated, false);
  const clipped = await extractDocument(fixture('fourPage'), { maxPages: 2 });
  assert.equal(clipped.pagesRead, 2);
  assert.equal(clipped.truncated, true);
  assert.equal(clipped.pageCount, 4, 'the real page count is still reported');
});

await test('a file that is not a PDF is refused before anything is parsed', async () => {
  const notPdf = new TextEncoder().encode('PK\u0003\u0004 this is a zip');
  await assert.rejects(() => extractDocument(notPdf), (error) => {
    assert.equal(error instanceof UnreadablePdf, true);
    assert.equal(error.reason, 'not_pdf');
    return true;
  });
});

await test('extraction is deterministic and leaves the caller\'s bytes intact', async () => {
  // The whole product rests on the first half: same file, same result, every
  // time. The second half is what makes it possible — PDF.js detaches the
  // buffer it is handed, so extraction copies before parsing. Without that,
  // the same bytes cannot be encrypted for storage after being scanned.
  const bytes = fixture('clean');
  const first = JSON.stringify(await extractDocument(bytes));
  const second = JSON.stringify(await extractDocument(bytes));
  assert.equal(first, second);
  assert.equal(bytes.byteLength > 0, true, 'the input buffer must still be readable');
  assert.equal(JSON.parse(first).byteLength, bytes.byteLength, 'the file size must be recorded');
});

/* ---------------- sections and entities ---------------- */

const sectionsOf = async (name) => detectSections(await parse(name), await layoutOf(name));
const entitiesOf = async (name) => {
  const document = await parse(name);
  return extractEntities(document, await sectionsOf(name));
};

await test('canonical headings are matched, including through one typo', () => {
  assert.equal(canonicalSection('EXPERIENCE'), 'experience');
  assert.equal(canonicalSection('Work Experience'), 'experience');
  assert.equal(canonicalSection('Experiance'), 'experience', 'one typo is still the same heading');
  assert.equal(canonicalSection('Education & Training'), 'education');
  assert.equal(canonicalSection('Professional Summary'), 'summary');
  assert.equal(canonicalSection('My Journey'), null);
  assert.equal(canonicalSection('What I Bring'), null);
});

await test('a conventional CV yields every required section', async () => {
  const sections = await sectionsOf('clean');
  assert.deepEqual(sections.missingRequired, []);
  assert.deepEqual(sections.found.sort(), ['education', 'experience', 'skills', 'summary']);
  assert.deepEqual(sections.unknownHeadings, []);
  assert.ok(sections.preamble.length >= 3, 'the contact block sits above the first heading');
});

await test('creative headings are reported, and the name is not mistaken for one', async () => {
  const sections = await sectionsOf('oddHeadings');
  assert.deepEqual(sections.unknownHeadings, ['WHO I AM', 'MY JOURNEY', 'WHAT I BRING']);
  assert.ok(sections.missingRequired.includes('experience'));
  // The name and job title are set large at the top of page one. Reporting
  // them as unrecognised headings would send people to fix the one part of the
  // CV that is already conventional.
  assert.ok(!sections.unknownHeadings.includes('Priya Raman'));
  assert.ok(!sections.unknownHeadings.includes('Operations Manager'));
});

await test('date families are told apart, and mixing them is caught', () => {
  assert.equal(dateFamily('03/2023'), 'numeric');
  assert.equal(dateFamily('Mar 2023'), 'monthAbbrev');
  assert.equal(dateFamily('March 2023'), 'monthFull');
  assert.equal(dateFamily('2023'), 'yearOnly');
  assert.equal(dateFamily('sometime last year'), null);
});

await test('dates parse to a year and a month, and open ends are recognised', () => {
  assert.deepEqual(parseDate('Mar 2023'), { year: 2023, month: 3 });
  assert.deepEqual(parseDate('03/2023'), { year: 2023, month: 3 });
  assert.deepEqual(parseDate('March 2023'), { year: 2023, month: 3 });
  assert.deepEqual(parseDate('2014'), { year: 2014, month: null });
  assert.deepEqual(parseDate('Present'), { open: true });
  assert.deepEqual(parseDate('now'), { open: true });
  assert.equal(parseDate('not a date'), null);
});

await test('a date range is read from the forms CVs actually use', () => {
  const dash = findDateRanges('Mar 2023 - Present')[0];
  assert.equal(dash.open, true);
  assert.equal(dash.family, 'monthAbbrev');
  const numeric = findDateRanges('06/2019 - 02/2023')[0];
  assert.deepEqual(numeric.from, { year: 2019, month: 6 });
  assert.deepEqual(numeric.to, { year: 2023, month: 2 });
  assert.equal(findDateRanges('Managed rosters for 24 staff').length, 0);
});

await test('the contact block is read from a conventional CV', async () => {
  const { contact } = await entitiesOf('clean');
  assert.equal(contact.name, 'Priya Raman');
  assert.equal(contact.email, 'priya.raman@example.com');
  assert.ok(contact.phone, 'a phone number should be found');
  assert.equal(contact.phone.international, true, 'the number carries a country code');
  assert.ok(contact.link.includes('linkedin.com'));
});

await test('roles are built with title, employer, dates and tenure', async () => {
  const { roles, reverseChronological, hasOpenEndedCurrentRole } = await entitiesOf('clean');
  assert.equal(roles.length, 2);
  assert.equal(roles[0].title, 'Operations Manager');
  assert.equal(roles[0].employer, 'Kauri Logistics');
  assert.equal(roles[0].range.open, true, 'the current role runs to Present');
  assert.equal(roles[1].months, 44, 'Jun 2019 to Feb 2023 is 44 months');
  assert.equal(reverseChronological, true);
  assert.equal(hasOpenEndedCurrentRole, true);
});

await test('bullets are the claims, not the job titles or the dates', async () => {
  const { bullets } = await entitiesOf('clean');
  assert.equal(bullets.length, 5);
  assert.ok(bullets.every((bullet) => !/^Operations Manager,/.test(bullet)),
    'a role heading is structure, not a claim about what was done');
  assert.ok(bullets.some((bullet) => bullet.includes('82% to 96%')));
});

await test('two date formats in one CV are caught', async () => {
  const chaotic = await entitiesOf('dateChaos');
  assert.equal(chaotic.mixedDateFormats, true);
  assert.equal(chaotic.dateFamilies.length, 2);
  const clean = await entitiesOf('clean');
  assert.equal(clean.mixedDateFormats, false);
});

await test('a two-column layout costs the CV its sections and its roles', async () => {
  // Not a defect in the extractor: it is the damage the layout does, and the
  // reason the finding matters.
  const sections = await sectionsOf('twoColumn');
  const entities = await entitiesOf('twoColumn');
  assert.ok(sections.missingRequired.includes('experience'));
  assert.equal(entities.roles.length, 0);
});

/* ---------------- the scan pipeline ---------------- */

const scanOf = async (env, user, name, options) =>
  (await createScan(uploadRequest(fixture(name), options), env, user)).json();

await test('the whole corpus parses to a document model under plain node', async () => {
  // M2's acceptance criterion. No Cloudflare runtime, no network: if this
  // passes, every scoring check in M3 can be developed against real documents.
  assert.ok(fixtureNames.length >= 20,
    `the corpus must hold at least 20 CVs, found ${fixtureNames.length}`);
  for (const name of fixtureNames) {
    if (name === 'imageOnly') continue; // no text layer, asserted separately
    const model = await buildModel(fixture(name));
    assert.ok(model.document.pageCount >= 1, `${name} has no pages`);
    assert.ok(model.document.hasTextLayer, `${name} lost its text layer`);
    assert.ok(model.layout.pages.length >= 1, `${name} produced no layout`);
    assert.ok(Number.isFinite(model.sections.bodySize), `${name} has no body size`);
    assert.ok(Array.isArray(model.entities.bullets), `${name} produced no bullet list`);
  }
});

await test('the same PDF produces a byte-identical model summary twice', async () => {
  // The non-negotiable: no model in the scoring path, so no run-to-run drift.
  const first = modelSummary(await buildModel(fixture('clean')));
  const second = modelSummary(await buildModel(fixture('clean')));
  assert.equal(JSON.stringify(first), JSON.stringify(second));
});

await test('the stored summary carries no CV text', async () => {
  // The promise on /privacy, enforced rather than asserted. Every identity
  // string in the control fixture must be absent from what reaches D1.
  const model = await buildModel(fixture('clean'));
  const stored = JSON.stringify(modelSummary(model));
  const identity = [
    'Priya Raman', 'priya.raman@example.com', '555 0134', 'linkedin.com/in/priyaraman',
    'Kauri Logistics', 'Southbound Freight', 'University of Auckland',
    'Lifted on-time delivery', 'Power BI',
  ];
  for (const secret of identity) {
    assert.ok(!stored.includes(secret), `the stored summary leaked "${secret}"`);
  }
  // And the facts that replace it are really there.
  const summary = modelSummary(model);
  assert.equal(summary.entities.hasEmail, true);
  assert.equal(summary.entities.hasPhone, true);
  assert.ok(summary.entities.roleCount >= 2);
  assert.ok(summary.sections.found.includes('experience'));
});

await test('a filename cannot carry a path, a control character or a quote', () => {
  assert.equal(safeFilename('../../etc/passwd'), 'passwd');
  assert.equal(safeFilename('C:\\Users\\me\\cv.pdf'), 'cv.pdf');
  assert.equal(safeFilename('cv\u0000\u000a.pdf'), 'cv.pdf');
  assert.equal(safeFilename('a"b.pdf'), 'ab.pdf');
  assert.equal(safeFilename(''), 'cv.pdf');
  assert.equal(safeFilename(null), 'cv.pdf');
  assert.equal(safeFilename(`${'x'.repeat(400)}.pdf`).length, 120);
});

await test('scan ids are 128-bit hex and do not repeat', () => {
  const ids = new Set();
  for (let i = 0; i < 200; i += 1) {
    const id = newScanId();
    assert.match(id, /^[0-9a-f]{32}$/);
    ids.add(id);
  }
  assert.equal(ids.size, 200);
});

await test('an upload is stored encrypted, and the ciphertext is not the PDF', async () => {
  const env = testEnv();
  const user = testUser(env);
  const body = await scanOf(env, user, 'clean');
  assert.equal(body.scan.status, 'complete');
  assert.equal(body.scan.file_available, true);

  const stored = env.CV.objects.get(r2KeyFor(body.scan.id));
  assert.ok(stored, 'nothing reached the bucket');
  const plain = fixture('clean');
  assert.notEqual(stored.length, plain.length, 'the stored object is the same size as the PDF');
  assert.notEqual(
    Buffer.from(stored.slice(0, 5)).toString('latin1'), '%PDF-',
    'the stored object still begins with a PDF header',
  );
});

await test('the model reaches the reader but only the summary reaches the database', async () => {
  const env = testEnv();
  const user = testUser(env);
  const body = await scanOf(env, user, 'clean');
  // The browser that uploaded the file sees what was read out of it.
  assert.equal(body.scan.identity.email, 'priya.raman@example.com');
  assert.ok(body.scan.identity.name);

  const row = env.DB.prepare('SELECT model_json FROM scans WHERE id = ?').bind(body.scan.id).first();
  assert.ok(!row.model_json.includes('priya.raman@example.com'));
  assert.ok(!row.model_json.includes('Priya Raman'));

  // And re-opening the scan later cannot show it, because it was never kept.
  const reopened = await (await getScan(new Request('https://atsy.test/'), env, user, body.scan.id)).json();
  assert.equal(reopened.scan.identity, null);
  assert.equal(reopened.scan.model.entities.hasEmail, true);
});

await test('a scan carries a score, a band, pillars and engine risk', async () => {
  const env = testEnv();
  const user = testUser(env);
  const body = await scanOf(env, user, 'clean');
  assert.equal(body.scan.scored, true);
  assert.ok(body.scan.score >= 0 && body.scan.score <= 100, `score was ${body.scan.score}`);
  assert.ok(['excellent', 'strong', 'work', 'risk'].includes(body.scan.band));
  assert.equal(body.scan.result.pillars.length, 5);
  assert.equal(body.scan.result.engines.length, 6);
  assert.ok(body.scan.result.engineDisclaimer.includes('not a score from the engine itself'));

  // The score is on the row, not only in the response.
  const row = env.DB.prepare('SELECT score, band, pillars_json FROM scans WHERE id = ?')
    .bind(body.scan.id).first();
  assert.equal(row.score, body.scan.score);
  assert.equal(row.band, body.scan.band);
  assert.equal(JSON.parse(row.pillars_json).length, 5);

  // And every triggered check is recorded for the admin aggregates.
  const checks = env.DB.prepare('SELECT check_id FROM scan_checks WHERE scan_id = ?')
    .bind(body.scan.id).all().results.map((r) => r.check_id);
  assert.deepEqual([...checks].sort(), [...body.scan.result.findings.map((f) => f.id)].sort());
});

await test('a picture of a CV is refused with an explanation, not scored zero', async () => {
  const env = testEnv();
  const user = testUser(env);
  const response = await createScan(uploadRequest(fixture('imageOnly')), env, user);
  assert.equal(response.status, 422);
  const body = await response.json();
  assert.equal(body.reason, 'no_text');
  assert.match(body.message, /picture of a CV/);

  const row = env.DB.prepare('SELECT status, failure_reason, r2_key FROM scans').first();
  assert.equal(row.status, 'failed');
  assert.equal(row.failure_reason, 'no_text');
  // A file that cannot be scanned has no second use: it goes now, not in 24h.
  assert.equal(row.r2_key, null);
  assert.equal(env.CV.objects.size, 0);
});

await test('a file that is not a PDF is refused before anything is stored', async () => {
  const env = testEnv();
  const user = testUser(env);
  const response = await createScan(
    uploadRequest(new TextEncoder().encode('this is a Word document, really')), env, user);
  assert.equal(response.status, 422);
  assert.equal((await response.json()).reason, 'not_pdf');
  assert.equal(env.CV.objects.size, 0);
});

await test('every failure reason has a message a person can act on', () => {
  for (const reason of ['not_pdf', 'encrypted', 'xfa_form', 'corrupt', 'too_complex', 'no_text', 'storage']) {
    const message = failureMessage(reason);
    assert.ok(message.length > 40, `${reason} has no real explanation`);
    assert.ok(!/error|failed|invalid/i.test(message.split('.')[0]),
      `${reason} opens with jargon rather than what happened`);
  }
});

await test('an empty upload, a missing file and an oversized file are each refused', async () => {
  const env = testEnv();
  const user = testUser(env);
  assert.equal((await createScan(uploadRequest(new Uint8Array(0)), env, user)).status, 400);

  const noFile = new Request('https://atsy.test/api/scans', { method: 'POST', body: new FormData() });
  assert.equal((await createScan(noFile, env, user)).status, 400);

  const huge = new Uint8Array(MAX_UPLOAD_BYTES + 1);
  huge.set(new TextEncoder().encode('%PDF-1.7'));
  assert.equal((await createScan(uploadRequest(huge), env, user)).status, 413);
  assert.equal(env.CV.objects.size, 0);
});

await test('a scan is refused outright when the encryption key is missing', async () => {
  // Fail closed. A missing key must never degrade into storing a CV in clear.
  const env = testEnv({ CV_MASTER_KEY: '' });
  const user = testUser(env);
  const response = await createScan(uploadRequest(fixture('clean')), env, user);
  assert.equal(response.status, 503);
  assert.equal(env.CV.objects.size, 0);
  assert.equal(env.DB.prepare('SELECT COUNT(*) AS count FROM scans').first().count, 0);
});

await test('a bucket that will not accept the file fails the scan, not the record', async () => {
  const env = testEnv();
  env.CV.failPut = true;
  const user = testUser(env);
  const response = await createScan(uploadRequest(fixture('clean')), env, user);
  assert.equal(response.status, 502);
  // The code must say what actually failed: reporting a storage outage as an
  // unreadable PDF sends the next person straight to the parser.
  assert.equal((await response.json()).error, 'storage_failed');
  const row = env.DB.prepare('SELECT status, failure_reason, r2_key FROM scans').first();
  assert.equal(row.status, 'failed');
  assert.equal(row.failure_reason, 'storage');
  assert.equal(row.r2_key, null);
});

await test('the bot check gates uploads as well as sign-in', async () => {
  const env = testEnv({ TURNSTILE_BYPASS: '0', TURNSTILE_SECRET_KEY: 'x' });
  const user = testUser(env);
  // No network in tests, so siteverify cannot be reached — which is the
  // fail-closed path, and the one worth proving.
  const response = await createScan(uploadRequest(fixture('clean')), env, user);
  assert.equal(response.status, 403);
  assert.equal(env.CV.objects.size, 0);
});

await test('the daily scan cap holds', async () => {
  const env = testEnv({ SCANS_PER_DAY: '2' });
  const user = testUser(env);
  assert.equal((await createScan(uploadRequest(fixture('clean')), env, user)).status, 201);
  assert.equal((await createScan(uploadRequest(fixture('clean')), env, user)).status, 201);
  const third = await createScan(uploadRequest(fixture('clean')), env, user);
  assert.equal(third.status, 429);
  assert.equal((await third.json()).error, 'daily_limit');
});

/* ---------------- ownership ---------------- */

await test('one reader cannot open, download or delete another reader\'s scan', async () => {
  const env = testEnv();
  const owner = testUser(env, 'owner@example.com');
  const stranger = testUser(env, 'stranger@example.com');
  const { scan } = await scanOf(env, owner, 'clean');
  const request = new Request('https://atsy.test/');

  assert.equal((await getScan(request, env, stranger, scan.id)).status, 404);
  assert.equal((await getScanFile(request, env, stranger, scan.id)).status, 404);
  assert.equal((await deleteScan(request, env, stranger, scan.id)).status, 404);
  // Nothing was touched: 404 has to mean "not yours", not "gone now".
  assert.equal(env.CV.objects.size, 1);
  assert.equal((await getScan(request, env, owner, scan.id)).status, 200);

  const list = await (await listScans(request, env, stranger)).json();
  assert.equal(list.scans.length, 0);
});

await test('the X-ray decrypts the original and is never cacheable', async () => {
  const env = testEnv();
  const user = testUser(env);
  const { scan } = await scanOf(env, user, 'clean');
  const response = await getScanFile(new Request('https://atsy.test/'), env, user, scan.id);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'application/pdf');
  assert.match(response.headers.get('cache-control'), /no-store/);

  const bytes = new Uint8Array(await response.arrayBuffer());
  assert.deepEqual(bytes, fixture('clean'), 'the round trip changed the file');

  // Every decryption is recorded, with a hashed address and never a real one.
  const audit = env.DB.prepare('SELECT action, scan_id, ip_hash FROM audit_log').first();
  assert.equal(audit.action, 'scan_file_read');
  assert.equal(audit.scan_id, scan.id);
});

await test('a tampered object is refused rather than half-read', async () => {
  const env = testEnv();
  const user = testUser(env);
  const { scan } = await scanOf(env, user, 'clean');
  const key = r2KeyFor(scan.id);
  const bytes = env.CV.objects.get(key);
  bytes[bytes.length - 1] ^= 0xff;
  env.CV.objects.set(key, bytes);

  const response = await getScanFile(new Request('https://atsy.test/'), env, user, scan.id);
  assert.equal(response.status, 500);
  assert.equal((await response.json()).error, 'file_unreadable');
});

await test('an object moved to another scan\'s key does not decrypt', async () => {
  // The scan id is bound into the key derivation, so ciphertext cannot be
  // reassigned to a row that did not produce it.
  const env = testEnv();
  const user = testUser(env);
  const first = (await scanOf(env, user, 'clean')).scan;
  const second = (await scanOf(env, user, 'tinyType')).scan;
  env.CV.objects.set(r2KeyFor(second.id), env.CV.objects.get(r2KeyFor(first.id)));

  const response = await getScanFile(new Request('https://atsy.test/'), env, user, second.id);
  assert.equal(response.status, 500);
});

await test('a row that claims a file the bucket does not have corrects itself', async () => {
  const env = testEnv();
  const user = testUser(env);
  const { scan } = await scanOf(env, user, 'clean');
  env.CV.objects.clear();

  const response = await getScanFile(new Request('https://atsy.test/'), env, user, scan.id);
  assert.equal(response.status, 410);
  const row = env.DB.prepare('SELECT r2_key FROM scans WHERE id = ?').bind(scan.id).first();
  assert.equal(row.r2_key, null, 'the row still advertises an X-ray that cannot open');
});

await test('deleting a scan takes its object, its checks and its audit rows', async () => {
  const env = testEnv();
  const user = testUser(env);
  const { scan } = await scanOf(env, user, 'clean');
  env.DB.prepare('INSERT INTO scan_checks (scan_id, check_id) VALUES (?, ?)').bind(scan.id, 'P01').run();
  await getScanFile(new Request('https://atsy.test/'), env, user, scan.id);

  const response = await deleteScan(new Request('https://atsy.test/'), env, user, scan.id);
  assert.equal(response.status, 200);
  assert.equal(env.CV.objects.size, 0);
  assert.equal(env.DB.prepare('SELECT COUNT(*) AS count FROM scans').first().count, 0);
  assert.equal(env.DB.prepare('SELECT COUNT(*) AS count FROM scan_checks').first().count, 0);
  assert.equal(env.DB.prepare('SELECT COUNT(*) AS count FROM audit_log').first().count, 0);
  // A second delete is a 404, not a second cascade.
  assert.equal((await deleteScan(new Request('https://atsy.test/'), env, user, scan.id)).status, 404);
});

await test('deleting an account takes every scan and every stored file with it', async () => {
  const env = testEnv();
  const user = testUser(env);
  const other = testUser(env, 'other@example.com');
  await scanOf(env, user, 'clean');
  await scanOf(env, user, 'tinyType');
  await scanOf(env, other, 'clean');
  assert.equal(env.CV.objects.size, 3);

  const removed = await deleteAllScansFor(env, user.id);
  assert.equal(removed, 2);
  assert.equal(env.CV.objects.size, 1, 'another reader lost their file too');
  assert.equal(env.DB.prepare('SELECT COUNT(*) AS count FROM scans').first().count, 1);
});

await test('history lists a reader\'s own scans, newest first, with file availability', async () => {
  const env = testEnv();
  const user = testUser(env);
  const first = (await scanOf(env, user, 'clean')).scan;
  const second = (await scanOf(env, user, 'tinyType')).scan;
  env.DB.prepare('UPDATE scans SET created_at = ? WHERE id = ?').bind(1000, first.id).run();
  env.DB.prepare('UPDATE scans SET created_at = ? WHERE id = ?').bind(2000, second.id).run();

  const list = await (await listScans(new Request('https://atsy.test/'), env, user)).json();
  assert.deepEqual(list.scans.map((scan) => scan.id), [second.id, first.id]);
  assert.equal(list.scans[0].file_available, true);
  // The list is facts about the scan, never its content.
  assert.ok(!JSON.stringify(list).includes('priya'));
});

/* ---------------- retention ---------------- */

await test('retention windows come from config and default to 24h and 30 days', () => {
  assert.equal(fileRetentionSeconds({}), 24 * 3600);
  assert.equal(recordRetentionSeconds({}), 30 * 86400);
  assert.equal(fileRetentionSeconds({ FILE_RETENTION_HOURS: '1' }), 3600);
  assert.equal(recordRetentionSeconds({ RECORD_RETENTION_DAYS: '7' }), 7 * 86400);
});

await test('a scan past its file window loses the PDF and keeps the result', async () => {
  const env = testEnv();
  const user = testUser(env);
  const { scan } = await scanOf(env, user, 'clean');

  const report = await purgeFiles(env, scan.created_at + 25 * 3600);
  assert.equal(report.purged, 1);
  assert.equal(env.CV.objects.size, 0);

  const row = env.DB.prepare('SELECT status, r2_key, model_json FROM scans WHERE id = ?')
    .bind(scan.id).first();
  assert.equal(row.r2_key, null);
  assert.equal(row.status, 'complete', 'the reader lost their result along with the file');
  assert.ok(row.model_json, 'the findings went with the PDF');
});

await test('a file still inside its window is left alone', async () => {
  const env = testEnv();
  const user = testUser(env);
  const { scan } = await scanOf(env, user, 'clean');
  const report = await purgeFiles(env, scan.created_at + 3600);
  assert.equal(report.purged, 0);
  assert.equal(env.CV.objects.size, 1);
});

await test('a bucket delete that fails leaves the key in place for the next sweep', async () => {
  // The recoverable failure is a row that still names a live object. A row
  // that has forgotten one is how ciphertext outlives its retention window.
  const env = testEnv();
  const user = testUser(env);
  const { scan } = await scanOf(env, user, 'clean');
  env.CV.failDelete = true;

  const failedSweep = await purgeFiles(env, scan.created_at + 25 * 3600);
  assert.equal(failedSweep.purged, 0);
  assert.equal(failedSweep.failed, 1);
  assert.ok(env.DB.prepare('SELECT r2_key FROM scans WHERE id = ?').bind(scan.id).first().r2_key);

  env.CV.failDelete = false;
  const retry = await purgeFiles(env, scan.created_at + 25 * 3600);
  assert.equal(retry.purged, 1);
  assert.equal(env.CV.objects.size, 0);
});

await test('a scan past its record window goes entirely, children and object first', async () => {
  const env = testEnv();
  const user = testUser(env);
  const { scan } = await scanOf(env, user, 'clean');
  env.DB.prepare('INSERT INTO scan_checks (scan_id, check_id) VALUES (?, ?)').bind(scan.id, 'P01').run();

  const report = await purgeRecords(env, scan.created_at + 31 * 86400);
  assert.equal(report.purged, 1);
  assert.equal(env.CV.objects.size, 0, 'the record went and left its ciphertext behind');
  assert.equal(env.DB.prepare('SELECT COUNT(*) AS count FROM scans').first().count, 0);
  assert.equal(env.DB.prepare('SELECT COUNT(*) AS count FROM scan_checks').first().count, 0);
});

await test('spent codes, dead sessions and old audit rows are swept', async () => {
  const env = testEnv();
  const user = testUser(env);
  const now = 10_000_000;
  env.DB.prepare('INSERT INTO otp_codes (email, code_hash, expires_at, created_at) VALUES (?, ?, ?, ?)')
    .bind('old@example.com', 'x', now - 100, now - 48 * 3600).run();
  env.DB.prepare('INSERT INTO otp_codes (email, code_hash, expires_at, created_at) VALUES (?, ?, ?, ?)')
    .bind('fresh@example.com', 'y', now + 600, now - 60).run();
  env.DB.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at, last_used) VALUES (?, ?, ?, ?, ?)')
    .bind('dead', user.id, now - 100, now - 1, now - 100).run();
  env.DB.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at, last_used) VALUES (?, ?, ?, ?, ?)')
    .bind('live', user.id, now - 100, now + 3600, now - 100).run();
  env.DB.prepare('INSERT INTO audit_log (user_id, action, ip_hash, created_at) VALUES (?, ?, ?, ?)')
    .bind(user.id, 'scan_file_read', 'h', now - 40 * 86400).run();

  const report = await purgeEphemera(env, now);
  assert.equal(report.codes, 1);
  assert.equal(report.sessions, 1);
  assert.equal(report.audit, 1);
  assert.equal(env.DB.prepare('SELECT COUNT(*) AS count FROM otp_codes').first().count, 1);
  assert.equal(env.DB.prepare('SELECT COUNT(*) AS count FROM sessions').first().count, 1);
});

await test('one failing stage does not stop the rest of the sweep', async () => {
  const env = testEnv();
  const user = testUser(env);
  const { scan } = await scanOf(env, user, 'clean');
  env.DB.prepare('INSERT INTO otp_codes (email, code_hash, expires_at, created_at) VALUES (?, ?, ?, ?)')
    .bind('old@example.com', 'x', 1, 1).run();
  // The stage most likely to fail is not the stage that matters most.
  env.CV.failDelete = true;

  const report = await runRetention(env, scan.created_at + 31 * 86400);
  assert.equal(report.files.failed, 1);
  assert.equal(report.ephemera.codes, 1, 'a failing R2 delete stopped the database sweep');
});

await test('the cron trigger that runs the sweep is configured', () => {
  const config = JSON.parse(read('wrangler.jsonc').replace(/^\s*\/\/.*$/gm, ''));
  assert.deepEqual(config.triggers.crons, ['*/30 * * * *']);
  assert.equal(config.vars.FILE_RETENTION_HOURS, '24');
  assert.equal(config.vars.RECORD_RETENTION_DAYS, '30');
});

/* ---------------- what the corpus proves ---------------- */

await test('the new fixtures each show the defect they were built for', async () => {
  const summaryOf = async (name) => modelSummary(await buildModel(fixture(name)));

  const noContact = await summaryOf('noContact');
  assert.equal(noContact.entities.hasEmail, false);
  assert.equal(noContact.entities.hasPhone, false);

  const footer = await summaryOf('footerContact');
  assert.ok(footer.layout.footerItems > 0, 'the contact line is not in the footer band');

  const running = await summaryOf('runningHeadFoot');
  assert.equal(running.layout.repeatedHeader, true);

  const noSections = await summaryOf('noSections');
  assert.ok(noSections.sections.missingRequired.length >= 3, 'a CV with no headings found sections');

  const oldest = await summaryOf('oldestFirst');
  assert.equal(oldest.entities.reverseChronological, false);
  assert.equal((await summaryOf('clean')).entities.reverseChronological, true);

  const gap = await summaryOf('careerGap');
  assert.ok(gap.entities.gapMonths.some((months) => months >= 12), 'the 19-month gap was not seen');
  assert.deepEqual((await summaryOf('clean')).entities.gapMonths, []);

  const tiny = await summaryOf('tinyType');
  assert.ok(tiny.sections.bodySize <= 8, `body size read as ${tiny.sections.bodySize}`);

  const bars = await summaryOf('skillBars');
  assert.ok(bars.sections.found.includes('skills'));
});

/* ---------------- scoring ---------------- */

// The golden corpus. Every score here was read off the engine and committed on
// purpose: docs/SCORING-SPEC.md §7 requires that a scoring change states its
// delta on every fixture, and a table nobody has to recompute is what makes
// that possible in a code review.
const GOLDEN = {
  clean:               { score:  99, band: 'excellent',  checks: 'E04' },
  twoColumn:           { score:  70, band: 'work',       checks: 'B02 B03 B04 B05 C01 C08 D01 D11 E01 P02 P11' },
  headerContact:       { score:  94, band: 'excellent',  checks: 'B04 D10 E04 P04' },
  imageOnly:           { score:  25, band: 'risk',       checks: 'B01 B02 B03 B04 B05 B07 C01 C08 D01 E01 P01 P11' },
  hiddenText:          { score:  40, band: 'risk',       checks: 'D09 E04 P14' },
  withPhoto:           { score:  99, band: 'excellent',  checks: 'B07 E04' },
  fourPage:            { score:  93, band: 'excellent',  checks: 'C03 D07 E04 P12' },
  oddHeadings:         { score:  84, band: 'strong',     checks: 'C01 D01 D11 E01 P11' },
  dateChaos:           { score:  95, band: 'excellent',  checks: 'C02 E04' },
  noMetrics:           { score:  85, band: 'strong',     checks: 'D02 D03 D04 D06 E04' },
  twoColumnFrames:     { score:  67, band: 'work',       checks: 'B02 B03 B04 B05 C01 C08 D01 D11 E01 P02 P03 P11' },
  tableLayout:         { score:  72, band: 'work',       checks: 'B02 B03 B04 B05 C01 C04 C08 D01 E01 P05 P11' },
  noContact:           { score:  93, band: 'excellent',  checks: 'B02 B03 B04 B05 E04' },
  footerContact:       { score:  93, band: 'excellent',  checks: 'B04 B05 B06 E04 P04' },
  runningHeadFoot:     { score:  88, band: 'strong',     checks: 'D02 D04 D10 E04 P04' },
  noSections:          { score:  83, band: 'strong',     checks: 'C01 C08 D01 E01 P11' },
  oldestFirst:         { score:  96, band: 'excellent',  checks: 'C03 E04' },
  careerGap:           { score:  97, band: 'excellent',  checks: 'C04 E04' },
  tinyType:            { score:  97, band: 'excellent',  checks: 'E04 P16' },
  noLanguage:          { score:  98, band: 'excellent',  checks: 'E04 P17' },
  wallOfText:          { score:  94, band: 'excellent',  checks: 'D04 D06 E04' },
  skillBars:           { score:  96, band: 'excellent',  checks: 'E03 P10' },
  noName:              { score:  97, band: 'excellent',  checks: 'B01 E04' },
  personalDetails:     { score:  99, band: 'excellent',  checks: 'B08 E04' },
  noPresentMarker:     { score:  98, band: 'excellent',  checks: 'C05 E04' },
  impossibleDates:     { score:  96, band: 'excellent',  checks: 'C04 C06 E04' },
  weakTitle:           { score:  95, band: 'excellent',  checks: 'C07 D06 E04' },
  mixedTense:          { score:  98, band: 'excellent',  checks: 'D08 E04' },
  pronouns:            { score:  93, band: 'excellent',  checks: 'D02 D05 E04' },
  skillsGrid:          { score:  93, band: 'excellent',  checks: 'E02 E04 E05 P05' },
  exoticFont:          { score:  97, band: 'excellent',  checks: 'E04 P06' },
  annotationOnlyLink:  { score:  97, band: 'excellent',  checks: 'B05 E04 P15' },
};

const scoreOf = async (name, options = {}) =>
  runChecks(await buildModel(fixture(name)), {
    filename: `${name}.pdf`, fileBytes: fixture(name).length, ...options,
  });

await test('every fixture scores exactly its golden value', async () => {
  for (const [name, expected] of Object.entries(GOLDEN)) {
    const result = await scoreOf(name);
    assert.equal(result.score, expected.score, `${name} scored ${result.score}, golden is ${expected.score}`);
    assert.equal(result.band, expected.band, `${name} banded ${result.band}, golden is ${expected.band}`);
    assert.equal(result.checkIds.slice().sort().join(' '), expected.checks,
      `${name} triggered a different set of checks`);
  }
});

await test('the golden table covers the whole corpus', () => {
  assert.deepEqual(Object.keys(GOLDEN).sort(), fixtureNames.slice().sort(),
    'a fixture without a golden score is a fixture nobody is watching');
});

await test('scoring the same CV twice is byte-identical', async () => {
  // The product promise: no model in the scoring path, so no drift. Without
  // this a re-scan could not be compared to the scan before it.
  for (const name of ['clean', 'twoColumn', 'hiddenText']) {
    const first = JSON.stringify(await scoreOf(name));
    const second = JSON.stringify(await scoreOf(name));
    assert.equal(first, second, `${name} did not score identically twice`);
  }
});

await test('every check in the catalogue is published on /about, with the same points', () => {
  // The rubric is a promise: anyone can read it and predict their result. An
  // engine that scores by rules the page does not list would break that.
  const page = read('public/about.html');
  const published = new Map([...page.matchAll(/<dt>([A-Z]\d{2})\s*<span>([^<]+)<\/span><\/dt>/g)]
    .map((match) => [match[1], match[2].trim()]));

  assert.equal(published.size, ALL_CHECKS.length,
    `the page publishes ${published.size} checks, the engine runs ${ALL_CHECKS.length}`);
  for (const check of ALL_CHECKS) {
    assert.ok(published.has(check.id), `${check.id} is not published on /about`);
    const shown = published.get(check.id);
    const expected = check.fatal ? `caps your score at ${check.cap}` : String(check.points);
    assert.equal(shown, expected,
      `${check.id} is worth ${expected} in the engine but /about says "${shown}"`);
  }
});

await test('pillar weights add to 100 and each pillar keeps its own points', async () => {
  assert.equal(PILLARS.reduce((sum, pillar) => sum + pillar.weight, 0), 100);
  const result = await scoreOf('twoColumn');
  for (const pillar of result.pillars) {
    assert.ok(pillar.score >= 0, `${pillar.id} went negative`);
    assert.ok(pillar.score <= pillar.weight, `${pillar.id} scored above its weight`);
  }
  // Deductions never cascade: a wrecked Pillar A leaves Pillar D intact.
  const contentPillar = result.pillars.find((pillar) => pillar.id === 'D');
  assert.ok(contentPillar.score > 15, 'a parse failure ate the content pillar');
});

await test('a fatal check caps the score and says so', async () => {
  const hidden = await scoreOf('hiddenText');
  assert.equal(hidden.score, 40, 'P14 must cap at 40');
  assert.equal(hidden.capped, true);
  assert.ok(hidden.rawScore > hidden.score, 'the cap did not actually bite');
  assert.deepEqual(hidden.caps.map((cap) => cap.id), ['P14']);

  const image = await scoreOf('imageOnly');
  assert.equal(image.score, 25, 'P01 must cap at 25');
  assert.ok(image.caps.some((cap) => cap.id === 'P01'));
});

await test('every finding carries a message, a fix and bounded evidence', async () => {
  for (const name of fixtureNames) {
    const result = await scoreOf(name);
    for (const finding of result.findings) {
      assert.ok(finding.message && finding.message.length > 30,
        `${name}/${finding.id} has no usable message`);
      assert.ok(['critical', 'major', 'minor'].includes(finding.severity));
      assert.ok(finding.title && finding.title.length > 3, `${finding.id} has no title`);
      for (const item of finding.evidence) {
        assert.ok(item.text.length <= 120,
          `${name}/${finding.id} evidence is ${item.text.length} characters, over the 120 cap`);
        assert.ok(item.page >= 1);
      }
    }
  }
});

await test('findings are ordered worst first', async () => {
  const result = await scoreOf('twoColumn');
  const rank = { critical: 0, major: 1, minor: 2 };
  for (let index = 1; index < result.findings.length; index += 1) {
    const previous = result.findings[index - 1];
    const current = result.findings[index];
    assert.ok(rank[previous.severity] <= rank[current.severity],
      'a minor finding was listed above a critical one');
  }
});

/* ---------------- checks that no fixture can express ---------------- */

// Four checks cannot be driven from a generated PDF: three need a font that
// maps characters the standard 14 do not carry (icon bullets, emoji, broken
// encodings), and one is a property of the upload rather than the document.
// They get direct tests against a synthetic context instead — the alternative
// is shipping a check with no evidence it fires.

const contextFor = async (name, options = {}) =>
  buildContext(await buildModel(fixture(name)), options);

const checkById = (id) => ALL_CHECKS.find((check) => check.id === id);

await test('P07 fires on corrupted encodings and not on clean text', async () => {
  const ctx = await contextFor('clean');
  assert.equal(checkById('P07').run(ctx), null);
  for (const broken of ['Managed (cid:214)(cid:88) teams', 'Oﬃce administration and ﬁnance']) {
    const hit = checkById('P07').run({ ...ctx, allText: `${ctx.allText}\n${broken}` });
    assert.ok(hit, `P07 missed: ${broken}`);
    assert.match(hit.message, /corrupted/);
  }
});

await test('P08 fires on icon-font bullets and not on plain ones', async () => {
  const ctx = await contextFor('clean');
  assert.equal(checkById('P08').run(ctx), null);
  const withIcons = {
    ...ctx,
    bodyLines: [{ page: 1, text: '\uF0B7 Led the migration of 14 depots' }],
  };
  assert.ok(checkById('P08').run(withIcons), 'a private-use bullet glyph was not caught');
});

await test('P09 fires on emoji and not on ordinary punctuation', async () => {
  const ctx = await contextFor('clean');
  assert.equal(checkById('P09').run(ctx), null);
  // Digits and # are matched by \p{Emoji}, which is why the check uses
  // explicit ranges: a phone number must never read as an emoji.
  assert.equal(checkById('P09').run({ ...ctx, allText: 'Call +64 21 555 0134 #ops' }), null);
  const hit = checkById('P09').run({ ...ctx, allText: 'Led the team \u{1F680} to target' });
  assert.ok(hit, 'an emoji was not caught');
});

await test('P13 judges the filename, which is not part of the document', async () => {
  const ctx = await contextFor('clean');
  assert.equal(checkById('P13').run({ ...ctx, filename: 'priya-raman-operations.pdf' }), null);
  for (const bad of ['cv final v3.pdf', 'my cv.pdf', 'resume.pdf', 'Priya CV #2.pdf', 'CV_ünïcode.pdf']) {
    assert.ok(checkById('P13').run({ ...ctx, filename: bad }), `P13 accepted ${bad}`);
  }
});

await test('every check has a fixture that fires it, or a direct test that does', async () => {
  const fired = new Set();
  for (const name of fixtureNames) {
    (await scoreOf(name)).checkIds.forEach((id) => fired.add(id));
  }
  // The four above are covered by the direct tests immediately preceding this
  // one; everything else must be provable from a real document.
  const DIRECTLY_TESTED = ['P07', 'P08', 'P09', 'P13'];
  const missing = ALL_CHECKS.map((check) => check.id)
    .filter((id) => !fired.has(id) && !DIRECTLY_TESTED.includes(id));
  assert.deepEqual(missing, [], `no fixture fires: ${missing.join(', ')}`);
  // And the control must stay quiet on nearly all of them.
  const clean = await scoreOf('clean');
  assert.ok(clean.score >= 95, `the control scored ${clean.score}`);
});

/* ---------------- engine simulation ---------------- */

await test('engine risk rises with the defects that engine is sensitive to', async () => {
  const clean = await scoreOf('clean');
  const columns = await scoreOf('twoColumn');
  const taleoClean = clean.engines.find((engine) => engine.id === 'taleo');
  const taleoColumns = columns.engines.find((engine) => engine.id === 'taleo');
  assert.ok(taleoColumns.risk > taleoClean.risk, 'columns did not raise Taleo risk');

  // Taleo is documented as the least forgiving, Ashby the most. The ordering
  // is the claim being made, so it is the thing to assert.
  const ashbyColumns = columns.engines.find((engine) => engine.id === 'ashby');
  assert.ok(taleoColumns.risk > ashbyColumns.risk, 'Taleo should be riskier than Ashby here');
});

await test('every engine card carries reasons, a band, and the disclaimer', async () => {
  const result = await scoreOf('twoColumn');
  assert.equal(result.engines.length, 6);
  for (const engine of result.engines) {
    assert.ok(engine.risk >= 0 && engine.risk <= 100, `${engine.id} risk out of range`);
    assert.ok(['low', 'medium', 'high'].includes(engine.band));
    assert.ok(engine.reasons.length >= 1, `${engine.id} gave no reason`);
    assert.ok(engine.reasons.every((reason) => !/^[A-Z]\d{2}$/.test(reason)),
      'an engine card showed a check id instead of a reason in words');
  }
  assert.match(result.engineDisclaimer, /not a score from the engine itself/);
});

await test('an image-only CV is maximum risk everywhere', async () => {
  const result = await scoreOf('imageOnly');
  for (const engine of result.engines) {
    assert.equal(engine.band, 'high', `${engine.id} was not high risk for a scan`);
  }
});

/* ---------------- skills taxonomy ---------------- */

await test('the taxonomy matches aliases, qualifiers and casing', () => {
  const env = testEnv();
  const rows = env.DB.prepare('SELECT canonical, alias, family, kind FROM skills').all().results;
  const taxonomy = buildMatcher(new Map(rows.map((row) =>
    [row.alias, { canonical: row.canonical, family: row.family, kind: row.kind }])));

  assert.ok(taxonomy.size > 300, `the taxonomy holds only ${taxonomy.size} aliases`);
  assert.equal(taxonomy.match('postgres').canonical, 'PostgreSQL');
  assert.equal(taxonomy.match('K8s').canonical, 'Kubernetes');
  assert.equal(taxonomy.match('  Power BI ').canonical, 'Power BI');
  assert.equal(taxonomy.match('Advanced SQL').canonical, 'SQL');
  assert.equal(taxonomy.match('Communication').kind, 'soft');
  assert.equal(taxonomy.match('Python').kind, 'hard');
  assert.equal(taxonomy.match('definitely not a skill'), null);

  // Scanning free text is how a job description is read.
  const found = taxonomy.scan('We need strong Python, some Kubernetes, and Power BI.');
  const names = found.map((skill) => skill.canonical);
  assert.ok(names.includes('Python') && names.includes('Kubernetes') && names.includes('Power BI'));
});

await test('the skill checks stand down when the taxonomy is unavailable', async () => {
  // A CV reported as having no recognised skills because a lookup table failed
  // to load would be a lie caused by an outage.
  const without = await scoreOf('clean', { taxonomy: null });
  assert.ok(!without.checkIds.includes('E03'), 'E03 fired without a taxonomy to judge against');
});

/* ---------------- Role Fit ---------------- */

const JD_OPERATIONS = [
  'Operations Manager',
  'Kauri Freight is hiring an Operations Manager for our Auckland depot network.',
  '',
  'Requirements:',
  '- 5+ years managing warehouse or dispatch operations',
  '- Strong SQL and Power BI for reporting',
  '- Experience with Lean and continuous improvement',
  '- ERP migration experience',
  '',
  'Nice to have:',
  '- Kubernetes',
  '- Salesforce',
].join('\n');

const taxonomyFor = (env) => {
  const rows = env.DB.prepare('SELECT canonical, alias, family, kind FROM skills').all().results;
  return buildMatcher(new Map(rows.map((row) =>
    [row.alias, { canonical: row.canonical, family: row.family, kind: row.kind }])));
};

const fitFor = async (name, jd, findings = []) => {
  const env = testEnv();
  const taxonomy = taxonomyFor(env);
  const ctx = buildContext(await buildModel(fixture(name)), { taxonomy });
  return roleFit(ctx, jd, findings);
};

await test('Role Fit scores the five components and totals them', async () => {
  const fit = await fitFor('clean', JD_OPERATIONS);
  assert.ok(fit, 'Role Fit returned nothing');
  assert.equal(fit.components.length, 5);
  assert.equal(fit.components.reduce((sum, part) => sum + part.weight, 0), 100);
  for (const part of fit.components) {
    assert.ok(part.score >= 0 && part.score <= part.weight, `${part.id} out of range`);
  }
  assert.ok(fit.score > 0 && fit.score <= 100, `score was ${fit.score}`);
  assert.deepEqual(fit.target, [75, 85]);
});

await test('Role Fit is deterministic for a fixed CV and JD', async () => {
  const first = JSON.stringify(await fitFor('clean', JD_OPERATIONS));
  const second = JSON.stringify(await fitFor('clean', JD_OPERATIONS));
  assert.equal(first, second);
});

await test('Role Fit finds the skills the CV has and names the ones it lacks', async () => {
  const fit = await fitFor('clean', JD_OPERATIONS);
  assert.ok(fit.matched.includes('SQL'), `matched: ${fit.matched.join(', ')}`);
  assert.ok(fit.matched.includes('Power BI'));
  // Kubernetes is in the JD's nice-to-have block and not in the CV.
  const missingNames = fit.missing.map((skill) => skill.name);
  assert.ok(missingNames.includes('Kubernetes'), `missing: ${missingNames.join(', ')}`);
  // Must-haves are listed before nice-to-haves.
  const firstNice = fit.missing.findIndex((skill) => !skill.mustHave);
  const lastMust = fit.missing.map((skill) => skill.mustHave).lastIndexOf(true);
  if (firstNice !== -1 && lastMust !== -1) assert.ok(lastMust < firstNice);
});

await test('a must-have counts double, so missing one costs more', async () => {
  const asMust = await fitFor('clean', [
    'Operations Manager', 'Requirements:', '- Kubernetes', '- SQL',
  ].join('\n'));
  const asNice = await fitFor('clean', [
    'Operations Manager', 'Nice to have:', '- Kubernetes', 'Requirements:', '- SQL',
  ].join('\n'));
  const mustSkills = asMust.components.find((part) => part.id === 'skills').score;
  const niceSkills = asNice.components.find((part) => part.id === 'skills').score;
  assert.ok(mustSkills < niceSkills,
    `missing a must-have (${mustSkills}) should cost more than missing a nice-to-have (${niceSkills})`);
});

await test('Role Fit never moves the Atsy Score', async () => {
  // The two numbers answer different questions. A score that changed because
  // someone pasted a different job would be useless for tracking progress.
  const model = await buildModel(fixture('clean'));
  const env = testEnv();
  const taxonomy = taxonomyFor(env);
  const before = runChecks(model, { filename: 'clean.pdf', fileBytes: 900, taxonomy }).score;
  const ctx = buildContext(model, { taxonomy });
  roleFit(ctx, JD_OPERATIONS, []);
  const after = runChecks(model, { filename: 'clean.pdf', fileBytes: 900, taxonomy }).score;
  assert.equal(before, after);
});

await test('the integrity guard caps Role Fit and says which rule fired', async () => {
  // Hidden text.
  const hidden = await fitFor('clean', JD_OPERATIONS, [{ id: 'P14' }]);
  assert.equal(hidden.capped, true);
  assert.ok(hidden.score <= 60, `capped score was ${hidden.score}`);
  assert.ok(hidden.capReasons.some((reason) => /hidden text/.test(reason)));

  // Keyword stuffing: the same term over and over.
  const stuffed = await fitFor('clean',
    ['Operations Manager', 'Requirements:', '- Process design'].join('\n'));
  assert.ok(stuffed, 'no fit for the stuffing case');

  // And a clean CV against a clean JD is not capped.
  const fine = await fitFor('clean', JD_OPERATIONS);
  assert.equal(fine.capped, false);
});

await test('tenure counts overlapping roles once', () => {
  const overlapping = [
    { range: { from: { year: 2020, month: 1 }, to: { year: 2024, month: 1 } } },
    { range: { from: { year: 2021, month: 1 }, to: { year: 2023, month: 1 } } },
  ];
  // Four years, not six: a contract running beside a permanent job is not
  // twice the experience.
  assert.equal(Math.round(totalTenureYears(overlapping)), 4);
});

await test('seniority bands read the title, and the highest word wins', () => {
  assert.equal(seniorityOf('Graduate Engineer'), 1);
  assert.equal(seniorityOf('Senior Engineer'), 2);
  assert.equal(seniorityOf('Head of Operations'), 3);
  assert.equal(seniorityOf('Something Unclassifiable'), null);
});

await test('a JD stating years is compared against real tenure', async () => {
  const fit = await fitFor('clean', JD_OPERATIONS);
  assert.equal(fit.askedYears, 5);
  assert.ok(fit.heldYears > 0, 'no tenure computed');
});

/* ---------------- AI rewrites ---------------- */

await test('redaction removes every identifier before the model sees the bullet', () => {
  const bullet = 'Priya Raman led the Kauri Logistics migration, see priya.raman@example.com '
    + 'or linkedin.com/in/priyaraman or call +64 21 555 0134.';
  const clean = redact(bullet, {
    name: 'Priya Raman',
    employers: ['Kauri Logistics', 'Southbound Freight'],
  });
  for (const secret of ['Priya', 'Raman', 'Kauri', 'priya.raman@example.com', '555 0134', 'linkedin.com']) {
    assert.ok(!clean.includes(secret), `redaction leaked "${secret}": ${clean}`);
  }
  // And it still reads as a sentence, or the model cannot rewrite it.
  assert.ok(clean.includes('[name]') && clean.includes('[employer]'));
  assert.ok(clean.includes('migration'), 'redaction ate the content too');
});

await test('redaction survives a name that also appears inside an email', () => {
  const clean = redact('Contact priya@kauri.co.nz — Priya delivered it.', { name: 'Priya Raman' });
  assert.ok(!clean.includes('priya'), `leaked a lowercase name: ${clean}`);
  assert.ok(!clean.includes('Priya'));
});

await test('the template fallback never invents a number', () => {
  const fallback = templateRewrite('Responsible for the depot network', 'D03');
  assert.equal(fallback.suggestion, null, 'the fallback must not write a bullet');
  assert.equal(fallback.source, 'template');
  assert.match(fallback.guidance, /add the number/);
  assert.ok(!/\d+%/.test(fallback.guidance), 'the fallback fabricated a metric');
});

await test('rewrites are refused for checks that better wording cannot fix', () => {
  // P02 is a two-column layout. No rewrite of a bullet fixes that, and
  // offering one would be a lie.
  assert.deepEqual(REWRITABLE, ['D02', 'D03', 'D04', 'D06']);
  assert.ok(!REWRITABLE.includes('P02'));
  assert.ok(!REWRITABLE.includes('B02'));
});

await test('with no AI binding the product still works, degraded and labelled', async () => {
  const env = testEnv();
  const user = testUser(env);
  const { scan } = await (await createScan(uploadRequest(fixture('noMetrics')), env, user)).json();

  const response = await rewriteBullets(new Request('https://atsy.test/'), env, user, scan.id, {
    bullets: [{ text: 'Responsible for the depot network', checkId: 'D03' }],
    identity: { name: 'Priya Raman' },
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.degraded, true);
  assert.equal(body.suggestions.length, 1);
  assert.equal(body.suggestions[0].source, 'template');
  assert.ok(body.suggestions[0].guidance);
  assert.match(body.label, /check it is true/);
});

await test('the daily neuron budget is spent, not guessed at', async () => {
  const env = testEnv();
  const user = testUser(env);
  const { scan } = await (await createScan(uploadRequest(fixture('noMetrics')), env, user)).json();

  // An AI binding that answers, so the budget is actually charged.
  env.AI = { run: async () => ({ response: 'Cut dispatch errors by [add number]% across the depot network.' }) };
  const request = new Request('https://atsy.test/');
  const first = await (await rewriteBullets(request, env, user, scan.id, {
    bullets: [{ text: 'Responsible for the depot network', checkId: 'D03' }],
  })).json();
  assert.equal(first.degraded, false);
  assert.equal(first.suggestions[0].source, 'ai');
  assert.ok(first.spentToday > 0, 'the budget was not charged');

  const day = today();
  assert.equal(await spentToday(env, day), first.spentToday);

  // Spend the budget, and the product degrades rather than failing.
  env.DB.prepare('UPDATE ai_usage SET neurons = ? WHERE day = ?').bind(DAILY_NEURON_BUDGET, day).run();
  const after = await (await rewriteBullets(request, env, user, scan.id, {
    bullets: [{ text: 'Responsible for the depot network', checkId: 'D03' }],
  })).json();
  assert.equal(after.degraded, true);
  assert.equal(after.reason, 'daily_budget');
  assert.equal(after.suggestions[0].source, 'template');
});

await test('a model that ignores its instructions is not shown to the reader', async () => {
  const env = testEnv();
  const user = testUser(env);
  const { scan } = await (await createScan(uploadRequest(fixture('noMetrics')), env, user)).json();
  // Both the model and the fallback return something unusable.
  env.AI = { run: async () => ({ response: 'Sure! Here are some thoughts:\n\n1. ...' }) };
  const body = await (await rewriteBullets(new Request('https://atsy.test/'), env, user, scan.id, {
    bullets: [{ text: 'Responsible for the depot network', checkId: 'D03' }],
  })).json();
  // "Sure! Here are some thoughts:" is a preamble, not a bullet.
  assert.equal(body.suggestions[0].source, 'template');
});

/* ---------------- feedback and admin ---------------- */

await test('feedback needs a real address and a real message', async () => {
  const env = testEnv();
  const post = (payload) => submitFeedback(
    new Request('https://atsy.test/api/feedback', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
    }), env, null, null,
  );
  assert.equal((await post({ email: 'nope', message: 'this is long enough' })).status, 400);
  assert.equal((await post({ email: 'a@b.co', message: 'short' })).status, 400);
  assert.equal((await post({ email: 'a@b.co', type: 'idea', message: 'The score felt wrong to me.' })).status, 200);

  const row = env.DB.prepare('SELECT email, type, message, status FROM feedback').first();
  assert.equal(row.email, 'a@b.co');
  assert.equal(row.type, 'idea');
  assert.equal(row.status, 'new');
});

await test('the admin endpoints are a 404 for everyone but the owner', async () => {
  const env = testEnv({ ADMIN_EMAILS: 'owner@example.com' });
  const stranger = testUser(env, 'stranger@example.com');
  const owner = testUser(env, 'owner@example.com');
  const request = new Request('https://atsy.test/');

  // 404, not 403: an endpoint that admits it exists is an endpoint worth
  // attacking.
  assert.equal((await adminStats(request, env, stranger)).status, 404);
  assert.equal((await adminFeedback(request, env, stranger)).status, 404);
  assert.equal((await adminStats(request, env, owner)).status, 200);
});

await test('no admin endpoint returns CV content, ever', async () => {
  // The promise on /privacy is that nobody at Atsy can read a CV. This is the
  // test that keeps it true as endpoints are added.
  const env = testEnv({ ADMIN_EMAILS: 'owner@example.com' });
  const reader = testUser(env, 'reader@example.com');
  const owner = testUser(env, 'owner@example.com');
  await createScan(uploadRequest(fixture('clean'), { filename: 'priya-raman-cv.pdf' }), env, reader);
  env.DB.prepare('INSERT INTO feedback (user_id, email, type, message, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(reader.id, reader.email, 'bug', 'The score seemed low.', nowSec()).run();

  const request = new Request('https://atsy.test/');
  const payloads = [
    JSON.stringify(await (await adminStats(request, env, owner)).json()),
    JSON.stringify(await (await adminFeedback(request, env, owner)).json()),
  ].join('\n');

  const forbidden = [
    'Priya Raman', 'priya.raman@example.com', 'Kauri Logistics',
    'Lifted on-time delivery', 'priya-raman-cv.pdf', 'Southbound Freight',
    'Power BI', 'University of Auckland',
  ];
  for (const secret of forbidden) {
    assert.ok(!payloads.includes(secret), `an admin endpoint leaked "${secret}"`);
  }
  // And it still answers the question the owner actually has.
  const stats = await (await adminStats(request, env, owner)).json();
  assert.ok(stats.scans.total >= 1);
  assert.ok(Array.isArray(stats.commonProblems));
  assert.ok(stats.commonProblems.every((problem) => /^[A-Z]\d{2}$/.test(problem.id)));
});

await test('the owner can see which problems are common, by count', async () => {
  const env = testEnv({ ADMIN_EMAILS: 'owner@example.com' });
  const owner = testUser(env, 'owner@example.com');
  const reader = testUser(env, 'reader@example.com');
  for (const name of ['twoColumn', 'twoColumnFrames', 'clean']) {
    await createScan(uploadRequest(fixture(name)), env, reader);
  }
  const stats = await (await adminStats(new Request('https://atsy.test/'), env, owner)).json();
  const columns = stats.commonProblems.find((problem) => problem.id === 'P02');
  assert.ok(columns, 'P02 did not appear in the aggregates');
  assert.equal(columns.count, 2);
  assert.equal(columns.title, 'Two-column layout');
});

await test('feedback can be resolved, and only by the owner', async () => {
  const env = testEnv({ ADMIN_EMAILS: 'owner@example.com' });
  const owner = testUser(env, 'owner@example.com');
  const stranger = testUser(env, 'stranger@example.com');
  env.DB.prepare('INSERT INTO feedback (email, type, message, created_at) VALUES (?, ?, ?, ?)')
    .bind('someone@example.com', 'bug', 'Something went wrong.', nowSec()).run();
  const id = env.DB.prepare('SELECT id FROM feedback').first().id;
  const body = (payload) => new Request('https://atsy.test/', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
  });

  assert.equal((await resolveFeedback(body({}), env, stranger, id)).status, 404);
  assert.equal((await resolveFeedback(body({ note: 'fixed in 0.8.0' }), env, owner, id)).status, 200);
  const row = env.DB.prepare('SELECT status, resolution_note FROM feedback WHERE id = ?').bind(id).first();
  assert.equal(row.status, 'done');
  assert.equal(row.resolution_note, 'fixed in 0.8.0');
});

await test('a feedback message is escaped before it reaches an admin view', async () => {
  // Feedback is untrusted user content and the inbox is HTML.
  const env = testEnv({ ADMIN_EMAILS: 'owner@example.com' });
  const owner = testUser(env, 'owner@example.com');
  env.DB.prepare('INSERT INTO feedback (email, type, message, created_at) VALUES (?, ?, ?, ?)')
    .bind('x@y.co', 'bug', '<script>alert(1)</script> and "quotes"', nowSec()).run();
  const body = await (await adminFeedback(new Request('https://atsy.test/'), env, owner)).json();
  assert.ok(!body.feedback[0].message.includes('<script>'), 'a script tag survived');
  assert.match(body.feedback[0].message, /&lt;script&gt;/);
});

/* ---------------- history, deltas and the report ---------------- */

await test('history carries the change against the previous scan', async () => {
  const env = testEnv();
  const user = testUser(env);
  const first = (await scanOf(env, user, 'twoColumn')).scan;
  const second = (await scanOf(env, user, 'clean')).scan;
  env.DB.prepare('UPDATE scans SET created_at = ? WHERE id = ?').bind(1000, first.id).run();
  env.DB.prepare('UPDATE scans SET created_at = ? WHERE id = ?').bind(2000, second.id).run();

  const list = await (await listScans(new Request('https://atsy.test/'), env, user)).json();
  assert.equal(list.scans[0].id, second.id, 'newest first');
  assert.equal(list.scans[0].delta, second.score - first.score);
  // The oldest scan has nothing to compare against, and says so with null
  // rather than a misleading zero.
  assert.equal(list.scans[1].delta, null);

  assert.ok(list.progress, 'no progress summary');
  assert.equal(list.progress.first, first.score);
  assert.equal(list.progress.latest, second.score);
  assert.equal(list.progress.change, second.score - first.score);
});

await test('a single scan has no delta and no progress summary', async () => {
  const env = testEnv();
  const user = testUser(env);
  await scanOf(env, user, 'clean');
  const list = await (await listScans(new Request('https://atsy.test/'), env, user)).json();
  assert.equal(list.scans[0].delta, null);
  assert.equal(list.progress, null);
});

await test('the printable report holds the findings and escapes every one', async () => {
  const env = testEnv();
  const user = testUser(env);
  const { scan } = await scanOf(env, user, 'twoColumn');

  const response = await scanReport(new Request('https://atsy.test/'), env, user, scan.id);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /text\/html/);
  assert.match(response.headers.get('cache-control'), /no-store/);
  // Self-contained: it must survive being saved and opened offline.
  assert.match(response.headers.get('content-security-policy'), /default-src 'none'/);

  const html = await response.text();
  assert.ok(html.includes('Atsy report'));
  assert.ok(html.includes('Two-column layout'), 'the report is missing its findings');
  assert.ok(html.includes('Parse &amp; structure') || html.includes('Parse & structure'));
  assert.ok(html.includes('not a score from the engine itself'), 'the engine disclaimer is missing');
  assert.ok(!html.includes('<script'), 'the report carries script');
});

await test('the report escapes evidence, which is text from a stranger PDF', async () => {
  const env = testEnv();
  const user = testUser(env);
  const { scan } = await scanOf(env, user, 'clean');
  // Force a finding whose evidence contains markup.
  env.DB.prepare('UPDATE scans SET findings_json = ? WHERE id = ?').bind(JSON.stringify({
    findings: [{
      id: 'D09', pillar: 'D', severity: 'minor', points: 2, fatal: false,
      title: '<img src=x onerror=alert(1)>',
      message: 'A message with <b>markup</b> in it.',
      evidence: [{ page: 1, text: '<script>alert(1)</script>', box: null }],
    }],
    caps: [], rawScore: 99, capped: false,
  }), scan.id).run();

  const html = await (await scanReport(new Request('https://atsy.test/'), env, user, scan.id)).text();
  assert.ok(!html.includes('<script>alert(1)</script>'), 'evidence was not escaped');
  assert.ok(!html.includes('<img src=x'), 'a finding title was not escaped');
  assert.ok(html.includes('&lt;script&gt;'));
});

await test('one reader cannot fetch another reader\'s report', async () => {
  const env = testEnv();
  const owner = testUser(env, 'owner@example.com');
  const stranger = testUser(env, 'stranger@example.com');
  const { scan } = await scanOf(env, owner, 'clean');
  assert.equal((await scanReport(new Request('https://atsy.test/'), env, stranger, scan.id)).status, 404);
});

/* ---------------- finding geometry (the X-ray's input) ---------------- */

await test('every box a finding carries sits inside its own page', async () => {
  // The X-ray draws these rectangles over the reader's own PDF. A box outside
  // the page, or with a negative size, would paint a highlight over nothing and
  // tell somebody their problem is somewhere it is not.
  let drawn = 0;
  for (const name of fixtureNames) {
    const model = await buildModel(fixture(name));
    const result = await scoreOf(name);
    const sizes = new Map(model.document.pages.map((page) => [page.number, page]));

    for (const finding of result.findings) {
      for (const piece of finding.evidence) {
        if (!piece.box) continue;
        const page = sizes.get(piece.page);
        assert.ok(page, `${name}/${finding.id}: a box on page ${piece.page}, which was never read`);
        const { x, top, width, height } = piece.box;
        for (const [label, value] of Object.entries({ x, top, width, height })) {
          assert.ok(Number.isFinite(value), `${name}/${finding.id}: box.${label} is ${value}`);
        }
        assert.ok(width > 0 && height > 0,
          `${name}/${finding.id}: a ${width}x${height} box cannot be drawn`);
        // One point of slack: a glyph may overhang its own advance width.
        assert.ok(x >= -1 && top >= -1,
          `${name}/${finding.id}: box starts off the page at ${x},${top}`);
        assert.ok(x + width <= page.width + 1 && top + height <= page.height + 1,
          `${name}/${finding.id}: box runs past the page (${x + width}x${top + height} `
          + `on a ${page.width}x${page.height} page)`);
        drawn += 1;
      }
    }
  }
  // Without this the whole test passes by finding nothing to check, which is
  // exactly how it would look if geometry stopped being emitted at all.
  assert.ok(drawn >= 30, `only ${drawn} findings across the corpus carry a region`);
});

await test('a box locates evidence without repeating it', async () => {
  // A box is geometry. If one ever carried text it would be a second copy of
  // the CV in the database, past the 120-character evidence cap and outside
  // everything the privacy page promises.
  for (const name of fixtureNames) {
    const result = await scoreOf(name);
    for (const finding of result.findings) {
      for (const piece of finding.evidence) {
        if (!piece.box) continue;
        assert.deepEqual(Object.keys(piece.box).sort(), ['height', 'top', 'width', 'x'],
          `${name}/${finding.id}: a box carries something other than coordinates`);
      }
    }
  }
});

await test('bullet regions stay aligned with the bullets themselves', async () => {
  // The two are derived from one merge and read by index. If they ever drift,
  // every bullet finding would point at the wrong line of somebody's CV.
  for (const name of fixtureNames) {
    const model = await buildModel(fixture(name));
    const { bullets, bulletBoxes } = model.entities;
    assert.equal(bulletBoxes.length, bullets.length,
      `${name}: ${bullets.length} bullets but ${bulletBoxes.length} regions`);
  }
});

await test('a bullet finding names the page the bullet is actually on', async () => {
  // Bullet evidence used to say "page 1" unconditionally, which sent a reader
  // with a two-page CV to the wrong page.
  const model = await buildModel(fixture('fourPage'));
  const { bullets, bulletBoxes } = model.entities;
  const later = bulletBoxes.findIndex((box) => box && box.page > 1);
  assert.ok(later >= 0, 'the multi-page fixture has no bullet past page 1 to check');
  assert.ok(bullets[later].length > 0);
});

/* ---------------- report ---------------- */

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log(`\n${failures.map((f, i) => `${i + 1}. ${f}`).join('\n\n')}\n`);
  process.exit(1);
}
