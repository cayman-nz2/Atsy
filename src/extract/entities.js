// Entity extraction: the facts a parser tries to pull out of a CV, and the
// ones Atsy needs in order to say anything useful about the content.
//
// Deterministic: regular expressions and small lexicons, never a model.
// Everything returns evidence (the line it came from) so a finding can always
// show its working, and where the evidence has a place on the page it returns
// that too.

import { boxOf } from './geometry.js';

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
// Deliberately permissive on punctuation, then checked by digit count: real
// CVs write numbers every way imaginable.
const PHONE = /(\+?\d[\d\s().-]{6,}\d)/;
const URL = /((?:https?:\/\/|www\.)[^\s,;]+|(?:linkedin\.com|github\.com|gitlab\.com)\/[^\s,;]+)/i;

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH_NAMES = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august',
  'september', 'october', 'november', 'december'];
const OPEN_ENDED = /\b(present|current|now|to date|ongoing)\b/i;

// The four families a date can belong to. Mixing them in one document is what
// breaks tenure calculations.
const DATE_FAMILIES = {
  numeric: /\b(0?[1-9]|1[0-2])[/.](19|20)\d{2}\b/,                    // 03/2023
  monthAbbrev: new RegExp(`\\b(${MONTHS.join('|')})\\.?\\s+(19|20)\\d{2}\\b`, 'i'),
  monthFull: new RegExp(`\\b(${MONTH_NAMES.join('|')})\\s+(19|20)\\d{2}\\b`, 'i'),
  yearOnly: /\b(19|20)\d{2}\b/,
};

const RANGE_SEPARATOR = /\s*(?:–|—|-|to|until)\s*/i;

/** Which family a date string belongs to, most specific first. */
export function dateFamily(text) {
  if (DATE_FAMILIES.numeric.test(text)) return 'numeric';
  if (DATE_FAMILIES.monthFull.test(text)) return 'monthFull';
  if (DATE_FAMILIES.monthAbbrev.test(text)) return 'monthAbbrev';
  if (DATE_FAMILIES.yearOnly.test(text)) return 'yearOnly';
  return null;
}

/** Parse one date to { year, month } — month is null when only a year is given. */
export function parseDate(text) {
  const value = text.trim().toLowerCase();
  if (OPEN_ENDED.test(value)) return { open: true };

  const numeric = value.match(/\b(0?[1-9]|1[0-2])[/.]((?:19|20)\d{2})\b/);
  if (numeric) return { year: Number(numeric[2]), month: Number(numeric[1]) };

  const named = value.match(new RegExp(`\\b(${[...MONTH_NAMES, ...MONTHS].join('|')})\\.?\\s+((?:19|20)\\d{2})\\b`));
  if (named) {
    const name = named[1].slice(0, 3);
    return { year: Number(named[2]), month: MONTHS.indexOf(name) + 1 };
  }

  const year = value.match(/\b((?:19|20)\d{2})\b/);
  if (year) return { year: Number(year[1]), month: null };
  return null;
}

/** Every date range found in a line, with the family it is written in. */
export function findDateRanges(text) {
  const ranges = [];
  // Split on the separator, then check both halves look like dates. Doing it
  // this way rather than with one big pattern keeps "Mar 2023 - Present" and
  // "03/2023 – 02/2025" on the same code path.
  const separator = text.match(RANGE_SEPARATOR);
  if (!separator) return ranges;
  const [left, ...rest] = text.split(RANGE_SEPARATOR);
  const right = rest.join(' ');
  const from = parseDate(left);
  const to = parseDate(right);
  if (from && !from.open && (to || OPEN_ENDED.test(right))) {
    ranges.push({
      from,
      to: to && !to.open ? to : null,
      open: !to || !!to.open,
      family: dateFamily(left),
      text: text.trim(),
    });
  }
  return ranges;
}

const monthsBetween = (from, to) =>
  ((to.year - from.year) * 12) + ((to.month || 1) - (from.month || 1));

