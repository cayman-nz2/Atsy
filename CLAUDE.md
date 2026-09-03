# Atsy — project conventions

Free ATS CV scanner for job seekers. Full requirements set in `docs/` — read
`docs/PRD.md` and `docs/SCORING-SPEC.md` before building features. Live URL:
**https://atsy.vibecod3.app** (custom domain on the `vibecod3.app` zone;
`atsy.<account>.workers.dev` stays live as a fallback).

**FIRST: use the `atsy-playbook` skill (`.claude/skills/atsy-playbook/`) for any
task in this repo.** It holds the owner's standing directives, the release
checklist, and the incident log inherited from Pricey. Brand is "Atsy" — never
"ATSy", "ATSY", never with an exclamation mark.

## Stack
- Single Cloudflare Worker (`worker.js` + `src/*.js`) plus static assets in
  `dist/` (built by copying `public/`). ES modules, no framework, no bundler.
- D1 `atsy-db-oc` (binding `DB`, migrations in `migrations/`, applied by CI).
  Cloudflare's Oceania region; D1 serves it from Auckland.
- R2 `atsy-cv-oc` (binding `CV`) holds **application-encrypted** CV bytes only,
  also in Oceania.
- Workers AI (binding `AI`) for bullet rewrites only — **never** in the scoring
  path. Scoring is deterministic and node-testable. (`toMarkdown` is named in
  `docs/` as a corroboration step; no code calls it. Do not repeat the claim.)
- Email OTP via Cloudflare Email Service (`send_email` binding, sender
  `atsyhello@vibecod3.app`); Turnstile shields OTP requests and uploads.
- PDF parsing with `unpdf` (serverless PDF.js) server-side; a self-hosted
  PDF.js build renders the X-ray client-side (Workers have no canvas).
- `VERSION` single source: `src/version.js`. Do **not** re-export it from
  `worker.js` — workerd rejects non-handler exports on the entry module.

## Non-negotiables
- **Scoring never calls a model.** Same PDF → same score, always.
- **No admin endpoint returns CV content.** Aggregates only, enforced by test.
- **Storage stays in Oceania.** Region is fixed at creation and cannot be changed,
  so any new D1 database or R2 bucket must be created with `--location oc`. The
  deploy asserts the live regions against what `/privacy` claims and fails on a
  mismatch. Never rename the `atsy-cv:` HKDF info string in `src/crypto.js` to
  follow a bucket rename — it is a key-derivation constant, and changing it makes
  every stored object undecryptable.
- **No workflow spells out a resource name.** `wrangler.jsonc` is the one source;
  read it with `node tools/binding-names.mjs <d1-name|d1-id|r2-bucket>`. A unit
  test fails on any `d1`/`r2 bucket`/`migrations` command that writes a live name
  out by hand — the rename to Oceania left two such copies behind and killed a
  deploy at `Apply D1 migrations`.
- **A feature's success path must be tested, not just its failure path.** Four
  of the last five incidents were the same shape: the real path had no test —
  Turnstile's key blanked, the widget never rendered, `env.AI` absent from
  `testEnv()`, the model reply read in one shape only — so the product degraded
  politely in production while every gate stayed green. Stub the dependency and
  assert the good outcome. A suite that only proves graceful degradation proves
  the feature is off.
- **Never send a bullet to a model without knowing what to redact.** `identity`
  absent is not the same as "this CV has no name": a scan re-opened from history
  carries none, and guessing meant the reader's real name reached the model.
- **Extracted CV text is never persisted** — only findings with ≤120-char
  evidence snippets.
- **Every per-user query binds `user_id`**; every state change is a conditional
  UPDATE verified through `meta.changes`; every delete cascades to children and
  to the R2 object.
- **No third-party assets at runtime.** Fonts, icons and PDF.js are self-hosted.
  Turnstile is the only external embed, and it is always given an explicit theme.
- `OTP_ECHO` and `TURNSTILE_BYPASS` are local/E2E flags passed via
  `wrangler dev --var`. They must never appear in `wrangler.jsonc`.
- No emoji in the interface. One action colour per screen. Every white surface
  carries a border.

## Deploy
- Merge to `main` auto-deploys via `.github/workflows/deploy.yml`
  (gates: `npm run check`, `npm test`, `npm run e2e`, overlap gate).
- After EVERY merge: verify through the GitHub Actions API that a run exists for
  the merge SHA and concluded success. If none appears within ~2 minutes,
  dispatch the workflow manually. **Never** verify by fetching the site from a
  sandboxed session — the proxy blocks it.
- The deploy job applies D1 migrations, syncs secrets to Worker secrets, and
  polls `/api/health` until the live version matches the checkout.
- Develop on a feature branch, push, open a PR, merge it yourself once green —
  do not ask for per-PR approval. Never push directly to `main`.
- After each merged PR: `git fetch origin main && git checkout -B <branch> origin/main`.

## Version
`VERSION` in `src/version.js`, shown at `/api/health` and in every page footer.
Bump it in every display location each release and add the matching `RELEASES`
entry in `src/report.js`; a unit test enforces newest entry == `VERSION`.

## Secrets
GitHub Actions secrets, synced to Worker secrets by CI:
`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `TURNSTILE_SECRET_KEY`,
`CV_MASTER_KEY` (32 random bytes, base64), `IP_HASH_SALT`.
The Turnstile **site** key is public and lives in `wrangler.jsonc` vars.
Email sending needs no secret — the `send_email` binding covers it, and
`vibecod3.app` is already onboarded as a sending domain.
