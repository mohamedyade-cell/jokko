const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const request = require('supertest');
const { makeApp, csrf, register, createJob, userId, importFixture } = require('./helpers');
const { grantBadge } = require('../src/score');

function attemptRow(app, id) {
  const row = app.locals.db.prepare('SELECT * FROM quiz_attempts WHERE id = ?').get(id);
  return { ...row, questions: JSON.parse(row.questions) };
}

// Position affichée de la bonne réponse (après mélange des réponses).
function correctPos(app, attemptId) {
  const a = attemptRow(app, attemptId);
  const entry = a.questions[a.current_index];
  const { answer_index: answer } = app.locals.db.prepare('SELECT answer_index FROM quiz_questions WHERE id = ?').get(entry.q);
  return entry.order.indexOf(answer);
}

// Badges de la banque fictive : T01 Excel Débutant, T02 Excel Intermédiaire, T03 Comptabilité,
// T04 Service client, T05 Sécurité, T06 Word (3 questions : non proposé).
async function startQuiz(agent, badgeCode) {
  const _csrf = await csrf(agent, '/skills');
  const res = await agent.post(`/skills/${badgeCode}/start`).type('form').send({ _csrf });
  assert.equal(res.status, 302);
  return res.headers.location;
}

async function answer(app, agent, attemptId, { correct = true } = {}) {
  const page = await agent.get(`/quiz/${attemptId}`);
  const index = Number(page.text.match(/name="index" value="(\d+)"/)[1]);
  const _csrf = page.text.match(/name="_csrf" value="([a-f0-9]+)"/)[1];
  const pos = correctPos(app, attemptId);
  const choice = correct ? pos : (pos + 1) % 4;
  return agent.post(`/quiz/${attemptId}/answer`).type('form').send({ _csrf, index, choice });
}

async function finishQuiz(app, agent, attemptId, correctCount) {
  const total = attemptRow(app, attemptId).questions.length;
  for (let i = 0; i < total; i++) await answer(app, agent, attemptId, { correct: i < correctCount });
  return attemptRow(app, attemptId);
}

