// Role Fit: how well one CV matches one pasted job description.
//
// Reported alongside the Atsy Score and never folded into it. A score that
// moved because someone pasted a different job would be useless for tracking
// whether the CV itself got better, which is the whole point of re-scanning.
//
// Deterministic, like everything else in scoring: same CV plus same JD, same
// number, every time. No model participates.

import { words } from './text.js';
import { STOPWORDS } from '../lexicons/spelling.js';

export const WEIGHTS = {
  skills: 55,
  title: 15,
  seniority: 10,
  years: 10,
  placement: 10,
};

// The realistic target, and the reason it is not 100. Copying a JD wholesale
// scores well and reads as obvious padding to the human who opens the CV.
export const TARGET_RANGE = [75, 85];

// A term inside a "must have" block counts double, because the JD said so.
const MUST_HAVE_BLOCK = /(must[- ]?haves?|required|requirements|essential|you (?:will )?(?:must )?have|minimum (?:requirements|qualifications))\b/i;
const NICE_TO_HAVE_BLOCK = /(nice[- ]?to[- ]?have|desirable|preferred|bonus|advantageous)\b/i;

const SENIORITY = [
  { band: 0, words: ['intern', 'trainee', 'graduate', 'junior', 'entry level', 'assistant'] },
  { band: 1, words: ['analyst', 'associate', 'coordinator', 'officer', 'engineer', 'developer', 'specialist', 'consultant'] },
  { band: 2, words: ['senior', 'lead', 'principal', 'staff', 'manager', 'supervisor'] },
  { band: 3, words: ['head of', 'director', 'chief', 'vp', 'vice president', 'partner', 'general manager'] },
];

/** The seniority band a title implies, or null when it says nothing. */
export function seniorityOf(title) {
  const lower = ` ${String(title || '').toLowerCase()} `;
  let found = null;
  for (const level of SENIORITY) {
    for (const word of level.words) {
      if (lower.includes(` ${word} `) || lower.includes(`${word} `)) {
        // The highest band wins: "Senior Engineer" is senior, not mid.
        if (found === null || level.band > found) found = level.band;
      }
    }
  }
  return found;
}

/** Years of experience a JD asks for, as a number, or null. */
export function requiredYears(text) {
  const match = String(text || '').match(/(\d{1,2})\s*\+?\s*(?:-\s*\d{1,2}\s*)?years?/i);
  return match ? Number(match[1]) : null;
}

/**
 * Total tenure in years, counting overlapping roles once.
 *
 * Two concurrent part-time roles are not twice the experience, and a CV that
 * lists a contract alongside the permanent job it ran beside would otherwise
 * claim double.
 */
export function totalTenureYears(roles, now = { year: 2026, month: 8 }) {
  const spans = roles
    .filter((role) => role.range && role.range.from)
    .map((role) => {
      const from = role.range.from.year * 12 + (role.range.from.month || 1);
      const end = role.range.open || !role.range.to
        ? now.year * 12 + now.month
        : role.range.to.year * 12 + (role.range.to.month || 12);
      return [from, Math.max(from, end)];
    })
    .sort((a, b) => a[0] - b[0]);

  let months = 0;
  let cursor = -Infinity;
  for (const [from, to] of spans) {
    const start = Math.max(from, cursor);
    if (to > start) {
      months += to - start;
      cursor = to;
    }
  }
  return months / 12;
}

/** Token-set similarity, which is what "roughly the same title" means. */
export function titleSimilarity(a, b) {
  const left = new Set(words(a).filter((word) => !STOPWORDS.has(word)));
  const right = new Set(words(b).filter((word) => !STOPWORDS.has(word)));
  if (!left.size || !right.size) return 0;
  let shared = 0;
  for (const word of left) if (right.has(word)) shared += 1;
  return shared / Math.max(left.size, right.size);
}

/** Split a JD into its must-have and nice-to-have halves. */
export function splitEmphasis(text) {
  const lines = String(text || '').split(/\n+/);
  let mode = 'body';
  const must = [];
  const rest = [];
  for (const line of lines) {
    if (MUST_HAVE_BLOCK.test(line)) { mode = 'must'; must.push(line); continue; }
    if (NICE_TO_HAVE_BLOCK.test(line)) { mode = 'nice'; rest.push(line); continue; }
    (mode === 'must' ? must : rest).push(line);
  }
  return { mustText: must.join('\n'), restText: rest.join('\n') };
}

/**
 * Score one CV against one job description.
 *
 * `ctx` is the scoring context; `findings` are the Atsy Score's findings, which
 * the integrity guard reads.
 */
