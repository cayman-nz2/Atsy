// Count the rows in every table of one D1 database.
//
// Two earlier attempts failed for two different reasons, both worth keeping in
// mind before "simplifying" this:
//
//   1. One UNION ALL over every table — D1 rejects it outright with
//      "too many terms in compound SELECT" once there are a dozen tables.
//   2. One statement per table in a --file — wrangler returns a SUMMARY for a
//      multi-statement file ("Total queries executed: 12"), not the rows each
//      statement selected, so there is nothing to compare.
//
// So: one --command per table, each returning its own row. Slower, and the
// only shape that actually gives back the numbers.
//
// wrangler is invoked through execFileSync with an argument array, so nothing
// here is quoted into a shell. The first version of this logic lived inside
// `node -e` inside bash inside YAML and failed silently; a file with real
// arguments cannot go wrong the same way.
//
// Usage: node tools/count-d1-tables.mjs <database> <out.json>

import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const WRANGLER = 'wrangler@4.118.0';

const [database, outPath] = process.argv.slice(2);
if (!database || !outPath) {
  console.error('usage: count-d1-tables.mjs <database> <out.json>');
  process.exit(2);
}

/** Run one query and hand back its rows. */
function query(sql) {
  const raw = execFileSync(
    'npx',
    [WRANGLER, 'd1', 'execute', database, '--remote', '-y', '--json', '--command', sql],
    { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
  );
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`${database}: response to "${sql}" was not JSON.\n${raw.slice(0, 400)}`);
  }
  const blocks = Array.isArray(parsed) ? parsed : [parsed];
  return blocks.flatMap((block) => (block && block.results) || []);
}

const tables = query(
  "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
)
  .map((row) => row.name)
  // _cf_KV and friends are D1's own bookkeeping. D1 leaves them out of its own
  // num_tables and the export does not necessarily carry them, so comparing
  // them would fail a migration over a table that is not ours.
  .filter((name) => !name.startsWith('_cf_'));

if (!tables.length) throw new Error(`${database}: no tables found`);

const counts = tables.map((name) => {
  // Names come from sqlite_master, but a name needing quotes would still break
  // the query, so refuse rather than emit SQL that fails obscurely.
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error(`table name needs quoting: ${name}`);
  const rows = query(`SELECT COUNT(*) AS n FROM ${name}`);
  const n = rows.length ? Number(rows[0].n) : NaN;
  if (!Number.isFinite(n)) {
    throw new Error(`${database}: no count came back for ${name}. Got ${JSON.stringify(rows).slice(0, 200)}`);
  }
  process.stdout.write(`  ${name.padEnd(22)} ${n}\n`);
  return { t: name, n };
});

writeFileSync(outPath, JSON.stringify(counts, null, 2));
console.log(`${database}: counted ${counts.length} tables`);
