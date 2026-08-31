# Atsy — product requirements

**Atsy** is a free CV scanner for people who need a job now. Upload a PDF, get
an honest, evidence-backed assessment of how machine-readable and how
competitive it is, plus the exact edits that raise the score.

- Live URL: **https://atsy.vibecod3.app** (custom domain on the `vibecod3.app`
  zone; `atsy.<account>.workers.dev` stays live as a fallback).
- Brand name: **Atsy** — always capitalised A, never "ATSy", "ATSY" or with an
  exclamation mark.
- Price: **free, permanently. No paywall, no credits, no upsell, no ads, no
  trackers.** Any change to that is an owner decision, not a product decision.

Read alongside: `RESEARCH.md` (evidence), `SCORING-SPEC.md` (the rubric),
`DESIGN-SPEC.md` (how it looks), `ARCHITECTURE.md` (how it is built),
`SECURITY-PRIVACY.md` (how CVs are protected), `ROADMAP.md` (build order).

---

## 1. The problem

A person applying for 60 jobs gets rejected by machines they cannot see, for
reasons nobody tells them. Two-column templates scramble in seven of eight
parsers. Contact details in a page header are frequently never read. A scanned
PDF is empty to a parser. None of this is visible to the applicant — the
rejection email says "we went with other candidates".

Existing checkers either paywall after one scan, or hand back an opaque number
with no evidence. Neither tells the candidate *what the machine actually saw*.

## 2. The promise

> Atsy shows you your CV the way a hiring machine sees it, scores what is
> fixable, and tells you exactly what to change — free, in under a minute.

Three product principles, in priority order:

1. **Honest.** We never invent a number. The score is a published, deterministic
   rubric (`SCORING-SPEC.md`), and we state plainly that real ATS engines
   disagree with each other by up to 24 points on the same file. No fake
   urgency, no "97% of resumes are rejected" scare copy, no dark patterns.
2. **Actionable.** Every finding carries evidence (page, snippet, coordinates),
   a severity, a fix written as an instruction, and the points it is worth.
   A finding without a fix is a bug.
3. **Safe.** A CV is dense personal data. It is encrypted before storage,
   deleted within 24 hours by default, never visible to the owner or any admin,
   and never sent to a model without PII redaction.

## 3. Users

| Persona | Situation | What they need from Atsy |
| --- | --- | --- |
| **Sam, made redundant** (primary) | 40 applications, 2 replies, morale low | A clear reason, a short fix list, a fast re-check |
| **Priya, graduate** | Canva template with a sidebar and skill dots | To learn the template is the problem, and what to use instead |
| **Marcus, career changer** | Strong CV, wrong keywords for the target role | JD-matched gap list and rewritten bullets |
| **Ana, ESL applicant** | Content is fine, phrasing is not | Plain-language rewrites and tone fixes |
| **Avish (owner)** | Runs it, answers feedback | Admin visibility, abuse control, and zero surprise cost |

Non-users (out of scope): recruiters, employers, bulk/API customers.

## 4. Jobs to be done

1. "Tell me if a machine can read my CV at all." (parse safety)
2. "Tell me why I am not getting interviews." (content quality)
3. "Tell me if I match *this* job." (JD fit)
4. "Tell me exactly what to change, in order." (prioritised fixes)
5. "Let me check the fix worked." (re-scan and compare)

## 5. Scope

### 5.1 In scope for v1.0

- **PDF upload** (`.pdf`, ≤ 5 MB, ≤ 10 pages) with drag-and-drop and file picker.
- **Email OTP sign-in** before upload — 6-digit code, auto-submits, 10-minute
  validity (Cloudflare Email Service; identical pattern to Pricey).
- **Deterministic scan** producing the Atsy Score (0–100) across five pillars,
  every check in `SCORING-SPEC.md`.
- **Engine simulation panel** — parse-risk rating (Low / Medium / High) for
  Workday, Greenhouse, Lever, iCIMS, Taleo and Ashby, each with its reasons.
- **"What the machine sees"** — the extracted text in reading order, exactly as
  a parser receives it, side by side with the original page.
- **Document X-ray** — the original PDF rendered client-side with problem
  regions highlighted in place (columns, header/footer content, tables, image
  regions, hidden text).
- **Prioritised fix list** — Critical / Major / Minor, each with evidence, an
  instruction, and "+N points".
- **Optional job description** — paste a JD to add role-fit scoring: hard-skill
  coverage, missing must-haves, title and seniority alignment, stuffing check.
- **AI rewrite suggestions** — up to 10 weak bullets rewritten per scan, capped
  per user per day, PII-redacted before the model sees anything, and clearly
  labelled as suggestions to edit, not to paste blindly.
- **Scan history and comparison** — previous scores per user, delta on re-scan
  ("+14 since 3 Sep"), so the fix loop closes.
- **Report export** — a printable/PDF summary of findings the user can work from
  offline.
