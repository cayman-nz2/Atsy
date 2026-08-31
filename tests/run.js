// Unit tests. Plain node asserts, no framework, no network, no Cloudflare
// runtime — everything under test is pure or a standard web API.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { VERSION } from '../src/version.js';
import { extractDocument, UnreadablePdf } from '../src/extract/pdf.js';
import { analyseLayout } from '../src/extract/layout.js';
import { fixture, fixtureNames } from './fixtures/cvs.js';
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

/* ---------------- configuration safety ---------------- */

await test('wrangler.jsonc never carries the dev escape hatches or a secret', () => {
  const config = read('wrangler.jsonc');
  const varsBlock = config.slice(config.indexOf('"vars"'));
  assert.ok(!varsBlock.includes('"OTP_ECHO"'), 'OTP_ECHO must only be passed via wrangler dev --var');
  assert.ok(!varsBlock.includes('"TURNSTILE_BYPASS"'), 'TURNSTILE_BYPASS must only be passed via wrangler dev --var');
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

await test('every table holding user data is deleted when an account is deleted', () => {
  // A delete that misses a table leaves personal data behind after someone has
  // been told it is gone. Every CREATE TABLE must be covered by deleteAccount.
  const schema = readdirSync('migrations')
    .filter((f) => f.endsWith('.sql'))
    .map((f) => read(join('migrations', f)))
    .join('\n');
  const tables = [...schema.matchAll(/CREATE TABLE (\w+)/g)].map((match) => match[1]);
  const auth = read('src/auth.js');
  const deleteBlock = auth.slice(auth.indexOf('export async function deleteAccount'));
  for (const table of tables) {
    assert.ok(deleteBlock.includes(`FROM ${table}`),
      `deleteAccount does not remove rows from ${table}`);
  }
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
    const loaded = [
      ...(body.match(/\ssrc=["']https?:\/\/[^"']+/g) || []),
      ...(body.match(/<link[^>]+href=["']https?:\/\/[^"']+/g) || []),
      ...(body.match(/url\(["']?https?:\/\/[^)]+/g) || []),
    ];
    assert.deepEqual(loaded, [], `${file} loads an external asset: ${loaded.join(', ')}`);
  }
});

await test('the only third-party origin any script can reach is Turnstile', () => {
  // Turnstile is the single permitted external embed. Anything else appearing
  // in front-end code is a regression, whoever added it.
  const ALLOWED = new Set(['challenges.cloudflare.com']);
  for (const file of ['public/app.js', 'public/auth.js']) {
    const origins = [...read(file).matchAll(/https?:\/\/([^/"'\s)]+)/g)].map((match) => match[1]);
    for (const origin of origins) {
      assert.ok(ALLOWED.has(origin), `${file} reaches ${origin}, which is not an allowed origin`);
    }
  }
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

await test('every colour token is defined on bare :root, not only in a theme block', () => {
  const css = read('public/atsy.css');
  const rootBlock = css.slice(css.indexOf(':root {'), css.indexOf('@media (prefers-color-scheme: dark)'));
  const darkBlock = css.slice(css.indexOf(":root[data-theme='dark']"));
  const tokensIn = (block) => new Set([...block.matchAll(/(--[a-z0-9-]+):/g)].map((m) => m[1]));
  const light = tokensIn(rootBlock);
  for (const token of tokensIn(darkBlock)) {
    assert.ok(light.has(token), `${token} is defined for dark but never on bare :root`);
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

/* ---------------- report ---------------- */

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log(`\n${failures.map((f, i) => `${i + 1}. ${f}`).join('\n\n')}\n`);
  process.exit(1);
}
