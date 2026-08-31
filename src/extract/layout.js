// Layout analysis over the document model. Pure functions, no I/O: given the
// positioned text items from src/extract/pdf.js, work out how the page is put
// together and where that will hurt a parser.

const BAND_RATIO = 0.05;        // running heads and feet live in the outer 5%
const BAND_GAP = 20;            // points of clear space that mark a band off from the body
// A sidebar gutter in a real CV is 4-8mm, not the 8% of page width an early
// draft of the spec assumed: 48pt would have missed most two-column templates,
// which is a false negative on the single most damaging check in the rubric.
const MIN_GUTTER_PT = 12;
const MIN_GUTTER_RATIO = 0.02;
const MIN_SIDE_SHARE = 0.15;    // both sides must hold real content
const ALIGN_TOLERANCE = 2;      // points, for deciding two items share a column

/** Group a page's items into visual lines, left to right. */
export function groupLines(page) {
  const items = [...page.items].sort((a, b) => a.baseline - b.baseline || a.x - b.x);
  const lines = [];
  for (const item of items) {
    const tolerance = Math.max(2, item.size * 0.5);
    const line = lines.find((candidate) => Math.abs(candidate.baseline - item.baseline) <= tolerance);
    if (line) {
      line.items.push(item);
      line.left = Math.min(line.left, item.x);
      line.right = Math.max(line.right, item.x + item.width);
      line.top = Math.min(line.top, item.top);
      line.size = Math.max(line.size, item.size);
    } else {
      lines.push({
        baseline: item.baseline,
        top: item.top,
        left: item.x,
        right: item.x + item.width,
        size: item.size,
        items: [item],
      });
    }
  }
  for (const line of lines) {
    line.items.sort((a, b) => a.x - b.x);
    line.text = line.items.map((item) => item.text).join(' ').replace(/\s+/g, ' ').trim();
  }
  return lines.sort((a, b) => a.baseline - b.baseline);
}

/**
 * Items sitting in a running-head or running-foot band: inside the outer 5% of
 * the page AND separated from the body by clear space. The separation matters —
 * a name on the first line of a CV is in the top band but is not a header, and
 * flagging it would send people to move the one thing that is already right.
 */
export function bands(page) {
  const headerLimit = page.height * BAND_RATIO;
  const footerStart = page.height * (1 - BAND_RATIO);
  const inHeader = page.items.filter((item) => item.top < headerLimit);
  const inFooter = page.items.filter((item) => item.baseline > footerStart);

  const body = page.items.filter((item) => !inHeader.includes(item) && !inFooter.includes(item));
  const bodyTop = body.length ? Math.min(...body.map((item) => item.top)) : page.height;
  const bodyBottom = body.length ? Math.max(...body.map((item) => item.baseline)) : 0;

  return {
    header: inHeader.filter((item) => bodyTop - item.baseline >= BAND_GAP),
    footer: inFooter.filter((item) => item.top - bodyBottom >= BAND_GAP),
  };
}

/**
 * Find a real column gutter: a vertical band with no glyphs in it, wide
 * enough and tall enough to split the page, with content on both sides and
 * almost no lines crossing it.
 */
