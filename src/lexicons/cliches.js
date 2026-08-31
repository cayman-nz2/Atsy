// Filler that says nothing (D06) and the generic-summary test (D01).
//
// Each phrase is here because it displaces a fact. "Responsible for the team"
// tells a reader nothing that "Led 12 engineers" does not tell them better.

export const CLICHES = [
  'responsible for', 'duties included', 'duties involved', 'tasked with',
  'in charge of', 'helped with', 'assisted with', 'worked on', 'involved in',
  'participated in', 'exposure to', 'familiar with', 'knowledge of',
  'team player', 'hard working', 'hard-working', 'hardworking',
  'results driven', 'results-driven', 'detail oriented', 'detail-oriented',
  'self starter', 'self-starter', 'self motivated', 'self-motivated',
  'go getter', 'go-getter', 'think outside the box', 'thinking outside the box',
  'outside the box', 'best of breed', 'best-in-class', 'value add',
  'value-add', 'synergy', 'synergies', 'leverage synergies',
  'dynamic professional', 'seasoned professional', 'proven track record',
  'track record of success', 'excellent communication skills',
  'strong communication skills', 'excellent interpersonal skills',
  'strong work ethic', 'works well under pressure', 'work well under pressure',
  'multi tasker', 'multitasker', 'wear many hats', 'wears many hats',
  'passionate about', 'love what i do', 'people person',
  'thought leader', 'thought leadership', 'guru', 'ninja', 'rockstar',
  'game changer', 'game-changer', 'move the needle', 'low hanging fruit',
  'low-hanging fruit', 'circle back', 'touch base', 'boil the ocean',
  'take it to the next level', 'next level', 'cutting edge', 'cutting-edge',
  'bleeding edge', 'world class', 'world-class', 'best practice',
  'industry leading', 'industry-leading', 'highly motivated',
  'highly organised', 'highly organized', 'goal oriented', 'goal-oriented',
  'strategic thinker', 'big picture thinker', 'out of the box thinker',
  'quick learner', 'fast learner', 'eager to learn', 'willing to learn',
  'references available on request', 'references available upon request',
  'seeking a challenging position', 'challenging position',
  'looking for an opportunity', 'utilise my skills', 'utilize my skills',
  'a wide variety of', 'various tasks', 'day to day', 'day-to-day',
];

const NORMALISE = (text) => String(text || '').toLowerCase()
  .replace(/[‘’]/g, "'")
  .replace(/[^a-z0-9'\- ]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

/** Every cliché present in the text, each reported once, longest first. */
export function findCliches(text) {
  const haystack = NORMALISE(text);
  const found = [];
  for (const phrase of CLICHES) {
    if (haystack.includes(phrase)) found.push(phrase);
  }
  // Longest first so "results-driven" is reported rather than its fragments.
  return found.sort((a, b) => b.length - a.length)
    .filter((phrase, index, all) => !all.slice(0, index).some((longer) => longer.includes(phrase)));
}
