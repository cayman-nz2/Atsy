// The scan pipeline: upload, encrypt, store, extract, model, persist.
//
// Scoring is deliberately absent here. Steps 1-6 of the pipeline in
// docs/ARCHITECTURE.md §4 are pure functions over bytes and a parsed
// document, which is why they are node-testable with no Cloudflare runtime.
// Step 7 (scoring) plugs into `createScan` at one seam, marked below.
//
// Two rules shape every query in this file:
//   * every per-user read binds `user_id` — ownership is never inferred from
//     the id in a URL, because an id in a URL is an attacker's input;
//   * every state change is a conditional UPDATE checked through
//     `meta.changes`, so a row that was purged or reassigned mid-request
//     cannot be silently overwritten.

import { json, err, nowSec, hashIp } from './util.js';
import { verifyTurnstile } from './turnstile.js';
import { encryptFile, decryptFile, DecryptionFailed } from './crypto.js';
import { extractDocument, UnreadablePdf, MAX_PAGES } from './extract/pdf.js';
import { analyseLayout } from './extract/layout.js';
import { detectSections } from './extract/sections.js';
import { extractEntities } from './extract/entities.js';

// <= 5 MB, <= 10 pages (docs/PRD.md). A CV outside either is not a CV that an
// ATS will read either, so the limits are the product's answer, not a fudge.
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
export const KEY_GENERATION = 1;

const SCANS_PER_DAY_DEFAULT = 20;
const FILE_RETENTION_HOURS_DEFAULT = 24;
const RECORD_RETENTION_DAYS_DEFAULT = 30;
// Wall-clock guard on parsing. pdf.js awaits between pages, so a timer does
// get a turn; a document that still has not finished by here is reported as
// too complex rather than left to hit the runtime's own limit, which would
// surface to the reader as a blank failure.
const PARSE_BUDGET_MS = 10000;

// Evidence and labels are capped so a "finding" can never become a copy of
// the CV by accident. 120 characters is the cap in docs/SECURITY-PRIVACY.md.
const SNIPPET_MAX = 120;

export const fileRetentionSeconds = (env) =>
  (Number(env.FILE_RETENTION_HOURS) || FILE_RETENTION_HOURS_DEFAULT) * 3600;
export const recordRetentionSeconds = (env) =>
  (Number(env.RECORD_RETENTION_DAYS) || RECORD_RETENTION_DAYS_DEFAULT) * 86400;

/** 128-bit random hex. Never sequential: scan ids appear in URLs. */
export function newScanId() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export const r2KeyFor = (scanId) => `cv/${scanId}`;

/**
 * A filename is attacker-controlled text that gets shown back to the reader
 * and stored. Keep the basename, drop anything that could be a path or a
 * control character, and cap the length.
 */
