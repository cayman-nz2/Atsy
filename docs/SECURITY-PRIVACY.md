# Atsy — security and privacy specification

A CV is one of the densest personal documents a person owns: full name, home
location, phone, email, employment history, education, and often nationality,
date of birth or health context. Atsy asks strangers under stress to hand that
over. The bar is therefore higher than "Cloudflare encrypts at rest".

**The promise, in the words shown to users:**

> Your CV is encrypted with a key that never leaves our server, deleted
> automatically within 24 hours, never readable by anyone at Atsy, and never
> sent to an AI model with your name attached. Delete everything in one click,
> any time.

Every clause is enforced by code below, not by policy.

---

## 1. Threat model

| Threat | Mitigation |
| --- | --- |
| Attacker steals R2 objects (mis-scoped token, bucket exposure) | Objects are **application-encrypted before upload**; R2 holds ciphertext only. The key is a Worker secret that lives nowhere in R2 |
| Attacker guesses another user's scan URL | Scan ids are 128-bit random; **every query binds `user_id`**; an unowned id returns 404, never 403 (no existence oracle) |
| Session theft | `HttpOnly; Secure; SameSite=Lax` cookie, random 256-bit token stored **hashed**, 90-day rolling expiry, logout deletes the row, delete-account deletes all sessions |
| OTP brute force | 6-digit code hashed with SHA-256, 10-minute TTL, **5 attempts across all outstanding codes**, 5 requests/email/hour, 20/IP/hour, plus the edge rate limiter |
| OTP interception / enumeration | Identical response whether or not the email exists; codes never returned in an API response in production (`OTP_DEBUG=0`); no code in logs |
| Bot/abuse floods | Turnstile on OTP request and upload, per-user and per-IP daily scan caps, edge Rate Limiting binding |
| Malicious PDF (JS, embedded files, zip bombs, XFA) | Magic-byte sniff, 5 MB and 10-page ceilings, encrypted/XFA files rejected before storage, PDF.js parses without executing document JavaScript, 4 s extraction ceiling |
| Model provider sees personal data | Identity is **redacted before any AI call**; Cloudflare states it does not train on customer content and does not share it between customers; AI is optional and never touches scoring |
| Owner or admin reads someone's CV | **No endpoint exists** that returns CV content to an admin. Admin routes return counts and aggregates only. This is a code-level guarantee, tested |
| Data outliving its purpose | File purged at 24 h, record at 30 days, by cron, with the R2 delete tied to the row delete |
| XSS stealing session or CV text | Strict CSP, no third-party scripts, no CDN, every interpolation escaped, no `innerHTML` with user content |
| Log leakage | Structured logging with an explicit allowlist of fields; CV text, file bytes, emails bodies and OTP codes are never loggable |
| Supply chain | Vendored, pinned dependencies (`unpdf`, PDF.js for the browser), `npm ci` from a committed lockfile, no runtime CDN fetches |

---

## 2. Encryption design (files)

Cloudflare already encrypts R2 and D1 at rest with AES-256-GCM. Atsy adds an
**application-layer envelope** so that the stored bytes are meaningless without
a secret that is not part of the storage system:

```
CV_MASTER_KEY            32 random bytes, base64, a Worker secret (never in git,
                         never in wrangler.jsonc, synced from a GitHub secret by CI)

per file:
  salt   = 16 random bytes
  key    = HKDF-SHA256(CV_MASTER_KEY, salt, info = "atsy-cv:" + scan_id)
  iv     = 12 random bytes
  body   = AES-256-GCM(key, iv, pdf_bytes)
  object = [ version(1) | key_generation(1) | salt(16) | iv(12) | body ]
```

- Encryption and decryption happen **inside the Worker** with WebCrypto; plain
  bytes never touch storage, logs, or any third party.
- `key_generation` allows rotation: a new `CV_MASTER_KEY_V2` can be introduced
  while old objects still decrypt; a rotation sweep can re-wrap on read.