export function roleFit(ctx, jobDescription, findings = []) {
  const taxonomy = ctx.taxonomy;
  if (!taxonomy) return null;

  const jd = String(jobDescription || '');
  const { mustText, restText } = splitEmphasis(jd);

  const mustSkills = taxonomy.scan(mustText).filter((skill) => skill.kind === 'hard');
  const otherSkills = taxonomy.scan(restText).filter((skill) => skill.kind === 'hard');
  const mustNames = new Set(mustSkills.map((skill) => skill.canonical));
  // A skill named in both halves is a must-have; it should not be counted twice.
  const wanted = [
    ...mustSkills.map((skill) => ({ ...skill, weight: 2 })),
    ...otherSkills.filter((skill) => !mustNames.has(skill.canonical))
      .map((skill) => ({ ...skill, weight: 1 })),
  ];

  // What the CV actually offers: the skills section plus anything the taxonomy
  // recognises in the experience text, because a skill demonstrated in a bullet
  // counts even when the list forgot it.
  const offered = new Set([
    ...ctx.hardSkills,
    ...taxonomy.scan(ctx.experienceText).filter((skill) => skill.kind === 'hard')
      .map((skill) => skill.canonical),
  ]);

  const matched = wanted.filter((skill) => offered.has(skill.canonical));
  const missing = wanted.filter((skill) => !offered.has(skill.canonical));

  const wantedWeight = wanted.reduce((sum, skill) => sum + skill.weight, 0);
  const matchedWeight = matched.reduce((sum, skill) => sum + skill.weight, 0);
  const skillsScore = wantedWeight
    ? (matchedWeight / wantedWeight) * WEIGHTS.skills
    // A JD with no recognisable hard skills cannot be matched on skills, so the
    // component is neutral rather than zero — scoring a reader down for the
    // job advert's vagueness would be their problem, not the reader's.
    : WEIGHTS.skills * 0.5;

  // Title: compare the JD's title line against the two most recent roles.
  const jdTitle = jd.split(/\n/).map((line) => line.trim()).find(Boolean) || '';
  const recentTitles = ctx.entities.roles.slice(0, 2)
    .map((role) => role.title || role.heading || '')
    .filter(Boolean);
  const titleScore = recentTitles.length
    ? Math.max(...recentTitles.map((title) => titleSimilarity(jdTitle, title))) * WEIGHTS.title
    : 0;

  // Seniority: one band apart is half marks, two or more is none.
  const jdBand = seniorityOf(jdTitle);
  const cvBand = recentTitles.length ? seniorityOf(recentTitles[0]) : null;
  let seniorityScore = WEIGHTS.seniority * 0.5;
  if (jdBand !== null && cvBand !== null) {
    const gap = Math.abs(jdBand - cvBand);
    seniorityScore = gap === 0 ? WEIGHTS.seniority : (gap === 1 ? WEIGHTS.seniority / 2 : 0);
  }

  // Years: meeting the stated minimum is full marks, within one year is half.
  const asked = requiredYears(jd);
  const held = totalTenureYears(ctx.entities.roles);
  let yearsScore = WEIGHTS.years * 0.5;
  if (asked !== null) {
    if (held >= asked) yearsScore = WEIGHTS.years;
    else if (held >= asked - 1) yearsScore = WEIGHTS.years / 2;
    else yearsScore = 0;
  }

  // Placement: a matched skill that also appears in a bullet is evidence; one
  // that appears only in the skills list is a claim.
  const demonstrated = matched.filter((skill) =>
    words(skill.canonical).some((word) => word.length > 2 && ctx.experienceWords.has(word)));
  const placementScore = matched.length
    ? (demonstrated.length / matched.length) * WEIGHTS.placement
    : 0;

  const raw = skillsScore + titleScore + seniorityScore + yearsScore + placementScore;

  // Integrity guard. We do not help anyone game a parser in a way a human
  // reviewer will catch, so the three shapes of gaming cap the result and say
  // which one fired.
  const reasons = [];
  if (findings.some((finding) => finding.id === 'P14')) {
    reasons.push('this CV contains hidden text');
  }
  const repeated = wanted.find((skill) => {
    const pattern = new RegExp(`\\b${skill.canonical.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
    return (ctx.allText.match(pattern) || []).length > 6;
  });
  if (repeated) reasons.push(`"${repeated.canonical}" appears more than six times`);
  if (ctx.listedSkills.length > 40) reasons.push('the skills list runs past forty entries');

  const CAP = 60;
  const score = Math.round(reasons.length ? Math.min(raw, CAP) : raw);

  // A low Role Fit means two very different things, and conflating them would
  // be the most misleading number in the product. If the CV's experience or
  // skills could not be parsed at all — a two-column layout, a table, headings
  // nothing recognises — then this is not "you are a weak match", it is "we
  // could not read your CV", and it says so instead of quietly scoring the
  // person down for their template.
  const unreadable = [];
  if (!ctx.entities.roles.length) unreadable.push('no dated roles could be read from your experience');
  if (!ctx.sections.found.includes('skills')) unreadable.push('no skills section could be found');
  else if (!ctx.hardSkills.length) unreadable.push('no recognisable skills could be read from your skills section');

  return {
    score,
    rawScore: Math.round(raw),
    // When the CV could not be parsed the score is not a judgement of the
    // match; the caller is expected to lead with `unreadable` instead.
    unreadable,
    reliable: unreadable.length === 0,
    capped: reasons.length > 0,
    capReasons: reasons,
    target: TARGET_RANGE,
    components: [
      { id: 'skills', name: 'Hard-skill coverage', weight: WEIGHTS.skills, score: Math.round(skillsScore) },
      { id: 'title', name: 'Title alignment', weight: WEIGHTS.title, score: Math.round(titleScore) },
      { id: 'seniority', name: 'Seniority alignment', weight: WEIGHTS.seniority, score: Math.round(seniorityScore) },
      { id: 'years', name: 'Years of experience', weight: WEIGHTS.years, score: Math.round(yearsScore) },
      { id: 'placement', name: 'Skills shown in your experience', weight: WEIGHTS.placement, score: Math.round(placementScore) },
    ],
    // Ordered by the JD's own emphasis: must-haves first.
    missing: missing.sort((a, b) => b.weight - a.weight).slice(0, 10)
      .map((skill) => ({ name: skill.canonical, mustHave: skill.weight === 2 })),
    matched: matched.map((skill) => skill.canonical).sort(),
    demonstrated: demonstrated.map((skill) => skill.canonical).sort(),
    askedYears: asked,
    heldYears: Math.round(held * 10) / 10,
  };
}
