const crypto = require('node:crypto');

function requireLogin(req, res, next) {
  if (!req.user) {
    req.session.flash = { type: 'error', message: 'Connectez-vous pour continuer.' };
    return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
  }
  next();
}

function requireRole(role) {
  return [
    requireLogin,
    (req, res, next) => {
      if (req.user.role !== role) {
        return res.status(403).render('error', { title: 'Accès refusé', message: 'Cette page est réservée aux ' + (role === 'recruiter' ? 'recruteurs.' : 'candidats.') });
      }
      next();
    },
  ];
}

function ensureCsrfToken(req) {
  if (!req.session.csrfToken) req.session.csrfToken = crypto.randomBytes(24).toString('hex');
  return req.session.csrfToken;
}

function csrfValid(req) {
  const sent = (req.body && req.body._csrf) || req.get('x-csrf-token') || '';
  const expected = req.session.csrfToken || '';
  if (!sent || sent.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(sent), Buffer.from(expected));
}

// Vérifie le jeton CSRF sur les requêtes qui modifient l'état.
// Les formulaires multipart sont vérifiés après multer via verifyCsrf.
function csrfProtection(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.path.startsWith('/api/')) return next();
  if (req.is('multipart/form-data')) return next();
  return verifyCsrf(req, res, next);
}

function verifyCsrf(req, res, next) {
  if (!csrfValid(req)) {
    return res.status(403).render('error', { title: 'Session expirée', message: 'Le formulaire a expiré, veuillez réessayer.' });
  }
  next();
}

module.exports = { requireLogin, requireRole, csrfProtection, verifyCsrf, ensureCsrfToken };
