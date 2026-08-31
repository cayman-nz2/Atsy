// Where a finding is on the page.
//
// A finding that says "your contact details are in the header" is far more
// useful when the reader can see which band of their own page that is. These
// helpers turn the objects the checks already hold — lines, items, bands — into
// a rectangle the X-ray can draw.
//
// Boxes are in the document model's coordinate space: PDF points, origin at the
// top-left of the page, y growing downwards. The client rescales them onto
// whatever size it renders the page at, using the page dimensions the model
// already reports.
//
// A box is geometry, never content. Storing one alongside a finding says where
// to look, not what the CV says, so the privacy rule that keeps extracted text
// out of the database is untouched.

/** A rectangle around a set of positioned things, or null if there are none. */
export function boxOf(things) {
  const placed = (things || []).filter((thing) => thing
    && Number.isFinite(left(thing)) && Number.isFinite(thing.top));
  if (!placed.length) return null;

  const x0 = Math.min(...placed.map(left));
  const x1 = Math.max(...placed.map(right));
  const y0 = Math.min(...placed.map((thing) => thing.top));
  const y1 = Math.max(...placed.map(bottom));
  return round({ x: x0, top: y0, width: x1 - x0, height: y1 - y0 });
}

// Lines carry left/right; items carry x/width. Both carry top, and an item's
// height is its own while a line's comes from its tallest item.
const left = (thing) => (thing.left !== undefined ? thing.left : thing.x);
const right = (thing) => (thing.right !== undefined ? thing.right : thing.x + (thing.width || 0));
const bottom = (thing) => thing.top + heightOf(thing);

function heightOf(thing) {
  if (Number.isFinite(thing.height)) return thing.height;
  if (thing.items && thing.items.length) return Math.max(...thing.items.map((item) => item.height || item.size || 0));
  return thing.size || 0;
}

/**
 * A full-height vertical band — what a column gutter is. A zero-height box
 * would be invisible, and a gutter is a property of the whole page.
 */
export function bandDown(from, to, pageHeight) {
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return null;
  return round({ x: from, top: 0, width: to - from, height: pageHeight || 0 });
}

/**
 * A full-width horizontal band — what a running head or foot is. Drawn edge to
 * edge because that is the region the parser skips, not just the part of it
 * that happens to have text in it.
 */
export function bandAcross(things, pageWidth) {
  const box = boxOf(things);
  if (!box) return null;
  return round({ x: 0, top: box.top, width: pageWidth || box.width, height: box.height });
}

// Sub-point precision is noise in a box that will be drawn at screen
// resolution, and it makes the stored JSON larger for nothing.
const round = (box) => ({
  x: Math.round(box.x * 10) / 10,
  top: Math.round(box.top * 10) / 10,
  width: Math.round(box.width * 10) / 10,
  height: Math.round(box.height * 10) / 10,
});
