// Pillar A — Parse & structure (35 points).
//
// "Can a machine extract this at all, in the right order?" These are the
// checks that decide whether the rest of the CV is even read, which is why
// three of them are fatal and cap the score outright.
//
// Every check returns null when it does not fire, or `{ evidence, message }`.
// Evidence is at most a page number and a snippet, never a copy of the CV:
// docs/SECURITY-PRIVACY.md caps snippets at 120 characters and the finding
// builder enforces it.

import {
  hasEmoji, hasPrivateUse, hasLigatures, hasCidTokens,
  singleCharacterShare, nonLatinShare, bulletGlyph, ratingGlyphRuns,
} from './text.js';

const GENERIC_FILENAMES = [
  /^cv\.pdf$/i, /^resume\.pdf$/i, /^my ?cv/i, /^my ?resume/i,
  /^cv[ _-]?final/i, /^resume[ _-]?final/i, /^document\d*\.pdf$/i,
  /^untitled/i, /^new ?(cv|resume)/i, /\bv\d+\b/i, /\bfinal\b/i,
  /\bdraft\b/i, /\bcopy\b/i, /^scan/i, /^download/i,
];

// A4 and US Letter, in points, with a tolerance for exporter rounding.
const STANDARD_PAGES = [
  { name: 'A4', width: 595, height: 842 },
  { name: 'Letter', width: 612, height: 792 },
];
const PAGE_TOLERANCE = 6;

// The PDF standard 14: every conforming reader ships them, so an unembedded
// one is not the "extracts as gibberish elsewhere" risk P06 exists to catch.
const STANDARD_14 = /^(helvetica|courier|times|symbol|zapfdingbats|arial)(-|,|$)/i;
const isStandardFont = (name) => STANDARD_14.test(String(name || '').replace(/^[A-Z]{6}\+/, ''));

const isStandardPage = (page) => STANDARD_PAGES.some((size) =>
  (Math.abs(page.width - size.width) <= PAGE_TOLERANCE
    && Math.abs(page.height - size.height) <= PAGE_TOLERANCE)
  // Landscape of a standard size is still a standard sheet.
  || (Math.abs(page.width - size.height) <= PAGE_TOLERANCE
    && Math.abs(page.height - size.width) <= PAGE_TOLERANCE));