describe('Pilier 2 et 3 : quiz, badges et Jokko Score', () => {
  let app;
  let candidate;

  before(async () => {
    app = makeApp();
    importFixture(app);
    candidate = await register(app, { role: 'candidate', email: 'awa@test.sn', name: 'Awa Diallo' });
  });

  test('un quiz réussi débloque un badge et fait monter le score', async () => {
    const location = await startQuiz(candidate, 'JKB-T01');
    const attemptId = Number(location.split('/').pop());
    const attempt = attemptRow(app, attemptId);
    assert.equal(attempt.questions.length, 10, '10 questions tirées parmi les 14 du badge');
    assert.equal(new Set(attempt.questions.map((q) => q.q)).size, 10, 'questions distinctes');

    // La page de question ne révèle pas la bonne réponse et démarre le chronomètre.
    const page = await candidate.get(location);
    assert.match(page.text, /Question 1 sur 10/);
    assert.match(page.text, /Question \d+ ; « Excel Débutant » \?/);
    assert.doesNotMatch(page.text, /data-correct|"answer"|correct_count/i);
    assert.ok(attemptRow(app, attemptId).question_served_ms);

    const done = await finishQuiz(app, candidate, attemptId, 10);
    assert.equal(done.status, 'passed');
    assert.equal(done.correct_count, 10);

    const res = await candidate.get(location);
    assert.match(res.text, /Badge débloqué/);
    const badge = app.locals.db.prepare("SELECT * FROM badges WHERE user_id = ? AND skill_key = 'quiz:excel'").get(userId(app, 'awa@test.sn'));
    assert.equal(badge.level, 'debutant');
    assert.equal(badge.points, 10);
    assert.ok(badge.expires_at > new Date().toISOString().slice(0, 10));

    const skills = await candidate.get('/skills');
    assert.match(skills.text, /<strong>10 \/ 100<\/strong>/);
    // Badge valide : pas de nouvelle tentative possible avant la fenêtre de renouvellement.
    const again = await startQuiz(candidate, 'JKB-T01');
    assert.equal(again, '/skills');
  });

  test('le catalogue vient de la banque importée ; un badge avec trop peu de questions n’est pas proposé', async () => {
    const page = await candidate.get('/skills');
    assert.match(page.text, /Sécurité au travail/);
    assert.match(page.text, /<h3>Excel<\/h3>/);
    assert.doesNotMatch(page.text, /<h3>Word<\/h3>/);
    assert.equal(await startQuiz(candidate, 'JKB-T06'), '/skills');
    assert.equal(await startQuiz(candidate, 'JKB-INCONNU'), '/skills');
    const filtered = await candidate.get('/skills').query({ q: 'secur' });
    assert.match(filtered.text, /Sécurité au travail/);
    assert.doesNotMatch(filtered.text, /<h3>Excel<\/h3>/);
  });

  test('une réponse hors délai compte comme fausse, un double envoi est ignoré', async () => {
    const attemptId = Number((await startQuiz(candidate, 'JKB-T05')).split('/').pop());
    await candidate.get(`/quiz/${attemptId}`);
    // Simule une réponse 2 minutes après l'affichage (limite : 30 s + 5 s de tolérance).
    app.locals.db.prepare('UPDATE quiz_attempts SET question_served_ms = ? WHERE id = ?').run(Date.now() - 120000, attemptId);
    const pos = correctPos(app, attemptId);
    const _csrf = await csrf(candidate, '/skills');
    await candidate.post(`/quiz/${attemptId}/answer`).type('form').send({ _csrf, index: 0, choice: pos });
    let a = attemptRow(app, attemptId);
    assert.equal(a.current_index, 1);
    assert.equal(a.correct_count, 0);

    // Renvoyer la réponse à la question 0 ne change rien.
    await candidate.post(`/quiz/${attemptId}/answer`).type('form').send({ _csrf, index: 0, choice: pos });
    a = attemptRow(app, attemptId);
    assert.equal(a.current_index, 1);
  });

  test('abandonner un quiz compte comme un échec, puis délai d’attente avant de retenter', async () => {
    const first = Number((await startQuiz(candidate, 'JKB-T03')).split('/').pop());
    const second = Number((await startQuiz(candidate, 'JKB-T04')).split('/').pop());
    assert.notEqual(first, second);
    assert.equal(attemptRow(app, first).status, 'failed');

    // Retenter le quiz abandonné est bloqué pendant le délai d'attente.
    const blocked = await startQuiz(candidate, 'JKB-T03');
    assert.equal(blocked, '/skills');
    const page = await candidate.get('/skills');
    assert.match(page.text, /Nouvel essai possible le/);

    // Après le délai, c'est de nouveau possible.
    app.locals.db.prepare("UPDATE quiz_attempts SET finished_at = datetime('now', '-4 days') WHERE id = ?").run(first);
    const retry = await startQuiz(candidate, 'JKB-T03');
    assert.match(retry, /^\/quiz\/\d+$/);
  });

  test('un score sous le seuil fait échouer le quiz sans badge', async () => {
    const attemptId = Number((await startQuiz(candidate, 'JKB-T02')).split('/').pop());
    const done = await finishQuiz(app, candidate, attemptId, 8); // 8/12 = 67 % < 70 %
    assert.equal(done.status, 'failed');
    const badge = app.locals.db.prepare("SELECT 1 FROM badges WHERE user_id = ? AND level = 'intermediaire'").get(userId(app, 'awa@test.sn'));
    assert.equal(badge, undefined);
    assert.match((await candidate.get(`/quiz/${attemptId}`)).text, /Pas cette fois/);
  });

  test('score compétences plafonné à 100, parrainage compté à part', async () => {
    const db = app.locals.db;
    const code = db.prepare("SELECT referral_code FROM users WHERE email = 'awa@test.sn'").get().referral_code;
    await register(app, { role: 'candidate', email: 'filleul1@test.sn', name: 'Filleul Un', ref: code });
    await register(app, { role: 'candidate', email: 'filleul2@test.sn', name: 'Filleul Deux', ref: code.toLowerCase() });

    const id = userId(app, 'filleul1@test.sn');
    for (let i = 0; i < 6; i++) grantBadge(db, { userId: id, kind: 'certification', skillKey: `cert:${i}`, label: `Cert ${i}`, points: 20 });
    // Un badge expiré ne compte pas ; un doublon de compétence ne compte qu'une fois.
    grantBadge(db, { userId: id, kind: 'quiz', skillKey: 'quiz:excel', label: 'Excel', level: 'avance', points: 30, expiresAt: '2000-01-01 00:00:00' });
    grantBadge(db, { userId: id, kind: 'certification', skillKey: 'cert:0', label: 'Cert 0 bis', points: 20 });

    const { getScore } = require('../src/score');
    assert.equal(getScore(db, id).skills, 100);
    const sponsor = getScore(db, userId(app, 'awa@test.sn'));
    assert.equal(sponsor.referrals, 2);
    assert.equal(sponsor.referral, 20);
    assert.equal(sponsor.skills, 10, 'badge Excel Débutant du premier test ; le parrainage ne gonfle pas cette composante');
  });
});

