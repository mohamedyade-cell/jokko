const { transaction, INBOX_STAGE } = require('./db');
const { notifyCompany } = require('./notify');

// Enregistre une candidature (interne, reçue de LinkedIn / Indeed, ou issue de la CVthèque).
// Une même adresse e-mail ne peut postuler qu'une fois par offre.
// Par défaut elle arrive dans les « candidatures reçues » : elle n'entre dans le pipeline qu'une fois débloquée.
function recordApplication(db, a) {
  const email = String(a.email).trim().toLowerCase();
  const existing = db.prepare('SELECT id FROM applications WHERE job_id = ? AND candidate_email = ?').get(a.jobId, email);
  if (existing) return { created: false, id: existing.id };

  // Rattache la candidature externe à un compte Jokko existant si l'e-mail correspond.
  const candidateId = a.candidateId ?? db.prepare("SELECT id FROM users WHERE email = ? AND role = 'candidate'").get(email)?.id ?? null;

  const stage = a.stage || INBOX_STAGE;
  const id = transaction(db, () => {
    const appId = Number(
      db
        .prepare(
          `INSERT INTO applications (job_id, candidate_id, candidate_name, candidate_email, candidate_phone, cover_letter, cv_path, cv_original_name, external_ref, source, stage)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(a.jobId, candidateId, a.name, email, a.phone || '', a.coverLetter || '', a.cvPath || null, a.cvOriginalName || null, a.externalRef || null, a.source, stage)
        .lastInsertRowid,
    );
    db.prepare('INSERT INTO application_events (application_id, actor_id, from_stage, to_stage) VALUES (?, ?, NULL, ?)').run(appId, a.actorId || null, stage);
    if (stage === INBOX_STAGE) {
      const job = db.prepare('SELECT title, company_id FROM jobs WHERE id = ?').get(a.jobId);
      const via = { jokko: 'Jokko', linkedin: 'LinkedIn', indeed: 'Indeed' }[a.source] || a.source;
      notifyCompany(db, job.company_id, { type: 'application', title: `Nouvelle candidature · ${job.title}`, body: `Reçue via ${via}, à examiner.`, link: `/ats/jobs/${a.jobId}` });
    }
    return appId;
  });
  return { created: true, id };
}

module.exports = { recordApplication };
