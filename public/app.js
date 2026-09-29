// Les vidéos WebM produites par MediaRecorder (Chrome) n'indiquent pas leur durée :
// le lecteur affiche alors une durée infinie et la barre de progression ne fonctionne pas.
// On force le navigateur à calculer la durée en se plaçant très loin, puis on revient au début.
document.addEventListener(
  'loadedmetadata',
  function (e) {
    var v = e.target;
    if (v.tagName !== 'VIDEO' || v.duration !== Infinity || v.dataset.durationFixed) return;
    v.dataset.durationFixed = '1';
    var restore = function () {
      v.removeEventListener('timeupdate', restore);
      v.currentTime = 0;
    };
    v.addEventListener('timeupdate', restore);
    v.currentTime = 1e101;
  },
  true,
);
