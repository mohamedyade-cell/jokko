const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const request = require('supertest');
const { createApp } = require('../src/app');

const TOKEN = 'test-integration-token';

function makeApp(options = {}) {
  const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jokko-uploads-'));
  return createApp({ dbPath: ':memory:', uploadDir, sessionSecret: 'test', baseUrl: 'https://jokko.test', integrationToken: TOKEN, ...options });
}

async function csrf(agent, url = '/login') {
  const res = await agent.get(url);
  const m = res.text.match(/name="_csrf" value="([a-f0-9]+)"/);
  assert.ok(m, `jeton CSRF introuvable sur ${url}`);
  return m[1];
}

async function register(app, { role, email, name, company, ref }) {
  const agent = request.agent(app);
  const _csrf = await csrf(agent, '/register');
  const res = await agent
    .post('/register')
    .type('form')
    .send({ _csrf, role, email, name, password: 'motdepasse123', company_name: company || '', ref: ref || '' });
  assert.equal(res.status, 302, res.text);
  return agent;
}

async function createJob(recruiter, fields = {}) {
  const _csrf = await csrf(recruiter, '/ats');
  const res = await recruiter
    .post('/ats/jobs')
    .type('form')
    .send({
      _csrf,
      title: 'Développeur Node.js',
      description: 'Construire des API.',
      location: 'Dakar',
      contract_type: 'CDI',
      salary_min: '900000',
      salary_max: '1200000',
      publish_linkedin: '1',
      publish_indeed: '1',
      ...fields,
    });
  assert.equal(res.status, 302, res.text);
  return Number(res.headers.location.split('/').pop());
}

function userId(app, email) {
  return app.locals.db.prepare('SELECT id FROM users WHERE email = ?').get(email).id;
}

module.exports = { TOKEN, makeApp, csrf, register, createJob, userId };

// Petite banque fictive au format Jokko (id_question;id_badge;domaine;competence;niveau;question;A;B;C;D;reponse;explication).
const FIXTURE_BADGES = [
  ['JKB-T01', 'Bureautique', 'Excel Débutant', 'Débutant', 14],
  ['JKB-T02', 'Bureautique', 'Excel Intermédiaire', 'Intermédiaire', 14],
  ['JKB-T03', 'Comptabilité & fiscalité', 'Comptabilité Débutant', 'Débutant', 10],
  ['JKB-T04', 'Service client', 'Service client', 'Débutant', 10],
  ['JKB-T05', 'Sécurité', 'Sécurité au travail', 'Débutant', 10],
  ['JKB-T06', 'Bureautique', 'Word Débutant', 'Débutant', 3],
];

function fixtureCsv() {
  const lines = ['﻿id_question;id_badge;domaine;competence;niveau;question;A;B;C;D;reponse;explication'];
  let n = 0;
  for (const [code, domain, competence, level, count] of FIXTURE_BADGES) {
    for (let i = 0; i < count; i++) {
      n++;
      const letter = 'ABCD'[n % 4];
      const choices = ['A', 'B', 'C', 'D'].map((l) => (l === letter ? `Bonne réponse ${n}` : `Réponse ${l} ${n}`));
      lines.push([`JKQ-T${String(n).padStart(4, '0')}`, code, domain, competence, level, `Question ${n} ; « ${competence} » ?`, ...choices.map((c) => (c.includes(';') ? `"${c}"` : c)), letter, `Explication ${n}`].map((v) => (String(v).includes(';') ? `"${v}"` : v)).join(';'));
    }
  }
  return lines.join('\r\n') + '\r\n';
}

function importFixture(app) {
  const { importQuestions, parseCsv } = require('../src/quizImport');
  const result = importQuestions(app.locals.db, [{ name: 'fixture.csv', rows: parseCsv(fixtureCsv()) }]);
  assert.ok(result.stats, JSON.stringify(result.errors));
  return result.stats;
}

module.exports.fixtureCsv = fixtureCsv;
module.exports.importFixture = importFixture;