export function safeFilename(raw) {
  const base = String(raw || 'cv.pdf').split(/[\\/]/).pop();
  // Control characters and quotes: the first would let a filename inject a
  // line break into a log, the second would break out of the quoted value
  // in a content-disposition header.
  const cleaned = base.replace(/[\u0000-\u001f\u007f"]/g, '').trim();
  const named = cleaned || 'cv.pdf';
  return named.length > 120 ? `${named.slice(0, 117)}...` : named;
}

const snip = (text) => {
  const flat = String(text || '').replace(/\s+/g, ' ').trim();
  return flat.length > SNIPPET_MAX ? `${flat.slice(0, SNIPPET_MAX - 1)}…` : flat;
};

/**
 * Steps 4-6: bytes in, document model out. Pure, and the only place the three
 * analysis modules are composed — so a test and the Worker cannot disagree
 * about what "the model" means.
 */
export async function buildModel(bytes, options = {}) {
  const document = await extractDocument(bytes, options);
  const layout = analyseLayout(document);
  const sections = detectSections(document, layout);
  const entities = extractEntities(document, sections);
  return { document, layout, sections, entities };
}

/**
 * What gets written to D1: facts about the CV, never the CV.
 *
 * This function is the enforcement point for the promise on /privacy that
 * extracted text is not persisted. It is an allow-list by construction —
 * every field is named and copied — because a deny-list would leak the first
 * time an upstream module grew a field. The name, email, phone, links, job
 * titles, employers and bullet text all reach the reader in the response and
 * stop there; a unit test parses this output and fails if any fixture's
 * identity strings appear in it.
 */
export function modelSummary(model) {
  const { document, layout, sections, entities } = model;
  return {
    pages: {
      count: document.pageCount,
      read: document.pagesRead,
      truncated: document.truncated,
      sizes: document.pages.map((page) => ({
        number: page.number,
        width: Math.round(page.width),
        height: Math.round(page.height),
      })),
    },
    meta: {
      producer: document.meta.producer ? snip(document.meta.producer) : null,
      creator: document.meta.creator ? snip(document.meta.creator) : null,
      pdfVersion: document.meta.pdfVersion || null,
      language: document.meta.language || null,
      // The document title is metadata, but it is very often the author's
      // name — so only whether one is set is recorded, never its text.
      hasTitle: !!document.meta.title,
    },
    text: {
      characters: document.charCount,
      hasTextLayer: document.hasTextLayer,
      invisibleTextRuns: document.invisibleTextRuns,
      backgroundColourTextRuns: document.backgroundColourTextRuns,
    },
    fonts: document.fonts.map((font) => ({
      name: snip(font.name),
      embedded: font.embedded,
      type3: font.type3,
    })),
    layout: {
      multiColumn: layout.multiColumn,
      worstReadingOrder: layout.worstReadingOrder,
      hasTable: layout.hasTable,
      headerItems: layout.headerItems,
      footerItems: layout.footerItems,
      repeatedHeader: layout.repeatedHeader,
      pages: layout.pages.map((page) => ({
        number: page.number,
        columns: page.columns.columns,
        suppressedByTable: !!page.columns.suppressedByTable,
        readingOrder: page.readingOrder,
        hasTable: !!page.table,
        headerItems: page.header.length,
        footerItems: page.footer.length,
        lines: page.lines.length,
      })),
    },
    sections: {
      bodySize: sections.bodySize,
      found: sections.found,
      missingRequired: sections.missingRequired,
      headingCount: sections.headings.length,
      // Headings are structural labels ("EXPERIENCE"), and an unrecognised one
      // is the single most useful thing to know when section detection is
      // wrong — so they are kept, snipped, and capped in number.
      unknownHeadings: sections.unknownHeadings.slice(0, 12).map(snip),
    },
    entities: {
      // Presence, never values.
      hasName: !!entities.contact.name,
      hasEmail: !!entities.contact.email,
      hasPhone: !!entities.contact.phone,
      phoneInternational: entities.contact.phone ? entities.contact.phone.international : null,
      hasLink: !!entities.contact.link,
      roleCount: entities.roles.length,
      datedRoleCount: entities.roles.filter((role) => role.range && role.range.from).length,
      bulletCount: entities.bullets.length,
      dateFamilies: entities.dateFamilies,
      mixedDateFormats: entities.mixedDateFormats,
      reverseChronological: entities.reverseChronological,
      hasOpenEndedCurrentRole: entities.hasOpenEndedCurrentRole,
      // Gap lengths, not the roles either side of them.
      gapMonths: entities.gaps.map((gap) => gap.months),
    },
  };
}

const UNREADABLE_MESSAGES = {
  not_pdf: 'That file is not a PDF. Atsy reads PDFs, so export or "Save as PDF" and try again.',
  encrypted: 'That PDF is password-protected, so nothing can read it — not Atsy, and not an ATS. Save an unprotected copy.',
  xfa_form: 'That PDF is an XFA form rather than a document. Most ATS parsers read nothing at all from these.',
  corrupt: 'That PDF could not be opened. It may have been truncated in transit — try exporting it again.',
  too_complex: 'That PDF is too complex to scan. If it is really a CV, exporting it fresh from your editor usually fixes it.',
  no_text: 'That PDF has no text layer — it is a picture of a CV. An ATS reads nothing from it. Export from your editor instead of scanning a printout.',
  storage: 'That CV could not be stored, so the scan was stopped rather than run on a file Atsy could not keep safely.',
};

export const failureMessage = (reason) => UNREADABLE_MESSAGES[reason]
  || 'That PDF could not be scanned.';

/** The shape the client renders. The reader's own CV text is fine here. */
function scanResponse(row, model) {
  return {
    id: row.id,
    created_at: row.created_at,
    status: row.status,
    filename: row.filename,
    file_bytes: row.file_bytes,
    page_count: row.page_count,
    score: row.score,
    band: row.band,
    // Present until scoring lands, so the client can say so honestly rather
    // than rendering a zero.
    scored: row.score !== null && row.score !== undefined,
    file_available: !!row.r2_key,
    model: model ? modelSummary(model) : null,
    // Sent once, to the browser that just uploaded the file, and never stored.
    identity: model
      ? {
        name: model.entities.contact.name,
        email: model.entities.contact.email,
        phone: model.entities.contact.phone ? model.entities.contact.phone.text : null,
        link: model.entities.contact.link,
      }
      : null,
  };
}

async function parseWithBudget(bytes) {
  let timer;
  const budget = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new UnreadablePdf('too_complex')), PARSE_BUDGET_MS);
  });
  try {
    return await Promise.race([buildModel(bytes, { maxPages: MAX_PAGES }), budget]);
  } finally {
    clearTimeout(timer);
  }
}

