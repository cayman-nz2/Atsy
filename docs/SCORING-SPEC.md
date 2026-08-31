# Atsy — scoring specification

This is the published rubric. It is deterministic: the same PDF always produces
the same score, because no language model participates in scoring. Anyone can
read this file and predict their result — that is the point.

Two independent numbers are reported:

| Number | Range | Meaning | Changes when |
| --- | --- | --- | --- |
| **Atsy Score** | 0–100 | How safely this CV survives machine reading and how strong its content is | The CV changes |
| **Role Fit** | 0–100 | How well this CV matches one pasted job description | The CV *or* the JD changes |

Role Fit never moves the Atsy Score. A score that changed because the user
pasted a different job would be useless for tracking progress.

---

## 1. Pillars and weights (Atsy Score)

| # | Pillar | Weight | Question it answers |
| --- | --- | --- | --- |
| A | Parse & structure | **35** | Can a machine extract this at all, in the right order? |
| B | Contact & identity | **10** | Can a recruiter reach the person, and is the top block clean? |
| C | Experience & dates | **20** | Is the work history machine-readable and coherent? |
| D | Content & impact | **25** | Would a human be persuaded by it? |
| E | Skills presentation | **10** | Are skills present, findable and honestly stated? |

Each check owns points inside its pillar. A pillar's score is
`max(0, weight − sum(deductions))`; the Atsy Score is the sum of pillar scores,
rounded to a whole number. Deductions never cascade across pillars.

**Fatal checks** (`P01`, `P14`, `P90`) are different: they cap the total score
at the stated ceiling regardless of everything else, because the document is
effectively unreadable or dishonest. The cap is always explained on screen.

Bands: **90–100** Excellent · **75–89** Strong · **60–74** Needs work ·
**0–59** At risk.

---

## 2. Check catalogue

Every check declares: `id`, pillar, points at risk, severity, what triggers it,
what the user is told, and the fix. Severity drives ordering in the fix list —
**Critical** (parse-breaking or fatal), **Major** (measurable damage),
**Minor** (polish). Every finding must carry evidence: page number, text
snippet, and where available the bounding box for the X-ray overlay.

### 2.1 Pillar A — Parse & structure (35 points)

