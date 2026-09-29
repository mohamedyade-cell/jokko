const express = require('express');
const path = require('node:path');
const { requireLogin } = require('../auth');
const { PLANS, transaction } = require('../db');
const { grantBadge, CERTIFICATION_POINTS, CAMPUS_POINTS } = require('../score');

const router = express.Router();

const adminOnly = [
  requireLogin,
  (req, res, next) => {
    if (!req.user.is_admin) return res.status(403).render('error', { title: 'Accès refusé', message: "Cette page est réservée à l'équipe Jokko." });
    next();
  },
];

router.get('/admin', adminOnly, (req, res) => {
  const db = req.app.locals.db;
  const pending = db
    .prepare(
      `SELECT c.*, u.name AS user_name, u.email AS user_email, s.name AS school_name
       FROM credentials c JOIN users u ON u.id = c.user_id LEFT JOIN schools s ON s.id = c.school_id
       WHERE c.status = 'pending' ORDER BY c.created_at, c.id`,
    )
    .all();
  const schools = db.prepare('SELECT s.*, (SELECT COUNT(*) FROM credentials c WHERE c.school_id = s.id AND c.status = \'verified\') AS members FROM schools s ORDER BY s.name').all();
  const companies = db.prepare('SELECT c.*, (SELECT COUNT(*) FROM jobs j WHERE j.company_id = c.id AND j.status = \'open\') AS open_jobs FROM companies c ORDER BY c.name').all();
  res.render('admin', { title: 'Administration', pending, schools, companies, PLANS });
});

router.get('/admin/credentials/:id/proof', adminOnly, (req, res) => {
  const cred = req.app.locals.db.prepare('SELECT * FROM credentials WHERE id = ?').get(Number(req.params.id));
  if (!cred || !cred.file_path) return res.status(404).render('error', { title: 'Justificatif introuvable', message: 'Aucun fichier joint.' });
  res.download(path.join(req.app.locals.config.uploadDir, 'proofs', path.basename(cred.file_path)), cred.file_original_name || 'justificatif');
});

// Vérification : la certification (ou le parcours Campus) devient un badge.
router.post('/admin/credentials/:id/:decision', adminOnly, (req, res) => {
  const db = req.app.locals.db;
  const cred = db
    .prepare("SELECT c.*, s.name AS school_name FROM credentials c LEFT JOIN schools s ON s.id = c.school_id WHERE c.id = ? AND c.status = 'pending'")
    .get(Number(req.params.id));
  if (!cred || !['verify', 'reject'].includes(req.params.decision)) return res.redirect('/admin');
  const note = String(req.body.note || '').trim().slice(0, 500);

  transaction(db, () => {
    const status = req.params.decision === 'verify' ? 'verified' : 'rejected';
    db.prepare("UPDATE credentials SET status = ?, review_note = ?, reviewed_by = ?, reviewed_at = datetime('now') WHERE id = ?").run(status, note, req.user.id, cred.id);
    if (status !== 'verified') return;
    if (cred.type === 'campus') {
      grantBadge(db, { userId: cred.user_id, kind: 'campus', skillKey: `campus:${cred.school_id}`, label: `Jokko Campus · ${cred.school_name}`, points: CAMPUS_POINTS, sourceRef: `credential:${cred.id}` });
    } else {
      grantBadge(db, {
        userId: cred.user_id,
        kind: 'certification',
        skillKey: `cert:${cred.title.toLowerCase()}`,
        label: cred.title,
        points: CERTIFICATION_POINTS,
        sourceRef: `credential:${cred.id}`,
      });
    }
  });
  req.session.flash = { type: 'success', message: req.params.decision === 'verify' ? 'Badge attribué.' : 'Demande refusée.' };
  res.redirect('/admin');
});

router.post('/admin/schools', adminOnly, (req, res) => {
  const name = String(req.body.name || '').trim().slice(0, 200);
  if (name) req.app.locals.db.prepare('INSERT OR IGNORE INTO schools (name, city) VALUES (?, ?)').run(name, String(req.body.city || '').trim().slice(0, 120));
  res.redirect('/admin');
});

router.post('/admin/companies/:id/plan', adminOnly, (req, res) => {
  if (PLANS[req.body.plan]) req.app.locals.db.prepare('UPDATE companies SET plan = ? WHERE id = ?').run(req.body.plan, Number(req.params.id));
  res.redirect('/admin');
});

module.exports = router;
