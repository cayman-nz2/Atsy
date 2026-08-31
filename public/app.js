/* Atsy — shared page behaviour. No framework, no third-party scripts.
   Everything here degrades safely: the page is fully readable with JS off. */
(function () {
  'use strict';

  /* ---------- theme ---------- */
  var root = document.documentElement;
  var STORE = 'atsy-theme';

  function systemTheme() {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  function currentTheme() {
    return root.getAttribute('data-theme') || systemTheme();
  }
  try {
    var saved = localStorage.getItem(STORE);
    if (saved === 'dark' || saved === 'light') root.setAttribute('data-theme', saved);
  } catch (e) { /* private mode: fall back to the system theme */ }

  var themeBtn = document.getElementById('themebtn');
  if (themeBtn) {
    var paint = function () {
      var next = currentTheme() === 'dark' ? 'light' : 'dark';
      themeBtn.textContent = next === 'dark' ? 'Dark' : 'Light';
      themeBtn.setAttribute('aria-label', 'Switch to ' + next + ' theme');
    };
    themeBtn.addEventListener('click', function () {
      var next = currentTheme() === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      try { localStorage.setItem(STORE, next); } catch (e) { /* ignore */ }
      paint();
    });
    paint();
  }

  /* ---------- machine-view toggle ---------- */
  var paperBtn = document.getElementById('btn-paper');
  var machineBtn = document.getElementById('btn-machine');
  var paperView = document.getElementById('view-paper');
  var machineView = document.getElementById('view-machine');

  if (paperBtn && machineBtn && paperView && machineView) {
    var show = function (which) {
      var machine = which === 'machine';
      paperView.classList.toggle('is-out', machine);
      machineView.classList.toggle('is-out', !machine);
      paperView.setAttribute('aria-hidden', String(machine));
      machineView.setAttribute('aria-hidden', String(!machine));
      paperBtn.setAttribute('aria-pressed', String(!machine));
      machineBtn.setAttribute('aria-pressed', String(machine));
    };
    paperBtn.addEventListener('click', function () { show('paper'); });
    machineBtn.addEventListener('click', function () { show('machine'); });
  }
})();
