const express = require('express');
const fs = require('node:fs');
const { requireLogin, requireRole, verifyCsrf } = require('../auth');
const { cvUpload } = require('../upload');
const { CONTRACT_TYPES } = require('../db');
const { recordApplication } = require('../applications');

const router = express.Router();

router.get('/jobs', (req, res) => {
  const db = req.app.locals.db;
  const filters = {
    q: String(req.query.q || '').trim(),
    location: String(req.query.location || '').trim(),
    contract: CONTRACT_TYPES.includes(req.query.contract) ? req.query.contract : '',
    remote: req.query.remote === '1' ? '1' : '',
  };

  const where = ["j.status = 'open'"];
  const params = [];
  if (filters.q) {
    where.push('(j.title LIKE ? OR j.description LIKE ? OR c.name LIKE ?)');
    params.push(`%${filters.q}%`, `%${filters.q}%`, `%${filters.q}%`);
  }
  if (filters.location) {
    where.push('j.location LIKE ?');
    params.push(`%${filters.location}%`);
  }
  if (filters.contract) {
    where.push('j.contract_type = ?');
    params.push(filters.contract);
  }
  if (filters.remote) where.push('j.remote = 1');

  const jobs = db
    .prepare(
      `SELECT j.*, c.name AS company_name FROM jobs j JOIN companies c ON c.id = j.company_id
       WHERE ${where.join(' AND ')} ORDER BY j.created_at DESC, j.id DESC LIMIT 100`,
    )
    .all(...params);

  res.render('jobs', { title: 'Offres d’emploi', jobs, filters });
});

function loadJob(db, id) {
  return db
    .prepare(
      `SELECT j.*, c.name AS company_name, c.description AS company_description, c.website AS company_website
       FROM jobs j JOIN companies c ON c.id = j.company_id WHERE j.id = ?`,
    )
    .get(id);
}

router.get('/jobs/:id', (req, res) => {
  const db = req.app.locals.db;
  const job = loadJob(db, Number(req.params.id));
  if (!job || (job.status !== 'open' && !(req.user && req.user.company_id === job.company_id))) {
    return res.status(404).render('error', { title: 'Offre introuvable', message: "Cette offre n'existe pas ou n'est plus active." });
  }
  const existing = req.user
    ? db.prepare('SELECT id, stage, created_at FROM applications WHERE job_id = ? AND candidate_id = ?').get(job.id, req.user.id)
    : null;
  res.render('job', { title: job.title, job, existing });
});

router.post('/jobs/:id/apply', requireRole('candidate'), (req, res, next) => {
  cvUpload(req.app.locals.config.uploadDir).single('cv')(req, res, (err) => {
    if (err) return next(err);
    verifyCsrf(req, res, () => {
      const db = req.app.locals.db;
      const job = loadJob(db, Number(req.params.id));
      const discard = () => req.file && fs.rm(req.file.path, { force: true }, () => {});

      if (!job || job.status !== 'open') {
        discard();
        return res.status(404).render('error', { title: 'Offre introuvable', message: "Cette offre n'est plus active." });
      }

      const result = recordApplication(db, {
        jobId: job.id,
        candidateId: req.user.id,
        name: req.user.name,
        email: req.user.email,
        phone: String(req.body.phone || '').trim().slice(0, 40),
        coverLetter: String(req.body.cover_letter || '').trim().slice(0, 5000),
        cvPath: req.file ? req.file.filename : null,
        cvOriginalName: req.file ? req.file.originalname.slice(0, 200) : null,
        source: 'jokko',
      });

      if (!result.created) {
        discard();
        req.session.flash = { type: 'error', message: 'Vous avez déjà postulé à cette offre.' };
      } else {
        req.session.flash = { type: 'success', message: 'Candidature envoyée ! Suivez son avancement dans « Mes candidatures ».' };
      }
      res.redirect(`/jobs/${job.id}`);
    });
  });
});

router.get('/applications', requireLogin, (req, res) => {
  const applications = req.app.locals.db
    .prepare(
      `SELECT a.id, a.stage, a.created_at, a.updated_at, j.id AS job_id, j.title, j.location, j.status AS job_status, c.name AS company_name
       FROM applications a JOIN jobs j ON j.id = a.job_id JOIN companies c ON c.id = j.company_id
       WHERE a.candidate_id = ? ORDER BY a.created_at DESC`,
    )
    .all(req.user.id);
  res.render('my-applications', { title: 'Mes candidatures', applications });
});

module.exports = router;
