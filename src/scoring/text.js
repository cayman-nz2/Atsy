// Text measurements the content checks share.
//
// Everything here is a pure function over strings, so a check can be read
// without knowing how a PDF works, and a disagreement about "what counts as a
// quantified bullet" has exactly one place to be settled.

// Emoji and pictographs. Deliberately explicit ranges rather than a `\p{Emoji}`
// class: that class matches plain digits and `#`, which would report every CV
// with a phone number as full of emoji.
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{1F000}-\u{1F0FF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{1F1E6}-\u{1F1FF}]/u;
// The private use area: where icon fonts (Font Awesome and friends) live. Text
// drawn from these extracts as meaningless codepoints.
const PRIVATE_USE = /[\u{E000}-\u{F8FF}\u{F0000}-\u{FFFFD}]/u;
// Ligatures that a broken export leaves in the text layer instead of the
// letters they stand for.
const LIGATURES = /[ﬀ-ﬆ]/;
// PDF.js emits these when a font has no usable character map.
const CID_TOKENS = /\(cid:\d+\)/;

export const hasEmoji = (text) => EMOJI.test(String(text || ''));
export const hasPrivateUse = (text) => PRIVATE_USE.test(String(text || ''));
export const hasLigatures = (text) => LIGATURES.test(String(text || ''));
export const hasCidTokens = (text) => CID_TOKENS.test(String(text || ''));

/** Words, lowercased, punctuation stripped. */
export function words(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9'\-\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

export const wordCount = (text) => words(text).length;

/** The first word of a line, with any leading bullet glyph removed. */
export function firstWord(text) {
  const stripped = String(text || '').replace(/^[\s•·▪◦‣∙*+\-–—>»]+/u, '').trim();
  const match = stripped.match(/^[A-Za-z][A-Za-z'-]*/);
  return match ? match[0] : '';
}

/** The leading glyph of a bullet line, if the line starts with one. */
export function bulletGlyph(text) {
  const match = String(text || '').match(/^\s*(\S)/);
  if (!match) return null;
  const glyph = match[1];
  return /[A-Za-z0-9]/.test(glyph) ? null : glyph;
}

/**
 * Does this line contain a quantified outcome?
 *
 * A bare year is not an outcome — "Managed the 2023 migration" says nothing
 * about size or result — so four-digit years standing alone are excluded, and
 * a number has to carry a unit, a magnitude word, or a countable noun.
 */
export function hasQuantifiedOutcome(text) {
  const line = String(text || '');
  // Percentages, currency, and explicit magnitudes.
  if (/\d\s*%|%\s*\d/.test(line)) return true;
  if (/[$£€¥]\s?\d|\d\s?(usd|gbp|eur|nzd|aud|cad|dollars?|pounds?|euros?)\b/i.test(line)) return true;
  if (/\b\d+(\.\d+)?\s?(k|m|bn|b|thousand|million|billion)\b/i.test(line)) return true;
  // X to Y movements, the strongest shape a CV bullet can have.
  if (/\d+\s*(%|)\s*(to|→|->|–|-)\s*\d+\s*%/.test(line)) return true;
  // A count attached to something countable.
  if (/\b\d+\s?(\+|x)?\s?(people|staff|team|teams|members|engineers|developers|clients|customers|accounts|users|stores|sites|depots|projects|reports|countries|markets|hours|days|weeks|months|years|fte)\b/i.test(line)) {
    return true;
  }
  // Time saved or taken.
  if (/\b\d+(\.\d+)?\s?(seconds?|minutes?|hours?|days?|weeks?|months?)\b/i.test(line)) return true;
  // Anything else numeric that is not a lone year or a date.
  const numbers = line.match(/\b\d+(\.\d+)?\b/g) || [];
  return numbers.some((value) => !/^(19|20)\d{2}$/.test(value) && Number(value) > 1);
}

/** Sentence-ish split, used for summary length and tense checks. */
export function sentences(text) {
  return String(text || '').split(/(?<=[.!?])\s+/).map((part) => part.trim()).filter(Boolean);
}

/** First-person pronouns as whole words (D05). */
export function firstPersonPronouns(text) {
  const found = new Set();
  for (const pronoun of ['i', 'me', 'my', 'mine', 'we', 'our', 'ours', 'us']) {
    if (new RegExp(`\\b${pronoun}\\b`, 'i').test(String(text || ''))) found.add(pronoun);
  }
  return [...found];
}

/** Unusual acronyms: 2–6 capitals, not followed by an expansion (D11). */
export function unexpandedAcronyms(text, known) {
  const body = String(text || '');
  const seen = new Map();
  for (const match of body.matchAll(/\b([A-Z][A-Z0-9&]{1,5})\b/g)) {
    const acronym = match[1];
    if (known.has(acronym)) continue;
    // "RCA (root cause analysis)" is expanded; so is "root cause analysis (RCA)".
    const after = body.slice(match.index + acronym.length, match.index + acronym.length + 3);
    const before = body.slice(Math.max(0, match.index - 60), match.index);
    if (after.trimStart().startsWith('(')) continue;
    if (/\([A-Za-z ]*$/.test(before)) continue;
    seen.set(acronym, (seen.get(acronym) || 0) + 1);
  }
  return [...seen.keys()];
}

/**
 * Repeated identical glyph runs, the text form of a rating bar: `●●●○○`.
 * Three or more of the same non-alphanumeric glyph in a row.
 */
export function ratingGlyphRuns(text) {
  const matches = String(text || '').match(/([^\w\s])\1{2,}/gu) || [];
  return matches.filter((run) => !/^[.\-_=*#]+$/.test(run));
}

/** Share of tokens that are a single character — the spaced-out-glyph tell. */
export function singleCharacterShare(text) {
  const tokens = String(text || '').split(/\s+/).filter(Boolean);
  if (tokens.length < 20) return 0;
  const singles = tokens.filter((token) => token.replace(/[^A-Za-z]/g, '').length === 1);
  return singles.length / tokens.length;
}

/** Share of characters outside Latin-1, for the mixed-script check (P17). */
export function nonLatinShare(text) {
  const body = String(text || '');
  if (!body.length) return 0;
  const outside = [...body].filter((character) => character.codePointAt(0) > 0x24f).length;
  return outside / body.length;
}
