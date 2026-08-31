-- Migration number: 0002 	 scans, triggered checks, audit log
--
-- Retention is a column, not a convention: every scan carries the moment its
-- file dies and the moment its record dies, so the purge sweep is a query
-- rather than a policy someone has to remember.

CREATE TABLE scans (
  -- 128-bit random hex, never sequential: a scan id is quoted in URLs, and a
  -- guessable one invites walking the table.
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  -- 'processing' | 'complete' | 'failed' | 'purged'
  status TEXT NOT NULL,
  -- Why a scan failed, in the same vocabulary the reader sees: not_pdf,
  -- encrypted, xfa_form, corrupt, no_text, too_complex.
  failure_reason TEXT,

  filename TEXT NOT NULL,
  file_bytes INTEGER NOT NULL,
  page_count INTEGER,
  pdf_producer TEXT,

  -- Null once the file is purged; the record outlives it by design, so the
  -- reader keeps their score after the PDF is gone.
  r2_key TEXT,
  key_version INTEGER,

  score INTEGER,
  band TEXT,
  pillars_json TEXT,
  engines_json TEXT,
  -- Findings carry evidence snippets capped at 120 characters. The extracted
  -- text itself is never a column here, in any form.
  findings_json TEXT,
  -- The document model: layout, sections, entity counts. Facts about the CV,
  -- not the CV.
  model_json TEXT,

  file_purge_after INTEGER NOT NULL,
  record_purge_after INTEGER NOT NULL
);
CREATE INDEX idx_scans_user ON scans(user_id, created_at DESC);
-- The purge sweep's two working queries. Partial indexes so the sweep reads
-- only rows that can still be purged.
CREATE INDEX idx_scans_file_purge ON scans(file_purge_after) WHERE r2_key IS NOT NULL;
CREATE INDEX idx_scans_record_purge ON scans(record_purge_after);

-- Triggered checks only, one row each. This is what admin aggregates count,
-- so the owner can see which problems are common without a scan ever being
-- readable.
CREATE TABLE scan_checks (
  scan_id TEXT NOT NULL,
  check_id TEXT NOT NULL,
  PRIMARY KEY (scan_id, check_id)
);
CREATE INDEX idx_scan_checks_check ON scan_checks(check_id);

-- Every decryption of a stored file lands here. `ip_hash` is salted; the
-- address itself is never written.
CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  action TEXT NOT NULL,
  scan_id TEXT,
  ip_hash TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_audit_created ON audit_log(created_at);
CREATE INDEX idx_audit_user ON audit_log(user_id, created_at);
