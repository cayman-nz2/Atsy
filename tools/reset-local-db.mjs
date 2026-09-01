// Prepare the local D1 database the E2E suite runs against.
//
// Applies migrations, then clears the rate-limit rows that otherwise
// accumulate across runs until the per-IP cap trips and the suite starts
// failing for a reason that has nothing to do with the change under test.
//
// The database name is read from wrangler.jsonc rather than written here.
// It used to be hardcoded in package.json, and when the database was renamed
// for the move to Oceania the scripts kept pointing at a name that no longer
// existed: migrations silently did not apply, and every E2E test failed
// against an empty schema.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// wrangler.jsonc is JSON with // comments. Strip whole-line comments only —
// enough for this file, and it never has to parse a general JSONC.
const config = JSON.parse(
  readFileSync('wrangler.jsonc', 'utf8').replace(/^\s*\/\/.*$/gm, ''),
);
const database = config.d1_databases[0].database_name;

const wrangler = (...args) =>
  execFileSync('npx', ['wrangler', 'd1', ...args], { stdio: 'inherit' });

console.log(`preparing local ${database}`);
wrangler('migrations', 'apply', database, '--local');
wrangler('execute', database, '--local', '--command', 'DELETE FROM otp_codes');
