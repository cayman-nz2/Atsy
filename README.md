# Atsy

**A free CV scanner that shows you what a hiring machine sees.**
Live at **https://atsy.vibecod3.app**.

Upload a PDF and Atsy tells you whether an applicant tracking system can read
it, what it will get wrong, and exactly what to change — with the evidence.
Free, permanently: no paywall, no credits, no ads, no trackers.

- Your file is encrypted before it is stored, deleted within 24 hours, never
  readable by anyone at Atsy, and never sent to an AI model with your name on it.
- The scoring rubric is published in this repository. The score is deterministic:
  same CV, same score, every time.
- Every ATS ships a different parser and ranking model, so no third-party tool
  can reproduce an engine's score. Atsy reports parse risk and role fit, says so
  plainly, and never shows a statistic it did not compute itself.

## Documentation

| Document | What it covers |
| --- | --- |
| [`docs/PRD.md`](docs/PRD.md) | Product requirements, scope, flows, success measures |
| [`docs/SCORING-SPEC.md`](docs/SCORING-SPEC.md) | Every check, weight, message and fix — the published rubric |
| [`docs/DESIGN-SPEC.md`](docs/DESIGN-SPEC.md) | Design system, screens, motion, accessibility, verification |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Cloudflare stack, data model, API, pipeline, CI/CD, cost model |
| [`docs/SECURITY-PRIVACY.md`](docs/SECURITY-PRIVACY.md) | Threat model, encryption, OTP auth, retention, compliance |
| [`docs/RESEARCH.md`](docs/RESEARCH.md) | The evidence behind every decision, with sources |
| [`docs/ROADMAP.md`](docs/ROADMAP.md) | Build order, acceptance criteria, owner setup actions |

Working conventions for this repository are in [`CLAUDE.md`](CLAUDE.md).
