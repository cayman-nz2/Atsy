// Plain-language release history, newest first. Shown in the app so the owner
// (and anyone else) can tell what is live by eye. A unit test enforces that
// RELEASES[0].version === VERSION — bump both together, every release.
export const RELEASES = [
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
