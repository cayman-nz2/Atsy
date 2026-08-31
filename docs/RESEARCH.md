# Atsy — research findings

Everything in this document is evidence gathered before design started. Product,
scoring and architecture decisions elsewhere in `docs/` cite the sections here.
Platform facts were read from Cloudflare's own documentation source (the
`cloudflare/cloudflare-docs` repository, `production` branch) on 2026-08-31 —
not from memory. Incident #5 in the Pricey incident log (assuming a Cloudflare
capability that did not exist) is why.

## 0. How to read the evidence in this document — source tiers

Not all of the material below is equally solid, and mixing the tiers would make
the whole document untrustworthy. Every claim is tagged:

| Tier | Meaning | May it appear in product copy? |
| --- | --- | --- |
| **[VERIFIED]** | Read from a primary source we opened ourselves — Cloudflare's own docs, a library's source, a specification | Yes |
| **[MECHANISM]** | A structural fact about how PDF/text extraction works that we can demonstrate ourselves with a fixture, and will | Yes, once our own fixture demonstrates it |
| **[SECONDARY]** | A claim repeated by resume-tool marketing blogs and SEO content sites. Directionally consistent across many of them, but no primary study, methodology or sample was located, and several of these domains are unreachable from this environment | **No — never in product copy, never as a number on screen** |

The rule this creates, and it is a product rule, not a documentation
preference: **Atsy never puts a statistic on screen that it cannot stand behind
itself.** No borrowed percentages, no "97% of resumes are rejected", no
benchmark numbers we did not run. Where we want to make a quantitative claim to
users, we generate the evidence from our own fixture corpus and say how we got
it. The audience is being lied to by enough people already.

---

## 1. How an ATS actually reads a CV

### 1.1 The pipeline

Every mainstream applicant tracking system runs the same five stages, whether
the parser is built in-house (Workday) or licensed (Sovren, Affinda, RChilli):

1. **Text extraction** — pull a character stream out of the PDF/DOCX.
2. **Tokenisation** — split into lines, blocks, tokens.
3. **Sectioning** — decide which block is "experience", "education", "skills".
4. **Named-entity recognition** — find names, employers, titles, dates, skills.
5. **Structured output** — write fields into the candidate record.

Parser accuracy is commonly quoted at "around 87% of fields, versus ~96% for a
human" **[SECONDARY]** — repeated widely, primary source not located, so it does
not go on screen. What is safe to say, and what actually drives the product: a
parser reconstructs structure from a page that was never designed to carry
structure, and everything Atsy scores is about staying inside what that
reconstruction can handle.

### 1.2 What breaks it (ranked by observed impact)

| Failure | Effect | Evidence |
| --- | --- | --- |
| Two-column / sidebar layouts | Text is stored in the PDF in content-stream order, which for a two-column page commonly runs across the gutter — so extraction interleaves the columns. **[MECHANISM]** — demonstrable on our own fixtures; the widely-quoted "7 of 8 parsers" and "35% of failures" figures are **[SECONDARY]** and stay out of product copy | PDF content model; format guides |
| Content in headers/footers | Frequently never read at all — contact details in a header can vanish entirely. | Format guides, Greenhouse guidance |
| Tables and text boxes | Cell order is not reading order; content merges or drops. | Format guides |
| Image-only / scanned PDFs | No text layer, nothing to extract. Total failure. | Universal |
| Non-standard section headings ("My journey") | Sectioning stage fails; experience is never attributed. | Universal |
| Inconsistent or exotic date formats | Employment history cannot be ordered; tenure computed wrong. | Taleo/Workday guidance |
| Custom glyph bullets, icon fonts, emoji | Emit junk characters or nothing into the text stream. | Format guides |
| Skill "rating bars"/dots | Graphics convey zero text; the skill is invisible. | Format guides |
| Missing embedded fonts / broken ToUnicode | Extracted text is garbled or ligature-mangled ("ﬁ", "Se n i o r"). | PDF spec behaviour |

