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

  var state = { email: '', turnstileToken: '', widgetId: null, siteKey: '' };

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
    turnstile_failed: 'The browser check did not pass. Try once more.',
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
       light card. ---------- */
  function currentTheme() {
    var stamped = document.documentElement.getAttribute('data-theme');
    if (stamped) return stamped;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function renderTurnstile() {
    var slot = document.getElementById('turnstile-slot');
    if (!slot || !state.siteKey || !window.turnstile) return;
    slot.textContent = '';
    state.widgetId = window.turnstile.render(slot, {
      sitekey: state.siteKey,
      theme: currentTheme(),
      callback: function (token) { state.turnstileToken = token; },
      'error-callback': function () { state.turnstileToken = ''; },
      'expired-callback': function () { state.turnstileToken = ''; },
    });
  }

  function loadTurnstile() {
    if (!state.siteKey || document.getElementById('turnstile-script')) return;
    var script = document.createElement('script');
    script.id = 'turnstile-script';
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async = true;
    script.defer = true;
    script.onload = renderTurnstile;
    document.head.appendChild(script);
  }

  // Re-render the widget when the theme changes, so it never sits in the
  // wrong palette.
  var themeBtn = document.getElementById('themebtn');
  if (themeBtn) themeBtn.addEventListener('click', function () { setTimeout(renderTurnstile, 0); });

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
      body: JSON.stringify({ email: email, turnstileToken: state.turnstileToken }),
    });
    idle(button);
    // A single-use bot-check token is spent whether or not the request
    // succeeded: reset it so a retry works.
    state.turnstileToken = '';
    if (window.turnstile && state.widgetId !== null) window.turnstile.reset(state.widgetId);

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
      body: JSON.stringify({ email: state.email, turnstileToken: state.turnstileToken }),
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
    renderTurnstile();
  });

  function enterAccount(email) {
    document.getElementById('account-email').textContent = email;
    screens.account.dataset.ready = '1';
    show('account', true);
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
    renderTurnstile();
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
    renderTurnstile();
    setError('email-error', '');
    document.getElementById('email').value = '';
  });

  /* ---------- boot ---------- */
  (async function boot() {
    var config = await api('/api/config', { method: 'GET' });
    state.siteKey = (config.data && config.data.turnstileSiteKey) || '';
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
