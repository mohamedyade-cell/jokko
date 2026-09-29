const express = require('express');
const bcrypt = require('bcryptjs');
const { transaction } = require('../db');

const router = express.Router();

function safeNext(next) {
  return typeof next === 'string' && next.startsWith('/') && !next.startsWith('//') ? next : '/';
}

router.get('/register', (req, res) => {
  if (req.user) return res.redirect('/');
  res.render('register', { title: 'Inscription', values: { role: req.query.role === 'recruiter' ? 'recruiter' : 'candidate' }, error: null });
});

router.post('/register', (req, res) => {
  const db = req.app.locals.db;
  const values = {
    name: (req.body.name || '').trim(),
    email: (req.body.email || '').trim().toLowerCase(),
    role: req.body.role === 'recruiter' ? 'recruiter' : 'candidate',
    headline: (req.body.headline || '').trim(),
    company_name: (req.body.company_name || '').trim(),
  };
  const password = req.body.password || '';

  let error = null;
  if (!values.name || !values.email) error = 'Nom et e-mail sont obligatoires.';
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email)) error = 'Adresse e-mail invalide.';
  else if (password.length < 8) error = 'Le mot de passe doit contenir au moins 8 caractères.';
  else if (values.role === 'recruiter' && !values.company_name) error = "Le nom de l'entreprise est obligatoire pour un recruteur.";
  else if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(values.email)) error = 'Un compte existe déjà avec cet e-mail.';

  if (error) return res.status(400).render('register', { title: 'Inscription', values, error });

  const hash = bcrypt.hashSync(password, 10);
  const userId = transaction(db, () => {
    let companyId = null;
    if (values.role === 'recruiter') {
      const existing = db.prepare('SELECT id FROM companies WHERE lower(name) = lower(?)').get(values.company_name);
      companyId = existing ? existing.id : Number(db.prepare('INSERT INTO companies (name) VALUES (?)').run(values.company_name).lastInsertRowid);
    }
    return Number(
      db
        .prepare('INSERT INTO users (email, password_hash, role, name, headline, company_id) VALUES (?, ?, ?, ?, ?, ?)')
        .run(values.email, hash, values.role, values.name, values.headline, companyId).lastInsertRowid,
    );
  });

  req.session.regenerate((err) => {
    if (err) throw err;
    req.session.userId = userId;
    req.session.flash = { type: 'success', message: `Bienvenue sur Jokko, ${values.name} !` };
    res.redirect(values.role === 'recruiter' ? '/ats' : '/profile/edit');
  });
});

router.get('/login', (req, res) => {
  if (req.user) return res.redirect('/');
  res.render('login', { title: 'Connexion', email: '', next: safeNext(req.query.next), error: null });
});

router.post('/login', (req, res) => {
  const db = req.app.locals.db;
  const email = (req.body.email || '').trim().toLowerCase();
  const next = safeNext(req.body.next);
  const user = db.prepare('SELECT id, password_hash FROM users WHERE email = ?').get(email);
  if (!user || !bcrypt.compareSync(req.body.password || '', user.password_hash)) {
    return res.status(401).render('login', { title: 'Connexion', email, next, error: 'E-mail ou mot de passe incorrect.' });
  }
  req.session.regenerate((err) => {
    if (err) throw err;
    req.session.userId = user.id;
    res.redirect(next);
  });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

module.exports = router;
