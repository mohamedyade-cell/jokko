const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const session = require('express-session');
const { openDb, STAGES, CONTRACT_TYPES } = require('./db');
const { csrfProtection, ensureCsrfToken } = require('./auth');
const helpers = require('./helpers');

function createApp(options = {}) {
  const config = {
    dbPath: options.dbPath || process.env.DATABASE_PATH || path.join(__dirname, '..', 'data', 'jokko.db'),
    uploadDir: options.uploadDir || process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads'),
    sessionSecret: options.sessionSecret || process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
    baseUrl: options.baseUrl || process.env.BASE_URL || 'http://localhost:3000',
    integrationToken: options.integrationToken ?? process.env.INTEGRATION_TOKEN ?? '',
    // Comptes de l'équipe Jokko (vérification des certifications, écoles partenaires, offres).
    adminEmails: (options.adminEmails ?? process.env.ADMIN_EMAILS ?? '')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  };

  const db = options.db || openDb(config.dbPath);
  const app = express();
  app.locals.db = db;
  app.locals.config = config;

  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'views'));
  if (process.env.NODE_ENV === 'production') app.set('trust proxy', 1);

  app.use(express.static(path.join(__dirname, '..', 'public')));
  app.use(express.urlencoded({ extended: false, limit: '200kb' }));
  app.use('/api', express.json({ limit: '8mb' })); // CV encodés en base64
  app.use(express.json({ limit: '1mb' }));
  app.use(
    session({
      secret: config.sessionSecret,
      resave: false,
      saveUninitialized: false,
      cookie: { maxAge: 7 * 24 * 3600 * 1000, httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' },
    }),
  );

  app.use((req, res, next) => {
    req.user = req.session.userId
      ? db.prepare('SELECT u.*, c.name AS company_name FROM users u LEFT JOIN companies c ON c.id = u.company_id WHERE u.id = ?').get(req.session.userId)
      : null;
    if (req.session.userId && !req.user) delete req.session.userId;
    if (req.user && config.adminEmails.includes(req.user.email)) req.user.is_admin = 1;
    next();
  });

  app.use((req, res, next) => {
    res.locals.currentUser = req.user;
    res.locals.csrfToken = ensureCsrfToken(req);
    res.locals.flash = req.session.flash;
    res.locals.path = req.path;
    res.locals.STAGES = STAGES;
    res.locals.CONTRACT_TYPES = CONTRACT_TYPES;
    res.locals.h = helpers;
    delete req.session.flash;
    if (req.user) {
      res.locals.pendingInvites = db
        .prepare("SELECT COUNT(*) AS n FROM connections WHERE addressee_id = ? AND status = 'pending'")
        .get(req.user.id).n;
    }
    next();
  });

  app.use(csrfProtection);

  app.use(require('./routes/auth'));
  app.use(require('./routes/feed'));
  // Avant profile : /profile/video et /profile/credentials ne doivent pas être pris pour /profile/:id.
  app.use(require('./routes/video'));
  app.use(require('./routes/skills'));
  app.use(require('./routes/profile'));
  app.use(require('./routes/network'));
  app.use(require('./routes/jobs'));
  app.use(require('./routes/ats'));
  app.use(require('./routes/talents'));
  app.use(require('./routes/admin'));
  app.use(require('./routes/feeds'));
  app.use(require('./routes/integrations'));

  app.use((req, res) => {
    res.status(404).render('error', { title: 'Page introuvable', message: "Cette page n'existe pas." });
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.code === 'LIMIT_FILE_SIZE' || err.code === 'INVALID_FILE_TYPE') {
      return res.status(400).render('error', { title: 'Fichier refusé', message: err.message });
    }
    console.error(err);
    res.status(500).render('error', { title: 'Erreur', message: 'Une erreur inattendue est survenue.' });
  });

  return app;
}

module.exports = { createApp };
