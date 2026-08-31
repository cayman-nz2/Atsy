// Job titles no parser normalises and no recruiter searches for (C07).
//
// The problem is not that they are informal. It is that a search for
// "Software Engineer" will never return a "Code Ninja", so the CV is invisible
// to the query that was looking for exactly this person.

export const WEAK_TITLES = [
  'ninja', 'guru', 'rockstar', 'rock star', 'wizard', 'jedi', 'sherpa',
  'evangelist', 'hacker', 'maverick', 'superstar', 'hero', 'champion',
  'alchemist', 'architect of', 'catalyst', 'chief happiness officer',
  'growth hacker', 'brand ambassador', 'people person', 'magician',
  'visionary', 'thought leader', 'storyteller', 'swiss army knife',
  'jack of all trades', 'problem solver', 'change agent', 'disruptor',
  'trailblazer', 'unicorn', 'samurai', 'genius', 'whisperer', 'maestro',
];

// A standard title alongside the fun one rescues it: "Code Ninja (Software
// Engineer)" is searchable. These are the anchors that count as standard.
export const STANDARD_TITLE_WORDS = [
  'engineer', 'developer', 'manager', 'analyst', 'designer', 'consultant',
  'director', 'officer', 'administrator', 'specialist', 'coordinator',
  'lead', 'head', 'architect', 'scientist', 'researcher', 'technician',
  'accountant', 'auditor', 'advisor', 'adviser', 'assistant', 'associate',
  'supervisor', 'strategist', 'producer', 'editor', 'writer', 'planner',
  'controller', 'partner', 'principal', 'president', 'executive', 'chief',
  'nurse', 'teacher', 'lecturer', 'surveyor', 'buyer', 'recruiter',
  'marketer', 'salesperson', 'representative', 'operator', 'foreman',
];

export function weakTitleIn(title) {
  const lower = String(title || '').toLowerCase();
  const weak = WEAK_TITLES.find((word) => new RegExp(`\\b${word}\\b`).test(lower));
  if (!weak) return null;
  const rescued = STANDARD_TITLE_WORDS.some((word) => new RegExp(`\\b${word}s?\\b`).test(lower));
  return rescued ? null : weak;
}
