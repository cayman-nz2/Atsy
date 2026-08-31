/* Sign-in screens: email, code, account. Three screens in one document, with
   history entries so the phone's Back button moves between them. */
(function () {
  'use strict';

  var screens = {
    email: document.getElementById('screen-email'),
    code: document.getElementById('screen-code'),
    account: document.getElementById('screen-account'),
    result: document.getElementById('screen-result'),
  };
  if (!screens.email) return;

  var state = { email: '', siteKey: '', maxUploadBytes: 5 * 1024 * 1024 };
  var currentScanId = null;

  var TITLES = { email: 'Sign in', code: 'Sign in', account: 'Your account', result: 'Your score' };

  function show(name, push) {
    Object.keys(screens).forEach(function (key) { screens[key].hidden = key !== name; });
    document.title = (TITLES[name] || 'Sign in') + ' — Atsy';
    if (push) history.pushState({ screen: name }, '', name === 'email' ? '/app' : '/app#' + name);
    // A new screen starts at the top. Landing halfway down a score screen
    // because the previous one was scrolled is the kind of thing that reads as
    // a broken page.
    window.scrollTo({ top: 0 });
    var focusable = screens[name].querySelector('input, button, a[href]');
    if (focusable) focusable.focus({ preventScroll: true });
  }

  window.addEventListener('popstate', function (event) {
    var name = (event.state && event.state.screen) || 'email';
    if ((name === 'account' || name === 'result') && !screens.account.dataset.ready) name = 'email';
    // Going back to a result that has been deleted would show an empty screen.
    if (name === 'result' && !currentScanId) name = 'account';
    show(name, false);
  });

  function setError(id, message) {
    var node = document.getElementById(id);
    node.textContent = message || '';
    node.hidden = !message;
  }

  function busy(button, label) {
    button.disabled = true;
    button.dataset.idle = button.dataset.idle || button.textContent;
    button.textContent = label;
  }
  function idle(button) {
    button.disabled = false;
    if (button.dataset.idle) button.textContent = button.dataset.idle;
  }

  async function api(path, options) {
    var response = await fetch(path, Object.assign({
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
    }, options));
    var data = null;
    try { data = await response.json(); } catch (e) { data = null; }
    return { ok: response.ok, status: response.status, data: data };
  }

  var MESSAGES = {
    invalid_email: 'That does not look like an email address.',
    turnstile_failed: 'The browser check could not complete. Reload the page and try again.',
    too_many_requests: 'That is a lot of codes. Wait an hour and try again.',
    email_unavailable: 'We could not send the email just now. Try again in a moment.',
    invalid_request: 'Enter the six digits from the email.',
    code_expired: 'That code has expired. Ask for a new one.',
    wrong_code: 'That code is not right. Check the email and try again.',
    too_many_attempts: 'Too many attempts. Ask for a new code.',
    unauthorised: 'Your session has ended. Sign in again.',
  };
  var say = function (code) { return MESSAGES[code] || 'Something went wrong. Try again.'; };

  /* ---------- Turnstile: the only third-party embed, always given an
       explicit theme so it cannot follow the phone into dark mode inside a
       light card.

       There are two shielded forms — sign-in and CV upload — so a widget is a
       small object rather than a pair of module variables. One shared token
       would be wrong twice over: Turnstile tokens are single-use, and the two
       forms are never submitted from the same screen. ---------- */
  function currentTheme() {
    var stamped = document.documentElement.getAttribute('data-theme');
    if (stamped) return stamped;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  var shields = [];
  function shield(slotId, buttonId, errorId) {
    var made = { slotId: slotId, buttonId: buttonId, errorId: errorId, token: '', widgetId: null };
    shields.push(made);
    return made;
  }
  var signInShield = shield('turnstile-slot', 'email-submit', 'email-error');
  var uploadShield = shield('upload-turnstile', 'upload-submit', 'upload-error');

  // While a bot check is configured, the submit button waits for it. Letting
  // someone press the button before the widget has a token produces a refusal
  // that reads like their fault and is not.
  function setShieldState(which, ready, message) {
    var button = document.getElementById(which.buttonId);
    if (!button || !state.siteKey) return;
    button.disabled = !ready;
    if (!button.dataset.idle) button.dataset.idle = button.textContent;
    button.textContent = ready ? button.dataset.idle : 'Checking your browser…';
    setError(which.errorId, message || '');
  }

  function renderShield(which) {
    var slot = document.getElementById(which.slotId);
    if (!slot || !state.siteKey || !window.turnstile) return;
    // Turnstile cannot measure a widget inside a hidden element, so a screen
    // that is not on yet gets its widget when it is shown.
    if (slot.offsetParent === null) return;
    slot.textContent = '';
    which.token = '';
    setShieldState(which, false);
    which.widgetId = window.turnstile.render(slot, {
      sitekey: state.siteKey,
      theme: currentTheme(),
      callback: function (token) { which.token = token; setShieldState(which, true); },
      'error-callback': function () {
        which.token = '';
        setShieldState(which, false, 'The browser check could not run. Reload the page, or try another browser.');
      },
      'expired-callback': function () {
        which.token = '';
        setShieldState(which, false, 'The browser check expired. It is refreshing…');
        if (window.turnstile && which.widgetId !== null) window.turnstile.reset(which.widgetId);
      },
    });
  }

  function renderVisibleShields() { shields.forEach(renderShield); }

  // A token is spent whether or not the request it went with succeeded, so a
  // retry needs a fresh one.
  function spendShield(which) {
    which.token = '';
    if (window.turnstile && which.widgetId !== null) {
      window.turnstile.reset(which.widgetId);
      setShieldState(which, false);
    }
  }

  function loadTurnstile() {
    if (!state.siteKey || document.getElementById('turnstile-script')) return;
    shields.forEach(function (which) { setShieldState(which, false); });
    var script = document.createElement('script');
    script.id = 'turnstile-script';
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async = true;
    script.defer = true;
    script.onload = renderVisibleShields;
    script.onerror = function () {
      shields.forEach(function (which) {
        setShieldState(which, false,
          'The browser check could not load. Check your connection or any content blockers, then reload.');
      });
    };
    document.head.appendChild(script);
    // A script that neither loads nor errors leaves the button disabled with
    // no explanation, which is its own dead end.
    setTimeout(function () {
      if (!window.turnstile) {
        shields.forEach(function (which) {
          setShieldState(which, false,
            'The browser check is taking too long to load. Reload the page, or try another browser.');
        });
      }
    }, 10000);
  }

  // Re-render every visible widget when the theme changes, so none sits in the
  // wrong palette.
  var themeBtn = document.getElementById('themebtn');
  if (themeBtn) themeBtn.addEventListener('click', function () { setTimeout(renderVisibleShields, 0); });

  /* ---------- flow ---------- */

  document.getElementById('form-email').addEventListener('submit', async function (event) {
    event.preventDefault();
    setError('email-error', '');
    var input = document.getElementById('email');
    var button = document.getElementById('email-submit');
    var email = input.value.trim();
    if (!email || email.indexOf('@') < 1) {
      setError('email-error', MESSAGES.invalid_email);
      input.focus();
      return;
    }
    busy(button, 'Sending…');
    var result = await api('/api/auth/request-code', {
      method: 'POST',
      body: JSON.stringify({ email: email, turnstileToken: signInShield.token }),
    });
    idle(button);
    spendShield(signInShield);

    if (!result.ok) {
      setError('email-error', say(result.data && result.data.error));
      return;
    }
    state.email = email;
    document.getElementById('code-email').textContent = email;
    show('code', true);
    startResendCountdown();
    if (result.data && result.data.debug_code) {
      document.getElementById('code').value = result.data.debug_code;
    }
  });

  var codeInput = document.getElementById('code');
  codeInput.addEventListener('input', function () {
    codeInput.value = codeInput.value.replace(/\D/g, '').slice(0, 6);
    setError('code-error', '');
    if (codeInput.value.length === 6) submitCode();
  });

  document.getElementById('form-code').addEventListener('submit', function (event) {
    event.preventDefault();
    submitCode();
  });

  var submitting = false;
  async function submitCode() {
    if (submitting) return;              // a double tap must never sign in twice
    var button = document.getElementById('code-submit');
    var code = codeInput.value.trim();
    if (code.length !== 6) {
      setError('code-error', MESSAGES.invalid_request);
      return;
    }
    submitting = true;
    busy(button, 'Signing you in…');
    var result = await api('/api/auth/verify', {
      method: 'POST',
      body: JSON.stringify({ email: state.email, code: code }),
    });
    submitting = false;
    idle(button);
    if (!result.ok) {
      setError('code-error', say(result.data && result.data.error));
      codeInput.select();
      return;
    }
    enterAccount(result.data.email);
  }

  var resendTimer = null;
  function startResendCountdown() {
    var button = document.getElementById('resend');
    var left = 30;
    button.disabled = true;
    clearInterval(resendTimer);
    var tick = function () {
      button.textContent = left > 0 ? 'Send another code in ' + left + 's' : 'Send another code';
      if (left <= 0) { button.disabled = false; clearInterval(resendTimer); }
      left -= 1;
    };
    tick();
    resendTimer = setInterval(tick, 1000);
  }

  document.getElementById('resend').addEventListener('click', async function () {
    var button = document.getElementById('resend');
    busy(button, 'Sending…');
    var result = await api('/api/auth/request-code', {
      method: 'POST',
      body: JSON.stringify({ email: state.email, turnstileToken: signInShield.token }),
    });
    idle(button);
    if (!result.ok) {
      setError('code-error', say(result.data && result.data.error));
      return;
    }
    startResendCountdown();
  });

  document.getElementById('change-email').addEventListener('click', function () {
    codeInput.value = '';
    setError('code-error', '');
    show('email', true);
    renderVisibleShields();
  });

  function enterAccount(email) {
    document.getElementById('account-email').textContent = email;
    screens.account.dataset.ready = '1';
    show('account', true);
    // The upload widget could not be measured while this screen was hidden.
    renderShield(uploadShield);
    loadHistory();
  }

  document.getElementById('signout').addEventListener('click', async function () {
    var button = document.getElementById('signout');
    busy(button, 'Signing out…');
    await api('/api/auth/logout', { method: 'POST' });
    idle(button);
    delete screens.account.dataset.ready;
    document.getElementById('email').value = '';
    codeInput.value = '';
    show('email', true);
    renderVisibleShields();
  });

  document.getElementById('delete-account').addEventListener('click', async function () {
    var confirmed = window.confirm(
      'This deletes your Atsy account and everything attached to it, immediately. It cannot be undone.\n\nDelete everything?'
    );
    if (!confirmed) return;
    var button = document.getElementById('delete-account');
    busy(button, 'Deleting…');
    var result = await api('/api/me', { method: 'DELETE' });
    idle(button);
    if (!result.ok) {
      setError('account-error', say(result.data && result.data.error));
      return;
    }
    delete screens.account.dataset.ready;
    show('email', true);
    renderVisibleShields();
    setError('email-error', '');
    document.getElementById('email').value = '';
  });


  /* ---------- upload and what a parser read ---------- */

  var UPLOAD_MESSAGES = {
    no_file: 'Choose a PDF first.',
    empty_file: 'That file is empty.',
    file_too_large: 'That file is over 5 MB. Export it again — a CV is almost always well under.',
    daily_limit: 'That is 20 scans today. The limit resets 24 hours after your first one.',
    storage_unavailable: 'Storage is not available right now, so nothing was uploaded. Try again shortly.',
    storage_failed: 'The file could not be stored, so the scan was stopped. Try again shortly.',
    invalid_upload: 'That upload did not arrive intact. Try again.',
    scan_gone: 'That scan was deleted while it was being read.',
    turnstile_failed: 'The browser check could not complete. Reload the page and try again.',
    unauthorised: 'Your session has ended. Sign in again.',
  };

  var bytes = function (count) {
    if (count < 1024) return count + ' B';
    if (count < 1024 * 1024) return Math.round(count / 1024) + ' kB';
    return (count / (1024 * 1024)).toFixed(1) + ' MB';
  };

  var fileInput = document.getElementById('file');
  var dropZone = document.getElementById('drop');

  if (fileInput && dropZone) {
    var showChosen = function () {
      var node = document.getElementById('drop-file');
      var chosen = fileInput.files && fileInput.files[0];
      node.textContent = chosen ? chosen.name + ' — ' + bytes(chosen.size) : '';
      node.hidden = !chosen;
      setError('upload-error', '');
    };
    fileInput.addEventListener('change', showChosen);

    ['dragenter', 'dragover'].forEach(function (name) {
      dropZone.addEventListener(name, function (event) {
        event.preventDefault();
        dropZone.classList.add('is-over');
      });
    });
    ['dragleave', 'drop'].forEach(function (name) {
      dropZone.addEventListener(name, function () { dropZone.classList.remove('is-over'); });
    });
    dropZone.addEventListener('drop', function (event) {
      event.preventDefault();
      var dropped = event.dataTransfer && event.dataTransfer.files;
      if (dropped && dropped.length) {
        fileInput.files = dropped;
        showChosen();
      }
    });
  }

  // --- the results screen -------------------------------------------------

  var BAND_LEDE = {
    excellent: 'This CV comes through machine reading intact. What is left is polish.',
    strong: 'A machine can read this. A few fixes would move it into the top band.',
    work: 'A machine is losing part of this CV. The fixes below are worth real points.',
    risk: 'Most systems will read this badly or not at all. Start at the top of the list.',
  };
  var SEVERITY_WORD = { critical: 'Critical', major: 'Major', minor: 'Minor' };

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function renderScore(result, scan) {
    var dial = document.getElementById('score-dial');
    // Set through the CSSOM, not a style attribute: the page's own CSP forbids
    // inline styles, and rightly so (incident 39).
    dial.style.setProperty('--pct', String(result.score));
    dial.setAttribute('data-band', result.band);
    dial.setAttribute('role', 'img');
    dial.setAttribute('aria-label', result.score + ' out of 100 — ' + result.band);
    document.getElementById('score-number').textContent = String(result.score);

    var bandLabel = { excellent: 'Excellent', strong: 'Strong', work: 'Needs work', risk: 'At risk' };
    document.getElementById('score-band').textContent = bandLabel[result.band] || '—';
    document.getElementById('score-lede').textContent = BAND_LEDE[result.band] || '';
    document.getElementById('score-file').textContent = scan.filename + ' · ' + bytes(scan.file_bytes)
      + ' · ' + scan.page_count + (scan.page_count === 1 ? ' page' : ' pages');

    var cap = document.getElementById('score-cap');
    if (result.caps && result.caps.length) {
      cap.textContent = 'Your score is capped at ' + result.score + ' because '
        + result.caps.map(function (c) { return c.title.toLowerCase(); }).join(' and ')
        + '. Without that cap it would have scored ' + result.rawScore
        + '. Fix it and the rest of your score becomes visible.';
      cap.hidden = false;
    } else {
      cap.hidden = true;
    }
  }

  function renderPillars(result) {
    var list = document.getElementById('pillar-list');
    list.textContent = '';
    result.pillars.forEach(function (pillar) {
      var share = pillar.weight ? pillar.score / pillar.weight : 1;
      var percent = share * 100;
      var band = percent >= 90 ? 'excellent'
        : (percent >= 75 ? 'strong' : (percent >= 60 ? 'work' : 'risk'));
      var item = el('li');
      var row = el('div', 'pillarrow');
      var name = el('b', null, pillar.name);
      var num = el('span', 'pillarnum', pillar.score + ' / ' + pillar.weight);
      row.appendChild(name);
      row.appendChild(num);
      var bar = el('div', 'pillarbar');
      bar.setAttribute('data-band', band);
      var fill = el('span');
      fill.style.width = Math.round(share * 100) + '%';
      bar.appendChild(fill);
      var why = el('p', 'fineprint', pillar.question);
      item.appendChild(row);
      item.appendChild(bar);
      item.appendChild(why);
      list.appendChild(item);
    });
  }

  function fixCard(finding, number) {
    var item = el('li');
    // The X-ray marks each finding on the page with this number and links back
    // to this card, so both have to agree — and the id has to exist even when
    // the card is inside the folded-away "smaller things" list.
    item.id = 'fix-' + finding.id;
    var head = el('div', 'fixhead');
    if (number) head.appendChild(el('b', 'fixpin', String(number)));
    var chip = el('span', 'chip', SEVERITY_WORD[finding.severity] || finding.severity);
    chip.setAttribute('data-severity', finding.severity);
    head.appendChild(chip);
    head.appendChild(el('span', 'fixtitle', finding.title));
      head.appendChild(el('span', 'fixcost', finding.fatal
        ? 'caps your score'
        : (finding.points === 1 ? '1 point' : finding.points + ' points')));
    item.appendChild(head);
    item.appendChild(el('p', null, finding.message));
    if (finding.evidence.length) {
      var ev = el('ul', 'fixev');
      finding.evidence.forEach(function (piece) {
        ev.appendChild(el('li', null, 'page ' + piece.page + ' — ' + piece.text));
      });
      item.appendChild(ev);
    }
    return item;
  }

  function renderFixes(result) {
    var list = document.getElementById('fix-list');
    var none = document.getElementById('fix-none');
    var minorFold = document.getElementById('fix-minor-fold');
    var minorList = document.getElementById('fix-minor');
    var minorCount = document.getElementById('fix-minor-count');
    list.textContent = '';
    minorList.textContent = '';
    none.hidden = result.findings.length > 0;

    // The things worth real points are shown; the one-pointers are folded
    // away. Eleven full-width cards is six screens of scrolling, and burying
    // the critical fix under a pile of polish is how a reader gives up.
    var worthPoints = result.findings.filter(function (f) { return f.severity !== 'minor'; });
    var polish = result.findings.filter(function (f) { return f.severity === 'minor'; });

    // Numbered across the whole list rather than per fold, so a mark on the
    // X-ray reading "7" finds card 7 whichever list it ended up in.
    var numberOf = function (finding) { return result.findings.indexOf(finding) + 1; };

    worthPoints.forEach(function (finding) {
      var card = fixCard(finding, numberOf(finding));
      attachRewrite(card, finding);
      list.appendChild(card);
    });
    polish.forEach(function (finding) {
      var card = fixCard(finding, numberOf(finding));
      attachRewrite(card, finding);
      minorList.appendChild(card);
    });

    minorFold.hidden = polish.length === 0;
    minorCount.textContent = polish.length === 1
      ? 'One smaller thing'
      : polish.length + ' smaller things';
    if (!worthPoints.length && polish.length) {
      none.textContent = 'Nothing serious. Only the smaller things below.';
      none.hidden = false;
    } else {
      none.textContent = 'Nothing to fix. This CV came through cleanly.';
    }
  }

  function renderEngines(result) {
    var list = document.getElementById('engine-list');
    list.textContent = '';
    result.engines.forEach(function (engine) {
      var item = el('li');
      var head = el('div', 'enginehead');
      head.appendChild(el('span', 'enginename', engine.name));
      var risk = el('span', 'risk', engine.band + ' risk');
      risk.setAttribute('data-band', engine.band);
      head.appendChild(risk);
      item.appendChild(head);
      item.appendChild(el('p', null, engine.reasons.length
        ? 'Because ' + engine.reasons.join(', and ') + '.'
        : 'Nothing in this CV is a known problem for this parser.'));
      list.appendChild(item);
    });
    document.getElementById('engine-disclaimer').textContent = result.engineDisclaimer || '';
  }

  function renderMachineView(machine) {
    var box = document.getElementById('machine-view');
    box.textContent = '';
    if (!machine || !machine.lines.length) {
      box.appendChild(el('p', 'foldnote', 'Nothing was extracted from this file.'));
      return;
    }
    machine.lines.forEach(function (line) {
      box.appendChild(el('div', 'mline', line.text));
    });
    if (machine.truncated) {
      box.appendChild(el('p', 'foldnote', 'Showing the first ' + machine.lines.length + ' pieces of text.'));
    }
  }

  // The facts worth showing, in the order they matter to whether a CV survives
  // a parser. Each row carries its own verdict, so a number the reader cannot
  // interpret is never shown on its own.
  function readingRows(model) {
    var layout = model.layout;
    var sections = model.sections;
    var entities = model.entities;
    var missing = sections.missingRequired;
    return [
      ['Pages', model.pages.count + (model.pages.truncated ? ' (only 10 were read)' : ''),
        model.pages.count <= 2 ? 'is-good' : 'is-warn'],
      // A real one-page CV runs to a few thousand characters. Showing a low
      // count in green would be a reassuring colour on a bad fact, which is
      // the one thing this panel must never do.
      ['Text a parser can read', model.text.characters.toLocaleString() + ' characters',
        model.text.characters >= 1500 ? 'is-good' : (model.text.characters >= 600 ? 'is-warn' : 'is-bad')],
      ['Columns', layout.multiColumn ? 'more than one' : 'one',
        layout.multiColumn ? 'is-bad' : 'is-good'],
      // The measurement is "does the stored text order follow a top-to-bottom
      // sweep of the page". On a two-column CV that sweep runs across the
      // gutter, so a high number means the two columns interleave — the
      // opposite of reassuring. Say which it is rather than showing a green
      // percentage next to a red column count.
      ['Text order on the page',
        Math.round(layout.worstReadingOrder * 100) + '%'
          + (layout.multiColumn ? ' — but the columns interleave' : ''),
        layout.multiColumn ? 'is-bad'
          : (layout.worstReadingOrder > 0.9 ? 'is-good'
            : (layout.worstReadingOrder > 0.7 ? 'is-warn' : 'is-bad'))],
      ['Sections found', sections.found.length ? sections.found.join(', ') : 'none',
        missing.length ? 'is-bad' : 'is-good'],
      ['Sections missing', missing.length ? missing.join(', ') : 'none',
        missing.length ? 'is-bad' : 'is-good'],
      ['Roles with dates', entities.datedRoleCount + ' of ' + entities.roleCount,
        entities.roleCount && entities.datedRoleCount === entities.roleCount ? 'is-good' : 'is-warn'],
      ['Achievement lines', String(entities.bulletCount),
        entities.bulletCount >= 6 ? 'is-good' : 'is-warn'],
      ['Date formats', entities.mixedDateFormats ? 'more than one' : 'consistent',
        entities.mixedDateFormats ? 'is-warn' : 'is-good'],
      ['Newest role first', entities.reverseChronological ? 'yes' : 'no',
        entities.reverseChronological ? 'is-good' : 'is-warn'],
      ['Contact details', [
        entities.hasEmail ? 'email' : null,
        entities.hasPhone ? 'phone' : null,
        entities.hasLink ? 'a link' : null,
      ].filter(Boolean).join(', ') || 'none found',
      entities.hasEmail && entities.hasPhone ? 'is-good' : 'is-bad'],
      ['Tables in the layout', layout.hasTable ? 'yes' : 'no', layout.hasTable ? 'is-warn' : 'is-good'],
      ['Text hidden from the reader', model.text.invisibleTextRuns + model.text.backgroundColourTextRuns
        ? 'yes — this is what gets a CV rejected' : 'none',
      model.text.invisibleTextRuns + model.text.backgroundColourTextRuns ? 'is-bad' : 'is-good'],
    ];
  }

  function renderFacts(model) {
    var list = document.getElementById('read-facts');
    list.textContent = '';
    readingRows(model).forEach(function (row) {
      var wrap = document.createElement('div');
      // Keyed so a test can select one row exactly. Two rows mentioning
      // "columns" made a substring selector match both.
      wrap.dataset.fact = row[0];
      var term = document.createElement('dt');
      term.textContent = row[0];
      var value = document.createElement('dd');
      value.textContent = row[1];
      if (row[2]) value.className = row[2];
      wrap.appendChild(term);
      wrap.appendChild(value);
      list.appendChild(wrap);
    });
  }

  /**
   * Paint the whole results screen from one scan.
   *
   * `machine` and the identity block only exist on a scan the browser just
   * uploaded — neither is stored — so re-opening a scan from history shows the
   * score and the findings without them, and says so rather than rendering an
   * empty panel.
   */
  function renderResult(scan) {
    currentScanId = scan.id;
    var result = scan.result;
    if (!result) {
      setError('result-error', 'This scan could not be read.');
      return;
    }
    // Kept in the browser only, and sent back solely so the Worker can strip
    // it out of a bullet before any model sees it. It was never stored.
    lastIdentity = scan.identity
      ? {
        name: scan.identity.name,
        employers: scan.identity.employers || [],
      }
      : lastIdentity;

    renderScore(result, scan);
    renderPillars(result);
    renderFixes(result);
    renderEngines(result);
    renderFacts(scan.model);

    var machineFold = document.getElementById('machine-view').closest('.fold');
    if (scan.machineView) {
      renderMachineView(scan.machineView);
      machineFold.hidden = false;
    } else {
      machineFold.hidden = true;
    }

    var link = document.getElementById('read-download');
    link.href = '/api/scans/' + scan.id + '/file';
    link.hidden = !scan.file_available;

    // The X-ray needs the file itself, so it is offered on exactly the same
    // terms as the download above: while the stored copy still exists.
    if (window.AtsyXray) {
      window.AtsyXray.mount({
        scanId: scan.id,
        findings: result.findings,
        sizes: (scan.model && scan.model.pages && scan.model.pages.sizes) || [],
        fileAvailable: !!scan.file_available,
      });
    }

    // The report outlives the file: it is built from the findings, which are
    // kept for 30 days after the PDF is deleted.
    document.getElementById('read-report').href = '/api/scans/' + scan.id + '/report';

    // Role Fit re-reads the CV, so it is only offered while the file exists.
    document.getElementById('match-result').hidden = true;
    document.getElementById('jd').value = '';
    var matchCard = document.getElementById('form-match').closest('.card');
    matchCard.hidden = !scan.file_available;

    setError('result-error', '');
    setError('match-error', '');
    show('result', true);
  }

  async function loadHistory() {
    var result = await api('/api/scans', { method: 'GET' });
    var card = document.getElementById('card-history');
    if (!card) return;
    var scans = (result.ok && result.data && result.data.scans) || [];
    var list = document.getElementById('history-list');
    list.textContent = '';
    scans.forEach(function (scan) {
      var item = document.createElement('li');
      var when = new Date(scan.created_at * 1000).toLocaleDateString(undefined, {
        day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
      });
      if (scan.status !== 'complete') {
        item.textContent = scan.filename + ' — could not be read — ' + when;
        list.appendChild(item);
        return;
      }
      // A past scan is worth re-opening: the score and the fix list outlive
      // the file by 29 days, and comparing a re-scan is the point of history.
      var open = document.createElement('button');
      open.type = 'button';
      open.className = 'linkbtn';
      // The delta is the answer to the only question a second scan asks.
      var move = scan.delta === null || scan.delta === 0
        ? ''
        : ' (' + (scan.delta > 0 ? '+' : '') + scan.delta + ')';
      open.textContent = scan.filename + ' — ' + scan.score + '/100' + move + ' — ' + when;
      open.addEventListener('click', function () { openScan(scan.id); });
      item.appendChild(open);
      list.appendChild(item);
    });
    var progress = document.getElementById('history-progress');
    if (result.ok && result.data && result.data.progress) {
      var p = result.data.progress;
      progress.textContent = p.change > 0
        ? 'Across ' + p.scans + ' scans you have gone from ' + p.first + ' to ' + p.latest
          + ' — up ' + p.change + ' points.'
        : (p.change < 0
          ? 'Your latest scan is ' + Math.abs(p.change) + ' points below your first ('
            + p.first + ' to ' + p.latest + '). Open the two and compare the fix lists.'
          : 'Across ' + p.scans + ' scans your score has not moved from ' + p.latest + '.');
      progress.hidden = false;
    } else {
      progress.hidden = true;
    }

    card.hidden = scans.length === 0;
  }

  var uploadForm = document.getElementById('form-upload');
  if (uploadForm) {
    uploadForm.addEventListener('submit', async function (event) {
      event.preventDefault();
      setError('upload-error', '');
      var button = document.getElementById('upload-submit');
      var chosen = fileInput.files && fileInput.files[0];
      if (!chosen) {
        setError('upload-error', UPLOAD_MESSAGES.no_file);
        fileInput.focus();
        return;
      }
      // Checked here as well as in the Worker so nobody spends a minute
      // uploading a file that was always going to be refused.
      if (chosen.size > state.maxUploadBytes) {
        setError('upload-error', UPLOAD_MESSAGES.file_too_large);
        return;
      }

      var body = new FormData();
      body.set('file', chosen);
      body.set('turnstileToken', uploadShield.token);

      busy(button, 'Reading your CV…');
      var response = await fetch('/api/scans', {
        method: 'POST', body: body, credentials: 'same-origin',
      });
      var data = null;
      try { data = await response.json(); } catch (e) { data = null; }
      idle(button);
      spendShield(uploadShield);

      if (!response.ok) {
        // An unreadable PDF comes back with a message written for the reader,
        // which is always better than anything this file could say about it.
        var message = (data && data.message)
          || UPLOAD_MESSAGES[data && data.error]
          || 'That CV could not be scanned. Try again.';
        setError('upload-error', message);
        currentScanId = null;
        loadHistory();
        return;
      }
      renderResult(data.scan);
      loadHistory();
    });
  }

  async function openScan(id) {
    var result = await api('/api/scans/' + id, { method: 'GET' });
    if (!result.ok || !result.data || !result.data.scan) {
      setError('upload-error', say(result.data && result.data.error));
      return;
    }
    renderResult(result.data.scan);
  }

  var backBtn = document.getElementById('result-back');
  if (backBtn) backBtn.addEventListener('click', function () { show('account', true); });

  var againBtn = document.getElementById('scan-another');
  if (againBtn) {
    againBtn.addEventListener('click', function () {
      // A fresh upload needs a fresh bot-check token, and the file input still
      // holds the last file.
      fileInput.value = '';
      var chosen = document.getElementById('drop-file');
      chosen.textContent = '';
      chosen.hidden = true;
      show('account', true);
      renderShield(uploadShield);
    });
  }

  var deleteScanBtn = document.getElementById('read-delete');
  if (deleteScanBtn) {
    deleteScanBtn.addEventListener('click', async function () {
      if (!currentScanId) return;
      var confirmed = window.confirm(
        'This deletes this scan and the stored copy of your CV immediately. It cannot be undone.\n\nDelete this scan?'
      );
      if (!confirmed) return;
      busy(deleteScanBtn, 'Deleting…');
      var result = await api('/api/scans/' + currentScanId, { method: 'DELETE' });
      idle(deleteScanBtn);
      if (!result.ok) {
        setError('result-error', say(result.data && result.data.error));
        return;
      }
      currentScanId = null;
      loadHistory();
      show('account', true);
    });
  }


  /* ---------- role fit ---------- */

  var lastIdentity = null;

  function renderFit(fit, note) {
    document.getElementById('fit-number').textContent = String(fit.score);

    // A low score because the CV is a weak match, and a low score because the
    // CV could not be read, are completely different messages. Saying the
    // second one first is the difference between useful and misleading.
    var unreadable = document.getElementById('fit-unreadable');
    if (!fit.reliable) {
      unreadable.textContent = 'Treat this number with care: ' + fit.unreadable.join(', and ')
        + '. That is a layout problem, not a match problem — fix the items in the list above and'
        + ' run this again, because right now a machine cannot see most of your CV.';
      unreadable.hidden = false;
    } else {
      unreadable.hidden = true;
    }

    var cap = document.getElementById('fit-cap');
    if (fit.capped) {
      cap.textContent = 'Capped at ' + fit.score + ' because ' + fit.capReasons.join(', and ')
        + '. Atsy will not help a CV game a parser in a way the person reading it would catch.';
      cap.hidden = false;
    } else {
      cap.hidden = true;
    }

    var parts = document.getElementById('fit-components');
    parts.textContent = '';
    fit.components.forEach(function (part) {
      var share = part.weight ? part.score / part.weight : 0;
      var percent = share * 100;
      var band = percent >= 90 ? 'excellent'
        : (percent >= 75 ? 'strong' : (percent >= 60 ? 'work' : 'risk'));
      var item = el('li');
      var row = el('div', 'pillarrow');
      row.appendChild(el('b', null, part.name));
      row.appendChild(el('span', 'pillarnum', part.score + ' / ' + part.weight));
      var bar = el('div', 'pillarbar');
      bar.setAttribute('data-band', band);
      var fill = el('span');
      fill.style.width = Math.round(percent) + '%';
      bar.appendChild(fill);
      item.appendChild(row);
      item.appendChild(bar);
      parts.appendChild(item);
    });

    var missing = document.getElementById('fit-missing');
    missing.textContent = '';
    document.getElementById('fit-nomissing').hidden = fit.missing.length > 0;
    fit.missing.forEach(function (skill) {
      missing.appendChild(el('li', null,
        skill.name + (skill.mustHave ? ' — listed as required' : ' — nice to have')));
    });

    // Only quote the tenure comparison when the tenure was actually readable:
    // "your CV shows about 0" for a CV whose dates could not be parsed is a
    // statement about Atsy, dressed up as a statement about the reader.
    var extra = (fit.askedYears !== null && fit.heldYears > 0)
      ? ' The advert asks for ' + fit.askedYears + ' years; your CV shows about ' + fit.heldYears + '.'
      : '';
    document.getElementById('fit-note').textContent = note + extra;
    document.getElementById('match-result').hidden = false;
  }

  var matchForm = document.getElementById('form-match');
  if (matchForm) {
    matchForm.addEventListener('submit', async function (event) {
      event.preventDefault();
      setError('match-error', '');
      var button = document.getElementById('match-submit');
      var jd = document.getElementById('jd').value.trim();
      if (jd.length < 60) {
        setError('match-error', 'Paste the whole advert — a line or two is not enough to match against.');
        return;
      }
      if (!currentScanId) {
        setError('match-error', 'Scan a CV first.');
        return;
      }
      busy(button, 'Matching…');
      var result = await api('/api/scans/' + currentScanId + '/match', {
        method: 'POST',
        body: JSON.stringify({ jobDescription: jd }),
      });
      idle(button);
      if (!result.ok) {
        setError('match-error', MATCH_MESSAGES[result.data && result.data.error]
          || say(result.data && result.data.error));
        return;
      }
      renderFit(result.data.fit, result.data.note);
    });
  }

  var MATCH_MESSAGES = {
    job_description_too_short: 'Paste the whole advert — a line or two is not enough to match against.',
    job_description_too_long: 'That is longer than any job advert needs to be. Paste the role and its requirements.',
    file_purged: 'Role Fit needs to re-read your CV, and the stored copy was deleted 24 hours after you uploaded it. Upload it again to match it against a job.',
    taxonomy_unavailable: 'The skills list is unavailable right now, so a match would be misleading. Try again shortly.',
  };

  /* ---------- rewrites ---------- */

  var REWRITABLE = ['D02', 'D03', 'D04', 'D06'];

  function attachRewrite(item, finding) {
    if (REWRITABLE.indexOf(finding.id) < 0) return;
    var bullets = finding.evidence
      .map(function (piece) { return piece.text; })
      .filter(function (text) { return text && text.split(/\s+/).length >= 4; });
    if (!bullets.length) return;

    var wrap = el('div', 'rewrite');
    var button = el('button', 'btn btn-quiet', 'Suggest a rewrite');
    button.type = 'button';
    var output = el('div');
    wrap.appendChild(button);
    wrap.appendChild(output);
    item.appendChild(wrap);

    button.addEventListener('click', async function () {
      busy(button, 'Writing…');
      var result = await api('/api/scans/' + currentScanId + '/rewrite', {
        method: 'POST',
        body: JSON.stringify({
          bullets: bullets.slice(0, 3).map(function (text) {
            return { text: text, checkId: finding.id };
          }),
          identity: lastIdentity || {},
        }),
      });
      idle(button);
      output.textContent = '';
      if (!result.ok) {
        setError('result-error', say(result.data && result.data.error));
        return;
      }
      result.data.suggestions.forEach(function (suggestion) {
        var box = el('div', 'rewritebox');
        box.appendChild(el('div', 'rewritelabel', suggestion.source === 'ai'
          ? result.data.label
          : 'How to fix it yourself'));
        box.appendChild(el('div', null, suggestion.suggestion || suggestion.guidance));
        box.appendChild(el('div', 'rewriteorig', 'Your line: ' + suggestion.original));
        if (suggestion.suggestion) {
          var copy = el('button', 'linkbtn', 'Copy');
          copy.type = 'button';
          copy.addEventListener('click', function () {
            navigator.clipboard.writeText(suggestion.suggestion).then(function () {
              copy.textContent = 'Copied';
            }, function () {
              copy.textContent = 'Select it and copy';
            });
          });
          box.appendChild(copy);
        }
        output.appendChild(box);
      });
      if (result.data.degraded && result.data.note) {
        output.appendChild(el('p', 'fineprint', result.data.note));
      }
    });
  }

  /* ---------- feedback ---------- */

  var feedbackForm = document.getElementById('form-feedback');
  if (feedbackForm) {
    feedbackForm.addEventListener('submit', async function (event) {
      event.preventDefault();
      setError('feedback-error', '');
      var ok = document.getElementById('feedback-ok');
      ok.hidden = true;
      var button = document.getElementById('feedback-submit');
      var message = document.getElementById('feedback-message').value.trim();
      if (message.length < 10) {
        setError('feedback-error', 'A sentence or two, so there is something to act on.');
        return;
      }
      busy(button, 'Sending…');
      var result = await api('/api/feedback', {
        method: 'POST',
        body: JSON.stringify({
          type: document.getElementById('feedback-type').value,
          message: message,
        }),
      });
      idle(button);
      if (!result.ok) {
        setError('feedback-error', say(result.data && result.data.error));
        return;
      }
      document.getElementById('feedback-message').value = '';
      ok.textContent = result.data.message;
      ok.hidden = false;
    });
  }

  /* ---------- boot ---------- */
  (async function boot() {
    var config = await api('/api/config', { method: 'GET' });
    state.siteKey = (config.data && config.data.turnstileSiteKey) || '';
    if (config.data && config.data.maxUploadBytes) state.maxUploadBytes = config.data.maxUploadBytes;
    loadTurnstile();

    var me = await api('/api/me', { method: 'GET' });
    if (me.ok && me.data && me.data.user) {
      enterAccount(me.data.user.email);
    } else {
      show('email', false);
      history.replaceState({ screen: 'email' }, '', location.pathname);
    }
  })();
})();
