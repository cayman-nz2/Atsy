// Entity extraction: the facts a parser tries to pull out of a CV, and the
// ones Atsy needs in order to say anything useful about the content.
//
// Deterministic and dependency-free: regular expressions and small lexicons,
// never a model. Everything returns evidence (the line it came from) so a
// finding can always show its working.

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

/**
 * Bullet-like lines inside the experience section: what the person says they
 * did. Role headings and date lines are structure, not claims, and scoring
 * them as bullets would punish a CV for having a job title.
 */
export function findBullets(sections, roles = []) {
  const headings = new Set(roles.map((role) => role.heading).filter(Boolean));
  return sections.sections
    .filter((section) => section.canonical === 'experience')
    .flatMap((section) => section.lines)
    .map((line) => line.text.trim())
    .filter((text) => text.length >= 20 && !findDateRanges(text).length)
    .filter((text) => !headings.has(text))
    .filter((text) => text.split(/\s+/).length >= 4);
}

/** Everything the content checks need, in one pass. */
export function extractEntities(document, sections) {
  const contact = findContact(document, sections);
  const roles = findRoles(sections);
  const bullets = findBullets(sections, roles);

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
    dateFamilies: families,
    mixedDateFormats: families.length > 1,
    reverseChronological: ordered,
    gaps,
    hasOpenEndedCurrentRole: roles.some((role) => role.range.open),
  };
}
