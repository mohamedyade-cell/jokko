const crypto = require('node:crypto');
const bank = require('./quizzes/bank');
const { transaction } = require('./db');
const { QUIZ_LEVEL_POINTS, grantBadge } = require('./score');

// draw : nombre de questions tirées ; seconds : temps limite par question.
// Durées totales : ~5 min, ~8 min et ~13 min.
const LEVELS = {
  debutant: { label: 'Débutant', draw: 6, seconds: 50 },
  intermediaire: { label: 'Intermédiaire', draw: 8, seconds: 60 },
  avance: { label: 'Avancé', draw: 10, seconds: 80 },
};
const LEVEL_KEYS = Object.keys(LEVELS);
const PASS_RATIO = 0.7;
// Tolérance réseau accordée au-delà du temps limite d'une question.
const GRACE_MS = 5000;
// Un badge peut être renouvelé quand il expire dans moins de RENEW_WINDOW_DAYS jours.
const RENEW_WINDOW_DAYS = 30;

function cooldownDays() {
  return Number(process.env.QUIZ_COOLDOWN_DAYS ?? 3);
}

function validityDays() {
  return Number(process.env.BADGE_VALIDITY_DAYS ?? 365);
}

const QUIZZES = bank.map((q) => ({ ...q, skillKey: `quiz:${q.slug}` }));

function getQuiz(slug) {
  return QUIZZES.find((q) => q.slug === slug) || null;
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

// État d'un quiz / niveau pour un candidat : badge valide, délai d'attente, tentative en cours.
function levelStatus(db, userId, slug, level) {
  const quiz = getQuiz(slug);
  const badge = db
    .prepare(
      `SELECT * FROM badges b WHERE user_id = ? AND kind = 'quiz' AND skill_key = ? AND level = ?
         AND (expires_at IS NULL OR expires_at > datetime('now')) ORDER BY expires_at DESC LIMIT 1`,
    )
    .get(userId, quiz.skillKey, level);
  const lastFail = db
    .prepare("SELECT finished_at FROM quiz_attempts WHERE user_id = ? AND quiz_slug = ? AND level = ? AND status = 'failed' ORDER BY finished_at DESC LIMIT 1")
    .get(userId, slug, level);
  const inProgress = db
    .prepare("SELECT id FROM quiz_attempts WHERE user_id = ? AND quiz_slug = ? AND level = ? AND status = 'in_progress'")
    .get(userId, slug, level);

  let cooldownUntil = null;
  if (lastFail) {
    const until = new Date(fromSqlDate(lastFail.finished_at).getTime() + cooldownDays() * 86400000);
    if (until > new Date()) cooldownUntil = until;
  }
  let renewable = true;
  if (badge && badge.expires_at) {
    renewable = fromSqlDate(badge.expires_at).getTime() - Date.now() < RENEW_WINDOW_DAYS * 86400000;
  } else if (badge) {
    renewable = false;
  }
  return { badge, cooldownUntil, inProgressId: inProgress ? inProgress.id : null, renewable };
}

function startAttempt(db, userId, slug, level) {
  const quiz = getQuiz(slug);
  if (!quiz || !LEVELS[level]) return { error: 'Quiz introuvable.' };
  const pool = quiz.questions[level] || [];
  if (!pool.length) return { error: "Ce niveau n'est pas encore disponible." };

  const status = levelStatus(db, userId, slug, level);
  if (status.inProgressId) return { id: status.inProgressId };
  if (status.cooldownUntil) {
    return { error: `Vous pourrez retenter ce quiz à partir du ${status.cooldownUntil.toLocaleDateString('fr-FR')}.` };
  }
  if (!status.renewable) return { error: 'Vous avez déjà ce badge, valide encore plusieurs mois.' };

  const count = Math.min(LEVELS[level].draw, pool.length);
  const questions = shuffle(pool.map((_, i) => i))
    .slice(0, count)
    .map((i) => ({ i, order: shuffle(pool[i].slice(1).map((_, c) => c)) }));

  return transaction(db, () => {
    // Une tentative abandonnée compte comme un échec : impossible de relancer pour tomber sur des questions plus faciles.
    db.prepare("UPDATE quiz_attempts SET status = 'failed', finished_at = datetime('now') WHERE user_id = ? AND status = 'in_progress'").run(userId);
    const id = db
      .prepare('INSERT INTO quiz_attempts (user_id, quiz_slug, level, questions) VALUES (?, ?, ?, ?)')
      .run(userId, slug, level, JSON.stringify(questions)).lastInsertRowid;
    return { id: Number(id) };
  });
}

function loadAttempt(db, userId, attemptId) {
  const attempt = db.prepare('SELECT * FROM quiz_attempts WHERE id = ? AND user_id = ?').get(attemptId, userId);
  if (!attempt) return null;
  return { ...attempt, questions: JSON.parse(attempt.questions), quiz: getQuiz(attempt.quiz_slug), levelInfo: LEVELS[attempt.level] };
}

// Question courante, affichée sans la bonne réponse. Le chronomètre démarre au premier affichage.
function currentQuestion(db, attempt) {
  const entry = attempt.questions[attempt.current_index];
  const item = attempt.quiz.questions[attempt.level][entry.i];
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
    text: item[0],
    choices: entry.order.map((c) => item[1 + c]),
    secondsLeft: Math.max(0, Math.ceil((servedMs + limitMs - Date.now()) / 1000)),
    seconds: attempt.levelInfo.seconds,
  };
}

// Enregistre la réponse à la question `index`. Une réponse hors délai compte comme fausse.
function answerQuestion(db, attempt, index, choicePos) {
  if (attempt.status !== 'in_progress' || index !== attempt.current_index) return attempt;
  const entry = attempt.questions[index];
  const elapsed = attempt.question_served_ms == null ? Infinity : Date.now() - attempt.question_served_ms;
  const inTime = elapsed <= attempt.levelInfo.seconds * 1000 + GRACE_MS;
  const correct = inTime && Number.isInteger(choicePos) && entry.order[choicePos] === 0;
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
        skillKey: attempt.quiz.skillKey,
        label: attempt.quiz.title,
        level: attempt.level,
        points: QUIZ_LEVEL_POINTS[attempt.level],
        sourceRef: `attempt:${attempt.id}`,
        expiresAt: sqlDate(new Date(Date.now() + validityDays() * 86400000)),
      });
    }
  });
  return loadAttempt(db, attempt.user_id, attempt.id);
}

module.exports = {
  QUIZZES,
  LEVELS,
  LEVEL_KEYS,
  PASS_RATIO,
  GRACE_MS,
  upcoming: bank.upcoming,
  cooldownDays,
  validityDays,
  getQuiz,
  levelStatus,
  startAttempt,
  loadAttempt,
  currentQuestion,
  answerQuestion,
};
