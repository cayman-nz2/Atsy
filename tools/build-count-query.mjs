// Turn a wrangler table listing into one query that counts every table.
//
// Separate from the comparison so each half can be read, and so neither has to
// survive being quoted into a shell inside a YAML block.
//
// Usage: node tools/build-count-query.mjs <tables.json> <out.sql>

import { readFileSync, writeFileSync } from 'node:fs';

const [inPath, outPath] = process.argv.slice(2);
if (!inPath || !outPath) {
  console.error('usage: build-count-query.mjs <tables.json> <out.sql>');
  process.exit(2);
}

const raw = readFileSync(inPath, 'utf8');
let parsed;
try {
  parsed = JSON.parse(raw);
} catch {
  throw new Error(`${inPath} is not JSON. First 300 characters:\n${raw.slice(0, 300)}`);
}

const blocks = Array.isArray(parsed) ? parsed : [parsed];
const names = blocks.flatMap((block) => (block && block.results) || [])
  .map((row) => row.name)
  // _cf_KV and friends are D1's own bookkeeping, not Atsy's data. D1 does not
  // count them in `num_tables` either, and the export does not necessarily
  // carry them — so comparing them would fail the migration over a table that
  // is not ours and does not matter.
  .filter((name) => !name.startsWith('_cf_'));

if (!names.length) {
  throw new Error(`no tables found in ${inPath}. Shape was:\n${JSON.stringify(parsed).slice(0, 300)}`);
}

// A table name out of sqlite_master is not attacker-controlled, but a name
// that needs quoting would still break the query, so reject anything that is
// not a plain identifier rather than emit SQL that fails obscurely.
const bad = names.filter((name) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name));
if (bad.length) throw new Error(`table names need quoting: ${bad.join(', ')}`);

// One statement per table, not one UNION ALL over all of them.
//
// D1 rejected the compound form outright — "too many terms in compound SELECT:
// SQLITE_ERROR" at thirteen tables — and because the first version of this was
// inlined in the workflow, that error went straight to a redirected stdout and
// the step died without printing it.
//
// wrangler runs every statement in the file and returns one result block per
// statement, which the comparison flattens, so this costs nothing and has no
// ceiling.
const query = names
  .map((name) => `SELECT '${name}' AS t, COUNT(*) AS n FROM ${name};`)
  .join('\n');

writeFileSync(outPath, `${query}\n`);
console.log(`counting ${names.length} tables, one statement each`);
