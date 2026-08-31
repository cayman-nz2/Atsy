// Section detection: which headings a CV uses, and what sits under each one.
//
// This is the stage that decides whether a parser attributes your work history
// at all. A heading it cannot match leaves everything beneath it unassigned.

import { canonicalSection, REQUIRED_SECTIONS } from '../lexicons/sections.js';

const MAX_HEADING_CHARS = 45;
// The top of page one holds the name and the job title, set large. They are
// not headings, and reporting them as unrecognised ones would send people to
// "fix" the one part of the CV that is conventional.
const IDENTITY_BAND = 0.12;

/** The most common text size in the document — the body size. */
export function bodySize(document) {
  const counts = new Map();
  for (const page of document.pages) {
    for (const item of page.items) {
      const size = Math.round(item.size * 2) / 2;
      counts.set(size, (counts.get(size) || 0) + item.text.length);
    }
  }
  let best = 11;
  let bestCount = 0;
  for (const [size, count] of counts) {
    if (count > bestCount) { best = size; bestCount = count; }
  }
  return best;
}

const looksLikeHeading = (line, body) => {
  const text = line.text.trim();
  if (!text || text.length > MAX_HEADING_CHARS) return false;
  if (/[.!?,;]$/.test(text)) return false;          // headings do not end a sentence
  if (/^[-•*]/.test(text)) return false;            // that is a bullet
  const isCaps = text === text.toUpperCase() && /[A-Z]{3}/.test(text);
  const isLarger = line.size >= body * 1.15;
  const isShort = text.split(/\s+/).length <= 5;
  return (isCaps || isLarger) && isShort;
};

/**
 * Find headings and slice the document into sections.
 * Returns canonical sections, the headings that could not be matched, and the
 * lines belonging to each section in reading order.
 */
export function detectSections(document, layout) {
  const body = bodySize(document);
  const lines = layout.pages.flatMap((page) =>
    page.lines.map((line) => ({ ...line, page: page.number })));

  const identityLimit = (document.pages[0] ? document.pages[0].height : 842) * IDENTITY_BAND;
  const headings = [];
  lines.forEach((line, index) => {
    if (!looksLikeHeading(line, body)) return;
    if (line.page === 1 && line.top < identityLimit && !canonicalSection(line.text)) return;
    const canonical = canonicalSection(line.text);
    // A styled line that matches nothing is only a heading if it is styled
    // clearly enough to be one: otherwise a bold job title would split the CV.
    const isCaps = line.text === line.text.toUpperCase();
    if (!canonical && !(isCaps || line.size >= body * 1.3)) return;
    headings.push({ index, page: line.page, text: line.text.trim(), canonical, top: line.top });
  });

  const sections = headings.map((heading, position) => {
    const from = heading.index + 1;
    const to = position + 1 < headings.length ? headings[position + 1].index : lines.length;
    return {
      canonical: heading.canonical,
      heading: heading.text,
      page: heading.page,
      lines: lines.slice(from, to),
    };
  });

  const found = new Set(sections.map((section) => section.canonical).filter(Boolean));
  return {
    bodySize: body,
    headings,
    sections,
    found: [...found],
    unknownHeadings: headings.filter((heading) => !heading.canonical).map((h) => h.text),
    missingRequired: REQUIRED_SECTIONS.filter((name) => !found.has(name)),
    // Lines above the first heading: the contact block, in a conventional CV.
    preamble: lines.slice(0, headings.length ? headings[0].index : Math.min(lines.length, 6)),
  };
}

/** All lines belonging to one canonical section, across the document. */
export function sectionLines(sections, canonical) {
  return sections.sections
    .filter((section) => section.canonical === canonical)
    .flatMap((section) => section.lines);
}