A frequently-quoted figure attributes ~23% of parse failures to formatting
alone **[SECONDARY]** — again, no primary source located, so it stays in this
document and off the screen.

### 1.3 Per-engine behaviour (used for Atsy's engine simulations)

- **Oracle Taleo** — the oldest and strictest. Expects exact-match section
  labels, `MM/YYYY` dates, strictly linear single-column layout. Struggles with
  Unicode and special symbols.
- **Workday** — DOCX parses measurably better than PDF; columns break it.
- **Greenhouse** — more forgiving; handles standard PDF exports well, but can
  misread column order, producing merged or missing content.
- **Lever** — generally forgiving of layout, strong on standard exports.
- **iCIMS** — known trouble with unusual PDF encoding or compression; when
  unsure it asks the *candidate* to retype, not the recruiter to interpret.
- **Ashby** — modern parser, tolerant, but the same heading/date rules apply.

`MMM YYYY – MMM YYYY` and `MM/YYYY` are the two formats every guide agrees on,
and both are unambiguous to a date parser regardless of locale — which is the
reason to prefer them **[MECHANISM]**. The "78% of the ATS market" market-share
figure attached to that advice is **[SECONDARY]**.

### 1.4 The honest truth about "ATS scores"

There is no single ATS score. Each platform ships a different parser and a
different ranking model, several are configured per employer, and most do not
expose a candidate-facing score at all — so no third-party checker can
replicate one **[MECHANISM]**.

A specific cross-engine benchmark ("the same resume scored 84 on Workday, 71 on
Greenhouse, 92 on Lever, 68 on iCIMS, 79 on Taleo across 4,200 resumes, May
2026") circulates on resume-tool blogs. It is **[SECONDARY]**: no methodology,
sample or publisher was located, the hosting domains are unreachable from this
environment, and the shape of the claim is exactly what a content-marketing
page fabricates. **It must not appear in the product, in the UI, or in any
Atsy communication.** The point it illustrates is sound and can be made without
inventing numbers: engines differ, so Atsy reports parse risk and role fit, not
an imagined engine score.

This shapes Atsy's positioning: we report **parse safety** (deterministic,
verifiable, engine-specific) plus **role fit** (keyword coverage against a job
description), and we say plainly that a real ATS may differ. Claiming to
predict "your Workday score" would be a lie, and lying to desperate job seekers
is the one thing this product must never do — which is exactly why we do not
borrow other people's unverifiable statistics to make the point either.

Match-rate guidance in the industry: aim **75–85%** keyword coverage against a
specific job description **[SECONDARY]** — a vendor's own recommended target
rather than a measured outcome. Atsy may use it as a target band because it is
a reasonable, conservative heuristic, but it is labelled as guidance in the UI,
never as a finding, and never with a borrowed statistic attached.

---

## 2. What a good 2026 CV looks like (content, not plumbing)

- **Quantified outcomes** beat task lists ("improved yield from 5% to 33%").
  Universal recruiter advice; treat as craft guidance, not measurement.
- **Action verbs** open every bullet ("Led", "Reduced", "Shipped").
- **One to two pages.** Two only for senior/technical depth.
- **Reverse chronological** work history, most recent first.
- **No photo** unless the market explicitly expects one; no DOB, marital
  status, or national ID (bias risk, privacy risk, parser noise).
- **Standard fonts** (Calibri, Arial, Georgia, Times New Roman, Garamond) at
  10–12pt body / 14–16pt headings.
