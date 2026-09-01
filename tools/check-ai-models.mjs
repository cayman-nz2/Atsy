// Do the models the Worker names actually exist, and can this account run them?
//
// A rewrite that fails falls back to deterministic guidance and returns 200, by
// design — the product must work with AI unavailable. The cost of that design
// is that a retired or mistyped model id looks exactly like a healthy deploy:
// every reader silently gets the fallback and nothing anywhere goes red. This
// is the only place with the credentials to tell the difference, so it asks.
//
// A missing model is a configuration error and fails the deploy. A model that
// exists but will not answer is reported as a warning: Workers AI having a bad
// afternoon must not block shipping an unrelated change.
//
// Run: node tools/check-ai-models.mjs
// Needs CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID.

import { MODEL, FALLBACK_MODEL } from '../src/rewrite.js';

const token = process.env.CLOUDFLARE_API_TOKEN;
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
const api = `https://api.cloudflare.com/client/v4/accounts/${account}`;
const auth = { authorization: `Bearer ${token}` };

if (!token || !account) {
  console.log('::warning::no Cloudflare credentials — skipping the AI model check');
  process.exit(0);
}

const warn = (message) => console.log(`::warning::${message}`);
const fail = (message) => { console.log(`::error::${message}`); process.exitCode = 1; };

async function readJson(url, init) {
  // A refused connection or a DNS failure throws rather than returning a
  // status. Unhandled, that ends the deploy with a stack trace over something
  // this step is explicitly allowed to be unsure about.
  let response;
  try {
    response = await fetch(url, init);
  } catch (error) {
    return { status: 0, body: null, text: `request failed: ${(error && error.message) || error}` };
  }
  const text = await response.text();
  try {
    return { status: response.status, body: JSON.parse(text) };
  } catch {
    return { status: response.status, body: null, text };
  }
}

/** Every model this account can see, by name. */
async function catalogue() {
  const { status, body } = await readJson(`${api}/ai/models/search?per_page=1000`, { headers: auth });
  if (!body || body.success !== true) {
    warn(`could not list Workers AI models (HTTP ${status}) — not treating that as a missing model`);
    return null;
  }
  return new Set((body.result || []).map((model) => model.name));
}

const named = [...new Set([MODEL, FALLBACK_MODEL])];
console.log(`the Worker asks for: ${named.join(', ')}`);

const available = await catalogue();
if (available) {
  console.log(`this account can see ${available.size} Workers AI models`);
  for (const model of named) {
    if (available.has(model)) {
      console.log(`  ok       ${model}`);
    } else {
      fail(`${model} is not in this account's Workers AI catalogue, so every rewrite falls back to `
        + 'deterministic guidance. Correct MODEL / FALLBACK_MODEL in src/rewrite.js.');
      // Near-misses make a retired or renamed model obvious at a glance.
      const family = model.split('/')[1] || model;
      const near = [...available].filter((name) => name.includes(family.split('-')[0])).slice(0, 8);
      if (near.length) console.log(`           closest names available: ${near.join(', ')}`);
    }
  }
}

// Existing is not the same as answering. One tiny call settles it, and prints
// what actually comes back — the thing no log outside Cloudflare can show.
const probe = await readJson(`${api}/ai/run/${MODEL}`, {
  method: 'POST',
  headers: { ...auth, 'content-type': 'application/json' },
  body: JSON.stringify({
    messages: [{ role: 'user', content: 'Reply with the single word: ready' }],
    max_tokens: 16,
  }),
});

if (probe.body && probe.body.success === true) {
  const reply = probe.body.result && (probe.body.result.response ?? probe.body.result);
  console.log(`${MODEL} answered: ${JSON.stringify(reply).slice(0, 200)}`);
} else {
  const errors = probe.body && probe.body.errors;
  warn(`${MODEL} did not answer (HTTP ${probe.status}): `
    + `${JSON.stringify(errors || probe.text || probe.body).slice(0, 400)}`);
}
