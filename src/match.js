// POST /api/scans/:id/match — Role Fit against a pasted job description.
//
// The job description is somebody else's document and Atsy has no reason to
// keep it, so only a hash of it is stored. The hash exists to make pasting the
// same JD twice idempotent, not to reconstruct the text.

import { json, err, nowSec, sha256Hex, readJson } from './util.js';
import { buildModel } from './scan.js';
import { buildContext } from './scoring/context.js';
import { roleFit } from './scoring/role-fit.js';
import { loadTaxonomy } from './skills.js';
import { decryptFile, DecryptionFailed } from './crypto.js';

const MAX_JD_CHARS = 20000;

export async function matchScan(request, env, user, scanId) {
  const body = await readJson(request);
  const jd = body && typeof body.jobDescription === 'string' ? body.jobDescription.trim() : '';
  if (jd.length < 60) return err('job_description_too_short', 400);
  if (jd.length > MAX_JD_CHARS) return err('job_description_too_long', 413);

  const scan = await env.DB
    .prepare('SELECT id, r2_key, findings_json FROM scans WHERE id = ? AND user_id = ?')
    .bind(scanId, user.id).first();
  if (!scan) return err('not_found', 404);

  // Role Fit needs the CV's own words — which skills appear in which bullet —
  // and those were never stored. So the file is re-read and re-parsed. Once
  // it is purged at 24 hours, Role Fit is honestly unavailable rather than
  // computed from a summary that cannot support it.
  if (!scan.r2_key) return err('file_purged', 410);
  if (!env.CV) return err('storage_unavailable', 503);

  const object = await env.CV.get(scan.r2_key);
  if (!object) return err('file_purged', 410);

  let bytes;
  try {
    bytes = await decryptFile(env, scan.id, new Uint8Array(await object.arrayBuffer()));
  } catch (error) {
    if (error instanceof DecryptionFailed) return err('file_unreadable', 500);
    throw error;
  }

  const taxonomy = await loadTaxonomy(env);
  if (!taxonomy) return err('taxonomy_unavailable', 503);

  const model = await buildModel(bytes);
  const ctx = buildContext(model, { taxonomy });
  let findings = [];
  try {
    findings = (JSON.parse(scan.findings_json) || {}).findings || [];
  } catch { findings = []; }

  const fit = roleFit(ctx, jd, findings);
  if (!fit) return err('taxonomy_unavailable', 503);

  const jdHash = await sha256Hex(jd);
  await env.DB.prepare(
    `INSERT INTO job_matches (scan_id, user_id, created_at, jd_hash, role_fit, capped,
                              components_json, missing_json, matched_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(scan_id, jd_hash) DO UPDATE SET
       created_at = excluded.created_at,
       role_fit = excluded.role_fit,
       capped = excluded.capped,
       components_json = excluded.components_json,
       missing_json = excluded.missing_json,
       matched_json = excluded.matched_json`,
  ).bind(
    scanId, user.id, nowSec(), jdHash, fit.score, fit.capped ? 1 : 0,
    JSON.stringify(fit.components), JSON.stringify(fit.missing), JSON.stringify(fit.matched),
  ).run();

  return json({
    fit,
    // Said every time, because a reader chasing 100 is optimising for the
    // parser and against the human who reads it next.
    note: `${fit.target[0]}–${fit.target[1]}% is the realistic target. Copying the job description wholesale scores higher and reads as padding to the person who opens your CV.`,
  });
}
