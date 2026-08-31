// PDF → document model.
//
// unpdf ships a serverless build of PDF.js (no canvas, worker inlined) that is
// tested on Cloudflare Workers, and it exposes the full PDF.js page API — which
// is what makes column detection, header/footer bands and reading-order
// analysis possible. A markdown-only conversion would hide exactly the layout
// facts Atsy needs to report.
//
// Everything downstream (layout, sections, entities, scoring) consumes the
// plain object this returns, so all of it is pure and node-testable.

import { getDocumentProxy, getResolvedPDFJS } from 'unpdf';

export const MAX_PAGES = 10;

export class UnreadablePdf extends Error {
  constructor(reason) {
    super(reason);
    this.reason = reason; // encrypted | corrupt | xfa_form | not_pdf
  }
}

// 2D matrix multiply, PDF order: [a b c d e f].
const multiply = (m, n) => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];

// Accepts PDF.js's '#rrggbb' form and the older numeric form, and returns
// channels in 0..1.
function toRgb(args) {
  const value = args[0];
  if (typeof value === 'string' && value.startsWith('#')) {
    return [1, 3, 5].map((offset) => parseInt(value.slice(offset, offset + 2), 16) / 255);
  }
  if (args.length >= 3) return args.slice(0, 3).map((channel) => (channel > 1 ? channel / 255 : channel));
  const gray = typeof value === 'number' ? (value > 1 ? value / 255 : value) : 0;
  return [gray, gray, gray];
}

function looksLikePdf(bytes) {
  // Trust the bytes, never the declared MIME type or the file extension.
  const header = String.fromCharCode(...bytes.slice(0, 5));
  return header === '%PDF-';
}

/**
 * Scan a page's operator list for the things text extraction cannot see:
 * invisible or same-as-background text, images and their placement, and the
 * fonts actually used.
 */
async function scanOperators(page, OPS) {
  const ops = await page.getOperatorList();
  const result = {
    invisibleTextRuns: 0,
    backgroundColourTextRuns: 0,
    images: [],
    fontNames: new Set(),
    rectangles: 0,
  };

  // q/Q save and restore the WHOLE graphics state, not just the transform.
  // Restoring only the CTM would leave a `3 Tr` from one clipped or
  // OCR-underlay run in force for the rest of the page, and every later run
  // would be reported as hidden text — an accusation of keyword stuffing
  // against a CV that did nothing of the sort.
  let state = { ctm: [1, 0, 0, 1, 0, 0], renderMode: 0, fill: [0, 0, 0] };
  const stack = [];

  for (let i = 0; i < ops.fnArray.length; i += 1) {
    const fn = ops.fnArray[i];
    const args = ops.argsArray[i];

    switch (fn) {
      case OPS.save:
        stack.push({ ctm: state.ctm.slice(), renderMode: state.renderMode, fill: state.fill.slice() });
        break;
      case OPS.restore:
        state = stack.pop() || { ctm: [1, 0, 0, 1, 0, 0], renderMode: 0, fill: [0, 0, 0] };
        break;
      case OPS.transform: state.ctm = multiply(state.ctm, args); break;
      case OPS.setTextRenderingMode: state.renderMode = args[0]; break;
      // PDF.js normalises fill colours to a CSS hex string, but older builds
      // pass three numbers — accept both rather than silently reading NaN.
      case OPS.setFillRGBColor: state.fill = toRgb(args); break;
      case OPS.setFillGray: state.fill = toRgb(args); break;
      case OPS.setFont: if (args[0]) result.fontNames.add(args[0]); break;
      case OPS.showText:
      case OPS.showSpacedText: {
        // Render mode 3 draws nothing a human can see; mode 7 is clip-only.
        if (state.renderMode === 3 || state.renderMode === 7) result.invisibleTextRuns += 1;
        // White text on a white page is the same trick with different means.
        else if (state.fill.every((channel) => channel > 0.95)) result.backgroundColourTextRuns += 1;
        break;
      }
      case OPS.paintImageXObject:
      case OPS.paintJpegXObject:
      case OPS.paintImageMaskXObject: {
        // The current transform maps the unit square onto the placed image.
        result.images.push({
          x: state.ctm[4], y: state.ctm[5],
          width: Math.abs(state.ctm[0]), height: Math.abs(state.ctm[3]),
        });
        break;
      }
      case OPS.constructPath: result.rectangles += 1; break;
      default: break;
    }
  }
  return result;
}

