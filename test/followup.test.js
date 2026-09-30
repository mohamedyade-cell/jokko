const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');
const { makeApp, csrf, register, createJob, userId } = require('./helpers');
const iv = require('../src/interviews');

// Date locale (champ datetime-local) dans n jours à 10 h 30.
function localIn(days) {
  const d = new Date(Date.now() + days * 86400000);
  return `${d.toISOString().slice(0, 10)}T10:30`;
}

describe('Suivi après déblocage : entretiens, messagerie, notifications', () => {
  let app;
  let db;
  let recruiter;
  let candidate;
  let other;
  let appId;

  before(async () => {
    app = makeApp();
    db = app.locals.db;
    recruiter = await register(app, { role: 'recruiter', email: 'rh@pme.sn', name: 'Awa RH', company: 'PME Dakar' });
    candidate = await register(app, { role: 'candidate', email: 'moussa@test.sn', name: 'Moussa Diop' });
    other = await register(app, { role: 'recruiter', email: 'rh@autre.sn', name: 'Autre', company: 'Autre SA' });
    const jobId = await createJob(recruiter, { title: 'Comptable' });
    const _csrf = await csrf(candidate, `/jobs/${jobId}`);
    await candidate.post(`/jobs/${jobId}/apply`).field('_csrf', _csrf);
    appId = db.prepare('SELECT id FROM applications').get().id;
  });

  test('nouvelle candidature notifiée au recruteur ; pas de messagerie avant déblocage', async () => {
    let res = await recruiter.get('/notifications');
    assert.match(res.text, /Nouvelle candidature · Comptable/);
    assert.match(res.text, /Reçue via Jokko/);
    assert.match((await recruiter.get('/ats')).text, /class="bell[^"]*"[^>]*>🔔<span class="badge">1<\/span>/);

    assert.equal((await candidate.get(`/messages/${appId}`)).status, 404);
    const _csrf = await csrf(recruiter, `/ats/applications/${appId}`);
    res = await recruiter.post(`/ats/applications/${appId}/interviews`).type('form').send({ _csrf, starts_at: localIn(3), mode: 'visio' });
    assert.equal(res.status, 404);
  });

  test('retenir la candidature prévient le candidat et ouvre la conversation', async () => {
    const _csrf = await csrf(recruiter, `/ats/applications/${appId}`);
    await recruiter.post(`/ats/applications/${appId}/retain`).type('form').send({ _csrf });
    const res = await candidate.get('/notifications');
    assert.match(res.text, /Candidature retenue par PME Dakar/);
    assert.equal((await candidate.get(`/messages/${appId}`)).status, 200);

    // La notification mène à la conversation et passe en « lue ».
    const n = db.prepare("SELECT id FROM notifications WHERE user_id = ? AND type = 'unlock'").get(userId(app, 'moussa@test.sn'));
    const open = await candidate.get(`/notifications/${n.id}`);
    assert.equal(open.headers.location, `/messages/${appId}`);
    assert.ok(db.prepare('SELECT read_at FROM notifications WHERE id = ?').get(n.id).read_at);
  });

  test('messagerie : échange, notification et compteurs de non-lus', async () => {
    let _csrf = await csrf(recruiter, `/messages/${appId}`);
    await recruiter.post(`/messages/${appId}`).type('form').send({ _csrf, body: 'Bonjour Moussa, êtes-vous disponible cette semaine ?' });

    let res = await candidate.get('/messages');
    assert.match(res.text, /PME Dakar/);
    assert.match(res.text, /êtes-vous disponible/);
    assert.match(res.text, /Messages <span class="badge">1<\/span>/);
    assert.match((await candidate.get('/notifications')).text, /Nouveau message de PME Dakar/);

    // Lire la conversation remet le compteur à zéro ; le recruteur voit « Lu ».
    await candidate.get(`/messages/${appId}`);
    assert.doesNotMatch((await candidate.get('/messages')).text, /Messages <span class="badge">/);
    assert.match((await recruiter.get(`/messages/${appId}`)).text, /Lu/);

    _csrf = await csrf(candidate, `/messages/${appId}`);
    await candidate.post(`/messages/${appId}`).type('form').send({ _csrf, body: 'Oui, <b>mardi</b> matin.' });
    res = await recruiter.get(`/messages/${appId}`);
    assert.match(res.text, /Oui, &lt;b&gt;mardi&lt;\/b&gt; matin\./);
    assert.match((await recruiter.get('/notifications')).text, /Nouveau message de Moussa Diop/);
  });

  test('entretien : proposé, passage à l’étape Entretien, confirmé par le candidat, agenda .ics', async () => {
    let _csrf = await csrf(recruiter, `/ats/applications/${appId}`);
    let res = await recruiter.post(`/ats/applications/${appId}/interviews`).type('form').send({ _csrf, starts_at: localIn(-2), mode: 'visio' });
    assert.match((await recruiter.get(`/ats/applications/${appId}`)).text, /déjà passée/);
    await recruiter.post(`/ats/applications/${appId}/interviews`).type('form').send({ _csrf, starts_at: '2026-02-31T10:00', mode: 'visio' });
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM interviews').get().n, 0);

    res = await recruiter
      .post(`/ats/applications/${appId}/interviews`)
      .type('form')
      .send({ _csrf, starts_at: localIn(3), duration_min: '60', mode: 'visio', location: 'https://meet.example.com/abc', notes: 'Apportez vos diplômes.' });
    assert.equal(res.status, 302);
    const interview = db.prepare('SELECT * FROM interviews').get();
    assert.equal(interview.status, 'proposed');
    assert.equal(interview.starts_at, `${localIn(3).replace('T', ' ')}:00`, 'heure de Dakar = GMT');
    assert.equal(db.prepare('SELECT stage FROM applications WHERE id = ?').get(appId).stage, 'entretien');

    res = await candidate.get('/applications');
    assert.match(res.text, /Mes prochains entretiens/);
    assert.match(res.text, /À confirmer/);
    res = await candidate.get(`/messages/${appId}`);
    assert.match(res.text, /Lien de la réunion/);
    assert.match(res.text, /Apportez vos diplômes/);

    _csrf = await csrf(candidate, `/messages/${appId}`);
    await candidate.post(`/interviews/${interview.id}/respond`).type('form').send({ _csrf, decision: 'confirm', note: 'Merci, à mardi.' });
    assert.equal(db.prepare('SELECT status FROM interviews WHERE id = ?').get(interview.id).status, 'confirmed');
    res = await recruiter.get('/notifications');
    assert.match(res.text, /Moussa Diop a confirmé l&#39;entretien/);
    assert.match((await recruiter.get('/ats/interviews')).text, /Moussa Diop[\s\S]*Confirmé/);
    assert.match((await recruiter.get('/ats')).text, /Prochains entretiens[\s\S]*✓ confirmé/);

    res = await candidate.get(`/interviews/${interview.id}.ics`);
    assert.equal(res.status, 200);
    assert.match(res.headers['content-type'], /text\/calendar/);
    assert.match(res.text, /BEGIN:VEVENT[\s\S]*SUMMARY:Entretien PME Dakar – Comptable/);
    assert.match(res.text, new RegExp(`DTSTART:${localIn(3).replace(/-/g, '').replace(':', '')}00Z`));
    assert.match(res.text, /LOCATION:https:\/\/meet\.example\.com\/abc/);
  });

  test('changement d’étape et annulation d’entretien notifiés au candidat', async () => {
    const _csrf = await csrf(recruiter, `/ats/applications/${appId}`);
    await recruiter.post(`/ats/applications/${appId}/stage`).set('X-CSRF-Token', _csrf).send({ stage: 'offre' });
    assert.match((await candidate.get('/notifications')).text, /Comptable : Offre/);

    const interview = db.prepare('SELECT id FROM interviews').get();
    await recruiter.post(`/ats/interviews/${interview.id}/cancel`).type('form').send({ _csrf });
    assert.equal(db.prepare('SELECT status FROM interviews WHERE id = ?').get(interview.id).status, 'cancelled');
    assert.match((await candidate.get('/notifications')).text, /Entretien annulé · PME Dakar/);

    await recruiter.post(`/ats/applications/${appId}/stage`).set('X-CSRF-Token', _csrf).send({ stage: 'refuse' });
    const res = await candidate.get('/notifications');
    assert.match(res.text, /Comptable : Non retenue/);
    assert.doesNotMatch(res.text, /Rejeté/);
  });

  test('cloisonnement : ni une autre entreprise ni un autre candidat n’accèdent au fil', async () => {
    const intruder = await register(app, { role: 'candidate', email: 'intrus@test.sn', name: 'Intrus' });
    const interview = db.prepare('SELECT id FROM interviews').get();
    for (const agent of [other, intruder]) {
      assert.equal((await agent.get(`/messages/${appId}`)).status, 404);
      assert.equal((await agent.get(`/interviews/${interview.id}.ics`)).status, 404);
      const _csrf = await csrf(agent, '/messages');
      assert.equal((await agent.post(`/messages/${appId}`).type('form').send({ _csrf, body: 'spam' })).status, 404);
    }
    assert.doesNotMatch((await other.get('/messages')).text, /Moussa/);
    const _csrf = await csrf(other, '/messages');
    assert.equal((await other.post(`/ats/interviews/${interview.id}/cancel`).type('form').send({ _csrf })).status, 404);
    const intruderCsrf = await csrf(intruder, '/messages');
    assert.equal((await intruder.post(`/interviews/${interview.id}/respond`).type('form').send({ _csrf: intruderCsrf, decision: 'confirm' })).status, 404);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM messages WHERE body = 'spam'").get().n, 0);

    // Une notification d'un autre utilisateur n'est ni lisible ni utilisable comme redirection.
    const n = db.prepare('SELECT id FROM notifications WHERE user_id = ?').get(userId(app, 'moussa@test.sn'));
    assert.equal((await intruder.get(`/notifications/${n.id}`)).headers.location, '/notifications');
  });

  test('heures : fuseau de la plateforme configurable', () => {
    assert.equal(iv.toSql(iv.parseLocal('2026-10-05T10:30', 'Africa/Dakar')), '2026-10-05 10:30:00');
    assert.equal(iv.toSql(iv.parseLocal('2026-10-05T10:30', 'Africa/Douala')), '2026-10-05 09:30:00');
    assert.equal(iv.parseLocal('2026-02-30T10:30'), null);
    assert.match(iv.formatWhen('2026-10-05 10:30:00'), /lundi 5 octobre (à )?10:30/);
  });
});
