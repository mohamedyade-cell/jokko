// Import de la banque de questions depuis des fichiers Excel (.xlsx) ou CSV.
//
// Format attendu (une ligne par question, séparateur « ; » ou « , » pour le CSV) :
//   id_question;id_badge;domaine;competence;niveau;question;A;B;C;D;reponse;explication
// - id_question / id_badge : identifiants stables (ex. JKQ-000451 / JKB-00514). Réimporter une
//   question existante la met à jour ; rien n'est supprimé (les tentatives y font référence).
// - A à F : réponses possibles (au moins deux), « reponse » : lettre de la bonne réponse.
// - colonne facultative « actif » (oui / non) pour retirer une question du tirage.
// L'import est tout ou rien : à la moindre erreur, aucun fichier n'est importé.

const path = require('node:path');
const { transaction } = require('./db');

const LETTERS = ['a', 'b', 'c', 'd', 'e', 'f'];
const REQUIRED = ['id_question', 'id_badge', 'domaine', 'competence', 'niveau', 'question', 'a', 'b', 'reponse'];
const HEADER = ['id_question', 'id_badge', 'domaine', 'competence', 'niveau', 'question', 'A', 'B', 'C', 'D', 'reponse', 'explication'];
const LEVEL_NAMES = { debutant: 'Débutant', intermediaire: 'Intermédiaire', avance: 'Avancé' };
const MAX_ERRORS = 50;