| ID | Points | Severity | Trigger | Fix shown to user |
| --- | --- | --- | --- | --- |
| **P01** | fatal (caps at 25) | Critical | Extracted text < 200 characters, or < 100 characters per page: the PDF is a scan or an image export with no text layer | "This PDF has no text in it — it is a picture of a CV. Every parser sees an empty document. Export it again from Word/Google Docs as a real PDF." |
| **P02** | 6 | Critical | Multi-column body: a vertical gutter ≥ 8% of page width, glyph-free down ≥ 60% of the text height, with ≥ 15% of the page's characters on each side | "Your layout is two columns. Parsers read the text in the order the file stores it, which runs across the gutter — the machine view shows the result. Move to a single column." |
| **P03** | 3 | Critical | Reading-order confidence < 0.85 (Kendall tau between the PDF's own text order and top-to-bottom, left-to-right order) | "The text order stored inside the file does not match what you see. Parsers read the stored order. Rebuild the document rather than repositioning text boxes." |
| **P04** | 3 | Major | Content in the header/footer band (top or bottom 8% of the page) that repeats across pages, or that contains contact details | "Anything in the page header or footer is frequently never read. Move it into the body of the first page." |
| **P05** | 3 | Major | Table detected: ≥ 3 rows in which ≥ 3 text items share x-positions within 2pt, or ruled-rectangle operators enclosing text | "Your content sits in a table. Cell order is not reading order — parsers merge or drop cells. Use plain paragraphs and bullets." |
| **P06** | 2 | Major | Any font used for body text is not embedded, or lacks a `ToUnicode` map | "One of your fonts is not embedded, so the text can extract as gibberish on another machine. Use Calibri, Arial, Georgia, Times New Roman or Garamond and re-export." |
| **P07** | 2 | Critical | Encoding corruption: `(cid:NNN)` tokens, U+FB00–FB06 ligatures in extracted text, or > 15% of tokens are single characters (spaced-out glyphs) | "The extracted text is corrupted — parsers will read fragments of words. Re-export as PDF from your editor rather than printing to PDF." |
| **P08** | 2 | Minor | Bullet glyphs from the private-use area (U+E000–U+F8FF, i.e. icon fonts) or emoji used as bullets | "Your bullet characters come from an icon font and extract as junk. Use a plain round or square bullet." |
| **P09** | 1 | Minor | Emoji or pictographs anywhere in the text | "Emoji do not survive parsing and read as informal to most reviewers. Remove them." |
| **P10** | 2 | Major | Graphic skill meters: image or vector shapes adjacent to skill terms, or repeated identical glyph runs (`●●●○○`) | "Your skill ratings are pictures. A parser records nothing from them — and reviewers distrust self-rated bars. Write plain skill names instead." |
| **P11** | 3 | Critical | Section headings not matched to the canonical list (§3.1); fewer than 2 canonical headings found | "Your section headings are not the ones parsers look for. Use plain labels: Summary, Experience, Education, Skills." |
| **P12** | 2 | Minor | Page count > 3, or file size > 2 MB, or page size is not A4/Letter | "Keep it to one or two pages and a standard page size — long or unusual files get truncated by some upload forms." |
| **P13** | 1 | Minor | Filename contains spaces, `#`, `&`, non-ASCII, or is generic (`resume.pdf`, `cv final v3.pdf`) | "Rename the file `Firstname-Lastname-Role.pdf` — some upload forms mangle names, and recruiters search by filename." |
| **P14** | fatal (caps at 40) | Critical | Hidden text: render mode 3 (invisible), fill colour within ΔE 5 of the page background, font size < 4pt, or glyphs positioned outside the page box | "There is invisible text in this file (white-on-white or off-page). Parsers see it, and ATS vendors and recruiters flag it as keyword stuffing. Remove it." |
| **P15** | 1 | Minor | Links present only as annotation objects with anchor text like "here"/"link"/"portfolio" and no visible URL | "Write your links as visible text (linkedin.com/in/yourname). Link annotations are often stripped." |
| **P16** | 2 | Major | Body text < 9pt, line height < 1.05×, or side margins < 10 mm | "Type is set too tight to survive a print or a preview — and it signals cramming. Use 10–12pt with normal spacing." |
| **P17** | 1 | Minor | Mixed scripts or an undeclared document language, or > 5% of characters outside Latin-1 without a language tag | "Set the document language and keep to one script — some parsers drop unexpected characters." |
| **P90** | fatal (rejected) | Critical | Password-protected/encrypted PDF, XFA-only form, corrupt file, or non-PDF content sniffed | Handled at upload: the file is refused with an explanation before any scan record exists. |

### 2.2 Pillar B — Contact & identity (10 points)

| ID | Points | Severity | Trigger | Fix |
| --- | --- | --- | --- | --- |
| **B01** | 2 | Critical | No name detected in the top 20% of page 1 (2–4 title-case tokens, no digits, not a canonical heading) | "Put your full name on the first line, on its own, in plain text." |
| **B02** | 2 | Critical | No valid email address found | "Add a plain-text email address in the top block." |
| **B03** | 2 | Major | No phone number found, or the number lacks a country code when a country other than the CV's own is targeted | "Add a phone number with its country code (+64 21 …)." |
| **B04** | 1 | Minor | No location line (city, country) — or a full street address is present | "Give city and country only. A full street address is unnecessary and is a privacy risk." |
| **B05** | 1 | Minor | No LinkedIn or portfolio URL in plain text | "Add your LinkedIn URL as visible text." |
| **B06** | 1 | Critical | Contact details found **only** inside the header/footer band | "Your contact details are in the page header, where many parsers never look. Move them into the body." |
| **B07** | 0.5 | Minor | Photo detected (image ≥ 2% of page area, aspect 0.5–1.5, in the top third) | "Most English-speaking markets ask for no photo — it adds parse noise and bias risk. Remove it unless the market expects one." |
| **B08** | 0.5 | Major | Date of birth, marital status, gender, nationality-as-status or national ID detected | "Remove date of birth and personal status details. They are not needed and invite bias." |

### 2.3 Pillar C — Experience & dates (20 points)

| ID | Points | Severity | Trigger | Fix |
| --- | --- | --- | --- | --- |
| **C01** | 5 | Critical | Fewer than one experience entry parsed with all three of title, employer, date range | "Each role needs three things on their own lines: job title, employer, and dates. One of yours is missing." |
| **C02** | 4 | Critical | Any date range not matching an accepted pattern (§3.2), or > 1 date format family used | "Use one date format throughout: `Mar 2023 – Present` or `03/2023 – Present`." |
| **C03** | 3 | Major | Roles not in reverse-chronological order | "List your most recent role first." |
| **C04** | 2 | Major | Unexplained gap > 6 months between consecutive roles | "There is a N-month gap in 2024. Add a one-line entry (study, caring, travel, contracting) so it is not read as missing history." |
| **C05** | 1 | Minor | Current role not marked `Present`/`Current` | "Mark your current role's end date as `Present`." |
| **C06** | 1 | Major | End date before start date, overlapping full-time roles, or a future start date | "Check these dates — the end date is before the start date." |
| **C07** | 2 | Minor | Job titles that no parser normalises ("Ninja", "Guru", "Rockstar", "Wizard", "Evangelist" without a standard title alongside) | "Use the standard title recruiters search for; keep the fun title in brackets if you must." |
| **C08** | 2 | Major | No education section, or an entry missing qualification / institution / year | "Add an education section with qualification, institution and year." |

### 2.4 Pillar D — Content & impact (25 points)

| ID | Points | Severity | Trigger | Fix |
| --- | --- | --- | --- | --- |
| **D01** | 3 | Major | No summary/profile section, or it exceeds 5 lines, or it is generic (matches the cliché lexicon with no role noun) | "Open with 2–3 lines naming your role, your years of experience and your strongest result." |
| **D02** | 4 | Major | < 80% of bullets start with an action verb from the lexicon | "N of your bullets start with a noun or 'Responsible for'. Start each with a verb: Led, Built, Reduced, Delivered." |
| **D03** | 5 | Major | < 40% of bullets contain a quantified outcome (number with %, currency, magnitude, count, time, or an X→Y change) | "Only N% of your bullets contain a number. Add scale and result: how many, how much, how fast, how much better." |
| **D04** | 3 | Minor | Bullets outside 8–30 words; any paragraph block > 60 words inside an experience entry | "Bullets 3, 7 and 9 run long. One idea per bullet, 8–30 words." |
| **D05** | 2 | Minor | First-person pronouns (I, me, my, we, our) present | "Drop 'I' and 'my' — CV bullets are written without pronouns." |
| **D06** | 2 | Major | Cliché/filler phrases from the lexicon ("responsible for", "duties included", "team player", "hard-working", "results-driven", "think outside the box") | "Replace 'responsible for' with what you actually did and what changed." |
| **D07** | 1 | Minor | Any single action verb used more than 3 times | "'Managed' appears 7 times. Vary the verb so each bullet lands differently." |
| **D08** | 1 | Minor | Tense inconsistency: past roles using present-tense verbs, or current role mixing both | "Past roles in past tense, the current role in present tense — keep it consistent." |
| **D09** | 2 | Major | Common typos (lexicon), inconsistent UK/US spelling variants in the same document, or inconsistent brand casing (`javascript`, `Github`, `Linkedin`) | "Two spellings of the same word appear (organise / organize). Pick one. Also: it is GitHub, JavaScript, LinkedIn." |
| **D10** | 1 | Minor | Inconsistent punctuation of bullets (some end with a full stop, some do not) | "Punctuate every bullet the same way." |
| **D11** | 1 | Minor | Acronyms used without expansion on first use (excluding a whitelist: HTML, SQL, CEO…) | "Expand unusual acronyms once: 'RCA (root cause analysis)'." |

### 2.5 Pillar E — Skills presentation (10 points)

| ID | Points | Severity | Trigger | Fix |
| --- | --- | --- | --- | --- |
| **E01** | 4 | Critical | No skills section detected | "Add a Skills section listing your tools and hard skills as plain comma-separated text." |
| **E02** | 2 | Major | Skills only inside a table, columns or graphics (inherits P05/P10 evidence) | "Write skills as a plain comma-separated list, not a grid or chart." |
| **E03** | 2 | Major | Fewer than 6 hard skills recognised against the taxonomy, or the list is entirely soft skills | "List the concrete tools, systems and methods you use. Soft skills alone give a parser nothing to match." |
| **E04** | 1 | Minor | Skills list > 40 items, or > 25% of listed skills never appear in the experience section | "Trim the list. A skill nobody can see you using reads as padding." |
| **E05** | 1 | Minor | Proficiency labels that cannot be verified ("Expert: 10/10", star ratings in text) | "Drop self-rated levels; show the skill in a bullet with a result instead." |

---

## 3. Reference data

### 3.1 Canonical section headings

Matched case-insensitively after stripping punctuation, with a Levenshtein
tolerance of 1 for lengths ≥ 6.

- **Summary**: summary, professional summary, profile, personal profile,
  about me, objective, career objective, executive summary
- **Experience**: experience, work experience, professional experience,
  employment, employment history, work history, career history, relevant experience
- **Education**: education, academic background, qualifications,
  education and training
- **Skills**: skills, technical skills, core skills, key skills,
  core competencies, technical proficiencies
- **Certifications**: certifications, certificates, licences, licenses,
  accreditations
- **Projects**: projects, selected projects, personal projects
- **Also accepted**: publications, awards, honours, volunteering,
  community, languages, interests, references, professional development

Anything else used as a top-level heading triggers `P11` with the offending
text quoted back.

### 3.2 Accepted date patterns

| Pattern | Example |
| --- | --- |
| `MM/YYYY` | `03/2023 – 09/2025` |
| `MMM YYYY` | `Mar 2023 – Sep 2025` |
| `Month YYYY` | `March 2023 – September 2025` |
| `YYYY` | `2023 – 2025` (accepted, but `C02` notes that month precision parses better) |
| Open end | `Present`, `Current`, `Now`, `to date` |

Separators accepted: `–`, `-`, `—`, `to`. Mixing two pattern families in one
document triggers `C02`.

### 3.3 Lexicons (versioned, in `src/lexicons/`, all unit-tested)

| Lexicon | Approx. size | Purpose |
| --- | --- | --- |
| `action-verbs.js` | ~220 verbs with past/present forms | `D02`, `D07`, `D08` |
| `cliches.js` | ~90 phrases | `D01`, `D06` |
| `typos.js` | ~600 common misspellings → correction | `D09` |
| `spelling-variants.js` | ~350 UK/US pairs | `D09` |
| `brand-casing.js` | ~150 product names | `D09` |
| `weak-titles.js` | ~30 titles | `C07` |
| `countries.js` | 250 countries + demonyms | `B04` |
| `acronyms.js` | ~200 whitelisted acronyms | `D11` |
| `stopwords.js` | ~180 words | keyword extraction |

The **skills taxonomy** (~1,500 hard skills with aliases, e.g.
`postgres → PostgreSQL`, `k8s → Kubernetes`) lives in **D1**, not in the
bundle, so it can grow without a deploy. Everything else is bundled because it
is small and needs to be node-testable without a database.

---

## 4. Engine simulation

Each engine gets a **parse-risk rating** derived from the same findings, using
published behaviour (see `RESEARCH.md` §1.3). No engine score is invented; we
report risk and the reasons for it.

Per-engine sensitivity (weight applied to a triggered check):

| Check | Taleo | Workday | iCIMS | Greenhouse | Lever | Ashby |
| --- | --- | --- | --- | --- | --- | --- |
| P01 image-only | 100 | 100 | 100 | 100 | 100 | 100 |
| P02 columns | 60 | 55 | 45 | 35 | 25 | 20 |
| P03 reading order | 40 | 35 | 30 | 25 | 20 | 20 |
| P04 header/footer | 30 | 30 | 25 | 25 | 15 | 15 |
| P05 tables | 45 | 35 | 30 | 30 | 20 | 15 |
| P06/P07 fonts & encoding | 35 | 25 | 40 | 20 | 20 | 15 |
| P11 headings | 45 | 30 | 25 | 20 | 15 | 15 |
| C02 date format | 30 | 20 | 20 | 15 | 10 | 10 |
| P17 unicode | 25 | 10 | 15 | 10 | 10 | 5 |
| Format is PDF (not DOCX) | 15 | 15 | 10 | 5 | 5 | 5 |

Risk = the highest single triggered weight, plus 25% of the sum of the rest,
clamped to 100. **Low** < 20 · **Medium** 20–49 · **High** ≥ 50.

Each engine card lists its top three reasons in plain words, and every card
carries the standing disclaimer:

> Every ATS ships its own parser, and most are configured per employer. This is
> a risk estimate based on how each engine is documented to behave — not a score
> from the engine itself, and not a prediction of one.

---

## 5. Role Fit (only when a job description is pasted)

| Component | Weight | Method |
| --- | --- | --- |
| Hard-skill coverage | 55 | JD terms matched against the taxonomy (with aliases), then `matched / required`. Terms inside a "must have / required / essential" block count double. |
| Title alignment | 15 | Token-set similarity between the JD title and the candidate's most recent two titles, with a seniority-word map. |
| Seniority alignment | 10 | Band from title words and computed tenure (junior / mid / senior / lead / head). One band apart = half marks; two = zero. |
| Years of experience | 10 | JD-stated minimum vs total non-overlapping tenure. Meeting it scores full; within 1 year scores half. |
| Keyword placement | 10 | Matched skills that also appear in an experience bullet, not only in the skills list. |

Reported alongside: the **missing must-haves** (max 10, ordered by JD emphasis),
the **matched terms**, and an explicit note that 75–85% is the realistic target
and that copying the JD wholesale is counter-productive.

**Integrity guard:** if `P14` (hidden text) fires, or any JD term repeats more
than 6 times in the CV, or the skills list exceeds 40 items, Role Fit is capped
at 60 and the reason is shown. We do not help anyone game a parser in a way
that a human reviewer will catch.

---

## 6. AI-written suggestions (never scoring)

For up to 10 bullets that triggered `D02`, `D03`, `D04` or `D06`, Atsy offers a
rewrite. Rules:

1. **Redaction first.** Name, email, phone, URLs and employer names are replaced
   with placeholders before the text leaves the Worker. The model never
   receives identity.
2. **Bullet-level only.** The model rewrites one bullet at a time, from the
   original text plus the triggered check. It never sees the whole CV, and it
   never writes a whole CV.
3. **No invention.** The prompt forbids adding facts, numbers or employers. If
   a bullet lacks a metric, the suggestion contains a `[add number]` placeholder
   for the user to fill — it must never fabricate one.
4. **Labelled.** Every suggestion is shown as "Suggested rewrite — check it is
   true before you use it", and is copy-to-clipboard, never auto-applied.
5. **Budgeted.** Model `@cf/google/gemma-4-26b-a4b-it` (fallback
   `@cf/qwen/qwen3-30b-a3b-fp8`); a hard daily neuron budget; when the budget is
   spent, suggestions degrade to the deterministic template ("Start with a verb,
   add the number, name the outcome") and the product still works completely.
6. **Deterministic settings.** Temperature 0.2, max 120 output tokens per
   bullet, so results are stable and cheap.

---

## 7. Determinism and test obligations

- The scorer is a **pure ES module** (`src/scoring/*.js`) taking a parsed
  document object and returning findings. No I/O, no clock, no randomness, no
  network — so it runs under plain `node` in unit tests.
- **Golden corpus**: at least 20 fixture CVs committed to `tests/fixtures/`,
  covering clean single-column, two-column, table-based, header-contact,
  scanned image-only, hidden-text, icon-bullet, graphics-skills, non-standard
  headings, date-chaos, no-metrics, ESL phrasing, one-page, three-page,
  ligature-corrupt, non-embedded-font, emoji, photo, generic-filename, and a
  near-perfect CV. Each has an expected score and an expected finding set.
- **Property test**: scoring the same fixture twice yields byte-identical JSON.
- **Regression rule**: every scoring change must state the delta on every
  fixture in the PR body. A change that moves a fixture by more than 3 points
  without an explanation fails review.
- **No check ships without**: a fixture that triggers it, a fixture that does
  not, a user-facing message, and a fix instruction.
