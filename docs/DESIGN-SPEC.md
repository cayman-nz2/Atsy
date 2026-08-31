# Atsy — design specification

The design target is an Awwwards-standard product site that would still pass a
usability audit. Awwwards juries weight **Design 40 / Usability 30 / Creativity
20 / Content 10** — design and usability are 70% of the score, and a
spectacular site that loads slowly or confuses navigation loses to a clean,
fast one (`RESEARCH.md` §5.1). So: one signature idea, executed perfectly, on
top of a fast, conventional, accessible skeleton.

---

## 1. Concept — "Ink & Signal"

A CV is ink on paper. An ATS is a machine that turns that paper into a data
record, badly. Atsy sits between the two and shows the transformation.

- **Ink** — a warm paper surface, editorial typography, generous margins. The
  document is treated with respect.
- **Signal** — one saturated accent, used only for actions and for the moment
  the machine "reads" the page.
- **The machine view** — everything the parser extracted, rendered in
  monospace. Seeing your careful two-column layout collapse into interleaved
  monospace nonsense is the most persuasive thing the product can show. That
  contrast — proportional ink versus monospace signal — is the whole design
  language.

The signature interaction is the **X-ray**: the user's own page rendered, with
problem regions highlighted in place, and a toggle that cross-fades the page
into the machine's version of it. It is creative *and* it is the core utility.
Nothing else in the interface tries to be clever.

---

## 2. Design tokens

Defined once in `public/atsy.css` on `:root`, with the dark palette redefined
under both `@media (prefers-color-scheme: dark)` (guarded with
`:root:not([data-theme="light"])`) and `:root[data-theme="dark"]`. Every colour
gets its light definition on bare `:root` — never only inside a media query.

### 2.1 Colour

```css
:root {
  /* surfaces */
  --paper:        #FAF8F4;   /* page */
  --card:         #FFFFFF;   /* raised surface */
  --card-edge:    #E4DFD6;   /* EVERY white surface carries this border */
  --ink:          #14161A;   /* primary text */
  --ink-2:        #4A4F58;   /* secondary text */
  --ink-3:        #767C86;   /* tertiary / meta */

  /* the single action colour */
  --signal:       #3A32E0;
  --signal-ink:   #FFFFFF;
  --signal-soft:  #EEEDFF;

  /* semantic — reserved, never decorative */
  --sev-critical: #B3261E;
  --sev-major:    #A85B00;
  --sev-minor:    #5B6470;
  --band-risk:    #B3261E;
  --band-work:    #A85B00;
  --band-strong:  #1F6F63;
  --band-great:   #1B7A3D;

  /* the machine view */
  --machine-bg:   #101318;
  --machine-ink:  #C9D4E3;
  --machine-hit:  #3A32E0;
}
```

