// The scoring context: everything the 49 checks read, computed once.
//
// Checks are pure functions of this object. Building it in one place means a
// check cannot quietly disagree with another about what "the bullets" or "the
// body text" is, and it keeps each check short enough to read against the
// published rubric.

import { sectionLines } from '../extract/sections.js';
import { words } from './text.js';

/** Header/footer band items, as text, per page. */
function bandText(layout) {
  return layout.pages.flatMap((page) =>
    [...page.header, ...page.footer].map((item) => item.text)).join(' ');
}

/**
 * Build the context.
 *
 * `skills` comes from the taxonomy, which lives in D1 rather than the bundle,
 * so it is passed in. When it is absent (a unit test, or a database that has
 * not been seeded) the skill checks that need the taxonomy stand down rather
 * than reporting a CV as skill-less — a check that fires because a lookup
 * table is missing is worse than a check that does not fire.
 */
export function buildContext(model, options = {}) {
  const { document, layout, sections, entities } = model;
  const filename = options.filename || 'cv.pdf';
  const fileBytes = options.fileBytes || document.byteLength || 0;
  const taxonomy = options.taxonomy || null;

  const allLines = layout.pages.flatMap((page) =>
    page.lines.map((line) => ({ ...line, page: page.number })));
  const allText = allLines.map((line) => line.text).join('\n');

  const bandOnly = bandText(layout);
  const bodyLines = allLines.filter((line) => {
    const page = layout.pages[line.page - 1];
    if (!page) return true;
    const inBand = [...page.header, ...page.footer]
      .some((item) => Math.abs(item.top - line.top) < 1);
    return !inBand;
  });
  const bodyText = bodyLines.map((line) => line.text).join('\n');

  const summaryLines = sectionLines(sections, 'summary');
  const skillLines = sectionLines(sections, 'skills');
  const educationLines = sectionLines(sections, 'education');
  const experienceLines = sectionLines(sections, 'experience');

  // The skills a reader listed, split on the separators a skills line uses.
  const listedSkills = skillLines
    .flatMap((line) => line.text.split(/[,;|•·]|\s{3,}/))
    .map((part) => part.trim())
    .filter((part) => part.length > 1 && part.length < 40);

  // Where the skills section IS, even when it holds no text. A heading with
  // nothing under it is the exact shape of a skills section rendered as
  // pictures, so the checks that look for bars beside it need an anchor that
  // does not depend on there being words there.
  const skillsHeading = sections.headings.find((heading) => heading.canonical === 'skills') || null;
  const skillsAnchor = skillLines.length
    ? { top: skillLines[0].top, page: skillLines[0].page }
    : (skillsHeading ? { top: skillsHeading.top, page: skillsHeading.page } : null);

  const recognisedSkills = taxonomy
    ? listedSkills
      .map((term) => taxonomy.match(term))
      .filter(Boolean)
    : [];

  return {
    document,
    layout,
    sections,
    entities,
    filename,
    fileBytes,
    taxonomy,

    allLines,
    allText,
    bodyLines,
    bodyText,
    bandText: bandOnly,

    summaryLines,
    summaryText: summaryLines.map((line) => line.text).join(' '),
    skillLines,
    skillsAnchor,
    skillsEmpty: !!skillsHeading && skillLines.filter((line) => line.text.trim()).length === 0,
    educationLines,
    experienceLines,
    experienceText: experienceLines.map((line) => line.text).join('\n'),

    bullets: entities.bullets,
    listedSkills,
    recognisedSkills,
    // Deduplicated canonical names, which is what E03 counts.
    hardSkills: [...new Set(recognisedSkills.filter((s) => s.kind === 'hard').map((s) => s.canonical))],
    softSkills: [...new Set(recognisedSkills.filter((s) => s.kind === 'soft').map((s) => s.canonical))],

    // Word bag of the experience section, for E04 (a skill nobody can see you
    // using) and Role Fit's keyword-placement component.
    experienceWords: new Set(words(experienceLines.map((line) => line.text).join(' '))),
  };
}
