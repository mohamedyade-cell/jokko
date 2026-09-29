// Remplit la base avec des données de démonstration.
// Tous les comptes utilisent le mot de passe « motdepasse123 ».
const path = require('node:path');
const bcrypt = require('bcryptjs');
const { openDb } = require('./db');
const { recordApplication } = require('./applications');
const { referralCode } = require('./db');
const { grantBadge, QUIZ_LEVEL_POINTS, CERTIFICATION_POINTS, CAMPUS_POINTS } = require('./score');

const db = openDb(process.env.DATABASE_PATH || path.join(__dirname, '..', 'data', 'jokko.db'));

if (db.prepare('SELECT COUNT(*) AS n FROM users').get().n > 0) {
  console.log('La base contient déjà des données, seed ignoré.');
  process.exit(0);
}

const hash = bcrypt.hashSync('motdepasse123', 10);
const id = (r) => Number(r.lastInsertRowid);

const companies = {
  teranga: id(db.prepare('INSERT INTO companies (name, description, website, location) VALUES (?, ?, ?, ?)').run('Teranga Tech', 'Éditeur de logiciels de paiement mobile.', 'https://example.com', 'Dakar')),
  baobab: id(db.prepare('INSERT INTO companies (name, description, website, location) VALUES (?, ?, ?, ?)').run('Baobab Finance', 'Banque digitale pour les PME.', 'https://example.org', 'Abidjan')),
};