- The R2 object carries **no custom metadata** — no filename, no email, no
  user id. The mapping lives in D1, which is separately access-controlled.
- Decryption is only reachable through `GET /api/scans/:id/file`, which
  requires a valid session, binds `user_id`, writes an `audit_log` row, and
  responds with `Cache-Control: no-store` and `Content-Disposition: inline`.

Extracted text is **never persisted**. It exists in memory for the duration of
the scan and is dropped when scoring ends; only findings (with short snippets,
capped at 120 characters, needed to show evidence) are stored.

---

## 3. Authentication (Cloudflare email OTP)

Identical in shape to the pattern proven in production on Pricey, with the
hardening below.

```
POST /api/auth/request-code   { email, turnstileToken }
  → validate email shape (≤ 254 chars)
  → verify Turnstile (fail closed in production)
  → rate limit: 5 per email per hour, 20 per IP per hour  (D1 counters + edge limiter)
  → code = 6 crypto-random digits
  → store SHA-256(code) with ip, expires_at = now + 600s
  → send via Email Service; response is always { sent: true } shape

POST /api/auth/verify         { email, code }
  → accept ANY unexpired code for that email (a slow first email must still work)
  → attempts summed across outstanding codes; 5 strikes → 429
  → on success: delete all codes for that email, upsert user, create session
  → session token: 256-bit random, stored as SHA-256, cookie HttpOnly/Secure/SameSite=Lax
  → rolling 90-day expiry, refreshed when under 60 days remain
```

Rules:

- `OTP_DEBUG` must be `"0"` in production; `OTP_ECHO` exists only for local E2E
  and must never appear in `wrangler.jsonc`.
- Verification responses never distinguish "no such email" from "wrong code"
  beyond the necessary expired/wrong/too-many states.
- The OTP email states the code's purpose and lifetime and says "if you did not
  ask for this, ignore it" — nothing else, no tracking pixel, no links.
- A single-use token that fails (a Turnstile token, an OTP) always resets the
  UI so a retry works — a dead-end retry is a UX bug, not just an auth detail.

---

## 4. Data inventory and retention

| Data | Where | Kept for | Deletable |
| --- | --- | --- | --- |
| Email address | D1 `users` | Until account deletion | One click |
| Country (from `request.cf`) | D1 `users` | Until account deletion | One click |
| Original PDF (ciphertext) | R2 | **24 hours** (`FILE_RETENTION_HOURS`) | Immediately, per scan or all |
| Extracted CV text | Memory only | Duration of the scan | n/a — never stored |
| Findings + evidence snippets (≤120 chars) | D1 `scans.findings_json` | **30 days** (`RECORD_RETENTION_DAYS`) | One click |
| Score history (score, band, date) | D1 `scans` | 30 days | One click |
| Pasted job descriptions | D1 `job_matches` — **hashed, not stored verbatim**, plus matched/missing term lists | 30 days | One click |
| IP address | Salted hash only, in rate-limit rows and `audit_log` | 30 days | Purged by cron |
| Feedback message + email | D1 `feedback` | Until resolved + notified | On request |
| AI prompt content | Not stored; redacted before sending | n/a | n/a |

**Purge cron (every 30 minutes)** does, in order, with conditional updates so a
concurrent run cannot double-act:

1. Delete R2 objects for scans past `file_purge_after`; null the `r2_key`.
2. Delete scans past `record_purge_after` and cascade `scan_checks`,
   `job_matches`, `audit_log`.
3. Delete expired `otp_codes` and `sessions`.
4. Delete `audit_log` rows older than 30 days.
5. Sweep "it's built" feedback notifications (claim-before-send).

`DELETE /api/me` performs the same cascade immediately for one user and
confirms with a count of what was removed. Deletion is irreversible and the UI
says so before confirming.

---

## 5. AI redaction

