# Atsy — architecture

One Cloudflare Worker, one D1 database, one R2 bucket, no framework, no build
tooling beyond a copy step. Everything runs inside the existing $5/month
Workers Paid plan (cost model in §7). Platform facts are cited in
`RESEARCH.md` §4 and were read from Cloudflare's documentation, not assumed.

---

## 1. Stack

| Concern | Choice | Why |
| --- | --- | --- |
| Compute | Cloudflare Worker (`worker.js` + `src/*.js`, ES modules) | Same stack as Pricey; no cold-start cost; 30 s CPU default is ample |
| Static assets | `dist/` built by copying `public/` | Served ahead of Worker routes; unmatched paths fall through to the Worker |
| Database | D1 `atsy-db`, migrations in `migrations/`, applied by CI | 25 B rows read / 50 M written per month included |
| File storage | R2 `atsy-cv`, private bucket, app-encrypted objects | 10 GB-month free, zero egress, AES-256 at rest under our own ciphertext |
| PDF parsing | `unpdf` (serverless PDF.js build, tested on Workers) | Positional text items — the only way to detect columns, headers and reading order |
| Semantic cross-check | `env.AI.toMarkdown()` | Free for PDFs; gives a tagged-structure view to corroborate section detection |
| Auth | Email OTP via Cloudflare Email Service (`send_email` binding) | Owner directive; 3,000 emails/month included; `vibecod3.app` already onboarded |
| Bot shield | Turnstile on OTP request and upload | Same pattern as Pricey; new site key needed per domain |
| Abuse control | Rate Limiting binding + D1 counters | Edge limiter for bursts, D1 for per-day quotas |
| Scheduled work | Cron Triggers | Retention purge, feedback notification sweep, budget reset audit |
| AI | Workers AI, suggestions only | Never in the scoring path |

**Rejected:** a browser-only scanner (privacy-attractive, but two execution
paths for one rubric means two sets of bugs — the owner's "one source of truth"
rule); Durable Objects (no coordination need); Queues (the scan finishes inside
one request); Vectorize (keyword matching is deterministic by design).

---

## 2. Repository layout

```
worker.js                 # entry: routing only, no exported constants (workerd rejects them)
src/
  version.js              # VERSION — single source of truth
  util.js                 # json/err/nowSec/randDigits/sha256Hex/cookies/validEmail
  auth.js                 # OTP request + verify, sessions, current user
  notify.js               # Email Service sends: OTP, owner alerts, "it's built"
  crypto.js               # envelope encryption for CV bytes (HKDF + AES-256-GCM)
  extract/
    pdf.js                # unpdf → positional document model
    layout.js             # columns, reading order, header/footer bands, tables
    sections.js           # heading detection, section segmentation
    entities.js           # name, email, phone, location, links, dates, roles
  scoring/
    index.js              # runs the check catalogue, returns findings + score
    checks-parse.js       # P01–P17
    checks-contact.js     # B01–B08
    checks-experience.js  # C01–C08
    checks-content.js     # D01–D11
    checks-skills.js      # E01–E05
    engines.js            # per-engine parse-risk simulation
    rolefit.js            # JD matching (deterministic)
  lexicons/*.js           # action verbs, clichés, typos, variants, brands, countries
  ai.js                   # bullet rewrite (redact → prompt → budget → fallback)
  scans.js                # upload, scan lifecycle, history, delete, report
  admin.js                # aggregate stats, feedback inbox (never CV content)
  feedback.js             # suggestion box
  report.js               # RELEASES history shown in-app
public/                   # index.html, app.html, about.html, privacy.html, feedback.html,
                          # atsy.css, app.js, icons/, fonts/, vendor/pdfjs (self-hosted)
migrations/*.sql
tests/
  run.js                  # node unit tests (pure logic, lexicons, scoring, crypto)
  fixtures/               # golden corpus of CVs + expected results
  e2e/                    # Playwright journeys, overlap gate, screenshot tour
docs/                     # this documentation set
.claude/skills/atsy-playbook/   # standing rules + incident log for future sessions
```

