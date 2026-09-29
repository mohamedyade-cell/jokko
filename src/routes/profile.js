const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const { requireLogin, verifyCsrf } = require('../auth');
const { cvUpload } = require('../upload');
const { connectionStatus } = require('./network');
const { getScore, activeBadges } = require('../score');
const { canSeeFullProfile, usage } = require('../access');
const { shortName } = require('../helpers');

const router = express.Router();

router.get('/profile/edit', requireLogin, (req, res) => {
  const db = req.app.locals.db;
  const experiences = db.prepare('SELECT * FROM experiences WHERE user_id = ? ORDER BY start_date DESC, id DESC').all(req.user.id);
  res.render('profile-edit', { title: 'Modifier mon profil', experiences, referralUrl: `${req.app.locals.config.baseUrl}/register?ref=${req.user.referral_code}`, score: getScore(db, req.user.id) });
});

router.post('/profile/edit', requireLogin, (req, res) => {
  const f = (k, max = 2000) => String(req.body[k] || '').trim().slice(0, max);
  const name = f('name', 120);
  if (!name) {
    req.session.flash = { type: 'error', message: 'Le nom est obligatoire.' };
    return res.redirect('/profile/edit');
  }
  req.app.locals.db
    .prepare('UPDATE users SET name = ?, headline = ?, location = ?, about = ?, skills = ?, phone = ?, available_now = ? WHERE id = ?')
    .run(name, f('headline', 200), f('location', 120), f('about', 5000), f('skills', 1000), f('phone', 40), req.body.available_now ? 1 : 0, req.user.id);
  req.session.flash = { type: 'success', message: 'Profil mis à jour.' };
  res.redirect(`/profile/${req.user.id}`);
});

router.post('/profile/cv', requireLogin, (req, res, next) => {
  cvUpload(req.app.locals.config.uploadDir).single('cv')(req, res, (err) => {
    if (err) return next(err);
    verifyCsrf(req, res, () => {
      if (!req.file) {
        req.session.flash = { type: 'error', message: 'Choisissez un fichier.' };
        return res.redirect('/profile/edit');
      }
      const db = req.app.locals.db;
      const previous = db.prepare('SELECT cv_path FROM users WHERE id = ?').get(req.user.id).cv_path;
      db.prepare('UPDATE users SET cv_path = ?, cv_original_name = ? WHERE id = ?').run(req.file.filename, req.file.originalname.slice(0, 200), req.user.id);
      // Un ancien CV peut encore être rattaché à une candidature : on ne le supprime que s'il est orphelin.
      if (previous && !db.prepare('SELECT 1 FROM applications WHERE cv_path = ?').get(previous)) {
        fs.rm(path.join(req.app.locals.config.uploadDir, path.basename(previous)), { force: true }, () => {});
      }
      req.session.flash = { type: 'success', message: 'CV enregistré. Il ne sera visible que des recruteurs qui débloquent votre profil.' };
      res.redirect('/profile/edit');
    });
  });
});

router.get('/profile/:id/cv', requireLogin, (req, res) => {
  const db = req.app.locals.db;
  const id = Number(req.params.id);
  const user = db.prepare('SELECT cv_path, cv_original_name FROM users WHERE id = ?').get(id);
  if (!user || !user.cv_path || !canSeeFullProfile(db, req.user, id)) {
    return res.status(404).render('error', { title: 'CV indisponible', message: "Ce CV n'est accessible qu'après déblocage." });
  }
  res.download(path.join(req.app.locals.config.uploadDir, path.basename(user.cv_path)), user.cv_original_name || 'cv');
});

router.post('/profile/experiences', requireLogin, (req, res) => {
  const f = (k, max = 200) => String(req.body[k] || '').trim().slice(0, max);
  if (!f('title') || !f('company')) {
    req.session.flash = { type: 'error', message: 'Intitulé et entreprise sont obligatoires.' };
  } else {
    req.app.locals.db
      .prepare('INSERT INTO experiences (user_id, title, company, start_date, end_date, description) VALUES (?, ?, ?, ?, ?, ?)')
      .run(req.user.id, f('title'), f('company'), f('start_date', 20), f('end_date', 20), f('description', 3000));
  }
  res.redirect('/profile/edit');
});

router.post('/profile/experiences/:id/delete', requireLogin, (req, res) => {
  req.app.locals.db.prepare('DELETE FROM experiences WHERE id = ? AND user_id = ?').run(Number(req.params.id), req.user.id);
  res.redirect('/profile/edit');
});

router.get('/profile/:id', requireLogin, (req, res) => {
  const db = req.app.locals.db;
  const profile = db
    .prepare('SELECT u.*, c.name AS company_name FROM users u LEFT JOIN companies c ON c.id = u.company_id WHERE u.id = ?')
    .get(Number(req.params.id));
  if (!profile) return res.status(404).render('error', { title: 'Profil introuvable', message: "Ce membre n'existe pas." });

  const isCandidate = profile.role === 'candidate';
  // Côté candidat, le « CV complet » (coordonnées, fichier CV) est réservé aux recruteurs qui l'ont débloqué.
  // Les recruteurs ne voient que la carte (pitch, badges, score) avant déblocage.
  const full = !isCandidate || canSeeFullProfile(db, req.user, profile.id);
  const showExperiences = full || req.user.role === 'candidate';

  const experiences = showExperiences ? db.prepare('SELECT * FROM experiences WHERE user_id = ? ORDER BY start_date DESC, id DESC').all(profile.id) : [];
  const posts = db.prepare('SELECT * FROM posts WHERE author_id = ? ORDER BY created_at DESC, id DESC LIMIT 10').all(profile.id);
  const connectionsCount = db
    .prepare("SELECT COUNT(*) AS n FROM connections WHERE status = 'accepted' AND (requester_id = ?1 OR addressee_id = ?1)")
    .get(profile.id).n;
  const relation = profile.id === req.user.id ? 'self' : connectionStatus(db, req.user.id, profile.id);
  const score = isCandidate ? getScore(db, profile.id) : null;
  const badges = isCandidate ? activeBadges(db, profile.id)[profile.id] : [];

  let unlockJobs = [];
  let recruiterUsage = null;
  if (isCandidate && !full && req.user.role === 'recruiter') {
    unlockJobs = db.prepare("SELECT id, title FROM jobs WHERE company_id = ? AND status = 'open' ORDER BY created_at DESC").all(req.user.company_id);
    recruiterUsage = usage(db, req.user.company_id);
  }

  res.render('profile', {
    title: full ? profile.name : shortName(profile.name),
    profile,
    full,
    experiences,
    showExperiences,
    posts,
    connectionsCount,
    relation,
    score,
    badges,
    unlockJobs,
    recruiterUsage,
  });
});

module.exports = router;
