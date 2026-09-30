// Suivi après déblocage : entretiens, messagerie recruteur ↔ candidat, notifications.
// Remplace les échanges par e-mail et WhatsApp : tout reste attaché à la candidature.
const express = require('express');
const { requireLogin, requireRole } = require('../auth');
const { STAGE_KEYS, transaction } = require('../db');
const iv = require('../interviews');
const { notify, notifyCompany } = require('../notify');

const router = express.Router();
const recruiterOnly = requireRole('recruiter');

// Candidature accessible à l'utilisateur (recruteur de l'entreprise ou candidat concerné),
// uniquement une fois entrée dans le pipeline (CV débloqué).
function loadThread(db, user, applicationId) {
  const a = db
    .prepare(
      `SELECT a.*, j.title AS job_title, j.company_id, c.name AS company_name
       FROM applications a JOIN jobs j ON j.id = a.job_id JOIN companies c ON c.id = j.company_id WHERE a.id = ?`,
    )
    .get(applicationId);
  if (!a || !STAGE_KEYS.includes(a.stage)) return null;
  if (user.role === 'recruiter' && user.company_id === a.company_id) return { ...a, side: 'recruiter' };
  if (user.role === 'candidate' && a.candidate_id === user.id) return { ...a, side: 'candidate' };
  return null;
}

function interviewFor(db, user, id) {
  const interview = db.prepare('SELECT * FROM interviews WHERE id = ?').get(id);
  if (!interview) return null;
  const thread = loadThread(db, user, interview.application_id);
  return thread ? { interview, thread } : null;
}

function notFound(res) {
  return res.status(404).render('error', { title: 'Introuvable', message: "Cet élément n'existe pas ou ne vous concerne pas." });
}

// ---------- Entretiens ----------