---

## 3. Data model (D1)

```sql
users(id, email UNIQUE, name, country, created_at, last_seen, deleted_at)
otp_codes(id, email, code_hash, ip, attempts, expires_at, created_at)
sessions(token_hash PK, user_id, created_at, expires_at, last_used)

scans(
  id TEXT PK,                -- 128-bit random, not sequential
  user_id, created_at,
  status,                    -- 'processing' | 'complete' | 'failed' | 'purged'
  filename, file_bytes, page_count, pdf_producer,
  r2_key,                    -- null once purged
  key_version,               -- envelope key generation
  score, band,
  pillars_json,              -- {A:..,B:..,C:..,D:..,E:..}
  engines_json,              -- per-engine risk + reasons
  findings_json,             -- full finding list incl. evidence (< 2 MB row limit)
  text_purged_at,            -- extracted text is dropped as soon as scoring ends
  file_purge_after,          -- unix seconds; default created_at + 24h
  record_purge_after,        -- default created_at + 30d
  deleted_at
)
scan_checks(scan_id, check_id)      -- triggered checks only; powers admin aggregates
job_matches(id, scan_id, created_at, jd_hash, role_fit, missing_json, matched_json)
skills(id, canonical, alias, family) -- taxonomy, editable without a deploy
ai_usage(day TEXT PK, neurons INTEGER)         -- daily budget counter
ai_user_usage(user_id, day, calls)             -- per-user daily cap
audit_log(id, user_id, action, scan_id, ip_hash, created_at)
feedback(id, user_id, email, type, message, status, resolution_note, notified_at, created_at)
```

