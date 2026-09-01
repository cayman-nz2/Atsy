// Prepare the local D1 database the E2E suite runs against.
//
// Applies migrations, then clears the one-time codes that otherwise survive
// between runs and let a stale code satisfy a test that should have needed a
// fresh one.
//
// The database name comes from wrangler.jsonc via tools/binding-names.mjs, so
// this follows the binding rather than drifting from it.

import { execFileSync } from 'node:child_process';
import { bindingName } from './binding-names.mjs';

const database = bindingName('d1-name');
const wrangler = (...args) =>
  execFileSync('npx', ['wrangler', 'd1', ...args], { stdio: 'inherit' });

console.log(`preparing local ${database}`);
wrangler('migrations', 'apply', database, '--local');
wrangler('execute', database, '--local', '--command', 'DELETE FROM otp_codes');
