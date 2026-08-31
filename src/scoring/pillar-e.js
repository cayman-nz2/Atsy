// Pillar E — Skills presentation (10 points).
//
// "Are skills present, findable and honestly stated?" This is the pillar a
// keyword search reads, and the one people most often render as a picture.
//
// Every check here degrades safely when the taxonomy is unavailable: a skills
// section that cannot be matched against a lookup table is not a skills
// section that is missing, and reporting it as missing would be a lie caused
// by an outage.

import { ratingGlyphRuns, words } from './text.js';

const SOFT_ONLY = /^(communication|teamwork|team work|leadership|problem solving|time management|adaptability|creativity|attention to detail|organisation|organization|interpersonal|collaboration|flexibility|motivation|reliability|work ethic|multitasking|patience|empathy|critical thinking|decision making)$/i;

export const PILLAR_E = [
  {
    id: 'E01',
    points: 4,
    severity: 'critical',
    title: 'No skills section',
    run(ctx) {
      if (ctx.sections.found.includes('skills')) return null;
      return {
        message: 'Add a Skills section listing your tools and hard skills as plain comma-separated text. It is the section keyword searches read first, and the cheapest one to get right.',
        evidence: [{ page: 1, text: 'no skills section found' }],
      };
    },
  },

  {
    id: 'E02',
    points: 2,
    severity: 'major',
    title: 'Skills trapped in a layout',
    run(ctx) {
      if (!ctx.sections.found.includes('skills')) return null;
      const tops = ctx.skillLines.map((line) => line.top);
      if (!tops.length) return null;

      // The skills section sits inside a table, a column, or a set of drawn
      // bars — all three are the same problem: the text is not a list.
      const inTable = ctx.layout.pages.some((page) => page.table
        && ctx.skillLines.some((line) => line.page === page.number));
      const inColumns = ctx.layout.pages.some((page) => page.columns.columns > 1
        && ctx.skillLines.some((line) => line.page === page.number));
      const nearShapes = ctx.document.pages.some((page) =>
        page.shapes.filter((shape) => tops.some((top) => Math.abs(shape.top - top) < 60)).length >= 3);

      const why = [];
      if (inTable) why.push('a table');
      if (inColumns) why.push('a column layout');
      if (nearShapes) why.push('drawn bars');
      if (!why.length) return null;
      return {
        message: 'Write your skills as a plain comma-separated list, not a grid or a chart. A parser reads the list; it records nothing from the picture.',
        evidence: [{ page: ctx.skillLines[0].page, text: `skills sit inside ${why.join(' and ')}` }],
      };
    },
  },

  {
    id: 'E03',
    points: 2,
    severity: 'major',
    title: 'Too few concrete skills',
    run(ctx) {
      if (!ctx.sections.found.includes('skills')) return null;
      // A heading with nothing under it needs no lookup table to recognise,
      // and it is the most damaging version of this problem.
      if (ctx.skillsEmpty) {
        return {
          message: 'Your Skills heading has no text under it. Whatever is there is a picture as far as a parser is concerned — list the tools and methods as plain words.',
          evidence: [{ page: ctx.skillsAnchor ? ctx.skillsAnchor.page : 1, text: 'the skills section contains no extractable text' }],
        };
      }
      // Beyond that, telling hard from soft needs the taxonomy, so the check
      // stands down rather than guessing.
      if (!ctx.taxonomy) return null;
      if (ctx.hardSkills.length >= 6) return null;
      const allSoft = ctx.listedSkills.length > 0
        && ctx.listedSkills.every((skill) => SOFT_ONLY.test(skill.trim()));
      return {
        message: allSoft
          ? 'Your skills are all soft skills. Those give a parser nothing to match and a reader nothing to check. List the concrete tools, systems and methods you use.'
          : `Only ${ctx.hardSkills.length} concrete skill${ctx.hardSkills.length === 1 ? '' : 's'} recognised. List the specific tools, systems and methods you work with — named products, not categories.`,
        evidence: [{ page: ctx.skillLines[0] ? ctx.skillLines[0].page : 1, text: ctx.listedSkills.slice(0, 8).join(', ') || 'the skills section is empty' }],
      };
    },
  },

  {
    id: 'E04',
    points: 1,
    severity: 'minor',
    title: 'The skills list is padded',
    run(ctx) {
      if (!ctx.sections.found.includes('skills')) return null;
      if (ctx.listedSkills.length > 40) {
        return {
          message: `You list ${ctx.listedSkills.length} skills. Trim it — past about twenty, the list reads as padding and the important ones get lost among the rest.`,
          evidence: [{ page: ctx.skillLines[0].page, text: `${ctx.listedSkills.length} entries` }],
        };
      }
      if (ctx.listedSkills.length < 4 || !ctx.experienceWords.size) return null;
      // A skill nobody can see you using is a claim with no evidence.
      const unseen = ctx.listedSkills.filter((skill) => {
        const parts = words(skill).filter((word) => word.length > 2);
        if (!parts.length) return false;
        return !parts.some((word) => ctx.experienceWords.has(word));
      });
      if (unseen.length / ctx.listedSkills.length <= 0.25) return null;
      return {
        message: `${unseen.length} of your skills never appear in your experience. A skill nobody can see you using reads as padding — either show it in a bullet or drop it.`,
        evidence: [{ page: ctx.skillLines[0].page, text: unseen.slice(0, 6).join(', ') }],
      };
    },
  },

  {
    id: 'E05',
    points: 1,
    severity: 'minor',
    title: 'Self-rated proficiency',
    run(ctx) {
      if (!ctx.skillLines.length) return null;
      const text = ctx.skillLines.map((line) => line.text).join(' ');
      const reasons = [];
      if (/\b(expert|advanced|intermediate|beginner|proficient|native|fluent)\b\s*[:\-–]|[:\-–]\s*\b(expert|advanced|intermediate|beginner|proficient)\b/i.test(text)) {
        reasons.push('proficiency labels');
      }
      if (/\b\d{1,2}\s*\/\s*10\b|\b\d{1,2}\s*\/\s*5\b|\b\d{1,3}\s?%/.test(text)) reasons.push('numeric ratings');
      if (ratingGlyphRuns(text).length) reasons.push('star or dot ratings');
      if (!reasons.length) return null;
      return {
        message: 'Drop the self-rated levels. Nobody can verify them and reviewers discount them — show the skill in a bullet with a result instead.',
        evidence: [{ page: ctx.skillLines[0].page, text: `${reasons.join(', ')} in the skills section` }],
      };
    },
  },
];
