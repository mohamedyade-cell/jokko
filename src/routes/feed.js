const express = require('express');
const { requireLogin } = require('../auth');
const { getScore } = require('../score');

const router = express.Router();

router.get('/', (req, res) => {
  const db = req.app.locals.db;
  const latestJobs = db
    .prepare(
      `SELECT j.id, j.title, j.location, j.contract_type, j.remote, j.created_at, c.name AS company_name
       FROM jobs j JOIN companies c ON c.id = j.company_id
       WHERE j.status = 'open' ORDER BY j.created_at DESC, j.id DESC LIMIT 5`,
    )
    .all();

  if (!req.user) {
    const stats = {
      jobs: db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE status = 'open'").get().n,
      companies: db.prepare('SELECT COUNT(*) AS n FROM companies').get().n,
      members: db.prepare('SELECT COUNT(*) AS n FROM users').get().n,
    };
    return res.render('home', { title: 'Jokko', latestJobs, stats });
  }

  // Fil : mes publications + celles de mes relations.
  const posts = db
    .prepare(
      `SELECT p.*, u.name AS author_name, u.headline AS author_headline
       FROM posts p JOIN users u ON u.id = p.author_id
       WHERE p.author_id = ?1
          OR p.author_id IN (
            SELECT CASE WHEN requester_id = ?1 THEN addressee_id ELSE requester_id END
            FROM connections WHERE status = 'accepted' AND (requester_id = ?1 OR addressee_id = ?1))
       ORDER BY p.created_at DESC, p.id DESC LIMIT 50`,
    )
    .all(req.user.id);

  res.render('feed', { title: 'Fil d’actualité', posts, latestJobs, score: getScore(db, req.user.id) });
});

router.post('/posts', requireLogin, (req, res) => {
  const content = (req.body.content || '').trim();
  if (!content) {
    req.session.flash = { type: 'error', message: 'La publication ne peut pas être vide.' };
  } else {
    req.app.locals.db.prepare('INSERT INTO posts (author_id, content) VALUES (?, ?)').run(req.user.id, content.slice(0, 3000));
  }
  res.redirect('/');
});

router.post('/posts/:id/delete', requireLogin, (req, res) => {
  req.app.locals.db.prepare('DELETE FROM posts WHERE id = ? AND author_id = ?').run(Number(req.params.id), req.user.id);
  res.redirect('/');
});

module.exports = router;