describe('Pilier 3 : certifications et Jokko Campus vérifiées par l’équipe Jokko', () => {
  test('certification et école déclarées puis vérifiées deviennent des badges', async () => {
    const app = makeApp({ adminEmails: 'admin@jokko.test' });
    const db = app.locals.db;
    db.prepare("INSERT INTO schools (name, city) VALUES ('ISM Dakar', 'Dakar')").run();
    const admin = await register(app, { role: 'recruiter', email: 'admin@jokko.test', name: 'Équipe Jokko', company: 'Jokko' });
    const candidate = await register(app, { role: 'candidate', email: 'binta@test.sn', name: 'Binta Kane' });

    let _csrf = await csrf(candidate, '/profile/credentials');
    let res = await candidate
      .post('/profile/credentials')
      .field('_csrf', _csrf)
      .field('type', 'certification')
      .field('title', 'TOEIC 850')
      .field('issuer', 'ETS Global')
      .attach('proof', Buffer.from('%PDF'), 'toeic.pdf');
    assert.equal(res.status, 302);
    const schoolId = db.prepare('SELECT id FROM schools').get().id;
    await candidate.post('/profile/credentials').field('_csrf', _csrf).field('type', 'campus').field('school_id', String(schoolId)).field('title', 'Licence Comptabilité');
    assert.match((await candidate.get('/profile/credentials')).text, /En cours de vérification/);

    // Seule l'équipe Jokko accède à l'administration.
    assert.equal((await candidate.get('/admin')).status, 403);
    res = await admin.get('/admin');
    assert.match(res.text, /TOEIC 850/);
    const [cert, campus] = db.prepare('SELECT id FROM credentials ORDER BY id').all();
    assert.equal((await admin.get(`/admin/credentials/${cert.id}/proof`)).status, 200);

    _csrf = await csrf(admin, '/admin');
    await admin.post(`/admin/credentials/${cert.id}/verify`).type('form').send({ _csrf });
    await admin.post(`/admin/credentials/${campus.id}/verify`).type('form').send({ _csrf });

    const badges = db.prepare('SELECT kind, label, points FROM badges WHERE user_id = ? ORDER BY kind').all(userId(app, 'binta@test.sn'));
    assert.deepEqual(
      badges.map((b) => ({ ...b })),
      [
        { kind: 'campus', label: 'Jokko Campus · ISM Dakar', points: 15 },
        { kind: 'certification', label: 'TOEIC 850', points: 20 },
      ],
    );
    const profile = await candidate.get(`/profile/${userId(app, 'binta@test.sn')}`);
    assert.match(profile.text, /TOEIC 850/);
    assert.match(profile.text, /style="--p: 35"/);
  });
});