- **Standard bullets** only; no custom glyphs, icons or emoji.
- **Single column, no sidebars, no floating skills boxes.**
- **File type**: DOCX parses at least as well everywhere and better on Workday
  and Taleo; PDF is fine on modern engines when exported with a real text layer.
  Atsy scans PDFs (the user's stated scope) and tells the user when DOCX would
  be the safer submission.

---

## 3. Competitive landscape

| Tool | Model | Gap Atsy exploits |
| --- | --- | --- |
| Jobscan | Freemium, limited free scans, keyword-centric match rate | Hard paywall; keyword-only view; no parse forensics |
| Resume Worded | Freemium, content scoring | Little PDF-level parse analysis |
| Enhancv / Teal / Rezi checkers | Funnel into a paid builder | The "checker" is a lead magnet for their template |
| Employer-side parsers | Not available to candidates | — |

**Atsy's wedge**: genuinely free, no paywall, no upsell, and it shows the
candidate *what the machine sees* — the extracted text and the exact
coordinates of every problem — rather than an opaque number. Transparency is
the differentiator; the scoring rubric is published in this repository.

---

## 4. Platform capability verification (Cloudflare, read 2026-08-31)

All figures from `cloudflare/cloudflare-docs@production`.

### 4.1 Workers (Paid, $5/mo — the plan already held)

| Item | Paid limit |
| --- | --- |
| Requests | 10 million/month included, +$0.30/million |
| CPU time | 30 million CPU-ms/month included, +$0.02/million |
| CPU per invocation | 5 min max, **30 s default** |
| Request body size | **100 MB** (account plan Free/Pro) |
| Subrequests per invocation | 10,000 |
| Simultaneous outgoing connections | 6 |

### 4.2 D1

- 10 GB max per database, 1 TB per account, 5 GB storage included.
- **25 billion rows read/month** and **50 million rows written/month** included.
- 1,000 queries per Worker invocation; 2 MB max row/BLOB; 100 KB max SQL
  statement; 100 bound parameters per query; 30 s max query duration.
- Time Travel point-in-time recovery: 30 days on Paid.
- Encrypted at rest with AES-256-GCM; TLS in transit.

### 4.3 R2

- Free tier every month: **10 GB-month storage**, 1M Class A ops, 10M Class B
  ops, and **zero egress fees**.
- Beyond that: $0.015/GB-month, $4.50/M Class A, $0.36/M Class B.
- All objects **and their metadata** encrypted at rest with AES-256-GCM.

### 4.4 Workers AI

- **10,000 Neurons/day free allocation on both Free and Paid**; above that on
  Paid, **$0.011 per 1,000 Neurons**. Limits reset 00:00 UTC.
- Relevant model prices (neurons per million tokens, in / out):
  - `@cf/ibm-granite/granite-4.0-h-micro` — 1,542 / 10,158
  - `@cf/qwen/qwen3-30b-a3b-fp8` — 4,625 / 30,475
  - `@cf/google/gemma-4-26b-a4b-it` — 9,091 / 27,273
  - `@cf/openai/gpt-oss-20b` — 18,182 / 27,273
  - `@cf/openai/gpt-oss-120b` — 31,818 / 68,182
  - `@cf/meta/llama-3.3-70b-instruct-fp8-fast` — 26,668 / 204,805
- Text-generation rate limit: 300 requests/minute (per account, default).
- Cloudflare does **not** train models on customer content and does not share
  it with other customers; content is only stored if we store it ourselves.

### 4.5 Workers AI `toMarkdown` (document conversion)

- `env.AI.toMarkdown()` converts PDF, DOCX, XLSX, ODT, CSV, HTML, images.
- **Free for most conversions**; only image conversion spends Neurons (object
  detection `@cf/facebook/detr-resnet-50` + captioning `@cf/google/gemma-4-26b-a4b-it`).
- PDF path: extracts metadata, walks each page, uses the PDF `StructTree`
  (ISO 14289 / PDF-UA tagging) to build semantic Markdown when tags exist, and
  falls back to raw page text when they do not.
- Useful as a **semantic cross-check**, but it deliberately hides layout, so it
  cannot detect columns, header/footer regions or reading-order faults on its
  own.

### 4.6 PDF parsing inside a Worker

`unpdf` ships a serverless build of Mozilla's PDF.js (no canvas, worker
inlined) explicitly tested against Cloudflare Workers, and exposes the
underlying PDF.js API — including `getTextContent()` items with transforms,
widths, heights and font references. That positional data is what makes column
detection, header/footer detection and reading-order scoring possible.

