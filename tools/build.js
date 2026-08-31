// Build = copy public/ into dist/. No bundler, no transform: what is in
// public/ is exactly what users receive.
//
// It also stamps dist/build.json. `wrangler dev` snapshots the asset directory
// at startup and does not always notice a wholesale rebuild, so a review can
// otherwise be looking at a build that no longer exists on disk. The E2E suite
// compares the served stamp with this one and fails loudly instead.
import { cp, rm, mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { VERSION } from '../src/version.js';

await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });
await cp('public', 'dist', { recursive: true });

const stamp = { version: VERSION, build: randomUUID(), builtAt: new Date().toISOString() };
await writeFile('dist/build.json', `${JSON.stringify(stamp, null, 2)}\n`);
console.log(`built dist/ from public/ - v${stamp.version} build ${stamp.build}`);
