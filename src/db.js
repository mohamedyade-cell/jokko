const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// Étapes du pipeline ATS, dans l'ordre d'affichage du kanban.
// Un candidat n'entre dans le pipeline qu'une fois son CV débloqué.
const STAGES = [
  { key: 'nouveau', label: 'Nouveau' },
  { key: 'preselection', label: 'Présélectionné' },
  { key: 'entretien', label: 'Entretien' },
  { key: 'offre', label: 'Offre' },
  { key: 'embauche', label: 'Embauché' },
  { key: 'refuse', label: 'Rejeté' },
];
const STAGE_KEYS = STAGES.map((s) => s.key);

// Étapes hors pipeline : candidature reçue mais pas encore débloquée, ou écartée sans déblocage.
const INBOX_STAGE = 'recue';
const DISMISSED_STAGE = 'ecartee';

const CONTRACT_TYPES = ['CDI', 'CDD', 'Stage', 'Alternance', 'Freelance', 'Temps partiel', 'Intérim', 'Journalier'];

// 'sourcing' : candidat repéré dans la CVthèque puis débloqué par le recruteur.
const SOURCES = ['jokko', 'sourcing', 'linkedin', 'indeed'];

// Offres entreprise. null = illimité.
const PLANS = {
  pme: { label: 'PME', maxOpenJobs: 3, monthlyUnlocks: 10 },
  corporate: { label: 'Corporate', maxOpenJobs: null, monthlyUnlocks: null },
};

const SCHEMA_V1 = `
CREATE TABLE IF NOT EXISTS companies (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  website TEXT DEFAULT '',
  location TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('candidate', 'recruiter')),
  name TEXT NOT NULL,
  headline TEXT DEFAULT '',
  location TEXT DEFAULT '',
  about TEXT DEFAULT '',
  skills TEXT DEFAULT '',
  company_id INTEGER REFERENCES companies(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS experiences (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  company TEXT NOT NULL,
  start_date TEXT DEFAULT '',
  end_date TEXT DEFAULT '',
  description TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS connections (
  id INTEGER PRIMARY KEY,
  requester_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  addressee_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('pending', 'accepted')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (requester_id, addressee_id)
);

CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY,
  author_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES companies(id),
  author_id INTEGER NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  location TEXT NOT NULL,
  contract_type TEXT NOT NULL,
  remote INTEGER NOT NULL DEFAULT 0,
  salary_min INTEGER,
  salary_max INTEGER,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  publish_linkedin INTEGER NOT NULL DEFAULT 1,
  publish_indeed INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS applications (
  id INTEGER PRIMARY KEY,
  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  candidate_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  candidate_name TEXT NOT NULL,
  candidate_email TEXT NOT NULL,
  candidate_phone TEXT DEFAULT '',
  cover_letter TEXT DEFAULT '',
  cv_path TEXT,
  cv_original_name TEXT,
  external_ref TEXT,
  stage TEXT NOT NULL DEFAULT 'nouveau',
  rating INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'jokko',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (job_id, candidate_email)
);

CREATE TABLE IF NOT EXISTS application_notes (
  id INTEGER PRIMARY KEY,
  application_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  author_id INTEGER NOT NULL REFERENCES users(id),
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS application_events (
  id INTEGER PRIMARY KEY,
  application_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  actor_id INTEGER REFERENCES users(id),
  from_stage TEXT,
  to_stage TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_applications_job ON applications(job_id);
CREATE INDEX IF NOT EXISTS idx_applications_candidate ON applications(candidate_id);
CREATE INDEX IF NOT EXISTS idx_posts_author ON posts(author_id);
`;