Rendering pages to pixels needs a canvas, which Workers do not have — so the
visual "X-ray" overlay is rendered **client-side** with a vendored PDF.js build
on the file the user already holds.

### 4.7 Cloudflare Email Service (the OTP transport)

- Workers binding: `env.EMAIL.send({ to, from, subject, html, text })`; the
  older raw-MIME `EmailMessage` form (used by Pricey) still works.
- **Workers Paid: 3,000 outbound emails/month included**, then $0.35 per 1,000.
  Sending to *verified destination addresses in the account* (i.e. the owner's
  own inbox) is **always free** and does not touch the quota.
- Limits: 50 recipients/email, 998-char subject, 5 MiB message, 16 KB headers.
- New accounts start on a conservative daily quota that scales with reputation.
- `vibecod3.app` is already onboarded as a sending domain (proved by Pricey
  sending live OTPs from `kea@vibecod3.app` since 2026-08-15), so Atsy needs no
  new domain onboarding.
- Note: emails sent from a Worker show as "dropped" in the Email Routing
  summary even when delivered — use Email Sending metrics instead.

### 4.8 Other platform pieces used

- **Turnstile** — bot shield on OTP request and upload. Site key is public and
  lives in `wrangler.jsonc` vars; the secret is a GitHub secret synced to a
  Worker secret by CI (Pricey pattern). Site keys are per-domain, so Atsy needs
  its own.
- **Rate Limiting binding** (`ratelimits` in wrangler config, Wrangler ≥4.36) —
  edge-side limiter with a 10s or 60s window, applied per Cloudflare location.
  Defence in depth alongside D1-backed counters.
- **Cron Triggers** — retention sweeps and feedback notification sweeps.

### 4.9 Cost model at 1,000 scans/day (all-in)

| Component | Volume | Monthly cost |
| --- | --- | --- |
| Worker requests | ~1.5M | $0 (inside 10M) |
| Worker CPU (~700 ms/scan) | ~21M CPU-ms | $0 (inside 30M) |
| D1 rows | far inside included | $0 |
| R2 storage (24h retention, 300 KB avg) | ~0.3 GB-month | $0 (inside 10 GB) |
| `toMarkdown` PDF conversion | 30k | $0 (free) |
| AI rewrite suggestions (capped, `gemma-4-26b`, ~3k in / 1.2k out) | 30k calls | ~$1.7/mo above the free 10k neurons/day |
| Email OTP | ~3k sign-ins | $0 (inside 3,000/month) |

**Conclusion: the product is genuinely free to run on the existing $5 Workers
Paid plan**, provided (a) scoring is deterministic and AI is used only for
optional rewrite text, (b) AI spend has a hard daily neuron budget with graceful
degradation, and (c) OTP volume is capped. All three are requirements, not
hopes — see `ARCHITECTURE.md` §7.

---

## 5. Design research

### 5.1 How Awwwards actually scores

Awwwards juries (18+ jurors, the 3 most-distant scores dropped) weight:

| Criterion | Weight |
| --- | --- |
| **Design** | 40% |
| **Usability** | 30% |
| **Creativity** | 20% |
| **Content** | 10% |

Design + usability = **70%**. A visually spectacular site that loads slowly or
confuses navigation scores below a clean, fast, well-structured one. 6.5+ earns
an Honorable Mention. This is the exact opposite of "add more effects", and it
matches the owner's standing rules — so Atsy's design spec optimises usability
and craft first, spectacle second.

### 5.2 Techniques winning in 2026

- **Kinetic typography** — type that reacts to scroll/hover/load, powered by
  variable fonts (one file covers the whole weight range).
- **Bento grids** — modular box layouts; measurably deeper scroll engagement.
- **Scroll-driven animation** via native CSS scroll timelines (cheap, 60fps).
- **Editorial type** with confident scale contrast and generous whitespace.
- **Dark mode as a first-class theme**, not an afterthought.
- **Performance as aesthetics** — 60fps or it is not "beautiful", it is broken.

