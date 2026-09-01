// Plain-language release history, newest first. Shown in the app so the owner
// (and anyone else) can tell what is live by eye. A unit test enforces that
// RELEASES[0].version === VERSION — bump both together, every release.
export const RELEASES = [
  {
    version: '1.2.2',
    date: '2026-09-01',
    notes: [
      'Fixed the sign-in button staying on \u201cChecking your browser\u2026\u201d. The bot check had nowhere to draw itself, so it never finished, and no code could be requested.',
      'The box holding the check hides itself while it is empty, to keep the form tidy. The code that fills it refused to draw into anything hidden. Each rule was reasonable and together they cancelled out, so the box stayed empty for good.',
      'The check now gets a visible box of the right width before it is asked to draw, on the sign-in form and the upload form alike.',
      'The test suite had switched the bot check off entirely rather than test it, on the belief that it could not work outside the real site. It can, and it is now tested on both forms.',
    ],
  },
  {
    version: '1.2.1',
    date: '2026-09-01',
    notes: [
      'Fixed the sign-in page: the bot check could not load, so the button stayed on \u201cChecking your browser\u2026\u201d and nobody could ask for a code.',
      'The page was sending two different security policies at once. A browser obeys every one it is given and keeps the strictest answer, so the stricter policy blocked the bot check that the other one allowed.',
      'The deploy now reads the live sign-in page after every release and fails if it carries more than one policy, or one that would block the check.',
    ],
  },
  {
    version: '1.2.0',
    date: '2026-09-01',
    notes: [
      'Your CV and your account now live in Cloudflare\u2019s Oceania region \u2014 D1 serves the database from Auckland \u2014 instead of eastern North America.',
      'They were in the United States because the script that created them never said where, so Cloudflare placed them beside the machine that ran it. Nobody chose it.',
      'Neither store can be moved, so both were created fresh in Oceania and the data copied across, with every table\u2019s row count checked against the original before the switch.',
      'The privacy page says Oceania and Auckland, and says plainly that a region is a placement request rather than a jurisdiction \u2014 Cloudflare sells hard boundaries only for the EU and US government, with no New Zealand equivalent.',
    ],
  },
  {
    version: '1.1.1',
    date: '2026-08-31',
    notes: [
      'The privacy page now says where your data physically is: a Cloudflare D1 database and R2 bucket, both in Cloudflare\u2019s ENAM region \u2014 eastern North America \u2014 with no second copy elsewhere.',
      'If you are in the UK or the EU, that means your data is transferred out of the UK or EU to be stored. The page says so plainly now instead of only talking about encryption.',
      'It also admits that the name you gave your file is kept for 30 days, and that CV filenames usually contain your own name. Rename the file first if you would rather it were not.',
      'Both regions are read back from Cloudflare on every deploy and checked against the page, so it cannot quietly go out of date.',
      'Removed a line that still claimed scoring was not built yet. It shipped four releases ago.',
    ],
  },
  {
    version: '1.1.0',
    date: '2026-08-31',
    notes: [
      'The X-ray: your own CV drawn on screen with every finding marked on the part of the page it is about, numbered to match the fix list. Select a mark to jump straight to the fix.',
      'Your PDF is rendered in your browser, not on a server, and only when you open it — nothing about where your file goes has changed.',
      'Bullet findings now tell you which page the bullet is on. They used to say page 1 for every bullet, which was wrong on any CV longer than one page.',
      'Fixed the results screen scrolling sideways when the text is enlarged to 200%.',
    ],
  },
  {
    version: '1.0.0',
    date: '2026-08-31',
    notes: [
      'Atsy is finished and free: upload a CV, see the score, see exactly what a parser reads, and get a fix list ordered by what it costs you.',
      'Your scan history now shows what changed between scans, so you can tell whether a fix actually worked.',
      'A printable report you can save or send to someone who asked why your CV is not getting replies.',
      'The whole product works with a keyboard alone, every page reflows at 200% zoom, and nothing important is carried by colour by itself.',
      'Still free, still no ads, still nothing sold. Your CV is encrypted, deleted after 24 hours, and nobody at Atsy can read it.',
    ],
  },
  {
    version: '0.8.0',
    date: '2026-08-31',
    notes: [
      'Paste a job description and Atsy scores how well your CV matches it — with the must-haves it could not find, and an honest note that 75-85% is the realistic target.',
      'Role Fit never changes your Atsy score. They answer different questions, and a score that moved because you pasted a different job would be useless for tracking progress.',
      'Suggested rewrites for the bullets that need them. Your name, employers, email, phone and links are removed before anything is sent, one bullet at a time, and nothing is ever applied for you.',
      'When AI is unavailable the product still works completely: you get the same deterministic advice the model works from, and it never invents a number.',
      'A feedback box that reaches a person, and gets a reply.',
    ],
  },
  {
    version: '0.7.0',
    date: '2026-08-31',
    notes: [
      'Your CV now gets a score out of 100, with the points broken down across five pillars and every deduction explained.',
      'A fix list ordered worst first: what is wrong, what it costs you, and the exact text in your CV that triggered it.',
      'A risk estimate for six real applicant tracking systems, with the reasons in plain words — and a clear note that it is an estimate, not a score from the vendor.',
      'The machine view: your CV in the order the file stores it, which is the order a parser reads. On a two-column CV this is where the damage becomes obvious.',
      'Scoring is deterministic and never calls a model, so the same PDF always scores the same and a re-scan means something.',
    ],
  },
  {
    version: '0.6.0',
    date: '2026-08-31',
    notes: [
      'Upload a CV and see exactly what an applicant tracking system reads out of it — columns, sections, dates, contact details, and any text hidden from the reader.',
      'Your CV is encrypted before it is stored, deleted automatically after 24 hours, and the text inside it is never saved.',
      'Every scan can be deleted on the spot, and deleting your account now takes every stored CV with it.',
    ],
  },
  {
    version: '0.5.0',
    date: '2026-08-31',
    notes: [
      'The sign-in page is now shielded by a real bot check.',
      'Storage for scanned CVs is provisioned and encrypted, ready for uploads.',
    ],
  },
  {
    version: '0.4.1',
    date: '2026-08-31',
    notes: [
      'Fixed sign-in being refused with "the browser check did not pass" — the page was blocking the bot check from reaching its own servers.',
    ],
  },
  {
    version: '0.4.0',
    date: '2026-08-31',
    notes: [
      'The full scoring rubric — all 49 checks and what each is worth — is now published on the site itself.',
      'How it works and Privacy are reachable from the home page and from every footer.',
      'Emails now come from atsyhello@vibecod3.app, and replies reach a person.',
    ],
  },
  {
    version: '0.3.0',
    date: '2026-08-31',
    notes: [
      'Sharing a link to Atsy now shows a proper preview card in WhatsApp, Slack and iMessage.',
      'A real icon set: browser tabs, iOS home screen, and Android install.',
    ],
  },
  {
    version: '0.2.0',
    date: '2026-08-31',
    notes: [
      'Sign in with a six-digit code sent to your email — no password to remember.',
      'Your account screen, with one button that deletes everything immediately.',
      'Plain-English privacy page and a page explaining exactly how the score works.',
    ],
  },
  {
    version: '0.1.0',
    date: '2026-08-31',
    notes: [
      'First deploy: the Atsy landing page, the design system, and the machine-view demo.',
      'Health endpoint so every deploy proves which version is actually live.',
    ],
  },
];
