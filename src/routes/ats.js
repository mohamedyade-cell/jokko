const express = require('express');
const path = require('node:path');
const { requireRole } = require('../auth');
const { STAGES, STAGE_KEYS, INBOX_STAGE, DISMISSED_STAGE, CONTRACT_TYPES, SOURCES, transaction } = require('../db');
const { skillScoreSql, referralScoreSql, activeBadges } = require('../score');
const { usage, retainApplication } = require('../access');
const { notify } = require('../notify');
const { candidateStageLabel } = require('../helpers');
const iv = require('../interviews');

const router = express.Router();
const recruiterOnly = requireRole('recruiter');

function notFound(res, what = 'Élément introuvable') {
  return res.status(404).render('error', { title: what, message: "Cet élément n'existe pas ou n'appartient pas à votre entreprise." });
}

function companyJob(db, user, id) {
  return db.prepare('SELECT * FROM jobs WHERE id = ? AND company_id = ?').get(id, user.company_id);
}

// Cloisonnement : une candidature n'est accessible qu'à l'entreprise propriétaire de l'offre.
function companyApplication(db, user, id) {
  return db
    .prepare(
      `SELECT a.*, j.title AS job_title, j.id AS job_id FROM applications a JOIN jobs j ON j.id = a.job_id
       WHERE a.id = ? AND j.company_id = ?`,
    )
    .get(id, user.company_id);
}

// CV et coordonnées ne sont visibles qu'une fois la candidature entrée dans le pipeline.
function inPipeline(application) {
  return STAGE_KEYS.includes(application.stage);
}

function parseJobForm(body) {
  const int = (v) => {
    const n = parseInt(String(v || '').replace(/\s/g, ''), 10);
    return Number.isFinite(n) && n >= 0 ? n : null;
  };
  const values = {
    title: String(body.title || '').trim().slice(0, 200),
    description: String(body.description || '').trim().slice(0, 20000),
    location: String(body.location || '').trim().slice(0, 120),
    contract_type: CONTRACT_TYPES.includes(body.contract_type) ? body.contract_type : '',
    remote: body.remote ? 1 : 0,
    salary_min: int(body.salary_min),
    salary_max: int(body.salary_max),
    publish_linkedin: body.publish_linkedin ? 1 : 0,
    publish_indeed: body.publish_indeed ? 1 : 0,
  };
  let error = null;
  if (!values.title || !values.description || !values.location || !values.contract_type) error = 'Intitulé, description, lieu et type de contrat sont obligatoires.';
  else if (values.salary_min && values.salary_max && values.salary_min > values.salary_max) error = 'Le salaire minimum dépasse le maximum.';
  return { values, error };
}

function jobLimitMessage(u) {
  return `L'offre ${u.plan.label} permet ${u.plan.maxOpenJobs} offres ouvertes en même temps. Clôturez une offre ou passez à l'offre Corporate.`;
}

router.get('/ats', recruiterOnly, (req, res) => {
  const db = req.app.locals.db;
  const cid = req.user.company_id;
  const jobs = db
    .prepare(
      `SELECT j.*, (SELECT COUNT(*) FROM applications a WHERE a.job_id = j.id AND a.stage NOT IN ('recue', 'ecartee')) AS total,
              (SELECT COUNT(*) FROM applications a WHERE a.job_id = j.id AND a.stage = 'recue') AS inbox_count
       FROM jobs j WHERE j.company_id = ? ORDER BY j.status = 'open' DESC, j.created_at DESC, j.id DESC`,
    )
    .all(cid);

  const byStage = Object.fromEntries([...STAGE_KEYS, INBOX_STAGE].map((k) => [k, 0]));
  for (const r of db
    .prepare('SELECT a.stage, COUNT(*) AS n FROM applications a JOIN jobs j ON j.id = a.job_id WHERE j.company_id = ? GROUP BY a.stage')
    .all(cid))
    if (r.stage in byStage) byStage[r.stage] = r.n;

  const bySource = Object.fromEntries(SOURCES.map((k) => [k, 0]));
  for (const r of db
    .prepare('SELECT a.source, COUNT(*) AS n FROM applications a JOIN jobs j ON j.id = a.job_id WHERE j.company_id = ? GROUP BY a.source')
    .all(cid))
    bySource[r.source] = r.n;

  const recent = db
    .prepare(
      `SELECT a.id, a.candidate_name, a.stage, a.source, a.created_at, j.title AS job_title
       FROM applications a JOIN jobs j ON j.id = a.job_id WHERE j.company_id = ? AND a.stage != 'ecartee'
       ORDER BY a.created_at DESC, a.id DESC LIMIT 8`,
    )
    .all(cid);

  const interviews = db
    .prepare(
      `SELECT i.*, a.candidate_name, a.id AS application_id FROM interviews i JOIN applications a ON a.id = i.application_id JOIN jobs j ON j.id = a.job_id
       WHERE j.company_id = ? AND i.status IN ('proposed', 'confirmed') AND i.starts_at >= datetime('now') ORDER BY i.starts_at LIMIT 5`,
    )
    .all(cid);
  res.render('ats/dashboard', { title: 'Tableau de bord ATS', jobs, byStage, bySource, recent, interviews, iv, usage: usage(db, cid) });
});

