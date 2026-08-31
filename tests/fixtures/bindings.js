// In-memory stand-ins for the D1 and R2 bindings, backed by node:sqlite.
//
// The point of these is that the scan pipeline — ownership binding,
// conditional updates, the delete cascade, the retention sweep — is testable
// under plain `node` against real SQL, not against a mock that agrees with
// whatever the code happens to do. The migrations in migrations/ are applied
// verbatim, so a column this code forgets is a failing test rather than a
// runtime error in production.
//
// Only the surface the Worker actually uses is implemented. Anything else
// throws, so a new call site cannot silently pass against a shim that quietly
// returns undefined.

import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATIONS = 'migrations';

class Statement {
  constructor(db, sql, args = []) {
    this.db = db;
    this.sql = sql;
    this.args = args;
  }

  bind(...args) {
    return new Statement(this.db, this.sql, args);
  }

  // SQLite rejects the booleans and undefined that JS hands it; D1 coerces
  // them. Matching that here keeps the tests honest about what the Worker
  // sends rather than making the Worker accommodate the shim.
  get bound() {
    return this.args.map((value) => {
      if (value === undefined || value === null) return null;
      if (typeof value === 'boolean') return value ? 1 : 0;
      return value;
    });
  }

  run() {
    const result = this.db.prepare(this.sql).run(...this.bound);
    return { success: true, meta: { changes: Number(result.changes) } };
  }

  first(column) {
    const row = this.db.prepare(this.sql).get(...this.bound);
    if (!row) return null;
    return column === undefined ? row : row[column];
  }

  all() {
    const results = this.db.prepare(this.sql).all(...this.bound);
    return { success: true, results, meta: { changes: 0 } };
  }
}

class FakeD1 {
  constructor() {
    this.db = new DatabaseSync(':memory:');
    // Cascades in this codebase are explicit, in code, so that the same
    // deletes run against D1 — which does not enforce foreign keys the way a
    // local SQLite would. Leaving them off here keeps the shim honest.
    for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()) {
      this.db.exec(readFileSync(join(MIGRATIONS, file), 'utf8'));
    }
  }

  prepare(sql) {
    return new Statement(this.db, sql);
  }

  async batch(statements) {
    return statements.map((statement) => statement.run());
  }
}

class FakeR2 {
  constructor() {
    this.objects = new Map();
    // Set to make the next call throw, so the failure paths — a put that
    // fails mid-scan, a delete the retention sweep cannot complete — are
    // exercised rather than assumed.
    this.failPut = false;
    this.failDelete = false;
  }

  async put(key, value) {
    if (this.failPut) throw new Error('r2 put failed');
    this.objects.set(key, value instanceof Uint8Array ? value : new Uint8Array(value));
    return { key };
  }

  async get(key) {
    const bytes = this.objects.get(key);
    if (!bytes) return null;
    return {
      key,
      size: bytes.length,
      arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    };
  }

  async delete(key) {
    if (this.failDelete) throw new Error('r2 delete failed');
    this.objects.delete(key);
  }
}

/** A fresh environment: empty database, empty bucket, working key material. */
export function testEnv(overrides = {}) {
  return {
    DB: new FakeD1(),
    CV: new FakeR2(),
    // 32 bytes, fixed so a failure is reproducible. Never a real key.
    CV_MASTER_KEY: Buffer.alloc(32, 7).toString('base64'),
    IP_HASH_SALT: 'test-salt',
    TURNSTILE_BYPASS: '1',
    ...overrides,
  };
}

/** A signed-in user row, created directly: sign-in itself is tested elsewhere. */
export function testUser(env, email = 'reader@example.com') {
  const now = Math.floor(Date.now() / 1000);
  env.DB.prepare('INSERT INTO users (email, country, created_at, last_seen) VALUES (?, ?, ?, ?)')
    .bind(email, 'NZ', now, now).run();
  return env.DB.prepare('SELECT id, email, created_at FROM users WHERE email = ?').bind(email).first();
}

/** A multipart upload request, the way the browser sends one. */
export function uploadRequest(bytes, { filename = 'cv.pdf', token = 'test-token' } = {}) {
  const form = new FormData();
  form.set('file', new File([bytes], filename, { type: 'application/pdf' }));
  form.set('turnstileToken', token);
  return new Request('https://atsy.test/api/scans', { method: 'POST', body: form });
}