export function detectColumns(page, lines) {
  const bandInfo = bands(page);
  const bandItems = new Set([...bandInfo.header, ...bandInfo.footer]);
  const bodyLines = lines.filter((line) => !line.items.every((item) => bandItems.has(item)));
  if (bodyLines.length < 6) return { columns: 1, gutter: null };

  const BIN = 4;
  const binCount = Math.ceil(page.width / BIN);
  const occupied = new Array(binCount).fill(false);
  for (const line of bodyLines) {
    for (const item of line.items) {
      const from = Math.max(0, Math.floor(item.x / BIN));
      const to = Math.min(binCount - 1, Math.ceil((item.x + item.width) / BIN));
      for (let bin = from; bin <= to; bin += 1) occupied[bin] = true;
    }
  }

  const leftEdge = Math.min(...bodyLines.map((line) => line.left));
  const rightEdge = Math.max(...bodyLines.map((line) => line.right));
  const minGutter = Math.max(MIN_GUTTER_PT, page.width * MIN_GUTTER_RATIO);

  let best = null;
  let runStart = null;
  for (let bin = 0; bin <= binCount; bin += 1) {
    const isEmpty = bin < binCount && !occupied[bin];
    if (isEmpty && runStart === null) runStart = bin;
    if (!isEmpty && runStart !== null) {
      const from = runStart * BIN;
      const to = bin * BIN;
      runStart = null;
      // Only gaps inside the text block count: page margins are not gutters.
      if (from <= leftEdge || to >= rightEdge) continue;
      if (to - from < minGutter) continue;

      const totalChars = bodyLines.reduce((sum, line) => sum + line.text.length, 0) || 1;
      let leftChars = 0;
      let rightChars = 0;
      let paired = 0;
      for (const line of bodyLines) {
        const hasLeft = line.items.some((item) => item.x + item.width <= from);
        const hasRight = line.items.some((item) => item.x >= to);
        // A row with content on both sides of the gutter is the two-column
        // shape itself. An earlier version rejected candidates on exactly this
        // signal, which made the check blind to the layout it exists to find.
        if (hasLeft && hasRight) paired += 1;
        for (const item of line.items) {
          if (item.x + item.width <= from) leftChars += item.text.length;
          else if (item.x >= to) rightChars += item.text.length;
        }
      }
      const leftShare = leftChars / totalChars;
      const rightShare = rightChars / totalChars;
      if (leftShare < MIN_SIDE_SHARE || rightShare < MIN_SIDE_SHARE) continue;

      const candidate = {
        from, to, leftShare, rightShare, width: to - from,
        pairedShare: paired / bodyLines.length,
      };
      if (!best || candidate.width > best.width) best = candidate;
    }
  }

  return { columns: best ? 2 : 1, gutter: best };
}

/**
 * How closely the order the text is stored in matches the order a person
 * reads it. A parser walks the stored order; when a sidebar is emitted after
 * the main column, or frames are stored out of sequence, the extracted text is
 * shuffled even though the page looks fine.
 * 1 = identical, 0 = reversed.
 */
export function readingOrderConfidence(page) {
  const stored = page.items.map((item, index) => ({ index, item }));
  if (stored.length < 4) return 1;
  const visual = [...stored].sort((a, b) => {
    const lineGap = a.item.baseline - b.item.baseline;
    if (Math.abs(lineGap) > Math.max(2, a.item.size * 0.5)) return lineGap;
    return a.item.x - b.item.x;
  });
  const rank = new Map(visual.map((entry, position) => [entry.index, position]));

  let concordant = 0;
  let discordant = 0;
  for (let i = 0; i < stored.length; i += 1) {
    for (let j = i + 1; j < stored.length; j += 1) {
      const a = rank.get(stored[i].index);
      const b = rank.get(stored[j].index);
      if (a === b) continue;
      if (a < b) concordant += 1;
      else discordant += 1;
    }
  }
  const pairs = concordant + discordant;
  return pairs === 0 ? 1 : concordant / pairs;
}

/**
 * A table: three or more lines whose items line up in the same three or more
 * columns. Cell order is not reading order, so parsers merge or drop cells.
 */
export function detectTable(lines) {
  const candidates = lines.filter((line) => line.items.length >= 3);
  if (candidates.length < 3) return null;

  const columnsOf = (line) => line.items.map((item) => Math.round(item.x));
  for (let start = 0; start <= candidates.length - 3; start += 1) {
    const reference = columnsOf(candidates[start]);
    const matching = candidates.filter((line) => {
      const positions = columnsOf(line);
      const aligned = reference.filter((x) =>
        positions.some((other) => Math.abs(other - x) <= ALIGN_TOLERANCE));
      return aligned.length >= 3;
    });
    if (matching.length >= 3) {
      return {
        rows: matching.length,
        columns: reference.length,
        columnStarts: reference,
        top: matching[0].top,
      };
    }
  }
  return null;
}

