const crypto = require('node:crypto');
const { transaction } = require('./db');
const { QUIZ_LEVEL_POINTS, grantBadge } = require('./score');

// Un quiz = un badge importé (id_badge), à un niveau donné.
// draw : nombre de questions tirées dans la banque ; seconds : temps limite par question.
// Durées : 10 × 30 s = 5 min, 12 × 45 s = 9 min, 15 × 60 s = 15 min.
const LEVELS = {
  debutant: { label: 'Débutant', draw: 10, seconds: 30 },
  intermediaire: { label: 'Intermédiaire', draw: 12, seconds: 45 },
  avance: { label: 'Avancé', draw: 15, seconds: 60 },
};
const LEVEL_KEYS = Object.keys(LEVELS);
const PASS_RATIO = 0.7;
// Tolérance réseau accordée au-delà du temps limite d'une question.
const GRACE_MS = 5000;
// Un badge peut être renouvelé quand il expire dans moins de RENEW_WINDOW_DAYS jours.
const RENEW_WINDOW_DAYS = 30;
// En dessous, le badge n'est pas proposé : trop peu de questions pour un tirage aléatoire utile.
const MIN_QUESTIONS = 5;

function cooldownDays() {
  return Number(process.env.QUIZ_COOLDOWN_DAYS ?? 3);
}

function validityDays() {
  return Number(process.env.BADGE_VALIDITY_DAYS ?? 365);
}

function skillKey(quiz) {
  return `quiz:${quiz.family_slug}`;
}

