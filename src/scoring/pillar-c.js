// Pillar C — Experience & dates (20 points).
//
// "Is the work history machine-readable and coherent?" Every ATS builds a
// timeline from these three fields — title, employer, dates — and a role
// missing any one of them is a role the machine cannot place.

import { weakTitleIn } from '../lexicons/weak-titles.js';
import { findDateRanges } from '../extract/entities.js';

const monthIndex = (date) => date.year * 12 + (date.month || 1);

export const PILLAR_C = [
  {
    id: 'C01',
    points: 5,
    severity: 'critical',
    title: 'A role is missing title, employer or dates',
    run(ctx) {
      const complete = ctx.entities.roles.filter((role) =>
        role.title && role.employer && role.range && role.range.from);
      if (complete.length >= 1) return null;
      const partial = ctx.entities.roles[0];
      return {
        message: 'Each role needs three things a machine can find: the job title, the employer, and the dates. At least one of yours is missing, so the role does not enter the timeline at all.',
        evidence: [{
          page: 1,
          text: partial
            ? `closest match: ${partial.heading || partial.evidence}`
            : 'no complete role found in the experience section',
        }],
      };
    },
  },

  {
    id: 'C02',
    points: 4,
    severity: 'critical',
    title: 'Inconsistent date formats',
    run(ctx) {
      if (!ctx.entities.mixedDateFormats) return null;
      const examples = ctx.entities.roles
        .filter((role) => role.range && role.range.family)
        .slice(0, 3)
        .map((role) => role.evidence);
      return {
        message: 'Use one date format throughout: Mar 2023 – Present, or 03/2023 – Present. Two formats in one document make a parser guess, and it guesses wrong on the one it saw least.',
        evidence: examples.length
          ? examples.map((text) => ({ page: 1, text }))
          : [{ page: 1, text: `formats used: ${ctx.entities.dateFamilies.join(', ')}` }],
      };
    },
  },

  {
    id: 'C03',
    points: 3,
    severity: 'major',
    title: 'Roles are not newest first',
    run(ctx) {
      if (ctx.entities.roles.length < 2) return null;
      if (ctx.entities.reverseChronological) return null;
      return {
        message: 'List your most recent role first. Every screen a recruiter runs assumes reverse-chronological order, and a CV that reads oldest-first looks like a career going backwards.',
        evidence: ctx.entities.roles.slice(0, 2).map((role) => ({
          page: 1,
          text: role.evidence,
        })),
      };
    },
  },

  {
    id: 'C04',
    points: 2,
    severity: 'major',
    title: 'An unexplained gap',
    run(ctx) {
      const gaps = ctx.entities.gaps.filter((gap) => gap.months > 6);
      if (!gaps.length) return null;
      const worst = gaps.reduce((big, gap) => (gap.months > big.months ? gap : big), gaps[0]);
      return {
        message: `There is a ${worst.months}-month gap in your history. Add a one-line entry for it — study, caring, travel, contracting, a break — so it is not read as something you are hiding.`,
        evidence: [{ page: 1, text: `between ${worst.after} and ${worst.before}` }],
      };
    },
  },

  {
    id: 'C05',
    points: 1,
    severity: 'minor',
    title: 'The current role has no end marker',
    run(ctx) {
      if (!ctx.entities.roles.length) return null;
      if (ctx.entities.hasOpenEndedCurrentRole) return null;
      const newest = ctx.entities.roles[0];
      return {
        message: 'Mark your current role\'s end date as Present. Without it, a parser reads your newest role as finished and files you as unemployed.',
        evidence: [{ page: 1, text: newest.evidence }],
      };
    },
  },

  {
    id: 'C06',
    points: 1,
    severity: 'major',
    title: 'Dates that cannot be right',
    run(ctx) {
      const problems = [];
      for (const role of ctx.entities.roles) {
        const { range } = role;
        if (!range || !range.from) continue;
        if (range.to && monthIndex(range.to) < monthIndex(range.from)) {
          problems.push({ text: role.evidence, why: 'the end date is before the start date' });
        }
        // A start date in the future is a typo, every time.
        if (range.from.year > new Date().getUTCFullYear() + 1) {
          problems.push({ text: role.evidence, why: 'the start date is in the future' });
        }
      }
      if (!problems.length) return null;
      return {
        message: `Check these dates — ${problems[0].why}.`,
        evidence: problems.slice(0, 3).map((problem) => ({ page: 1, text: problem.text })),
      };
    },
  },

  {
    id: 'C07',
    points: 2,
    severity: 'minor',
    title: 'A job title nobody searches for',
    run(ctx) {
      const hits = ctx.entities.roles
        .map((role) => ({ role, weak: weakTitleIn(role.title || role.heading || '') }))
        .filter((hit) => hit.weak);
      if (!hits.length) return null;
      return {
        message: `"${hits[0].weak}" is not a title any recruiter searches for. Use the standard title alongside it — Code Ninja (Software Engineer) — so the search that is looking for you can find you.`,
        evidence: hits.slice(0, 3).map((hit) => ({
          page: 1,
          text: hit.role.heading || hit.role.title,
        })),
      };
    },
  },

  {
    id: 'C08',
    points: 2,
    severity: 'major',
    title: 'Education is missing or incomplete',
    run(ctx) {
      if (!ctx.sections.found.includes('education')) {
        return {
          message: 'Add an education section with the qualification, the institution and the year. Many application forms populate their own fields from it, and an empty field reads as no qualification.',
          evidence: [{ page: 1, text: 'no education section found' }],
        };
      }
      const lines = ctx.educationLines.filter((line) => line.text.trim());
      // A usable entry names an institution-ish word and carries a year.
      const complete = lines.some((line) =>
        /\b(19|20)\d{2}\b/.test(line.text)
        && /\b(university|college|institute|school|academy|polytechnic|tafe)\b/i.test(line.text));
      if (complete) return null;
      return {
        message: 'Your education entry is missing the qualification, the institution or the year. Give all three on one line: BCom, University of Auckland, 2014.',
        evidence: lines.slice(0, 2).map((line) => ({ page: line.page, text: line.text })),
      };
    },
  },
];

// Re-exported so the tests can build role fixtures without importing the
// extractor directly.
export { findDateRanges };
