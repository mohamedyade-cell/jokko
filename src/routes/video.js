const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const { requireLogin, requireRole, verifyCsrf } = require('../auth');
const { videoUpload, baseMime } = require('../upload');
const { compressVideo, MAX_SECONDS } = require('../video');
const { LANGUAGES } = require('../helpers');

const router = express.Router();

function videoDir(req) {
  return path.join(req.app.locals.config.uploadDir, 'videos');
}

function removeVideo(req, filename) {
  if (filename) fs.rm(path.join(videoDir(req), path.basename(filename)), { force: true }, () => {});
}

router.get('/profile/video', requireRole('candidate'), (req, res) => {
  res.render('video', { title: 'Mon pitch vidéo', maxSeconds: MAX_SECONDS });
});

router.post('/profile/video', requireRole('candidate'), (req, res, next) => {
  videoUpload(req.app.locals.config.uploadDir).single('video')(req, res, (err) => {
    if (err) return next(err);
    verifyCsrf(req, res, () => {
      const wantsJson = req.accepts(['html', 'json']) === 'json';
      const fail = (message) => {
        if (req.file) removeVideo(req, req.file.filename);
        if (wantsJson) return res.status(400).json({ error: message });
        req.session.flash = { type: 'error', message };
        return res.redirect('/profile/video');
      };
      if (!req.file) return fail('Aucune vidéo reçue.');
      const language = LANGUAGES[req.body.language] ? req.body.language : 'fr';
      const duration = Number(req.body.duration);
      // La durée est contrôlée côté navigateur ; on refuse une durée déclarée trop longue.
      if (Number.isFinite(duration) && duration > MAX_SECONDS + 5) return fail(`Le pitch doit durer ${MAX_SECONDS} secondes maximum.`);

      const db = req.app.locals.db;
      const previous = db.prepare('SELECT video_path FROM users WHERE id = ?').get(req.user.id).video_path;
      const save = (filename, mime) => {
        db.prepare("UPDATE users SET video_path = ?, video_mime = ?, video_language = ?, video_updated_at = datetime('now') WHERE id = ?").run(filename, mime, language, req.user.id);
      };
      save(req.file.filename, baseMime(req.file.mimetype));
      if (previous && previous !== req.file.filename) removeVideo(req, previous);

      // Compression en arrière-plan : la version légère remplace l'originale dès qu'elle est prête.
      const uploaded = req.file.filename;
      compressVideo(req.file.path, (compressErr, result) => {
        if (compressErr) return console.error('Compression vidéo impossible :', compressErr.message);
        if (!result) return;
        const current = db.prepare('SELECT video_path FROM users WHERE id = ?').get(req.user.id);
        if (!current || current.video_path !== uploaded) return removeVideo(req, result.filename);
        db.prepare('UPDATE users SET video_path = ?, video_mime = ? WHERE id = ?').run(result.filename, result.mime, req.user.id);
        removeVideo(req, uploaded);
      });

      if (wantsJson) return res.json({ ok: true, redirect: `/profile/${req.user.id}` });
      req.session.flash = { type: 'success', message: 'Pitch vidéo publié ! Il apparaît maintenant sur votre carte profil.' };
      res.redirect(`/profile/${req.user.id}`);
    });
  });
});

router.post('/profile/video/delete', requireRole('candidate'), (req, res) => {
  const db = req.app.locals.db;
  const current = db.prepare('SELECT video_path FROM users WHERE id = ?').get(req.user.id).video_path;
  db.prepare('UPDATE users SET video_path = NULL, video_mime = NULL, video_language = NULL, video_updated_at = NULL WHERE id = ?').run(req.user.id);
  removeVideo(req, current);
  req.session.flash = { type: 'success', message: 'Pitch vidéo supprimé.' };
  res.redirect('/profile/video');
});

// Le pitch est la vitrine du candidat : visible par tous les membres connectés.
router.get('/videos/:userId', requireLogin, (req, res) => {
  const user = req.app.locals.db.prepare('SELECT video_path, video_mime FROM users WHERE id = ?').get(Number(req.params.userId));
  if (!user || !user.video_path) return res.status(404).end();
  res.type(user.video_mime || 'video/webm');
  res.set('Cache-Control', 'private, max-age=3600');
  res.sendFile(path.join(videoDir(req), path.basename(user.video_path)), (err) => {
    if (err && !res.headersSent) res.status(404).end();
  });
});

module.exports = router;
