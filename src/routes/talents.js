const express = require('express');
const { requireRole } = require('../auth');
const { skillScoreSql, referralScoreSql, activeBadges, LEVEL_RANK, ACTIVE_BADGE } = require('../score');
const { listFamilies, LEVELS } = require('../quiz');
const { usage, unlockCandidate } = require('../access');

const router = express.Router();
const recruiterOnly = requireRole('recruiter');

const levelRankSql = `CASE b.level WHEN 'debutant' THEN 1 WHEN 'intermediaire' THEN 2 WHEN 'avance' THEN 3 ELSE 0 END`;

// CVthèque : repérage des candidats par badges, école, Jokko Score, disponibilité.
// Mode « besoin urgent » : uniquement les candidats disponibles immédiatement, classés par Jokko Score.
function search(req, res, urgent) {
  const db = req.app.locals.db;
  const families = listFamilies(db);
  const f = {
    q: String(req.query.q || '').trim(),
    location: String(req.query.location || '').trim(),
    badge: families.some((fam) => fam.key === req.query.badge) ? req.query.badge : '',
    level: LEVEL_RANK[req.query.level] ? req.query.level : 'debutant',
    school: Number(req.query.school) || '',
    minScore: Math.min(100, Math.max(0, parseInt(req.query.min_score, 10) || 0)),
    video: req.query.video === '1' ? '1' : '',
    available: urgent || req.query.available === '1' ? '1' : '',
  };

  const where = ["u.role = 'candidate'"];
  const params = [];
  if (f.q) {
    where.push('(u.headline LIKE ? OR u.skills LIKE ? OR u.about LIKE ?)');
    params.push(`%${f.q}%`, `%${f.q}%`, `%${f.q}%`);
  }
  if (f.location) {
    where.push('u.location LIKE ?');
    params.push(`%${f.location}%`);
  }
  if (f.badge) {
    where.push(`EXISTS (SELECT 1 FROM badges b WHERE b.user_id = u.id AND b.skill_key = ? AND ${levelRankSql} >= ? AND ${ACTIVE_BADGE})`);
    params.push(f.badge, LEVEL_RANK[f.level]);
  }
  if (f.school) {
    where.push(`EXISTS (SELECT 1 FROM badges b WHERE b.user_id = u.id AND b.skill_key = ? AND ${ACTIVE_BADGE})`);
    params.push(`campus:${f.school}`);
  }
  if (f.video) where.push('u.video_path IS NOT NULL');
  if (f.available) where.push('u.available_now = 1');

  const candidates = db
    .prepare(
      `SELECT * FROM (
         SELECT u.id, u.name, u.headline, u.location, u.skills, u.video_path, u.video_language, u.available_now,
                ${skillScoreSql()} AS skill_score, ${referralScoreSql()} AS referral_score,
                EXISTS (SELECT 1 FROM unlocks k WHERE k.company_id = ? AND k.candidate_id = u.id) AS unlocked
         FROM users u WHERE ${where.join(' AND ')})
       WHERE skill_score >= ?
       ORDER BY skill_score DESC, referral_score DESC, id DESC LIMIT 60`,
    )
    .all(req.user.company_id, ...params, f.minScore);

  const badges = activeBadges(db, candidates.map((c) => c.id));
  const jobs = db.prepare("SELECT id, title FROM jobs WHERE company_id = ? AND status = 'open' ORDER BY created_at DESC").all(req.user.company_id);
  const schools = db.prepare('SELECT id, name FROM schools ORDER BY name').all();

  res.render('ats/talents', {
    title: urgent ? 'Besoin urgent' : 'CVthèque',
    urgent,
    filters: f,
    candidates,
    badges,
    jobs,
    schools,
    families,
    LEVELS,
    usage: usage(db, req.user.company_id),
  });
}

router.get('/ats/talents', recruiterOnly, (req, res) => search(req, res, false));
router.get('/ats/urgent', recruiterOnly, (req, res) => search(req, res, true));

router.post('/ats/talents/:id/unlock', recruiterOnly, (req, res) => {
  const db = req.app.locals.db;
  const candidate = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'candidate'").get(Number(req.params.id));
  if (!candidate) return res.status(404).render('error', { title: 'Candidat introuvable', message: "Ce profil n'existe pas." });
  const result = unlockCandidate(db, req.user, candidate, Number(req.body.job_id));
  if (result.error) {
    req.session.flash = { type: 'error', message: result.error };
    return res.redirect(req.body.back === 'urgent' ? '/ats/urgent' : '/ats/talents');
  }
  req.session.flash = { type: 'success', message: `CV de ${candidate.name} débloqué : le candidat est dans votre pipeline.` };
  res.redirect(`/ats/applications/${result.applicationId}`);
});

module.exports = router;
