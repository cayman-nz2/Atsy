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
const names = blocks.flatMap((block) => (block && block.results) || []).map((row) => row.name);

if (!names.length) {
  throw new Error(`no tables found in ${inPath}. Shape was:\n${JSON.stringify(parsed).slice(0, 300)}`);
}

// A table name out of sqlite_master is not attacker-controlled, but a name
// that needs quoting would still break the query, so reject anything that is
// not a plain identifier rather than emit SQL that fails obscurely.
const bad = names.filter((name) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name));
if (bad.length) throw new Error(`table names need quoting: ${bad.join(', ')}`);

const query = names
  .map((name) => `SELECT '${name}' AS t, COUNT(*) AS n FROM ${name}`)
  .join('\nUNION ALL ');

writeFileSync(outPath, `${query};\n`);
console.log(`counting ${names.length} tables`);
