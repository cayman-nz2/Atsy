-- Migration number: 0001 	 init: accounts, one-time codes, sessions
--
-- Only what identity needs. Scans, findings and files arrive in later
-- migrations, each with its own cascade.

CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  country TEXT,
  created_at INTEGER NOT NULL,
  last_seen INTEGER NOT NULL
);

-- Codes are stored hashed. `ip_hash` is a salted hash, never an address:
-- it exists only to rate limit and to spot abuse.
CREATE TABLE otp_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  ip_hash TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_otp_email ON otp_codes(email, created_at);
CREATE INDEX idx_otp_ip ON otp_codes(ip_hash, created_at);

-- Session tokens are stored hashed, so a database copy cannot be replayed
-- as a login.
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  last_used INTEGER NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions(user_id);