- **Instant delete** — one control wipes the file, the text, the findings and
  the history, immediately and irreversibly.
- **Feedback box** (owner's standing pattern) — suggestion/bug form, email
  required, owner emailed on every submission and every new signup, submitter
  emailed "it's built" when the item ships.
- **Admin portal** — signups, scans/day, score distribution, top failing checks,
  feedback inbox, release history, AI budget consumption. **Never CV content.**

### 5.2 Explicitly out of scope for v1.0

- DOCX upload (v1.1 — the parse core is format-agnostic by design; the DOCX
  reader is the only new part).
- A CV builder or template gallery. Atsy assesses; it does not author.
- Auto-rewriting the whole CV, or generating a "97-score" CV. That produces
  identical, dishonest documents and gets candidates caught.
- Job search, job alerts, applications, cover letters.
- Accounts with passwords, OAuth, or social sign-in. OTP only.
- Payments, tiers, credits.
- Any API or bulk access for recruiters.

## 6. The core flow

```
Land  →  Sign in (email → 6-digit code)  →  Upload PDF  →  Scan (< 20 s)
      →  Score + pillars  →  Fix list  →  X-ray / machine view  →  Fix offline
      →  Re-scan  →  Delta
```

Rules that make the flow feel like an app, not a website (owner's standing
directive from Pricey):

- Progress indicator at the **top** of the flow, never stranded mid-page.
- One dominant CTA per screen; auth lives in the **top-right of a slim nav**,
  never mid-scroll.
- Sub-screens, not one long scrolling page; browser Back navigates between
  screens (History API).
- Every action gives feedback: buttons disable with progress labels
  ("Scanning your CV…"), failures raise a toast with a retry, nothing dead-ends.
- The 6-digit code field auto-submits on the sixth digit; Enter submits every
  form; a double-submit can never create two scans or two OTP requests.
- Offline or failed upload gives a friendly message and recovers.

## 7. Delivering the result

The results screen answers four questions in this order:

1. **"Can a machine read it?"** — the Atsy Score with the parse-safety pillar
   dominant, and the one-line verdict band.
2. **"What is broken?"** — the fix list, Critical first, each with evidence.
3. **"Where exactly?"** — the X-ray overlay and the machine-view text.
4. **"Am I a fit for this job?"** — role-fit panel, when a JD was pasted.

Score bands (published, not adaptive):

| Band | Range | Verdict copy |
| --- | --- | --- |
| Excellent | 90–100 | Parses cleanly everywhere we test. Focus on content. |
| Strong | 75–89 | Safe on modern parsers; a few fixes left. |
| Needs work | 60–74 | Real risk of being mis-read. Fix the criticals. |
| At risk | 0–59 | Likely to be scrambled or dropped. Start at the top. |

Tone of the copy: plain, warm, specific, never patronising and never
catastrophising. The audience is under stress and often has had a bad week.
"Your contact details sit in the page header, where most parsers never look —
move them into the body" beats "CRITICAL FAILURE: HEADER DETECTED".

## 8. Success measures

| Measure | Target at 90 days |
| --- | --- |
| Scan completion (upload → results seen) | ≥ 90% |
| Median time upload → results | ≤ 12 s |
| Re-scan rate (people who fix and return) | ≥ 35% |
| Median score improvement on second scan | ≥ +10 |
| Parse failures we cannot explain | 0 (each one is an incident) |
| Monthly infrastructure cost | ≤ $5 (the existing plan) |
| Feedback items answered | 100% |

## 9. Accessibility and reach

- WCAG 2.2 AA across every screen: contrast, focus order, visible focus rings,
  labels matching visible text, real `<button>` elements, ≥44px tap targets.
- Fully keyboard operable, including the upload control and the X-ray overlay.
- Screen-reader path: findings are a semantic list, not a canvas-only view.
- Works on a mid-range Android phone on a poor connection: no CDN dependencies,
  self-hosted fonts, first meaningful paint under 1.5 s on 3G-class throughput.
- English (NZ/UK spelling in product copy) for v1; the scorer accepts both UK
  and US spelling in CVs and only flags *inconsistency*, never a variant.

## 10. Owner decisions recorded

| Decision | Choice | Why |
| --- | --- | --- |
| Sign-in before scanning | **Required** | Owner directive: CVs and user details stored securely behind Cloudflare OTP. Also the cleanest abuse control and it makes history/delete meaningful. Guest scanning stays available as a switch if the owner wants the funnel later. |
| Storage of the original PDF | **Yes, encrypted, 24h default** | Needed for re-render and re-scan; minimised by hard retention. |
| AI in the scoring path | **No** | Scores must be deterministic and reproducible. AI writes suggestion text only. |
| Owner/admin access to CV content | **Never** | No endpoint exists. Admin sees counts, not documents. |
| Monetisation | **None** | Owner's stated intent: a fully free service. |