router.post('/ats/applications/:id/interviews', recruiterOnly, (req, res) => {
  const db = req.app.locals.db;
  const thread = loadThread(db, req.user, Number(req.params.id));
  if (!thread) return notFound(res);
  const back = `/ats/applications/${thread.id}`;
  const startsAt = iv.parseLocal(req.body.starts_at);
  const mode = iv.MODES[req.body.mode] ? req.body.mode : null;
  const duration = Math.min(480, Math.max(10, parseInt(req.body.duration_min, 10) || 45));
  let error = null;
  if (!startsAt) error = "Indiquez la date et l'heure de l'entretien.";
  else if (startsAt.getTime() < Date.now() - 5 * 60000) error = "La date de l'entretien est déjà passée.";
  else if (!mode) error = "Choisissez le type d'entretien.";
  if (error) {
    req.session.flash = { type: 'error', message: error };
    return res.redirect(back);
  }

  transaction(db, () => {
    const id = Number(
      db
        .prepare('INSERT INTO interviews (application_id, scheduled_by, starts_at, duration_min, mode, location, notes) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(thread.id, req.user.id, iv.toSql(startsAt), duration, mode, String(req.body.location || '').trim().slice(0, 300), String(req.body.notes || '').trim().slice(0, 2000))
        .lastInsertRowid,
    );
    // Planifier un entretien fait passer le candidat à l'étape « Entretien ».
    if (['nouveau', 'preselection'].includes(thread.stage)) {
      db.prepare("UPDATE applications SET stage = 'entretien', updated_at = datetime('now') WHERE id = ?").run(thread.id);
      db.prepare("INSERT INTO application_events (application_id, actor_id, from_stage, to_stage) VALUES (?, ?, ?, 'entretien')").run(thread.id, req.user.id, thread.stage);
    }
    notify(db, thread.candidate_id, {
      type: 'interview',
      title: `Entretien proposé par ${thread.company_name}`,
      body: `${thread.job_title} · ${iv.formatWhen(iv.toSql(startsAt))} · ${iv.MODES[mode]}. Merci de confirmer.`,
      link: `/messages/${thread.id}#entretien-${id}`,
    });
  });
  req.session.flash = {
    type: 'success',
    message: thread.candidate_id ? 'Entretien proposé : le candidat est notifié et doit le confirmer.' : "Entretien enregistré. Ce candidat n'a pas de compte Jokko : envoyez-lui l'invitation par e-mail.",
  };
  res.redirect(back);
});

router.post('/ats/interviews/:id/cancel', recruiterOnly, (req, res) => {
  const db = req.app.locals.db;
  const found = interviewFor(db, req.user, Number(req.params.id));
  if (!found) return notFound(res);
  const { interview, thread } = found;
  if (interview.status !== 'cancelled') {
    db.prepare("UPDATE interviews SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?").run(interview.id);
    notify(db, thread.candidate_id, {
      type: 'interview',
      title: `Entretien annulé · ${thread.company_name}`,
      body: `${thread.job_title} · ${iv.formatWhen(interview.starts_at)}`,
      link: `/messages/${thread.id}`,
    });
  }
  res.redirect(`/ats/applications/${thread.id}`);
});

router.post('/interviews/:id/respond', requireRole('candidate'), (req, res) => {
  const db = req.app.locals.db;
  const found = interviewFor(db, req.user, Number(req.params.id));
  if (!found) return notFound(res);
  const { interview, thread } = found;
  const decision = req.body.decision === 'confirm' ? 'confirmed' : req.body.decision === 'decline' ? 'declined' : null;
  if (decision && ['proposed', 'confirmed'].includes(interview.status) && !iv.isPast(interview)) {
    const note = String(req.body.note || '').trim().slice(0, 1000);
    db.prepare("UPDATE interviews SET status = ?, candidate_note = ?, updated_at = datetime('now') WHERE id = ?").run(decision, note, interview.id);
    notifyCompany(db, thread.company_id, {
      type: 'interview',
      title: `${thread.candidate_name} a ${decision === 'confirmed' ? 'confirmé' : 'décliné'} l'entretien`,
      body: `${thread.job_title} · ${iv.formatWhen(interview.starts_at)}${note ? ` · « ${note} »` : ''}`,
      link: `/ats/applications/${thread.id}`,
    });
    req.session.flash = { type: 'success', message: decision === 'confirmed' ? 'Entretien confirmé. Ajoutez-le à votre agenda !' : 'Vous avez décliné cet entretien. Le recruteur est prévenu.' };
  }
  res.redirect(`/messages/${thread.id}`);
});

router.get('/interviews/:id.ics', requireLogin, (req, res) => {
  const db = req.app.locals.db;
  const found = interviewFor(db, req.user, Number(req.params.id));
  if (!found) return notFound(res);
  const { interview, thread } = found;
  const title = thread.side === 'candidate' ? `Entretien ${thread.company_name} – ${thread.job_title}` : `Entretien ${thread.candidate_name} – ${thread.job_title}`;
  const ics = iv.toIcs(interview, { title, description: `${iv.MODES[interview.mode]}${interview.notes ? `\n${interview.notes}` : ''}`, baseUrl: req.app.locals.config.baseUrl });
  res.attachment(`entretien-${interview.id}.ics`).type('text/calendar; charset=utf-8').send(ics);
});

// Agenda des entretiens de l'entreprise.
router.get('/ats/interviews', recruiterOnly, (req, res) => {
  const rows = req.app.locals.db
    .prepare(
      `SELECT i.*, a.candidate_name, a.id AS application_id, j.title AS job_title
       FROM interviews i JOIN applications a ON a.id = i.application_id JOIN jobs j ON j.id = a.job_id
       WHERE j.company_id = ? AND i.status != 'cancelled' AND i.starts_at >= datetime('now', '-7 days')
       ORDER BY i.starts_at`,
    )
    .all(req.user.company_id);
  const upcoming = rows.filter((r) => !iv.isPast(r));
  const past = rows.filter((r) => iv.isPast(r)).reverse();
  res.render('ats/interviews', { title: 'Agenda des entretiens', upcoming, past, iv });
});

// ---------- Messagerie ----------

function threadsFor(db, user) {
  const scope = user.role === 'recruiter' ? 'j.company_id = ?' : 'a.candidate_id = ?';
  const scopeValue = user.role === 'recruiter' ? user.company_id : user.id;
  // Côté recruteur, « non lu » = message du candidat ; côté candidat = message du recruteur.
  const unread = user.role === 'recruiter' ? 'm.sender_id = a.candidate_id' : 'm.sender_id != a.candidate_id';
  return db
    .prepare(
      `SELECT a.id, a.candidate_name, a.stage, j.title AS job_title, c.name AS company_name,
              (SELECT body FROM messages m WHERE m.application_id = a.id ORDER BY m.id DESC LIMIT 1) AS last_body,
              (SELECT created_at FROM messages m WHERE m.application_id = a.id ORDER BY m.id DESC LIMIT 1) AS last_at,
              (SELECT COUNT(*) FROM messages m WHERE m.application_id = a.id AND m.read_at IS NULL AND ${unread}) AS unread,
              (SELECT COUNT(*) FROM interviews i WHERE i.application_id = a.id AND i.status = 'proposed' AND i.starts_at > datetime('now')) AS pending_interviews
       FROM applications a JOIN jobs j ON j.id = a.job_id JOIN companies c ON c.id = j.company_id
       WHERE ${scope} AND a.stage IN (${STAGE_KEYS.map(() => '?').join(',')})
         AND (a.candidate_id IS NOT NULL)
       ORDER BY COALESCE(last_at, a.updated_at) DESC`,
    )
    .all(scopeValue, ...STAGE_KEYS)
    .filter((t) => user.role === 'candidate' || t.last_at);
}

function unreadMessages(db, user) {
  return threadsFor(db, user).reduce((n, t) => n + t.unread, 0);
}

router.get('/messages', requireLogin, (req, res) => {
  res.render('messages', { title: 'Messages', threads: threadsFor(req.app.locals.db, req.user) });
});

router.get('/messages/:id', requireLogin, (req, res) => {
  const db = req.app.locals.db;
  const thread = loadThread(db, req.user, Number(req.params.id));
  if (!thread || !thread.candidate_id) return notFound(res);
  const markRead = thread.side === 'recruiter' ? 'sender_id = ?' : 'sender_id != ?';
  db.prepare(`UPDATE messages SET read_at = datetime('now') WHERE application_id = ? AND read_at IS NULL AND ${markRead}`).run(thread.id, thread.candidate_id);
  const messages = db
    .prepare('SELECT m.*, u.name AS sender_name, u.role AS sender_role FROM messages m JOIN users u ON u.id = m.sender_id WHERE m.application_id = ? ORDER BY m.id')
    .all(thread.id);
  const interviews = db.prepare('SELECT * FROM interviews WHERE application_id = ? ORDER BY starts_at DESC').all(thread.id);
  res.render('thread', { title: thread.side === 'candidate' ? thread.company_name : thread.candidate_name, thread, messages, interviews, iv });
});

router.post('/messages/:id', requireLogin, (req, res) => {
  const db = req.app.locals.db;
  const thread = loadThread(db, req.user, Number(req.params.id));
  if (!thread || !thread.candidate_id) return notFound(res);
  const body = String(req.body.body || '').trim().slice(0, 5000);
  if (body) {
    db.prepare('INSERT INTO messages (application_id, sender_id, body) VALUES (?, ?, ?)').run(thread.id, req.user.id, body);
    const preview = body.length > 120 ? `${body.slice(0, 117)}…` : body;
    if (thread.side === 'recruiter') {
      notify(db, thread.candidate_id, { type: 'message', title: `Nouveau message de ${thread.company_name}`, body: preview, link: `/messages/${thread.id}` });
    } else {
      notifyCompany(db, thread.company_id, { type: 'message', title: `Nouveau message de ${thread.candidate_name}`, body: preview, link: `/messages/${thread.id}` });
    }
  }
  res.redirect(`/messages/${thread.id}#bas`);
});

// ---------- Notifications ----------

router.get('/notifications', requireLogin, (req, res) => {
  const notifications = req.app.locals.db.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 100').all(req.user.id);
  res.render('notifications', { title: 'Notifications', notifications });
});

router.get('/notifications/:id', requireLogin, (req, res) => {
  const db = req.app.locals.db;
  const n = db.prepare('SELECT * FROM notifications WHERE id = ? AND user_id = ?').get(Number(req.params.id), req.user.id);
  if (!n) return res.redirect('/notifications');
  db.prepare("UPDATE notifications SET read_at = COALESCE(read_at, datetime('now')) WHERE id = ?").run(n.id);
  res.redirect(n.link && n.link.startsWith('/') && !n.link.startsWith('//') ? n.link : '/notifications');
});

router.post('/notifications/read-all', requireLogin, (req, res) => {
  req.app.locals.db.prepare("UPDATE notifications SET read_at = datetime('now') WHERE user_id = ? AND read_at IS NULL").run(req.user.id);
  res.redirect('/notifications');
});

module.exports = router;
module.exports.unreadMessages = unreadMessages;
module.exports.loadThread = loadThread;