// --- POST /api/scans -----------------------------------------------------

export async function createScan(request, env, user) {
  if (!env.CV) return err('storage_unavailable', 503);
  // Refusing here is the point: a missing key must never degrade into storing
  // a CV in the clear.
  if (!env.CV_MASTER_KEY) return err('storage_unavailable', 503);

  // Cheap rejection before reading a body at all. The margin allows for
  // multipart framing around a file that is itself within the limit.
  const declared = Number(request.headers.get('content-length') || 0);
  if (declared && declared > MAX_UPLOAD_BYTES + 65536) return err('file_too_large', 413);

  let form;
  try {
    form = await request.formData();
  } catch {
    return err('invalid_upload', 400);
  }

  const ip = request.headers.get('cf-connecting-ip') || null;
  if (!(await verifyTurnstile(env, form.get('turnstileToken'), ip))) {
    return err('turnstile_failed', 403);
  }

  const file = form.get('file');
  if (!file || typeof file.arrayBuffer !== 'function') return err('no_file', 400);
  if (file.size === 0) return err('empty_file', 400);
  if (file.size > MAX_UPLOAD_BYTES) return err('file_too_large', 413);

  const cap = Number(env.SCANS_PER_DAY) || SCANS_PER_DAY_DEFAULT;
  const { count } = await env.DB
    .prepare('SELECT COUNT(*) AS count FROM scans WHERE user_id = ? AND created_at > ?')
    .bind(user.id, nowSec() - 86400).first();
  if (count >= cap) return err('daily_limit', 429);

  const bytes = new Uint8Array(await file.arrayBuffer());
  const scanId = newScanId();
  const key = r2KeyFor(scanId);
  const created = nowSec();
  const filename = safeFilename(file.name);

  // The row goes in before the object, and carries the key. If the request
  // dies between the two, the sweep finds a 'processing' row whose object may
  // or may not exist and cleans both — whereas an object written before its
  // row would be an orphan nothing knows to delete.
  await env.DB.prepare(
    `INSERT INTO scans (id, user_id, created_at, status, filename, file_bytes,
                        r2_key, key_version, file_purge_after, record_purge_after)
     VALUES (?, ?, ?, 'processing', ?, ?, ?, ?, ?, ?)`,
  ).bind(
    scanId, user.id, created, filename, bytes.length, key, KEY_GENERATION,
    created + fileRetentionSeconds(env), created + recordRetentionSeconds(env),
  ).run();

  const fail = async (reason, status = 422) => {
    await env.DB.prepare(
      "UPDATE scans SET status = 'failed', failure_reason = ?, r2_key = NULL WHERE id = ? AND user_id = ?",
    ).bind(reason, scanId, user.id).run();
    // A file that could not be scanned has no second use, so it does not wait
    // for the retention window to expire.
    if (env.CV) await env.CV.delete(key).catch(() => {});
    return json({ error: 'unreadable_pdf', reason, message: failureMessage(reason) }, status);
  };

  try {
    const stored = await encryptFile(env, scanId, bytes, KEY_GENERATION);
    await env.CV.put(key, stored, {
      // No filename, no user id, no scan metadata: the object is ciphertext
      // and its length, and nothing that would identify whose it is.
      httpMetadata: { contentType: 'application/octet-stream' },
    });
  } catch (error) {
    console.log('scan storage failed:', error && error.message);
    return fail('storage', 502);
  }

  let model;
  try {
    model = await parseWithBudget(bytes);
  } catch (error) {
    if (error instanceof UnreadablePdf) return fail(error.message);
    console.log('scan parse failed:', error && error.message);
    return fail('corrupt');
  }

  // A PDF that parsed but carries no text layer is a picture of a CV. It is
  // the single most damaging thing a candidate can submit, so it earns a clear
  // refusal with an explanation rather than a score of zero.
  if (!model.document.hasTextLayer) return fail('no_text');

  // ---- scoring seam (M3) ------------------------------------------------
  // runChecks(model) -> { score, band, pillars, engines, findings, checkIds }
  // Until it lands, the record is complete and unscored: the extraction facts
  // are real and worth storing, and a fabricated score would not be.
  const summary = modelSummary(model);

  const finished = await env.DB.prepare(
    `UPDATE scans SET status = 'complete', page_count = ?, pdf_producer = ?, model_json = ?
      WHERE id = ? AND user_id = ? AND status = 'processing'`,
  ).bind(
    model.document.pageCount,
    summary.meta.producer,
    JSON.stringify(summary),
    scanId, user.id,
  ).run();
  // The row was deleted or purged while this request was parsing. Say so
  // rather than reporting a scan that is not there to open.
  if (!finished.meta.changes) return err('scan_gone', 409);

  const row = await env.DB
    .prepare('SELECT * FROM scans WHERE id = ? AND user_id = ?')
    .bind(scanId, user.id).first();
  return json({ scan: scanResponse(row, model) }, 201);
}