// Returns the fonts used on a page, plus a map from PDF.js's internal id to
// the real font name. The internal id carries a per-parse counter
// (g_d13_f1, g_d14_f1, …), so it must never reach the document model: two
// scans of the same file would otherwise differ.
function fontFacts(page, fontNames) {
  const fonts = [];
  const nameById = new Map();
  for (const id of fontNames) {
    let font = null;
    try { font = page.commonObjs.get(id); } catch { font = null; }
    const name = (font && font.name) || 'unknown';
    nameById.set(id, name);
    fonts.push({
      name,
      // A font without an embedded file renders with a substitute on another
      // machine, and its text can extract as the wrong characters entirely.
      embedded: !!font && font.missingFile === false,
      type3: !!(font && font.isType3Font),
    });
  }
  return { fonts, nameById };
}

/**
 * Read a PDF into the document model.
 * Throws UnreadablePdf for files that cannot be scanned at all.
 */
export async function extractDocument(bytes, { maxPages = MAX_PAGES } = {}) {
  // PDF.js takes ownership of the buffer it is given and detaches it, so the
  // caller's bytes would be unusable afterwards: no encrypting the file for
  // storage, no second pass, no re-scan. Parsing must not consume its input.
  const source = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const data = new Uint8Array(source.length);
  data.set(source);
  // Recorded before parsing: PDF.js detaches the buffer it is given, so
  // data.length reads as 0 afterwards.
  const byteLength = data.length;
  if (!looksLikePdf(data)) throw new UnreadablePdf('not_pdf');

  const { OPS } = await getResolvedPDFJS();
  let document;
  try {
    document = await getDocumentProxy(data);
  } catch (error) {
    const name = (error && error.name) || '';
    if (name === 'PasswordException') throw new UnreadablePdf('encrypted');
    throw new UnreadablePdf('corrupt');
  }

  const metadata = await document.getMetadata().catch(() => ({ info: {} }));
  const info = metadata.info || {};
  if (info.IsXFAPresent) throw new UnreadablePdf('xfa_form');

  const pageCount = document.numPages;
  const pagesRead = Math.min(pageCount, maxPages);
  const pages = [];
  const fonts = [];
  let charCount = 0;
  let invisibleTextRuns = 0;
  let backgroundColourTextRuns = 0;

  for (let number = 1; number <= pagesRead; number += 1) {
    const page = await document.getPage(number);
    const [, , pageWidth, pageHeight] = page.view;
    const content = await page.getTextContent();
    const scan = await scanOperators(page, OPS);
    const { fonts: pageFonts, nameById } = fontFacts(page, scan.fontNames);

    const items = [];
    for (const item of content.items) {
      if (typeof item.str !== 'string' || !item.str.trim()) continue;
      const [, , , , x, baseline] = item.transform;
      const size = Math.abs(item.transform[3]) || item.height || 0;
      const height = item.height || size;
      items.push({
        text: item.str,
        x,
        // Top-down coordinates: reading order is easier to reason about when
        // y grows downwards, the way the page is read.
        top: pageHeight - baseline - height,
        baseline: pageHeight - baseline,
        width: item.width || 0,
        height,
        size,
        font: nameById.get(item.fontName) || 'unknown',
      });
      charCount += item.str.length;
    }

    for (const font of pageFonts) {
      if (!fonts.some((existing) => existing.name === font.name)) fonts.push(font);
    }
    invisibleTextRuns += scan.invisibleTextRuns;
    backgroundColourTextRuns += scan.backgroundColourTextRuns;

    pages.push({
      number,
      width: pageWidth,
      height: pageHeight,
      items,
      images: scan.images.map((image) => ({
        x: image.x,
        top: pageHeight - image.y - image.height,
        width: image.width,
        height: image.height,
        areaRatio: (image.width * image.height) / (pageWidth * pageHeight),
      })),
      rectangles: scan.rectangles,
    });
  }

  return {
    pageCount,
    pagesRead,
    truncated: pageCount > pagesRead,
    byteLength,
    meta: {
      producer: info.Producer || null,
      creator: info.Creator || null,
      title: info.Title || null,
      language: info.Language || null,
      pdfVersion: info.PDFFormatVersion || null,
    },
    fonts,
    pages,
    charCount,
    hasTextLayer: charCount >= 200,
    invisibleTextRuns,
    backgroundColourTextRuns,
  };
}
