// Plain-language release history, newest first. Shown in the app so the owner
// (and anyone else) can tell what is live by eye. A unit test enforces that
// RELEASES[0].version === VERSION — bump both together, every release.
export const RELEASES = [
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
