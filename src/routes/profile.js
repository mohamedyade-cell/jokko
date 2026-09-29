const express = require('express');
const { requireLogin } = require('../auth');
const { connectionStatus } = require('./network');

const router = express.Router();

router.get('/profile/edit', requireLogin, (req, res) => {
  const experiences = req.app.locals.db.prepare('SELECT * FROM experiences WHERE user_id = ? ORDER BY start_date DESC, id DESC').all(req.user.id);
  res.render('profile-edit', { title: 'Modifier mon profil', experiences });
});

router.post('/profile/edit', requireLogin, (req, res) => {
  const f = (k, max = 2000) => String(req.body[k] || '').trim().slice(0, max);
  const name = f('name', 120);
  if (!name) {
    req.session.flash = { type: 'error', message: 'Le nom est obligatoire.' };
    return res.redirect('/profile/edit');
  }
  req.app.locals.db
    .prepare('UPDATE users SET name = ?, headline = ?, location = ?, about = ?, skills = ? WHERE id = ?')
    .run(name, f('headline', 200), f('location', 120), f('about', 5000), f('skills', 1000), req.user.id);
  req.session.flash = { type: 'success', message: 'Profil mis à jour.' };
  res.redirect(`/profile/${req.user.id}`);
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

  const experiences = db.prepare('SELECT * FROM experiences WHERE user_id = ? ORDER BY start_date DESC, id DESC').all(profile.id);
  const posts = db.prepare('SELECT * FROM posts WHERE author_id = ? ORDER BY created_at DESC, id DESC LIMIT 10').all(profile.id);
  const connectionsCount = db
    .prepare("SELECT COUNT(*) AS n FROM connections WHERE status = 'accepted' AND (requester_id = ?1 OR addressee_id = ?1)")
    .get(profile.id).n;
  const relation = profile.id === req.user.id ? 'self' : connectionStatus(db, req.user.id, profile.id);

  res.render('profile', { title: profile.name, profile, experiences, posts, connectionsCount, relation });
});

module.exports = router;
