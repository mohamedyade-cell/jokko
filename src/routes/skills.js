const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const { requireRole, verifyCsrf } = require('../auth');
const { proofUpload } = require('../upload');
const quiz = require('../quiz');
const { getScore, activeBadges, SKILL_SCORE_CAP, REFERRAL_POINTS } = require('../score');

const router = express.Router();
const candidateOnly = requireRole('candidate');

// Catalogue des badges (importés par l'équipe Jokko) + Jokko Score du candidat.
router.get('/skills', candidateOnly, (req, res) => {
  const db = req.app.locals.db;
  const all = quiz.listQuizzes(db);
  const domains = [...new Set(all.map((z) => z.domain))];
  const filters = { domaine: domains.includes(req.query.domaine) ? req.query.domaine : '', q: String(req.query.q || '').trim() };
  const needle = filters.q.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const matches = (z) =>
    (!filters.domaine || z.domain === filters.domaine) &&
    (!needle || `${z.family} ${z.competence} ${z.domain}`.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().includes(needle));

  // Domaine → compétence (série de badges) → niveaux.
  const catalog = [];
  for (const z of all.filter(matches)) {
    let domain = catalog.find((d) => d.name === z.domain);
    if (!domain) catalog.push((domain = { name: z.domain, families: [] }));
    let family = domain.families.find((f) => f.slug === z.family_slug);
    if (!family) domain.families.push((family = { slug: z.family_slug, name: z.family, levels: [] }));
    const info = quiz.LEVELS[z.level];
    const count = quiz.questionCount(z);
    family.levels.push({ ...z, ...info, questionCount: count, minutes: Math.round((count * info.seconds) / 60), ...quiz.quizStatus(db, req.user.id, z) });
  }

  res.render('skills', {
    title: 'Compétences et Jokko Score',
    catalog,
    domains,
    filters,
    total: all.length,
    score: getScore(db, req.user.id),
    badges: activeBadges(db, req.user.id)[req.user.id],
    cap: SKILL_SCORE_CAP,
    referralPoints: REFERRAL_POINTS,
    passPercent: Math.round(quiz.PASS_RATIO * 100),
    cooldownDays: quiz.cooldownDays(),
    validityDays: quiz.validityDays(),
  });
});

router.post('/skills/:code/start', candidateOnly, (req, res) => {
  const result = quiz.startAttempt(req.app.locals.db, req.user.id, req.params.code);
  if (result.error) {
    req.session.flash = { type: 'error', message: result.error };
    return res.redirect('/skills');
  }
  res.redirect(`/quiz/${result.id}`);
});

router.get('/quiz/:id', candidateOnly, (req, res) => {
  const db = req.app.locals.db;
  const attempt = quiz.loadAttempt(db, req.user.id, Number(req.params.id));
  if (!attempt) return res.status(404).render('error', { title: 'Quiz introuvable', message: "Cette tentative n'existe pas." });
  if (attempt.status !== 'in_progress') {
    return res.render('quiz-result', { title: 'Résultat du quiz', attempt, passPercent: Math.round(quiz.PASS_RATIO * 100), cooldownDays: quiz.cooldownDays() });
  }
  const question = quiz.currentQuestion(db, attempt);
  res.render('quiz', { title: attempt.quiz.family, attempt, question });
});

router.post('/quiz/:id/answer', candidateOnly, (req, res) => {
  const db = req.app.locals.db;
  const attempt = quiz.loadAttempt(db, req.user.id, Number(req.params.id));
  if (!attempt) return res.redirect('/skills');
  const choice = req.body.choice === undefined || req.body.choice === '' ? null : Number(req.body.choice);
  quiz.answerQuestion(db, attempt, Number(req.body.index), choice);
  res.redirect(`/quiz/${attempt.id}`);
});

// Certifications et parcours Jokko Campus : déclarés par le candidat, vérifiés par l'équipe Jokko.
router.get('/profile/credentials', candidateOnly, (req, res) => {
  const db = req.app.locals.db;
  const credentials = db
    .prepare('SELECT c.*, s.name AS school_name FROM credentials c LEFT JOIN schools s ON s.id = c.school_id WHERE c.user_id = ? ORDER BY c.created_at DESC, c.id DESC')
    .all(req.user.id);
  const schools = db.prepare('SELECT * FROM schools ORDER BY name').all();
  res.render('credentials', { title: 'Certifications et Jokko Campus', credentials, schools });
});

router.post('/profile/credentials', candidateOnly, (req, res, next) => {
  proofUpload(path.join(req.app.locals.config.uploadDir, 'proofs')).single('proof')(req, res, (err) => {
    if (err) return next(err);
    verifyCsrf(req, res, () => {
      const db = req.app.locals.db;
      const f = (k, max = 200) => String(req.body[k] || '').trim().slice(0, max);
      const type = req.body.type === 'campus' ? 'campus' : 'certification';
      const discard = () => req.file && fs.rm(req.file.path, { force: true }, () => {});
      let title = f('title');
      let schoolId = null;

      if (type === 'campus') {
        const school = db.prepare('SELECT * FROM schools WHERE id = ?').get(Number(req.body.school_id));
        if (!school) {
          discard();
          req.session.flash = { type: 'error', message: 'Choisissez une école partenaire.' };
          return res.redirect('/profile/credentials');
        }
        schoolId = school.id;
        title = title || school.name;
      } else if (!title || !f('issuer')) {
        discard();
        req.session.flash = { type: 'error', message: "Indiquez l'intitulé de la certification et l'organisme qui l'a délivrée." };
        return res.redirect('/profile/credentials');
      }

      db.prepare(
        `INSERT INTO credentials (user_id, type, title, issuer, school_id, obtained_on, reference, file_path, file_original_name)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(req.user.id, type, title, f('issuer'), schoolId, f('obtained_on', 20), f('reference'), req.file ? req.file.filename : null, req.file ? req.file.originalname.slice(0, 200) : null);
      req.session.flash = { type: 'success', message: 'Envoyé ! Le badge sera ajouté à votre profil après vérification par l’équipe Jokko.' };
      res.redirect('/profile/credentials');
    });
  });
});

router.post('/profile/credentials/:id/delete', candidateOnly, (req, res) => {
  const db = req.app.locals.db;
  const cred = db.prepare("SELECT * FROM credentials WHERE id = ? AND user_id = ? AND status != 'verified'").get(Number(req.params.id), req.user.id);
  if (cred) {
    db.prepare('DELETE FROM credentials WHERE id = ?').run(cred.id);
    if (cred.file_path) fs.rm(path.join(req.app.locals.config.uploadDir, 'proofs', path.basename(cred.file_path)), { force: true }, () => {});
  }
  res.redirect('/profile/credentials');
});

module.exports = router;
