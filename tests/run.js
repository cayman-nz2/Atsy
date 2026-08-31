// Unit tests. Plain node asserts, no framework, no network, no Cloudflare
// runtime — everything under test is pure or a standard web API.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { VERSION } from '../src/version.js';
import { RELEASES } from '../src/report.js';
import { json, err, escapeHtml, nowSec, SECURITY_HEADERS } from '../src/util.js';

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

/* ---------------- configuration safety ---------------- */

await test('wrangler.jsonc never carries the dev escape hatches or a secret', () => {
  const config = read('wrangler.jsonc');
  const varsBlock = config.slice(config.indexOf('"vars"'));
  assert.ok(!varsBlock.includes('"OTP_ECHO"'), 'OTP_ECHO must only be passed via wrangler dev --var');
  assert.ok(!varsBlock.includes('"TURNSTILE_BYPASS"'), 'TURNSTILE_BYPASS must only be passed via wrangler dev --var');
  for (const secret of ['TURNSTILE_SECRET_KEY', 'CV_MASTER_KEY', 'IP_HASH_SALT', 'CLOUDFLARE_API_TOKEN']) {
    assert.ok(!varsBlock.includes(`"${secret}"`), `${secret} is a Worker secret, never a var`);
  }
});

await test('the entry module exports only the fetch handler', () => {
  const worker = read('worker.js');
  const exports = worker.match(/^export\s+(?!default)/gm) || [];
  assert.equal(exports.length, 0, 'workerd rejects non-handler exports on the entry module');
});

await test('static assets ship a content security policy with no third-party origins', () => {
  const headers = read('public/_headers');
  assert.ok(headers.includes('Content-Security-Policy'), '_headers must set a CSP');
  const csp = headers.split('\n').find((line) => line.includes('Content-Security-Policy'));
  assert.ok(csp.includes("default-src 'self'"), 'CSP must default to self');
  assert.ok(csp.includes("object-src 'none'"), 'CSP must forbid plugins');
  assert.ok(!/script-src[^;]*https:/.test(csp), 'no third-party script origins');
});

await test('no page or stylesheet loads an asset from a third party', () => {
  // Pricey incident #30: a CDN-hosted brand font silently never rendered.
  const files = [...htmlPages, 'public/atsy.css', 'public/app.js'];
  for (const file of files) {
    const external = read(file).match(/(?:src|href)=["']https?:\/\/[^"']+/g) || [];
    assert.deepEqual(external, [], `${file} references an external asset: ${external.join(', ')}`);
    const cssExternal = read(file).match(/url\(["']?https?:\/\/[^)]+/g) || [];
    assert.deepEqual(cssExternal, [], `${file} loads an external url(): ${cssExternal.join(', ')}`);
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

/* ---------------- report ---------------- */

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log(`\n${failures.map((f, i) => `${i + 1}. ${f}`).join('\n\n')}\n`);
  process.exit(1);
}
