# Incident log

Each entry: what happened → root cause → the rule that prevents a repeat.
Read before touching UI layout, SQL, timing logic, Playwright specs, or
anything the owner will see on a phone.

Entries 1–35 are **inherited from Pricey** (cayman-nz2/Money). They were paid
for on a different product but every one of them is a pattern, not a
coincidence, and several are directly aimed at code Atsy has not written yet.
Atsy's own incidents start at #36.

## Process failures

1. **Left audit findings on a backlog.** → Fix everything implementable in the
   same effort; park only decisions that are genuinely the owner's, and say why.
2. **Claimed research was implemented when it was not visible.** → Research
   results must be *seeable* in the product and tracked honestly.
3. **Asked for approval on every small PR.** → Batch into milestones, merge on
   green, report afterwards.
4. **Asked several questions at once.** → One question at a time.
5. **Assumed a Cloudflare capability existed (SMS OTP on the free tier).** It
   did not. → Verify platform capabilities against the documentation before
   proposing them. (Every platform fact in `docs/RESEARCH.md` §4 was read from
   Cloudflare's docs source for this reason.)
6. **Shipped long scrolling pages and called it an app.** → App-shell IA: tabs,
   sub-screens, short screens.
7. **Wrote a domain name from the owner's typo.** → Cross-check names against
   the account and repo facts.

## Shipped or nearly-shipped bugs

8. **Chart overflowed its card on the owner's phone.** Fixed-height bar area
   plus text labels in one container; larger mobile fonts pushed bars over the
   heading. → Never mix fixed-height graphics with text labels in one box; test
   at mobile font sizes.
9. **Background flashed on every navigation.** A `position:fixed` decorative
   pseudo-element composited a frame late on iOS. → First paint must equal the
   final look; decorative layers belong in the body's own background stack.
10. **A "seen" marker was rewritten to `now()` on every visit**, rewinding
    within the same second and re-triggering a celebration. → Markers only move
    forward (`Math.max(since, now)`).
11. **Whole-second timestamps with `>` dropped same-second events.** → Use `>=`
    and bump-past semantics; assume same-second everything in tests.
12. **Entrance animations flashed blank screens on every SPA swap.** → Entrances
    ≤ 0.4 s total; remember every screen change replays them.
13. **A chip wrapped into a broken double pill; a select clipped its label.** →
    Pills fit one line at 393px; dropdown labels fit the closed control.
14. **`export const VERSION` from the entry module broke the deploy** — workerd
    rejects non-handler exports there. → Constants live in `src/*.js`.
15. **SQL used a column name that did not exist.** → grep `migrations/*.sql`
    before writing queries.
16. **A boundary input produced an empty result set.** → Clamp inputs at the
    query edge and test boundary values.
17. **Fast taps landed on a stale screen while the next view fetched.** → Clear
    the screen synchronously before async loads.
18. **A pulse animation moved a button, breaking taps and test stability.** →
    Celebration effects animate box-shadow only, never transform or size on
    tappable elements.
19. **A Google Fonts `<link>` hung page load on a stalled connection.** → Never
    block first paint on a third party. (See #30 — the eventual answer is to
    self-host.)
20. **`div role="button"` rows were invisible to keyboards.** → Interactive rows
    are real `<button>` elements.
21. **Playwright strict-mode violations from `getByText`.** → Role-based
    locators.
22. **`sed` with an unescaped `&` mangled HTML entities.** → Use python string
    replacement for markup; assert occurrence counts before replacing.
23. **Turnstile test keys shipped to production.** → Secret flow is GitHub
    secret → CI sync step → Worker secret; the site key is public config.
24. **Email sending failed because the domain was not onboarded.** → Surface
    provider errors verbatim to the owner; he may hold the fix.
25. **A decorative glow washed the whole hero on a tall iPhone**, erasing the
    edges of white surfaces. → Test decorative gradients at 430×932; white
    surfaces always carry a border; washes stay small corner accents.
26. **Emoji crept onto every button, chip and heading.** → No emoji as chrome.
27. **Sign-in buttons sat mid-page.** → Public pages carry a slim top nav with
    auth top-right; the hero has exactly one primary CTA.
28. **A CTA overlapped the card below it — and it was visible in the
    pre-merge screenshot**, but review only checked that elements existed. →
    Review boundaries and spacing, not presence.
29. **A progress bar was stranded below the content it described.** → Progress
    indicators live at the top of a flow; after any component restyle, re-check
    every screen that composes it.
30. **The brand font never rendered for weeks.** It was injected from a CDN
    after `load`, and the screenshot harness blocked that host — so every visual
    review approved system-font screens. → Self-host brand-critical assets; the
    review harness must render exactly what users see. (Also recurred during the
    fix: the tour ran without rebuilding `dist` and reviewed stale screens.
    `npm run tour` now rebuilds first; never invoke the spec directly.)
31. **Four defects visible on the owner's iPhone that the small light-mode tour
    could not show**: an inline style silently overrode a component's layout
    contract; a text bubble mis-aligned without its icon; a floating element
    drifted over the tile above it; and an embedded third-party widget followed
    the phone's dark mode inside a light card. → Sweep for inline styles after
    component changes; never float an element under other content; always pass
    an explicit theme to third-party widgets; the tour includes an iPhone-size
    dark-mode pass.
32. **A full-code audit found one bug CLASS repeated everywhere state moved:
    check-then-act.** Every reward path read state and then wrote
    unconditionally, so a double-tap double-paid. The same audit found a query
    missing its owner binding (a cross-account leak) and deletes that orphaned
    children. → Every state change is a conditional UPDATE verified through
    `meta.changes`; every reward is bound to server-issued state consumed
    exactly once; every per-user query binds the owner id; every delete
    cascades. When one instance of a bug shape is found, grep for the whole
    class before shipping the fix.
33. **A fold sat flush against the next card and read as an overlap**, and a
    collapsible shipped expanded. → Every stacked surface carries the same
    bottom margin; folds never ship `open`; a CI gate now fails the build if any
    two surfaces' rects intersect. Layout collisions are a gate, not a review
    catch.
34. **A stacked pair of full-width pill buttons looked bizarre** and review
    called the screenshot "acceptable". → Paired actions in a row sit side by
    side; "passable" in a screenshot means it is wrong.
35. **Full-page captures painted a fixed bar over mid-page content and review
    waved it off as a known artifact.** → The harness must show what a user
    sees; never present a screenshot with a known rendering lie in it.

## Verification rules distilled

- Local green ≠ done: CI runs on a fresh database with different timing and has
  caught bugs local runs missed.
- Never "verify" by fetching the live site from the sandbox — the proxy blocks
  it. The Actions API is the source of truth.
- Screenshots are a first-class verification tool. Read them; check boundaries.

## Atsy incidents

36. **An unverified statistic went into the requirements and the design
    artifact as fact** (2026-08-31, owner caught it: "is that real or made
    up"). A cross-engine benchmark — "the same CV scored 84 on Workday and 68
    on iCIMS across 4,200 resumes" — came from a web-search summary of a
    resume-tool marketing blog. The page itself was unreachable from the
    session, so no methodology, sample or publisher was ever seen, yet the
    number was written into the PRD, the scoring spec, the README, the
    playbook and the published design artifact as though it were measured.
    Several other borrowed figures (87% parser accuracy, 35% of failures from
    columns, 23% from formatting, 78% market coverage, 7-of-8 parsers) came
    from the same class of source. → **Two rules.** (1) Evidence is tagged by
    tier in `docs/RESEARCH.md` §0: `[VERIFIED]` (primary source opened
    ourselves), `[MECHANISM]` (structural fact we can demonstrate on our own
    fixtures), `[SECONDARY]` (repeated by industry content sites, no primary
    source located). (2) **Atsy never shows a statistic it did not compute
    itself** — not in the UI, not in an email, not in a post. If a
    quantitative claim is worth making to users, generate it from our own
    fixture corpus and say how. A search-result summary is a lead, not a
    citation: if the page cannot be opened and the methodology cannot be seen,
    the number does not get written down as fact anywhere.

37. **Two components shared the class name `.mark`** (M0). The X-ray annotation
    class collided with the nav wordmark, so every annotated element in the CV
    silently inherited `display: inline-flex` and 20px bold display type. The
    skills list became a flex row, its min-content width blew out the grid, and
    the right-hand column was pushed 300px off-screen. → Component class names
    are unique; a unit test now fails the build if any single-class selector
    sets `display` in two separate rules. Symptoms of this class look like
    layout bugs, not naming bugs — check for a duplicate selector first.

38. **A screenshot review was performed against a stale build.** `wrangler dev`
    snapshots the asset directory at startup and did not pick up a rebuilt
    `dist/`, so the served page — and every screenshot taken of it — was markup
    that no longer existed on disk. Exactly the shape of incident #30. → The
    build now stamps `dist/build.json` with a fresh id, and the first E2E test
    compares the served stamp with the local one and fails with "restart the
    dev server". A review can no longer be looking at a ghost.

39. **The site's own CSP blocked its own inline styles.** The X-ray annotation
    boxes were positioned with `style="…"` attributes, which `style-src 'self'`
    forbids: the browser dropped them, and the console filled with violations.
    The same CSP later blocked Playwright's `addStyleTag` in the tour. → No
    element carries a `style` attribute; positioning lives in CSS classes
    (which also honours the rule that inline styles must never override a
    component's contract, incident #31a). Test-time style injection goes
    through the CSSOM (`sheet.insertRule`) on the page's own stylesheet.

40. **Annotation pins were positioned in fixed pixels and stopped matching
    their content at phone width**, then collided with the CV text once
    re-anchored. → Annotations attach to the element they describe, never to
    coordinates; the pins are real elements (not `::after`) so the
    layout-overlap gate can measure them, and the gate's selector list now
    includes them plus the CV's own labels.

41. **A fixed-height stage clipped the machine view.** Both views were absolutely
    positioned, so neither could size the container, and the extracted-text view
    was cut off mid-content. → Stacked views share one CSS grid cell
    (`grid-area: 1 / 1`), so the container is always as tall as its tallest
    view and switching cannot resize it.

42. **PDF.js detaches the buffer it is handed** (M2). Parsing a file made the
    caller's bytes unusable, so the same upload could not be parsed twice — and
    in the Worker it would have meant the file could not be encrypted for
    storage after being scanned. The determinism test caught it. → Extraction
    copies its input before parsing. A function that reads something must not
    consume it.

43. **PDF.js's font ids carry a per-parse counter** (`g_d13_f1`, `g_d14_f1`, …),
    and they were being written into the document model as the item's font.
    Two scans of the same file returned different documents — the exact thing
    the whole product promises never happens. → Internal ids are mapped to real
    font names before they leave the extractor, and the determinism test
    compares full serialised documents, not a summary.

44. **The operator scanner restored only the transform on `Q`.** Text render
    mode and fill colour are part of the graphics state too, so a single
    invisible run — an OCR underlay, a clipped label — left every later run on
    the page marked as hidden text. That is an accusation of keyword stuffing
    against a CV that did nothing wrong. → Save and restore the whole state.
    When a check can accuse someone, its false-positive path deserves a
    fixture of its own.

45. **The column check's own thresholds made it blind.** The spec's "gutter of
    at least 8% of page width" was written before any PDF had been measured: at
    48pt on A4 it misses most real sidebars. Worse, the rule rejecting
    candidates when many lines "crossed" the gutter fired on exactly the
    two-column layout it exists to find, because every row of a two-column page
    has content on both sides. → Thresholds get validated against fixtures
    before they are written into a spec, and a check that finds nothing on its
    own positive fixture is broken, however sensible its rules read.

46. **PDF.js reports fill colours as `'#rrggbb'` strings, not numbers.** The
    white-on-white detector silently read NaN and never fired. → Handle both
    shapes, and prove each detector fires on a fixture built to trigger it —
    a detector that has never fired is not evidence of a clean corpus.

47. **A file was emptied by reading and writing it in one expression** — twice
    in one session, on the same file. `io.open(path, 'w').write(io.open(path).read())`
    truncates before the read runs, because Python evaluates arguments left to
    right. Both times the unit tests caught it immediately (`does not provide
    an export named 'VERSION'`), but the second time is the point: an
    unremarkable slip repeated is a habit. → Edit files by reading fully into a
    variable first, then writing. Never nest a read inside the write call.

48. **A provisioning step reported success on a failure.** `npx wrangler r2
    bucket create … | tee r2.log` exits with *tee's* status, not wrangler's, so
    a run that failed with "Please enable R2 through the Cloudflare Dashboard"
    printed "atsy-cv is ready" and skipped the branch written to explain that
    exact error. The truth was only two lines above it in the log. → Any
    pipeline whose exit status is checked needs `set -o pipefail`. More
    generally: a step that reports its own result must be tested against a
    failing case, or it is only tested against the happy path — the same shape
    as the deploy check that would have passed on two empty strings (#47's
    neighbour in this log).

49. **Nobody could sign in to the live site** (v0.4.1, owner hit it within
    minutes of the first deploy: "The browser check did not pass"). Two
    independent mistakes, both mine, both in the security work:
    (a) The sign-in page's CSP allowed Turnstile's *script* and *frame* but
    left `connect-src 'self'`, so the widget could load and never talk to its
    own servers. No token was ever produced. The design spec had the right
    policy written down — `connect-src 'self' https://challenges.cloudflare.com`
    — and the value that shipped in `_headers` dropped it.
    (b) With no secret configured, `verifyTurnstile` called siteverify with
    Cloudflare's always-pass *test* secret. That looks harmless, but an empty
    token still returns `missing-input-response`, so an unconfigured shield
    refused every sign-in — failing closed for a reason that had nothing to do
    with bots.
    → An allowlist for a third-party embed covers every directive it needs, not
    just the obvious one; copy the policy from the spec rather than retyping
    it. A security control that is switched off must be *off*, not
    half-configured — and any auth path that can refuse everyone needs a test
    that proves a real person still gets through. Both now have one.

50. **The bot-check gating locked the E2E suite out, the same way it had locked
    the live site out.** Making the submit button wait for a Turnstile token is
    right, but the E2E environment had a real site key in `wrangler.jsonc`, so
    the page tried to load a widget that a sandbox cannot reach and the button
    waited forever. Seven sign-in tests failed in exactly the shape of incident
    49. → E2E now blanks `TURNSTILE_SITE_KEY` as well as bypassing verification:
    an environment with no shield must look like one to the client as well as
    the server. Half-configured is the state that breaks things — see #49.
