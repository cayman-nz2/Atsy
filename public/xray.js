/* Atsy — the X-ray.
 *
 * The reader's own PDF, rendered in their own browser, with each finding drawn
 * over the part of the page it is about.
 *
 * Three things decide how this is built:
 *
 *  1. It renders in the browser because a Worker has no canvas. The PDF is
 *     fetched from the same endpoint the "Open the stored copy" button uses, so
 *     the X-ray shows the reader nothing they could not already download, and
 *     the bytes are decrypted for them and nobody else.
 *  2. PDF.js is loaded with a dynamic import the first time the fold is opened.
 *     It is 1.7 MB. Nobody who never opens the X-ray should pay for it, and
 *     nothing else on the results screen may wait on it.
 *  3. Every failure is said out loud. A blank frame where a CV should be is
 *     worse than a sentence explaining why it is not there, and the machine
 *     view above it already carries the same insight without a renderer.
 *
 * Marks are positioned in percentages of the page, not pixels, so they stay
 * put when the canvas is scaled down — at 200% zoom, on a narrow phone, or
 * after a rotate — with no resize handler and nothing to fall out of step.
 */
(function () {
  'use strict';

  var PDFJS_URL = '/vendor/pdfjs/pdf.mjs';
  var WORKER_URL = '/vendor/pdfjs/pdf.worker.mjs';
  var FONTS_URL = '/vendor/pdfjs/standard_fonts/';

  // Rendering is capped rather than unbounded: a 4x canvas of an A4 page on a
  // 3x phone is 35 megapixels, which is a long freeze and a possible allocation
  // failure for a picture no better than a 2x one.
  var MAX_SCALE = 2;
  var MAX_CANVAS_PX = 4096;

  var pdfjs = null;          // the loaded library, once
  var doc = null;            // the current PDFDocumentProxy
  var current = null;        // { scanId, findings, sizes, pageCount }
  var pageNumber = 1;
  var rendering = false;

  function byId(id) { return document.getElementById(id); }

  function say(message) {
    var status = byId('xray-status');
    if (status) status.textContent = message || '';
  }

  /** Load PDF.js once, from our own origin. */
  async function library() {
    if (pdfjs) return pdfjs;
    var module = await import(PDFJS_URL);
    module.GlobalWorkerOptions.workerSrc = WORKER_URL;
    pdfjs = module;
    return pdfjs;
  }

  /**
   * Every finding that has somewhere to point, flattened to one mark each.
   *
   * The number is the finding's position in the whole list, so it matches the
   * number shown on its card in the fix list — including the ones folded away
   * under "smaller things".
   */
  function marksFor(findings, page) {
    var marks = [];
    findings.forEach(function (finding, index) {
      (finding.evidence || []).forEach(function (piece) {
        if (!piece.box || piece.page !== page) return;
        marks.push({
          number: index + 1,
          id: finding.id,
          title: finding.title,
          severity: finding.severity,
          box: piece.box,
        });
      });
    });
    return marks;
  }

  function drawMarks(marks, size) {
    var layer = byId('xray-marks');
    layer.textContent = '';
    if (!size || !size.width || !size.height) return;

    marks.forEach(function (mark) {
      var node = document.createElement('button');
      node.type = 'button';
      node.className = 'xmark';
      node.setAttribute('data-severity', mark.severity);
      // Percentages, so the marks track a canvas of any rendered size.
      node.style.left = (mark.box.x / size.width * 100) + '%';
      node.style.top = (mark.box.top / size.height * 100) + '%';
      node.style.width = (mark.box.width / size.width * 100) + '%';
      node.style.height = (mark.box.height / size.height * 100) + '%';

      var pin = document.createElement('b');
      pin.className = 'xpin';
      pin.textContent = String(mark.number);
      node.appendChild(pin);

      // The mark is a control, so it needs to say what it does rather than
      // relying on a coloured rectangle to explain itself.
      node.setAttribute('aria-label',
        'Finding ' + mark.number + ': ' + mark.title + '. Go to the fix.');
      node.addEventListener('click', function () { goToFix(mark.id); });
      layer.appendChild(node);
    });
  }

  /** Move the reader to the fix a mark belongs to, opening the fold if needed. */
  function goToFix(checkId) {
    var card = byId('fix-' + checkId);
    if (!card) return;
    var fold = card.closest('details');
    if (fold) fold.open = true;
    card.scrollIntoView({ block: 'center', behavior: 'smooth' });
    // Focus follows, or a keyboard reader is moved on the screen but not in
    // the tab order — the page would scroll and their next Tab would come from
    // wherever they were before.
    card.setAttribute('tabindex', '-1');
    card.focus({ preventScroll: true });
    card.classList.add('is-called');
    setTimeout(function () { card.classList.remove('is-called'); }, 1600);
  }

  async function renderPage(number) {
    if (!doc || rendering) return;
    rendering = true;
    try {
      var page = await doc.getPage(number);
      var canvas = byId('xray-canvas');
      var stage = byId('xray-stage');
      stage.removeAttribute('data-rendered');

      var base = page.getViewport({ scale: 1 });
      var width = stage.clientWidth || 320;
      var ratio = Math.min(window.devicePixelRatio || 1, MAX_SCALE);
      var scale = (width / base.width) * ratio;
      if (base.width * scale > MAX_CANVAS_PX) scale = MAX_CANVAS_PX / base.width;

      var viewport = page.getViewport({ scale: scale });
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      // The canvas is laid out by CSS at 100% of the stage; these keep its
      // aspect ratio honest while the bitmap stays at device resolution.
      canvas.style.aspectRatio = base.width + ' / ' + base.height;

      await page.render({
        canvasContext: canvas.getContext('2d'),
        viewport: viewport,
      }).promise;

      // The document model measures pages top-left down, unrotated. A rotated
      // page renders with its width and height swapped, so a box drawn from the
      // model would land somewhere the finding is not. Better no marks than
      // marks in the wrong place.
      var stored = (current.sizes || []).find(function (item) { return item.number === number; });
      var rotated = stored
        && Math.abs((base.width / base.height) - (stored.width / stored.height)) > 0.02;

      if (rotated) {
        drawMarks([], null);
        say('This page is rotated inside the file, so the findings cannot be placed on it '
          + 'accurately — they are listed above instead.');
      } else {
        var marks = marksFor(current.findings, number);
        drawMarks(marks, stored || { width: base.width, height: base.height });
        say(marks.length === 1
          ? 'One finding on this page. Select it to jump to the fix.'
          : (marks.length
            ? marks.length + ' findings on this page. Select one to jump to the fix.'
            : 'Nothing on this page has a place Atsy can point to.'));
      }

      page.cleanup();
      paintPager();
      // An explicit "this page is on the canvas" signal. Without one the only
      // thing to wait on is the canvas element, which has a default 300x150
      // size before anything is drawn — so a test, or anything else watching,
      // reads a blank frame as a finished render.
      stage.setAttribute('data-rendered', String(number));
    } finally {
      rendering = false;
    }
  }

  function paintPager() {
    var label = byId('xray-page');
    var previous = byId('xray-prev');
    var next = byId('xray-next');
    if (!label) return;
    label.textContent = 'Page ' + pageNumber + ' of ' + current.pageCount;
    previous.disabled = pageNumber <= 1;
    next.disabled = pageNumber >= current.pageCount;
    byId('xray-pager').hidden = current.pageCount < 2;
  }

  /** Open the document. Called once, the first time the fold is opened. */
  async function open() {
    say('Loading your PDF…');
    var lib = await library();

    var response = await fetch('/api/scans/' + current.scanId + '/file', {
      credentials: 'same-origin',
    });
    if (!response.ok) {
      throw new Error(response.status === 404
        ? 'The stored copy of this CV has already been deleted, so there is nothing left to '
          + 'render. The findings above are kept for 30 days.'
        : 'Your PDF could not be fetched.');
    }
    var bytes = new Uint8Array(await response.arrayBuffer());

    doc = await lib.getDocument({
      data: bytes,
      // The page's own policy allows no eval, and a CV needs no scripting,
      // no forms and no external anything to be drawn.
      isEvalSupported: false,
      standardFontDataUrl: FONTS_URL,
    }).promise;

    current.pageCount = doc.numPages;
    pageNumber = 1;
    await renderPage(pageNumber);
  }

  async function goToPage(number) {
    if (number < 1 || number > current.pageCount) return;
    pageNumber = number;
    await renderPage(number);
  }

  function fail(error) {
    var message = (error && error.message) || '';
    // A message we wrote ourselves is already addressed to the reader; one from
    // PDF.js is addressed to a developer, and is replaced rather than shown.
    say(/^[A-Z].*\.$/.test(message) && message.length < 200
      ? message
      : 'Your PDF could not be drawn here. Nothing is wrong with your scan — the findings '
        + 'above and the machine view are unaffected.');
    var stage = byId('xray-stage');
    if (stage) stage.hidden = true;
  }

  var started = false;

  function boot() {
    var fold = byId('xray-fold');
    if (!fold) return;

    fold.addEventListener('toggle', function () {
      if (!fold.open || started || !current) return;
      started = true;
      open().catch(fail);
    });

    byId('xray-prev').addEventListener('click', function () { goToPage(pageNumber - 1); });
    byId('xray-next').addEventListener('click', function () { goToPage(pageNumber + 1); });
  }

  /**
   * Point the X-ray at a scan. Called by the results screen on every render,
   * including when the reader re-opens an older scan from their history.
   */
  function mount(options) {
    var fold = byId('xray-fold');
    if (!fold) return;

    // A scan whose file has been purged has nothing to render. Saying so on the
    // results screen would be noise — the card below already explains the 24
    // hour deletion — so the fold simply is not offered.
    if (!options.fileAvailable) {
      fold.hidden = true;
      return;
    }

    var anyGeometry = (options.findings || []).some(function (finding) {
      return (finding.evidence || []).some(function (piece) { return piece.box; });
    });

    current = {
      scanId: options.scanId,
      findings: options.findings || [],
      sizes: options.sizes || [],
      pageCount: (options.sizes || []).length || 1,
    };
    // Reset: this may be the second scan rendered into the same screen.
    started = false;
    doc = null;
    pageNumber = 1;
    fold.open = false;
    fold.hidden = false;
    byId('xray-stage').hidden = false;
    byId('xray-stage').removeAttribute('data-rendered');
    byId('xray-marks').textContent = '';
    say(anyGeometry
      ? ''
      : 'None of this scan’s findings has a place on the page, so this shows your CV as it '
        + 'was submitted, with nothing marked on it.');
  }

  // Dynamic import and <details> are both required. Where either is missing the
  // fold never appears, and the machine view carries the same insight.
  var supported = typeof window.fetch === 'function'
    && typeof HTMLDetailsElement !== 'undefined';

  window.AtsyXray = {
    mount: supported ? mount : function () {
      var fold = byId('xray-fold');
      if (fold) fold.hidden = true;
    },
  };

  if (supported) boot();
})();
