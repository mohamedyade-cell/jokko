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