/** The contact block: what a recruiter needs in order to reach the person. */
export function findContact(document, sections) {
  const allLines = sections.preamble.length
    ? sections.preamble
    : (document.pages[0] ? [{ text: document.pages[0].items.map((item) => item.text).join(' ') }] : []);
  const wholeText = document.pages.flatMap((page) => page.items.map((item) => item.text)).join('\n');

  const emailMatch = wholeText.match(EMAIL);
  const urlMatch = wholeText.match(URL);

  let phone = null;
  for (const candidate of wholeText.match(new RegExp(PHONE, 'g')) || []) {
    const digits = candidate.replace(/\D/g, '');
    // Seven digits is the shortest real number; more than 15 is not a number.
    if (digits.length >= 7 && digits.length <= 15) {
      phone = { text: candidate.trim(), digits: digits.length, international: candidate.trim().startsWith('+') };
      break;
    }
  }

  // The name: the first line of the identity block that reads like one.
  let name = null;
  for (const line of allLines.slice(0, 4)) {
    const text = (line.text || '').trim();
    if (!text || EMAIL.test(text) || /\d/.test(text)) continue;
    const words = text.split(/\s+/);
    if (words.length < 2 || words.length > 4) continue;
    if (!words.every((word) => /^[A-Z][a-zA-Z'’-]*$/.test(word) || word === word.toUpperCase())) continue;
    name = text;
    break;
  }

  return {
    name,
    email: emailMatch ? emailMatch[0] : null,
    phone,
    link: urlMatch ? urlMatch[0] : null,
  };
}

/**
 * Roles, built from the date ranges inside the experience section: a line with
 * a range is the spine of an entry, and the nearest line above it that is not
 * itself a date is the title and employer.
 */
export function findRoles(sections) {
  const experience = sections.sections
    .filter((section) => section.canonical === 'experience')
    .flatMap((section) => section.lines);

  const roles = [];
  experience.forEach((line, index) => {
    const [range] = findDateRanges(line.text);
    if (!range) return;
    let heading = null;
    for (let back = index - 1; back >= 0 && back >= index - 3; back -= 1) {
      const candidate = experience[back].text.trim();
      if (!candidate || findDateRanges(candidate).length) continue;
      heading = candidate;
      break;
    }
    const [title, employer] = heading
      ? heading.split(/\s*[,|·—–]\s*| at /i).map((part) => part.trim())
      : [null, null];
    roles.push({
      heading,
      title: title || null,
      employer: employer || null,
      range,
      evidence: line.text.trim(),
      months: range.open || !range.to ? null : monthsBetween(range.from, range.to),
    });
  });
  return roles;
}

// A line that continues the bullet above it rather than starting a new one.
//
// This matters more than it looks. A real CV bullet wraps across two or three
// visual lines, and treating each line as its own bullet corrupts every
// percentage in Pillar D at once: a wrapped bullet whose number happens to sit
// on the second line reads as one bullet with a number and one without, and a
// long bullet can never exceed the word limit because it was never whole.
function continuesPrevious(line, previous) {
  if (!previous) return false;
  const text = line.text.trim();
  if (!text) return false;
  // An explicit bullet glyph always starts something new.
  if (/^[•·▪◦‣∙*+\u2013\u2014>»]/.test(text)) return false;
  // So does a capital letter or a digit, which is how a new claim opens.
  if (!/^[a-z(]/.test(text)) return false;
  // A continuation sits at the same indent as the text it continues, or
  // slightly inside it. A big outdent is a new block.
  if (Math.abs(line.left - previous.left) > 24) return false;
  // Consecutive on the page, not across a section or a page break.
  if (line.page !== previous.page) return false;
  return true;
}

/**
 * Bullet-like lines inside the experience section: what the person says they
 * did. Role headings and date lines are structure, not claims, and scoring
 * them as bullets would punish a CV for having a job title.
 *
 * Wrapped lines are rejoined first, so a "bullet" here is one claim rather
 * than one row of glyphs.
 */
/**
 * The experience section's lines, with wrapped continuations folded into the
 * bullet they belong to.
 *
 * Each entry keeps the lines it was built from, so a caller that wants the
 * region of the page a bullet occupies can have it without re-deriving the
 * merge — and without the two derivations being able to drift apart.
 */
function mergeBulletLines(sections, roles = []) {
  const headings = new Set(roles.map((role) => role.heading).filter(Boolean));
  const lines = sections.sections
    .filter((section) => section.canonical === 'experience')
    .flatMap((section) => section.lines)
    .filter((line) => line.text.trim());

  const merged = [];
  let previous = null;
  for (const line of lines) {
    const isStructure = !!findDateRanges(line.text).length || headings.has(line.text.trim());
    if (isStructure) {
      merged.push({ ...line, text: line.text.trim(), structure: true, lines: [line] });
      previous = null;
      continue;
    }
    if (previous && continuesPrevious(line, previous)) {
      previous.text = `${previous.text} ${line.text.trim()}`.replace(/\s+/g, ' ');
      previous.lines.push(line);
      continue;
    }
    const entry = { ...line, text: line.text.trim(), structure: false, lines: [line] };
    merged.push(entry);
    previous = entry;
  }
  return merged;
}

// What counts as a bullet once the lines are merged. Written once so
// findBullets and bulletRegions cannot disagree about which entries survive.
const isBullet = (entry) => !entry.structure
  && entry.text.length >= 20
  && entry.text.split(/\s+/).length >= 4;

export function findBullets(sections, roles = []) {
  return mergeBulletLines(sections, roles).filter(isBullet).map((entry) => entry.text);
}

/**
 * The same bullets, each with the region of the page it came from.
 *
 * Kept as a parallel list rather than folded into `findBullets`, because every
 * content check reads a bullet as a string and a shape change there would
 * touch a dozen checks to add something only the X-ray uses. Index i here is
 * the box for bullet i there — `bulletRegions` and `findBullets` walk the same
 * entries in the same order, and a test holds them to it.
 */
export function bulletRegions(sections, roles = []) {
  return mergeBulletLines(sections, roles)
    .filter(isBullet)
    .map((entry) => {
      const box = boxOf(entry.lines);
      return box ? { page: entry.lines[0].page || 1, ...box } : null;
    });
}

/** Everything the content checks need, in one pass. */
export function extractEntities(document, sections) {
  const contact = findContact(document, sections);
  const roles = findRoles(sections);
  const bullets = findBullets(sections, roles);
  const bulletBoxes = bulletRegions(sections, roles);

  const families = [...new Set(roles.map((role) => role.range.family).filter(Boolean))];
  const ordered = roles.every((role, index) => {
    if (index === 0) return true;
    const previous = roles[index - 1].range.from;
    const current = role.range.from;
    return (previous.year * 12 + (previous.month || 1)) >= (current.year * 12 + (current.month || 1));
  });

  // Gaps between consecutive roles, measured from the older role's end to the
  // newer one's start. Only the older role's end date and the newer role's
  // start date are needed.
  //
  // This used to skip the pair whenever the newer role was open-ended, which
  // silently disabled the check on almost every real CV: the most recent role
  // is normally "Present", and the gap just before the current job is exactly
  // the one a recruiter asks about. Whether the newer role has ended has no
  // bearing on when it started.
  const gaps = [];
  for (let index = 1; index < roles.length; index += 1) {
    const newer = roles[index - 1];
    const older = roles[index];
    if (!older.range.to || !newer.range.from) continue;
    const months = monthsBetween(older.range.to, newer.range.from);
    if (months >= 6) gaps.push({ months, after: older.evidence, before: newer.evidence });
  }

  return {
    contact,
    roles,
    bullets,
    // Index-aligned with `bullets`; an entry is null when the bullet's lines
    // carried no usable coordinates.
    bulletBoxes,
    dateFamilies: families,
    mixedDateFormats: families.length > 1,
    reverseChronological: ordered,
    gaps,
    hasOpenEndedCurrentRole: roles.some((role) => role.range.open),
  };
}