describe('Pilier 4 : CVthèque, déblocage du CV et offres PME / Corporate', () => {
  let app;
  let recruiter;
  let jobId;

  before(async () => {
    app = makeApp();
    importFixture(app);
    const db = app.locals.db;
    recruiter = await register(app, { role: 'recruiter', email: 'rh@pme.sn', name: 'RH PME', company: 'PME Dakar' });
    jobId = await createJob(recruiter, { title: 'Assistant comptable', contract_type: 'CDD' });

    const people = [
      ['aida@test.sn', 'Aïda Sy', 'Assistante comptable', 'Dakar', 1, [['comptabilite', 'intermediaire', 20], ['excel', 'avance', 30]]],
      ['bara@test.sn', 'Bara Ndoye', 'Comptable junior', 'Dakar', 0, [['comptabilite', 'debutant', 10]]],
      ['coumba@test.sn', 'Coumba Diouf', 'Caissière', 'Thiès', 1, [['service-client', 'avance', 30]]],
    ];
    for (const [email, name, headline, location, available, badges] of people) {
      const agent = await register(app, { role: 'candidate', email, name });
      const _csrf = await csrf(agent, '/profile/edit');
      await agent.post('/profile/edit').type('form').send({ _csrf, name, headline, location, phone: '+221 70 000 00 00', available_now: available ? '1' : '' });
      await agent.post('/profile/experiences').type('form').send({ _csrf, title: 'Stage', company: 'Cabinet Secret SARL' });
      const id = userId(app, email);
      for (const [slug, level, points] of badges) grantBadge(db, { userId: id, kind: 'quiz', skillKey: `quiz:${slug}`, label: slug, level, points });
    }
  });

  test('filtre par badge et niveau minimum, tri par Jokko Score, noms abrégés', async () => {
    let res = await recruiter.get('/ats/talents').query({ badge: 'quiz:comptabilite', level: 'intermediaire', location: 'Dakar' });
    assert.match(res.text, /Aïda S\./);
    assert.doesNotMatch(res.text, /Bara N\./);
    assert.doesNotMatch(res.text, /Aïda Sy</);

    res = await recruiter.get('/ats/talents');
    const order = ['Aïda S.', 'Coumba D.', 'Bara N.'].map((n) => res.text.indexOf(n));
    assert.ok(order.every((i) => i > 0) && order[0] < order[1] && order[1] < order[2], `ordre par score : ${order}`);

    res = await recruiter.get('/ats/talents').query({ min_score: '40' });
    assert.match(res.text, /1 profil /);
  });

  test('besoin urgent : seulement les candidats disponibles, classés par score', async () => {
    const res = await recruiter.get('/ats/urgent');
    assert.match(res.text, /Aïda S\./);
    assert.match(res.text, /Coumba D\./);
    assert.doesNotMatch(res.text, /Bara N\./);
    assert.ok(res.text.indexOf('Aïda S.') < res.text.indexOf('Coumba D.'));
  });

  test('profil masqué avant déblocage, complet après, et candidat ajouté au pipeline', async () => {
    const aida = userId(app, 'aida@test.sn');
    let res = await recruiter.get(`/profile/${aida}`);
    assert.match(res.text, /CV complet verrouillé/);
    assert.doesNotMatch(res.text, /aida@test\.sn/);
    assert.doesNotMatch(res.text, /Cabinet Secret SARL/);
    assert.doesNotMatch(res.text, /\+221 70/);

    const _csrf = await csrf(recruiter, `/profile/${aida}`);
    res = await recruiter.post(`/ats/talents/${aida}/unlock`).type('form').send({ _csrf, job_id: String(jobId) });
    assert.equal(res.status, 302);
    assert.match(res.headers.location, /^\/ats\/applications\/\d+$/);

    const application = app.locals.db.prepare('SELECT * FROM applications WHERE candidate_id = ?').get(aida);
    assert.equal(application.stage, 'nouveau');
    assert.equal(application.source, 'sourcing');

    res = await recruiter.get(`/profile/${aida}`);
    assert.match(res.text, /aida@test\.sn/);
    assert.match(res.text, /Cabinet Secret SARL/);
    res = await recruiter.get(`/ats/jobs/${jobId}`);
    assert.match(res.text, /Aïda Sy/);

    // Débloquer à nouveau ne consomme pas de crédit.
    await recruiter.post(`/ats/talents/${aida}/unlock`).type('form').send({ _csrf, job_id: String(jobId) });
    assert.equal(app.locals.db.prepare('SELECT COUNT(*) AS n FROM unlocks WHERE charged = 1').get().n, 1);
  });

  test('une autre entreprise ne voit ni le déblocage ni le pipeline', async () => {
    const other = await register(app, { role: 'recruiter', email: 'rh@autre.sn', name: 'Autre', company: 'PME Dakar' });
    const aida = userId(app, 'aida@test.sn');
    const res = await other.get(`/profile/${aida}`);
    assert.match(res.text, /CV complet verrouillé/);
    assert.doesNotMatch(res.text, /aida@test\.sn/);
    assert.equal((await other.get(`/profile/${aida}/cv`)).status, 404);
    const appId = app.locals.db.prepare('SELECT id FROM applications WHERE candidate_id = ?').get(aida).id;
    assert.equal((await other.get(`/ats/applications/${appId}`)).status, 404);
  });

  test('offre PME : quota mensuel de déblocages et 3 offres ouvertes maximum ; Corporate illimité', async () => {
    const db = app.locals.db;
    const companyId = db.prepare("SELECT company_id FROM users WHERE email = 'rh@pme.sn'").get().company_id;
    // 9 déblocages facturés en plus de celui d'Aïda = quota de 10 atteint.
    for (let i = 0; i < 9; i++) {
      const u = db.prepare("INSERT INTO users (email, password_hash, role, name) VALUES (?, 'x', 'candidate', ?)").run(`q${i}@test.sn`, `Quota ${i}`);
      db.prepare('INSERT INTO unlocks (company_id, candidate_id, charged) VALUES (?, ?, 1)').run(companyId, Number(u.lastInsertRowid));
    }
    const _csrf = await csrf(recruiter, '/ats/talents');
    const bara = userId(app, 'bara@test.sn');
    let res = await recruiter.post(`/ats/talents/${bara}/unlock`).type('form').send({ _csrf, job_id: String(jobId) });
    assert.equal(res.headers.location, '/ats/talents');
    assert.match((await recruiter.get('/ats/talents')).text, /Quota de déblocages du mois atteint/);
    assert.equal(db.prepare('SELECT 1 FROM unlocks WHERE candidate_id = ?').get(bara), undefined);

    await createJob(recruiter, { title: 'Poste 2' });
    await createJob(recruiter, { title: 'Poste 3' });
    res = await recruiter.post('/ats/jobs').type('form').send({ _csrf, title: 'Poste 4', description: 'x', location: 'Dakar', contract_type: 'CDI' });
    assert.equal(res.status, 403);

    db.prepare("UPDATE companies SET plan = 'corporate' WHERE id = ?").run(companyId);
    res = await recruiter.post(`/ats/talents/${bara}/unlock`).type('form').send({ _csrf, job_id: String(jobId) });
    assert.match(res.headers.location, /^\/ats\/applications\/\d+$/);
    await createJob(recruiter, { title: 'Poste 4' });
  });
});

