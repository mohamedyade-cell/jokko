const { PLANS, INBOX_STAGE, DISMISSED_STAGE, transaction } = require('./db');
const { recordApplication } = require('./applications');
const { notify } = require('./notify');

// Prévient le candidat que son CV a été débloqué : il peut désormais échanger avec le recruteur.
function notifyUnlocked(db, applicationId, sourcing) {
  const a = db
    .prepare('SELECT a.id, a.candidate_id, j.title, c.name AS company FROM applications a JOIN jobs j ON j.id = a.job_id JOIN companies c ON c.id = j.company_id WHERE a.id = ?')
    .get(applicationId);
  if (!a || !a.candidate_id) return;
  notify(db, a.candidate_id, sourcing
    ? { type: 'unlock', title: `${a.company} s'intéresse à votre profil`, body: `Votre CV a été débloqué pour le poste « ${a.title} ».`, link: `/messages/${a.id}` }
    : { type: 'unlock', title: `Candidature retenue par ${a.company}`, body: `Votre candidature au poste « ${a.title} » passe à l'étude.`, link: `/messages/${a.id}` });
}

function isUnlocked(db, companyId, candidateId) {
  if (!companyId || !candidateId) return false;
  return Boolean(db.prepare('SELECT 1 FROM unlocks WHERE company_id = ? AND candidate_id = ?').get(companyId, candidateId));
}

// CV complet et coordonnées : le candidat lui-même, l'équipe Jokko et les entreprises qui l'ont débloqué.
function canSeeFullProfile(db, viewer, candidateId) {
  if (!viewer) return false;
  if (viewer.id === candidateId || viewer.is_admin) return true;
  return viewer.role === 'recruiter' && isUnlocked(db, viewer.company_id, candidateId);
}

function planOf(company) {
  return PLANS[company && company.plan] || PLANS.pme;
}

function usage(db, companyId) {
  const company = db.prepare('SELECT * FROM companies WHERE id = ?').get(companyId);
  const plan = planOf(company);
  const unlocksThisMonth = db
    .prepare("SELECT COUNT(*) AS n FROM unlocks WHERE company_id = ? AND charged = 1 AND created_at >= datetime('now', 'start of month')")
    .get(companyId).n;
  const openJobs = db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE company_id = ? AND status = 'open'").get(companyId).n;
  return {
    plan,
    planKey: company ? company.plan : 'pme',
    unlocksThisMonth,
    unlocksLeft: plan.monthlyUnlocks == null ? null : Math.max(0, plan.monthlyUnlocks - unlocksThisMonth),
    openJobs,
    canOpenJob: plan.maxOpenJobs == null || openJobs < plan.maxOpenJobs,
  };
}

// Débloque le CV d'un candidat repéré dans la CVthèque et l'ajoute au pipeline d'une offre.
function unlockCandidate(db, recruiter, candidate, jobId) {
  const job = db.prepare('SELECT id FROM jobs WHERE id = ? AND company_id = ?').get(jobId, recruiter.company_id);
  if (!job) return { error: 'Choisissez une de vos offres.' };

  const already = isUnlocked(db, recruiter.company_id, candidate.id);
  if (!already && usage(db, recruiter.company_id).unlocksLeft === 0) {
    return { error: 'Quota de déblocages du mois atteint. Passez à l’offre Corporate pour débloquer sans limite.' };
  }

  return transaction(db, () => {
    if (!already) {
      db.prepare('INSERT INTO unlocks (company_id, candidate_id, unlocked_by, charged) VALUES (?, ?, ?, 1)').run(recruiter.company_id, candidate.id, recruiter.id);
    }
    const existing = db.prepare('SELECT id, stage FROM applications WHERE job_id = ? AND candidate_email = ?').get(job.id, candidate.email);
    if (existing) {
      if (existing.stage === INBOX_STAGE || existing.stage === DISMISSED_STAGE) {
        moveToPipeline(db, existing, recruiter.id);
        notifyUnlocked(db, existing.id, false);
      }
      return { applicationId: existing.id, charged: !already };
    }
    const created = recordApplication(db, {
      jobId: job.id,
      candidateId: candidate.id,
      name: candidate.name,
      email: candidate.email,
      phone: candidate.phone,
      source: 'sourcing',
      stage: 'nouveau',
      actorId: recruiter.id,
    });
    notifyUnlocked(db, created.id, true);
    return { applicationId: created.id, charged: !already };
  });
}

// Fait entrer dans le pipeline une candidature reçue (déblocage gratuit : le candidat a postulé).
function moveToPipeline(db, application, actorId) {
  db.prepare("UPDATE applications SET stage = 'nouveau', updated_at = datetime('now') WHERE id = ?").run(application.id);
  db.prepare("INSERT INTO application_events (application_id, actor_id, from_stage, to_stage) VALUES (?, ?, ?, 'nouveau')").run(application.id, actorId, application.stage);
}

function retainApplication(db, recruiter, application) {
  transaction(db, () => {
    if (application.candidate_id) {
      db.prepare('INSERT OR IGNORE INTO unlocks (company_id, candidate_id, unlocked_by, charged) VALUES (?, ?, ?, 0)').run(recruiter.company_id, application.candidate_id, recruiter.id);
    }
    moveToPipeline(db, application, recruiter.id);
    notifyUnlocked(db, application.id, false);
  });
}

module.exports = { isUnlocked, canSeeFullProfile, usage, planOf, unlockCandidate, retainApplication };
