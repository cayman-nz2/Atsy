// Syntax gate: parse every JavaScript file in the project (excluding
// dependencies and build output) so a typo can never reach a deploy.
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const SKIP = new Set(['node_modules', 'dist', '.git', '.wrangler', 'test-results', 'playwright-report']);

async function jsFiles(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await jsFiles(path)));
    else if (entry.name.endsWith('.js')) out.push(path);
  }
  return out;
}

const files = (await jsFiles('.')).sort();
for (const file of files) {
  // public/app.js is a classic script, not a module; check it as one.
  const args = file.startsWith('public/') ? ['--check', file] : ['--check', file];
  execFileSync(process.execPath, args, { stdio: 'pipe' });
}
console.log(`syntax ok: ${files.length} files`);
