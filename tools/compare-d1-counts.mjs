// Compare per-table row counts between two D1 databases.
//
// Lives in a file rather than inside `node -e "..."` in a workflow. The first
// version of this was inlined, and three levels of quoting — YAML into bash
// into a JS template literal containing backticks — failed with no output at
// all. A verification step that can fail silently verifies nothing.
//
// Usage: node tools/compare-d1-counts.mjs <old.json> <new.json>
// Each file is the output of:
//   wrangler d1 execute <db> --remote -y --json --file count.sql

import { readFileSync } from 'node:fs';

/** Pull `[{ t, n }]` rows out of whatever shape wrangler handed back. */
function rowsOf(path) {
  const raw = readFileSync(path, 'utf8');
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Say what arrived. Guessing at a parse failure is how the inlined
    // version wasted a run.
    throw new Error(`${path} is not JSON. First 300 characters:\n${raw.slice(0, 300)}`);
  }
  // Either a plain [{t, n}] array from count-d1-tables.mjs, or wrangler's own
  // [{results: [...]}] envelope. Accepting both keeps this usable by hand.
  const blocks = Array.isArray(parsed) ? parsed : [parsed];
  const rows = blocks.every((block) => block && 't' in block)
    ? blocks
    : blocks.flatMap((block) => (block && block.results) || []);
  if (!rows.length) {
    throw new Error(`${path} carried no rows. Shape was:\n${JSON.stringify(parsed).slice(0, 300)}`);
  }
  return rows;
}

const [oldPath, newPath] = process.argv.slice(2);
if (!oldPath || !newPath) {
  console.error('usage: compare-d1-counts.mjs <old.json> <new.json>');
  process.exit(2);
}

const toMap = (rows) => Object.fromEntries(rows.map((row) => [row.t, Number(row.n)]));
const before = toMap(rowsOf(oldPath));
const after = toMap(rowsOf(newPath));

const names = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
let mismatched = 0;

for (const name of names) {
  const a = before[name];
  const b = after[name];
  const same = a === b;
  if (!same) mismatched += 1;
  console.log(`${same ? 'ok  ' : 'DIFF'} ${name.padEnd(22)} source=${a ?? '-'}  copy=${b ?? '-'}`);
}

const total = Object.values(before).reduce((sum, n) => sum + n, 0);
console.log(`\n${names.length} tables, ${total} rows in the source`);

if (mismatched) {
  console.log(`::error::${mismatched} table(s) differ — the copy is not faithful, do not cut over`);
  process.exit(1);
}
console.log('every table matches');