// --- GET /api/scans ------------------------------------------------------

export async function listScans(request, env, user) {
  const { results } = await env.DB.prepare(
    `SELECT id, created_at, status, failure_reason, filename, file_bytes,
            page_count, score, band, r2_key IS NOT NULL AS has_file
       FROM scans WHERE user_id = ? ORDER BY created_at DESC LIMIT 50`,
  ).bind(user.id).all();
  return json({
    scans: results.map((row) => ({
      id: row.id,
      created_at: row.created_at,
      status: row.status,
      failure_reason: row.failure_reason,
      filename: row.filename,
      file_bytes: row.file_bytes,
      page_count: row.page_count,
      score: row.score,
      band: row.band,
      // The reader can tell from the list whether the X-ray is still
      // available, instead of finding out by clicking into a purged scan.
      file_available: !!row.has_file,
    })),
  });
}

// --- GET /api/scans/:id --------------------------------------------------

export async function getScan(request, env, user, scanId) {
  const row = await env.DB.prepare('SELECT * FROM scans WHERE id = ? AND user_id = ?')
    .bind(scanId, user.id).first();
  if (!row) return err('not_found', 404);

  let model = null;
  if (row.model_json) {
    try { model = JSON.parse(row.model_json); } catch { model = null; }
  }
  return json({
    scan: {
      id: row.id,
      created_at: row.created_at,
      status: row.status,
      failure_reason: row.failure_reason,
      message: row.failure_reason ? failureMessage(row.failure_reason) : null,
      filename: row.filename,
      file_bytes: row.file_bytes,
      page_count: row.page_count,
      score: row.score,
      band: row.band,
      scored: row.score !== null && row.score !== undefined,
      file_available: !!row.r2_key,
      // Already a summary on disk: the stored JSON is exactly what
      // modelSummary produced, so nothing needs stripping on the way out.
      model,
      // The identity block is not stored, so a scan re-opened later cannot
      // show it. That is the privacy promise working, not a missing feature.
      identity: null,
    },
  });
}

