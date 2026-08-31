// Pillar D — Content & impact (25 points).
//
// "Would a human be persuaded by it?" This is the only pillar a parser does
// not care about, and the one that decides whether the human who gets past the
// parser calls you. It carries the second-largest weight for that reason.

import {
  wordCount, firstWord, hasQuantifiedOutcome, firstPersonPronouns,
  unexpandedAcronyms, sentences, words,
} from './text.js';
import { verbLemma, verbTense } from '../lexicons/action-verbs.js';
import { findCliches } from '../lexicons/cliches.js';
import { SPELLING_VARIANTS, TYPOS, BRAND_CASING, KNOWN_ACRONYMS } from '../lexicons/spelling.js';

/**
 * Evidence for one bullet: the page it is actually on, and the region it
 * occupies there.
 *
 * Every check here used to report `page: 1` for every bullet, which is simply
 * wrong on a two-page CV — the reader was sent to the wrong page to find the
 * thing being complained about. `ctx.bulletBoxes` is index-aligned with
 * `ctx.bullets`, so the bullet's own position is available and both the page
 * number and the box come from it.
 */
function bulletEvidence(ctx, text, prefix) {
  const index = ctx.bullets.indexOf(text);
  const box = index >= 0 ? ctx.bulletBoxes[index] : null;
  return {
    page: (box && box.page) || 1,
    text: prefix ? `${prefix}${text}` : text,
    box: box ? { x: box.x, top: box.top, width: box.width, height: box.height } : null,
  };
}

/** The same, for a check whose evidence is a phrase found inside a bullet. */
function phraseEvidence(ctx, phrase) {
  const owner = ctx.bullets.find((bullet) =>
    bullet.toLowerCase().includes(String(phrase).toLowerCase()));
  return owner ? bulletEvidence(ctx, owner, null) : { page: 1, text: phrase, box: null };
}

// Below this many bullets the percentage checks say nothing: two bullets
// without numbers is not "0% quantified", it is too small a sample to judge.
const MIN_BULLETS = 4;

