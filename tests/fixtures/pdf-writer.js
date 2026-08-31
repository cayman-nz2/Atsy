// A minimal, dependency-free PDF writer, used only to build test fixtures.
//
// Fixtures are generated rather than committed as binaries so that each one's
// defining property — a gutter at this x, contact details inside the header
// band, text drawn in invisible render mode — is readable in the source and
// reviewable in a diff, instead of hidden inside a blob.

const enc = (text) => text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

// One text run: a string drawn at an exact point on the page.
// `mode` is the PDF text rendering mode (3 = invisible), `rgb` the fill colour.
// Each run is wrapped in q/Q. Text render mode and fill colour are graphics
// state, not text-object state: without the wrapper a `3 Tr` set for one run
// stays in force for every run after it, which is a genuine PDF behaviour that
// would silently make the wrong fixture.
function runToStream({ text, x, y, size = 11, mode = 0, rgb }) {
  const parts = ['q', 'BT'];
  if (rgb) parts.push(`${rgb[0]} ${rgb[1]} ${rgb[2]} rg`);
  if (mode) parts.push(`${mode} Tr`);
  parts.push(`/F1 ${size} Tf`, `${x} ${y} Td`, `(${enc(text)}) Tj`, 'ET', 'Q');
  return parts.join(' ');
}

// A 8x8 grey image, enough to be a real XObject on the page (a photo, a logo,
// or the whole page for a scanned CV).
const IMAGE_BYTES = Array.from({ length: 64 }, (_, i) => (i * 4) % 256);

function imageToStream({ x, y, w, h }, name) {
  return `q ${w} 0 0 ${h} ${x} ${y} cm /${name} Do Q`;
}

// A filled rectangle. Real CVs draw these as rating bars, sidebar panels and
// table rules, and a parser reads none of them — which is the whole point of
// the fixture that uses them.
function rectToStream({ x, y, w, h, rgb = [0.2, 0.2, 0.2] }) {
  return `q ${rgb[0]} ${rgb[1]} ${rgb[2]} rg ${x} ${y} ${w} ${h} re f Q`;
}

/**
 * Build a PDF from a declarative page description.
 * pages: [{ width, height, runs: [...], images: [{x,y,w,h}], rects: [{x,y,w,h,rgb}] }]
 */
export function writePdf({ pages, info = {} }) {
  const objects = [];
  const add = (body) => objects.push(body) && objects.length; // 1-based object number

  const catalogNumber = 1;
  const pagesNumber = 2;
  objects.push('', ''); // reserved for catalog and page tree

  const fontNumber = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');

  const pageNumbers = [];
  for (const page of pages) {
    const width = page.width || 595;
    const height = page.height || 842;
    const images = page.images || [];

    const imageNumbers = images.map(() => add(
      `<< /Type /XObject /Subtype /Image /Width 8 /Height 8 /ColorSpace /DeviceGray `
      + `/BitsPerComponent 8 /Length ${IMAGE_BYTES.length} >>\nstream\n`
      + `${String.fromCharCode(...IMAGE_BYTES)}\nendstream`,
    ));

    const stream = [
      ...(page.rects || []).map(rectToStream),
      ...(page.runs || []).map(runToStream),
      ...images.map((image, index) => imageToStream(image, `Im${imageNumbers[index]}`)),
    ].join('\n');

    const contentNumber = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    const xobjects = imageNumbers.length
      ? ` /XObject << ${imageNumbers.map((n) => `/Im${n} ${n} 0 R`).join(' ')} >>`
      : '';
    pageNumbers.push(add(
      `<< /Type /Page /Parent ${pagesNumber} 0 R /MediaBox [0 0 ${width} ${height}] `
      + `/Resources << /Font << /F1 ${fontNumber} 0 R >>${xobjects} >> `
      + `/Contents ${contentNumber} 0 R >>`,
    ));
  }

  objects[catalogNumber - 1] = `<< /Type /Catalog /Pages ${pagesNumber} 0 R${info.lang ? ` /Lang (${info.lang})` : ''} >>`;
  objects[pagesNumber - 1] =
    `<< /Type /Pages /Kids [${pageNumbers.map((n) => `${n} 0 R`).join(' ')}] /Count ${pageNumbers.length} >>`;

  let out = '%PDF-1.7\n';
  const offsets = [];
  objects.forEach((body, index) => {
    offsets.push(out.length);
    out += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const startxref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) out += `${String(offset).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogNumber} 0 R >>\n`
    + `startxref\n${startxref}\n%%EOF`;

  return new Uint8Array(Array.from(out, (character) => character.charCodeAt(0) & 0xff));
}

// Helper: lay a block of lines down the page from a starting point.
export function column({ x, top, lines, size = 11, leading = 15, pageHeight = 842 }) {
  return lines.map((line, index) => (typeof line === 'string'
    ? { text: line, x, y: pageHeight - top - index * leading, size }
    : { ...line, x: line.x ?? x, y: pageHeight - top - index * leading, size: line.size || size }));
}