// --- GET /api/scans/:id/file --------------------------------------------

export async function getScanFile(request, env, user, scanId) {
  const row = await env.DB
    .prepare('SELECT id, r2_key FROM scans WHERE id = ? AND user_id = ?')
    .bind(scanId, user.id).first();
  if (!row) return err('not_found', 404);
  if (!row.r2_key) return err('file_purged', 410);
  if (!env.CV) return err('storage_unavailable', 503);

  const object = await env.CV.get(row.r2_key);
  // The row says there is a file and the bucket disagrees. Correct the row so
  // the list stops advertising an X-ray that cannot open.
  if (!object) {
    await env.DB.prepare('UPDATE scans SET r2_key = NULL WHERE id = ? AND user_id = ?')
      .bind(scanId, user.id).run();
    return err('file_purged', 410);
  }

  let plaintext;
  try {
    plaintext = await decryptFile(env, row.id, new Uint8Array(await object.arrayBuffer()));
  } catch (error) {
    if (error instanceof DecryptionFailed) {
      // Deliberately vague to the client and specific in the log: a caller
      // cannot tell tampering from a key rotation, and does not need to.
      console.log('CV decryption failed for a stored object');
      return err('file_unreadable', 500);
    }
    throw error;
  }

  await env.DB.prepare(
    'INSERT INTO audit_log (user_id, action, scan_id, ip_hash, created_at) VALUES (?, ?, ?, ?, ?)',
  ).bind(
    user.id, 'scan_file_read', scanId,
    await hashIp(env, request.headers.get('cf-connecting-ip')), nowSec(),
  ).run();

  return new Response(plaintext, {
    headers: {
      'content-type': 'application/pdf',
      // The X-ray fetches this into a canvas. It must never sit in a shared
      // cache or a back-button snapshot.
      'cache-control': 'no-store, private',
      'content-disposition': 'inline; filename="cv.pdf"',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
    },
  });
}

// --- DELETE /api/scans/:id ----------------------------------------------

export async function deleteScan(request, env, user, scanId) {
  const row = await env.DB.prepare('SELECT r2_key FROM scans WHERE id = ? AND user_id = ?')
    .bind(scanId, user.id).first();
  if (!row) return err('not_found', 404);

  // Claim the row first: whoever's DELETE reports the change owns the
  // cleanup, so two concurrent deletes cannot both run the cascade.
  const removed = await env.DB.prepare('DELETE FROM scans WHERE id = ? AND user_id = ?')
    .bind(scanId, user.id).run();
  if (!removed.meta.changes) return err('not_found', 404);

  await env.DB.batch([
    env.DB.prepare('DELETE FROM scan_checks WHERE scan_id = ?').bind(scanId),
    env.DB.prepare('DELETE FROM audit_log WHERE scan_id = ?').bind(scanId),
  ]);
  if (row.r2_key && env.CV) await env.CV.delete(row.r2_key).catch(() => {});

  return json({ ok: true, deleted: { scan: 1 } });
}

/**
 * The scan half of account deletion. Called from auth.js so "delete
 * everything" means everything: a user row removed while their scans and
 * ciphertext survived would be the worst kind of privacy bug — the one that
 * looks fixed.
 */
export async function deleteAllScansFor(env, userId) {
  const { results } = await env.DB
    .prepare('SELECT id, r2_key FROM scans WHERE user_id = ?').bind(userId).all();

  await env.DB.batch([
    env.DB.prepare(
      'DELETE FROM scan_checks WHERE scan_id IN (SELECT id FROM scans WHERE user_id = ?)',
    ).bind(userId),
    env.DB.prepare('DELETE FROM audit_log WHERE user_id = ?').bind(userId),
    env.DB.prepare('DELETE FROM scans WHERE user_id = ?').bind(userId),
  ]);

  if (env.CV) {
    for (const row of results) {
      if (row.r2_key) await env.CV.delete(row.r2_key).catch(() => {});
    }
  }
  return results.length;
}
