// Enregistrement du pitch vidéo dans le navigateur (MediaRecorder).
// Débit volontairement bas (~400 kbit/s, 480p) : 90 s ≈ 5 Mo, adapté aux connexions mobiles.
(function () {
  var root = document.getElementById('recorder');
  if (!root) return;
  var MAX = Number(root.dataset.max) || 90;
  var csrf = root.dataset.csrf;
  var SCRIPT = [
    { until: 15, text: 'Qui je suis : prénom, ville, situation actuelle.' },
    { until: 60, text: 'Ce que je sais faire : compétences clés, expériences marquantes, réalisations concrètes.' },
    { until: 90, text: 'Ce que je cherche : type de poste, de contrat, disponibilité.' },
  ];
  var $ = function (id) { return document.getElementById(id); };
  var live = $('live'), preview = $('preview'), placeholder = $('placeholder'), prompter = $('prompter');
  var timer = $('timer'), bar = $('progress-bar'), statusEl = $('rec-status');
  var btn = { camera: $('btn-camera'), record: $('btn-record'), stop: $('btn-stop'), retake: $('btn-retake'), publish: $('btn-publish') };
  var stream = null, recorder = null, chunks = [], blob = null, startedAt = 0, tick = null, duration = 0;

  function show(visible) {
    Object.keys(btn).forEach(function (k) { btn[k].hidden = visible.indexOf(k) === -1; });
  }
  function fmt(s) { s = Math.floor(s); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
  function setStatus(msg) { statusEl.textContent = msg || ''; }

  function pickMime() {
    var types = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4;codecs=avc1,mp4a', 'video/mp4'];
    if (!window.MediaRecorder) return null;
    for (var i = 0; i < types.length; i++) if (MediaRecorder.isTypeSupported(types[i])) return types[i];
    return '';
  }

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || pickMime() === null) {
    show([]);
    setStatus("Votre navigateur ne permet pas d'enregistrer directement : utilisez l'envoi de vidéo ci-dessous.");
    document.querySelector('.fallback').open = true;
    return;
  }

  btn.camera.addEventListener('click', function () {
    navigator.mediaDevices
      .getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 24, max: 30 } },
        audio: { echoCancellation: true, noiseSuppression: true },
      })
      .then(function (s) {
        stream = s;
        live.srcObject = s;
        placeholder.hidden = true;
        show(['record']);
        setStatus('Prêt. Suivez la trame affichée pendant l’enregistrement.');
      })
      .catch(function () {
        setStatus("Accès à la caméra refusé. Autorisez-le dans votre navigateur ou envoyez une vidéo ci-dessous.");
      });
  });

  function update() {
    var elapsed = Math.min(MAX, (Date.now() - startedAt) / 1000);
    timer.textContent = fmt(elapsed) + ' / ' + fmt(MAX);
    bar.style.width = (elapsed / MAX) * 100 + '%';
    var step = SCRIPT.filter(function (s) { return elapsed < s.until; })[0] || SCRIPT[SCRIPT.length - 1];
    prompter.textContent = step.text;
    if (elapsed >= MAX) stop();
  }

  btn.record.addEventListener('click', function () {
    chunks = [];
    var mime = pickMime();
    var opts = { videoBitsPerSecond: 400000, audioBitsPerSecond: 48000 };
    if (mime) opts.mimeType = mime;
    try {
      recorder = new MediaRecorder(stream, opts);
    } catch (e) {
      recorder = new MediaRecorder(stream);
    }
    recorder.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
    recorder.onstop = function () {
      blob = new Blob(chunks, { type: (recorder.mimeType || 'video/webm').split(';')[0] });
      preview.src = URL.createObjectURL(blob);
      preview.hidden = false;
      live.hidden = true;
      prompter.hidden = true;
      show(['retake', 'publish']);
      setStatus('Revoyez votre pitch. Satisfait(e) ? Publiez-le. Sinon, refaites-le. (' + (blob.size / 1048576).toFixed(1) + ' Mo)');
    };
    recorder.start(1000);
    startedAt = Date.now();
    prompter.hidden = false;
    timer.hidden = false;
    show(['stop']);
    setStatus('Enregistrement en cours…');
    update();
    tick = setInterval(update, 250);
  });

  function stop() {
    if (!recorder || recorder.state === 'inactive') return;
    clearInterval(tick);
    duration = (Date.now() - startedAt) / 1000;
    recorder.stop();
  }
  btn.stop.addEventListener('click', stop);

  btn.retake.addEventListener('click', function () {
    blob = null;
    preview.hidden = true;
    preview.removeAttribute('src');
    live.hidden = false;
    bar.style.width = '0';
    timer.textContent = '0:00 / ' + fmt(MAX);
    show(['record']);
    setStatus('Prêt pour une nouvelle prise.');
  });

  btn.publish.addEventListener('click', function () {
    if (!blob) return;
    var ext = blob.type.indexOf('mp4') !== -1 ? 'mp4' : 'webm';
    var form = new FormData();
    form.append('_csrf', csrf);
    form.append('language', $('language').value);
    form.append('duration', String(Math.round(duration)));
    form.append('video', blob, 'pitch.' + ext);
    btn.publish.disabled = true;
    setStatus('Envoi en cours…');
    fetch('/profile/video', { method: 'POST', body: form, headers: { Accept: 'application/json' } })
      .then(function (res) { return res.json().then(function (body) { return { ok: res.ok, body: body }; }); })
      .then(function (r) {
        if (!r.ok) throw new Error(r.body.error || 'Erreur');
        if (stream) stream.getTracks().forEach(function (t) { t.stop(); });
        location.href = r.body.redirect;
      })
      .catch(function (err) {
        btn.publish.disabled = false;
        setStatus("L'envoi a échoué : " + err.message + ' Réessayez.');
      });
  });

  // Envoi d'un fichier : on vérifie la durée avant l'envoi.
  var fallbackForm = document.getElementById('fallback-form');
  fallbackForm.addEventListener('submit', function (e) {
    var input = fallbackForm.querySelector('input[type=file]');
    var file = input.files && input.files[0];
    if (!file || fallbackForm.dataset.checked) return;
    e.preventDefault();
    var probe = document.createElement('video');
    probe.preload = 'metadata';
    probe.onloadedmetadata = function () {
      URL.revokeObjectURL(probe.src);
      if (probe.duration > MAX + 5) {
        alert('Votre vidéo dure ' + Math.round(probe.duration) + ' secondes. Le pitch doit durer ' + MAX + ' secondes maximum.');
        return;
      }
      document.getElementById('fallback-duration').value = Math.round(probe.duration) || '';
      fallbackForm.dataset.checked = '1';
      fallbackForm.submit();
    };
    probe.onerror = function () { fallbackForm.dataset.checked = '1'; fallbackForm.submit(); };
    probe.src = URL.createObjectURL(file);
  });
})();
