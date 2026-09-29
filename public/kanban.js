// Glisser-déposer des candidatures entre les colonnes du pipeline ATS.
(function () {
  var board = document.querySelector('.kanban');
  if (!board) return;
  var csrf = board.dataset.csrf;
  var dragged = null;

  function refreshCounts() {
    board.querySelectorAll('.kanban-col').forEach(function (col) {
      col.querySelector('.count').textContent = col.querySelectorAll('.kanban-card').length;
    });
  }

  board.addEventListener('dragstart', function (e) {
    var card = e.target.closest('.kanban-card');
    if (!card) return;
    dragged = card;
    card.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
  });

  board.addEventListener('dragend', function () {
    if (dragged) dragged.classList.remove('dragging');
    board.querySelectorAll('.drop-target').forEach(function (c) { c.classList.remove('drop-target'); });
    dragged = null;
  });

  board.querySelectorAll('.kanban-col').forEach(function (col) {
    col.addEventListener('dragover', function (e) {
      if (!dragged) return;
      e.preventDefault();
      col.classList.add('drop-target');
    });
    col.addEventListener('dragleave', function (e) {
      if (!col.contains(e.relatedTarget)) col.classList.remove('drop-target');
    });
    col.addEventListener('drop', function (e) {
      e.preventDefault();
      col.classList.remove('drop-target');
      if (!dragged) return;
      var card = dragged;
      var from = card.closest('.kanban-col');
      if (from === col) return;
      var stage = col.dataset.stage;
      col.querySelector('.kanban-list').prepend(card);
      card.querySelector('select[name=stage]').value = stage;
      refreshCounts();

      fetch('/ats/applications/' + card.dataset.id + '/stage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
        body: JSON.stringify({ stage: stage }),
      }).then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
      }).catch(function () {
        alert("Impossible de déplacer la candidature. La page va être rechargée.");
        location.reload();
      });
    });
  });
})();