function sqlDate(date) {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

function fromSqlDate(value) {
  return new Date(String(value).replace(' ', 'T') + 'Z');
}

function shuffle(items) {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function questionCount(quiz) {
  return Math.min(LEVELS[quiz.level].draw, quiz.question_count);
}

// Badges proposés aux candidats : actifs et avec assez de questions actives.
function listQuizzes(db, { includeInactive = false } = {}) {
  return db
    .prepare(
      `SELECT z.*, (SELECT COUNT(*) FROM quiz_questions q WHERE q.quiz_id = z.id AND q.active = 1) AS question_count
       FROM quizzes z ${includeInactive ? '' : 'WHERE z.active = 1'}
       ORDER BY z.domain, z.family, CASE z.level WHEN 'debutant' THEN 1 WHEN 'intermediaire' THEN 2 ELSE 3 END`,
    )
    .all()
    .filter((z) => includeInactive || z.question_count >= MIN_QUESTIONS);
}

// Compétences (séries de badges) pour les filtres de la CVthèque.
function listFamilies(db) {
  const seen = new Map();
  for (const z of listQuizzes(db)) if (!seen.has(z.family_slug)) seen.set(z.family_slug, { key: skillKey(z), label: z.family, domain: z.domain });
  return [...seen.values()].sort((a, b) => a.label.localeCompare(b.label, 'fr'));
}

function getQuiz(db, badgeCode) {
  return db
    .prepare(
      `SELECT z.*, (SELECT COUNT(*) FROM quiz_questions q WHERE q.quiz_id = z.id AND q.active = 1) AS question_count
       FROM quizzes z WHERE z.badge_code = ?`,
    )
    .get(badgeCode);
}

// État d'un badge pour un candidat : badge valide, délai d'attente, tentative en cours.
function quizStatus(db, userId, quiz) {
  const badge = db
    .prepare(
      `SELECT * FROM badges WHERE user_id = ? AND kind = 'quiz' AND source_ref LIKE ? AND (expires_at IS NULL OR expires_at > datetime('now'))
       ORDER BY expires_at DESC LIMIT 1`,
    )
    .get(userId, `badge:${quiz.badge_code}:%`);
  const lastFail = db
    .prepare("SELECT finished_at FROM quiz_attempts WHERE user_id = ? AND quiz_slug = ? AND status = 'failed' ORDER BY finished_at DESC LIMIT 1")
    .get(userId, quiz.badge_code);
  const inProgress = db.prepare("SELECT id FROM quiz_attempts WHERE user_id = ? AND quiz_slug = ? AND status = 'in_progress'").get(userId, quiz.badge_code);

  let cooldownUntil = null;
  if (lastFail) {
    const until = new Date(fromSqlDate(lastFail.finished_at).getTime() + cooldownDays() * 86400000);
    if (until > new Date()) cooldownUntil = until;
  }
  let renewable = true;
  if (badge) renewable = Boolean(badge.expires_at) && fromSqlDate(badge.expires_at).getTime() - Date.now() < RENEW_WINDOW_DAYS * 86400000;
  return { badge, cooldownUntil, inProgressId: inProgress ? inProgress.id : null, renewable };
}

function startAttempt(db, userId, badgeCode) {
  const quiz = getQuiz(db, badgeCode);
  if (!quiz || !quiz.active || quiz.question_count < MIN_QUESTIONS) return { error: "Ce quiz n'est pas disponible." };

  const status = quizStatus(db, userId, quiz);
  if (status.inProgressId) return { id: status.inProgressId };
  if (status.cooldownUntil) return { error: `Vous pourrez retenter ce quiz à partir du ${status.cooldownUntil.toLocaleDateString('fr-FR')}.` };
  if (!status.renewable) return { error: 'Vous avez déjà ce badge, valide encore plusieurs mois.' };

  const pool = db.prepare('SELECT id, choices FROM quiz_questions WHERE quiz_id = ? AND active = 1').all(quiz.id);
  const questions = shuffle(pool)
    .slice(0, questionCount(quiz))
    .map((q) => ({ q: q.id, order: shuffle(JSON.parse(q.choices).map((_, c) => c)) }));

  return transaction(db, () => {
    // Une tentative abandonnée compte comme un échec : impossible de relancer pour tomber sur des questions plus faciles.
    db.prepare("UPDATE quiz_attempts SET status = 'failed', finished_at = datetime('now') WHERE user_id = ? AND status = 'in_progress'").run(userId);
    const id = db
      .prepare('INSERT INTO quiz_attempts (user_id, quiz_slug, level, questions) VALUES (?, ?, ?, ?)')
      .run(userId, quiz.badge_code, quiz.level, JSON.stringify(questions)).lastInsertRowid;
    return { id: Number(id) };
  });
}

function loadAttempt(db, userId, attemptId) {
  const attempt = db.prepare('SELECT * FROM quiz_attempts WHERE id = ? AND user_id = ?').get(attemptId, userId);
  if (!attempt) return null;
  // Les tentatives terminées sur l'ancienne banque intégrée n'ont plus de quiz associé.
  const quiz = getQuiz(db, attempt.quiz_slug) || { family: attempt.quiz_slug, badge_code: attempt.quiz_slug };
  return { ...attempt, questions: JSON.parse(attempt.questions), quiz, levelInfo: LEVELS[attempt.level] };
}

// Question courante, sans la bonne réponse. Le chronomètre démarre au premier affichage.
function currentQuestion(db, attempt) {
  const entry = attempt.questions[attempt.current_index];
  const row = db.prepare('SELECT text, choices FROM quiz_questions WHERE id = ?').get(entry.q);
  const choices = JSON.parse(row.choices);
  let servedMs = attempt.question_served_ms;
  if (servedMs == null) {
    servedMs = Date.now();
    db.prepare('UPDATE quiz_attempts SET question_served_ms = ? WHERE id = ? AND question_served_ms IS NULL').run(servedMs, attempt.id);
  }
  const limitMs = attempt.levelInfo.seconds * 1000;
  return {
    index: attempt.current_index,
    number: attempt.current_index + 1,
    total: attempt.questions.length,
    text: row.text,
    choices: entry.order.map((c) => choices[c]),
    secondsLeft: Math.max(0, Math.ceil((servedMs + limitMs - Date.now()) / 1000)),
    seconds: attempt.levelInfo.seconds,
  };
}

// Enregistre la réponse à la question `index`. Une réponse hors délai compte comme fausse.
function answerQuestion(db, attempt, index, choicePos) {
  if (attempt.status !== 'in_progress' || index !== attempt.current_index) return attempt;
  const entry = attempt.questions[index];
  const { answer_index: answerIndex } = db.prepare('SELECT answer_index FROM quiz_questions WHERE id = ?').get(entry.q);
  const elapsed = attempt.question_served_ms == null ? Infinity : Date.now() - attempt.question_served_ms;
  const inTime = elapsed <= attempt.levelInfo.seconds * 1000 + GRACE_MS;
  const correct = inTime && Number.isInteger(choicePos) && entry.order[choicePos] === answerIndex;
  const nextIndex = index + 1;
  const correctCount = attempt.correct_count + (correct ? 1 : 0);
  const finished = nextIndex >= attempt.questions.length;

  transaction(db, () => {
    const res = db
      .prepare('UPDATE quiz_attempts SET current_index = ?, correct_count = ?, question_served_ms = NULL WHERE id = ? AND current_index = ? AND status = ?')
      .run(nextIndex, correctCount, attempt.id, index, 'in_progress');
    if (res.changes === 0 || !finished) return; // double envoi ignoré

    const passed = correctCount / attempt.questions.length >= PASS_RATIO;
    db.prepare("UPDATE quiz_attempts SET status = ?, finished_at = datetime('now') WHERE id = ?").run(passed ? 'passed' : 'failed', attempt.id);
    if (passed) {
      grantBadge(db, {
        userId: attempt.user_id,
        kind: 'quiz',
        skillKey: skillKey(attempt.quiz),
        label: attempt.quiz.family,
        level: attempt.level,
        points: QUIZ_LEVEL_POINTS[attempt.level],
        sourceRef: `badge:${attempt.quiz.badge_code}:attempt:${attempt.id}`,
        expiresAt: sqlDate(new Date(Date.now() + validityDays() * 86400000)),
      });
    }
  });
  return loadAttempt(db, attempt.user_id, attempt.id);
}

module.exports = {
  LEVELS,
  LEVEL_KEYS,
  PASS_RATIO,
  GRACE_MS,
  MIN_QUESTIONS,
  cooldownDays,
  validityDays,
  skillKey,
  questionCount,
  listQuizzes,
  listFamilies,
  getQuiz,
  quizStatus,
  startAttempt,
  loadAttempt,
  currentQuestion,
  answerQuestion,
};
