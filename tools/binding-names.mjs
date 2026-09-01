// The names of the Cloudflare resources Atsy binds, read from wrangler.jsonc.
//
// Everything that needs one asks here instead of spelling it out: the local
// E2E setup, provisioning, the deploy's `d1 migrations apply`, the storage
// region assertion. Two of those held a copy of the D1 name written by hand,
// and the rename for the move to Oceania left both pointing at a database that
// no longer existed — locally the migrations silently did not apply, and the
// deploy failed with "Couldn't find a D1 DB with the name or binding
// 'atsy-db'". A name kept in one place cannot drift from itself.
//
// Run it directly with a key to print one value, which is how a shell step
// reads it:  node tools/binding-names.mjs d1-name

import { readFileSync } from 'node:fs';

// wrangler.jsonc is JSON with // comments. Stripping whole-line comments is
// enough for this file, and it never has to parse a general JSONC.
function config(path) {
  return JSON.parse(readFileSync(path, 'utf8').replace(/^\s*\/\/.*$/gm, ''));
}

const readers = {
  'd1-name': (c) => c.d1_databases?.[0]?.database_name,
  'd1-id': (c) => c.d1_databases?.[0]?.database_id,
  'r2-bucket': (c) => c.r2_buckets?.[0]?.bucket_name,
};

export function bindingName(key, path = 'wrangler.jsonc') {
  const read = readers[key];
  if (!read) throw new Error(`unknown binding key '${key}'`);
  const value = read(config(path));
  if (!value) throw new Error(`no ${key} in ${path}`);
  return value;
}

if (process.argv[1] && process.argv[1].endsWith('binding-names.mjs')) {
  console.log(bindingName(process.argv[2]));
}