Rules (owner's standing colour discipline):

- **One action colour per screen.** `--signal` is the only colour a button may
  use for its primary state.
- Semantic colours appear **only** on severity chips, the score band and the
  engine risk badges. Never as decoration, never as a background wash.
- **Every white surface carries `--card-edge`.** Nothing relies on the page
  background for its boundary (Pricey incidents #25, #33).
- Decorative gradients stay small corner accents; nothing washes a whole
  viewport (Pricey incident #25 — a "corner glow" covered the top third of a
  tall iPhone).
- Contrast: body text ≥ 7:1, secondary ≥ 4.5:1, every non-text UI boundary
  ≥ 3:1. Checked in CI, not by eye.

### 2.2 Type

Three self-hosted variable faces, subset to Latin, preloaded, `font-display:
swap`, served from `/fonts`. **No third-party font hosting, ever** (Pricey
incident #30: the brand font silently never rendered for weeks because it was
injected from a CDN after load).

| Role | Face | Use |
| --- | --- | --- |
| Display | **Bricolage Grotesque** (variable, OFL) | Wordmark, hero, score numeral, section titles |
| UI / body | **Inter** (variable, OFL) | Everything else |
| Machine | **JetBrains Mono** (variable, OFL) | The machine view, evidence snippets, file names |

Scale (fluid, `clamp()`, 393px → 1440px):

| Token | Size | Line height | Tracking |
| --- | --- | --- | --- |
| `--t-score` | 96 → 168px | 0.9 | −0.03em, tabular figures |
| `--t-hero` | 34 → 64px | 1.05 | −0.02em |
| `--t-h1` | 26 → 36px | 1.15 | −0.01em |
| `--t-h2` | 20 → 24px | 1.25 | 0 |
| `--t-body` | 16 → 17px | 1.6 | 0 |
| `--t-small` | 14px | 1.5 | 0 |
| `--t-mono` | 13 → 14px | 1.7 | 0 |

Body text never goes below 16px on mobile. Assume larger system font sizes than
the desktop default when checking layouts (Pricey incident #8).

### 2.3 Space, radius, elevation

- Spacing scale: 4, 8, 12, 16, 24, 32, 48, 64, 96 (`--s1`…`--s9`).
- Every stacked surface carries the same bottom margin (`--s4`) so a card
  following a card never sits flush (Pricey incident #33).
- Radius: 6px controls, 14px cards, 999px chips.
- Elevation: one soft shadow token for raised cards; no 3D lips, no stacked
  shadows. Buttons never animate their size or position (Pricey incident #18) —
  pressed state changes background and border only.

### 2.4 Icons

A small hand-built SVG set (upload, file, alert, check, chevron, eye, trash,
copy, download, link, shield, clock), stroke 1.5, 24×24, `currentColor`,
inlined as a sprite. **No emoji anywhere in the interface** — not on buttons,
chips, headings or labels (owner order; Pricey incident #26).

---

## 3. Motion

| Moment | Duration | Notes |
| --- | --- | --- |
| Screen change | 180 ms fade + 8px rise | Total entrance budget ≤ 0.4 s, replayed on every SPA screen swap (Pricey incident #12) |
| Finding list entrance | 3 × 40 ms stagger, capped | Never per-item beyond the first six |
| Score count-up | 500 ms, ease-out, tabular figures | The one kinetic-typography moment |
| Scan progress | Indeterminate sweep across the page thumbnail | Reads as "scanning", replaced by real stage labels |
| X-ray ⇄ machine view | 320 ms cross-fade | The signature transition |
| Hover/press | 120 ms | Colour only |

`@media (prefers-reduced-motion: reduce)` removes all of it: the score appears
at its final value, transitions become instant, the sweep becomes a static bar.
First paint must equal the final look — no fixed-position decorative layers
that composite a frame late (Pricey incident #9).

---

## 4. Screens

An app shell, not a stack of long pages. Slim top nav: wordmark left, one
action right (Sign in → account menu). Browser Back navigates between screens
via the History API. No long scrolling appendages.

### 4.1 Landing (`/`)

Above the fold, in one viewport at 393×851:

1. Wordmark + nav with **Sign in top-right** (never mid-page — Pricey #27).
2. Hero: one line of display type — *"See your CV the way a hiring machine
   sees it."* — one supporting sentence, and one primary CTA: **Scan my CV**.
3. The proof strip: a live, silent demo of the X-ray transformation on a sample
   CV (2-column paper → scrambled monospace). It plays once, ≤ 3 s, and is
   replaced by a static frame under reduced motion.

Below: three bento tiles (what gets checked, what you get back, what happens to
your file), an honest "what this is not" note (no ATS gives out its score), the
privacy promise, feedback link, footer with version.

### 4.2 Sign in

Single email field → 6-digit code screen. The code field auto-submits on the
sixth digit, accepts paste, and shows "Signing you in…" on the button. Turnstile
is explicitly themed to match the app (never inheriting the device theme —
Pricey incident #31d). Resend after 30 s with a visible countdown.

### 4.3 Upload

One dropzone occupying the working area: drag, click, or paste a file. States:
idle · dragging · reading · uploading (%) · scanning (stage label) · error.
Constraints stated *before* the error: "PDF, up to 5 MB, up to 10 pages."
Optional, collapsed: "Paste the job description to also check role fit."

### 4.4 Results (the product)

Top: the score. A large numeral, the band word, one plain sentence of verdict,
and the delta against the previous scan if there is one. Under it, five pillar
bars with their point totals.

Then a sticky segmented control — **Fixes · X-ray · Machine view · Engines ·
Fit** — the progress/navigation lives at the **top** of the flow (Duolingo
convention; Pricey incident #29), never stranded below content.

- **Fixes** — grouped Critical / Major / Minor. Each card: title, the evidence
  snippet in mono, the fix as an instruction, `+N points`, and "Show me"
  which jumps to the X-ray with that region highlighted.
- **X-ray** — the rendered page with problem regions boxed and numbered;
  pinch/scroll zoom; keyboard-navigable region list beside it for screen
  readers and keyboards.
- **Machine view** — extracted text in monospace on `--machine-bg`, with the
  reading-order path drawn; matched keywords highlighted when a JD is present.
- **Engines** — six cards (Workday, Greenhouse, Lever, iCIMS, Taleo, Ashby),
  each with a risk badge, its top three reasons, and the standing disclaimer.
- **Fit** — Role Fit number, matched terms, missing must-haves, and the
  "75–85% is the target, do not copy the JD" guidance.

A single quiet secondary action set: download report · re-scan · delete.

### 4.5 History

A list of previous scans: date, filename, score, delta, band. Tapping one opens
its result (findings survive 30 days; the file itself is gone after 24 hours,
stated plainly on the row).

### 4.6 About / Privacy / Feedback

- `/about` — how the score works, linking to the published rubric.
- `/privacy` — the storage and deletion promise in plain English, with a
  visible **Delete everything** control.
- `/feedback` — type (idea/bug), message, email **required** ("so we can tell
  you when it is built"), owner emailed on submit.

### 4.7 Admin (`/admin`, gated by `ADMIN_EMAILS`)

Aggregates only: signups, scans/day, completion rate, score histogram, top
triggered checks, engine-risk distribution, AI neurons vs budget, emails sent
this month, feedback inbox in every status, release history. **No CV content,
no filenames, no snippets** — by design and by test.

---

## 5. Empty, loading, error and edge states

Every screen specifies all four. Non-negotiables:

- A failed upload states the reason in the user's terms ("This PDF is password
  protected — save an unprotected copy and try again") and keeps the dropzone
  ready for a retry.
- A scanned/image-only PDF is not an error: it is a result, with the score
  capped and the single fix that matters explained.
- Network failure raises a toast with a retry that actually retries.
- A double-tap can never create two scans, two OTP requests, or two accounts.
- Offline shows a friendly message and recovers when connectivity returns.
- Nothing spins forever: every async state has a timeout and a next step.

---

## 6. Accessibility (WCAG 2.2 AA, enforced)

- Real `<button>` and `<a>` elements — never `div role="button"` (Pricey #20).
- Visible focus ring on every interactive element, 2px `--signal` with offset.
- Tap targets ≥ 44×44 CSS px, with ≥ 8px between adjacent targets.
- Labels match their visible text; the OTP field is a labelled single input,
  not six boxes that break screen readers and paste.
- The X-ray canvas has a parallel semantic list of regions; nothing is
  canvas-only.
- Colour is never the only signal: severity carries an icon and a word.
- `prefers-reduced-motion` and `prefers-contrast` honoured.
- Page language set; headings form a correct outline; landmarks present.
- Full keyboard journey: land → sign in → upload → read every finding →
  delete, without a mouse. This is an E2E test, not a review item.

---

## 7. Responsive and device rules

- Design at **393×851** (small modern phone) and **430×932** (the owner's
  iPhone) first, then 768 and 1280.
- No horizontal page scroll ever. Wide content (the machine view, the X-ray)
  scrolls inside its own container.
- Chips and pills must fit one line at 393px; dropdown labels must fit the
  closed control (Pricey incident #13).
- Both themes are designed: light is primary, dark is a real palette, and
  `color-scheme: light dark` is declared so Android Chrome cannot invent its
  own (Pricey incident #31d applies to any embedded widget too — Turnstile is
  always given an explicit theme).
- Fixed elements never overlay content in a full-page capture; the tour pins
  them so screenshots show what a user sees (Pricey incident #35).

---

## 8. Voice and copy

The audience may have had forty rejections this month. Tone: calm, specific,
respectful, never patronising, never catastrophising, never salesy.

- Say what is wrong, where, and what to do: *"Your contact details sit in the
  page header, where most parsers never look — move them into the body."*
- Never invent authority: *"Real ATS engines disagree with each other; this is
  a risk estimate, not their score."*
- No fake urgency, no "97% of resumes are rejected", no countdowns, no
  gamified streaks, no dark patterns, no upsell — there is nothing to sell.
- No emoji in product copy. No exclamation marks in the brand name.
- Numbers are always explained: *"+6 points"* next to *"why"*.
- UK/NZ spelling in product copy.

---

## 9. Visual verification (how a defect stops being possible)

The owner has repeatedly found visual bugs that code review missed. The harness
must therefore render exactly what a user sees:

1. `npm run tour` **always rebuilds `dist` first** and captures every screen and
   state at 393×851 and 430×932, in light and dark. Never invoke the spec
   directly (Pricey incident #30).
2. Fonts are local, so screenshots show the real typeface (incident #30).
3. Animations are frozen at their end state before capture; fixed bars are
   pinned so full-page captures cannot lie (incident #35).
4. Review checks **boundaries, not presence**: does anything collide, is the
   spacing right, does any pill wrap.
5. A **CI overlap gate** fails the build if any two rendered surfaces intersect
   on any page (incident #33). Layout collisions are a build failure, not a
   review catch.
6. After changing any shared component, re-review **every** screen that
   composes it, not a sample (incident #29).
7. "Looks a bit off but passable" in a screenshot means it is wrong — fix
   before shipping (incident #34).

---

## 10. Awwwards self-assessment (target ≥ 7.0)

| Criterion | Weight | How Atsy earns it |
| --- | --- | --- |
| Design | 40% | One editorial type system, one accent, disciplined spacing, both themes designed, every surface bounded |
| Usability | 30% | One CTA per screen, top-anchored progress, full keyboard path, WCAG 2.2 AA, 1.5 s first paint, no CDN, honest empty/error states |
| Creativity | 20% | The X-ray and the ink→monospace transformation: a genuinely new way to see your own CV, and it is the utility, not a decoration |
| Content | 10% | Published rubric, plain-English privacy, honest disclaimers, copy that respects the reader |
