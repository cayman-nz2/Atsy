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
- D1 `atsy-db` (binding `DB`, migrations in `migrations/`, applied by CI).
- R2 `atsy-cv` (binding `CV`) holds **application-encrypted** CV bytes only.
- Workers AI (binding `AI`) for `toMarkdown` and for bullet rewrites —
  **never** in the scoring path. Scoring is deterministic and node-testable.
- Email OTP via Cloudflare Email Service (`send_email` binding, sender
  `hello@vibecod3.app`); Turnstile shields OTP requests and uploads.
- PDF parsing with `unpdf` (serverless PDF.js) server-side; a self-hosted
  PDF.js build renders the X-ray client-side (Workers have no canvas).
- `VERSION` single source: `src/version.js`. Do **not** re-export it from
  `worker.js` — workerd rejects non-handler exports on the entry module.

## Non-negotiables
- **Scoring never calls a model.** Same PDF → same score, always.
- **No admin endpoint returns CV content.** Aggregates only, enforced by test.
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
