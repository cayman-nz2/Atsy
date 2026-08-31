/* The owner's view. Aggregates only — there is no endpoint here that returns a
   CV, a filename, or a finding's evidence, and a unit test keeps it that way. */
(function () {
  'use strict';

  var state = document.getElementById('admin-state');
  if (!state) return;

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function rows(list, pairs) {
    list.textContent = '';
    pairs.forEach(function (pair) {
      var wrap = el('div');
      wrap.appendChild(el('dt', null, pair[0]));
      wrap.appendChild(el('dd', pair[2] || null, String(pair[1])));
      list.appendChild(wrap);
    });
  }

  var when = function (seconds) {
    return new Date(seconds * 1000).toLocaleString();
  };

  async function load() {
    var response = await fetch('/api/admin/stats', { credentials: 'same-origin' });
    if (response.status === 401) {
      state.textContent = 'Sign in first.';
      return;
    }
    if (!response.ok) {
      // The endpoint answers 404 to everyone but the owner, so there is
      // nothing here to tell an ordinary visitor that they found something.
      state.textContent = 'Not found.';
      return;
    }
    var data = await response.json();

    rows(document.getElementById('admin-counts'), [
      ['People', data.users.total],
      ['New this week', data.users.newThisWeek],
      ['Scans, all time', data.scans.total],
      ['Scans today', data.scans.today],
      ['Average score', data.scans.averageScore === null ? '—' : data.scans.averageScore],
      ['Lowest / highest', (data.scans.lowestScore === null ? '—' : data.scans.lowestScore)
        + ' / ' + (data.scans.highestScore === null ? '—' : data.scans.highestScore)],
      ['Files waiting to be purged', data.scans.filesAwaitingPurge],
      ['AI neurons today', data.ai.neuronsToday],
      ['Feedback unread', data.feedback.unread, data.feedback.unread > 0 ? 'is-warn' : null],
    ]);

    rows(document.getElementById('admin-problems'), data.commonProblems.map(function (problem) {
      return [problem.id + ' ' + problem.title, problem.count + ' (' + problem.share + '%)'];
    }));

    var failures = data.scans.failures.filter(function (row) { return row.reason; });
    document.getElementById('admin-nofailures').hidden = failures.length > 0;
    rows(document.getElementById('admin-failures'), failures.map(function (row) {
      return [row.reason, row.count];
    }));

    await loadFeedback();
    state.textContent = 'As of ' + when(data.generated_at) + '.';
    document.getElementById('admin-body').hidden = false;
  }

  async function loadFeedback() {
    var response = await fetch('/api/admin/feedback', { credentials: 'same-origin' });
    if (!response.ok) return;
    var data = await response.json();
    var list = document.getElementById('admin-feedback');
    list.textContent = '';
    document.getElementById('admin-nofeedback').hidden = data.feedback.length > 0;

    data.feedback.forEach(function (item) {
      var card = el('li');
      var head = el('div', 'fixhead');
      var chip = el('span', 'chip', item.type);
      chip.setAttribute('data-severity', item.status === 'new' ? 'major' : 'minor');
      head.appendChild(chip);
      head.appendChild(el('span', 'fixtitle', item.email));
      head.appendChild(el('span', 'fixcost', when(item.created_at)));
      card.appendChild(head);

      // The message arrives HTML-escaped from the Worker. Setting it as
      // textContent is the second layer: this is a stranger's words, and it is
      // never markup and never an instruction.
      card.appendChild(el('p', null, item.message));
      if (item.resolution_note) card.appendChild(el('p', 'fineprint', 'Note: ' + item.resolution_note));

      if (item.status === 'new') {
        var done = el('button', 'btn btn-quiet', 'Mark done');
        done.type = 'button';
        done.addEventListener('click', async function () {
          done.disabled = true;
          done.textContent = 'Saving…';
          var result = await fetch('/api/admin/feedback/' + item.id, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({ status: 'done' }),
          });
          if (result.ok) loadFeedback();
          else { done.disabled = false; done.textContent = 'Mark done'; }
        });
        card.appendChild(done);
      }
      list.appendChild(card);
    });
  }

  load();
})();
