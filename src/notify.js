// Notifications internes (cloche dans l'en-tête).

function notify(db, userId, { type, title, body = '', link = '' }) {
  if (!userId) return;
  db.prepare('INSERT INTO notifications (user_id, type, title, body, link) VALUES (?, ?, ?, ?, ?)').run(userId, type, title, String(body).slice(0, 300), link);
}

// Tous les recruteurs de l'entreprise propriétaire de l'offre.
function notifyCompany(db, companyId, notification, exceptUserId = null) {
  for (const u of db.prepare("SELECT id FROM users WHERE company_id = ? AND role = 'recruiter'").all(companyId)) {
    if (u.id !== exceptUserId) notify(db, u.id, notification);
  }
}

function unreadCount(db, userId) {
  return db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL').get(userId).n;
}

module.exports = { notify, notifyCompany, unreadCount };
