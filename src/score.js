// Badges et Jokko Score.
// Le score a deux composantes calculées séparément :
//  - compétences : meilleur badge valide par compétence, somme plafonnée à 100 ;
//  - parrainage : points par membre parrainé, sans effet sur la composante compétences.

const QUIZ_LEVEL_POINTS = { debutant: 10, intermediaire: 20, avance: 30 };
const CERTIFICATION_POINTS = 20;
const CAMPUS_POINTS = 15;
const SKILL_SCORE_CAP = 100;
const REFERRAL_POINTS = 10;
const LEVEL_RANK = { debutant: 1, intermediaire: 2, avance: 3 };

const ACTIVE_BADGE = "(b.expires_at IS NULL OR b.expires_at > datetime('now'))";

// Expressions SQL réutilisables ; `u` est l'alias de la table users.
function skillScoreSql(u = 'u') {
  return `(SELECT MIN(${SKILL_SCORE_CAP}, COALESCE(SUM(best), 0)) FROM (
     SELECT MAX(b.points) AS best FROM badges b WHERE b.user_id = ${u}.id AND ${ACTIVE_BADGE} GROUP BY b.skill_key))`;
}

function referralScoreSql(u = 'u') {
  return `(SELECT COUNT(*) * ${REFERRAL_POINTS} FROM users r WHERE r.referred_by = ${u}.id)`;
}

function getScore(db, userId) {
  const row = db.prepare(`SELECT ${skillScoreSql()} AS skills, ${referralScoreSql()} AS referral, (SELECT COUNT(*) FROM users r WHERE r.referred_by = u.id) AS referrals FROM users u WHERE u.id = ?`).get(userId);
  return row ? { skills: row.skills, referral: row.referral, referrals: row.referrals } : { skills: 0, referral: 0, referrals: 0 };
}

// Badges valides, en ne gardant que le meilleur par compétence.
function activeBadges(db, userIds) {
  const ids = [].concat(userIds);
  if (!ids.length) return {};
  const rows = db
    .prepare(
      `SELECT b.* FROM badges b WHERE b.user_id IN (${ids.map(() => '?').join(',')}) AND ${ACTIVE_BADGE}
       ORDER BY b.points DESC, b.issued_at DESC`,
    )
    .all(...ids);
  const byUser = Object.fromEntries(ids.map((id) => [id, []]));
  const seen = new Set();
  for (const b of rows) {
    const key = `${b.user_id}|${b.skill_key}`;
    if (seen.has(key)) continue;
    seen.add(key);
    byUser[b.user_id].push(b);
  }
  return byUser;
}

function grantBadge(db, b) {
  return Number(
    db
      .prepare('INSERT INTO badges (user_id, kind, skill_key, label, level, points, source_ref, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(b.userId, b.kind, b.skillKey, b.label, b.level || null, b.points, b.sourceRef || null, b.expiresAt || null).lastInsertRowid,
  );
}

module.exports = {
  QUIZ_LEVEL_POINTS,
  CERTIFICATION_POINTS,
  CAMPUS_POINTS,
  SKILL_SCORE_CAP,
  REFERRAL_POINTS,
  LEVEL_RANK,
  ACTIVE_BADGE,
  skillScoreSql,
  referralScoreSql,
  getScore,
  activeBadges,
  grantBadge,
};
