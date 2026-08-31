// Plain-language release history, newest first. Shown in the app so the owner
// (and anyone else) can tell what is live by eye. A unit test enforces that
// RELEASES[0].version === VERSION — bump both together, every release.
export const RELEASES = [
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
