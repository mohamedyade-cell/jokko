const { transaction } = require('./db');

// Enregistre une candidature (interne ou reçue de LinkedIn / Indeed).
// Une même adresse e-mail ne peut postuler qu'une fois par offre.
function recordApplication(db, a) {
  const email = String(a.email).trim().toLowerCase();
  const existing = db.prepare('SELECT id FROM applications WHERE job_id = ? AND candidate_email = ?').get(a.jobId, email);
  if (existing) return { created: false, id: existing.id };

  // Rattache la candidature externe à un compte Jokko existant si l'e-mail correspond.
  const candidateId = a.candidateId ?? db.prepare("SELECT id FROM users WHERE email = ? AND role = 'candidate'").get(email)?.id ?? null;

  const id = transaction(db, () => {
    const appId = Number(
      db
        .prepare(
          `INSERT INTO applications (job_id, candidate_id, candidate_name, candidate_email, candidate_phone, cover_letter, cv_path, cv_original_name, external_ref, source)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(a.jobId, candidateId, a.name, email, a.phone || '', a.coverLetter || '', a.cvPath || null, a.cvOriginalName || null, a.externalRef || null, a.source)
        .lastInsertRowid,
    );
    db.prepare("INSERT INTO application_events (application_id, actor_id, from_stage, to_stage) VALUES (?, NULL, NULL, 'nouveau')").run(appId);
    return appId;
  });
  return { created: true, id };
}

module.exports = { recordApplication };
