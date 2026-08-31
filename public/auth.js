/* Sign-in screens: email, code, account. Three screens in one document, with
   history entries so the phone's Back button moves between them. */
(function () {
  'use strict';

  var screens = {
    email: document.getElementById('screen-email'),
    code: document.getElementById('screen-code'),
    account: document.getElementById('screen-account'),
  };
  if (!screens.email) return;

  var state = { email: '', siteKey: '', maxUploadBytes: 5 * 1024 * 1024 };

  function show(name, push) {
    Object.keys(screens).forEach(function (key) { screens[key].hidden = key !== name; });
    document.title = (name === 'account' ? 'Your account' : 'Sign in') + ' — Atsy';
    if (push) history.pushState({ screen: name }, '', name === 'email' ? '/app' : '/app#' + name);
    var focusable = screens[name].querySelector('input, button');
    if (focusable) focusable.focus({ preventScroll: true });
  }

  window.addEventListener('popstate', function (event) {
    var name = (event.state && event.state.screen) || 'email';
    if (name === 'account' && !screens.account.dataset.ready) name = 'email';
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

  function verdictFor(model) {
    var problems = [];
    if (model.layout.multiColumn) problems.push('the columns');
    if (model.sections.missingRequired.length) problems.push('the missing sections');
    if (!model.entities.hasEmail || !model.entities.hasPhone) problems.push('the contact details');
    if (model.text.invisibleTextRuns + model.text.backgroundColourTextRuns) problems.push('the hidden text');
    if (!problems.length) {
      return 'Everything a parser needs came through cleanly. Scoring will tell you how the '
        + 'content reads; the structure is already out of the way.';
    }
    return 'Worth fixing first: ' + problems.join(', ') + '. These are structural, so they cost '
      + 'points with every system that reads this file, whatever the wording says.';
  }

  var currentScanId = null;

  function renderReading(scan) {
    currentScanId = scan.id;
    document.getElementById('read-file').textContent =
      scan.filename + ' — ' + bytes(scan.file_bytes);
    var list = document.getElementById('read-facts');
    list.textContent = '';
    readingRows(scan.model).forEach(function (row) {
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
    document.getElementById('read-verdict').textContent = verdictFor(scan.model);
    var link = document.getElementById('read-download');
    link.href = '/api/scans/' + scan.id + '/file';
    link.hidden = !scan.file_available;
    document.getElementById('card-read').hidden = false;
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
      var when = new Date(scan.created_at * 1000).toLocaleString();
      var what = scan.status === 'complete'
        ? scan.page_count + (scan.page_count === 1 ? ' page' : ' pages')
        : 'could not be read';
      item.textContent = scan.filename + ' — ' + what + ' — ' + when
        + (scan.file_available ? '' : ' — file deleted');
      list.appendChild(item);
    });
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
        document.getElementById('card-read').hidden = true;
        loadHistory();
        return;
      }
      renderReading(data.scan);
      loadHistory();
      document.getElementById('card-read').scrollIntoView({ behavior: 'smooth', block: 'start' });
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
        setError('upload-error', say(result.data && result.data.error));
        return;
      }
      currentScanId = null;
      document.getElementById('card-read').hidden = true;
      loadHistory();
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