Rules baked into every query (each one is a Pricey incident, log entry #32):

- Every scan/file/match query **binds `user_id`**; ownership is never inferred
  from a URL id alone.
- Every state change is a **conditional UPDATE** verified through
  `meta.changes` (claim-before-act), never read-then-write.
- Every delete **cascades** to `scan_checks`, `job_matches`, `audit_log` rows
  and the R2 object.
- `ip` is stored only as a salted hash, and only for rate limiting and abuse
  audit.

---

## 4. The scan pipeline

```
1  Upload      multipart POST, ≤ 5 MB, Turnstile token, session required
2  Sniff       first bytes must be %PDF-; reject encrypted/XFA/corrupt (P90)
3  Encrypt     AES-256-GCM envelope in the Worker → PUT to R2 (ciphertext only)
4  Extract     unpdf → pages[] of positioned text items, fonts, images, annotations
5  Corroborate env.AI.toMarkdown() → tagged-structure view (free, best-effort,
               skipped on error; never blocks a scan)
6  Model       layout.js → columns, reading order, bands, tables
               sections.js → canonical sections
               entities.js → name, contacts, roles, dates, skills
7  Score       scoring/index.js runs every check → findings + pillars + score
8  Simulate    engines.js → six parse-risk cards
9  Persist     scans row + scan_checks rows; extracted text is NOT stored
10 Respond     full result JSON; the client renders and can request the X-ray
```

Steps 4–8 are pure functions over a parsed document object, so they run under
plain `node` in unit tests with no Cloudflare runtime.

**Budgets:** step 4 aborts at 10 pages or 4 s of CPU; a document that exceeds
either returns a clear "this file is too complex to scan — is it really a CV?"
message rather than a timeout. Total target: **p50 ≤ 2 s, p95 ≤ 6 s** of Worker
time; the request never approaches the 30 s CPU ceiling.

**Client-side X-ray:** the results page renders the original PDF with a
self-hosted PDF.js build and draws the finding bounding boxes over it. The file
is fetched once through `GET /api/scans/:id/file` (owner-only, audit-logged,
decrypted in the Worker, `Cache-Control: no-store`). No canvas rendering
happens server-side because Workers have no canvas.

---

## 5. HTTP API

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/api/auth/request-code` | email + Turnstile; rate limited per email/IP |
| POST | `/api/auth/verify` | 6-digit code → session cookie (`HttpOnly; Secure; SameSite=Lax`) |
| POST | `/api/auth/logout` | deletes the session row |
| GET | `/api/me` | current user + quota state |
| DELETE | `/api/me` | erases account, scans, files, matches — irreversible |
| POST | `/api/scans` | multipart upload → full scan result |
| GET | `/api/scans` | history (id, date, score, band, filename) |
| GET | `/api/scans/:id` | full result, owner-bound |
| GET | `/api/scans/:id/file` | decrypted original, owner-bound, audit-logged, no-store |
| DELETE | `/api/scans/:id` | purges row, checks, matches and R2 object |
| POST | `/api/scans/:id/match` | JD text → Role Fit |
| POST | `/api/scans/:id/rewrite` | bullet ids → AI suggestions (budgeted) |
| GET | `/api/scans/:id/report` | printable HTML report |
| POST | `/api/feedback` | type, message, email (required) |
| GET | `/api/health` | `{version}` — used by the deploy verification gate |
| GET | `/api/admin/*` | aggregates + feedback inbox, gated by `ADMIN_EMAILS` |

All endpoints: JSON in, JSON out, explicit status codes, no stack traces, and
no CV content in any log line.

---

## 6. Configuration

`wrangler.jsonc`:

```jsonc
{
  "name": "atsy",
  "main": "worker.js",
  "compatibility_date": "2026-08-01",
  "compatibility_flags": ["nodejs_compat"],
  "routes": [{ "pattern": "atsy.vibecod3.app", "custom_domain": true }],
  "workers_dev": true,
  "assets": { "directory": "./dist", "binding": "ASSETS" },
  "d1_databases": [{ "binding": "DB", "database_name": "atsy-db", "database_id": "<set at setup>" }],
  "r2_buckets": [{ "binding": "CV", "bucket_name": "atsy-cv" }],
  "ai": { "binding": "AI" },
  "send_email": [{ "name": "SEND_EMAIL" }],
  "ratelimits": [
    { "name": "RL_OTP",    "namespace_id": "2001", "simple": { "limit": 5,  "period": 60 } },
    { "name": "RL_UPLOAD", "namespace_id": "2002", "simple": { "limit": 10, "period": 60 } }
  ],
  "triggers": { "crons": ["*/30 * * * *"] },
  "vars": {
    "ADMIN_EMAILS": "avishkapadia@gmail.com",
    "OWNER_EMAIL": "avishkapadia@gmail.com",
    "EMAIL_FROM": "hello@vibecod3.app",
    "TURNSTILE_SITE_KEY": "<atsy site key>",
    "OTP_DEBUG": "0",
    "AI_DAILY_NEURON_BUDGET": "8000",
    "AI_USER_DAILY_CALLS": "30",
    "FILE_RETENTION_HOURS": "24",
    "RECORD_RETENTION_DAYS": "30"
  }
}
```

Secrets (GitHub → Actions secrets, synced to Worker secrets by CI):
`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `TURNSTILE_SECRET_KEY`,
`CV_MASTER_KEY` (32 random bytes, base64), `IP_HASH_SALT`.

`OTP_ECHO` and `TURNSTILE_BYPASS` are E2E/local-dev flags passed via
`wrangler dev --var`. **They must never appear in `wrangler.jsonc`.**

---

## 7. Cost control (how "free" stays free)