const addUser = (email, role, name, headline, location, skills, companyId = null, about = '', extra = {}) =>
  id(
    db
      .prepare(
        `INSERT INTO users (email, password_hash, role, name, headline, location, skills, company_id, about, referral_code, referred_by, available_now, is_admin, phone)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(email, hash, role, name, headline, location, skills, companyId, about, referralCode(), extra.referredBy || null, extra.available ? 1 : 0, extra.admin ? 1 : 0, extra.phone || ''),
  );

const in1Year = new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 19).replace('T', ' ');
const quizBadge = (userId, slug, title, level) =>
  grantBadge(db, { userId, kind: 'quiz', skillKey: `quiz:${slug}`, label: title, level, points: QUIZ_LEVEL_POINTS[level], sourceRef: 'seed', expiresAt: in1Year });

const schools = {
  ism: id(db.prepare('INSERT INTO schools (name, city) VALUES (?, ?)').run('ISM Dakar', 'Dakar')),
  ucad: id(db.prepare('INSERT INTO schools (name, city) VALUES (?, ?)').run('UCAD – FASEG', 'Dakar')),
  isep: id(db.prepare('INSERT INTO schools (name, city) VALUES (?, ?)').run('ISEP Thiès', 'Thiès')),
};
db.prepare("UPDATE companies SET plan = 'corporate' WHERE id = ?").run(companies.baobab);
const jokko = id(db.prepare('INSERT INTO companies (name, description, plan) VALUES (?, ?, ?)').run('Jokko', 'Équipe Jokko', 'corporate'));
addUser('admin@jokko.test', 'recruiter', 'Équipe Jokko', 'Vérification des certifications', 'Dakar', '', jokko, '', { admin: true });

const awa = addUser('rh@teranga.test', 'recruiter', 'Awa Ndiaye', 'Talent Acquisition Manager chez Teranga Tech', 'Dakar', 'Recrutement, Marque employeur', companies.teranga);
const koffi = addUser('rh@baobab.test', 'recruiter', 'Koffi Mensah', 'Responsable RH – Baobab Finance', 'Abidjan', 'RH, Paie', companies.baobab);
const moussa = addUser('moussa@candidat.test', 'candidate', 'Moussa Diop', 'Développeur Full-Stack JavaScript', 'Dakar', 'Node.js, React, PostgreSQL, Docker', null, 'Passionné par les produits fintech, 5 ans d’expérience.', { phone: '+221 77 111 11 11' });
const fatou = addUser('fatou@candidat.test', 'candidate', 'Fatou Sow', 'Data Analyst', 'Thiès', 'SQL, Python, Power BI', null, 'J’aime transformer les données en décisions.', { referredBy: moussa });
const ibrahima = addUser('ibrahima@candidat.test', 'candidate', 'Ibrahima Fall', 'Chef de projet digital', 'Saint-Louis', 'Agile, Scrum, Jira', null, '', { referredBy: moussa });
const aissatou = addUser('aissatou@candidat.test', 'candidate', 'Aïssatou Ndiaye', 'Assistante comptable', 'Dakar', 'Comptabilité, SYSCOHADA, Excel, Sage', null, 'Titulaire d’une licence en comptabilité, 2 ans en cabinet.', { available: true });
const ousmane = addUser('ousmane@candidat.test', 'candidate', 'Ousmane Sarr', 'Magasinier – cariste', 'Dakar', 'Gestion de stock, CACES, Sécurité', null, 'Disponible pour missions journalières et intérim.', { available: true });
const khady = addUser('khady@candidat.test', 'candidate', 'Khady Faye', 'Conseillère clientèle', 'Rufisque', 'Accueil, Vente, Wolof, Français', null, '', { available: true, referredBy: aissatou });

quizBadge(moussa, 'excel', 'Excel', 'intermediaire');
quizBadge(fatou, 'excel', 'Excel', 'avance');
quizBadge(fatou, 'comptabilite', 'Comptabilité (SYSCOHADA)', 'debutant');
quizBadge(aissatou, 'comptabilite', 'Comptabilité (SYSCOHADA)', 'intermediaire');
quizBadge(aissatou, 'excel', 'Excel', 'intermediaire');
quizBadge(ousmane, 'securite', 'Sécurité au travail et secourisme', 'avance');
quizBadge(khady, 'service-client', 'Service client et vente', 'intermediaire');
quizBadge(khady, 'securite', 'Sécurité au travail et secourisme', 'debutant');
grantBadge(db, { userId: aissatou, kind: 'campus', skillKey: `campus:${schools.ism}`, label: 'Jokko Campus · ISM Dakar', points: CAMPUS_POINTS, sourceRef: 'seed' });
grantBadge(db, { userId: fatou, kind: 'certification', skillKey: 'cert:power bi data analyst (pl-300)', label: 'Power BI Data Analyst (PL-300)', points: CERTIFICATION_POINTS, sourceRef: 'seed' });
db.prepare("INSERT INTO credentials (user_id, type, title, issuer, obtained_on, reference) VALUES (?, 'certification', 'CACES R489 catégorie 3', 'AFPA Dakar', '2024-05', 'CAC-2024-0457')").run(ousmane);
db.prepare("INSERT INTO credentials (user_id, type, title, school_id, obtained_on) VALUES (?, 'campus', 'Licence Informatique', ?, '2023')").run(moussa, schools.isep);

db.prepare('INSERT INTO experiences (user_id, title, company, start_date, end_date, description) VALUES (?, ?, ?, ?, ?, ?)').run(moussa, 'Développeur Full-Stack', 'Wari Labs', '2021-03', '', 'API de paiement et back-office React.');
db.prepare('INSERT INTO experiences (user_id, title, company, start_date, end_date, description) VALUES (?, ?, ?, ?, ?, ?)').run(moussa, 'Développeur Web', 'Agence Sunu Web', '2019-01', '2021-02', 'Sites e-commerce.');
db.prepare('INSERT INTO experiences (user_id, title, company, start_date, end_date, description) VALUES (?, ?, ?, ?, ?, ?)').run(fatou, 'Data Analyst', 'Orange Sonatel', '2022-06', '', 'Tableaux de bord commerciaux.');

const addJob = (companyId, authorId, title, location, contract, remote, min, max, description) =>
  id(
    db
      .prepare('INSERT INTO jobs (company_id, author_id, title, description, location, contract_type, remote, salary_min, salary_max) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(companyId, authorId, title, description, location, contract, remote, min, max),
  );

const jobDev = addJob(companies.teranga, awa, 'Développeur Back-End Node.js', 'Dakar', 'CDI', 1, 900000, 1400000,
  'Vous rejoindrez l’équipe paiement pour concevoir nos API.\n\nProfil : 3 ans d’expérience Node.js, SQL, tests automatisés.');
const jobData = addJob(companies.teranga, awa, 'Data Analyst', 'Dakar', 'CDD', 0, 600000, 850000,
  'Analyse des transactions et construction de tableaux de bord.\n\nProfil : SQL, Python, sens du business.');
addJob(companies.teranga, awa, 'Assistant(e) comptable', 'Dakar', 'CDD', 0, 350000, 450000,
  'Saisie comptable, rapprochements bancaires, déclarations de TVA.\n\nProfil : badge « Comptabilité Intermédiaire » apprécié, maîtrise d’Excel.');
addJob(companies.baobab, koffi, 'Chargé(e) de clientèle PME', 'Abidjan', 'CDI', 0, null, null,
  'Accompagnement d’un portefeuille de PME clientes.');
addJob(companies.baobab, koffi, 'Stage – Marketing digital', 'Abidjan', 'Stage', 1, 150000, null,
  'Stage de 6 mois au sein de l’équipe acquisition.');

// Candidatures déjà retenues (dans le pipeline) et candidatures reçues à examiner.
const retained = (a) => {
  const { id: appId } = recordApplication(db, { ...a, stage: 'nouveau' });
  if (a.candidateId) db.prepare('INSERT OR IGNORE INTO unlocks (company_id, candidate_id, charged) VALUES (?, ?, 0)').run(companies.teranga, a.candidateId);
  return appId;
};
retained({ jobId: jobDev, candidateId: moussa, name: 'Moussa Diop', email: 'moussa@candidat.test', coverLetter: 'Votre produit me passionne !', source: 'jokko' });
retained({ jobId: jobDev, name: 'Aminata Ba', email: 'aminata.ba@example.com', phone: '+221 77 000 00 00', source: 'linkedin', externalRef: 'li-123' });
recordApplication(db, { jobId: jobData, candidateId: fatou, name: 'Fatou Sow', email: 'fatou@candidat.test', source: 'jokko' });
recordApplication(db, { jobId: jobDev, name: 'Cheikh Gueye', email: 'cheikh.gueye@example.com', source: 'indeed', externalRef: 'indeed-456' });
recordApplication(db, { jobId: jobData, name: 'Mariama Kane', email: 'mariama.kane@example.com', source: 'indeed' });

db.prepare("UPDATE applications SET stage = 'entretien', rating = 4 WHERE candidate_email = 'moussa@candidat.test'").run();
db.prepare("UPDATE applications SET stage = 'preselection', rating = 3 WHERE candidate_email = 'aminata.ba@example.com'").run();

const connect = (a, b, status = 'accepted') => db.prepare('INSERT INTO connections (requester_id, addressee_id, status) VALUES (?, ?, ?)').run(a, b, status);
connect(moussa, fatou);
connect(awa, moussa);
connect(ibrahima, moussa, 'pending');

db.prepare('INSERT INTO posts (author_id, content) VALUES (?, ?)').run(awa, 'Teranga Tech recrute ! 2 postes ouverts à Dakar, postulez directement sur Jokko 🚀');
db.prepare('INSERT INTO posts (author_id, content) VALUES (?, ?)').run(fatou, 'Heureuse d’avoir terminé ma certification Power BI !');

console.log('Données de démonstration créées. Mot de passe de tous les comptes : motdepasse123');
console.log('  Recruteur : rh@teranga.test (PME)   Candidat : moussa@candidat.test   Admin : admin@jokko.test');
