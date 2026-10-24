// Tear Atsy down. Everything, permanently.
//
// Run only by .github/workflows/decommission.yml, which demands the literal
// word DESTROY as input. Order matters: the Worker goes first so nothing can
// write to the stores while they are being emptied, then the databases, then
// the buckets. R2 refuses to delete a bucket with objects in it, so each bucket
// is emptied through the API first. The old eastern-North-America pair that
// the Oceania move left in place is removed as well.
//
// Every step reports what it found and what it did. Nothing here is retried
// and nothing is silent: a resource that cannot be removed is named at the end
// and the job fails, so a half-finished teardown cannot read as a finished one.

import { execFileSync } from 'node:child_process';

const token = process.env.CLOUDFLARE_API_TOKEN;
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
if (!token || !account) { console.log('::error::Cloudflare credentials missing'); process.exit(1); }

const WORKER = 'atsy';
const DATABASES = ['atsy-db-oc', 'atsy-db'];
const BUCKETS = ['atsy-cv-oc', 'atsy-cv'];

const api = `https://api.cloudflare.com/client/v4/accounts/${account}`;
const auth = { authorization: `Bearer ${token}` };
const failures = [];

function wrangler(args) {
  console.log(`$ wrangler ${args.join(' ')}`);
  try {
    execFileSync('npx', ['wrangler@4', ...args], { stdio: 'inherit', env: process.env });
    return true;
  } catch {
    return false;
  }
}

async function cf(path, init = {}) {
  const response = await fetch(`${api}${path}`, { ...init, headers: { ...auth, ...(init.headers || {}) } });
  let body = null;
  try { body = await response.json(); } catch { body = null; }
  return { status: response.status, body };
}

// 1. The Worker. Deleting it removes its custom domain, routes and cron.
console.log('\n== Worker ==');
if (!wrangler(['delete', '--name', WORKER, '--force'])) {
  const probe = await cf(`/workers/scripts/${WORKER}`);
  if (probe.status === 404) console.log(`${WORKER}: already gone`);
  else failures.push(`worker ${WORKER} (HTTP ${probe.status})`);
}

// 2. Databases.
console.log('\n== D1 ==');
for (const name of DATABASES) {
  const list = await cf('/d1/database?per_page=1000');
  const found = (list.body?.result || []).find((db) => db.name === name);
  if (!found) { console.log(`${name}: not present`); continue; }
  const del = await cf(`/d1/database/${found.uuid}`, { method: 'DELETE' });
  if (del.body?.success) console.log(`${name}: deleted`);
  else failures.push(`d1 ${name} (HTTP ${del.status}: ${JSON.stringify(del.body?.errors)})`);
}

// 3. Buckets: empty, then delete.
console.log('\n== R2 ==');
for (const name of BUCKETS) {
  const head = await cf(`/r2/buckets/${name}`);
  if (head.status === 404) { console.log(`${name}: not present`); continue; }
  let removed = 0;
  let cursor = '';
  for (;;) {
    const page = await cf(`/r2/buckets/${name}/objects?per_page=1000${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
    const keys = (page.body?.result || []).map((o) => o.key);
    for (const key of keys) {
      const r = await cf(`/r2/buckets/${name}/objects/${encodeURIComponent(key)}`, { method: 'DELETE' });
      if (r.body?.success) removed += 1; else failures.push(`object ${name}/${key} (HTTP ${r.status})`);
    }
    cursor = page.body?.result_info?.cursor || '';
    if (!cursor || !keys.length) break;
  }
  console.log(`${name}: ${removed} object(s) removed`);
  const del = await cf(`/r2/buckets/${name}`, { method: 'DELETE' });
  if (del.body?.success) console.log(`${name}: deleted`);
  else failures.push(`r2 ${name} (HTTP ${del.status}: ${JSON.stringify(del.body?.errors)})`);
}

// 4. Turnstile widget, best effort — the site key is public and useless once
// the domain is gone, but it should not linger in the dashboard.
console.log('\n== Turnstile ==');
const widgets = await cf('/challenges/widgets');
for (const widget of widgets.body?.result || []) {
  if ((widget.domains || []).includes('atsy.vibecod3.app') || /atsy/i.test(widget.name || '')) {
    const r = await cf(`/challenges/widgets/${widget.sitekey}`, { method: 'DELETE' });
    console.log(`widget ${widget.sitekey}: ${r.body?.success ? 'deleted' : `not deleted (HTTP ${r.status})`}`);
  }
}

console.log('\n== Result ==');
if (failures.length) {
  for (const f of failures) console.log(`::error::still present: ${f}`);
  process.exit(1);
}
console.log('Atsy is gone: Worker, custom domain, both databases, both buckets.');
