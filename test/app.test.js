const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { TOKEN, makeApp, csrf, register, createJob } = require('./helpers');

describe('Jokko', () => {
  let app;
  let recruiter;
  let candidate;
  let jobId;

  before(async () => {
    app = makeApp();
    recruiter = await register(app, { role: 'recruiter', email: 'rh@acme.test', name: 'Awa RH', company: 'Acme' });
    candidate = await register(app, { role: 'candidate', email: 'moussa@test.sn', name: 'Moussa Diop' });
    jobId = await createJob(recruiter);
  });

  test('la page d’accueil publique s’affiche', async () => {
    const res = await request(app).get('/');
    assert.equal(res.status, 200);
    assert.match(res.text, /réseau professionnel/);
  });

  test('les requêtes POST sans jeton CSRF sont refusées', async () => {
    const res = await candidate.post('/posts').type('form').send({ content: 'hello' });
    assert.equal(res.status, 403);
  });

  test('recherche d’offres par mot-clé, ville et contrat', async () => {
    let res = await request(app).get('/jobs').query({ q: 'Node', location: 'Dakar', contract: 'CDI' });
    assert.match(res.text, /Développeur Node\.js/);
    res = await request(app).get('/jobs').query({ contract: 'Stage' });
    assert.doesNotMatch(res.text, /Développeur Node\.js/);
  });

  test('un candidat ne peut pas accéder à l’ATS', async () => {
    const res = await candidate.get('/ats');
    assert.equal(res.status, 403);
  });

  test('un candidat postule avec CV : candidature reçue, masquée, puis retenue dans le pipeline', async () => {
    const _csrf = await csrf(candidate, `/jobs/${jobId}`);
    let res = await candidate
      .post(`/jobs/${jobId}/apply`)
      .field('_csrf', _csrf)
      .field('cover_letter', 'Très motivé')
      .attach('cv', Buffer.from('%PDF-1.4 test'), 'cv.pdf');
    assert.equal(res.status, 302);

    res = await candidate.get('/applications');
    assert.match(res.text, /Développeur Node\.js/);
    assert.match(res.text, /Envoyée/);

    // Avant déblocage : nom abrégé, pas d'e-mail, pas de CV.
    const appId = app.locals.db.prepare("SELECT id FROM applications WHERE candidate_email = 'moussa@test.sn'").get().id;
    res = await recruiter.get(`/ats/jobs/${jobId}`);
    assert.match(res.text, /Candidatures reçues \(1\)/);
    assert.match(res.text, /Moussa D\./);
    res = await recruiter.get(`/ats/applications/${appId}`);
    assert.doesNotMatch(res.text, /moussa@test\.sn/);
    assert.equal((await recruiter.get(`/ats/applications/${appId}/cv`)).status, 404);
    const csrfR = await csrf(recruiter, `/ats/applications/${appId}`);
    res = await recruiter.post(`/ats/applications/${appId}/stage`).set('X-CSRF-Token', csrfR).send({ stage: 'entretien' });
    assert.equal(res.status, 409);

    // Retenir = déblocage gratuit, entrée dans le pipeline à l'étape « Nouveau ».
    await recruiter.post(`/ats/applications/${appId}/retain`).type('form').send({ _csrf: csrfR });
    res = await recruiter.get(`/ats/applications/${appId}`);
    assert.match(res.text, /moussa@test\.sn/);
    assert.equal(app.locals.db.prepare('SELECT stage FROM applications WHERE id = ?').get(appId).stage, 'nouveau');
    const unlock = app.locals.db.prepare('SELECT charged FROM unlocks WHERE candidate_id = (SELECT candidate_id FROM applications WHERE id = ?)').get(appId);
    assert.equal(unlock.charged, 0);

    // Deuxième candidature refusée
    const _csrf2 = await csrf(candidate, `/jobs/${jobId}`);
    res = await candidate.post(`/jobs/${jobId}/apply`).field('_csrf', _csrf2);
    const count = app.locals.db.prepare('SELECT COUNT(*) AS n FROM applications WHERE job_id = ?').get(jobId).n;
    assert.equal(count, 1);
  });

  test('un CV au mauvais format est refusé', async () => {
    const other = await register(app, { role: 'candidate', email: 'fatou@test.sn', name: 'Fatou Sow' });
    const _csrf = await csrf(other, `/jobs/${jobId}`);
    const res = await other.post(`/jobs/${jobId}/apply`).field('_csrf', _csrf).attach('cv', Buffer.from('MZ'), 'virus.exe');
    assert.equal(res.status, 400);
  });

  test('le recruteur déplace une candidature, la note et commente', async () => {
    const appId = app.locals.db.prepare("SELECT id FROM applications WHERE candidate_email = 'moussa@test.sn'").get().id;
    const _csrf = await csrf(recruiter, `/ats/applications/${appId}`);

    let res = await recruiter.post(`/ats/applications/${appId}/stage`).set('X-CSRF-Token', _csrf).send({ stage: 'entretien' });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { ok: true, stage: 'entretien' });

    res = await recruiter.post(`/ats/applications/${appId}/stage`).set('X-CSRF-Token', _csrf).send({ stage: 'nimportequoi' });
    assert.equal(res.status, 400);

    await recruiter.post(`/ats/applications/${appId}/rating`).type('form').send({ _csrf, rating: '4' });
    await recruiter.post(`/ats/applications/${appId}/notes`).type('form').send({ _csrf, content: 'Excellent entretien' });

    res = await recruiter.get(`/ats/applications/${appId}`);
    assert.match(res.text, /Excellent entretien/);
    assert.match(res.text, /Reçue → <strong>Nouveau<\/strong>/);
    assert.match(res.text, /Nouveau → <strong>Entretien<\/strong>/);

    const row = app.locals.db.prepare('SELECT stage, rating FROM applications WHERE id = ?').get(appId);
    assert.deepEqual({ ...row }, { stage: 'entretien', rating: 4 });

    res = await recruiter.get(`/ats/applications/${appId}/cv`);
    assert.equal(res.status, 200);
    assert.match(res.headers['content-disposition'], /cv\.pdf/);

    res = await candidate.get('/applications');
    assert.match(res.text, /Entretien/);
  });

  test('un recruteur d’une autre entreprise ne voit pas les candidatures, même en reprenant le même nom', async () => {
    // S'inscrire avec le nom d'une entreprise existante crée un espace séparé.
    const other = await register(app, { role: 'recruiter', email: 'rh@concurrent.test', name: 'Autre RH', company: 'Acme' });
    assert.equal((await other.get('/ats')).text.includes('Développeur Node.js'), false);
    const appId = app.locals.db.prepare('SELECT id FROM applications LIMIT 1').get().id;
    assert.equal((await other.get(`/ats/applications/${appId}`)).status, 404);
    assert.equal((await other.get(`/ats/applications/${appId}/cv`)).status, 404);
    assert.equal((await other.get(`/ats/jobs/${jobId}`)).status, 404);
  });

  test('flux XML Indeed et LinkedIn', async () => {
    const hidden = await createJob(recruiter, { title: 'Poste <interne> ]]> secret', publish_indeed: '', publish_linkedin: '' });

    let res = await request(app).get('/feeds/indeed.xml');
    assert.equal(res.status, 200);
    assert.match(res.headers['content-type'], /xml/);
    assert.match(res.text, /<referencenumber><!\[CDATA\[jokko-\d+\]\]><\/referencenumber>/);
    assert.match(res.text, /<jobtype><!\[CDATA\[fulltime\]\]><\/jobtype>/);
    assert.match(res.text, /https:\/\/jokko\.test\/jobs\/\d+\?utm_source=indeed/);
    assert.doesNotMatch(res.text, /secret/);

    res = await request(app).get('/feeds/linkedin.xml');
    assert.match(res.text, /<partnerJobId><!\[CDATA\[jokko-\d+\]\]><\/partnerJobId>/);
    assert.match(res.text, /<jobtype><!\[CDATA\[FULL_TIME\]\]><\/jobtype>/);
    assert.match(res.text, /<currencyCode><!\[CDATA\[XOF\]\]><\/currencyCode>/);
    assert.doesNotMatch(res.text, /secret/);

    // Une offre clôturée sort des flux
    const _csrf = await csrf(recruiter, `/ats/jobs/${jobId}`);
    await recruiter.post(`/ats/jobs/${jobId}/status`).type('form').send({ _csrf });
    res = await request(app).get('/feeds/indeed.xml');
    assert.doesNotMatch(res.text, new RegExp(`jokko-${jobId}\\]`));
    await recruiter.post(`/ats/jobs/${jobId}/status`).type('form').send({ _csrf });
    assert.ok(hidden);
  });

  test('webhook : candidature Indeed Apply avec CV', async () => {
    const payload = {
      id: 'indeed-apply-789',
      job: { jobId: `jokko-${jobId}` },
      applicant: {
        fullName: 'Cheikh Gueye',
        email: 'Cheikh@Example.com',
        phoneNumber: '+221770000000',
        resume: { file: { fileName: 'cheikh.pdf', contentType: 'application/pdf', data: Buffer.from('%PDF').toString('base64') } },
      },
    };
    let res = await request(app).post('/api/integrations/indeed/applications').send(payload);
    assert.equal(res.status, 401);

    res = await request(app).post('/api/integrations/indeed/applications').set('Authorization', `Bearer ${TOKEN}`).send(payload);
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const row = app.locals.db.prepare('SELECT * FROM applications WHERE id = ?').get(res.body.applicationId);
    assert.equal(row.source, 'indeed');
    assert.equal(row.candidate_email, 'cheikh@example.com');
    assert.equal(row.external_ref, 'indeed-apply-789');
    assert.equal(row.cv_original_name, 'cheikh.pdf');

    res = await request(app).post('/api/integrations/indeed/applications').set('Authorization', `Bearer ${TOKEN}`).send(payload);
    assert.equal(res.status, 200);
    assert.equal(res.body.duplicate, true);
  });

  test('webhook : candidature LinkedIn format générique, rattachée au compte existant', async () => {
    const res = await request(app)
      .post('/api/integrations/linkedin/applications')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ jobId: String(jobId), applicant: { firstName: 'Fatou', lastName: 'Sow', email: 'fatou@test.sn' } });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const row = app.locals.db.prepare('SELECT a.source, u.name FROM applications a JOIN users u ON u.id = a.candidate_id WHERE a.id = ?').get(res.body.applicationId);
    assert.deepEqual({ ...row }, { source: 'linkedin', name: 'Fatou Sow' });
  });

  test('webhook : validation des données', async () => {
    const auth = { Authorization: `Bearer ${TOKEN}` };
    assert.equal((await request(app).post('/api/integrations/monster/applications').set(auth).send({})).status, 404);
    assert.equal((await request(app).post('/api/integrations/linkedin/applications').set(auth).send({ jobId })).status, 400);
    assert.equal(
      (await request(app).post('/api/integrations/linkedin/applications').set(auth).send({ jobId: 99999, applicant: { name: 'X', email: 'x@y.z' } })).status,
      404,
    );
  });

  test('réseau : invitation, acceptation et fil d’actualité', async () => {
    const db = app.locals.db;
    const recruiterId = db.prepare("SELECT id FROM users WHERE email = 'rh@acme.test'").get().id;

    let _csrf = await csrf(recruiter, '/');
    await recruiter.post('/posts').type('form').send({ _csrf, content: 'Nous recrutons à Dakar !' });

    // Pas encore en relation : la publication n'apparaît pas dans le fil du candidat
    let res = await candidate.get('/');
    assert.doesNotMatch(res.text, /Nous recrutons à Dakar/);

    _csrf = await csrf(candidate, '/network');
    await candidate.post(`/network/connect/${recruiterId}`).type('form').send({ _csrf });

    res = await recruiter.get('/network');
    assert.match(res.text, /Invitations \(1\)/);
    const invitationId = db.prepare("SELECT id FROM connections WHERE addressee_id = ? AND status = 'pending'").get(recruiterId).id;
    _csrf = await csrf(recruiter, '/network');
    await recruiter.post(`/network/invitations/${invitationId}/accept`).type('form').send({ _csrf });

    res = await candidate.get('/');
    assert.match(res.text, /Nous recrutons à Dakar/);

    res = await candidate.get(`/profile/${recruiterId}`);
    assert.match(res.text, /En relation/);
  });

  test('profil : mise à jour et échappement HTML', async () => {
    const _csrf = await csrf(candidate, '/profile/edit');
    await candidate
      .post('/profile/edit')
      .type('form')
      .send({ _csrf, name: 'Moussa Diop', headline: '<script>alert(1)</script>', skills: 'Node.js, React' });
    const id = app.locals.db.prepare("SELECT id FROM users WHERE email = 'moussa@test.sn'").get().id;
    const res = await candidate.get(`/profile/${id}`);
    assert.doesNotMatch(res.text, /<script>alert/);
    assert.match(res.text, /&lt;script&gt;/);
    assert.match(res.text, /React/);
  });

  test('connexion : identifiants invalides et redirection sûre', async () => {
    const agent = request.agent(app);
    let _csrf = await csrf(agent);
    let res = await agent.post('/login').type('form').send({ _csrf, email: 'moussa@test.sn', password: 'mauvais' });
    assert.equal(res.status, 401);

    _csrf = await csrf(agent);
    res = await agent.post('/login').type('form').send({ _csrf, email: 'moussa@test.sn', password: 'motdepasse123', next: '//evil.com' });
    assert.equal(res.headers.location, '/');
  });
});