Applied to Atsy (see `DESIGN-SPEC.md`): one count-up score numeral as the only
kinetic moment, a bento findings grid, an annotated document X-ray as the
signature interaction, and hard performance budgets. Motion always respects
`prefers-reduced-motion`.

---

## 6. Privacy and legal context

A CV is dense personal data and can carry special-category data (health,
nationality, religion, DOB). Obligations that shape the design:

- **NZ Privacy Act 2020** (owner's jurisdiction) — Information Privacy
  Principles: collect only what is needed, say why, store securely, allow
  access and correction, notifiable breach reporting.
- **GDPR** (EU/UK users will use this) — lawful basis, data minimisation,
  storage limitation, right of access, rectification, erasure and portability.
- Industry security baseline for CV handling: **encryption at rest and in
  transit, access control, access logging, automatic deletion after a retention
  period**.
- Retention guidance in recruitment: unsuccessful candidate data deleted within
  months, consent-based retention capped around 12 months.

Atsy's response (specified in `SECURITY-PRIVACY.md`): the original file is
encrypted with an application key *before* it reaches R2, deleted within 24
hours by default, never readable by the owner or any admin, never sent to an AI
model without PII redaction, and erasable by the user in one click with a
cascade delete.

---

## 7. Sources

The Cloudflare, unpdf and Awwwards entries were opened and read directly. The
ATS-mechanics and CV-advice entries are resume-industry content sites: they
agree with each other and with the underlying document mechanics, which is why
they are useful for direction, but none of them publishes a methodology. They
are the **[SECONDARY]** tier defined in §0, and nothing sourced only from them
goes on screen as a number.

- [How Resume Parsers Actually Work: Inside Workday, Greenhouse, Lever, iCIMS, Taleo](https://resumeoptimizerpro.com/blog/how-resume-parsers-actually-work)
- [How Workday, Taleo & Greenhouse Read Your Resume — ApplyMate](https://apply-mate.com/blog/workday-taleo-greenhouse-ats)
- [Why ATS Cannot Read Your Resume (and How to Fix It in 2026) — LoopCV](https://www.loopcv.pro/guides/ats-resume-not-parsed/)
- [ATS Resume Format Guide 2026: What Actually Parses — FastApply](https://blog.fastapply.co/ats-resume-format-guide-2026)
- [ATS Resume Formatting Rules 2026 — ResumeAdapter](https://www.resumeadapter.com/blog/ats-resume-formatting-rules-2026)
- [ATS Score Explained: How Resume Scores Are Calculated — Resume Optimizer Pro](https://resumeoptimizerpro.com/blog/ats-resume-score-guide)
- [What's a Good ATS Score? 75%+ Is the Target (2026)](https://airesume.guru/blog/ats-score-resume-match-rates)
- [Resume Trends 2026 — Monster](https://www.monster.com/career-advice/resume/resume-trends)
- [Cloudflare Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)
- [Cloudflare Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/)
- [Workers AI Markdown conversion](https://developers.cloudflare.com/workers-ai/features/markdown-conversion/)
- [Cloudflare Email Service limits](https://developers.cloudflare.com/email-service/platform/limits/)
- [D1 limits](https://developers.cloudflare.com/d1/platform/limits/) · [R2 pricing](https://developers.cloudflare.com/r2/pricing/) · [R2 data security](https://developers.cloudflare.com/r2/reference/data-security/)
- [unpdf](https://www.npmjs.com/package/unpdf) · [pdfjs-serverless](https://github.com/johannschopplich/pdfjs-serverless)
- [Awwwards evaluation system](https://www.awwwards.com/about-evaluation/)
- [Web design trends 2026 — Envato Elements](https://elements.envato.com/learn/web-design-trends)
- [GDPR in recruitment: CV retention](https://nflo.tech/knowledge-base/gdpr-in-recruitment-cv-retention/) · [NZ Privacy Act 2020 overview](https://sprintlaw.co.nz/articles/employee-privacy-rights-in-new-zealand-what-employers-need-to-know/)