Before any bullet leaves the Worker for Workers AI:

1. Replace the detected name with `[NAME]`, emails with `[EMAIL]`, phone
   numbers with `[PHONE]`, URLs with `[LINK]`, and detected employer names with
   `[COMPANY]`.
2. Send **one bullet at a time**, never the document, never the contact block.
3. Cap input at 400 characters and output at 120 tokens.
4. Prompt forbids inventing facts; missing metrics come back as `[add number]`.
5. Log the neuron cost, never the text.

If redaction cannot confidently identify the name (rare), the rewrite feature
is disabled for that scan rather than sending unredacted content.

---

## 6. Web security

| Control | Setting |
| --- | --- |
| CSP | `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; object-src 'none'; base-uri 'none'; form-action 'self'` |
| HSTS | `max-age=31536000; includeSubDomains; preload` |
| Others | `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Cross-Origin-Opener-Policy: same-origin`, `Permissions-Policy: camera=(), microphone=(), geolocation=(), interest-cohort=()` |
| Cookies | `HttpOnly; Secure; SameSite=Lax; Path=/` |
| CSRF | State-changing endpoints require `SameSite=Lax` cookies **and** a JSON content type; no form posts are accepted cross-origin |
| Uploads | Size and page ceilings, magic-byte sniff, MIME ignored, filename never used as a storage key or echoed unescaped |
| Third parties | **None** except Turnstile. No analytics, no fonts from Google, no CDN scripts (Pricey incidents #19 and #30 — self-host everything) |
| Errors | Generic messages to the client; details in structured logs without content |

---

## 7. Compliance posture

- **NZ Privacy Act 2020** (Atsy's home jurisdiction) and **GDPR/UK GDPR** for
  overseas users. Lawful basis: consent, given at upload, for the single
  purpose of scanning the document and returning the result.
- **Data minimisation**: we store the least that makes the product work, and
  the file itself for the shortest time that allows a re-render.
- **Purpose limitation**: CV content is never used for training, marketing,
  research, or any secondary purpose. Aggregates are counts of triggered
  checks, never content.
- **Rights**: access (the app *is* the access view), rectification (re-upload),
  erasure (one click, immediate), portability (report export), objection
  (delete the account).
- **Breach**: any suspected exposure is treated as an incident — assess within
  24 hours, notify the Privacy Commissioner and affected users if it meets the
  "serious harm" threshold, and log it in the incident log with a prevention
  rule.
- **Public documents**: a plain-English privacy page at `/privacy` (no legalese
  wall) stating exactly what is stored, for how long, who can see it (nobody),
  and how to delete it; a short terms page; and this specification, which stays
  public in the repository.

---

## 8. Security test obligations (CI-enforced)

1. **Ownership tests**: for every scan-scoped endpoint, a second user's session
   receives 404 — asserted per endpoint, not sampled.
2. **Crypto round-trip test**: encrypt → store → fetch → decrypt returns byte-identical
   input; a tampered ciphertext fails authentication rather than returning
   plaintext; a wrong key generation fails cleanly.
3. **Redaction test**: a fixture CV's name, email, phone and URLs never appear
   in the string handed to the AI layer (asserted on the built prompt).
4. **Retention test**: a scan with `file_purge_after` in the past loses its R2
   object and `r2_key` after one cron run; a scan past `record_purge_after`
   disappears with its children.
5. **Admin-blindness test**: no admin endpoint returns `findings_json`,
   `filename`, file bytes or any snippet.
6. **Header test**: every HTML response carries the full header set; every API
   response carries `no-store`.
7. **Rate-limit tests**: the 6th OTP request in an hour is refused; the 6th
   wrong code is refused; the 11th scan in a day is refused.
8. **No-secrets test**: the built bundle contains no key material and
   `wrangler.jsonc` contains no `OTP_ECHO`, `TURNSTILE_BYPASS` or secret values.