// Pitch vidéo, quiz, badges / Jokko Score, parrainage, déblocage de CV et offres PME / Corporate.
const SCHEMA_V2 = `
ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN phone TEXT DEFAULT '';
ALTER TABLE users ADD COLUMN referral_code TEXT;
ALTER TABLE users ADD COLUMN referred_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE users ADD COLUMN cv_path TEXT;
ALTER TABLE users ADD COLUMN cv_original_name TEXT;
ALTER TABLE users ADD COLUMN video_path TEXT;
ALTER TABLE users ADD COLUMN video_mime TEXT;
ALTER TABLE users ADD COLUMN video_language TEXT;
ALTER TABLE users ADD COLUMN video_updated_at TEXT;
ALTER TABLE users ADD COLUMN available_now INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX idx_users_referral_code ON users(referral_code);
CREATE INDEX idx_users_referred_by ON users(referred_by);

ALTER TABLE companies ADD COLUMN plan TEXT NOT NULL DEFAULT 'pme';

UPDATE applications SET stage = 'entretien' WHERE stage = 'test';

CREATE TABLE schools (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  city TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Certifications et parcours Jokko Campus déclarés par le candidat, vérifiés par l'équipe Jokko.
CREATE TABLE credentials (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('certification', 'campus')),
  title TEXT NOT NULL,
  issuer TEXT DEFAULT '',
  school_id INTEGER REFERENCES schools(id),
  obtained_on TEXT DEFAULT '',
  reference TEXT DEFAULT '',
  file_path TEXT,
  file_original_name TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'verified', 'rejected')),
  review_note TEXT DEFAULT '',
  reviewed_by INTEGER REFERENCES users(id),
  reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE badges (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('quiz', 'certification', 'campus')),
  skill_key TEXT NOT NULL,
  label TEXT NOT NULL,
  level TEXT,
  points INTEGER NOT NULL,
  source_ref TEXT,
  issued_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT
);
CREATE INDEX idx_badges_user ON badges(user_id);
CREATE INDEX idx_badges_skill ON badges(skill_key, level);

CREATE TABLE quiz_attempts (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  quiz_slug TEXT NOT NULL,
  level TEXT NOT NULL,
  questions TEXT NOT NULL,
  current_index INTEGER NOT NULL DEFAULT 0,
  correct_count INTEGER NOT NULL DEFAULT 0,
  question_served_ms INTEGER,
  status TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'passed', 'failed')),
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT
);
CREATE INDEX idx_quiz_attempts_user ON quiz_attempts(user_id, quiz_slug, level);

-- Un candidat n'est visible en entier (CV, contact) qu'après déblocage par l'entreprise.
CREATE TABLE unlocks (
  id INTEGER PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  candidate_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  unlocked_by INTEGER REFERENCES users(id),
  charged INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (company_id, candidate_id)
);

INSERT OR IGNORE INTO unlocks (company_id, candidate_id, charged)
  SELECT j.company_id, a.candidate_id, 0 FROM applications a JOIN jobs j ON j.id = a.job_id WHERE a.candidate_id IS NOT NULL;
`;

const MIGRATIONS = [SCHEMA_V1, SCHEMA_V2];

function referralCode() {
  return crypto.randomBytes(5).toString('hex').toUpperCase();
}

function migrate(db) {
  const current = db.prepare('PRAGMA user_version').get().user_version;
  // Les bases créées avant le versionnage ont déjà le schéma v1.
  const hasV1 = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'users'").get();
  let version = current === 0 && hasV1 ? 1 : current;
  for (; version < MIGRATIONS.length; version++) {
    transaction(db, () => {
      db.exec(MIGRATIONS[version]);
      db.exec(`PRAGMA user_version = ${version + 1}`);
    });
  }
  for (const u of db.prepare('SELECT id FROM users WHERE referral_code IS NULL').all()) {
    db.prepare('UPDATE users SET referral_code = ? WHERE id = ?').run(referralCode(), u.id);
  }
}

function openDb(dbPath) {
  if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON;');
  if (dbPath !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  migrate(db);
  return db;
}

// Exécute fn dans une transaction ; rollback si une exception est levée.
// Les SAVEPOINT permettent d'imbriquer les appels.
let savepointSeq = 0;
function transaction(db, fn) {
  const name = `sp_${++savepointSeq}`;
  db.exec(`SAVEPOINT ${name}`);
  try {
    const result = fn();
    db.exec(`RELEASE ${name}`);
    return result;
  } catch (err) {
    db.exec(`ROLLBACK TO ${name}`);
    db.exec(`RELEASE ${name}`);
    throw err;
  }
}

module.exports = {
  openDb,
  transaction,
  referralCode,
  STAGES,
  STAGE_KEYS,
  INBOX_STAGE,
  DISMISSED_STAGE,
  CONTRACT_TYPES,
  SOURCES,
  PLANS,
};