/** Everything layout knows about a document, per page and overall. */
/**
 * The measurements P16 asks about: how tight is the type, and how close to the
 * paper edge does it run.
 *
 * Line height is the MEDIAN gap between consecutive baselines, not the mean: a
 * CV's blank lines between sections are large gaps that would drag a mean
 * upwards and hide genuinely cramped body text.
 */
export function pageMetrics(page, lines) {
  const body = lines.filter((line) => line.text.trim());
  if (!body.length) {
    return { leftMargin: null, rightMargin: null, lineHeight: null, lineHeightRatio: null };
  }

  // Grouped lines carry `left`/`right`, not `x`/`width`: reading the item
  // field names off a line gives NaN, silently, for every page.
  const left = Math.min(...body.map((line) => line.left));
  const right = Math.max(...body.map((line) => line.right));

  const gaps = [];
  for (let index = 1; index < body.length; index += 1) {
    const gap = body[index].top - body[index - 1].top;
    // Only gaps that are plausibly one line apart: a section break is not a
    // line height, and a negative gap is a column jump.
    if (gap > 0 && gap < 40) gaps.push(gap);
  }
  gaps.sort((a, b) => a - b);
  const lineHeight = gaps.length ? gaps[Math.floor(gaps.length / 2)] : null;

  const sizes = body.map((line) => line.size).filter((size) => size > 0).sort((a, b) => a - b);
  const typicalSize = sizes.length ? sizes[Math.floor(sizes.length / 2)] : null;

  return {
    leftMargin: left,
    rightMargin: page.width - right,
    lineHeight,
    // Ratio of line height to type size, the number a designer would quote.
    lineHeightRatio: lineHeight && typicalSize ? lineHeight / typicalSize : null,
  };
}

export function analyseLayout(document) {
  const pages = document.pages.map((page) => {
    const lines = groupLines(page);
    const band = bands(page);
    const table = detectTable(lines);
    const columns = detectColumns(page, lines);

    // A table's own cell spacing shows up as an empty vertical band. Report the
    // table, which is the actual cause, rather than charging the CV twice for
    // one problem.
    if (table && columns.gutter) {
      const insideTable = table.columnStarts.some((start) =>
        start > columns.gutter.from - ALIGN_TOLERANCE && start <= columns.gutter.to + ALIGN_TOLERANCE);
      if (insideTable) {
        columns.columns = 1;
        columns.suppressedByTable = true;
      }
    }

    return {
      number: page.number,
      lines,
      header: band.header,
      footer: band.footer,
      columns,
      readingOrder: readingOrderConfidence(page),
      table,
      metrics: pageMetrics(page, lines),
    };
  });

  // A band that repeats on more than one page is a running head or foot, which
  // is the part parsers most reliably skip.
  const headerTexts = pages.map((page) => page.header.map((item) => item.text.trim()).join(' ').trim());
  const repeatedHeader = headerTexts.length > 1
    && headerTexts.every((text) => text && text === headerTexts[0]);

  return {
    pages,
    multiColumn: pages.some((page) => page.columns.columns > 1),
    worstReadingOrder: Math.min(...pages.map((page) => page.readingOrder)),
    hasTable: pages.some((page) => page.table),
    headerItems: pages.reduce((sum, page) => sum + page.header.length, 0),
    footerItems: pages.reduce((sum, page) => sum + page.footer.length, 0),
    repeatedHeader,
    // The tightest page decides: one cramped page is a cramped CV.
    tightestMargin: Math.min(...pages.map((page) => {
      const { leftMargin, rightMargin } = page.metrics;
      const values = [leftMargin, rightMargin].filter((value) => value !== null);
      return values.length ? Math.min(...values) : Infinity;
    })),
    worstLineHeightRatio: Math.min(...pages.map((page) =>
      (page.metrics.lineHeightRatio === null ? Infinity : page.metrics.lineHeightRatio))),
  };
}