describe('Pilier 1 : pitch vidéo', () => {
  let app;
  let candidate;
  let id;
  const ffmpegDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jokko-ffmpeg-'));

  before(async () => {
    app = makeApp();
    candidate = await register(app, { role: 'candidate', email: 'pitch@test.sn', name: 'Pape Sarr' });
    id = userId(app, 'pitch@test.sn');
  });

  after(() => {
    delete process.env.FFMPEG_PATH;
  });

  test('envoi, affichage sur la carte profil et lecture en streaming', async () => {
    const _csrf = await csrf(candidate, '/profile/video');
    let res = await candidate
      .post('/profile/video')
      .set('Accept', 'application/json')
      .field('_csrf', _csrf)
      .field('language', 'wo')
      .field('duration', '88')
      .attach('video', Buffer.alloc(4096, 1), { filename: 'pitch.webm', contentType: 'video/webm' });
    assert.equal(res.status, 200, res.text);
    assert.deepEqual(res.body, { ok: true, redirect: `/profile/${id}` });

    res = await candidate.get(`/profile/${id}`);
    assert.match(res.text, new RegExp(`<video[^>]+src="/videos/${id}`));
    assert.match(res.text, /Wolof/);

    res = await candidate.get(`/videos/${id}`).set('Range', 'bytes=0-99');
    assert.equal(res.status, 206);
    assert.match(res.headers['content-type'], /video\/webm/);
    assert.equal(res.headers['content-length'], '100');

    // Réservé aux membres connectés.
    assert.equal((await request(app).get(`/videos/${id}`)).status, 302);
  });

  test('refus : pitch trop long, mauvais format, compte recruteur', async () => {
    const _csrf = await csrf(candidate, '/profile/video');
    let res = await candidate
      .post('/profile/video')
      .set('Accept', 'application/json')
      .field('_csrf', _csrf)
      .field('duration', '140')
      .attach('video', Buffer.alloc(100), { filename: 'long.webm', contentType: 'video/webm' });
    assert.equal(res.status, 400);

    res = await candidate.post('/profile/video').field('_csrf', _csrf).attach('video', Buffer.alloc(100), { filename: 'x.exe', contentType: 'application/octet-stream' });
    assert.equal(res.status, 400);

    const recruiter = await register(app, { role: 'recruiter', email: 'rh@x.sn', name: 'RH', company: 'X' });
    assert.equal((await recruiter.get('/profile/video')).status, 403);
    // …mais il peut regarder le pitch du candidat.
    assert.equal((await recruiter.get(`/videos/${id}`)).status, 200);
  });

  test('compression serveur optionnelle (FFMPEG_PATH) puis suppression', async () => {
    // Faux ffmpeg : copie l'entrée (argument après -i) vers la sortie (dernier argument).
    const fake = path.join(ffmpegDir, 'ffmpeg');
    fs.writeFileSync(fake, '#!/bin/sh\nin=""; prev=""; for a in "$@"; do [ "$prev" = "-i" ] && in="$a"; prev="$a"; last="$a"; done\ncp "$in" "$last"\n', { mode: 0o755 });
    process.env.FFMPEG_PATH = fake;

    const _csrf = await csrf(candidate, '/profile/video');
    await candidate
      .post('/profile/video')
      .set('Accept', 'application/json')
      .field('_csrf', _csrf)
      .attach('video', Buffer.alloc(2048, 2), { filename: 'phone.mov', contentType: 'video/quicktime' });

    let user;
    for (let i = 0; i < 50; i++) {
      user = app.locals.db.prepare('SELECT video_path, video_mime FROM users WHERE id = ?').get(id);
      if (user.video_path.endsWith('-480p.mp4')) break;
      await new Promise((r) => setTimeout(r, 20));
    }
    assert.match(user.video_path, /-480p\.mp4$/);
    assert.equal(user.video_mime, 'video/mp4');
    const dir = path.join(app.locals.config.uploadDir, 'videos');
    assert.deepEqual(fs.readdirSync(dir), [user.video_path], 'original et ancienne vidéo supprimés');

    await candidate.post('/profile/video/delete').type('form').send({ _csrf });
    assert.equal(app.locals.db.prepare('SELECT video_path FROM users WHERE id = ?').get(id).video_path, null);
    assert.equal((await candidate.get(`/videos/${id}`)).status, 404);
  });
});