| Guard | Mechanism |
| --- | --- |
| AI spend | `AI_DAILY_NEURON_BUDGET` counted in `ai_usage` with a conditional UPDATE before each call; over budget → deterministic template suggestions, product still complete |
| AI abuse | `AI_USER_DAILY_CALLS` per user per day |
| Scan volume | 10 scans/user/day, 60/IP/day, plus the edge Rate Limiting binding |
| Email volume | 5 OTP requests per email per hour, 20 per IP per hour (Pricey's proven numbers); owner alerts go to a verified destination address and are free |
| Storage | Files purged at 24 h, records at 30 days, by cron; R2 objects deleted with the row |
| CPU | 10-page / 4-second extraction ceiling per scan |
| Blast radius | A daily cost check in the admin portal shows neurons, emails, scans and R2 objects against their budgets |

Modelled at 1,000 scans/day the whole service costs **under $2/month above the
$5 plan**, and the only variable line is AI suggestions, which is capped.

---

## 8. CI/CD

`.github/workflows/deploy.yml`, adapted from Pricey (which already survived the
failure modes documented in the cloudflare-worker-setup skill):

```
on: push to main, workflow_dispatch
concurrency: deploy-main (never cancel — deploys must land in merge order)

test job:    npm ci → npm run check → npm test → playwright chromium → npm run e2e
deploy job:  npm ci → npm run build
             → wrangler d1 migrations apply atsy-db --remote
             → wrangler deploy (wranglerVersion 4.118.0 — 3.x cannot parse assets configs)
             → sync TURNSTILE_SECRET_KEY / CV_MASTER_KEY / IP_HASH_SALT as Worker secrets
             → verify /api/health version == src/version.js, polling up to 60 s
```

Gates that must be green before a merge:

1. `npm run check` — syntax check of every module.
2. `npm test` — unit tests: scoring golden corpus, lexicons, crypto round-trip,
   date parsing, layout heuristics, version/RELEASES sync.
3. `npm run e2e` — Playwright journeys against local `wrangler dev`
   (`OTP_ECHO=1`, `TURNSTILE_BYPASS=1`): sign in, upload each fixture class,
   read the score, delete data, feedback submit.
4. **Layout-overlap gate** — fails the build if any two rendered surfaces
   intersect on any public page (Pricey incident #33).
5. **Screenshot tour** — `npm run tour` (always rebuilds `dist` first) captures
   every screen at 393×851, 430×932 and 1280×900, light and dark, for human
   review. Sticky bars are pinned to the top of the document for full-page
   captures so a screenshot can never show an overlap that users do not see.
6. **Stale-build gate** — the build stamps `dist/build.json`, and the first E2E
   test fails if the server is serving a different build than the one on disk.
   `wrangler dev` snapshots the asset directory at startup, so without this a
   whole review can describe markup that no longer exists.

Release discipline (owner's standing rules): feature branch → milestone-sized
PR → self-merge on green → verify the deploy through the **GitHub Actions API**
(a run must exist for the merge SHA and conclude success) → never verify by
fetching the site from a sandbox → reset the branch onto `main` afterwards.

`VERSION` lives in `src/version.js` and is shown in every page footer and at
`/api/health`; a unit test enforces that the newest `RELEASES` entry matches it.

---

## 9. Observability

- **Structured logs** with a request id, never containing CV text, extracted
  content, email bodies or file bytes.
- **Failure telemetry**: every scan that fails records the failure class
  (`encrypted_pdf`, `no_text_layer`, `parse_timeout`, `too_many_pages`) — never
  the document.
- **Admin dashboard**: signups, scans/day, completion rate, score histogram,
  top 10 triggered checks, engine-risk distribution, AI neurons used today,
  emails sent this month, R2 objects outstanding, feedback queue.
- **Alerting by email to the owner**: new signup, new feedback, budget above
  80%, and any spike in failed scans.

---

## 10. Performance budgets

| Metric | Budget |
| --- | --- |
| Landing page first contentful paint (mid-range Android, 3G-class) | ≤ 1.5 s |
| Total transferred on first load | ≤ 250 KB (fonts included, no CDN) |
| Upload → results rendered, p50 / p95 | ≤ 12 s / ≤ 20 s end-to-end |
| Worker CPU per scan, p50 / p95 | ≤ 2 s / ≤ 6 s |
| Interaction latency (tab, accordion, overlay toggle) | ≤ 100 ms |
| Animation | 60 fps, no layout thrash, all entrances ≤ 0.4 s total |
