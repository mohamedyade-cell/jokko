const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { makeApp, csrf, register, fixtureCsv } = require('./helpers');
const { openDb } = require('../src/db');
const { importQuestions, parseCsv, readRows, exportRows, toCsv, familyOf } = require('../src/quizImport');
const quiz = require('../src/quiz');

const HEADER = 'id_question;id_badge;domaine;competence;niveau;question;A;B;C;D;reponse;explication';

function run(db, text, name = 'questions.csv') {
  return importQuestions(db, [{ name, rows: parseCsv(text) }]);
}

describe('Import de la banque de questions', () => {
  test('lit le format Jokko : BOM, « ; », CRLF, guillemets et retours à la ligne dans les champs', () => {
    const db = openDb(':memory:');
    const csv =
      '﻿' + HEADER + '\r\n' +
      'JKQ-1;JKB-1;Finance d\'entreprise;ORBUS Débutant;Débutant;"Quel ratio ; au bilan ?";"Le ""BFR""";Le FR;"Ligne 1\nLigne 2";La CAF;B;Parce que.\r\n' +
      'JKQ-2;JKB-2;Finance d\'entreprise;ORBUS Avancé;Avancé;Q2 ?;a;b;c;d;d;\r\n';
    const { stats } = run(db, csv);
    assert.deepEqual(stats, { badgesCreated: 2, badgesUpdated: 0, questionsCreated: 2, questionsUpdated: 0, questionsDisabled: 0 });
    const q = db.prepare("SELECT * FROM quiz_questions WHERE external_id = 'JKQ-1'").get();
    assert.equal(q.text, 'Quel ratio ; au bilan ?');
    assert.deepEqual(JSON.parse(q.choices), ['Le "BFR"', 'Le FR', 'Ligne 1\nLigne 2', 'La CAF']);
    assert.equal(q.answer_index, 1);
    assert.equal(q.explanation, 'Parce que.');
    // Les badges d'une même série partagent la compétence : seul le meilleur niveau compte.
    const families = db.prepare('SELECT DISTINCT family, family_slug FROM quizzes').all();
    assert.deepEqual(families.map((f) => ({ ...f })), [{ family: 'ORBUS', family_slug: 'orbus' }]);
  });

  test('accepte aussi la virgule comme séparateur, 2 à 6 réponses et les niveaux sans accent', () => {
    const db = openDb(':memory:');
    const csv = 'id_question,id_badge,domaine,competence,niveau,question,A,B,C,D,E,F,reponse\nJKQ-9,JKB-9,Langues,Anglais,intermediaire,Q ?,yes,no,,,,,A\nJKQ-10,JKB-9,Langues,Anglais,Intermédiaire,Q2 ?,1,2,3,4,5,6,F\n';
    assert.ok(run(db, csv).stats);
    const q = db.prepare("SELECT choices, answer_index FROM quiz_questions WHERE external_id = 'JKQ-10'").get();
    assert.equal(JSON.parse(q.choices).length, 6);
    assert.equal(q.answer_index, 5);
  });

  test('refuse tout le fichier à la moindre erreur, avec le numéro de ligne', () => {
    const db = openDb(':memory:');
    const csv = [
      HEADER,
      'JKQ-1;JKB-1;Dom;Comp;Débutant;Q1 ?;a;b;c;d;A;',
      'JKQ-2;JKB-1;Dom;Comp;Expert confirmé;Q2 ?;a;b;c;d;A;',
      'JKQ-3;JKB-1;Dom;Comp;Débutant;Q3 ?;a;b;;;D;',
      'JKQ-1;JKB-1;Dom;Comp;Débutant;Q4 ?;a;b;c;d;A;',
      'JKQ-5;JKB-1;Dom;Autre compétence;Débutant;Q5 ?;a;b;c;d;A;',
      'JKQ-6;JKB-2;Dom;Comp;Débutant;;a;b;c;d;A;',
      'JKQ-7;JKB-2;Dom;Comp;Débutant;Q7 ?;a;a;c;d;A;',
    ].join('\n');
    const { errors, stats } = run(db, csv, 'part01.csv');
    assert.equal(stats, undefined);
    assert.deepEqual(
      errors.map((e) => e.replace(/ :.*/, '')),
      ['part01.csv ligne 3', 'part01.csv ligne 4', 'part01.csv ligne 5', 'part01.csv ligne 6', 'part01.csv ligne 7', 'part01.csv ligne 8'],
    );
    assert.match(errors[0], /niveau « Expert confirmé » inconnu/);
    assert.match(errors[1], /« D » ne correspond à aucune réponse remplie \(A, B\)/);
    assert.match(errors[2], /en double/);
    assert.match(errors[3], /badge JKB-1/);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM quiz_questions').get().n, 0);

    const missing = run(db, 'id_question;question\nX;Y\n');
    assert.match(missing.errors[0], /colonnes manquantes \(id_badge, domaine, competence, niveau, a, b, reponse\)/);
  });

  test('réimport : mise à jour par id_question, retrait du tirage avec « actif = non », rien n’est supprimé', () => {
    const db = openDb(':memory:');
    assert.ok(run(db, fixtureCsv()).stats);
    const before = quiz.getQuiz(db, 'JKB-T03').question_count;
    const { stats } = run(db, `${HEADER};actif\nJKQ-T0029;JKB-T03;Comptabilité & fiscalité;Comptabilité Débutant;Débutant;Texte corrigé ?;w;x;y;z;C;;non\n`);
    assert.equal(stats.questionsUpdated, 1);
    assert.equal(stats.questionsDisabled, 1);
    const q = db.prepare("SELECT text, answer_index, active FROM quiz_questions WHERE external_id = 'JKQ-T0029'").get();
    assert.deepEqual({ ...q }, { text: 'Texte corrigé ?', answer_index: 2, active: 0 });
    assert.equal(quiz.getQuiz(db, 'JKB-T03').question_count, before - 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM quiz_questions').get().n, 61);
  });

  test('l’export se réimporte à l’identique ; lecture des fichiers Excel', async () => {
    const db = openDb(':memory:');
    run(db, fixtureCsv());
    const rows = exportRows(db);
    assert.equal(rows.length, 62);
    const again = importQuestions(db, [{ name: 'export.csv', rows: parseCsv(toCsv(rows)) }]);
    assert.equal(again.stats.questionsUpdated, 61);
    assert.deepEqual(exportRows(db), rows);

    const writeXlsx = require('write-excel-file/node').default;
    const buffer = await writeXlsx(parseCsv(fixtureCsv()).map((r) => r.map((v) => ({ value: v.replace(/^﻿/, '') })))).toBuffer();
    const db2 = openDb(':memory:');
    const fromXlsx = importQuestions(db2, [{ name: 'banque.xlsx', rows: await readRows(buffer, 'banque.xlsx') }]);
    assert.equal(fromXlsx.stats.questionsCreated, 61);
    await assert.rejects(readRows(Buffer.from('x'), 'banque.pdf'), /format non pris en charge/);
  });

  test('regroupement des séries de badges', () => {
    assert.equal(familyOf('Sage 100 Comptabilité Intermédiaire'), 'Sage 100 Comptabilité');
    assert.equal(familyOf('SAP FI-CO Avancé'), 'SAP FI-CO');
    assert.equal(familyOf('Fonds de roulement'), 'Fonds de roulement');
  });
});

describe('Administration de la banque de questions', () => {
  test('import de plusieurs fichiers, erreurs affichées, modèle et export', async () => {
    const app = makeApp({ adminEmails: 'admin@jokko.test' });
    const admin = await register(app, { role: 'recruiter', email: 'admin@jokko.test', name: 'Équipe', company: 'Jokko' });
    const candidate = await register(app, { role: 'candidate', email: 'c@test.sn', name: 'Cand' });
    assert.equal((await candidate.get('/admin/quizzes')).status, 403);

    const [head, ...lines] = fixtureCsv().trim().split('\r\n');
    const part1 = [head, ...lines.slice(0, 30)].join('\r\n');
    const part2 = [head, ...lines.slice(30)].join('\r\n');
    let _csrf = await csrf(admin, '/admin/quizzes');
    let res = await admin
      .post('/admin/quizzes/import')
      .field('_csrf', _csrf)
      .attach('files', Buffer.from(part1), 'part01.csv')
      .attach('files', Buffer.from(part2), 'part02.csv');
    assert.equal(res.status, 302, res.text);
    res = await admin.get('/admin/quizzes');
    assert.match(res.text, /Import réussi : 61 question\(s\) ajoutée\(s\)/);
    assert.match(res.text, /part01\.csv, part02\.csv/);
    assert.match(res.text, /JKB-T06[\s\S]*?non proposé/);

    _csrf = await csrf(admin, '/admin/quizzes');
    res = await admin.post('/admin/quizzes/import').field('_csrf', _csrf).attach('files', Buffer.from(`${HEADER}\nJKQ-X;JKB-X;D;C;Débutant;Q ?;a;b;c;d;Z;\n`), 'faux.csv');
    assert.equal(res.status, 400);
    assert.match(res.text, /Import refusé/);
    assert.match(res.text, /faux\.csv ligne 2/);
    res = await admin.post('/admin/quizzes/import').field('_csrf', _csrf).attach('files', Buffer.from('%PDF'), 'faux.pdf');
    assert.equal(res.status, 400);

    // Aperçu d'un badge avec bonnes réponses et explications ; désactivation.
    res = await admin.get('/admin/quizzes/JKB-T01');
    assert.match(res.text, /Bonne réponse 1 ✓/);
    assert.match(res.text, /Explication 1/);
    await admin.post('/admin/quizzes/JKB-T01/toggle').type('form').send({ _csrf });
    assert.equal(quiz.listQuizzes(app.locals.db).some((z) => z.badge_code === 'JKB-T01'), false);
    assert.doesNotMatch((await candidate.get('/skills')).text, /Excel Débutant|JKB-T01/);

    res = await admin.get('/admin/quizzes/modele.csv');
    assert.match(res.headers['content-disposition'], /modele-questions-jokko\.csv/);
    assert.ok(res.text.startsWith('﻿' + HEADER));
    res = await admin.get('/admin/quizzes/modele.xlsx').buffer(true).parse((r, cb) => {
      const chunks = [];
      r.on('data', (c) => chunks.push(c));
      r.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    assert.equal((await readRows(res.body, 'modele.xlsx'))[0].join(';'), HEADER);

    res = await admin.get('/admin/quizzes/export.csv');
    assert.equal(parseCsv(res.text).length - 1, 61);
    assert.equal((await request(app).get('/admin/quizzes/export.csv')).status, 302);
  });
});
