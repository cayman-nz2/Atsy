-- Migration number: 0004 	 role fit, the AI budget, and feedback
--
-- Three unrelated things in one migration because they arrive in one release
-- and splitting them would only make the sequence longer to read.

-- One Role Fit result per job description pasted against a scan. `jd_hash`
-- rather than the text: a job description is someone else's document and
-- Atsy has no reason to keep it. The hash exists so pasting the same JD twice
-- reuses the row instead of piling up duplicates.
CREATE TABLE job_matches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scan_id TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  jd_hash TEXT NOT NULL,
  role_fit INTEGER NOT NULL,
  capped INTEGER NOT NULL DEFAULT 0,
  components_json TEXT,
  missing_json TEXT,
  matched_json TEXT
);
CREATE UNIQUE INDEX idx_matches_scan_jd ON job_matches(scan_id, jd_hash);
CREATE INDEX idx_matches_user ON job_matches(user_id);

-- The shared daily neuron budget. One row per day, incremented in place: a
-- read-then-write would let two concurrent rewrites both see the old total and
-- overspend.
CREATE TABLE ai_usage (
  day TEXT PRIMARY KEY,
  neurons INTEGER NOT NULL DEFAULT 0
);

-- Per-reader daily cap, so one person cannot spend the whole budget.
CREATE TABLE ai_user_usage (
  user_id INTEGER NOT NULL,
  day TEXT NOT NULL,
  calls INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);

-- Feedback. The email is required so a reply is possible; the message is
-- untrusted user content and is never treated as an instruction.
CREATE TABLE feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  email TEXT NOT NULL,
  type TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new',
  resolution_note TEXT,
  notified_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_feedback_status ON feedback(status, created_at);