export const PILLAR_A = [
  {
    id: 'P01',
    points: 0,
    fatal: true,
    cap: 25,
    severity: 'critical',
    title: 'No text layer',
    run(ctx) {
      const { document } = ctx;
      const perPage = document.pagesRead ? document.charCount / document.pagesRead : 0;
      if (document.charCount >= 200 && perPage >= 100) return null;
      return {
        message: 'This PDF has no text in it — it is a picture of a CV. Every parser sees an empty document. Export it again from Word or Google Docs as a real PDF.',
        evidence: [{
          page: 1,
          text: `${document.charCount} characters of text across ${document.pagesRead} page(s)`,
        }],
      };
    },
  },

  {
    id: 'P02',
    points: 6,
    severity: 'critical',
    title: 'Two-column layout',
    run(ctx) {
      const pages = ctx.layout.pages.filter((page) => page.columns.columns > 1);
      if (!pages.length) return null;
      return {
        message: 'Your layout is more than one column. Parsers read the text in the order the file stores it, which runs across the gutter — the machine view shows the result. Move to a single column.',
        evidence: pages.map((page) => ({
          page: page.number,
          text: `a gutter ${Math.round(page.columns.gutter ? page.columns.gutter.to - page.columns.gutter.from : 0)}pt wide splits this page`,
          box: page.columns.gutter
            ? { x: page.columns.gutter.from, top: 0, width: page.columns.gutter.to - page.columns.gutter.from, height: 0 }
            : null,
        })),
      };
    },
  },

  {
    id: 'P03',
    points: 3,
    severity: 'critical',
    title: 'Stored order is not reading order',
    run(ctx) {
      if (ctx.layout.worstReadingOrder >= 0.85) return null;
      const worst = ctx.layout.pages.reduce((low, page) =>
        (page.readingOrder < low.readingOrder ? page : low), ctx.layout.pages[0]);
      return {
        message: 'The text order stored inside the file does not match what you see on the page. Parsers read the stored order. Rebuild the document rather than repositioning text boxes.',
        evidence: [{
          page: worst.number,
          text: `stored order matches reading order ${Math.round(worst.readingOrder * 100)}% of the time`,
        }],
      };
    },
  },

  {
    id: 'P04',
    points: 3,
    severity: 'major',
    title: 'Content in the header or footer',
    run(ctx) {
      const contactInBand = /@|\+\d|\bwww\.|linkedin/i.test(ctx.bandText);
      if (!ctx.layout.repeatedHeader && !contactInBand) return null;
      const page = ctx.layout.pages.find((p) => p.header.length || p.footer.length);
      return {
        message: 'Anything in the page header or footer is frequently never read. Move it into the body of the first page.',
        evidence: [{
          page: page ? page.number : 1,
          text: ctx.bandText.slice(0, 100) || 'repeated across every page',
        }],
      };
    },
  },

  {
    id: 'P05',
    points: 3,
    severity: 'major',
    title: 'Content in a table',
    run(ctx) {
      const pages = ctx.layout.pages.filter((page) => page.table);
      if (!pages.length) return null;
      return {
        message: 'Your content sits in a table. Cell order is not reading order — parsers merge or drop cells. Use plain paragraphs and bullets.',
        evidence: pages.map((page) => ({
          page: page.number,
          text: `${page.table.rows} rows sharing ${page.table.columnStarts.length} column positions`,
        })),
      };
    },
  },

  {
    id: 'P06',
    points: 2,
    severity: 'major',
    title: 'A font is not embedded',
    run(ctx) {
      // The PDF standard 14 are guaranteed present in every reader, so they
      // extract correctly without being embedded. Flagging them would fire on
      // a large share of perfectly good CVs for a risk that does not exist.
      const loose = ctx.document.fonts.filter((font) =>
        !font.embedded && !isStandardFont(font.name));
      if (!loose.length) return null;
      return {
        message: 'One of your fonts is not embedded, so the text can extract as the wrong characters on another machine. Use Calibri, Arial, Georgia, Times New Roman or Garamond and re-export.',
        evidence: [{
          page: 1,
          text: loose.map((font) => font.name).join(', '),
        }],
      };
    },
  },

  {
    id: 'P07',
    points: 2,
    severity: 'critical',
    title: 'The extracted text is corrupted',
    run(ctx) {
      const reasons = [];
      if (hasCidTokens(ctx.allText)) reasons.push('unmapped glyph codes (cid:NNN)');
      if (hasLigatures(ctx.allText)) reasons.push('ligature characters instead of letters');
      const share = singleCharacterShare(ctx.allText);
      if (share > 0.15) reasons.push(`${Math.round(share * 100)}% of tokens are single characters`);
      if (!reasons.length) return null;
      return {
        message: 'The extracted text is corrupted — parsers will read fragments of words. Re-export as a PDF from your editor rather than printing to PDF.',
        evidence: [{ page: 1, text: reasons.join('; ') }],
      };
    },
  },

  {
    id: 'P08',
    points: 2,
    severity: 'minor',
    title: 'Bullets from an icon font',
    run(ctx) {
      const bad = ctx.bodyLines
        .filter((line) => {
          const glyph = bulletGlyph(line.text);
          return glyph && (hasPrivateUse(glyph) || hasEmoji(glyph));
        })
        .slice(0, 3);
      if (!bad.length) return null;
      return {
        message: 'Your bullet characters come from an icon font and extract as junk. Use a plain round or square bullet.',
        evidence: bad.map((line) => ({ page: line.page, text: line.text })),
      };
    },
  },

  {
    id: 'P09',
    points: 1,
    severity: 'minor',
    title: 'Emoji in the text',
    run(ctx) {
      if (!hasEmoji(ctx.allText)) return null;
      const line = ctx.bodyLines.find((candidate) => hasEmoji(candidate.text));
      return {
        message: 'Emoji do not survive parsing and read as informal to most reviewers. Remove them.',
        evidence: [{ page: line ? line.page : 1, text: line ? line.text : '' }],
      };
    },
  },

  {
    id: 'P10',
    points: 2,
    severity: 'major',
    title: 'Skills shown as pictures',
    run(ctx) {
      // Two forms of the same mistake: drawn bars, and text that imitates them.
      const glyphRuns = ratingGlyphRuns(ctx.skillLines.map((line) => line.text).join(' '));
      // The anchor is the heading when the section holds no text, which is
      // precisely the CV whose skills are nothing but bars.
      const anchor = ctx.skillsAnchor;
      const barsNearSkills = anchor
        ? ctx.document.pages.flatMap((page) => page.shapes.map((shape) => ({ ...shape, page: page.number })))
          .filter((shape) => shape.page === anchor.page && shape.top > anchor.top - 20 && shape.top < anchor.top + 160)
        : [];

      if (!glyphRuns.length && barsNearSkills.length < 3) return null;
      return {
        message: 'Your skill ratings are pictures. A parser records nothing from them — and reviewers distrust self-rated bars. Write plain skill names instead.',
        evidence: glyphRuns.length
          ? [{ page: anchor ? anchor.page : 1, text: `rating glyphs: ${glyphRuns.slice(0, 3).join(' ')}` }]
          : [{
            page: barsNearSkills[0].page,
            text: `${barsNearSkills.length} drawn bars beside the skills section`,
            box: {
              x: barsNearSkills[0].x, top: barsNearSkills[0].top,
              width: barsNearSkills[0].width, height: barsNearSkills[0].height,
            },
          }],
      };
    },
  },

  {
    id: 'P11',
    points: 3,
    severity: 'critical',
    title: 'Section headings a parser does not know',
    run(ctx) {
      const { found, unknownHeadings, headings } = ctx.sections;
      // Two conditions, either of which is the same problem: the labels a
      // parser looks for are not there, or labels it cannot place are.
      const tooFewCanonical = found.length < 2;
      if (!tooFewCanonical && !unknownHeadings.length) return null;

      const reason = tooFewCanonical
        ? `only ${found.length} standard heading${found.length === 1 ? '' : 's'} found`
        : `unrecognised: ${unknownHeadings.slice(0, 4).join(', ')}`;
      const first = unknownHeadings.length
        ? headings.find((heading) => heading.text === unknownHeadings[0])
        : null;
      return {
        message: 'Your section headings are not the ones parsers look for. Use plain labels: Summary, Experience, Education, Skills.',
        evidence: [{ page: first ? first.page : 1, text: reason }],
      };
    },
  },

  {
    id: 'P12',
    points: 2,
    severity: 'minor',
    title: 'Long, heavy, or an unusual page size',
    run(ctx) {
      const reasons = [];
      if (ctx.document.pageCount > 3) reasons.push(`${ctx.document.pageCount} pages`);
      if (ctx.fileBytes > 2 * 1024 * 1024) {
        reasons.push(`${(ctx.fileBytes / (1024 * 1024)).toFixed(1)} MB`);
      }
      const odd = ctx.document.pages.find((page) => !isStandardPage(page));
      if (odd) reasons.push(`page ${odd.number} is ${Math.round(odd.width)}×${Math.round(odd.height)}pt, not A4 or Letter`);
      if (!reasons.length) return null;
      return {
        message: 'Keep it to one or two pages and a standard page size — long or unusual files get truncated by some upload forms.',
        evidence: [{ page: 1, text: reasons.join('; ') }],
      };
    },
  },

  {
    id: 'P13',
    points: 1,
    severity: 'minor',
    title: 'The filename works against you',
    run(ctx) {
      const name = ctx.filename;
      const reasons = [];
      if (/\s/.test(name)) reasons.push('spaces');
      if (/[#&%{}$!'"@]/.test(name)) reasons.push('punctuation some upload forms mangle');
      // eslint-disable-next-line no-control-regex
      if (/[^\x00-\x7f]/.test(name)) reasons.push('non-ASCII characters');
      if (GENERIC_FILENAMES.some((pattern) => pattern.test(name))) reasons.push('a generic name');
      if (!reasons.length) return null;
      return {
        message: 'Rename the file Firstname-Lastname-Role.pdf — some upload forms mangle names, and recruiters search by filename.',
        evidence: [{ page: 1, text: `${name} — ${reasons.join(', ')}` }],
      };
    },
  },

  {
    id: 'P14',
    points: 0,
    fatal: true,
    cap: 40,
    severity: 'critical',
    title: 'Hidden text',
    run(ctx) {
      const { invisibleTextRuns, backgroundColourTextRuns } = ctx.document;
      const total = invisibleTextRuns + backgroundColourTextRuns;
      if (!total) return null;
      const how = [];
      if (invisibleTextRuns) how.push(`${invisibleTextRuns} run(s) drawn invisibly`);
      if (backgroundColourTextRuns) how.push(`${backgroundColourTextRuns} run(s) in the page colour`);
      return {
        message: 'There is invisible text in this file (white-on-white or drawn in invisible mode). Parsers see it, and ATS vendors and recruiters flag it as keyword stuffing. Remove it.',
        evidence: [{ page: 1, text: how.join('; ') }],
      };
    },
  },

  {
    id: 'P15',
    points: 1,
    severity: 'minor',
    title: 'Links only exist as annotations',
    run(ctx) {
      const links = ctx.document.pages.flatMap((page) =>
        page.links.map((link) => ({ ...link, page: page.number })));
      if (!links.length) return null;
      // A link whose URL also appears as visible text is fine.
      const invisible = links.filter((link) => {
        if (!link.url) return true;
        const host = link.url.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
        return host && !ctx.allText.toLowerCase().includes(host.toLowerCase());
      });
      if (!invisible.length) return null;
      return {
        message: 'Write your links as visible text (linkedin.com/in/yourname). Link annotations are often stripped before a parser sees them.',
        evidence: invisible.slice(0, 3).map((link) => ({
          page: link.page,
          text: link.url ? `hidden behind anchor text: ${link.url}` : 'a link with no URL',
        })),
      };
    },
  },

  {
    id: 'P16',
    points: 2,
    severity: 'major',
    title: 'The type is set too tight',
    run(ctx) {
      const reasons = [];
      if (ctx.sections.bodySize && ctx.sections.bodySize < 9) {
        reasons.push(`body text is ${ctx.sections.bodySize.toFixed(1)}pt`);
      }
      if (Number.isFinite(ctx.layout.worstLineHeightRatio) && ctx.layout.worstLineHeightRatio < 1.05) {
        reasons.push(`line height is ${ctx.layout.worstLineHeightRatio.toFixed(2)}× the type size`);
      }
      // 10 mm at 72pt per inch.
      const MIN_MARGIN_PT = 28.35;
      if (Number.isFinite(ctx.layout.tightestMargin) && ctx.layout.tightestMargin < MIN_MARGIN_PT) {
        reasons.push(`a margin of ${Math.round(ctx.layout.tightestMargin / 2.835)}mm`);
      }
      if (!reasons.length) return null;
      return {
        message: 'Type is set too tight to survive a print or a preview — and it signals cramming. Use 10–12pt with normal line spacing and margins of at least 10mm.',
        evidence: [{ page: 1, text: reasons.join('; ') }],
      };
    },
  },

  {
    id: 'P17',
    points: 1,
    severity: 'minor',
    title: 'Mixed scripts or no document language',
    run(ctx) {
      const share = nonLatinShare(ctx.allText);
      const language = ctx.document.meta.language;
      if (share <= 0.05 && language) return null;
      if (share <= 0.05 && !language) {
        return {
          message: 'Set the document language in your editor. Some parsers use it to choose how to read the text, and an unset language makes them guess.',
          evidence: [{ page: 1, text: 'no document language is declared' }],
        };
      }
      return {
        message: 'Set the document language and keep to one script — some parsers drop unexpected characters.',
        evidence: [{
          page: 1,
          text: `${Math.round(share * 100)}% of characters are outside Latin-1${language ? '' : ', and no language is declared'}`,
        }],
      };
    },
  },
];