function normalize(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

function headerKey(value) {
  const key = normalize(value).replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  const aliases = { bonne_reponse: 'reponse', reponse_correcte: 'reponse', competences: 'competence', explications: 'explication', badge: 'id_badge', id: 'id_question' };
  return aliases[key] || key;
}

function parseLevel(value) {
  const v = normalize(value);
  if (['debutant', 'd', '1', 'beginner', 'niveau 1'].includes(v)) return 'debutant';
  if (['intermediaire', 'i', '2', 'intermediate', 'niveau 2'].includes(v)) return 'intermediaire';
  if (['avance', 'a', '3', 'advanced', 'expert', 'niveau 3'].includes(v)) return 'avance';
  return null;
}

// « ORBUS Débutant » → « ORBUS » : les badges d'une même série sont regroupés dans le catalogue,
// et seul le meilleur niveau obtenu compte dans le Jokko Score.
function familyOf(competence) {
  return String(competence).replace(/\s*[-–(]?\s*(d[ée]butant|interm[ée]diaire|avanc[ée])\s*\)?\s*$/i, '').trim() || String(competence).trim();
}

function slugify(value) {
  return normalize(value).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'quiz';
}

// CSV RFC 4180 : guillemets, séparateur dans les champs, retours à la ligne, BOM.
function parseCsv(text) {
  const src = text.replace(/^﻿/, '');
  const firstLine = src.slice(0, src.search(/\r?\n|$/));
  const counts = { ';': 0, ',': 0, '\t': 0 };
  for (const ch of firstLine) if (ch in counts) counts[ch]++;
  const sep = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];

  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"' && field === '') quoted = true;
    else if (ch === sep) {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

async function readRows(buffer, filename) {
  const ext = path.extname(filename).toLowerCase();
  if (ext === '.csv' || ext === '.txt') return parseCsv(buffer.toString('utf8'));
  if (ext === '.xlsx') {
    const readXlsx = require('read-excel-file/node').default;
    const sheets = await readXlsx(buffer);
    // Première feuille contenant l'en-tête attendu (un classeur peut contenir une feuille « Consignes »).
    const sheet = sheets.find((s) => (s.data[0] || []).map(headerKey).includes('id_question')) || sheets[0];
    return sheet ? sheet.data.map((r) => r.map((c) => (c == null ? '' : String(c)))) : [];
  }
  throw new Error(`${filename} : format non pris en charge (utilisez .xlsx ou .csv).`);
}

// Vérifie toutes les lignes de tous les fichiers et prépare les données à importer.
function validate(files) {
  const errors = [];
  const badges = new Map();
  const questions = new Map();
  const err = (msg) => errors.length < MAX_ERRORS && errors.push(msg);

  for (const file of files) {
    const [header = [], ...lines] = file.rows;
    const keys = header.map(headerKey);
    const missing = REQUIRED.filter((k) => !keys.includes(k));
    if (missing.length) {
      err(`${file.name} : colonnes manquantes (${missing.join(', ')}). En-tête attendu : ${HEADER.join(';')}`);
      continue;
    }
    const col = (row, key) => String(row[keys.indexOf(key)] ?? '').trim();
    const choiceKeys = LETTERS.filter((l) => keys.includes(l));

    lines.forEach((row, i) => {
      if (row.every((c) => String(c ?? '').trim() === '')) return;
      const where = `${file.name} ligne ${i + 2}`;
      const q = {
        externalId: col(row, 'id_question'),
        badgeCode: col(row, 'id_badge'),
        domain: col(row, 'domaine'),
        competence: col(row, 'competence'),
        level: parseLevel(col(row, 'niveau')),
        text: col(row, 'question'),
        explanation: keys.includes('explication') ? col(row, 'explication') : '',
        active: !keys.includes('actif') || !['non', 'no', '0', 'false', 'inactif'].includes(normalize(col(row, 'actif'))),
      };
      const choices = [];
      const letters = [];
      for (const l of choiceKeys) {
        const v = col(row, l);
        if (v) {
          choices.push(v);
          letters.push(l);
        }
      }
      const answer = normalize(col(row, 'reponse'));

      for (const [k, label] of [['externalId', 'id_question'], ['badgeCode', 'id_badge'], ['domain', 'domaine'], ['competence', 'competence'], ['text', 'question']]) {
        if (!q[k]) return err(`${where} : « ${label} » est vide.`);
      }
      if (!q.level) return err(`${where} : niveau « ${col(row, 'niveau')} » inconnu (Débutant, Intermédiaire ou Avancé).`);
      if (choices.length < 2) return err(`${where} : il faut au moins deux réponses possibles.`);
      if (!letters.includes(answer)) return err(`${where} : la bonne réponse « ${col(row, 'reponse')} » ne correspond à aucune réponse remplie (${letters.join(', ').toUpperCase()}).`);
      if (new Set(choices.map(normalize)).size !== choices.length) return err(`${where} : deux réponses possibles sont identiques.`);
      if (q.text.length > 2000 || choices.some((c) => c.length > 500)) return err(`${where} : texte trop long.`);
      if (questions.has(q.externalId)) return err(`${where} : id_question « ${q.externalId} » en double (déjà vu ${questions.get(q.externalId).where}).`);

      const badge = { code: q.badgeCode, domain: q.domain, competence: q.competence, level: q.level, where };
      const known = badges.get(q.badgeCode);
      if (!known) badges.set(q.badgeCode, badge);
      else if (known.domain !== badge.domain || known.competence !== badge.competence || known.level !== badge.level) {
        return err(`${where} : le badge ${q.badgeCode} a un domaine, une compétence ou un niveau différent de ${known.where}.`);
      }
      questions.set(q.externalId, { ...q, choices, answerIndex: letters.indexOf(answer), where });
    });
  }
  if (!errors.length && !questions.size) errors.push('Aucune question trouvée dans les fichiers.');
  return { errors, badges, questions };
}

function importQuestions(db, files, importedBy = null) {
  const { errors, badges, questions } = validate(files);
  if (errors.length) return { errors };

  const stats = { badgesCreated: 0, badgesUpdated: 0, questionsCreated: 0, questionsUpdated: 0, questionsDisabled: 0 };
  transaction(db, () => {
    const quizIds = new Map();
    for (const b of badges.values()) {
      const family = familyOf(b.competence);
      const existing = db.prepare('SELECT id FROM quizzes WHERE badge_code = ?').get(b.code);
      if (existing) {
        db.prepare("UPDATE quizzes SET domain = ?, competence = ?, family = ?, family_slug = ?, level = ?, updated_at = datetime('now') WHERE id = ?").run(
          b.domain, b.competence, family, slugify(family), b.level, existing.id,
        );
        quizIds.set(b.code, existing.id);
        stats.badgesUpdated++;
      } else {
        const r = db
          .prepare('INSERT INTO quizzes (badge_code, domain, competence, family, family_slug, level) VALUES (?, ?, ?, ?, ?, ?)')
          .run(b.code, b.domain, b.competence, family, slugify(family), b.level);
        quizIds.set(b.code, Number(r.lastInsertRowid));
        stats.badgesCreated++;
      }
    }
    for (const q of questions.values()) {
      const existing = db.prepare('SELECT id FROM quiz_questions WHERE external_id = ?').get(q.externalId);
      const values = [quizIds.get(q.badgeCode), q.text, JSON.stringify(q.choices), q.answerIndex, q.explanation, q.active ? 1 : 0];
      if (existing) {
        db.prepare("UPDATE quiz_questions SET quiz_id = ?, text = ?, choices = ?, answer_index = ?, explanation = ?, active = ?, updated_at = datetime('now') WHERE id = ?").run(...values, existing.id);
        stats.questionsUpdated++;
      } else {
        db.prepare('INSERT INTO quiz_questions (quiz_id, text, choices, answer_index, explanation, active, external_id) VALUES (?, ?, ?, ?, ?, ?, ?)').run(...values, q.externalId);
        stats.questionsCreated++;
      }
      if (!q.active) stats.questionsDisabled++;
    }
    db.prepare('INSERT INTO quiz_imports (imported_by, files, summary) VALUES (?, ?, ?)').run(importedBy, JSON.stringify(files.map((f) => f.name)), JSON.stringify(stats));
  });
  return { stats };
}

// Export dans le même format que l'import : on peut corriger le fichier puis le réimporter.
function exportRows(db) {
  const rows = db
    .prepare(
      `SELECT q.external_id, z.badge_code, z.domain, z.competence, z.level, q.text, q.choices, q.answer_index, q.explanation, q.active
       FROM quiz_questions q JOIN quizzes z ON z.id = q.quiz_id ORDER BY q.external_id`,
    )
    .all();
  const maxChoices = Math.max(4, ...rows.map((r) => JSON.parse(r.choices).length));
  const letters = LETTERS.slice(0, maxChoices).map((l) => l.toUpperCase());
  const header = ['id_question', 'id_badge', 'domaine', 'competence', 'niveau', 'question', ...letters, 'reponse', 'explication', 'actif'];
  const data = rows.map((r) => {
    const choices = JSON.parse(r.choices);
    return [
      r.external_id, r.badge_code, r.domain, r.competence, LEVEL_NAMES[r.level], r.text,
      ...letters.map((_, i) => choices[i] || ''), letters[r.answer_index], r.explanation || '', r.active ? 'oui' : 'non',
    ];
  });
  return [header, ...data];
}

function toCsv(rows) {
  const cell = (v) => {
    const s = String(v ?? '');
    return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  // BOM + « ; » + CRLF : s'ouvre directement dans Excel en français.
  return '﻿' + rows.map((r) => r.map(cell).join(';')).join('\r\n') + '\r\n';
}

const TEMPLATE_ROWS = [
  HEADER,
  ['JKQ-000001', 'JKB-00001', 'Comptabilité & fiscalité', 'Excel Débutant', 'Débutant', 'Quel symbole commence toujours une formule dans Excel ?', '#', '=', '@', '$', 'B', 'Toute formule Excel commence par le signe égal.'],
];

module.exports = { importQuestions, readRows, parseCsv, exportRows, toCsv, familyOf, slugify, parseLevel, HEADER, TEMPLATE_ROWS, LEVEL_NAMES };
