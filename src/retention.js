// The retention sweep. Runs on a cron every 30 minutes.
//
// Retention that depends on someone remembering to delete things is not
// retention. Every scan carries the moment its file dies and the moment its
// record dies, so this is a query, and the promise on /privacy is a column
// rather than a policy.
//
// Order matters. The R2 delete happens first and the row is only updated once
// it succeeds: an object whose row already said "purged" would be invisible
// to every future sweep, which is exactly how ciphertext outlives its
// retention window. Failing the other way — a deleted object whose row still
// names it — is self-correcting, because the next read finds nothing and
// clears the key itself.

import { nowSec } from './util.js';

// Bounded so one sweep cannot run long enough to be killed halfway through.
// The next run picks up whatever is left thirty minutes later, and a backlog
// drains in a few passes rather than in one that never completes.
const FILE_BATCH = 200;
const RECORD_BATCH = 200;
// Rate-limit and audit rows are only useful while they can still explain
// something recent.
const OTP_KEEP_SEC = 24 * 3600;
const AUDIT_KEEP_SEC = 30 * 86400;

/**
 * Delete the stored PDFs of scans past `file_purge_after`, keeping the record
 * so the reader still has their result after the file is gone.
 */
export async function purgeFiles(env, now = nowSec()) {
  const { results } = await env.DB.prepare(
    'SELECT id, r2_key FROM scans WHERE r2_key IS NOT NULL AND file_purge_after <= ? LIMIT ?',
  ).bind(now, FILE_BATCH).all();

  let purged = 0;
  let failed = 0;
  for (const row of results) {
    try {
      if (env.CV) await env.CV.delete(row.r2_key);
    } catch (error) {
      // Leave the key in place. A row that still names a live object is the
      // recoverable failure; a row that has forgotten one is not.
      console.log('retention: could not delete', row.r2_key, error && error.message);
      failed += 1;
      continue;
    }
    const cleared = await env.DB.prepare(
      'UPDATE scans SET r2_key = NULL WHERE id = ? AND r2_key IS NOT NULL',
    ).bind(row.id).run();
    if (cleared.meta.changes) purged += 1;
  }
  return { purged, failed, considered: results.length };
}

/**
 * Delete scans past `record_purge_after` and everything hanging off them. A
 * record can reach here still holding a file — a scan is only 30 days old
 * once, and the file sweep may have failed every time — so the object goes
 * first, exactly as above.
 */
export async function purgeRecords(env, now = nowSec()) {
  const { results } = await env.DB.prepare(
    'SELECT id, r2_key FROM scans WHERE record_purge_after <= ? LIMIT ?',
  ).bind(now, RECORD_BATCH).all();
  if (!results.length) return { purged: 0, considered: 0 };

  let purged = 0;
  for (const row of results) {
    if (row.r2_key && env.CV) {
      try {
        await env.CV.delete(row.r2_key);
      } catch (error) {
        console.log('retention: record purge blocked on', row.r2_key, error && error.message);
        continue;
      }
    }
    // Children first, then the row: a scan_checks row whose scan is gone
    // would never be found again by anything that looks up scans.
    await env.DB.batch([
      env.DB.prepare('DELETE FROM scan_checks WHERE scan_id = ?').bind(row.id),
      env.DB.prepare('DELETE FROM job_matches WHERE scan_id = ?').bind(row.id),
      env.DB.prepare('DELETE FROM audit_log WHERE scan_id = ?').bind(row.id),
    ]);
    const removed = await env.DB.prepare('DELETE FROM scans WHERE id = ?').bind(row.id).run();
    if (removed.meta.changes) purged += 1;
  }
  return { purged, considered: results.length };
}

/**
 * Spent one-time codes, expired sessions, and audit rows past their window.
 * None of these are personal beyond a salted hash, and all of them stop being
 * useful quickly.
 */
export async function purgeEphemera(env, now = nowSec()) {
  const results = await env.DB.batch([
    env.DB.prepare('DELETE FROM otp_codes WHERE created_at <= ?').bind(now - OTP_KEEP_SEC),
    env.DB.prepare('DELETE FROM sessions WHERE expires_at <= ?').bind(now),
    env.DB.prepare('DELETE FROM audit_log WHERE created_at <= ?').bind(now - AUDIT_KEEP_SEC),
  ]);
  const [codes, sessions, audit] = results.map((result) => result.meta.changes);
  return { codes, sessions, audit };
}

/**
 * One sweep. Each stage is independent: a failure in one must not stop the
 * others, because the stage most likely to fail (R2) is not the stage that
 * matters most (records past 30 days).
 */
export async function runRetention(env, now = nowSec()) {
  const report = { at: now };
  for (const [name, stage] of [
    ['files', purgeFiles],
    ['records', purgeRecords],
    ['ephemera', purgeEphemera],
  ]) {
    try {
      report[name] = await stage(env, now);
    } catch (error) {
      console.log(`retention: ${name} stage failed:`, error && error.message);
      report[name] = { error: (error && error.message) || 'failed' };
    }
  }
  console.log('retention sweep:', JSON.stringify(report));
  return report;
}
