const express = require('express');
const { requireLogin } = require('../auth');

const router = express.Router();

// Revient à la page précédente sans jamais rediriger hors du site.
function backPath(req) {
  try {
    const url = new URL(req.get('referer') || '', `http://${req.get('host')}`);
    if (url.host === req.get('host')) return url.pathname + url.search;
  } catch {
    // referer absent ou invalide
  }
  return '/network';
}

// Renvoie 'none', 'connected', 'sent' (j'ai invité) ou 'received' (on m'a invité).
function connectionStatus(db, meId, otherId) {
  const row = db
    .prepare('SELECT requester_id, status FROM connections WHERE (requester_id = ?1 AND addressee_id = ?2) OR (requester_id = ?2 AND addressee_id = ?1)')
    .get(meId, otherId);
  if (!row) return 'none';
  if (row.status === 'accepted') return 'connected';
  return row.requester_id === meId ? 'sent' : 'received';
}

router.get('/network', requireLogin, (req, res) => {
  const db = req.app.locals.db;
  const me = req.user.id;
  const q = String(req.query.q || '').trim();

  const invitations = db
    .prepare(
      `SELECT c.id, u.id AS user_id, u.name, u.headline FROM connections c JOIN users u ON u.id = c.requester_id
       WHERE c.addressee_id = ? AND c.status = 'pending' ORDER BY c.created_at DESC`,
    )
    .all(me);

  const connections = db
    .prepare(
      `SELECT u.id, u.name, u.headline, u.location FROM connections c
       JOIN users u ON u.id = CASE WHEN c.requester_id = ?1 THEN c.addressee_id ELSE c.requester_id END
       WHERE c.status = 'accepted' AND (c.requester_id = ?1 OR c.addressee_id = ?1) ORDER BY u.name`,
    )
    .all(me);

  // Suggestions : membres sans lien existant, filtrés par la recherche.
  const like = `%${q}%`;
  const suggestions = db
    .prepare(
      `SELECT u.id, u.name, u.headline, u.location FROM users u
       WHERE u.id != ?1
         AND NOT EXISTS (SELECT 1 FROM connections c WHERE (c.requester_id = ?1 AND c.addressee_id = u.id) OR (c.requester_id = u.id AND c.addressee_id = ?1))
         AND (?2 = '' OR u.name LIKE ?3 OR u.headline LIKE ?3 OR u.skills LIKE ?3 OR u.location LIKE ?3)
       ORDER BY u.created_at DESC LIMIT 30`,
    )
    .all(me, q, like);

  res.render('network', { title: 'Mon réseau', invitations, connections, suggestions, q });
});

router.post('/network/connect/:id', requireLogin, (req, res) => {
  const db = req.app.locals.db;
  const other = Number(req.params.id);
  const back = backPath(req);
  if (other === req.user.id || !db.prepare('SELECT 1 FROM users WHERE id = ?').get(other)) return res.redirect(back);

  const status = connectionStatus(db, req.user.id, other);
  if (status === 'none') {
    db.prepare("INSERT INTO connections (requester_id, addressee_id, status) VALUES (?, ?, 'pending')").run(req.user.id, other);
    req.session.flash = { type: 'success', message: 'Invitation envoyée.' };
  } else if (status === 'received') {
    db.prepare("UPDATE connections SET status = 'accepted' WHERE requester_id = ? AND addressee_id = ?").run(other, req.user.id);
    req.session.flash = { type: 'success', message: 'Vous êtes maintenant en relation.' };
  }
  res.redirect(back);
});

router.post('/network/invitations/:id/:action', requireLogin, (req, res) => {
  const db = req.app.locals.db;
  const id = Number(req.params.id);
  if (req.params.action === 'accept') {
    db.prepare("UPDATE connections SET status = 'accepted' WHERE id = ? AND addressee_id = ? AND status = 'pending'").run(id, req.user.id);
  } else if (req.params.action === 'decline') {
    db.prepare("DELETE FROM connections WHERE id = ? AND addressee_id = ? AND status = 'pending'").run(id, req.user.id);
  }
  res.redirect('/network');
});

router.post('/network/remove/:id', requireLogin, (req, res) => {
  const other = Number(req.params.id);
  req.app.locals.db
    .prepare('DELETE FROM connections WHERE (requester_id = ?1 AND addressee_id = ?2) OR (requester_id = ?2 AND addressee_id = ?1)')
    .run(req.user.id, other);
  res.redirect(backPath(req));
});

module.exports = router;
module.exports.connectionStatus = connectionStatus;
