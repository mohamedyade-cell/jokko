const express = require('express');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { recordApplication } = require('../applications');
const { ALLOWED } = require('../upload');

const router = express.Router();

const MAX_CV_BYTES = 5 * 1024 * 1024;

function authorized(req) {
  const expected = req.app.locals.config.integrationToken;
  const header = req.get('authorization') || '';
  const sent = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!expected || sent.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(sent), Buffer.from(expected));
}

// Accepte le format Indeed Apply (job.jobId / applicant.fullName / applicant.resume.file)
// ainsi qu'un format générique utilisé pour LinkedIn ou un connecteur tiers.
function normalize(body) {
  const b = body || {};
  const applicant = b.applicant || b.candidate || {};
  const jobRef = b.jobId ?? b.partnerJobId ?? b.job?.jobId ?? b.job?.id ?? '';
  const name =
    applicant.fullName || applicant.name || [applicant.firstName, applicant.lastName].filter(Boolean).join(' ') || '';
  const resume = applicant.resume?.file || applicant.resume || b.resume || null;
  return {
    jobId: parseInt(String(jobRef).replace(/^jokko-/, ''), 10),
    name: String(name).trim().slice(0, 200),
    email: String(applicant.email || applicant.emailAddress || '').trim().toLowerCase(),
    phone: String(applicant.phoneNumber || applicant.phone || '').trim().slice(0, 40),
    coverLetter: String(applicant.coverletter || applicant.coverLetter || b.coverLetter || '').slice(0, 5000),
    externalRef: String(b.id || b.applicationId || '').slice(0, 200) || null,
    resume: resume && resume.data ? { fileName: String(resume.fileName || 'cv.pdf'), data: String(resume.data) } : null,
  };
}

function saveResume(uploadDir, resume) {
  const ext = path.extname(resume.fileName).toLowerCase();
  if (!ALLOWED[ext]) return { error: 'unsupported_resume_type' };
  const buffer = Buffer.from(resume.data, 'base64');
  if (!buffer.length || buffer.length > MAX_CV_BYTES) return { error: 'invalid_resume_size' };
  fs.mkdirSync(uploadDir, { recursive: true });
  const stored = crypto.randomBytes(16).toString('hex') + ext;
  fs.writeFileSync(path.join(uploadDir, stored), buffer);
  return { stored, original: path.basename(resume.fileName).slice(0, 200) };
}

// Webhook de réception des candidatures : POST /api/integrations/indeed/applications
router.post('/api/integrations/:provider/applications', (req, res) => {
  const provider = req.params.provider;
  if (!['linkedin', 'indeed'].includes(provider)) return res.status(404).json({ error: 'unknown_provider' });
  if (!req.app.locals.config.integrationToken) return res.status(503).json({ error: 'integration_disabled' });
  if (!authorized(req)) return res.status(401).json({ error: 'unauthorized' });

  const db = req.app.locals.db;
  const a = normalize(req.body);
  if (!Number.isInteger(a.jobId) || !a.name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a.email)) {
    return res.status(400).json({ error: 'invalid_payload', required: ['jobId', 'applicant.name', 'applicant.email'] });
  }
  const job = db.prepare("SELECT id FROM jobs WHERE id = ? AND status = 'open'").get(a.jobId);
  if (!job) return res.status(404).json({ error: 'job_not_found' });

  let cv = null;
  if (a.resume) {
    cv = saveResume(req.app.locals.config.uploadDir, a.resume);
    if (cv.error) return res.status(400).json({ error: cv.error });
  }

  const result = recordApplication(db, {
    jobId: job.id,
    name: a.name,
    email: a.email,
    phone: a.phone,
    coverLetter: a.coverLetter,
    cvPath: cv?.stored,
    cvOriginalName: cv?.original,
    externalRef: a.externalRef,
    source: provider,
  });
  if (!result.created && cv) fs.rm(path.join(req.app.locals.config.uploadDir, cv.stored), { force: true }, () => {});

  res.status(result.created ? 201 : 200).json({ ok: true, applicationId: result.id, duplicate: !result.created });
});

module.exports = router;
