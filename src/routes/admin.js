const express = require('express');
const path = require('node:path');
const { requireLogin } = require('../auth');
const { PLANS, transaction } = require('../db');
const multer = require('multer');
const { verifyCsrf } = require('../auth');
const { grantBadge, CERTIFICATION_POINTS, CAMPUS_POINTS } = require('../score');
const quiz = require('../quiz');
const quizImport = require('../quizImport');

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

// ---------- Banque de questions : import Excel / CSV ----------

const importUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 20 },
  fileFilter: (req, file, cb) => {
    if (['.csv', '.xlsx', '.txt'].includes(path.extname(file.originalname).toLowerCase())) return cb(null, true);
    const err = new Error('Seuls les fichiers Excel (.xlsx) et CSV sont acceptés.');
    err.code = 'INVALID_FILE_TYPE';
    cb(err);
  },
});

function renderQuizAdmin(req, res, extra = {}) {
  const db = req.app.locals.db;
  const quizzes = quiz.listQuizzes(db, { includeInactive: true });
  const imports = db
    .prepare('SELECT i.*, u.name AS user_name FROM quiz_imports i LEFT JOIN users u ON u.id = i.imported_by ORDER BY i.id DESC LIMIT 10')
    .all()
    .map((i) => ({ ...i, files: JSON.parse(i.files), summary: JSON.parse(i.summary) }));
  const totals = {
    badges: quizzes.length,
    questions: db.prepare('SELECT COUNT(*) AS n FROM quiz_questions WHERE active = 1').get().n,
    attempts: db.prepare('SELECT COUNT(*) AS n FROM quiz_attempts').get().n,
  };
  res.status(extra.errors ? 400 : 200).render('admin-quizzes', {
    title: 'Banque de questions',
    quizzes,
    imports,
    totals,
    LEVELS: quiz.LEVELS,
    MIN_QUESTIONS: quiz.MIN_QUESTIONS,
    errors: null,
    ...extra,
  });
}

router.get('/admin/quizzes', adminOnly, (req, res) => renderQuizAdmin(req, res));

router.post('/admin/quizzes/import', adminOnly, (req, res, next) => {
  importUpload.array('files')(req, res, async (err) => {
    if (err) return next(err);
    verifyCsrf(req, res, async () => {
      try {
        if (!req.files || !req.files.length) return renderQuizAdmin(req, res, { errors: ['Choisissez au moins un fichier.'] });
        const files = [];
        for (const f of req.files) files.push({ name: f.originalname, rows: await quizImport.readRows(f.buffer, f.originalname) });
        const result = quizImport.importQuestions(req.app.locals.db, files, req.user.id);
        if (result.errors) return renderQuizAdmin(req, res, { errors: result.errors });
        const st = result.stats;
        req.session.flash = {
          type: 'success',
          message: `Import réussi : ${st.questionsCreated} question(s) ajoutée(s), ${st.questionsUpdated} mise(s) à jour, ${st.badgesCreated} nouveau(x) badge(s).`,
        };
        res.redirect('/admin/quizzes');
      } catch (e) {
        renderQuizAdmin(req, res, { errors: [`Fichier illisible : ${e.message}`] });
      }
    });
  });
});

async function sendRows(res, rows, basename, format) {
  if (format === 'xlsx') {
    const writeXlsx = require('write-excel-file/node').default;
    const buffer = await writeXlsx(rows.map((r, i) => r.map((v) => ({ value: String(v ?? ''), fontWeight: i === 0 ? 'bold' : undefined })))).toBuffer();
    res.attachment(`${basename}.xlsx`).type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').send(buffer);
  } else {
    res.attachment(`${basename}.csv`).type('text/csv; charset=utf-8').send(quizImport.toCsv(rows));
  }
}

router.get('/admin/quizzes/modele.:format', adminOnly, (req, res, next) => {
  sendRows(res, quizImport.TEMPLATE_ROWS, 'modele-questions-jokko', req.params.format).catch(next);
});

router.get('/admin/quizzes/export.:format', adminOnly, (req, res, next) => {
  sendRows(res, quizImport.exportRows(req.app.locals.db), `questions-jokko-${new Date().toISOString().slice(0, 10)}`, req.params.format).catch(next);
});

// Aperçu d'un badge avec les bonnes réponses et explications (réservé à l'équipe Jokko).
router.get('/admin/quizzes/:code', adminOnly, (req, res) => {
  const db = req.app.locals.db;
  const z = quiz.getQuiz(db, req.params.code);
  if (!z) return res.status(404).render('error', { title: 'Badge introuvable', message: "Ce badge n'existe pas." });
  const questions = db
    .prepare('SELECT * FROM quiz_questions WHERE quiz_id = ? ORDER BY external_id')
    .all(z.id)
    .map((q) => ({ ...q, choices: JSON.parse(q.choices) }));
  const stats = db
    .prepare("SELECT COUNT(*) AS attempts, SUM(status = 'passed') AS passed FROM quiz_attempts WHERE quiz_slug = ? AND status != 'in_progress'")
    .get(z.badge_code);
  res.render('admin-quiz', { title: `${z.badge_code} · ${z.competence}`, quiz: z, questions, stats, LEVELS: quiz.LEVELS });
});

router.post('/admin/quizzes/:code/toggle', adminOnly, (req, res) => {
  req.app.locals.db.prepare("UPDATE quizzes SET active = 1 - active, updated_at = datetime('now') WHERE badge_code = ?").run(req.params.code);
  res.redirect(req.body.back === 'detail' ? `/admin/quizzes/${encodeURIComponent(req.params.code)}` : '/admin/quizzes');
});

module.exports = router;