export const PILLAR_D = [
  {
    id: 'D01',
    points: 3,
    severity: 'major',
    title: 'The summary is missing, long, or generic',
    run(ctx) {
      if (!ctx.sections.found.includes('summary')) {
        return {
          message: 'Open with a two or three line summary naming your role, your years of experience and your strongest result. It is the only part of a CV most readers finish.',
          evidence: [{ page: 1, text: 'no summary or profile section found' }],
        };
      }
      const text = ctx.summaryText;
      const lines = ctx.summaryLines.filter((line) => line.text.trim());
      if (lines.length > 5) {
        return {
          message: 'Your summary runs to more than five lines. Cut it to two or three — a long summary is skipped, which wastes the best position on the page.',
          evidence: [{ page: lines[0].page, text: `${lines.length} lines` }],
        };
      }
      const cliches = findCliches(text);
      const hasRoleNoun = /\b(manager|engineer|developer|analyst|designer|consultant|director|specialist|coordinator|lead|officer|administrator|accountant|nurse|teacher|scientist|architect|technician|advisor|adviser|executive)\b/i.test(text);
      if (cliches.length && !hasRoleNoun) {
        return {
          message: 'Your summary is made of phrases that could describe anyone. Name the role you do, how long you have done it, and one result.',
          evidence: [{ page: lines[0] ? lines[0].page : 1, text: `generic phrasing: ${cliches.slice(0, 3).join(', ')}` }],
        };
      }
      return null;
    },
  },

  {
    id: 'D02',
    points: 4,
    severity: 'major',
    title: 'Bullets do not start with a verb',
    run(ctx) {
      if (ctx.bullets.length < MIN_BULLETS) return null;
      const weak = ctx.bullets.filter((bullet) => !verbLemma(firstWord(bullet)));
      const share = weak.length / ctx.bullets.length;
      if (share <= 0.2) return null;
      return {
        message: `${weak.length} of your ${ctx.bullets.length} bullets start with something other than a verb. Start each one with what you did: Led, Built, Reduced, Delivered.`,
        evidence: weak.slice(0, 3).map((text) => bulletEvidence(ctx, text)),
      };
    },
  },

  {
    id: 'D03',
    points: 5,
    severity: 'major',
    title: 'Bullets carry no numbers',
    run(ctx) {
      if (ctx.bullets.length < MIN_BULLETS) return null;
      const quantified = ctx.bullets.filter(hasQuantifiedOutcome);
      const share = quantified.length / ctx.bullets.length;
      if (share >= 0.4) return null;
      const percent = Math.round(share * 100);
      return {
        message: `Only ${percent}% of your bullets contain a number. Add scale and result: how many, how much, how fast, how much better. This is the single biggest difference between a CV that gets a call and one that does not.`,
        evidence: ctx.bullets.filter((bullet) => !hasQuantifiedOutcome(bullet)).slice(0, 3)
          .map((text) => bulletEvidence(ctx, text)),
      };
    },
  },

  {
    id: 'D04',
    points: 3,
    severity: 'minor',
    title: 'Bullets are too long or too short',
    run(ctx) {
      if (ctx.bullets.length < MIN_BULLETS) return null;
      const bad = ctx.bullets
        .map((text, index) => ({ text, index, count: wordCount(text) }))
        .filter((bullet) => bullet.count < 8 || bullet.count > 30);
      if (!bad.length) return null;
      const long = bad.filter((bullet) => bullet.count > 30);
      return {
        message: long.length
          ? `${long.length} of your bullets run past 30 words. One idea per bullet, 8 to 30 words — anything longer is read as a paragraph and skimmed.`
          : `${bad.length} of your bullets are shorter than 8 words. A bullet that short cannot carry an action and a result.`,
        evidence: bad.slice(0, 3).map((bullet) =>
          bulletEvidence(ctx, bullet.text, `${bullet.count} words: `)),
      };
    },
  },

  {
    id: 'D05',
    points: 2,
    severity: 'minor',
    title: 'First-person pronouns',
    run(ctx) {
      const inBullets = ctx.bullets.filter((bullet) => firstPersonPronouns(bullet).length);
      if (!inBullets.length) return null;
      return {
        message: 'Drop "I" and "my" — CV bullets are written without pronouns, and removing them buys you room for a number.',
        evidence: inBullets.slice(0, 3).map((text) => bulletEvidence(ctx, text)),
      };
    },
  },

  {
    id: 'D06',
    points: 2,
    severity: 'major',
    title: 'Filler phrases',
    run(ctx) {
      const found = findCliches(ctx.experienceText || ctx.bodyText);
      if (!found.length) return null;
      return {
        message: `Replace "${found[0]}" with what you actually did and what changed as a result. Filler phrases take the space a fact would have used.`,
        evidence: found.slice(0, 4).map((phrase) => phraseEvidence(ctx, phrase)),
      };
    },
  },

  {
    id: 'D07',
    points: 1,
    severity: 'minor',
    title: 'The same verb over and over',
    run(ctx) {
      const counts = new Map();
      for (const bullet of ctx.bullets) {
        const lemma = verbLemma(firstWord(bullet));
        if (lemma) counts.set(lemma, (counts.get(lemma) || 0) + 1);
      }
      const overused = [...counts.entries()].filter(([, count]) => count > 3)
        .sort((a, b) => b[1] - a[1]);
      if (!overused.length) return null;
      const [verb, count] = overused[0];
      return {
        message: `"${verb}" opens ${count} of your bullets. Vary the verb so each one lands differently — a reader skimming sees the repetition before they see the content.`,
        evidence: [{ page: 1, text: `${overused.map(([word, n]) => `${word} ×${n}`).join(', ')}` }],
      };
    },
  },

  {
    id: 'D08',
    points: 1,
    severity: 'minor',
    title: 'Mixed tenses',
    run(ctx) {
      if (ctx.bullets.length < MIN_BULLETS) return null;
      const tenses = ctx.bullets
        .map((bullet) => ({ bullet, tense: verbTense(firstWord(bullet)) }))
        .filter((entry) => entry.tense);
      if (tenses.length < MIN_BULLETS) return null;
      const past = tenses.filter((entry) => entry.tense === 'past');
      const present = tenses.filter((entry) => entry.tense === 'present');
      // Mixing is legitimate when the current role is present tense, so this
      // only fires when BOTH are common enough to read as inconsistency.
      if (!past.length || !present.length) return null;
      const minority = Math.min(past.length, present.length) / tenses.length;
      if (minority < 0.25) return null;
      return {
        message: 'Your bullets mix past and present tense. Past roles in past tense, the current role in present tense — and never both inside one role.',
        evidence: [past[0], present[0]].map((entry) => bulletEvidence(ctx, entry.bullet)),
      };
    },
  },

  {
    id: 'D09',
    points: 2,
    severity: 'major',
    title: 'Spelling and casing',
    run(ctx) {
      const body = ctx.bodyText;
      const lower = body.toLowerCase();
      const problems = [];

      const bag = new Set(words(body));
      for (const word of bag) {
        const correction = TYPOS.get(word);
        if (correction) problems.push(`${word} → ${correction}`);
      }

      for (const [uk, us] of SPELLING_VARIANTS) {
        if (bag.has(uk) && bag.has(us)) problems.push(`${uk} and ${us} both appear`);
      }

      // Inside a URL or an email address lowercase is correct and expected —
      // linkedin.com is not a misspelling of LinkedIn — so those are removed
      // before the casing pass rather than reported as mistakes.
      const prose = body
        .replace(/\bhttps?:\/\/\S+/gi, ' ')
        .replace(/\b[\w.+-]+@[\w.-]+\.\w+\b/g, ' ')
        .replace(/\b[\w-]+\.(com|net|org|io|co|dev|me|app|ai)(\.[a-z]{2})?(\/\S*)?/gi, ' ');
      for (const [wrong, right] of BRAND_CASING) {
        const pattern = new RegExp(`\\b${wrong.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
        const matches = prose.match(pattern) || [];
        const miscased = matches.find((match) => match !== right);
        if (miscased) problems.push(`${miscased} → ${right}`);
      }

      if (!problems.length) return null;
      return {
        message: `Fix the spelling: ${problems.slice(0, 3).join('; ')}. A typo is the one defect every reader notices and none forgive.`,
        evidence: problems.slice(0, 5).map((text) => ({ page: 1, text })),
      };
    },
  },

  {
    id: 'D10',
    points: 1,
    severity: 'minor',
    title: 'Bullets punctuated inconsistently',
    run(ctx) {
      if (ctx.bullets.length < MIN_BULLETS) return null;
      const stopped = ctx.bullets.filter((bullet) => /[.!?]$/.test(bullet.trim()));
      if (!stopped.length || stopped.length === ctx.bullets.length) return null;
      return {
        message: `${stopped.length} of your ${ctx.bullets.length} bullets end with a full stop and the rest do not. Punctuate them all the same way.`,
        evidence: [
          bulletEvidence(ctx, stopped[0]),
          bulletEvidence(ctx, ctx.bullets.find((bullet) => !/[.!?]$/.test(bullet.trim())) || ''),
        ],
      };
    },
  },

  {
    id: 'D11',
    points: 1,
    severity: 'minor',
    title: 'Unexplained acronyms',
    run(ctx) {
      const unknown = unexpandedAcronyms(ctx.experienceText || ctx.bodyText, KNOWN_ACRONYMS);
      if (!unknown.length) return null;
      return {
        message: `Expand ${unknown.slice(0, 3).map((a) => `"${a}"`).join(', ')} once on first use — an acronym that is standard inside your last company means nothing to the recruiter reading this.`,
        evidence: unknown.slice(0, 5).map((text) => ({ page: 1, text })),
      };
    },
  },
];

// Sentence splitting is part of this pillar's contract with its tests.
export { sentences };