router.get('/ats/jobs/new', recruiterOnly, (req, res) => {
  const u = usage(req.app.locals.db, req.user.company_id);
  if (!u.canOpenJob) {
    req.session.flash = { type: 'error', message: jobLimitMessage(u) };
    return res.redirect('/ats');
  }
  res.render('ats/job-form', { title: 'Nouvelle offre', job: { publish_linkedin: 1, publish_indeed: 1 }, error: null });
});

router.post('/ats/jobs', recruiterOnly, (req, res) => {
  const db = req.app.locals.db;
  const u = usage(db, req.user.company_id);
  if (!u.canOpenJob) return res.status(403).render('ats/job-form', { title: 'Nouvelle offre', job: req.body, error: jobLimitMessage(u) });
  const { values, error } = parseJobForm(req.body);
  if (error) return res.status(400).render('ats/job-form', { title: 'Nouvelle offre', job: values, error });
  const v = values;
  const id = db
    .prepare(
      `INSERT INTO jobs (company_id, author_id, title, description, location, contract_type, remote, salary_min, salary_max, publish_linkedin, publish_indeed)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(req.user.company_id, req.user.id, v.title, v.description, v.location, v.contract_type, v.remote, v.salary_min, v.salary_max, v.publish_linkedin, v.publish_indeed)
    .lastInsertRowid;
  req.session.flash = { type: 'success', message: 'Offre publiée sur Jokko et ajoutée aux flux LinkedIn / Indeed sélectionnés.' };
  res.redirect(`/ats/jobs/${id}`);
});

router.get('/ats/jobs/:id/edit', recruiterOnly, (req, res) => {
  const job = companyJob(req.app.locals.db, req.user, Number(req.params.id));
  if (!job) return notFound(res, 'Offre introuvable');
  res.render('ats/job-form', { title: 'Modifier l’offre', job, error: null });
});

router.post('/ats/jobs/:id', recruiterOnly, (req, res) => {
  const db = req.app.locals.db;
  const job = companyJob(db, req.user, Number(req.params.id));
  if (!job) return notFound(res, 'Offre introuvable');
  const { values: v, error } = parseJobForm(req.body);
  if (error) return res.status(400).render('ats/job-form', { title: 'Modifier l’offre', job: { ...v, id: job.id }, error });
  db.prepare(
    `UPDATE jobs SET title = ?, description = ?, location = ?, contract_type = ?, remote = ?, salary_min = ?, salary_max = ?,
       publish_linkedin = ?, publish_indeed = ?, updated_at = datetime('now') WHERE id = ?`,
  ).run(v.title, v.description, v.location, v.contract_type, v.remote, v.salary_min, v.salary_max, v.publish_linkedin, v.publish_indeed, job.id);
  req.session.flash = { type: 'success', message: 'Offre mise à jour.' };
  res.redirect(`/ats/jobs/${job.id}`);
});

router.post('/ats/jobs/:id/status', recruiterOnly, (req, res) => {
  const db = req.app.locals.db;
  const job = companyJob(db, req.user, Number(req.params.id));
  if (!job) return notFound(res, 'Offre introuvable');
  const status = job.status === 'open' ? 'closed' : 'open';
  const u = usage(db, req.user.company_id);
  if (status === 'open' && !u.canOpenJob) {
    req.session.flash = { type: 'error', message: jobLimitMessage(u) };
    return res.redirect(`/ats/jobs/${job.id}`);
  }
  db.prepare("UPDATE jobs SET status = ?, updated_at = datetime('now') WHERE id = ?").run(status, job.id);
  req.session.flash = { type: 'success', message: status === 'open' ? 'Offre réouverte.' : 'Offre clôturée : elle est retirée des flux LinkedIn / Indeed.' };
  res.redirect(`/ats/jobs/${job.id}`);
});

router.get('/ats/jobs/:id', recruiterOnly, (req, res) => {
  const db = req.app.locals.db;
  const job = companyJob(db, req.user, Number(req.params.id));
  if (!job) return notFound(res, 'Offre introuvable');
  const source = SOURCES.includes(req.query.source) ? req.query.source : '';
  const applications = db
    .prepare(
      `SELECT a.id, a.candidate_id, a.candidate_name, a.candidate_email, a.stage, a.rating, a.source, a.created_at, a.cv_path,
              u.headline, u.location, u.video_path, u.cv_path AS profile_cv_path,
              COALESCE(${skillScoreSql()}, 0) AS skill_score, COALESCE(${referralScoreSql()}, 0) AS referral_score,
              (SELECT COUNT(*) FROM application_notes n WHERE n.application_id = a.id) AS notes_count
       FROM applications a LEFT JOIN users u ON u.id = a.candidate_id
       WHERE a.job_id = ? AND (? = '' OR a.source = ?) AND a.stage != ?
       ORDER BY skill_score DESC, a.rating DESC, a.created_at DESC`,
    )
    .all(job.id, source, source, DISMISSED_STAGE);
  const inbox = applications.filter((a) => a.stage === INBOX_STAGE);
  const columns = STAGES.map((s) => ({ ...s, items: applications.filter((a) => a.stage === s.key) }));
  const badges = activeBadges(db, applications.filter((a) => a.candidate_id).map((a) => a.candidate_id));
  res.render('ats/pipeline', { title: job.title, job, columns, inbox, badges, source, total: applications.length - inbox.length });
});

router.get('/ats/applications/:id', recruiterOnly, (req, res) => {
  const db = req.app.locals.db;
  const application = companyApplication(db, req.user, Number(req.params.id));
  if (!application) return notFound(res, 'Candidature introuvable');
  const unlocked = inPipeline(application);
  const notes = db
    .prepare('SELECT n.*, u.name AS author_name FROM application_notes n JOIN users u ON u.id = n.author_id WHERE n.application_id = ? ORDER BY n.created_at DESC, n.id DESC')
    .all(application.id);
  const events = db
    .prepare('SELECT e.*, u.name AS actor_name FROM application_events e LEFT JOIN users u ON u.id = e.actor_id WHERE e.application_id = ? ORDER BY e.created_at DESC, e.id DESC')
    .all(application.id);
  const candidate = application.candidate_id
    ? db
        .prepare(
          `SELECT u.id, u.name, u.headline, u.location, u.about, u.skills, u.video_path, u.video_language, u.available_now, u.cv_path, u.cv_original_name,
                  ${skillScoreSql()} AS skill_score, ${referralScoreSql()} AS referral_score
           FROM users u WHERE u.id = ?`,
        )
        .get(application.candidate_id)
    : null;
  const experiences = candidate && unlocked ? db.prepare('SELECT * FROM experiences WHERE user_id = ? ORDER BY start_date DESC, id DESC').all(candidate.id) : [];
  const badges = candidate ? activeBadges(db, candidate.id)[candidate.id] : [];
  const interviews = unlocked ? db.prepare('SELECT * FROM interviews WHERE application_id = ? ORDER BY starts_at DESC').all(application.id) : [];
  const messageCount = db.prepare('SELECT COUNT(*) AS n FROM messages WHERE application_id = ?').get(application.id).n;
  res.render('ats/application', {
    title: unlocked ? application.candidate_name : 'Candidature reçue',
    application, unlocked, notes, events, candidate, experiences, badges, interviews, messageCount, iv,
  });
});

// Candidature reçue → pipeline (déblocage gratuit : le candidat a postulé lui-même).
router.post('/ats/applications/:id/retain', recruiterOnly, (req, res) => {
  const db = req.app.locals.db;
  const application = companyApplication(db, req.user, Number(req.params.id));
  if (!application) return notFound(res, 'Candidature introuvable');
  if (!inPipeline(application)) retainApplication(db, req.user, application);
  res.redirect(`/ats/applications/${application.id}`);
});

router.post('/ats/applications/:id/dismiss', recruiterOnly, (req, res) => {
  const db = req.app.locals.db;
  const application = companyApplication(db, req.user, Number(req.params.id));
  if (!application) return notFound(res, 'Candidature introuvable');
  if (application.stage === INBOX_STAGE) {
    transaction(db, () => {
      db.prepare("UPDATE applications SET stage = ?, updated_at = datetime('now') WHERE id = ?").run(DISMISSED_STAGE, application.id);
      db.prepare('INSERT INTO application_events (application_id, actor_id, from_stage, to_stage) VALUES (?, ?, ?, ?)').run(application.id, req.user.id, INBOX_STAGE, DISMISSED_STAGE);
    });
  }
  res.redirect(`/ats/jobs/${application.job_id}`);
});

router.post('/ats/applications/:id/stage', recruiterOnly, (req, res) => {
  const db = req.app.locals.db;
  const application = companyApplication(db, req.user, Number(req.params.id));
  const wantsJson = req.is('application/json');
  if (!application) return wantsJson ? res.status(404).json({ error: 'not_found' }) : notFound(res, 'Candidature introuvable');
  const stage = req.body.stage;
  if (!STAGE_KEYS.includes(stage)) return wantsJson ? res.status(400).json({ error: 'invalid_stage' }) : res.redirect(`/ats/applications/${application.id}`);
  if (!inPipeline(application)) return wantsJson ? res.status(409).json({ error: 'not_unlocked' }) : res.redirect(`/ats/applications/${application.id}`);

  if (stage !== application.stage) {
    transaction(db, () => {
      db.prepare("UPDATE applications SET stage = ?, updated_at = datetime('now') WHERE id = ?").run(stage, application.id);
      db.prepare('INSERT INTO application_events (application_id, actor_id, from_stage, to_stage) VALUES (?, ?, ?, ?)').run(application.id, req.user.id, application.stage, stage);
      // Le candidat suit l'avancement (les refus lui sont présentés comme « Non retenue »).
      notify(db, application.candidate_id, {
        type: 'stage',
        title: `${application.job_title} : ${candidateStageLabel(stage)}`,
        body: stage === 'refuse' ? "Le recruteur n'a pas retenu votre candidature pour ce poste. Continuez : d'autres offres vous attendent." : `Votre candidature avance chez ${req.user.company_name}.`,
        link: stage === 'refuse' ? '/applications' : `/messages/${application.id}`,
      });
    });
  }
  if (wantsJson) return res.json({ ok: true, stage });
  res.redirect(req.body.back === 'pipeline' ? `/ats/jobs/${application.job_id}` : `/ats/applications/${application.id}`);
});

router.post('/ats/applications/:id/rating', recruiterOnly, (req, res) => {
  const db = req.app.locals.db;
  const application = companyApplication(db, req.user, Number(req.params.id));
  if (!application) return notFound(res, 'Candidature introuvable');
  const rating = Math.min(5, Math.max(0, parseInt(req.body.rating, 10) || 0));
  db.prepare("UPDATE applications SET rating = ?, updated_at = datetime('now') WHERE id = ?").run(rating, application.id);
  res.redirect(`/ats/applications/${application.id}`);
});

router.post('/ats/applications/:id/notes', recruiterOnly, (req, res) => {
  const db = req.app.locals.db;
  const application = companyApplication(db, req.user, Number(req.params.id));
  if (!application) return notFound(res, 'Candidature introuvable');
  const content = String(req.body.content || '').trim().slice(0, 5000);
  if (content) db.prepare('INSERT INTO application_notes (application_id, author_id, content) VALUES (?, ?, ?)').run(application.id, req.user.id, content);
  res.redirect(`/ats/applications/${application.id}`);
});

// CV joint à la candidature, ou à défaut le CV du profil Jokko du candidat.
router.get('/ats/applications/:id/cv', recruiterOnly, (req, res) => {
  const db = req.app.locals.db;
  const application = companyApplication(db, req.user, Number(req.params.id));
  if (!application || !inPipeline(application)) return notFound(res, 'CV introuvable');
  let file = application.cv_path;
  let name = application.cv_original_name;
  if (!file && application.candidate_id) {
    const u = db.prepare('SELECT cv_path, cv_original_name FROM users WHERE id = ?').get(application.candidate_id);
    file = u && u.cv_path;
    name = u && u.cv_original_name;
  }
  if (!file) return notFound(res, 'CV introuvable');
  res.download(path.join(req.app.locals.config.uploadDir, path.basename(file)), name || path.basename(file));
});

module.exports = router;
