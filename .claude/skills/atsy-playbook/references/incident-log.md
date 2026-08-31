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
